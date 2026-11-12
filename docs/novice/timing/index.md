---
layout: stage
stage: novice-timing
newTerms: [async-launch, warmup, bandwidth]
evidence: simulated
description: 改完了，真的变快了吗？用 CPU 的时钟量 GPU 干活，表停早了只量到交出工作单，第一次启动又夹着一次准备。先识破三份报告，再算出向量加法的有效带宽，最后量一量上一关的求和到底快了多少。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import AgentTimer from './scenes/AgentTimer.vue'
import BandwidthLab from './scenes/BandwidthLab.vue'
import ClockLab from './scenes/ClockLab.vue'
import TimingBench from './scenes/TimingBench.vue'
import {
  ADD_CARS, ADD_KERNELS, ADD_N, ADD_STRIDES, ADD_TOTAL_BYTES, BANDWIDTH_CAP, FIRST_LAUNCH_CYCLES, LAUNCH_CYCLES, LINE_BYTES,
  LINE_CYCLES, REPORTS, STAGE_ID, STAR_LABELS, decimal, fakeBandwidth, readingsOf, speedupText,
} from './challenge.ts'

const S = STAGE_ID

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const PANORAMA = stageById('novice-gpu-panorama')
const COALESCING = stageById('novice-coalescing')
const LDS_SYNC = stageById('novice-lds-sync')
const MEET_AGENT = stageById('novice-meet-agent')
const TRUSTED = stageById('forge-trusted-timing')

const GOAL = `量准第 ${PREV.code} 关求和的改前、改后两版，看看真的快了多少，再算出改后的有效带宽（模拟）。`

// 热身：三份报告，两版各量到多少，都由计时台照每份报告的写法算出来。
const [A, B, C] = REPORTS.map((r) => readingsOf(r.plan, ADD_KERNELS))
const SAY = [A, B, C].map(([before, after]) => speedupText(before, after))
const BEFORE_CARS = ADD_CARS[ADD_STRIDES[0]]
const FAKE = fakeBandwidth()

const pReports = [
  { label: '甲', why: `改前要搬 ${BEFORE_CARS} 车，光搬车就要 ${BEFORE_CARS * LINE_CYCLES} 个周期。甲量到的 ${A[0]} 个周期，只够搬 ${A[0] / LINE_CYCLES} 车：表停早了。` },
  { label: '乙', why: `车只少到 1/4，算出来却快了 ${decimal(B[0] / B[1])} 倍，比搬车省下的还多：改前那一次多算了一笔只做一次的开销。` },
  { label: '丙', correct: true, why: '丙先空跑一次，再看表之前等 GPU 算完。搬车的时间少到 1/4，算的那部分省不掉，所以快了不到 4 倍。' },
  { label: '三份都可信', why: '模拟器算同样两份工作单，每次都一样。三份差这么多，至少有两份量错了。' },
  { label: '我不确定', why: '不确定也没关系，下面三段探索把三份报告一份一份重演。' },
]

const checkpoint = [
  {
    q: '一段计时代码：看表，启动 add，再看表，然后把 c 拷回 CPU。拷回要等 GPU 把 c 算完。两次看表之间量到的是什么？',
    options: [
      { label: 'add 在 GPU 上算的时间：拷回的时候已经等过 GPU 了', why: '等是等了，可那是在再看表之后。表已经停了，后面等多久都不算。' },
      { label: '只是交出工作单的那一下', correct: true, why: '两次看表之间只有启动那一行，交出去就往下走。要量 add，同步得写在再看表之前。' },
      { label: 'add 算的时间，加上拷回的时间', why: '拷回写在再看表之后，不在两次看表中间。' },
    ],
  },
  {
    q: '同一份工作单连量 5 次，每次都同步了，没有预热。一组假想的读数：3610、610、600、605、600 个周期。报哪个数？',
    options: [
      { label: '平均数 1205', why: '第一次里夹着程序里第一次启动的准备，把平均数拉高了一倍。' },
      { label: '第一次的 3610', why: '只有第一次要做那次准备，后面的启动都不用，3610 不是平常的用时。' },
      { label: '去掉第一次，后面几次都在 600 上下', correct: true, why: '第一次就是没做的那次预热。去掉它，后面四次挨得很近，报 600 左右。' },
    ],
  },
  {
    q: '向量缩放 y[i] = 2 * x[i]，n 个 float，量准了用时 t。有效带宽怎么算？',
    options: [
      { label: 'n × 4 ÷ t：只读了 x', why: 'y 算完要写回显存，写的字节也得算上。' },
      { label: '2 × n × 4 ÷ t：读 x、写 y', correct: true, why: '每个数读一次 x、写一次 y，各 4 字节。系数 2 写在工作单里，不用去显存读。' },
      { label: '3 × n × 4 ÷ t：和向量加法一样', why: '向量加法读两排、写一排；向量缩放只读一排、写一排。字节数要数这份活自己读写了什么。' },
    ],
  },
]
</script>

