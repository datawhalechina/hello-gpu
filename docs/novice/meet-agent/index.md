---
layout: stage
stage: novice-meet-agent
newTerms: [agent, react-loop]
evidence: simulated
description: 调参时你一直在做三件事：想一想、动手试、看结果。把这件事交给程序，就是 Agent。先看规则 Agent 一步一步调向量加法，再换个起点看它怎样跟着观察改主意，最后你来当一回 Agent，和它比一比。
---

<script setup>
import { describeConfig } from '@course/agent/tasks.ts'
import { neighborsOf, stageById } from '@course/outline.ts'
import { SIM_PARAMS } from '@sim/params.ts'
import AgentSeat from './scenes/AgentSeat.vue'
import PathLab from './scenes/PathLab.vue'
import { PATH, PATH_START, SEAT_START, STAGE_ID, STAR_LABELS, STEP_LIMIT, TASK, TOUR, TOUR_START, WAVE } from './challenge.ts'

const S = STAGE_ID
const GOAL = `当一回 Agent：只看工具交回来的观察，把 ${TASK.n} 个数的向量加法调到又快又省（模拟）。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const THOUSAND = stageById('novice-thousand-additions')
const ASSIGN = stageById('novice-assign-threads')
const GROUPS = stageById('novice-thread-groups')
const COALESCING = stageById('novice-coalescing')
const TIMING = stageById('novice-timing')

const pFirst = [
  { label: '计时：先看看有多慢', why: `还不知道 ${TASK.n} 个数算得对不对。算错了，跑得再快也没用。` },
  { label: '看访存：先数数搬了几车', why: '结果对不对还不知道，先别管搬了几车。' },
  { label: '运行：先确认算对', correct: true, why: `规则 Agent 第 1 步就是运行：${TASK.n} 个数都对、没有越界，后面计时、看访存才有意义。` },
  { label: `直接把步长改成 1：第 ${COALESCING.code} 关学过`, why: '它还一个观察都没读到，没有理由改。规则 Agent 每次换参数，都拿观察里的数当理由。' },
  { label: '我不确定', why: '不确定也没关系，下面看规则 Agent 的第 1 步。' },
]

const [, PATH_NEXT] = PATH.path
const Q_PATH = `从 ${describeConfig(PATH_START)} 出发，规则 Agent 第一次换参数，先改哪一样？`
const pPath = [
  { label: '先改步长：上一段它就是先改的步长', why: `上一段先改步长，是因为观察里读到多搬了车。这一次搬了 ${PATH.transactions} 车，理想也是 ${PATH.ideal} 车（模拟），一车都没多搬。` },
  { label: '先改 block', correct: true, why: `同一步里，${PATH_START.block} 个线程相邻隔 ${PATH_START.stride} 个，要的数正好落在一车里，一车没多搬。可 lane 利用率只有 ${PATH.laneUse}（模拟）：一组 ${PATH_START.block} 个线程，一支小队 ${WAVE} 个 lane 空着一半。它先把 block 换成 ${PATH_NEXT.block}。` },
  { label: '不改了，直接交卷', why: `车数等于理想，可 lane 利用率只有 ${PATH.laneUse}（模拟），还有能改的地方。` },
  { label: '我不确定', why: '不确定也没关系，下面拨一拨起点看看。' },
]

const checkpoint = [
  {
    q: '假想 Agent 运行了一组参数，读到这份观察：{ "correct": false, "wrong": 24, "out_of_bounds": 0 }。下一步该做什么？',
    options: [
      { label: '计时：看看这组快不快', why: '有 24 个数算错了。结果不对，快也没用，量了也白量。' },
      { label: '不要这组：换一组参数，或者先查哪里算错了', correct: true, why: '观察说这组有数算错了。先换掉它，或者查出错在哪，别在它身上花步数。' },
      { label: '交卷：已经运行过了', why: '运行过，可观察说算错了。交上去，一颗星都拿不到。' },
    ],
  },
  {
    q: '思考、行动、观察三样里，哪一样是工具交回来的，Agent 自己改不了？',
    options: [
      { label: '思考', why: '思考是 Agent 自己写的：读了到目前为止的观察，想好下一步做什么。' },
      { label: '行动', why: '行动也是 Agent 自己挑的：用哪样工具、哪组参数。' },
      { label: '观察', correct: true, why: '观察是工具在模拟器上跑出来的结果。Agent 只能读它，读完再想下一步。' },
    ],
  },
  {
    q: '一个 Agent 总在两组参数之间来回换，一直不交卷。这一轮会怎样？',
    options: [
      { label: '一直转下去，页面卡住', why: `循环有步数上限：一轮最多 ${STEP_LIMIT} 步，走满就停。` },
      { label: `走满 ${STEP_LIMIT} 步就停，这一轮没有分`, correct: true, why: '步数上限让循环一定会停。不交卷就没有分，所以规则 Agent 只剩最后一步时，会交出量过的最快的一组。' },
      { label: '模拟器替它挑最快的一组交上去', why: '交卷要 Agent 自己做。走满步数还没交，就是没交。' },
    ],
  },
]
</script>

# 1-13 认识 Agent

<div class="ma-hello">
  <Mascot class="ma-hello__art" :size="64" />
  <p class="ma-hello__line">拨旋钮、看读数、再拨：这件事能交给程序吗？</p>
</div>

第 {{ PREV.code }} 关的派法，是你拨着旋钮一次次试出来的：拨一下，运行，看读数，再想下一下拨哪儿。

这一关把这件事交给一个程序。它自己挑下一步、自己动手、自己看结果，这样的程序叫 Agent。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

先看规则 Agent 调一轮向量加法，再换个起点，看它怎样跟着观察改主意；最后你来当 Agent，和它比一比。

</Mission>

## 热身：Agent 第一步做什么？

Agent 要调的是向量加法：{{ TASK.n }} 个数，就是第 {{ THOUSAND.code }} 关那一千道加法。工作单里，每个线程连着算 stride 个数：

<LangCode>
<template #hip>

```cpp
__global__ void add(const float* a, const float* b, float* c, int n, int stride) {
    // 每个线程连着算 stride 个数：相邻两个线程隔 stride 个数
    int first = (blockIdx.x * blockDim.x + threadIdx.x) * stride;
    for (int k = 0; k < stride; k++) {
        int i = first + k;
        if (i < n) {
            c[i] = a[i] + b[i];
        }
    }
}
```

</template>
<template #python>

```python
@kernel
def add(a, b, c, n, stride):
    # 每个线程连着算 stride 个数：相邻两个线程隔 stride 个数
    first = (blockIdx.x * blockDim.x + threadIdx.x) * stride
    for k in range(stride):
        i = first + k
        if i < n:
            c[i] = a[i] + b[i]
