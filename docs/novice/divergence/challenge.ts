/**
 * 1-6 分岔路口：代码、数据和判定（纯函数，单测在 scripts/tests/novice-divergence.test.mjs）。
 *
 * 两段工作单都是「两种活」：条件成立的线程做加法（和写进 c），不成立的做减法（差写进 d）。
 * - 热身和探索一（scenes/ForkStepper.vue）：add_sub，偶数号的线程做加法、奇数号的做减法（FORK_CODE），
 *   派 1 组 32 个线程，正好一支小队；一步一步看两条路先后执行（WaveView）。
 * - 探索二（scenes/ForkSandbox.vue，part="fork"）：同一张工作单派 1 组 64 个线程（两支小队），读者改写分支条件。
 *   c、d 和线程一样多，一个线程只写自己那一格，什么条件都不会算错；judgeFork 只看有没有小队在岔路口分成两拨
 *   （探索环节，不发星）。
 * - 挑战（ForkSandbox，part="challenge"）：two_jobs，a、b 各 32 个数，c 放 32 个和、d 放 32 个差，派 1 组 64 个线程。
 *   读者补两个空：k（这个线程算第几格）和条件（谁做加法）。★1 和、差都算对；★2 没有一支小队分岔（lane 利用率 100%）；
 *   ★3 换成 64 个和、64 个差（派 128 个线程）再跑一次，照样算对、照样不分岔。
 *
 * 谁走了哪一边看写事件写的是 c 还是 d；lane 利用率用 WaveView 的算法（wave-view/model.ts 的
 * utilization(usage(prepareWave(...)))，S-07 定的）。两种写法的事件流和结果一样，判定也一样。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg, WaveSize } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, type Launch, type SandboxRun, type SandboxVariant } from '../../components/kit/sandbox/run.ts'
import { percent, prepareWave, usage, utilization, waveThreads, wavesRun } from '../../components/kit/wave-view/model.ts'

export const STAGE_ID = 'novice-divergence'

/** 一支小队几个人：RDNA 上编译器默认 32 人一队（第 1-5 关）。这一关只用 wave32。 */
export const WAVE: WaveSize = 32

/** 第 1-4 关的全局下标，这一关叫它 t。 */
export const GLOBAL_INDEX = 'blockIdx.x * blockDim.x + threadIdx.x'

// ── 工作单 ────────────────────────────────────────────────────────────────

/** add_sub：条件成立的线程把和写进 c[t]，不成立的把差写进 d[t]。cond 是 if 后面的条件。 */
function addSub(cond: string): Record<Lang, string> {
  return {
    hip: `__global__ void add_sub(float* a, float* b, float* c, float* d) {
    int t = ${GLOBAL_INDEX};
    if (${cond}) {
        c[t] = a[t] + b[t];
    } else {
        d[t] = a[t] - b[t];
    }
}`,
    python: `@kernel
def add_sub(a, b, c, d):
    t = ${GLOBAL_INDEX}
    if ${cond}:
        c[t] = a[t] + b[t]
    else:
        d[t] = a[t] - b[t]`,
  }
}

/** two_jobs：c、d 各只有 n 格，k 是这个线程算第几格。k、job 是两个空。 */
function twoJobs(k: Record<Lang, string>, job: string): Record<Lang, string> {
  return {
    hip: `__global__ void two_jobs(float* a, float* b, float* c, float* d, int n) {
    int t = ${GLOBAL_INDEX};
    int k = ${k.hip};
    if (${job}) {
        c[k] = a[k] + b[k];
    } else {
        d[k] = a[k] - b[k];
    }
}`,
    python: `@kernel
def two_jobs(a, b, c, d, n):
    t = ${GLOBAL_INDEX}
    k = ${k.python}
    if ${job}:
        c[k] = a[k] + b[k]
    else:
        d[k] = a[k] - b[k]`,
  }
}

