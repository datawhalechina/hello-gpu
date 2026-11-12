/**
 * 全站进度存档 v2：经验值与等级、关卡完成与星级、徽章、图鉴、预测记录、偏好、「我的 GPU 卡片」、导出导入。
 *
 * 这个文件是纯 TS：不碰 window / localStorage / Date 以外的宿主 API，
 * 每个接口都是「传入状态对象 → 改它 → 返回发生了什么（事件数组）」，
 * 所以 node --test 可以直接 import 它。浏览器存储在 storage.ts，Vue 层在 useProgress.ts。
 *
 * 规则来源：课程规则（经验值与等级）、第 3 节（星级）、第 7 节（进度与存档）。
 */

export const PROGRESS_VERSION = 2

/** 04 第 2 节的经验值表。 */
export const XP_PER_LEVEL = 300
export const XP_STAGE = 100
export const XP_STAR = 50
export const XP_BOSS = 500
export const XP_AGENT_SIDE = 50
/** 观摩模式完成真卡关卡：给经验值，不给星。 */
export const XP_WATCH = 100
export const XP_EXERCISE_MIN = 50
export const XP_EXERCISE_MAX = 150
export const MAX_STARS = 3
/** 04 第 3 节：在挑战里看过答案，本关最高 2 星。 */
export const MAX_STARS_AFTER_ANSWER = 2
/** 04 第 7 节：距离上次导出超过 14 天时建议再导出一次。 */
export const EXPORT_REMINDER_DAYS = 14
export const OVERWRITE_WARNING = '导入会覆盖这台设备上的现有进度，并且无法撤销。'

/** 试点关卡（NV-04 迁成正式的 1-4、删掉了试点代码）的存档键，读到它就迁移进 v2。 */
export const PILOT_KEY = 'hg-pilot-v1'
export const PILOT_LANG_KEY = 'hg-pilot-lang'
/** 试点只有这一关，迁移后挂在它的正式关卡 id 下。 */
export const PILOT_STAGE_ID = 'novice-thread-groups'
/**
 * 试点图鉴存的是中文术语名（试点概念卡的 term 属性），
 * v2 的图鉴按 glossary.json 的 key 存，迁移时在这里换成正式 key。
 */
export const PILOT_TERM_KEYS: Record<string, string> = {
  线程块: 'block',
  网格: 'grid',
  全局下标: 'global-index',
}

export type XpSource = 'stage' | 'star' | 'boss' | 'exercise' | 'agent' | 'watch' | 'placement'

/** 存档里标注经验值的来源，「定级」是 04 第 2 节点名要求标的那一项。 */
export const XP_SOURCE_LABEL: Record<XpSource, string> = {
  stage: '完成关卡',
  star: '星',
  boss: 'Boss',
  exercise: '副本',
  agent: 'Agent 支线',
  watch: '观摩模式',
  placement: '定级',
}

export type StageKind = 'stage' | 'boss'
export type StageMode = 'normal' | 'watch'
export type Lang = 'hip' | 'python'
export type Route = 'hip' | 'triton'

export interface Prefs {
  /** 新手村的写法偏好（F-11）。 */
  lang: Lang
  /** 铸造城、试炼场的路线偏好（F-11）。 */
  route: Route
  /** 简洁模式：只保留文字反馈（04 第 8 节）。 */
  plain: boolean
  /** 减弱动效。 */
  reducedMotion: boolean
}

export interface StageProgress {
  /** 已经拿到的星序号，0 / 1 / 2。 */
  stars: number[]
  completed: boolean
  /** 用观摩模式完成的（没有真卡）。再用真卡做一遍会清掉这个标记。 */
  watched: boolean
  /** 看完过一次观摩回放（L-05）：之后做完检查点、又没有用真卡拿到星，按观摩完成本关（completeModeOf）。 */
  replayed: boolean
  /** 在挑战里看过答案：本关最高 2 星。 */
  answerViewed: boolean
  /** 定级测试豁免：不自动给星，可以随时回来拿星。 */
  exempt: boolean
  /** Agent 支线完成。 */
  agentSide: boolean
  /** 通关时用过的写法（新手村），「双语法」徽章看它。 */
  langs: Lang[]
  /** 通关时用过的路线（铸造城、试炼场），「双路线」徽章看它。 */
  routes: Route[]
  /** 第一次完成的时间，0 表示还没完成。 */
  at: number
  /** 最近一次打开这一关的时间，0 表示没打开过（世界地图的「你在这」看它）。 */
  visitedAt: number
}

/**
 * 一道副本的进度（X-01）。经验值按题发：通关（★1 结果正确）时发一次这道题的 50–150 XP（04 第 2 节）；
 * 副本的星只标出做到了哪一步，不另给经验值，也不进全站的星数（summarize 只数关卡的星）。
 */
