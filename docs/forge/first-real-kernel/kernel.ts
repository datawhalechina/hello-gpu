/**
 * 2-2 第一个真 kernel：三段探索里的数（纯函数，单测在 scripts/tests/forge-first-real-kernel.test.mjs）。
 * 解读的句子写在各个场景里，这里只算数。
 *
 * 三段探索和实验室 Notebook「动手」的三段一一对应：编译、运行、校验。
 * - 编译（ThreadTile）：同样一块元素，HIP 一个线程算一个，组大小就是线程数，一组通常最多 1024 个线程
 *   （HIP 编程模型文档 Hierarchical thread model 一节；hello_gpu 启动前按这张卡的 hipDeviceAttributeMaxThreadsPerBlock 查）。
 *   Triton 一个 program 算一整块 tile，线程数是 num_warps × wave 大小：Triton 3.8.0 的 AMD 后端默认 num_warps = 4，
 *   gfx10 及以后按 wave 32 编译，更早的按 64（third_party/amd/backend/compiler.py 的 HIPOptions）。
 * - 运行（HostSteps）：主机端五步。同一个队列（stream）里的活按排队的顺序做；启动一交出去就返回；
 *   主机和显存之间的拷贝要等前面排着的活做完、自己也拷完才返回（HIP 文档 Asynchronous concurrent execution，
 *   PyTorch 文档 Asynchronous execution）。时间线的长短是示意，不是实测。
 * - 校验（GuardCheck）：Notebook 的 7 个长度；HIP 每组 256 个线程（hello_gpu 的 %%hip 默认 block），Triton 每块
 *   1024 个元素（Notebook 里 vector_add 的默认 block）。派出去的位置 = 组数向上取整 × 组大小；没写边界检查时，
 *   多出来的位置都写进输出后面的护栏，个数就是 hg.check 报的「输出后面 N 个位置被改写了」（hello_gpu lab.py 的
 *   _fence_problem）。护栏每边 GUARD_ELEMENTS 个元素，比哪条路线的一组都大，越界写都落在护栏里。
 */

export const STAGE_ID = 'forge-first-real-kernel'

// ── 探索一：编译（一个线程，还是一块 tile）──────────────────────────────────

/** HIP 一组线程数的常见上限（HIP 编程模型文档：Maximum threads per block: typically 1024）。 */
export const HIP_MAX_THREADS = 1024
/** Triton 3.8.0 的 AMD 后端默认的 num_warps：一个 program 由几个 wave 一起执行。 */
export const TRITON_NUM_WARPS = 4
/** 本书的卡（gfx1201，RDNA 4）上 HIP 和 Triton 默认的 wave 大小。 */
export const BOOK_WAVE = 32
/** 旋钮的选项：一组 / 一块管几个元素。都是 2 的幂（Triton 的 tl.arange 要求块的大小是 2 的幂）。 */
export const TILE_OPTIONS = [256, 1024, 4096] as const
/** 默认 1024：Notebook 里 Triton 版的块大小，也正好是 HIP 一组的上限。 */
export const TILE_DEFAULT = 1024

/**
 * 这张卡默认按多大的 wave 编译：gfx 代号的主版本（去掉 gfx 和最后两位）是 10 及以上的按 32，更早的按 64。
 * Triton 的 AMD 后端照这条规则定 warp_size（HIPOptions.__post_init__），HIP 的 warpSize 也是 gfx10 起为 32。
 * 读不出主版本（写法不对）时返回 null，由调用方按本书的卡算。
 */
export function waveOf(gfx: string): 32 | 64 | null {
  const match = /^gfx(\d+)[0-9a-f]{2}$/.exec(gfx)
  if (!match) return null
  return Number(match[1]) >= 10 ? 32 : 64
}

export interface TileSplit {
  /** 一组 / 一块管几个元素。 */
  elements: number
  /** 按多大的 wave 算：本书的卡是 32，导入了 GPU 卡片就用你的卡的。 */
  wave: number
  /** HIP：一个线程算一个元素，要派 elements 个线程；超过上限就派不出去。 */
  hip: { threads: number; waves: number; fits: boolean }
  /** Triton：一个 program 的线程数和块的大小无关，每个线程分 elements ÷ threads 个元素。 */
  triton: { threads: number; waves: number; perThread: number }
}

/** 同样一块元素，两条路线各派几个线程。 */
export function tileSplit(elements: number, wave: number = BOOK_WAVE): TileSplit {
  if (!Number.isInteger(elements) || elements <= 0) throw new Error(`块的大小要是正整数，现在是 ${elements}`)
  if (wave !== 32 && wave !== 64) throw new Error(`wave 大小只有 32 和 64 两种，现在是 ${wave}`)
  const threads = TRITON_NUM_WARPS * wave
  return {
    elements,
    wave,
    hip: { threads: elements, waves: Math.ceil(elements / wave), fits: elements <= HIP_MAX_THREADS },
    triton: { threads, waves: TRITON_NUM_WARPS, perThread: elements / threads },
  }
}

