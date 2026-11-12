/**
 * 线程机器人网格（S-06）的数据：从模拟器的事件流（08 第 5 节）算出每个线程写了哪几格、每一格被谁写过。
 * 纯函数，不碰 Vue 和浏览器，单测直接导入。
 *
 * 只看一个数组（默认是第一个被写的数组参数）的 store / atomic 事件，按试点关卡的五种状态解读：
 * - 写入：写到 [0, length) 里；格子记下写它的线程（同一个线程写同一格多次只算一个）。
 * - 重复计算：一格被两个以上不同的线程普通地写（store）。只用原子加写的格子不算重复，
 *   原子加本来就是让很多线程往同一格加。写了重复格子的线程也标成重复计算。
 * - 越界写：写到数组外面；下标记进「数组外面」（越界区），线程标成越界（比重复、写入优先）。
 * - 检查后跳过：线程所在的 wave 已经走完，却一次也没写这个数组。
 * - 没人算：程序走完以后没有线程写的格子。
 *
 * 逐步播放时只算前 upto 个事件：还没轮到的线程「待命」，轮到了、还没写的「计算中」；
 * 没人写的格子在走完以前只是空着，不算「没人算」。程序出错停下时也一样不下「没人算」的结论，
 * 而且只有出错的 block 之前跑完的 block 才算走完（block 一个接一个执行，08 第 4 节），
 * 别的线程没写就是「计算中」或「待命」，不是「检查后跳过」。
 */
import type { RunResult, SimEvent } from '../../../sim/lockstep.ts'

/** 一次启动：gridDim.x 和 blockDim.x（wave 大小以模拟器的结果为准）。 */
export interface GridLaunch {
  grid: number
  block: number
}

export type BotState = 'standby' | 'busy' | 'write' | 'dup' | 'oob' | 'skip'
export type CellState = 'empty' | 'write' | 'dup' | 'missing'
export type GridPhase = 'idle' | 'running' | 'finished' | 'stopped'

export interface Writer {
  block: number
  thread: number
}

/** 一次写：第几个事件、哪个线程（block × blockDim + threadIdx）、写到哪个下标。 */
interface Write {
  event: number
  id: number
  index: number
  atomic: boolean
}

/** 一次运行里和网格有关的东西，只算一次；逐步播放的每一步都从它算（gridAt）。 */
export interface GridSource {
  grid: number
  block: number
  wave: number
  /** 一个 block 切成几个 wave */
  waves: number
  array: string
  length: number
  events: readonly SimEvent[]
  /** 对这个数组的写，按事件的先后 */
  writes: Write[]
  /** 每个 wave（编号 block × waves + wave）的第一个、最后一个事件在哪；没有事件是 -1 */
  first: Int32Array
  last: Int32Array
  /** 每个 block 跑完了没有：正常结束时全都跑完；出错时只有出错之前跑完的 */
  done: Uint8Array
  /** 程序正常结束 */
  complete: boolean
}

export interface BotView {
  /** block × blockDim + threadIdx，也是 bots 里的位置 */
  id: number
  block: number
  thread: number
  state: BotState
  /** 写进数组的下标，按第一次写的先后，不重复 */
  writes: number[]
  /** 写到数组外面的下标 */
  outside: number[]
  /** 正在执行当前这一步 */
  active: boolean
}

export interface CellView {
  index: number
  state: CellState
  /** 写过这一格的线程，按第一次写的先后，不重复 */
  writers: Writer[]
  /** 普通地写（store）这一格的不同线程数，两个以上就是重复计算 */
  stores: number
  /** 原子加这一格的次数 */
  atomics: number
  /** 当前这一步写了这一格 */
  active: boolean
}

export interface OutsideView {
  index: number
  writers: Writer[]
  active: boolean
}

export interface GridSummary {
  threads: number
  length: number
  /** 有线程写过的格子 */
  written: number
  missing: number
  duplicates: number
  /** 写到数组外面的线程 */
  oob: number
  skipped: number
  busy: number
  standby: number
}

