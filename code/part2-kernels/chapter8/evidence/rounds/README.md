# Vector Add：ROCm 10.0 逐轮实验

日期：2026-09-20（Asia/Shanghai；UTC 为 2026-09-19 17:04–17:07）。硬件为 AMD Radeon RX 9070 XT（gfx1201），原生 Ubuntu 24.04.5 / Linux 7.0.0-31，ROCm SDK 10.0.0 / HIP 7.15.26333，PyTorch 2.13.0+rocm10.0.0，Triton 3.8.0。

此目录是新的正式实验，章节 `evidence/` 根目录仍保留 2026-07-19 的 ROCm 7.13 历史快照，两者不能混用。

## 文件与统计口径

- `summary.csv` / `summary.json`：每个配置、每个 shape 分开统计，共 19 行。先对每个进程的 50 个 GPU event 样本取 median，再对 3 个进程 median 取中位数；上下界是 3 个进程 median 的 min/max，**不是置信区间**。
- `process-summary.csv`：57 个独立进程的样本数量、min/median/max/mean 以及原始 CSV、日志路径。没有将不同进程的全部样本混成一个分布。
- `profile-summary.csv`：11 个主输入配置单独运行 rocprofv3。每个配置有 16 个目标 dispatch：1 次 precheck、5 次 warmup、10 次重复。按起始时间排序，排除前 6 次，再计算后 10 次 kernel 时间。此表的时间受 profiler 影响，与无 profiler 的 event 表分开解释。
- `manifest.json`：环境、参数、配置顺序、源码/二进制哈希、全部样本文件 SHA-256。`scope=gpu-event-single-kernel` 表示 event 包围一次 kernel 提交；它不保证读数恰好等于 kernel 自身时间。
- `isa-excerpt.txt`：本次 HIP 编译生成的 ISA 摘录。v2 主循环生成 b32 读写，v3 主循环生成 b128 读写，v3 尾部仍为 b32；这只证明生成的访存指令宽度不同，不独立证明快慢原因。

全部原始数据在章节目录的 `results/rocm10-20260920/`：`source/` 源码快照、`build/` 二进制与编译中间结果、`samples/` 2850 个原始样本（57 个 CSV）、`logs/`、`profiles/`、`commands.jsonl`。raw 目录是本地实验底稿，不进入公开仓库。

## 协议与正确性

主输入 N=16,777,216，FP32；每个配置 3 个独立进程，每进程预热 10 次、计时 50 次。每个进程重新创建输入；进程内重复使用同一组数组，不人为刷 cache。配置顺序在三个进程轮次中轮换。HIP 与 Triton 使用相同确定性输入公式和 seed=20260920。

每个配置进程先将整个输出填为 NaN（HIP 使用 0xFF，Triton 使用 `fill_(nan)`），执行一次 precheck，并将整个输出与 CPU 参考比较。之后进行预热和计时，最后再次检查完整输出。**只在 precheck 前填一次 NaN；不在每个计时样本后校验，也不在 postcheck 前重填 NaN。**只有前后两次校验成功才写出原始样本；要求结果有限且绝对误差不超过 1e-6。

正式计时前检查 N=1/31/32/33/255/256/257/1027 的原七版，共 56 个正确性结果；正式主输入后检查 N=16,777,219 的全部 11 个配置，共 11 个尾部结果，全部通过。尾部检查的单次短计时不作为性能数据。

实验串行运行，无同时启动的其他实验。采集前系统仍有桌面约 4% GFX activity 和两个未显示 GPU 工作的 Python 上下文；没有终止用户进程，未锁频，因此 manifest 明确 `gpu_exclusive=false`。不要声称本次是在无任何后台活动的独占卡上完成。

## 主输入配置及结果

所有时间均为三进程 median 的中位数，单位 μs。精确数据与进程范围以 CSV 为准。

