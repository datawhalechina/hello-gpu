/**
 * 新手村 Boss 毕业考：三张坏工作单、一份提速报告和你的 Agent（纯函数，单测在 scripts/tests/novice-boss.test.mjs，06 第 7 节）。
 *
 * - 热身、探索一（scenes/Checkup.vue）：三张坏工作单原样跑一遍的体检单。三张算出来的数都对，坏在别处：
 *   第一张 add 的条件差一个（i <= n），多派的那个线程写到 c 外面（1-4）；第二张 two_jobs 每组前一半算和、后一半算差，
 *   一组 32 个线程正好一支小队，小队在岔路口分成两拨（1-5、1-6）；第三张 add 把线程号和组号用反了，相邻线程隔
 *   gridDim.x 个数，一支小队要的 32 个数散在 4 车里（1-4、1-8）。体检单上的数写在 CHECKUPS 里（模拟值，单测拿模拟器
 *   把两种写法都核对一遍）。
 * - 探索二（scenes/SpotReport.vue）：识破题。第三张改前、改后各量一次，改后那次没同步就看表，报告说快了 11.2 倍。
 *   计时照 1-11 的计时台：交出工作单 launchCycles 个周期，GPU 上算多少个周期取 L4 示意计时（就是体检单上的数）。
 * - 挑战一（scenes/FixSandbox.vue）：三道修复题，每道是 useChallenge 的分题（part）：判定只看自己（judgeFix），
 *   过没过驱动这道题自己的提示阶梯；每道都换一批数据或者换一种派法再跑一次，写死的数过不了。
 * - 挑战二（scenes/AgentExam.vue）：你的 Agent（A-02 的 AgentCode，A-01 的向量加法）从 block 16、步长 8 出发交卷（judgeAgent）。
 * - 本关三颗星（judge）：把各道分题最近一次的结果（BossState，存在本关的草稿槽里）合起来判：
 *   ★1 三张都修对（数全对、没有越界读写）；★2 第二、三张都不浪费（不分岔、不多搬车）；★3 Agent 交出三星参数。
 *
 * 只从模拟器导入类型和 L3、L4 的纯函数（analyzeMemory、estimateTime），不导入解释器：页面首屏不带它。周期数、车次都是模拟值。
 */
import { stageById } from '../../course/outline.ts'
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import { MAX_STEPS, type AgentAction, type Observation, type Verdict } from '../../course/agent/react.ts'
import { VECTOR_ADD_STARTER } from '../../course/agent/starter.ts'
import { describeConfig, VECTOR_ADD, type TuneConfig } from '../../course/agent/tasks.ts'
import type { Arg, SimEvent } from '../../sim/lockstep.ts'
import { analyzeMemory } from '../../sim/memory.ts'
import { SIM_PARAMS } from '../../sim/params.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { estimateTime } from '../../sim/timing.ts'
import { explainError, type Launch, type SandboxRun, type SandboxVariant } from '../../components/kit/sandbox/run.ts'
import { percent, prepareWave, usage, utilization } from '../../components/kit/wave-view/model.ts'

export const STAGE_ID = 'novice-boss'

/** 一支小队 32 个线程（wave32，1-5）。 */
export const WAVE = 32

/** 第 1-4 关的全局下标。 */
export const GLOBAL_INDEX = 'blockIdx.x * blockDim.x + threadIdx.x'

/** 正文和判定里提到的关卡编号，从大纲取（04 第 1 节）。 */
const code = (id: string) => stageById(id)?.code ?? ''
export const STAGE_CODES = {
  groups: code('novice-thread-groups'),
  wavefront: code('novice-wavefront'),
  divergence: code('novice-divergence'),
  coalescing: code('novice-coalescing'),
  timing: code('novice-timing'),
  firstAgent: code('novice-first-agent'),
}

// ── 三张坏工作单 ──────────────────────────────────────────────────────────

export type FixPart = 'oob' | 'fork' | 'stride'
export const FIX_PARTS: readonly FixPart[] = ['oob', 'fork', 'stride']

/** 第一张、第二张、第三张：体检之前只按顺序叫。 */
export const FIX_NAMES: Readonly<Record<FixPart, string>> = { oob: '第一张', fork: '第二张', stride: '第三张' }
/** 体检以后才说出来的毛病。 */
export const FIX_TOPICS: Readonly<Record<FixPart, string>> = { oob: '越界', fork: '分支发散', stride: '非合并访存' }

/** 每排 n 个数：a[k] = k + 1，b[k] = 10 × (k + 1)（同前几关），c 一开始全是 0。和 c[k] = 11 × (k + 1)。 */
export function addArgs(n: number): Record<string, Arg> {
  const a = Array.from({ length: n }, (_, k) => k + 1)
  return {
    a: { type: 'float', data: a },
    b: { type: 'float', data: a.map((v) => 10 * v) },
    c: { type: 'float', data: new Array<number>(n).fill(0) },
    n: { type: 'int', value: n },
  }
}

/** 第二张的数据：再多一排 d 放差，d[k] = −9 × (k + 1)。 */
export function jobArgs(n: number): Record<string, Arg> {
  return { ...addArgs(n), d: { type: 'float', data: new Array<number>(n).fill(0) } }
}

/** 第 k 格的正确值：c 是和，d 是差。 */
const EXPECTED: Readonly<Record<string, (k: number) => number>> = {
  c: (k) => 11 * (k + 1),
  d: (k) => -9 * (k + 1),
}

/** 手机上的空：名字（读屏）和选项。 */
export interface FixBlank {
  label: string
  choices: readonly string[] | Readonly<Record<Lang, readonly string[]>>
}

export interface FixSetup {
  part: FixPart
  kernel: 'add' | 'two_jobs'
  /** 一句话：这张工作单做什么、派多少线程 */
  brief: string
  /** 模板：[[名字: 初始内容]] 标出空（kit/sandbox/template.ts），初始内容就是坏的那一处 */
  code: Record<Lang, string>
  blanks: Readonly<Record<string, FixBlank>>
  /** 坏在哪几行（两种写法的行号，从 1 数）：体检时标出来，也就是修复题里空所在的行 */
  badLines: Readonly<Record<Lang, readonly number[]>>
  launch: Launch
  /** 每排多少个数 */
  n: number
  args: Record<string, Arg>
  /** 同一份代码换一批数据或者换一种派法再跑一次：写死的数过不了 */
  variants: SandboxVariant[]
  /** variants 那一次的一句话 */
  variantText: string
}

