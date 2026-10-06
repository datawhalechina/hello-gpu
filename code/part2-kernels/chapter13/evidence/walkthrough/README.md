# 第 13 章：逐轮原始输出与短行 trace 阅读

本包导出主形状 `4096×1024` 六配置、短行 `4096×128` 的 R1/R2/R4 三配置的第 1 个独立进程日志，以及三份既有短行 trace。**`new_gpu_measurement=false`：没有新运行 benchmark 或 profiler。** 原测量为 RX 9070 XT / gfx1201、ROCm SDK 10.0.0、原生 Ubuntu 24.04.5。

日志和 CSV 均按原字节复制。原 runner 将 stderr 合并到 stdout，因此这里是终端记录。每个 p1 的 `median_ms` 是该进程 50 次 event 的中位数；正文图采用三个独立进程中位数的中位数及其 min/max，p1 不一定等于图中中心值。主图和独立确认仍以 [rounds](../rounds/README.md) 为准。

| 形状 | 配置 | 原始 p1 终端记录 |
| --- | --- | --- |
| `4096x1024` | `hip-serial-b256` | [n4096x1024-hip-serial-b256-p1.log](logs/n4096x1024-hip-serial-b256-p1.log) |
| `4096x1024` | `hip-block-b256` | [n4096x1024-hip-block-b256-p1.log](logs/n4096x1024-hip-block-b256-p1.log) |
| `4096x1024` | `hip-block-b128` | [n4096x1024-hip-block-b128-p1.log](logs/n4096x1024-hip-block-b128-p1.log) |
| `4096x1024` | `hip-block-b64` | [n4096x1024-hip-block-b64-p1.log](logs/n4096x1024-hip-block-b64-p1.log) |
| `4096x1024` | `triton-r1-w4` | [n4096x1024-triton-r1-w4-p1.log](logs/n4096x1024-triton-r1-w4-p1.log) |
| `4096x1024` | `triton-r1-w8` | [n4096x1024-triton-r1-w8-p1.log](logs/n4096x1024-triton-r1-w8-p1.log) |
| `4096x128` | `triton-r1-w4` | [n4096x128-triton-r1-w4-p1.log](logs/n4096x128-triton-r1-w4-p1.log) |
| `4096x128` | `triton-r2-w4` | [n4096x128-triton-r2-w4-p1.log](logs/n4096x128-triton-r2-w4-p1.log) |
| `4096x128` | `triton-r4-w4` | [n4096x128-triton-r4-w4-p1.log](logs/n4096x128-triton-r4-w4-p1.log) |

三份 `profiles/` CSV 来自原 `results/rocm10-20260920/profiles/`，保留原名和字节。`reports/` 是 2026-09-20 在同一实验机激活原篇环境后，用当前 `chapter8/inspect_trace.py` 实际执行得到的新 CPU 阅读结果；没有启动 GPU 任务。每份 CSV 共 18 行，其中目标 kernel 16 行；按起点排序、跳过预检 1 次和预热 5 次，保留 10 次。helper 的完整副本及哈希位于 `source/inspect_trace.py`。

实际执行的命令从 `code/part2-kernels` 开始，例如 R1：

```bash
python chapter8/inspect_trace.py chapter13/results/rocm10-20260920/profiles/n4096x128-triton-r1-w4_kernel_trace.csv --kernel rmsnorm_kernel --skip 6 --take 10
```

R2/R4 对应 CSV 文件名中的 `r2`/`r4`，目标函数均为 `rmsnorm_rows_kernel`。完整实际 argv、执行时间、退出码、CPU 环境和原始记录哈希在 manifest 的 `trace_reanalysis`。报告按 stdout 原字节保存，stderr 单独保留（成功时为空）。所有报告的时间、XYZ launch 和资源字段均与原 `rounds/profile-summary.csv` 逐项核对一致。

| 每 program 行数 | kernel 中位数 μs | 10 次范围 μs | program 数 | VGPR / SGPR | LDS / Scratch 字段 B |
| --- | ---: | --- | ---: | --- | --- |
| 1 | 9.140 | 9.000–31.560 | 4096 | 16 / 128 | 0 / 0 |
| 2 | 8.680 | 6.641–21.960 | 2048 | 16 / 128 | 0 / 0 |
| 4 | 7.080 | 5.200–21.200 | 1024 | 16 / 128 | 0 / 0 |

三版 workgroup 都是 `128×1×1`；grid 字段是 work item 数，分别为 `524288×1×1`、`262144×1×1`、`131072×1×1`，相除才得到 program 数。LDS 为工具记录字段，不据此推导一般情况下的动态 LDS 用量。以上是独立 trace 的 kernel 时长，不能与另一轮 event 中位数相减定量提交开销，也不能因为 event 较慢就说 R4 kernel 本体变慢。

manifest 绑定父发布身份、当前与冻结 runtime、原 binary、每份 raw/public 文件哈希和真实命令出处。benchmark 命令只有私有 run-root/解释器路径做明示替换；日志、trace、report 没有替换。环境主记录来自原测量，`trace_reanalysis.environment` 单独记录本次纯 CPU 操作环境。未修改原 rounds 或 raw 证据。

## 公式与尾部的代表校验

另外按原字节导出 128 项既有校验中的四项，均为 `warmup=0,repeat=1`，只展示正确性，不参与性能比较：

| 输入 | 形状 | 配置 | 原始输出 |
| --- | --- | --- | --- |
| `zero` | `33x1` | `hip-block-b64` | [edge-zero-33x1-hip-block-b64.log](logs/edge-zero-33x1-hip-block-b64.log) |
| `zero-weight` | `33x257` | `hip-block-b64` | [edge-zero-weight-33x257-hip-block-b64.log](logs/edge-zero-weight-33x257-hip-block-b64.log) |
| `signed-weight` | `33x129` | `triton-r2-w4` | [edge-signed-weight-33x129-triton-r2-w4.log](logs/edge-signed-weight-33x129-triton-r2-w4.log) |
| `normal` | `33x129` | `triton-r4-w4` | [edge-normal-33x129-triton-r4-w4.log](logs/edge-normal-33x129-triton-r4-w4.log) |

这些操作没有重新执行。manifest 的 `representative_boundary_checks` 绑定原始命令记录、输出字节和父组哈希。
