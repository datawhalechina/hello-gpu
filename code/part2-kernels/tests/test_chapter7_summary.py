from __future__ import annotations

import csv
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class Chapter7SummaryTest(unittest.TestCase):
    def test_run_all_rejects_missing_source_commit_before_writes(self) -> None:
        source = Path(__file__).parents[1] / "chapter7" / "run_all.sh"
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary) / "chapter7"
            chapter.mkdir()
            script = chapter / "run_all.sh"
            shutil.copy2(source, script)
            environment = os.environ.copy()
            environment.pop("SOURCE_COMMIT", None)
            environment["TMPDIR"] = temporary

            completed = subprocess.run(
                ["bash", str(script)],
                cwd=temporary,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(completed.returncode, 2, completed.stderr)
            self.assertIn(
                "SOURCE_COMMIT must be a 7-40 character lowercase Git SHA",
                completed.stderr,
            )
            for generated in ("logs", "profiles", "results"):
                self.assertFalse((chapter / generated).exists(), generated)

    def test_trace_with_missing_headers_marks_fields_unavailable(self) -> None:
        script = Path(__file__).parents[1] / "chapter7" / "summarize_results.py"
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            runs = chapter / "logs" / "runs"
            runs.mkdir(parents=True)
            result = (
                "RESULT operator=vector-add implementation={implementation} "
                "runtime=hip shape=1024 dtype=float32 block=256 grid=4 "
                "correct=OK median_ms=0.02\n"
            )
            (runs / "hip_run1.log").write_text(
                result.format(implementation="hip-v0")
                + result.format(implementation="hip-v1-contiguous"),
                encoding="utf-8",
            )
            profiles = chapter / "profiles"
            profiles.mkdir()
            (profiles / "hip-v0_kernel_trace.csv").write_text(
                "VGPR_Count\n32\n", encoding="utf-8"
            )
            (profiles / "hip-v1-contiguous_kernel_trace.csv").write_text(
                "Kernel_Name,VGPR_Count\nvector_add_v1_contiguous,48\n",
                encoding="utf-8",
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--chapter-dir",
                    str(chapter),
                    "--git-commit",
                    "abc1234",
                ],
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            with (chapter / "evidence" / "profile_summary.csv").open(
                encoding="utf-8", newline=""
            ) as profile_file:
                by_implementation = {
                    row["implementation"]: row for row in csv.DictReader(profile_file)
                }
            missing_kernel_name = by_implementation["hip-v0"]
            self.assertTrue(
                all(
                    value == "unavailable"
                    for key, value in missing_kernel_name.items()
                    if key != "implementation"
                )
            )
            partial_trace = by_implementation["hip-v1-contiguous"]
            self.assertEqual(partial_trace["trace_dispatches"], "1")
            self.assertEqual(partial_trace["trace_vgpr_count"], "48")
            self.assertEqual(partial_trace["trace_grid_size_x"], "unavailable")

    def test_summary_writes_valid_curated_evidence(self) -> None:
        script = Path(__file__).parents[1] / "chapter7" / "summarize_results.py"
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            runs = chapter / "logs" / "runs"
            runs.mkdir(parents=True)
            (runs / "hip_run1.log").write_text(
                "RESULT operator=vector-add implementation=hip-v0 runtime=hip "
                "shape=1024 dtype=float32 block=256 grid=4 warmup=2 repeat=5 "
                "seed=7 timed=1 correct=OK precheck=OK postcheck=OK "
                "min_ms=0.01 median_ms=0.02 mean_ms=0.02 "
                "effective_bandwidth_gbs=1.0 max_abs_error=0\n",
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--chapter-dir",
                    str(chapter),
                    "--git-commit",
                    "abc1234",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            manifest = json.loads(
                (chapter / "evidence" / "manifest.json").read_text()
            )
            self.assertEqual(manifest["operator"], "vector-add")
            self.assertEqual(manifest["git_commit"], "abc1234")
            with (chapter / "evidence" / "summary.csv").open(
                encoding="utf-8", newline=""
            ) as summary_file:
                summary = list(csv.DictReader(summary_file))
            self.assertEqual(summary[0]["operator"], "vector-add")
            self.assertEqual(summary[0]["shape"], "1024")
            with (chapter / "evidence" / "profile_summary.csv").open(
                encoding="utf-8", newline=""
            ) as profile_file:
                profiles = list(csv.DictReader(profile_file))
            self.assertEqual(profiles[0]["implementation"], "hip-v0")
            self.assertEqual(profiles[0]["trace_dispatches"], "unavailable")
            self.assertEqual(profiles[0]["trace_vgpr_count"], "unavailable")


if __name__ == "__main__":
    unittest.main()
