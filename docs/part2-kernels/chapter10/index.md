---
title: "第10章 GEMM-Like：矩阵乘类算子"
description: "Hello GPU 第10章 · 以 Matmul 为例，学习分块、数据复用与寄存器累加"
---

# 第10章 GEMM-Like：矩阵乘类算子

## 本章导读

Vector Add 中，每个输入元素通常只服务一个输出位置；矩阵乘不同，同一个 `A[m, k]` 会参与一整行输出，同一个 `B[k, n]` 会参与一整列输出。GEMM 优化的起点，就是把这种**算法本来就存在的复用**变成 GPU 在片上存储中真正能利用的复用。

本章只处理最小而完整的 FP32、row-major Matmul：

```text
C[M, N] = A[M, K] @ B[K, N]
```

我们实现并对照五个入口：

| 名称 | 入口 | 第一版只改变什么 |
| ---- | ---- | ---- |
| `hip-naive` | HIP | 一个 thread 计算一个输出，直接读全局内存 |
| `hip-tiled` | HIP | 16×16 block 协作把 A/B tile 放入 LDS |
| `torch-mm` | PyTorch ROCm | 正确性参考，同时单独做 GPU event 计时 |
| `triton-baseline` | Triton | 32×32×32 tile，`GROUP_M=1` |
| `triton-grouped` | Triton | kernel 不变，只把 program 排序改为 `GROUP_M=8` |

本章**不提供尚未复跑的性能数字**。当前源码已完成静态语法检查，但 HIP 编译、GPU 正确性、kernel 时间、VGPR/LDS 和排序收益都必须在 Radeon RX 9070 XT（gfx1201）+ ROCm 7.13 + 原生 Ubuntu 24.04 实验机上重新采集后，才能形成性能结论。

读完后，你应该能回答：

1. `C[row, col]` 对应哪一个点积，row-major 地址怎样计算；
2. 朴素 kernel 为什么会从源码层面重复请求 A/B；
3. 一个 tile 在 LDS 或 Triton program 内怎样被多个输出复用；
4. 为什么尾块必须同时保护 M、N、K 三个方向；
5. 怎样把“代码看起来更高级”改写成可验证的 benchmark 与 profiling 问题。

## 10.1 从点积看矩阵乘

### 10.1.1 一个输出元素就是一次点积

设：

- `A` 的形状是 `M × K`；
- `B` 的形状是 `K × N`；
- `C` 的形状是 `M × N`。

那么：

```text
C[row, col]
= A[row, 0] * B[0, col]
+ A[row, 1] * B[1, col]
+ ...
+ A[row, K-1] * B[K-1, col]
```

`M` 决定输出有多少行，`N` 决定输出有多少列，`K` 是每个点积的长度。每个输出包含 `K` 次乘法和约 `K` 次加法，常用 `2 × M × N × K` 作为 FLOP 口径；这是算法工作量，不是实际指令条数的硬件计数。

### 10.1.2 Row-major 地址

本章三个矩阵都连续、row-major 存储。二维下标到一维地址的映射是：

```text
A[row, inner] -> A[row * K + inner]
B[inner, col] -> B[inner * N + col]
C[row, col]   -> C[row * N + col]
```

容易写错的是 B：`inner` 是 B 的行，B 每行有 `N` 个元素，所以步长是 `N`，不是 `K`。

以 `M=2, N=3, K=4` 为例，`C[1, 2]` 是：

```text
A[1*4 + 0] * B[0*3 + 2]
A[1*4 + 1] * B[1*3 + 2]
A[1*4 + 2] * B[2*3 + 2]
A[1*4 + 3] * B[3*3 + 2]
```

后面的 HIP 与 Triton 实现虽然线程/program 编号不同，最终都必须生成这组地址和同一个点积。

## 10.2 为什么朴素实现重复读取

最短的 GPU Matmul 是让一个 thread 负责一个 `C[row, col]`：

```cpp
float sum = 0.0f;
for (size_t inner = 0; inner < K; ++inner) {
    sum += A[row * K + inner] * B[inner * N + col];
}
C[row * N + col] = sum;
```