export interface ExerciseRecord {
  /** 通关了没有。 */
  completed: boolean
  /** 通关时发的经验值，还没通关是 0。 */
  xp: number
  /** 第一次通关的时间，0 表示还没通关。 */
  at: number
  /** 已经拿到的星序号，0 / 1 / 2。 */
  stars: number[]
  /** 在挑战里看过答案：这道题最高 2 星，题解也跟着展开。 */
  answerViewed: boolean
  /** 最近一次打开这道题的时间，0 表示没打开过（副本大厅的「进行中」看它）。 */
  visitedAt: number
}

export interface CodexEntry {
  at: number
  /** 第一次学到它的关卡，「我的成长」页据此点回去。 */
  stage: string
}

export interface PredictionRecord {
  choice: number
  correct: boolean
  at: number
  stage: string
}

export interface PlacementRecord {
  level: number
  /** 已经换算发放过的经验值，重复定级时只补差额。 */
  xp: number
  at: number
  exempt: string[]
}

/**
 * 「我的 GPU 卡片」里的一张卡（L-07）：hg.device_card() 导入码（HGCARD1.）里的数，加上导入的时间。
 * device.ts 负责解码、检查和换成这个样子；1-2 的全景图、2-4 的 Roofline 读当前选中的那张。
 */
export interface DeviceRecord {
  /** 认卡用的键：gfx、CU 数和名称（同 hello_gpu 峰值缓存认卡的三项），同一张卡再导入时更新这一条。 */
  id: string
  name: string
  gfx: string
  /** 计算单元个数。 */
  cus: number
  /** wave 大小；PyTorch 和 rocminfo 都没给时是 null。 */
  wave: number | null
  /** 显存字节数（PyTorch 的 total_memory）。 */
  memoryBytes: number
  /** 软件版本；查不到的是 null。 */
  env: { rocm: string | null; torch: string | null; triton: string | null }
  /** 2-4 的 hg.peak() 测出的峰值；at 是带着它的那个导入码的生成时间。还没测过是 null。 */
  peak: { gbps: number; tflops: number; at: string } | null
  /** 导入码的生成时间（UTC，写法 2026-11-08T10:00:00Z，按字符串比较就是按时间比较）。 */
  at: string
  /** 导入到这台设备上的时间。 */
  importedAt: number
}

export interface DeviceShelf {
  cards: DeviceRecord[]
  /** 当前选中的那张卡的 id；空串表示没有选（没有导入过，或者当前那张删掉了），全景图画本书的实验卡。 */
  current: string
}

export interface ProgressState {
  v: typeof PROGRESS_VERSION
  xp: number
  bySource: Record<XpSource, number>
  stages: Record<string, StageProgress>
  exercises: Record<string, ExerciseRecord>
  /** 徽章 id → 获得时间。 */
  badges: Record<string, number>
  /** 术语 key → 收录记录。 */
  codex: Record<string, CodexEntry>
  predictions: Record<string, PredictionRecord>
  prefs: Prefs
  placement: PlacementRecord | null
  /** 「我的 GPU 卡片」（L-07）。 */
  devices: DeviceShelf
  /** 已经迁移过的旧存档：键 → 迁移时间，保证只迁一次。 */
  migrated: Record<string, number>
  createdAt: number
  updatedAt: number
  lastExportAt: number | null
}

/**
 * 进度变化事件。发星、升级、得徽章、收入图鉴都在这里，F-13 的 RewardLayer 订阅它播奖励。
 * 纯函数只返回事件，不负责广播；广播在 useProgress.ts 的 onProgressEvent。
 */
export type ProgressEvent =
  | { type: 'xp'; amount: number; source: XpSource; reason: string }
  | { type: 'level'; level: number; from: number }
  | { type: 'star'; stage: string; index: number; stars: number }
  | { type: 'stage'; stage: string; kind: StageKind; mode: StageMode }
  | { type: 'badge'; id: string }
  | { type: 'codex'; key: string; stage: string }
  | { type: 'pref'; key: keyof Prefs; value: Prefs[keyof Prefs] }

export function defaultPrefs(): Prefs {
  return { lang: 'hip', route: 'hip', plain: false, reducedMotion: false }
}

export function emptyState(at = Date.now()): ProgressState {
  return {
    v: PROGRESS_VERSION,
    xp: 0,
    bySource: { stage: 0, star: 0, boss: 0, exercise: 0, agent: 0, watch: 0, placement: 0 },
    stages: {},
    exercises: {},
    badges: {},
    codex: {},
    predictions: {},
    prefs: defaultPrefs(),
    placement: null,
    devices: { cards: [], current: '' },
    migrated: {},
    createdAt: at,
    updatedAt: at,
    lastExportAt: null,
  }
}

export function emptyStage(): StageProgress {
  return {
    stars: [], completed: false, watched: false, replayed: false, answerViewed: false, exempt: false, agentSide: false, langs: [], routes: [],
    at: 0, visitedAt: 0,
  }
}

export function emptyExercise(): ExerciseRecord {
  return { completed: false, xp: 0, at: 0, stars: [], answerViewed: false, visitedAt: 0 }
}

