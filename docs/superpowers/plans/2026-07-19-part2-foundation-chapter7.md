# Part 2 Foundation and Chapter 7 Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the reproducible experiment contract for Part 2 and turn Chapter 7 into the verified template that Chapters 8–12 will follow.

**Architecture:** The local `dev` checkout remains the source of truth; code is synchronized without deletion to `/home/hellogpu/hdb/hello-gpu-part2` and executed on the RX 9070 XT host. Operator implementations remain chapter-local for teaching clarity, while a small standard-library-only evidence module validates result records and manifests. Raw logs and profiler traces remain ignored; curated manifests, summaries, profile extracts, figures, and `EXPERIMENT.md` are tracked.

**Tech Stack:** Markdown/VitePress 2, Python 3.12+, `unittest`, HIP C++17, PyTorch 2.11 ROCm, Triton 3.6 ROCm, Bash, `rocprofv3`, matplotlib, SSH/rsync.

## Global Constraints

- Develop on local branch `dev`; do not change or synchronize `main` during this work.
- Treat `/Users/feibo/hello-gpu` as the only source-of-truth checkout.
- Run GPU code only under `/home/hellogpu/hdb/hello-gpu-part2` on SSH host `hwj-frp-9070xt-2404`.
- Target Radeon RX 9070 XT, `gfx1201`, ROCm 7.13, native Ubuntu 24.04.
- Every operator chapter must provide HIP and Triton implementations, correctness checks, benchmark results, profiling evidence, and reproducible commands.
- Check correctness before and after timing; never benchmark a version whose precheck fails.
- Report kernel-only and end-to-end measurements separately whenever both exist.
- Use three independent processes for publication results; report the median of process medians and the observed process range.
- Keep raw `logs/`, `profiles/`, compiler caches, and full traces ignored.
- Track curated `EXPERIMENT.md`, `evidence/manifest.json`, `evidence/summary.csv`, `evidence/profile_summary.csv`, and the final figure.
- A missing profiler field is written as `unavailable`; it is never silently omitted.
- Do not describe a version as optimized until measured evidence shows an improvement on at least one declared target shape.
- Keep chapter operator implementations self-contained; shared code may validate evidence but must not hide the HIP or Triton teaching kernels.
- Create local commits after each successful review checkpoint; do not push any commit without a separate user request.

## Phase Boundary

This plan implements the Part 2 contract and Chapter 7 only. The remaining approved sequence is implemented by separate reviewable plans after this template passes its gates:

1. Chapter 8 Reduction
2. Chapter 9 Softmax
3. Chapter 10 GEMM
4. Chapter 11 teaching Attention Forward
5. Chapter 12 Fused RMSNorm capstone
6. Whole-Part consistency and reader-path review

---

### Task 1: Add the Part 2 evidence contract

**Files:**
- Create: `code/part2-kernels/common/__init__.py`
- Create: `code/part2-kernels/common/evidence.py`
- Create: `code/part2-kernels/tests/__init__.py`
- Create: `code/part2-kernels/tests/test_evidence.py`

**Interfaces:**
- Produces: `parse_result_line(line: str, source: str = "") -> dict[str, str] | None`
- Produces: `validate_manifest(manifest: Mapping[str, object]) -> list[str]`
- Produces: `validate_records(records: Sequence[Mapping[str, object]]) -> list[str]`
- Consumes: `RESULT key=value ...` records emitted by every HIP and Triton benchmark.

- [ ] **Step 1: Write failing unit tests for parsing and validation**

```python
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
```

- [ ] **Step 2: Run the tests and verify that the module does not exist**

Run:

```bash
cd code/part2-kernels
python -m unittest tests.test_evidence -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'common'`.

- [ ] **Step 3: Implement the minimal evidence module**

```python
from __future__ import annotations

import shlex
from collections.abc import Mapping, Sequence

MANIFEST_FIELDS = (
    "operator",
    "generated_at",
    "git_commit",
    "source_sha256",
    "hardware",
    "software",
    "benchmark",
)

RECORD_FIELDS = (
    "operator",
    "implementation",
    "runtime",
    "shape",
    "dtype",
    "correct",
    "median_ms",
)


def parse_result_line(line: str, source: str = "") -> dict[str, str] | None:
    if not line.startswith("RESULT "):
        return None
    record = {"source": source}
    for token in shlex.split(line)[1:]:
        key, separator, value = token.partition("=")
        if separator:
            record[key] = value
    return record


def validate_manifest(manifest: Mapping[str, object]) -> list[str]:
    return [f"manifest missing field: {field}" for field in MANIFEST_FIELDS if field not in manifest]


def validate_records(records: Sequence[Mapping[str, object]]) -> list[str]:
    errors: list[str] = []
    for index, record in enumerate(records):
        errors.extend(
            f"record {index} missing field: {field}"
            for field in RECORD_FIELDS
            if field not in record
        )
        if record.get("correct") != "OK":
            errors.append(f"record {index} correctness is not OK")
    return errors
```

