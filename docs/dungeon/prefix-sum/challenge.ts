/**
 * 新手村副本「前缀和入门」（X-03）：题目用到的代码、数据、解读和判定（纯函数，单测在 scripts/tests/dungeon-prefix-sum.test.mjs）。
 *
 * 题目：质检站查了一排 64 个零件，合格记 1、不合格记 0，存在 a 里。合格的零件要一个挨一个装箱，每个合格零件得知道自己排第几：
 * out[i] = a[0] + a[1] + … + a[i]，从第 0 个零件数到第 i 个，一共几个合格（前缀和）。派 1 组 64 个线程（两支小队），
 * 一个线程管一个零件。工作单是定的：每个线程先把自己那个数放上货架，第 1 轮把左边隔 1 格的数加过来，第 2 轮隔 2 格，
 * 第 3 轮隔 4 格……隔的格数每轮翻倍，6 轮以后每一格都是前缀和。
 * 读者改三个空：循环到哪为止、每一轮取之前等不等、取完放之前等不等。
 * - ★1 out 的 64 个数都对，没有数据竞争（也没有取到货架外面）。副本的 ★1 就是通关：发这道题的经验值，题解展开（X-01）。
 * - ★2 每支小队只等 13 次：放好以后一次，每一轮两次，不多走一轮（同 1-9：同步不是越多越好）。
 * - ★3 换成每组 128 个线程、每组 32 个线程，同一份代码照样成立（Sandbox 的 variants 连数据一起换）。
 * 初始内容「能跑但不对」：取之前等、取完放之前不等（等错了地方），终点写死 64。原样运行一颗星都没有：
 * 小队 0 把这一轮的和放上货架以后，小队 1 才来取，取到的是加过的数。
 *
 * 模拟器的约定决定了这道题看到的现象（08 第 4 节）：一组里的小队按编号轮流走，走到同步或者走完才换下一支；
 * 一支小队一起走，同一步里先读完再写。所以不等的时候，总是小队 1 取到小队 0 加过的数；同一支小队里碰巧取对，
 * 模拟器照样记数据竞争。真卡上先后不确定：正文和解读都写「模拟器里」，不说成硬件行为。
 * 两种写法的事件流（除了行号）和结果一样，判定也一样。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg, OobRead, Race, RunResult, SimEvent } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, stepGroups, type Launch, type SandboxRun, type SandboxVariant } from '../../components/kit/sandbox/run.ts'

export const EXERCISE_ID = 'dungeon-prefix-sum'

/** 一支小队 32 个线程（wave32，1-5）；派 1 组 64 个线程，两支小队。 */
export const WAVE = 32
export const BLOCK = 64
export const LAUNCH: Launch = { grid: 1, block: BLOCK }
/** 货架开 128 格：一组最多 128 个线程（静态共享数组要在编译时定大小，同 1-9），64 个线程时只用前 64 格。 */
export const SHELF = 128
export const SHELF_NAME = 'box'
export const OUT_NAME = 'out'

/** 第 j 个零件合不合格：自己定的一排，每 7 个里有 5 个合格（1011011 一直重复）。 */
export function flagAt(j: number): number {
  return (j * 5) % 7 < 5 ? 1 : 0
}

/** a 是 n 个零件合格（1）不合格（0），out 一开始全是 0。 */
export function scanArgs(n: number): Record<string, Arg> {
  return {
    a: { type: 'float', data: Array.from({ length: n }, (_, j) => flagAt(j)) },
    out: { type: 'float', data: new Array<number>(n).fill(0) },
  }
}

/** 前缀和：从第 0 个零件数到第 i 个，一共几个合格。out 最后应该是这些数。 */
export function prefixOf(n: number): number[] {
  let sum = 0
  return Array.from({ length: n }, (_, j) => (sum += flagAt(j)))
}

export const ARGS = scanArgs(BLOCK)

/** 隔的格数从 1 起每轮翻倍，翻到不小于每组的人数为止：要走几轮（64 个线程 6 轮）。 */
export function roundsFor(block: number): number {
  let rounds = 0
  for (let s = 1; s < block; s *= 2) rounds++
  return rounds
}

/** 每支小队最少等几次：放好以后一次，每一轮两次（取完放之前、放完下一轮取之前各一次）。 */
export function waitsFor(block: number): number {
  return 1 + 2 * roundsFor(block)
}

