/**
 * 1-11 测一测有多快：计时台的模型，热身、三段探索、挑战和支线用到的数据、代码、解读和判定
 * （纯函数，单测在 scripts/tests/novice-timing.test.mjs，06 第 7 节）。
 *
 * 计时台（runSession）照着读者的计时代码，把 CPU 和 GPU 两条时间线走一遍。时间都按模拟器的周期数算：
 * - CPU 一行一行往下走：看表（now）；启动，把工作单交给 GPU，占 CPU launchCycles 个周期；同步，等 GPU 把交出去的活都做完。
 *   启动是异步的：工作单交出去，CPU 马上往下走，不等 GPU 算完。
 * - 程序里第一次启动 kernel，启动那一行先做一次准备（firstLaunchCycles 个周期），之后不再做。
 * - GPU 接到工作单就开工，一份做完再做下一份。一份工作单算多少个周期，取 L4 示意计时（docs/sim/timing.ts 的
 *   estimateTime，默认价钱）：这里写成常数，单测拿模拟器把两种写法都跑一遍核对。
 * - 预热：先空跑一次，等它算完，再看表。
 * launchCycles、firstLaunchCycles 在 docs/sim/params.ts，都是示意值；量到的数、算出来的带宽一律标「模拟」。
 *
 * 挑战的判定只看计时代码怎么写（预热没有、停表前同步没有、字节数怎么数），和写法无关：两种写法显示的是
 * 同一串操作（codeRows，单测核对每一行一一对应），同样的写法拿同样的星。
 */
import { VECTOR_ADD } from '../../course/agent/tasks.ts'
import type { Lang } from '../../course/progress.ts'
import type { ChallengeError, Hints } from '../../course/useChallenge.ts'
import { SIM_PARAMS } from '../../sim/params.ts'

export const STAGE_ID = 'novice-timing'

/** 启动一次占 CPU 几个周期；程序里第一次启动，启动那一行多花几个周期做准备（params.ts，示意值）。 */
export const LAUNCH_CYCLES = SIM_PARAMS.launchCycles
export const FIRST_LAUNCH_CYCLES = SIM_PARAMS.firstLaunchCycles
/** 一车多少字节、搬一车几个周期、一个 float 几字节（模拟）。 */
export const LINE_BYTES = SIM_PARAMS.lineBytes
export const LINE_CYCLES = SIM_PARAMS.lineCycles
export const ELEM_BYTES = SIM_PARAMS.elemBytes
/**
 * 模拟器里有效带宽的上限（字节/周期）：显存每搬一车 lineBytes 字节要 lineCycles 个周期，该读写的字节又不会比
 * 搬的多，所以停表前等 GPU 算完，算出来的有效带宽超不过它（单测逐个核对）。
 */
export const BANDWIDTH_CAP = SIM_PARAMS.lineBytes / SIM_PARAMS.lineCycles

/** 一份要量的工作单：叫什么，在 GPU 上算多少个周期（模拟）。 */
export interface Kernel {
  label: string
  cycles: number
}

// ── 向量加法：热身、三段探索、支线 ──────────────────────────────────────────

/** 1000 道向量加法（1-1），每组 32 个线程：同 A-01 的调参任务（1-8 的支线）。 */
export const ADD_N = VECTOR_ADD.n
export const ADD_BLOCK = 32
/**
 * 每个线程连着算 stride 个数（1-8 探索一的工作单）：A-01 的四种步长在 GPU 上各算多少个周期、读写显存一共搬几车。
 * 模拟值：L4 的 estimateTime、L3 的 analyzeMemory，默认价钱；单测拿模拟器核对。
 */
export const ADD_CYCLES: Readonly<Record<number, number>> = { 1: 576, 2: 928, 4: 1680, 8: 3208 }
export const ADD_CARS: Readonly<Record<number, number>> = { 1: 96, 2: 192, 4: 384, 8: 768 }
/** 1-8 的改动：改前每人连着算 4 个（步长 4），改后挨着拿（步长 1）。 */
export const ADD_STRIDES = [4, 1] as const
export const ADD_KERNELS: readonly Kernel[] = ADD_STRIDES.map((stride) => ({
  label: stride === 1 ? '改后：挨着拿' : `改前：每人连着算 ${stride} 个`,
  cycles: ADD_CYCLES[stride],
}))
/** 向量加法该读写的字节：读 a、b，写 c，各 n 个 float。 */
export const ADD_TOTAL_BYTES = 3 * ADD_N * ELEM_BYTES

