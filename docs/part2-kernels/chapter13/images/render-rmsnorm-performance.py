"""Restyle archived measurements using Figure 8.5; no GPU benchmark is run."""
from pathlib import Path
import csv
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "code/part2-kernels"))
from common.plot_style import TimingPanel, render_timing_figure

with (ROOT / "code/part2-kernels/chapter13/evidence/summary.csv").open() as handle:
    rows = list(csv.DictReader(handle))
order = ["hip-serial", "hip-block", "triton-t0", "triton-t1"]
rows.sort(key=lambda row: order.index(row["implementation"]))

render_timing_figure(
    panels=[TimingPanel(rows, "全部实现"), TimingPanel([row for row in rows if row["implementation"] != "hip-serial"], "协作版本 · 局部放大")],
    title='RMSNorm 完整计时与协作版本对比',
    subtitle='AMD Radeon RX 9070 XT | ROCm 7.13 | 原生 Ubuntu 24.04 | 1024 × 4096 FP32',
    notes=['历史实测：2026-07-19；warmup 10 / repeat 50；两个面板使用独立的线性刻度。', '所有版本均为单 kernel；HIP 与 Triton 的输入不同，请优先比较同一路线内的改动。'],
    labels={'hip-serial': 'HIP serial', 'hip-block': 'HIP block', 'triton-t0': 'Triton t0', 'triton-t1': 'Triton t1'},
    output=HERE / "rmsnorm-performance",
)
