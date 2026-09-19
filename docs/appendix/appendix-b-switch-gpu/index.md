---
title: "附录 B · 换一张卡：ROCm 10.0 下从 gfx1201 到 gfx1151"
description: "查出 GPU 的 LLVM Target，用 device extras 选择架构，再用 uv 锁定、安装和验证 ROCm 10.0 环境"
---

# 附录 B · 换一张卡：ROCm 10.0 下从 gfx1201 到 gfx1151

## 本附录导读

> 教程用的是 RX 9070 XT，我们手上却可能是一台 Ryzen AI Max+ 395 主机。两台机器都能运行 ROCm，环境文件却不能原封不动地照搬。本附录带我们沿着「显卡型号 → 架构代号 → 安装配置」走一遍：先学会查表，再把 ROCm 10.0 的 `pyproject.toml` 改对，最后让 GPU 真正算出一个结果。

换卡时，最容易混在一起的是两件事：**升级 ROCm 版本**，以及**为另一种 GPU 选择设备包**。如果手里的配置还写着 `gfx120X-all/` 和 `rocm-sdk-libraries-gfx120x-all`，我们先把它迁到 ROCm 10.0 的打包方式；完成这一步以后，再从 `gfx1201` 换到 `gfx1151`，下载源就不用跟着换了。

可以把这件事想成去仓库领工具。ROCm 10.0 把不同设备的工具放进同一个仓库，`device-gfx1201`、`device-gfx1151` 则是领货清单上的设备标签。仓库地址相同，领到的设备工具仍然不同。

## B.1 第一步：从显卡型号查到 gfx 代号

