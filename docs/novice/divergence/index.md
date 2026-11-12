---
layout: stage
stage: novice-divergence
newTerms: [branch-divergence, exec-mask]
evidence: simulated
description: 小队走到 if/else 的岔路口，有人往左、有人往右，口令却只有一个：两边只能先后各走一遍。改写分支条件，看谁在空转，再把两种活派得一个空转的 lane 都没有。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import ForkStepper from './scenes/ForkStepper.vue'
import ForkSandbox from './scenes/ForkSandbox.vue'
import { CHALLENGE_N, STAGE_ID, STAR_LABELS, WIDE_N } from './challenge.ts'

const S = STAGE_ID
const GOAL = `派 ${2 * CHALLENGE_N} 个线程，把 ${CHALLENGE_N} 个和、${CHALLENGE_N} 个差都算对，而且每支小队都只走岔路口的一边。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const GROUPS = stageById('novice-thread-groups')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
const LANES = HW.params.lanesPerSimd.value
const ARCH = HW.params.arch.value

const pFork = [
  { label: '两拨同时走，各做各的', why: `一条流水线一次只发一个口令（第 ${PREV.code} 关）。加法和减法是两个口令，不能同时发。` },
  { label: '先陪一拨走完，再陪另一拨走', correct: true, why: '两边先后各走一遍。走一边的时候，另一拨的 16 个 lane 原地空转。' },
  { label: '只走加法那一边，做减法的不管了', why: '那样差就没人算了。两边都要走，只是一边一边地走。' },
  { label: '我不确定', why: '不确定也没关系，下面一步一步走给你看。' },
]

const pHalf = [
  { label: '会：一半做加法、一半做减法，还是分成了两拨', why: '按整组看是分成了两拨，可每支小队里的线程意见一致：第 0 支全做加法，第 1 支全做减法。' },
  { label: '不会：每支小队都只走一边', correct: true, why: 't = 0～31 正好是第 0 支，32～63 正好是第 1 支。每支小队整队走一边，另一边整段跳过。' },
  { label: '我不确定', why: '不确定也没关系，下面的沙盒里改一改、跑一跑。' },
]

const checkpoint = [
  {
    q: '一组派 64 个线程，32 人一队，条件是 t < 40。哪几支小队会在岔路口分成两拨？',
    options: [
      { label: '第 0 支和第 1 支都会', why: '第 0 支是 t = 0～31，全都小于 40，整队走 if 那一边，不分岔。' },
      { label: '只有第 1 支', correct: true, why: '第 1 支是 t = 32～63：32～39 这 8 个走 if，40～63 这 24 个走 else，两段都要走。' },
      { label: '都不会', why: '第 1 支里有的 t 小于 40、有的不小于，意见不一致，就会分岔。' },
    ],
  },
  {
    q: '派 4 组，每组 64 个线程，32 人一队。哪个条件一定不会让小队分岔？',
    options: [
      { label: 'threadIdx.x % 2 == 0', why: '相邻的两个线程一个成立、一个不成立，每支小队都分成两拨。' },
      { label: 'blockIdx.x % 2 == 0', correct: true, why: `同一组线程的 blockIdx.x 都一样，一支小队又不会跨组（第 ${PREV.code} 关），整队的意见一定一致。` },
      { label: 'threadIdx.x < 20', why: '每组的第 0 支小队里，0～19 成立、20～31 不成立，会分岔。' },
    ],
  },
  {
    q: '一支小队走到 if/else：if 那一段 5 行，else 那一段 3 行，两边都有人要走。按模拟器一行一步算，走完这两段要几步？',
    options: [
      { label: '5 步：两段同时走，按长的那段算', why: '口令只有一个，两段不能同时走。' },
      { label: '8 步', correct: true, why: '两段先后各走一遍：5 + 3 = 8 步。整队只走一边时，只要 5 步或者 3 步。' },
      { label: '3 步：按短的那段算', why: '短的那段走完，另一拨还没走，得接着走完长的那段。' },
    ],
  },
]
</script>

# 1-6 分岔路口

<div class="dv-hello">
  <Mascot class="dv-hello__art" :size="64" />
  <p class="dv-hello__line">小队走到岔路口了：有人要往左，有人要往右。</p>
</div>

第 {{ PREV.code }} 关的小队，每一步都整队走同一行。一个口令，{{ LANES }} 个线程一起照做。

可工作单里常有 `if`。同一支小队里，有的线程条件成立，有的不成立。口令只有一个，先喊哪一边？

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

这一关的工作单有两种活：做加法，或者做减法。你来改写分支条件，决定哪些线程走哪一边。

</Mission>

## 热身：两边能一起走吗？

先看一张有岔路口的工作单。t 是第 {{ GROUPS.code }} 关的全局下标（那时叫 i）：t 是偶数的线程把和写进 c，奇数的把差写进 d。

<LangCode>
<template #hip>

```cpp
__global__ void add_sub(float* a, float* b, float* c, float* d) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    if (t % 2 == 0) {
        c[t] = a[t] + b[t];
    } else {
        d[t] = a[t] - b[t];
    }
}
```

</template>
<template #python>

```python
@kernel
def add_sub(a, b, c, d):
    t = blockIdx.x * blockDim.x + threadIdx.x
    if t % 2 == 0:
        c[t] = a[t] + b[t]
    else:
        d[t] = a[t] - b[t]
