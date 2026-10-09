"""Author Part 0 as five standalone, sequential teaching notebooks.

Kernel source belongs to each notebook cell. Figures are embedded from the
corresponding local textbook assets; readers need only the chapter notebook.
"""

from authoring import Notebook


PART = "part0-intro"
SETUP = """
import torch
import hello_gpu as gpu

cfg = gpu.settings()
torch.manual_seed(cfg["seed"])
%load_ext hello_gpu
cfg
"""
ADD = """
__global__ void kernel(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) c[i] = a[i] + b[i];
}
"""


def figure(book, chapter, filename, caption, alt):
    book.figure(f"docs/{PART}/chapter{chapter}/images/{filename}", caption, alt)


def chapter0():
    b = Notebook(PART, 0)
    b.md("""
# 第0章 写给读者的话

## 本章导读

你会调用 `torch.add`，也能运行一个模型。但同一个程序换一组输入后，为什么突然慢了？
接下来我们从一次加法出发，把“做了什么工作、数据在哪里、时间怎样测”逐步连起来。
这份 notebook 可以在没有 GPU 的 Python 环境中阅读和运行。

本章先完成一件小事：写下你想回答的性能问题，并学会区分猜测与证据。
[对应正文](../../../docs/part0-intro/chapter0/index.md)展开了全书的定位。
""")
    b.md("""
## 0.1 为什么写这本入门书

假设模型运行了一次，你只知道总共等了多久。这个数字还不能告诉你：慢的是哪一步、
CPU 有没有在等待、GPU 有没有在搬数据。要改进程序，我们先把大问题拆成能观察的小工作。

数组加法就是这样的起点。对于每个位置 `i`，读取 `a[i]` 和 `b[i]`，相加后写入 `c[i]`。
先在 CPU 上把规则写清楚，再考虑由多少线程一起执行。下面不是性能测试，只用于确定数学含义。
""")
    figure(b, 2, "cpu-gpu-task.svg", "CPU 安排任务，GPU 执行分配给它的计算；一次任务还包括数据准备与结果使用。",
           "CPU 和 GPU 之间的任务分工")
    b.code("""
a = [1.0, 2.0, 3.0, 4.0]
b = [10.0, 20.0, 30.0, 40.0]
c = [x + y for x, y in zip(a, b)]
assert c == [11.0, 22.0, 33.0, 44.0]
list(zip(a, b, c))
""")
    b.md("""
**观察**：四个输出彼此独立，计算第三个输出不需要等待第二个输出。
这为并行提供了机会，但“可以并行”并不自动等于“程序更快”：准备、提交、等待也需要时间。

### 先写下你的问题

把“我想让 GPU 快一点”改写成能验证的一句话。例如：“输入已经在 GPU 上时，
改变 block 大小，会不会改变长度固定的 FP32 向量加法时间？”下面的文本可以直接修改。
""")
    b.code("""
my_question = "同样长度的向量加法，改变 block 大小会怎样影响时间？"
my_evidence = ["正确性检查", "同一输入规模", "重复测量", "本次硬件与软件信息"]
{"问题": my_question, "需要收集": my_evidence}
""")
    b.md("""
## 0.2 这本书适合谁

如果你能运行 Python、读懂数组和函数，就可以从这里开始。Linux 命令行主要用于准备环境；
HIP 的线程与指针会跟着例子逐步解释，不需要在开头背下整套术语。

| 已有基础 | 本篇先练什么 | 怎样确认学会了 |
| --- | --- | --- |
| 能写 Python，刚接触 GPU | 跟踪一个输出由哪个线程计算 | 能手算线程下标和尾部边界 |
| 经常使用 PyTorch | 分清 Tensor、kernel 和执行流 | 能解释提交后为什么还要等待 |
| 写过 CUDA 或 HIP | 重新核对当前目标和测量口径 | 不把旧设备参数当作本机结论 |
| 想做优化 Agent | 先完整走一次人工实验 | 能保存并解释一次有效与一次无效尝试 |

不用现在掌握所有列。选择最贴近自己的一行，读完第 4 章后再回来核对。
""")
    b.md("""
## 0.3 为什么选 AMD Radeon RX 9070 XT

本书从一张能够实际运行实验的 AMD 显卡出发，让线程分工、数据访问和性能分析始终有具体对象。
这些问题也会出现在其他设备上；变化的是工具链、执行资源以及可以测得的结果。

本篇不会让 kernel 通过硬编码 GPU 型号才能运行。先在第 1 章识别当前环境，
随后把实验结果与当次环境一起保存。当前安装基线和换卡边界集中在下一章说明。
这里先学习读出本 notebook 正在使用的 Python 环境；这个检查不要求存在 GPU。
""")
    b.code("""
import hello_gpu as gpu

context = gpu.environment(require_gpu=False)
{key: context.get(key) for key in ("python", "torch", "hip", "gpu", "os")}
""")
    b.md("""
**观察**：这里选择了 `require_gpu=False`，因此不探测 GPU，设备相关信息保留为空；
空值表示尚未探测，并不表示机器没有显卡。Python 与包版本来自当前解释器，
后续 kernel 能否运行仍需下一章实际验证。
""")
    b.md("""
## 0.4 这本书和市面教程有什么不同

我们把每次优化看作一个可重复的小实验：明确任务，建立正确实现，测量，提出解释，改动一个因素，再测量。
失败的尝试同样有价值。如果改动没能降低时间，它至少能帮助你排除一个未经验证的假设。

| 动作 | 本轮要回答的问题 | 留下什么 |
| --- | --- | --- |
| 写规则 | 这个算子算什么？ | 参考实现与输入输出约定 |
| 测量 | 当前实现用了多久？ | 原始样本、单位、计时范围 |
| 定位 | 哪些观察支持当前解释？ | timeline、访存或资源证据 |
| 修改 | 本轮只改变什么？ | kernel 源码与参数 |
| 复查 | 更快了吗，结果还对吗？ | 同口径对照与失败记录 |

以后让 Agent 帮忙，也是让它执行这些动作。判断结果是否可信的标准不变。
""")
    b.code("""
experiment = {
    "规则": "c[i] = a[i] + b[i]",
    "本轮变量": "block 大小",
    "保持相同": ["输入", "dtype", "预热", "重复次数", "计时范围"],
    "先检查": "所有有效位置的结果是否正确",
}
experiment
""")
    b.md("""
## 0.5 你将完成的事

这本 notebook 系列把学习过程留在眼前：先读一小段解释，看图找到数据和线程，运行一个短单元，
再根据输出回答问题。编译、绑定与记录这些反复出现的操作由 `hello_gpu` 包承担。
到第 1 章，你会在 `%%hip` 单元里写 kernel，随后直接用 PyTorch Tensor 调用它。

| 阶段 | 能独立完成的事 |
| --- | --- |
| 入门 | 验证环境，写出带边界检查的加法 kernel |
| Profiling | 明确计时范围，找出值得进一步分析的工作 |
| 经典算子 | 根据数据依赖设计访存与协作方式 |
| 算子 Agent | 把生成、检查、测量与选择组织成循环 |
| 真实模型 | 把局部改动放回完整任务中验证收益 |

这里没有“必须快多少倍”的预设。能解释一次变化为什么值得继续调查，就是有效进展。
""")
    b.md("""
## 0.6 学习路线图

先顺序完成本篇五章。前一章留下的问题，正是后一章要处理的对象。

| 接下来去哪 | 带着什么问题阅读 |
| --- | --- |
| [第 1 章：环境准备](../chapter1/chapter1.ipynb) | 我的 Python 能编译和调用 HIP 吗？ |
| [第 2 章：线程组织与执行](../chapter2/chapter2.ipynb) | 哪个线程负责哪个输出？ |
| [第 3 章：数据存储与访问](../chapter3/chapter3.ipynb) | 输入在哪里，线程怎样交接数据？ |
| [第 4 章：第一个程序 + 性能分析](../chapter4/chapter4.ipynb) | 算对以后，怎样测出有含义的时间？ |

每章都能从空白 Python 内核开始运行。修改代码后建议重启内核并“运行全部”，
检查结果是否依赖上一次留下的变量。首次编译可能需要等待，后续相同源码可以复用缓存。
""")
    b.md("""
## 0.7 和其他 datawhale 教程的边界

本书聚焦单卡算子、性能分析和优化过程的自动化。多卡通信与服务化可继续阅读
[hello-mlsys](https://github.com/datawhalechina/hello-mlsys)，通用智能体应用可阅读
[hello-agents](https://github.com/datawhalechina/hello-agents)。先把一次单卡实验做完整，
再扩展问题范围，会更容易知道新增的复杂性来自哪里。

### 练习

1. 把开头的加法改成逐元素乘法。哪些数据依赖保持不变？
2. 写下你自己的性能问题，并列出至少三个需要固定的条件。
3. 如果两份实现的时间不同，但一份包含输入拷贝、一份没有，你能直接宣布谁更快吗？

## 本章小结

我们已经给一次实验定义了数学规则、待验证的问题和需要保存的证据。
接下来打开[第 1 章](../chapter1/chapter1.ipynb)，把这条学习路线落实到当前 Python 和 GPU 环境。
""")
    return b.write()


