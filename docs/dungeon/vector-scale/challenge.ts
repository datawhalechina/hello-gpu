/**
 * 新手村副本「向量缩放」（X-02）：题目用到的代码、数据、解读和判定（纯函数，单测在 scripts/tests/dungeon-vector-scale.test.mjs）。
 *
 * 题目：x 里 200 个长度，单位从厘米换成毫米：每个数乘以 k = 10，直接写回原来那一格（x[i] = k * x[i]，
 * 同 rocBLAS 的 scal）。派 4 组、每组 64 个线程，一共 256 个，比数多 56 个。读者补两个空：下标 i、写入前的条件。
 * - ★1 200 个数都乘以 10、每个只乘一次。副本的 ★1 就是通关：发这道题的经验值，题解展开（X-01）。
 * - ★2 没有线程读写到 x 外面。
 * - ★3 换成每组 32 个线程、100 个数，或每组 128 个线程、300 个数，同一份代码照样成立
 *   （Sandbox 的 variants 连数据一起换，组数都取刚好够用）。
 * 初始内容「能跑但不好」：下标只用 threadIdx.x（4 组都从 x[0] 乘起），条件差一个（i <= n）。原样运行一颗星都没有：
 * 原样运行就通关，等于不学也拿经验值（04 开头）。
 *
 * 原地改的数，被几个线程碰就乘几次。模拟器里这几个线程一个接一个跑（08 第 4 节的 wave 调度），所以正好乘了几次；
 * 真卡上它们的先后说不准，乘几次也说不准。判定按事件流数每一格被几个线程写了，不靠乘出来的值猜。
 * 两种写法的事件流（除了行号）和结果一样，判定也一样。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg, OobRead, RunResult } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, type Launch, type SandboxRun, type SandboxVariant } from '../../components/kit/sandbox/run.ts'

export const EXERCISE_ID = 'dungeon-vector-scale'

/** 200 个长度，每个乘以 10：厘米换成毫米。 */
export const N = 200
export const K = 10
/** 每组 64 个线程，组数向上取整（1-4）：⌈200 ÷ 64⌉ = 4 组，一共 256 个线程。 */
export const BLOCK = 64
export const LAUNCH: Launch = { grid: Math.ceil(N / BLOCK), block: BLOCK }
export const THREADS = LAUNCH.grid * LAUNCH.block

/** 全局下标（1-4）：前面各组的线程数，加上自己在组里排第几。 */
export const GLOBAL_INDEX = 'blockIdx.x * blockDim.x + threadIdx.x'
export const BEST_GUARD = 'i < n'

/** x[j] = j + 1（1～n），k = 10。乘对时 x[j] = 10 × (j + 1)，每一格都不一样，乘了几次一眼看得出来。 */
export function scaleArgs(n: number): Record<string, Arg> {
  return {
    x: { type: 'float', data: Array.from({ length: n }, (_, j) => j + 1) },
    k: { type: 'float', value: K },
    n: { type: 'int', value: n },
  }
}

export const ARGS = scaleArgs(N)

/** ★3 换的两种派法：每组几个线程、几个数都换，组数取刚好够用。写死 64 或 200 的代码会露馅。 */
export const VARIANT_SETUPS = [{ block: 32, n: 100 }, { block: 128, n: 300 }] as const
export const VARIANTS: SandboxVariant[] = VARIANT_SETUPS.map(({ block, n }) => ({
  grid: Math.ceil(n / block),
  block,
  args: scaleArgs(n),
}))

/** 两个空：下标 i、写入前的条件。 */
export const CODE: Record<Lang, string> = {
  hip: `__global__ void scale(float* x, float k, int n) {
    int i = [[i: threadIdx.x]];
    if ([[guard: i <= n]]) {
        x[i] = k * x[i];
    }
}`,
  python: `@kernel
def scale(x, k, n):
    i = [[i: threadIdx.x]]
    if [[guard: i <= n]]:
        x[i] = k * x[i]`,
}