const OOB_CODE: Record<Lang, string> = {
  hip: `__global__ void add(float* a, float* b, float* c, int n) {
    int i = ${GLOBAL_INDEX};
    if ([[guard: i <= n]]) {
        c[i] = a[i] + b[i];
    }
}`,
  python: `@kernel
def add(a, b, c, n):
    i = ${GLOBAL_INDEX}
    if [[guard: i <= n]]:
        c[i] = a[i] + b[i]`,
}

const FORK_CODE: Record<Lang, string> = {
  hip: `__global__ void two_jobs(float* a, float* b, float* c, float* d, int n) {
    int t = ${GLOBAL_INDEX};
    int half = blockDim.x / 2;
    int k = [[k: blockIdx.x * half + threadIdx.x % half]];
    if ([[job: threadIdx.x < half]]) {
        c[k] = a[k] + b[k];
    } else {
        d[k] = a[k] - b[k];
    }
}`,
  python: `@kernel
def two_jobs(a, b, c, d, n):
    t = ${GLOBAL_INDEX}
    half = blockDim.x // 2
    k = [[k: blockIdx.x * half + threadIdx.x % half]]
    if [[job: threadIdx.x < half]]:
        c[k] = a[k] + b[k]
    else:
        d[k] = a[k] - b[k]`,
}

const STRIDE_CODE: Record<Lang, string> = {
  hip: `__global__ void add(float* a, float* b, float* c, int n) {
    int i = [[i: threadIdx.x * gridDim.x + blockIdx.x]];
    if (i < n) {
        c[i] = a[i] + b[i];
    }
}`,
  python: `@kernel
def add(a, b, c, n):
    i = [[i: threadIdx.x * gridDim.x + blockIdx.x]]
    if i < n:
        c[i] = a[i] + b[i]`,
}

const OOB_N = 63
const OOB_VARIANT_N = 40
const FORK_N = 64
const FORK_VARIANT_N = 32
const STRIDE_N = 128

export const FIXES: Readonly<Record<FixPart, FixSetup>> = {
  oob: {
    part: 'oob',
    kernel: 'add',
    brief: `add：${OOB_N} 个数，派 2 组、每组 ${WAVE} 个线程`,
    code: OOB_CODE,
    blanks: { guard: { label: '写入前的条件', choices: ['i <= n', 'i < n', `i < ${OOB_N}`, 'i != n'] } },
    badLines: { hip: [3], python: [4] },
    launch: { grid: 2, block: WAVE },
    n: OOB_N,
    args: addArgs(OOB_N),
    variants: [{ args: addArgs(OOB_VARIANT_N) }],
    variantText: `换成 ${OOB_VARIANT_N} 个数（派法不变）`,
  },
  fork: {
    part: 'fork',
    kernel: 'two_jobs',
    brief: `two_jobs：${FORK_N} 个和、${FORK_N} 个差，派 4 组、每组 ${WAVE} 个线程，每组前一半算和、后一半算差`,
    code: FORK_CODE,
    blanks: {
      k: {
        label: '这个线程算第几格 k',
        choices: {
          hip: ['blockIdx.x * half + threadIdx.x % half', 't % n', 't / 2', 't'],
          python: ['blockIdx.x * half + threadIdx.x % half', 't % n', 't // 2', 't'],
        },
      },
      job: { label: '算和的条件', choices: ['threadIdx.x < half', 't < n', 't % 2 == 0', 'blockIdx.x < 2'] },
    },
    badLines: { hip: [4, 5], python: [5, 6] },
    launch: { grid: 4, block: WAVE },
    n: FORK_N,
    args: jobArgs(FORK_N),
    variants: [{ grid: 2, block: WAVE, args: jobArgs(FORK_VARIANT_N) }],
    variantText: `换成 ${FORK_VARIANT_N} 个和、${FORK_VARIANT_N} 个差（派 2 组、每组 ${WAVE} 个线程）`,
  },
  stride: {
    part: 'stride',
    kernel: 'add',
    brief: `add：${STRIDE_N} 个数，派 4 组、每组 ${WAVE} 个线程`,
    code: STRIDE_CODE,
    blanks: {
      i: {
        label: '下标 i',
        choices: ['threadIdx.x * gridDim.x + blockIdx.x', GLOBAL_INDEX, `blockIdx.x * ${WAVE} + threadIdx.x`, 'threadIdx.x * 4 + blockIdx.x'],
      },
    },
    badLines: { hip: [2], python: [3] },
    launch: { grid: 4, block: WAVE },
    n: STRIDE_N,
    args: addArgs(STRIDE_N),
    variants: [{ grid: 2, block: 2 * WAVE }],
    variantText: `换成派 2 组、每组 ${2 * WAVE} 个线程（还是 ${STRIDE_N} 个数）`,
  },
}

/** 启动那一行（1-2 定的写法）：先写派几组，再写每组几个线程。 */
export function launchLine(part: FixPart, lang: Lang, launch: Launch = FIXES[part].launch): string {
  const { kernel } = FIXES[part]
  const args = kernel === 'two_jobs' ? 'd_a, d_b, d_c, d_d, n' : 'd_a, d_b, d_c, n'
  return lang === 'hip' ? `${kernel}<<<${launch.grid}, ${launch.block}>>>(${args});` : `${kernel}[${launch.grid}, ${launch.block}](${args})`
}

// ── 一次运行的样子 ────────────────────────────────────────────────────────

/** 一排数（c 或 d）运行以后的样子。 */
export interface ArrayCheck {
  name: string
  length: number
  /** 没人写的格子 */
  missing: number[]
  /** 被写了不止一次的格子 */
  duplicates: number[]
  /** 值不对的格子（没人写的也算） */
  wrong: number[]
  /** 写到这排数外面的下标，按下标排序，不重复 */
  outside: number[]
}

export interface RunCheck {
  arrays: ArrayCheck[]
  /** 写到数组外面几次（几个线程写到了外面） */
  outsideWrites: number
  /** 读到数组外面几次 */
  oobReads: number
  /** 读到外面的数组名，按出现的先后 */
  oobReadArrays: string[]
  /** 数全对，一次越界读写都没有 */
  correct: boolean
}