def chapter1():
    b = Notebook(PART, 1)
    b.md("""
# 第1章 环境准备

## 本章导读

开始写 kernel 之前，先确认当前 Python 进程能访问 GPU。本章依次检查：当前解释器是谁、
GPU 能否被看到、PyTorch 是否能计算，以及我们写的 HIP 是否能编译并与 Tensor 一起工作。

先准备环境，再从上到下运行。遇到错误时停在第一处失败，读完整信息后再往下走。
[对应正文](../../../docs/part0-intro/chapter1/index.md)包含终端层面的详细安装与排错说明。
""")
    b.md("""
## 1.1 本教程的实验基线

本书当前基线是 **Radeon RX 9070 XT、ROCm SDK 10.0、原生 Ubuntu 24.04**。
ROCm SDK 和 HIP 组件各自有版本号，所以 `torch.version.hip` 不必等于 SDK 版本。
后续结果以运行时读到的真实环境为准。

| 检查 | 通过后能说明什么 | 还不能说明什么 |
| --- | --- | --- |
| GPU 可见 | 当前进程能发现计算设备 | 任意算子或 profiling 工具均可用 |
| PyTorch 计算 | 框架可以提交并完成运算 | 手写 HIP 的编译工具链可用 |
| HIP smoke test | 当前 kernel 能编译、加载、计算 | 所有输入与优化都正确 |

其他 AMD GPU 或系统的工具可用性与性能，需要在对应机器上重新验证。
本套 notebook 不把某个 `gfx` 架构、wavefront 大小或带宽数字当作运行前提；
换卡时仍要先安装适合目标的设备依赖，不能把本机结果当作其他卡的实测。
""")
    b.code("""
import sys
import torch
import hello_gpu as gpu

cfg = gpu.settings()
context = gpu.environment(require_gpu=False)
{"Python 路径": sys.executable, "环境": context}
""")
    b.md("""
**观察**：`Python 路径` 应该指向本篇使用的环境。本次选择 `require_gpu=False`，
只读取当前系统与包信息，不探测 GPU；设备栏为空表示尚未探测，实际设备检查安排在 1.4。
""")
    b.md("""
## 1.2 平台边界：原生 Linux 优先，WSL2 需单独验证

驱动负责把硬件交给系统，ROCm 和 PyTorch 在此基础上提交计算。`uv` 管理环境里的依赖，
不会替你安装或修复系统内核驱动。原生 Linux 和 WSL2 的平台能力需要分别核对。

下面从当前 Python 查看系统与设备接口。它只读取信息，不修改驱动，也不会安装依赖。
""")
    b.code("""
from pathlib import Path
import platform

{
    "系统": platform.system(),
    "内核": platform.release(),
    "KFD 设备接口存在": Path("/dev/kfd").exists(),
    "PyTorch HIP 组件": torch.version.hip,
}
""")
    b.md("""
**观察**：一个设备文件存在，只说明路径存在，不证明当前用户有访问权限。
同样，最小计算通过，也不证明硬件性能计数器能够采集；我们在 profiling 篇单独检验那些能力。
""")
    b.md("""
## 1.3 同步本篇 uv 环境

每篇使用独立的 Python 环境，避免其他章节的依赖变化影响当前实验。
`pyproject.toml` 描述依赖，`uv.lock` 固定解析出的版本，`.venv` 保存安装结果。

环境准备步骤集中在 [README](../../README.md)。这里检查当前解释器、公共教学包和实验配置，
确认后续单元使用的是预期环境。
""")
    b.code("""
from pathlib import Path

{
    "Python 所在目录": str(Path(sys.executable).parent),
    "公共教学包": gpu.__version__,
    "默认实验配置": cfg,
}
""")
    b.md("""
## 1.4 验证 GPU 可见性

现在要求当前内核确实能访问 ROCm GPU。失败时先检查是否选错 Python 内核、驱动是否正常、
用户是否有设备访问权限；不要用 CPU 结果替代后面的 GPU 检查。
""")
    b.code("""
context = gpu.environment()
{key: context[key] for key in ("gpu", "architecture", "memory_bytes", "torch", "hip")}
""")
    b.md("""
**观察**：把实际设备名称与预期机器核对。`architecture` 是当前识别出的目标，
不是 kernel 里需要手写的一串常量。如果这一步失败，终端中的 `rocminfo` 输出能帮助区分
底层设备问题和 Python 包问题，具体用法见本章正文。
""")
    b.md("""
## 1.5 验证 PyTorch ROCm

现在创建输入，让 PyTorch 真正做一次加法。固定随机种子使输入能够重复生成；
同时用 CPU 参考结果检查输出，而不是只看有没有报错。

PyTorch 的 ROCm 后端沿用 `device="cuda"` 和 `torch.cuda` 命名。
是否在使用 AMD 后端要看环境与 `torch.version.hip`，不能只看这个字符串。
""")
    b.code("""
torch.manual_seed(cfg["seed"])
n = cfg["n"]
a_cpu = torch.randn(n, dtype=torch.float32)
b_cpu = torch.randn_like(a_cpu)
a, b = a_cpu.to("cuda"), b_cpu.to("cuda")
reference = a_cpu + b_cpu
torch_result = torch.add(a, b)
torch.testing.assert_close(torch_result.cpu(), reference, rtol=0, atol=0)
{"shape": tuple(torch_result.shape), "device": str(torch_result.device), "correct": True}
""")
    b.md("""
**观察**：`.to("cuda")` 将输入放到 GPU，`.cpu()` 让主机能够读取结果。
这次检查包含了数据传递，所以它是计算链路检查，尚不是 kernel 计时。
""")
    b.md("""
## 1.6 验证最小 HIP 程序

下图先把整个过程连起来。正文里的 C++ 程序显式分配、复制和释放存储；这里让 PyTorch Tensor
管理存储，`%%hip` 负责编译和调用包装。你仍能看到最重要的计算规则。
""")
    figure(b, 4, "vector-add-data-path.svg", "输入从 CPU 到 GPU，kernel 写出结果，CPU 取回后检查。",
           "向量加法的主机与设备数据路径")
    b.md("""
每个线程算一个下标，有效时读取两个数并写回。先照着运行，下一章再拆解这些编号。
`binary_f32` 约定两个连续 FP32 输入、一个同形状输出，以及元素个数 `n`。
它会根据 `block` 和数组长度安排足够的线程；输出由 Tensor 管理。
""")
    b.code("%load_ext hello_gpu")
    b.code("%%hip smoke_add --preset binary_f32\n" + ADD)
    b.code("""
out = torch.empty_like(a)
smoke_add(a, b, out=out, block=cfg["block"])
torch.testing.assert_close(out.cpu(), reference, rtol=0, atol=0)

tail_n = cfg["block"] + 3
x = torch.randn(tail_n, device="cuda")
y = torch.randn_like(x)
torch.testing.assert_close(smoke_add(x, y, block=cfg["block"]), x + y, rtol=0, atol=0)
{"checked_lengths": [n, tail_n], "correct": True}
""")
    b.md("""
**观察**：你只写了 kernel，调用时传入的仍然是普通 Tensor。
`out=` 允许复用已有输出；不提供它时，调用会新分配输出。非整除长度检查了最后一块的边界条件。

如果想确认它也能成为真正的 PyTorch 自定义算子，可以使用 `.op` 暴露的 `torch.ops` 入口。
本篇的实现只负责前向计算，输入不应设置 `requires_grad=True`。
""")
    b.code("""
op = smoke_add.op
torch.testing.assert_close(op(x, y, block=cfg["block"]), x + y, rtol=0, atol=0)
{"operator": str(op), "build_id": smoke_add.build_id, "cache_hit": smoke_add.cache_hit}
""")
    b.md("""
第一次执行 HIP 单元需要编译；相同源码再次运行会复用缓存。修改函数体后再运行 HIP 单元，
才能让 Python 名字指向新的实现。编译失败时，报错会指向 notebook kernel 的行号和完整构建日志。
""")
    b.md("""
## 1.7 环境不通时先收集什么

把错误停在最早失败的一层：看不到设备，先检查系统；PyTorch 失败，检查内核与包；
PyTorch 成功而 HIP 编译失败，再检查工具链与源码。不要把不同层的问题混成“GPU 不行”。

| 需要保留的信息 | 从哪里得到 |
| --- | --- |
| Python 路径、系统、PyTorch/HIP 版本 | 1.1 与 1.2 的输出 |
| 实际设备与架构 | 1.4 的输出 |
| 最早失败的单元 | 单元输入与完整异常 |
| 编译位置与详细日志 | `%%hip` 的异常信息 |
| 最近一次改动 | 切换内核、同步依赖或修改源码的具体动作 |

### 练习

1. 重新运行 HIP 单元。缓存状态怎样变化？输入数据会跟着编译缓存一起保存吗？
2. 把输入长度改成 `2 * cfg["block"] + 1`，验证最后一个有效位置。
3. 有意把 `a[i] + b[i]` 改为减法，再运行旧的加法检查。失败反映的是环境问题还是数学规则变化？随后改回加法并重跑。

## 本章小结

我们分别验证了环境、PyTorch 运算与手写 HIP 的调用路径。接下来在
[第 2 章](../chapter2/chapter2.ipynb)中，把 kernel 里的线程编号一项项算清楚。
安装细节与换卡方法可回到[正文附录入口](../../../docs/part0-intro/chapter1/index.md)。
""")
    return b.write()


