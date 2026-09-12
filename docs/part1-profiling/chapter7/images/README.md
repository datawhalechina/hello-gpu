# 第 7 章插图

- `vector-add-work.svg`：原创教材示意图。SVG 本身是可编辑源文件，说明一个 FP32 输出对应 1 FLOP 与 12 Byte 算法有效数据，不表示物理显存事务。
- `roofline-ch6.png`：由 `code/part1-profiling/chapter7/plot_roofline_ch6.py` 生成的科学绘图。历史文件名保留以兼容既有链接。
- `roofline-ch6.webp`：同一张 PNG 的 WebP 版本。

2026-09-11 修订：参考曲线使用 `min(BW × AI, P_compute)`，斜线在拐点停止；工作点直接由计算量和历史时间换算。copy 参考按 2048 MiB 每缓冲区、8.032 ms 修正为约 535 GB/s，不再沿用把 MiB/ms 当 GB/s 的约 510 旧标签。所有参考值都明确为工作负载实测值，不是硬件峰值。原生 Ubuntu 绘图命令已复跑，GPU 历史测量没有因此重新运行。

测量与换算来源写在脚本文件头；本地详细审计和绘图输出见该章 `EXPERIMENT.md` 与 `logs/plot-roofline-2026-09-11.log`。
