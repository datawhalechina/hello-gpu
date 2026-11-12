---
layout: stage
stage: forge-roofline
newTerms: [arithmetic-intensity, roofline, ridge-point]
evidence: mixed
description: 这张卡最多能多快？用拷贝测试量峰值带宽，用 FMA 测试量峰值算力，把两个数画成屋顶线；再看加法和矩阵乘落在拐点哪一边、归谁管，离屋顶还有多远。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES, formatParam, sourceOf } from '@course/hardware.ts'
import { githubUrl } from '@course/lab.ts'
import { bytesText } from '../trusted-timing/timing.ts'
import CopySize from './scenes/CopySize.vue'
import FmaBalance from './scenes/FmaBalance.vue'
import RooflineLab from './scenes/RooflineLab.vue'
import {
  ADD_N, COPY_EXPONENTS, COPY_OVERHEAD_MS, FMA_TEST, MM_SIZE, SPEC_PEAK, STAGE_ID,
  addWork, balance, copyCase, countText, fmaWork, intensityOf, mmIntensity, msText, powerText, ridgeOf, sig,
} from './roofline.ts'

const S = STAGE_ID
const GOAL = '在你的 GPU 上测出峰值带宽和峰值算力，画出它的屋顶线，再把加法和矩阵乘分别放到拐点的两边。'
// 星级标准从大纲的 lab.stars 读（06 第 7 节）：任务卡、LabCard 判星和 Notebook 用的是同一份规则。
const STARS = stageById(S).lab.stars.map((star) => star.text)

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const YOUR_GPU = stageById('forge-your-gpu')
const FUSION = stageById('forge-fusion')
const MATRIX_CORES = stageById('trial-gemm-matrix-cores')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
const BW = formatParam(HW.params.memoryBandwidth)
const FP32 = formatParam(HW.params.peakFp32)
const FP16_MATRIX = formatParam(HW.params.peakFp16Matrix)
const MATRIX_RATIO = Math.round(HW.params.peakFp16Matrix.value / HW.params.peakFp32.value)
const PRODUCT_PAGE = sourceOf(HW.params.peakFp32)?.url
const RIDGE = sig(ridgeOf(SPEC_PEAK))
const LAB_PY = githubUrl('notebooks/common/src/hello_gpu/lab.py')
// 产品页的 FP32 算力怎么来的：每个 lane 每个时钟两条 FMA（双发射），一条 FMA 记 2 次浮点运算。
const SIMDS = HW.params.simdsPerCu.value
const LANES = HW.params.lanesPerSimd.value
const BOOST = formatParam(HW.params.boostClock)
const DUAL_TFLOPS = sig((HW.params.cuCount.value * SIMDS * LANES * 2 * 2 * HW.params.boostClock.value) / 1e6)
// 实验档案馆的参考记录在这张卡上测（R-01），硬件参数同样从 hardware.json 读。
const REF = HARDWARE_DEVICES['ai-pro-r9700']
const REF_BW = formatParam(REF.params.memoryBandwidth)
const REF_FP32 = formatParam(REF.params.peakFp32)
const REF_PAGE = sourceOf(REF.params.peakFp32)?.url

// 正文里按标称峰值算的数（roofline.ts），和三段探索同一套算法。
const N26 = powerText(26)
const ADD = balance(SPEC_PEAK, addWork(ADD_N))
const READ_ONLY = balance(SPEC_PEAK, { flops: ADD_N, bytes: 8 * ADD_N })
const ADD_BYTES = bytesText(ADD.work.bytes)
const READ_BYTES = bytesText(READ_ONLY.work.bytes)
const ADD_COUNT = countText(ADD_N)
const BIG_COPY = copyCase(COPY_EXPONENTS[COPY_EXPONENTS.length - 1], SPEC_PEAK)
const OVERHEAD = msText(COPY_OVERHEAD_MS)
const THREADS = powerText(Math.log2(FMA_TEST.threads))
const FMA_COUNT = FMA_TEST.chains * FMA_TEST.iterations
const FMA_AI = sig(intensityOf(fmaWork(FMA_COUNT)))
const MM_AI = sig(mmIntensity(MM_SIZE))

