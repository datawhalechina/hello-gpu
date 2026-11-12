/**
 * 迷你关卡（组件测试样例）的模拟和星级判定。纯函数，单测在
 * scripts/tests/kit-stage-challenge.test.mjs（06 第 7 节：judge 是纯函数，单测覆盖每颗星）。
 *
 * 题面借用试点关卡（NV-04 已迁成正式的 1-4，docs/novice/thread-groups/）：给线程分组、算出全局下标、加上边界检查。
 * 这一关的参数都是旋钮选出来的（拿数的规则是三选一，不是手写代码），所以自带一个很小的模拟，
 * 不依赖表达式解析器；真正的代码沙盒是任务 S-05 的 Sandbox，线程网格是 S-06 的 RobotGrid。
 *
 * 星级标准（03 第 1 节第 6 条，关卡开头公示）：
 * ★1 结果正确；★2 没有线程写到数组外面；★3 组数最少，而且换一种每组人数规则照样成立。
 */

/** 这一关对应大纲里的关卡 id；演示页只写演示存档，不碰真实进度。 */
export const STAGE_ID = 'novice-thread-groups'

/** 挑战的数据长度。 */
export const CHALLENGE_N = 13

/** 拿数的规则：三选一。 */
export type Formula = 'tid' | 'block' | 'global'

export const FORMULA_CODE: Record<Formula, string> = {
  tid: 'threadIdx.x',
  block: 'blockIdx.x * blockDim.x',
  global: 'blockIdx.x * blockDim.x + threadIdx.x',
}

export interface Config {
  /** 要算的数有几个。 */
  n: number
  /** 每组人数 blockDim.x。 */
  blockDim: number
  /** 组数 gridDim.x。 */
  gridDim: number
  formula: Formula
  /** 加没加边界检查 if (i < n)。 */
  guard: boolean
}

/** 一个线程的去向，对应 ThreadBot 的五种状态里的四种。 */
export type ThreadState = 'write' | 'dup' | 'oob' | 'skip'

export interface ThreadInfo {
  /** 派出的第几个线程（0 起）。 */
  t: number
  /** 在第几组 blockIdx.x。 */
  block: number
  /** 在组里排第几 threadIdx.x。 */
  lane: number
  /** 这个线程算出来的下标 i。 */
  index: number
  state: ThreadState
}

export interface RunResult {
  threads: ThreadInfo[]
  /** 每个格子被写了几次：0 没人写，1 正好，2 以上是重复计算。 */
  writers: number[]
  /** 有人写的格子数。 */
  covered: number
  /** 没人算的格子数。 */
  missing: number
  /** 被写了不止一次的格子数。 */
  duplicates: number
  /** 写到数组外面的线程数。 */
  oob: number
  /** 边界检查拦下的线程数。 */
  skipped: number
  /** 每个格子都恰好被写一次。 */
  allCorrect: boolean
}

/** 按规则算出一个线程的下标。 */
export function indexOf(formula: Formula, block: number, lane: number, blockDim: number): number {
  if (formula === 'tid') return lane
  if (formula === 'block') return block * blockDim
  return block * blockDim + lane
}

/** 组数的下限：向上取整，不够一组也得派一组。 */
export function minBlocks(n: number, blockDim: number): number {
  return blockDim > 0 ? Math.ceil(n / blockDim) : 0
}

/** 跑一次：每个线程算出自己的下标，写进数组或者被边界检查拦下。 */
export function run(cfg: Config): RunResult {
  const writers = new Array<number>(Math.max(0, cfg.n)).fill(0)
  const threads: ThreadInfo[] = []
  for (let block = 0; block < cfg.gridDim; block += 1) {
    for (let lane = 0; lane < cfg.blockDim; lane += 1) {
      const index = indexOf(cfg.formula, block, lane, cfg.blockDim)
      const inside = index >= 0 && index < cfg.n
      if (inside) writers[index] += 1
      threads.push({ t: threads.length, block, lane, index, state: inside ? 'write' : cfg.guard ? 'skip' : 'oob' })
    }
  }
  // 同一个格子被写了不止一次：这些线程标成「重复计算」，谁的结果留下来并不确定。
  for (const thread of threads) {
    if (thread.state === 'write' && writers[thread.index] > 1) thread.state = 'dup'
  }
  const covered = writers.filter((w) => w > 0).length
  const duplicates = writers.filter((w) => w > 1).length
  return {
    threads,
    writers,
    covered,
    missing: Math.max(0, cfg.n - covered),
    duplicates,
    oob: threads.filter((t) => t.state === 'oob').length,
    skipped: threads.filter((t) => t.state === 'skip').length,
    allCorrect: covered === cfg.n && duplicates === 0,
  }
}

