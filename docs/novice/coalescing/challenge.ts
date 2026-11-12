/**
 * 1-8 排好队一起取：两段实验台、挑战和支线用到的代码、数据、解读和判定（纯函数，单测在 scripts/tests/novice-coalescing.test.mjs）。
 *
 * - 探索一（scenes/CarLab.vue 的 stride）：128 道向量加法，每组 32 个线程（一支小队），每个线程连着算 stride 道，
 *   组数刚好够用。旋钮调 stride（1 / 2 / 4），访存视图（MemoryView）看小队一次读写要搬几车。
 * - 探索二（scenes/CarLab.vue 的 split）：128 道加法交给 1 组 32 个线程，每人 4 道。甲连着分（i = t * m + k），
 *   乙隔着分（i = k * 32 + t），看小队每一轮要搬几车。
 * - 挑战（scenes/PartSandbox.vue）：part_sum，每个线程先把 4 个数加成部分和，存进 part[t]。读者补一个空：
 *   第 k 轮、第 t 个线程拿第几个数。★1 128 个数都加进去、每个只加一次；★2 车次降到最少；
 *   ★3 换成 2 组、每人加 2 个，同一行照样成立（Sandbox 的 variants 用同一份代码再跑一次）。
 * - 支线（scenes/AgentSide.vue）：AgentConsole 从「每组 32 个、步长 4」出发；读者当 Agent 交出算对、不多搬的参数，支线完成。
 *
 * 车次（模拟）都来自模拟器 L3 的 analyzeMemory：一个 wave 的一次读写碰到几车就算几车，理想车次是要的数挨着放最少几车。
 * 一车 128 字节、一个 float 4 字节（params.ts 的示意值），一车装 32 个。两种写法的事件流（除了行号）一样，车次和判定也一样。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Verdict } from '../../course/agent/react.ts'
import type { TuneConfig } from '../../course/agent/tasks.ts'
import type { Arg, OobRead, RunResult, SimEvent } from '../../sim/lockstep.ts'
import { analyzeMemory } from '../../sim/memory.ts'
import { SIM_PARAMS } from '../../sim/params.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, type Launch, type SandboxRun, type SandboxVariant } from '../../components/kit/sandbox/run.ts'

export const STAGE_ID = 'novice-coalescing'

/** 一支小队 32 个线程（wave32，1-5）。本关每组都派 32 个，一组正好一支小队。 */
export const WAVE = 32
/** 一车多少字节、一车装几个数（params.ts 的示意值：一车 128 字节，一个数 4 字节）。 */
export const LINE_BYTES = SIM_PARAMS.lineBytes
export const PER_LINE = LINE_BYTES / SIM_PARAMS.elemBytes

// ── 两段实验台 ────────────────────────────────────────────────────────────

/** 两段实验台都是 128 道加法。 */
export const LAB_N = 128

/** a[j] = j + 1，b[j] = 10 × (j + 1)，c 一开始全是 0（同 1-4）；再加上工作单的整数参数（stride 或 m）。 */
export function labArgs(scalars: Readonly<Record<string, number>>): Record<string, Arg> {
  const a = Array.from({ length: LAB_N }, (_, j) => j + 1)
  const args: Record<string, Arg> = {
    a: { type: 'float', data: a },
    b: { type: 'float', data: a.map((v) => 10 * v) },
    c: { type: 'float', data: new Array<number>(LAB_N).fill(0) },
  }
  for (const [name, value] of Object.entries(scalars)) args[name] = { type: 'int', value }
  return args
}

/** 实验台第 i 道加法的正确结果：a[i] + b[i] = 11 × (i + 1)。 */
export function labExpected(): number[] {
  return Array.from({ length: LAB_N }, (_, i) => 11 * (i + 1))
}

