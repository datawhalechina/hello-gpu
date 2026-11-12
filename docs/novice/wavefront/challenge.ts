/**
 * 1-5 一起行动的小队：代码、数据和判定（纯函数，单测在 scripts/tests/novice-wavefront.test.mjs）。
 *
 * 这一关不改代码：工作单是 1-4 写好的向量加法（全局下标 + 边界检查，KERNEL），读者改的是派法。
 * - 探索一（scenes/SquadStepper.vue）：派 1 组 1 / 8 / 32 个线程，数据和线程一样多，一步一步看一支小队
 *   怎样一起走（seatsAt）。
 * - 探索二（scenes/SquadSplit.vue）：派 1 组 32 / 33 / 40 / 64 个线程，数据和线程一样多，看一组怎样排成小队。
 * - 挑战（scenes/SquadChallenge.vue）：128 对数，旋钮定每组几个线程、派几组；同样的派法按 32 人一队和
 *   64 人一队各跑一次。★1 128 个数都算对；★2 32 人一队时小队数最少；★3 64 人一队时小队数也最少。
 * 小队、空工位都从模拟器的事件流数出来（wave-view/model.ts 的 prepareWave），两种写法的结果一样。
 *
 * 小队数就是这一关的「效率」：一支小队不管坐了几个人，都占着一条流水线、听完它的每一个口令。
 * 不拿 lane 利用率判星：多派的小队也在算 i、做判断，这两步的利用率是 100%，可它一个数也没算。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg, WaveSize } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, type Launch, type SandboxRun } from '../../components/kit/sandbox/run.ts'
import {
  laneViews, prepareWave, waveThreads, wavesRun, type LaneState, type WaveSource,
} from '../../components/kit/wave-view/model.ts'

export const STAGE_ID = 'novice-wavefront'

/** 一支小队几个人：RDNA 上编译器默认 32 人一队（wave32）；★3 换成 64 人一队（wave64）。模拟器只认这两种。 */
export const WAVE: WaveSize = 32
export const WIDE: WaveSize = 64

export const GLOBAL_INDEX = 'blockIdx.x * blockDim.x + threadIdx.x'

/** 1-4 写好的工作单：先算全局下标，再做边界检查（同 1-4 原理里的那一段；kernel 的参数不写 const，同 1-3）。 */
export const KERNEL: Record<Lang, string> = {
  hip: `__global__ void add(float* a, float* b, float* c, int n) {
    int i = ${GLOBAL_INDEX};
    if (i < n) {
        c[i] = a[i] + b[i];
    }
}`,
  python: `@kernel
def add(a, b, c, n):
    i = ${GLOBAL_INDEX}
    if i < n:
        c[i] = a[i] + b[i]`,
}

/**
 * n 对数：a[k] = k + 1，b[k] = 10 × (k + 1)，c 一开始全是 0。算对时 c[k] = 11 × (k + 1)，
 * 每个都不是 0，没人算的格子一眼就看得出来（同 1-3、1-4）。
 */
export function addArgs(n: number): Record<string, Arg> {
  const a = Array.from({ length: n }, (_, k) => k + 1)
  return {
    a: { type: 'float', data: a },
    b: { type: 'float', data: a.map((v) => 10 * v) },
    c: { type: 'float', data: new Array<number>(n).fill(0) },
    n: { type: 'int', value: n },
  }
}

/** 组数向上取整：不够一组也得派一组。 */
export function minBlocks(n: number, blockDim: number): number {
  return Math.ceil(n / blockDim)
}

/** 启动那一行（1-2 定的写法）：先写派几组，再写每组几个线程。 */
export function launchLine(launch: Launch, lang: Lang): string {
  return lang === 'hip'
    ? `add<<<${launch.grid}, ${launch.block}>>>(d_a, d_b, d_c, n);`
    : `add[${launch.grid}, ${launch.block}](d_a, d_b, d_c, n)`
}

// ── 探索一：一个口令，整队一起动 ──────────────────────────────────────────

/** 派 1 组，旋钮选这一组派几个线程，数据和线程一样多。默认 32 个，正好一支坐满的小队。 */
export const STEP_THREADS = [1, 8, 32] as const
export const STEP_DEFAULT = 32

