/**
 * 模拟器 L3：访存模型（08 第 2、5 节）。
 *
 * 读 L2 的事件流（lockstep.ts 的 SimEvent），回答「一个 wave 的一次访存要搬几车（cache line）」，
 * 以及 LDS 的 bank 冲突。参数默认取 params.ts 的 SIM_PARAMS，都是示意值，算出来的数界面上标注「模拟」。
 * 一次访存就是一个带 space 的事件（load / store / atomic）：一个 wave 的活跃 lane 在同一步访问同一个数组，
 * addrs 是每个活跃 lane 要的元素下标。
 *
 * 显存（analyzeMemory，只看 space 为 global 的事件）：
 * - 每个数组从一车的开头放起。第 i 个元素占第 i × elemBytes 到 (i + 1) × elemBytes − 1 个字节，
 *   第 k 车装第 k × lineBytes 到 (k + 1) × lineBytes − 1 个字节。
 * - 车次（事务数）= 这次访存碰到的不同车的个数：同一车里的元素一趟搬完，不管几个 lane 要、按什么顺序要。
 * - 理想车次 = 把要的不同元素从一车的开头紧挨着放，最少要几车：⌈不同元素个数 × elemBytes ÷ lineBytes⌉。
 *   几个 lane 要同一个元素（广播）只算一个。效率 = 理想车次 ÷ 车次，1 表示一车都没多搬。
 * - 每次访存单独算，不模拟缓存：前一次搬过的车不会留下来给后一次用。
 * - 越界的下标照样算（事件里没有数组长度，越界由 L2 的诊断报告）；负的下标落在第 −1、−2 … 车。
 *
 * LDS（analyzeLdsBanks，只看 space 为 lds 的事件）：
 * - 每个共享数组从第 0 个 bank 放起。第 w 个字（bankBytes 字节）在第 w % banks 个 bank。
 * - 一轮里每个 bank 只能处理一个请求。读、写时几个 lane 要同一个字只算一个请求（一起拿到）；
 *   原子加每个 lane 都是一个请求，同一个字上的也要一个一个加。
 * - 轮数 = 请求最多的那个 bank 上的请求数；理想轮数 = ⌈请求数 ÷ banks⌉，也就是请求平均摊到每个 bank 上。
 *   比理想多出来的轮数是 bank 冲突造成的。请求数不超过 bank 数时理想轮数是 1，轮数就是常说的「n 路冲突」的 n。
 *   效率 = 理想轮数 ÷ 轮数。
 */
import type { SimEvent } from './lockstep.ts'
import { SIM_PARAMS } from './params.ts'

export interface MemoryOptions {
  /** 一车多少字节，默认 SIM_PARAMS.lineBytes */
  lineBytes?: number
  /** 一个元素多少字节，默认 SIM_PARAMS.elemBytes */
  elemBytes?: number
}

export interface LdsOptions {
  /** 多少个 bank，默认 SIM_PARAMS.banks */
  banks?: number
  /** 一个 bank 一次读写多少字节，默认 SIM_PARAMS.bankBytes */
  bankBytes?: number
  /** 一个元素多少字节，默认 SIM_PARAMS.elemBytes */
  elemBytes?: number
}

/** 显存的一次访存。 */
export interface MemoryAccess {
  /** 这个事件在传进来的 events 里的位置 */
  event: number
  /** 参与的 lane 数 */
  lanes: number
  /** 要的不同元素个数 */
  elements: number
  /** 碰到的车的编号，从小到大、不重复 */
  cacheLines: number[]
  /** 车次（事务数），等于 cacheLines 的个数 */
  transactions: number
  /** 理想车次 */
  ideal: number
  /** 理想车次 ÷ 车次 */
  efficiency: number
}

export interface MemoryReport {
  /** 显存的每次访存，按事件的顺序 */
  accesses: MemoryAccess[]
  /** 所有访存加起来；一次访存都没有时效率记 1 */
  summary: { transactions: number; ideal: number; efficiency: number }
}

/** LDS 的一次访问。 */
export interface LdsAccess {
  /** 这个事件在传进来的 events 里的位置 */
  event: number
  /** 参与的 lane 数 */
  lanes: number
  /** 请求数：读、写时同一个字算一个，原子加每个 lane 算一个 */
  requests: number
  /** 轮数：请求最多的那个 bank 上的请求数 */
  passes: number
  /** 理想轮数 */
  ideal: number
  /** 理想轮数 ÷ 轮数 */
  efficiency: number
}

export interface LdsReport {
  /** LDS 的每次访问，按事件的顺序 */
  accesses: LdsAccess[]
  /** 所有访问加起来；一次访问都没有时效率记 1 */
  summary: { passes: number; ideal: number; efficiency: number }
}

