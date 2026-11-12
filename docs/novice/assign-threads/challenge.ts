/**
 * 1-3 给线程派活：三段代码的模板、数据和判定（纯函数，单测在 scripts/tests/novice-assign-threads.test.mjs）。
 *
 * - 热身和探索一：把 1-1 的逐个相加原样写进 kernel（LOOP_CODE），派 2 / 4 / 8 个线程照着做：
 *   每个线程都把整段循环走一遍，每一格被算「派出的人数」遍。
 * - 探索二：读者第一次用代码沙盒，补上 i = ?，让 8 个线程各算一格（judgeOwnCell；探索环节，不发星）。
 * - 挑战：12 对数。旋钮定派几个线程（8 / 12 / 16 / n），沙盒里补 i。
 *   ★1 12 个数都算对；★2 派的线程刚好够用，没有线程写到数组外面；
 *   ★3 换成 20 个数，工作单和派法都不改，照样全对（Sandbox 的 variants 带上这批数据再跑一次）。
 *   判的是代码在模拟器（L2 锁步解释器）里真正跑出来的结果，两种写法的结果一样。
 *
 * 这一关只派 1 组线程（gridDim.x = 1），也不加边界检查：分组、全局下标和 if (i < n) 是 1-4 的事。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, type Launch, type SandboxRun, type SandboxVariant } from '../../components/kit/sandbox/run.ts'

/** 这一关在大纲里的 id。 */
export const STAGE_ID = 'novice-assign-threads'

// ── 数据 ─────────────────────────────────────────────────────────────────

/**
 * n 对数：a[k] = k + 1，b[k] = 10 × (k + 1)，c 一开始全是 0。算对时 c[k] = 11 × (k + 1)，
 * 每个都不是 0，没人算的格子一眼就看得出来（同 /preview/kit/ 的试点挑战）。
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

// ── 热身和探索一：把循环原样搬进工作单 ───────────────────────────────────────

/** 1-1 的逐个相加，原样写进 kernel。`n` 是数据的个数，循环让 i 从 0 走到 n − 1。 */
export const LOOP_CODE: Record<Lang, string> = {
  hip: `__global__ void add(float* a, float* b, float* c, int n) {
    for (int i = 0; i < n; i++) {
        c[i] = a[i] + b[i];
    }
}`,
  python: `@kernel
def add(a, b, c, n):
    for i in range(n):
        c[i] = a[i] + b[i]`,
}

/** 探索一的数据个数，和热身「先猜」里说的一样。 */
export const LOOP_N = 8
/** 探索一的旋钮：派几个线程。默认 8，和「先猜」一致。 */
export const LOOP_THREADS = [2, 4, 8] as const

// ── 探索二和挑战：每个线程认领自己的一格 ─────────────────────────────────────

/** 探索二和挑战共用的工作单：读者补上 i。初始内容 0「能跑但不好」（03 第 1 节第 3 条）：大家都去算 c[0]。 */
export const OWN_CELL_CODE: Record<Lang, string> = {
  hip: `__global__ void add(float* a, float* b, float* c, int n) {
    int i = [[i: 0]];
    c[i] = a[i] + b[i];
}`,
  python: `@kernel
def add(a, b, c, n):
    i = [[i: 0]]
    c[i] = a[i] + b[i]`,
}

/** 手机上的选项（03 第 7 节）：大家挤一格、对的那一项、错开一格、隔一格拿。两种写法一样。 */
export const OWN_CELL_BLANKS = {
  i: { label: '下标 i', choices: ['0', 'threadIdx.x', 'threadIdx.x + 1', 'threadIdx.x * 2'] },
}

/** 探索二：8 对数、派 8 个线程。 */
export const EXPLORE_N = 8
export const EXPLORE_LAUNCH: Launch = { grid: 1, block: EXPLORE_N }

export const OWN_CELL_HINTS: Hints = {
  direction: '8 个线程照着同一张工作单做。i 写成一个固定的数，大家就挤在同一格。',
  location: '看 i = 那一行：要换成一个每个线程都不一样的数。每个线程屏幕上的编号，正好各不相同。',
  answer: 'i 写成 threadIdx.x：0 号线程算 c[0]，1 号算 c[1]……7 号算 c[7]。',
}

