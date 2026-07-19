# Chapter 11 Attention — RX 9070 XT 实验记录

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
