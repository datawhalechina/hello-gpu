---
title: "第3章 GPU 体系结构（下）：数据存储与访问"
description: "Hello GPU 第3章 · 从一次加法理解数据位置、成组访问、共享同步与访存等待"
---

<script setup>
import MemoryJourney from './memory-journey.vue'
import dataLocationsImage from './images/data-locations.svg?no-inline'
import waveAddressesImage from './images/wave-addresses.svg?no-inline'
import partialSumsImage from './images/partial-sums.svg?no-inline'
import ldsWriteImage from './images/lds-write.svg?no-inline'
import ldsBarrierImage from './images/lds-barrier.svg?no-inline'
import ldsReadImage from './images/lds-read.svg?no-inline'
import waveWaitingImage from './images/wave-waiting.svg?no-inline'
</script>

# 第3章 GPU 体系结构（下）：数据存储与访问

## 本章导读

> 上一章把数组加法分给了多个线程。负责下标 2 的线程，要把输入 3 和 30 相加，再把 33 放到输出位置。现在把这份工作放大：输入存在什么地方，执行加法时怎样取得它们，结果又怎样回到数组？沿着同一个任务，我们先看一个线程的读写，再看一组线程的访问；随后把任务换成求总和，认识线程间的结果交接。

本章沿用第 2 章的 thread、wavefront 和 block，不需要先编写 HIP 程序。先跟着图中的数据观察过程，再认识相关名称；完整的内存分配、数据拷贝和核函数启动放在[第 4 章](../chapter4/index.md)。

<span id="_3-1-跟着一个元素完成一次加法"></span>
<span id="_3-1-数据读取与结果写回"></span>

## 3.1 数据位置与读写过程

还是同一次数组加法：`c[2] = a[2] + b[2]`，其中 `a[2]` 是 3，`b[2]` 是 30。本节假设主机程序已经准备好 GPU 侧的输入数组，我们只观察接下来在 GPU 上发生的过程。

先在 @fig-ch3-data-locations 中找三个位置：**保存数组的地方、保存当前临时值的地方，以及执行加法的部件**。输入 `a`、`b` 和输出 `c` 都放在数组存储区域中；执行运算时使用的临时值，保存在靠近计算部件的位置。

::: figure fig-ch3-data-locations
<a :href="dataLocationsImage" target="_blank" rel="noopener" aria-label="放大查看数组、临时值与计算部件的位置关系">
  <img :src="dataLocationsImage" alt="输入数组 a、b 和输出数组 c 位于同一个数组存储区域，另一处保存当前线程使用的临时值，独立的加法部件使用这些值执行计算" />
</a>

一次加法涉及的位置与职责。图只表示数据用途，不代表芯片面积、物理距离或完整硬件结构。
:::

数组已经在 GPU 上，不等于执行加法的部件已经拿到了两个操作数。就像程序中先读取变量再使用它，GPU 指令也要先取得输入，才能执行依赖这些输入的运算。保存值与使用值计算，是两个不同的职责。

接着播放 @fig-ch3-data-journey，始终追踪 3、30 和 33。先看懂三个动作：**读入两个输入 → 执行加法 → 写回一个结果**。动画把读取进一步分成“发出请求”和“输入到达”，让你能观察等待发生在哪里。

::: figure fig-ch3-data-journey
<MemoryJourney />

一次加法的读写过程。数组存储区域与临时值区域保持原位，只有当前步骤的值和访问状态发生变化。
:::

读取后，`a[2]` 和 `b[2]` 中的 3、30 仍然保留；线程取得的是供计算使用的值。执行加法的部件使用它们得到 33，先把结果保存在临时位置。此时 `c[2]` 还没有更新，直到写回步骤完成，输出数组才得到这个结果。

现在回到 @fig-ch3-data-locations，给刚认识的位置命名：

- **全局内存（Global Memory）**是程序访问这些输入、输出数组的存储空间。本例的数组由独立显卡上的显存承载。“全局内存”描述程序的访问空间，“显存”描述承载数据的硬件。
- **寄存器（Register）**用于保存指令当前使用的临时值，包括读到的输入和计算中的结果。编译器负责安排这些值怎样存放，源码中的变量不一定与寄存器一一对应。
- **执行单元**使用寄存器中的值执行运算，再产生新的值。寄存器负责保存，执行单元负责计算；图中只展开一个线程的数据，不表示每个线程独占一套计算硬件。[HIP 编程与内存模型](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html)

这里的写回只更新 GPU 侧的输出数组。CPU 要使用结果，主机程序还要安排等待和取回数据，第 4 章会把这段完整流程写出来。