/** 手机上的选项：下标多了忘乘每组人数、写死 64 两项；条件多了不拦、写死 200 两项。 */
export const BLANKS = {
  i: {
    label: '下标 i',
    choices: ['threadIdx.x', 'blockIdx.x + threadIdx.x', 'blockIdx.x * 64 + threadIdx.x', GLOBAL_INDEX],
  },
  guard: {
    label: '写入前的条件',
    choices: { hip: ['i <= n', 'true', 'i < 200', BEST_GUARD], python: ['i <= n', 'True', 'i < 200', BEST_GUARD] },
  },
}

/** 启动那一行（1-2 定的写法）。 */
export function launchLine(lang: Lang): string {
  const { grid, block } = LAUNCH
  return lang === 'hip'
    ? `scale<<<${grid}, ${block}>>>(d_x, ${K}.0f, ${N});`
    : `scale[${grid}, ${block}](d_x, ${K}.0, ${N})`
}

export const STAR_LABELS = [
  `${N} 个数都乘以 ${K}，每个只乘一次`,
  '没有线程读写到 x 外面',
  `换成每组 ${VARIANT_SETUPS[0].block} 个线程、${VARIANT_SETUPS[0].n} 个数，或每组 ${VARIANT_SETUPS[1].block} 个线程、${VARIANT_SETUPS[1].n} 个数，同一份代码照样成立`,
] as const

export const HINTS: Hints = {
  direction: `想一想：第 1 组的 0 号线程，前面已经有几个线程了？它该乘 x 的第几格？`,
  location: `先改下标 i：加上前面各组的线程数。再看条件：x 的最后一格是 x[n − 1]，i 等于 n 的线程也要拦在外面。`,
  answer: `下标写成 ${GLOBAL_INDEX}，条件写成 ${BEST_GUARD}。`,
}

// ── 判定 ─────────────────────────────────────────────────────────────────

/** 一个线程：在第几组、组里第几个。 */
export interface Thread {
  block: number
  thread: number
}

/** 一次读写到 x 外面：哪个线程、哪一格（越界的下标）。 */
export interface OutsideHit extends Thread {
  index: number
}

/** 一次运行之后 x 的样子：每一格被几个线程乘了，哪些没人乘、乘了不止一次，有没有读写到 x 外面。 */
export interface ScaleCheck {
  /** x 有几格 */
  n: number
  /** 派出了几个线程 */
  threads: number
  values: number[]
  /** 每一格被哪些线程写了（工作单里每个线程最多写一次 x，写了几次就是几个线程乘了它） */
  writers: Thread[][]
  missing: number[]
  repeated: number[]
  /** ★1：程序跑完，每一格都正好被乘了一次、都是原来的 10 倍 */
  correct: boolean
  /** 读到 x 外面（模拟器的越界读诊断），按发生的先后 */
  oobReads: OobRead[]
  /** 写到 x 外面（模拟器的越界区），按下标 */
  oobWrites: OutsideHit[]
}

export function checkScale(run: SandboxRun): ScaleCheck {
  const { launch, result } = run
  const values = result.arrays.x ?? []
  const n = values.length
  const writers: Thread[][] = Array.from({ length: n }, () => [])
  for (const e of result.events) {
    if (e.op !== 'store' || e.space !== 'global' || e.array !== 'x') continue
    const addrs = e.addrs ?? []
    let k = 0
    for (let lane = 0; lane < e.mask.length; lane++) {
      if (e.mask[lane] !== '1') continue
      const index = addrs[k++]
      if (index >= 0 && index < n) writers[index].push({ block: e.block, thread: e.wave * result.wave + lane })
    }
  }
  const missing = writers.flatMap((w, j) => (w.length === 0 ? [j] : []))
  const repeated = writers.flatMap((w, j) => (w.length > 1 ? [j] : []))
  return {
    n,
    threads: launch.grid * launch.block,
    values,
    writers,
    missing,
    repeated,
    correct: result.ok && !missing.length && !repeated.length && values.every((v, j) => v === K * (j + 1)),
    oobReads: result.diagnostics.filter((d): d is OobRead => d.kind === 'oob-read' && d.array === 'x'),
    oobWrites: result.outside
      .filter((o) => o.array === 'x')
      .flatMap((o) => o.writes.map((w) => ({ block: w.block, thread: w.thread, index: o.index }))),
  }
}

