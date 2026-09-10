---
title: "第2章 GPU 体系结构（上）：编程模型与 wavefront 执行"
description: "Hello GPU 第2章 · 从数组加法出发，理解线程编号、工作分组、wavefront 执行与分支掩码"
---

<script setup>
import taskToThreadsImage from './images/task-to-threads.png'
import blockIndexImage from './images/block-index.png'
import waveLanesImage from './images/wave-lanes.png'
import execMasksImage from './images/exec-masks.png'
import softwareHardwareImage from './images/software-hardware.png'
</script>

# 第2章 GPU 体系结构（上）：编程模型与 wavefront 执行

## 本章导读

> 第 1 章里，你已经运行过一个数组加法程序。但程序只写了一段加法，GPU 怎么知道每个位置该由谁计算？为什么开出很多线程，不代表它们能各做各的？这一章就跟着同一次数组加法，依次看清工作怎样分配、线程怎样成组执行，以及遇到分支时谁在参与计算。读完后，你应该能算出一个线程负责的下标，并在图上指出当前有效的线程。

你只需要知道数组下标从 0 开始、循环能重复执行一段代码、`if` 能根据条件选择操作。暂时看不懂 HIP 的完整启动语法也没关系，我们会先解释每一步的含义，再回到代码。

初次阅读按 2.1～2.5 节往下走即可；2.6 节是选做实验，硬件模式和 CUDA 名称对照放在折叠区。实验沿用 **Radeon RX 9070 XT（gfx1201）+ ROCm 7.13 + 原生 Ubuntu 24.04** 的已有记录。文中的小数组和编号推导会标明为**手算示例**，与实测输出分开。

## 2.1 从一份数组加法到多个线程

这一节先看清 GPU 接到的工作是什么。

假设我们要把数组 `a` 和 `b` 的对应位置相加，结果放进 `c`。下面只取前几个位置做手算：

| 数组下标 | 0 | 1 | 2 | 3 |
| --- | ---: | ---: | ---: | ---: |
| 输入 a | 1 | 2 | 3 | 4 |
| 输入 b | 10 | 20 | 30 | 40 |
| 输出 c | 11 | 22 | 33 | 44 |

求 `c[2]`，只需要 `a[2]` 和 `b[2]`，不需要先知道 `c[0]` 或 `c[1]`。也就是说，这些位置之间没有计算上的先后依赖。这样的工作适合拆开，交给不同的执行者。

如果用普通循环表达，我们会依次让下标从 0 往后移动，每次完成一个位置。换成 GPU 的写法，我们可以让**每个线程负责一个位置**：线程 0 算 `c[0]`，线程 1 算 `c[1]`，其余以此类推。

这里的**线程（Thread）**，可以先理解成“一份带有自己编号的计算工作”。它不是显卡上独占的一颗小处理器。程序可以提交很多份线程工作，硬件再安排它们执行。

<!-- illustration: ch2-task-to-threads；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch2-task-to-threads
<a :href="taskToThreadsImage" target="_blank" rel="noopener" aria-label="查看数组任务与线程的高清原图">
  <img src="./images/task-to-threads.webp" alt="四个线程分别将同下标的 a 与 b 相加，输出依次为 11、22、33、44" />
</a>

一份计算规则分给多个线程；每个线程处理自己的数组位置。图中只展开部分线程，不表示硬件同时执行的数量。
:::

如 @fig-ch2-task-to-threads 所示，大家遵循同一条规则，但读写的位置不同。在 GPU 上执行这段规则的函数，叫**核函数（Kernel）**。CPU 负责准备任务并发起调用，这个动作叫**启动（Launch）**；GPU 负责执行提交的计算。

你可以把它想成一张统一的工作单：“取自己编号对应的两个数，把和写回同一编号的位置。”我们只写一份工作单，不必为每个位置单独写一个函数。接下来要解决的，就是这些编号从哪里来。

