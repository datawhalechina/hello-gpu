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
        "num_warps", "warmup", "repeat", "seed", "input", "stages", "scope")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    if digest(frozen / "build/reduction_rounds") != manifest["build"]["binary_sha256"]:
        raise ValueError("frozen HIP binary hash mismatch")
    benchmark = manifest["benchmark"]
    if benchmark["scope"] != "gpu-event-full-operator":
        raise ValueError("unexpected measurement scope")
    configs = {config["id"]: config for config in manifest["configurations"]}
    if len(configs) != len(manifest["configurations"]):
        raise ValueError("duplicate manifest configuration ID")
    shapes = {int(benchmark["shape"]): set(configs)}
    if "validation_selection" in manifest:
        selection = manifest["validation_selection"]
        for shape in (selection["shapes"] if "shapes" in selection else [selection["shape"]]):
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
        raise ValueError(f"expected one ENV: {log}")
    actual = dict(token.split("=", 1) for token in shlex.split(lines[0])[1:])
    expected = {"gpu": manifest["environment"]["gpu"]}
    if runtime == "hip":
        if actual.get("arch", "").split(":")[0] != "gfx1201":
            raise ValueError(f"unexpected HIP architecture: {log}")
        expected["wave_size"] = "32"
    else:
        expected.update(torch=manifest["software"]["torch"], hip=manifest["software"]["hip"],
                        triton=manifest["software"]["triton"].split("+")[0])
    if any(actual.get(k) != v for k, v in expected.items()):
        raise ValueError(f"ENV/manifest mismatch: {log}")


def verify_sample_config(first: dict, planned: tuple, benchmark: dict) -> None:
    shape, process, config = planned
    runtime, block = config["runtime"], config["block"]
    ceil_div = lambda x, y: (x + y - 1) // y
    if runtime == "triton":
        grid = min(ceil_div(shape, block), config["programs"])
        implementation, stages = "triton-two-stage", 2
    else:
        grid = ceil_div(shape, block)
        if config["version"].startswith("local-"):
            grid = min(grid, config["grid"])
        implementation = f"hip-{config['version']}"
        stages = 1 if config["version"].endswith("atomic") else 2
    required = {"config_id": config["id"], "runtime": runtime,
                "implementation": implementation, "stages": stages,
                "shape": shape, "process": process, "block": block, "grid": grid,
                "num_warps": 4 if runtime == "triton" else 0,
                **{key: benchmark[key] for key in ("dtype", "warmup", "repeat", "seed", "scope", "input")}}
    for key, value in required.items():
        if first[key] != str(value):
            raise ValueError(f"sample/manifest mismatch for {config['id']} {key}: {first[key]} != {value}")


def verify_correctness_matrix(root: Path, manifest: dict) -> dict:
    """Validate the planned small/tail logs separately from performance samples."""
    planned = {}
    configs = {c["id"]: c for c in manifest["configurations"]}
    for size in (1, 33, 257, 1023, 1024, 1025):
        for kind in ("random", "weighted", "ones"):
            for config_id in manifest.get("small_edge_configs", []):
                planned[f"edge-n{size}-{kind}-{config_id}.log"] = (size, kind, configs[config_id])
    if "validation_selection" in manifest:
        for kind in ("random", "weighted", "ones"):
            for config_id, config in configs.items():
                planned[f"tail-n1048579-{kind}-{config_id}.log"] = (1048579, kind, config)
    actual = {p.name for pattern in ("edge-*.log", "tail-*.log") for p in (root / "logs").glob(pattern)}
    if actual != planned.keys():
        raise ValueError("correctness log matrix mismatch")
    for name, (size, kind, config) in planned.items():
        path = root / "logs" / name
        verify_log_environment(path, manifest, config["runtime"])
        lines = [line for line in path.read_text().splitlines() if line.startswith("RESULT ")]
        if len(lines) != 1:
            raise ValueError(f"expected one boundary RESULT: {path}")
        result = dict(t.split("=", 1) for t in shlex.split(lines[0])[1:])
        if any(result.get(k) != "OK" for k in ("correct", "precheck", "postcheck")):
            raise ValueError(f"boundary correctness failed: {path}")
        if not config.get("version", "").endswith("atomic") and result.get("partial_check") != "OK":
            raise ValueError(f"boundary partial check failed: {path}")
        result.setdefault("process", "1")
        verify_sample_config(result, (size, 1, config), {**manifest["benchmark"], "warmup": 0, "repeat": 1, "input": kind})
    return {"small_checks": sum(name.startswith("edge-") for name in planned),
            "tail_checks": sum(name.startswith("tail-") for name in planned),
            "total": len(planned), "correct": "OK",
            "logs_sha256": {"logs/" + name: digest(root / "logs" / name) for name in planned}}