/** 单步执行器里的一个工位：有没有机器人、这一步在不在干活、机器人脚下写什么。 */
export interface SeatView {
  lane: number
  /** threadIdx.x；没有线程是 null */
  thread: number | null
  /** standby 待命（还没开始）；active 这一步在干活；idle 有线程、这一步被关掉；empty 没有线程 */
  state: LaneState
  /** 在干活的机器人脚下：写数组那一步是写的那一格（c[5]），判断那一步是「判断」，别的是「计算」；不干活是空串 */
  tag: string
}

/**
 * 单步走到第 position 步（0 是还没开始）时，这一步那个 wave 的每个工位。
 * 一个写事件的 addrs 按 lane 的顺序对应掩码里的 1（08 第 5 节）。
 */
export function seatsAt(src: WaveSource, position: number): SeatView[] {
  const step = position > 0 ? (src.steps[position - 1] ?? null) : null
  const lanes = laneViews(src.size, src.block, step?.wave ?? 0, step)
  if (!step) return lanes.map((l) => ({ ...l, tag: '' }))
  const tags = new Array<string>(src.size).fill(step.kind === 'branch' ? '判断' : '计算')
  for (let e = step.from; e < step.to; e++) {
    const event = src.events[e]
    if (event.op !== 'store' || !event.addrs) continue
    let k = 0
    for (let lane = 0; lane < event.mask.length; lane++) {
      if (event.mask[lane] === '1') tags[lane] = `${event.array}[${event.addrs[k++]}]`
    }
  }
  return lanes.map((l) => ({ ...l, tag: l.state === 'active' ? tags[l.lane] : '' }))
}

// ── 探索二：第 33 个线程 ────────────────────────────────────────────────

/** 派 1 组，数据和线程一样多（if (i < n) 一个也不拦）；默认 40 个，同探索二的「先猜」。 */
export const SPLIT_THREADS = [32, 33, 40, 64] as const
export const SPLIT_DEFAULT = 40

// ── 小队 ──────────────────────────────────────────────────────────────────

/** 一个工位：work 有线程、算了数（写了 c）；skip 有线程、被 if (i < n) 拦下；empty 没有线程。 */
export type Seat = 'work' | 'skip' | 'empty'

/** 跑过的一支小队：第几组的第几支，从哪个 threadIdx.x 开始，坐了几个人，几个人算了数，走了几步。 */
export interface Squad {
  block: number
  wave: number
  first: number
  members: number
  work: number
  steps: number
  /** 每个工位的样子，长度 = 小队大小 */
  seats: Seat[]
}

/** 一次运行里跑过的小队，按组号、组里第几支排好。 */
export function squadsOf(run: SandboxRun): Squad[] {
  const { launch, result } = run
  const src = prepareWave(result, launch)
  const wrote = new Map<number, Set<number>>()
  for (const e of result.events) {
    if (e.op !== 'store' || e.array !== 'c') continue
    const key = e.block * src.waves + e.wave
    const lanes = wrote.get(key) ?? new Set<number>()
    for (let lane = 0; lane < e.mask.length; lane++) if (e.mask[lane] === '1') lanes.add(lane)
    wrote.set(key, lanes)
  }
  return wavesRun(src)
    .map(({ block, wave, steps }) => {
      const members = waveThreads(src.size, launch.block, wave)
      const lanes = wrote.get(block * src.waves + wave) ?? new Set<number>()
      const seats = Array.from({ length: src.size }, (_, lane): Seat => (lane >= members ? 'empty' : lanes.has(lane) ? 'work' : 'skip'))
      return { block, wave, first: wave * src.size, members, work: lanes.size, steps, seats }
    })
    .sort((x, y) => x.block - y.block || x.wave - y.wave)
}

export interface SquadReport {
  /** 小队大小：32 或 64 */
  size: WaveSize
  squads: Squad[]
  /** 最少要几支小队：⌈n ÷ 小队大小⌉ */
  fewest: number
  /** 坐不满的小队有几支，空着的工位一共几个 */
  partial: number
  empty: number
  /** 一个数也没算的小队（线程都被 if (i < n) 拦下）有几支 */
  idle: number
}

