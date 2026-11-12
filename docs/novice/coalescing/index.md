---
layout: stage
stage: novice-coalescing
newTerms: [cache-line, coalescing, stride]
evidence: simulated
description: 仓库发货按车算：一车装 32 个挨着的数。小队要的数挨在一起，一车就搬回来；隔着要，同样的数得搬好几车。调一调步长、换一换分法，再在求和工作单里让小队排好队一起取。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import AgentSide from './scenes/AgentSide.vue'
import CarLab from './scenes/CarLab.vue'
import PartSandbox from './scenes/PartSandbox.vue'
import {
  BEST_CARS, DEFAULT_STRIDE, LAB_N, LINE_BYTES, PART_M, PART_N, PER_LINE, SPLIT_M, STAGE_ID, STAR_LABELS,
  VARIANT_LAUNCH, VARIANT_M, WAVE, labCars,
} from './challenge.ts'

const S = STAGE_ID
const GOAL = `把 ${PART_N} 个数分给 ${WAVE} 个线程，每人先加 ${PART_M} 个：每个数只加一次，小队搬的车（模拟）还要最少。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const WAVEFRONT = stageById('novice-wavefront')
const REDUCTION = stageById('novice-reduction')

// 热身：小队隔 4 个要一个。最后一个线程要的数、散在几车、每车用上几个，都从常数算。
const LAST = (WAVE - 1) * DEFAULT_STRIDE
const CARS = Math.floor(LAST / PER_LINE) + 1
const USED = WAVE / CARS
// 探索二：甲每一轮散在几车。
const SPLIT_CARS = (WAVE * SPLIT_M) / PER_LINE
const SPLIT_Q = `${LAB_N} 道加法，每人 ${SPLIT_M} 道。哪种分法，小队搬的车少？`

const pCars = [
  { label: `1 车：${WAVE} 个数，一车正好装下`, why: `一车装的是挨着的 ${PER_LINE} 个：a[0]～a[${PER_LINE - 1}]。隔 ${DEFAULT_STRIDE} 个要一个，${WAVE - 1} 号要的 a[${LAST}] 已经在第 ${CARS - 1} 车。` },
  { label: `${CARS} 车`, correct: true, why: `要的数从 a[0] 到 a[${LAST}]，散在第 0～${CARS - 1} 车里。每车只用上 ${USED} 个，剩下的跟着白搬。` },
  { label: `${WAVE} 车：一人一车`, why: `同一车里要的数，一趟一起搬回来：0 号到 ${USED - 1} 号要的数都在第 0 车，搬一车就够。` },
  { label: '我不确定', why: '不确定也没关系，下面调一调步长就看到了。' },
]

const pSplit = [
  { label: '甲：每人连着做，拿的数挨在一起', why: `一个线程自己是挨着的，可小队是一起取数的：第 0 轮，0 号要第 0 个，1 号要第 ${SPLIT_M} 个……隔 ${SPLIT_M} 个，散在 ${SPLIT_CARS} 车里。` },
  { label: '乙：每人隔着做', correct: true, why: `乙的每一轮，小队要的 ${WAVE} 个数挨在一起：第 0 轮是第 0～${WAVE - 1} 个，正好装满 1 车。` },
  { label: `一样多：都是 ${LAB_N} 道`, why: '道数一样，车不一样多：要看同一轮里，相邻线程要的数挨不挨着。' },
  { label: '我不确定', why: '不确定也没关系，下面切换甲、乙看一看。' },
]

// 检查点第 1 题：挨着读，可起点不在车头；第 3 题：一个线程连着读 8 个。
const OFFSET = 5
const EACH = 8

const checkpoint = [
  {
    q: `小队 ${WAVE} 个线程挨着读，可第 t 个线程读的是 a[t + ${OFFSET}]。要搬几车？`,
    options: [
      { label: `1 车：${WAVE} 个数挨在一起`, why: `挨着，可没从车头开始：a[${OFFSET}]～a[${PER_LINE - 1}] 在第 0 车，a[${PER_LINE}]～a[${WAVE - 1 + OFFSET}] 在第 1 车。` },
      { label: '2 车', correct: true, why: `${WAVE} 个数跨了两车：第 0 车用上 ${PER_LINE - OFFSET} 个，第 1 车用上 ${OFFSET} 个。挨着读，最好还从一车的开头读起。` },
      { label: `${OFFSET + 1} 车：多出来的 ${OFFSET} 个，一个一车`, why: `多出来的 a[${PER_LINE}]～a[${WAVE - 1 + OFFSET}] 挨在一起，都在第 1 车，搬一车就够。` },
    ],
  },
  {
    q: `小队 ${WAVE} 个线程都要读 a[0]，比如大家都要乘同一个系数。要搬几车？`,
    options: [
      { label: `${WAVE} 车：一人一车`, why: `${WAVE} 个线程要的是同一个数，它在第 0 车。搬一车回来，大家一起用。` },
      { label: '1 车', correct: true, why: `a[0] 在第 0 车：搬一车，${WAVE} 个线程都拿到了。这一车只用上一个数，可也只搬了 1 车。` },
      { label: '不用搬：大家要的一样，硬件记得住', why: `硬件不会凭空知道 a[0] 是多少，至少要搬一车回来；搬回来以后，${WAVE} 个线程一起用。` },
    ],
  },
  {
    q: `第 t 个线程连着算 ${EACH} 个数，第 k 轮读 a[t * ${EACH} + k]。每个线程自己读的数都挨着，小队每一轮要搬几车？`,
    options: [
      { label: '1 车：每个线程读的数都挨着', why: `要看同一轮里相邻线程隔几个：0 号读 a[k]，1 号读 a[${EACH} + k]，隔 ${EACH} 个。一个线程自己挨着读，帮不上小队。` },
      { label: `${(WAVE * EACH) / PER_LINE} 车`, correct: true, why: `同一轮里相邻线程隔 ${EACH} 个数，${WAVE} 个数从 a[k] 一直到 a[${(WAVE - 1) * EACH} + k]，散在 ${(WAVE * EACH) / PER_LINE} 车里，每车只用上 ${PER_LINE / EACH} 个。` },
      { label: `${WAVE} 车：一人一车`, why: `隔 ${EACH} 个，一车里还有 ${PER_LINE / EACH} 个要的数，不用一人一车。隔 ${PER_LINE} 个以上，才是一人一车。` },
    ],
  },
]
</script>

# 1-8 排好队一起取

<div class="co-hello">
  <Mascot class="co-hello__art" :size="64" />
  <p class="co-hello__line">仓库发货按车算。怎样让一车装满？</p>
</div>

第 {{ PREV.code }} 关数过趟数：小队每读一次显存，就跑一趟城外仓库。这一关看看，每一趟搬回来多少。

仓库不按个发货，按车：一车装 {{ LINE_BYTES }} 字节，正好 {{ PER_LINE }} 个挨着的 float（模拟）。哪怕只要其中一个，也得搬整整一车。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

先调步长，看小队一次要搬几车；再给「每人做好几道」换个分法。最后在求和工作单里，自己写出排好队的拿法。

</Mission>

## 热身：隔着要，搬几车？

a 在仓库里从一车的开头放起：a[0]～a[{{ PER_LINE - 1 }}] 是第 0 车，a[{{ PER_LINE }}]～a[{{ 2 * PER_LINE - 1 }}] 是第 1 车，依此类推。

第 {{ WAVEFRONT.code }} 关说过，小队 {{ WAVE }} 个线程同一步做同一件事，读 a 也是一起读。这一次，0 号要 a[0]，1 号要 a[{{ DEFAULT_STRIDE }}]，2 号要 a[{{ 2 * DEFAULT_STRIDE }}]……每人隔 {{ DEFAULT_STRIDE }} 个要一个。

<Predict :stage="S" id="co-p-cars" question="这一下，小队要从仓库搬几车？" :options="pCars">

同一车里要的数，一趟一起搬回来，不管几个线程要。下面把这个「隔几个」做成旋钮，调一调，看车数怎么变。

</Predict>

## 探索一：隔得越远，搬的车越多

工作单还是向量加法：每个线程连着算 stride 道，所以同一步里，相邻两个线程隔 stride 个数。

<CarLab variant="stride" />

步长 1 时，相邻线程拿相邻的数，{{ WAVE }} 个数装满 1 车。步长 {{ DEFAULT_STRIDE }} 时，同样 {{ WAVE }} 个数散在 {{ CARS }} 车里，每车只用上 {{ USED }} 个。

活一样多：步长 {{ DEFAULT_STRIDE }} 搬了 {{ labCars(DEFAULT_STRIDE) }} 车，步长 1 只要 {{ labCars(1) }} 车（模拟）。

## 探索二：每人做好几道，换个分法

数常常比线程多，比如第 {{ PREV.code }} 关求和工作单里的 100 万个数。线程不够分时，每个线程就得做好几道。

{{ LAB_N }} 道加法交给 {{ WAVE }} 个线程，每人 {{ SPLIT_M }} 道，有两种分法：

- 甲：每人连着做一段。0 号做第 0～{{ SPLIT_M - 1 }} 道，1 号做第 {{ SPLIT_M }}～{{ 2 * SPLIT_M - 1 }} 道……
- 乙：每人隔着做。0 号做第 0、{{ WAVE }}、{{ 2 * WAVE }}、{{ 3 * WAVE }} 道，1 号做第 1、{{ WAVE + 1 }}、{{ 2 * WAVE + 1 }}、{{ 3 * WAVE + 1 }} 道……

<Predict :stage="S" id="co-p-split" :question="SPLIT_Q" :options="pSplit">

分法不改每人做几道，只改同一轮里谁拿哪个数。下面切换甲、乙看看。

</Predict>

<CarLab variant="split" />

乙的每一轮，小队都拿挨着的 {{ WAVE }} 个数：第 0 轮拿第 0～{{ WAVE - 1 }} 个，第 1 轮拿第 {{ WAVE }}～{{ 2 * WAVE - 1 }} 个。每人还是做 {{ SPLIT_M }} 道，一车都不多搬。

甲对一个线程来说是连着的，可小队是一起取数的。要看的是同一轮里相邻线程隔几个，不是一个线程前后拿得挨不挨着。

## 原理：cache line 和合并访存

显存是成块搬的：小队一次读写，碰到几车就搬几车。相邻线程读相邻地址，车就装得满。

<ConceptCard term="cache-line">

模拟器里一车 {{ LINE_BYTES }} 字节，装 {{ PER_LINE }} 个 float。数组从一车的开头放起：a[0]～a[{{ PER_LINE - 1 }}] 在第 0 车。

</ConceptCard>

<ConceptCard term="coalescing">

小队同一步读 a，{{ WAVE }} 个线程各报一个地址。硬件把这些地址并起来，按车去搬：碰到几车，就搬几车。

</ConceptCard>

<ConceptCard term="stride" code="stride">

同一步里，相邻两个线程要的数隔几个，就是访问步长。步长 1 最省：{{ WAVE }} 个数正好一车。

</ConceptCard>

所以相邻线程要读相邻地址：小队是一起读的，地址挨着，一车就搬完；隔得越远，同样的数要搬越多车，车里白搬的也越多。

<DeepDive title="出处：合并访存">

- HIP 文档《Understanding GPU performance》：合并访存把多个线程的访问并成更少的搬运；相邻线程访问相邻地址时，硬件能把请求并成整块的 cache line 访问。它说的是读写显存。地址散开时（步长大，或者乱跳），一个 wave 的一次读写要拆成更多次搬运，有效带宽下降。同一节有个跨步读的例子：步长越大，相邻线程的地址隔得越远，每次读写要的搬运越多（[Memory coalescing theory](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/performance_optimization.html#memory-coalescing-theory)）。
- HIP 性能指南：内存硬件按对齐的整块搬数据，通常是 128 字节；一个 warp 里相邻线程访问相邻地址，硬件把它们并成一次宽的搬运。它举的反例是跨步访问：步长大于 1，访问就不能完全合并（[Device memory access](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/performance_guidelines.html#device-memory-access)）。warp 是 CUDA 的叫法，在 AMD GPU 上就是 wavefront。
- 资料里常把这样一次成块的搬运叫一次「事务」（transaction）。模拟器里，一车就算一次事务。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 一车 {{ LINE_BYTES }} 字节是示意值：第一代 RDNA 的 RX 5700 XT，L0、L1、L2 缓存每行都是 128 字节（[AMD GPUOpen《RDNA Architecture》](https://gpuopen.com/download/RDNA_Architecture_public.pdf) 的「Caches – Some numbers」一页）；RX 9070 XT 上一车多大没有查到公开的数，[待实测]。
- 模拟器每次读写单独数车，不模拟缓存：上一轮搬来的车，不会留给下一轮用。真卡上，刚搬来的车可能还在缓存里（第 {{ PREV.code }} 关讲过），甲下一轮要的数也许就在那里。可小队一次要的数散在几车里，就要分几车处理；HIP 文档说，这样有效带宽照样会下降。
- 模拟器只数车，不算时间：几车能不能一起在路上、一车要等多久，这一关都没算。
- 数组都从一车的开头放起。起点不在车头时，挨着读也可能多搬一车，检查点里有一道。

</DeepDive>

比喻的边界：车只说明「成块搬」。真卡上一车多大、几车能不能一起在路上、搬来的车会不会留在缓存里，比喻里都没有。

## 挑战：每人先加一段

求和要先分段：每个线程先把几个数加成一个部分和，存进 part。第 {{ REDUCTION.code }} 关再把 part 合起来。

哪个数给哪个线程都行，只要每个数正好加一次。工作单里，第 k 轮、第 t 个线程拿第 i 个数，i 由你来写；T 是一共几个线程。

这是星级挑战：{{ PART_N }} 个数都加进去、每个只加一次，拿第一颗星；车次降到最少的 {{ BEST_CARS }} 车（模拟），拿第二颗；换成 {{ VARIANT_LAUNCH.grid }} 组、每人加 {{ VARIANT_M }} 个，同一行照样成立，拿第三颗。没过不扣分，没过两次以后会出现提示。

<PartSandbox />

## 支线：如果让 Agent 来做

Agent 看不到上面的车厢图。它只会调用工具：运行一次、计时、看访存，再读工具给回来的数，决定下一步。

下面的规则 Agent 调的是 1000 道向量加法的两个参数：每组线程数 block 和访问步长 stride。它从每组 {{ WAVE }} 个、步长 {{ DEFAULT_STRIDE }} 出发：看访存时读到多搬了，就把步长改成 1。

<AgentSide />

## 你现在能……

- 说出显存怎样搬数：按车（cache line）成块搬，只要一个数也搬一整车
- 看同一步里相邻线程隔几个数（访问步长），数出小队一次读写要搬几车
- 每个线程要做好几个数时隔着分：第 k 轮拿第 k × T + t 个，让小队一直挨着拿

## 检查点

下面的车数都按一车 {{ PER_LINE }} 个数算（模拟），数组也都从一车的开头放起。

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：数搬进车间，组里的线程还想互相借着用。放上车间货架就行，可得等大家都放好了再取。

- 回到基础：[旧版第 3 章 3.2 Wavefront 的访存组织](/part0-intro/chapter3/#_3-2-wavefront-的访存组织)，四个 lane 读相邻的下标、隔 5 个的下标，对照要涉及几块数据。
- 深入一层：[旧版第 8 章 8.4.2 地址对照](/part2-kernels/chapter8/#_8-4-2-地址对照-只改变同轮访问顺序)，在 RX 9070 XT 上只换同一轮的地址排列，量两种写法各用多久。

<EvidenceCard kind="simulated">这一关的车次来自浏览器里的模拟器：一车 {{ LINE_BYTES }} 字节、一个 float 4 字节都是示意值，车次是模拟器照着工作单一次一次数出来的，不计时，也不是实测。RX 9070 XT 上一车多大[待实测]。同一轮相邻、跨步两种排法在真卡上各用多久，旧版第 8 章 8.4.2 量过，还没收进实验档案馆。支线里的周期数是模拟器估的示意时间，也不是实测。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-7 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.co-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.co-hello__art {
  flex: none;
}

.co-hello__line {
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
.hg-shell.is-plain .co-hello__art {
  display: none;
}

.hg-shell.is-plain .co-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