export interface GridState {
  phase: GridPhase
  bots: BotView[]
  cells: CellView[]
  /** 数组外面被写到的位置，按下标排序 */
  outside: OutsideView[]
  summary: GridSummary
  /** 当前这一步是哪个 block 的哪个 wave */
  current: { block: number; wave: number } | null
}

/** 线程的三种画法（02 第 5 节：一个场景的 SVG 元素不超过 2000 个，一个 ThreadBot 约 20 个）。 */
export type ThreadTier = 'bots' | 'mini' | 'blocks'

export const TIERS = {
  /** 不超过这么多个线程：每个线程一个 ThreadBot */
  bots: 64,
  /** 不超过这么多个线程：每个线程一个小号机器人（HTML，不用 SVG）；再多就按 block 汇总 */
  mini: 256,
  /** 格子超过这么多个：换成密排的小方块 */
  cells: 64,
  /** 最多画这么多个格子，后面的只计数 */
  maxCells: 2048,
  /** 越界区最多画这么多个位置 */
  maxOutside: 64,
  /** block 超过这么多个：汇总块只画色条，不写字 */
  tightBlocks: 64,
} as const

export function threadTier(threads: number): ThreadTier {
  if (threads <= TIERS.bots) return 'bots'
  if (threads <= TIERS.mini) return 'mini'
  return 'blocks'
}

/** 没指定数组时画哪个：第一个被写的显存数组；一次都没写过就是第一个数组参数。 */
export function defaultArray(result: RunResult | null): string | null {
  if (!result) return null
  const write = result.events.find((e) => (e.op === 'store' || e.op === 'atomic') && e.space === 'global' && e.array)
  return write?.array ?? Object.keys(result.arrays)[0] ?? null
}

export function prepareGrid(result: RunResult, launch: GridLaunch, array: string): GridSource {
  const { grid, block } = launch
  const wave = result.wave
  const waves = Math.ceil(block / wave)
  const first = new Int32Array(grid * waves).fill(-1)
  const last = new Int32Array(grid * waves).fill(-1)
  const writes: Write[] = []
  const { events } = result
  for (let e = 0; e < events.length; e++) {
    const ev = events[e]
    const key = ev.block * waves + ev.wave
    if (ev.block < grid && ev.wave < waves) {
      if (first[key] < 0) first[key] = e
      last[key] = e
    }
    if ((ev.op !== 'store' && ev.op !== 'atomic') || ev.space !== 'global' || ev.array !== array || !ev.addrs) continue
    // addrs 按 lane 的顺序列出每个活跃 lane 的下标（08 第 5 节）
    let k = 0
    for (let lane = 0; lane < ev.mask.length; lane++) {
      if (ev.mask[lane] !== '1') continue
      const index = ev.addrs[k++]
      writes.push({ event: e, id: ev.block * block + ev.wave * wave + lane, index, atomic: ev.op === 'atomic' })
    }
  }
  const done = new Uint8Array(grid)
  if (result.ok) done.fill(1)
  else if (events.length) {
    const stopped = events[events.length - 1].block
    for (const b of result.blockOrder) {
      if (b === stopped) break
      if (b >= 0 && b < grid) done[b] = 1
    }
  }
  return {
    grid, block, wave, waves, array,
    length: result.arrays[array]?.length ?? 0,
    events, writes, first, last, done,
    complete: result.ok,
  }
}

function emptySummary(threads: number, length: number): GridSummary {
  return { threads, length, written: 0, missing: 0, duplicates: 0, oob: 0, skipped: 0, busy: 0, standby: 0 }
}

function makeBots(launch: GridLaunch): BotView[] {
  const bots: BotView[] = []
  for (let id = 0; id < launch.grid * launch.block; id++) {
    bots.push({ id, block: Math.floor(id / launch.block), thread: id % launch.block, state: 'standby', writes: [], outside: [], active: false })
  }
  return bots
}

/** 还没运行：线程按启动配置排好，全都待命，还没有格子。 */
export function idleGrid(launch: GridLaunch): GridState {
  const bots = makeBots(launch)
  const summary = emptySummary(bots.length, 0)
  summary.standby = bots.length
  return { phase: 'idle', bots, cells: [], outside: [], summary, current: null }
}

