/**
 * 1-12 藏起等待：一条流水线（SIMD）上，几支小队怎样轮流算、等仓库的时间怎样被藏住。热身、两段探索和挑战
 * 用到的数据、代码、解读和判定（纯函数，单测在 scripts/tests/novice-latency-hiding.test.mjs，06 第 7 节）。
 *
 * 工作单是 1-8 挑战的三星写法 part_sum：a 里 PART_N 个数，派 W 组、每组 32 个线程（正好一支小队），
 * 第 k 轮第 t 个线程拿第 k × T + t 个数，每人加 m 个，部分和存进 part[t]。这一关只看一条流水线：派出去的小队都排在它这儿。
 * - 住得下几支：L4 的 occupancy（docs/sim/timing.ts）。每组一支小队、不用货架，只剩每个线程的寄存器和名额两项。
 * - 怎样轮流算：L4 的 latencyTimeline。住不下的小队在门外等，前一批都做完，下一批一起住进来（schedule）。
 *   分批是这一关的简化：真卡上一支做完，就能补进一支。
 * 用到的价钱都是 params.ts 的示意值：算一步 issueCycles、仓库一趟 memLatency、搬一车 lineCycles，名额 waveSlots、
 * 每个 lane 的寄存器 vgprsPerSimd。算出来的周期数、占用率、被藏住的比例一律标「模拟」。
 *
 * 模拟器的解释器（lockstep.ts）在 Web Worker 里跑（docs/sim/client.ts），这里只读它交回来的结果，不导入解释器。
 * 正文和热身在构建时就要写出来的周期数（CYCLES_BY_WAVES 等）写成常数，单测拿模拟器把两种写法都跑一遍核对。
 *
 * 挑战的判定只看派法（几组、每人加几个、每个线程几个寄存器）和模拟器跑出来的结果，和写法无关：
 * 两种写法的工作单解析成同一棵语法树、事件流相同（单测核对），同样的派法拿同样的星。
 */
import type { Lang } from '../../course/progress.ts'
import type { ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg, RunResult, SimEvent } from '../../sim/lockstep.ts'
import { SIM_PARAMS } from '../../sim/params.ts'
import { latencyTimeline, occupancy, type SegmentKind } from '../../sim/timing.ts'
import { explainError, type Launch } from '../../components/kit/sandbox/run.ts'

export const STAGE_ID = 'novice-latency-hiding'

/** 一支小队 32 个线程；每组派 32 个线程（blockDim.x = 32），一组就是一支小队。 */
export const WAVE = 32
/** 这条流水线分到的数：a[j] = j + 1（同 1-7、1-8，从 1 数起）。 */
export const PART_N = 2048
/** 1 + 2 + … + PART_N：part 加起来应该是它。 */
export const PART_TOTAL = (PART_N * (PART_N + 1)) / 2
/** 名额：一条流水线最多同时住几支小队（示意，params.ts 的 waveSlots）。 */
export const SLOTS = SIM_PARAMS.waveSlots
/** 一条流水线上，每个 lane 有多少个寄存器（示意，params.ts 的 vgprsPerSimd，按 wave32 数）。 */
export const LANE_VGPRS = SIM_PARAMS.vgprsPerSimd
/** 仓库一趟的往返延迟（示意，同 1-7 地图上的「仓库」）。 */
export const MEM_LATENCY = SIM_PARAMS.memLatency
/** 搬一车几个周期、算一步几个周期（示意，同 1-11 的计时）。 */
export const LINE_CYCLES = SIM_PARAMS.lineCycles
export const STEP_CYCLES = SIM_PARAMS.issueCycles
/** 小队取一个数要等多久：仓库一趟，再加搬一车（这一关每次只读挨着的 32 个数，正好一车）。 */
export const FETCH_WAIT = MEM_LATENCY + LINE_CYCLES
/** 每取一个数之前，小队只算几步：数下一轮、算 i、发出取数（一步 STEP_CYCLES 个周期，单测核对时间线）。 */
export const STEPS_PER_FETCH = 3

// ── 工作单：1-8 挑战的三星写法 ──────────────────────────────────────────────