// ── 求和：挑战 ──────────────────────────────────────────────────────────────

/** 1-10 挑战的求和：128 个数，派 2 组、每组 64 个线程。 */
export const SUM_N = 128
export const SUM_LAUNCH = { grid: 2, block: 64 } as const
/**
 * 改前是 1-10 挑战的初始写法：一轮都不搭，每个线程把自己那一格原子加进 out[0]，排 128 次队；
 * 改后是三星写法：搭满树，每组只派线程 0 原子加一次。GPU 上的周期数同上（模拟，单测核对）。
 */
export const SUM_KERNELS: readonly Kernel[] = [
  { label: '改前：每个线程都原子加', cycles: 576 },
  { label: '改后：搭树，每组加一次', cycles: 352 },
]
/** 求和该读写的字节：读 a 的 n 个数，写回 out[0] 一个数。 */
export const SUM_TOTAL_BYTES = SUM_N * ELEM_BYTES + ELEM_BYTES

// ── 计时台 ──────────────────────────────────────────────────────────────────

/** 计时代码怎么写。 */
export interface Plan {
  /** 先空跑一次、等它算完，再看表 */
  warmup: boolean
  /** 停表前同步：等 GPU 算完再看表 */
  sync: boolean
}

/** CPU 上：setup 第一次启动的准备，launch 交出工作单，wait 同步时等 GPU。GPU 上：run 算一份工作单。 */
export type SegmentKind = 'setup' | 'launch' | 'wait' | 'run'

export interface Segment {
  lane: 'cpu' | 'gpu'
  kind: SegmentKind
  from: number
  to: number
  /** 第几份工作单（kernels 里的下标） */
  kernel: number
  /** 是预热那一次 */
  warmup: boolean
}

/** 一份工作单的一次计时：两次看表的时刻，和它们的差。 */
export interface Reading {
  kernel: number
  t0: number
  t1: number
  /** t1 − t0：量到的周期数 */
  cycles: number
}

export interface Session {
  segments: Segment[]
  readings: Reading[]
  /** CPU 和 GPU 都做完的时刻：时间线画到这里 */
  end: number
}

/**
 * 照着计时代码把 kernels 一份一份量一遍，每一份都是「（先空跑一次、等它算完）→ 看表 → 启动 →（同步）→ 看表」。
 * 一开始 GPU 空着，程序里还没启动过 kernel。
 */
export function runSession(plan: Plan, kernels: readonly Pick<Kernel, 'cycles'>[]): Session {
  const segments: Segment[] = []
  const readings: Reading[] = []
  let cpu = 0
  let gpuFree = 0
  let first = true

  function launch(kernel: number, warmup: boolean) {
    if (first) {
      segments.push({ lane: 'cpu', kind: 'setup', from: cpu, to: cpu + FIRST_LAUNCH_CYCLES, kernel, warmup })
      cpu += FIRST_LAUNCH_CYCLES
      first = false
    }
    segments.push({ lane: 'cpu', kind: 'launch', from: cpu, to: cpu + LAUNCH_CYCLES, kernel, warmup })
    cpu += LAUNCH_CYCLES
    // 工作单交到了才能开工；GPU 还在算前一份，就排在它后面
    const start = Math.max(cpu, gpuFree)
    gpuFree = start + kernels[kernel].cycles
    segments.push({ lane: 'gpu', kind: 'run', from: start, to: gpuFree, kernel, warmup })
  }

  function sync(kernel: number, warmup: boolean) {
    if (gpuFree > cpu) segments.push({ lane: 'cpu', kind: 'wait', from: cpu, to: gpuFree, kernel, warmup })
    cpu = Math.max(cpu, gpuFree)
  }

  kernels.forEach((_, k) => {
    if (plan.warmup) {
      launch(k, true)
      sync(k, true)
    }
    const t0 = cpu
    launch(k, false)
    if (plan.sync) sync(k, false)
    readings.push({ kernel: k, t0, t1: cpu, cycles: cpu - t0 })
  })
  return { segments, readings, end: Math.max(cpu, gpuFree) }
}

