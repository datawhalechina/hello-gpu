/**
 * 1-9 车间里的货架：两段实验台和挑战用到的代码、数据、解读和判定（纯函数，单测在 scripts/tests/novice-lds-sync.test.mjs）。
 *
 * - 探索一（scenes/ShelfLab.vue 的 watch）：flip，派 1 组 64 个线程（两支小队）。每个线程把 a[i] 放上货架的第 t 格，
 *   同步，再取对面那一格（第 63 - t 格）存进 out[i]。一步一步看：先放好的小队停在同步处，等整组都放好。
 * - 探索二（scenes/ShelfLab.vue 的 move）：同一张工作单，旋钮把同步挪到放之前，或者删掉。放完没等就取，有的格子取早了。
 * - 挑战（scenes/FlipSandbox.vue）：派 2 组、每组 64 个线程，每组把自己的 64 个数倒过来。读者补三个空：
 *   放之前等不等、放和取之间等不等、取第几格。★1 每组都倒过来了、没有数据竞争；★2 每支小队只等一次；
 *   ★3 换成 4 组、每组 32 个线程，同一份代码照样成立（Sandbox 的 variants 再跑一次）。
 * - 货架板（scenes/ShelfBoard.vue）：shelfBoard 从事件流算出每组货架上每一格、out 每一格到这一步为止的样子。
 *
 * 模拟器的两条约定决定了这一关看到的现象（08 第 4 节）：同一个 block 里，一个 wave 跑到同步或结束才换下一个，
 * 所以没有同步时，小队 0 总是先取、取早；共享数组每个 block 开始时是 0，所以取早的格子读到 0。
 * 真卡上 wave 交错执行，先后不确定，货架也不会清零：正文和解读都写「模拟器里」，不说成硬件行为。
 * 两种写法的事件流（除了行号）一样，解读和判定也一样。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES, formatParam } from '../../course/hardware.ts'
import type { Arg, OobRead, Race, RunResult, SimEvent } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { describeStep, explainError, stepGroups, type Launch, type SandboxRun, type SandboxVariant } from '../../components/kit/sandbox/run.ts'
import { prepareWave, syncProgress, waveStates, type WaveStatus } from '../../components/kit/wave-view/model.ts'

export const STAGE_ID = 'novice-lds-sync'

// ── 硬件参数：从 hardware.json 读（09 第 4 节），正文不手写 ─────────────────

const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
export const DEVICE_NAME = HW.name
export const ARCH = formatParam(HW.params.arch)
/** 几个计算单元合成一个 WGP、每个 WGP 的 LDS 多大、一个线程块最多分到多少 LDS。 */
export const CUS_PER_WGP = formatParam(HW.params.cusPerWgp)
export const LDS_PER_WGP = formatParam(HW.params.ldsPerWgp)
export const LDS_PER_BLOCK = formatParam(HW.params.ldsPerBlock)

// ── 工作单：倒过来放 ──────────────────────────────────────────────────────

/** 一支小队 32 个线程（wave32，1-5）。 */
export const WAVE = 32
/** 货架开 64 格（__shared__ float s[64]）：一组最多 64 个线程，每人一格。 */
export const SHELF = 64
/** 工作单里货架（共享数组）的名字。 */
export const SHELF_NAME = 's'
/** 两段实验台：派 1 组 64 个线程，排成两支小队。 */
export const LAB_LAUNCH: Launch = { grid: 1, block: SHELF }
/** 挑战：派 2 组、每组 64 个线程，一共 128 个数。 */
export const FLIP_LAUNCH: Launch = { grid: 2, block: SHELF }
/** ★3 换一种派法：4 组、每组 32 个线程，还是这 128 个数。 */
export const VARIANT_LAUNCH: Launch = { grid: 4, block: WAVE }

/** a[j] = j + 1（同 1-7、1-8，从 1 数起）。 */
export function aValue(j: number): number {
  return j + 1
}

