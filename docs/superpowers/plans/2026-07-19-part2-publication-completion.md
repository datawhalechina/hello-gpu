# Part 2 Publication Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Chapters 7–12 from a complete teaching draft into a locally committed, reproducible Part 2 publication with validated remote runs, profiling evidence, experiment records, and no fabricated performance claims.

**Architecture:** Chapter implementations remain self-contained. A standard-library-only publisher consumes three independent process logs plus environment/profile extracts and writes curated `manifest.json`, `summary.csv`, `summary.json`, and `profile_summary.csv`; raw logs and traces stay untracked. The RX 9070 XT is used sequentially so chapter measurements do not contend with one another.

**Tech Stack:** Bash, Python 3.12, HIP/ROCm 7.13, Triton 3.6, rocprofv3, VitePress.

## Global Constraints

- Local `dev` is the source of truth; do not modify `main` and do not push.
- Preserve the unrelated `docs/.DS_Store` modification and never stage it.
- Use only `/home/hellogpu/hdb/hello-gpu-part2` on `hwj-frp-9070xt-2404`.
- Run GPU experiments sequentially; three independent processes per chapter.
- Do not track raw logs, compiler caches, virtual environments, or full profiler traces.
- Every published number must come from curated evidence generated from the final source commit.
- LeetGPU remains an extension exercise only.

---

### Task 1: Close Chapter 7 evidence and remote-wrapper findings

**Files:**
- Modify: `scripts/part2-remote.sh`
- Modify: `scripts/test-part2-remote.sh`
- Modify: `code/part2-kernels/chapter7/run_all.sh`
- Modify: `code/part2-kernels/chapter7/profile_all.sh`
- Modify: `code/part2-kernels/chapter7/summarize_results.py`
- Modify: `code/part2-kernels/chapter7/plot_vector_add_ch7.py`
- Test: `code/part2-kernels/tests/test_chapter7_summary.py`
- Test: `code/part2-kernels/tests/test_chapter7_plot_metadata.py`

**Interfaces:**
- Consumes: existing Chapter 7 `RESULT` records and `SOURCE_COMMIT`.
- Produces: evidence refresh that rejects stale source/log/profile mixtures and unsafe rsync roots.

- [ ] Add failing tests for stale source identity, mixed record metadata, fewer than three process sources, unsafe remote roots, and dynamic Triton labels.
- [ ] Run the focused tests and confirm each new case fails for the intended reason.
- [ ] Persist and validate benchmark source identity/config before evidence writes; stage evidence before replacement.
- [ ] Make rsync operate through a validated remote helper/endpoint and strengthen fake-rsync assertions.
- [ ] Run focused and full local tests.
- [ ] Commit the fix without evidence; rerun Chapter 7 after the final source commit is known.

### Task 2: Add the reusable publication evidence pipeline

**Files:**
- Create: `code/part2-kernels/common/publication.py`
- Create: `code/part2-kernels/tests/test_publication.py`
- Create: `code/part2-kernels/tools/publish_chapter.py`

**Interfaces:**
- Consumes: `--chapter-dir`, `--operator`, `--git-commit`, three `--run-log` files, optional profile CSV directory, and environment key/value file.
- Produces: atomically replaced `evidence/manifest.json`, `summary.csv`, `summary.json`, and `profile_summary.csv`.

- [ ] Write tests using three temporary logs with quoted `RESULT` records and explicit process source names.
- [ ] Add negative tests for missing/duplicate process rows, mixed main shapes, non-finite times, incorrect rows, and partial output on failure.
- [ ] Implement parsing, exact three-source validation, per-implementation aggregation, environment manifest creation, profile extraction, and staged replacement.
- [ ] Run `python3 -m unittest tests.test_publication -v` and the complete Part 2 suite.
- [ ] Document the exact CLI in `--help` and commit the pipeline.

### Task 3: Standardize Chapter 8–12 formal-run entrypoints

**Files:**
- Modify: `code/part2-kernels/chapter8/run_all.sh`
- Modify: `code/part2-kernels/chapter9/run_all.sh`
- Modify: `code/part2-kernels/chapter10/run_all.sh`
- Modify: `code/part2-kernels/chapter11/run_all.sh`
- Modify: `code/part2-kernels/chapter12/run_all.sh`
- Create: `code/part2-kernels/chapter8/profile_all.sh`
- Create: `code/part2-kernels/chapter9/profile_all.sh`
- Create: `code/part2-kernels/chapter10/profile_all.sh`
- Create: `code/part2-kernels/chapter11/profile_all.sh`
- Create: `code/part2-kernels/chapter12/profile_all.sh`

**Interfaces:**
- Consumes: chapter-specific shape variables plus `WARMUP`, `REPEAT`, `RUN_EDGE_CASES`, and `GPU_ARCH`.
- Produces: one deterministic stdout log per process and one kernel trace per implementation/configuration.

- [ ] Make all five run scripts accept `RUN_EDGE_CASES=0` for formal repeated runs while retaining edge checks by default.
- [ ] Add fail-fast profile scripts that compile once, profile each published implementation, and never publish results themselves.
- [ ] Validate shell syntax and ensure every documented command matches an existing CLI.
- [ ] Commit the entrypoints before remote execution.

### Task 4: Run final-source experiments sequentially

**Files produced locally after fetch:**
- `code/part2-kernels/chapter{7,8,9,10,11,12}/evidence/*`

- [ ] Commit all source/tooling/editorial fixes and record `SOURCE_COMMIT=$(git rev-parse HEAD)`.
- [ ] Synchronize with `bash scripts/part2-remote.sh sync`.
- [ ] For each chapter 7–12, run edge correctness once, then run its main shape in three independent processes with fixed seed/warmup/repeat.
- [ ] Run `profile_all.sh` after the three benchmark processes.
- [ ] Fetch raw output only into a repository-external temporary directory.
- [ ] Run `tools/publish_chapter.py` locally and validate every curated file before copying it into the chapter evidence directory.
- [ ] Confirm no GPU process from another chapter overlapped the measured interval.

### Task 5: Publish experiment records and figures

**Files:**
- Create: `code/part2-kernels/chapter{8,9,10,11,12}/EXPERIMENT.md`
- Create: `docs/part2-kernels/chapter{8,9,10,11,12}/images/*-performance.png`
- Modify: `docs/part2-kernels/chapter{8,9,10,11,12}/index.md`
- Modify: `docs/part2-kernels/index.md`

- [ ] Generate one readable comparison figure per chapter from its curated summary.
- [ ] Write hardware/software, exact commands, correctness, protocol, result table, profiling table, negative result, and limitations from evidence only.
- [ ] Replace “awaiting formal experiment” text with links to evidence and experiment records.
- [ ] Keep claims scoped to the measured shape and mark JIT/compile time outside kernel-only timing.
- [ ] Build the docs and visually inspect all five new figures.

### Task 6: Final editorial and verification gate

**Files:**
- Modify only exact factual/link/style issues found in `docs/part2-kernels/**` and `README.md`/outline metadata.

- [ ] Add primary official references for HIP, rocprofv3, Triton reductions/softmax/matmul/attention, and RMSNorm.
- [ ] Run all Python unit tests, Shell syntax checks, Python AST checks, outline check, VitePress build, and `git diff --check`.
- [ ] Validate curated evidence against the committed source identity and scan tracked files for raw logs/traces/caches.
- [ ] Perform a focused whole-branch review; fix only Critical/Important publication blockers.
- [ ] Commit the publication artifacts on local `dev`; leave `origin/dev` untouched and report the remaining unrelated `docs/.DS_Store` modification.