/** 一串工作单按这种计时代码各量到多少个周期。 */
export function readingsOf(plan: Plan, kernels: readonly Pick<Kernel, 'cycles'>[]): number[] {
  return runSession(plan, kernels).readings.map((r) => r.cycles)
}

// ── 写成数 ──────────────────────────────────────────────────────────────────

/** 倍数和带宽：一位小数；100 以上写整数。 */
export function decimal(x: number): string {
  return x >= 100 ? String(Math.round(x)) : x.toFixed(1)
}

/** 改前、改后量到的周期数比一比：「快了 2.9 倍」。 */
export function speedupText(before: number, after: number): string {
  if (before === after) return '一点没快'
  return before > after ? `快了 ${decimal(before / after)} 倍` : `慢了 ${decimal(after / before)} 倍`
}

/** 有效带宽（字节/周期）：字节数 ÷ 周期数。 */
export function bandwidthOf(bytes: number, cycles: number): number {
  return bytes / cycles
}

// ── 热身：三份报告 ─────────────────────────────────────────────────────────

export interface Report {
  name: string
  plan: Plan
  /** 怎么量的（探索里揭晓） */
  how: string
}

/** 三个同学量 1-8 的改动：甲没同步，乙没预热，丙两样都做了。 */
export const REPORTS: readonly Report[] = [
  { name: '甲', plan: { warmup: true, sync: false }, how: '先空跑了一次，可停表前没同步' },
  { name: '乙', plan: { warmup: false, sync: true }, how: '停表前同步了，可没预热：程序一开头就量，先量的改前' },
  { name: '丙', plan: { warmup: true, sync: true }, how: '先空跑一次，停表前同步' },
]
/** 可信的那一份。 */
export const TRUSTED_REPORT = 2

/** 一份报告写的：改前、改后各量到多少，结论是什么。 */
export function reportLine(report: Report): string {
  const [before, after] = readingsOf(report.plan, ADD_KERNELS)
  return `${report.name}：改前 ${before}、改后 ${after} 个周期，${speedupText(before, after)}`
}

// ── 探索一、二：重演报告 ────────────────────────────────────────────────────

/** 探索一：预热了，只换停表前同步不同步。 */
export function syncText(sync: boolean): string {
  const [before, after] = readingsOf({ warmup: true, sync }, ADD_KERNELS)
  if (!sync) {
    return `两版都只量到 ${before} 个周期（模拟）：表停在交出工作单的那一刻，GPU 才刚开工，改前那份还要算 ${ADD_KERNELS[0].cycles} 个周期。看上去一点没快，其实 GPU 算的时间一点都没量到。`
  }
  return `改前 ${before}、改后 ${after} 个周期（模拟）：停表前等 GPU 算完，量到的是交出工作单的 ${LAUNCH_CYCLES} 个周期，加上 GPU 算的时间。改后${speedupText(before, after)}。`
}

/** 探索二：停表前都同步，只换预热没有。 */
export function warmupText(warmup: boolean): string {
  const [before, after] = readingsOf({ warmup, sync: true }, ADD_KERNELS)
  const gpu = ADD_KERNELS[0].cycles
  if (!warmup) {
    return `改前量到 ${before} 个周期，比交出工作单加 GPU 算的 ${LAUNCH_CYCLES + gpu} 多出 ${before - LAUNCH_CYCLES - gpu}：改前是程序里第一次启动，启动那一行先做了准备。改后没有这一笔，算出来${speedupText(before, after)}，多出来的那几倍是准备的功劳（模拟）。`
  }
  return `准备落在空跑的那一次里，计时里没有它：改前 ${before}、改后 ${after} 个周期，${speedupText(before, after)}（模拟）。`
}

// ── 探索三：算出带宽 ────────────────────────────────────────────────────────

/** 向量加法的字节数怎么数：只数 c；只数 a、b；a、b、c；按搬的车数。 */
export type ByteCount = 'c' | 'ab' | 'abc' | 'cars'
export const BYTE_COUNTS: readonly { value: ByteCount; label: string }[] = [
  { value: 'c', label: '只数 c' },
  { value: 'ab', label: 'a、b' },
  { value: 'abc', label: 'a、b、c' },
  { value: 'cars', label: '搬的车' },
]
/** 默认只数写回去的 c：能算，可数少了（03 第 1 节第 3 条）。 */
export const DEFAULT_BYTE_COUNT: ByteCount = 'c'