/** part_sum：T 是一共几个线程，第 k 轮第 t 个线程拿第 k × T + t 个数，s 在工具台（寄存器）上加。 */
export const PART_CODE: Readonly<Record<Lang, string>> = {
  hip: `__global__ void part_sum(float* a, float* part, int m) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    int T = gridDim.x * blockDim.x;   // 一共几个线程
    float s = 0;
    for (int k = 0; k < m; k++) {
        int i = k * T + t;   // 第 k 轮拿第几个数
        s = s + a[i];
    }
    part[t] = s;
}`,
  python: `@kernel
def part_sum(a, part, m):
    t = blockIdx.x * blockDim.x + threadIdx.x
    T = gridDim.x * blockDim.x    # 一共几个线程
    s = 0.0
    for k in range(m):
        i = k * T + t    # 第 k 轮拿第几个数
        s = s + a[i]
    part[t] = s`,
}

/** 一种派法：派几组、每人加几个、每个线程用几个寄存器。 */
export interface Plan {
  /** 派几组（gridDim.x）；每组 32 个线程，一组就是一支小队 */
  waves: number
  /** 每人加几个（m） */
  each: number
  /** 每个线程用几个寄存器：真程序里由编译器定，模拟器里直接设定 */
  vgprs: number
}

export function launchOf(plan: Plan): Launch {
  return { grid: plan.waves, block: WAVE }
}

/** a[j] = j + 1；part 一个线程一格，一开始全是 0。 */
export function partArgs(plan: Plan): Record<string, Arg> {
  return {
    a: { type: 'float', data: Array.from({ length: PART_N }, (_, j) => j + 1) },
    part: { type: 'float', data: new Array<number>(plan.waves * WAVE).fill(0) },
    m: { type: 'int', value: plan.each },
  }
}

/** 启动那一行（1-2 定的写法），上面一行注释写清派法。两种写法行数一样，每一行做同一件事。 */
export function launchCode(plan: Plan, lang: Lang): string {
  const { waves, each } = plan
  if (lang === 'hip') {
    return `// 派 ${waves} 组，每组 ${WAVE} 个线程，每人加 ${each} 个\npart_sum<<<${waves}, ${WAVE}>>>(d_a, d_part, ${each});`
  }
  return `# 派 ${waves} 组，每组 ${WAVE} 个线程，每人加 ${each} 个\npart_sum[${waves}, ${WAVE}](d_a, d_part, ${each})`
}

// ── 住得下几支 ──────────────────────────────────────────────────────────────

/** 一条流水线住得下几支小队，卡在哪一项。 */
export interface Seats {
  vgprs: number
  /** 只看寄存器：每个 lane 的寄存器够分给几支小队 */
  byRegisters: number
  /** 名额 */
  slots: number
  /** 同时住得下几支：两项里小的那个 */
  resident: number
  /** registers：寄存器先用完；slots：名额先用完；both：两样一起用完 */
  limiter: 'registers' | 'slots' | 'both'
}

/** 每组一支小队、不用货架：L4 的 occupancy 只剩寄存器和名额两项（一组一支小队，不占 block 个数的名额）。 */
export function seatsOf(vgprs: number): Seats {
  const o = occupancy({ vgprs, block: WAVE })
  const byRegisters = o.limits.vgprs
  const slots = o.limits.slots
  const limiter = byRegisters < slots ? 'registers' : byRegisters > slots ? 'slots' : 'both'
  return { vgprs, byRegisters, slots, resident: o.wavesPerSimd, limiter }
}

/** 占用率：住下的小队 ÷ 名额。 */
export function occupancyOf(resident: number): number {
  return resident / SLOTS
}

// ── 一条流水线上的时间线 ────────────────────────────────────────────────────

/** run：占着流水线算；memory：等仓库送数据；sync：等同步（这一关用不到）；ready：准备好了，等流水线空出来；queued：住不下，在门外等。 */
export type ScheduleKind = SegmentKind | 'queued'

export interface ScheduleSegment {
  kind: ScheduleKind
  start: number
  /** 不含 */
  end: number
}

/** 一支小队的一行：第几批住进来，按时间排好、首尾相接的同一种段合成一段。 */
export interface WaveRow {
  wave: number
  batch: number
  segments: ScheduleSegment[]
}

