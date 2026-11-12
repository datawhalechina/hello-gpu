---
layout: stage
stage: novice-first-agent
newTerms: [autotune, search-space]
evidence: simulated
description: 上一关你替 Agent 想下一步，这一关把想法写成代码。先数一数全试一遍要走多少步，再看两条规则怎样省下这些步数，最后补全 ReAct 循环里的三个空，让你的 Agent 在模拟器上自己调到三星。
---

<script setup>
import { megabytes, PYODIDE_BYTES } from '@course/agent/pyodide-files.ts'
import { describeConfig } from '@course/agent/tasks.ts'
import { neighborsOf, stageById } from '@course/outline.ts'
import { SIM_PARAMS } from '@sim/params.ts'
import AgentBench from './scenes/AgentBench.vue'
import RuleLab from './scenes/RuleLab.vue'
import TryAll from './scenes/TryAll.vue'
import {
  BEST, BUDGET_CONFIGS, MEMORY_AT_START, RULE_CASES, SPACE, STAGE_ID, STAR_LABELS, START, STEP_LIMIT, SWEEP_STEPS, TASK,
  TIMING_AT_START, TOUR, TRY_STEPS, VARIANTS, WAVE, cellOf, dictText,
} from './challenge.ts'

const S = STAGE_ID
const GOAL = `补全 Agent 代码里的三个空，让它从 ${describeConfig(START)} 出发，自己把 ${TASK.n} 个数的向量加法调到又快又省（模拟）。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const THOUSAND = stageById('novice-thousand-additions')
const WAVEFRONT = stageById('novice-wavefront')
const COALESCING = stageById('novice-coalescing')
const TIMING = stageById('novice-timing')

const AT_START = cellOf(START)
const BOTH = RULE_CASES.both
const ONLY_STRIDE = RULE_CASES.stride

const Q_TRIED = `上一关的规则 Agent 从 ${describeConfig(START)} 出发，${TOUR.steps} 步交卷。${SPACE.length} 组参数里，它试了几组？`
const pTried = [
  { label: `${SPACE.length} 组：全试一遍，才知道哪组最快`, why: `它没有全试：一轮最多 ${STEP_LIMIT} 步，每组至少要运行一次，${STEP_LIMIT} 步连一半都试不完。` },
  { label: `${TOUR.steps} 组：一步换一组`, why: `一组参数要运行、计时、看访存，三步才看清一组，${TOUR.steps} 步试不了 ${TOUR.steps} 组。` },
  { label: `${TOUR.path.length} 组`, correct: true, why: `${TOUR.path.map(describeConfig).join(' → ')}。每组运行、计时、看访存 3 步，${TOUR.path.length} 组 ${TOUR.path.length * 3} 步，再交卷 1 步，正好 ${TOUR.steps} 步。` },
  { label: '我不确定', why: '不确定也没关系，下面先数一数全试一遍要走多少步。' },
]

const Q_RULE = `只教 Agent 规则一：多搬了，就把步长改成 1。从 ${describeConfig(START)} 出发，它最后交哪一组？`
const pRule = [
  { label: `${describeConfig(BOTH.verdict.config)}：和上一关的规则 Agent 一样`, why: `它不会规则二。步长改成 1 以后，block ${START.block} 还不是 ${WAVE} 的倍数，它看不出这是问题。` },
  { label: describeConfig(ONLY_STRIDE.verdict.config), correct: true, why: `第 1 圈看访存，搬了 ${AT_START.transactions} 车、理想 ${AT_START.ideal} 车，它把步长改成 1。第 2 圈步长已经是 1，规则一不再成立，它就交卷了。` },
  { label: `${describeConfig(START)}：一步都不改`, why: `第 1 圈看访存就读到多搬了：${AT_START.transactions} 车，理想只要 ${AT_START.ideal} 车。规则一成立，它会改步长。` },
  { label: '我不确定', why: '不确定也没关系，下面拨开关看看。' },
]

const checkpoint = [
  {
    q: '给另一个 kernel 调参：block 有 4 种选法，访问步长有 3 种，每个线程算几个数还有 2 种。全试一遍，每组运行、计时各 1 步，最后交卷 1 步，一共走几步？',
    options: [
      { label: '10 步：4 + 3 + 2，再交卷 1 步', why: '几样参数要配起来试，组数是 4 × 3 × 2 = 24，不是相加。' },
      { label: '25 步：24 组，再交卷 1 步', why: '组数对了，可每组要运行、计时 2 步：24 组就是 48 步。' },
      { label: '49 步：24 组，每组 2 步，再交卷 1 步', correct: true, why: '4 × 3 × 2 = 24 组，每组 2 步是 48 步，再加交卷 1 步。参数每多一样，全试的步数就成倍往上涨。' },
    ],
  },
  {
    q: '想让 Agent 在「lane 利用率不到一半」时换 block。计时交回来的字典存在 timing 里，这个判断怎么写？',
    options: [
      { label: 'timing < 0.5', why: 'timing 是一整个字典，要先按键名取出里面的数，才能和 0.5 比大小。' },
      { label: 'timing.lane_utilization < 0.5', why: 'Python 的字典用方括号加键名取值，写成点取不到。' },
      { label: 'timing["lane_utilization"] < 0.5', correct: true, why: '按键名取出 lane 利用率，再和 0.5 比。lane 利用率在计时的观察里。' },
      { label: 'memory["lane_utilization"] < 0.5', why: '看访存的观察里只有 accesses、transactions、ideal、efficiency 四个键，lane 利用率在计时的观察里。' },
    ],
  },
  {
    q: '换一个新任务：参数之间互相影响，你也说不清哪种配置该快。搜索空间只有 12 组，时间也够。用哪种办法自动调参更稳？',
    options: [
      { label: '写一个规则 Agent，只挑几组试', why: '规则要你先知道问题出在哪。说不清规律的时候，规则可能把最快的那组漏掉。' },
      { label: '全试一遍：12 组都量，挑最快的', correct: true, why: '组数少、规律说不清的时候，全试最稳：不靠规则，量出来的就是答案。' },
      { label: '不调了，用默认的配置', why: '默认配置不一定快。12 组不多，全试一遍就能知道。' },
    ],
  },
]
</script>

# 1-14 造你的第一个 Agent

<div class="fa-hello">
  <Mascot class="fa-hello__art" :size="64" />
  <p class="fa-hello__line">上一关你替 Agent 想。这一关，写一个自己会想的。</p>
</div>

第 {{ PREV.code }} 关，你替 Agent 挑每一步：看观察，想下一步，再动手。

这一关把这些想法写成代码。写好以后，程序自己运行、自己看结果、自己改参数，一直调到三星：这就是让程序自己调参。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

先数一数全试一遍要走多少步，再看两条规则怎样省下这些步数；最后把规则写进代码，交给你的 Agent 去跑。

</Mission>

## 热身：它试了几组？

要调的还是那个向量加法：{{ TASK.n }} 个数，就是第 {{ THOUSAND.code }} 关那一千道加法。工作单里，每个线程连着算 stride 个数：

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

能调的有两样：每组线程数 block 有 {{ TASK.blocks.length }} 种选法，访问步长 stride 有 {{ TASK.strides.length }} 种。配起来一共 {{ SPACE.length }} 组。

<Predict :stage="S" id="fa-p-tried" :question="Q_TRIED" :options="pTried">

它只试了 {{ TOUR.path.length }} 组，最后交的 {{ describeConfig(TOUR.path[TOUR.path.length - 1]) }} 就是最快的几组之一。剩下的那些组，它一组都没碰。

</Predict>

## 探索一：全试一遍

让程序自己调参，最直接的办法是全试一遍：每组运行一次，确认算对；再计一次时；最后交出最快的那组。

这样做不用看访存，也不用懂为什么慢，代价是步数。一步就是用一次工具，下面数一数要走几步。

<TryAll />

全试一遍一定找得到最快的那几组，可要走 {{ SWEEP_STEPS }} 步；一轮最多 {{ STEP_LIMIT }} 步，只够试 {{ BUDGET_CONFIGS }} 组。最快的 {{ BEST.length }} 组都是 {{ TASK.bestCycles }} 个周期（模拟）：步长都是 1，block 都是 {{ WAVE }} 的倍数。

## 探索二：两条规则

规则 Agent 不全试。它每一圈都运行、计时、看访存，看出哪里有问题就改哪里。它会两条规则：

- 规则一：搬的车比理想多，就把步长改成 1（第 {{ COALESCING.code }} 关：相邻线程拿相邻的数）；
- 规则二：block 不是 {{ WAVE }} 的倍数，就往上取到 {{ WAVE }} 的倍数（第 {{ WAVEFRONT.code }} 关：不然小队里有 lane 空着）。

两条都不成立，它就交卷。

<Predict :stage="S" id="fa-p-rule" :question="Q_RULE" :options="pRule">

下面拨开关，把两条规则一条一条教给它。

</Predict>

<RuleLab />

两条都会，它只试 {{ BOTH.path.length }} 组、走 {{ BOTH.steps }} 步，就交出 {{ describeConfig(BOTH.verdict.config) }}。少一条，它就停在半路：一条规则只管一个问题。

## 原理：自动调参和搜索空间

让程序自己试配置、挑出最好的那组，叫自动调参。所有能试的配置合在一起，叫搜索空间。

<ConceptCard term="autotune">

全试一遍是一种自动调参，照着观察挑着试也是一种。前一种稳，后一种省步数。

</ConceptCard>

<ConceptCard term="search-space" code="block × stride">

这一关的搜索空间是 block 的 {{ TASK.blocks.length }} 种选法乘上步长的 {{ TASK.strides.length }} 种，一共 {{ SPACE.length }} 组。参数每多一样，组数就再乘上它有几种取值。

</ConceptCard>

两种做法各有代价。全试一遍不用懂原理，可组数一多就试不完；Agent 只试几组，可它只会写进规则里的那几条，规则没想到的问题，它看不出来。

<DeepDive title="出处：自动调参">

- Triton 的 [`triton.autotune`](https://triton-lang.org/main/python-api/generated/triton.autotune.html)：给一张配置清单 `configs`，`key` 里的参数一变，就把清单里的配置都跑一遍，挑最快的。文档提醒，配置都跑一遍时 kernel 会被跑很多次；`prune_configs_by` 可以先用性能模型或自己写的函数把清单剪短，只跑一部分。
- MIOpen 的文档《[Using the find APIs and immediate mode](https://rocm.docs.amd.com/projects/MIOpen/en/latest/how-to/find-and-immediate.html)》：一种卷积有好几种算法，find 调用量出它们的快慢，按快慢排好，最快的排第一。文档写明 find 很费时间、要的工作空间也大，建议一个程序只调一次，把选好的算法留着用。
- 这一关的 Agent 走的是另一条路：不全试，照着观察挑着试。它的两条规则，都是前面关卡学过的。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 周期数是第 {{ TIMING.code }} 关的示意计时，车次按一车 {{ SIM_PARAMS.lineBytes }} 字节的示意值数，同一组参数每次都一样。真卡上计时有噪声，自动调参要每组多量几次再比（第 {{ TIMING.code }} 关）。
- 这一关的「一步」就是用一次工具，一轮最多 {{ STEP_LIMIT }} 步是模拟器的约定，不是 GPU 的限制。真卡上每试一组都要编译、运行、计时，代价是时间。
- 搜索空间只有 {{ SPACE.length }} 组。真的调参常常有好几样参数，组数是它们的取值个数乘起来。
- 你的 Agent 是真的 Python 程序：浏览器用 Pyodide 运行它，它调用的四样工具跑在同一个模拟器上。

</DeepDive>

## 挑战：补全你的 Agent

现在把两条规则写进代码。Agent 的代码只有 Python 一种写法：浏览器用 Pyodide 运行它。代码分两段看。

第一段是行动和观察。每一圈先跑一次、计时、看访存；工具交回来的字典，就是观察：

```python
block, stride = START          # 起点：block 48、步长 4
while True:
    run_kernel(block=block, stride=stride)               # 跑一次
    timing = measure(block=block, stride=stride)         # 计时
    memory = inspect_memory(block=block, stride=stride)  # 看访存
