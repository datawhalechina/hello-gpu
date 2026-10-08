"""CPU-only rejection tests. All temporary timings below are synthetic fixtures."""

import csv
import json
from pathlib import Path
import tempfile
import unittest

from summarize_rounds import digest, summarize, read_csv


class RoundIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ("source", "build", "samples", "logs"):
            (self.root / name).mkdir()
        (self.root / "source/kernel.fixture").write_text("synthetic source identity")
        (self.root / "build/vector_add_hip").write_text("synthetic binary identity")
        self.manifest = {
            "started_at": "synthetic-fixture",
            "environment": {"gpu": "Fixture GPU", "architecture": "gfx1201",
                            "torch": "fixture", "hip": "fixture", "triton": "fixture+local"},
            "source_sha256": {"kernel.fixture": digest(self.root / "source/kernel.fixture")},
            "build": {"binary_sha256": digest(self.root / "build/vector_add_hip")},
            "benchmark": {"shape": 256, "processes": 3, "dtype": "float32", "warmup": 0,
                          "repeat": 2, "seed": 123, "scope": "gpu-event-single-kernel"},
            "configurations": [{"id": "hip-v0", "runtime": "hip", "version": "v0", "block": 256},
                               {"id": "triton-t0-b256", "runtime": "triton", "version": "t0", "block": 256}],
        }
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))
        for c in self.manifest["configurations"]:
            for process in (1, 2, 3):
                stem = f"n256-{c['id']}-p{process}"
                row = {"config_id": c["id"], "implementation": f"{c['runtime']}-{c['version']}",
                       "runtime": c["runtime"], "shape": 256, "dtype": "float32", "block": 256,
                       "grid": 1, "num_warps": 0 if c["runtime"] == "hip" else 4,
                       "warmup": 0, "repeat": 2, "seed": 123, "process": process}
                rows = [{**row, "sample": i, "ms": value} for i, value in enumerate((1.0, 2.0))]
                self.write_rows(self.root / "samples" / f"{stem}.csv", rows)
                extra = 'arch=gfx1201' if c["runtime"] == "hip" else 'torch=fixture torch_hip=fixture triton=fixture'
                env = f'ENV runtime={c["runtime"]} gpu="Fixture GPU" {extra}\n'
                fields = ' '.join(f'{k}={v}' for k, v in row.items())
                (self.root / "logs" / f"{stem}.log").write_text(
                    env + f'RESULT {fields} correct=OK precheck=OK postcheck=OK median_ms=1.500000\n')

    @staticmethod
    def write_rows(path, rows):
        with path.open("w", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    def run_summary(self):
        return summarize(self.root, self.root / "summary")

    def test_complete_matrix_and_artifact_binding(self):
        self.assertEqual(len(self.run_summary()), 2)
        saved = json.loads((self.root / "summary/manifest.json").read_text())
        self.assertEqual(saved["artifacts_sha256"]["summary.csv"], digest(self.root / "summary/summary.csv"))

    def test_missing_entire_configuration(self):
        for path in (self.root / "samples").glob('*hip-v0*'):
            path.unlink()
        with self.assertRaisesRegex(ValueError, "matrix mismatch"):
            self.run_summary()

    def test_unexpected_file(self):
        (self.root / "samples/unplanned.csv").write_text("fixture")
        with self.assertRaisesRegex(ValueError, "matrix mismatch"):
            self.run_summary()

    def test_consistently_wrong_seed_in_samples_and_log(self):
        path = self.root / "samples/n256-hip-v0-p1.csv"
        rows = read_csv(path)
        for row in rows:
            row["seed"] = "999"
        self.write_rows(path, rows)
        log = self.root / "logs/n256-hip-v0-p1.log"
        log.write_text(log.read_text().replace('seed=123', 'seed=999'))
        with self.assertRaisesRegex(ValueError, "sample/manifest mismatch"):
            self.run_summary()

    def test_wrong_block_under_same_configuration_name(self):
        path = self.root / "samples/n256-hip-v0-p1.csv"
        rows = read_csv(path)
        for row in rows:
            row["block"] = "128"
        self.write_rows(path, rows)
        with self.assertRaisesRegex(ValueError, "sample/manifest mismatch"):
            self.run_summary()

    def test_environment_mismatch(self):
        log = self.root / "logs/n256-hip-v0-p1.log"
        log.write_text(log.read_text().replace('Fixture GPU', 'Another GPU'))
        with self.assertRaisesRegex(ValueError, "ENV/manifest mismatch"):
            self.run_summary()

    def test_snapshot_mutation(self):
        (self.root / "source/kernel.fixture").write_text("changed")
        with self.assertRaisesRegex(ValueError, "source hash mismatch"):
            self.run_summary()

    def test_previously_published_sample_mutation(self):
        self.run_summary()
        path = self.root / "samples/n256-hip-v0-p1.csv"
        path.write_text(path.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, "sample hash changed"):
            self.run_summary()

    def test_duplicate_sample_number(self):
        path = self.root / "samples/n256-hip-v0-p1.csv"
        rows = read_csv(path)
        rows[1]["sample"] = "0"
        self.write_rows(path, rows)
        with self.assertRaisesRegex(ValueError, "duplicate samples"):
            self.run_summary()

    def test_nonfinite_time(self):
        path = self.root / "samples/n256-hip-v0-p1.csv"
        rows = read_csv(path)
        rows[0]["ms"] = "nan"
        self.write_rows(path, rows)
        with self.assertRaisesRegex(ValueError, "nonfinite sample"):
            self.run_summary()

    def test_failed_correctness(self):
        log = self.root / "logs/n256-hip-v0-p1.log"
        log.write_text(log.read_text().replace('postcheck=OK', 'postcheck=FAIL'))
        with self.assertRaisesRegex(ValueError, "failed correctness"):
            self.run_summary()

    def test_failed_profile_does_not_publish_summary(self):
        self.manifest["profile"] = {"precheck_dispatches": 1, "warmup": 0, "repeat": 2}
        (self.root / "manifest.json").write_text(json.dumps(self.manifest))
        with self.assertRaises(FileNotFoundError):
            self.run_summary()
        self.assertFalse((self.root / "summary").exists())


if __name__ == "__main__":
    unittest.main()
