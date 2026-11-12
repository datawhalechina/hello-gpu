---
layout: stage
stage: novice-thread-groups
newTerms: [block, grid, global-index]
evidence: simulated
description: 数据一多，线程就要分组派出去：用 blockIdx.x、blockDim.x、threadIdx.x 算出每个线程的全局下标，再用边界检查管住多出来的线程。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import GroupLab from './scenes/GroupLab.vue'
import GroupSandbox from './scenes/GroupSandbox.vue'
import ChipBlocks from './scenes/ChipBlocks.vue'
import { CHALLENGE_N, STAGE_ID, STAR_LABELS } from './challenge.ts'

const S = STAGE_ID
const GOAL = `派出刚好够用的几组线程，把 ${CHALLENGE_N} 对数都加完，而且谁都不能写到数组外面。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const PANORAMA = stageById('novice-gpu-panorama')
const LATENCY = stageById('novice-latency-hiding')
const FIRST_AGENT = stageById('novice-first-agent')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
const CUS = HW.params.cuCount.value

// 四道先猜的 id 和选项顺序沿用试点关卡：读者在试点里锁定的预测，迁进正式存档以后
// （docs/course/progress.ts 的 migratePilot）按 id 和选项序号对上，这里直接显示成「已经猜过」。
const pGroups = [
  { label: '2 组', why: '2 组只有 8 个线程，还剩 2 对数没人算。' },
  { label: '3 组', correct: true, why: '3 组共 12 个线程，够用，还多出 2 个。' },
  { label: '4 组', why: '能算完，但多派了一整组：16 个线程，多出 6 个没有数可算。' },
  { label: '我不确定', why: '不确定也没关系：一组一组往上加，加到线程够 10 个为止。' },
]

const pCollide = [
  { label: '刚好每人一对，全部算完', why: '每一组都有一个排第 0 的线程，它们会去抢同一对数。' },
  { label: '前 4 对数被算了好几遍，后面的数没人算', correct: true, why: '每组的规则一模一样，所以每组都只会去拿第 0～3 对。' },
  { label: '程序报错停下来', why: 'GPU 不会因为这个报错，它会安静地给出错误的结果。这正是这类问题难查的原因。' },
  { label: '我不确定', why: '不确定也没关系，下面动手调一调。' },
]

const pOob = [
  { label: '它们什么都不做', why: '它们和别的线程照着同一张工作单做。工作单让它们写 c[i]，它们就会写。' },
  { label: '写到数组后面的内存里，可能弄坏别的数据', correct: true, why: '数组后面的内存可能存着别的数据，越界写会把它悄悄改掉。' },
  { label: 'GPU 会自动拦住', why: 'GPU 不检查数组有多长。写到哪里，完全由代码决定。' },
  { label: '我不确定', why: '不确定也没关系，下面开关边界检查看看。' },
]

const pAgent = [
  { label: '把组数调大，多派线程', why: '13 个数已经全部算对了。多派线程只会多出更多越界写。' },
  { label: '加上边界检查 if (i < n)', correct: true, why: '观察里唯一的问题是越界写，边界检查正好解决它。' },
  { label: '把每组线程数改小', why: '改每组线程数只是换一种派法：派少了有的数没人算，派多了照样越界。管住多出来的线程，要靠边界检查。' },
]

const checkpoint = [
  {
    q: '一张小图有 30 个像素，一个线程调亮一个像素，每组 8 个线程。至少要派几组？',
    options: [
      { label: '3 组', why: '3 组只有 24 个线程，还差 6 个像素没人调。' },
      { label: '4 组', correct: true, why: '4 组共 32 个线程，够用，多出 2 个。' },
      { label: '5 组', why: '能调完，但多派了一整组。' },
    ],
  },
  {
    q: '接上一题：如果不加边界检查，会有几个线程写到数组外面？',
    options: [
      { label: '0 个', why: '派出了 32 个线程，比 30 个像素多。' },
      { label: '2 个', correct: true, why: '32 − 30 = 2，也就是全局下标为 30 和 31 的两个线程。' },
      { label: '8 个', why: '多出来的不是一整组，只是最后一组里的 2 个线程。' },
    ],
  },
  {
    q: '还是每组 8 个线程。第 3 组（blockIdx.x = 3）里排第 5 的线程（threadIdx.x = 5），调亮下标是几的像素？',
    options: [
      { label: '8', why: '这是 3 + 5，少乘了每组的线程数。' },
      { label: '29', correct: true, why: '前面有 3 组、每组 8 个，共 24 个线程；再加上自己的 5，就是 29。' },
      { label: '15', why: '这是 3 × 5，把两个编号直接相乘了。' },
    ],
  },
]
</script>

# 1-4 线程分组

<div class="tg-hello">
  <Mascot class="tg-hello__art" :size="64" />
  <p class="tg-hello__line">数据一多，就得分组派线程了。</p>
</div>

第 {{ PREV.code }} 关只派了 1 组线程，组里的线程各认领一格。数据一多，线程就要分成很多组派出去。

可每组的 `threadIdx.x` 都从 0 数起，怎样让每个线程拿到不同的一格？多派出来的线程又该怎么办？

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

工坊城接到一张新单子：把两排数逐个相加，线程按组上岗，每组人数一样。挑战在后面，先弄清每个线程怎样找到自己那一格。

</Mission>

## 热身：要派几组？

线程按组派出去，每组的人数一样。现在有 10 对数，每组 4 个线程。

<Predict :stage="S" id="p-groups" question="10 对数，每组 4 个线程，至少要派几组？" :options="pGroups">

3 组共 12 个线程，比数据多 2 个。多出来的 2 个会做什么？先记着这个问题。

</Predict>

## 探索一：每个线程只知道两件事

线程上岗时只知道两件事：自己在第几组，和自己在组里排第几。在代码里，这两个编号叫 `blockIdx.x` 和 `threadIdx.x`。每组几个线程叫 `blockDim.x`，派了几组叫 `gridDim.x`。

上一关的工作单让每个线程按 `i = threadIdx.x` 拿数。线程分了组，还这样拿会怎样？

<Predict :stage="S" id="p-collide" question="如果每个线程都按 i = threadIdx.x 去拿数，会发生什么？" :options="pCollide">

动手看看。试着调一调每组几个线程、派几组，看问题会不会消失。

</Predict>

<GroupLab variant="collide" />

不管怎么调，后面的数始终没人算：每一组都在重复做前几对。问题不在人数，在于拿数的规则。

## 探索二：写出拿数的规则

要让每个线程拿到不同的一对数，它得先算出「我前面一共有多少个线程」。把沙盒里的 `i` 改对，再点「运行」。

<GroupSandbox part="rule" />

规则对了以后，换一换每组几个线程，再运行一次。规则照样成立，说明你没有把人数写死。

## 探索三：多出来的线程

<Predict :stage="S" id="p-oob" question="12 个线程，只有 10 对数。如果不管多出来的 2 个，它们会把结果写到哪里？" :options="pOob">

越界写不一定马上报错。它可能悄悄改掉别的数据，让程序在很远的地方出问题。

</Predict>

<GroupLab variant="guard" />

加上边界检查，多出来的 2 个线程发现 `i` 不小于 `n`，就什么都不做。这叫边界检查。

为什么不干脆只派 10 个线程？因为每组人数通常是固定的（真实程序里常用 256），数据个数却可以是任意数。所以派出的线程一般会多于数据，几乎每个 kernel 都要加边界检查。

## 原理：线程块、网格和全局下标

<ConceptCard term="block" code="blockIdx.x · blockDim.x">

这一关的每一组就是一个线程块。组的编号是 `blockIdx.x`，每组几个线程是 `blockDim.x`，组里每个线程的编号是 `threadIdx.x`。

</ConceptCard>

<ConceptCard term="grid" code="gridDim.x">

一次启动派出的那几组合起来，就是网格。派了几组是 `gridDim.x`。

</ConceptCard>

<ConceptCard term="global-index" code="blockIdx.x * blockDim.x + threadIdx.x">

前面有 `blockIdx.x` 个完整的组，每组 `blockDim.x` 个线程；再加上自己在组里的位置 `threadIdx.x`。

</ConceptCard>

合在一起，就是几乎每个 kernel 开头都会出现的两行：先算全局下标，再做边界检查。

<LangCode>
<template #hip>

```cpp
__global__ void add(float* a, float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;  // 我前面有多少个线程
    if (i < n) {                                    // 边界检查
        c[i] = a[i] + b[i];
    }
}
```

</template>
<template #python>

```python
@kernel
def add(a, b, c, n):
    i = blockIdx.x * blockDim.x + threadIdx.x  # 我前面有多少个线程
    if i < n:                                  # 边界检查
        c[i] = a[i] + b[i]
