# ROCm 10.0 Softmax 受控实验

本目录是 2026-09-20（UTC+8；原始 UTC 为 2026-09-19）在 Radeon RX 9070 XT / gfx1201 上的新实验。根 evidence 的 ROCm 7.13 历史结果和同步修正记录均保留自己的环境与来源。

## 实际运行入口

在 `code/part2-kernels/` 中激活本篇环境，为每次实验选择新输出目录：

```bash
source ./activate-rocm.sh
python chapter10/run_rounds.py --output chapter10/results/my-rounds --phase main
python chapter10/run_rounds.py --output chapter10/results/my-rounds --phase profile
python chapter10/run_rounds.py --output chapter10/results/my-rounds --phase validation
python chapter10/verify_rounds.py --frozen-run chapter10/results/my-rounds \
    --output chapter10/results/my-confirmation
python chapter10/verify_rounds.py --frozen-run chapter10/results/my-rounds \
    --output chapter10/results/my-shape-confirmation --shape 4096x1025 \
    --configs triton-b4 triton-b8
```

上述 phases 和两个确认入口均已在目标环境执行。实际 argv 与时间保存在本地 `results/rocm10-20260920/commands.jsonl`，确认目录分别保存 `commands.json`。脚本不读取 Git；先冻结实际文件并记录 SHA，继续阶段前检查源文件、二进制和实际软件/设备身份。

## 配置与校验

- 主 shape 为 4096×1024，HIP block=256。`hip-serial-b256` 是三阶段一线程一行的教学桥接；`hip-cooperative-b256` 是三阶段一 block 一行的性能基线；`hip-fused-b256` 保留同行协作和两棵 LDS 树，合为单 kernel。
- cooperative→fused 同时改变 kernel 边界、全局中间结果和重算，不是只删掉启动开销。fused 源码三轮读取输入、两次计算 exp，没有声称只读一次输入；Host 当前仍分配中间数组，不能据此声称降低峰值分配。
- 四个 Triton 配置都调用同一 softmax_row_kernel：B=nextpow2(cols)，比较 B4/B8/2B4/2B8。每 program 处理一行；B 是逻辑元素数，num_warps 是执行配置，均不能直接当 HIP 线程块长度。
- 所有配置输入一致：位置相关的 /128 dyadic 值，每行按 row%3 加 +1000/−1000/0。包含大正负移位但输入有限；不支持 NaN/Inf 输入语义。本轮验证了这类移位输入的数值稳定结果，没有另做任意常数平移不变性穷举。
- HIP CPU 以 FP64 max/exp/sum 得出概率后转 FP32；Triton CPU reference 为 host_input.double() softmax 后转 FP32。绝对误差与 FP64 行和误差均 ≤2e−5，另显式拒绝非有限输出。
- 输出在计时前填 NaN；HIP 中间数组也在预检前填 NaN。每进程完整校验一次预检、一次计时后检查；并非每个样本均核对。
- 小正确性矩阵：1×1、3×33、3×257、3×1025，各 7 配置，共 28 项。三行样例覆盖三个移位分支。
- 附形状：4096×1023、4096×1025、128×1024，每项 cooperative/fused 和四个 Triton 配置；这 18 组也有三进程正式样本。

## 计时与统计

- scope=`gpu-event-full-operator`：每次事件区间覆盖一次完整 Softmax，即三阶段版本的三个 kernel 或融合版本的一个 kernel。排除编译、JIT、分配、拷贝、CPU 参考、预热和检查。每个 event 区间后同步；短任务仍可能包含 CPU 提交空隙。
- 每组 3 个独立进程，各 warmup10/repeat50；不同进程批次轮换配置顺序。主+附形状 25 配置行、75 进程、3,750 个样本。
- 先取每进程的 50 样本中位数，再报告三进程中位数的中位数及 min/max。范围不是置信区间，不把 150 样本混池。
- 不刷新 cache，同一进程重用数组。保留桌面和已有 GPU 上下文，设备未独占，未锁频，计时不启 profiler。
- effective_bandwidth_gbs 仅按输入+输出的逻辑下限 8×rows×cols 换算，忽略中间数组、重读和实际事务，不能称物理显存带宽。

