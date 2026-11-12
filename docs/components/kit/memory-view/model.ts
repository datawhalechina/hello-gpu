/**
 * 访存视图（S-08）的数据：从模拟器的事件流（08 第 5 节）和 L3 访存模型（docs/sim/memory.ts 的 analyzeMemory）
 * 算出一个 wave 每一次读写显存要哪些地址、碰到哪几车（cache line）、搬了几车。纯函数，不碰 Vue 和浏览器，单测直接导入。
 *
 * - 一次访存 = 一个 space 为 global 的事件（读、写、原子加）：一个 wave 的活跃 lane 在同一步访问同一个数组。
 *   车次、理想车次、效率直接用 analyzeMemory 算的，不另算一遍：视图上的数和关卡判星、单测用的是同一个函数。
 * - 车按 analyzeMemory 的约定排：每个数组从一车的开头放起，第 i 个元素占第 i × elemBytes 到 (i + 1) × elemBytes − 1
 *   个字节，第 k 车装第 k × lineBytes 到 (k + 1) × lineBytes − 1 个字节。碰到的每一车里的格子分四种：
 *   这次要的（hit）；跟着整车搬来、没人要的（miss）；不是这个数组的地方（outside：数组到头了，车照样整车搬）；
 *   要到了数组外面的（oob：越界的读写，L2 记了诊断，这里照样算车次）。
 * - 元素大小、一车多大都是示意值（params.ts），视图上可以换；换了只重新分车，不用重跑模拟器。
 * - 一步（08 第 4 节）和沙盒单步、WaveView 的一步相同（sandbox/run.ts 的 stepGroups）。一步里可能有好几次访存：
 *   c[i] = a[i] + b[i] 一步里读 a、读 b、写 c，一共三次。
 */
import type { RunResult, SimEvent, WaveSize } from '../../../sim/lockstep.ts'
import { analyzeMemory } from '../../../sim/memory.ts'
import { SIM_PARAMS } from '../../../sim/params.ts'
import { stepGroups } from '../sandbox/run.ts'
import { percent, ranges } from '../wave-view/model.ts'

/** 一次启动：gridDim.x 和 blockDim.x（wave 大小以模拟器的结果为准）。 */
export interface MemoryLaunch {
  grid: number
  block: number
}

/** 一个线程：blockIdx.x 和 threadIdx.x。RobotGrid 的 select 事件给的就是它。 */
export interface ThreadRef {
  block: number
  thread: number
}

export type AccessOp = 'load' | 'store' | 'atomic'

export const OP_NAME: Record<AccessOp, string> = { load: '读', store: '写', atomic: '原子加' }

/**
 * 视图上能换的元素大小、一车大小（字节），都是示意值。默认值是 params.ts 的 SIM_PARAMS，要在这两张表里。
 * 模拟器的数组都是 4 字节的 int / float；2 字节只用来看「元素变小，一车装得下更多个」。
 * 一车的几个大小只是拿来比较的示意值，不对应哪一块显卡。都能被元素大小整除，一个元素不会跨两车。
 */
export const ELEM_OPTIONS: readonly number[] = [4, 2]
export const LINE_OPTIONS: readonly number[] = [32, 64, 128]

/** 画多少：格子不超过 detailCells 个时一格一格画（写着线程号），再多每一车画成一条；最多画 maxCars 车。 */
export const MEM_LIMITS = {
  detailCells: 256,
  maxCars: 64,
} as const

export interface LaneAddr {
  lane: number
  /** threadIdx.x */
  thread: number
  /** 要的元素下标 */
  index: number
}

