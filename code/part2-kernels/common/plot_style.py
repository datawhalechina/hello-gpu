"""Publication styling for archived timing figures, matching Figure 8.5."""

from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
from typing import Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Patch
from matplotlib.ticker import MaxNLocator


PALETTE = {
    "hip": "#3775BA",
    "hip_baseline": "#0F4D92",
    "triton": "#8BCF8B",
    "triton_variant": "#AADCA9",
    "torch": "#CFCECE",
    "ink": "#17202a",
    "muted": "#5b6675",
    "grid": "#CFCECE",
}


@dataclass(frozen=True)
class TimingPanel:
    rows: Sequence[dict[str, str]]
    title: str = ""
    xmax: float | None = None


def configure_style() -> None:
    plt.rcParams.update({
        "font.family": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
        "font.size": 15,
        "axes.spines.right": False,
        "axes.spines.top": False,
        "axes.linewidth": 2,
        "axes.unicode_minus": False,
        "legend.frameon": False,
        # Embed glyph outlines so standalone SVGs render Chinese on any machine.
        "svg.fonttype": "path",
        "svg.hashsalt": "hello-gpu-publication",
        "savefig.facecolor": "white",
        "figure.facecolor": "white",
    })
    available = {font.name for font in font_manager.fontManager.ttflist}
    for name in ("PingFang SC", "Hiragino Sans GB", "Source Han Sans SC",
                 "Noto Sans CJK SC", "Microsoft YaHei", "WenQuanYi Zen Hei"):
        if name in available:
            plt.rcParams["font.family"] = [name, "Arial", "DejaVu Sans", "sans-serif"]
            return
    raise RuntimeError("Install a Chinese font such as Noto Sans CJK SC before rendering.")


