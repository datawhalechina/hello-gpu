/**
 * 组件测试样例 里 Sandbox 的两个演示（S-05）。纯数据和纯函数，单测在 scripts/tests/kit-sandbox.test.mjs。
 *
 * 1. 填空：试点关卡的挑战（试点 NV-04 已迁成正式的 1-4，docs/novice/thread-groups/，挑战还是这一道题）。
 *    13 对数，读者用旋钮定每组人数和组数，在沙盒里补上下标 i 和写入前的条件。星级标准和试点一样：
 *    ★1 13 个结果都对；★2 没有线程写到数组外面；★3 组数最少，而且换一种每组人数代码照样成立。
 *    试点判的是「三选一的规则 + 开关」，这里判的是读者写的代码在模拟器（L2 锁步解释器）里真正跑出来的结果，
 *    两种写法的结果一样。这里是组件演示，判定是自己的一份；正式关卡的判定在 1-4 的 challenge.ts。
 * 2. 完整模式：把负数改成 0，带一个分支，用来演示单步。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../../../docs/course/useChallenge.ts'
import type { Arg } from '../../../../docs/sim/lockstep.ts'
import type { Launch, SandboxRun } from '../../../../docs/components/kit/sandbox/run.ts'

// ── 1. 填空：试点关卡的挑战 ───────────────────────────────────────────────

export const CHALLENGE_N = 13
/** 每组人数的可选值，也是 ★3 要换着试的那几种。 */
export const BLOCK_DIMS = [2, 4, 8] as const
export const GRID_MAX = 8

const A = Array.from({ length: CHALLENGE_N }, (_, k) => k + 1)
const B = Array.from({ length: CHALLENGE_N }, (_, k) => 10 * (k + 1))
/** c[k] 应该是 a[k] + b[k]：11、22……143，每个都不是 0，没人算的格子一眼就看得出来。 */
export const EXPECTED = A.map((a, k) => a + B[k])

export const ADD_ARGS: Record<string, Arg> = {
  a: { type: 'float', data: A },
  b: { type: 'float', data: B },
  c: { type: 'float', data: new Array<number>(CHALLENGE_N).fill(0) },
  n: { type: 'int', value: CHALLENGE_N },
}

