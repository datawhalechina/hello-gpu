/**
 * 实验档案馆（L-04；07 第 8 节、09 第 4 节）：docs/lab/data/<关卡 id>/<路线>-<设备>-<日期>.json 的类型，
 * 条目 id 和地址，浏览页的摘要、筛选和排序，原始样本的统计，图表的坐标。
 *
 * 纯 TS，不碰 Vue、页面和文件：浏览页（theme/v2/LabArchive.vue）、档案输出组件（kit/lab/）、构建时的数据加载器
 * （labArchive.data.ts）、检查脚本（scripts/course/lab-data-check.mjs）和单测共用。
 * 字段的形状写在 docs/lab/schema.json；字段之间要对得上的规则在检查脚本里。
 *
 * 条目 id 是「<目录>/<文件名去掉 .json>」：目录是关卡 id（真卡副本是副本 id），示例放在 _example/。
 * 浏览页上的地址是 /lab/#<条目 id>（EvidenceCard、LabCard 的「档案条目」链接），条目原文在 /lab/data/<条目 id>.json。
 */
import type { LabCredential, LabDevice, LabEnv, LabReference, LabRoute } from './lab.ts'

// ── 位置和名字 ────────────────────────────────────────────────────────────

/** 档案目录（相对仓库根目录）；站点上是 /lab/data/。 */
export const ARCHIVE_DIR = 'docs/lab/data'
/** 格式说明：JSON Schema（相对仓库根目录）；站点上是 /lab/schema.json。 */
export const SCHEMA_FILE = 'docs/lab/schema.json'
/** 示例条目的目录：示例，不是实测（条目里写 example: true），正文不能引用。 */
export const EXAMPLE_DIR = '_example'
/** Notebook 的小节，按 Notebook 里的顺序（07 第 5 节；「练习」不计星，可以没有）。 */
export const SECTIONS = ['准备', '动手', '挑战', '交成绩', '练习'] as const
export type Section = (typeof SECTIONS)[number]

