# 附录 B：ROCm 10.0 换卡配置

正文：`docs/appendix/appendix-b-switch-gpu/index.md`。

- `gfx1201/`：RX 9070 XT 的完整 uv 项目配置与锁文件。已在原生 Ubuntu 24.04.5、Python 3.12.3 上安装并通过 GPU 运算检查。
- `gfx1151/`：用于 Ryzen AI Max+ 395 等设备的配置与锁文件。已验证依赖解析，尚未在 gfx1151 GPU 上运行。
- `check_gpu.py`：读取包版本、核对实际 GPU 架构，并执行一次 GPU 张量运算。

从本目录开始，在对应的 Linux x86_64 GPU 机器上执行：

```bash
cd gfx1201
uv sync --locked
uv run --locked ../check_gpu.py
```

使用 gfx1151 时进入 `gfx1151/`。手动修改 `pyproject.toml` 后，先运行 `uv lock` 再同步。两份项目都保留 `notebook` 依赖组，按需安装；默认同步只安装运行依赖。

这里验证的是 Python wheel 环境与最小 PyTorch GPU 运算，不代表其他章节的 HIP 编译、Triton kernel 或 profiler 已完成 ROCm 10.0 复测。
