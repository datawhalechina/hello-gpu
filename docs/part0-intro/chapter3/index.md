---
title: "第3章 GPU 体系结构（下）：片上资源与数据通路"
description: "Hello GPU 第3章 · 跟着一次加法认识寄存器、缓存与 LDS，再理解合并访存和延迟隐藏"
---

<script setup>
import dataJourneyImage from './images/data-journey.png'
import storageScopesImage from './images/storage-scopes.png'
import coalescedAddressesImage from './images/coalesced-addresses.png'
import ldsCooperationImage from './images/lds-cooperation.png'
import latencyHidingImage from './images/latency-hiding.png'
import bankRequestsImage from './images/bank-requests.png'
import matrixTileImage from './images/matrix-tile.png'
</script>

# 第3章 GPU 体系结构（下）：片上资源与数据通路

## 本章导读

> 上一章解决了“谁来算”：线程找到自己负责的下标，wavefront 组织线程执行。现在继续看同一次数组加法：输入的两个数在哪里？计算过程中放在哪里？如果数据还没到，GPU 能先做别的工作吗？本章会沿着数据的读取、使用和写回，介绍寄存器、缓存与 LDS，再解释地址排列和资源用量怎样影响执行。

你只需要记得第 2 章的 thread、block 和 wavefront，并能看懂 `c[i] = a[i] + b[i]`。初次阅读先完成 3.1～3.5 节；3.6 的 bank 冲突和 3.7 的矩阵指令属于选读，之后学习归约与矩阵乘时还会遇到。

本章实验沿用 **Radeon RX 9070 XT（gfx1201）+ ROCm 7.13 + 原生 Ubuntu 24.04** 的已有结果。小数组、请求分配和时间步骤是解释原理的教学示意；图中的距离与格子不代表芯片面积、硬件周期或实测事务数。

## 3.1 跟着一个元素完成一次加法

这一节先追踪两个输入和一个结果，不急着记住全部存储名称。

回到上一章的手算例子，线程负责下标 2，要完成 `c[2] = a[2] + b[2]`。其中 `a[2] = 3`，`b[2] = 30`，所以结果是 33。数学上只需一步加法，硬件执行时却要先拿到输入，并给计算中的值安排存放位置。