def summarize(root: Path, output: Path, *, frozen_root: Path | None = None) -> list[dict]:
    manifest = json.loads((root / "manifest.json").read_text())
    expected = verify_identity(root, manifest, frozen_root)
    manifest["correctness_checks"] = verify_correctness_matrix(root, manifest)
    previous_path = root / "summary/manifest.json"
    if previous_path.exists():
        previous = json.loads(previous_path.read_text())
        if previous["started_at"] != manifest["started_at"] or previous["source_sha256"] != manifest["source_sha256"]:
            raise ValueError("previous publication belongs to another experiment")
        for category in ("sample_sha256", "log_sha256", "profile_sha256"):
            for relative, expected_hash in previous.get(category, {}).items():
                if digest(root / relative) != expected_hash:
                    raise ValueError(f"previously recorded raw file changed: {relative}")
    records, sample_files = [], {}
    for path in sorted((root / "samples").glob("*.csv")):
        rows = list(csv.DictReader(path.open()))
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
        if first["stages"] == "2" and result.get("partial_check") != "OK":
            raise ValueError(f"missing partial validation: {log}")
        for key in META:
            if key == "num_warps" and first["runtime"] == "hip":
                continue
            if result.get(key) != first[key]:
                raise ValueError(f"RESULT/sample mismatch for {key}: {log}")
        median = statistics.median(values)
        if abs(median - float(result["median_ms"])) > 0.00000051:
            raise ValueError(f"RESULT/sample median mismatch: {log}")
        row = {key: first[key] for key in META}
        row.update(process=int(first["process"]),
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
        bandwidths = [(4 * int(key[3]) + 4) / (x * 1e6) for x in medians]
        row = dict(zip(META, key, strict=True))
        row.update(run_count=len(group), correct="OK",
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
                            "identity_check": "frozen source and binary; runtime ENV; exact matrix and metadata; prior raw hashes"}
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
            all_traces = list(csv.DictReader(path.open()))
            stages = [("first", config["first_kernel"])]
            if config.get("final_kernel"):
                stages.append(("final", config["final_kernel"]))
            for stage, kernel in stages:
                traces = [r for r in all_traces if kernel in r["Kernel_Name"]]
                traces.sort(key=lambda r: int(r["Start_Timestamp"]))
                if len(traces) != expected:
                    raise ValueError(f"expected {expected} {kernel} dispatches, found {len(traces)}: {path}")
                timed = traces[skip:]
                duration = [(int(r["End_Timestamp"]) - int(r["Start_Timestamp"])) / 1e6 for r in timed]
                row = {"config_id": config["id"], "shape": manifest["benchmark"]["shape"],
                       "stage": stage, "kernel": kernel, "scope": "rocprofv3-kernel-trace",
                       "trace_dispatches": len(traces), "excluded_precheck_warmup": skip,
                       "timed_dispatches": len(timed), "trace_median_ms": statistics.median(duration),
                       "trace_min_ms": min(duration), "trace_max_ms": max(duration)}
                for field in ("Grid_Size_X", "Workgroup_Size_X", "VGPR_Count", "SGPR_Count", "LDS_Block_Size", "Scratch_Size"):
                    values = {r[field] for r in traces}
                    if len(values) != 1:
                        raise ValueError(f"nonuniform {field}: {path}")
                    row[field] = values.pop()
                profile_rows.append(row)
    # Publish only after every sample and trace has passed identity/correctness checks.
    output.mkdir(parents=True, exist_ok=True)
    write_csv(output / "process-summary.csv", records)
    write_csv(output / "summary.csv", summary)
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    artifacts = ["summary.csv", "process-summary.csv", "summary.json"]
    if profile_rows:
        write_csv(output / "profile-summary.csv", profile_rows)
        artifacts.append("profile-summary.csv")
        manifest["profile_sha256"] = {str(p.relative_to(root)): digest(p) for p in sorted((root / "profiles").glob("*_kernel_trace.csv"))}
    manifest["artifacts_sha256"] = {name: digest(output / name) for name in artifacts}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"summarized {len(summary)} configurations and {len(records)} processes -> {output}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--frozen-run", type=Path)
    args = parser.parse_args()
    summarize(args.run_dir, args.out or args.run_dir / "summary", frozen_root=args.frozen_run)
