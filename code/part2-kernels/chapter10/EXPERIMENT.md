## 2026-09-20：问题驱动的操作流程复核

本轮未改动本章 kernel、输入、正确性标准或原性能矩阵。复用 `results/rocm10-20260920/`，将正文直接引用的原始 p1 日志、代表边界检查与按需 trace 导出至 `evidence/walkthrough/`；原始字节、实际参数及来源哈希由 manifest 核对。`reports/` 是在原生 Ubuntu 篇环境中对旧 CSV 的新 CPU 分析，不是新的 GPU 性能测量。

读者命令的操作验证见 `evidence/operation-check/manifest.json`：本章 HIP/Triton 各一条完整 benchmark、正文代表边界、首次编译与复用、换终端恢复及重复输出保护均实际执行；新增计时只作操作检查，不进入原图。第 9 章另验证 mapping 编译与 ISA；第 12 章另验证一次 kernel trace 完整链路。所有实验机操作无 Git，源文件与锁文件身份在运行后再次核对。

另在同一实验机环境中，以旧实测主阶段数据的 CPU 子集验证正文绘图参数，五章共输出 18 张图的 SVG/PNG（36 个文件）。这是绘图兼容性验证，没有新的 GPU 测量，结果未覆盖发布图；记录见 `evidence/operation-check/reader-plot.log`。

入口默认阶段由 all 调整为 main，profiling 与附形状 validation 显式选择。文档绘图入口使用本轮 summary，确认组仍保存在独立目录，不用旧证据补值。原实验记录继续保留如下。

---

# Chapter 10 Row Softmax — RX 9070 XT 实验记录

## 环境与口径

- 源码：`ef1722a6743bc0a9d6528d1fa938ad64976f0c05`
- AMD Radeon RX 9070 XT（gfx1201），Ubuntu 24.04.4 LTS，ROCm 7.13.0，PyTorch 2.11.0+rocm7.13.0，Triton 3.6.0
- 主 shape：`4096×1024` FP32；代表性边界：`3×257`
- 3 个独立进程；每进程 `warmup=10`、`repeat=50`、`seed=20260719`
- 时间为 kernel-only GPU event；表中值是进程 median 的中位数与范围。

## 结果

| 实现 | median ms | 3 进程范围 ms |
|---|---:|---:|
| `hip-baseline-3kernel` | 0.744228 | 0.743547–0.746188 |
| `hip-fused-block-lds` | 0.115781 | 0.114701–0.116281 |
| `triton-t0-compact` | 0.038361 | 0.037941–0.038841 |
| `triton-t1-wide` | 0.060801 | 0.060581–0.060841 |

边界和主 shape 全部 `correct=OK`。独立 trace 的进程总 dispatch 数分别为 18、6、6、6；它与程序的 precheck/repeat 流程一致，但仍包含 profiler 捕获到的辅助 dispatch，详见 [`profile_summary.csv`](evidence/profile_summary.csv)。

## 可复跑命令

```bash
RUN_EDGE_CASES=0 ROWS=4096 COLS=1024 HIP_BLOCK=256 \
WARMUP=10 REPEAT=50 SEED=20260719 bash run_all.sh

PROFILE_WARMUP=0 PROFILE_REPEAT=5 bash profile_all.sh
```

## 结论与限制

在该 shape 上，融合 HIP 版本明显快于三 kernel 教学 baseline；Triton `t0-compact` 又快于 `t1-wide`，说明把逻辑 block 扩大并增加 warps 并不会自动获益。这只适用于当前 shape、dtype 与实现，不能外推为所有 Softmax 的通用排序。

证据入口：[`manifest.json`](evidence/manifest.json)、[`summary.csv`](evidence/summary.csv)、[`summary.json`](evidence/summary.json)。原始日志和完整 trace 保留在实验临时目录，不跟踪进仓库。

## 2026-09-11：修正 LDS 复用同步并复测

本次代码审查发现：从 `shared[0]` 取得行最大值以后，其他线程可能开始把局部指数和写入同一块 LDS。旧代码缺少“所有线程均已读完最大值”这一依赖的屏障。现已在读取最大值后添加 `__syncthreads()`，再开始复用。历史结果中的 `correct=OK` 不构成无数据竞争的证明。

