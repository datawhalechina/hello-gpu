"""Redraw Chapter 10's archived measurements; no GPU work or new measurements."""
from pathlib import Path
import csv
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = ROOT / "code/part2-kernels/chapter10/evidence/summary.csv"
with SOURCE.open() as handle:
    rows = list(csv.DictReader(handle))
medians = [float(row["median_ms"]) for row in rows]
lower = [median - float(row["median_ms_run_min"]) for row, median in zip(rows, medians)]
upper = [float(row["median_ms_run_max"]) - median for row, median in zip(rows, medians)]
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False,
                     "axes.spines.right": False, "axes.spines.left": False})
fig, ax = plt.subplots(figsize=(10, 5.3))
fig.subplots_adjust(left=.29, right=.88, bottom=.24, top=.73)
colors = ["#147d92" if row["runtime"] == "hip" else "#b96f23" for row in rows]
ax.barh(range(len(rows)), medians, color=colors, height=.55, zorder=2)
ax.errorbar(medians, range(len(rows)), xerr=[lower, upper], fmt="none", ecolor="#243247", capsize=4, zorder=3)
ax.set_yticks(range(len(rows)), [row["implementation"] for row in rows])
ax.invert_yaxis()
ax.set_xlim(0, .84)
ax.tick_params(axis="y", length=0, pad=10)
ax.grid(axis="x", color="#e5e7eb", zorder=0)
ax.set_xlabel("Complete GPU-event interval (ms); lower is faster", labelpad=12)
for y, median in enumerate(medians):
    ax.text(median + .012, y, f"{median:.6f}", va="center", fontsize=10)
fig.suptitle("Chapter 10 | Row Softmax", x=.29, y=.96, ha="left", fontsize=20, weight="bold")
fig.text(.29, .805, "RX 9070 XT · 4096 × 1024 · FP32\nUbuntu 24.04.4 · ROCm 7.13 · archive: 2026-07-19", fontsize=11, color="#475569")
fig.text(.03, .06, "Bars: median of 3 process medians. Whiskers: process-median range.\nHistorical source: ef1722a6. These are not measurements of later code fixes.", fontsize=9, color="#475569")
fig.savefig(HERE / "softmax-performance.png", dpi=180, facecolor="white")
plt.close(fig)
