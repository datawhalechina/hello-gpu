"""Row-wise fused RMSNorm for Chapter 12."""

from __future__ import annotations

import argparse
import math
import statistics

import torch
import triton
import triton.language as tl


@triton.jit
def rmsnorm_kernel(
    input_ptr,
    weight_ptr,
    output_ptr,
    cols,
    epsilon,
    BLOCK_SIZE: tl.constexpr,
):
    row = tl.program_id(0)
    offsets = tl.arange(0, BLOCK_SIZE)
    mask = offsets < cols
    values = tl.load(input_ptr + row * cols + offsets, mask=mask, other=0.0)
    mean_square = tl.sum(values * values, axis=0) / cols
    inverse_rms = tl.rsqrt(mean_square + epsilon)
    weights = tl.load(weight_ptr + offsets, mask=mask, other=0.0)
    tl.store(
        output_ptr + row * cols + offsets,
        values * inverse_rms * weights,
        mask=mask,
    )


def launch(input_tensor: torch.Tensor, weight: torch.Tensor, output: torch.Tensor,
           epsilon: float, num_warps: int) -> None:
    rows, cols = input_tensor.shape
    block_size = triton.next_power_of_2(cols)
    if block_size > 65536:
        raise ValueError("this teaching kernel supports cols <= 65536")
    rmsnorm_kernel[(rows,)](
        input_tensor,
        weight,
        output,
        cols,
        epsilon,
        BLOCK_SIZE=block_size,
        num_warps=num_warps,
    )


def time_launch(input_tensor: torch.Tensor, weight: torch.Tensor, output: torch.Tensor,
                epsilon: float, num_warps: int, warmup: int, repeat: int) -> tuple[float, float, float]:
    for _ in range(warmup):
        launch(input_tensor, weight, output, epsilon, num_warps)
    torch.cuda.synchronize()
    starts = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    stops = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    for start, stop in zip(starts, stops, strict=True):
        start.record()
        launch(input_tensor, weight, output, epsilon, num_warps)
        stop.record()
    torch.cuda.synchronize()
    times_ms = [start.elapsed_time(stop) for start, stop in zip(starts, stops, strict=True)]
    return min(times_ms), statistics.median(times_ms), statistics.fmean(times_ms)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=("all", "t0", "t1"), default="all")
    parser.add_argument("--rows", type=int, default=1024)
    parser.add_argument("--cols", type=int, default=4096)
    parser.add_argument("--epsilon", type=float, default=1e-5)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--repeat", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260719)
    args = parser.parse_args()
    if (
        args.rows <= 0
        or args.cols <= 0
        or args.cols > 65536
        or not math.isfinite(args.epsilon)
        or args.epsilon <= 0
        or args.warmup < 0
        or args.repeat <= 0
    ):
        raise SystemExit(
            "rows, cols, epsilon and repeat must be positive, "
            "cols <= 65536, epsilon finite, warmup non-negative"
        )

    torch.manual_seed(args.seed)
    input_tensor = torch.randn(
        (args.rows, args.cols), device="cuda", dtype=torch.float32
    )
    weight = torch.randn((args.cols,), device="cuda", dtype=torch.float32)
    reference = input_tensor * torch.rsqrt(
        input_tensor.square().mean(dim=1, keepdim=True) + args.epsilon
    ) * weight
    configurations = {"t0": 4, "t1": 8}
    for version, num_warps in configurations.items():
        if args.version not in ("all", version):
            continue
        output = torch.empty_like(input_tensor)
        launch(input_tensor, weight, output, args.epsilon, num_warps)
        torch.cuda.synchronize()
        precheck = (output - reference).abs().max().item() < 2e-5
        if not precheck:
            print(
                "RESULT operator=rmsnorm "
                f"implementation=triton-{version} runtime=triton shape={args.rows}x{args.cols} "
                f"rows={args.rows} cols={args.cols} dtype=float32 num_warps={num_warps} "
                f"warmup={args.warmup} repeat={args.repeat} seed={args.seed} timed=0 "
                "correct=FAIL precheck=FAIL postcheck=NA min_ms=NA median_ms=NA mean_ms=NA"
            )
            raise SystemExit(1)
        min_ms, median_ms, mean_ms = time_launch(
            input_tensor,
            weight,
            output,
            args.epsilon,
            num_warps,
            args.warmup,
            args.repeat,
        )
        max_error = (output - reference).abs().max().item()
        correct = max_error < 2e-5
        print(
            "RESULT operator=rmsnorm "
            f"implementation=triton-{version} runtime=triton shape={args.rows}x{args.cols} "
            f"rows={args.rows} cols={args.cols} dtype=float32 num_warps={num_warps} "
            f"warmup={args.warmup} repeat={args.repeat} seed={args.seed} timed=1 "
            f"correct={'OK' if correct else 'FAIL'} precheck=OK "
            f"postcheck={'OK' if correct else 'FAIL'} min_ms={min_ms:.6f} "
            f"median_ms={median_ms:.6f} mean_ms={mean_ms:.6f} max_abs_error={max_error:.8g}"
        )
        if not correct:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
