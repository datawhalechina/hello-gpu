# 附录 B：ROCm 10.0 换卡配置

正文：`docs/appendix/appendix-b-switch-gpu/index.md`。

- `gfx1201/`：RX 9070 XT 的完整 uv 项目配置与锁文件。已在原生 Ubuntu 24.04.5、Python 3.12.3 上安装并通过 GPU 运算检查。
- `gfx1151/`：用于 Ryzen AI Max+ 395 等设备的配置与锁文件。已验证依赖解析，尚未在 gfx1151 GPU 上运行。
- `check_gpu.py`：读取包版本、核对实际 GPU 架构，并执行一次 GPU 张量运算。
- `inspect_device_deps.py`：读取已安装的 torch、torchvision、rocm 元数据，按目标 extra 的条件列出设备依赖，不导入 GPU 库。

从本目录开始，在对应的 Linux x86_64 GPU 机器上执行：

```bash
cd gfx1201
uv sync --locked
uv run --locked ../check_gpu.py
```

使用 gfx1151 时进入 `gfx1151/`。手动修改 `pyproject.toml` 后，先运行 `uv lock` 再同步。两份项目都保留 `notebook` 依赖组，按需安装；默认同步只安装运行依赖。

修改架构前，在已经同步好的环境目录中查询，不需要预先安装目标设备包：

```bash
uv run --no-sync ../inspect_device_deps.py --list
uv run --no-sync ../inspect_device_deps.py gfx1100
```

脚本使用配套环境中的 `packaging` 解析依赖条件。`--list` 列出三个包共同声明的设备架构；查询结果以实际打印的版本和当前平台为准。将参数换成目标架构即可查询其他 extra，不能根据包名前缀猜公共设备包，也不能假定每种架构的包数相同。

这里验证的是 Python wheel 环境与最小 PyTorch GPU 运算，不代表其他章节的 HIP 编译、Triton kernel 或 profiler 已完成 ROCm 10.0 复测。