/** a 有 n 个数，out 一开始全是 0。 */
export function flipArgs(n: number): Record<string, Arg> {
  return {
    a: { type: 'float', data: Array.from({ length: n }, (_, j) => aValue(j)) },
    out: { type: 'float', data: new Array<number>(n).fill(0) },
  }
}

/** 每组把自己那一段倒过来：block b 的第 t 个线程存 out[b × B + t] = a[b × B + (B - 1 - t)]。 */
export function flipExpected(launch: Launch): number[] {
  const { grid, block } = launch
  return Array.from({ length: grid * block }, (_, k) => {
    const b = Math.floor(k / block)
    return aValue(b * block + (block - 1 - (k % block)))
  })
}

export const LAB_ARGS = flipArgs(LAB_LAUNCH.grid * LAB_LAUNCH.block)
export const FLIP_ARGS = flipArgs(FLIP_LAUNCH.grid * FLIP_LAUNCH.block)
/** 换派法再跑一次：数据不变（4 × 32 也是 128 个数），用沙盒自己的 args。 */
export const FLIP_VARIANTS: SandboxVariant[] = [{ ...VARIANT_LAUNCH }]

/** 同步那一行（08 第 3 节）。 */
export const SYNC_CALL: Record<Lang, string> = { hip: '__syncthreads();', python: 'syncthreads()' }
const COMMENT: Record<Lang, string> = { hip: '//', python: '#' }
/** 行尾注释从第几列开始：同一张工作单里几行注释对齐。 */
const NOTE_COLUMN = 32

/** 一行代码加行尾注释。shown 是这一行显示出来的样子（模板里的空按初始内容算），用它对齐注释。 */
function withNote(code: string, note: string, lang: Lang, shown = code): string {
  return `${code}${' '.repeat(Math.max(1, NOTE_COLUMN - shown.length))}${COMMENT[lang]} ${note}`
}

/** 同步写在哪：放和取之间、放之前，或者删掉。 */
export type WaitAt = 'between' | 'before' | 'none'
export const WAITS: readonly { value: WaitAt; label: string }[] = [
  { value: 'between', label: '放和取之间' },
  { value: 'before', label: '放之前' },
  { value: 'none', label: '删掉' },
]
export const DEFAULT_WAIT: WaitAt = 'between'

/** 取第几格：初始写法把 63 写死（每组 64 个线程时正好是对面那一格）；★3 要跟着每组的人数变。 */
export const DEFAULT_TAKE = '63 - t'
export const BEST_TAKE = 'blockDim.x - 1 - t'

interface FlipParts {
  /** 放之前、放和取之间那一行；null 是没有这一行 */
  before: string | null
  between: string | null
  /** 取第几格（方括号里的那一段） */
  take: string
  /** take 显示出来的样子（模板里是空的初始内容），对齐注释用 */
  takeShown?: string
}

/** flip 的工作单：货架开 64 格；t 是组内编号，i 是全局下标；放上第 t 格，再取对面那一格。 */
function flipSource(lang: Lang, parts: FlipParts): string {
  const hip = lang === 'hip'
  const end = hip ? ';' : ''
  const rows = hip
    ? [
        '__global__ void flip(float* a, float* out) {',
        withNote('    __shared__ float s[64];', '货架开 64 格', lang),
        '    int t = threadIdx.x;',
        '    int i = blockIdx.x * blockDim.x + t;',
      ]
    : [
        '@kernel',
        'def flip(a, out):',
        withNote('    s = shared(64)', '货架开 64 格', lang),
        '    t = threadIdx.x',
        '    i = blockIdx.x * blockDim.x + t',
      ]
  if (parts.before !== null) rows.push(parts.before)
  rows.push(withNote(`    s[t] = a[i]${end}`, '放上货架的第 t 格', lang))
  if (parts.between !== null) rows.push(parts.between)
  const take = `    out[i] = s[${parts.take}]${end}`
  rows.push(withNote(take, '取对面那一格', lang, `    out[i] = s[${parts.takeShown ?? parts.take}]${end}`))
  if (hip) rows.push('}')
  return rows.join('\n')
}

