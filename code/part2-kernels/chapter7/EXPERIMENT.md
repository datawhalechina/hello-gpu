# Chapter 7 Vector Add Experiment

## Scope

本记录发布 Chapter 7 Vector Add 在指定 AMD GPU 上的完整正确性、benchmark 与 kernel-trace 实验。发布表格与图只读取 `chapter7/evidence/` 中的 curated evidence；远端 raw logs、profiles 与 results 不进入仓库。

## Source identity

- Git commit: `7a518acb9ee6e0285b238b1532a7619767c66511`
- Chapter source SHA-256: `1dea46e7a255fe057dd30225f2a3aa93faa5a77d0262cabd8db637eae9a19e82`
- Evidence generated at: `2026-07-19T05:33:12.614236+00:00`
- Manifest identity: `evidence/manifest.json`

## Hardware and software

| Item | Evidence value |
| --- | --- |
| GPU | AMD Radeon RX 9070 XT |
| GPU architecture | `gfx1201` |
| ROCm / HIP runtime | `7.13.99004` |
| PyTorch | `2.11.0+rocm7.13.0` |
| Triton | `3.6.0` |

## Correctness matrix

以下每个发布行均来自独立进程结果的汇总；`max_abs_error` 与 correctness 状态直接取自 `evidence/summary.csv`。`run_all.sh` 还在正式计时前执行边界尺寸检查与 Triton visualization 检查。

| Implementation | Runtime | Shape | Block | Grid | Correct | Max abs error |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| `hip-v0` | hip | 16777216 | 256 | 65536 | OK | 0.0 |
| `hip-v1-contiguous` | hip | 16777216 | 256 | 2048 | OK | 0.0 |
| `hip-v1-strided` | hip | 16777216 | 256 | 2048 | OK | 0.0 |
| `hip-v2` | hip | 16777216 | 256 | 256 | OK | 0.0 |
| `hip-v3` | hip | 16777216 | 256 | 256 | OK | 0.0 |
| `triton-t0` | triton | 16777216 | 256 | 65536 | OK | 0.0 |
| `triton-t1` | triton | 16777216 | 1024 | 16384 | OK | 0.0 |

## Benchmark protocol

| Parameter | Evidence value |
| --- | ---: |
| Shape | 16777216 |
| Dtype | float32 |
| Warmup iterations | 10 |
| Timed repetitions per process | 50 |
| Independent processes | 3 |
| Seed | 20260716 |
| HIP block | 256 |
| Triton block | 1024 |

计时范围是 kernel-only GPU event。每个发布值先在单个独立进程内取 timed repetitions 的 median，再对独立进程的 median 取中位数；区间列给出这些进程级 median 的最小值与最大值。

## Publication results

| Implementation | Median (ms) | Run range (ms) | Logical effective bandwidth (GB/s) | Run range (GB/s) |
| --- | ---: | ---: | ---: | ---: |
| `hip-v0` | 0.335586 | 0.335325–0.335805 | 599.925459 | 599.534232–600.392426 |
| `hip-v1-contiguous` | 0.366706 | 0.366426–0.369005 | 549.013631 | 545.592408–549.433165 |
| `hip-v1-strided` | 2.535119 | 2.52336–2.55268 | 79.415048 | 78.868715–79.785128 |
| `hip-v2` | 0.342345 | 0.341845–0.342386 | 588.080162 | 588.011442–588.940306 |
| `hip-v3` | 0.342065 | 0.342046–0.342185 | 588.562373 | 588.355128–588.595091 |
| `triton-t0` | 0.336685 | 0.335885–0.338385 | 597.966339 | 594.963109–599.391455 |
| `triton-t1` | 0.338705 | 0.338445–0.339326 | 594.400998 | 593.313201–594.856756 |

## Profiling evidence

`profile_all.sh` 为每个实现启动独立的 `rocprofv3` kernel trace；下表逐字段来自 `evidence/profile_summary.csv`。若 trace 缺失、缺少 kernel 名列，或某个字段在目标 dispatch 间不唯一，对应字段会显式写成 `unavailable`，不会静默推断。

| Implementation | Dispatches | Grid X | Workgroup X | LDS B | Scratch B | VGPR | Accum VGPR | SGPR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `hip-v0` | 11 | 16777216 | 256 | 0 | 0 | 8 | 0 | 128 |
| `hip-v1-contiguous` | 11 | 524288 | 256 | 0 | 0 | 16 | 0 | 128 |
| `hip-v1-strided` | 11 | 524288 | 256 | 0 | 0 | 16 | 0 | 128 |
| `hip-v2` | 11 | 65536 | 256 | 0 | 0 | 16 | 0 | 128 |
| `hip-v3` | 11 | 65536 | 256 | 0 | 0 | 16 | 0 | 128 |
| `triton-t0` | 11 | 8388608 | 128 | 0 | 0 | 8 | 0 | 128 |
| `triton-t1` | 11 | 2097152 | 128 | 0 | 0 | 24 | 0 | 128 |

## Negative results and limits

- 受控的 HIP 跨步实现是本次明显负例：median 为 2.535119 ms，logical effective bandwidth 为 79.415048 GB/s；它验证了地址布局会主导这个带宽敏感算子。
- 本次短实验中 `hip-v0` 与 `triton-t0` 的 logical effective bandwidth 分别为 599.925459 GB/s 与 597.966339 GB/s。这个有限 shape、软件栈与短协议的比较不建立永久的 HIP-versus-Triton winner。
- logical effective bandwidth 是按算子语义所需的逻辑读写字节计算的比较指标，logical effective bandwidth ≠ physical GDDR6 traffic。当前 kernel trace 也不是物理显存流量计数器证据。
- 这些结果只适用于 manifest 记录的硬件、软件、shape、block、warmup、repeat 与独立进程协议；不能外推到其他算子、shape 或系统状态。

## Reproduction commands

在仓库根目录同步并远程执行：

```bash
export SOURCE_COMMIT="$(git rev-parse HEAD)"
bash scripts/part2-remote.sh sync
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  "cd /home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels && source .venv/bin/activate && SOURCE_COMMIT=${SOURCE_COMMIT} bash chapter7/run_all.sh && SOURCE_COMMIT=${SOURCE_COMMIT} bash chapter7/profile_all.sh"
bash scripts/part2-remote.sh fetch chapter7
```

从仓库内 `code/part2-kernels` 验证并生成发布图：

```bash
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
python chapter7/plot_vector_add_ch7.py \
  --summary chapter7/evidence/summary.csv \
  --manifest chapter7/evidence/manifest.json \
  --out ../../docs/part2-kernels/chapter7/images/vector-add-ch7-bandwidth.png
```

## Curated evidence files

- `evidence/manifest.json`
- `evidence/summary.csv`
- `evidence/summary.json`
- `evidence/profile_summary.csv`
- `../../../docs/part2-kernels/chapter7/images/vector-add-ch7-bandwidth.png`