/** 看一次运行：每排数有没有没人算、算重了、算错的格子，写到外面、读到外面几次。 */
export function checkRun(run: SandboxRun): RunCheck {
  const { result } = run
  const arrays: ArrayCheck[] = []
  for (const name of Object.keys(EXPECTED)) {
    const values = result.arrays[name]
    if (!values) continue
    const writers = new Array<number>(values.length).fill(0)
    for (const e of result.events) {
      if (e.op !== 'store' || e.array !== name) continue
      for (const index of e.addrs ?? []) if (index >= 0 && index < values.length) writers[index]++
    }
    const want = EXPECTED[name]
    const outside = [...new Set(result.outside.filter((o) => o.array === name && o.writes.length).map((o) => o.index))].sort((x, y) => x - y)
    arrays.push({
      name,
      length: values.length,
      missing: writers.flatMap((w, k) => (w === 0 ? [k] : [])),
      duplicates: writers.flatMap((w, k) => (w > 1 ? [k] : [])),
      wrong: values.flatMap((v, k) => (v === want(k) ? [] : [k])),
      outside,
    })
  }
  const outsideWrites = result.outside.reduce((sum, o) => sum + o.writes.length, 0)
  const reads = result.diagnostics.filter((d) => d.kind === 'oob-read')
  const correct = result.ok && outsideWrites === 0 && reads.length === 0 && arrays.every((a) => a.wrong.length === 0)
  return {
    arrays,
    outsideWrites,
    oobReads: reads.length,
    oobReadArrays: [...new Set(reads.map((d) => d.array))],
    correct,
  }
}

/** lane 利用率（0–1）：每一步干活的 lane 加起来，除以每一步的全部 lane（WaveView 的算法，模拟）。 */
export function laneRate(run: SandboxRun): number {
  return utilization(usage(prepareWave(run.result, run.launch)))
}

/** 在岔路口分成两拨的小队有几支：同一支小队里有的 lane 写 c、有的写 d。 */
export function splitSquads(run: SandboxRun): number {
  const seen = new Map<string, Set<string>>()
  for (const e of run.result.events) {
    if (e.op !== 'store' || !e.array) continue
    const key = `${e.block}:${e.wave}`
    const set = seen.get(key) ?? new Set<string>()
    set.add(e.array)
    seen.set(key, set)
  }
  return [...seen.values()].filter((s) => s.size > 1).length
}

/** 读写显存一共搬了几车、理想几车（L3 的 analyzeMemory，模拟）。 */
export function carsOf(events: readonly SimEvent[]): { accesses: number; transactions: number; ideal: number } {
  const m = analyzeMemory(events)
  return { accesses: m.accesses.length, transactions: m.summary.transactions, ideal: m.summary.ideal }
}

/** 第一次读显存时，一支小队里相邻两个线程拿的数隔几个（看前两个 lane）。 */
export function neighborGap(events: readonly SimEvent[]): number | null {
  const first = events.find((e) => e.op === 'load' && e.space === 'global' && (e.addrs?.length ?? 0) >= 2)
  return first?.addrs ? first.addrs[1] - first.addrs[0] : null
}

/** 一串下标写成「c[16]～c[31]」「c[1]、c[3]」：连着三个以上的并成一段，最多写 limit 段。 */
export function cellList(array: string, indices: readonly number[], limit = 3): string {
  const runs: [number, number][] = []
  for (const k of indices) {
    const last = runs[runs.length - 1]
    if (last && k === last[1] + 1) last[1] = k
    else runs.push([k, k])
  }
  const parts = runs.slice(0, limit).map(([from, to]) => (
    to - from >= 2 ? `${array}[${from}]～${array}[${to}]` : from === to ? `${array}[${from}]` : `${array}[${from}]、${array}[${to}]`
  ))
  return runs.length > limit ? `${parts.join('、')} 等` : parts.join('、')
}

// ── 体检单（热身、探索一）─────────────────────────────────────────────────

/** 一张坏工作单原样跑一遍：Agent 的三样工具各看到什么（模拟；单测拿模拟器核对）。 */
export interface Checkup {
  /** 算错的数 */
  wrong: number
  /** 写到数组外面几次、读到外面几次 */
  outsideWrites: number
  oobReads: number
  /** 示意时间（周期）和 lane 利用率（0–1） */
  cycles: number
  laneUse: number
  /** 读写显存几次、一共搬了几车、理想几车 */
  accesses: number
  transactions: number
  ideal: number
}

export const CHECKUPS: Readonly<Record<FixPart, Checkup>> = {
  oob: { wrong: 0, outsideWrites: 1, oobReads: 2, cycles: 30, laneUse: 1, accesses: 6, transactions: 6, ideal: 6 },
  fork: { wrong: 0, outsideWrites: 0, oobReads: 0, cycles: 120, laneUse: 640 / 768, accesses: 24, transactions: 24, ideal: 24 },
  stride: { wrong: 0, outsideWrites: 0, oobReads: 0, cycles: 204, laneUse: 1, accesses: 12, transactions: 48, ideal: 12 },
}

/** 修好以后（参考答案）同样体检一遍的数：判定和正文拿它比改前改后（模拟；单测核对）。 */
export const FIXED: Readonly<Record<'fork' | 'stride', Pick<Checkup, 'cycles' | 'accesses' | 'transactions' | 'ideal'>>> = {
  fork: { cycles: 68, accesses: 12, transactions: 12, ideal: 12 },
  stride: { cycles: 60, accesses: 12, transactions: 12, ideal: 12 },
}

/** 参考答案：每个空填什么（两种写法一样；HIP 的 / 和 Python 的 // 这几个空都用不到）。 */
export const ANSWERS: Readonly<Record<FixPart, Readonly<Record<string, string>>>> = {
  oob: { guard: 'i < n' },
  fork: { k: 't % n', job: 't < n' },
  stride: { i: GLOBAL_INDEX },
}

/** 体检单的一行：哪样工具、看到什么、正常还是有问题。 */
export interface CheckRow {
  tool: 'run_kernel' | 'measure' | 'inspect_memory'
  name: string
  text: string
  bad: boolean
}

export function checkupRows(part: FixPart): CheckRow[] {
  const c = CHECKUPS[part]
  const { n } = FIXES[part]
  const numbers = part === 'fork' ? `${n} 个和、${n} 个差` : `${n} 个数`
  const away = c.outsideWrites
    ? `，可有 ${c.outsideWrites} 个线程写到了 c 外面，还读了 ${c.oobReads} 次数组外面`
    : '，没有越界'
  return [
    { tool: 'run_kernel', name: '运行', text: `${numbers}都对${away}。`, bad: c.outsideWrites + c.oobReads > 0 },
    { tool: 'measure', name: '计时', text: `示意时间 ${c.cycles} 个周期，lane 利用率 ${percent(c.laneUse)}。`, bad: c.laneUse < 1 },
    { tool: 'inspect_memory', name: '看访存', text: `读写显存 ${c.accesses} 次，搬了 ${c.transactions} 车，理想 ${c.ideal} 车。`, bad: c.transactions > c.ideal },
  ]
}

