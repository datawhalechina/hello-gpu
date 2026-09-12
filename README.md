<h1 align="center"> Hello GPU ⚠️ Alpha内测版 </h1>

<div align="center">

<a href="https://datawhalechina.github.io/hello-gpu/cloud/amd-radeon-cloud/"><img src="https://img.shields.io/badge/%E2%98%81%EF%B8%8F_AMD_Radeon_Cloud-%E4%BA%91%E7%AE%97%E5%8A%9B-00a3e0?logo=amd&logoColor=white&labelColor=1a1a1a" height="28"></a> | <a href="https://datawhalechina.github.io/hello-gpu/cloud/aup-learning-cloud/"><img src="https://img.shields.io/badge/%E2%98%81%EF%B8%8F_AUP_Learning_Cloud-%E7%AB%AF%E4%BE%A7%E7%AE%97%E5%8A%9B-00a3e0?logo=amd&logoColor=white&labelColor=1a1a1a" height="28"></a>

</div>

<p align="center">
  <img src="./docs/public/aup-logo.png" alt="AMD University Program" height="44">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="./docs/public/rocm-logo.png" alt="AMD ROCm" height="44">
</p>

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

> 全书共 5 篇、20 章。显示章号由 `docs/.vitepress/outline.mjs` 自动生成，新增章节后运行 `npm run docs:sync-outline` 即可同步 README 与站点导航。

| 章节名 | 简介 | 状态 |
| ---- | ---- | ---- |
| **第 0 篇：入门与硬件速通** | | |
| [第 0 章 写给读者的话](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part0-intro/chapter0/index.md) | 教程定位、为什么选 9070XT、和市面教程差异、学习路线 | 🚧 |
| [第 1 章 环境准备](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part0-intro/chapter1/index.md) | 9070XT + 原生 Ubuntu + ROCm 7.13 验证、Windows/WSL2 边界、uv 环境、最小 smoke test | 🚧 |
| [第 2 章 GPU 体系结构（上）：编程模型与 wavefront 执行](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part0-intro/chapter2/index.md) | 从数组加法出发，理解线程编号、工作分组、wavefront 执行与分支掩码 | ✅ |
| [第 3 章 GPU 体系结构（下）：片上资源与数据通路](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part0-intro/chapter3/index.md) | 跟着一次加法认识寄存器、缓存与 LDS，再理解合并访存和延迟隐藏 | ✅ |
| [第 4 章 第一个程序 + 性能分析](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part0-intro/chapter4/index.md) | 从向量加法出发，编写 HIP 程序、验证结果并学习 GPU 计时 | ✅ |
| **第 1 篇：Profiling 实战** | | |
| [第 5 章 benchmark 与可信计时](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part1-profiling/chapter5/index.md) | 从两种 event 计时方式理解预热、统计和有效带宽 | ✅ |
| [第 6 章 用 rocprof 找到慢在哪里](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part1-profiling/chapter6/index.md) | 运行向量加法、读懂 kernel trace，并设计公平对照 | ✅ |
| [第 7 章 读懂 Roofline 图](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part1-profiling/chapter7/index.md) | 从一次加法计算工作点，理解带宽与算力参考线 | ✅ |
| **[第 2 篇：经典算子与 Kernel 实战](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part2-kernels/index.md)** | | |
| [第 8 章 Element-Wise：逐元素算子](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part2-kernels/chapter8/index.md) | 从数组加法和下标动画出发，理解连续访存、线程循环、向量化尾部与 Triton mask | ✅ |
| [第 9 章 Reduction：归约算子](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part2-kernels/chapter9/index.md) | 用求和树与实际部分和理解 LDS 协作、全局竞争和多阶段归约 | ✅ |
| [第 10 章 Normalization：归一化算子](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part2-kernels/chapter10/index.md) | 用一行大分数理解稳定 Softmax、行内归约与中间数据融合 | ✅ |
| [第 11 章 GEMM-Like：矩阵乘类算子](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part2-kernels/chapter11/index.md) | 从小矩阵点积与复用动画出发，学习 HIP/Triton 分块、尾部和资源取舍 | ✅ |
| [第 12 章 Fusion：融合算子](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part2-kernels/chapter12/index.md) | 从 Attention 加权和推导在线 Softmax，用具体数值理解历史状态重缩放 | ✅ |
| [第 13 章 综合实战：Fused RMSNorm](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part2-kernels/chapter13/index.md) | 从平方和、行尺度与广播出发，综合归约、融合和可解释的参数实验 | ✅ |
| **第 3 篇：Agent（算子层）** | | |
| [第 14 章 Agent 入门](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part3-agent/chapter14/index.md) | 参考 hello-agents、LLM Agent 基本范式、工具调用 | ✅ |
| [第 15 章 工具封装](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part3-agent/chapter15/index.md) | compile/bench/profile 三件套 + accept_candidate | ✅ |
| [第 16 章 算子优化 Agent 设计](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part3-agent/chapter16/index.md) | 读题→compile/bench/profile→accept 迭代 | ✅ |
| [第 17 章 多轮优化实战](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part3-agent/chapter17/index.md) | vector_add 真实轨迹 ≈2.19×、失败回退、对比报告 | ✅ |
| **第 4 篇：真实模型 + Agent** | | |
| [第 18 章 YOLO 部署 + Agent 自动优化](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part4-models-agent/chapter18/index.md) | ONNX/MIGraphX 部署、Agent profiling 找瓶颈、改配置/算子、对比 | 🚧 |
| [第 19 章 小模型 LLM 解码 + Agent 自动优化](https://github.com/datawhalechina/hello-gpu/blob/dev/docs/part4-models-agent/chapter19/index.md) | LFM2.5-8B-A1B 量化（GGUF）、decode 算子视角、Agent 优化 KV cache/精度 | 🚧 |

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
