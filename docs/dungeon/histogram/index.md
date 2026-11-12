---
layout: dungeon
dungeon: dungeon-histogram
evidence: simulated
description: 一张 16 × 16 的小图，数每一档亮度各有几个像素。256 个线程抢着往 8 格里加：先用原子加一个不丢，再让每组在自己的货架上数好，最后只合并一次。
---

<script setup>
import { stageById } from '@course/outline.ts'
import HistSandbox from './scenes/HistSandbox.vue'
import PixelImage from './scenes/PixelImage.vue'
import { BLOCK_LEVELS, EXERCISE_ID, EXPECTED, FEWEST, LAUNCH, LEVELS, MERGE_CAP, PIXELS, SIDE, STAR_LABELS } from './challenge.ts'

// 关卡编号由大纲生成（04 第 1 节），正文里提到关卡时从大纲取。
const LDS = stageById('novice-lds-sync')
const REDUCTION = stageById('novice-reduction')
const GOAL = `派 ${LAUNCH.grid} 组、每组 ${LAUNCH.block} 个线程，数出每一档亮度各有几个像素：一个都不能丢，hist 前的队要短。`
// 像素最多的那一档：直接往 hist 上加时，它前面的队最长
const BUSIEST = EXPECTED.indexOf(Math.max(...EXPECTED))
</script>

# 直方图

下面是一张 {{ SIDE }} × {{ SIDE }} 的小图。每个像素的亮度已经分成 {{ LEVELS }} 档：0 最暗，{{ LEVELS - 1 }} 最亮。

<PixelImage />

数一数每一档各有几个像素，写进 hist[0]～hist[{{ LEVELS - 1 }}]。这 {{ LEVELS }} 个数就是这张图的直方图（histogram）：修图软件里那块起伏的图，画的就是它。

每个线程管一个像素：读出它的亮度 a[i]，给 hist 的这一格加 1。{{ PIXELS }} 个线程往 {{ LEVELS }} 格里加，同一格常有几十个线程要加。好几个线程同时改同一格，就是冲突。

这道题练第 {{ LDS.code }}、{{ REDUCTION.code }} 关的两件事：原子加，和车间里的货架。

<Mission :stage="EXERCISE_ID" :goal="GOAL" :stars="STAR_LABELS" />

## 挑战

补三个空：数之前货架清不清零，数一个像素时加在哪、怎么加，数完以后怎么合进 hist。两次同步已经写好了。

运行以后，下面画出 hist 的 {{ LEVELS }} 档，还有每组往 hist 的每一格原子加了几次（模拟）。没过不扣分：没过 2 次给方向，4 次给位置，6 次可以看答案。

<HistSandbox />

## 题解

<Solution>

每组先在自己的货架上数，数完只把数到的那几档合进 hist，每档一次。

<LangCode>
<template #hip>

```cpp
__global__ void histogram(int* a, int* hist, int n) {
    __shared__ int box[8];
    int t = threadIdx.x;
    int i = blockIdx.x * blockDim.x + t;
    if (t < 8) box[t] = 0;
    __syncthreads();
    if (i < n) atomicAdd(&box[a[i]], 1);
    __syncthreads();
    if (t < 8 && box[t] > 0) atomicAdd(&hist[t], box[t]);
}
```

</template>
<template #python>

```python
@kernel
def histogram(a, hist, n):
    box = shared(8, int)
    t = threadIdx.x
    i = blockIdx.x * blockDim.x + t
    if t < 8: box[t] = 0
    syncthreads()
    if i < n: atomic_add(box, a[i], 1)
    syncthreads()
    if t < 8 and box[t] > 0: atomic_add(hist, t, box[t])
```

</template>
</LangCode>

为什么这样写：

- **数的时候用原子加。** `+=` 要做三件事：读出这一格、加 1、写回去。同一支小队里，同一档的线程同时读到同一个旧值，写回去只留下一个。原子加把三件事一口气做完，同一格的线程一个一个来。
- **先在货架上数。** 直接往 hist 加，{{ PIXELS }} 个像素就在显存上排 {{ PIXELS }} 次队，hist[{{ BUSIEST }}] 一格前面就有 {{ EXPECTED[BUSIEST] }} 个。货架就在车间里，每组各数各的，最后每组每档只往 hist 加一次。
- **货架先清零，再同步。** 真卡上货架不会自己清零（第 {{ LDS.code }} 关）。清零以后同步，大家才开始数；数完再同步，前 {{ LEVELS }} 个线程才去合并。
- **只合并数到的档。** block 0 管的是天空，只有 {{ BLOCK_LEVELS[0].join('、') }} 两档。另外 {{ LEVELS - BLOCK_LEVELS[0].length }} 档的 box 是 0，加进 hist 也不变，用不着去排队。

三种写法，hist 前一共排几次队（模拟）：

| 写法 | hist 前排队 |
| --- | --- |
| 每个像素直接往 hist 原子加 | {{ PIXELS }} 次 |
| 先在货架上数，每组每档合并一次 | {{ MERGE_CAP }} 次 |
| 先在货架上数，只合并数到的档 | {{ FEWEST }} 次 |

<DeepDive title="出处：原子加和块内直方图">

- HIP 文档：原子函数是「读出、修改、写回」一次做完的操作；好几个线程对同一个位置做原子操作时，按不确定的先后一个一个来。原子操作既能用在共享内存（LDS）上，也能用在显存上（[Atomic functions](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html#atomic-functions)）。
- HIP 文档：`__shared__` 声明的变量，只有同一个线程块的线程能访问，寿命和这个线程块一样长（[`__shared__`](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html#shared)）。所以每组数好的数，要在这一组做完之前合进显存。
- rocPRIM 的 block_histogram 也把一组的直方图放在共享内存里：例子先用 init_histogram 把计数清零，同步，再往上加。它的 using_atomic 做法用原子加更新计数；文档的性能说明写着，很多线程同时更新同一个计数时，性能会下降（[rocPRIM Histogram](https://rocm.docs.amd.com/projects/rocPRIM/en/latest/block_ops/ops_classes/histogram.html)）。
- 「排队」只数原子加的次数，不算时间：排一次队要等多久，模拟器没有算。三种写法在 RX 9070 XT 上各用多久[待实测]。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 组一个接一个跑。所以合并时用普通加，模拟器里 {{ LAUNCH.grid }} 组的数都加上了，只记下数据竞争；真卡上几组同时跑，可能丢掉一组的数。
- 货架每组开始时是 0。所以不清零也碰巧数对；判定看的是有没有线程用了没清零的格子。
- 一支小队同一步往同一格普通地写，模拟器留下最后一个线程的；真卡上留下哪一个说不准。

</DeepDive>

</Solution>

<EvidenceCard kind="simulated">这道题的结果来自浏览器里的模拟器：hist 数对了没有、往 hist 原子加了几次、有没有数据竞争，都是模拟器照着你的代码跑出来的，不计时，也不是实测。组一个接一个跑、货架一开始是 0，是模拟器为了每次都看到同样的结果定的规则；真卡上几组同时跑，货架也不会自己清零。</EvidenceCard>