/** 实验台的工作单：同步写在放和取之间、放之前，或者删掉；取第 63 - t 格。 */
export function labCode(wait: WaitAt, lang: Lang): string {
  return flipSource(lang, {
    before: wait === 'before' ? withNote(`    ${SYNC_CALL[lang]}`, '等整组到齐', lang) : null,
    between: wait === 'between' ? withNote(`    ${SYNC_CALL[lang]}`, '等整组都放好', lang) : null,
    take: DEFAULT_TAKE,
  })
}

/** 挑战的工作单：三个空。初始两次同步都写着，取第 63 - t 格：能跑但不好（多等一次，换派法就不对）。 */
export const FLIP_CODE = Object.fromEntries((['hip', 'python'] as const).map((lang) => [lang, flipSource(lang, {
  before: `    [[before: ${SYNC_CALL[lang]}]]`,
  between: `    [[between: ${SYNC_CALL[lang]}]]`,
  take: `[[take: ${DEFAULT_TAKE}]]`,
  takeShown: DEFAULT_TAKE,
})])) as Record<Lang, string>

/** 不等：手机上的选项写成一行注释（空选项在下拉框里看不出来）。 */
export const NO_WAIT: Record<Lang, string> = { hip: '// 不等', python: '# 不等' }
const WAIT_CHOICES = { hip: [SYNC_CALL.hip, NO_WAIT.hip], python: [SYNC_CALL.python, NO_WAIT.python] }

/** 手机上的选项：两处同步等不等；取第几格（写死 63、多算一格、按全局下标数、跟着每组的人数变）。 */
export const FLIP_BLANKS = {
  before: { label: '放之前：等不等', choices: WAIT_CHOICES },
  between: { label: '放和取之间：等不等', choices: WAIT_CHOICES },
  take: { label: '取货架的第几格', choices: [DEFAULT_TAKE, '64 - t', '63 - i', BEST_TAKE] },
}

/** 启动那一行（1-2 定的写法）。 */
export function flipLaunchLine(launch: Launch, lang: Lang): string {
  return lang === 'hip'
    ? `flip<<<${launch.grid}, ${launch.block}>>>(d_a, d_out);`
    : `flip[${launch.grid}, ${launch.block}](d_a, d_out)`
}

// ── 数一数：等了几次、几处数据竞争 ─────────────────────────────────────────

/** 每支小队在同步处等了几次：数每个 wave 的同步事件，取最多的那支。没有同步是 0。 */
export function waitsOf(events: readonly SimEvent[]): number {
  const counts = new Map<string, number>()
  let most = 0
  for (const e of events) {
    if (e.op !== 'barrier') continue
    const key = `${e.block}:${e.wave}`
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    most = Math.max(most, n)
  }
  return most
}

/** 货架上的数据竞争（模拟器的诊断），按先后分三种。 */
export interface ShelfRaces {
  total: number
  /** 先取后放：取的时候这一格还没放，取早了 */
  early: Race[]
  /** 先放后取，可中间没有同步：这一次碰巧取对了 */
  lucky: Race[]
  /** 别的冲突：两个线程都往同一格放 */
  other: Race[]
}

export function shelfRaces(result: RunResult): ShelfRaces {
  const races: ShelfRaces = { total: 0, early: [], lucky: [], other: [] }
  for (const d of result.diagnostics) {
    if (d.kind !== 'race' || d.space !== 'lds') continue
    races.total++
    if (d.first.op === 'read') races.early.push(d)
    else if (d.second.op === 'read') races.lucky.push(d)
    else races.other.push(d)
  }
  return races
}

/** 一串数分成连着的几段（往上、往下数都算连着）。 */
function runsOf(list: readonly number[]): [number, number][] {
  const runs: [number, number][] = []
  for (const v of list) {
    const last = runs[runs.length - 1]
    if (last) {
      const dir = Math.sign(last[1] - last[0])
      const step = v - last[1]
      if (Math.abs(step) === 1 && (dir === 0 || dir === step)) {
        last[1] = v
        continue
      }
    }
    runs.push([v, v])
  }
  return runs
}

