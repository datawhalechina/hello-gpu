/**
 * Agent 的 ReAct 循环（A-01；03 第 3 节的 AgentConsole）。
 *
 * ReAct：每一步先「思考」（读目前为止的观察，想好下一步做什么），再「行动」（调用一个工具），
 * 然后「观察」（工具给回来的结果）；观察又是下一步思考的材料。工具都在模拟器上运行，结果是确定的。
 * - 策略（Policy）只管思考：读任务和到目前为止的每一步，给出 { thought, action }。
 *   规则 Agent 的策略在 rules.ts；1-14 读者用 Python 补全的（A-02）、大模型（A-03）也都是一个策略。
 * - 环境（AgentEnv，tools.ts 的 createEnv）只管行动和观察：校验行动，在模拟器上跑，写出观察。
 *   策略给的行动不合法时不执行，观察里写清楚哪里不对，这一步照样算。
 * - runAgent 把两边接起来：一步记一条 { thought, action, observation }，交卷（finish）或者步数用完就停。
 *
 * 纯 TypeScript，不碰 Vue 和浏览器；模拟器怎么跑由创建环境的人给（测试直接用 lockstep.ts 的 run，
 * 页面用 docs/sim/client.ts 在 Web Worker 里跑），这里不打包解释器。
 */
import type { TuneConfig, TuneTask } from './tasks.ts'

export type ToolName = 'run_kernel' | 'measure' | 'inspect_memory' | 'finish'

export interface ToolSpec {
  name: ToolName
  /** 中文名 */
  label: string
  /** 一句话：它做什么、给回什么 */
  summary: string
}

/** Agent 能用的工具（实现在 tools.ts）。纯数据放在这里，控制台不用加载模拟器就能列出来。 */
export const TOOLS: readonly ToolSpec[] = [
  { name: 'run_kernel', label: '运行', summary: '用这组参数跑一次，检查结果对不对、有没有越界' },
  { name: 'measure', label: '计时', summary: '量一量要多少个周期（模拟），拆成计算、访存、同步' },
  { name: 'inspect_memory', label: '看访存', summary: '数一数读写显存一共搬了几车、理想几车' },
  { name: 'finish', label: '交卷', summary: '交出这组参数，按三星标准评分，这一轮结束' },
]

/** 一次行动：调用哪个工具，参数按名字给（和 Python 的关键字参数一样）。策略交来的行动不一定合法。 */
export interface AgentAction {
  tool: string
  args: Record<string, unknown>
}

/** 校验过的行动：工具存在，block、stride 都在任务的可选值里（tools.ts 的 validateAction）。 */
export interface TuneAction {
  tool: ToolName
  args: TuneConfig
}

/** 交卷的评分。 */
export interface Verdict {
  config: TuneConfig
  /** 三颗星各自成立没有；★1 不成立时后两颗也不算（结果不对，快也没用） */
  earned: [boolean, boolean, boolean]
  correct: boolean
  /** 示意周期数（模拟）；模拟器报错时是 null */
  cycles: number | null
  /** 理想车次 ÷ 车次（模拟）；模拟器报错时是 null */
  efficiency: number | null
}

export interface Observation {
  /** 行动合法，模拟器也跑通了 */
  ok: boolean
  /** 给 Agent 读的数据：写成 JSON 的样子，键用 snake_case（A-02 交给 Python 的就是它） */
  data: Record<string, number | boolean | string>
  /** 一句话，给人读 */
  text: string
  /** 只有 finish 有：交卷的评分 */
  verdict?: Verdict
}

export interface AgentStep {
  thought: string
  /** 策略给的行动，原样记下；不合法的也记，观察里写为什么不合法 */
  action: AgentAction
  observation: Observation
}

/** 策略看到的东西：任务、到目前为止的每一步、步数上限。 */
export interface AgentView {
  task: TuneTask
  steps: readonly AgentStep[]
  maxSteps: number
}

export interface Decision {
  thought: string
  action: AgentAction
}

export type Policy = (view: AgentView) => Decision | Promise<Decision>

/** 环境：执行一个行动，给回观察。 */
export interface AgentEnv {
  readonly task: TuneTask
  act(action: AgentAction): Promise<Observation>
}

export interface Episode {
  steps: AgentStep[]
  /** finish：交卷了；limit：步数用完，没有交卷 */
  stop: 'finish' | 'limit'
  /** 交卷的评分；没有交卷是 null */
  verdict: Verdict | null
  maxSteps: number
}

/** 一轮最多走几步。不是硬件参数：防止策略一直不交卷，页面也不会无休止地跑下去。 */
export const MAX_STEPS = 15

/** 让策略一步一步地做，直到交卷或者步数用完。策略和环境抛出的错误（例如模拟器超时）原样抛给调用方。 */
export async function runAgent(env: AgentEnv, policy: Policy, options: { maxSteps?: number } = {}): Promise<Episode> {
  const maxSteps = options.maxSteps ?? MAX_STEPS
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new RangeError(`maxSteps 要是正整数，收到的是 ${String(maxSteps)}。`)
  const steps: AgentStep[] = []
  while (steps.length < maxSteps) {
    // 给策略一份副本：策略改了它，也改不到这里的记录
    const { thought, action } = await policy({ task: env.task, steps: steps.slice(), maxSteps })
    const observation = await env.act(action)
    steps.push({ thought, action, observation })
    if (observation.verdict) return { steps, stop: 'finish', verdict: observation.verdict, maxSteps }
  }
  return { steps, stop: 'limit', verdict: null, maxSteps }
}

/** 写成函数调用的样子，例如 measure(block=64, stride=1)。 */
export function formatAction(action: AgentAction): string {
  const args = Object.entries(action?.args ?? {}).map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
  return `${String(action?.tool)}(${args.join(', ')})`
}

/** 两个行动是不是同一个：同一个工具，参数一样。 */
export function sameAction(a: AgentAction, b: AgentAction): boolean {
  if (a.tool !== b.tool) return false
  const keys = new Set([...Object.keys(a.args), ...Object.keys(b.args)])
  for (const k of keys) if (a.args[k] !== b.args[k]) return false
  return true
}

/** 星级写成 ★★☆。 */
export function starText(earned: readonly boolean[]): string {
  return earned.map((ok) => (ok ? '★' : '☆')).join('')
}