/** ★3 换的两种派法：每组 128 个、32 个线程，各配一批 a（同样从 1 数起）。写死 64 的代码会露馅。 */
export const VARIANT_BLOCKS = [128, 32] as const
export const VARIANTS: SandboxVariant[] = VARIANT_BLOCKS.map((block) => ({ grid: 1, block, args: scanArgs(block) }))

// ── 工作单 ───────────────────────────────────────────────────────────────

export const SYNC_CALL: Record<Lang, string> = { hip: '__syncthreads();', python: 'syncthreads()' }
export const NO_WAIT: Record<Lang, string> = { hip: '// 不等', python: '# 不等' }
const COMMENT: Record<Lang, string> = { hip: '//', python: '#' }
/** 行尾注释从第几列开始：同一张工作单里几行注释对齐。 */
const NOTE_COLUMN = 42

/** 一行代码加行尾注释。shown 是这一行显示出来的样子（模板里的空按初始内容算），用它对齐注释。 */
function withNote(code: string, note: string, lang: Lang, shown = code): string {
  return `${code}${' '.repeat(Math.max(1, NOTE_COLUMN - shown.length))}${COMMENT[lang]} ${note}`
}

/** 三处由读者来改：循环到哪为止、取之前等不等、取完放之前等不等。 */
interface Parts {
  stop: string
  stopShown?: string
  before: string
  between: string
}

function scanSource(lang: Lang, p: Parts): string {
  const stopShown = p.stopShown ?? p.stop
  const rows = lang === 'hip'
    ? [
        '__global__ void scan(float* a, float* out) {',
        withNote('    __shared__ float box[128];', '货架开 128 格', lang),
        '    int t = threadIdx.x;',
        withNote('    box[t] = a[t];', '放上自己那一格', lang),
        withNote('    __syncthreads();', '等整组都放好', lang),
        withNote('    int s = 1;', '这一轮往左隔几格取', lang),
        withNote(`    while (s < ${p.stop}) {`, '走到哪为止', lang, `    while (s < ${stopShown}) {`),
        `        ${p.before}`,
        '        float v = 0;',
        withNote('        if (t >= s) v = box[t - s];', '取：左边隔 s 格的数', lang),
        `        ${p.between}`,
        withNote('        box[t] += v;', '放：加到自己这一格', lang),
        withNote('        __syncthreads();', '等整组都放好', lang),
        withNote('        s = s * 2;', '下一轮隔的格数翻倍', lang),
        '    }',
        '    out[t] = box[t];',
        '}',
      ]
    : [
        '@kernel',
        'def scan(a, out):',
        withNote('    box = shared(128)', '货架开 128 格', lang),
        '    t = threadIdx.x',
        withNote('    box[t] = a[t]', '放上自己那一格', lang),
        withNote('    syncthreads()', '等整组都放好', lang),
        withNote('    s = 1', '这一轮往左隔几格取', lang),
        withNote(`    while s < ${p.stop}:`, '走到哪为止', lang, `    while s < ${stopShown}:`),
        `        ${p.before}`,
        '        v = 0.0',
        withNote('        if t >= s: v = box[t - s]', '取：左边隔 s 格的数', lang),
        `        ${p.between}`,
        withNote('        box[t] += v', '放：加到自己这一格', lang),
        withNote('        syncthreads()', '等整组都放好', lang),
        withNote('        s = s * 2', '下一轮隔的格数翻倍', lang),
        '    out[t] = box[t]',
      ]
  return rows.join('\n')
}

/** 循环的终点：初始写死 64；★3 要跟着每组的人数变。 */
export const STOPS = ['32', '64', '128', 'blockDim.x'] as const
export const DEFAULT_STOP = '64'
export const BEST_STOP = 'blockDim.x'

/** 初始内容：终点写死 64，取之前等，取完放之前不等。 */
export const CODE = Object.fromEntries((['hip', 'python'] as const).map((lang) => [lang, scanSource(lang, {
  stop: `[[stop: ${DEFAULT_STOP}]]`,
  stopShown: DEFAULT_STOP,
  before: `[[before: ${SYNC_CALL[lang]}]]`,
  between: `[[between: ${NO_WAIT[lang]}]]`,
})])) as Record<Lang, string>

