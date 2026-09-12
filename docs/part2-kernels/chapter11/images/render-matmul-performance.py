"""Render the published Chapter 11 timings, without changing measurement data."""
from pathlib import Path
import csv

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

image_dir = Path(__file__).resolve().parent
repo = image_dir.parents[3]
with (repo / 'code/part2-kernels/chapter11/evidence/summary.csv').open() as handle:
    rows = list(csv.DictReader(handle))

plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 11, 'svg.fonttype': 'none'})
fig, ax = plt.subplots(figsize=(10.5, 5.8))
fig.subplots_adjust(left=.19, right=.965, top=.77, bottom=.23)
for i, row in enumerate(rows):
    median = float(row['median_ms'])
    lower = float(row['median_ms_run_min'])
    upper = float(row['median_ms_run_max'])
    color = '#0891b2' if row['runtime'] == 'hip' else '#d97706' if row['runtime'] == 'triton' else '#64748b'
    ax.barh(i, median, height=.58, color=color, alpha=.85, zorder=2)
    ax.errorbar(median, i, xerr=[[median-lower], [upper-median]], color='#0f172a', capsize=4, lw=1.6, zorder=3)
    ax.text(upper+.009, i, f'{median:.4f} ms', va='center', color='#0f172a', fontsize=10)
ax.set_yticks(range(len(rows)), [row['implementation'] for row in rows])
ax.invert_yaxis()
ax.set_xlim(0, .515)
ax.set_xlabel('GPU event time (ms) · lower is better', labelpad=10)
ax.grid(axis='x', color='#e2e8f0', zorder=0)
ax.set_axisbelow(True)
for side in ('top', 'right', 'left'):
    ax.spines[side].set_visible(False)
ax.spines['bottom'].set_color('#cbd5e1')
ax.tick_params(axis='both', length=0, pad=8, colors='#334155')
fig.text(.19, .935, 'Chapter 11 · Matrix multiplication', weight='bold', size=19, color='#0f172a')
fig.text(.19, .887, 'RX 9070 XT · ROCm 7.13 · Ubuntu 24.04 · 512×512×512 FP32', size=11, color='#475569')
fig.text(.19, .848, 'Measured 2026-07-19 · 3 processes · warmup 10 / repeat 50 per process', size=10, color='#64748b')
fig.text(.19, .101, 'Bar: median of 3 process medians. Whisker: range of those medians.', size=10, color='#475569')
fig.text(.19, .061, 'Compare changes within a route: HIP/Triton input values and error tolerances differ.', size=9.5, color='#64748b')
fig.savefig(image_dir / 'matmul-performance.svg', facecolor='white')
plt.close(fig)