/** n 是数据有几个（c 有几格）。 */
export function squadReport(run: SandboxRun, n: number): SquadReport {
  const squads = squadsOf(run)
  const size = run.result.wave
  let partial = 0
  let empty = 0
  for (const s of squads) {
    if (s.members < size) partial++
    empty += size - s.members
  }
  return { size, squads, fewest: Math.ceil(n / size), partial, empty, idle: squads.filter((s) => s.work === 0).length }
}

/** 探索二：一组排成了哪几支小队、每支走了几步。只派 1 组。 */
export function splitText(report: SquadReport): string {
  const { size, squads } = report
  const threads = squads.reduce((sum, s) => sum + s.members, 0)
  const steps = new Set(squads.map((s) => s.steps))
  const walked = steps.size === 1 ? `${squads.length === 1 ? '这支小队' : '每支小队都'}走了 ${[...steps][0]} 步。` : ''
  if (squads.length === 1 && threads === size) return `${threads} 个线程正好坐满 1 支小队。${walked}`
  const parts = squads.map((s) => `第 ${s.wave} 支 ${s.members} 人${s.members < size ? `，空着 ${size - s.members} 个工位` : ''}`)
  return `${threads} 个线程排成 ${squads.length} 支小队：${parts.join('；')}。${walked}`
}

/**
 * 挑战：一种小队大小下排成了几支、最少几支；坐不满的、一个数也没算的各有几支。
 * 线程不够（★1 没过）时也用它画小队板，所以「正好最少」要每支都坐满、都算了数才说。
 */
export function squadText(report: SquadReport, launch: Launch): string {
  const { size, squads, fewest, partial, empty, idle } = report
  const head = `${size} 人一队：排成 ${squads.length} 支小队`
  if (!partial && !idle && squads.length === fewest) return `${head}，正好最少，每支都坐满。`
  const parts = [squads.length > fewest ? `${head}，最少只要 ${fewest} 支` : head]
  if (partial) {
    const seated = launch.block < size
      ? `每组只有 ${launch.block} 个线程，坐不满一支`
      : `每组 ${launch.block} 个线程，每组最后一支只坐了 ${launch.block % size} 人`
    parts.push(`${seated}，${partial} 支没坐满的小队一共空着 ${empty} 个工位`)
  }
  if (idle) parts.push(`有 ${idle} 支小队的线程全被 if (i < n) 拦下，一个数也没算，照样占着流水线`)
  return `${parts.join('；')}。`
}

// ── 挑战：128 对数 ──────────────────────────────────────────────────────

export const CHALLENGE_N = 128
/** 每组几个线程的可选值：有 32 的整数倍，也有不是的；派几组 1–8（最多 1024 个线程，模拟器的上限）。 */
export const BLOCK_DIMS = [16, 24, 32, 48, 64, 96, 128] as const
export const GRID_MAX = 8
/** 默认「能跑但不好」：3 组 × 每组 48 个，128 个数都算对，可每组的第二支小队只坐了 16 人。 */
export const CHALLENGE_LAUNCH: Launch = { grid: 3, block: 48 }

export const STAR_LABELS = [
  `${CHALLENGE_N} 个数都算对`,
  '32 人一队时小队最少：每支都坐满，也不多派一支',
  '换成 64 人一队，同样的派法小队也最少',
] as const

export const HINTS: Hints = {
  direction: `先数一数：32 人一队，${CHALLENGE_N} 个数最少要几支小队？你现在排成了几支？`,
  location: '看每组几个线程：不是 32 的整数倍，每组最后一支小队就坐不满；线程派多了，还会多出一个数也不算的小队。',
  answer: '每组 64 个线程、派 2 组，或者每组 128 个、派 1 组：32 人一队时是 4 支，64 人一队时是 2 支，每支都坐满。',
}

/** ★3 再跑的那一次：同样的派法，换成 64 人一队。runs[0] 是 32 人一队的那一次。 */
export function wideLaunch(launch: Launch): Launch {
  return { grid: launch.grid, block: launch.block, wave: WIDE }
}

