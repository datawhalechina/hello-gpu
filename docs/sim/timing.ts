/**
 * 模拟器 L4：示意计时与占用率（08 第 2、5、7 节）。
 *
 * 回答「哪种写法更好」和「等待怎样被别的 wave 藏住」。读 L2 的事件流（lockstep.ts 的 SimEvent），
 * 显存的车次、LDS 的轮数用 L3（memory.ts）算。参数默认取 params.ts 的 SIM_PARAMS，都是示意值：
 * 算出来的周期数、占用率、比例只用来比较写法、讲道理，界面上一律标注「模拟」，不能当成真机的数。
 * 一步和 L2 一样：一个 wave 执行一条语句、一次判断或一次同步，同一步的事件 step 相同。
 *
 * 示意计时（estimateTime）：把每个 wave 的每一步按参数表的价钱加起来，分成三部分。
 * - 计算：每一步 issueCycles 个周期；wave64 翻倍（向量指令分前后两半各发一次）。
 * - 访存：显存每搬一车 lineCycles 个周期；显存上同一个元素的原子加要一个一个做，
 *   人最多的那个元素上每多一个 lane，多 atomicCycles 个周期；LDS 每一轮 ldsCycles 个周期
 *   （bank 冲突、LDS 原子加排队都已经算在 L3 的轮数里）。
 * - 同步：每个 wave 每次同步 barrierCycles 个周期。
 * 结果是所有 wave 的活加起来，也就是 SIMD 一刻不停、等数据的时间全被藏住时，一个 SIMD 做完要多少个周期。
 * 三部分各算各的，不互相重叠，方便拆开比较。读显存的往返延迟（memLatency）不算在里面：
 * 藏不藏得住要看同时住了几个 wave，由时间线回答。每一项都是「次数 × 价钱」再相加，
 * 所以车次、轮数、步数都不增加时，示意时间一定不会增加。
 *
 * 占用率（occupancy）：一个 SIMD 同时能住几个 wave。规则的形式和真机一样 [1][2][3][4]，数值是示意：
 * - 一个 block 的 wave 一起住进同一个 WGP（有 simds 个 SIMD），一起离开，所以住进来的总是整 block；
 * - 名额：每个 SIMD 最多住 waveSlots 个 wave；
 * - VGPR：每个 SIMD 有 vgprsPerSimd 个（按 wave32 数），一个 wave 的用量往上凑整到 vgprGranule 的整数倍，
 *   wave64 每个寄存器占两倍；
 * - LDS：一个 block 的用量往上凑整到 ldsGranule 的整数倍，一个 WGP 一共 ldsBytes 字节；
 * - block 个数：一个 WGP 最多住 maxBlocks 个 block，只有一个 wave 的 block 不算在里面 [2]。
 * 每一项各自能让 WGP 住几个 block，取最小的那个；住进来的 wave 平均分到各个 SIMD（平均数可能不是整数）。
 *
 * 延迟隐藏时间线（latencyTimeline）：只看一个 SIMD。从事件流开头按 block 取 wave，取到住不下为止
 * （最多 waves 个；一个 block 的 wave 要一起住进来），这些 wave 一开始就都住在 SIMD 上，后面的 wave 不画。
 * - 每个 wave 按事件流的顺序做事：每一步先占 SIMD 算 issueCycles 个周期（run）；
 *   有访存的步接着等（memory）：读显存要等 memLatency 再加搬运，写和原子加只等搬运，LDS 等轮数 × ldsCycles；
 *   同步的步等同一个 block 里还没做完的 wave 都到齐，再过 barrierCycles 一起往下走（sync）。
 * - SIMD 一次只给一个 wave 算。正在算的 wave 一直算到要等为止，再换准备好的 wave 里等得最久的那个
 *   （同时准备好的，先住进来的先算：先比 block 在事件流里的先后，再比 wave 编号）。
 *   准备好了却轮不到 SIMD 的那段记 ready。
 * - 等待被藏住的比例：有 wave 在等（memory、sync）的那些周期里，SIMD 正在给别的 wave 算的周期占多少；
 *   几个 wave 同时在等，这个周期也只算一次。思路和 Radeon GPU Profiler 看延迟隐藏一样：
 *   等待的时候，SIMD 有没有在执行别的 wave 的指令 [3]。
 * - 每个 wave 做的事一样时，住的 wave 越多，这个比例不降低（单测按这一条检查）；
 *   wave 做的事不一样（比如分支发散）时不保证。
 * - 不模拟带宽：很多 wave 同时搬运也不用排队。
 * - 只有一个 wave 时没有重叠：总周期数 = 这个 wave 的示意周期数 + 读了显存的步数 × memLatency。
 *
 * 资料：[1][2][3] 见 params.ts 开头；[4] AMD Radeon Compute Profiler 文档「Kernel Occupancy」
 * （按寄存器、LDS、work-group 大小各算一个上限，取最小，并且要是整 work-group）：
 * https://radeon-compute-profiler-rcp.readthedocs.io/en/latest/occupancy.html
 */
