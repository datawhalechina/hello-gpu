/**
 * 锁步执行视图（S-07）的数据：从模拟器的事件流（08 第 5 节）算出每一步是哪个 wave 在执行哪一行、
 * 哪些 lane 在干活，以及每一行、整段的 lane 利用率。纯函数，不碰 Vue 和浏览器，单测直接导入。
 *
 * - 一步（08 第 4 节）：一个 wave 执行一条语句、if 或循环的一次判断、一次同步。和沙盒单步的一步相同
 *   （sandbox/run.ts 的 stepGroups）；这一步执行这条语句的 lane 是这一步各个事件的掩码合起来（stepMask）。
 * - lane 的样子：在干活（掩码里是 1）；空转（这个 lane 有线程，这一步被掩码关掉）；没有线程（block 的线程数
 *   不是 wave 大小的整数倍时，最后一个 wave 多出来的 lane）；同步这一步在干活的 lane 是「走到同步」。
 * - lane 利用率 = 在干活的 lane ÷ wave 大小。没有线程的 lane 也算没干活：wave 照样占着这些 lane。
 *   一行的利用率把这一行走过的每一步加起来（一行里既有判断又有执行，比如 if (i < n) c[i] = 0;，也合在一起；
 *   想分开看，就把语句写在不同的行上）；整段把所有步加起来。都是模拟器算出来的数，界面上标「模拟」。
 *   关卡判星直接用：utilization(usage(prepareWave(result, launch)))。
 * - 同步（08 第 4 节）：同一个 block 的 wave 都走到同步，才一起往下走。到某一步为止，block 里每个 wave 的状态：
 *   还没开始、正在执行、在同步处等别的 wave、同步已经等齐（等着接着跑）、走完了。
 *   一个 wave 跑到同步或结束再换下一个，是模拟器为了让结果稳定定的顺序，不是硬件行为。
 */
import type { RunResult, SimEvent, WaveSize } from '../../../sim/lockstep.ts'
import { stepGroups, stepMask } from '../sandbox/run.ts'

/** 一次启动：gridDim.x 和 blockDim.x（wave 大小以模拟器的结果为准）。 */
export interface WaveLaunch {
  grid: number
  block: number
}

/** 一步是哪一类：判断条件（if、循环的一次判断）、同步，其余（赋值、读写数组、原子加）都是执行。 */
export type StepKind = 'branch' | 'stmt' | 'barrier'

export const KIND_NAME: Record<StepKind, string> = { branch: '判断', stmt: '执行', barrier: '同步' }
const KIND_ORDER: StepKind[] = ['branch', 'stmt', 'barrier']

export interface WaveStep {
  /** 第几步（0 起），和 stepGroups、沙盒单步的 index 一致 */
  index: number
  block: number
  wave: number
  line: number
  kind: StepKind
  /** 这一步执行这条语句的 lane：'1' 在干活，'0' 没有；长度 = wave 大小，第一个字符是 lane 0 */
  mask: string
  /** mask 里 '1' 的个数 */
  active: number
  /** 这一步的事件在事件流里的范围 [from, to) */
  from: number
  to: number
}

export interface WaveSource {
  /** wave 大小 */
  size: WaveSize
  grid: number
  block: number
  /** 一个 block 切成几个 wave */
  waves: number
  steps: WaveStep[]
  /** 每个 wave（编号 block × waves + wave）走过的步，按先后，存的是 steps 的下标 */
  byWave: number[][]
  /** 和 byWave 对应：每个 wave 走过的前 k 步里有几次同步（长度是这个 wave 的步数 + 1） */
  syncs: Int32Array[]
  events: readonly SimEvent[]
  /** 程序正常结束 */
  complete: boolean
  /** 程序出错停下时，出错的那一行 */
  errorLine: number | null
}

export function prepareWave(result: RunResult, launch: WaveLaunch): WaveSource {
  const size = result.wave
  const { grid, block } = launch
  const waves = Math.max(1, Math.ceil(block / size))
  const { events } = result
  const byWave: number[][] = Array.from({ length: grid * waves }, () => [])
  const steps = stepGroups(events).map((g, index): WaveStep => {
    let kind: StepKind = 'stmt'
    for (let e = g.from; e < g.to; e++) {
      const op = events[e].op
      if (op === 'branch') kind = 'branch'
      else if (op === 'barrier') kind = 'barrier'
    }
    const mask = stepMask(events, g)
    let active = 0
    for (let l = 0; l < mask.length; l++) if (mask.charCodeAt(l) === 49) active++
    if (g.block >= 0 && g.block < grid && g.wave >= 0 && g.wave < waves) byWave[g.block * waves + g.wave].push(index)
    return { index, block: g.block, wave: g.wave, line: g.line, kind, mask, active, from: g.from, to: g.to }
  })
  const syncs = byWave.map((list) => {
    const out = new Int32Array(list.length + 1)
    list.forEach((i, k) => {
      out[k + 1] = out[k] + (steps[i].kind === 'barrier' ? 1 : 0)
    })
    return out
  })
  return { size, grid, block, waves, steps, byWave, syncs, events, complete: result.ok, errorLine: result.ok ? null : result.error.line }
}

