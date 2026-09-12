# Chapter 13 RMSNorm — RX 9070 XT 实验记录

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

SOURCE_COMMIT=ef1722a6743bc0a9d6528d1fa938ad64976f0c05 \
PROFILE_WARMUP=0 PROFILE_REPEAT=5 bash profile_all.sh
```

## 结论与限制

按行单线程串行归约是稳定的负基线；HIP block 协作把时间降到约 `0.058 ms`。本 shape 上 Triton t1 的中心值略低于 t0，但范围接近，不能推导出 8 warps 在其他列数上一律更好。当前各版都已在单个 kernel 内完成主要数学步骤，serial/block 对照不测量减少 dispatch 的融合收益；真实物理显存（GDDR6）流量仍需专门计数器证明。

证据入口：[`manifest.json`](evidence/manifest.json)、[`summary.csv`](evidence/summary.csv)、[`summary.json`](evidence/summary.json)。
