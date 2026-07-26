from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import shlex
import shutil
import tempfile
from collections import defaultdict
from pathlib import Path
from statistics import median
from typing import Sequence


PROCESS_COUNT = 3
EXPECTED_IMPLEMENTATIONS = {
    "branch-divergence": {"wave-uniform", "wave-divergent"},
    "global-memory": {"stride-1", "stride-17", "stride-257"},
    "lds-banks": {"stride-1", "stride-32", "stride-33"},
    "matrix-path": {"valu", "wmma"},
}
REQUIRED_FIELDS = (
    "experiment", "implementation", "runtime", "shape", "dtype",
    "warmup", "repeat", "seed", "timed", "correct", "precheck",
    "postcheck", "median_ms",
)
REQUIRED_RESULT_FIELDS = REQUIRED_FIELDS
METRIC_FIELDS = (
    "min_ms", "median_ms", "mean_ms",
    "logical_bandwidth_gbs", "tflops",
)
BENCHMARK_IDENTITY_FIELDS = (
    "runtime", "shape", "dtype", "warmup", "repeat", "seed", "timed",
)
TIMING_FIELDS = ("min_ms", "median_ms", "mean_ms")
EXPECTED_PAIRS = frozenset(
    (experiment, implementation)
    for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items()
    for implementation in implementations
)


def parse_result_line(line: str, source: str) -> dict[str, str] | None:
    """Parse one ``RESULT`` line, retaining its strings for later validation."""
    if not line.startswith("RESULT "):
        return None

    fields: dict[str, str] = {}
    try:
        tokens = shlex.split(line[len("RESULT "):])
    except ValueError as error:
        raise ValueError(f"{source}: invalid RESULT quoting: {error}") from error
    for token in tokens:
        if "=" not in token:
            raise ValueError(f"{source}: RESULT token is not key=value: {token!r}")
        key, value = token.split("=", 1)
        if not key or not value:
            raise ValueError(f"{source}: invalid RESULT token: {token!r}")
        if key in fields:
            raise ValueError(f"{source}: duplicate RESULT field: {key}")
        fields[key] = value
    return fields


def _validate_row(row: dict[str, str], source: str) -> None:
    missing = (set(REQUIRED_FIELDS) | set(METRIC_FIELDS)) - set(row)
    if missing:
        raise ValueError(f"{source}: RESULT row missing fields: {sorted(missing)}")
    for status in ("correct", "precheck", "postcheck"):
        if row[status] != "OK":
            raise ValueError(f"{source}: {status} must be OK")
    if row["timed"] != "1":
        raise ValueError(f"{source}: timed must be 1")
    for metric in METRIC_FIELDS:
        try:
            value = float(row[metric])
        except ValueError as error:
            raise ValueError(f"{source}: {metric} must be numeric") from error
        if not math.isfinite(value):
            raise ValueError(f"{source}: {metric} must be finite")
        if metric in TIMING_FIELDS and value <= 0:
            raise ValueError(f"{source}: {metric} must be positive")


def _read_log(path: Path) -> list[dict[str, str]]:
    source = str(path)
    if not path.is_file():
        raise ValueError(f"{source}: run log does not exist")
    rows: list[dict[str, str]] = []
    pairs: set[tuple[str, str]] = set()
    for line in path.read_text().splitlines():
        row = parse_result_line(line, source)
        if row is None:
            continue
        _validate_row(row, source)
        pair = (row["experiment"], row["implementation"])
        if pair in pairs:
            raise ValueError(f"{source}: duplicate experiment/implementation pair: {pair}")
        pairs.add(pair)
        rows.append(row)
    if not rows:
        raise ValueError(f"{source}: no RESULT rows")
    return rows


def validate_runs(paths: Sequence[Path]) -> list[dict[str, str]]:
    """Validate three process logs and return their validated result rows."""
    resolved = [Path(path).resolve() for path in paths]
    if len(resolved) != PROCESS_COUNT or len(set(resolved)) != PROCESS_COUNT:
        raise ValueError("publication requires exactly 3 distinct run logs")

    logs = [_read_log(path) for path in resolved]
    expected_pairs = {
        (row["experiment"], row["implementation"])
        for row in logs[0]
    }
    for path, rows in zip(resolved[1:], logs[1:]):
        pairs = {(row["experiment"], row["implementation"]) for row in rows}
        if pairs != expected_pairs:
            raise ValueError(
                f"{path}: each process must have the same experiment/implementation pairs"
            )
    if expected_pairs != EXPECTED_PAIRS:
        raise ValueError("run logs must contain the complete expected experiment/implementation set")

    first_by_pair = {
        (row["experiment"], row["implementation"]): row for row in logs[0]
    }
    for path, rows in zip(resolved[1:], logs[1:]):
        for row in rows:
            pair = (row["experiment"], row["implementation"])
            baseline = first_by_pair[pair]
            if any(row[field] != baseline[field] for field in BENCHMARK_IDENTITY_FIELDS):
                raise ValueError(
                    f"{path}: benchmark identity differs for experiment/implementation {pair}"
                )
    return [row for rows in logs for row in rows]


