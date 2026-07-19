# Chapter 7 Vector Add Experiment

## Scope

本记录发布 Chapter 7 Vector Add 在指定 AMD GPU 上的完整正确性、benchmark 与 kernel-trace 实验。发布表格与图只读取 `chapter7/evidence/` 中的 curated evidence；远端 raw logs、profiles 与 results 不进入仓库。

## Source identity

- Git commit: `9832d1e91d9f6bce7888005b5ef9bca60e3c6fdf`
- Chapter source SHA-256: `e3e32487b36b1168fd291f87dc8c49adf22f5beb73eb673f2efd867a4d8d33da`
- Evidence generated at: `2026-07-19T05:54:40.408571+00:00`
- Manifest identity: `evidence/manifest.json`

## Hardware and software

| Item | Evidence value |
| --- | --- |
| GPU | AMD Radeon RX 9070 XT |
| GPU architecture | `gfx1201` |
| OS | Ubuntu 24.04.4 LTS |
| Virtualization | `none` |
| Execution | `native` |
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
| `hip-v0` | 0.336263 | 0.336163–0.336263 | 598.716769 | 598.716769–598.894875 |
| `hip-v1-contiguous` | 0.369564 | 0.368244–0.369643 | 544.767872 | 544.650711–546.721372 |
| `hip-v1-strided` | 2.559888 | 2.549787–2.563447 | 78.646641 | 78.537436–78.958202 |
| `hip-v2` | 0.338584 | 0.338523–0.340203 | 594.613415 | 591.782847–594.720571 |
| `hip-v3` | 0.342123 | 0.341663–0.342303 | 588.462602 | 588.152304–589.254032 |
| `triton-t0` | 0.337544 | 0.337444–0.337843 | 596.446356 | 595.916738–596.622218 |
| `triton-t1` | 0.339224 | 0.339163–0.339764 | 593.491574 | 592.548335–593.597465 |

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

- 受控的 HIP 跨步实现是本次明显负例：median 为 2.559888 ms，logical effective bandwidth 为 78.646641 GB/s；它验证了地址布局会主导这个带宽敏感算子。
- 本次短实验中 `hip-v0` 与 `triton-t0` 的 logical effective bandwidth 分别为 598.716769 GB/s 与 596.446356 GB/s。这个有限 shape、软件栈与短协议的比较不建立永久的 HIP-versus-Triton winner。
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

从仓库内 `code/part2-kernels` 验证 curated evidence：

```bash
python3 -m unittest discover -s tests -v
python3 - <<'PY'
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
cd ../..
```

使用远端 Part 2 `.venv` 从 curated evidence 生成图，然后只传回最终 PNG：

```bash
ssh -o BatchMode=yes hwj-frp-9070xt-2404 \
  "cd /home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels && source .venv/bin/activate && python chapter7/plot_vector_add_ch7.py --summary chapter7/evidence/summary.csv --manifest chapter7/evidence/manifest.json --out chapter7/evidence/vector-add-ch7-bandwidth.png"
rsync -az \
  hwj-frp-9070xt-2404:/home/hellogpu/hdb/hello-gpu-part2/code/part2-kernels/chapter7/evidence/vector-add-ch7-bandwidth.png \
  docs/part2-kernels/chapter7/images/vector-add-ch7-bandwidth.png
```

## Curated evidence files

- `evidence/manifest.json`
- `evidence/summary.csv`
- `evidence/summary.json`
- `evidence/profile_summary.csv`
- `../../../docs/part2-kernels/chapter7/images/vector-add-ch7-bandwidth.png`
