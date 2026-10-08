"""Chapter 13 RMSNorm: row-wise baseline and grouped-row configurations.

The two legacy versions keep one row per program (t0: four warps, t1: eight).
Configured launches expose a fixed logical column width and one/two/four rows.
"""

from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path
import re
import statistics
import struct
from dataclasses import dataclass

import torch
import triton
import triton.language as tl

ATOL = 2.0e-5
RTOL = 2.0e-5


@triton.jit
def rmsnorm_kernel(input_ptr, weight_ptr, output_ptr, cols, epsilon,
                   BLOCK_SIZE: tl.constexpr):
    row = tl.program_id(0).to(tl.int64)
    offsets = tl.arange(0, BLOCK_SIZE)
    mask = offsets < cols
    values = tl.load(input_ptr + row * cols + offsets, mask=mask, other=0.0)
    mean_square = tl.sum(values * values, axis=0) / cols
    inverse_rms = tl.rsqrt(mean_square + epsilon)
    weights = tl.load(weight_ptr + offsets, mask=mask, other=0.0)
    tl.store(output_ptr + row * cols + offsets,
             values * inverse_rms * weights, mask=mask)


@triton.jit
def rmsnorm_rows_kernel(input_ptr, weight_ptr, output_ptr, rows, cols, epsilon,
                        BLOCK_SIZE: tl.constexpr, ROWS_PER_PROGRAM: tl.constexpr):
    row = (tl.program_id(0).to(tl.int64) * ROWS_PER_PROGRAM +
           tl.arange(0, ROWS_PER_PROGRAM))
    column = tl.arange(0, BLOCK_SIZE)
    offsets = row[:, None] * cols + column[None, :]
    mask = (row[:, None] < rows) & (column[None, :] < cols)
    values = tl.load(input_ptr + offsets, mask=mask, other=0.0)
    # Each row keeps its own statistic; only the column axis is reduced.
    mean_square = tl.sum(values * values, axis=1) / cols
    inverse_rms = tl.rsqrt(mean_square + epsilon)
    weights = tl.load(weight_ptr + column, mask=column < cols, other=0.0)
    result = values * inverse_rms[:, None] * weights[None, :]
    tl.store(output_ptr + offsets, result, mask=mask)


@dataclass(frozen=True)
class Implementation:
    version: str
    num_warps: int
    rows_per_program: int = 1


@dataclass(frozen=True)
class Timing:
    minimum_ms: float
    median_ms: float
    mean_ms: float
    samples: tuple[float, ...]


@dataclass(frozen=True)
class Validation:
    correct: bool
    max_absolute_error: float
    max_relative_error: float


def unsigned_value(value: str) -> int:
    if not re.fullmatch(r"[0-9]+", value):
        raise argparse.ArgumentTypeError("expected a non-negative integer")
    return int(value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=("all", "t0", "t1", "configured"), default="all")
    parser.add_argument("--rows", type=unsigned_value, default=1024)
    parser.add_argument("--cols", type=unsigned_value, default=4096)
    parser.add_argument("--epsilon", type=float, default=1e-5)
    parser.add_argument("--warmup", type=unsigned_value, default=5)
    parser.add_argument("--repeat", type=unsigned_value, default=20)
    parser.add_argument("--seed", type=unsigned_value, default=20260920)
    parser.add_argument("--input", dest="input_mode",
                        choices=("normal", "zero", "zero-weight", "signed-weight"), default="normal")
    parser.add_argument("--num-warps", type=int, choices=(4, 8))
    parser.add_argument("--rows-per-program", type=int, choices=(1, 2, 4), default=1)
    parser.add_argument("--samples", type=Path)
    parser.add_argument("--config-id", default="")
    parser.add_argument("--process-id", "--process", dest="process_id", type=unsigned_value, default=1)
    args = parser.parse_args()
    if not 0 < args.rows <= 2**31 - 1 or not 0 < args.cols <= 65536:
        parser.error("rows must be in [1, 2^31-1] and cols in [1, 65536]")
    if not 0 < args.repeat <= 2**31 - 1 or not 0 <= args.warmup <= 2**31 - 1:
        parser.error("repeat must be positive and warmup non-negative, within int32")
    if args.seed > 2**64 - 1 or not 0 < args.process_id <= 2**31 - 1:
        parser.error("seed must fit uint64 and process-id must fit positive int32")
    try:
        args.epsilon = struct.unpack("f", struct.pack("f", args.epsilon))[0]
    except (OverflowError, struct.error):
        parser.error("epsilon must fit float32")
    if not math.isfinite(args.epsilon) or args.epsilon <= 0:
        parser.error("epsilon must be finite and positive after float32 rounding")
    if args.samples is not None and args.version == "all":
        parser.error("--samples requires a single --version")
    if not re.fullmatch(r"[A-Za-z0-9_.-]*", args.config_id):
        parser.error("config-id must contain only letters, digits, '-', '_' or '.'")
    if args.version != "configured":
        if args.rows_per_program != 1:
            parser.error("multiple rows per program require --version configured")
        expected = {"t0": 4, "t1": 8}.get(args.version)
        if args.num_warps is not None and args.num_warps != expected:
            parser.error("legacy t0/t1 have fixed warps; use --version configured")
    elif args.rows_per_program > 1 and args.num_warps not in (None, 4):
        parser.error("the grouped-row comparison fixes num-warps=4")
    return args


