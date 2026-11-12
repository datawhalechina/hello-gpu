/**
 * 1-4 线程分组：代码、数据和判定（纯函数，单测在 scripts/tests/novice-thread-groups.test.mjs）。
 *
 * 题目和星级标准沿用试点关卡（NV-04 之前放在预览页下的 1-4），交互换成模拟器（L2 锁步解释器）：
 * - 探索一：每个线程都按 i = threadIdx.x 拿数，旋钮调每组几个线程、派几组（kernelSource 写死的代码）。
 * - 探索二：读者在沙盒里写出拿数的规则 i = ?（judgeRule；探索环节，不发星）。
 * - 探索三：规则已经对了，开关边界检查 if (i < n)，看多出来的线程做什么。
 * - 挑战：13 对数。旋钮定每组几个线程、派几组，沙盒里补 i 和写入前的条件。
 *   ★1 13 个数都算对；★2 没有任何线程写到数组外面；★3 组数最少，而且换一种每组线程数，代码照样成立
 *   （Sandbox 的 variants 换成另外两种每组线程数、组数取刚好够用，再跑一次）。
 * 判的都是代码在模拟器里真正跑出来的结果，两种写法的结果一样。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, type Launch, type SandboxRun } from '../../components/kit/sandbox/run.ts'

/** 这一关在大纲里的 id，也是试点存档迁过来时挂的关卡（docs/course/progress.ts 的 PILOT_STAGE_ID）。 */
export const STAGE_ID = 'novice-thread-groups'

/** 全局下标：前面各组的线程数，加上自己在组里排第几。 */
export const GLOBAL_INDEX = 'blockIdx.x * blockDim.x + threadIdx.x'

// ── 数据 ─────────────────────────────────────────────────────────────────

/**
 * n 对数：a[k] = k + 1，b[k] = 10 × (k + 1)，c 一开始全是 0。算对时 c[k] = 11 × (k + 1)，
 * 每个都不是 0，没人算的格子一眼就看得出来（同 1-3）。
 */
export function addArgs(n: number): Record<string, Arg> {
  const a = Array.from({ length: n }, (_, k) => k + 1)
  return {
    a: { type: 'float', data: a },
    b: { type: 'float', data: a.map((v) => 10 * v) },
    c: { type: 'float', data: new Array<number>(n).fill(0) },
    n: { type: 'int', value: n },
  }
}

/** 每组几个线程的可选值，也是 ★3 要换着试的那几种。 */
export const BLOCK_DIMS = [2, 4, 8] as const

/** 组数向上取整：不够一组也得派一组。 */
export function minBlocks(n: number, blockDim: number): number {
  return Math.ceil(n / blockDim)
}

// ── 探索：10 对数 ────────────────────────────────────────────────────────

/** 探索一到三的数据个数，和热身「先猜」里说的一样。 */
export const EXPLORE_N = 10
export const EXPLORE_GRID_MAX = 6
/** 探索的启动：3 组 × 每组 4 个，热身里算出来的派法。 */
export const EXPLORE_LAUNCH: Launch = { grid: 3, block: 4 }

/**
 * 探索一、三的工作单：拿数的规则写成 index，guard 决定加不加边界检查。
 * 和 1-3 一样，kernel 的参数不写 const（1-3 的完成记录）。
 */
export function kernelSource(lang: Lang, index: string, guard: boolean): string {
  if (lang === 'python') {
    const body = guard ? '    if i < n:\n        c[i] = a[i] + b[i]' : '    c[i] = a[i] + b[i]'
    return `@kernel\ndef add(a, b, c, n):\n    i = ${index}\n${body}`
  }
  const body = guard ? '    if (i < n) {\n        c[i] = a[i] + b[i];\n    }' : '    c[i] = a[i] + b[i];'
  return `__global__ void add(float* a, float* b, float* c, int n) {\n    int i = ${index};\n${body}\n}`
}

/** 探索二：读者写出拿数的规则。初始内容沿用探索一的 threadIdx.x，「能跑但不好」（03 第 1 节第 3 条）。 */
export const RULE_CODE: Record<Lang, string> = {
  hip: `__global__ void add(float* a, float* b, float* c, int n) {
    int i = [[i: threadIdx.x]];
    c[i] = a[i] + b[i];
}`,
  python: `@kernel
def add(a, b, c, n):
    i = [[i: threadIdx.x]]
    c[i] = a[i] + b[i]`,
}