// ── 等级换算 ──────────────────────────────────────────────────────────────
// 04 第 2 节：Lv.N 需要累计 300 × (N − 1) XP，每 300 XP 升一级，不设上限。

export function levelOf(xp: number): number {
  const safe = Number.isFinite(xp) && xp > 0 ? xp : 0
  return Math.floor(safe / XP_PER_LEVEL) + 1
}

/** 升到 Lv.N 需要的累计经验值，定级测试按它换算（Lv.10 = 2700 XP）。 */
export function xpForLevel(level: number): number {
  const safe = Number.isFinite(level) && level > 1 ? Math.floor(level) : 1
  return (safe - 1) * XP_PER_LEVEL
}

/** 当前等级内已经攒了多少。 */
export function xpIntoLevel(xp: number): number {
  const safe = Number.isFinite(xp) && xp > 0 ? xp : 0
  return safe - xpForLevel(levelOf(safe))
}

/** 还差多少升下一级。 */
export function xpToNext(xp: number): number {
  return XP_PER_LEVEL - xpIntoLevel(xp)
}

// ── 内部工具 ──────────────────────────────────────────────────────────────

function stageOf(state: ProgressState, id: string): StageProgress {
  state.stages[id] ??= emptyStage()
  return state.stages[id]
}

function gain(state: ProgressState, amount: number, source: XpSource, out: ProgressEvent[], reason = XP_SOURCE_LABEL[source]) {
  if (!Number.isFinite(amount) || amount <= 0) return
  const before = levelOf(state.xp)
  state.xp += amount
  state.bySource[source] = (state.bySource[source] ?? 0) + amount
  out.push({ type: 'xp', amount, source, reason })
  const after = levelOf(state.xp)
  if (after > before) out.push({ type: 'level', level: after, from: before })
}

function touch(state: ProgressState, at: number, events: ProgressEvent[]): ProgressEvent[] {
  if (events.length) state.updatedAt = at
  return events
}

// ── 关卡 ──────────────────────────────────────────────────────────────────

export interface CompleteOptions {
  /** Boss 关 500 XP（04 第 2 节）。 */
  kind?: StageKind
  /** 观摩模式完成真卡关卡：100 XP，不发星。 */
  mode?: StageMode
  /** 这次用的写法（新手村两种写法），「双语法」徽章看它。 */
  lang?: Lang
  /** 这次用的路线（铸造城、试炼场两条路线），「双路线」徽章看它。 */
  route?: Route
  at?: number
}

/**
 * 完成一关。每关的完成经验值只计一次，重复通关不重复加分。
 * 观摩模式不发星，但不会堵死星：以后拿到真卡再做，照样可以 awardStar。
 * 换一种写法或路线再通一次关，经验值同样不重复给，但会记下这次用的写法和路线。
 */
export function completeStage(state: ProgressState, stageId: string, opts: CompleteOptions = {}): ProgressEvent[] {
  const { kind = 'stage', mode = 'normal', lang, route, at = Date.now() } = opts
  const events: ProgressEvent[] = []
  const s = stageOf(state, stageId)
  // 观摩模式只是看了一遍，不算用这种写法/路线通关，所以不记。
  if (mode === 'normal') {
    if (lang && !s.langs.includes(lang)) s.langs.push(lang)
    if (route && !s.routes.includes(route)) s.routes.push(route)
  }
  const first = !s.completed
  if (first) {
    s.completed = true
    s.at = at
    s.watched = mode === 'watch'
    const amount = mode === 'watch' ? XP_WATCH : kind === 'boss' ? XP_BOSS : XP_STAGE
    const source: XpSource = mode === 'watch' ? 'watch' : kind === 'boss' ? 'boss' : 'stage'
    gain(state, amount, source, events)
    events.push({ type: 'stage', stage: stageId, kind, mode })
  } else if (mode === 'normal' && s.watched) {
    // 先观摩、后来真的做了一遍：换掉观摩标记，但经验值不重复给。
    s.watched = false
    events.push({ type: 'stage', stage: stageId, kind, mode })
  }
  return touch(state, at, events)
}

/**
 * 发一颗星（index 0/1/2）。每颗星只计一次；看过答案的关卡最多 2 颗。
 * 返回空数组表示这颗星没发出去（已经有了、超出上限、或者被答案封顶）。
 */
export function awardStar(state: ProgressState, stageId: string, index: number, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  const events: ProgressEvent[] = []
  if (!Number.isInteger(index) || index < 0 || index >= MAX_STARS) return events
  const s = stageOf(state, stageId)
  if (s.stars.includes(index)) return events
  const cap = s.answerViewed ? MAX_STARS_AFTER_ANSWER : MAX_STARS
  if (s.stars.length >= cap) return events
  s.stars.push(index)
  s.stars.sort((a, b) => a - b)
  gain(state, XP_STAR, 'star', events, `第 ${index + 1} 颗星`)
  events.push({ type: 'star', stage: stageId, index, stars: s.stars.length })
  return touch(state, at, events)
}