export interface MemAccess {
  /** 第几次访存（0 起），也是 accesses 里的位置 */
  index: number
  /** 这个事件在事件流里的位置 */
  event: number
  /** 第几步（0 起），和 stepGroups、沙盒单步的 index 一致 */
  step: number
  block: number
  wave: number
  line: number
  op: AccessOp
  array: string
  /** 数组有几个元素：下标不在 [0, length) 里的是越界 */
  length: number
  /** 活跃 lane 要的下标，按 lane 的顺序 */
  lanes: LaneAddr[]
  /** 要的不同元素个数：几个 lane 要同一个只算一个 */
  elements: number
  /** 碰到的车的编号，从小到大、不重复 */
  cacheLines: number[]
  /** 车次（事务数） */
  transactions: number
  /** 理想车次 */
  ideal: number
  /** 理想车次 ÷ 车次 */
  efficiency: number
}

/** 一次运行里和访存有关的东西：换元素大小、一车大小时重新算（不用重跑模拟器）。 */
export interface MemorySource {
  size: WaveSize
  grid: number
  block: number
  lineBytes: number
  elemBytes: number
  /** 只看这个数组；空字符串是全部显存数组 */
  array: string
  accesses: MemAccess[]
  /** 第 s 步的访存是 accesses 的 [stepStart[s], stepStart[s + 1])；长度是步数 + 1 */
  stepStart: Int32Array
  events: readonly SimEvent[]
  /** 程序正常结束 */
  complete: boolean
  /** 程序出错停下时，出错的那一行 */
  errorLine: number | null
}

export interface MemoryOptions {
  lineBytes?: number
  elemBytes?: number
  /** 只看这个数组的访存，不写就是全部 */
  array?: string
}

/** 元素大小、一车大小不是正整数时抛出 RangeError（同 analyzeMemory）：这是调用方的错，不是读者代码的错。 */
export function prepareMemory(result: RunResult, launch: MemoryLaunch, options: MemoryOptions = {}): MemorySource {
  const lineBytes = options.lineBytes ?? SIM_PARAMS.lineBytes
  const elemBytes = options.elemBytes ?? SIM_PARAMS.elemBytes
  const array = options.array ?? ''
  const size = result.wave
  const { events } = result
  const report = analyzeMemory(events, { lineBytes, elemBytes })
  const groups = stepGroups(events)
  const stepOf = new Int32Array(events.length)
  groups.forEach((g, s) => stepOf.fill(s, g.from, g.to))

  const accesses: MemAccess[] = []
  for (const a of report.accesses) {
    const e = events[a.event]
    const name = e.array ?? ''
    if (array && name !== array) continue
    // addrs 按 lane 的顺序列出每个活跃 lane 的下标（08 第 5 节）
    const addrs = e.addrs ?? []
    const lanes: LaneAddr[] = []
    for (let lane = 0, k = 0; lane < e.mask.length; lane++) {
      if (e.mask[lane] === '1') lanes.push({ lane, thread: e.wave * size + lane, index: addrs[k++] })
    }
    accesses.push({
      index: accesses.length,
      event: a.event,
      step: stepOf[a.event],
      block: e.block,
      wave: e.wave,
      line: e.line,
      op: e.op as AccessOp,
      array: name,
      length: result.arrays[name]?.length ?? 0,
      lanes,
      elements: a.elements,
      cacheLines: a.cacheLines,
      transactions: a.transactions,
      ideal: a.ideal,
      efficiency: a.efficiency,
    })
  }

  const stepStart = new Int32Array(groups.length + 1)
  for (let s = 0, p = 0; s <= groups.length; s++) {
    while (p < accesses.length && accesses[p].step < s) p++
    stepStart[s] = p
  }
  return {
    size, grid: launch.grid, block: launch.block, lineBytes, elemBytes, array,
    accesses, stepStart, events,
    complete: result.ok,
    errorLine: result.ok ? null : result.error.line,
  }
}

/** 第 step 步（0 起）的访存；没有这一步是空的。 */
export function accessesInStep(src: MemorySource, step: number): MemAccess[] {
  if (step < 0 || step + 1 >= src.stepStart.length) return []
  return src.accesses.slice(src.stepStart[step], src.stepStart[step + 1])
}

