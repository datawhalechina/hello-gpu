"""Aggregate Chapter 7 RESULT records into curated publication evidence."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import statistics
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


PART_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PART_DIR))

from common.evidence import parse_result_line, validate_manifest, validate_records


NUMERIC_FIELDS = (
    "min_ms",
    "median_ms",
    "mean_ms",
    "effective_bandwidth_gbs",
    "max_abs_error",
)
RANGE_FIELDS = (
    "median_ms",
    "effective_bandwidth_gbs",
)
TRACE_FIELDS = {
    "Grid_Size_X": "trace_grid_size_x",
    "Workgroup_Size_X": "trace_workgroup_size_x",
    "LDS_Block_Size": "trace_lds_bytes",
    "Scratch_Size": "trace_scratch_bytes",
    "VGPR_Count": "trace_vgpr_count",
    "Accum_VGPR_Count": "trace_accum_vgpr_count",
    "SGPR_Count": "trace_sgpr_count",
}
SOURCE_SUFFIXES = {".hip", ".py", ".sh"}
UNAVAILABLE = "unavailable"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--chapter-dir", type=Path, default=Path(__file__).resolve().parent
    )
    parser.add_argument("--git-commit", required=True)
    return parser.parse_args()


@dataclass(frozen=True)
class ChapterPaths:
    root: Path

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    @property
    def profiles(self) -> Path:
        return self.root / "profiles"

    @property
    def evidence(self) -> Path:
        return self.root / "evidence"


def read_records(paths: list[Path], root: Path) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for path in paths:
        if not path.exists():
            continue
        source = str(path.relative_to(root))
        for line in path.read_text(encoding="utf-8").splitlines():
            record = parse_result_line(line, source=source)
            if record is not None:
                records.append(record)
    return records


def read_environment_value(path: Path, key: str) -> str:
    if not path.exists():
        return UNAVAILABLE
    for line in path.read_text(encoding="utf-8").splitlines():
        candidate, separator, value = line.partition("=")
        if separator and candidate == key:
            return value or UNAVAILABLE
    return UNAVAILABLE


def read_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        if separator and key:
            values[key] = value
    return values


def source_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    sources = sorted(
        path
        for path in root.iterdir()
        if path.is_file() and path.suffix in SOURCE_SUFFIXES
    )
    for path in sources:
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def read_trace_fields(paths: ChapterPaths, implementation: str) -> dict[str, object]:
    unavailable = {
        "implementation": implementation,
        "trace_dispatches": UNAVAILABLE,
        **{field: UNAVAILABLE for field in TRACE_FIELDS.values()},
    }
    path = paths.profiles / f"{implementation}_kernel_trace.csv"
    if not path.exists():
        return unavailable

    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        fieldnames = set(reader.fieldnames or ())
        if "Kernel_Name" not in fieldnames:
            return unavailable
        target_rows = [
            row
            for row in reader
            if "vector_add" in row.get("Kernel_Name", "")
        ]

    fields: dict[str, object] = {
        "implementation": implementation,
        "trace_dispatches": len(target_rows),
    }
    for source, destination in TRACE_FIELDS.items():
        if source not in fieldnames:
            fields[destination] = UNAVAILABLE
            continue
        values = {row[source] for row in target_rows if row.get(source)}
        fields[destination] = next(iter(values)) if len(values) == 1 else UNAVAILABLE
    return fields


def aggregate(records: list[dict[str, str]]) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for record in records:
        grouped[record.get("implementation", "")].append(record)

    summary: list[dict[str, object]] = []
    for implementation in sorted(grouped):
        group = grouped[implementation]
        first = group[0]
        row: dict[str, object] = {
            key: first[key]
            for key in ("operator", "implementation", "runtime", "shape", "dtype")
            if key in first
        }
        row.update(
            {
                "block": first.get("block", UNAVAILABLE),
                "grid": first.get("grid", UNAVAILABLE),
                "run_count": len(group),
            }
        )
        if all("correct" in item for item in group):
            row["correct"] = (
                "OK" if all(item["correct"] == "OK" for item in group) else "FAIL"
            )
        for field in NUMERIC_FIELDS:
            if not any(field in item for item in group):
                continue
            values = [
                float(item[field])
                for item in group
                if item.get(field) not in (None, "NA", UNAVAILABLE)
            ]
            row[field] = statistics.median(values) if values else "NA"
            if field in RANGE_FIELDS:
                row[f"{field}_run_min"] = min(values) if values else "NA"
                row[f"{field}_run_max"] = max(values) if values else "NA"
        row["sources"] = ";".join(sorted({item["source"] for item in group}))
        summary.append(row)
    return summary


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(
            file, fieldnames=fieldnames, lineterminator="\n", extrasaction="ignore"
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    args = parse_args()
    paths = ChapterPaths(args.chapter_dir.resolve())
    independent_paths = sorted((paths.logs / "runs").glob("*.log"))
    records = read_records(independent_paths, paths.root)
    source_kind = "independent-runs"
    if not records:
        records = read_records(
            [
                paths.logs / "hip_benchmark.log",
                paths.logs / "triton_benchmark.log",
            ],
            paths.root,
        )
        source_kind = "main-benchmark"
    if not records:
        raise SystemExit("no RESULT records found; run run_all.sh first")

    summary = aggregate(records)
    manifest = {
        "operator": "vector-add",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": args.git_commit,
        "source_sha256": source_sha256(paths.root),
        "hardware": read_environment_value(
            paths.logs / "environment.log", "torch.cuda.device_name"
        ),
        "software": {
            "rocm": read_environment_value(
                paths.logs / "environment.log", "torch.version.hip"
            ),
            "torch": read_environment_value(paths.logs / "environment.log", "torch"),
            "triton": read_environment_value(
                paths.logs / "environment.log", "triton"
            ),
        },
        "benchmark": read_env_file(paths.logs / "benchmark_manifest.env"),
    }
    errors = (
        validate_records(records)
        + validate_records(summary)
        + validate_manifest(manifest)
    )
    if errors:
        raise SystemExit("\n".join(errors))

    paths.evidence.mkdir(parents=True, exist_ok=True)
    summary_fields = [
        "operator",
        "implementation",
        "runtime",
        "shape",
        "dtype",
        "block",
        "grid",
        "correct",
        "run_count",
        *NUMERIC_FIELDS,
        "median_ms_run_min",
        "median_ms_run_max",
        "effective_bandwidth_gbs_run_min",
        "effective_bandwidth_gbs_run_max",
        "sources",
    ]
    write_csv(paths.evidence / "summary.csv", summary_fields, summary)
    payload = {
        "status": "measured",
        "source_kind": source_kind,
        "records": summary,
    }
    (paths.evidence / "summary.json").write_text(
        json.dumps(payload, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )
    profile_rows = [
        read_trace_fields(paths, str(row["implementation"])) for row in summary
    ]
    write_csv(
        paths.evidence / "profile_summary.csv",
        ["implementation", "trace_dispatches", *TRACE_FIELDS.values()],
        profile_rows,
    )
    (paths.evidence / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(summary)} implementations to {paths.evidence}")


if __name__ == "__main__":
    main()
