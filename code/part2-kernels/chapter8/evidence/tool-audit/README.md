# 第 8 章工具盘点与单次 ATT 诊断

采集日期为 2026-09-20（UTC+08）。实际实验机是 **Radeon RX 9070 XT / gfx1201、ROCm SDK 10.0.0、HIP 7.15.26333、原生 Ubuntu 24.04.5、Linux 7.0.0-31-generic**。本目录是独立工具能力检查，不与 `evidence/walkthrough/` 的不带 profiler 计时合并。没有安装软件、升级环境、切换功耗模式或终止桌面等已有进程。

## 已执行的检查

- `version.stdout.log`：环境中公共 `rocprofv3` 包装器报告 **ROCprofiler-SDK 1.3.5 / ROCm 10.0.0**。这里的 `system_version` 是工具构建信息；实验机内核以 `environment.json` 为准。
- `environment-ready.stdout.log` 与 `.stderr.log`：已有篇环境实际执行了 `uv sync --locked`，随后 `source ./activate-rocm.sh`、`rocprofv3 --version`。同步检查通过。这是主矩阵结束后的环境复核，未重新采集或改写主矩阵。
- `agents.stdout.log`：实际识别 gfx1201、Wavefront_Size 32。安装内容与工具路径见 `packages.json`、`tool-paths.json`。
- 公共 `rocprofv3` 能生成 kernel/HIP API trace、各类统计 CSV 与 `.pftrace`；未在当前 PATH 中发现 ROCprofiler Compute / Systems 的入口，这不等于证明全机没有安装。本轮没有安装或运行这些工具。SDK 中有 roctracer 共享库，未在当前 PATH 中找到独立 roctracer 可执行入口。LLVM 反汇编工具位于 SDK 的 `lib/llvm/bin/`。

`commands.jsonl` 保留 PMC、工具版本等实际 argv、退出码和时间；其中 stdout/stderr 字段指向本地 raw 的原路径，公开副本路径对应 `publication-files.json`。`supplemental-commands.jsonl` 记录初次环境复核与 ATT 调用；当前带产物验证的 ATT 调用、目录初始化和 CPU 测试记录在 `att-verified-commands.jsonl`。

## PMC：先核对能否取得有意义的值

**正文当前 binary 的结果位于 [pmc-walkthrough/](./pmc-walkthrough/README.md)。** 该补充使用 walkthrough 中直接编译的同一个 binary，精确执行正文 8.5.4 三组命令，单独绑定身份与原始输出。下面的 `pmc/` 保留初次工具盘点结果；组合检查仍可复用。两次采集都得到相同的 wave 计数与缓存/流量全零现象，没有混合统计。

三组都在同一 v0 配置（N=16777216、block=256、seed=20260920）分别执行。应用先预检查一次、预热五次、再重复十次。`--kernel-include-regex vector_add_v0 --kernel-iteration-range 7-16` 在 **PMC 采集**中实际选中了 dispatch 8–17，共十次。`pmc/` 保存每组的原始 stdout、stderr 和 counter CSV，`counter-summary.json` 仅概括这些原值。

| 计数器 | 本次结果 | 能支持的判断 |
| --- | --- | --- |
| `SQ_WAVES_sum` | 每次 524288 | 与 16777216 / 32 一致，可核对发出的 wave 数 |
| `GRBM_GUI_ACTIVE` | 非零 | 记录到活动计数，不能据此直接得出实际频率或 occupancy |
| `GL2C_HIT_sum`、`GL2C_MISS_sum` | 全部为 0 | 本次不可用于计算 cache 命中率 |
| `FetchSize` | 全部为 0 | 本次不可用于推断 DRAM 读流量 |

