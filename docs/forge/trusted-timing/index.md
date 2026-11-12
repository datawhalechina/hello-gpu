---
layout: stage
stage: forge-trusted-timing
newTerms: [gpu-event, percentile, cold-cache]
evidence: mixed
description: 同一个加法，停表早了只量到排队，第一次调用最慢，缓存里剩下的数又让它快一截。这一关用 GPU 事件计时，先预热、再取中位数和 p10、p90，把热缓存和冷缓存分开测，在你的卡上测出可信的耗时。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES, formatParam } from '@course/hardware.ts'
import { githubUrl } from '@course/lab.ts'
import StopClock from './scenes/StopClock.vue'
import NoiseLab from './scenes/NoiseLab.vue'
import CacheFit from './scenes/CacheFit.vue'
import { BASE_MS, FIRST_CALL_EXTRA_MS, FLUSH_BYTES, HG_REPEAT, STAGE_ID, WARMUP_CALLS, bytesText } from './timing.ts'

const S = STAGE_ID
const GOAL = '在你的 GPU 上写一个用 GPU 事件计时的函数，再把一个加法在热缓存和冷缓存下的耗时分开测准。'
// 星级标准从大纲的 lab.stars 读（06 第 7 节）：任务卡、LabCard 判星和 Notebook 用的是同一份规则。
const STARS = stageById(S).lab.stars.map((star) => star.text)

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const YOUR_GPU = stageById('forge-your-gpu')
const RELIABLE = stageById('forge-reliable-loop')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
// 实验档案馆的参考记录在这张卡上测（R-01），硬件参数同样从 hardware.json 读。
const REF = HARDWARE_DEVICES['ai-pro-r9700']
const REF_IC = formatParam(REF.params.infinityCache)
const L2 = formatParam(HW.params.l2Cache)
const IC = formatParam(HW.params.infinityCache)
const FLUSH = bytesText(FLUSH_BYTES)
// hello_gpu 的源码和实验配置在 GitHub 上的位置（同 LabCard 的「在 GitHub 查看」）。
const LAB_PY = githubUrl('notebooks/common/src/hello_gpu/lab.py')
const MEASUREMENT_PY = githubUrl('notebooks/common/src/hello_gpu/measurement.py')
const CONFIG_TOML = githubUrl('notebooks/config.toml')

const pClock = [
  { label: '加法在 GPU 上算的时间', why: 'add() 返回时，GPU 可能还没开始算。停表停在返回那一刻，量不到 GPU 算了多久。' },
  { label: '把加法排进 GPU 队列的那一下', correct: true, why: '启动是异步的：add() 把加法排进队列就返回，GPU 在后面接着算。要量加法本身，得等 GPU 算完再停表，或者让 GPU 自己记时间。' },
  { label: '加法，再加上拷进拷回显存的时间', why: '输入、输出事先就在显存里，add() 不拷贝，只做一次加法。' },
  { label: '我不确定', why: '不确定也没关系，探索一把这一下里 CPU 和 GPU 各在做什么画出来。' },
]

const pAgent = [
  { label: '收下改动：中位数快了 1.5%', why: '改后的中位数 1.28 ms 还在改前的 p10 到 p90（1.26–1.41 ms）之间。差别比波动还小，再测一轮可能就反过来。' },
  { label: '先不下结论：差别还在波动里，多测几轮再比', correct: true, why: '改前改后的 p10 到 p90 几乎重叠，中位数只差 0.02 ms。要说变快了，差别得比波动大；多测几轮，或者换一个改法。' },
  { label: '退回改动：p90 变大了，说明变慢了', why: 'p90 也只差 0.02 ms，同样在波动里。只盯一个数下结论，和只看中位数一样靠不住。' },
]

