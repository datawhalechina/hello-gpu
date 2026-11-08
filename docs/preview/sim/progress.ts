/**
 * 试点关卡的进度与试玩日志。纯函数操作一个状态对象，存取 localStorage 的部分单独封装。
 *
 * 规则（见重构方案 4.3、9.2）：完成关卡 100 XP，每颗星 50 XP，每 300 XP 升一级、不设上限；
 * 「先猜」不给 XP；在挑战里看过答案的关卡最高 2 星。
 */

export const STORAGE_KEY = 'hg-pilot-v1'
export const XP_PER_LEVEL = 300
export const XP_STAGE = 100
export const XP_STAR = 50
const LOG_LIMIT = 3000

export interface StageProgress {
  stars: number[]
  completed: boolean
  answerViewed: boolean
}

export interface PredictionRecord {
  choice: number
  correct: boolean
  at: number
}

export interface LogEvent {
  t: number
  stage: string
  type: string
  data?: Record<string, unknown>
}

export interface PilotState {
  version: 1
  xp: number
  stages: Record<string, StageProgress>
  predictions: Record<string, PredictionRecord>
  codex: string[]
  log: LogEvent[]
}

export function emptyState(): PilotState {
  return { version: 1, xp: 0, stages: {}, predictions: {}, codex: [], log: [] }
}

export function levelOf(xp: number) {
  return { level: Math.floor(xp / XP_PER_LEVEL) + 1, into: xp % XP_PER_LEVEL, need: XP_PER_LEVEL }
}

function stage(state: PilotState, id: string): StageProgress {
  state.stages[id] ??= { stars: [], completed: false, answerViewed: false }
  return state.stages[id]
}

/** 发放一颗星，返回获得的 XP（已经拿过或被封顶时为 0）。 */
export function awardStar(state: PilotState, stageId: string, index: number): number {
  const s = stage(state, stageId)
  if (s.stars.includes(index)) return 0
  if (index === 2 && s.answerViewed) return 0
  s.stars.push(index)
  s.stars.sort()
  state.xp += XP_STAR
  return XP_STAR
}

export function completeStage(state: PilotState, stageId: string): number {
  const s = stage(state, stageId)
  if (s.completed) return 0
  s.completed = true
  state.xp += XP_STAGE
  return XP_STAGE
}

export function markAnswerViewed(state: PilotState, stageId: string) {
  stage(state, stageId).answerViewed = true
}

/** 只记录第一次锁定的答案：先猜的价值在于第一反应。 */
export function recordPrediction(state: PilotState, id: string, choice: number, correct: boolean, at: number) {
  if (state.predictions[id]) return false
  state.predictions[id] = { choice, correct, at }
  return true
}

export function learnTerm(state: PilotState, term: string) {
  if (state.codex.includes(term)) return false
  state.codex.push(term)
  return true
}

export function addLog(state: PilotState, event: LogEvent) {
  state.log.push(event)
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT)
}

/** 清掉某一关的进度和对应 XP，方便同一台设备给下一位试玩者使用。 */
export function resetStage(state: PilotState, stageId: string, predictionIds: string[]) {
  const s = state.stages[stageId]
  if (s) {
    state.xp = Math.max(0, state.xp - s.stars.length * XP_STAR - (s.completed ? XP_STAGE : 0))
    delete state.stages[stageId]
  }
  for (const id of predictionIds) delete state.predictions[id]
  state.log = state.log.filter(e => e.stage !== stageId)
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function loadState(storage: StorageLike | undefined): PilotState {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as Partial<PilotState>
    if (parsed.version !== 1) return emptyState()
    return { ...emptyState(), ...parsed } as PilotState
  } catch {
    return emptyState()
  }
}

export function saveState(storage: StorageLike | undefined, state: PilotState) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 隐私模式或存储被禁用时，进度只保留在本次页面里。
  }
}
