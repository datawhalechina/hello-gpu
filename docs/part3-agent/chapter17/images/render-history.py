"""重画已有 Agent 轨迹；保留数据，只在公开图中省略软件版本。"""

from pathlib import Path
import shutil
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PART = ROOT / "code/part3-agent"
sys.path.insert(0, str(PART / "chapter16"))

from visualize_trajectory import render_visualizations


def main() -> None:
    workspace = PART / "chapter15/logs/tasks/vector-add-20260913-01"
    if not (workspace / "trajectory.jsonl").is_file():
        raise FileNotFoundError(f"需要本地归档轨迹：{workspace / 'trajectory.jsonl'}")
    paths = render_visualizations(
        workspace,
        out_dir=HERE,
        title="向量加法 Agent · 历史参考结果 · 2026-09-13",
        show_software_version=False,
    )
    names = {
        "rounds_overview.png": "vector-add-9070xt-rounds.png",
        "status_breakdown.png": "vector-add-9070xt-status.png",
        "process_timeline.png": "vector-add-9070xt-timeline.png",
    }
    for path in paths:
        shutil.copyfile(path, HERE / names[path.name])


if __name__ == "__main__":
    main()