/** 手机上的选项（两种写法按位置对应）。 */
export const BLANKS = {
  stop: { label: '循环走到哪为止（s 小于它就再走一轮）', choices: [...STOPS] },
  before: { label: '每一轮取之前：等不等', choices: { hip: [SYNC_CALL.hip, NO_WAIT.hip], python: [SYNC_CALL.python, NO_WAIT.python] } },
  between: { label: '取完、放之前：等不等', choices: { hip: [NO_WAIT.hip, SYNC_CALL.hip], python: [NO_WAIT.python, SYNC_CALL.python] } },
}

/** 启动那一行（1-2 定的写法）。 */
export function launchLine(lang: Lang): string {
  const { grid, block } = LAUNCH
  return lang === 'hip' ? `scan<<<${grid}, ${block}>>>(d_a, d_out);` : `scan[${grid}, ${block}](d_a, d_out)`
}

export const STAR_LABELS = [
  `out 的 ${BLOCK} 个数都对：每一格都是从第 0 个零件数到这一个，没有数据竞争`,
  `每支小队只等 ${waitsFor(BLOCK)} 次：放好以后一次，每一轮两次，不多走一轮`,
  `换成每组 ${VARIANT_BLOCKS[0]} 个、${VARIANT_BLOCKS[1]} 个线程，同一份代码照样对、照样不多等`,
] as const

export const HINTS: Hints = {
  direction: '看第一个不对的数 out[32]：线程 32 去取第 31 格的时候，线程 31 这一轮已经把左边的数加过来了吗？',
  location: '取（v = box[t - s]）和放（box[t] += v）之间要等：整组都取完，才能放。取之前那一行是多余的：上一轮最后已经等过了。终点要跟着每组的人数变。',
  answer: `取完、放之前写 ${SYNC_CALL.hip}（Python 风格写 ${SYNC_CALL.python}），取之前那一行改成不等；终点写 ${BEST_STOP}。`,
}

// ── 数一数 ─────────────────────────────────────────────────────────────────

/** 一个事件的掩码里，哪几个 lane 在做（按 lane 顺序，和 addrs 一一对应）。 */
function lanesOf(e: SimEvent): number[] {
  const out: number[] = []
  for (let k = 0; k < e.mask.length; k++) if (e.mask[k] === '1') out.push(k)
  return out
}

/** 每支小队在同步处等了几次：数每个 wave 的同步事件，取最多的那支。 */
export function waitsOf(events: readonly SimEvent[]): number {
  const counts = new Map<number, number>()
  let most = 0
  for (const e of events) {
    if (e.op !== 'barrier') continue
    const n = (counts.get(e.wave) ?? 0) + 1
    counts.set(e.wave, n)
    most = Math.max(most, n)
  }
  return most
}

/** 走了几轮：小队 0 「放」了几次（同一步里取货架、又往货架上写；放上自己那一格取的是 a，不算）。 */
export function roundsOf(events: readonly SimEvent[]): number {
  let rounds = 0
  for (const g of stepGroups(events)) {
    if (g.wave !== 0) continue
    const own = events.slice(g.from, g.to)
    const shelf = (op: SimEvent['op']) => own.some((e) => e.op === op && e.space === 'lds' && e.array === SHELF_NAME)
    if (shelf('load') && shelf('store')) rounds++
  }
  return rounds
}

/** 货架上的数据竞争，按先后分两种。 */
export interface ScanRaces {
  total: number
  /** 先写后取：取到的是别人这一轮已经加过的数（模拟器里就是这样取错的） */
  stale: Race[]
  /** 先取后写，或者两个都写：这一次碰巧取对了，可中间没有同步 */
  lucky: Race[]
}

export function scanRaces(result: RunResult): ScanRaces {
  const races: ScanRaces = { total: 0, stale: [], lucky: [] }
  for (const d of result.diagnostics) {
    if (d.kind !== 'race') continue
    races.total++
    if (d.first.op === 'write' && d.second.op === 'read') races.stale.push(d)
    else races.lucky.push(d)
  }
  return races
}

/** 一串数写成「32～62」「0、5」：连着的并成一段，最多写两段，再多写「等」。 */
export function spans(list: readonly number[], name: (v: number) => string = String): string {
  const runs: [number, number][] = []
  for (const v of [...new Set(list)].sort((p, q) => p - q)) {
    const last = runs[runs.length - 1]
    if (last && v === last[1] + 1) last[1] = v
    else runs.push([v, v])
  }
  const shown = runs.slice(0, 2).map(([from, to]) => (from === to ? name(from) : `${name(from)}～${name(to)}`))
  return `${shown.join('、')}${runs.length > 2 ? ' 等' : ''}`
}