/** 偶数号的线程做加法，奇数号的做减法：热身、探索一的条件，也是探索二那个空的初始内容。 */
export const FORK_COND = 't % 2 == 0'
export const FORK_CODE = addSub(FORK_COND)
export const FORK_TEMPLATE = addSub(`[[cond: ${FORK_COND}]]`)

/**
 * 每排 n 个数：a[k] = k + 1，b[k] = 10 × (k + 1)（同 1-3～1-5），c、d 一开始全是 0。
 * 和 c[k] = 11 × (k + 1)，差 d[k] = −9 × (k + 1)，都不是 0，没人算的格子一眼就看得出来。
 * add_sub 没有参数 n：多给的数据模拟器不用（08 第 4 节「参数」）。
 */
export function jobArgs(n: number): Record<string, Arg> {
  const a = Array.from({ length: n }, (_, k) => k + 1)
  return {
    a: { type: 'float', data: a },
    b: { type: 'float', data: a.map((v) => 10 * v) },
    c: { type: 'float', data: new Array<number>(n).fill(0) },
    d: { type: 'float', data: new Array<number>(n).fill(0) },
    n: { type: 'int', value: n },
  }
}

/** 启动那一行（1-2 定的写法）：先写派几组，再写每组几个线程。 */
export function launchLine(kernel: 'add_sub' | 'two_jobs', launch: Launch, lang: Lang): string {
  const args = kernel === 'add_sub' ? 'd_a, d_b, d_c, d_d' : 'd_a, d_b, d_c, d_d, n'
  return lang === 'hip'
    ? `${kernel}<<<${launch.grid}, ${launch.block}>>>(${args});`
    : `${kernel}[${launch.grid}, ${launch.block}](${args})`
}

// ── 探索一：两拨先后走 ────────────────────────────────────────────────────

/** 派 1 组 32 个线程：正好一支小队；c、d 各 32 格。 */
export const STEP_LAUNCH: Launch = { grid: 1, block: WAVE }

// ── 探索二：把岔路口挪到两支小队中间 ─────────────────────────────────────

/** 派 1 组 64 个线程：两支小队，t = 0～31 是第 0 支，32～63 是第 1 支；c、d 各 64 格。 */
export const FORK_LAUNCH: Launch = { grid: 1, block: 2 * WAVE }

/** 手机上的选项：会分岔的、只有一支分岔的、都不分岔的都有。 */
export const FORK_BLANKS = {
  cond: { label: '分支条件', choices: ['t % 2 == 0', 't % 4 == 0', 't < 16', 't < 32', 't < 48', 't >= 32'] },
}

export const FORK_HINTS: Hints = {
  direction: '第 0 支小队是 t = 0～31，第 1 支是 t = 32～63。条件怎样写，同一支小队里的线程才意见一致？',
  location: '按单双号分（t % 2）时，每支小队都有一半成立、一半不成立。换成按 t 的大小分：t 小于某个数的做加法。',
  answer: '条件写成 t < 32：第 0 支全做加法，第 1 支全做减法，两支都不分岔。',
}

// ── 谁走了哪一边 ──────────────────────────────────────────────────────────

/** 一个 lane 走了哪一边：add 做加法（写 c），sub 做减法（写 d），none 没有线程或两边都没走。 */
export type Job = 'add' | 'sub' | 'none'

export const JOB_NAME: Record<Exclude<Job, 'none'>, string> = { add: '加法', sub: '减法' }

/** 跑过的一支小队：第几组的第几支，管的 t（全局下标）从几到几，每个 lane 走了哪一边，走了几步，分没分岔。 */
export interface ForkRow {
  block: number
  wave: number
  first: number
  last: number
  /** 长度 = 小队大小，第一个是 lane 0 */
  lanes: Job[]
  adds: number
  subs: number
  steps: number
  /** 两边都有人走：这支小队在岔路口分成了两拨 */
  split: boolean
}

