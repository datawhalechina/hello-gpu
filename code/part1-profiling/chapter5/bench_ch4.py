"""第 5 章：PyTorch 向量加法与 Triton 复制的计时实验。

保留历史文件名 bench_ch4.py，便于已有入口继续调用。
A. 4096 × 4096 FP32 / FP16 向量加法：逐次计时，报告 min / median。
B. 单个数组 8 / 64 / 256 MiB 的 FP32 复制：整批计时，报告每次平均值。
默认预热 20 次、正式运行 200 次；分配、初始化、校验均在计时区间外。
运行：python chapter5/bench_ch4.py（先激活 part1-profiling 环境）
"""
import argparse
import os
import platform
import statistics
import sys
import sysconfig

import torch
import triton
import triton.language as tl


def bench_torch_vector_add(shape, dtype, repeats=200, warmup=20):
    x = torch.ones(shape, dtype=dtype, device="cuda")
    y = torch.full_like(x, 2.0)
    z = torch.empty_like(x)
    for _ in range(warmup):
        torch.add(x, y, out=z)
    torch.cuda.synchronize()
    check_add(z)

    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True)
    # Event 底层资源延迟创建；先记录一次，排除首次创建的影响。
    start.record()
    end.record()
    end.synchronize()
    times = []
    for _ in range(repeats):
        start.record()
        torch.add(x, y, out=z)
        end.record()
        end.synchronize()
        times.append(start.elapsed_time(end))
    check_add(z)

    min_ms = min(times)
    median_ms = statistics.median(times)
    bytes_moved = 3 * x.numel() * x.element_size()
    gbs = bytes_moved / (median_ms * 1e-3) / 1e9
    return min_ms, median_ms, gbs


def check_add(z):
    if not torch.all(torch.isfinite(z) & (z == 3.0)).item():
        raise RuntimeError("vector add validation failed: expected finite values equal to 3")


def python_header_path():
    include = sysconfig.get_path("include") or sysconfig.get_config_var("INCLUDEPY")
    return os.path.join(include, "Python.h") if include else ""


def ensure_triton_jit_build_env():
    header = python_header_path()
    if header and os.path.exists(header):
        return True
    py_minor = f"{sys.version_info.major}.{sys.version_info.minor}"
    print("Triton JIT blocked before measurement:")
    print(f"missing Python.h for Python {py_minor}")
    print(f"expected_header: {header or '<unknown>'}")
    print("fix_ubuntu:")
    print("  sudo apt update")
    print("  sudo apt install -y build-essential libstdc++-14-dev python3-dev")
    print(f"  # if you use a non-default Python minor, also install: python{py_minor}-dev")
    return False


@triton.jit
def copy_kernel(x_ptr, y_ptr, n, BLOCK: tl.constexpr):
    pid = tl.program_id(0)
    offs = pid * BLOCK + tl.arange(0, BLOCK)
    mask = offs < n
    tl.store(y_ptr + offs, tl.load(x_ptr + offs, mask=mask), mask=mask)


def bench_triton_copy(mib, repeats=200, warmup=20, block=1024):
    n = mib * 1024 * 1024 // 4  # 单个 FP32 数组的元素数
    x = torch.randn(n, dtype=torch.float32, device="cuda")
    y = torch.full_like(x, float("nan"))
    grid = ((n + block - 1) // block,)
    for _ in range(warmup):
        copy_kernel[grid](x, y, n, BLOCK=block)
    torch.cuda.synchronize()
    check_copy(x, y)

    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True)
    start.record()
    end.record()
    end.synchronize()
    start.record()
    for _ in range(repeats):
        copy_kernel[grid](x, y, n, BLOCK=block)
    end.record()
    end.synchronize()
    batch_avg_ms = start.elapsed_time(end) / repeats
    check_copy(x, y)
    bytes_moved = 2 * x.numel() * x.element_size()
    gbs = bytes_moved / (batch_avg_ms * 1e-3) / 1e9
    return batch_avg_ms, gbs


def check_copy(x, y):
    if not torch.isfinite(y).all().item() or not torch.equal(x, y):
        raise RuntimeError("copy validation failed: expected an exact finite copy")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--warmup", type=int, default=20)
    parser.add_argument("--repeats", type=int, default=200)
    args = parser.parse_args()
    if args.warmup < 1 or args.repeats < 1:
        parser.error("--warmup and --repeats must both be positive")
    torch.manual_seed(0)
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"torch: {torch.__version__}; HIP: {torch.version.hip}")
    print(f"Python: {platform.python_version()}; Triton: {triton.__version__}")
    print(f"warmup: {args.warmup}; repeats: {args.repeats}; seed: 0")

    print("\n--- A: PyTorch vector add (4096 x 4096, preallocated output) ---")
    print("dtype | min_ms | median_ms | GB/s_at_median | validation")
    for dtype, name in [(torch.float32, "fp32"), (torch.float16, "fp16")]:
        min_ms, median_ms, gbs = bench_torch_vector_add(
            (4096, 4096), dtype, args.repeats, args.warmup
        )
        print(f"{name} | {min_ms:.6f} | {median_ms:.6f} | {gbs:.3f} | PASS")

    print("\n--- B: Triton vector copy (FP32, BLOCK=1024) ---")
    print("array_MiB | pair_MiB | batch_avg_ms | GB/s_at_batch_avg | validation")
    if not ensure_triton_jit_build_env():
        raise SystemExit(2)
    for mib in [8, 64, 256]:
        ms, gbs = bench_triton_copy(mib, args.repeats, args.warmup)
        print(f"{mib} | {2 * mib} | {ms:.6f} | {gbs:.3f} | PASS")


if __name__ == "__main__":
    main()
