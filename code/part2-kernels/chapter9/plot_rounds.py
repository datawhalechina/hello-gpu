"""Plot measured Chapter 9 rounds without mixing experiments or timing scopes.

The tree-layout case uses its own archived partial/two-stage intervals. Main
optimization rounds read evidence/rounds only. No GPU work is performed here.
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

DEFAULT_OUTPUT = REPO_ROOT / "docs" / "part2-kernels" / "chapter9" / "images"
TREE_SIZES = (1024, 65536, 1048576, 16777216)
TREE_VERSIONS = ("sequential", "interleaved", "compacted")
TREE_LABELS = {"sequential": "A · 半距配对", "interleaved": "B · 邻接／隔位线程",
               "compacted": "C · 邻接／连续线程"}
MAIN_SCOPE = "gpu-event-full-operator"


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


def read_csv(path: Path, hashes: dict[str, str]) -> list[dict[str, str]]:
    expected = hashes.get(path.name)
    if not isinstance(expected, str) or len(expected) != 64:
        raise ValueError(f"Missing manifest artifact SHA-256 for {path.name}; regenerate its evidence summary")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"{path}: evidence bytes do not match this manifest")
    rows = list(csv.DictReader(io.StringIO(data.decode("utf-8"), newline="")))
    if not rows:
        raise ValueError(f"Empty evidence: {path}")
    return rows


def finite_range(low: str | float, center: str | float, high: str | float) -> tuple[float, float, float]:
    values = tuple(float(value) for value in (low, center, high))
    if not all(math.isfinite(value) for value in values) or not 0 < values[0] <= values[1] <= values[2]:
        raise ValueError(f"Invalid process-median range: {values}")
    return values


def required_text(value: Any, name: str) -> str:
    if value is None or str(value).strip() in {"", "NA", "unavailable"}:
        raise ValueError(f"Missing {name}")
    return str(value).strip()


def load_tree(evidence: Path) -> tuple[dict[str, Any], dict[tuple[int, str, str], Measurement]]:
    manifest = json.loads((evidence / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("experiment") != "chapter9-reduction-tree-layout":
        raise ValueError("Expected the independent tree-layout experiment")
    environment, benchmark = manifest["environment"], manifest["benchmark"]
    required_text(environment.get("gpu"), "environment.gpu")
    required_text(environment.get("rocm_sdk"), "environment.rocm_sdk")
    if benchmark["dtype"] != "float32" or tuple(benchmark["sizes"]) != TREE_SIZES:
        raise ValueError("Tree figures require the four declared FP32 shapes")
    if set(benchmark["intervals"]) != {"partial", "two-stage"}:
        raise ValueError("Tree partial and two-stage intervals must remain separate")
    runs = int(benchmark["independent_processes_per_size"])
    if runs < 2:
        raise ValueError("Multiple independent processes are required")
    correct = manifest["correctness"]
    if not correct["benchmark_pre_post"].startswith("All 12 logs:"):
        raise ValueError("The tree manifest must retain its benchmark correctness evidence")
    if any(row["correct"] != "OK" for row in correct["edge_logs"]):
        raise ValueError("Tree edge-case correctness did not pass")
    rows = read_csv(evidence / "summary.csv", manifest.get("outputs", {}))
    process_rows = read_csv(evidence / "process-summary.csv", manifest.get("outputs", {}))
    result = {}
    for row in rows:
        key = (int(row["size"]), row["version"], row["interval"])
        if key in result:
            raise ValueError(f"Duplicate tree record: {key}")
        if key[0] not in TREE_SIZES or key[1] not in TREE_VERSIONS or key[2] not in benchmark["intervals"]:
            raise ValueError(f"Unexpected tree record: {key}")
        for field in ("block", "seed", "input"):
            if row[field] != str(benchmark[field]):
                raise ValueError(f"Tree {key}: {field} differs from manifest")
        if int(row["process_count"]) != runs:
            raise ValueError(f"Tree {key}: incorrect independent-process count")
        low, center, high = finite_range(row["minimum_process_median_ms"],
                                        row["median_of_process_medians_ms"], row["maximum_process_median_ms"])
        processes = [item for item in process_rows
                     if (int(item["size"]), item["version"], item["interval"]) == key]
        if len(processes) != runs or len({item["process"] for item in processes}) != runs:
            raise ValueError(f"Tree {key}: missing or duplicate process summaries")
        for item in processes:
            for field in ("block", "seed", "input"):
                if item[field] != row[field]:
                    raise ValueError(f"Tree {key}: process configuration mismatch")
            if int(item["samples"]) != int(benchmark["repeat_per_version_per_interval_per_process"]):
                raise ValueError(f"Tree {key}: incomplete process")
        values = [float(item["median_ms"]) for item in processes]
        for actual, expected in zip((low, center, high), (min(values), median(values), max(values)), strict=True):
            if not math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-12):
                raise ValueError(f"Tree {key}: summary does not match independent-process medians")
        version_index = TREE_VERSIONS.index(key[1])
        result[key] = Measurement(key[1], TREE_LABELS[key[1]], "hip", center, low, high, runs,
                                  baseline=version_index == 0, hatch=("", "//", "xx")[version_index])
    if len(result) != len(TREE_SIZES) * len(TREE_VERSIONS) * 2:
        raise ValueError("Incomplete tree-layout matrix")
    return manifest, result


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


def render_tree(manifest: dict[str, Any], values: dict[tuple[int, str, str], Measurement],
                interval: str, output: Path, formats: list[str]) -> None:
    environment = manifest["environment"]
    partial = interval == "partial"
    panels = tuple(Panel(f"N={size:,}", tuple(values[size, version, interval] for version in TREE_VERSIONS))
                   for size in TREE_SIZES)
    render_panels(name="mapping-partial" if partial else "mapping-full",
                  title="局部归约映射：第一阶段" if partial else "局部归约映射：完整两阶段",
                  subtitle=f"{environment['gpu']} · ROCm {environment['rocm_sdk']}",
                  context="FP32 · block=256 · partial：仅第一阶段" if partial
                          else "FP32 · block=256 · two-stage：第一阶段＋共同最终合并",
                  panels=panels, output=output, formats=formats, independent_axes=True,
                  notes=("每个 N 使用独立刻度，均从 0 起；请在同一面板内比较。",
                         "A 为半距树；B/C 采用相同邻接树、不同线程映射。"))


@dataclass(frozen=True)
class MainRound:
    name: str
    title: str
    panels: tuple[tuple[str, tuple[str, ...]], ...]
    note: str


MAIN_ROUNDS = (
    MainRound("merge", "最终合并方式对照",
              (("首阶段使用相同的每线程加载与 LDS 树", ("hip-block-atomic", "hip-partials")),),
              "HIP block=256；原子版含清零，两阶段版含最终合并。"),
    MainRound("grid", "局部累加与 grid 扫描",
              (("路线基线（独立参考）", ("hip-block-atomic",)),
               ("保留完整 grid 桥接，再扫描同一 local-lds", ("hip-partials", "hip-local-lds-g65536",
                                                            "hip-local-lds-g1024", "hip-local-lds-g256"))),
              "HIP block=256；全 grid 用于桥接，其余固定 local-lds 扫描。"),
    MainRound("wave", "同一 grid 下的局部归约",
              (("路线基线（独立参考）", ("hip-block-atomic",)),
               ("固定局部累加、grid 与最终合并", ("hip-local-lds-g256", "hip-local-wave-g256"))),
              "HIP block=256；首阶段改为 wave＋LDS，计时包含最终合并。"),
    MainRound("triton", "Triton program 数量扫描",
              (("", ("triton-p1024", "triton-p512", "triton-p256", "triton-p128")),),
              "固定 BLOCK_SIZE=1024、num_warps=4；减少 program 会增加循环工作。"),
)


CONFIRMATION_SPECS = (
    MainRound("wave", "", (("HIP：同一 grid 的 LDS 与 wave", ("hip-local-lds-g256", "hip-local-wave-g256")),), ""),
    MainRound("triton", "", (("Triton：固定 tile，复测 program 数", ("triton-p1024", "triton-p256")),), ""),
)


def load_main(evidence: Path, shape: int, specs: tuple[MainRound, ...], *,
              confirmation: bool = False) -> tuple[dict[str, Any], dict[str, dict[str, str]]]:
    manifest = json.loads((evidence / "manifest.json").read_text(encoding="utf-8"))
    if confirmation:
        data = (evidence / "confirmation.json").read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest.get("artifacts_sha256", {}).get("confirmation.json"):
            raise ValueError("Independent confirmation bytes do not match the published manifest")
        confirmed = json.loads(data)
        if confirmed["experiment"] != "chapter9-independent-confirmation" or not confirmed["main_matrix_unchanged"]:
            raise ValueError("Expected a separate confirmation experiment")
        if confirmed["source_sha256"] != manifest["source_sha256"] or confirmed["build"]["binary_sha256"] != manifest["build"]["binary_sha256"]:
            raise ValueError("Confirmation must use the same frozen source and binary as the main scan")
        for field in ("shape", "dtype", "input", "seed", "warmup", "repeat", "scope"):
            if confirmed["benchmark"][field] != manifest["benchmark"][field]:
                raise ValueError(f"Confirmation benchmark differs in {field}")
        for field in ("gpu", "rocm_sdk"):
            if confirmed["environment"][field] != manifest["environment"][field]:
                raise ValueError(f"Confirmation environment differs in {field}")
        manifest = confirmed
        summary_rows = manifest["results"]
        process_rows = manifest["process_results"]
    else:
        summary_rows = read_csv(evidence / "summary.csv", manifest.get("artifacts_sha256", {}))
        process_rows = read_csv(evidence / "process-summary.csv", manifest.get("artifacts_sha256", {}))
    environment, benchmark = manifest["environment"], manifest["benchmark"]
    required_text(environment.get("gpu"), "environment.gpu")
    required_text(environment.get("rocm_sdk"), "environment.rocm_sdk")
    if benchmark.get("scope") != MAIN_SCOPE:
        raise ValueError("Main rounds require full-operator GPU events, not partial or trace timing")
    main_shape = int(benchmark.get("shape", benchmark.get("size", 0)))
    validation = manifest.get("validation_selection", {})
    validation_shapes = validation.get("shapes", [validation["shape"]] if "shape" in validation else [])
    shapes = {main_shape, *(int(value) for value in validation_shapes)}
    if main_shape <= 0 or shape not in shapes:
        raise ValueError(f"N={shape} is not declared by the main experiment manifest")
    run_count = int(benchmark.get("independent_runs", benchmark.get("processes", 0)))
    if run_count < 2:
        raise ValueError("Main rounds require multiple independent processes")
    requested = {config for spec in specs for _, ids in spec.panels for config in ids}
    rows = {}
    for row in summary_rows:
        if int(row["shape"]) != shape or row["config_id"] not in requested:
            continue
        config = row["config_id"]
        if config in rows:
            raise ValueError(f"Duplicate {config} at N={shape}; scopes must not be mixed")
        if row["scope"] != MAIN_SCOPE or row["dtype"] not in {"float32", "fp32"}:
            raise ValueError(f"{config}: invalid scope or dtype")
        if benchmark.get("dtype") not in {"float32", "fp32"}:
            raise ValueError("Main experiment must declare FP32")
        for field in ("warmup", "repeat", "seed"):
            if int(row[field]) != int(benchmark[field]):
                raise ValueError(f"{config}: {field} differs from manifest.benchmark.{field}")
        if row["input"] != benchmark["input"]:
            raise ValueError(f"{config}: input differs from manifest.benchmark.input")
        if row["correct"] != "OK" or int(row["run_count"]) != run_count:
            raise ValueError(f"{config}: missing correctness or independent runs")
        low, center, high = finite_range(row["median_ms_run_min"], row["median_ms"], row["median_ms_run_max"])
        for field in ("block", "grid", "warmup", "repeat", "stages"):
            if int(row[field]) <= 0:
                raise ValueError(f"{config}: invalid {field}")
        if row["runtime"] not in {"hip", "triton"}:
            raise ValueError(f"{config}: invalid runtime")
        expected_stages = 1 if config in {"hip-element-atomic", "hip-block-atomic"} else 2
        if int(row["stages"]) != expected_stages:
            raise ValueError(f"{config}: unexpected kernel-stage count")
        processes = [item for item in process_rows if item["config_id"] == config and int(item["shape"]) == shape]
        if sorted(int(item["process"]) for item in processes) != list(range(1, run_count + 1)):
            raise ValueError(f"{config}: missing or duplicate independent process")
        for item in processes:
            for field in ("implementation", "runtime", "dtype", "block", "grid", "num_warps",
                          "warmup", "repeat", "seed", "input", "stages", "scope"):
                if item[field] != row[field]:
                    raise ValueError(f"{config}: process metadata mismatch for {field}")
            if item["correct"] != "OK" or int(item["sample_count"]) != int(row["repeat"]):
                raise ValueError(f"{config}: incomplete or incorrect process")
        medians = [float(item["median_ms"]) for item in processes]
        for actual, expected in zip((low, center, high), (min(medians), median(medians), max(medians)), strict=True):
            if not math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-12):
                raise ValueError(f"{config}: summary differs from independent-process medians")
        rows[config] = row
    if missing := requested - rows.keys():
        raise ValueError(f"Missing N={shape} measurements: {', '.join(sorted(missing))}")
    for field in ("warmup", "repeat", "seed", "input"):
        if len({row[field] for row in rows.values()}) != 1:
            raise ValueError(f"Main round records differ in {field}")
    for spec in specs:
        ids = [config for _, configs in spec.panels for config in configs]
        members = [rows[config] for config in ids]
        if spec.name == "triton":
            if {row["block"] for row in members} != {"1024"} or {row["num_warps"] for row in members} != {"4"}:
                raise ValueError("Triton program scan must fix BLOCK_SIZE=1024 and num_warps=4")
            for config in ids:
                cap = int(config.removeprefix("triton-p"))
                if int(rows[config]["grid"]) != min(cap, (shape + 1023) // 1024):
                    raise ValueError(f"{config}: program count does not match its cap")
        else:
            if {row["block"] for row in members} != {"256"}:
                raise ValueError(f"{spec.name}: HIP block must remain 256")
            full_grid = (shape + 255) // 256
            for config in ("hip-block-atomic", "hip-partials"):
                if config in ids and int(rows[config]["grid"]) != full_grid:
                    raise ValueError(f"{config}: expected full grid")
            if spec.name == "grid":
                for cap in (65536, 1024, 256):
                    config = f"hip-local-lds-g{cap}"
                    if int(rows[config]["grid"]) != min(full_grid, cap):
                        raise ValueError(f"{config}: wrong grid cap")
                if len({rows[f"hip-local-lds-g{cap}"]["implementation"] for cap in (65536, 1024, 256)}) != 1:
                    raise ValueError("Grid scan must use the same local-lds kernel")
            if spec.name == "wave" and {rows[config]["grid"] for config in ids if config != "hip-block-atomic"} != {str(min(full_grid, 256))}:
                raise ValueError("Wave comparison must keep the same grid")
    return manifest, rows


def main_label(row: dict[str, str]) -> str:
    if row["runtime"] == "triton":
        suffix = "\n基线" if row["config_id"] == "triton-p1024" else ""
        return f"program={int(row['grid']):,}{suffix}"
    implementation = row["implementation"].removeprefix("hip-")
    return f"{implementation}\ngrid={int(row['grid']):,}"


def render_main(spec: MainRound, manifest: dict[str, Any], rows: dict[str, dict[str, str]],
                shape: int, output: Path, formats: list[str]) -> None:
    panels = []
    for title, ids in spec.panels:
        measurements = []
        for index, config in enumerate(ids):
            row = rows[config]
            low, center, high = finite_range(row["median_ms_run_min"], row["median_ms"], row["median_ms_run_max"])
            measurements.append(Measurement(config, main_label(row), row["runtime"], center, low, high,
                                            int(row["run_count"]), baseline=config in {"hip-block-atomic", "triton-p1024"},
                                            hatch="//" if config == "hip-local-wave-g256" else ""))
        panels.append(Panel(title, tuple(measurements)))
    environment = manifest["environment"]
    independent = len(panels) > 1 and spec.name != "confirmation"
    notes = (spec.note,)
    if spec.name == "confirmation":
        notes += ("HIP block=256；Triton BLOCK_SIZE=1024、num_warps=4。",)
    if independent:
        notes = ("参考与对照面板刻度不同，均从 0 起；请按数值比较。", *notes)
    context = f"N={shape:,} · FP32 · 完整算子的 GPU event 时间"
    if spec.name == "confirmation":
        context = f"N={shape:,} · FP32 · 独立复测 · 完整算子 GPU event"
    render_panels(name=spec.name, title=spec.title,
                  subtitle=f"{environment['gpu']} · ROCm {environment['rocm_sdk']}",
                  context=context,
                  panels=tuple(panels), notes=notes, output=output, formats=formats,
                  independent_axes=independent)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tree-evidence", type=Path, default=SCRIPT_DIR / "evidence" / "tree-layout")
    parser.add_argument("--evidence", type=Path, default=SCRIPT_DIR / "evidence" / "rounds")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--shape", type=int, default=16777216)
    parser.add_argument("--round", choices=("mapping-partial", "mapping-full", "confirmation", *(spec.name for spec in MAIN_ROUNDS)),
                        action="append", dest="rounds")
    parser.add_argument("--formats", nargs="+", choices=("png", "svg"), default=("png", "svg"))
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    requested = args.rounds or ("mapping-partial", "mapping-full", *(spec.name for spec in MAIN_ROUNDS), "confirmation")
    mapping_requested = [name for name in requested if name.startswith("mapping-")]
    tree = load_tree(args.tree_evidence) if mapping_requested else None
    specs = tuple(spec for spec in MAIN_ROUNDS if spec.name in requested)
    main_data = load_main(args.evidence, args.shape, specs) if specs else None
    confirmation = load_main(args.evidence, args.shape, CONFIRMATION_SPECS, confirmation=True) if "confirmation" in requested else None
    # Validate every selected experiment before writing any requested image.
    if mapping_requested:
        manifest, values = tree
        if args.validate_only:
            print(f"Validated {len(values)} tree-layout records against independent-process medians")
        else:
            for name in mapping_requested:
                render_tree(manifest, values, "partial" if name == "mapping-partial" else "two-stage",
                            args.out_dir, args.formats)
    if specs:
        manifest, rows = main_data
        if args.validate_only:
            print(f"Validated {len(rows)} full-operator round records at N={args.shape}")
        else:
            for spec in specs:
                render_main(spec, manifest, rows, args.shape, args.out_dir, args.formats)
    if confirmation:
        manifest, rows = confirmation
        if args.validate_only:
            print(f"Validated {len(rows)} independent confirmation records at N={args.shape}")
        else:
            spec = MainRound("confirmation", "独立复测：局部归约与 program 配置",
                             tuple(panel for item in CONFIRMATION_SPECS for panel in item.panels),
                             "独立于首次扫描的 3 次进程运行；两组样本不合并统计。")
            render_main(spec, manifest, rows, args.shape, args.out_dir, args.formats)


if __name__ == "__main__":
    main()
