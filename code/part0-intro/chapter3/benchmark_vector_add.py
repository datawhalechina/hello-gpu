import argparse
import statistics
import time

import torch


def parse_args():
    parser = argparse.ArgumentParser(description="Benchmark torch vector add on CPU and ROCm GPU.")
    parser.add_argument("--size", type=int, default=1 << 24)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--repeat", type=int, default=30)
    return parser.parse_args()


def benchmark_cpu(size, warmup, repeat):
    a = torch.ones(size, dtype=torch.float32)
    b = torch.full((size,), 2.0, dtype=torch.float32)

    for _ in range(warmup):
        c = a + b
    _ = c.sum().item()

    times = []
    for _ in range(repeat):
        start = time.perf_counter()
        c = a + b
        _ = c.sum().item()
        end = time.perf_counter()
        times.append((end - start) * 1000)
    return times, c


def benchmark_gpu(size, warmup, repeat):
    if not torch.cuda.is_available():
        raise SystemExit("PyTorch ROCm backend is not available")

    a = torch.ones(size, device="cuda", dtype=torch.float32)
    b = torch.full((size,), 2.0, device="cuda", dtype=torch.float32)

    for _ in range(warmup):
        c = a + b
    torch.cuda.synchronize()
    _ = c.sum().item()

    times = []
    for _ in range(repeat):
        start = torch.cuda.Event(enable_timing=True)
        end = torch.cuda.Event(enable_timing=True)
        start.record()
        c = a + b
        end.record()
        torch.cuda.synchronize()
        times.append(start.elapsed_time(end))
    _ = c.sum().item()
    return times, c


def is_correct(output):
    expected = torch.full_like(output, 3.0)
    return bool(torch.isfinite(output).all().item() and torch.equal(output, expected))


def summarize(name, times, size):
    mean_ms = statistics.mean(times)
    median_ms = statistics.median(times)
    min_ms = min(times)
    bytes_moved = size * 3 * 4
    bandwidth_gb_s = bytes_moved / (min_ms / 1000) / 1e9

    print(f"{name}_mean_ms: {mean_ms:.6f}")
    print(f"{name}_median_ms: {median_ms:.6f}")
    print(f"{name}_min_ms: {min_ms:.6f}")
    print(f"{name}_bandwidth_gb_s_by_min: {bandwidth_gb_s:.6f}")


def main():
    args = parse_args()
    print(f"torch: {torch.__version__}")
    print(f"cuda_available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"device_name: {torch.cuda.get_device_name(0)}")
    print(f"vector_size: {args.size}")
    print(f"warmup: {args.warmup}")
    print(f"repeat: {args.repeat}")

    cpu_times, cpu_output = benchmark_cpu(args.size, args.warmup, args.repeat)
    gpu_times, gpu_output = benchmark_gpu(args.size, args.warmup, args.repeat)

    summarize("cpu", cpu_times, args.size)
    summarize("gpu", gpu_times, args.size)
    correct = is_correct(cpu_output) and is_correct(gpu_output)
    print(f"status: {'PASS' if correct else 'FAIL'}")
    if not correct:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
