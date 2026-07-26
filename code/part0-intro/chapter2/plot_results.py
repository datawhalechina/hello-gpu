from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path
from typing import Iterable

EXPECTED_IMPLEMENTATIONS = {
    "branch-divergence": ("wave-uniform", "wave-divergent"),
    "global-memory": ("stride-1", "stride-17", "stride-257"),
    "lds-banks": ("stride-1", "stride-32", "stride-33"),
    "matrix-path": ("valu", "wmma"),
}
EXPECTED_PAIRS = {
    (experiment, implementation)
    for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items()
    for implementation in implementations
}
STATUS_FIELDS = ("correct", "precheck", "postcheck")
METRICS = ("median_ms", "logical_bandwidth_gbs", "tflops")
REQUIRED_FIELDS = {
    "experiment", "implementation", "run_count", *STATUS_FIELDS,
    *(field for metric in METRICS for field in (
        metric, f"{metric}_process_min", f"{metric}_process_max",
    )),
}
SUBTITLE = "RX 9070 XT · 3 independent processes"


def pyplot():
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import pyplot as plt

    return plt


def _number(row: dict[str, str], field: str, *, positive: bool) -> float:
    try:
        value = float(row[field])
    except (KeyError, ValueError) as error:
        raise ValueError(f"{row.get('experiment', '<unknown>')}: invalid {field}") from error
    if not math.isfinite(value):
        raise ValueError(f"{row['experiment']}/{row['implementation']}: {field} must be finite")
    if positive and value <= 0:
        raise ValueError(f"{row['experiment']}/{row['implementation']}: {field} must be positive")
    return value


def read_summary(path: Path) -> dict[tuple[str, str], dict[str, float]]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not REQUIRED_FIELDS.issubset(reader.fieldnames):
            missing = REQUIRED_FIELDS - set(reader.fieldnames or ())
            raise ValueError(f"{path}: missing required columns: {sorted(missing)}")
        rows = list(reader)

    parsed: dict[tuple[str, str], dict[str, float]] = {}
    for row in rows:
        pair = (row.get("experiment", ""), row.get("implementation", ""))
        if pair in parsed:
            raise ValueError(f"{path}: duplicate experiment/implementation pair: {pair}")
        if pair not in EXPECTED_PAIRS:
            raise ValueError(f"{path}: unexpected experiment/implementation pair: {pair}")
        if any(row[field] != "OK" for field in STATUS_FIELDS):
            raise ValueError(f"{path}: non-OK status for {pair}")
        if row["run_count"] != "3":
            raise ValueError(f"{path}: {pair} must contain 3 independent processes")

        values: dict[str, float] = {}
        for metric in METRICS:
            positive = (
                metric == "median_ms"
                or (metric == "logical_bandwidth_gbs" and pair[0] == "global-memory")
                or (metric == "tflops" and pair[0] == "matrix-path")
            )
            minimum = _number(row, f"{metric}_process_min", positive=positive)
            median = _number(row, metric, positive=positive)
            maximum = _number(row, f"{metric}_process_max", positive=positive)
            if minimum > median or median > maximum:
                raise ValueError(f"{path}: malformed process range for {pair} {metric}")
            values[metric] = median
            values[f"{metric}_process_min"] = minimum
            values[f"{metric}_process_max"] = maximum
        parsed[pair] = values

    if set(parsed) != EXPECTED_PAIRS:
        missing = EXPECTED_PAIRS - set(parsed)
        raise ValueError(f"{path}: missing expected pairs: {sorted(missing)}")
    return parsed


def _direct_panel(
    axis, rows: dict[tuple[str, str], dict[str, float]], experiment: str,
    metric: str, title: str, ylabel: str,
) -> None:
    implementations = EXPECTED_IMPLEMENTATIONS[experiment]
    values = [rows[(experiment, implementation)][metric] for implementation in implementations]
    lower = [
        value - rows[(experiment, implementation)][f"{metric}_process_min"]
        for value, implementation in zip(values, implementations)
    ]
    upper = [
        rows[(experiment, implementation)][f"{metric}_process_max"] - value
        for value, implementation in zip(values, implementations)
    ]
    positions = list(range(len(implementations)))
    axis.bar(positions, values, yerr=[lower, upper], capsize=4, color="#3178c6")
    axis.set_xticks(positions, implementations, rotation=12, ha="right")
    axis.set_ylabel(ylabel)
    axis.set_yscale("log")
    axis.set_title(f"{title}\n{SUBTITLE}")
    for position, value in zip(positions, values):
        axis.annotate(f"{value:.2f}", (position, value), xytext=(0, 4),
                      textcoords="offset points", ha="center", fontsize=8)


def _relative_panel(
    axis, rows: dict[tuple[str, str], dict[str, float]], experiment: str,
    title: str,
) -> None:
    implementations = EXPECTED_IMPLEMENTATIONS[experiment]
    baseline = rows[(experiment, implementations[0])]
    values: list[float] = []
    lower: list[float] = []
    upper: list[float] = []
    labels: list[str] = []
    for implementation in implementations:
        row = rows[(experiment, implementation)]
        relative = (row["median_ms"] / baseline["median_ms"] - 1.0) * 100.0
        low = (row["median_ms_process_min"] /
               baseline["median_ms_process_max"] - 1.0) * 100.0
        high = (row["median_ms_process_max"] /
                baseline["median_ms_process_min"] - 1.0) * 100.0
        values.append(relative)
        lower.append(relative - low)
        upper.append(high - relative)
        labels.append(f"{relative:+.1f}%\n{row['median_ms']:.3f} ms")
    positions = list(range(len(implementations)))
    axis.bar(positions, values, yerr=[lower, upper], capsize=4, color="#d76835")
    axis.axhline(0.0, color="black", linewidth=0.8)
    axis.set_xticks(positions, implementations, rotation=12, ha="right")
    axis.set_ylabel("relative slowdown (%)")
    axis.set_yscale("symlog", linthresh=1.0)
    axis.set_title(f"{title}\n{SUBTITLE}")
    extent = [value - error for value, error in zip(values, lower)] + [
        value + error for value, error in zip(values, upper)
    ]
    margin = max(1.0, (max(extent) - min(extent)) * 0.15)
    axis.set_ylim(min(min(extent), 0.0) - margin, max(max(extent), 0.0) + margin)
    for position, value, label in zip(positions, values, labels):
        offset = 4 if value >= 0 else -20
        axis.annotate(label, (position, value), xytext=(0, offset),
                      textcoords="offset points", ha="center", fontsize=8)


def build_figure(rows: dict[tuple[str, str], dict[str, float]]):
    plt = pyplot()
    figure, axes = plt.subplots(2, 2, figsize=(11, 8), constrained_layout=True)
    _relative_panel(axes[0, 0], rows, "branch-divergence", "Branch divergence")
    _direct_panel(axes[0, 1], rows, "global-memory", "logical_bandwidth_gbs",
                  "Global memory", "logical GB/s")
    _relative_panel(axes[1, 0], rows, "lds-banks", "LDS bank conflicts")
    _direct_panel(axes[1, 1], rows, "matrix-path", "tflops",
                  "Matrix path", "TFLOPS")
    return figure


def plot(rows: dict[tuple[str, str], dict[str, float]], output: Path) -> None:
    plt = pyplot()
    figure = build_figure(rows)
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=160, metadata={"Date": None})
    plt.close(figure)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Plot validated Chapter 2 results.")
    parser.add_argument("--summary", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        plot(read_summary(args.summary), args.output)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
