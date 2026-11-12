/**
 * 1-2 走进工坊城：可以逐层放大的芯片全景图（纯函数，单测在 scripts/tests/novice-gpu-panorama.test.mjs）。
 *
 * 全景图画一张卡由什么组成：芯片 → WGP → 计算单元 → SIMD → lane，外加寄存器、LDS、缓存和显存。
 * 所有的数都从 ChipSpec 来：默认是 hardware.json 里的 RX 9070 XT（每个数都有官方出处）；读者导入自己的
 * 「GPU 卡片」（L-07）以后换成 specFromCard 生成的那份，组件按新的数重画。每一层画在哪（布局）、说什么（解读）
 * 也在这里算，组件只负责把它们画出来。
 *
 * 布局有两套坐标：wide（宽屏，viewBox 400 × 280）和 narrow（窄屏，320 × 400）。同一套坐标里每一层的
 * 外框都一样大，放大时上一层的某个部件「长成」下一层的整个外框（02 第 3 节：场景切换用放大衔接）。
 * 空间约定（02 第 3 节）：计算单元在上，显存在下。
 */
import {
  DEFAULT_DEVICE_ID, HARDWARE_DEVICES, PENDING, deviceById, formatParam, memoryGiB, sourceOf, type HardwareDevice,
} from '../../course/hardware.ts'
import type { DeviceRecord } from '../../course/progress.ts'
import { stageById } from '../../course/outline.ts'

// ── 一张卡的参数 ──────────────────────────────────────────────────────────

export interface Size {
  value: number
  unit: string
}

/** 「这些数从哪来」里的一行。 */
export interface SpecFact {
  label: string
  /** 写成一句话里的样子：「64 个」「16 GB」。 */
  text: string
  /** 出处的标题；读者自己的卡片写「你的 GPU 卡片」。 */
  from: string
  url?: string
  /** 在出处的哪个位置。 */
  where?: string
}

export interface ChipSpec {
  name: string
  arch?: string
  gfx?: string
  cuCount: number
  /** 几个计算单元合成一个 WGP。1 表示这张卡没有 WGP 这一层，全景图跳过它。 */
  cusPerWgp: number
  simdsPerCu: number
  lanesPerSimd: number
  /** 一个小队（wave）几个线程，例如 [32, 64]。 */
  waveSizes: readonly number[]
  ldsPerWgp?: Size
  l2?: Size
  infinityCache?: Size
  vram?: Size
  vramType?: string
  bus?: string
  facts: readonly SpecFact[]
}

/** 从 hardware.json 的一张卡生成全景图的参数。结构上的四个数缺了就没法画，直接报错（数据写错了）。 */
export function specFromDevice(device: HardwareDevice): ChipSpec {
  const p = device.params
  const known = (key: string) => (p[key] && p[key].value !== PENDING ? p[key].value : undefined)
  const num = (key: string) => {
    const v = known(key)
    return typeof v === 'number' ? v : undefined
  }
  const str = (key: string) => {
    const v = known(key)
    return typeof v === 'string' ? v : undefined
  }
  const size = (key: string): Size | undefined => {
    const v = num(key)
    return v === undefined ? undefined : { value: v, unit: p[key].unit ?? '' }
  }
  const need = (key: string) => {
    const v = num(key)
    if (v === undefined) throw new Error(`hardware.json 里 ${device.name} 缺少 ${key}，全景图画不出来`)
    return v
  }
  const waves = known('waveSizes')
  return {
    name: device.name,
    arch: str('arch'),
    gfx: str('gfx'),
    cuCount: need('cuCount'),
    cusPerWgp: num('cusPerWgp') ?? 1,
    simdsPerCu: need('simdsPerCu'),
    lanesPerSimd: need('lanesPerSimd'),
    waveSizes: Array.isArray(waves) ? waves : typeof waves === 'number' ? [waves] : [],
    ldsPerWgp: size('ldsPerWgp'),
    l2: size('l2Cache'),
    infinityCache: size('infinityCache'),
    vram: size('vramSize'),
    vramType: str('vramType'),
    bus: str('bus'),
    facts: Object.values(p).map((param) => {
      const source = sourceOf(param)
      return {
        label: param.label,
        text: formatParam(param),
        from: source?.title ?? '还没有出处',
        url: source?.url,
        where: param.where,
      }
    }),
  }
}

