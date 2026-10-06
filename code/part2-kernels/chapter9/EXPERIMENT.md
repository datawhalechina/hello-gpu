## 2026-09-20：问题驱动的操作流程复核

本轮未改动本章 kernel、输入、正确性标准或原性能矩阵。复用 `results/rocm10-20260920/`，将正文直接引用的原始 p1 日志、代表边界检查与按需 trace 导出至 `evidence/walkthrough/`；原始字节、实际参数及来源哈希由 manifest 核对。`reports/` 是在原生 Ubuntu 篇环境中对旧 CSV 的新 CPU 分析，不是新的 GPU 性能测量。

读者命令的操作验证见 `evidence/operation-check/manifest.json`：本章 HIP/Triton 各一条完整 benchmark、正文代表边界、首次编译与复用、换终端恢复及重复输出保护均实际执行；新增计时只作操作检查，不进入原图。第 9 章另验证 mapping 编译与 ISA；第 12 章另验证一次 kernel trace 完整链路。所有实验机操作无 Git，源文件与锁文件身份在运行后再次核对。

另在同一实验机环境中，以旧实测主阶段数据的 CPU 子集验证正文绘图参数，五章共输出 18 张图的 SVG/PNG（36 个文件）。这是绘图兼容性验证，没有新的 GPU 测量，结果未覆盖发布图；记录见 `evidence/operation-check/reader-plot.log`。

入口默认阶段由 all 调整为 main，profiling 与附形状 validation 显式选择。文档绘图入口使用本轮 summary，确认组仍保存在独立目录，不用旧证据补值。原实验记录继续保留如下。

---

# Chapter 9 Sum Reduction — RX 9070 XT 实验记录

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

PROFILE_WARMUP=0 PROFILE_REPEAT=5 bash profile_all.sh
```

## 结论与限制

本 shape 下，逐元素全局 atomic 是明确负结果；先做局部归约再二阶段合并把时间降低到约 `0.05–0.06 ms`。表中的带宽按逻辑字节换算，超过显存标称带宽时更不能解读为物理显存（GDDR6）流量；cache、重复读取状态与真实事务需要 trace/计数器进一步区分。

证据入口：[`manifest.json`](evidence/manifest.json)、[`summary.csv`](evidence/summary.csv)、[`summary.json`](evidence/summary.json)。原始三进程日志和完整 trace 未纳入 Git。

## 2026-09-19：局部归约的线程分工对照（ROCm 10.0）

这是独立的受控实验，使用 `reduction_mapping.hip`，不覆盖上面的历史结果。三版都一线程加载一个元素、尾部补零，每个 block 写一个独占 partial，再由相同的 final kernel 合并；没有全局 atomic。A `sequential` 为折半树，B `interleaved` 为间隔线程处理相邻树，C `compacted` 为连续线程处理同一相邻树。

- 设备：Radeon RX 9070 XT / gfx1201；runtime 与 GPU code object 均为 wave32。
- 环境：原生 Ubuntu 24.04，kernel `7.0.0-31-generic`；ROCm SDK 10.0.0，HIP 7.15.26333，clang 23.0.0git，rocprofv3 1.3.5。
- 编译：`hipcc --offload-arch=gfx1201 -O3 -std=c++17 -save-temps reduction_mapping.hip -o reduction_mapping`。源码与二进制 hash 见新 manifest。
- 矩阵：`N=1024,65536,1048576,16777216`，block=256；每项 3 个独立进程，warmup=10，repeat=50，seed=20260919。每轮轮换三版顺序与两个计时区间的顺序。
- 输入：稳定 SplitMix64 生成的 `(-16..16)/32` FP32 值。每块 partial 与 FP64 参考精确比较，最终合并与相同运算顺序的 CPU FP32 模型精确比较，并单独报告相对 FP64 的误差。计时前后均校验。
- 边界：`N=1,31,32,33,255,256,257,1027` × `ones/weighted/random`，3 版全部校验通过；CPU 模型另核对每轮配对、输入覆盖、尾块和同步轮数。
- GPU event：`partial` 只含首阶段启动，`two-stage` 含首阶段与共同 final；各自独立启动并计时，不以时间相减估算。排除分配、拷贝、校验和预热；正式数据不运行 profiler。短区间仍可能包含 CPU 提交空隙。
- 输入反复使用、不刷新 cache。机器有桌面轻负载及空闲 notebook GPU 上下文，不是独占设备；不终止用户进程。进程间范围只反映本次复测波动，不是置信区间。

在 `code/part2-kernels/` 下执行，脚本激活本篇已有环境：

```bash
bash chapter9/run_mapping.sh --size 16777216 --block 256 --input random \
    --warmup 10 --repeat 50 --order rotate --measure both