/** 在挑战里看了答案：本关此后最高 2 星（已经拿到的 3 颗不回收）。 */
export function markAnswerViewed(state: ProgressState, stageId: string, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  const s = stageOf(state, stageId)
  if (!s.answerViewed) {
    s.answerViewed = true
    state.updatedAt = at
  }
  return []
}

/**
 * 看完了一次观摩回放（L-05：档案馆里一次真实运行的单元，逐个看到了最后一个）。只记下来，不发事件、不给经验值；
 * 之后做完检查点时，按它决定这一关怎么算完成（completeModeOf）。
 */
export function markReplayed(state: ProgressState, stageId: string, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  const s = stageOf(state, stageId)
  if (!s.replayed) {
    s.replayed = true
    state.updatedAt = at
  }
  return []
}

/** Agent 支线：50 XP，每关一次。 */
export function completeAgentSide(state: ProgressState, stageId: string, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  const events: ProgressEvent[] = []
  const s = stageOf(state, stageId)
  if (s.agentSide) return events
  s.agentSide = true
  gain(state, XP_AGENT_SIDE, 'agent', events)
  return touch(state, at, events)
}

/**
 * 打开了一关：记下时间，世界地图的「你在这」和首页的「继续上次的关卡」按它找最近打开的关卡。
 * 只是记录，不发事件、不给经验值。
 */
export function visitStage(state: ProgressState, stageId: string, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  if (!stageId) return []
  stageOf(state, stageId).visitedAt = at
  state.updatedAt = at
  return []
}

// ── 副本 ──────────────────────────────────────────────────────────────────

function exerciseOf(state: ProgressState, id: string): ExerciseRecord {
  state.exercises[id] ??= emptyExercise()
  return state.exercises[id]
}

/**
 * 通关一道副本：第一次通关发这道题的经验值（04 第 2 节：每题 50–150，由大纲里的 xp 给定，这里只做区间裁剪），
 * 之后再通关不重复发。星另外用 awardExerciseStar 记。
 */
export function completeExercise(state: ProgressState, exerciseId: string, xp: number, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  const events: ProgressEvent[] = []
  const e = exerciseOf(state, exerciseId)
  if (e.completed) return events
  const amount = Math.min(XP_EXERCISE_MAX, Math.max(XP_EXERCISE_MIN, Math.round(Number.isFinite(xp) ? xp : XP_EXERCISE_MIN)))
  e.completed = true
  e.xp = amount
  e.at = at
  gain(state, amount, 'exercise', events)
  return touch(state, at, events)
}

/**
 * 记一颗副本的星（index 0/1/2）：每颗只记一次，看过答案的副本最多 2 颗（同 awardStar）。
 * 副本的星不另给经验值，所以不发事件（也就不播 StarBurst），任务卡和状态栏直接读存档点亮。
 */
export function awardExerciseStar(state: ProgressState, exerciseId: string, index: number, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  if (!Number.isInteger(index) || index < 0 || index >= MAX_STARS) return []
  const e = exerciseOf(state, exerciseId)
  if (e.stars.includes(index)) return []
  const cap = e.answerViewed ? MAX_STARS_AFTER_ANSWER : MAX_STARS
  if (e.stars.length >= cap) return []
  e.stars.push(index)
  e.stars.sort((a, b) => a - b)
  state.updatedAt = at
  return []
}

/** 在副本的挑战里看了答案：这道题此后最高 2 星（已经拿到的不回收），题解也跟着展开。 */
export function markExerciseAnswerViewed(state: ProgressState, exerciseId: string, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  const e = exerciseOf(state, exerciseId)
  if (!e.answerViewed) {
    e.answerViewed = true
    state.updatedAt = at
  }
  return []
}

/** 打开了一道副本：只记时间，副本大厅据此标「进行中」。不发事件、不给经验值。 */
export function visitExercise(state: ProgressState, exerciseId: string, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  if (!exerciseId) return []
  exerciseOf(state, exerciseId).visitedAt = at
  state.updatedAt = at
  return []
}

// ── 徽章与图鉴 ────────────────────────────────────────────────────────────

/** 发徽章，每枚一次。徽章定义在 F-07 的 badges.json，这里只认 id。 */
export function awardBadge(state: ProgressState, id: string, opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  const events: ProgressEvent[] = []
  if (!id || state.badges[id]) return events
  state.badges[id] = at
  events.push({ type: 'badge', id })
  return touch(state, at, events)
}

