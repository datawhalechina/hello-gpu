#!/usr/bin/env python3
"""Render a compact performance figure from curated chapter evidence."""

from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path


def read_summary(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    if not rows:
        raise ValueError("summary contains no rows")
    names = [row.get("implementation", "") for row in rows]
    if any(not name for name in names) or len(names) != len(set(names)):
        raise ValueError("summary implementations must be present and unique")
    for row in rows:
        if row.get("correct") != "OK" or row.get("run_count") != "3":
            raise ValueError(f"unpublishable row: {row.get('implementation', '?')}")
        for field in ("median_ms", "median_ms_run_min", "median_ms_run_max"):
            try:
                value = float(row[field])
            except (KeyError, ValueError) as error:
                raise ValueError(f"invalid {field}: {row.get('implementation', '?')}") from error
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"invalid {field}: {row.get('implementation', '?')}")
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Plot median kernel time and three-process range from summary.csv."
    )
    parser.add_argument("--summary", required=True, type=Path)
    parser.add_argument("--title", required=True)
    parser.add_argument("--subtitle", required=True)
    parser.add_argument("--out", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rows = read_summary(args.summary)

    import matplotlib.pyplot as plt

    colors = {
        "hip": "#0F4D92",
        "triton": "#58A65C",
        "torch": "#7A6F9B",
    }
    labels = [row["implementation"] for row in rows]
    medians = [float(row["median_ms"]) for row in rows]
    lower = [median - float(row["median_ms_run_min"]) for median, row in zip(medians, rows)]
    upper = [float(row["median_ms_run_max"]) - median for median, row in zip(medians, rows)]
    bar_colors = [colors.get(row.get("runtime", ""), "#8B949E") for row in rows]

    plt.rcParams.update({
        "font.family": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
        "font.size": 12,
        "axes.spines.top": False,
        "axes.spines.right": False,
    })
    figure_height = max(4.2, 0.56 * len(rows) + 2.2)
    figure, axis = plt.subplots(figsize=(10.5, figure_height))
    positions = list(range(len(rows)))
    bars = axis.barh(
        positions,
        medians,
        xerr=[lower, upper],
        color=bar_colors,
        edgecolor="white",
        capsize=4,
    )
    axis.set_yticks(positions, labels)
    axis.invert_yaxis()
    axis.set_xlabel("Median kernel time (ms), lower is better")
    axis.set_title(args.title, loc="left", fontsize=17, fontweight="bold", pad=24)
    axis.text(0, 1.01, args.subtitle, transform=axis.transAxes, color="#5B6675")
    axis.grid(axis="x", alpha=0.22)
    axis.set_axisbelow(True)
    for bar, value in zip(bars, medians):
        axis.text(
            bar.get_width(),
            bar.get_y() + bar.get_height() / 2,
            f"  {value:.4g} ms",
            va="center",
            fontsize=10,
        )
    figure.text(
        0.01,
        0.01,
        "Bar = median of 3 process medians; error bar = process range. Kernel-only GPU event timing.",
        color="#5B6675",
        fontsize=9,
    )
    figure.tight_layout(rect=(0, 0.04, 1, 1))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(args.out, dpi=240, bbox_inches="tight")
    plt.close(figure)
    print(args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
