---
title: "第12章 综合实战：Fused RMSNorm"
description: "Hello GPU 第12章 · 综合逐元素、归约与融合，独立完成一次可复现的 Kernel 优化闭环"
---

# 第12章 综合实战：Fused RMSNorm

## 本章导读

RMSNorm 很适合作为 Part 2 的结业题：平方是 Element-Wise，均值是 Reduction，归一化和权重缩放又是 Element-Wise，而高效实现希望把这些步骤融合在一次读写中。

本章不再堆叠新术语，而是完整走一遍“固定语义 → 建立基线 → 融合 → 正确性 → 计时 → profiling → 记录负结果”的工作流。代码包含 HIP 与 Triton 两条路线，当前是完成优先的教学第一版；HIP 编译、Triton JIT 与小规模正确性 smoke test 已通过，正式远端性能数据将在统一实验阶段补充。

## 12.1 从 LayerNorm 到 RMSNorm

对一行向量 `x` 和同长度权重 `w`，RMSNorm 定义为：

```text
mean_square = sum(x[i]²) / N
inv_rms     = 1 / sqrt(mean_square + epsilon)
y[i]        = x[i] * inv_rms * w[i]
```

与 LayerNorm 相比，它不减去均值，也没有 `(x-mean)²` 这条路径。它仍然需要跨整行归约，因此不是纯逐元素算子。

手算 `x=[3,4]、w=[1,1]、epsilon=0`：平方均值是 `(9+16)/2=12.5`，RMS 是 `sqrt(12.5)`，两个输出都除以同一个行级尺度。这个“先得到一个标量，再广播回整行”的结构，就是本章要优化的数据流。

## 12.2 先锁定实验契约

首版固定：

- 输入、权重和输出均为 FP32；
- 对最后一维逐行归约；
- `epsilon=1e-5`；
- CPU/PyTorch reference 使用同一公式；
- kernel-only GPU event 计时；
- 必须覆盖列数不是二次幂的尾部；
- 不发布尚未在实验机验证的性能数字。

建议正确性形状：

| Rows | Cols | 目的 |
| ---: | ---: | --- |
| 1 | 1 | 最小输入 |
| 3 | 13 | mask/尾部 |
| 33 | 257 | 跨 wave/block 边界 |
| 1024 | 4096 | 教学主形状 |

误差阈值不能只看一个固定常数。换成 FP16/BF16 后，应根据累加 dtype、列数和 reference 精度重新制定 `atol/rtol`。

## 12.3 HIP serial：最短正确基线

`code/part2-kernels/chapter12/rmsnorm_hip.hip` 的 `serial` 版本让一个 GPU 线程处理一整行：先顺序累加平方，再顺序写回归一化结果。

```bash
./rmsnorm_hip --version serial --rows 1024 --cols 4096 \
  --block 256 --epsilon 1e-5
```

它的并行度只有“行之间并行”，长行内部没有协作。这通常不是最终性能方案，但有三个教学价值：

1. 控制流与公式几乎一一对应；
2. 不需要 LDS 和同步，容易定位数值错误；
3. 为 block 协作版本提供 GPU 侧基线。

基线首先要可靠，不需要故意把它写得很糟，也不能拿 CPU 时间冒充 GPU kernel 时间。

## 12.4 HIP block：协作归约并融合写回

`block` 版本让一个 block 处理一行。每个线程读取多个列并得到局部平方和，然后在 LDS 中做树形归约：

```cpp
for (int col = tid; col < cols; col += blockDim.x) {
    float value = input[row * cols + col];
    square_sum += value * value;
}
shared[tid] = square_sum;
// LDS tree reduction
float inverse_rms = rsqrtf(shared[0] / cols + epsilon);
```

归约结束后，同一批线程直接读取输入、乘 `inverse_rms` 和 weight、写回输出。中间的 `x²` 数组和行级统计量都不写到全局内存。

```bash
./rmsnorm_hip --version block --rows 1024 --cols 4096 \
  --block 256 --epsilon 1e-5
```

这里仍有可优化空间：用 wave shuffle 收尾、一次加载后在寄存器中复用 x、向量化读写，以及为不同列数选择 block。第一版只改变“行内协作”这一项，便于和 serial 版本比较。

## 12.5 Triton：一行一个 program

`rmsnorm_triton.py` 让一个 program 处理一行，列方向扩展到下一个二次幂并用 mask 保护尾部：

```python
offsets = tl.arange(0, BLOCK_SIZE)
mask = offsets < cols
values = tl.load(input_ptr + row * cols + offsets, mask=mask, other=0.0)
mean_square = tl.sum(values * values, axis=0) / cols
inverse_rms = tl.rsqrt(mean_square + epsilon)
tl.store(output_ptr + row * cols + offsets,
         values * inverse_rms * weights, mask=mask)
```

`t0` 与 `t1` 使用同一数学 kernel，分别用 4 和 8 个 warps：

```bash
python rmsnorm_triton.py --version all --rows 1024 --cols 4096
```