export interface Schedule {
  /** 一共几支小队 */
  waves: number
  /** 同时住得下几支 */
  resident: number
  /** 分几批 */
  batches: number
  /** 每一批从第几个周期开始 */
  batchStarts: number[]
  rows: WaveRow[]
  /** 流水线在算的时段，按时间排好、首尾相接的合成一段 */
  busySpans: { start: number; end: number }[]
  /** 一共多少个周期：最后一支小队做完的时候 */
  cycles: number
  /** 流水线在算的周期数 */
  busy: number
  /** 有小队在等数据的周期数（几支同时在等只算一次） */
  waiting: number
  /** 其中流水线正在给别的小队算的周期数 */
  hidden: number
  /** 等待被藏住的比例：hidden ÷ waiting；没有等待时记 1 */
  hiddenRatio: number
}

/**
 * 把事件流里的小队排到一条流水线上：同时住得下 resident 支，按组的先后一批一批住进来，每一批用 L4 的 latencyTimeline 排，
 * 前一批都做完，下一批接着开始。被藏住的比例按各批加起来算：批和批不重叠，等待和藏住的周期可以直接相加。
 * 这一关每组一支小队（blockDim.x = 32）；事件流里有组的第二支小队，说明调用错了，直接抛出。
 */
export function schedule(events: readonly SimEvent[], resident: number): Schedule {
  if (!Number.isInteger(resident) || resident < 1) throw new RangeError(`resident 要是正整数，收到的是 ${String(resident)}。`)
  const order: number[] = []
  const seen = new Set<number>()
  for (const e of events) {
    if (e.wave !== 0) throw new RangeError(`这一关每组只有一支小队，可第 ${e.block} 组出现了第 ${e.wave} 支。`)
    if (!seen.has(e.block)) {
      seen.add(e.block)
      order.push(e.block)
    }
  }

  const rows: WaveRow[] = []
  const rowOf = new Map<number, WaveRow>()
  const runs: ScheduleSegment[] = []
  const batchStarts: number[] = []
  let offset = 0
  let busy = 0
  let waiting = 0
  let hidden = 0
  for (let b = 0; b < order.length; b += resident) {
    const ids = order.slice(b, b + resident)
    const batch = batchStarts.length
    batchStarts.push(offset)
    for (const wave of ids) {
      const row: WaveRow = { wave, batch, segments: offset > 0 ? [{ kind: 'queued', start: 0, end: offset }] : [] }
      rows.push(row)
      rowOf.set(wave, row)
    }
    const members = new Set(ids)
    const tl = latencyTimeline(events.filter((e) => members.has(e.block)), { waves: resident })
    for (const s of tl.segments) {
      const segment = { kind: s.kind, start: s.start + offset, end: s.end + offset }
      append((rowOf.get(s.block) as WaveRow).segments, segment)
      if (s.kind === 'run') runs.push(segment)
    }
    busy += tl.busy
    waiting += tl.waiting
    hidden += tl.hidden
    offset += tl.cycles
  }

  const busySpans: { start: number; end: number }[] = []
  for (const r of runs.sort((x, y) => x.start - y.start)) {
    const last = busySpans[busySpans.length - 1]
    if (last && last.end === r.start) last.end = r.end
    else busySpans.push({ start: r.start, end: r.end })
  }
  return {
    waves: order.length,
    resident,
    batches: batchStarts.length,
    batchStarts,
    rows,
    busySpans,
    cycles: offset,
    busy,
    waiting,
    hidden,
    hiddenRatio: waiting === 0 ? 1 : hidden / waiting,
  }
}

/** 接在一行的末尾：和最后一段是同一种、首尾相接，就合成一段。 */
function append(segments: ScheduleSegment[], s: ScheduleSegment) {
  const last = segments[segments.length - 1]
  if (last && last.kind === s.kind && last.end === s.start) last.end = s.end
  else segments.push({ ...s })
}

// ── 写成数 ──────────────────────────────────────────────────────────────────

/** 比例写成整数百分比：0.5087 →「51%」。 */
export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** 倍数：一位小数（同 1-11）。 */
export function times(x: number): string {
  return x >= 100 ? String(Math.round(x)) : x.toFixed(1)
}

