"""Restyle archived measurements using Figure 8.5; no GPU benchmark is run."""
from pathlib import Path
import csv
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "code/part2-kernels"))
from common.plot_style import TimingPanel, render_timing_figure

with (ROOT / "code/part2-kernels/chapter12/evidence/summary.csv").open() as handle:
    rows = list(csv.DictReader(handle))

render_timing_figure(
    panels=[TimingPanel(rows)],
    title='Attention 各实现的完整计时',
    subtitle='AMD Radeon RX 9070 XT | ROCm 7.13 | 原生 Ubuntu 24.04 | S = 128，D = 64，FP32',
    notes=['历史实测：2026-07-19；warmup 10 / repeat 50。', '同步修正前的历史计时，不代表 2026-09-11 修正后代码的性能。'],
    labels={'hip-materialized': 'HIP materialized', 'hip-online': 'HIP online', 'triton-t0': 'Triton t0', 'triton-t1': 'Triton t1'},
    output=HERE / "attention-performance",
)