// ── 挑战：给 12 对数派活 ───────────────────────────────────────────────────

export const CHALLENGE_N = 12
/** ★3 换的那一批数。 */
export const VARIANT_N = 20

/** 旋钮上派几个线程：三个具体的数，或者 n（数据有几个就派几个）。 */
export type ThreadChoice = 8 | 12 | 16 | 'n'
export const THREAD_CHOICES: readonly ThreadChoice[] = [8, 12, 16, 'n']
/** 默认值「能跑但不好」：沿用探索二的 8 个线程，12 个数不够分。 */
export const DEFAULT_THREADS: ThreadChoice = 8

/** 草稿里读出来的旋钮值可能是旧版本或被手改坏：不认识的用默认值。 */
export function normalizeThreads(raw: unknown): ThreadChoice {
  return THREAD_CHOICES.find((c) => c === raw) ?? DEFAULT_THREADS
}

/** 这种派法遇到 n 个数时派几个线程。 */
export function threadsFor(choice: ThreadChoice, n: number): number {
  return choice === 'n' ? n : choice
}

/** 读者设的那一次：12 个数，派 1 组。 */
export function challengeLaunch(choice: ThreadChoice): Launch {
  return { grid: 1, block: threadsFor(choice, CHALLENGE_N) }
}

/** ★3 再跑的那一次：换成 20 个数，派法照旧（选 n 就派 20 个，选具体的数还是那么多）。 */
export function challengeVariants(choice: ThreadChoice): SandboxVariant[] {
  return [{ grid: 1, block: threadsFor(choice, VARIANT_N), args: addArgs(VARIANT_N) }]
}

/** 启动那一行（1-2 定的写法）：派 1 组，这一组几个线程。 */
export function launchLine(choice: ThreadChoice, lang: Lang): string {
  const t = choice === 'n' ? 'n' : String(choice)
  return lang === 'hip' ? `add<<<1, ${t}>>>(d_a, d_b, d_c, n);` : `add[1, ${t}](d_a, d_b, d_c, n)`
}

export const STAR_LABELS = [
  `${CHALLENGE_N} 个数都算对`,
  '派的线程刚好够用，没有线程写到数组外面',
  `换成 ${VARIANT_N} 个数，工作单和派法都不改，照样全对`,
] as const

export const HINTS: Hints = {
  direction: `先让 ${CHALLENGE_N} 个数都有人算：i 要让每个线程都不一样，派的线程也要够。`,
  location: '看两处：沙盒里 i = 那一行，要用每个线程自己的编号；旋钮上派几个线程，要和数据一样多，换一批数也要跟得上。',
  answer: 'i 写成 threadIdx.x；旋钮选 n，数据有几个就派几个线程。',
}

// ── 判定 ─────────────────────────────────────────────────────────────────