/** 步长 stride 的那一版，按这种数法有多少字节。 */
export function countedBytes(count: ByteCount, stride: number): number {
  if (count === 'c') return ADD_N * ELEM_BYTES
  if (count === 'ab') return 2 * ADD_N * ELEM_BYTES
  if (count === 'abc') return ADD_TOTAL_BYTES
  return ADD_CARS[stride] * LINE_BYTES
}

/** 字节数怎么来的，写成算式：「3 × 1000 × 4 = 12000」「384 车 × 128 = 49152」。 */
export function countFormula(count: ByteCount, stride: number): string {
  const bytes = countedBytes(count, stride)
  if (count === 'cars') return `${ADD_CARS[stride]} 车 × ${LINE_BYTES} = ${bytes}`
  const rows = { c: 1, ab: 2, abc: 3 }[count]
  return `${rows === 1 ? '' : `${rows} × `}${ADD_N} × ${ELEM_BYTES} = ${bytes}`
}

/** 探索三按丙的量法（预热、同步）：两版各量到多少个周期。 */
export const TRUSTED_ADD_READINGS = readingsOf(REPORTS[TRUSTED_REPORT].plan, ADD_KERNELS)

/** 步长 stride 的那一版（两版之一），按这种数法算出来的有效带宽（字节/周期，模拟）。 */
export function countedBandwidth(count: ByteCount, version: number): number {
  return bandwidthOf(countedBytes(count, ADD_STRIDES[version]), TRUSTED_ADD_READINGS[version])
}

/** 探索三：换一种数法以后的那一句。 */
export function bandwidthText(count: ByteCount): string {
  const [before, after] = [0, 1].map((v) => decimal(countedBandwidth(count, v)))
  if (count === 'c') {
    return `只数了写回去的 c，${countedBytes('c', 1)} 字节。a、b 也是从显存读进来的，一排都不能少。`
  }
  if (count === 'ab') {
    return `只数了读进来的 a、b，${countedBytes('ab', 1)} 字节。c 算完要写回显存，也得算上。`
  }
  if (count === 'abc') {
    const [t0, t1] = TRUSTED_ADD_READINGS
    return `读 a、b，写 c，一共 ${ADD_TOTAL_BYTES} 字节。改后 ${after}、改前 ${before} 字节/周期（模拟）：字节一样多，用时短了，有效带宽就高了，正好是改前的 ${decimal(t0 / t1)} 倍。`
  }
  const extra = ADD_CARS[ADD_STRIDES[0]] - ADD_CARS[ADD_STRIDES[1]]
  return `按搬的车算，改前 ${before} 反倒比改后的 ${after} 高：改前多搬的 ${extra} 车也算了进去。有效带宽只数该读写的字节，白搬的不算。`
}

/** 拿报告甲量到的数算带宽：改后那一版 12000 字节 ÷ 20 个周期，超过上限多少倍。 */
export function fakeBandwidth(): { cycles: number; bandwidth: number; overCap: string } {
  const cycles = readingsOf(REPORTS[0].plan, ADD_KERNELS)[1]
  const bandwidth = bandwidthOf(ADD_TOTAL_BYTES, cycles)
  return { cycles, bandwidth, overCap: decimal(bandwidth / BANDWIDTH_CAP) }
}

// ── 挑战：量一量求和 ────────────────────────────────────────────────────────

/** 求和的字节数怎么写：照搬向量加法；读 a、写 out[0]；只数写回的 out[0]。 */
export type SumCount = 'copy' | 'readWrite' | 'out'
export const SUM_COUNTS: readonly { value: SumCount; label: string; expr: string }[] = [
  { value: 'copy', label: '3 × n × 4', expr: '3 * n * 4' },
  { value: 'readWrite', label: 'n × 4 + 4', expr: 'n * 4 + 4' },
  { value: 'out', label: '4', expr: '4' },
]