/** 默认的卡：hardware.json 里的 RX 9070 XT。 */
export const DEFAULT_SPEC: ChipSpec = specFromDevice(deviceById(DEFAULT_DEVICE_ID)!)

/** 卡片里的数在「这些数从哪来」里写的出处（NV-02 约定）。 */
export const CARD_SOURCE = '你的 GPU 卡片'

/**
 * 读者的「GPU 卡片」（L-07）生成全景图的参数。CU 数、wave 大小、显存从卡片来；一个 WGP 几个计算单元、一个计算单元
 * 几条 SIMD、一条 SIMD 几个 lane、LDS 多大由架构决定，取 hardware.json 里同一个 gfx 目标的那张卡，出处照抄。
 * 缓存、显存类型、和 CPU 之间的通道每款产品不一样，卡片里没有，就不画。
 * hardware.json 里没有这个 gfx 时返回 null：结构没有出处，不画，全景图留在本书的卡上。
 */
export function specFromCard(card: DeviceRecord): ChipSpec | null {
  const device = Object.values(HARDWARE_DEVICES).find((d) => d.params.gfx?.value === card.gfx)
  if (!device) return null
  const arch = specFromDevice(device)
  /** 同一个 gfx 目标的那张卡的一项，出处照抄；hardware.json 里没有这一项就不列。 */
  const sameGfx = (key: string): SpecFact[] => {
    const param = device.params[key]
    if (!param) return []
    const source = sourceOf(param)
    return [{
      label: param.label,
      text: formatParam(param),
      from: source?.title ?? '还没有出处',
      url: source?.url,
      where: `和 ${device.name} 是同一个 gfx 目标（${card.gfx}），用它的这一项${param.where ? `：${param.where}` : ''}`,
    }]
  }
  const mine = (label: string, text: string, where: string): SpecFact => ({ label, text, from: CARD_SOURCE, where })
  const vram = memoryGiB(card.memoryBytes)
  return {
    ...arch,
    name: card.name,
    gfx: card.gfx,
    cuCount: card.cus,
    waveSizes: card.wave ? [card.wave] : arch.waveSizes,
    l2: undefined,
    infinityCache: undefined,
    vram: { value: vram, unit: 'GiB' },
    vramType: undefined,
    bus: undefined,
    facts: [
      ...sameGfx('arch'),
      mine('LLVM 目标名', card.gfx, 'PyTorch 读到的 gcnArchName'),
      mine('计算单元（CU）', `${card.cus} 个`, 'PyTorch 读到的设备属性；按 WGP 计数的卡，hello_gpu 已经换算成计算单元'),
      ...['cusPerWgp', 'simdsPerCu', 'lanesPerSimd'].flatMap(sameGfx),
      ...(card.wave
        ? [mine('wave 大小', `${card.wave} 个线程`, 'PyTorch 读到的 warp_size（没有时用 rocminfo 的 Wavefront Size）')]
        : sameGfx('waveSizes')),
      ...sameGfx('ldsPerWgp'),
      mine('显存容量', `${vram} GiB`, 'PyTorch 读到的 total_memory'),
      mine('缓存、显存类型、和 CPU 之间的通道', '不画', '卡片里没有这几项，每款产品又不一样'),
    ],
  }
}

const whole = (n: number, min: number) => (Number.isFinite(n) ? Math.max(min, Math.floor(n)) : min)