`common/__init__.py` and `tests/__init__.py` are empty package markers.

- [ ] **Step 4: Run the evidence unit tests**

Run:

```bash
cd code/part2-kernels
python -m unittest tests.test_evidence -v
```

Expected: 3 tests, all `ok`.

- [ ] **Step 5: Checkpoint the evidence contract**

Run:

```bash
git diff --check
git status --short
```

Expected: only the four Task 1 files are new; `git diff --check` exits 0.

- [ ] **Step 6: Commit the evidence contract**

```bash
git add code/part2-kernels/common code/part2-kernels/tests
git commit -m "test(part2): add experiment evidence contract"
```

Expected: one local commit; no push.

### Task 2: Add a safe local-to-remote execution wrapper

**Files:**
- Create: `scripts/part2-remote.sh`
- Create: `scripts/test-part2-remote.sh`

**Interfaces:**
- Produces: `bash scripts/part2-remote.sh status`
- Produces: `bash scripts/part2-remote.sh sync`
- Produces: `bash scripts/part2-remote.sh run chapter7 <command...>`
- Produces: `bash scripts/part2-remote.sh fetch chapter7`
- Uses defaults: host `hwj-frp-9070xt-2404`, remote root `/home/hellogpu/hdb/hello-gpu-part2`.
- Never uses `rsync --delete` and never writes outside the configured remote root.

- [ ] **Step 1: Write a shell contract test**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/part2-remote.sh"

help_output="$(bash "${TARGET}" --help)"
grep -Fq "status|sync|run|fetch" <<<"${help_output}"

if bash "${TARGET}" run ../chapter7 true 2>/dev/null; then
    echo "unsafe chapter path unexpectedly accepted" >&2
    exit 1
fi

if bash "${TARGET}" unknown 2>/dev/null; then
    echo "unknown command unexpectedly accepted" >&2
    exit 1
fi

echo "part2 remote wrapper contract: PASS"
```

- [ ] **Step 2: Run the contract test and verify failure**

Run:

```bash
bash scripts/test-part2-remote.sh
```

Expected: FAIL because `scripts/part2-remote.sh` does not exist.

- [ ] **Step 3: Implement the wrapper with explicit targets**

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REMOTE_HOST="${PART2_REMOTE_HOST:-hwj-frp-9070xt-2404}"
REMOTE_ROOT="${PART2_REMOTE_ROOT:-/home/hellogpu/hdb/hello-gpu-part2}"

usage() {
    echo "usage: $0 status|sync|run|fetch [chapter] [command ...]"
}

require_chapter() {
    local chapter="${1:-}"
    if [[ ! "${chapter}" =~ ^chapter(7|8|9|10|11|12)$ ]]; then
        echo "invalid chapter: ${chapter}" >&2
        exit 2
    fi
}

command="${1:---help}"
case "${command}" in
    --help|-h)
        usage
        ;;
    status)
        ssh -o BatchMode=yes "${REMOTE_HOST}" \
            "test -d '${REMOTE_ROOT}' && printf 'remote_root=present\\n' || printf 'remote_root=missing\\n'; command -v hipcc; command -v rocprofv3; command -v uv || true"
        ;;
    sync)
        ssh -o BatchMode=yes "${REMOTE_HOST}" "mkdir -p '${REMOTE_ROOT}/code/part2-kernels'"
        rsync -az \
            --exclude '.venv/' --exclude '__pycache__/' --exclude 'logs/' \
            --exclude 'profiles/' --exclude 'results/' \
            "${REPO_ROOT}/code/part2-kernels/" \
            "${REMOTE_HOST}:${REMOTE_ROOT}/code/part2-kernels/"
        ;;
    run)
        chapter="${2:-}"
        require_chapter "${chapter}"
        shift 2
        if (($# == 0)); then
            echo "run requires a command" >&2
            exit 2
        fi
        ssh -o BatchMode=yes "${REMOTE_HOST}" \
            "cd '${REMOTE_ROOT}/code/part2-kernels/${chapter}' &&" "$@"
        ;;
    fetch)
        chapter="${2:-}"
        require_chapter "${chapter}"
        mkdir -p "${REPO_ROOT}/code/part2-kernels/${chapter}/evidence"
        rsync -az \
            "${REMOTE_HOST}:${REMOTE_ROOT}/code/part2-kernels/${chapter}/evidence/" \
            "${REPO_ROOT}/code/part2-kernels/${chapter}/evidence/"
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac
```