修正后的 `softmax_hip.hip` 由本地 Mac 传到实验机独立目录，源码 SHA-256 为 `efcc95eba39178d253e65ab93ace4923e79a60e7f563737b5408506fbf5d8840`。该文件当时尚未提交，以文件哈希标识；未在实验机执行 Git。平台为原生 Ubuntu 24.04.4 LTS（内核 7.0.0-31-generic）、RX 9070 XT / gfx1201、HIP 编译器 7.13.99004。GPU 未独占，也未锁频，运行前仍有其他显存占用。

实际编译与主形状命令（在传入源码的本章目录执行）：

```bash
hipcc --offload-arch=gfx1201 -O3 -std=c++17 softmax_hip.hip -o softmax_hip
./softmax_hip --version all --rows 4096 --cols 1024 --block 256 --warmup 10 --repeat 50
```

主形状命令以独立进程执行 3 次，默认 seed 为 20260719。边界使用相同编译产物、`--version all --block 256 --warmup 2 --repeat 3`，依次覆盖 `1×1`, `2×31`, `3×32`, `4×33`, `2×255`, `3×257`, `3×13`, `33×1025`。所有边界与主形状的两个 HIP 实现均通过计时前后的输出校验。

| 实现 | 三进程 median 的中位数 ms | 三进程 median 范围 ms | 主形状最大绝对误差上限 |
| --- | ---: | ---: | ---: |
| `hip-baseline-3kernel` | 0.4190690 | 0.4091890–0.5713910 | 3.7252903e-09 |
| `hip-fused-block-lds` | 0.1130420 | 0.1015620–0.1186220 | 3.3527613e-08 |

这组结果用于确认同步修正后的正确性回归和记录运行状态，未重新采集 Triton 或 profile。参数与系统状态也不完全等同于 2026-07-19 历史组，因此不与旧图拼接，不据此计算“修复带来的提速/减速”。修正前的历史图表继续保留源码身份，不能当成修正版的当前性能排名。

可追溯汇总与每条 RESULT 字段保存在 [`sync-fix-2026-09-11.json`](evidence/sync-fix-2026-09-11.json)，原始日志保留于本地 `logs/sync-fix-2026-09-11/`（按仓库规则忽略）。

## 2026-09-20：ROCm 10.0 受控 Softmax 主路线

硬件 Radeon RX 9070 XT / gfx1201；原生 Ubuntu 24.04.5，kernel 7.0.0-31-generic；ROCm SDK 10.0.0，HIP 7.15.26333，PyTorch 2.13.0+rocm10.0.0，Triton 3.8.0。冻结实际文件与编译产物，不读取远端 Git。完整参数、命令、输入和证据范围见 [`rounds/README.md`](evidence/rounds/README.md)。本地原始目录 `results/rocm10-20260920/`，独立确认另在带 `-confirmation` / `-shape-confirmation` 后缀目录。

新增 cooperative 三阶段保持与 fused 相同的行内线程分工，主 HIP 对照从 cooperative 出发。CPU 参考统一为 FP64 stable Softmax 后转 FP32，绝对误差和 FP64 行和误差阈值均 2e−5，输出 NaN prefill 并检查有限值。28 小边界、主+三附形状 75 进程 / 3750 样本以及全部目标 trace 均通过验证。

主 4096×1024 的 serial/cooperative/fused 三进程中位数为 773.261 / 149.296 / 119.717 μs；四个 Triton B4/B8/2B4/2B8 为 37.599 / 41.439 / 51.879 / 56.279 μs。主 shape 的独立确认复现 cooperative→fused 改进；1025 列时 B=2048，独立确认 B4=72.959 μs、B8=62.799 μs，体现执行配置依赖形状。128 行 B8 的宽范围完整保留，不据此给确定选择。两次独立确认共 15 进程、750 样本，不并入主矩阵。

旧根 evidence 与同步修正记录保持采集时 ROCm 7.13 身份；新结论只引用 `evidence/rounds/`。fused 源码重读输入并重算 exp，不能把时间差全部解释成消除显存流量或 kernel 启动；未采可用于这些因果拆分的硬件 counter。
