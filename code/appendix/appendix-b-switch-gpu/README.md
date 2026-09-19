# 附录 B：ROCm 10.0 换卡配置

正文：`docs/appendix/appendix-b-switch-gpu/index.md`。

先查自己的 GPU 对应哪个 `gfx`，再修改配置，最后安装。本例不要求提前创建虚拟环境或安装任何 Python 依赖；系统驱动、uv 和 Python 3.12 的准备见第 1 章。

- `gfx1201/`：RX 9070 XT 的完整 uv 项目配置与锁文件。已在原生 Ubuntu 24.04.5、Python 3.12.3 上从没有 `.venv`、没有锁文件的新目录开始安装，并通过 GPU 运算检查。
- `gfx1151/`：用于 Ryzen AI Max+ 395 等设备的配置与锁文件。已在新目录中验证依赖解析，尚未在 gfx1151 GPU 上运行。
- `check_gpu.py`：导入配套库，读取版本、核对实际 GPU 架构，并执行一次带数值检查的 GPU 张量运算。

从仓库根目录出发，在对应的 Linux x86_64 GPU 机器上执行：

```bash
cd code/appendix/appendix-b-switch-gpu/gfx1201
```

先打开当前目录的 `pyproject.toml`。如果目标不是 gfx1201，就把 `torch`、`torchvision`、`rocm` 三行里的 `device-gfx1201` 都替换成查到的设备标签，保留 `devel`、版本和下载源设置。设备包及公共包由 uv 自动选择。

保存文件后，仍在这个目录运行：

```bash
uv sync
uv run --locked ../check_gpu.py
```

使用 gfx1151 现成示例时，第一步进入 `gfx1151/` 即可。`uv sync` 会按配置创建或更新 `.venv` 和 `uv.lock`，不需要预先查询已安装包的元数据。两份项目都保留 `notebook` 依赖组，默认同步只安装运行依赖。

正文还提供了独立目录的完整配置和可直接复制的 GPU 检查命令，适合尚未克隆仓库的读者。验证命令应在安装完成后、同一个项目目录里运行。

这里验证的是 Python wheel 环境与最小 PyTorch GPU 运算，不代表其他章节的 HIP 编译、Triton kernel 或 profiler 已完成 ROCm 10.0 复测。
