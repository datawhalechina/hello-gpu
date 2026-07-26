from __future__ import annotations

import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


EXPECTED_IMPLEMENTATIONS = {
    "branch-divergence": {"wave-uniform", "wave-divergent"},
    "global-memory": {"stride-1", "stride-17", "stride-257"},
    "lds-banks": {"stride-1", "stride-32", "stride-33"},
    "matrix-path": {"valu", "wmma"},
}

REQUIRED_RESULT_FIELDS = {
    "experiment", "implementation", "runtime", "shape", "dtype",
    "warmup", "repeat", "seed", "timed", "correct", "precheck",
    "postcheck", "median_ms",
}

FORBIDDEN_CHAPTER_TEXT = {
    "~760 GB/s",
    "实测 ≈ 标称的 67%",
    "纯 GDDR6 平台，L2 已被打穿",
    "硬件折叠成 1 次",
}


ROOT = Path(__file__).resolve().parents[3]
CHAPTER_DIR = ROOT / "code" / "part0-intro" / "chapter2"
DOC_PATH = ROOT / "docs" / "part0-intro" / "chapter2" / "index.md"
EVIDENCE_SUMMARY_PATH = CHAPTER_DIR / "evidence" / "summary.csv"


class Chapter2ContractTest(unittest.TestCase):
    def require_file(self, path: Path) -> Path:
        if not path.is_file():
            self.fail(f"missing formal Chapter 2 file: {path.relative_to(ROOT)}")
        return path

    def load_result_contract(self):
        path = self.require_file(CHAPTER_DIR / "result_contract.py")
        spec = importlib.util.spec_from_file_location("chapter2_result_contract", path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_formal_files_exist(self):
        for name in (
            "branch_divergence.hip",
            "global_memory_access.hip",
            "lds_bank_conflict.hip",
            "rdna4_wmma.hip",
            "run_all.sh",
            "profile_all.sh",
            "result_contract.py",
            "plot_results.py",
        ):
            self.assertTrue((CHAPTER_DIR / name).is_file(), name)

    def test_run_all_has_formal_controls(self):
        text = self.require_file(CHAPTER_DIR / "run_all.sh").read_text()
        for token in ("WARMUP", "REPEAT", "SEED", "RUN_EDGE_CASES", "gfx1201"):
            self.assertIn(token, text)

    def test_profile_is_per_implementation(self):
        text = self.require_file(CHAPTER_DIR / "profile_all.sh").read_text()
        self.assertIn("profile_config.env", text)
        self.assertIn("source_commit", text)
        self.assertNotIn("--implementation all", text)

    def test_result_contract_matches_public_matrix_and_fields(self):
        result_contract = self.load_result_contract()
        self.assertTrue(
            hasattr(result_contract, "EXPECTED_IMPLEMENTATIONS"),
            "result_contract.py must define EXPECTED_IMPLEMENTATIONS",
        )
        self.assertTrue(
            hasattr(result_contract, "REQUIRED_RESULT_FIELDS"),
            "result_contract.py must define REQUIRED_RESULT_FIELDS",
        )
        self.assertEqual(
            result_contract.EXPECTED_IMPLEMENTATIONS,
            EXPECTED_IMPLEMENTATIONS,
        )
        self.assertEqual(
            set(result_contract.REQUIRED_RESULT_FIELDS),
            REQUIRED_RESULT_FIELDS,
        )

    def test_evidence_summary_matches_contract(self):
        path = self.require_file(EVIDENCE_SUMMARY_PATH)
        with path.open(newline="") as handle:
            reader = csv.DictReader(handle)
            self.assertIsNotNone(reader.fieldnames)
            required_columns = REQUIRED_RESULT_FIELDS | {"run_count"}
            fieldnames = set(reader.fieldnames or [])
            self.assertTrue(
                required_columns.issubset(fieldnames),
                f"summary.csv missing columns: "
                f"{sorted(required_columns - fieldnames)}",
            )
            rows = list(reader)

        expected_pairs = {
            (experiment, implementation)
            for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items()
            for implementation in implementations
        }
        observed_pairs = {
            (row["experiment"], row["implementation"])
            for row in rows
        }
        self.assertEqual(observed_pairs, expected_pairs)
        self.assertEqual(len(rows), len(expected_pairs))
        for row in rows:
            with self.subTest(row=row):
                self.assertEqual(row["correct"], "OK")
                self.assertEqual(row["run_count"], "3")

    def test_chapter_removes_stale_claims(self):
        text = DOC_PATH.read_text()
        for phrase in FORBIDDEN_CHAPTER_TEXT:
            self.assertNotIn(phrase, text)


class Chapter2PublicationTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.evidence = self.root / "evidence"
        self.evidence.mkdir()
        self.log1 = self.root / "process-1.log"
        self.log2 = self.root / "process-2.log"
        self.log3 = self.root / "process-3.log"
        for index, path in enumerate((self.log1, self.log2, self.log3), start=1):
            self.write_log(path, process=index)

        path = CHAPTER_DIR / "result_contract.py"
        spec = importlib.util.spec_from_file_location("chapter2_result_contract", path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def tearDown(self):
        self.tempdir.cleanup()

    def write_log(
        self,
        path: Path,
        *,
        process: int = 1,
        correct: str = "OK",
        omit: tuple[str, str] | None = None,
    ):
        lines = []
        for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items():
            for implementation in sorted(implementations):
                if omit == (experiment, implementation):
                    continue
                fields = {
                    "experiment": experiment,
                    "implementation": implementation,
                    "runtime": "hip",
                    "shape": "M=64,N=64,K=64",
                    "dtype": "fp32",
                    "warmup": "5",
                    "repeat": "10",
                    "seed": "7",
                    "timed": "1",
                    "correct": correct,
                    "precheck": "OK",
                    "postcheck": "OK",
                    "min_ms": f"{1.0 + process / 100:.2f}",
                    "median_ms": f"{1.1 + process / 100:.2f}",
                    "mean_ms": f"{1.2 + process / 100:.2f}",
                    "logical_bandwidth_gbs": f"{100 + process}",
                    "tflops": f"{10 + process / 10:.1f}",
                }
                lines.append(
                    "RESULT " + " ".join(f"{key}={value}" for key, value in fields.items())
                )
        path.write_text("\n".join(lines) + "\n")

    def test_publication_requires_three_distinct_logs(self):
        with self.assertRaisesRegex(ValueError, "exactly 3 distinct"):
            self.module.validate_runs([self.log1, self.log1, self.log2])

    def test_publication_rejects_incorrect_rows(self):
        self.write_log(self.log1, correct="FAIL")
        with self.assertRaisesRegex(ValueError, "correct"):
            self.module.validate_runs([self.log1, self.log2, self.log3])

    def test_each_process_has_same_pairs(self):
        self.write_log(self.log3, omit=("matrix-path", "wmma"))
        with self.assertRaisesRegex(ValueError, "same experiment/implementation"):
            self.module.validate_runs([self.log1, self.log2, self.log3])

    def test_failed_publication_preserves_existing_evidence(self):
        sentinel = self.evidence / "sentinel.txt"
        sentinel.write_text("keep")
        with self.assertRaises(ValueError):
            self.module.publish(
                [self.log1, self.log1, self.log2],
                None,
                self.evidence,
                "a" * 40,
            )
        self.assertEqual(sentinel.read_text(), "keep")

    def test_publication_writes_atomic_aggregate_and_profile_summary(self):
        profile = self.root / "profile"
        profile.mkdir()
        (profile / "profile_config.env").write_text("source_commit=" + "a" * 40 + "\n")
        (profile / "matrix-path__wmma_kernel_trace.csv").write_text(
            "kernel_name,duration_ns\nwmma_kernel,100\nwmma_kernel,110\n"
        )

        self.module.publish(
            [self.log1, self.log2, self.log3], profile, self.evidence, "a" * 40
        )

        with (self.evidence / "manifest.json").open() as handle:
            manifest = json.load(handle)
        self.assertEqual(manifest["source_commit"], "a" * 40)
        self.assertEqual(len(manifest["run_logs"]), 3)
        with (self.evidence / "summary.csv").open(newline="") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 10)
        self.assertEqual(rows[0]["run_count"], "3")
        self.assertEqual(rows[0]["median_ms"], "1.12")
        self.assertEqual(rows[0]["min_ms_process_min"], "1.01")
        self.assertEqual(rows[0]["min_ms_process_max"], "1.03")
        with (self.evidence / "summary.json").open() as handle:
            self.assertEqual(len(json.load(handle)), 10)
        with (self.evidence / "profile_summary.csv").open(newline="") as handle:
            profile_rows = list(csv.DictReader(handle))
        self.assertEqual(profile_rows, [{
            "experiment": "matrix-path",
            "implementation": "wmma",
            "dispatch_count": "2",
            "unique_kernel_names": "wmma_kernel",
        }])


if __name__ == "__main__":
    unittest.main()
