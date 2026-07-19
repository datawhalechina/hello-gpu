from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

from tools.plot_chapter import read_summary


class PlotChapterTest(unittest.TestCase):
    def write_summary(self, rows: list[dict[str, str]]) -> Path:
        root = Path(tempfile.mkdtemp())
        path = root / "summary.csv"
        with path.open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        self.addCleanup(lambda: __import__("shutil").rmtree(root))
        return path

    def valid_row(self) -> dict[str, str]:
        return {
            "implementation": "hip-v0",
            "runtime": "hip",
            "correct": "OK",
            "run_count": "3",
            "median_ms": "1.0",
            "median_ms_run_min": "0.9",
            "median_ms_run_max": "1.1",
        }

    def test_accepts_curated_three_process_summary(self) -> None:
        self.assertEqual(read_summary(self.write_summary([self.valid_row()]))[0]["implementation"], "hip-v0")

    def test_rejects_duplicate_or_unpublishable_rows(self) -> None:
        row = self.valid_row()
        with self.assertRaisesRegex(ValueError, "unique"):
            read_summary(self.write_summary([row, row.copy()]))
        row["run_count"] = "2"
        with self.assertRaisesRegex(ValueError, "unpublishable"):
            read_summary(self.write_summary([row]))

    def test_rejects_nonfinite_or_nonpositive_range(self) -> None:
        for invalid in ("nan", "0", "-1"):
            row = self.valid_row()
            row["median_ms_run_max"] = invalid
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "invalid"):
                read_summary(self.write_summary([row]))


if __name__ == "__main__":
    unittest.main()
