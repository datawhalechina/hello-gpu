# 2-1 开工准备：认识你的 GPU（实验室）

<!-- lab:header -->

## 准备

先跑一键检查。前三项是做实验的前提：PyTorch 是不是 ROCm 版、看不看得到 GPU、GPU 算得对不对；后三项看 ROCm 的版本和两条路线的工具。

```python
import torch
import hello_gpu as hg

env = hg.check_env()
```

看输出里每一行开头的记号。✗ 要先按下面的提示改好，再重启内核从头运行；⚠ 只影响后面某条路线，走那条路线之前改好就行。提示里的链接通向[实验环境指南](https://datawhalechina.github.io/hello-gpu/handbook/setup/)。

检查通过以后，打出这张卡的「GPU 卡片」。

```python
card = hg.device_card()
```

卡片最后一行是导入码。整串复制，贴进[关卡页](https://datawhalechina.github.io/hello-gpu/forge/your-gpu/)或[「我的成长」](https://datawhalechina.github.io/hello-gpu/me/#gpu-card)的「我的 GPU 卡片」，新手村的[全景图](https://datawhalechina.github.io/hello-gpu/novice/gpu-panorama/)就换成你的卡。

## 动手

卡片上的 CU 数、wave 大小和显存，在 PyTorch 和 rocminfo 里都有出处。下面三段各查一个；WGP、wave 和显存的原理在[关卡页](https://datawhalechina.github.io/hello-gpu/forge/your-gpu/)上。

### CU 有几个

PyTorch 和 rocminfo 都报 CU 数，两边不一定一样。`card["rocminfo"]` 是 `hg.device_card()` 运行 rocminfo 时这张卡的那一段输出；找不到 rocminfo 命令时它是 `None`，下面打印「没读到」。

```python
props = torch.cuda.get_device_properties(0)
info = card["rocminfo"] or {}
print("PyTorch 的 multi_processor_count：", props.multi_processor_count)
print("rocminfo 的 Compute Unit：", info.get("Compute Unit", "没读到"))
print("卡片上的 CU 数：", card["cus"])
```

看输出里的前两个数。RDNA 架构的卡上，PyTorch 默认报的是 WGP 的个数：一个 WGP 两个 CU，所以只有 rocminfo 的一半。数据中心的 Instinct 卡（CDNA 架构）没有 WGP，两个数一样。

### wave 多大

wave 是一起执行同一条指令的一队线程。看看这张卡一队几个。

```python
print("PyTorch 的 warp_size：", props.warp_size)
print("rocminfo 的 Wavefront Size：", info.get("Wavefront Size", "没读到"))
print("卡片上的 wave 大小：", card["wave"])
```

看输出里的数。按 [HIP 文档](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#wavefront)，RDNA 架构的卡是 32，和新手村的小队一样大；Instinct 卡是 64。每组线程数取它的整数倍，小队才坐得满。

### 显存多少

显存总量来自设备属性 `total_memory`，卡片用的也是它；现在空着多少，问 `torch.cuda.mem_get_info()`。

```python
total = props.total_memory
free, _ = torch.cuda.mem_get_info()
print(f"总量：{total} 字节 = {total / 2**30:.1f} GiB = {total / 1e9:.1f} GB")
print(f"空着：{free / 2**30:.1f} GiB")
```

看输出里的单位：GiB 按 2³⁰ 字节算，GB 按 10⁹ 字节算。同一块显存写成 GB，数大约多 7%。卡片和全景图都用 GiB。

总量和空着的差是已经被占用的，也包括这个 Notebook 自己。

## 挑战

两件事：先把三个数填进全景图，再找出矩阵多大时，GPU 才比 CPU 划算。

### 填全景图

全景图要三个数：CU 数、wave 大小、显存（GiB）。照上面三段的输出填，填好交给 `hg.check_card` 核对。

```python
mine = {
    "cus": ...,  # TODO：CU 数（PyTorch 报的不一定是它）
    "wave": ...,  # TODO：wave 大小
    "memory_gib": ...,  # TODO：显存总量，单位 GiB，保留一位小数
}
checks = hg.check_card(mine)
```

看输出里的 ✓ 和 ✗：✗ 后面写着错在哪，改好再运行。

### GPU 什么时候划算

同一个 n×n 的矩阵乘，比三种跑法：CPU 算；GPU 算，数据已在显存里；GPU 算，算上拷进拷回。从小矩阵开始，一点点改大。

```python
n = 32  # TODO：矩阵边长，最大 4096。改大，直到两行「CPU ÷ GPU」都不小于 1
race = hg.race(n)
metrics = race.metrics
```

看输出里两行「CPU ÷ GPU」：大于 1，GPU 就快。矩阵乘要算 2·n³ 次浮点运算，只搬 3·n² 个数：n 越大，搬一次的数据被算的次数越多。计时由 `hg.race` 负责，GPU 计时的门道留到「测得准」那一关。

## 交成绩

<!-- lab:submit -->

## 练习

1. 在终端运行 `rocminfo` 和 `amd-smi monitor`（没有 amd-smi 就用 `rocm-smi`），找出 CU 数、wave 大小和显存，和上面的对一对。
2. 让 `n` 从 32 开始每次翻倍，记下两行「CPU ÷ GPU」各自第一次大于 1 时的 `n`。换一个平台再测，这两个 `n` 会变吗？
3. `n` = 4096 时，矩阵乘一共算多少次浮点运算、拷进拷回多少字节？平均每个字节要做几次运算？「性能的天花板」那一关用这个比值判断瓶颈在哪。
