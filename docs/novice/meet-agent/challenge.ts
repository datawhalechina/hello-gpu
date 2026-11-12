/**
 * 1-13 认识 Agent：热身、两段探索和挑战用到的数、文字和判定（纯函数，单测在 scripts/tests/novice-meet-agent.test.mjs，06 第 7 节）。
 *
 * Agent 调的是 A-01 的固定任务（docs/course/agent/tasks.ts 的 VECTOR_ADD）：1000 个数的向量加法，能改每组线程数 block
 * 和访问步长 stride；工具是运行、计时、看访存、交卷（tools.ts），在模拟器上跑，结果是确定的。
 * - 探索一：规则 Agent（rules.ts）从任务的起点 block 48、步长 4 走一轮（AgentConsole 只放规则 Agent）。
 * - 探索二（scenes/PathLab.vue）：换一个起点，规则 Agent 走的路跟着变。pathOf 把一轮缩成「在哪几组参数停过、
 *   看到了什么、为什么换」。
 * - 挑战（scenes/AgentSeat.vue）：你来当 Agent，从 block 100、步长 8 出发（AgentConsole 只给「你来当 Agent」）。
 *   judge 只看读者这一轮的每一步（行动和观察）。控制台跑的 kernel 两种写法观察逐项相同（A-01 的单测），
 *   所以判定和写法无关；单测把两种写法都走一遍。
 *
 * 只从 react.ts、tasks.ts 拿纯数据和纯函数，不导入模拟器：页面首屏不带解释器，跑模拟器的部分由组件按需加载。
 * 正文在构建时要写出来的车次、lane 利用率写成常数，单测拿模拟器核对。周期数、车次都是模拟值。
 */
import type { ChallengeError, Hints } from '../../course/useChallenge.ts'
import { formatAction, MAX_STEPS, TOOLS, type AgentAction, type AgentStep, type Observation, type Verdict } from '../../course/agent/react.ts'
import { configKey, describeConfig, inSpace, VECTOR_ADD, type TuneConfig } from '../../course/agent/tasks.ts'

export const STAGE_ID = 'novice-meet-agent'

/** Agent 调的任务：1000 个数的向量加法（1-1 的一千道加法）。 */
export const TASK = VECTOR_ADD
/** 一支小队 32 个线程（wave32，1-5）。 */
export const WAVE = TASK.wave
/** 一轮最多几步（react.ts 的 MAX_STEPS，模拟器约定，不是硬件参数）。 */
export const STEP_LIMIT = MAX_STEPS

/** 探索一：任务自己的起点，block 48、步长 4。 */
export const TOUR_START: TuneConfig = TASK.start
/** 探索二的默认起点，也是第二个「先猜」问的那个：block 16、步长 2。 */
export const PATH_START: TuneConfig = { block: 16, stride: 2 }
/** 挑战的起点：block 100、步长 8（和探索一、探索二的默认起点都不一样）。 */
export const SEAT_START: TuneConfig = { block: 100, stride: 8 }

// ── 正文里的数（模拟；单测拿模拟器核对）─────────────────────────────────────

/** 探索一：规则 Agent 从 block 48、步长 4 出发，第 3 步看访存读到的车次；它这一轮停过的参数和步数。 */
export const TOUR = {
  transactions: 384,
  ideal: 132,
  path: [TOUR_START, { block: 48, stride: 1 }, { block: 64, stride: 1 }],
  steps: 10,
}

/** 探索二的默认起点 block 16、步长 2：一车都没多搬，lane 却空着一半（第二个先猜）；规则 Agent 先改 block、再改步长。 */
export const PATH = {
  transactions: 192,
  ideal: 192,
  laneUse: '49.8%',
  path: [PATH_START, { block: 32, stride: 2 }, { block: 32, stride: 1 }],
}

/** 挑战：起点 block 100、步长 8 看访存读到的车次；三星的一组 block 128、步长 1 的车次和示意时间（提示的答案）。 */
export const SEAT = {
  transactions: 768,
  ideal: 120,
  best: { block: 128, stride: 1 },
  bestTransactions: 96,
  bestCycles: TASK.bestCycles,
}

// ── 探索二：一轮缩成几站 ────────────────────────────────────────────────────