`rocprofv3-avail -d 0 pmc-check ...` 对三组均返回可同时采集；它检查配置是否合法，不保证返回值一定可解释。官方指出 RDNA3/4 的 AUTO 模式可能关闭部分计数器时钟；本机功耗模式实读为 `auto`，本轮没有改变它，也没有通过前后对照确定全零的具体原因。[AMD 的 rocprofv3 文档](https://rocm.docs.amd.com/projects/rocprofiler-sdk/en/latest/how-to/using-rocprofv3.html)

名称和 iteration 过滤不会过滤普通 kernel trace CSV。本次加过滤和不加过滤都保留了 16 个 v0 目标记录，内建 stats 也包含预检查、预热。教学流程因此保留完整 trace，再由 `inspect_trace.py --skip 6 --take 10` 明确选取正式区间。[AMD 的过滤说明](https://rocm.docs.amd.com/projects/rocprofiler-sdk/en/latest/how-to/kernel-naming-filtering.html)

## ATT：已采集并解码，尚未在查看器中打开

已真实执行：

```bash
# code/part2-kernels，已激活本篇环境；输出目录必须尚不存在
bash chapter8/profile_att.sh chapter8/results/walkthrough-20260920/att-verified
```

入口源码及其确切快照分别为 `chapter8/profile_att.sh`、`att/profile_att.sh`；验证器为 `chapter8/validate_att.py`、`att/validate_att.py`。脚本用 `-gline-tables-only` 单独编译诊断 binary，并显式提供当前环境的 `_rocm_sdk_devel/lib` 与 `_rocm_sdk_core/lib`，让 decoder 能找到 wheel 拆分安装的库。初次依赖默认搜索路径时，raw `.att` 已生成，但解码报 `Error loading decoder: 37`；提供库目录后成功。初始失败完整留在本地 `results/tool-audit-20260920/`，没有当作成功输出发布。

公开文件：

- `att-helper.stdout.log` / `.stderr.log`：上述脚本本身的输出。
- `att/commands.log`：脚本实际展开的编译、采集 argv。
- `att/compile.*.log`、`att/profile.*.log`：编译与 profiler 的分别输出。
- `att/instruction-stats.csv`：工具生成的完整指令统计，仅规范化私有路径；原名为 `stats_ui_output_agent_3208_dispatch_8.csv`。
- `att/validation.stdout.log` / `.stderr.log`：产物验证结果。当前仅一个 dispatch 8，29 条指令记录，对应目录有 4134 个有效且非空的 JSON。
- `att/manifest.json`：源码、脚本、验证器、独立 debug binary 身份及采集范围。
- `att/raw-sha256.json`：完整本地 `.att`、code objects、解码 JSON、binary 和日志的 SHA-256 / 大小清单；大文件保留在本地，没有加入公开仓库。

脚本现在要求 profiler 成功之后，标准库验证器再次检查唯一 dispatch 8 的 stats、必需列和整数计数、`vector_add_v0` 身份、正 Hitcount，以及对应目录的 `code.json`、wave JSON 和全部 JSON 的有效性。任一检查失败都会明确返回非零，不打印采集成功。13 个 CPU 测试在本地和实验机均通过，包含缺文件、空 CSV、错误 dispatch / kernel、无正计数、坏数值、无 UI、无效 / 空 JSON 和 CLI 失败退出；实测测试日志见 `validator-tests.stderr.log`。

此外，正文使用的 `mkdir -p chapter8/results; RUN=$(mktemp -d chapter8/results/walkthrough-XXXXXX); mkdir "$RUN/build"` 已在实验机执行并返回 0，只创建空目录，未启动新 benchmark。命令和输出见 `att-verified-commands.jsonl`、`directory-setup.*.log`。

本次仅选择 v0 第 7 次调用（1 次预检查 + 5 次预热之后，实际 dispatch 8）、SE mask `0x1`、SIMD ID `0`，target CU 使用工具默认值；64 MiB 缓冲区。gfx1201 支持的是 ATT **trace-only**，没有使用 `--att-perfcounters`。生成 CSV 和 UI JSON 不等于已在 ROCprof Compute Viewer 中完成可视化，本轮未打开该查看器。[AMD 的 ATT 支持范围及流程](https://rocm.docs.amd.com/projects/rocprofiler-sdk/en/latest/how-to/using-thread-trace.html)

初学者可以先对照 `Instruction` 与 `Source`：本次第 42 行映射出两条 `global_load_b32`、`s_wait_loadcnt`、`v_add_f32_e32` 和 `global_store_b32`。`Hitcount` 是被追踪的 waves 中该指令执行次数之和；本次上述指令各为 4124，不能将它误读为整个 GPU 的 wave 总数。`CodeObj` / `Vaddr` 用于定位 code object 与指令地址。官方将 `Latency` / `Stall` / `Idle` 定义为追踪范围内的周期统计；它们不是毫秒，也不能简单求和当作整个 kernel 耗时。本轮只把这些字段保留为进一步分析线索，没有据此断言 cache 命中率、DRAM 字节数或单一瓶颈。[AMD 的 Stats CSV 字段定义](https://rocm.docs.amd.com/projects/rocprofiler-sdk/en/latest/how-to/using-thread-trace.html#stats-csv)

## 公开副本与本地原件

公开文本仅替换明确定义的私有路径前缀：环境篇目录 → `<environment-part-root>`，本轮工作区 → `<walkthrough-root>`，工具盘点目录 → `<audit-root>`，旧冻结轮次工作区 → `<frozen-rounds-root>`，其余用户主目录 → `<home>`。不删行、不改数值、版本、时间或错误内容。`publication-files.json` 逐项记录原件和公开副本的 SHA-256；无路径内容的文件逐字节相同。`manifest.json` 绑定公开文件及原采集命令文件的身份。完整大时间线和 ATT JSON 仍可在本地 raw 目录复核。

当前 ATT 公开引用更新至独立的 `results/walkthrough-20260920/att-verified/`；先前 `att/` 及其 manifest、原始结果仍保留在本地。原 benchmark、三组 PMC 和主 walkthrough manifest 没有改写。
