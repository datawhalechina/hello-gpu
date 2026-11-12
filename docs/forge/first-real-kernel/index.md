---
layout: stage
stage: forge-first-real-kernel
newTerms: [program, tile]
evidence: mixed
description: 把新手村的 vector add 搬上真卡：HIP 写一个线程做什么，Triton 写一个 program 算一块 tile；主机端走完申请显存、拷进、启动、同步、拷回，再用 7 个长度加护栏查出越界写，最后和 torch 比有效带宽。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import { githubUrl } from '@course/lab.ts'
import ThreadTile from './scenes/ThreadTile.vue'
import HostSteps from './scenes/HostSteps.vue'
import GuardCheck from './scenes/GuardCheck.vue'
import { GUARD_ELEMENTS, HIP_MAX_THREADS, STAGE_ID, TRITON_NUM_WARPS } from './kernel.ts'

const S = STAGE_ID
const GOAL = '在一块真的 AMD GPU 上编译、运行第一个 vector add，用 7 个长度校验它，再和 torch 比有效带宽。'
// 星级标准从大纲的 lab.stars 读（06 第 7 节）：任务卡、LabCard 判星和 Notebook 用的是同一份规则。
const STARS = stageById(S).lab.stars.map((star) => star.text)

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const NEXT = neighborsOf(S).next
const GROUPS = stageById('novice-thread-groups')
const YOUR_GPU = stageById('forge-your-gpu')
const ROUTE_ADV = stageById('forge-route-advanced')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
// 实验档案馆的参考记录在这张卡上测（R-01），硬件参数同样从 hardware.json 读。
const REF = HARDWARE_DEVICES['ai-pro-r9700']
// hello_gpu 的源码在 GitHub 上的位置（同 LabCard 的「在 GitHub 查看」）。
const HIP_PY = githubUrl('notebooks/common/src/hello_gpu/hip.py')
const LAB_PY = githubUrl('notebooks/common/src/hello_gpu/lab.py')

const pOutput = [
  { label: '报错：多出来的线程访问越界', why: '多写的 24 个位置紧挨着输出，还在已经分配的显存里。显存读写不知道数组有多长，GPU 不报错。' },
  { label: '最后 24 个结果对不上', why: '输出里的 1000 个位置，都由下标 0 到 999 的线程写对了。多出来的 24 个写在输出后面，不在比的范围里。' },
  { label: '1000 个结果全对', correct: true, why: '越界写落在输出外面，输出本身一个没错。只比输出查不出这种错，所以校验要在输出外面放护栏。' },
  { label: '我不确定', why: '不确定也没关系，探索三把这 24 个位置画出来。' },
]

const checkpoint = [
  {
    q: '同事的逐元素 kernel 每组 128 个线程，没写边界检查。他用长度 4096 和 8192 校验，只比输出，全过了。要查出问题，至少要改什么？',
    options: [
      { label: '换成 4100 这样不能整除的长度，再比输出', why: '比输出还是全对：多出来的线程写在输出外面，输出本身没被写错。要配上护栏才看得见。' },
      { label: '换上不能整除的长度，并在输出外面留护栏', correct: true, why: '不能整除时，最后一组才有多出来的线程；护栏把它们写到外面的位置变成看得见的改动。' },
      { label: '把每组线程数改成 256 再测', why: '4096、8192 也是 256 的整数倍，照样一个线程都不多。问题在长度，不在组大小。' },
    ],
  },
  {
    q: 'Triton 版 BLOCK = 1024，num_warps 用默认的 4，跑在一张 wave 64 的 CDNA 卡上。一个 program 有几个线程，每个线程分几个元素？',
    options: [
      { label: '1024 个线程，每个 1 个元素', why: 'BLOCK 是一块的元素数，不是线程数。线程数是 num_warps × wave 大小。' },
      { label: '128 个线程，每个 8 个元素', why: '这是 wave 32 的卡：4 × 32 = 128。换成 wave 64 的卡，线程数跟着翻倍。' },
      { label: '256 个线程，每个 4 个元素', correct: true, why: '4 个 wave × 64 = 256 个线程，1024 ÷ 256 = 4。块的大小没变，每个线程分到的少了一半。' },
    ],
  },
  {
    q: '逐元素算 out = a * b + c，三个输入、一个输出都是 FP32，n = 2²⁴，耗时 1 ms。有效带宽是多少？',
    options: [
      { label: '约 201 GB/s', why: '这是按一个元素 12 字节算的，少算了一个输入：读 a、b、c 共 12 字节，写 out 4 字节，一共 16 字节。' },
      { label: '约 268 GB/s', correct: true, why: '一个元素 16 字节：16 × 2²⁴ ≈ 2.68 × 10⁸ 字节，除以 1 ms，约 268 GB/s。' },
      { label: '约 67 GB/s', why: '这只算了写 out 的 4 字节。读进来的字节也是搬运，要算上。' },
    ],
  },
]
</script>