- [ ] **Step 4: Run local safety checks**

Run:

```bash
bash -n scripts/part2-remote.sh scripts/test-part2-remote.sh
bash scripts/test-part2-remote.sh
```

Expected: syntax checks exit 0 and the contract prints `PASS`.

- [ ] **Step 5: Verify remote status without changing the remote directory**

Run:

```bash
bash scripts/part2-remote.sh status
```

Expected: host responds; `hipcc` and `rocprofv3` resolve; `uv` may be absent before Task 3.

- [ ] **Step 6: Checkpoint the remote wrapper**

Run:

```bash
git diff --check
git status --short
```

Expected: Task 1 files plus the two Task 2 scripts; no remote-generated files in the checkout.

- [ ] **Step 7: Commit the remote wrapper**

```bash
git add scripts/part2-remote.sh scripts/test-part2-remote.sh
git commit -m "build(part2): add remote experiment wrapper"
```

Expected: one local commit; no push.

### Task 3: Prepare the isolated remote Python environment

**Files:**
- Modify: no repository files
- Remote create: `/home/hellogpu/hdb/bin/uv`
- Remote create: `/home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels/.venv/`

**Interfaces:**
- Produces: remote `uv`, Python 3.12+, PyTorch ROCm, Triton, Triton-viz, NumPy, and matplotlib for Part 2.
- Consumes: `code/part2-kernels/pyproject.toml` and `uv.lock` from the local checkout.

- [ ] **Step 1: Confirm system Python and remote free space**

Run:

```bash
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  'python3 --version; df -h /home/hellogpu/hdb; test -x /usr/bin/hipcc; test -x /usr/bin/rocprofv3'
```

Expected: Python version is printed, `/home/hellogpu/hdb` has sufficient space, and both tool checks exit 0.

- [ ] **Step 2: Install uv under the user-owned hdb tree**

Run:

```bash
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  'mkdir -p /home/hellogpu/hdb/bin && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/home/hellogpu/hdb/bin sh'
```

Expected: `/home/hellogpu/hdb/bin/uv --version` exits 0. This step requires explicit network approval at execution time.

- [ ] **Step 3: Synchronize the Part 2 project without deletion**

Run:

```bash
bash scripts/part2-remote.sh sync
```

Expected: remote `code/part2-kernels` contains the same tracked source files as local; the old repository under `/home/hellogpu/shaowenjie/hello-gpu` is untouched.

- [ ] **Step 4: Create and sync the locked environment with Python 3.12**

Run:

```bash
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  'cd /home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels && PATH=/home/hellogpu/hdb/bin:$PATH uv sync --python 3.12 --locked'
```

Expected: `.venv/bin/python --version` reports Python 3.12 and `uv sync` exits 0.

- [ ] **Step 5: Verify the ROCm Python runtime**

Run:

```bash
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  'cd /home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels && .venv/bin/python -c "import torch,triton; print(torch.__version__); print(triton.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"'
```

Expected: PyTorch and Triton versions print, GPU availability is `True`, and the device is Radeon RX 9070 XT.

### Task 4: Make Chapter 7 emit and validate the publication contract

**Files:**
- Modify: `code/part2-kernels/chapter7/vector_add_hip.hip`
- Modify: `code/part2-kernels/chapter7/vector_add_triton.py`
- Modify: `code/part2-kernels/chapter7/summarize_results.py`
- Create: `code/part2-kernels/tests/test_chapter7_summary.py`

**Interfaces:**
- HIP and Triton records add `operator=vector-add` and use `shape=<N>` instead of the Chapter 7-only `size=<N>` field.
- `summarize_results.py` imports `common.evidence.parse_result_line` and exits non-zero when manifest or record validation fails.
- `summarize_results.py --chapter-dir PATH --git-commit SHA` writes curated files to `PATH/evidence/`.

- [ ] **Step 1: Write a failing summary integration test**

