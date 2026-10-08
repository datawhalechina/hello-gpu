# 第 8 章独立边界正确性记录

这些文件从已有 `results/confirmation-20260920/` 提取，采集时间为 **2026-09-20（北京时间）**，并非本次新增 GPU 实验。原独立确认还包含性能复测；这里只发布其中 **12 项边界正确性检查**，不提取或合并性能复测成绩。

原记录的环境为 Radeon RX 9070 XT（gfx1201）、ROCm SDK 10.0.0、HIP 7.15.26333、Triton 3.8.0、原生 Ubuntu 24.04.5。manifest 保留原环境记录，导出时没有重新探测设备或环境。两份 kernel 的当前源码、原冻结源码与父确认记录的 SHA-256 一致。HIP 原检查使用父实验的冻结 binary；读者复跑命令使用本章编译的同源程序，二进制路径与构建身份不冒称相同。

## 怎样读输出

- 所有命令固定 `seed=20260920`、`warmup=0`、`repeat=1`，先完整 precheck，再执行一次 event 测量，最后完整 postcheck。预检前输出填 NaN，校验有限值及绝对误差 ≤1e-6。
- 12 项均为 `precheck=OK postcheck=OK correct=OK max_abs_error=0`。这是对这些具体长度的检查，不是对任意长度的正确性证明。
- 原程序同时打印 `min_ms`、`median_ms` 和有效带宽；这里是无预热的一次执行，**不得作为性能成绩、稳态带宽或优化加速比**，也不并入 walkthrough 的三进程比较图。
- 原采集入口把 stderr 合并到 stdout。因此这里的 `.log` 是原始合并终端流，不声称另行捕获了独立 stdout。全部 12 份逐字节复制，没有删行、路径替换或改写数字。

## 复跑命令

以下命令在已激活环境的 `code/part2-kernels/` 目录执行。HIP 的 `$RUN` 使用本章新一轮结果目录，且已完成 HIP 编译，存在 `$RUN/build/vector_add_hip`。命令只打印本次结果，不向主 benchmark 样本 CSV 追加数据。

### float4：余数为 2

N=2 只走标量尾部；N=6 同时覆盖一组 float4 和两个尾部元素；N=1026 覆盖较长向量部分与两个尾部元素。三次命令都请求 `--grid 256`，但程序根据工作量收缩实际 grid，这三个长度的原输出均为 **grid=1**。`hip-v3-g256` 是父实验的配置标识，不表示这些小输入实际启动 256 个 block。

```bash
"$RUN/build/vector_add_hip" --version v3 --size 2 --block 256 --warmup 0 --repeat 1 --seed 20260920 --grid 256
"$RUN/build/vector_add_hip" --version v3 --size 6 --block 256 --warmup 0 --repeat 1 --seed 20260920 --grid 256
"$RUN/build/vector_add_hip" --version v3 --size 1026 --block 256 --warmup 0 --repeat 1 --seed 20260920 --grid 256
```

### Triton：每个 tile 的少一个、恰好填满、多一个

512 对应 511/512/513；1024 对应 1023/1024/1025；2048 对应 2047/2048/2049。`--version t1` 才使用传入的 tile；`num_warps=4` 由同一份源码固定。每组三个长度的实际 program 数为 1/1/2。

```bash
python chapter8/vector_add_triton.py --version t1 --size 511 --block 512 --warmup 0 --repeat 1 --seed 20260920
python chapter8/vector_add_triton.py --version t1 --size 512 --block 512 --warmup 0 --repeat 1 --seed 20260920
python chapter8/vector_add_triton.py --version t1 --size 513 --block 512 --warmup 0 --repeat 1 --seed 20260920
python chapter8/vector_add_triton.py --version t1 --size 1023 --block 1024 --warmup 0 --repeat 1 --seed 20260920
python chapter8/vector_add_triton.py --version t1 --size 1024 --block 1024 --warmup 0 --repeat 1 --seed 20260920
python chapter8/vector_add_triton.py --version t1 --size 1025 --block 1024 --warmup 0 --repeat 1 --seed 20260920
python chapter8/vector_add_triton.py --version t1 --size 2047 --block 2048 --warmup 0 --repeat 1 --seed 20260920
python chapter8/vector_add_triton.py --version t1 --size 2048 --block 2048 --warmup 0 --repeat 1 --seed 20260920
python chapter8/vector_add_triton.py --version t1 --size 2049 --block 2048 --warmup 0 --repeat 1 --seed 20260920
```

## 文件与来源

| 检查 | 原始输出 |
| --- | --- |
| float4，N=2 | [boundary-float4-n2.log](./boundary-float4-n2.log) |
| float4，N=6 | [boundary-float4-n6.log](./boundary-float4-n6.log) |
| float4，N=1026 | [boundary-float4-n1026.log](./boundary-float4-n1026.log) |
| Triton tile=512，N=511 | [boundary-tile512-n511.log](./boundary-tile512-n511.log) |
| Triton tile=512，N=512 | [boundary-tile512-n512.log](./boundary-tile512-n512.log) |
| Triton tile=512，N=513 | [boundary-tile512-n513.log](./boundary-tile512-n513.log) |
| Triton tile=1024，N=1023 | [boundary-tile1024-n1023.log](./boundary-tile1024-n1023.log) |
| Triton tile=1024，N=1024 | [boundary-tile1024-n1024.log](./boundary-tile1024-n1024.log) |
| Triton tile=1024，N=1025 | [boundary-tile1024-n1025.log](./boundary-tile1024-n1025.log) |
| Triton tile=2048，N=2047 | [boundary-tile2048-n2047.log](./boundary-tile2048-n2047.log) |
| Triton tile=2048，N=2048 | [boundary-tile2048-n2048.log](./boundary-tile2048-n2048.log) |
| Triton tile=2048，N=2049 | [boundary-tile2048-n2049.log](./boundary-tile2048-n2049.log) |

`manifest.json` 绑定所有公开日志与本说明的 SHA-256，逐项保留父记录中的原日志哈希、实际 argv 和读者复跑命令。日志内容没有规范化；只有实际 argv 中的两个执行路径用明确符号替代：`<environment-python>` 表示当时的篇环境解释器，`<frozen-run>` 表示当时的冻结实验目录。参数顺序和值均保留；原 argv 的规范 JSON 哈希和完整原 commands.json 哈希也已记录。符号不是读者需要创建的路径，复跑使用上面的命令。

父公开证据是 [`../rounds/confirmation.json`](../rounds/confirmation.json)；本地原件继续保留在 `results/confirmation-20260920/`。导出不改父确认、原日志、原样本、walkthrough 记录或已发布性能图。