```

</template>
</LangCode>

启动时，每组几个线程先定好，组数跟着数据算：

<LangCode>
<template #hip>

```cpp
int threads = 256;                         // 每组 256 个线程
int blocks = (n + threads - 1) / threads;  // 组数向上取整
add<<<blocks, threads>>>(d_a, d_b, d_c, n);
```

</template>
<template #python>

```python
threads = 256                          # 每组 256 个线程
blocks = (n + threads - 1) // threads  # 组数向上取整
add[blocks, threads](d_a, d_b, d_c, n)
```

</template>
</LangCode>

<DeepDive title="组数为什么写成 (n + threads − 1) / threads？">

这是「向上取整」的整数写法。以 n = 10、每组 4 个线程为例：(10 + 3) / 4 = 13 / 4，整数相除得 3，正好是需要的组数。如果直接写 10 / 4，会得到 2，最后 2 个数就没人算了。

HIP 里两个整数相除，结果自动去掉小数部分；Python 里要用 `//` 才是整除，`/` 会得到小数。

</DeepDive>

分好的组派到哪里干活？还记得第 {{ PANORAMA.code }} 关的全景图吗：{{ HW.name }} 有 {{ CUS }} 个计算单元，也就是 {{ CUS }} 间车间。

一个线程块整组派给同一个计算单元，组里的线程不会拆开。一次启动的各组分到整颗芯片的计算单元上：组越多，忙起来的车间越多。

