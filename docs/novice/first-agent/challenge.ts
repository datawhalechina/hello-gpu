/**
 * 1-14 造你的第一个 Agent：热身、两段探索和挑战用到的数、文字和判定（纯函数，单测在 scripts/tests/novice-first-agent.test.mjs，06 第 7 节）。
 *
 * Agent 调的还是 A-01 的固定任务（docs/course/agent/tasks.ts 的 VECTOR_ADD）：1000 个数的向量加法，能改每组线程数 block
 * 和访问步长 stride，一共 7 × 4 = 28 组参数，这就是这一关的搜索空间。
 * - 热身：上一关的规则 Agent 从 block 48、步长 4 出发走 10 步，28 组里只试了 3 组（TOUR）。
 * - 探索一（scenes/TryAll.vue）：全试一遍。每组运行一次、计一次时（2 步），最后交卷 1 步，一共 57 步；
 *   一轮最多 15 步，只够试 7 组。28 组的周期数和车次写在 SPACE 里（模拟值，单测拿模拟器把两种写法都核对一遍）。
 * - 探索二（scenes/RuleLab.vue）：规则 Agent 的两条规则开关。ruleWalk 是读者那份 Python 模板（starter.ts）的 JS 双胞胎：
 *   规则一开着就是第 1、2 个空填对，规则二开着就是第 3 个空填对，关着就是初始内容 False；单测拿 Pyodide 跑真的模板，
 *   28 个起点 × 4 种开法逐个核对走法和评分。
 * - 挑战（scenes/AgentBench.vue）：AgentCode（A-02）里补三个空，运行读者的 Python Agent。起点 block 48、步长 4；
 *   跑完以后同一份代码从另外 27 组出发各跑一遍（AgentCode 的 variants）。judge 只看这些轮的结果：
 *   ★1 交卷了、交的参数算对；★2 从起点交出又快又省的参数；★3 28 个起点都调到又快又省。
 *   AgentCode 的 worker 跑 HIP 写法的 kernel（同 AgentConsole）；两种写法的观察逐项相同（A-01 的单测），
 *   所以判定和写法无关，本关单测把两种写法都跑一遍。
 *
 * 只从 react.ts、tasks.ts、starter.ts 拿纯数据和纯函数，不导入模拟器和 Pyodide：页面首屏不带它们。
 * 周期数、车次都是模拟值。
 */
import type { ChallengeError, Hints } from '../../course/useChallenge.ts'
import { MAX_STEPS, starText, type AgentAction, type Observation, type Verdict } from '../../course/agent/react.ts'
import { VECTOR_ADD_STARTER } from '../../course/agent/starter.ts'
import { allConfigs, configKey, describeConfig, sameConfig, VECTOR_ADD, type TuneConfig } from '../../course/agent/tasks.ts'

export const STAGE_ID = 'novice-first-agent'

/** Agent 调的任务：1000 个数的向量加法（1-1 的一千道加法）。 */
export const TASK = VECTOR_ADD
/** 读者补的那份 Python Agent：模板、三个空、参考答案（A-02）。 */
export const STARTER = VECTOR_ADD_STARTER
/** 一支小队 32 个线程（wave32，1-5）。 */
export const WAVE = TASK.wave
/** 一轮最多几步（react.ts 的 MAX_STEPS，模拟器约定，不是硬件参数）。 */
export const STEP_LIMIT = MAX_STEPS
/** 挑战的起点：任务自己的起点 block 48、步长 4（能跑但不好）。 */
export const START: TuneConfig = TASK.start

// ── 搜索空间：28 组参数各自的观察（模拟；单测拿模拟器核对）─────────────────────

/** 一组参数：计时的周期数，看访存的车次、理想车次。28 组都算得对（kernel 有边界检查）。 */
export interface SpaceCell {
  config: TuneConfig
  cycles: number
  transactions: number
  ideal: number
}

