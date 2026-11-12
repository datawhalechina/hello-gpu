/**
 * 2-3 测得准：三段探索里的数（纯函数，单测在 scripts/tests/forge-trusted-timing.test.mjs）。
 * 解读的句子写在各个场景里，这里只算数。
 *
 * 三段探索和实验室 Notebook「动手」的三段一一对应：停表的时机、预热与波动、缓存冷热。
 * - 停表的时机（StopClock）：CPU 把加法排进 GPU 的队列（stream）就返回；同一个队列里的活按排队的顺序做
 *   （PyTorch 文档 Asynchronous execution，HIP 文档 Concurrent execution between host and device）。
 *   GPU 事件排在队列里，GPU 走到它时才记下时刻（HIP 文档 hipEventElapsedTime：非默认 stream 上的事件在走到队头、
 *   前面的活都做完时记时间戳）。时间线的长短是示意，不是实测。
 * - 预热与波动（NoiseLab）：噪声模拟器。加法本身设成 BASE_MS，每个样本再加上随机噪声；没有预热时，第一轮的
 *   第一次调用另外多花 FIRST_CALL_EXTRA_MS。中位数、p10、p90 的算法同 hello_gpu 的 hg.bench（lab.py 的 _quantile，
 *   线性插值，和 numpy.percentile 的默认算法相同）。样本是模拟的，不是实测。
 * - 缓存冷热（CacheFit）：加法读 x、y，写 out，n 个 FP32 元素一共 12n 字节；和本书那张卡的 L2、Infinity Cache
 *   （hardware.json）比装不装得下。冷缓存那一次先读一遍 FLUSH_BYTES 的缓冲区（hello_gpu lab.py 的 _FLUSH_BYTES），
 *   热缓存那一次紧跟着冷缓存再测（hg.warm_cold）。读的地方按装不装得下推断，不是实测。
 *
 * 随机数只用加减乘除（mulberry32 + 四个均匀数之和近似正态），服务端渲染和浏览器里算出来的样本一模一样。
 */
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES, PENDING, formatParam, type HardwareParam } from '../../course/hardware.ts'

export const STAGE_ID = 'forge-trusted-timing'

// ── 探索一：停表的时机 ──────────────────────────────────────────────────────

/** 三种停表的办法，同 Notebook「停表的时机」的两个代码单元。 */
export type StopMode = 'return' | 'sync' | 'event'

export interface StopModeInfo {
  id: StopMode
  /** 旋钮上的字。 */
  label: string
  /** 这样计时的代码（Notebook 里的写法）。 */
  code: readonly string[]
}

export const STOP_MODES: readonly StopModeInfo[] = [
  {
    id: 'return',
    label: 'add() 返回时',
    code: ['start = time.perf_counter()', 'add()', 'ms = (time.perf_counter() - start) * 1000'],
  },
  {
    id: 'sync',
    label: '等 GPU 算完',
    code: ['start = time.perf_counter()', 'add()', 'torch.cuda.synchronize()', 'ms = (time.perf_counter() - start) * 1000'],
  },
  {
    id: 'event',
    label: 'GPU 事件',
    code: ['begin.record()', 'add()', 'end.record()', 'end.synchronize()', 'ms = begin.elapsed_time(end)'],
  },
]

/** 开始计时的时候，GPU 的队列里还排着几个同样的加法（Notebook 里排了两个）。 */
export const QUEUED_OPTIONS = [0, 1, 2] as const
export const QUEUED_DEFAULT = 0
export const STOP_DEFAULT: StopMode = 'return'

/** 示意的长短（单位随意）：CPU 把一个加法排进队列很快，GPU 算一个大加法要久得多。不是实测。 */
export const CLOCK_SPAN = { submit: 0.5, add: 4 } as const

/** 时间线的总长：队列排得最满时也画得下，换旋钮时尺子不变。 */
export const CLOCK_TOTAL = (Math.max(...QUEUED_OPTIONS) + 1) * CLOCK_SPAN.add + CLOCK_SPAN.submit + 0.5