def chapter2():
    b = Notebook(PART, 2)
    b.md("""
# 第2章 GPU 体系结构（上）：编程模型与 wavefront 执行

## 本章导读

同一个 kernel 启动了许多线程，为什么它们不会都写到同一个位置？我们从一张工作单开始，
先看任务怎样分组，再手算线程下标，最后用 HIP 验证尾部与条件分支。
本章沿用[第 1 章](../chapter1/chapter1.ipynb)准备的环境，可以从空白内核独立运行。
[对应正文](../../../docs/part0-intro/chapter2/index.md)提供更完整的线程分组图解。
""")
    b.code(SETUP)
    b.md("""
## 2.1 GPU 计算的基本流程

CPU 准备输入并发起计算，GPU 执行许多份同样的工作单，CPU 在使用结果前确认计算完成。
Kernel 就是工作单上的函数；Thread 是带着自己编号执行这个函数的一份工作。
对于数组加法，每个有效线程都要完成“取两个数、相加、写回”，不是只负责其中一个动作。
""")
    figure(b, 2, "cpu-gpu-task.svg", "发起任务、执行计算和使用结果分别处于流程中的不同位置。",
           "CPU 安排输入与任务，GPU 运行线程并产生结果")
    b.code("""
a = [1, 2, 3, 4]
b = [10, 20, 30, 40]
work_items = [{"i": i, "read": (a[i], b[i]), "write": a[i] + b[i]}
              for i in range(len(a))]
work_items
""")
    b.md("""
**观察**：工作单相同，每份工作的 `i` 和输入不同。这只是 CPU 上的数据分工模型，
尚未模拟 GPU 的执行顺序；线程编号也不承诺谁先执行。
""")
    b.md("""
## 2.2 线程的组织与执行

一次启动的全部线程块构成 Grid；一个 Block 包含一组线程，组内可以在需要时共享数据和同步。
Block 内部又按 kernel 的执行配置组成 wavefront，lane 表示线程在这个执行小组里的位置。
我们指定 block 大小，并不需要逐个安排 wavefront 的执行时刻。

| 名称 | 本章先回答的问题 |
| --- | --- |
| Grid | 这次提交了哪些 block？ |
| Block | 哪些线程属于同一个协作组？ |
| Thread | 谁在执行这一份 kernel？ |
| Wavefront / lane | 共同执行指令的是哪组线程，各自处于什么位置？ |

下面只用每块四个线程做编号练习。四是方便手算的 block 大小，不是设备的 wavefront 大小。
""")
    figure(b, 2, "thread-groups.svg", "每块都有自己的 0 号线程，因此要用块号与块内编号一起识别线程。",
           "三块线程各自拥有从零开始的局部编号")
    b.code("""
import pandas as pd

toy_n, toy_block = 10, 4
toy_grid = (toy_n + toy_block - 1) // toy_block
groups = [{"block": group, "thread": lane}
          for group in range(toy_grid) for lane in range(toy_block)]
pd.DataFrame(groups)
""")
    b.md("""
**观察**：12 份线程工作覆盖 10 个元素；多出来的两份工作仍被启动，但必须跳过数组读写。
下一节把“线程是谁”变成“它处理哪里”。
""")
    b.md("""
## 2.3 线程编号与数据索引

每块负责一段连续位置时，数组下标是 `块号 × 每块线程数 + 块内线程号`。
这个下标由源码里的公式决定，不是 Tensor 自动塞给每个线程的。改变公式会改变数据分工，
因此还要检查是否遗漏、重复写入或越界。
""")
    figure(b, 2, "thread-data-index.svg", "先找到 block 起点，再加上块内偏移，得到数组下标。",
           "block 编号和 thread 编号组合成连续数组下标")
    b.code("""
mapping = pd.DataFrame(groups)
mapping["i"] = mapping["block"] * toy_block + mapping["thread"]
mapping["valid"] = mapping["i"] < toy_n
assert mapping.loc[mapping["valid"], "i"].tolist() == list(range(toy_n))
mapping
""")
    figure(b, 2, "tail-threads.svg", "最后一块中超出数组长度的位置，只跳过读写，不改变原有线程编号。",
           "尾块中有效线程与越界线程的区别")
    b.md("""
现在写 HIP。`blockIdx.x`、`blockDim.x` 和 `threadIdx.x` 分别提供块号、块大小和块内线程号。
`if (i < n)` 将刚才表格中的 `valid` 条件落实到每次读写之前。
""")
    b.code("%%hip indexed_add --preset binary_f32\n" + ADD)
    b.code("""
n, block = cfg["n"], cfg["block"]
checked = []
for length in (0, 1, block - 1, block + 3, n + 3):
    a = torch.randn(length, device="cuda", dtype=torch.float32)
    b = torch.randn_like(a)
    c = indexed_add(a, b, block=block)
    torch.testing.assert_close(c, a + b, rtol=0, atol=0)
    checked.append({"n": length, "blocks": (length + block - 1) // block, "correct": True})
pd.DataFrame(checked)
""")
    b.md("""
**观察**：边界判断让非整除长度也有完整结果。空输入由调用层直接返回空 Tensor，
不需要启动一个“没有有效元素”的 kernel。读到 `correct=True` 只说明这些输入通过检查。

### 分支条件怎样对应到位置

把任务改成：偶数位置做加法，奇数位置做减法。它仍然是一份 kernel，只是不同线程根据自己的
`i` 选择分支。这里先验证映射，不从分支数量直接推断快慢。
""")
    b.code("""
%%hip alternating --preset binary_f32
__global__ void kernel(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;
    if (i % 2 == 0) c[i] = a[i] + b[i];
    else c[i] = a[i] - b[i];
}
""")
    b.code("""
length = block + 3
a = torch.randn(length, device="cuda")
b = torch.randn_like(a)
indices = torch.arange(length, device="cuda")
expected = torch.where(indices % 2 == 0, a + b, a - b)
actual = alternating(a, b, block=block)
torch.testing.assert_close(actual, expected, rtol=0, atol=0)
preview = min(8, length)
pd.DataFrame({"i": range(preview),
              "branch": ["add" if i % 2 == 0 else "subtract" for i in range(preview)],
              "result": actual[:preview].cpu().tolist()})
""")
    b.md("""
同一 wavefront 中参与某条指令的线程可以是其中一部分。条件掩码保证每个位置遵循自己的规则；
具体执行了哪些指令、分支是否被编译器改写，要看编译结果与测量证据。
不能仅凭源码里有一个 `if` 就认定它是瓶颈。
""")
    b.md("""
## 2.4 线程分组与硬件执行单元

Block 与 wavefront 是软件工作分组，SIMD、CU 等是承接工作的硬件组织。
启动更多线程不等于芯片上增加了更多执行单元；硬件在资源允许时让部分工作驻留并推进。
RDNA 还使用 WGP 组织相关资源，具体放置与执行模式需要结合目标和编译产物理解。
""")
    figure(b, 2, "software-hardware.png", "软件描述有哪些工作，硬件决定何时执行已就绪的指令；图不是一一独占关系。",
           "软件线程层级与 GPU 硬件执行层级对照")
    b.code("""
context = gpu.environment()
pd.DataFrame([{"block": size, "grid": (n + size - 1) // size,
               "logical_threads": ((n + size - 1) // size) * size}
              for size in (64, 128, 256)])
""")
    b.md("""
**观察**：表中能算出逻辑工作量，却没有“同时执行线程数”这一列。
并发还依赖寄存器、共享存储和调度条件。这正是[第 3 章](../chapter3/chapter3.ipynb)接下来要追踪的数据与资源。

## 自我检验

1. 不运行代码，先算 `N=1000, block=256` 时需要几块，尾块有多少有效线程，再用 Python 核对。
2. 把 `alternating` 改成每连续四个位置共用一个分支。先写 PyTorch 参考，再修改 HIP 并检查非整除长度。
3. 为什么“线程 35”和“lane 3”可能描述同一份工作？回答时明确假设的 wavefront 大小，不把它当作所有设备的常量。
4. 增大 block 后 grid 变小，能否只凭这个变化宣布更快？还缺哪些测量？

## 本章小结

线程编号给出身份，索引公式决定数据分工，边界判断保护数组。
我们用相同的分工模型连起了手算表、HIP kernel 与 PyTorch 参考。
下一章[数据存储与访问](../chapter3/chapter3.ipynb)继续追踪每个线程读来的值去了哪里。
""")
    return b.write()


