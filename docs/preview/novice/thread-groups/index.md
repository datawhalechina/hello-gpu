---
title: 1-3 线程分组（新手村 · 试点）
description: 新版 Hello GPU 的试点关卡：给线程分组、算出全局下标、加上边界检查。
sidebar: false
aside: false
prev: false
next: false
head:
  - - meta
    - name: robots
      content: noindex
---

<script setup>
import StageHeader from '../../ui/StageHeader.vue'
import Mission from '../../ui/Mission.vue'
import Predict from '../../ui/Predict.vue'
import LaunchLab from '../../ui/LaunchLab.vue'
import ConceptCard from '../../ui/ConceptCard.vue'
import DeepDive from '../../ui/DeepDive.vue'
import EvidenceCard from '../../ui/EvidenceCard.vue'
import LangCode from '../../ui/LangCode.vue'
import Checkpoint from '../../ui/Checkpoint.vue'
import PilotLog from '../../ui/PilotLog.vue'
import { STAGE_ID, STAR_LABELS, judge } from './challenge.ts'

const S = STAGE_ID
const ANSWER = 'blockIdx.x * blockDim.x + threadIdx.x'
const predictionIds = ['p-groups', 'p-collide', 'p-oob', 'p-agent']

const pGroups = [
  { label: '2 组', why: '2 组只有 8 个工人，还剩 2 对数没人算。' },
  { label: '3 组', correct: true, why: '3 组共 12 个工人，够用，还多出 2 个。' },
  { label: '4 组', why: '能算完，但多派了一整组：16 个工人里有 6 个闲着。' },
  { label: '我不确定' },
]

const pCollide = [
  { label: '刚好每人一对，全部算完', why: '每一组都有一个排第 0 的工人，他们会去抢同一对数。' },
  { label: '前 4 对数被算了好几遍，后面的数没人算', correct: true, why: '每组的规则一模一样，所以每组都只会去拿第 0～3 对。' },
  { label: '程序报错停下来', why: 'GPU 不会因为这个报错，它会安静地给出错误的结果。这正是这类问题难查的原因。' },
  { label: '我不确定' },
]

const pOob = [
  { label: '他们什么都不做', why: '他们和别人执行同一份代码。代码让他们写 c[i]，他们就会写。' },
  { label: '写到数组后面的内存里，可能弄坏别的数据', correct: true, why: '数组后面的内存可能存着别的数据，越界写会把它悄悄改掉。' },
  { label: 'GPU 会自动拦住', why: 'GPU 不检查数组有多长。写到哪里，完全由代码决定。' },
  { label: '我不确定' },
]

const pAgent = [
  { label: '把组数调大，多派人', why: '13 个数已经全部算对了。多派人只会多出更多越界写。' },
  { label: '加上边界检查 if (i < n)', correct: true, why: '观察里唯一的问题是越界写，边界检查正好解决它。' },
  { label: '把每组人数改小', why: '改每组人数只会改变多出来几个人，越界写依然存在。' },
]

const checkpoint = [
  {
    q: '每组 8 个线程，要处理 30 个数，至少要派几组？',
    options: [
      { label: '3 组', why: '3 组只有 24 个线程，还差 6 个数没人算。' },
      { label: '4 组', correct: true, why: '4 组共 32 个线程，够用，多出 2 个。' },
      { label: '5 组', why: '能算完，但多派了一整组。' },
    ],
  },
  {
    q: '接上一题：如果不加边界检查，会有几个线程写到数组外面？',
    options: [
      { label: '0 个', why: '派出了 32 个线程，比 30 个数多。' },
      { label: '2 个', correct: true, why: '32 − 30 = 2，也就是全局下标为 30 和 31 的两个线程。' },
      { label: '8 个', why: '多出来的不是一整组，只是最后一组里的 2 个线程。' },
    ],
  },
  {
    q: '每组 8 个线程。第 3 组（blockIdx.x = 3）里排第 5 的线程（threadIdx.x = 5），处理哪个下标？',
    options: [
      { label: '8', why: '这是 3 + 5，少乘了每组的人数。' },
      { label: '29', correct: true, why: '前面有 3 组、每组 8 人，共 24 人；再加上自己的 5，就是 29。' },
      { label: '15', why: '这是 3 × 5，把两个编号直接相乘了。' },
    ],
  },
]
</script>

