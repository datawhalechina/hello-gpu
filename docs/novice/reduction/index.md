---
layout: stage
stage: novice-reduction
newTerms: [reduction, atomic]
evidence: simulated
description: 一组线程各有一个部分和，要合成一个数。累加只能一步接一步吗？两两相加，一轮少一半；搬上车间货架，每一轮之后等齐；几组的和再用原子加合起来。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import AtomicLab from './scenes/AtomicLab.vue'
import SumSandbox from './scenes/SumSandbox.vue'
import SumTree from './scenes/SumTree.vue'
import TreeLab from './scenes/TreeLab.vue'
import {
  ADD_LAUNCH, LAB_LAUNCH, SHELF, STAGE_ID, STAR_LABELS, SUM_LAUNCH, SUM_N, TREE_THREADS, TREE_VALUES, VARIANT_LAUNCH, roundsNeeded,
} from './challenge.ts'

const S = STAGE_ID
const GOAL = `派 ${SUM_LAUNCH.grid} 组线程，把 ${SUM_N} 个数加进 out[0]：结果要对，out[0] 前的队要短。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const FIRST = stageById('novice-thousand-additions')
const COALESCING = stageById('novice-coalescing')

// 热身和探索一：8 个部分和、4 个线程，最少几轮（每轮少一半）。
const N = TREE_VALUES.length
const BEST = roundsNeeded(N)
const LAB_ROUNDS = roundsNeeded(LAB_LAUNCH.block)
const ADD_N = ADD_LAUNCH.grid * ADD_LAUNCH.block

const Q_ROUNDS = `${N} 个部分和交给 ${TREE_THREADS} 个线程一起加，最少几轮能合成一个数？`
const pRounds = [
  { label: `${N - 1} 轮`, why: '那是一个人从头加到尾：每一次都等上一次。可 3 + 1 和 7 + 0 互不相干，用不着等。' },
  { label: `${TREE_THREADS} 轮`, why: `${TREE_THREADS} 个线程一轮能做 ${TREE_THREADS} 次加法，第 1 轮就把 ${N} 个数合成 ${N / 2} 个，往后每轮再少一半。` },
  { label: `${BEST} 轮`, correct: true, why: `第 1 轮 ${N / 2} 对同时加，剩 ${N / 2} 个；第 2 轮剩 ${N / 4} 个；第 3 轮剩 1 个。` },
  { label: '1 轮', why: `一次加法只能合两个数。第 1 轮做完，还剩 ${N / 2} 个数没合。` },
  { label: '我不确定', why: '不确定也没关系，下面自己搭一棵试试。' },
]

const checkpoint = [
  {
    q: `求 ${SHELF} 个数里最大的那个。能像求和一样搭树：两两比，留下大的，一轮少一半吗？`,
    options: [
      { label: `能：${SHELF} 个数，${roundsNeeded(SHELF)} 轮比完`, correct: true, why: '两两比、留下大的，和两两相加一样：哪两个先比都行，最后留下的都是最大的那个。求最大值也是归约。' },
      { label: '不能：最大值只能从头一个一个比', why: '从头比只是一种比法。两两比也能找出最大的，而且同一轮里的比较互不相干，能同时做。' },
      { label: `能，可要 ${SHELF / 2} 轮：一轮只比一对`, why: `一轮里能同时比 ${SHELF / 2} 对，之后每轮少一半，${roundsNeeded(SHELF)} 轮就剩一个。` },
    ],
  },
  {
    q: '数负数：每个线程查自己的 a[i]，是负数就 count[0] += 1，用的是普通加。count[0] 最后会怎样？',
    options: [
      { label: '正好是负数的个数', why: 'count[0] += 1 也是读出来、加 1、写回去。好几个线程同时读到同一个旧值，各加 1 写回去，就少算了。' },
      { label: '可能比负数的个数少', correct: true, why: '同时读到同一个旧值的线程，写回去时互相盖掉。改成原子加，或者先在组里数好，每组只加一次。' },
      { label: '程序报错，停在那一行', why: '不会报错，这才难发现：结果只是少了，每次少的还可能不一样。' },
    ],
  },
  {
    q: '不想再启动一次：让 block 0 的线程 0 写一行同步，等别的组都把和写进 part，再把 part 加起来。行吗？',
    options: [
      { label: '行：同步就是用来等人的', why: '同步只等得齐同一组的线程。别的组也许还没开始，也许早就做完了，block 0 等不到它们。' },
      { label: '不行：同步只管同一组，组和组之间等不齐', correct: true, why: '要等所有组都写完，只能等这次 kernel 做完、再启动一次；或者每组直接用原子加，把和加进 out[0]。' },
      { label: '行，只要几组都落在同一个 WGP 里', why: `落在同一个 WGP，也是各开各的货架格子、各等各的同步（第 ${PREV.code} 关）。` },
    ],
  },
]
</script>

# 1-10 大家一起求和

<div class="rd-hello">
  <Mascot class="rd-hello__art" :size="64" />
  <p class="rd-hello__line">一组线程各有一个部分和。合成一个数，只能一个一个加吗？</p>
</div>

第 {{ COALESCING.code }} 关，每个线程先把几个数加成一个部分和，存进 part。这一关把这些部分和合成一个数。

第 {{ FIRST.code }} 关说过，累加的每一步都要用上一步的和，只能一个人从头加到尾。这一关换一种加法，让大家一起加。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

先自己搭一棵求和树，数数几轮能加完；再把树搬上车间货架，最后把几组的和合成一个。

</Mission>

## 热身：最少几轮？

先定规则（模拟）：一次加法把两个数合成一个。同一轮里，互不相干的加法可以同时做，每个线程最多做一次；要用这一轮加出来的数，得等下一轮。

{{ N }} 个部分和，一个人从头加到尾要加 {{ N - 1 }} 次，一次接一次，就是 {{ N - 1 }} 轮。换成 {{ TREE_THREADS }} 个线程一起加呢？

<Predict :stage="S" id="rd-p-rounds" :question="Q_ROUNDS" :options="pRounds">

下面自己搭一棵：先点一个数，再点另一个，两个数加成一个。看看几轮能加完。

</Predict>

## 探索一：搭一棵求和树

<SumTree />

一个人从头加到尾，每一轮只有 1 次加法，另外 {{ TREE_THREADS - 1 }} 个线程干等。两两相加就不一样：3 + 1 和 7 + 0 互不相干，可以同时做。

每一轮都把手上的数两两配好，一轮少一半：{{ N }} → {{ N / 2 }} → {{ N / 4 }} → 1，{{ BEST }} 轮。加法还是 {{ N - 1 }} 次，只是排成了一棵树。

结果互相依赖，也能并行：把互不相干的加法放进同一轮，下一轮再用这一轮的结果。轮里面不用等，轮与轮之间要等。

## 探索二：树搬上货架

在 GPU 上，这棵树搭在车间货架（LDS）上。每个线程先把一个数放上货架，再一轮一轮两两相加。

第 1 轮隔 1 格配对：线程 0 把第 1 格加到第 0 格，线程 2 把第 3 格加到第 2 格……下一轮隔的格数翻倍，干活的线程少一半。{{ LAB_LAUNCH.block }} 个数，{{ LAB_ROUNDS }} 轮。

<TreeLab />

每一轮之后同步：整组都加完这一轮，才走下一轮。删掉同步，小队 0 一口气走完 {{ LAB_ROUNDS }} 轮，最后一轮要的第 {{ LAB_LAUNCH.block / 2 }} 格，小队 1 一轮都还没加。

模拟器总让小队 0 先走，真卡上谁先谁后说不准。可只要下一轮要用别的线程这一轮的和，就得等。

## 探索三：大家往同一格加

一组的和在第 0 格。派了好几组，每组一个和，怎么合成一个？先看最直接的写法：每个线程都往 out[0] 上加。

<AtomicLab />

普通加 `out[0] += a[i]` 要做三件事：读出 out[0]、加上 a[i]、写回去。同一支小队的线程同时读到同一个旧值，写回去时互相盖掉。

换成原子加，{{ ADD_N }} 个数一个都不丢。可大家都往同一格加，只能一个一个来，排成一条长队。

## 原理：归约和原子操作

<ConceptCard term="reduction">

探索一的树就是一次归约：{{ N }} 个数，加 {{ N - 1 }} 次，{{ BEST }} 轮合成一个。

</ConceptCard>

能这样拆，是因为加法换个顺序、换个组合，和不变。同一轮里的加法互不相干，能同时做；每轮少一半，{{ LAB_LAUNCH.block }} 个数 {{ LAB_ROUNDS }} 轮，1024 个数也只要 {{ roundsNeeded(1024) }} 轮。

<ConceptCard term="atomic" code="atomicAdd(&amp;out[0], v)">

探索三的原子加：读出来、加上、写回去，三件事一口气做完，中间别人插不进来。好几个线程加同一格，就一个一个排队。

</ConceptCard>

树为什么搭在货架上？一组的线程都看得见这一组的货架，同步能让整组等齐（第 {{ PREV.code }} 关）。可货架只归这一组，同步也只管这一组。

组和组之间要合起来，有两个办法：

- 原子加：每组先在货架上加好，只派线程 0 把这一组的和原子加进 out[0]。几组就排几次队。
- 再启动一次：每组把和写进自己的格子 part[b]。这次 kernel 全部做完，再启动一次，让一组线程把 part 加起来。

<LangCode>
<template #hip>

```cpp
// 第一次启动：每组把这一组的和写进自己的格子
if (t == 0) part[blockIdx.x] = box[0];
// 全部做完，再启动一次：1 组线程把 part 加起来
sum_part<<<1, 64>>>(d_part, d_out);
```

</template>
<template #python>

```python
# 第一次启动：每组把这一组的和写进自己的格子
if t == 0:
    part[blockIdx.x] = box[0]