/** 一次运行里跑过的小队，按组号、组里第几支排好。写 c 的 lane 做的是加法，写 d 的做的是减法。 */
export function forkRows(run: SandboxRun): ForkRow[] {
  const { launch, result } = run
  const src = prepareWave(result, launch)
  const jobs = new Map<number, Job[]>()
  for (const e of result.events) {
    if (e.op !== 'store' || (e.array !== 'c' && e.array !== 'd')) continue
    const key = e.block * src.waves + e.wave
    let lanes = jobs.get(key)
    if (!lanes) {
      lanes = new Array<Job>(src.size).fill('none')
      jobs.set(key, lanes)
    }
    for (let lane = 0; lane < e.mask.length; lane++) if (e.mask[lane] === '1') lanes[lane] = e.array === 'c' ? 'add' : 'sub'
  }
  return wavesRun(src)
    .map(({ block, wave, steps }): ForkRow => {
      const lanes = jobs.get(block * src.waves + wave) ?? new Array<Job>(src.size).fill('none')
      const adds = lanes.filter((j) => j === 'add').length
      const subs = lanes.filter((j) => j === 'sub').length
      const first = block * launch.block + wave * src.size
      const last = first + waveThreads(src.size, launch.block, wave) - 1
      return { block, wave, first, last, lanes, adds, subs, steps, split: adds > 0 && subs > 0 }
    })
    .sort((x, y) => x.block - y.block || x.wave - y.wave)
}

/** 整段的 lane 利用率（0–1）：每一步干活的 lane 加起来，除以每一步的全部 lane（WaveView 的算法，模拟）。 */
export function laneRate(run: SandboxRun): number {
  return utilization(usage(prepareWave(run.result, run.launch)))
}

/** 「第 0 支」「第 0、1 支」；不止一组时带上组号。 */
function squadNames(rows: readonly ForkRow[], all: readonly ForkRow[]): string {
  const blocks = new Set(all.map((r) => r.block))
  if (blocks.size > 1) return rows.map((r) => `第 ${r.block} 组的第 ${r.wave} 支`).join('、')
  return `第 ${rows.map((r) => r.wave).join('、')} 支`
}

/** 一支没分岔的小队整队走了哪一边。 */
function wholeJob(r: ForkRow): string {
  if (r.adds) return '全做加法'
  if (r.subs) return '全做减法'
  return '两边都没走'
}

/**
 * 小队板上那一句：哪几支在岔路口分成两拨、各几个人走哪边，哪几支整队只走一边，整段的 lane 利用率。
 * 没分岔的按整队走的那一边合在一起说（第 0、1 支全做加法）。
 */
export function forkText(rows: readonly ForkRow[], rate: number): string {
  const parts: string[] = []
  const split = rows.filter((r) => r.split)
  const whole = rows.filter((r) => !r.split)
  if (rows.length === 1) {
    const r = rows[0]
    parts.push(r.split ? `这支小队在岔路口分成两拨：${r.adds} 个做加法、${r.subs} 个做减法` : `这支小队没有分岔，${wholeJob(r)}`)
  } else {
    if (split.length) {
      const same = split.every((r) => r.adds === split[0].adds && r.subs === split[0].subs)
      const each = same
        ? `${split.length > 1 ? '每支都是 ' : ''}${split[0].adds} 个做加法、${split[0].subs} 个做减法`
        : split.map((r) => `${squadNames([r], rows)} ${r.adds} 个做加法、${r.subs} 个做减法`).join('，')
      parts.push(`${split.length === rows.length ? `${rows.length} 支小队都` : squadNames(split, rows)}在岔路口分成两拨：${each}`)
    }
    if (whole.length) {
      const groups = new Map<string, ForkRow[]>()
      for (const r of whole) groups.set(wholeJob(r), [...(groups.get(wholeJob(r)) ?? []), r])
      const lead = whole.length === rows.length ? `${rows.length} 支小队都没有分岔：` : ''
      parts.push(lead + [...groups].map(([job, list]) => `${squadNames(list, rows)}${job}`).join('，') + (lead ? '' : '，没有分岔'))
    }
  }
  return `${parts.join('；')}。lane 利用率 ${percent(rate)}（模拟）。`
}

