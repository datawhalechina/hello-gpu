"""Render Chapter 10's verified full-path optimization rounds, without GPU work.

Every chart uses one shape, one archived experiment and independent-process
ranges. The summary and process records must match their manifest SHA-256s.
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
from statistics import median
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
PART_DIR = SCRIPT_DIR.parent
REPO_ROOT = SCRIPT_DIR.parents[2]
sys.path.insert(0, str(PART_DIR))
from common.plot_style import PALETTE, configure_style
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator

DEFAULT_EVIDENCE = SCRIPT_DIR / "evidence" / "rounds"
DEFAULT_OUTPUT = REPO_ROOT / "docs" / "part2-kernels" / "chapter10" / "images"
SCOPE = "gpu-event-full-operator"


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


@dataclass(frozen=True)
class Round:
    name: str
    title: str
    panels: tuple[tuple[str, tuple[str, ...]], ...]
    notes: tuple[str, ...]


ROUNDS = (
    Round("cooperative", "行内分工对照",
          (("同为三阶段：从串行扫描到 block 协作",
            ("hip-serial-b256", "hip-cooperative-b256")),),
          ("serial 用于理解分工；cooperative 是后续 HIP 的性能基线。",)),
    Round("fusion", "相同行内协作下的融合",
          (("保留行内协作，比较完整 Softmax",
            ("hip-cooperative-b256", "hip-fused-b256")),),
          ("cooperative 包含三次 kernel；fused 包含一次 kernel。",)),
    Round("warps", "固定数据块，调整执行配置",
          (("BLOCK_SIZE=B", ("triton-b4", "triton-b8")),
           ("BLOCK_SIZE=2B", ("triton-2b4", "triton-2b8"))),
          ("B 为覆盖一整行的最小 2 的幂；每组只比较 num_warps。",)),
    Round("tile", "固定执行配置，调整数据块",
          (("num_warps=4", ("triton-b4", "triton-2b4")),
           ("num_warps=8", ("triton-b8", "triton-2b8"))),
          ("B 为覆盖一整行的最小 2 的幂；每组只比较 BLOCK_SIZE。",)),
)


def read_csv(path: Path, manifest: dict[str, Any]) -> list[dict[str, str]]:
    expected = manifest.get("artifacts_sha256", {}).get(path.name)
    if not isinstance(expected, str) or len(expected) != 64:
        raise ValueError(f"Missing artifact SHA-256 for {path.name}; regenerate the evidence summary")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"{path}: summary and manifest are not from the same verified experiment")
    rows = list(csv.DictReader(io.StringIO(data.decode("utf-8"), newline="")))
    if not rows:
        raise ValueError(f"Empty evidence: {path}")
    return rows


def parse_shape(shape: str) -> tuple[int, int]:
    parts = shape.split("x")
    if len(parts) != 2 or any(not item.isdecimal() or int(item) <= 0 for item in parts):
        raise ValueError(f"Expected a positive ROWSxCOLUMNS shape, got {shape!r}")
    return tuple(int(item) for item in parts)


def finite_range(row: dict[str, Any]) -> tuple[float, float, float]:
    values = tuple(float(row[field]) for field in ("median_ms_run_min", "median_ms", "median_ms_run_max"))
    if not all(math.isfinite(value) for value in values) or not 0 < values[0] <= values[1] <= values[2]:
        raise ValueError(f"Invalid process-median range: {values}")
    return values


def load_rows(evidence: Path, shape: str, rounds: tuple[Round, ...], *,
              confirmation_file: str | None = None) -> tuple[dict[str, Any], dict[str, dict[str, str]]]:
    manifest = json.loads((evidence / "manifest.json").read_text(encoding="utf-8"))
    if confirmation_file:
        data = (evidence / confirmation_file).read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest.get("artifacts_sha256", {}).get(confirmation_file):
            raise ValueError(f"{confirmation_file}: confirmation does not match the published manifest")
        confirmed = json.loads(data)
        if not confirmed["experiment"].startswith("chapter10-") or not confirmed["main_matrix_unchanged"]:
            raise ValueError("Expected an independent Chapter 10 confirmation")
        if confirmed["source_sha256"] != manifest["source_sha256"] or confirmed["build"]["binary_sha256"] != manifest["build"]["binary_sha256"]:
            raise ValueError("Confirmation does not use the same frozen source and binary")
        allowed_shapes = {manifest["benchmark"]["shape"], *manifest.get("validation_selection", {}).get("shapes", [])}
        if confirmed["benchmark"]["shape"] not in allowed_shapes:
            raise ValueError("Confirmation shape is not part of the declared experiment")
        for field in ("dtype", "input", "reference", "seed", "warmup", "repeat", "scope"):
            if confirmed["benchmark"][field] != manifest["benchmark"][field]:
                raise ValueError(f"Confirmation benchmark differs in {field}")
        for field in ("gpu", "rocm_sdk"):
            if confirmed["environment"][field] != manifest["environment"][field]:
                raise ValueError(f"Confirmation environment differs in {field}")
        manifest = confirmed
        summary_rows, processes = manifest["results"], manifest["process_results"]
    else:
        summary_rows = read_csv(evidence / "summary.csv", manifest)
        processes = read_csv(evidence / "process-summary.csv", manifest)
    benchmark, environment = manifest["benchmark"], manifest["environment"]
    if not environment.get("gpu") or not environment.get("rocm_sdk"):
        raise ValueError("Missing GPU or ROCm identity")
    if benchmark["scope"] != SCOPE or benchmark["dtype"] not in {"float32", "fp32"}:
        raise ValueError("Softmax rounds require FP32 and full-operator GPU event timing")
    parse_shape(shape)
    main_shape = str(benchmark["shape"])
    declared = {main_shape, *manifest.get("validation_selection", {}).get("shapes", [])}
    if shape not in declared:
        raise ValueError(f"Shape {shape} is not declared in the manifest")
    runs = int(benchmark.get("independent_runs", benchmark.get("processes", 0)))
    if runs < 2:
        raise ValueError("Multiple independent processes are required")
    required = {config for spec in rounds for _, configs in spec.panels for config in configs}
    selected = {}
    for row in summary_rows:
        if row["shape"] != shape or row["config_id"] not in required:
            continue
        config = row["config_id"]
        if config in selected:
            raise ValueError(f"Duplicate {config} at shape {shape}")
        if row["scope"] != SCOPE or row["dtype"] not in {"float32", "fp32"}:
            raise ValueError(f"{config}: dtype or timing scope differs from manifest")
        if row["correct"] != "OK" or int(row["run_count"]) != runs:
            raise ValueError(f"{config}: incomplete runs or failed correctness")
        for field in ("warmup", "repeat", "seed"):
            if int(row[field]) != int(benchmark[field]):
                raise ValueError(f"{config}: {field} differs from the manifest")
        if row.get("input") != benchmark.get("input"):
            raise ValueError(f"{config}: input differs from the manifest")
        low, center, high = finite_range(row)
        if min(int(row[field]) for field in ("grid", "block", "launches")) <= 0:
            raise ValueError(f"{config}: invalid launch configuration")
        expected_launches = 3 if config in {"hip-serial-b256", "hip-cooperative-b256"} else 1
        if int(row["launches"]) != expected_launches:
            raise ValueError(f"{config}: incorrect complete-path launch count")
        if row["runtime"] == "hip":
            if int(row["block"]) != 256:
                raise ValueError(f"{config}: HIP block must remain 256")
            row_count = parse_shape(shape)[0]
            expected_grid = (row_count + 255) // 256 if config == "hip-serial-b256" else row_count
            if int(row["grid"]) != expected_grid:
                raise ValueError(f"{config}: first-stage grid differs from its row mapping")
        elif row["runtime"] == "triton":
            columns = parse_shape(shape)[1]
            base = 1 << (columns - 1).bit_length()
            expected_block = base * (2 if config.startswith("triton-2b") else 1)
            expected_warps = int(config[-1])
            if int(row["block"]) != expected_block or int(row["num_warps"]) != expected_warps:
                raise ValueError(f"{config}: Triton tile or execution configuration differs from its label")
            if int(row["grid"]) != parse_shape(shape)[0]:
                raise ValueError(f"{config}: expected one program per row")
        else:
            raise ValueError(f"{config}: unexpected runtime")
        group = [item for item in processes if item["shape"] == shape and item["config_id"] == config]
        if sorted(int(item["process"]) for item in group) != list(range(1, runs + 1)):
            raise ValueError(f"{config}: duplicate or missing process summaries")
        for item in group:
            for field in ("implementation", "runtime", "dtype", "block", "num_warps", "scope", "launches", "warmup", "repeat", "seed", "input"):
                if item[field] != row[field]:
                    raise ValueError(f"{config}: process metadata mismatch in {field}")
            if item["correct"] != "OK" or int(item["sample_count"]) != int(row["repeat"]):
                raise ValueError(f"{config}: incorrect or incomplete process")
        medians = [float(item["median_ms"]) for item in group]
        for actual, expected in zip((low, center, high), (min(medians), median(medians), max(medians)), strict=True):
            if not math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-12):
                raise ValueError(f"{config}: aggregate differs from independent-process medians")
        selected[config] = row
    if missing := required - selected.keys():
        raise ValueError(f"Missing {shape} round records: {', '.join(sorted(missing))}")
    return manifest, selected


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
    height = 3.0 + 2.3 * count if count >= 3 else 3.7 + 0.52 * len(all_values) + 0.7 * count
    fig, axes = plt.subplots(count, 1, figsize=(8.8, height), dpi=300, squeeze=False,
                             gridspec_kw={"height_ratios": [len(panel.values) + 0.6 for panel in panels]})
    fig.subplots_adjust(left=0.36, right=0.96, top=1 - 1.72 / height,
                        bottom=1.75 / height, hspace=0.88 if count >= 3 else 1.45)
    shared_max = max(value.high_ms for value in all_values) * 1000 * 1.30
    axis_titles = []
    for ax, panel in zip(axes.flat, panels, strict=True):
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
        ax.invert_yaxis()
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
    footnotes = (f"柱长：{runs.pop()} 个进程 median 的中位数；误差线：进程范围。", *notes)
    for index, note in enumerate(reversed(footnotes)):
        fig.text(0.03, (0.18 + 0.25 * index) / height, note, fontsize=12.5,
                 color=PALETTE["muted"], va="bottom")
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    texts = [*fig.texts, *axis_titles,
             *(label for ax in axes.flat for label in [*ax.get_yticklabels(), ax.xaxis.label])]
    for text in texts:
        bounds = text.get_window_extent(renderer)
        if bounds.x0 < -1 or bounds.x1 > fig.bbox.width + 1 or bounds.y0 < -1 or bounds.y1 > fig.bbox.height + 1:
            plt.close(fig)
            raise ValueError(f"{name}: clipped text: {text.get_text()!r}")
    for previous, following_title in zip(list(axes.flat)[:-1], axis_titles[1:]):
        if previous.xaxis.label.get_window_extent(renderer).overlaps(following_title.get_window_extent(renderer)):
            plt.close(fig)
            raise ValueError(f"{name}: adjacent panel labels overlap")
    output.mkdir(parents=True, exist_ok=True)
    for extension in formats:
        path = output / f"round-{name}.{extension}"
        fig.savefig(path, dpi=300, metadata={"Date": None} if extension == "svg" else None)
        if extension == "svg":
            path.write_text("\n".join(line.rstrip() for line in path.read_text().splitlines()) + "\n")
        print(path)
    plt.close(fig)



def measurement(row: dict[str, str]) -> Measurement:
    config = row["config_id"]
    low, center, high = finite_range(row)
    if row["runtime"] == "hip":
        label = config.removeprefix("hip-").removesuffix("-b256")
        label += "\n性能基线" if config == "hip-cooperative-b256" else ""
    else:
        label = f"BLOCK_SIZE={int(row['block']):,}\nnum_warps={row['num_warps']}"
        if config == "triton-b4":
            label += "（基线）"
    return Measurement(config, label, row["runtime"], center, low, high, int(row["run_count"]),
                       baseline=config in {"hip-cooperative-b256", "triton-b4"},
                       hatch="//" if config in {"hip-fused-b256", "triton-2b4", "triton-2b8"} else "")


def render_round(spec: Round, rows: dict[str, dict[str, str]], manifest: dict[str, Any],
                 shape: str, output: Path, formats: list[str]) -> None:
    columns = parse_shape(shape)[1]
    base = 1 << (columns - 1).bit_length()
    panels = []
    for title, configs in spec.panels:
        values = [measurement(rows[config]) for config in configs]
        panels.append(Panel(title.replace("=2B", f"={2 * base:,}（2B）").replace("=B", f"={base:,}（B）"), tuple(values)))
    env = manifest["environment"]
    context = f"形状 {shape.replace('x', '×')} · FP32 · 完整算子 GPU event"
    notes = spec.notes
    if spec.name in {"cooperative", "fusion"}:
        notes += ("HIP block=256；只比较同一输入、同一计时区间的实现。",)
    else:
        notes += ("两面板采用相同刻度；BLOCK_SIZE 是逻辑元素数。",)
    render_panels(name=spec.name, title=spec.title,
                  subtitle=f"{env['gpu']} · ROCm {env['rocm_sdk']}", context=context,
                  panels=tuple(panels), notes=notes, output=output, formats=formats)


SHAPES = ("4096x1023", "4096x1024", "4096x1025", "128x1024")
SHAPE_ROUND = Round("shapes", "", (("", ("triton-b4", "triton-b8")),), ())


def render_shapes(data: list[tuple[dict[str, Any], dict[str, dict[str, str]]]],
                  output: Path, formats: list[str]) -> None:
    env = data[0][0]["environment"]
    panels = tuple(Panel(f"形状 {shape.replace('x', '×')}",
                         tuple(measurement(rows[config]) for config in ("triton-b4", "triton-b8")))
                   for shape, (_, rows) in zip(SHAPES, data, strict=True))
    render_panels(name="shapes", title="输入形状与 Triton 执行配置",
                  subtitle=f"{env['gpu']} · ROCm {env['rocm_sdk']}",
                  context="FP32 · 每行一个 program · 完整算子 GPU event",
                  panels=panels, output=output, formats=formats, independent_axes=True,
                  notes=("各形状采用独立刻度，均从 0 起；只在同一面板内比较。",
                         "每组固定覆盖该行的最小 BLOCK_SIZE，只改变 num_warps。"))


def render_confirmation(data: list[tuple[dict[str, Any], dict[str, dict[str, str]]]],
                        output: Path, formats: list[str]) -> None:
    env = data[0][0]["environment"]
    panels = (
        Panel("HIP · 4096×1024 · block=256", tuple(measurement(data[0][1][config]) for config in
                                      ("hip-cooperative-b256", "hip-fused-b256"))),
        Panel("Triton · 4096×1025", tuple(measurement(data[1][1][config]) for config in
                                         ("triton-b4", "triton-b8"))),
    )
    render_panels(name="confirmation", title="独立复测：融合与执行配置",
                  subtitle=f"{env['gpu']} · ROCm {env['rocm_sdk']}",
                  context="FP32 · 独立复测 · 完整算子 GPU event",
                  panels=panels, output=output, formats=formats, independent_axes=True,
                  notes=("两面板的形状和刻度不同，均从 0 起；请在面板内比较。",
                         "分别采集的独立复测；不与首次扫描合并统计。"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--shape", default="4096x1024")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--round", choices=[*(spec.name for spec in ROUNDS), "shapes", "confirmation"], action="append", dest="rounds")
    parser.add_argument("--formats", choices=("png", "svg"), nargs="+", default=("png", "svg"))
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    rounds = tuple(spec for spec in ROUNDS if not args.rounds or spec.name in args.rounds)
    main_data = load_rows(args.evidence, args.shape, rounds) if rounds else None
    shape_data = [load_rows(args.evidence, shape, (SHAPE_ROUND,)) for shape in SHAPES] if not args.rounds or "shapes" in args.rounds else None
    confirmation_data = None
    if not args.rounds or "confirmation" in args.rounds:
        confirmation_data = [
            load_rows(args.evidence, "4096x1024", (ROUNDS[1],), confirmation_file="confirmation.json"),
            load_rows(args.evidence, "4096x1025", (SHAPE_ROUND,), confirmation_file="shape-confirmation.json"),
        ]
    if args.validate_only:
        if main_data:
            print(f"Validated {len(main_data[1])} configurations across {len(rounds)} rounds at {args.shape}")
        if shape_data:
            print("Validated four shapes of fixed-width Triton execution comparisons")
        if confirmation_data:
            print("Validated separate HIP main-shape and Triton tail-shape confirmation pairs")
        return
    if main_data:
        manifest, rows = main_data
        for spec in rounds:
            render_round(spec, rows, manifest, args.shape, args.out_dir, args.formats)
    if shape_data:
        render_shapes(shape_data, args.out_dir, args.formats)
    if confirmation_data:
        render_confirmation(confirmation_data, args.out_dir, args.formats)


if __name__ == "__main__":
    main()