import type { SimEvent, WaveSize } from './lockstep.ts'
import { analyzeLdsBanks, analyzeMemory, type LdsOptions, type MemoryOptions } from './memory.ts'
import { SIM_PARAMS } from './params.ts'

// ── 示意计时 ───────────────────────────────────────────────────────────

/** 每一步的价钱；车次、轮数用到的 lineBytes、elemBytes、banks、bankBytes 也在这里传。 */
export interface TimingOptions extends MemoryOptions, LdsOptions {
  /** 一步占 SIMD 几个周期（wave64 翻倍），默认 SIM_PARAMS.issueCycles */
  issueCycles?: number
  /** 显存每搬一车几个周期，默认 SIM_PARAMS.lineCycles */
  lineCycles?: number
  /** LDS 每一轮几个周期，默认 SIM_PARAMS.ldsCycles */
  ldsCycles?: number
  /** 显存上同一个元素的原子加，每多一个 lane 多几个周期，默认 SIM_PARAMS.atomicCycles */
  atomicCycles?: number
  /** 每个 wave 每次同步几个周期，默认 SIM_PARAMS.barrierCycles */
  barrierCycles?: number
}

/** 一个 wave 的示意周期数。 */
export interface WaveTime {
  block: number
  wave: number
  compute: number
  memory: number
  sync: number
  /** compute + memory + sync */
  cycles: number
}

export interface TimeEstimate {
  /** 所有 wave 加起来：compute + memory + sync */
  cycles: number
  compute: number
  memory: number
  sync: number
  /** 每个 wave，按在事件流里第一次出现的顺序 */
  waves: WaveTime[]
}

/** 示意周期数：每个 wave 的每一步按价钱加起来，拆成计算、访存、同步三部分。 */
export function estimateTime(events: readonly SimEvent[], options: TimingOptions = {}): TimeEstimate {
  const costs = resolveCosts(options)
  const total = { cycles: 0, compute: 0, memory: 0, sync: 0 }
  const waves = work(events, options, costs).map(({ block, wave, steps }): WaveTime => {
    let compute = 0
    let memory = 0
    let sync = 0
    for (const s of steps) {
      compute += s.compute
      memory += s.memory
      if (s.barrier) sync += costs.barrierCycles
    }
    total.compute += compute
    total.memory += memory
    total.sync += sync
    return { block, wave, compute, memory, sync, cycles: compute + memory + sync }
  })
  total.cycles = total.compute + total.memory + total.sync
  return { ...total, waves }
}

interface Costs {
  issueCycles: number
  lineCycles: number
  ldsCycles: number
  atomicCycles: number
  barrierCycles: number
}

function resolveCosts(o: TimingOptions): Costs {
  return {
    issueCycles: positive('issueCycles', o.issueCycles ?? SIM_PARAMS.issueCycles),
    lineCycles: nonNegative('lineCycles', o.lineCycles ?? SIM_PARAMS.lineCycles),
    ldsCycles: nonNegative('ldsCycles', o.ldsCycles ?? SIM_PARAMS.ldsCycles),
    atomicCycles: nonNegative('atomicCycles', o.atomicCycles ?? SIM_PARAMS.atomicCycles),
    barrierCycles: nonNegative('barrierCycles', o.barrierCycles ?? SIM_PARAMS.barrierCycles),
  }
}

/** 一个 wave 的一步。 */
interface Step {
  /** 这一步的第一个事件在 events 里的位置 */
  event: number
  compute: number
  /** 搬运、LDS 轮数、原子加排队，不含读显存的往返延迟 */
  memory: number
  /** 这一步读了显存：时间线里还要等往返延迟 */
  load: boolean
  barrier: boolean
}

interface WaveWork {
  block: number
  wave: number
  steps: Step[]
}

