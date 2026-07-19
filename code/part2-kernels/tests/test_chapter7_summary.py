from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


IMPLEMENTATIONS = (
    ("hip-v0", "hip", "256"),
    ("hip-v1-contiguous", "hip", "256"),
    ("hip-v1-strided", "hip", "256"),
    ("hip-v2", "hip", "256"),
    ("hip-v3", "hip", "256"),
    ("triton-t0", "triton", "1024"),
    ("triton-t1", "triton", "1024"),
)


class Chapter7SummaryTest(unittest.TestCase):
    def _source_hash(self, chapter: Path) -> str:
        digest = hashlib.sha256()
        for path in sorted(
            (path for path in chapter.iterdir() if path.suffix in {".hip", ".py", ".sh"}),
            key=lambda path: path.name,
        ):
            digest.update(path.name.encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
        return digest.hexdigest()

    def _write_fixture(
        self,
        chapter: Path,
        *,
        source_commit: str = "abc1234",
        source_sha256: str | None = None,
        run_count: int = 3,
        mixed_shape: bool = False,
        bad_metric: bool = False,
        profile_source_commit: str | None = None,
        independent_runs: int = 3,
        bad_operator: bool = False,
        bad_runtime: bool = False,
        bad_timed: bool = False,
    ) -> None:
        (chapter / "benchmark.py").write_text("# benchmark source\n", encoding="utf-8")
        source_sha256 = source_sha256 or self._source_hash(chapter)
        logs = chapter / "logs"
        runs = logs / "runs"
        runs.mkdir(parents=True)
        (logs / "benchmark_manifest.env").write_text(
            "\n".join(
                (
                    f"source_commit={source_commit}",
                    f"source_sha256={source_sha256}",
                    "size=1024",
                    "hip_block=256",
                    "triton_block=1024",
                    "warmup=2",
                    "repeat=5",
                    "seed=7",
                    f"independent_runs={independent_runs}",
                    "gpu_arch=gfx1201",
                    "run_edge_cases=1",
                    "run_triton_viz=1",
                    "grid=4",
                    "",
                )
            ),
            encoding="utf-8",
        )
        (logs / "environment.log").write_text(
            '[os-release]\nPRETTY_NAME="Ubuntu 24.04.4 LTS"\n'
            "[virtualization]\nnone\n",
            encoding="utf-8",
        )
        for run in range(1, run_count + 1):
            records = []
            for implementation, runtime, block in IMPLEMENTATIONS:
                shape = "2048" if mixed_shape and run == 2 and implementation == "hip-v0" else "1024"
                bandwidth = "0" if bad_metric and run == 1 and implementation == "hip-v0" else "1.0"
                operator = "other-op" if bad_operator and run == 1 and implementation == "hip-v0" else "vector-add"
                record_runtime = "triton" if bad_runtime and run == 1 and implementation == "hip-v0" else runtime
                timed = "0" if bad_timed and run == 1 and implementation == "hip-v0" else "1"
                records.append(
                    f"RESULT operator={operator} "
                    f"implementation={implementation} runtime={record_runtime} "
                    f"shape={shape} dtype=float32 block={block} grid=4 warmup=2 "
                    f"repeat=5 seed=7 timed={timed} correct=OK precheck=OK postcheck=OK "
                    f"min_ms=0.01 median_ms=0.02 mean_ms=0.02 effective_bandwidth_gbs={bandwidth} max_abs_error=0\n"
                )
            (runs / f"run{run}.log").write_text("".join(records), encoding="utf-8")
        profiles = chapter / "profiles"
        profiles.mkdir()
        (profiles / "profile_config.env").write_text(
            "\n".join(
                (
                    f"source_commit={profile_source_commit or source_commit}",
                    f"source_sha256={source_sha256}",
                    "size=1024",
                    "hip_block=256",
                    "triton_block=1024",
                    "seed=7",
                    "",
                )
            ),
            encoding="utf-8",
        )

    def _summarize(self, chapter: Path) -> subprocess.CompletedProcess[str]:
        script = Path(__file__).parents[1] / "chapter7" / "summarize_results.py"
        return subprocess.run(
            [sys.executable, str(script), "--chapter-dir", str(chapter), "--git-commit", "abc1234"],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_summary_accepts_exactly_three_complete_independent_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            self._write_fixture(chapter)

            completed = self._summarize(chapter)

            self.assertEqual(completed.returncode, 0, completed.stderr)
            manifest = json.loads((chapter / "evidence" / "manifest.json").read_text())
            self.assertEqual(manifest["benchmark"]["source_commit"], "abc1234")
            self.assertEqual(len(manifest["benchmark"]["source_sha256"]), 64)

    def test_summary_rejects_old_source_identity_without_replacing_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            self._write_fixture(chapter, source_commit="deadbeef")
            evidence = chapter / "evidence"
            evidence.mkdir()
            (evidence / "sentinel.txt").write_text("keep", encoding="utf-8")

            completed = self._summarize(chapter)

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("source_commit", completed.stderr)
            self.assertEqual((evidence / "sentinel.txt").read_text(), "keep")
            self.assertFalse((evidence / "summary.csv").exists())

    def test_summary_rejects_mixed_shapes_without_replacing_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            self._write_fixture(chapter, mixed_shape=True)
            evidence = chapter / "evidence"
            evidence.mkdir()
            (evidence / "summary.csv").write_text("old evidence\n", encoding="utf-8")

            completed = self._summarize(chapter)

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("metadata", completed.stderr)
            self.assertEqual((evidence / "summary.csv").read_text(), "old evidence\n")

    def test_summary_rejects_fewer_than_three_independent_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            self._write_fixture(chapter, run_count=2)

            completed = self._summarize(chapter)

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("exactly 3 independent", completed.stderr)
            self.assertFalse((chapter / "evidence").exists())

    def test_summary_rejects_nonpositive_metrics_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            self._write_fixture(chapter, bad_metric=True)
            evidence = chapter / "evidence"
            evidence.mkdir()
            (evidence / "manifest.json").write_text("old manifest\n", encoding="utf-8")

            completed = self._summarize(chapter)

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("effective_bandwidth_gbs", completed.stderr)
            self.assertEqual((evidence / "manifest.json").read_text(), "old manifest\n")

    def test_summary_rejects_profile_configuration_from_another_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            self._write_fixture(chapter, profile_source_commit="deadbeef")

            completed = self._summarize(chapter)

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("profile_config", completed.stderr)

    def test_summary_rejects_record_operator_runtime_and_timed_mismatches(self) -> None:
        cases = (
            ("operator", {"bad_operator": True}),
            ("runtime", {"bad_runtime": True}),
            ("timed", {"bad_timed": True}),
        )
        for field, kwargs in cases:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                chapter = Path(temporary)
                self._write_fixture(chapter, **kwargs)

                completed = self._summarize(chapter)

                self.assertNotEqual(completed.returncode, 0)
                self.assertIn(field, completed.stderr)

    def test_summary_rejects_trace_without_profile_config(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            self._write_fixture(chapter)
            (chapter / "profiles" / "profile_config.env").unlink()
            (chapter / "profiles" / "hip-v0_kernel_trace.csv").write_text(
                "Kernel_Name\nvector_add\n", encoding="utf-8"
            )

            completed = self._summarize(chapter)

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("profile_config.env", completed.stderr)

    def test_summary_allows_missing_profile_config_without_trace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            self._write_fixture(chapter)
            (chapter / "profiles" / "profile_config.env").unlink()

            completed = self._summarize(chapter)

            self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_summary_rejects_manifest_independent_runs_not_three(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            self._write_fixture(chapter, independent_runs=2)

            completed = self._summarize(chapter)

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("independent_runs", completed.stderr)

    def test_run_and_profile_manifests_record_source_identity(self) -> None:
        chapter = Path(__file__).parents[1] / "chapter7"
        run_all = (chapter / "run_all.sh").read_text(encoding="utf-8")
        profile_all = (chapter / "profile_all.sh").read_text(encoding="utf-8")
        for source in (run_all, profile_all):
            self.assertIn("source_commit=${SOURCE_COMMIT}", source)
            self.assertIn("source_sha256=${SOURCE_SHA256}", source)

    def test_scripts_reject_missing_source_commit_before_writes(self) -> None:
        for filename, generated in (("run_all.sh", ("logs", "profiles")), ("profile_all.sh", ("logs", "profiles"))):
            source = Path(__file__).parents[1] / "chapter7" / filename
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temporary:
                chapter = Path(temporary) / "chapter7"
                chapter.mkdir()
                script = chapter / filename
                shutil.copy2(source, script)
                environment = os.environ.copy()
                environment.pop("SOURCE_COMMIT", None)
                completed = subprocess.run(["bash", str(script)], cwd=temporary, env=environment, text=True, capture_output=True, check=False)
                self.assertEqual(completed.returncode, 2, completed.stderr)
                for name in generated:
                    self.assertFalse((chapter / name).exists(), name)


if __name__ == "__main__":
    unittest.main()
