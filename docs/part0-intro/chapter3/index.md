---
title: "第3章 第一个程序 + Roofline 心智模型"
description: "Hello GPU 第3章 · vector add 跑通、建立性能上限直觉、benchmark 习惯"
---

# 第3章 第一个程序 + Roofline 心智模型

## 本章导读

> 前面两章我们铺开了环境验证和 GPU 体系结构两张地图。现在，地图已经在你手上了——终于到了**写一点代码、量一组数字**的时候。本章会做三件事：跑通第一个手写的 HIP kernel（vector add）、建立一个可复用的 baseline benchmark、再用 Roofline 心智模型把"这个算子离硬件极限有多远"的直觉建起来。vector add 会贯穿整个 Part 1 profiling 篇，所以这章是后面所有实验的起点。

本章对应代码在：

```text
code/part0-intro/
├── pyproject.toml
├── uv.lock
├── activate-rocm.sh
└── chapter3/
    ├── vector_add.hip
    ├── benchmark_vector_add.py
    └── plot_roofline.py
```

## 3.1 从已经验证的环境开始

在写第一行 GPU 代码之前，有一件事必须确认：环境是通的。好在这件事[第 1 章](../chapter1/index.md)已经帮你做完了——三道环境验证门（`rocminfo` 能看到 GPU、PyTorch ROCm 能跑 GPU tensor、最小 HIP 程序能编译运行）都已经通过。如果你还没做，请先回去跑完那三道门。

进入本篇环境：

```bash
cd code/part0-intro
uv sync
source ./activate-rocm.sh
```

如果这里无法激活环境，先回到[第 1 章环境准备](../chapter1/index.md)排查 `uv` 环境、ROCm wheel 和 `_rocm_sdk_devel` 初始化问题。

## 3.2 跑通 vector add

环境就绪，开始写代码。一个最小但完整的 HIP 程序通常包含六步：Host 准备数据、Device 分配显存、Host 到 Device 拷贝、启动 kernel、Device 到 Host 拷回、检查结果。这六步构成了所有 GPU 程序的骨架，后面的 Reduction、Softmax、Matmul 无论多复杂，骨架都是这六步。

::: figure fig-vec-add-data-path
```mermaid
flowchart LR
    A[Host 输入] --> B[hipMalloc]
    B --> C[hipMemcpy H2D]
    C --> D[Kernel Launch]
    D --> E[hipMemcpy D2H]
    E --> F[校验结果]
```

最小 HIP Vector Add 程序的数据路径
:::