/** 这个 wave 有几个线程：最后一个 wave 可能不满。 */
export function waveThreads(size: number, block: number, wave: number): number {
  return Math.max(0, Math.min(size, block - wave * size))
}

// ── lane ──────────────────────────────────────────────────────────────────

/** standby：还没开始；active：在干活；idle：空转；empty：没有线程；sync：走到了同步 */
export type LaneState = 'standby' | 'active' | 'idle' | 'empty' | 'sync'

export interface LaneView {
  lane: number
  /** threadIdx.x；没有线程的 lane 是 null */
  thread: number | null
  state: LaneState
}

/** 一个 wave 的全部 lane。step 是这个 wave 正在执行的一步；还没开始就是 null，有线程的 lane 都在待命。 */
export function laneViews(size: number, block: number, wave: number, step: WaveStep | null): LaneView[] {
  const threads = waveThreads(size, block, wave)
  const out: LaneView[] = []
  for (let lane = 0; lane < size; lane++) {
    if (lane >= threads) {
      out.push({ lane, thread: null, state: 'empty' })
      continue
    }
    let state: LaneState = 'standby'
    if (step) state = step.mask[lane] !== '1' ? 'idle' : step.kind === 'barrier' ? 'sync' : 'active'
    out.push({ lane, thread: wave * size + lane, state })
  }
  return out
}

export interface MaskRun {
  state: 'active' | 'idle' | 'empty'
  /** lane 的范围 [from, to) */
  from: number
  to: number
}

/** 把一步的掩码切成连续的几段：在干活、空转、没有线程（画成一条）。 */
export function maskRuns(mask: string, threads: number): MaskRun[] {
  const runs: MaskRun[] = []
  for (let lane = 0; lane < mask.length; lane++) {
    const state = lane >= threads ? 'empty' : mask[lane] === '1' ? 'active' : 'idle'
    const last = runs[runs.length - 1]
    if (last?.state === state) last.to = lane + 1
    else runs.push({ state, from: lane, to: lane + 1 })
  }
  return runs
}

// ── lane 利用率 ────────────────────────────────────────────────────────────

export interface LineUse {
  line: number
  /** 这一行走了几步，分判断、执行、同步 */
  steps: number
  kinds: Record<StepKind, number>
  /** 这几步里在干活的 lane 加起来 */
  active: number
  /** 这几步的 lane 加起来（步数 × wave 大小） */
  lanes: number
}

export interface Usage {
  steps: number
  active: number
  lanes: number
  /** 走过的行，按行号排 */
  lines: LineUse[]
}

/** 前 upto 步（默认全部）的 lane 利用率：每一行，和整段。 */
export function usage(src: WaveSource, upto = Number.POSITIVE_INFINITY): Usage {
  const end = Math.max(0, Math.min(upto, src.steps.length))
  const byLine = new Map<number, LineUse>()
  let active = 0
  for (let i = 0; i < end; i++) {
    const s = src.steps[i]
    let use = byLine.get(s.line)
    if (!use) {
      use = { line: s.line, steps: 0, kinds: { branch: 0, stmt: 0, barrier: 0 }, active: 0, lanes: 0 }
      byLine.set(s.line, use)
    }
    use.steps++
    use.kinds[s.kind]++
    use.active += s.active
    use.lanes += src.size
    active += s.active
  }
  return { steps: end, active, lanes: end * src.size, lines: [...byLine.values()].sort((a, b) => a.line - b.line) }
}

/** 利用率（0–1）：在干活的 lane ÷ 全部 lane；一步都没有是 0。 */
export function utilization(u: { active: number; lanes: number }): number {
  return u.lanes > 0 ? u.active / u.lanes : 0
}

// ── 同步：block 里每个 wave 走到哪了 ─────────────────────────────────────────

