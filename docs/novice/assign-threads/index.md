---
layout: stage
stage: novice-assign-threads
newTerms: [kernel, thread]
evidence: simulated
description: 写你的第一张工作单：同一份 kernel 交给一群线程，每个线程用自己的编号 threadIdx.x 认领一格。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import { useChallenge } from '@course/useChallenge.ts'
import SameSheet from './scenes/SameSheet.vue'
import LaneSeats from './scenes/LaneSeats.vue'
import AssignChallenge from './scenes/AssignChallenge.vue'
import {
  CHALLENGE_N, EXPLORE_LAUNCH, EXPLORE_N, OWN_CELL_BLANKS, OWN_CELL_CODE, OWN_CELL_HINTS, STAGE_ID, STAR_LABELS,
  VARIANT_N, addArgs, judgeOwnCell,
} from './challenge.ts'

const S = STAGE_ID
const GOAL = `派线程把 ${CHALLENGE_N} 对数加完：人人一格，不多派也不少派，换一批数也照样对。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const NEXT = neighborsOf(S).next
const ADDITIONS = stageById('novice-thousand-additions')
const PANORAMA = stageById('novice-gpu-panorama')
const WAVE = stageById('novice-wavefront')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const LANES = HARDWARE_DEVICES[DEFAULT_DEVICE_ID].params.lanesPerSimd.value

// 探索二：读者第一次用代码沙盒。探索环节，看答案不影响星级，代码存进这一关的草稿槽。
const EXPLORE_ARGS = addArgs(EXPLORE_N)
const ownCell = useChallenge({ stage: S, id: 'own-cell', kind: 'explore', hints: OWN_CELL_HINTS })

const pLoop = [
  { label: '1 遍：8 个机器人自动分着做，一人一格', why: '工作单上没写谁做哪一格。每个机器人都从 i = 0 做到 i = 7。' },
  { label: '8 遍：每个机器人都把 8 格从头算一遍', correct: true, why: '工作单写的是整段循环，每个机器人都完整做一遍。8 个人，每格 8 遍。' },
  { label: '只有第一个机器人干活，另外 7 个闲着', why: '派出去的机器人都会开工，每个都照着工作单做。' },
  { label: '我不确定', why: '不确定也没关系，下面让机器人开工看看。' },
]

const checkpoint = [
  {
    q: '一张小图有 100 个像素，要把每个像素都调亮一点。写成 kernel 时，工作单上该写什么？',
    options: [
      { label: '整张图的调法：用循环从第 0 个像素调到第 99 个', why: '这样写，派出去的每个线程都会把整张图调一遍，活干了很多遍。' },
      { label: '一个线程的活：调亮第 threadIdx.x 个像素', correct: true, why: '工作单只写一个线程要做的事。派 100 个线程照着做，各调各的那一个。' },
      { label: '只写调亮第 0 个像素，GPU 会自动换成别的像素', why: 'GPU 不会替你换下标：每个线程拿到的工作单一模一样，靠 threadIdx.x 才分得开。' },
    ],
  },
  {
    q: '一周 7 天的气温要从摄氏度换成华氏度。工作单让每个线程换第 threadIdx.x 天，只派 1 组。这一组派几个线程？',
    options: [
      { label: '1 个：让它从头换到尾', why: '这张工作单里，一个线程只换第 threadIdx.x 天。派 1 个，只换了第 0 天。' },
      { label: '7 个', correct: true, why: '一个线程换一天，7 天就派 7 个线程，不多不少。' },
      { label: `${LANES} 个：一条 SIMD 正好 ${LANES} 个 lane`, why: `派几个线程看数据有几份，不看 lane 有几个。多派的 ${LANES - 7} 个会去换第 7～${LANES - 1} 天，写到数组外面。` },
    ],
  },
  {
    q: '工作单里写 i = threadIdx.x * 2，再写 c[i] = a[i] + b[i]。派 4 个线程，c 有 8 格。哪几格有线程算？',
    options: [
      { label: 'c[0]～c[3]', why: '这是 i = threadIdx.x 的结果。乘 2 以后，1 号线程算的是 c[2]。' },
      { label: 'c[0]、c[2]、c[4]、c[6]', correct: true, why: '0～3 号线程的 i 是 0、2、4、6，单数的格子没人算。' },
      { label: '8 格都有人算', why: '4 个线程一人写一格，最多写 4 格。' },
    ],
  },
]
</script>

# 1-3 给线程派活

<div class="at-hello">
  <Mascot class="at-hello__art" :size="64" />
  <p class="at-hello__line">工作单发下去了，可谁该算哪一格呢？</p>
</div>

上一关，CPU 把工作单 add 交给了 GPU。GPU 上有几千个工位，每个工位怎么知道自己该算哪一道？工作单上到底写了什么？

第 {{ ADDITIONS.code }} 关的学徒，在代码里叫线程（thread）。从这一关起，线程画成线程小机器人，屏幕上的数字是它的编号。这一关写你的第一张工作单，给每个机器人派一格活。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

挑战在后面：先看机器人怎样照着工作单干活。

</Mission>

## 热身：把循环搬进工作单？

第 {{ ADDITIONS.code }} 关的逐个相加是一段循环：i 从 0 数到 n − 1，一格一格地加。把这段循环原样写进工作单，就是下面这样。

<LangCode>
<template #hip>

```cpp
__global__ void add(float* a, float* b, float* c, int n) {
    for (int i = 0; i < n; i++) {
        c[i] = a[i] + b[i];
    }
}
```

</template>
<template #python>

```python
@kernel
def add(a, b, c, n):
    for i in range(n):
        c[i] = a[i] + b[i]
