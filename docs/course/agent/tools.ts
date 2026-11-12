/**
 * Agent 的工具和环境（A-01）。工具都是前面关卡学过的操作，在模拟器上运行，结果是确定的：
 * - run_kernel：跑一次，检查结果对不对、有没有越界（1-3、1-4）；
 * - measure：示意时间，拆成计算、访存、同步，外加 lane 利用率（1-6、1-11；L4 的 estimateTime）；
 * - inspect_memory：读写显存一共搬了几车、理想几车（1-8；L3 的 analyzeMemory）；
 * - finish：交卷，按任务的三星标准评分，这一轮结束。
 * 观察的 data 给 Agent 读（键用 snake_case，A-02 原样交给 Python），text 是给人读的一句话。
 * 周期数、车次、利用率都是模拟值，价钱和一车多大取 docs/sim/params.ts 的示意值，界面上标「模拟」。
 *
 * 环境（createEnv）：同一组参数只跑一次模拟器，几个工具共用这次的结果；一次只跑一个
 * （页面用 docs/sim/client.ts，同一个 client 上一次没结束就开始新的，上一次会被取消）。
 * 模拟器怎么跑由调用方给：测试传 lockstep.ts 的 run，页面传 client.run。
 * 同步的环境（createSyncEnv）给 1-14 读者写的 Python Agent 用（A-02）：Python 调用工具时要马上拿到观察，
 * 所以它和 Python 在同一个 Web Worker 里同步地跑模拟器（lockstep.ts 的 run），观察和 createEnv 的逐项相同。
 */
import type { RunRequest, RunResult, SimEvent } from '../../sim/lockstep.ts'
import { analyzeMemory } from '../../sim/memory.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { formatError } from '../../sim/syntax/errors.ts'
import { estimateTime } from '../../sim/timing.ts'
import { starText, TOOLS, type AgentAction, type AgentEnv, type Observation, type ToolName, type TuneAction, type Verdict } from './react.ts'
import { configKey, describeConfig, expectedAt, gridOf, requestOf, type TuneConfig, type TuneTask } from './tasks.ts'

export type Runner = (request: RunRequest) => RunResult | Promise<RunResult>

export type Validation = { ok: true; action: TuneAction } | { ok: false; message: string }

/** 校验一个行动：工具存在，只给了 block 和 stride，而且都在任务的可选值里。 */
export function validateAction(task: TuneTask, action: unknown): Validation {
  const a = action as Partial<AgentAction> | null
  if (!a || typeof a !== 'object' || typeof a.tool !== 'string') {
    return { ok: false, message: '行动要写成 { tool, args }：tool 是工具名，args 是参数。' }
  }
  const spec = TOOLS.find((t) => t.name === a.tool)
  if (!spec) return { ok: false, message: `没有 ${a.tool} 这个工具，能用的是 ${TOOLS.map((t) => t.name).join('、')}。` }
  const args: Record<string, unknown> = a.args && typeof a.args === 'object' ? a.args : {}
  const allowed = { block: task.blocks, stride: task.strides }
  const extra = Object.keys(args).filter((k) => !Object.hasOwn(allowed, k))
  if (extra.length) return { ok: false, message: `${spec.name} 只认 block 和 stride 两个参数，多了 ${extra.join('、')}。` }
  const bad: string[] = []
  for (const [name, values] of Object.entries(allowed)) {
    const v = args[name]
    if (v === undefined) bad.push(`没写 ${name}，可选 ${values.join(' / ')}`)
    else if (!values.includes(v as number)) bad.push(`${name} 只能是 ${values.join(' / ')}，收到的是 ${JSON.stringify(v) ?? String(v)}`)
  }
  if (bad.length) return { ok: false, message: `${bad.join('；')}。` }
  return { ok: true, action: { tool: spec.name, args: { block: args.block as number, stride: args.stride as number } } }
}

// ── 一组参数跑一次，几个工具共用 ─────────────────────────────────────────

interface Analysis {
  grid: number
  threads: number
  /** 模拟器报错的整行文字；没出错是 null */
  error: string | null
  /** 算错的数 */
  wrong: number
  /** 越界读写的次数 */
  outOfBounds: number
  /** 数据竞争 */
  races: number
  correct: boolean
  time: { cycles: number; compute: number; memory: number; sync: number } | null
  /** lane 利用率：每一步在干活的 lane ÷ wave 大小，所有步加起来 */
  laneUse: number | null
  memory: { accesses: number; transactions: number; ideal: number; efficiency: number } | null
}