/** 文件名（去掉 .json）：<路线>-<设备>-<日期>，例如 hip-rx-9070-xt-2026-11-08。设备是小写字母、数字和连字符。 */
const ENTRY_NAME = /^(hip|triton|shared)-([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{4}-\d{2}-\d{2})$/

export interface EntryName {
  /** 关卡 id（真卡副本是副本 id），示例是 _example。 */
  dir: string
  route: LabRoute
  /** 设备的写法：hardware.json 登记过的卡用它的 id（rx-9070-xt），筛选按它分。 */
  device: string
  /** 测量日期（UTC）。 */
  date: string
}

/** 条目 id 拆成目录、路线、设备和日期；写法不对返回 null。 */
export function parseEntryId(id: string): EntryName | null {
  const slash = id.indexOf('/')
  if (slash <= 0 || id.includes('/', slash + 1)) return null
  const m = ENTRY_NAME.exec(id.slice(slash + 1))
  return m ? { dir: id.slice(0, slash), route: m[1] as LabRoute, device: m[2], date: m[3] } : null
}

export function isExampleId(id: string): boolean {
  return id.startsWith(`${EXAMPLE_DIR}/`)
}

/** 浏览页上的这一条（不带站点 base）。 */
export function archiveHref(id: string): string {
  return `/lab/#${encodeURI(id)}`
}

/** 条目原文在站点上的地址（不带站点 base）：浏览页展开详情时读它，「下载 JSON」也链到它。 */
export function archiveDataPath(id: string): string {
  return `/lab/data/${encodeURI(id)}.json`
}

/** 条目原文在仓库里的路径。 */
export function archiveFile(id: string): string {
  return `${ARCHIVE_DIR}/${id}.json`
}

// ── 格式（docs/lab/schema.json）────────────────────────────────────────────

export interface ArchiveEnvironment {
  /** docs/course/lab-platforms.json 里的平台 id；自己的机器是 local。 */
  platform: string
  /** hg.device_card() 的设备信息。 */
  device: LabDevice & { wave: number | null; memory_bytes: number }
  /** hg.peak() 测出的峰值；没测过是 null。 */
  peak: { gbps: number; tflops: number } | null
  software: { rocm: string | null; hip: string | null; torch: string | null; triton: string | null; python: string }
  system: { os: string; kernel: string; cpu: string }
  /** 会影响结果的环境变量。 */
  variables?: Record<string, string>
  /** Notebook 所在的仓库提交。 */
  commit: string
}

/** 一组原始计时样本（hg.bench() / hg.compare() 里一个实现的 samples_ms）。 */
export interface ArchiveSeries {
  label: string
  note?: string
  method: string
  warmup: number
  repeat: number
  ms: number[]
}

export interface TextOutput {
  kind: 'text'
  text: string
}

export interface TableOutput {
  kind: 'table'
  caption?: string
  columns: string[]
  rows: (string | number | null)[][]
}

export interface ChartAxis {
  label: string
  unit?: string
  scale?: 'linear' | 'log'
}

export interface ChartOutput {
  kind: 'chart'
  caption?: string
  /** line：折线，横轴是数；bar：柱状，横轴是类别。 */
  chart: 'line' | 'bar'
  x: ChartAxis & { values: (number | string)[] }
  y: ChartAxis
  series: { name: string; values: (number | null)[] }[]
}

export type ArchiveOutput = TextOutput | TableOutput | ChartOutput

/** Notebook 的一个单元：代码和关键输出（观摩模式按条目里的顺序回放）。 */
export interface ArchiveCell {
  section: Section
  title?: string
  /** 不写是 python；hip 是 %%hip 单元。 */
  lang?: 'python' | 'hip'
  code?: string
  outputs: ArchiveOutput[]
}

// ── trace（hg.trace() 存的 JSON，schema 的 $defs/trace）─────────────────────
// 时间单位都是微秒，从这一行开始（CPU 进入这一行）算起；序号都从 0 数。

/** CPU 上的一个 PyTorch 算子。 */
export interface TraceOp {
  name: string
  start: number
  dur: number
  /** 上一层算子在 ops 里的序号（排在它前面）；这一行直接调用的算子是 null。 */
  parent: number | null
}

/** CPU 上的一次运行时调用：启动 kernel（hipLaunchKernel……）、拷贝、填充。 */
export interface TraceLaunch {
  name: string
  start: number
  dur: number
  /** 在哪个算子里调用的：ops 里最里层那个的序号；不在算子里是 null。 */
  op: number | null
}

/** GPU 上的一个事件。 */
export interface TraceGpu {
  /** kernel 的完整名字（C++ 名字已还原），或者拷贝、填充的名字。 */
  name: string
  kind: 'kernel' | 'memcpy' | 'memset'
  start: number
  dur: number
  /** 第几条队列（stream）：按在这一行里第一次出现的先后编号。 */
  stream: number
  /** 启动它的算子（ops 里最里层那个的序号）；找不到是 null。 */
  op: number | null
  /** 启动它的运行时调用在 launches 里的序号；找不到是 null。 */
  launch: number | null
}

/** 记下的一行：记了 runs 遍，留下「从开始到算完」排在中间的那一遍。 */
export interface TraceLine {
  name: string
  runs: number
  /** 从开始到算完：CPU 交完这一行、GPU 上最后一个事件结束，取晚的那个。 */
  span_us: number
  /** CPU 交完这一行用的时间。 */
  cpu_us: number
  /** GPU 忙的时间：gpu 各段合在一起的长度。 */
  gpu_us: number
  ops: TraceOp[]
  launches: TraceLaunch[]
  gpu: TraceGpu[]
}

/** 一次 hg.trace() 的结果（trace 格式 v1）。 */
export interface ArchiveTrace {
  v: 1
  at: string
  device: LabDevice
  env: LabEnv
  lines: TraceLine[]
}

export interface ArchiveEntry {
  $schema?: string
  version: 1
  /** 示例，不是实测：只在 _example/ 里写。 */
  example?: true
  collector: string
  date: string
  note?: string
  credential: LabCredential
  environment: ArchiveEnvironment
  samples: ArchiveSeries[]
  cells: ArchiveCell[]
  /** hg.trace() 记下的 trace，按 Notebook 里的顺序；没有 trace 的条目没有这一项。 */
  traces?: ArchiveTrace[]
}

// ── 摘要：浏览页列表里的一行（数据加载器在构建时算好）──────────────────────

export interface ArchiveSummary {
  id: string
  stage: string
  route: LabRoute
  /** 文件名里的设备写法。 */
  device: string
  deviceInfo: LabDevice
  date: string
  at: string
  collector: string
  example: boolean
  platform: string
  checks: { passed: number; total: number }
  metrics: Record<string, number>
  env: LabEnv
  /** 有几组原始样本、几个 Notebook 单元。 */
  samples: number
  cells: number
}

export function summarize(id: string, entry: ArchiveEntry): ArchiveSummary {
  const name = parseEntryId(id)
  if (!name) throw new Error(`档案条目 id 的写法不对：${id}`)
  const c = entry.credential
  return {
    id,
    stage: c.stage,
    route: c.route,
    device: name.device,
    deviceInfo: { name: c.device.name, gfx: c.device.gfx, cus: c.device.cus },
    date: entry.date,
    at: c.at,
    collector: entry.collector,
    example: entry.example === true,
    platform: entry.environment.platform,
    checks: { passed: c.checks.passed, total: c.checks.total },
    metrics: { ...c.metrics },
    env: { rocm: c.env.rocm ?? null, torch: c.env.torch ?? null, triton: c.env.triton ?? null },
    samples: entry.samples.length,
    cells: entry.cells.length,
  }
}

/** LabCard 的参考记录（lab.ts 的 LabReference）：读者的数字旁边列出的档案数字。 */
export function archiveReference(summary: Pick<ArchiveSummary, 'id' | 'route' | 'at' | 'deviceInfo' | 'metrics'>): LabReference {
  return { entry: summary.id, route: summary.route, at: summary.at, device: { ...summary.deviceInfo }, metrics: { ...summary.metrics } }
}

/** 列表里每条先显示的测量项：耗时、带宽、算力在前；分位数和峰值放进详情。 */
const HEADLINE_FIRST = ['median_ms', 'gbps', 'tflops']
const DETAIL_ONLY = /^(?:p\d+_ms|peak_)/

export function headlineMetrics(metrics: Record<string, number>, max = 4): [string, number][] {
  const names = Object.keys(metrics)
  const first = HEADLINE_FIRST.filter((name) => names.includes(name))
  const rest = names.filter((name) => !HEADLINE_FIRST.includes(name) && !DETAIL_ONLY.test(name))
  return [...first, ...rest].slice(0, max).map((name) => [name, metrics[name]])
}

// ── 筛选和排序 ────────────────────────────────────────────────────────────

/** 浏览页的三项筛选：区域、关卡、设备；空串是「全部」。 */
export interface ArchiveFilters {
  zone: string
  stage: string
  device: string
}

export const FILTER_KEYS = ['zone', 'stage', 'device'] as const

/** 能筛选的条目：zone 由页面按大纲算好（关卡的区域，真卡副本是它所在的区域）。 */
export type Filterable = Record<keyof ArchiveFilters, string>

/** 符合筛选的条目；except 给了时不看这一项（算这一项的选项和条数用）。 */
export function filterEntries<T extends Filterable>(entries: readonly T[], filters: ArchiveFilters, except?: keyof ArchiveFilters): T[] {
  return entries.filter((e) => FILTER_KEYS.every((key) => key === except || !filters[key] || e[key] === filters[key]))
}

/** 一项筛选的选项：按另外两项筛完以后，这一项每个值有几条，按第一次出现的顺序。 */
export function facetCounts<T extends Filterable>(entries: readonly T[], filters: ArchiveFilters, key: keyof ArchiveFilters): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of filterEntries(entries, filters, key)) counts.set(e[key], (counts.get(e[key]) ?? 0) + 1)
  return counts
}