/** idle：还没开始；running：这一步就是它；waiting：在同步处等别的 wave；ready：同步等齐了，等着接着跑；done：走完了 */
export type WaveStatus = 'idle' | 'running' | 'waiting' | 'ready' | 'done'

export interface WaveState {
  wave: number
  /** 这个 wave 的 threadIdx.x 范围 */
  first: number
  last: number
  status: WaveStatus
  /** running：这一步的行；waiting、ready：停在哪一行的同步；其余是 null */
  line: number | null
}

/** sorted（升序）里不大于 value 的有几个。 */
function countUpTo(sorted: readonly number[], value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 走到第 current 步（0 起，含这一步）时，每个 wave 到过几次同步、走了几步。 */
function progressOf(src: WaveSource, block: number, current: number) {
  const counts: number[] = []
  const reached: number[] = []
  for (let w = 0; w < src.waves; w++) {
    const key = block * src.waves + w
    const k = countUpTo(src.byWave[key], current)
    counts.push(k)
    reached.push(src.syncs[key][k])
  }
  return { counts, reached, released: Math.min(...reached) }
}

/** 走到第 current 步（0 起，含这一步）时，这一步所在 block 里每个 wave 的状态。 */
export function waveStates(src: WaveSource, current: number): WaveState[] {
  const step = src.steps[current]
  if (!step) return []
  const b = step.block
  const { counts, reached, released } = progressOf(src, b, current)
  return counts.map((k, w) => {
    const first = w * src.size
    const base = { wave: w, first, last: first + waveThreads(src.size, src.block, w) - 1 }
    const list = src.byWave[b * src.waves + w]
    if (w === step.wave) return { ...base, status: 'running', line: step.line }
    if (k === 0) return { ...base, status: 'idle', line: null }
    const prev = src.steps[list[k - 1]]
    if (prev.kind === 'barrier' && reached[w] > released) return { ...base, status: 'waiting', line: prev.line }
    if (k >= list.length) return { ...base, status: 'done', line: null }
    return { ...base, status: 'ready', line: prev.kind === 'barrier' ? prev.line : null }
  })
}

/** 这一步是同步时：block 里几个 wave 已经走到这一次同步（含这个 wave），一共几个。不是同步是 null。 */
export function syncProgress(src: WaveSource, current: number): { arrived: number; total: number } | null {
  const step = src.steps[current]
  if (!step || step.kind !== 'barrier') return null
  const { reached } = progressOf(src, step.block, current)
  const mine = reached[step.wave]
  return { arrived: reached.filter((r) => r >= mine).length, total: src.waves }
}

/** 一个 wave 走过的步：到第 upto 步为止（含），默认全部。 */
export function waveTrace(src: WaveSource, block: number, wave: number, upto = Number.POSITIVE_INFINITY): WaveStep[] {
  const out: WaveStep[] = []
  for (const i of src.byWave[block * src.waves + wave] ?? []) {
    if (i > upto) break
    out.push(src.steps[i])
  }
  return out
}

export interface WaveRef {
  block: number
  wave: number
  /** 这个 wave 走了几步 */
  steps: number
}

/** 跑过的 wave，按第一次跑的先后（给了随机种子时 block 的顺序会打乱）。 */
export function wavesRun(src: WaveSource): WaveRef[] {
  const out: WaveRef[] = []
  const seen = new Set<number>()
  for (const s of src.steps) {
    const key = s.block * src.waves + s.wave
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ block: s.block, wave: s.wave, steps: src.byWave[key]?.length ?? 0 })
  }
  return out
}

// ── 文字 ──────────────────────────────────────────────────────────────────

/** 一组从小到大的数写成「0–12、16、20–31」；limit 给了就只写前几段，后面写「等」（个数由调用的地方另外写）。 */
export function ranges(list: readonly number[], limit = Number.POSITIVE_INFINITY): string {
  const parts: string[] = []
  let k = 0
  while (k < list.length) {
    let end = k
    while (end + 1 < list.length && list[end + 1] === list[end] + 1) end++
    parts.push(end > k ? `${list[k]}–${list[end]}` : String(list[k]))
    k = end + 1
  }
  return parts.length > limit ? `${parts.slice(0, limit).join('、')} 等` : parts.join('、')
}

/** 百分比：整数照写，不是整数留一位小数；四舍五入不会把没到 100% 的写成 100%，也不会把不是 0 的写成 0%。 */
export function percent(r: number): string {
  const p = r * 100
  if (Math.abs(p - Math.round(p)) < 1e-9) return `${Math.round(p)}%`
  const v = Math.min(99.9, Math.max(0.1, Math.round(p * 10) / 10))
  return `${v}%`
}