/** 收入图鉴，每个术语一次，记下第一次学到它的关卡。术语表在 F-07 的 glossary.json。 */
export function collectTerm(state: ProgressState, key: string, opts: { stage?: string; at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  const stage = opts.stage ?? ''
  const events: ProgressEvent[] = []
  if (!key || state.codex[key]) return events
  state.codex[key] = { at, stage }
  events.push({ type: 'codex', key, stage })
  return touch(state, at, events)
}

/** 先猜：0 XP，猜错也不扣；只记第一次锁定的答案。 */
export function recordPrediction(
  state: ProgressState,
  id: string,
  choice: number,
  correct: boolean,
  opts: { stage?: string; at?: number } = {},
): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  if (!id || state.predictions[id]) return []
  state.predictions[id] = { choice, correct, at, stage: opts.stage ?? '' }
  state.updatedAt = at
  return []
}

// ── 偏好 ──────────────────────────────────────────────────────────────────

export function setPref<K extends keyof Prefs>(state: ProgressState, key: K, value: Prefs[K], opts: { at?: number } = {}): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  if (state.prefs[key] === value) return []
  state.prefs[key] = value
  return touch(state, at, [{ type: 'pref', key, value }])
}

// ── 我的 GPU 卡片 ──────────────────────────────────────────────────────────

/** saveDevice 做了什么：新加了一张、更新了已经有的那张、和存着的一样、比存着的旧（没有覆盖）。 */
export type DeviceSaved = 'added' | 'updated' | 'same' | 'older'

/**
 * 存一张卡并选为当前（读者刚导入它，要看的就是它）。同一张卡（id 相同）再导入时：导入码比存着的新，换成新的，
 * 新码没带峰值就留着原来的峰值（2-1 的码还没有峰值，2-4 测过以后的码才有）；不比存着的新，就不覆盖，
 * 只在存着的那份还没有峰值、这份有时补上峰值。
 */
export function saveDevice(state: ProgressState, record: DeviceRecord, opts: { at?: number } = {}): DeviceSaved {
  const at = opts.at ?? Date.now()
  const cards = state.devices.cards
  const index = cards.findIndex((c) => c.id === record.id)
  const old = index >= 0 ? cards[index] : null
  let result: DeviceSaved
  if (!old) {
    cards.push({ ...record, importedAt: at })
    result = 'added'
  } else if (record.at > old.at) {
    cards[index] = { ...record, peak: record.peak ?? old.peak, importedAt: at }
    result = 'updated'
  } else if (!old.peak && record.peak) {
    cards[index] = { ...old, peak: record.peak, importedAt: at }
    result = 'updated'
  } else {
    result = record.at === old.at ? 'same' : 'older'
  }
  state.devices.current = record.id
  state.updatedAt = at
  return result
}

/** 选一张卡当当前。存档里没有这张卡时不动，返回 false。 */
export function selectDevice(state: ProgressState, id: string, opts: { at?: number } = {}): boolean {
  if (!state.devices.cards.some((c) => c.id === id)) return false
  if (state.devices.current !== id) {
    state.devices.current = id
    state.updatedAt = opts.at ?? Date.now()
  }
  return true
}

/** 删掉一张卡；删的是当前那张时，回到不用自己的卡。 */
export function removeDevice(state: ProgressState, id: string, opts: { at?: number } = {}): boolean {
  const cards = state.devices.cards.filter((c) => c.id !== id)
  if (cards.length === state.devices.cards.length) return false
  state.devices.cards = cards
  if (state.devices.current === id) state.devices.current = ''
  state.updatedAt = opts.at ?? Date.now()
  return true
}

/** 当前选中的卡；没有导入过、或者当前那张删掉了时是 null。 */
export function currentDevice(state: ProgressState): DeviceRecord | null {
  const { cards, current } = state.devices
  return (current && cards.find((c) => c.id === current)) || null
}

// ── 定级 ──────────────────────────────────────────────────────────────────

/**
 * 定级测试：等级直接换算成经验值（Lv.10 = 2700 XP），来源标「定级」；
 * 被豁免的关卡标成「已豁免」，不自动给星。
 * 重新定级覆盖上次的结果（Q-02）：豁免换成这次的——豁免只有定级这一个来源，所以先把所有关卡的豁免清掉再标；
 * 经验值只补差额，不叠加，也不收回（03 第 4 节：不扣经验值）。
 */
export function applyPlacement(
  state: ProgressState,
  level: number,
  opts: { exempt?: string[]; at?: number } = {},
): ProgressEvent[] {
  const at = opts.at ?? Date.now()
  const exempt = opts.exempt ?? []
  const events: ProgressEvent[] = []
  const target = xpForLevel(level)
  const granted = state.placement?.xp ?? 0
  for (const record of Object.values(state.stages)) record.exempt = false
  for (const id of exempt) stageOf(state, id).exempt = true
  state.placement = { level, xp: Math.max(target, granted), at, exempt: [...exempt] }
  gain(state, target - granted, 'placement', events)
  state.updatedAt = at
  return events
}

// ── 清空 ──────────────────────────────────────────────────────────────────

