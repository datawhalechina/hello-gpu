"""Chapter 7 Element-Wise Vector Add, Triton route.

The kernel is intentionally small. The host program still performs a CPU
reference check before timing, warmup, GPU-event timing, and a postcheck. Book
performance claims are valid only after this script runs on Radeon RX 9070 XT,
ROCm 7.13, and native Ubuntu 24.04.
"""

from __future__ import annotations

import argparse
import statistics
from dataclasses import dataclass

import numpy as np
import torch
import triton
import triton.language as tl


T0_BLOCK_SIZE = 256
NUM_WARPS = 4


@triton.jit
def vector_add_kernel(
    input_a_ptr,
    input_b_ptr,
    output_ptr,
    size,
    BLOCK_SIZE: tl.constexpr,
):
    """Add one tile of two FP32 vectors per Triton program."""
    program_id = tl.program_id(axis=0)
    offsets = program_id * BLOCK_SIZE + tl.arange(0, BLOCK_SIZE)
    valid = offsets < size

    input_a = tl.load(input_a_ptr + offsets, mask=valid, other=0.0)
    input_b = tl.load(input_b_ptr + offsets, mask=valid, other=0.0)
    tl.store(output_ptr + offsets, input_a + input_b, mask=valid)


@dataclass(frozen=True)
class Implementation:
    name: str
    block_size: int


@dataclass(frozen=True)
class Validation:
    correct: bool
    max_absolute_error: float


@dataclass(frozen=True)
class Timing:
    minimum_ms: float
    median_ms: float
    mean_ms: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=("all", "t0", "t1"), default="all")
    parser.add_argument("--size", type=int, default=16 * 1024 * 1024)
    parser.add_argument("--block", type=int, default=1024)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--repeat", type=int, default=50)
    parser.add_argument("--seed", type=int, default=20260716)
    args = parser.parse_args()

    if args.size <= 0:
        parser.error("--size must be positive")
    if args.block <= 0 or args.block & (args.block - 1):
        parser.error("--block must be a positive power of two")
    if args.warmup < 0 or args.repeat <= 0:
        parser.error("--warmup must be non-negative and --repeat positive")
    return args


def selected_implementations(version: str, t1_block: int) -> list[Implementation]:
    t0 = Implementation("triton-t0", T0_BLOCK_SIZE)
    t1 = Implementation("triton-t1", t1_block)
    if version == "all":
        return [t0, t1]
    return [t0 if version == "t0" else t1]


def make_host_inputs(size: int, seed: int) -> tuple[torch.Tensor, torch.Tensor]:
    """Generate the same deterministic FP32 values as the HIP program."""
    indices = np.arange(size, dtype=np.uint64)
    seed_u64 = np.uint64(seed & ((1 << 64) - 1))
    with np.errstate(over="ignore"):
        input_a_integer = ((indices * np.uint64(17) + seed_u64) % 2048).astype(
            np.int64
        ) - 1024
        input_b_integer = (
            (indices * np.uint64(29) + seed_u64 * np.uint64(3)) % 4096
        ).astype(np.int64) - 2048
    input_a = torch.from_numpy((input_a_integer / 1024.0).astype(np.float32))
    input_b = torch.from_numpy((input_b_integer / 2048.0).astype(np.float32))
    return input_a, input_b


def launch(
    implementation: Implementation,
    input_a: torch.Tensor,
    input_b: torch.Tensor,
    output: torch.Tensor,
) -> None:
    size = output.numel()
    grid = (triton.cdiv(size, implementation.block_size),)
    vector_add_kernel[grid](
        input_a,
        input_b,
        output,
        size,
        BLOCK_SIZE=implementation.block_size,
        num_warps=NUM_WARPS,
    )


def validate(output: torch.Tensor, reference: torch.Tensor) -> Validation:
    actual = output.detach().to(device="cpu")
    difference = torch.abs(actual - reference)
    max_absolute_error = float(difference.amax().item())
    finite = bool(torch.isfinite(actual).all().item())
    return Validation(
        correct=finite and max_absolute_error <= 1.0e-6,
        max_absolute_error=max_absolute_error,
    )


