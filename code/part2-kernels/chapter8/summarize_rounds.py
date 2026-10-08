"""Summarize each configuration without pooling independent processes or shapes."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import shlex
import statistics
from collections import defaultdict
from pathlib import Path

META = ("config_id", "implementation", "runtime", "shape", "dtype", "block", "grid",
        "num_warps", "warmup", "repeat", "seed")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="") as file:
        return list(csv.DictReader(file))


def write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def verify_identity(root: Path, manifest: dict, frozen_root: Path | None = None) -> dict:
    """Reject an incomplete matrix or files outside the recorded experiment."""
    frozen = frozen_root or root
    for name, expected in manifest["source_sha256"].items():
        if digest(frozen / "source" / name) != expected:
            raise ValueError(f"frozen source hash mismatch: {name}")
    if digest(frozen / "build/vector_add_hip") != manifest["build"]["binary_sha256"]:
        raise ValueError("frozen HIP binary hash mismatch")
    benchmark = manifest["benchmark"]
    if benchmark["scope"] != "gpu-event-single-kernel":
        raise ValueError("unexpected measurement scope")
    configurations = manifest.get("configurations")
    if configurations is None and frozen_root is not None:
        # The first confirmation predates explicit config storage. Its recorded
        # execution order selects four configs from the verified parent run.
        parent = json.loads((frozen / "manifest.json").read_text())
        ids = {i for order in manifest["execution_order"] for i in order["configs"]}
        configurations = [c for c in parent["configurations"] if c["id"] in ids]
        manifest["configurations"] = configurations
    if not configurations:
        raise ValueError("no experiment configurations; confirmation requires --frozen-run")
    configs = {config["id"]: config for config in configurations}
    if len(configs) != len(configurations):
        raise ValueError("duplicate manifest configuration ID")
    shapes = {int(benchmark["shape"]): set(configs)}
    if "validation_selection" in manifest:
        selection = manifest["validation_selection"]
        # Explicitly describe the fixed validation shapes used by schema v1.
        selection.setdefault("shapes", [1048576, 4194304])
        for shape in selection.get("shapes", [1048576, 4194304]):
            shapes[int(shape)] = set(selection["config_ids"])
    expected = {}
    for shape, ids in shapes.items():
        if not ids <= configs.keys():
            raise ValueError("validation references an unknown configuration")
        for process in range(1, benchmark["processes"] + 1):
            for config_id in ids:
                expected[f"n{shape}-{config_id}-p{process}.csv"] = (shape, process, configs[config_id])
    actual = {path.name for path in (root / "samples").glob("*.csv")}
    if actual != expected.keys():
        raise ValueError(f"sample matrix mismatch: missing={sorted(expected.keys() - actual)}, unexpected={sorted(actual - expected.keys())}")
    return expected


def verify_log_environment(log: Path, manifest: dict, runtime: str) -> None:
    lines = [line for line in log.read_text().splitlines() if line.startswith("ENV ")]
    if len(lines) != 1:
        raise ValueError(f"expected one runtime ENV: {log}")
    actual = dict(token.split("=", 1) for token in shlex.split(lines[0])[1:])
    env = manifest["environment"]
    expected = {"runtime": runtime, "gpu": env["gpu"]}
    if runtime == "hip":
        expected["arch"] = env["architecture"]
    else:
        expected.update(torch=env["torch"], torch_hip=env["hip"])
        # triton.__version__ omits the distribution's local build suffix.
        expected["triton"] = env["triton"].split("+")[0]
    for key, value in expected.items():
        if actual.get(key) != value:
            raise ValueError(f"ENV/manifest mismatch for {key}: {log}")


def verify_sample_config(first: dict, planned: tuple, benchmark: dict) -> None:
    shape, process, config = planned
    runtime, block = config["runtime"], config["block"]
    ceil_div = lambda x, y: (x + y - 1) // y
    if runtime == "triton":
        grid = ceil_div(shape, block)
    elif config["version"].startswith("v1-"):
        grid = ceil_div(shape, block * 32)
    elif config["version"] == "v0":
        grid = ceil_div(shape, block)
    else:
        items = max(1, shape // 4) if config["version"] == "v3" else shape
        grid = min(config["grid"], ceil_div(items, block))
    required = {"config_id": config["id"], "runtime": runtime,
                "implementation": f"{runtime}-{config['version']}",
                "shape": shape, "process": process, "block": block, "grid": grid,
                "num_warps": 4 if runtime == "triton" else 0,
                **{key: benchmark[key] for key in ("dtype", "warmup", "repeat", "seed")}}
    for key, value in required.items():
        if first[key] != str(value):
            raise ValueError(f"sample/manifest mismatch for {config['id']} {key}: {first[key]} != {value}")


def summarize(root: Path, output: Path, *, frozen_root: Path | None = None) -> list[dict]:
    manifest = json.loads((root / "manifest.json").read_text())
    expected = verify_identity(root, manifest, frozen_root)
    previous_path = root / "summary/manifest.json"
    if previous_path.exists():
        previous = json.loads(previous_path.read_text())
        if (previous["started_at"] != manifest["started_at"] or
                previous["source_sha256"] != manifest["source_sha256"]):
            raise ValueError("previous publication belongs to another experiment")
        for relative, expected_hash in previous.get("sample_sha256", {}).items():
            if digest(root / relative) != expected_hash:
                raise ValueError(f"previously recorded sample hash changed: {relative}")
        for relative, expected_hash in previous.get("log_sha256", {}).items():
            if digest(root / relative) != expected_hash:
                raise ValueError(f"previously recorded log hash changed: {relative}")
    records, sample_files = [], {}
    for path in sorted((root / "samples").glob("*.csv")):
        rows = read_csv(path)
        if not rows:
            raise ValueError(f"empty sample file: {path}")
        first = rows[0]
        verify_sample_config(first, expected[path.name], manifest["benchmark"])
        if any(any(row[key] != first[key] for key in (*META, "process")) for row in rows):
            raise ValueError(f"mixed sample metadata: {path}")
        if len(rows) != int(first["repeat"]) or [int(row["sample"]) for row in rows] != list(range(len(rows))):
            raise ValueError(f"incomplete or duplicate samples: {path}")
        values = [float(row["ms"]) for row in rows]
        if not all(math.isfinite(x) and x > 0 for x in values):
            raise ValueError(f"nonpositive or nonfinite sample: {path}")
        log = root / "logs" / f"{path.stem}.log"
        verify_log_environment(log, manifest, first["runtime"])
        result_lines = [line for line in log.read_text().splitlines() if line.startswith("RESULT ")]
        if len(result_lines) != 1:
            raise ValueError(f"expected one RESULT: {log}")
        result = dict(token.split("=", 1) for token in shlex.split(result_lines[0])[1:])
        if any(result.get(key) != "OK" for key in ("correct", "precheck", "postcheck")):
            raise ValueError(f"failed correctness: {log}")
        for key in META[1:]:
            if key == "num_warps" and first["runtime"] == "hip":
                continue
            if result.get(key) != first[key]:
                raise ValueError(f"RESULT/sample mismatch for {key}: {log}")
        median = statistics.median(values)
        if abs(median - float(result["median_ms"])) > 0.00000051:
            raise ValueError(f"RESULT/sample median mismatch: {log}")
        row = {key: first[key] for key in META}
        row.update(scope="gpu-event-single-kernel", process=int(first["process"]),
                   sample_count=len(values), min_ms=min(values), median_ms=median,
                   max_ms=max(values), mean_ms=statistics.fmean(values), correct="OK",
                   sample_file=str(path.relative_to(root)), log_file=str(log.relative_to(root)))
        records.append(row)
        sample_files[str(path.relative_to(root))] = digest(path)

    grouped = defaultdict(list)
    for row in records:
        grouped[tuple(row[key] for key in META)].append(row)
    summary = []
    for key, group in sorted(grouped.items()):
        expected = manifest["benchmark"]["processes"]
        if sorted(row["process"] for row in group) != list(range(1, expected + 1)):
            raise ValueError(f"missing or duplicate processes: {key}")
        medians = [row["median_ms"] for row in group]
        bandwidths = [12 * int(key[3]) / (x * 1e6) for x in medians]
        row = dict(zip(META, key, strict=True))
        row.update(scope="gpu-event-single-kernel", run_count=len(group), correct="OK",
                   median_ms=statistics.median(medians), median_ms_run_min=min(medians),
                   median_ms_run_max=max(medians), effective_bandwidth_gbs=statistics.median(bandwidths),
                   effective_bandwidth_gbs_run_min=min(bandwidths),
                   effective_bandwidth_gbs_run_max=max(bandwidths))
        summary.append(row)
    if not summary:
        raise ValueError("no samples")
    manifest["sample_sha256"] = sample_files
    manifest["log_sha256"] = {r["log_file"]: digest(root / r["log_file"]) for r in records}
    manifest["analysis"] = {"summarizer_sha256": digest(Path(__file__)),
                            "identity_check": "frozen source and binary; runtime ENV; expected matrix and metadata; prior sample/log hashes"}
    manifest["statistics"] = {
        "within_process": "median of event samples",
        "across_processes": "median of process medians; min/max of process medians",
        "range_is_confidence_interval": False,
        "sample_count": sum(row["sample_count"] for row in records),
    }
    profile_rows = []
    if "profile" in manifest:
        skip = manifest["profile"]["precheck_dispatches"] + manifest["profile"]["warmup"]
        expected = skip + manifest["profile"]["repeat"]
        for config in manifest["configurations"]:
            verify_log_environment(root / "logs" / f"profile-{config['id']}.log", manifest, config["runtime"])
            path = root / "profiles" / f"{config['id']}_kernel_trace.csv"
            traces = [r for r in read_csv(path) if "vector_add" in r["Kernel_Name"]]
            traces.sort(key=lambda r: int(r["Start_Timestamp"]))
            if len(traces) != expected:
                raise ValueError(f"expected {expected} target dispatches, found {len(traces)}: {path}")
            timed = traces[skip:]
            duration = [(int(r["End_Timestamp"]) - int(r["Start_Timestamp"])) / 1e6 for r in timed]
            row = {"config_id": config["id"], "shape": manifest["benchmark"]["shape"],
                   "scope": "rocprofv3-kernel-trace", "trace_dispatches": len(traces),
                   "excluded_precheck_warmup": skip, "timed_dispatches": len(timed),
                   "trace_median_ms": statistics.median(duration), "trace_min_ms": min(duration),
                   "trace_max_ms": max(duration)}
            for field in ("Grid_Size_X", "Workgroup_Size_X", "VGPR_Count", "SGPR_Count", "LDS_Block_Size", "Scratch_Size"):
                values = {r[field] for r in traces}
                if len(values) != 1:
                    raise ValueError(f"nonuniform {field}: {path}")
                row[field] = values.pop()
            profile_rows.append(row)
    # No published files are written until all samples and traces pass.
    output.mkdir(parents=True, exist_ok=True)
    write_csv(output / "process-summary.csv", records)
    write_csv(output / "summary.csv", summary)
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    artifacts = ["summary.csv", "process-summary.csv", "summary.json"]
    if profile_rows:
        write_csv(output / "profile-summary.csv", profile_rows)
        artifacts.append("profile-summary.csv")
    manifest["artifacts_sha256"] = {name: digest(output / name) for name in artifacts}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"summarized {len(summary)} configurations and {len(records)} processes -> {output}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--frozen-run", type=Path, help="parent measurement directory for an independent confirmation")
    args = parser.parse_args()
    summarize(args.run_dir, args.out or args.run_dir / "summary", frozen_root=args.frozen_run)