/** 到第 step 步为止（含这一步）一共几次访存。 */
export function accessesUpTo(src: MemorySource, step: number): number {
  if (step < 0) return 0
  return src.stepStart[Math.min(step + 1, src.stepStart.length - 1)]
}

// ── 分车 ────────────────────────────────────────────────────────────────

/** hit：这次要的；miss：跟着整车搬、没人要；outside：不是这个数组的地方；oob：要到了数组外面（越界） */
export type CellState = 'hit' | 'miss' | 'outside' | 'oob'

export interface CarCell {
  /** 元素下标 */
  index: number
  state: CellState
  /** 要这个数的线程（threadIdx.x），按 lane 的顺序；没人要是空的 */
  threads: number[]
}

export interface CarView {
  /** 第几车 */
  line: number
  /** 这一车的第一个、最后一个字节 */
  from: number
  to: number
  cells: CarCell[]
  /** 这次要的格子数（含越界的） */
  used: number
  /** 不是这个数组的格子数 */
  outside: number
  /** 要到了数组外面的格子数 */
  oob: number
}

export type CarRow = { kind: 'car'; line: number } | { kind: 'gap'; from: number; to: number; outside: boolean }

export type LayoutRow = { kind: 'car'; car: CarView } | { kind: 'gap'; from: number; to: number; outside: boolean }

export interface AccessLayout {
  rows: LayoutRow[]
  /** 一车装几个元素 */
  perLine: number
  /** 画出来的格子数 */
  cells: number
  /** 碰到了、但超过 maxCars 没有画出来的车 */
  hidden: number
  /** 格子太多：每一车画成一条，不一格一格画 */
  dense: boolean
}

/** 一个数组占几车：最后一个元素所在的车 + 1；空数组 0 车。 */
export function arrayCars(length: number, lineBytes: number, elemBytes: number): number {
  return length > 0 ? Math.floor((length * elemBytes - 1) / lineBytes) + 1 : 0
}

/** 一个元素在哪几车：一般只有一车，元素跨了车的边界时是两车。 */
export function carsOfElement(index: number, lineBytes: number, elemBytes: number): number[] {
  const first = Math.floor((index * elemBytes) / lineBytes)
  const last = Math.floor((index * elemBytes + elemBytes - 1) / lineBytes)
  const out: number[] = []
  for (let line = first; line <= last; line++) out.push(line)
  return out
}

/**
 * 碰到的车（从小到大）排成一行一行：两车之间、数组开头到第一车、最后一车到数组末尾没碰到的车折成一行「没有搬」。
 * 没碰到的一段跨过数组的边界时切开：[0, total) 里的是这个数组的车，外面的标 outside。
 */
export function carRows(lines: readonly number[], total: number): CarRow[] {
  const rows: CarRow[] = []
  const gap = (from: number, to: number) => {
    const cuts = [from, ...[0, total].filter((b) => b > from && b <= to), to + 1]
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k]
      const b = cuts[k + 1] - 1
      if (a <= b) rows.push({ kind: 'gap', from: a, to: b, outside: a < 0 || a >= total })
    }
  }
  let next: number | null = null
  for (const line of lines) {
    const start = next ?? Math.min(0, line)
    if (line > start) gap(start, line - 1)
    rows.push({ kind: 'car', line })
    next = line + 1
  }
  if (next !== null && next < total) gap(next, total - 1)
  return rows
}

function carView(line: number, want: ReadonlyMap<number, number[]>, length: number, lineBytes: number, elemBytes: number): CarView {
  const from = line * lineBytes
  const to = from + lineBytes - 1
  const cells: CarCell[] = []
  let used = 0
  let outside = 0
  let oob = 0
  for (let i = Math.floor(from / elemBytes); i <= Math.floor(to / elemBytes); i++) {
    const threads = want.get(i) ?? []
    const inside = i >= 0 && i < length
    let state: CellState
    if (threads.length) {
      used++
      state = inside ? 'hit' : 'oob'
      if (!inside) oob++
    } else {
      state = inside ? 'miss' : 'outside'
      if (!inside) outside++
    }
    cells.push({ index: i, state, threads })
  }
  return { line, from, to, cells, used, outside, oob }
}