/** 一串数写成「63～32」「a[0]～a[31]」：连着的写成一段，最多写两段，再多写「等」。 */
export function spanText(list: readonly number[], name: (v: number) => string = String): string {
  const runs = runsOf(list)
  const shown = runs.slice(0, 2).map(([a, b]) => (a === b ? name(a) : `${name(a)}～${name(b)}`))
  return `${shown.join('、')}${runs.length > 2 ? ' 等' : ''}`
}

/** 一处数据竞争写成一句话：哪一格，谁先谁后。派了好几组时写清是哪一组的货架。 */
export function raceText(r: Race, grid: number): string {
  const { first, second } = r
  const slot = grid > 1 ? `第 ${r.index} 格（block ${first.block} 的货架）` : `第 ${r.index} 格`
  if (first.op === 'read') {
    return `${slot}：线程 ${first.thread} 在第 ${first.line} 行取它的时候，线程 ${second.thread} 还没在第 ${second.line} 行放。`
  }
  if (second.op === 'read') {
    return `${slot}：线程 ${first.thread} 在第 ${first.line} 行放好了，线程 ${second.thread} 没等同步就在第 ${second.line} 行取。这一次碰巧放在前面。`
  }
  return `${slot}：线程 ${first.thread} 和线程 ${second.thread} 都往里放（第 ${first.line}、${second.line} 行），中间没有同步。`
}

// ── 货架板：每组的货架和 out 到这一步为止的样子 ─────────────────────────────

export interface SlotView {
  index: number
  /** 放上去的数；放了却对不出是哪个数（不是从 a 取来的）时是 null */
  value: number | null
  filled: boolean
  /** 这一步有线程放了这一格 */
  put: boolean
  /** 这一步有线程取了这一格 */
  taken: boolean
  /** 到这一步为止，有线程在这一格放好之前就取了它（模拟器里取到 0） */
  early: boolean
}

export type CellState = 'blank' | 'right' | 'wrong'

export interface CellView {
  /** out 的下标（全局下标 i） */
  index: number
  value: number | null
  state: CellState
  /** 这一步写了这一格 */
  now: boolean
}

export interface BlockBoard {
  block: number
  slots: SlotView[]
  out: CellView[]
  /** 这一组的线程开始走了没有 */
  started: boolean
  /** 已经写了的 out 里，有几个不对 */
  wrong: number
}

/** 同一步里、在第 n 个事件之前读显存的那个事件（放上货架的数从它来）。 */
function sourceLoad(events: readonly SimEvent[], n: number): SimEvent | null {
  for (let k = n - 1; k >= 0 && events[k].step === events[n].step; k--) {
    if (events[k].op === 'load' && events[k].space === 'global') return events[k]
  }
  return null
}

/**
 * 每组的货架和 out，算到前 upto 个事件为止；[from, upto) 是这一步的事件，标出这一步放的、取的、写的。
 * 放上货架的数从同一步读的 a 对出来（放和读的 lane 一样时，按 lane 的顺序一一对应）；
 * out 的数用运行结束时的 out：这一关的工作单每格只写一次。
 */
