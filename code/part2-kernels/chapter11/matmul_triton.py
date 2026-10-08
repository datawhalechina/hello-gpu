"""Chapter 11 FP32 row-major matrix multiplication, Triton route.

Triton keeps BLOCK_K=32 and four warps; output tile and program grouping are
explicit configurations. The reference uses CPU FP64, rounded to FP32; the
optional PyTorch GPU implementation is a separate performance reference.
"""

from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path
import re
import statistics
from dataclasses import dataclass

import torch
import triton
import triton.language as tl


BLOCK_M = 32
BLOCK_N = 32
BLOCK_K = 32
NUM_WARPS = 4
ATOL = 1.0e-4
RTOL = 1.0e-4


@triton.jit
def matmul_kernel(
    a_ptr,
    b_ptr,
    c_ptr,
    m,
    n,
    k,
    BLOCK_SIZE_M: tl.constexpr,
    BLOCK_SIZE_N: tl.constexpr,
    BLOCK_SIZE_K: tl.constexpr,
    GROUP_SIZE_M: tl.constexpr,
):
    program_id = tl.program_id(axis=0)
    programs_m = tl.cdiv(m, BLOCK_SIZE_M)
    programs_n = tl.cdiv(n, BLOCK_SIZE_N)

    programs_per_group = GROUP_SIZE_M * programs_n
    group_id = program_id // programs_per_group
    first_program_m = group_id * GROUP_SIZE_M
    group_m = tl.minimum(programs_m - first_program_m, GROUP_SIZE_M)
    program_in_group = program_id % programs_per_group
    program_m = first_program_m + program_in_group % group_m
    program_n = program_in_group // group_m

    offsets_m = program_m * BLOCK_SIZE_M + tl.arange(0, BLOCK_SIZE_M)
    offsets_n = program_n * BLOCK_SIZE_N + tl.arange(0, BLOCK_SIZE_N)
    offsets_k = tl.arange(0, BLOCK_SIZE_K)
    a_pointers = a_ptr + offsets_m[:, None] * k + offsets_k[None, :]
    b_pointers = b_ptr + offsets_k[:, None] * n + offsets_n[None, :]
    accumulator = tl.zeros((BLOCK_SIZE_M, BLOCK_SIZE_N), dtype=tl.float32)

    for k_block in range(0, tl.cdiv(k, BLOCK_SIZE_K)):
        current_k = k_block * BLOCK_SIZE_K + offsets_k
        a = tl.load(
            a_pointers,
            mask=(offsets_m[:, None] < m) & (current_k[None, :] < k),
            other=0.0,
        )
        b = tl.load(
            b_pointers,
            mask=(current_k[:, None] < k) & (offsets_n[None, :] < n),
            other=0.0,
        )
        accumulator += tl.dot(a, b, input_precision="ieee")
        a_pointers += BLOCK_SIZE_K
        b_pointers += BLOCK_SIZE_K * n

    output_offsets = offsets_m[:, None] * n + offsets_n[None, :]
    output_mask = (offsets_m[:, None] < m) & (offsets_n[None, :] < n)
    tl.store(c_ptr + output_offsets, accumulator, mask=output_mask)


@dataclass(frozen=True)
class Implementation:
    name: str
    runtime: str
    group_m: int
    block_m: int = BLOCK_M
    block_n: int = BLOCK_N
    block_k: int = BLOCK_K
    num_warps: int = NUM_WARPS


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", choices=("all", "torch", "baseline", "grouped"), default="all")
    parser.add_argument("--m", type=int, default=512)
    parser.add_argument("--n", type=int, default=512)
    parser.add_argument("--k", type=int, default=512)
    parser.add_argument("--block-m", type=int, choices=(32, 64), default=32)
    parser.add_argument("--block-n", type=int, choices=(32, 64), default=32)
    parser.add_argument("--block-k", type=int, choices=(32,), default=32)
    parser.add_argument("--num-warps", type=int, choices=(4,), default=4)
    parser.add_argument("--group-m", type=int, choices=(1, 4, 8), default=None,
                        help="grouped version's row-group size; baseline stays at 1")
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--repeat", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260920)
    parser.add_argument("--samples", type=Path)
    parser.add_argument("--config-id", default="")
    parser.add_argument("--process", "--process-id", dest="process_id", type=int, default=1)
    args = parser.parse_args()
    if args.m <= 0 or args.n <= 0 or args.k <= 0:
        parser.error("--m/--n/--k must be positive")
    if (args.block_m, args.block_n) not in ((32, 32), (32, 64), (64, 32)):
        parser.error("supported output tiles are 32x32, 32x64, and 64x32")
    if args.version == "baseline" and args.group_m not in (None, 1):
        parser.error("baseline keeps group=1; select --version grouped for another group")
    if args.warmup < 0 or args.repeat <= 0 or args.process_id <= 0:
        parser.error("require non-negative warmup and positive repeat/process-id")
    if not 0 <= args.seed <= 0xFFFFFFFFFFFFFFFF:
        parser.error("--seed must be a uint64 value")
    if args.samples and args.version == "all":
        parser.error("--samples requires a single --version")
    if args.config_id and not re.fullmatch(r"[A-Za-z0-9_.-]+", args.config_id):
        parser.error("invalid config-id")
    return args


