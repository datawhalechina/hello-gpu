"""Chapter 9: stable row-wise Softmax, one Triton program per row.

Performance numbers from this script belong in the tutorial only after a run
on the documented ROCm machine. The host code checks a PyTorch FP32 reference
before and after timing and prints machine-readable RESULT lines.
"""

from __future__ import annotations

import argparse
import statistics
from dataclasses import dataclass

import torch
import triton
import triton.language as tl


ABSOLUTE_TOLERANCE = 2.0e-5
ROW_SUM_TOLERANCE = 2.0e-5
MAX_BLOCK_SIZE = 65536


@triton.jit
def softmax_row_kernel(
    input_ptr,
    output_ptr,
    columns,
    input_row_stride,
    output_row_stride,
    BLOCK_SIZE: tl.constexpr,
):
    """Compute one complete row with a numerically stable Softmax."""
    row = tl.program_id(axis=0)
    offsets = tl.arange(0, BLOCK_SIZE)
    valid = offsets < columns

    logits = tl.load(
        input_ptr + row * input_row_stride + offsets,
        mask=valid,
        other=-float("inf"),
    )
    maximum = tl.max(logits, axis=0)
    numerator = tl.exp(logits - maximum)
    denominator = tl.sum(numerator, axis=0)
    probabilities = numerator / denominator
    tl.store(
        output_ptr + row * output_row_stride + offsets,
        probabilities,
        mask=valid,
    )


@dataclass(frozen=True)
class Implementation:
    name: str
    block_size: int
    num_warps: int


@dataclass(frozen=True)
class Validation:
    correct: bool
    max_absolute_error: float
    max_row_sum_error: float


@dataclass(frozen=True)
class Timing:
    minimum_ms: float
    median_ms: float
    mean_ms: float


def next_power_of_two(value: int) -> int:
    return 1 << (value - 1).bit_length()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=("all", "t0", "t1"), default="all")
    parser.add_argument("--rows", type=int, default=4096)
    parser.add_argument("--cols", type=int, default=1024)
    parser.add_argument("--t0-warps", type=int, default=4)
    parser.add_argument(
        "--t1-block",
        type=int,
        default=0,
        help="0 chooses twice t0's block when possible",
    )
    parser.add_argument("--t1-warps", type=int, default=8)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--repeat", type=int, default=50)
    parser.add_argument("--seed", type=int, default=20260719)
    args = parser.parse_args()

    if args.rows <= 0 or args.cols <= 0:
        parser.error("--rows and --cols must be positive")
    if args.cols > MAX_BLOCK_SIZE:
        parser.error(f"--cols must be at most {MAX_BLOCK_SIZE}")
    if args.t1_block < 0:
        parser.error("--t1-block must be zero or positive")
    if args.t1_block and args.t1_block & (args.t1_block - 1):
        parser.error("--t1-block must be a power of two")
    if args.t1_block and args.t1_block < args.cols:
        parser.error("--t1-block must cover --cols")
    if args.t1_block > MAX_BLOCK_SIZE:
        parser.error(f"--t1-block must be at most {MAX_BLOCK_SIZE}")
    if (
        args.t0_warps not in (1, 2, 4, 8)
        or args.t1_warps not in (1, 2, 4, 8)
    ):
        parser.error("warp counts must be one of 1, 2, 4, or 8")
    if args.warmup < 0 or args.repeat <= 0:
        parser.error("--warmup must be non-negative and --repeat positive")
    return args


def selected_implementations(args: argparse.Namespace) -> list[Implementation]:
    t0_block = next_power_of_two(args.cols)
    automatic_t1_block = min(t0_block * 2, MAX_BLOCK_SIZE)
    t1_block = args.t1_block or automatic_t1_block
    implementations = {
        "t0": Implementation("triton-t0-compact", t0_block, args.t0_warps),
        "t1": Implementation("triton-t1-wide", t1_block, args.t1_warps),
    }
    if args.version == "all":
        return [implementations["t0"], implementations["t1"]]
    return [implementations[args.version]]


def make_host_input(rows: int, columns: int, seed: int) -> torch.Tensor:
    """Match the HIP program's deterministic stability-stress input."""
    row_ids = torch.arange(rows, dtype=torch.int64).view(rows, 1)
    column_ids = torch.arange(columns, dtype=torch.int64).view(1, columns)
    mixed = column_ids * 17 + row_ids * 131 + seed
    centered = torch.remainder(mixed, 4096) - 2048
    shifts = torch.where(
        torch.remainder(row_ids, 3) == 0,
        torch.tensor(1000.0, dtype=torch.float32),
        torch.where(
            torch.remainder(row_ids, 3) == 1,
            torch.tensor(-1000.0, dtype=torch.float32),
            torch.tensor(0.0, dtype=torch.float32),
        ),
    )
    return centered.to(torch.float32) / 128.0 + shifts


