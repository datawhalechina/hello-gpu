# Chapter 12：ROCm 10.0 Attention 分轮实验

本目录是 RX 9070 XT（gfx1201）+ 原生 Ubuntu 24.04.5 + ROCm SDK 10.0.0 的新实测；上一级旧文件保留历史身份，不能拼入本组。

## 复跑入口

在已激活本篇 ROCm 10.0 环境的 `code/part2-kernels/chapter12/` 下，本次实际按以下顺序运行：

```bash
python run_rounds.py --output results/rocm10-20260920 --phase main
python run_rounds.py --output results/rocm10-20260920 --phase profile
python run_rounds.py --output results/rocm10-20260920 --phase validation
python verify_rounds.py --frozen-run results/rocm10-20260920 --output results/rocm10-20260920-confirmation
```

重跑时换一个未存在的输出目录。首次运行冻结源码并编译 HIP；后续阶段验证冻结源码、二进制与实际环境，继续使用 manifest 中的配置。这里的运行根目录已省略机器上的私有绝对路径；原始实际 argv 保存在各运行目录 `commands.jsonl` / `commands.json`。

编译命令在运行目录的 `build/` 下执行：

```bash
hipcc --offload-arch=gfx1201 -O3 -std=c++17 -save-temps ../source/attention_hip.hip -o attention_hip
```

## 矩阵与统计口径

- 主形状 `128×64`，附形状 `256×64`、`128×65`，每个形状都是六配置：HIP materialized / online（block 256），Triton materialized（key tile 32）/ online（key tile 16、32、64，均 4 warps）。
- 每项 3 个独立进程，每进程 warmup 10、repeat 50；每遍轮换配置顺序。主/附共 54 进程、2700 个原始样本；输入和输出数组重用，不刷缓存，GPU 不独占、不锁频。
- 输入为位置相关 dyadic FP32，seed `20260920`。CPU FP64 计算完整 attention 后转 FP32；逐元素 `abs(error) <= 2e-5 + 2e-4*abs(reference)`，必须有限。输出、scores、P 在 precheck 前填 NaN；precheck 与 postcheck 都全量校验，计时期间不重填。
- event 包围完整 attention：materialized 三个 kernel，online 一个 kernel。每轮 event 同步；CPU reference、分配、NaN 填充、正确性检查均在计时外。该区间可能包括 kernel 之间的提交空隙，不等同于单个 kernel 的 trace 时长。
- `process-summary.csv` 每行是一个进程的 50 轮样本中位数；`summary.csv` 是三个进程中位数的中位数，范围是这三个值的 min/max，**不是置信区间**。没有把独立进程的样本混成一个平均数。
- `confirmation.json` 是随后重新采集环境的独立六配置确认，18 进程、900 样本。其原始数据与主矩阵分开保存，主表不改数。tile 32 距主测最快 tile 64 不到 5%，因此保留一起复测。

## 正确性与 trace

36 项小形状校验：dyadic 的 `1×1`、`17×31`、`33×65`、`65×64` 各六配置；rising-max 的 `65×64`、`129×64` 各六配置，均通过。后两项使 attention 分数逐 key 上升，用于验证 online 更新最大值后对旧分子/分母的缩放。它不是性能输入。

六配置分别使用 rocprofv3 kernel trace；每个目标 kernel 共 16 次（precheck 1、warmup 5、repeat 10），排除前 6 次，汇总余下 10 次。三阶段实现分别筛三个 kernel；不把各阶段 median 相加冒充完整算子 event。`Grid_Size_X` 是总 work item 数，除以 `Workgroup_Size_X` 才得到这一维的 block/program 数。校验同时检查 Y/Z 维和实际 launch。

HIP softmax 使用动态 LDS `block*4`，主配置为 1024 B；HIP online 使用 `(block+dim+4)*4`，主配置为 1296 B。trace 的 `LDS_Block_Size=0` 不能解释为没有动态 LDS。Triton online 的 VGPR 分配依次是 40 / 48 / 96（tile 16 / 32 / 64），这是编译后资源分配记录，不是 occupancy 或缓存命中率测量。

## 能说明什么

HIP online 避免 kernel 读写 scores/P，但每个 key 都进行 block 同步和状态更新、并改变 key 维度并行组织。其负结果不能仅归因某一项，若要定量拆分必须再做受控实验。Triton online 在本组形状上快于其 materialized 基线；key tile 的选择依赖形状，`128×65` 主测中 tile 32 更快。主形状独立确认的 tile 32/64 进程范围重叠，不据此宣布稳定的全局最优。

两路线 Host 都仍分配 scores/P，`intermediate_allocated_bytes=2*S*S*4`。`intermediate_used_bytes` 表示该实现使用的中间缓冲区规模（online 为 0），不是物理内存流量；本实验没有证明进程峰值分配减少。所有实现是 FP32、单 head、无 causal mask 的教学实现，不是完整 FlashAttention 库基准。

## 证据身份

`manifest.json` 绑定冻结源码、HIP 二进制、原始 samples/logs/trace 哈希，并以 `artifacts_sha256` 绑定本目录汇总及独立确认文件。原始 CSV、完整日志、trace、冻结源码和二进制保留于本地 `results/rocm10-20260920/` 及 `results/rocm10-20260920-confirmation/`，按仓库规则忽略。发布前统计脚本验证预期的配置/形状/进程全集、样本索引、metadata、ENV、所有正确性标记、数值误差和 trace 次数/launch；检查失败则不写汇总。