// ── 探索二：运行（主机端五步）────────────────────────────────────────────────

export type StepId = 'alloc' | 'copyIn' | 'launch' | 'sync' | 'copyOut'

export interface HostStep {
  id: StepId
  /** ①–⑤，和 Notebook「运行」那一段的注释一样。 */
  mark: string
  name: string
  /** 旋钮按钮上的两个字。 */
  short: string
  /** 对应的 HIP 运行时写法。 */
  hip: string
  /** Notebook 里的那一行（PyTorch）；③ 两条路线不一样，见 LAUNCH_LINES。 */
  torch: string
}

export const HOST_STEPS: readonly HostStep[] = [
  { id: 'alloc', mark: '①', name: '申请显存', short: '申请', hip: 'hipMalloc', torch: 'd_a = torch.empty(n, device="cuda")' },
  { id: 'copyIn', mark: '②', name: '拷进显存', short: '拷进', hip: 'hipMemcpy（主机 → 设备）', torch: 'd_a.copy_(h_a)' },
  { id: 'launch', mark: '③', name: '启动', short: '启动', hip: 'vector_add<<<组数, 256>>>', torch: '' },
  { id: 'sync', mark: '④', name: '等 GPU 算完', short: '同步', hip: 'hipDeviceSynchronize', torch: 'torch.cuda.synchronize()' },
  { id: 'copyOut', mark: '⑤', name: '拷回主机', short: '拷回', hip: 'hipMemcpy（设备 → 主机）', torch: 'h_out = d_out.cpu()' },
]

/** ③ 在 Notebook 里的写法：两条路线不一样。 */
export const LAUNCH_LINES = {
  hip: 'vector_add(d_a, d_b, out=d_out)',
  triton: 'add_kernel[grid](d_a, d_b, d_out, n, BLOCK=1024)',
} as const

/** 这一趟走哪几步：去掉 ④ 时只剩四步。 */
export function hostSteps(withSync: boolean): HostStep[] {
  return HOST_STEPS.filter((s) => withSync || s.id !== 'sync')
}

/** 时间线上的三条道。 */
export type Lane = 'cpu' | 'copy' | 'gpu'
export type SegmentKind = 'run' | 'wait' | 'copy' | 'compute'

export interface Segment {
  lane: Lane
  /** 哪一步排的活。 */
  step: StepId
  kind: SegmentKind
  /** 示意的时刻，单位随意，只看先后和长短关系。 */
  start: number
  end: number
}

/** 示意的长短：申请、启动很短，拷贝和计算长一些。不是实测。 */
const SPAN = { alloc: 1, launch: 0.5, copyIn: 3, compute: 5.5, copyOut: 1.5 } as const

/**
 * 五步的时间线（示意）。规则：
 * - ① 申请显存：CPU 做完就往下走。
 * - ② 拷进显存：数据在拷贝道上搬，CPU 一直等到拷完才返回。
 * - ③ 启动：CPU 只花一点时间把 kernel 排进队列就返回，GPU 这时才开始算。
 * - ④ 同步：CPU 停下来等，直到 GPU 算完。
 * - ⑤ 拷回：拷贝排在 kernel 后面，先等 kernel 算完再搬，CPU 等到拷完。去掉 ④ 时，CPU 在 ⑤ 里替它等。
 */
export function hostTimeline(withSync: boolean): Segment[] {
  const segments: Segment[] = []
  let t = 0
  segments.push({ lane: 'cpu', step: 'alloc', kind: 'run', start: t, end: t + SPAN.alloc })
  t += SPAN.alloc
  segments.push({ lane: 'copy', step: 'copyIn', kind: 'copy', start: t, end: t + SPAN.copyIn })
  segments.push({ lane: 'cpu', step: 'copyIn', kind: 'wait', start: t, end: t + SPAN.copyIn })
  t += SPAN.copyIn
  segments.push({ lane: 'cpu', step: 'launch', kind: 'run', start: t, end: t + SPAN.launch })
  t += SPAN.launch
  const computeEnd = t + SPAN.compute
  segments.push({ lane: 'gpu', step: 'launch', kind: 'compute', start: t, end: computeEnd })
  if (withSync) {
    segments.push({ lane: 'cpu', step: 'sync', kind: 'wait', start: t, end: computeEnd })
    t = computeEnd
  }
  // ⑤：CPU 从这里开始等；拷贝要等 kernel 算完才开始。
  const copyStart = Math.max(t, computeEnd)
  segments.push({ lane: 'cpu', step: 'copyOut', kind: 'wait', start: t, end: copyStart + SPAN.copyOut })
  segments.push({ lane: 'copy', step: 'copyOut', kind: 'copy', start: copyStart, end: copyStart + SPAN.copyOut })
  return segments
}

