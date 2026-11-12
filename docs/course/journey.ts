/**
 * 读者在课程里走到哪了：每关的状态、「你在这」、各区域的进度。
 * 世界地图（P-01）用它；区域首页、新版首页的「继续上次的关卡」也读同一套规则，不各自去翻存档。
 *
 * 纯 TS，node --test 可以直接 import。数据只来自 outline.json（关卡顺序、有没有上线）和进度存档；
 * 查询函数可以传入别的关卡列表，单测用它造「已上线」的关卡（大纲里现在还都是 planned）。
 */
import { EXERCISE_LIST, isPublished, STAGES, ZONES, type ExerciseMeta, type StageMeta, type ZoneMeta } from './outline.ts'
import { getExercise, getStage, type ProgressState, type StageProgress } from './progress.ts'

/** 地图上一关的状态：未开始、进行中、完成、已豁免、建设中。 */
export type StageStatus = 'todo' | 'doing' | 'done' | 'exempt' | 'soon'

export const STATUS_TEXT: Record<StageStatus, string> = {
  todo: '未开始',
  doing: '进行中',
  done: '完成',
  exempt: '已豁免',
  soon: '建设中',
}

/**
 * 状态角标的描边图标（01 第 6 节：内联描边 SVG，16 × 16；第 7 节：不靠颜色单独表达）：完成 = 对勾、
 * 进行中 = 半圆、已豁免 = 双箭头；未开始和建设中没有角标，靠描边样式和文字区分。fill 的那条路径画成实心。
 * 世界地图和区域首页共用。
 */
export const STATUS_ICONS: Partial<Record<StageStatus, readonly { d: string; fill?: boolean }[]>> = {
  done: [{ d: 'm4.5 8.5 2.5 2.5 4.5-5.5' }],
  doing: [{ d: 'M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3Z' }, { d: 'M8 3a5 5 0 0 1 0 10Z', fill: true }],
  exempt: [{ d: 'm4 4.5 3.5 3.5L4 11.5M8.5 4.5 12 8l-3.5 3.5' }],
}

/** 开始做了：打开过这一关，或者已经拿到星、看过答案、做完了 Agent 支线（没记打开时间的旧存档也算）。 */
export function hasStarted(p: StageProgress): boolean {
  return p.visitedAt > 0 || p.stars.length > 0 || p.answerViewed || p.agentSide
}

/**
 * 一关的状态，按这个顺序判断：
 * 1. 完成：还没上线的关卡也可能有完成记录（试点关卡迁过来的进度），做过就是做过；
 * 2. 已豁免：定级测试豁免的，不管上没上线；
 * 3. 建设中：还没上线（planned、pilot）的关卡没有正式页面，进不去；
 * 4. 上线了的，开始做了是「进行中」，否则「未开始」。
 */
export function stageStatus(stage: StageMeta, state: ProgressState): StageStatus {
  const p = getStage(state, stage.id)
  if (p.completed) return 'done'
  if (p.exempt) return 'exempt'
  if (!isPublished(stage)) return 'soon'
  return hasStarted(p) ? 'doing' : 'todo'
}

/**
 * 星级那一栏画不画（世界地图、区域首页共用）：拿过星的都画；没拿过的，上线了的关卡画三颗空星，
 * 豁免的不画（04 第 2 节：豁免不给星，地图上显示「已豁免」、没有星；回去拿到星以后照常画）。
 */
export function showsStars(stage: StageMeta, state: ProgressState): boolean {
  if (getStage(state, stage.id).stars.length > 0) return true
  return isPublished(stage) && stageStatus(stage, state) !== 'exempt'
}

/** 下一个推荐关卡：按大纲顺序，第一个既没完成、也没被定级豁免的关卡（还在建设中的也算）。全部走完是 null。 */
export function nextStage(state: ProgressState, stages: readonly StageMeta[] = STAGES): StageMeta | null {
  return stages.find((s) => {
    const p = getStage(state, s.id)
    return !p.completed && !p.exempt
  }) ?? null
}

export interface Whereabouts {
  stage: StageMeta
  /** last：最近打开过、还没完成的关卡；next：没有这样的关卡时，下一个推荐关卡。 */
  reason: 'last' | 'next'
}

/**
 * 「你在这」：已上线、还没完成的关卡里最近打开的那一关；一关都没有就是下一个推荐关卡；全部走完是 null。
 * 回头翻看已经完成的关卡不会把「你在这」拽回去；还没上线的关卡进不去，也不算「上次停在那里」。
 */
export function whereAmI(state: ProgressState, stages: readonly StageMeta[] = STAGES): Whereabouts | null {
  let last: StageMeta | null = null
  let lastAt = 0
  for (const s of stages) {
    const p = getStage(state, s.id)
    if (!isPublished(s) || p.completed || p.visitedAt <= lastAt) continue
    last = s
    lastAt = p.visitedAt
  }
  if (last) return { stage: last, reason: 'last' }
  const next = nextStage(state, stages)
  return next ? { stage: next, reason: 'next' } : null
}

/** 第一次来：没有经验值、没做过定级，也没打开过、豁免过任何一关。 */
export function isNewcomer(state: ProgressState): boolean {
  if (state.xp > 0 || state.placement) return false
  return Object.values(state.stages).every((p) => !hasStarted(p) && !p.completed && !p.exempt)
}

export interface ZoneProgress {
  zone: ZoneMeta
  /** 这个区域的全部关卡，按大纲顺序（最后一关是 Boss）。 */
  stages: StageMeta[]
  /** 已经完成的关卡数（豁免的不算通关）。 */
  done: number
  exempt: number
  stars: number
}

export function zoneProgress(
  state: ProgressState,
  zones: readonly ZoneMeta[] = ZONES,
  stages: readonly StageMeta[] = STAGES,
): ZoneProgress[] {
  return zones.map((zone) => {
    const own = stages.filter((s) => s.zone === zone.id)
    const records = own.map((s) => getStage(state, s.id))
    return {
      zone,
      stages: own,
      done: records.filter((p) => p.completed).length,
      exempt: records.filter((p) => p.exempt && !p.completed).length,
      stars: records.reduce((n, p) => n + p.stars.length, 0),
    }
  })
}

/**
 * 一道副本在副本大厅里的状态（X-01），说法和关卡一样：通关了是「完成」（还没上线的也算，做过就是做过）；
 * 还没上线是「建设中」；打开过、拿过星或看过答案是「进行中」；否则「未开始」。副本不参加定级，没有「已豁免」。
 */
export function exerciseStatus(exercise: ExerciseMeta, state: ProgressState): StageStatus {
  const p = getExercise(state, exercise.id)
  if (p.completed) return 'done'
  if (!isPublished(exercise)) return 'soon'
  return p.visitedAt > 0 || p.stars.length > 0 || p.answerViewed ? 'doing' : 'todo'
}

export interface ExerciseProgress {
  /** 通关了几道。 */
  done: number
  total: number
  /** 这些副本一共发了多少经验值。 */
  xp: number
}

/** 一组副本的完成情况：副本大厅每个区域一组，页首是全部。 */
export function exerciseProgress(state: ProgressState, exercises: readonly ExerciseMeta[] = EXERCISE_LIST): ExerciseProgress {
  const done = exercises.map((e) => getExercise(state, e.id)).filter((p) => p.completed)
  return { done: done.length, total: exercises.length, xp: done.reduce((n, p) => n + p.xp, 0) }
}