```

</template>
</LangCode>

<Predict :stage="S" id="dv-p-fork" question="一支 32 人的小队走到这个 if：16 个线程要做加法，16 个要做减法。会怎样？" :options="pFork">

下面的单步执行器派的就是这样一支小队。一步一步走，看两边是怎么走完的。

</Predict>

## 探索一：两拨先后走

下面派 1 组 32 个线程，正好一支小队。点「下一步」，看两处：代码里亮起的那一行，和 lane 格子里哪几格在干活。

<ForkStepper />

一共 4 步。第 3 步只有偶数号的 16 个 lane 做加法，奇数号的 16 个原地空转；第 4 步反过来。两边都要走，只能一边一边地走。

每一步 lane 格子下面那串 1 和 0，记的是这一步谁在干活：1 干活，0 空转。

模拟器把这种浪费算成 lane 利用率：每一步干活的 lane 加起来，除以每一步的全部 lane。这支小队走了 4 步，每步 32 个 lane，一共 128 个；干活的是 32 + 32 + 16 + 16 = 96 个，利用率 75%（模拟）。

## 探索二：把岔路口挪到两支小队中间

现在派 1 组 64 个线程，排成 2 支小队：t = 0～31 是第 0 支，32～63 是第 1 支。工作单不变，条件由你来改。

<Predict :stage="S" id="dv-p-half" question="条件改成 t < 32：前 32 个线程做加法，后 32 个做减法。还会有小队在岔路口分成两拨吗？" :options="pHalf">

下面的沙盒可以改条件。先跑一遍 `t % 2 == 0`，再换成 `t < 32`、`t < 48` 试试。

</Predict>

<ForkSandbox part="fork" />

分不分岔，看同一支小队里的线程意见一不一致。`t < 32` 把整组分成了两拨，可每支小队都整队走一边，另一边整段跳过，利用率 100%（模拟）。

换成 `t < 48`，第 1 支里 16 个做加法、16 个做减法，又分岔了，利用率降到 85.7%（模拟）。不同的小队各走各的路，谁也不用等谁。

## 原理：分支发散和执行掩码

同一支小队的线程走进 if 的不同分支，这件事叫分支发散。记下每一步谁在干活的那串 1 和 0，叫执行掩码。

<ConceptCard term="branch-divergence" code="if (t % 2 == 0)">

探索里的 `t % 2 == 0` 让每支小队都分成两拨：先走加法那一段，再走减法那一段，每一段都有一半 lane 空转。

</ConceptCard>

<ConceptCard term="exec-mask" code="EXEC">

探索里每一步下面那串 1 和 0 就是它。加法那一步是 10101010…，减法那一步反过来，是 01010101…。

</ConceptCard>

为什么不能两边同时走？SIMD 一次只发一条指令（第 {{ PREV.code }} 关），跳转也是整个 wave 一起跳，不能只让几个 lane 跳走。

所以 wave 走到 if/else，先让条件成立的 lane 走 if 那一段，再让剩下的 lane 走 else 那一段。两段都走完，大家在 if/else 后面汇合，接着一起往下走。

落到硬件上：{{ ARCH }}（{{ HW.name }} 的架构）的每个 wave 都有一个执行掩码，指令集手册里叫 EXEC。wave32 用其中 32 位，一个 lane 一位。

位是 1 的 lane 执行这条指令，是 0 的把它当成空操作。整个 wave 都是 0 的那一段，可以整段跳过。

想不浪费，就让同一个 wave 的线程走同一边：按 wave 的边界分活（`t < 32`），不按单双号分（`t % 2 == 0`）。

条件也可能看数据，比如 `if (a[t] > 0)`。这时分不分岔，要看一个 wave 读到的数：全是正数不分岔，有正有负就分岔。

<DeepDive title="出处：执行掩码和分支">

- {{ ARCH }} 的 if/else、跳转和循环，由管整个 wave 的标量指令处理。每个 wave 有一个执行掩码，标出这一刻哪些线程在干活：干活的线程执行这条指令，其余的当成空操作（[RDNA4 指令集手册](https://gpuopen.com/download/rdna4-instruction-set-architecture.pdf) 1.2 节）。
- 执行掩码一位对应一个线程，1 执行、0 不执行；wave32 只用低 32 位。整个掩码是 0 时，可以靠它跳过一段代码（同一手册 3.2.2 节）。
- 跳转作用在整个 wave 上，不是单个线程（同一手册 5.5 节）。
- HIP 文档：线程因为分支走了不同的路时，运算单元照样处理整个 wave，只是那些线程的结果被掩掉，这些运算周期就浪费了（[HIP 文档：CPU 和 GPU 的硬件差别](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#hardware-differences-cpu-vs-gpu)）。
- 旧版第 9 章看过真实的编译产物：分支前后能看到执行掩码的设置与恢复（[9.4.3 节](/part2-kernels/chapter9/#reduction-divergence)）。

</DeepDive>

<DeepDive title="lane 利用率怎么算">

一步里，干活的 lane 数 ÷ 小队大小，就是这一步的利用率。整段把所有步加起来：干活的 lane 加起来，除以步数 × 小队大小。

判断条件那一步也算一步：这一步整队都在判断。坐不满的小队里，没有线程的 lane 也算没干活（第 {{ PREV.code }} 关）。

探索二的 `t < 16`：第 0 支分岔走 4 步，第 1 支整队走 3 步，一共 7 步、224 个 lane，干活的 192 个，利用率 85.7%。这是模拟器数出来的，不是硬件计数器，也不是耗时。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

模拟器把一行代码算一步。真实的一行会编译成好几条指令，每一段有几条、要不要跳转，由编译器决定，所以利用率只是示意。

利用率高了，真卡上也不一定更快。旧版第 9 章实测过求和：把做加法的线程挤到前几个 wave，第一阶段并没有变快（见下面「深入一层」）。

</DeepDive>

比喻的边界：岔路口的两拨人，看起来像分成了两支小队。其实还是同一支小队、同一条流水线：两段走完，大家在岔路口后面汇合，接着一起走下一行。

## 挑战：两种活

现在 c、d 各只有 {{ CHALLENGE_N }} 格：{{ CHALLENGE_N }} 个和、{{ CHALLENGE_N }} 个差，一格都不能少。派 1 组 {{ 2 * CHALLENGE_N }} 个线程，一个线程算一格。

工作单多了一个空 k：这个线程算第几格。条件决定谁做加法，k 决定算哪一格。

这是星级挑战：{{ CHALLENGE_N }} 个和、{{ CHALLENGE_N }} 个差都算对，拿第一颗星；没有一支小队在岔路口分成两拨，拿第二颗；换成 {{ WIDE_N }} 个和、{{ WIDE_N }} 个差（派 {{ 2 * WIDE_N }} 个线程），同一份代码照样算对、照样不分岔，拿第三颗。没过不扣分，没过两次以后会出现提示。

<ForkSandbox part="challenge" />

## 你现在能……

- 说出 if/else 把一个 wave 分成两拨时会怎样：两段先后各走一遍，走一段时另一拨的 lane 空转
- 读懂执行掩码：1 的 lane 干活，0 的空转；整个 wave 都是 0 的那一段整段跳过
- 改写分支条件，让同一个 wave 的线程走同一边：岔路口落在 wave 的交界上，算第几格的 k 跟着改

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：小队算得再整齐，也得先拿到数。数放在哪里？离车间有多远？

- 回到基础：[旧版第 2 章 2.3.3 数组边界检查](/part0-intro/chapter2/#_2-3-3-数组边界检查)，`if (idx < n)` 让多出来的线程跳过读写。它也是一个岔路口，只在最后一个 wave 里可能分岔。
- 深入一层：[旧版第 9 章 9.4.3 求和树与线程分工](/part2-kernels/chapter9/#reduction-divergence)，真卡上实测求和里的分支发散：把做加法的线程挤到前几个 wave 以后，第一阶段并没有变快。

<EvidenceCard kind="simulated">这一关的结果来自浏览器里的模拟器：每一步哪些 lane 在干活、走了几步、lane 利用率多少，都是它按工作单跑出来的，不计时。模拟器把一行代码算一步，真机上一行会编译成好几条指令（见上面的「模拟器简化了什么？」）。执行掩码一个 lane 一位、整个 wave 是 0 时可以跳过，出自 AMD 的 RDNA4 指令集手册；分支发散浪费运算周期，出自 HIP 文档；都不是实测。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-5 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.dv-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.dv-hello__art {
  flex: none;
}

.dv-hello__line {
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
.hg-shell.is-plain .dv-hello__art {
  display: none;
}

.hg-shell.is-plain .dv-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
