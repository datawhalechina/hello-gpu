---
title: "第11章 Fusion：融合算子"
description: "Hello GPU 第11章 · 以 FlashAttention 为例，学习在线计算、减少中间写回与 IO-aware"
---

# 第11章 Fusion：融合算子

## 本章导读

前四章分别练习了逐元素、归约、归一化和矩阵乘。本章把它们组合成一次完整的数据流：先计算 `QKᵀ`，再做逐行 Softmax，最后乘以 `V`。真正的新问题不是公式，而是中间的 `S×S` 矩阵要不要写回显存。

本章提供两条教学路线：HIP 先实现三段式物化版本，再实现不保存完整 Scores/Probability 的在线版本；Triton 用一个 program 处理一行 query，并在 key tile 之间维护在线 Softmax 状态。这是 **FlashAttention-style 的教学实现**，借用了在线 Softmax 和避免物化 `S×S` 中间量的思想，不等同于复现完整论文 kernel。代码不附带未经验证的性能结论。

## 11.1 先固定 Attention 的语义

这里先只讨论单 batch、单 head、FP32 的前向计算。设序列长度为 `S`，head dimension 为 `D`：

```text
Scores = Q @ Kᵀ / sqrt(D)       # [S, S]
P      = softmax(Scores, dim=1) # [S, S]
O      = P @ V                  # [S, D]
```

每个 query 行都要看全部 key。`Q、K、V、O` 的元素数是 `S×D`，而 Scores 和 P 都是 `S×S`。当 S 增长时，中间矩阵往往比输入输出增长得更快，这正是融合的切入点。

本章暂不加入 batch、多 head、causal mask、dropout 和反向传播。先把最小数学内核看清，之后再扩展接口。

## 11.2 物化版本的数据流

最直接的实现分三步：

1. `scores_kernel`：每个线程计算一个 `Q[row]·K[col]`。
2. `softmax_rows_kernel`：每个 block 归约一行的最大值和指数和。
3. `probability_value_kernel`：每个线程计算一个输出元素。

这条路线的优点是容易逐段检查：Scores、P 和 O 都能单独拷回 CPU。代价是 Scores 和 P 各发生一次全局写入和后续读取，而且要启动三个 kernel。

注意：这并不意味着“三个 kernel 必然慢”。是否值得融合仍取决于 shape、实现质量、寄存器压力和硬件。这里先把可观察的数据流建立起来。

## 11.3 在线 Softmax 的四个状态

如果按 key tile 顺序扫描，就不能一开始知道整行最大值。在线 Softmax 为已经看过的元素维护：

- `m`：当前最大 score；
- `l`：以当前最大值为基准的指数和；
- `acc`：按同一尺度累计的加权 V；
- 新 tile 的 score。

当新 score 为 `x` 时：

```text
new_m = max(m, x)
alpha = exp(m - new_m)
beta  = exp(x - new_m)
l     = l * alpha + beta
acc   = acc * alpha + beta * V[x]
m     = new_m
```

历史累计值乘 `alpha`，是因为最大值基准改变了。最后输出 `acc / l`。这个递推与先保存全部 score、再一次性做稳定 Softmax 数学等价，但不需要完整的 `S×S` 中间数组。

例如 score 依次是 `2、1、4`。处理前两个后，基准是 2；看到 4 时，旧的指数和必须乘 `exp(2-4)` 后才能和新项放在同一尺度下。漏掉这一步，是在线实现最常见的正确性错误。

## 11.4 HIP materialized：三段式基线

`code/part2-kernels/chapter11/attention_hip.hip` 中的 `materialized` 路线对应上一节的三个 kernel。Softmax 使用一个 block 处理一行：线程先各自扫描若干列，再在 LDS 中归约 max 和 sum。

```bash
./attention_hip --version materialized --seq 128 --dim 64 \
  --block 256 --warmup 5 --repeat 20
```

计时事件包围完整的三个 dispatch，因此它测量的是完整 Attention 路径，不会只报某个子 kernel。CPU reference 使用同样的稳定 Softmax 公式，最终比较整个 O 矩阵的最大绝对误差。

这个版本故意朴素：Scores 的点积没有做 GEMM tile，P@V 也没有 LDS 复用。它的职责是提供容易解释的融合前基线，而不是代替成熟 BLAS。

## 11.5 HIP online：一行一个 block

`online_attention_kernel` 让一个 block 负责一个 query 行：

1. 全 block 协作计算当前 query 与一个 key 的点积；
2. 在 LDS 中归约点积；
3. 线程 0 更新 `m、l、alpha、beta`；
4. 全 block 协作更新驻留在 LDS 的输出 numerator；
5. 扫完所有 key 后除以 l 并写回 O。

```bash
./attention_hip --version online --seq 128 --dim 64 \
  --block 256 --warmup 5 --repeat 20
```

这是一份强调数据流的教学实现。它确实消除了完整 Scores/P，但每个 key 都有同步，输出 numerator 也放在 LDS；真实高性能实现会进一步按 query/key 分块、让更多状态进入寄存器并使用矩阵指令。第一版先确保在线递推和边界路径可读。

