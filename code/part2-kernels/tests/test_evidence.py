from __future__ import annotations

import unittest

from common.evidence import parse_result_line, validate_manifest, validate_records


class EvidenceContractTest(unittest.TestCase):
    def test_parse_result_line_preserves_quoted_values(self) -> None:
        record = parse_result_line(
            'RESULT operator=vector-add implementation=hip-v0 runtime=hip '
            'shape="16777216" dtype=float32 correct=OK median_ms=0.333',
            source="runs/hip_run1.log",
        )
        self.assertEqual(record["operator"], "vector-add")
        self.assertEqual(record["source"], "runs/hip_run1.log")
        self.assertEqual(record["shape"], "16777216")

    def test_manifest_reports_every_missing_required_field(self) -> None:
        errors = validate_manifest({"operator": "vector-add"})
        self.assertEqual(
            errors,
            [
                "manifest missing field: generated_at",
                "manifest missing field: git_commit",
                "manifest missing field: source_sha256",
                "manifest missing field: hardware",
                "manifest missing field: software",
                "manifest missing field: platform",
                "manifest missing field: benchmark",
            ],
        )

    def test_record_rejects_unmeasured_or_incorrect_publication_rows(self) -> None:
        errors = validate_records(
            [{"operator": "vector-add", "implementation": "hip-v0", "correct": "FAIL"}]
        )
        self.assertIn("record 0 missing field: runtime", errors)
        self.assertIn("record 0 correctness is not OK", errors)
        self.assertIn("record 0 missing field: median_ms", errors)


if __name__ == "__main__":
    unittest.main()
