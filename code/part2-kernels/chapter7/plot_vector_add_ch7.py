"""Plot the measured Chapter 7 Vector Add effective bandwidth.

Style follows the figures4papers publication house style:
- Helvetica/Arial-like sans fonts, top/right spines off, frameless legend.
- Semantic palette: blue = HIP continuous, green = Triton, red = strided
  counter-example. Hatch keeps HIP/Triton separable in grayscale.
- Two panels share the same y categories:
    left  = effective bandwidth (GB/s, logical bytes), 0-based bars;
    right = median time normalized to hip-v0, so "overlapping process ranges"
            (the chapter's no-winner conclusion) is directly visible.
- In-place value annotation, dpi=300 export.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
DEFAULT_SUMMARY = SCRIPT_DIR / "evidence" / "summary.csv"
DEFAULT_MANIFEST = SCRIPT_DIR / "evidence" / "manifest.json"
DEFAULT_OUTPUT = (
    REPO_ROOT
    / "docs"
    / "part2-kernels"
    / "chapter7"
    / "images"
    / "vector-add-ch7-bandwidth.png"
)

ORDER = (
    "hip-v0",
    "hip-v1-contiguous",
    "hip-v1-strided",
    "hip-v2",
    "hip-v3",
    "triton-t0",
    "triton-t1",
)
LABELS = {
    "hip-v0": "HIP v0",
    "hip-v1-contiguous": "HIP v1 连续",
    "hip-v1-strided": "HIP v1 跨步",
    "hip-v2": "HIP v2 grid-stride",
    "hip-v3": "HIP v3 float4",
    "triton-t0": "Triton t0 (256)",
    "triton-t1": "Triton t1 (1024)",
}

# figures4papers semantic palette
PALETTE = {
    "blue_main": "#0F4D92",
    "blue_secondary": "#3775BA",
    "green_2": "#AADCA9",
    "green_3": "#8BCF8B",
    "red_strong": "#B64342",
    "neutral": "#CFCECE",
    "ink": "#17202a",
    "muted": "#5b6675",
}

COLORS = {
    "hip-v0": PALETTE["blue_main"],
    "hip-v1-contiguous": PALETTE["blue_secondary"],
    "hip-v1-strided": PALETTE["red_strong"],
    "hip-v2": PALETTE["blue_secondary"],
    "hip-v3": PALETTE["blue_secondary"],
    "triton-t0": PALETTE["green_3"],
    "triton-t1": PALETTE["green_2"],
}
HATCH = {
    "hip-v0": "",
    "hip-v1-contiguous": "",
    "hip-v1-strided": "",
    "hip-v2": "//",
    "hip-v3": "xx",
    "triton-t0": "",
    "triton-t1": "//",
}

PUBLICATION_RCPARAMS = {
    "font.family": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
    "font.size": 15,
    "axes.spines.right": False,
    "axes.spines.top": False,
    "axes.linewidth": 2,
    "legend.frameon": False,
    "svg.fonttype": "none",
}


def format_experiment_subtitle(manifest: dict[str, object]) -> str:
    software = manifest["software"]
    benchmark = manifest["benchmark"]
    size = int(benchmark["size"])
    return (
        f'{manifest["hardware"]} | ROCm {software["rocm"]} | '
        f"N={size:,} FP32 | kernel-only GPU event 计时"
    )


def format_experiment_note(manifest: dict[str, object]) -> str:
    runs = int(manifest["benchmark"]["independent_runs"])
    return (
        f"柱长 = {runs} 个独立进程 median 的中位数；"
        "误差线 = 独立进程范围。"
    )


def validate_summary_metadata(
    rows: list[dict[str, str]], manifest: dict[str, object]
) -> None:
    expected_shape = int(manifest["benchmark"]["size"])
    summary_shapes = {int(row["shape"]) for row in rows}
    if summary_shapes != {expected_shape}:
        raise ValueError(
            f"summary shapes {sorted(summary_shapes)} disagree with manifest "
            f"shape {expected_shape}"
        )

    expected_runs = int(manifest["benchmark"]["independent_runs"])
    summary_run_counts = {int(row["run_count"]) for row in rows}
    if summary_run_counts != {expected_runs}:
        raise ValueError(
            f"summary run counts {sorted(summary_run_counts)} disagree with "
            f"manifest independent runs {expected_runs}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as file:
        by_name = {row["implementation"]: row for row in csv.DictReader(file)}
    missing = [name for name in ORDER if name not in by_name]
    if missing:
        raise ValueError(f"summary is missing implementations: {', '.join(missing)}")
    return [by_name[name] for name in ORDER]


def pick_cjk_font(plt: object, font_manager: object) -> None:
    candidates = [
        "PingFang SC",
        "Hiragino Sans GB",
        "Source Han Sans SC",
        "Noto Sans CJK SC",
        "Microsoft YaHei",
        "WenQuanYi Zen Hei",
    ]
    available = {f.name for f in font_manager.fontManager.ttflist}
    for name in candidates:
        if name in available:
            plt.rcParams["font.family"] = [name, "Arial", "DejaVu Sans", "sans-serif"]
            return


def main() -> None:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    rows = read_rows(args.summary)
    validate_summary_metadata(rows, manifest)

    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    from matplotlib.patches import Patch

    plt.rcParams.update(PUBLICATION_RCPARAMS)
    pick_cjk_font(plt, font_manager)
    plt.rcParams["axes.unicode_minus"] = False

    names = [row["implementation"] for row in rows]
    labels = [LABELS[name] for name in names]
    bandwidth = [float(row["effective_bandwidth_gbs"]) for row in rows]
    bw_min = [float(row["effective_bandwidth_gbs_run_min"]) for row in rows]
    bw_max = [float(row["effective_bandwidth_gbs_run_max"]) for row in rows]
    median_ms = [float(row["median_ms"]) for row in rows]
    ms_min = [float(row["median_ms_run_min"]) for row in rows]
    ms_max = [float(row["median_ms_run_max"]) for row in rows]

    base_ms = median_ms[names.index("hip-v0")]
    norm = [value / base_ms for value in median_ms]
    norm_min = [value / base_ms for value in ms_min]
    norm_max = [value / base_ms for value in ms_max]

    bw_err = [
        [value - lower for value, lower in zip(bandwidth, bw_min, strict=True)],
        [upper - value for value, upper in zip(bandwidth, bw_max, strict=True)],
    ]
    norm_err = [
        [value - lower for value, lower in zip(norm, norm_min, strict=True)],
        [upper - value for value, upper in zip(norm, norm_max, strict=True)],
    ]

    colors = [COLORS[name] for name in names]
    hatches = [HATCH[name] for name in names]

    figure, (ax_bw, ax_norm) = plt.subplots(
        1,
        2,
        figsize=(16, 6.4),
        dpi=300,
        sharey=True,
        gridspec_kw={"width_ratios": [1.15, 1.0], "wspace": 0.06},
    )
    figure.patch.set_facecolor("white")

    positions = list(range(len(rows)))

    # ---- left: effective bandwidth ----
    bars = ax_bw.barh(
        positions,
        bandwidth,
        xerr=bw_err,
        height=0.62,
        color=colors,
        edgecolor="black",
        linewidth=1.5,
        error_kw={"ecolor": PALETTE["ink"], "capsize": 5, "elinewidth": 2},
    )
    for bar, hatch in zip(bars, hatches, strict=True):
        bar.set_hatch(hatch)
    ax_bw.set_yticks(positions, labels, fontsize=15)
    ax_bw.invert_yaxis()
    ax_bw.set_xlim(0, max(bandwidth) * 1.18)
    ax_bw.set_xlabel("有效带宽 (GB/s，按逻辑字节计算)", fontsize=16, labelpad=10)
    ax_bw.xaxis.grid(True, color=PALETTE["neutral"], linewidth=0.8, alpha=0.6)
    ax_bw.set_axisbelow(True)
    ax_bw.tick_params(axis="both", length=6, width=1.5, labelsize=13)

    for bar, value in zip(bars, bandwidth, strict=True):
        ax_bw.text(
            value + max(bandwidth) * 0.015,
            bar.get_y() + bar.get_height() / 2,
            f"{value:.0f}",
            va="center",
            ha="left",
            fontsize=14,
            color=PALETTE["ink"],
            fontweight="bold",
        )

    # ---- right: normalized time ----
    bars2 = ax_norm.barh(
        positions,
        norm,
        xerr=norm_err,
        height=0.62,
        color=colors,
        edgecolor="black",
        linewidth=1.5,
        error_kw={"ecolor": PALETTE["ink"], "capsize": 5, "elinewidth": 2},
    )
    for bar, hatch in zip(bars2, hatches, strict=True):
        bar.set_hatch(hatch)
    ax_norm.axvline(1.0, color=PALETTE["ink"], linewidth=1.6, linestyle="--", alpha=0.55)
    ax_norm.text(
        1.005,
        -0.62,
        "HIP v0 = 1.00",
        fontsize=12,
        color=PALETTE["muted"],
        ha="left",
        va="bottom",
    )
    ax_norm.set_xlim(0, max(norm_max) * 1.12)
    ax_norm.set_xlabel("median 时间（相对 HIP v0 归一化）", fontsize=16, labelpad=10)
    ax_norm.xaxis.grid(True, color=PALETTE["neutral"], linewidth=0.8, alpha=0.6)
    ax_norm.set_axisbelow(True)
    ax_norm.tick_params(axis="both", length=6, width=1.5, labelsize=13)

    for bar, value in zip(bars2, norm, strict=True):
        ax_norm.text(
            value + max(norm_max) * 0.015,
            bar.get_y() + bar.get_height() / 2,
            f"{value:.2f}",
            va="center",
            ha="left",
            fontsize=14,
            color=PALETTE["ink"],
            fontweight="bold",
        )

    legend_handles = [
        Patch(facecolor=PALETTE["blue_secondary"], edgecolor="black", label="HIP 连续访问"),
        Patch(facecolor=PALETTE["green_3"], edgecolor="black", label="Triton"),
        Patch(facecolor=PALETTE["red_strong"], edgecolor="black", label="HIP 跨步（受控反例）"),
    ]
    figure.legend(
        handles=legend_handles,
        loc="upper right",
        bbox_to_anchor=(0.985, 0.965),
        fontsize=13,
        ncols=3,
        columnspacing=1.4,
        handlelength=1.8,
    )

    figure.suptitle(
        "Vector Add 有效带宽与归一化时间",
        x=0.02,
        y=0.985,
        ha="left",
        fontsize=22,
        fontweight="bold",
        color=PALETTE["ink"],
    )
    figure.text(
        0.02,
        0.905,
        format_experiment_subtitle(manifest),
        ha="left",
        fontsize=13,
        color=PALETTE["muted"],
    )
    figure.text(
        0.02,
        0.02,
        format_experiment_note(manifest),
        ha="left",
        fontsize=12,
        color=PALETTE["muted"],
    )
    figure.subplots_adjust(left=0.16, right=0.985, top=0.84, bottom=0.13)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(args.out, facecolor="white")
    plt.close(figure)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
