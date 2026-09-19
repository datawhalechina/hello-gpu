---
title: "附录 B · 换一张卡：切换 ROCm 10.0 的 GPU 架构"
description: "从 GPU 型号查到设备标签，修改三处配置，再安装并验证 ROCm 10.0 环境"
---

# 附录 B · 换一张卡：切换 ROCm 10.0 的 GPU 架构

## 本附录导读

> 教程用的是 RX 9070 XT，我们手上却可能是另一张 Radeon 显卡，或者一台 Ryzen AI Max+ 395 主机。第一次安装时，该把配置改成什么？我们只需要先查到自己设备的标签，把它填到配置里的三个位置，再运行 `uv sync`。

本附录从**已下载教程源码，但还没有创建 Python 虚拟环境、还没有安装 PyTorch**开始。系统和驱动已按 [第 1 章](../../part0-intro/chapter1/index.md)准备好，`uv` 命令可以使用；下面采用原生 Ubuntu 24.04、Linux x86_64 和 Python 3.12。我们会一直使用 ROCm 10.0，操作顺序是：

**查 GPU 型号 → 找到 gfx 代号 → 修改三个设备标签 → 安装环境 → 验证 GPU。**

下面以 **RX 9070 XT（`gfx1201`）→ Ryzen AI Max+ 395（`gfx1151`）** 为例。换成其他设备时，也沿着同样的步骤查找。

## B.1 第一步：从自己的型号查到 gfx 代号

先从机器配置单或系统信息中找到完整的产品型号，再打开 [AMD GPU 架构对照表](https://datawhalechina.github.io/hello-rocm/zh/00-environment/rocm-gpu-architecture-table)。在页面里查找这个型号，沿着同一行找到 **LLVM Target** 一列，记下里面的 `gfx` 代号。

例如，RX 9070 XT 位于「Radeon RX 系列（消费级）」表格中。@fig-switch-radeon-target 的两个红框分别标出型号和对应的 `gfx1201`。我们要记下的是 `gfx1201`；旁边的 `RDNA 4` 是架构家族名称，不是这里要填写的设备标签。

::: figure fig-switch-radeon-target
![Hello ROCm 架构表截图，红框标出 RX 9070 XT 型号及同一行的 gfx1201](./images/architecture-radeon.png)

从 Radeon RX 9000 的具体型号一栏，沿同一行找到 LLVM Target：RX 9070 XT 对应 `gfx1201`。来源：Hello ROCm 架构对照表，截图经裁切和红框标注。
:::

如果使用 Ryzen AI Max+ 395，就在「Ryzen APU 系列（笔记本/移动端）」中查找。APU 把 CPU 和 GPU 集成在同一颗处理器中，所以这张表按处理器型号列出设备。@fig-switch-apu-target 标出了 AI Max+ 395 和对应的 `gfx1151`。

::: figure fig-switch-apu-target
![Hello ROCm 架构表截图，红框标出 AI Max+ 395 型号所在的单元格及 gfx1151](./images/architecture-apu.png)

从 Ryzen APU 表中的 AI Max+ 395，找到同一行的 `gfx1151`。来源：Hello ROCm 架构对照表，截图经裁切和红框标注。
:::

**其他型号也这样查：找到自己的完整型号，只抄同一行的 LLVM Target。** 不要根据型号相近就套用示例。如果表里没有自己的型号，先查看 [AMD 官方兼容性说明](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html)，确认设备及系统支持情况，再继续安装。

## B.2 第二步：找到这个架构的设备标签

在同一页面继续找到「pip 安装（device extras 速查）」，用刚记下的 `gfx` 代号查右侧的标签。虽然表格标题写着 pip，**这些标签也可以直接写进 uv 项目的配置文件**。@fig-switch-device-extras 的红框标出了本例需要的两组对应关系。

::: figure fig-switch-device-extras
![Hello ROCm device extras 表截图，红框标出 gfx1201 与 device-gfx1201，以及 gfx1151 与 device-gfx1151](./images/device-extras.png)

统一下载源写在表格上方；红框里的 `device-gfx1201` 和 `device-gfx1151` 才是安装依赖时选择的标签。来源：Hello ROCm 架构对照表，截图经裁切和红框标注。
:::

例如，`gfx1201` 对应 `device-gfx1201`，`gfx1151` 对应 `device-gfx1151`。如果查到的是其他架构，就在这张表中找到它那一行，把完整的 `device-...` 标签记下来。

可以把设备标签理解成一份已经配好的领货清单。我们选好标签，uv 就会按清单下载相应的设备包。标签写在包名后面的方括号中，这种写法叫 **extra（可选依赖组）**：

```toml
"torch[device-gfx1151]==2.13.0+rocm10.0.0"
```

这行的意思是：安装这个版本的 PyTorch，并选用 `gfx1151` 的设备依赖。我们不需要提前安装 PyTorch，也不需要逐个查出它背后的设备包名。

## B.3 第三步：先改配置，再安装

我们直接使用教程自带的环境配置。下载好本教程的源码后，在编辑器中打开 **`code/part0-intro/pyproject.toml`**。这个文件属于第 0 篇，默认选择 RX 9070 XT 对应的 `gfx1201`；旁边的 `uv.lock` 也先保留，第四步会由 uv 根据修改后的配置更新它。

先看文件的完整内容，找到我们要改的位置：

<details>
<summary>修改前：code/part0-intro/pyproject.toml（gfx1201）</summary>

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
    "rocm[devel,device-gfx1201]==10.0.0",
]