/** 一次运行之后 c 的样子：每格被写了几次，哪些格子没人算、被算了不止一遍，写到外面几次。 */
export interface CellCheck {
  /** c 有几格（这一次跑的数据） */
  length: number
  /** 派出了几个线程 */
  threads: number
  correct: boolean
  /** 每一格被写了几次。这张工作单里每个线程只写一次 c，所以就是几个线程算了这一格 */
  writers: number[]
  missing: number[]
  duplicates: number[]
  /** 写到数组外面的下标，按下标排序，不重复 */
  outside: number[]
  /** 写到数组外面的次数。每个线程只写一次 c，所以就是几个线程写到了外面 */
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

/** ★1 不成立时：按 c 的样子说清现象、原因、怎么改（03 第 4 节）。 */
function explain(run: SandboxRun, check: CellCheck): ChallengeError {
  const { result } = run
  if (!result.ok) return explainError(result.error)
  const raw = `运行后 c = [${(result.arrays.c ?? []).join(', ')}]`
  const { length: n, threads, missing, duplicates, writers, outsideWrites } = check
  const away = outsideWrites ? `；另外 ${outsideWrites} 个线程写到了数组外面` : ''
  const fixRule = 'i 写成每个线程自己的编号 threadIdx.x：0 号线程算 c[0]，1 号算 c[1]……'
  if (duplicates.length === 1 && writers[duplicates[0]] === threads) {
    const only = duplicates[0]
    return {
      symptom: `${threads} 个线程都算了 c[${only}]，另外 ${n - 1} 格没人算${away}。`,
      cause: '每个线程都照着同一张工作单做：i 是一个固定的数，大家就挤在同一格。',
      fix: fixRule,
      raw,
    }
  }
  if (duplicates.length) {
    return {
      symptom: `${cellList(duplicates)} 被不止一个线程算了，${missing.length} 个数没人算（${cellList(missing)}）${away}。`,
      cause: '有几个线程算出了同一个 i，挤在同一格；它们本该去的格子就空着。',
      fix: fixRule,
      raw,
    }
  }
  if (missing.some((k) => k < threads)) {
    return {
      symptom: `${missing.length} 个数没人算：${cellList(missing)}${away}。`,
      cause: 'i 没有从 0 开始、一格挨一格地排：有的格子没有线程算到，有的线程算到了别处。',
      fix: fixRule,
      raw,
    }
  }
  if (missing.length) {
    return {
      symptom: `${missing.length} 个数没人算：${cellList(missing)}。`,
      cause: `只派了 ${threads} 个线程。一个线程算一格，${n} 个数要 ${n} 个线程。`,
      fix: '多派几个线程：数据有几个，就派几个。',
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
 * 探索二（探索环节，不发星）：8 个线程各算一格就算过。没过时给出「现象 / 原因 / 怎么改」，
 * 没过的次数驱动这段沙盒自己的提示阶梯。
 */
export function judgeOwnCell(runs: readonly SandboxRun[]): AttemptResult {
  const [main] = runs
  const check = checkCells(main)
  if (!check.correct) {
    const error = explain(main, check)
    return { earned: [false, false, false], next: error.fix, error }
  }
  return { earned: [true, false, false], next: `${check.length} 个数都算对了：每个线程算的都是自己那一格。` }
}

/**
 * 挑战的星级判定（06 第 7 节）：输入是沙盒跑出来的 runs（runs[0] 是读者设的 12 个数，
 * runs[1] 是 challengeVariants 的 20 个数），输出三颗星各自成立没有和下一步的一句话。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, variant] = runs
  const check = checkCells(main)
  if (!check.correct) {
    const error = explain(main, check)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const { length: n, threads } = check
  if (check.outside.length || threads !== n) {
    const extra = threads - n
    const where = check.outside.length
      ? `多出来的 ${extra} 个线程照着工作单写到了 ${cellList(check.outside)}，那里已经在数组外面了`
      : `有 ${extra} 个线程的活是重复的`
    return { earned: [true, false, false], next: `派出了 ${threads} 个线程，只有 ${n} 个数：${where}。${n} 个数派 ${n} 个线程就够。` }
  }
  if (!variant) return { earned: [true, true, false], next: `再拿 ${VARIANT_N} 个数试一次，才知道这张工作单换一批数还对不对。` }
  const alt = checkCells(variant)
  if (!alt.correct || alt.outside.length || alt.duplicates.length) {
    if (alt.threads < alt.length) {
      return {
        earned: [true, true, false],
        next: `再拿 ${alt.length} 个数试一次：工作单没问题，可派法没变，还是只派 ${alt.threads} 个线程，${cellList(alt.missing)} 没人算。派法选 n，派的线程跟着数据走。`,
      }
    }
    const trouble = alt.missing.length ? `${cellList(alt.missing)} 没人算` : '有的格子被算了不止一遍、有的线程写到了数组外面'
    return {
      earned: [true, true, false],
      next: `再拿 ${alt.length} 个数试一次，派了 ${alt.threads} 个线程，可 ${trouble}：i 里是不是写死了 ${n}？用 threadIdx.x，换多少个数都不用改。`,
    }
  }
  return { earned: [true, true, true], next: `换成 ${alt.length} 个数、派 ${alt.threads} 个线程，也全算对了。三颗星的标准都达到了。` }
}