| 配置 | 时间 | 进程范围 | 逻辑有效带宽 GB/s |
| --- | ---: | ---: | ---: |
| HIP v0 | 334.808 | 334.807–335.007 | 601.32 |
| v1 连续 | 368.307 | 365.527–368.768 | 546.63 |
| v1 跨步 | 2567.253 | 2553.093–2567.813 | 78.42 |
| v2 grid=65536 | 334.847 | 334.826–335.007 | 601.25 |
| v2 grid=2048 | 354.927 | 351.407–360.667 | 567.23 |
| v2 grid=256 | 342.267 | 342.107–342.647 | 588.21 |
| v3 float4 grid=256 | 343.107 | 342.068–343.108 | 586.77 |
| Triton tile=256, warps=4 | 335.147 | 334.727–337.027 | 600.71 |
| Triton tile=512, warps=4 | 336.647 | 335.907–337.767 | 598.03 |
| Triton tile=1024, warps=4 | 337.646 | 337.627–338.687 | 596.26 |
| Triton tile=2048, warps=4 | 343.287 | 343.247–343.367 | 586.47 |

比较含义：

- v1 连续/跨步固定 grid、block、每线程循环次数与逻辑字节，仅改变每轮 wave 内的地址顺序；它是独立受控对照，不是 v0 的单项升级。
- v2 三组只改变同一 kernel 的 grid；不能将 v0→v2 限制 grid 的所有差异都归因于 block 数，因为代码还引入了循环。v0 与 full-grid v2 提供了桥接比较。
- v2/v3 grid=256 保持相同实际 grid/block；本次两者进程范围重叠，不建立 float4 提速结论。
- Triton 只改变 tile，固定 num_warps=4；更少 program 不代表更短时间。trace 分配 VGPR 依次是 8/16/24/40，仅是资源分配事实，未测占用率因果。
- 逻辑有效带宽按 `12*N/time` 计算，未收集物理 DRAM 字节、事务数或内存忙碌计数器。

## 较小输入的边界验证

主输入结束后，按预先写在 runner 中的规则选择 HIP v0、v3 grid256、主输入最快的 v2 grid 和 Triton tile，保留 Triton t0，去掉重复项。因此本次选中 v0、v2 requested-grid65536、v3 grid256、Triton t0 tile256。各自对 N=1,048,576 和 4,194,304 再做 3 进程×50 次。

`hip-v2-g65536` 的 config_id 表示请求的上限；在较小输入上实际 grid 被 full-grid 截断为 4096、16384。CSV 的 `grid` 列是真实启动值，不可根据名字推断。

N=4,194,304 时 v3 配置的 event median 为 35.601 μs、v0 为 48.601 μs；这说明配置表现随输入规模变化。两者同时存在向量宽度、循环和 grid 差异，**不能据此归因为 float4 单独提速**。较小 shape 未额外收集 trace，不能将主 shape 的时间或资源因果外推。

## 可复跑入口

在原生 Linux 的仓库根目录准备并激活 Part 2 环境：

```bash
cd code/part2-kernels
uv sync
source ./activate-rocm.sh
python chapter8/run_rounds.py --output chapter8/results/my-rounds
```

默认 `--phase all` 顺序完成主输入、独立 trace、较小输入及尾部验证；输出目录必须不存在，防止混入旧文件。脚本会编译 HIP，保存源码快照、二进制哈希、环境与执行命令。它不会查询 Git，也不会重新安装环境。

本次实际按同一冻结源码分三个阶段执行，便于在阶段边界审核：

```bash
python chapter8/run_rounds.py --output chapter8/results/rocm10-20260920 --phase main
python chapter8/run_rounds.py --output chapter8/results/rocm10-20260920 --phase profile
python chapter8/run_rounds.py --output chapter8/results/rocm10-20260920 --phase validation
python chapter8/summarize_rounds.py chapter8/results/rocm10-20260920 \
  --out chapter8/evidence/rounds
```