# 1-11 测一测有多快

<div class="tm-hello">
  <Mascot class="tm-hello__art" :size="64" />
  <p class="tm-hello__line">改完了，真的变快了吗？先学会看表。</p>
</div>

第 {{ COALESCING.code }} 关少搬了车，第 {{ PREV.code }} 关少排了队。改完都说变快了，快了多少，得量一量。

量 GPU 干活，用的是 CPU 的时钟：启动那一行前后各看一眼表，两次一减就是用时。这样量，有两个坑。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

先识破三份报告，看懂表为什么停早了、第一次为什么最慢；再算出向量加法的有效带宽，最后用自己的计时代码量一量求和。

</Mission>

## 热身：哪份报告可信？

第 {{ COALESCING.code }} 关把向量加法从「每人连着算 4 个」改成「挨着拿」，搬的车少到 1/4。三个同学各量了一次两版，交来三份报告（单位是模拟器的周期）：

| 报告 | 改前 | 改后 | 结论 |
| --- | --- | --- | --- |
| 甲 | {{ A[0] }} | {{ A[1] }} | {{ SAY[0] }} |
| 乙 | {{ B[0] }} | {{ B[1] }} | {{ SAY[1] }} |
| 丙 | {{ C[0] }} | {{ C[1] }} | {{ SAY[2] }} |

三个人量的是同样两份工作单，用的是同一个模拟器。

<Predict :stage="S" id="tm-p-reports" question="哪一份报告可信？" :options="pReports">

下面三段探索，把三份报告一份一份重演。

</Predict>

## 探索一：表停在哪

启动那一行只把工作单交给 GPU，交完，CPU 马上往下走。甲就是在这时看的表。

下面的计时台把两版各量一次。上面是计时代码，中间是 CPU、GPU 两条时间线，「表」那一行是两次看表之间的那一段。

<ClockLab variant="sync" />

启动是异步的：工作单交出去，CPU 就往下走，不等 GPU。要量 GPU 干活的时间，再看表之前得先同步。

## 探索二：第一次最慢

乙停表前同步了，可他一开头就量，先量的是改前。程序里第一次启动 kernel，启动那一行先做一次准备，只做这一次。模拟器里这次准备是 {{ FIRST_LAUNCH_CYCLES }} 个周期（设定值）。

<ClockLab variant="warmup" />

准备落在谁头上，谁就显得慢，乙的「快了 {{ decimal(B[0] / B[1]) }} 倍」里有一大半是它。先空跑一次，等它算完再计时，准备就挪到了计时外面。

## 探索三：算出有效带宽

用时量准了，还要换成能和别的 kernel 比的数：有效带宽 = 这份活该读写的字节数 ÷ 用时。

向量加法每道读 a[i]、b[i]，写 c[i]，一个 float 是 4 字节。字节数怎么数，下面换着数一数。

<BandwidthLab />

a、b 从显存读进来，c 写回显存，一共 3 × {{ ADD_N }} × 4 = {{ ADD_TOTAL_BYTES }} 字节。车里白搬的不算：有效带宽看的是该搬的那些，搬得有多快。

拿甲量到的 {{ FAKE.cycles }} 个周期来算：{{ ADD_TOTAL_BYTES }} ÷ {{ FAKE.cycles }} = {{ FAKE.bandwidth }} 字节/周期，是模拟器上限的 {{ FAKE.overCap }} 倍。模拟器里一车 {{ LINE_BYTES }} 字节要 {{ LINE_CYCLES }} 个周期，算出来超过上限，一定是量错了。

## 原理：异步启动、预热和有效带宽

可信的计时要做到两件事：先空跑一次，再看表之前同步。三份报告里，只有丙两件都做了。

<ConceptCard term="async-launch">

要等 GPU 算完，得专门写一行同步：HIP 风格是 `hipDeviceSynchronize()`，Python 风格是 `synchronize()`（第 {{ PANORAMA.code }} 关见过）。这里是 CPU 等 GPU，和第 {{ LDS_SYNC.code }} 关组里线程互相等齐的 `__syncthreads()` 不是一回事。

