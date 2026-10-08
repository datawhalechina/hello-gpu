"""Shared rendering for independent-process optimization-round comparisons.

Evidence selection and validation stay in each chapter's plotting entry point.
"""
from dataclasses import dataclass
from pathlib import Path
from .plot_style import PALETTE, configure_style
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator

@dataclass(frozen=True)
class Measurement:
    config: str
    label: str
    runtime: str
    center_ms: float
    low_ms: float
    high_ms: float
    runs: int
    baseline: bool = False
    hatch: str = ""


@dataclass(frozen=True)
class Panel:
    title: str
    values: tuple[Measurement, ...]


def render_panels(*, name: str, title: str, subtitle: str, context: str,
                  panels: tuple[Panel, ...], notes: tuple[str, ...], output: Path,
                  formats: list[str], independent_axes: bool = False) -> None:
    """Use process-range error bars, zero origins, and explicit per-panel axes."""
    configure_style()
    count = len(panels)
    all_values = [value for panel in panels for value in panel.values]
    runs = {value.runs for value in all_values}
    if len(runs) != 1:
        raise ValueError("A figure must use one independent-process count")
    footnotes = (f"柱长：{runs.pop()} 个进程 median 的中位数；误差线：进程范围。", *notes)
    footer_line_step = 0.25
    # Give every two-line row a physical height; a relative hspace compresses
    # larger panels when a small baseline panel shares the figure.
    panel_heights = [0.64 * len(panel.values) for panel in panels]
    gap, top = 1.15, 1.72
    # Three footer lines fit the original margin; reserve another physical
    # line for every additional note rather than squeezing the last xlabel.
    bottom = 1.60 + footer_line_step * max(0, len(footnotes) - 3)
    height = top + bottom + sum(panel_heights) + gap * (count - 1)
    fig = plt.figure(figsize=(8.8, height), dpi=300)
    axes = []
    cursor = height - top
    for panel_height in panel_heights:
        cursor -= panel_height
        axes.append(fig.add_axes((0.36, cursor / height, 0.60, panel_height / height)))
        cursor -= gap
    shared_max = max(value.high_ms for value in all_values) * 1000 * 1.30
    axis_titles = []
    for ax, panel in zip(axes, panels, strict=True):
        centers = [value.center_ms * 1000 for value in panel.values]
        lows = [value.low_ms * 1000 for value in panel.values]
        highs = [value.high_ms * 1000 for value in panel.values]
        xmax = max(highs) * 1.30 if independent_axes else shared_max
        colors = [PALETTE["hip_baseline"] if value.runtime == "hip" and value.baseline
                  else PALETTE[value.runtime] for value in panel.values]
        bars = ax.barh(range(len(panel.values)), centers, height=0.54, color=colors,
                       edgecolor="black", linewidth=1.5,
                       xerr=[[center - low for center, low in zip(centers, lows, strict=True)],
                             [high - center for center, high in zip(centers, highs, strict=True)]],
                       error_kw={"ecolor": PALETTE["ink"], "capsize": 5, "elinewidth": 2})
        for bar, value, high in zip(bars, panel.values, highs, strict=True):
            bar.set_hatch(value.hatch)
            elapsed_us = value.center_ms * 1000
            label = f"{float(f'{elapsed_us:.3g}'):,.0f}" if elapsed_us >= 1000 else f"{elapsed_us:.3g}"
            ax.text(high + xmax * 0.023, bar.get_y() + bar.get_height() / 2,
                    label, fontsize=16, fontweight="bold",
                    ha="left", va="center", color=PALETTE["ink"])
        ax.set_yticks(range(len(panel.values)), [value.label for value in panel.values])
        ax.set_ylim(len(panel.values) - 0.5, -0.5)
        ax.set_xlim(0, xmax)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=5, min_n_ticks=4))
        ax.set_xlabel("GPU event 时间（μs，越短越快）", fontsize=15, labelpad=7)
        ax.tick_params(axis="both", labelsize=15, length=6, width=1.5, pad=4)
        ax.xaxis.grid(True, color=PALETTE["grid"], alpha=0.6, linewidth=0.8)
        ax.set_axisbelow(True)
        axis_titles.append(ax.set_title(panel.title, loc="left", fontsize=17,
                                        color=PALETTE["ink"], pad=13))
    fig.suptitle(title, x=0.03, y=1 - 0.16 / height, ha="left", fontsize=22,
                 fontweight="bold", color=PALETTE["ink"])
    fig.text(0.03, 1 - 0.68 / height, subtitle, fontsize=14, va="top", color=PALETTE["muted"])
    fig.text(0.03, 1 - 1.07 / height, context, fontsize=14, va="top", color=PALETTE["muted"])
    footer_texts = []
    for index, note in enumerate(reversed(footnotes)):
        footer_texts.append(fig.text(
            0.03, (0.18 + footer_line_step * index) / height, note, fontsize=12.5,
            color=PALETTE["muted"], va="bottom"))
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    texts = [*fig.texts, *axis_titles,
             *(label for ax in axes for label in [*ax.get_yticklabels(), ax.xaxis.label])]
    for text in texts:
        bounds = text.get_window_extent(renderer)
        if bounds.x0 < -1 or bounds.x1 > fig.bbox.width + 1 or bounds.y0 < -1 or bounds.y1 > fig.bbox.height + 1:
            plt.close(fig)
            raise ValueError(f"{name}: clipped text: {text.get_text()!r}")
    for ax in axes:
        labels = ax.get_yticklabels()
        for first, second in zip(labels, labels[1:]):
            if first.get_window_extent(renderer).overlaps(second.get_window_extent(renderer)):
                plt.close(fig)
                raise ValueError(f"{name}: adjacent row labels overlap")
    for previous, following_title in zip(axes[:-1], axis_titles[1:]):
        if previous.xaxis.label.get_window_extent(renderer).overlaps(following_title.get_window_extent(renderer)):
            plt.close(fig)
            raise ValueError(f"{name}: adjacent panel labels overlap")
    last_xlabel = axes[-1].xaxis.label.get_window_extent(renderer)
    if any(last_xlabel.overlaps(note.get_window_extent(renderer)) for note in footer_texts):
        plt.close(fig)
        raise ValueError(f"{name}: footer overlaps the last axis label")
    output.mkdir(parents=True, exist_ok=True)
    for extension in formats:
        path = output / f"round-{name}.{extension}"
        fig.savefig(path, dpi=300, metadata={"Date": None} if extension == "svg" else None)
        if extension == "svg":
            path.write_text("\n".join(line.rstrip() for line in path.read_text().splitlines()) + "\n")
        print(path)
    plt.close(fig)