/** 一次访存怎么画：碰到的每一车一行（最多 maxCars 车），中间没碰到的车折起来。 */
export function layoutAccess(access: MemAccess, lineBytes: number, elemBytes: number, maxCars: number = MEM_LIMITS.maxCars): AccessLayout {
  const want = new Map<number, number[]>()
  for (const l of access.lanes) {
    const list = want.get(l.index)
    if (list) list.push(l.thread)
    else want.set(l.index, [l.thread])
  }
  const rows: LayoutRow[] = []
  let shown = 0
  let cells = 0
  for (const row of carRows(access.cacheLines, arrayCars(access.length, lineBytes, elemBytes))) {
    if (row.kind === 'gap') {
      rows.push(row)
      continue
    }
    if (shown >= maxCars) break
    const car = carView(row.line, want, access.length, lineBytes, elemBytes)
    shown++
    cells += car.cells.length
    rows.push({ kind: 'car', car })
  }
  return {
    rows,
    perLine: lineBytes / elemBytes,
    cells,
    hidden: access.cacheLines.length - shown,
    dense: cells > MEM_LIMITS.detailCells,
  }
}

export interface CellRun {
  state: CellState
  /** 车里第几格到第几格 [from, to) */
  from: number
  to: number
}

/** 一车的格子切成连续的几段（每一车画成一条时用）。 */
export function cellRuns(cells: readonly CarCell[]): CellRun[] {
  const runs: CellRun[] = []
  cells.forEach((c, k) => {
    const last = runs[runs.length - 1]
    if (last?.state === c.state) last.to = k + 1
    else runs.push({ state: c.state, from: k, to: k + 1 })
  })
  return runs
}

// ── 一个线程 ────────────────────────────────────────────────────────────

/** 这次访存里这个线程要哪个下标；不在这个 wave 里，或者这一次被条件关掉了，都是 null。 */
export function laneFor(access: MemAccess, thread: ThreadRef | null, size: number): LaneAddr | null {
  if (!thread || thread.block !== access.block || Math.floor(thread.thread / size) !== access.wave) return null
  return access.lanes.find((l) => l.thread === thread.thread) ?? null
}

export interface ThreadVisit {
  /** 第几次访存 */
  access: number
  line: number
  op: AccessOp
  array: string
  index: number
  /** 这个元素在哪几车 */
  cars: number[]
  /** 要到了数组外面 */
  oob: boolean
}

/** 一个线程读写显存的全部地址，按先后；upto 给了就只看前 upto 次访存。 */
export function threadVisits(src: MemorySource, thread: ThreadRef, upto = Number.POSITIVE_INFINITY): ThreadVisit[] {
  const out: ThreadVisit[] = []
  const end = Math.min(upto, src.accesses.length)
  for (let k = 0; k < end; k++) {
    const a = src.accesses[k]
    const lane = laneFor(a, thread, src.size)
    if (!lane) continue
    out.push({
      access: k, line: a.line, op: a.op, array: a.array, index: lane.index,
      cars: carsOfElement(lane.index, src.lineBytes, src.elemBytes),
      oob: lane.index < 0 || lane.index >= a.length,
    })
  }
  return out
}

// ── 汇总 ────────────────────────────────────────────────────────────────

export interface UsageRow {
  line: number
  op: AccessOp
  array: string
  /** 几次访存 */
  accesses: number
  transactions: number
  ideal: number
}

export interface MemoryUsage {
  accesses: number
  transactions: number
  ideal: number
  /** 按代码行、读写、数组分组：行号从小到大，同一行按第一次出现的先后 */
  rows: UsageRow[]
}

