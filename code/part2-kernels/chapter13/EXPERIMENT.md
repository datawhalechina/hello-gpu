## 2026-09-20：问题驱动的操作流程复核

本轮未改动本章 kernel、输入、正确性标准或原性能矩阵。复用 `results/rocm10-20260920/`，将正文直接引用的原始 p1 日志、代表边界检查与按需 trace 导出至 `evidence/walkthrough/`；原始字节、实际参数及来源哈希由 manifest 核对。`reports/` 是在原生 Ubuntu 篇环境中对旧 CSV 的新 CPU 分析，不是新的 GPU 性能测量。

读者命令的操作验证见 `evidence/operation-check/manifest.json`：本章 HIP/Triton 各一条完整 benchmark、正文代表边界、首次编译与复用、换终端恢复及重复输出保护均实际执行；新增计时只作操作检查，不进入原图。第 9 章另验证 mapping 编译与 ISA；第 12 章另验证一次 kernel trace 完整链路。所有实验机操作无 Git，源文件与锁文件身份在运行后再次核对。

另在同一实验机环境中，以旧实测主阶段数据的 CPU 子集验证正文绘图参数，五章共输出 18 张图的 SVG/PNG（36 个文件）。这是绘图兼容性验证，没有新的 GPU 测量，结果未覆盖发布图；记录见 `evidence/operation-check/reader-plot.log`。

入口默认阶段由 all 调整为 main，profiling 与附形状 validation 显式选择。文档绘图入口使用本轮 summary，确认组仍保存在独立目录，不用旧证据补值。原实验记录继续保留如下。

---

# Chapter 13 RMSNorm — RX 9070 XT 实验记录

> 以下旧记录使用 ROCm 7.13；当前 ROCm 10.0 分轮实测见本文末节及 `evidence/rounds/`，旧数据仅供历史追溯。

## 环境与口径

- 源码：`ef1722a6743bc0a9d6528d1fa938ad64976f0c05`
- AMD Radeon RX 9070 XT（gfx1201），Ubuntu 24.04.4 LTS，ROCm 7.13.0，PyTorch 2.11.0+rocm7.13.0，Triton 3.6.0
- 主 shape：`1024×4096` FP32，`epsilon=1e-5`；代表性边界：`33×257`
- 3 个独立进程；每进程 `warmup=10`、`repeat=50`、`seed=20260719`
- 时间只覆盖一次 RMSNorm kernel 路径；输出在计时外预分配。

## 结果

| 实现 | median ms | 3 进程范围 ms |
|---|---:|---:|
| `hip-block` | 0.058440 | 0.058041–0.0590205 |
| `hip-serial` | 1.50486 | 1.50160–1.51004 |
| `triton-t0` | 0.033360 | 0.033100–0.033740 |
| `triton-t1` | 0.030081 | 0.030041–0.031160 |

所有边界和主 shape 均 `correct=OK`。四个实现各有独立 profile，配置文件同时绑定源码、shape、block、epsilon 和 profile repeat；见 [`profile_summary.csv`](evidence/profile_summary.csv)。

## 可复跑命令

```bash
RUN_EDGE_CASES=0 ROWS=1024 COLS=4096 BLOCK=256 EPSILON=1e-5 \
WARMUP=10 REPEAT=50 SEED=20260719 bash run_all.sh

PROFILE_WARMUP=0 PROFILE_REPEAT=5 bash profile_all.sh
```

## 结论与限制

按行单线程串行归约是稳定的负基线；HIP block 协作把时间降到约 `0.058 ms`。本 shape 上 Triton t1 的中心值略低于 t0，但范围接近，不能推导出 8 warps 在其他列数上一律更好。当前各版都已在单个 kernel 内完成主要数学步骤，serial/block 对照不测量减少 dispatch 的融合收益；真实物理显存（GDDR6）流量仍需专门计数器证明。

证据入口：[`manifest.json`](evidence/manifest.json)、[`summary.csv`](evidence/summary.csv)、[`summary.json`](evidence/summary.json)。

## 2026-09-20：ROCm 10.0 分轮实测

新主形状 `4096×1024`，短行 `4096×128`，另检查 `128×1024` / `4096×1025`，不与旧 `1024×4096` 合并。环境为 RX 9070 XT / gfx1201、原生 Ubuntu 24.04.5、ROCm SDK 10.0.0、HIP 7.15.26333、PyTorch 2.13.0+rocm10.0.0、Triton 3.8.0。GPU 非独占、未锁频；基准无 profiler，trace 单独采集。

19 个配置/形状项，各 3×50、warmup 10，共 57 进程、2850 样本；128 项边界全部通过。主确认另 12 进程/600 样本，短行确认另 9 进程/450 样本。输入/FP64 reference/FP32 epsilon、实际命令、shape 矩阵、统计和 trace 口径详见 [rounds/README.md](evidence/rounds/README.md)。

| 主形状配置 | event μs，中位数 [进程范围] | 独立确认 μs，中位数 [进程范围] |
| --- | --- | --- |
| `hip-block-b128` | 69.860 [69.100, 70.801] | 未独立确认 |
| `hip-block-b256` | 76.080 [75.661, 76.201] | 75.920 [75.860, 76.201] |
| `hip-block-b64` | 59.820 [59.760, 60.000] | 59.841 [59.521, 61.681] |
| `hip-serial-b256` | 694.605 [670.684, 720.645] | 未独立确认 |
| `triton-r1-w4` | 34.980 [34.180, 35.120] | 34.240 [34.201, 35.100] |
| `triton-r1-w8` | 33.321 [33.160, 33.540] | 33.360 [32.980, 33.681] |

HIP block64 相对 block256 的主形状优势在确认中保留；Triton 8 warps 在此主形状略快，范围同时保留。附形状小 batch 的 HIP256 更快、列尾的 Triton4 更快，不能推广成固定最优配置。所有版本均单 kernel，本轮不测量减少 launch 次数的融合收益。

短行完整 event：主测 1/2/4 行为 18.200 / 15.800 / 26.280 μs，独立确认 18.160 / 16.700 / 26.260 μs。四行在此口径变慢，但独立 kernel trace median 为 9.140 / 8.680 / 7.080 μs，且各 trace 范围较宽；两种采集不能直接相减定量 CPU 开销，也不能说四行 kernel 本体退化。三版短行 VGPR 都为16、Scratch都为0，不能据此解释 event 差异。保留两行只对应当前短行/event方案。

九个目标trace各16次，排除precheck1+warmup5，汇总10次。HIP block动态LDS是block×4B，trace字段0不能说没有LDS。FP32输出预填NaN只在precheck前；pre/post完整检查，atol=rtol=2e-5，拒绝非有限值。

冻结身份：

- `rmsnorm_hip.hip`：`e991ebda3c505e48d7cee84c2ce71c65dd2bdad4745ebbed1ebaa2d2e6047bca`
- `rmsnorm_triton.py`：`63fcf6c0b8453d6d37ab56238cbfea46c268fb0c58891daf43010da6e0275088`
- HIP 二进制：`90a498a41ee243bbc58a3e65db18224a8d9521144640f6715d81ad22dfbf2cfa`