export type ClockLane = 'cpu' | 'gpu'
/** submit：CPU 把加法排进队列；wait：CPU 停下来等 GPU；add：GPU 在算；idle：GPU 空着，等 CPU 把活交过来。 */
export type ClockKind = 'submit' | 'wait' | 'add' | 'idle'

export interface ClockSegment {
  lane: ClockLane
  kind: ClockKind
  start: number
  end: number
  /** 属于要量的那个加法（CPU 排它、GPU 算它）。 */
  timed: boolean
}

export interface ClockRun {
  mode: StopMode
  queued: number
  segments: ClockSegment[]
  /** CPU 看第一眼时钟（或者记下 begin）的时刻。 */
  start: number
  /** 量到的区间：CPU 计时量 CPU 时钟上的两眼，GPU 事件量两个时间戳。 */
  measured: { lane: ClockLane; from: number; to: number }
  /** 要量的那个加法在 GPU 上算的区间。 */
  kernel: { from: number; to: number }
  /** GPU 事件的两个时间戳；不用 GPU 事件时是 null。 */
  events: { begin: number; end: number } | null
  /** 量到的时间 ÷ 加法本身的时间。 */
  ratio: number
}

/**
 * 一种停表办法、前面排着 queued 个加法时的时间线（示意）。规则：
 * - CPU 先把 queued 个加法排进队列，每个花 submit；GPU 按排队的顺序算，每个花 add，一个算完才开始下一个。
 * - CPU 看第一眼时钟（GPU 事件：记下 begin），再花 submit 把要量的加法排进队列，add() 返回。
 * - 「add() 返回时」：这时停表。「等 GPU 算完」：CPU 等到 GPU 算完要量的加法再停表。
 * - 「GPU 事件」：GPU 走到 begin 时记一个时间戳（前面的加法都算完了才走得到），算完要量的加法、走到 end 时再记一个；
 *   CPU 记下 end 以后等 GPU 走到 end。队列空着时，GPU 走到 begin 以后要等 CPU 把加法交过来，这段空等也在两个时间戳之间。
 */
export function stopClock(mode: StopMode, queued: number): ClockRun {
  if (!STOP_MODES.some((m) => m.id === mode)) throw new Error(`没有 ${mode} 这种停表办法`)
  if (!Number.isInteger(queued) || queued < 0) throw new Error(`前面排着的加法要是不小于 0 的整数，现在是 ${queued}`)
  const { submit, add } = CLOCK_SPAN
  const segments: ClockSegment[] = []
  let cpu = 0
  let gpuFree = 0
  for (let k = 0; k < queued; k++) {
    segments.push({ lane: 'cpu', kind: 'submit', start: cpu, end: cpu + submit, timed: false })
    cpu += submit
    const from = Math.max(cpu, gpuFree)
    segments.push({ lane: 'gpu', kind: 'add', start: from, end: from + add, timed: false })
    gpuFree = from + add
  }
  const start = cpu
  // GPU 走到 begin：前面排着的加法都算完以后（队列空着就是马上）。
  const begin = Math.max(start, gpuFree)
  segments.push({ lane: 'cpu', kind: 'submit', start, end: start + submit, timed: true })
  const returned = start + submit
  const from = Math.max(returned, gpuFree)
  const to = from + add
  // GPU 在 start 之后空着、等 CPU 把要量的加法交过来的那一段。
  const idleFrom = Math.max(start, gpuFree)
  if (from > idleFrom) segments.push({ lane: 'gpu', kind: 'idle', start: idleFrom, end: from, timed: false })
  segments.push({ lane: 'gpu', kind: 'add', start: from, end: to, timed: true })
  if (mode !== 'return') segments.push({ lane: 'cpu', kind: 'wait', start: returned, end: to, timed: false })

  const measured = mode === 'return' ? { lane: 'cpu' as const, from: start, to: returned }
    : mode === 'sync' ? { lane: 'cpu' as const, from: start, to }
      : { lane: 'gpu' as const, from: begin, to }
  return {
    mode,
    queued,
    segments,
    start,
    measured,
    kernel: { from, to },
    events: mode === 'event' ? { begin, end: to } : null,
    ratio: (measured.to - measured.from) / add,
  }
}