/** 启动那一行（1-2 定的写法）：最后一个参数是 stride 或 m。 */
export function labLaunchLine(launch: Launch, last: number, lang: Lang): string {
  return lang === 'hip'
    ? `add<<<${launch.grid}, ${launch.block}>>>(d_a, d_b, d_c, ${last});`
    : `add[${launch.grid}, ${launch.block}](d_a, d_b, d_c, ${last})`
}

/** 一次运行搬了几车（模拟）：小队第一次读写（第一次读 a）几车，整段一共几车、理想几车。 */
export interface CarCount {
  first: number
  transactions: number
  ideal: number
}

export function countCars(events: readonly SimEvent[]): CarCount {
  const m = analyzeMemory(events)
  return { first: m.accesses[0]?.transactions ?? 0, transactions: m.summary.transactions, ideal: m.summary.ideal }
}

// ── 探索一：步长 ──────────────────────────────────────────────────────────

/** 步长的可选值；默认 4：能跑但不好（03 第 1 节第 3 条），热身猜的也是它。 */
export const STRIDES = [1, 2, 4] as const
export const DEFAULT_STRIDE = 4

/** 每组 32 个线程，每个线程连着算 stride 道，组数刚好够用：128 ÷ stride ÷ 32。 */
export function strideLaunch(stride: number): Launch {
  return { grid: LAB_N / stride / WAVE, block: WAVE }
}

/** 每个线程连着算 stride 道：同一步里，相邻两个线程隔 stride 个数（同 A-01 的调参任务）。 */
export const STRIDE_CODE: Record<Lang, string> = {
  hip: `__global__ void add(float* a, float* b, float* c, int stride) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    for (int k = 0; k < stride; k++) {
        int i = t * stride + k;   // 连着算 stride 道
        c[i] = a[i] + b[i];
    }
}`,
  python: `@kernel
def add(a, b, c, stride):
    t = blockIdx.x * blockDim.x + threadIdx.x
    for k in range(stride):
        i = t * stride + k    # 连着算 stride 道
        c[i] = a[i] + b[i]`,
}

/**
 * 算完 128 道一共搬几车（模拟）。不管步长多少，小队的活都是 128 ÷ 32 = 4 份：一份是一支小队算一轮，
 * 读 a、读 b、写 c 各一次，每次搬 stride 车。单测拿模拟器核对。
 */
export function labCars(stride: number): number {
  return (LAB_N / WAVE) * 3 * stride
}

/** 换了步长以后的那一句（03 第 1 节第 4 条：一句话解读）。 */
export function strideText(stride: number, cars: CarCount): string {
  if (cars.first <= 1) {
    return `步长 ${stride}：相邻线程拿相邻的数，小队一次要的 ${WAVE} 个数正好装满 1 车。${LAB_N} 道算完一共搬了 ${cars.transactions} 车，一车都没多搬（模拟）。`
  }
  return `步长 ${stride}：同一步里相邻线程隔 ${stride} 个数，小队一次要的 ${WAVE} 个数散在 ${cars.first} 车里，每车只用上 ${WAVE / cars.first} 个。`
    + `${LAB_N} 道算完一共搬了 ${cars.transactions} 车，理想 ${cars.ideal} 车（模拟）。`
}

// ── 探索二：分法 ──────────────────────────────────────────────────────────

/** chunk：甲，连着分；spread：乙，隔着分。 */
export type Split = 'chunk' | 'spread'

/** 默认甲：能跑但不好。 */
export const SPLITS: readonly { value: Split; label: string }[] = [
  { value: 'chunk', label: '甲：连着分' },
  { value: 'spread', label: '乙：隔着分' },
]
export const DEFAULT_SPLIT: Split = 'chunk'

/** 每人 4 道，派 1 组 32 个线程。 */
export const SPLIT_M = 4
export const SPLIT_LAUNCH: Launch = { grid: 1, block: WAVE }

