/**
 * 2-1 开工准备：三段探索里的数（纯函数，单测在 scripts/tests/forge-your-gpu.test.mjs）。
 *
 * 三段探索和实验室 Notebook「动手」的三段一一对应：CU 有几个、wave 多大、显存多少。
 * - 画哪张卡：本书的 RX 9070 XT（hardware.json 里的官方资料，09 第 4 节），或者读者导入的「我的 GPU 卡片」（L-07）。
 *   卡片里只有 gfx 代号、计算单元数、wave 大小和显存字节数；PyTorch 按不按 WGP 计数，由 gfx 代号推断。
 * - PyTorch 的 multi_processor_count 就是 HIP 运行时的 multiProcessorCount。ROCm 的 HIP 运行时（clr）在 gfx10、gfx11、
 *   gfx12.0–12.4 上默认进 WGP 模式，这个数取计算单元数的一半；规则和源码出处同 hello_gpu 的 _wgp_mode
 *   （notebooks/common/src/hello_gpu/lab.py）。环境变量 GPU_ENABLE_WGP_MODE=0 能关掉 WGP 模式，网页读不到读者的
 *   环境变量，一律按默认算。
 * - wave 大小按架构固定：RDNA 32 个线程，CDNA 64 个（HIP 文档的 Warp (or Wavefront) 一节）。
 */
import { DEFAULT_DEVICE_ID, deviceById, memoryGiB } from '../../course/hardware.ts'
import type { DeviceRecord } from '../../course/progress.ts'

export const STAGE_ID = 'forge-your-gpu'

// ── 一张卡 ────────────────────────────────────────────────────────────────

/** 显存容量和它的来历。 */
export interface Capacity {
  /** 比大小用的字节数。 */
  bytes: number
  /** 图上写的样子：本书的卡照产品页写「16 GB」，你的卡写「15.9 GiB」。 */
  text: string
  /** true：PyTorch 读到的 total_memory；false：产品页上的标称容量，按 1 GB = 10⁹ 字节换算，只用来示意。 */
  exact: boolean
}

/** 三段探索画的一张卡。 */
export interface Gpu {
  /** 读者导入的卡（true）还是本书的卡（false）。 */
  mine: boolean
  name: string
  gfx: string
  /** 计算单元的个数：卡片里的 cus 已经按计算单元算（hello_gpu 把按 WGP 计数的卡乘了 2）。 */
  cus: number
  memory: Capacity
}

/** 产品页上容量单位的字节数。 */
const UNIT_BYTES: Readonly<Record<string, number>> = {
  KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 2 ** 10, MiB: 2 ** 20, GiB: 2 ** 30, TiB: 2 ** 40,
}

function bookGpu(): Gpu {
  const device = deviceById(DEFAULT_DEVICE_ID)
  if (!device) throw new Error(`hardware.json 里没有本书的卡 ${DEFAULT_DEVICE_ID}`)
  const { gfx, cuCount, vramSize } = device.params
  const per = vramSize?.unit ? UNIT_BYTES[vramSize.unit] : undefined
  if (typeof gfx?.value !== 'string' || typeof cuCount?.value !== 'number' || typeof vramSize?.value !== 'number' || !per) {
    throw new Error(`hardware.json 里 ${device.name} 缺少 gfx、cuCount 或 vramSize（数和单位），2-1 的探索画不出来`)
  }
  return {
    mine: false,
    name: device.name,
    gfx: gfx.value,
    cus: cuCount.value,
    memory: { bytes: vramSize.value * per, text: `${vramSize.value} ${vramSize.unit}`, exact: false },
  }
}

/** 本书的实验卡：读者没有导入卡片，或者点了「看本书的卡」时画它。 */
export const BOOK_GPU: Gpu = bookGpu()

/** 读者的「我的 GPU 卡片」换成探索里画的样子；显存用卡片里 PyTorch 读到的字节数，按 GiB 写（同卡片和全景图）。 */
export function gpuFromCard(card: DeviceRecord): Gpu {
  return {
    mine: true,
    name: card.name,
    gfx: card.gfx,
    cus: card.cus,
    memory: { bytes: card.memoryBytes, text: `${memoryGiB(card.memoryBytes)} GiB`, exact: true },
  }
}

