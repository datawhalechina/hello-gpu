<h1 align="center"> Hello GPU ⚠️ Alpha内测版 </h1>

> [!CAUTION]
> ⚠️ Alpha内测版本警告：此为早期内部构建版本，尚不完整且可能存在错误，欢迎大家提Issue反馈问题或建议。

随着大模型和多模态模型快速发展，AI Infra 已经成为连接算法、系统与硬件的关键方向。很多学习者会使用模型、会调用框架，却不知道模型为什么跑得慢、瓶颈在哪里、应该如何优化。

本教程希望解决这个问题：
当你拿到一块 AMD GPU 时，如何从硬件出发理解它的执行方式，如何通过 profiling 找到性能瓶颈，如何优化算子和推理 pipeline，并最终构建一个 AI Agent，自动完成性能分析、优化建议、代码修改、benchmark 和报告生成。

本教程不是简单介绍工具，而是希望帮助读者建立 GPU 工程的核心思维：
**以硬件为起点，以 profiling 为证据，以优化为手段，以 Agent 自动化为终点。**

> Alpha 阶段所有实验默认以 **Radeon RX 9070 XT + ROCm 7.13 + 原生 Ubuntu 24.04** 为基线。其他 AMD GPU 可以参考方法论，但性能数字和工具可用性需要单独实测确认。

## 项目受众

- 想进入 AI Infra / AI 系统 / 推理优化 / 算子优化方向的学生和开发者
- 有 Python / Linux 基础，但对 GPU、ROCm、AI 编译器不熟悉的初学者
- 做过模型训练或部署，但不知道模型为什么跑得慢、怎么优化的工程师
- 想基于 AI Agent 自动完成 profiling、benchmark、代码调优和报告生成的开发者
- 希望了解 AMD GPU / ROCm 生态，而不是只学习 CUDA 体系的学习者

> 你不需要有 GPU 编程经验，但最好具备基础 Python、Linux 命令行和深度学习概念。

## 在线阅读

https://datawhalechina.github.io/hello-gpu/

## 目录

> 前言 + 4 篇正文，共 19 章。显示章号由 `docs/.vitepress/outline.mjs` 自动生成，新增章节后运行 `npm run docs:sync-outline` 即可同步 README 与站点导航。

