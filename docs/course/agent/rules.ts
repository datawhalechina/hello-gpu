/**
 * 规则 Agent（A-01）：按几条固定的规则，从到目前为止的观察决定下一步。
 *
 * 它是一个纯函数：同样的任务和历史，一定给出同样的 { thought, action }。所以回放是确定的；
 * 「你来当 Agent」时，也能拿读者自己的历史去问它「换你会选什么」。
 * 它只读观察里的 data（别的 Agent 能看到的也就是这些），不看模拟器内部。
 *
 * 规则从上往下，第一条成立的就是这一步：
 * 1. 只剩最后一步、手上有算对并量过的参数：交出最快的那组（不交卷就没有分）。
 * 2. 手上这组参数（最近一次行动用的那组；还没行动时是起点）还没跑过：run_kernel，先确认算得对。
 * 3. 算对了、还没计时：measure。
 * 4. 算错了，或者比最快的那组慢：不要它，回到最快的那组。
 * 5. 还没看过访存：inspect_memory。
 * 6. 照着观察换一组参数（换完先跑一次，下一步再计时），试过的不再试：
 *    a. 搬的车比理想多、步长不是最小：步长改成最小（1-8：相邻线程拿相邻的数）；
 *    b. block 不是 wave 大小的整数倍：换成可选值里比它大的最小的整数倍（1-5：wave 不满，lane 空着）。
 * 7. 没有能改的了：finish，交出最快的那组。
 * 还没有一组算对的参数时，按可选值的顺序找一组没跑过的试。步数上限由 runAgent 管。
 */
import { percent } from './tools.ts'
import type { AgentStep, AgentView, Decision, ToolName } from './react.ts'
import { allConfigs, configKey, describeConfig, type TuneConfig, type TuneTask } from './tasks.ts'

/** 从观察里读出来的、关于一组参数的事实。 */
interface Facts {
  config: TuneConfig
  run: { correct: boolean } | null
  time: { cycles: number; memory: number; laneUse: number } | null
  memory: { transactions: number; ideal: number; efficiency: number } | null
  /** 第一次计时是第几步：一样快的，先量的那组算最快 */
  timedAt: number
}

type Timed = Facts & { run: { correct: true }; time: NonNullable<Facts['time']> }

function decide(tool: ToolName, config: TuneConfig, thought: string): Decision {
  return { thought, action: { tool, args: { block: config.block, stride: config.stride } } }
}

/** 行动的参数在任务的可选值里，就是一组参数；否则是 null。 */
function configOf(task: TuneTask, args: Record<string, unknown>): TuneConfig | null {
  const { block, stride } = args
  if (!task.blocks.includes(block as number) || !task.strides.includes(stride as number)) return null
  return { block: block as number, stride: stride as number }
}

/** 把每一步的观察按参数归好。只有合法、跑通了的行动（ok）才有数据。 */
function notes(task: TuneTask, steps: readonly AgentStep[]): Map<string, Facts> {
  const map = new Map<string, Facts>()
  steps.forEach((s, index) => {
    const config = s.observation.ok ? configOf(task, s.action.args) : null
    if (!config) return
    const key = configKey(config)
    let f = map.get(key)
    if (!f) {
      f = { config, run: null, time: null, memory: null, timedAt: Number.POSITIVE_INFINITY }
      map.set(key, f)
    }
    const d = s.observation.data
    if (s.action.tool === 'run_kernel') f.run = { correct: d.correct === true }
    else if (s.action.tool === 'measure') {
      f.time = { cycles: Number(d.cycles), memory: Number(d.memory), laneUse: Number(d.lane_utilization) }
      f.timedAt = Math.min(f.timedAt, index)
    } else if (s.action.tool === 'inspect_memory') {
      f.memory = { transactions: Number(d.transactions), ideal: Number(d.ideal), efficiency: Number(d.efficiency) }
    }
  })
  return map
}

/** 算对了、量过的参数里最快的那组（一样快的取先量的）；except 是不算在内的那组的键。 */
function fastest(facts: Map<string, Facts>, except = ''): Timed | null {
  let best: Timed | null = null
  for (const [key, f] of facts) {
    if (key === except || !f.run?.correct || !f.time) continue
    const t = f as Timed
    if (!best || t.time.cycles < best.time.cycles || (t.time.cycles === best.time.cycles && t.timedAt < best.timedAt)) best = t
  }
  return best
}

/** 最近一次行动用的那组参数。 */
function lastConfig(task: TuneTask, steps: readonly AgentStep[]): TuneConfig | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const config = configOf(task, steps[i].action.args)
    if (config) return config
  }
  return null
}

