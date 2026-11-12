---
layout: stage
stage: novice-gpu-panorama
newTerms: [cu, vram, host-device]
evidence: simulated
description: 把一块 RX 9070 XT 芯片一层层放大，再跟着一份活从 CPU 走到 GPU、再走回来：GPU 由哪些部分组成，数据要经过哪些地方。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import ChipPanorama from './scenes/ChipPanorama.vue'
import TaskJourney from './scenes/TaskJourney.vue'
import JourneyPlan from './scenes/JourneyPlan.vue'
import { DEFAULT_SPEC as HW, countsOf, sizeText } from './panorama.ts'
import { STAGE_ID, STAR_LABELS } from './challenge.ts'

const S = STAGE_ID
const GOAL = '把三排数交给 GPU 加起来，结果送回 CPU：算对，而且一次也不多搬。'

// 硬件参数都从 hardware.json 读（09 第 4 节），正文不手写。
const N = countsOf(HW)
const SP = HARDWARE_DEVICES[DEFAULT_DEVICE_ID].params.streamProcessors.value
const VRAM = `${sizeText(HW.vram)} ${HW.vramType}`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const NEXT = neighborsOf(S).next
const GROUPS = stageById('novice-thread-groups')
const TIMING = stageById('novice-timing')
const YOUR_GPU = stageById('forge-your-gpu')

const pLanes = [
  { label: `${HW.cuCount} 个`, why: `${HW.cuCount} 是车间（计算单元）的个数。每间车间里还有 ${HW.simdsPerCu} 条流水线，每条排着 ${HW.lanesPerSimd} 个工位。` },
  { label: `${N.simds} 个`, why: `${N.simds} 是流水线的条数。每条流水线上还排着 ${HW.lanesPerSimd} 个工位。` },
  { label: `${N.lanes} 个`, correct: true, why: `${HW.cuCount} × ${HW.simdsPerCu} × ${HW.lanesPerSimd} = ${N.lanes}。` },
  { label: '我不确定', why: '不确定也没关系，下面一层层放大，数一数就知道。' },
]

const pOrder = [
  { label: '启动 → 拷进显存 → 计算 → 拷回', why: '启动的时候显存里还没有 a、b，工位拿不到要算的数。' },
  { label: '拷进显存 → 启动 → 计算 → 拷回', correct: true, why: '数据先到显存，再交出工作单；算完的 c 在显存里，拷回来 CPU 才能用。' },
  { label: '拷进显存 → 启动 → 计算，结果自己回到 CPU', why: '结果写在显存里，不会自己回到 CPU 那边，要拷回来。' },
  { label: '我不确定', why: '不确定也没关系，下面的动画一步一步走给你看。' },
]

// 检查点第 1 题是一张假想的卡：结构和 RX 9070 XT 一样，只是计算单元少一半（不是哪款真实的产品）。
const SMALL = HW.cuCount / 2
const SMALL_LANES = SMALL * HW.simdsPerCu * HW.lanesPerSimd

const checkpoint = [
  {
    q: `假设有一张卡，结构和 RX 9070 XT 完全一样，只是计算单元只有 ${SMALL} 个。它一共有多少个 lane？`,
    options: [
      { label: `${SMALL * HW.simdsPerCu} 个`, why: `这是 SIMD 的条数：${SMALL} × ${HW.simdsPerCu}。每条 SIMD 上还有 ${HW.lanesPerSimd} 个 lane。` },
      { label: `${SMALL_LANES} 个`, correct: true, why: `${SMALL} 个计算单元 × ${HW.simdsPerCu} 条 SIMD × ${HW.lanesPerSimd} 个 lane = ${SMALL_LANES}。` },
      { label: `${N.lanes} 个`, why: `这是 ${HW.cuCount} 个计算单元的卡。计算单元少一半，lane 也少一半。` },
    ],
  },
  {
    q: '一张照片先在 GPU 上调亮，接着还要在 GPU 上调一次对比度。调亮的结果要先拷回 CPU 吗？',
    options: [
      { label: '要，每算完一步都得拷回来', why: '第二步也在 GPU 上，直接读显存里的就行。拷回再拷进去，白搬两次。' },
      { label: '不用，留在显存里给第二步用', correct: true, why: '两步都在 GPU 上，中间结果一直待在显存里。只有最后的照片要拷回 CPU。' },
      { label: '不用，结果会自己回到 CPU', why: '结果写在显存里，不会自己回去。最后那一步的结果照样要拷回来。' },
    ],
  },
  {
    q: 'GPU 刚算完 1 万张照片的平均亮度。程序没写拷回，直接打印 CPU 那边的亮度数组，会看到什么？',
    options: [
      { label: '算好的平均亮度', why: '算好的数还在显存里。CPU 那边的数组没有人动过。' },
      { label: '数组原来的内容：结果还在显存里', correct: true, why: 'CPU 只能读自己内存里的那一份。要看到结果，先把它从显存拷回来。' },
      { label: '程序报错，提示忘了拷回', why: '不会报错：CPU 读的是自己那一份，只是没更新。这类错误很安静，要靠检查结果发现。' },
    ],
  },
]
</script>