export function sumCountBytes(count: SumCount): number {
  if (count === 'copy') return 3 * SUM_N * ELEM_BYTES
  if (count === 'readWrite') return SUM_TOTAL_BYTES
  return ELEM_BYTES
}

export interface BenchPlan extends Plan {
  count: SumCount
}

/** 默认「能跑但不好」（03 第 1 节第 3 条）：不预热、不同步，字节数照搬向量加法。 */
export const DEFAULT_BENCH: Readonly<BenchPlan> = { warmup: false, sync: false, count: 'copy' }

/** 草稿槽里读出来的可能是旧版本或被手改坏：不认识的地方用默认值。 */
export function normalizeBench(raw: unknown): BenchPlan {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    warmup: typeof r.warmup === 'boolean' ? r.warmup : DEFAULT_BENCH.warmup,
    sync: typeof r.sync === 'boolean' ? r.sync : DEFAULT_BENCH.sync,
    count: SUM_COUNTS.some((c) => c.value === r.count) ? (r.count as SumCount) : DEFAULT_BENCH.count,
  }
}

/** 计时台跑一遍挑战：两版各量到多少、快了几倍，改后的字节数和有效带宽（按读者的写法和按该读写的字节）。 */
export interface BenchResult {
  session: Session
  readings: [number, number]
  speedup: string
  bytes: number
  /** 读者的字节数 ÷ 改后量到的周期数 */
  bandwidth: number
  /** 该读写的字节数 ÷ 改后在 GPU 上真正算的周期数 */
  trueBandwidth: number
}

export function runBench(plan: BenchPlan): BenchResult {
  const p = normalizeBench(plan)
  const session = runSession(p, SUM_KERNELS)
  const [before, after] = session.readings.map((r) => r.cycles)
  const bytes = sumCountBytes(p.count)
  return {
    session,
    readings: [before, after],
    speedup: speedupText(before, after),
    bytes,
    bandwidth: bandwidthOf(bytes, after),
    trueBandwidth: bandwidthOf(SUM_TOTAL_BYTES, SUM_KERNELS[1].cycles),
  }
}

export const STAR_LABELS = [
  '停表前同步：两版量到的都是 GPU 算完的时间',
  '先预热：两版都没把第一次启动的准备算进去',
  '数对求和读写的字节，算出改后的有效带宽',
] as const

export const HINTS: Hints = {
  direction: '先想表停在哪：启动那一行做完的时候，GPU 算完了吗？',
  location: '看三个旋钮：停表前要等 GPU；程序里第一次启动有一次准备；求和读了几排数，写回了几个数。',
  answer: '先空跑一次、等它算完再看表；停表前同步；字节数写 n × 4 + 4：读 a 的 n 个数，写回 out[0] 一个数。',
}

/** 06 第 7 节：输入计时代码，输出三颗星各自成立没有和下一步的一句话；没过时给「现象 / 原因 / 怎么改」。 */
export interface Verdict {
  earned: [boolean, boolean, boolean]
  next: string
  error?: ChallengeError
}

/**
 * 星级判定：★1 停表前同步；★2 再加上预热；★3 再加上字节数数对（n × 4 + 4）。★1 不成立时一颗都不发。
 * 判的是计时代码，结果表里的数都由 runBench 照同一份代码算出来。
 */
export function judge(plan: BenchPlan): Verdict {
  const p = normalizeBench(plan)
  const { readings: [before, after], speedup } = runBench(p)
  const [gpuBefore, gpuAfter] = SUM_KERNELS.map((k) => k.cycles)

  if (!p.sync) {
    const error: ChallengeError = {
      symptom: `改后只量到 ${after} 个周期（模拟），算出来${speedup}：表停在交出工作单的那一刻。`,
      cause: `启动只是把工作单交给 GPU，CPU 不等它算完就往下走。看表的时候，改后那份还要算 ${gpuAfter} 个周期。`,
      fix: '停表前加一行同步，等 GPU 算完再看表。',
    }
    return { earned: [false, false, false], next: error.fix, error }
  }

  if (!p.warmup) {
    return {
      earned: [true, false, false],
      next: `改前量到 ${before} 个周期，GPU 只算了 ${gpuBefore}：多出来的 ${before - gpuBefore} 里，${FIRST_LAUNCH_CYCLES} 是程序里第一次启动的准备，所以「${speedup}」不可信。先空跑一次，等它算完再看表。`,
    }
  }

  if (p.count !== 'readWrite') {
    const why = p.count === 'copy'
      ? '3 × n × 4 是向量加法的：读 a、b，写 c。'
      : '只数了写回的 out[0]，a 的 n 个数也是从显存读进来的。'
    return {
      earned: [true, true, false],
      next: `两版都量准了，改后${speedup}。${why}求和读 a 的 n 个数，写回 out[0] 一个数：n × 4 + 4 = ${SUM_TOTAL_BYTES} 字节。`,
    }
  }

  return {
    earned: [true, true, true],
    next: `两版都量准了：改前 ${before}、改后 ${after} 个周期，${speedup}；改后的有效带宽 ${SUM_TOTAL_BYTES} ÷ ${after} ≈ ${decimal(bandwidthOf(SUM_TOTAL_BYTES, after))} 字节/周期（模拟）。`,
  }
}