/** 换卡时传进来的数可能不规整（L-07 的卡片来自读者的机器）：结构上的数取不小于 1 的整数。 */
export function normalizeSpec(spec: ChipSpec): ChipSpec {
  return {
    ...spec,
    cuCount: whole(spec.cuCount, 1),
    cusPerWgp: whole(spec.cusPerWgp, 1),
    simdsPerCu: whole(spec.simdsPerCu, 1),
    lanesPerSimd: whole(spec.lanesPerSimd, 1),
    waveSizes: (spec.waveSizes ?? []).filter((w) => Number.isFinite(w) && w > 0),
  }
}

export const sizeText = (s: Size | undefined) => (s ? `${s.value} ${s.unit}` : '')

// ── 数一数 ─────────────────────────────────────────────────────────────────

export interface Counts {
  /** 没有 WGP 这一层的卡是 0。 */
  wgps: number
  cus: number
  simds: number
  lanes: number
}

export function countsOf(spec: ChipSpec): Counts {
  const s = normalizeSpec(spec)
  const simds = s.cuCount * s.simdsPerCu
  return {
    wgps: s.cusPerWgp > 1 ? Math.ceil(s.cuCount / s.cusPerWgp) : 0,
    cus: s.cuCount,
    simds,
    lanes: simds * s.lanesPerSimd,
  }
}

/** 第 k 个 WGP 里有几个计算单元：计算单元数不是整倍数时，最后一个 WGP 少几个。 */
export function cusInWgp(spec: ChipSpec, wgp: number): number {
  const s = normalizeSpec(spec)
  return Math.max(0, Math.min(s.cusPerWgp, s.cuCount - wgp * s.cusPerWgp))
}

// ── 逐层放大 ───────────────────────────────────────────────────────────────

export type Level = 'chip' | 'wgp' | 'cu' | 'simd' | 'lane'

/** 这张卡有哪几层：没有 WGP 的卡（cusPerWgp 为 1）从芯片直接到计算单元。 */
export function levelsOf(spec: ChipSpec): Level[] {
  return normalizeSpec(spec).cusPerWgp > 1 ? ['chip', 'wgp', 'cu', 'simd', 'lane'] : ['chip', 'cu', 'simd', 'lane']
}

/**
 * 现在看到哪一层，以及一路点进来的是哪一个：wgp 是芯片里的第几个 WGP；cu 有 WGP 这一层时是 WGP 里的
 * 第几个，没有时是芯片里的第几个；simd 是计算单元里的第几条；lane 是 SIMD 里的第几个。
 */
export interface Path {
  level: Level
  wgp: number
  cu: number
  simd: number
  lane: number
}

export const START: Path = { level: 'chip', wgp: 0, cu: 0, simd: 0, lane: 0 }

/** 一层里能点的部件有几个（最里面的 lane 没有）。 */
export function childCount(spec: ChipSpec, path: Path): number {
  const s = normalizeSpec(spec)
  const c = countsOf(s)
  switch (path.level) {
    case 'chip': return c.wgps > 0 ? c.wgps : c.cus
    case 'wgp': return cusInWgp(s, path.wgp)
    case 'cu': return s.simdsPerCu
    case 'simd': return s.lanesPerSimd
    default: return 0
  }
}

/** 点了这一层的第 index 个部件：进到下一层。最里面一层或者序号不对时不动。 */
export function zoomIn(spec: ChipSpec, path: Path, index: number): Path {
  const levels = levelsOf(spec)
  const at = levels.indexOf(path.level)
  if (at < 0 || at >= levels.length - 1 || !Number.isInteger(index) || index < 0 || index >= childCount(spec, path)) return path
  const next = levels[at + 1]
  const key = path.level === 'chip' ? (next === 'wgp' ? 'wgp' : 'cu') : path.level === 'wgp' ? 'cu' : path.level === 'cu' ? 'simd' : 'lane'
  return { ...path, level: next, [key]: index }
}

/** 退到 level 这一层（只能往外退）。 */
export function zoomOutTo(spec: ChipSpec, path: Path, level: Level): Path {
  const levels = levelsOf(spec)
  const to = levels.indexOf(level)
  return to >= 0 && to < levels.indexOf(path.level) ? { ...path, level } : path
}

