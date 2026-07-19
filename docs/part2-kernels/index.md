---
title: "第 2 篇：经典算子与 Kernel 实战"
description: "从 Element-Wise 到 Fused RMSNorm，用 HIP 与 Triton 完成可复现的 Kernel 优化闭环"
---

# 第 2 篇：经典算子与 Kernel 实战

Part 1 已经教你量准时间、找到慢点并用 Roofline 选择排查方向。Part 2 开始把这些方法真正用在算子上：先固定数学语义和正确性，再提出瓶颈假设，分别沿 HIP 与 Triton 迭代，最后用同一份证据回答“改动有没有用”。

当前阶段已经完成第 7–12 章的第一版正文和配套教学代码。[第 7 章 Element-Wise](./chapter7/index.md) 还包含 RX 9070 XT 上的 curated evidence；第 8–12 章先提供可阅读、可运行的 HIP/Triton 路线，不填写尚未统一远端复测的性能数字。

## 这篇解决什么问题

读一个 kernel，不能只停在“代码能跑”。你需要把下面几件事连起来：

- 输出为什么可以这样拆给 GPU；
- 数据读写与计算量怎样形成成本模型；
- HIP 的 thread/block 和 Triton 的 program/tile 怎样表达同一语义；
- 正确性、benchmark 与 profiling 分别回答什么；
- 某次改动为什么变快、没变，甚至变慢；
- 结论在哪些 shape、dtype、硬件和软件版本下才成立。

Part 2 不把“优化技巧”整理成孤立清单，而是让六章依次引入新的依赖、复用与融合问题。读完时，你应该能独立完成一次有参考实现、有测量口径、有负结果、也能复跑的 kernel 优化记录。

## 开始前你需要会什么

开始前，建议先完成下面四个前置检查：

1. 能运行第 3 章的 Vector Add，并看懂 `blockIdx.x * blockDim.x + threadIdx.x` 如何得到全局下标。
2. 能按第 4 章的方法做 warmup、repeat、GPU event 计时，并明确 kernel-only 与端到端计时的边界。
3. 能按第 5 章用 kernel trace 找到目标 dispatch，读取 grid、workgroup 与资源字段。
4. 能按第 6 章从逻辑 FLOP、逻辑字节和实测时间建立成本模型；知道逻辑有效带宽不等于物理显存流量。

如果其中一项还不熟，先回到对应章节复跑最小实验。Part 2 不重复安装环境、可信计时和完整 Roofline 入门，只在每章给出与当前算子直接相关的口径。

## 六章怎样递进

学习顺序固定为 **Element-Wise → Reduction → Softmax → GEMM → Attention/Fusion → Fused RMSNorm**。每一章都复用前面已经验证的模式，再只增加一种新的难点。

| 顺序 | 章节 | 新增的核心问题 | 当前范围 |
| ----: | ---- | ---- | ---- |
| 1 | [第 7 章 Element-Wise：逐元素算子](./chapter7/index.md) | 输出彼此独立时，怎样划分下标、保持连续访问并处理尾部 | 完整正文与 curated evidence |
| 2 | [第 8 章 Reduction：归约算子](./chapter8/index.md) | 多个输入共同生成较少输出时，怎样做跨线程协作 | 第一版正文 + HIP/Triton |
| 3 | [第 9 章 Softmax（Normalization）](./chapter9/index.md) | 怎样把数值稳定的归约与逐元素计算组合起来 | 第一版正文 + HIP/Triton |
| 4 | [第 10 章 GEMM-Like：矩阵乘类算子](./chapter10/index.md) | 怎样用 tile、数据复用和寄存器累加提高计算强度 | 第一版正文 + HIP/Triton |
| 5 | [第 11 章 Attention/Fusion](./chapter11/index.md) | 怎样在线计算并减少中间结果的全局写回 | 第一版教学前向 + HIP/Triton |
| 6 | [第 12 章 综合实战：Fused RMSNorm](./chapter12/index.md) | 怎样综合逐元素、归约与融合，独立完成完整优化闭环 | 第一版正文 + HIP/Triton |