这段代码正确，但相邻输出会请求很多重复数据：

- `C[row, col]` 与 `C[row, col+1]` 都需要 A 的第 `row` 行；
- `C[row, col]` 与 `C[row+1, col]` 都需要 B 的第 `col` 列。

按源码逻辑，朴素版本计算全部输出会发出约 `2 × M × N × K` 次 float load 请求，再写 `M × N` 个 float。这里不能直接把请求数乘 4 Byte 当成物理 GDDR6 流量：L1/L2 可能命中，编译器也可能改变加载方式。正确表述是：**源码暴露了跨输出复用机会，但没有显式把这份复用组织在 block 内。**

要判断真实瓶颈，需要组合三种证据：

```text
源码：哪些输出重复使用同一输入
trace：grid、workgroup、LDS、VGPR 与 kernel 时间
对照：只改变分块方式，保持 M/N/K、dtype、计时边界一致
```

## 10.3 Tile 为什么能带来复用

### 10.3.1 手算一个 2×2 tile

先用 `M=N=K=4`、输出 tile 为 `2×2` 手算。为了得到左上角的四个输出：

```text
C[0:2, 0:2]
```

K 方向分两轮：

```text
第 0 轮：加载 A[0:2, 0:2] 和 B[0:2, 0:2]
第 1 轮：加载 A[0:2, 2:4] 和 B[2:4, 0:2]
```

每轮加载 4 个 A 元素和 4 个 B 元素，随后这 8 个值共同更新 4 个输出 accumulator。两轮共请求 16 个输入 float；若四个输出各自独立完成长度为 4 的点积，则源码层面会请求 `4 输出 × 4 inner × 2 输入 = 32` 个 float。

对完整 `4×4` 输出，四个输出 tile 一共请求 64 个输入 float，而朴素映射请求 128 个。这个手算说明的是**分块源码能表达的复用上限**，不是“显存流量一定减半”或“性能一定翻倍”。物理事务、cache、同步、occupancy 和指令开销仍要实测。

### 10.3.2 Block 级数据生命周期

一个 HIP output tile 的生命周期是：

```text
选中 C 的 16×16 输出块
→ 256 个 thread 协作加载 A/B 的 16×16 tile
→ __syncthreads()
→ 每个 thread 用 LDS 数据更新自己的 accumulator
→ __syncthreads()
→ 沿 K 方向移动到下一对 tile
→ 写回 C
```

第一次同步保证计算前 tile 已全部装好；第二次同步保证任何 thread 都不会在其他 thread 尚未读完时覆盖 LDS。

## 10.4 HIP v0：一线程一输出

完整实现位于 `code/part2-kernels/chapter10/matmul_hip.hip`。naive kernel 的二维映射是：

```cpp
size_t row = blockIdx.y * blockDim.y + threadIdx.y;
size_t col = blockIdx.x * blockDim.x + threadIdx.x;

if (row < M && col < N) {
    float sum = 0.0f;
    for (size_t inner = 0; inner < K; ++inner) {
        sum += A[row * K + inner] * B[inner * N + col];
    }
    C[row * N + col] = sum;
}
```

block 固定为 `16×16`。grid 的 x 维覆盖 N，y 维覆盖 M：

```text
grid.x = ceil(N / 16)
grid.y = ceil(M / 16)
```

`row < M && col < N` 保护 M/N 尾块；K 循环只遍历 `0..K-1`，因此不存在 K 越界。

Host 端会：

1. 解析 `--m/--n/--k/--version/--warmup/--repeat/--seed`；
2. 生成确定性的 FP32 输入；
3. 用 CPU 三重循环构造 reference；
4. 在正式计时前做完整输出校验；
5. 用逐次 HIP event 记录 min/median/mean；
6. 计时后再次校验，并输出最大绝对误差。

CPU reference 使用 double accumulator 后转成 FP32；GPU 的加法顺序与融合方式可能不同，所以正确性使用绝对误差与相对误差组合阈值，不要求 bitwise 相等。

## 10.5 HIP v1：LDS 分块

