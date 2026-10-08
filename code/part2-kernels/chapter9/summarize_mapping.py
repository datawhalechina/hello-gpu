#!/usr/bin/env python3
"""Summarize independent mapping runs without pooling their timing samples."""

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import median


CONFIG_FIELDS = ("size", "block", "input", "seed")
GROUP_FIELDS = (*CONFIG_FIELDS, "version", "interval")
RAW_FIELDS = {
    "round", "position", "interval_position", "version", "interval",
    "size", "block", "input", "seed", "event_ms",
}


def unsigned(value, name, path, line):
    if not value or not value.isascii() or not value.isdecimal():
        raise ValueError(f"{path}:{line}: invalid {name}: {value!r}")
    return int(value)


def read_process(path):
    """One CSV must represent one process and one input configuration."""
    groups = defaultdict(list)
    seen = set()
    configurations = set()
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        if set(reader.fieldnames or ()) != RAW_FIELDS:
            raise ValueError(f"{path}: unexpected CSV header")
        for line, row in enumerate(reader, 2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"{path}:{line}: incomplete CSV row")
            for field in ("round", "position", "interval_position", "size", "block", "seed"):
                row[field] = unsigned(row[field], field, path, line)
            if row["size"] == 0 or row["block"] == 0:
                raise ValueError(f"{path}:{line}: size and block must be positive")
            if row["version"] not in {"interleaved", "compacted", "sequential"}:
                raise ValueError(f"{path}:{line}: unknown version")
            if row["interval"] not in {"partial", "two-stage"}:
                raise ValueError(f"{path}:{line}: unknown timing interval")
            if row["input"] not in {"random", "ones", "weighted"}:
                raise ValueError(f"{path}:{line}: unknown input")
            elapsed = float(row["event_ms"])
            if not math.isfinite(elapsed) or elapsed <= 0:
                raise ValueError(f"{path}:{line}: event_ms must be finite and positive")
            identity = (row["round"], row["version"], row["interval"])
            if identity in seen:
                raise ValueError(f"{path}:{line}: duplicate sample {identity}")
            seen.add(identity)
            configurations.add(tuple(row[field] for field in CONFIG_FIELDS))
            groups[tuple(row[field] for field in GROUP_FIELDS)].append((row["round"], elapsed))
    if not groups:
        raise ValueError(f"{path}: no timing samples")
    if len(configurations) != 1:
        raise ValueError(f"{path}: one process CSV must contain one input configuration")
    counts = {len(values) for values in groups.values()}
    if len(counts) != 1:
        raise ValueError(f"{path}: unequal repeat counts; possible incomplete run")

    summaries = []
    for key, values in sorted(groups.items()):
        if sorted(round_id for round_id, _ in values) != list(range(len(values))):
            raise ValueError(f"{path}: missing or non-contiguous rounds for {key}")
        times = [elapsed for _, elapsed in values]
        summaries.append({
            "process": str(path),
            **dict(zip(GROUP_FIELDS, key)),
            "samples": len(times),
            "median_ms": median(times),
            "minimum_ms": min(times),
            "maximum_ms": max(times),
        })
    return summaries


def summarize(paths, path_base=None):
    paths = [path.resolve() for path in paths]
    if len(paths) != len(set(paths)):
        raise ValueError("the same CSV was supplied more than once")
    processes = [row for path in paths for row in read_process(path)]
    if path_base is not None:
        for row in processes:
            row["process"] = Path(row["process"]).relative_to(path_base.resolve()).as_posix()
    groups = defaultdict(list)
    for row in processes:
        groups[tuple(row[field] for field in GROUP_FIELDS)].append(row)
    aggregates = []
    for key, runs in sorted(groups.items()):
        medians = [row["median_ms"] for row in runs]
        aggregates.append({
            **dict(zip(GROUP_FIELDS, key)),
            "process_count": len(runs),
            "median_of_process_medians_ms": median(medians),
            "minimum_process_median_ms": min(medians),
            "maximum_process_median_ms": max(medians),
            "process_medians": [
                {"process": row["process"], "samples": row["samples"], "median_ms": row["median_ms"]}
                for row in runs
            ],
        })
    return {
        "method": "One median per process/configuration/version/interval; no pooling across processes or intervals.",
        "correctness": "Timing CSVs do not contain correctness checks; review each corresponding run log separately.",
        "process_summaries": processes,
        "aggregate_summaries": aggregates,
    }


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("samples", nargs="+", type=Path, help="one raw samples.csv per independent process")
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).resolve().parent / "results" / "mapping-summary")
    parser.add_argument("--path-base", type=Path,
                        help="store input CSV paths relative to this directory, for portable evidence")
    args = parser.parse_args()
    try:
        result = summarize(args.samples, args.path_base)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        write_csv(args.output_dir / "process-summary.csv", result["process_summaries"])
        aggregates = [{key: value for key, value in row.items() if key != "process_medians"}
                      for row in result["aggregate_summaries"]]
        write_csv(args.output_dir / "summary.csv", aggregates)
        (args.output_dir / "summary.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for row in result["aggregate_summaries"]:
            values = ",".join(f"{run['median_ms']:.6f}" for run in row["process_medians"])
            print(f"SUMMARY size={row['size']} block={row['block']} input={row['input']} "
                  f"seed={row['seed']} version={row['version']} interval={row['interval']} "
                  f"processes={row['process_count']} process_medians_ms=[{values}] "
                  f"median_of_process_medians_ms={row['median_of_process_medians_ms']:.6f} "
                  f"range_ms=[{row['minimum_process_median_ms']:.6f},{row['maximum_process_median_ms']:.6f}]")
        print(f"Summary directory: {args.output_dir.resolve()}")
        print("Correctness must be checked in the run logs; this script summarizes timings only.")
    except (OSError, ValueError) as error:
        parser.exit(1, f"ERROR {error}\n")


if __name__ == "__main__":
    main()