/** 按 block 分行，每行按步长 1 / 2 / 4 / 8：[周期数, 车次, 理想车次]。 */
const TABLE: Readonly<Record<number, readonly (readonly [number, number, number])[]>> = {
  16: [[1134, 189, 189], [1088, 192, 192], [1824, 384, 192], [3344, 768, 192]],
  32: [[576, 96, 96], [928, 192, 96], [1680, 384, 96], [3208, 768, 96]],
  48: [[876, 156, 126], [986, 192, 126], [1748, 384, 132], [3268, 768, 120]],
  64: [[576, 96, 96], [928, 192, 96], [1680, 384, 96], [3208, 768, 96]],
  100: [[1008, 192, 120], [1256, 264, 120], [1936, 432, 120], [3320, 768, 120]],
  128: [[576, 96, 96], [928, 192, 96], [1680, 384, 96], [3208, 768, 96]],
  256: [[576, 96, 96], [928, 192, 96], [1680, 384, 96], [3312, 768, 96]],
}

/** 搜索空间：block 在外层、步长在里层，都从小到大（tasks.ts 的 allConfigs）。 */
export const SPACE: readonly SpaceCell[] = allConfigs(TASK).map((config) => {
  const [cycles, transactions, ideal] = TABLE[config.block][TASK.strides.indexOf(config.stride)]
  return { config, cycles, transactions, ideal }
})

const BY_KEY = new Map(SPACE.map((cell) => [configKey(cell.config), cell]))

/** 一组参数的观察；不在搜索空间里会抛错（只给正文和场景用，参数都来自 SPACE）。 */
export function cellOf(c: TuneConfig): SpaceCell {
  const cell = BY_KEY.get(configKey(c))
  if (!cell) throw new RangeError(`${describeConfig(c)} 不在搜索空间里。`)
  return cell
}

/** 搬的车比理想多。 */
export function extraOf(c: TuneConfig): boolean {
  const cell = cellOf(c)
  return cell.transactions > cell.ideal
}

/** 最快的几组：示意时间等于 TASK.bestCycles（模拟）。 */
export const BEST: readonly SpaceCell[] = SPACE.filter((cell) => cell.cycles === TASK.bestCycles)

/** 起点这一圈的两份观察：计时、看访存给回来的字典（正文讲「观察是一个字典」用）。 */
export const TIMING_AT_START = { cycles: 1748, compute: 212, memory: 1536, sync: 0, lane_utilization: 0.742 }
export const MEMORY_AT_START = { accesses: 132, transactions: 384, ideal: 132, efficiency: 0.344 }

/** 写成 AgentCode 里观察那一行的样子：{ "cycles": 1748, … }。 */
export function dictText(data: Readonly<Record<string, number | boolean | string>>): string {
  return `{ ${Object.entries(data).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ')} }`
}

// ── 热身：规则 Agent 试了几组 ───────────────────────────────────────────────

/** 上一关探索一：规则 Agent 从 block 48、步长 4 出发停过的参数和步数（单测拿 rules.ts 核对）。 */
export const TOUR = {
  path: [START, { block: 48, stride: 1 }, { block: 64, stride: 1 }] as readonly TuneConfig[],
  steps: 10,
}

// ── 探索一：全试一遍 ────────────────────────────────────────────────────────

/** 全试一遍每组用几步：运行一次（确认算对）、计一次时。 */
export const TRY_STEPS = 2
/** 28 组全试一遍，再加交卷 1 步。 */
export const SWEEP_STEPS = SPACE.length * TRY_STEPS + 1
/** 一轮最多 15 步、留一步交卷时，全试的做法最多试几组。 */
export const BUDGET_CONFIGS = Math.floor((STEP_LIMIT - 1) / TRY_STEPS)

/** 试过的几组里最快的（一样快的取先试的）；一组都没试是 null。 */
export function fastestOf(tried: readonly TuneConfig[]): SpaceCell | null {
  let best: SpaceCell | null = null
  for (const c of tried) {
    const cell = cellOf(c)
    if (!best || cell.cycles < best.cycles) best = cell
  }
  return best
}

