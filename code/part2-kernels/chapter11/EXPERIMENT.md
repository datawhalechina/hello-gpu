## 2026-09-20：问题驱动的操作流程复核

本轮未改动本章 kernel、输入、正确性标准或原性能矩阵。复用 `results/rocm10-20260920/`，将正文直接引用的原始 p1 日志、代表边界检查与按需 trace 导出至 `evidence/walkthrough/`；原始字节、实际参数及来源哈希由 manifest 核对。`reports/` 是在原生 Ubuntu 篇环境中对旧 CSV 的新 CPU 分析，不是新的 GPU 性能测量。

读者命令的操作验证见 `evidence/operation-check/manifest.json`：本章 HIP/Triton 各一条完整 benchmark、正文代表边界、首次编译与复用、换终端恢复及重复输出保护均实际执行；新增计时只作操作检查，不进入原图。第 9 章另验证 mapping 编译与 ISA；第 12 章另验证一次 kernel trace 完整链路。所有实验机操作无 Git，源文件与锁文件身份在运行后再次核对。

另在同一实验机环境中，以旧实测主阶段数据的 CPU 子集验证正文绘图参数，五章共输出 18 张图的 SVG/PNG（36 个文件）。这是绘图兼容性验证，没有新的 GPU 测量，结果未覆盖发布图；记录见 `evidence/operation-check/reader-plot.log`。

入口默认阶段由 all 调整为 main，profiling 与附形状 validation 显式选择。文档绘图入口使用本轮 summary，确认组仍保存在独立目录，不用旧证据补值。原实验记录继续保留如下。

---

# Chapter 11 Matmul — RX 9070 XT 实验记录

## 环境与口径

- 源码：`ef1722a6743bc0a9d6528d1fa938ad64976f0c05`
- AMD Radeon RX 9070 XT（gfx1201），Ubuntu 24.04.4 LTS，ROCm 7.13.0，PyTorch 2.11.0+rocm7.13.0，Triton 3.6.0
- 主 shape：`M=N=K=512` FP32；代表性尾块：`31×33×29`
- 3 个独立进程；每进程 `warmup=10`、`repeat=50`、`seed=20260719`
- `TFLOP/s = 2MNK / median_time`，是算法吞吐，不是硬件指令计数。

## 结果

| 实现 | median ms | 3 进程范围 ms | TFLOP/s |
|---|---:|---:|---:|
| `hip-naive` | 0.400323 | 0.397224–0.406364 | 0.6705 |
| `hip-tiled` | 0.183022 | 0.182662–0.185301 | 1.467 |
| `torch-mm` | 0.130701 | 0.064381–0.133702 | 2.054 |
| `triton-baseline` | 0.098701 | 0.087041–0.099041 | 2.720 |
| `triton-grouped` | 0.086721 | 0.085081–0.119481 | 3.095 |

所有边界与主 shape 记录均为 `correct=OK`。只为两个 HIP 与两个 Triton 教学实现采集独立 profile；`torch-mm` 是库参考，不混入教学 kernel 的资源归因。trace 索引见 [`profile_summary.csv`](evidence/profile_summary.csv)。

## 可复跑命令

```bash
RUN_EDGE_CASES=0 M=512 N=512 K=512 \
WARMUP=10 REPEAT=50 SEED=20260719 bash run_all.sh

PROFILE_WARMUP=0 PROFILE_REPEAT=5 bash profile_all.sh
```

## 结论与限制

HIP tiled 相比 naive 的收益在三次进程中稳定。Triton grouped 的中心值较低，但它的进程范围与 baseline 明显重叠，因此不能据此宣称 program 排序稳定获胜。`torch-mm` 的进程范围也很宽；本记录保留这个负面现象，不挑选单次最好值。

证据入口：[`manifest.json`](evidence/manifest.json)、[`summary.csv`](evidence/summary.csv)、[`summary.json`](evidence/summary.json)。

## 2026-09-20：ROCm 10.0 受控 tile / group 实验

RX9070XT/gfx1201，原生Ubuntu24.04.5、kernel7.0.0-31-generic，ROCm SDK10.0.0/HIP7.15.26333、torch2.13.0+rocm10.0.0、Triton3.8.0。详情与精确命令见 [`rounds/README.md`](evidence/rounds/README.md)。源码、运行及环境直接冻结并哈希，不在实验机操作Git。原始底稿为 `results/rocm10-20260920/` 与独立确认目录。

统一同输入和CPU FP64参考，逐元素atol=rtol=1e−4，显式finite检查及NaN预填。主1024³扫描9配置、附两矩形形状各5配置，共57进程2850样本；三维尾边共27项；9目标kernel trace均通过身份、启动规模与正确性验证。

HIP naive→tiled16为2.870803→1.386772ms，tiled8/32反而较慢。Triton32×32g1→64×32g1为0.516917→0.358038ms；32×64与64×32范围重叠。group扫描数值第一为g4，独立确认第一变成g8，差值小且不稳定，未宣称分组提升缓存命中或固定group最优。独立确认额外保留两种非方tile与全部group，共21进程1050样本，不混入主矩阵。旧ROCm7.13 evidence不改写。
