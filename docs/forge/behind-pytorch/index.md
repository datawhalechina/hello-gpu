---
layout: stage
stage: forge-behind-pytorch
newTerms: [profiler, trace, launch-overhead]
evidence: simulated
description: torch 的一行代码启动了哪些 kernel？哪个最耗时？用 profiler 把一行 PyTorch 记成 trace，看 CPU 怎样一个个交出 kernel、GPU 什么时候在算、什么时候在等；再数一数分步写的 GELU 读写了几遍显存。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES, formatParam } from '@course/hardware.ts'
import { githubUrl } from '@course/lab.ts'
import { SPEC_PEAK, countText, msText, powerText, sig } from '../roofline/roofline.ts'
import { bytesText } from '../trusted-timing/timing.ts'
import PassCount from './scenes/PassCount.vue'
import TraceBrowser from './scenes/TraceBrowser.vue'
import TraceImport from './scenes/TraceImport.vue'
import { GELU_STEPS, MLP_SHAPE, MLP_SMALL_SHAPE, SAMPLE_COST, STAGE_ID, STEPS_N, STEPS_SMALL_N, fusePlan, mlpFloor, passTotals } from './trace.ts'

const S = STAGE_ID
const GOAL = '看清一行 PyTorch 在 GPU 上启动了哪些 kernel、哪个最耗时，再把分步写的 GELU 改成少启动几个 kernel 的写法。'
// 星级标准从大纲的 lab.stars 读（06 第 7 节）：任务卡、LabCard 判星和 Notebook 用的是同一份规则。
const STARS = stageById(S).lab.stars.map((star) => star.text)

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const FUSION = stageById('forge-fusion')
const TIMING = stageById('forge-trusted-timing')
const COUNTERS = stageById('trial-counters-trace')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
const BW = formatParam(HW.params.memoryBandwidth)
const FP32 = formatParam(HW.params.peakFp32)
const LAB_PY = githubUrl('notebooks/common/src/hello_gpu/lab.py')

// 热身：按本书那张卡的标称峰值（2-4 的屋顶线），F.gelu(x @ w + b) 三步各自最快多久（trace.ts，示意数据也用它）。
const MLP = mlpFloor(MLP_SHAPE, SPEC_PEAK)
const MM_MS = msText(MLP.mm.us / 1000)
const MM_TIMES = sig(MLP.mm.us / MLP.gelu.us)
const ADD_MS = msText(MLP.add.us / 1000)
const GELU_MS = msText(MLP.gelu.us / 1000)
const SIZE = `${MLP_SHAPE.m}×${MLP_SHAPE.k}`
const SMALL = `${MLP_SMALL_SHAPE.m}×${MLP_SMALL_SHAPE.k} 乘 ${MLP_SMALL_SHAPE.k}×${MLP_SMALL_SHAPE.n}`

// 探索三和挑战：分步写法（一步一个 kernel）和一个 kernel 算完的读写遍数，按算法数。
const STEP_COUNT = GELU_STEPS.length
const STEPS = passTotals(fusePlan(STEP_COUNT))
const FUSED = passTotals(fusePlan(1))
const BIG = powerText(Math.log2(STEPS_N))
const ARRAY = bytesText(4 * STEPS_N)
const C = SAMPLE_COST

const qSlowest = `x、w 都是 ${SIZE} 的 FP32 矩阵。F.gelu(x @ w + b) 在 GPU 上的三步里，哪一步最耗时？`
const pSlowest = [
  { label: '矩阵乘 x @ w', correct: true, why: `按 ${HW.name} 的标称峰值算（${PREV.code} 的屋顶线）：矩阵乘做 ${countText(MLP.mm.flops)}次浮点运算，最快 ${MM_MS}；加偏置、GELU 各搬约 ${bytesText(MLP.gelu.bytes)}，最快各 ${GELU_MS}。` },
  { label: '加偏置 + b', why: `加偏置读一遍 x @ w 的结果和 b、写一遍结果，约 ${bytesText(MLP.add.bytes)}，按 ${BW} 最快 ${ADD_MS}。矩阵乘最快也要 ${MM_MS}。` },
  { label: 'GELU（公式最长）', why: `GELU 每个数多算几步，可它归带宽管：读一遍、写一遍，约 ${bytesText(MLP.gelu.bytes)}，最快 ${GELU_MS}。矩阵乘的每个结果要做 ${2 * MLP_SHAPE.k} 次浮点运算。` },
  { label: '三步差不多', why: `差得远：按标称峰值，矩阵乘最快 ${MM_MS}，是 GELU（${GELU_MS}）的 ${sig(MLP.mm.us / MLP.gelu.us)} 倍。` },
]