</ConceptCard>

<ConceptCard term="warmup">

模拟器里，程序第一次启动多花 {{ FIRST_LAUNCH_CYCLES }} 个周期做准备。空跑一次、等它算完，这笔开销就落在计时外面。

</ConceptCard>

<ConceptCard term="bandwidth" code="bytes / (t1 - t0)">

向量加法 n 个数，读 a、b，写 c：3 × n × 4 字节。真卡上用时按秒算，有效带宽写成 GB/s：字节数 ÷ 秒数 ÷ 10⁹。

</ConceptCard>

真程序里看表，读的是 CPU 的时钟。可信的计时写出来是这样：

<LangCode>
<template #hip>

```cpp
add<<<grid, 32>>>(d_a, d_b, d_c, n, s);  // 预热：先空跑一次
hipDeviceSynchronize();                  // 等它算完
auto t0 = std::chrono::steady_clock::now();
add<<<grid, 32>>>(d_a, d_b, d_c, n, s);  // 启动：交出工作单
hipDeviceSynchronize();                  // 等 GPU 算完再看表
auto t1 = std::chrono::steady_clock::now();
```

</template>
<template #python>

```python
add[grid, 32](d_a, d_b, d_c, n, s)  # 预热：先空跑一次
synchronize()                       # 等它算完
t0 = time.perf_counter()
add[grid, 32](d_a, d_b, d_c, n, s)  # 启动：交出工作单
synchronize()                       # 等 GPU 算完再看表
t1 = time.perf_counter()
```

</template>
</LangCode>

计时台的 `now()` 读的是周期数。真程序里读 CPU 的时钟：HIP 风格常用 C++ 的 `std::chrono::steady_clock`，Python 风格用 `time.perf_counter()`，两次读数一减，是按秒算的一段时间。

比喻的边界：送单、开门摆工具，都只说明先后。真卡上交出去的工作单排在队列里，按先后做；第一次要准备什么、在哪准备，要看运行时和驱动。

<DeepDive title="出处：异步启动、同步、预热和有效带宽">

