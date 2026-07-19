# Chapter 9 Row Softmax — RX 9070 XT 实验记录

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
