# 2-3 测得准：可信计时（实验室）

<!-- lab:header -->

## 准备

这一关只用 PyTorch 自带的加法和矩阵乘，不编译 kernel，两条路线做的一样。先跑一键检查。

```python
import time

import torch
import hello_gpu as hg

torch.manual_seed(0)
env = hg.check_env()
```

看输出里的前三项：都是 ✓ 就能做这一关。后三项只关系到编译 kernel，有 ⚠ 也不影响这一关。

后面每一段都测同一种加法。`make_add(n)` 把 n 个数的加法准备好：输入、输出事先放进显存，先跑一次。之后每调用一次 `add()`，只做一次加法。

```python
def make_add(n):
    x = torch.randn(n, device="cuda")
    y = torch.randn_like(x)
    out = torch.empty_like(x)

    def add():
        torch.add(x, y, out=out)

    add()
    torch.cuda.synchronize()  # 等准备的活都做完，免得算进后面的计时
    return add
```

生成数据、分配显存都不算进计时，要测的只是 `add()` 这一次调用。

## 动手

三段各看一种让计时失真的情况：停表太早、第一次太慢、缓存帮了忙。为什么会这样，看[关卡页](https://datawhalechina.github.io/hello-gpu/forge/trusted-timing/)。

先准备一个大加法：两个数组各 2²⁶ 个数，加一次要读写 768 MiB。

```python
n = 1 << 26
add = make_add(n)
```

### 停表的时机

先用 CPU 计时：调用前看一眼时钟，`add()` 返回时看一眼，等 GPU 算完再看一眼。

```python
start = time.perf_counter()
add()
returned = time.perf_counter()
torch.cuda.synchronize()  # 等 GPU 把排着的活都做完
done = time.perf_counter()
print(f"add() 返回：{(returned - start) * 1000:.3f} ms")
print(f"等 GPU 算完：{(done - start) * 1000:.3f} ms")
```

看输出里两个数差多少倍。`add()` 把加法排进 GPU 的队列就返回了，这时 GPU 还在算。不等 GPU 就停表，量到的只是排队那一下。

GPU 事件是 GPU 队列里的时间戳：GPU 走到它，才记下时间。下面先排两个加法，不等它们算完，再用 CPU 计时和 GPU 事件同时量第三个。

```python
begin = torch.cuda.Event(enable_timing=True)
end = torch.cuda.Event(enable_timing=True)
add()
add()  # 先排两个加法，不等它们算完
start = time.perf_counter()
begin.record()  # 时间戳 1：排在两个加法后面
add()
end.record()  # 时间戳 2
end.synchronize()  # 等 GPU 走到时间戳 2
print(f"CPU 计时：{(time.perf_counter() - start) * 1000:.3f} ms")
print(f"GPU 事件：{begin.elapsed_time(end):.3f} ms")
```

看输出里两个数：CPU 计时把前面排着的两个加法也算了进去；GPU 事件只量 `begin` 和 `end` 之间的那一个加法。

### 预热与波动

第一次调用常常最慢：可能要加载 kernel、初始化计算库，GPU 也可能刚从空闲里醒来。拿这个 Notebook 里还没用过的矩阵乘试试：不预热，直接计时 10 次。

```python
w = torch.randn(2048, 2048, device="cuda")

def matmul():
    torch.mm(w, w)

first = hg.bench(matmul, warmup=0, repeat=10)
print("前三个样本（ms）：", first.samples_ms[:3])
print(f"平均数 {first.measurement.mean_ms:.3f} ms，中位数 {first.median_ms:.3f} ms")
```

看输出里的第一个样本：比后面的大得多。它把平均数拉高了，中位数几乎不受影响。所以计时之前先预热几次，统计时看中位数。

预热以后，样本还是有快有慢。下面把同一个大加法测两轮，每轮都先预热，再计时几十次。

```python
one = hg.bench(add)
two = hg.bench(add)
print(f"第一轮的单个样本：最快 {min(one.samples_ms):.4f} ms，最慢 {max(one.samples_ms):.4f} ms")
print(f"两轮的中位数：{one.median_ms:.4f} ms、{two.median_ms:.4f} ms")
```

看输出：只测一次，可能碰上最快的，也可能碰上最慢的；两轮的中位数却挨得很近。

波动用 p10 和 p90 记：样本从快到慢排好，排在 10% 和 90% 处的两个数。中间八成样本都在它们之间，p10 ÷ p90 越接近 1，测得越稳。

### 缓存冷热

同一组数据接着算，上次读过的数可能还留在缓存里，这是热缓存；先把缓存里的数换掉再算，是冷缓存。`hg.warm_cold` 轮流测这两种：冷缓存那一次，计时之前先读一遍比缓存大得多的缓冲区。

先测一个小加法：三个数组一共 12 MiB。

```python
small = make_add(1 << 20)
cache_small = hg.warm_cold(small, bytes_moved=12 * (1 << 20))
```

再测上面的大加法：三个数组一共 768 MiB。

```python
cache_big = hg.warm_cold(add, bytes_moved=12 * n)
```

看两次输出里冷缓存比热缓存慢多少。小加法的数据装得进缓存，热缓存那次从缓存里读，冷热差得多。大加法的数据装不下，冷热都要从显存读，差得少。本书那张卡的缓存有多大，看[全景图](https://datawhalechina.github.io/hello-gpu/novice/gpu-panorama/)。

## 挑战

两件事：先写一个自己的计时函数，再把冷热分开测准。三颗星的标准在[关卡页](https://datawhalechina.github.io/hello-gpu/forge/trusted-timing/)的任务卡上。

### 写计时函数

`my_timer(fn)` 调用 `fn` 一次，返回这一次用了多少毫秒。补上标了 TODO 的两行，用的是「停表的时机」里那两个 GPU 事件。

```python
def my_timer(fn):
    begin.record()
    fn()
    end.record()
    ...  # TODO：等 GPU 走到 end
    return ...  # TODO：返回 begin 到 end 的毫秒数

checks = hg.check_timer(my_timer)
```

`hg.check_timer` 拿你的计时函数和 hg 自己的 GPU 事件计时比三种情况：大数组加法、小数组加法，还有前面排着两个大数组加法的小数组加法。看输出里的 ✓ 和 ✗：三种都 ✓ 才拿得到 ★1；✗ 后面写着差在哪。

### 冷热分开测

挑一个数组长度，用 `hg.warm_cold` 测它的冷热，交这一次的结果。★2 要热缓存测得稳：p10 ÷ p90 不小于 0.9。★3 要冷热分得开：冷缓存的中位数不小于热缓存的 p90。

```python
n = 1 << 26  # TODO：数组长度。改小，找一个两颗星都拿得到的长度
mine = make_add(n)
cache = hg.warm_cold(mine, bytes_moved=12 * n)
metrics = cache.metrics
```

看输出最后两行的比值。数组太大，缓存装不下，冷热分不开；太小，一次加法太短，启动的开销占得多，波动又大。长度取 2 的幂，从 2²⁶ 往下试，改完重新运行这个单元。

## 交成绩

<!-- lab:submit -->

## 练习

1. 把「预热与波动」里的 `hg.bench(add)` 换成 `hg.bench(add, repeat=5)` 和 `hg.bench(add, repeat=300)`，各运行几次。中位数和 p10、p90 各怎么变？哪个随样本数变稳，哪个基本不变？
2. 看 `hg.check_timer` 输出里后两种情况的参考值：同一个小数组加法，前面排着两个大数组加法时，GPU 事件量出来是长了还是短了？有两件事方向相反：队列空着时，GPU 走到 begin 以后要等 CPU 把加法交过来（停表的时机）；前面那两个大加法读写了几百 MiB，把小加法的数据挤出了缓存（缓存冷热）。启动的开销在[一行 PyTorch 背后](https://datawhalechina.github.io/hello-gpu/forge/behind-pytorch/)那一关细讲。
3. 用 `hg.warm_cold(make_add(m), bytes_moved=12 * m)` 把 m 从 2¹⁶ 到 2²⁶ 每次翻倍测一遍，记下冷热开始分不开的 m。那时三个数组一共多大？和[全景图](https://datawhalechina.github.io/hello-gpu/novice/gpu-panorama/)上的缓存大小比一比。
