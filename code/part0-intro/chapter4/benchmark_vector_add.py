import argparse
import platform
import statistics
import time
from pathlib import Path

import torch


def parse_args():
    parser = argparse.ArgumentParser(description="Benchmark torch vector add on CPU and ROCm GPU.")
    parser.add_argument("--size", type=int, default=1 << 24)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--repeat", type=int, default=30)
    parser.add_argument("--cpu-threads", type=int, default=1)
    args = parser.parse_args()
    for name in ("size", "repeat", "cpu_threads"):
        if getattr(args, name) <= 0:
            parser.error(f"--{name.replace('_', '-')} must be greater than 0")
    if args.warmup < 0:
        parser.error("--warmup must be at least 0")
    return args


def cpu_name():
    cpuinfo = Path("/proc/cpuinfo")
    if cpuinfo.exists():
        for line in cpuinfo.read_text().splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    return platform.processor() or platform.machine()


def validate_output(c):
    # 验证放在计时外：每个元素都必须有限，并且等于 1 + 2 = 3。
    if not (torch.isfinite(c) & (c == 3.0)).all().item():
        raise RuntimeError(f"{c.device} vector add validation failed")


def benchmark_cpu(size, warmup, repeat):
    a = torch.ones(size, dtype=torch.float32)
    b = torch.full((size,), 2.0, dtype=torch.float32)
    c = torch.empty_like(a)

    for _ in range(warmup):
        torch.add(a, b, out=c)

    times = []
    for _ in range(repeat):
        start = time.perf_counter()
        torch.add(a, b, out=c)
        end = time.perf_counter()
        times.append((end - start) * 1000)
    validate_output(c)
    return times


def benchmark_gpu(size, warmup, repeat):
    a = torch.ones(size, device="cuda", dtype=torch.float32)
    b = torch.full((size,), 2.0, device="cuda", dtype=torch.float32)
    c = torch.empty_like(a)

    # Event 会延迟初始化；提前记录一次，避免首次初始化进入测量。
    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True)
    start.record()
    end.record()
    end.synchronize()

    for _ in range(warmup):
        torch.add(a, b, out=c)
    torch.cuda.synchronize()

    times = []
    for _ in range(repeat):
        start.record()
        torch.add(a, b, out=c)
        end.record()
        end.synchronize()
        times.append(start.elapsed_time(end))
    validate_output(c)
    return times


def summarize(name, times, size):
    mean_ms = statistics.mean(times)
    median_ms = statistics.median(times)
    min_ms = min(times)
    bytes_moved = size * 3 * 4
    # 12N 是算法的有效字节数，不是硬件计数器测出的显存流量。
    bandwidth_by_median = bytes_moved / (median_ms / 1000) / 1e9
    bandwidth_by_min = bytes_moved / (min_ms / 1000) / 1e9

    print(f"{name}_mean_ms: {mean_ms:.6f}")
    print(f"{name}_median_ms: {median_ms:.6f}")
    print(f"{name}_min_ms: {min_ms:.6f}")
    print(f"{name}_bandwidth_gb_s_by_median: {bandwidth_by_median:.6f}")
    print(f"{name}_bandwidth_gb_s_by_min: {bandwidth_by_min:.6f}")


def main():
    args = parse_args()
    if not torch.cuda.is_available() or torch.version.hip is None:
        raise SystemExit("PyTorch ROCm backend is not available")
    torch.set_num_threads(args.cpu_threads)
    print(f"torch: {torch.__version__}")
    print(f"hip: {torch.version.hip}")
    print(f"cuda_available: {torch.cuda.is_available()}")
    print(f"device_name: {torch.cuda.get_device_name(0)}")
    print(f"cpu_name: {cpu_name()}")
    print(f"cpu_threads: {torch.get_num_threads()}")
    print("dtype: float32")
    print(f"vector_size: {args.size}")
    print(f"warmup: {args.warmup}")
    print(f"repeat: {args.repeat}")
    print("cpu_timing: wall clock around torch.add(a, b, out=c)")
    print("gpu_timing: device event interval; not end-to-end latency")

    cpu_times = benchmark_cpu(args.size, args.warmup, args.repeat)
    gpu_times = benchmark_gpu(args.size, args.warmup, args.repeat)

    print("cpu_validation: PASS (all elements finite and equal to 3)")
    print("gpu_validation: PASS (all elements finite and equal to 3)")
    summarize("cpu", cpu_times, args.size)
    summarize("gpu", gpu_times, args.size)
    print("status: PASS")


if __name__ == "__main__":
    main()