/** 手机上的选项：每组都从 0 数起、忘了乘每组线程数、对的那一项、把每组线程数写死。两种写法一样。 */
export const RULE_BLANKS = {
  i: { label: '下标 i', choices: ['threadIdx.x', 'blockIdx.x + threadIdx.x', GLOBAL_INDEX, 'blockIdx.x * 4 + threadIdx.x'] },
}

export const RULE_HINTS: Hints = {
  direction: '想一想：第 1 组里排第 0 的线程，前面已经有几个线程了？',
  location: '前面有 blockIdx.x 个完整的组，每组 blockDim.x 个线程。再加上自己在组里的位置 threadIdx.x。',
  answer: `i 写成 ${GLOBAL_INDEX}。`,
}

// ── 挑战：13 对数 ────────────────────────────────────────────────────────

export const CHALLENGE_N = 13
export const CHALLENGE_GRID_MAX = 8
/** 挑战的默认启动「能跑但不好」：2 组 × 每组 4 个，8 个线程不够 13 个数（同试点）。 */
export const CHALLENGE_LAUNCH: Launch = { grid: 2, block: 4 }

/** 初始内容：每组都从 0 开始拿数，写入前也不检查（同 /preview/kit/ 的沙盒演示）。 */
export const CHALLENGE_CODE: Record<Lang, string> = {
  hip: `__global__ void add(float* a, float* b, float* c, int n) {
    int i = [[i: threadIdx.x]];
    if ([[guard: true]]) {
        c[i] = a[i] + b[i];
    }
}`,
  python: `@kernel
def add(a, b, c, n):
    i = [[i: threadIdx.x]]
    if [[guard: True]]:
        c[i] = a[i] + b[i]`,
}

/** 手机上的选项：下标多一项「只用组的编号」，条件多一项差一个的 i <= n。 */
export const CHALLENGE_BLANKS = {
  i: { label: '下标 i', choices: ['threadIdx.x', 'blockIdx.x * blockDim.x', GLOBAL_INDEX, 'blockIdx.x * 4 + threadIdx.x'] },
  guard: { label: '写入前的条件', choices: { hip: ['true', 'i < n', 'i <= n'], python: ['True', 'i < n', 'i <= n'] } },
}

export const STAR_LABELS = [
  `${CHALLENGE_N} 个数都算对`,
  '没有任何线程写到数组外面',
  '派出的组数最少，而且换一种每组线程数，代码照样成立',
] as const

export const HINTS: Hints = {
  direction: `先让 ${CHALLENGE_N} 个数都有人算：组数够不够？拿数的规则对不对？`,
  location: '看两处：算下标的那一行，要把前面各组的线程数加进去；写入前的条件，要拦住多派出来的线程。',
  answer: `下标写成 ${GLOBAL_INDEX}，条件写成 i < n；组数取刚好够用的 ⌈${CHALLENGE_N} ÷ 每组线程数⌉，每组 4 个就派 4 组。`,
}

/** ★3 再跑的几次：另外两种每组线程数，组数都取刚好够用（交给 Sandbox 的 variants）。 */
export function variantsFor(launch: Launch): Launch[] {
  return BLOCK_DIMS.filter((b) => b !== launch.block).map((block) => ({ grid: minBlocks(CHALLENGE_N, block), block }))
}

// ── 旋钮和启动那一行 ─────────────────────────────────────────────────────

/** 草稿里读出来的旋钮值可能是旧版本或被手改坏：不认识的用默认值。 */
export function normalizeLaunch(raw: unknown, fallback: Launch, gridMax: number): Launch {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const block = BLOCK_DIMS.find((b) => b === r.block) ?? fallback.block
  const grid = typeof r.grid === 'number' && Number.isInteger(r.grid) && r.grid >= 1 && r.grid <= gridMax ? r.grid : fallback.grid
  return { grid, block }
}

/** 启动那一行（1-2 定的写法）：先写派几组，再写每组几个线程。 */
export function launchLine(launch: Launch, lang: Lang): string {
  return lang === 'hip'
    ? `add<<<${launch.grid}, ${launch.block}>>>(d_a, d_b, d_c, n);`
    : `add[${launch.grid}, ${launch.block}](d_a, d_b, d_c, n)`
}

