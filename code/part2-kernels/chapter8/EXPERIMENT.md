# Chapter 8 Vector Add Experiment

## 2026-09-20：问题驱动的教学重组

正文性能比较继续使用 `evidence/walkthrough/` 的 11 配置、33 独立进程、1650 个 event 样本和五张 walkthrough 图。当前 kernel 与冻结源码一致，本轮不重跑性能矩阵，不改写旧日志、采集顺序或性能数值。

教学主线保留 HIP v0 与 Triton tile256 的基线 trace；Triton 扫描后的资源问题只追加读取 tile2048，与已采基线配对。地址对照、grid 扫描、四元素分组仍逐项校验和 benchmark，不再要求每项重复采集 trace。全部原 trace 继续归档。PMC 与 ATT 为有具体问题时的选读；当前 ATT 验证组仍是 agent3208、指令 Hitcount4124，范围见 tool-audit。

新增公开入口 `evidence/boundary-check/` 从已有独立确认组逐字节提取 12 项正确性日志，不是新增 GPU 测量，完整来源与哈希见其 manifest。它使用同源的独立冻结 binary，不冒称 walkthrough binary；无预热、单次执行的 event 数不作为性能成绩。

实际新增验证仅为 `evidence/operation-check/` 的终端操作：六个独立 shell 检查锁文件同步、环境激活、新建/恢复 RUN、初编译/跳过已有 binary、结果拒绝追加。只运行一次 N=17、warmup=0、repeat=1 的正确性 smoke，不用于新性能结论。小日志、命令、身份与前后哈希均已落盘；远端没有执行 Git。

`run_rounds.py` 默认阶段改为 `main`，帮助信息明确额外诊断与验证阶段；显式 `--phase all` 保留兼容。kernel、配置矩阵、正式参数没有变。CPU 行为测试检查默认不进入 profile/validation、显式阶段保持原顺序且复用冻结 manifest。读者如需完整三进程归档，可显式运行 `--phase main`，不用为每轮性能比较采集全矩阵 trace。

## 2026-09-20：ROCm 10.0 逐轮受控实验

当前正式实验位于 [`evidence/rounds/README.md`](evidence/rounds/README.md)。本次运行于 RX 9070 XT / gfx1201、原生 Ubuntu 24.04.5、ROCm SDK 10.0.0 / HIP 7.15.26333，PyTorch 2.13.0、Triton 3.8.0。

- 主输入 N=16,777,216，11 个配置，每配置 3 个独立进程，warmup=10，repeat=50，seed=20260920。
- 包含原七版基线、固定 v2 kernel 的 grid=65536/2048/256 对照、相同 grid=256 的 v2/v3 对照，以及固定 num_warps=4 的 Triton tile=256/512/1024/2048 对照。
- 所有 11 个配置另采独立 kernel trace，各有 1 次 precheck + 5 次 warmup + 10 次重复；不把 profiler 下的 event 时间混入性能表。
- 对选定 4 个配置补测 N=1,048,576 和 4,194,304，共计 57 个独立计时进程、2850 个原始 event 样本；56 个小尺寸正确性检查与 11 个 N=16,777,219 尾部检查全部通过。
- 原始源码快照、样本、日志、trace、编译中间结果和实际命令均位于 `results/rocm10-20260920/`。公开摘要在 `evidence/rounds/`，旧根目录证据未覆盖。
- HIP 源码 SHA-256：`73e1af89d25a91fb35ee78198ce74c93d617a9ac5a0852ff74d20abd2184aa80`；Triton 源码 SHA-256：`831525557254b8cf17965403972491e6b95cac63dc1c9a343af49366752fa893`。其他源码和二进制哈希见 manifest。
- 本次 ISA 中 v2 主循环为 `global_load_b32` / `global_store_b32`，v3 主循环为 `global_load_b128` / `global_store_b128`，尾部仍为 b32。指令宽度证据未建立单独的性能因果。

实际运行入口（已激活 Part 2 环境，工作目录 `code/part2-kernels/`）：

```bash
python chapter8/run_rounds.py --output chapter8/results/rocm10-20260920 --phase main
python chapter8/run_rounds.py --output chapter8/results/rocm10-20260920 --phase profile
python chapter8/run_rounds.py --output chapter8/results/rocm10-20260920 --phase validation
python chapter8/summarize_rounds.py chapter8/results/rocm10-20260920 --out chapter8/evidence/rounds
```

NaN 仅在每进程的 precheck 前填充一次，随后预热与计时重复使用输出，最后 postcheck 检查完整数组；未逐个检查中间计时输出。桌面背景约 4% GFX activity，另有两个未显示 GPU 工作的 Python 上下文；没有锁频或停止用户进程，不声称硬件完全独占。

### 补充验收

`verify_rounds.py` 复用已冻结 HIP 二进制与 Triton 源码，核验身份后补测 12 个边界（Triton 512/1024/2048 各自的前一项、整 tile、后一项共 9 个；float4 N=2/6/1026 共 3 个），全部通过。另对主输入的 HIP v0、Triton t0、v2 grid65536、v3 grid256 独立确认 3 进程×50 次，共 600 个样本，结果在 `evidence/rounds/confirmation.json`，原始材料在 `results/confirmation-20260920/`。没有合并进原主矩阵或改动已有图数。