/** 前 upto 次访存（默认全部）加起来，并分组。 */
export function memoryUsage(src: MemorySource, upto = Number.POSITIVE_INFINITY): MemoryUsage {
  const end = Math.min(upto, src.accesses.length)
  const groups = new Map<string, UsageRow>()
  let transactions = 0
  let ideal = 0
  for (let k = 0; k < end; k++) {
    const a = src.accesses[k]
    const key = `${a.line}|${a.op}|${a.array}`
    let row = groups.get(key)
    if (!row) {
      row = { line: a.line, op: a.op, array: a.array, accesses: 0, transactions: 0, ideal: 0 }
      groups.set(key, row)
    }
    row.accesses++
    row.transactions += a.transactions
    row.ideal += a.ideal
    transactions += a.transactions
    ideal += a.ideal
  }
  // Map 按插入的先后，sort 是稳定的：同一行里按第一次出现的先后
  const rows = [...groups.values()].sort((x, y) => x.line - y.line)
  return { accesses: end, transactions, ideal, rows }
}

/** 理想 ÷ 实际；一车都没搬记 1（和 analyzeMemory 一样）。 */
export function efficiency(u: { transactions: number; ideal: number }): number {
  return u.transactions === 0 ? 1 : u.ideal / u.transactions
}

// ── 文字 ────────────────────────────────────────────────────────────────

const at = (array: string, index: number) => `${array}[${index}]`

/** 「读 x」 */
export function accessTitle(a: MemAccess): string {
  return `${OP_NAME[a.op]} ${a.array}`
}

/** 哪些 lane 要哪些地址，一句话。相邻的 lane 按固定的间隔要数时写出间隔（合并访存看的就是它）。 */
export function addrText(a: MemAccess): string {
  const n = a.lanes.length
  if (!n) return '这一次没有 lane 参与。'
  const who = `${n} 个 lane（threadIdx.x ${ranges(a.lanes.map((l) => l.thread), 3)}）`
  const idx = a.lanes.map((l) => l.index)
  if (a.elements === 1) return n === 1 ? `${who}要 ${at(a.array, idx[0])}。` : `${who}都要 ${at(a.array, idx[0])}：同一个数，只取一份。`
  const d = idx[1] - idx[0]
  const lanesInRow = a.lanes.every((l, k) => k === 0 || l.lane === a.lanes[k - 1].lane + 1)
  const even = n >= 3 && d !== 0 && lanesInRow && idx.every((v, k) => k === 0 || v - idx[k - 1] === d)
  if (even) {
    const list = `${at(a.array, idx[0])}、${at(a.array, idx[1])}、${at(a.array, idx[2])}${n > 3 ? ` … ${at(a.array, idx[n - 1])}` : ''}`
    const gap = Math.abs(d) === 1 ? '相邻的 lane 要相邻的数' : `相邻的 lane 隔 ${Math.abs(d)} 个数`
    return `${who}依次要 ${list}：${gap}${d < 0 ? '（倒着排）' : ''}。`
  }
  const distinct = [...new Set(idx)]
  const shown = distinct.slice(0, 4).map((i) => at(a.array, i)).join('、')
  return `${who}要 ${shown}${distinct.length > 4 ? ` 等 ${distinct.length} 个数` : ''}。`
}

/** 「这次搬了 N 车，理想是 M 车」，再说为什么。 */
export function carsText(a: MemAccess): string {
  const head = `这次搬了 ${a.transactions} 车，理想是 ${a.ideal} 车`
  if (a.transactions <= a.ideal) return `${head}：一车都没多搬（模拟）。`
  return `${head}：要的 ${a.elements} 个数散在 ${a.transactions} 车里，多搬了 ${a.transactions - a.ideal} 车（模拟）。`
}