/**
 * 清空进度（「我的成长」页的设置）：经验值、关卡、徽章、图鉴、预测、定级、导出记录全部清掉。
 * 留下三样不算进度的：偏好（写法、路线、简洁模式、减弱动效是设置）；「我的 GPU 卡片」（读者的硬件，
 * 不是学到哪了，再导入一次要回到有 GPU 的机器上）；迁移记录——旧存档的内容已经并进被清掉的进度里了，
 * 不留的话，下次读存档会把旧存档再迁一遍，清掉的进度又回来了。
 */
export function clearedState(prev: ProgressState, at = Date.now()): ProgressState {
  const state = emptyState(at)
  state.prefs = { ...prev.prefs }
  state.devices = normalizeDevices(prev.devices)
  state.migrated = { ...prev.migrated }
  return state
}

// ── 查询 ──────────────────────────────────────────────────────────────────

export function getStage(state: ProgressState, stageId: string): StageProgress {
  return state.stages[stageId] ?? emptyStage()
}

export function starsOf(state: ProgressState, stageId: string): number {
  return state.stages[stageId]?.stars.length ?? 0
}

/** 看过答案后本关还能拿几颗星，F-12 用它决定要不要提示「本关最高 2 星」。 */
export function starCapOf(state: ProgressState, stageId: string): number {
  return getStage(state, stageId).answerViewed ? MAX_STARS_AFTER_ANSWER : MAX_STARS
}

/**
 * 做完检查点时这一关按哪种方式完成（04 第 2 节）：看完过观摩回放、又没有用真卡拿到星，是观摩（100 XP，不得星）；
 * 其余照常完成。真卡关卡的星只能靠导入通关码拿（★1 成立才发），有星就是用真卡做过了。
 */
export function completeModeOf(state: ProgressState, stageId: string): StageMode {
  const s = getStage(state, stageId)
  return s.replayed && s.stars.length === 0 ? 'watch' : 'normal'
}

export function getExercise(state: ProgressState, exerciseId: string): ExerciseRecord {
  return state.exercises[exerciseId] ?? emptyExercise()
}

/** 看过答案后这道副本还能拿几颗星（同 starCapOf）。 */
export function exerciseStarCapOf(state: ProgressState, exerciseId: string): number {
  return getExercise(state, exerciseId).answerViewed ? MAX_STARS_AFTER_ANSWER : MAX_STARS
}

export interface StateSummary {
  level: number
  xp: number
  stages: number
  stars: number
  badges: number
  terms: number
  updatedAt: number
}

export function summarize(state: ProgressState): StateSummary {
  const stages = Object.values(state.stages)
  return {
    level: levelOf(state.xp),
    xp: state.xp,
    stages: stages.filter((s) => s.completed).length,
    stars: stages.reduce((n, s) => n + s.stars.length, 0),
    badges: Object.keys(state.badges).length,
    terms: Object.keys(state.codex).length,
    updatedAt: state.updatedAt,
  }
}

/** 04 第 7 节：距离上次导出超过 14 天就提醒再导出一次（从来没导出过也提醒）。 */
export function shouldRemindExport(state: ProgressState, now = Date.now()): boolean {
  if (summarize(state).xp === 0) return false
  const since = state.lastExportAt ?? state.createdAt
  return now - since > EXPORT_REMINDER_DAYS * 86400000
}

// ── 容错读取 ──────────────────────────────────────────────────────────────

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function plain(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function normalizeStars(v: unknown): number[] {
  return Array.isArray(v)
    ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < MAX_STARS))].sort((a, b) => a - b)
    : []
}

function normalizeStage(v: unknown): StageProgress {
  const raw = plain(v)
  return {
    stars: normalizeStars(raw.stars),
    completed: bool(raw.completed),
    watched: bool(raw.watched),
    replayed: bool(raw.replayed),
    answerViewed: bool(raw.answerViewed),
    exempt: bool(raw.exempt),
    agentSide: bool(raw.agentSide),
    langs: Array.isArray(raw.langs)
      ? [...new Set(raw.langs.filter((x): x is Lang => x === 'hip' || x === 'python'))]
      : [],
    routes: Array.isArray(raw.routes)
      ? [...new Set(raw.routes.filter((x): x is Route => x === 'hip' || x === 'triton'))]
      : [],
    at: num(raw.at),
    visitedAt: num(raw.visitedAt),
  }
}

/** F-04 最早的副本记录只有 { xp, at }，那时有记录就是通关了；没写 completed 时按发没发过经验值判断。 */
function normalizeExercise(v: unknown, at: number): ExerciseRecord {
  const raw = plain(v)
  const completed = bool(raw.completed, num(raw.xp) > 0)
  return {
    completed,
    xp: completed ? num(raw.xp, XP_EXERCISE_MIN) : 0,
    at: completed ? num(raw.at, at) : 0,
    stars: normalizeStars(raw.stars),
    answerViewed: bool(raw.answerViewed),
    visitedAt: num(raw.visitedAt),
  }
}