/** 一块数组在某一步之后的样子：还没申请、申请了但没有数、有输入、GPU 还在算、算好的结果。 */
export type BufferState = 'none' | 'empty' | 'data' | 'pending' | 'result'

export interface HostState {
  host: { h_a: BufferState; h_b: BufferState; h_out: BufferState }
  device: { d_a: BufferState; d_b: BufferState; d_out: BufferState }
  /** 这一步做完、CPU 往下走的时候，GPU 算完了没有。 */
  gpuDone: boolean
}

/** 走到第 step 步（做完这一步，CPU 正要往下走）时，数据在哪、GPU 算完了没有。 */
export function hostState(step: StepId, withSync: boolean): HostState {
  const order = hostSteps(withSync).map((s) => s.id)
  const at = order.indexOf(step)
  if (at < 0) throw new Error(`去掉 ④ 以后没有 ${step} 这一步`)
  const done = (id: StepId) => order.includes(id) && order.indexOf(id) <= at
  // 能往下走就说明等过了：④ 显式地等，或者 ⑤ 的拷贝先等 kernel 算完。
  const gpuDone = done('sync') || done('copyOut')
  const input: BufferState = done('copyIn') ? 'data' : done('alloc') ? 'empty' : 'none'
  const output: BufferState = gpuDone ? 'result' : done('launch') ? 'pending' : done('alloc') ? 'empty' : 'none'
  return {
    host: { h_a: 'data', h_b: 'data', h_out: done('copyOut') ? 'result' : 'none' },
    device: { d_a: input, d_b: input, d_out: output },
    gpuDone,
  }
}

// ── 探索三：校验（多种长度 + 护栏）──────────────────────────────────────────

/** Notebook「校验」一段的 7 个长度：有组大小的整数倍，也有多一点、少一点的。 */
export const CHECK_LENGTHS = [1, 255, 256, 1000, 1024, 2 ** 20, 2 ** 20 + 1] as const
/** 写成幂的两个长度；其余照写数字。 */
export const LENGTH_LABELS: Readonly<Record<number, string>> = { [2 ** 20]: '2²⁰', [2 ** 20 + 1]: '2²⁰ + 1' }
/** 默认 1000：热身那道题的长度。 */
export const LENGTH_DEFAULT = 1000
/** hg.check(guard=True) 在输出前后各留的护栏（hello_gpu lab.py 的 GUARD_ELEMENTS = 1 << 16）。 */
export const GUARD_ELEMENTS = 2 ** 16

export interface RouteGroup {
  route: 'hip' | 'triton'
  name: string
  /** 一组派出去几个位置：HIP 每组的线程数，Triton 每块的元素数。 */
  group: number
  /** 「组」还是「块」。 */
  unit: string
  /** 表头和图上写的样子。 */
  label: string
}

export const ROUTE_GROUPS: readonly RouteGroup[] = [
  { route: 'hip', name: 'HIP', group: 256, unit: '组', label: '每组 256 个线程' },
  { route: 'triton', name: 'Triton', group: 1024, unit: '块', label: '每块 1024 个元素' },
]

export interface CheckCase {
  n: number
  group: number
  /** 派了几组（块）：向上取整。 */
  groups: number
  /** 一共派出去几个位置。 */
  launched: number
  /** 最后一组多出来的位置。 */
  extra: number
  /** 写到输出外面（护栏里）的位置：写了边界检查就是 0。 */
  oob: number
  passed: boolean
}

/** 一个长度、一种组大小，写没写边界检查：派出去几个位置、写到外面几个。 */
export function checkCase(n: number, group: number, bounded: boolean): CheckCase {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`长度要是正整数，现在是 ${n}`)
  if (!Number.isInteger(group) || group <= 0) throw new Error(`组大小要是正整数，现在是 ${group}`)
  const groups = Math.ceil(n / group)
  const launched = groups * group
  const extra = launched - n
  const oob = bounded ? 0 : extra
  return { n, group, groups, launched, extra, oob, passed: oob === 0 }
}

/** 7 个长度全部校验一遍，同 hg.check 的「通过 x/7」。 */
export function checkReport(group: number, bounded: boolean) {
  const cases = CHECK_LENGTHS.map((n) => checkCase(n, group, bounded))
  return { cases, passed: cases.filter((c) => c.passed).length, total: cases.length }
}
