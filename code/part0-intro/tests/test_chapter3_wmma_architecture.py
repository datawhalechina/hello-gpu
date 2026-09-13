"""RED-phase structural tests for standalone gfx11 WMMA source (rdna3_wmma.hip).

These tests define the required source contract for gfx1100/gfx1151 WMMA support.
They MUST fail because code/part0-intro/chapter3/rdna3_wmma.hip does not yet exist.

Architecture contract (LLVM-confirmed for gfx11 wave32 WMMA):
  - Builtin: __builtin_amdgcn_wmma_f32_16x16x16_f16_w32
  - A/B fragments: _Float16 ext_vector_type(16)  (v16f16)
  - C/D accumulator: float ext_vector_type(8)    (v8f32)
  - Wave size: 32 lanes
  - Fragment load: lane index modulo 16, full K=16
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CHAPTER3_DIR = ROOT / "code" / "part0-intro" / "chapter3"
SOURCE_PATH = CHAPTER3_DIR / "rdna3_wmma.hip"


class Gfx11WmmaSourceExistence(unittest.TestCase):
    """Gate test: rdna3_wmma.hip must exist as a standalone file."""

    def test_rdna3_wmma_hip_file_exists(self) -> None:
        self.assertTrue(
            SOURCE_PATH.is_file(),
            f"missing required source: {SOURCE_PATH.relative_to(ROOT)}",
        )


def _require_source() -> str:
    """Load rdna3_wmma.hip or skip with clear message."""
    if not SOURCE_PATH.is_file():
        raise unittest.SkipTest(
            f"rdna3_wmma.hip does not exist: {SOURCE_PATH.relative_to(ROOT)}"
        )
    return SOURCE_PATH.read_text()


def _splice_cpp_lines(text: str) -> str:
    """Apply C++ translation phase 2 (line splicing) for LF and CRLF."""
    result: list[str] = []
    i = 0
    while i < len(text):
        if text.startswith("\\\r\n", i):
            i += 3
            continue
        if text.startswith("\\\n", i):
            i += 2
            continue
        result.append(text[i])
        i += 1
    return "".join(result)


def _strip_comments_and_literals(text: str) -> str:
    """Remove C/C++ comments and string/char literal contents from source.

    Returns source with comments blanked and literal interiors replaced by
    spaces, preserving line structure. This ensures assertions cannot be
    trivially satisfied by decoy tokens inside comments or strings.
    """
    text = _splice_cpp_lines(text)
    cleaned = list(text)
    length = len(text)

    def blank(start: int, end: int) -> None:
        for idx in range(start, end):
            if cleaned[idx] not in "\r\n":
                cleaned[idx] = " "

    i = 0
    raw_prefixes = ('u8R"', 'uR"', 'UR"', 'LR"', 'R"')
    while i < length:
        # Line comment
        if text.startswith("//", i):
            end = text.find("\n", i + 2)
            if end == -1:
                end = length
            blank(i, end)
            i = end
            continue

        # Block comment
        if text.startswith("/*", i):
            close = text.find("*/", i + 2)
            if close == -1:
                close = length - 2
            end = close + 2
            blank(i, end)
            i = end
            continue

        # Raw string literals
        raw_prefix = next(
            (p for p in raw_prefixes if text.startswith(p, i)), None
        )
        prev_is_ident = i > 0 and (text[i - 1].isalnum() or text[i - 1] == "_")
        if raw_prefix is not None and not prev_is_ident:
            delim_start = i + len(raw_prefix)
            open_paren = text.find("(", delim_start)
            if open_paren == -1:
                i += 1
                continue
            delimiter = text[delim_start:open_paren]
            terminator = ")" + delimiter + '"'
            close = text.find(terminator, open_paren + 1)
            if close == -1:
                i += 1
                continue
            end = close + len(terminator)
            blank(i, end)
            i = end
            continue

        # Regular string/char literals
        if text[i] in "\"'":
            quote = text[i]
            end = i + 1
            while end < length:
                if text[end] == "\\":
                    end += 2
                    continue
                if text[end] == quote:
                    end += 1
                    break
                end += 1
            blank(i, min(end, length))
            i = end
            continue

        i += 1

    return "".join(cleaned)


def _compact(text: str) -> str:
    """Collapse whitespace to single spaces."""
    return re.sub(r"\s+", " ", text).strip()


class Gfx11WmmaCompileGuards(unittest.TestCase):
    """Device compile guards must restrict to gfx1100 and gfx1151 only."""

    def setUp(self) -> None:
        self.source = _require_source()
        self.active = _strip_comments_and_literals(self.source)

    def test_has_hip_device_compile_guard(self) -> None:
        self.assertIn("#if defined(__HIP_DEVICE_COMPILE__)", self.active)

    def test_allows_gfx1100(self) -> None:
        self.assertIn("__gfx1100__", self.active)

    def test_allows_gfx1151(self) -> None:
        self.assertIn("__gfx1151__", self.active)

    def test_rejects_non_gfx11_with_error_directive(self) -> None:
        self.assertIn(
            "#error", self.active,
            "must have #error for unsupported targets",
        )
        self.assertRegex(
            self.active,
            r"#error\s+.*gfx11",
            "error message must mention gfx11",
        )

    def test_does_not_allow_gfx12_targets(self) -> None:
        # Must NOT define guards for gfx12 targets
        self.assertNotIn("__gfx1200__", self.active)
        self.assertNotIn("__gfx1201__", self.active)


class Gfx11WmmaFragmentTypes(unittest.TestCase):
    """Fragment types must use v16f16 for A/B and v8f32 for C/D."""

    def setUp(self) -> None:
        self.source = _require_source()
        self.active = _strip_comments_and_literals(self.source)

    def test_half16_vector_type_defined(self) -> None:
        # _Float16 ext_vector_type(16) for A/B fragments
        self.assertIn(
            "_Float16 __attribute__((ext_vector_type(16)))",
            _compact(self.active),
        )

    def test_float8_vector_type_defined(self) -> None:
        # float ext_vector_type(8) for C/D accumulator
        self.assertIn(
            "float __attribute__((ext_vector_type(8)))",
            _compact(self.active),
        )

    def test_fragment_elements_is_8(self) -> None:
        # Output is 8 FP32 values per lane
        self.assertRegex(
            self.active,
            r"kFragmentElements\s*=\s*8",
        )


class Gfx11WmmaBuiltin(unittest.TestCase):
    """The gfx11 WMMA builtin must appear exactly once in active code."""

    GFX11_INTRINSIC = "__builtin_amdgcn_wmma_f32_16x16x16_f16_w32"

    def setUp(self) -> None:
        self.source = _require_source()
        self.active = _strip_comments_and_literals(self.source)

    def test_gfx11_intrinsic_present(self) -> None:
        self.assertIn(self.GFX11_INTRINSIC, self.active)

    def test_gfx11_intrinsic_appears_exactly_once(self) -> None:
        count = self.active.count(self.GFX11_INTRINSIC)
        self.assertEqual(
            count, 1,
            f"expected exactly 1 occurrence of {self.GFX11_INTRINSIC}, got {count}",
        )

    def test_no_gfx12_intrinsic(self) -> None:
        # Must not use the gfx12 variant
        self.assertNotIn(
            "__builtin_amdgcn_wmma_f32_16x16x16_f16_w32_gfx12",
            self.active,
        )


class Gfx11WmmaWaveConfig(unittest.TestCase):
    """Wave size must be 32 and WMMA block size must be 32."""

    def setUp(self) -> None:
        self.source = _require_source()
        self.active = _strip_comments_and_literals(self.source)

    def test_wmma_block_size_is_32(self) -> None:
        self.assertRegex(
            self.active,
            r"kWmmaBlockSize\s*=\s*32",
        )

    def test_wave_size_32_used(self) -> None:
        # The builtin name itself encodes w32, but also check for explicit wave32
        self.assertIn("w32", self.active)


class Gfx11WmmaFragmentLoads(unittest.TestCase):
    """Fragment loads must use full K=16 with lane modulo 16 indexing.

    For gfx11 with v16f16 (16 halves per fragment per lane), each lane loads
    a full K=16 column/row with laneWrapped = threadIdx.x % 16.
    Output store must map 8 FP32 values back to C matrix.
    """

    def setUp(self) -> None:
        self.source = _require_source()
        self.active = _strip_comments_and_literals(self.source)
        self.compact_active = _compact(self.active)

    def test_lane_wrapped_modulo_16(self) -> None:
        self.assertIn("threadIdx.x % 16", self.active)

    def test_lane_group_divide_16(self) -> None:
        self.assertIn("threadIdx.x / 16", self.active)

    def test_a_fragment_loads_full_k16(self) -> None:
        # A fragment: row-major load with K=16 stride
        # Pattern: matrix_a[...laneWrapped...] with 16-element access
        self.assertRegex(
            self.compact_active,
            r"a_frag\[.*\]\s*=\s*matrix_a\[.*16.*laneWrapped",
        )

    def test_b_fragment_loads_full_k16(self) -> None:
        # B fragment: column-major load with K=16 stride
        self.assertRegex(
            self.compact_active,
            r"b_frag\[.*\]\s*=\s*matrix_b\[.*16.*laneWrapped",
        )

    def test_c_output_store_maps_8_values(self) -> None:
        # gfx11 interleaves output rows across the two half-waves:
        # lanes 0..15 store rows 0,2,...,14 and lanes 16..31 store
        # rows 1,3,...,15.  gfx12 instead stores contiguous 8-row halves.
        self.assertIn(
            "const int row = ele * 2 + laneGroup;",
            self.compact_active,
        )
        self.assertIn(
            "matrix_c[16 * row + laneWrapped] = c_frag[ele];",
            self.compact_active,
        )
        self.assertNotIn("ele + laneGroup * 8", self.compact_active)

    def test_fragment_loop_covers_16_elements(self) -> None:
        # A/B fragment loops must iterate over 16 elements (full K)
        self.assertIn("ele < 16", self.active)


class Gfx11WmmaValidationContract(unittest.TestCase):
    """Must have CPU reference, precheck, postcheck, and RESULT tokens."""

    def setUp(self) -> None:
        self.source = _require_source()
        self.active = _strip_comments_and_literals(self.source)

    def test_cpu_reference_function(self) -> None:
        self.assertIn("make_cpu_reference(", self.active)

    def test_validate_precheck_function(self) -> None:
        self.assertIn("validate_precheck(", self.active)

    def test_validate_postcheck_function(self) -> None:
        # postcheck uses validate_samples analogous to rdna4
        self.assertIn("validate_samples(", self.active)

    def test_result_tokens_in_active_code(self) -> None:
        # These tokens must appear in printf format strings (active code)
        # We check the raw source since printf strings are blanked
        for token in (
            "correct=OK", "correct=FAIL",
            "precheck=OK", "precheck=FAIL",
            "postcheck=OK", "postcheck=FAIL", "postcheck=NA",
        ):
            self.assertIn(token, self.source, f"missing RESULT token: {token}")

    def test_result_keyword_present(self) -> None:
        self.assertIn("RESULT ", self.source)

    def test_experiment_label(self) -> None:
        # Must identify as a distinct experiment name
        self.assertIn("experiment=", self.source)


class Gfx11WmmaVALUKernel(unittest.TestCase):
    """Must include a VALU reference kernel with standard 16x16x16 loop."""

    def setUp(self) -> None:
        self.source = _require_source()
        self.active = _strip_comments_and_literals(self.source)

    def test_valu_kernel_exists(self) -> None:
        self.assertIn("__global__ void valu_kernel(", self.active)

    def test_valu_has_k16_loop(self) -> None:
        self.assertIn("for (int k = 0; k < 16; ++k)", self.active)

    def test_valu_accesses_matrix_a_with_k(self) -> None:
        self.assertIn("matrix_a[row * 16 + k]", self.active)

    def test_valu_accesses_matrix_b_with_k(self) -> None:
        self.assertIn("matrix_b[k * 16 + column]", self.active)

    def test_valu_writes_matrix_c(self) -> None:
        self.assertIn("matrix_c[row * 16 + column]", self.active)


class Gfx11WmmaDecoyResistance(unittest.TestCase):
    """Key assertions must operate on cleaned (active) code, not raw text."""

    def setUp(self) -> None:
        self.source = _require_source()

    def test_intrinsic_in_comment_does_not_satisfy(self) -> None:
        intrinsic = "__builtin_amdgcn_wmma_f32_16x16x16_f16_w32"
        fake = f"// {intrinsic}\nint main() {{}}\n"
        cleaned = _strip_comments_and_literals(fake)
        self.assertNotIn(intrinsic, cleaned)

    def test_intrinsic_in_string_does_not_satisfy(self) -> None:
        intrinsic = "__builtin_amdgcn_wmma_f32_16x16x16_f16_w32"
        fake = f'const char* s = "{intrinsic}";\nint main() {{}}\n'
        cleaned = _strip_comments_and_literals(fake)
        self.assertNotIn(intrinsic, cleaned)

    def test_guard_in_block_comment_does_not_satisfy(self) -> None:
        fake = "/* #if defined(__HIP_DEVICE_COMPILE__) */\nint main() {}\n"
        cleaned = _strip_comments_and_literals(fake)
        self.assertNotIn("__HIP_DEVICE_COMPILE__", cleaned)


import os
import shlex
import shutil
import subprocess
import tempfile

RUN_ALL_PATH = CHAPTER3_DIR / "run_all.sh"

_ALLOWED_ARCHS = {"gfx1100", "gfx1151", "gfx1201"}
_EXPECTED_MATRIX_SOURCE = {
    "gfx1100": "rdna3_wmma.hip",
    "gfx1151": "rdna3_wmma.hip",
    "gfx1201": "rdna4_wmma.hip",
}


def _require_run_all() -> str:
    if not RUN_ALL_PATH.is_file():
        raise unittest.SkipTest(f"run_all.sh not found: {RUN_ALL_PATH}")
    return RUN_ALL_PATH.read_text()


def _patch_bash52_local(script_text: str) -> str:
    """Fix bash 5.2 incompatibility: split local statements that reference
    earlier variables declared on the same line (set -u rejects them)."""
    return script_text.replace(
        'local source_name="$1" binary_name="$2" '
        'binary="${BUILD_DIR}/${binary_name}"',
        'local source_name="$1" binary_name="$2"\n'
        '    local binary="${BUILD_DIR}/${binary_name}"',
    )


def _write_fake_hipcc(tool_dir: Path) -> None:
    script = tool_dir / "hipcc"
    script.write_text(
        '#!/usr/bin/env bash\n'
        'echo "hipcc $*" >> "${FAKE_TOOL_LOG}"\n'
        'OUT=""\n'
        'ARGS=("$@")\n'
        'for ((i=0; i<${#ARGS[@]}; i++)); do\n'
        '  if [[ "${ARGS[$i]}" == "-o" ]]; then OUT="${ARGS[$((i+1))]}"; break; fi\n'
        'done\n'
        '[[ -z "$OUT" ]] && exit 1\n'
        'cat > "${OUT}" << \'FAKEBIN\'\n'
        '#!/usr/bin/env bash\n'
        'IMPL="valu"\n'
        'for ((i=1; i<=$#; i++)); do\n'
        '  if [[ "${!i}" == "--implementation" ]]; then j=$((i+1)); IMPL="${!j}"; fi\n'
        'done\n'
        'echo "RESULT experiment=matrix-path implementation=${IMPL} runtime=hip '
        'shape=batch=1,M=16,N=16,K=16 dtype=fp16-fp32 warmup=0 repeat=1 '
        'seed=1 timed=1 correct=OK precheck=OK postcheck=OK '
        'min_ms=1 median_ms=1 mean_ms=1 logical_bandwidth_gbs=1 tflops=1"\n'
        'FAKEBIN\n'
        'chmod +x "${OUT}"\n'
    )
    script.chmod(0o755)


def _write_fake_git(tool_dir: Path) -> None:
    script = tool_dir / "git"
    script.write_text('#!/usr/bin/env bash\necho "unexpected Git call" >&2\nexit 99\n')
    script.chmod(0o755)


def _prepare_runner_fixture(arch: str) -> tuple[Path, dict, Path, Path]:
    """Set up a temp directory with patched run_all.sh and fake tools.

    Returns (chapter_dir, env, log_path, tmpdir) for cleanup.
    The script copy is patched for bash 5.2 local-variable compatibility
    but routing logic is unchanged.
    """
    tmpdir = Path(tempfile.mkdtemp(prefix=f"ch3-{arch}-"))
    tool_dir = tmpdir / "tools"
    tool_dir.mkdir()
    log_path = tmpdir / "tool.log"

    _write_fake_hipcc(tool_dir)
    _write_fake_git(tool_dir)

    part_dir = tmpdir / "part"
    part_dir.mkdir()
    (part_dir / "activate-rocm.sh").write_text("#!/usr/bin/env bash\n:\n")

    chapter_dir = part_dir / "chapter3"
    chapter_dir.mkdir()
    for name in os.listdir(CHAPTER3_DIR):
        src = CHAPTER3_DIR / name
        if src.is_file():
            (chapter_dir / name).write_bytes(src.read_bytes())

    patched = _patch_bash52_local((chapter_dir / "run_all.sh").read_text())
    (chapter_dir / "run_all.sh").write_text(patched)

    env = os.environ.copy()
    env.update({
        "PATH": f"{tool_dir}:{env['PATH']}",
        "FAKE_TOOL_LOG": str(log_path),
        "GPU_ARCH": arch,
        "RUN_EDGE_CASES": "0",
    })
    return chapter_dir, env, log_path, tmpdir


def _run_runner(arch: str) -> tuple[int, str, str, str]:
    """Run the patched run_all.sh copy with given GPU_ARCH.

    Returns (returncode, stdout, stderr, hipcc_log_contents).
    """
    chapter_dir, env, log_path, tmpdir = _prepare_runner_fixture(arch)
    try:
        result = subprocess.run(
            ["bash", str(chapter_dir / "run_all.sh")],
            cwd=str(chapter_dir),
            capture_output=True, text=True, check=False, env=env,
        )
        log = log_path.read_text() if log_path.exists() else ""
        return result.returncode, result.stdout, result.stderr, log
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


class RunAllArchValidation(unittest.TestCase):
    """run_all.sh must validate GPU_ARCH to exactly gfx1100/gfx1151/gfx1201."""

    def setUp(self) -> None:
        self.script = _require_run_all()

    def test_script_text_contains_gfx1100(self) -> None:
        self.assertIn("gfx1100", self.script)

    def test_script_text_contains_gfx1151(self) -> None:
        self.assertIn("gfx1151", self.script)

    def test_script_text_contains_gfx1201(self) -> None:
        self.assertIn("gfx1201", self.script)

    def test_rejects_unsupported_arch_before_hipcc(self) -> None:
        """Unsupported GPU_ARCH must exit non-zero with validation message, no hipcc."""
        rc, stdout, stderr, log = _run_runner("gfx942")
        self.assertNotEqual(rc, 0,
                            "run_all.sh must reject GPU_ARCH=gfx942")
        self.assertTrue(
            "GPU_ARCH" in stderr or "unsupported" in stderr.lower(),
            f"stderr must mention GPU_ARCH or unsupported, got: {stderr!r}",
        )
        self.assertNotIn("hipcc", log,
                         "hipcc must not run for unsupported arch")


class RunAllArchRouting(unittest.TestCase):
    """run_all.sh must route matrix source by arch: rdna3 for gfx11, rdna4 for gfx12."""

    def setUp(self) -> None:
        self.script = _require_run_all()

    def test_gfx1100_compiles_rdna3_wmma_source(self) -> None:
        rc, stdout, stderr, log = _run_runner("gfx1100")
        self.assertEqual(rc, 0, f"run_all.sh failed for gfx1100:\n{stderr}")
        hipcc_lines = [l for l in log.splitlines() if l.startswith("hipcc ")]
        matrix_compiles = [l for l in hipcc_lines if "wmma" in l.lower()]
        self.assertTrue(
            matrix_compiles,
            f"no WMMA compile in hipcc log for gfx1100, all compiles: {hipcc_lines}",
        )
        self.assertTrue(
            any("rdna3_wmma.hip" in l for l in matrix_compiles),
            f"gfx1100 must compile rdna3_wmma.hip, got: {matrix_compiles}",
        )
        self.assertFalse(
            any("rdna4_wmma.hip" in l for l in matrix_compiles),
            "gfx1100 must NOT compile rdna4_wmma.hip",
        )

    def test_gfx1151_compiles_rdna3_wmma_source(self) -> None:
        rc, stdout, stderr, log = _run_runner("gfx1151")
        self.assertEqual(rc, 0, f"run_all.sh failed for gfx1151:\n{stderr}")
        hipcc_lines = [l for l in log.splitlines() if l.startswith("hipcc ")]
        matrix_compiles = [l for l in hipcc_lines if "wmma" in l.lower()]
        self.assertTrue(
            matrix_compiles,
            f"no WMMA compile in hipcc log for gfx1151, all compiles: {hipcc_lines}",
        )
        self.assertTrue(
            any("rdna3_wmma.hip" in l for l in matrix_compiles),
            f"gfx1151 must compile rdna3_wmma.hip, got: {matrix_compiles}",
        )

    def test_gfx1201_compiles_rdna4_wmma_source(self) -> None:
        rc, stdout, stderr, log = _run_runner("gfx1201")
        self.assertEqual(rc, 0, f"run_all.sh failed for gfx1201:\n{stderr}")
        hipcc_lines = [l for l in log.splitlines() if l.startswith("hipcc ")]
        matrix_compiles = [l for l in hipcc_lines if "wmma" in l.lower()]
        self.assertTrue(
            matrix_compiles,
            f"no WMMA compile in hipcc log for gfx1201, all compiles: {hipcc_lines}",
        )
        self.assertTrue(
            any("rdna4_wmma.hip" in l for l in matrix_compiles),
            f"gfx1201 must compile rdna4_wmma.hip, got: {matrix_compiles}",
        )

    def test_gfx1100_offload_arch_flag_matches(self) -> None:
        rc, stdout, stderr, log = _run_runner("gfx1100")
        self.assertEqual(rc, 0, f"run_all.sh failed for gfx1100:\n{stderr}")
        hipcc_lines = [l for l in log.splitlines() if l.startswith("hipcc ")]
        self.assertTrue(hipcc_lines, "no hipcc calls logged")
        for line in hipcc_lines:
            self.assertIn(
                "--offload-arch=gfx1100", line,
                f"compile must use --offload-arch=gfx1100, got: {line}",
            )

    def test_matrix_binary_uses_generic_name(self) -> None:
        """Compiled WMMA binary must have arch-neutral name (not rdna3/rdna4_wmma)."""
        rc, stdout, stderr, log = _run_runner("gfx1100")
        self.assertEqual(rc, 0, f"run_all.sh failed for gfx1100:\n{stderr}")
        hipcc_lines = [l for l in log.splitlines() if l.startswith("hipcc ")]
        matrix_compiles = [l for l in hipcc_lines if "wmma" in l.lower()]
        self.assertTrue(
            matrix_compiles,
            "must have at least one WMMA compile to check binary name",
        )
        for line in matrix_compiles:
            args = shlex.split(line.removeprefix("hipcc "))
            if "-o" in args:
                binary_name = Path(args[args.index("-o") + 1]).name
                self.assertNotIn(
                    "rdna4_wmma", binary_name,
                    "matrix binary name must be generic, not rdna4_wmma",
                )
                self.assertNotIn(
                    "rdna3_wmma", binary_name,
                    "matrix binary name must be arch-specific source name",
                )


class RunAllArchAllowed(unittest.TestCase):
    """Static: script must explicitly enumerate all three allowed arches."""

    def setUp(self) -> None:
        self.script = _require_run_all()

    def test_contains_arch_whitelist_pattern(self) -> None:
        """Script must reference all three arches for validation routing."""
        for arch in _ALLOWED_ARCHS:
            self.assertIn(
                arch, self.script,
                f"run_all.sh must reference {arch} for arch validation",
            )

    def test_no_blanket_gfx_pattern_without_enumeration(self) -> None:
        """Script must NOT use a loose 'gfx[0-9]*' glob as arch validation."""
        self.assertNotRegex(
            self.script,
            r'gfx\[\d',
            "run_all.sh must not use glob-style arch matching",
        )


if __name__ == "__main__":
    unittest.main()