第 1 章里，我们把数组从 CPU 使用的内存复制到了 GPU 可以访问的全局内存。对于本书的独立显卡，数组的数据由板卡显存承载，RX 9070 XT 使用的是 GDDR6。这里的**全局内存（Global Memory）**强调程序的访问空间，“显存”则强调存放数据的硬件。[HIP 内存模型](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#memory-model)

线程计算时，可以把过程分成三个动作：

1. **读入**：根据下标发出读取请求，拿到两个输入值。
2. **计算**：把当前需要的值放在计算单元身边的临时存储中，执行加法。
3. **写回**：把结果写到输出数组的对应位置。

这种直接供指令使用的临时存储，叫**寄存器（Register）**。你可以先把显存想成存放整批材料的货架，寄存器想成计算时手边的小工作台。需要处理某份材料时，把它取到手边，处理后再把结果放到约定的位置。

<!-- illustration: ch3-data-journey；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch3-data-journey
<a :href="dataJourneyImage" target="_blank" rel="noopener" aria-label="查看一次加法数据旅程的高清原图">
  <img src="./images/data-journey.webp" alt="灰色读取请求发往缓存及全局内存；蓝色和橙色输入送入寄存器，加法结果沿绿色路径写回输出数组" />
</a>

一次加法的概念过程：输入被读入，指令使用寄存器中的值计算，结果再写入数组。读取途中可能由缓存提供数据，具体作用将在下一节解释；图没有要求每次读取都访问物理显存。
:::

沿 @fig-ch3-data-journey 追踪一次，你会发现“数组里的一个元素”和“正在计算的临时值”承担着不同角色。前者是程序约定的存放位置，后者是指令当前拿来使用的值。

这个类比只帮助区分用途，不表示每个源码变量都一定对应一个独立寄存器。编译器会安排临时值，有的值被复用，有的值会被消去，也可能在寄存器不足时使用其他存储。现在先掌握正常计算的数据过程，后面再讨论资源不足会怎样。

## 3.2 同样是存数据，谁在使用和管理

这一节补上几种存储的分工，重点看“谁用它”和“谁负责管理它”。

### 3.2.1 各 lane 的临时值与 wavefront 共用的状态

上一章说过，同一 wavefront 的 lane 可以读取不同输入。因此，硬件需要为各 lane 保存不同的临时值，这与**向量通用寄存器（Vector General-Purpose Register，VGPR）**有关。这里的“向量”可以理解成：同一寄存器编号下，包含分别对应不同 lane 的分量，而不是所有 lane 被迫使用同一个数。

也有一些信息可以由整个 wavefront 共同使用，例如某个数组的共同基址。保存这类标量状态的，是**标量通用寄存器（Scalar General-Purpose Register，SGPR）**。基址就是“数组从哪个地址开始”，各线程再结合自己的下标找到对应元素。

用工作台来比，VGPR 对应各 lane 手边不同的临时材料，SGPR 对应同一 wavefront 共同使用的一份信息。这里的“共用”描述硬件状态，不是让程序随意把一个线程的局部变量交给另一个线程读取。

### 3.2.2 共享工作区与自动缓存

如果一组线程确实需要交换数据，或者反复使用同一批数据，我们可以为它们准备一块共同区域。HIP 中用 `__shared__` 声明的共享存储，在 AMD 硬件上对应**局部数据共享存储（Local Data Share，LDS）**。它供同一工作组里的线程协作使用，具体谁写、谁读、何时同步，由程序安排。3.4 节会把这个过程展开。

还有一种常见情况：程序仍然读取全局数组，但之前访问过的数据可能已经有一份副本留在更近的位置，不必每次都重新从外部显存取。这类由硬件管理的存储叫**缓存（Cache）**。请求的数据在缓存中找到，叫**命中（Hit）**；没有找到，则需要继续向后面的存储层级请求。

<!-- illustration: ch3-storage-scopes；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch3-storage-scopes
<a :href="storageScopesImage" target="_blank" rel="noopener" aria-label="查看寄存器、LDS 与缓存使用范围的高清原图">
  <img src="./images/storage-scopes.webp" alt="同一工作组中的两个 wavefront 各有 SGPR，各 lane 持有不同 VGPR 分量；工作组共享 LDS，缓存由硬件另行管理" />
</a>

本例展示同一工作组中的两个 wavefront，比较各 lane、wavefront 和工作组的存储使用范围。各区域不是依次经过的站点，LDS 也不是全局内存访问必经的一层缓存。
:::

看 @fig-ch3-storage-scopes 时，先不用背缩写，试着回答两个具体问题：“这是我自己计算时用的临时值，还是大家需要共享的数据？”“这份数据是程序主动放进去的，还是硬件替我缓存的？”能回答这两个问题，后面遇到这些名字就有了落点。

对于简单的 Vector Add，各位置之间没有交换数据的需求，通常不需要先搬一份到 LDS。它依然可能受益于缓存，但缓存是否命中，要看实际访问和运行条件。**使用 LDS 和命中缓存是不同的事情。**

<details>
<summary>进阶：缓存名称、规格容量与真实数据路径</summary>

查 `gfx1201` 规格时，你会遇到向量/标量 L0、L2、Infinity Cache 等名字。先知道它们属于不同层级即可；本章不要求记住每一级容量。寄存器驻留、LDS 访问和全局访存，也不能串成一条统一的“寄存器→LDS→缓存→显存”链。

读取硬件容量表时，要连同统计范围一起读：整卡、WGP、CU、SIMD 或每个工作组的上限不是同一个口径。容量不直接等于带宽，也不能用一串容量数字推算某次访问的延迟。[ROCm GPU specifications](https://rocm.docs.amd.com/en/latest/reference/gpu-specs.html)

</details>

## 3.3 相邻线程怎样读取数据：合并访存

这一节把视角从一个线程移到一个 wavefront，观察大家同时请求的地址。

### 3.3.1 不只看一个线程读多少，还要看大家读哪里

存储系统通常按一定大小的数据块组织和服务访问，其中缓存保存的数据块称为**缓存行（Cache Line）**。因此，你只需要一个元素，并不意味着底层只搬这一个元素。现在先记住“按块组织”这件事，暂时不用背某种硬件上的块大小。

拿同一 wavefront 里的前几个 lane 做一个地址排列示意：

| lane | 0 | 1 | 2 | 3 |
| --- | ---: | ---: | ---: | ---: |
| 相邻读取的元素下标 | 0 | 1 | 2 | 3 |
| 步长为 17 的读取下标 | 0 | 17 | 34 | 51 |

这里列的是**元素下标**，不是字节地址。步长为 17，就是相邻两个 lane 读取的位置相隔 17 个元素。两种模式里每个 lane 都只读一个数，但合在一起看，请求的分布不同。

<!-- illustration: ch3-coalesced-addresses；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch3-coalesced-addresses
<a :href="coalescedAddressesImage" target="_blank" rel="noopener" aria-label="查看相邻与分散读取的高清原图">
  <img src="./images/coalesced-addresses.webp" alt="左侧 lane 0 至 3 读取相邻元素 a[0]、a[1]、a[2]、a[3]；右侧对应的蓝框标出分散元素 a[0]、a[17]、a[34]、a[51]" />
</a>

同一批 lane 的两种地址排列：左侧蓝框依次为 a[0]、a[1]、a[2]、a[3]，右侧依次为 a[0]、a[17]、a[34]、a[51]。数据块划分不表示实际缓存行边界或物理事务数量。
:::

对照 @fig-ch3-coalesced-addresses 蓝框中的下标看，相邻读取把请求集中在一段连续区域里，通常更有利于合并服务；分散读取则可能涉及更多数据块，其中一些被带来的数据并不是当前这批 lane 所需要的。

把同一 wavefront 的地址请求组织得便于硬件合并处理，这就是**合并访存（Memory Coalescing）**要解决的问题。它不要求所有线程读取同一个数；对数组而言，常用的起点恰恰是让相邻线程读取相邻元素。实际效果还会受数据类型、地址对齐和缓存影响，所以不能从示意图直接数出固定的事务数。

### 3.3.2 用已有实验验证地址排列的影响

接下来用一个比加法更简单的任务做对照：从输入数组读一个元素，再写到输出数组。写入位置保持为连续的 `output[tid]`，只改变读取的下标排列。这样你可以把注意力集中在“从哪里读”。

以下是 [`global_memory_access.hip`](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter3/global_memory_access.hip) 中的核心代码：

```cpp
template <unsigned Stride>
__global__ void gather_copy(
    const float* input, float* output, std::size_t n
) {
    std::size_t tid = blockIdx.x * blockDim.x + threadIdx.x;
    if (tid < n) {
        std::size_t source = (tid * Stride) & (n - 1);
        output[tid] = input[source];
    }
}
```

你已经认识 `tid` 和边界判断。新出现的 `Stride` 是读取步长：`Stride=1` 对应相邻下标，17 或 257 会让同一 wavefront 内的读地址更分散。末尾的 `& (n - 1)` 用来把下标绕回数组范围；这里要求 `n` 是 2 的幂，位运算细节可以先放到折叠区再看。

下面是 **RX 9070 XT + ROCm 7.13 + 原生 Ubuntu 24.04** 的已有实测汇总。输入有 **16,777,216 个 FP32 元素**，预热 10 次、计时 50 次，数据来自 3 个独立进程：

| 读取步长 | 时间中位数（ms） | 逻辑有效带宽（GB/s） |
| --- | ---: | ---: |
| 1 | 0.235 | 571 |
| 17 | 0.772 | 174 |
| 257 | 1.89 | 71.1 |

先看时间列：这次实验中，分散读取更慢。再看最后一列，它描述的是程序每秒完成了多少**有用的读写工作**。本实验每个元素读一次、写一次，所以逻辑有效带宽按 `2 × N × sizeof(float) / 时间` 计算。

**逻辑有效带宽不是物理显存流量。** 缓存可能提供一部分数据，底层也可能为了取出所需元素而搬运更多字节。表格支持“这组访问模式的性能不同”，没有直接测出到底发生了多少条物理事务。后面学习 [Element-Wise](../../part2-kernels/chapter8/index.md) 时，我们会继续用这种区分分析真实算子。

<details>
<summary>复跑：命令、回绕下标与完整统计</summary>

以下沿用现有命令。在原生 Ubuntu 实验机按第 1 章同步并激活本篇环境后，从仓库工作目录进入实验目录：

```bash
cd code/part0-intro/chapter3
hipcc --offload-arch=gfx1201 -O3 -std=c++17 global_memory_access.hip -o global_memory_access
# --implementation all 会依次跑 stride-1 / stride-17 / stride-257
./global_memory_access --implementation all --size 16777216 --warmup 10 --repeat 50
```

`--size` 是元素数量，`--warmup` 是预热次数，`--repeat` 是正式测量次数。命令执行一次会在一个进程中比较三种模式，正文则汇总了三个独立进程。

当 `n` 是 2 的幂、下标是非负整数时，保留最低若干位的 `& (n - 1)` 可以实现对 `n` 取模。程序会检查这一前提。本实验选用的步长为奇数，配合 2 的幂长度可以遍历整个输入；不要把这种写法不加检查地套到任意数组长度。

三种模式的进程中位数范围分别为 0.232～0.238 ms、0.770～0.772 ms、1.88～1.92 ms。未取整的数据在 [summary.csv](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter3/evidence/summary.csv)，源码版本与测量记录摘要在 [manifest.json](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter3/evidence/manifest.json)。

</details>

## 3.4 线程怎样通过 LDS 协作

这一节先解释共享存储的用途，再说明为什么需要同步。

Vector Add 中，每个输出只依赖对应的两个输入，线程各做各的就能完成任务。如果换成“把一批数合成一个和”，或者“一组线程反复使用同一小块数据”，线程之间就可能需要交换或复用材料。此时，共享区域才有了用处。

LDS 可以看成**同一个工作组的共享桌面**。大家约定哪些位置放哪些数据，分别把自己负责的部分写进去，其他线程再按算法需要读取。共享桌面不会自动填满；声明了 `__shared__`，也不等于全局数组已经复制进来了。

<!-- illustration: ch3-lds-cooperation；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch3-lds-cooperation
<a :href="ldsCooperationImage" target="_blank" rel="noopener" aria-label="查看 LDS 协作三个步骤的高清原图">
  <img src="./images/lds-cooperation.webp" alt="LDS 协作三步：各线程分工写入共享区域，在共同屏障处同步，然后读取自己或同组其他线程写入的数据" />
</a>

有协作需求时的 LDS 使用过程。共享区域属于同一工作组，简单的 Vector Add 不必增加这一步。
:::

@fig-ch3-lds-cooperation 中间为什么有一次同步？假设线程甲已经写完自己的位置，接下来要读线程乙负责的位置。但乙可能还没执行到写入。**自己写完，只能证明自己的进度，不能证明别人也写完。**

工作组可以使用**屏障同步（Barrier）**约定一个共同到达的位置。HIP 中的 `__syncthreads()` 就用于这类组内同步：线程在这里会合，并保证屏障前相应的共享内存写入对组内线程可见，然后再继续后续工作。[HIP 同步函数](https://rocm.docs.amd.com/projects/HIP/en/latest/reference/cpp_language_extensions.html#synchronization-functions)

看本章已有的 [`lds_bank_conflict.hip`](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter3/lds_bank_conflict.hip)，写入共享数组的部分如下：

```cpp
    for (unsigned int offset = threadIdx.x; offset < kSharedElements;
         offset += kBlockSize) {
        shared[offset] = shared_value(offset);
    }
    __syncthreads();
```

每个线程从自己的块内编号开始，间隔 `kBlockSize` 填写后续位置。比如前一个线程负责一组下标，后一个线程负责错开一位的下标，合起来覆盖共享数组。这里用 `shared_value(offset)` 生成确定的数据来测试 LDS 访问，不是在把 Vector Add 的输入搬进来。随后所有线程到达同步点，再进入读取阶段。

写这类代码时，不能让一部分组内线程绕过一个其他线程需要到达的屏障。原实验把同步放在后面的越界退出之前，也是先让组内线程完成共享数组初始化。屏障不负责修复越界、覆盖写入等其他错误，数组位置仍要分配正确。

LDS 带来的收益是交换与复用，但也需要额外写入、同步和片上空间。如果每份数据只被一个线程用一次，多绕一趟 LDS 未必划算。到 [Reduction](../../part2-kernels/chapter9/index.md) 和 [GEMM-Like](../../part2-kernels/chapter11/index.md) 中，我们再结合具体算法判断它是否值得使用。

## 3.5 等数据时做什么：延迟隐藏与占用率

这一节解释为什么 GPU 要同时保留多份工作，以及片上资源怎样限制这些工作。

### 3.5.1 先区分驻留、就绪和执行

一个 wavefront 已经发出了读取请求，不代表下一步需要的数据立刻就能到。若后续指令依赖尚未返回的值，就要等待。

不过，硬件可能还保留着其他 wavefront 的状态。当 wavefront A 暂时不能继续时，可以选择一个已经准备好执行的 wavefront B。这里要区分三个词：

| 状态 | 可以怎样理解 |
| --- | --- |
| **驻留（Resident）** | 工作已经获得相应片上资源，状态保留在硬件中 |
| **就绪（Ready / Eligible）** | 满足继续执行所需的条件，可以被选择 |
| **执行（Executing）** | 当前获得了执行机会，正在发射或执行相应指令 |

一个 wavefront 可以已经驻留，却仍在等待数据；就绪的 wavefront 也要等待调度机会。把这三件事分开，才不会把“已经安排了很多线程”误认为“每一刻都有很多线程在有效计算”。

<!-- illustration: ch3-latency-hiding；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch3-latency-hiding
<a :href="latencyHidingImage" target="_blank" rel="noopener" aria-label="查看延迟隐藏与驻留资源的高清原图">
  <img src="./images/latency-hiding.webp" alt="wavefront A 等待数据期间可以执行就绪的 wavefront B；每组工作占用更多片上资源时，能够同时驻留的工作可能减少" />
</a>

借用其他就绪工作覆盖等待的概念时间线。步骤不等长，也不保证每次等待时都有另一个 wavefront 可执行。
:::

@fig-ch3-latency-hiding 展示的就是**延迟隐藏（Latency Hiding）**：A 取数据的时间没有消失，但这段时间里，计算资源可以用于 B 的工作。如果没有其他就绪工作，执行资源仍可能空闲。[AMD GPUOpen：Occupancy explained](https://gpuopen.com/learn/occupancy-explained/)

### 3.5.2 为什么不能把所有 wavefront 都放进来

保留一份工作，就要保留它的临时值和执行状态。寄存器与 LDS 都在 GPU 芯片内部，是有限的**片上资源（On-Chip Resources）**。当每份工作需要的资源变多，同时能够容纳的工作就可能减少。

把一组工作需要的资源想成一个行李包，会更容易理解：柜子大小固定，包越大，能放进去的包通常越少。但真实硬件还要考虑分配粒度和其他上限，不能拿某个“总容量”简单除一下，就当作某个 kernel 的精确并发度。

**占用率（Occupancy）**用来描述驻留 wavefront 占可用 wavefront 槽位的程度，具体统计时还要说明目标硬件、范围以及理论值或运行时测量口径。它关心能驻留多少工作，和“计算单元有多少时间正在干活”并不是同一个指标。

占用率较高，可能提供更多可选择的 wavefront，但不保证程序更快。如果所有 wavefront 都在等同一类受限资源，增加驻留也未必解决问题。反过来，让线程在寄存器中多保留一些可复用数据，虽然可能减少驻留数量，却也可能减少重复读取。因此，优化需要比较实际耗时。

<details>
<summary>进阶：寄存器用量、spill 与 RDNA 的资源边界</summary>

当某些临时值无法继续放在寄存器中时，编译器可能安排额外的存取，这类情况称为**寄存器溢出（Spill）**；相关私有存储常通过 scratch 路径访问。它可能增加访存，具体是否发生、增加多少，需要看编译资源报告与指令。

在 RDNA 的占用率说明中，SGPR 有其固定分配特点，不能把它与 VGPR、LDS 画成完全对称、可简单按用量推算的三种限制。初学时先关注每组工作占用的 VGPR、LDS、硬件槽位及工作组大小；准确约束仍需按目标核对。[AMD GPUOpen 占用率说明](https://gpuopen.com/learn/occupancy-explained/)

</details>

## 3.6 选读：LDS 里的 bank 冲突

这一节在“会使用共享区域”之后，再认识它的一种性能问题。

LDS 内部把存储划分为可以并行服务访问的**存储体（Bank）**。可以把它想成多个服务入口：请求分散到不同入口时，有机会同时处理；同一批请求若访问映射到同一 bank 的不同地址，就可能发生竞争。这类访问冲突叫 **bank 冲突（Bank Conflict）**。[AMD RDNA 性能指南](https://gpuopen.com/learn/rdna-performance-guide/)

<!-- illustration: ch3-bank-requests；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch3-bank-requests
<a :href="bankRequestsImage" target="_blank" rel="noopener" aria-label="查看 LDS bank 请求对照的高清原图">
  <img src="./images/bank-requests.webp" alt="左侧四个请求分散到四个示意入口；右侧 lane 0、1、2、3 读取不同地址 x0、x4、x8、x12，四条箭头共同指向入口 A" />
</a>

bank 冲突的服务入口类比。这里没有规定 gfx1201 的 bank 数、地址取模公式或每周期服务能力。
:::

@fig-ch3-bank-requests 说的是**不同地址竞争同一 bank**。多个 lane 恰好读取同一个地址，是需要另外看广播规则的情况，不能一律画成“所有人排队读一次”。

它与 3.3 节的合并访存也不同：合并访存先看全局地址请求是否集中，bank 冲突看的是 LDS 内部的地址映射。两者都提醒我们关注同一 wavefront 的地址排列，但不是同一层机制。

本章现有实验保持共享数组和读取循环不变，比较不同的索引步长。**RX 9070 XT + ROCm 7.13 + 原生 Ubuntu 24.04** 下，每块 256 个线程、每线程 256 次 LDS 读取，输入规模、预热和重复次数沿用前述实验口径：

| LDS 读取步长 | 时间中位数（ms） | 这次对照的结果 |
| --- | ---: | --- |
| 1 | 8.08 | 基线 |
| 32 | 42.2 | 约为基线时间的 5.23 倍 |
| 33 | 8.09 | 中位数接近基线，进程范围更宽 |

先读出这个有限结论：**索引排布可以明显影响本实验的 LDS 访问表现。** 这份时间表没有直接测出 bank 映射，不能把它改写成“gfx1201 一定有多少个 bank，所以必然慢几倍”。

<details>
<summary>复跑：LDS 访问模式实验</summary>

在已激活本篇环境的原生 Ubuntu 实验机上，从仓库工作目录执行以下原有命令：

```bash
cd code/part0-intro/chapter3
hipcc --offload-arch=gfx1201 -O3 -std=c++17 lds_bank_conflict.hip -o lds_bank_conflict
# --implementation all 会依次跑 stride-1 / stride-32 / stride-33
./lds_bank_conflict --implementation all --size 16777216 --warmup 10 --repeat 50
```

各步长的进程中位数范围分别为 8.07～8.10 ms、41.3～52.0 ms、6.57～8.10 ms。完整索引与循环在 [`lds_bank_conflict.hip`](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter3/lds_bank_conflict.hip)，原始精度的汇总见 [summary.csv](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter3/evidence/summary.csv)。这些结果来自同一组三进程记录，单次执行以上命令不等于完成了这组统计。

</details>

## 3.7 选读：认识矩阵专用指令 WMMA

这一节只给后面的矩阵乘章节建立一个入口，不要求现在记住指令接口。

数组加法让各线程分别完成独立元素。矩阵乘则不同：一个输出元素需要把输入矩阵对应的一行与一列逐项相乘，再加起来；整块输出中又会反复使用输入数据。

除了普通的向量算术指令，RDNA 4 还提供**wavefront 矩阵乘加（Wave Matrix Multiply-Accumulate，WMMA）**指令。它把一小块矩阵运算交给整个 wavefront 协作完成，输入和输出分布在参与 lane 的寄存器中。理解它时，要从整个 wavefront 共同处理的矩阵块来看，而不能只盯着一个线程。

<!-- illustration: ch3-matrix-tile；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch3-matrix-tile
<a :href="matrixTileImage" target="_blank" rel="noopener" aria-label="查看 wavefront 协作计算矩阵块的高清原图">
  <img src="./images/matrix-tile.webp" alt="A、B 和原来的 C 矩阵块共同进入一个 wavefront，协作完成 C 等于 A 乘 B 加 C，输出更新后的 C 矩阵块" />
</a>

WMMA 的整块数据视角。图没有规定某个 lane 持有哪几个元素，具体布局取决于所选指令。
:::

@fig-ch3-matrix-tile 先回答“共同计算什么”。至于矩阵块多大、各 lane 怎样提供输入、怎样存回结果，要服从具体指令的约定。这些细节需要建立矩阵乘和数据布局基础后再展开。[GPUOpen：RDNA 4 矩阵指令](https://gpuopen.com/learn/using_matrix_core_amd_rdna4/)

<details>
<summary>已有实验：普通向量路径与 gfx12 WMMA</summary>

本章 [`rdna4_wmma.hip`](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter3/rdna4_wmma.hip) 比较一批独立的 `16×16×16` 小矩阵乘。普通向量算术路径（VALU）让每个线程计算一个输出元素；WMMA 路径由一个 wave32 协作。这个“一线程一输出”只是当前基线的写法，不是 VALU 的普遍限制。

**RX 9070 XT + ROCm 7.13 + 原生 Ubuntu 24.04** 的已有结果，批数为 4,096，FP16 输入、FP32 累加与输出，预热 10 次、计时 50 次，汇总 3 个进程：

| 路径 | 时间中位数（ms） | 进程中位数范围（ms） |
| --- | ---: | --- |
| VALU | 0.0372 | 0.0361～0.0383 |
| WMMA | 0.0162 | 0.0161～0.0162 |

按未取整结果计算，本次 WMMA 路径的吞吐约为基线的 2.30 倍。它只说明这两个教学实现的差异，不是生产矩阵乘库的对照，也不是这张卡的理论峰值。

复跑沿用以下命令，在原生 Ubuntu 实验机激活本篇环境后，从仓库工作目录执行：

```bash
cd code/part0-intro/chapter3
hipcc --offload-arch=gfx1201 -O3 -std=c++17 rdna4_wmma.hip -o rdna4_wmma
# --implementation all 会依次跑 valu 和 wmma 两条路径；--size 是矩阵批数
./rdna4_wmma --implementation all --size 4096 --warmup 10 --repeat 50
```

这里的 `--size` 是独立小矩阵乘的批次数，不是矩阵边长。具体使用的 gfx12 intrinsic、各 lane 的输入输出布局和 CPU 参考校验都在源码里；完整汇总在 [summary.csv](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter3/evidence/summary.csv)。初次阅读先留到 [GEMM-Like](../../part2-kernels/chapter11/index.md) 再看即可。

</details>

## 本章小结

- 数组数据先被读入，指令使用临时值计算，再把结果写回；一次简单加法也包含数据访问。
- 寄存器、LDS 和缓存各有分工。LDS 由程序显式使用，缓存由硬件管理，不能把它们画成必经的一条链。
- 判断访存时，要同时看一个 wavefront 各 lane 的地址。相邻地址是常用起点，是否有效仍要结合实测。
- 工作组共享数据时，需要安排好写入、同步和后续读取；简单 Vector Add 通常不需要 LDS。
- 多个驻留 wavefront 可以帮助隐藏等待，但占用率不等于计算利用率，也不是越高越快。

第 2 章让你能说清“谁算哪个位置”，本章让你能追踪“数据怎样被使用”。接下来到[第 4 章](../chapter4/index.md)，我们重新运行这个熟悉的 Vector Add，重点学习怎样量准时间、怎样读懂性能结果。

## 自我检验

先试着回答，再展开答案：

1. 线程要计算 `c[2]`，是否必须先把 `a[2]`、`b[2]` 放到 LDS？
2. 两种实现里，每个 lane 都读取一个数，是否就能认为它们的访存效率一样？
3. 一个线程把自己的共享位置写完，是否可以立即假设其他线程负责的位置也能读取？
4. GPU 上已经驻留很多 wavefront，是否代表总能找到就绪的工作？

<details>
<summary>参考答案</summary>

1. 不必。简单 Vector Add 没有组内交换或复用输入的需求，通常直接使用全局读取和寄存器中的临时值。
2. 不能。还要看同一 wavefront 的地址排列，并结合对齐、缓存和测量结果判断。
3. 不可以。若后续读取依赖其他线程的写入，就必须安排正确的组内同步，不能用自己的进度代替其他线程的进度。
4. 不代表。驻留描述资源与状态已经保留；这些 wavefront 可能仍在等数据或其他条件。能否继续执行，还要看就绪状态。

</details>

## 延伸阅读

- [HIP 编程与内存模型](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html)：回看线程、共享存储与全局内存的关系。
- [AMD GPUOpen：Occupancy explained](https://gpuopen.com/learn/occupancy-explained/)：进阶理解驻留、延迟隐藏与资源约束，具体硬件上限需按目标核对。
- [AMD RDNA 性能指南](https://gpuopen.com/learn/rdna-performance-guide/)：了解地址排列与 LDS 访问的优化背景。
- [RDNA 4 矩阵指令](https://gpuopen.com/learn/using_matrix_core_amd_rdna4/)：学到矩阵乘后再查具体接口与数据布局。
- [可视化参考：合并访存](https://www.bilibili.com/video/BV1NYCtYTEFH/)、[Shared Memory 与 Bank Conflicts](https://www.bilibili.com/video/BV1AicNemE9m/)：可以观察编号展开和数据布局的讲解方式；视频使用 CUDA，硬件参数与性能数据不作为本书 AMD 实验结论。
