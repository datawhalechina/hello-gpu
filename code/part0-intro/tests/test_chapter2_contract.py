from __future__ import annotations

import csv
import importlib.util
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


if __name__ == "__main__":
    unittest.main()