// ── 探索二：预热与波动（噪声模拟器）────────────────────────────────────────────

export type NoiseLevel = 'low' | 'mid' | 'high'

export interface NoiseLevelInfo {
  id: NoiseLevel
  label: string
  /** 抖动：一个样本比加法本身慢多少，按 |z| × jitter 算（z 近似标准正态）。 */
  jitter: number
  /** 偶尔慢一截的样本占多少：别的程序、驱动插了一脚。 */
  spikeRate: number
}

export const NOISE_LEVELS: readonly NoiseLevelInfo[] = [
  { id: 'low', label: '小', jitter: 0.01, spikeRate: 0.02 },
  { id: 'mid', label: '中', jitter: 0.04, spikeRate: 0.05 },
  { id: 'high', label: '大', jitter: 0.12, spikeRate: 0.1 },
]

/** hg 默认先预热几次、再计时几次（notebooks/config.toml 的 [experiment] warmup、repeat）。 */
export const WARMUP_CALLS = 5
export const HG_REPEAT = 30
/** 每轮计时几次：5 次太少，30 次是 hg 的默认，300 次更稳。 */
export const REPEAT_OPTIONS = [5, HG_REPEAT, 300] as const
/** 模拟器里加法本身的耗时（模拟，不是实测）。 */
export const BASE_MS = 1
/** 模拟器里第一次调用多花的时间（模拟）：加载 kernel、初始化计算库这类只发生一次的开销。 */
export const FIRST_CALL_EXTRA_MS = 2
/** 偶尔慢一截的样本多花多少（加法本身的倍数，模拟）。 */
export const SPIKE_EXTRA = { min: 0.2, max: 0.6 } as const
/** 默认值「能跑但不好」（03 第 1 节）：噪声中等、不预热、每轮只测 5 次。 */
export const NOISE_DEFAULT = { level: 'mid' as NoiseLevel, warmup: false, repeat: 5, seed: 1 }

export interface NoiseParams {
  level: NoiseLevel
  warmup: boolean
  repeat: number
  /** 换一组随机数就换一个种子；同一个种子算出来的样本永远一样。 */
  seed: number
}

export interface RunStats {
  /** 按计时的先后排的样本（毫秒，模拟）。 */
  samples: number[]
  /** 第一个样本：只测一次，测到的就是它。 */
  first: number
  mean: number
  median: number
  p10: number
  p90: number
  min: number
  max: number
  /** p10 ÷ p90：越接近 1，中间八成样本挨得越紧。 */
  spread: number
}

/** mulberry32：32 位整数运算的伪随机数，结果是 [0, 1) 里 2⁻³² 的整数倍，每个 JS 引擎算出来都一样。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SQRT3 = 1.7320508075688772

/**
 * 分位数（q 在 0 到 1 之间），线性插值，同 hello_gpu lab.py 的 _quantile 和 numpy.percentile 的默认算法。
 * sorted 要从小到大排好，不能是空的。
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) throw new Error('没有样本，算不了分位数')
  if (!(q >= 0 && q <= 1)) throw new Error(`q 要在 0 到 1 之间，现在是 ${q}`)
  const position = (sorted.length - 1) * q
  const low = Math.floor(position)
  const high = Math.min(low + 1, sorted.length - 1)
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}

/** 一组样本的统计：第一个样本、平均数、中位数、p10、p90、最快、最慢、p10 ÷ p90。 */
export function runStats(samples: readonly number[]): RunStats {
  if (!samples.length) throw new Error('没有样本，算不了统计')
  const sorted = [...samples].sort((a, b) => a - b)
  const p10 = quantile(sorted, 0.1)
  const p90 = quantile(sorted, 0.9)
  return {
    samples: [...samples],
    first: samples[0],
    mean: samples.reduce((sum, x) => sum + x, 0) / samples.length,
    median: quantile(sorted, 0.5),
    p10,
    p90,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    spread: p10 / p90,
  }
}