/** 一次运行之后 out 的样子、走了几轮、等了几次、几处数据竞争。 */
export interface ScanCheck {
  block: number
  values: number[]
  expected: number[]
  /** out 里不对的下标 */
  wrong: number[]
  /** ★1：out 都对，没有数据竞争，没有读写到数组外面 */
  correct: boolean
  rounds: number
  waits: number
  races: ScanRaces
  oobReads: OobRead[]
  oobWrites: number
}

export function checkScan(run: SandboxRun): ScanCheck {
  const { result, launch } = run
  const expected = prefixOf(launch.block)
  const values = result.arrays[OUT_NAME] ?? []
  const wrong = expected.flatMap((v, i) => (values[i] === v ? [] : [i]))
  const races = scanRaces(result)
  const oobReads = result.diagnostics.filter((d): d is OobRead => d.kind === 'oob-read')
  const oobWrites = result.outside.reduce((n, o) => n + o.writes.length, 0)
  return {
    block: launch.block,
    values,
    expected,
    wrong,
    correct: result.ok && !wrong.length && !races.total && !oobReads.length && !oobWrites,
    rounds: roundsOf(result.events),
    waits: waitsOf(result.events),
    races,
    oobReads,
    oobWrites,
  }
}

/** 第几轮（隔 s 格取）：线程 t 取第 t - s 格，s 从 1 起每轮翻倍。 */
function roundOfGap(gap: number): number {
  return Math.round(Math.log2(gap)) + 1
}

/**
 * ★1 不成立时：说清现象、原因、怎么改（03 第 4 节）。按这个顺序找原因：
 * 代码出错；取到货架外面；取到了别人这一轮已经加过的数；轮数不够；out 碰巧对、可有数据竞争；都不是。
 */
function wrongText(run: SandboxRun, c: ScanCheck): ChallengeError {
  const { result } = run
  if (!result.ok) return explainError(result.error)
  const need = roundsFor(c.block)
  const first = c.wrong[0]
  const raw = [
    `out 不对的格子：${c.wrong.length} 个${c.wrong.length ? `（${spans(c.wrong, (v) => `out[${v}]`)}）` : ''}`,
    `走了几轮：${c.rounds}（${c.block} 个数要 ${need} 轮）`,
    `每支小队等了：${c.waits} 次`,
    `货架上的数据竞争：${c.races.total} 处（取到加过的数 ${c.races.stale.length} 处）`,
    `读到数组外面 ${c.oobReads.length} 次，写到数组外面 ${c.oobWrites} 次`,
  ].join('\n')
  const symptom = first === undefined
    ? `out 的 ${c.block} 个数碰巧都对，可模拟器在货架上记下 ${c.races.total} 处数据竞争。`
    : `out 有 ${c.wrong.length} 个数不对：比如 out[${first}] 应该是 ${c.expected[first]}，运行后是 ${c.values[first]}。`

  if (c.oobReads.length || c.oobWrites) {
    const d = c.oobReads[0]
    return {
      symptom: d
        ? `有 ${c.oobReads.length} 次读到了数组外面：比如线程 ${d.thread} 读 ${d.array}[${d.index}]，可 ${d.array} 只有第 0～${d.length - 1} 格（模拟器里读到 0）。`
        : `有 ${c.oobWrites} 次写到了数组外面。`,
      cause: '线程 t 取左边隔 s 格的数，可 t 小于 s 的线程左边没有那么多格：它们这一轮什么都不用取。',
      fix: '取之前的条件写 t >= s，只让左边有数的线程去取。',
      raw,
    }
  }
  if (c.races.stale.length) {
    const r = c.races.stale[0]
    const gap = r.second.thread - r.index
    const round = gap > 0 ? `在第 ${roundOfGap(gap)} 轮` : ''
    const squads = Math.floor(r.first.thread / result.wave) !== Math.floor(r.second.thread / result.wave)
      ? `线程 ${r.first.thread} 在小队 ${Math.floor(r.first.thread / result.wave)}，模拟器让它先走完这一轮，小队 ${Math.floor(r.second.thread / result.wave)} 才来取。`
      : ''
    return {
      symptom: `${symptom}线程 ${r.second.thread} ${round}取第 ${r.index} 格的时候，线程 ${r.first.thread} 这一轮已经把左边的数加进去了：取到的是加过的数。`,
      cause: `取完马上就放，没等整组都取完：别人还要取的格子，被这一轮的和盖掉了。${squads}真卡上谁先谁后说不准，错的格子也说不准。`,
      fix: `取完、放之前同步一次（HIP 风格写 ${SYNC_CALL.hip}，Python 风格写 ${SYNC_CALL.python}）：整组都取完这一轮要的数，再放。`,
      raw,
    }
  }
  if (first !== undefined && c.rounds < need) {
    const reach = 2 ** c.rounds
    return {
      symptom,
      cause: `循环只走了 ${c.rounds} 轮：每一格只加到了左边 ${reach - 1} 个数，${c.block} 个数要走 ${need} 轮。out[${reach}] 起，前面还有数没加进来。`,
      fix: '让循环一直走到 s 不小于每组的人数为止：每组几个线程，写在 blockDim.x 里。',
      raw,
    }
  }
  if (c.races.total) {
    const r = c.races.lucky[0]
    return {
      symptom: `${symptom}比如第 ${r.index} 格：线程 ${r.first.thread} 和线程 ${r.second.thread} 都碰了它，中间没有同步。`,
      cause: '同一支小队一起走，这一次碰巧取在放之前；不同的小队谁先谁后说不准，这一格可能先被加过，再被取走。',
      fix: `取完、放之前同步一次（HIP 风格写 ${SYNC_CALL.hip}，Python 风格写 ${SYNC_CALL.python}）；放完、下一轮取之前也要等，这一行已经写好了。`,
      raw,
    }
  }
  return {
    symptom,
    cause: '有的格子加错了：加了不止一次，或者少加了。',
    fix: '只改三个空：终点、取之前等不等、取完放之前等不等，取和放那两行保持原样。',
    raw,
  }
}