function normalizePrefs(v: unknown): Prefs {
  const raw = plain(v)
  const base = defaultPrefs()
  return {
    lang: raw.lang === 'python' || raw.lang === 'hip' ? raw.lang : base.lang,
    route: raw.route === 'triton' || raw.route === 'hip' ? raw.route : base.route,
    plain: bool(raw.plain, base.plain),
    reducedMotion: bool(raw.reducedMotion, base.reducedMotion),
  }
}

/** 导入码的生成时间：hello_gpu 写的 2026-11-08T10:00:00Z（UTC，精确到秒）。 */
const CARD_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

function positiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

/** 一张卡缺了画全景图要用的数（名称、gfx、CU 数、显存）就丢掉；可有可无的（wave、版本、峰值）坏了当没有。 */
function normalizeDevice(v: unknown): DeviceRecord | null {
  const raw = plain(v)
  const id = str(raw.id)
  const name = str(raw.name).trim()
  const gfx = str(raw.gfx)
  const cus = positiveInt(raw.cus)
  const memoryBytes = positiveInt(raw.memoryBytes)
  const at = str(raw.at)
  if (!id || !name || !/^gfx[0-9a-f]+$/.test(gfx) || cus === null || memoryBytes === null || !CARD_AT.test(at)) return null
  const env = plain(raw.env)
  const version = (x: unknown) => (typeof x === 'string' ? x : null)
  const peak = plain(raw.peak)
  const { gbps, tflops } = peak
  const measured = typeof gbps === 'number' && typeof tflops === 'number'
    && Number.isFinite(gbps) && Number.isFinite(tflops) && gbps > 0 && tflops > 0
  return {
    id, name, gfx, cus, wave: positiveInt(raw.wave), memoryBytes,
    env: { rocm: version(env.rocm), torch: version(env.torch), triton: version(env.triton) },
    peak: measured ? { gbps, tflops, at: CARD_AT.test(str(peak.at)) ? str(peak.at) : at } : null,
    at,
    importedAt: num(raw.importedAt),
  }
}

/** 「我的 GPU 卡片」：坏的卡丢掉，同一张卡只留第一条；当前那张不在了就回到不用自己的卡。 */
function normalizeDevices(v: unknown): DeviceShelf {
  const raw = plain(v)
  const cards: DeviceRecord[] = []
  for (const item of Array.isArray(raw.cards) ? raw.cards : []) {
    const card = normalizeDevice(item)
    if (card && !cards.some((c) => c.id === card.id)) cards.push(card)
  }
  const current = str(raw.current)
  return { cards, current: cards.some((c) => c.id === current) ? current : '' }
}

/** 把任意来源的数据捏成合法的 v2 状态：字段缺了补默认值，类型不对就丢掉这一项。 */
export function normalizeState(input: unknown, at = Date.now()): ProgressState {
  const raw = plain(input)
  const state = emptyState(at)
  state.createdAt = num(raw.createdAt, at)
  state.updatedAt = num(raw.updatedAt, state.createdAt)
  state.lastExportAt = typeof raw.lastExportAt === 'number' && Number.isFinite(raw.lastExportAt) ? raw.lastExportAt : null

  for (const [id, v] of Object.entries(plain(raw.stages))) state.stages[id] = normalizeStage(v)
  for (const [id, v] of Object.entries(plain(raw.exercises))) state.exercises[id] = normalizeExercise(v, at)
  for (const [id, v] of Object.entries(plain(raw.badges))) state.badges[id] = num(v, at)
  for (const [key, v] of Object.entries(plain(raw.codex))) {
    const c = plain(v)
    state.codex[key] = { at: num(c.at, at), stage: str(c.stage) }
  }
  for (const [id, v] of Object.entries(plain(raw.predictions))) {
    const p = plain(v)
    state.predictions[id] = { choice: num(p.choice, -1), correct: bool(p.correct), at: num(p.at, at), stage: str(p.stage) }
  }
  for (const [key, v] of Object.entries(plain(raw.migrated))) state.migrated[key] = num(v, at)
  state.prefs = normalizePrefs(raw.prefs)
  state.devices = normalizeDevices(raw.devices)

  const placement = plain(raw.placement)
  if (typeof placement.level === 'number') {
    state.placement = {
      level: num(placement.level, 1),
      xp: num(placement.xp, xpForLevel(num(placement.level, 1))),
      at: num(placement.at, at),
      exempt: Array.isArray(placement.exempt) ? placement.exempt.filter((x): x is string => typeof x === 'string') : [],
    }
  }

  const bySource = plain(raw.bySource)
  for (const key of Object.keys(state.bySource) as XpSource[]) state.bySource[key] = Math.max(0, num(bySource[key]))
  const total = Object.values(state.bySource).reduce((a, b) => a + b, 0)
  const xp = Math.max(0, num(raw.xp))
  // 经验值以分项之和为准；旧文件没有分项时，把总数记到「完成关卡」里，保证两边对得上。
  if (total === xp) state.xp = xp
  else if (total > 0) state.xp = total
  else {
    state.xp = xp
    state.bySource.stage = xp
  }
  return state
}