/** 往外退一层。 */
export function zoomOut(spec: ChipSpec, path: Path): Path {
  const levels = levelsOf(spec)
  const at = levels.indexOf(path.level)
  return at > 0 ? { ...path, level: levels[at - 1] } : path
}

/**
 * 换了一张卡（L-07）：路径里的序号可能超出新卡的范围，层也可能不存在（新卡没有 WGP）。
 * 超出的序号收回到范围里；层不存在就退回芯片。
 */
export function clampPath(spec: ChipSpec, path: Path): Path {
  const s = normalizeSpec(spec)
  const levels = levelsOf(s)
  const c = countsOf(s)
  const clamp = (v: number, n: number) => (Number.isInteger(v) && v >= 0 ? Math.min(v, Math.max(0, n - 1)) : 0)
  const wgp = clamp(path.wgp, c.wgps)
  const cu = clamp(path.cu, levels.includes('wgp') ? cusInWgp(s, wgp) : c.cus)
  return {
    level: levels.includes(path.level) ? path.level : 'chip',
    wgp,
    cu,
    simd: clamp(path.simd, s.simdsPerCu),
    lane: clamp(path.lane, s.lanesPerSimd),
  }
}

/** 路径上这一层是在上一层里点了第几个（芯片这一层没有）。 */
export function indexAt(path: Path, level: Level): number {
  if (level === 'wgp') return path.wgp
  if (level === 'cu') return path.cu
  if (level === 'simd') return path.simd
  if (level === 'lane') return path.lane
  return 0
}

// ── 每一层说什么 ───────────────────────────────────────────────────────────

/** 一层的名字，面包屑里用它。 */
export function levelName(path: Path, level: Level): string {
  switch (level) {
    case 'chip': return '整块芯片'
    case 'wgp': return `WGP ${path.wgp}`
    case 'cu': return `计算单元 ${path.cu}`
    case 'simd': return `SIMD ${path.simd}`
    default: return `lane ${path.lane}`
  }
}

/** 面包屑：从芯片到现在这一层。 */
export function crumbsOf(spec: ChipSpec, path: Path): { level: Level; label: string }[] {
  const levels = levelsOf(spec)
  return levels.slice(0, levels.indexOf(path.level) + 1).map((level) => ({ level, label: levelName(path, level) }))
}

export interface Reading {
  title: string
  /** 这一层有什么，每条一句，数都从参数来。 */
  lines: string[]
  /** 下一步可以做什么。 */
  next: string
}

/** 「小队」「货架」在第几关细讲：编号从大纲取，插关卡不用改这里。 */
const WAVE_CODE = stageById('novice-wavefront')?.code ?? ''
const LDS_CODE = stageById('novice-lds-sync')?.code ?? ''

