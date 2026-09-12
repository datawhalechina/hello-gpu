"""Redraw Chapter 9's archived measurements; no GPU work or new measurements."""
from pathlib import Path
import csv
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SOURCE = ROOT / "code/part2-kernels/chapter9/evidence/summary.csv"
with SOURCE.open() as handle:
    rows = list(csv.DictReader(handle))

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False,
                     "axes.spines.right": False, "axes.spines.left": False, "svg.fonttype": "none"})
fig, axes = plt.subplots(2, 1, figsize=(10, 7), gridspec_kw={"height_ratios": [5, 3]})
fig.subplots_adjust(left=.25, right=.87, bottom=.13, top=.78, hspace=.65)
for ax, items, xmax, heading in [
    (axes[0], rows, 38, "All implementations"),
    (axes[1], rows[2:], .072, "Two-stage implementations: enlarged linear scale"),
]:
    medians = [float(row["median_ms"]) for row in items]
    lower = [median - float(row["median_ms_run_min"]) for row, median in zip(items, medians)]
    upper = [float(row["median_ms_run_max"]) - median for row, median in zip(items, medians)]
    colors = ["#147d92" if row["runtime"] == "hip" else "#b96f23" for row in items]
    ax.barh(range(len(items)), medians, color=colors, height=.6, zorder=2)
    ax.errorbar(medians, range(len(items)), xerr=[lower, upper], fmt="none", ecolor="#243247", capsize=3, zorder=3)
    ax.set_yticks(range(len(items)), [row["implementation"] for row in items])
    ax.invert_yaxis()
    ax.set_xlim(0, xmax)
    ax.tick_params(axis="y", length=0, pad=10)
    ax.grid(axis="x", color="#e5e7eb", zorder=0)
    ax.set_xlabel("Complete GPU-event interval (ms); lower is faster")
    ax.set_title(heading, loc="left", fontsize=12, pad=12)
    for y, median in enumerate(medians):
        ax.text(median + xmax * .025, y, f"{median:.5f}" if median < 1 else f"{median:.3f}", va="center", fontsize=10)
fig.suptitle("Chapter 9 | Sum Reduction", x=.25, y=.97, ha="left", fontsize=20, weight="bold")
fig.text(.25, .86, "RX 9070 XT · N = 16,777,216 · FP32\nUbuntu 24.04.4 · ROCm 7.13 · archive: 2026-07-19", fontsize=11, color="#475569")
fig.text(.03, .025, "Bars: median of 3 process medians. Whiskers: process-median range.\nHIP includes output reset; Triton does not need it. Repeated alternating +/-1 input.", fontsize=9, color="#475569")
fig.savefig(HERE / "reduction-performance.png", dpi=180, facecolor="white")
plt.close(fig)