- HIP 文档：kernel 是异步启动的，GPU 算的时候，CPU 可以接着执行别的代码（[Concurrent execution between host and device](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_runtime_api/asynchronous.html#concurrent-execution-between-host-and-device)）。`hipDeviceSynchronize()` 让 CPU 等着，直到当前设备上所有队列里的活都做完（[Device management](https://rocm.docs.amd.com/projects/HIP/en/latest/reference/hip_runtime_api/modules/device_management.html#_CPPv420hipDeviceSynchronizev)）。
- PyTorch 文档：GPU 上的操作默认是异步的，不同步就计时，量不准，要先调用 `torch.cuda.synchronize()`（[Asynchronous execution](https://docs.pytorch.org/docs/stable/notes/cuda.html#asynchronous-execution)）。ROCm 版的 PyTorch 也用 `torch.cuda` 这套接口（[HIP (ROCm) semantics](https://docs.pytorch.org/docs/stable/notes/hip.html#hip-interfaces-reuse-the-cuda-interfaces)）。
- 第一次为什么慢：HIP 运行时在第一次调用 HIP API 时才初始化（[Initialize the HIP runtime](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_runtime_api/initialization.html#initialize-the-hip-runtime)）；HIP 默认等到第一次启动 kernel，才把 GPU 代码装进去（[ROCgdb 手册：AMD GPU Restrictions](https://rocm.docs.amd.com/projects/ROCgdb/en/latest/ROCgdb/gdb/doc/gdb/AMD-GPU.html#AMD-GPU-Restrictions)）。PyTorch 的计时工具 `torch.utils.benchmark.Timer` 会先预热，因为 PyTorch 有些东西用到时才初始化（[Benchmark Utils](https://docs.pytorch.org/docs/stable/benchmark_utils.html#torch.utils.benchmark.Timer)）。
- 有效带宽：AMD 的 ROCm 博客把它写成「理论上要读的字节 + 要写的字节」÷ kernel 的平均用时，并说明这样数没管访存粒度、当缓存无限大，算出来的字节是真正搬运量的下限（[Laplacian part 1 的 Performance 一节](https://rocm.blogs.amd.com/high-performance-computing/finite-difference/laplacian-part1/README.html#performance)）。
- Python 的 `time.perf_counter()` 是量一小段时间用的时钟，只有两次读数的差有意义（[time.perf_counter](https://docs.python.org/3/library/time.html#time.perf_counter)）。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 时间都按模拟器的周期数算，CPU 和 GPU 共用一个时钟。真程序里，CPU 的时钟读出来是秒。
- 交出工作单 {{ LAUNCH_CYCLES }} 个周期、第一次的准备 {{ FIRST_LAUNCH_CYCLES }} 个周期都是设定值，只为让几种量法的差别一眼看得出来。真卡上启动一次要多久、第一次多花多少、花在 CPU 还是 GPU 上，[待实测]。
- GPU 上算多少个周期，是 L4 示意计时照工作单估的：所有 wave 的活加起来，一条 SIMD 一刻不停地算。真卡上很多条 SIMD 一起算（第 {{ PANORAMA.code }} 关数过），用时、带宽都不是这个数。
- 同样的代码，模拟器每次量到的数都一样。真卡上每次都有点不同，要多量几次再报；怎么报，铸造城第 {{ TRUSTED.code }} 关「{{ TRUSTED.title }}」在真卡上讲。
- 上限 {{ BANDWIDTH_CAP }} 字节/周期只在模拟器里成立：模拟器没有缓存，每次读写都去显存搬车。真卡上数据装得进缓存时，算出来的有效带宽可能超过显存的标称带宽（旧版第 5 章 5.5.3 量到过）。
- 真卡上数组很小时，启动、提交的开销可能成了大头（旧版第 4 章 4.4.3）。所以在真卡上测带宽，数组要大得多，比如 2²⁴ 个数。

</DeepDive>

## 挑战：量一量求和

第 {{ PREV.code }} 关结尾问过：轮数少了、队排短了，真的变快了吗？现在量一量。

改前，每个线程都把自己那一格原子加进 out[0]，排 128 次队；改后，先在货架上搭树，每组只派线程 0 原子加一次。同一份计时代码把两版各量一次，再算出改后的有效带宽。

这是星级挑战：停表前同步，拿第一颗星；再加上预热，两版都量准，拿第二颗；再数对求和读写的字节，算出改后的有效带宽，拿第三颗。没过不扣分，没过两次以后会出现提示。

<TimingBench />

## 支线：如果让 Agent 来做

Agent 调参，靠的是工具交回来的数（第 {{ COALESCING.code }} 关的支线见过）。它没法怀疑工具：计时工具量错了，它就照着错的数挑。

<AgentTimer />

给 Agent 的计时工具，也要先预热、停表前同步。第 {{ MEET_AGENT.code }} 关会正式认识 Agent。

## 你现在能……

- 说出为什么要等 GPU 算完再看表：启动是异步的，CPU 不等 GPU
- 先空跑一次再计时，看出没同步、没预热的报告错在哪
- 数出一份 kernel 该读写的字节，用「字节数 ÷ 用时」算出有效带宽

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：会量时间了。下一关看看：一个 wave 等数据的时候，SIMD 在干什么？派更多的 wave，等待能不能藏起来？

- 回到基础：[旧版第 4 章 4.4.2 从时间算出有效带宽](/part0-intro/chapter4/#_4-4-2-从时间算出有效带宽)，同样是向量加法，从「读两次、写一次」推出 12N 字节，再除以量到的时间。
- 深入一层：[旧版第 5 章 5.3 从准备数据到记录一个样本](/part1-profiling/chapter5/#_5-3-从准备数据到记录一个样本)，固定输入、先预热，再用一对 GPU 事件记下多次时间。

<EvidenceCard kind="simulated">这一关的用时都是模拟器的周期数，不是实测。kernel 在 GPU 上算多少个周期，是 L4 示意计时照工作单的事件流估的；交出工作单 {{ LAUNCH_CYCLES }} 个周期、第一次启动的准备 {{ FIRST_LAUNCH_CYCLES }} 个周期是设定值，只为让几种量法的差别一眼看得出来。有效带宽的上限 {{ BANDWIDTH_CAP }} 字节/周期，由一车 {{ LINE_BYTES }} 字节、{{ LINE_CYCLES }} 个周期这两个示意值算出。真卡上启动一次要多久、第一次多花多少、向量加法的有效带宽 [待实测]，实验档案馆里还没有这一关的记录。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-10 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.tm-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.tm-hello__art {
  flex: none;
}

.tm-hello__line {
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
.hg-shell.is-plain .tm-hello__art {
  display: none;
}

.hg-shell.is-plain .tm-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