/** 平均数：整数照写，否则留一位小数。 */
function num(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10)
}

/** 一步里这个 wave 的 lane 是什么样：几个在干活（哪几个线程）、几个空转、几个没有线程、利用率。 */
export function describeLanes(lanes: readonly LaneView[], limit = Number.POSITIVE_INFINITY): string {
  const pick = (state: LaneState) => lanes.filter((l) => l.state === state).map((l) => l.thread as number)
  const empty = lanes.filter((l) => l.state === 'empty').length
  const standby = pick('standby')
  const parts: string[] = []
  if (standby.length || lanes.every((l) => l.state === 'empty')) {
    parts.push(`这个 wave 有 ${lanes.length} 个 lane，${standby.length ? `threadIdx.x ${ranges(standby, limit)} 在待命` : '都没有线程'}`)
    if (empty && standby.length) parts.push(`另外 ${empty} 个 lane 没有线程`)
    return `${parts.join('，')}。`
  }
  const active = pick('active')
  const sync = pick('sync')
  const idle = pick('idle')
  if (active.length) parts.push(`${active.length} 个 lane 在干活（threadIdx.x ${ranges(active, limit)}）`)
  if (sync.length) parts.push(`${sync.length} 个 lane 走到了同步（threadIdx.x ${ranges(sync, limit)}）`)
  if (idle.length) parts.push(`${idle.length} 个空转（threadIdx.x ${ranges(idle, limit)}）`)
  if (empty) parts.push(`${empty} 个没有线程`)
  const used = active.length + sync.length
  return `${parts.join('，')}；这一步的 lane 利用率 ${percent(used / lanes.length)}（模拟）。`
}

/** 代码区行尾的说明（也是读屏文字）：这一行走了几步、平均几个 lane 在干活、利用率。 */
export function lineUseLabel(use: LineUse, size: number): string {
  const kinds = KIND_ORDER.filter((k) => use.kinds[k] > 0)
  const detail = kinds.length > 1 ? `（${kinds.map((k) => `${KIND_NAME[k]} ${use.kinds[k]} 步`).join('、')}）` : ''
  return `第 ${use.line} 行一共 ${use.steps} 步${detail}，平均 ${num(use.active / use.steps)} / ${size} 个 lane 在干活，lane 利用率 ${percent(utilization(use))}（模拟）`
}

/** 一句话总结，也是读屏的播报：整段（或到这一步为止）平均每步几个 lane 在干活、利用率多少，最低的是哪几行。 */
export function describeUsage(u: Usage, size: number, scope: 'all' | 'sofar'): string {
  if (!u.steps) return ''
  const lead = scope === 'all' ? `整段一共 ${u.steps} 步` : `到这一步为止走了 ${u.steps} 步`
  let text = `${lead}，平均每步 ${num(u.active / u.steps)} / ${size} 个 lane 在干活，lane 利用率 ${percent(utilization(u))}（模拟）。`
  const rates = u.lines.map(utilization)
  const low = Math.min(...rates)
  if (u.lines.length > 1 && low < Math.max(...rates)) {
    const worst = u.lines.filter((_, k) => rates[k] === low).map((l) => `第 ${l.line} 行`)
    text += `利用率最低的是${worst.join('、')}：${percent(low)}。`
  }
  return text
}

/** block 里一个 wave 的状态写成一句话。 */
export function waveStateLabel(s: WaveState, kind: StepKind | null): string {
  if (s.status === 'running') return kind === 'barrier' ? `走到第 ${s.line} 行的同步` : `正在执行第 ${s.line} 行`
  if (s.status === 'waiting') return `在第 ${s.line} 行的同步处等别的 wave`
  if (s.status === 'ready') return s.line ? `第 ${s.line} 行的同步已经等齐，等着接着跑` : '等着接着跑'
  if (s.status === 'done') return '走完了'
  return '还没开始'
}

/** 这一步是同步时的一句话：这个 wave 是不是最后一个到的。 */
export function syncLabel(progress: { arrived: number; total: number }, line: number): string {
  if (progress.total === 1) return `第 ${line} 行是同步：这个 block 只有这 1 个 wave，走到就接着往下走。`
  if (progress.arrived >= progress.total) return `第 ${line} 行是同步：block 里的 ${progress.total} 个 wave 都走到了，一起往下走。`
  const rest = progress.total - progress.arrived
  return `第 ${line} 行是同步：这个 wave 停在这里，等 block 里另外 ${rest} 个 wave 也走到这一行。`
}