/** 一车的说明（也是读屏文字）：字节范围、装的是哪几个数、这次要了哪几个。 */
export function carLabel(car: CarView, array: string): string {
  const first = car.cells[0]?.index ?? 0
  const last = car.cells[car.cells.length - 1]?.index ?? first
  const head = `第 ${car.line} 车（字节 ${car.from}–${car.to}，${at(array, first)}–${at(array, last)}）`
  const hits = car.cells.filter((c) => c.threads.length)
  const parts = [`一车 ${car.cells.length} 个数，这次要了 ${car.used} 个`]
  if (hits.length) {
    const list = hits.slice(0, 4).map((c) => `${at(array, c.index)}（threadIdx.x ${ranges(c.threads, 2)}）`).join('、')
    parts.push(`${list}${hits.length > 4 ? `等 ${hits.length} 个` : ''}`)
  }
  if (car.outside) parts.push(`${car.outside} 格不是 ${array} 的地方，也跟着整车搬`)
  if (car.oob) parts.push(`${car.oob} 格要到了数组外面（越界）`)
  return `${head}：${parts.join('；')}`
}

/** 没碰到的那几车：「第 1–30 车这次没有搬，30 车」。 */
export function gapLabel(row: { from: number; to: number; outside: boolean }): string {
  const n = row.to - row.from + 1
  const which = n === 1 ? `第 ${row.from} 车` : `第 ${row.from}–${row.to} 车`
  return `${which}这次没有搬${row.outside ? '（数组外面）' : ''}${n > 1 ? `，${n} 车` : ''}`
}

/** 一句话总结，也是读屏的播报：一共搬了几车、理想几车、效率；多搬最多的是哪一行的哪次读写。 */
export function describeMemory(u: MemoryUsage, scope: 'all' | 'sofar'): string {
  if (!u.accesses) return scope === 'all' ? '这次运行没有读写显存。' : '到这一步为止还没有读写显存。'
  const lead = scope === 'all' ? `整段一共 ${u.accesses} 次访存` : `到这一步为止 ${u.accesses} 次访存`
  let text = `${lead}，搬了 ${u.transactions} 车，理想是 ${u.ideal} 车，效率 ${percent(efficiency(u))}（模拟）。`
  if (u.rows.length > 1) {
    let worst: UsageRow | null = null
    for (const r of u.rows) if (r.transactions - r.ideal > (worst ? worst.transactions - worst.ideal : 0)) worst = r
    if (worst) text += `多搬最多的是第 ${worst.line} 行的${OP_NAME[worst.op]} ${worst.array}：搬了 ${worst.transactions} 车，理想 ${worst.ideal} 车。`
  }
  return text
}

/** 选中的线程在这一次访存里做了什么。 */
export function pickedText(a: MemAccess, thread: ThreadRef, size: number, lineBytes: number, elemBytes: number): string {
  const lane = laneFor(a, thread, size)
  if (lane) {
    const cars = carsOfElement(lane.index, lineBytes, elemBytes).map((c) => `第 ${c} 车`).join('、')
    const oob = lane.index < 0 || lane.index >= a.length
    return `这一次它（lane ${lane.lane}）${OP_NAME[a.op]} ${at(a.array, lane.index)}，在${cars}${oob ? '，已经在数组外面了（越界）' : ''}。`
  }
  const wave = Math.floor(thread.thread / size)
  if (thread.block === a.block && wave === a.wave) return '这一次它没有参与：它在这个 wave 里，这一步被条件关掉了。'
  return `这一次是 block ${a.block} 的 wave ${a.wave}，它在 block ${thread.block} 的 wave ${wave}。`
}

/** 跟着单步、这一步没有读写显存时的说明。 */
export function quietStep(events: readonly SimEvent[], from: number, to: number, array: string): string {
  for (let e = from; e < to; e++) {
    if (events[e].space === 'lds') return '这一步读写的是共享数组（LDS），不经过显存，不算车次。'
  }
  return array ? `这一步没有读写 ${array}。` : '这一步没有读写显存。'
}
