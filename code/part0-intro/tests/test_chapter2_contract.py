from __future__ import annotations

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


class Chapter2ContractTest(unittest.TestCase):
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
        text = (CHAPTER_DIR / "run_all.sh").read_text()
        for token in ("WARMUP", "REPEAT", "SEED", "RUN_EDGE_CASES", "gfx1201"):
            self.assertIn(token, text)

    def test_profile_is_per_implementation(self):
        text = (CHAPTER_DIR / "profile_all.sh").read_text()
        self.assertIn("profile_config.env", text)
        self.assertIn("source_commit", text)
        self.assertNotIn("--implementation all", text)

    def test_chapter_removes_stale_claims(self):
        text = DOC_PATH.read_text()
        for phrase in FORBIDDEN_CHAPTER_TEXT:
            self.assertNotIn(phrase, text)


if __name__ == "__main__":
    unittest.main()