const qAdd = `按 ${HW.name} 的标称峰值，${N26} 个 FP32 数的加法最快要多久？`
const pAdd = [
  { label: `约 ${msText(ADD.computeMs)}`, why: `这是按峰值算力做 ${ADD_COUNT}次加法的时间。三个数组一共 ${ADD_BYTES}，都要在显存里读写一遍，搬数据比做加法慢得多。` },
  { label: `约 ${msText(READ_ONLY.ms)}`, why: `这只算了读 x、y 的 ${READ_BYTES}。结果 out 也要写回显存：三个数组一共 ${ADD_BYTES}。` },
  { label: `约 ${msText(ADD.ms)}`, correct: true, why: `三个数组一共 ${ADD_BYTES}，按 ${BW} 搬一遍要 ${msText(ADD.memoryMs)}；做加法只要 ${msText(ADD.computeMs)}。两件事同时进行，慢的那件说了算：加法卡在搬数据上。` },
  { label: '我不确定', why: '不确定也没关系，探索三把「慢的那件说了算」画成一张图。' },
]

const checkpoint = [
  {
    q: '一个 kernel 算 y = a·x + y（FP32，n 个数）：读 x、y，把结果写回 y，每个数做一次乘加。按算法数，它的算术强度是多少？',
    options: [
      { label: '1/12 FLOP/字节', why: '一次乘加是乘一次、加一次，记 2 次浮点运算：2n 次运算除以 12n 字节，是 1/6。' },
      { label: '1/6 FLOP/字节', correct: true, why: '读 x、y 各 4 字节，写回 y 4 字节，每个数一共 12 字节；一次乘加记 2 次浮点运算。1/6 离拐点还差得远，它归带宽管。' },
      { label: '1/4 FLOP/字节', why: '只数了读进来的 x、y。结果写回 y 也要搬：每个数一共 12 字节，不是 8 字节。' },
    ],
  },
  {
    q: '假设一张卡实测峰值带宽 500 GB/s、峰值算力 20 TFLOPS。一个 kernel 的算术强度是 10 FLOP/字节，实测 2 TFLOPS。它离屋顶多远，先从哪下手？',
    options: [
      { label: '占屋顶 10%，归算力管：先让计算更快', why: '拐点是 20 TFLOPS ÷ 500 GB/s = 40 FLOP/字节，10 在它左边。头顶的屋顶是 500 GB/s × 10 = 5 TFLOPS，不是 20 TFLOPS。' },
      { label: '占屋顶 40%，归带宽管：先查数据搬得好不好', correct: true, why: '头顶的屋顶是 500 GB/s × 10 = 5 TFLOPS，2 ÷ 5 = 40%。它在拐点（40 FLOP/字节）左边：先查访存，合没合并、有没有多搬的字节。' },
      { label: '占屋顶 40%，归算力管：先换更快的指令', why: '40% 算对了。归谁管看横坐标：10 比拐点 40 小，归带宽管；算得再快，数据搬不过来也没用。' },
    ],
  },
  {
    q: '模型里连着三个逐元素运算：乘 2、加 1、再乘 3，各是一个 kernel，每个都读一个 FP32 数组、写一个。把三个合进一个 kernel（读一次、写一次，中间做三次运算），屋顶线上的点怎么动？',
    options: [
      { label: '往右挪，算术强度变成 3 倍，还在拐点左边', correct: true, why: `单独一个 kernel 每个数做 1 次运算、搬 8 字节，强度 1/8；合起来做 3 次、搬 8 字节，强度 3/8。它仍归带宽管，可要搬的字节只剩三分之一。铸造城的 ${FUSION.code}「${FUSION.title}」专讲这件事。` },
      { label: '只往上挪，算术强度不变：运算没变，只是更快了', why: '运算总数没变，搬的字节变成三分之一，每搬 1 字节做的运算多了：横坐标变成 3 倍。' },
      { label: '挪到拐点右边，改归算力管', why: '3/8 FLOP/字节离拐点（几十 FLOP/字节）还差得远。合并几个逐元素运算，也还在左边。' },
    ],
  },
]
</script>