/** 读屏读整张时间线的那一句（SimdTimeline 的 aria-label）：住下几支、一共几个周期、藏住多少（模拟）。 */
export function scheduleSummary(s: Schedule): string {
  let who: string
  if (s.waves === 1) who = '只有 1 支小队'
  else if (s.batches === 1) who = `${s.waves} 支小队一起住下`
  else who = `${s.waves} 支小队，同时只住得下 ${s.resident} 支，分 ${s.batches} 批做`
  return `${who}；一共 ${s.cycles} 个周期，流水线在算 ${s.busy} 个周期；有小队在等的 ${s.waiting} 个周期里，`
    + `有 ${s.hidden} 个周期流水线在给别的小队算，等待藏住 ${percent(s.hiddenRatio)}（模拟）。`
}

// ── 热身、探索一：派几支小队 ────────────────────────────────────────────────

/** 探索一的旋钮：派几组。每人加的个数跟着变，正好把 PART_N 个数分完。 */
export const WAVE_OPTIONS = [1, 2, 4, 8, 16] as const
/** 默认只派 1 组：一支小队正好坐满 32 个工位，能跑但不好（03 第 1 节第 3 条）。 */
export const DEFAULT_WAVES = 1
/** 探索一里每个线程用的寄存器：够 16 支都住下，只看派几支。 */
export const EXPLORE_VGPRS = 32

/** 派 waves 组、正好分完 PART_N 个数的派法。 */
export function evenPlan(waves: number, vgprs: number = EXPLORE_VGPRS): Plan {
  return { waves, each: PART_N / (waves * WAVE), vgprs }
}

/**
 * 派 waves 组、16 支都住得下时，这条流水线做完 PART_N 个数要多少个周期（模拟）：L4 照工作单的事件流排出来的，
 * 正文、热身要在构建时写出来，所以写成常数；单测拿模拟器把两种写法都跑一遍核对。
 */
export const CYCLES_BY_WAVES: Readonly<Record<number, number>> = { 1: 6857, 2: 3439, 4: 1739, 8: 907, 16: 527 }

/** 探索一：派几组以后的那一句。 */
export function wavesText(waves: number, s: Schedule): string {
  if (waves === 1) {
    return `只有 1 支小队：它每算 ${STEPS_PER_FETCH} 步，就要去仓库等 ${FETCH_WAIT} 个周期，流水线这时没有别的小队可换。${s.cycles} 个周期里，流水线只算了 ${s.busy} 个周期，等待一点也没藏住（模拟）。`
  }
  return `${waves} 支小队轮流用流水线：一支去仓库等数据，另一支顶上来算。同样 ${PART_N} 个数，用时 ${s.cycles} 个周期，比只派 1 支快了 ${times(CYCLES_BY_WAVES[1] / s.cycles)} 倍；等待藏住了 ${percent(s.hiddenRatio)}（模拟）。`
}

// ── 探索二：每个线程用几个寄存器 ────────────────────────────────────────────

/** 探索二派 16 组、每人加 4 个，只换每个线程的寄存器。 */
export const REGISTER_WAVES = 16
export const VGPR_OPTIONS = [32, 64, 128, 256] as const
/** 默认 256 个：一个线程最多就能用这么多（params.ts 的 maxVgprs），能跑但不好。 */
export const DEFAULT_VGPRS = 256

/** 派 16 组时，每个线程用几个寄存器 → 这条流水线做完要多少个周期（模拟，单测核对）。 */
export const CYCLES_BY_VGPRS: Readonly<Record<number, number>> = { 32: 527, 64: 527, 128: 958, 256: 1820 }

/** 住得下几支、为什么：「1024 ÷ 128 = 8，寄存器只够住 8 支」。 */
export function seatsText(seats: Seats): string {
  if (seats.limiter === 'slots') return `寄存器够住 ${seats.byRegisters} 支，可名额只有 ${seats.slots} 个`
  const split = `${LANE_VGPRS} ÷ ${seats.vgprs} = ${seats.byRegisters}`
  if (seats.limiter === 'both') return `${split}，寄存器正好够住 ${seats.byRegisters} 支，名额也正好用完`
  return `${split}，寄存器只够住 ${seats.byRegisters} 支`
}

/** 探索二：换寄存器数以后的那一句，只写后果；住得下几支、怎么算的，写在 SeatChart 那一句（seatsText）。 */
export function registersText(vgprs: number, s: Schedule): string {
  const who = s.waves > s.resident
    ? `只住得下 ${s.resident} 支，另外 ${s.waves - s.resident} 支在门外等，分 ${s.batches} 批做`
    : `${s.waves} 支一起住下`
  return `每个线程 ${vgprs} 个寄存器：${who}。用时 ${s.cycles} 个周期，等待藏住了 ${percent(s.hiddenRatio)}（模拟）。`
}