export function describe(spec: ChipSpec, path: Path): Reading {
  const s = normalizeSpec(spec)
  const c = countsOf(s)
  const lanesPerCu = s.simdsPerCu * s.lanesPerSimd
  const team = s.waveSizes.length ? `${s.waveSizes.join(' 或 ')} 人` : PENDING
  const later = (code: string) => (code ? `（第 ${code} 关细讲）` : '')
  switch (path.level) {
    case 'chip': {
      const caches = [s.l2 && `L2 缓存 ${sizeText(s.l2)}`, s.infinityCache && `Infinity Cache ${sizeText(s.infinityCache)}`].filter(Boolean)
      const vram = s.vram ? `${sizeText(s.vram)}${s.vramType ? ` ${s.vramType}` : ''}` : PENDING
      return {
        title: '整块芯片：一座工坊城',
        lines: [
          c.wgps > 0
            ? `${c.wgps} 个 WGP（工作组处理器），每个由 ${s.cusPerWgp} 个计算单元组成，一共 ${c.cus} 个计算单元。`
            : `${c.cus} 个计算单元。`,
          caches.length
            ? `芯片上有缓存：${caches.join('，')}。它们留着最近从显存取来的数据，下次再要就不用去显存取。`
            : '芯片上还有缓存，留着最近从显存取来的数据。',
          `芯片外面是显存：${vram}。${s.bus ? `显卡通过 ${s.bus} 和 CPU 相连。` : ''}`,
        ],
        next: c.wgps > 0 ? '点一个 WGP，放大看看里面。' : '点一个计算单元，放大看看里面。',
      }
    }
    case 'wgp': {
      const n = cusInWgp(s, path.wgp)
      const rooms = n === 2 ? '两间' : `${n} 间`
      return {
        title: `WGP ${path.wgp}：${rooms}打通的车间`,
        lines: [
          `这个 WGP 由 ${n} 个计算单元组成，它们合用一块 LDS${s.ldsPerWgp ? `（${sizeText(s.ldsPerWgp)}）` : ''}。`,
          `LDS 像这${n === 2 ? '' : ' '}${rooms}车间合用的一排货架：一起干同一批活的工位，可以在上面放东西、拿东西${later(LDS_CODE)}。`,
        ],
        next: '点一个计算单元，继续放大。',
      }
    }
    case 'cu':
      return {
        title: `计算单元 ${path.cu}：一间车间`,
        lines: [
          `${s.simdsPerCu} 条 SIMD（流水线），每条 ${s.lanesPerSimd} 个 lane（工位），这间车间一共 ${lanesPerCu} 个 lane。`,
          `整块芯片有 ${c.cus} 间这样的车间，所以一共 ${c.lanes} 个 lane。`,
        ],
        next: '点一条 SIMD，看看它的工位。',
      }
    case 'simd':
      return {
        title: `SIMD ${path.simd}：一条流水线`,
        lines: [
          `${s.lanesPerSimd} 个 lane 听同一个口令：同一时刻做同一件事，各算各的数。`,
          '每个 lane 手边有一排寄存器，放着它正在算的几个数，像工位上的工具台。',
          `活是一小队一小队交给流水线的，这张卡一队 ${team}${later(WAVE_CODE)}。`,
        ],
        next: '点一个 lane，看它在做什么。',
      }
    default:
      return {
        title: `lane ${path.lane}：一个工位`,
        lines: [
          'a[i]、b[i] 从显存取来，放进这个 lane 的寄存器；相加得到 c[i]，再写回显存。',
          '上一关的一个学徒，干的就是一个工位的活。',
        ],
        next: '这是最里面一层。点上面的路径，可以一层层退回去。',
      }
  }
}

/** 一句话把几层数串起来：「4096 个 lane = 64 个计算单元 × 2 条 SIMD × 32 个 lane」。 */
export function laneFormula(spec: ChipSpec): string {
  const s = normalizeSpec(spec)
  return `${countsOf(s).lanes} 个 lane = ${s.cuCount} 个计算单元 × ${s.simdsPerCu} 条 SIMD × ${s.lanesPerSimd} 个 lane`
}

// ── 布局 ──────────────────────────────────────────────────────────────────

export type Mode = 'wide' | 'narrow'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 能点的部件：第几个、画在哪；parts 是它里面再分几份（WGP 里的计算单元、SIMD 里的 lane……），画成分格。 */
export interface Unit extends Box {
  index: number
  parts: number
}

export interface Shelf extends Box {
  key: 'l2' | 'infinity' | 'cache' | 'lds' | 'banner'
  label: string
  text: string
}

export interface LevelLayout {
  view: { w: number; h: number }
  /** 这一层的外框：同一套坐标里每一层都一样大。 */
  frame: Box
  title: { x: number; y: number }
  units: Unit[]
  /** 部件排成几列（键盘的上下键按它跳行）。 */
  cols: number
  /** 外框里不能点的部分：缓存、LDS、「一条指令」。 */
  shelves: Shelf[]
  /** 外框下面：显存（芯片这一层是实物，其他层只是一条提示）。 */
  below: Box
}