/**
 * 算到前 upto 个事件为止的样子（默认全部）。current 是当前这一步的事件范围 [from, to)：
 * 这一步在做事的线程、这一步写到的格子标成 active。
 */
export function gridAt(src: GridSource, upto = Number.POSITIVE_INFINITY, current: { from: number; to: number } | null = null): GridState {
  const end = Math.max(0, Math.min(upto, src.events.length))
  const bots = makeBots(src)
  const threads = bots.length
  const cells: CellView[] = []
  for (let index = 0; index < src.length; index++) cells.push({ index, state: 'empty', writers: [], stores: 0, atomics: 0, active: false })
  const outside = new Map<number, OutsideView & { ids: Set<number> }>()
  const seen = new Set<number>()
  const stored = new Set<number>()

  for (const w of src.writes) {
    if (w.event >= end) break
    const bot = bots[w.id]
    if (!bot) continue
    const live = current !== null && w.event >= current.from && w.event < current.to
    if (w.index >= 0 && w.index < src.length) {
      const cell = cells[w.index]
      const key = w.index * threads + w.id
      if (!seen.has(key)) {
        seen.add(key)
        cell.writers.push({ block: bot.block, thread: bot.thread })
        bot.writes.push(w.index)
      }
      if (w.atomic) cell.atomics++
      else if (!stored.has(key)) {
        stored.add(key)
        cell.stores++
      }
      if (live) cell.active = true
      continue
    }
    let out = outside.get(w.index)
    if (!out) {
      out = { index: w.index, writers: [], active: false, ids: new Set() }
      outside.set(w.index, out)
    }
    if (!out.ids.has(w.id)) {
      out.ids.add(w.id)
      out.writers.push({ block: bot.block, thread: bot.thread })
      bot.outside.push(w.index)
    }
    if (live) out.active = true
  }

  const phase: GridPhase = end < src.events.length ? 'running' : src.complete ? 'finished' : 'stopped'
  const summary = emptySummary(threads, src.length)
  for (const cell of cells) {
    if (!cell.writers.length) cell.state = phase === 'finished' ? 'missing' : 'empty'
    else cell.state = cell.stores >= 2 ? 'dup' : 'write'
    if (cell.writers.length) summary.written++
    if (cell.state === 'missing') summary.missing++
    if (cell.state === 'dup') summary.duplicates++
  }

  for (const bot of bots) {
    const key = bot.block * src.waves + Math.floor(bot.thread / src.wave)
    const started = src.first[key] >= 0 && src.first[key] < end
    const waveDone = src.done[bot.block] === 1 && src.last[key] < end
    if (bot.outside.length) bot.state = 'oob'
    else if (bot.writes.some((i) => cells[i].state === 'dup')) bot.state = 'dup'
    else if (bot.writes.length) bot.state = 'write'
    else if (waveDone) bot.state = 'skip'
    else bot.state = started ? 'busy' : 'standby'
    if (bot.state === 'oob') summary.oob++
    if (bot.state === 'skip') summary.skipped++
    if (bot.state === 'busy') summary.busy++
    if (bot.state === 'standby') summary.standby++
  }

  let now: GridState['current'] = null
  const ev = current && current.from < src.events.length ? src.events[current.from] : null
  if (ev) {
    now = { block: ev.block, wave: ev.wave }
    for (let lane = 0; lane < ev.mask.length; lane++) {
      const thread = ev.wave * src.wave + lane
      if (ev.mask[lane] === '1' && thread < src.block) {
        const bot = bots[ev.block * src.block + thread]
        if (bot) bot.active = true
      }
    }
  }

  const outsideList = [...outside.values()].sort((a, b) => a.index - b.index).map(({ index, writers, active }) => ({ index, writers, active }))
  return { phase, bots, cells, outside: outsideList, summary, current: now }
}

// ── 按 block 汇总（线程多的时候） ─────────────────────────────────────────

