# 硬件参考 · Radeon RX 9070 XT（gfx1201）

- 架构：RDNA4 / gfx1201
- 软件栈目标：ROCm 10.0 + PyTorch 2.13 + Triton 3.8（版本由本篇 pyproject.toml / uv.lock 固定）
- Wavefront：以运行时 `torch` / `rocminfo` 为准
- **峰值带宽与算力必须用 `measure_peak` 实测**，不要写死本页数字

## 优化提示

- 独显带宽较高，但 elementwise（如 vector_add）仍常为 memory-bound
- 优先向量化与更大 block，而不是堆复杂控制流
