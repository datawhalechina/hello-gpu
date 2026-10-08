# 第 9 章：逐轮阅读用原始终端记录

本目录只导出 `results/rocm10-20260920/` 中已完成实测的主形状 `16777216`、第 1 个独立进程的 10 份终端日志。**`new_gpu_measurement=false`：整理这些文件没有运行新的 GPU 实验。**

所有日志均按原字节复制。原采集把 stderr 合并到 stdout，因此这里称为“终端记录”，不声称两种流已经分离。日志中的 `median_ms` 是该进程的 50 次 event 中位数；正文比较图取三个独立进程 median 的中位数和最小—最大范围，**p1 不一定等于图中中心值**。不能把这里的 p1 当作新成绩，或与另一组结果混算。

`manifest.json` 绑定每份原始/发布日志的 SHA-256、原始相对路径、父 `evidence/rounds/manifest.json` 身份、当前及冻结 runtime 身份、二进制身份和实际命令记录。`actual_command.argv_path_normalized` 只替换私有运行根路径及解释器路径，明确不是原始 argv；选项、参数值和顺序不变。原始命令所在行、命令文件哈希和原始 argv 的规范 JSON 哈希同时保留，供本地底稿核对。原环境记录来自采集时，导出时没有重新测量环境。

| 配置 | 第 1 个独立进程的原始终端记录 |
| --- | --- |
| `hip-block-atomic` | [`n16777216-hip-block-atomic-p1.log`](logs/n16777216-hip-block-atomic-p1.log) |
| `hip-partials` | [`n16777216-hip-partials-p1.log`](logs/n16777216-hip-partials-p1.log) |
| `hip-local-lds-g65536` | [`n16777216-hip-local-lds-g65536-p1.log`](logs/n16777216-hip-local-lds-g65536-p1.log) |
| `hip-local-lds-g1024` | [`n16777216-hip-local-lds-g1024-p1.log`](logs/n16777216-hip-local-lds-g1024-p1.log) |
| `hip-local-lds-g256` | [`n16777216-hip-local-lds-g256-p1.log`](logs/n16777216-hip-local-lds-g256-p1.log) |
| `hip-local-wave-g256` | [`n16777216-hip-local-wave-g256-p1.log`](logs/n16777216-hip-local-wave-g256-p1.log) |
| `triton-p1024` | [`n16777216-triton-p1024-p1.log`](logs/n16777216-triton-p1024-p1.log) |
| `triton-p512` | [`n16777216-triton-p512-p1.log`](logs/n16777216-triton-p512-p1.log) |
| `triton-p256` | [`n16777216-triton-p256-p1.log`](logs/n16777216-triton-p256-p1.log) |
| `triton-p128` | [`n16777216-triton-p128-p1.log`](logs/n16777216-triton-p128-p1.log) |

主数据和三个进程的统计继续以 [`../rounds/`](../rounds/README.md) 为准，原发布目录未修改。逐元素 atomic 仅是概念入口，本包按教学主线不导出该项。

manifest 的 `available_trace_inventory` 只列出已有 kernel trace 的原始路径、哈希、目标函数和筛选范围，**尚未复制任何 profile CSV 或分析报告**。trace 独立于 benchmark；每个目标 kernel 的 16 次调用包含 1 次预检、5 次预热、10 次计时，分阶段筛选时分别跳过前 6 条。没有复制逐次 event CSV，也没有为未选材料新增性能结论。

## 精选正确性与 trace 补充

`logs/edge-*.log` 是原边界校验记录的逐字节副本，只有一次计时，正文只读 `precheck`、`postcheck` 与误差，不把它作为性能数据。`profiles/` 是本章所需代表配置的原始 kernel trace CSV，逐字节保留。其余已有 trace 仍只列在 inventory。

`reports/` 是 2026-09-20 在原生 Ubuntu 实验机、原篇环境中实际运行 `chapter8/inspect_trace.py` 得到的 **CPU-only 新分析**，不是新的 GPU benchmark 或 profiler 实验。每个目标 kernel 按 Start_Timestamp 排序，分别跳过 1 次预检和 5 次预热，保留 10 次。原 CSV、helper 完整副本、实际分析 argv、CPU 环境和输出哈希已绑定。多 kernel 报告按命令顺序拼接，各段 stdout 不变，段间只加一空行。

分析中的 kernel 时间、完整 XYZ launch 和 VGPR/SGPR/LDS/Scratch 字段均与 `../rounds/profile-summary.csv` 核对一致。Grid 是 work item 数；分别除以 Workgroup 的 X/Y/Z 才得到 block/program 数。工具的 LDS 字段不保证反映动态 LDS：本章 HIP 源码分配的动态 LDS 需要另读启动参数，不能将 trace 的 0 当作没有使用 LDS。正式 benchmark、独立 trace 和 CPU 阅读结果保持各自来源与计时范围。