/** 两种分法只差 i 这一行。乙把线程数 32 写死了：挑战的 ★3 换派法时会抓住它。 */
const SPLIT_INDEX: Record<Split, Record<Lang, string>> = {
  chunk: {
    hip: 'int i = t * m + k;    // 甲：连着分',
    python: 'i = t * m + k    # 甲：连着分',
  },
  spread: {
    hip: 'int i = k * 32 + t;   // 乙：隔着分',
    python: 'i = k * 32 + t   # 乙：隔着分',
  },
}

export function splitCode(split: Split, lang: Lang): string {
  return lang === 'hip'
    ? `__global__ void add(float* a, float* b, float* c, int m) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    for (int k = 0; k < m; k++) {
        ${SPLIT_INDEX[split].hip}
        c[i] = a[i] + b[i];
    }
}`
    : `@kernel
def add(a, b, c, m):
    t = blockIdx.x * blockDim.x + threadIdx.x
    for k in range(m):
        ${SPLIT_INDEX[split].python}
        c[i] = a[i] + b[i]`
}

/** 换了分法以后的那一句。 */
export function splitText(split: Split, cars: CarCount): string {
  const done = `${SPLIT_M} 轮算完 ${LAB_N} 道，一共搬了 ${cars.transactions} 车`
  if (split === 'chunk') {
    return `甲（连着分）：每一轮，小队要的 ${WAVE} 个数隔 ${SPLIT_M} 个一个，散在 ${cars.first} 车里。${done}，理想 ${cars.ideal} 车（模拟）。`
  }
  return `乙（隔着分）：每一轮，小队要的 ${WAVE} 个数挨在一起，正好装满 1 车。${done}，一车都没多搬（模拟）。`
}

// ── 挑战：每人先加一段 ────────────────────────────────────────────────────

/** 128 个数，派 1 组 32 个线程，每人加 4 个。 */
export const PART_N = 128
export const PART_M = 4
export const PART_LAUNCH: Launch = { grid: 1, block: WAVE }
/** ★3 换一种派法：2 组、每组 32 个线程、每人加 2 个，还是这 128 个数。 */
export const VARIANT_M = 2
export const VARIANT_LAUNCH: Launch = { grid: 2, block: WAVE }

/** a[j] = j + 1（同 1-7，从 1 数起）；part 一个线程一格，一开始全是 0。 */
export function partArgs(m: number, threads: number): Record<string, Arg> {
  return {
    a: { type: 'float', data: Array.from({ length: PART_N }, (_, j) => j + 1) },
    part: { type: 'float', data: new Array<number>(threads).fill(0) },
    m: { type: 'int', value: m },
  }
}

export const PART_ARGS = partArgs(PART_M, PART_LAUNCH.grid * PART_LAUNCH.block)
export const PART_VARIANTS: SandboxVariant[] = [
  { ...VARIANT_LAUNCH, args: partArgs(VARIANT_M, VARIANT_LAUNCH.grid * VARIANT_LAUNCH.block) },
]

/** 1 + 2 + … + 128：part 加起来应该是它。 */
export const PART_TOTAL = (PART_N * (PART_N + 1)) / 2

/** part_sum：T 是一共几个线程，s 在工具台（寄存器）上加（1-7）。i 那一行是空。 */
function partCode(index: string): Record<Lang, string> {
  return {
    hip: `__global__ void part_sum(float* a, float* part, int m) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    int T = gridDim.x * blockDim.x;   // 一共几个线程
    float s = 0;
    for (int k = 0; k < m; k++) {
        int i = ${index};   // 第 k 轮拿第几个数
        s = s + a[i];
    }
    part[t] = s;
}`,
    python: `@kernel
def part_sum(a, part, m):
    t = blockIdx.x * blockDim.x + threadIdx.x
    T = gridDim.x * blockDim.x    # 一共几个线程
    s = 0.0
    for k in range(m):
        i = ${index}    # 第 k 轮拿第几个数
        s = s + a[i]
    part[t] = s`,
  }
}