/** 把事件流按 wave 分开，每一步算好计算和访存的周期数。wave 按在事件流里第一次出现的顺序。 */
function work(events: readonly SimEvent[], options: TimingOptions, costs: Costs): WaveWork[] {
  /** 每个访存事件的访存周期数 */
  const memory = new Float64Array(events.length)
  for (const a of analyzeMemory(events, options).accesses) {
    const e = events[a.event]
    const queue = e.op === 'atomic' ? Math.max(0, crowd(e.addrs ?? []) - 1) : 0
    memory[a.event] = a.transactions * costs.lineCycles + queue * costs.atomicCycles
  }
  for (const a of analyzeLdsBanks(events, options).accesses) memory[a.event] = a.passes * costs.ldsCycles

  const waves: WaveWork[] = []
  const byKey = new Map<string, WaveWork>()
  let step: Step | null = null
  let prev: SimEvent | null = null
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (step === null || prev === null || e.step !== prev.step || e.block !== prev.block || e.wave !== prev.wave) {
      const key = `${e.block} ${e.wave}`
      let w = byKey.get(key)
      if (!w) {
        w = { block: e.block, wave: e.wave, steps: [] }
        byKey.set(key, w)
        waves.push(w)
      }
      // wave64 的向量指令分两半各发一次
      step = { event: i, compute: costs.issueCycles * Math.ceil(e.mask.length / 32), memory: 0, load: false, barrier: false }
      w.steps.push(step)
    }
    step.memory += memory[i]
    if (e.op === 'load' && e.space === 'global') step.load = true
    if (e.op === 'barrier') step.barrier = true
    prev = e
  }
  return waves
}

/** 人最多的那个元素上有几个 lane。 */
function crowd(addrs: readonly number[]): number {
  const sorted = Float64Array.from(addrs).sort()
  let most = 0
  let run = 0
  for (let k = 0; k < sorted.length; k++) {
    run = k > 0 && sorted[k] === sorted[k - 1] ? run + 1 : 1
    if (run > most) most = run
  }
  return most
}

// ── 占用率 ─────────────────────────────────────────────────────────────

/** 哪一项把住进来的 wave 数卡住了：名额、VGPR、LDS、block 个数。 */
export type OccupancyLimiter = 'slots' | 'vgprs' | 'lds' | 'blocks'

export interface OccupancyOptions {
  /** 每个线程用几个 VGPR */
  vgprs: number
  /** blockDim.x：每个 block 多少个线程 */
  block: number
  /** 每个 block 用多少字节 LDS，默认 0 */
  lds?: number
  /** wave 大小，默认 32 */
  wave?: WaveSize
  // 下面这些默认取 SIM_PARAMS 里的同名项
  waveSlots?: number
  vgprsPerSimd?: number
  vgprGranule?: number
  maxVgprs?: number
  simds?: number
  ldsBytes?: number
  ldsGranule?: number
  maxLdsPerBlock?: number
  maxBlocks?: number
  maxBlockThreads?: number
}

export interface Occupancy {
  /** 一个 block 有几个 wave */
  wavesPerBlock: number
  /** 一个 WGP 同时能住几个 block；0 表示一个都放不下 */
  blocks: number
  /** 一个 WGP 同时能住几个 wave：blocks × wavesPerBlock */
  waves: number
  /** 平均每个 SIMD 住几个 wave：waves ÷ simds，可能不是整数 */
  wavesPerSimd: number
  /** 占用率：wavesPerSimd ÷ waveSlots */
  occupancy: number
  /** 住进来的 wave 数被哪一项卡住；几项一样少时按 slots、vgprs、lds、blocks 的顺序取第一个 */
  limiter: OccupancyLimiter
  /** 只看这一项时，平均每个 SIMD 能住几个 wave（也按整 block 算）；这一项不限制时是 Infinity */
  limits: Record<OccupancyLimiter, number>
}

const LIMITERS: readonly OccupancyLimiter[] = ['slots', 'vgprs', 'lds', 'blocks']

