---
layout: hg
title: Softmax 题解（LeetGPU）
description: LeetGPU 上 Softmax 一题的原创题解：用「最大值 + 指数和」的摘要把一长串数拆给很多块，在线合并，读两遍、写一遍，HIP 和 Triton 两条路线。题面请到原站看。
zone: forge
---

<script setup>
import { stageById } from '@course/outline.ts'

// 关卡编号和名字从大纲取（04 第 1 节），这里不手写。
const stage = (id) => {
  const s = stageById(id)
  return `${s.code}「${s.title}」`
}
</script>

# Softmax 题解

<ExternalProblem id="leetgpu-softmax" />

先去原站读题：题目要求、输入输出和函数签名都以原站为准，这里不复述。下面只讲我们的做法和代码。

## 思路

结论：读两遍、写一遍，用「摘要」把一长串数拆给很多块。

先减最大值是为了数值稳定。float32 能表示的最大数约 3.4 × 10³⁸，`exp(x)` 在 x 超过约 88.7 时就变成 inf；每个数先减去最大值，指数最大是 e⁰ = 1，不会溢出。

麻烦在于，最大值和指数和都要看完整串数才知道。我们给每一段数记一份摘要：段里的最大值 $m$，和以它为基准的指数和 $s = \sum e^{x - m}$。两段的摘要可以直接合并：

$$
m = \max(m_a, m_b)
$$

$$
s = s_a\,e^{m_a - m} + s_b\,e^{m_b - m}
$$

