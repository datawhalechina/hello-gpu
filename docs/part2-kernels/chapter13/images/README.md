# 第 13 章图像来源

- `rmsnorm-journey.vue` 位于本章目录，提供按公式计算的教学动画，动画时间不代表 GPU 耗时。
- `rmsnorm-performance.svg` 由同目录 `render-rmsnorm-performance.py` 读取 `code/part2-kernels/chapter13/evidence/summary.csv` 绘制，保留 2026-07-19 的历史值与三进程范围，没有新增测量。
- PNG 与 SVG 由同一绘图脚本同步生成，统一采用图 8.5 的白底、蓝色 HIP、绿色 Triton、黑色描边与纹理样式；WebP 在网站构建时由 PNG 生成。
- 共用样式位于 `code/part2-kernels/common/plot_style.py`。在仓库根目录运行 `python3 docs/part2-kernels/chapter13/images/render-rmsnorm-performance.py` 即可从已有数据重新绘图，需要 Matplotlib 和中文字体（如 Noto Sans CJK SC）。
