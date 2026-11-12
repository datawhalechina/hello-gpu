/**
 * 2-5 一行 PyTorch 背后：trace 浏览器和三段探索里的数（纯函数，单测在 scripts/tests/forge-behind-pytorch.test.mjs）。
 *
 * 三段探索和实验室 Notebook「动手」的三段一一对应：一行启动了哪些 kernel、启动的开销、反复读写显存。
 * - trace 是 hello_gpu 的 hg.trace 存的 JSON（trace 格式 v1，docs/lab/schema.json 的 trace，类型在 labArchive.ts）。
 *   kernel 名字的缩写、「哪个算子启动的」、一行的汇总、「最耗时」和「占 GPU 时间」同 lab.py 的 _short_kernel、_top_op、
 *   _line_summary 和 _print_line，网页上的数和 Notebook 打印的对得上；时间线的配色按顶层算子分组，同 lab.py 的 _plot_trace。
 * - 浏览器读哪份 trace：读者导入的 → 实验档案馆里这一关最新的真实记录（traces.data.ts 构建时用 archiveTraceSet 挑好，
 *   示例条目不算）→ 示意数据。读者导入的文件先过 parseTraceJson：字段、类型和序号都对得上才收。
 * - 示意数据（sampleTraceSet）：GPU 上每个 kernel 的时长按本书那张卡的标称峰值算最快多久（2-4 的屋顶线），CPU 上的开销
 *   取几个示意值（SAMPLE_COST）。页面上标「示意」；R-02 往档案馆加了这一关的记录以后，浏览器自动换成那条记录。
 * - 探索三：GELU 的 tanh 近似照公式拆成 8 步（同 Notebook 的 gelu_steps），几步合进一个 kernel，按算法数读写显存的遍数：
 *   一步一个 kernel 时读 10 遍、写 8 遍（同 Notebook），合成一个时各 1 遍。
 */
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '../../course/hardware.ts'
import type { LabDevice } from '../../course/lab.ts'
import {
  compareEntries, isExampleId, linearTicks, summarize,
  type ArchiveEntry, type ArchiveTrace, type TraceGpu, type TraceLaunch, type TraceLine, type TraceOp,
} from '../../course/labArchive.ts'
import { SPEC_PEAK, balance, mmWork, type Peak } from '../roofline/roofline.ts'

export type { ArchiveTrace, TraceGpu, TraceLaunch, TraceLine, TraceOp }

export const STAGE_ID = 'forge-behind-pytorch'
/** 读者导入的 trace 存在本关草稿槽的这一格（挑战 id）：记录的 draft 是 { traces }。 */
export const TRACE_SLOT = 'trace'

// ── 写法（同 lab.py 打印的）──────────────────────────────────────────────────

/** 微秒数：不到 1 ms 写 µs（一位小数），否则写 ms（三位小数），同 lab.py 的 _span_text。 */
export function usText(us: number): string {
  return us < 1000 ? `${us.toFixed(1)} µs` : `${(us / 1000).toFixed(3)} ms`
}

