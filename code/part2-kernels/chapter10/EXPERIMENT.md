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

SOURCE_COMMIT=ef1722a6743bc0a9d6528d1fa938ad64976f0c05 \
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
