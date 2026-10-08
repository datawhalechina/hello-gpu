## 2026-09-20：问题驱动的操作流程复核

本轮未改动本章 kernel、输入、正确性标准或原性能矩阵。复用 `results/rocm10-20260920/`，将正文直接引用的原始 p1 日志、代表边界检查与按需 trace 导出至 `evidence/walkthrough/`；原始字节、实际参数及来源哈希由 manifest 核对。`reports/` 是在原生 Ubuntu 篇环境中对旧 CSV 的新 CPU 分析，不是新的 GPU 性能测量。

读者命令的操作验证见 `evidence/operation-check/manifest.json`：本章 HIP/Triton 各一条完整 benchmark、正文代表边界、首次编译与复用、换终端恢复及重复输出保护均实际执行；新增计时只作操作检查，不进入原图。第 9 章另验证 mapping 编译与 ISA；第 12 章另验证一次 kernel trace 完整链路。所有实验机操作无 Git，源文件与锁文件身份在运行后再次核对。

另在同一实验机环境中，以旧实测主阶段数据的 CPU 子集验证正文绘图参数，五章共输出 18 张图的 SVG/PNG（36 个文件）。这是绘图兼容性验证，没有新的 GPU 测量，结果未覆盖发布图；记录见 `evidence/operation-check/reader-plot.log`。

入口默认阶段由 all 调整为 main，profiling 与附形状 validation 显式选择。文档绘图入口使用本轮 summary，确认组仍保存在独立目录，不用旧证据补值。原实验记录继续保留如下。

---

# Chapter 12 Attention — RX 9070 XT 实验记录

> 以下早期记录使用 ROCm 7.13；当前 ROCm 10.0 分轮实测见本文末节及 `evidence/rounds/`。旧数据只保留历史身份。

## 环境与口径

- 源码：`ef1722a6743bc0a9d6528d1fa938ad64976f0c05`
- AMD Radeon RX 9070 XT（gfx1201），Ubuntu 24.04.4 LTS，ROCm 7.13.0，PyTorch 2.11.0+rocm7.13.0，Triton 3.6.0
- 主 shape：`S=128, D=64` FP32；代表性边界：`S=33, D=31`
- 3 个独立进程；每进程 `warmup=10`、`repeat=50`、`seed=20260719`
- 这是 FlashAttention-style 教学实现的 kernel-only 对照，不是对完整 FlashAttention 库实现的复现或基准。

## 结果

| 实现 | median ms | 3 进程范围 ms |
|---|---:|---:|
| `hip-materialized` | 0.0586405 | 0.058561–0.058741 |
| `hip-online` | 0.227383 | 0.225102–0.227542 |
| `triton-t0` | 0.024580 | 0.024441–0.024600 |
| `triton-t1` | 0.017380 | 0.017060–0.017400 |

所有边界与主 shape 均 `correct=OK`。四个实现分别采集独立 trace；完整索引见 [`profile_summary.csv`](evidence/profile_summary.csv)。

## 可复跑命令

```bash
RUN_EDGE_CASES=0 SEQ=128 DIM=64 BLOCK=256 \
WARMUP=10 REPEAT=50 SEED=20260719 bash run_all.sh

PROFILE_WARMUP=0 PROFILE_REPEAT=5 bash profile_all.sh
```

## 结论与限制

“不物化 `S×S`”不等于当前 kernel 必然更快：本章 HIP online 因每个 key 上的同步与教学化状态组织，反而约为 materialized 的 3.9 倍时间，这是需要保留的负结果。Triton t1 在该小 shape 上更快，但结论不外推到更长序列、causal mask、batch/head 或混合精度。

证据入口：[`manifest.json`](evidence/manifest.json)、[`summary.csv`](evidence/summary.csv)、[`summary.json`](evidence/summary.json)。

## 2026-09-11：修正 LDS 复用同步并复测

本次代码审查发现：从 `shared[0]` 取得行最大值以后，其他线程可能开始把局部指数和写入同一块 LDS。旧代码缺少“所有线程均已读完最大值”这一依赖的屏障。现已在读取最大值后添加 `__syncthreads()`，再开始复用。历史结果中的 `correct=OK` 不构成无数据竞争的证明。

修正后的 `attention_hip.hip` 由本地 Mac 传到实验机独立目录，源码 SHA-256 为 `9ef36c544b0a32dcbf5f72d6d354b34149257a574be8650f1fc643a48f3196fa`。该文件当时尚未提交，以文件哈希标识；未在实验机执行 Git。平台为原生 Ubuntu 24.04.4 LTS（内核 7.0.0-31-generic）、RX 9070 XT / gfx1201、HIP 编译器 7.13.99004。GPU 未独占，也未锁频，运行前仍有其他显存占用。