export function shelfBoard(result: RunResult, launch: Launch, upto = result.events.length, from = upto): BlockBoard[] {
  const { grid, block } = launch
  const expected = flipExpected(launch)
  const final = result.arrays.out ?? []
  const aLength = result.arrays.a?.length ?? 0
  const boards: BlockBoard[] = Array.from({ length: grid }, (_, b) => ({
    block: b,
    slots: Array.from({ length: SHELF }, (_, index): SlotView => ({ index, value: null, filled: false, put: false, taken: false, early: false })),
    out: Array.from({ length: block }, (_, k): CellView => ({ index: b * block + k, value: null, state: 'blank', now: false })),
    started: false,
    wrong: 0,
  }))
  const { events } = result
  const end = Math.min(upto, events.length)
  for (let n = 0; n < end; n++) {
    const e = events[n]
    const board = boards[e.block]
    if (!board) continue
    board.started = true
    const now = n >= from
    const addrs = e.addrs ?? []
    if (e.space === 'lds' && e.array === SHELF_NAME && e.op === 'store') {
      const load = sourceLoad(events, n)
      const paired = load && load.mask === e.mask ? load.addrs ?? [] : []
      addrs.forEach((index, k) => {
        const slot = board.slots[index]
        if (!slot) return
        const j = paired[k]
        slot.filled = true
        slot.value = j !== undefined && j >= 0 && j < aLength ? aValue(j) : null
        if (now) slot.put = true
      })
    } else if (e.space === 'lds' && e.array === SHELF_NAME && e.op === 'load') {
      for (const index of addrs) {
        const slot = board.slots[index]
        if (!slot) continue
        if (!slot.filled) slot.early = true
        if (now) slot.taken = true
      }
    } else if (e.space === 'global' && e.array === 'out' && e.op === 'store') {
      for (const i of addrs) {
        const cell = board.out[i - e.block * block]
        if (!cell) continue
        cell.value = final[i] ?? null
        cell.state = cell.value === expected[i] ? 'right' : 'wrong'
        if (now) cell.now = true
      }
    }
  }
  for (const b of boards) b.wrong = b.out.filter((c) => c.state === 'wrong').length
  return boards
}

// ── 单步：一句话说清这一步 ──────────────────────────────────────────────────

/** 单步时的一句话：这一步是哪支小队，放了哪几格、在同步处等、取了哪几格（取早了几格），或者在计算。 */
export function stepStory(result: RunResult, launch: Launch, index: number): string {
  const groups = stepGroups(result.events)
  const g = groups[index]
  if (!g) return ''
  const own = result.events.slice(g.from, g.to)
  // 「block 1 的小队 0」：只派一组时不写组号
  const squad = launch.grid > 1 ? `block ${g.block} 的小队 ${g.wave}` : `小队 ${g.wave}`
  if (own.some((e) => e.op === 'barrier')) {
    const p = syncProgress(prepareWave(result, launch), index)
    if (!p || p.total === 1) return `${squad}：走到第 ${g.line} 行的同步。这一组只有它一支小队，走到就接着走。`
    if (p.arrived < p.total) return `${squad}：走到第 ${g.line} 行的同步，停下来等。这一组 ${p.total} 支小队，到了 ${p.arrived} 支。`
    return `${squad}：也走到了第 ${g.line} 行的同步。这一组 ${p.total} 支小队都到齐了，一起往下走。`
  }
  const put = own.find((e) => e.op === 'store' && e.space === 'lds' && e.array === SHELF_NAME)
  const take = own.find((e) => e.op === 'load' && e.space === 'lds' && e.array === SHELF_NAME)
  if (put) {
    const load = own.find((e) => e.op === 'load' && e.space === 'global')
    const what = load ? `把 ${spanText(load.addrs ?? [], (v) => `${load.array}[${v}]`)} ` : ''
    return `${squad}：${put.addrs?.length ?? 0} 个线程${what}放上货架的第 ${spanText(put.addrs ?? [])} 格。`
  }
  if (take) {
    const store = own.find((e) => e.op === 'store' && e.space === 'global')
    const where = store ? `，存进 ${spanText(store.addrs ?? [], (v) => `${store.array}[${v}]`)}` : ''
    const slots = take.addrs ?? []
    const before = shelfBoard(result, launch, g.from)[g.block]
    const outside = slots.filter((v) => v < 0 || v >= SHELF).length
    const early = slots.filter((v) => v >= 0 && v < SHELF && !before?.slots[v].filled).length
    // 放好了，可中间没有同步：模拟器记下了数据竞争，这一步取对是碰巧（08 第 4 节的 wave 顺序）
    const lucky = shelfRaces(result).lucky.some((r) => r.second.step === g.step)
    let tail = lucky ? '这些格子碰巧都放好了：中间没有同步，真卡上谁先谁后说不准。' : '这些格子都放好了。'
    if (early) tail = `其中 ${early} 格还没放：取早了，模拟器里取到 0。`
    if (outside) tail = `${early ? tail : ''}有 ${outside} 次取到了货架外面，模拟器里取到 0。`
    return `${squad}：${slots.length} 个线程取货架的第 ${spanText(slots)} 格${where}。${tail}`
  }
  if (own.every((e) => e.op === 'exec')) {
    const lanes = own[0].mask.split('1').length - 1
    return `${squad}：执行第 ${g.line} 行，${lanes} 个线程一起计算。`
  }
  return describeStep(g, result.events, launch)
}