function analyze(task: TuneTask, c: TuneConfig, result: RunResult): Analysis {
  const grid = gridOf(task, c)
  const threads = grid * c.block
  const out = result.arrays.c ?? []
  let wrong = 0
  for (let k = 0; k < task.n; k++) if (out[k] !== expectedAt(k)) wrong++
  const outOfBounds = result.outside.reduce((sum, e) => sum + e.writes.length, 0)
    + result.diagnostics.filter((d) => d.kind === 'oob-read').length
  const races = result.diagnostics.filter((d) => d.kind === 'race').length
  if (!result.ok) {
    return { grid, threads, error: formatError(result.error), wrong, outOfBounds, races, correct: false, time: null, laneUse: null, memory: null }
  }
  const t = estimateTime(result.events)
  const m = analyzeMemory(result.events)
  return {
    grid,
    threads,
    error: null,
    wrong,
    outOfBounds,
    races,
    correct: wrong === 0 && outOfBounds === 0 && races === 0,
    time: { cycles: t.cycles, compute: t.compute, memory: t.memory, sync: t.sync },
    laneUse: laneUse(result.events, result.wave),
    memory: { accesses: m.accesses.length, transactions: m.summary.transactions, ideal: m.summary.ideal, efficiency: m.summary.efficiency },
  }
}

/** lane 利用率：一步里各个事件的掩码合起来是这一步在干活的 lane（同一步的事件在事件流里挨在一起）。 */
function laneUse(events: readonly SimEvent[], wave: number): number {
  const on = new Uint8Array(wave)
  let steps = 0
  let active = 0
  for (let i = 0; i < events.length;) {
    const step = events[i].step
    on.fill(0)
    let j = i
    for (; j < events.length && events[j].step === step; j++) {
      const mask = events[j].mask
      for (let k = 0; k < mask.length; k++) if (mask.charCodeAt(k) === 49) on[k] = 1
    }
    for (let k = 0; k < wave; k++) active += on[k]
    steps++
    i = j
  }
  return steps === 0 ? 1 : active / (steps * wave)
}

// ── 观察 ───────────────────────────────────────────────────────────────

/** 给 Agent 读的小数留三位。 */
const round3 = (x: number) => Math.round(x * 1000) / 1000

/** 百分数：整数照写，否则留一位小数，并且不写成 0% 或 100%（和锁步执行视图一样）。 */
export function percent(r: number): string {
  const p = r * 100
  if (Math.abs(p - Math.round(p)) < 1e-9) return `${Math.round(p)}%`
  return `${Math.min(99.9, Math.max(0.1, Math.round(p * 10) / 10))}%`
}

function problems(a: Analysis): string {
  const parts: string[] = []
  if (a.wrong) parts.push(`有 ${a.wrong} 个数算错了`)
  if (a.outOfBounds) parts.push(`越界读写 ${a.outOfBounds} 次`)
  if (a.races) parts.push(`有 ${a.races} 处数据竞争`)
  return parts.join('，')
}

/** 交卷的评分：★1 算对；★2 搬的车数等于理想车数；★3 示意时间不超过 bestCycles。★1 不成立时后两颗不算。 */
function verdictOf(task: TuneTask, c: TuneConfig, a: Analysis): Verdict {
  const correct = a.correct
  const tidy = correct && a.memory !== null && a.memory.transactions === a.memory.ideal
  const fast = correct && a.time !== null && a.time.cycles <= task.bestCycles
  return {
    config: { block: c.block, stride: c.stride },
    earned: [correct, tidy, fast],
    correct,
    cycles: a.time?.cycles ?? null,
    efficiency: a.memory?.efficiency ?? null,
  }
}

function observe(task: TuneTask, tool: ToolName, c: TuneConfig, a: Analysis): Observation {
  if (tool === 'finish') return finishObservation(task, c, a)
  if (a.error) return { ok: false, data: { error: a.error }, text: `模拟器报错：${a.error}` }
  if (tool === 'run_kernel') {
    const head = a.correct ? `${task.n} 个数全部算对，没有越界。` : `${problems(a)}。`
    const each = c.stride === 1 ? '每个线程算 1 个数' : `每个线程连着算 ${c.stride} 个数`
    return {
      ok: true,
      data: { correct: a.correct, wrong: a.wrong, out_of_bounds: a.outOfBounds, blocks: a.grid, threads: a.threads },
      text: `${head}派了 ${a.grid} 组、每组 ${c.block} 个线程，一共 ${a.threads} 个线程，${each}。`,
    }
  }
  if (tool === 'measure') {
    const t = a.time!
    const use = a.laneUse!
    return {
      ok: true,
      data: { cycles: t.cycles, compute: t.compute, memory: t.memory, sync: t.sync, lane_utilization: round3(use) },
      text: `示意时间 ${t.cycles} 个周期（模拟）：计算 ${t.compute}、访存 ${t.memory}、同步 ${t.sync}。lane 利用率 ${percent(use)}。${a.correct ? '' : '这组参数算错了，快也没用。'}`,
    }
  }
  const m = a.memory!
  return {
    ok: true,
    data: { accesses: m.accesses, transactions: m.transactions, ideal: m.ideal, efficiency: round3(m.efficiency) },
    text: `读写显存 ${m.accesses} 次，一共搬了 ${m.transactions} 车，理想 ${m.ideal} 车，效率 ${percent(m.efficiency)}（模拟）。`,
  }
}

