from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
CHAPTERS = ("chapter8", "chapter9", "chapter10", "chapter11", "chapter12")
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
                self.assertIn('SOURCE_COMMIT="${SOURCE_COMMIT:-}"', source)
                self.assertIn("PROFILE_WARMUP=\"${PROFILE_WARMUP:-0}\"", source)
                self.assertIn("PROFILE_REPEAT=\"${PROFILE_REPEAT:-5}\"", source)
                self.assertIn("rocprofv3", source)
                self.assertIn("--kernel-trace", source)
                self.assertIn("profile_config.env", source)

    def test_chapter9_run_all_does_not_mix_profiles_with_benchmarks(self) -> None:
        source = (ROOT / "chapter9" / "run_all.sh").read_text(encoding="utf-8")
        self.assertNotIn("RUN_PROFILE=", source)
        self.assertNotIn("rocprofv3", source)

    def test_chapter11_and_12_formal_edges_and_seed_are_explicit(self) -> None:
        chapter11 = (ROOT / "chapter11" / "run_all.sh").read_text(encoding="utf-8")
        chapter12 = (ROOT / "chapter12" / "run_all.sh").read_text(encoding="utf-8")
        self.assertIn("--seq 33 --dim 31", chapter11)
        self.assertIn("--seed \"${SEED}\"", chapter11)
        self.assertIn("--rows 33 --cols 257", chapter12)
        self.assertIn("--seed \"${SEED}\"", chapter12)

    def test_chapter10_results_include_formal_fields(self) -> None:
        implementations = (
            ("chapter8", "reduction_hip.hip"), ("chapter8", "reduction_triton.py"),
            ("chapter9", "softmax_hip.hip"), ("chapter9", "softmax_triton.py"),
            ("chapter10", "matmul_hip.hip"), ("chapter10", "matmul_triton.py"),
            ("chapter11", "attention_hip.hip"), ("chapter11", "attention_triton.py"),
            ("chapter12", "rmsnorm_hip.hip"), ("chapter12", "rmsnorm_triton.py"),
        )
        for chapter, filename in implementations:
            source = (ROOT / chapter / filename).read_text(encoding="utf-8")
            for field in RESULT_FIELDS:
                with self.subTest(chapter=chapter, filename=filename, field=field):
                    self.assertIn(field, source)

    def test_chapter11_and_12_results_time_preallocated_outputs(self) -> None:
        for chapter, filename in (("chapter11", "attention_triton.py"), ("chapter12", "rmsnorm_triton.py")):
            source = (ROOT / chapter / filename).read_text(encoding="utf-8")
            with self.subTest(chapter=chapter):
                self.assertIn("output = torch.empty_like", source)
                self.assertIn("median_ms", source)
                self.assertIn("precheck", source)
                self.assertIn("postcheck", source)
                self.assertIn("seed={args.seed}", source)

    def test_profile_labels_match_published_implementations(self) -> None:
        expected_labels = {
            "chapter8": ("hip-atomic", "hip-lds", "hip-two-stage", "triton-t0", "triton-t1-local"),
            "chapter9": ("hip-baseline-3kernel", "hip-fused-block-lds", "triton-t0-compact", "triton-t1-wide"),
            "chapter10": ("hip-naive", "hip-tiled", "triton-baseline", "triton-grouped"),
        }
        for chapter, labels in expected_labels.items():
            source = (ROOT / chapter / "profile_all.sh").read_text(encoding="utf-8")
            for label in labels:
                with self.subTest(chapter=chapter, label=label):
                    self.assertIn(f'profile "{label}"', source)

    def test_chapter10_profile_skips_torch_baseline(self) -> None:
        source = (ROOT / "chapter10" / "profile_all.sh").read_text(encoding="utf-8")
        self.assertNotIn('profile "torch-mm"', source)
        self.assertNotIn("for version in torch", source)

    def test_profiles_stage_then_atomically_replace_complete_results(self) -> None:
        for chapter in CHAPTERS:
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
                self.assertIn("gpu_arch=%s", source)
                self.assertIn("profile_warmup=%s", source)
                self.assertIn("profile_repeat=%s", source)
        chapter8 = (ROOT / "chapter8" / "profile_all.sh").read_text(encoding="utf-8")
        chapter12 = (ROOT / "chapter12" / "profile_all.sh").read_text(encoding="utf-8")
        self.assertIn("triton_programs=%s", chapter8)
        self.assertIn('EPSILON="${EPSILON:-1e-5}"', chapter12)
        self.assertIn('--epsilon "${EPSILON}"', chapter12)
        self.assertIn("epsilon=%s", chapter12)


if __name__ == "__main__":
    unittest.main()