/** 初始内容「能跑但不好」：连着拿，同探索二的甲。每个数都加一次，可每次读 a 搬 4 车。 */
export const DEFAULT_INDEX = 't * m + k'
/** 隔着拿，跳的距离是一共几个线程：换派法照样成立。 */
export const BEST_INDEX = 'k * T + t'
export const PART_CODE = partCode(`[[i: ${DEFAULT_INDEX}]]`)

/** 手机上的选项：连着拿、重叠着拿、把 32 写死、用 T。 */
export const PART_BLANKS = {
  i: {
    label: '第 k 轮、第 t 个线程拿第几个数',
    choices: [DEFAULT_INDEX, 'k * m + t', 'k * 32 + t', BEST_INDEX],
  },
}

/** 启动那一行（1-2 定的写法）。 */
export function partLaunchLine(lang: Lang): string {
  const { grid, block } = PART_LAUNCH
  return lang === 'hip'
    ? `part_sum<<<${grid}, ${block}>>>(d_a, d_part, ${PART_M});`
    : `part_sum[${grid}, ${block}](d_a, d_part, ${PART_M})`
}

/** 最少：每轮读 a 1 车，4 轮 4 车；写 part 1 车（单测核对和模拟器数的一样）。初始写法每轮读 a 搬 4 车，一共 17 车。 */
export const BEST_CARS = PART_M + 1

export const STAR_LABELS = [
  `${PART_N} 个数都加进 part，每个数只加一次`,
  `搬的车降到最少（${BEST_CARS} 车，模拟）：每次读 a 只搬 1 车`,
  `换成 ${VARIANT_LAUNCH.grid} 组、每人加 ${VARIANT_M} 个，同一行照样每个数只加一次、一车不多搬`,
] as const

export const HINTS: Hints = {
  direction: `看结果里第 0 轮读 a 的那一次：小队要的 ${WAVE} 个数隔几个一个？让同一轮里相邻的线程拿相邻的数。`,
  location: `只改 i 这一行：第 k 轮，${WAVE} 个线程拿一段挨着的数，下一轮再往后挪一整段。一共几个线程，工作单里写在 T 里。`,
  answer: `写成 i = ${BEST_INDEX}：第 k 轮，第 t 个线程拿第 k × T + t 个数。第 0 轮拿 a[0]～a[31]，第 1 轮拿 a[32]～a[63]……`
    + `每次读 a 只搬 1 车；换成 ${VARIANT_LAUNCH.grid} 组、每人加 ${VARIANT_M} 个也照样成立。`,
}

// ── 判定 ─────────────────────────────────────────────────────────────────

/** a 里每个数被加了几次：没人加的、加了不止一次的，以及读到 a 外面的那几次（模拟器的越界读诊断）。 */
export interface Coverage {
  counts: number[]
  missing: number[]
  repeated: number[]
  outside: OobRead[]
}

export function coverageOf(result: RunResult, n = PART_N): Coverage {
  const counts = new Array<number>(n).fill(0)
  for (const e of result.events) {
    if (e.op !== 'load' || e.space !== 'global' || e.array !== 'a') continue
    for (const i of e.addrs ?? []) if (i >= 0 && i < n) counts[i]++
  }
  const missing: number[] = []
  const repeated: number[] = []
  counts.forEach((c, i) => {
    if (c === 0) missing.push(i)
    else if (c > 1) repeated.push(i)
  })
  const outside = result.diagnostics.filter((d): d is OobRead => d.kind === 'oob-read' && d.array === 'a')
  return { counts, missing, repeated, outside }
}

/** 一串下标写成「a[96]～a[127]」「a[4]、a[9]」：连着的写成一段，最多写两段，再多写「等」。 */
function spanText(indices: readonly number[]): string {
  const runs: [number, number][] = []
  for (const i of indices) {
    const last = runs[runs.length - 1]
    if (last && i === last[1] + 1) last[1] = i
    else runs.push([i, i])
  }
  const shown = runs.slice(0, 2).map(([from, to]) => (from === to ? `a[${from}]` : `a[${from}]～a[${to}]`))
  return `${shown.join('、')}${runs.length > 2 ? ' 等' : ''}`
}

