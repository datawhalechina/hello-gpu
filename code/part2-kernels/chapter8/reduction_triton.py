"""Chapter 8 Sum Reduction: two-stage Triton teaching implementations."""

from __future__ import annotations

import argparse
import math
import statistics
from dataclasses import dataclass

import torch
import triton
import triton.language as tl


T0_MAX_PROGRAMS = 1024
NUM_WARPS = 4
TOLERANCE = 1.0e-3


@triton.jit
def program_partial_kernel(
    input_ptr,
    partial_ptr,
    size,
    num_programs,
    BLOCK_SIZE: tl.constexpr,
):
    """Each program accumulates grid-stride tiles, then writes one partial."""
    program_id = tl.program_id(axis=0)
    accumulator = tl.zeros((BLOCK_SIZE,), dtype=tl.float32)
    first = program_id * BLOCK_SIZE
    step = num_programs * BLOCK_SIZE
    for tile_start in tl.range(first, size, step):
        offsets = tile_start + tl.arange(0, BLOCK_SIZE)
        values = tl.load(input_ptr + offsets, mask=offsets < size, other=0.0)
        accumulator += values
    tl.store(partial_ptr + program_id, tl.sum(accumulator, axis=0))


@triton.jit
def second_reduction_kernel(
    partial_ptr,
    output_ptr,
    num_partials,
    BLOCK_SIZE: tl.constexpr,
):
    """One program combines the bounded partial buffer into the final scalar."""
    offsets = tl.arange(0, BLOCK_SIZE)
    values = tl.load(
        partial_ptr + offsets,
        mask=offsets < num_partials,
        other=0.0,
    )
    tl.store(output_ptr, tl.sum(values, axis=0))


@dataclass(frozen=True)
class Implementation:
    name: str
    max_programs: int


@dataclass(frozen=True)
class Timing:
    minimum_ms: float
    median_ms: float
    mean_ms: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Two-stage Triton Sum Reduction")
    parser.add_argument("--version", choices=("all", "t0", "t1"), default="all")
    parser.add_argument("--size", type=int, default=16 * 1024 * 1024)
    parser.add_argument("--block", type=int, default=1024)
    parser.add_argument(
        "--programs",
        type=int,
        default=256,
        help="maximum first-stage programs for t1",
    )
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--repeat", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260719)
    args = parser.parse_args()

    if args.size <= 0:
        parser.error("--size must be positive")
    if args.block <= 0 or args.block > 4096 or args.block & (args.block - 1):
        parser.error("--block must be a power of two in [1, 4096]")
    if args.programs <= 0 or args.programs > 4096:
        parser.error("--programs must be in [1, 4096]")
    if args.warmup < 0 or args.repeat <= 0:
        parser.error("--warmup must be non-negative and --repeat positive")
    return args


def selected_implementations(
    version: str, t1_max_programs: int
) -> list[Implementation]:
    t0 = Implementation("triton-t0", T0_MAX_PROGRAMS)
    t1 = Implementation("triton-t1-local", t1_max_programs)
    if version == "all":
        return [t0, t1]
    return [t0 if version == "t0" else t1]


def make_host_input(size: int, seed: int) -> torch.Tensor:
    """Alternating +/-1 keeps FP32 order differences exactly checkable here."""
    values = torch.empty(size, dtype=torch.float32, device="cpu")
    first = 1.0 if seed & 1 else -1.0
    values[0::2] = first
    values[1::2] = -first
    return values


def num_programs_for(
    implementation: Implementation, size: int, block_size: int
) -> int:
    return max(1, min(triton.cdiv(size, block_size), implementation.max_programs))


def launch(
    implementation: Implementation,
    input_tensor: torch.Tensor,
    partials: torch.Tensor,
    output: torch.Tensor,
    block_size: int,
) -> int:
    size = input_tensor.numel()
    num_programs = num_programs_for(implementation, size, block_size)
    program_partial_kernel[(num_programs,)](
        input_tensor,
        partials,
        size,
        num_programs,
        BLOCK_SIZE=block_size,
        num_warps=NUM_WARPS,
    )
    second_block = triton.next_power_of_2(num_programs)
    second_reduction_kernel[(1,)](
        partials,
        output,
        num_programs,
        BLOCK_SIZE=second_block,
        num_warps=NUM_WARPS,
    )
    return num_programs