// ── 判定 ─────────────────────────────────────────────────────────────────

/** 一次运行之后 c 的样子：每格被写了几次，哪些格子没人算、被算了不止一遍，写到外面几次。 */
export interface CellCheck {
  /** c 有几格 */
  length: number
  /** 派出了几个线程 */
  threads: number
  correct: boolean
  /** 每一格被写了几次。工作单里每个线程最多写一次 c，所以就是几个线程算了这一格 */
  writers: number[]
  missing: number[]
  duplicates: number[]
  /** 写到数组外面的下标，按下标排序，不重复 */
  outside: number[]
  /** 写到数组外面的次数，也就是几个线程写到了外面 */
  outsideWrites: number
}

export function checkCells(run: SandboxRun): CellCheck {
  const { launch, result } = run
  const c = result.arrays.c ?? []
  const a = result.arrays.a ?? []
  const b = result.arrays.b ?? []
  const writers = new Array<number>(c.length).fill(0)
  for (const e of result.events) {
    if (e.op !== 'store' || e.array !== 'c') continue
    for (const index of e.addrs ?? []) if (index >= 0 && index < c.length) writers[index]++
  }
  const away = result.outside.filter((o) => o.array === 'c')
  return {
    length: c.length,
    threads: launch.grid * launch.block,
    correct: result.ok && c.every((v, k) => v === a[k] + b[k]),
    writers,
    missing: writers.flatMap((w, k) => (w === 0 ? [k] : [])),
    duplicates: writers.flatMap((w, k) => (w > 1 ? [k] : [])),
    outside: away.map((o) => o.index),
    outsideWrites: away.reduce((sum, o) => sum + o.writes.length, 0),
  }
}

/** 一串格子写成「c[8]～c[11]」「c[1]、c[3]、c[5]」：连着三格以上的并成一段。 */
export function cellList(indices: readonly number[]): string {
  const parts: string[] = []
  for (let k = 0; k < indices.length; k++) {
    let end = k
    while (end + 1 < indices.length && indices[end + 1] === indices[end] + 1) end++
    if (end - k >= 2) {
      parts.push(`c[${indices[k]}]～c[${indices[end]}]`)
      k = end
    } else {
      parts.push(`c[${indices[k]}]`)
    }
  }
  return parts.join('、')
}

/**
 * 有格子被算了不止一遍时，是哪一种写错：每组都从 c[0] 算起（只用了 threadIdx.x），
 * 同一组挤在一格（下标里没有 threadIdx.x），还是相邻几组算的格子叠在一起（比如忘了乘每组线程数）。
 */
function duplicateCause(check: CellCheck, launch: Launch): string {
  const { duplicates, writers } = check
  if (duplicates[0] === 0 && duplicates.every((k) => k < launch.block && writers[k] === launch.grid)) {
    return `每一组都从 c[0] 算起：每组的 threadIdx.x 都从 0 数起，光靠它分不清是哪一组的线程，${launch.grid} 组就把前几格各算了 ${launch.grid} 遍。`
  }
  if (duplicates.every((k) => writers[k] === launch.block)) {
    return '同一组的线程都算出了同一个下标，挤在同一格：下标里没有用到自己在组里的编号 threadIdx.x。'
  }
  return '相邻几组算的格子叠在了一起：前面各组一共有 blockIdx.x × blockDim.x 个线程，下一组要从这里接着往后数。'
}

/**
 * 结果不对、或者有格子被算了不止一遍时：按 c 的样子说清现象、原因、怎么改（03 第 4 节）。
 * guard 是这段代码有没有写入前的条件（挑战有，探索二没有），决定改法里提不提它。
 */
