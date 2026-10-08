"""FP32 materialized and online Attention for Chapter 12.

Single head, non-causal, Q/K/V shape [SEQ, DIM]. Every GPU multiplication and
reduction stays FP32; no tl.dot or reduced-precision tensor-core path is used.
Timing covers all kernels of one forward call, excluding allocation/reference.
"""

from __future__ import annotations

import argparse
import csv
import math
import statistics
from dataclasses import dataclass
from pathlib import Path

import torch
import triton
import triton.language as tl


ATOL = 2.0e-5
RTOL = 2.0e-4
MATERIALIZED_BLOCK_K = 32
NUM_WARPS = 4


@triton.jit
def materialized_scores_kernel(
    q_ptr, k_ptr, scores_ptr, scale,
    SEQ: tl.constexpr, DIM: tl.constexpr,
    BLOCK_K: tl.constexpr, BLOCK_D: tl.constexpr,
):
    row = tl.program_id(0)
    d = tl.arange(0, BLOCK_D)
    q = tl.load(q_ptr + row * DIM + d, mask=d < DIM, other=0.0)
    for key_start in range(0, SEQ, BLOCK_K):
        keys = key_start + tl.arange(0, BLOCK_K)
        key_mask = keys < SEQ
        k = tl.load(
            k_ptr + keys[:, None] * DIM + d[None, :],
            mask=key_mask[:, None] & (d[None, :] < DIM), other=0.0,
        )
        scores = tl.sum(k * q[None, :], axis=1) * scale
        tl.store(scores_ptr + row * SEQ + keys, scores, mask=key_mask)


@triton.jit
def materialized_softmax_kernel(
    scores_ptr, probabilities_ptr,
    SEQ: tl.constexpr, BLOCK_S: tl.constexpr,
):
    row = tl.program_id(0)
    keys = tl.arange(0, BLOCK_S)
    scores = tl.load(scores_ptr + row * SEQ + keys, mask=keys < SEQ, other=-float("inf"))
    weights = tl.exp(scores - tl.max(scores, axis=0))
    probabilities = weights / tl.sum(weights, axis=0)
    tl.store(probabilities_ptr + row * SEQ + keys, probabilities, mask=keys < SEQ)


@triton.jit
def materialized_pv_kernel(
    probabilities_ptr, v_ptr, output_ptr,
    SEQ: tl.constexpr, DIM: tl.constexpr,
    BLOCK_K: tl.constexpr, BLOCK_D: tl.constexpr,
):
    row = tl.program_id(0)
    d = tl.arange(0, BLOCK_D)
    accumulator = tl.zeros((BLOCK_D,), tl.float32)
    for key_start in range(0, SEQ, BLOCK_K):
        keys = key_start + tl.arange(0, BLOCK_K)
        key_mask = keys < SEQ
        probabilities = tl.load(probabilities_ptr + row * SEQ + keys, mask=key_mask, other=0.0)
        values = tl.load(
            v_ptr + keys[:, None] * DIM + d[None, :],
            mask=key_mask[:, None] & (d[None, :] < DIM), other=0.0,
        )
        accumulator += tl.sum(probabilities[:, None] * values, axis=0)
    tl.store(output_ptr + row * DIM + d, accumulator, mask=d < DIM)


@triton.jit
def online_attention_kernel(
    q_ptr, k_ptr, v_ptr, output_ptr, scale,
    SEQ: tl.constexpr, DIM: tl.constexpr,
    BLOCK_K: tl.constexpr, BLOCK_D: tl.constexpr,
):
    row = tl.program_id(0)
    d = tl.arange(0, BLOCK_D)
    q = tl.load(q_ptr + row * DIM + d, mask=d < DIM, other=0.0)
    running_max = -float("inf")
    running_sum = 0.0
    accumulator = tl.zeros((BLOCK_D,), tl.float32)
    for key_start in range(0, SEQ, BLOCK_K):
        keys = key_start + tl.arange(0, BLOCK_K)
        key_mask = keys < SEQ
        k = tl.load(
            k_ptr + keys[:, None] * DIM + d[None, :],
            mask=key_mask[:, None] & (d[None, :] < DIM), other=0.0,
        )
        scores = tl.sum(k * q[None, :], axis=1) * scale
        scores = tl.where(key_mask, scores, -float("inf"))
        # SEQ > 0 and key_start < SEQ guarantee a valid key in every tile.
        tile_max = tl.max(scores, axis=0)
        next_max = tl.maximum(running_max, tile_max)
        history_scale = tl.exp(running_max - next_max)
        probabilities = tl.exp(scores - next_max)
        values = tl.load(
            v_ptr + keys[:, None] * DIM + d[None, :],
            mask=key_mask[:, None] & (d[None, :] < DIM), other=0.0,
        )
        accumulator = accumulator * history_scale + tl.sum(
            probabilities[:, None] * values, axis=0
        )
        running_sum = running_sum * history_scale + tl.sum(probabilities, axis=0)
        running_max = next_max
    tl.store(output_ptr + row * DIM + d, accumulator / running_sum, mask=d < DIM)