# 2-4 性能的天花板

<div class="rf-hello">
  <Mascot class="rf-hello__art" :size="64" />
  <p class="rf-hello__line">测准了，再问一句：这张卡最多能多快？</p>
</div>

{{ PREV.code }} 关把耗时测准了。可一个耗时是快是慢，它自己说不出来，得先知道这张卡最多能多快。这一关量出两个上限，画成一张图，看 kernel 离上限还有多远。

这一关用 PyTorch 自带的拷贝、加法和矩阵乘，外加 hg 里一个测算力的小 kernel，两条路线做的一样。那个 kernel 要现场编译：`hg.check_env()` 里「HIP 编译工具」那一项，两条路线都要是 ✓。环境在 {{ YOUR_GPU.code }} 关准备好了；没有 GPU 也能读完，挑战另有观摩模式。

<Mission :stage="S" :goal="GOAL" :stars="STARS">

三颗星都在实验室 Notebook 里拿：★1 看矩阵乘的工作量数得对不对；★2、★3 看你挑的长度，加法离带宽的屋顶多近，矩阵乘过没过拐点。都只和你自己这张卡测的峰值比。

</Mission>

## 热身：加法最快要多久？

一张卡有两个上限：显存一秒最多搬多少字节，计算单元一秒最多做多少次浮点运算。{{ HW.name }} 的产品页写着这两个标称峰值：显存带宽 {{ BW }}，FP32 算力 {{ FP32 }}。

拿 {{ PREV.code }} 关的加法来算：{{ N26 }} 个数，读 x、y，写 out，每个数 4 字节。

<Predict :stage="S" id="rf-p-add" :question="qAdd" :options="pAdd">

探索三把「慢的那件说了算」画成一张图。

</Predict>

## 探索一：峰值带宽（拷贝测试）