> **观察练习：**把动画停在“执行加法”结束时。33 出现在哪里？为什么输出数组还没有得到它？再切回“输入到达”，确认原数组中的两个输入仍然保留。

## 3.2 Wavefront 的访存组织

<span id="_3-3-访问地址与数据传输"></span>
<span id="_3-3-相邻线程怎样读取数据-合并访存"></span>
<span id="_3-3-1-不只看一个线程读多少-还要看大家读哪里"></span>

刚才只跟踪一个线程。现在把视野扩大到同一个 wavefront：当它执行一条数组读取指令时，参与的线程分别提供自己的地址。硬件面对的是一组请求，而不只是一个数。

只画其中四个 lane，比较 @fig-ch3-coalesced-addresses 的两种排列。每个 lane 都读取一个元素：第一种读下标 0、1、2、3，第二种读下标 0、5、10、15。读取的元素数相同，覆盖的位置却不同。

::: figure fig-ch3-coalesced-addresses
<a :href="waveAddressesImage" target="_blank" rel="noopener" aria-label="放大查看同一 wavefront 的相邻与分散访问">
  <img :src="waveAddressesImage" alt="同一 wavefront 的四个 lane 读取相邻下标 0、1、2、3 时，请求集中在一个教学分组；读取 0、5、10、15 时，请求分散在四个教学分组中，所需元素与同组其他元素分别标出" />
</a>

同一批 lane 的地址排列对照。每四格一组只是帮助观察覆盖范围的教学分组，不表示真实缓存行大小或物理事务数量。
:::

存储系统通常按一定大小的数据块组织和服务访问，**线程需要一个元素，不意味着底层只处理这一个元素**。请求集中时，同一段数据就可能满足多个线程；请求分散时，可能需要涉及更多数据块，其中只有部分元素被这批线程使用。

下标还可以换成字节位置。例如 32 位浮点数（FP32）每个元素占 4 字节，连续下标 0、1、2、3 对应相对数组起点的 0、4、8、12 字节。程序选择的下标，最终决定了硬件要处理的地址。

