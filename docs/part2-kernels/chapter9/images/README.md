# 第 9 章图示

- `../reduction-journey.vue` 是归约树与两阶段部分和动画的可编辑源文件。示例输入为 `[3,1,7,0,4,1,6,2]`，中间值由输入计算；动画时长用于教学，不代表 GPU 计时。
- `plot_reduction.py` 读取 `code/part2-kernels/chapter9/evidence/summary.csv` 和 `manifest.json`，调用公共绘图样式生成 `reduction-performance.png` 与 `reduction-performance.svg`。PNG 为 300 dpi，SVG 为矢量图；中文字体、蓝色 HIP、绿色 Triton、黑色边框和纹理与第 8 章性能图一致。
- 图中保留全部 5 个实现及与源码 implementation ID 对应的标签。上面板比较全部实现；下面板以独立线性坐标放大 3 个两阶段实现。柱长为 3 个独立进程中位数的中位数，误差线为这些进程中位数的最小值至最大值。
- `reduction-performance.webp` 由 PNG 经文档图片构建流程生成。

在仓库根目录，用安装了 Matplotlib 和中文字体的 Python 执行：

```bash
python3 docs/part2-kernels/chapter9/images/plot_reduction.py
```

上述命令只重画已归档数据，不运行 GPU 实验。数据仍来自 2026-07-19 的 Radeon RX 9070 XT、ROCm 7.13、原生 Ubuntu 24.04.4 实验；每进程预热 10 次，计时重复 50 次。HIP 计时包含输出清零，Triton 无需清零；输入为重复使用的交替 +1/−1。所有计时值和区间保持原样。
