---
title: "第8章 Element-Wise：逐元素算子"
description: "Hello GPU 第8章 · 从数组加法和下标动画出发，理解连续访存、线程循环、向量化尾部与 Triton mask"
---

<script setup lang="ts">
import ElementwiseJourney from './elementwise-journey.vue'
</script>

# 第8章 Element-Wise：逐元素算子

## 本章导读

> 前面几章已经测量过向量加法。现在我们保持 `C[i] = A[i] + B[i]` 不变，研究另一件事：同样一批元素，怎样交给 GPU 执行，才有机会更快？从这个小问题出发，我们逐步观察独立输出、连续访问、线程重复工作和尾部处理。
>
> 读完后，你应该能解释一个元素由谁计算，判断两个版本是否进行了公平比较，并根据真实结果说明一次改动带来了什么。第 4–7 章的程序、计时与 profiling 是本章基础；HIP 和 Triton 的语法可以按需查阅附录。

你可以先读共同的数学与动画，再选择一种语言：

| 阅读路线 | 如何开始 |
| ---- | ---- |
| 第一次接触 GPU 核函数 | 先读 [编程范式附录](../../appendix/programming-models/index.md)，再回到 8.1 的小数组 |
| 从 HIP 开始 | 阅读 8.1–8.3，在 [实现节](#_8-4-实现向量加法)选择 HIP，最后阅读共同的实验和对照 |
| 从 Triton 开始 | 阅读 8.1–8.3，在 [实现节](#_8-4-实现向量加法)选择 Triton，最后阅读共同的实验和对照 |

## 8.1 先认识 Element-Wise

### 8.1.1 不看名字，先看依赖关系

判断一个算子是不是逐元素，最稳妥的方法不是背算子表，而是观察一个输出依赖哪些输入。

Vector Add 的定义是：

$$
C_i = A_i + B_i, \qquad 0 \le i \lt N
$$

想得到 `C[3]`，只需要 `A[3]` 与 `B[3]`。`A[0]`、`A[1]` 或其他位置都不会影响它。因此不同输出位置之间没有数据依赖，可以彼此独立地计算。

::: figure fig-elementwise-dependency
<ElementwiseJourney scenario="dependency" />

Vector Add 的逐元素依赖：当前位置只读取对应的两个输入位置。
:::

如 @fig-elementwise-dependency 所示，动画每一步只激活同一列中的 `A[i]`、`B[i]` 与 `C[i]`，结尾的「并行俯瞰」把各列完成顺序打乱以凸显独立性。真实 GPU 会并行处理许多列；这里故意逐步播放，是为了让依赖关系更容易看清。本章全部动画共用同一种播放器：**拖动进度条可擦洗到任意中间状态**，点步骤标签可跳步，键盘 `←`/`→` 逐步、空格播放暂停。

同一模式还包括：

| 算子 | 单个输出的表达式 | `Y[i]` 依赖什么 |
| ---- | ---- | ---- |
| Add | `Y[i] = A[i] + B[i]` | `A[i]`、`B[i]` |
| ReLU | `Y[i] = max(X[i], 0)` | `X[i]` |
| Scale & Bias | `Y[i] = alpha * X[i] + beta` | `X[i]` 与两个标量 |
| Clamp | `Y[i] = min(max(X[i], low), high)` | `X[i]` 与上下界 |

它们的计算表达式不同，但数据划分方法相似：先把互不依赖的下标分出去，再处理对应元素。HIP 与 Triton 对“怎样分出去”给出了不同的源码视角。

### 8.1.2 先选择一条实现路线

同一个加法可以用两种视角描述。HIP 的核函数先描述一个线程：它得到一个下标，读取两个数并写回结果。Triton 的核函数先描述一块数据：它生成一组下标，对这一组位置执行加载、加法和写回。

如果你还不熟悉这些词，可以先读 [附录 D：HIP 与 Triton 的编程范式](../../appendix/programming-models/index.md)。附录用同一个带尾部的数组解释 thread/block、program/tile 和 `if`/mask，并把语法对应到实际源码。读完再回到本章即可，不需要先学完两门语言。

后面的实现节提供 **HIP / Triton 标签页**。先选择熟悉的一种语言，沿着一个可运行的实现读下去；数学问题、正确性检查和最终对照是两条路线共用的。

### 8.1.3 什么不属于这一类

如果输出 `Y[i]` 需要一整段输入，事情就变了。例如 Sum Reduction 要把很多输入合成一个值，线程之间必须协作；Softmax 还要先求一行最大值与总和。它们分别是[第 9 章 Reduction](../chapter9/index.md)和[第 10 章 Normalization](../chapter10/index.md)的主角。

因此，“输入输出形状相同”不是逐元素的充分条件。真正重要的是**输出位置之间能不能独立完成**。

## 8.2 固定数学语义与正确性标准

### 8.2.1 先用 4 个元素手算

给定：

```text
A = [2, -1, 4, 3]
B = [7,  3, -1, 2]
```

逐位置相加：

```text
C[0] = 2  + 7  = 9
C[1] = -1 + 3  = 2
C[2] = 4  + -1 = 3
C[3] = 3  + 2  = 5

C = [9, 2, 3, 5]
```

这个例子已经包含完整语义。把长度从 4 换成几千万，数学没有变化，变化的是我们怎样把这些位置交给 GPU。

### 8.2.2 固定同一份裁判规则

本章配套程序让 HIP 与 Triton 使用相同规则：

| 项目 | 固定方式 |
| ---- | ---- |
| 数学语义 | `C[i] = A[i] + B[i]` |
| 数据类型 | 32 位浮点数（FP32） |
| 输入 | 用同一确定性整数公式生成，再转成 FP32 |
| 参考结果 | CPU 逐元素执行同一个 FP32 加法 |
| 边界 | 覆盖小于 wavefront、刚好等于 block、比 block 多 1、不能被 4 整除等长度 |
| 正确性 | 正式计时前检查一次，计时后再检查一次 |
| 计时范围 | 只计 GPU kernel，不含分配、输入生成与 Host-to-Device 拷贝 |

为什么需要检查奇怪的长度？因为真实输入不会永远刚好等于 block size 的整数倍。若 `N=1027`，最后一个 block 只有少数位置有效；没有边界保护的 kernel 会访问数组外部。

PyTorch 参考写法只有一行：

```python
reference = input_a + input_b
```

短不代表可以省略它。自定义 kernel 的第一个目标永远是与参考结果一致；一个错误但很快的 kernel 没有比较价值。

### 8.2.3 把“尾部”加入裁判规则

边界长度专门检查最后一组不完整的位置。例如 `N=13`、候选下标为 `8–15` 时，只有 `8–12` 有效：HIP 由各 thread 的标量 `if` 关闭越界下标，Triton 由 mask 逐位置关闭越界 load/store。这是在落实 @fig-hip-triton-paradigms 的同一条规则，不再引入第三种分工方式。

## 8.3 建立成本模型和瓶颈假设

### 8.3.1 真正忙的可能不是加法器

对一个 FP32 输出元素，最理想的逻辑工作量是：

| 动作 | 数量 | 逻辑字节 |
| ---- | ----: | ----: |
| 读取 `A[i]` | 1 个 FP32 | 4 Byte |
| 读取 `B[i]` | 1 个 FP32 | 4 Byte |
| 执行加法 | 1 次浮点加法 | 1 FLOP |
| 写回 `C[i]` | 1 个 FP32 | 4 Byte |
| 合计 |  | 12 Byte + 1 FLOP |

所以它的理想算术强度是：

$$
AI_{logical} = \frac{1\ \text{FLOP}}{12\ \text{Byte}}
             \approx 0.0833\ \text{FLOP/Byte}
$$

这只是从算子语义推导出的**逻辑下界**，不是性能实测。缓存命中、未合并访问、对齐和实际内存事务都可能让物理流量不同。

从这个比例可以提出一个等待实验检验的假设：

> Vector Add 每搬 12 Byte 只做 1 次加法，当前大 shape 可能更容易受显存带宽限制，而不是受浮点计算吞吐限制。

第 7 章已经解释怎样在 Roofline 上读工作点；这里不再重推硬件参考线，只保留与当前算子直接相关的假设：Vector Add 的逻辑算术强度很低，当前大 shape 更可能先受数据搬运限制。注意用词仍是“更可能”。后文会用 Radeon RX 9070 XT 上的 GPU event 时间和受控地址实验检验它。即使逻辑有效带宽较高，也只能说明结果与访存受限假设一致；没有物理流量计数器时，不能把逻辑字节直接当成显存事务。

### 8.3.2 有效带宽怎样算

本章统一用计时区间中的逻辑字节计算有效带宽：

$$
BW_{effective} = \frac{3 \times N \times 4\ \text{Byte}}{t}
$$

其中 `t` 是一次 kernel 的 GPU event 时间。这个指标适合在**相同语义、相同 shape、相同计时范围**下比较版本，但它不等于内存控制器实际传输了多少字节。物理流量必须由可用的硬件计数器或更进一步的分析支持。

## 8.4 实现向量加法

选择下面的一条路线开始。两种实现完成相同的加法，输入与输出要求不变；切换标签可以对照线程下标与 tile 下标怎样表达同一件事。

<ImplementationTabs id="ch8-implementations">

<template #hip>


### 8.4.1 HIP：先读标量线程的工作

HIP 篇更适合下面的读者：

- 想知道 block、thread、wavefront 最后怎样变成具体地址；
- 愿意读少量 C++，并希望控制 grid、加载类型与尾部路径；
- 后续想继续学习 LDS、Wave Shuffle、VGPR 等更底层机制；
- 遇到性能问题时，希望能从源码一路追到 kernel trace。

第一次读 HIP 不需要先记住所有硬件名词。本节只反复使用四个对象：

```text
grid 里有多个 block
block 里有多个 thread
相邻 thread 以 wavefront 为硬件执行组
thread 最终访问全局内存中的地址
```

用一组具体数字锚定：本章 `N=16,777,216`、`blockDim.x=256`，那么 grid 需要 `65,536` 个 block；每个 block 里的 256 个 thread 按 32 个一组编成 8 个 wavefront；每个 thread 用 `blockIdx.x × 256 + threadIdx.x` 算出自己负责的那一个地址。后文所有版本只是在改变“哪个 thread 访问哪个地址、一次访问多少字节”。

### 8.4.2 HIP v0：一个线程处理一个元素

最短的正确 kernel 是：

```cpp
__global__ void vector_add_v0(const float* __restrict__ input_a,
                              const float* __restrict__ input_b,
                              float* __restrict__ output,
                              std::size_t size) {
    const std::size_t index =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (index < size) {
        output[index] = input_a[index] + input_b[index];
    }
}
```

先把索引公式拆开：

```text
blockIdx.x * blockDim.x    当前 block 之前有多少线程
+ threadIdx.x              当前线程在 block 内的位置
= index                    当前线程负责的全局元素下标
```

例如 `blockDim.x=256`，第 2 个 block 中的第 3 个线程得到：

```text
index = 2 × 256 + 3 = 515
```

它只处理 `C[515] = A[515] + B[515]`。最后一个 block 可能越过 `size`，所以 `if (index < size)` 不能省略。

当相邻线程得到相邻 `index` 时，它们也会访问相邻的 FP32 地址。AMD 的 HIP 性能指南把这种排列称为 coalesced memory access（合并访存）：硬件有机会把多个线程的请求组合成更少的内存事务。这里先把它当作**地址结构事实**；实际事务数与性能仍要测量。

### 8.4.3 HIP v1：怎样公平比较连续与跨步

一个常见教学错误是：连续版每线程处理 1 个元素，跨步版每线程处理 32 个元素，然后直接比较时间。此时改变的不只是地址顺序，还包括 grid、循环次数和每线程工作量，无法知道差异来自哪里。

本章改用一个受控实验。真实代码与动画缩略的比例如下，两边只改“同一轮内 lane 到地址的排列”，其余全部固定：

| 配置 | 真实 HIP 代码 | @fig-hip-coalescing 动画 |
| ---- | ---- | ---- |
| 执行单元 | 1 个 wave32（32 个 lane） | 8 个 lane |
| 每 lane 处理 | 32 个元素 | 4 个元素 |
| 全部轮次覆盖 | 32 × 32 = 1024 元素 | 8 × 4 = 32 元素 |
| grid / block / 循环次数 / 逻辑字节 | 两边相同 | 两边相同 |

::: figure fig-hip-coalescing
<ElementwiseJourney scenario="memory" />

合并访存受控对照的缩略动画：两边处理同一批元素，只改变每一轮的下标排列。图中 32B 地址组是帮助观察聚集度的教学分桶，不是实测硬件事务计数；连续顺序每轮触及 1 组，跨步顺序每轮触及 4 组。动画结尾给出 4 轮的累计落点对照，并以 9070 XT 实测逻辑有效带宽（`hip-v1` 两版，见 8.5.2）收束。
:::

左侧连续版在第 `round` 轮使用：

```text
index = base + round × wave_size + lane
```

右侧跨步版只交换两个维度：

```text
index = base + lane × rounds + round
```

四轮动画结束后，两边都覆盖下标 `0–31`，没有重复也没有遗漏。连续顺序的累计组访问依次为 `1 / 2 / 3 / 4`，跨步顺序依次为 `4 / 8 / 12 / 16`。这仍是地址分组层面的教学计数；正式 HIP 代码保持相同的 grid、block、每 lane 循环次数、加法次数和逻辑字节，物理事务与性能由后续实测判断。

```text
连续：base + round * 32 + lane
跨步：base + lane * 32 + round
```

这个实验要验证的不是“跨步一定慢多少”，而是：

> 在当前 RX 9070 XT、当前 shape 与当前编译结果下，只改变 wavefront 内地址顺序，kernel 时间和 trace 是否出现可重复差异？

2026-07-19 最终 curated evidence 给出了可重复差异：连续版的三进程 median 是 `0.369584 ms`，跨步版是 `2.567170 ms`，跨步版用时约为连续版的 `6.95×`。两者的 kernel trace 都记录到相同的 `524,288` 个 work-item、workgroup size 256、VGPR 16、SGPR 128、LDS 0 Byte 和 scratch 0 Byte；grid、循环次数、算术与逻辑字节也相同。

因此，当前证据支持“wave32 同轮地址顺序显著影响这个 Vector Add”的判断。它仍没有直接数出物理显存事务，所以更严格的措辞是：**受控地址变化与约 `6.95×` 时间差同时出现，并且现有 trace 资源字段没有提供其他差异。**

### 8.4.4 HIP v2：Grid-Stride Loop 让线程重复工作

v0 启动足够多的线程，让每个线程只处理一个位置。另一种常见写法是限制 grid，让线程每隔整个 grid 的跨度继续处理下一个元素：

```cpp
const std::size_t thread =
    static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
const std::size_t grid_stride =
    static_cast<std::size_t>(gridDim.x) * blockDim.x;

for (std::size_t index = thread; index < size; index += grid_stride) {
    output[index] = input_a[index] + input_b[index];
}
```

假设 grid 一共包含 1024 个线程：

```text
线程 0：0, 1024, 2048, ...
线程 1：1, 1025, 2049, ...
线程 2：2, 1026, 2050, ...
```

在同一轮循环中，相邻线程依旧访问相邻元素，因此 Grid-Stride 与“连续访存”并不冲突。

本章代码默认把 v2 的 grid 上限设为“设备 CU 数量 × 8”，并把最终 grid 写入 `RESULT`。这只是待验证的起点，不是通用最优值。减少 block 数可能降低调度开销，也可能让并行度不足；两种方向都要由实测回答。

### 8.4.5 HIP v3：`float4` 与尾部不是一回事

FP32 标量占 4 Byte，`float4` 把 4 个 FP32 组合成 16 Byte 类型。v3 先把完整的四元素组交给向量路径，再用标量处理最后 `0–3` 个元素。

::: figure fig-hip-float4-tail
<ElementwiseJourney scenario="vector" />

`N=18` 时的 `float4` 源码分组与标量尾部。动画只画输入 A 的读取；输入 B 的读取与输出 C 的写回采用同样分组。该分组不等同于物理显存事务一定减少。
:::

核心结构是：

```cpp
const std::size_t vector_count = size / 4;

for (std::size_t vector_index = thread;
     vector_index < vector_count;
     vector_index += grid_stride) {
    const float4 a = input_a4[vector_index];
    const float4 b = input_b4[vector_index];
    output4[vector_index] =
        make_float4(a.x + b.x, a.y + b.y, a.z + b.z, a.w + b.w);
}

// hipMalloc returns suitably aligned base pointers. The scalar loop keeps
// the final 0-3 values correct when size is not divisible by four.
for (std::size_t index = vector_count * 4 + thread;
     index < size;
     index += grid_stride) {
    output[index] = input_a[index] + input_b[index];
}
```

这里有三个容易混淆的事实：

1. `hipMalloc` 返回的基地址满足本例向量类型的对齐要求，但从任意偏移地址强转成 `float4*` 未必安全。
2. 使用 `float4` 只说明源码请求了向量类型，不自动证明最终指令数量或显存事务减少。
3. `N % 4 != 0` 时，尾部路径是正确性要求，不是可选优化。

因此 v3 仍然要检查编译结果、边界输入、kernel trace 和时间。若它没有变快，这也是有效结果：说明“源码向量化必然提速”的假设在当前条件下没有成立。

### 8.4.6 HIP 路线当前能下什么结论

HIP ladder 已经把三个问题拆开：v1 只控制同一轮的地址顺序，v2 改变 grid 与每线程工作方式，v3 再引入源码向量类型和尾部路径。单看代码不能给它们排快慢；统一的正确性、benchmark 和 trace 数据放在 [共同实验](#_8-5-正确性、benchmark-与-profiling)，负结果与边界在 [适用边界](#_8-7-负结果、适用边界与下一步) 汇总。

完整实现位于 `code/part2-kernels/chapter8/vector_add_hip.hip`。


</template>

<template #triton>


### 8.4.7 Triton：先读一块数据的工作

先看一个 program 处理哪些位置，再读对应的加载和写回。如果还不清楚 program 与 thread 的区别，可以按需阅读 [Triton 编程范式](../../appendix/programming-models/index.md#triton-model)。

Triton 不是“无需理解硬件”。它把许多线程级细节交给编译器，但 program 怎样切 tile、地址是否连续、mask 是否正确、参数是否合适，仍由程序员负责。

### 8.4.8 Triton kernel：从下标到读写

```python
@triton.jit
def vector_add_kernel(
    input_a_ptr,
    input_b_ptr,
    output_ptr,
    size,
    BLOCK_SIZE: tl.constexpr,
):
    """Add one tile of two FP32 vectors per Triton program."""
    program_id = tl.program_id(axis=0)
    offsets = program_id * BLOCK_SIZE + tl.arange(0, BLOCK_SIZE)
    valid = offsets < size

    input_a = tl.load(input_a_ptr + offsets, mask=valid, other=0.0)
    input_b = tl.load(input_b_ptr + offsets, mask=valid, other=0.0)
    tl.store(output_ptr + offsets, input_a + input_b, mask=valid)
```

逐行看，不需要先背语法：

1. `@triton.jit` 告诉 Triton：下面定义的是要即时编译的 kernel。
2. `tl.program_id(0)` 取得当前 program 在一维网格中的编号。
3. `tl.arange(0, BLOCK_SIZE)` 生成一个 tile 内的局部下标。
4. `program_id * BLOCK_SIZE` 把局部下标移动到当前 tile 的起点。
5. `valid` 标记哪些下标没有越过 `size`。
6. 两次 `tl.load` 读取相同 offsets 的 A/B。
7. `tl.store` 把逐元素加法写回相同 offsets 的 C。

最值得注意的是：`offsets` 不是一个 Python 整数，而是一整组下标。Triton 代码看起来像在操作向量，编译器再把这块工作映射到底层 GPU 执行资源。

### 8.4.9 Host wrapper 负责设置网格并启动

输出已经由调用方分配好。下面的 host 函数从 `Implementation` 读取分块参数，设置网格并启动 kernel：

```python
def launch(
    implementation: Implementation,
    input_a: torch.Tensor,
    input_b: torch.Tensor,
    output: torch.Tensor,
) -> None:
    size = output.numel()
    grid = (triton.cdiv(size, implementation.block_size),)
    vector_add_kernel[grid](
        input_a,
        input_b,
        output,
        size,
        BLOCK_SIZE=implementation.block_size,
        num_warps=NUM_WARPS,
    )
```

`triton.cdiv(size, implementation.block_size)` 是向上取整。`N=13`、`BLOCK_SIZE=8` 时需要 2 个 program；第二个 program 生成 `8–15`，再由 mask 关闭 `13–15`。

配套脚本使用 `torch.cuda.Event` 与 `device="cuda"`。在 ROCm 版 PyTorch 中看到 `cuda` 不表示代码跑到了 NVIDIA GPU；PyTorch 官方为了兼容现有生态，HIP 后端继续复用 `torch.cuda` 接口，可通过 `torch.version.hip` 确认当前构建。

### 8.4.10 Triton t0/t1：先只改一个参数

本章保留同一个 kernel，只改变 `BLOCK_SIZE`：

| 版本 | `BLOCK_SIZE` | `num_warps` | 改变了什么 |
| ---- | ----: | ----: | ---- |
| `triton-t0` | 256 | 4 | 最小正确 baseline |
| `triton-t1` | 1024 | 4 | 每个 program 覆盖更多元素，program 数量减少 |

这里把 `num_warps` 固定为 4，是为了让 block size 成为主要变量。`num_warps` 是 Triton 的元参数，指定编译一个 program 时使用多少个 warp/wavefront 执行组；它大致对应 HIP 语境里“一个 block 占几个 wavefront”，但 tile 元素怎样落到 lane 与寄存器仍由编译器决定。`BLOCK_SIZE` 更大可能减少 program 数量，也可能改变资源使用与调度；在实测前不能把 t1 称为“优化版”。

### 8.4.11 用小数组理解 offsets 和 mask

先不运行新的工具，直接观察 `N=13`、每个 program 覆盖 8 个位置时的下标。第一个 program 处理 `0–7`；第二个生成 `8–15`，但只能读写 `8–12`。

::: figure fig-triton-program-mask
<ElementwiseJourney scenario="triton" />

第二个 program 生成一整组下标，mask 保留五个有效位置。越界位置不会访问输入，也不会写回输出；这里展示的是算法索引过程。
:::

在 @fig-triton-program-mask 中先选择第二个 program，再看 mask 如何对应到每个下标。输入加载的 `other=0.0` 给关闭的位置一个占位值；保护输出仍需要 `tl.store` 自己的 mask，不能只给 load 加 mask。

### 8.4.12 Triton 路线当前结果

Triton ladder 只把 `BLOCK_SIZE` 从 256 改为 1024，并保持 `num_warps=4`。更大的 tile 同时减少 program 数并改变资源需求，所以仍要把时间范围和 trace 放在一起读。统一结果见 [共同实验](#_8-5-正确性、benchmark-与-profiling)，不能只看到 program 数减少就提前宣布胜负。

完整实现位于 `code/part2-kernels/chapter8/vector_add_triton.py`；可视化入口位于 `code/part2-kernels/chapter8/visualize_triton.py`。


</template>

</ImplementationTabs>

## 8.5 正确性、Benchmark 与 Profiling

本节只发布 `code/part2-kernels/chapter8/evidence/` 中已经进入 curated evidence 的字段。实验基线是 **AMD Radeon RX 9070 XT（gfx1201）+ ROCm 7.13.99004 + 原生 Ubuntu 24.04.4 LTS**；输入为 `N=16,777,216` 个 FP32 元素。

### 8.5.1 正确性矩阵

发布行都经过独立进程汇总，`correct` 与 `max_abs_error` 直接来自 `summary.csv`。正式计时前，`run_all.sh` 还会检查小于 wavefront、block 边界、block 加一和不能被向量宽度整除的输入。

| Implementation | Runtime | Shape | Block | Grid | Correct | Max abs error |
| ---- | ---- | ----: | ----: | ----: | ---- | ----: |
| `hip-v0` | hip | 16777216 | 256 | 65536 | OK | 0.0 |
| `hip-v1-contiguous` | hip | 16777216 | 256 | 2048 | OK | 0.0 |
| `hip-v1-strided` | hip | 16777216 | 256 | 2048 | OK | 0.0 |
| `hip-v2` | hip | 16777216 | 256 | 256 | OK | 0.0 |
| `hip-v3` | hip | 16777216 | 256 | 256 | OK | 0.0 |
| `triton-t0` | triton | 16777216 | 256 | 65536 | OK | 0.0 |
| `triton-t1` | triton | 16777216 | 1024 | 16384 | OK | 0.0 |

### 8.5.2 Benchmark 口径与发布结果

每个进程先 warmup 10 次、正式计时 50 次；每个发布值先取进程内 median，再对 3 个独立进程的 median 取中位数。计时范围是 GPU event，不含分配、输入生成和 Host-to-Device 拷贝。

| Implementation | Median (ms) | Run range (ms) | Logical effective bandwidth (GB/s) | Run range (GB/s) |
| ---- | ----: | ----: | ----: | ----: |
| `hip-v0` | 0.336324 | 0.336224–0.337965 | 598.609044 | 595.703362–598.787113 |
| `hip-v1-contiguous` | 0.369584 | 0.367805–0.370344 | 544.738374 | 543.620507–547.373904 |
| `hip-v1-strided` | 2.567170 | 2.539349–2.581509 | 78.423556 | 77.987935–79.282759 |
| `hip-v2` | 0.343484 | 0.341984–0.345644 | 586.130918 | 582.468070–588.701781 |
| `hip-v3` | 0.345224 | 0.344864–0.347444 | 583.176683 | 579.450457–583.785476 |
| `triton-t0` | 0.336204 | 0.335084–0.336803 | 598.823604 | 597.756836–600.824263 |
| `triton-t1` | 0.338504 | 0.338404–0.338844 | 594.753950 | 594.157167–594.929706 |

::: figure fig-vector-add-bandwidth
![七个 HIP 与 Triton Vector Add 实现的逻辑有效带宽；跨步 HIP 版本明显低于其余连续访问版本](./images/vector-add-ch7-bandwidth.png)

Radeon RX 9070 XT 上的 Vector Add 逻辑有效带宽；柱长为三进程中位数，误差线为三进程范围。
:::

图和表中的带宽都按 `12 Byte × N / 时间` 计算，是方便同语义版本比较的**逻辑有效带宽**。它不等于内存控制器实际传输的物理 GDDR6 流量。

### 8.5.3 Profiling 字段

`profile_all.sh` 为每个实现启动独立的 `rocprofv3` kernel trace。下面逐格来自 `profile_summary.csv`；dispatch 数、grid、workgroup 与资源字段不从源码反推。这里的 Grid X 是 trace 报告的工作项范围，不是 block 或 Triton program 数；例如 HIP v0 的 `16777216 / 256 = 65536` 才是该次启动的 block 数。

| Implementation | Dispatches | Grid X | Workgroup X | LDS B | Scratch B | VGPR | Accum VGPR | SGPR |
| ---- | ----: | ----: | ----: | ----: | ----: | ----: | ----: | ----: |
| `hip-v0` | 6 | 16777216 | 256 | 0 | 0 | 8 | 0 | 128 |
| `hip-v1-contiguous` | 6 | 524288 | 256 | 0 | 0 | 16 | 0 | 128 |
| `hip-v1-strided` | 6 | 524288 | 256 | 0 | 0 | 16 | 0 | 128 |
| `hip-v2` | 6 | 65536 | 256 | 0 | 0 | 16 | 0 | 128 |
| `hip-v3` | 6 | 65536 | 256 | 0 | 0 | 16 | 0 | 128 |
| `triton-t0` | 6 | 8388608 | 128 | 0 | 0 | 8 | 0 | 128 |
| `triton-t1` | 6 | 2097152 | 128 | 0 | 0 | 24 | 0 | 128 |

## 8.6 HIP 与 Triton 对照

### 8.6.1 把两种语言放回同一张数据流

| 要回答的问题 | HIP 写法 | Triton 写法 |
| ---- | ---- | ---- |
| 源码中显式编号的并行实例 | `blockIdx.x`、`threadIdx.x` 选出当前 thread | `tl.program_id(0)` 选出当前 program |
| 一次分多少数据 | 通常从一个 thread 的标量工作开始 | 一个 program 的 tile |
| 生成下标 | 标量 `index`，或在线程循环中递增 | 张量 `offsets` |
| 保护尾部 | `if (index < size)` | `mask = offsets < size` |
| 读取 | 指针下标或显式向量类型 | `tl.load(pointer + offsets, mask=...)` |
| 计算 | C++ 标量/向量表达式 | tile 上的张量表达式 |
| 写回 | 指针下标 | `tl.store(..., mask=...)` |
| 主要显式参数 | grid、block、每线程工作、加载类型 | program grid、block size、num warps |
| 主要风险 | 越界、对齐、并行度、资源压力 | mask、tile 过大、program 映射、资源压力 |

HIP 的一个 thread 与 Triton 的一个 program **不是一一对应**。更准确的迁移方法是先问三次：

```text
1. 这一组输出下标是什么？
2. 它们读取哪些输入下标？
3. 尾部哪些位置必须关闭？
```

只要这三件事对应起来，语言差异就不会遮住算子本身。

### 8.6.2 什么时候先选哪条路线

| 当前目标 | 更自然的起点 | 原因 |
| ---- | ---- | ---- |
| 第一次验证一个简单算子想法 | Triton | kernel 与 Host wrapper 较短，tile/mask 容易修改 |
| 精确控制 thread 到地址的排列 | HIP | grid、thread、指针与加载类型直接暴露 |
| 研究 Wave/LDS/VGPR 细节 | HIP | 更靠近 AMD 执行与资源模型 |
| 快速尝试多个 tile 参数 | Triton | meta-parameter 与 Python 驱动更集中 |
| 定位地址或 mask 错误 | 下标动画与完整输出校验，再结合 GPU trace | 两边都要回到实际地址证据 |

同一个算子可以先用 Triton 验证算法，再用 HIP 追底层细节；也可以从 HIP baseline 出发，完全不重写。路线选择服务于当前问题，不建立跨 shape、跨软件栈的语言排名。

### 8.6.3 怎样读这次对照

这次 HIP 与 Triton 对照使用相同输入公式、FP32 语义、shape、warmup、repeat 与 kernel-only 计时边界。当前快照中 `triton-t0` 与 `hip-v0` 的三进程范围重叠，中心值差约 `0.00012 ms`；不能据此外推另一种环境中的胜负。

更可靠的共同结论是：先保持地址连续和边界正确，再用目标 shape 实测 grid、tile 与向量类型；更少的 block/program 或更宽的源码类型都不自动等于更快。

## 8.7 负结果、适用边界与下一步

负结果不是删掉的草稿，而是下一轮实验的输入：

- 受控跨步版本的 median 是 `2.567170 ms`，逻辑有效带宽是 `78.423556 GB/s`；它是本次最明确的负例，但仍没有直接测得物理显存事务。
- `hip-v2` 把 block 数从 65536 限制为 256，median 为 `0.343484 ms`，没有超过 `hip-v0` 的 `0.336324 ms`。减少 grid 不自动带来收益。
- `hip-v3` 与 `hip-v2` 使用相同的 256 blocks，但 `float4` 版本 median 为 `0.345224 ms`；源码向量类型没有在当前配置下提速。
- `triton-t1` 把 program 数从 65536 减到 16384，median 为 `0.338504 ms`，没有超过 `triton-t0` 的 `0.336204 ms`；trace 同时显示 VGPR 从 8 变为 24。

这些结论只适用于 manifest 记录的硬件、软件、shape、block、warmup、repeat 与独立进程协议。下一步若要检验可迁移性，应先扩展 shape、dtype 或系统状态中的一个变量，并生成新的 manifest 与 curated evidence；不能把当前逻辑有效带宽解释成物理 GDDR6 流量。

## 8.8 复跑与练习

### 8.8.1 一键入口

以下命令对应 2026-07-19 发布的 **Radeon RX 9070 XT + ROCm 7.13 + 原生 Ubuntu 24.04** curated evidence，也是读者复跑本章的入口：

```bash
cd code/part2-kernels
uv sync
source ./activate-rocm.sh
export SOURCE_COMMIT="<本地 Git 维护机提供的源码提交 SHA>"
bash chapter8/run_all.sh
bash chapter8/profile_all.sh
```

将占位符替换为本地 Git 维护机提供的实际提交 SHA，再执行命令。实验机只接收对应的源码文件，不执行 Git 操作；两个入口共用这个标识。可选的地址调试工具默认关闭，不影响正确性、benchmark 和 profiling 主流程。

`run_all.sh` 的顺序是：

```text
采集环境
→ 编译 HIP
→ HIP/Triton 边界正确性
→ 主 benchmark
→ 3 次独立进程复跑
→ 汇总 CSV/JSON
```

`profile_all.sh` 单独运行，避免 profiler 开销混入 GPU event benchmark。实验完成后应得到：

```text
code/part2-kernels/chapter8/
├── evidence/
│   ├── manifest.json
│   ├── profile_summary.csv
│   ├── summary.csv
│   └── summary.json
├── logs/
└── profiles/
```

详细环境、参数、关键结果与证据路径见 `code/part2-kernels/chapter8/EXPERIMENT.md`。带宽图可以直接从汇总结果重画：

```bash
python chapter8/plot_vector_add_ch7.py \
  --summary chapter8/evidence/summary.csv \
  --manifest chapter8/evidence/manifest.json \
  --out ../../docs/part2-kernels/chapter8/images/vector-add-ch7-bandwidth.png
```

### 8.8.2 从 Add 迁移到更多逐元素算子

Vector Add 的价值不在于加法本身，而在于它提供了一个可替换的模板。

把核心表达式改成 ReLU：

```text
output[i] = max(input[i], 0)
```

线程/program 的划分与尾部保护可以保持不变。改成 Scale & Bias：

```text
output[i] = alpha * input[i] + beta
```

仍然是逐元素，只是每个位置多做了乘法和加法。把 Add 与 ReLU 合在一个 kernel：

```text
output[i] = max(input_a[i] + input_b[i], 0)
```

如果分成两个 kernel，中间结果通常需要写回再读出；融合后可能减少这次中间读写。这里仍然只能提出假设，真正的收益要在第 12 章用完整计时验证。

### 8.8.3 练习

1. 把 `N` 改成 `1、31、32、33、1027`，先预测 HIP 的 `if` 与 Triton 的 mask 分别关闭哪些位置，再运行正确性检查。
2. 把 Triton t1 的 `BLOCK_SIZE` 改为 `512`，保持 `num_warps=4`，记录 program 数量怎样变化；不要在计时前猜谁更快。
3. 在 HIP 与 Triton 中都实现 `Scale & Bias`，继续使用同一输入生成、precheck、postcheck 与 event 计时框架。
4. 给 `float4` 版本传入从 `input + 1` 开始的偏移指针，先解释为什么对齐假设被破坏，再设计安全的头部/主体/尾部拆分；不要直接运行未对齐强转。

### 8.8.4 验收信号

完成本章时，不要求某个版本必须最快，但需要同时满足下面四项：

1. HIP 与 Triton 的边界正确性检查都通过，发布行的 `max_abs_error` 与 evidence 一致。
2. 能解释 benchmark 的 shape、warmup、repeat、独立进程汇总和 kernel-only 计时范围。
3. 能从 profile 表指出受控 HIP 对照固定了哪些资源字段，以及 Triton tile 变化伴随什么资源变化。
4. 能明确写出至少一个负结果，并说明当前结论为什么不能外推到其他硬件、shape 或物理显存流量。

## 本章小结

- Element-Wise 的核心不是“公式简单”，而是输出位置之间没有依赖，可以独立划分。
- HIP 线程级范式让 kernel 正文从一个 thread 与标量下标出发；Triton 分块范式让正文从一个 program 与一块逻辑下标出发。`blockDim.x` 与 `BLOCK_SIZE` 不是对应参数，tile 位置也不固定对应硬件 lane。
- Vector Add 每个 FP32 输出至少对应两次逻辑读取、一次逻辑写回和一次加法；受控跨步实验让用时增加到连续版的约 `6.95×`，结果与数据搬运主导假设一致。
- HIP 从 thread 与标量地址出发，适合看清连续访问、Grid-Stride、向量类型和尾部。
- Triton 从 program 与 tile offsets 出发，用 mask 处理边界；下标动画用于理解访问位置，真实性能仍需要 GPU 实验。
- Grid-Stride 在当前配置下与 v0 接近；`float4` 没有提速；Triton 的 1024 元素 tile 也没有稳定超过 256 元素 tile。负结果同样决定下一轮该测什么。
- 遇到一个新的逐元素算子时，本章的判断仍然成立：先确认输出位置彼此独立 → 沿用同一套线程/program 划分与尾部保护 → 只替换核心表达式 → 用同一口径复测，不要凭源码表象预判快慢。
- 下一章会撤掉“每个输出彼此独立”这个前提：Reduction 需要许多线程合作得到一个结果，因此会第一次引入跨线程通信、LDS 与 Wave Shuffle。

## 延伸阅读

- [AMD HIP 编程模型](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html)：thread、block、grid、wavefront 与 SIMT 执行关系。
- [AMD HIP Performance Guidelines](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/performance_guidelines.html)：线程映射、合并访存、对齐与内存吞吐建议。
- [Triton 官方编程指南：Introduction](https://triton-lang.org/main/programming-guide/chapter-1/introduction.html)：Blocked Program、Scalar Threads 与分块算法的官方定义。
- [Triton 官方 Vector Addition 教程](https://triton-lang.org/main/getting-started/tutorials/01-vector-add.html)：kernel、Host wrapper、正确性与 benchmark 的官方最小例子。
- [PyTorch HIP 语义](https://docs.pytorch.org/docs/stable/notes/hip.html)：为什么 ROCm 构建继续使用 `torch.cuda` 接口名。