/** 给定每个线程的 VGPR 用量、每个 block 的 LDS 用量和 block 大小，算一个 SIMD 能同时住几个 wave。 */
export function occupancy(options: OccupancyOptions): Occupancy {
  const wave = options.wave ?? 32
  if (wave !== 32 && wave !== 64) throw new RangeError(`wave 大小只能是 32 或 64，收到的是 ${String(wave)}。`)
  const waveSlots = positive('waveSlots', options.waveSlots ?? SIM_PARAMS.waveSlots)
  const vgprsPerSimd = positive('vgprsPerSimd', options.vgprsPerSimd ?? SIM_PARAMS.vgprsPerSimd)
  const vgprGranule = positive('vgprGranule', options.vgprGranule ?? SIM_PARAMS.vgprGranule)
  const maxVgprs = positive('maxVgprs', options.maxVgprs ?? SIM_PARAMS.maxVgprs)
  const simds = positive('simds', options.simds ?? SIM_PARAMS.simds)
  const ldsBytes = positive('ldsBytes', options.ldsBytes ?? SIM_PARAMS.ldsBytes)
  const ldsGranule = positive('ldsGranule', options.ldsGranule ?? SIM_PARAMS.ldsGranule)
  const maxLdsPerBlock = positive('maxLdsPerBlock', options.maxLdsPerBlock ?? SIM_PARAMS.maxLdsPerBlock)
  const maxBlocks = positive('maxBlocks', options.maxBlocks ?? SIM_PARAMS.maxBlocks)
  const maxBlockThreads = positive('maxBlockThreads', options.maxBlockThreads ?? SIM_PARAMS.maxBlockThreads)
  const vgprs = between('vgprs', options.vgprs, 1, maxVgprs)
  const block = between('block', options.block, 1, maxBlockThreads)
  const lds = between('lds', options.lds ?? 0, 0, maxLdsPerBlock)

  const wavesPerBlock = Math.ceil(block / wave)
  // 一个 wave 占几个 VGPR（按 wave32 数）：wave64 每个寄存器占两倍，再往上凑整到整份
  const vgprsPerWave = Math.ceil((vgprs * (wave / 32)) / vgprGranule) * vgprGranule
  // 每一项各自能让一个 WGP 住几个 block；名额和 VGPR 是每个 SIMD 的，一个 block 的 wave 可以分到几个 SIMD 上
  const blocks: Record<OccupancyLimiter, number> = {
    slots: Math.floor((simds * waveSlots) / wavesPerBlock),
    vgprs: Math.floor((simds * Math.floor(vgprsPerSimd / vgprsPerWave)) / wavesPerBlock),
    lds: lds > 0 ? Math.floor(ldsBytes / (Math.ceil(lds / ldsGranule) * ldsGranule)) : Infinity,
    blocks: wavesPerBlock > 1 ? maxBlocks : Infinity,
  }
  let limiter: OccupancyLimiter = LIMITERS[0]
  for (const k of LIMITERS) if (blocks[k] < blocks[limiter]) limiter = k
  const perSimd = (b: number) => (b * wavesPerBlock) / simds
  const limits = { slots: perSimd(blocks.slots), vgprs: perSimd(blocks.vgprs), lds: perSimd(blocks.lds), blocks: perSimd(blocks.blocks) }
  const n = blocks[limiter]
  return { wavesPerBlock, blocks: n, waves: n * wavesPerBlock, wavesPerSimd: perSimd(n), occupancy: perSimd(n) / waveSlots, limiter, limits }
}

// ── 延迟隐藏时间线 ─────────────────────────────────────────────────────

export interface TimelineOptions extends TimingOptions {
  /** SIMD 上最多同时住几个 wave，默认 SIM_PARAMS.waveSlots；通常取 occupancy() 的 wavesPerSimd（不是整数时取整数部分） */
  waves?: number
  /** 读显存的往返延迟，默认 SIM_PARAMS.memLatency */
  memLatency?: number
}

/** run：占着 SIMD 算；memory：等访存；sync：等同步；ready：准备好了，等 SIMD 空出来。 */
export type SegmentKind = 'run' | 'memory' | 'sync' | 'ready'

export interface TimelineSegment {
  block: number
  wave: number
  kind: SegmentKind
  /** 从第几个周期开始 */
  start: number
  /** 到第几个周期为止（不含） */
  end: number
  /** 这一段属于哪一步：那一步的第一个事件在 events 里的位置；ready 段是轮到 SIMD 以后要算的那一步 */
  event: number
}

export interface Timeline {
  /** 时间线上有几个 wave：从事件流开头按 block 取，取到 SIMD 住不下为止 */
  waves: number
  /** 事件流里后面还有几个 wave 住不下，没有画 */
  skipped: number
  /** 按开始的周期排序；同时开始的，先住进来的在前。长度为 0 的段不记 */
  segments: TimelineSegment[]
  /** 一共多少个周期：最后一个 wave 做完的时候 */
  cycles: number
  /** SIMD 在算的周期数：所有 run 段加起来 */
  busy: number
  /** SIMD 空着的周期数：cycles − busy */
  idle: number
  /** 有 wave 在等（memory、sync）的周期数；几个 wave 同时在等，也只算一次 */
  waiting: number
  /** 其中 SIMD 正在给别的 wave 算的周期数 */
  hidden: number
  /** 等待被藏住的比例：hidden ÷ waiting；没有等待时记 1 */
  hiddenRatio: number
}