// ── 探索一：CU 有几个 ────────────────────────────────────────────────────

/** PyTorch（HIP 运行时）在这张卡上是不是按 WGP 计数：gfx10、gfx11、gfx12.0–12.4 是，同 hello_gpu 的 _wgp_mode。 */
export function countsWgps(gfx: string): boolean {
  const match = /^gfx(\d+)([0-9a-f])[0-9a-f]$/.exec(gfx)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number.parseInt(match[2], 16)
  if (major !== 10 && major !== 11 && major !== 12) return false
  return !(major === 12 && minor >= 5)
}

/** 方格图里一个框画几个计算单元：按 WGP 计数的卡两个一框（WGP 模式下计数取一半），别的卡一个一框。 */
export function cusPerBox(gfx: string): number {
  return countsWgps(gfx) ? 2 : 1
}

export type CuSource = 'torch' | 'rocminfo' | 'card'

/** 探索一的旋钮：谁在数。code 是读数的出处，显示在旋钮下面。 */
export const CU_SOURCES: readonly { value: CuSource; label: string; code: string }[] = [
  { value: 'torch', label: 'PyTorch', code: 'torch.cuda.get_device_properties(0).multi_processor_count' },
  { value: 'rocminfo', label: 'rocminfo', code: 'rocminfo 里 GPU 那一段的 Compute Unit' },
  { value: 'card', label: 'GPU 卡片', code: 'hg.device_card() 打印的「CU 数」' },
]

export interface CuReading {
  /** 报出来的数。 */
  value: number
  /** 它数的是 WGP 还是计算单元。 */
  unit: 'wgp' | 'cu'
  /** 一句话解读。 */
  text: string
}

/** 同一张卡，谁在数、报几、数的是什么。 */
export function cuReading(gpu: Gpu, source: CuSource): CuReading {
  const wgp = countsWgps(gpu.gfx)
  if (source === 'torch') {
    return wgp
      ? { value: Math.ceil(gpu.cus / 2), unit: 'wgp', text: `数的是 WGP，两个计算单元算一个。填全景图要乘 2：${gpu.cus} 个。` }
      : { value: gpu.cus, unit: 'cu', text: '这张卡不按 WGP 计数，报的就是计算单元，全景图照填。' }
  }
  if (source === 'rocminfo') {
    return { value: gpu.cus, unit: 'cu', text: '数的是计算单元，全景图要的就是这个数。' }
  }
  return {
    value: gpu.cus,
    unit: 'cu',
    text: wgp ? 'hello_gpu 已经把 PyTorch 报的数乘了 2，写的是计算单元。' : '和 PyTorch 报的一样，写的是计算单元。',
  }
}

// ── 探索二：wave 多大 ────────────────────────────────────────────────────

/** 两种 wave 大小（HIP 文档：RDNA 架构 32 个线程，CDNA 架构 64 个）。 */
export const WAVE_KINDS = [
  { wave: 32, arch: 'RDNA', cards: 'Radeon 显卡' },
  { wave: 64, arch: 'CDNA', cards: 'Instinct 加速卡' },
] as const

/** 探索二的旋钮：每组线程数。默认 96：32 个一队正好坐满，64 个一队空一半。 */
export const THREAD_OPTIONS = [64, 96, 128, 160, 256] as const
export const THREAD_DEFAULT = 96

export interface WaveSplit {
  threads: number
  wave: number
  /** 排成几个 wave。 */
  waves: number
  /** 最后一个 wave 坐了几个线程。 */
  last: number
  /** 最后一个 wave 空着几个 lane。 */
  idle: number
}

/** 一组 threads 个线程，wave 个一队：排成几个 wave，最后一个坐了几个、空着几个。 */
export function waveSplit(threads: number, wave: number): WaveSplit {
  const waves = Math.max(1, Math.ceil(threads / wave))
  const idle = waves * wave - threads
  return { threads, wave, waves, last: wave - idle, idle }
}

