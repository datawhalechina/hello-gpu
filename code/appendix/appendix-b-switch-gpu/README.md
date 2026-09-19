# 附录 B：ROCm 10.0 换卡配置

正文：`docs/appendix/appendix-b-switch-gpu/index.md`。

先查自己的 GPU 对应哪个 `gfx`，再修改配置，最后安装。本例不要求提前创建虚拟环境或安装任何 Python 依赖；系统驱动、uv 和 Python 3.12 的准备见第 1 章。

- `gfx1201/`：RX 9070 XT 的完整 uv 项目配置与锁文件。已在原生 Ubuntu 24.04.5、Python 3.12.3 上从没有 `.venv`、没有锁文件的新目录开始安装，并通过 GPU 运算检查。
- `gfx1151/`：用于 Ryzen AI Max+ 395 等设备的配置与锁文件。已在新目录中验证依赖解析，尚未在 gfx1151 GPU 上运行。
- `check_gpu.py`：导入配套库，读取版本、核对实际 GPU 架构，并执行一次带数值检查的 GPU 张量运算。

正文以教程自带的 `code/part0-intro` 为操作目录。该目录默认使用 gfx1201 配置；`gfx1151/pyproject.toml` 是正文展示的修改后完整文件，便于逐行核对。

从仓库根目录出发，在编辑器中打开 `code/part0-intro/pyproject.toml`。如果目标不是 gfx1201，就把 `torch`、`torchvision`、`rocm` 三行里的 `device-gfx1201` 都替换成查到的设备标签，保留 `devel`、版本和下载源设置。设备包及公共包由 uv 自动选择。

保存文件后，从仓库根目录在对应的 Linux x86_64 GPU 机器上执行：

```bash
cd code/part0-intro
uv sync
uv run --locked ../appendix/appendix-b-switch-gpu/check_gpu.py
```

已有的 `uv.lock` 保留即可。修改配置后的首次同步使用普通 `uv sync`，由它更新锁文件并创建或同步 `.venv`；同步成功后再用 `--locked` 运行检查。默认只安装运行依赖，`notebook` 依赖组按需使用。

正文提供了修改前、修改后的完整配置，以及可以切换查看的 git diff。验证命令应在安装完成后、同一个项目目录里运行。

这里验证的是 Python wheel 环境与最小 PyTorch GPU 运算，不代表其他章节的 HIP 编译、Triton kernel 或 profiler 已完成 ROCm 10.0 复测。