/** 探索一试了几组以后的一句（03 第 1 节第 4 条：参数一变马上解读）。 */
export function tryText(tried: readonly TuneConfig[]): string {
  const n = tried.length
  if (n === 0) return '一组都还没试。全试一遍，每组运行一次、计一次时，各算 1 步。'
  const best = fastestOf(tried)!
  const used = `试了 ${n} 组，用了 ${n * TRY_STEPS} 步`
  const fastest = `${describeConfig(best.config)}，${best.cycles} 个周期（模拟）`
  if (n === SPACE.length) {
    return `${SPACE.length} 组全试完：${used}，再交卷 1 步，一共 ${SWEEP_STEPS} 步。最快的 ${BEST.length} 组都是 ${TASK.bestCycles} 个周期（模拟）。`
  }
  if (n < BUDGET_CONFIGS) return `${used}。目前最快：${fastest}。`
  if (n === BUDGET_CONFIGS) return `${used}：一轮 ${STEP_LIMIT} 步只剩交卷那 1 步了。这时交卷，交的是 ${fastest}。`
  return `${used}，超出一轮的 ${STEP_LIMIT} 步了：多试的只是让你看全貌。目前最快：${fastest}。`
}

// ── 探索二：两条规则（模板的 JS 双胞胎）────────────────────────────────────────

/** 两条规则开着没有：stride 是规则一（多搬了，步长改成 1），block 是规则二（不是 32 的倍数，往上取整）。 */
export interface Rules {
  stride: boolean
  block: boolean
}

export interface Walk {
  /** 每一圈用的参数，第一项是起点 */
  path: TuneConfig[]
  /** 一共走了几步（一次工具一步） */
  steps: number
  /** finish：交卷了；limit：步数用完，没有交卷 */
  stop: 'finish' | 'limit'
  /** 交的那组和控制台的三颗星（算对、不多搬、最快）；没交卷是 null */
  verdict: { config: TuneConfig; earned: [boolean, boolean, boolean] } | null
}

/**
 * 照着模板走一轮：每一圈先运行、计时、看访存（3 步），再想：规则一开着、多搬了、步长大于 1，步长改成 1；
 * 否则规则二开着、block 不是 32 的倍数，往上取到 32 的倍数；否则交卷（1 步）。
 * 步数用完时，Python 那边在下一次调用工具时停下（StepLimit），这里同样记成 limit；path 只记开了头的圈。
 */
export function ruleWalk(start: TuneConfig, rules: Rules, maxSteps: number = STEP_LIMIT): Walk {
  const path: TuneConfig[] = []
  let c = start
  let steps = 0
  for (;;) {
    if (steps >= maxSteps) return { path, steps, stop: 'limit', verdict: null }
    path.push(c)
    if (steps + 3 > maxSteps) return { path, steps: maxSteps, stop: 'limit', verdict: null }
    steps += 3
    if (rules.stride && extraOf(c) && c.stride > 1) {
      c = { block: c.block, stride: 1 }
    } else if (rules.block && c.block % WAVE !== 0) {
      // 同模板里的 (block + 31) // 32 * 32
      c = { block: Math.ceil(c.block / WAVE) * WAVE, stride: c.stride }
    } else {
      if (steps >= maxSteps) return { path, steps, stop: 'limit', verdict: null }
      // 交卷的评分同 tools.ts：28 组都算得对；不多搬；示意时间不超过 TASK.bestCycles
      const cell = cellOf(c)
      const earned: [boolean, boolean, boolean] = [true, cell.transactions === cell.ideal, cell.cycles <= TASK.bestCycles]
      return { path, steps: steps + 1, stop: 'finish', verdict: { config: c, earned } }
    }
  }
}

/** 探索二的四种开法，从挑战的起点出发（正文、先猜、实验台都用它）。 */
export const RULE_CASES = {
  none: ruleWalk(START, { stride: false, block: false }),
  stride: ruleWalk(START, { stride: true, block: false }),
  block: ruleWalk(START, { stride: false, block: true }),
  both: ruleWalk(START, { stride: true, block: true }),
}

