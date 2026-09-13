"""Restyle archived measurements using Figure 8.5; no GPU benchmark is run."""
from pathlib import Path
import csv
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "code/part2-kernels"))
from common.plot_style import TimingPanel, render_timing_figure

with (ROOT / "code/part2-kernels/chapter11/evidence/summary.csv").open() as handle:
    rows = list(csv.DictReader(handle))

render_timing_figure(
    panels=[TimingPanel(rows)],
    title='Matmul 矩阵乘实现的完整计时',
    subtitle='AMD Radeon RX 9070 XT | ROCm 7.13 | 原生 Ubuntu 24.04 | 512 × 512 × 512 FP32',
    notes=['历史实测：2026-07-19；warmup 10 / repeat 50。', 'HIP 与 Triton 的输入值、误差容限不同，请优先比较同一路线内的改动。'],
    labels={'hip-naive': 'HIP naive', 'hip-tiled': 'HIP tiled', 'torch-mm': 'PyTorch mm', 'triton-baseline': 'Triton baseline', 'triton-grouped': 'Triton grouped'},
    output=HERE / "matmul-performance",
)