/** 等多了的那一句：多走了几轮，或者每一轮多等了。 */
function extraWaitText(c: ScanCheck): string {
  const need = roundsFor(c.block)
  const want = waitsFor(c.block)
  if (c.rounds > need) {
    return `多走了 ${c.rounds - need} 轮：s = ${2 ** need} 那一轮，t 都小于 s，没有线程要取，整组白等了。每支小队等了 ${c.waits} 次，${c.block} 个线程只要等 ${want} 次。`
  }
  return `每支小队等了 ${c.waits} 次，只要等 ${want} 次：取之前那一次是多余的。上一轮最后已经等过一次，大家都放好了，才走到这一轮。`
}

/** ★3 换派法再跑的那一次：哪里不成立，一句话；成立是 null。 */
function variantProblem(run: SandboxRun): string | null {
  const c = checkScan(run)
  const lead = `换成每组 ${c.block} 个线程再跑一次`
  if (!run.result.ok) return `${lead}，程序出错了：${run.result.error.message}`
  if (!c.correct) {
    const error = wrongText(run, c)
    const fixed = c.rounds < roundsFor(c.block) ? '终点是不是写死了？每组几个线程，写在 blockDim.x 里。' : error.fix
    return `${lead}，${error.symptom}${fixed}`
  }
  if (c.waits > waitsFor(c.block)) {
    const fixed = c.rounds > roundsFor(c.block) ? '终点要跟着每组的人数变：写 blockDim.x。' : ''
    return `${lead}，${extraWaitText(c)}${fixed}`
  }
  return null
}