export interface BlockTile {
  block: number
  threads: number
  counts: Record<BotState, number>
  /** 这个 block 有线程在执行当前这一步 */
  active: boolean
}

export function blockTiles(state: GridState, launch: GridLaunch): BlockTile[] {
  const tiles: BlockTile[] = []
  for (let block = 0; block < launch.grid; block++) {
    tiles.push({ block, threads: 0, counts: { standby: 0, busy: 0, write: 0, dup: 0, oob: 0, skip: 0 }, active: false })
  }
  for (const bot of state.bots) {
    const tile = tiles[bot.block]
    tile.threads++
    tile.counts[bot.state]++
    if (bot.active) tile.active = true
  }
  return tiles
}

// ── 悬停联动 ──────────────────────────────────────────────────────────────

export type GridTarget =
  | { kind: 'bot'; id: number }
  | { kind: 'cell'; index: number }
  | { kind: 'out'; index: number }
  | { kind: 'block'; block: number }

export interface Linked {
  bots: Set<number>
  cells: Set<number>
  outside: Set<number>
  blocks: Set<number>
}

/** 指到一个东西时，另一边哪些跟着亮：线程 → 它写的格子；格子 → 写它的线程；block → 整组线程和它们写的格子。 */
export function linked(state: GridState, target: GridTarget | null, blockDim: number): Linked {
  const out: Linked = { bots: new Set(), cells: new Set(), outside: new Set(), blocks: new Set() }
  if (!target) return out
  const addBot = (bot: BotView | undefined) => {
    if (!bot) return
    out.bots.add(bot.id)
    out.blocks.add(bot.block)
    for (const i of bot.writes) out.cells.add(i)
    for (const i of bot.outside) out.outside.add(i)
  }
  const addWriters = (writers: Writer[]) => {
    for (const w of writers) {
      out.bots.add(w.block * blockDim + w.thread)
      out.blocks.add(w.block)
    }
  }
  if (target.kind === 'bot') addBot(state.bots[target.id])
  else if (target.kind === 'block') {
    for (const bot of state.bots) if (bot.block === target.block) addBot(bot)
    out.blocks.add(target.block)
  } else if (target.kind === 'cell') {
    out.cells.add(target.index)
    addWriters(state.cells[target.index]?.writers ?? [])
  } else {
    out.outside.add(target.index)
    addWriters(state.outside.find((o) => o.index === target.index)?.writers ?? [])
  }
  return out
}

// ── 文字：脚下的短标签、读屏的说明、一句话总结 ────────────────────────────────

const who = (w: Writer) => `第 ${w.block} 组第 ${w.thread} 个`

function whoList(writers: Writer[]): string {
  const shown = writers.slice(0, 4).map(who).join('、')
  return writers.length > 4 ? `${shown}等 ${writers.length} 个线程` : `${shown}线程`
}

function at(array: string, indices: number[]): string {
  const shown = indices.slice(0, 4).map((i) => `${array}[${i}]`).join('、')
  return indices.length > 4 ? `${shown} 等 ${indices.length} 格` : shown
}

/** 机器人脚下的短标签：写了哪一格（多写的格子数）、越界、跳过、计算中、待命。 */
export function botTag(bot: BotView, array: string, cells: readonly CellView[]): string {
  const more = (list: number[]) => (list.length > 1 ? ` +${list.length - 1}` : '')
  if (bot.state === 'oob') return `${array}[${bot.outside[0]}] !`
  if (bot.state === 'dup') {
    const index = bot.writes.find((i) => cells[i]?.state === 'dup') ?? bot.writes[0]
    return `${array}[${index}] ×${cells[index]?.stores ?? 2}`
  }
  if (bot.state === 'write') return `${array}[${bot.writes[0]}]${more(bot.writes)}`
  if (bot.state === 'skip') return '跳过'
  if (bot.state === 'busy') return '计算中'
  return '待命'
}

