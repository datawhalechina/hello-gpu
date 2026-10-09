#!/usr/bin/env python3
"""Check that registered Jupyter kernels activate each part's own GPU SDK."""
import json
from pathlib import Path
import sys

import nbformat
from nbclient import NotebookClient

ROOT = Path(__file__).resolve().parents[1]
PARTS = ("part0-intro", "part1-profiling", "part2-kernels")


def main():
    reports = []
    for part in PARTS:
        expected_prefix = str(ROOT / part / ".venv")
        if not (Path(expected_prefix) / "bin/python").is_file():
            continue
        code = f'''import json, os, sys, torch
import hello_gpu as gpu
assert sys.prefix == {expected_prefix!r}, sys.prefix
assert os.environ["ROCM_PATH"].startswith(sys.prefix), os.environ["ROCM_PATH"]
assert os.environ["HIP_PATH"].startswith(sys.prefix), os.environ["HIP_PATH"]
a = torch.tensor([1., 2., 3.], device="cuda")
torch.testing.assert_close(a + 1, torch.tensor([2., 3., 4.], device="cuda"))
context = gpu.environment()
context["prefix"] = sys.prefix
context["rocm_path"] = os.environ["ROCM_PATH"]
print(json.dumps(context))'''
        notebook = nbformat.v4.new_notebook(cells=[nbformat.v4.new_code_cell(code)])
        NotebookClient(notebook, kernel_name=f"hello-gpu-{part}", timeout=60,
                       resources={"metadata": {"path": str(ROOT)}}).execute()
        streams = [output["text"] for output in notebook.cells[0].outputs
                   if output.output_type == "stream" and output.name == "stdout"]
        reports.append({"part": part, "status": "passed", "environment": json.loads("".join(streams))})
    if not reports:
        raise RuntimeError("No per-part environments are installed")
    target = ROOT / ".artifacts/validation/kernel-startup.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(reports, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps([{"part": row["part"], "status": row["status"]} for row in reports], indent=2))


if __name__ == "__main__":
    main()
