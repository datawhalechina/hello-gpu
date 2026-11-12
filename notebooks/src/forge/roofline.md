# 2-4 性能的天花板：峰值与 Roofline（实验室）

<!-- lab:header -->

## 准备

这一关只用 PyTorch 自带的拷贝、加法和矩阵乘，两条路线做的一样。测峰值算力的 FMA 测试要编译一个小 HIP kernel，所以先跑一键检查。

```python
import torch
import hello_gpu as hg

torch.manual_seed(0)
env = hg.check_env()
```

看输出里的前三项和「HIP 编译工具」那一项。前三项都是 ✓ 才能做实验；FMA 测试靠 HIP 编译工具编译，这一关两条路线都要它是 ✓。Triton 那一项有 ⚠，不影响这一关。

## 动手

三段：先量这张卡搬数据最快多快、算数最快多快，再把两个数画成屋顶线，把算子放上去。屋顶线为什么长这样，看[关卡页](https://datawhalechina.github.io/hello-gpu/forge/roofline/)。

### 峰值带宽：拷贝测试

拷贝测试只做一件事：把一块缓冲区原样拷到另一块。没有计算，每个字节读一次、写一次，量到的就是显存搬数据的速度。先拷 512 MiB：

```python
src = torch.randn(1 << 27, device="cuda")  # 2²⁷ 个 FP32 数，512 MiB
dst = torch.empty_like(src)
copy = hg.bench(lambda: dst.copy_(src), label="拷贝 512 MiB")
moved = 2 * src.numel() * 4  # 读一遍 src、写一遍 dst，每个数 4 字节
print(f"有效带宽：{moved / copy.median_ms / 1e6:.1f} GB/s")
```

看输出里的有效带宽：搬的字节数除以时间，单位是十进制的 GB/s，每秒 10⁹ 字节。

缓冲区要够大，量到的才是显存的速度。换成 64 KiB 再拷一次：

```python
small = torch.randn(1 << 14, device="cuda")  # 64 KiB
small_dst = torch.empty_like(small)
tiny = hg.bench(lambda: small_dst.copy_(small), label="拷贝 64 KiB")
print(f"有效带宽：{2 * small.numel() * 4 / tiny.median_ms / 1e6:.1f} GB/s")
```

看输出：有效带宽低得多。一次只搬 128 KiB，搬数据本身花不了多少时间，量到的大多是启动的开销。

### 峰值算力：FMA 测试

FMA（fused multiply-add）一条指令算 a × b + c，记 2 次浮点运算。FMA 测试的 kernel 让每个线程做 16 条互不相干的链，每条把 a × b 往自己的 c 上加 256 次。一条链的下一次要等上一次的结果，16 条链轮流算，计算单元才不会空等。

每个线程只读两个数、写一个数，几乎全是计算。`hg.peak()` 把拷贝测试和 FMA 测试各做一遍，结果按卡存下来，后面的关卡直接读。第一次运行要编译 FMA 测试的 kernel，要等一会儿。

```python
peak = hg.peak()
```

看输出里两个测试各搬了多少字节、算了多少次：拷贝测试的峰值带宽和你上面量的差不多；FMA 测试每读写 1 字节要算几百次浮点运算，量到的是峰值算力。两个数都是这张卡在当前软件上实测的，不是厂商标称的理论峰值。

### 屋顶线

一个算子每搬 1 字节做几次浮点运算，叫算术强度。算术强度低的算子，最快是「峰值带宽 × 算术强度」；高的最快是峰值算力。两条线拼成屋顶，交点叫拐点。

`hg.roofline` 用 `hg.peak()` 存下的两个峰值画屋顶线，再把算子按实测耗时放上去。每个算子写成（调用, 浮点运算次数, 字节数）：n 个数的加法做 n 次加法，读两个数组、写一个，共 12n 字节；4096×4096 的矩阵乘做 4096³ 次乘加，三个矩阵各读或写一遍。

```python
n = 1 << 26
x = torch.randn(n, device="cuda")
y = torch.randn_like(x)
z = torch.empty_like(x)
a = torch.randn(4096, 4096, device="cuda")
b = torch.randn_like(a)
c = torch.empty_like(a)
roof = hg.roofline({
    "add": (lambda: torch.add(x, y, out=z), n, 12 * n),
    "mm": (lambda: torch.mm(a, b, out=c), 2 * 4096**3, 3 * 4 * 4096**2),
})
```

看表里「归谁管」和「占屋顶」两列，再看图上两个点离屋顶多远：add 在拐点左边，归带宽管；mm 在右边，归算力管。哪个离自己的屋顶更近？

关卡页上也有一张屋顶线，可以拖动算子点。想换成你这张卡的，再打一次 GPU 卡片：它带上了刚测的峰值。

```python
card = hg.device_card()
```

看输出里「实测峰值」那一行。把最后一行的导入码贴到关卡页的「我的 GPU 卡片」里，关卡页上的屋顶线就换成你这张卡的。

## 挑战

两件事：先把矩阵乘的工作量数对，再在拐点两边各放一个点。三颗星的标准在[关卡页](https://datawhalechina.github.io/hello-gpu/forge/roofline/)的任务卡上。

### 数工作量

`mm_cost(m, k, n)` 返回 (m×k) 乘 (k×n) 这个 FP32 矩阵乘的浮点运算次数和字节数。字节数按算法算：A、B 各读一遍，C 写一遍。动手里 4096 的方阵写的是 `2 * 4096**3` 和 `3 * 4 * 4096**2`，换成 m、k、n，补上两个 TODO。

```python
def mm_cost(m, k, n):
    flops = ...  # TODO：C 的每个数要做几次乘加？一次乘加算 2 次浮点运算
    bytes_moved = ...  # TODO：A、B、C 一共多少个数？每个 FP32 数 4 字节
    return flops, bytes_moved

checks = hg.check_mm_cost(mm_cost)
```

`hg.check_mm_cost` 拿五种形状核对：方阵、很扁的、矩阵乘向量……两个数都对，这种形状才算通过。看输出里的 ✓ 和 ✗：都 ✓ 才拿得到 ★1；✗ 后面写着差在哪。

### 拐点两边各放一个点

★2 要拐点左边的加法跑到峰值带宽的 80%。★3 要把矩阵乘挪到拐点右边：算术强度不小于拐点。改标了 TODO 的两个长度，矩阵乘的 A 是 4096×k，B 是 k×4096。

```python
n = 1 << 12  # TODO：加法的长度。改大，直到 add 的「占屋顶」到 80%
k = 16  # TODO：矩阵乘中间那一维。改大，直到 mm 过了拐点
x, y = torch.randn(n, device="cuda"), torch.randn(n, device="cuda")
z = torch.empty_like(x)
a, b = torch.randn(4096, k, device="cuda"), torch.randn(k, 4096, device="cuda")
c = torch.empty(4096, 4096, device="cuda")
mine = hg.roofline({
    "add": (lambda: torch.add(x, y, out=z), n, 12 * n),
    "mm": (lambda: torch.mm(a, b, out=c), *mm_cost(4096, k, 4096)),
})
metrics = mine.metrics
```

看表里两行。n 太小，一次加法太短，量到的大多是启动的开销，离屋顶很远；k 越大，矩阵乘每搬 1 字节做的运算越多，点就往右挪。两个长度都取 2 的幂，改完重新运行这个单元；`mm_cost` 还没写完时，mm 这个点先不画。

## 交成绩

<!-- lab:submit -->

## 练习

1. 加法换几个长度：`hg.roofline` 一次可以放好几个点，把 n 取 2¹⁶、2²⁰、2²⁴、2²⁶ 各放一个。「占屋顶」怎么变？有没有哪个长度超过了 100%？算算三个数组一共多大，和[全景图](https://datawhalechina.github.io/hello-gpu/novice/gpu-panorama/)上的缓存大小比一比。
2. 把方阵的边长从 256 每次翻倍到 4096，各放一个点，工作量用你的 `mm_cost`。算术强度和「占屋顶」怎么变？边长小的为什么离屋顶远？提示：启动的开销，[一行 PyTorch 背后](https://datawhalechina.github.io/hello-gpu/forge/behind-pytorch/)那一关细讲。
3. 把屋顶线里的矩阵乘换成 FP16：`a`、`b`、`c` 都加上 `dtype=torch.half`，字节数也跟着改。它还在屋顶下面吗？FMA 测试量的是 FP32 的向量运算；FP16 的矩阵乘可能用上矩阵核心，在试炼场的 [GEMM 二：矩阵核心](https://datawhalechina.github.io/hello-gpu/trial/gemm-matrix-cores/)那一关讲。