## 实测结果

| 主 shape 配置 | event 中位数 μs | 进程中位数范围 μs |
| --- | ---: | ---: |
| `hip-cooperative-b256` | 149.296 | 149.156–149.956 |
| `hip-fused-b256` | 119.717 | 119.717–119.737 |
| `hip-serial-b256` | 773.261 | 765.039–776.819 |
| `triton-2b4` | 51.879 | 51.879–51.999 |
| `triton-2b8` | 56.279 | 56.199–56.318 |
| `triton-b4` | 37.599 | 37.199–37.599 |
| `triton-b8` | 41.439 | 41.399–41.639 |

主 shape 保留 HIP fused 与 Triton B4，未宣称全局最优。4096×1025 时 B 增至 2048，B8 相对 B4 更快；这组选择另做独立确认。128×1024 的 B8 有一次较慢进程，中位数范围约 11.520–34.714 μs，保留全部样本，不作确定的配置建议。

## 独立确认

独立确认使用同一冻结核心源码和 HIP 二进制，重新采集当前环境和 GPU 状态，配置次序轮换。它们不合并到主矩阵或主图：

- `confirmation.json`：主 shape 的 cooperative/fused/Triton B4，重复配置去重，共 9 进程、450 样本。
- `shape-confirmation.json`：4096×1025 的 Triton B4/B8，共 6 进程、300 样本。

| 确认 shape | 配置 | 中位数 μs | 进程中位数范围 μs |
| --- | --- | ---: | ---: |
| 4096x1024 | `hip-cooperative-b256` | 146.857 | 145.938–149.297 |
| 4096x1024 | `hip-fused-b256` | 119.858 | 117.098–119.858 |
| 4096x1024 | `triton-b4` | 37.400 | 36.759–37.519 |
| 4096x1025 | `triton-b4` | 72.959 | 72.639–73.039 |
| 4096x1025 | `triton-b8` | 62.799 | 61.479–62.959 |

主 shape 的 HIP 融合收益与 1025 列时的 B8 选择均复现。主 shape Triton 确认只复测保留的 B4，没有把未复测的所有候选重新排位。

## trace 与身份边界

- 每个目标 kernel 记录 16 dispatch：precheck1+warmup5+timed10。三阶段每个 kernel 分开筛选，7 配置共 11 个 kernel 统计行。辅助填充、拷贝等不算目标调用。
- profile-summary 的 scope=`rocprofv3-kernel-trace`，不与 event 混算，不把不同 kernel 的 median 相加或与 event 相减来估计纯启动开销。cooperative row_max_block 本轮有约 270.714 μs 的 trace 离群，范围如实保留。
- Grid_Size_X 是总 work-item 数；除 Workgroup_Size_X 得到实际 block/program 数。summary.grid 指首阶段的 block/program 数，serial 的 normalize 阶段网格另见 trace。
- Triton B4/B8/2B4/2B8 的 trace VGPR_Count 为 56/32/96/56，scratch 为 0；这只是资源分配事实，不足以量化占用率或各因素的耗时贡献。动态 LDS 请求没有体现在本次 LDS_Block_Size=0 中，不能据此断言没有 LDS。
- manifest 中 source_sha256 和 binary_sha256 绑定冻结来源，sample/log/profile SHA 绑定原始证据，artifacts_sha256 绑定公开汇总和两个确认 JSON。所有校验通过后才写汇总；源码身份、ENV、样本元数据、finite、缺样本、边界失败、trace 缺失的本地负向检查均被拒绝。

- `softmax_hip.hip` SHA-256：`12975c9d5b4246da0388002b55c1d2883724239fdde25476267174d12b6dc55c`。
- `softmax_triton.py` SHA-256：`563968117db997dc066566c60dff49194d9c28900b69a819a77fd9c195b2cf67`。
- HIP binary SHA-256：`81bae78fba3e2b55e790b0d90aeee2f1ac64ff5831b73c5c84a69c2c496583d3`。