/** 交的这组为什么不是又快又省（空串：它就是又快又省）。 */
function shortfall(c: TuneConfig): string {
  const cell = cellOf(c)
  if (cell.transactions > cell.ideal && c.stride > 1) {
    return `搬了 ${cell.transactions} 车，理想只要 ${cell.ideal} 车（模拟），多搬了`
  }
  if (c.block % WAVE !== 0) {
    return `block ${c.block} 不是 ${WAVE} 的倍数，每组最后一个 wave 有 lane 空着，${cell.cycles} 个周期（模拟）`
  }
  return ''
}

/** 探索二旋钮一动就写的一句。 */
export function walkText(w: Walk): string {
  if (!w.verdict) return `走满了 ${w.steps} 步，没有交卷。`
  const { config, earned } = w.verdict
  const tried = `试了 ${w.path.length} 组，第 ${w.steps} 步交卷：${describeConfig(config)}，${starText(earned)}`
  if (earned.every(Boolean)) return `${tried}，不多搬，${cellOf(config).cycles} 个周期（模拟）。`
  return `${tried}。${shortfall(config)}。`
}

// ── 挑战：补全你的 Agent ────────────────────────────────────────────────────

/** 挑战里换起点再跑的 27 组：搜索空间里除了起点的每一组，按 SPACE 的顺序。 */
export const VARIANTS: readonly TuneConfig[] = SPACE.map((cell) => cell.config).filter((c) => !sameConfig(c, START))

/** AgentCode 交来的一步：行动和观察。 */
export interface BenchStep {
  action: AgentAction
  observation: Observation
}

/** AgentCode 交来的一轮（result 事件里起点这一轮，或者 variants 里的一项）。 */
export interface BenchRun {
  /** finish：交卷了；limit：步数用完；end：程序跑完了没交卷；error：代码出错停下了 */
  stop: 'finish' | 'limit' | 'end' | 'error'
  verdict: Verdict | null
  /** 代码出的错，已经写成「现象 + 原因 + 怎么改」（AgentCode 用 pyerror.ts 写好） */
  error: ChallengeError | null
  log: readonly BenchStep[]
}

export interface BenchVariant extends BenchRun {
  start: TuneConfig
}

/** AgentCode 的 result 事件里判星要用的部分。 */
export interface BenchResult extends BenchRun {
  variants: readonly BenchVariant[]
}

/** 06 第 7 节：三颗星各自成立没有、下一步的一句话；★1 没过时带「现象 / 原因 / 怎么改」。 */
export interface BenchVerdict {
  earned: [boolean, boolean, boolean]
  next: string
  error?: ChallengeError
}

/** 一轮里每一圈的参数（每一圈从运行开始；没执行的行动不算）。 */
export function roundsOf(log: readonly BenchStep[]): TuneConfig[] {
  const out: TuneConfig[] = []
  for (const { action, observation } of log) {
    if (action.tool !== 'run_kernel' || !observation?.ok) continue
    const { block, stride } = action.args
    if (typeof block === 'number' && typeof stride === 'number') out.push({ block, stride })
  }
  return out
}

/** 步数用完、没交卷：原地打转，还是改得太慢。 */
function limitError(run: BenchRun): ChallengeError {
  const rounds = roundsOf(run.log)
  const last = rounds.at(-1)
  const prev = rounds.at(-2)
  if (last && prev && sameConfig(last, prev)) {
    const where = last.stride > 1 && extraOf(last)
      ? `看出多搬了，可第 2 个空给的新步长还是 ${last.stride}。`
      : last.block % WAVE === 0
        ? `第 3 个空说 block ${last.block} 不合适，可它已经是 ${WAVE} 的倍数，往上取整还是 ${last.block}。`
        : ''
    return {
      symptom: `走满了 ${run.log.length} 步，你的 Agent 还没交卷：最后几圈一直停在 ${describeConfig(last)}。`,
      cause: `有一个判断一直成立，可改完的参数和原来一样，下一圈看到的还是同样的观察，原地打转。${where}`,
      fix: '让每次改动真的换一组参数；看不出问题的时候，判断要是 False，Agent 才会走到 else 去交卷。',
    }
  }
  return {
    symptom: `走满了 ${run.log.length} 步，你的 Agent 还没交卷：试了 ${rounds.length} 组，最后停在 ${last ? describeConfig(last) : '起点'}。`,
    cause: `一组参数要运行、计时、看访存 3 步，一轮最多 ${STEP_LIMIT} 步：一次只改一点，还没改到位，步数就用完了。`,
    fix: '让一次改动就改到位：多搬了，就直接换成不多搬的步长。',
  }
}

