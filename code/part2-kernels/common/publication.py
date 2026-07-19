"""Validation and atomic publication for Part 2 benchmark evidence."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import shutil
import statistics
import tempfile
from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import datetime, timezone
from pathlib import Path

from common.evidence import parse_result_line


PROCESS_COUNT = 3
UNAVAILABLE = "unavailable"
IDENTITY_FIELDS = (
    "operator",
    "shape",
    "size",
    "rows",
    "cols",
    "m",
    "n",
    "k",
    "seq",
    "dim",
    "dtype",
    "warmup",
    "repeat",
    "seed",
)
SUMMARY_IDENTITY_FIELDS = (
    "operator",
    "implementation",
    "runtime",
    "shape",
    "size",
    "rows",
    "cols",
    "m",
    "n",
    "k",
    "seq",
    "dim",
    "dtype",
)
REQUIRED_RECORD_FIELDS = (
    "operator",
    "implementation",
    "runtime",
    "shape",
    "dtype",
    "warmup",
    "repeat",
    "seed",
    "timed",
    "correct",
    "precheck",
    "postcheck",
    "median_ms",
)
METRIC_FIELDS = (
    "min_ms",
    "median_ms",
    "mean_ms",
    "logical_bandwidth_gbs",
    "effective_bandwidth_gbs",
    "tflops",
)


class PublicationError(ValueError):
    """The supplied evidence does not satisfy the publication contract."""


def _read_records(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise PublicationError(f"run log does not exist: {path}")
    records = [
        record
        for line in path.read_text(encoding="utf-8").splitlines()
        if (record := parse_result_line(line, source=path.name)) is not None
    ]
    if not records:
        raise PublicationError(f"run log has no RESULT rows: {path}")
    return records


def _finite_positive(record: dict[str, str], field: str) -> float:
    try:
        value = float(record[field])
    except (KeyError, ValueError) as error:
        raise PublicationError(
            f"{record.get('source', '?')} {record.get('implementation', '?')} "
            f"{field} must be finite and positive"
        ) from error
    if not math.isfinite(value) or value <= 0:
        raise PublicationError(
            f"{record.get('source', '?')} {record.get('implementation', '?')} "
            f"{field} must be finite and positive"
        )
    return value


def validate_run_logs(
    run_logs: Sequence[Path], operator: str
) -> list[dict[str, str]]:
    if len(run_logs) != PROCESS_COUNT or len({path.resolve() for path in run_logs}) != PROCESS_COUNT:
        raise PublicationError("publication requires exactly 3 distinct run logs")

    records_by_source = [_read_records(path) for path in run_logs]
    expected_implementations: set[str] | None = None
    expected_runtimes: dict[str, str] = {}
    reference_identity: dict[str, str] | None = None
    flattened: list[dict[str, str]] = []

    for records in records_by_source:
        implementations = [record.get("implementation", "") for record in records]
        if any(not implementation for implementation in implementations):
            raise PublicationError("every RESULT row requires implementation")
        if len(implementations) != len(set(implementations)):
            raise PublicationError(f"duplicate implementation in {records[0]['source']}")
        implementation_set = set(implementations)
        if expected_implementations is None:
            expected_implementations = implementation_set
        elif implementation_set != expected_implementations:
            raise PublicationError("each process must contain the same implementations")

        for record in records:
            missing = [field for field in REQUIRED_RECORD_FIELDS if field not in record]
            if missing:
                raise PublicationError(
                    f"{record['source']} {record.get('implementation', '?')} "
                    f"missing required fields: {','.join(missing)}"
                )
            if record.get("operator") != operator:
                raise PublicationError(
                    f"operator mismatch in {record['source']}: {record.get('operator')}"
                )
            for status in ("correct", "precheck", "postcheck"):
                if record.get(status) != "OK":
                    raise PublicationError(
                        f"{record['source']} {record['implementation']} {status} is not OK"
                    )
            if record["timed"] != "1":
                raise PublicationError(
                    f"{record['source']} {record['implementation']} timed is not 1"
                )
            expected_runtime = expected_runtimes.setdefault(
                record["implementation"], record["runtime"]
            )
            if record["runtime"] != expected_runtime:
                raise PublicationError(
                    f"runtime mismatch for {record['implementation']}: "
                    f"{record['runtime']} != {expected_runtime}"
                )
            _finite_positive(record, "median_ms")

            identity = {field: record[field] for field in IDENTITY_FIELDS if field in record}
            if reference_identity is None:
                reference_identity = identity
            elif identity != reference_identity:
                raise PublicationError("mixed benchmark metadata across RESULT rows")
            flattened.append(record)

    return flattened


def aggregate(records: Sequence[dict[str, str]]) -> list[dict[str, object]]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for record in records:
        grouped[record["implementation"]].append(record)

    rows: list[dict[str, object]] = []
    for implementation in sorted(grouped):
        group = grouped[implementation]
        first = group[0]
        row: dict[str, object] = {
            field: first[field]
            for field in SUMMARY_IDENTITY_FIELDS
            if field in first
        }
        row["run_count"] = len(group)
        row["correct"] = "OK"
        row["sources"] = ";".join(sorted(record["source"] for record in group))
        for field in METRIC_FIELDS:
            if not all(field in record and record[field] not in {"NA", UNAVAILABLE} for record in group):
                continue
            values = [_finite_positive(record, field) for record in group]
            row[field] = statistics.median(values)
            row[f"{field}_run_min"] = min(values)
            row[f"{field}_run_max"] = max(values)
        rows.append(row)
    return rows


def read_environment(path: Path | None) -> dict[str, str]:
    if path is None:
        return {}
    if not path.is_file():
        raise PublicationError(f"environment file does not exist: {path}")
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator and key:
            result[key] = value
    return result


def read_profile_config(profile_dir: Path | None, git_commit: str) -> dict[str, str]:
    if profile_dir is None:
        return {}
    config_path = profile_dir / "profile_config.env"
    if not config_path.is_file():
        raise PublicationError(f"profile config does not exist: {config_path}")
    config = read_environment(config_path)
    if config.get("source_commit") != git_commit:
        raise PublicationError(
            "profile source_commit mismatch: "
            f"{config.get('source_commit', '<missing>')} != {git_commit}"
        )
    return config


def summarize_profiles(profile_dir: Path | None) -> list[dict[str, object]]:
    if profile_dir is None:
        return []
    if not profile_dir.is_dir():
        raise PublicationError(f"profile directory does not exist: {profile_dir}")

    trace_paths = sorted(profile_dir.rglob("*kernel_trace.csv"))
    if not trace_paths:
        raise PublicationError(f"profile directory has no kernel trace CSV: {profile_dir}")

    rows: list[dict[str, object]] = []
    for path in trace_paths:
        with path.open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream)
            records = list(reader)
            fields = set(reader.fieldnames or ())
        if "Kernel_Name" not in fields:
            raise PublicationError(f"profile CSV lacks Kernel_Name: {path}")
        if not records:
            raise PublicationError(f"profile CSV has no dispatch rows: {path}")
        kernel_names = sorted({row.get("Kernel_Name", "") for row in records if row.get("Kernel_Name")})
        row: dict[str, object] = {
            "implementation": path.stem.replace("_kernel_trace", "").replace("-kernel_trace", ""),
            "source": str(path.relative_to(profile_dir)),
            "trace_dispatches": len(records),
            "kernel_names": ";".join(kernel_names),
        }
        for field in ("Grid_Size_X", "Workgroup_Size_X", "LDS_Block_Size", "Scratch_Size", "VGPR_Count", "SGPR_Count"):
            if field in fields:
                values = sorted({record[field] for record in records if record.get(field)})
                row[field.lower()] = values[0] if len(values) == 1 else UNAVAILABLE
        rows.append(row)
    implementations = [str(row["implementation"]) for row in rows]
    if len(implementations) != len(set(implementations)):
        raise PublicationError("duplicate implementation profile CSV")
    return rows


def _write_csv(path: Path, rows: Sequence[dict[str, object]], default_fields: Iterable[str]) -> None:
    fields = list(default_fields)
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _log_digest(paths: Sequence[Path]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _install_staged_directory(staged: Path, target: Path) -> None:
    backup = target.with_name(f".{target.name}.backup")
    if backup.exists():
        shutil.rmtree(backup)
    try:
        if target.exists():
            os.replace(target, backup)
        os.replace(staged, target)
    except BaseException:
        if not target.exists() and backup.exists():
            os.replace(backup, target)
        raise
    else:
        if backup.exists():
            shutil.rmtree(backup)


def publish(
    *,
    chapter_dir: Path,
    operator: str,
    git_commit: str,
    run_logs: Sequence[Path],
    environment_file: Path | None,
    profile_dir: Path | None,
) -> None:
    if not git_commit.strip():
        raise PublicationError("git commit must not be empty")
    records = validate_run_logs(run_logs, operator)
    summary = aggregate(records)
    profiles = summarize_profiles(profile_dir)
    environment = read_environment(environment_file)
    profile_config = read_profile_config(profile_dir, git_commit)
    if profile_dir is not None:
        expected_profiled = {
            record["implementation"]
            for record in records
            if record["runtime"] in {"hip", "triton"}
        }
        actual_profiled = {str(row["implementation"]) for row in profiles}
        if actual_profiled != expected_profiled:
            raise PublicationError(
                "profile implementation set mismatch: "
                f"expected={sorted(expected_profiled)} actual={sorted(actual_profiled)}"
            )

    manifest = {
        "operator": operator,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_commit": git_commit,
        "process_count": PROCESS_COUNT,
        "run_logs": [path.name for path in run_logs],
        "run_logs_sha256": _log_digest(run_logs),
        "environment": environment,
        "profile_config": profile_config,
        "benchmark": {
            field: records[0][field] for field in IDENTITY_FIELDS if field in records[0]
        },
        "implementations": [row["implementation"] for row in summary],
    }

    chapter_dir.mkdir(parents=True, exist_ok=True)
    evidence = chapter_dir / "evidence"
    staged_parent = Path(tempfile.mkdtemp(prefix=f".{evidence.name}.stage-", dir=chapter_dir))
    staged = staged_parent / "evidence"
    staged.mkdir()
    try:
        (staged / "manifest.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        (staged / "summary.json").write_text(
            json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        _write_csv(
            staged / "summary.csv",
            summary,
            ("operator", "implementation", "runtime", "shape", "correct", "run_count", "median_ms"),
        )
        _write_csv(
            staged / "profile_summary.csv",
            profiles,
            ("implementation", "source", "trace_dispatches", "kernel_names"),
        )
        _install_staged_directory(staged, evidence)
    finally:
        if staged_parent.exists():
            shutil.rmtree(staged_parent)
