---
layout: stage
stage: novice-wavefront
newTerms: [wavefront, simd, lane]
evidence: simulated
description: 一组线程进了车间，还要按 32 个一队排成小队：一条流水线一次只发一个口令，整队一起照做。一步一步看小队怎样走，再挑一个不留空工位的派法。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import SquadStepper from './scenes/SquadStepper.vue'
import SquadSplit from './scenes/SquadSplit.vue'
import SquadChallenge from './scenes/SquadChallenge.vue'
import { CHALLENGE_N, STAGE_ID, STAR_LABELS } from './challenge.ts'

const S = STAGE_ID
const GOAL = `派出刚好够用的线程，把 ${CHALLENGE_N} 对数都加完，而且每一支小队都坐满。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const PANORAMA = stageById('novice-gpu-panorama')
const LATENCY = stageById('novice-latency-hiding')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
const LANES = HW.params.lanesPerSimd.value
const SIMDS = HW.params.simdsPerCu.value
const GFX = HW.params.gfx.value

const pSteps = [
  { label: '32 个线程的多，差不多多 32 倍', why: '32 个线程不是一个接一个地走。每一步，它们一起走同一行。' },
  { label: '一样多', correct: true, why: '每一步，整队一起走同一行。人多人少，都是把这几行走一遍。' },
  { label: '1 个线程的多', why: '1 个线程也只走这几行，不会多走。' },
  { label: '我不确定', why: '不确定也没关系，下面一步一步走给你看。' },
]

const pSplit = [
  { label: '1 支，40 个挤在一起', why: '一支小队最多 32 个线程：一条流水线只有 32 个工位。' },
  { label: '2 支：32 个和 8 个', correct: true, why: '按 threadIdx.x 的顺序，0～31 是第一支，32～39 是第二支。第二支空着 24 个工位。' },
  { label: '2 支：各 20 个', why: '人数不会平分：前一支先坐满 32 个，剩下的才排进下一支。' },
  { label: '我不确定', why: '不确定也没关系，下面换着人数看一看。' },
]

const checkpoint = [
  {
    q: '一组派 100 个线程，32 人一队，会排成几支小队？',
    options: [
      { label: '3 支', why: '3 支只坐得下 96 个线程，还剩 4 个。' },
      { label: '4 支', correct: true, why: '前 3 支各坐 32 个；第 4 支只坐 4 个、空着 28 个工位，可它照样要走完每一步。' },
      { label: '100 支', why: '一支小队有 32 个工位，不是一个线程一支。' },
    ],
  },
  {
    q: '都派 96 个线程：A 每组 48 个、派 2 组；B 每组 96 个、派 1 组。32 人一队时，哪种排出的小队少？',
    options: [
      { label: 'A 少', why: 'A 每组 48 个要排 2 支（32 个 + 16 个），两组一共 4 支。' },
      { label: 'B 少', correct: true, why: 'B 一组 96 个正好 3 支，每支都坐满；A 要 4 支，其中 2 支只坐了一半。' },
      { label: '一样多', why: '线程一样多，小队不一定一样多：小队只在组里排，两组的零头不会拼成一支。' },
    ],
  },
  {
    q: '换成 64 人一队，一组派 96 个线程，会排成怎样的小队？',
    options: [
      { label: '1 支，96 个挤在一起', why: '64 人一队时，一支小队最多 64 个线程。' },
      { label: '2 支：64 个和 32 个', correct: true, why: '第二支只坐了一半，空着 32 个工位。想坐满，每组线程数要取 64 的整数倍。' },
      { label: '2 支：各 48 个', why: '人数不会平分：前一支先坐满 64 个，剩下的才排进下一支。' },
    ],
  },
]
</script>

# 1-5 一起行动的小队

<div class="wf-hello">
  <Mascot class="wf-hello__art" :size="64" />
  <p class="wf-hello__line">一组线程进了车间，还要再排成小队。</p>
</div>

第 {{ PREV.code }} 关把线程分成组，一组整组派进一间车间。车间里干活的是流水线，{{ HW.name }} 的一条流水线上有 {{ LANES }} 个工位。

一组线程怎样站上流水线？站在同一条流水线上的线程，为什么每一步都做同一件事？

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

还是第 {{ PREV.code }} 关那张工作单：两排数逐个相加。这一关不改代码，只改派法：每组几个线程，派几组。

</Mission>

## 热身：人多，步数也多吗？

模拟器一步一步执行工作单，一步走一行代码。下面是第 {{ PREV.code }} 关写好的工作单：先算全局下标，再做边界检查。

<LangCode>
<template #hip>

```cpp
__global__ void add(float* a, float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        c[i] = a[i] + b[i];
    }
}
```

</template>
<template #python>

```python
@kernel
def add(a, b, c, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        c[i] = a[i] + b[i]
```

</template>
</LangCode>

<Predict :stage="S" id="wf-p-steps" question="同一张工作单，一组派 1 个线程，和一组派 32 个线程，哪一种走完要的步数多？" :options="pSteps">

下面的单步执行器可以换人数。先派 32 个线程走一遍，再换成 1 个、8 个，数一数一共几步。

</Predict>

## 探索一：一个口令，整队一起动

下面的单步执行器派 1 组线程。每点一次「下一步」，看两处：代码里亮起的那一行，和亮起来的机器人。

<SquadStepper />

派 1 个、8 个还是 32 个线程，模拟器里都是 3 步走完。每一步只发一个口令，站上去的机器人一起照做，各算各的那一格。

人少的时候，空着的工位并没有去干别的活。这 3 步里，它们一直闲着。

## 探索二：第 33 个线程

一条流水线只有 {{ LANES }} 个工位。一组的线程比工位多，会怎样排？

<Predict :stage="S" id="wf-p-split" question="一组派 40 个线程，会排成几支小队？" :options="pSplit">

下面换着派 32、33、40、64 个线程，看一组怎样排成小队。

</Predict>

<SquadSplit />

一组按 `threadIdx.x` 的顺序排队，每 {{ LANES }} 个一支小队；最后一支不够 {{ LANES }} 个，也照样算一支。

33 个线程排成 2 支，第 2 支只有 1 个线程。它和坐满的那支一样，要走完全部 3 步。

## 原理：小队、流水线和工位

这一关的小队、流水线和工位，各有一个正式的名字。

<ConceptCard term="wavefront" code="wave32 · wave64">

一组线程按 `threadIdx.x` 的顺序，每 32 个排成一个 wavefront（常简称 wave）。最后一个不够 32 个，也照样算一个。

</ConceptCard>

<ConceptCard term="simd" code="SIMD32">

车间里的一条流水线就是一个 SIMD。它一次只发一条指令，一个 wave 的 32 个线程一起执行，各用各的数据。

</ConceptCard>

<ConceptCard term="lane" code="threadIdx.x % 32">

线程在 wave 里排第几，就站第几号 lane。32 个一队时，lane 号就是 `threadIdx.x` 除以 32 的余数。

</ConceptCard>

为什么不让每个线程各走各的？因为管「发口令」的部件很占地方：要取指令、读懂指令、安排先后。一个口令带动整个 wave，这套部件就能少放很多，省下的芯片面积拿来多放工位。

代价是：同一个 wave 的线程，同一时刻只能做同一件事。大家照着同一张工作单、各算各的数，这样正好合适。

落到硬件上：一组线程派进车间以后，按 `threadIdx.x` 每 32 个切成一个 wave，SIMD 一次给整个 wave 执行一条指令。{{ HW.name }} 的每个计算单元有 {{ SIMDS }} 个 SIMD，每个 SIMD 有 {{ LANES }} 个 lane。

所以每组线程数最好取 32 的整数倍，wave 才个个坐满。真实程序常用的 256，正好是 8 个 wave：

<LangCode>
<template #hip>

```cpp
int threads = 256;                         // 32 的整数倍：正好 8 个 wave
int blocks = (n + threads - 1) / threads;  // 组数向上取整
add<<<blocks, threads>>>(d_a, d_b, d_c, n);
```

</template>
<template #python>

```python
threads = 256                          # 32 的整数倍：正好 8 个 wave
blocks = (n + threads - 1) // threads  # 组数向上取整
add[blocks, threads](d_a, d_b, d_c, n)
```

</template>
</LangCode>

<DeepDive title="出处：SIMD 怎样执行一个 wave">

- HIP 编程模型：线程按 SIMD 的 lane 数分成 wave，每条指令对每个 wave 发一次；线程数不能被 wave 大小整除时，多出来的 lane 被关掉，不参与执行（[HIP 文档：SIMT](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#single-instruction-multiple-threads-simt)）。
- 指令以 wave 为单位发出，同一个 wave 的线程锁步执行同一条指令（[HIP 文档：硬件实现](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/hardware_implementation.html#sequencer-and-scheduling)）。
- CPU 把大量芯片面积花在指令流控制、分支预测和复杂的缓存上，GPU 把大部分面积给了运算流水线（[同一篇文档](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/hardware_implementation.html#overall-gpu-architecture)）。

</DeepDive>

<DeepDive title="wave32 和 wave64">

{{ HW.name }}（{{ GFX }}）两种 wave 都支持：一个 wave 可以是 32 个线程，也可以是 64 个（[ROCm GPU 规格表](https://rocm.docs.amd.com/en/latest/reference/gpu-specs.html)）。用哪一种，编译时就定了：编译器默认用原生的 32，加上编译选项 `-mwavefrontsize64` 才编成 64（[LLVM AMDGPU 文档](https://llvm.org/docs/AMDGPUUsage.html#amdgpu-target-features)）。

SIMD 只有 32 个 lane，wave64 的向量运算和读写，通常要分两次执行：先算低 32 个线程，再算高 32 个（[RDNA4 指令集手册](https://gpuopen.com/download/rdna4-instruction-set-architecture.pdf) 2.1 节）。别的 AMD GPU 也有 64 个线程一个 wave 的，比如 CDNA 架构（[HIP 文档：硬件实现](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/hardware_implementation.html#compute-unit-architecture)）。

所以挑战的第三颗星，要你的派法换成 64 人一队也不浪费。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

模拟器把一行代码算一步，方便一步一步看。真实的一行会编译成好几条指令，比如读 `a[i]`、读 `b[i]`、相加、写 `c[i]`，每一条都是整个 wave 一起执行。

一组有好几个 wave 时，模拟器让它们一个接一个地走，结果才稳定。真机上，同一组的几个 wave 可以在不同的 SIMD 上同时走，谁先谁后不一定。

</DeepDive>

比喻的边界：画里一支小队一直站在一条流水线上。真实的 SIMD 上可以同时住着好几个 wave，轮流发口令：一个在等数据，就换另一个上。第 {{ LATENCY.code }} 关会讲。

## 挑战：128 对数

现在换成 {{ CHALLENGE_N }} 对数。工作单不变，每组几个线程、派几组由你来定。

这是星级挑战：{{ CHALLENGE_N }} 个数都算对，拿第一颗星；32 人一队时，小队一支都不多、支支坐满，拿第二颗；换成 64 人一队，同样的派法小队也最少，拿第三颗。没过不扣分，没过两次以后会出现提示。

<SquadChallenge />

## 你现在能……

- 说出一组线程怎样排成 wave：按 `threadIdx.x` 每 32 个一个，最后一个可能坐不满
- 解释为什么同一个 wave 的线程要一起执行同一条指令：一个口令带动整个 SIMD，省下发口令的部件
- 按 wave 的大小挑每组线程数：取 32 的整数倍，想兼顾 wave64 就取 64 的整数倍

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：小队走到 `if` 前，有的线程要往左，有的要往右，可口令只有一个，会怎样？

- 回到基础：[旧版第 2 章 2.2.2 线程块内的 wavefront](/part0-intro/chapter2/#_2-2-2-线程块内的-wavefront)，同样把一组 64 个线程分成两个 32 个线程的 wave，看一份指令怎样带动一组线程。
- 深入一层：[旧版第 2 章 2.3.4 线程编号与 lane 编号](/part0-intro/chapter2/#_2-3-4-线程编号与-lane-编号)，算一算组里的线程号对应第几个 wave、第几号 lane。

<EvidenceCard kind="simulated">这一关的结果来自浏览器里的模拟器：每一步哪些线程在干活、一组排成几个 wave、每个 wave 走了几步，都是它按工作单跑出来的，不计时。模拟器把一行代码算一步，一组里的 wave 一个接一个地走，真机不是这样（见上面的「模拟器简化了什么？」）。每个 SIMD {{ LANES }} 个 lane、每个计算单元 {{ SIMDS }} 个 SIMD 出自 AMD 的 RDNA4 指令集手册，wave 可以是 32 或 64 个线程出自 ROCm 的 GPU 规格表，都不是实测；流水线和工位的画法是示意。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-4 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.wf-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.wf-hello__art {
  flex: none;
}

.wf-hello__line {
  flex: 1 1 auto;
  max-width: 34em;
  margin: 10px 0 0;
  padding: 12px 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  border-top-left-radius: 4px;
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  font-size: 17px;
}

/* 简洁模式收起插画（01 第 4 节），台词照样留着。 */
.hg-shell.is-plain .wf-hello__art {
  display: none;
}

.hg-shell.is-plain .wf-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