单独一个数 $x$ 就是摘要 $\{x, 1\}$。所以线程边读边合并，块内用 shuffle 和 [LDS](/handbook/#lds) 合并，块之间再合并，三层用的是同一个公式。这种边读边换基准的做法叫在线 softmax（online softmax），出自 Milakov 和 Gimelshein 的论文 [Online normalizer calculation for softmax](https://arxiv.org/abs/1805.02867)。

两遍各做一件事：

- 第一遍：每块算出自己那几段的摘要，写进 `part[b]`。
- 第二遍：每块先把全部摘要合成全局的 $M$ 和 $S$，再写自己那几段的输出 $e^{x - M} / S$。块数封顶 1024，摘要数组最多 8 KB（每份两个 float），每块都读一遍。

为什么不只派一个块：一个块只在一个计算单元（或一个 [WGP](/handbook/#wgp)）上跑，其余的都闲着。为什么不分三遍（先求最大值，再求指数和，最后写输出）：那样输入要读三遍，这里只读两遍。

## 关键代码

<RouteBlock route="hip">

**合并两段摘要**：`merge` 就是上面的公式；`block_merge` 和 [Reduction 题解](/dungeon/external/leetgpu-reduction/)里的 `block_sum` 是同一个写法，只是把「加」换成了 `merge`。

```cpp
#include <hip/hip_runtime.h>
#include <algorithm>

// 一段数据的摘要：最大值 m，和以 m 为基准的指数和 s = Σ exp(x − m)。空段是 {-INFINITY, 0}。
struct MS { float m, s; };

// 合并两段：基准换成较大的那个最大值，两边的指数和各乘一个缩放系数再相加
__device__ MS merge(MS a, MS b) {
    const float m = fmaxf(a.m, b.m);
    if (m == -INFINITY) return {m, 0.0f};  // 两段都空：(-inf) − (-inf) 是 NaN，直接返回
    return {m, a.s * expf(a.m - m) + b.s * expf(b.m - m)};
}

// 块内合并，写法同 Reduction 题解的 block_sum，只是「加」换成 merge；结果只在 0 号线程上有效
__device__ MS block_merge(MS v) {
    __shared__ float wave_m[32], wave_s[32];
    const int lane = threadIdx.x % warpSize, wave = threadIdx.x / warpSize;
    for (int off = warpSize / 2; off > 0; off /= 2)
        v = merge(v, {__shfl_down(v.m, off), __shfl_down(v.s, off)});
    if (lane == 0) { wave_m[wave] = v.m; wave_s[wave] = v.s; }
    __syncthreads();
    const int waves = (blockDim.x + warpSize - 1) / warpSize;
    v = threadIdx.x < waves ? MS{wave_m[threadIdx.x], wave_s[threadIdx.x]} : MS{-INFINITY, 0.0f};
    __syncthreads();
    for (int off = warpSize / 2; off > 0; off /= 2)
        v = merge(v, {__shfl_down(v.m, off), __shfl_down(v.s, off)});
    return v;
}
```

**第一遍：每块的摘要**：

```cpp
constexpr int THREADS = 256, MAX_BLOCKS = 1024;

// 第一遍：每个线程边读边合并（每个数是一段 {x, 1}），块内再合并，第 b 块的摘要写进 part[b]
__global__ void softmax_stats(const float* x, MS* part, int n) {
    MS t = {-INFINITY, 0.0f};
    for (int i = blockIdx.x * blockDim.x + threadIdx.x; i < n; i += gridDim.x * blockDim.x)
        t = merge(t, {x[i], 1.0f});
    t = block_merge(t);
    if (threadIdx.x == 0) part[blockIdx.x] = t;
}
```

**第二遍：合并摘要，写输出**：

```cpp
// 第二遍：每块先把所有块的摘要合成全局的 {M, S}，再写自己那几段的输出
__global__ void softmax_write(const float* x, float* y, const MS* part, int parts, int n) {
    __shared__ MS total;
    MS t = {-INFINITY, 0.0f};
    for (int b = threadIdx.x; b < parts; b += blockDim.x) t = merge(t, part[b]);
    t = block_merge(t);
    if (threadIdx.x == 0) total = t;
    __syncthreads();
    const float m = total.m, inv = 1.0f / total.s;
    for (int i = blockIdx.x * blockDim.x + threadIdx.x; i < n; i += gridDim.x * blockDim.x)
        y[i] = expf(x[i] - m) * inv;
}

void softmax_f32(const float* x, float* y, int n, MS* part) {  // part 至少能放 MAX_BLOCKS 个 MS
    const int blocks = std::max(1, std::min((n + THREADS - 1) / THREADS, MAX_BLOCKS));
    softmax_stats<<<blocks, THREADS>>>(x, part, n);
    softmax_write<<<blocks, THREADS>>>(x, y, part, blocks, n);
}
```

</RouteBlock>
<RouteBlock route="triton">

**合并两段摘要**：Triton 里不单独写函数。第一遍循环里算 `new_m`、`base`、`s` 的三行就是合并：每个位置相当于一个线程，边读边把新来的数并进自己的摘要；循环结束后用 `tl.max` 和 `tl.sum` 把整个程序合成一份。

**第一遍：每块的摘要**：

```python
import torch
import triton
import triton.language as tl

BLOCK = 1024
MAX_PROGRAMS = 1024  # 第一遍最多启动这么多个程序，摘要数组就这么长


@triton.jit
def softmax_stats(x_ptr, m_ptr, s_ptr, n, BLOCK: tl.constexpr):
    # 每个位置像一个线程：边读边更新自己的 {m, s}；最后把整个程序合成一份摘要
    pid = tl.program_id(0)
    m = tl.full([BLOCK], float('-inf'), tl.float32)
    s = tl.zeros([BLOCK], dtype=tl.float32)
    for start in range(pid * BLOCK, n, tl.num_programs(0) * BLOCK):
        offs = start + tl.arange(0, BLOCK)
        x = tl.load(x_ptr + offs, mask=offs < n, other=float('-inf'))
        new_m = tl.maximum(m, x)
        base = tl.where(new_m == float('-inf'), 0.0, new_m)  # 两边都空时拿 0 当基准，免得 (-inf) − (-inf)
        s = s * tl.exp(m - base) + tl.exp(x - base)
        m = new_m
    big = tl.max(m, axis=0)
    tl.store(m_ptr + pid, big)
    tl.store(s_ptr + pid, tl.sum(s * tl.exp(m - big), axis=0))
```

**第二遍：合并摘要，写输出**：

```python
@triton.jit
def softmax_write(x_ptr, y_ptr, m_ptr, s_ptr, n, parts, BLOCK: tl.constexpr, PARTS: tl.constexpr):
    # 每个程序先把所有程序的摘要合成全局的 {M, S}，再写自己那几段的输出
    idx = tl.arange(0, PARTS)
    pm = tl.load(m_ptr + idx, mask=idx < parts, other=float('-inf'))
    ps = tl.load(s_ptr + idx, mask=idx < parts, other=0.0)
    big = tl.max(pm, axis=0)
    inv = 1.0 / tl.sum(ps * tl.exp(pm - big), axis=0)
    pid = tl.program_id(0)
    for start in range(pid * BLOCK, n, tl.num_programs(0) * BLOCK):
        offs = start + tl.arange(0, BLOCK)
        x = tl.load(x_ptr + offs, mask=offs < n, other=0.0)
        tl.store(y_ptr + offs, tl.exp(x - big) * inv, mask=offs < n)


def softmax_f32(x: torch.Tensor, y: torch.Tensor, m_part: torch.Tensor, s_part: torch.Tensor):
    # m_part、s_part 至少能放 MAX_PROGRAMS 个 float32
    n = x.numel()
    programs = max(1, min(triton.cdiv(n, BLOCK), MAX_PROGRAMS))
    softmax_stats[(programs,)](x, m_part, s_part, n, BLOCK=BLOCK)
    softmax_write[(programs,)](x, y, m_part, s_part, n, programs, BLOCK=BLOCK, PARTS=MAX_PROGRAMS)
```

</RouteBlock>

## 容易写错的地方

- 空段的摘要是 {-inf, 0}。两段都空时合并出来的 m 还是 -inf，再算 (-inf) − (-inf) 就是 NaN：HIP 版在 `merge` 里提前返回，Triton 版改拿 0 当基准。
- 写输出要用合并后的全局 $M$ 和 $S$，不能用本块自己的摘要。每块合并的是同一份摘要、顺序也一样，算出来的 $M$ 和 $S$ 完全相同。
- 这里用的是 `expf`。换成更快的近似版本（例如 `__expf`）之前，先和参考结果对一遍。

## 对应本书哪一关

- {{ stage('forge-softmax') }}：先减最大值、多遍读写和单遍在线算法。那一关讲的是一行交给一个块；这道题只有一长行，所以拆给很多块，块之间靠摘要合并。
- 回到基础：{{ stage('forge-reduction-practice') }}，`block_merge` 就是块内归约换了一种「加法」。
- 深入一层：{{ stage('trial-attention') }}里的在线 Softmax 用的是同一套换基准的办法，合并的单位换成了一块一块的注意力分数。

## 交到原站之前

- 原站在 NVIDIA GPU 上判题。Triton 代码可以直接用：把 `softmax_f32` 接到原题要求的函数里，`m_part`、`s_part` 可以在函数里用 `torch.empty` 申请。
- HIP 代码要改成 CUDA：头文件换成 CUDA 的；两处 `__shfl_down(…, off)` 都换成 `__shfl_down_sync(0xffffffff, …, off)`；`hipMalloc` 换成 `cudaMalloc`。
- 函数签名和结果放在哪，按原题的要求来。

## 验证状态

这页的代码还没在 AMD 真卡上跑过。我们在 CPU 上核对过结果：HIP 代码用 HIP-CPU 按 wave 大小 64 和 32 各跑一遍，Triton 代码用 Triton 的解释器模式跑；n 从 1 到约 100 万，其中一组输入大到直接算 exp 会溢出，和双精度算出的参考值比，每个输出的误差都没超过 10⁻⁶ + 10⁻⁶ × |参考值|。真卡上的正确性和耗时：[待实测]。

[回到外部练习题](/dungeon/external/#forge)
