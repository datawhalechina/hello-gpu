---
layout: dungeon
dungeon: dungeon-prefix-sum
evidence: simulated
description: 64 个零件，合格记 1。每个合格零件要知道自己排第几：从头数到它，一共几个合格。一组线程在货架上一轮一轮地加，每一轮都要等两次：放了再取要等，取了再放也要等。
---

<script setup>
import { stageById } from '@course/outline.ts'
import ScanSandbox from './scenes/ScanSandbox.vue'
import ScanSteps from './scenes/ScanSteps.vue'
import { BLOCK, EXERCISE_ID, STAR_LABELS, VARIANT_BLOCKS, WAVE, prefixOf, roundsFor, waitsFor } from './challenge.ts'

// 关卡编号由大纲生成（04 第 1 节），正文里提到关卡时从大纲取。
const LDS = stageById('novice-lds-sync')
const REDUCTION = stageById('novice-reduction')
const ROUNDS = roundsFor(BLOCK)
const WAITS = waitsFor(BLOCK)
// 每一轮取之前、取完放之前都等：每一轮三次
const WAITS_BOTH = 1 + 3 * ROUNDS
const TOTAL = prefixOf(BLOCK)[BLOCK - 1]
const [BIG, SMALL] = VARIANT_BLOCKS
const GOAL = `派 1 组 ${BLOCK} 个线程，算出 ${BLOCK} 个零件的前缀和：每一格都对，等的次数不多不少。`
</script>

# 前缀和入门

质检站查了一排 {{ BLOCK }} 个零件：合格记 1，不合格记 0，存在 a 里。合格的零件要一个挨一个装箱，每个合格零件得知道自己排第几。

第 i 个零件排第几，就是从第 0 个零件数到它，一共几个合格：out[i] = a[0] + a[1] + … + a[i]。这串数叫前缀和（prefix sum）。第 i 个零件合格，就装进箱子的第 out[i] − 1 格。

一个人从头加到尾，要一次接一次加 {{ BLOCK - 1 }} 次。第 {{ REDUCTION.code }} 关的求和树把 {{ BLOCK }} 个数 {{ ROUNDS }} 轮加成一个；这道题要的是 {{ BLOCK }} 个和，每个位置一个。

办法是：每个线程管一个零件，先把自己的数放上货架。第 1 轮，每一格加上左边隔 1 格的数；第 2 轮隔 2 格；第 3 轮隔 4 格……隔的格数每轮翻倍。下面是 8 个零件、3 轮的样子。

<ScanSteps />

每一轮之后，第 t 格都是它自己和左边几格的和，这一段每轮长一倍。{{ BLOCK }} 个零件，{{ ROUNDS }} 轮就够了。

<Mission :stage="EXERCISE_ID" :goal="GOAL" :stars="STAR_LABELS" />

## 挑战

工作单照上面的办法写好了：取（`v = box[t - s]`）和放（`box[t] += v`）两行是定的，放完以后的同步也写好了。

三个虚线框由你来改：循环走到哪为止，每一轮取之前等不等，取完、放之前等不等。一组 {{ BLOCK }} 个线程是两支小队，第 {{ LDS.code }} 关说过，两支小队各走各的。

没过不扣分：没过 2 次给方向，4 次给位置，6 次可以看答案。

<ScanSandbox />

## 题解

<Solution>

循环前后照工作单：放上自己那一格、同步；走完以后存进 out[t]。每一轮只在两个地方等：取完、放之前，放完、下一轮之前。

<LangCode>
<template #hip>

```cpp
int s = 1;
while (s < blockDim.x) {
    float v = 0;
    if (t >= s) v = box[t - s];   // 取
    __syncthreads();              // 等整组都取完
    box[t] += v;                  // 放
    __syncthreads();              // 等整组都放好
    s = s * 2;
}
```

</template>
<template #python>

```python
s = 1
while s < blockDim.x:
    v = 0.0
    if t >= s: v = box[t - s]     # 取
    syncthreads()                 # 等整组都取完
    box[t] += v                   # 放
    syncthreads()                 # 等整组都放好
    s = s * 2
```

