"""Controlled two-stage reduction: fixed tile/warps/final, varying program cap."""
from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path
import re
import statistics

import numpy as np
import torch
import triton
import triton.language as tl

BLOCK = 1024
NUM_WARPS = 4


@triton.jit
def round_partial_kernel(x, partials, size, programs, BLOCK_SIZE: tl.constexpr):
    pid = tl.program_id(0)
    accumulator = tl.zeros((BLOCK_SIZE,), tl.float32)
    for first in tl.range(pid * BLOCK_SIZE, size, programs * BLOCK_SIZE):
        offsets = first + tl.arange(0, BLOCK_SIZE)
        accumulator += tl.load(x + offsets, mask=offsets < size, other=0.0)
    tl.store(partials + pid, tl.sum(accumulator, 0))


@triton.jit
def round_final_kernel(partials, out, programs, BLOCK_SIZE: tl.constexpr):
    offsets = tl.arange(0, BLOCK_SIZE)
    values = tl.load(partials + offsets, mask=offsets < programs, other=0.0)
    tl.store(out, tl.sum(values, 0))


def make_input(size: int, seed: int, kind: str) -> np.ndarray:
    if kind == "ones":
        return np.ones(size, dtype=np.float32)
    if kind == "weighted":
        i = np.arange(size, dtype=np.uint64)
        q = ((i * 17 + (i // 251) * 7 + seed) % 31).astype(np.int32) - 15
    else:
        q = np.arange(size, dtype=np.uint32) ^ np.uint32(seed)
        with np.errstate(over="ignore"):
            q ^= q >> 16
            q *= np.uint32(0x7FEB352D)
            q ^= q >> 15
            q *= np.uint32(0x846CA68B)
            q ^= q >> 16
        q = (q % 33).astype(np.int32) - 16
    return q.astype(np.float32) / 32.0


def launch(x: torch.Tensor, partials: torch.Tensor, out: torch.Tensor) -> None:
    programs = partials.numel()
    round_partial_kernel[(programs,)](x, partials, x.numel(), programs,
                                      BLOCK_SIZE=BLOCK, num_warps=NUM_WARPS)
    # Always the same 1024-element final tile, even when fewer partials are valid.
    round_final_kernel[(1,)](partials, out, programs, BLOCK_SIZE=BLOCK, num_warps=NUM_WARPS)


def check(partials: torch.Tensor, out: torch.Tensor, expected: np.ndarray, reference: float) -> None:
    actual = partials.cpu().numpy()
    if not np.isfinite(actual).all() or not np.array_equal(actual.astype(np.float64), expected):
        raise RuntimeError("partial mismatch (exact FP64 reference)")
    value = float(out.item())
    if not math.isfinite(value) or value != reference:
        raise RuntimeError(f"final mismatch: got={value}, expected={reference}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--size", type=int, default=16777216)
    parser.add_argument("--block", type=int, choices=(1024,), default=1024)
    parser.add_argument("--programs", type=int, choices=(128, 256, 512, 1024), default=1024)
    parser.add_argument("--input", choices=("random", "weighted", "ones"), default="random")
    parser.add_argument("--seed", type=int, default=20260920)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--repeat", type=int, default=50)
    parser.add_argument("--samples", type=Path)
    parser.add_argument("--config-id", default="")
    parser.add_argument("--process", type=int, default=1)
    a = parser.parse_args()
    if not 0 < a.size <= 16777216 or not 0 <= a.seed <= 0xFFFFFFFF or a.warmup < 0 or a.repeat <= 0 or a.process <= 0:
        parser.error("require 0<N<=2^24, uint32 seed, nonnegative warmup, positive repeat/process")
    a.config_id = a.config_id or f"triton-p{a.programs}"
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", a.config_id):
        parser.error("invalid config-id")
    print(f'ENV gpu="{torch.cuda.get_device_name(0)}" torch={torch.__version__} hip={torch.version.hip} triton={triton.__version__}')
    host = make_input(a.size, a.seed, a.input)
    programs = min(triton.cdiv(a.size, BLOCK), a.programs)
    padded = np.pad(host, (0, (-a.size) % BLOCK))
    tiles = padded.reshape(-1, BLOCK).sum(axis=1, dtype=np.float64)
    expected = np.array([tiles[i::programs].sum(dtype=np.float64) for i in range(programs)])
    reference = float(host.sum(dtype=np.float64))
    if float(np.float32(reference)) != reference:
        raise RuntimeError("reference is outside exact FP32 checking range")
    x = torch.from_numpy(host).to("cuda")
    partials = torch.full((programs,), math.nan, dtype=torch.float32, device="cuda")
    out = torch.full((1,), math.nan, dtype=torch.float32, device="cuda")
    launch(x, partials, out)
    torch.cuda.synchronize()
    check(partials, out, expected, reference)
    for _ in range(a.warmup):
        launch(x, partials, out)
    torch.cuda.synchronize()
    starts = [torch.cuda.Event(enable_timing=True) for _ in range(a.repeat)]
    stops = [torch.cuda.Event(enable_timing=True) for _ in range(a.repeat)]
    for start, stop in zip(starts, stops, strict=True):
        start.record()
        launch(x, partials, out)
        stop.record()
    torch.cuda.synchronize()
    check(partials, out, expected, reference)
    times = [start.elapsed_time(stop) for start, stop in zip(starts, stops, strict=True)]
    metadata = dict(config_id=a.config_id, implementation="triton-two-stage", runtime="triton",
                    shape=a.size, dtype="float32", block=BLOCK, grid=programs, num_warps=NUM_WARPS,
                    input=a.input, warmup=a.warmup, repeat=a.repeat, seed=a.seed, process=a.process,
                    stages=2, scope="gpu-event-full-operator")
    if a.samples:
        with a.samples.open("w", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=[*metadata, "sample", "ms"])
            writer.writeheader()
            writer.writerows(dict(metadata, sample=i, ms=format(ms, ".12g")) for i, ms in enumerate(times))
    print("RESULT " + " ".join(f"{k}={v}" for k, v in metadata.items()) +
          f" correct=OK precheck=OK postcheck=OK partial_check=OK median_ms={statistics.median(times):.9f}"
          f" result={reference:.9g} reference={reference:.17g} max_abs_error=0")


if __name__ == "__main__":
    main()