第 12 章不是突然出现的新技巧，而是一次结业题：数学语义来自 RMSNorm，数据依赖复用 Reduction，融合边界复用 Softmax 与 Attention/Fusion，实验记录则沿用前五章的统一契约。

## HIP 与 Triton 两条路线

两条路线面对的是同一道题，不是两套互不相干的课程。

| 路线 | 源码首先看见什么 | 适合重点观察什么 | 阅读方式 |
| ---- | ---- | ---- | ---- |
| HIP | thread、block、标量下标、显式加载类型 | 地址排列、wave/LDS、资源用量与底层控制 | 想理解硬件映射时优先 |
| Triton | program、tile offsets、mask、meta-parameter | 快速表达分块、参数实验与编译器生成映射 | 想快速验证算子设计时优先 |

可以只先走一条路线，但不要跳过公共部分：数学语义、正确性矩阵、计时范围与证据口径必须相同。做对照时也不预设谁是赢家；同一实现换一个 shape、dtype、编译器版本或系统状态，结论都可能变化。

## 每章统一实验闭环

六章统一采用下面的读者模板。它既是阅读顺序，也是你写实验记录时可以复用的检查表：

1. **白话动机**：先说这个算子解决什么问题，以及输出依赖关系怎样变化。
2. **数学与参考实现**：固定公式、dtype、shape、误差标准和裁判实现。
3. **成本模型与瓶颈假设**：数清逻辑 FLOP、逻辑字节、dispatch 和中间结果，提出可证伪假设。
4. **HIP ladder**：从最短正确 baseline 开始，每一版只引入一个主要机制。
5. **Triton ladder**：从最小 program/tile 开始，用受控参数实验扩展。
6. **正确性矩阵**：覆盖典型 shape、尾部、非整除长度、dtype 与必要的数值压力输入。
7. **Benchmark 与 Profiling**：先用统一口径计时，再用 trace 或计数器解释资源与执行变化。
8. **HIP/Triton 对照**：对齐数学语义、输入、计时边界和证据字段后再比较。
9. **负结果与适用边界**：保留没有提速、退化或证据不足的尝试，说明结论不能外推到哪里。
10. **复跑与练习**：给出从环境激活到证据产物的入口，再把模式迁移到一个小变体。

## 什么算完成

完成一章，不是“看懂最后一版代码”或“跑出一个更小的时间”。至少应留下：

- 参考实现与覆盖边界输入的正确性结果；
- 明确的硬件、软件、shape、dtype、warmup、repeat 和计时范围；
- baseline、每轮单变量改动及其假设；
- 能追溯到源文件的 benchmark/profile 证据；
- 至少一个负结果或适用边界；
- 可以由另一位读者执行的复跑命令与完成信号。

完成第 12 章后，可以把同一闭环迁移到陌生题目。LeetGPU 与其他平台只作为拓展练习入口：平台的题目约束、运行环境和排行榜口径需要单独核对，平台成绩不能替代本书实验机上的本地证据。

## 运行环境与证据入口

Part 2 当前发布证据的实验基线是 **Radeon RX 9070 XT（gfx1201）+ ROCm 7.13 + 原生 Ubuntu 24.04**。换硬件或软件版本时，可以复用方法，但必须重新采集结果，不能直接沿用正文数字。

当前可复跑入口集中在：

```text
code/part2-kernels/
├── activate-rocm.sh
├── chapter7/
│   ├── EXPERIMENT.md
│   ├── run_all.sh
│   ├── profile_all.sh
│   └── evidence/
├── chapter8/   # Reduction：HIP / Triton / run_all.sh
├── chapter9/   # Softmax：HIP / Triton / run_all.sh
├── chapter10/  # GEMM：HIP / Triton / run_all.sh
├── chapter11/  # Attention：HIP / Triton / run_all.sh
├── chapter12/  # RMSNorm：HIP / Triton / run_all.sh
└── tests/
```

第 7 章的发布表格只读取 `chapter7/evidence/` 中的 curated evidence；实验环境、参数、源码身份、负结果和复跑流程记录在 `chapter7/EXPERIMENT.md`。第 8–12 章可以分别执行各自的 `run_all.sh` 完成第一轮正确性和计时检查；在统一远端复测与证据整理完成前，正文只讲方法和运行入口，不发布性能排名。
