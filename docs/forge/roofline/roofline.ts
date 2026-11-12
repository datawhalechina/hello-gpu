/**
 * 2-4 性能的天花板：三段探索里的数（纯函数，单测在 scripts/tests/forge-roofline.test.mjs）。
 *
 * 三段探索和实验室 Notebook「动手」的三段一一对应：峰值带宽：拷贝测试、峰值算力：FMA 测试、屋顶线。
 * - 峰值从哪来（pickPeak）：读者导入的「我的 GPU 卡片」带着 hg.peak() 测的峰值（L-07）就用它；没有时用实验档案馆里
 *   这一关最新的真实记录（凭证里的 peak_gbps、peak_tflops；示例条目不算）；档案馆还没有记录时，用 hardware.json 里
 *   本书那张卡的标称峰值（AMD 产品页），页面上标「示意」。
 * - 屋顶线同 hello_gpu 的 hg.roofline（lab.py 的 Roofline）：拐点 = 峰值算力 × 1000 ÷ 峰值带宽（FLOP/字节）；
 *   算术强度 I 的屋顶 = min(峰值带宽 × I ÷ 1000, 峰值算力)（TFLOPS）；I 比拐点小归带宽管，否则归算力管。
 * - 工作量同 Notebook：n 个数的 FP32 加法做 n 次浮点运算、搬 12n 字节；FP32 矩阵乘同 hg.check_mm_cost。
 *   FMA 测试同 lab.py 的 _FMA_THREADS、_FMA_CHAINS、_FMA_ITERS：2²³ 个线程，每个 16 条链 × 256 次 FMA，读两个数、写一个数。
 * - 探索一的固定开销是示意值（COPY_OVERHEAD_MS）；探索二、三按屋顶线的假设算：搬数据和算同时进行，各自跑满峰值，
 *   慢的那件说了算。
 */
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES, type HardwareDevice } from '../../course/hardware.ts'
import { compareEntries, type ArchiveSummary } from '../../course/labArchive.ts'
import type { DeviceRecord } from '../../course/progress.ts'
import { bookCaches, type CacheLevel } from '../trusted-timing/timing.ts'

export const STAGE_ID = 'forge-roofline'

// ── 写法 ──────────────────────────────────────────────────────────────────

/** 3 位有效数字：7.94、683、0.0533；1000 以上写整数（4096、1678）。 */
export function sig(value: number, digits = 3): string {
  if (Math.abs(value) >= 10 ** digits) return String(Math.round(value))
  return String(Number(value.toPrecision(digits)))
}

/** 时间：0.1 ms 以上写毫秒，更短的写微秒（1.26 ms、0.157 ms、10.2 µs、0.205 µs）。 */
export function msText(ms: number): string {
  return ms >= 0.1 ? `${sig(ms)} ms` : `${sig(ms * 1000)} µs`
}

