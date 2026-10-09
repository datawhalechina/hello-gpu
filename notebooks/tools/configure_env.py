#!/usr/bin/env python3
"""Select the learner's ROCm device extra; never assume one particular GPU."""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
PARTS = ("part0-intro", "part1-profiling", "part2-kernels")
ARCHITECTURES = ("gfx950", "gfx942", "gfx90a", "gfx908", "gfx1201", "gfx1200",
                 "gfx1100", "gfx1101", "gfx1102", "gfx1030", "gfx1151", "gfx1150",
                 "gfx1152", "gfx1153", "gfx1103")


def detect_arch(part: Path) -> str:
    candidates = [part / ".venv/bin/rocminfo", shutil.which("rocminfo")]
    for candidate in candidates:
        if not candidate or not Path(candidate).exists():
            continue
        result = subprocess.run([str(candidate)], capture_output=True, text=True, timeout=30)
        architectures = list(dict.fromkeys(re.findall(r"\bName:\s+(gfx[0-9a-z]+)\b", result.stdout)))
        if len(architectures) == 1:
            return architectures[0]
        if len(architectures) > 1:
            raise RuntimeError("检测到不同 GPU 架构，请通过 --arch 指定本篇使用的设备。")
    interpreter = part / ".venv/bin/python"
    if interpreter.exists():
        result = subprocess.run([str(interpreter), "-c",
            "import torch; print(torch.cuda.get_device_properties(torch.cuda.current_device()).gcnArchName.split(':')[0])"],
            capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and re.fullmatch(r"gfx[0-9a-z]+", result.stdout.strip()):
            return result.stdout.strip()
    raise RuntimeError("无法自动探测设备。先运行 rocminfo，并用 --arch gfxXXXX 指定其输出。")


def configure(text: str, arch: str) -> str:
    if arch not in ARCHITECTURES:
        raise ValueError(f"当前 ROCm 依赖配置未列出 {arch}；请核对 AMD 支持列表或使用已有环境。")
    parsed = tomllib.loads(text)
    if "project" not in parsed:
        raise ValueError("Missing project")
    text = re.sub(r'torch(?:\[[^\]]+\])?==2\.13\.0\+rocm10\.0\.0',
                  f'torch[device-{arch}]==2.13.0+rocm10.0.0', text)
    text = re.sub(r'rocm(?:\[[^\]]+\])?==10\.0\.0', f'rocm[devel,device-{arch}]==10.0.0', text)
    tomllib.loads(text)
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--part", choices=(*PARTS, "all"), required=True)
    parser.add_argument("--arch", default="auto", help="auto 或 rocminfo 返回的 gfxXXXX")
    parser.add_argument("--sync", action="store_true", help="在选定篇目录执行 uv sync")
    args = parser.parse_args()
    for name in PARTS if args.part == "all" else [args.part]:
        part = ROOT / name
        arch = detect_arch(part) if args.arch == "auto" else args.arch
        project = part / "pyproject.toml"
        project.write_text(configure(project.read_text(), arch))
        print(f"{name}: device extra = {arch}", flush=True)
        if args.sync:
            uv = shutil.which("uv") or str(Path.home() / ".local/bin/uv")
            subprocess.run([uv, "sync"], cwd=part, check=True)


if __name__ == "__main__":
    main()