```

本轮正式矩阵在独立临时目录中编译一次，逐项运行二进制；上述脚本另在相同环境的隔离目录中实际执行通过，作为入口验证，没有将这次结果补入三进程统计。精确正式参数、统计方法和全部矩阵见 [`tree-layout/README.md`](evidence/tree-layout/README.md)。原始样本、检查输出、编译记录及入口验证保存在本地 `results/mapping-20260919/`，trace / PMC / ISA 保存在 `profiles/mapping-20260919/`。

### 结果与诊断范围

`N=2^24` 时，首阶段 A/B/C 的三进程中位数分别为 **398.666 / 438.046 / 441.645 μs**。B 比 A 慢约 9.9%；C 与 B 的进程中位数范围重叠，本次没有测出聚集参与线程带来的加速。完整两阶段分别为 **472.906 / 511.687 / 515.867 μs**。小规模差距很小，不能把主 shape 的比例推广到所有输入。

trace 确认实际执行的是预期首阶段，Wavefronts 用于检查启动规模，不能当 lane 利用率。实际编译产物表明 B 的取模条件已被优化成位运算；C 使用额外的乘法和地址计算，不能把源码中的 `%` 直接说成昂贵除法。三版都存在 EXEC 掩码控制、恢复后到达 block 屏障。

初步 profiler 能力检查中，多个 SQ 指令和 LDS 冲突 counter 虽返回记录，却对所有 dispatch 都为零，因此不用于瓶颈归因。B/C 同时改变线程分工、地址计算和每个 wave 的 LDS 访问分布，当前证据不能量化分支发散在总耗时中的占比。保留“相邻合并变慢、重排后未加速”的负结果，不把它改写成发散优化成功。

新证据入口：[`tree-layout/manifest.json`](evidence/tree-layout/manifest.json)、[`tree-layout/summary.csv`](evidence/tree-layout/summary.csv)、[`tree-layout/diagnostic-notes.md`](evidence/tree-layout/diagnostic-notes.md)。原 ROCm 7.13 的五实现结果保持不变。

## 2026-09-20：ROCm 10.0 受控主路线

新入口为 `reduction_rounds.hip`、`reduction_rounds_triton.py` 与 `run_rounds.py`，保留历史实现及 tree-layout 独立案例。环境是 Radeon RX 9070 XT / gfx1201、原生 Ubuntu 24.04.5、kernel 7.0.0-31-generic、ROCm SDK 10.0.0、HIP 7.15.26333、torch 2.13.0+rocm10.0.0、Triton 3.8.0；采集北京时间 2026-09-20 01:33–01:43。

完整命令、源码身份、计时/输入约定、108 小边界 + 33 尾部校验、独立 trace 与确认见 [`rounds/README.md`](evidence/rounds/README.md)。本地原始底稿位于 `results/rocm10-20260920/` 及独立 `results/rocm10-20260920-confirmation/`。主矩阵 51 进程、2550 样本；独立确认 12 进程、600 样本，全部正确。

| 主 N=2^24 配置 | event 中位数 μs | 三进程范围 μs |
| --- | ---: | ---: |
| `hip-block-atomic` | 4350.179 | 4350.118–4350.396 |
| `hip-element-atomic` | 34650.785 | 34650.578–34650.911 |
| `hip-local-lds-g1024` | 83.161 | 83.161–83.202 |
| `hip-local-lds-g256` | 78.961 | 78.761–79.581 |
| `hip-local-lds-g65536` | 490.709 | 487.289–490.769 |
| `hip-local-wave-g256` | 78.061 | 78.022–78.081 |
| `hip-partials` | 477.668 | 477.409–480.828 |
| `triton-p1024` | 58.641 | 58.401–60.581 |
| `triton-p128` | 53.601 | 53.461–54.401 |
| `triton-p256` | 49.441 | 49.361–49.521 |
| `triton-p512` | 52.041 | 51.961–52.681 |

主矩阵比较表中的 atomic 区间含输出清零，其余为完整两阶段。独立确认未复现 HIP wave 的细小优势，保留 LDS g256；Triton p256 相对 p1024 改进复现。不能将旧 two-stage 总收益拆成这里任一项收益，也不能用局部树案例首阶段时间与本表完整 operator 混比。