def _format_number(value: float) -> str:
    return format(value, ".12g")


def _aggregate(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    by_pair: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        by_pair[(row["experiment"], row["implementation"])].append(row)

    summaries: list[dict[str, str]] = []
    for pair in sorted(by_pair):
        process_rows = by_pair[pair]
        summary = {
            field: process_rows[0][field]
            for field in REQUIRED_FIELDS
        }
        summary["run_count"] = str(len(process_rows))
        for metric in METRIC_FIELDS:
            values = [float(row[metric]) for row in process_rows]
            summary[metric] = _format_number(median(values))
            summary[f"{metric}_process_min"] = _format_number(min(values))
            summary[f"{metric}_process_max"] = _format_number(max(values))
        summaries.append(summary)
    return summaries


def _profile_pair(trace_path: Path, profile_dir: Path) -> tuple[str, str]:
    try:
        relative = trace_path.relative_to(profile_dir)
    except ValueError as error:
        raise ValueError(f"{trace_path}: outside resolved profile root") from error
    if ".." in relative.parts:
        raise ValueError(f"{trace_path}: lexical '..' is not allowed")

    resolved_root = profile_dir.resolve()
    resolved_trace = trace_path.resolve()
    try:
        resolved_trace.relative_to(resolved_root)
    except ValueError as error:
        raise ValueError(f"{trace_path}: outside resolved profile root") from error

    prefix = trace_path.name.removesuffix("_kernel_trace.csv")
    pair_keys = {
        f"{experiment}__{implementation}": (experiment, implementation)
        for experiment, implementation in EXPECTED_PAIRS
    }
    implementations = set().union(*EXPECTED_IMPLEMENTATIONS.values())

    filename_pairs: set[tuple[str, str]] | None = None
    if prefix in pair_keys:
        filename_pairs = {pair_keys[prefix]}
    elif prefix in implementations:
        filename_pairs = {
            pair for pair in EXPECTED_PAIRS if pair[1] == prefix
        }

    components = relative.parts[:-1]
    canonical_pair = pair_keys.get(components[0]) if components else None
    if canonical_pair is not None:
        if filename_pairs is not None and canonical_pair not in filename_pairs:
            raise ValueError(f"{trace_path}: conflicting profile identity")
        return canonical_pair

    legacy_pair = (
        (components[0], components[1])
        if len(components) >= 2
        and (components[0], components[1]) in EXPECTED_PAIRS
        else None
    )
    if legacy_pair is not None:
        if filename_pairs is not None and legacy_pair not in filename_pairs:
            raise ValueError(f"{trace_path}: conflicting profile identity")
        return legacy_pair

    if filename_pairs is None or len(filename_pairs) != 1:
        raise ValueError(f"{trace_path}: cannot derive a unique profile identity")
    return filename_pairs.pop()


def _kernel_names(trace_path: Path) -> list[str]:
    with trace_path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or any(header is None for header in reader.fieldnames):
            raise ValueError(f"{trace_path}: malformed table")
        normalized = {
            re.sub(r"[^a-z0-9]", "", header.casefold()): header
            for header in reader.fieldnames
        }
        if len(normalized) != len(reader.fieldnames) or "kernelname" not in normalized:
            raise ValueError(f"{trace_path}: malformed table")
        kernel_column = normalized["kernelname"]
        names = []
        for record in reader:
            if None in record or record.get(kernel_column) is None:
                raise ValueError(f"{trace_path}: malformed table")
            kernel_name = record[kernel_column].strip()
            if not kernel_name:
                raise ValueError(f"{trace_path}: empty kernel")
            names.append(kernel_name)
    if not names:
        raise ValueError(f"{trace_path}: no dispatch")
    return names


def _profile_summary(profile_dir: Path | None, source_commit: str) -> list[dict[str, str]]:
    if profile_dir is None:
        return []
    profile_dir = Path(profile_dir)
    config_path = profile_dir / "profile_config.env"
    if not config_path.is_file():
        raise ValueError(f"{config_path}: missing profile_config.env")
    config = {}
    for line in config_path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            config[key.strip()] = value.strip()
    if config.get("source_commit") != source_commit:
        raise ValueError("profile_config.env.source_commit must match source_commit")

    profile_rows: dict[tuple[str, str], dict[str, object]] = {}
    for trace_path in sorted(profile_dir.rglob("*_kernel_trace.csv")):
        pair = _profile_pair(trace_path, profile_dir)
        names = _kernel_names(trace_path)
        entry = profile_rows.setdefault(
            pair, {"dispatch_count": 0, "kernel_names": set()},
        )
        entry["dispatch_count"] = int(entry["dispatch_count"]) + len(names)
        entry["kernel_names"].update(names)

    if set(profile_rows) != EXPECTED_PAIRS:
        raise ValueError("profile must contain the complete expected experiment/implementation set")

    return [
        {
            "experiment": experiment,
            "implementation": implementation,
            "dispatch_count": str(entry["dispatch_count"]),
            "unique_kernel_names": ";".join(sorted(entry["kernel_names"])),
        }
        for (experiment, implementation), entry in sorted(profile_rows.items())
    ]


def _write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _replace_evidence(temporary: Path, evidence_dir: Path) -> None:
    backup = evidence_dir.with_name(f".{evidence_dir.name}.previous")
    if backup.exists():
        shutil.rmtree(backup)
    if not evidence_dir.exists():
        os.replace(temporary, evidence_dir)
        return

    os.replace(evidence_dir, backup)
    try:
        os.replace(temporary, evidence_dir)
    except OSError as replace_error:
        try:
            os.replace(backup, evidence_dir)
        except OSError as restore_error:
            raise OSError(
                f"evidence replacement failed; prior evidence remains at {backup}"
            ) from restore_error
        raise replace_error
    try:
        shutil.rmtree(backup)
    except OSError:
        pass


def publish(
    run_logs: Sequence[Path],
    profile_dir: Path | None,
    evidence_dir: Path,
    source_commit: str,
) -> None:
    """Publish validated evidence as an all-or-nothing directory replacement."""
    rows = validate_runs(run_logs)
    run_log_paths = [Path(path) for path in run_logs]
    run_log_names = [path.name for path in run_log_paths]
    duplicate_names = sorted({
        name for name in run_log_names if run_log_names.count(name) > 1
    })
    if duplicate_names:
        raise ValueError(f"duplicate run-log basename: {duplicate_names[0]}")
    summaries = _aggregate(rows)
    profiles = _profile_summary(profile_dir, source_commit)
    evidence_dir = Path(evidence_dir)
    evidence_dir.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(REQUIRED_FIELDS) + ["run_count"]
    for metric in METRIC_FIELDS:
        if metric != "median_ms":
            fieldnames.append(metric)
        fieldnames.extend((f"{metric}_process_min", f"{metric}_process_max"))
    profile_fields = [
        "experiment", "implementation", "dispatch_count", "unique_kernel_names",
    ]
    temporary = Path(tempfile.mkdtemp(prefix=f".{evidence_dir.name}.tmp-", dir=evidence_dir.parent))
    try:
        manifest = {
            "source_commit": source_commit,
            "process_count": PROCESS_COUNT,
            "run_logs": [
                {
                    "name": path.name,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
                for path in run_log_paths
            ],
        }
        if profile_dir is not None:
            profile_config = Path(profile_dir) / "profile_config.env"
            manifest["profile_config"] = {
                "name": profile_config.name,
                "sha256": hashlib.sha256(profile_config.read_bytes()).hexdigest(),
            }
        (temporary / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        _write_csv(temporary / "summary.csv", summaries, fieldnames)
        (temporary / "summary.json").write_text(json.dumps(summaries, indent=2) + "\n")
        _write_csv(temporary / "profile_summary.csv", profiles, profile_fields)

        _replace_evidence(temporary, evidence_dir)
    except BaseException:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish Chapter 2 benchmark evidence.")
    parser.add_argument("--run-log", action="append", required=True, type=Path)
    parser.add_argument("--profile-dir", type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        publish(args.run_log, args.profile_dir, args.evidence_dir, args.source_commit)
    except ValueError as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
