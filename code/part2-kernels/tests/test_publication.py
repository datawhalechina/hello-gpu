from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from common import publication
from common.publication import PublicationError, publish


class PublicationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.chapter = self.root / "chapter8"
        self.chapter.mkdir()
        self.environment = self.root / "environment.env"
        self.environment.write_text("GPU=RX 9070 XT\nROCM=7.13\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_logs(self, *, mutation=None) -> list[Path]:
        paths = []
        for process in range(1, 4):
            lines = []
            for implementation, runtime, median in (
                ("hip-lds", "hip", 0.30 + process / 100),
                ("triton-t1", "triton", 0.20 + process / 100),
            ):
                fields = {
                    "operator": "sum-reduction",
                    "implementation": implementation,
                    "runtime": runtime,
                    "shape": "N=16777216",
                    "dtype": "float32",
                    "warmup": "10",
                    "repeat": "50",
                    "seed": "20260719",
                    "timed": "1",
                    "correct": "OK",
                    "precheck": "OK",
                    "postcheck": "OK",
                    "median_ms": str(median),
                    "mean_ms": str(median + 0.01),
                }
                if mutation is not None:
                    mutation(process, implementation, fields, lines)
                encoded = " ".join(f'{key}="{value}"' for key, value in fields.items())
                lines.append(f"RESULT {encoded}")
            path = self.root / f"process-{process}.log"
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            paths.append(path)
        return paths

    def publish(self, paths: list[Path]) -> None:
        publish(
            chapter_dir=self.chapter,
            operator="sum-reduction",
            git_commit="abc123",
            run_logs=paths,
            environment_file=self.environment,
            profile_dir=None,
        )

    def write_profiles(self) -> Path:
        profile_dir = self.root / "profiles"
        profile_dir.mkdir()
        (profile_dir / "profile_config.env").write_text(
            "source_commit=abc123\nshape=N=16777216\nseed=20260719\n",
            encoding="utf-8",
        )
        for implementation in ("hip-lds", "triton-t1"):
            (profile_dir / f"{implementation}_kernel_trace.csv").write_text(
                "Kernel_Name,Grid_Size_X,Workgroup_Size_X\n"
                f"{implementation}_kernel,256,256\n",
                encoding="utf-8",
            )
        return profile_dir

    def test_publishes_three_process_median_and_manifest(self) -> None:
        self.publish(self.write_logs())

        manifest = json.loads((self.chapter / "evidence/manifest.json").read_text())
        summary = json.loads((self.chapter / "evidence/summary.json").read_text())
        self.assertEqual(manifest["git_commit"], "abc123")
        self.assertEqual(manifest["process_count"], 3)
        self.assertEqual(manifest["environment"]["GPU"], "RX 9070 XT")
        self.assertEqual(summary[0]["run_count"], 3)
        self.assertEqual(summary[0]["sources"], "process-1.log;process-2.log;process-3.log")
        self.assertAlmostEqual(summary[0]["median_ms"], 0.32)
        self.assertAlmostEqual(summary[0]["median_ms_run_min"], 0.31)
        self.assertAlmostEqual(summary[0]["median_ms_run_max"], 0.33)
        self.assertTrue((self.chapter / "evidence/summary.csv").is_file())
        self.assertTrue((self.chapter / "evidence/profile_summary.csv").is_file())

    def test_requires_exactly_three_distinct_logs(self) -> None:
        with self.assertRaisesRegex(PublicationError, "exactly 3"):
            self.publish(self.write_logs()[:2])
        paths = self.write_logs()
        with self.assertRaisesRegex(PublicationError, "distinct"):
            self.publish([paths[0], paths[0], paths[1]])

    def test_rejects_duplicate_implementation_in_process(self) -> None:
        def duplicate(process, implementation, fields, lines):
            if process == 2 and implementation == "hip-lds":
                encoded = " ".join(f'{key}="{value}"' for key, value in fields.items())
                lines.append(f"RESULT {encoded}")

        with self.assertRaisesRegex(PublicationError, "duplicate"):
            self.publish(self.write_logs(mutation=duplicate))

    def test_rejects_mixed_main_shape(self) -> None:
        def mixed(process, implementation, fields, lines):
            if process == 3:
                fields["shape"] = "N=1027"

        with self.assertRaisesRegex(PublicationError, "mixed benchmark metadata"):
            self.publish(self.write_logs(mutation=mixed))

    def test_rejects_missing_implementation_and_required_metadata(self) -> None:
        def missing_implementation(process, implementation, fields, lines):
            if process == 3 and implementation == "triton-t1":
                fields.pop("implementation")

        with self.assertRaisesRegex(PublicationError, "requires implementation"):
            self.publish(self.write_logs(mutation=missing_implementation))

        def missing_shape(process, implementation, fields, lines):
            if process == 2 and implementation == "hip-lds":
                fields.pop("shape")

        with self.assertRaisesRegex(PublicationError, "missing required fields: shape"):
            self.publish(self.write_logs(mutation=missing_shape))

        paths = self.write_logs()
        third_lines = paths[2].read_text(encoding="utf-8").splitlines()
        paths[2].write_text(third_lines[0] + "\n", encoding="utf-8")
        with self.assertRaisesRegex(PublicationError, "same implementations"):
            self.publish(paths)

    def test_rejects_runtime_mismatch_for_same_implementation(self) -> None:
        def mixed_runtime(process, implementation, fields, lines):
            if process == 3 and implementation == "hip-lds":
                fields["runtime"] = "triton"

        with self.assertRaisesRegex(PublicationError, "runtime mismatch"):
            self.publish(self.write_logs(mutation=mixed_runtime))

    def test_rejects_nonfinite_or_nonpositive_timing(self) -> None:
        for invalid in ("nan", "inf", "0", "-1"):
            with self.subTest(invalid=invalid):
                def bad(process, implementation, fields, lines, value=invalid):
                    if process == 1 and implementation == "hip-lds":
                        fields["median_ms"] = value

                with self.assertRaisesRegex(PublicationError, "finite and positive"):
                    self.publish(self.write_logs(mutation=bad))

    def test_rejects_incorrect_rows(self) -> None:
        def incorrect(process, implementation, fields, lines):
            if process == 1 and implementation == "triton-t1":
                fields["postcheck"] = "FAIL"

        with self.assertRaisesRegex(PublicationError, "postcheck"):
            self.publish(self.write_logs(mutation=incorrect))

    def test_failure_preserves_existing_evidence(self) -> None:
        evidence = self.chapter / "evidence"
        evidence.mkdir()
        marker = evidence / "keep.txt"
        marker.write_text("old", encoding="utf-8")

        with self.assertRaises(PublicationError):
            self.publish(self.write_logs()[:1])

        self.assertEqual(marker.read_text(encoding="utf-8"), "old")
        self.assertEqual(sorted(path.name for path in evidence.iterdir()), ["keep.txt"])

    def test_profile_directory_must_be_complete_and_well_formed(self) -> None:
        paths = self.write_logs()
        profile_dir = self.write_profiles()
        publish(
            chapter_dir=self.chapter,
            operator="sum-reduction",
            git_commit="abc123",
            run_logs=paths,
            environment_file=self.environment,
            profile_dir=profile_dir,
        )
        profile_csv = (self.chapter / "evidence/profile_summary.csv").read_text()
        self.assertIn("hip-lds", profile_csv)
        self.assertIn("triton-t1", profile_csv)

        (profile_dir / "triton-t1_kernel_trace.csv").unlink()
        with self.assertRaisesRegex(PublicationError, "implementation set mismatch"):
            publish(
                chapter_dir=self.chapter,
                operator="sum-reduction",
                git_commit="abc123",
                run_logs=paths,
                environment_file=self.environment,
                profile_dir=profile_dir,
            )

        for path in profile_dir.iterdir():
            path.unlink()
        with self.assertRaisesRegex(PublicationError, "no kernel trace"):
            publish(
                chapter_dir=self.chapter,
                operator="sum-reduction",
                git_commit="abc123",
                run_logs=paths,
                environment_file=self.environment,
                profile_dir=profile_dir,
            )

        malformed = profile_dir / "hip-lds_kernel_trace.csv"
        malformed.write_text("Wrong_Field\nvalue\n", encoding="utf-8")
        with self.assertRaisesRegex(PublicationError, "lacks Kernel_Name"):
            publish(
                chapter_dir=self.chapter,
                operator="sum-reduction",
                git_commit="abc123",
                run_logs=paths,
                environment_file=self.environment,
                profile_dir=profile_dir,
            )

    def test_profile_source_commit_must_match_publication(self) -> None:
        paths = self.write_logs()
        profile_dir = self.write_profiles()
        (profile_dir / "profile_config.env").write_text(
            "source_commit=stale123\n", encoding="utf-8"
        )
        with self.assertRaisesRegex(PublicationError, "source_commit mismatch"):
            publish(
                chapter_dir=self.chapter,
                operator="sum-reduction",
                git_commit="abc123",
                run_logs=paths,
                environment_file=self.environment,
                profile_dir=profile_dir,
            )

    def test_swap_failure_restores_existing_evidence(self) -> None:
        evidence = self.chapter / "evidence"
        evidence.mkdir()
        marker = evidence / "keep.txt"
        marker.write_text("old", encoding="utf-8")
        real_replace = publication.os.replace
        calls = 0

        def fail_install(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("simulated install failure")
            return real_replace(source, destination)

        with mock.patch("common.publication.os.replace", side_effect=fail_install):
            with self.assertRaisesRegex(OSError, "simulated"):
                self.publish(self.write_logs())

        self.assertEqual(marker.read_text(encoding="utf-8"), "old")

    def test_cli_help_documents_repeated_run_log(self) -> None:
        result = subprocess.run(
            ["python3", "tools/publish_chapter.py", "--help"],
            cwd=Path(__file__).resolve().parents[1],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertIn("pass exactly three times", result.stdout)


if __name__ == "__main__":
    unittest.main()