### 10.5.1 协作加载

tiled kernel 仍让一个 thread 负责一个输出，但 block 内 256 个 thread 先各自加载一个 A 元素和一个 B 元素：

```cpp
__shared__ float tile_a[16][16];
__shared__ float tile_b[16][16];

size_t a_col = tile * 16 + threadIdx.x;
size_t b_row = tile * 16 + threadIdx.y;

tile_a[threadIdx.y][threadIdx.x] =
    row < M && a_col < K ? A[row * K + a_col] : 0.0f;
tile_b[threadIdx.y][threadIdx.x] =
    b_row < K && col < N ? B[b_row * N + col] : 0.0f;
__syncthreads();
```

之后每个 thread 读取 LDS 中的一行 A 和一列 B：

```cpp
for (int inner = 0; inner < 16; ++inner) {
    sum += tile_a[threadIdx.y][inner]
         * tile_b[inner][threadIdx.x];
}
__syncthreads();
```

一块 `tile_a` 被 16 个输出列复用，一块 `tile_b` 被 16 个输出行复用。这是 v1 相比 v0 唯一需要验证的核心假设。

### 10.5.2 K 尾块为什么填零

当 `K % 16 != 0`，最后一轮只有一部分输入有效。所有 thread 仍必须参加两次 `__syncthreads()`，所以不能让越界 thread 提前 return。实现采用：

```text
有效 A/B 地址 -> 正常加载
越过 M/N/K   -> 向 LDS 写 0
全部 thread   -> 同步并完成 16 次乘加
```

填零让最后一轮仍能使用同一循环结构，同时不改变有效点积。M/N 尾块中的 thread 也继续参加同步，只在最终写回时用 `row < M && col < N` 关闭越界 store。

### 10.5.3 不能从 LDS 推导“更快”

LDS 版本减少源码层面的重复 global load，但同时增加：

- 两组 LDS store 与 load；
- 每个 K tile 的两次 block 同步；
- 固定 tile 可能不适合目标 shape；
- LDS、VGPR 和 block 大小共同影响 occupancy。

因此本章只把 `hip-tiled` 称为“LDS 分块版”，不称为“优化成功版”。是否更快，要看同 shape 的 GPU event 和 `rocprofv3` 结果。

## 10.6 寄存器分块：为什么一个 thread 会计算多个输出

当前第一版 HIP 代码只实现 v0/v1。寄存器分块是下一步实验设计，不是已经完成的性能结论。

在 v1 中，一个 thread 只有一个 accumulator：

```text
thread -> C[row, col] -> 1 个 FP32 accumulator
```

一维寄存器分块可以让一个 thread 同时算同一行的多个列：

```text
thread -> C[row, col:col+R] -> R 个 accumulator
```

二维寄存器分块则让一个 thread 维护小块：

```text
thread -> C[row:row+RM, col:col+RN]
       -> RM × RN 个 accumulator
```

这样一次从 LDS 读取的 A/B fragment 可以更新多个输出，减少每个输出对应的地址计算和指令开销；代价是 accumulator、临时 fragment 和索引都占 VGPR。寄存器分块不是越大越好，至少需要同时记录：

| 证据 | 要回答的问题 |
| ---- | ---- |
| 正确性 | 每个 thread 覆盖的输出是否重叠或遗漏 |
| VGPR | accumulator 增加后静态寄存器数怎样变化 |
| Grid/Workgroup | thread 数和输出覆盖是否一起改变 |
| kernel 时间 | 收益是否稳定超过运行波动 |

在没有这些记录前，本章不添加一个名字叫 v2/v3、但只有假设没有证据的版本。

## 10.7 HIP 进阶实验怎样保持单变量

后续可以从三类机制中一次只选一个：

1. **改变 K tile**：例如 8、16、32；保持 M/N tile、dtype、输入与计时不变，同时关注 LDS 和同步次数。
2. **双缓冲**：在计算当前 LDS tile 时准备下一 tile；需要证明 overlap 确实发生，并计算额外 LDS 占用。
3. **WMMA**：改变为矩阵指令支持的 dtype/tile；这会同时改变数值精度和计算路径，不能与 FP32 VALU 结果混成一个单变量实验。