// ── 两种写法的计时代码 ──────────────────────────────────────────────────────

/** 启动那一行（1-2 定的写法），两版只差参数。 */
export type Call = Readonly<Record<Lang, string>>
export const ADD_CALL: Call = { hip: 'add<<<grid, 32>>>(d_a, d_b, d_c, n, s);', python: 'add[grid, 32](d_a, d_b, d_c, n, s)' }
export const SUM_CALL: Call = { hip: 'sum_all<<<2, 64>>>(d_a, d_out);', python: 'sum_all[2, 64](d_a, d_out)' }
/** 同步那一行（1-2 定的写法）。 */
export const SYNC_CALL: Call = { hip: 'hipDeviceSynchronize();', python: 'synchronize()' }

/** 计时代码的一行；knob 是管这一行的旋钮，写死的行是 null。 */
export interface CodeRow {
  code: string
  note: string
  knob: 'warmup' | 'sync' | 'count' | null
}

const COMMENT: Record<Lang, string> = { hip: '//', python: '#' }

/**
 * 计时代码一行一行列出来：预热（两行，或者一行注释）、看表、启动、同步（或者一行注释）、看表；
 * 给了字节数的式子，再接两行算有效带宽。两种写法行数一样，每一行做同一件事。
 */
export function codeRows(plan: Plan, call: Call, lang: Lang, bytesExpr?: string): CodeRow[] {
  const hip = lang === 'hip'
  const rows: CodeRow[] = []
  if (plan.warmup) {
    rows.push({ code: call[lang], note: '预热：先空跑一次', knob: 'warmup' })
    rows.push({ code: SYNC_CALL[lang], note: '等它算完', knob: 'warmup' })
  } else {
    rows.push({ code: `${COMMENT[lang]} 不预热`, note: '', knob: 'warmup' })
  }
  rows.push({ code: hip ? 'double t0 = now();' : 't0 = now()', note: '看表', knob: null })
  rows.push({ code: call[lang], note: '启动：交出工作单', knob: null })
  rows.push(plan.sync
    ? { code: SYNC_CALL[lang], note: '等 GPU 算完', knob: 'sync' }
    : { code: `${COMMENT[lang]} 不同步，直接看表`, note: '', knob: 'sync' })
  rows.push({ code: hip ? 'double t1 = now();' : 't1 = now()', note: '再看表', knob: null })
  if (bytesExpr !== undefined) {
    rows.push({ code: hip ? `double bytes = ${bytesExpr};` : `nbytes = ${bytesExpr}`, note: '读写了多少字节', knob: 'count' })
    rows.push({ code: hip ? 'double bw = bytes / (t1 - t0);' : 'bw = nbytes / (t1 - t0)', note: '有效带宽：字节/周期', knob: null })
  }
  return rows
}

/** 一行写出来的样子：行尾注释对齐到同一列（最长的那行代码后面空两格）。 */
export function rowTexts(rows: readonly CodeRow[], lang: Lang): string[] {
  const column = Math.max(...rows.map((r) => r.code.length)) + 2
  return rows.map((r) => (r.note ? `${r.code}${' '.repeat(column - r.code.length)}${COMMENT[lang]} ${r.note}` : r.code))
}

export function timingCode(plan: Plan, call: Call, lang: Lang, bytesExpr?: string): string {
  return rowTexts(codeRows(plan, call, lang, bytesExpr), lang).join('\n')
}