硬件把同一 wavefront 的访存请求尽量合并处理，这个过程称为**合并访存（Memory Coalescing）**。写程序时，让相邻线程访问相邻元素，通常更有利于这种处理。地址由程序决定，实际怎样合并由硬件完成；不能仅凭示意图断言某张 GPU 一定发生几次事务。[HIP 性能指南：全局内存访问](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/performance_guidelines.html#device-memory-access)

读取还存在另一种机会：需要的数据可能已经有一份副本留在更靠近计算部件的存储中。这种由硬件管理的存储叫**缓存（Cache）**。找到所需副本叫**命中（Hit）**，没找到则继续向后面的存储层级请求。缓存通常按数据块保存副本，这些块称为**缓存行（Cache Line）**。

因此，3.1 节中的“读取数组”不要求每次都访问物理显存。**合并访存关注这一批请求的地址排列，缓存关注所需数据是否已有可用副本。** 它们共同影响数据怎样被提供，但不是同一件事。

> **观察练习：**在 @fig-ch3-coalesced-addresses 中分别指出“线程实际要的元素”和“与它同组的其他元素”。为什么两种排列都只取四个数，存储系统要涉及的范围却可能不同？

<span id="_3-4-线程怎样通过-lds-协作"></span>
<span id="_3-2-共享数据与同步"></span>

## 3.3 Block 内的数据共享与同步

前面的数组加法，每个输出位置都能由一个线程独立完成。现在改变任务：**把 `[1, 2, 10, 20]` 中的四个数求成一个总和**。我们选择一种分工：甲先算前两个数，乙先算后两个数，最后由甲合并两份结果。

::: figure fig-ch3-partial-sums
<a :href="partialSumsImage" target="_blank" rel="noopener" aria-label="放大查看数组求和中的两个局部和">
  <img :src="partialSumsImage" alt="数组 1、2、10、20 分成两部分，线程甲计算 1 加 2 得到局部和 3，线程乙计算 10 加 20 得到局部和 30，最后需要把两份局部和合成总和 33" />
</a>

从完整求和任务产生两份局部和。3 和 30 是不同线程计算出的中间结果，最后的合并需要使用它们。
:::

沿 @fig-ch3-partial-sums 看，甲得到 3 后，整个任务还没有结束。它还需要乙算出的 30，但乙的普通局部变量不是甲可以直接读取的共享位置。我们需要安排一个双方都能使用的交接区域。

这里用小数组手算交接过程，不讨论这种分工是否高效。在真实归约中，每个线程可以先处理更多输入，完整算法将在[第 9 章](../../part2-kernels/chapter9/index.md)展开。

**先写入各自的局部和。** 图中甲、乙来自同一个 block 的两个 wavefront；为便于观察，只画两个代表线程，其余线程省略。甲把 3 写入 `shared[0]`，乙把 30 写入 `shared[1]`。

::: figure fig-ch3-lds-cooperation
<a :href="ldsWriteImage" target="_blank" rel="noopener" aria-label="放大查看局部和写入共享区">
  <img :src="ldsWriteImage" alt="同一个 block 中，线程甲已将局部和 3 写入 shared[0]，线程乙尚未将局部和 30 写入 shared[1]，甲不能提前读取乙的位置" />
</a>

写入阶段：两个局部和各有负责写入的线程。共享位置存在，不表示其中的值已经准备好。
:::

@fig-ch3-lds-cooperation 中的交接区域，可以使用 AMD GPU 的**局部数据共享存储（Local Data Share，LDS）**。HIP 用 `__shared__` 声明供同一 block 的线程使用的共享存储。程序要明确安排谁写、谁读，声明它不会自动复制输入或交换结果。

**再等到所需写入都完成。** 甲写完自己的位置，不能证明乙也已经完成。不同 wavefront 不必同时推进；如果甲过早读取 `shared[1]`，就可能拿不到本次需要的 30。

::: figure fig-ch3-lds-barrier
<a :href="ldsBarrierImage" target="_blank" rel="noopener" aria-label="放大查看 block 内的共同同步点">
  <img :src="ldsBarrierImage" alt="甲和乙分别写好局部和 3 与 30，同一 block 的全部线程到达同步点后，才能继续执行依赖这些写入的读取" />
</a>

同步阶段：整个 block 到达共同同步点。其余线程也参与同步，但不需要都向这两个共享位置写入。
:::

这样的共同等待称为**屏障同步（Barrier）**。HIP 的 `__syncthreads()` 让 block 中的线程在共同同步点会合，并保证屏障前的共享写入对组内线程可见。本例把它放在局部和写入之后、合并读取之前；block 中的全部线程都要到达它，不能让部分线程绕过。[HIP 同步函数](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html#synchronization-functions)

**最后读取两份局部和，完成合并。** 甲从 `shared[0]` 读取 3，从 `shared[1]` 读取 30，再相加得到 33。这样，前面两个共享位置的写入都有了后续用途。

::: figure fig-ch3-lds-read
<a :href="ldsReadImage" target="_blank" rel="noopener" aria-label="放大查看同步后读取两份局部和">
  <img :src="ldsReadImage" alt="同步后线程甲分别读取 shared[0] 中的 3 和 shared[1] 中的 30，将它们相加得到总和 33，读取后共享区原值仍保留" />
</a>

合并阶段：甲取得两个已经就绪的局部和，完成最后一次加法。输入的四个数最终合成一个总和。
:::

这一过程里，**LDS 提供交接位置，屏障确定何时可以使用交接的数据**。共享并不意味着所有线程都在同一时刻完成写入；屏障也不会替程序修复越界或互相覆盖等错误。

再和 3.2 节的缓存比较：缓存由硬件管理，保存访问过的数据副本；LDS 由程序显式安排，服务于这里的结果交接。简单数组加法没有这项交接需求，可以直接按 3.1 节完成读、算、写，不必先经过 LDS。

## 3.4 访存等待与指令调度

<span id="_3-4-数据等待与执行资源"></span>
<span id="_3-5-等数据时做什么-延迟隐藏与占用率"></span>
<span id="_3-5-1-先区分驻留-就绪和执行"></span>

回到读取过程：wavefront A 已经发出请求，但输入还没有返回，依赖它的加法暂时不能执行。如果同一计算资源上还有 wavefront B 的指令已经就绪，硬件可以先安排 B。

::: figure fig-ch3-latency-hiding
<a :href="waveWaitingImage" target="_blank" rel="noopener" aria-label="放大查看等待数据时选择另一组就绪工作">
  <img :src="waveWaitingImage" alt="wavefront A 等待输入，自己的临时状态仍然保留；wavefront B 已具备输入，调度器选择 B 的就绪指令交给执行单元，随后 A 获得数据后可继续参与调度" />
</a>

等待与执行可以交错。图表示一次可选择的执行机会，不代表固定调度顺序或硬件周期。
:::

@fig-ch3-latency-hiding 中，选择就绪指令的是 GPU 的**调度器（Scheduler）**。A 等待时，它的临时值和执行状态仍然保留；选择 B 不需要把 A 当作已经完成，也不需要由 CPU 手动切换这两个 wavefront。

这种用其他就绪工作利用等待时间的方式，称为**延迟隐藏（Latency Hiding）**。A 的读取并没有因此更早返回，只是执行资源在这段时间有机会继续做别的工作。如果其他 wavefront 也都在等待，或者它们需要的执行资源正忙，仍然可能出现空闲。[AMD GPUOpen：Occupancy explained](https://gpuopen.com/learn/occupancy-explained/)

同时保留多组工作，需要寄存器等片上资源，所以可供选择的工作数量也有上限。具体一个 kernel 能保留多少工作、资源用量怎样影响性能，适合在有代码和测量结果后再分析。

## 本章小结

- 输入、输出数组与计算使用的临时值各有用途。寄存器保存值，执行单元使用这些值运算；得到结果后仍要写回输出。
- 看访存要观察同一 wavefront 的地址排列。集中请求更有机会合并服务，缓存则可能提供已有的数据副本。
- 当后续计算需要其他线程的中间结果时，可以用 LDS 安排交接，并用正确的 block 同步保证先写后读。
- 一个 wavefront 等待数据时，调度器可以选择其他就绪指令；这利用了等待时间，但没有消除访问本身的延迟。

第 2 章建立了工作分工，本章补齐了数据的位置和访问过程。接下来到[第 4 章](../chapter4/index.md)，把这次数组加法写成完整 HIP 程序，串起准备输入、启动计算、取回结果与正确性检查。

## 自我检验

1. 加法已经得到临时结果 33，为什么 `c[2]` 还可能没有更新？执行加法与保存临时值分别由什么部件承担？
2. 两组线程都只读取四个数，为什么不能仅凭读取数量判断访问工作量？
3. 求和例子中的 30 从哪里来，由谁写入共享区，最后由谁读取？甲写完自己的位置后，为什么还需要同步？
4. 调度器选择 B 执行时，等待中的 A 是否已经完成？A 的输入会因此更早返回吗？

<details>
<summary>参考答案</summary>

1. 临时结果需要再写回输出数组。寄存器保存输入和结果，执行单元使用这些值运算。
2. 还要看地址分布。同一批请求可能集中，也可能涉及更多数据块，缓存状态也会影响实际访问。
3. 乙计算 `10 + 20` 得到 30，写入 `shared[1]`，同步后由甲读取。甲的进度不能证明乙已经写好，所以要建立正确的先后关系。
4. A 尚未完成，它的临时状态仍保留。选择 B 利用了 A 等待的时间，没有让 A 的读取本身更早返回。

</details>

## 进一步学习

<span id="_3-3-2-用已有实验验证地址排列的影响"></span>
<span id="_3-5-2-为什么不能把所有-wavefront-都放进来"></span>
<span id="_3-2-同样是存数据-谁在使用和管理"></span>
<span id="_3-2-1-各-lane-的临时值与-wavefront-共用的状态"></span>
<span id="_3-2-2-共享工作区与自动缓存"></span>
<span id="_3-6-选读-lds-里的-bank-冲突"></span>
<span id="_3-7-选读-认识矩阵专用指令-wmma"></span>
<span id="fig-ch3-storage-scopes"></span>
<span id="fig-ch3-bank-requests"></span>
<span id="fig-ch3-matrix-tile"></span>

掌握本章的读写与协作过程后，可以按后续任务选择材料：

- [第 8 章：Vector Add](../../part2-kernels/chapter8/index.md)：结合具体实现与计时，研究逐元素访问的优化。
- [第 9 章：Reduction](../../part2-kernels/chapter9/index.md)：展开局部和、共享合并与多阶段求和，分析具体优化中的线程发散。
- [第 11 章：GEMM-Like](../../part2-kernels/chapter11/index.md)：从矩阵乘的数据复用理解分块与 LDS。
- [执行资源与访存实验](./experiments.md)：进阶阅读寄存器分类、占用率、bank 冲突与 WMMA；各实验保留其实际采集环境。

## 延伸阅读

- [HIP 编程与内存模型](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html)：线程、存储空间与主机/设备的分工。
- [HIP 性能指南](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/performance_guidelines.html)：全局访问与共享存储的使用背景。
- [AMD GPUOpen：Occupancy explained](https://gpuopen.com/learn/occupancy-explained/)：进一步理解调度机会与资源限制，具体参数需按目标架构核对。
