"""Ch4 §4.4 benchmark 骨架实测：PyTorch vector add + Triton vector copy。

跑两组：
  A. PyTorch vector add（4096² fp32 / fp16）— 测延迟和有效带宽
  B. Triton vector copy（8 / 64 / 256 MiB pair）— 测不同 footprint 的带宽

硬件上下文：Radeon RX 9070 XT（gfx1201）+ ROCm 7.13（原生 Ubuntu 24.04）
用法：python bench_ch4.py
"""
import statistics
import os
import sys
import sysconfig

import torch
import triton
import triton.language as tl


# ---------- 骨架 A：PyTorch vector add ----------
def bench_torch_vector_add(shape, dtype, repeats=200, warmup=20):
    x = torch.randn(*shape, dtype=dtype, device="cuda")
    y = torch.randn(*shape, dtype=dtype, device="cuda")
    for _ in range(warmup):
        z = x + y
    torch.cuda.synchronize()
    starts = [torch.cuda.Event(enable_timing=True) for _ in range(repeats)]
    ends = [torch.cuda.Event(enable_timing=True) for _ in range(repeats)]
    for i in range(repeats):
        starts[i].record()
        z = x + y
        ends[i].record()
    torch.cuda.synchronize()
    times = [s.elapsed_time(e) for s, e in zip(starts, ends)]
    min_ms = min(times)
    median_ms = statistics.median(times)
    # vector add: 读 x + 读 y + 写 z = 3 * elements * dtype_size
    elem = shape[0] * shape[1]
    dt_bytes = 2 if dtype == torch.float16 else 4
    bytes_moved = 3 * elem * dt_bytes
    gbs = bytes_moved / (min_ms / 1e3) / 1e9
    return min_ms, median_ms, gbs


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


# ---------- 骨架 B：Triton vector copy ----------
@triton.jit
def copy_kernel(x_ptr, y_ptr, n, BLOCK: tl.constexpr):
    pid = tl.program_id(0)
    offs = pid * BLOCK + tl.arange(0, BLOCK)
    mask = offs < n
    tl.store(y_ptr + offs, tl.load(x_ptr + offs, mask=mask), mask=mask)


def bench_triton_copy(mib, repeats=200, warmup=20, block=1024):
    n = mib * 1024 * 1024 // 4  # float32
    x = torch.empty(n, dtype=torch.float32, device="cuda")
    y = torch.empty_like(x)
    grid = ((n + block - 1) // block,)
    for _ in range(warmup):
        copy_kernel[grid](x, y, n, BLOCK=block)
    torch.cuda.synchronize()
    s = torch.cuda.Event(enable_timing=True)
    e = torch.cuda.Event(enable_timing=True)
    s.record()
    for _ in range(repeats):
        copy_kernel[grid](x, y, n, BLOCK=block)
    e.record()
    torch.cuda.synchronize()
    ms = s.elapsed_time(e) / repeats
    # copy: 读 x + 写 y = 2 * mib MiB
    gbs = (2 * mib) / ms  # MiB/ms ≈ GB/s
    return ms, gbs


def main():
    print("=" * 60)
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"torch: {torch.__version__}")
    print("=" * 60)

    print("\n--- 骨架 A：PyTorch vector add (4096×4096) ---")
    print(f"{'dtype':>6} | {'min_ms':>9} | {'median_ms':>10} | {'GB/s':>8}")
    print("-" * 44)
    for dt in [torch.float32, torch.float16]:
        name = {torch.float32: "fp32", torch.float16: "fp16"}[dt]
        min_ms, med_ms, gbs = bench_torch_vector_add((4096, 4096), dt)
        print(f"{name:>6} | {min_ms:>7.3f} ms | {med_ms:>8.3f} ms | {gbs:>7.1f}")

    print("\n--- 骨架 B：Triton vector copy (float32) ---")
    print(f"{'footprint':>12} | {'avg_ms':>9} | {'GB/s':>8}")
    print("-" * 36)
    if not ensure_triton_jit_build_env():
        raise SystemExit(2)
    for mib in [8, 64, 256]:
        ms, gbs = bench_triton_copy(mib)
        print(f"{mib:>9} MiB | {ms:>7.3f} ms | {gbs:>7.1f}")


if __name__ == "__main__":
    main()