确认中 v0 / t0 / v2 grid65536 的进程范围重叠，v3 grid256 较慢；不宣称最优，也不使用未重测的 v2 grid256 对照来归因 float4。

采集后对当前 `run_rounds.py` 做了一项可靠性修正：profile/validation 使用 manifest 保存的配置，避免未来当前 `CONFIGS` 变化影响后续阶段。旧冻结快照与 manifest 不变；本次实际配置没有变化。本地把当前 `CONFIGS` 换成无关占位后，已验证计划仍复原冻结 manifest 的 11 个 profile、4 配置×2 小 shape 与 11 个尾部检查。该修正不要求重新测量 kernel。

以下内容保留为 **2026-07-19 / ROCm 7.13 历史实验记录**；旧章号和旧命令属于当时的采集上下文，不作为当前复跑入口。

## Scope

本记录发布 Chapter 7 Vector Add 在指定 AMD GPU 上的完整正确性、benchmark 与 kernel-trace 实验。发布表格与图只读取 `chapter7/evidence/` 中的 curated evidence；远端 raw logs、profiles 与 results 不进入仓库。

## Source identity

- Git commit: `ef1722a6743bc0a9d6528d1fa938ad64976f0c05`
- Chapter source SHA-256: `5e2e42f864fb7d519df4f88cf30eb8d40f195bd52a9a9d1d0df5618c8ec874fe`
- Evidence generated at: `2026-07-19T08:17:01.287705+00:00`
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
| Seed | 20260719 |
| HIP block | 256 |
| Triton block | 1024 |

计时范围是 kernel-only GPU event。每个发布值先在单个独立进程内取 timed repetitions 的 median，再对独立进程的 median 取中位数；区间列给出这些进程级 median 的最小值与最大值。

## Publication results

| Implementation | Median (ms) | Run range (ms) | Logical effective bandwidth (GB/s) | Run range (GB/s) |
| --- | ---: | ---: | ---: | ---: |
| `hip-v0` | 0.336324 | 0.336224–0.337965 | 598.609044 | 595.703362–598.787113 |
| `hip-v1-contiguous` | 0.369584 | 0.367805–0.370344 | 544.738374 | 543.620507–547.373904 |
| `hip-v1-strided` | 2.567170 | 2.539349–2.581509 | 78.423556 | 77.987935–79.282759 |
| `hip-v2` | 0.343484 | 0.341984–0.345644 | 586.130918 | 582.468070–588.701781 |
| `hip-v3` | 0.345224 | 0.344864–0.347444 | 583.176683 | 579.450457–583.785476 |
| `triton-t0` | 0.336204 | 0.335084–0.336803 | 598.823604 | 597.756836–600.824263 |
| `triton-t1` | 0.338504 | 0.338404–0.338844 | 594.753950 | 594.157167–594.929706 |

## Profiling evidence

`profile_all.sh` 为每个实现启动独立的 `rocprofv3` kernel trace；下表逐字段来自 `evidence/profile_summary.csv`。若 trace 缺失、缺少 kernel 名列，或某个字段在目标 dispatch 间不唯一，对应字段会显式写成 `unavailable`，不会静默推断。

| Implementation | Dispatches | Grid X | Workgroup X | LDS B | Scratch B | VGPR | Accum VGPR | SGPR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `hip-v0` | 6 | 16777216 | 256 | 0 | 0 | 8 | 0 | 128 |
| `hip-v1-contiguous` | 6 | 524288 | 256 | 0 | 0 | 16 | 0 | 128 |
| `hip-v1-strided` | 6 | 524288 | 256 | 0 | 0 | 16 | 0 | 128 |
| `hip-v2` | 6 | 65536 | 256 | 0 | 0 | 16 | 0 | 128 |
| `hip-v3` | 6 | 65536 | 256 | 0 | 0 | 16 | 0 | 128 |
| `triton-t0` | 6 | 8388608 | 128 | 0 | 0 | 8 | 0 | 128 |
| `triton-t1` | 6 | 2097152 | 128 | 0 | 0 | 24 | 0 | 128 |

## Negative results and limits

- 受控的 HIP 跨步实现是本次明显负例：median 为 2.567170 ms，logical effective bandwidth 为 78.423556 GB/s；它验证了地址布局会主导这个带宽敏感算子。
- 本次短实验中 `hip-v0` 与 `triton-t0` 的 logical effective bandwidth 分别为 598.609044 GB/s 与 598.823604 GB/s。二者三进程范围重叠；这个有限 shape、软件栈与短协议不建立永久的 HIP-versus-Triton winner。
- logical effective bandwidth 是按算子语义所需的逻辑读写字节计算的比较指标，logical effective bandwidth ≠ physical GDDR6 traffic。当前 kernel trace 也不是物理显存流量计数器证据。
- 这些结果只适用于 manifest 记录的硬件、软件、shape、block、warmup、repeat 与独立进程协议；不能外推到其他算子、shape 或系统状态。

## Reproduction commands

在仓库根目录进入本章环境，运行当前源码：

```bash
cd code/part2-kernels
uv sync
source ./activate-rocm.sh
bash chapter8/run_all.sh
bash chapter8/profile_all.sh
```

从仓库内 `code/part2-kernels` 验证 curated evidence：

```bash
python3 - <<'PY'
import csv
import json
from pathlib import Path
from common.evidence import validate_manifest, validate_records
root = Path("chapter8/evidence")
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