/** 体检单下面那一句：毛病出在哪、为什么、该回哪一关。 */
export function checkupText(part: FixPart): string {
  const c = CHECKUPS[part]
  if (part === 'oob') {
    return `数都对，毛病在数组外面：c 只有 ${FIXES.oob.n} 格，派了 ${FIXES.oob.launch.grid * FIXES.oob.launch.block} 个线程，条件 i <= n 放过了 i 等于 ${FIXES.oob.n} 的那一个，它把和写进了 c[${FIXES.oob.n}]。这是第 ${STAGE_CODES.groups} 关的边界检查。`
  }
  if (part === 'fork') {
    return `数都对，毛病在计时：每组 ${WAVE} 个线程正好一支小队，前一半算和、后一半算差，每支小队都在岔路口分成两拨，lane 利用率只有 ${percent(c.laneUse)}。两拨还要各读写一遍显存，所以读写了 ${c.accesses} 次。这是第 ${STAGE_CODES.divergence} 关的分支发散。`
  }
  return `数都对，毛病在访存：线程号乘上了组数，相邻两个线程拿的数隔 ${FIXES.stride.launch.grid} 个，一支小队要的 ${WAVE} 个数散在 ${c.transactions / c.ideal} 车里，搬了 ${c.transactions} 车，理想只要 ${c.ideal} 车。这是第 ${STAGE_CODES.coalescing} 关的合并访存。`
}

// ── 挑战一：三道修复题的判定（分题，只看自己）──────────────────────────────

/** 每道修复题最近一次运行的结果：数修对没有，这道题过没过（第二、三张还要不浪费）。 */
export interface FixRecord {
  correct: boolean
  passed: boolean
}

/** 修复题的提示：没过第 2、4、6 次依次解锁（03 第 4 节）。 */
export const FIX_HINTS: Readonly<Record<FixPart, Hints>> = {
  oob: {
    direction: '数都对，可运行结果里写着越界：看是哪个线程写到了外面，它的 i 是多少。',
    location: `看 if 后面的条件：c 有 n 格，最后一格是 c[n − 1]。i 等于 n 的那个线程，该不该放过去？`,
    answer: '条件写成 i < n。',
  },
  fork: {
    direction: `先数一数：一支小队 ${WAVE} 个线程，这次一组也是 ${WAVE} 个线程，一组正好是一支小队。`,
    location: '看 k 和 if 后面的条件：按组里的前一半、后一半分活，同一支小队就分成了两拨。改成按全局下标 t 分：前 n 个线程算和，后 n 个算差。',
    answer: 'k 写成 t % n，条件写成 t < n。',
  },
  stride: {
    direction: '数都对，可搬的车比理想多：看一支小队里相邻两个线程拿的数隔几个。',
    location: '看算 i 的那一行：线程号乘上了组数，相邻线程隔 gridDim.x 个数。',
    answer: `i 写成 ${GLOBAL_INDEX}。`,
  },
}

/** 越界的一句：几个线程写到了哪些格子外面、读了几次外面。 */
function outsideText(check: RunCheck): string {
  const parts: string[] = []
  const away = check.arrays.filter((a) => a.outside.length)
  if (check.outsideWrites) {
    const where = away.map((a) => cellList(a.name, a.outside)).join('、')
    parts.push(`${check.outsideWrites} 个线程写到了数组外面（${where}）`)
  }
  if (check.oobReads) parts.push(`读到 ${check.oobReadArrays.join('、')} 外面 ${check.oobReads} 次`)
  return parts.join('，')
}

/** 数不对的一句：哪排数哪些格子没人算、算重了、算错了。 */
function wrongText(check: RunCheck): string {
  const parts: string[] = []
  for (const a of check.arrays) {
    if (a.missing.length) parts.push(`${cellList(a.name, a.missing)} 没人算`)
    if (a.duplicates.length) parts.push(`${cellList(a.name, a.duplicates)} 被不止一个线程算了`)
    const odd = a.wrong.filter((k) => !a.missing.includes(k))
    if (odd.length && !a.duplicates.length) parts.push(`${cellList(a.name, odd)} 的值不对`)
  }
  return parts.join('；')
}

/** 数不对、或者有越界读写时：现象 / 原因 / 怎么改（03 第 4 节）。variant 是不是换了数据或派法的那一次。 */
function correctError(part: FixPart, run: SandboxRun, check: RunCheck, variant: boolean): ChallengeError {
  const setup = FIXES[part]
  const lead = variant ? `${setup.variantText}再跑一次：` : ''
  const raw = check.arrays.map((a) => `运行后 ${a.name} = [${(run.result.arrays[a.name] ?? []).join(', ')}]`).join('\n')
  const bad = [wrongText(check), outsideText(check)].filter(Boolean).join('；')
  const symptom = `${lead}${bad}。`
  if (variant) {
    return {
      symptom,
      cause: part === 'oob'
        ? `原来的数据只多派了 ${FIXES.oob.launch.grid * FIXES.oob.launch.block - FIXES.oob.n} 个线程，拦住 i 等于 ${FIXES.oob.n} 的那一个就够了；换成 ${OOB_VARIANT_N} 个数，多出来 ${FIXES.oob.launch.grid * FIXES.oob.launch.block - OOB_VARIANT_N} 个线程。条件里写死具体的数、或者只拦 i 等于 n，都会放过 i 比 n 大的线程。`
        : part === 'fork'
          ? '分活的界线写死了具体的数（或者组号）：换一批数据、少派两组，界线就对不上了。'
          : `下标里写死了每组 ${WAVE} 个线程：换成每组 ${2 * WAVE} 个，相邻两组算的格子就叠在一起了。`,
      fix: part === 'oob' ? '条件写成 i < n：i 不小于 n 的线程一个都不放过。' : part === 'fork' ? '条件和 k 都用 t 和 n 来写。' : `用 blockDim.x，不要写死 ${WAVE}：${GLOBAL_INDEX}。`,
      raw,
    }
  }
  if (part === 'oob' && check.outsideWrites + check.oobReads > 0 && !wrongText(check)) {
    return {
      symptom,
      cause: `c 只有 ${setup.n} 格，最后一格是 c[${setup.n - 1}]。派了 ${setup.launch.grid * setup.launch.block} 个线程，条件放过了 i 不小于 n 的线程，它照着工作单写 c[i]，就写到了外面。`,
      fix: '条件要拦住 i 不小于 n 的线程：写成 i < n。',
      raw,
    }
  }
  if (part === 'oob') {
    return {
      symptom,
      cause: '条件把该算的线程也拦在了外面：i 是 0～n − 1 的线程都要算。',
      fix: '条件写成 i < n：i 是 0～n − 1 的线程都过，i 等于 n 和更大的都拦住。',
      raw,
    }
  }
  if (part === 'fork') {
    return {
      symptom,
      cause: '每个线程正好算一格：算和的线程要把 c 的 n 格各算一次，算差的把 d 的 n 格各算一次。k 和条件要配得上：条件成立的线程，k 从 0 数到 n − 1；不成立的也一样。',
      fix: '条件写成 t < n（前 n 个线程算和），k 写成 t % n（后 n 个线程的 k 也从 0 数起）。',
      raw,
    }
  }
  return {
    symptom,
    cause: '有的格子没人算、有的被算了两次：下标没有让每个线程各拿一格。',
    fix: `下标写成全局下标：${GLOBAL_INDEX}。`,
    raw,
  }
}

