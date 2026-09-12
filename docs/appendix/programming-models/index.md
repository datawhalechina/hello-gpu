---
title: "附录 D · HIP 与 Triton 的编程范式"
description: "用同一个向量加法理解线程、数据块、启动网格和边界处理"
---

<script setup lang="ts">
import ElementwiseJourney from '../../part2-kernels/chapter8/elementwise-journey.vue'
</script>

# 附录 D · HIP 与 Triton 的编程范式

我们已经知道 GPU 可以让很多计算并行进行。写程序时，还需要回答一个问题：**核函数里的一段代码，描述的是谁的工作？**

这份附录用同一个向量加法介绍两种常见视角。HIP 先描述一个线程怎样处理数据；Triton 先描述一个 program 怎样处理一块数据。先选自己准备使用的语言阅读，之后回到 [第 8 章](../../part2-kernels/chapter8/index.md)，就可以把注意力放在算子优化上。

## D.1 先固定同一道题

我们只计算 `C[i] = A[i] + B[i]`。假设有 6 个有效元素，编号为 0 到 5。为了看清边界，下面的示意让启动范围覆盖 8 个位置，最后两个位置不能读取或写入数组。

::: figure fig-programming-perspectives
<ElementwiseJourney scenario="paradigm" />

同一个带尾部的加法，分别从单线程与数据块的视角描述。示意中的分组大小用于手算，不是推荐的性能配置。
:::

@fig-programming-perspectives 中，两条路线没有改变答案，只是改变了程序如何表达分工。可先单步查看 HIP，再切到 Triton。不要把 program、thread 和 wavefront 当成同一个对象。

## D.2 HIP：描述一个线程的工作 {#hip-model}

HIP 用 C++ 扩展编写 GPU 程序。主机（host）上的代码负责准备内存和启动工作，设备（device）上的核函数负责执行并行计算。核函数前的 `__global__` 表示它可以由主机启动、在设备上运行。

下面直接摘录第 8 章已实测的 `vector_add_hip.hip`。先注意函数体里的 `index`：它是当前线程负责的一个下标。

```cpp
__global__ void vector_add_v0(const float* __restrict__ input_a,
                              const float* __restrict__ input_b,
                              float* __restrict__ output,
                              std::size_t size) {
    const std::size_t index =
        static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (index < size) {
        output[index] = input_a[index] + input_b[index];
    }
}
```

`const float*` 是指向输入数组的指针；`float* output` 是输出位置。`__restrict__` 告诉编译器，这几个指针在本例中不指向相互重叠的数据区域。初读时，先理解它们分别是 A、B、C 三个数组即可。

### D.2.1 线程、block 与 grid

**线程（thread）**执行一次核函数正文。同一个 **block** 中有一组线程；一次启动的所有 block 构成 **grid**。三个内置量帮助线程找到自己：

| 量 | 在一维问题里的含义 |
| --- | --- |
| `threadIdx.x` | 当前线程在 block 内的编号，从 0 开始 |
| `blockIdx.x` | 当前 block 在 grid 内的编号，从 0 开始 |
| `blockDim.x` | 每个 block 的线程数 |

因此，全局下标等于“前面 block 的线程数 + 自己在 block 内的编号”。手算时若每个 block 有 4 个线程，block 1 的线程 0 得到 `1 × 4 + 0 = 4`；它处理数组位置 4。

数组有 6 个元素时，启动两个这样的 block 会覆盖下标 0–7。线程 6、7 的 `index < size` 为假，所以不会访问数组。这也解释了为什么向上取整得到 grid 后，还需要在 kernel 中检查边界。

### D.2.2 一个线程不必只做一个元素

“一个线程处理一个元素”只是这版程序的选择。线程也可以循环处理多个元素，或者用寄存器保存多个累加结果。第 8 章的 grid-stride loop、第 11 章的矩阵乘都在复用这个思路。

同一个 block 的线程可以通过 **LDS** 交换数据，并用 `__syncthreads()` 等待组内线程到齐。需要让该 block 的所有相关线程到达同一次同步，不能让部分线程提前退出而其他线程仍等待。不同 block 之间通常通过另一次 kernel 启动或特定同步机制衔接，不能把组内屏障当成整张 GPU 的屏障。

GPU 会将线程组织成 wavefront 执行。教程主线的相关 HIP 实验使用 wave32，但 thread/block 是程序组织方式，wavefront 是执行分组；不要认为一个 block 必定只有一个 wavefront。更完整的调度与资源讨论见 [第 2 章](../../part0-intro/chapter2/index.md)和[第 3 章](../../part0-intro/chapter3/index.md)。

## D.3 Triton：描述一块数据的工作 {#triton-model}

Triton 用 Python 语法描述核函数，通过编译器生成 GPU 代码。普通 Python 负责主机端的准备与启动；标有 `@triton.jit` 的函数描述设备端计算。它不是在 GPU 上运行任意 Python 解释器，也不是把普通 Python 循环原样复制给每个线程。

下面是第 8 章 `vector_add_triton.py` 的真实核函数：