| 章节名 | 简介 | 状态 |
| ---- | ---- | ---- |
| **第 0 篇：入门与硬件速通** | | |
| [第 0 章 写给读者的话](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part0-intro/chapter0/index.md) | 教程定位、为什么选 9070XT、和市面教程差异、学习路线 | 🚧 |
| [第 1 章 环境准备](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part0-intro/chapter1/index.md) | 9070XT + 原生 Ubuntu + ROCm 7.13 验证、Windows/WSL2 边界、uv 环境、最小 smoke test | 🚧 |
| [第 2 章 GPU 体系结构速通](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part0-intro/chapter2/index.md) | CU/Wavefront/LDS/寄存器/显存层次，RDNA4 视角，不讲 MFMA/CDNA/HBM | 🚧 |
| [第 3 章 第一个程序 + Roofline 心智模型](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part0-intro/chapter3/index.md) | vector add 跑通、建立性能上限直觉、benchmark 习惯 | 🚧 |
| **第 1 篇：Profiling 实战** | | |
| [第 4 章 benchmark 与可信计时](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part1-profiling/chapter4/index.md) | 热身、重复、GPU event、避免测量陷阱 | 🚧 |
| [第 5 章 用 rocprof 找到慢在哪里](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part1-profiling/chapter5/index.md) | 对照两个 vector add，只看 kernel 时间、工作划分和 stride 趋势 | 🚧 |
| [第 6 章 读懂 Roofline 图](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part1-profiling/chapter6/index.md) | 看懂参考线、生成工作点并选择排查方向 | 🚧 |
| **[第 2 篇：经典算子与 Kernel 实战](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part2-kernels/index.md)** | | |
| [第 7 章 Element-Wise：逐元素算子](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part2-kernels/chapter7/index.md) | 以 Vector Add 为例，分别用 HIP 深入理解访存，用 Triton 快速掌握 tile 编程 | 🚧 |
| [第 8 章 Reduction：归约算子](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part2-kernels/chapter8/index.md) | 以 Sum Reduction 为例，学习跨线程协作、LDS 与 Wave Shuffle | 🚧 |
| [第 9 章 Normalization：归一化算子](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part2-kernels/chapter9/index.md) | 以行级 Softmax 为例，学习数值稳定与逐元素/归约融合 | 🚧 |
| [第 10 章 GEMM-Like：矩阵乘类算子](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part2-kernels/chapter10/index.md) | 以 Matmul 为例，学习分块、数据复用与寄存器累加 | 🚧 |
| [第 11 章 Fusion：融合算子](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part2-kernels/chapter11/index.md) | 以 FlashAttention 为例，学习在线计算、减少中间写回与 IO-aware | 🚧 |
| [第 12 章 综合实战：Fused RMSNorm](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part2-kernels/chapter12/index.md) | 综合逐元素、归约与融合，独立完成一次可复现的 Kernel 优化闭环 | 🚧 |
| **第 3 篇：Agent（算子层）** | | |
| [第 13 章 Agent 入门](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part3-agent/chapter13/index.md) | 参考 hello-agents、LLM Agent 基本范式、工具调用 | 🚧 |
| [第 14 章 工具封装](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part3-agent/chapter14/index.md) | benchmark/profiling/编译包成 Agent 可调用工具 | 🚧 |
| [第 15 章 算子优化 Agent 设计](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part3-agent/chapter15/index.md) | 读题→生成 kernel→跑分→反思迭代 | 🚧 |
| [第 16 章 多轮优化实战](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part3-agent/chapter16/index.md) | Agent 把 naive kernel 优化 3-5x、失败回退、对比报告 | 🚧 |
| **第 4 篇：真实模型 + Agent** | | |
| [第 17 章 YOLO 部署 + Agent 自动优化](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part4-models-agent/chapter17/index.md) | ONNX/MIGraphX 部署、Agent profiling 找瓶颈、改配置/算子、对比 | 🚧 |
| [第 18 章 小模型 LLM 解码 + Agent 自动优化](https://github.com/datawhalechina/hello-gpu/blob/main/docs/part4-models-agent/chapter18/index.md) | Qwen 0.5B/1.8B 量化、decode 算子视角、Agent 优化 KV cache/精度 | 🚧 |

## 贡献者名单

| 姓名 | 职责 | 简介 |
| :---- | :---- | :---- |
| 刘伟鸿 | 项目负责人 | DataWhale成员 |

## 参与贡献

- 如果你发现了一些问题，可以提Issue进行反馈，如果提完没有人回复你可以联系[保姆团队](https://github.com/datawhalechina/DOPMC/blob/main/OP.md)的同学进行反馈跟进~
- 如果你想参与贡献本项目，可以提Pull Request，如果提完没有人回复你可以联系[保姆团队](https://github.com/datawhalechina/DOPMC/blob/main/OP.md)的同学进行反馈跟进~
- 如果你对 Datawhale 很感兴趣并想要发起一个新的项目，请按照[Datawhale开源项目指南](https://github.com/datawhalechina/DOPMC/blob/main/GUIDE.md)进行操作即可~

## 关注我们

<div align=center>
<p>扫描下方二维码关注公众号：Datawhale</p>
<img src="https://raw.githubusercontent.com/datawhalechina/pumpkin-book/master/res/qrcode.jpeg" width = "180" height = "180">
</div>

## LICENSE

<a rel="license" href="http://creativecommons.org/licenses/by-nc-sa/4.0/"><img alt="知识共享许可协议" style="border-width:0" src="https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey" /></a><br />本作品采用<a rel="license" href="http://creativecommons.org/licenses/by-nc-sa/4.0/">知识共享署名-非商业性使用-相同方式共享 4.0 国际许可协议</a>进行许可。