/**
 * 星级判定（06 第 7 节）：runs[0] 是每组 64 个线程的那一次，后面是 VARIANTS 的两次（每组 128 个、32 个线程）。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」；★2 看每支小队等的次数；★3 看换了派法还成不成立。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, ...others] = runs
  const c = checkScan(main)
  if (!c.correct) {
    const error = wrongText(main, c)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const head = `out 的 ${c.block} 个数都对，没有数据竞争（模拟）：${c.rounds} 轮就加完了，out[${c.block - 1}] = ${c.values[c.block - 1]}。`
  if (c.waits > waitsFor(c.block)) return { earned: [true, false, false], next: `${head}${extraWaitText(c)}` }
  if (!others.length) return { earned: [true, true, false], next: `${head}再换一种派法跑一次，才知道代码里有没有写死的数。` }
  for (const other of others) {
    const problem = variantProblem(other)
    if (problem) return { earned: [true, true, false], next: `${head}每支小队只等了 ${c.waits} 次。${problem}` }
  }
  const tried = others.map((o) => `${o.launch.block} 个`).join('、')
  return {
    earned: [true, true, true],
    next: `${head}每支小队只等了 ${c.waits} 次；换成每组 ${tried}线程也照样对、照样不多等。三颗星的标准都达到了。`,
  }
}

/** 沙盒结果插槽里一次运行的一句话：out 对了几个、几处数据竞争、走了几轮、每支小队等了几次。 */
export function runSummary(run: SandboxRun): string {
  const { result, launch } = run
  const lead = `每组 ${launch.block} 个线程`
  if (!result.ok) return `${lead}：程序没有跑完。`
  const c = checkScan(run)
  const outText = c.wrong.length ? `out 有 ${c.wrong.length} 个不对` : `out 的 ${c.block} 个都对`
  const raceText = c.races.total ? `${c.races.total} 处数据竞争` : '没有数据竞争'
  return `${lead}：${outText}，${raceText}；走了 ${c.rounds} 轮，每支小队等了 ${c.waits} 次（模拟）。`
}

// ── 货架板：照着事件流重算货架上每一格的数 ──────────────────────────────────

export interface ScanSlot {
  index: number
  /** 这一格现在的数；还没放、或者重算对不上（不写数）时是 null */
  value: number | null
  filled: boolean
  /** 这一步放了这一格 */
  put: boolean
  /** 这一步取了这一格 */
  taken: boolean
  /** 到这一步为止，有线程取这一格时，取到的是别人这一轮已经加过的数 */
  stale: boolean
}

export interface ScanCell {
  index: number
  value: number | null
  state: 'blank' | 'right' | 'wrong'
  /** 这一步存了这一格 */
  now: boolean
}

export interface ScanBoardData {
  slots: ScanSlot[]
  out: ScanCell[]
  /** 重算出来的 out 和模拟器的结果对得上（读者把取、放两行改成别的写法时可能对不上，货架板就不写数） */
  exact: boolean
}

/**
 * 照着事件流把前 end 个事件重做一遍：每一步先算每个线程读到的数加起来是多少；
 * 只读不写的一步是「取」，读到的数留在这个线程手上（v）；写的那一步，写进去的是这一步读到的数加上手上的数，手上的数用掉。
 * 这道题的工作单只有这几种语句：放（box[t] = a[t]）、取（v = box[t - s]）、放（box[t] += v）、存（out[t] = box[t]）。
 */
function replay(result: RunResult, args: Readonly<Record<string, Arg>>, end: number) {
  const arrays: Record<string, number[]> = {}
  for (const [name, arg] of Object.entries(args)) if ('data' in arg) arrays[name] = Array.from(arg.data)
  const shelf = new Array<number | null>(SHELF).fill(null)
  const carry = new Map<number, number>()
  const { events } = result
  for (const g of stepGroups(events)) {
    if (g.from >= end) break
    const own = events.slice(g.from, Math.min(g.to, end))
    const sums = new Map<number, number>()
    for (const e of own) {
      if (e.op !== 'load') continue
      const lanes = lanesOf(e)
      const addrs = e.addrs ?? []
      addrs.forEach((index, k) => {
        const v = e.space === 'lds' ? shelf[index] ?? 0 : arrays[e.array ?? '']?.[index] ?? 0
        sums.set(lanes[k], (sums.get(lanes[k]) ?? 0) + v)
      })
    }
    const stores = own.filter((e) => e.op === 'store')
    if (!stores.length) {
      for (const [lane, v] of sums) carry.set(g.wave * result.wave + lane, v)
      continue
    }
    for (const e of stores) {
      const lanes = lanesOf(e)
      const addrs = e.addrs ?? []
      addrs.forEach((index, k) => {
        const thread = g.wave * result.wave + lanes[k]
        const v = (sums.get(lanes[k]) ?? 0) + (carry.get(thread) ?? 0)
        if (e.space === 'lds') {
          if (index >= 0 && index < SHELF) shelf[index] = v
        } else {
          const data = arrays[e.array ?? '']
          if (data && index >= 0 && index < data.length) data[index] = v
        }
      })
      for (const lane of lanes) carry.delete(g.wave * result.wave + lane)
    }
  }
  return { shelf, arrays }
}