def selected_implementations(args: argparse.Namespace) -> list[Implementation]:
    if args.version == "configured":
        return [Implementation("configured", args.num_warps or 4, args.rows_per_program)]
    versions = [Implementation("t0", 4), Implementation("t1", 8)]
    return [item for item in versions if args.version in ("all", item.version)]


def make_inputs(rows: int, cols: int, seed: int, input_mode: str) -> tuple[torch.Tensor, torch.Tensor]:
    indices = torch.arange(rows * cols, dtype=torch.int64, device="cpu")
    values = ((17 * (indices % 257) + seed % 257) % 257 - 128).to(torch.float32) / 128.0
    columns = torch.arange(cols, dtype=torch.int64, device="cpu")
    weight = ((29 * (columns % 251) + 3 * (seed % 251)) % 251 - 125).to(torch.float32) / 128.0
    if input_mode == "zero":
        values.zero_()
    elif input_mode == "zero-weight":
        weight.zero_()
    elif input_mode == "signed-weight":
        signs = torch.where(columns % 2 == 0, -1.0, 1.0)
        weight = signs * (0.5 + (columns % 9).to(torch.float32) / 16.0)
    return values.reshape(rows, cols), weight


def reference_rmsnorm(input_tensor: torch.Tensor, weight: torch.Tensor, epsilon: float) -> torch.Tensor:
    values = input_tensor.to(device="cpu", dtype=torch.float64)
    weights = weight.to(device="cpu", dtype=torch.float64)
    inverse_rms = 1.0 / torch.sqrt(values.square().sum(dim=1, keepdim=True) / values.shape[1] + epsilon)
    return (values * inverse_rms * weights).to(torch.float32)


def launch(input_tensor: torch.Tensor, weight: torch.Tensor, output: torch.Tensor,
           epsilon: float, num_warps: int, rows_per_program: int = 1) -> None:
    rows, cols = input_tensor.shape
    block_size = triton.next_power_of_2(cols)
    if not 0 < cols <= 65536:
        raise ValueError("this teaching kernel supports cols in [1, 65536]")
    if rows_per_program not in (1, 2, 4) or num_warps not in (4, 8):
        raise ValueError("unsupported rows-per-program or num-warps")
    if rows_per_program > 1 and num_warps != 4:
        raise ValueError("the grouped-row comparison fixes num-warps=4")
    if rows_per_program == 1:
        rmsnorm_kernel[(rows,)](input_tensor, weight, output, cols, epsilon,
                               BLOCK_SIZE=block_size, num_warps=num_warps)
    else:
        rmsnorm_rows_kernel[(triton.cdiv(rows, rows_per_program),)](
            input_tensor, weight, output, rows, cols, epsilon,
            BLOCK_SIZE=block_size, ROWS_PER_PROGRAM=rows_per_program, num_warps=num_warps)


def validate(output: torch.Tensor, reference: torch.Tensor) -> Validation:
    actual = output.detach().to(device="cpu", dtype=torch.float64)
    expected = reference.to(dtype=torch.float64)
    if not bool(torch.isfinite(actual).all()) or not bool(torch.isfinite(expected).all()):
        return Validation(False, math.inf, math.inf)
    difference = torch.abs(actual - expected)
    acceptable = difference <= ATOL + RTOL * torch.abs(expected)
    relative = difference / torch.clamp(torch.abs(expected), min=1e-6)
    return Validation(bool(acceptable.all()), float(difference.amax().item()), float(relative.amax().item()))


