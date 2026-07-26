from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import os
import re
import shlex
import shutil
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

    def test_sequence_diagram_messages_avoid_mermaid_statement_separators(self):
        text = DOC_PATH.read_text()
        mermaid_blocks = re.findall(
            r"```mermaid\s*\n(.*?)\n```",
            text,
            flags=re.DOTALL,
        )
        sequence_blocks = [
            block
            for block in mermaid_blocks
            if block.lstrip().startswith("sequenceDiagram")
        ]
        self.assertTrue(sequence_blocks, "Chapter 2 must retain its EXEC timeline")
        for block in sequence_blocks:
            for line in block.splitlines()[1:]:
                self.assertNotIn(
                    ";",
                    line,
                    "ASCII semicolons terminate Mermaid sequence statements; "
                    "use punctuation that remains inside the message text",
                )

    def test_flowchart_labels_quote_nested_square_brackets(self):
        text = DOC_PATH.read_text()
        mermaid_blocks = re.findall(
            r"```mermaid\s*\n(.*?)\n```",
            text,
            flags=re.DOTALL,
        )
        flowchart_blocks = [
            block
            for block in mermaid_blocks
            if block.lstrip().startswith("flowchart")
        ]
        self.assertTrue(flowchart_blocks, "Chapter 2 must retain its flowcharts")
        unquoted_nested_label = re.compile(
            r"\b[A-Za-z_]\w*\[(?!\")[^\]\n]*\[[^\]\n]*\][^\]\n]*\]"
        )
        invalid_lines = [
            line
            for block in flowchart_blocks
            for line in block.splitlines()[1:]
            if unquoted_nested_label.search(line)
        ]
        self.assertEqual(
            invalid_lines,
            [],
            "Mermaid flowchart labels containing square brackets must be "
            "quoted so GitHub does not parse them as nested node syntax",
        )


