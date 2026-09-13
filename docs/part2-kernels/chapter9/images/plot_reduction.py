"""Render Chapter 9's archived evidence without running a GPU experiment."""

import csv
import json
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PART = ROOT / "code" / "part2-kernels"
sys.path.insert(0, str(PART))

from common.plot_style import TimingPanel, render_timing_figure


def main() -> None:
    evidence = PART / "chapter9" / "evidence"
    with (evidence / "summary.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    manifest = json.loads((evidence / "manifest.json").read_text(encoding="utf-8"))
    benchmark = manifest["benchmark"]
    environment = manifest["environment"]
    two_stage_ids = {"hip-two-stage", "triton-t0", "triton-t1-local"}
    two_stage_rows = [row for row in rows if row["implementation"] in two_stage_ids]
    hardware = environment["torch.cuda.device_name"]
    system = environment["PRETTY_NAME"].strip('"')
    rocm = ".".join(environment["torch.version.hip"].split(".")[:2])
    date = manifest["generated_at"].split("T", 1)[0]

    render_timing_figure(
        panels=[
            TimingPanel(rows, title="全部实现", xmax=38),
            TimingPanel(two_stage_rows, title="两阶段实现 · 独立线性坐标放大", xmax=0.072),
        ],
        title="Reduction 完整计时与两阶段实现对比",
        subtitle=(
            f"{hardware} · N = {int(benchmark['shape']):,} · FP32 · "
            f"{system} · ROCm {rocm} · 历史实验 {date}"
        ),
        notes=[
            f"每进程预热 {benchmark['warmup']} 次、计时重复 {benchmark['repeat']} 次；完整 GPU event 区间，越短越好。",
            "HIP 计时包含输出清零，Triton 无需清零；输入为交替 +1/−1，重复使用。",
        ],
        labels={'hip-atomic': 'HIP atomic', 'hip-lds': 'HIP LDS', 'hip-two-stage': 'HIP two-stage', 'triton-t0': 'Triton t0', 'triton-t1-local': 'Triton t1-local'},
        output=HERE / "reduction-performance.png",
        layout="vertical",
    )


if __name__ == "__main__":
    main()