/** 行动的参数（args）是任务可选值里的一组 block、stride，就交回这一组；否则是 null。 */
export function configOf(args: unknown): TuneConfig | null {
  if (!args || typeof args !== 'object' || !('block' in args) || !('stride' in args)) return null
  const { block, stride } = args
  if (typeof block !== 'number' || typeof stride !== 'number') return null
  return inSpace(TASK, { block, stride }) ? { block, stride } : null
}

/** 在一组参数上连着走的几步：观察里读到了什么，为什么离开它。 */
export interface PathStop {
  config: TuneConfig
  /** 在这组上走的第一步、最后一步（从 1 数） */
  first: number
  last: number
  /** 观察里读到的；没用那样工具是 null */
  correct: boolean | null
  cycles: number | null
  /** lane 利用率（0–1） */
  laneUse: number | null
  transactions: number | null
  ideal: number | null
  /** 为什么离开它：紧接着那一步的思考（换参数的理由，或者交卷的理由）；走满步数时是空串 */
  why: string
}

export interface PathSummary {
  stops: PathStop[]
  /** 一共走了几步 */
  steps: number
  /** 交卷的评分；走满步数没交卷是 null */
  verdict: Verdict | null
}

/** 把一轮缩成几站：连着用同一组参数的几步算一站（交卷那一步不算一站，它的思考是最后一站的「为什么」）。 */
export function pathOf(steps: readonly AgentStep[]): PathSummary {
  const stops: PathStop[] = []
  steps.forEach((s, i) => {
    if (s.action.tool === 'finish') return
    const c = configOf(s.action.args)
    if (!c) return
    let stop = stops.at(-1)
    if (!stop || configKey(stop.config) !== configKey(c)) {
      stop = { config: c, first: i + 1, last: i + 1, correct: null, cycles: null, laneUse: null, transactions: null, ideal: null, why: '' }
      stops.push(stop)
    }
    stop.last = i + 1
    if (!s.observation.ok) return
    const d = s.observation.data
    if (s.action.tool === 'run_kernel') stop.correct = d.correct === true
    else if (s.action.tool === 'measure') {
      stop.cycles = Number(d.cycles)
      stop.laneUse = Number(d.lane_utilization)
    } else if (s.action.tool === 'inspect_memory') {
      stop.transactions = Number(d.transactions)
      stop.ideal = Number(d.ideal)
    }
  })
  // stop.last 从 1 数，steps[stop.last] 正好是紧接着的那一步
  for (const stop of stops) stop.why = steps[stop.last]?.thought ?? ''
  return { stops, steps: steps.length, verdict: steps.at(-1)?.observation.verdict ?? null }
}

/** 探索二旋钮一动就写的一句（03 第 1 节第 4 条）：先改了什么、再改了什么，第几步交了哪一组。 */
export function pathText(p: PathSummary): string {
  // 写成「先改 block，再改步长」：block 前面空一格（05 第 7 节，中英文之间加空格）
  const changes = p.stops.slice(1).map((stop, k) => {
    const before = p.stops[k].config
    const block = before.block !== stop.config.block
    const stride = before.stride !== stop.config.stride
    return block && stride ? ' block 和步长' : block ? ' block' : '步长'
  })
  const order = changes.length === 0 ? ''
    : changes.length === 1 ? `只改了${changes[0]}，`
      : `先改${changes[0]}，再改${changes.slice(1).join('，再改')}，`
  if (!p.verdict) return `${order}走满了 ${p.steps} 步，没有交卷。`
  const done = `第 ${p.steps} 步交卷：${describeConfig(p.verdict.config)}。`
  return order ? `${order}${done}` : `起点就没有能改的地方：运行、计时、看访存以后，${done}`
}

// ── 挑战：你来当 Agent ──────────────────────────────────────────────────────

/** 读者这一轮的一步：行动和观察（AgentConsole 的 finish 事件里 log 的每一项都有这两样）。 */
export interface SeatStep {
  action: AgentAction
  observation: Observation
}

/** 换掉或交卷之前，一组参数要用过的三样工具（★3）。 */
export const EVIDENCE_TOOLS = ['run_kernel', 'measure', 'inspect_memory'] as const
type EvidenceTool = (typeof EVIDENCE_TOOLS)[number]