[tool.uv]
environments = ["sys_platform == 'linux' and platform_machine == 'x86_64'"]

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

[dependency-groups]
notebook = [
    "ipykernel>=7.3.0",
    "jupyterlab>=4.6.2",
]
```

</details>

在文件中搜索 `device-gfx1201`，一共能找到 **3 处**，分别属于 `torch`、`torchvision` 和 `rocm`。如果目标是 `gfx1151`，就把这三处全部改成 `device-gfx1151`：

```toml
    "torch[device-gfx1151]==2.13.0+rocm10.0.0",
    "torchvision[device-gfx1151]==0.28.0+rocm10.0.0",
    "rocm[devel,device-gfx1151]==10.0.0",
```

这三行是用来**替换原有三行**的，不要重复添加。`rocm` 那行里的 `devel` 用于保留课程需要的开发组件，我们只改逗号后的设备标签。版本号和下面的下载源配置照原样保留。

修改完成后，整个文件应如下所示。展开后，可以在「修改后的完整文件」和「全文修改对照」两个选项之间切换：前者便于复制核对，后者保留整个文件，并在原位置标出三处替换。diff 中红色的 `-` 表示删去的行，绿色的 `+` 表示替换后的行；**diff 用来对照，复制配置请使用完整文件**。

<details>
<summary>修改后：完整 pyproject.toml 与全文修改对照（gfx1151）</summary>

::: code-group

```toml [修改后的完整文件]
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
    "rocm[devel,device-gfx1151]==10.0.0",
]

[tool.uv]
environments = ["sys_platform == 'linux' and platform_machine == 'x86_64'"]

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

[dependency-groups]
notebook = [
    "ipykernel>=7.3.0",
    "jupyterlab>=4.6.2",
]
```

```diff [全文修改对照]
 [project]
 name = "part0-intro"
 version = "0.1.0"
 requires-python = ">=3.12,<3.13"
 dependencies = [
     "numpy>=2.4.4",
     "matplotlib>=3.9",
-    "torch[device-gfx1201]==2.13.0+rocm10.0.0",
-    "torchvision[device-gfx1201]==0.28.0+rocm10.0.0",
+    "torch[device-gfx1151]==2.13.0+rocm10.0.0",
+    "torchvision[device-gfx1151]==0.28.0+rocm10.0.0",
     "torchaudio==2.11.0.2+rocm10.0.0",
-    "rocm[devel,device-gfx1201]==10.0.0",
+    "rocm[devel,device-gfx1151]==10.0.0",
 ]

 [tool.uv]
 environments = ["sys_platform == 'linux' and platform_machine == 'x86_64'"]

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

 [dependency-groups]
 notebook = [
     "ipykernel>=7.3.0",
     "jupyterlab>=4.6.2",
 ]
```

:::

</details>

**如果是其他架构呢？** 比如查表得到 `gfx1100`，对应标签是 `device-gfx1100`，我们就把这三个位置都改成它；查到 `gfx942`，也同样填写表中的 `device-gfx942`。方法只有一条：**用查到的标签替换三个位置，三个位置保持一致。**

像 `amd-torch-device-gfx115x` 这样的公共设备包，uv 会根据所选 extra 自动带上，不需要我们手填。文件中的下载源配置允许 uv 继续查找这些依赖：先查 AMD 源，AMD 源中没有的包再到通用镜像查找。

后面学习其他篇时，修改的是那一篇目录下的 `pyproject.toml`，再进入对应目录安装。这里先用 `code/part0-intro` 把完整流程走通。

## B.4 第四步：更新锁文件，安装本篇环境

保存 `code/part0-intro/pyproject.toml` 后，在终端中从 **`hello-gpu` 仓库根目录**执行：

```bash
cd code/part0-intro
uv sync
```

如果终端已经位于 `code/part0-intro`，直接运行第二行即可。后续命令也都在这个目录里执行。

**已有的 `uv.lock` 保留即可，不需要删除或手工修改。** 它记录了教程原来选择的依赖；修改设备标签后，`uv sync` 会检查新的 `pyproject.toml`，自动更新 `uv.lock`，再安装对应架构的包。第一次安装时，它还会在本目录创建 `.venv`；如果已有环境，就把环境同步到新的配置。

这一步使用普通的 **`uv sync`，先不要加 `--locked`**。刚改过配置时，锁文件可能还没更新，`--locked` 会阻止更新并报错。等本次同步成功，后面的验证命令再使用 `--locked`，确认配置与锁文件一致。

我们不需要先创建虚拟环境，也不需要先安装 `packaging`、`torch` 等 Python 包。初次安装需要下载较大的 GPU 依赖，等待命令结束即可；以后的设备切换也按「改三个标签 → 在本篇目录运行 `uv sync`」操作。

## B.5 第五步：让 GPU 真正算一次

安装成功后，**仍然留在 `code/part0-intro` 目录**，复制下面整段命令：

```bash
uv run --locked python - <<'PY'
import torch