const ROUTE_ORDER: Record<LabRoute, number> = { hip: 0, triton: 1, shared: 2 }

/** 同一关里的顺序：真实记录在前、示例在后；新的在前；同一时间按路线、设备。 */
export function compareEntries(a: ArchiveSummary, b: ArchiveSummary): number {
  return Number(a.example) - Number(b.example)
    || Number(a.at < b.at) - Number(a.at > b.at)
    || ROUTE_ORDER[a.route] - ROUTE_ORDER[b.route]
    || (a.device < b.device ? -1 : a.device > b.device ? 1 : 0)
}

// ── 原始样本 ──────────────────────────────────────────────────────────────

/** 中位数，同 Python 的 statistics.median：偶数个时取中间两个的平均。hg.bench() 的 median_ms 就是这样算的。 */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  if (!n) return Number.NaN
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
}

/** 线性插值的分位数，同 hello_gpu.lab._quantile（也是 numpy.percentile 的默认算法）。 */
export function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return Number.NaN
  const position = (sorted.length - 1) * q
  const low = Math.floor(position)
  const high = Math.min(low + 1, sorted.length - 1)
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
}

export interface SampleStats {
  count: number
  median: number
  p10: number
  p90: number
  min: number
  max: number
}

export function sampleStats(ms: readonly number[]): SampleStats {
  return {
    count: ms.length,
    median: median(ms),
    p10: quantile(ms, 0.1),
    p90: quantile(ms, 0.9),
    min: Math.min(...ms),
    max: Math.max(...ms),
  }
}