拷贝要够大，量到的才是显存搬数据的速度。拷贝测试把一块缓冲区原样拷到另一块，不做计算，每个字节读一次、写一次；[有效带宽](/handbook/#bandwidth)就是搬的字节数除以时间。

拷得太少，量到的大多是别的：每次拷贝都有启动这类固定开销，数据还可能装进缓存。换一换缓冲区的大小：

<CopySize />

{{ bytesText(BIG_COPY.bytes) }} 的拷贝一次搬 {{ bytesText(BIG_COPY.moved) }}，按 {{ BW }} 也要 {{ msText(BIG_COPY.transferMs) }}：固定开销摊得开，数据也远大于缓存。`hg.peak()` 拷的就是这么大。Notebook「动手」的「峰值带宽：拷贝测试」一段，在真卡上把 512 MiB 和 64 KiB 各拷一次。

## 探索二：峰值算力（FMA 测试）

每个线程算得够多，量到的才是算力。FMA（fused multiply-add）一条指令算 a × b + c，记 2 次浮点运算。FMA 测试让每个线程读两个数、写一个数，中间做很多次 FMA。

做得少，搬数据的时间盖过算的时间，量到的还是带宽。改一改每个线程做几次 FMA：

<FmaBalance />

`hg.peak()` 的 FMA 测试启动 {{ THREADS }} 个线程，每个做 {{ FMA_TEST.chains }} 条链、每条 {{ FMA_TEST.iterations }} 次，一共 {{ FMA_COUNT }} 次 FMA：每读写 1 字节，算约 {{ FMA_AI }} 次浮点运算。链和链互不相干，GPU 可以轮流算，不用干等上一次的结果。Notebook「峰值算力：FMA 测试」一段运行 `hg.peak()`，把两个测试各做一遍。

## 探索三：屋顶线

一个算子最快多快，要看它每搬 1 字节做几次浮点运算。这个比值叫[算术强度](/handbook/#arithmetic-intensity)（arithmetic intensity），单位 FLOP/字节：加法是 1/12，FMA 测试约 {{ FMA_AI }}。

算术强度低的算子，最快是峰值带宽 × 算术强度；高的，最快是峰值算力。两条上限拼起来像屋顶，叫[屋顶线](/handbook/#roofline)（roofline），斜坡和平顶交在[拐点](/handbook/#ridge-point)（ridge point）。拖动矩阵乘的点，看它归谁管：

<RooflineLab />

点在拐点左边，归带宽管：想更快，要么少搬字节，要么每个字节多算几次。在右边，归算力管：搬得再少，也快不过峰值算力。Notebook 里实测的点落在屋顶下面，离屋顶多远，就是还能快多少。

想看你这张卡的屋顶线：在 Notebook 里运行 `hg.peak()`，再运行 `hg.device_card()`，把它最后打印的导入码贴到下面。三段探索就换成你测的峰值。

<div id="gpu-card"><DeviceCard /></div>

Notebook「屋顶线」一段用 `hg.roofline` 把 {{ N26 }} 个数的加法和 {{ MM_SIZE }}×{{ MM_SIZE }} 的矩阵乘放上你的屋顶线，表里「归谁管」「占屋顶」两列，就是这里说的两件事。

## 原理：离上限多远，三步算出来

一个算子离这张卡的上限多远，三步算出来：

1. 数工作量：浮点运算次数，和按算法要搬的字节数。前者除以后者，是算术强度。
2. 找屋顶：算术强度为 I 的算子，最快是「峰值带宽 × I」和「峰值算力」里小的那个。I 比拐点小归带宽管，否则归算力管。
3. 比实测：实测算力除以这一点的屋顶，就是 `hg.roofline` 表里的「占屋顶」。

<ConceptCard term="arithmetic-intensity" code="flops / bytes_moved">

字节数按算法数：每个要用的数从显存读一次，每个结果写一次，不算缓存替你省下的趟数。{{ N26 }} 个数的加法做 {{ ADD_COUNT }}次加法、搬 {{ ADD_BYTES }}，强度 1/12；两个 {{ MM_SIZE }}×{{ MM_SIZE }} 的矩阵相乘，每搬 1 字节做约 {{ MM_AI }} 次。

</ConceptCard>

<ConceptCard term="roofline" code="hg.roofline(points)">

斜坡有多陡，由拷贝测试量的峰值带宽定；平顶有多高，由 FMA 测试量的峰值算力定。用实测的峰值画，是这张卡在当前软件上的屋顶；用产品页的标称峰值画，是规格上的屋顶。

</ConceptCard>

<ConceptCard term="ridge-point" code="roof.ridge">

拐点 = 峰值算力 ÷ 峰值带宽（TFLOPS 先换成 GFLOPS）。按 {{ HW.name }} 的标称值，{{ FP32 }} ÷ {{ BW }} ≈ {{ RIDGE }} FLOP/字节，加法的 1/12 离它差了三个数量级。挑战的 ★3 要矩阵乘的算术强度不小于你这张卡的拐点。

</ConceptCard>

<DeepDive title="出处：hg.peak() 怎么测两个峰值">

- 拷贝测试：两块各 512 MiB 的缓冲区之间 `copy_`（显存不到 4 GiB 时取显存的 1/8），先核对拷得对不对，再按 `hg.bench` 的协议计时、取中位数；带宽按读一遍、写一遍算，单位是十进制 GB/s（<a :href="LAB_PY">lab.py</a> 的 `_measure_peak`）。
- FMA 测试：一个 HIP kernel，{{ THREADS }} 个线程，每个 {{ FMA_TEST.chains }} 条链、每条 {{ FMA_TEST.iterations }} 次 `fmaf`，链写成累加 `s = fmaf(a, b, s)`。结果先和公式对一遍；编译的十几秒里 GPU 空着，先连着跑 0.2 秒等频率升上来，再计时、取中位数。第一次运行要编译它，所以 Triton 路线也要 HIP 编译工具。
- 两个峰值按卡缓存在 artifact 目录的 `lab/peak/` 下，后面的关卡直接读；`hg.peak(refresh=True)` 重新测。`hg.device_card()` 把缓存里的峰值写进导入码，本页的「我的 GPU 卡片」读的就是它。

</DeepDive>

<DeepDive title="标称峰值和实测峰值">

- 产品页上的两个数是规格上的峰值：显存带宽写作「Up to {{ BW }}」，FP32 向量算力 {{ FP32 }}（<a :href="PRODUCT_PAGE">{{ HW.name }} 产品页</a>）。
- 实测的峰值是这张卡在你的驱动、频率和测法下跑出来的。实验档案馆的参考记录在 {{ REF.name }} 上测：峰值带宽 579 GB/s，是它产品页上 {{ REF_BW }} 的九成；峰值算力 48.0 TFLOPS，和产品页的 {{ REF_FP32 }} 差不多（<a :href="REF_PAGE">{{ REF.name }} 产品页</a>）。
- 产品页的 FP32 算力按每个 lane 每个时钟两条 FMA 算：{{ HW.name }} 是 {{ HW.params.cuCount.value }} 个计算单元 × 每个 {{ SIMDS }} 条 SIMD × 每条 {{ LANES }} 个 lane × 2 条 FMA × 2 次浮点运算 × {{ BOOST }} ≈ {{ DUAL_TFLOPS }} TFLOPS。一个时钟两条靠双发射：一条 VOPD 指令装两个互不相干的运算，一起算，只能在 wave32 里用；三个数都在寄存器里的 FMA，只有累加进结果的 `v_dual_fmac_f32`（d = a × b + d）装得进去（[RDNA4 指令集手册](https://gpuopen.com/download/rdna4-instruction-set-architecture.pdf) 7.8 节，15.3.7 节的表 100、101）。所以 FMA 测试的链写成累加，编译出来是一条条 `v_dual_fmac_f32`。
- 拷贝测试量的是显存。数据装得进缓存的算子，有效带宽可以比它高（{{ PREV.code }} 关的缓存冷热），点就冒出了带宽的屋顶；`hg.roofline` 碰到这种点会提醒你。

</DeepDive>

<DeepDive title="屋顶不止一层">

- FMA 测试量的是 FP32 的向量运算。FP16 的矩阵乘可以用上矩阵核心：产品页标称的 FP16 矩阵算力是 {{ FP16_MATRIX }}，约是 FP32 向量算力的 {{ MATRIX_RATIO }} 倍。参考记录里（Notebook 的练习 3），4096×4096 的 FP16 矩阵乘跑到 134 TFLOPS，是 FMA 测试那层平顶的 2.8 倍。这样的矩阵乘不归 FMA 测试那层平顶管，试炼场的 {{ MATRIX_CORES.code }}「{{ MATRIX_CORES.title }}」细讲。
- 缓存也各有一层：数据装得进 L2 或 Infinity Cache 时，读写不用回显存，有效带宽可以比拷贝测试高。这一关只画显存这一层。

</DeepDive>

<DeepDive title="示意图简化了什么">

- 探索一的固定开销设成 {{ OVERHEAD }}，是示意值。参考记录（{{ REF.name }}）里，64 KiB 的拷贝一次 7.32 µs，有效带宽只有 17.9 GB/s。缓存只看装不装得下，没算快多少。
- 探索二、三按屋顶线的假设算：搬数据和算同时进行，各自跑满峰值。真卡上两件事不一定叠得这么齐，实测的点在屋顶下面。
- 没导入卡片时，三段探索用实验档案馆里这一关的参考记录（{{ REF.name }}）测的峰值；档案馆里没有记录时，才退回 {{ HW.name }} 的标称峰值，标着「示意」。

</DeepDive>

## 挑战：在你的卡上交成绩

挑战在实验室 Notebook 里做，两件事，三颗星和任务卡上写的一样。

**数工作量**：`mm_cost(m, k, n)` 返回 (m×k) 乘 (k×n) 这个 FP32 矩阵乘的浮点运算次数和字节数。字节数按算法数：A、B 各读一遍，C 写一遍。你补上标了 TODO 的两行：

```python
def mm_cost(m, k, n):
    flops = ...  # TODO：C 的每个数要做几次乘加？一次乘加算 2 次浮点运算
    bytes_moved = ...  # TODO：A、B、C 一共多少个数？每个 FP32 数 4 字节
    return flops, bytes_moved

checks = hg.check_mm_cost(mm_cost)
```

`hg.check_mm_cost` 拿五种形状核对：方阵、很扁的、矩阵乘向量……两个数都对，这种形状才算通过。五种都过，拿 ★1；没过的那一行写着差在哪，不直接给答案。

**拐点两边各放一个点**：★2 要拐点左边的加法跑到峰值带宽的 80%；★3 要把矩阵乘挪到拐点右边，算术强度不小于你这张卡的拐点。改标了 TODO 的两个长度：

```python
n = 1 << 12  # TODO：加法的长度。改大，直到 add 的「占屋顶」到 80%
k = 16  # TODO：矩阵乘中间那一维。改大，直到 mm 过了拐点
```

n 太小，一次加法太短，量到的大多是启动的开销，离屋顶很远。k 越大，矩阵乘每搬 1 字节做的运算越多，点就往右挪，探索三拖的就是它。n、k 各要多大，看你这张卡的两个峰值。参考记录（{{ REF.name }}）的拐点是 82.8 FLOP/字节：n = 2²⁴ 时加法占屋顶 103%；k 翻到 256，矩阵乘的算术强度是 114，过了拐点（k = 128 时按公式只有 60）。

<LabCard />

## 你现在能……

- 用拷贝测试和 FMA 测试量出一张卡的峰值带宽和峰值算力，说清两个测试为什么要拷得够大、算得够多
- 数出一个算子的浮点运算次数和字节数，算出算术强度，判断它在拐点哪边、归谁管
- 用「占屋顶」说出一个 kernel 离这张卡的上限还有多远，该先查搬数据还是先查计算

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：屋顶告诉你一个算子最快多快；下一关拆开一行 PyTorch，看它启动了哪些 kernel，时间花在哪一个上。

- 回到基础：[旧版第 4 章 4.4.3 一次加法为什么要关心数据移动](/part0-intro/chapter4/#_4-4-3-一次加法为什么要关心数据移动)：从「读两次、写一次」数出 12N 字节，算出加法的算术强度。
- 深入一层：[旧版第 11 章 11.2 分块与输入复用](/part2-kernels/chapter11/#matmul-reuse)：矩阵乘把读进来的数多用几次，算术强度变高，点往拐点右边挪。

<EvidenceCard kind="mixed" hardware="AMD Radeon AI PRO R9700" software="ROCm 10.0.0 · PyTorch 2.13.0+rocm10.0.0 · Triton 3.8.0+git4cff872c.rocm10.0.0" date="2026-11-11" entry="forge-roofline/shared-ai-pro-r9700-2026-11-11">热身和正文的算式用 {{ HW.name }} 的标称峰值（显存带宽 {{ BW }}、FP32 算力 {{ FP32 }}），出自 AMD 产品页；屋顶线、拐点和算术强度按峰值和工作量公式算。探索一的固定开销 {{ OVERHEAD }} 是示意值，探索二、三按「搬和算同时进行」的假设算。没导入卡片时三段探索用的峰值，和正文里的实测数字，来自实验档案馆的参考记录：在 {{ REF.name }} 上照 Notebook 从头跑了一遍，挑战填的是参考解。导入 GPU 卡片以后，三段探索用你在 Notebook 里测的峰值，只存在你的浏览器里。</EvidenceCard>

<style scoped>
/* 小核开场：同新手村各关和 2-1 到 2-3 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.rf-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.rf-hello__art {
  flex: none;
}

.rf-hello__line {
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
.hg-shell.is-plain .rf-hello__art {
  display: none;
}

.hg-shell.is-plain .rf-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