/** 有几支小队分岔的一句话（judge 的 next、探索二的「这次的问题」用）。 */
function splitSummary(rows: readonly ForkRow[], rate: number): string {
  const split = rows.filter((r) => r.split)
  const who = split.length === rows.length && rows.length > 1 ? `${rows.length} 支小队都` : `${squadNames(split, rows)}小队`
  return `${who}在岔路口分成了两拨，lane 利用率 ${percent(rate)}（模拟）。`
}

// ── 探索二的判定（探索环节，不发星）────────────────────────────────────────

/**
 * 探索二过没过：每支小队都只走一边，而且加法、减法都有人做。什么条件都不会把 c、d 算错，所以只看分岔。
 * 没过时写成「现象 / 原因 / 怎么改」（03 第 4 节）。
 */
export function judgeFork(runs: readonly SandboxRun[]): AttemptResult {
  const [main] = runs
  if (!main.result.ok) {
    const error = explainError(main.result.error)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const rows = forkRows(main)
  const rate = laneRate(main)
  const split = rows.filter((r) => r.split)
  if (split.length) {
    const error: ChallengeError = {
      symptom: splitSummary(rows, rate),
      cause: `同一支小队里，有的线程条件成立、有的不成立（${split.map((r) => `${squadNames([r], rows)} ${r.adds} 个成立、${r.subs} 个不成立`).join('，')}）。口令只有一个，两边只能先后各走一遍。`,
      fix: '让条件按小队的边界变：同一支小队的 32 个 t，要么都成立，要么都不成立。',
    }
    return { earned: [false, false, false], next: error.fix, error }
  }
  const adds = rows.reduce((s, r) => s + r.adds, 0)
  const subs = rows.reduce((s, r) => s + r.subs, 0)
  if (!adds || !subs) {
    const missing = adds ? '减法' : '加法'
    const error: ChallengeError = {
      symptom: `没有小队分岔，可${missing}没人做。`,
      cause: `条件对所有线程都${adds ? '成立' : '不成立'}，${adds ? 'else' : 'if'} 那一边整段跳过了。`,
      fix: '让一部分线程做加法、一部分做减法，同一支小队的线程还是只走一边。',
    }
    return { earned: [false, false, false], next: error.fix, error }
  }
  return { earned: [true, false, false], next: `两种活都有人做。${forkText(rows, rate)}` }
}

// ── 挑战：两种活 ──────────────────────────────────────────────────────────

/** 和、差各 32 个，派 1 组 64 个线程（两支小队）；★3 再换成各 64 个、派 128 个线程（四支小队）跑一次。 */
export const CHALLENGE_N = 32
export const WIDE_N = 64
export const CHALLENGE_LAUNCH: Launch = { grid: 1, block: 2 * CHALLENGE_N }
export const VARIANTS: SandboxVariant[] = [{ grid: 1, block: 2 * WIDE_N, args: jobArgs(WIDE_N) }]

/** 初始内容「能跑但不好」：按单双号分活，偶数号做加法、奇数号做减法，k = t / 2。和、差都算对，可每支小队都分岔。 */
export const CHALLENGE_CODE = twoJobs({ hip: '[[k: t / 2]]', python: '[[k: t // 2]]' }, `[[job: ${FORK_COND}]]`)

export const CHALLENGE_BLANKS = {
  k: { label: '第几格 k', choices: { hip: ['t / 2', 't % 32', 't % n', 't', 't - n'], python: ['t // 2', 't % 32', 't % n', 't', 't - n'] } },
  job: { label: '做加法的条件', choices: ['t % 2 == 0', 't < 16', 't < 32', 't < n', 't >= n'] },
}

export const STAR_LABELS = [
  `${CHALLENGE_N} 个和、${CHALLENGE_N} 个差都算对`,
  '没有一支小队在岔路口分成两拨（lane 利用率 100%）',
  `换成 ${WIDE_N} 个和、${WIDE_N} 个差（派 ${2 * WIDE_N} 个线程），同一份代码照样算对、照样不分岔`,
] as const

export const HINTS: Hints = {
  direction: '回想探索二：岔路口落在两支小队的交界上，就没有小队分岔。这里的交界在哪？',
  location: '两个空都要改。条件定谁做加法：前一半线程。k 定算第几格：后一半线程的 t 从 n 开始，差却要从 d[0] 算起。',
  answer: '条件写成 t < n，k 写成 t % n：前 n 个线程做加法，k 就是 t；后 n 个做减法，k 是 t − n。',
}

/** 一种活是谁做的：线程号 t 和它算到的格号 k（一一对应，越界的格号照样记）。 */
interface JobWork {
  threads: number[]
  cells: number[]
}

function jobWork(run: SandboxRun): Record<'add' | 'sub', JobWork> {
  const { launch, result } = run
  const out = { add: { threads: [] as number[], cells: [] as number[] }, sub: { threads: [] as number[], cells: [] as number[] } }
  for (const e of result.events) {
    if (e.op !== 'store' || !e.addrs || (e.array !== 'c' && e.array !== 'd')) continue
    const work = e.array === 'c' ? out.add : out.sub
    let k = 0
    for (let lane = 0; lane < e.mask.length; lane++) {
      if (e.mask[lane] !== '1') continue
      work.threads.push(e.block * launch.block + e.wave * result.wave + lane)
      work.cells.push(e.addrs[k++])
    }
  }
  return out
}

/** 一串格子写成「c[16]～c[31]」「c[1]、c[3]」：连着三格以上的并成一段（同 1-4、1-5）。 */
export function cellList(array: string, indices: readonly number[]): string {
  return runsOf(indices).map(([from, to]) => (to - from >= 2 ? `${array}[${from}]～${array}[${to}]` : from === to ? `${array}[${from}]` : `${array}[${from}]、${array}[${to}]`)).join('、')
}

/** 一串数（升序、不重复）写成「0～15」「0、2、4 等」：连着三个以上的并成一段，最多写 limit 段。 */
function numberList(values: readonly number[], limit = 3): string {
  const parts = runsOf(values).map(([from, to]) => (to - from >= 2 ? `${from}～${to}` : from === to ? `${from}` : `${from}、${to}`))
  return parts.length > limit ? `${parts.slice(0, limit).join('、')} 等` : parts.join('、')
}

/** 升序的数切成连着的几段 [起, 止]。 */
function runsOf(values: readonly number[]): [number, number][] {
  const out: [number, number][] = []
  for (const v of values) {
    const last = out[out.length - 1]
    if (last && v === last[1] + 1) last[1] = v
    else out.push([v, v])
  }
  return out
}

/**
 * 和、差算对了没有；没算对时写成「现象 / 原因 / 怎么改」（03 第 4 节）。工作单里每个线程正好写一格，
 * 所以算不对只有三种原因，按这个顺序找：两种活的线程数不对（条件的事）；k 超出 0～n−1（写到了数组外面）；
 * k 让两个线程算到同一格（有的格子就没人算）。后两种是 k 的事。
 */
function wrong(run: SandboxRun, n: number): ChallengeError | null {
  const { result } = run
  if (!result.ok) return explainError(result.error)
  const { a = [], b = [], c = [], d = [] } = result.arrays
  const missC = c.flatMap((v, k) => (v === a[k] + b[k] ? [] : [k]))
  const missD = d.flatMap((v, k) => (v === a[k] - b[k] ? [] : [k]))
  const outside = result.outside.filter((o) => o.array === 'c' || o.array === 'd').reduce((s, o) => s + o.writes.length, 0)
  if (!missC.length && !missD.length && !outside) return null

  const found: string[] = []
  if (missC.length) found.push(`${missC.length} 个和没人算：${cellList('c', missC)}`)
  if (missD.length) found.push(`${missD.length} 个差没人算：${cellList('d', missD)}`)
  if (outside) found.push(`有 ${outside} 次写到了 c、d 外面`)
  const raw = `运行后\nc = [${c.join(', ')}]\nd = [${d.join(', ')}]`
  const symptom = `${found.join('；')}。`

  const work = jobWork(run)
  const adds = work.add.threads.length
  const subs = work.sub.threads.length
  if (adds !== n || subs !== n) {
    return {
      symptom,
      cause: `做加法的线程有 ${adds} 个，做减法的有 ${subs} 个；可和、差各 ${n} 个，一个线程只算一格。`,
      fix: `改条件：让正好 ${n} 个线程做加法，另外 ${n} 个做减法。`,
      raw,
    }
  }
  for (const job of ['add', 'sub'] as const) {
    const array = job === 'add' ? 'c' : 'd'
    const cells = [...new Set(work[job].cells)].sort((x, y) => x - y)
    const fix = `改 k：让做${JOB_NAME[job]}的 ${n} 个线程正好分到 ${array}[0]～${array}[${n - 1}]，一人一格。`
    if (cells.some((k) => k < 0 || k >= n)) {
      return {
        symptom,
        cause: `做${JOB_NAME[job]}的线程算出的 k 是 ${numberList(cells)}，可 ${array} 只有 ${n} 格（${array}[0]～${array}[${n - 1}]）。`,
        fix,
        raw,
      }
    }
    if (cells.length < n) {
      return {
        symptom,
        cause: `做${JOB_NAME[job]}的 ${n} 个线程算出的 k 只有 ${cells.length} 种（${numberList(cells)}）：有的格子几个线程都算，有的格子没人算。`,
        fix,
        raw,
      }
    }
  }
  return { symptom, cause: '有的格子没人算。', fix: `检查 k：每种活的 ${n} 个线程要正好分到第 0～${n - 1} 格，一人一格。`, raw }
}

/**
 * 挑战的星级判定（06 第 7 节）：runs[0] 是 32 个和、32 个差（派 64 个线程），runs[1] 是 VARIANTS 那一次
 * （64 个和、64 个差，派 128 个线程）。★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」；
 * ★2 看 runs[0] 的 lane 利用率是不是 100%（没有一支小队分岔）；★3 看 runs[1] 算对、也不分岔。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, wide] = runs
  const error = wrong(main, CHALLENGE_N)
  if (error) return { earned: [false, false, false], next: error.fix, error }
  const rows = forkRows(main)
  const rate = laneRate(main)
  if (rate < 1) {
    return {
      earned: [true, false, false],
      next: `${splitSummary(rows, rate)}让同一支小队的线程做同一种活：岔路口要落在两支小队的交界上。改了条件，k 也要跟着改。`,
    }
  }
  if (!wide) return { earned: [true, true, false], next: '再换一批数据跑一次，才知道这份代码是不是总不分岔。' }
  const wideError = wrong(wide, WIDE_N)
  if (wideError) {
    return {
      earned: [true, true, false],
      next: `换成 ${WIDE_N} 个和、${WIDE_N} 个差就不对了：${wideError.symptom}${wideError.cause}同一份代码换了数据就不对，多半是哪里写死了 ${CHALLENGE_N}：换成 n。`,
    }
  }
  const wideRate = laneRate(wide)
  if (wideRate < 1) {
    return {
      earned: [true, true, false],
      next: `换成 ${WIDE_N} 个和、${WIDE_N} 个差，${splitSummary(forkRows(wide), wideRate)}岔路口要跟着 n 走，落在小队的交界上。`,
    }
  }
  return {
    earned: [true, true, true],
    next: `两批数据都算对了：${CHALLENGE_N} 个和、${CHALLENGE_N} 个差时 ${rows.length} 支小队，${WIDE_N} 个和、${WIDE_N} 个差时 ${forkRows(wide).length} 支，每支都只走一边，lane 利用率都是 100%（模拟）。三颗星的标准都达到了。`,
  }
}