interface Item {
  kind: 'run' | 'memory' | 'sync'
  cycles: number
  event: number
}

interface Task {
  block: number
  wave: number
  items: Item[]
  /** 下一项 */
  pos: number
  group: Group
  /** 住进来的先后：先比 block 在事件流里的先后，再比 wave 编号 */
  seq: number
  /** 什么时候准备好（下一项是 run） */
  readyAt: number
  /** 什么时候到的同步 */
  arrivedAt: number
}

interface Group {
  tasks: Task[]
  /** 还没做完的 wave 数 */
  left: number
  /** 停在同步上的 wave */
  waiting: Task[]
}

/** 多个 wave 在一个 SIMD 上交替执行的时间线，以及等待被藏住的比例。 */
export function latencyTimeline(events: readonly SimEvent[], options: TimelineOptions = {}): Timeline {
  const costs = resolveCosts(options)
  const capacity = positive('waves', options.waves ?? SIM_PARAMS.waveSlots)
  const memLatency = nonNegative('memLatency', options.memLatency ?? SIM_PARAMS.memLatency)

  const groups: Group[] = []
  const groupOf = new Map<number, Group>()
  for (const w of work(events, options, costs)) {
    let g = groupOf.get(w.block)
    if (!g) {
      g = { tasks: [], left: 0, waiting: [] }
      groupOf.set(w.block, g)
      groups.push(g)
    }
    const items: Item[] = []
    for (const s of w.steps) {
      items.push({ kind: 'run', cycles: s.compute, event: s.event })
      const wait = s.memory + (s.load ? memLatency : 0)
      if (wait > 0) items.push({ kind: 'memory', cycles: wait, event: s.event })
      if (s.barrier) items.push({ kind: 'sync', cycles: costs.barrierCycles, event: s.event })
    }
    g.tasks.push({ block: w.block, wave: w.wave, items, pos: 0, group: g, seq: 0, readyAt: 0, arrivedAt: 0 })
    g.left++
  }

  /** 等着轮到 SIMD 的 wave：等得最久的先算，同时准备好的先住进来的先算 */
  const queue = new Heap<Task>((a, b) => a.readyAt < b.readyAt || (a.readyAt === b.readyAt && a.seq < b.seq))
  // 从开头按 block 取，一个 block 的 wave 一起住进来，取到住不下为止
  let resident = 0
  let taken = 0
  for (; taken < groups.length && resident + groups[taken].tasks.length <= capacity; taken++) {
    for (const task of groups[taken].tasks) {
      task.seq = resident++
      queue.push(task)
    }
  }
  if (taken === 0 && groups.length > 0) {
    const first = groups[0].tasks
    throw new RangeError(`block ${first[0].block} 有 ${first.length} 个 wave，SIMD 最多同时住 ${capacity} 个，放不下：一个 block 的 wave 要一起住进来。`)
  }
  let skipped = 0
  for (let k = taken; k < groups.length; k++) skipped += groups[k].tasks.length

  const placed: Array<{ segment: TimelineSegment; seq: number }> = []
  const add = (t: Task, kind: SegmentKind, start: number, end: number, event: number) => {
    if (end > start) placed.push({ segment: { block: t.block, wave: t.wave, kind, start, end, event }, seq: t.seq })
  }
  /** 一个 wave 在 t 时做完了。 */
  const finish = (task: Task, t: number) => {
    task.group.left--
    release(task.group, t)
  }
  /**
   * 还没做完的 wave 都停在同步上了：等最后一个到的，再过 barrierCycles 一起放行。
   * 完整的事件流里同一个 block 的 wave 都会走到同一个同步；出错时截断的事件流里，已经做完的 wave 不用等。
   */
  const release = (g: Group, t: number) => {
    if (g.waiting.length === 0 || g.waiting.length < g.left) return
    let at = t
    for (const w of g.waiting) if (w.arrivedAt > at) at = w.arrivedAt
    const waiting = g.waiting
    g.waiting = []
    for (const w of waiting) {
      const item = w.items[w.pos - 1]
      const end = at + item.cycles
      add(w, 'sync', w.arrivedAt, end, item.event)
      w.readyAt = end
      if (w.pos === w.items.length) finish(w, end)
      else queue.push(w)
    }
  }

  let now = 0
  for (let task = queue.pop(); task; task = queue.pop()) {
    // 等得最久的那个还没准备好，SIMD 就空着等它
    if (task.readyAt > now) now = task.readyAt
    add(task, 'ready', task.readyAt, now, task.items[task.pos].event)
    // 一直算到要等为止
    let item: Item | undefined = task.items[task.pos]
    while (item && item.kind === 'run') {
      add(task, 'run', now, now + item.cycles, item.event)
      now += item.cycles
      item = task.items[++task.pos]
    }
    if (!item) {
      finish(task, now)
      continue
    }
    task.pos++
    if (item.kind === 'memory') {
      add(task, 'memory', now, now + item.cycles, item.event)
      task.readyAt = now + item.cycles
      if (task.pos === task.items.length) finish(task, task.readyAt)
      else queue.push(task)
    } else {
      task.arrivedAt = now
      task.group.waiting.push(task)
      release(task.group, now)
    }
  }
  for (let k = 0; k < taken; k++) if (groups[k].left > 0) throw new Error('时间线没有排完：有 wave 一直停在同步上。')

  placed.sort((a, b) => a.segment.start - b.segment.start || a.seq - b.seq)
  const segments = placed.map((p) => p.segment)
  // SIMD 在算的段按时间排好、互不重叠；busyBefore(t) 是第 0 到第 t 个周期里 SIMD 在算的周期数
  const runs = segments.filter((s) => s.kind === 'run')
  const prefix = new Float64Array(runs.length + 1)
  for (let k = 0; k < runs.length; k++) prefix[k + 1] = prefix[k] + runs[k].end - runs[k].start
  const busyBefore = (t: number) => {
    let lo = 0
    let hi = runs.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (runs[mid].start < t) lo = mid + 1
      else hi = mid
    }
    return lo === 0 ? 0 : prefix[lo] - Math.max(0, runs[lo - 1].end - t)
  }
  // 有 wave 在等的周期：等待段按开始排好，重叠的合成一段 [from, to)，每段数一数 SIMD 在算的周期
  let cycles = 0
  let waiting = 0
  let hidden = 0
  let from = 0
  let to = 0
  for (const s of segments) {
    if (s.end > cycles) cycles = s.end
    if (s.kind !== 'memory' && s.kind !== 'sync') continue
    if (s.start > to) {
      waiting += to - from
      hidden += busyBefore(to) - busyBefore(from)
      from = s.start
      to = s.end
    } else if (s.end > to) {
      to = s.end
    }
  }
  waiting += to - from
  hidden += busyBefore(to) - busyBefore(from)
  const busy = prefix[runs.length]
  return { waves: resident, skipped, segments, cycles, busy, idle: cycles - busy, waiting, hidden, hiddenRatio: waiting === 0 ? 1 : hidden / waiting }
}