def chapter3():
    b = Notebook(PART, 3)
    b.md("""
# 第3章 GPU 体系结构（下）：数据存储与访问

## 本章导读

[上一章](../chapter2/chapter2.ipynb)确定了哪个线程负责哪个位置。本章继续追踪：
输入数组已经在 GPU 上，为什么线程还要等待读取？什么时候需要让两个线程交换数据？
我们先用小数组观察位置，再写一个 block 内交接数据的 HIP kernel。
[对应正文](../../../docs/part0-intro/chapter3/index.md)通过局部和交接解释共享与同步；
这里用邻居加法亲手练习同样的先写后读关系。
""")
    b.code(SETUP)
    b.md("""
## 3.1 数据位置与读写过程

执行 `c[2] = a[2] + b[2]` 时，先从输入数组取得两个值，运算产生临时结果，再把结果写回输出。
全局内存描述输入、输出使用的访问空间；寄存器保存指令当前使用的临时值；执行单元使用这些值计算。
源码变量的数量不等于实际寄存器数量，存放安排由编译器决定。
""")
    figure(b, 3, "data-locations.svg", "保存数组、保存临时值和执行运算是三种职责；图不表示芯片面积或真实距离。",
           "输入输出数组、线程临时值与加法执行部件的位置关系")
    b.code("""
a = torch.tensor([1., 2., 3., 4.], device="cuda")
b = torch.tensor([10., 20., 30., 40.], device="cuda")
c = torch.empty_like(a)
torch.add(a, b, out=c)
{"a": a.cpu().tolist(), "b": b.cpu().tolist(), "c": c.cpu().tolist()}
""")
    b.md("""
**观察**：输入仍然保留，输出获得相加后的值。GPU 写回 `c` 后，数据仍位于 GPU；
这里的 `.cpu()` 才让主机拿到便于查看的副本。它不应悄悄放进我们想测的纯设备侧计算区间。
""")
    b.md("""
## 3.2 Wavefront 的访存组织

一次读取面对的是一组 lane 提供的地址。四个 lane 都读一个 FP32 数，连续下标与跨步下标
都只需要四个结果，但覆盖的地址范围可以不同。相邻线程访问相邻元素，通常更有利于硬件合并处理。
""")
    figure(b, 3, "wave-addresses.svg", "比较同一批 lane 的地址排列；图中的分组用于教学，不代表固定事务或缓存行大小。",
           "连续地址与跨步地址对应不同的访问范围")
    b.code("""
import pandas as pd

lanes = list(range(4))
pd.DataFrame({"lane": lanes,
              "连续下标": lanes, "连续字节偏移": [4 * i for i in lanes],
              "跨步下标": [5 * i for i in lanes], "跨步字节偏移": [20 * i for i in lanes]})
""")
    b.md("""
**观察**：这里的 4 字节来自 FP32 元素大小，5 来自我们选定的下标步长。
我们没有据此指定硬件做了几次事务。缓存是否已保存数据，也会影响数据从哪里提供。

Tensor 的 `stride` 可以帮助理解地址公式。下面仍在 CPU 上观察同一块存储的两个视图：
""")
    b.code("""
storage = torch.arange(20, dtype=torch.float32)
dense, strided = storage[:4], storage[::5]
pd.DataFrame([{"view": name, "values": value.tolist(), "stride": value.stride(),
               "contiguous": value.is_contiguous()}
              for name, value in (("连续", dense), ("跨步", strided))])
""")
    b.md("""
这解释了为什么我们的 `binary_f32` 教学接口要求连续 Tensor：kernel 的 `a[i]` 按连续 FP32
位置前进，不会自动理解 Python 视图的步长。将跨步视图转为连续副本会产生额外工作，
需要明确放在哪个阶段并记录成本。后续逐元素算子章节再用同口径实验比较访存策略。
""")
    b.md("""
## 3.3 Block 内的数据共享与同步

普通加法中，每个输出独立。但如果线程要使用邻居加载的值，就需要约定交接位置和交接时刻。
LDS 是同一 block 可使用的共享存储，`__shared__` 声明空间；`__syncthreads()` 建立屏障，
保证屏障前的共享写入在屏障后可被组内线程使用。

我们用邻居加法练习协作：每个 block 内将 `a` 左循环移动一个位置，再与原位置的 `b` 相加。
两幅图采用同一个固定手算例子：`n=6`、`block=4`，输入 `a=[1,2,3,4,5,6]`，
输入 `b=[10,20,30,40,50,60]`。前四个位置组成完整块，后两个位置组成尾块。
这组小数用于追踪数据，后面的规模实验仍使用配置中的 `n` 和 `block`。

**先写自己的位置。**每个有效线程将 `a[i]` 放进自己的 `tile` 位置。
尾块仍有四个线程；没有有效输入的两名线程写入占位值 0，然后和本块其他线程一起到达屏障。
""")
    b.figure("notebooks/assets/part0-neighbor-write.svg",
             "固定图例的写入阶段：完整块写入 [1,2,3,4]，尾块写入 [5,6,0,0]；每个 block 的全部线程参加各自的屏障。",
             "邻居加法中两个 block 的输入到 LDS 写入，尾部无效线程写零并参与同步")
    b.md("""
**再读邻居的位置。**屏障后，完整块的四名线程分别读取 `tile[1]`、`tile[2]`、`tile[3]`、`tile[0]`，
得到 `[2,3,4,1]`，再分别加上原位置的 `[10,20,30,40]`。
尾块只有两个有效位置，因此只交换 5 与 6；有效线程不会读取占位 0，无效线程也不会写出结果。

请在下图中追踪线程 3 与尾块线程 1：它们都回到自己 block 的第一个有效位置，
不会跨 block 寻找邻居。两个 block 的共享数组彼此独立，屏障也不要求它们同时推进。
""")
    b.figure("notebooks/assets/part0-neighbor-read.svg",
             "固定图例的读取与计算：屏障后读取下一个有效共享位置，加上原位置的 b，手算得到 [12,23,34,41,56,65]。",
             "完整块左循环读取邻居后得到12、23、34、41，尾块得到56、65，无效线程跳过输出")
    b.md("""
现在把图里的写入、屏障和邻居读取写成 kernel。`local_i` 是块内线程编号，
`start` 是当前块的数组起点；邻居下标始终在本块的 `valid` 个有效位置内循环。

这个 kernel 的共享数组容量由源码选为 1024 个 FP32 元素，因此本例要求 `block <= 1024`；
这只是本例容量约定，实际设备启动限制仍由运行层检查。没有假设固定 bank 数或 wavefront 大小。
""")
    b.code("""
%%hip neighbor_add --preset binary_f32
__global__ void kernel(const float* a, const float* b, float* c, int n) {
    __shared__ float tile[1024];
    int local_i = threadIdx.x;
    int start = blockIdx.x * blockDim.x;
    int i = start + local_i;
    int valid = n - start;
    if (valid > blockDim.x) valid = blockDim.x;
    tile[local_i] = i < n ? a[i] : 0.0f;
    __syncthreads();
    if (i < n) {
        int neighbor = local_i + 1 < valid ? local_i + 1 : 0;
        c[i] = tile[neighbor] + b[i];
    }
}
""")
    b.md("""
请先找到屏障：它位于有效下标判断之外。尾块的无效线程也会写一个安全的占位值并到达屏障，
随后才跳过输出。把 `return` 放在无效线程处、让其提前离开共同屏障，不是正确的尾部处理。

先为数学规则写参考实现。下面通过下标计算得到每个位置应读取的邻居，和 HIP 的共享实现互相核对。
""")
    b.code("""
def reference_neighbor(a, b, block):
    n = a.numel()
    i = torch.arange(n, device=a.device)
    start = (i // block) * block
    valid = torch.minimum(torch.full_like(i, block), n - start)
    neighbor = start + (i % block + 1) % valid
    return a[neighbor] + b

toy_a = torch.tensor([1., 2., 3., 4., 5., 6.], device="cuda")
toy_b = torch.tensor([10., 20., 30., 40., 50., 60.], device="cuda")
toy_out = neighbor_add(toy_a, toy_b, block=4)
torch.testing.assert_close(toy_out, reference_neighbor(toy_a, toy_b, 4), rtol=0, atol=0)
toy_out.cpu().tolist()
""")
    b.md("""
**观察**：把输出和图中的手算结果逐项核对。`c[3]` 使用的是 `a[0] + b[3]`，
`c[5]` 使用的是 `a[4] + b[5]`。尾块的最后一个有效线程回到自己这块的起点，
不会跨 block 去找下一块，也不会读到占位 0。LDS 与该屏障建立的是 block 内协作。
""")
    b.code("""
n, block = cfg["n"], cfg["block"]
assert 1 <= block <= 1024, "本例的共享数组容量要求 block <= 1024"
checked = []
for length in (1, block - 1, block + 3, n + 3):
    a = torch.randn(length, device="cuda")
    b = torch.randn_like(a)
    actual = neighbor_add(a, b, block=block)
    expected = reference_neighbor(a, b, block)
    torch.testing.assert_close(actual, expected, rtol=0, atol=0)
    checked.append({"n": length, "correct": True})
pd.DataFrame(checked)
""")
    b.md("""
这里使用 LDS 是为了练习交接，而不是宣称它比直接读取邻居更快。
同样的数学任务也能让每个线程直接从全局内存读邻居；两种写法值得比较，但需要相同输入和测量口径。
""")
    b.md("""
## 3.4 访存等待与指令调度

一组工作在等待输入时，另一组已经准备好的指令可能继续执行。这叫延迟隐藏：
等待中的读取并没有因此提早返回，只是执行资源可以在这段时间处理别的工作。
保留更多工作也需要寄存器、LDS 等资源，所以“线程越多越好”并不成立。
""")
    figure(b, 3, "wave-waiting.svg", "等待中的状态仍被保留，调度器选择其他就绪工作；图不表示固定周期或顺序。",
           "一个 wavefront 等待数据时调度另一个就绪 wavefront")
    b.md("""
我们先保存一份可供以后比较的测量。输入、输出、参考结果在计时前准备好，
计时只包含这次已准备调用的当前流 event 区间。它可以作为下一轮起点，
但单个时间不能证明 occupancy、缓存命中率或延迟隐藏是否充分。
""")
    b.code("""
a = torch.randn(n, device="cuda")
b = torch.randn_like(a)
out = torch.empty_like(a)
run = neighbor_add.prepare(a, b, block=block, out=out)
run()
torch.testing.assert_close(out, reference_neighbor(a, b, block), rtol=0, atol=0)
measurement = gpu.benchmark(run, label="LDS neighbor add",
                            warmup=cfg["warmup"], repeat=cfg["repeat"])
gpu.summary([measurement])
""")
    b.code("""
record = gpu.save_record("part0-intro/chapter3", kernel=neighbor_add,
    config={**cfg, "shape": [n], "dtype": "float32", "correct": True,
            "checked_lengths": [row["n"] for row in checked],
            "goal": "观察 block 内 LDS 写入、屏障与邻居读取",
            "entry": "chapter3.ipynb", "operation": "block-local left rotation of a plus b"},
    measurements=[measurement])
record
""")
    b.md("""
## 自我检验

1. 将小例子的长度改为 9、block 保持 4。手算最后一块的邻居是谁，再运行检查。
2. 写出直接读取全局内存邻居的版本，先与 `reference_neighbor` 对照，再公平比较两版时间。
3. 为什么把屏障放进 `if (i < n)` 内会破坏尾块的协作约定？不要通过故意运行错误同步来猜答案。
4. 图中的 wavefront A 等待时，B 可以推进。什么情况下 B 也不能推进？

## 进一步学习

LDS 的 bank、寄存器占用与矩阵专用指令都依赖具体目标和编译产物。
需要时再读[执行资源与访存实验](../../../docs/part0-intro/chapter3/experiments.md)，
先区分示意模型与实际采集数据。本章不为这些机制填入未经当前实验确认的固定数量。

## 本章小结

访问地址描述“读哪里”，共享存储描述“在哪里交接”，屏障描述“何时可以读”。
接下来到[第 4 章](../chapter4/chapter4.ipynb)，把正确计算与可信计时组织成一份完整实验。
""")
    return b.write()


