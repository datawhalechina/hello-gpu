---
layout: dungeon
dungeon: dungeon-vector-scale
evidence: simulated
description: 仓库里 200 个长度要从厘米换成毫米：每个数乘以 10，写回原来那一格。派出的线程比数多，下标和边界都得管住。
---

<script setup>
import { stageById } from '@course/outline.ts'
import ScaleSandbox from './scenes/ScaleSandbox.vue'
import { BLOCK, EXERCISE_ID, K, LAUNCH, N, STAR_LABELS, THREADS } from './challenge.ts'

// 关卡编号由大纲生成（04 第 1 节），正文里提到关卡时从大纲取。
const GROUPS = stageById('novice-thread-groups')
const GOAL = `派 ${LAUNCH.grid} 组、每组 ${BLOCK} 个线程，把 x 里的 ${N} 个数都乘以 ${K}、写回原处，谁都不能读写到 x 外面。`
</script>

# 向量缩放

仓库里存着 {{ N }} 个零件的长度，单位是厘米，放在数组 x 里。新图纸要用毫米：每个数乘以 {{ K }}，写回原来那一格。

每个线程管一格：读 x[i]，乘以 k，再写回 x[i]。线程按组派出去，每组 {{ BLOCK }} 个，派 {{ LAUNCH.grid }} 组，一共 {{ THREADS }} 个，比数多 {{ THREADS - N }} 个。

这道题练第 {{ GROUPS.code }} 关的两件事：算出自己的下标，拦住多出来的线程。不同的是这次原地改：同一格被两个线程碰到，就可能被乘两次。

<Mission :stage="EXERCISE_ID" :goal="GOAL" :stars="STAR_LABELS" />

## 挑战

补两个空：下标 i 和写入前的条件。运行以后，下面的机器人和格子画出每个线程乘了 x 的哪一格。

没过不扣分：没过 2 次给方向，4 次给位置，6 次可以看答案。

<ScaleSandbox />

## 题解

<Solution>

每个线程先算出自己在全体线程里排第几：前面各组一共 `blockIdx.x * blockDim.x` 个线程，再加上自己在组里的编号 `threadIdx.x`。排第几，就乘 x 的第几格。

<LangCode>
<template #hip>

```cpp
__global__ void scale(float* x, float k, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        x[i] = k * x[i];
    }
}
```

</template>
<template #python>

```python
@kernel
def scale(x, k, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        x[i] = k * x[i]
```

</template>
</LangCode>

为什么这样写：

- **每个线程的 i 都不一样。** 只用 `threadIdx.x` 时，{{ LAUNCH.grid }} 组都从 x[0] 乘起：x[0]～x[{{ BLOCK - 1 }}] 各被 {{ LAUNCH.grid }} 个线程碰到，后面 {{ N - BLOCK }} 个数没人乘。原地改的数，几个线程碰它，就可能被乘几次。
- **条件是 `i < n`，不是 `i <= n`。** x 的最后一格是 x[n − 1]。写成 `<=`，i 等于 n 的那个线程也进来了，读写到 x 外面一格。
- **读也在条件里面。** `x[i] = k * x[i]` 先读后写，条件包住这一行，读和写一起拦住。真卡上读到外面，可能读到不相干的数；写到外面，可能悄悄改掉别的数据。
- **不写死 {{ BLOCK }} 和 {{ N }}。** 每组几个线程用 `blockDim.x`，一共几个数用 `n`。换一种派法、换一批数，同一份代码照样对。

组数也跟着 n 变：每组 {{ BLOCK }} 个线程时，派 ⌈n ÷ {{ BLOCK }}⌉ 组。最后一组多出来的线程，正好交给 `i < n` 拦住。

<DeepDive title="出处：原地缩放">

rocBLAS 的 scal 函数做的就是这件事：把向量 x 的每个元素乘以 alpha，结果写回 x（x := alpha * x），x 既是输入也是输出（[rocBLAS Level-1 functions](https://rocm.docs.amd.com/projects/rocBLAS/en/latest/reference/level-1.html#rocblas-scal)）。它还多一个参数 incx，表示隔几个元素取一个；这道题相当于 incx = 1。

</DeepDive>

</Solution>

<EvidenceCard kind="simulated">这道题的结果来自浏览器里的模拟器：哪个线程乘了哪一格、有没有读写到 x 外面，都是它按你的代码跑出来的，不计时。一格被乘了几次，是模拟器让这些线程一个接一个跑出来的；真卡上它们的先后说不准，乘几次也说不准。</EvidenceCard>
