---
layout: hg
title: Reduction 题解（LeetGPU）
description: LeetGPU 上 Reduction 一题的原创题解：网格跨步累加、wave 内 shuffle 加 LDS 的块内求和、两遍启动的跨块合并，HIP 和 Triton 两条路线。题面请到原站看。
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

# Reduction 题解

<ExternalProblem id="leetgpu-reduction" />

先去原站读题：题目要求、输入输出和函数签名都以原站为准，这里不复述。下面只讲我们的做法和代码。

## 思路

结论：分两遍做[归约](/handbook/#reduction)，每次运行结果都一样。

第一遍派固定数量的块，最多 1024 块，每块 256 个线程。每个线程按网格跨步读完自己那份，先加在寄存器里；块里再合成一个部分和，写进 `partial[b]`。同一轮里相邻线程读相邻地址，读是[合并访存](/handbook/#coalescing)。

第二遍只派一个块，把 `partial` 里的部分和加起来写进输出。第二遍用的还是同一个 kernel，只是输入换成了部分和。

块数为什么要封顶：块数跟着 n 涨，第二遍要加的部分和也跟着涨。封顶以后，第二遍一个块一轮就能收完；n 再大，也只是第一遍每个线程多读几轮。

块内求和分两层。先在 [wavefront](/handbook/#wavefront) 内用 shuffle 两两相加，每个 wave 剩一个数；再把这些数放进 [LDS](/handbook/#lds)，[同步](/handbook/#barrier)以后合成一个。shuffle 在 lane 之间直接交换寄存器里的值，不用在 LDS 里开数组，也不用同步。

跨块合并也可以用[原子操作](/handbook/#atomic)：每块对输出做一次 `atomicAdd`，省掉第二遍。代价是结果不可复现：浮点加法不满足结合律，块的完成顺序每次都不一样，结果的最后几位会变；输出还要先清零。这里选两遍，多出来的那次启动只有一个块。

## 关键代码

<RouteBlock route="hip">

**块内求和**：wave 大小不写死。HIP 的 `warpSize` 在 gfx9 架构上是 64，在 gfx10 及以后是 32（[HIP 文档](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html#warpsize)），LDS 数组按最多 32 个 wave 开，两种都够用。

```cpp
#include <hip/hip_runtime.h>
#include <algorithm>

// 块内求和：wave 内用 shuffle 两两相加，wave 之间经过 LDS。
// 块里所有线程都要调用（里面有 __syncthreads），结果只在 0 号线程上有效。
__device__ float block_sum(float v) {
    __shared__ float wave_sums[32];  // 一块最多 1024 个线程、wave 至少 32 个 lane：最多 32 个 wave
    const int lane = threadIdx.x % warpSize;
    const int wave = threadIdx.x / warpSize;
    for (int off = warpSize / 2; off > 0; off /= 2)
        v += __shfl_down(v, off);
    if (lane == 0) wave_sums[wave] = v;
    __syncthreads();
    const int waves = (blockDim.x + warpSize - 1) / warpSize;
    v = threadIdx.x < waves ? wave_sums[threadIdx.x] : 0.0f;
    __syncthreads();                 // 大家都读完再往下走：连着调用两次也不会互相覆盖
    for (int off = warpSize / 2; off > 0; off /= 2)
        v += __shfl_down(v, off);    // 每个 wave 都再收一遍，0 号 wave 收到的才是总和
    return v;
}
```

**kernel 和两遍启动**：

```cpp
constexpr int THREADS = 256;     // 每块的线程数，是 wave 大小的整数倍
constexpr int MAX_BLOCKS = 1024; // 第一遍最多派这么多块，部分和数组就这么长

// 每个线程跨步累加，块内求和，第 b 块的结果写进 partial[b]
__global__ void sum_kernel(const float* x, float* partial, int n) {
    float v = 0.0f;
    for (int i = blockIdx.x * blockDim.x + threadIdx.x; i < n; i += gridDim.x * blockDim.x)
        v += x[i];
    v = block_sum(v);
    if (threadIdx.x == 0) partial[blockIdx.x] = v;
}

// x、out、partial 都在显存里；partial 至少能放 MAX_BLOCKS 个 float
void sum_f32(const float* x, float* out, int n, float* partial) {
    const int blocks = std::max(1, std::min((n + THREADS - 1) / THREADS, MAX_BLOCKS));
    sum_kernel<<<blocks, THREADS>>>(x, partial, n);   // 第一遍：每块一个部分和
    sum_kernel<<<1, THREADS>>>(partial, out, blocks);  // 第二遍：一个块把部分和加起来
}
```

</RouteBlock>
<RouteBlock route="triton">

**块内求和**：不用自己写。`tl.sum` 由编译器生成块内归约：先在 wave 内交换数据，再经过 LDS 合并各个 wave 的结果。

**kernel 和两遍启动**：每个程序（相当于一个块）按 `BLOCK` 个元素一段跨步读，先按位置累加成一个向量，最后用 `tl.sum` 收成一个数。

```python
import torch
import triton
import triton.language as tl

BLOCK = 1024         # 每个程序一次读的元素个数
MAX_PROGRAMS = 1024  # 第一遍最多启动这么多个程序，部分和数组就这么长


@triton.jit
def sum_kernel(x_ptr, partial_ptr, n, BLOCK: tl.constexpr):
    # 每个程序跨步读自己那几段，先按位置累加成一个向量，最后 tl.sum 收成一个数
    pid = tl.program_id(0)
    acc = tl.zeros([BLOCK], dtype=tl.float32)
    for start in range(pid * BLOCK, n, tl.num_programs(0) * BLOCK):
        offs = start + tl.arange(0, BLOCK)
        acc += tl.load(x_ptr + offs, mask=offs < n, other=0.0)
    tl.store(partial_ptr + pid, tl.sum(acc, axis=0))


def sum_f32(x: torch.Tensor, out: torch.Tensor, partial: torch.Tensor):
    # x、out、partial 都在 GPU 上；partial 至少能放 MAX_PROGRAMS 个 float32
    n = x.numel()
    programs = max(1, min(triton.cdiv(n, BLOCK), MAX_PROGRAMS))
    sum_kernel[(programs,)](x, partial, n, BLOCK=BLOCK)    # 第一遍：每个程序一个部分和
    sum_kernel[(1,)](partial, out, programs, BLOCK=BLOCK)  # 第二遍：一个程序把部分和加起来
```

</RouteBlock>

## 容易写错的地方

- `block_sum` 里有两次 `__syncthreads()`，块里每个线程都要走到。把它放进只有一部分线程进得去的 `if` 里，会卡死或者读到旧值。
- 第二轮 shuffle 让每个 wave 都跑：别的 wave 只是在加 0，多几条指令，换来所有线程走同一段代码。只让 0 号 wave 跑也对，前提是这个 wave 的 lane 全都在场。
- 浮点数换个顺序加，结果的最后几位就会变。和 `torch.sum` 或 CPU 上的结果比较时要给容差，不要要求逐位相等。
- `partial` 提前申请好再计时。把 `hipMalloc` 放进计时的范围里，测到的有一部分是申请显存的时间。

## 对应本书哪一关

- {{ stage('forge-reduction-practice') }}：这道题用到这一关的全部内容：wave 内归约、LDS、跨块合并、原子操作的代价。
- 回到基础：{{ stage('novice-lds-sync') }}讲 LDS 和同步，{{ stage('novice-reduction') }}讲块内归约为什么要一轮一轮地折半。
- 深入一层：{{ stage('trial-wave-cooperation') }}讲 shuffle 这类跨 lane 操作；{{ stage('trial-memory-advanced') }}讲向量化加载，可以让每个线程一次读 4 个数。

## 交到原站之前

- 原站在 NVIDIA GPU 上判题。Triton 代码可以直接用：把 `sum_f32` 接到原题要求的函数里。`partial` 可以在函数里用 `torch.empty` 申请，这次申请会算进计时。
- HIP 代码要改成 CUDA：头文件换成 CUDA 的；`__shfl_down(v, off)` 换成 `__shfl_down_sync(0xffffffff, v, off)`；`hipMalloc` 换成 `cudaMalloc`。NVIDIA 的 `warpSize` 是 32，`<<<>>>` 的写法不变。
- 函数签名和结果放在哪，按原题的要求来。

## 验证状态

这页的代码还没在 AMD 真卡上跑过。我们在 CPU 上核对过结果：HIP 代码用 HIP-CPU 按 wave 大小 64 和 32 各跑一遍，Triton 代码用 Triton 的解释器模式跑；n 从 1 到约 300 万，和双精度算出的参考值比，误差都没超过所有数绝对值之和的 10⁻⁷ 倍。浮点求和的误差跟着绝对值之和走：正负抵消以后结果很小，误差不会跟着变小，所以不按结果的相对误差算。真卡上的正确性和耗时：[待实测]。

[回到外部练习题](/dungeon/external/#forge)