## 2.2 线程怎样编号和分块

这一节把“我负责哪个位置”一步步变成下标公式。

### 2.2.1 先分组，再在组内编号

当任务很多时，我们会把线程分成若干组。HIP 把这样的组叫**线程块（Block）**，AMD 的底层文档也叫它**工作组（Workgroup）**。本章两种叫法指的是同一层分组。一次 kernel 启动所包含的全部线程块，合在一起叫**网格（Grid）**。

下面做一个小的编号练习：**假设有 10 个元素，每块安排 4 个线程**。这是便于看清下标的手算配置，不是后面实验的 block 大小，也没有定义 wavefront 大小。

<!-- illustration: ch2-block-index；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch2-block-index
<a :href="blockIndexImage" target="_blank" rel="noopener" aria-label="查看线程分块与编号的高清原图">
  <img src="./images/block-index.webp" alt="10 个元素分配给 3 个各含 4 个线程的 block；block 1 的局部线程 2 对应全局下标 6，最后两个线程的下标 10、11 越界" />
</a>

手算示例：组内编号在每块中重新从 0 开始；块编号与组内编号共同确定全局下标。
:::

现在看 block 1 里组内编号为 2 的线程。它前面有一个完整块，已经负责了 4 个位置；它自己在当前块里再往后偏移 2 个位置，所以负责的全局下标是 `1 × 4 + 2 = 6`。

把这句话推广，就得到：

**全局下标 = 块编号 × 每块线程数 + 块内线程编号。**

HIP 已经为线程提供了这些编号，你不需要自己创建一个计数器：

| 代码里的名字 | 本章的一维数组里，它表示什么 | 手算例子 |
| --- | --- | --- |
| `blockIdx.x` | 我属于第几块 | 1 |
| `blockDim.x` | 每块有多少个线程 | 4 |
| `threadIdx.x` | 我在本块里是第几个线程 | 2 |
| `idx` | 计算得到的全局数组下标 | 6 |

变量后面的 `.x` 表示取 x 这一维。HIP 还支持多维分组，但我们现在只处理一维数组，先把这一维讲清楚就够了。

### 2.2.2 把编号放回已经见过的代码

回看[第 1 章的 Vector Add 源码](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter1/vector_add.hip)，核心函数就是下面这几行；第 4 章也会继续使用它：

```cpp
__global__ void vector_add(const float* a, const float* b, float* c, int n) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < n) {
    c[idx] = a[idx] + b[idx];
  }
}
```

`__global__` 标记这是由 CPU 发起、在 GPU 上运行的 kernel；`a`、`b`、`c` 指向 GPU 上的数组，`n` 是要处理的元素个数。函数里面先算出自己的下标，再判断这个位置是否有效，最后做加法。

为什么必须有 `idx < n`？回到 @fig-ch2-block-index：最后一块仍安排了 4 个线程，但数组只剩下位置 8 和 9。编号 10、11 的线程也会进入函数，却不应该读取或写入数组。条件判断让它们跳过加法，避免访问不属于这个数组的位置。

因此，“启动了几个线程”和“数组有几个元素”可以不同。你需要保证有效位置都有人处理，同时让多余的线程安全地跳过工作。

> **先试着判断：**手算配置仍为每块 4 个线程。block 2 中组内编号为 1 的线程负责哪里？组内编号为 3 的线程能执行加法吗？

<details>
<summary>展开看答案</summary>

前者的下标是 `2 × 4 + 1 = 9`，小于数组长度 10，可以执行加法。后者的下标是 `2 × 4 + 3 = 11`，已经越界，必须跳过。

</details>

## 2.3 一个线程块怎样组成 wavefront

这一节解释线程的分组与硬件的执行步调有什么关系。

前面为了说明分工，把线程画成了一份份独立工作。但 GPU 并不是给每份工作都配一套完全独立的指令控制。它会把线程进一步组成小队，让一队线程执行同一条指令，同时处理各自的数据。这种紧密的执行分组，叫**wavefront**。

