---
title: "附录 A · 环境安装细节与常见坑"
description: "Hello GPU 附录 · 本篇环境文件是怎么来的、ROCm 10.0 设备 extras 与依赖源、rocm-sdk init 的坑"
---

# 附录 A · 环境安装细节与常见坑

## 本附录导读

> [第 1 章 环境准备](../../part0-intro/chapter1/index.md) 的主线内容只要求你会跑 `uv sync` 和几个验证命令。但很多读者还会想知道——**这套环境文件到底是怎么来的？**本附录就从这个问题出发，按步骤拆开本篇环境的生成过程，顺便把几个反复出现的坑提前指出来。

如果你使用的 GPU 与教程不同，如何在 ROCm 10.0 环境中选择对应架构的设备包，可以接着看 [附录 B · 换一张卡](../appendix-b-switch-gpu/index.md)。

## A.1 用脚本生成本篇初始环境

从零准备一篇新内容时，一条命令就能生成这一篇自己的 uv 环境文件：

```bash
bash scripts/bootstrap-rocm-env.sh --part part0-intro
```

> 当前脚本默认使用 **ROCm 10.0.0 + Python 3.12 + `device-gfx1201`**，从 AMD 的统一 wheel 源安装。它会保留本篇其他依赖，并让 `uv sync` 更新已有的 `uv.lock`。

这个脚本会在 `code/part0-intro/` 下准备好三类文件：

```text
code/part0-intro/
├── pyproject.toml
├── uv.lock
└── activate-rocm.sh
```

各司其职：

| 文件 | 作用 |
| ---- | ---- |
| `pyproject.toml` | 写清楚本篇需要哪些 Python / ROCm 包 |
| `uv.lock` | 锁定实际解析出来的包版本，保证复现 |
| `activate-rocm.sh` | 激活 `.venv`，并设置 `ROCM_PATH` / `HIP_PATH` 等环境变量 |

## A.2 同一个下载源，靠 extras 选择显卡

ROCm 10.0 的 wheel 都从 `https://stable.repo.amd.com/rocm/whl-next/` 下载。我们不用按显卡更换下载地址，只要在依赖后面的方括号里写上架构：

```toml
"torch[device-gfx1201]==2.13.0+rocm10.0.0",
"torchvision[device-gfx1201]==0.28.0+rocm10.0.0",
"torchaudio==2.11.0.2+rocm10.0.0",
"rocm[devel,device-gfx1201]==10.0.0",
```

可以把 extras 理解成给安装器的备注：**我要这套软件，再带上这张卡需要的设备包**。`devel` 则表示我们还要编译 HIP 程序所需的开发文件。至于底下的 `rocm-sdk-core`、设备库和 Triton，由这些包的依赖声明带进来，读者不用逐个找包名。

下载源的配置如下，完整文件见 [附录 B 的配置示例](../appendix-b-switch-gpu/index.md#b-3-第三步-先改配置-再安装)：

```toml
[[tool.uv.index]]
name = "rocm-amd"
url = "https://stable.repo.amd.com/rocm/whl-next/"

[[tool.uv.index]]
name = "pypi-mirror"
url = "https://mirrors.bfsu.edu.cn/pypi/web/simple"
default = true

[tool.uv.sources]
torch = { index = "rocm-amd" }
torchvision = { index = "rocm-amd" }
torchaudio = { index = "rocm-amd" }
rocm = { index = "rocm-amd" }
```

这里的 AMD 源**不加 `explicit = true`**。四个直接依赖已指定来源，它们自动带进来的 SDK 与设备包也需要能在 AMD 源里被找到。若把 AMD 源限制为仅供显式映射使用，就容易遇到「找不到 `rocm-sdk-core==10.0.0`」这类解析错误。保留上面的写法即可，不用自己维护一长串底层包。

## A.3 `rocm-sdk init` 和 `ROCM_PATH` 的坑

这是本篇里**最容易让人栽跟头的一个坑**，单独拎出来讲透。

`rocm-sdk-devel` 装完之后，devel 的内容并不会自动展开——需要手动（或通过脚本）把它展开到 `_rocm_sdk_devel` 目录里，HIP 编译器才能找到 ROCm device library。

本篇的 `activate-rocm.sh` 已经替你处理了这一步。所以正常情况下，你只需要两条命令：

```bash
uv sync
source ./activate-rocm.sh
```

脚本会先执行 `rocm-sdk init --quiet`，再通过 `rocm-sdk path --root` 取得 SDK 路径，设置当前 shell 的 `ROCM_PATH` / `HIP_PATH`。每次激活都会刷新设备文件链接，所以换过架构、重新 `uv sync` 后，也要重新激活一次。

但如果你在没有用新版 `activate-rocm.sh` 的情况下手动操作，就很容易掉进下面这个陷阱——`rocm-sdk init` 把 devel 文件展开出来了，但**不会回头刷新当前 shell 里已经设好的 `ROCM_PATH` / `HIP_PATH`**，于是 `hipcc` 还在用旧路径，报出：

```text
clang++: error: cannot find ROCm device library; provide its path via '--rocm-path' or '--rocm-device-lib-path'
```

修复方法出奇简单——把脚本重新 source 一次就行：

```bash
source ./activate-rocm.sh
```

正确状态应该是看到 `ROCM_PATH=.../_rocm_sdk_devel` 而不是 `_rocm_sdk_core`。

## A.4 系统开发头文件：Triton JIT 需要 `Python.h`

`uv sync` 只能安装 Python wheel 依赖，不能替系统安装 C/C++ 编译器和 Python 开发头文件。Triton 第一次启动 kernel 时会 JIT 编译一小段 native helper，如果实验机缺 `Python.h`，会报类似错误：

```text
fatal error: Python.h: No such file or directory
```

这不是 Triton kernel 写错了，而是原生 Ubuntu 最小安装缺系统开发包。实验机初始化时请先装齐：

```bash
sudo apt update
sudo apt install -y build-essential libstdc++-14-dev python3-dev
```

验证：

```bash
which g++
ls /usr/include/c++/14/cstdlib
ls /usr/include/python3.12/Python.h
```

如果你给 uv 指定了非系统默认 Python 小版本，再额外安装对应的开发包，例如 `python3.12-dev`。本仓库的 `scripts/bootstrap-rocm-env.sh` 会在 bootstrap 时检查这些依赖；章节脚本（例如第 5 章 `bench_ch4.py`）也会在进入 Triton JIT 前给出同样的修复提示。

## 延伸阅读

- [uv Documentation](https://docs.astral.sh/uv/)
- [AMD ROCm Documentation](https://rocm.docs.amd.com/)
- [AMD ROCm 10.0 wheel 源](https://stable.repo.amd.com/rocm/whl-next/)
- [ROCm 10.0 安装说明](https://rocm.docs.amd.com/en/docs-10.0.0/install/rocm.html)
- [TheRock Python 包与 SDK 命令](https://github.com/ROCm/TheRock/blob/main/docs/packaging/python_packaging.md)
- 本教程 [第 1 章 环境准备](../../part0-intro/chapter1/index.md)
- [附录 B · 换一张卡：切换 ROCm 10.0 的 GPU 架构](../appendix-b-switch-gpu/index.md)