/** 第一次没看清就离开一组参数：第几步、离开的是哪组、还缺哪几样；to 是换到的那组，交卷时是 null。 */
export interface Lapse {
  step: number
  config: TuneConfig
  missing: EvidenceTool[]
  to: TuneConfig | null
}

/**
 * ★3：每组参数换掉或交卷之前，都运行过、计过时、看过访存。从起点开始数，「手上这组」是最近一次合法行动用的参数；
 * 换成别的参数时看手上这组，交卷时看交的那组，三样观察齐不齐。返回第一次不齐的地方，都齐是 null。
 * 没执行的行动（参数不在可选值里）不算换参数，也不算看过。
 */
export function firstLapse(log: readonly SeatStep[], start: TuneConfig): Lapse | null {
  const seen = new Map<string, Set<string>>()
  let current = start
  for (let i = 0; i < log.length; i++) {
    const { action, observation } = log[i]
    const c = observation?.ok ? configOf(action.args) : null
    if (!c) continue
    // 这一步离开的组：换参数时是手上这组；交卷时还有交的那组
    const leaving: [TuneConfig, TuneConfig | null][] = []
    if (configKey(c) !== configKey(current)) leaving.push([current, c])
    if (action.tool === 'finish') leaving.push([c, null])
    for (const [config, to] of leaving) {
      const missing = EVIDENCE_TOOLS.filter((t) => !seen.get(configKey(config))?.has(t))
      if (missing.length) return { step: i + 1, config, missing, to }
    }
    if (action.tool === 'finish') return null
    current = c
    const tools = seen.get(configKey(c)) ?? new Set<string>()
    tools.add(action.tool)
    seen.set(configKey(c), tools)
  }
  return null
}

/** 「第 4 步换到 block 128、步长 1 时，block 100、步长 8 还没「计时」「看访存」。」 */
function lapseText(l: Lapse): string {
  const what = l.missing.map((t) => `「${TOOLS.find((x) => x.name === t)?.label ?? t}」`).join('')
  const head = l.to ? `第 ${l.step} 步换到 ${describeConfig(l.to)} 时` : `第 ${l.step} 步交卷时`
  return `${head}，${describeConfig(l.config)} 还没${what}。`
}

/** 06 第 7 节：输入读者这一轮，输出三颗星各自成立没有和下一步的一句话；没过时给「现象 / 原因 / 怎么改」。 */
export interface SeatVerdict {
  earned: [boolean, boolean, boolean]
  next: string
  error?: ChallengeError
}

function failed(error: ChallengeError): SeatVerdict {
  return { earned: [false, false, false], next: error.fix, error }
}

/**
 * 星级判定：
 * ★1 交卷了，交的那组在交卷之前运行过、观察里写着全部算对；
 * ★2 交的那组又快又省：控制台评分里不多搬、示意时间不超过 TASK.bestCycles（模拟）；
 * ★3 每组参数换掉或交卷之前，都运行过、计过时、看过访存（firstLapse）。
 * ★1 不成立时一颗都不发（结果不对，别的再好也不算）。start 是这一轮的起点。
 */
