#!/usr/bin/env python3
"""把 docs/part3-agent（第14–17章）整理成一份可运行验收脚本。

覆盖：
1. 第15章工具层单测（可选）
2. 第16/17章 vector_add 非交互 Agent 闭环（硅基流动 LLM）
3. 打印确定性汇总 + 轨迹表
4. 可视化每轮优化过程（PNG）

用法（在 code/part3-agent 根目录）：
  source ./activate-rocm.sh
  uv run python chapter16/run_part3_test.py
  uv run python chapter16/run_part3_test.py --max-steps 12 --skip-pytest
  uv run python chapter16/run_part3_test.py --reuse-latest   # 只可视化最近一次运行
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import time
from importlib.metadata import version
import subprocess
import sys
from datetime import datetime
from pathlib import Path

PART_ROOT = Path(__file__).resolve().parent.parent
FIXTURE = PART_ROOT / "chapter15" / "fixtures" / "vector_add"
LOG_ROOT = PART_ROOT / "chapter16" / "logs"
DEFAULT_MAX_STEPS = 12


def _ensure_path() -> None:
    if str(PART_ROOT) not in sys.path:
        sys.path.insert(0, str(PART_ROOT))
    chapter16 = PART_ROOT / "chapter16"
    if str(chapter16) not in sys.path:
        sys.path.insert(0, str(chapter16))


def _print_banner() -> None:
    line = "═" * 60
    print()
    print(f"╭{line}╮")
    print("│  part3-agent 本地验收 · docs/part3-agent ch14–17          │")
    print(f"╰{line}╯")
    print()
    print("映射：")
    print("  ch14 Agent 入门     → kernel_optimize 主循环")
    print("  ch15 工具封装       → chapter14 evaluate + tools")
    print("  ch16 Agent 设计     → fixtures/vector_add + batch 入口")
    print("  ch17 多轮实战       → 本脚本：跑闭环 + 打印 + 可视化")
    print()


def _check_llm_env() -> None:
    from kernel_optimize.llm import _model_config

    model, api_base = _model_config()
    print(f"[env] MODEL     = {model}")
    print(f"[env] API_BASE  = {api_base or '(default)'}")
    key_set = bool(os.environ.get("KERNEL_AGENT_API_KEY") or os.environ.get("OPENAI_API_KEY"))
    print(f"[env] API_KEY   = {'set' if key_set else 'missing'}")


def _check_gpu() -> dict:
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("当前进程看不到 HIP/CUDA GPU")
    environment = {
        "gpu": torch.cuda.get_device_name(0),
        "gpuArch": getattr(torch.cuda.get_device_properties(0), "gcnArchName", None),
        "torch": torch.__version__,
        "hipRuntime": torch.version.hip,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "osRelease": platform.freedesktop_os_release(),
        "packages": {name: version(name) for name in ("rocm", "triton", "litellm", "numpy")},
        "recordedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    print(f"[gpu] torch={environment['torch']}  device={environment['gpu']}  arch={environment['gpuArch']}")
    return environment


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _prepare_baseline(workspace: Path) -> None:
    from kernel_optimize.tools import _evaluator
    from kernel_optimize.measure import ensure_peak

    _write_json(workspace / "environment.json", _check_gpu())
    evaluate = _evaluator()
    for name, correctness_only in (("preflight.json", True), ("baseline-evaluation.json", False)):
        result = evaluate(
            workspace / "task.json", workspace / "baseline.py",
            reference_path=workspace / "reference.py", correctness_only=correctness_only,
        )
        _write_json(workspace / name, result)
        if result.get("status") != "ok" or (result.get("correctness") or {}).get("passed") is not True:
            raise RuntimeError(f"基线验证失败，详见 {workspace / name}")
    # 每次新实验重新校准；不要沿用另一环境留下的机器缓存。
    if not ensure_peak(workspace, force=True):
        raise RuntimeError("硬件校准失败，无法为 profiling 提供当前环境的参照")


def _final_compare(workspace: Path) -> int:
    print("\n── 原始 baseline 与最终 best 独立配对复测（5 次）──")
    cmd = [sys.executable, str(PART_ROOT / "chapter14" / "compare.py"),
           "--task", str(workspace / "task.json"),
           "--incumbent", str(workspace / "baseline.py"),
           "--candidate", str(workspace / "best.py"), "--runs", "5"]
    with (workspace / "final-comparison.json").open("w", encoding="utf-8") as out, \
         (workspace / "final-comparison.stderr.log").open("w", encoding="utf-8") as err:
        proc = subprocess.run(cmd, cwd=PART_ROOT, stdout=out, stderr=err)
    print(f"[compare] exit={proc.returncode}  result={workspace / 'final-comparison.json'}")
    return proc.returncode


def _run_pytest() -> int:
    print("\n── 1) chapter14 / kernel_optimize 单测 ──")
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "kernel_optimize/tests",
        "chapter14",
        "-q",
        "--tb=line",
    ]
    print("$", " ".join(cmd))
    proc = subprocess.run(cmd, cwd=PART_ROOT)
    print(f"[pytest] exit={proc.returncode}")
    return proc.returncode


def _latest_workspace() -> Path | None:
    root = PART_ROOT / "chapter15" / "logs" / "tasks"
    if not root.is_dir():
        return None
    candidates = sorted([p for p in root.iterdir() if p.is_dir() and (p / "trajectory.jsonl").is_file()])
    return candidates[-1] if candidates else None


def _run_agent(max_steps: int, workspace: Path) -> tuple[int, str]:
    print("\n── 2) vector_add Agent 闭环（batch）──")
    print(f"fixtures : {FIXTURE}")
    print(f"workspace: {workspace}")
    print(f"max_steps: {max_steps}")

    from kernel_optimize.__main__ import (  # type: ignore
        _print_deterministic_summary,
        _seed_workspace_from_fixture,
    )
    from kernel_optimize.agent import run_agent

    def on_step(step: int, action: str, observation: str | None) -> None:
        if action == "done":
            print(f"\n[step {step}] agent 完成")
        elif action == "nudge":
            print(f"[step {step}] （提示改用工具）")
        elif action.startswith("tool:"):
            print(f"[step {step}] 调工具 {action.split(':', 1)[1]} …")
        elif action.startswith("result:") and observation:
            first = observation.strip().splitlines()[0] if observation.strip() else ""
            print(f"[step {step}]   → {first[:160]}")

    if workspace.exists() and any(workspace.iterdir()):
        print("✗ 新实验需要空工作区；查看旧结果请使用 --skip-agent --workspace")
        return 1, "(existing workspace preserved)"
    started = time.monotonic()
    try:
        _seed_workspace_from_fixture(FIXTURE, workspace)
        _prepare_baseline(workspace)
        report = run_agent(
            workspace,
            max_steps=max_steps,
            on_step=on_step,
            batch=True,
            goal=None,
        )
        code = _agent_exit_code(workspace)
        if code == 0:
            code = _final_compare(workspace)
    except Exception as error:  # noqa: BLE001
        print(f"✗ agent 运行失败：{error}")
        report = f"(failed) {error}"
        code = 1

    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "agent-report.md").write_text(report + "\n", encoding="utf-8")
    _write_json(workspace / "run-timing.json", {"elapsedSeconds": time.monotonic() - started})
    print("\n═══ 最终报告（模型文本）═══\n")
    print(report)
    _print_deterministic_summary(workspace)
    return code, report


def _agent_exit_code(workspace: Path) -> int:
    try:
        status = json.loads((workspace / "agent-status.json").read_text(encoding="utf-8"))
        return 0 if (status.get("evidenceReady") is True
                     and status.get("state") in ("complete", "complete_with_warning")) else 1
    except (OSError, ValueError):
        return 1


def _load_threshold(workspace: Path) -> float:
    task = workspace / "task.json"
    if not task.is_file():
        return 0.01
    try:
        data = json.loads(task.read_text(encoding="utf-8"))
        return float(data.get("optimization", {}).get("minImprovementFraction", 0.01))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return 0.01


def _visualize(workspace: Path) -> list[Path]:
    print("\n── 3) 可视化优化过程 ──")
    from visualize_trajectory import load_trajectory, print_trajectory_table, render_visualizations

    threshold = _load_threshold(workspace)
    rows = load_trajectory(workspace / "trajectory.jsonl")
    print_trajectory_table(rows, threshold=threshold)

    out_dir = workspace / "viz"
    # 同步一份到 chapter16/logs，方便查找
    stamp = workspace.name
    mirror = LOG_ROOT / stamp / "viz"
    paths = render_visualizations(
        workspace,
        out_dir=out_dir,
        threshold=threshold,
        title=f"part3-agent · {workspace.name}",
    )
    mirror.parent.mkdir(parents=True, exist_ok=True)
    if out_dir.resolve() != mirror.resolve():
        import shutil

        if mirror.exists():
            shutil.rmtree(mirror)
        shutil.copytree(out_dir, mirror)
        paths = list(mirror.glob("*"))

    print("\n可视化输出：")
    for p in paths:
        print(f"  - {p}")
    return paths


def _write_summary(workspace: Path, agent_code: int, pytest_code: int | None, report: str) -> Path:
    from visualize_trajectory import load_trajectory

    rows = load_trajectory(workspace / "trajectory.jsonl")
    accepted = [r for r in rows if r.get("accepted")]
    summary = {
        "workspace": str(workspace),
        "fixture": str(FIXTURE),
        "agent_exit": agent_code,
        "pytest_exit": pytest_code,
        "rounds": len(rows),
        "accepted": len(accepted),
        "largest_accepted_step_improvement": max(
            (float(r["improvementFraction"]) for r in accepted if r.get("improvementFraction") is not None),
            default=None,
        ),
        "report_preview": (report or "")[:1000],
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
    }
    for filename, field in (("agent-status.json", "agent_status"), ("final-comparison.json", "final_comparison")):
        path = workspace / filename
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                summary[field] = {k: v for k, v in data.items() if k not in ("results", "report")}
            except (ValueError, OSError):
                summary[field] = {"status": "unreadable"}
    out = workspace / "run_summary.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    mirror = LOG_ROOT / workspace.name
    mirror.mkdir(parents=True, exist_ok=True)
    (mirror / "run_summary.json").write_text(out.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"\n[summary] {out}")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="part3-agent 本地验收 + 可视化")
    parser.add_argument("--max-steps", type=int, default=DEFAULT_MAX_STEPS)
    parser.add_argument("--skip-pytest", action="store_true")
    parser.add_argument("--skip-agent", action="store_true", help="不跑 Agent，只可视化已有 workspace")
    parser.add_argument("--reuse-latest", action="store_true", help="复用最近一次 chapter15/logs workspace")
    parser.add_argument("--workspace", type=str, default=None)
    args = parser.parse_args(argv)

    os.chdir(PART_ROOT)
    _ensure_path()
    LOG_ROOT.mkdir(parents=True, exist_ok=True)
    _print_banner()

    if not args.skip_agent and not args.reuse_latest:
        try:
            _check_llm_env()
            _check_gpu()
        except (RuntimeError, ImportError) as error:
            print(f"✗ 环境检查失败：{error}")
            return 2

    pytest_code: int | None = None
    if not args.skip_pytest and not args.skip_agent and not args.reuse_latest:
        pytest_code = _run_pytest()

    if args.workspace:
        workspace = Path(args.workspace).resolve()
    elif args.reuse_latest or args.skip_agent:
        latest = _latest_workspace()
        if latest is None:
            print("✗ 没有可复用的 workspace（缺少 trajectory.jsonl）")
            return 2
        workspace = latest
        print(f"[reuse] {workspace}")
    else:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        workspace = PART_ROOT / "chapter15" / "logs" / "tasks" / f"task-{stamp}"

    if not args.skip_agent and not args.reuse_latest and workspace.exists() and any(workspace.iterdir()):
        print("✗ 新实验需要空工作区；查看旧结果请使用 --skip-agent --workspace")
        return 2
    agent_code = 0
    report = ""
    if not args.skip_agent and not args.reuse_latest:
        agent_code, report = _run_agent(args.max_steps, workspace)
    else:
        report = "(reused existing run)"

    viz_paths = _visualize(workspace)
    if not args.skip_agent and not args.reuse_latest:
        _write_summary(workspace, agent_code, pytest_code, report)

    print("\n═══ 验收结论 ═══")
    print(f"workspace : {workspace}")
    print(f"agent_exit: {agent_code}")
    if pytest_code is not None:
        print(f"pytest    : {pytest_code}")
    print(f"figures   : {len(viz_paths)} files")
    return agent_code or pytest_code or 0


if __name__ == "__main__":
    raise SystemExit(main())