# 1-3 线程分组

<StageHeader
  :stage="S"
  zone="新手村 · 试点"
  code="1-3"
  :lv="2"
  :minutes="15"
  hardware="浏览器即可"
  :prereq="{ label: '1-2 给线程派活（试点期间先看第 2 章 2.1）', href: '/part0-intro/chapter2/' }"
/>

<Mission :stage="S" goal="派出刚好够用的工人，把所有数加完，而且谁都不能把结果写到数组外面。" :stars="STAR_LABELS">
工坊城接到一张新单子：把两排数逐个相加，结果写进第三排。工人按组上岗，每组人数一样。这一关，由你来安排他们。
</Mission>

## 热身：要派几组？

上一关里，每个工人（线程）负责一对数。现在有 10 对数，工人每 4 个编成一组。

<Predict :stage="S" id="p-groups" question="10 对数，每组 4 个工人，至少要派几组？" :options="pGroups">

3 组共 12 个工人，比数据多 2 个。多出来的 2 个人会做什么？先记着这个问题。

</Predict>

## 探索一：每个工人只知道两件事

工人上岗时只知道两件事：自己在第几组，和自己在组里排第几。在代码里，这两个编号叫 `blockIdx.x` 和 `threadIdx.x`。每组的人数叫 `blockDim.x`。

下面这份代码里，每个工人都按「我在组里排第几」去拿数，也就是 `i = threadIdx.x`。

<Predict :stage="S" id="p-collide" question="如果每个工人都按 i = threadIdx.x 去拿数，会发生什么？" :options="pCollide">

动手看看。试着调一调每组人数和组数，看问题会不会消失。

</Predict>

<LaunchLab
  :stage="S"
  id="lab-collide"
  requires="p-collide"
  :n="10"
  :block-dim="4"
  :grid-dim="3"
  formula="threadIdx.x"
  :editable="['blockDim', 'gridDim']"
/>

不管怎么调组数，后面的数始终没人算：每一组都在重复做前几对。问题不在人数，在于拿数的规则。

## 探索二：写出拿数的规则

要让每个工人拿到不同的一对数，他得先算出「我前面一共有多少人」。把下面的规则改对，再点运行。

<LaunchLab
  :stage="S"
  id="lab-formula"
  :n="10"
  :block-dim="4"
  :grid-dim="3"
  formula="threadIdx.x"
  :editable="['formula', 'blockDim', 'gridDim']"
  goal="covered"
  success-text="每对数都有人算，而且没有人重复。不过看看最右边：有工人算出的位置超出了数组。"
  :hints="['想一想：第 1 组里排第 0 的工人，前面已经有几个人了？', '前面有 blockIdx.x 个完整的组，每组 blockDim.x 个人。再加上自己在组里的位置。']"
  :answer="ANSWER"
/>

规则对了以后，换一换每组人数。如果规则依然成立，说明你没有把人数写死。

## 探索三：多出来的工人

<Predict :stage="S" id="p-oob" question="12 个工人，只有 10 对数。如果不管多出来的 2 个人，他们会把结果写到哪里？" :options="pOob">

越界写不一定马上报错。它可能悄悄改掉别的数据，让程序在很远的地方出问题。

</Predict>

<LaunchLab
  :stage="S"
  id="lab-guard"
  requires="p-oob"
  :n="10"
  :block-dim="4"
  :grid-dim="3"
  :formula="ANSWER"
  :editable="['guard']"
  goal="covered-no-oob"
  success-text="多出来的 2 个工人检查后发现 i 不小于 n，就什么都不做。这叫边界检查。"
/>

为什么不干脆只派 10 个人？因为每组人数通常是固定的（真实程序里常用 256），数据长度却可以是任意数。所以派出的人数一般会多于数据，几乎每个 kernel 都要加边界检查。

## 原理：三个新名字

<ConceptCard :stage="S" term="线程块" en="block" code="blockIdx.x · blockDim.x">

一组人数相同的线程。组的编号是 `blockIdx.x`，每组的人数是 `blockDim.x`。组里每个线程的编号是 `threadIdx.x`。

</ConceptCard>