export function botLabel(bot: BotView, array: string, cells: readonly CellView[]): string {
  const name = `第 ${bot.block} 组第 ${bot.thread} 个线程（blockIdx.x = ${bot.block}，threadIdx.x = ${bot.thread}）`
  const parts: string[] = []
  if (bot.outside.length) parts.push(`写到了数组外面的 ${at(array, bot.outside)}（越界）`)
  if (bot.writes.length) {
    parts.push(`写入 ${at(array, bot.writes)}`)
    const dups = bot.writes.filter((i) => cells[i]?.state === 'dup')
    if (dups.length) parts.push(`${at(array, dups)} 还有别的线程写（重复计算）`)
  }
  if (bot.state === 'skip') parts.push(`没有写 ${array}，检查后跳过`)
  if (bot.state === 'busy') parts.push(`轮到了，还没写 ${array}`)
  if (bot.state === 'standby') parts.push('还没轮到，待命')
  if (bot.active) parts.push('正在执行这一步')
  return `${name}：${parts.join('，')}`
}

export function cellLabel(cell: CellView, array: string): string {
  const name = `${array}[${cell.index}]`
  if (cell.state === 'missing') return `${name}：没人算`
  if (cell.state === 'empty') return `${name}：还没有线程写`
  const parts: string[] = []
  if (cell.state === 'dup') parts.push(`被 ${cell.stores} 个线程写了（重复计算）：${whoList(cell.writers)}`)
  else if (cell.atomics && !cell.stores) parts.push(`${whoList(cell.writers)}原子加了 ${cell.atomics} 次`)
  else parts.push(`由${whoList(cell.writers)}写入`)
  if (cell.active) parts.push('这一步刚写')
  return `${name}：${parts.join('，')}`
}

export function outsideLabel(out: OutsideView, array: string): string {
  return `数组外面的 ${array}[${out.index}]（越界）：${whoList(out.writers)}写到了这里${out.active ? '，这一步刚写' : ''}`
}

const STATE_NAME: Record<BotState, string> = {
  write: '写入',
  dup: '重复计算',
  oob: '越界',
  skip: '检查后跳过',
  busy: '计算中',
  standby: '待命',
}
const STATE_ORDER: BotState[] = ['write', 'dup', 'oob', 'skip', 'busy', 'standby']

/** 汇总块上的一行字：只列有人的状态。 */
export function tileCounts(tile: BlockTile): { state: BotState; name: string; count: number }[] {
  return STATE_ORDER.filter((s) => tile.counts[s] > 0).map((s) => ({ state: s, name: STATE_NAME[s], count: tile.counts[s] }))
}

export function tileLabel(tile: BlockTile): string {
  const counts = tileCounts(tile).map((c) => `${c.name} ${c.count} 个`).join('，')
  return `第 ${tile.block} 组（blockIdx.x = ${tile.block}），${tile.threads} 个线程：${counts}${tile.active ? '；正在执行这一步' : ''}`
}

/** 一句话总结，也是读屏的播报。 */
export function describeGrid(state: GridState, array: string, events: number): string {
  const s = state.summary
  if (state.phase === 'idle') return ''
  if (state.phase === 'stopped' && events === 0) return `程序没有跑起来，${array} 还是运行前的样子。`
  const parts: string[] = []
  if (state.phase === 'finished') {
    parts.push(s.written === s.length
      ? `${array} 的 ${s.length} 个格子都有线程写了`
      : `${array} 的 ${s.length} 个格子写了 ${s.written} 个，还有 ${s.missing} 个没人算`)
  } else {
    // 中文和数组名之间要空格（05 第 7 节）；全角逗号后面不用
    const lead = state.phase === 'stopped' ? '程序出错停下了，停下时 ' : '到这一步，'
    parts.push(`${lead}${array} 的 ${s.length} 个格子写了 ${s.written} 个`)
  }
  if (s.duplicates) parts.push(`${s.duplicates} 个格子被不止一个线程写（重复计算）`)
  if (s.oob) parts.push(`${s.oob} 个线程写到了数组外面`)
  if (s.skipped) parts.push(`${s.skipped} 个线程检查后跳过`)
  if (state.phase !== 'finished' && s.standby) parts.push(`${s.standby} 个线程还在待命`)
  return `${parts.join('；')}。`
}
