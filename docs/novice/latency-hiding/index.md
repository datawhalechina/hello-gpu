---
layout: stage
stage: novice-latency-hiding
newTerms: [latency-hiding, occupancy]
evidence: simulated
description: 一条流水线只有 32 个工位，为什么要派几百个线程？小队去仓库取一个数，要等一百多个周期。派几支小队轮流用一条流水线，看等待怎样藏起来；再让每个线程多用几个寄存器，看住下的小队怎样变少。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import RegisterLab from './scenes/RegisterLab.vue'
import ShiftBoard from './scenes/ShiftBoard.vue'
import WaveLab from './scenes/WaveLab.vue'
import {
  BEST_CYCLES, CYCLES_BY_WAVES, FETCH_WAIT, LANE_VGPRS, LDS_EXAMPLES, LINE_CYCLES, MEM_LATENCY, PART_N, SLOTS, STAGE_ID,
  STAR_LABELS, STEPS_PER_FETCH, STEP_CYCLES, TARGET_CYCLES, WAVE, WGP_LDS_KB, WGP_SIMDS, ldsSeats, occupancyOf, percent,
  seatsOf, times,
} from './challenge.ts'

const S = STAGE_ID
const GOAL = `给一条流水线排班：${PART_N} 个数都加进 part，用时（模拟）还要最短。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const PANORAMA = stageById('novice-gpu-panorama')
const HIERARCHY = stageById('novice-memory-hierarchy')
const COALESCING = stageById('novice-coalescing')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
const SIMDS_ALL = HW.params.cuCount.value * HW.params.simdsPerCu.value
const LANES_ALL = SIMDS_ALL * HW.params.lanesPerSimd.value
/** 按这一关的示意值，每条流水线都住满名额，要派多少个线程。 */
const FULL_THREADS = SIMDS_ALL * SLOTS * WAVE

// 热身：甲派 1 组，乙派 16 组。用时是 L4 照工作单排出来的（challenge.ts 的常数，单测拿模拟器核对）。
const SOLO = CYCLES_BY_WAVES[1]
const CREW = CYCLES_BY_WAVES[16]
const BUSY_ROUND = 16 * STEPS_PER_FETCH * STEP_CYCLES

const pRace = [
  { label: '甲：只有 1 支，不用和别人抢流水线', why: `甲每算 ${STEPS_PER_FETCH} 步，就要去仓库等 ${FETCH_WAIT} 个周期。这时没有别的小队可换，流水线只能空等，甲用时 ${SOLO} 个周期（模拟）。` },
  { label: `差不多：工位只有 ${WAVE} 个，派多了也得排队`, why: '乙的小队不是干排队：一支去仓库等数据时，正好让别的小队用流水线。' },
  { label: '乙快得多', correct: true, why: `一支去仓库等数据，另一支顶上来算。乙用时 ${CREW} 个周期，比甲快了 ${times(SOLO / CREW)} 倍（模拟）。` },
  { label: '我不确定', why: '不确定也没关系，下面一组一组地派，看流水线在干什么。' },
]

// 探索二的先猜：每个线程 128 个寄存器。原理里占用率的例子也用它。
const SEATS = seatsOf(128)
const Q_SEATS = `每个线程用 ${SEATS.vgprs} 个寄存器，一条流水线住得下几支小队？`
const SEATS_PERCENT = percent(occupancyOf(SEATS.resident))
const pSeats = [
  { label: `${SLOTS} 支：名额有 ${SLOTS} 个`, why: `名额够，工具台不够：每个工位只有 ${LANE_VGPRS} 个寄存器，住下的每支小队都要占 ${SEATS.vgprs} 个。` },
  { label: `${SEATS.resident} 支`, correct: true, why: `${LANE_VGPRS} ÷ ${SEATS.vgprs} = ${SEATS.byRegisters}：工具台只够分给 ${SEATS.resident} 支，名额还空着 ${SLOTS - SEATS.resident} 个。` },
  { label: `1 支：一个线程就占 ${SEATS.vgprs} 个`, why: `${SEATS.vgprs} 个是一个线程在自己工位上占的。一个工位有 ${LANE_VGPRS} 个，分得出好几份。` },
  { label: '我不确定', why: '不确定也没关系，下面拨一拨每个线程用的寄存器。' },
]

const [BIG_LDS, SMALL_LDS] = LDS_EXAMPLES
// 检查点第 2 题：每组 16 KB 货架（正文的例子是 8 KB 和 2 KB）。
const Q_LDS = ldsSeats(16)
const Q_LDS_PERCENT = (Q_LDS.perSimd / SLOTS) * 100

const checkpoint = [
  {
    q: '假想一份工作单：每支小队算 10 步，就要去仓库等 100 个周期（一步一个周期）。想让一条流水线一刻不停，至少要住几支小队？',
    options: [
      { label: '10 支', why: '一支去等的 100 个周期，要靠别的小队来填：每支能算 10 步，得另外 10 支。再加上它自己，是 11 支。' },
      { label: '11 支', correct: true, why: '它算完 10 步去等；接下来的 100 个周期，另外 10 支各算 10 步，正好填满，它要的数也回来了。' },
      { label: '100 支', why: '每支轮到时能连着算 10 步，不是 1 步：另外 10 支就够填满 100 个周期。' },
    ],
  },
  {
    q: `假想一份工作单，每组一支小队，每组要用 ${Q_LDS.kb} KB 货架，寄存器够用。一个 WGP 的 ${WGP_SIMDS} 条流水线合用 ${WGP_LDS_KB} KB 货架，每条最多住 ${SLOTS} 支（同这一关的示意值）。平均每条流水线住几支？`,
    options: [
      { label: `${Q_LDS.groups} 支`, why: `${WGP_LDS_KB} ÷ ${Q_LDS.kb} = ${Q_LDS.groups}，是整个 WGP 住得下的组数，还要分到 ${WGP_SIMDS} 条流水线上。` },
      { label: `${Q_LDS.perSimd} 支`, correct: true, why: `货架只够 ${Q_LDS.groups} 组，分到 ${WGP_SIMDS} 条流水线上，每条平均 ${Q_LDS.perSimd} 支，占用率 ${Q_LDS_PERCENT}%。` },
      { label: `${SLOTS} 支`, why: `名额有 ${SLOTS} 个，可货架先用完了。` },
    ],
  },
  {
    q: '一条流水线的名额住满了。这一刻，住下的小队全在等仓库送数据。流水线在做什么？',
    options: [
      { label: '空着：没有准备好的小队可换', correct: true, why: '住满只说明能换的多，不保证这一刻有人准备好了。占用率高，不等于等待全藏住。' },
      { label: '从门外再请一支小队进来算', why: '名额已经满了，门外的进不来。住下的有一支做完，才空出名额。' },
      { label: '先替在等的小队算后面几步', why: '后面几步要用的数还没送到，算不了。' },
    ],
  },
]
</script>

# 1-12 藏起等待

<div class="lh-hello">
  <Mascot class="lh-hello__art" :size="64" />
  <p class="lh-hello__line">流水线才 {{ WAVE }} 个工位，派几百个线程做什么？</p>
</div>

第 {{ HIERARCHY.code }} 关量过：去城外仓库取一个数，一趟要等 {{ MEM_LATENCY }} 个周期（模拟）。第 {{ PREV.code }} 关学会了看表。

这一关看一条流水线的时间线：小队去仓库等数据的时候，流水线在干什么？

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

先看只派 1 支小队时，流水线怎样空等；再多派几支、调一调每个线程用的寄存器；最后自己给一条流水线排班。

</Mission>

## 热身：派 1 支，还是派 16 支？

还是第 {{ COALESCING.code }} 关挑战的工作单：每个线程把几个数加到工具台上的 s，最后存进 part。

<LangCode>
<template #hip>

```cpp
__global__ void part_sum(float* a, float* part, int m) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    int T = gridDim.x * blockDim.x;   // 一共几个线程
    float s = 0;
    for (int k = 0; k < m; k++) {
        int i = k * T + t;   // 第 k 轮拿第几个数
        s = s + a[i];
    }
    part[t] = s;
}
```

</template>
<template #python>

```python
@kernel
def part_sum(a, part, m):
    t = blockIdx.x * blockDim.x + threadIdx.x
    T = gridDim.x * blockDim.x    # 一共几个线程
    s = 0.0
    for k in range(m):
        i = k * T + t    # 第 k 轮拿第几个数
        s = s + a[i]
    part[t] = s