/** GPU 忙的比例：取整的百分数，同 lab.py 打印的 {:.0%}。 */
export function busyText(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/** 占 GPU 时间：一位小数的百分数，同 lab.py 打印的 {:.1%}。 */
export function shareText(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

/**
 * kernel 名字去掉返回类型、模板参数、参数表和命名空间，太长的截断（同 lab.py 的 _short_kernel）：
 * void at::native::vectorized_elementwise_kernel<4, …>(int, …) → vectorized_elementwise_kernel。
 */
export function shortKernel(name: string, width = 40): string {
  let text = name.replaceAll('(anonymous namespace)', '').trim()
  if (text.startsWith('void ')) text = text.slice('void '.length).trim()
  let depth = 0
  let kept = ''
  for (const char of text) {
    if (char === '<') depth += 1
    else if (char === '>') depth = Math.max(depth - 1, 0)
    else if (depth === 0) {
      if (char === '(') break
      kept += char
    }
  }
  const short = (kept.trim().split('::').at(-1) ?? '').trim() || name.trim()
  const chars = [...short]
  return chars.length <= width ? short : `${chars.slice(0, width - 1).join('')}…`
}

// ── 一行 trace 的汇总（同 lab.py 的 _line_summary、_print_line）─────────────────

/** ops 里第 index 个算子往上找，找到这一行直接调用的那个（parent 是 null）；index 是 null 时也是 null。 */
export function topOp(line: TraceLine, index: number | null): number | null {
  let at = index
  while (at !== null && line.ops[at].parent !== null) at = line.ops[at].parent
  return at
}

export interface LineSummary {
  kernels: number
  /** GPU 上的拷贝、填充各几次（不算 kernel）。 */
  memcpy: number
  memset: number
  /** GPU 忙的时间、从开始到算完、CPU 交完这一行用的时间（微秒）。 */
  gpuUs: number
  spanUs: number
  cpuUs: number
  /** GPU 忙的比例：gpu_us ÷ span_us。 */
  busy: number
  /** GPU 空着的时间：span_us − gpu_us。 */
  idleUs: number
}

export function lineSummary(line: TraceLine): LineSummary {
  const count = (kind: TraceGpu['kind']) => line.gpu.filter((e) => e.kind === kind).length
  return {
    kernels: count('kernel'),
    memcpy: count('memcpy'),
    memset: count('memset'),
    gpuUs: line.gpu_us,
    spanUs: line.span_us,
    cpuUs: line.cpu_us,
    busy: line.span_us > 0 ? line.gpu_us / line.span_us : 0,
    idleUs: Math.max(0, line.span_us - line.gpu_us),
  }
}

/** kernel 表的一行（GPU 上的一个事件）。 */
export interface GpuRow {
  /** 在 gpu 里的序号；表里的 # 是它加 1。 */
  index: number
  /** 启动它的顶层算子（这一行直接调用的那个）的序号和名字；找不到时序号是 null、名字是 —。 */
  top: number | null
  op: string
  /** 缩写过的名字。 */
  kernel: string
  event: TraceGpu
  /** 占 GPU 时间：它的时长 ÷ 各个事件的时长之和（同 lab.py）。 */
  share: number
}

export function gpuRows(line: TraceLine): GpuRow[] {
  const total = line.gpu.reduce((sum, e) => sum + e.dur, 0) || 1
  return line.gpu.map((event, index) => {
    const top = topOp(line, event.op)
    return { index, top, op: top === null ? '—' : line.ops[top].name, kernel: shortKernel(event.name), event, share: event.dur / total }
  })
}

/** 最耗时的那个 GPU 事件的序号（一样长时取前面的，同 lab.py 的 max）；一个也没有时是 null。 */
export function slowestIndex(line: TraceLine): number | null {
  let best: number | null = null
  line.gpu.forEach((e, i) => {
    if (best === null || e.dur > line.gpu[best].dur) best = i
  })
  return best
}

/**
 * GPU 上第 index 个事件开始之前是怎么回事：
 * - freeAt：同一条队列上前面的事件都做完的时刻（这一行开始时 GPU 是空的，前面没有事件时是 0）；
 * - handedAt：CPU 把它交出去的时刻，就是启动它的运行时调用返回的时刻；找不到运行时调用时是 null；
 * - queued：交出去的时候 GPU 还在忙前面的活，它在队列里排着；waited：GPU 先空下来，等 CPU 把它交过来；
 * - idleUs：GPU 在它开始之前空了多久；queueUs：交出去以后过了多久才开始（找不到运行时调用时是 null）。
 */
export interface GpuWait {
  freeAt: number
  handedAt: number | null
  kind: 'queued' | 'waited' | 'unknown'
  idleUs: number
  queueUs: number | null
}

export function gpuWait(line: TraceLine, index: number): GpuWait {
  const event = line.gpu[index]
  let freeAt = 0
  for (const e of line.gpu.slice(0, index)) {
    if (e.stream === event.stream) freeAt = Math.max(freeAt, e.start + e.dur)
  }
  const launch = event.launch === null ? null : line.launches[event.launch]
  const handedAt = launch ? launch.start + launch.dur : null
  return {
    freeAt,
    handedAt,
    kind: handedAt === null ? 'unknown' : handedAt <= freeAt ? 'queued' : 'waited',
    idleUs: Math.max(0, event.start - freeAt),
    queueUs: handedAt === null ? null : Math.max(0, event.start - handedAt),
  }
}

// ── 时间线 ─────────────────────────────────────────────────────────────────

/** 三条道，从上到下：CPU 上的算子、CPU 上的启动（运行时调用）、GPU 上的事件（同 lab.py 的时间线）。 */
export type Lane = 'op' | 'launch' | 'gpu'
export const LANES: readonly Lane[] = ['op', 'launch', 'gpu']

/** 时间线上的一段。group 是顶层算子在这一行里的先后（同色）；找不到算子是 null（灰色）。 */
export interface LaneItem {
  lane: Lane
  /** 在 ops、launches 或 gpu 里的序号。 */
  index: number
  start: number
  dur: number
  group: number | null
}

/** 这一行直接调用的算子（顶层算子）在 ops 里的序号，按先后。 */
export function topOps(line: TraceLine): number[] {
  return line.ops.flatMap((op, i) => (op.parent === null ? [i] : []))
}

/** 时间线上的全部段：算子那条道只画顶层算子（同 lab.py），启动和 GPU 两条道画全部，各自跟着顶层算子分组。 */
export function laneItems(line: TraceLine): LaneItem[] {
  const tops = topOps(line)
  const groupOf = (opIndex: number | null) => {
    const top = topOp(line, opIndex)
    return top === null ? null : tops.indexOf(top)
  }
  return [
    ...tops.map((i, order) => ({ lane: 'op' as const, index: i, start: line.ops[i].start, dur: line.ops[i].dur, group: order })),
    ...line.launches.map((e, i) => ({ lane: 'launch' as const, index: i, start: e.start, dur: e.dur, group: groupOf(e.op) })),
    ...line.gpu.map((e, i) => ({ lane: 'gpu' as const, index: i, start: e.start, dur: e.dur, group: groupOf(e.op) })),
  ]
}

/** 时间轴看哪一段：all 是整行（从开始到算完）；cpu 是 CPU 交完这一行以前。 */
export type WindowMode = 'all' | 'cpu'

export interface TimeWindow {
  from: number
  to: number
}

/** 时间轴的两头（微秒）：从 0（GPU 上的时间偶尔会早一点点，同 lab.py 取更早的）到整行或 CPU 交完。 */
export function timeWindow(line: TraceLine, mode: WindowMode): TimeWindow {
  const from = Math.min(0, ...line.ops.map((e) => e.start), ...line.launches.map((e) => e.start), ...line.gpu.map((e) => e.start))
  const end = mode === 'cpu' ? line.cpu_us : line.span_us
  return { from, to: Math.max(end, from + 1) }
}

/** 时间轴上的刻度：大约 count 段的整刻度，只留两头之间的。 */
export function timeTicks(window: TimeWindow, count: number): number[] {
  const slack = (window.to - window.from) * 1e-9
  return linearTicks(window.from, window.to, count).filter((t) => t >= window.from - slack && t <= window.to + slack)
}

/** 在一条道上按时间点找段：落在某一段里就是它；不然找离得最近的，远过 tolerance（微秒）就不算。 */
export function nearestItem(items: readonly LaneItem[], lane: Lane, at: number, tolerance: number): LaneItem | null {
  let best: LaneItem | null = null
  let bestDistance = Infinity
  for (const item of items) {
    if (item.lane !== lane) continue
    const distance = at < item.start ? item.start - at : at > item.start + item.dur ? at - item.start - item.dur : 0
    if (distance < bestDistance || (distance === 0 && bestDistance === 0 && item.dur < (best?.dur ?? Infinity))) {
      best = item
      bestDistance = distance
    }
  }
  return best && bestDistance <= tolerance ? best : null
}

/** 键盘在时间线上怎么走：prev / next 同一条道上的前后一段，up / down 换到上下一条道（有段的那条），first / last 到这条道的两头。 */
export type StepMove = 'prev' | 'next' | 'up' | 'down' | 'first' | 'last'

/**
 * 从选中的那一段按 move 走一步，返回要选的段；走到头就停在原地。还没选时先选 GPU 那条道上的第一段（last、prev 是最后一段），
 * 这条道上没有段时从上往下找第一条有段的道；一段也没有是 null。换道时先在同一组（同一个顶层算子）里找，没有再看整条道，
 * 挑开始时间离当前那段最近的；同一条道上按开始时间排。
 */
export function stepItem(items: readonly LaneItem[], from: { lane: Lane; index: number } | null, move: StepMove): LaneItem | null {
  const laneOf = (lane: Lane) => items.filter((item) => item.lane === lane).sort((a, b) => a.start - b.start)
  const current = from ? (items.find((item) => item.lane === from.lane && item.index === from.index) ?? null) : null
  if (!current) {
    const list = [laneOf('gpu'), ...LANES.map(laneOf)].find((l) => l.length) ?? []
    return (move === 'last' || move === 'prev' ? list.at(-1) : list[0]) ?? null
  }
  if (move === 'up' || move === 'down') {
    const step = move === 'down' ? 1 : -1
    for (let k = LANES.indexOf(current.lane) + step; k >= 0 && k < LANES.length; k += step) {
      const target = laneOf(LANES[k])
      const same = target.filter((item) => current.group !== null && item.group === current.group)
      const nearest = (same.length ? same : target).reduce<LaneItem | null>(
        (best, item) => (!best || Math.abs(item.start - current.start) < Math.abs(best.start - current.start) ? item : best),
        null,
      )
      if (nearest) return nearest
    }
    return current
  }
  const list = laneOf(current.lane)
  if (move === 'first') return list[0]
  if (move === 'last') return list[list.length - 1]
  const position = list.indexOf(current)
  return list[Math.min(Math.max(position + (move === 'next' ? 1 : -1), 0), list.length - 1)]
}

// ── 浏览器里的一组 trace ───────────────────────────────────────────────────

/** mine：读者导入的；archive：实验档案馆里这一关的真实记录；sample：示意数据。 */
export type TraceSource = 'mine' | 'archive' | 'sample'

/** 浏览器里的一行：trace 里的一行，加上它是哪张卡、什么时候记的（示意数据没有时间）。 */
export interface SetLine {
  line: TraceLine
  device: LabDevice
  at: string | null
}

export interface TraceSet {
  source: TraceSource
  /** 档案条目 id（source 是 archive 时），链接到 /lab/#<id>。 */
  entry: string | null
  lines: SetLine[]
}

/** 几份 trace 合成一组行：按记录时间排（时间一样的按给的顺序），同名的行留后记的那一次，位置按第一次出现。 */
export function mergeTraces(traces: readonly ArchiveTrace[]): SetLine[] {
  const ordered = traces.map((trace, i) => ({ trace, i })).sort((a, b) => (a.trace.at < b.trace.at ? -1 : a.trace.at > b.trace.at ? 1 : a.i - b.i))
  const lines: SetLine[] = []
  for (const { trace } of ordered) {
    for (const line of trace.lines) {
      const item = { line, device: trace.device, at: trace.at }
      const same = lines.findIndex((l) => l.line.name === line.name)
      if (same >= 0) lines[same] = item
      else lines.push(item)
    }
  }
  return lines
}

/** 档案馆里这一关的参考 trace：真实记录（示例条目不算）里带 trace 的、排在最前的那条（同 LabCard 的顺序：新的在前）。 */
export function archiveTraceSet(entries: readonly { id: string; entry: ArchiveEntry }[]): TraceSet | null {
  const usable = entries
    .filter(({ id, entry }) => entry.credential.stage === STAGE_ID && !isExampleId(id) && entry.example !== true && (entry.traces?.length ?? 0) > 0)
    .map(({ id, entry }) => ({ id, entry, summary: summarize(id, entry) }))
    .sort((a, b) => compareEntries(a.summary, b.summary))
  const latest = usable[0]
  return latest ? { source: 'archive', entry: latest.id, lines: mergeTraces(latest.entry.traces ?? []) } : null
}

/** 一个浏览器先看哪一行：prefer 里第一个有的；都没有就是第一行；一行也没有是 null。 */
export function pickLine(set: TraceSet, prefer: readonly string[]): SetLine | null {
  for (const name of prefer) {
    const found = set.lines.find((l) => l.line.name === name)
    if (found) return found
  }
  return set.lines[0] ?? null
}

// ── 示意数据 ────────────────────────────────────────────────────────────────

/**
 * 示意数据里 CPU 和 GPU 上的开销（微秒），不是实测：一个算子在 CPU 上走 8 µs（Python、PyTorch 的算子分派、启动 kernel），
 * 两个算子之间隔 3 µs；算子开始 4 µs 后调用 hipLaunchKernel，这次调用 2.5 µs；GPU 空着时，调用开始 5 µs 后 kernel 才开始算；
 * GPU 上一个 kernel 最短 2 µs。进入这一行 2 µs 后开始第一个算子，最后一个算子结束 1 µs 后返回。
 */
export const SAMPLE_COST = { op: 8, gap: 3, launchAt: 4, launch: 2.5, gpuDelay: 5, kernelMin: 2, enter: 2, exit: 1 } as const

/** 示意数据里矩阵乘 kernel 的名字（真卡上来自 ROCm 的矩阵乘库，名字以实测为准）。 */
const SAMPLE_GEMM = 'Cijk_Alik_Bljk_SB_MT128x128x16（示意名）'

/** 示意数据里逐元素运算 kernel 的名字：PyTorch 的 vectorized_elementwise_kernel，模板参数写成运算名。 */
function sampleElementwise(fn: string): string {
  return `void at::native::vectorized_elementwise_kernel<4, ${fn}>(int, …)`
}

/** Notebook 动手第一段的那一层（4096×4096）、第二段的小数据（8×256 乘 256×256），和第三段、挑战的两个长度。 */
export const MLP_SHAPE = { m: 4096, k: 4096, n: 4096 } as const
export const MLP_SMALL_SHAPE = { m: 8, k: 256, n: 256 } as const
export const STEPS_N = 2 ** 26
export const STEPS_SMALL_N = 2 ** 10

/** 按峰值带宽搬 bytes 字节最快多久（微秒）。 */
export function moveUs(bytes: number, peak: Peak): number {
  return bytes / peak.gbps / 1e3
}

/** 示意数据的一步：一个顶层算子（inner 是它里面真正启动 kernel 的那个），启动一个 kernel，kernel 在 GPU 上最快 us 微秒。 */
interface SampleStep {
  op: string
  inner?: string
  kernel: string
  us: number
}

/** hg.trace 写的时间精确到 0.001 µs。 */
const round3 = (value: number) => Math.round(value * 1000) / 1000

/** 按 SAMPLE_COST 排出一行：CPU 一个接一个地交算子，GPU 按顺序算，前一个没算完的话后一个排队。 */
function sampleLine(name: string, steps: readonly SampleStep[]): TraceLine {
  const c = SAMPLE_COST
  const ops: TraceOp[] = []
  const launches: TraceLaunch[] = []
  const gpu: TraceGpu[] = []
  let t: number = c.enter
  let free = 0
  for (const step of steps) {
    const top = ops.length
    ops.push({ name: step.op, start: t, dur: c.op, parent: null })
    let inner = top
    if (step.inner) {
      inner = ops.length
      ops.push({ name: step.inner, start: t + 0.5, dur: c.op - 1, parent: top })
    }
    const launch = launches.length
    launches.push({ name: 'hipLaunchKernel', start: t + c.launchAt, dur: c.launch, op: inner })
    const start = round3(Math.max(t + c.launchAt + c.gpuDelay, free))
    const dur = round3(Math.max(step.us, c.kernelMin))
    gpu.push({ name: step.kernel, kind: 'kernel', start, dur, stream: 0, op: inner, launch })
    free = round3(start + dur)
    t += c.op + c.gap
  }
  const cpu = t - c.gap + c.exit
  return {
    name,
    runs: 5,
    span_us: round3(Math.max(cpu, free)),
    cpu_us: round3(cpu),
    gpu_us: round3(gpu.reduce((sum, e) => sum + e.dur, 0)),
    ops,
    launches,
    gpu,
  }
}

export interface MlpShape {
  m: number
  k: number
  n: number
}

/**
 * F.gelu(x @ w + b) 三步要搬的字节和在 GPU 上最快多久（微秒，2-4 的屋顶线：慢的那件说了算）：
 * 矩阵乘 (m×k) 乘 (k×n)；加偏置读 x @ w 的结果和 b、写结果；GELU 读一遍、写一遍。热身和示意数据共用。
 */
export function mlpFloor({ m, k, n }: MlpShape, peak: Peak) {
  const mm = balance(peak, mmWork(m, k, n))
  const addBytes = 4 * (2 * m * n + n)
  const geluBytes = 4 * 2 * m * n
  return {
    mm: { flops: mm.work.flops, bytes: mm.work.bytes, us: mm.ms * 1000 },
    add: { bytes: addBytes, us: moveUs(addBytes, peak) },
    gelu: { bytes: geluBytes, us: moveUs(geluBytes, peak) },
  }
}

function mlpSteps(shape: MlpShape, peak: Peak): SampleStep[] {
  const floor = mlpFloor(shape, peak)
  return [
    { op: 'aten::matmul', inner: 'aten::mm', kernel: SAMPLE_GEMM, us: floor.mm.us },
    { op: 'aten::add', kernel: sampleElementwise('add'), us: floor.add.us },
    { op: 'aten::gelu', kernel: sampleElementwise('gelu'), us: floor.gelu.us },
  ]
}

/** gelu_steps(x)：8 步，每步读它用到的数组、写一个结果，都和 x 一样大。 */
function geluStepSamples(n: number, peak: Peak): SampleStep[] {
  return GELU_STEPS.map((s) => ({ op: s.op, kernel: sampleElementwise(s.op.replace('aten::', '')), us: moveUs(4 * n * (s.reads.length + 1), peak) }))
}

/** 本书那张卡（hardware.json）：示意数据按它的标称峰值算。 */
const BOOK = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
export const SAMPLE_DEVICE: LabDevice = { name: BOOK.name, gfx: String(BOOK.params.gfx.value), cus: Number(BOOK.params.cuCount.value) }

/** 示意数据：Notebook 动手三段和挑战里分步写法的四行（mlp、mlp_small、steps、steps_small）。 */
export function sampleTraceSet(peak: Peak = SPEC_PEAK): TraceSet {
  const lines = [
    sampleLine('mlp', mlpSteps(MLP_SHAPE, peak)),
    sampleLine('mlp_small', mlpSteps(MLP_SMALL_SHAPE, peak)),
    sampleLine('steps', geluStepSamples(STEPS_N, peak)),
    sampleLine('steps_small', geluStepSamples(STEPS_SMALL_N, peak)),
  ]
  return { source: 'sample', entry: null, lines: lines.map((line) => ({ line, device: SAMPLE_DEVICE, at: null })) }
}

// ── 导入读者的 trace ───────────────────────────────────────────────────────

/** 一次最多导入多少个字符：再大的 trace 存不进浏览器（localStorage 一般只有几 MB）。 */
export const MAX_IMPORT_CHARS = 4_000_000

/** json：不是 JSON；shape：不是 trace；version：格式版本不认识；field：字段不对；empty：一行也没有；size：太大。 */
export type TraceImportKind = 'json' | 'shape' | 'version' | 'field' | 'empty' | 'size'

export interface TraceImportError {
  kind: TraceImportKind
  message: string
  /** 解析器的原文（读 JSON 出错时），页面放进折叠块。 */
  raw?: string
}

export type TraceImport = { ok: true; traces: ArchiveTrace[] } | { ok: false; error: TraceImportError }

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** 报错里怎么写一个值：JSON 的写法，太长的截断（同 lab-data-check.mjs）。 */
function show(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 48 ? `${text.slice(0, 45)}…` : text
}

/** 出错的位置：lines[0].gpu[2].dur；最外层的字段只写字段名。 */
const path = (at: string, key: string) => (at ? `${at}.${key}` : key)

class Problem extends Error {
  kind: TraceImportKind
  raw?: string
  constructor(kind: TraceImportKind, message: string, raw?: string) {
    super(message)
    this.kind = kind
    this.raw = raw
  }
}

const field = (message: string) => new Problem('field', message)

function text(obj: Json, key: string, at: string): string {
  if (!isText(obj[key])) throw field(`${path(at, key)} 要是一段文字，现在是 ${show(obj[key])}`)
  return obj[key]
}

function number(obj: Json, key: string, at: string, { min }: { min?: number } = {}): number {
  const value = obj[key]
  if (!isNumber(value) || (min !== undefined && value < min)) {
    throw field(`${path(at, key)} 要是${min === undefined ? '' : `不小于 ${min} 的`}数，现在是 ${show(value)}`)
  }
  return value
}

function integer(obj: Json, key: string, at: string, min: number): number {
  const value = obj[key]
  if (!Number.isInteger(value) || (value as number) < min) throw field(`${path(at, key)} 要是不小于 ${min} 的整数，现在是 ${show(value)}`)
  return value as number
}

/** 序号：null，或者 0 到 below − 1 的整数。 */
function index(obj: Json, key: string, at: string, below: number, what: string): number | null {
  const value = obj[key]
  if (value === null) return null
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= below) {
    throw field(`${path(at, key)} 是 ${show(value)}，${what}`)
  }
  return value as number
}

function list(obj: Json, key: string, at: string): unknown[] {
  if (!Array.isArray(obj[key])) throw field(`${path(at, key)} 要是一个数组，现在是 ${show(obj[key])}`)
  return obj[key] as unknown[]
}

function entry(value: unknown, at: string): Json {
  if (!isObject(value)) throw field(`${at || '最外层'} 要是一个对象，现在是 ${show(value)}`)
  return value
}

const GPU_KINDS: readonly TraceGpu['kind'][] = ['kernel', 'memcpy', 'memset']

function readLine(value: unknown, at: string): TraceLine {
  const raw = entry(value, at)
  const ops = list(raw, 'ops', at).map((item, i): TraceOp => {
    const where = `${at}.ops[${i}]`
    const op = entry(item, where)
    return {
      name: text(op, 'name', where),
      start: number(op, 'start', where),
      dur: number(op, 'dur', where, { min: 0 }),
      parent: index(op, 'parent', where, i, '上层算子要排在它前面（序号比它小）'),
    }
  })
  const launches = list(raw, 'launches', at).map((item, i): TraceLaunch => {
    const where = `${at}.launches[${i}]`
    const launch = entry(item, where)
    return {
      name: text(launch, 'name', where),
      start: number(launch, 'start', where),
      dur: number(launch, 'dur', where, { min: 0 }),
      op: index(launch, 'op', where, ops.length, `ops 只有 ${ops.length} 个`),
    }
  })
  const gpu = list(raw, 'gpu', at).map((item, i): TraceGpu => {
    const where = `${at}.gpu[${i}]`
    const e = entry(item, where)
    const kind = e.kind as TraceGpu['kind']
    if (!GPU_KINDS.includes(kind)) throw field(`${where}.kind 要是 kernel、memcpy 或 memset，现在是 ${show(e.kind)}`)
    return {
      name: text(e, 'name', where),
      kind,
      start: number(e, 'start', where),
      dur: number(e, 'dur', where, { min: 0 }),
      stream: integer(e, 'stream', where, 0),
      op: index(e, 'op', where, ops.length, `ops 只有 ${ops.length} 个`),
      launch: index(e, 'launch', where, launches.length, `launches 只有 ${launches.length} 个`),
    }
  })
  return {
    name: text(raw, 'name', at),
    runs: integer(raw, 'runs', at, 1),
    span_us: number(raw, 'span_us', at, { min: 0 }),
    cpu_us: number(raw, 'cpu_us', at, { min: 0 }),
    gpu_us: number(raw, 'gpu_us', at, { min: 0 }),
    ops,
    launches,
    gpu,
  }
}

function version(obj: Json, key: string, at: string): string | null {
  const value = obj[key]
  if (value !== null && !isText(value)) throw field(`${path(at, key)} 要是版本号或 null，现在是 ${show(value)}`)
  return value
}

/** 一份 trace（hg.trace 存的 JSON）：只留格式里的字段，别的不收。at 是它在文件里的位置，最外层是空串。 */
function readTrace(value: unknown, at: string): ArchiveTrace {
  const raw = entry(value, at)
  if (raw.v !== 1) throw new Problem('version', `${path(at, 'v')} 是 ${show(raw.v)}，这一页只认 trace 格式 v1`)
  const deviceAt = path(at, 'device')
  const envAt = path(at, 'env')
  const device = entry(raw.device, deviceAt)
  const env = entry(raw.env, envAt)
  const lines = list(raw, 'lines', at).map((line, i) => readLine(line, path(at, `lines[${i}]`)))
  if (!lines.length) throw new Problem('empty', `${path(at, 'lines')} 是空的：这次 hg.trace 一行也没有记下来`)
  const names = new Set<string>()
  for (const line of lines) {
    if (names.has(line.name)) throw field(`${at || '这份 trace'} 里有两行都叫 ${show(line.name)}：同一份 trace 里每一行的名字都不一样`)
    names.add(line.name)
  }
  return {
    v: 1,
    at: text(raw, 'at', at),
    device: { name: text(device, 'name', deviceAt), gfx: text(device, 'gfx', deviceAt), cus: integer(device, 'cus', deviceAt, 1) },
    env: { rocm: version(env, 'rocm', envAt), torch: version(env, 'torch', envAt), triton: version(env, 'triton', envAt) },
    lines,
  }
}

/**
 * 读者导入的一段 JSON：hg.trace 存的一份 trace，或者实验档案馆的一条记录（取它的 traces）。
 * 字段、类型和序号都对得上才收；不对时说清是哪一项。
 */
export function parseTraceJson(source: string): TraceImport {
  try {
    if (source.length > MAX_IMPORT_CHARS) {
      throw new Problem('size', `有 ${(source.length / 1e6).toFixed(1)} 百万个字符，这一页一次最多收 ${MAX_IMPORT_CHARS / 1e6} 百万个`)
    }
    let data: unknown
    try {
      data = JSON.parse(source)
    } catch (error) {
      throw new Problem('json', '读不出 JSON：文件不完整，或者根本不是 JSON', error instanceof Error ? error.message : String(error))
    }
    if (!isObject(data)) throw new Problem('shape', `最外层要是一个对象，现在是 ${show(data)}`)
    if ('traces' in data || ('credential' in data && 'cells' in data)) {
      const traces = Array.isArray(data.traces) ? data.traces : []
      if (!traces.length) throw new Problem('empty', '这是实验档案馆的一条记录，但里面没有 trace')
      return { ok: true, traces: traces.map((t, i) => readTrace(t, `traces[${i}]`)) }
    }
    if ('lines' in data || ('v' in data && !('stage' in data))) return { ok: true, traces: [readTrace(data, '')] }
    if ('stage' in data && 'checks' in data) throw new Problem('shape', '这是通关凭证（hg.submit 存的 JSON），不是 trace')
    throw new Problem('shape', '里面没有 lines：不是 hg.trace 存的 trace')
  } catch (error) {
    if (error instanceof Problem) return { ok: false, error: { kind: error.kind, message: error.message, ...(error.raw ? { raw: error.raw } : {}) } }
    throw error
  }
}

/** 草稿槽里存的读者 trace（{ traces }），再检查一遍；没有或者坏了是 null。 */
export function storedTraces(draft: unknown): ArchiveTrace[] | null {
  if (!isObject(draft) || !Array.isArray(draft.traces) || !draft.traces.length) return null
  try {
    return draft.traces.map((t, i) => readTrace(t, `traces[${i}]`))
  } catch (error) {
    if (error instanceof Problem) return null
    throw error
  }
}

/** 新导入的接在已有的后面；同一份 trace（记录时间和行名都一样）导入两次只留一份。 */
export function appendTraces(have: readonly ArchiveTrace[], added: readonly ArchiveTrace[]): ArchiveTrace[] {
  const key = (t: ArchiveTrace) => `${t.at}|${t.device.name}|${t.lines.map((l) => l.name).join(',')}`
  const out = [...have]
  for (const trace of added) {
    const same = out.findIndex((t) => key(t) === key(trace))
    if (same >= 0) out[same] = trace
    else out.push(trace)
  }
  return out
}

/** 导入失败时给读者看的话：现象、原因、怎么改（03 第 4 节）。 */
export interface ImportErrorText {
  symptom: string
  cause: string
  fix: string
}

export function explainImportError(error: TraceImportError): ImportErrorText {
  const cause = `${error.message}。`
  switch (error.kind) {
    case 'json':
      return { symptom: '这不是一份完整的 JSON。', cause, fix: '选 hg.trace 存下的 .json 文件；粘贴的话，要从第一个 { 到最后一个 } 整份复制。' }
    case 'version':
      return { symptom: 'trace 的格式版本不对，这一页认不出来。', cause, fix: '网页和 hello_gpu 要是同一版：先刷新这一页；还不行就在仓库目录里运行 git pull，再重新运行 hg.trace。' }
    case 'field':
      return { symptom: '读得出 JSON，但里面的 trace 数据不对。', cause, fix: '重新运行 Notebook 里那个 hg.trace 单元，导入新存的文件；trace 文件不要手改。' }
    case 'empty':
      return { symptom: '这份 JSON 里一行 trace 也没有。', cause, fix: '导入 hg.trace 打印的「trace 已保存」那个文件；那一次每一行都运行出错的话，先看 Notebook 里的报错。' }
    case 'size':
      return { symptom: '文件太大，这一页不收。', cause, fix: '一次少记几行：hg.trace({...}) 里只放要看的那一两行。' }
    default:
      return { symptom: '这份 JSON 不是 trace。', cause, fix: 'trace 存在 notebooks/.artifacts/traces/ 下，文件名是记录的时间；hg.trace 输出的最后一行写着这一次存在哪。' }
  }
}

// ── 探索三：反复读写显存 ────────────────────────────────────────────────────

/** GELU 的 tanh 近似照公式拆成的一步：一个 PyTorch 算子，读 reads 里的数组，写出 out（都和 x 一样大）。 */
export interface GeluStep {
  out: string
  code: string
  op: string
  reads: readonly string[]
}

/**
 * Notebook 的 gelu_steps：0.5 * x * (1 + torch.tanh(0.7978845608 * (x + 0.044715 * x**3)))，按 Python 求值的先后拆成 8 步，
 * 每步是一个算子、启动一个 kernel（同示意数据和 trace 里 steps 那一行的 8 个算子）。
 */
export const GELU_STEPS: readonly GeluStep[] = [
  { out: 'a', code: 'a = 0.5 * x', op: 'aten::mul', reads: ['x'] },
  { out: 'b', code: 'b = x ** 3', op: 'aten::pow', reads: ['x'] },
  { out: 'c', code: 'c = 0.044715 * b', op: 'aten::mul', reads: ['b'] },
  { out: 'd', code: 'd = x + c', op: 'aten::add', reads: ['x', 'c'] },
  { out: 'e', code: 'e = 0.7978845608 * d', op: 'aten::mul', reads: ['d'] },
  { out: 'f', code: 'f = tanh(e)', op: 'aten::tanh', reads: ['e'] },
  { out: 'g', code: 'g = 1 + f', op: 'aten::add', reads: ['f'] },
  { out: 'y', code: 'y = a * g', op: 'aten::mul', reads: ['a', 'g'] },
]
/** 结果：最后要写回显存的那个数组。 */
export const GELU_OUTPUT = 'y'

/** 旋钮：8 步合成几个 kernel（每个做连着的、一样多的几步）。8 是分步写法（能跑但不好），1 是一个 kernel 算完。 */
export const KERNEL_COUNTS = [8, 4, 2, 1] as const
export const KERNEL_COUNT_DEFAULT = 8

export interface FusedKernel {
  /** 做 GELU_STEPS 里的哪几步（序号）。 */
  steps: number[]
  /** 从显存读进来的数组：外面来的，每个只读一遍。 */
  reads: string[]
  /** 写回显存的数组：后面的 kernel 要用的，和最后的结果。 */
  writes: string[]
}

/** 8 步合成 kernels 个 kernel 时，每个 kernel 读写哪些数组（按算法数：每个要用的数组读一遍，后面要用的结果写一遍）。 */
export function fusePlan(kernels: number): FusedKernel[] {
  const size = GELU_STEPS.length / kernels
  if (!Number.isInteger(size) || size < 1) throw new Error(`8 步分不成 ${kernels} 个一样大的 kernel`)
  const groups = Array.from({ length: kernels }, (_, k) => Array.from({ length: size }, (_, j) => k * size + j))
  return groups.map((steps, k) => {
    const made = new Set<string>()
    const reads: string[] = []
    for (const i of steps) {
      for (const name of GELU_STEPS[i].reads) {
        if (!made.has(name) && !reads.includes(name)) reads.push(name)
      }
      made.add(GELU_STEPS[i].out)
    }
    const later = groups.slice(k + 1).flat().flatMap((i) => GELU_STEPS[i].reads)
    const writes = steps.map((i) => GELU_STEPS[i].out).filter((name) => name === GELU_OUTPUT || later.includes(name))
    return { steps, reads, writes }
  })
}

export interface PassTotals {
  reads: number
  writes: number
  /** 读写一共几遍（每遍搬一个和 x 一样大的数组）。 */
  passes: number
}

export function passTotals(plan: readonly FusedKernel[]): PassTotals {
  const reads = plan.reduce((sum, k) => sum + k.reads.length, 0)
  const writes = plan.reduce((sum, k) => sum + k.writes.length, 0)
  return { reads, writes, passes: reads + writes }
}