```python
from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


class Chapter7SummaryTest(unittest.TestCase):
    def test_summary_writes_valid_curated_evidence(self) -> None:
        script = Path(__file__).parents[1] / "chapter7" / "summarize_results.py"
        with tempfile.TemporaryDirectory() as temporary:
            chapter = Path(temporary)
            runs = chapter / "logs" / "runs"
            runs.mkdir(parents=True)
            (runs / "hip_run1.log").write_text(
                "RESULT operator=vector-add implementation=hip-v0 runtime=hip "
                "shape=1024 dtype=float32 block=256 grid=4 warmup=2 repeat=5 "
                "seed=7 timed=1 correct=OK precheck=OK postcheck=OK "
                "min_ms=0.01 median_ms=0.02 mean_ms=0.02 "
                "effective_bandwidth_gbs=1.0 max_abs_error=0\n",
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    "python",
                    str(script),
                    "--chapter-dir",
                    str(chapter),
                    "--git-commit",
                    "abc1234",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            manifest = json.loads((chapter / "evidence" / "manifest.json").read_text())
            self.assertEqual(manifest["operator"], "vector-add")
            self.assertEqual(manifest["git_commit"], "abc1234")
            self.assertTrue((chapter / "evidence" / "summary.csv").exists())
```

- [ ] **Step 2: Run the integration test and verify CLI failure**

Run:

```bash
cd code/part2-kernels
python -m unittest tests.test_chapter7_summary -v
```

Expected: FAIL because `summarize_results.py` does not accept `--chapter-dir` or `--git-commit`.

- [ ] **Step 3: Update HIP and Triton result records**

For every success and failure result line in both producers, use this stable prefix and field name:

```text
RESULT operator=vector-add implementation=<name> runtime=<hip|triton> shape=<N> dtype=float32
```

Keep the existing block, grid, warmup, repeat, seed, correctness, timing, effective-bandwidth, and maximum-error fields unchanged.

- [ ] **Step 4: Refactor summary path handling and validation**

Add this CLI and path object to `summarize_results.py`:

```python
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chapter-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--git-commit", required=True)
    return parser.parse_args()


@dataclass(frozen=True)
class ChapterPaths:
    root: Path

    @property
    def logs(self) -> Path:
        return self.root / "logs"

    @property
    def profiles(self) -> Path:
        return self.root / "profiles"

    @property
    def evidence(self) -> Path:
        return self.root / "evidence"
```

Replace the local parser with `common.evidence.parse_result_line`, validate all aggregated rows, compute SHA-256 over the sorted Chapter 7 source files, and write a manifest with this shape:

Because the script is executed by path from `chapter7/`, add the Part 2 directory to the import path before importing the shared package:

```python
import sys

PART_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PART_DIR))

from common.evidence import parse_result_line, validate_manifest, validate_records
```

```python
manifest = {
    "operator": "vector-add",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "git_commit": args.git_commit,
    "source_sha256": source_sha256(paths.root),
    "hardware": read_environment_value(paths.logs / "environment.log", "torch.cuda.device_name"),
    "software": {
        "rocm": read_environment_value(paths.logs / "environment.log", "torch.version.hip"),
        "torch": read_environment_value(paths.logs / "environment.log", "torch"),
        "triton": read_environment_value(paths.logs / "environment.log", "triton"),
    },
    "benchmark": read_env_file(paths.logs / "benchmark_manifest.env"),
}
```

Write summary files to `evidence/summary.csv` and `evidence/summary.json`. Copy the selected trace columns into `evidence/profile_summary.csv`; use the literal `unavailable` when trace CSVs are absent or omit a field.

- [ ] **Step 5: Run the evidence and summary tests**

Run:

```bash
cd code/part2-kernels
python -m unittest tests.test_evidence tests.test_chapter7_summary -v
```

Expected: 4 tests, all `ok`.

- [ ] **Step 6: Run a remote red/green contract smoke test**

Before synchronizing the implementation change, validate one old remote `RESULT` line and confirm that it fails the new contract because `operator` and `shape` are absent. Synchronize with `bash scripts/part2-remote.sh sync`, then compile/run both routes at shape 1027:

```bash
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  'cd /home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels && source .venv/bin/activate && hipcc --offload-arch=gfx1201 -O3 -std=c++17 chapter7/vector_add_hip.hip -o /tmp/hello-gpu-ch7-contract && /tmp/hello-gpu-ch7-contract --version all --size 1027 --block 256 --warmup 0 --repeat 1 --seed 7 && python chapter7/vector_add_triton.py --version all --size 1027 --block 1024 --warmup 0 --repeat 1 --seed 7'
```