/** 读 a、写 part 各搬了几车，以及第一次读 a：几车、相邻线程隔几个（隔得不一样时是 0）。 */
export interface PartCars {
  read: number
  write: number
  transactions: number
  ideal: number
  firstRead: number
  gap: number
}

export function partCars(events: readonly SimEvent[]): PartCars {
  const m = analyzeMemory(events)
  const cars: PartCars = { read: 0, write: 0, transactions: m.summary.transactions, ideal: m.summary.ideal, firstRead: 0, gap: 0 }
  for (const access of m.accesses) {
    const e = events[access.event]
    if (e.op !== 'load') {
      cars.write += access.transactions
      continue
    }
    cars.read += access.transactions
    if (cars.firstRead) continue
    cars.firstRead = access.transactions
    const addrs = e.addrs ?? []
    const d = addrs.length > 1 ? addrs[1] - addrs[0] : 0
    cars.gap = addrs.every((v, k) => k === 0 || v - addrs[k - 1] === d) ? d : 0
  }
  return cars
}

/** 「block 1 的 3 号线程」：只有一组时不写组号。 */
function who(d: Pick<OobRead, 'block' | 'thread'>, grid: number): string {
  return grid > 1 ? `block ${d.block} 的 ${d.thread} 号线程` : `${d.thread} 号线程`
}

/**
 * ★1：128 个数都加进 part、每个只加一次。没做到时写成「现象 / 原因 / 怎么改」（03 第 4 节），按这个顺序找原因：
 * 代码出错；读到了 a 外面；有的数重了、有的没人加；都不是（part 加起来还是不对）。
 */
function wrong(run: SandboxRun): ChallengeError | null {
  const { result, launch } = run
  if (!result.ok) return explainError(result.error)
  const cov = coverageOf(result)
  const part = result.arrays.part ?? []
  const total = part.reduce((sum, v) => sum + v, 0)
  const raw = [
    `运行后 part 加起来是 ${total}，应该是 1 + 2 + … + ${PART_N} = ${PART_TOTAL}`,
    `没人加的数：${cov.missing.length ? spanText(cov.missing) : '没有'}`,
    `加了不止一次的数：${cov.repeated.length ? spanText(cov.repeated) : '没有'}`,
    `读到 a 外面：${cov.outside.length} 次`,
  ].join('\n')
  const threads = launch.grid * launch.block

  if (cov.outside.length) {
    const d = cov.outside[0]
    return {
      symptom: `有 ${cov.outside.length} 次读到了 a 外面：比如 ${who(d, launch.grid)}要了 a[${d.index}]，a 只有 a[0]～a[${PART_N - 1}]。`,
      cause: 'i 算得太大了：拿数的位置超出了 a，读到的不是 a 里的数。',
      fix: `第 k 轮、第 t 个线程拿的数要落在 a[0]～a[${PART_N - 1}] 里：${threads} 个线程、每人 m 个，正好把 ${PART_N} 个数分完。`,
      raw,
    }
  }
  if (cov.missing.length || cov.repeated.length) {
    const r = cov.repeated[0]
    return {
      symptom: `${cov.missing.length} 个数没人加，${cov.repeated.length} 个数加了不止一次：比如 ${spanText(cov.missing)} 没人加，a[${r}] 加了 ${cov.counts[r]} 次。`,
      cause: `有的数被两个线程拿到了，或者被同一个线程拿了两轮。一共只拿 ${PART_N} 次，正好够每个数拿一次：有的数拿重了，就一定有数没人拿。`,
      fix: `让同一轮的 ${threads} 个线程各拿一个不同的数，下一轮接着往后拿，几轮下来正好把 a 拿一遍。`,
      raw,
    }
  }
  if (total !== PART_TOTAL) {
    return {
      symptom: `part 加起来是 ${total}，应该是 ${PART_TOTAL}。`,
      cause: '每个数都只拿了一次，可加出来的部分和没有原样存进 part。',
      fix: '只改 i 那一行，别的行保持原样：循环里把 a[i] 加到 s 上，最后把 s 存进 part[t]。',
      raw,
    }
  }
  return null
}