const checkpoint = [
  {
    q: `一行 y = torch.relu(x) * 2 + 1，x 是 ${BIG} 个 FP32 数。trace 里有 3 个 kernel，GPU 忙的比例 99%。想让这一行更快，先做哪件事？`,
    options: [
      { label: '把三步合进一个 kernel', correct: true, why: 'GPU 一直在忙，时间花在 kernel 里。三个逐元素 kernel 一共读 3 遍、写 3 遍和 x 一样大的数组；合成一个只要各 1 遍，归带宽管的活少搬三分之二。' },
      { label: '让 CPU 交活更快，比如改用 C++ 调用', why: 'GPU 忙的比例 99%：CPU 早就交完了，kernel 在队列里排着。CPU 交得再快，GPU 上的活一点没少。' },
      { label: '换一张算力更高的卡', why: `逐元素运算在 ${PREV.code} 屋顶线的拐点左边，归带宽管：算力再高，搬数据的时间也不变。` },
    ],
  },
  {
    q: '一个训练步里调用了 200 个很小的 kernel，每个在 GPU 上只跑几微秒。trace 里 GPU 忙的比例只有 15%。哪个改动最可能让这一步变快？',
    options: [
      { label: '把每个 kernel 优化得更快', why: 'GPU 只忙 15%：kernel 再快，GPU 还是在等 CPU 交下一个，省下的只是那 15% 里的一部分。' },
      { label: '能合的 kernel 合起来，少启动几次', correct: true, why: 'GPU 大部分时间空着，时间花在启动的开销上。每少启动一个 kernel，CPU 就少走一遍 Python、算子分派和运行时调用。' },
      { label: '把数据换成 FP16，少搬一半字节', why: '数据这么小，时间不在搬数据上。字节少了一半，要启动的 kernel 一个也没少。' },
    ],
  },
  {
    q: 'CPU 上的 hipLaunchKernel 在 20 µs 返回，它交出去的 kernel 在 GPU 上 900 µs 才开始；同一条队列上，前一个 kernel 正好在 900 µs 算完。中间这 880 µs 是怎么回事？',
    options: [
      { label: 'GPU 空着，在等 CPU 交活', why: 'CPU 在 20 µs 就交出去了，900 µs 以前 GPU 在算前一个 kernel。GPU 空等时，trace 上是前一个 kernel 早早算完，下一个的启动调用很晚才返回。' },
      { label: 'profiler 把时间记错了', why: 'CPU 和 GPU 的时钟由 profiler 对齐过。交出去以后排很久的队很常见：数据大时，CPU 交活比 GPU 算得快得多。' },
      { label: '它在 GPU 的队列里排着，等前一个算完', correct: true, why: 'CPU 交出去就接着往下走，不等 GPU（异步启动）。这 880 µs 里 GPU 一直在算前一个 kernel，排队没有浪费 GPU。' },
    ],
  },
]
</script>

# 2-5 一行 PyTorch 背后

<div class="bp-hello">
  <Mascot class="bp-hello__art" :size="64" />
  <p class="bp-hello__line">一行 PyTorch，GPU 上到底跑了几个 kernel？</p>
</div>

