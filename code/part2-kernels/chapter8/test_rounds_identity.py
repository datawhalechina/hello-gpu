"""CPU-only continuation guards; fixture identities are not experiment data."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import rounds_identity
import run_rounds
import verify_rounds


class ReachedExperiment(Exception):
    """Stop a successful guard before any real experiment command executes."""


class FrozenIdentityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / "frozen"
        for name in ("source", "build", "logs", "samples", "profiles"):
            (self.root / name).mkdir(parents=True)
        self.source = self.root / "source/vector_add_hip.hip"
        self.source.write_text("synthetic frozen kernel")
        (self.root / "source/vector_add_triton.py").write_text("synthetic frozen Python kernel")
        # The current runner is intentionally different from this frozen copy.
        (self.root / "source/run_rounds.py").write_text("synthetic old runner")
        self.binary = self.root / "build/vector_add_hip"
        self.binary.write_text("synthetic frozen binary")
        self.environment = {
            "gpu": "Fixture GPU", "architecture": "gfx1201", "rocm_sdk": "10.0.0",
            "hip": "fixture-hip", "torch": "fixture-torch", "triton": "fixture-triton+build",
            "os": "Fixture OS", "kernel": "fixture-kernel", "python": "fixture-python",
        }
        self.manifest = {
            "experiment": "synthetic-fixture", "started_at": "fixture-start",
            "environment": {**self.environment, "old_environment_note": "must not be inherited"},
            "source_sha256": {p.name: rounds_identity.sha256(p) for p in (self.root / "source").iterdir()},
            "build": {"binary_sha256": rounds_identity.sha256(self.binary)},
            "benchmark": {"shape": 16777216, "warmup": 0, "repeat": 1, "seed": 123,
                          "processes": 3, "dtype": "float32", "scope": "gpu-event-single-kernel"},
            "configurations": copy.deepcopy(run_rounds.CONFIGS), "execution_order": [],
        }
        self.write_manifest()

    def write_manifest(self):
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))

    def call_phase(self, phase):
        if phase == "profile":
            run_rounds.profile(self.root, copy.deepcopy(self.manifest))
        elif phase == "validation":
            run_rounds.validate_selected(self.root, copy.deepcopy(self.manifest))
        else:
            argv = ["verify_rounds.py", "--frozen-run", str(self.root),
                    "--output", str(self.base / "confirmation")]
            with patch.object(sys, "argv", argv):
                verify_rounds.main()

    def test_identity_mismatches_reject_every_entry_before_experiment_commands(self):
        cases = ["source", "binary", *rounds_identity.REQUIRED_ENVIRONMENT_FIELDS]
        for phase in ("profile", "validation", "confirmation"):
            for case in cases:
                with self.subTest(phase=phase, changed=case):
                    live = dict(self.environment)
                    original_source, original_binary = self.source.read_bytes(), self.binary.read_bytes()
                    if case == "source":
                        self.source.write_text("mutated kernel")
                    elif case == "binary":
                        self.binary.write_text("mutated binary")
                    else:
                        live[case] = "different active value"
                    try:
                        with patch.object(rounds_identity, "capture_environment", return_value=live), \
                             patch.object(run_rounds, "run") as experiment, \
                             patch.object(run_rounds, "summarize") as summary, \
                             patch.object(run_rounds.subprocess, "check_output") as resolver, \
                             patch.object(verify_rounds.subprocess, "run") as external:
                            with self.assertRaisesRegex(rounds_identity.FrozenIdentityError, "new --output"):
                                self.call_phase(phase)
                            experiment.assert_not_called()
                            summary.assert_not_called()
                            resolver.assert_not_called()
                            external.assert_not_called()
                        self.assertFalse((self.base / "confirmation").exists())
                    finally:
                        self.source.write_bytes(original_source)
                        self.binary.write_bytes(original_binary)

    def test_source_inventory_is_complete_but_bytecode_cache_is_ignored(self):
        cache = self.root / "source/__pycache__"
        cache.mkdir()
        (cache / "runner.pyc").write_bytes(b"bytecode fixture")
        with patch.object(rounds_identity, "capture_environment", return_value=self.environment):
            rounds_identity.check_frozen_identity(self.root)
            unexpected = self.root / "source/unrecorded.py"
            unexpected.write_text("unexpected source")
            with self.assertRaisesRegex(rounds_identity.FrozenIdentityError, "inventory changed"):
                rounds_identity.check_frozen_identity(self.root)
            unexpected.unlink()
            self.source.unlink()
            with self.assertRaisesRegex(rounds_identity.FrozenIdentityError, "inventory changed"):
                rounds_identity.check_frozen_identity(self.root)

    def test_missing_manifest_environment_is_not_silently_inherited(self):
        del self.manifest["environment"]["os"]
        with patch.object(rounds_identity, "capture_environment") as live:
            with self.assertRaisesRegex(rounds_identity.FrozenIdentityError, "lacks required"):
                rounds_identity.check_frozen_identity(self.root, self.manifest)
            live.assert_not_called()

    def test_unavailable_runtime_rejects_before_experiment(self):
        with patch.object(rounds_identity, "capture_environment", side_effect=RuntimeError("unavailable")), \
             patch.object(run_rounds, "run") as experiment:
            with self.assertRaisesRegex(rounds_identity.FrozenIdentityError, "cannot capture"):
                self.call_phase("profile")
            experiment.assert_not_called()

    def test_profile_continues_with_valid_snapshot_despite_current_runner_changes(self):
        with patch.object(rounds_identity, "capture_environment", return_value=self.environment), \
             patch.object(run_rounds.subprocess, "check_output", side_effect=ReachedExperiment) as resolver:
            with self.assertRaises(ReachedExperiment):
                self.call_phase("profile")
            resolver.assert_called_once()
        saved = json.loads((self.root / "manifest.json").read_text())
        check = saved["identity_checks"][-1]
        self.assertEqual(check["phase"], "profile")
        self.assertEqual(check["source_sha256"], self.manifest["source_sha256"])
        self.assertEqual(check["environment"], self.environment)

    def test_validation_continues_after_live_check(self):
        rows = [
            {"shape": 16777216, "implementation": "hip-v2", "runtime": "hip", "median_ms": 1,
             "config_id": "hip-v2-g65536"},
            {"shape": 16777216, "implementation": "triton-t0", "runtime": "triton", "median_ms": 1,
             "config_id": "triton-t0-b256"},
        ]
        with patch.object(rounds_identity, "capture_environment", return_value=self.environment), \
             patch.object(run_rounds, "summarize", return_value=rows), \
             patch.object(run_rounds, "benchmark", side_effect=ReachedExperiment) as experiment:
            with self.assertRaises(ReachedExperiment):
                self.call_phase("validation")
            experiment.assert_called_once()
        saved = json.loads((self.root / "manifest.json").read_text())
        self.assertEqual(saved["identity_checks"][-1]["phase"], "validation")

    def test_confirmation_saves_actual_environment_and_reference_before_first_command(self):
        live = {**self.environment, "capture_marker": "current runtime queried"}
        original_manifest = (self.root / "manifest.json").read_bytes()
        with patch.object(rounds_identity, "capture_environment", return_value=live), \
             patch.object(verify_rounds.shutil, "which", return_value=None), \
             patch.object(verify_rounds.subprocess, "run", side_effect=ReachedExperiment) as experiment:
            with self.assertRaises(ReachedExperiment):
                self.call_phase("confirmation")
            experiment.assert_called_once()
        saved = json.loads((self.base / "confirmation/manifest.json").read_text())
        self.assertEqual(saved["environment"]["capture_marker"], "current runtime queried")
        self.assertNotIn("old_environment_note", saved["environment"])
        self.assertEqual(saved["environment_source"], "captured-before-confirmation")
        self.assertEqual(saved["identity_check"]["environment"], live)
        self.assertEqual(saved["source_reference"]["started_at"], "fixture-start")
        self.assertEqual({c["id"] for c in saved["configurations"]},
                         {"hip-v0", "triton-t0-b256", "hip-v2-g65536", "hip-v3-g256"})
        self.assertEqual(original_manifest, (self.root / "manifest.json").read_bytes())


if __name__ == "__main__":
    unittest.main()