/** ★3 换派法再跑的那一次：哪里不成立，一句话；成立是 null。 */
function variantProblem(run: SandboxRun): string | null {
  const lead = `换成 ${run.launch.grid} 组、每组 ${run.launch.block} 个线程、每人加 ${VARIANT_M} 个再跑一次`
  const { result } = run
  if (!result.ok) return `${lead}，程序出错了：${result.error.message}`
  const cov = coverageOf(result)
  const threads = run.launch.grid * run.launch.block
  const jump = `第 k 轮往后跳的距离，要跟着线程数变：现在一共 ${threads} 个线程，第 1 轮该从 a[${threads}] 拿起。一共几个线程，工作单里写在 T 里。`
  if (cov.outside.length) return `${lead}，读到了 a 外面（比如 a[${cov.outside[0].index}]）。${jump}`
  if (cov.missing.length || cov.repeated.length) {
    return `${lead}：${spanText(cov.repeated)} 加了不止一次，${spanText(cov.missing)} 没人加。${jump}`
  }
  const cars = partCars(result.events)
  if (cars.transactions > cars.ideal) return `${lead}，搬了 ${cars.transactions} 车，理想 ${cars.ideal} 车（模拟）。同一轮里，相邻线程要拿相邻的数。`
  return null
}

/**
 * 挑战的星级判定（06 第 7 节）：runs[0] 是派 1 组 32 个线程、每人加 4 个的那一次，runs[1] 是换派法的那一次（PART_VARIANTS）。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」；★2 看车次等于理想；★3 看换派法以后 ★1、★2 照样成立。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, variant] = runs
  const error = wrong(main)
  if (error) return { earned: [false, false, false], next: error.fix, error }
  const cars = partCars(main.result.events)
  const spent = `一共搬了 ${cars.transactions} 车，理想 ${cars.ideal} 车（模拟）：读 a ${cars.read} 车，写 part ${cars.write} 车。`
  if (cars.transactions > cars.ideal) {
    const how = cars.gap > 1
      ? `第 0 轮，小队要的 ${WAVE} 个数隔 ${cars.gap} 个一个，散在 ${cars.firstRead} 车里。`
      : '有几次读 a，小队要的数没有挨在一起。'
    return { earned: [true, false, false], next: `${spent}${how}让同一轮里相邻的线程拿相邻的数。` }
  }
  const problem = variant ? variantProblem(variant) : '还没有换派法再跑一次。'
  if (problem) return { earned: [true, true, false], next: `${spent}${problem}` }
  return {
    earned: [true, true, true],
    next: `${spent}每一轮小队都拿挨着的 ${WAVE} 个数，一车不多搬；换成 ${VARIANT_LAUNCH.grid} 组、每人加 ${VARIANT_M} 个也照样成立。三颗星的标准都达到了。`,
  }
}

// ── 支线：如果让 Agent 来做 ─────────────────────────────────────────────

/** 支线的起点：每组 32 个线程（一支小队），步长 4，同探索一的默认步长。 */
export const AGENT_START: TuneConfig = { block: WAVE, stride: DEFAULT_STRIDE }

/**
 * 读者当 Agent 交卷：交出的参数算对、不多搬（控制台的 ★2），支线才算完成。
 * 只交卷不算：随手交一次就给经验值，不学也拿分（04 第 1 节）。
 */
export function agentSideDone(verdict: Verdict | null): boolean {
  return Boolean(verdict?.earned[1])
}