// ── 原理：货架也占地方 ──────────────────────────────────────────────────────

/**
 * 货架的例子：每组一支小队、每个线程 32 个寄存器，每组用 kb KB 货架时，一个 WGP 住得下几组、
 * 平均每条流水线住几支（模拟）。一个 WGP 的 4 条流水线合用一排货架，住进来的组平均分到 4 条流水线上（L4 的 occupancy）。
 */
export function ldsSeats(kb: number) {
  const o = occupancy({ vgprs: EXPLORE_VGPRS, block: WAVE, lds: kb * 1024 })
  return { kb, groups: o.blocks, perSimd: o.wavesPerSimd, limiter: o.limiter }
}

/** 原理里的两个例子：每组 8 KB 时货架先用完，每组 2 KB 时正好住满名额。 */
export const LDS_EXAMPLES = [8, 2].map(ldsSeats)
/** 一个 WGP（两间打通的车间）的货架一共多少 KB、几条流水线（示意，同 params.ts，和 RX 9070 XT 一样）。 */
export const WGP_LDS_KB = SIM_PARAMS.ldsBytes / 1024
export const WGP_SIMDS = SIM_PARAMS.simds

// ── 挑战：给一条流水线排班 ──────────────────────────────────────────────────

/** 每人加几个，从少到多（同另外两个旋钮）。 */
export const EACH_OPTIONS = [2, 4, 8, 16, 32, 64] as const
/** 默认「能跑但不好」：只派 1 组、每人加 64 个，每个线程 256 个寄存器。 */
export const DEFAULT_PLAN: Readonly<Plan> = { waves: DEFAULT_WAVES, each: 64, vgprs: DEFAULT_VGPRS }

/** 草稿槽里读出来的可能是旧版本或被手改坏：不认识的值用默认值。 */
export function normalizePlan(raw: unknown): Plan {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pick = <T extends number>(options: readonly T[], value: unknown, fallback: number) =>
    options.includes(value as T) ? (value as number) : fallback
  return {
    waves: pick(WAVE_OPTIONS, r.waves, DEFAULT_PLAN.waves),
    each: pick(EACH_OPTIONS, r.each, DEFAULT_PLAN.each),
    vgprs: pick(VGPR_OPTIONS, r.vgprs, DEFAULT_PLAN.vgprs),
  }
}

/** 旋钮一动就写的一句（03 第 1 节第 4 条）：这样派，一共拿几个数，够不够、多不多。 */
export function coverText(plan: Plan): string {
  const threads = plan.waves * WAVE
  const taken = threads * plan.each
  const head = `一共 ${threads} 个线程，每人加 ${plan.each} 个：`
  if (taken === PART_N) return `${head}正好拿 ${PART_N} 个数。`
  if (taken > PART_N) return `${head}要拿 ${taken} 个数，可 a 只有 ${PART_N} 个。`
  return `${head}只拿 ${taken} 个数，还有 ${PART_N - taken} 个没人加。`
}

/** ★2 的目标：用时降到这么多个周期以内（模拟）。 */
export const TARGET_CYCLES = 1000
/** 最短：16 支小队一起住下（单测拿模拟器把所有派法都跑一遍核对：算对的派法里没有更快的）。 */
export const BEST_CYCLES = CYCLES_BY_WAVES[16]

export const STAR_LABELS = [
  `${PART_N} 个数都加进 part，每个数只加一次`,
  `用时降到 ${TARGET_CYCLES} 个周期以内（模拟）`,
  `用时最短（${BEST_CYCLES} 个周期，模拟）：派的小队一起住下，名额一个不空`,
] as const

/** 提示只在 ★1 没过时解锁（useChallenge），所以先帮读者把数分对，再指向快慢。 */
export const HINTS: Hints = {
  direction: `派的线程多了，每人就要少加几个：一共要正好拿 ${PART_N} 个数。分对以后再想想：只派 1 组时，那支小队去仓库等数据，流水线在干什么？`,
  location: `组数 × ${WAVE} × 每人加几个，要正好是 ${PART_N}：派 16 组时每人加 4 个。每个线程的寄存器用得多，一条流水线就住不下这么多小队。`,
  answer: `派 16 组、每人加 4 个，每个线程 64 个寄存器（32 个也行）：16 支小队一起住下，名额一个不空，用时 ${BEST_CYCLES} 个周期（模拟）。`,
}