```

起点这一圈，<code>timing</code> 是 <code>{{ dictText(TIMING_AT_START) }}</code>，<code>memory</code> 是 <code>{{ dictText(MEMORY_AT_START) }}</code>（模拟）。按键名取值：<code>timing["cycles"]</code> 就是 {{ TIMING_AT_START.cycles }}。

第二段是思考：照着观察，决定下一圈怎么改。三个空都在这里：

```python
    if ___ and stride > 1:   # 第 1 个空：多搬了吗？
        stride = ___         # 第 2 个空：新的步长
    elif ___:                # 第 3 个空：block 不是 32 的倍数吗？
        block = (block + 31) // 32 * 32   # 往上取到 32 的倍数
    else:
        break                # 没有能改的，跳出循环
finish(block=block, stride=stride)        # 交卷
```

真正的代码里还有几行 `think("…")`，把每一圈的想法写下来，方便你看它为什么这样走。三个空一开始写着 `False`、`stride`、`False`：能跑，但第一圈就交卷。

这是星级挑战：你的 Agent 交卷、交的参数算对，拿第一颗星；从 {{ describeConfig(START) }} 出发交出又快又省的参数，拿第二颗；换成另外 {{ VARIANTS.length }} 组当起点，同一份代码也都调到又快又省，拿第三颗。没过不扣分，没过两次以后会出现提示。第一次运行要下载 Python 运行环境（约 {{ megabytes(PYODIDE_BYTES) }}），只下载一次。

<AgentBench />

## 可选：换大模型来想

「思考」这一步也可以交给大模型：它读同样的观察，每一步回一个行动，页面检查过才执行。下面这一节完全可选，卡片里写了 Key 怎么用、存在哪。

<LlmSettings />

大模型走的路不一定和规则 Agent 一样。可工具、观察、步数上限都一样：它也得照着观察改，到点交卷。

## 你现在能……

- 说出自动调参的两种做法：全试一遍挑最快的，或者照着观察挑着试
- 数出搜索空间有几组，算出全试一遍要走多少步
- 把观察写成判断、把改法写成赋值，写出一个自己会调参的 ReAct 循环

## 检查点

答完这三道题，这一关就完成了，你会拿到「第一个 Agent」徽章。

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：修好三个坏 kernel，用你的 Agent 把一个 kernel 调到三星，再识破一份没同步就计时的报告。

- 回到基础：[旧版第 14 章 14.4 模型怎样调用工具](/part3-agent/chapter14/#_14-4-模型怎样调用工具)，工具名和参数怎样变成一次函数调用，结果怎样回到下一次决定。
- 深入一层：[旧版第 14 章 14.5 明确这套 Agent 能做什么](/part3-agent/chapter14/#_14-5-明确这套-agent-能做什么)，只想枚举几个参数时，普通的网格搜索可能更简单；Agent 的长处是看着错误信息和实验结果挑下一步。

<EvidenceCard kind="simulated">这一关的周期数和车次，都是浏览器里的模拟器算出来的，不是实测：周期数用的是第 {{ TIMING.code }} 关的示意计时，车次按一车 {{ SIM_PARAMS.lineBytes }} 字节的示意值数，同一组参数每次都一样。一轮最多 {{ STEP_LIMIT }} 步是模拟器的约定，不是 GPU 的限制。你的 Agent 在浏览器里用 Pyodide 运行，调用的工具跑在同一个模拟器上。真卡上这两个参数自动调出来是什么样[待实测]，实验档案馆里还没有这一关的记录。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-13 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.fa-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.fa-hello__art {
  flex: none;
}

.fa-hello__line {
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
.hg-shell.is-plain .fa-hello__art {
  display: none;
}

.hg-shell.is-plain .fa-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