<ConceptCard :stage="S" term="网格" en="grid" code="gridDim.x">

一次启动派出的全部线程块。组数是 `gridDim.x`。

</ConceptCard>

<ConceptCard :stage="S" term="全局下标" code="i">

线程在整个网格里排第几。前面有 `blockIdx.x` 个完整的组，每组 `blockDim.x` 人，再加上自己在组里的位置。

</ConceptCard>

合在一起，就是几乎每个 kernel 开头都会出现的三行：

<LangCode>

<template #hip>

```cpp
__global__ void add(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;  // 我前面有多少人
    if (i < n) {                                    // 边界检查
        c[i] = a[i] + b[i];
    }
}

// 启动时：每组 256 人，组数向上取整
int blocks = (n + 256 - 1) / 256;
```

</template>

<template #python>

```python
@kernel
def add(a, b, c, n):
    i = blockIdx.x * blockDim.x + threadIdx.x  # 我前面有多少人
    if i < n:                                  # 边界检查
        c[i] = a[i] + b[i]

# 启动时：每组 256 人，组数向上取整
blocks = (n + 256 - 1) // 256
```

Python 写法是本书用来对照理解的教学写法。到了铸造城，会换成真实可运行的 Triton。

</template>

</LangCode>

工人比喻的边界：真实 GPU 上，各组不一定同时开工，也不一定按编号顺序开工。所以你的规则不能假设「第 0 组先做完」。

<DeepDive title="组数为什么写成 (n + 256 − 1) / 256？">

这是「向上取整」的整数写法。以 n = 10、每组 4 人为例：(10 + 3) / 4 = 13 / 4，整数相除得 3，正好是需要的组数。如果直接写 10 / 4，会得到 2，最后 2 个数就没人算了。

HIP 里两个整数相除，结果自动去掉小数部分；Python 里要用 `//` 才是整除，`/` 会得到小数。

至于为什么叫 `.x`：线程还可以按二维、三维编号，对应 `.y` 和 `.z`，处理图片、矩阵这类数据时会用到。后面的关卡再讲。

</DeepDive>

## 挑战：13 对数

现在换成 13 对数。每组人数、组数和拿数的规则都由你来定。

<LaunchLab
  :stage="S"
  id="lab-challenge"
  :n="13"
  :block-dim="4"
  :grid-dim="2"
  :grid-dim-max="8"
  formula=""
  :editable="['formula', 'blockDim', 'gridDim', 'guard']"
  :judge="judge"
  :alt-block-dims="[2, 4, 8]"
  :star-labels="STAR_LABELS"
  :hints="['先让 13 个数都有人算：组数够不够？规则对不对？', '多派出来的工人需要什么？代码里有一行可以加。']"
  :answer="ANSWER"
/>

## 支线：如果让 Agent 来做

Agent 看不到上面那张图。它只能读到运行结果，比如下面这份观察：

```json
{ "n": 13, "blockDim": 4, "gridDim": 4, "covered": 13, "duplicates": 0, "out_of_bounds_writes": 3 }
```

<Predict :stage="S" id="p-agent" question="换你当 Agent：读到这份观察，下一步该做什么？" :options="pAgent">

规则 Agent 也会这样选：它读到 `out_of_bounds_writes` 大于 0，就执行「加边界检查」这个动作。到了 1-10 关，你会亲手写出这样的规则。

</Predict>

## 你现在能……

- 根据数据个数和每组人数，算出至少要派几组
- 写出全局下标 `i = blockIdx.x * blockDim.x + threadIdx.x`，并说清它的意思
- 解释为什么几乎每个 kernel 都要加 `if (i < n)`

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

1-4「一起行动的小队」：每组里的工人还会再分成小队，同一时刻做同一件事（试点期间尚未开放）。

- 回到基础：[第 2 章 2.1 GPU 计算的基本流程](/part0-intro/chapter2/)
- 深入一层：[第 2 章 2.3 线程编号与数据索引](/part0-intro/chapter2/#_2-3-线程编号与数据索引)

<EvidenceCard kind="simulated">

本关的所有结果都由浏览器里的模拟器按代码逻辑算出，只回答「谁算了哪个数」，不涉及耗时。

</EvidenceCard>

<PilotLog :stage="S" :prediction-ids="predictionIds" />