def selected_implementations(args: argparse.Namespace) -> list[Implementation]:
    options = dict(block_m=args.block_m, block_n=args.block_n,
                   block_k=args.block_k, num_warps=args.num_warps)
    implementations = {
        "torch": Implementation("torch-mm", "torch", 0),
        "baseline": Implementation("triton-baseline", "triton", 1, **options),
        "grouped": Implementation("triton-grouped", "triton",
                                   args.group_m if args.group_m is not None else 8, **options),
    }
    if args.version == "all":
        return [implementations[key] for key in ("torch", "baseline", "grouped")]
    return [implementations[args.version]]


def make_inputs(m: int, n: int, k: int, seed: int) -> tuple[torch.Tensor, torch.Tensor]:
    """Match HIP bit-for-bit; modular arithmetic cannot overflow with uint64 seed."""
    index_a = torch.arange(m * k, dtype=torch.int64)
    index_b = torch.arange(k * n, dtype=torch.int64)
    values_a = ((17 * (index_a % 257) + seed % 257) % 257) - 128
    values_b = ((29 * (index_b % 251) + 3 * (seed % 251)) % 251) - 125
    a = (values_a.to(torch.float32) / 128.0).reshape(m, k)
    b = (values_b.to(torch.float32) / 128.0).reshape(k, n)
    return a, b