/** 初始内容「能跑但不好」（03 第 1 节第 3 条）：每组都从 0 开始拿数，也没有边界检查。 */
export const ADD_CODE = {
  hip: `__global__ void add(const float* a, const float* b, float* c, int n) {
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

/** 手机上的选项：把人数写死的一项、i <= n 这种差一个的条件都放进去。 */
export const ADD_BLANKS = {
  i: {
    label: '下标 i',
    choices: ['threadIdx.x', 'blockIdx.x * blockDim.x', 'blockIdx.x * blockDim.x + threadIdx.x', 'blockIdx.x * 4 + threadIdx.x'],
  },
  guard: {
    label: '写入前的条件',
    choices: { hip: ['true', 'i < n', 'i <= n'], python: ['True', 'i < n', 'i <= n'] },
  },
}

export const STAR_LABELS = [
  `${CHALLENGE_N} 个结果都算对`,
  '没有线程写到数组外面',
  '派出的组数最少，换一种每组人数也照样成立',
] as const

export const HINTS: Hints = {
  direction: '每一组线程都从 0 开始数 threadIdx.x，光靠它分不清是哪一组的线程。',
  location: '看算下标的那一行：要把「前面各组一共有多少个线程」加进去，也就是 blockIdx.x * blockDim.x；if 的条件要拦住 i 不小于 n 的线程。',
  answer: `下标写成 blockIdx.x * blockDim.x + threadIdx.x，条件写成 i < n；组数取刚好够用的 ⌈${CHALLENGE_N} ÷ 每组人数⌉。`,
  answerCode: 'int i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n    c[i] = a[i] + b[i];\n}',
}

/** 组数的下限：向上取整，不够一组也得派一组。 */
export function minBlocks(n: number, blockDim: number): number {
  return Math.ceil(n / blockDim)
}

/** ★3 要试的另外几种每组人数，组数都取刚好够用（交给 Sandbox 的 variants）。 */
export function variantsFor(launch: Launch): Launch[] {
  return BLOCK_DIMS.filter((b) => b !== launch.block).map((block) => ({ grid: minBlocks(CHALLENGE_N, block), block }))
}

/** 一次运行之后 c 的样子：每格被几个线程写过，哪些格子没人算、被算了不止一遍，写到外面几次。 */
export interface AddCheck {
  correct: boolean
  writers: number[]
  missing: number[]
  duplicates: number[]
  outside: number
}

export function checkAdd(run: SandboxRun): AddCheck {
  const { result } = run
  const writers = new Array<number>(CHALLENGE_N).fill(0)
  for (const e of result.events) {
    if (e.op !== 'store' || e.array !== 'c') continue
    for (const index of e.addrs ?? []) if (index >= 0 && index < CHALLENGE_N) writers[index]++
  }
  const c = result.arrays.c ?? []
  return {
    correct: result.ok && EXPECTED.every((v, k) => c[k] === v),
    writers,
    missing: writers.flatMap((w, k) => (w === 0 ? [k] : [])),
    duplicates: writers.flatMap((w, k) => (w > 1 ? [k] : [])),
    outside: result.outside.filter((o) => o.array === 'c').reduce((n, o) => n + o.writes.length, 0),
  }
}

/** ★1 不成立时：按 c 的样子说清现象、原因、怎么改（03 第 4 节）。 */
function explain(run: SandboxRun, check: AddCheck): ChallengeError {
  const { launch, result } = run
  const threads = launch.grid * launch.block
  const raw = `运行后 c = [${(result.arrays.c ?? []).join(', ')}]`
  const missing = check.missing.map((k) => `c[${k}]`).join('、')
  if (check.duplicates.length) {
    return {
      symptom: `${check.missing.length} 个数没人算（${missing}），${check.duplicates.length} 个数被不止一个线程算了。`,
      cause: '不同组的线程算出了同一个下标：下标只用了组里的编号（或者只用了组的编号），分不出是哪一组的哪个线程。',
      fix: '下标写成「前面各组的线程数 + 自己在组里排第几」：blockIdx.x * blockDim.x + threadIdx.x。',
      raw,
    }
  }
  if (check.missing.length && threads < CHALLENGE_N) {
    return {
      symptom: `${check.missing.length} 个数没人算：${missing}。`,
      cause: `一共只派出 ${threads} 个线程（${launch.grid} 组 × 每组 ${launch.block} 个），比 ${CHALLENGE_N} 个数少。`,
      fix: `组数要向上取整：每组 ${launch.block} 个，至少要 ${minBlocks(CHALLENGE_N, launch.block)} 组。`,
      raw,
    }
  }
  if (check.missing.length) {
    return {
      symptom: `${check.missing.length} 个数没人算：${missing}。`,
      cause: '线程够了，但有的下标没有线程算到：下标没有从 0 开始一个挨一个，或者条件把该算的线程拦在了外面。',
      fix: '下标写成 blockIdx.x * blockDim.x + threadIdx.x，条件写成 i < n。',
      raw,
    }
  }
  return {
    symptom: 'c 里有算错的数。',
    cause: '每个格子都有线程算，但算出来的值和 a[i] + b[i] 不一样。',
    fix: '检查下标：读 a、b 和写 c 用的要是同一个 i。',
    raw,
  }
}

/**
 * 星级判定（06 第 7 节）：输入是沙盒跑出来的 runs（runs[0] 是读者设的启动配置，后面是 variantsFor 的几种），
 * 输出三颗星各自成立没有和下一步的一句话。★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, ...others] = runs
  const check = checkAdd(main)
  if (!check.correct) {
    const error = explain(main, check)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const { grid, block } = main.launch
  if (check.outside > 0) {
    return {
      earned: [true, false, false],
      next: `派出了 ${grid * block} 个线程，多出来的线程往数组外面写了 ${check.outside} 次：写入前的条件要拦住 i 不小于 n 的线程。`,
    }
  }
  const fewest = minBlocks(CHALLENGE_N, block)
  if (grid > fewest) return { earned: [true, true, false], next: `组数还能更少：每组 ${block} 个，${fewest} 组就够了。` }
  for (const other of others) {
    const alt = checkAdd(other)
    if (!alt.correct || alt.outside > 0) {
      return {
        earned: [true, true, false],
        next: `把每组人数换成 ${other.launch.block}（${other.launch.grid} 组），你的代码就不对了：是不是把人数写死了？`,
      }
    }
  }
  return { earned: [true, true, true], next: '三颗星的标准都达到了。' }
}

// ── 2. 完整模式：把负数改成 0 ───────────────────────────────────────────

export const RELU_CODE = {
  hip: `__global__ void relu(float* x, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        if (x[i] < 0.0f) {
            x[i] = 0.0f;
        }
    }
}`,
  python: `@kernel
def relu(x, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        if x[i] < 0.0:
            x[i] = 0.0`,
}

export const RELU_INPUT = [3, -1, 4, -1, -5, 9, -2, 6, 5, -3]

export const RELU_ARGS: Record<string, Arg> = {
  x: { type: 'float', data: RELU_INPUT },
  n: { type: 'int', value: RELU_INPUT.length },
}

/** 一组 16 个线程，比数据多 6 个：单步时能看到边界检查和分支怎样让一部分线程停下来等。 */
export const RELU_LAUNCH: Launch = { grid: 1, block: 16 }