# 2-2 第一个真 kernel

<div class="rk-hello">
  <Mascot class="rk-hello__art" :size="64" />
  <p class="rk-hello__line">模拟器里跑过的 vector add，这回编成真卡的机器码。</p>
</div>

新手村的 vector add 在模拟器里跑过。这一关把它搬上真卡，走完副标题的三步：编译、运行、校验。

两条路线写的 kernel 不一样：HIP 写一个线程做什么，Triton 写一块数据做什么。校验方法和带宽算法两条路线共用；实现部分按你选的路线显示，随时可以切换。

做这一关要一块 AMD GPU，环境在 {{ YOUR_GPU.code }} 关准备好了。没有 GPU 也能读完；挑战另有观摩模式。

<Mission :stage="S" :goal="GOAL" :stars="STARS">

三颗星都在实验室 Notebook 里拿：★1 看 7 个长度是不是都算对、也没写到输出外面；★2、★3 拿你的有效带宽和同一张卡上的 torch 比。

</Mission>

## 热身：输出全对，就没问题了吗？

第一版 kernel 照 {{ GROUPS.code }} 关的写法，一个线程算一个元素，但先不写拦住多出来的线程的那一行。HIP 每组 256 个线程，Triton 每块 1024 个元素：长度 1000 时，两边都派出 1024 个位置，多出 24 个。

<Predict :stage="S" id="rk-p-output" question="长度 1000 跑一次，再把输出和 torch.add 的结果逐个比。会看到什么？" :options="pOutput">

探索三用护栏把这 24 个位置找出来。

</Predict>

## 探索一：编译