/** ★1 没过的原因：出错、走满步数、没交卷、交的算错了。 */
function stopError(run: BenchRun): ChallengeError {
  if (run.stop === 'error' && run.error) return run.error
  if (run.stop === 'limit') return limitError(run)
  if (run.stop === 'finish' && run.verdict) {
    return {
      symptom: `交的 ${describeConfig(run.verdict.config)} 算错了。`,
      cause: '结果不对，快也没用：评分先看算得对不对。',
      fix: '交卷之前先用 run_kernel 跑一次，观察里写着全部算对再交。',
    }
  }
  return {
    symptom: '程序跑完了，可是没有调用 finish 交卷。',
    cause: '不交卷就没有分：Agent 要自己决定什么时候停。',
    fix: '跳出循环以后，用 finish(block=block, stride=stride) 交出手上的参数。',
  }
}

/** 换起点再跑时第一个没调好的那一轮，写成一句。 */
function variantText(start: TuneConfig, v: BenchVariant | undefined): string {
  const from = `从 ${describeConfig(start)} 出发`
  if (!v) return `${from}的那一轮没有跑完。`
  if (v.stop === 'finish' && v.verdict) {
    const why = v.verdict.correct ? shortfall(v.verdict.config) : '交的参数算错了'
    return `${from}，交了 ${describeConfig(v.verdict.config)}：${why}。`
  }
  const e = stopError(v)
  return `${from}：${e.symptom}${v.stop === 'limit' ? e.cause : ''}`
}

/**
 * 星级判定：
 * ★1 起点这一轮交卷了，交的参数算对；
 * ★2 起点这一轮交的参数又快又省（控制台评分里不多搬、示意时间不超过 TASK.bestCycles）；
 * ★3 换成另外 27 组当起点，同一份代码也都调到又快又省（连同起点，28 组都成立，所以 ★3 成立时 ★2 也成立）。
 * ★1 不成立时一颗都不发，带上「现象 / 原因 / 怎么改」。
 */
