"""agent 主循环：一个简单可读的 Reflection/ReAct loop（本工件的教学主角）。

骨架（hello-agents 范式，看清每个字节）：

    for step in range(max_steps):          # ① 循环上限，防死循环
        message = llm.chat(history, tools)  # ② 思考（可能决定调工具）
        if 没有工具调用:                     # ③ 判终止（给出最终报告/收敛）
            return 最终回答
        for call in message.tool_calls:     # ④ 路由到工具
            observation = executor.call(...)  # ⑤ 执行（权威工具给 ground truth）
            history.append(observation)      # ⑥ 观察回灌

LLM 自由发挥地驱动闭环、选策略、多轮对话；权威工具（compile_kernel / bench_kernel /
profile_kernel / accept_candidate / measure_peak）的返回就是真假判据。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import llm
from .prompts import SYSTEM_SOP, build_goal
from .tools import Workspace, build_tools

# 完成护栏：模型很容易「用文本说话」而不是调工具，导致一输出最终文本就结束运行。
# batch 模式必须真正调用 accept_candidate 并写出 trajectory.jsonl，才能把文本当作最终报告。
_MAX_NUDGES = 3
_NUDGE_QUESTION = (
    "⚠ 你把要问用户的话写进了最终回答——输出最终回答会立刻结束运行，用户没法回答你。"
    "如果还需要用户确认或补充信息，请改用 ask_user 工具把问题问出去。"
)
_NUDGE_NOT_STARTED = (
    "⚠ 你只用文本回复、没有调用任何工具——文本回复会直接结束运行。"
    "请立即调用 ask_user 工具向用户要到 kernel 代码并问清参数（shape、dtype），"
    "不要只是用文字邀请用户。"
)
_NUDGE_NOT_STARTED_BATCH = (
    "⚠ 你只用文本回复、没有调用任何工具——文本回复会直接结束运行。"
    "【非交互模式】请立即调用 get_environment / measure_peak / profile_kernel，"
    "再对候选分步调用 compile_kernel → bench_kernel → accept_candidate；"
    "不要调用 ask_user，也不要用文字收尾。"
)
_NUDGE_NO_ACCEPT = (
    "⚠ 你还没有进入优化闭环（compile_kernel / bench_kernel / accept_candidate）。"
    "请按 compile_kernel → bench_kernel →（必要时）profile_kernel → accept_candidate "
    "完成至少一轮，不要只用文本收尾。"
)
_QUESTION_HINTS = (
    "？", "?", "请确认", "请问", "你觉得", "哪个", "多少", "可以吗",
    "是否", "请告诉", "请选", "要不要", "好吗", "合适吗", "行吗",
    "请贴", "请提供", "粘贴给我", "告诉我", "请说", "请描述", "请直接把",
)
_LOOP_TOOLS = frozenset({"accept_candidate", "bench_kernel", "compile_kernel"})
_BATCH_HIDDEN_TOOLS = frozenset({"run_code"})
_PENDING_CANDIDATE_FILENAME = "pending_candidate.py"
_AGENT_STATUS_FILENAME = "agent-status.json"
_PENDING_ACCEPT_NUDGE = (
    "⚠ 上一个候选已经进入 compile/bench 流程。开始新候选之前，必须继续用字节完全相同的 "
    "source 完成必要的 bench/profile，并调用 accept_candidate(source, change) 写入裁决轨迹。"
)


def _looks_like_user_question(text: str) -> bool:
    return any(hint in text for hint in _QUESTION_HINTS)


def _tool_schema_name(item: dict[str, Any]) -> str:
    return str((item.get("function") or {}).get("name") or "")


def _json_object(text: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _same_source(left: Any, right: Any) -> bool:
    return isinstance(left, str) and isinstance(right, str) and left == right




def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0

def _tail_complete_lines(path: Path, *, max_chars: int) -> str:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    selected: list[str] = []
    length = 0
    for line in reversed(lines):
        if len(line) > max_chars:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        added = len(line) + (1 if selected else 0)
        if selected and length + added > max_chars:
            break
        selected.append(line)
        length += added
    return "\n".join(reversed(selected))

def _trajectory_row_count(path: Path) -> int:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return 0
    count = 0
    for line in lines:
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            count += 1
    return count


def run_agent(
    workspace_dir: str | Path,
    *,
    max_steps: int = 30,
    goal: str | None = None,
    on_step: Any = None,
    batch: bool = False,
) -> str:
    """跑优化 agent，返回最终报告文本。

    workspace_dir：含 task.json + reference.py + best.py（当前 incumbent）的工作目录。
    goal：用户的优化目标描述；缺省时从 task.json 推导。
    on_step(step, action, observation)：可选回调，用于打印进度。
    batch：非交互模式（ask_user 拒答并引导继续闭环）。
    """
    workspace = Workspace(Path(workspace_dir))
    conversation_path = workspace.root / "model-messages.jsonl"
    run_started_at = datetime.now(timezone.utc).isoformat()
    executor, schema = build_tools(workspace, batch=batch)
    if batch:
        schema = [
            item for item in schema
            if _tool_schema_name(item) not in _BATCH_HIDDEN_TOOLS
        ]

    trajectory_path = workspace.root / "trajectory.jsonl"
    pending_path = workspace.root / _PENDING_CANDIDATE_FILENAME
    status_path = workspace.root / _AGENT_STATUS_FILENAME
    status_path.unlink(missing_ok=True)
    nudges = 0
    called_tools: set[str] = set()
    pending_source: str | None = None
    pending_nudged = False
    candidate_activity = False
    accept_failure = False

    if batch and pending_path.is_file():
        pending_source = pending_path.read_text(encoding="utf-8")
        candidate_activity = bool(pending_source)
        if not pending_source:
            pending_path.unlink(missing_ok=True)
            pending_source = None

    def persist_pending(source: str) -> None:
        nonlocal pending_source, pending_nudged, candidate_activity
        pending_path.write_text(source, encoding="utf-8")
        pending_source = source
        pending_nudged = False
        candidate_activity = True

    def clear_pending() -> None:
        nonlocal pending_source, pending_nudged, candidate_activity, accept_failure
        pending_path.unlink(missing_ok=True)
        pending_source = None
        pending_nudged = False
        candidate_activity = False
        accept_failure = False
    def accept_was_recorded(observation: str, previous_size: int) -> bool:
        payload = _json_object(observation)
        return (
            payload is not None
            and "accepted" in payload
            and _file_size(trajectory_path) > previous_size
        )

    def submit_pending(step: int, change: str) -> tuple[bool, str]:
        if pending_source is None:
            return True, ""
        previous_size = _file_size(trajectory_path)
        args = {"source": pending_source, "change": change}
        if on_step:
            on_step(step, "tool:accept_candidate", None)
        observation = executor.call("accept_candidate", args)
        if on_step:
            on_step(step, "result:accept_candidate", observation)
        recorded = accept_was_recorded(observation, previous_size)
        if recorded:
            clear_pending()
        return recorded, observation

    def finish(
        report: str,
        *,
        evidence_ready: bool,
        warning: bool = False,
    ) -> str:
        trajectory_rows = _trajectory_row_count(trajectory_path)
        effective_evidence = bool(
            evidence_ready
            and trajectory_rows > 0
            and not pending_path.is_file()
        )
        state = "incomplete"
        if effective_evidence:
            state = "complete_with_warning" if warning else "complete"
        status_path.write_text(
            json.dumps(
                {
                    "state": state,
                    "evidenceReady": effective_evidence,
                    "warning": bool(effective_evidence and warning),
                    "trajectoryRows": trajectory_rows,
                    "pendingCandidate": pending_path.is_file(),
                    "report": report,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return report

    resume_observation = ""
    if batch and pending_source is not None:
        resumed, resume_observation = submit_pending(
            0,
            "恢复中断运行，自动提交上次已完成 benchmark 的候选",
        )
        if not resumed:
            report = (
                "检测到中断前尚未裁决的候选，但 accept_candidate 自动提交失败；"
                f"候选已保存在 {pending_path}，请排查评测器后重试。"
            )
            return finish(report, evidence_ready=False)
        called_tools.add("accept_candidate")

    if goal is None:
        goal = build_goal(workspace, batch=batch)
    grounded_existing_trajectory = False
    if batch and trajectory_path.is_file():
        existing_trajectory = _tail_complete_lines(
            trajectory_path,
            max_chars=6000,
        )
        if existing_trajectory:
            grounded_existing_trajectory = True
            goal += (
                "\n\n工作区已有以下权威轨迹记录。最终报告只能引用这些记录或本轮新增记录：\n"
                f"{existing_trajectory}"
            )
    if resume_observation:
        goal += f"\n\n中断前候选已由权威工具完成裁决：{resume_observation}"

    trajectory_size_before_loop = _file_size(trajectory_path)

    def has_trajectory_evidence() -> bool:
        return (
            grounded_existing_trajectory
            or _file_size(trajectory_path) > trajectory_size_before_loop
        )

    history: list[dict[str, Any]] = []

    def append_history(item: dict[str, Any]) -> None:
        """保存实际进入模型上下文的消息；API 配置与凭据不属于对话。"""
        with conversation_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({
                "runStartedAt": run_started_at,
                "messageIndex": len(history),
                "recordedAt": datetime.now(timezone.utc).isoformat(),
                "message": item,
            }, ensure_ascii=False) + "\n")
        history.append(item)

    for item in [
        {"role": "system", "content": SYSTEM_SOP},
        {"role": "user", "content": goal},
    ]:
        append_history(item)
    for step in range(1, max_steps + 1):
        if batch and pending_source is not None and not pending_nudged:
            append_history({"role": "user", "content": _PENDING_ACCEPT_NUDGE})
            pending_nudged = True
            if on_step:
                on_step(step, "nudge", None)

        message = llm.chat(history, tools=schema)
        append_history(_assistant_to_dict(message))

        tool_calls = getattr(message, "tool_calls", None)

        if not tool_calls:
            final = message.content or ""
            asking_user = _looks_like_user_question(final)
            entered_loop = (
                has_trajectory_evidence()
                if batch
                else bool(called_tools & _LOOP_TOOLS)
            )
            pending_accept = batch and pending_source is not None
            unresolved_activity = (
                batch and candidate_activity and pending_source is None
            )
            missing_evidence = not called_tools and not (batch and entered_loop)
            premature = (
                missing_evidence
                or asking_user
                or (batch and not entered_loop)
                or pending_accept
                or unresolved_activity
            )
            if premature and nudges < _MAX_NUDGES:
                nudges += 1
                if pending_accept:
                    nudge = _PENDING_ACCEPT_NUDGE
                elif unresolved_activity:
                    nudge = _NUDGE_NO_ACCEPT
                elif missing_evidence:
                    nudge = _NUDGE_NOT_STARTED_BATCH if batch else _NUDGE_NOT_STARTED
                elif batch and not entered_loop:
                    nudge = _NUDGE_NO_ACCEPT
                else:
                    nudge = _NUDGE_QUESTION
                append_history({"role": "user", "content": nudge})
                if on_step:
                    on_step(step, "nudge", None)
                continue
            if pending_accept:
                recorded, observation = submit_pending(
                    step,
                    "模型尝试提前收尾，自动提交最后一个已完成 benchmark 的候选",
                )
                if not recorded:
                    status = (
                        "模型尝试提前收尾，但最后一个候选未完成裁决；"
                        f"候选已保存在 {pending_path}。"
                    )
                else:
                    status = (
                        "模型尝试在读取最终裁决前收尾；已由权威工具完成裁决。"
                        f"裁决结果：{observation}。轨迹见 {trajectory_path}。"
                    )
                if on_step:
                    on_step(step, "done", status)
                return finish(status, evidence_ready=recorded)
            if unresolved_activity:
                if accept_failure:
                    status = (
                        "本轮 accept_candidate 未完成权威裁决；不会使用旧轨迹"
                        "宣称本轮成功。"
                        f"工作区见 {workspace.root}。"
                    )
                    if on_step:
                        on_step(step, "done", status)
                    return finish(status, evidence_ready=False)
                if has_trajectory_evidence():
                    status = (
                        "本轮最后一个候选尚未完成 benchmark/accept_candidate，"
                        "因此不计入轨迹；前面已有权威轨迹仍可分析。"
                        f"工作区见 {workspace.root}。"
                    )
                    if on_step:
                        on_step(step, "done", status)
                    return finish(status, evidence_ready=True, warning=True)
                status = (
                    "本轮尝试了新候选，但新候选未完成 accept_candidate 权威裁决；"
                    "且当前没有可分析的既有轨迹。"
                    f"工作区见 {workspace.root}。"
                )
                if on_step:
                    on_step(step, "done", status)
                return finish(status, evidence_ready=False)
            if batch and not has_trajectory_evidence():
                status = (
                    "模型在完成 accept_candidate 裁决前尝试收尾；本次未生成轨迹，"
                    "因而没有可用于报告的权威轨迹证据。"
                    f"工作区见 {workspace.root}。"
                )
                if on_step:
                    on_step(step, "done", status)
                return finish(status, evidence_ready=False)
            if on_step:
                on_step(step, "done", final)
            return finish(
                final or "（无最终回答）",
                evidence_ready=(not batch) or has_trajectory_evidence(),
            )

        for call in tool_calls:
            name = call.function.name
            called_tools.add(name)
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError as error:
                observation = f"✗ 你给 {name} 的参数不是合法 JSON：{error}。请修正后重新调用。"
                args = None
                if batch and name in {"compile_kernel", "bench_kernel", "accept_candidate"}:
                    candidate_activity = True
                if batch and name == "accept_candidate":
                    accept_failure = True
            else:
                if not isinstance(args, dict):
                    observation = (
                        f"✗ 你给 {name} 的参数必须是 JSON 对象，"
                        f"实际是 {type(args).__name__}。请修正后重新调用。"
                    )
                    args = None
                    if batch and name in {"compile_kernel", "bench_kernel", "accept_candidate"}:
                        candidate_activity = True
                    if batch and name == "accept_candidate":
                        accept_failure = True

            if args is not None:
                source = args.get("source")
                pending_protocol_error = None
                if batch and name in _BATCH_HIDDEN_TOOLS:
                    pending_protocol_error = f"batch 模式禁止调用 {name}。"
                elif batch and pending_source is not None:
                    same_pending = _same_source(source, pending_source)
                    if name == "accept_candidate" and not same_pending:
                        pending_protocol_error = (
                            "已有完成 benchmark 的候选等待裁决；accept_candidate 必须使用"
                            "字节完全相同的 source。"
                        )
                    elif name in {"bench_kernel", "profile_kernel"} and same_pending:
                        pass
                    elif name != "accept_candidate":
                        pending_protocol_error = (
                            "已有候选等待裁决；只允许对同一 source 继续 bench/profile，"
                            "或调用 accept_candidate 完成裁决。"
                        )

                if pending_protocol_error is not None:
                    observation = json.dumps(
                        {
                            "ok": False,
                            "stage": "pending_accept",
                            "error": pending_protocol_error,
                        },
                        ensure_ascii=False,
                    )
                    pending_nudged = False
                else:
                    if batch and name == "accept_candidate":
                        candidate_activity = True
                        accept_failure = True
                    trajectory_size_before = (
                        _file_size(trajectory_path)
                        if batch and name == "accept_candidate"
                        else 0
                    )
                    if on_step:
                        on_step(step, f"tool:{name}", None)
                    observation = executor.call(name, args)
                    if on_step:
                        on_step(step, f"result:{name}", observation)

                    payload = _json_object(observation)
                    if (
                        batch
                        and name in {"compile_kernel", "bench_kernel"}
                        and isinstance(source, str)
                    ):
                        try:
                            incumbent_source = workspace.best_path.read_text(encoding="utf-8")
                        except OSError:
                            incumbent_source = ""
                        if not _same_source(source, incumbent_source):
                            candidate_activity = True
                            if (
                                name == "bench_kernel"
                                and payload is not None
                                and payload.get("ok") is True
                            ):
                                persist_pending(source)
                    elif (
                        batch
                        and name == "accept_candidate"
                        and accept_was_recorded(observation, trajectory_size_before)
                    ):
                        clear_pending()

            append_history(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "name": name,
                    "content": observation[:6000],
                }
            )

    if batch and pending_source is not None:
        recorded, observation = submit_pending(
            max_steps,
            "达到 max_steps 前自动提交最后一个已完成 benchmark 的候选",
        )
        if not recorded:
            report = (
                f"达到最大步数（{max_steps}），但最后一个候选未完成裁决；"
                f"候选已保存在 {pending_path}。工具返回：{observation}"
            )
            return finish(report, evidence_ready=False)
    if batch and candidate_activity:
        if accept_failure:
            report = (
                f"达到最大步数（{max_steps}）；本轮 accept_candidate 未完成权威裁决，"
                "因此不会使用旧轨迹宣称本轮成功。"
                f"工作区见 {workspace.root}。"
            )
            return finish(report, evidence_ready=False)
        if has_trajectory_evidence():
            report = (
                f"达到最大步数（{max_steps}）；最后一个候选尚未完成 benchmark/"
                "accept_candidate，因此不计入轨迹；前面已有权威轨迹仍可分析。"
                f"工作区见 {workspace.root}。"
            )
            return finish(report, evidence_ready=True, warning=True)
        report = (
            f"达到最大步数（{max_steps}）；本轮尝试了新候选，但新候选未完成 "
            "accept_candidate 权威裁决，且当前没有可分析的既有轨迹。"
            f"工作区见 {workspace.root}。"
        )
        return finish(report, evidence_ready=False)

    if has_trajectory_evidence():
        report = f"达到最大步数（{max_steps}），停止。轨迹见 {trajectory_path}。"
        return finish(report, evidence_ready=True)
    report = (
        f"达到最大步数（{max_steps}），停止；本次没有候选完成 accept_candidate 裁决，"
        f"因此未生成轨迹，也没有可用于报告的权威证据。工作区见 {workspace.root}。"
    )
    return finish(report, evidence_ready=False)


def _assistant_to_dict(message: Any) -> dict[str, Any]:
    """把 LiteLLM 的 assistant message 转成可回传的 dict（保留 tool_calls）。"""
    item: dict[str, Any] = {"role": "assistant", "content": message.content or ""}
    tool_calls = getattr(message, "tool_calls", None)
    if tool_calls:
        item["tool_calls"] = [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.function.name, "arguments": call.function.arguments},
            }
            for call in tool_calls
        ]
    return item