kernel 写的是一份活的样子：HIP 写一个线程做什么，Triton 写一个 [program](/handbook/#program) 做什么。编译器把它编成这张卡的 [gfx 代号](/handbook/#gfx-target)对应的机器码。

<RouteBlock route="hip">

**第一版 kernel**：一个线程算一个元素，下标是 {{ GROUPS.code }} 关的[全局下标](/handbook/#global-index)。

```cpp
__global__ void vector_add(const float* a, const float* b, float* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;  // 全局下标
    out[i] = a[i] + b[i];                           // 先不写 if (i < n)
}
```

**什么时候编译**：运行 `%%hip` 单元的时候。hello_gpu 借 PyTorch 的扩展构建工具调用 ROCm 的 `hipcc`，按这张卡的 gfx 代号编译。编好的结果按源码缓存：源码不变，再运行就直接复用，输出里写「缓存已复用」。

</RouteBlock>
<RouteBlock route="triton">

**第一版 kernel**：一个 program 算一块 [tile](/handbook/#tile)，`tl.arange` 一次给出这一块的 BLOCK 个下标。

```python
@triton.jit
def add_kernel(a_ptr, b_ptr, out_ptr, n, BLOCK: tl.constexpr):
    pid = tl.program_id(0)                       # 第几块，相当于 HIP 的 blockIdx.x
    offsets = pid * BLOCK + tl.arange(0, BLOCK)  # 这一块的 BLOCK 个下标
    x = tl.load(a_ptr + offsets)                 # 先不写 mask
    y = tl.load(b_ptr + offsets)
    tl.store(out_ptr + offsets, x + y)
```

**什么时候编译**：第一次启动的时候。`@triton.jit` 只登记这个函数；第一次用 `add_kernel[grid](...)` 启动时，Triton 才按这张卡的 gfx 代号编译，编好的缓存起来。BLOCK 是 `tl.constexpr`，换一个值就另编一份。

</RouteBlock>

块里的元素由谁来算？两条路线的差别就在这里。换一换下面的块大小，看两边各派几个线程。

<ThreadTile />

HIP 的组大小就是线程数，一组最多 {{ HIP_MAX_THREADS }} 个；Triton 的 BLOCK 是元素数，线程数由 `num_warps` 定，块越大，每个线程分到的越多。Notebook「动手」的「编译」一段，先拿 4096 个 1 加 4096 个 1 跑一次小的。

## 探索二：运行

主机端（CPU）走五步：申请显存、拷进去、启动、等 GPU 算完、拷回来。只有第三步在 GPU 上算，而且它一交出去就返回。

<HostSteps />

③ 只是把 kernel 排进 GPU 的队列。CPU 要用结果，得等 GPU 算完：④ 明着等，或者让 ⑤ 的拷贝替你等。

<RouteBlock route="hip">

**主机端五步**：Notebook 用 PyTorch 的张量走这五步，每一步的注释写着对应的 HIP 运行时函数。

```python
n = 1 << 20
h_a, h_b = torch.randn(n), torch.randn(n)  # 主机内存里的两个输入
d_a = torch.empty(n, device="cuda")        # ① 申请显存，相当于 hipMalloc
d_b = torch.empty(n, device="cuda")
d_out = torch.empty(n, device="cuda")
d_a.copy_(h_a)                             # ② 拷进显存，相当于 hipMemcpy（主机 → 设备）
d_b.copy_(h_b)
vector_add(d_a, d_b, out=d_out)            # ③ 启动，相当于 vector_add<<<n / 256, 256>>>，马上返回
torch.cuda.synchronize()                   # ④ 等 GPU 算完，相当于 hipDeviceSynchronize
h_out = d_out.cpu()                        # ⑤ 拷回主机，相当于 hipMemcpy（设备 → 主机）
```

**启动这一行**：`vector_add` 按每组 256 个线程、组数向上取整，用 `hipLaunchKernelGGL` 把 kernel 排进 PyTorch 当前的队列（stream），再用 `hipGetLastError` 查启动有没有出错。`torch.empty` 走 PyTorch 的缓存分配器：要新显存时才调用 `hipMalloc`，用完的留着下次复用。

</RouteBlock>
<RouteBlock route="triton">

**主机端五步**：Notebook 用 PyTorch 的张量走这五步，③ 写出了启动网格。

```python
n = 1 << 20
h_a, h_b = torch.randn(n), torch.randn(n)  # 主机内存里的两个输入
d_a = torch.empty(n, device="cuda")        # ① 申请显存
d_b = torch.empty(n, device="cuda")
d_out = torch.empty(n, device="cuda")
d_a.copy_(h_a)                             # ② 拷进显存
d_b.copy_(h_b)
grid = (triton.cdiv(n, 1024),)             # 启动网格：每块 1024 个元素，一共几块
add_kernel[grid](d_a, d_b, d_out, n, BLOCK=1024)  # ③ 启动，马上返回
torch.cuda.synchronize()                   # ④ 等 GPU 算完
h_out = d_out.cpu()                        # ⑤ 拷回主机
```

**启动这一行**：启动网格是这次派出几个 program，相当于 HIP 的[网格](/handbook/#grid)。`triton.cdiv(n, 1024)` 是向上取整的除法，n = 2²⁰ 时正好 1024 块。

</RouteBlock>

## 探索三：校验

只试一个长度不够：要有不能整除组大小的长度，还要在输出外面放护栏，越界写才看得见。

「运行」只试了 2²⁰ 这一个长度，它正好是两条路线组大小的整数倍。Notebook「校验」一段换 7 个长度，`hg.check(..., guard=True)` 在输出前后各留 {{ GUARD_ELEMENTS }} 个元素的护栏，事先填满；kernel 跑完，护栏变了，就是写到了输出外面。

<GuardCheck />

没写边界检查时，只有组大小整数倍的长度能过；越界写的个数，正好是最后一组多出来的那几个。{{ GROUPS.code }} 关的模拟器会当场数出越界写，真卡不替你数，要靠护栏。

## 原理：从源码到结果

源码到结果要过三关，每一关出错的样子不一样：

- 编译：kernel 编成这张卡 gfx 代号的机器码。写错变量名这类错误在这一关报出来：HIP 报在 kernel 单元，Triton 报在第一次启动时。
- 运行：主机端申请显存、拷贝、启动、等待。参数不合法在这一关报错，例如组大小超过这张卡的上限。
- 校验：跑完没报错，不等于算对了。越界写不报错，只能靠护栏查。

Triton 路线把「一个线程」换成了「一块」，多了两个词：

<ConceptCard term="program" code="tl.program_id(0)">

启动网格有几块，就启动几个 program；`tl.program_id(0)` 是这一个的编号，地位相当于 HIP 的 `blockIdx.x`。一个 program 由几个线程一起执行，kernel 里不写：Triton 3.8.0 在 AMD 卡上默认 `num_warps={{ TRITON_NUM_WARPS }}`，wave 32 的卡上就是 128 个线程。

</ConceptCard>

<ConceptCard term="tile" code="tl.arange(0, BLOCK)">

vector add 的 tile 是 BLOCK 个相邻的元素：`offsets` 是它们的下标，`x + y` 一次算完整块。BLOCK 决定一块有几个元素，不决定有几个线程；它是 `tl.constexpr`，要是 2 的幂。

</ConceptCard>

HIP 路线没有新词：线程块、网格、全局下标都是 {{ GROUPS.code }} 关学过的。

<DeepDive title="出处：编译、启动和等待">

- HIP 版的 `%%hip`：hello_gpu 把单元里的源码交给 PyTorch 的 `torch.utils.cpp_extension.load`，用 ROCm 的 `hipcc` 编译，目标架构取 PyTorch 报的 `gcnArchName`；启动用 `hipLaunchKernelGGL`，组数是长度除以组大小、向上取整（<a :href="HIP_PY">hello_gpu 的 hip.py</a> 和同目录的 `templates/binary_f32.hip`）。
- HIP 文档：kernel 用 `hipLaunchKernelGGL` 或三尖括号启动，都是异步的，CPU 接着往下走；`hipMemcpy` 等拷完才返回；同一个队列（stream）里的活按排队的顺序做（[Asynchronous concurrent execution](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_runtime_api/asynchronous.html)）。主机端的典型流程是：选 GPU，申请显存并拷进，配置并启动 kernel，同步，拷回结果，释放（[HIP 编程模型：Host programming](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#host-programming)）。一组的线程数「通常最多 1024」（同一篇的 [Hierarchical thread model](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#hierarchical-thread-model)）。
- PyTorch 文档：GPU 上的操作默认是异步的；每个设备按排队的顺序执行，CPU 和 GPU 之间拷数据时 PyTorch 自动同步（[Asynchronous execution](https://docs.pytorch.org/docs/2.13/notes/cuda.html#asynchronous-execution)）。ROCm 版沿用 `torch.cuda` 这套接口，显存由缓存分配器管理（[HIP semantics](https://docs.pytorch.org/docs/2.13/notes/hip.html#memory-management)）。
- Triton：`@triton.jit` 是即时编译，`tl.constexpr` 参数的值不同就各编一份（[triton.jit](https://triton-lang.org/main/python-api/generated/triton.jit.html)）；启动网格是同时运行的 kernel 实例个数，没调用 `torch.cuda.synchronize()` 时，kernel 还在异步地跑（[向量加法教程](https://triton-lang.org/main/getting-started/tutorials/01-vector-add.html)）；`tl.arange` 的区间端点要是 2 的幂（[tl.arange](https://triton-lang.org/main/python-api/generated/triton.language.arange.html)）。AMD 后端默认 `num_warps=4`，gfx10 及以后按 wave 32 编译，更早的按 64（[Triton 3.8.0 的 compiler.py](https://github.com/triton-lang/triton/blob/v3.8.0/third_party/amd/backend/compiler.py#L77-L115)）。

</DeepDive>

<DeepDive title="出处：真卡上的越界写为什么不报错">

- 显存读写只在几种情况下报错：地址落在所有地址窗口之外、往只读的页上写、没按要求对齐。它不查数组有多长（[RDNA4 指令集手册](https://gpuopen.com/download/rdna4-instruction-set-architecture.pdf) 11.3 节）。越界越远，越可能碰到没分配的地址，这时才报错：HIP 文档把越界访问列为 `hipErrorIllegalAddress` 的常见原因之一（[HIP 错误码](https://rocm.docs.amd.com/projects/HIP/en/latest/reference/error_codes.html#term-hipErrorIllegalAddress)）。
- PyTorch 的缓存分配器按 512 字节的整数倍分配显存（[AllocatorConfig.h](https://github.com/pytorch/pytorch/blob/v2.13.0/c10/core/AllocatorConfig.h#L18) 的 `kMinBlockSize`，[CUDACachingAllocator.cpp](https://github.com/pytorch/pytorch/blob/v2.13.0/c10/cuda/CUDACachingAllocator.cpp#L3062-L3071) 的 `round_size`）。1000 个 FP32 是 4000 字节，实际拿到 4096 字节，多写的 24 个元素（96 字节）正好落在这段零头里。别的长度多写得多，可能写进挨着的另一块数据。
- Triton 3.8.0 的 AMD 后端默认尽量把读写编成 buffer 指令（`AMDGCN_USE_BUFFER_OPS` 默认打开，[knobs.py](https://github.com/triton-lang/triton/blob/v3.8.0/python/triton/knobs.py#L517)）。buffer 指令越过范围的写会被丢掉（指令集手册 9.4.1 节），但 Triton 把范围设成从起点算起约 2 GiB（[BufferOpsEmitter.cpp](https://github.com/triton-lang/triton/blob/v3.8.0/third_party/amd/lib/TritonAMDGPUToLLVM/BufferOpsEmitter.cpp#L104)）：多写的这几个元素还在范围里，照样写出去。实验档案馆的参考记录（{{ REF.name }}）里正是这样：Triton 版第一版在长度 1 时多写 1023 个位置、长度 1000 时多写 24 个，没有报错。
- `hg.check` 的护栏每边 {{ GUARD_ELEMENTS }} 个元素，比 HIP 一组的线程数、Triton 一块的元素数都大，这一关的越界写全落在护栏里（<a :href="LAB_PY">hello_gpu 的 lab.py</a> 的 `GUARD_ELEMENTS`）。

</DeepDive>

## 挑战：在你的卡上交成绩

挑战在实验室 Notebook 里做，两件事，三颗星和任务卡上写的一样：

- ★1：补上边界检查，`hg.check` 带着护栏校验 7 个长度，全部 ✓。
- ★2、★3：`hg.compare` 让你的 vector add 和 `torch.add` 在同一张卡上各测一遍，比有效带宽。「相对 torch」不小于 0.8 拿 ★2，不小于 0.95 拿 ★3。

[有效带宽](/handbook/#bandwidth)是一次调用搬的字节数除以耗时。vector add 每个元素读 a、b 各 4 字节、写 out 4 字节，一共 12 字节；挑战取 n = 2²⁶，一次搬 12 × 2²⁶ 字节，约 805 MB。torch 的加法搬的一样多，所以带宽之比就是耗时之比倒过来：相对 torch = torch 的耗时 ÷ 你的耗时。

<RouteBlock route="hip">

**补上边界检查**：改 kernel 单元里标了 TODO 的那一行，让 `i >= n` 的线程什么也不做，就是 {{ GROUPS.code }} 关的 `if (i < n)`。改好重新运行 kernel 单元，再运行校验。

**换组大小**：带宽不够，就把挑战里的 `vector_add(x, y, out=out)` 改成 `vector_add(x, y, out=out, block=…)`。block 是每组的线程数，取 2 的幂，不超过 {{ HIP_MAX_THREADS }}。

</RouteBlock>
<RouteBlock route="triton">

**补上边界检查**：改 kernel 单元里标了 TODO 的三行，给 `tl.load` 和 `tl.store` 都传 `mask=offsets < n`：mask 为假的位置不读也不写。改好重新运行 kernel 单元，再运行校验。

**换组大小**：带宽不够，就把挑战里的 `vector_add(x, y, out=out)` 改成 `vector_add(x, y, out=out, block=…)`。block 是每块的元素数，取 2 的幂（`tl.arange` 的要求）。

</RouteBlock>

计时由 `hg.compare` 负责，GPU 计时的门道在 {{ NEXT.code }} 关；组大小怎么选，{{ ROUTE_ADV.code }} 关再讲。参考记录里（{{ REF.name }}，n = 2²⁶），补上边界检查以后 HIP 版的「相对 torch」是 1.01，Triton 版 0.99，三颗星都拿得到；Triton 版的块大小换成 4096，还有 0.96。

<LabCard />

## 你现在能……

- 用 HIP 或 Triton 写出 vector add，说清 kernel 里写的是一个线程的活，还是一个 program 一块 tile 的活
- 在主机端走完申请显存、拷进、启动、同步、拷回，说出启动之后为什么要等
- 用多种长度加护栏校验 kernel，按搬运的字节数算出有效带宽，再和 torch 比

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：kernel 算对了，下一关把它测准。

- 回到基础：[{{ GROUPS.code }}「{{ GROUPS.title }}」](/novice/thread-groups/)：组数向上取整、多出来的线程和 `if (i < n)`，就是这一关校验要查的事。
- 深入一层：[旧版第 8 章 8.4 实现向量加法](/part2-kernels/chapter8/#_8-4-实现向量加法)：同一个 vector add 的 HIP、Triton 基线，再一轮轮试 grid-stride、`float4` 和不同的 tile 大小。

<EvidenceCard kind="mixed" hardware="AMD Radeon AI PRO R9700" software="ROCm 10.0.0 · PyTorch 2.13.0+rocm10.0.0 · Triton 3.8.0+git4cff872c.rocm10.0.0" date="2026-11-11" entry="forge-first-real-kernel/hip-ai-pro-r9700-2026-11-11">探索一的线程数按 Triton 3.8.0 AMD 后端默认的 num_warps（4）和 wave 大小算出来；探索二的时间线只看先后，长短是示意；探索三越界写的个数按代码算，等于派出去的位置减去长度。正文里的「相对 torch」和真卡上越界写的样子，来自实验档案馆的参考记录：在 {{ REF.name }} 上照 Notebook 从头跑了一遍，挑战填的是参考解。两条路线 hg.check 报的越界个数和探索三算的一样。这张卡记的是 HIP 路线，下一张是 Triton 路线。</EvidenceCard>

<EvidenceCard kind="measured" hardware="AMD Radeon AI PRO R9700" software="ROCm 10.0.0 · PyTorch 2.13.0+rocm10.0.0 · Triton 3.8.0+git4cff872c.rocm10.0.0" date="2026-11-11" entry="forge-first-real-kernel/triton-ai-pro-r9700-2026-11-11">Triton 路线的参考记录：同一台机器、同一天，照 Triton 版 Notebook 从头跑了一遍。</EvidenceCard>

<style scoped>
/* 小核开场：同新手村各关和 2-1 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.rk-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.rk-hello__art {
  flex: none;
}

.rk-hello__line {
  flex: 1 1 auto;
  max-width: 34em;
  margin: 10px 0 0;
  padding: 12px 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  border-top-left-radius: 4px;
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  font-size: 17px;
}

/* 简洁模式收起插画（01 第 4 节），台词照样留着。 */
.hg-shell.is-plain .rk-hello__art {
  display: none;
}

.hg-shell.is-plain .rk-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
