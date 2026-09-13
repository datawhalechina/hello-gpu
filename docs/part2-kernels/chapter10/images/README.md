# 第 10 章图示

- `../softmax-journey.vue` 是稳定 Softmax 动画的可编辑源文件。示例由 `[1000,1001,1002]` 依次计算最大值、减最大值、指数、求和与除法；显示值保留四位小数，播放时长不代表 GPU 计时。
- `plot_softmax.py` 读取 `code/part2-kernels/chapter10/evidence/summary.csv` 和 `manifest.json`，调用公共绘图样式生成 `softmax-performance.png` 与 `softmax-performance.svg`。PNG 为 300 dpi，SVG 为矢量图；中文字体、蓝色 HIP、绿色 Triton、黑色边框和纹理与第 8 章性能图一致。
- 图中保留全部 4 个实现及与源码 implementation ID 对应的标签。柱长为 3 个独立进程中位数的中位数，误差线为这些进程中位数的最小值至最大值。
- `softmax-performance.webp` 由 PNG 经文档图片构建流程生成。

在仓库根目录，用安装了 Matplotlib 和中文字体的 Python 执行：

```bash
python3 docs/part2-kernels/chapter10/images/plot_softmax.py
```

上述命令只重画已归档数据，不运行 GPU 实验。数据来自 2026-07-19 的 Radeon RX 9070 XT、ROCm 7.13、原生 Ubuntu 24.04.4 实验，输入为 4096 × 1024 个 FP32 元素，每进程预热 10 次，计时重复 50 次。

**这是 LDS 复用同步修正前的历史实验，不代表修正后的性能。** 图内与本说明均保留该限制；重画没有更改任何计时值或区间。