/** 第二张不浪费没有：两次运行都没有小队分岔。 */
function forkWaste(runs: readonly SandboxRun[]): ChallengeError | null {
  for (const [i, run] of runs.entries()) {
    const rate = laneRate(run)
    if (rate >= 1) continue
    const squads = splitSquads(run)
    const lead = i > 0 ? `${FIXES.fork.variantText}再跑一次：` : ''
    return {
      symptom: `${lead}和、差都对，可 ${squads} 支小队在岔路口分成了两拨：有的 lane 算和、有的算差，lane 利用率 ${percent(rate)}（模拟）。`,
      cause: `同一支小队里有的线程走 if、有的走 else：两条路只能先后各走一遍，走一条的时候另一拨 lane 空等（第 ${STAGE_CODES.divergence} 关）。这次每组 ${WAVE} 个线程，一组正好一支小队。`,
      fix: '让整支小队走同一边：前 n 个线程都算和、后 n 个都算差，界线落在两支小队中间；k 跟着改成这个线程算第几格。',
    }
  }
  return null
}

/** 第三张不浪费没有：两次运行搬的车都等于理想车数。 */
function strideWaste(runs: readonly SandboxRun[]): ChallengeError | null {
  for (const [i, run] of runs.entries()) {
    const cars = carsOf(run.result.events)
    if (cars.transactions <= cars.ideal) continue
    const gap = neighborGap(run.result.events)
    const lead = i > 0 ? `${FIXES.stride.variantText}再跑一次：` : ''
    return {
      symptom: `${lead}数都对，可读写显存搬了 ${cars.transactions} 车，理想只要 ${cars.ideal} 车（模拟）。`,
      cause: `一支小队里相邻两个线程拿的数${gap === null ? '离得远' : `隔 ${gap} 个`}：一车装 ${WAVE} 个挨着的数，这支小队要的数散在好几车里（第 ${STAGE_CODES.coalescing} 关）。`,
      fix: `让相邻的线程拿相邻的数：组号 × 每组线程数 + 线程号，也就是全局下标 ${GLOBAL_INDEX}（第 ${STAGE_CODES.groups} 关）。`,
    }
  }
  return null
}

/** 一道修复题这次的结果：数修对没有、过没过（存进 BossState，本关三颗星合起来判）。 */
export function fixRecord(part: FixPart, runs: readonly SandboxRun[]): FixRecord {
  const [main] = runs
  if (!main?.result.ok) return { correct: false, passed: false }
  const correct = runs.length === 1 + FIXES[part].variants.length && runs.every((run) => checkRun(run).correct)
  if (!correct) return { correct: false, passed: false }
  if (part === 'fork') return { correct, passed: forkWaste(runs) === null }
  if (part === 'stride') return { correct, passed: strideWaste(runs) === null }
  return { correct, passed: true }
}

/**
 * 一道修复题过没过（分题的判定，只看自己；06 第 7 节的格式，只用到 earned[0]）：
 * runs[0] 是工作单原来的数据和派法，runs[1] 是 variants 那一次。
 * 第一张：两次都数全对、没有越界读写；第二张还要两次都没有小队分岔；第三张还要两次搬的车都等于理想车数。
 * 没过时给「现象 / 原因 / 怎么改」。
 */