<ChipBlocks />

上一关只派 1 组，整颗芯片只有 1 间车间在忙。所以数据一多，就要派很多组，让整颗芯片都忙起来。

比喻的边界：画里一组占一间车间，摆得整整齐齐。真实 GPU 上，谁先开工由硬件安排，各组不一定同时开工，也不一定按编号顺序。所以你的规则不能假设「第 0 组先做完」。

<DeepDive title="车间是怎么分到组的？">

各组由驱动和硬件分到能用的计算单元上，先后顺序不确定，可能同时开工，也可能有先有后（[HIP 编程模型](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#inherent-thread-hierarchy-grid)）。一间车间也可能同时住下好几组，住得下几组，第 {{ LATENCY.code }} 关再讲。

严格地说，RDNA 上一个线程块的线程都在同一个 WGP 里执行。CU 模式下只用一个计算单元的流水线，WGP 模式下也可以用到同一个 WGP 里另一个计算单元的流水线（[LLVM AMDGPU 文档](https://llvm.org/docs/AMDGPUUsage.html#memory-model-gfx12)）。不管哪种，一组都不会拆到别的 WGP 去。

</DeepDive>

## 挑战：13 对数

现在换成 {{ CHALLENGE_N }} 对数。每组几个线程、派几组、拿数的规则和写入前的条件，都由你来定。

这是星级挑战：{{ CHALLENGE_N }} 个数都算对，拿第一颗星；没有任何线程写到数组外面，拿第二颗；派的组数最少，而且换成别的每组线程数代码照样对，拿第三颗。没过不扣分，没过两次以后会出现提示。

<GroupSandbox part="challenge" />

## 支线：如果让 Agent 来做

Agent 看不到上面那张图。它只能读到运行结果，比如下面这份观察：

```json
{ "n": 13, "blockDim": 4, "gridDim": 4, "covered": 13, "duplicates": 0, "out_of_bounds_writes": 3 }
```

<Predict :stage="S" id="p-agent" question="换你当 Agent：读到这份观察，下一步该做什么？" :options="pAgent">

按规则办事的 Agent 也会这样选：读到 `out_of_bounds_writes` 大于 0，就执行「加边界检查」这个动作。改完它再运行一次，读到的越界写变成 0，这一步就做完了。到了第 {{ FIRST_AGENT.code }} 关，你会亲手写出这样的规则。

</Predict>

## 你现在能……

- 根据数据个数和每组线程数，算出至少要派几组
- 写出全局下标 `i = blockIdx.x * blockDim.x + threadIdx.x`，并说清它的意思
- 解释为什么几乎每个 kernel 都要加 `if (i < n)`，并说出一个线程块整组派进同一个计算单元

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：一组线程进了车间，还会再分成小队，同一时刻做同一件事。

- 回到基础：[旧版第 2 章 2.3 线程编号与数据索引](/part0-intro/chapter2/#_2-3-线程编号与数据索引)，同样从组号和组内编号算出数组下标，再讲边界检查。
- 深入一层：[旧版第 2 章 2.4 线程分组与硬件执行单元](/part0-intro/chapter2/#_2-4-线程分组与硬件执行单元)，看一个线程块怎样落到 WGP 和计算单元上。

<EvidenceCard kind="simulated">这一关的结果来自浏览器里的模拟器：哪个线程写了哪一格、哪些格子没人算、有没有写到数组外面，都是它按你的代码跑出来的，不计时。{{ CUS }} 个计算单元出自 AMD 的产品规格页（出处写在第 {{ PANORAMA.code }} 关的全景图下面），不是实测；芯片上的分组图是示意，哪一组进哪个计算单元由硬件安排。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-3 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.tg-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.tg-hello__art {
  flex: none;
}

.tg-hello__line {
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
.hg-shell.is-plain .tg-hello__art {
  display: none;
}

.hg-shell.is-plain .tg-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