const VIEW: Record<Mode, { w: number; h: number; frame: Box; below: Box }> = {
  wide: { w: 400, h: 280, frame: { x: 8, y: 8, w: 384, h: 196 }, below: { x: 8, y: 222, w: 384, h: 50 } },
  narrow: { w: 320, h: 400, frame: { x: 6, y: 6, w: 308, h: 300 }, below: { x: 6, y: 326, w: 308, h: 66 } },
}

const PAD = 14
const HEAD = 34

/**
 * count 个部件排进 area：挑一个列数，让每格的宽高比接近 cellAspect，空格子少一点。
 * 返回列数和行数；count 不超过 maxCols 时也可能排成一行。
 */
export function gridShape(count: number, area: { w: number; h: number }, cellAspect: number, maxCols = 16): { cols: number; rows: number } {
  const n = whole(count, 1)
  let best = { cols: 1, rows: n, score: Number.POSITIVE_INFINITY }
  for (let cols = 1; cols <= Math.min(n, maxCols); cols++) {
    const rows = Math.ceil(n / cols)
    const aspect = (area.w / cols) / (area.h / rows)
    const score = Math.abs(Math.log(aspect / cellAspect)) + (cols * rows - n) * 0.2
    if (score < best.score - 1e-9) best = { cols, rows, score }
  }
  return { cols: best.cols, rows: best.rows }
}

/** 按 gridShape 把 count 个部件放进 area，格子之间留 gap。 */
export function gridUnits(count: number, area: Box, cellAspect: number, gap: number, parts: (index: number) => number) {
  const n = whole(count, 0)
  if (n === 0) return { units: [] as Unit[], cols: 1 }
  const { cols, rows } = gridShape(n, area, cellAspect)
  const w = (area.w - gap * (cols - 1)) / cols
  const h = (area.h - gap * (rows - 1)) / rows
  const units: Unit[] = []
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    units.push({ index: i, parts: parts(i), x: area.x + c * (w + gap), y: area.y + r * (h + gap), w, h })
  }
  return { units, cols }
}

/** 竖着排（一行一个）。 */
function stack(count: number, area: Box, gap: number, parts: number): Unit[] {
  const h = (area.h - gap * (count - 1)) / count
  return Array.from({ length: count }, (_, i) => ({ index: i, parts, x: area.x, y: area.y + i * (h + gap), w: area.w, h }))
}

/** 横着排（一列一个）。 */
function row(count: number, area: Box, gap: number, parts: number): Unit[] {
  const w = (area.w - gap * (count - 1)) / count
  return Array.from({ length: count }, (_, i) => ({ index: i, parts, x: area.x + i * (w + gap), y: area.y, w, h: area.h }))
}

