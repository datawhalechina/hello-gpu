"""CPU-only exporter checks; all fixture timings below are synthetic."""
import csv
import json
from pathlib import Path
import tempfile
import unittest

from export_walkthrough import archive_outputs, inspect_output, normalize_paths
from inspect_trace import REQUIRED_FIELDS


class WalkthroughExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stage = self.root / "published"
        self.config = self.root / "configs/hip-v0"
        for directory in (self.config / "profile", self.root / "logs", self.root / "samples",
                          self.root / "profiles", self.root / "source", self.stage):
            directory.mkdir(parents=True, exist_ok=True)
        self.manifest = {
            "benchmark": {"shape": 256},
            "profile": {"precheck_dispatches": 1, "warmup": 5, "repeat": 10},
            "configurations": [{"id": "hip-v0", "runtime": "hip", "version": "v0"}],
            "source_sha256": {},
        }
        for process in (1, 2, 3):
            stem = f"n256-hip-v0-p{process}"
            for local, compatible, data in (
                (f"benchmark-p{process}.stdout.log", f"logs/{stem}.log", b"fixture stdout\n"),
                (f"benchmark-p{process}.samples.csv", f"samples/{stem}.csv", b"fixture samples\n"),
            ):
                (self.config / local).write_bytes(data)
                (self.root / compatible).write_bytes(data)
        (self.config / "benchmark-p1.stderr.log").write_bytes(b"")
        (self.config / "profile.stdout.log").write_bytes(b"fixture profile\n")
        (self.root / "logs/profile-hip-v0.log").write_bytes(b"fixture profile\n")
        (self.config / "profile.stderr.log").write_bytes(b"warning: /home/example/run/profile.csv\n")
        self.trace = self.config / "profile/hip-v0_kernel_trace.csv"
        with self.trace.open("w", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=REQUIRED_FIELDS)
            writer.writeheader()
            for index in reversed(range(16)):
                row = dict.fromkeys(REQUIRED_FIELDS, 0)
                row.update(Kernel_Name="vector_add_v0", Start_Timestamp=index * 10000,
                           End_Timestamp=index * 10000 + 1000, Grid_Size_X=256,
                           Grid_Size_Y=1, Grid_Size_Z=1, Workgroup_Size_X=256,
                           Workgroup_Size_Y=1, Workgroup_Size_Z=1)
                writer.writerow(row)
        (self.root / "profiles" / self.trace.name).write_bytes(self.trace.read_bytes())
        (self.config / "inspect.stdout.log").write_bytes(inspect_output(self.trace, "vector_add_v0", 6, 10))
        (self.config / "inspect.stderr.log").write_bytes(b"")
        names = ["compile", "hipcc-version", "rocprofv3-version", "profile-hip-v0", "inspect-hip-v0"]
        names += [f"benchmark-hip-v0-p{process}" for process in (1, 2, 3)]
        self.commands = [{"name": name, "returncode": 0} for name in names]
        # A failed optional desktop-status probe must remain visible, not block export.
        self.commands.append({"name": "gpu-state-before", "returncode": 1})
        self.write_commands()

    def write_commands(self):
        (self.root / "commands.jsonl").write_text(
            "".join(json.dumps(row) + "\n" for row in self.commands))

    def archive(self):
        return archive_outputs(self.root, self.stage, self.manifest,
                               [("/home/example/run", "<experiment-root>")])

    def test_archive_preserves_streams_trace_and_hashes(self):
        records = self.archive()
        self.assertEqual((self.stage / "configs/hip-v0/profile/" / self.trace.name).read_bytes(),
                         self.trace.read_bytes())
        self.assertEqual((self.stage / "configs/hip-v0/benchmark-p1.stderr.log").read_bytes(), b"")
        self.assertEqual((self.stage / "configs/hip-v0/profile.stderr.log").read_text(),
                         "warning: <experiment-root>/profile.csv\n")
        changed = records["configs/hip-v0/profile.stderr.log"]
        self.assertNotEqual(changed["raw_sha256"], changed["published_sha256"])
        self.assertTrue(changed["path_prefixes_replaced"])
        self.assertFalse(records["configs/hip-v0/inspect.stdout.log"]["path_prefixes_replaced"])

    def test_inspector_output_must_match_raw_trace(self):
        (self.config / "inspect.stdout.log").write_text("invented output\n")
        with self.assertRaisesRegex(ValueError, "inspector output differs"):
            self.archive()

    def test_compatibility_file_must_match(self):
        (self.config / "benchmark-p2.stdout.log").write_text("another experiment\n")
        with self.assertRaisesRegex(ValueError, "compatibility file differs"):
            self.archive()

    def test_failed_or_missing_benchmark_command_is_rejected(self):
        self.commands[0]["returncode"] = 1
        self.write_commands()
        with self.assertRaisesRegex(ValueError, "successful captured command: compile"):
            self.archive()

    def test_failed_profile_attempt_is_preserved_with_successful_retry(self):
        failed = self.config / "failed-profile-runtime-registration"
        failed.mkdir()
        (failed / "profile.stderr.log").write_text("registration failure\n")
        self.commands.append({"name": "failed-profile-hip-v0-runtime-registration", "returncode": -6})
        self.write_commands()
        self.archive()
        self.assertEqual((self.stage / "configs/hip-v0/failed-profile-runtime-registration/profile.stderr.log").read_text(),
                         "registration failure\n")

    def test_unmapped_private_path_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unmapped private path"):
            normalize_paths(b"/home/example/run/result 0.123456\n", [])

    def test_prefix_replacement_retains_numbers_and_line_breaks(self):
        original = b"/home/example/run/x.csv\nmedian_ms=0.123456 start=123456789\n"
        self.assertEqual(normalize_paths(original, [("/home/example/run", "<run>")]),
                         b"<run>/x.csv\nmedian_ms=0.123456 start=123456789\n")


if __name__ == "__main__":
    unittest.main()