/** 单步时，这一步所在的组里每支小队在做什么（同 WaveView 的同步状态，说法换成小队）。 */
export interface SquadView {
  wave: number
  first: number
  last: number
  status: WaveStatus
  text: string
}

export function squadsAt(result: RunResult, launch: Launch, index: number): SquadView[] {
  const src = prepareWave(result, launch)
  const step = src.steps[index]
  if (!step) return []
  return waveStates(src, index).map((s) => {
    let text = '还没开始'
    if (s.status === 'running') text = step.kind === 'barrier' ? `走到第 ${s.line} 行的同步` : `正在走第 ${s.line} 行`
    else if (s.status === 'waiting') text = `在第 ${s.line} 行的同步处等`
    else if (s.status === 'ready') text = '等齐了，等着接着走'
    else if (s.status === 'done') text = '走完了'
    return { wave: s.wave, first: s.first, last: s.last, status: s.status, text }
  })
}

// ── 实验台的解读 ────────────────────────────────────────────────────────────

/** 跑完以后的一句话（03 第 1 节第 4 条）：倒对了没有，没等就取的是哪支小队、哪几格，几处数据竞争。 */
export function labText(wait: WaitAt, result: RunResult): string {
  if (!result.ok) return ''
  const expected = flipExpected(LAB_LAUNCH)
  const out = result.arrays.out ?? []
  const bad = expected.filter((v, k) => out[k] !== v).length
  const races = shelfRaces(result)
  if (!bad && !races.total) {
    return `两支小队都放好了才取：out 的 ${out.length} 个数全倒过来了，一处数据竞争也没有（模拟）。先走到同步的小队停在那里，等另一支也放好。`
  }
  const lead = wait === 'before' ? '同步写在放之前，等于没等：整组到齐了才开始放，放完没等就取。' : '删掉同步：放完马上就取。'
  const earlySlots = [...new Set(races.early.map((r) => r.index))]
  const earlyBy = [...new Set(races.early.map((r) => Math.floor(r.first.thread / WAVE)))].map((w) => `小队 ${w}`).join('、')
  const luckyBy = [...new Set(races.lucky.map((r) => Math.floor(r.second.thread / WAVE)))].map((w) => `小队 ${w}`).join('、')
  const lucky = luckyBy ? `${luckyBy} 后取，碰巧取对了。` : ''
  return `${lead}out 有 ${bad} 个数错了：${earlyBy} 去取第 ${spanText(earlySlots)} 格的时候，这些格子还没放，取到的是 0（模拟器里货架一开始是 0）。${lucky}模拟器记下 ${races.total} 处数据竞争。`
}

// ── 挑战：每组倒过来 ────────────────────────────────────────────────────────

export const STAR_LABELS = [
  `每组的 ${SHELF} 个数都倒过来了，没有数据竞争`,
  '每支小队只在同步处等一次',
  `换成 ${VARIANT_LAUNCH.grid} 组、每组 ${VARIANT_LAUNCH.block} 个线程，同一份代码照样倒得对、只等一次`,
] as const