export function judge(log: readonly SeatStep[], start: TuneConfig = SEAT_START): SeatVerdict {
  const verdict = log.at(-1)?.observation?.verdict ?? null
  if (!verdict) {
    return failed({
      symptom: log.length >= STEP_LIMIT ? `走满了 ${log.length} 步，这一轮没有交卷。` : `这一轮还没有交卷（走了 ${log.length} 步）。`,
      cause: 'Agent 要自己决定什么时候停：不交卷，调得再好也没有分。',
      fix: `量到满意的一组，就用「交卷」交出它。一轮最多 ${STEP_LIMIT} 步，记得留一步交卷。`,
    })
  }
  const f = verdict.config
  const runs = log.slice(0, -1).filter((s) => {
    const c = s.action.tool === 'run_kernel' && s.observation.ok ? configOf(s.action.args) : null
    return c !== null && configKey(c) === configKey(f)
  })
  if (!runs.length) {
    return failed({
      symptom: `第 ${log.length} 步交了 ${describeConfig(f)}，可这一组一次都没运行过。`,
      cause: '没确认算对就交卷：Agent 不知道这一组算得对不对，交上去的可能是错的结果。',
      fix: `交卷之前，先用「运行」跑一次 ${describeConfig(f)}，观察里写着全部算对再交。`,
    })
  }
  if (!verdict.correct || runs.every((s) => s.observation.data.correct !== true)) {
    return failed({
      symptom: `交的 ${describeConfig(f)} 算错了：${runs.at(-1)?.observation.text ?? ''}`,
      cause: '结果不对，快也没用：评分先看算得对不对。',
      fix: '换一组运行过、观察里写着全部算对的参数再交。',
    })
  }

  const best = verdict.earned.every(Boolean)
  const lapse = firstLapse(log, start)
  const parts: string[] = []
  if (!best) {
    const why = [
      verdict.earned[1] ? '' : '搬的车比理想多',
      verdict.earned[2] ? '' : `示意时间 ${verdict.cycles} 个周期，没到 ${TASK.bestCycles} 个周期以内`,
    ].filter(Boolean).join('，')
    parts.push(`交的 ${describeConfig(f)} 还不是又快又省：${why}（模拟）。照着观察再换：多搬了就改步长；lane 利用率低，就看 block 是不是 ${WAVE} 的倍数。`)
  }
  if (lapse) parts.push(`${lapseText(lapse)}换参数、交卷之前，先把手上这组运行、计时、看访存都做一遍。`)
  if (!parts.length) {
    parts.push(`交的 ${describeConfig(f)} 先确认过算对，不多搬、${verdict.cycles} 个周期（模拟）；每组参数都看清楚了才换。三颗星的标准都达到了。`)
  }
  return { earned: [true, best, lapse === null], next: parts.join('') }
}

export const STAR_LABELS = [
  '交卷，交的那组先运行过，观察里写着全部算对',
  `交的参数又快又省：不多搬，示意时间 ${TASK.bestCycles} 个周期（模拟）`,
  '每组参数换掉或交卷之前，都运行过、计过时、看过访存',
] as const

/** 提示只在 ★1 没过时解锁（useChallenge）：先帮读者交上一份算对的卷，再指向又快又省、有凭有据。 */
export const HINTS: Hints = {
  direction: 'Agent 要自己决定什么时候停：觉得够好了，就用「交卷」交出一组。交之前，先用「运行」确认这一组算对。',
  location: `「交卷」用的 block 和 stride，要和你运行过、全部算对的那组一样。一轮最多 ${STEP_LIMIT} 步，走满了还没交卷，这一轮就没有分。`,
  answer: `起点 ${describeConfig(SEAT_START)}：运行、计时、看访存，搬了 ${SEAT.transactions} 车，理想只要 ${SEAT.ideal} 车。`
    + `换成 ${describeConfig(SEAT.best)}（步长 1 不多搬，${SEAT.best.block} 是 ${WAVE} 的倍数）：再运行、计时、看访存，`
    + `${SEAT.bestTransactions} 车等于理想，${SEAT.bestCycles} 个周期（模拟）。最后交卷。`,
  answerCode: [SEAT_START, SEAT.best].flatMap((c) => EVIDENCE_TOOLS.map((tool) => formatAction({ tool, args: { ...c } })))
    .concat(formatAction({ tool: 'finish', args: { ...SEAT.best } }))
    .join('\n'),
}

/** 存进草稿槽的：读者这一轮的行动（AgentConsole 的 v-model:actions）。 */
export interface SeatDraft {
  actions: AgentAction[]
}

/**
 * 草稿槽里读出来的可能是旧版本或被手改坏：只留工具名和参数都合法的行动，遇到第一个不合法的就截断
 * （留下的一定是读者真走过的前几步），交卷以后、超过步数上限的不要。
 */
export function normalizeDraft(raw: unknown): SeatDraft {
  const actions: AgentAction[] = []
  const list = raw && typeof raw === 'object' && 'actions' in raw ? raw.actions : null
  if (!Array.isArray(list)) return { actions }
  for (const item of list) {
    if (actions.length >= STEP_LIMIT || !item || typeof item !== 'object' || !('tool' in item) || !('args' in item)) break
    const { tool, args } = item
    const c = configOf(args)
    if (typeof tool !== 'string' || !TOOLS.some((t) => t.name === tool) || !c) break
    actions.push({ tool, args: { block: c.block, stride: c.stride } })
    if (tool === 'finish') break
  }
  return { actions }
}