Expected: every HIP and Triton version reports `operator=vector-add`, `shape=1027`, `precheck=OK`, and `postcheck=OK`.

- [ ] **Step 7: Checkpoint Chapter 7 publication records**

Run:

```bash
git diff --check
git status --short
```

Expected: no raw remote output appears in the checkout.

- [ ] **Step 8: Commit the result contract migration**

```bash
git add \
  code/part2-kernels/chapter7/vector_add_hip.hip \
  code/part2-kernels/chapter7/vector_add_triton.py \
  code/part2-kernels/chapter7/summarize_results.py \
  code/part2-kernels/tests/test_chapter7_summary.py
git commit -m "refactor(part2): standardize chapter 7 result records"
```

Expected: one local commit; no push.

### Task 5: Fix Chapter 7 orchestration and metadata-derived plotting

**Files:**
- Modify: `code/part2-kernels/chapter7/run_all.sh`
- Modify: `code/part2-kernels/chapter7/profile_all.sh`
- Modify: `code/part2-kernels/chapter7/plot_vector_add_ch7.py`
- Create: `code/part2-kernels/tests/test_chapter7_plot_metadata.py`

**Interfaces:**
- Both shell entry points require `SOURCE_COMMIT` and pass it to `summarize_results.py`.
- `profile_all.sh` invokes the summarizer after all profiles are generated.
- `plot_vector_add_ch7.py --summary ... --manifest ... --out ...` derives hardware, software, shape, and independent-run labels from the manifest.

- [ ] **Step 1: Write a failing pure metadata formatting test**

```python
from __future__ import annotations

import unittest

from chapter7.plot_vector_add_ch7 import format_experiment_subtitle, format_experiment_note


class Chapter7PlotMetadataTest(unittest.TestCase):
    def test_plot_labels_come_from_manifest(self) -> None:
        manifest = {
            "hardware": "AMD Radeon RX 9070 XT",
            "software": {"rocm": "7.13", "torch": "2.11", "triton": "3.6"},
            "benchmark": {"size": "1024", "independent_runs": "5"},
        }
        self.assertIn("N=1,024", format_experiment_subtitle(manifest))
        self.assertIn("5 个独立进程", format_experiment_note(manifest))
```

- [ ] **Step 2: Run the metadata test and verify missing functions**

Run:

```bash
cd code/part2-kernels
python -m unittest tests.test_chapter7_plot_metadata -v
```

Expected: FAIL because the formatting functions do not exist.

- [ ] **Step 3: Make both run scripts carry the source commit**

At the top of each script, add:

```bash
SOURCE_COMMIT="${SOURCE_COMMIT:-}"
if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9a-f]{7,40}$ ]]; then
    echo "SOURCE_COMMIT must be a 7-40 character lowercase Git SHA" >&2
    exit 2
fi
```

Replace the `run_all.sh` summary call with:

```bash
python "${SCRIPT_DIR}/summarize_results.py" \
    --chapter-dir "${SCRIPT_DIR}" \
    --git-commit "${SOURCE_COMMIT}"
```

Append the same command to `profile_all.sh` after writing `profile_config.env`, so profile fields are refreshed automatically.

- [ ] **Step 4: Derive plot labels from the manifest**

Add `--manifest`, load JSON before CSV data, and implement:

```python
def format_experiment_subtitle(manifest: dict[str, object]) -> str:
    software = manifest["software"]
    benchmark = manifest["benchmark"]
    size = int(benchmark["size"])
    return (
        f'{manifest["hardware"]} | ROCm {software["rocm"]} | '
        f'N={size:,} FP32 | kernel-only GPU event 计时'
    )


def format_experiment_note(manifest: dict[str, object]) -> str:
    runs = int(manifest["benchmark"]["independent_runs"])
    return f"柱长 = {runs} 个独立进程 median 的中位数；误差线 = 独立进程范围。"
```

Replace the two hard-coded figure strings with these functions. Refuse to plot when summary shapes or run counts disagree with the manifest.

Move matplotlib-only imports into `main()` or a plotting helper called by `main()` so the metadata-formatting unit test does not require a local ROCm/matplotlib environment merely to import the pure functions.

- [ ] **Step 5: Run Chapter 7 unit and shell tests**

Run:

```bash
cd code/part2-kernels
python -m unittest discover -s tests -v
cd ../..
bash -n code/part2-kernels/chapter7/run_all.sh code/part2-kernels/chapter7/profile_all.sh
```

Expected: all Python tests pass and both shell scripts have valid syntax.