```

</template>
</LangCode>

这一关，{{ PART_N }} 个数都交给同一条流水线。每组派 {{ WAVE }} 个线程，正好一支小队。两种派法：

- 甲：派 1 组，每人加 {{ PART_N / WAVE }} 个；
- 乙：派 16 组，每人加 {{ PART_N / (16 * WAVE) }} 个。

流水线只有 {{ WAVE }} 个工位，一次只给一支小队算。

<Predict :stage="S" id="lh-p-race" question="甲、乙两种派法，谁先加完？" :options="pRace">

下面一组一组地派，看流水线在干什么。

</Predict>

## 探索一：一支等，一支算

一条流水线上能同时住好几支小队，模拟器里最多 {{ SLOTS }} 支，这叫名额。可流水线一次只给其中一支算。

取一个数，小队要等 {{ FETCH_WAIT }} 个周期：仓库一趟 {{ MEM_LATENCY }} 个，再搬一车 {{ LINE_CYCLES }} 个（模拟）。下面换着派 1～16 组，每人加的个数跟着变，正好分完。

<WaveLab />

一支小队去仓库等数据，流水线就换一支准备好的上来算，等待被别人的活盖住了。派到 16 支也没全藏住：每支算 {{ STEPS_PER_FETCH }} 步就要等 {{ FETCH_WAIT }} 个周期，16 支轮一圈只有 {{ BUSY_ROUND }} 个周期的活，填不满这段等待。

## 探索二：工具台占地方

住在流水线上的小队，每支都占着一份工具台：t、T、s 这些数，它的每个线程都要记着。

模拟器里，每个工位旁有 {{ LANE_VGPRS }} 个寄存器。住下的每支小队，在每个工位上都有一个线程，各占一份。

<Predict :stage="S" id="lh-p-seats" :question="Q_SEATS" :options="pSeats">

下面拨一拨每个线程用的寄存器。

</Predict>

<RegisterLab />

每个线程的寄存器用得越多，一条流水线住下的小队越少。住不下的在门外等；住下的少了，一支去仓库时能顶上的也少，藏住的等待就少。

## 原理：延迟隐藏和占用率

藏起等待，靠的是一条流水线上同时住着好几支小队：一支等，别的算。能藏多少，先看住得下几支。

<ConceptCard term="latency-hiding">

模拟器里，小队取一个数要等 {{ FETCH_WAIT }} 个周期，自己只算 {{ STEPS_PER_FETCH }} 步。这段时间里能顶上来算的小队越多，藏住的越多。

</ConceptCard>

<ConceptCard term="occupancy" code="住下的 wave ÷ 名额">

模拟器里一条流水线有 {{ SLOTS }} 个名额：住下 {{ SEATS.resident }} 支，占用率是 {{ SEATS.resident }} ÷ {{ SLOTS }} = {{ SEATS_PERCENT }}。住得下几支，看名额、寄存器、货架哪一样先用完。

</ConceptCard>

货架（LDS）也一样。一个 WGP 是两间打通的车间，{{ WGP_SIMDS }} 条流水线合用 {{ WGP_LDS_KB }} KB 货架。每组一支小队、用 {{ BIG_LDS.kb }} KB 时，货架只够 {{ BIG_LDS.groups }} 组，平均每条流水线 {{ BIG_LDS.perSimd }} 支，名额空着一大半；每组只用 {{ SMALL_LDS.kb }} KB，货架够 {{ SMALL_LDS.groups }} 组，每条 {{ SMALL_LDS.perSimd }} 支，名额住满了（模拟）。

真程序里，每个线程用几个寄存器由编译器照工作单定：同时要记着的数越多，用得越多。货架用多少，看工作单开了多大的共享数组。

现在能回答开头的问题了。{{ HW.name }} 一共 {{ LANES_ALL }} 个工位（第 {{ PANORAMA.code }} 关数过）。派的线程正好这么多，平均每条流水线只住 1 支小队，它一去仓库，流水线就空等。

按这一关的示意值，{{ SIMDS_ALL }} 条流水线各住满 {{ SLOTS }} 支，要派 {{ FULL_THREADS }} 个线程，是工位数的 {{ SLOTS }} 倍。所以要派远多于工位数的线程。

比喻的边界：小队去仓库，并没有离开流水线。它的数都留在自己那份工具台上，数一送到就能接着算，所以换人不花时间。也正因为一直占着，工具台不够分，就住不下。

<DeepDive title="出处：延迟隐藏和占用率">

- AMD GPUOpen《[Occupancy explained](https://gpuopen.com/learn/occupancy-explained/)》：一条 SIMD 上可以住好几个 wave，同一时刻只执行其中一个，可以一个周期一个周期地换；一个 wave 等显存时，GPU 换另一个来算。没有命中缓存的显存访问要几百个周期。占用率是住下的 wave 数除以名额，RDNA 2、RDNA 3 每条 SIMD 有 16 个名额（第一代 RDNA 是 20 个）。住得下几个，要看每个 wave 要多少寄存器和 LDS，这在编译时就定了。
- 同一篇还写了：住下的 wave 数乘上每个 wave 两次取数之间的计算，比取数的时间还短，多住几个才有用；占用率最高，也只是藏等待的本事最大，不保证全藏住；住得多有时反而更慢，因为大家一起取数，缓存装不下。寄存器不够时，编译器会把一些数挪到显存（寄存器溢出），代价很大。
- AMD GPUOpen《[RDNA Architecture](https://gpuopen.com/download/RDNA_Architecture_public.pdf)》演示文稿的 Vector register file 一页：第一代 RDNA 每条 SIMD32 有 1024 个寄存器，分给住下的 wave，每个最多 256 个；每个 wave32 用 256 个时住得下 4 个，用 64 个时住得下 16 个。
- HIP 文档《Hardware implementation》：[Latency hiding through multithreading](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/hardware_implementation.html#latency-hiding-through-multithreading) 一节说，wave 够多时，一个在等就执行别的，所有 wave 的状态一直留在硬件上，换起来没有开销；[Register pressure and occupancy](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/hardware_implementation.html#register-pressure-and-occupancy) 一节说，每个线程用的寄存器越多，能同时跑的 wave 越少。HIP 文档管 wave 叫 warp。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 只看一条流水线：派出去的小队都排在它这儿。真卡上，小队分到很多条流水线上，{{ HW.name }} 有 {{ SIMDS_ALL }} 条。
- 住不下的小队，要等前一批全部做完才一起住进来。真卡上一支做完，空出来的名额和寄存器就能补进下一支。
- 名额 {{ SLOTS }} 个、每个工位 {{ LANE_VGPRS }} 个寄存器是示意值，借的是上面两份资料里的数：RDNA 2、RDNA 3 每条 SIMD 有 16 个名额，第一代 RDNA 每条 SIMD32 有 1024 个寄存器。{{ HW.name }} 的这两个数[待实测]。一个 WGP 有 {{ WGP_SIMDS }} 条 SIMD、{{ WGP_LDS_KB }} KB LDS，和 {{ HW.name }} 一样（RDNA 4 指令集手册）。
- 算一步 {{ STEP_CYCLES }} 个周期、仓库一趟 {{ MEM_LATENCY }} 个周期、搬一车 {{ LINE_CYCLES }} 个周期，都是示意值（同第 {{ HIERARCHY.code }}、{{ PREV.code }} 关）。真卡上一条语句会编译成好几条指令，等一趟显存要多久[待实测]。
- 每个线程用几个寄存器，这一关是直接设定的。真程序里由编译器定：用得少了放不下，编译器就把一些数挪到显存，又要跑仓库。
- 很多小队一起去仓库，模拟器不让它们排队。真卡上一起取数的太多，路会堵，住得多也不一定更快。
- 准备好的小队里，模拟器先给等得最久的那支算。这是模拟器定的规则，真卡上调度器怎么挑，这一关不讲。

</DeepDive>

## 挑战：给一条流水线排班

现在你来排班：派几组、每人加几个、每个线程用几个寄存器。{{ PART_N }} 个数都要加进 part，每个只加一次。

这是星级挑战：每个数都加进 part、只加一次，拿第一颗星；用时（模拟）降到 {{ TARGET_CYCLES }} 个周期以内，拿第二颗；降到最短的 {{ BEST_CYCLES }} 个周期，拿第三颗。没过不扣分，没过两次以后会出现提示。

<ShiftBoard />

## 你现在能……

- 说出为什么要派远多于工位数的线程：一支小队等数据时，流水线换另一支来算
- 看出每个线程的寄存器、每组的货架用得越多，一条流水线同时住下的小队越少
- 算出一条流水线住得下几支、占用率多少，看出是名额、寄存器还是货架先用完

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：这一关的派法，是你拨着旋钮一次次试出来的。下一关认识 Agent：一个会自己动手试、看结果、再决定下一步的程序。

- 回到基础：[旧版第 3 章 3.4 访存等待与指令调度](/part0-intro/chapter3/#_3-4-访存等待与指令调度)，wavefront A 等数据时，调度器先安排已经就绪的 B。
- 深入一层：[旧版第 3 章补充：执行资源与占用率](/part0-intro/chapter3/experiments#执行资源与占用率)，驻留、就绪、执行三种状态，以及占用率高为什么不一定更快。

<EvidenceCard kind="simulated">这一关的周期数、占用率和藏住的比例，都是模拟器算出来的，不是实测：小队做的每一步来自模拟器跑工作单的事件流，再按示意值排到一条流水线上。算一步 {{ STEP_CYCLES }} 个周期、仓库一趟 {{ MEM_LATENCY }} 个周期、搬一车 {{ LINE_CYCLES }} 个周期、每条流水线 {{ SLOTS }} 个名额、每个工位 {{ LANE_VGPRS }} 个寄存器，都是为了好算、好比定的示意值。{{ HW.name }} 一条 SIMD 的名额和寄存器数、等一趟显存要多久[待实测]，实验档案馆里还没有这一关的记录。工位 {{ LANES_ALL }} 个、流水线 {{ SIMDS_ALL }} 条，是用 AMD 产品页和 RDNA 4 指令集手册上的数算出来的。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-11 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.lh-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.lh-hello__art {
  flex: none;
}

.lh-hello__line {
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
.hg-shell.is-plain .lh-hello__art {
  display: none;
}

.hg-shell.is-plain .lh-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