function finishObservation(task: TuneTask, c: TuneConfig, a: Analysis): Observation {
  const verdict = verdictOf(task, c, a)
  const [correct, tidy, fast] = verdict.earned
  const count = verdict.earned.filter(Boolean).length
  const missed: string[] = []
  if (!correct) missed.push(a.error ? '模拟器报错，没有跑完' : problems(a))
  else {
    if (!tidy && a.memory) missed.push(`搬的车比理想多（效率 ${percent(a.memory.efficiency)}）`)
    if (!fast && a.time) missed.push(`示意时间 ${a.time.cycles} 个周期，没到 ${task.bestCycles} 个周期以内`)
  }
  const head = `交卷：${describeConfig(c)}，拿到 ${count} 颗星（${starText(verdict.earned)}）。`
  return {
    ok: true,
    data: { stars: count, correct, efficiency: a.memory ? round3(a.memory.efficiency) : 0, cycles: a.time?.cycles ?? 0 },
    text: missed.length ? `${head}没拿到的：${missed.join('；')}（模拟）。` : `${head}算对、不多搬、最快（模拟）。`,
    verdict,
  }
}

// ── 环境 ───────────────────────────────────────────────────────────────

/** 不合法的行动不执行：观察里写清楚哪里不对。 */
function rejected(message: string): Observation {
  return { ok: false, data: { error: message }, text: `这一步没有执行：${message}` }
}

/**
 * 在一个任务上创建环境。runner 跑模拟器；lang 选跑哪种写法的 kernel：两种写法的事件流除了行号完全一样
 * （08 第 8 节），工具都不看行号，所以观察一样（单测逐项核对）。
 */
export function createEnv(task: TuneTask, runner: Runner, lang: Lang = 'hip'): AgentEnv {
  const cache = new Map<string, Promise<Analysis>>()
  let queue: Promise<unknown> = Promise.resolve()

  function analysis(c: TuneConfig): Promise<Analysis> {
    const key = configKey(c)
    const hit = cache.get(key)
    if (hit) return hit
    const request = requestOf(task, c, lang)
    // 一次只跑一个：排在前一次后面
    const p = queue.then(() => runner(request)).then((result) => analyze(task, c, result))
    queue = p.catch(() => undefined)
    cache.set(key, p)
    // 失败的（超时、被取消）不留在缓存里，下次重新跑
    p.catch(() => {
      if (cache.get(key) === p) cache.delete(key)
    })
    return p
  }

  return {
    task,
    async act(action: AgentAction): Promise<Observation> {
      const v = validateAction(task, action)
      if (!v.ok) return rejected(v.message)
      const { tool, args } = v.action
      return observe(task, tool, args, await analysis(args))
    },
  }
}

/** 同步的环境：act 马上给回观察。 */
export interface SyncEnv {
  readonly task: TuneTask
  act(action: AgentAction): Observation
}

/**
 * 同步的环境（A-02）：run 同步地跑模拟器（lockstep.ts 的 run），同一组参数只跑一次。
 * 模拟器自己出的错（不是读者代码的错）原样抛出，交给调用方。
 */
export function createSyncEnv(task: TuneTask, run: (request: RunRequest) => RunResult, lang: Lang = 'hip'): SyncEnv {
  const cache = new Map<string, Analysis>()
  return {
    task,
    act(action: AgentAction): Observation {
      const v = validateAction(task, action)
      if (!v.ok) return rejected(v.message)
      const { tool, args } = v.action
      const key = configKey(args)
      let a = cache.get(key)
      if (!a) {
        a = analyze(task, args, run(requestOf(task, args, lang)))
        cache.set(key, a)
      }
      return observe(task, tool, args, a)
    },
  }
}