- [ ] **Step 6: Verify a missing commit fails loudly**

Run on the remote host after sync:

```bash
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  'cd /home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels && source .venv/bin/activate && bash chapter7/run_all.sh'
```

Expected: exit 2 with `SOURCE_COMMIT must be ...`; no publication summary is produced.

- [ ] **Step 7: Commit orchestration and plotting metadata fixes**

```bash
git add \
  code/part2-kernels/chapter7/run_all.sh \
  code/part2-kernels/chapter7/profile_all.sh \
  code/part2-kernels/chapter7/plot_vector_add_ch7.py \
  code/part2-kernels/tests/test_chapter7_plot_metadata.py
git commit -m "fix(part2): refresh chapter 7 profiling evidence"
```

Expected: one local commit; no push. `git rev-parse HEAD` now identifies the exact source used by Task 6.

### Task 6: Run the complete Chapter 7 experiment and track curated evidence

**Files:**
- Modify: `.gitignore`
- Create from verified remote evidence: `code/part2-kernels/chapter7/evidence/manifest.json`
- Create from verified remote evidence: `code/part2-kernels/chapter7/evidence/summary.csv`
- Create from verified remote evidence: `code/part2-kernels/chapter7/evidence/summary.json`
- Create from verified remote evidence: `code/part2-kernels/chapter7/evidence/profile_summary.csv`
- Create: `code/part2-kernels/chapter7/EXPERIMENT.md`
- Regenerate: `docs/part2-kernels/chapter7/images/vector-add-ch7-bandwidth.png`

**Interfaces:**
- Curated evidence is the only source for publication tables and figures.
- `EXPERIMENT.md` records exact commands, environment, manifest identity, result table, negative results, and evidence paths.

- [ ] **Step 1: Allow only curated evidence through ignore rules**

Append after the raw experiment ignore rules:

```gitignore
!code/part2-kernels/chapter*/EXPERIMENT.md
!code/part2-kernels/chapter*/evidence/
!code/part2-kernels/chapter*/evidence/**
```

Keep `logs/`, `profiles/`, and `results/` ignored.

- [ ] **Step 2: Synchronize the exact local source and record its commit**

Run:

```bash
SOURCE_COMMIT="$(git rev-parse HEAD)"
bash scripts/part2-remote.sh sync
printf '%s\n' "${SOURCE_COMMIT}"
```

Expected: a 40-character commit is printed and the remote sync exits 0.

- [ ] **Step 3: Run correctness, benchmarks, and profiles remotely**

Run:

```bash
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  "cd /home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels && source .venv/bin/activate && SOURCE_COMMIT=${SOURCE_COMMIT} bash chapter7/run_all.sh && SOURCE_COMMIT=${SOURCE_COMMIT} bash chapter7/profile_all.sh"
```

Expected: all correctness rows are `OK`, three independent runs are present for all seven implementations, profiles are written for all seven implementations, and the final summarizer reports seven implementations.

- [ ] **Step 4: Fetch curated evidence only**

Run:

```bash
bash scripts/part2-remote.sh fetch chapter7
```

Expected: `manifest.json`, `summary.csv`, `summary.json`, and `profile_summary.csv` appear under local `chapter7/evidence/`; no raw logs or traces appear.

- [ ] **Step 5: Validate fetched evidence before plotting**

Run:

```bash
cd code/part2-kernels
python -m unittest discover -s tests -v
python - <<'PY'
import csv
import json
from pathlib import Path

from common.evidence import validate_manifest, validate_records

root = Path("chapter7/evidence")
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
with (root / "summary.csv").open(encoding="utf-8", newline="") as file:
    records = list(csv.DictReader(file))
errors = validate_manifest(manifest) + validate_records(records)
if errors:
    raise SystemExit("\n".join(errors))
print(f"validated {len(records)} publication records")
PY
```

Expected: tests pass and seven publication records validate without access to ignored raw logs.

- [ ] **Step 6: Regenerate the publication figure from curated evidence**

Run:

```bash
cd code/part2-kernels
python chapter7/plot_vector_add_ch7.py \
  --summary chapter7/evidence/summary.csv \
  --manifest chapter7/evidence/manifest.json \
  --out ../../docs/part2-kernels/chapter7/images/vector-add-ch7-bandwidth.png
```

Expected: the image is regenerated and its subtitle matches `manifest.json`.

- [ ] **Step 7: Write the evidence-backed experiment record**

`EXPERIMENT.md` must contain these exact sections and obtain every numeric cell from `evidence/summary.csv` rather than memory:

```markdown
# Chapter 7 Vector Add Experiment

## Scope
## Source identity
## Hardware and software
## Correctness matrix
## Benchmark protocol
## Publication results
## Profiling evidence
## Negative results and limits
## Reproduction commands
## Curated evidence files
```

The limits section explicitly distinguishes logical effective bandwidth from physical GDDR6 traffic and says that the short implementation comparison does not establish a permanent HIP-versus-Triton winner.

- [ ] **Step 8: Confirm ignored and tracked artifact boundaries**

Run:

```bash
git check-ignore code/part2-kernels/chapter7/logs/example.log
git check-ignore code/part2-kernels/chapter7/profiles/example.csv
if git check-ignore -q code/part2-kernels/chapter7/evidence/summary.csv; then
  echo "curated summary is unexpectedly ignored" >&2
  exit 1
fi
if git check-ignore -q code/part2-kernels/chapter7/EXPERIMENT.md; then
  echo "EXPERIMENT.md is unexpectedly ignored" >&2
  exit 1
fi
git status --short
```

Expected: raw examples are ignored; curated evidence and `EXPERIMENT.md` are not ignored.

- [ ] **Step 9: Commit curated Chapter 7 evidence**

```bash
git add \
  .gitignore \
  code/part2-kernels/chapter7/EXPERIMENT.md \
  code/part2-kernels/chapter7/evidence \
  docs/part2-kernels/chapter7/images/vector-add-ch7-bandwidth.png
git commit -m "docs(part2): publish chapter 7 experiment evidence"
```

Expected: one local commit containing curated evidence only; no raw log or trace is staged and no push occurs.

### Task 7: Restructure the Chapter 7 reader path and add the Part 2 landing page

**Files:**
- Create: `docs/part2-kernels/index.md`
- Modify: `docs/part2-kernels/chapter7/index.md`
- Modify: `docs/part2-kernels/chapter12/index.md`
- Modify: `docs/.vitepress/outline.mjs`
- Modify: `docs/.vitepress/sync-outline.mjs`

**Interfaces:**
- Part 2 landing page defines prerequisites, six-chapter progression, HIP/Triton routes, experiment contract, and completion signals.
- Chapter 7 follows the approved ten-section teaching template and cites only curated evidence.
- Chapter 12 metadata changes from LeetGPU to Fused RMSNorm capstone; its body remains a clearly labeled outline until its own implementation phase.

- [ ] **Step 1: Add a Part 2 landing-page metadata test to the outline checker**

Modify the outline check so `npm run docs:check-outline` fails unless `docs/part2-kernels/index.md` exists and every Part 2 chapter declares `code`, `status`, and `summary` metadata.

Run:

```bash
npm run docs:check-outline
```

Expected before creating the page: FAIL naming `docs/part2-kernels/index.md`.

- [ ] **Step 2: Create the Part 2 landing page**

Use this section structure:

```markdown
# 第 2 篇：经典算子与 Kernel 实战

## 这篇解决什么问题
## 开始前你需要会什么
## 六章怎样递进
## HIP 与 Triton 两条路线
## 每章统一实验闭环
## 什么算完成
## 运行环境与证据入口
```

The progression is exactly Element-Wise → Reduction → Softmax → GEMM → Attention/Fusion → Fused RMSNorm. LeetGPU appears only in an extension paragraph under completion/practice, not as a chapter title.

- [ ] **Step 3: Update Part 2 outline metadata**

In `outline.mjs`:

- keep Chapter 7 through Chapter 11 titles approved in the design;
- change Chapter 12 title to `综合实战：Fused RMSNorm`;
- change its summary to `综合逐元素、归约与融合，独立完成一次可复现的 Kernel 优化闭环`;
- change its lead and sections to the approved RMSNorm capstone scope;
- preserve chapter numbers 7–12 and the following Part 3 numbering.

Replace the Chapter 12 body with a concise RMSNorm phase outline using these sections, without performance numbers:

```markdown
## 12.1 从 LayerNorm 到 RMSNorm
## 12.2 固定数学语义、误差和目标 Shape
## 12.3 HIP：从分步 Baseline 到融合实现
## 12.4 Triton：一行一个 Program
## 12.5 正确性、Benchmark 与 Profiling
## 12.6 独立优化记录与失败回退
## 12.7 从 RMSNorm 迁移到新题目
## 12.8 拓展练习：LeetGPU 与其他平台
```

- [ ] **Step 4: Reorganize Chapter 7 without discarding verified explanations**