完整的 `vector_add.hip` 文件在[第 1 章 1.6 节](../chapter1/index.md#_1-6-验证最小-hip-程序)已经作为环境验证出现过，这里不重复贴。**真正值得重点看的是中间那段 kernel**，它才是跑在 GPU 上的代码：

```cpp
__global__ void vector_add(const float* a, const float* b, float* c, int n) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < n) {
    c[idx] = a[idx] + b[idx];
  }
}
```

这段 kernel 的映射关系很直接：一个 GPU 线程负责一个元素。`blockIdx.x * blockDim.x + threadIdx.x` 计算出当前线程负责的全局下标，`if (idx < n)` 用来处理最后一个 block 可能越界的情况。

新语法速查：

- `__global__`：告诉编译器"这是一个 GPU 函数，由 CPU 调用、在 GPU 上运行"；
- `<<<blocks, threads>>>`：HIP / CUDA 特有的 kernel 启动语法，`blocks` 是要启动多少组，`threads` 是每组多少个线程；
- `blockIdx.x` / `threadIdx.x`：每个 GPU 线程拿到的"工号"，用它来算自己负责数组里的哪个位置。

换成大白话：`vector_add<<<blocks, threads>>>(...)` 就是在 GPU 上同时叫起 `blocks × threads` 个工人，每个工人执行一次 `vector_add` 函数（如 @fig-block-thread-hierarchy 所示）。

::: figure fig-block-thread-hierarchy
![Block 与 Thread 的层级关系](./images/block-thread-hierarchy.png)

Grid → Block → Thread 的层级，以及 blockIdx/threadIdx 如何算出全局下标
:::

编译并运行：

```bash
cd chapter3
hipcc vector_add.hip -O2 -o vector_add && echo "compile_status: PASS"
./vector_add
```

<details>
<summary>输出：vector add 运行结果（9070XT）</summary>

```text
device_name: AMD Radeon RX 9070 XT
vector_size: 1048576
blocks: 4096
threads_per_block: 256
max_error: 0
status: PASS
```

</details>

看到 `status: PASS` 后，你已经跑通了第一段真正由自己编译的 GPU kernel——欢迎正式进入 GPU 编程的世界。

## 3.3 建立 baseline benchmark

这一节加入一个很小的 benchmark。它不是为了证明 Vector Add 有多快，而是为了提前建立后续章节会反复使用的习惯：固定输入规模、先 warmup、重复运行多次、记录 mean / median / min。

完整代码在下面的折叠块里。如果你只想先看懂大意，记住三件事（如 @fig-benchmark-warmup-repeat-sync 所示）：

1. 正式计时前先 warmup 5 次，让 GPU 进入比较稳定的状态；
2. 正式跑 30 次，每次用 `torch.cuda.Event` 量 GPU 真正执行完成的时间；
3. 最后用最小值估算带宽，因为最小值更像"没被外部干扰"的那次。

::: figure fig-benchmark-warmup-repeat-sync
![Benchmark 的赛前准备](./images/benchmark-warmup-repeat-sync.png)

准确 benchmark 前先 warmup、多次 repeat，并在同步后计时
:::

<details>
<summary>代码：benchmark_vector_add.py</summary>

```python
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
```

</details>

其中 GPU 计时最关键的是使用 event 并在每轮后同步：

```python
start.record()
c = a + b
end.record()
torch.cuda.synchronize()
times.append(start.elapsed_time(end))
```

否则 CPU 端可能只是把任务提交出去，计到的不是 GPU 真正执行完成的时间。

运行：

```bash
python benchmark_vector_add.py
```

<details>
<summary>输出：Vector Add baseline benchmark @ AMD Radeon RX 9070 XT + ROCm 7.13</summary>

```text
torch: 2.11.0+rocm7.13.0
cuda_available: True
device_name: AMD Radeon RX 9070 XT
vector_size: 16777216
warmup: 5
repeat: 30
cpu_mean_ms: 8.681129
cpu_median_ms: 8.536416
cpu_min_ms: 7.356311
cpu_bandwidth_gb_s_by_min: 27.367874
gpu_mean_ms: 0.353474
gpu_median_ms: 0.346692
gpu_min_ms: 0.345132
gpu_bandwidth_gb_s_by_min: 583.332163
status: PASS
```

GPU min 延迟 0.345 ms，按两读一写估算的逻辑有效带宽约为 583 GB/s。这里不能用 CPU/GPU 的打印值计算加速比：CPU 计时区间还包含 `c.sum().item()`，GPU event 只包围 `a + b`，两者不是同一工作量。这个不一致将在重做第 2～6 章带宽与 Roofline 数据时一并修正；当前 GPU 数字只用于后续同口径 GPU 实验的起点。

</details>

这里的带宽估算使用的是 Vector Add 的最简单数据量模型。一次 Vector Add 要读 `a`、读 `b`、写 `c`，一共经过 3 个数组；每个元素是 `float32`，也就是 4 字节。所以一次完整 Vector Add 搬动的数据量是：

```text
bytes_moved = vector_size × 3 × 4
```

实测 GPU 估算有效带宽约 583 GB/s——下一节就拿它和 Roofline 上限对比。

## 3.4 Roofline 心智模型

有了 baseline 数字，现在把它和理论上限对比一下，建立"这个算子离硬件极限有多远"的直觉。

[第 2 章 2.10 节](../chapter2/index.md#_2-10-roofline-的硬件来源) 我们建立了 Roofline 模型：任何 kernel 的实际性能都被**算力上限**和**带宽上限**两条线卡住。现在用 vector add 实测一下它落在哪。

先算 vector add 的算术强度：

```text
对每个 float32 元素：
  读 a[i]：4 Byte
  读 b[i]：4 Byte
  写 c[i]：4 Byte
  做 1 次加法：1 FLOP

算术强度 = FLOP / Byte = 1 / 12 ≈ 0.083 FLOP/Byte
```

算术强度极低（约 0.083 FLOP/Byte），这意味着 vector add **必然落在 Roofline 的斜线那一侧——它是 memory-bound 的**。换句话说，vector add 慢不慢，几乎完全取决于显存带宽，和算力无关。

现在把实测带宽和理论上限对比：

| 项目 | 数值 |
| ---- | ---- |
| vector add 算术强度 | ~0.083 FLOP/Byte（memory-bound）|
| 实测有效带宽（PyTorch `benchmark_vector_add.py`, 16M 元素 ≈ 64 MiB）| **~583 GB/s** |
| 实测有效带宽（手写 HIP coalesced, 第 5 章同规模 benchmark）| **~603 GB/s** |
| GDDR6 实测带宽上限（copy, ≥1 GiB 平台，见 [第 2 章 §2.11](../chapter2/index.md)）| ~510 GB/s |
| 标称带宽（理论峰值）| ~760 GB/s |
| 带宽利用率（PyTorch / GDDR6 上限）| ~114%（高于 100%，见下文解释）|
| 带宽利用率（手写 HIP / GDDR6 上限）| ~118%（同样属于有效带宽口径）|

> 两个 vector add 点的有效带宽（583 / 603 GB/s）都高于 GDDR6 copy 稳态上限（510 GB/s），看起来"超标"——原因不是测量错了，而是这里的 GB/s 是按 `3 × n × sizeof(float)` 反推的**有效带宽**，不是硬件计数器直接数出来的 DRAM 字节数。16M 元素约 64 MiB，工作集仍可能吃到 L2 / 写路径优化；[第 2 章 §2.11](../chapter2/index.md) 的 copy 扫描也能看到 64 MiB footprint 高于 1 GiB plateau。这说明 vector add 在这个规模下没有完全卡在纯 GDDR6 上——这正是它的访存模式非常友好（完全合并、线性流式）的结果。要让带宽利用率回到 100% 以内，把输入规模推到 ≥1 GiB（远超 L2）再测即可。

现在把这两个实测点画到 Roofline 曲线上。横轴是算术强度（FLOP/Byte，对数轴），纵轴是实际性能（TFLOPS，对数轴）；硬件线来自 [第 2 章 §2.11](../chapter2/index.md) 的实测值（GDDR6 copy plateau ~510 GB/s、fp32 算力 ~10.6 TFLOPS、fp16 算力 ~79.9 TFLOPS）。橙色点来自本节 `benchmark_vector_add.py` 的 PyTorch ROCm baseline 输出；紫色点来自[第 5 章](../../part1-profiling/chapter5/index.md)同规模手写 HIP coalesced benchmark（`vector_add_bench --kernel coalesced`）。注意，§3.2 的 `vector_add.hip` 只用于验证手写 HIP kernel 能编译运行并通过正确性检查，不提供这张图里的计时和带宽数据。

::: figure fig-roofline-vadd
![Roofline 曲线：vector add 实测点](./images/roofline-vector-add.png)

PyTorch baseline 和手写 HIP coalesced 两个 vector add 实测点都落在 Roofline 斜线最左下端——典型的 memory-bound。斜线分别标出 PyTorch 有效带宽（583 GB/s）、手写 HIP 有效带宽（603 GB/s）和 GDDR6 平台 copy plateau（510 GB/s）；两条水平线是 fp32（10.6 TFLOPS，SIMD FMA）和 fp16（79.9 TFLOPS，WMMA）算力上限。图由 `code/part0-intro/chapter3/plot_roofline.py` 生成。
:::

读这张图能直接得到三个直觉：

- **两个 vector add 点都贴着斜线，远离两条水平线**——它们都是 memory-bound，算力（VALU/WMMA）完全没吃满，瓶颈在带宽。PyTorch baseline 和手写 HIP coalesced 的有效带宽接近（583 vs 603 GB/s），说明这个简单算子的主要限制不是框架开销，而是线性流式访存本身。就算把 fp32 换成 fp16，算力线再高它也快不了多少，因为它压根没走到算力那一侧。
- **它们已经接近斜线本身**——说明 vector add 的访存效率很高（完全合并），优化空间已经不大；想再快只能提高算术强度（融合多个 elementwise 算子，让搬一次数据做更多 FLOP），把工作点**沿斜线往右上方推**，推过拐点后才会进入 compute-bound 区。
- **两条水平线差距巨大（fp16 是 fp32 的 ~7.5 倍）**——但这个差距对 vector add 毫无意义，因为它在斜线那一侧。只有 GEMM / Attention 这种高算术强度算子（点落在水平线附近）才能吃到 WMMA 的红利——这是后面 [第 10 章 GEMM](../../part2-kernels/chapter10/index.md)、[第 11 章 Flash Attention](../../part2-kernels/chapter11/index.md) 反复要用的判断。

这个对比建立了一个贯穿全书的核心直觉：**判断一个算子优化得好不好，不是只看绝对延迟，还要看它位于 Roofline 拐点哪一侧、离对应参考线还有多远**。后续 Part 1 的 [第 5 章](../../part1-profiling/chapter5/index.md)、[第 6 章](../../part1-profiling/chapter6/index.md) 会用 profiling 工具比较配置、检查实验变量并解读工作点；Part 2 的每个算子都会继续使用这套方法。

## 3.5 留下实验底稿

跑完前面三段命令，你大概觉得事情已经做完了——其实还没有。**性能工作真正麻烦的一刻，往往不是第一次没跑快，而是过几天回头看时，你自己也说不清当时跑了哪个版本、用了什么输入、那个数字到底是怎么量出来的。** 没留记录的实验，三天后基本等于白做。

所以从这第一个 GPU 程序开始，建议你养成一个小习惯：**每跑完一组实验，顺手把目标、命令、结果记到同一个地方**。在哪里记并不重要——一个 markdown 文件、一份 notebook 都行；重要的是这份记录能在几天后让你（或者别人）一眼看回当初做了什么。

够用的结构其实只有三段：**目标 → 流程 → 结论**。下面这个模板可以直接拿去用：

````markdown
# 实验记录：第一个 GPU 程序

## 实验目标

验证 PyTorch ROCm、最小 HIP kernel 和 Vector Add baseline benchmark 是否能跑通。

## 实测流程

（贴出可以从章节目录直接复制运行的命令）

```bash
cd code/part0-intro
source ./activate-rocm.sh
python chapter1/check_torch_rocm.py
cd chapter3
hipcc vector_add.hip -O2 -o vector_add
./vector_add
python benchmark_vector_add.py
```

## 实测结论

| 项目 | 数值 |
| ---- | ---- |
| 硬件 | AMD Radeon RX 9070 XT（gfx1201）+ ROCm 7.13（原生 Ubuntu 24.04）|
| 输入规模 | 16,777,216 个 float32（≈ 64 MiB/数组）|
| GPU min 延迟 | 0.345 ms |
| GPU 估算带宽 | ~583 GB/s |
| status | PASS |
````

看起来朴素，但半年后你回头翻这些记录，会非常感谢现在的自己。后面这本教程会一路写到 Reduction、Softmax、Matmul、Attention，外加一系列 rocprof 实验——等到 kernel 版本越积越多、benchmark 配置越改越乱时，**能不能一眼看回当初跑过什么**，往往就是"顺利继续"和"回头返工"的分界线。

试一试：把 `--size` 从默认的 `1 << 24` 改成 `1 << 20` 和 `1 << 26`，分别再跑一次 benchmark，把每次的硬件、输入规模、GPU min 延迟和估算带宽随手记到你的实验记录里。先猜一下——GPU 带宽会一直变大、一直变小，还是先升后降？这道题没有标准答案，目的是让你亲手建立"输入规模 vs 性能"的第一感觉，后面 Part 1 会反复用到。

## 本章小结

- 本章在 `part0-intro` 环境里跑通了第一个手写 HIP Vector Add kernel。
- 第一个 HIP kernel 使用"一线程处理一个元素"的最简单映射方式，方便理解 block、thread 和全局下标。
- baseline benchmark 使用 warmup + repeat，并用 GPU event 计时，避免只量到 CPU 提交开销。
- vector add 的算术强度极低（~0.083 FLOP/Byte），必然是 memory-bound——它的性能几乎完全取决于显存带宽。
- 用实测带宽和 Roofline 理论上限对比，建立了"算子离极限有多远"的直觉，这个直觉会在整个 Part 1 反复用到。
- 下一章进入 Part 1 profiling 篇，先系统学怎么量准数字（benchmark 与可信计时）。

## 延伸阅读

- [ROCm HIP Documentation](https://rocm.docs.amd.com/projects/HIP/en/latest/)
- [PyTorch CUDA semantics](https://docs.pytorch.org/docs/stable/notes/cuda.html)
- [ROCm System Management Interface](https://rocm.docs.amd.com/projects/rocm_smi_lib/en/latest/)