先打开 [AMD GPU 架构对照表](https://datawhalechina.github.io/hello-rocm/zh/00-environment/rocm-gpu-architecture-table)。这份表由 Hello ROCm 项目整理；查找时先认「具体型号」这一列，再沿着同一行向右读 **LLVM Target**。它就是编译器和设备包使用的目标架构代号。

如果使用 RX 9070 XT，在「Radeon RX 系列（消费级）」中找到它。@fig-switch-radeon-target 的两个红框分别标出型号所在的单元格和 `gfx1201`。这一步要记下的是 `gfx1201`，不要把旁边的 `RDNA 4` 当成安装参数。

::: figure fig-switch-radeon-target
![Hello ROCm 架构表截图，红框标出 RX 9070 XT 型号及同一行的 gfx1201](./images/architecture-radeon.png)

从 Radeon RX 9000 的具体型号一栏，沿同一行找到 LLVM Target：RX 9070 XT 对应 `gfx1201`。来源：Hello ROCm 架构对照表，截图经裁切和红框标注。
:::

如果使用 Ryzen AI Max+ 395，就继续找到「Ryzen APU 系列（笔记本/移动端）」。APU 把 CPU 和 GPU 集成在同一颗处理器中，所以这里按处理器型号查找。@fig-switch-apu-target 标出了 AI Max 300 一行里的 AI Max+ 395，以及它对应的 `gfx1151`。

::: figure fig-switch-apu-target
![Hello ROCm 架构表截图，红框标出 AI Max+ 395 型号所在的单元格及 gfx1151](./images/architecture-apu.png)

从 Ryzen APU 表中的 AI Max+ 395，找到同一行的 `gfx1151`。来源：Hello ROCm 架构对照表，截图经裁切和红框标注。
:::

这里有三种名字，各管一件事：

| 名字 | RX 9070 XT 的例子 | 用在哪里 |
| ---- | ---- | ---- |
| 产品型号 | Radeon RX 9070 XT | 认出自己买的是哪张卡 |
| 架构家族 | RDNA 4 | 理解这张卡的硬件特点 |
| LLVM Target | `gfx1201` | 选择设备包、检查程序实际使用的架构 |

旧配置里的 `gfx120X-all` 是当时 wheel 下载目录的名字，不能把它当成这张卡的 LLVM Target。查表以后，我们还会在 B.5 用实际运行结果核对架构，避免型号查对了、程序却用到了另一块设备。

**查到架构之后，还要核对 GPU、操作系统和驱动的支持组合。** 架构表能帮我们选包，具体平台条件应继续参考 [AMD 官方兼容性说明](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html)。本附录的操作环境是原生 Ubuntu 24.04、Linux x86_64 和 Python 3.12；系统驱动的准备沿用 [第 1 章](../../part0-intro/chapter1/index.md)。

## B.2 第二步：把架构代号对应到 device extra

在同一页面继续找到「pip 安装（device extras 速查）」。@fig-switch-device-extras 的红框给出了我们需要的两组对应关系。

::: figure fig-switch-device-extras
![Hello ROCm device extras 表截图，红框标出 gfx1201 与 device-gfx1201，以及 gfx1151 与 device-gfx1151](./images/device-extras.png)

统一下载源写在表格上方；红框里的 `device-gfx1201` 和 `device-gfx1151` 才是安装依赖时选择的标签。来源：Hello ROCm 架构对照表，截图经裁切和红框标注。
:::

Python 依赖名后面的方括号称为 **extra（可选依赖组）**。例如：

```toml
"torch[device-gfx1201]==2.13.0+rocm10.0.0"
```

这行依次说明三件事：安装 `torch`，同时选择 `device-gfx1201` 所声明的设备依赖，并把版本固定在 `2.13.0+rocm10.0.0`。方括号属于依赖声明本身，写进 `pyproject.toml` 后，`uv sync` 就会按这份声明安装。

对照旧配置，ROCm 10.0 的变化可以整理成下面这张表：

| 要确认的内容 | ROCm 7.13 的旧配置 | 本附录的 ROCm 10.0 配置 |
| ---- | ---- | ---- |
| AMD wheel 源 | 按架构选择 `gfx120X-all/`、`gfx1151/` 等目录 | 统一使用 `https://stable.repo.amd.com/rocm/whl-next/` |
| PyTorch 的架构选择 | 主要由所选下载目录决定 | 在依赖名上写 `[device-gfx1201]` 或 `[device-gfx1151]` |
| ROCm libraries 包 | `rocm-sdk-libraries-gfx120x-all` 等 | `rocm-sdk-libraries`，设备内容另由 `rocm-sdk-device-*` 提供 |
| 版本组合 | `torch==2.11.0+rocm7.13.0` 等旧约束 | 使用本附录给出的完整 ROCm 10.0 组合 |

因此，从旧文件升级时，只把字符串 `7.13.0` 替换成 `10.0.0` 还不够。源地址、包名和设备依赖都发生了变化。反过来，**已经使用同一套 ROCm 10.0 配置时，从 `gfx1201` 换到 `gfx1151`，保留版本组合和下载源，调整设备选择即可。**

## B.3 第三步：先看懂一份完整的 uv 配置

下面从 RX 9070 XT 的配置开始。配套文件位于仓库的 `code/appendix/appendix-b-switch-gpu/gfx1201/`，其中 `pyproject.toml` 记录我们要什么，`uv.lock` 记录最终解析到了哪些具体包。

### B.3.1 为什么设备包要单独写出来

在浏览器里打开 [AMD ROCm 10.0 wheel 索引](https://stable.repo.amd.com/rocm/whl-next/)，可以看到 `rocm`、`rocm-sdk-core`、`rocm-sdk-libraries`、`torch`、`triton` 和各架构设备包的目录。下载地址相同，并不意味着只安装一个大包就能覆盖所有设备。

本教程保留 `explicit = true`：只有被明确绑定到 `rocm-amd` 的包才从 AMD 源解析，NumPy、Matplotlib 等普通依赖使用默认镜像。可以把 `[tool.uv.sources]` 理解成清单上的「领取地点」。**给 `torch` 写了领取地点，它所依赖的包不会自动继承这个地点。**

这就是为什么只写三行 PyTorch 依赖时，可能先遇到 `rocm[libraries]==10.0.0` 找不到；补上 `rocm` 以后，又遇到 `rocm-sdk-core==10.0.0` 找不到。这个报错只说明当前解析范围内找不到合适的版本，还不能断定 AMD 没有发布这个包。

下面的文件把需要走 AMD 源的依赖显式列出，并逐一绑定来源。它比一条 `uv pip install` 长一些，但包从哪里来、锁定什么版本，都能直接在文件里看清楚。[uv 对显式索引的说明](https://docs.astral.sh/uv/concepts/indexes/#pinning-a-package-to-an-index)解释了这一行为。

<details>
<summary>完整配置：ROCm 10.0 + gfx1201，适用于 RX 9070 XT</summary>

```toml
[project]
name = "part0-intro"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
    "numpy>=2.4.4",
    "matplotlib>=3.9",
    "torch[device-gfx1201]==2.13.0+rocm10.0.0",
    "torchvision[device-gfx1201]==0.28.0+rocm10.0.0",
    "torchaudio==2.11.0.2+rocm10.0.0",
    "rocm==10.0.0",
    "rocm-sdk-core==10.0.0",
    "rocm-sdk-devel==10.0.0",
    "rocm-sdk-libraries==10.0.0",
    "rocm-sdk-device-gfx1201==10.0.0",
    "amd-torch-device-gfx1201==2.13.0+rocm10.0.0",
    "amd-torch-device-gfx12-0==2.13.0+rocm10.0.0",
    "amd-torchvision-device-gfx1201==0.28.0+rocm10.0.0",
    "triton==3.8.0+git4cff872c.rocm10.0.0",
]

[tool.uv]
environments = ["sys_platform == 'linux' and platform_machine == 'x86_64'"]

[[tool.uv.index]]
name = "rocm-amd"
url = "https://stable.repo.amd.com/rocm/whl-next/"
explicit = true

[[tool.uv.index]]
name = "pypi-mirror"
url = "https://mirrors.bfsu.edu.cn/pypi/web/simple"
default = true

[tool.uv.sources]
torch = { index = "rocm-amd" }
torchvision = { index = "rocm-amd" }
torchaudio = { index = "rocm-amd" }
rocm = { index = "rocm-amd" }
rocm-sdk-core = { index = "rocm-amd" }
rocm-sdk-devel = { index = "rocm-amd" }
rocm-sdk-libraries = { index = "rocm-amd" }
rocm-sdk-device-gfx1201 = { index = "rocm-amd" }
amd-torch-device-gfx1201 = { index = "rocm-amd" }
amd-torch-device-gfx12-0 = { index = "rocm-amd" }
amd-torchvision-device-gfx1201 = { index = "rocm-amd" }
triton = { index = "rocm-amd" }

[dependency-groups]
notebook = [
    "ipykernel>=7.3.0",
    "jupyterlab>=4.6.2",
]
```

</details>

### B.3.2 先记住这四处对应关系

读完整份文件时，不必逐个背下包名。先把下面四组关系对起来：

1. `torch` 和 `torchvision` 的方括号都选择 `device-gfx1201`。
2. `rocm-sdk-device-gfx1201` 提供目标设备的 ROCm 内容，`rocm-sdk-libraries` 不再带旧的架构后缀。
3. 当前这版 `torch[device-gfx1201]` 同时依赖 `amd-torch-device-gfx1201` 和 `amd-torch-device-gfx12-0`；后者是它声明的公共设备包，不能只看到名字不同就删掉。
4. `dependencies` 中需要从 AMD 下载的包，在 `[tool.uv.sources]` 里有同名映射。名字和版本要分别检查，不能把「来源漏配」误当成「版本不存在」。

`requires-python = ">=3.12,<3.13"` 把这个示例限定在 Python 3.12；`environments` 则限定 Linux x86_64。它们与本附录的实验条件对应。`notebook` 是单独的依赖组，普通 `uv sync` 不会因为它存在就安装整套 Jupyter。

这份配置还保留了原环境中的 `rocm-sdk-devel` 和 Triton。前者是开发组件，后者使用 AMD 索引中实际提供的 `3.8.0+git4cff872c.rocm10.0.0`；不能按旧版本号自行拼出一个未经确认的新 wheel 名称。

## B.4 换到 gfx1151：哪些地方一起改

现在假设我们使用的是 Ryzen AI Max+ 395，查表得到 `gfx1151`。以 B.3 的文件为起点，对照下面的表修改；右侧已经是可直接使用的名称。

| 修改位置 | gfx1201 | gfx1151 |
| ---- | ---- | ---- |
| `torch`、`torchvision` 的 extra | `device-gfx1201` | `device-gfx1151` |
| ROCm 设备包 | `rocm-sdk-device-gfx1201` | `rocm-sdk-device-gfx1151` |
| PyTorch 设备包 | `amd-torch-device-gfx1201` | `amd-torch-device-gfx1151` |
| PyTorch 公共设备包 | `amd-torch-device-gfx12-0` | `amd-torch-device-gfx115x` |
| torchvision 设备包 | `amd-torchvision-device-gfx1201` | `amd-torchvision-device-gfx1151` |
| `[tool.uv.sources]` 中的设备包名 | 与左侧设备包一致 | 与右侧设备包一致 |
| AMD 源和版本约束 | B.3 中的组合 | 保持相同 |

**其中最容易漏掉的是公共设备包：`gfx12-0` 要换成 `gfx115x`。** 这两个名字来自当前 PyTorch wheel 的依赖声明，不能靠把所有 `gfx1201` 搜索替换成 `gfx1151` 推导出来。后续更换其他架构或 PyTorch 版本时，也要重新核对它实际声明的依赖。

`rocm`、`rocm-sdk-core`、`rocm-sdk-devel`、`rocm-sdk-libraries`、Triton 和 torchaudio 的名称在这两份配置中保持相同。`rocm-amd` 的 URL 仍然是统一的 `whl-next/`，不再追加 `/gfx1151/`。

下面给出改好的完整文件，配套目录为 `code/appendix/appendix-b-switch-gpu/gfx1151/`。两份文件并排比较，会更容易看出哪些依赖跟着 GPU 变化。

<details>
<summary>完整配置：ROCm 10.0 + gfx1151，供 AI Max+ 395 等设备验证</summary>

```toml
[project]
name = "part0-intro"
version = "0.1.0"
requires-python = ">=3.12,<3.13"
dependencies = [
    "numpy>=2.4.4",
    "matplotlib>=3.9",
    "torch[device-gfx1151]==2.13.0+rocm10.0.0",
    "torchvision[device-gfx1151]==0.28.0+rocm10.0.0",
    "torchaudio==2.11.0.2+rocm10.0.0",
    "rocm==10.0.0",
    "rocm-sdk-core==10.0.0",
    "rocm-sdk-devel==10.0.0",
    "rocm-sdk-libraries==10.0.0",
    "rocm-sdk-device-gfx1151==10.0.0",
    "amd-torch-device-gfx1151==2.13.0+rocm10.0.0",
    "amd-torch-device-gfx115x==2.13.0+rocm10.0.0",
    "amd-torchvision-device-gfx1151==0.28.0+rocm10.0.0",
    "triton==3.8.0+git4cff872c.rocm10.0.0",
]

[tool.uv]
environments = ["sys_platform == 'linux' and platform_machine == 'x86_64'"]

[[tool.uv.index]]
name = "rocm-amd"
url = "https://stable.repo.amd.com/rocm/whl-next/"
explicit = true

[[tool.uv.index]]
name = "pypi-mirror"
url = "https://mirrors.bfsu.edu.cn/pypi/web/simple"
default = true

[tool.uv.sources]
torch = { index = "rocm-amd" }
torchvision = { index = "rocm-amd" }
torchaudio = { index = "rocm-amd" }
rocm = { index = "rocm-amd" }
rocm-sdk-core = { index = "rocm-amd" }
rocm-sdk-devel = { index = "rocm-amd" }
rocm-sdk-libraries = { index = "rocm-amd" }
rocm-sdk-device-gfx1151 = { index = "rocm-amd" }
amd-torch-device-gfx1151 = { index = "rocm-amd" }
amd-torch-device-gfx115x = { index = "rocm-amd" }
amd-torchvision-device-gfx1151 = { index = "rocm-amd" }
triton = { index = "rocm-amd" }

[dependency-groups]
notebook = [
    "ipykernel>=7.3.0",
    "jupyterlab>=4.6.2",
]
```

</details>

**验证范围**：本附录的 GPU 运算检查在 RX 9070 XT（`gfx1201`）上完成。`gfx1151` 配置已通过 Linux x86_64、Python 3.12 下的依赖解析，尚未在对应 GPU 上运行。**🚧 待补 gfx1151 上机验证。** 解析成功说明依赖能配成一套，真正换卡以后，还要完成 B.5 的设备检查。

## B.5 第四步：安装以后，让 GPU 真正算一次

下面先使用配套的 `gfx1201` 示例。命令从仓库根目录出发，在原生 Ubuntu 实验机上执行：

```bash
cd code/appendix/appendix-b-switch-gpu/gfx1201
uv sync --locked
uv run --locked ../check_gpu.py
```

`--locked` 要求配置与已经提供的锁文件一致。如果我们手动修改了 `pyproject.toml`，应先更新锁文件，再安装：

```bash
uv lock
uv sync --locked
```

**修改依赖后可以直接运行 `uv lock`，不必先删除 `uv.lock`。** uv 会重新检查项目约束；新约束排除了旧版本时，会更新相应条目。保留锁文件也让我们能在差异里看到这次究竟换了哪些包。[uv 的锁定与同步说明](https://docs.astral.sh/uv/concepts/projects/sync/)给出了这两个步骤的区别。

检查脚本会先输出包版本，再确认 GPU 可用，最后把张量放到 GPU 上做一次乘法，并与 CPU 上的预期结果比较。这里继续使用 `torch.cuda` 和 `device="cuda"`：PyTorch 的 ROCm 后端沿用了这套接口名称，出现 `cuda` 并不表示装成了 NVIDIA 版本。

<details>
<summary>检查脚本：check_gpu.py</summary>

```python
"""检查当前 Python 环境的 ROCm 包、GPU 架构和一次真实 GPU 运算。"""

from importlib.metadata import version

import torch
import torchvision
import torchaudio
import triton

print("ROCm SDK:", version("rocm"))
print("torch:", torch.__version__)
print("torchvision:", torchvision.__version__)
print("torchaudio:", torchaudio.__version__)
print("triton package:", version("triton"))
print("triton module:", triton.__version__)
print("HIP:", torch.version.hip)
print("GPU available:", torch.cuda.is_available())

if not torch.cuda.is_available():
    raise SystemExit("未发现可用 GPU：检查驱动、设备权限和所选 device extra。")

print("GPU:", torch.cuda.get_device_name(0))
print("Architecture:", torch.cuda.get_device_properties(0).gcnArchName)
x = torch.arange(4, dtype=torch.float32, device="cuda")
result = (x * 2).cpu()
torch.testing.assert_close(result, torch.tensor([0.0, 2.0, 4.0, 6.0]))
print("GPU calculation:", result)
```

</details>

下面是在 **Radeon RX 9070 XT（gfx1201）、原生 Ubuntu 24.04.5、Python 3.12.3、ROCm SDK 10.0.0 wheel 环境**中的实际输出。检查重点是：架构与选包一致，GPU 可用，最后的张量运算通过。

<details>
<summary>输出：ROCm 10.0 环境检查 @ RX 9070 XT / Ubuntu 24.04</summary>

```text
ROCm SDK: 10.0.0
torch: 2.13.0+rocm10.0.0
torchvision: 0.28.0+rocm10.0.0
torchaudio: 2.11.0.2+rocm10.0.0
triton package: 3.8.0+git4cff872c.rocm10.0.0
triton module: 3.8.0
HIP: 7.15.26333
GPU available: True
GPU: AMD Radeon RX 9070 XT
Architecture: gfx1201
GPU calculation: tensor([0., 2., 4., 6.])
```

</details>

这里有两个值得读懂的细节。首先，`torch.version.hip` 反映 PyTorch 构建关联的 HIP 版本，它与 ROCm SDK 的发行版本是不同的版本字段。本次实测同时出现 `ROCm SDK: 10.0.0` 和 `HIP: 7.15.26333`，不能仅凭 HIP 一行就断定仍装着旧的 ROCm wheel。其次，`triton.__version__` 只显示 `3.8.0`，而 Python 安装包元数据保留了 `+git4cff872c.rocm10.0.0` 后缀，所以脚本把两者都列了出来。

完成这一步，我们确认的是 **Python 环境能加载这些包，并让当前 GPU 执行一次 PyTorch 运算**。`uv sync` 不会替我们升级系统的内核驱动；HIP 编译器、Triton JIT 和 profiling 工具是否能完成后续章节的任务，还需要各自的程序继续验证。把最小环境检查和后续实验分开，出了问题才知道从哪一层查起。

对于 `gfx1151`，在对应机器上进入它的配套目录，执行同一套安装和检查流程。核对实际设备名称与架构，不能拿这里的 `gfx1201` 输出当作另一张卡的运行证据。

## B.6 报错时，先判断卡在哪一层

安装报错和 GPU 运行失败发生在不同阶段。先看失败位置，再检查对应文件，通常比反复换版本更有效。

| 现象 | 优先检查什么 | 下一步 |
| ---- | ---- | ---- |
| `tunnel error`、`Connection refused` | 当前 shell 的代理地址和代理服务 | 先恢复网络连通；此时还不能判断依赖版本是否可用 |
| 找不到 `rocm[libraries]==10.0.0` 或 `rocm-sdk-core==10.0.0` | AMD 显式索引的依赖声明和来源映射 | 对照 B.3，检查直接依赖与 `[tool.uv.sources]` 是否齐全，再核对索引上的版本 |
| 找不到 `amd-torch-device-gfx12-0` 或 `amd-torch-device-gfx115x` | 该版本 PyTorch 声明的公共设备包 | 按 B.4 同时调整设备包及其来源映射 |
| 仍在请求 `rocm-sdk-libraries-gfx120x-all` | 是否残留 ROCm 7.13 的包名 | 对照 B.2 完成整套配置迁移，并更新锁文件 |
| `--locked` 提示锁文件需要更新 | 是否修改过 `pyproject.toml` | 先运行 `uv lock`，成功后再 `uv sync --locked` |
| 安装成功，但 `GPU available: False` | 系统驱动、设备访问权限、实际运行的 Python 环境 | 回到第 1 章核对基础环境，再运行检查脚本 |
| 能识别 GPU，但张量运算报错 | 设备包是否与实际架构匹配，以及完整运行时错误 | 核对 B.1 与 B.4，保留报错信息继续定位 |

不要把 `No solution found` 直接翻译成「AMD 没有这个包」；也不要用跳过依赖安装的方式绕开它。我们的目标是让这份配置完整地解析、安装和运行，这样下一次重建环境时才有可依赖的起点。

## 本附录小结

- 先从产品型号找到 LLVM Target，再把 `gfx1201` 或 `gfx1151` 对应到 device extra。
- ROCm 10.0 使用统一的 `whl-next/` 源；从旧版升级时，下载源、libraries 包名和设备依赖需要一起调整。
- 在本附录的显式索引配置中，换卡要同时修改 extra、设备包及来源映射，尤其别漏掉 PyTorch 的公共设备包。
- 用 `uv lock` 更新依赖解析，用 `uv sync --locked` 安装，再用真实的 GPU 运算检查环境。三个步骤分别解决三个问题。

读完以后，我们应该能拿着另一张 AMD 卡的型号，查出它的架构，指出环境文件里与设备绑定的部分，并说明一次检查到底验证到了哪一步。接下来再回到对应章节，验证这张卡上的 HIP、Triton 或 profiling 程序。

## 延伸阅读

- [Hello ROCm · AMD GPU 架构对照表](https://datawhalechina.github.io/hello-rocm/zh/00-environment/rocm-gpu-architecture-table)
- [AMD · ROCm 兼容性说明](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html)
- [AMD · ROCm 10.0 wheel 索引](https://stable.repo.amd.com/rocm/whl-next/)
- [uv · 包索引与显式来源](https://docs.astral.sh/uv/concepts/indexes/)
- [uv · 锁定与同步](https://docs.astral.sh/uv/concepts/projects/sync/)
- [PyTorch · HIP / ROCm 后端说明](https://docs.pytorch.org/docs/stable/notes/hip.html)
- 本教程 [第 1 章 环境准备](../../part0-intro/chapter1/index.md)
