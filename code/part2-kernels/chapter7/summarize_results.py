"""Aggregate Chapter 7 RESULT records into curated publication evidence."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import shlex
import shutil
import statistics
import sys
import tempfile
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
IMPLEMENTATIONS = (
    "hip-v0",
    "hip-v1-contiguous",
    "hip-v1-strided",
    "hip-v2",
    "hip-v3",
    "triton-t0",
    "triton-t1",
)
REQUIRED_RECORD_FIELDS = (
    "operator", "implementation", "runtime", "shape", "dtype", "block", "grid",
    "warmup", "repeat", "seed", "timed", "correct", "precheck", "postcheck",
    "median_ms", "effective_bandwidth_gbs",
)
CONSISTENT_RECORD_FIELDS = ("operator", "shape", "dtype", "warmup", "repeat", "seed", "timed")


def normalize_environment_value(value: str) -> str:
    value = value.strip()
    if not value or value.startswith(UNAVAILABLE):
        return UNAVAILABLE
    try:
        tokens = shlex.split(value)
    except ValueError:
        return value
    return " ".join(tokens) or UNAVAILABLE


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--chapter-dir", type=Path, default=Path(__file__).resolve().parent
    )
    parser.add_argument("--git-commit")
    parser.add_argument("--print-source-sha256", action="store_true")
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
            return normalize_environment_value(value)
    return UNAVAILABLE


def read_environment_section_value(path: Path, section: str) -> str:
    if not path.exists():
        return UNAVAILABLE
    in_section = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line == f"[{section}]":
            in_section = True
            continue
        if in_section and line.startswith("[") and line.endswith("]"):
            return UNAVAILABLE
        if in_section and line.strip():
            return normalize_environment_value(line)
    return UNAVAILABLE


def read_platform(path: Path) -> dict[str, str]:
    virtualization = read_environment_section_value(path, "virtualization")
    if virtualization == UNAVAILABLE:
        execution = UNAVAILABLE
    elif virtualization == "none":
        execution = "native"
    else:
        execution = "virtualized"
    return {
        "os_pretty_name": read_environment_value(path, "PRETTY_NAME"),
        "virtualization": virtualization,
        "execution": execution,
    }


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


def validate_evidence_inputs(
    records: list[dict[str, str]], independent_paths: list[Path], manifest: dict[str, object], git_commit: str
) -> list[str]:
    errors: list[str] = []
    benchmark = manifest["benchmark"]
    if benchmark.get("source_commit") != git_commit:
        errors.append("benchmark_manifest source_commit does not match --git-commit")
    if benchmark.get("source_sha256") != manifest["source_sha256"]:
        errors.append("benchmark_manifest source_sha256 does not match current source hash")
    if len(independent_paths) != 3:
        errors.append(f"expected exactly 3 independent sources, found {len(independent_paths)}")

    by_source: dict[str, list[dict[str, str]]] = defaultdict(list)
    for record in records:
        by_source[record["source"]].append(record)
    expected = set(IMPLEMENTATIONS)
    for source, source_records in sorted(by_source.items()):
        implementations = [record.get("implementation", "") for record in source_records]
        duplicates = sorted({name for name in implementations if implementations.count(name) > 1})
        missing = sorted(expected - set(implementations))
        unexpected = sorted(set(implementations) - expected)
        if duplicates or missing or unexpected:
            errors.append(
                f"{source} must contain each implementation exactly once"
                f" (duplicates={duplicates}, missing={missing}, unexpected={unexpected})"
            )

    if set(by_source) != {str(path.relative_to(Path(manifest["_root"]))) for path in independent_paths}:
        errors.append("every independent source must contain RESULT records")
    if {record.get("implementation") for record in records} != expected:
        errors.append("evidence must contain exactly the 7 required implementations")

    for index, record in enumerate(records):
        for field in REQUIRED_RECORD_FIELDS:
            if not record.get(field):
                errors.append(f"record {index} missing field: {field}")
        for field in ("correct", "precheck", "postcheck"):
            if record.get(field) != "OK":
                errors.append(f"record {index} {field} is not OK")
        for field in ("median_ms", "effective_bandwidth_gbs"):
            try:
                value = float(record[field])
            except (KeyError, ValueError):
                errors.append(f"record {index} {field} is not finite positive")
            else:
                if not math.isfinite(value) or value <= 0:
                    errors.append(f"record {index} {field} is not finite positive")
    for field in CONSISTENT_RECORD_FIELDS:
        values = {record.get(field) for record in records}
        if len(values) != 1:
            errors.append(f"metadata {field} is inconsistent across independent sources")
    benchmark_fields = {
        "shape": "size",
        "warmup": "warmup",
        "repeat": "repeat",
        "seed": "seed",
    }
    for record_field, benchmark_field in benchmark_fields.items():
        if {record.get(record_field) for record in records} != {benchmark.get(benchmark_field)}:
            errors.append(f"metadata {record_field} does not match benchmark_manifest")
    for record in records:
        expected_block = benchmark.get(
            "hip_block" if record.get("runtime") == "hip" else "triton_block"
        )
        if record.get("block") != expected_block:
            errors.append(f"record {record.get('implementation')} block does not match benchmark_manifest")
    return errors


def validate_profile_config(paths: ChapterPaths, benchmark: dict[str, str]) -> list[str]:
    profile_path = paths.profiles / "profile_config.env"
    if not profile_path.exists():
        return []
    profile = read_env_file(profile_path)
    errors: list[str] = []
    for field in ("source_commit", "source_sha256", "size", "hip_block", "triton_block", "seed"):
        if profile.get(field) != benchmark.get(field):
            errors.append(f"profile_config {field} does not match benchmark_manifest")
    return errors


def publish_evidence(paths: ChapterPaths, writer: object) -> None:
    staging_root = Path(tempfile.mkdtemp(prefix=".chapter7-evidence-", dir=paths.root))
    staging_evidence = staging_root / "evidence"
    staging_evidence.mkdir()
    try:
        writer(staging_evidence)
        backup = staging_root / "previous-evidence"
        had_previous = paths.evidence.exists()
        if had_previous:
            os.replace(paths.evidence, backup)
        try:
            os.replace(staging_evidence, paths.evidence)
        except Exception:
            if had_previous and backup.exists():
                os.replace(backup, paths.evidence)
            raise
        if backup.exists():
            shutil.rmtree(backup)
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def main() -> None:
    args = parse_args()
    paths = ChapterPaths(args.chapter_dir.resolve())
    if args.print_source_sha256:
        print(source_sha256(paths.root))
        return
    if not args.git_commit:
        raise SystemExit("--git-commit is required unless --print-source-sha256 is used")
    independent_paths = sorted((paths.logs / "runs").glob("run*.log"))
    records = read_records(independent_paths, paths.root)
    if not records:
        raise SystemExit("no RESULT records found in independent runs; run run_all.sh first")

    summary = aggregate(records)
    environment_log = paths.logs / "environment.log"
    manifest = {
        "operator": "vector-add",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": args.git_commit,
        "source_sha256": source_sha256(paths.root),
        "hardware": read_environment_value(
            environment_log, "torch.cuda.device_name"
        ),
        "software": {
            "rocm": read_environment_value(
                environment_log, "torch.version.hip"
            ),
            "torch": read_environment_value(environment_log, "torch"),
            "triton": read_environment_value(environment_log, "triton"),
        },
        "platform": read_platform(environment_log),
        "benchmark": read_env_file(paths.logs / "benchmark_manifest.env"),
        "_root": str(paths.root),
    }
    errors = (
        validate_evidence_inputs(records, independent_paths, manifest, args.git_commit)
        + validate_profile_config(paths, manifest["benchmark"])
        + validate_records(records)
        + validate_records(summary)
        + validate_manifest(manifest)
    )
    if errors:
        raise SystemExit("\n".join(errors))

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
    payload = {
        "status": "measured",
        "source_kind": "independent-runs",
        "records": summary,
    }
    profile_rows = [
        read_trace_fields(paths, str(row["implementation"])) for row in summary
    ]
    manifest.pop("_root")

    def write_staged(evidence: Path) -> None:
        write_csv(evidence / "summary.csv", summary_fields, summary)
        (evidence / "summary.json").write_text(
            json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
        )
        write_csv(evidence / "profile_summary.csv", ["implementation", "trace_dispatches", *TRACE_FIELDS.values()], profile_rows)
        (evidence / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
        )

    publish_evidence(paths, write_staged)
    print(f"wrote {len(summary)} implementations to {paths.evidence}")


if __name__ == "__main__":
    main()
