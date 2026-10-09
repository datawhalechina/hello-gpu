# Hello GPU · Notebook 动手学习

在云环境中打开一章，读一段解释，看图理解线程与数据，修改 kernel，再运行并观察结果。这套 Notebook 参考 d2l 的组织方式：当前学习的算法留在章节中，重复的编译、计时、画图和记录放在公共包 `hello_gpu` 中。

当前提供 **Part 0–2 的 9 章（第 0–8 章）**。每章沿用对应教程的标题和小节顺序，按「解释 → 图 → 短代码 → 观察 → 练习」展开，每个章节目录只放一个 Notebook。

## 在已准备好的云环境中学习

选择平台提供的 **Python 3** 内核，打开下面的章节，从上到下运行即可。环境应已提供 ROCm 版 PyTorch、HIP 编译工具、Triton 及公共包的 Python 依赖；学习过程中无需重新安装环境或修改 GPU 架构。

第一段代码中的 `%run ../../common/bootstrap.py` 会加载仓库自带的 `hello_gpu` 源码。它不安装依赖，也不改变显卡或 SDK 配置。请保留 `notebooks/common/` 与章节的相对目录关系；单独下载一个 `.ipynb` 不包含这些公共工具。

修改代码后，可以用 **Restart Kernel and Run All Cells** 检查结果是否依赖此前留下的变量。首次运行 HIP 单元会编译，后续相同源码可以复用缓存。第 0 章的基础单元不要求 GPU，后续 GPU 实验要求当前 Python 内核能够访问 ROCm GPU。

## 章节入口

| 篇 | Notebook | 动手内容 |
| --- | --- | --- |
| Part 0：入门与硬件速通 | [第 0 章 写给读者的话](part0-intro/chapter0/chapter0.ipynb) | 认识学习路线、环境与实验记录 |
| Part 0：入门与硬件速通 | [第 1 章 环境准备](part0-intro/chapter1/chapter1.ipynb) | 检查当前 Python、GPU、PyTorch 与最小 HIP 计算 |
| Part 0：入门与硬件速通 | [第 2 章 编程模型与 wavefront 执行](part0-intro/chapter2/chapter2.ipynb) | 手算线程下标，用 kernel 检查边界与条件分支 |
| Part 0：入门与硬件速通 | [第 3 章 数据存储与访问](part0-intro/chapter3/chapter3.ipynb) | 跟踪地址、访问与 block 内共享同步 |
| Part 0：入门与硬件速通 | [第 4 章 第一个程序 + 性能分析](part0-intro/chapter4/chapter4.ipynb) | 写 HIP Vector Add，用 Tensor 调用、校验和测量 |
| Part 1：Profiling 实战 | [第 5 章 benchmark 与可信计时](part1-profiling/chapter5/chapter5.ipynb) | 比较单次 event 与批平均，保留计时样本 |
| Part 1：Profiling 实战 | [第 6 章 用 rocprof 找到慢在哪里](part1-profiling/chapter6/chapter6.ipynb) | 比较线程分工、采集 trace、扫描每线程工作量 |
| Part 1：Profiling 实战 | [第 7 章 读懂 Roofline 图](part1-profiling/chapter7/chapter7.ipynb) | 计算算法工作量，画当前测量与参考线 |
| Part 2：经典算子与 Kernel 实战 | [第 8 章 Element-Wise：逐元素算子](part2-kernels/chapter8/chapter8.ipynb) | 比较 HIP 与 Triton 的受控修改，记录负结果 |

章节与正文的映射保存在 [chapters.json](chapters.json)。想先体验完整流程，可以从第 4 章开始，再回到前面的线程与数据章节。

## 在 Notebook 中写 HIP

初始化公共工具后，HIP 单元只保留当前学习的函数：

```cpp
%%hip vector_add --entry vector_add
__global__ void vector_add(const float* a, const float* b, float* out, int n) {
    int64_t i = static_cast<int64_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (i < n) out[i] = a[i] + b[i];
}
```

随后直接传入 PyTorch Tensor：

```python
a = torch.randn(4097, device="cuda", dtype=torch.float32)
b = torch.randn_like(a)
c = vector_add(a, b, block=256)
torch.testing.assert_close(c, a + b)
```

`cuda` 是 ROCm 版 PyTorch 沿用的接口名称。公共包编译 HIP 源码，取得 Tensor 管理的显存地址，并在当前 PyTorch 设备和 stream 上启动 kernel。编译目标默认从当前 GPU 读取，不在章节源码中固定某个 `gfx` 架构。

当前调用约定是 `binary_f32`：两个同形状、连续的 FP32 GPU 输入，一个同形状输出，以及元素个数 `int n`。它负责前向计算，不自动推断任意 kernel 的输出形状，也没有提供 autograd 或 `torch.compile` 规则。

## 调整实验参数

输入规模、block 大小、预热次数和重复次数集中在 [config.toml](config.toml)。章节用 `gpu.settings()` 读取配置；修改后重新运行相关单元，让输入、正确性检查与测量使用同一组条件。

性能结果应结合当前硬件、软件版本与计时范围阅读。当前真实实验基线是 Radeon RX 9070 XT、ROCm 10.0、原生 Ubuntu 24.04；其他设备以自己的计算和测量结果为准。Roofline 微基准参考不等于硬件峰值，算法有效带宽也不等于物理显存流量。Profiler 是否可用需要单独检查，云环境提供 GPU 不自动保证开放性能计数器。

## 文件组织

```text
notebooks/
├── common/
│   ├── bootstrap.py                # 加载仓库中的公共包
│   ├── src/hello_gpu/              # HIP 编译、测量、图表与记录
│   └── tests/
├── part0-intro/chapter0–chapter4/   # 每章一个 Notebook
├── part1-profiling/chapter5–chapter7/
├── part2-kernels/chapter8/
├── assets/                         # 可编辑图源与 PNG 转换缓存
├── config.toml
├── chapters.json
└── tools/                          # 生成与维护入口
```

图片使用 PNG/JPEG 附件嵌入 Notebook。SVG 作为可编辑源文件保留，生成时转成 PNG；学习者打开 Notebook 不需要图片转换工具。图源变更后重新生成，需要作者安装 librsvg 提供的 `rsvg-convert`。

## 维护者入口

已预装依赖的学习环境无需执行本节。维护者需要自行准备 GPU 环境时，可以参考[正文第 1 章](../docs/part0-intro/chapter1/index.md)与[附录 B](../docs/appendix/appendix-b-switch-gpu/index.md)。现有环境配置工具支持按实际 GPU 架构安装 Part 0–2 的依赖；配置完成后可用 `tools/serve.sh` 启动 Jupyter，或用 `tools/connect.py` 建立连接。

生成源位于 `tools/build_part0.py`、`build_part1.py`、`build_part2.py`。修改这些文件后重新生成，避免下一次生成覆盖仅编辑过的输出文件。静态检查入口为：

```bash
python3 notebooks/tools/check_notebooks.py
```

真实 GPU 执行可以在已激活的对应环境中用 `tools/execute.py` 逐章完成。运行数据写入被 Git 忽略的 `.artifacts/`，不会写回公开 Notebook。静态 CI 不能替代 GPU 计算、计时与 profiler 的真实验证。