/** 比例写成百分数：10% 以上取整，更小的留一位小数（56%、2.0%、0.2%）。 */
export function percentText(fraction: number): string {
  const pct = fraction * 100
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`
}

/** 次数写成中文的量级：1678 万次、687 亿次；一万以下照写。 */
export function countText(count: number): string {
  if (count >= 1e8) return `${sig(count / 1e8)} 亿`
  if (count >= 1e4) return `${sig(count / 1e4)} 万`
  return String(count)
}

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
/** 2 的幂写成上标：26 → 2²⁶。 */
export function powerText(exponent: number): string {
  return `2${String(exponent).split('').map((d) => SUP[Number(d)]).join('')}`
}

// ── 峰值从哪来 ──────────────────────────────────────────────────────────────

/** 两个峰值：带宽是十进制 GB/s（每秒 10⁹ 字节），算力是 TFLOPS（每秒 10¹² 次浮点运算），同 hg.peak()。 */
export interface Peak {
  gbps: number
  tflops: number
}

/** card：读者的「我的 GPU 卡片」；archive：实验档案馆里这一关的真实记录；spec：本书那张卡的标称峰值（示意）。 */
export type PeakSource = 'card' | 'archive' | 'spec'

export interface RoofPeak extends Peak {
  source: PeakSource
  /** 哪张卡。 */
  device: string
  /** 卡片：带着峰值的导入码的生成时间；档案：凭证的生成时间；标称值没有。 */
  at: string | null
  /** 档案条目 id（source 是 archive 时），链接到 /lab/#<id>。 */
  entry: string | null
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

/** 读者的卡片带着 hg.peak() 测的峰值时用它；没有卡片、卡片还没测过峰值时是 null。 */
export function cardPeak(card: DeviceRecord | null | undefined): RoofPeak | null {
  const peak = card?.peak
  if (!card || !peak || !positive(peak.gbps) || !positive(peak.tflops)) return null
  return { source: 'card', gbps: peak.gbps, tflops: peak.tflops, device: card.name, at: peak.at, entry: null }
}

/** 档案馆里这一关的参考峰值：真实记录里排在最前的那条（同 LabCard 的顺序：新的在前），凭证里要带着两个峰值。 */
export function archivePeak(entries: readonly ArchiveSummary[]): RoofPeak | null {
  const usable = entries.filter((e) => e.stage === STAGE_ID && !e.example && positive(e.metrics.peak_gbps) && positive(e.metrics.peak_tflops))
  const latest = [...usable].sort(compareEntries)[0]
  if (!latest) return null
  return {
    source: 'archive',
    gbps: latest.metrics.peak_gbps,
    tflops: latest.metrics.peak_tflops,
    device: latest.deviceInfo.name,
    at: latest.at,
    entry: latest.id,
  }
}

/** hardware.json 里一张卡的标称峰值：显存带宽（GB/s）和 FP32 向量算力（TFLOPS）；查不到或单位不对时是 null。 */
export function specPeak(device: HardwareDevice | undefined): RoofPeak | null {
  const bandwidth = device?.params.memoryBandwidth
  const fp32 = device?.params.peakFp32
  if (!device || bandwidth?.unit !== 'GB/s' || fp32?.unit !== 'TFLOPS') return null
  if (!positive(bandwidth.value) || !positive(fp32.value)) return null
  return { source: 'spec', gbps: bandwidth.value, tflops: fp32.value, device: device.name, at: null, entry: null }
}

function bookSpecPeak(): RoofPeak {
  const peak = specPeak(HARDWARE_DEVICES[DEFAULT_DEVICE_ID])
  if (!peak) throw new Error('hardware.json 里本书那张卡缺少 memoryBandwidth（GB/s）或 peakFp32（TFLOPS），2-4 的屋顶线画不出来')
  return peak
}

/** 本书那张卡的标称峰值：屋顶线最后的退路，也是热身和正文按标称值算的那组数。 */
export const SPEC_PEAK: RoofPeak = bookSpecPeak()

/** 参考峰值：档案馆有这一关的真实记录就用它，没有就用本书那张卡的标称峰值。 */
export function referencePeak(entries: readonly ArchiveSummary[]): RoofPeak {
  return archivePeak(entries) ?? SPEC_PEAK
}

/** 三段探索用哪组峰值：你的卡 → 档案馆 → 标称。 */
export function pickPeak(card: DeviceRecord | null | undefined, entries: readonly ArchiveSummary[]): RoofPeak {
  return cardPeak(card) ?? referencePeak(entries)
}

// ── 屋顶线（同 hg.roofline）────────────────────────────────────────────────

/** 拐点的算术强度（FLOP/字节）：峰值算力换成 GFLOPS，再除以峰值带宽（GB/s）。 */
export function ridgeOf(peak: Peak): number {
  return (peak.tflops * 1000) / peak.gbps
}

/** 算术强度为 intensity 的算子最快多快（TFLOPS）：峰值带宽 × 算术强度，和峰值算力取小的那个。 */
export function roofAt(peak: Peak, intensity: number): number {
  return Math.min((peak.gbps * intensity) / 1000, peak.tflops)
}

export type Bound = 'bandwidth' | 'compute'

/** 归谁管：比拐点小归带宽管；正好在拐点上和右边归算力管（同 hg.roofline 的 intensity < ridge）。 */
export function boundOf(peak: Peak, intensity: number): Bound {
  return intensity < ridgeOf(peak) ? 'bandwidth' : 'compute'
}

export const BOUND_TEXT: Readonly<Record<Bound, string>> = { bandwidth: '归带宽管', compute: '归算力管' }

// ── 工作量 ────────────────────────────────────────────────────────────────

/** 一次调用的工作量：浮点运算次数，和按算法搬运的字节数（每个要用的数读一次、每个结果写一次）。 */
export interface Work {
  flops: number
  bytes: number
}

/** 算术强度（FLOP/字节）。 */
export function intensityOf(work: Work): number {
  return work.flops / work.bytes
}

/** n 个数的 FP32 加法：n 次加法；读 x、y，写 out，每个数 4 字节，一共 12n 字节。 */
export function addWork(n: number): Work {
  return { flops: n, bytes: 12 * n }
}

/** (m×k) 乘 (k×n) 的 FP32 矩阵乘，同 hg.check_mm_cost：C 的每个数做 k 次乘加，A、B 各读一遍，C 写一遍。 */
export function mmWork(m: number, k: number, n: number): Work {
  return { flops: 2 * m * k * n, bytes: 4 * (m * k + k * n + m * n) }
}

/** 屋顶线的假设下一次调用的耗时：搬数据和算同时进行，各自跑满峰值，慢的那件说了算。 */
export interface Balance {
  work: Work
  intensity: number
  /** 按峰值带宽搬完要多久（毫秒）。 */
  memoryMs: number
  /** 按峰值算力算完要多久（毫秒）。 */
  computeMs: number
  /** 两件里慢的那件（毫秒）。 */
  ms: number
  /** 量到的算力：浮点运算次数 ÷ ms（TFLOPS），就是这一点的屋顶。 */
  tflops: number
  /** 量到的算力占峰值算力的比例。 */
  ofPeak: number
  bound: Bound
}

export function balance(peak: Peak, work: Work): Balance {
  const memoryMs = work.bytes / peak.gbps / 1e6
  const computeMs = work.flops / peak.tflops / 1e9
  const ms = Math.max(memoryMs, computeMs)
  const tflops = work.flops / ms / 1e9
  const intensity = intensityOf(work)
  return { work, intensity, memoryMs, computeMs, ms, tflops, ofPeak: tflops / peak.tflops, bound: boundOf(peak, intensity) }
}

// ── 探索一：峰值带宽（拷贝测试）────────────────────────────────────────────

/** 旋钮的选项：每块缓冲区 2^k 个 FP32 数，64 KiB 到 512 MiB；含 Notebook 的 2¹⁴（64 KiB）和 2²⁷（512 MiB，hg.peak() 拷的大小）。 */
export const COPY_EXPONENTS = [14, 16, 18, 20, 22, 24, 26, 27] as const
/** 默认 2¹⁴：Notebook 里那次小拷贝，量不到峰值（能跑但不好）。 */
export const COPY_EXPONENT_DEFAULT = 14
/** 示意：每次拷贝除了搬数据，还有启动这类固定开销，设成 0.01 ms（10 µs）。不是实测。 */
export const COPY_OVERHEAD_MS = 0.01

export interface CopyCase {
  exponent: number
  /** 每块缓冲区几个 FP32 数。 */
  elements: number
  /** 每块缓冲区的字节数。 */
  bytes: number
  /** 读一遍、写一遍：两块缓冲区一共搬的字节数。 */
  moved: number
  /** 按峰值带宽搬完要多久（毫秒）。 */
  transferMs: number
  /** 固定开销（毫秒，示意）。 */
  overheadMs: number
  ms: number
  /** 量到的有效带宽：搬的字节数 ÷ ms（GB/s）。 */
  gbps: number
  /** 占峰值带宽的比例。 */
  ofPeak: number
  /** 两块缓冲区一起装得下的最小一级缓存（本书那张卡的）；都装不下是 null。 */
  cache: CacheLevel | null
}

/** 每块 2^exponent 个 FP32 数的拷贝：固定开销（示意）加上按峰值带宽搬一遍的时间。 */
export function copyCase(exponent: number, peak: Peak, caches: readonly CacheLevel[] = bookCaches()): CopyCase {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 40) throw new Error(`缓冲区大小的指数要是 0 到 40 的整数，现在是 ${exponent}`)
  const elements = 2 ** exponent
  const bytes = 4 * elements
  const moved = 2 * bytes
  const transferMs = moved / peak.gbps / 1e6
  const ms = COPY_OVERHEAD_MS + transferMs
  const gbps = moved / ms / 1e6
  const cache = [...caches].sort((a, b) => a.bytes - b.bytes).find((c) => moved <= c.bytes) ?? null
  return { exponent, elements, bytes, moved, transferMs, overheadMs: COPY_OVERHEAD_MS, ms, gbps, ofPeak: gbps / peak.gbps, cache }
}

// ── 探索二：峰值算力（FMA 测试）────────────────────────────────────────────

/** hg.peak() 的 FMA 测试（lab.py 的 _FMA_THREADS、_FMA_CHAINS、_FMA_ITERS）。 */
export const FMA_TEST = { threads: 2 ** 23, chains: 16, iterations: 256 } as const
/** 每个线程读两个数、写一个数，FP32 各 4 字节。 */
export const FMA_BYTES_PER_THREAD = 12
/** 旋钮的选项：每个线程做几次 FMA。最后一个是 hg.peak() 的 16 条链 × 256 次 = 4096 次。 */
export const FMA_COUNTS = [1, 8, 64, 512, FMA_TEST.chains * FMA_TEST.iterations] as const
/** 默认 1 次：几乎只在搬数据，量到的不是算力（能跑但不好）。 */
export const FMA_COUNT_DEFAULT = 1

/** 每个线程做 count 次 FMA 时一次启动的工作量：一次 FMA 记 2 次浮点运算。 */
export function fmaWork(count: number, threads: number = FMA_TEST.threads): Work {
  return { flops: 2 * count * threads, bytes: FMA_BYTES_PER_THREAD * threads }
}

// ── 探索三：屋顶线 ──────────────────────────────────────────────────────────

/** Notebook 屋顶线一节的加法：2²⁶ 个数。 */
export const ADD_N = 2 ** 26
/** Notebook 挑战里的矩阵乘：A 是 4096×k，B 是 k×4096。 */
export const MM_SIZE = 4096
/** k 的选项（2 的幂）：16 是 Notebook 挑战的起点，4096 就是屋顶线一节的方阵。 */
export const MM_KS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096] as const
export const MM_K_DEFAULT = 16

/** 矩阵乘（4096×k 乘 k×4096）的算术强度。 */
export function mmIntensity(k: number): number {
  return intensityOf(mmWork(MM_SIZE, k, MM_SIZE))
}

/** 拖到算术强度 intensity 附近时，k 取哪个：按对数距离找最近的选项。 */
export function nearestK(intensity: number): number {
  if (!positive(intensity)) return MM_KS[0]
  const at = Math.log10(intensity)
  let best: number = MM_KS[0]
  for (const k of MM_KS) {
    if (Math.abs(Math.log10(mmIntensity(k)) - at) < Math.abs(Math.log10(mmIntensity(best)) - at)) best = k
  }
  return best
}

/** 屋顶线上的一个算子点：横坐标是算术强度，画在这一点的屋顶上（它最快能到的地方）。 */
export interface RoofPoint {
  intensity: number
  /** 这一点的屋顶（TFLOPS）。 */
  roof: number
  bound: Bound
}

export function roofPoint(peak: Peak, intensity: number): RoofPoint {
  return { intensity, roof: roofAt(peak, intensity), bound: boundOf(peak, intensity) }
}

/** 对数坐标的一根轴：两头是 10 的整数次幂，记指数。 */
export interface LogAxis {
  from: number
  to: number
}

/**
 * 屋顶线图的两根轴。横轴（FLOP/字节）至少从 10⁻² 到 10⁴，拐点离两头都至少两个数量级；
 * 纵轴（TFLOPS）上头比峰值算力高一级，下头到横轴左端那一点的屋顶所在的那一级。
 */
export function roofAxes(peak: Peak): { x: LogAxis; y: LogAxis } {
  const ridge = Math.log10(ridgeOf(peak))
  const x = { from: Math.min(-2, Math.floor(ridge) - 2), to: Math.max(4, Math.ceil(ridge) + 2) }
  const y = {
    from: Math.floor(Math.log10(roofAt(peak, 10 ** x.from))),
    to: Math.floor(Math.log10(peak.tflops)) + 1,
  }
  return { x, y }
}

/** value 在对数轴上的位置：0 是左（下）头，1 是右（上）头。 */
export function logFraction(value: number, axis: LogAxis): number {
  return (Math.log10(value) - axis.from) / (axis.to - axis.from)
}

/** logFraction 反过来：位置换成数。 */
export function logValueAt(fraction: number, axis: LogAxis): number {
  return 10 ** (axis.from + fraction * (axis.to - axis.from))
}

/** 对数轴上 10 的整数次幂的刻度：0.001、0.1、1、100、10000。 */
export function decadeLabel(exponent: number): string {
  return exponent < 0 ? `0.${'0'.repeat(-exponent - 1)}1` : `1${'0'.repeat(exponent)}`
}