/** 一串格子写成「x[0]～x[63]」「x[3]、x[9]」：连着的并成一段，最多写两段，再多写「等」。 */
export function spans(indices: readonly number[], array = 'x'): string {
  const runs: [number, number][] = []
  for (const i of indices) {
    const last = runs[runs.length - 1]
    if (last && i === last[1] + 1) last[1] = i
    else runs.push([i, i])
  }
  const shown = runs.slice(0, 2).map(([from, to]) => (from === to ? `${array}[${from}]` : `${array}[${from}]～${array}[${to}]`))
  return `${shown.join('、')}${runs.length > 2 ? ' 等' : ''}`
}

/** 数写成文字：乘了太多次的数用科学计数法，免得一长串 0。 */
function num(v: number): string {
  return Number.isInteger(v) && Math.abs(v) < 1e12 ? String(v) : v.toPrecision(3)
}

function who(t: Thread): string {
  return `block ${t.block} 的 ${t.thread} 号`
}

/** 读写到 x 外面的线程，按 block、线程号排好，不重复。 */
function outsideThreads(c: ScaleCheck): OutsideHit[] {
  const seen = new Map<string, OutsideHit>()
  for (const h of [...c.oobWrites, ...c.oobReads.map((d) => ({ block: d.block, thread: d.thread, index: d.index }))]) {
    const key = `${h.block}:${h.thread}`
    if (!seen.has(key)) seen.set(key, h)
  }
  return [...seen.values()].sort((p, q) => p.block - q.block || p.thread - q.thread)
}

/**
 * ★1 不成立时：按 x 的样子说清现象、原因、怎么改（03 第 4 节）。按这个顺序找原因：
 * 代码出错；有的格子被乘了不止一次；有的格子没人乘；都不是（乘出来的值不对）。
 */
function wrong(run: SandboxRun, c: ScaleCheck): ChallengeError {
  const { result } = run
  if (!result.ok) return explainError(result.error)
  const last = c.n - 1
  const raw = [
    `运行后 x[0] = ${num(c.values[0])}，x[${last}] = ${num(c.values[last])}（乘对了应该是 ${K} 和 ${K * c.n}）`,
    `乘了不止一次的数：${c.repeated.length ? spans(c.repeated) : '没有'}`,
    `没人乘的数：${c.missing.length ? spans(c.missing) : '没有'}`,
    `读到 x 外面 ${c.oobReads.length} 次，写到 x 外面 ${c.oobWrites.length} 次`,
  ].join('\n')

  if (c.repeated.length) {
    const r = c.repeated[0]
    const list = c.writers[r]
    const names = `${list.slice(0, 3).map(who).join('、')}${list.length > 3 ? ' 等' : ''}线程`
    const lost = c.missing.length ? `；${spans(c.missing)} 没人乘，还是原来的数` : ''
    return {
      symptom: `${c.repeated.length} 个数被乘了不止一次：比如 x[${r}] 应该是 ${K * (r + 1)}，运行后是 ${num(c.values[r])}${lost}。`,
      cause: `有的线程算出了同一个 i：x[${r}] 被 ${list.length} 个线程各乘了一次（${names}）。原地改的数，每个碰它的线程都乘一次 ${K}。`
        + '模拟器里它们一个接一个跑，就乘了好几次；真卡上它们的先后说不准，乘几次也说不准。',
      fix: '让每个线程的 i 都不一样：前面各组一共有几个线程，再加上自己在组里排第几。',
      raw,
    }
  }
  if (c.missing.length) {
    return {
      symptom: `${c.missing.length} 个数没人乘：${spans(c.missing)} 还是原来的数。`,
      cause: `派了 ${c.threads} 个线程，比 ${c.n} 个数多，可有的格子没有线程乘到：下标没有从 x[0] 一格挨一格排下去，或者条件把该乘的线程拦在了外面。`,
      fix: '下标让线程从 x[0] 起一格挨一格排下去；条件只拦住 i 不小于 n 的线程。',
      raw,
    }
  }
  return {
    symptom: 'x 里有乘错的数。',
    cause: `每一格都正好有一个线程乘，可乘出来的不是原来的 ${K} 倍。`,
    fix: '只改下标和条件两个空，乘的那一行保持原样：x[i] = k * x[i]。',
    raw,
  }
}

