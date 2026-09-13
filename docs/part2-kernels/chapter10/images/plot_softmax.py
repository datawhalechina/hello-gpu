"""Render historical Chapter 10 evidence from before the LDS synchronization fix."""

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
    evidence = PART / "chapter10" / "evidence"
    with (evidence / "summary.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    manifest = json.loads((evidence / "manifest.json").read_text(encoding="utf-8"))
    benchmark = manifest["benchmark"]
    environment = manifest["environment"]
    hardware = environment["torch.cuda.device_name"]
    system = environment["PRETTY_NAME"].strip('"')
    rocm = ".".join(environment["torch.version.hip"].split(".")[:2])
    date = manifest["generated_at"].split("T", 1)[0]

    render_timing_figure(
        panels=[TimingPanel(rows, xmax=0.84)],
        title="Softmax 各实现的完整计时",
        subtitle=(
            f"{hardware} · {benchmark['shape'].replace('x', ' × ')} · FP32 · "
            f"{system} · ROCm {rocm} · 历史实验 {date}"
        ),
        notes=[
            f"每进程预热 {benchmark['warmup']} 次、计时重复 {benchmark['repeat']} 次；完整 GPU event 区间，越短越好。",
            "历史实验：LDS 复用同步修正前的数据，不代表修正后的性能。",
        ],
        labels={'hip-baseline-3kernel': 'HIP baseline-3kernel', 'hip-fused-block-lds': 'HIP fused-block-LDS', 'triton-t0-compact': 'Triton t0-compact', 'triton-t1-wide': 'Triton t1-wide'},
        output=HERE / "softmax-performance.png",
    )


if __name__ == "__main__":
    main()