export function judgeFix(part: FixPart, runs: readonly SandboxRun[]): AttemptResult {
  const [main, ...others] = runs
  if (!main.result.ok) {
    const error = explainError(main.result.error)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const failed = (error: ChallengeError): AttemptResult => ({ earned: [false, false, false], next: error.fix, error })
  const check = checkRun(main)
  if (!check.correct) return failed(correctError(part, main, check, false))
  if (!others.length) {
    return failed({ symptom: '换一批数据的那一次没有跑。', cause: '代码出错停下了，或者运行被打断了。', fix: '再点一次「运行」。' })
  }
  for (const other of others) {
    if (!other.result.ok) return failed(explainError(other.result.error))
    const alt = checkRun(other)
    if (!alt.correct) return failed(correctError(part, other, alt, true))
  }
  const setup = FIXES[part]
  if (part === 'fork') {
    const waste = forkWaste(runs)
    if (waste) return failed(waste)
    const now = estimateTime(main.result.events).cycles
    const cars = carsOf(main.result.events)
    return {
      earned: [true, false, false],
      next: `每支小队都整队只走一边，lane 利用率 100%；读写显存从 ${CHECKUPS.fork.accesses} 次降到 ${cars.accesses} 次，示意时间从 ${CHECKUPS.fork.cycles} 降到 ${now} 个周期（模拟）。${setup.variantText}也一样。`,
    }
  }
  if (part === 'stride') {
    const waste = strideWaste(runs)
    if (waste) return failed(waste)
    const now = estimateTime(main.result.events).cycles
    const cars = carsOf(main.result.events)
    return {
      earned: [true, false, false],
      next: `相邻线程拿相邻的数：搬了 ${cars.transactions} 车，等于理想车数；示意时间从 ${CHECKUPS.stride.cycles} 降到 ${now} 个周期（模拟）。${setup.variantText}也一样。`,
    }
  }
  return {
    earned: [true, false, false],
    next: `${setup.n} 个数都对，没有越界：i 等于 ${setup.n} 的那个线程被条件拦住了。${setup.variantText}也一样。`,
  }
}

// ── 探索二：一份提速报告（识破题）─────────────────────────────────────────

/** 交出一张工作单占 CPU 几个周期（params.ts，示意值，同 1-11）。 */
export const LAUNCH_CYCLES = SIM_PARAMS.launchCycles
/** 报告量的是第三张：改前、改后在 GPU 上各算多少个周期（L4 示意计时，同体检单）。 */
export const SPOT_GPU = { before: CHECKUPS.stride.cycles, after: FIXED.stride.cycles }

/** 时间线上的一段：CPU 交出工作单、CPU 等 GPU、GPU 算一份工作单。 */
export interface SpotSegment {
  lane: 'cpu' | 'gpu'
  kind: 'launch' | 'wait' | 'run'
  which: 'before' | 'after'
  from: number
  to: number
}

export interface SpotSession {
  segments: SpotSegment[]
  /** 三次看表的时刻 */
  t0: number
  t1: number
  t2: number
  /** CPU 和 GPU 都做完的时刻：时间线画到这里 */
  end: number
  /** 量到的：改前 t1 − t0，改后 t2 − t1 */
  before: number
  after: number
}

/**
 * 照报告的计时代码走一遍（1-11 的计时台，两版都预热过，所以没有第一次启动的准备）：
 * 看表 → 启动改前 → 同步 → 看表 → 启动改后 →（sync 时同步）→ 看表。
 */
export function spotSession(sync: boolean): SpotSession {
  const segments: SpotSegment[] = []
  const t0 = 0
  let cpu = t0
  segments.push({ lane: 'cpu', kind: 'launch', which: 'before', from: cpu, to: cpu + LAUNCH_CYCLES })
  cpu += LAUNCH_CYCLES
  let gpu = cpu + SPOT_GPU.before
  segments.push({ lane: 'gpu', kind: 'run', which: 'before', from: cpu, to: gpu })
  segments.push({ lane: 'cpu', kind: 'wait', which: 'before', from: cpu, to: gpu })
  cpu = gpu
  const t1 = cpu
  segments.push({ lane: 'cpu', kind: 'launch', which: 'after', from: cpu, to: cpu + LAUNCH_CYCLES })
  cpu += LAUNCH_CYCLES
  gpu = cpu + SPOT_GPU.after
  segments.push({ lane: 'gpu', kind: 'run', which: 'after', from: cpu, to: gpu })
  if (sync) {
    segments.push({ lane: 'cpu', kind: 'wait', which: 'after', from: cpu, to: gpu })
    cpu = gpu
  }
  const t2 = cpu
  return { segments, t0, t1, t2, end: Math.max(cpu, gpu), before: t1 - t0, after: t2 - t1 }
}

/** 倍数：一位小数。 */
export function times(before: number, after: number): string {
  return (before / after).toFixed(1)
}

/** 报告上写的（改后那次没同步）和补上同步以后量到的。 */
export const SPOT_REPORT = spotSession(false)
export const SPOT_FIXED = spotSession(true)

/** 存档里这道识破题的编号：只记第一次锁定的答案（同先猜，progress 的 recordPrediction）。 */
export const SPOT_ID = 'boss-spot'

export interface SpotOption {
  label: string
  correct?: boolean
  why: string
}

export const SPOT_OPTIONS: readonly SpotOption[] = [
  {
    label: '没预热：改前那次多算了第一次启动的准备',
    why: '两版都先空跑了一次，等它们算完才开始计时：第一次启动的准备落在预热里，计时里没有它。',
  },
  {
    label: '改后那次没同步就看表：量到的只是交出工作单的时间',
    correct: true,
    why: `启动是异步的：交出工作单 ${LAUNCH_CYCLES} 个周期，CPU 就去看表了，GPU 才刚开工。改后量到的 ${SPOT_REPORT.after} 个周期，正好是交出一张工作单的时间，GPU 算的那 ${SPOT_GPU.after} 个周期一点都没量到。`,
  },
  {
    label: `没问题：第三张改完少搬了 ${CHECKUPS.stride.transactions - FIXED.stride.transactions} 车，快这么多正常`,
    why: `少搬车确实会变快，可改后的工作单在 GPU 上也要算 ${SPOT_GPU.after} 个周期（模拟），量到的 ${SPOT_REPORT.after} 个周期连这都不够。`,
  },
  {
    label: '改前那次多同步了一次，所以量多了',
    why: '停表前同步是对的：等 GPU 算完再看表，量到的才是它算了多久。不该少的是改后那一次。',
  },
]

/** 不选、直接看答案：存档里记成 -1，和没锁定过分开（同先猜）。 */
export const SPOT_SKIPPED = -1

/** 识破题用到的那部分进度存档接口（useProgress 的返回值就是；单测直接传它）。 */
export interface SpotStore {
  prediction: (id: string) => { choice: number; correct: boolean } | null
  recordPrediction: (id: string, choice: number, correct: boolean, stage?: string) => unknown
  checkBadges: (ctx: { stage?: string; spotted?: boolean }) => string[]
}

/**
 * 锁定识破题的答案（choice 是 SPOT_OPTIONS 的序号，或者 SPOT_SKIPPED）：只记第一次（同先猜），
 * 第一次就选对，发「识破假加速」徽章（04 第 4 节：在任意「识破」环节选对）。返回这次新发的徽章。
 */
export function lockSpot(store: SpotStore, choice: number): string[] {
  if (store.prediction(SPOT_ID)) return []
  const correct = Boolean(SPOT_OPTIONS[choice]?.correct)
  store.recordPrediction(SPOT_ID, choice, correct, STAGE_ID)
  return correct ? store.checkBadges({ stage: STAGE_ID, spotted: true }) : []
}

/** 时间线下面的一句：报告的量法，或者补上同步以后。 */
export function spotText(sync: boolean): string {
  const s = sync ? SPOT_FIXED : SPOT_REPORT
  if (!sync) {
    return `改后那次交出工作单就看表：t2 − t1 = ${s.after} 个周期，可 GPU 还要再算 ${SPOT_GPU.after} 个周期才做完。算出来快了 ${times(s.before, s.after)} 倍，这是假的（模拟）。`
  }
  return `补上同步，t2 落在 GPU 算完的那一刻：改后 ${s.after} 个周期，改前 ${s.before} 个周期，快了 ${times(s.before, s.after)} 倍（模拟）。少搬车是真的变快了，只是没有 ${times(SPOT_REPORT.before, SPOT_REPORT.after)} 倍。`
}

/** 计时代码的一行：mark 是补上的那一行（补同步以后标出来）。 */
export interface SpotLine {
  code: string
  note: string
  mark: boolean
}

const SPOT_CALL: Readonly<Record<'old' | 'new', Record<Lang, string>>> = {
  old: { hip: 'add_old<<<4, 32>>>(d_a, d_b, d_c, n);', python: 'add_old[4, 32](d_a, d_b, d_c, n)' },
  new: { hip: 'add_new<<<4, 32>>>(d_a, d_b, d_c, n);', python: 'add_new[4, 32](d_a, d_b, d_c, n)' },
}
const SPOT_SYNC: Record<Lang, string> = { hip: 'hipDeviceSynchronize();', python: 'synchronize()' }
const SPOT_COMMENT: Record<Lang, string> = { hip: '//', python: '#' }

/** 报告里的计时代码（两种写法一行对一行）；sync 时在改后那次看表之前补上同步。 */
export function spotLines(lang: Lang, sync: boolean): SpotLine[] {
  const now = (name: string) => (lang === 'hip' ? `double ${name} = now();` : `${name} = now()`)
  const lines: SpotLine[] = [
    { code: SPOT_CALL.old[lang], note: '预热：两版各空跑一次', mark: false },
    { code: SPOT_CALL.new[lang], note: '', mark: false },
    { code: SPOT_SYNC[lang], note: '等它们算完', mark: false },
    { code: now('t0'), note: '看表', mark: false },
    { code: SPOT_CALL.old[lang], note: '量改前', mark: false },
    { code: SPOT_SYNC[lang], note: '', mark: false },
    { code: now('t1'), note: '', mark: false },
    { code: SPOT_CALL.new[lang], note: '量改后', mark: false },
  ]
  if (sync) lines.push({ code: SPOT_SYNC[lang], note: '补上：等 GPU 算完', mark: true })
  lines.push({ code: now('t2'), note: '', mark: false })
  return lines
}

/** 一行写出来的样子：行尾注释对齐到同一列（同 1-11）。 */
export function spotCode(lang: Lang, sync: boolean): string[] {
  const lines = spotLines(lang, sync)
  const column = Math.max(...lines.map((l) => l.code.length)) + 2
  return lines.map((l) => (l.note ? `${l.code}${' '.repeat(column - l.code.length)}${SPOT_COMMENT[lang]} ${l.note}` : l.code))
}

// ── 挑战二：你的 Agent ─────────────────────────────────────────────────────

/** Agent 调的还是 A-01 的向量加法（1-13、1-14）。 */
export const AGENT_TASK = VECTOR_ADD
/** 读者补的那份 Python Agent（A-02）：模板、三个空、参考答案。 */
export const STARTER = VECTOR_ADD_STARTER
/** 起点：最小的组、最大的步长，两条规则都要用上（1-13、1-14 都没从这里出发过）。 */
export const AGENT_START: TuneConfig = { block: 16, stride: 8 }
/** 规则 Agent（三个空都补对）从这里出发：停过的参数和步数（单测拿 rules.ts 核对）。 */
export const AGENT_TOUR = {
  path: [AGENT_START, { block: 16, stride: 1 }, { block: 32, stride: 1 }] as readonly TuneConfig[],
  steps: 10,
}
/** 第 1-14 关存三个空的地方（那一关的草稿槽、挑战 id）：「你的 Agent」从这里接过来。 */
export const FIRST_AGENT_DRAFT = { stage: 'novice-first-agent', id: 'bench' } as const

/** AgentCode 交来的一轮里判定要用的部分（同 1-14）。 */
export interface AgentRun {
  stop: 'finish' | 'limit' | 'end' | 'error'
  verdict: Verdict | null
  error: ChallengeError | null
  log: readonly { action: AgentAction; observation: Observation }[]
}

/** 交的参数还差在哪：多搬了，还是不够快（控制台的评分，模拟）。 */
function shortfall(v: Verdict): string {
  const missed: string[] = []
  if (!v.earned[1]) missed.push(`搬的车比理想多（效率 ${percent(v.efficiency ?? 0)}）`)
  if (!v.earned[2]) missed.push(`示意时间 ${v.cycles ?? '?'} 个周期，没到 ${AGENT_TASK.bestCycles} 个周期以内`)
  return missed.join('；')
}

/**
 * 你的 Agent 过没过（分题的判定，只用到 earned[0]）：从 AGENT_START 出发交卷，交的参数拿到控制台的三颗星
 * （算对、不多搬、示意时间不超过 bestCycles）。没过时给「现象 / 原因 / 怎么改」。
 */
export function judgeAgent(run: AgentRun): AttemptResult {
  const fail = (error: ChallengeError): AttemptResult => ({ earned: [false, false, false], next: error.fix, error })
  if (run.stop === 'error' && run.error) return fail(run.error)
  if (run.stop === 'limit') {
    return fail({
      symptom: `走满了 ${run.log.length} 步，你的 Agent 还没交卷。`,
      cause: `一组参数要运行、计时、看访存 3 步，一轮最多 ${MAX_STEPS} 步：要么一直停在同一组参数上原地打转，要么一次只改一点，还没改到位步数就用完了。`,
      fix: '让每次改动都改到位：多搬了就直接把步长改成 1；看不出问题的时候，两个判断都要是 False，Agent 才会走到 else 去交卷。',
    })
  }
  if (run.stop !== 'finish' || !run.verdict) {
    return fail({
      symptom: '程序跑完了，可是没有调用 finish 交卷。',
      cause: '不交卷就没有分：Agent 要自己决定什么时候停。',
      fix: '跳出循环以后，用 finish(block=block, stride=stride) 交出手上的参数。',
    })
  }
  const v = run.verdict
  const head = `从 ${describeConfig(AGENT_START)} 出发，你的 Agent 走了 ${run.log.length} 步，交了 ${describeConfig(v.config)}`
  if (!v.correct) {
    return fail({
      symptom: `${head}，可这组参数算错了。`,
      cause: '结果不对，快也没用：评分先看算得对不对。',
      fix: '交卷之前先用 run_kernel 跑一次，观察里写着全部算对再交。',
    })
  }
  if (!v.earned.every(Boolean)) {
    const blockBad = v.config.block % WAVE !== 0
    const strideBad = v.config.stride > 1 && !v.earned[1]
    return fail({
      symptom: `${head}：${shortfall(v)}（模拟）。`,
      cause: strideBad
        ? '第 1 个空要从看访存的观察里看出多搬了，第 2 个空给出新的步长：这一轮步长没改到 1。'
        : blockBad
          ? `第 3 个空要看出 block 不是 ${WAVE} 的倍数：每组最后一支小队有 lane 空着，后面几组的开头还落在一车中间。`
          : '它在还没调好的时候就交卷了：两个判断有一个没看出问题。',
      fix: strideBad
        ? '第 1 个空比搬的车和理想车数：memory["transactions"] > memory["ideal"]；第 2 个空写 1。'
        : `第 3 个空用 % 看 block 是不是 ${WAVE} 的倍数：block % ${WAVE} != 0。`,
    })
  }
  return { earned: [true, false, false], next: `${head}：不多搬，${v.cycles} 个周期（模拟），控制台给了三颗星。` }
}

export const AGENT_HINTS: Hints = {
  direction: `先让 Agent 从 ${describeConfig(AGENT_START)} 跑完一轮、交上卷：看「这次的问题」写的是哪一个空。第 1、3 个空是判断，算出来是 True 或 False；第 2 个空是一个数。`,
  location: `第 1 个空比看访存交回来的两个数：memory["transactions"] 是搬了几车，memory["ideal"] 是理想几车。第 2 个空写新的步长：相邻线程拿相邻的数。第 3 个空用 % 看 block 是不是 ${WAVE} 的倍数。`,
  answer: `第 1 个空：搬的车比理想多；第 2 个空：步长改成 1；第 3 个空：block 除以 ${WAVE} 有余数。`,
  answerCode: [
    `# 第 1 个空\n${STARTER.answers.extra}`,
    `# 第 2 个空\n${STARTER.answers.stride}`,
    `# 第 3 个空\n${STARTER.answers.block}`,
  ].join('\n'),
}

/** 一个空最多留多少字（编辑器里不能换行；太长的多半是手改坏的草稿）。 */
const MAX_BLANK_CHARS = 200

/**
 * 草稿里读出来的三个空（本关的，或者第 1-14 关的）：只留模板里有的空、一行以内的文字；
 * 一个空都没有时是 null（用初始内容）。
 */
export function agentValues(raw: unknown): Record<string, string> | null {
  const list = raw && typeof raw === 'object' && 'values' in raw ? raw.values : null
  if (!list || typeof list !== 'object') return null
  // 草稿是读者浏览器里存的 JSON：按名字取空，取出来再逐个检查类型
  const given = list as Record<string, unknown>
  const values: Record<string, string> = {}
  for (const name of Object.keys(STARTER.blanks)) {
    const v = given[name]
    if (typeof v === 'string' && v.length <= MAX_BLANK_CHARS && !/[\r\n]/.test(v)) values[name] = v
  }
  return Object.keys(values).length ? values : null
}

// ── 本关三颗星：几道分题合起来判 ─────────────────────────────────────────

/** 各道分题最近一次的结果（存进本关的草稿槽，刷新不丢）。 */
export interface BossState {
  oob: FixRecord
  fork: FixRecord
  stride: FixRecord
  /** 你的 Agent 交出了三星参数 */
  agent: boolean
}

/** 一道都还没做：按三张工作单原来的样子算（第二、三张的数本来就对；单测拿模拟器核对）。 */
export const START_STATE: BossState = {
  oob: { correct: false, passed: false },
  fork: { correct: true, passed: false },
  stride: { correct: true, passed: false },
  agent: false,
}

/** 草稿槽里读出来的可能是旧版本或被手改坏：认得的留下，其余用 START_STATE。 */
export function normalizeState(raw: unknown): BossState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const record = (part: FixPart): FixRecord => {
    const v = r[part] && typeof r[part] === 'object' ? (r[part] as Record<string, unknown>) : null
    if (!v || typeof v.correct !== 'boolean' || typeof v.passed !== 'boolean') return { ...START_STATE[part] }
    // 过了一定修对了；第一张修对就是过了
    const correct = v.correct || v.passed
    return { correct, passed: part === 'oob' ? correct : v.passed }
  }
  return { oob: record('oob'), fork: record('fork'), stride: record('stride'), agent: r.agent === true }
}