/** ★3 换派法再跑的那一次：哪里不成立，一句话；成立是 null。 */
function variantProblem(run: SandboxRun): string | null {
  const c = checkScale(run)
  const lead = `换成每组 ${run.launch.block} 个线程、${c.n} 个数（派 ${run.launch.grid} 组）再跑一次`
  if (!run.result.ok) return `${lead}，程序出错了：${run.result.error.message}`
  if (c.repeated.length || c.missing.length) {
    const parts: string[] = []
    if (c.repeated.length) parts.push(`${spans(c.repeated)} 被乘了不止一次`)
    if (c.missing.length) parts.push(`${spans(c.missing)} 没人乘`)
    return `${lead}：${parts.join('，')}。下标和条件里有没有写死的数？每组几个线程用 blockDim.x，一共几个数用 n。`
  }
  if (!c.correct) return `${lead}：x 里有乘错的数。`
  const out = outsideThreads(c)
  if (out.length) {
    return `${lead}：${out.length} 个线程读写到了 x 外面，比如 ${who(out[0])}线程算出 i = ${out[0].index}，可 x 只有 x[0]～x[${c.n - 1}]。`
      + '条件里有没有写死的数？一共几个数用 n。'
  }
  return null
}

/**
 * 星级判定（06 第 7 节）：runs[0] 是派 4 组、每组 64 个线程、200 个数的那一次，后面是 VARIANTS 的两次。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」；★2 看这一次有没有读写到 x 外面；★3 看换了派法和数据还成不成立。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, ...others] = runs
  const c = checkScale(main)
  if (!c.correct) {
    const error = wrong(main, c)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const extra = c.threads - c.n
  const out = outsideThreads(c)
  if (out.length) {
    const first = out[0]
    const offByOne = out.every((h) => h.index === c.n)
    const why = offByOne
      ? `条件差了一个：i 等于 n 的线程也放进来了。x 的最后一格是 x[${c.n - 1}]，条件写 i < n。`
      : '写入前的条件要拦住 i 不小于 n 的线程：读也在这一行里，先拦住，再读。'
    return {
      earned: [true, false, false],
      next: `${c.n} 个数都乘对了。可多派的 ${extra} 个线程里，有 ${out.length} 个读写到了 x 外面：比如 ${who(first)}线程算出 i = ${first.index}，x 只有 x[0]～x[${c.n - 1}]。${why}`,
    }
  }
  if (!others.length) return { earned: [true, true, false], next: '再换一种派法跑一次，才知道代码里有没有写死的数。' }
  for (const other of others) {
    const problem = variantProblem(other)
    if (problem) return { earned: [true, true, false], next: problem }
  }
  const tried = others.map((o) => `每组 ${o.launch.block} 个线程、${o.result.arrays.x?.length ?? 0} 个数`).join('，')
  return {
    earned: [true, true, true],
    next: `${c.n} 个数都乘了 ${K}、每个只乘一次，多派的 ${extra} 个线程都被条件拦在外面；换成${tried}也照样成立。三颗星的标准都达到了。`,
  }
}

/** 结果上面那一行：x 现在是什么样（看乘出来的值，不分是谁乘的）。单步时只在最后一步写。 */
export function valueText(result: RunResult | null): string {
  if (!result) return ''
  if (!result.ok) return '程序没有跑完：x 停在出错那一刻的样子。'
  const x = result.arrays.x ?? []
  let right = 0
  let over = 0
  let same = 0
  let other = 0
  x.forEach((v, j) => {
    const want = K * (j + 1)
    if (v === want) right++
    else if (v === j + 1) same++
    else if (v > want) over++
    else other++
  })
  if (right === x.length) return `x 的 ${x.length} 个数都成了原来的 ${K} 倍：x[0] = ${num(x[0])}，x[${x.length - 1}] = ${num(x[x.length - 1])}。`
  const parts: string[] = []
  if (right) parts.push(`${right} 个乘对了`)
  if (over) parts.push(`${over} 个乘了不止一次`)
  if (same) parts.push(`${same} 个还是原来的数`)
  if (other) parts.push(`${other} 个是别的数`)
  return `x 的 ${x.length} 个数：${parts.join('，')}。`
}
