#!/usr/bin/env python3
"""Register each installed part's interpreter in the notebook server prefix."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
PARTS = ("part0-intro", "part1-profiling", "part2-kernels")

for part in PARTS:
    if not (ROOT / part / ".venv/bin/python").is_file():
        continue
    target = Path(sys.prefix) / "share/jupyter/kernels" / f"hello-gpu-{part}"
    target.mkdir(parents=True, exist_ok=True)
    (target / "kernel.json").write_text(json.dumps({
        "argv": ["bash", str(ROOT / "tools/kernel.sh"), part, "{connection_file}"],
        "display_name": f"Hello GPU · {part} (ROCm)",
        "language": "python",
    }, ensure_ascii=False, indent=2))
    print(f"Registered {part}")