const checkpoint = [
  {
    q: '要量一个函数：它先在 CPU 上做 2 ms 的预处理，再启动一个 kernel。同事把 begin.record() 写在函数开头、end.record() 写在结尾，队列事先是空的。begin.elapsed_time(end) 量到的是什么？',
    options: [
      { label: '只有 kernel：GPU 事件只量 GPU 上的活', why: '事件量的是 GPU 走到 begin 和走到 end 之间的时间。begin 记下以后，GPU 一直空等 CPU 做完预处理、交来 kernel，这段空等也在里面。' },
      { label: 'kernel 加上 CPU 预处理的 2 ms', correct: true, why: '队列空着，GPU 走到 begin 马上记下时刻，然后空等到 kernel 交过来。只想量 kernel，就把 begin.record() 挪到预处理之后、紧挨着启动。' },
      { label: '读不出来，一定报错', why: '读之前先 end.synchronize()，等 GPU 走到 end，就读得出来；只是读到的数里含着空等。' },
    ],
  },
  {
    q: '同一个 kernel 计时 30 次：29 次都在 0.50 ms 上下，有 1 次是 5.0 ms（那时正好有别的程序在用 GPU）。报告里写哪个数？',
    options: [
      { label: '平均数，约 0.65 ms', why: '一个慢样本把平均数拉高了三成。别人照着测，很难碰上同样的那一次，对不上这个数。' },
      { label: '中位数 0.50 ms，再附上 p10、p90', correct: true, why: '中位数不受那一个慢样本影响；p10、p90 记下其余样本的波动，别人拿自己的数来比，知道差多少算正常。' },
      { label: '最快的那一次', why: '最快的一次只说明碰上最好的情况能有多快，波动多大一点也看不出来。' },
    ],
  },
  {
    q: '模型里有一层 kernel，每次前向都读同一份 32 MiB 的权重；两次读之间，别的层读写了几百 MiB 数据。估计这一层在模型里的耗时，看哪个数更贴近？',
    options: [
      { label: '热缓存的中位数', why: '热缓存是数据刚用过、还在缓存里。在模型里，两次读之间别的层早把缓存换成了别的数据，碰不上这种情况。' },
      { label: '冷缓存的中位数', correct: true, why: '别的层读写的几百 MiB 把缓存换了一遍，和冷缓存的测法一样：这份权重要从显存读。单独反复测这一层，32 MiB 装得进缓存，热缓存的数会偏乐观。' },
      { label: '热缓存和冷缓存的平均', why: '两种情况平均一下，哪种都不像。模型里碰到的是哪种，就报哪种，并写明是冷是热。' },
    ],
  },
]
</script>

# 2-3 测得准

<div class="tt-hello">
  <Mascot class="tt-hello__art" :size="64" />
  <p class="tt-hello__line">算对了，再测有多快。这回先把停表拿稳。</p>
</div>

{{ PREV.code }} 关的 vector add 算对了，这一关把它测准。同一个加法，停表的时机、第一次调用、缓存里剩下的数，都会让测出来的耗时不一样。

这一关只用 PyTorch 自带的加法和矩阵乘，不编译 kernel，两条路线做的一样。要一块 AMD GPU，环境在 {{ YOUR_GPU.code }} 关准备好了；没有 GPU 也能读完，挑战另有观摩模式。

<Mission :stage="S" :goal="GOAL" :stars="STARS">

三颗星都在实验室 Notebook 里拿：★1 看你写的计时函数对不对；★2、★3 看你挑的数组长度，热缓存测得稳不稳、冷热分不分得开。

</Mission>

## 热身：这一下量到了什么？

同事想知道一个加法要多久。输入、输出事先放进了显存，`add()` 只做一次加法；他在前后各看一眼 CPU 的时钟：

```python
start = time.perf_counter()
add()
elapsed = time.perf_counter() - start
```

<Predict :stage="S" id="tt-p-clock" question="这个 elapsed 量到的是什么？" :options="pClock">

探索一把这条时间线画出来。

</Predict>

## 探索一：停表的时机