实际编译与主形状命令（在传入源码的本章目录执行）：

```bash
hipcc --offload-arch=gfx1201 -O3 -std=c++17 attention_hip.hip -o attention_hip
./attention_hip --version all --seq 128 --dim 64 --block 256 --warmup 5 --repeat 20
```

主形状命令以独立进程执行 3 次，默认 seed 为 20260719。边界使用相同编译产物、`--version all --block 256 --warmup 2 --repeat 3`，依次覆盖 `1×1`, `7×13`, `33×31`, `65×33`。所有边界与主形状的两个 HIP 实现均通过计时前后的输出校验。

| 实现 | 三进程 median 的中位数 ms | 三进程 median 范围 ms | 主形状最大绝对误差上限 |
| --- | ---: | ---: | ---: |
| `hip-materialized` | 0.0880030 | 0.0880020–0.0881215 | 8.9407e-08 |
| `hip-online` | 0.2800660 | 0.2798470–0.2801650 | 5.58794e-08 |

这组结果用于确认同步修正后的正确性回归和记录运行状态，未重新采集 Triton 或 profile。参数与系统状态也不完全等同于 2026-07-19 历史组，因此不与旧图拼接，不据此计算“修复带来的提速/减速”。修正前的历史图表继续保留源码身份，不能当成修正版的当前性能排名。

可追溯汇总与每条 RESULT 字段保存在 [`sync-fix-2026-09-11.json`](evidence/sync-fix-2026-09-11.json)，原始日志保留于本地 `logs/sync-fix-2026-09-11/`（按仓库规则忽略）。

## 2026-09-20：ROCm 10.0 完整算子分轮实验

全新独立目录、位置相关 dyadic 输入、seed 20260920；原生 Ubuntu 24.04.5 / RX 9070 XT gfx1201 / ROCm SDK 10.0.0 / HIP 7.15.26333 / PyTorch 2.13.0+rocm10.0.0 / Triton 3.8.0。GPU 非独占，保留已有桌面及上下文；无 profiler 的 event 主测和独立 kernel trace 分开。完整命令、参数、正确性与 trace 解释见 [rounds/README.md](evidence/rounds/README.md)。

主 `128×64`、附 `256×64` / `128×65` 均六配置，每项 3×50、warmup 10；54 进程、2700 样本。36 项小形状/最大值上升输入全部通过。独立确认六配置另跑 18 进程、900 样本，未覆盖主表数据。

| 主形状配置 | 主测 μs，中位数 [进程范围] | 独立确认 μs，中位数 [进程范围] |
| --- | --- | --- |
| `hip-materialized-b256` | 59.681 [59.581, 59.741] | 59.961 [59.941, 60.021] |
| `hip-online-b256` | 230.643 [230.523, 230.683] | 230.602 [230.602, 230.723] |
| `triton-materialized-k32` | 37.940 [33.760, 42.001] | 33.641 [33.120, 34.280] |
| `triton-online-k16` | 18.040 [17.920, 18.181] | 18.001 [17.921, 18.020] |
| `triton-online-k32` | 14.720 [14.280, 14.761] | 14.860 [14.760, 15.900] |
| `triton-online-k64` | 14.280 [14.240, 14.301] | 14.300 [14.281, 15.500] |

HIP online 负结果复现。Triton online 快于其 materialized 基线；tile 32/64 的主形状确认范围重叠，不能宣称某个 tile 稳定最优。附形状 `128×65` 中 tile 32 的主测 24.061 μs 低于 tile 64 的 25.440 μs，保留形状依赖，不将这一形状外推。

计时是完整算子 event（三阶段或一阶段），每轮同步，参考/分配/NaN 填充在计时外。FP64 reference 最终转 FP32，逐项有限且 atol 2e-5 + rtol 2e-4；各阶段 trace 的 16 次筛除前 6 次，保留 10 次，不能把阶段中位数相加替代 event。动态 LDS 的主配置为 softmax 1024 B、online 1296 B，即使 trace LDS 字段为 0 也不能说未使用 LDS。

两个 Host 均保留 scores/P 分配，主形状缓冲区合计 131072 B；online 仅不使用它们，不声称峰值分配下降或实测显存流量下降。源码中的同步/状态更新/并行组织提供待验证解释，不以 trace 时长独断某个机制。

冻结身份：

- `attention_hip.hip`：`0e66b4246af72b6bc077f654838f52c914dee12c1c7bc2110ec247979947bf94`
- `attention_triton.py`：`68ce5312f4daacfa72b4f6a37b79c98cd646485f4086418c93230339c33b89f6`
- HIP 二进制：`e60840b473ca11f461fd48735ddb43a0da2580d27a7648fd7a365869730e5e97`