export const STAR_LABELS = [
  '三张工作单都修对：数全对，没有一次读写跑到数组外面',
  '第二、三张都不浪费：没有小队分岔，读写不多搬车',
  `你的 Agent 从 ${describeConfig(AGENT_START)} 出发，交出三星参数（模拟）`,
] as const

/** 06 第 7 节：三颗星各自成立没有、下一步的一句话。 */
export interface BossVerdict {
  earned: [boolean, boolean, boolean]
  next: string
}

/**
 * 本关的星级判定：输入是各道分题最近一次的结果。
 * ★1 三张都修对；★2 第二、三张都过了（不分岔、不多搬车）；★3 你的 Agent 交出三星参数。
 * ★1 不成立时一颗都不发（useChallenge）：先把数修对，别的才算。
 */
export function judge(state: BossState): BossVerdict {
  const s1 = FIX_PARTS.every((p) => state[p].correct)
  const s2 = state.fork.passed && state.stride.passed
  const s3 = state.agent
  const todo: string[] = []
  if (!state.oob.correct) todo.push('第一张还在越界')
  for (const p of ['fork', 'stride'] as const) {
    if (!state[p].correct) todo.push(`${FIX_NAMES[p]}的数还不对`)
    else if (!state[p].passed) todo.push(p === 'fork' ? '第二张还在分岔' : '第三张还在多搬车')
  }
  if (!s3) todo.push('你的 Agent 还没交出三星参数')
  const next = todo.length ? `还差：${todo.join('；')}。` : '三张工作单都修好了，你的 Agent 也调到了三星。三颗星的标准都达到了。'
  return { earned: [s1, s2, s3], next }
}

/** 成绩单的一行。 */
export interface BoardRow {
  key: FixPart | 'agent'
  name: string
  status: string
  done: boolean
}

export function boardRows(state: BossState): BoardRow[] {
  const fix = (p: FixPart, waste: string): BoardRow => ({
    key: p,
    name: `${FIX_NAMES[p]}（${FIX_TOPICS[p]}）`,
    status: state[p].passed ? '修好了' : state[p].correct ? (p === 'oob' ? '修好了' : `数对了，${waste}`) : p === 'oob' ? '还在越界' : '数还不对',
    done: state[p].passed,
  })
  return [
    fix('oob', ''),
    fix('fork', '还在分岔'),
    fix('stride', '还在多搬车'),
    { key: 'agent', name: '你的 Agent', status: state.agent ? '交出了三星参数' : '还没交出三星参数', done: state.agent },
  ]
}
