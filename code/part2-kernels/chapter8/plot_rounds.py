"""Render Chapter 8's measured optimization rounds without mixing timing scopes.

Input: evidence/rounds/{summary.csv,manifest.json}, produced by the round runner.
Only archived process medians are plotted; this script neither benchmarks nor
fills missing configurations with values from the older chapter summary.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
PART_DIR = SCRIPT_DIR.parent
REPO_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(PART_DIR))

from common.plot_style import PALETTE, configure_style

import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.ticker import MaxNLocator


DEFAULT_EVIDENCE = SCRIPT_DIR / "evidence" / "rounds"
DEFAULT_OUTPUT = REPO_ROOT / "docs" / "part2-kernels" / "chapter8" / "images"
DEFAULT_SHAPE = 16_777_216
SCOPE = "gpu-event-single-kernel"


@dataclass(frozen=True)
class Round:
    name: str
    title: str
    panels: tuple[tuple[str, tuple[str, ...]], ...]
    notes: tuple[str, ...]


ROUNDS = (
    Round(
        "address", "地址排列对照",
        (("", ("hip-v1-contiguous", "hip-v1-strided")),),
        ("同一份工作量、相同 block 和 grid，仅比较两种地址分工。",),
    ),
    Round(
        "grid", "固定 kernel 的 grid 扫描",
        (("自然基线（独立参考）", ("hip-v0",)),
         ("同一份 v2 源码", ("hip-v2-g65536", "hip-v2-g2048", "hip-v2-g256"))),
        ("扫描只比较三个 v2 配置；v0 与 v2 的分工不同。",),
    ),
    Round(
        "vector", "相同 grid 下的向量化对照",
        (("自然基线（独立参考）", ("hip-v0",)),
         ("固定 grid=256 的对照", ("hip-v2-g256", "hip-v3-g256"))),
        ("v2 使用标量，v3 使用 float4；v0 仅作独立参考。",),
    ),
    Round(
        "triton", "Triton 数据块扫描",
        (("", ("triton-t0-b256", "triton-t1-b512", "triton-t1-b1024", "triton-t1-b2048")),),
        ("固定 num_warps；BLOCK_SIZE 改变时，program 数相应变化。",),
    ),
    Round(
        "summary", "同一输入下的配置汇总",
        (("", ("hip-v0", "hip-v1-contiguous", "hip-v1-strided", "hip-v2-g65536",
                "hip-v2-g256", "hip-v3-g256", "triton-t0-b256", "triton-t1-b1024")),),
        ("按教学顺序排列；这些配置的分工不同。",),
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=DEFAULT_EVIDENCE / "summary.csv")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_EVIDENCE / "manifest.json")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--shape", type=int, default=DEFAULT_SHAPE)
    parser.add_argument("--round", choices=[r.name for r in ROUNDS], action="append",
                        dest="rounds", help="Render only the named round; may be repeated.")
    parser.add_argument("--formats", nargs="+", choices=("png", "svg"), default=("png", "svg"))
    parser.add_argument("--validate-only", action="store_true",
                        help="Validate selected records and controls without creating images.")
    return parser.parse_args()


def read_rows(path: Path, manifest: dict[str, Any]) -> list[dict[str, str]]:
    """Parse the same CSV bytes whose identity is bound by the manifest."""
    expected = manifest.get("artifacts_sha256", {}).get("summary.csv")
    if not isinstance(expected, str) or len(expected) != 64 or any(
        char not in "0123456789abcdef" for char in expected.lower()
    ):
        raise ValueError(
            "Missing manifest.artifacts_sha256['summary.csv']; regenerate the "
            "evidence with the updated summarize_rounds.py before plotting"
        )
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected.lower():
        raise ValueError(
            f"{path}: SHA-256 differs from manifest.artifacts_sha256['summary.csv']; "
            "use the summary and manifest from the same experiment"
        )
    rows = list(csv.DictReader(io.StringIO(data.decode("utf-8"), newline="")))
    if not rows:
        raise ValueError(f"Empty summary: {path}")
    return rows


def required_text(value: Any, name: str) -> str:
    if value is None or str(value).strip() in {"", "NA", "unavailable"}:
        raise ValueError(f"Missing {name}")
    return str(value).strip()


def select_rows(
    rows: list[dict[str, str]], manifest: dict[str, Any], shape: int,
    rounds: tuple[Round, ...],
) -> dict[str, dict[str, str]]:
    """Require measured, comparable records for every requested chart."""
    if shape <= 0:
        raise ValueError("Shape must be positive")
    required_text(manifest.get("hardware"), "manifest.hardware")
    software = manifest.get("software", {})
    required_text(software.get("rocm"), "manifest.software.rocm")
    benchmark = manifest.get("benchmark", {})
    main_shape = int(benchmark.get("shape", benchmark.get("size", 0)))
    if main_shape <= 0 or ("size" in benchmark and int(benchmark["size"]) != main_shape):
        raise ValueError("Manifest benchmark.shape/size must declare one positive main shape")
    validation_shapes = manifest.get("validation_selection", {}).get("shapes", [])
    if not isinstance(validation_shapes, list) or any(int(value) <= 0 for value in validation_shapes):
        raise ValueError("Manifest validation_selection.shapes must list positive shapes")
    if shape not in {main_shape, *(int(value) for value in validation_shapes)}:
        raise ValueError(f"N={shape} is not declared by this manifest")
    expected_runs = int(benchmark["independent_runs"])
    if expected_runs < 2:
        raise ValueError("Round figures require multiple independent processes")
    manifest_scope = required_text(benchmark.get("scope"), "manifest.benchmark.scope")
    if manifest_scope != SCOPE or manifest.get("scope", manifest_scope) != manifest_scope:
        raise ValueError(f"Manifest must declare scope={SCOPE}")
    manifest_dtype = required_text(benchmark.get("dtype"), "manifest.benchmark.dtype")
    if manifest_dtype not in {"float32", "fp32"}:
        raise ValueError("Manifest must declare FP32")
    expected_parameters = {
        field: int(required_text(benchmark.get(field), f"manifest.benchmark.{field}"))
        for field in ("warmup", "repeat", "seed")
    }
    required_ids = {name for spec in rounds for _, ids in spec.panels for name in ids}
    selected: dict[str, dict[str, str]] = {}
    for row in rows:
        if int(row["shape"]) != shape or row["config_id"] not in required_ids:
            continue
        config = row["config_id"]
        if config in selected:
            raise ValueError(f"Duplicate {config} at N={shape}; do not mix timing scopes")
        scope = row.get("scope")
        if scope != manifest_scope:
            raise ValueError(f"{config}: expected scope={SCOPE}, got {scope!r}")
        if row.get("correct") != "OK":
            raise ValueError(f"{config}: correctness is not OK")
        if row["runtime"] not in {"hip", "triton"}:
            raise ValueError(f"{config}: unexpected runtime {row['runtime']!r}")
        if row["dtype"] not in {"float32", "fp32"}:
            raise ValueError(f"{config}: dtype differs from the manifest's FP32 declaration")
        for field, expected in expected_parameters.items():
            if int(row[field]) != expected:
                raise ValueError(f"{config}: {field} differs from manifest.benchmark.{field}")
        if int(row["run_count"]) != expected_runs:
            raise ValueError(f"{config}: independent-process count differs from manifest")
        values = [float(row[key]) for key in ("median_ms_run_min", "median_ms", "median_ms_run_max")]
        if not all(math.isfinite(value) for value in values) or not 0 < values[0] <= values[1] <= values[2]:
            raise ValueError(f"{config}: invalid process-median range {values}")
        for field in ("block", "grid", "warmup", "repeat"):
            if int(row[field]) <= 0:
                raise ValueError(f"{config}: invalid {field}")
        if row["runtime"] == "triton" and int(row["num_warps"]) <= 0:
            raise ValueError(f"{config}: missing Triton num_warps")
        selected[config] = row
    missing = sorted(required_ids - selected.keys())
    if missing:
        raise ValueError(f"Missing N={shape} round records: {', '.join(missing)}")
    for field in ("warmup", "repeat", "seed"):
        if len({row[field] for row in selected.values()}) != 1:
            raise ValueError(f"Selected rows do not share {field}")
    for spec in rounds:
        validate_controls(spec, selected, shape)
    return selected


def validate_controls(spec: Round, rows: dict[str, dict[str, str]], shape: int) -> None:
    ids = [name for _, panel_ids in spec.panels for name in panel_ids]
    if spec.name in {"address", "vector"}:
        pair_ids = ids if spec.name == "address" else ["hip-v2-g256", "hip-v3-g256"]
        for field in ("block", "grid"):
            if len({rows[name][field] for name in pair_ids}) != 1:
                raise ValueError(f"{spec.name}: compared configurations must share {field}")
    if spec.name == "grid":
        scan = [rows[name] for name in ids if name.startswith("hip-v2-")]
        if len({row["implementation"] for row in scan}) != 1 or len({row["block"] for row in scan}) != 1:
            raise ValueError("Grid scan must keep the v2 kernel and block fixed")
        if {int(row["grid"]) for row in scan} != {65536, 2048, 256}:
            raise ValueError("Grid scan does not contain the declared three grids")
    if spec.name == "triton":
        scan = [rows[name] for name in ids]
        if len({row["num_warps"] for row in scan}) != 1:
            raise ValueError("Triton tile scan must keep num_warps fixed")
        if {int(row["block"]) for row in scan} != {256, 512, 1024, 2048}:
            raise ValueError("Triton scan does not contain the declared four tiles")
        for row in scan:
            if int(row["grid"]) != (shape + int(row["block"]) - 1) // int(row["block"]):
                raise ValueError(f"{row['config_id']}: grid does not cover N using the declared tile")


def row_label(row: dict[str, str], spec: Round) -> str:
    implementation = row["implementation"]
    short = implementation.removeprefix("hip-").removeprefix("triton-")
    grid = int(row["grid"])
    block = int(row["block"])
    if spec.name == "triton":
        return f"{short} · BLOCK_SIZE={block}\ngrid={grid:,}"
    if spec.name == "summary":
        if row["runtime"] == "triton":
            return f"Triton {short}\nBLOCK_SIZE={block}"
        return f"HIP {short}\ngrid={grid:,}"
    if spec.name == "address":
        return f"{short}\ngrid={grid:,}"
    return f"{short} · grid={grid:,}"


def render_round(
    spec: Round, rows: dict[str, dict[str, str]], manifest: dict[str, Any],
    shape: int, output_dir: Path, formats: list[str],
) -> None:
    configure_style()
    all_ids = [name for _, panel_ids in spec.panels for name in panel_ids]
    selected = [rows[name] for name in all_ids]
    max_high = max(float(row["median_ms_run_max"]) for row in selected)
    xmax = max_high * 1.30
    panels = len(spec.panels)
    height = 9.2 if spec.name == "summary" else (7.2 if panels > 1 else 5.8)
    fig, axes = plt.subplots(panels, 1, figsize=(8.8, height), dpi=300, squeeze=False,
                             gridspec_kw={"height_ratios": [len(ids) + 0.5 for _, ids in spec.panels]})
    fig.subplots_adjust(left=0.35 if spec.name in {"triton", "summary"} else 0.31,
                        right=0.97, top=0.73 if panels > 1 else 0.76,
                        bottom=0.22, hspace=0.76)
    for ax, (panel_title, ids) in zip(axes.flat, spec.panels, strict=True):
        panel_rows = [rows[name] for name in ids]
        medians = [float(row["median_ms"]) for row in panel_rows]
        lows = [float(row["median_ms_run_min"]) for row in panel_rows]
        highs = [float(row["median_ms_run_max"]) for row in panel_rows]
        colors = [PALETTE["hip_baseline"] if row["config_id"] == "hip-v0" else PALETTE[row["runtime"]]
                  for row in panel_rows]
        bars = ax.barh(range(len(ids)), medians, height=0.56,
                       xerr=[[median - low for median, low in zip(medians, lows, strict=True)],
                             [high - median for median, high in zip(medians, highs, strict=True)]],
                       color=colors, edgecolor="black", linewidth=1.5,
                       error_kw={"ecolor": PALETTE["ink"], "capsize": 5, "elinewidth": 2})
        for index, (bar, row, median, high) in enumerate(zip(bars, panel_rows, medians, highs, strict=True)):
            if spec.name == "vector" and index == 1:
                bar.set_hatch("//")
            ax.text(high + xmax * 0.025, bar.get_y() + bar.get_height() / 2,
                    f"{median:.3g}", ha="left", va="center", fontsize=16,
                    color=PALETTE["ink"], fontweight=600)
        ax.set_yticks(range(len(ids)), [row_label(row, spec) for row in panel_rows])
        ax.invert_yaxis()
        ax.set_xlim(0, xmax)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=5, min_n_ticks=4))
        ax.xaxis.grid(True, color=PALETTE["grid"], linewidth=0.8, alpha=0.6)
        ax.set_axisbelow(True)
        ax.tick_params(axis="both", length=6, width=1.5, labelsize=16, pad=4)
        if panel_title:
            ax.set_title(panel_title, loc="left", fontsize=16, color=PALETTE["ink"], pad=14)
        if ax is axes.flat[-1]:
            ax.set_xlabel("时间（ms，越短越快）", fontsize=17, labelpad=11)

    fig.suptitle(spec.title, x=0.03, y=0.982, ha="left", fontsize=22,
                 color=PALETTE["ink"], fontweight=600)
    hardware = required_text(manifest["hardware"], "hardware")
    rocm = required_text(manifest["software"]["rocm"], "software.rocm")
    fig.text(0.03, 0.913, f"{hardware} · ROCm {rocm}", fontsize=14,
             color=PALETTE["muted"], va="top")
    config_note = ""
    if spec.name in {"address", "grid", "vector"}:
        blocks = {row["block"] for row in selected}
        if len(blocks) == 1:
            config_note = f" · block={blocks.pop()}"
    elif spec.name == "triton":
        config_note = f" · num_warps={selected[0]['num_warps']}"
    fig.text(0.03, 0.864, f"N={shape:,} · FP32 · 单 kernel GPU event{config_note}",
             fontsize=14, color=PALETTE["muted"], va="top")
    if spec.name == "summary":
        fig.legend(handles=[Patch(facecolor=PALETTE[runtime], edgecolor="black", label=label)
                            for runtime, label in (("hip", "HIP"), ("triton", "Triton"))],
                   loc="upper right", bbox_to_anchor=(0.98, 0.985), ncols=2, fontsize=13)
    count = int(selected[0]["run_count"])
    notes = [f"柱长：{count} 个进程 median 的中位数；误差线：进程范围。", *spec.notes]
    if spec.name == "summary":
        hip_blocks = sorted({int(row["block"]) for row in selected if row["runtime"] == "hip"})
        triton_warps = sorted({int(row["num_warps"]) for row in selected if row["runtime"] == "triton"})
        notes.append(f"HIP block={','.join(map(str, hip_blocks))}；Triton num_warps={','.join(map(str, triton_warps))}。")
    for index, note in enumerate(reversed(notes)):
        fig.text(0.03, 0.025 + index * (0.04 if height < 7 else 0.03), note,
                 fontsize=12.5, va="bottom", color=PALETTE["muted"])
    # Catch cut-off configuration labels before publishing either format.
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    for text in [*fig.texts, *(label for ax in axes.flat for label in ax.get_yticklabels())]:
        bounds = text.get_window_extent(renderer)
        if bounds.x0 < -1 or bounds.x1 > fig.bbox.width + 1:
            plt.close(fig)
            raise ValueError(f"{spec.name}: chart text would be clipped: {text.get_text()!r}")
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = output_dir / f"round-{spec.name}"
    for extension in formats:
        path = stem.with_suffix(f".{extension}")
        fig.savefig(path, dpi=300, metadata={"Date": None} if extension == "svg" else None)
        if extension == "svg":
            path.write_text("\n".join(line.rstrip() for line in path.read_text().splitlines()) + "\n")
        print(path)
    plt.close(fig)


def main() -> None:
    args = parse_args()
    rounds = tuple(spec for spec in ROUNDS if args.rounds is None or spec.name in args.rounds)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    rows = select_rows(read_rows(args.summary, manifest), manifest, args.shape, rounds)
    if args.validate_only:
        print(f"Validated {len(rows)} measured configurations for {len(rounds)} rounds at N={args.shape}")
        return
    for spec in rounds:
        render_round(spec, rows, manifest, args.shape, args.out_dir, args.formats)


if __name__ == "__main__":
    main()