def launch(
    implementation: Implementation,
    input_tensor: torch.Tensor,
    output_tensor: torch.Tensor,
) -> None:
    rows, columns = input_tensor.shape
    softmax_row_kernel[(rows,)](
        input_tensor,
        output_tensor,
        columns,
        input_tensor.stride(0),
        output_tensor.stride(0),
        BLOCK_SIZE=implementation.block_size,
        num_warps=implementation.num_warps,
    )


def validate(output: torch.Tensor, reference: torch.Tensor) -> Validation:
    actual = output.detach().to(device="cpu")
    difference = torch.abs(actual - reference)
    max_absolute_error = float(difference.amax().item())
    max_row_sum_error = float(
        torch.abs(actual.sum(dim=1) - 1.0).amax().item()
    )
    finite = bool(torch.isfinite(actual).all().item())
    return Validation(
        correct=(
            finite
            and max_absolute_error <= ABSOLUTE_TOLERANCE
            and max_row_sum_error <= ROW_SUM_TOLERANCE
        ),
        max_absolute_error=max_absolute_error,
        max_row_sum_error=max_row_sum_error,
    )


def benchmark(
    implementation: Implementation,
    input_tensor: torch.Tensor,
    output_tensor: torch.Tensor,
    *,
    warmup: int,
    repeat: int,
) -> Timing:
    for _ in range(warmup):
        launch(implementation, input_tensor, output_tensor)
    torch.cuda.synchronize()

    times_ms: list[float] = []
    for _ in range(repeat):
        start = torch.cuda.Event(enable_timing=True)
        end = torch.cuda.Event(enable_timing=True)
        start.record()
        launch(implementation, input_tensor, output_tensor)
        end.record()
        end.synchronize()
        times_ms.append(float(start.elapsed_time(end)))

    return Timing(
        minimum_ms=min(times_ms),
        median_ms=statistics.median(times_ms),
        mean_ms=statistics.fmean(times_ms),
    )


def print_result(
    implementation: Implementation,
    args: argparse.Namespace,
    validation: Validation,
    *,
    timing: Timing | None,
    precheck: str,
    postcheck: str,
) -> None:
    status = "OK" if validation.correct else "FAIL"
    timing_fields = (
        "min_ms=NA median_ms=NA mean_ms=NA"
        if timing is None
        else (
            f"min_ms={timing.minimum_ms:.6f} "
            f"median_ms={timing.median_ms:.6f} "
            f"mean_ms={timing.mean_ms:.6f}"
        )
    )
    print(
        "RESULT"
        " operator=softmax"
        f" implementation={implementation.name}"
        " runtime=triton"
        f" shape={args.rows}x{args.cols}"
        " dtype=float32"
        f" block={implementation.block_size}"
        f" num_warps={implementation.num_warps}"
        " programs_per_row=1"
        f" warmup={args.warmup}"
        f" repeat={args.repeat}"
        f" seed={args.seed}"
        " timing=gpu-event"
        f" timed={int(timing is not None)}"
        f" correct={status}"
        f" precheck={precheck}"
        f" postcheck={postcheck}"
        f" {timing_fields}"
        f" max_abs_error={validation.max_absolute_error:.9g}"
        f" max_row_sum_error={validation.max_row_sum_error:.9g}"
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

    host_input = make_host_input(args.rows, args.cols, args.seed)
    reference = torch.softmax(host_input, dim=1)
    device_input = host_input.to(device="cuda")
    output = torch.empty_like(device_input)

    all_correct = True
    for implementation in selected_implementations(args):
        launch(implementation, device_input, output)
        torch.cuda.synchronize()
        precheck = validate(output, reference)
        if not precheck.correct:
            print_result(
                implementation,
                args,
                precheck,
                timing=None,
                precheck="FAIL",
                postcheck="NA",
            )
            all_correct = False
            continue

        timing = benchmark(
            implementation,
            device_input,
            output,
            warmup=args.warmup,
            repeat=args.repeat,
        )
        postcheck = validate(output, reference)
        print_result(
            implementation,
            args,
            postcheck,
            timing=timing,
            precheck="OK",
            postcheck="OK" if postcheck.correct else "FAIL",
        )
        all_correct = all_correct and postcheck.correct

    return 0 if all_correct else 1


if __name__ == "__main__":
    raise SystemExit(main())