/** 规则 6：照着观察换一组参数。按先后列出候选和理由（理由的最后一句由调用方接上）。 */
function candidates(task: TuneTask, f: Facts & { time: NonNullable<Facts['time']>; memory: NonNullable<Facts['memory']> }) {
  const out: { config: TuneConfig; why: string }[] = []
  const { block, stride } = f.config
  const m = f.memory
  const extra = m.transactions > m.ideal
  const minStride = task.strides[0]
  if (extra && stride > minStride) {
    out.push({
      config: { block, stride: minStride },
      why: `一共搬了 ${m.transactions} 车，理想只要 ${m.ideal} 车（效率 ${percent(m.efficiency)}）。`
        + `步长 ${stride}：同一步里相邻线程隔着 ${stride} 个数，一个 wave 要的数分散到更多的车里。`
        + `换成步长 ${minStride}，让相邻线程拿相邻的数。`,
    })
  }
  const wave = task.wave
  const up = task.blocks.find((b) => b > block && b % wave === 0)
  if (block % wave !== 0 && up !== undefined) {
    const empty = Math.ceil(block / wave) * wave - block
    const seen = !extra
      ? `搬的车数正好等于理想，可是 lane 利用率只有 ${percent(f.time.laneUse)}。`
      : stride === minStride
        ? `步长已经是 ${stride}，还是多搬了（效率 ${percent(m.efficiency)}），lane 利用率也只有 ${percent(f.time.laneUse)}。`
        : `lane 利用率只有 ${percent(f.time.laneUse)}。`
    const misaligned = extra && stride === minStride ? '，下一组的开头又落在一车的中间' : ''
    out.push({
      config: { block: up, stride },
      why: `${seen}block ${block} 不是 ${wave} 的倍数：每组最后一个 wave 有 ${empty} 个 lane 空着${misaligned}。换成 block ${up}。`,
    })
  }
  return out
}

export function rulePolicy(view: AgentView): Decision {
  const { task, steps, maxSteps } = view
  const facts = notes(task, steps)
  const best = fastest(facts)

  // 1. 只剩最后一步：交出最快的那组
  if (best && steps.length === maxSteps - 1) {
    return decide('finish', best.config, `只剩最后一步了。交出目前最快的 ${describeConfig(best.config)}（${best.time.cycles} 个周期）：不交卷就没有分。`)
  }

  let focus = lastConfig(task, steps) ?? task.start
  let f = facts.get(configKey(focus))

  // 2. 还没跑过：先确认算得对
  if (!f?.run) {
    return decide('run_kernel', focus, steps.length === 0
      ? `起点是 ${describeConfig(focus)}。先跑一次，确认 ${task.n} 个数都算对：算错了，跑得再快也没用。`
      : `手上这组 ${describeConfig(focus)} 还没跑过。先跑一次，确认结果是对的。`)
  }

  // 3. 算对了：计时
  if (f.run.correct && !f.time) {
    return decide('measure', focus, best
      ? `结果是对的。量一量要多少个周期，和目前最快的 ${best.time.cycles} 个周期比一比。`
      : '结果全对，没有越界。量一量要多少个周期，记下来好比较。')
  }

  // 4. 算错了，或者比最快的慢：回到最快的那组
  let lead = ''
  if (!f.run.correct || (best && f.time && f.time.cycles > best.time.cycles)) {
    lead = f.run.correct && f.time && best
      ? `${describeConfig(focus)} 要 ${f.time.cycles} 个周期，比 ${describeConfig(best.config)} 的 ${best.time.cycles} 个周期慢，不要它。`
      : `${describeConfig(focus)} 算错了，这组不能要。`
    if (!best) {
      const next = allConfigs(task).find((c) => !facts.get(configKey(c))?.run)
      if (next) return decide('run_kernel', next, `${lead}还没有一组算对的参数，换 ${describeConfig(next)} 试试，先跑一次。`)
      return decide('finish', focus, `${lead}试过的参数都算错了，只能交卷。`)
    }
    lead += `回到 ${describeConfig(best.config)}。`
    focus = best.config
    f = best
  }
  const time = f.time!

  // 5. 看访存
  if (!f.memory) {
    const others = fastest(facts, configKey(focus))
    return decide('inspect_memory', focus, lead
      ? `${lead}还没看过它的访存，看一看。`
      : others && time.cycles < others.time.cycles
        ? `从 ${others.time.cycles} 降到 ${time.cycles} 个周期，是目前最快的。访存还占 ${time.memory}，看看还有没有多搬。`
        : `${time.cycles} 个周期里，访存占了 ${time.memory}。看看读写显存一共搬了几车，是不是多搬了。`)
  }

  // 6. 照着观察换一组参数
  for (const { config, why } of candidates(task, { ...f, time, memory: f.memory })) {
    const c = facts.get(configKey(config))
    if (c?.time || (c?.run && !c.run.correct)) continue
    if (c?.run) return decide('measure', config, `${lead}${why}它跑过了，结果是对的，量一量。`)
    return decide('run_kernel', config, `${lead}${why}先跑一次，确认结果还对。`)
  }

  // 7. 没有能改的了：交卷
  const m = f.memory
  const clean = m.transactions === m.ideal && focus.stride === task.strides[0] && focus.block % task.wave === 0
  return decide('finish', focus, clean
    ? `${lead}搬的车数等于理想，步长是 ${focus.stride}，block ${focus.block} 是 ${task.wave} 的倍数，没有能改的地方了。交卷：${describeConfig(focus)}（${time.cycles} 个周期）。`
    : `${lead}能想到的改法都试过了。交卷：试过的参数里 ${describeConfig(focus)} 最快（${time.cycles} 个周期）。`)
}