第一版代码选 `TILE=16` 只是为了让边界、协作加载和同步容易读懂，不代表它是 9070XT 的最佳配置。

## 10.8 Triton t0：用 `tl.dot` 表达同一分块

完整入口位于 `code/part2-kernels/chapter10/matmul_triton.py`。Triton program 一次负责一个 `32×32` 输出 tile，K 方向每次推进 32：

```python
offsets_m = pid_m * BLOCK_M + tl.arange(0, BLOCK_M)
offsets_n = pid_n * BLOCK_N + tl.arange(0, BLOCK_N)
offsets_k = tl.arange(0, BLOCK_K)

accumulator = tl.zeros((BLOCK_M, BLOCK_N), tl.float32)
for k_block in range(0, tl.cdiv(K, BLOCK_K)):
    a = tl.load(a_ptrs, mask=mask_a, other=0.0)
    b = tl.load(b_ptrs, mask=mask_b, other=0.0)
    accumulator += tl.dot(a, b)
    a_ptrs += BLOCK_K
    b_ptrs += BLOCK_K * N
```

`tl.dot` 表达 tile 点积，但它不会替你决定所有事情。Host 仍要确定：

- `BLOCK_M/BLOCK_N/BLOCK_K`；
- program grid；
- program 排序；
- `num_warps`；
- M/N/K 尾部 mask；
- 正确性阈值和计时边界。

本章固定 `32×32×32`、`num_warps=4`。`triton-baseline` 使用 `GROUP_M=1`，相当于按单行 M tile 依次遍历 N tile。固定配置的目的，是先让 program 映射可解释，不在第一版把 autotune 搜索结果误当成原理。

PyTorch ROCm 的 `torch.mm` 同时承担两个角色：

1. 生成 Triton 输出的 GPU reference；
2. 作为 `torch-mm` 独立入口，用相同 GPU event 方式计时。

reference 的那次 `torch.mm` 不计入任何 Triton event 区间。

## 10.9 Triton t1：Grouped ordering 改变什么

矩阵较大时，多个输出 tile 可能复用相邻的 A 或 B 区域。Grouped ordering 不改变数学表达式和 tile 大小，只改变 program 的访问顺序：

```python
programs_per_group = GROUP_M * programs_n
group_id = program_id // programs_per_group
first_program_m = group_id * GROUP_M
group_m = min(programs_m - first_program_m, GROUP_M)

program_m = first_program_m + program_in_group % group_m
program_n = program_in_group // group_m
```

本章对照为：

| 版本 | tile | `num_warps` | `GROUP_M` |
| ---- | ---- | ----: | ----: |
| `triton-baseline` | 32×32×32 | 4 | 1 |
| `triton-grouped` | 32×32×32 | 4 | 8 |

两版唯一有意改变的是 program 排序。Grouped ordering 可能改善相邻 program 的 cache 局部性，也可能对当前 shape 没有稳定收益。必须先记录相同 M/N/K 下多次独立运行的范围，再决定是否保留。

本章不启用 autotune。等固定 baseline 在远端跑通后，可以只给出少量、可解释的 tile/group 组合，并把每次选中的配置、shape、ROCm/Triton 版本落盘；否则“最快配置”无法复现。

## 10.10 非方阵与三种尾块

只测 `512×512×512` 会遮住很多错误。本章把 M/N/K 分开暴露，并在 `run_all.sh` 中覆盖 `3×5×7`、`15×17×19`、`17×19×23`、`31×33×29` 等非方阵、非整除 shape。

| 尾部 | HIP tiled | Triton |
| ---- | ---- | ---- |
| M 尾块 | 越界 thread 向 LDS 写 0，最终不写 C | `offsets_m < M` 关闭 A load 与 C store |
| N 尾块 | B 越界列向 LDS 写 0，最终不写 C | `offsets_n < N` 关闭 B load 与 C store |
| K 尾块 | 越界 A/B 输入向 LDS 写 0 | `current_k < K` mask 两个输入 tile |

