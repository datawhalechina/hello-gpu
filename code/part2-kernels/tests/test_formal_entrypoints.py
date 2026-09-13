from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
CHAPTERS = ("chapter8", "chapter9", "chapter10", "chapter11", "chapter12", "chapter13")
STAGING_CHAPTERS = ("chapter9", "chapter10", "chapter11", "chapter12", "chapter13")
RESULT_FIELDS = (
    "operator=",
    "implementation=",
    "runtime=",
    "dtype=",
    "warmup=",
    "repeat=",
    "seed=",
    "timed=",
    "correct=",
    "precheck=",
    "postcheck=",
    "min_ms=",
    "median_ms=",
    "mean_ms=",
)


class FormalEntrypointsTest(unittest.TestCase):
    def test_all_formal_runs_can_skip_edge_cases(self) -> None:
        for chapter in CHAPTERS:
            with self.subTest(chapter=chapter):
                source = (ROOT / chapter / "run_all.sh").read_text(encoding="utf-8")
                self.assertIn('RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"', source)

    def test_each_profile_entrypoint_is_fail_fast_and_configured(self) -> None:
        for chapter in CHAPTERS:
            with self.subTest(chapter=chapter):
                source = (ROOT / chapter / "profile_all.sh").read_text(encoding="utf-8")
                self.assertIn("set -euo pipefail", source)
                self.assertIn("PROFILE_WARMUP=\"${PROFILE_WARMUP:-0}\"", source)
                self.assertIn("PROFILE_REPEAT=\"${PROFILE_REPEAT:-", source)
                self.assertIn("rocprofv3", source)
                self.assertIn("--kernel-trace", source)
                self.assertIn("profile_config.env", source)

    def test_chapter9_run_all_does_not_mix_profiles_with_benchmarks(self) -> None:
        source = (ROOT / "chapter9" / "run_all.sh").read_text(encoding="utf-8")
        self.assertNotIn("RUN_PROFILE=", source)
        self.assertNotIn("rocprofv3", source)

    def test_chapter12_and_13_formal_edges_and_seed_are_explicit(self) -> None:
        chapter12 = (ROOT / "chapter12" / "run_all.sh").read_text(encoding="utf-8")
        chapter13 = (ROOT / "chapter13" / "run_all.sh").read_text(encoding="utf-8")
        self.assertIn("--seq 33 --dim 31", chapter12)
        self.assertIn("--seed \"${SEED}\"", chapter12)
        self.assertIn("--rows 33 --cols 257", chapter13)
        self.assertIn("--seed \"${SEED}\"", chapter13)

    def test_all_formal_implementations_include_result_fields(self) -> None:
        implementations = (
            ("chapter9", "reduction_hip.hip"), ("chapter9", "reduction_triton.py"),
            ("chapter10", "softmax_hip.hip"), ("chapter10", "softmax_triton.py"),
            ("chapter11", "matmul_hip.hip"), ("chapter11", "matmul_triton.py"),
            ("chapter12", "attention_hip.hip"), ("chapter12", "attention_triton.py"),
            ("chapter13", "rmsnorm_hip.hip"), ("chapter13", "rmsnorm_triton.py"),
        )
        for chapter, filename in implementations:
            source = (ROOT / chapter / filename).read_text(encoding="utf-8")
            for field in RESULT_FIELDS:
                with self.subTest(chapter=chapter, filename=filename, field=field):
                    self.assertIn(field, source)

    def test_chapter11_and_12_results_time_preallocated_outputs(self) -> None:
        for chapter, filename in (("chapter12", "attention_triton.py"), ("chapter13", "rmsnorm_triton.py")):
            source = (ROOT / chapter / filename).read_text(encoding="utf-8")
            with self.subTest(chapter=chapter):
                self.assertIn("output = torch.empty_like", source)
                self.assertIn("median_ms", source)
                self.assertIn("precheck", source)
                self.assertIn("postcheck", source)
                self.assertIn("seed={args.seed}", source)

    def test_profile_labels_match_published_implementations(self) -> None:
        expected_labels = {
            "chapter9": ("hip-atomic", "hip-lds", "hip-two-stage", "triton-t0", "triton-t1-local"),
            "chapter10": ("hip-baseline-3kernel", "hip-fused-block-lds", "triton-t0-compact", "triton-t1-wide"),
            "chapter11": ("hip-naive", "hip-tiled", "triton-baseline", "triton-grouped"),
        }
        for chapter, labels in expected_labels.items():
            source = (ROOT / chapter / "profile_all.sh").read_text(encoding="utf-8")
            for label in labels:
                with self.subTest(chapter=chapter, label=label):
                    self.assertIn(f'profile "{label}"', source)

    def test_chapter11_profile_skips_torch_baseline(self) -> None:
        source = (ROOT / "chapter11" / "profile_all.sh").read_text(encoding="utf-8")
        self.assertNotIn('profile "torch-mm"', source)
        self.assertNotIn("for version in torch", source)

    def test_profiles_stage_then_atomically_replace_complete_results(self) -> None:
        for chapter in STAGING_CHAPTERS:
            with self.subTest(chapter=chapter):
                source = (ROOT / chapter / "profile_all.sh").read_text(encoding="utf-8")
                self.assertIn('.profiles-staging.XXXXXX', source)
                self.assertIn('PROFILE_DIR="${STAGING_ROOT}/profiles"', source)
                self.assertIn('PREVIOUS_PROFILES="${STAGING_ROOT}/previous-profiles"', source)
                self.assertIn('mv "${PROFILE_DIR}" "${SCRIPT_DIR}/profiles"', source)
                self.assertIn('PUBLISHED=1', source)

    def test_profile_configs_record_complete_execution_parameters(self) -> None:
        for chapter in CHAPTERS:
            with self.subTest(chapter=chapter):
                source = (ROOT / chapter / "profile_all.sh").read_text(encoding="utf-8")
                if chapter == "chapter8":
                    # chapter8 predates the printf-style config block (echo-style, REPEAT=10)
                    self.assertIn("gpu_arch=${GPU_ARCH}", source)
                    self.assertIn("warmup=${PROFILE_WARMUP}", source)
                    self.assertIn("repeat=${PROFILE_REPEAT}", source)
                else:
                    self.assertIn("gpu_arch=%s", source)
                    self.assertIn("profile_warmup=%s", source)
                    self.assertIn("profile_repeat=%s", source)
        chapter8 = (ROOT / "chapter8" / "profile_all.sh").read_text(encoding="utf-8")
        chapter13 = (ROOT / "chapter13" / "profile_all.sh").read_text(encoding="utf-8")
        self.assertIn("triton_t0_block=256", chapter8)
        self.assertIn('EPSILON="${EPSILON:-1e-5}"', chapter13)
        self.assertIn('--epsilon "${EPSILON}"', chapter13)
        self.assertIn("epsilon=%s", chapter13)


if __name__ == "__main__":
    unittest.main()