{{ PREV.code }} 关的屋顶线回答一个算子最快多快。一行 PyTorch 往往不止一个算子，时间花在哪个 kernel 上，得记下来看。这一关用 [profiler](/handbook/#profiler) 把一行代码记成 [trace](/handbook/#trace)，顺着它找出拖慢这一行的两件事。

这一关只用 PyTorch 自带的算子和 profiler，不编译 kernel，两条路线做的一样。`hg.check_env()` 的前三项是 ✓ 就能做。没有 GPU 也能读完：两个 trace 浏览器先用示意数据，挑战另有观摩模式（这一关的记录还在整理）。

<Mission :stage="S" :goal="GOAL" :stars="STARS">

三颗星都在实验室 Notebook 里拿：★1 看改写的 GELU 算得对不对；★2、★3 用 trace 比两种写法，数据大时比 GPU 上的时间，数据小时比从开始到算完。都只和同一张卡上的分步写法比。

</Mission>

## 热身：哪一步最耗时？

Notebook 动手第一段记的是神经网络里常见的一层：矩阵乘、加偏置、过 GELU，写成一行 `F.gelu(x @ w + b)`。x、w 都是 {{ SIZE }} 的矩阵，b 有 {{ MLP_SHAPE.n }} 个数。

<Predict :stage="S" id="bp-p-slowest" :question="qSlowest" :options="pSlowest">

探索一的 trace 把三个 kernel 各跑了多久摆在一起。

</Predict>

## 探索一：一行启动了哪些 kernel

一行代码启动了哪些 kernel，profiler 记得下来。它在 CPU 上记每个 PyTorch 算子，和每次 HIP 运行时调用（例如启动 kernel 的 `hipLaunchKernel`）；在 GPU 上记每个 kernel。按时间排好，就是一份 trace。

下面是 `F.gelu(x @ w + b)` 的 trace。点 GPU 那条道上的一段，或者表里的一行，看它是哪个算子启动的：

<TraceBrowser :prefer="['mlp']" title="F.gelu(x @ w + b) 的 trace" />

GPU 上的时间大多花在矩阵乘的 kernel 上：热身按屋顶线算过，它最快也要 GELU 的 {{ MM_TIMES }} 倍。它的名字不是 `aten::mm`：矩阵乘的 kernel 来自 ROCm 的矩阵乘库，名字也是库起的。Notebook「一行启动了哪些 kernel」一段先看 `torch.profiler` 原样打印的表，再用 `hg.trace` 记出这样的时间线。

## 探索二：启动的开销

数据小的时候，GPU 大部分时间在等 CPU。CPU 上每个算子都要走一遍 Python、PyTorch 的算子分派和 HIP 运行时，才把 kernel 交给 GPU。这段时间叫[启动的开销](/handbook/#launch-overhead)（launch overhead），和 kernel 算多少无关。

同一行换成 {{ SMALL }}，每个 kernel 一下就算完。看 GPU 那条道上的空隙，再切到 mlp 比一比：

<TraceBrowser :prefer="['mlp_small', 'mlp']" title="同一行，数据换小" />

数据大时，CPU 很快交完这一行，kernel 在 GPU 的队列里排着，启动的开销藏在前一个 kernel 的时间里（[异步启动](/handbook/#async-launch)）。数据小时，从开始到算完差不多就是 CPU 交活的时间：要快，就得少启动几个 kernel。点表里的一行，看它是在排队，还是 GPU 空着等它。

Notebook 动手的三段各存一份 trace：mlp、mlp_small、steps。导入下面，探索一、二的浏览器就换成你这张卡的数据：

<div id="my-trace"><TraceImport /></div>

## 探索三：反复读写显存

照公式一步一步写的 GELU，每一步都把整个数组读进来、写回去。GELU 的 tanh 近似有 {{ STEP_COUNT }} 次运算，写成 PyTorch 是 {{ STEP_COUNT }} 个算子、{{ STEP_COUNT }} 个 kernel。每个 kernel 从显存读输入、把结果写回显存，下一步再读出来。

改一改合成几个 kernel，看读写的遍数怎么变：

<PassCount />

一步一个 kernel，要读 {{ STEPS.reads }} 遍、写 {{ STEPS.writes }} 遍和 x 一样大的数组（{{ ARRAY }}）；合进一个 kernel，只读 x、写 y 各一遍。这些逐元素运算都在 {{ PREV.code }} 屋顶线的拐点左边，归带宽管：遍数多几倍，耗时也差不多多几倍。Notebook「反复读写显存」一段记下分步写法的 trace；上面的浏览器切到 steps，看 {{ STEP_COUNT }} 个 kernel 各跑了多久。

## 原理：一行的时间花在哪，三步看出来

一行 PyTorch 慢在哪，三步看出来：

1. 记：用 profiler 记下这一行，CPU 上的算子、启动调用和 GPU 上的 kernel 按时间排成 trace。
2. 看 GPU 忙的比例：比例高，时间在 kernel 里，找最耗时的那个；比例低，GPU 在等 CPU，时间花在启动的开销上。
3. 改：GPU 一直在忙，就少读写几遍显存；GPU 常常空着，就少启动几个 kernel。几步合成一个 kernel，两件事一起省。

<ConceptCard term="profiler" code="torch.profiler.profile(activities=[...])">

activities 里写 CPU，记 PyTorch 算子和运行时调用；写 CUDA，记 GPU 上的 kernel，ROCm 版 PyTorch 沿用了 CUDA 这个名字。记账本身也花时间：CPU 上的时间比不开 profiler 时长一些，GPU 上 kernel 的时间不受影响。

</ConceptCard>

<ConceptCard term="trace" code="hg.trace({名字: 一行代码})">

trace 里的时间都从这一行开始算起，单位是微秒。同一个算子启动的运行时调用和 kernel，在 trace 里连得起来：kernel 表的「算子」一列就是顺着它找的。

</ConceptCard>

<ConceptCard term="launch-overhead" code="hipLaunchKernel">

同一行代码，数据大时这段开销藏在 GPU 算前一个 kernel 的时间里，数据小时才露出来。省它的办法是少启动 kernel：几步合成一个，或者让 PyTorch 自己合（Notebook 练习里的 `torch.compile`）。

`hipLaunchKernel` 再往下，HIP 运行时把这次启动写成一个 AQL 包放进 GPU 的队列，再按门铃（doorbell）通知 GPU 来取；旧版[附录 C「KFD 的一次 dispatch」](/appendix/appendix-c-kfd-bare-metal/#kfd-的一次-dispatch-从-ioctl-到-doorbell)从这一层讲起。

</ConceptCard>

<DeepDive title="出处：hg.trace 怎么记一行">

- 每一行先调用一次预热，不记：第一次调用要加载 kernel、初始化矩阵乘库。再在 profiler 里记 5 遍，每遍之后等 GPU 算完，留下从开始到算完排在中间的那一遍（<a :href="LAB_PY">lab.py</a> 的 `trace`）。
- profiler 给每次运行时调用和它交出去的 GPU 事件记同一个编号（correlation id）。hg.trace 顺着编号找到启动 kernel 的算子，再往上找到这一行直接调用的那个；找不到时，kernel 表里的「算子」是 —。
- trace 存成 JSON，放在 artifact 目录的 traces/ 下；格式写在[实验档案馆](/lab/)的 schema 里（trace 一项）。本页的浏览器读的就是这份文件，档案馆收的也是它。

</DeepDive>

<DeepDive title="trace 里的时间能信几分">

- GPU 上 kernel 的开始和结束由 GPU 记，CPU 上的事件由 CPU 记，两边的时钟由 profiler 对齐。偶尔差一点点，GPU 上的事件比这一行开始得还早，时间线就从更早的那一刻画起。
- profiler 记账要花时间，CPU 那几条道比平时长一些：数据小时量到的「从开始到算完」也偏长。两种写法用同一把尺子量，比值仍然能比。
- 一次只记 5 遍，偶尔碰上别的程序抢 CPU。拿不准时多记几次，看数变不变；要更准的耗时，用 {{ TIMING.code }} 关的可信计时（`hg.bench`）。

</DeepDive>

<DeepDive title="示意数据怎么来的">

- 没导入你的 trace、档案馆也没有这一关的记录时，两个浏览器用示意数据：mlp、mlp_small、steps、steps_small 四行，按 Notebook 里的形状排出来，不是实测。
- GPU 上每个 kernel 的时长，按 {{ HW.name }} 的标称峰值（显存带宽 {{ BW }}、FP32 算力 {{ FP32 }}）算最快多久，同热身。再短也按 {{ C.kernelMin }} µs 算。
- CPU 上的开销是示意值：一个算子 {{ C.op }} µs，两个算子之间隔 {{ C.gap }} µs；算子开始 {{ C.launchAt }} µs 后调用 `hipLaunchKernel`，调用 {{ C.launch }} µs；GPU 空着时，调用开始 {{ C.gpuDelay }} µs 后 kernel 才开始算。{{ HW.name }} 上实际多少 [待实测]。
- kernel 的名字也是示意的。实验档案馆有了这一关的真实记录以后，浏览器自动换成那条记录。

</DeepDive>

## 挑战：在你的卡上交成绩

挑战在实验室 Notebook 里做，两件事，三颗星和任务卡上写的一样。

**少启动几个 kernel**：`mine(x)` 要算出和 `gelu_steps(x)` 一样的结果，启动的 kernel 更少。补上标了 TODO 的那一行：

```python
def mine(x):
    return ...  # TODO：和 gelu_steps 结果一样，kernel 更少

checks = hg.check(mine, gelu_steps, [1000, (64, 1000), (3, 333, 77)])
```

`hg.check` 拿三种形状的随机数，比 `mine` 和 `gelu_steps` 的结果，都 ✓ 才拿 ★1。提示：探索一那一行里的 `F.gelu` 有个参数，用 `help(F.gelu)` 看一看。

**数据大、数据小各比一次**：`hg.trace` 把两种写法在 {{ BIG }} 个数和 {{ STEPS_SMALL_N }} 个数上各记一遍。★2 比数据大时 GPU 上的时间，★3 比数据小时从开始到算完：

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

数据大时，比的是读写显存的遍数（探索三）；数据小时，比的是启动了几次（探索二）。按读写遍数估，数据大时最多差 {{ STEPS.passes / FUSED.passes }} 倍（{{ STEPS.passes }} 遍对 {{ FUSED.passes }} 遍）；按启动次数估，数据小时最多差 {{ STEP_COUNT }} 倍（{{ STEP_COUNT }} 次对 1 次）。{{ HW.name }} 上实际差几倍 [待实测]。

<LabCard />

## 你现在能……

- 用 profiler 记下一行 PyTorch 的 trace，说出它启动了哪些 kernel、各是哪个算子启动的、哪个最耗时
- 从 GPU 忙的比例判断时间花在 kernel 里还是启动的开销上，说清数据大小为什么会改变它
- 数出分步写法读写显存的遍数，说清少启动几个 kernel 为什么能同时省下启动的开销和读写的遍数

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：这一关用的都是 PyTorch 现成的 kernel；下一关回到自己写 kernel，看写法和启动配置怎样决定硬件用不用得满。把几步合成一个 kernel 自己写，在 {{ FUSION.code }}「{{ FUSION.title }}」。

- 回到基础：[旧版第 5 章 5.1 先确定计时的起点和终点](/part1-profiling/chapter5/#_5-1-先确定计时的起点和终点)：CPU 把任务交进队列就返回，GPU 什么时候算完要另外等。
- 深入一层：[旧版第 6 章 6.3 让 rocprofv3 记录 kernel 的执行](/part1-profiling/chapter6/#_6-3-让-rocprofv3-记录-kernel-的执行)：不经过 PyTorch，用 ROCm 的工具直接记下 kernel；试炼场的 {{ COUNTERS.code }}「{{ COUNTERS.title }}」再往下看硬件计数器。

<EvidenceCard kind="simulated">这一关的数都不是实测。热身按 {{ HW.name }} 的标称峰值（显存带宽 {{ BW }}、FP32 算力 {{ FP32 }}，出自 AMD 产品页）和工作量公式算最快多久。没导入你的 trace 时，两个 trace 浏览器用示意数据：kernel 的时长按同一组标称峰值算，CPU 上的开销是几个示意值（见「示意数据怎么来的」）。探索三的遍数按算法数，耗时按标称带宽算。导入的 trace 是你在 Notebook 里记的，只存在你的浏览器里。真卡上的 trace、两种写法差几倍 [待实测]，实验档案馆里还没有这一关的记录。</EvidenceCard>

<style scoped>
/* 小核开场：同新手村各关和 2-1 到 2-4 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.bp-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.bp-hello__art {
  flex: none;
}

.bp-hello__line {
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
.hg-shell.is-plain .bp-hello__art {
  display: none;
}

.hg-shell.is-plain .bp-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