def render_timing_figure(
    *,
    panels: Sequence[TimingPanel],
    title: str,
    subtitle: str,
    notes: Sequence[str],
    output: Path,
    labels: dict[str, str] | None = None,
    layout: str = "horizontal",
    formats: Sequence[str] = ("png", "svg"),
) -> None:
    """Render zero-based timing bars and process ranges to both PNG and SVG.

    Values are read directly from summary.csv. Detail panels use an explicitly
    independent linear axis; they never crop bars from the overview panel.
    """
    if not panels or len(panels) > 2:
        raise ValueError("Expected one or two timing panels")
    if layout not in {"horizontal", "vertical"}:
        raise ValueError("Unknown panel layout")
    configure_style()
    labels = labels or {}

    all_rows = list({row["implementation"]: row
                     for panel in panels for row in panel.rows}.values())
    styles = {}
    for runtime in ("hip", "triton", "torch"):
        members = [row for row in all_rows if row["runtime"] == runtime]
        for index, row in enumerate(members):
            color = PALETTE[runtime]
            if runtime == "hip" and index == 0:
                color = PALETTE["hip_baseline"]
            if runtime == "triton" and index > 0:
                color = PALETTE["triton_variant"]
            styles[row["implementation"]] = (color, ("", "//", "xx", "..")[index % 4])

    vertical = len(panels) == 2 and layout == "vertical"
    height = 10.0 if vertical else 6.8
    grid = {"height_ratios": [len(panel.rows) + 1 for panel in panels]} if vertical else {}
    fig, axes = plt.subplots(
        len(panels) if vertical else 1,
        1 if vertical else len(panels),
        figsize=(16, height), dpi=300, squeeze=False, gridspec_kw=grid,
    )
    fig.subplots_adjust(
        left=0.20 if len(panels) == 1 or vertical else 0.16,
        right=0.97,
        top=0.77 if any(panel.title for panel in panels) else 0.80,
        bottom=0.18 if vertical else 0.24,
        wspace=0.65, hspace=0.75,
    )

    for ax, panel in zip(axes.flat, panels, strict=True):
        medians = [float(row["median_ms"]) for row in panel.rows]
        lows = [float(row["median_ms_run_min"]) for row in panel.rows]
        highs = [float(row["median_ms_run_max"]) for row in panel.rows]
        if not medians or any(not math.isfinite(x) for x in medians + lows + highs):
            raise ValueError("Timing values must be present and finite")
        if any(not 0 < lo <= med <= hi for lo, med, hi in zip(lows, medians, highs, strict=True)):
            raise ValueError("Invalid process-median range")
        xmax = panel.xmax if panel.xmax is not None else max(highs) * 1.30
        if xmax <= max(highs):
            raise ValueError("Axis would crop an archived measurement")
        positions = list(range(len(panel.rows)))
        bars = ax.barh(
            positions, medians,
            xerr=[[med - lo for med, lo in zip(medians, lows, strict=True)],
                  [hi - med for med, hi in zip(medians, highs, strict=True)]],
            height=0.62,
            color=[styles[row["implementation"]][0] for row in panel.rows],
            edgecolor="black", linewidth=1.5,
            error_kw={"ecolor": PALETTE["ink"], "capsize": 5, "elinewidth": 2},
        )
        for bar, row, median, high in zip(bars, panel.rows, medians, highs, strict=True):
            bar.set_hatch(styles[row["implementation"]][1])
            ax.text(high + xmax * 0.018, bar.get_y() + bar.get_height() / 2,
                    f"{median:#.3g}", va="center", ha="left", fontsize=14,
                    color=PALETTE["ink"], fontweight="bold")
        ax.set_yticks(positions, [labels.get(row["implementation"], row["implementation"])
                                 for row in panel.rows])
        ax.invert_yaxis()
        ax.set_xlim(0, xmax)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=6, min_n_ticks=4))
        ax.set_xlabel("完整 GPU event 时间（ms，越短越快）", fontsize=16, labelpad=10)
        ax.set_axisbelow(True)
        ax.xaxis.grid(True, color=PALETTE["grid"], linewidth=0.8, alpha=0.6)
        ax.tick_params(axis="both", length=6, width=1.5, labelsize=13, pad=3.5)
        if panel.title:
            ax.set_title(panel.title, loc="left", fontsize=15, color=PALETTE["ink"], pad=14)

    fig.suptitle(title, x=0.02, y=0.985, ha="left", fontsize=22,
                 fontweight="bold", color=PALETTE["ink"])
    fig.text(0.02, 0.925 if not vertical else 0.94, subtitle, ha="left", va="top", fontsize=13,
             color=PALETTE["muted"])
    handles = [Patch(facecolor=PALETTE[runtime], edgecolor="black", label=label)
               for runtime, label in (("hip", "HIP"), ("triton", "Triton"), ("torch", "PyTorch"))
               if any(row["runtime"] == runtime for row in all_rows)]
    fig.legend(handles=handles, loc="upper right", bbox_to_anchor=(0.978, 0.985),
               ncols=len(handles), fontsize=13, columnspacing=1.4, handlelength=1.8)
    run_counts = {int(row["run_count"]) for row in all_rows}
    if len(run_counts) != 1:
        raise ValueError("All chart rows must use the same process count")
    process_count = run_counts.pop()
    footnotes = [f"柱长 = {process_count} 个独立进程 median 的中位数；误差线 = 独立进程范围。", *notes]
    line_step = 0.036 if not vertical else 0.027
    for index, note in enumerate(reversed(footnotes)):
        fig.text(0.02, 0.025 + index * line_step, note, ha="left", va="bottom",
                 fontsize=12, color=PALETTE["muted"])
    output.parent.mkdir(parents=True, exist_ok=True)
    for extension in formats:
        if extension == "png":
            fig.savefig(output.with_suffix(".png"), dpi=300)
        elif extension == "svg":
            svg = output.with_suffix(".svg")
            fig.savefig(svg, metadata={"Date": None})
            svg.write_text("\n".join(line.rstrip() for line in svg.read_text().splitlines()) + "\n")
        else:
            raise ValueError(f"Unsupported chart format: {extension}")
    plt.close(fig)