@dataclass(frozen=True)
class Implementation:
    version: str
    block_k: int

    @property
    def name(self) -> str:
        return f"triton-{self.version}"

    @property
    def launches(self) -> int:
        return 3 if self.version == "materialized" else 1


@dataclass(frozen=True)
class Validation:
    correct: bool
    finite: bool
    max_absolute_error: float
    max_tolerance_ratio: float


@dataclass(frozen=True)
class Timing:
    minimum_ms: float
    median_ms: float
    mean_ms: float
    samples: tuple[float, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", choices=("all", "materialized", "online", "t0", "t1"), default="all")
    parser.add_argument("--seq", type=int, default=128)
    parser.add_argument("--dim", type=int, default=64)
    parser.add_argument("--block-k", type=int, choices=(16, 32, 64), default=None,
                        help="online key tile; default 32 (t0/t1 aliases select 16/32)")
    parser.add_argument("--num-warps", type=int, choices=(4,), default=4)
    parser.add_argument("--input", choices=("dyadic", "rising-max"), default="dyadic")
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--repeat", type=int, default=50)
    parser.add_argument("--seed", type=int, default=20260920)
    parser.add_argument("--samples", type=Path)
    parser.add_argument("--config-id", default="")
    parser.add_argument("--process", type=int, default=1)
    args = parser.parse_args()
    if not 1 <= args.seq <= 4096 or not 1 <= args.dim <= 256:
        parser.error("require 1 <= seq <= 4096 and 1 <= dim <= 256")
    if args.warmup < 0 or args.repeat <= 0 or args.process <= 0:
        parser.error("warmup must be non-negative; repeat/process must be positive")
    if not 0 <= args.seed <= 0xFFFFFFFF:
        parser.error("seed must fit uint32")
    if any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_." for c in args.config_id):
        parser.error("invalid config-id")
    if args.samples and (args.version == "all" or not args.config_id):
        parser.error("--samples requires one version and a --config-id")
    if args.version in ("t0", "t1"):
        alias_tile = 16 if args.version == "t0" else 32
        if args.block_k is not None and args.block_k != alias_tile:
            parser.error("--block-k conflicts with the t0/t1 alias")
        args.block_k = alias_tile
        args.version = "online"
    if args.version == "materialized" and args.block_k not in (None, MATERIALIZED_BLOCK_K):
        parser.error("materialized uses a fixed key tile of 32")
    args.block_k = args.block_k or 32
    return args


def selected_implementations(args: argparse.Namespace) -> list[Implementation]:
    materialized = Implementation("materialized", MATERIALIZED_BLOCK_K)
    online = Implementation("online", args.block_k)
    if args.version == "all":
        return [materialized, online]
    return [materialized if args.version == "materialized" else online]


def make_host_input(seq: int, dim: int, seed: int, kind: str) -> tuple[torch.Tensor, ...]:
    """Integer formulas match attention_hip.hip exactly before FP32 division."""
    rows = torch.arange(seq, dtype=torch.int64).view(seq, 1)
    columns = torch.arange(dim, dtype=torch.int64).view(1, dim)
    q = ((17 * rows + 13 * columns + seed) % 65 - 32).float() / 64.0
    k = ((29 * rows + 7 * columns + seed + 11) % 65 - 32).float() / 64.0
    v = ((11 * rows + 19 * columns + seed + 23) % 65 - 32).float() / 32.0
    if kind == "rising-max":
        q.zero_()
        k.zero_()
        q[:, 0] = 8.0
        k[:, 0] = (torch.arange(seq, dtype=torch.float32) - seq // 2) / 8.0
    return q, k, v


def cpu_reference(q: torch.Tensor, k: torch.Tensor, v: torch.Tensor) -> torch.Tensor:
    """All reference operations run on CPU in FP64, then round once to FP32."""
    scores = (q.double() @ k.double().T) / math.sqrt(q.shape[1])
    return (torch.softmax(scores, dim=1) @ v.double()).float()


def launch(implementation: Implementation, q: torch.Tensor, k: torch.Tensor,
           v: torch.Tensor, output: torch.Tensor,
           scores: torch.Tensor, probabilities: torch.Tensor) -> None:
    seq, dim = q.shape
    block_d = triton.next_power_of_2(dim)
    parameters = dict(SEQ=seq, DIM=dim, BLOCK_K=implementation.block_k,
                      BLOCK_D=block_d, num_warps=NUM_WARPS)
    if implementation.version == "materialized":
        materialized_scores_kernel[(seq,)](q, k, scores, 1.0 / math.sqrt(dim), **parameters)
        materialized_softmax_kernel[(seq,)](
            scores, probabilities, SEQ=seq, BLOCK_S=triton.next_power_of_2(seq), num_warps=NUM_WARPS,
        )
        materialized_pv_kernel[(seq,)](probabilities, v, output, **parameters)
    else:
        online_attention_kernel[(seq,)](q, k, v, output, 1.0 / math.sqrt(dim), **parameters)


def validate(output: torch.Tensor, reference: torch.Tensor) -> Validation:
    actual = output.detach().to(device="cpu")
    finite = bool(torch.isfinite(actual).all() and torch.isfinite(reference).all())
    if not finite:
        return Validation(False, False, math.inf, math.inf)
    error = (actual.double() - reference.double()).abs()
    tolerance = ATOL + RTOL * reference.double().abs()
    return Validation(bool((error <= tolerance).all()), True,
                      float(error.max()), float((error / tolerance).max()))


def time_launch(implementation: Implementation, args: argparse.Namespace,
                q: torch.Tensor, k: torch.Tensor, v: torch.Tensor,
                output: torch.Tensor, scores: torch.Tensor, probabilities: torch.Tensor) -> Timing:
    for _ in range(args.warmup):
        launch(implementation, q, k, v, output, scores, probabilities)
    torch.cuda.synchronize()
    start = torch.cuda.Event(enable_timing=True)
    stop = torch.cuda.Event(enable_timing=True)
    times: list[float] = []
    for _ in range(args.repeat):
        start.record()
        launch(implementation, q, k, v, output, scores, probabilities)
        stop.record()
        stop.synchronize()
        times.append(float(start.elapsed_time(stop)))
    return Timing(min(times), statistics.median(times), statistics.fmean(times), tuple(times))


def metadata(implementation: Implementation, args: argparse.Namespace) -> dict[str, object]:
    intermediate_bytes = 2 * args.seq * args.seq * 4
    return dict(
        config_id=args.config_id, implementation=implementation.name, runtime="triton",
        shape=f"{args.seq}x{args.dim}", dtype="float32", block=0,
        block_k=implementation.block_k, block_d=triton.next_power_of_2(args.dim),
        num_warps=NUM_WARPS, launches=implementation.launches,
        warmup=args.warmup, repeat=args.repeat, seed=args.seed, process=args.process,
        scope="gpu-event-full-operator", input=args.input, input_precision="fp32",
        atol=ATOL, rtol=RTOL, intermediate_allocated_bytes=intermediate_bytes,
        intermediate_used_bytes=intermediate_bytes if implementation.version == "materialized" else 0,
    )


def print_result(implementation: Implementation, args: argparse.Namespace,
                 validation: Validation, timing: Timing | None,
                 precheck: str, postcheck: str) -> None:
    fields = metadata(implementation, args)
    fields.update(seq=args.seq, dim=args.dim, programs_per_query=1, timing="gpu-event",
                  reference="fp64-attention-to-fp32", output_finite="OK" if validation.finite else "FAIL",
                  timed=int(timing is not None), correct="OK" if validation.correct else "FAIL",
                  precheck=precheck, postcheck=postcheck,
                  min_ms="NA" if timing is None else format(timing.minimum_ms, ".17g"),
                  median_ms="NA" if timing is None else format(timing.median_ms, ".17g"),
                  mean_ms="NA" if timing is None else format(timing.mean_ms, ".17g"),
                  max_abs_error=validation.max_absolute_error,
                  max_tolerance_ratio=validation.max_tolerance_ratio)
    print("RESULT operator=attention " + " ".join(f"{key}={value}" for key, value in fields.items()))


def save_samples(implementation: Implementation, args: argparse.Namespace, timing: Timing) -> None:
    if args.samples is None:
        return
    fields = metadata(implementation, args)
    with args.samples.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=(*fields.keys(), "sample", "ms"))
        writer.writeheader()
        for sample, ms in enumerate(timing.samples):
            writer.writerow(dict(fields, sample=sample, ms=ms))


def main() -> int:
    args = parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("PyTorch cannot see a ROCm GPU")
    print(f'ENV runtime=triton gpu="{torch.cuda.get_device_name(0)}" '
          f"torch={torch.__version__} torch_hip={torch.version.hip} triton={triton.__version__}")
    host_q, host_k, host_v = make_host_input(args.seq, args.dim, args.seed, args.input)
    reference = cpu_reference(host_q, host_k, host_v)
    q, k, v = (tensor.to(device="cuda") for tensor in (host_q, host_k, host_v))
    output = torch.empty_like(q)
    # Keep allocation identical between versions; only materialized kernels
    # access scores/P. This does not demonstrate lower peak device allocation.
    scores = torch.empty((args.seq, args.seq), dtype=torch.float32, device="cuda")
    probabilities = torch.empty_like(scores)
    all_correct = True
    for implementation in selected_implementations(args):
        for tensor in (output, scores, probabilities):
            tensor.fill_(float("nan"))
        launch(implementation, q, k, v, output, scores, probabilities)
        torch.cuda.synchronize()
        precheck = validate(output, reference)
        if not precheck.correct:
            print_result(implementation, args, precheck, None, "FAIL", "NA")
            all_correct = False
            continue
        timing = time_launch(implementation, args, q, k, v, output, scores, probabilities)
        postcheck = validate(output, reference)
        print_result(implementation, args, postcheck, timing, "OK", "OK" if postcheck.correct else "FAIL")
        all_correct = all_correct and postcheck.correct
        if postcheck.correct:
            save_samples(implementation, args, timing)
    return 0 if all_correct else 1


if __name__ == "__main__":
    raise SystemExit(main())
