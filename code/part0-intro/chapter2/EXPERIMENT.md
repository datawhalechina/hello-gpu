# Chapter 2 RX 9070 XT experiment record

This record separates the benchmark source identity from later documentation
and evidence-tooling commits. The four HIP programs and the formal runner were
measured from this detached commit:

```text
2107e8a171b9599063468854caccc04de4ea147e
```

## Environment

The capture was taken on 2026-07-26 at `13:48 +08:00`.

| Item | Observed value |
| --- | --- |
| Host | `hwj-MS-Terminator-B760M-D5` |
| OS | Ubuntu 24.04-family host, Linux `7.0.0-28-generic`, x86-64 |
| GPU | AMD Radeon RX 9070 XT |
| ROCm agent | `gfx1201` |
| Physical compute units reported by `rocminfo` | 64 |
| Wavefront size | 32 |
| HIP compiler | HIP `7.13.99004-3309c6114a`, AMD clang 23 |
| rocprofv3 | `1.3.0`, ROCm `7.13.0` |
| Python environment | CPython 3.12.3, lock-file environment created by `uv sync --frozen` |

`hipDeviceProp::multiProcessorCount` reports 32 on this machine. The programs
therefore label that runtime value as `hip_multiprocessor_count=32`; they do
not relabel it as the 64 physical compute units reported by `rocminfo`.

## Protocol

All ten implementation pairs used the same shapes, seed, warmup count, and
repeat count. Each formal process compiled the four sources once, ran
sequentially, and exited before the next process started.

| Experiment | Formal shape | Implementations |
| --- | --- | --- |
| Branch divergence | `N=16,777,216`, FP32 | `wave-uniform`, `wave-divergent` |
| Global memory | `N=16,777,216`, FP32 | `stride-1`, `stride-17`, `stride-257` |
| LDS banks | `N=16,777,216`, FP32, 256 LDS reads/item | `stride-1`, `stride-32`, `stride-33` |
| Matrix path | batch 4,096 of 16×16×16 FP16→FP32 products | `valu`, `wmma` |

Formal settings were `warmup=10`, `repeat=50`, and `seed=20260726`.
The reported value is the median of the three process medians. Bracketed
ranges below are the minimum and maximum process medians, not the 50
within-process samples.

Before the formal runs, `RUN_EDGE_CASES=1 WARMUP=1 REPEAT=1` passed at the same
source commit. Every formal and edge row reported:

```text
timed=1 correct=OK precheck=OK postcheck=OK
```

## Results

| Experiment | Implementation | Median ms [process range] | Primary teaching metric [process range] |
| --- | --- | ---: | ---: |
| Branch divergence | `wave-uniform` | 0.237341 [0.237041, 0.239320] | 0.565507 TFLOPS [0.560830, 0.566222] |
| Branch divergence | `wave-divergent` | 0.245241 [0.243860, 0.246920] | 0.547289 TFLOPS [0.543567, 0.550388] |
| Global memory | `stride-1` | 0.235040 [0.231941, 0.237641] | 571.042 GB/s [564.792, 578.673] |
| Global memory | `stride-17` | 0.771721 [0.770461, 0.772321] | 173.920 GB/s [173.785, 174.204] |
| Global memory | `stride-257` | 1.887641 [1.884983, 1.923662] | 71.103 GB/s [69.772, 71.204] |
| LDS banks | `stride-1` | 8.075865 [8.065751, 8.096146] | 0.531828 TFLOPS [0.530495, 0.532494] |
| LDS banks | `stride-32` | 42.218658 [41.267262, 52.018600] | 0.101731 TFLOPS [0.082566, 0.104077] |
| LDS banks | `stride-33` | 8.093651 [6.570887, 8.099028] | 0.530659 TFLOPS [0.530307, 0.653636] |
| Matrix path | `valu` | 0.037200 [0.036080, 0.038320] | 0.902001 TFLOPS [0.875638, 0.930001] |
| Matrix path | `wmma` | 0.016160 [0.016121, 0.016160] | 2.076388 TFLOPS [2.076388, 2.081476] |

The source-of-truth numbers are
[`evidence/summary.csv`](evidence/summary.csv), not this rounded table.

## Bounded conclusions

### Branch divergence

`wave-divergent` was 3.33% slower than `wave-uniform` at the central process
medians. This is a deliberately small, controlled teaching kernel: both paths
perform four dependent FP32 FMAs. The result demonstrates a measurable cost
for this predicate and instruction mix on this RX 9070 XT; it does not imply a
universal percentage penalty for divergent branches.

The final gfx1201 disassembly contains `s_and_saveexec_b32` and
`s_cbranch_execz` in both specializations, with the divergent specialization
using the lane predicate. No matched `v_cndmask` appeared in the audit. The
full disassembly SHA-256 was:

```text
d777b24f90b0b46acdaed41d26cf2dfc6538bfa81e1d611aca93297517bdf7fd
```

### Global memory

Relative to `stride-1`, logical bandwidth fell 69.54% at `stride-17` and
87.55% at `stride-257`. The kernel performs one logical FP32 load and one
logical FP32 store per output and uses an odd-stride permutation over a
power-of-two allocation.

**Logical bandwidth is not physical GDDR6 traffic.** It is computed from the
algorithmic bytes (`2 × N × sizeof(float)`) divided by kernel time. Cache-line
fetches, write behavior, Infinity Cache, and other physical traffic are not
measured by this number.

### LDS banks

`stride-32` took 5.23× the `stride-1` time (422.78% slowdown at the central
medians). `stride-33` returned to essentially the same central median as
`stride-1` (+0.22%), although one `stride-33` process was faster and the
three-process range was wider. The robust conclusion is the large
`stride-32` penalty in this wave32/shared-memory indexing pattern; the small
`stride-1` versus `stride-33` difference is not treated as significant.

The reported LDS “logical GB/s” counts requested LDS reads. It is not HBM or
GDDR6 bandwidth.

### Matrix path

The teaching WMMA path achieved 2.30× the throughput of the scalar VALU path
for the same independent 16×16×16 products. WMMA correctness was checked
against the CPU FP32 reference; the smoke-run maximum absolute error was
`2.98e-08`.

This teaching WMMA comparison is **not** a rocBLAS/library benchmark. It has no
tiling across larger matrices, no double buffering, no production epilogue,
and no claim to approach the RX 9070 XT theoretical matrix peak. It isolates
the gfx12 fragment layout and intrinsic journey.

## Profile validation

`rocprofv3 --kernel-trace` ran once per implementation in ten separate output
directories. The curated
[`evidence/profile_summary.csv`](evidence/profile_summary.csv) contains all ten
pairs and the intended specialized kernel names. Some traces also contain
runtime copy kernels from setup; those are preserved rather than hidden.

The profile configuration binds the source commit, observed hardware,
offload target read from the compiled binary, source hashes, binary hashes,
and exact actual/replay argument vectors. The published profile directory was
an atomic symlink to an immutable version directory.

## Exact commands

Environment preparation in a detached checkout:

```bash
git switch --detach 2107e8a171b9599063468854caccc04de4ea147e
cd code/part0-intro
/home/hellogpu/.local/bin/uv sync --frozen
```

Edge validation:

```bash
RUN_EDGE_CASES=1 WARMUP=1 REPEAT=1 SEED=20260726 \
  bash chapter2/run_all.sh
```

Three independent formal processes, run sequentially:

```bash
RUN_EDGE_CASES=0 WARMUP=10 REPEAT=50 SEED=20260726 \
  bash chapter2/run_all.sh > /tmp/chapter2-process-1.log
RUN_EDGE_CASES=0 WARMUP=10 REPEAT=50 SEED=20260726 \
  bash chapter2/run_all.sh > /tmp/chapter2-process-2.log
RUN_EDGE_CASES=0 WARMUP=10 REPEAT=50 SEED=20260726 \
  bash chapter2/run_all.sh > /tmp/chapter2-process-3.log
```

Per-implementation kernel traces:

```bash
WARMUP=1 REPEAT=1 SEED=20260726 \
  bash chapter2/profile_all.sh /tmp/chapter2-profiles
```

Curated evidence publication:

```bash
python3 chapter2/result_contract.py \
  --run-log /tmp/chapter2-process-1.log \
  --run-log /tmp/chapter2-process-2.log \
  --run-log /tmp/chapter2-process-3.log \
  --profile-dir /tmp/chapter2-profiles \
  --source-commit 2107e8a171b9599063468854caccc04de4ea147e \
  --evidence-dir chapter2/evidence
```

Figure generation:

```bash
python3 chapter2/plot_results.py \
  --summary chapter2/evidence/summary.csv \
  --output ../../docs/part0-intro/chapter2/images/chapter2-labs.png
```

ISA audit:

```bash
hipcc --offload-arch=gfx1201 -O3 -std=c++17 \
  '-DCHAPTER2_SOURCE_COMMIT="2107e8a171b9599063468854caccc04de4ea147e"' \
  chapter2/branch_divergence.hip -o branch_divergence
llvm-objdump --offloading branch_divergence
llvm-objdump -d --mcpu=gfx1201 \
  branch_divergence.0.hipv4-amdgcn-amd-amdhsa--gfx1201
```

Raw process logs and full traces are intentionally not committed. The
repository contains validated summaries, the result figure, reproducible
commands, source identity, and bounded conclusions.
