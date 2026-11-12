/**
 * 一维启动的逻辑模拟：每个线程按读者写的规则算出下标 i，再决定写入、越界或跳过。
 *
 * 这里只回答「谁算了哪个数」，不模拟耗时。所有线程写入的值都是 a[i] + b[i]，
 * 所以同一个位置被写多次，结果依然正确，只是做了重复的工作。
 */
import { evaluate, type Expr, type Lang } from './expr.ts'

export interface LaunchConfig {
  /** 数据长度 */
  n: number
  /** 每组线程数 blockDim.x */
  blockDim: number
  /** 组数 gridDim.x */
  gridDim: number
  /** 是否加了 if (i < n) */
  guard: boolean
}

export type ThreadStatus = 'write' | 'oob' | 'skipped'

export interface ThreadResult {
  block: number
  thread: number
  index: number
  status: ThreadStatus
}

export interface Writer {
  block: number
  thread: number
}

export interface LaunchSummary {
  threads: number
  covered: number
  missing: number
  duplicates: number
  oobWrites: number
  skipped: number
  allCorrect: boolean
}

export type LaunchResult =
  | {
      ok: true
      threads: ThreadResult[]
      /** elements[i] 是写入 c[i] 的线程，0 ≤ i < n */
      elements: Writer[][]
      /** 写到数组外面的位置，按下标排序 */
      outside: Array<{ index: number; writers: Writer[] }>
      summary: LaunchSummary
    }
  | { ok: false; error: string; block: number; thread: number }

/** 覆盖 n 个元素至少需要的组数（向上取整）。 */
export function minBlocks(n: number, blockDim: number): number {
  return Math.ceil(n / blockDim)
}

export function simulate(expr: Expr, lang: Lang, cfg: LaunchConfig): LaunchResult {
  const threads: ThreadResult[] = []
  const elements: Writer[][] = Array.from({ length: cfg.n }, () => [])
  const outsideMap = new Map<number, Writer[]>()

  for (let block = 0; block < cfg.gridDim; block++) {
    for (let thread = 0; thread < cfg.blockDim; thread++) {
      const result = evaluate(
        expr,
        { 'blockIdx.x': block, 'blockDim.x': cfg.blockDim, 'threadIdx.x': thread, 'gridDim.x': cfg.gridDim, n: cfg.n },
        lang,
      )
      if (!result.ok) return { ok: false, error: result.error, block, thread }
      const index = result.value
      // 和真实代码一样，边界检查只写了 i < n；负数下标照样会越界。
      let status: ThreadStatus
      if (cfg.guard && !(index < cfg.n)) status = 'skipped'
      else if (index < 0 || index >= cfg.n) status = 'oob'
      else status = 'write'
      threads.push({ block, thread, index, status })
      if (status === 'write') elements[index].push({ block, thread })
      if (status === 'oob') {
        const list = outsideMap.get(index) ?? []
        list.push({ block, thread })
        outsideMap.set(index, list)
      }
    }
  }

  const covered = elements.filter(w => w.length > 0).length
  const outside = [...outsideMap.entries()].sort((a, b) => a[0] - b[0]).map(([index, writers]) => ({ index, writers }))
  return {
    ok: true,
    threads,
    elements,
    outside,
    summary: {
      threads: threads.length,
      covered,
      missing: cfg.n - covered,
      duplicates: elements.filter(w => w.length > 1).length,
      oobWrites: threads.filter(t => t.status === 'oob').length,
      skipped: threads.filter(t => t.status === 'skipped').length,
      allCorrect: covered === cfg.n,
    },
  }
}

/** 用读者能看懂的一句话描述结果，同时用作屏幕阅读器的播报。 */
export function describe(result: LaunchResult, n: number): string {
  if (!result.ok) return `运行出错：${result.error}`
  const s = result.summary
  const parts: string[] = []
  if (s.allCorrect) parts.push(`${n} 个数全部算对了`)
  else parts.push(`${n} 个数里算对了 ${s.covered} 个，还有 ${s.missing} 个没人算`)
  if (s.duplicates > 0) parts.push(`${s.duplicates} 个数被重复计算`)
  if (s.oobWrites > 0) parts.push(`${s.oobWrites} 个线程写到了数组外面`)
  if (s.skipped > 0) parts.push(`${s.skipped} 个线程检查后跳过`)
  return parts.join('；') + '。'
}
