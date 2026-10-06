# HIP 局部归约映射对照

本目录记录 2026-09-19 在 Radeon RX 9070 XT（gfx1201）、ROCm SDK 10.0.0、HIP 7.15.26333、原生 Ubuntu 24.04 上的对照。A 为 `sequential`，B 为 `interleaved`，C 为 `compacted`。三个版本保持输入加载、block 大小、同步轮数和最终合并不变，只比较局部归约映射。

## 文件与统计口径

- `summary.csv`：全部四种长度、三个版本、两个计时区间的汇总，共 24 行。
- `process-summary.csv`：每个独立进程的中位数及样本范围，共 72 行。
- `summary.json`：同一统计结果，并保留每个进程的 CSV 路径和中位数。
- `manifest.json`：环境、运行参数、正确性核对、源码与二进制 SHA-256，以及原始日志和 CSV 的哈希。

每个长度启动三个独立进程。每个进程预热 10 轮，再对每个版本、每个区间各测 50 轮；先求进程内中位数，再报告三个进程中位数的中位数与最小—最大范围。这个范围表示本次进程间波动，不是置信区间。`partial` 只测第一阶段；`two-stage` 测第一阶段与共同的最终合并。两个区间分别统计，原始样本不跨进程混合。

测试重用输入，不主动清空缓存。每轮轮换版本顺序，奇数轮反转两个区间的先后顺序；benchmark 不启用 profiler。GPU 未独占，保留桌面及休眠 notebook 上下文。所有正式运行及尾部输入的前后正确性检查均通过，具体核对记录见 manifest。

## 复跑入口

在已激活本篇 ROCm 环境的实验机上，进入 `code/part2-kernels/chapter9/`，编译：

```bash
hipcc --offload-arch=gfx1201 -O3 -std=c++17 -save-temps \
  reduction_mapping.hip -o reduction_mapping
```

为输出准备 `samples/` 和 `logs/` 后，按以下参数运行三个独立进程；正式长度为 `1024`、`65536`、`1048576`、`16777216`：

```bash
mkdir -p samples logs
for process in 1 2 3; do
  for size in 1024 65536 1048576 16777216; do
    ./reduction_mapping --version all --size "$size" --block 256 \
      --input random --seed 20260919 --warmup 10 --repeat 50 \
      --order rotate --measure both \
      --samples "samples/bench-${size}-p${process}.csv" \
      > "logs/bench-${size}-p${process}.txt" 2>&1 || exit 1
  done
done
```

原始日志和 CSV 在维护者本地的 `results/mapping-20260919/` 保留。现有证据的汇总命令为：

```bash
python3 summarize_mapping.py \
  results/mapping-20260919/samples/bench-*.csv \
  --path-base . --output-dir evidence/tree-layout
```

重新实验时，将输入路径和输出目录换成新实验的目录，保留本次证据。汇总脚本只处理时间；正确性需要同时检查每次运行的 `CHECK` 和 `RESULT`。`python3 check_mapping_model.py` 可在普通 CPU 上检查逐轮地址配对、输入覆盖及尾部边界，不产生 GPU 性能结论。

## 结论范围

在 `N=16777216`、block 为 256 时，A/B/C 第一阶段的三个进程中位数之中位数分别为 **398.666 / 438.046 / 441.645 µs**。B 比 A 慢；将 B 改为 C 没有得到稳定提速，B/C 的跨进程范围重叠。完整形状矩阵同时保留，较短输入的差异不能用主形状的比例代替。

这组实验采用固定的两阶段合并，不直接与原有 LDS 加全局 atomic 版本的总时间比较。时间只能说明表现；分支执行、指令成本或 LDS 冲突的解释需要结合另外采集的 kernel trace、编译结果或性能计数器。
