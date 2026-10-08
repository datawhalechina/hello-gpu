# Chapter 13：ROCm 10.0 RMSNorm 分轮实验

本目录是 RX 9070 XT（gfx1201）+ 原生 Ubuntu 24.04.5 + ROCm SDK 10.0.0 的实测。旧 `evidence/` 根目录数据保留 ROCm 7.13 的来源身份，不拼入新图。

## 复跑入口

在已激活本篇 ROCm 10.0 环境的 `code/part2-kernels/chapter13/` 下，本次实际依次执行：

```bash
python run_rounds.py --output results/rocm10-20260920 --phase main
python run_rounds.py --output results/rocm10-20260920 --phase validation
python run_rounds.py --output results/rocm10-20260920 --phase profile
python verify_rounds.py --frozen-run results/rocm10-20260920 --output results/rocm10-20260920-confirmation
python verify_rounds.py --frozen-run results/rocm10-20260920 --output results/rocm10-20260920-short-confirmation --shape 4096x128 --configs triton-r1-w4 triton-r2-w4 triton-r4-w4
```

重跑时选择新输出目录。首次冻结源码并编译；续跑阶段先核对冻结源码、二进制和实际环境，配置及精确形状矩阵保存在 manifest。上述命令省略机器私有绝对路径；实际 argv/时间/日志记录在各运行目录 `commands.jsonl` / `commands.json`。编译在运行目录 `build/` 执行：

```bash
hipcc --offload-arch=gfx1201 -O3 -std=c++17 -save-temps ../source/rmsnorm_hip.hip -o rmsnorm_hip
```

## 对照矩阵

| 形状 rows×cols | 实际配置 | 用途 |
| --- | --- | --- |
| 4096×1024 | HIP serial256、block256/128/64；Triton 单行 4/8 warps | serial 为公式实现桥接；block256 为 HIP 调参基线，单行 4 warps 为 Triton 基线 |
| 4096×128 | Triton 1/2/4 行每 program，固定 4 warps、逻辑列宽 128 | 单独比较短行分组 |
| 128×1024 | HIP block256/128/64；Triton 单行 4/8 warps | 行数减少的形状检查 |
| 4096×1025 | HIP block256/128/64；Triton 单行 4/8 warps | 列尾与逻辑列宽增至 2048 的形状检查 |

`measurement_matrix` 显式列出每个形状测过的配置；未测组合没有补值。19 项各 3 个独立进程，warmup 10、repeat 50，共 57 进程、2850 原始样本。每遍轮换配置顺序，重用数组，不刷缓存；GPU 非独占且不锁频。

`confirmation.json` 独立确认主形状 HIP block256/64 与 Triton 单行 4/8 warps，共 12 进程、600 样本；`short-row-confirmation.json` 独立确认短行 1/2/4 行，共 9 进程、450 样本。每次都重新采集实际环境，使用原冻结二进制和 Triton 源码，且只选择父实验同形状测过的配置。两份确认各有自己的单形状矩阵，未修改主测数据。

## 输入、正确性和统计

输入 `rmsnorm-dyadic-v1` 的 X/W 由位置与 seed `20260920` 确定，均为 FP32 dyadic 数；normal 的 W 本身允许正负值。CPU 用 FP64 计算完整 RMSNorm，最终转 FP32。epsilon 在两路线都先量化到 FP32，记录的实际值是 `9.999999747378752e-06`。逐元素判定 `abs(error) <= 2e-5 + 2e-5*abs(reference)`，显式拒绝 NaN/Inf；输出 precheck 前填 NaN，计时前后全量检查，计时中不重填。

128 项边界校验：行数 33、列数 1/129/257/4097，分别使用 normal/zero/zero-weight/signed-weight 四模式，八配置全部通过。它们覆盖单列、行尾、列尾、零输出与正负权重；这些边界不参与性能排名。

计时是单次完整 RMSNorm 的 GPU event 区间：预先创建 event pairs，每轮 start → launch → stop → synchronize。分配、CPU 参考、NaN 填充、正确性检查在计时外。各实现都只启动一个目标 kernel，因此本实验没有测“从多个 kernel 融合成一个”的收益。

`process-summary.csv` 保留每进程 50 轮样本的统计；`summary.csv` 使用三个进程中位数的中位数，范围是三个进程中位数的 min/max，**不是置信区间**。确认组与主组分开，不合并平均。

## Profiling 与结论边界

主形状六配置和短行三配置分别采集 rocprofv3 kernel trace。每个目标 kernel 共 16 次，去掉 precheck 1 + warmup 5，保留 10 次。`Grid_Size_X` 是总 work item 数，除以 `Workgroup_Size_X` 得到 block/program 数；已校验完整 XYZ launch。HIP block 的动态 LDS 为 `block*4`，即 256/512/1024 B；trace 的 LDS 字段 0 不表示未使用动态 LDS。

必须保留短行的两种观察：

| 每 program 行数 | 主测完整 event μs | 独立确认完整 event μs [进程范围] | 独立 trace kernel μs [10 次范围] |
| --- | --- | --- | --- |
| 1 | 18.200 | 18.160 [17.680, 18.300] | 9.140 [9.000, 31.560] |
| 2 | 15.800 | 16.700 [15.760, 16.780] | 8.680 [6.641, 21.960] |
| 4 | 26.280 | 26.260 [26.240, 26.361] | 7.080 [5.200, 21.200] |

完整 event 窗口中，四行配置变慢在独立确认中复现；trace 中其 kernel 中位数却更短。两者口径与采集不同，trace 范围也较宽，不能直接相减来定量 CPU 提交开销，更不能说四行版 kernel 本体退化。event 区间可能包含提交间隙，后续若要找原因，需要控制提交方式等变量再测。本轮短行三配置 VGPR 都是 16、Scratch 都是 0，不能拿这些相同资源字段解释差异。正文选择两行，仅对应当前 event 测量方案和短行形状。

主形状 HIP block64 快于 block256 的结果在确认中保留；单行 Triton 8 warps 的优势较小，也保留完整范围。附形状显示取舍会改变：128×1024 的 HIP block256 比 block64 快，4096×1025 的 Triton 4 warps 比 8 warps 快。这些是附形状扫描结果，不冒称已逐项独立确认或全局最优。源码中的读写次数与分组结构不能替代物理显存流量、cache hit 或 occupancy 计数器。

## 证据身份

manifest 绑定冻结源码、二进制、原始 samples/logs/trace 的 SHA-256；`artifacts_sha256` 绑定发布汇总、profile 及两份独立确认。原始内容保存在本地 `results/rocm10-20260920/`、`results/rocm10-20260920-confirmation/`、`results/rocm10-20260920-short-confirmation/`，按规则忽略。统计脚本在写任何汇总前检查预期矩阵、缺失/重复样本、所有 metadata 与 ENV、正确性标记和数值、trace 次数/launch、旧 raw 哈希；失败则不发布。