# 1-2 走进工坊城

<div class="gp-hello">
  <Mascot class="gp-hello__art" :size="64" />
  <p class="gp-hello__line">上一关的学徒住在哪？跟我进城看看。</p>
</div>

GPU 芯片像一座工坊城：城里有很多车间，车间里有流水线，流水线上排着工位。上一关的 1000 个学徒，就在这些工位上干活。

这一关先把一块 {{ HW.name }} 一层层放大，看城里有什么；再跟着一份活走一趟：从 CPU 交给 GPU，算完再送回来。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

挑战在后面：先认识城里有什么，再替一份活安排旅程。

</Mission>

## 热身：一共有多少个工位？

AMD 的产品页上写着，{{ HW.name }} 有 {{ HW.cuCount }} 个计算单元。计算单元就是城里的车间，每间车间里有几条流水线，每条流水线上排着一个个工位，每个工位一次算一道题。

<Predict :stage="S" id="gp-p-lanes" question="整块芯片上，一共有多少个工位能同时算？" :options="pLanes">

下面一层层放大全景图，数一数：车间有几间，每间几条流水线，每条几个工位。

</Predict>

## 探索一：一层层放大

点一个部件，就放大到它里面；点上面的路径，可以退回去。只用键盘也行：方向键挑部件，回车放大，Esc 缩小一层。

<ChipPanorama />

{{ N.lanes }} 个工位 = {{ HW.cuCount }} 间车间 × 每间 {{ HW.simdsPerCu }} 条流水线 × 每条 {{ HW.lanesPerSimd }} 个工位。AMD 产品页上写的「流处理器 {{ SP }} 个」，数的就是这些工位。

存数据的地方也是一层套一层：寄存器在工位手边，LDS 在 WGP 里（两间车间合用），缓存在芯片上，显存在芯片外面。离工位越近，取得越快，也越小。

## 探索二：一份活的旅程

还是上一关的逐个相加：c[i] = a[i] + b[i]，1000 对数。a、b 在 CPU 的内存里，可 GPU 干活时只从显存里取数据。这份活要怎么交给 GPU？

<Predict :stage="S" id="gp-p-order" question="一份活从 CPU 交给 GPU，四步的顺序是？" :options="pOrder">

播放下面的动画，一步一步看数据在哪里。

</Predict>

<TaskJourney />

写成代码，四步各占一两行。代码有 HIP 风格和 Python 风格两种写法，块顶上随时可以换。

<LangCode>
<template #hip>

```cpp
// ① 拷进显存：CPU → GPU
hipMemcpy(d_a, a, bytes, hipMemcpyHostToDevice);
hipMemcpy(d_b, b, bytes, hipMemcpyHostToDevice);
// ② 启动：把工作单 add 交给 GPU
add<<<blocks, threads>>>(d_a, d_b, d_c, n);
// ③ 计算：GPU 在算，CPU 在这里等它算完
hipDeviceSynchronize();
// ④ 拷回：GPU → CPU
hipMemcpy(c, d_c, bytes, hipMemcpyDeviceToHost);
```

</template>
<template #python>

```python
# ① 拷进显存：CPU → GPU
d_a = to_device(a)
d_b = to_device(b)
# ② 启动：把工作单 add 交给 GPU
add[blocks, threads](d_a, d_b, d_c, n)
# ③ 计算：GPU 在算，CPU 在这里等它算完
synchronize()
# ④ 拷回：GPU → CPU
c = to_host(d_c)
```

</template>
</LangCode>

`d_` 开头的是显存里的那一份，申请显存的几行先省略了。`blocks`、`threads` 是派多少人干活，第 {{ GROUPS.code }} 关再讲。