/**
 * 模拟一轮计时（run = 0 是第一轮，1 是第二轮），返回按先后排的样本（毫秒）。规则：
 * - 每个样本 = BASE_MS ×（1 + jitter × |z|），z 用四个均匀随机数之和近似标准正态：总比加法本身慢一点。
 * - 按 spikeRate 的比例，有的样本另外慢一截：多花 BASE_MS 的 SPIKE_EXTRA.min 到 max 倍。
 * - 不预热时，第一轮的第一个样本另外多花 FIRST_CALL_EXTRA_MS：第一次调用的开销只有一次，第二轮已经热了。
 * 每个样本固定取四个随机数，所以换噪声大小、开关预热不改变随机数的顺序，计时次数多了只在后面接着加样本。
 */
export function simulateSamples(params: NoiseParams, run: 0 | 1): number[] {
  const level = NOISE_LEVELS.find((l) => l.id === params.level)
  if (!level) throw new Error(`没有 ${params.level} 这一档噪声`)
  if (!Number.isInteger(params.repeat) || params.repeat < 1) throw new Error(`计时次数要是正整数，现在是 ${params.repeat}`)
  const rand = mulberry32(params.seed * 2 + run + 1)
  const samples: number[] = []
  for (let i = 0; i < params.repeat; i++) {
    const z = (rand() + rand() + rand() + rand() - 2) * SQRT3
    const spike = rand() < level.spikeRate
    const size = rand()
    let ms = BASE_MS * (1 + level.jitter * Math.abs(z))
    if (spike) ms += BASE_MS * (SPIKE_EXTRA.min + (SPIKE_EXTRA.max - SPIKE_EXTRA.min) * size)
    if (run === 0 && i === 0 && !params.warmup) ms += FIRST_CALL_EXTRA_MS
    samples.push(ms)
  }
  return samples
}

/** 同一个加法测两轮：两轮各自的统计。 */
export function noiseLab(params: NoiseParams): [RunStats, RunStats] {
  return [runStats(simulateSamples(params, 0)), runStats(simulateSamples(params, 1))]
}

/** 两个数差多少：差 ÷ 小的那个（0.05 就是差 5%）。 */
export function relativeGap(a: number, b: number): number {
  const low = Math.min(a, b)
  if (!(low > 0)) throw new Error('两个数都要是正数')
  return Math.abs(a - b) / low
}

// ── 探索三：缓存冷热 ────────────────────────────────────────────────────────

/** 旋钮的选项：数组长度 n = 2^k。含 Notebook 的 2²⁰、2²⁶ 和 hg.check_timer 的 2¹⁸、2²⁴。 */
export const CACHE_EXPONENTS = [16, 18, 20, 22, 24, 26] as const
/** 默认 2²⁶：Notebook 挑战一开始的长度，冷热分不开（能跑但不好）。 */
export const CACHE_EXPONENT_DEFAULT = 26
/** 加法每个元素读 x、y 各 4 字节，写 out 4 字节。 */
export const ADD_BYTES_PER_ELEMENT = 12
/** hg.warm_cold 冷缓存那一次，计时之前读一遍的缓冲区（hello_gpu lab.py 的 _FLUSH_BYTES；显存不到 4 GiB 时取显存的 1/8）。 */
export const FLUSH_BYTES = 512 * 2 ** 20

