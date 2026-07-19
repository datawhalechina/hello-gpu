"""Chapter 10 FP32 row-major matrix multiplication, Triton route.

The Triton baseline and grouped variants use the same tl.dot kernel. Only the
program ordering changes: baseline uses GROUP_M=1; grouped uses GROUP_M=8.
PyTorch provides the GPU reference and a separately timed library baseline.
"""

from __future__ import annotations

import argparse
import statistics
from dataclasses import dataclass

import torch
import triton
import triton.language as tl


BLOCK_M = 32
BLOCK_N = 32
BLOCK_K = 32
NUM_WARPS = 4
ATOL = 1.0e-2
RTOL = 1.0e-2


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
        accumulator += tl.dot(a, b)
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


@dataclass(frozen=True)
class Timing:
    minimum_ms: float
    median_ms: float
    mean_ms: float


@dataclass(frozen=True)
class Validation:
    correct: bool
    max_absolute_error: float
    max_relative_error: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--version",
        choices=("all", "torch", "baseline", "grouped"),
        default="all",
    )
    parser.add_argument("--m", type=int, default=512)
    parser.add_argument("--n", type=int, default=512)
    parser.add_argument("--k", type=int, default=512)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--repeat", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260719)
    args = parser.parse_args()
    if args.m <= 0 or args.n <= 0 or args.k <= 0:
        parser.error("--m/--n/--k must be positive")
    if args.warmup < 0 or args.repeat <= 0:
        parser.error("--warmup must be non-negative and --repeat positive")
    return args


def selected_implementations(version: str) -> list[Implementation]:
    implementations = {
        "torch": Implementation("torch-mm", "torch", 0),
        "baseline": Implementation("triton-baseline", "triton", 1),
        "grouped": Implementation("triton-grouped", "triton", 8),
    }
    if version == "all":
        return [
            implementations["torch"],
            implementations["baseline"],
            implementations["grouped"],
        ]
    return [implementations[version]]


def make_inputs(m: int, n: int, k: int, seed: int) -> tuple[torch.Tensor, torch.Tensor]:
    generator = torch.Generator(device="cpu")
    generator.manual_seed(seed)
    a = torch.rand((m, k), generator=generator, dtype=torch.float32) * 2.0 - 1.0
    b = torch.rand((k, n), generator=generator, dtype=torch.float32) * 2.0 - 1.0
    return a, b


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
    grid = (triton.cdiv(m, BLOCK_M) * triton.cdiv(n, BLOCK_N),)
    matmul_kernel[grid](
        a,
        b,
        output,
        m,
        n,
        k,
        BLOCK_SIZE_M=BLOCK_M,
        BLOCK_SIZE_N=BLOCK_N,
        BLOCK_SIZE_K=BLOCK_K,
        GROUP_SIZE_M=implementation.group_m,
        num_warps=NUM_WARPS,
    )


def validate(output: torch.Tensor, reference: torch.Tensor) -> Validation:
    difference = torch.abs(output - reference)
    relative = difference / torch.clamp(torch.abs(reference), min=1.0e-6)
    return Validation(
        correct=bool(torch.allclose(output, reference, atol=ATOL, rtol=RTOL)),
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
    )


def run_implementation(
    implementation: Implementation,
    args: argparse.Namespace,
    a: torch.Tensor,
    b: torch.Tensor,
    reference: torch.Tensor,
) -> bool:
    output = torch.empty((args.m, args.n), dtype=torch.float32, device="cuda")
    launch(implementation, a, b, output)
    torch.cuda.synchronize()
    precheck = validate(output, reference)
    if not precheck.correct:
        print(
            "RESULT"
            f" implementation={implementation.name}"
            f" runtime={implementation.runtime}"
            f" m={args.m} n={args.n} k={args.k}"
            f" block_m={BLOCK_M if implementation.runtime == 'triton' else 'NA'}"
            f" block_n={BLOCK_N if implementation.runtime == 'triton' else 'NA'}"
            f" block_k={BLOCK_K if implementation.runtime == 'triton' else 'NA'}"
            f" group_m={implementation.group_m if implementation.runtime == 'triton' else 'NA'}"
            " timed=0 correct=FAIL min_ms=NA median_ms=NA mean_ms=NA tflops=NA"
            f" max_abs_error={precheck.max_absolute_error:.9g}"
            f" max_rel_error={precheck.max_relative_error:.9g}"
        )
        return False

    timing = benchmark(
        implementation,
        a,
        b,
        output,
        warmup=args.warmup,
        repeat=args.repeat,
    )
    postcheck = validate(output, reference)
    operations = 2.0 * args.m * args.n * args.k
    tflops = operations / (timing.median_ms * 1.0e-3) / 1.0e12
    print(
        "RESULT"
        f" implementation={implementation.name}"
        f" runtime={implementation.runtime}"
        f" m={args.m} n={args.n} k={args.k}"
        f" block_m={BLOCK_M if implementation.runtime == 'triton' else 'NA'}"
        f" block_n={BLOCK_N if implementation.runtime == 'triton' else 'NA'}"
        f" block_k={BLOCK_K if implementation.runtime == 'triton' else 'NA'}"
        f" group_m={implementation.group_m if implementation.runtime == 'triton' else 'NA'}"
        f" warmup={args.warmup} repeat={args.repeat} timed=1"
        f" correct={'OK' if postcheck.correct else 'FAIL'}"
        f" min_ms={timing.minimum_ms:.6f}"
        f" median_ms={timing.median_ms:.6f}"
        f" mean_ms={timing.mean_ms:.6f}"
        f" tflops={tflops:.6f}"
        f" max_abs_error={postcheck.max_absolute_error:.9g}"
        f" max_rel_error={postcheck.max_relative_error:.9g}"
    )
    return postcheck.correct


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
        f" m={args.m} n={args.n} k={args.k} seed={args.seed}"
    )
    host_a, host_b = make_inputs(args.m, args.n, args.k, args.seed)
    a = host_a.to(device="cuda")
    b = host_b.to(device="cuda")
    reference = torch.mm(a, b)
    torch.cuda.synchronize()

    all_correct = True
    for implementation in selected_implementations(args.version):
        all_correct = run_implementation(
            implementation, args, a, b, reference
        ) and all_correct
    return 0 if all_correct else 1


if __name__ == "__main__":
    raise SystemExit(main())