```python
@triton.jit
def vector_add_kernel(
    input_a_ptr,
    input_b_ptr,
    output_ptr,
    size,
    BLOCK_SIZE: tl.constexpr,
):
    """Add one tile of two FP32 vectors per Triton program."""
    program_id = tl.program_id(axis=0)
    offsets = program_id * BLOCK_SIZE + tl.arange(0, BLOCK_SIZE)
    valid = offsets < size

    input_a = tl.load(input_a_ptr + offsets, mask=valid, other=0.0)
    input_b = tl.load(input_b_ptr + offsets, mask=valid, other=0.0)
    tl.store(output_ptr + offsets, input_a + input_b, mask=valid)
```

这里的 `offsets` 是一组下标，`input_a` 和 `input_b` 是一块数据。加号对块内对应位置逐元素运算；`tl.store` 再将结果写回对应的一组地址。

### D.3.1 program 与 tile

**program** 是核函数的一次逻辑执行实例。`tl.program_id(axis=0)` 得到它在启动网格中的编号；**tile** 指这次实例处理的数据块。程序员选择块的形状与操作，编译器负责把块内工作映射到 GPU 线程和寄存器等资源。

在一维加法中，先生成块内下标 `tl.arange(0, BLOCK_SIZE)`，再加上块起点 `program_id * BLOCK_SIZE`。手算时若 `BLOCK_SIZE=4`，program 0 得到 `[0,1,2,3]`，program 1 得到 `[4,5,6,7]`。

`BLOCK_SIZE: tl.constexpr` 表示这个参数在编译该 kernel 实例时已知。它决定逻辑数据块有多少元素，**不等于硬件线程数**。`num_warps` 是另一个编译配置，用于控制 program 的执行分组规模，也不能与 `BLOCK_SIZE` 混为一谈。

### D.3.2 mask 保护每个位置

当 `size=6` 时，program 1 的 `valid` 是 `[True, True, False, False]`。加载和存储分别使用这个 mask，关闭最后两个位置的内存访问。

`other=0.0` 表示被关闭的加载位置在逻辑数据块中得到 0。它不是往越界的内存地址写 0；写回由 `tl.store` 自己的 mask 控制。以后做归约时，占位值还必须符合运算：求和通常用 0，求最大值通常用负无穷。第 9、10 章会继续解释原因。

### D.3.3 主机怎样启动 program

第 8 章的主机函数用 `triton.cdiv(size, implementation.block_size)` 向上取整，得到覆盖全部有效元素所需的 program 数。然后通过 `vector_add_kernel[grid](...)` 传入输入、输出指针和编译参数。

输入和输出在调用前已经分配好；kernel 的定义本身不会替你分配一个完整的 PyTorch 输出张量。看到 `torch.cuda` 或 `device="cuda"` 时，也不要据此判断使用了 NVIDIA GPU：ROCm 版 PyTorch 沿用这些接口名，本教程的实际设备仍是 AMD GPU。

## D.4 怎样把两种写法对应起来

两种语言都需要描述“读哪里、做什么、写哪里”。区别在于源码最先暴露的工作单位：

| 要回答的问题 | 本例 HIP | 本例 Triton |
| --- | --- | --- |
| 当前实例先得到什么？ | 一个线程的标量 `index` | 一个 program 的向量 `offsets` |
| 怎样覆盖完整数组？ | 根据 block/thread 编号生成下标 | 根据 program 编号生成一个 tile 的下标 |
| 尾部怎样保护？ | `if (index < size)` | load/store 各自使用 mask |
| 怎样让线程协作？ | 显式组织 LDS、同步与 wavefront 操作 | 表达块上的操作，由编译器实现块内映射与协作 |
| 哪些仍由程序员负责？ | 分工、地址、同步、边界、验证和计时 | 分块、地址、mask、运算、验证和计时 |

这是一组职责对照，不是 API 一对一替换。比如 Triton 的 `tl.sum` 表达块上求和，并不等于 HIP 的某一行 `__syncthreads()`；后者只负责同步，不会自动把数据加起来。

先尝试预测：把数组长度改成 10，手算分组大小仍为 4，需要多少组？最后一组会关闭哪些位置？两种路线都需要 3 组，最后一组覆盖 8–11，其中 10、11 无效。能解释这个结果，就可以回到 [第 8 章](../../part2-kernels/chapter8/index.md#_8-4-实现向量加法)继续学习真实配置与性能实验。

## 延伸阅读

- [HIP 编程模型](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html) — 主机、设备、线程组织和内存模型。
- [Triton 编程指南](https://triton-lang.org/main/programming-guide/chapter-1/introduction.html) — 从数据块出发表达并行计算。
- [Triton 向量加法教程](https://triton-lang.org/main/getting-started/tutorials/01-vector-add.html) — 下标、mask、主机启动与校验的完整例子。
- [PyTorch HIP 语义](https://docs.pytorch.org/docs/2.11/notes/hip.html) — ROCm 后端与 `torch.cuda` 名称的关系。