/** 草稿里读出来的旋钮值可能是旧版本或被手改坏：不认识的用默认值。 */
export function normalizeLaunch(raw: unknown): Launch {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const block = BLOCK_DIMS.find((b) => b === r.block) ?? CHALLENGE_LAUNCH.block
  const grid = typeof r.grid === 'number' && Number.isInteger(r.grid) && r.grid >= 1 && r.grid <= GRID_MAX ? r.grid : CHALLENGE_LAUNCH.grid
  return { grid, block }
}

// ── 判定 ─────────────────────────────────────────────────────────────────

/** 一串格子写成「c[96]～c[127]」「c[1]、c[3]」：连着三格以上的并成一段（同 1-4）。 */
export function cellList(indices: readonly number[]): string {
  const parts: string[] = []
  for (let k = 0; k < indices.length; k++) {
    let end = k
    while (end + 1 < indices.length && indices[end + 1] === indices[end] + 1) end++
    if (end - k >= 2) {
      parts.push(`c[${indices[k]}]～c[${indices[end]}]`)
      k = end
    } else {
      parts.push(`c[${indices[k]}]`)
    }
  }
  return parts.join('、')
}

/**
 * 算对了没有；没算对时写成「现象 / 原因 / 怎么改」（03 第 4 节）。工作单写死了全局下标和 if (i < n)，
 * 不会写到数组外面，也不会重复，没算对只能是线程不够。
 */
function wrong(run: SandboxRun): ChallengeError | null {
  const { launch, result } = run
  if (!result.ok) return explainError(result.error)
  const c = result.arrays.c ?? []
  const a = result.arrays.a ?? []
  const b = result.arrays.b ?? []
  const missing = c.flatMap((v, k) => (v === a[k] + b[k] ? [] : [k]))
  if (!missing.length) return null
  const threads = launch.grid * launch.block
  const raw = `运行后 c = [${c.join(', ')}]`
  return {
    symptom: `${missing.length} 个数没人算：${cellList(missing)}。`,
    cause: `一共只派出 ${threads} 个线程（${launch.grid} 组 × 每组 ${launch.block} 个），比 ${c.length} 个数少。`,
    fix: `组数要向上取整：每组 ${launch.block} 个，至少要派 ${minBlocks(c.length, launch.block)} 组。`,
    raw,
  }
}

/** 小队多了以后怎么改：有没坐满的，每组线程数取小队大小的整数倍；有一个数也没算的，组数取刚好够用。 */
function fewer(report: SquadReport): string {
  const tips: string[] = []
  if (report.partial) tips.push(`每组线程数取 ${report.size} 的整数倍`)
  if (report.idle || !tips.length) tips.push('组数取刚好够用')
  return `${report.size} 人一队排成了 ${report.squads.length} 支小队，最少只要 ${report.fewest} 支：${tips.join('，')}。`
}

/**
 * 挑战的星级判定（06 第 7 节）：runs[0] 是 32 人一队跑的，runs[1] 是同样的派法 64 人一队跑的（wideLaunch）。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」。next 只写下一步怎么改，哪支小队没坐满由小队板的 squadText 说。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, wide] = runs
  const error = wrong(main)
  if (error) return { earned: [false, false, false], next: error.fix, error }
  const n = (main.result.arrays.c ?? []).length
  const narrow = squadReport(main, n)
  if (narrow.squads.length > narrow.fewest) return { earned: [true, false, false], next: fewer(narrow) }
  if (!wide) return { earned: [true, true, false], next: '再换成 64 人一队跑一次，才知道这样派是不是也最少。' }
  const wideError = wrong(wide)
  if (wideError) return { earned: [true, true, false], next: `换成 64 人一队那一次没有跑好：${wideError.symptom}` }
  const broad = squadReport(wide, n)
  if (broad.squads.length > broad.fewest) return { earned: [true, true, false], next: `32 人一队已经最少了。${fewer(broad)}` }
  return {
    earned: [true, true, true],
    next: `32 人一队排成 ${narrow.squads.length} 支，64 人一队排成 ${broad.squads.length} 支，每支都坐满。三颗星的标准都达到了。`,
  }
}