本章已有实验报告的 wavefront 大小是 32，称为 **wave32**。wavefront 内的每个位置叫**通道（Lane）**，局部编号从 0 到 31。线程是程序中的一份工作，lane 则描述这份工作在 wavefront 内所处的位置。[HIP 编程模型](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html)

wavefront 在各个 block 内分别组成，不会把不同 block 的线程拼在一起补满。回看前面的手算例子，每块只有 4 个线程；在 wave32 模型下，每块只用到一个 wavefront 中的 4 个位置，其余位置不参与。下面改用每块 256 个线程，是为了观察多个完整 wavefront。

现在回到实验中的配置：每个 block 有 256 个线程，在 wave32 下会组成 `256 ÷ 32 = 8` 个 wavefront。编号要分两层看：

| wavefront 在块内的编号 | 它包含的块内线程编号 `threadIdx.x` | wavefront 内部的 lane 编号 |
| --- | --- | --- |
| 0 | 0～31 | 0～31 |
| 1 | 32～63 | 0～31 |
| … | … | … |
| 7 | 224～255 | 0～31 |

例如，块内线程 35 在第 1 号 wavefront 里，对应 lane 3。**lane 编号会在每个 wavefront 里重新开始，不能把块内线程 224 叫成 lane 224。**

<!-- illustration: ch2-wave-lanes；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch2-wave-lanes
<a :href="waveLanesImage" target="_blank" rel="noopener" aria-label="查看 Block 与 wave32 编号的高清原图">
  <img src="./images/wave-lanes.webp" alt="256 个线程分成 8 个 wave32；放大的 wavefront 7 中，lane 0 至 31 分别对应块内线程 224 至 255" />
</a>

在 256 线程、wave32 的配置下，完整展开 wavefront 7 的 32 个 lane。各 lane 执行相同指令，并不意味着输入值或数组位置相同。
:::

沿着 @fig-ch2-wave-lanes 看，block 负责把一批线程组织起来，wavefront 则决定其中哪些线程以紧密关联的方式执行。一个 block 还提供组内共享数据与同步的范围，这部分我们会在第 3 章看到。

这里还有一个容易混淆的地方：**组成了 8 个 wavefront，不等于这 8 个 wavefront 的所有指令同时开始、同时结束。** 谁先获得执行机会，还取决于硬件安排和所需数据是否准备好。