/** 两个测量值算不算同一个数：Python 和 JS 各算一遍、JSON 来回一趟，最后一位可能不同，按相对误差 1e-9 比。 */
export function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))
}

/** 一组样本画成折线：横轴是第几次，看得出预热够不够、有没有离群的几次。 */
export function seriesChart(series: Pick<ArchiveSeries, 'label' | 'ms'>): ChartOutput {
  return {
    kind: 'chart',
    chart: 'line',
    x: { label: '第几次', values: series.ms.map((_, i) => i + 1) },
    y: { label: '耗时', unit: 'ms' },
    series: [{ name: series.label, values: [...series.ms] }],
  }
}

// ── 图表的坐标（kit/lab/ArchiveOutput.vue 画 SVG）──────────────────────────

export interface ChartTick {
  /** 在画布上的位置（像素）。 */
  at: number
  label: string
}

export interface ChartPoint {
  x: number
  y: number
  value: number
  /** 这个点的横坐标怎么写。 */
  label: string
}

export interface ChartLine {
  name: string
  /** 第几条线：决定颜色和点的形状。 */
  index: number
  points: ChartPoint[]
  /** 折线的 SVG 路径；遇到空着的点断开。 */
  path: string
}

export interface ChartBar {
  x: number
  y: number
  width: number
  height: number
  value: number
  index: number
  label: string
}

export interface ChartModel {
  width: number
  height: number
  plot: { left: number; top: number; right: number; bottom: number }
  xTicks: ChartTick[]
  yTicks: ChartTick[]
  lines: ChartLine[]
  bars: ChartBar[]
}

/** 刻度上的数：0 写 0，特别大或特别小的用科学计数法（1e6、1e-5），其余最多 6 位有效数字。 */
export function formatTick(value: number): string {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e6 || abs < 1e-4) return value.toExponential().replace('e+', 'e')
  return String(Number(value.toPrecision(6)))
}

const clean = (value: number) => Number(value.toPrecision(12))

/** 线性刻度：步长取 1、2、2.5、5 乘 10 的幂，大约 count 段，两头延伸到整刻度。 */
export function linearTicks(min: number, max: number, count = 4): number[] {
  let lo = min
  let hi = max
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.05 || 1
    lo -= pad
    hi += pad
  }
  const raw = (hi - lo) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power
  const start = Math.floor(clean(lo / step))
  const end = Math.ceil(clean(hi / step))
  const ticks: number[] = []
  for (let i = start; i <= end; i++) ticks.push(clean(i * step))
  return ticks
}

/** 对数刻度：10 的整数次幂；跨不到两个数量级时再加上 2 和 5 倍的刻度。min、max 要是正数。 */
export function logTicks(min: number, max: number): number[] {
  const lo = Math.floor(clean(Math.log10(min)))
  let hi = Math.ceil(clean(Math.log10(max)))
  if (hi === lo) hi += 1
  const ticks: number[] = []
  for (let p = lo; p <= hi; p++) {
    ticks.push(clean(10 ** p))
    if (hi - lo < 2 && p < hi) ticks.push(clean(2 * 10 ** p), clean(5 * 10 ** p))
  }
  return ticks
}

interface Axis {
  ticks: number[]
  /** 数轴的两头（对数轴是取过对数以后的）。 */
  domain: [number, number]
  log: boolean
}

const toScale = (value: number, log: boolean) => (log ? Math.log10(value) : value)