# 全部做完，再启动一次：1 组线程把 part 加起来
sum_part[1, 64](d_part, d_out)
```

</template>
</LangCode>

再启动一次靠得住，是因为同一条队列里的 kernel 按顺序跑：第二次的 kernel 开工时，第一次的所有组都写完了。

<DeepDive title="出处：求和树、原子操作和再启动一次">

- HIP 文档的 Reduction 教程：每个线程先把一个数放进共享内存，同步，再一轮一轮两两合并，每一轮之后同步。它的第一种写法正是 `tid % (2 * i) == 0` 的线程把隔 i 格的数加过来，i 每轮翻倍；各块的结果写进各自的位置，再启动同一个 kernel 接着合，直到剩一个数（[Naive shared reduction](https://rocm.docs.amd.com/projects/HIP/en/latest/tutorial/reduction.html#naive-shared-reduction)）。同一页还说，让整个 GPU 上的线程一起同步代价很高，能不同步就让各块各自往前走（[Reduction on GPUs](https://rocm.docs.amd.com/projects/HIP/en/latest/tutorial/reduction.html#reduction-on-gpus)）。
- HIP 文档：原子函数是「读出、修改、写回」一次做完的操作；好几个线程对同一个位置做原子操作时，按不确定的先后一个一个来（[Atomic functions](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html#atomic-functions)）。
- HIP 文档：stream 是一条按顺序执行的命令队列（[Streams and concurrent execution](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_runtime_api/asynchronous.html#streams-and-concurrent-execution)）。同一条队列里，第二次启动的 kernel 等第一次的做完才开工。
- 旧版第 9 章用同样的 {{ N }} 个数画过求和树，也在 RX 9070 XT 上比过「各块原子加」和「写进 partial 再启动一次」两种合并办法（见下面的「深入一层」）。那些数还没收进实验档案馆，这一关不引用。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 一组里的小队按编号轮流走：走到同步或者走完，才换下一支。所以删掉同步时，每次都是小队 0 先走、取早。真卡上几支小队交错着走。
- 组一个接一个跑。所以线程 0 用普通加把组和加进 out[0]，模拟器里两组的和都加上了，只记下一处数据竞争；真卡上几组同时跑，可能丢掉一组的和。
- 一支小队同一步往同一格写，模拟器留下最后一个线程的；真卡上留下哪一个说不准。
- 「排几次队」只数原子加的次数，不算时间：排一次队要等多久，这一关没有模拟。
- 模拟器按双精度算，这一关的数又都是整数，换个顺序加，和一点不差。真卡上用 float，换个顺序加，最后几位可能不一样。

</DeepDive>

比喻的边界：两两交接、记账本前排队，都只说明谁先谁后。真卡上没有人手递手：数放在货架或者显存的格子里，线程按编号去取；先后也没人安排，靠同步和原子操作来保证。

## 挑战：两组一起求和

现在派 {{ SUM_LAUNCH.grid }} 组，每组 {{ SUM_LAUNCH.block }} 个线程，把 {{ SUM_N }} 个数加进 out[0]。工作单先照探索三的办法：搭树的循环写好了，可终点写的是 1，一轮都不搭；每个线程把自己那一格原子加进 out[0]。

三个虚线框由你来改：循环搭到哪为止，每一轮之后等不等，最后那一行谁把什么加进 out[0]。

这是星级挑战：out[0] 对、没有数据竞争，拿第一颗星；out[0] 前只排 {{ SUM_LAUNCH.grid }} 次队，拿第二颗；换成 {{ VARIANT_LAUNCH.grid }} 组、每组 {{ VARIANT_LAUNCH.block }} 个线程，同一份代码照样成立，拿第三颗。没过不扣分，没过两次以后会出现提示。

<SumSandbox />

## 你现在能……

- 把求和拆成一轮一轮：同一轮里的加法互不相干，同时做；每轮少一半
- 在车间货架（LDS）上搭求和树：每一轮之后同步，下一轮才能用这一轮的和
- 把几组的和合起来：先在组里加好，再派一个线程原子加；或者写进各自的格子，再启动一次

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：轮数少了、队排短了，真的变快了吗？下一关学怎么计时，什么样的测量才可信。

- 回到基础：[旧版第 9 章 9.2 串行求和与并行求和树](/part2-kernels/chapter9/#reduction-tree)，同样的 {{ N }} 个数，一张表列出每一轮加了什么、留下什么。
- 深入一层：[旧版第 9 章 9.4.1 HIP 基线：每个 block 提交一个和](/part2-kernels/chapter9/#ch9-hip)，在 RX 9070 XT 上比「各块原子加」和「写进 partial 再启动一次」，看哪一种更快。

<EvidenceCard kind="simulated">这一关的结果来自浏览器里的模拟器和一条规则：求和树的轮数，按「新加出来的数放在它的两个数里晚的那一轮 + 1」数出来；货架上每一格的数、out[0] 对不对、几处数据竞争、out[0] 前排了几次队，都是模拟器照着工作单跑出来的，不计时，也不是实测。删掉同步时总是小队 0 先走、组一个接一个跑，是模拟器为了每次都看到同样的错定的规则；真卡上先后不确定。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-9 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.rd-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.rd-hello__art {
  flex: none;
}

.rd-hello__line {
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
.hg-shell.is-plain .rd-hello__art {
  display: none;
}

.hg-shell.is-plain .rd-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
