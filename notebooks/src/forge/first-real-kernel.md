# 2-2 第一个真 kernel：编译、运行、校验（实验室）

<!-- lab:header -->

## 准备

先跑一键检查。这一关第一次在真卡上编译 kernel，要用到你这条路线的工具：HIP 版看「ROCm 和 PyTorch 版本一致」和「HIP 编译工具」两行，Triton 版看「Triton」那一行。

```python
import torch
import hello_gpu as hg

torch.manual_seed(0)
env = hg.check_env()
```

```python route=triton
import triton
import triton.language as tl
```

看输出里你这条路线的那几行。有 ⚠ 的话，下面的 kernel 可能编不出来：先按提示改好，再重启内核从头运行。「看得到 GPU」那一行括号里是 gfx 代号，kernel 就编译成这个架构的机器码。

## 动手

三段对应这一关的副标题：编译、运行、校验。每一步在硬件上发生了什么，看[关卡页](https://datawhalechina.github.io/hello-gpu/forge/first-real-kernel/)。

### 编译

第一版 kernel 照新手村的写法，一个线程算一个元素。边界检查故意先不写（[线程分组](https://datawhalechina.github.io/hello-gpu/novice/thread-groups/)里拦住多出来的线程的那一行），看看真卡上会怎样。HIP 版写一个线程做什么；Triton 版写一块（tile）做什么，块里的元素怎么分给线程，由编译器安排。

```hip route=hip
__global__ void vector_add(const float* a, const float* b, float* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;  // 全局下标：第几组 × 每组几个 + 组里第几个
    out[i] = a[i] + b[i];                           // 先不写 if (i < n)
}
```

```python route=triton
@triton.jit
def add_kernel(a_ptr, b_ptr, out_ptr, n, BLOCK: tl.constexpr):
    pid = tl.program_id(0)                       # 第几块，相当于 HIP 的 blockIdx.x
    offsets = pid * BLOCK + tl.arange(0, BLOCK)  # 这一块的 BLOCK 个全局下标，一次算完
    x = tl.load(a_ptr + offsets)                 # 先不写 mask
    y = tl.load(b_ptr + offsets)
    tl.store(out_ptr + offsets, x + y)

def vector_add(a, b, out, block=1024):
    grid = (triton.cdiv(a.numel(), block),)      # 启动网格：每块 block 个元素，块数向上取整
    add_kernel[grid](a, b, out, a.numel(), BLOCK=block)
    return out
```

编好先跑一次小的：4096 个 1 加 4096 个 1。

```python
x = torch.ones(4096, device="cuda")
vector_add(x, x, out=torch.empty_like(x))
```

看输出里的数：都是 2，算对了。HIP 版在上一个单元里编译，输出写着用了几秒，再运行那个单元会显示「缓存已复用」；Triton 版在这次启动时才编译，所以这个单元慢一些。

4096 是两版组大小（HIP 每组 256 个线程，Triton 每块 1024 个元素）的整数倍，第一版在这个长度上不越界。原因在「校验」那一段。

### 运行

主机端（CPU）这边要走五步：申请显存、拷进去、启动 kernel、等它算完、拷回来。下面每一步都有注释，HIP 版注明了对应的 HIP 运行时函数。

```python route=hip
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
torch.equal(h_out, h_a + h_b)
```

```python route=triton
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
grid, torch.equal(h_out, h_a + h_b)
```

看输出里的 True：GPU 算出的结果和 CPU 上的 `h_a + h_b` 一模一样（Triton 版前面还有块数）。

③ 只是把 kernel 排进 GPU 的队列，调用马上返回，这时 GPU 可能还没算完。要用结果，先做 ④；⑤ 拷回本身也会等。启动到底多快返回、怎么证明，留给[测得准](https://datawhalechina.github.io/hello-gpu/forge/trusted-timing/)那一关。

### 校验

「运行」只试了一个长度，它正好是组大小的整数倍。下面换 7 个长度，有的是组大小的整数倍，有的多一点或少一点。`guard=True` 让 `hg.check` 在输出前后各留一段护栏，kernel 写到输出外面，护栏就变了。

```python
lengths = [1, 255, 256, 1000, 1024, 1 << 20, (1 << 20) + 1]
first = hg.check(vector_add, torch.add, lengths, inputs=2, guard=True)
```

看输出里哪些长度打了 ✗：只有组大小整数倍的长度能过。✗ 后面写着越界写了几个位置，正好是最后一组里多出来的那几个。长度 1000 时，HIP 版派了 4 组共 1024 个线程，Triton 版派了 1 块 1024 个位置，都多出 24 个。

新手村的模拟器会当场数出越界写。真卡不一定报错，越界写可能悄悄改掉输出后面的数据，所以要靠护栏查。

## 挑战

两件事：先把第一版改对，再和 torch 比有效带宽。三颗星的标准在[关卡页](https://datawhalechina.github.io/hello-gpu/forge/first-real-kernel/)的任务卡上。

### 补上边界检查

改标了 TODO 的地方：HIP 版让 `i >= n` 的线程什么也不做，Triton 版给读和写都加上 mask。改好以后运行它，再运行下面的校验。

```hip route=hip
__global__ void vector_add(const float* a, const float* b, float* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    out[i] = a[i] + b[i];  // TODO：只让 i < n 的线程读写
}
```

```python route=triton
@triton.jit
def add_kernel(a_ptr, b_ptr, out_ptr, n, BLOCK: tl.constexpr):  # 上面的 vector_add 会调用这个新版本
    offsets = tl.program_id(0) * BLOCK + tl.arange(0, BLOCK)
    x = tl.load(a_ptr + offsets)        # TODO：加上 mask，只读 offsets < n 的位置
    y = tl.load(b_ptr + offsets)        # TODO：同上
    tl.store(out_ptr + offsets, x + y)  # TODO：只写 offsets < n 的位置
```

```python
checks = hg.check(vector_add, torch.add, lengths, inputs=2, guard=True)
```

看输出里的 ✓ 和 ✗：7 个长度全部 ✓，才拿得到 ★1。还有 ✗ 就按后面写的原因改，改完重新运行 kernel 那个单元和这个单元。

### 和 torch 比带宽

有效带宽是一次调用搬的字节数除以耗时。vector add 每个元素读 a、b 各 4 字节，写 out 4 字节，一共 12 字节。torch 的加法搬的一样多，所以两边的带宽之比，就是耗时之比倒过来。

```python
n = 1 << 26
x = torch.randn(n, device="cuda")
y = torch.randn_like(x)
out = torch.empty_like(x)
result = hg.compare(
    {"torch": lambda: torch.add(x, y, out=out), "mine": lambda: vector_add(x, y, out=out)},
    bytes_moved=12 * n,  # 每个元素读 4 + 4 字节，写 4 字节
)
metrics = result.metrics("mine")
```

看输出里 mine 那一行：「带宽 GB/s」是你的有效带宽，「相对 torch」是 torch 的耗时除以你的耗时。★2 要它不小于 0.8，★3 要不小于 0.95。

不够就换个组大小再试：把 `vector_add(x, y, out=out)` 改成 `vector_add(x, y, out=out, block=…)`，block 取 2 的幂，HIP 版不超过 1024。n 取 2²⁶，三个数组各 256 MiB，启动的那点开销摊得很薄。计时由 `hg.compare` 负责，GPU 计时的门道留给「测得准」那一关。

## 交成绩

<!-- lab:submit -->

## 练习

1. 把 kernel 里的 `out` 故意写成 `outt`，运行「编译」那一段，看报错指到哪一行：HIP 版报在 kernel 单元，Triton 版报在第一次启动时。改回来再运行。
2. 把挑战里的 `block` 依次换成 64、256、1024（Triton 版换成 256、1024、4096），有效带宽怎么变？组大小怎么选，[路线进阶](https://datawhalechina.github.io/hello-gpu/forge/route-advanced/)那一关再讲。
3. 用 `hg.bench` 分别测「运行」里的 ② 和 ③：`hg.bench(lambda: d_a.copy_(h_a))` 和 `hg.bench(lambda: vector_add(d_a, d_b, out=d_out))`。拷进一个数组比整个 kernel 慢几倍？数据为什么要尽量留在显存里？
