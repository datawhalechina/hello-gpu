"""Teaching online-attention kernels for Chapter 11."""

from __future__ import annotations

import argparse
import math
import statistics

import torch
import triton
import triton.language as tl


@triton.jit
def online_attention_kernel(
    q_ptr,
    k_ptr,
    v_ptr,
    output_ptr,
    scale,
    SEQ: tl.constexpr,
    DIM: tl.constexpr,
    BLOCK_K: tl.constexpr,
    BLOCK_D: tl.constexpr,
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
            mask=key_mask[:, None] & (d[None, :] < DIM),
            other=0.0,
        )
        scores = tl.sum(k * q[None, :], axis=1) * scale
        scores = tl.where(key_mask, scores, -float("inf"))
        tile_max = tl.max(scores, axis=0)
        next_max = tl.maximum(running_max, tile_max)
        history_scale = tl.exp(running_max - next_max)
        probabilities = tl.exp(scores - next_max)
        v = tl.load(
            v_ptr + keys[:, None] * DIM + d[None, :],
            mask=key_mask[:, None] & (d[None, :] < DIM),
            other=0.0,
        )
        accumulator = accumulator * history_scale + tl.sum(
            probabilities[:, None] * v, axis=0
        )
        running_sum = running_sum * history_scale + tl.sum(probabilities, axis=0)
        running_max = next_max

    tl.store(
        output_ptr + row * DIM + d,
        accumulator / running_sum,
        mask=d < DIM,
    )


def launch(
    q: torch.Tensor,
    k: torch.Tensor,
    v: torch.Tensor,
    output: torch.Tensor,
    block_k: int,
) -> None:
    seq, dim = q.shape
    block_d = triton.next_power_of_2(dim)
    online_attention_kernel[(seq,)](
        q,
        k,
        v,
        output,
        1.0 / math.sqrt(dim),
        SEQ=seq,
        DIM=dim,
        BLOCK_K=block_k,
        BLOCK_D=block_d,
        num_warps=4 if block_d <= 128 else 8,
    )


def time_launch(
    q: torch.Tensor,
    k: torch.Tensor,
    v: torch.Tensor,
    output: torch.Tensor,
    block_k: int,
    warmup: int,
    repeat: int,
) -> tuple[float, float, float]:
    for _ in range(warmup):
        launch(q, k, v, output, block_k)
    torch.cuda.synchronize()
    starts = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    stops = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    for start, stop in zip(starts, stops, strict=True):
        start.record()
        launch(q, k, v, output, block_k)
        stop.record()
    torch.cuda.synchronize()
    times_ms = [start.elapsed_time(stop) for start, stop in zip(starts, stops, strict=True)]
    return min(times_ms), statistics.median(times_ms), statistics.fmean(times_ms)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=("all", "t0", "t1"), default="all")
    parser.add_argument("--seq", type=int, default=128)
    parser.add_argument("--dim", type=int, default=64)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--repeat", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260719)
    args = parser.parse_args()
    if (
        args.seq <= 0
        or args.dim <= 0
        or args.dim > 256
        or args.warmup < 0
        or args.repeat <= 0
    ):
        raise SystemExit(
            "seq and dim must be positive, dim <= 256, "
            "warmup >= 0, repeat > 0"
        )

    torch.manual_seed(args.seed)
    q = torch.randn((args.seq, args.dim), device="cuda", dtype=torch.float32) * 0.5
    k = torch.randn_like(q) * 0.5
    v = torch.randn_like(q) * 0.5
    reference = torch.softmax(q @ k.T / math.sqrt(args.dim), dim=1) @ v
    configurations = {"t0": 16, "t1": 32}
    for version, block_k in configurations.items():
        if args.version not in ("all", version):
            continue
        output = torch.empty_like(q)
        launch(q, k, v, output, block_k)
        torch.cuda.synchronize()
        precheck = (output - reference).abs().max().item() < 2e-4
        if not precheck:
            print(
                "RESULT operator=attention "
                f"implementation=triton-{version} runtime=triton shape={args.seq}x{args.dim} "
                f"seq={args.seq} dim={args.dim} dtype=float32 block_k={block_k} "
                f"warmup={args.warmup} repeat={args.repeat} seed={args.seed} timed=0 "
                "correct=FAIL precheck=FAIL postcheck=NA min_ms=NA median_ms=NA mean_ms=NA"
            )
            raise SystemExit(1)
        min_ms, median_ms, mean_ms = time_launch(
            q, k, v, output, block_k, args.warmup, args.repeat
        )
        max_error = (output - reference).abs().max().item()
        correct = max_error < 2e-4
        print(
            "RESULT operator=attention "
            f"implementation=triton-{version} runtime=triton shape={args.seq}x{args.dim} "
            f"seq={args.seq} dim={args.dim} dtype=float32 block_k={block_k} "
            f"warmup={args.warmup} repeat={args.repeat} seed={args.seed} timed=1 "
            f"correct={'OK' if correct else 'FAIL'} precheck=OK "
            f"postcheck={'OK' if correct else 'FAIL'} min_ms={min_ms:.6f} "
            f"median_ms={median_ms:.6f} mean_ms={mean_ms:.6f} max_abs_error={max_error:.8g}"
        )
        if not correct:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
