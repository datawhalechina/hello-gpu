"""证据归档回归：仅用人工构造的 evaluator 返回值，不代表 GPU 实测。"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from kernel_optimize import llm
from kernel_optimize.agent import run_agent
from kernel_optimize.tools import Workspace, _run_eval, build_tools


def _workspace(root: str) -> Workspace:
    workspace = Workspace(Path(root))
    workspace.task_path.write_text(json.dumps({
        "optimization": {"minImprovementFraction": 0.01},
    }), encoding="utf-8")
    workspace.reference_path.write_text("# test reference\n", encoding="utf-8")
    workspace.best_path.write_text("# original incumbent\n", encoding="utf-8")
    return workspace


def _result() -> dict:
    return {
        "status": "ok", "latencyMs": 0.8,
        "benchmark": {"samplesMs": [0.79, 0.8, 0.81]},
        "comparison": {"improvementFraction": 0.2, "pairedImprovements": [0.2] * 5},
        "capturedOutput": "raw output " * 1000,
    }


def _rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


class EvidenceTest(unittest.TestCase):
    def test_promotion_keeps_incumbent_and_full_evaluation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = _workspace(tmp)
            executor, _ = build_tools(workspace)
            result = _result()
            with mock.patch("kernel_optimize.tools._evaluator", return_value=lambda *a, **k: result):
                executor.call("accept_candidate", {"source": "# candidate", "change": "test"})
                _run_eval(workspace, "# another candidate", incumbent=None, correctness_only=True)

            row = _rows(workspace.root / "trajectory.jsonl")[0]
            artifact = workspace.root / row["evaluation"]
            self.assertTrue(row["accepted"])
            self.assertEqual(workspace.best_path.read_text(), "# candidate\n")
            self.assertEqual((artifact / "incumbent.py").read_text(), "# original incumbent\n")
            self.assertEqual((artifact / "candidate.py").read_text(), "# candidate\n")
            self.assertEqual((artifact / "task.json").read_bytes(), workspace.task_path.read_bytes())
            self.assertEqual((artifact / "reference.py").read_bytes(), workspace.reference_path.read_bytes())
            self.assertEqual(json.loads((artifact / "result.json").read_text()), result)
            next_artifact = workspace.root / "evaluations/evaluation-0002"
            self.assertTrue(json.loads((next_artifact / "request.json").read_text())["correctnessOnly"])
            self.assertFalse((next_artifact / "incumbent.py").exists())

    def test_exception_preserves_source_and_tool_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = _workspace(tmp)
            executor, _ = build_tools(workspace)
            evaluator = mock.Mock(side_effect=RuntimeError("fixture evaluator failed"))
            with mock.patch("kernel_optimize.tools._evaluator", return_value=evaluator):
                observation = executor.call("bench_kernel", {"source": "# failed candidate"})
            artifact = workspace.root / "evaluations/evaluation-0001"
            self.assertEqual((artifact / "candidate.py").read_text(), "# failed candidate\n")
            self.assertEqual(json.loads((artifact / "result.json").read_text())["status"], "evaluation_error")
            call = _rows(workspace.root / "tool-calls.jsonl")[0]
            self.assertEqual(call["arguments"]["source"], "# failed candidate")
            self.assertEqual(call["observation"], observation)
            self.assertIn("fixture evaluator failed", observation)

    def test_agent_logs_conversation_and_automatic_accept(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = _workspace(tmp)
            candidate = "# automatic acceptance candidate\n"
            message = SimpleNamespace(content="try one candidate", tool_calls=[
                SimpleNamespace(id="call-1", function=SimpleNamespace(
                    name="bench_kernel", arguments=json.dumps({"source": candidate}),
                )),
            ])
            with (
                mock.patch.object(llm, "chat", return_value=message),
                mock.patch("kernel_optimize.tools._evaluator", return_value=lambda *a, **k: _result()),
            ):
                run_agent(workspace.root, goal="test goal", max_steps=1, batch=True)

            calls = _rows(workspace.root / "tool-calls.jsonl")
            self.assertEqual([call["name"] for call in calls], ["bench_kernel", "accept_candidate"])
            self.assertEqual(calls[1]["arguments"]["source"], candidate)
            conversation = _rows(workspace.root / "model-messages.jsonl")
            self.assertEqual([row["message"]["role"] for row in conversation],
                             ["system", "user", "assistant", "tool"])
            self.assertEqual(conversation[1]["message"]["content"], "test goal")
            self.assertEqual(conversation[2]["message"]["tool_calls"][0]["function"]["arguments"],
                             json.dumps({"source": candidate}))
            self.assertEqual(conversation[3]["message"]["content"], calls[0]["observation"][:6000])
            self.assertEqual([row["messageIndex"] for row in conversation], list(range(4)))


if __name__ == "__main__":
    unittest.main()
