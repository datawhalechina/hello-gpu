"""CPU-only CLI dispatch tests for Chapters 9–13; no GPU commands execute."""
from contextlib import ExitStack, contextmanager, redirect_stdout
import importlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, mock_open, patch


PART = Path(__file__).resolve().parents[2]
CHAPTERS = range(9, 14)


@contextmanager
def isolated_runner(chapter):
    """Each chapter has identically named local imports: do not reuse them."""
    names = ("run_rounds", "summarize_rounds", "rounds_identity")
    saved = {name: sys.modules.pop(name) for name in names if name in sys.modules}
    old_path = sys.path[:]
    sys.path.insert(0, str(PART / f"chapter{chapter}"))
    try:
        runner = importlib.import_module("run_rounds")
        for name in names:
            module = sys.modules[name]
            assert Path(module.__file__).parent == PART / f"chapter{chapter}", name
        yield runner
    finally:
        sys.path[:] = old_path
        for name in names:
            sys.modules.pop(name, None)
        sys.modules.update(saved)


class RunnerPhaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / "run"

    def new_manifest(self, runner):
        shape = getattr(runner, "MAIN_SHAPE", 16777216)
        return {
            "configurations": [{"id": "main-fixture"}, {"id": "extra-fixture"}],
            "measurement_matrix": {shape: ["main-fixture"]},
            "benchmark": {"shape": shape, "warmup": 10, "repeat": 50,
                          "processes": 3, "seed": 20260920},
        }

    def invoke(self, runner, *extra):
        calls = Mock()
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys, "argv", ["run_rounds.py", "--output", str(self.root), *extra]))
            # Only the advisory-lock open is mocked. Path.read_text still reads
            # the real temporary frozen manifest on continuation phases.
            stack.enter_context(patch.object(runner, "open", mock_open(), create=True))
            stack.enter_context(patch.object(runner.fcntl, "flock"))
            stack.enter_context(patch.object(runner.subprocess, "run", side_effect=AssertionError("unexpected external command")))
            for name in ("initialize", "benchmark", "profile", "validation", "save", "summarize", "check_frozen_identity"):
                mocked = stack.enter_context(patch.object(runner, name))
                calls.attach_mock(mocked, name)
            if hasattr(runner, "group_scan"):
                calls.attach_mock(stack.enter_context(patch.object(runner, "group_scan")), "group_scan")
            calls.initialize.return_value = self.new_manifest(runner)
            calls.check_frozen_identity.return_value = {"verified": "fixture"}
            runner.main()
        return calls

    def test_default_and_explicit_main_exclude_optional_phases(self):
        for chapter in CHAPTERS:
            with isolated_runner(chapter) as runner:
                for extra in ((), ("--phase", "main")):
                    with self.subTest(chapter=chapter, extra=extra):
                        calls = self.invoke(runner, *extra)
                        order = ["initialize", "benchmark"]
                        if chapter == 11:
                            order.append("group_scan")
                        self.assertEqual([call[0] for call in calls.mock_calls], order + ["save", "summarize"])
                        root, args = calls.initialize.call_args.args
                        self.assertEqual((root, args.phase, args.seed), (self.root, "main", 20260920))
                        manifest = calls.initialize.return_value
                        expected_configs = manifest["configurations"][:1] if chapter == 13 else manifest["configurations"]
                        calls.benchmark.assert_called_once_with(expected_configs, self.root, manifest, manifest["benchmark"]["shape"])
                        if chapter == 11:
                            calls.group_scan.assert_called_once_with(self.root, manifest)
                        calls.profile.assert_not_called()
                        calls.validation.assert_not_called()
                        calls.summarize.assert_called_once_with(self.root, self.root / "summary")

    def test_explicit_all_preserves_existing_order(self):
        for chapter in CHAPTERS:
            with self.subTest(chapter=chapter), isolated_runner(chapter) as runner:
                calls = self.invoke(runner, "--phase", "all")
                order = ["initialize", "benchmark"]
                if chapter == 11:
                    order.append("group_scan")
                self.assertEqual([call[0] for call in calls.mock_calls],
                                 order + ["profile", "validation", "save", "summarize"])
                manifest = calls.initialize.return_value
                calls.profile.assert_called_once_with(self.root, manifest)
                calls.validation.assert_called_once_with(self.root, manifest)

    def test_continuations_use_frozen_manifest_not_cli_seed(self):
        self.root.mkdir()
        frozen = {
            "configurations": [{"id": "frozen-fixture"}],
            "benchmark": {"shape": "frozen-shape", "warmup": 2, "repeat": 3, "seed": 42},
            "source_sha256": {"frozen.fixture": "original-source-identity"},
            "build": {"binary_sha256": "original-binary-identity"},
        }
        path = self.root / "manifest.json"
        path.write_text(json.dumps(frozen))
        for chapter in CHAPTERS:
            with isolated_runner(chapter) as runner:
                for phase in ("profile", "validation"):
                    with self.subTest(chapter=chapter, phase=phase):
                        calls = self.invoke(runner, "--phase", phase, "--seed", "999")
                        order = ["check_frozen_identity", "save"] if chapter == 9 else []
                        self.assertEqual([call[0] for call in calls.mock_calls], order + [phase, "save", "summarize"])
                        root, manifest = getattr(calls, phase).call_args.args
                        self.assertEqual(root, self.root)
                        for key, expected in frozen.items():
                            self.assertEqual(manifest[key], expected)
                        if chapter == 9:
                            calls.check_frozen_identity.assert_called_once_with(self.root, manifest)
                            self.assertEqual(manifest["phase_identity_checks"], [{"phase": phase, "verified": "fixture"}])
                        calls.initialize.assert_not_called()
                        calls.benchmark.assert_not_called()
                        if chapter == 11:
                            calls.group_scan.assert_not_called()
                        self.assertEqual(json.loads(path.read_text()), frozen)

    def test_continuations_require_an_existing_manifest(self):
        for chapter in CHAPTERS:
            with isolated_runner(chapter) as runner:
                for phase in ("profile", "validation"):
                    with self.subTest(chapter=chapter, phase=phase):
                        with self.assertRaises(FileNotFoundError):
                            self.invoke(runner, "--phase", phase)
                        self.assertFalse(self.root.exists())

    def test_help_explains_default_and_optional_phases(self):
        for chapter in CHAPTERS:
            with self.subTest(chapter=chapter), isolated_runner(chapter) as runner:
                output = io.StringIO()
                with patch.object(sys, "argv", ["run_rounds.py", "--help"]), redirect_stdout(output):
                    with self.assertRaises(SystemExit) as result:
                        runner.main()
                self.assertEqual(result.exception.code, 0)
                text = " ".join(output.getvalue().split())
                self.assertIn("main (default): boundary checks and three-process benchmarks", text)
                self.assertIn("profile: trace an existing run on demand", text)
                self.assertIn("validation: validate additional shapes in an existing run on demand", text)
                self.assertIn("all: run main, profile and validation", text)


if __name__ == "__main__":
    unittest.main()