这是一项受控配置实验，而不是“8 warps 一定优于 4 warps”。列数变大时，单个 program 的向量状态可能增加寄存器或 scratch 使用；应让 profiler 和实测时间回答。

## 12.6 融合到底省掉了什么

假设分步实现先写 `square=x²`，再归约得到 `mean_square`，最后启动新 kernel 做 normalize：

```text
x -> square buffer -> row statistic -> reread x -> y
```

融合实现的数据流是：

```text
x -> local square sum -> block/program reduction -> y
                   weight ----------------------^
```

它省掉了 square buffer 的分配、写入和读取，也减少 dispatch。但 `x` 是否只从显存读取一次，要看具体实现和编译器生成结果：HIP 第一版在归约后会再次从 input 读取 x；Triton 源码看似只 load 一次，是否发生 spill/重载仍应通过 profiling 判断。不要从源码表象直接推出物理流量。

## 12.7 一次完整的运行与检查

在 Part 2 环境中执行：

```bash
cd code/part2-kernels
bash chapter12/run_all.sh
```

脚本会：

1. 激活本篇 `.venv` 和 ROCm 工具链；
2. 编译 HIP；
3. 用 `3×13` 检查尾部正确性；
4. 用 `1024×4096` 跑教学主形状；
5. HIP/Triton 每个版本都打印 `RESULT` 行。

首版输出中的时间适合判断脚本是否工作，但正式比较仍应重复独立进程、记录环境、保留中位数和范围。

## 12.8 Profiling 与单变量实验

HIP：

```bash
hipcc --offload-arch=gfx1201 -O3 -std=c++17 \
  chapter12/rmsnorm_hip.hip -o /tmp/rmsnorm_hip
rocprofv3 --kernel-trace -- \
  /tmp/rmsnorm_hip --version block --rows 1024 --cols 4096 \
  --warmup 0 --repeat 10
```

Triton：

```bash
rocprofv3 --kernel-trace -- \
  python chapter12/rmsnorm_triton.py --version t1 \
  --rows 1024 --cols 4096 --warmup 0 --repeat 10
```

建议按以下顺序实验：

1. HIP block 只改 `128/256/512`；
2. 再把归约收尾替换成 wave shuffle；
3. 再尝试 float4 读写，并保留 scalar tail；
4. Triton 只改 `num_warps`；
5. 最后增加 FP16 输入、FP32 累加。

每一步记录 shape、假设、唯一改动、正确性、时间、VGPR/LDS/scratch 和结论。变慢的版本也要留下，因为它说明资源或 shape 边界在哪里。

## 12.9 HIP 与 Triton 对照

| 层次 | HIP block | Triton row program |
| --- | --- | --- |
| 行映射 | 一个 block | 一个 program |
| 局部平方和 | 每线程寄存器 | program 向量 |
| 行归约 | LDS 树 + 同步 | `tl.sum` |
| 广播标量 | `shared[0]` | 标量 SSA 值 |
| 尾部 | `col < cols` | mask |
| 配置变量 | block size | block size / num warps |

两边的核心算法完全相同。HIP 需要显式决定线程如何合作；Triton 把同一工作提升为 program 内的向量和归约。理解映射关系比背诵某一份最终代码更重要。

## 12.10 独立优化记录模板

完成结业实验时，建议保留如下记录：

```text
目标 shape / dtype:
硬件与软件:
reference 与误差阈值:
baseline:
本轮假设:
唯一改动:
正确性结果:
进程级计时与范围:
profiling 字段:
是否接受本轮改动:
负结果与回退点:
```

“最快版本”不是唯一产物。能解释为什么某个 block 在 257 列有效、在 4096 列反而出现 scratch，才是一份可迁移的优化记录。

## 12.11 迁移到新题目

拿到新的算子规格时，按以下顺序处理：

1. 写数学语义和 CPU/PyTorch reference；
2. 标记 Element-Wise、Reduction、GEMM 和可融合边界；
3. 画输入、中间量和输出的数据生命周期；
4. 做最短正确 HIP/Triton 基线；
5. 固定 shape、计时和误差口径；
6. 每轮只改变一项机制；
7. 用 profiling 解释结果，而不是靠 kernel 名字解释。

LeetGPU 或其他平台题目可以作为扩展练习，但隐藏 shape、评分口径和硬件可能不同。平台成绩不能替代本书实验机上的可复跑记录。

## 本章小结

- RMSNorm 把逐元素平方、行归约、广播和权重缩放组合在一个小而完整的算子中。
- HIP serial 建立最短基线，HIP block 和 Triton row program 表达行内并行归约。
- 融合主要减少中间数组和 dispatch；真实物理读写仍需 profiler 验证。
- 当前第一版已经提供 HIP、Triton、正确性 reference、GPU event 和运行入口，并通过 RX 9070 XT 小规模正确性 smoke test；后续统一补正式性能与 profiling 数据，而不是虚构优化结论。

## 延伸阅读

- RMSNorm 原论文：理解它相对 LayerNorm 移除了哪一项统计量。
- AMD HIP Programming Manual：LDS、同步和 wave shuffle。
- Triton reduction / layer normalization 教程：对照行级 program 的资源约束。