CPU 计时要等 GPU 算完再停表；更稳的做法是让 GPU 自己记时间。`add()` 只把加法排进 GPU 的队列（stream）就返回，这就是 {{ PREV.code }} 关见过的[异步启动](/handbook/#async-launch)。

[GPU 事件](/handbook/#gpu-event)也排在这个队列里：GPU 走到它，才记下当时的时刻。换一换停表的办法，再在前面排上几个加法：

<StopClock />

队列里排着别的活时，CPU 计时把它们也算了进去，GPU 事件只量 begin 和 end 之间的一段。队列空着时，这一段还夹着 GPU 等 CPU 交活的空隙：加法越短，它占得越多。Notebook「动手」的「停表的时机」一段，在真卡上把这几种量法各跑一遍。实验档案馆的参考记录（{{ REF.name }}，2²⁶ 个数的加法）里，`add()` 返回只用了 0.089 ms，等 GPU 算完是 1.402 ms；前面排着两个加法时，CPU 计时量到 3.995 ms，GPU 事件量到 1.328 ms。

## 探索二：预热与波动

只测一次，碰上哪个样本全凭运气；先预热，再测几十次取中位数，两轮才对得上。

第一次调用常常最慢：可能要加载 kernel、初始化计算库，GPU 也可能刚从空闲里醒来。[预热](/handbook/#warmup)就是先空跑几次，把这些只发生一次的开销挪到计时外面。预热以后，样本照样有快有慢：别的程序、驱动、GPU 的频率都可能插一脚。

下面的噪声模拟器把同一个加法测两轮。噪声多大、预热没有、每轮测几次，都由你定：

<NoiseLab />

中位数是样本从快到慢排好以后正中间的那个，偶尔几个慢样本拉不动它。波动用[分位数](/handbook/#percentile)记：p10、p90 之间夹着中间八成样本。报耗时写中位数，再附上 p10 和 p90，别人才看得出你的数稳不稳。

Notebook「预热与波动」一段在真卡上看同样两件事：还没用过的矩阵乘，第一个样本慢多少；同一个加法测两轮，中位数挨得多近。参考记录里，2048×2048 的矩阵乘第一个样本 50.0 ms，后面九个在 1.16–1.35 ms 之间；同一个加法两轮的中位数是 1.3283 ms 和 1.3280 ms。

## 探索三：缓存冷热

数据装得进缓存时，热缓存和冷缓存测出来是两个数；装不下时，两个差不多。

同一组数据接着算，上次读过的数可能还留在缓存里，这时测的是热缓存；先把缓存里的数换掉再测，是[冷缓存](/handbook/#cold-cache)。{{ HW.name }} 上最大的两级缓存是 L2（{{ L2 }}）和 Infinity Cache（{{ IC }}）。换一换数组长度，看三个数组装不装得下：

<CacheFit />

冷热各有用处：热缓存像同一份数据被接连处理，冷缓存像每次都来一批新数据。报哪一个，看你的 kernel 在真实程序里碰到的是哪种，报的时候写清楚。

`hg.warm_cold` 轮流测这两种：冷缓存那一次先读一遍 {{ FLUSH }} 的缓冲区，等它读完再计时；热缓存那一次紧跟着再测。Notebook「缓存冷热」一段测 12 MiB 和 768 MiB 两个加法。参考记录里，12 MiB 的热缓存中位数 0.0138 ms、冷缓存 0.0260 ms，差将近一倍；768 MiB 的热缓存 1.328 ms、冷缓存 1.321 ms，分不开。

## 原理：可信的耗时要说清四件事

一个耗时可不可信，看它说没说清四件事：

- 量的是哪一段：GPU 事件夹住要量的那一段，读时间之前先等 GPU 走到 end。
- 预热了没有：第一次调用的开销挪到计时外面。
- 测了几次：报中位数，附上 p10、p90。
- 缓存是冷是热：数据装得进缓存时两种都测，写明报的是哪种。

`hg.bench` 照前三件测：每次调用前后在当前队列上记一对 GPU 事件，先预热 {{ WARMUP_CALLS }} 次，再计时 {{ HG_REPEAT }} 次。`hg.warm_cold` 再把第四件分开测。

<ConceptCard term="gpu-event" code="torch.cuda.Event(enable_timing=True)">

`begin.record()` 把一个事件排进当前的队列。`end.synchronize()` 让 CPU 等 GPU 走到 end，`begin.elapsed_time(end)` 返回两个时刻之差，单位是毫秒。没等 GPU 走到 end 就读会报错：PyTorch 2.13 自己先查一遍，报 `Both events must be completed before calculating elapsed time.`（[CUDAEvent.h](https://github.com/pytorch/pytorch/blob/v2.13.0/c10/cuda/CUDAEvent.h#L194-L204)，ROCm 版同一份代码）；直接问 HIP 运行时，返回的是 `hipErrorNotReady`。

</ConceptCard>

<ConceptCard term="percentile" code="hg.bench(add).p10_ms">

中位数就是 p50：一半样本比它快，一半比它慢。p10 ÷ p90 越接近 1，中间八成样本挨得越紧，测得越稳；挑战的 ★2 看的就是热缓存的 p10 ÷ p90。

</ConceptCard>

<ConceptCard term="cold-cache" code="hg.warm_cold(add)">

冷缓存的测法：计时之前读一遍比缓存大得多的缓冲区，把缓存里的数换掉。热缓存的测法：紧跟着上一次调用再测。挑战的 ★3 要冷缓存的中位数不小于热缓存的 p90，也就是冷热的差别比热缓存自己的波动还大。

</ConceptCard>

<DeepDive title="出处：异步启动和 GPU 事件">

- PyTorch 文档：GPU 上的操作默认是异步的，排进设备的队列就返回；不同步就计时，量不准，要么先调用 `torch.cuda.synchronize()`，要么用 `torch.cuda.Event` 记时间（[Asynchronous execution](https://docs.pytorch.org/docs/2.13/notes/cuda.html#asynchronous-execution)）。`record()` 把事件记在当前的队列上，`synchronize()` 让 CPU 等到事件完成，`elapsed_time()` 返回两个事件之间的毫秒数（[torch.cuda.Event](https://docs.pytorch.org/docs/2.13/generated/torch.cuda.Event.html)）。
- HIP 文档：kernel 是异步启动的，CPU 接着往下走（[Concurrent execution between host and device](https://rocm.docs.amd.com/projects/HIP/en/docs-10.0.0/how-to/hip_runtime_api/asynchronous.html#concurrent-execution-between-host-and-device)）。`hipEventElapsedTime` 以毫秒计，分辨率约 1 微秒；事件走到队头、前面的活都做完时才记下时间戳，所以记下的时刻可能比 CPU 调用 `hipEventRecord` 晚得多；时间戳还没记下就读，返回 `hipErrorNotReady`（[Event management](https://rocm.docs.amd.com/projects/HIP/en/docs-10.0.0/reference/hip_runtime_api/modules/event_management.html#_CPPv419hipEventElapsedTimePf10hipEvent_t10hipEvent_t)，[HIP 错误码](https://rocm.docs.amd.com/projects/HIP/en/docs-10.0.0/reference/error_codes.html#term-hipErrorNotReady)）。
- 分辨率约 1 微秒，只要几微秒的 kernel，单个样本的读数就粗了。这样的 kernel 常把一批调用夹在一对事件里，再除以次数，代价见本页末尾「深入一层」。

</DeepDive>

<DeepDive title="出处：hg 和 Triton 怎么计时">

- `hg.bench` 沿用 hello_gpu 的 `measurement.benchmark`：先预热，再逐次计时；每次调用前后在当前队列上记一对 GPU 事件，等 GPU 走到 end 再读，准备输入、校验结果都在计时区间外（<a :href="MEASUREMENT_PY">measurement.py</a>）。预热、计时的次数默认 {{ WARMUP_CALLS }} 和 {{ HG_REPEAT }}，在 <a :href="CONFIG_TOML">notebooks/config.toml</a> 里改。中位数、p10、p90 按线性插值算，和 `numpy.percentile` 的默认算法一样（<a :href="LAB_PY">lab.py</a> 的 `_quantile`）。
- `hg.warm_cold`：冷缓存那一次先读一遍 {{ FLUSH }} 的缓冲区（显存不到 4 GiB 时取显存的 1/8），等它读完、GPU 空下来再计时；热缓存那一次紧跟着再测。只读不写，换出去的缓存行不用写回显存（lab.py 的 `warm_cold`）。
- Triton 的 `triton.testing.do_bench` 按时间定预热和计时多久（默认 25 ms 和 100 ms）；每次计时之前把一块 256 MiB 的缓冲区写成 0，清掉缓存。不写 `return_mode` 时它返回平均数：要中位数写 `return_mode="median"`，要中位数和 p10、p90 写 `quantiles=[0.5, 0.1, 0.9]`（[Triton 3.8.0 的 testing.py](https://github.com/triton-lang/triton/blob/v3.8.0/python/triton/testing.py#L242-L313)；缓冲区见 AMD 后端的 [driver.py](https://github.com/triton-lang/triton/blob/v3.8.0/third_party/amd/backend/driver.py#L412-L420)）。

</DeepDive>

<DeepDive title="模拟器和示意图简化了什么">

- 噪声模拟器的样本按随机数算：加法本身设成 {{ BASE_MS }} ms，每个样本慢一点（抖动近似正态，只往慢的方向加），少数样本再慢一截，样本之间互不相关。真卡上的样本可能跟着 GPU 频率、温度一起变，前后不一定独立。
- 第一次调用多花的 {{ FIRST_CALL_EXTRA_MS }} ms 是设定值。真卡上它有多大，看第一次调用要做什么：还没用过的矩阵乘可能要初始化计算库。参考记录（{{ REF.name }}）里，2048×2048 的矩阵乘第一次 50.0 ms，之后的中位数 1.25 ms 上下，第一次多花了将近 49 ms。
- 探索一的时间线只看先后：排队、计算各用一个固定的长度，没算 Python 调用、记事件、从同步里返回的开销。
- 探索三只比装不装得下，没画快多少。参考记录里（Notebook 的练习 3），三个数组一共 48 MiB 时冷缓存是热缓存的 2.6 倍，96 MiB 起两者差不多：{{ REF.name }} 的 Infinity Cache 是 {{ REF_IC }}，冷热在这中间分开。

</DeepDive>

## 挑战：在你的卡上交成绩

挑战在实验室 Notebook 里做，两件事，三颗星和任务卡上写的一样。

**写计时函数**：`my_timer(fn)` 调用 `fn` 一次，返回这一次用了多少毫秒。begin、end 两个事件 Notebook 已经建好，你补上标了 TODO 的两行：

```python
def my_timer(fn):
    begin.record()
    fn()
    end.record()
    ...  # TODO：等 GPU 走到 end
    return ...  # TODO：返回 begin 到 end 的毫秒数

checks = hg.check_timer(my_timer)
```

`hg.check_timer` 拿你的函数和 hg 自己的 GPU 事件计时比三种情况，中位数相差不到 1.5 倍算对上；三种都对上，拿 ★1：

| 情况 | 查的是什么 |
| --- | --- |
| 大数组加法（2²⁴ 个数） | 停表时 GPU 还没算完，量出来小得多 |
| 小数组加法（2¹⁸ 个数） | 一次加法很短，CPU 计时多算进去的调用和等待显得多 |
| 小数组加法，前面排着两个大数组加法 | CPU 计时把前面排着的加法也算了进去 |

返回了秒或微秒、还没写完、运行出错，输出里都写着差在哪。

**冷热分开测**：挑一个数组长度，用 `hg.warm_cold` 测它的冷热，交这一次的结果。★2 要热缓存测得稳：p10 ÷ p90 不小于 0.9；★3 要冷热分得开：冷缓存的中位数不小于热缓存的 p90。

数组太大，缓存装不下，冷热分不开；太小，一次加法太短，启动的开销占得多，波动又大。Notebook 从 2²⁶ 开始，长度取 2 的幂往下试。参考记录里（{{ REF.name }}），2¹⁶ 到 2²² 都拿得到两颗星，挑战交的是 2²⁰；从 2²³ 起冷热分不开，拿不到 ★3。

<LabCard />

## 支线：如果让 Agent 来做

Agent 看不到上面的图，只读得到计时工具返回的数。下面是一个 Agent 改了 kernel 的组大小，前后各测一轮以后读到的观察（假设的数）：

```json
{ "before": { "median_ms": 1.30, "p10_ms": 1.26, "p90_ms": 1.41 },
  "after":  { "median_ms": 1.28, "p10_ms": 1.25, "p90_ms": 1.43 } }
```

<Predict :stage="S" id="tt-p-agent" question="换你当 Agent：读到这份观察，下一步该做什么？" :options="pAgent">

按规则办事的 Agent 也这样定：差别比波动还小，就不算变快。到了 {{ RELIABLE.code }} 关，你会把这条规则写进 Agent 的优化闭环。

</Predict>

## 你现在能……

- 说出 CPU 计时为什么会停得太早或多算别的活，用 GPU 事件量出 GPU 上的一段耗时
- 先预热、再计时几十次，用中位数报耗时，用 p10、p90 记波动
- 分开测热缓存和冷缓存，按数据装不装得进缓存判断该报哪一个

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：耗时测准了，下一关测出这张卡的峰值带宽和算力，看 kernel 离上限还有多远。

- 回到基础：[旧版第 4 章 4.3 测量 PyTorch 向量加法](/part0-intro/chapter4/#_4-3-测量-pytorch-向量加法)：先固定要测的工作，等 GPU 算完再读时间，再讲预热和重复。
- 深入一层：[旧版第 5 章 5.4 单次样本与批量平均值](/part1-profiling/chapter5/#_5-4-单次样本与批量平均值)：只要几微秒的 kernel，把一批调用夹在一对事件里再求平均，和逐次计时各有什么代价。

<EvidenceCard kind="mixed" hardware="AMD Radeon AI PRO R9700" software="ROCm 10.0.0 · PyTorch 2.13.0+rocm10.0.0 · Triton 3.8.0+git4cff872c.rocm10.0.0" date="2026-11-11" entry="forge-trusted-timing/shared-ai-pro-r9700-2026-11-11">探索一的时间线只看先后，长短是示意；探索二的样本是噪声模拟器按随机数算的，加法本身 {{ BASE_MS }} ms、第一次调用多花 {{ FIRST_CALL_EXTRA_MS }} ms 都是设定值；探索三的缓存大小出自 AMD 产品页（Infinity Cache）和 ROCm 的 GPU 规格表（L2），读的地方按装不装得下推断。正文里三种停表办法、预热前后和冷热两种测法的耗时，来自实验档案馆的参考记录：在 {{ REF.name }} 上照 Notebook 从头跑了一遍，挑战填的是参考解，完整输出和原始样本见档案条目。</EvidenceCard>

<style scoped>
/* 小核开场：同新手村各关和 2-1、2-2 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.tt-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.tt-hello__art {
  flex: none;
}

.tt-hello__line {
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
.hg-shell.is-plain .tt-hello__art {
  display: none;
}

.hg-shell.is-plain .tt-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