/** 06 第 7 节：输入派法和模拟器的结果，输出三颗星各自成立没有和下一步的一句话；没过时给「现象 / 原因 / 怎么改」。 */
export interface Verdict {
  earned: [boolean, boolean, boolean]
  next: string
  error?: ChallengeError
}

/** ★1 不成立的原因：读到了 a 外面，或者有数没人加。都没有时是 null。 */
export function partProblem(plan: Plan, result: RunResult): ChallengeError | null {
  const p = normalizePlan(plan)
  const threads = p.waves * WAVE
  const taken = threads * p.each
  const fix = `每人加的个数要跟着派的线程改：${PART_N} ÷ ${threads} = ${PART_N / threads} 个。`
  if (result.diagnostics.some((d) => d.kind === 'oob-read' && d.array === 'a')) {
    return {
      symptom: `有线程读到了 a 外面：a 只有 ${PART_N} 个数。`,
      cause: `派了 ${threads} 个线程，每人加 ${p.each} 个，一共要拿 ${taken} 个数。`,
      fix,
    }
  }
  const sum = (result.arrays.part ?? []).reduce((total, v) => total + v, 0)
  if (sum !== PART_TOTAL) {
    return {
      symptom: `part 加起来是 ${sum}，应该是 ${PART_TOTAL}：有 ${PART_N - taken} 个数没人加。`,
      cause: `派了 ${threads} 个线程，每人只加 ${p.each} 个，一共只拿了 ${taken} 个数。`,
      fix,
    }
  }
  return null
}

/**
 * 星级判定：★1 每个数都加了一次、没读到 a 外面；★2 用时不超过 TARGET_CYCLES；★3 用时最短（BEST_CYCLES）。
 * ★1 不成立时一颗都不发。用时、被藏住的比例都由 schedule 照这次运行的事件流排出来。
 */
export function judge(plan: Plan, result: RunResult): Verdict {
  const p = normalizePlan(plan)
  if (!result.ok) {
    const error = explainError(result.error)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const error = partProblem(p, result)
  if (error) return { earned: [false, false, false], next: error.fix, error }

  const seats = seatsOf(p.vgprs)
  const s = schedule(result.events, seats.resident)
  const spent = `用时 ${s.cycles} 个周期，等待藏住了 ${percent(s.hiddenRatio)}（模拟）。`
  const outside = p.waves - seats.resident
  const crowded = `每个线程 ${p.vgprs} 个寄存器，一条流水线只住得下 ${seats.resident} 支`

  if (s.cycles > TARGET_CYCLES) {
    let next: string
    if (outside > 0) next = `派了 ${p.waves} 支小队，可${crowded}，另外 ${outside} 支在门外等、分 ${s.batches} 批做。${spent}每个线程少用一些寄存器。`
    else if (p.waves === 1) next = `只派了 1 支小队：它去仓库等数据时，没有别的小队能顶上来。${spent}多派几组，每人少加几个。`
    else next = `只派了 ${p.waves} 支小队：一支去仓库等数据时，能顶上来的小队太少。${spent}多派几组，每人少加几个。`
    return { earned: [true, false, false], next }
  }

  if (s.cycles > BEST_CYCLES) {
    let next: string
    if (outside > 0) next = `${spent}${crowded}，还有 ${outside} 支在门外等。再少用一些，让 ${p.waves} 支一起住下。`
    else if (seats.resident < SLOTS) next = `${p.waves} 支都住下了，可名额还空着 ${SLOTS - p.waves} 个，${crowded}。${spent}多派几组，再少用一些寄存器。`
    else next = `${p.waves} 支都住下了，可名额还空着 ${SLOTS - p.waves} 个。${spent}多派几组，每人少加几个。`
    return { earned: [true, true, false], next }
  }

  return {
    earned: [true, true, true],
    next: `${p.waves} 支小队一起住下，名额一个不空。${spent}三颗星的标准都达到了。`,
  }
}