Triton 的输出 mask 只能保护 store，不能代替 K 方向 load mask；HIP 中 M/N 越界 thread 也不能在第一次同步前提前 return。两条路线都必须先通过尾块正确性，再记录主 shape 性能。

## 10.11 HIP 与 Triton 的分块层次对照

| 问题 | HIP tiled | Triton `tl.dot` |
| ---- | ---- | ---- |
| 谁选择输出 tile | `blockIdx.x/y` | `program_id` 映射到 `pid_m/pid_n` |
| tile 内并行实例 | 16×16 threads | 编译器映射一个 32×32 program |
| 输入 tile | 显式 `__shared__` 数组 | `tl.load` 得到张量 tile |
| K 方向累加 | thread 标量循环 | program 内 `tl.dot` |
| 同步 | 显式 `__syncthreads()` | 由 program 内数据依赖与编译器处理 |
| 尾块 | `if` + LDS 填零 | load/store mask + `other=0` |
| 排序 | grid/block 形状与 launch 顺序 | `program_id` 到 M/N tile 的映射 |
| 资源证据 | LDS/VGPR/SGPR/workgroup | VGPR/SGPR、program tile、生成 kernel |

两种语言的抽象层不同，但优化问题相同：哪些输入由哪些输出复用、复用发生在哪一级存储、为复用付出了多少同步和资源成本。

## 10.12 运行、输出与 Profiling

### 10.12.1 环境与一键入口

在 Radeon RX 9070 XT 实验机上：

```bash
cd code/part2-kernels
uv sync
source ./activate-rocm.sh
bash chapter10/run_all.sh
```

`run_all.sh` 会：

```text
检查并激活 code/part2-kernels/.venv
→ 用 hipcc --offload-arch=gfx1201 -O3 编译 HIP
→ 对 HIP/PyTorch/Triton 跑非方阵与尾块 shape
→ 对主 shape 跑 HIP naive/tiled
→ 对主 shape 跑 torch/baseline/grouped
→ 每个实现计时后再次校验
```

默认主 shape 是 `512×512×512`，可用环境变量覆盖：

```bash
M=1024 N=768 K=513 WARMUP=10 REPEAT=50 \
    bash chapter10/run_all.sh
```

若只想先做快速正确性 smoke test：

```bash
M=65 N=67 K=69 WARMUP=0 REPEAT=1 \
    bash chapter10/run_all.sh
```

输出统一使用单行 `RESULT key=value ...`。重点保留：

```text
implementation / runtime
m / n / k
tile 或 block_m/block_n/block_k/group_m
warmup / repeat
correct / max_abs_error
min_ms / median_ms / mean_ms / tflops
```

`tflops` 是按 `2MNK / median_time` 换算的算法性能，不等于硬件指令计数。

### 10.12.2 单独运行 HIP 或 Triton

```bash
cd code/part2-kernels
source ./activate-rocm.sh

hipcc --offload-arch=gfx1201 -O3 -std=c++17 \
    chapter10/matmul_hip.hip -o /tmp/matmul_hip

/tmp/matmul_hip --version naive --m 257 --n 259 --k 263 \
    --warmup 5 --repeat 20
/tmp/matmul_hip --version tiled --m 257 --n 259 --k 263 \
    --warmup 5 --repeat 20

python chapter10/matmul_triton.py --version baseline \
    --m 257 --n 259 --k 263 --warmup 5 --repeat 20
python chapter10/matmul_triton.py --version grouped \
    --m 257 --n 259 --k 263 --warmup 5 --repeat 20
```

### 10.12.3 用 `rocprofv3` 核对 dispatch 与资源

profiler 要与 GPU event benchmark 分开跑。先编译并做一次正常预热，再采短 trace：

```bash
mkdir -p /tmp/hello-gpu-ch10-profile

rocprofv3 --kernel-trace \
    --output-directory /tmp/hello-gpu-ch10-profile \
    --output-file hip-naive --output-format csv \
    -- /tmp/matmul_hip --version naive --m 512 --n 512 --k 512 \
       --warmup 0 --repeat 5

rocprofv3 --kernel-trace \
    --output-directory /tmp/hello-gpu-ch10-profile \
    --output-file hip-tiled --output-format csv \
    -- /tmp/matmul_hip --version tiled --m 512 --n 512 --k 512 \
       --warmup 0 --repeat 5
```