def chapter4():
    b = Notebook(PART, 4)
    b.md("""
# 第4章 第一个程序 + 性能分析

## 本章导读

前两章已经解释了线程分工和数据位置。本章把它们收进一次完整实验：写 HIP 向量加法，
检查结果，再测量 PyTorch 向量加法，最后把时间换算成有明确含义的指标。

注意每个表格的实现名称。4.2 的 HIP 用来理解和验证手写程序，4.3 的主要计时对象是
`torch.add`；同样的数学运算不代表同一个底层实现。
[对应正文](../../../docs/part0-intro/chapter4/index.md)也按这一顺序展开。
""")
    b.md("""
## 4.1 准备环境

选择本篇已验证的 Python 内核，先读出当前环境与实验配置。`n` 默认是 `1 << 20`，
`block` 控制 HIP 每块线程数，`warmup` 和 `repeat` 控制测量，`seed` 固定随机输入。
它们集中在一个配置中，方便你只改一个条件后完整复跑。
""")
    b.code(SETUP)
    b.code("""
context = gpu.environment()
n, block = cfg["n"], cfg["block"]
torch.set_num_threads(1)
{"environment": gpu.environment(), "n": n, "block": block}
""")
    b.md("""
这里明确将 PyTorch CPU 算子线程数设为 1，记录时也会保存实际线程数。
这描述的是该算子的 CPU 配置，不等于整个系统只有一个活动线程。
环境尚未通过时，回到[第 1 章](../chapter1/chapter1.ipynb)检查最早失败的环节。
""")
    b.md("""
## 4.2 从向量加法到 HIP 程序

给定两个等长 FP32 数组，计算 `c[i] = a[i] + b[i]`。完整程序还包括输入准备、存储分配、
数据传递、提交计算和结果检查。在 notebook 中，Tensor 承担存储管理，HIP 单元保留线程的计算规则。
""")
    figure(b, 4, "vector-add-data-path.svg", "先把数据路径说清楚，才能决定后面从哪里开始计时。",
           "向量加法从主机输入到设备计算再回到主机结果的完整流程")
    b.code("""
a_cpu = torch.randn(n, dtype=torch.float32)
b_cpu = torch.randn_like(a_cpu)
expected_cpu = a_cpu + b_cpu
a, b = a_cpu.to("cuda"), b_cpu.to("cuda")
hip_out = torch.empty_like(a)
""")
    figure(b, 4, "thread-index.svg", "块号乘块大小，加上块内线程号，得到本例采用的连续下标。",
           "线程计算全局数组下标的过程")
    b.code("%%hip vector_add --preset binary_f32\n" + ADD)
    b.code("""
vector_add(a, b, block=block, out=hip_out)
torch.testing.assert_close(hip_out.cpu(), expected_cpu, rtol=0, atol=0)
checked_lengths = [n]
for length in (0, 1, block - 1, block + 3, n + 3):
    x = torch.randn(length, device="cuda")
    y = torch.randn_like(x)
    torch.testing.assert_close(vector_add(x, y, block=block), x + y, rtol=0, atol=0)
    checked_lengths.append(length)
{"correct": True, "checked_lengths": checked_lengths}
""")
    b.md("""
**观察**：随机输入避免只检查“所有元素都是 3”这样的单一情况；非整除长度专门检查尾部。
我们在读取 CPU 结果后才宣布检查完成。到这里证明了这些输入上计算正确，还没有得到 HIP 的性能结论。
""")
    b.md("""
## 4.3 测量 PyTorch 向量加法

先固定要测量的工作：预先创建输入和输出，每次只执行 `torch.add(a, b, out=out)`。
CPU 使用主机时钟，GPU 使用当前执行流上的 event 区间。输入复制、输出分配和正确性检查都放在计时外。

GPU 提交是异步的。记录开始 event，提交加法，再记录结束 event；等待结束标记执行后，
才读取两个标记的时间差。预热用于越过首次运行状态，重复样本用于观察波动。
""")
    figure(b, 4, "event-timing.svg", "event 确定测量区间，等待保证结束标记已完成；时间线不按真实耗时比例绘制。",
           "开始 event、加法、结束 event 和主机等待的顺序")
    b.code("""
cpu_out, torch_out = torch.empty_like(a_cpu), torch.empty_like(a)
cpu_call = lambda: torch.add(a_cpu, b_cpu, out=cpu_out)
gpu_call = lambda: torch.add(a, b, out=torch_out)
cpu_call()
gpu_call()
torch.testing.assert_close(cpu_out, expected_cpu, rtol=0, atol=0)
torch.testing.assert_close(torch_out.cpu(), expected_cpu, rtol=0, atol=0)
""")
    b.code("""
cpu_measure = gpu.benchmark(cpu_call, device="cpu", label="PyTorch CPU add",
                            warmup=cfg["warmup"], repeat=cfg["repeat"])
gpu_measure = gpu.benchmark(gpu_call, label="PyTorch GPU add",
                            warmup=cfg["warmup"], repeat=cfg["repeat"])
measurements = [cpu_measure, gpu_measure]
table = gpu.summary(measurements)
table
""")
    b.md("""
**观察**：先读 `label`，确认这里测的是 PyTorch；再看 mean、median、min 是否接近。
中位数描述样本中间的位置，平均值受较大样本影响，最小值表示本次看到的最快样本。
它们都来自这次运行，不需要与正文历史数字相同。

CPU 的主机计时包含调用与计算；GPU event 区间可能受到提交节奏影响。
这两个边界各自有用，但不能把两者的差值简单解释成某一种硬件开销。
下面直接查看原始 GPU 样本，避免只盯着一个汇总值。
""")
    b.code("""
import pandas as pd

pd.DataFrame({"sample": range(1, gpu_measure.repeat + 1),
              "PyTorch_GPU_ms": gpu_measure.samples_ms})
""")
    b.md("""
## 4.4 解释测量结果

FP32 加法对每个位置读取两个 4 字节输入，写出一个 4 字节输出，因此算法字节量模型是 `12 * n`。
用这个字节量除以时间得到有效带宽。它反映这份任务按该模型完成得有多快，
并非硬件计数器读到的物理显存流量，也不直接给出缓存命中率。

本节用中位数换算：时间以毫秒计时，十进制 GB/s 为 `bytes / median_ms / 1e6`。
零时间无法支撑带宽估算，应保留为缺失值。
""")
    b.code("""
bytes_model = 3 * n * a.element_size()
table["effective_GB_s_by_median"] = bytes_model / table["median_ms"].replace(0, float("nan")) / 1e6
table.attrs["bytes_moved_model"] = bytes_model
table.attrs["bandwidth_statistic"] = "median"
table
""")
    b.code("""
gpu.plot_times(table);
""")
    b.md("""
**观察**：公共绘图函数画的是最小延迟，表中的带宽采用中位数。图和表回答的是不同的统计问题，
比较时要看单位与标签，不能把图中的 min 当成表中的 median。
若样本波动很大，先检查其他负载、输入规模、预热与提交路径，再考虑改 kernel。

数组变大时，总时间与有效带宽都可能变化。只看一次测量无法保证趋势，
也不能据此宣布“已经达到硬件极限”。下一篇会继续补上 profiling 证据。
""")
    b.md("""
## 4.5 从算子时间到程序时间

刚才的输入已经在 GPU 上。真实调用者可能从 CPU 数组开始，一直等到 CPU 拿到结果。
为了比较范围，我们保留相同数学规则，测一个包含输入与输出传递的完整调用：
CPU 输入与 GPU 缓冲区都提前分配，计时内部复制输入、执行 PyTorch 加法、复制结果并等待完成。
""")
    b.code("""
transfer_a, transfer_b = torch.empty_like(a), torch.empty_like(b)
transfer_out = torch.empty_like(a)
host_out = torch.empty_like(a_cpu)

def transfer_compute_return():
    transfer_a.copy_(a_cpu)
    transfer_b.copy_(b_cpu)
    torch.add(transfer_a, transfer_b, out=transfer_out)
    host_out.copy_(transfer_out)
    torch.cuda.current_stream().synchronize()

transfer_compute_return()
torch.testing.assert_close(host_out, expected_cpu, rtol=0, atol=0)
program_measure = gpu.benchmark(transfer_compute_return, device="cpu",
    label="PyTorch H2D + add + D2H + wait (preallocated)",
    warmup=cfg["warmup"], repeat=cfg["repeat"])
gpu.summary([gpu_measure, program_measure])
""")
    b.md("""
**观察**：第二行包含更多工作，且采用 CPU 主机时钟。它仍然没有包含 Python 启动、首次编译或
缓冲区分配，所以也不是整个进程的总耗时。性能数字只有和范围一起读才有含义。

再把输入缩小，观察提交与等待。下面调用的是我们写的 **HIP**，并比较三个范围：
批量提交的平均主机时间、一次提交加等待、GPU event 区间。
这些值包含 Python、C++ 包装、HIP 与队列路径，不能直接命名为“纯 HIP launch 耗时”。
""")
    b.code("""
small_a = torch.randn(1, device="cuda")
small_b = torch.randn_like(small_a)
small_out = torch.empty_like(small_a)
small_call = vector_add.prepare(small_a, small_b, block=block, out=small_out)
small_call()
torch.testing.assert_close(small_out, small_a + small_b, rtol=0, atol=0)
overhead = gpu.launch_overhead(small_call, warmup=cfg["warmup"], repeat=cfg["repeat"])
overhead
""")
    b.md("""
一次很小的操作可能主要受调用路径影响；把多步工作留在 GPU 上，可以让一次输入传递服务于更多计算。
是否值得迁移到 GPU，要测你的实际流程，不存在本章能给出的统一元素数分界线。
""")
    b.md("""
## 4.6 记录与练习

把本次配置、正确性、源码、环境与原始时间样本放在一起，下一次才知道哪些条件发生了变化。
本记录明确标记：主要算子测量来自 PyTorch，短调用范围观察来自 HIP；没有把二者混成一组性能结果。
""")
    b.code("""
record = gpu.save_record("part0-intro/chapter4", kernel=vector_add,
    config={**cfg, "shape": [n], "dtype": "float32", "correct": True,
            "checked_lengths": checked_lengths, "entry": "chapter4.ipynb",
            "goal": "验证 HIP 加法，学习 PyTorch 加法与程序范围计时",
            "timed_operator": "torch.add; HIP only in small-call overhead",
            "program_boundary": "preallocated H2D + torch.add + D2H + wait",
            "cpu_threads": torch.get_num_threads(), "bytes_model": bytes_model},
    measurements=[cpu_measure, gpu_measure, program_measure], overhead=overhead)
record
""")
    b.md("""
### 练习

1. 保持 block 不变，手算 `N=1000` 的 grid 和尾部，再运行 4.2 的正确性检查。
2. 在配置中改变 `n`，保持 seed、warmup、repeat 与 CPU 线程数一致，重启并运行全部。
   比较 mean、median、min 和有效带宽，记录观察到的变化，不预设某个规模必须更快。
3. 用本次中位数手算 `12N/t`。先把毫秒换成秒，再把字节换成十进制 GB，核对表中的值。
4. 若移除读取 event 时间前的等待，缺失了什么保证？提交结束标记是否等于设备已经执行完它？
5. 将完整调用改成“输入在 GPU 上连续做多次加法，最后才取回一次”。先定义每次的正确结果，
   再决定分配、传递、等待各自放在哪里。比较时完整写出测量范围。

## 本章小结

我们把一次实验拆成输入与输出约定、HIP 正确性、PyTorch 算子时间和主机可见的程序时间。
有效带宽来自明确的字节量模型，结论来自本次运行的样本。
下一章进入[第 5 章：benchmark 与可信计时](../../part1-profiling/chapter5/chapter5.ipynb)，
继续检查测量波动，以及怎样在相同条件下比较不同实现。
""")
    return b.write()


if __name__ == "__main__":
    for build in (chapter0, chapter1, chapter2, chapter3, chapter4):
        print(build())