class Chapter2HipSourceContractTest(unittest.TestCase):
    def read_source(self, name: str) -> str:
        path = CHAPTER_DIR / name
        if not path.is_file():
            self.fail(f"missing formal Chapter 2 file: {path.relative_to(ROOT)}")
        return path.read_text()

    def splice_cpp_lines(self, text: str) -> str:
        """Apply C++ translation phase 2 for LF and CRLF source lines."""
        spliced: list[str] = []
        index = 0
        while index < len(text):
            if text.startswith("\\\r\n", index):
                index += 3
                continue
            if text.startswith("\\\n", index):
                index += 2
                continue
            spliced.append(text[index])
            index += 1
        return "".join(spliced)

    def clean_cpp(self, text: str) -> str:
        """Splice lines, then blank comments and C++ literal contents."""
        text = self.splice_cpp_lines(text)
        cleaned = list(text)
        length = len(text)

        def blank(start: int, end: int):
            for index in range(start, end):
                if cleaned[index] not in "\r\n":
                    cleaned[index] = " "

        index = 0
        raw_prefixes = ('u8R"', 'uR"', 'UR"', 'LR"', 'R"')
        while index < length:
            if text.startswith("//", index):
                end = text.find("\n", index + 2)
                if end == -1:
                    end = length
                blank(index, end)
                index = end
                continue

            if text.startswith("/*", index):
                close = text.find("*/", index + 2)
                if close == -1:
                    self.fail("unterminated C++ block comment")
                end = close + 2
                blank(index, end)
                index = end
                continue

            raw_prefix = next(
                (
                    prefix
                    for prefix in raw_prefixes
                    if text.startswith(prefix, index)
                ),
                None,
            )
            previous_is_identifier = (
                index > 0
                and (text[index - 1].isalnum() or text[index - 1] == "_")
            )
            if raw_prefix is not None and not previous_is_identifier:
                delimiter_start = index + len(raw_prefix)
                open_paren = text.find("(", delimiter_start)
                delimiter = (
                    text[delimiter_start:open_paren]
                    if open_paren != -1
                    else ""
                )
                invalid_delimiter = (
                    open_paren == -1
                    or len(delimiter) > 16
                    or any(
                        character.isspace()
                        or character in "\\()"
                        for character in delimiter
                    )
                )
                if invalid_delimiter:
                    self.fail("invalid C++ raw-string delimiter")
                terminator = ")" + delimiter + '"'
                close = text.find(terminator, open_paren + 1)
                if close == -1:
                    self.fail("unterminated C++ raw-string literal")
                end = close + len(terminator)
                blank(index, end)
                index = end
                continue

            if text[index] in "\"'":
                quote = text[index]
                end = index + 1
                while end < length:
                    if text[end] == "\\":
                        end += 2
                        continue
                    if text[end] == quote:
                        end += 1
                        break
                    end += 1
                else:
                    self.fail("unterminated C++ quoted literal")
                blank(index, min(end, length))
                index = end
                continue

            index += 1

        return "".join(cleaned)

    def extract_braced(self, text: str, anchor: str) -> str:
        code = self.clean_cpp(text)
        if anchor not in code:
            self.fail(f"missing source block: {anchor!r}")
        anchor_start = code.index(anchor)
        brace_start = code.index("{", anchor_start + len(anchor))
        depth = 0
        for index in range(brace_start, len(code)):
            if code[index] == "{":
                depth += 1
            elif code[index] == "}":
                depth -= 1
                if depth == 0:
                    return code[brace_start + 1:index]
        self.fail(f"unclosed braced block after {anchor!r}")

    def compact(self, text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    def assert_preallocated_timed_loop(self, text: str):
        code = self.clean_cpp(text)
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

        self.assertIn("hipMalloc", code)
        self.assertIn("hipMemcpy", code)
        self.assertIn("hipEventRecord", timed_loop)
        self.assertIn("launch(", timed_loop)
        for forbidden in ("hipMalloc", "hipFree", "hipMemcpy"):
            self.assertNotIn(forbidden, timed_loop)
            self.assertNotIn(forbidden, launch)
        for setup_call in ("hipMalloc", "hipMemcpy"):
            self.assertGreater(main[:selection_loop].count(setup_call), 0)
            self.assertEqual(main[selection_loop:].count(setup_call), 0)

    def assert_cli_contract(self, text: str):
        code = self.clean_cpp(text)
        parse_args = self.extract_braced(text, "Args parse_args(")
        grid_for = self.extract_braced(text, "unsigned int grid_for(")
        for option in (
            "--implementation", "--size", "--warmup", "--repeat", "--seed",
        ):
            self.assertIn(option, text)
        self.assertIn("std::exit(EXIT_SUCCESS)", parse_args)
        self.assertIn("parse_unsigned", parse_args)
        self.assertIn("parse_integer", parse_args)
        self.assertIn("value.size()", code)
        self.assertIn("std::numeric_limits<unsigned int>::max()", grid_for)
        self.assertIn("std::mt19937_64", code)
        self.assertIn("hip_multiprocessor_count=%d", text)
        self.assertNotIn("compute_units=%d", text)
        self.assertIn(
            "properties.multiProcessorCount, properties.warpSize",
            self.compact(code),
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

    def assert_branch_source_contract(self, branch_text: str):
        code = self.clean_cpp(branch_text)
        branch_kernel = self.extract_braced(code, "__global__ void branch_kernel(")
        branch_match = re.search(
            r"if\s*\(take_a\)\s*\{(?P<a>.*?)\}\s*else\s*\{(?P<b>.*?)\}",
            branch_kernel,
            re.DOTALL,
        )

        self.assertIsNotNone(branch_match)
        self.assertIn("hipEventRecord", code)
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
            r"kPrecheckSize\s*=\s*(\d+)", code
        )
        self.assertIsNotNone(precheck_size)
        self.assertEqual(int(precheck_size.group(1)), 257)
        self.assertNotEqual(int(precheck_size.group(1)) % 256, 0)
        self.assertIn(
            "device_precheck_output, kPrecheckSize", self.compact(code)
        )
        self.assert_cli_contract(branch_text)
        self.assert_single_result_for_single_selection(
            branch_text, ("uniform", "divergent")
        )
        self.assert_preallocated_timed_loop(branch_text)

    def assert_global_memory_source_contract(self, memory_text: str):
        code = self.clean_cpp(memory_text)
        gather_copy = self.extract_braced(code, "__global__ void gather_copy(")
        parse_args = self.extract_braced(code, "Args parse_args(")
        bandwidth = self.extract_braced(
            code, "double logical_bandwidth_gbs("
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

    def assert_validation_surrounds_timing(self, text: str):
        run = self.compact(
            self.extract_braced(text, "bool run_implementation(")
        )
        precheck = run.index("validate_precheck(")
        benchmark = run.index("benchmark(")
        postcheck = run.index("validate_samples(")
        self.assertLess(precheck, benchmark)
        self.assertLess(benchmark, postcheck)

    def assert_lds_source_contract(self, lds_text: str):
        code = self.clean_cpp(lds_text)
        kernel = self.extract_braced(code, "__global__ void lds_kernel(")

        self.assertIn("volatile __shared__", code)
        self.assertIn("volatile float* shared_pointer = shared;", kernel)
        self.assertRegex(code, r"kBlockSize\s*=\s*256")
        self.assertRegex(code, r"kWaveSize\s*=\s*32")
        self.assertRegex(code, r"kRegion\s*=\s*1056")
        self.assertIn(
            "kWavesPerBlock = kBlockSize / kWaveSize", self.compact(code)
        )
        self.assertIn(
            "static_assert(kWavesPerBlock == 8", self.compact(code)
        )
        self.assertIn("template <unsigned int Stride>", code)
        self.assertIn(
            "unsigned wave = threadIdx.x / kWaveSize;", self.compact(kernel)
        )
        self.assertIn(
            "unsigned lane = threadIdx.x % kWaveSize;", self.compact(kernel)
        )
        self.assertIn(
            "unsigned index = wave * kRegion + lane * Stride + "
            "(iteration & 31);",
            self.compact(kernel),
        )
        self.assertIn("accumulator += shared_pointer[index];", kernel)
        self.assertIn("launch_stride<1u>", code)
        self.assertIn("launch_stride<32u>", code)
        self.assertIn("launch_stride<33u>", code)
        self.assertEqual(code.count("lds_kernel<"), 1)
        self.assertIn("stride-1", lds_text)
        self.assertIn("stride-32", lds_text)
        self.assertIn("stride-33", lds_text)
        self.assertIn("experiment=lds-banks", lds_text)
        for token in (
            "correct=OK", "correct=FAIL", "precheck=OK", "precheck=FAIL",
            "postcheck=OK", "postcheck=FAIL", "postcheck=NA",
        ):
            self.assertIn(token, lds_text)
        self.assert_cli_contract(lds_text)
        self.assert_single_result_for_single_selection(
            lds_text, ("stride_1", "stride_32", "stride_33")
        )
        self.assert_preallocated_timed_loop(lds_text)
        self.assert_validation_surrounds_timing(lds_text)

    def assert_wmma_source_contract(self, wmma_text: str):
        code = self.clean_cpp(wmma_text)
        valu_kernel = self.extract_braced(
            code, "__global__ void valu_kernel("
        )
        wmma_kernel = self.extract_braced(
            code, "__global__ void wmma_kernel("
        )

        self.assertIn("#if defined(__HIP_DEVICE_COMPILE__)", code)
        self.assertIn("!defined(__gfx1200__)", code)
        self.assertIn("!defined(__gfx1201__)", code)
        self.assertIn("#error rdna4_wmma.hip requires an AMD gfx12 target", code)
        self.assertIn(
            "using Half8 = _Float16 __attribute__((ext_vector_type(8)));",
            self.compact(code),
        )
        self.assertIn(
            "using Float8 = float __attribute__((ext_vector_type(8)));",
            self.compact(code),
        )
        self.assertIn("constexpr int kFragmentElements = 8;", code)
        self.assertIn(
            "const int laneWrapped = threadIdx.x % 16;", wmma_kernel
        )
        self.assertIn(
            "const int laneGroup = threadIdx.x / 16;", wmma_kernel
        )
        self.assertIn(
            "a_frag[ele] = matrix_a[16 * laneWrapped + "
            "(ele + laneGroup * 8)];",
            self.compact(wmma_kernel),
        )
        self.assertIn(
            "b_frag[ele] = matrix_b[16 * "
            "(ele + laneGroup * 8) + laneWrapped];",
            self.compact(wmma_kernel),
        )
        self.assertIn(
            "matrix_c[16 * (ele + laneGroup * 8) + laneWrapped] = "
            "c_frag[ele];",
            self.compact(wmma_kernel),
        )
        intrinsic = (
            "__builtin_amdgcn_wmma_f32_16x16x16_f16_w32_gfx12"
        )
        self.assertEqual(wmma_kernel.count(intrinsic), 1)
        self.assertIn("for (int k = 0; k < 16; ++k)", valu_kernel)
        self.assertIn("matrix_a[row * 16 + k]", valu_kernel)
        self.assertIn("matrix_b[k * 16 + column]", valu_kernel)
        self.assertIn("matrix_c[row * 16 + column]", valu_kernel)
        self.assertRegex(code, r"kPrecheckBatches\s*=\s*[1-9]\d*")
        self.assertIn("make_cpu_reference(", code)
        self.assertIn("validate_precheck(", code)
        self.assertIn("validate_samples(", code)
        self.assertIn("valu", wmma_text)
        self.assertIn("wmma", wmma_text)
        self.assertIn("experiment=matrix-path", wmma_text)
        for token in (
            "correct=OK", "correct=FAIL", "precheck=OK", "precheck=FAIL",
            "postcheck=OK", "postcheck=FAIL", "postcheck=NA",
        ):
            self.assertIn(token, wmma_text)
        self.assert_cli_contract(wmma_text)
        self.assert_single_result_for_single_selection(
            wmma_text, ("valu", "wmma")
        )
        self.assert_preallocated_timed_loop(wmma_text)
        self.assert_validation_surrounds_timing(wmma_text)

    def test_branch_divergence_source_contract(self):
        self.assert_branch_source_contract(
            self.read_source("branch_divergence.hip")
        )

    def test_global_memory_source_contract(self):
        self.assert_global_memory_source_contract(
            self.read_source("global_memory_access.hip")
        )

    def test_lds_bank_conflict_source_contract(self):
        self.assert_lds_source_contract(
            self.read_source("lds_bank_conflict.hip")
        )

    def test_rdna4_wmma_source_contract(self):
        self.assert_wmma_source_contract(
            self.read_source("rdna4_wmma.hip")
        )

    def test_lds_contract_rejects_inactive_decoys_and_corrupt_indexing(self):
        source = self.read_source("lds_bank_conflict.hip")
        required = (
            "unsigned index = wave * kRegion + lane * Stride + "
            "(iteration & 31);"
        )
        self.assertIn(required, self.compact(source))
        corrupt = source.replace(
            "lane * Stride +\n                                 "
            "(iteration & 31)",
            "lane +\n                                 (iteration & 31)",
            1,
        )
        self.assertNotEqual(corrupt, source)
        inactive = (
            "/* Inactive LDS contract decoy:\n"
            + source
            + "\n*/\n"
            + 'const char* string_decoy = "volatile __shared__ stride-32";\n'
            + 'const char* raw_decoy = R"tag(stride-33 lds_kernel<)tag";\n'
        )
        flattened = self.clean_cpp(source).replace("\n", " ")
        spliced = "// Inactive LDS source after line splice: \\\n" + flattened

        for name, decoy in (("literal/comment", inactive), ("spliced", spliced)):
            with self.subTest(name=name):
                with self.assertRaises(AssertionError):
                    self.assert_lds_source_contract(decoy + "\n" + corrupt)

    def test_wmma_contract_rejects_inactive_decoys_and_gfx11_layout(self):
        source = self.read_source("rdna4_wmma.hip")
        required = (
            "a_frag[ele] = matrix_a[16 * laneWrapped + "
            "(ele + laneGroup * 8)];"
        )
        self.assertIn(required, self.compact(source))
        corrupt = source.replace(
            "16 * laneWrapped +\n"
            "                                   (ele + laneGroup * 8)",
            "16 * (ele + laneGroup * 8) +\n"
            "                                   laneWrapped",
            1,
        )
        self.assertNotEqual(corrupt, source)
        inactive = (
            "/* Inactive gfx12 WMMA contract decoy:\n"
            + source
            + "\n*/\n"
            + 'const char* string_decoy = "matrix-path _gfx12";\n'
            + 'const char* raw_decoy = R"tag(laneWrapped laneGroup)tag";\n'
        )
        flattened = self.clean_cpp(source).replace("\n", " ")
        spliced = "// Inactive WMMA source after line splice: \\\n" + flattened

        for name, decoy in (("literal/comment", inactive), ("spliced", spliced)):
            with self.subTest(name=name):
                with self.assertRaises(AssertionError):
                    self.assert_wmma_source_contract(decoy + "\n" + corrupt)

    def test_branch_contract_rejects_commented_decoy_and_corrupt_kernel(self):
        source = self.read_source("branch_divergence.hip")
        kernel_body = self.extract_braced(
            source, "__global__ void branch_kernel("
        )
        self.assertIn(kernel_body, source)
        corrupt = source.replace(
            kernel_body,
            """
    const std::size_t tid =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (tid < n) {
        output[tid] = 0.0f;
    }
""",
            1,
        )
        decoy = (
            "/* Complete but inactive source-contract decoy:\n"
            + source
            + "\n*/\n"
            + 'const char* raw_decoy = R"tag({ } // fake predicate)tag";\n'
        )

        with self.assertRaises(AssertionError):
            self.assert_branch_source_contract(decoy + corrupt)

    def test_memory_contract_rejects_commented_decoys_and_corrupt_code(self):
        source = self.read_source("global_memory_access.hip")
        gather = "        output[tid] = input[source];"
        bandwidth = (
            "return 2.0 * static_cast<double>(n) * sizeof(float) /\n"
            "           elapsed_seconds / 1.0e9;"
        )
        self.assertIn(gather, source)
        self.assertIn(bandwidth, source)
        decoy = (
            "/* Complete but inactive source-contract decoy:\n"
            + source
            + "\n*/\n"
            + 'const char* string_decoy = "{ fake gather and bandwidth }";\n'
        )
        corruptions = {
            "gather writes zero": source.replace(
                gather, "        output[tid] = 0.0f;", 1
            ),
            "bandwidth returns zero": source.replace(
                bandwidth, "return 0.0;", 1
            ),
        }
        for name, corrupt in corruptions.items():
            with self.subTest(name=name):
                with self.assertRaises(AssertionError):
                    self.assert_global_memory_source_contract(decoy + corrupt)

    def test_branch_contract_rejects_spliced_line_comment_decoy(self):
        source = self.read_source("branch_divergence.hip")
        kernel_body = self.extract_braced(
            source, "__global__ void branch_kernel("
        )
        corrupt = source.replace(
            kernel_body,
            """
    const std::size_t tid =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (tid < n) {
        output[tid] = 0.0f;
    }
""",
            1,
        )
        flattened_decoy = self.clean_cpp(source).replace("\n", " ")
        spliced_comment = (
            "// Inactive branch source follows after line splice: \\\n"
            + flattened_decoy
            + "\n"
        )

        with self.assertRaises(AssertionError):
            self.assert_branch_source_contract(spliced_comment + corrupt)

    def test_memory_contract_rejects_spliced_line_comment_decoys(self):
        source = self.read_source("global_memory_access.hip")
        gather = "        output[tid] = input[source];"
        bandwidth = (
            "return 2.0 * static_cast<double>(n) * sizeof(float) /\n"
            "           elapsed_seconds / 1.0e9;"
        )
        flattened_decoy = self.clean_cpp(source).replace("\n", " ")
        spliced_comment = (
            "// Inactive memory source follows after line splice: \\\n"
            + flattened_decoy
            + "\n"
        )
        corruptions = {
            "gather writes zero": source.replace(
                gather, "        output[tid] = 0.0f;", 1
            ),
            "bandwidth returns zero": source.replace(
                bandwidth, "return 0.0;", 1
            ),
        }
        for name, corrupt in corruptions.items():
            with self.subTest(name=name):
                with self.assertRaises(AssertionError):
                    self.assert_global_memory_source_contract(
                        spliced_comment + corrupt
                    )

    def test_extract_braced_honors_spliced_comment_delimiters(self):
        decoys = {
            "line comment LF": (
                "/\\\n/ void target() { line_lf_decoy(); }\n"
            ),
            "line comment CRLF": (
                "/\\\r\n/ void target() { line_crlf_decoy(); }\r\n"
            ),
            "block comment opener": (
                "/\\\n* void target() { block_open_decoy(); } */\n"
            ),
            "block comment closer": (
                "/* void target() { block_close_decoy(); } *\\\r\n/\n"
            ),
        }
        for name, prefix in decoys.items():
            with self.subTest(name=name):
                body = self.extract_braced(
                    prefix + "void target() { real_body(); }\n",
                    "void target()",
                )
                self.assertIn("real_body();", body)

    def test_extract_braced_ignores_comments_and_literal_braces(self):
        decoys = {
            "line comment": "// void target() { line_decoy(); }\n",
            "block comment": "/* void target() { block_decoy(); } */\n",
            "string": 'const char* s = "void target() { string_decoy(); }";\n',
            "raw string": (
                'const char* s = R"tag(void target() { raw_decoy(); })tag";\n'
            ),
        }
        for name, prefix in decoys.items():
            with self.subTest(name=name):
                body = self.extract_braced(
                    prefix + "void target() { real_body(); }\n",
                    "void target()",
                )
                self.assertIn("real_body();", body)

        embedded_literals = """
void target() {
    const char* quoted = "}";
    const char close = '}';
    // }
    /* } */
    const char* raw = R"tag(})tag";
    real_body();
}
"""
        self.assertIn(
            "real_body();",
            self.extract_braced(embedded_literals, "void target()"),
        )


class Chapter2EntrypointTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.tools = self.root / "tools"
        self.tools.mkdir()
        self.tool_log = self.root / "tool.log"
        self.previous_mplconfigdir = os.environ.get("MPLCONFIGDIR")
        os.environ["MPLCONFIGDIR"] = str(self.root / "mplconfig")
        self.write_fake_tools()
        self.environment = os.environ | {
            "PATH": f"{self.tools}:{os.environ['PATH']}",
            "FAKE_TOOL_LOG": str(self.tool_log),
            "SOURCE_COMMIT": "a" * 40,
            "MPLCONFIGDIR": str(self.root / "mplconfig"),
        }

    def tearDown(self):
        if self.previous_mplconfigdir is None:
            os.environ.pop("MPLCONFIGDIR", None)
        else:
            os.environ["MPLCONFIGDIR"] = self.previous_mplconfigdir
        self.tempdir.cleanup()

    def write_fake_tools(self):
        hipcc = self.tools / "hipcc"
        hipcc.write_text(
            """#!/usr/bin/env python3
import os
import pathlib
import shlex
import sys

args = sys.argv[1:]
output = pathlib.Path(args[args.index('-o') + 1])
source = pathlib.Path(next(arg for arg in args if arg.endswith('.hip'))).stem
experiment = {
    'branch_divergence': 'branch-divergence',
    'global_memory_access': 'global-memory',
    'lds_bank_conflict': 'lds-banks',
    'rdna4_wmma': 'matrix-path',
}[source]
with open(os.environ['FAKE_TOOL_LOG'], 'a') as log:
    log.write('hipcc ' + shlex.join(args) + '\\n')
binary = '''#!/usr/bin/env python3
import os
import sys
experiment = {experiment!r}
args = sys.argv[1:]
implementation = args[args.index("--implementation") + 1]
warmup = args[args.index("--warmup") + 1]
repeat = args[args.index("--repeat") + 1]
seed = args[args.index("--seed") + 1]
size = args[args.index("--size") + 1]
with open(os.environ["FAKE_TOOL_LOG"], "a") as log:
    log.write("binary experiment=%s implementation=%s size=%s warmup=%s repeat=%s seed=%s\\\\n" % (experiment, implementation, size, warmup, repeat, seed))
print('ENV runtime=hip gpu="Fake GPU" arch=gfx1201')
print('RESULT experiment=%s implementation=%s runtime=hip shape=N=1 dtype=fp32 warmup=%s repeat=%s seed=%s timed=1 correct=OK precheck=OK postcheck=OK min_ms=1 median_ms=1 mean_ms=1 logical_bandwidth_gbs=1 tflops=1' % (experiment, implementation, warmup, repeat, seed))
'''.format(experiment=experiment)
output.write_text(binary)
output.chmod(0o755)
"""
        )
        rocprof = self.tools / "rocprofv3"
        rocprof.write_text(
            "#!/usr/bin/env python3\n"
            "import os, pathlib, shlex, subprocess, sys\n"
            "args = sys.argv[1:]\n"
            "if args == ['--version']:\n"
            "    print('rocprofv3 fake ROCm 7.13')\n"
            "    raise SystemExit(0)\n"
            "directory = pathlib.Path(args[args.index('--output-directory') + 1])\n"
            "directory.mkdir(parents=True, exist_ok=True)\n"
            "with open(os.environ['FAKE_TOOL_LOG'], 'a') as log: log.write('rocprofv3 ' + shlex.join(args) + '\\n')\n"
            "child = args[args.index('--') + 1:]\n"
            "if os.environ.get('FAKE_RUN_PROFILE_CHILD') == '1' and subprocess.run(child, check=False).returncode != 0: raise SystemExit(1)\n"
            "mode = os.environ.get('FAKE_TRACE_MODE', '')\n"
            "key = directory.name\n"
            "if key != os.environ.get('FAKE_TRACE_KEY', '') or mode != 'missing':\n"
            "    payload = 'Kernel_Name,DurationNs\\nfake,' + os.environ.get('FAKE_TRACE_PAYLOAD', '1') + '\\n'\n"
            "    (directory / 'fake_kernel_trace.csv').write_text('' if key == os.environ.get('FAKE_TRACE_KEY', '') and mode == 'empty' else payload)\n"
        )
        git = self.tools / "git"
        git.write_text(
            "#!/usr/bin/env python3\n"
            "import os, pathlib, sys\n"
            "args = sys.argv[1:]\n"
            "if args[:1] == ['-C']: args = args[2:]\n"
            "if 'rev-parse' in args:\n"
            "    raise SystemExit(1 if os.environ.get('FAKE_GIT_MISSING') else 0)\n"
            "if 'show' in args:\n"
            "    spec = args[-1]\n"
            "    name = spec.rsplit(':', 1)[1].rsplit('/', 1)[1]\n"
            "    data = (pathlib.Path(os.environ['FAKE_GIT_CHAPTER_DIR']) / name).read_bytes()\n"
            "    if os.environ.get('FAKE_GIT_SOURCE_MISMATCH') == name: data += b'changed'\n"
            "    sys.stdout.buffer.write(data)\n"
            "    raise SystemExit(0)\n"
            "raise SystemExit(1)\n"
        )
        objdump = self.tools / "llvm-objdump"
        objdump.write_text(
            "#!/usr/bin/env python3\n"
            "import os\n"
            "target = os.environ.get('FAKE_BINARY_TARGET', 'gfx1201')\n"
            "mode = os.environ.get('FAKE_OBJDUMP_FORMAT', 'bundle')\n"
            "if mode == 'structured': print('arch            ' + target)\n"
            "elif mode == 'multiple': print('hipv4-amdgcn-amd-amdhsa--gfx1201\\narch            gfx9999')\n"
            "elif mode == 'missing': print('no AMDGPU target found')\n"
            "else: print('hipv4-amdgcn-amd-amdhsa--' + target)\n"
        )
        rocminfo = self.tools / "rocminfo"
        rocminfo.write_text(
            "#!/usr/bin/env python3\n"
            "import os\n"
            "print('Agent 1')\n"
            "print('  Name: gfx000')\n"
            "print('  Marketing Name: CPU agent')\n"
            "print('Agent 2')\n"
            "print('  Name: gfx1201')\n"
            "print('  Marketing Name: ' + os.environ.get('FAKE_HARDWARE', 'RX 9070 XT'))\n"
        )
        for tool in (hipcc, rocprof, git, objdump, rocminfo):
            tool.chmod(0o755)

    def run_script(self, name: str, *arguments: str, **environment):
        script = CHAPTER_DIR / name
        if not script.is_file():
            self.fail(f"missing formal Chapter 2 file: {script.relative_to(ROOT)}")
        part_dir = self.root / "part"
        chapter_dir = part_dir / "chapter2"
        chapter_dir.mkdir(parents=True, exist_ok=True)
        activate_objdump = environment.pop("ACTIVATE_OBJDUMP", False)
        activation = "#!/usr/bin/env bash\n"
        if activate_objdump:
            activation_tools = self.root / "activation-tools"
            activation_tools.mkdir(exist_ok=True)
            shutil.copy2(self.tools / "llvm-objdump", activation_tools / "activation-llvm-objdump")
            activation += f"export PATH={shlex.quote(str(activation_tools))}:$PATH\n"
        else:
            activation += ":\n"
        (part_dir / "activate-rocm.sh").write_text(activation)
        for source in (
            name,
            "branch_divergence.hip",
            "global_memory_access.hip",
            "lds_bank_conflict.hip",
            "rdna4_wmma.hip",
        ):
            shutil.copy2(CHAPTER_DIR / source, chapter_dir / source)
        environment = environment | {"FAKE_GIT_CHAPTER_DIR": str(chapter_dir)}
        return subprocess.run(
            ["bash", str(chapter_dir / name), *arguments],
            cwd=chapter_dir,
            text=True,
            capture_output=True,
            check=False,
            env=self.environment | environment,
        )

    def test_entrypoint_shell_syntax_is_valid(self):
        for name in ("run_all.sh", "profile_all.sh"):
            result = subprocess.run(
                ["bash", "-n", str(CHAPTER_DIR / name)],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_run_all_compiles_once_and_skips_edge_results_when_requested(self):
        result = self.run_script("run_all.sh", RUN_EDGE_CASES="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        result_lines = [line for line in result.stdout.splitlines() if line.startswith("RESULT ")]
        self.assertEqual(len(result_lines), 10)
        pairs = {
            tuple(
                token.split("=", 1)[1]
                for token in line.split()
                if token.startswith(("experiment=", "implementation="))
            )
            for line in result_lines
        }
        self.assertEqual(
            pairs,
            {(experiment, implementation)
             for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items()
             for implementation in implementations},
        )
        for line in result_lines:
            fields = dict(token.split("=", 1) for token in line.split()[1:])
            self.assertEqual(
                (fields["warmup"], fields["repeat"], fields["seed"]),
                ("10", "50", "20260726"),
            )
        compiled = [line for line in self.tool_log.read_text().splitlines() if line.startswith("hipcc ")]
        self.assertEqual(len(compiled), 4)
        self.assertEqual(
            {Path(next(arg for arg in shlex.split(line.removeprefix("hipcc ")) if arg.endswith(".hip"))).name for line in compiled},
            {"branch_divergence.hip", "global_memory_access.hip", "lds_bank_conflict.hip", "rdna4_wmma.hip"},
        )
        for line in compiled:
            self.assertIn("--offload-arch=gfx1201", shlex.split(line.removeprefix("hipcc ")))

    def test_default_edge_checks_run_before_formal_output_and_are_discarded(self):
        result = self.run_script("run_all.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            len([line for line in result.stdout.splitlines() if line.startswith("RESULT ")]),
            10,
        )
        executions = [
            line for line in self.tool_log.read_text().splitlines()
            if line.startswith("binary ")
        ]
        self.assertEqual(len(executions), 14)
        edge = [dict(token.split("=", 1) for token in line.split()[1:]) for line in executions[:4]]
        self.assertEqual([fields["implementation"] for fields in edge], ["all", "all", "all", "all"])
        formal = [dict(token.split("=", 1) for token in line.split()[1:]) for line in executions[4:]]
        self.assertEqual(
            [(fields["experiment"], fields["implementation"], fields["size"]) for fields in formal],
            [
                ("branch-divergence", "wave-uniform", "16777216"),
                ("branch-divergence", "wave-divergent", "16777216"),
                ("global-memory", "stride-1", "16777216"),
                ("global-memory", "stride-17", "16777216"),
                ("global-memory", "stride-257", "16777216"),
                ("lds-banks", "stride-1", "16777216"),
                ("lds-banks", "stride-32", "16777216"),
                ("lds-banks", "stride-33", "16777216"),
                ("matrix-path", "valu", "4096"),
                ("matrix-path", "wmma", "4096"),
            ],
        )
        self.assertTrue(all(
            (fields["warmup"], fields["repeat"], fields["seed"]) == ("10", "50", "20260726")
            for fields in formal
        ))

    def test_invalid_source_commit_stops_before_compilation_or_publication(self):
        for invalid in ("a" * 39, "a" * 41, "g" * 40):
            with self.subTest(invalid=invalid):
                self.tool_log.unlink(missing_ok=True)
                profile_dir = self.root / f"invalid-{len(invalid)}"
                run_result = self.run_script("run_all.sh", SOURCE_COMMIT=invalid)
                profile_result = self.run_script(
                    "profile_all.sh", SOURCE_COMMIT=invalid,
                    PROFILE_DIR=str(profile_dir),
                )
                self.assertNotEqual(run_result.returncode, 0)
                self.assertNotEqual(profile_result.returncode, 0)
                self.assertEqual(run_result.stdout, "")
                self.assertEqual(profile_result.stdout, "")
                self.assertFalse(self.tool_log.exists())
                self.assertFalse(profile_dir.exists())

    def test_missing_commit_or_source_mismatch_stops_before_compile(self):
        for name, environment in (
            ("missing commit", {"FAKE_GIT_MISSING": "1"}),
            ("source mismatch", {"FAKE_GIT_SOURCE_MISMATCH": "branch_divergence.hip"}),
        ):
            with self.subTest(name=name):
                self.tool_log.unlink(missing_ok=True)
                for script in ("run_all.sh", "profile_all.sh"):
                    self.tool_log.unlink(missing_ok=True)
                    result = self.run_script(script, **environment)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(self.tool_log.exists())

    def test_invalid_edge_toggle_stops_before_compilation(self):
        self.tool_log.unlink(missing_ok=True)
        result = self.run_script("run_all.sh", RUN_EDGE_CASES="unexpected")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.tool_log.exists())

    def test_profile_runs_one_implementation_per_trace_and_writes_complete_config(self):
        profile_dir = self.root / "profile directory" / "profiles"
        profile_dir.parent.mkdir()
        untrusted_hardware = f"RX 9070 XT; touch {self.root / 'injected'}"
        result = self.run_script(
            "profile_all.sh", PROFILE_DIR=str(profile_dir), FAKE_HARDWARE=untrusted_hardware,
            FAKE_RUN_PROFILE_CHILD="1", FAKE_OBJDUMP_FORMAT="bundle",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = [line for line in self.tool_log.read_text().splitlines() if line.startswith("rocprofv3 ")]
        self.assertEqual(len(commands), 10)
        self.assertEqual(
            len([line for line in self.tool_log.read_text().splitlines() if line.startswith("binary ")]),
            10,
        )
        expected_keys = {
            f"{experiment}__{implementation}"
            for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items()
            for implementation in implementations
        }
        expected_route = {
            ("branch-divergence", "wave-uniform"): ("branch_divergence", "16777216"),
            ("branch-divergence", "wave-divergent"): ("branch_divergence", "16777216"),
            ("global-memory", "stride-1"): ("global_memory_access", "16777216"),
            ("global-memory", "stride-17"): ("global_memory_access", "16777216"),
            ("global-memory", "stride-257"): ("global_memory_access", "16777216"),
            ("lds-banks", "stride-1"): ("lds_bank_conflict", "16777216"),
            ("lds-banks", "stride-32"): ("lds_bank_conflict", "16777216"),
            ("lds-banks", "stride-33"): ("lds_bank_conflict", "16777216"),
            ("matrix-path", "valu"): ("rdna4_wmma", "4096"),
            ("matrix-path", "wmma"): ("rdna4_wmma", "4096"),
        }
        observed_route = {}
        for command in commands:
            args = shlex.split(command.removeprefix("rocprofv3 "))
            self.assertEqual(args[:5], ["--kernel-trace", "--output-format", "csv", "--output-directory", args[4]])
            self.assertEqual(args[5], "--")
            self.assertEqual(args.count("--implementation"), 1)
            profile_key = Path(args[args.index("--output-directory") + 1]).name
            implementation = args[args.index("--implementation") + 1]
            self.assertEqual(profile_key.split("__", 1)[1], implementation)
            expected_binary, expected_size = expected_route[(profile_key.split("__", 1)[0], implementation)]
            self.assertEqual(Path(args[6]).name, expected_binary)
            self.assertEqual(args[-8:], ["--size", args[-7], "--warmup", "1", "--repeat", "1", "--seed", "20260726"])
            self.assertEqual(args[-7], expected_size)
            observed_route[(profile_key.split("__", 1)[0], implementation)] = (Path(args[6]).name, args[-7])
        self.assertEqual(observed_route, expected_route)
        self.assertEqual(
            {
                Path(shlex.split(command.removeprefix("rocprofv3 "))[
                    shlex.split(command.removeprefix("rocprofv3 ")).index("--output-directory") + 1
                ]).name
                for command in commands
            },
            expected_keys,
        )
        self.assertEqual(
            {path.parent.name for path in profile_dir.rglob("*_kernel_trace.csv")},
            expected_keys,
        )
        self.assertTrue(profile_dir.is_symlink())
        self.assertTrue(profile_dir.is_dir())
        compiled = [line for line in self.tool_log.read_text().splitlines() if line.startswith("hipcc ")]
        self.assertEqual(len(compiled), 4)
        config = (profile_dir / "profile_config.env").read_text()
        for line in config.splitlines():
            self.assertRegex(line, r"^[A-Za-z_][A-Za-z0-9_]*=")
        variables = [
            "hardware", "observed_hardware", "rocm_version",
            "binary_branch_divergence_sha256", "binary_global_memory_access_sha256",
            "binary_lds_bank_conflict_sha256", "binary_rdna4_wmma_sha256",
        ]
        for binary in ("branch_divergence", "global_memory_access", "lds_bank_conflict", "rdna4_wmma"):
            variables.extend((f"compile_{binary}_argv", f"compile_{binary}_replay_argv", f"binary_{binary}_target"))
        for (experiment, implementation) in expected_route:
            variable = f"profile_{experiment.replace('-', '_')}_{implementation.replace('-', '_')}"
            variables.extend((f"{variable}_argv", f"{variable}_replay_argv", f"{variable}_binary_sha256"))
        config_check = subprocess.run(
            ["bash", "-c", 'source "$1"; shift; for name; do printf "%s\\0%s\\0" "$name" "${!name}"; done', "bash", str(profile_dir / "profile_config.env"), *variables],
            capture_output=True, check=False, env=self.environment,
        )
        self.assertEqual(config_check.returncode, 0, config_check.stderr.decode())
        values = dict(zip(config_check.stdout.split(b"\0")[0::2], config_check.stdout.split(b"\0")[1::2]))
        values = {key.decode(): value.decode() for key, value in values.items() if key}
        self.assertEqual(values["hardware"], untrusted_hardware)
        self.assertEqual(values["observed_hardware"], untrusted_hardware)
        self.assertFalse((self.root / "injected").exists())
        self.assertIn("--implementation wave-uniform", values["profile_branch_divergence_wave_uniform_argv"])
        for field in ("source_commit", "hardware", "observed_hardware", "gpu_arch", "profile_shapes", "warmup", "repeat", "seed", "rocm_version", "gpu_target"):
            self.assertRegex(config, rf"(?m)^{field}=.+$")
        for binary in ("branch_divergence", "global_memory_access", "lds_bank_conflict", "rdna4_wmma"):
            self.assertRegex(config, rf"(?m)^binary_{binary}_sha256=[0-9a-f]{{64}}$")
            self.assertRegex(config, rf"(?m)^binary_{binary}_target=gfx1201$")
            self.assertRegex(config, rf"(?m)^source_{binary}_sha256=[0-9a-f]{{64}}$")
            actual_compile = shlex.split(values[f"compile_{binary}_argv"])
            replay_compile = shlex.split(values[f"compile_{binary}_replay_argv"])
            self.assertEqual(actual_compile[0], "hipcc")
            self.assertEqual(replay_compile[0], "hipcc")
            self.assertIn("--offload-arch=gfx1201", actual_compile)
            self.assertIn("--offload-arch=gfx1201", replay_compile)
            self.assertEqual(Path(actual_compile[actual_compile.index("-o") + 1]).name, binary)
            self.assertEqual(
                replay_compile[replay_compile.index("-o") + 1],
                str(profile_dir.parent / f".{profile_dir.name}.replay-{binary}"),
            )
            self.assertEqual(values[f"binary_{binary}_target"], "gfx1201")
        for (experiment, implementation), (binary, size) in expected_route.items():
            variable = f"profile_{experiment.replace('-', '_')}_{implementation.replace('-', '_')}"
            actual = shlex.split(values[f"{variable}_argv"])
            replay = shlex.split(values[f"{variable}_replay_argv"])
            self.assertEqual(actual[0], "rocprofv3")
            self.assertEqual(replay[0], "rocprofv3")
            self.assertEqual(Path(actual[actual.index("--") + 1]).name, binary)
            self.assertEqual(
                replay[replay.index("--") + 1],
                str(profile_dir.parent / f".{profile_dir.name}.replay-{binary}"),
            )
            self.assertEqual(actual[actual.index("--size") + 1], size)
            self.assertEqual(replay[replay.index("--size") + 1], size)
            self.assertEqual(values[f"{variable}_binary_sha256"], values[f"binary_{binary}_sha256"])
        self.assertNotIn(".staging.", config)
        self.assertIn("hello-gpu-ch2-profile", config)
        self.assertIn("profile_branch_divergence_wave_uniform_replay_argv=", config)

    def test_profile_trace_failure_preserves_existing_published_pointer(self):
        profile_dir = self.root / "profiles-trace-failures"
        published = self.run_script("profile_all.sh", PROFILE_DIR=str(profile_dir))
        self.assertEqual(published.returncode, 0, published.stderr)
        target_before = profile_dir.resolve()
        config_before = (profile_dir / "profile_config.env").read_bytes()
        for mode in ("missing", "empty"):
            with self.subTest(mode=mode):
                result = self.run_script(
                    "profile_all.sh",
                    PROFILE_DIR=str(profile_dir),
                    FAKE_TRACE_MODE=mode,
                    FAKE_TRACE_KEY="matrix-path__wmma",
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(profile_dir.resolve(), target_before)
                self.assertEqual((profile_dir / "profile_config.env").read_bytes(), config_before)

    def test_hardware_override_must_match_rocminfo_before_compilation(self):
        profile_dir = self.root / "wrong-hardware"
        result = self.run_script(
            "profile_all.sh", PROFILE_DIR=str(profile_dir), HARDWARE="different GPU",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not match rocminfo", result.stderr)
        self.assertFalse(self.tool_log.exists())
        self.assertFalse(profile_dir.exists())

    def test_activation_can_supply_llvm_objdump(self):
        profile_dir = self.root / "activation-objdump"
        result = self.run_script(
            "profile_all.sh", PROFILE_DIR=str(profile_dir), ACTIVATE_OBJDUMP=True,
            LLVM_OBJDUMP="activation-llvm-objdump",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(profile_dir.is_symlink())

    def test_executed_replay_keeps_published_evidence_immutable(self):
        profile_dir = self.root / "replay-immutable"
        published = self.run_script("profile_all.sh", PROFILE_DIR=str(profile_dir))
        self.assertEqual(published.returncode, 0, published.stderr)
        target_before = profile_dir.resolve()
        config_before = (profile_dir / "profile_config.env").read_bytes()
        traces_before = {
            path.relative_to(profile_dir): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in profile_dir.rglob("*_kernel_trace.csv")
        }
        sourced = subprocess.run(
            ["bash", "-c", 'source "$1"; printf "%s\\0%s\\0" "$compile_branch_divergence_replay_argv" "$profile_branch_divergence_wave_uniform_replay_argv"', "bash", str(profile_dir / "profile_config.env")],
            capture_output=True, check=False, env=self.environment,
        )
        self.assertEqual(sourced.returncode, 0, sourced.stderr.decode())
        compile_replay, profile_replay, _ = sourced.stdout.decode().split("\0")
        compiled = subprocess.run(shlex.split(compile_replay), text=True, capture_output=True, check=False, env=self.environment)
        self.assertEqual(compiled.returncode, 0, compiled.stderr)
        replayed = subprocess.run(
            shlex.split(profile_replay), text=True, capture_output=True, check=False,
            env=self.environment | {"FAKE_RUN_PROFILE_CHILD": "1", "FAKE_TRACE_PAYLOAD": "replay"},
        )
        self.assertEqual(replayed.returncode, 0, replayed.stderr)
        traces_after = {
            path.relative_to(profile_dir): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in profile_dir.rglob("*_kernel_trace.csv")
        }
        self.assertEqual(profile_dir.resolve(), target_before)
        self.assertEqual((profile_dir / "profile_config.env").read_bytes(), config_before)
        self.assertEqual(traces_after, traces_before)

    def test_objdump_target_parser_accepts_bundle_and_structured_and_rejects_ambiguity(self):
        for label, environment, should_succeed in (
            ("structured", {"FAKE_OBJDUMP_FORMAT": "structured"}, True),
            ("multiple", {"FAKE_OBJDUMP_FORMAT": "multiple"}, False),
            ("missing", {"FAKE_OBJDUMP_FORMAT": "missing"}, False),
            ("wrong", {"FAKE_BINARY_TARGET": "gfx9999"}, False),
            ("unavailable", {"LLVM_OBJDUMP": "missing-llvm-objdump"}, False),
        ):
            with self.subTest(label=label):
                profile_dir = self.root / f"objdump-{label}"
                result = self.run_script(
                    "profile_all.sh", PROFILE_DIR=str(profile_dir), **environment,
                )
                self.assertEqual(result.returncode == 0, should_succeed, result.stderr)
                if should_succeed:
                    self.assertTrue(profile_dir.is_symlink())
                else:
                    self.assertFalse(profile_dir.exists())
                    if label == "unavailable":
                        self.assertIn("llvm-objdump is unavailable", result.stderr)

    def test_profile_rejects_real_directory_and_advances_symlink_pointer(self):
        real_directory = self.root / "real-profiles"
        real_directory.mkdir()
        sentinel = real_directory / "sentinel.txt"
        sentinel.write_text("keep")
        failed = self.run_script("profile_all.sh", PROFILE_DIR=str(real_directory))
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(sentinel.read_text(), "keep")

        pointer = self.root / "pointer-profiles"
        first = self.run_script("profile_all.sh", PROFILE_DIR=str(pointer))
        self.assertEqual(first.returncode, 0, first.stderr)
        first_target = pointer.resolve()
        second = self.run_script("profile_all.sh", PROFILE_DIR=str(pointer))
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertTrue(pointer.is_symlink(), f"{pointer} -> {pointer.resolve()}")
        self.assertNotEqual(pointer.resolve(), first_target)

    def test_profile_positional_directory_overrides_environment_and_is_atomic(self):
        positional = self.root / "positional-profiles"
        conflicting = self.root / "environment-profiles"
        default = self.root / "part" / "chapter2" / "profiles"
        result = self.run_script(
            "profile_all.sh", str(positional), PROFILE_DIR=str(conflicting),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(positional.is_symlink())
        self.assertEqual(
            {path.parent.name for path in positional.rglob("*_kernel_trace.csv")},
            {
                f"{experiment}__{implementation}"
                for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items()
                for implementation in implementations
            },
        )
        self.assertFalse(conflicting.exists())
        self.assertFalse(default.exists())

    def test_profile_rejects_extra_positionals_before_compilation_or_publication(self):
        positional = self.root / "positional-profiles"
        conflicting = self.root / "environment-profiles"
        default = self.root / "part" / "chapter2" / "profiles"
        self.tool_log.unlink(missing_ok=True)
        result = self.run_script(
            "profile_all.sh", str(positional), "unexpected", PROFILE_DIR=str(conflicting),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Usage:", result.stderr)
        self.assertFalse(self.tool_log.exists())
        self.assertFalse(positional.exists())
        self.assertFalse(conflicting.exists())
        self.assertFalse(default.exists())

    def write_summary(self, path: Path, *, omit=None, duplicate=False, correct="OK", median="1", updates=None, update_pair=None):
        fieldnames = [
            "experiment", "implementation", "correct", "precheck", "postcheck",
            "run_count",
            "median_ms", "median_ms_process_min", "median_ms_process_max",
            "logical_bandwidth_gbs", "logical_bandwidth_gbs_process_min",
            "logical_bandwidth_gbs_process_max", "tflops", "tflops_process_min",
            "tflops_process_max",
        ]
        rows = []
        for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items():
            for implementation in sorted(implementations):
                if (experiment, implementation) == omit:
                    continue
                is_global = experiment == "global-memory"
                is_matrix = experiment == "matrix-path"
                rows.append({
                    "experiment": experiment, "implementation": implementation,
                    "correct": correct, "precheck": "OK", "postcheck": "OK",
                    "run_count": "3",
                    "median_ms": median, "median_ms_process_min": "0.9",
                    "median_ms_process_max": "1.1", "logical_bandwidth_gbs": "100" if is_global else "0",
                    "logical_bandwidth_gbs_process_min": "90" if is_global else "0",
                    "logical_bandwidth_gbs_process_max": "110" if is_global else "0", "tflops": "10" if is_matrix else "0",
                    "tflops_process_min": "9" if is_matrix else "0", "tflops_process_max": "11" if is_matrix else "0",
                })
        if updates:
            next(row for row in rows if update_pair is None or (
                row["experiment"], row["implementation"]
            ) == update_pair).update(updates)
        if duplicate:
            rows.append(rows[0].copy())
        with path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    def assert_plot_rejected(self, **kwargs):
        summary = self.root / "summary.csv"
        self.write_summary(summary, **kwargs)
        path = CHAPTER_DIR / "plot_results.py"
        spec = importlib.util.spec_from_file_location("chapter2_plot_contract", path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaises(ValueError):
            module.read_summary(summary)

    def test_plot_rejects_duplicate_missing_non_ok_and_malformed_rows(self):
        with self.subTest("duplicate"):
            self.assert_plot_rejected(duplicate=True)
        with self.subTest("missing"):
            self.assert_plot_rejected(omit=("matrix-path", "wmma"))
        with self.subTest("non-OK"):
            self.assert_plot_rejected(correct="FAIL")
        with self.subTest("failed precheck"):
            self.assert_plot_rejected(updates={"precheck": "FAIL"})
        with self.subTest("failed postcheck"):
            self.assert_plot_rejected(updates={"postcheck": "FAIL"})
        with self.subTest("non-positive timing"):
            self.assert_plot_rejected(median="0")
        with self.subTest("non-positive bandwidth"):
            self.assert_plot_rejected(
                updates={"logical_bandwidth_gbs": "0"},
                update_pair=("global-memory", "stride-1"),
            )
        with self.subTest("non-positive tflops"):
            self.assert_plot_rejected(
                updates={"tflops": "0"},
                update_pair=("matrix-path", "valu"),
            )
        with self.subTest("non-finite process value"):
            self.assert_plot_rejected(updates={"median_ms_process_max": "nan"})
        with self.subTest("minimum exceeds median"):
            self.assert_plot_rejected(updates={"median_ms_process_min": "2"})
        with self.subTest("maximum below median"):
            self.assert_plot_rejected(updates={"median_ms_process_max": "0.5"})

    def test_plot_creates_deterministic_headless_png(self):
        if importlib.util.find_spec("matplotlib") is None:
            self.skipTest("matplotlib is unavailable in the current interpreter")
        summary = self.root / "summary.csv"
        first = self.root / "first.png"
        second = self.root / "second.png"
        self.write_summary(summary)
        for output in (first, second):
            result = subprocess.run(
                [sys.executable, str(CHAPTER_DIR / "plot_results.py"),
                 "--summary", str(summary), "--output", str(output)],
                text=True, capture_output=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(output.is_file())
            self.assertGreater(output.stat().st_size, 0)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        path = CHAPTER_DIR / "plot_results.py"
        spec = importlib.util.spec_from_file_location("chapter2_plot_results", path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        figure = module.build_figure(module.read_summary(summary))
        self.assertEqual(len(figure.axes), 4)
        for axis in figure.axes:
            self.assertIn("RX 9070 XT · 3 independent processes", axis.get_title())
            self.assertGreaterEqual(len(axis.containers), 2)
        self.assertEqual(figure.axes[0].get_yscale(), "symlog")
        self.assertEqual(figure.axes[1].get_yscale(), "log")
        self.assertEqual(figure.axes[2].get_yscale(), "symlog")
        self.assertEqual(figure.axes[3].get_yscale(), "log")
        module.pyplot().close(figure)


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

    def write_rocprof_profile(
        self, *, commit: str = "a" * 40
    ) -> tuple[Path, dict[tuple[str, str], Path]]:
        profile = self.root / "rocprof-profile"
        profile.mkdir(exist_ok=True)
        (profile / "profile_config.env").write_text(f"source_commit={commit}\n")
        traces = {}
        pid = 4100
        for experiment, implementations in EXPECTED_IMPLEMENTATIONS.items():
            for implementation in sorted(implementations):
                trace = (
                    profile
                    / f"{experiment}__{implementation}"
                    / "rx9070xt-host"
                    / f"{pid}_kernel_trace.csv"
                )
                trace.parent.mkdir(parents=True)
                trace.write_text(
                    "Kernel_Name,DurationNs\n"
                    f"{implementation}_kernel,100\n"
                )
                traces[(experiment, implementation)] = trace
                pid += 1
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

        manifest_path = self.evidence / "manifest.json"
        manifest_text = manifest_path.read_text()
        manifest = json.loads(manifest_text)
        self.assertEqual(manifest["source_commit"], "a" * 40)
        self.assertEqual(
            manifest["run_logs"],
            [
                {
                    "name": path.name,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
                for path in (self.log1, self.log2, self.log3)
            ],
        )
        self.assertEqual(
            manifest["profile_config"],
            {
                "name": "profile_config.env",
                "sha256": hashlib.sha256(
                    (profile / "profile_config.env").read_bytes()
                ).hexdigest(),
            },
        )
        self.assertNotIn(str(self.root), manifest_text)
        for artifact in manifest["run_logs"] + [manifest["profile_config"]]:
            self.assertRegex(artifact["sha256"], r"^[0-9a-f]{64}$")
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
        self.assertNotIn(b"\r\n", (self.evidence / "summary.csv").read_bytes())
        self.assertNotIn(
            b"\r\n", (self.evidence / "profile_summary.csv").read_bytes()
        )
        self.assertIn({
            "experiment": "matrix-path",
            "implementation": "wmma",
            "dispatch_count": "2",
            "unique_kernel_names": "wmma_kernel",
        }, profile_rows)

    def test_publication_rejects_duplicate_run_log_basenames(self):
        first = self.root / "process-a" / "run.log"
        second = self.root / "process-b" / "run.log"
        first.parent.mkdir()
        second.parent.mkdir()
        self.write_log(first, process=1)
        self.write_log(second, process=2)
        sentinel = self.evidence / "sentinel.txt"
        sentinel.write_text("keep")

        with self.assertRaisesRegex(ValueError, "duplicate run-log basename"):
            self.module.publish(
                [first, second, self.log3],
                None,
                self.evidence,
                "a" * 40,
            )

        self.assertEqual(sentinel.read_text(), "keep")

    def test_cli_publishes_with_repeatable_run_logs(self):
        profile, _ = self.write_rocprof_profile()
        profile_pointer = self.root / "profile-pointer"
        profile_pointer.symlink_to(profile, target_is_directory=True)
        command = [sys.executable, str(CHAPTER_DIR / "result_contract.py")]
        for path in (self.log1, self.log2, self.log3):
            command.extend(("--run-log", str(path)))
        command.extend((
            "--profile-dir", str(profile_pointer),
            "--source-commit", "a" * 40,
            "--evidence-dir", str(self.evidence),
        ))

        result = subprocess.run(command, text=True, capture_output=True, check=False)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.evidence / "manifest.json").is_file())

    def test_profile_rejects_conflicting_canonical_path_and_filename_identity(self):
        profile, traces = self.write_rocprof_profile()
        trace = traces[("branch-divergence", "wave-uniform")]
        conflicting = trace.with_name("matrix-path__wmma_kernel_trace.csv")
        trace.rename(conflicting)

        with self.assertRaisesRegex(ValueError, "conflicting profile identity"):
            self.module._profile_pair(conflicting, profile)

    def test_profile_rejects_false_and_ambiguous_top_level_filename_labels(self):
        profile = self.root / "profile-labels"
        profile.mkdir()
        for filename in (
            "not-wmma_kernel_trace.csv",
            "stride-1_kernel_trace.csv",
        ):
            with self.subTest(filename=filename):
                trace = profile / filename
                trace.write_text("Kernel_Name\nkernel\n")
                with self.assertRaisesRegex(ValueError, "unique profile identity"):
                    self.module._profile_pair(trace, profile)

    def test_canonical_profile_ignores_hostname_identity_labels(self):
        profile = self.root / "hostname-profile"
        trace = (
            profile
            / "branch-divergence__wave-uniform"
            / "matrix-path"
            / "4100_kernel_trace.csv"
        )
        trace.parent.mkdir(parents=True)
        trace.write_text("Kernel_Name\nkernel\n")

        self.assertEqual(
            self.module._profile_pair(trace, profile),
            ("branch-divergence", "wave-uniform"),
        )

    def test_profile_rejects_canonical_key_below_first_component(self):
        profile = self.root / "untrusted-profile"
        trace = (
            profile
            / "untrusted-host"
            / "matrix-path__wmma"
            / "4100_kernel_trace.csv"
        )
        trace.parent.mkdir(parents=True)
        trace.write_text("Kernel_Name\nkernel\n")

        with self.assertRaisesRegex(ValueError, "unique profile identity"):
            self.module._profile_pair(trace, profile)

    def test_profile_pair_rejects_lexical_parent_component(self):
        profile = self.root / "parent-profile"
        trace = (
            profile
            / "matrix-path__wmma"
            / "host"
            / ".."
            / "host"
            / "4100_kernel_trace.csv"
        )

        with self.assertRaisesRegex(ValueError, r"lexical.*\.\."):
            self.module._profile_pair(trace, profile)

    def test_profile_summary_rejects_internal_symlink_to_external_trace(self):
        profile, traces = self.write_rocprof_profile()
        external = self.root / "external_kernel_trace.csv"
        external.write_text("Kernel_Name\noutside_kernel\n")
        trace = traces[("matrix-path", "wmma")]
        trace.unlink()
        trace.symlink_to(external)

        with self.assertRaisesRegex(ValueError, "outside resolved profile root"):
            self.module._profile_summary(profile, "a" * 40)

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