Triton 第一次运行可能包含 JIT 编译，先在 profiler 外预热：

```bash
python chapter10/matmul_triton.py --version all \
    --m 512 --n 512 --k 512 --warmup 1 --repeat 1

rocprofv3 --kernel-trace \
    --output-directory /tmp/hello-gpu-ch10-profile \
    --output-file triton-grouped --output-format csv \
    -- python chapter10/matmul_triton.py --version grouped \
       --m 512 --n 512 --k 512 --warmup 0 --repeat 5
```

第一轮只读这些列：

| 字段 | 用途 |
| ---- | ---- |
| `Kernel_Name` | 排除 reference、初始化或其他 kernel |
| 时间戳/Duration | 和 GPU event 的量级互相核对 |
| Grid/Workgroup Size | 确认二维输出覆盖和 program 数 |
| LDS | 检查 HIP tiled 是否确实分配共享存储 |
| VGPR/SGPR | 为后续寄存器分块建立 baseline |

当前仓库没有提交本章远端 profile 或性能表。完成实验后，应把硬件、提交 SHA、命令、原始 `RESULT`、trace 路径和结论一起记录；没有原始证据时不能把某个版本写成“更快”。

## 10.13 练习

1. 手算 `M=3, N=5, K=7` 时 `C[2,4]` 访问的 A/B 一维下标，再和 CPU reference 循环对照。
2. 把 `run_all.sh` 的边界 shape 改成 `M=16, N=16, K=17`，说明只有哪一个维度出现尾块，以及 HIP LDS 中哪些位置被填 0。
3. 保持 `M/N/K` 不变，只把 HIP `kTile` 从 16 改成 8。记录 grid、workgroup、LDS、同步轮数和时间，不要只记录一个最终延迟。
4. 设计一个 1×2 寄存器分块草图：列出 thread 需要的两个 accumulator、共享的 A 值和两个 B 值；先不写代码，估算 VGPR 增量。
5. 把 Triton `GROUP_M` 改为 4，保持 tile 和 `num_warps` 不变。至少跑 3 个独立进程，比较运行范围是否重叠。
6. 选择一个极瘦矩阵，如 `M=4096, N=8, K=1024`。先预测固定 `32×32` tile 会浪费哪些位置，再用正确性与 trace 验证。
7. 为转置 B 设计新的 row-major 地址公式。先修改 CPU reference，再修改 HIP/Triton；若只改 kernel 而 reference 不变，测试应失败。

## 本章小结

- Matmul 的每个输出是长度 K 的点积；row-major 地址分别使用 K、N、N 作为行步长。
- 朴素实现正确但没有显式组织跨输出复用；tile 让一块 A/B 数据共同更新多个输出。
- HIP naive 与 LDS tiled 共享同一 CPU reference、边界 shape 和 GPU event 计时边界，便于做受控对照。
- M/N 尾块保护输出覆盖，K 尾块保护点积输入；HIP 用 LDS 填零，Triton 用 mask 与 `other=0`。
- 寄存器分块能增加 LDS fragment 的复用，也会提高 VGPR 压力；当前第一版只讲实验设计，不虚构 v2/v3 收益。
- Triton baseline/grouped 使用相同 `tl.dot` tile，只改变 program 排序；更少 cache miss 是待验证假设，不是代码名称自带的结论。
- 当前已完成源码、静态检查以及 9070XT 上的小规模 HIP/Triton 编译与正确性 smoke test；正式性能和 profiler 资源数据仍待多轮远端实验。

## 延伸阅读

- AMD HIP Programming Model 与性能指南
- ROCprofiler SDK / `rocprofv3` kernel trace 文档
- Triton Matrix Multiplication 教程与 `tl.dot` API
- PyTorch ROCm 的 CUDA semantics 兼容接口说明