function explain(run: SandboxRun, check: CellCheck, guard: boolean): ChallengeError {
  const { launch, result } = run
  if (!result.ok) return explainError(result.error)
  const raw = `运行后 c = [${(result.arrays.c ?? []).join(', ')}]`
  const { length: n, threads, missing, duplicates, outsideWrites } = check
  const away = outsideWrites ? `；另外 ${outsideWrites} 个线程写到了数组外面` : ''
  const lost = missing.length ? `，${missing.length} 个数没人算（${cellList(missing)}）` : ''
  if (duplicates.length) {
    return {
      symptom: `${cellList(duplicates)} 被不止一个线程算了${lost}${away}。`,
      cause: duplicateCause(check, launch),
      fix: `下标写成「前面各组的线程数 + 自己在组里排第几」：${GLOBAL_INDEX}。`,
      raw,
    }
  }
  if (missing.length && threads < n) {
    return {
      symptom: `${missing.length} 个数没人算：${cellList(missing)}。`,
      cause: `一共只派出 ${threads} 个线程（${launch.grid} 组 × 每组 ${launch.block} 个），比 ${n} 个数少。`,
      fix: `组数要向上取整：每组 ${launch.block} 个，至少要派 ${minBlocks(n, launch.block)} 组。`,
      raw,
    }
  }
  if (missing.length) {
    return {
      symptom: `${missing.length} 个数没人算：${cellList(missing)}${away}。`,
      cause: guard
        ? '线程够了，可有的格子没有线程算到：下标没有从 0 开始一个挨一个，或者条件把该算的线程拦在了外面。'
        : '线程够了，可有的格子没有线程算到：下标没有从 0 开始一个挨一个。',
      fix: guard ? `下标写成 ${GLOBAL_INDEX}，条件写成 i < n。` : `下标写成 ${GLOBAL_INDEX}。`,
      raw,
    }
  }
  return {
    symptom: 'c 里有算错的数。',
    cause: '每一格都有线程算，可算出来的值和 a[i] + b[i] 不一样。',
    fix: '读 a、b 和写 c 要用同一个 i。',
    raw,
  }
}

/**
 * 探索二（探索环节，不发星）：每个数都有人算，而且没有人重复，就算过；写到数组外面不算错，
 * 那是探索三要讲的事。没过时给出「现象 / 原因 / 怎么改」，没过的次数驱动这段沙盒自己的提示阶梯。
 */
export function judgeRule(runs: readonly SandboxRun[]): AttemptResult {
  const [main] = runs
  const check = checkCells(main)
  if (!check.correct || check.duplicates.length) {
    const error = explain(main, check, false)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const extra = check.outsideWrites
    ? `不过看看最右边：多出来的 ${check.outsideWrites} 个线程算出的位置超出了数组，写到了 ${cellList(check.outside)}。`
    : `这次派的线程正好 ${check.length} 个，没有多出来的。`
  return { earned: [true, false, false], next: `每对数都有人算，而且没有人重复。${extra}` }
}

/**
 * 挑战的星级判定（06 第 7 节）：输入是沙盒跑出来的 runs（runs[0] 是读者设的启动配置，后面是 variantsFor 的几种），
 * 输出三颗星各自成立没有和下一步的一句话。★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, ...others] = runs
  const check = checkCells(main)
  if (!check.correct) {
    const error = explain(main, check, true)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const { grid, block } = main.launch
  if (check.outsideWrites > 0) {
    return {
      earned: [true, false, false],
      next: `有 ${check.outsideWrites} 个线程写到了数组外面（${cellList(check.outside)}）：派出了 ${grid * block} 个线程，只有 ${check.length} 个数。写入前的条件要拦住 i 不小于 n 的线程：数组最后一格是 c[${check.length - 1}]。`,
    }
  }
  const fewest = minBlocks(check.length, block)
  if (grid > fewest) return { earned: [true, true, false], next: `组数还能更少：每组 ${block} 个，${fewest} 组就够了。` }
  if (!others.length) return { earned: [true, true, false], next: '再换一种每组线程数跑一次，才知道代码有没有把每组的线程数写死。' }
  for (const other of others) {
    const alt = checkCells(other)
    if (!alt.correct || alt.outsideWrites > 0) {
      return {
        earned: [true, true, false],
        next: `把每组线程数换成 ${other.launch.block}（派 ${other.launch.grid} 组），你的代码就不对了：是不是把每组的线程数写死成了具体的数？`,
      }
    }
  }
  const tried = others.map((o) => o.launch.block).join('、')
  return { earned: [true, true, true], next: `换成每组 ${tried} 个线程，代码也都对。三颗星的标准都达到了。` }
}