GPU 只用显存里的数据，算完的结果也留在显存里。所以拷进、拷回一步也不能少；拷回之前，CPU 要等 GPU 算完。

## 原理：城里有什么，活怎么走

<ConceptCard term="cu">

{{ HW.name }} 有 {{ HW.cuCount }} 个计算单元，每 {{ HW.cusPerWgp }} 个合成一个 WGP。每个计算单元里有 {{ HW.simdsPerCu }} 条 SIMD，每条 {{ HW.lanesPerSimd }} 个 lane。

</ConceptCard>

<ConceptCard term="vram">

这张卡的显存是 {{ VRAM }}，在芯片外面。GPU 算的时候从这里取数据，算完把结果写回这里。

</ConceptCard>

<ConceptCard term="host-device">

HIP 风格里，方向写在 `hipMemcpy` 的最后一个参数：`HostToDevice` 是从主机拷到设备，也就是拷进显存；`DeviceToHost` 是拷回来。Python 风格里是 `to_device` 和 `to_host`。

</ConceptCard>

把这一关看到的连起来：算的部件一层套一层，芯片 → WGP → 计算单元 → SIMD → lane。存数据的地方也分几层：寄存器在 lane 手边，LDS 在 WGP 里，缓存在芯片上，显存在芯片外。一份活的旅程是：拷进显存 → 启动 → 计算 → 拷回。

比喻的边界：全景图里的车间排得整整齐齐，真实芯片的版图不是这样，和计算无关的部件也都没画。流水线上的小队、车间里的货架，后面几关一层层展开。

<DeepDive title="启动以后，CPU 会等 GPU 算完吗？">

不会。② 启动只是把工作单交出去，CPU 马上接着往下走。所以代码里写了 ③ 那一行：等 GPU 算完，再拷回结果。

等不等、在哪里等，会影响程序的快慢。第 {{ TIMING.code }} 关测用时的时候，会再仔细看。

</DeepDive>

<DeepDive title="全景图里的数从哪来？">

都来自 AMD 的官方资料：{{ HW.name }} 的产品页、ROCm 文档的 GPU 规格表、RDNA4 指令集手册。全景图下面「这些数从哪来」写着每个数在资料里的位置。

到了铸造城第 {{ YOUR_GPU.code }} 关，你会在自己的卡上读出这些数，填回这张全景图。

</DeepDive>

## 挑战：三排数加起来

工坊城今天的单子：把 a、b、c 三排数逐个加起来，结果叫 out。工作单 add 一次只加两排，所以要启动两次。替每一排数选好怎么搬，再点「出发」。

这是星级挑战：CPU 拿到正确的 out 拿第一颗星，拷贝次数达到目标拿第二颗，拷贝最少拿第三颗，和任务卡上写的一样。

<JourneyPlan />

## 你现在能……

- 说出 GPU 由哪几层组成：芯片、WGP、计算单元、SIMD、lane，以及寄存器、LDS、缓存、显存各在哪一层
- 用产品页上的数，算出一张卡一共有多少个 lane
- 按顺序说出一份活的旅程：拷进显存、启动、计算、拷回，并判断哪些数据不用来回搬

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：工作单发到车间以后，几千个工位怎么知道自己该算哪一道？下一关写你的第一张工作单。

- 回到基础：[旧版第 2 章 2.1.1 CPU 与 GPU 的任务分工](/part0-intro/chapter2/#_2-1-1-cpu-与-gpu-的任务分工)，从准备输入、启动计算到取回结果，讲的是同一段旅程。
- 深入一层：[旧版第 2 章 2.4 线程分组与硬件执行单元](/part0-intro/chapter2/#_2-4-线程分组与硬件执行单元)，看 WGP、计算单元和 SIMD 怎样接住一组组工作。

<EvidenceCard kind="simulated">这一关的硬件参数来自 AMD 官方资料（产品页、ROCm 文档、RDNA4 指令集手册），每个数的出处写在全景图下面，不是实测。全景图的布局和旅程动画都是示意，动画速度不代表真实耗时；挑战里的字节数按每个数 4 字节算出来。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.gp-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.gp-hello__art {
  flex: none;
}

.gp-hello__line {
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
.hg-shell.is-plain .gp-hello__art {
  display: none;
}

.hg-shell.is-plain .gp-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
