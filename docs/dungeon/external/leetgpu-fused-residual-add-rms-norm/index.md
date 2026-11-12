---
layout: hg
title: Fused Residual Add and RMS Norm 题解（LeetGPU）
description: LeetGPU 上 Fused Residual Add and RMS Norm 一题的原创题解：一行交给一个块，读两遍、写一遍，中间结果不落显存，并数一数融合省下多少显存流量，HIP 和 Triton 两条路线。题面请到原站看。
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

# Fused Residual Add and RMS Norm 题解

<ExternalProblem id="leetgpu-fused-residual-add-rms-norm" />

先去原站读题：题目要求、公式里每一项的位置、输入输出和函数签名都以原站为准，这里不复述。下面只讲我们的做法和代码。

## 思路

结论：一行交给一个块，读两遍、写一遍，中间结果 z = x + residual 不写回显存。

- 第一遍：块里的线程跨步走完这一行，边读 x 和 residual 边算 z，把 z² 加在寄存器里；块内求和得到平方和，0 号线程算出 1/rms，放进 [LDS](/handbook/#lds) 给全块用。
- 第二遍：再读一次 x 和 residual，重新算出 z，乘上 1/rms 和 weight，写出结果。

z 为什么不存下来：存进显存就是一写一读；存进 LDS 要看一行有多长，行太长就放不下。重算 z 只多一次加法；多读的那一遍是刚读过的数据，有机会在缓存里命中。

数一数显存流量，就知道融合能省多少。把 x 的大小（行数 × 列数 × 4 字节）记作 1 份；weight 只有一行，几种写法都要读，不算进去。

| 写法 | 第二遍重读没命中缓存 | 第二遍重读都命中缓存 |
| --- | --- | --- |
| 分开写：先做加法，再做两遍读的 RMSNorm | 读 4 份 + 写 2 份 = 6 份 | 读 3 份 + 写 2 份 = 5 份 |
| 融合（本题解） | 读 4 份 + 写 1 份 = 5 份 | 读 2 份 + 写 1 份 = 3 份 |

融合以后，z 不再写回显存，也不再读回来；代价是第二遍要重读 x 和 residual。重读都命中缓存时省 2 份，都没命中时只省 1 份。你的卡上是哪种情况：[待实测]。

## 关键代码

<RouteBlock route="hip">

**kernel 和启动**：一行一个块，每块 256 个线程。`block_sum` 用 [Reduction 题解](/dungeon/external/leetgpu-reduction/)里那一份，放在这段代码前面。

```cpp
// 一行交给一个块。z = x + residual 只在寄存器里出现，不写回显存。
// block_sum 同 Reduction 题解：块内求和，结果在 0 号线程。
__global__ void add_rmsnorm(const float* x, const float* res, const float* w, float* out, int cols, float eps) {
    const size_t base = (size_t)blockIdx.x * cols;  // 行号 × 列数可能超出 int 的范围
    float ss = 0.0f;
    for (int j = threadIdx.x; j < cols; j += blockDim.x) {
        const float z = x[base + j] + res[base + j];
        ss += z * z;
    }
    ss = block_sum(ss);
    __shared__ float inv_rms;
    if (threadIdx.x == 0) inv_rms = rsqrtf(ss / cols + eps);
    __syncthreads();
    for (int j = threadIdx.x; j < cols; j += blockDim.x) {
        const float z = x[base + j] + res[base + j];  // 再读一次 x 和 residual，代替把 z 存下来
        out[base + j] = z * inv_rms * w[j];
    }
}

void add_rmsnorm_f32(const float* x, const float* res, const float* w, float* out, int rows, int cols, float eps) {
    add_rmsnorm<<<rows, 256>>>(x, res, w, out, cols, eps);
}
```

</RouteBlock>
<RouteBlock route="triton">

**kernel 和启动**：一行一个程序，每次读 1024 个数。`tl.sum` 的结果就是整个程序共用的一个数，不用像 HIP 那样经过 LDS 广播。

```python
import torch
import triton
import triton.language as tl


@triton.jit
def add_rmsnorm(x_ptr, r_ptr, w_ptr, out_ptr, cols, eps, BLOCK: tl.constexpr):
    # 一行交给一个程序；z = x + residual 只在寄存器里出现，不写回显存
    base = tl.program_id(0).to(tl.int64) * cols  # 行号 × 列数可能超出 int32 的范围
    acc = tl.zeros([BLOCK], dtype=tl.float32)
    for start in range(0, cols, BLOCK):
        c = start + tl.arange(0, BLOCK)
        z = tl.load(x_ptr + base + c, mask=c < cols, other=0.0)
        z += tl.load(r_ptr + base + c, mask=c < cols, other=0.0)
        acc += z * z
    inv_rms = tl.rsqrt(tl.sum(acc, axis=0) / cols + eps)
    for start in range(0, cols, BLOCK):
        c = start + tl.arange(0, BLOCK)
        z = tl.load(x_ptr + base + c, mask=c < cols, other=0.0)  # 再读一次，代替把 z 存下来
        z += tl.load(r_ptr + base + c, mask=c < cols, other=0.0)
        w = tl.load(w_ptr + c, mask=c < cols, other=0.0)
        tl.store(out_ptr + base + c, z * inv_rms * w, mask=c < cols)


def add_rmsnorm_f32(x, residual, weight, out, rows: int, cols: int, eps: float):
    add_rmsnorm[(rows,)](x, residual, weight, out, cols, eps, BLOCK=1024)
```

</RouteBlock>

## 容易写错的地方

- 行的起点用 64 位算：行数 × 列数在大矩阵上会超过 int 能表示的 2³¹ − 1。HIP 版先转成 `size_t`，Triton 版先转成 `tl.int64`。
- weight 按列取（`w[j]`），所有行共用一份。
- HIP 版里 0 号线程算出的 1/rms 要放进 LDS，再等一次 `__syncthreads()`，别的线程才能读。
- eps 加在哪、weight 怎么乘，照原题的公式来。
- 一行很短时（例如只有几十个数），一块 256 个线程大多在空转，可以改成一个 wave 管一行。哪种更快：[待实测]。

## 对应本书哪一关

- {{ stage('forge-fusion') }}：数读写的字节，判断融合能省多少。上面那张表就是这一关的办法。
- {{ stage('forge-norm') }}：行级归约和逐元素运算放进同一个 kernel，也就是这道题。
- 回到基础：{{ stage('forge-reduction-practice') }}，块内求和 `block_sum` 怎么写。

## 交到原站之前

- 原站在 NVIDIA GPU 上判题。Triton 代码可以直接用：把 `add_rmsnorm_f32` 接到原题要求的函数里。
- HIP 代码要改成 CUDA：头文件换成 CUDA 的；`block_sum` 里的 `__shfl_down(v, off)` 换成 `__shfl_down_sync(0xffffffff, v, off)`；`rsqrtf` 和 `<<<>>>` 不用改。
- 函数签名和结果放在哪，按原题的要求来。

## 验证状态

这页的代码还没在 AMD 真卡上跑过。我们在 CPU 上核对过结果：HIP 代码用 HIP-CPU 按 wave 大小 64 和 32 各跑一遍，Triton 代码用 Triton 的解释器模式跑；形状从 1 行 1 列到 1 行 10 万列，另有 300 行 300 列，和双精度算出的参考值比，每个输出的误差都没超过 10⁻⁶ + 10⁻⁶ × |参考值|。真卡上的正确性和耗时：[待实测]。

[回到外部练习题](/dungeon/external/#forge)