/** 二叉最小堆：less(a, b) 为真时 a 先出来。 */
class Heap<T> {
  private readonly items: T[] = []
  private readonly less: (a: T, b: T) => boolean

  constructor(less: (a: T, b: T) => boolean) {
    this.less = less
  }

  push(x: T) {
    const a = this.items
    let i = a.length
    a.push(x)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(a[i], a[p])) break
      const t = a[i]
      a[i] = a[p]
      a[p] = t
      i = p
    }
  }

  pop(): T | undefined {
    const a = this.items
    const top = a[0]
    const last = a.pop()
    if (a.length > 0 && last !== undefined) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        let m = i
        if (l < a.length && this.less(a[l], a[m])) m = l
        if (l + 1 < a.length && this.less(a[l + 1], a[m])) m = l + 1
        if (m === i) break
        const t = a[i]
        a[i] = a[m]
        a[m] = t
        i = m
      }
    }
    return top
  }
}

// ── 参数检查：这是调用方的错，不是读者代码的错，直接抛出 ──────────────────

function positive(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} 要是正整数，收到的是 ${String(value)}。`)
  return value
}

function nonNegative(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} 要是不小于 0 的整数，收到的是 ${String(value)}。`)
  return value
}

function between(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} 要是 ${min} 到 ${max} 之间的整数，收到的是 ${String(value)}。`)
  }
  return value
}