/** 动手环节的一句话解读（03 第 1 节第 4 条：参数一变就给可视化和一句解读）。 */
export function describe(cfg: Config, result: RunResult = run(cfg)): string {
  const sent = `派出 ${result.threads.length} 个线程算 ${cfg.n} 个数`
  const parts: string[] = []
  if (result.missing > 0) parts.push(`还有 ${result.missing} 个数没人算`)
  if (result.duplicates > 0) parts.push(`${result.duplicates} 个数被不止一个线程写`)
  if (result.oob > 0) parts.push(`${result.oob} 个线程写到了数组外面`)
  if (result.skipped > 0) parts.push(`${result.skipped} 个线程被边界检查拦下，什么也没做`)
  if (!parts.length) return `${sent}：每个数都正好有一个线程算，没有人越界。`
  return `${sent}：${parts.join('，')}。`
}

export const STAR_LABELS = [
  `${CHALLENGE_N} 个结果都算对`,
  '没有线程写到数组外面',
  '派出的组数最少，换一种每组人数也照样成立',
] as const

/** ★3 要试的其他「每组人数」。 */
export const ALT_BLOCK_DIMS = [2, 4, 8] as const

/** 03 第 4 节：没过时写成「现象 + 原因 + 怎么改」。 */
export interface Problem {
  symptom: string
  cause: string
  fix: string
  raw?: string
}

export interface Verdict {
  earned: [boolean, boolean, boolean]
  /** 下一颗星还差什么；三颗都拿到时是一句收尾的话。 */
  next: string
  error?: Problem
}

/** 结果不对时，按选的规则说清哪里错、为什么、怎么改。 */
function explain(cfg: Config, result: RunResult): Problem {
  if (cfg.formula === 'tid') {
    return {
      symptom: `只有 c[0]～c[${cfg.blockDim - 1}] 被写到，后面的位置一直空着。`,
      cause: 'threadIdx.x 在每一组里都从 0 开始数，几组线程算出的是同一批下标。',
      fix: '把前面各组的人数加进去：blockIdx.x * blockDim.x + threadIdx.x。',
      raw: `block 0 和 block 1 的 thread 0 都写了 c[0]（共 ${result.duplicates} 个格子被重复写）`,
    }
  }
  if (cfg.formula === 'block') {
    return {
      symptom: `每组只写到一个位置：c[0]、c[${cfg.blockDim}]……其余都空着。`,
      cause: '同一组的线程算出的下标一模一样，组里的人互相覆盖。',
      fix: '再加上自己在组里的编号 threadIdx.x。',
      raw: `block 0：thread 0～${cfg.blockDim - 1} 全部写入 c[0]`,
    }
  }
  return {
    symptom: `还有 ${result.missing} 个数没人算：c[${cfg.n - result.missing}] 以后都是空的。`,
    cause: `规则对了，但只派出 ${result.threads.length} 个线程，盖不住 ${cfg.n} 个数。`,
    fix: `组数要向上取整：(n + blockDim − 1) / blockDim，这里是 ${minBlocks(cfg.n, cfg.blockDim)} 组。`,
  }
}

/**
 * 星级判定（06 第 7 节）：输入读者的配置，输出三颗星各自成立没有和下一步的一句话。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」。
 */
export function judge(cfg: Config, altBlockDims: readonly number[] = ALT_BLOCK_DIMS): Verdict {
  const result = run(cfg)

  if (!result.allCorrect) {
    const error = explain(cfg, result)
    return { earned: [false, false, false], next: error.fix, error }
  }

  if (result.oob > 0) {
    return {
      earned: [true, false, false],
      next: `派出了 ${result.threads.length} 个线程，多出来的 ${result.oob} 个写到了数组外面：加上边界检查 if (i < n)。`,
    }
  }

  const fewest = minBlocks(cfg.n, cfg.blockDim)
  if (cfg.gridDim > fewest) {
    return {
      earned: [true, true, false],
      next: `组数还能更少：每组 ${cfg.blockDim} 个，${fewest} 组就够了。`,
    }
  }

  for (const blockDim of altBlockDims) {
    if (blockDim === cfg.blockDim) continue
    const alt = run({ ...cfg, blockDim, gridDim: minBlocks(cfg.n, blockDim) })
    if (!alt.allCorrect || alt.oob > 0) {
      return {
        earned: [true, true, false],
        next: `把每组人数换成 ${blockDim}，你的规则就不成立了：是不是把人数写死了，或者少了边界检查？`,
      }
    }
  }

  return { earned: [true, true, true], next: '三颗星的标准都达到了。' }
}