export const HINTS: Hints = {
  direction: '先看每支小队在同步处等了几次。两次同步里，哪一次护住了「先放好、再取」？另一次等的时候，货架上还什么都没有。',
  location: '只改三个虚线框：放之前那一行、放和取之间那一行、取第几格。对面那一格要跟着每组的人数变：每组几个线程，写在 blockDim.x 里。',
  answer: `放之前那一行不等（删掉，或者写成注释），放和取之间留着同步；取第 ${BEST_TAKE} 格。`
    + `每组 ${SHELF} 个线程时就是第 63 - t 格，每组 ${WAVE} 个线程时是第 31 - t 格。`,
}

/** 同步写在哪：没有同步、都在放之前，或者别的位置。 */
function syncPlace(events: readonly SimEvent[]): 'none' | 'before' | 'other' {
  const barriers = events.filter((e) => e.op === 'barrier')
  if (!barriers.length) return 'none'
  const put = events.find((e) => e.op === 'store' && e.space === 'lds' && e.array === SHELF_NAME)
  return put && barriers.every((e) => e.line < put.line) ? 'before' : 'other'
}

/** out 里不对的下标。 */
function wrongCells(run: SandboxRun): number[] {
  const expected = flipExpected(run.launch)
  const out = run.result.arrays.out ?? []
  return expected.flatMap((v, k) => (out[k] === v ? [] : [k]))
}

/**
 * ★1：每组的数都倒过来了，没有数据竞争。没做到时写成「现象 / 原因 / 怎么改」（03 第 4 节），按这个顺序找原因：
 * 代码出错；取到了货架外面；没等就取（数据竞争）；取的不是对面那一格。
 */
function wrongFlip(run: SandboxRun): ChallengeError | null {
  const { result, launch } = run
  if (!result.ok) return explainError(result.error)
  const out = result.arrays.out ?? []
  const expected = flipExpected(launch)
  const bad = wrongCells(run)
  const races = shelfRaces(result)
  const outside = result.diagnostics.filter((d): d is OobRead => d.kind === 'oob-read' && d.space === 'lds')
  const waits = waitsOf(result.events)
  const raw = [
    `out 不对的格子：${bad.length ? spanText(bad, (v) => `out[${v}]`) : '没有'}`,
    `取到货架外面：${outside.length} 次`,
    `数据竞争：${races.total} 处`,
    `每支小队在同步处等了：${waits} 次`,
  ].join('\n')
  const B = launch.block

  if (outside.length) {
    const d = outside[0]
    const firstFine = launch.grid > 1 && !outside.some((o) => o.block === 0)
    const who = launch.grid > 1 ? `block ${d.block} 的线程 ${d.thread}` : `线程 ${d.thread}`
    return {
      symptom: `有 ${outside.length} 次取到了货架外面。比如第一次：${who} 要第 ${d.index} 格，货架只有第 0～${SHELF - 1} 格（模拟器里取到 0）。`,
      cause: firstFine
        ? 'block 0 取对了，后面的组却取到了货架外面：每组有自己的货架，格子都从 0 数起，不能按全局下标 i 去数。'
        : '取第几格算出了货架的范围。',
      fix: `第 t 个线程要的是这一组对面那个线程放的数：按组内编号 t 算，落在第 0～${B - 1} 格里。`,
      raw,
    }
  }
  if (races.total) {
    const r = races.early[0] ?? races.lucky[0] ?? races.other[0]
    const place = syncPlace(result.events)
    const seen = bad.length
      ? `out 有 ${bad.length} 个数不对，模拟器还记下 ${races.total} 处数据竞争。`
      : `out 碰巧全对，可模拟器记下 ${races.total} 处数据竞争。`
    return {
      symptom: `${seen}比如${raceText(r, launch.grid)}`,
      cause: place === 'none'
        ? '放完没等就去取：对面的线程可能还没放。几支小队谁先谁后，没有同步就说不准。'
        : place === 'before'
          ? '同步写在了放之前：整组到齐了才开始放，可放完没再等，就去取别人的格子了。'
          : '同步没有隔开「放」和「取」：放完以后没有等整组都放好，就去取别人的格子了。',
      fix: `在放和取之间同步（HIP 风格写 ${SYNC_CALL.hip}，Python 风格写 ${SYNC_CALL.python}）：等整组都放好，再取。`,
      raw,
    }
  }
  if (bad.length) {
    const k = bad[0]
    return {
      symptom: `out 有 ${bad.length} 个数不对：比如 out[${k}] 是 ${out[k]}，应该是 ${expected[k]}。`,
      cause: '取的不是对面那一格：第 t 个线程要的，是这一组对面那个线程放的数。',
      fix: `每组 ${B} 个线程：线程 0 取第 ${B - 1} 格，线程 1 取第 ${B - 2} 格……线程 t 取的那一格，加上 t 正好是 ${B - 1}。`,
      raw,
    }
  }
  return null
}