def time_launch(input_tensor: torch.Tensor, weight: torch.Tensor, output: torch.Tensor,
                epsilon: float, num_warps: int, warmup: int, repeat: int,
                rows_per_program: int = 1) -> Timing:
    for _ in range(warmup):
        launch(input_tensor, weight, output, epsilon, num_warps, rows_per_program)
    torch.cuda.synchronize()
    starts = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    stops = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    times_ms = []
    for start, stop in zip(starts, stops, strict=True):
        start.record()
        launch(input_tensor, weight, output, epsilon, num_warps, rows_per_program)
        stop.record()
        stop.synchronize()
        times_ms.append(start.elapsed_time(stop))
    return Timing(min(times_ms), statistics.median(times_ms), statistics.fmean(times_ms), tuple(times_ms))


def metadata(implementation: Implementation, args: argparse.Namespace) -> dict:
    return dict(
        config_id=args.config_id or f"triton-{implementation.version}-r{implementation.rows_per_program}"
        f"-w{implementation.num_warps}",
        implementation=f"triton-{implementation.version}", runtime="triton",
        shape=f"{args.rows}x{args.cols}", dtype="float32", rows=args.rows, cols=args.cols,
        epsilon=args.epsilon, block="NA", block_threads="NA", block_size=triton.next_power_of_2(args.cols),
        rows_per_program=implementation.rows_per_program, num_warps=implementation.num_warps,
        grid=triton.cdiv(args.rows, implementation.rows_per_program), launches=1,
        input="rmsnorm-dyadic-v1", input_mode=args.input_mode, input_precision="fp32",
        reference="cpu-fp64-to-fp32", atol=ATOL, rtol=RTOL, seed=args.seed,
        warmup=args.warmup, repeat=args.repeat, process=args.process_id, process_id=args.process_id,
        scope="gpu-event-full-operator",
    )


def print_result(implementation: Implementation, args: argparse.Namespace,
                 validation: Validation, timing: Timing | None,
                 *, precheck: str, postcheck: str) -> None:
    record = metadata(implementation, args)
    record.update(timed=int(timing is not None), correct="OK" if validation.correct else "FAIL",
                  precheck=precheck, postcheck=postcheck)
    record.update(min_ms="NA" if timing is None else format(timing.minimum_ms, ".17g"),
                  median_ms="NA" if timing is None else format(timing.median_ms, ".17g"),
                  mean_ms="NA" if timing is None else format(timing.mean_ms, ".17g"),
                  max_abs_error=format(validation.max_absolute_error, ".9g"),
                  max_rel_error=format(validation.max_relative_error, ".9g"))
    print("RESULT operator=rmsnorm " + " ".join(f"{key}={value}" for key, value in record.items()))


def save_samples(implementation: Implementation, args: argparse.Namespace, timing: Timing) -> None:
    if args.samples is None:
        return
    record = metadata(implementation, args)
    with args.samples.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=[*record, "sample", "ms"])
        writer.writeheader()
        writer.writerows({**record, "sample": index, "ms": format(value, ".17g")}
                         for index, value in enumerate(timing.samples))


def run_implementation(implementation: Implementation, args: argparse.Namespace,
                       input_tensor: torch.Tensor, weight: torch.Tensor,
                       reference: torch.Tensor) -> bool:
    output = torch.full_like(input_tensor, float("nan"))
    launch(input_tensor, weight, output, args.epsilon, implementation.num_warps,
           implementation.rows_per_program)
    torch.cuda.synchronize()
    precheck = validate(output, reference)
    if not precheck.correct:
        print_result(implementation, args, precheck, None, precheck="FAIL", postcheck="NA")
        return False
    timing = time_launch(input_tensor, weight, output, args.epsilon, implementation.num_warps,
                         args.warmup, args.repeat, implementation.rows_per_program)
    postcheck = validate(output, reference)
    print_result(implementation, args, postcheck, timing,
                 precheck="OK", postcheck="OK" if postcheck.correct else "FAIL")
    if postcheck.correct:
        save_samples(implementation, args, timing)
    return postcheck.correct


def main() -> int:
    args = parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("PyTorch cannot see a ROCm GPU")
    print(f'ENV runtime=triton gpu="{torch.cuda.get_device_name(0)}" '
          f"torch={torch.__version__} torch_hip={torch.version.hip} triton={triton.__version__} "
          "input=rmsnorm-dyadic-v1 reference=cpu-fp64-to-fp32 timing=per-sample-event-sync")
    host_input, host_weight = make_inputs(args.rows, args.cols, args.seed, args.input_mode)
    reference = reference_rmsnorm(host_input, host_weight, args.epsilon)
    input_tensor, weight = host_input.to(device="cuda"), host_weight.to(device="cuda")
    all_correct = True
    for implementation in selected_implementations(args):
        all_correct = run_implementation(implementation, args, input_tensor, weight, reference) and all_correct
    return 0 if all_correct else 1


if __name__ == "__main__":
    raise SystemExit(main())