export function layoutOf(spec: ChipSpec, path: Path, mode: Mode): LevelLayout {
  const s = normalizeSpec(spec)
  const c = countsOf(s)
  const v = VIEW[mode]
  const f = v.frame
  const inner = { x: f.x + PAD, y: f.y + HEAD, w: f.w - PAD * 2, h: f.h - HEAD - PAD }
  const base = { view: { w: v.w, h: v.h }, frame: f, title: { x: f.x + PAD, y: f.y + 22 }, below: v.below }

  if (path.level === 'chip') {
    // 下面一条（宽屏）或两条（窄屏）是缓存，上面是 WGP（或计算单元）的方阵。
    const caches: Omit<Shelf, keyof Box>[] = []
    if (s.l2) caches.push({ key: 'l2', label: 'L2 缓存', text: sizeText(s.l2) })
    if (s.infinityCache) caches.push({ key: 'infinity', label: 'Infinity Cache', text: sizeText(s.infinityCache) })
    if (!caches.length) caches.push({ key: 'cache', label: '缓存', text: '' })
    const shelfH = mode === 'wide' ? 34 : caches.length * 24 + (caches.length - 1) * 6
    const shelfArea = { x: inner.x, y: inner.y + inner.h - shelfH, w: inner.w, h: shelfH }
    const shelves = (mode === 'wide' ? row(caches.length, shelfArea, 8, 0) : stack(caches.length, shelfArea, 6, 0))
      .map((box, i) => ({ ...caches[i], x: box.x, y: box.y, w: box.w, h: box.h }))
    const area = { x: inner.x, y: inner.y, w: inner.w, h: inner.h - shelfH - 10 }
    const wgp = c.wgps > 0
    // 宽屏的格子横着放（WGP 里两个计算单元左右排）；窄屏竖着放，手指点得到。
    const aspect = mode === 'narrow' ? 0.8 : wgp ? 1.6 : 1.1
    const grid = gridUnits(wgp ? c.wgps : c.cus, area, aspect, 6, (i) => (wgp ? cusInWgp(s, i) : s.simdsPerCu))
    return { ...base, units: grid.units, cols: grid.cols, shelves }
  }

  if (path.level === 'wgp') {
    const ldsH = mode === 'wide' ? 40 : 44
    const area = { x: inner.x, y: inner.y, w: inner.w, h: inner.h - ldsH - 10 }
    const n = cusInWgp(s, path.wgp)
    const units = mode === 'wide' ? row(n, area, 10, s.simdsPerCu) : stack(n, area, 10, s.simdsPerCu)
    const lds: Shelf = {
      key: 'lds', label: 'LDS', text: s.ldsPerWgp ? sizeText(s.ldsPerWgp) : '',
      x: inner.x, y: inner.y + inner.h - ldsH, w: inner.w, h: ldsH,
    }
    return { ...base, units, cols: mode === 'wide' ? n : 1, shelves: [lds] }
  }

  if (path.level === 'cu') {
    return { ...base, units: stack(s.simdsPerCu, inner, 10, s.lanesPerSimd), cols: 1, shelves: [] }
  }

  if (path.level === 'simd') {
    const bannerH = 26
    const banner: Shelf = { key: 'banner', label: '一条指令', text: `${s.lanesPerSimd} 个 lane 一起做`, x: inner.x, y: inner.y, w: inner.w, h: bannerH }
    const area = { x: inner.x, y: inner.y + bannerH + 10, w: inner.w, h: inner.h - bannerH - 10 }
    const grid = gridUnits(s.lanesPerSimd, area, mode === 'wide' ? 1.4 : 1, 5, () => 0)
    return { ...base, units: grid.units, cols: grid.cols, shelves: [banner] }
  }

  // lane：没有能点的部件，画寄存器和一次加法（组件里画）。
  return { ...base, units: [], cols: 1, shelves: [] }
}

/**
 * 放大、缩小怎么衔接（02 第 3 节：场景切换用放大或缩小衔接）：上一层里被点的那个部件，和下一层的整个外框
 * 之间差一个缩放。以 (ox, oy) 为中心按 (sx, sy) 缩放，外框正好落在那个部件上；反过来缩放 (1/sx, 1/sy)，
 * 那个部件就撑满外框。放大时新的一层从部件里长出来、旧的一层冲出画面；缩小时反过来。
 */
export interface ZoomFrame {
  ox: number
  oy: number
  sx: number
  sy: number
}

export function zoomFrame(spec: ChipSpec, path: Path, childLevel: Level, mode: Mode): ZoomFrame {
  const levels = levelsOf(spec)
  const at = levels.indexOf(childLevel)
  const f = VIEW[mode].frame
  const unit = at > 0 ? layoutOf(spec, { ...path, level: levels[at - 1] }, mode).units[indexAt(path, childLevel)] : undefined
  if (!unit) return { ox: f.x + f.w / 2, oy: f.y + f.h / 2, sx: 1, sy: 1 }
  const sx = unit.w / f.w
  const sy = unit.h / f.h
  // 缩放中心 p 满足 p + s × (外框边 − p) = 部件边；s 接近 1 时退回部件中心。
  const center = (u: number, frame: number, s: number, mid: number) => (Math.abs(1 - s) < 1e-6 ? mid : (u - s * frame) / (1 - s))
  return { ox: center(unit.x, f.x, sx, unit.x + unit.w / 2), oy: center(unit.y, f.y, sy, unit.y + unit.h / 2), sx, sy }
}