</template>
</LangCode>

为什么这样写：

- **取完、放之前要等。** 线程 {{ WAVE }} 第 1 轮要取第 {{ WAVE - 1 }} 格，要的是这一轮之前的数。线程 {{ WAVE - 1 }} 在小队 0：不等，它可能已经把这一轮的和放上去了，线程 {{ WAVE }} 就取到加过的数。第 {{ LDS.code }} 关讲的是「放了再取要等」；这道题还多一条：「取了再放也要等」，你要改的格子，可能还有人没取。
- **取之前不用再等。** 上一轮最后已经等过一次：大家都放好了，才走到这一轮。第 1 轮之前，放上货架以后也等过了。多等一次，每支小队都要停下来，等最慢的那支。
- **终点写 blockDim.x。** 隔的格数翻到不小于每组的人数，左边的数就都加进来了。写死 {{ BLOCK }}，换成每组 {{ BIG }} 个线程只走 {{ ROUNDS }} 轮，第 {{ BLOCK }} 格起少加了前面的数；换成每组 {{ SMALL }} 个线程又多走一轮，整组白等两次。

每组 {{ BLOCK }} 个线程，三种等法（模拟）：

| 等法 | out | 每支小队等几次 |
| --- | --- | --- |
| 取之前等，取完不等 | 小队 1 取到加过的数，不对 | {{ WAITS }} 次 |
| 取之前等，取完也等 | 都对 | {{ WAITS_BOTH }} 次 |
| 只在取完、放之前等 | 都对 | {{ WAITS }} 次 |

等的次数一样多，等对了地方才算对。{{ BLOCK }} 个零件里一共 {{ TOTAL }} 个合格：out[{{ BLOCK - 1 }}] 就是 {{ TOTAL }}。

<DeepDive title="出处：同步和前缀和">

- HIP 文档：同步函数让一组线程都停在这里，直到所有线程都走到；`__syncthreads()` 同步的是一个线程块，同步之前写进共享内存的数，同步之后组里的线程都看得见（[Synchronization functions](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html#synchronization-functions)）。
- HIP 性能指南：每次同步，块里的线程都要停下来，等最慢的那个走到屏障；只在线程之间真要通过共享内存交换数据时同步（[Synchronization](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/performance_guidelines.html#synchronization)）。
- rocPRIM 的 block_scan：一组线程一起算前缀和的现成函数，有包含自己的 inclusive_scan 和不含自己的 exclusive_scan 两种（[rocPRIM Scan](https://rocm.docs.amd.com/projects/rocPRIM/en/latest/block_ops/ops_classes/scan.html)）。这道题算的是包含自己的那一种。
- 每轮隔的格数翻倍的加法，出自 Hillis 和 Steele 1986 年的论文《Data parallel algorithms》（Communications of the ACM 29(12)，[doi:10.1145/7902.7903](https://doi.org/10.1145/7902.7903)）。它一共做的加法比一个人从头加到尾多，换来的是轮数少。
- 「等几次」只数同步的次数，不算时间：每次同步要等多久，模拟器没有算。在 RX 9070 XT 上各用多久[待实测]。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 一组里的小队按编号轮流走：一支小队走到同步或者走完，才换下一支。所以取完不等时，每次都是小队 0 先放、小队 1 取到加过的数。真卡上几支小队交错着走，错在哪几格说不准。
- 同一支小队一起走，同一步里先读完再写，这一次碰巧取对；模拟器照样记数据竞争。判定看的是有没有数据竞争，不只看 out 对不对。
- 货架每组开始时是 0。这道题每一格都先放好再用，不受影响。

</DeepDive>

</Solution>

<EvidenceCard kind="simulated">这道题的结果来自浏览器里的模拟器：货架上每一格的数、out 对不对、几处数据竞争、每支小队等了几次，都是模拟器照着你的代码跑出来的，不计时，也不是实测。小队按编号轮流走、同一支小队先读完再写，是模拟器为了每次都看到同样的结果定的规则；真卡上先后不确定。</EvidenceCard>
