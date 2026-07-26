from __future__ import annotations

import csv
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
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


class Chapter2HipSourceContractTest(unittest.TestCase):
    def read_source(self, name: str) -> str:
        path = CHAPTER_DIR / name
        if not path.is_file():
            self.fail(f"missing formal Chapter 2 file: {path.relative_to(ROOT)}")
        return path.read_text()

    def extract_braced(self, text: str, anchor: str) -> str:
        if anchor not in text:
            self.fail(f"missing source block: {anchor!r}")
        anchor_start = text.index(anchor)
        brace_start = text.index("{", anchor_start + len(anchor))
        depth = 0
        for index in range(brace_start, len(text)):
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    return text[brace_start + 1:index]
        self.fail(f"unclosed braced block after {anchor!r}")

    def compact(self, text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    def assert_preallocated_timed_loop(self, text: str):
        benchmark = self.extract_braced(text, "Timing benchmark(")
        timed_loop = self.extract_braced(
            benchmark,
            "for (int iteration = 0; iteration < args.repeat; ++iteration)",
        )
        launch = self.extract_braced(text, "void launch(")
        main = self.extract_braced(text, "int main(")
        selection_loop = main.index(
            "for (const Implementation& implementation : implementations)"
        )

        self.assertIn("hipMalloc", text)
        self.assertIn("hipMemcpy", text)
        self.assertIn("hipEventRecord", timed_loop)
        self.assertIn("launch(", timed_loop)
        for forbidden in ("hipMalloc", "hipFree", "hipMemcpy"):
            self.assertNotIn(forbidden, timed_loop)
            self.assertNotIn(forbidden, launch)
        for setup_call in ("hipMalloc", "hipMemcpy"):
            self.assertGreater(main[:selection_loop].count(setup_call), 0)
            self.assertEqual(main[selection_loop:].count(setup_call), 0)

    def assert_cli_contract(self, text: str):
        parse_args = self.extract_braced(text, "Args parse_args(")
        grid_for = self.extract_braced(text, "unsigned int grid_for(")
        for option in (
            "--implementation", "--size", "--warmup", "--repeat", "--seed",
        ):
            self.assertIn(option, parse_args)
        self.assertIn("std::exit(EXIT_SUCCESS)", parse_args)
        self.assertIn("parse_unsigned", parse_args)
        self.assertIn("parse_integer", parse_args)
        self.assertIn("value.size()", text)
        self.assertIn("std::numeric_limits<unsigned int>::max()", grid_for)
        self.assertIn("std::mt19937_64", text)
        self.assertIn("hip_multiprocessor_count=%d", text)
        self.assertNotIn("compute_units=%d", text)
        self.assertIn(
            "properties.multiProcessorCount, properties.warpSize",
            self.compact(text),
        )

    def assert_single_result_for_single_selection(
        self, text: str, single_return_names: tuple[str, ...]
    ):
        selected = self.extract_braced(text, "selected_implementations(")
        main = self.extract_braced(text, "int main(")
        run = self.extract_braced(text, "bool run_implementation(")
        emit = self.extract_braced(text, "void emit_result(")

        for name in single_return_names:
            self.assertIn(f"return {{{name}}};", selected)
        implementation_loop = self.extract_braced(
            main,
            "for (const Implementation& implementation : implementations)",
        )
        self.assertEqual(implementation_loop.count("run_implementation("), 1)
        self.assertEqual(run.count("emit_result("), 1)
        self.assertEqual(emit.count("std::printf("), 1)

    def test_branch_divergence_source_contract(self):
        branch_text = self.read_source("branch_divergence.hip")
        branch_kernel = self.extract_braced(branch_text, "__global__ void branch_kernel(")
        branch_match = re.search(
            r"if\s*\(take_a\)\s*\{(?P<a>.*?)\}\s*else\s*\{(?P<b>.*?)\}",
            branch_kernel,
            re.DOTALL,
        )

        self.assertIsNotNone(branch_match)
        self.assertIn("hipEventRecord", branch_text)
        self.assertIn("wave-uniform", branch_text)
        self.assertIn("wave-divergent", branch_text)
        self.assertIn("precheck=OK", branch_text)
        self.assertIn(
            self.compact(
                """
                bool take_a = mode == BranchMode::WaveUniform
                    ? (((tid / warpSize) & 1u) == 0u)
                    : ((tid & 1u) == 0u);
                """
            ),
            self.compact(branch_kernel),
        )
        path_a = branch_match.group("a")
        path_b = branch_match.group("b")
        self.assertEqual(path_a.count("value = fmaf(value,"), 4)
        self.assertEqual(path_b.count("value = fmaf(value,"), 4)
        self.assertEqual(path_a.count("fmaf("), path_b.count("fmaf("))
        self.assertNotEqual(self.compact(path_a), self.compact(path_b))
        precheck_size = re.search(
            r"kPrecheckSize\s*=\s*(\d+)", branch_text
        )
        self.assertIsNotNone(precheck_size)
        self.assertEqual(int(precheck_size.group(1)), 257)
        self.assertNotEqual(int(precheck_size.group(1)) % 256, 0)
        self.assertIn(
            "device_precheck_output, kPrecheckSize", self.compact(branch_text)
        )
        self.assert_cli_contract(branch_text)
        self.assert_single_result_for_single_selection(
            branch_text, ("uniform", "divergent")
        )
        self.assert_preallocated_timed_loop(branch_text)

    def test_global_memory_source_contract(self):
        memory_text = self.read_source("global_memory_access.hip")
        gather_copy = self.extract_braced(memory_text, "__global__ void gather_copy(")
        parse_args = self.extract_braced(memory_text, "Args parse_args(")
        bandwidth = self.extract_braced(
            memory_text, "double logical_bandwidth_gbs("
        )

        self.assertIn("stride-1", memory_text)
        self.assertIn("stride-17", memory_text)
        self.assertIn("stride-257", memory_text)
        self.assertIn("postcheck=OK", memory_text)
        self.assertIn("if (!is_power_of_two(args.size))", parse_args)
        self.assertIn(
            "std::size_t source = (tid * Stride) & (n - 1);",
            self.compact(gather_copy),
        )
        self.assertEqual(gather_copy.count("input[source]"), 1)
        self.assertEqual(gather_copy.count("output[tid]"), 1)
        self.assertIn(
            "2.0 * static_cast<double>(n) * sizeof(float)",
            self.compact(bandwidth),
        )
        self.assertIn("/ elapsed_seconds / 1.0e9", self.compact(bandwidth))
        self.assert_cli_contract(memory_text)
        self.assert_single_result_for_single_selection(
            memory_text, ("stride_1", "stride_17", "stride_257")
        )
        self.assert_preallocated_timed_loop(memory_text)


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

    def write_profile(self, *, commit: str = "a" * 40) -> tuple[Path, dict[tuple[str, str], Path]]:
        profile = self.root / "profile"
        profile.mkdir(exist_ok=True)
        (profile / "profile_config.env").write_text(f"source_commit={commit}\n")
        traces = {}
        for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items():
            for implementation in implementations:
                trace = profile / experiment / implementation / f"{implementation}_kernel_trace.csv"
                trace.parent.mkdir(parents=True, exist_ok=True)
                trace.write_text("Kernel_Name,DurationNs\n" f"{implementation}_kernel,100\n")
                traces[(experiment, implementation)] = trace
        return profile, traces

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

    def test_publication_requires_complete_expected_pairs(self):
        for path in (self.log1, self.log2, self.log3):
            self.write_log(path, omit=("matrix-path", "wmma"))
        with self.assertRaisesRegex(ValueError, "complete expected experiment/implementation"):
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
        profile, traces = self.write_profile()
        traces[("matrix-path", "wmma")].write_text(
            "Kernel_Name,DurationNs\nwmma_kernel,100\nwmma_kernel,110\n"
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
        self.assertEqual(len(profile_rows), 10)
        self.assertIn({
            "experiment": "matrix-path",
            "implementation": "wmma",
            "dispatch_count": "2",
            "unique_kernel_names": "wmma_kernel",
        }, profile_rows)

    def test_cli_publishes_with_repeatable_run_logs(self):
        profile, _ = self.write_profile()
        command = [sys.executable, str(CHAPTER_DIR / "result_contract.py")]
        for path in (self.log1, self.log2, self.log3):
            command.extend(("--run-log", str(path)))
        command.extend((
            "--profile-dir", str(profile),
            "--source-commit", "a" * 40,
            "--evidence-dir", str(self.evidence),
        ))

        result = subprocess.run(command, text=True, capture_output=True, check=False)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.evidence / "manifest.json").is_file())

    def test_profile_rejects_missing_expected_pair(self):
        profile, traces = self.write_profile()
        traces[("matrix-path", "wmma")].unlink()
        with self.assertRaisesRegex(ValueError, "complete expected experiment/implementation"):
            self.module.publish(
                [self.log1, self.log2, self.log3], profile, self.evidence, "a" * 40
            )

    def test_profile_rejects_no_dispatch_empty_kernel_and_malformed_table(self):
        cases = {
            "no dispatch": "Kernel_Name,DurationNs\n",
            "empty kernel": "Kernel_Name,DurationNs\n,100\n",
            "malformed table": "Kernel,DurationNs\nwmma_kernel,100\n",
        }
        for expected_error, contents in cases.items():
            with self.subTest(expected_error=expected_error):
                profile, traces = self.write_profile()
                traces[("matrix-path", "wmma")].write_text(contents)
                with self.assertRaisesRegex(ValueError, expected_error):
                    self.module.publish(
                        [self.log1, self.log2, self.log3], profile, self.evidence, "a" * 40
                    )

    def test_failed_second_rename_restores_existing_evidence(self):
        sentinel = self.evidence / "sentinel.txt"
        sentinel.write_text("keep")
        real_replace = os.replace

        def fail_second_replace(source, destination):
            if Path(destination) == self.evidence and ".evidence.tmp-" in Path(source).name:
                raise OSError("simulated second rename failure")
            return real_replace(source, destination)

        with mock.patch.object(self.module.os, "replace", side_effect=fail_second_replace):
            with self.assertRaisesRegex(OSError, "second rename"):
                self.module.publish(
                    [self.log1, self.log2, self.log3], None, self.evidence, "a" * 40
                )

        self.assertEqual(sentinel.read_text(), "keep")
        self.assertFalse((self.root / ".evidence.previous").exists())
        self.assertFalse(list(self.root.glob(".evidence.tmp-*")))

    def test_backup_cleanup_failure_keeps_published_evidence(self):
        sentinel = self.evidence / "sentinel.txt"
        sentinel.write_text("keep")
        real_rmtree = self.module.shutil.rmtree

        def fail_backup_cleanup(path, *args, **kwargs):
            if Path(path).name == ".evidence.previous":
                raise OSError("simulated backup cleanup failure")
            return real_rmtree(path, *args, **kwargs)

        with mock.patch.object(self.module.shutil, "rmtree", side_effect=fail_backup_cleanup):
            self.module.publish(
                [self.log1, self.log2, self.log3], None, self.evidence, "a" * 40
            )

        self.assertTrue((self.evidence / "manifest.json").is_file())
        self.assertEqual((self.root / ".evidence.previous" / "sentinel.txt").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
