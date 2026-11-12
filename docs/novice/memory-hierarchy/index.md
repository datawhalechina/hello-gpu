---
layout: stage
stage: novice-memory-hierarchy
newTerms: [memory-hierarchy, register, lds]
evidence: simulated
description: 小队要算的数住在不同的地方：工具台、车间货架、缓存、城外仓库，还有 CPU 那边。在地图上取一取，看每一趟要等多久，再替求和工作单里的数挑住处。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import FetchTrip from './scenes/FetchTrip.vue'
import PlaceData from './scenes/PlaceData.vue'
import SumSandbox from './scenes/SumSandbox.vue'
import {
  BEST_COST, BUS, FETCH_CYCLES, LDS_SIZE, STAGE_ID, STAR_LABELS, SUM_M, SUM_N, TARGET_COST, VGPRS, VRAM_RATIO, VRAM_SIZE,
} from './challenge.ts'

const S = STAGE_ID
const GOAL = `把 ${SUM_M} 排数对齐加起来：${SUM_N} 个和都算对，取数据的往返代价（模拟）还要最少。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const PANORAMA = stageById('novice-gpu-panorama')
const GROUPS = stageById('novice-thread-groups')
const LDS_SYNC = stageById('novice-lds-sync')

// 每趟等几个周期是模拟器的示意值（params.ts）；能装多少从 hardware.json 读（09 第 4 节），正文不手写。
const C = FETCH_CYCLES

const pTrips = [
  { label: '1 趟：一行代码，去一次', why: '这一行有三个数住在显存：a[i]、b[i] 要取过来，算好的和还要存回 c[i]。' },
  { label: '2 趟：取 a[i]、取 b[i]', why: '还差一趟：算好的和要存回显存里的 c[i]。' },
  { label: '3 趟', correct: true, why: '取 a[i]、取 b[i]，再把和存回 c[i]。i 不用跑：它是线程自己算出来的，就在手边。' },
  { label: '我不确定', why: '不确定也没关系，挑战里模拟器会替你一趟一趟地数。' },
]

const pShare = [
  { label: '各自的工具台（寄存器）：离工位最近', why: '工具台只归自己：0 号线程看不见别人的寄存器。' },
  { label: '车间货架（LDS）', correct: true, why: `同一组线程都拿得到，又在芯片上：一趟 ${C.lds} 个周期（模拟）。` },
  { label: '城外仓库（显存）', why: `能用，大家都拿得到；可一趟要 ${C.vram} 个周期（模拟），货架只要 ${C.lds} 个。` },
  { label: '我不确定', why: '不确定也没关系，下面挪一挪就知道。' },
]

// 检查点第 2 题：一组想放进货架的数，比每个 WGP 的 LDS 大得多。
const BIG = 100_000
const BIG_KB = (BIG * 4) / 1000

const checkpoint = [
  {
    q: 'block 0 算出的一个数，block 1 也要用。这个数放哪？',
    options: [
      { label: 'block 0 的车间货架（LDS）', why: '货架只归这一组：block 1 看不到 block 0 的货架。' },
      { label: '城外仓库（显存）', correct: true, why: '显存所有线程都拿得到。不同的组要交换数据，只能经过它。' },
      { label: 'block 0 里某个线程的工具台（寄存器）', why: '工具台只归一个线程，同一组的别人都看不见，别的组更看不见。' },
    ],
  },
  {
    q: `一组线程想把 ${BIG / 10_000} 万个 float（每个 4 字节）放到车间货架上一起用。放得下吗？`,
    options: [
      { label: '放得下：货架是整组一起用的', why: `${BIG / 10_000} 万个 float 是 ${BIG_KB} KB，每个 WGP 的 LDS 一共才 ${LDS_SIZE}。` },
      { label: '放不下', correct: true, why: `${BIG_KB} KB 比每个 WGP 的 ${LDS_SIZE} 大得多。放不下的数住在显存，用到哪一段，再把那一段取过来。` },
      { label: '放得下：多出来的会自动放进缓存', why: '缓存由硬件自己管，不会替货架装多出来的数。放不下的数要住在显存。' },
    ],
  },
  {
    q: '同一个数，线程从显存取了一趟，过一会儿又取一趟。第二趟为什么可能快一些？',
    options: [
      { label: '工具台（寄存器）自动留了一份', why: '寄存器里放什么由工作单定，硬件不会自己往里放。第二趟还是要出门去取。' },
      { label: '缓存里留了一份', correct: true, why: '从显存取数，路上经过缓存，取过的数缓存会留一份。还留着，就不用跑到显存。' },
      { label: '显存记住了这个线程', why: '显存不记谁取过。快一些，是因为路上的缓存留了一份。' },
    ],
  },
]
</script>

# 1-7 数据住在哪

<div class="mh-hello">
  <Mascot class="mh-hello__art" :size="64" />
  <p class="mh-hello__line">算之前，数得先拿到手边。它们住在哪？</p>
</div>

第 {{ PREV.code }} 关让小队走得整整齐齐。可算得再整齐，也得先把要用的数拿到手边。

数住在不同的地方：有的就在手边，有的在城外的大仓库，有的还在 CPU 那边。住得越远，取一趟等得越久。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

先在地图上取一取：每个地方多远、能装多少、谁拿得到。再替求和工作单里的数挑住处。

</Mission>

## 热身：一行代码，跑几趟仓库？

还是第 {{ GROUPS.code }} 关的工作单，每个线程算一格。a、b、c 都住在显存里，第 {{ PANORAMA.code }} 关把它们拷了进来。

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

<Predict :stage="S" id="mh-p-trips" question="c[i] = a[i] + b[i] 这一行，每个线程要跑几趟显存？" :options="pTrips">

取一个数要跑一趟，存一个数也要跑一趟。一趟要等多久？下面的地图上取一取。

</Predict>

## 探索一：越远，等得越久

地图从上往下，离工位越来越远。点一个地方，看线程去那里取一个数要等几个周期。周期是 GPU 打的拍子，模拟器里小队走一步就是一拍。

<FetchTrip />

越近越快，也越小。工具台随手就拿，可每个线程最多只有 {{ VGPRS }}寄存器。城外仓库能装 {{ VRAM_SIZE }}，取一趟却要等 {{ C.vram }} 个周期（模拟），是工具台的 {{ VRAM_RATIO }} 倍。

CPU 内存最远，工作单根本够不着。数要先拷进显存，走的是 {{ BUS }} 这条路，第 {{ PANORAMA.code }} 关走过一遍。

## 探索二：给数据挑住处

住处不是越近越好。放得下，要用它的线程拿得到，才住得进去。

<Predict :stage="S" id="mh-p-share" question="一组 32 个线程，各算出一个部分和，要交给 0 号线程加起来。这 32 个数放哪最合适？" :options="pShare">

下面替求和工作单里的四个数挑住处，挪一下就告诉你行不行。

</Predict>

<PlaceData />

自己用的放工具台，组里交接的放货架，大家都要读的、CPU 要拿回去的放显存。每个数都挑够得着、放得下的最近一层。

## 原理：存储层级

GPU 存数据的地方分成好几层，叫存储层级：离工位越近，取得越快，也越小。

<ConceptCard term="memory-hierarchy">

地图从上往下就是这几层：寄存器、LDS、缓存、显存。CPU 内存在 GPU 外面，工作单够不着。

</ConceptCard>

<ConceptCard term="register" code="float s = 0;">

工作单里的局部变量，比如挑战里的 s，默认放在寄存器里。每个线程最多 {{ VGPRS }}寄存器；用得太多，放不下的值会被挪到显存，取一趟就慢多了。

</ConceptCard>

<ConceptCard term="lds" code="__shared__ float box[32];">

在货架上开格子：HIP 风格写 `__shared__`，Python 风格写 `box = shared(32)`。每个 WGP 一共 {{ LDS_SIZE }}，同一组线程都能读写。

</ConceptCard>

缓存是硬件自己管的一层，写代码时选不了它。从显存取数，路上要经过缓存；取过的数它会留一份，下回再取，可能就不用跑到显存。

数据进出 GPU，都走这一条路。进来：CPU 内存拷进显存，再取到寄存器里算。出去：算好的存回显存，再拷回 CPU 内存。

LDS 不在这条路上。货架上的数，是工作单自己放上去的；怎样等全组都放好再取，第 {{ LDS_SYNC.code }} 关再讲。

<DeepDive title="出处：几层存储各在哪、谁能用">

- HIP 文档说，寄存器每个线程私有，是访问最快的一层；局部变量默认放在寄存器里，放不下的会溢出到显存，延迟高得多。LDS 是同一组线程共享的片上存储，延迟低。显存谁都能读写，容量大，延迟高；主机和设备之间的数据用 `hipMemcpy` 这类函数搬（[HIP 编程模型：Memory hierarchy](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#memory-hierarchy)）。
- RDNA4 指令集手册：kernel 把片外显存里的数取进片上的寄存器和缓存（1.2 节）；每个 WGP 有 {{ LDS_SIZE }} 的 LDS，给同一组线程低延迟地交换数据（1.2.2.1 节）；从显存读数要经过 L2、L1、L0 几层缓存（1.2.3 节）；每个线程最多 {{ VGPRS }}向量寄存器（3.3.2.1 节）；走 LDS 取数，延迟可以比走显存低得多（第 12 章）。手册在 [GPUOpen](https://gpuopen.com/download/rdna4-instruction-set-architecture.pdf)。
- AMD GPUOpen：没有命中缓存的显存访问，可能要等几百个周期（[Occupancy explained](https://gpuopen.com/learn/occupancy-explained/)）。
- HIP 性能指南：先少做主机和设备之间的拷贝，这条路带宽低；再多用片上的 LDS 和缓存，少读写显存（[Memory throughput optimization](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/performance_guidelines.html#memory-throughput-optimization)）。
- 地图上能装多少，来自 AMD 的产品页、ROCm 规格表和上面的指令集手册。第 {{ PANORAMA.code }} 关全景图下面的「这些数从哪来」，列着每一项在资料里的位置。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 每趟等几个周期是示意值：工具台 {{ C.register }}、货架 {{ C.lds }}、缓存 {{ C.cache }}、仓库 {{ C.vram }}，只排出远近，不是哪块卡的实测。RX 9070 XT 各层的真实延迟[待实测]。
- 真卡上的缓存分好几层：指令集手册里有 L0、L1、L2 三层（L 后面的数越大，离工位越远），产品页上还有 Infinity Cache。地图把它们画成了一层。
- 模拟器把趟数一趟一趟地加。真卡上，互不相干的几趟可以一起在路上，等的时间会叠在一起：每个 wave 记着还没回来的访存，要用结果时才停下来等（指令集手册 5.7 节）。
- 挑战里不模拟缓存，每一趟都按仓库算。模拟器照着代码一行一行地跑：写了 out[t]，就真去一趟仓库。真实的编译器会自己安排寄存器，趟数不一定和代码一一对应。
- 模拟器里，货架一开始是 0。真卡上货架不会自动清零，读到的是之前留下的数。
- HIP 也有让 GPU 直接用 CPU 那边数据的写法，比如托管内存（managed memory）：用到时再自动搬过去（[HIP 性能指南](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/performance_guidelines.html#minimizing-memory-thrashing)）。这一关不讲。

</DeepDive>

比喻的边界：地图从上往下排的是远近，不是一条必经的路。从仓库取数，路上经过的是缓存，不会经过货架。

## 挑战：和加在哪

第 {{ PANORAMA.code }} 关把三排数加起来，启动了两次。这次一张工作单就够：a 里有 {{ SUM_M }} 排数，第 t 个线程把每排的第 t 个数加起来，存进 out[t]。

和要在循环里一个一个加。工作单里备好了三个地方：工具台上的 s、货架上的 box、仓库里的 out。你来定：循环里加在哪，最后把哪里的和存进 out[t]。

这是星级挑战：{{ SUM_N }} 个和都算对，拿第一颗星；往返代价（模拟）降到 {{ TARGET_COST }} 个周期以内，拿第二颗；降到最少的 {{ BEST_COST }} 个周期，拿第三颗。没过不扣分，没过两次以后会出现提示。

<SumSandbox />

## 你现在能……

- 按离工位从近到远，说出寄存器、LDS、缓存、显存，以及谁拿得到它们
- 说出数据怎样进出 GPU：拷进显存，取到寄存器里算，存回显存，再拷回 CPU
- 替数据挑住处：自己用的放寄存器，组里交接的放 LDS，大家都要的放显存

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：从城外仓库搬数，一趟搬的是一整车。小队要的数挨在一起，一车就拉回来；跳着要，就得多跑几车。

- 回到基础：[旧版第 3 章 3.1 数据位置与读写过程](/part0-intro/chapter3/#_3-1-数据位置与读写过程)，跟着一次加法，看数据怎样从数组取到临时值，算完再写回去。
- 深入一层：[旧版第 3 章补充：寄存器与存储使用范围](/part0-intro/chapter3/experiments#寄存器与存储使用范围)，寄存器还分「每个 lane 一份」和「整支小队共用一份」两种，各层归谁用，寄存器放不下时怎样溢出。

<EvidenceCard kind="simulated">这一关的周期数来自浏览器里的模拟器：每趟等几个周期是示意值（工具台 {{ C.register }}、货架 {{ C.lds }}、缓存 {{ C.cache }}、仓库 {{ C.vram }}），只用来比远近；挑战里的趟数是模拟器照着工作单数出来的，都不是实测。能装多少来自 AMD 的官方资料（产品页、ROCm 规格表、RDNA4 指令集手册）。各层在 RX 9070 XT 上的真实延迟[待实测]。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-6 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.mh-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.mh-hello__art {
  flex: none;
}

.mh-hello__line {
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
.hg-shell.is-plain .mh-hello__art {
  display: none;
}

.hg-shell.is-plain .mh-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