/** 显存：每次访存搬几车、理想几车，以及汇总。 */
export function analyzeMemory(events: readonly SimEvent[], options: MemoryOptions = {}): MemoryReport {
  const lineBytes = positive('lineBytes', options.lineBytes ?? SIM_PARAMS.lineBytes)
  const elemBytes = positive('elemBytes', options.elemBytes ?? SIM_PARAMS.elemBytes)
  const accesses: MemoryAccess[] = []
  let totalTransactions = 0
  let totalIdeal = 0
  events.forEach((e, event) => {
    if (e.space !== 'global') return
    const addrs = e.addrs ?? []
    // 下标从小到大走一遍：数不同的元素，同时按顺序记下碰到的车（元素跨车时每一车都记）
    const sorted = sortedCopy(addrs)
    const cacheLines: number[] = []
    let elements = 0
    /** 下一辆还没记过的车 */
    let next = -Infinity
    for (let k = 0; k < sorted.length; k++) {
      const i = sorted[k]
      if (k > 0 && i === sorted[k - 1]) continue
      elements++
      const first = Math.floor((i * elemBytes) / lineBytes)
      const last = Math.floor((i * elemBytes + elemBytes - 1) / lineBytes)
      for (let line = Math.max(first, next); line <= last; line++) cacheLines.push(line)
      next = last + 1
    }
    const transactions = cacheLines.length
    const ideal = Math.ceil((elements * elemBytes) / lineBytes)
    accesses.push({ event, lanes: addrs.length, elements, cacheLines, transactions, ideal, efficiency: ratio(ideal, transactions) })
    totalTransactions += transactions
    totalIdeal += ideal
  })
  return { accesses, summary: { transactions: totalTransactions, ideal: totalIdeal, efficiency: ratio(totalIdeal, totalTransactions) } }
}

/** LDS：每次访问要几轮、理想几轮（bank 冲突），以及汇总。 */
export function analyzeLdsBanks(events: readonly SimEvent[], options: LdsOptions = {}): LdsReport {
  const banks = positive('banks', options.banks ?? SIM_PARAMS.banks)
  const bankBytes = positive('bankBytes', options.bankBytes ?? SIM_PARAMS.bankBytes)
  const elemBytes = positive('elemBytes', options.elemBytes ?? SIM_PARAMS.elemBytes)
  /** 每个 bank 上的请求数，每次访问重新数 */
  const perBank = new Int32Array(banks)
  const accesses: LdsAccess[] = []
  let totalPasses = 0
  let totalIdeal = 0
  events.forEach((e, event) => {
    if (e.space !== 'lds') return
    const addrs = e.addrs ?? []
    perBank.fill(0)
    let requests = 0
    // 读、写：下标从小到大走一遍，同一个字只请求一次；原子加不合并，每个 lane 要的每个字都是一个请求。
    // 元素比一个字大时占好几个字，每个字都要请求
    const atomic = e.op === 'atomic'
    const list = atomic ? addrs : sortedCopy(addrs)
    /** 下一个还没请求过的字（只在读、写时用） */
    let next = -Infinity
    for (let k = 0; k < list.length; k++) {
      const i = list[k]
      const first = Math.floor((i * elemBytes) / bankBytes)
      const last = Math.floor((i * elemBytes + elemBytes - 1) / bankBytes)
      for (let w = atomic ? first : Math.max(first, next); w <= last; w++) {
        perBank[((w % banks) + banks) % banks]++
        requests++
      }
      next = last + 1
    }
    let passes = 0
    for (let b = 0; b < banks; b++) if (perBank[b] > passes) passes = perBank[b]
    const ideal = Math.ceil(requests / banks)
    accesses.push({ event, lanes: addrs.length, requests, passes, ideal, efficiency: ratio(ideal, passes) })
    totalPasses += passes
    totalIdeal += ideal
  })
  return { accesses, summary: { passes: totalPasses, ideal: totalIdeal, efficiency: ratio(totalIdeal, totalPasses) } }
}

/** 参数要是正整数：这是调用方的错，不是读者代码的错，直接抛出。 */
function positive(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} 要是正整数，收到的是 ${String(value)}。`)
  return value
}

/** 排序用的缓冲区，反复使用，免得每次访存都新建数组。 */
let scratch = new Float64Array(0)

/** addrs 从小到大排好的副本。放在共用的缓冲区里，下一次调用就会被覆盖。 */
function sortedCopy(addrs: readonly number[]): Float64Array {
  if (addrs.length > scratch.length) scratch = new Float64Array(addrs.length)
  const s = scratch.subarray(0, addrs.length)
  s.set(addrs)
  return s.sort()
}

/** 理想 ÷ 实际；实际是 0（没有访存）时记 1：没有搬运，也就没有浪费。 */
function ratio(ideal: number, actual: number): number {
  return actual === 0 ? 1 : ideal / actual
}
