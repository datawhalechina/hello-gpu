"""Collect real kernel traces in a separate process; never mix with benchmark."""
from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import re
from datetime import datetime, timezone
from uuid import uuid4

import pandas as pd

from .paths import artifact_root
from .environment import environment


def _bundled_profiler_root() -> Path | None:
    """Find the active interpreter's runtime SDK without loading GPU libraries."""
    for entry in sys.path:
        if not entry:
            continue
        root = Path(entry) / "_rocm_sdk_core"
        if (root / "bin/rocprofv3").is_file() and (root / "lib/librocprofiler-sdk.so.1").is_file():
            return root.resolve()
    return None


def capabilities() -> dict:
    from .config import configuration
    config = configuration().get("profiling", {})
    override = config.get("rocprofv3") or os.environ.get("HELLO_GPU_ROCPROFV3")
    bundled = _bundled_profiler_root()
    tool = override or (str(bundled / "bin/rocprofv3") if bundled else shutil.which("rocprofv3"))
    if not tool and os.environ.get("ROCM_PATH"):
        candidate = Path(os.environ["ROCM_PATH"]) / "bin/rocprofv3"
        tool = str(candidate) if candidate.exists() else None
    if tool and not Path(tool).is_file():
        tool = shutil.which(str(tool)) or tool
    root = Path(tool).resolve().parent.parent if tool else None
    # A configured venv console entry still delegates to rocm_sdk_core._cli.
    # Select its real launcher, avoiding an ambiguous .venv/bin root.
    if bundled and root and not (root / "lib/librocprofiler-sdk.so.1").is_file():
        candidate = Path(tool)
        if candidate.is_file():
            with candidate.open(errors="ignore") as source:
                console_entry = source.read(2048)
            if "from rocm_sdk_core._cli import rocprofv3" in console_entry:
                root, tool = bundled, str(bundled / "bin/rocprofv3")
    library_dirs = [str(root / name) for name in ("lib", "lib64")
                    if root and (root / name).is_dir()]
    return {"available": bool(tool and Path(tool).is_file()), "rocprofv3": tool,
            "rocm_root": str(root) if root else None, "library_dirs": library_dirs,
            "enabled": config.get("enabled", True),
            "scope": "kernel timestamp/resource trace; no guaranteed PMC or occupancy counters"}


def _profiler_environment(caps: dict) -> dict[str, str]:
    """Keep profiler injection and runtime lookup in one SDK, only in the child.

    ROCm 10 core/devel files can be hardlinks at distinct paths. Loading the
    profiler from core while looking up its dependencies in devel can register
    the SDK twice under different names. Prefer the selected runtime's libraries
    but preserve ROCM_PATH/HIP_PATH so HIP compilation can still use devel.
    """
    child = os.environ.copy()
    # Notebook bootstrap changes sys.path, which a new Python process does not
    # inherit. Make this checkout's helpers available to the traced workload.
    source = str(Path(__file__).resolve().parents[1])
    existing = child.get("PYTHONPATH")
    child["PYTHONPATH"] = source + (os.pathsep + existing if existing else "")
    root = caps.get("rocm_root")
    if not root:
        return child
    sdk = Path(root) / "lib/librocprofiler-sdk.so.1"
    if not sdk.is_file():
        return child
    directories = list(caps.get("library_dirs") or [str(sdk.parent)])
    directories.extend(item for item in child.get("LD_LIBRARY_PATH", "").split(os.pathsep) if item)
    child["LD_LIBRARY_PATH"] = os.pathsep.join(dict.fromkeys(directories))
    child["ROCPROFILER_REGISTER_LIBRARY"] = str(sdk.resolve())
    # The selected launcher injects its own profiler libraries. Keep unrelated
    # preloads (for example sanitizers), removing only inherited profiler copies.
    for key in ("LD_PRELOAD", "ROCP_TOOL_LIBRARIES", "ROCPROF_PRELOAD"):
        if key not in child:
            continue
        values = [item for item in re.split(r"[:\s]+", child[key]) if item]
        kept = [item for item in values if not Path(item).name.startswith("librocprofiler-")]
        if kept:
            child[key] = ":".join(kept)
        else:
            child.pop(key, None)
    return child


