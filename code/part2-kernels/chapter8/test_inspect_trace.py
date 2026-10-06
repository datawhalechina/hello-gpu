"""CPU checks for trace selection, statistics and refusal of invalid evidence."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest

from inspect_trace import REQUIRED_FIELDS, TraceError, analyze_trace, main


def row(index: int, name: str = "vector_add_v0(float*, float*)") -> dict:
    return dict(zip(REQUIRED_FIELDS, (
        name, 100000 + index * 20000, 100000 + index * 20000 + (index + 1) * 1000,
        1024, 8, 2, 256, 2, 1, 8, 128, 0, 0,
    )))


class InspectTraceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "kernel_trace.csv"
        self.rows = [row(i) for i in range(16)]

    def write(self, rows=None, fields=REQUIRED_FIELDS) -> None:
        with self.path.open("w", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(self.rows if rows is None else rows)

    def test_sort_filter_exact_window_and_xyz(self) -> None:
        self.write(list(reversed(self.rows)) + [row(0, "fill_output")])
        result = analyze_trace(self.path, "vector_add_v0", 6, 10)
        self.assertEqual((result["csv_rows"], result["target_rows"], result["kept_rows"]), (17, 16, 10))
        self.assertEqual(result["first_kept"], {"start_ns": 220000, "end_ns": 227000, "duration_ns": 7000})
        self.assertEqual(result["kernel_time_us"], {"min": 7.0, "median": 11.5, "max": 16.0})
        self.assertEqual(result["launch"]["workgroups_xyz"], [4, 4, 2])
        self.assertEqual(result["launch"]["workgroups_total"], 32)
        self.assertEqual(result["resources"]["lds_bytes"], 0)

    def test_missing_column_is_not_zero(self) -> None:
        self.write(fields=tuple(field for field in REQUIRED_FIELDS if field != "Scratch_Size"))
        with self.assertRaisesRegex(TraceError, "missing required columns: Scratch_Size"):
            analyze_trace(self.path, "vector_add_v0", 6, 10)

    def test_invalid_numeric_fields_and_interval(self) -> None:
        for field, value, message in (
            ("Start_Timestamp", "1.5", "non-negative integer"),
            ("VGPR_Count", "NA", "non-negative integer"),
            ("SGPR_Count", "", "non-negative integer"),
            ("LDS_Block_Size", "-1", "non-negative integer"),
            ("End_Timestamp", 99999, "earlier than"),
            ("Grid_Size_Y", 7, "positive multiple"),
            ("Workgroup_Size_Z", 0, "positive multiple"),
        ):
            with self.subTest(field=field, value=value):
                rows = [dict(item) for item in self.rows]
                rows[0][field] = value
                self.write(rows)
                with self.assertRaisesRegex(TraceError, message):
                    analyze_trace(self.path, "vector_add_v0", 6, 10)

    def test_target_count_cannot_be_silently_truncated(self) -> None:
        for rows in (self.rows[:-1], self.rows + [row(16)]):
            with self.subTest(count=len(rows)):
                self.write(rows)
                with self.assertRaisesRegex(TraceError, "expected exactly skip \\+ take = 16"):
                    analyze_trace(self.path, "vector_add_v0", 6, 10)

    def test_no_match_or_multiple_exact_names(self) -> None:
        self.write()
        with self.assertRaisesRegex(TraceError, "no kernel names"):
            analyze_trace(self.path, "missing", 6, 10)
        self.write(self.rows + [row(0, "vector_add_v1(float*, float*)")])
        with self.assertRaisesRegex(TraceError, "exactly one distinct Kernel_Name"):
            analyze_trace(self.path, "vector_add", 6, 10)

    def test_changed_launch_or_resources_including_skipped_rows(self) -> None:
        for index, field, value in ((0, "VGPR_Count", 16), (7, "Grid_Size_X", 2048),
                                    (8, "Scratch_Size", 64), (9, "Workgroup_Size_Y", 1)):
            with self.subTest(index=index, field=field):
                rows = [dict(item) for item in self.rows]
                rows[index][field] = value
                self.write(rows)
                with self.assertRaisesRegex(TraceError, "different launch/resource fields: " + field):
                    analyze_trace(self.path, "vector_add_v0", 6, 10)

    def test_duplicate_header_and_malformed_row(self) -> None:
        self.write(fields=(*REQUIRED_FIELDS, "Scratch_Size"))
        with self.assertRaisesRegex(TraceError, "duplicate column"):
            analyze_trace(self.path, "vector_add_v0", 6, 10)
        self.write()
        with self.path.open("a") as file:
            file.write("incomplete,row\n")
        with self.assertRaisesRegex(TraceError, "row width"):
            analyze_trace(self.path, "vector_add_v0", 6, 10)

    def test_invalid_selection_arguments(self) -> None:
        self.write()
        for kernel, skip, take in (("", 6, 10), ("  ", 6, 10),
                                   ("vector_add_v0", -1, 10), ("vector_add_v0", 6, 0)):
            with self.subTest(kernel=kernel, skip=skip, take=take), self.assertRaises(TraceError):
                analyze_trace(self.path, kernel, skip, take)

    def test_cli_json_and_clear_error(self) -> None:
        self.write()
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(main([str(self.path), "--kernel", "vector_add_v0", "--skip", "6", "--take", "10", "--json"]), 0)
        self.assertEqual(json.loads(output.getvalue())["kept_rows"], 10)
        error = io.StringIO()
        with redirect_stderr(error), self.assertRaises(SystemExit) as caught:
            main([str(self.path), "--kernel", "vector_add_v0", "--skip", "6", "--take", "11"])
        self.assertEqual(caught.exception.code, 2)
        self.assertIn("expected exactly skip + take = 17 target rows, found 16", error.getvalue())


if __name__ == "__main__":
    unittest.main()