## 11.6 Triton：一个 program 处理一行

`attention_triton.py` 使用一个 Triton program 负责一行 query。program 先加载 Q 行，然后按 `BLOCK_K` 扫描 K/V tile：

```python
scores = tl.sum(k_tile * q[None, :], axis=1) * scale
next_max = tl.maximum(running_max, tl.max(scores, axis=0))
history_scale = tl.exp(running_max - next_max)
probabilities = tl.exp(scores - next_max)
acc = acc * history_scale + tl.sum(probabilities[:, None] * v_tile, axis=0)
```

`t0` 使用 `BLOCK_K=16`，`t1` 使用 `BLOCK_K=32`。两者数学相同，只改变 key tile 大小：

```bash
python attention_triton.py --version all --seq 128 --dim 64
```

更大的 tile 不保证更快。它可能减少循环轮数，也可能提高寄存器或 scratch 压力。本章保留两个配置，是为了让 profiling 有一个清楚的受控变量。

## 11.7 正确性矩阵

第一轮至少运行以下形状：

| S | D | 目的 |
| ---: | ---: | --- |
| 1 | 1 | 最小退化情况 |
| 7 | 13 | S/D 都不是二次幂 |
| 33 | 31 | 跨过常见 wave/block 边界 |
| 128 | 64 | 教学主形状 |

每条实现都与 CPU 或 PyTorch 的 `softmax(Q @ K.T / sqrt(D)) @ V` 比较。为了专门压力测试数值稳定性，还应把 Q/K 放大，使原始 score 足以让直接 `exp(score)` 溢出；稳定实现仍应输出有限值。

当前首版自动脚本覆盖 `7×13` 和 `128×64`。其余形状可直接通过 CLI 添加，不需要改 kernel。

## 11.8 计时和 Profiling 看什么

完整运行：

```bash
cd code/part2-kernels
bash chapter11/run_all.sh
```

HIP profiling 示例：

```bash
hipcc --offload-arch=gfx1201 -O3 -std=c++17 \
  chapter11/attention_hip.hip -o /tmp/attention_hip
rocprofv3 --kernel-trace -- \
  /tmp/attention_hip --version online --seq 128 --dim 64 \
  --warmup 0 --repeat 10
```

Triton profiling 示例：

```bash
rocprofv3 --kernel-trace -- \
  python chapter11/attention_triton.py --version t1 \
  --seq 128 --dim 64 --warmup 0 --repeat 10
```

除了总时间，还要观察：dispatch 数、是否分配 `S×S` 中间矩阵、VGPR、LDS、scratch、workgroup 和实际 grid。融合减少了全局中间写回，但资源使用过高时仍可能抵消收益。

## 11.9 HIP 与 Triton 的层次对照

| 数据流层次 | HIP | Triton |
| --- | --- | --- |
| query 行 | `blockIdx.x` | `program_id(0)` |
| key tile/元素 | 显式循环 | `BLOCK_K` tile 循环 |
| 点积归约 | LDS + `__syncthreads()` | `tl.sum(..., axis=1)` |
| 在线状态 | LDS 中的 `m/l/acc` | program 内标量与向量 |
| 尾部 | 显式循环边界 | load/store mask |

HIP 把线程协作和同步完整暴露出来；Triton 更接近 tile 级数学表达。两者都必须回答同样的问题：状态放在哪里、何时重缩放、何时写回显存。

## 11.10 练习：逐步接近真实 Attention

建议按以下顺序扩展，每次只增加一项：

1. 添加 causal mask，确认被屏蔽位置不参与 max 和 sum。
2. 添加 batch/head 维度，但保持单个 head 内的算法不变。
3. 将输入改为 FP16、累加保持 FP32，重新定义误差阈值。
4. 让 HIP online 一次处理多个 query，复用 K/V tile。
5. 比较 `BLOCK_K=16/32/64`，记录负结果而不是只保留最快配置。
6. 将物化版本替换为 rocBLAS/PyTorch 强基线，再判断融合收益。

## 本章小结

- Attention 的融合目标不是少写几行代码，而是避免 `S×S` 中间矩阵的物化和往返。
- 在线 Softmax 的关键是最大值变化时同时重缩放历史 denominator 和 numerator。
- HIP 与 Triton 的抽象层级不同，但都可以表达同一套在线状态机。
- 当前代码是完成优先的教学第一版，HIP 编译、Triton JIT 与小规模正确性 smoke test 已在 RX 9070 XT 上通过；性能数字必须等正式多轮远端实验后再发布。

## 延伸阅读

- [FlashAttention 论文](https://arxiv.org/abs/2205.14135)：重点关注 IO-aware 分块与中间量生命周期。
- [AMD HIP Programming Model](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html)：复习 LDS、同步和 wavefront。
- [Triton Fused Attention 教程](https://triton-lang.org/main/getting-started/tutorials/06-fused-attention.html)：对照更完整的 tile-level 在线状态如何映射到 program。
