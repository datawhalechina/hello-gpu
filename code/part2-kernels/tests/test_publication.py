from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