def cpu_reference(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    return torch.mm(a.to(torch.float64), b.to(torch.float64)).to(torch.float32)


def launch(
    implementation: Implementation,
    a: torch.Tensor,
    b: torch.Tensor,
    output: torch.Tensor,
) -> None:
    if implementation.runtime == "torch":
        torch.mm(a, b, out=output)
        return

    m, k = a.shape
    _, n = b.shape
    grid = (triton.cdiv(m, implementation.block_m) * triton.cdiv(n, implementation.block_n),)
    matmul_kernel[grid](
        a,
        b,
        output,
        m,
        n,
        k,
        BLOCK_SIZE_M=implementation.block_m,
        BLOCK_SIZE_N=implementation.block_n,
        BLOCK_SIZE_K=implementation.block_k,
        GROUP_SIZE_M=implementation.group_m,
        num_warps=implementation.num_warps,
    )


def validate(output: torch.Tensor, reference: torch.Tensor) -> Validation:
    actual = output.detach().to(device="cpu", dtype=torch.float64)
    expected = reference.to(dtype=torch.float64)
    if not bool(torch.isfinite(actual).all()) or not bool(torch.isfinite(expected).all()):
        return Validation(False, math.inf, math.inf)
    difference = torch.abs(actual - expected)
    relative = difference / torch.clamp(torch.abs(expected), min=1.0e-6)
    acceptable = difference <= ATOL + RTOL * torch.abs(expected)
    return Validation(
        correct=bool(acceptable.all()),
        max_absolute_error=float(difference.amax().item()),
        max_relative_error=float(relative.amax().item()),
    )


def benchmark(
    implementation: Implementation,
    a: torch.Tensor,
    b: torch.Tensor,
    output: torch.Tensor,
    *,
    warmup: int,
    repeat: int,
) -> Timing:
    for _ in range(warmup):
        launch(implementation, a, b, output)
    torch.cuda.synchronize()

    starts = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    ends = [torch.cuda.Event(enable_timing=True) for _ in range(repeat)]
    for start, end in zip(starts, ends, strict=True):
        start.record()
        launch(implementation, a, b, output)
        end.record()
    torch.cuda.synchronize()
    times_ms = [
        start.elapsed_time(end) for start, end in zip(starts, ends, strict=True)
    ]
    return Timing(
        minimum_ms=min(times_ms),
        median_ms=statistics.median(times_ms),
        mean_ms=statistics.fmean(times_ms),
        samples=tuple(times_ms),
    )


def metadata(implementation: Implementation, args: argparse.Namespace) -> dict:
    is_triton = implementation.runtime == "triton"
    default_id = (f"{implementation.name}-b{implementation.block_m}x{implementation.block_n}"
                  f"-k{implementation.block_k}-g{implementation.group_m}-w{implementation.num_warps}"
                  if is_triton else "torch-mm-highest")
    return dict(
        config_id=args.config_id or default_id,
        implementation=implementation.name, runtime=implementation.runtime,
        shape=f"{args.m}x{args.n}x{args.k}", dtype="float32", m=args.m, n=args.n, k=args.k,
        tile="NA", block_m=implementation.block_m if is_triton else "NA",
        block_n=implementation.block_n if is_triton else "NA",
        block_k=implementation.block_k if is_triton else "NA",
        block_threads="NA", group_m=implementation.group_m if is_triton else "NA",
        num_warps=implementation.num_warps if is_triton else "NA",
        launches=1 if is_triton else "library-call",
        input="dyadic-modular-v1", input_precision="ieee" if is_triton else "highest",
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
    if timing is None:
        record.update(min_ms="NA", median_ms="NA", mean_ms="NA", tflops="NA")
    else:
        record.update(min_ms=f"{timing.minimum_ms:.9f}", median_ms=f"{timing.median_ms:.9f}",
                      mean_ms=f"{timing.mean_ms:.9f}",
                      tflops=f"{2.0 * args.m * args.n * args.k / (timing.median_ms * 1.0e9):.9f}")
    record.update(max_abs_error=f"{validation.max_absolute_error:.9g}",
                  max_rel_error=f"{validation.max_relative_error:.9g}")
    print("RESULT operator=matmul " + " ".join(f"{key}={value}" for key, value in record.items()))


def save_samples(implementation: Implementation, args: argparse.Namespace, timing: Timing) -> None:
    if args.samples is None:
        return
    record = metadata(implementation, args)
    with args.samples.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=[*record, "sample", "ms"])
        writer.writeheader()
        writer.writerows({**record, "sample": index, "ms": format(value, ".17g")}
                         for index, value in enumerate(timing.samples))


def run_implementation(
    implementation: Implementation,
    args: argparse.Namespace,
    a: torch.Tensor,
    b: torch.Tensor,
    reference: torch.Tensor,
) -> bool:
    output = torch.full((args.m, args.n), float("nan"), dtype=torch.float32, device="cuda")
    launch(implementation, a, b, output)
    torch.cuda.synchronize()
    precheck = validate(output, reference)
    if not precheck.correct:
        print_result(implementation, args, precheck, None, precheck="FAIL", postcheck="NA")
        return False
    timing = benchmark(implementation, a, b, output, warmup=args.warmup, repeat=args.repeat)
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

    torch.set_float32_matmul_precision("highest")
    torch.backends.cuda.matmul.allow_tf32 = False
    print(
        "ENV"
        " runtime=triton"
        f' gpu="{torch.cuda.get_device_name(0)}"'
        f" torch={torch.__version__}"
        f" torch_hip={torch.version.hip}"
        f" triton={triton.__version__}"
        f" m={args.m} n={args.n} k={args.k} seed={args.seed}"
        " input=dyadic-modular-v1 reference=cpu-fp64-to-fp32 dot_input_precision=ieee"
        " torch_matmul_precision=highest allow_tf32=0"
    )
    host_a, host_b = make_inputs(args.m, args.n, args.k, args.seed)
    reference = cpu_reference(host_a, host_b)
    a = host_a.to(device="cuda")
    b = host_b.to(device="cuda")

    all_correct = True
    for implementation in selected_implementations(args):
        all_correct = run_implementation(
            implementation, args, a, b, reference
        ) and all_correct
    return 0 if all_correct else 1


if __name__ == "__main__":
    raise SystemExit(main())