function numberAxis(values: number[], log: boolean, { zero = false, exact = false } = {}): Axis {
  const usable = log ? values.filter((v) => v > 0) : values
  let min = Math.min(...usable)
  let max = Math.max(...usable)
  if (!usable.length) [min, max] = log ? [1, 10] : [0, 1]
  if (zero && !log) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }
  // 横轴上不多的几个数（例如每行元素数 256、512……4096）：刻度就放在这几个数上，两头留一点空
  const distinct = [...new Set(usable)].sort((a, b) => a - b)
  if (exact && distinct.length && distinct.length <= 8) {
    const lo = toScale(distinct[0], log)
    const hi = toScale(distinct.at(-1)!, log)
    const pad = (hi - lo) * 0.04 || (log ? 0.5 : Math.abs(lo) * 0.05 || 1)
    return { ticks: distinct, domain: [lo - pad, hi + pad], log }
  }
  const ticks = log ? logTicks(min, max) : linearTicks(min, max)
  return { ticks, domain: [toScale(ticks[0], log), toScale(ticks.at(-1)!, log)], log }
}

/** 一位等宽数字大约多宽（像素），用来给纵轴的刻度留位置。 */
const DIGIT_WIDTH = 7

/**
 * 图表输出的坐标：按画布的宽高（像素）算出绘图区、刻度、折线和柱子。
 * 轴的名字和单位不画在 SVG 里，由组件用文字写在图的上下（窄屏可以换行）。
 */
export function chartModel(chart: ChartOutput, width: number, height: number): ChartModel {
  const values = chart.series.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number'))
  const bar = chart.chart === 'bar'
  const yAxis = numberAxis(values, !bar && chart.y.scale === 'log', { zero: bar })
  const yLabels = yAxis.ticks.map(formatTick)
  const left = Math.max(...yLabels.map((label) => label.length)) * DIGIT_WIDTH + 12
  const plot = { left, top: 10, right: width - 12, bottom: height - 26 }
  const y = (value: number) => {
    const [d0, d1] = yAxis.domain
    return plot.bottom - ((toScale(value, yAxis.log) - d0) / (d1 - d0)) * (plot.bottom - plot.top)
  }
  const yTicks = yAxis.ticks.map((value, i) => ({ at: y(value), label: yLabels[i] }))

  if (bar) {
    const categories = chart.x.values.map((value) => (typeof value === 'number' ? formatTick(value) : value))
    const slot = (plot.right - plot.left) / categories.length
    const group = slot * 0.72
    const width1 = group / chart.series.length
    const zero = y(Math.min(Math.max(0, yAxis.ticks[0]), yAxis.ticks.at(-1)!))
    const bars: ChartBar[] = []
    chart.series.forEach((s, index) => s.values.forEach((value, i) => {
      if (typeof value !== 'number') return
      const top = y(value)
      bars.push({
        x: plot.left + i * slot + (slot - group) / 2 + index * width1,
        y: Math.min(top, zero),
        width: width1,
        height: Math.abs(zero - top),
        value,
        index,
        label: categories[i],
      })
    }))
    const xTicks = categories.map((label, i) => ({ at: plot.left + (i + 0.5) * slot, label }))
    return { width, height, plot, xTicks, yTicks, lines: [], bars }
  }

  const xs = chart.x.values.filter((v): v is number => typeof v === 'number')
  const xAxis = numberAxis(xs, chart.x.scale === 'log', { exact: true })
  const x = (value: number) => {
    const [d0, d1] = xAxis.domain
    return plot.left + ((toScale(value, xAxis.log) - d0) / (d1 - d0)) * (plot.right - plot.left)
  }
  const xTicks = xAxis.ticks.map((value) => ({ at: x(value), label: formatTick(value) }))
  const lines = chart.series.map((s, index) => {
    const points: ChartPoint[] = []
    let path = ''
    let pen = false
    s.values.forEach((value, i) => {
      const at = chart.x.values[i]
      if (typeof value !== 'number' || typeof at !== 'number' || (yAxis.log && value <= 0) || (xAxis.log && at <= 0)) {
        pen = false
        return
      }
      const point = { x: x(at), y: y(value), value, label: formatTick(at) }
      points.push(point)
      path += `${pen ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`
      pen = true
    })
    return { name: s.name, index, points, path }
  })
  return { width, height, plot, xTicks, yTicks, lines, bars: [] }
}
