# 2-5 一行 PyTorch 背后：kernel 与 trace（实验室）

<!-- lab:header -->

## 准备

这一关只用 PyTorch 自带的算子和 profiler，不编译 kernel，两条路线做的一样。先跑一键检查。

```python
import torch
import torch.nn.functional as F
import hello_gpu as hg

torch.manual_seed(0)
env = hg.check_env()
```

看输出里的前三项：都是 ✓ 就能做这一关。后三项只关系到编译 kernel，有 ⚠ 也不影响这一关。

## 动手

三段：先看一行代码启动了哪些 kernel、哪个最耗时；再把数据换小，看启动的开销；最后把一行拆成几步，看中间结果怎样反复进出显存。为什么会这样，看[关卡页](https://datawhalechina.github.io/hello-gpu/forge/behind-pytorch/)。

### 一行启动了哪些 kernel

拿神经网络里常见的一层：矩阵乘、加偏置、过 GELU，写成一行。先运行一次：第一次调用要加载 kernel、初始化矩阵乘库，不算在后面的记录里。

```python
x = torch.randn(4096, 4096, device="cuda")
w = torch.randn(4096, 4096, device="cuda")
b = torch.randn(4096, device="cuda")
y = F.gelu(x @ w + b)
torch.cuda.synchronize()
```

PyTorch 自带 profiler（`torch.profiler`）：CPU 上记下每个 PyTorch 算子和每次 HIP 运行时调用，GPU 上记下每个 kernel。记一次这一行：

```python
from torch.profiler import ProfilerActivity, profile

with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA]) as prof:
    y = F.gelu(x @ w + b)
    torch.cuda.synchronize()  # 等 GPU 算完再停止记录
print(prof.key_averages().table(sort_by="device_time_total", row_limit=12))
```

看 Name 一列：`aten::` 开头的是 PyTorch 的算子，在 CPU 上运行；`hip` 开头的是 HIP 运行时的调用，例如启动 kernel 的 `hipLaunchKernel`；剩下名字很长的是 GPU 上的 kernel。表头里的 CUDA 指 GPU：ROCm 版 PyTorch 沿用了这个名字。

这张表按名字汇总，看不出先后，也看不出哪个 kernel 是哪个算子启动的。`hg.trace` 用同一个 profiler 把这一行记几遍，挑中间那一遍，按时间排好：

```python
mlp = hg.trace({"mlp": lambda: F.gelu(x @ w + b)})
```

看表里每个 kernel 是哪个算子启动的、在 GPU 上跑了多久，最后一句是最耗时的那个。矩阵乘的 kernel 不是 PyTorch 自己写的，来自 ROCm 的矩阵乘库，名字也是库起的。下面的时间线有三条道：CPU 上的算子、CPU 上的启动、GPU 上的 kernel；一个算子和它启动的 kernel 同一种颜色。

### 启动的开销

同一行，数据换成很小的一块：

```python
xs = torch.randn(8, 256, device="cuda")
ws = torch.randn(256, 256, device="cuda")
bs = torch.randn(256, device="cuda")
mlp_small = hg.trace({"mlp_small": lambda: F.gelu(xs @ ws + bs)})
```

看「GPU 忙的时间占」那一句，再看时间线上 GPU 那条道：kernel 一个个很短，中间空着。CPU 上每个算子都要走一遍 Python、PyTorch 的算子分派和 HIP 运行时，才把 kernel 交给 GPU，这段时间就是启动的开销。数据小的时候，kernel 很快就算完了，GPU 大部分时间在等 CPU 把下一个 kernel 交过来。

profiler 自己也要记账，CPU 上的时间会比不开 profiler 时长一些；GPU 上 kernel 的时间不受影响。

### 反复读写显存

GELU 也可以照 tanh 近似的公式一步一步写。公式里有 8 次运算（4 次乘、2 次加、1 次乘方、1 次 tanh），每次运算是一个 PyTorch 算子：

```python
def gelu_steps(x):  # GELU 的 tanh 近似，照公式一步一步写
    return 0.5 * x * (1 + torch.tanh(0.7978845608 * (x + 0.044715 * x**3)))

big = torch.randn(1 << 26, device="cuda")  # 2²⁶ 个 FP32 数，256 MiB
chain = hg.trace({"steps": lambda: gelu_steps(big)})
```

看表里有几个 kernel、每个跑了多久。每个 kernel 把输入从显存读进来，把结果写回显存，下一步再从显存读出来。8 步一共读 10 遍、写 8 遍和 `big` 一样大的数组；一个 kernel 一次算完的话，只要读 1 遍、写 1 遍。这些逐元素的算子都在 2-4 屋顶线的拐点左边，归带宽管：读写的遍数越多，越慢。

## 挑战

两件事：先把分步写的 GELU 改成少启动 kernel 的写法，再用 trace 比一比数据大、数据小两种情况。三颗星的标准在[关卡页](https://datawhalechina.github.io/hello-gpu/forge/behind-pytorch/)的任务卡上。

### 少启动几个 kernel

`mine(x)` 要算出和 `gelu_steps(x)` 一样的结果，启动的 kernel 更少。补上标了 TODO 的那一行。

```python
def mine(x):
    return ...  # TODO：和 gelu_steps 结果一样，kernel 更少

checks = hg.check(mine, gelu_steps, [1000, (64, 1000), (3, 333, 77)])
```

`hg.check` 拿三种形状的随机数，比 `mine` 和 `gelu_steps` 的结果。看输出里的 ✓ 和 ✗：都 ✓ 才拿得到 ★1。提示：动手第一段那一行里的 `F.gelu` 有个参数，用 `help(F.gelu)` 看一看。

### 数据大、数据小各比一次

★2 比数据大的时候：`mine` 在 GPU 上的时间最多是 `gelu_steps` 的一半。★3 比数据小的时候：从开始到算完也最多是一半。

```python
tiny = torch.randn(1 << 10, device="cuda")  # 1024 个数
lines = hg.trace({
    "steps": lambda: gelu_steps(big),
    "mine": lambda: mine(big),
    "steps_small": lambda: gelu_steps(tiny),
    "mine_small": lambda: mine(tiny),
})
metrics = lines.metrics
```

看最后的汇总表。数据大时，比的是读写显存的遍数；数据小时，每个 kernel 一下就算完，比的是启动了几次。`mine` 还没写完时，它在 GPU 上什么也不做，这两颗星先拿不到。

## 交成绩

<!-- lab:submit -->

## 练习

1. 让 PyTorch 自己把这几步并起来：把挑战第一个单元里 `def mine` 那两行换成 `mine = torch.compile(gelu_steps)`，重新运行挑战的两个单元（第一次调用要编译，要等一会儿；需要 `hg.check_env()` 里「Triton」那一项是 ✓）。还剩几个 kernel？kernel 的名字里有什么？编译器生成的是 Triton kernel，Triton 的写法和配置在[路线进阶](https://datawhalechina.github.io/hello-gpu/forge/route-advanced/)那一关讲。
2. 第一次调用多花了什么：建两个这一关没用过形状的矩阵，`p = torch.randn(96, 512, device="cuda")`、`q = torch.randn(512, 384, device="cuda")`，先只记一遍、不预热：`hg.trace({"first": lambda: p @ q}, warmup=0, repeat=1)`，再照常记一次：`hg.trace({"again": lambda: p @ q})`。两次的 CPU 上各用了多久？第一次多出了哪些事件？
3. 换几个长度：`sizes = {k: torch.randn(1 << k, device="cuda") for k in (10, 14, 18, 22, 26)}`，再 `hg.trace({f"steps_{k}": (lambda v=v: gelu_steps(v)) for k, v in sizes.items()}, plot=False)`，`mine` 也照样记一遍。长度到多少，GPU 忙的时间开始超过从开始到算完的一半？两种写法的「从开始到算完」之比怎么变？
