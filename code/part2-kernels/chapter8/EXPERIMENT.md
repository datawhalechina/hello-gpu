# Chapter 8 Sum Reduction — RX 9070 XT 实验记录

## 环境与口径

- 源码：`ef1722a6743bc0a9d6528d1fa938ad64976f0c05`
- 硬件：AMD Radeon RX 9070 XT（gfx1201）
- 系统：Ubuntu 24.04.4 LTS；ROCm 7.13.0；PyTorch 2.11.0+rocm7.13.0；Triton 3.6.0
- 主 shape：`N=16,777,216`，FP32；边界检查包含 `N=1027`
- 每个独立进程：`warmup=10`、`repeat=50`、`seed=20260719`
- 表中时间是 3 个独立进程各自 `median_ms` 的中位数；范围是这 3 个进程的最小/最大 median。JIT、编译、分配和 CPU reference 不在 GPU event 时间内。

## 结果

| 实现 | median ms | 3 进程范围 ms | 逻辑带宽 GB/s |
|---|---:|---:|---:|
| `hip-atomic` | 34.4608 | 34.4593–34.4614 | 1.947 |
| `hip-lds` | 4.32771 | 4.32637–4.32939 | 15.51 |
| `hip-two-stage` | 0.059081 | 0.058961–0.059641 | 1136 |
| `triton-t0` | 0.059921 | 0.058200–0.059921 | 1120 |
| `triton-t1-local` | 0.050801 | 0.049680–0.051460 | 1321 |

所有主 shape 和边界记录均为 `correct=OK`。`profile_all.sh` 为 5 个实现分别生成独立 kernel trace；完整索引见 [`profile_summary.csv`](evidence/profile_summary.csv)。trace 中的总 dispatch 数还包含初始化、拷贝或检查 kernel，不能直接当作归约 kernel 次数。

## 可复跑命令

```bash
RUN_EDGE_CASES=0 SIZE=16777216 BLOCK=256 TRITON_BLOCK=1024 \
TRITON_PROGRAMS=256 WARMUP=10 REPEAT=50 SEED=20260719 bash run_all.sh

SOURCE_COMMIT=ef1722a6743bc0a9d6528d1fa938ad64976f0c05 \
PROFILE_WARMUP=0 PROFILE_REPEAT=5 bash profile_all.sh
```

## 结论与限制

本 shape 下，逐元素全局 atomic 是明确负结果；先做局部归约再二阶段合并把时间降低到约 `0.05–0.06 ms`。表中的带宽按逻辑字节换算，超过显存标称带宽时更不能解读为物理显存（GDDR6）流量；cache、重复读取状态与真实事务需要 trace/计数器进一步区分。

证据入口：[`manifest.json`](evidence/manifest.json)、[`summary.csv`](evidence/summary.csv)、[`summary.json`](evidence/summary.json)。原始三进程日志和完整 trace 未纳入 Git。