// ── 支线：如果让 Agent 来计时 ───────────────────────────────────────────────

/** Agent 的计时工具：不同步就看表、同步但没预热、预热再同步。 */
export type AgentTimer = 'noSync' | 'noWarmup' | 'trusted'
export const AGENT_TIMERS: readonly { value: AgentTimer; label: string; plan: Plan }[] = [
  { value: 'noSync', label: '没同步就看表', plan: { warmup: true, sync: false } },
  { value: 'noWarmup', label: '同步了，没预热', plan: { warmup: false, sync: true } },
  { value: 'trusted', label: '预热，停表前同步', plan: { warmup: true, sync: true } },
]
/** 默认是会骗人的那种（03 第 1 节第 3 条：能跑但不好）。 */
export const DEFAULT_AGENT_TIMER: AgentTimer = 'noSync'

/** Agent 从起点出发（步长 4，同 1-8 的支线）：先量起点，再量 1、2、8；比手上最快的还快才换，一样快就留着先量的。 */
export const AGENT_START_STRIDE = 4
export const AGENT_ORDER: readonly number[] = [AGENT_START_STRIDE, ...VECTOR_ADD.strides.filter((s) => s !== AGENT_START_STRIDE)]

export interface AgentRow {
  stride: number
  /** Agent 的计时工具量到的周期数 */
  reading: number
  /** GPU 上真正算的周期数（模拟器知道，Agent 看不到） */
  truth: number
}

export interface AgentRun {
  timer: AgentTimer
  rows: AgentRow[]
  /** Agent 交的步长 */
  pick: number
  /** A-01 的三星：算对；搬的车等于理想；示意时间不超过 bestCycles */
  earned: [boolean, boolean, boolean]
  /** Agent 交卷前的思考 */
  thought: string
  /** 给读者的一句话：Agent 被骗了没有 */
  note: string
}

export function agentRun(timer: AgentTimer): AgentRun {
  const plan = (AGENT_TIMERS.find((t) => t.value === timer) ?? AGENT_TIMERS[0]).plan
  const readings = readingsOf(plan, AGENT_ORDER.map((s) => ({ cycles: ADD_CYCLES[s] })))
  const rows = AGENT_ORDER.map((stride, i) => ({ stride, reading: readings[i], truth: ADD_CYCLES[stride] }))
  let best = rows[0]
  for (const row of rows) if (row.reading < best.reading) best = row
  const pick = best.stride
  const earned: [boolean, boolean, boolean] = [
    true,
    ADD_CARS[pick] === ADD_CARS[1],
    ADD_CYCLES[pick] <= VECTOR_ADD.bestCycles,
  ]
  const start = rows[0]
  const tie = rows.every((r) => r.reading === start.reading)
  const thought = tie
    ? `四组都量到 ${start.reading} 个周期，一样快。不比起点快就不换：交起点，步长 ${pick}。`
    : `步长 ${pick} 量到 ${best.reading} 个周期，最快：交步长 ${pick}。`
  let note: string
  if (tie) {
    note = `Agent 只读得到计时工具给的数。四组都是 ${start.reading}，它分不出快慢，交了起点：搬的车是理想的 ${ADD_CARS[pick] / ADD_CARS[1]} 倍，只拿到一颗星。`
  } else if (start.reading > LAUNCH_CYCLES + start.truth) {
    note = `这回挑对了，可起点那一次量到 ${start.reading}：程序里第一次启动的准备算了进去。Agent 要是拿它写报告，「从步长 ${start.stride} 改成 ${pick}，${speedupText(start.reading, best.reading)}」就是假的。`
  } else {
    note = `四次都量准了：每次只比 GPU 真正算的多 ${LAUNCH_CYCLES} 个周期（交出工作单那一下）。Agent 交了最快的那组，拿到三颗星。`
  }
  return { timer, rows, pick, earned, thought, note }
}

/** 支线完成：读者给 Agent 换上预热、再同步的计时工具，Agent 交出三星的那组（04 第 2 节：Agent 支线经验值）。 */
export function agentSideDone(run: AgentRun): boolean {
  return run.timer === 'trusted' && run.earned.every(Boolean)
}