```

</template>
</LangCode>

`__global__`（HIP 风格）和 `@kernel`（Python 风格）标出这是交给 GPU 的工作单。a、b、c 是三排数，`float*` 表示一排小数，n 是一排有几个数。

现在派 8 个线程小机器人，每个都拿一份这张工作单，c 有 8 格。

<Predict :stage="S" id="at-p-loop" question="8 个机器人都照着做完，c 的每一格被算了几遍？" :options="pLoop">

下面让机器人开工，一步一步看他们写到哪一格。

</Predict>

## 探索一：人人都做一整张

工作单发下去了，下面是机器人干活的样子。每一步，所有机器人一起往同一格里写。

<SameSheet />

工作单上的每一行，每个机器人都从头做一遍。派 8 个，每格就被算 8 遍：结果没错，活却白干了 7 份。派 2 个、4 个也一样，派几个就算几遍。

## 探索二：认领自己的一格

要让每个机器人只算一格，它得知道自己是谁。每个机器人屏幕上都有一个编号，叫 `threadIdx.x`：第一个是 0，接着是 1、2……一直到 7。同一张工作单，每个机器人读到的 `threadIdx.x` 都不一样。

下面是你的第一个代码沙盒。虚线框里是能改的空：把 `i = 0` 改掉，让 8 个机器人各算一格。改好点「运行」；想一步一步看，点「单步」；改乱了点「重置」。

<Sandbox
  title="8 个机器人：各算自己那一格"
  :code="OWN_CELL_CODE"
  :blanks="OWN_CELL_BLANKS"
  :launch="EXPLORE_LAUNCH"
  :args="EXPLORE_ARGS"
  :judge="judgeOwnCell"
  :challenge="ownCell"
  file="add"
>
  <template #result="{ result, step, runs }">
    <RobotGrid :result="result" :step="step" :launch="runs[0]?.launch ?? EXPLORE_LAUNCH" array="c" :controls="false" />
  </template>
</Sandbox>

写成 `i = threadIdx.x`，0 号机器人算 c[0]，7 号算 c[7]：一份代码，各做一份。循环也不见了：CPU 上是一个人让 i 从 0 数到 7，GPU 上是 8 个人各拿一个 i，同时动笔。

## 原理：工作单和线程

<ConceptCard term="kernel" code="__global__ · @kernel">

这一关的 add 就是一个 kernel。它只写一个线程要做的事：算出自己的 i，再算 c[i]。

</ConceptCard>

<ConceptCard term="thread" code="threadIdx.x">

每个线程跑的都是同一份 kernel，靠自己的编号 `threadIdx.x` 找到自己那一格。

</ConceptCard>

派出去的线程，最后要落到流水线上干活。还记得第 {{ PANORAMA.code }} 关的全景图吗？一条 SIMD 就是车间里的一条流水线，上面排着 {{ LANES }} 个 lane，也就是工位。

每个线程最终跑在 SIMD 的一条 lane 上，一人一个工位。探索二的 8 个机器人，就站在同一条流水线的 8 个工位上。

<LaneSeats />

所以派几个线程，看数据有几份，不看工位有几个。

比喻的边界：画里的机器人一直站在自己的工位上。真实的线程不是这样，派出去的线程可以比工位多得多，轮到了才上去算。同一小队的线程还要听同一个口令，第 {{ WAVE.code }} 关会讲。

<DeepDive title="threadIdx.x 这个名字怎么读？">

thread 是线程，Idx 是 index（编号）的缩写：threadIdx 就是线程编号。

后面的 `.x` 表示第一个方向。线程还可以排成二维、三维，用 `.y`、`.z` 编号，处理图片、矩阵时会用到，后面的关卡再讲。

</DeepDive>

<DeepDive title="一个线程只能算一格吗？">

不是。一个线程算几格、算哪几格，都由你写的 kernel 决定。GPU 不会看到加法，就自动替你把数组分好。

新手村先用最简单的分法：一个线程一格。

</DeepDive>

## 挑战：给 12 对数派活

工坊城今天的单子：{{ CHALLENGE_N }} 对数，逐个相加。这次派几个线程、每个线程算哪一格，都由你来定：旋钮选人数，沙盒里补 i。

这是星级挑战：{{ CHALLENGE_N }} 个数都算对拿第一颗星；派的线程刚好够用、没有线程写到数组外面，拿第二颗；换成 {{ VARIANT_N }} 个数，工作单和派法都不改照样全对，拿第三颗。没过不扣分，没过两次以后会出现提示。

<AssignChallenge />

## 你现在能……

- 说清 kernel 是什么：交给 GPU 的一份代码，每个线程都照着它做一遍
- 用 `threadIdx.x` 让每个线程认领不同的一格，写出 `i = threadIdx.x`
- 按数据有几个决定派几个线程，并说出每个线程最后跑在 SIMD 的一条 lane 上

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：数据多了，线程要分成一组一组派出去。可每组的 `threadIdx.x` 都从 0 数起，怎样让每个线程拿到不同的一格？

- 回到基础：[旧版第 2 章 2.1.2 核函数与线程](/part0-intro/chapter2/#_2-1-2-核函数与线程)，同样把 kernel 比作一张共同的工作单。
- 深入一层：[旧版第 2 章 2.3.4 线程编号与 lane 编号](/part0-intro/chapter2/#_2-3-4-线程编号与-lane-编号)，看一组里的线程号怎样对应到 lane。

<EvidenceCard kind="simulated">这一关的结果来自浏览器里的模拟器：哪个线程写了哪一格、每格被算了几遍、有没有写到数组外面，都是它按你的代码跑出来的，不计时。一条 SIMD 有 {{ LANES }} 个 lane 出自 AMD 的 RDNA4 指令集手册（出处写在第 {{ PANORAMA.code }} 关的全景图下面），不是实测；工位图是示意。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1、1-2 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.at-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.at-hello__art {
  flex: none;
}

.at-hello__line {
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
.hg-shell.is-plain .at-hello__art {
  display: none;
}

.hg-shell.is-plain .at-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
