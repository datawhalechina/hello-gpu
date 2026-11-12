---
layout: hg
title: 外部练习题
description: LeetGPU、GPU MODE reference-kernels、GPU-Puzzles 上和本书各关对得上的练习题：按区域推荐，只链接原题，附几篇原创题解。
---

<script setup>
import ExternalIndex from '../../.vitepress/theme/v2/ExternalIndex.vue'
</script>

# 外部练习题

主线和副本之外还想多练，可以去别的题库找题。这一页按区域列出和本书各关对得上的外部题，每张卡片写着来源、许可证和关联关卡。

外部题只放链接：题名照原站写，题面不翻译、不改编、不复述。读题、写代码、交答案都在原站。标着「读原创题解」的题有我们自己写的题解，题目要求仍以原站为准。

怎么挑题、怎么交：

- 先学完卡片上的关联关卡再去做。卡住了，回那一关看看。
- 新手村的题：用 HIP 风格的，去 LeetGPU 写 CUDA，写法基本一样；用 Python 风格的，去 GPU-Puzzles，它用 Numba 写 kernel，在 Colab 上跑。
- 铸造城、试炼场的题：LeetGPU 和 GPU MODE 都在 NVIDIA GPU 上判题。Triton 代码接上原题要求的函数就能交；HIP 代码要改写成 CUDA，题解末尾写了改哪几处。
- GPU MODE 的题面和参考实现在 GitHub 的 reference-kernels 仓库里，提交在 gpumode.com 的排行榜上，排行榜的名字是 `vectorsum_v2` 这样的写法。

外部题不发经验值，做没做完只有原站知道。本站自己的练习题在[副本大厅](/dungeon/)，做完有经验值。

<ExternalIndex />