ROCm 的 `gfx1201` 规格同时列出了 wave32 和 wave64。本章按已经测得的 wave32 解释；换成 wave64 的 kernel，wavefront 大小和分组都需要重新确认，不能把 32 当成所有 AMD GPU 程序的固定常数。[ROCm GPU specifications](https://rocm.docs.amd.com/en/latest/reference/gpu-specs.html)

## 2.4 分支、EXEC 与有效 lane

这一节用参与状态解释：同一个 wavefront 里的线程遇到不同条件时，会怎样继续执行。

### 2.4.1 先看谁参加这一步

假设一个 wavefront 遇到条件判断，偶数 lane 选择 A 路径，奇数 lane 选择 B 路径。此时，只说“每个线程执行自己的分支”还不够，因为同一 wavefront 的向量指令需要在一组 lane 上执行。

我们可以先把每个 lane 想成带有一个“是否参与本步”的开关。执行 A 路径时，打开对应 lane 的开关；执行 B 路径时，再让另一部分 lane 参与。这份参与记录就叫**执行掩码（Execution Mask，EXEC）**。掩码这个名字并不神秘，它记录的就是哪些位置有效。

<!-- illustration: ch2-exec-masks；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch2-exec-masks
<a :href="execMasksImage" target="_blank" rel="noopener" aria-label="查看分支与有效 lane 的高清原图">
  <img src="./images/exec-masks.webp" alt="四步分镜：分支前所有 lane 参与，A 路径偶数 lane 参与，B 路径奇数 lane 参与，合流后恢复参与" />
</a>

wavefront 分支的参与状态示意，只显示 wave32 的前 8 个 lane。灰色斜线格表示不参与当前路径；行表示概念步骤，不是实测时钟周期。
:::

读 @fig-ch2-exec-masks 时，先固定一个 lane，竖着看它何时参加；再固定一行，横着看这条路径有哪些 lane 参加。你会发现：执行 A 路径时，奇数 lane 仍属于这个 wavefront，只是没有参加 A 路径的向量运算。两条路径处理完后，线程会在共同的后续位置继续，这叫**重新合流（Reconvergence）**。

同一 wavefront 内的线程选择了不同控制路径，这种情况叫**分支发散（Branch Divergence）**。理解它的关键，是看每条路径执行时有多少 lane 在参与，而不是把它想成两支队伍各自并行跑完后等待较慢的一支。[LLVM AMDGPU：EXEC 与条件控制流](https://llvm.org/docs/AMDGPUUsage.html#dw-at-llvm-lane-pc)

### 2.4.2 有 if，不一定就在 wavefront 内发散

如果一个 wavefront 的所有线程都选择 A，另一个 wavefront 的所有线程都选择 B，它们各自内部仍然一致。反过来，即使代码里只有一个很短的条件判断，只要同一 wavefront 内出现不同结果，就需要处理不同 lane 的参与状态。

| 条件结果怎么分布 | 单个 wavefront 内部是否选择了不同路径 |
| --- | --- |
| wavefront 0 全选 A，wavefront 1 全选 B | 没有，差异发生在 wavefront 之间 |
| 每个 wavefront 里，偶数 lane 选 A、奇数 lane 选 B | 有，差异发生在 wavefront 内部 |

这也能帮助你重新理解 `idx < n`：在数组尾部，同一 wavefront 里可能只有一部分线程的下标有效。它们执行加法，其余线程跳过。**边界检查首先保证正确性，不能因为担心发散就把它删掉。**

发散会让某些路径执行时只有部分 lane 工作，但不能仅凭源码里的 `if` 数量算出损失。编译器可能选择不同的指令实现，路径长短和数据访问也会影响时间。你现在先学会判断“哪些 lane 选了不同的路”，具体快慢交给后面的实验。

> **先试着判断：**整块线程都根据相同的块编号选择路径，与同一 wavefront 内按 lane 奇偶选择路径，哪一种更容易出现 wavefront 内发散？

<details>
<summary>展开看答案</summary>

后者。整块线程使用相同条件结果时，它所包含的各个 wavefront 内部也一致。lane 奇偶判断则把同一个 wavefront 分成了不同的参与集合。这里判断的是执行模式，没有预测具体耗时。

</details>

## 2.5 wavefront 在哪里执行：软件分工与硬件单元

这一节把已经理解的工作分组，放到真实硬件上看。

前面提到的 thread、block 和 grid，回答的是“程序怎样组织工作”。现在还需要认识承接这些工作的计算硬件。你可以把一份份线程工作看成待处理的工作单，把硬件看成处理工作单的设备：工作单很多，并不意味着现场也有同样多台设备。

在 AMD RDNA 的语境里，先区分下面几个名字：

| 名字 | 本章先掌握的含义 |
| --- | --- |
| **单指令多数据执行单元（Single Instruction, Multiple Data，SIMD）** | 用一条向量指令处理一组 lane 的数据；这里的“多数据”对应各 lane 不同的输入 |
| **计算单元（Compute Unit，CU）** | 包含执行单元及相关资源的一层硬件组织 |
| **工作组处理器（Workgroup Processor，WGP）** | RDNA 中包含 CU 的更外层组织，也与同一工作组的放置范围有关 |

<!-- illustration: ch2-software-hardware；提示词见 assets/architecture/illustration-prompts.md -->
::: figure fig-ch2-software-hardware
<a :href="softwareHardwareImage" target="_blank" rel="noopener" aria-label="查看软件分工与硬件执行的高清原图">
  <img src="./images/software-hardware.webp" alt="左侧展开 grid、block、wavefront 和线程，右侧展开 GPU、WGP、CU 与 SIMD，wavefront 的指令由硬件调度执行" />
</a>

工作分组与硬件单元的关系示意。图没有规定单元数量或某次运行的调度顺序，也不表示一个 block 独占一个硬件单元。
:::

如 @fig-ch2-software-hardware 所示，软件上的一组工作需要落到硬件资源上执行。LLVM 的 AMDGPU 文档对工作组给出了放置约束：同一工作组的 wavefront 在同一 WGP 中执行；更细的执行范围还与 CU/WGP 模式有关。[LLVM AMDGPU 执行模型](https://llvm.org/docs/AMDGPUUsage.html)

初学时，最有用的认识是：**逻辑上有多少线程，与物理上此刻能执行多少工作，是两个问题。** 把 block 调大，并不会凭空增加计算设备。第 3 章将进一步解释，为什么寄存器、共享存储和数据等待也会影响可执行的工作。

<details>
<summary>进阶：CU/WGP 模式，以及为什么设备字段有时对不上</summary>

在 LLVM 描述的 CU 模式下，一个工作组的 wavefront 在同一 CU 的 SIMD 上执行；WGP 模式允许使用同一 WGP 中不同 CU 的 SIMD。具体模式要看目标与编译产物，不能仅从 block 大小反推。

RX 9070 XT 的 AMD 产品规格列出 64 个物理 CU；本章既有环境记录中，HIP 的 `hipDeviceProp_t::multiProcessorCount` 读到的是 32。后者保留字段名解读，不改称“物理 CU 数”。两种信息的统计口径不同，查硬件时应同时看字段含义和目标平台。[AMD RX 9070 XT 产品规格](https://www.amd.com/en/products/graphics/desktops/radeon/9000-series/amd-radeon-rx-9070xt.html)

</details>

<details>
<summary>已有 CUDA 基础：名称对照</summary>

| HIP / CUDA 常见名称 | 本章 AMD 语境中的称呼 |
| --- | --- |
| thread | 线程；底层也称 work-item |
| block / thread block | 工作组 workgroup |
| warp | wavefront；大小按当前目标与 kernel 确认 |
| grid | 一次启动中的全部线程块 |
| shared memory / `__shared__` | 工作组共享的 LDS，第 3 章展开 |

名称能对应，不代表两个厂商的硬件数量、wavefront 大小或性能结果相同。

</details>

## 2.6 选做实验：比较两种分支排列

这一节把“能看懂参与状态”接到“用实验确认实际差距”。首次阅读可以先看结论，完整计时方法会在第 4 章和 Profiling 篇学习。

现有的 [`branch_divergence.hip`](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter2/branch_divergence.hip) 设置了两条计算路径。每条路径都包含四次有依赖的 FP32 乘加，但使用的常数不同；FP32 指单精度浮点数。对照只改变判断条件的排列方式：

| 模式 | 如何选择路径 | 对应前面的哪种情况 |
| --- | --- | --- |
| `wave-uniform` | 按 wavefront 编号选择，让一个 wavefront 内部的线程选择相同路径 | wavefront 内部一致 |
| `wave-divergent` | 按线程奇偶选择，让同一 wavefront 内部交替选择两路 | wavefront 内部发散 |

已有记录的汇总如下。硬件与环境为 **RX 9070 XT + ROCm 7.13 + 原生 Ubuntu 24.04**，输入为 **16,777,216 个 FP32 元素**，预热 10 次、计时 50 次，汇总 3 个独立进程的结果：

| 模式 | kernel 时间中位数（ms） | 相对时间 |
| --- | ---: | ---: |
| `wave-uniform` | 0.237 | 基线 |
| `wave-divergent` | 0.245 | 增加约 3.33% |

这组结果说明，在这个具体测试里，改变分支排列后整体时间发生了小幅变化。**它不是分支发散的固定罚时，也不能仅凭计时表证明编译器生成了哪一种分支指令。** 如果想把性能变化归因到某段机器指令，还需要继续查看编译产物。

<details>
<summary>复跑：现有命令、参数与结果来源</summary>

以下沿用原有实验命令，在原生 Ubuntu 实验机上执行；先按第 1 章完成本篇的 `uv sync`，并激活 `code/part0-intro/activate-rocm.sh`。这里的路径从仓库工作目录算起：

```bash
cd code/part0-intro/chapter2
hipcc --offload-arch=gfx1201 -O3 -std=c++17 branch_divergence.hip -o branch_divergence
# --implementation all 会依次跑 wavefront-uniform 和 wavefront-divergent 两种
./branch_divergence --implementation all --size 16777216 --warmup 10 --repeat 50
```

`--size` 是元素个数，`--warmup` 是不计入结果的预热次数，`--repeat` 是正式计时次数。`--implementation all` 在一个进程里依次运行两种模式；正文表格来自三个独立进程的汇总，不是这条命令执行一次就能产生的全部统计。

两种模式的进程中位数范围分别为 0.237～0.239 ms 和 0.244～0.247 ms。完整精度保留在 [summary.csv](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter2/evidence/summary.csv)，测量源码版本及日志摘要见 [manifest.json](https://github.com/datawhalechina/hello-gpu/blob/dev/code/part0-intro/chapter2/evidence/manifest.json)。

</details>

## 本章小结

- 一个线程可以负责一个数组位置；kernel 是这些线程共同执行的计算规则。
- 块编号、每块线程数与块内编号共同确定全局下标，边界条件保证多余线程不越界。
- block 是工作分组，wavefront 是其中紧密关联的执行分组；wave32 内的 lane 编号始终是 0～31。
- 同一 wavefront 选择不同路径时，EXEC 记录各段指令的参与 lane；具体性能影响需要测量。
- 软件里的线程数量，不等于硬件此刻能执行的工作数量。下一章继续跟着数组加法，看看输入与临时结果存在哪里，以及 GPU 怎样减少等数据的时间。

## 自我检验

先不展开答案，试着完成下面三个任务：

1. 用“每块 4 个线程、共 10 个元素”的手算配置，指出 block 1 的线程 3 读写哪个位置。
2. 在一个 256 线程的 block、wave32 的配置下，指出块内线程 63 属于哪个 wavefront、对应哪个 lane。
3. wavefront 0 全走 A、wavefront 1 全走 B，是否已经构成了 wavefront 内发散？说明判断依据。

<details>
<summary>参考答案</summary>

1. 全局下标为 `1 × 4 + 3 = 7`，读取 `a[7]`、`b[7]`，写入 `c[7]`。
2. 它属于块内第 1 号 wavefront，是其中的 lane 31。wavefront 编号从 0 开始。
3. 没有。判断 wavefront 内发散，要检查同一个 wavefront 里的线程是否选择了不同路径，而不是比较不同 wavefront。

</details>

## 延伸阅读

- [HIP 编程模型](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html)：从线程层级和索引回看本章内容。
- [LLVM AMDGPU Usage Guide](https://llvm.org/docs/AMDGPUUsage.html)：进阶查阅执行模型和 EXEC；第一次阅读不必通读整份手册。
- [ROCm GPU specifications](https://rocm.docs.amd.com/en/latest/reference/gpu-specs.html)：核对具体目标支持的 wavefront 大小。
- [第 3 章：片上资源与数据通路](../chapter3/index.md)：继续追踪线程计算时使用的数据。