def kernel_trace(kernels: dict, *, n: int, block: int = 256, launches: int = 3,
                 label: str = "trace", grid_limits: dict[str, int | None] | None = None) -> dict:
    """Trace authored HIP sources and explicit launch settings in a fresh process.

    grid_limits maps the supplied kernel dictionary names to actual call-time
    caps, overriding each compiled object's default. None requests a full grid.
    Give kernels distinct entry names so CSV rows can be attributed to each one.
    """
    caps = capabilities()
    if not caps["enabled"] or not caps["available"]:
        return {"status": "unavailable", "reason": "rocprofv3 未启用或未安装", "capabilities": caps}
    for name, value in (("n", n), ("block", block), ("launches", launches)):
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f"{name} must be a positive integer")
    if not kernels:
        raise ValueError("kernels must contain at least one compiled HIP kernel")
    if grid_limits is not None and not isinstance(grid_limits, dict):
        raise TypeError("grid_limits must be a dictionary keyed by kernel name")
    overrides = grid_limits or {}
    if overrides.keys() - kernels.keys():
        raise ValueError("grid_limits contains an unknown kernel name")
    from .hip import _grid_limit
    specs = {}
    for name, kernel in kernels.items():
        cap = overrides.get(name, kernel.build_config.get("grid_limit"))
        _grid_limit(cap)
        full_grid = (n + block - 1) // block
        specs[name] = {
            "source": kernel.source,
            "source_sha256": hashlib.sha256(kernel.source.encode()).hexdigest(),
            "entry": kernel.build_config.get("entry", "kernel"),
            "build_grid_limit": kernel.build_config.get("grid_limit"),
            "grid_limit": cap,
            "launch": {"n": n, "block": block, "grid_limit": cap,
                       "grid_blocks": min(full_grid, cap) if cap is not None else full_grid,
                       "launches": launches},
        }
    entries = [spec["entry"] for spec in specs.values()]
    if len(entries) != len(set(entries)):
        raise ValueError("kernel_trace requires distinct entry names to verify each kernel's launch count")
    if not label.replace("-", "").replace("_", "").isalnum():
        raise ValueError("label uses letters, digits, '-' and '_'")
    run = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S-") + uuid4().hex[:8]
    target = artifact_root() / "profiles" / label / run
    target.mkdir(parents=True)
    payload = {"kernels": specs, "n": n, "block": block, "launches": launches}
    (target / "input.json").write_text(json.dumps(payload))
    script = target / "workload.py"
    script.write_text('''import json, sys, torch
from pathlib import Path
from hello_gpu import compile_kernel
p = json.loads(Path(sys.argv[1]).read_text())
a = torch.arange(p["n"], device="cuda", dtype=torch.float32)
b = torch.full_like(a, 2)
for name, spec in p["kernels"].items():
    k = compile_kernel(name, spec["source"], entry=spec["entry"], grid_limit=spec["grid_limit"])
    out = torch.empty_like(a)
    run = k.prepare(a,b,block=p["block"],out=out,grid_limit=spec["grid_limit"])
    for _ in range(p["launches"]):
        out.fill_(float("nan"))
        out = run()
    torch.testing.assert_close(out,a+b)
torch.cuda.current_stream().synchronize()
''')
    command = [caps["rocprofv3"]]
    if caps.get("rocm_root"):
        command.extend(["--rocm-root", caps["rocm_root"]])
    command += ["--kernel-trace", "--output-format", "csv",
               "--output-directory", str(target), "--", sys.executable, str(script), str(target / "input.json")]
    child_env = _profiler_environment(caps)
    completed = subprocess.run(command, capture_output=True, text=True, timeout=600,
                               env=child_env, cwd=target)
    (target / "stdout.log").write_text(completed.stdout)
    (target / "stderr.log").write_text(completed.stderr)
    report = {"status": "passed" if completed.returncode == 0 else "failed",
              "returncode": completed.returncode, "directory": str(target),
              "command": command, "working_directory": str(target),
              "environment": environment(), "input": payload,
              "profiler": {"executable": caps["rocprofv3"], "rocm_root": caps.get("rocm_root"),
                           "library_dirs": caps.get("library_dirs", []),
                           "registration_library": child_env.get("ROCPROFILER_REGISTER_LIBRARY")}}
    frames, csv_errors = [], []
    for csv in target.rglob("*kernel_trace.csv"):
        try:
            frame = pd.read_csv(csv)
        except (pd.errors.EmptyDataError, pd.errors.ParserError) as error:
            csv_errors.append({"file": str(csv), "error": str(error)})
            continue
        frame["trace_file"] = str(csv)
        frames.append(frame)
    table = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    counts = {name: 0 for name in specs}
    if "Kernel_Name" in table:
        patterns = {name: re.compile(r"(?<![A-Za-z0-9_])" + re.escape(spec["entry"]) + r"(?=\s*(?:[<(]|$))")
                    for name, spec in specs.items()}
        labels = table["Kernel_Name"].astype(str).map(
            lambda text: next((name for name, pattern in patterns.items() if pattern.search(text)), None))
        table = table[labels.notna()].copy()
        table["implementation"] = labels[labels.notna()]
        counts.update({name: int((table["implementation"] == name).sum()) for name in specs})
    else:
        table = table.iloc[:0].copy()
    if {"Start_Timestamp", "End_Timestamp"}.issubset(table.columns):
        table["duration_us"] = (table.End_Timestamp - table.Start_Timestamp) / 1000
    report["target_records"] = len(table)
    report["target_records_by_kernel"] = counts
    report["csv_errors"] = csv_errors
    missing = {name: count for name, count in counts.items() if count < launches}
    if missing:
        report["status"] = "failed"
        report["reason"] = f"Expected at least {launches} target records per kernel; insufficient records: {missing}"
    elif completed.returncode != 0:
        report["reason"] = f"rocprofv3 workload exited with status {completed.returncode}; see stderr.log"
    (target / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    report["table"] = table
    return report


def trace_summary(report: dict) -> pd.DataFrame:
    table = report.get("table", pd.DataFrame())
    columns = [name for name in ("implementation", "Kernel_Name", "duration_us", "Workgroup_Size_X", "Grid_Size_X",
                                "VGPR_Count", "SGPR_Count", "LDS_Block_Size") if name in table]
    return table[columns].copy()