Chapter 7 uses these top-level sections:

```markdown
## 本章目标、前置知识与产物
## 7.1 先认识 Element-Wise
## 7.2 固定数学语义与正确性标准
## 7.3 建立成本模型和瓶颈假设
## 7.4 HIP：从标量线程到受控访存实验
## 7.5 Triton：从最小 Tile 到参数实验
## 7.6 正确性、Benchmark 与 Profiling
## 7.7 HIP 与 Triton 对照
## 7.8 负结果、适用边界与下一步
## 7.9 复跑、练习与验收
```

Move existing explanations into these sections, remove repeated environment setup and long Roofline introductions already taught in Chapters 3–6, and source every result table from the new evidence files.

- [ ] **Step 5: Synchronize generated outline content**

Run:

```bash
npm run docs:sync-outline
npm run docs:check-outline
```

Expected: README, navigation metadata, Chapter 7, and the new Chapter 12 metadata are synchronized; the check exits 0.

- [ ] **Step 6: Check links and forbidden stale claims**

Run:

```bash
rg -n "LeetGPU|3-5x|永久.*赢家|待 job|待补实验" \
  docs/part2-kernels README.md docs/.vitepress/outline.mjs
```

Expected: LeetGPU appears only as extension practice; no `3-5x`, permanent-winner, or untracked experiment claim remains in Chapter 7 or the Part 2 landing page. Outline-only future chapters may state their current phase without numeric claims.

- [ ] **Step 7: Commit the Part 2 reader-path update**

```bash
git add \
  README.md \
  docs/part2-kernels/index.md \
  docs/part2-kernels/chapter7/index.md \
  docs/part2-kernels/chapter12/index.md \
  docs/.vitepress/outline.mjs \
  docs/.vitepress/sync-outline.mjs
git commit -m "docs(part2): establish the six-chapter learning path"
```

Expected: one local commit; no push.

### Task 8: Run the Phase 1 verification gate

**Files:**
- Verify all files changed by Tasks 1–7

**Interfaces:**
- Produces: a clean, reviewable Chapter 7 template and evidence contract suitable for the Chapter 8 plan.

- [ ] **Step 1: Run all local source checks**

Run:

```bash
cd code/part2-kernels
python -m unittest discover -s tests -v
cd ../..
for shell_file in scripts/*.sh code/*/*.sh code/*/chapter*/*.sh; do
  [ -f "${shell_file}" ] || continue
  bash -n "${shell_file}"
done
python3 - <<'PY'
import ast
from pathlib import Path
for path in sorted(Path("code").rglob("*.py")):
    ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
print("python AST: PASS")
PY
npm run docs:check-outline
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Build the documentation site**

Run:

```bash
npm install
npm run docs:build
```

Expected: VitePress build exits 0; the Part 2 landing page and Chapter 7 render without missing imports, figures, or anchors.

- [ ] **Step 3: Re-run the remote Chapter 7 publication path from the synchronized source**

Run:

```bash
SOURCE_COMMIT="$(git rev-parse HEAD)"
bash scripts/part2-remote.sh sync
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  "cd /home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels && source .venv/bin/activate && SOURCE_COMMIT=${SOURCE_COMMIT} bash chapter7/run_all.sh && SOURCE_COMMIT=${SOURCE_COMMIT} bash chapter7/profile_all.sh"
bash scripts/part2-remote.sh fetch chapter7
```

Expected: all seven implementations pass correctness, each has three independent process records, and refreshed curated evidence includes profile fields or explicit `unavailable` values.

- [ ] **Step 4: Verify the repository contains no accidental generated files**

Run:

```bash
git status --short
git check-ignore -v \
  code/part2-kernels/chapter7/logs/example.log \
  code/part2-kernels/chapter7/profiles/example.csv
```

Expected: only intended source, documentation, curated evidence, and the final figure are visible; raw experiment paths remain ignored.

- [ ] **Step 5: Review the phase against the approved design**

Confirm all of these statements from repository files and fresh command output:

- Chapter 7 has HIP and Triton implementations and both pass the edge-shape matrix.
- Publication results use three independent processes.
- Profiling happens before the final evidence refresh.
- Plot labels come from the manifest.
- Every published numeric claim is present in curated evidence.
- Part 2 has a reader-facing landing page and Chapter 12 is Fused RMSNorm.
- No full trace, log, virtual environment, or compiler cache is tracked.

Expected: all seven statements are supported; any unsupported statement blocks Phase 1 completion.