const UNIT_BYTES: Readonly<Record<string, number>> = {
  KiB: 2 ** 10, MiB: 2 ** 20, GiB: 2 ** 30,
  KB: 1e3, MB: 1e6, GB: 1e9,
}

/** hardware.json 里一个容量参数有多少字节：单位照出处的写法（MiB 按 2²⁰，MB 按 10⁶）；查不到或单位不认识时是 null。 */
export function paramBytes(param: HardwareParam | undefined): number | null {
  if (!param || param.value === PENDING || typeof param.value !== 'number' || !param.unit) return null
  const scale = UNIT_BYTES[param.unit]
  return scale ? param.value * scale : null
}

export type CacheKey = 'l2' | 'infinity'

export interface CacheLevel {
  key: CacheKey
  label: string
  bytes: number
  /** 照出处写的大小，例如「8 MiB」「64 MB」。 */
  text: string
}

/** 本书那张卡的缓存，从小到大；hardware.json 里查不到的那一级不画。 */
export function bookCaches(): CacheLevel[] {
  const params = HARDWARE_DEVICES[DEFAULT_DEVICE_ID].params
  const levels: CacheLevel[] = []
  for (const [key, name] of [['l2', 'l2Cache'], ['infinity', 'infinityCache']] as const) {
    const bytes = paramBytes(params[name])
    if (bytes !== null) levels.push({ key, label: params[name].label, bytes, text: formatParam(params[name]) })
  }
  return levels.sort((a, b) => a.bytes - b.bytes)
}

/** 字节数写成 2 的幂的单位：768 KiB、12 MiB、768 MiB。 */
export function bytesText(bytes: number): string {
  const units: [string, number][] = [['GiB', 2 ** 30], ['MiB', 2 ** 20], ['KiB', 2 ** 10]]
  for (const [unit, scale] of units) {
    if (bytes >= scale) return `${Number((bytes / scale).toFixed(1))} ${unit}`
  }
  return `${bytes} B`
}

export interface CacheCase {
  exponent: number
  n: number
  /** 三个数组一共多少字节。 */
  bytes: number
  /** 装得下的最小的一级缓存；都装不下是 null。 */
  fits: CacheLevel | null
  /** 热缓存那一次从哪读：装得下的那一级，或者显存。 */
  warmFrom: CacheKey | 'vram'
  /** 冷缓存那一次先读一遍 FLUSH_BYTES，缓存里换成了它的数，加法的数都要从显存读。 */
  coldFrom: 'vram'
  /** 冷缓存前读的缓冲区比每一级缓存都大，换得掉。 */
  flushCovers: boolean
}

/** 数组长度 n = 2^exponent 的加法，和这几级缓存比。 */
export function cacheCase(exponent: number, caches: readonly CacheLevel[] = bookCaches()): CacheCase {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 40) throw new Error(`长度的指数要是 0 到 40 的整数，现在是 ${exponent}`)
  const n = 2 ** exponent
  const bytes = ADD_BYTES_PER_ELEMENT * n
  const fits = [...caches].sort((a, b) => a.bytes - b.bytes).find((c) => bytes <= c.bytes) ?? null
  return {
    exponent,
    n,
    bytes,
    fits,
    warmFrom: fits ? fits.key : 'vram',
    coldFrom: 'vram',
    flushCovers: caches.every((c) => FLUSH_BYTES > c.bytes),
  }
}

/** 尺子的两头：512 KiB 到 1 GiB，按 2 的幂画，一格翻一倍。 */
export const RULER = { fromExp: 19, toExp: 30 } as const

/** 一个字节数在尺子上的位置（0 到 100，按 log₂ 等分，保留两位小数）；超出两头的贴在头上。 */
export function rulerPercent(bytes: number): number {
  if (!(bytes > 0)) throw new Error('字节数要是正数')
  const at = (Math.log2(bytes) - RULER.fromExp) / (RULER.toExp - RULER.fromExp)
  return Math.round(Math.min(1, Math.max(0, at)) * 10000) / 100
}