print("torch:", torch.__version__)
print("GPU available:", torch.cuda.is_available())
if not torch.cuda.is_available():
    raise SystemExit("没有检测到可用 GPU，请先检查系统驱动和设备权限。")

print("GPU:", torch.cuda.get_device_name(0))
print("Architecture:", torch.cuda.get_device_properties(0).gcnArchName)
x = torch.arange(4, dtype=torch.float32, device="cuda")
result = (x * 2).cpu()
torch.testing.assert_close(result, torch.tensor([0.0, 2.0, 4.0, 6.0]))
print("GPU calculation:", result)
PY
```

这里的 `--locked` 会检查配置与刚刚同步过的锁文件是否一致；前一步 `uv sync` 完成之后再运行。PyTorch 在 AMD GPU 上也使用 `torch.cuda` 这套接口名称。

下面是在 **RX 9070 XT、原生 Ubuntu 24.04.5、Python 3.12.3** 上，使用本篇的 ROCm 10.0 配置安装环境后，实际得到的输出：

```text
torch: 2.13.0+rocm10.0.0
GPU available: True
GPU: AMD Radeon RX 9070 XT
Architecture: gfx1201
GPU calculation: tensor([0., 2., 4., 6.])
```

我们主要看三件事：`GPU available` 是 `True`；`Architecture` 与前面查到的架构一致；最后的计算得到 `[0., 2., 4., 6.]`。脚本还会检查计算结果，数值不对就会报错。

`gfx1151`、`gfx1100`、`gfx942` 的配置也已在全新目录中通过依赖解析，所需设备包由 uv 自动选择；这三种架构的实际 GPU 运算**待验证**。上面的输出只属于 RX 9070 XT，其他设备应以自己机器的运行结果为准。

## 遇到问题，先检查哪里

| 现象 | 先检查 |
| ---- | ---- |
| 提示没有找到 `pyproject.toml`，或运行时缺少包 | 从仓库根目录进入 `code/part0-intro`，完成 `uv sync` 后，再在同一目录运行验证命令 |
| 修改配置后提示锁文件需要更新 | 保留 `uv.lock`，先运行不带 `--locked` 的 `uv sync`，成功后再验证 GPU |
| 下载报 `Connection refused` 或 `tunnel error` | 检查网络和代理连接；这类错误发生在下载阶段 |
| 提示依赖无法解析，或某个 extra 不存在 | 核对是否完整复制配置，三个设备标签是否一致、是否来自表格中的对应行；不要忽略 extra 不存在的警告 |
| 安装结束，但 `GPU available` 是 `False` | 回到第 1 章检查系统驱动和设备访问权限，并核对设备标签 |
| 打印的 GPU 或架构与预期不符 | 检查程序实际使用的设备；多 GPU 机器尤其要留意 |

## 本附录小结

- **型号决定查哪一行**：先找到自己的设备，再读取 LLVM Target。
- **标签决定装哪些设备依赖**：查到 device extra 后，在完整配置里改三个位置。
- **先改，再装**：进入 `code/part0-intro`，用 `uv sync` 更新已有锁文件并安装本篇环境。
- **算对才算完成**：安装后检查实际 GPU、架构和计算结果。

## 参考资料

- [Hello ROCm：AMD GPU 架构对照表](https://datawhalechina.github.io/hello-rocm/zh/00-environment/rocm-gpu-architecture-table)
- [AMD ROCm 官方兼容性说明](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html)
- [AMD ROCm wheel 下载源](https://stable.repo.amd.com/rocm/whl-next/)
- [uv：项目锁定与同步](https://docs.astral.sh/uv/concepts/projects/sync/)
- [uv：包索引配置](https://docs.astral.sh/uv/concepts/indexes/)