def benchmark(
    implementation: Implementation,
    input_a: torch.Tensor,
    input_b: torch.Tensor,
    output: torch.Tensor,
    *,
    warmup: int,
    repeat: int,
) -> Timing:
    for _ in range(warmup):
        launch(implementation, input_a, input_b, output)
    torch.cuda.synchronize()

    starts = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    ends = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    for start, end in zip(starts, ends, strict=True):
        start.record()
        launch(implementation, input_a, input_b, output)
        end.record()
    torch.cuda.synchronize()

    times_ms = [
        start.elapsed_time(end) for start, end in zip(starts, ends, strict=True)
    ]
    return Timing(
        minimum_ms=min(times_ms),
        median_ms=statistics.median(times_ms),
        mean_ms=statistics.fmean(times_ms),
    )


def print_failed_result(
    implementation: Implementation,
    validation: Validation,
    args: argparse.Namespace,
) -> None:
    grid = triton.cdiv(args.size, implementation.block_size)
    print(
        "RESULT"
        " operator=vector-add"
        f" implementation={implementation.name}"
        " runtime=triton"
        f" shape={args.size}"
        " dtype=float32"
        f" block={implementation.block_size}"
        f" grid={grid}"
        f" num_warps={NUM_WARPS}"
        f" warmup={args.warmup}"
        f" repeat={args.repeat}"
        f" seed={args.seed}"
        " timed=0 correct=FAIL precheck=FAIL postcheck=NA"
        " min_ms=NA median_ms=NA mean_ms=NA"
        " effective_bandwidth_gbs=NA"
        f" max_abs_error={validation.max_absolute_error:.9g}"
    )


def print_result(
    implementation: Implementation,
    timing: Timing,
    validation: Validation,
    args: argparse.Namespace,
) -> None:
    grid = triton.cdiv(args.size, implementation.block_size)
    logical_bytes = (
        3.0 * args.size * torch.tensor([], dtype=torch.float32).element_size()
    )
    effective_bandwidth_gbs = logical_bytes / (timing.median_ms * 1.0e-3) / 1.0e9
    status = "OK" if validation.correct else "FAIL"
    print(
        "RESULT"
        " operator=vector-add"
        f" implementation={implementation.name}"
        " runtime=triton"
        f" shape={args.size}"
        " dtype=float32"
        f" block={implementation.block_size}"
        f" grid={grid}"
        f" num_warps={NUM_WARPS}"
        f" warmup={args.warmup}"
        f" repeat={args.repeat}"
        f" seed={args.seed}"
        f" timed=1 correct={status} precheck=OK postcheck={status}"
        f" min_ms={timing.minimum_ms:.6f}"
        f" median_ms={timing.median_ms:.6f}"
        f" mean_ms={timing.mean_ms:.6f}"
        f" effective_bandwidth_gbs={effective_bandwidth_gbs:.6f}"
        f" max_abs_error={validation.max_absolute_error:.9g}"
    )


def main() -> int:
    args = parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("PyTorch cannot see a ROCm GPU")

    print(
        "ENV"
        " runtime=triton"
        f' gpu="{torch.cuda.get_device_name(0)}"'
        f" torch={torch.__version__}"
        f" torch_hip={torch.version.hip}"
        f" triton={triton.__version__}"
    )

    host_a, host_b = make_host_inputs(args.size, args.seed)
    reference = host_a + host_b
    device_a = host_a.to(device="cuda")
    device_b = host_b.to(device="cuda")
    output = torch.empty_like(device_a)

    all_correct = True
    for implementation in selected_implementations(args.version, args.block):
        launch(implementation, device_a, device_b, output)
        torch.cuda.synchronize()
        precheck = validate(output, reference)
        if not precheck.correct:
            print_failed_result(implementation, precheck, args)
            all_correct = False
            continue

        timing = benchmark(
            implementation,
            device_a,
            device_b,
            output,
            warmup=args.warmup,
            repeat=args.repeat,
        )
        postcheck = validate(output, reference)
        print_result(implementation, timing, postcheck, args)
        all_correct = all_correct and postcheck.correct

    return 0 if all_correct else 1


if __name__ == "__main__":
    raise SystemExit(main())
