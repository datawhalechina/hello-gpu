#!/usr/bin/env python3
"""Execute with the active per-part interpreter and preserve success or failure."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


def execute(target: Path, *, timeout=600):
    import nbformat
    from nbclient import NotebookClient
    runpy.run_path(str(ROOT / "common/bootstrap.py"))
    from hello_gpu import environment
    source = nbformat.read(target, as_version=4)
    relative = target.relative_to(ROOT)
    run = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ-") + uuid4().hex[:8]
    output = ROOT / ".artifacts/executions" / relative.parent / run
    output.mkdir(parents=True)
    try:
        detected_environment = environment()
    except RuntimeError:
        detected_environment = environment(require_gpu=False)
    report = {"status": "running", "run_id": run, "notebook": str(relative),
              "started_at": datetime.now(timezone.utc).isoformat(), "executable": sys.executable,
              "source_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
              "environment": detected_environment}
    report_path = output / "execution.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    with tempfile.TemporaryDirectory(prefix="hello-gpu-kernel-") as directory:
        spec = Path(directory) / "kernels/hello-gpu-execute"
        spec.mkdir(parents=True)
        (spec / "kernel.json").write_text(json.dumps({
            "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
            "display_name": "Hello GPU execute", "language": "python"}))
        previous = os.environ.get("JUPYTER_PATH")
        os.environ["JUPYTER_PATH"] = directory + (os.pathsep + previous if previous else "")
        try:
            NotebookClient(source, timeout=timeout, kernel_name="hello-gpu-execute",
                           resources={"metadata": {"path": str(target.parent)}}).execute()
            report["status"] = "passed"
        except BaseException as error:
            report.update(status="failed", error_type=type(error).__name__, error=str(error))
            raise
        finally:
            if previous is None:
                os.environ.pop("JUPYTER_PATH", None)
            else:
                os.environ["JUPYTER_PATH"] = previous
            nbformat.write(source, output / target.name)
            report["finished_at"] = datetime.now(timezone.utc).isoformat()
            report["code_cells"] = sum(c.cell_type == "code" for c in source.cells)
            report["executed_code_cells"] = sum(c.cell_type == "code" and c.execution_count is not None for c in source.cells)
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("notebook", nargs="?", default="part0-intro/chapter4/chapter4.ipynb")
    parser.add_argument("--part", choices=("part0-intro", "part1-profiling", "part2-kernels"))
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    if args.part:
        entries = json.loads((ROOT / "chapters.json").read_text())["chapters"]
        targets = [ROOT / e["notebook"] for e in entries if e["notebook"].startswith(args.part + "/")]
    else:
        targets = [(ROOT / args.notebook).resolve()]
    failed = []
    for target in targets:
        try:
            execute(target, timeout=args.timeout)
        except Exception as error:
            failed.append(str(target))
            print(f"FAILED {target}: {type(error).__name__}", file=sys.stderr, flush=True)
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