/**
 * 货架板：货架上前 blockDim.x 格和 out 到前 upto 个事件为止的样子；[from, upto) 是这一步的事件，标出这一步取的、放的、存的格子。
 * 取到别人这一轮已经加过的数（模拟器记下的「先写后取」数据竞争），从取的那一步起标出来。
 */
export function scanBoard(
  result: RunResult, launch: Launch, args: Readonly<Record<string, Arg>>, upto = result.events.length, from = upto,
): ScanBoardData {
  const end = Math.min(upto, result.events.length)
  const state = replay(result, args, end)
  const full = end >= result.events.length ? state : replay(result, args, result.events.length)
  const final = result.arrays[OUT_NAME] ?? []
  const exact = (full.arrays[OUT_NAME] ?? []).every((v, i) => v === final[i])
  const lastStep = end > 0 ? result.events[end - 1].step : -1
  const stale = new Set(scanRaces(result).stale.filter((r) => r.second.step <= lastStep).map((r) => r.index))
  const expected = prefixOf(launch.block)
  const now = result.events.slice(Math.min(from, end), end)

  const slots: ScanSlot[] = Array.from({ length: launch.block }, (_, index) => ({
    index,
    value: exact ? state.shelf[index] : null,
    filled: state.shelf[index] !== null,
    put: false,
    taken: false,
    stale: stale.has(index),
  }))
  const out: ScanCell[] = Array.from({ length: launch.block }, (_, index) => ({ index, value: null, state: 'blank', now: false }))
  const written = new Set<number>()
  for (const e of result.events.slice(0, end)) {
    if (e.op === 'store' && e.space === 'global' && e.array === OUT_NAME) for (const i of e.addrs ?? []) written.add(i)
  }
  for (const i of written) {
    const cell = out[i]
    if (!cell) continue
    cell.value = state.arrays[OUT_NAME]?.[i] ?? null
    cell.state = exact && cell.value === expected[i] ? 'right' : 'wrong'
    if (!exact) cell.value = final[i] ?? null
  }
  for (const e of now) {
    for (const index of e.addrs ?? []) {
      if (e.space === 'lds' && e.array === SHELF_NAME && slots[index]) {
        if (e.op === 'load') slots[index].taken = true
        else slots[index].put = true
      } else if (e.space === 'global' && e.array === OUT_NAME && e.op === 'store' && out[index]) {
        out[index].now = true
      }
    }
  }
  return { slots, out, exact }
}

/** 单步时的一句话：这一步是哪支小队，放、取、存了哪几格，第几轮；取到了加过的数也写出来。别的步交给沙盒自己的说明。 */
export function stepStory(result: RunResult, index: number): string {
  const g = stepGroups(result.events)[index]
  if (!g) return ''
  const own = result.events.slice(g.from, g.to)
  const squad = `小队 ${g.wave}`
  const shelfOp = (op: SimEvent['op']) => own.find((e) => e.op === op && e.space === 'lds' && e.array === SHELF_NAME)
  const load = shelfOp('load')
  const store = shelfOp('store')
  const out = own.find((e) => e.op === 'store' && e.space === 'global' && e.array === OUT_NAME)
  if (store && !load) return `${squad}：${store.addrs?.length ?? 0} 个线程把 a 里的数放上货架的第 ${spans(store.addrs ?? [])} 格。`
  if (store && load) return `${squad}：${store.addrs?.length ?? 0} 个线程把手上的数加到自己那一格（第 ${spans(store.addrs ?? [])} 格）。`
  if (out) return `${squad}：${out.addrs?.length ?? 0} 个线程把货架上的数存进 ${spans(out.addrs ?? [], (v) => `out[${v}]`)}。`
  if (!load) return ''
  const lanes = lanesOf(load)
  const addrs = load.addrs ?? []
  const gap = g.wave * result.wave + lanes[0] - addrs[0]
  const head = `${squad} 第 ${roundOfGap(gap)} 轮：${addrs.length} 个线程各取左边隔 ${gap} 格的数（第 ${spans(addrs)} 格），拿在手上。`
  const stale = scanRaces(result).stale.filter((r) => r.second.step === g.step).map((r) => r.index)
  return stale.length ? `${head}其中第 ${spans(stale)} 格这一轮已经被加过了：取到的是加过的数。` : head
}