```

</template>
</LangCode>

能调的有两样：每组线程数 block，访问步长 stride。起点是 {{ describeConfig(TOUR_START) }}，能跑，但不好。

Agent 手里有四样工具，都是你用过的操作：

- 运行 `run_kernel`：跑一次，看 {{ TASK.n }} 个数对不对、有没有越界（第 {{ ASSIGN.code }}、{{ GROUPS.code }} 关）
- 计时 `measure`：量一量要多少个周期（第 {{ TIMING.code }} 关）
- 看访存 `inspect_memory`：数一数读写显存搬了几车（第 {{ COALESCING.code }} 关）
- 交卷 `finish`：交出一组参数，这一轮结束

每一步只用一样工具，参数由 Agent 自己定。工具交回来的结果叫观察，Agent 只看得到它。

<Predict :stage="S" id="ma-p-first" question="Agent 第一步该用哪样工具？" :options="pFirst">

下面放规则 Agent 的这一轮，它的第 1 步就是答案。

</Predict>

## 探索一：一步三条

规则 Agent 照几条写死的规则挑下一步。下面放它这一轮：每一步先「思考」，再「行动」，最后读「观察」。点「下一条」一条一条看，也可以直接播放。

<div class="ma-console">
  <AgentConsole :reader="false" />
</div>

第 3 步看访存，观察里写着搬了 {{ TOUR.transactions }} 车，理想只要 {{ TOUR.ideal }} 车（模拟）。第 4 步的思考就拿这句当理由，把步长改成 1。

每一步的观察，都是下一步思考的材料。这样一圈一圈转，转到第 {{ TOUR.steps }} 步，它才交卷。

## 探索二：换个起点

规则还是那几条，起点换成 {{ describeConfig(PATH_START) }}。

<Predict :stage="S" id="ma-p-path" :question="Q_PATH" :options="pPath">

下面拨一拨起点，看它每次走的路。

</Predict>

<PathLab />

从 {{ describeConfig(PATH_START) }} 出发，它先改 block；换到 {{ describeConfig(PATH_NEXT) }}，才看到多搬了车，再改步长。Agent 不背步骤：下一步做什么，看它读到了什么。

## 原理：Agent 和 ReAct 循环

能调用工具、读观察、自己决定下一步，直到交卷，这样的程序就是 Agent。它一步一步转的那一圈，叫 ReAct 循环。

<ConceptCard term="agent">

这一关的规则 Agent 用几条写死的规则想下一步。换成大模型来想，也还是这个循环：第 {{ NEXT.code }} 关可以接上你自己的大模型。

</ConceptCard>

<ConceptCard term="react-loop" code="思考 → 行动 → 观察">

每一圈只用一样工具，转到交卷为止。一轮最多 {{ STEP_LIMIT }} 步，走满了还没交卷，这一轮就没有分。

</ConceptCard>

规则 Agent 的几条规则，探索一里都看得到：先运行，确认算对；再计时、看访存；照着观察换一组参数，试过的不再试；没有能改的，就交卷。

<DeepDive title="出处：ReAct">

- 论文《[ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)》（Yao 等，2022）：让大模型交替写出推理和行动。行动去外面拿新信息，比如问答任务里调用一个简单的维基百科接口；拿回来的结果接着推理。标题说的就是这两样：推理（Reasoning）和行动（Acting）。
- 论文的[项目页](https://react-lm.github.io/)说，一段 ReAct 示例由三样组成：人写的推理、行动，以及环境对行动给出的观察。这一关的「思考、行动、观察」就是这三样。
- 这一关的规则 Agent 不用大模型：思考由几条写死的规则给出，每条思考都带着观察里的数。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 工具都在浏览器里的模拟器上跑，同一组参数每次的观察都一样。真卡上计时有噪声，同一组参数量几次都不一样（第 {{ TIMING.code }} 关），铸造城会讲 Agent 怎样在噪声里判断真的变快了。
- 周期数是第 {{ TIMING.code }} 关的示意计时；车次按一车 {{ SIM_PARAMS.lineBytes }} 字节数，同第 {{ COALESCING.code }} 关。lane 利用率是每一步在干活的 lane 占几成。这些都是模拟值。
- 规则 Agent 只认两条改法：多搬了车，步长改成 1；block 不是 {{ WAVE }} 的倍数，换成比它大的最小的倍数。它不把 {{ TASK.blocks.length * TASK.strides.length }} 组参数挨个试一遍。
- 一轮最多 {{ STEP_LIMIT }} 步是模拟器的约定，不是 GPU 的限制：防止 Agent 一直不交卷。

</DeepDive>

## 挑战：你来当 Agent

起点换成 {{ describeConfig(SEAT_START) }}。这一回你来挑每一步：用哪样工具，用哪组参数。每走一步，控制台都写出规则 Agent 换你会怎么选。

这是星级挑战：交卷，交的那组先运行过、确认算对，拿第一颗星；交的参数又快又省，拿第二颗；每组参数换掉或交卷之前，都运行过、计过时、看过访存，拿第三颗。没过不扣分，没过两次以后会出现提示。

<AgentSeat />

## 你现在能……

- 说出 Agent 是什么：会调用工具、读观察、自己决定下一步，直到交卷的程序
- 把一轮调参拆成一圈圈的思考、行动、观察，指出是哪一步的观察让它换了参数
- 自己当一回 Agent：先确认算对，计过时、看过访存再换参数，最后交卷

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：这一关是你替 Agent 想下一步。下一关把想法写成代码：补全 ReAct 循环的三个空，让它自己调到三星。

- 回到基础：[旧版第 14 章 14.1 从一次手动优化说起](/part3-agent/chapter14/#_14-1-从一次手动优化说起)，手动调一次向量加法要做哪几件事，哪些交给模型去选，哪些交给工具去测。
- 深入一层：[旧版第 14 章 14.3 理解 ReAct 与反思](/part3-agent/chapter14/#_14-3-理解-react-与反思)，一次改动要写清看到了什么、只改什么、怎样判断，结果回来以后怎样反思。

<EvidenceCard kind="simulated">这一关的周期数、车次和 lane 利用率，都是浏览器里的模拟器算出来的，不是实测：周期数用的是第 {{ TIMING.code }} 关的示意计时，车次按一车 {{ SIM_PARAMS.lineBytes }} 字节的示意值数，同一组参数每次都一样。一轮最多 {{ STEP_LIMIT }} 步是模拟器的约定，不是 GPU 的限制。真卡上这两个参数调出来是什么样[待实测]，实验档案馆里还没有这一关的记录。</EvidenceCard>

<style scoped>
/* 探索一的控制台：上下和正文隔开（同 1-8 支线外面那一层 .as 的 20px）。 */
.ma-console {
  margin: 20px 0;
}

/* 小核开场：同 1-1～1-12 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.ma-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.ma-hello__art {
  flex: none;
}

.ma-hello__line {
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
.hg-shell.is-plain .ma-hello__art {
  display: none;
}

.hg-shell.is-plain .ma-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
