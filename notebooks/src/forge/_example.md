# 示例：向量加法实验室

<!--
这是实验室 Notebook 源文件的格式示例，不对应任何关卡：
npm run nb:build 不生成它，npm run nb:check 只检查它的格式。新写一关时照着这里的结构写：
- 标题下面写 lab:header 标记，生成标题、配套网页链接和加载 hello_gpu 的单元；
- 小节依次是准备、动手、挑战、交成绩、练习；每个代码单元不超过 15 行；
- 「挑战」要给出 checks（hg.check 的结果）和 metrics（测量数据），「交成绩」里的 lab:submit 标记把它们交上去；
- 只进一条路线的单元在围栏上写 route=hip 或 route=triton，HIP kernel 用 hip 围栏。
这里的代码没有在真卡上运行过，只用来演示写法。
-->

<!-- lab:header -->

## 准备

```python
import torch
import hello_gpu as hg

torch.manual_seed(0)
card = hg.device_card()
```

看输出里的 CU 数和 wave 大小，后面估算并行度时要用。

## 动手

向量加法：每个输出元素只读两个数、写一个数。先用 PyTorch 算出参考答案。

```python
n = 1 << 20
a = torch.randn(n, device="cuda")
b = torch.randn_like(a)
expected = a + b
```

再写自己的 kernel：一个线程算一个元素，下标超出 n 的线程什么也不做。

```hip route=hip
__global__ void vector_add(const float* a, const float* b, float* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = a[i] + b[i];
}
```

```python route=triton
import triton
import triton.language as tl

@triton.jit
def add_kernel(a_ptr, b_ptr, out_ptr, n, BLOCK: tl.constexpr):
    offsets = tl.program_id(0) * BLOCK + tl.arange(0, BLOCK)
    mask = offsets < n
    x = tl.load(a_ptr + offsets, mask=mask)
    y = tl.load(b_ptr + offsets, mask=mask)
    tl.store(out_ptr + offsets, x + y, mask=mask)

def vector_add(a, b, block=1024):
    out = torch.empty_like(a)
    add_kernel[(triton.cdiv(a.numel(), block),)](a, b, out, a.numel(), BLOCK=block)
    return out
```

```python
torch.testing.assert_close(vector_add(a, b), expected)
```

没有报错，说明每个元素都和 PyTorch 的结果一致。

## 挑战

把加法改成 `out = 2 * a + b`：补全标了 TODO 的地方，再做多形状校验，最后和 torch 比速度。

```hip route=hip
__global__ void axpy(const float* a, const float* b, float* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    // TODO：写出 out[i] = 2 * a[i] + b[i]，别忘了检查 i < n
}
```

```python route=triton
@triton.jit
def axpy_kernel(a_ptr, b_ptr, out_ptr, n, BLOCK: tl.constexpr):
    offsets = tl.program_id(0) * BLOCK + tl.arange(0, BLOCK)
    mask = offsets < n
    # TODO：读出 a、b，写回 2 * a + b，别忘了 mask

def axpy(a, b, block=1024):
    out = torch.empty_like(a)
    axpy_kernel[(triton.cdiv(a.numel(), block),)](a, b, out, a.numel(), BLOCK=block)
    return out
```

```python
checks = hg.check(axpy, lambda a, b: 2 * a + b, [1, 1000, 1 << 20], inputs=2)
```

看输出里每个形状的 ✓ 和 ✗：长度 1 和 1000 不是 block 的整数倍，专门用来查边界。

```python
x = torch.randn(1 << 24, device="cuda")
y = torch.randn_like(x)
result = hg.compare(
    {"torch": lambda: torch.add(y, x, alpha=2), "mine": lambda: axpy(x, y)},
    bytes_moved=3 * x.numel() * x.element_size(),
)
metrics = result.metrics("mine")
```

看输出里「带宽 GB/s」和「相对 torch」两列：前者是有效带宽，后者大于 1 说明比 torch 快。

## 交成绩

<!-- lab:submit -->

## 练习

1. 把 `block` 换成 64、256、1024，带宽怎么变？
2. 去掉边界检查（HIP 的 `i < n`、Triton 的 `mask`），再运行 `hg.check`，哪些形状会出错？
