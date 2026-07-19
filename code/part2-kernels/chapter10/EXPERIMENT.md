# Chapter 10 Matmul — RX 9070 XT 实验记录

## 环境与口径

- 源码：`ef1722a6743bc0a9d6528d1fa938ad64976f0c05`
- AMD Radeon RX 9070 XT（gfx1201），Ubuntu 24.04.4 LTS，ROCm 7.13.0，PyTorch 2.11.0+rocm7.13.0，Triton 3.6.0
- 主 shape：`M=N=K=512` FP32；代表性尾块：`31×33×29`
- 3 个独立进程；每进程 `warmup=10`、`repeat=50`、`seed=20260719`
- `TFLOP/s = 2MNK / median_time`，是算法吞吐，不是硬件指令计数。

## 结果

| 实现 | median ms | 3 进程范围 ms | TFLOP/s |
|---|---:|---:|---:|
| `hip-naive` | 0.400323 | 0.397224–0.406364 | 0.6705 |
| `hip-tiled` | 0.183022 | 0.182662–0.185301 | 1.467 |
| `torch-mm` | 0.130701 | 0.064381–0.133702 | 2.054 |
| `triton-baseline` | 0.098701 | 0.087041–0.099041 | 2.720 |
| `triton-grouped` | 0.086721 | 0.085081–0.119481 | 3.095 |

所有边界与主 shape 记录均为 `correct=OK`。只为两个 HIP 与两个 Triton 教学实现采集独立 profile；`torch-mm` 是库参考，不混入教学 kernel 的资源归因。trace 索引见 [`profile_summary.csv`](evidence/profile_summary.csv)。

## 可复跑命令

```bash
RUN_EDGE_CASES=0 M=512 N=512 K=512 \
WARMUP=10 REPEAT=50 SEED=20260719 bash run_all.sh

SOURCE_COMMIT=ef1722a6743bc0a9d6528d1fa938ad64976f0c05 \
PROFILE_WARMUP=0 PROFILE_REPEAT=5 bash profile_all.sh
```

## 结论与限制

HIP tiled 相比 naive 的收益在三次进程中稳定。Triton grouped 的中心值较低，但它的进程范围与 baseline 明显重叠，因此不能据此宣称 program 排序稳定获胜。`torch-mm` 的进程范围也很宽；本记录保留这个负面现象，不挑选单次最好值。

证据入口：[`manifest.json`](evidence/manifest.json)、[`summary.csv`](evidence/summary.csv)、[`summary.json`](evidence/summary.json)。