HIP 编译命令（工作目录为输出目录的 `build/`）：

```bash
hipcc --offload-arch=gfx1201 -O3 -std=c++17 -save-temps \
  ../source/vector_add_hip.hip -o vector_add_hip
```

程序仍支持直接运行单项配置；样本选项为 `--samples <csv> --config-id <id> --process <n>`。运行器对每个配置/shape/process 使用独立 CSV。归纳脚本会校验样本数量和编号、参数一致、RESULT 前后正确性、样本 median 与 RESULT 一致，以及恰好三个独立进程。

查看 trace 时按 kernel 名筛选目标，不把 NaN 填充、memset 或输入准备算作 Vector Add；`Grid_Size_X` 为 trace 的 work-items 范围，除以 `Workgroup_Size_X` 才是工作组数量。Triton 的 tile 元素数也不等于 workgroup 线程数。

## 独立确认与补充边界检查

`confirmation.json` 记录单独的一次验收，raw 在 `results/confirmation-20260920/`。该轮直接复用并验证原实验冻结 HIP 二进制与 Triton 源码哈希，未重编 kernel，未覆盖主矩阵与图中的数字。

边界共 12 项：tile512 对 N=511/512/513，tile1024 对 N=1023/1024/1025，tile2048 对 N=2047/2048/2049，共 9 项；HIP v3 对 N=2/6/1026，共 3 项，补齐 float4 余数为 2 的路径。全部通过。边界的 warmup=0/repeat=1 仅验证正确性，不用于性能结论。

另对 N=16,777,216 的 v0、Triton t0、v2 grid65536、v3 grid256，各跑 3 个新进程×50 次（warmup10），共 600 个独立确认样本。统计仍是进程 median 的中位数与进程范围：

| 配置 | 确认 median μs | 进程范围 μs |
| --- | ---: | ---: |
| HIP v0 | 335.646 | 335.607–336.946 |
| Triton t0 tile256 | 335.246 | 335.246–337.006 |
| HIP v2 grid65536 | 335.766 | 335.006–336.806 |
| HIP v3 grid256 | 342.366 | 341.146–343.266 |

前三者范围重叠；这组确认没有支持用更复杂候选替换简洁 v0/t0 的证据，也不宣称它们是所有参数中的最优解。确认组没有重测 v2 grid256，不能用此组单独归因 float4 的效果。

实际命令（Part 2 环境已激活）：

```bash
python chapter8/verify_rounds.py \
  --frozen-run chapter8/results/rocm10-20260920 \
  --output chapter8/results/confirmation-20260920
```

采集结束后首先修正了当前 `run_rounds.py` 的阶段计划读取：profile、validation 和尾部检查现在使用 manifest 保存的配置，而非当前文件的 `CONFIGS`。本次采集时两者配置完全相同，核心 kernel 与已测配置未改。原始 source 快照和 manifest 哈希保持不变，故当前 runner 哈希与采集时 runner 哈希不同是预期的；已用冻结 manifest 在本地验证 11 个 profile 配置、两组小 shape 选择与 11 个尾部配置一致，无需重跑原矩阵。

## 发布前的数据重审

联合审阅后，当前汇总器增加了冻结源码/二进制、完整配置集合、实际 grid 规则、日志 ENV 与样本参数检查，并复核先前保存的样本哈希。57 个主实验进程和 12 个独立确认进程均通过重审，已有时间与范围没有变化。当前分析脚本身份记录在 `manifest.json` 的 `analysis`；原测量源码身份仍保留在 `source_sha256`，两者用途不同。

本目录的 manifest 新增 `artifacts_sha256`，将发布的 CSV/JSON 与环境清单绑定。绘图器拒绝不匹配的 summary/manifest，不能通过换一份环境清单给原来的时间重新贴标签。旧确认组原件保持不变，重审并不把当时继承的环境字段改写成重新采集的记录。