/** ★3 换派法再跑的那一次：哪里不成立，一句话；成立是 null。 */
function variantProblem(run: SandboxRun): string | null {
  const { grid, block } = run.launch
  const lead = `换成 ${grid} 组、每组 ${block} 个线程再跑一次`
  const { result } = run
  if (!result.ok) return `${lead}，程序出错了：${result.error.message}`
  const error = wrongFlip(run)
  const bad = wrongCells(run)
  if (bad.length) {
    const k = bad[0]
    const out = result.arrays.out ?? []
    return `${lead}：out[${k}] 是 ${out[k]}，应该是 ${flipExpected(run.launch)[k]}。对面那一格要跟着每组的人数变：`
      + `每组 ${block} 个线程时，线程 0 要第 ${block - 1} 格。每组几个线程，写在 blockDim.x 里。`
  }
  if (error) return `${lead}：${error.symptom}`
  const waits = waitsOf(result.events)
  if (waits > 1) return `${lead}，每支小队在同步处等了 ${waits} 次。`
  return null
}

/**
 * 挑战的星级判定（06 第 7 节）：runs[0] 是派 2 组、每组 64 个线程的那一次，runs[1] 是换派法的那一次（FLIP_VARIANTS）。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」；★2 看每支小队只等一次；★3 看换派法以后 ★1、★2 照样成立。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, variant] = runs
  const error = wrongFlip(main)
  if (error) return { earned: [false, false, false], next: error.fix, error }
  const waits = waitsOf(main.result.events)
  const head = `每组的 ${main.launch.block} 个数都倒过来了，没有数据竞争（模拟）。`
  if (waits > 1) {
    return {
      earned: [true, false, false],
      next: `${head}可每支小队在同步处等了 ${waits} 次。每次同步，先到的小队都要停下来，等最慢的那支：只在取别人放的数之前等。`,
    }
  }
  const problem = variant ? variantProblem(variant) : '还没有换派法再跑一次。'
  if (problem) return { earned: [true, true, false], next: `${head}每支小队只等了一次。${problem}` }
  return {
    earned: [true, true, true],
    next: `${head}每支小队只在放和取之间等了一次；换成 ${VARIANT_LAUNCH.grid} 组、每组 ${VARIANT_LAUNCH.block} 个线程也照样成立。三颗星的标准都达到了。`,
  }
}

/** 沙盒结果插槽里一次运行的一句话：out 对不对、几处数据竞争、每支小队等了几次。 */
export function runSummary(run: SandboxRun): string {
  const { result, launch } = run
  const lead = `派 ${launch.grid} 组、每组 ${launch.block} 个线程`
  if (!result.ok) return `${lead}：程序没有跑完。`
  const bad = wrongCells(run).length
  const races = shelfRaces(result).total
  const outText = bad ? `out 有 ${bad} 个数不对` : '每组都倒过来了'
  const raceTail = races ? `${races} 处数据竞争` : '没有数据竞争'
  return `${lead}：${outText}，${raceTail}，每支小队在同步处等了 ${waitsOf(result.events)} 次（模拟）。`
}
