# 归约布局对照：profiler 与 ISA 证据

硬件为 Radeon RX 9070 XT（gfx1201），环境为原生 Ubuntu 24.04、ROCm SDK 10.0.0、HIP 7.15.26333、AMD clang 23.0.0git、rocprofv3 1.3.5。本次诊断复用正式实验已经生成的二进制和 `-save-temps` GPU code object，没有重新编译。

## 采集范围

三个版本分别执行 kernel trace 和单项 `Wavefronts` PMC。参数相同：`N=16,777,216`、`block=256`、`warmup=0`、`repeat=5`、`measure=partial`；默认输入为 `random`，seed 为 `20260919`。每次 precheck/postcheck 均通过，所有 partial 与参考完全一致，最终结果为 `202.25`。

采集命令结构如下；输出目录与 samples 文件分别独立：

```bash
rocprofv3 --kernel-trace --kernel-include-regex 'mapping_.*_partial' \
  --output-format csv --output-directory <trace-output> --output-file <version>-trace -- \
  ./reduction_mapping --version <version> --size 16777216 --block 256 \
  --warmup 0 --repeat 5 --measure partial --samples <trace-samples.csv>

rocprofv3 --pmc Wavefronts --kernel-include-regex 'mapping_.*_partial' \
  --output-format csv --output-directory <pmc-output> --output-file <version>-wavefronts -- \
  ./reduction_mapping --version <version> --size 16777216 --block 256 \
  --warmup 0 --repeat 5 --measure partial --samples <pmc-samples.csv>
```

`<version>` 依次为 `interleaved`、`compacted`、`sequential`。该版本 profiler 的 `--kernel-include-regex` 筛选 counter/ATT，**不会删去 kernel trace 的其他记录**；汇总时再次按完整 partial kernel 名称筛选。

## 启动与计数核对

[profile_summary.csv](./profile_summary.csv) 每个版本一行。每份 trace 有 10 个 dispatch：6 个 partial（1 次预检 + 5 次计时）、2 个固定 final（预检与后检各一次）、2 个运行时拷贝。后检复用最后一次计时留下的 partial，不再启动第一阶段。不要把预检 partial 和固定 final 算进 5 个目标样本。

单项 PMC 每版仅保留 6 个 partial，`Wavefronts` 均为 `524,288`，与 `65,536 blocks × 256 threads ÷ wave32` 一致。这个计数说明启动的 wave 数相同，不表示每条指令有同样多的有效 lane，更不直接测量发散损失。

## 编译产物确认了什么

[isa_excerpt.txt](./isa_excerpt.txt) 从同一 GPU code object 截取实际反汇编和 metadata，并记录源码与 code object SHA-256：

- 三个 partial kernel 均明确为 `.wavefront_size: 32`；源汇编也有 `.amdhsa_wavefront_size32 1`。因此本次 wave32 判断来自实际编译产物。
- 三版归约循环均保留 `v_cmpx_*`、`s_cbranch_execz` 与 `s_or_b32 exec_lo,...`。比较结果控制当前执行掩码，掩码为空时跳过加法体，随后在共同的屏障前恢复掩码。`compacted`/`sequential` 没有消灭所有部分 lane 参与的阶段。
- `interleaved` 的 `% (2*stride)` 已转成移位、减一、`v_and_b32` 和等零比较，**不能将它的时间解释为执行了昂贵整数除法**。
- `compacted` 实际有 `v_mul_lo_u32` 计算 `j=2*stride*thread`，并形成两个 LDS 字节地址；`sequential` 直接比较线程号与 stride，复用线程自己的 LDS 地址并计算伙伴偏移。源码布局改动同时改变了实际地址/条件指令，不能把版本差值全归因于发散。
- 三个 partial 的 code-object metadata 均为 VGPR 4、SGPR 10、spill 0、固定 LDS 0。trace 却报告 VGPR 8、SGPR 128、LDS_Block_Size 0。两类字段按各自原名保存，不混作同一口径；也不能凭它们断言 occupancy 有差异。每块请求的动态 LDS 实际为 `256*sizeof(float)=1024` 字节。

## 解释边界

这次没有重试此前仅返回零的 SQ/LDS counter，也没有产生 bank conflict 或有效 lane 利用率的直接测量。ISA 能确认生成的指令，无法单独分摊其耗时贡献。

所有 PMC stderr 都记录 InterceptQueue 回退到 system-memory ring、原 priority/CU-mask 不保留的警告。设备还运行桌面和空闲 notebook GPU 上下文；采集前观察到轻负载。这些带 profiler 的 event 时间与 trace 区间仅留在本地原始工件中，**不参与正式 benchmark 汇总或优化比例计算**。

完整原始工件位于本地忽略目录 `code/part2-kernels/chapter9/profiles/mapping-20260919/`；本次诊断公开的文件仅为本说明、精简计数汇总和 ISA 摘录。精确命令、工具输出、CSV、源码和 code object 均保存在原始工件中。