export function parseState(raw: string | null | undefined, at = Date.now()): ProgressState | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    if (num(data.v) !== PROGRESS_VERSION) return null
    return normalizeState(data, at)
  } catch {
    return null
  }
}

export function cloneState(state: ProgressState): ProgressState {
  return JSON.parse(JSON.stringify(state)) as ProgressState
}

// ── 导出 / 导入 ───────────────────────────────────────────────────────────

export const SAVE_APP = 'hello-gpu'

export interface SavePayload {
  app: typeof SAVE_APP
  v: typeof PROGRESS_VERSION
  exportedAt: number
  state: ProgressState
}

/** 导出一份快照，顺便记下 lastExportAt（04 第 7 节的 14 天提醒靠它）。 */
export function exportPayload(state: ProgressState, at = Date.now()): SavePayload {
  state.lastExportAt = at
  return { app: SAVE_APP, v: PROGRESS_VERSION, exportedAt: at, state: cloneState(state) }
}

export function exportJson(state: ProgressState, at = Date.now()): string {
  return JSON.stringify(exportPayload(state, at), null, 2)
}

/** 存档码：JSON 的 base64url，方便在聊天框里贴来贴去。 */
export function exportCode(state: ProgressState, at = Date.now()): string {
  return toBase64Url(JSON.stringify(exportPayload(state, at)))
}

export function exportFileName(at = Date.now()): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `hello-gpu-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`
}

export type ImportResult =
  | { ok: true; state: ProgressState; summary: StateSummary; exportedAt: number; warning: string }
  | { ok: false; error: string }

/** 读存档文件或存档码。校验版本，成功时带上摘要和「会覆盖」提示，交给调用方确认后再写入。 */
export function importSave(text: string, at = Date.now()): ImportResult {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { ok: false, error: '存档是空的' }
  let data: unknown = null
  try {
    data = JSON.parse(trimmed)
  } catch {
    try {
      data = JSON.parse(fromBase64Url(trimmed))
    } catch {
      return { ok: false, error: '读不出存档内容，请确认复制完整' }
    }
  }
  const payload = plain(data)
  if (payload.app !== SAVE_APP) return { ok: false, error: '这不是 Hello GPU 的存档' }
  const version = num(payload.v)
  if (version !== PROGRESS_VERSION) {
    return { ok: false, error: `存档版本 v${version || '?'} 和当前版本 v${PROGRESS_VERSION} 对不上，无法导入` }
  }
  const state = normalizeState(payload.state, at)
  return { ok: true, state, summary: summarize(state), exportedAt: num(payload.exportedAt, at), warning: OVERWRITE_WARNING }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): string {
  const base64 = code.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// ── 旧存档迁移 ────────────────────────────────────────────────────────────

/**
 * 试点存档（hg-pilot-v1）迁进 v2：完成与星按正式规则重新发一遍（经验值因此自动对齐），
 * 预测和图鉴原样带过来，试玩日志不要。只迁一次，迁过的记在 state.migrated 里。
 */
export function migratePilot(
  state: ProgressState,
  pilotRaw: string | null | undefined,
  langRaw: string | null | undefined = null,
  at = Date.now(),
): boolean {
  if (state.migrated[PILOT_KEY]) return false
  let data: Record<string, unknown> = {}
  try {
    if (!pilotRaw) return false
    const parsed = JSON.parse(pilotRaw) as Record<string, unknown>
    if (num(parsed.version) !== 1) return false
    data = parsed
  } catch {
    return false
  }

  const lang = langRaw === 'hip' || langRaw === 'python' ? langRaw : undefined

  for (const [key, value] of Object.entries(plain(data.stages))) {
    // 试点只有一关，它存的键就是正式关卡 id；万一键是空的，按试点关卡算。
    const id = key || PILOT_STAGE_ID
    const pilot = normalizeStage(value)
    if (pilot.completed) completeStage(state, id, { lang, at })
    for (const index of pilot.stars) awardStar(state, id, index, { at })
    if (pilot.answerViewed) markAnswerViewed(state, id, { at })
  }

  for (const [id, value] of Object.entries(plain(data.predictions))) {
    const p = plain(value)
    recordPrediction(state, id, num(p.choice, -1), bool(p.correct), { stage: PILOT_STAGE_ID, at: num(p.at, at) })
  }

  if (Array.isArray(data.codex)) {
    for (const term of data.codex) {
      // 试点存的是中文术语名，换成 glossary.json 的 key；没登记过的词丢掉，
      // 留着也查不到定义，图鉴里会变成一个点不开的条目。
      const key = typeof term === 'string' ? PILOT_TERM_KEYS[term] : undefined
      if (key) collectTerm(state, key, { stage: PILOT_STAGE_ID, at })
    }
  }

  if (lang) setPref(state, 'lang', lang, { at })

  state.migrated[PILOT_KEY] = at
  state.updatedAt = at
  return true
}
