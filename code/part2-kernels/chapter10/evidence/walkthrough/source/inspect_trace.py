"""Read one rocprofv3 kernel-trace window using only Python's standard library."""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
import re
import statistics


GRID_FIELDS = tuple(f"Grid_Size_{axis}" for axis in "XYZ")
GROUP_FIELDS = tuple(f"Workgroup_Size_{axis}" for axis in "XYZ")
RESOURCE_FIELDS = ("VGPR_Count", "SGPR_Count", "LDS_Block_Size", "Scratch_Size")
INTEGER_FIELDS = ("Start_Timestamp", "End_Timestamp", *GRID_FIELDS,
                  *GROUP_FIELDS, *RESOURCE_FIELDS)
REQUIRED_FIELDS = ("Kernel_Name", *INTEGER_FIELDS)


class TraceError(ValueError):
    """The CSV cannot support the requested comparison."""


def analyze_trace(path: Path, kernel: str, skip: int, take: int) -> dict:
    if not kernel.strip():
        raise TraceError("--kernel must be a non-empty name substring")
    if skip < 0 or take <= 0:
        raise TraceError("--skip must be non-negative and --take must be positive")
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file, strict=True)
        fields = reader.fieldnames or []
        if len(fields) != len(set(fields)):
            raise TraceError("CSV has duplicate column names")
        missing = sorted(set(REQUIRED_FIELDS) - set(fields))
        if missing:
            raise TraceError("CSV is missing required columns: " + ", ".join(missing))
        for row in reader:
            where = f"CSV line {reader.line_num}"
            if None in row or any(value is None for value in row.values()):
                raise TraceError(f"{where}: row width does not match the header")
            if not row["Kernel_Name"].strip():
                raise TraceError(f"{where}: Kernel_Name is empty")
            for field in INTEGER_FIELDS:
                value = row[field].strip()
                if not re.fullmatch(r"[0-9]+", value):
                    raise TraceError(f"{where}: {field} must be a non-negative integer, got {value!r}")
                row[field] = int(value)
            if row["End_Timestamp"] < row["Start_Timestamp"]:
                raise TraceError(f"{where}: End_Timestamp is earlier than Start_Timestamp")
            for grid_field, group_field in zip(GRID_FIELDS, GROUP_FIELDS):
                grid, group = row[grid_field], row[group_field]
                if grid <= 0 or group <= 0 or grid % group:
                    raise TraceError(f"{where}: {grid_field} must be a positive multiple of {group_field}")
            rows.append(row)

    targets = [row for row in rows if kernel in row["Kernel_Name"]]
    names = sorted({row["Kernel_Name"] for row in targets})
    if len(names) != 1:
        detail = "no kernel names" if not names else ", ".join(repr(name) for name in names)
        raise TraceError(f"--kernel must match exactly one distinct Kernel_Name; matched {detail}")
    expected = skip + take
    if len(targets) != expected:
        raise TraceError(f"expected exactly skip + take = {expected} target rows, found {len(targets)}")
    targets.sort(key=lambda row: row["Start_Timestamp"])
    first = targets[0]
    for row in targets[1:]:
        changed = [field for field in (*GRID_FIELDS, *GROUP_FIELDS, *RESOURCE_FIELDS)
                   if row[field] != first[field]]
        if changed:
            raise TraceError("target rows have different launch/resource fields: " + ", ".join(changed))
    kept = targets[skip:]
    durations = [row["End_Timestamp"] - row["Start_Timestamp"] for row in kept]
    grid = [first[field] for field in GRID_FIELDS]
    group = [first[field] for field in GROUP_FIELDS]
    groups = [g // w for g, w in zip(grid, group)]
    return {
        "csv_rows": len(rows), "kernel_name": names[0], "target_rows": len(targets),
        "skipped_rows": skip, "kept_rows": len(kept),
        "first_kept": {"start_ns": kept[0]["Start_Timestamp"],
                       "end_ns": kept[0]["End_Timestamp"], "duration_ns": durations[0]},
        "kernel_time_us": {"min": min(durations) / 1000,
                           "median": statistics.median(durations) / 1000,
                           "max": max(durations) / 1000},
        "launch": {"grid_work_items_xyz": grid, "workgroup_size_xyz": group,
                   "workgroups_xyz": groups, "workgroups_total": math.prod(groups)},
        "resources": dict(zip(("vgpr_count", "sgpr_count", "lds_bytes", "scratch_bytes"),
                              (first[field] for field in RESOURCE_FIELDS))),
    }


def print_report(report: dict) -> None:
    print("kernel_name=" + json.dumps(report["kernel_name"], ensure_ascii=False))
    print(" ".join(f"{key}={report[key]}" for key in
                   ("csv_rows", "target_rows", "skipped_rows", "kept_rows")))
    print("sort=Start_Timestamp_ascending")
    print(" ".join(f"first_{key}={value}" for key, value in report["first_kept"].items()))
    print(" ".join(f"kernel_{key}_us={value:.6f}" for key, value in report["kernel_time_us"].items()))
    launch = report["launch"]
    print(" ".join(f"{key}=" + "x".join(map(str, launch[key])) for key in
                   ("grid_work_items_xyz", "workgroup_size_xyz", "workgroups_xyz")))
    print(f"workgroups_total={launch['workgroups_total']}")
    print(" ".join(f"{key}={value}" for key, value in report["resources"].items()))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="rocprofv3 *_kernel_trace.csv")
    parser.add_argument("--kernel", required=True, help="case-sensitive Kernel_Name substring")
    parser.add_argument("--skip", required=True, type=int, help="target rows before the measured window")
    parser.add_argument("--take", required=True, type=int, help="exact number of measured target rows")
    parser.add_argument("--json", action="store_true", help="print the same report as JSON")
    args = parser.parse_args(argv)
    try:
        report = analyze_trace(args.path, args.kernel, args.skip, args.take)
    except (TraceError, OSError, UnicodeError, csv.Error) as error:
        parser.error(str(error))
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
