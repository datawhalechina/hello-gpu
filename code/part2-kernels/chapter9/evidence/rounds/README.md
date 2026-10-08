# ROCm 10.0 受控归约实验

本目录是 2026-09-20（UTC+8；原始 UTC 2026-09-19）在 Radeon RX 9070 XT / gfx1201 上的独立复跑。旧 `evidence/` 根目录的 ROCm 7.13 结果与 `tree-layout/` 局部树案例保留各自来源。

## 复跑入口

在 `code/part2-kernels/` 激活已有本篇环境后，使用新的独立输出目录：

```bash
source ./activate-rocm.sh
python chapter9/run_rounds.py --output chapter9/results/my-rounds --phase main
python chapter9/run_rounds.py --output chapter9/results/my-rounds --phase profile
python chapter9/run_rounds.py --output chapter9/results/my-rounds --phase validation
python chapter9/verify_rounds.py --frozen-run chapter9/results/my-rounds \
    --output chapter9/results/my-confirmation
```

正式三阶段与独立确认已在目标环境真实运行；原始实际 argv 保存在本地 `results/rocm10-20260920/commands.jsonl` 与确认目录的 `commands.json`。入口使用当前源文件、保存来源副本并记录 SHA-256，不读取 Git。当前采集器在继续 profile/validation 时先检查冻结文件和实际运行环境；这项续跑检查是在本次正式矩阵采集后补强的，未改写当次冻结脚本。

## 口径与控制变量

- 输入 FP32，主 N=16,777,216，seed=20260920；位置哈希生成的 `(-16..16)/32` 值。补验覆盖位置相关 weighted 与全正 ones。
- HIP 每块 256 线程：block-atomic 与 partials 共用相同的一元素加载和 LDS 折半树；partials 后固定 final。local-lds 只添加 grid-stride 累加，扫 grid=65,536/1,024/256；wave 仅在 grid=256 下替换局部树，final 不变。
- Triton 固定逻辑 tile=1,024、num_warps=4，扫 program cap=1,024/512/256/128；final 始终采用 1,024 逻辑元素和 4 warps，mask 随有效 partial 数变化。
- event scope=`gpu-event-full-operator`：atomic 含每次必需的输出清零与归约 kernel；两阶段版本含首阶段和 final。排除编译、分配、输入拷贝、校验和预热。短区间仍可能含 CPU 提交空隙。
- 同一进程重用数组，不刷新 cache；计时前 NaN 初始化后完整校验一次，全部 timed launch 后再校验一次，不是逐样本校验。两阶段逐个 partial 与最终值都对 FP64 精确比较；atomic 只检查最终值。只承诺这些受限确定输入，不能将零误差推广至任意 FP32 数据。
- 每配置每 shape 三独立进程，各 warmup=10、repeat=50；配置在每个进程批次轮换。先取进程内样本中位数，再取三个进程中位数的中位数及 min/max，不混池，不把范围称作置信区间。
- 非独占设备：保留桌面和已有上下文。正式 event 测量不启 profiler。逻辑带宽 `(4N+4)/time` 仅用于算法字节换算，不是 GDDR6 实际带宽。

## 文件与验证

- `summary.csv/json`：主形状 11 配置 + N=1,048,576 六配置，共 17 行；`process-summary.csv`：51 个进程、2,550 个 event 样本。
- `manifest.json`：软件/硬件、参数、执行次序、采集时源码和二进制 SHA、当前分析脚本 SHA；`artifacts_sha256` 绑定最终 CSV/JSON 字节。原始 51 样本文件、日志与 11 trace SHA 可追溯。
- 小边界 6 个 N × 3 输入 × 6 代表配置 = 108 项；N=1,048,579 × 3 输入 × 11 配置 = 33 项尾部检查。141 项全部 pre/post 正确，两阶段 partial 也全部正确。
- `profile-summary.csv`：每个配置按 first/final 分开；每 kernel 的 16 次目标 dispatch 排除 precheck+5 warmup，保留 10 次。scope=`rocprofv3-kernel-trace`；不能把不同阶段中位数直接相加冒充完整 event，也不能相减求开销。
- trace 的 Grid_Size_X 是总 work-item 数，除 Workgroup_Size_X 才是 block/program 数。HIP LDS 动态申请未反映在本次 LDS_Block_Size=0 字段中：源码中 LDS 首阶段申请 1,024 B，wave 首阶段 32 B；不能据零值声称不使用 LDS。
- trace 是配置和 kernel 身份证据。没有用未验证的 cache/occupancy/bank-conflict counter 解释耗时。

## 独立确认

`confirmation.json` 保留 4 配置 × 3 进程 × 50 = 600 个样本的独立统计，重新采集环境并核对同一冻结源码与二进制。它不替换主矩阵。

| 配置 | 确认中位数 μs | 进程中位数范围 μs |
| --- | ---: | ---: |
| `hip-local-lds-g256` | 78.7695 | 78.5700–81.6300 |
| `hip-local-wave-g256` | 80.9500 | 79.0700–81.2100 |
| `triton-p1024` | 58.5925 | 58.5120–59.0125 |
| `triton-p256` | 49.5340 | 49.4140–49.6140 |

HIP wave 版在主矩阵的约 1.1% 优势没有复现，独立确认中位数顺序反转且范围重叠；保留 LDS 版作为本轮选择。Triton p256 相对 p1024 的改进在确认中复现，只称为本轮候选中的选择，不宣称全局最优。

## 来源与采集后可靠性修正

- `reduction_rounds.hip`：`422b9c8d11e7d96a81fdbf4ed6835be660d6c55d3fbd562845e7e8cde9771d15`。
- `reduction_rounds_triton.py`：`dffd7f4e7a893fc0369ce06f6e99727e9037b9f9653814739102b77731030edd`。
- HIP binary：`8af340fd47d06fb0b6a950f4e141760545cf30b729844d47d9b9657541958513`。
- 采集后当前 `run_rounds.py` 新增阶段开始前的冻结身份/环境核对；`summarize_rounds.py` 增强 ENV、完整正确性矩阵、所有文件验证后再发布、制品哈希与反篡改检查。核心 HIP/Triton 源码、当次 source snapshot 和主样本没有变化；原采集分析脚本 SHA 与当前分析脚本 SHA 分别保存在 manifest.source_sha256 和 manifest.analysis。
- 分析器本地负向测试确认：冻结源码变更、ENV 不符、配置元数据不符、失败正确性、缺 trace dispatch、失败尾部检查、缺样本文件均拒绝，且不先写出汇总。