export function waveText(s: WaveSplit): string {
  if (!s.idle) return `${s.wave} 个一队：${s.waves} 个 wave，个个坐满。`
  return `${s.wave} 个一队：${s.waves} 个 wave，最后一个只坐了 ${s.last} 个，空着 ${s.idle} 个 lane。`
}

/** 两种卡放在一起的一句话结论。 */
export function waveVerdict(threads: number): string {
  const [small, big] = WAVE_KINDS.map((k) => k.wave)
  if (threads % big === 0) return `${threads} 是 ${big} 的倍数：两种卡上的 wave 都坐满。`
  if (threads % small === 0) return `${threads} 是 ${small} 的倍数，不是 ${big} 的倍数：wave ${small} 的卡坐满，wave ${big} 的卡最后一个 wave 空着一半。`
  return `${threads} 不是 ${small} 的倍数：两种卡上最后一个 wave 都坐不满。`
}

// ── 探索三：显存多少 ─────────────────────────────────────────────────────

/** 探索三的旋钮：n×n 矩阵的边长。 */
export const MATRIX_SIDES = [1024, 4096, 16384, 32768, 65536] as const
export const MATRIX_DEFAULT = 32768
/** 矩阵乘 C = A × B 要同时放下三个矩阵；FP32 每个数 4 字节。 */
export const MATRICES = 3
export const FP32_BYTES = 4

export function matrixBytes(n: number): number {
  return MATRICES * n * n * FP32_BYTES
}

const BINARY: readonly (readonly [string, number])[] = [['TiB', 2 ** 40], ['GiB', 2 ** 30], ['MiB', 2 ** 20], ['KiB', 2 ** 10]]
const DECIMAL: readonly (readonly [string, number])[] = [['TB', 1e12], ['GB', 1e9], ['MB', 1e6], ['KB', 1e3]]

/** 换成 units 里放得下的最大单位：100 以上取整，以下留一位小数，末尾的 .0 去掉（12 → 12，12.88 → 12.9，201.3 → 201）。 */
function scaled(bytes: number, units: readonly (readonly [string, number])[]): string {
  for (const [unit, size] of units) {
    if (bytes < size) continue
    const value = bytes / size
    return `${Number(value >= 100 ? value.toFixed(0) : value.toFixed(1))} ${unit}`
  }
  return `${bytes} 字节`
}

/** 按 1024 进位写：12 GiB、192 MiB。 */
export const binaryText = (bytes: number): string => scaled(bytes, BINARY)
/** 按 1000 进位写：12.9 GB、201 MB。 */
export const decimalText = (bytes: number): string => scaled(bytes, DECIMAL)

export interface MemoryFit {
  n: number
  /** 三个矩阵一共多少字节。 */
  bytes: number
  /** 占这张卡显存容量的比例（可能超过 1）。 */
  share: number
  fits: boolean
}

export function memoryFit(n: number, capacity: Capacity): MemoryFit {
  const bytes = matrixBytes(n)
  return { n, bytes, share: bytes / capacity.bytes, fits: bytes <= capacity.bytes }
}

/**
 * 一句话解读：三个矩阵多大（GiB 和 GB 各写一遍），这张卡放不放得下；你的卡再写占了几成（不到 1% 写「不到 1%」）。
 * 放得下只是和总量（或标称容量）比：真正能用的是 mem_get_info 报的空闲，正文在场景下面说。
 */
export function memoryText(fit: MemoryFit, gpu: Gpu): string {
  const size = `三个矩阵 ${binaryText(fit.bytes)}（${decimalText(fit.bytes)}）`
  const card = gpu.memory.exact ? '你这张卡的显存总量' : `产品页的 ${gpu.memory.text}`
  if (!fit.fits) return `${size}，超过了${card}：放不下，只能切成小块分批算。`
  if (!gpu.memory.exact) return `${size}，没超过${card}：按标称容量算放得下。`
  const percent = Math.round(fit.share * 100)
  return `${size}，占${card}的${percent < 1 ? '不到 1%' : ` ${percent}%`}：按总量算放得下。`
}
