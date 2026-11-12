/**
 * 代码沙盒怎样调用模拟器、怎样解读结果（S-05）。纯函数，不碰 Vue 和浏览器，单测直接导入。
 *
 * Sandbox 的运行：读者的代码按 launch（和 variants 里的每一种启动配置）各跑一次，得到 SandboxRun[]；
 * 关卡的 judge(runs) 拿它判星（06 第 7 节：输入是模拟器结果和读者的配置，纯函数）。
 */
import type { AttemptResult, ChallengeError } from '../../../course/useChallenge.ts'
import type { Arg, RunRequest, RunResult, SimEvent, WaveSize } from '../../../sim/lockstep.ts'
import type { Lang } from '../../../sim/syntax/ast.ts'
import { ERROR_KIND_LABEL, formatError, type SimError } from '../../../sim/syntax/errors.ts'

/** 一次启动：gridDim.x 和 blockDim.x；wave 大小默认 32，seed 给了就打乱 block 的执行顺序。 */
export interface Launch {
  grid: number
  block: number
  wave?: WaveSize
  seed?: number | null
}

/**
 * Sandbox 的 variants 里的一项：同一份代码换一种启动配置再跑一次（没写的项沿用读者设的 launch）；
 * 给了 args 就连数据一起换，用来判「换一批数据照样成立」。不给 args 用沙盒自己的 args。
 */
export interface SandboxVariant extends Partial<Launch> {
  args?: Record<string, Arg>
}

/** 跑完的一次：用的哪种启动配置、模拟器的结果。runs[0] 是读者设的那一次，后面按 variants 的顺序。 */
export interface SandboxRun {
  launch: Launch
  result: RunResult
}

/** Sandbox 的 result 事件：跑完一次（点「运行」，或者单步走到最后）。 */
export interface SandboxOutcome {
  lang: Lang
  source: string
  runs: SandboxRun[]
  /** judge 的结果；代码出错时是 Sandbox 自己写的「没过」；没有 judge、代码也没出错时是 null */
  verdict: AttemptResult | null
}

/**
 * Sandbox 的 step 事件：单步走到的这一步。result.events.slice(group.from, group.to) 是这一步的事件，
 * slice(0, group.to) 是到这一步为止的全部事件（RobotGrid、WaveView 逐步播放用）。
 */
export interface SandboxStep {
  /** 第几步（0 起）和一共几步 */
  index: number
  count: number
  group: StepGroup
  result: RunResult
}

/** 拼出发给模拟器的请求。数据复制成普通对象：Vue 的响应式对象不能直接发给 worker（client.ts）。 */
export function buildRequest(source: string, lang: Lang, launch: Launch, args: Readonly<Record<string, Arg>>): RunRequest {
  const plain: Record<string, Arg> = {}
  for (const [name, arg] of Object.entries(args)) {
    plain[name] = 'data' in arg ? { type: arg.type, data: Array.from(arg.data) } : { type: arg.type, value: arg.value }
  }
  return { source, lang, grid: launch.grid, block: launch.block, wave: launch.wave ?? 32, seed: launch.seed ?? null, args: plain }
}

/**
 * 03 第 4 节：模拟器的错误写成「现象 + 原因 + 怎么改」，解析器的整行原文放进折叠块。
 * 现象由类别和位置给出，原因是 message，怎么改是 hint（syntax/errors.ts 的约定）。
 */
export function explainError(error: SimError): ChallengeError {
  const where = `第 ${error.line} 行第 ${error.col} 列`
  let symptom = `${where}有${ERROR_KIND_LABEL[error.kind]}，程序没有运行。`
  if (error.kind === 'runtime') symptom = `运行到${where}时出错，程序停下了。`
  if (error.kind === 'limit') symptom = `${where}超出了模拟器的限制，程序没能跑完。`
  return { symptom, cause: error.message, fix: error.hint, raw: formatError(error) }
}

/** 单步的一步（08 第 4 节「一步」）：一个 wave 执行一条语句、一次判断或一次同步；events[from, to) 是这一步的事件。 */
export interface StepGroup {
  step: number
  block: number
  wave: number
  line: number
  from: number
  to: number
}

/** 按 step 把事件分成一步一步（事件流里同一步的事件挨在一起）。 */
export function stepGroups(events: readonly SimEvent[]): StepGroup[] {
  const groups: StepGroup[] = []
  events.forEach((e, i) => {
    const last = groups[groups.length - 1]
    if (last?.step === e.step) last.to = i + 1
    else groups.push({ step: e.step, block: e.block, wave: e.wave, line: e.line, from: i, to: i + 1 })
  })
  return groups
}

/**
 * 这一步执行这条语句的 lane：这一步各个事件的掩码合起来。不能只看第一个事件：
 * &&、||、条件表达式里的读只让一部分 lane 做（if (i < n && x[i] < 0) 先记读 x，再记整条判断）。
 */
export function stepMask(events: readonly SimEvent[], group: Pick<StepGroup, 'from' | 'to'>): string {
  const first = events[group.from].mask
  if (group.to - group.from === 1) return first
  const bits = first.split('')
  for (let e = group.from + 1; e < group.to; e++) {
    const mask = events[e].mask
    for (let l = 0; l < bits.length; l++) if (mask[l] === '1') bits[l] = '1'
  }
  return bits.join('')
}

/** 跑完以后的一句话：多少线程、多少步，有没有越界和数据竞争。 */
export function describeRun(result: RunResult, launch: Launch): string {
  const parts = [`${launch.grid * launch.block} 个线程，一共 ${result.steps} 步`]
  const writes = result.outside.reduce((n, o) => n + o.writes.length, 0)
  const reads = result.diagnostics.filter((d) => d.kind === 'oob-read').length
  const races = result.diagnostics.length - reads
  if (writes) parts.push(`${writes} 次写到数组外面`)
  if (reads) parts.push(`${reads} 次读到数组外面`)
  if (races) parts.push(`${races} 处数据竞争`)
  if (result.dropped) parts.push(`另有 ${result.dropped} 条超过记录上限没有记下`)
  return `${parts.join('，')}。`
}

/** 单步时的一句话：哪个 block（block 里不止一个 wave 时加上 wave）、第几行、几个线程一起做了什么。 */
export function describeStep(group: Omit<StepGroup, 'step'>, events: readonly SimEvent[], launch: Launch): string {
  const own = events.slice(group.from, group.to)
  const active = stepMask(events, group).split('1').length - 1
  const arrays = (op: SimEvent['op']) => [...new Set(own.filter((e) => e.op === op).map((e) => e.array))].join('、')
  const reads = arrays('load')
  const adds = arrays('atomic')
  const writes = arrays('store')
  const did: string[] = []
  if (own.some((e) => e.op === 'branch')) did.push('判断条件')
  if (own.some((e) => e.op === 'barrier')) did.push('在同步处等齐')
  if (reads) did.push(`读 ${reads}`)
  if (adds) did.push(`原子加 ${adds}`)
  if (writes) did.push(`写 ${writes}`)
  const wave = launch.block > (launch.wave ?? 32) ? ` 的 wave ${group.wave}` : ''
  return `block ${group.block}${wave}，第 ${group.line} 行：${active} 个线程一起${did.length ? did.join('，') : '计算'}。`
}
