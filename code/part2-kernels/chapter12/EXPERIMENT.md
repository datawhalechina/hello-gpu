# Chapter 12 Attention — RX 9070 XT 实验记录

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

SOURCE_COMMIT=ef1722a6743bc0a9d6528d1fa938ad64976f0c05 \
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
