"""kernel_optimize 教学 agent 的单测（本地无 GPU 可跑：逻辑/编排/工具注册）。"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from kernel_optimize import llm as llm_module
from kernel_optimize import agent as agent_module
from kernel_optimize import tools as tools_module
from kernel_optimize.agent import run_agent
from kernel_optimize.measure import _has_peaks, ensure_peak
from kernel_optimize.tools import ToolExecutor, Workspace, _decide, build_tools


# ---------------------------------------------------------------------------
# ToolExecutor
# ---------------------------------------------------------------------------


class ToolExecutorTest(unittest.TestCase):
    def test_register_call_schema(self) -> None:
        ex = ToolExecutor()
        ex.register("echo", "回声", lambda text="": f"echo:{text}",
                    {"type": "object", "properties": {"text": {"type": "string"}}})
        self.assertEqual(ex.call("echo", {"text": "hi"}), "echo:hi")
        self.assertIn("未知工具", ex.call("nope", {}))
        schema = ex.schema()
        self.assertEqual(schema[0]["function"]["name"], "echo")

    def test_call_error_is_caught(self) -> None:
        ex = ToolExecutor()

        def boom():
            raise ValueError("x")

        ex.register("boom", "会炸", boom)
        self.assertIn("执行出错", ex.call("boom", {}))


class LLMRequestConfigTest(unittest.TestCase):
    @staticmethod
    def _response():
        message = SimpleNamespace(content="READY", tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    def test_default_extra_body_disables_qwen_thinking(self) -> None:
        with (
            mock.patch.object(
                llm_module,
                "_model_config",
                return_value=("openai/DeepSeek-V4-Flash", "https://example.invalid/v1"),
            ),
            mock.patch.object(
                llm_module.litellm,
                "completion",
                return_value=self._response(),
            ) as completion,
            mock.patch.dict(os.environ, {}, clear=False),
        ):
            os.environ.pop("KERNEL_AGENT_EXTRA_BODY", None)
            llm_module.chat([{"role": "user", "content": "hello"}])

        self.assertEqual(
            completion.call_args.kwargs["extra_body"],
            {"enable_thinking": False},
        )

    def test_explicit_extra_body_replaces_default_for_official_deepseek(self) -> None:
        official_body = {"thinking": {"type": "disabled"}}
        with (
            mock.patch.object(
                llm_module,
                "_model_config",
                return_value=("deepseek/deepseek-v4-flash", "https://api.deepseek.com"),
            ),
            mock.patch.object(
                llm_module.litellm,
                "completion",
                return_value=self._response(),
            ) as completion,
            mock.patch.dict(
                os.environ,
                {"KERNEL_AGENT_EXTRA_BODY": json.dumps(official_body)},
                clear=False,
            ),
        ):
            llm_module.chat([{"role": "user", "content": "hello"}])

        self.assertEqual(completion.call_args.kwargs["extra_body"], official_body)
        self.assertNotIn("enable_thinking", completion.call_args.kwargs["extra_body"])


# ---------------------------------------------------------------------------
# 确定性裁决 _decide
# ---------------------------------------------------------------------------


class DecideTest(unittest.TestCase):
    def test_not_ok(self) -> None:
        ok, reason = _decide({"status": "compile_error"}, 0.01)
        self.assertFalse(ok)
        self.assertEqual(reason, "compile_error")

    def test_missing_comparison(self) -> None:
        ok, reason = _decide({"status": "ok"}, 0.01)
        self.assertFalse(ok)
        self.assertEqual(reason, "missing_paired_comparison")

    def test_insufficient_pairs(self) -> None:
        evaluation = {"status": "ok", "comparison": {"pairedImprovements": [0.5] * 4, "improvementFraction": 0.5}}
        ok, reason = _decide(evaluation, 0.01)
        self.assertFalse(ok)
        self.assertEqual(reason, "insufficient_benchmark_evidence")

    def test_below_threshold(self) -> None:
        evaluation = {"status": "ok", "comparison": {"pairedImprovements": [0.001] * 5, "improvementFraction": 0.001}}
        ok, reason = _decide(evaluation, 0.01)
        self.assertFalse(ok)
        self.assertIn("below_threshold", reason)

    def test_improved(self) -> None:
        evaluation = {"status": "ok", "comparison": {"pairedImprovements": [0.2] * 5, "improvementFraction": 0.2}}
        ok, reason = _decide(evaluation, 0.01)
        self.assertTrue(ok)
        self.assertIn("improved", reason)


# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------


class WorkspaceTest(unittest.TestCase):
    def test_write_candidate_and_record(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Workspace(Path(tmp))
            path = ws.write_candidate("print('hi')")
            self.assertTrue(path.exists())
            self.assertIn("print", path.read_text())
            path.unlink()
            ws.record({"iteration": 1, "accepted": True})
            ws.record({"iteration": 2, "accepted": False})
            lines = (ws.root / "trajectory.jsonl").read_text().strip().splitlines()
            self.assertEqual(len(lines), 2)
            self.assertEqual(json.loads(lines[0])["iteration"], 1)


# ---------------------------------------------------------------------------
# measure（本地无 GPU：优雅降级）
# ---------------------------------------------------------------------------


class MeasureTest(unittest.TestCase):
    def test_has_peaks(self) -> None:
        self.assertTrue(_has_peaks({"bandwidthGbS": 400, "fp32Tflops": 8}))
        self.assertFalse(_has_peaks({"bandwidthGbS": 400}))  # 没算力
        self.assertFalse(_has_peaks(None))

    def test_ensure_peak_no_gpu_returns_none(self) -> None:
        unavailable = SimpleNamespace(
            cuda=SimpleNamespace(is_available=mock.Mock(return_value=False)),
        )
        with (
            tempfile.TemporaryDirectory() as tmp,
            mock.patch.dict("sys.modules", {"torch": unavailable}),
        ):
            self.assertIsNone(ensure_peak(Path(tmp)))
        unavailable.cuda.is_available.assert_called()


# ---------------------------------------------------------------------------
# build_tools：工具注册齐全
# ---------------------------------------------------------------------------


class BuildToolsTest(unittest.TestCase):
    def test_registers_closed_loop_tools(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Workspace(Path(tmp))
            executor, schema = build_tools(ws)
            names = {s["function"]["name"] for s in schema}
            for expected in (
                "ask_user", "get_environment", "measure_peak",
                "compile_kernel", "bench_kernel", "profile_kernel", "accept_candidate",
                "convert_kernel", "run_code", "read_reference", "setup_task",
            ):
                self.assertIn(expected, names)
            for removed in ("evaluate_candidate", "benchmark", "profile", "verify_correct"):
                self.assertNotIn(removed, names)
            reply = executor.call("read_reference", {"name": "optimization-patterns"})
            self.assertTrue("memory-bound" in reply or "没有参考资料" in reply or "可用" in reply)


class Chapter15ToolContractTest(unittest.TestCase):
    """对齐线上 chapter15：三工具 JSON 字段契约（mock _run_eval）。"""

    def test_compile_kernel_ok(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            executor, _ = build_tools(ws)
            with mock.patch.object(
                tools_module,
                "_run_eval",
                return_value={"status": "ok", "correctness": {"maxAbsError": 0.0}},
            ):
                payload = json.loads(executor.call("compile_kernel", {"source": "code"}))
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["stage"], "run")
            self.assertEqual(payload["errors"], [])

    def test_compile_kernel_error_parses_line(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            executor, _ = build_tools(ws)
            with mock.patch.object(
                tools_module,
                "_run_eval",
                return_value={
                    "status": "compile_error",
                    "details": "boom",
                    "capturedOutput": 'File "x.py", line 42: expected a type',
                },
            ):
                payload = json.loads(executor.call("compile_kernel", {"source": "code"}))
            self.assertFalse(payload["ok"])
            self.assertEqual(payload["stage"], "compile")
            self.assertTrue(any(e.get("line") == 42 for e in payload["errors"]))

    def test_bench_kernel_stats(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            (ws.root / "task.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 2,
                        "description": "vector add",
                        "language": "triton",
                        "shape": {"rows": 4, "cols": 4},
                        "optimization": {"minImprovementFraction": 0.01},
                        "costModel": {"flops": 1000, "bytes": 8000},
                    }
                ),
                encoding="utf-8",
            )
            executor, _ = build_tools(ws)
            samples = [0.10, 0.11, 0.12, 0.13, 0.14]
            with mock.patch.object(
                tools_module,
                "_run_eval",
                return_value={
                    "status": "ok",
                    "latencyMs": 0.12,
                    "benchmark": {"samplesMs": samples, "medianAbsoluteDeviationMs": 0.01},
                },
            ):
                payload = json.loads(executor.call("bench_kernel", {"source": "code"}))
            self.assertTrue(payload["ok"])
            self.assertAlmostEqual(payload["median_ms"], 0.12)
            self.assertAlmostEqual(payload["mean_ms"], sum(samples) / len(samples))
            self.assertIsNotNone(payload["p95_ms"])
            self.assertIsNotNone(payload["bandwidth_gbps"])
            self.assertIsNotNone(payload["tflops"])

    def test_accept_candidate_records_and_rejects(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            executor, _ = build_tools(ws)
            with mock.patch.object(
                tools_module,
                "_run_eval",
                return_value={
                    "status": "ok",
                    "latencyMs": 0.10,
                    "comparison": {
                        "pairedImprovements": [0.001] * 5,
                        "improvementFraction": 0.001,
                    },
                },
            ):
                payload = json.loads(
                    executor.call("accept_candidate", {"source": "new", "change": "noop"})
                )
            self.assertFalse(payload["accepted"])
            self.assertIn("below_threshold", payload["reason"])
            traj = (ws.root / "trajectory.jsonl").read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(traj), 1)
            self.assertFalse(json.loads(traj[0])["accepted"])


# ---------------------------------------------------------------------------
# agent loop：编排（mock LLM）
# ---------------------------------------------------------------------------


def _msg(content, tool_calls=None):
    return SimpleNamespace(content=content, tool_calls=tool_calls)


def _call(name, arguments, call_id="c1"):
    return SimpleNamespace(id=call_id, function=SimpleNamespace(name=name, arguments=arguments))


def _make_workspace(tmp: str) -> Workspace:
    ws = Workspace(Path(tmp))
    (ws.root / "task.json").write_text(json.dumps({
        "schemaVersion": 2, "description": "vector add", "language": "triton",
        "shape": {"rows": 4096, "cols": 2048},
        "optimization": {"minImprovementFraction": 0.01},
    }), encoding="utf-8")
    (ws.root / "best.py").write_text("def launch(*a):\n    pass\n", encoding="utf-8")
    return ws


class AskUserTest(unittest.TestCase):
    def test_session_constructs(self) -> None:
        # 多行会话能正常构造（回车绑定不出错）
        self.assertIsNotNone(tools_module._make_ask_session())

    @staticmethod
    def _session_returning(answer):
        session = mock.Mock()
        session.prompt.return_value = answer
        return session

    def test_single_line_answer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            executor, _ = build_tools(_make_workspace(tmp))
            with mock.patch.object(tools_module, "_get_ask_session",
                                   return_value=self._session_returning("float32")):
                answer = executor.call("ask_user", {"question": "dtype?"})
        self.assertEqual(answer, "float32")

    def test_multiline_answer_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            executor, _ = build_tools(_make_workspace(tmp))
            with mock.patch.object(tools_module, "_get_ask_session",
                                   return_value=self._session_returning("line1\nline2\nline3")):
                answer = executor.call("ask_user", {"question": "贴 kernel"})
        self.assertEqual(answer, "line1\nline2\nline3")

    def test_eof_returns_no_answer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            executor, _ = build_tools(_make_workspace(tmp))
            session = mock.Mock()
            session.prompt.side_effect = EOFError
            with mock.patch.object(tools_module, "_get_ask_session", return_value=session):
                answer = executor.call("ask_user", {"question": "?"})
        self.assertEqual(answer, "（用户未回答）")


class AgentLoopTest(unittest.TestCase):
    def test_dispatch_tool_then_final_answer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            responses = [
                _msg(None, [_call("get_environment", "{}")]),  # 先调工具
                _msg("最终报告：baseline 0.10ms → best 0.06ms，加速 1.67x。"),  # 再给结论
            ]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            actions = []
            with mock.patch.object(llm_module, "chat", fake_chat):
                report = run_agent(ws.root, on_step=lambda s, a, o: actions.append(a))

            self.assertIn("加速", report)
            self.assertIn("tool:get_environment", actions)
            self.assertIn("done", actions)

    def test_bad_tool_args_fed_back(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            responses = [
                _msg(None, [_call("get_environment", "{bad json")]),  # 参数非法
                _msg("收尾"),
            ]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            with mock.patch.object(llm_module, "chat", fake_chat):
                report = run_agent(ws.root)
            self.assertEqual(report, "收尾")

    def test_non_object_tool_args_are_fed_back_instead_of_crashing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            responses = [
                _msg(None, [_call("get_environment", "[]")]),
                _msg("收尾"),
            ]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            with mock.patch.object(llm_module, "chat", fake_chat):
                report = run_agent(ws.root)
            self.assertEqual(report, "收尾")

    def test_text_only_opening_is_nudged_then_backstop(self) -> None:
        # 模型一直只用文本、从不调工具：被拦 _MAX_NUDGES 次后兜底返回。
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            responses = [_msg(f"文本{i}") for i in range(6)]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            actions = []
            with mock.patch.object(llm_module, "chat", fake_chat):
                report = run_agent(ws.root, on_step=lambda s, a, o: actions.append(a))
            self.assertEqual(report, "文本3")  # 拦 3 次后第 4 条兜底返回
            self.assertEqual(actions.count("nudge"), 3)

    def test_question_after_tool_is_nudged(self) -> None:
        # 调过工具后，把提问写进最终回答 → 拦下；随后给出真报告 → 返回。
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            responses = [
                _msg(None, [_call("get_environment", "{}")]),  # 先调一个工具
                _msg("请确认：size 定多少？"),                  # 提问当最终回答 → 拦
                _msg("最终报告：baseline→best 加速 2x。"),       # 真报告 → 返回
            ]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            actions = []
            with mock.patch.object(llm_module, "chat", fake_chat):
                report = run_agent(ws.root, on_step=lambda s, a, o: actions.append(a))
            self.assertIn("加速", report)
            self.assertNotIn("请确认", report)
            self.assertIn("nudge", actions)
    def test_batch_blocks_new_candidate_until_pending_candidate_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            candidate = "def launch(*a):\n    return 1\n"
            calls = []

            class FakeExecutor:
                def call(self, name, arguments):
                    calls.append((name, arguments))
                    if name == "bench_kernel":
                        return json.dumps({"ok": True, "median_ms": 0.1})
                    if name == "accept_candidate":
                        ws.record({"accepted": False, "change": arguments.get("change")})
                        return json.dumps({"accepted": False, "reason": "below_threshold"})
                    return "{}"

            schema = [
                {"type": "function", "function": {"name": name}}
                for name in ("bench_kernel", "compile_kernel", "accept_candidate", "run_code")
            ]
            responses = [
                _msg(None, [_call("bench_kernel", json.dumps({"source": candidate}))]),
                _msg(None, [_call("compile_kernel", json.dumps({"source": "newer"}))]),
                _msg(None, [_call("accept_candidate", json.dumps({
                    "source": candidate,
                    "change": "candidate one",
                }))]),
            ]
            index = {"i": 0}
            exposed_tools = []

            def fake_chat(messages, tools=None, temperature=0.2):
                exposed_tools.append([item["function"]["name"] for item in tools])
                response = responses[index["i"]]
                index["i"] += 1
                return response

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", fake_chat),
            ):
                report = run_agent(ws.root, max_steps=3, batch=True)

            self.assertNotIn("run_code", exposed_tools[0])
            self.assertEqual([name for name, _ in calls], ["bench_kernel", "accept_candidate"])
            self.assertTrue((ws.root / "trajectory.jsonl").is_file())
            self.assertIn("轨迹见", report)

    def test_batch_finalizes_pending_candidate_at_step_limit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            candidate = "def launch(*a):\n    return 1\n"
            calls = []

            class FakeExecutor:
                def call(self, name, arguments):
                    calls.append((name, arguments))
                    if name == "bench_kernel":
                        return json.dumps({"ok": True, "median_ms": 0.1})
                    if name == "accept_candidate":
                        ws.record({"accepted": False, "change": arguments.get("change")})
                        return json.dumps({"accepted": False, "reason": "below_threshold"})
                    return "{}"

            schema = [
                {"type": "function", "function": {"name": name}}
                for name in ("bench_kernel", "accept_candidate")
            ]
            response = _msg(
                None,
                [_call("bench_kernel", json.dumps({"source": candidate}))],
            )

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                report = run_agent(ws.root, max_steps=1, batch=True)

            self.assertEqual([name for name, _ in calls], ["bench_kernel", "accept_candidate"])
            self.assertTrue((ws.root / "trajectory.jsonl").is_file())
            self.assertIn("轨迹见", report)
            status = json.loads(
                (ws.root / "agent-status.json").read_text(encoding="utf-8")
            )
            self.assertTrue(status["evidenceReady"])
            self.assertEqual(status["trajectoryRows"], 1)

    def test_batch_step_limit_does_not_claim_missing_trajectory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)

            class FakeExecutor:
                def call(self, name, arguments):
                    return json.dumps({"device": "test"})

            schema = [{"type": "function", "function": {"name": "get_environment"}}]
            response = _msg(None, [_call("get_environment", "{}")])

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                report = run_agent(ws.root, max_steps=1, batch=True)

            self.assertFalse((ws.root / "trajectory.jsonl").exists())
            self.assertIn("未生成轨迹", report)
            self.assertNotIn("轨迹见", report)
            status = json.loads(
                (ws.root / "agent-status.json").read_text(encoding="utf-8")
            )
            self.assertFalse(status["evidenceReady"])
            self.assertEqual(status["trajectoryRows"], 0)

    def test_batch_text_completion_without_trajectory_returns_honest_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)

            class FakeExecutor:
                def call(self, name, arguments):
                    return json.dumps({"device": "test"})

            schema = [{"type": "function", "function": {"name": "get_environment"}}]
            responses = [
                _msg(None, [_call("get_environment", "{}")]),
                _msg("最终报告：已完成优化。"),
                _msg("最终报告：已完成优化。"),
                _msg("最终报告：已完成优化。"),
                _msg("最终报告：已完成优化。"),
            ]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", fake_chat),
            ):
                report = run_agent(ws.root, max_steps=5, batch=True)

            self.assertIn("未生成轨迹", report)
            self.assertNotIn("已完成优化", report)

    def test_batch_persists_pending_candidate_across_interrupted_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            candidate = "def launch(*a):\n    return 1\n"

            class FakeExecutor:
                def call(self, name, arguments):
                    if name == "bench_kernel":
                        return json.dumps({"ok": True, "median_ms": 0.1})
                    if name == "accept_candidate":
                        ws.record({"accepted": False, "change": arguments.get("change")})
                        return json.dumps({"accepted": False, "reason": "below_threshold"})
                    return "{}"

            schema = [
                {"type": "function", "function": {"name": name}}
                for name in ("bench_kernel", "accept_candidate")
            ]
            calls = {"count": 0}

            def interrupted_chat(messages, tools=None, temperature=0.2):
                calls["count"] += 1
                if calls["count"] == 1:
                    return _msg(
                        None,
                        [_call("bench_kernel", json.dumps({"source": candidate}))],
                    )
                raise RuntimeError("simulated 429 interruption")

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", interrupted_chat),
                self.assertRaisesRegex(RuntimeError, "429 interruption"),
            ):
                run_agent(ws.root, max_steps=2, batch=True)

            pending_path = ws.root / "pending_candidate.py"
            self.assertEqual(pending_path.read_text(encoding="utf-8"), candidate)

            resume_response = _msg("最终报告：已读取恢复裁决。")
            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=resume_response),
            ):
                report = run_agent(ws.root, max_steps=1, batch=True)

            self.assertFalse(pending_path.exists())
            self.assertTrue((ws.root / "trajectory.jsonl").is_file())
            self.assertIn("恢复裁决", report)

    def test_failed_auto_accept_keeps_pending_candidate_and_reports_failure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            ws.record({"accepted": False, "change": "older round"})
            candidate = "def launch(*a):\n    return 1\n"

            class FakeExecutor:
                def call(self, name, arguments):
                    if name == "bench_kernel":
                        return json.dumps({"ok": True, "median_ms": 0.1})
                    if name == "accept_candidate":
                        return "✗ evaluator unavailable"
                    return "{}"

            schema = [
                {"type": "function", "function": {"name": name}}
                for name in ("bench_kernel", "accept_candidate")
            ]
            response = _msg(
                None,
                [_call("bench_kernel", json.dumps({"source": candidate}))],
            )

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                report = run_agent(ws.root, max_steps=1, batch=True)

            self.assertTrue((ws.root / "pending_candidate.py").is_file())
            self.assertIn("最后一个候选未完成裁决", report)

    def test_auto_rejection_replaces_stale_success_final(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            candidate = "def launch(*a):\n    return 1\n"

            class FakeExecutor:
                def call(self, name, arguments):
                    if name == "bench_kernel":
                        return json.dumps({"ok": True, "median_ms": 0.1})
                    if name == "accept_candidate":
                        ws.record({"accepted": False, "change": arguments.get("change")})
                        return json.dumps({"accepted": False, "reason": "below_threshold"})
                    return "{}"

            schema = [
                {"type": "function", "function": {"name": name}}
                for name in ("bench_kernel", "accept_candidate")
            ]
            responses = [
                _msg(None, [_call("bench_kernel", json.dumps({"source": candidate}))]),
                _msg("最终报告：候选已经成功晋升。"),
                _msg("最终报告：候选已经成功晋升。"),
                _msg("最终报告：候选已经成功晋升。"),
                _msg("最终报告：候选已经成功晋升。"),
            ]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", fake_chat),
            ):
                report = run_agent(ws.root, max_steps=5, batch=True)

            self.assertNotIn("成功晋升", report)
            self.assertIn("below_threshold", report)
            self.assertFalse((ws.root / "pending_candidate.py").exists())

    def test_batch_hard_rejects_hidden_run_code_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            executor_calls = []
            exposed_tools = []

            class FakeExecutor:
                def call(self, name, arguments):
                    executor_calls.append(name)
                    return "{}"

            schema = [{"type": "function", "function": {"name": "run_code"}}]

            def fake_chat(messages, tools=None, temperature=0.2):
                exposed_tools.append([item["function"]["name"] for item in tools])
                return _msg(None, [_call("run_code", json.dumps({"code": "print(1)"}))])

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", fake_chat),
            ):
                run_agent(ws.root, max_steps=1, batch=True)

            self.assertEqual(exposed_tools, [[]])
            self.assertEqual(executor_calls, [])

    def test_batch_baseline_bench_does_not_create_pending_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            baseline = ws.best_path.read_text(encoding="utf-8")
            calls = []

            class FakeExecutor:
                def call(self, name, arguments):
                    calls.append(name)
                    return json.dumps({"ok": True, "median_ms": 0.1})

            schema = [{"type": "function", "function": {"name": "bench_kernel"}}]
            response = _msg(None, [_call(
                "bench_kernel",
                json.dumps({"source": baseline}),
            )])
            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                report = run_agent(ws.root, max_steps=1, batch=True)

            self.assertEqual(calls, ["bench_kernel"])
            self.assertFalse((ws.root / "pending_candidate.py").exists())
            self.assertIn("未生成轨迹", report)

    def test_compile_retries_do_not_create_pending_before_successful_bench(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            first = "def launch(*a):\n    broken\n"
            corrected = "def launch(*a):\n    return 1\n"
            calls = []

            class FakeExecutor:
                def call(self, name, arguments):
                    calls.append((name, arguments["source"]))
                    return json.dumps({
                        "ok": arguments["source"] == corrected,
                        "stage": "run" if arguments["source"] == corrected else "compile",
                    })

            schema = [{"type": "function", "function": {"name": "compile_kernel"}}]
            response = _msg(None, [
                _call("compile_kernel", json.dumps({"source": first}), "compile-1"),
                _call("compile_kernel", json.dumps({"source": corrected}), "compile-2"),
            ])
            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                report = run_agent(ws.root, max_steps=1, batch=True)

            self.assertEqual(calls, [
                ("compile_kernel", first),
                ("compile_kernel", corrected),
            ])
            self.assertFalse((ws.root / "pending_candidate.py").exists())
            self.assertIn("未完成 accept_candidate 权威裁决", report)

    def test_batch_bench_profile_accept_same_source_records_trajectory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            candidate = "def launch(*a):\n    return 1\n"
            calls = []

            class FakeExecutor:
                def call(self, name, arguments):
                    calls.append(name)
                    if name == "bench_kernel":
                        return json.dumps({"ok": True, "median_ms": 0.1})
                    if name == "profile_kernel":
                        return json.dumps({"ok": True, "bound": "memory-bound"})
                    if name == "accept_candidate":
                        ws.record({"accepted": False, "change": arguments.get("change")})
                        return json.dumps({"accepted": False, "reason": "below_threshold"})
                    return "{}"

            schema = [
                {"type": "function", "function": {"name": name}}
                for name in ("bench_kernel", "profile_kernel", "accept_candidate")
            ]
            response = _msg(None, [
                _call("bench_kernel", json.dumps({"source": candidate}), "bench"),
                _call("profile_kernel", json.dumps({"source": candidate}), "profile"),
                _call("accept_candidate", json.dumps({
                    "source": candidate,
                    "change": "candidate",
                }), "accept"),
            ])
            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                run_agent(ws.root, max_steps=1, batch=True)

            self.assertEqual(calls, ["bench_kernel", "profile_kernel", "accept_candidate"])
            self.assertTrue((ws.root / "trajectory.jsonl").is_file())
            self.assertFalse((ws.root / "pending_candidate.py").exists())

    def test_batch_wrong_source_accept_is_blocked_then_exact_source_is_finalized(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            candidate = "def launch(*a):\n    return 1\n"
            calls = []

            class FakeExecutor:
                def call(self, name, arguments):
                    calls.append((name, arguments))
                    if name == "bench_kernel":
                        return json.dumps({"ok": True, "median_ms": 0.1})
                    if name == "accept_candidate":
                        ws.record({"accepted": False, "change": arguments.get("change")})
                        return json.dumps({"accepted": False, "reason": "below_threshold"})
                    return "{}"

            schema = [
                {"type": "function", "function": {"name": name}}
                for name in ("bench_kernel", "accept_candidate")
            ]
            response = _msg(None, [
                _call("bench_kernel", json.dumps({"source": candidate}), "bench"),
                _call("accept_candidate", json.dumps({
                    "source": candidate + "\n",
                    "change": "wrong bytes",
                }), "wrong-accept"),
            ])
            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                run_agent(ws.root, max_steps=1, batch=True)

            self.assertEqual([name for name, _ in calls], ["bench_kernel", "accept_candidate"])
            self.assertEqual(calls[-1][1]["source"], candidate)
            self.assertTrue((ws.root / "trajectory.jsonl").is_file())

    def test_batch_trailing_newline_difference_is_a_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            candidate = ws.best_path.read_text(encoding="utf-8") + "\n"
            calls = []

            class FakeExecutor:
                def call(self, name, arguments):
                    calls.append(name)
                    if name == "bench_kernel":
                        return json.dumps({"ok": True, "median_ms": 0.1})
                    if name == "accept_candidate":
                        ws.record({"accepted": False})
                        return json.dumps({"accepted": False, "reason": "below_threshold"})
                    return "{}"

            schema = [
                {"type": "function", "function": {"name": name}}
                for name in ("bench_kernel", "accept_candidate")
            ]
            response = _msg(None, [_call(
                "bench_kernel",
                json.dumps({"source": candidate}),
            )])
            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                run_agent(ws.root, max_steps=1, batch=True)

            self.assertEqual(calls, ["bench_kernel", "accept_candidate"])

    def test_batch_existing_trajectory_is_added_to_grounded_rerun_goal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            ws.record({"accepted": True, "change": "older accepted round"})
            seen_messages = []

            class FakeExecutor:
                def call(self, name, arguments):
                    return json.dumps({"device": "test"})

            schema = [{"type": "function", "function": {"name": "get_environment"}}]

            def fake_chat(messages, tools=None, temperature=0.2):
                seen_messages.append(messages)
                return _msg("基于已有轨迹的最终报告")

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", fake_chat),
            ):
                report = run_agent(ws.root, max_steps=1, batch=True)

            self.assertIn("older accepted round", seen_messages[0][1]["content"])
            self.assertEqual(report, "基于已有轨迹的最终报告")

    def test_existing_trajectory_does_not_hide_unresolved_failed_bench(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            ws.record({"accepted": True, "change": "older accepted round"})
            candidate = "def launch(*a):\n    return 1\n"

            class FakeExecutor:
                def call(self, name, arguments):
                    if name == "bench_kernel":
                        return json.dumps({"ok": False, "status": "compile_error"})
                    return "{}"

            schema = [{"type": "function", "function": {"name": "bench_kernel"}}]
            responses = [
                _msg(None, [_call("bench_kernel", json.dumps({"source": candidate}))]),
                _msg("最终报告：新候选已经成功。"),
                _msg("最终报告：新候选已经成功。"),
                _msg("最终报告：新候选已经成功。"),
                _msg("最终报告：新候选已经成功。"),
            ]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", fake_chat),
            ):
                report = run_agent(ws.root, max_steps=5, batch=True)

            self.assertNotIn("新候选已经成功", report)
            self.assertIn("已有权威轨迹仍可分析", report)
            status = json.loads(
                (ws.root / "agent-status.json").read_text(encoding="utf-8")
            )
            self.assertEqual(status["state"], "complete_with_warning")
            self.assertTrue(status["evidenceReady"])
            self.assertTrue(status["warning"])


    def test_step_limit_ignores_compile_only_candidate_when_prior_trajectory_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            ws.record({"accepted": True, "change": "completed round"})
            candidate = "def launch(*a):\n    return 1\n"

            class FakeExecutor:
                def call(self, name, arguments):
                    return json.dumps({"ok": True, "stage": "run"})

            schema = [{"type": "function", "function": {"name": "compile_kernel"}}]
            response = _msg(None, [_call(
                "compile_kernel",
                json.dumps({"source": candidate}),
            )])
            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                report = run_agent(ws.root, max_steps=1, batch=True)

            self.assertIn("尚未完成 benchmark", report)
            self.assertIn("已有权威轨迹仍可分析", report)
            status = json.loads(
                (ws.root / "agent-status.json").read_text(encoding="utf-8")
            )
            self.assertEqual(status["state"], "complete_with_warning")
            self.assertTrue(status["evidenceReady"])
            self.assertTrue(status["warning"])
    def test_existing_trajectory_does_not_hide_failed_accept_attempt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            ws.record({"accepted": True, "change": "older accepted round"})
            candidate = "def launch(*a):\n    return 1\n"

            class FakeExecutor:
                def call(self, name, arguments):
                    if name == "accept_candidate":
                        return "✗ evaluator unavailable"
                    return "{}"

            schema = [{"type": "function", "function": {"name": "accept_candidate"}}]
            responses = [
                _msg(None, [_call("accept_candidate", json.dumps({"source": candidate}))]),
                _msg("最终报告：新候选已经成功。"),
                _msg("最终报告：新候选已经成功。"),
                _msg("最终报告：新候选已经成功。"),
                _msg("最终报告：新候选已经成功。"),
            ]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", fake_chat),
            ):
                report = run_agent(ws.root, max_steps=5, batch=True)

            self.assertNotIn("新候选已经成功", report)
            status = json.loads(
                (ws.root / "agent-status.json").read_text(encoding="utf-8")
            )
            self.assertEqual(status["state"], "incomplete")
            self.assertFalse(status["evidenceReady"])
            self.assertEqual(status["trajectoryRows"], 1)

    def test_existing_trajectory_does_not_hide_invalid_accept_arguments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            ws.record({"accepted": True, "change": "older accepted round"})

            class FakeExecutor:
                def call(self, name, arguments):
                    return "{}"

            schema = [{"type": "function", "function": {"name": "accept_candidate"}}]
            responses = [
                _msg(None, [_call("accept_candidate", "[]")]),
                _msg("最终报告：新候选已经成功。"),
                _msg("最终报告：新候选已经成功。"),
                _msg("最终报告：新候选已经成功。"),
                _msg("最终报告：新候选已经成功。"),
            ]
            index = {"i": 0}

            def fake_chat(messages, tools=None, temperature=0.2):
                response = responses[index["i"]]
                index["i"] += 1
                return response

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", fake_chat),
            ):
                report = run_agent(ws.root, max_steps=5, batch=True)

            self.assertNotIn("新候选已经成功", report)
            status = json.loads(
                (ws.root / "agent-status.json").read_text(encoding="utf-8")
            )
            self.assertEqual(status["state"], "incomplete")
            self.assertFalse(status["evidenceReady"])
            self.assertEqual(status["trajectoryRows"], 1)

    def test_trajectory_tail_keeps_complete_json_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trajectory.jsonl"
            first = json.dumps({"change": "a" * 80})
            second = json.dumps({"change": "b" * 20})
            oversized = json.dumps({"change": "c" * 200})
            path.write_text(
                f"{first}\n{second}\n{oversized}\nnot-json\n",
                encoding="utf-8",
            )

            tail = agent_module._tail_complete_lines(path, max_chars=len(second) + 1)

            self.assertEqual(tail, second)
            self.assertEqual(json.loads(tail)["change"], "b" * 20)

    def test_existing_unrelated_trajectory_does_not_drop_pending_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            candidate = "def launch(*a):\n    return 1\n"
            (ws.root / "pending_candidate.py").write_text(candidate, encoding="utf-8")
            ws.record({"accepted": False, "change": "unrelated non-batch round"})
            calls = []

            class FakeExecutor:
                def call(self, name, arguments):
                    calls.append((name, arguments))
                    if name == "accept_candidate":
                        ws.record({"accepted": False, "change": arguments.get("change")})
                        return json.dumps({"accepted": False, "reason": "below_threshold"})
                    return json.dumps({"device": "test"})

            schema = [
                {"type": "function", "function": {"name": name}}
                for name in ("get_environment", "accept_candidate")
            ]
            response = _msg(None, [_call("get_environment", "{}")])
            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", return_value=response),
            ):
                run_agent(ws.root, max_steps=1, batch=True)

            self.assertEqual(calls[0][0], "accept_candidate")
            self.assertEqual(calls[0][1]["source"], candidate)
            self.assertFalse((ws.root / "pending_candidate.py").exists())

    def test_resumed_accept_rebuilds_goal_from_updated_best(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = _make_workspace(tmp)
            (ws.root / "baseline.py").write_text(
                "def launch(*a):\n    pass\n", encoding="utf-8"
            )
            candidate = "def launch(*a):\n    return 1\n"
            (ws.root / "pending_candidate.py").write_text(candidate, encoding="utf-8")
            seen_messages = []

            class FakeExecutor:
                def call(self, name, arguments):
                    if name == "accept_candidate":
                        ws.best_path.write_text(arguments["source"], encoding="utf-8")
                        ws.record({"accepted": True, "change": arguments.get("change")})
                        return json.dumps({"accepted": True, "reason": "improved"})
                    return "{}"

            schema = [{"type": "function", "function": {"name": "accept_candidate"}}]

            def fake_chat(messages, tools=None, temperature=0.2):
                seen_messages.append(messages)
                return _msg("基于恢复后 best 的最终报告")

            with (
                mock.patch.object(agent_module, "build_tools", return_value=(FakeExecutor(), schema)),
                mock.patch.object(llm_module, "chat", fake_chat),
            ):
                report = run_agent(ws.root, max_steps=1, batch=True)

            goal = seen_messages[0][1]["content"]
            incumbent_section = goal.split(
                "当前 best.py incumbent 源码：", 1
            )[1].split("工作区里有", 1)[0]
            baseline_section = goal.split("原始 baseline.py 源码：", 1)[1]
            self.assertIn(candidate, incumbent_section)
            self.assertNotIn("pass", incumbent_section)
            self.assertIn("pass", baseline_section)
            self.assertEqual(report, "基于恢复后 best 的最终报告")



# ---------------------------------------------------------------------------
# batch / fixtures
# ---------------------------------------------------------------------------


class BatchFixtureTest(unittest.TestCase):
    def test_seed_and_batch_ask_user(self) -> None:
        from kernel_optimize.__main__ import _resolve_fixture, _seed_workspace_from_fixture

        fixture = Path(__file__).resolve().parents[2] / "chapter15" / "fixtures" / "vector_add"
        self.assertTrue(fixture.is_dir())
        resolved = _resolve_fixture(fixture)
        with tempfile.TemporaryDirectory() as tmp:
            ws_path = Path(tmp) / "ws"
            _seed_workspace_from_fixture(resolved, ws_path)
            self.assertTrue((ws_path / "task.json").is_file())
            self.assertTrue((ws_path / "reference.py").is_file())
            self.assertTrue((ws_path / "best.py").is_file())
            ws = Workspace(ws_path)
            ex, _ = build_tools(ws, batch=True)
            reply = ex.call("ask_user", {"question": "shape?"})
            self.assertIn("非交互", reply)


if __name__ == "__main__":
    unittest.main()