def benchmark(
    implementation: Implementation,
    input_tensor: torch.Tensor,
    partials: torch.Tensor,
    output: torch.Tensor,
    *,
    block_size: int,
    warmup: int,
    repeat: int,
) -> Timing:
    for _ in range(warmup):
        launch(implementation, input_tensor, partials, output, block_size)
    torch.cuda.synchronize()

    starts = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    ends = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    for start, end in zip(starts, ends, strict=True):
        start.record()
        launch(implementation, input_tensor, partials, output, block_size)
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


def run_one(
    implementation: Implementation,
    input_tensor: torch.Tensor,
    partials: torch.Tensor,
    output: torch.Tensor,
    reference: float,
    args: argparse.Namespace,
) -> bool:
    output.fill_(math.nan)
    num_programs = launch(
        implementation, input_tensor, partials, output, args.block
    )
    torch.cuda.synchronize()
    actual = float(output.item())
    pre_error = abs(actual - reference)
    if not math.isfinite(actual) or pre_error > TOLERANCE:
        print(
            "RESULT"
            " operator=sum-reduction"
            f" implementation={implementation.name}"
            " runtime=triton"
            f" shape={args.size}"
            " dtype=float32"
            f" block={args.block}"
            f" grid={num_programs}"
            f" partials={num_programs}"
            " stages=2"
            f" num_warps={NUM_WARPS}"
            f" warmup={args.warmup}"
            f" repeat={args.repeat}"
            f" seed={args.seed}"
            " timed=0 correct=FAIL precheck=FAIL postcheck=NA"
            " min_ms=NA median_ms=NA mean_ms=NA"
            " logical_bandwidth_gbs=NA"
            f" result={actual:.9g} reference={reference:.17g}"
            f" max_abs_error={pre_error:.9g} tolerance={TOLERANCE:.9g}"
        )
        return False

    timing = benchmark(
        implementation,
        input_tensor,
        partials,
        output,
        block_size=args.block,
        warmup=args.warmup,
        repeat=args.repeat,
    )
    actual = float(output.item())
    post_error = abs(actual - reference)
    correct = math.isfinite(actual) and post_error <= TOLERANCE
    logical_bytes = args.size * torch.tensor([], dtype=torch.float32).element_size()
    logical_bytes += torch.tensor([], dtype=torch.float32).element_size()
    bandwidth_gbs = logical_bytes / (timing.median_ms * 1.0e-3) / 1.0e9
    status = "OK" if correct else "FAIL"
    print(
        "RESULT"
        " operator=sum-reduction"
        f" implementation={implementation.name}"
        " runtime=triton"
        f" shape={args.size}"
        " dtype=float32"
        f" block={args.block}"
        f" grid={num_programs}"
        f" partials={num_programs}"
        " stages=2"
        f" num_warps={NUM_WARPS}"
        f" warmup={args.warmup}"
        f" repeat={args.repeat}"
        f" seed={args.seed}"
        f" timed=1 correct={status} precheck=OK postcheck={status}"
        f" min_ms={timing.minimum_ms:.6f}"
        f" median_ms={timing.median_ms:.6f}"
        f" mean_ms={timing.mean_ms:.6f}"
        f" logical_bandwidth_gbs={bandwidth_gbs:.6f}"
        f" result={actual:.9g} reference={reference:.17g}"
        f" max_abs_error={post_error:.9g} tolerance={TOLERANCE:.9g}"
    )
    return correct


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

    host_input = make_host_input(args.size, args.seed)
    reference = float(host_input.sum(dtype=torch.float64).item())
    input_tensor = host_input.to(device="cuda")
    largest_partial_count = min(
        triton.cdiv(args.size, args.block),
        max(T0_MAX_PROGRAMS, args.programs),
    )
    partials = torch.empty(largest_partial_count, device="cuda", dtype=torch.float32)
    output = torch.empty(1, device="cuda", dtype=torch.float32)

    all_correct = True
    for implementation in selected_implementations(args.version, args.programs):
        all_correct = (
            run_one(
                implementation,
                input_tensor,
                partials,
                output,
                reference,
                args,
            )
            and all_correct
        )
    return 0 if all_correct else 1


if __name__ == "__main__":
    raise SystemExit(main())
