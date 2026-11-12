---
layout: dungeon
dungeon: dungeon-transpose
evidence: simulated
description: 把 9 行 32 列的矩阵转置：用一维的线程编号算出行和列，再看读和写哪一侧要跨行。
---

<script setup>
import { stageById } from '@course/outline.ts'
import { SIM_PARAMS } from '@sim/params.ts'
import MatrixLayout from './scenes/MatrixLayout.vue'
import TransposeCompare from './scenes/TransposeCompare.vue'
import TransposeSandbox from './scenes/TransposeSandbox.vue'
import { CARS, COLS, EXERCISE_ID, LAUNCH, ROWS, SIZE, STAR_LABELS, THREADS, VARIANT_SHAPES, WAVE } from './challenge.ts'

// 关卡编号由大纲生成（04 第 1 节），正文里提到关卡时从大纲取。
const GROUPS = stageById('novice-thread-groups')
const COALESCING = stageById('novice-coalescing')
const LDS = stageById('novice-lds-sync')
const WIDE = VARIANT_SHAPES[0]
const GOAL = `派 ${LAUNCH.grid} 组、每组 ${LAUNCH.block} 个线程，把 ${ROWS} 行 ${COLS} 列的 a 转置进 b：每个数都搬到对的位置，谁都不能读写到 a、b 外面。`
</script>

# 矩阵转置

矩阵 a 有 R 行 C 列。转置就是行列互换：a 的第 r 行第 c 列，搬到 b 的第 c 行第 r 列。b 有 C 行 R 列。

显存里没有「行」：矩阵一行接一行，排成一个一维数组。下面是 2 行 3 列的小例子。

<MatrixLayout />

所以 a 的第 r 行第 c 列存在 a[r * C + c]。b 一行有 R 个数，它的第 c 行第 r 列存在 b[c * R + r]。

这道题的 a 有 {{ ROWS }} 行 {{ COLS }} 列，一共 {{ SIZE }} 个数，每个线程搬一个。线程先照第 {{ GROUPS.code }} 关算出编号 g，再用除法和取余换算成行 r、列 c。派 {{ LAUNCH.grid }} 组、每组 {{ LAUNCH.block }} 个线程，一共 {{ THREADS }} 个，比数多 {{ THREADS - SIZE }} 个。

<Mission :stage="EXERCISE_ID" :goal="GOAL" :stars="STAR_LABELS" />

## 挑战

补三个空：r、c 和写入前的条件。搬的那一行已经写好：`b[c * R + r] = a[r * C + c]`。

运行以后，访存视图写着小队每次读 a、写 b 搬了几车（模拟），车就是第 {{ COALESCING.code }} 关的车。没过不扣分：没过 2 次给方向，4 次给位置，6 次可以看答案。

<TransposeSandbox />

## 题解

<Solution>

第 g 个数在 a 的哪一行、哪一列？a 一行有 C 个数：g 前面有 g / C 整行，它在这一行排第 g % C 个。

<LangCode>
<template #hip>

```cpp
__global__ void transpose(float* a, float* b, int R, int C) {
    int g = blockIdx.x * blockDim.x + threadIdx.x;
    int r = g / C;   // a 的第几行
    int c = g % C;   // a 的第几列
    if (g < R * C) {
        b[c * R + r] = a[r * C + c];
    }
}
```

</template>
<template #python>

```python
@kernel
def transpose(a, b, R, C):
    g = blockIdx.x * blockDim.x + threadIdx.x
    r = g // C    # a 的第几行
    c = g % C     # a 的第几列
    if g < R * C:
        b[c * R + r] = a[r * C + c]
```

</template>
</LangCode>

为什么这样写：

- **除以列数 C，不是行数 R。** 一行有几个数，就除以几。写成 g / R、g % R，只有方阵才碰巧对：这道题 R = {{ ROWS }}，r 会算出 {{ ROWS }} 以上的数，可 a 只有 {{ ROWS }} 行。
- **条件看 g。** 编号 0～R × C − 1 正好一个线程一个数，多派的 {{ THREADS - SIZE }} 个线程编号从 {{ SIZE }} 起。不拦，它们算出 r = {{ ROWS }}，读到 a 外面，还把读到的数写进 b，盖掉放对的数。
- **R、C 都用参数。** 不写死 {{ ROWS }} 和 {{ COLS }}，换成 {{ WIDE.rows }} 行 {{ WIDE.cols }} 列的矩阵照样对。

### 读和写，哪一侧跨行

一支小队 {{ WAVE }} 个线程，编号挨着。上面的写法里，它们读的是 a 的同一行：a[0]～a[{{ WAVE - 1 }}]，正好一车。可 b 一行只有 {{ ROWS }} 个数，它们写 b 时隔 {{ ROWS }} 个写一个，{{ WAVE }} 个数散在 {{ CARS.across }} 车里（模拟）。

换一种排法，让第 g 个线程写 b[g]：r = g % R，c = g / R。写 b 挨着了，读 a 又要跨 {{ ROWS }} 行。下面切换两种排法，比一比。

<TransposeCompare />

两种排法一共都是 {{ CARS.total }} 车，理想 {{ CARS.ideal }} 车（模拟）。转置总有一侧要跨行：排好了读，写就跨行；排好了写，读就跨行。

想让两侧都挨着，得先把一块数放上车间的货架：整块顺着读上去，再从货架上换个方向取，顺着写出来。第 {{ LDS.code }} 关讲货架。

<DeepDive title="出处：转置的读和写">

- AMD ROCm Programming Guide 的转置教程：朴素的转置里，相邻线程按行读、按列写。读的地址挨着，能合并成少数几次搬运；写的地址隔着一整列的步长，合并不了，每个线程的写往往要单独搬一次（[Tiling and coalescing: matrix transpose](https://rocm-handbook.amd.com/projects/amd-rocm-programming-guide/en/latest/tutorial/hip-performance-optimization/tiling-matrix-transpose.html)）。
- 同一篇教程的改法：每组先把一块数顺着读进 LDS，同步以后，再从 LDS 里换个方向取、顺着写回显存，读和写就都能合并。
- 模拟器只数车，不模拟缓存：上一支小队搬来的车，不会留给下一支用。真卡上跨行读的那一侧，搬来的车可能还在缓存里。两种排法在 RX 9070 XT 上谁快[待实测]。

</DeepDive>

</Solution>

<EvidenceCard kind="simulated">这道题的车次来自浏览器里的模拟器：一车 {{ SIM_PARAMS.lineBytes }} 字节、一个数 {{ SIM_PARAMS.elemBytes }} 字节都是示意值，车次是模拟器照着代码一次一次数出来的，不计时，也不是实测。两种排法在真卡上谁快[待实测]。</EvidenceCard>
