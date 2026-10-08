"""CPU-only phase dispatch tests; no kernels or profiler commands execute."""
from contextlib import ExitStack, redirect_stdout
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, mock_open, patch

import run_rounds


class RunnerPhaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / "run"
        self.new_manifest = {
            "configurations": [{"id": "new-fixture"}],
            "benchmark": {"shape": 16777216, "warmup": 10, "repeat": 50, "seed": 20260920},
        }
        self.frozen_manifest = {
            "configurations": [{"id": "frozen-fixture"}],
            "benchmark": {"shape": 1027, "warmup": 2, "repeat": 3, "seed": 42},
            "source_sha256": {"frozen.fixture": "original-identity"},
        }

    def invoke(self, *extra):
        calls = Mock()
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys, "argv", ["run_rounds.py", "--output", str(self.root), *extra]))
            # Mock only the runner's lock open; Path.read_text still reads the
            # real temporary manifest through io.open on continuation phases.
            stack.enter_context(patch("run_rounds.open", mock_open(), create=True))
            stack.enter_context(patch.object(run_rounds.fcntl, "flock"))
            for name in ("initialize", "benchmark", "profile", "validate_selected", "save_manifest", "summarize"):
                mocked = stack.enter_context(patch.object(run_rounds, name))
                calls.attach_mock(mocked, name)
            calls.initialize.return_value = copy.deepcopy(self.new_manifest)
            run_rounds.main()
        return calls

    def test_default_runs_only_main_and_keeps_timing_defaults(self):
        calls = self.invoke()
        self.assertEqual([call[0] for call in calls.mock_calls],
                         ["initialize", "benchmark", "save_manifest", "summarize"])
        root, args = calls.initialize.call_args.args
        self.assertEqual(root, self.root)
        self.assertEqual(args.phase, "main")
        self.assertEqual((args.size, args.warmup, args.repeat, args.seed),
                         (16777216, 10, 50, 20260920))
        manifest = calls.initialize.return_value
        calls.benchmark.assert_called_once_with(manifest["configurations"], self.root, manifest, 16777216)
        calls.profile.assert_not_called()
        calls.validate_selected.assert_not_called()
        calls.summarize.assert_called_once_with(self.root, self.root / "summary")

    def test_explicit_main_still_runs_only_main(self):
        calls = self.invoke("--phase", "main")
        calls.initialize.assert_called_once()
        calls.benchmark.assert_called_once()
        calls.profile.assert_not_called()
        calls.validate_selected.assert_not_called()

    def test_explicit_continuations_use_existing_manifest(self):
        self.root.mkdir()
        path = self.root / "manifest.json"
        path.write_text(json.dumps(self.frozen_manifest))
        for phase, operation in (("profile", "profile"), ("validation", "validate_selected")):
            with self.subTest(phase=phase):
                calls = self.invoke("--phase", phase, "--size", "9999", "--seed", "999")
                calls.initialize.assert_not_called()
                calls.benchmark.assert_not_called()
                self.assertEqual([call[0] for call in calls.mock_calls],
                                 [operation, "save_manifest", "summarize"])
                root, manifest = getattr(calls, operation).call_args.args
                self.assertEqual(root, self.root)
                for key, expected in self.frozen_manifest.items():
                    self.assertEqual(manifest[key], expected)
                self.assertIn("updated_at", manifest)
                calls.save_manifest.assert_called_once_with(self.root, manifest)

    def test_explicit_all_preserves_complete_phase_order(self):
        calls = self.invoke("--phase", "all")
        self.assertEqual([call[0] for call in calls.mock_calls],
                         ["initialize", "benchmark", "profile", "validate_selected", "save_manifest", "summarize"])
        manifest = calls.initialize.return_value
        calls.profile.assert_called_once_with(self.root, manifest)
        calls.validate_selected.assert_called_once_with(self.root, manifest)

    def test_help_describes_default_and_optional_phases(self):
        output = io.StringIO()
        with patch.object(sys, "argv", ["run_rounds.py", "--help"]), redirect_stdout(output):
            with self.assertRaises(SystemExit) as result:
                run_rounds.main()
        self.assertEqual(result.exception.code, 0)
        text = " ".join(output.getvalue().split())
        self.assertIn("main (default): boundary checks and three-process benchmarks", text)
        self.assertIn("profile: trace an existing run on demand", text)
        self.assertIn("validation: validate additional shapes in an existing run on demand", text)
        self.assertIn("all: run main, profile and validation", text)


if __name__ == "__main__":
    unittest.main()