export function judge(result: BenchResult, start: TuneConfig = START): BenchVerdict {
  if (result.stop !== 'finish' || !result.verdict || !result.verdict.correct) {
    const error = stopError(result)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const f = result.verdict.config
  const expected = SPACE.map((cell) => cell.config).filter((c) => !sameConfig(c, start))
  const byStart = new Map(result.variants.map((v) => [configKey(v.start), v]))
  // 又快又省：交卷了，控制台的三颗星都成立（算对、不多搬、最快）；第 0 项是起点这一轮，后面按 expected 的顺序
  const ok = [result, ...expected.map((c) => byStart.get(configKey(c)))]
    .map((run) => Boolean(run && run.stop === 'finish' && run.verdict?.earned.every(Boolean)))
  const best = ok[0]
  const misses = expected.filter((_, k) => !ok[k + 1])
  const all = best && misses.length === 0

  const head = `从 ${describeConfig(start)} 出发，你的 Agent 走了 ${result.log.length} 步，交了 ${describeConfig(f)}`
  const parts: string[] = []
  if (!best) {
    parts.push(`${head}：${shortfall(f)}。`)
    parts.push(f.stride > 1 && extraOf(f)
      ? '第 1 个空要从看访存的观察里看出多搬了，第 2 个空给出新的步长。'
      : `第 3 个空要看出 block 不是 ${WAVE} 的倍数。`)
  } else {
    parts.push(`${head}：不多搬，${result.verdict.cycles} 个周期（模拟）。`)
  }
  if (best && misses.length) {
    const first = misses[0]
    const v = byStart.get(configKey(first))
    parts.push(`换起点再跑，有 ${misses.length} 组没调到又快又省。${variantText(first, v)}`)
    parts.push(v ? '同一份代码要从哪个起点出发都管用：判断里别写死某一个起点的数。' : '再运行一次，等换起点的几轮都跑完。')
  }
  if (all) parts.push(`换成另外 ${expected.length} 组当起点，也都调到又快又省。三颗星的标准都达到了。`)
  return { earned: [true, best, all], next: parts.join('') }
}

export const STAR_LABELS = [
  '你的 Agent 交卷了，交的参数算对',
  `从 ${describeConfig(START)} 出发，交的参数又快又省：不多搬，${TASK.bestCycles} 个周期（模拟）`,
  `搜索空间里的 ${SPACE.length} 组都当一回起点，同一份代码都调到又快又省`,
] as const

/** 提示只在 ★1 没过时解锁（useChallenge）：先让 Agent 跑完一轮、交上卷，再指向三个空各写什么。 */
export const HINTS: Hints = {
  direction: '先让 Agent 跑完一轮、交上卷：看「这次的问题」写的是哪一行、哪个空。第 1、3 个空是判断，算出来是 True 或 False；第 2 个空是一个数。',
  location: `第 1 个空比的是看访存交回来的两个数：memory["transactions"] 是搬了几车，memory["ideal"] 是理想几车。第 2 个空写新的步长：相邻线程拿相邻的数。第 3 个空用 % 求余数，看 block 是不是 ${WAVE} 的倍数。`,
  answer: `第 1 个空：搬的车比理想多；第 2 个空：步长改成 1；第 3 个空：block 除以 ${WAVE} 有余数。`,
  answerCode: [
    `# 第 1 个空\n${STARTER.answers.extra}`,
    `# 第 2 个空\n${STARTER.answers.stride}`,
    `# 第 3 个空\n${STARTER.answers.block}`,
  ].join('\n'),
}

/** 存进草稿槽的：读者填的三个空（AgentCode 的 v-model:values）。 */
export interface BenchDraft {
  values: Record<string, string>
}

/** 一个空最多留多少字（编辑器里不能换行；太长的多半是手改坏的草稿）。 */
const MAX_BLANK_CHARS = 200

/** 草稿槽里读出来的可能是旧版本或被手改坏：只留模板里有的空、一行以内的文字。 */
export function normalizeDraft(raw: unknown): BenchDraft {
  const values: Record<string, string> = {}
  const list = raw && typeof raw === 'object' && 'values' in raw ? raw.values : null
  if (!list || typeof list !== 'object') return { values }
  for (const name of Object.keys(STARTER.blanks)) {
    const v = (list as Record<string, unknown>)[name]
    if (typeof v === 'string' && v.length <= MAX_BLANK_CHARS && !/[\r\n]/.test(v)) values[name] = v
  }
  return { values }
}

/** 挑战的表上一格：从这组出发的那一轮怎样了。 */
export interface StartMark {
  config: TuneConfig
  /** 交卷拿到几颗星（控制台的评分）；没交卷是 null */
  stars: number | null
  stop: BenchRun['stop'] | null
}

/** 把起点这一轮和换起点的几轮摊到搜索空间的每一格上（没跑过的格子 stop 是 null）。 */
export function startMarks(result: BenchResult, start: TuneConfig = START): StartMark[] {
  const byStart = new Map(result.variants.map((v) => [configKey(v.start), v as BenchRun]))
  byStart.set(configKey(start), result)
  return SPACE.map(({ config }) => {
    const run = byStart.get(configKey(config))
    if (!run) return { config, stars: null, stop: null }
    const stars = run.stop === 'finish' && run.verdict ? run.verdict.earned.filter(Boolean).length : null
    return { config, stars, stop: run.stop }
  })
}

// ── 搜索空间表（scenes/SpaceGrid.vue）上的一格 ───────────────────────────────

/** 表上一格写什么：场景给，表只管画。 */
export interface GridCell {
  /** 格子里的短字：周期数、①、★★★；空串时画一个点 */
  text: string
  /** 读屏读的完整说法 */
  label: string
  /** best 最快、good 达标、bad 没过、path 走过、muted 还没试 */
  tone?: 'best' | 'good' | 'bad' | 'path' | 'muted'
  /** 角标：起点、交卷 */
  tag?: string
}
