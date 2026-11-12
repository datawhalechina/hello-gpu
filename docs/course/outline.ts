/**
 * outline.json 的类型化读取：课程结构的唯一数据源（04 第 1 节、06 第 2 节）。
 *
 * 纯 TS，node --test 可以直接 import；内容组件、关卡布局、关卡检查脚本共用这里的查询，
 * 不各自去翻 outline.json。
 */
import outlineData from './outline.json' with { type: 'json' }
import type { LabSpec } from './lab.ts'
import type { CompleteOptions, Prefs } from './progress.ts'

export type ZoneId = 'novice' | 'forge' | 'trial'
/** 新手村是两种写法（syntax）；铸造城、试炼场默认两条路线（split），纯硬件或工具类关卡共用一份（shared）。 */
export type RoutesMode = 'syntax' | 'split' | 'shared'

export interface ZoneMeta {
  id: ZoneId
  name: string
  code: string
  prefix: string
  /** 推荐等级区间。 */
  lv: [number, number]
  env: string
  routes: RoutesMode
  summary: string
  readers: string
}

/** 分路线的关卡在「两条路线怎么分」里的一行：两条路线共用什么、各自不同在哪。 */
export interface RouteNote {
  shared: string
  hip: string
  triton: string
}

export interface StageMeta {
  id: string
  zone: ZoneId
  /** 页面上显示的编号，例如 1-4，由数据生成。 */
  code: string
  slug: string
  kind: 'stage' | 'boss'
  arc: string
  title: string
  subtitle: string
  /** 推荐等级。 */
  lv: number
  minutes: number
  sim: string[]
  agentSide: boolean
  /** 需要真卡（铸造城、试炼场的实验室关卡）。 */
  gpu: boolean
  status: string
  question: string
  hardware: string
  interaction: string
  /** 关卡自己的写法 / 路线设置，不写时跟区域。 */
  routes?: RoutesMode
  routeNote?: RouteNote
  /** 真卡关卡的星级规则（07 第 9 节），网页的 LabCard 和 hello_gpu 都按它算星；各关的实验室任务写。 */
  lab?: LabSpec
}

/** 副本的难度：三档，只和同一个区域的副本比。 */
export type Difficulty = 1 | 2 | 3

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { 1: '入门', 2: '进阶', 3: '高阶' }

/** 副本在哪做：sim 是浏览器里的模拟器（新手村），gpu 是真卡上的实验室加通关码（铸造城、试炼场）。 */
export type ExerciseEnv = 'sim' | 'gpu'

/** 一道副本（04 第 1、2 节）：挂在区域旁边的可选练习，不占主线。 */
export interface ExerciseMeta {
  /** 存档和草稿槽用的稳定 id，写成 dungeon-<slug>，不会和关卡 id 撞上。 */
  id: string
  /** 页面地址 /dungeon/<slug>/ 的最后一段。 */
  slug: string
  title: string
  /** 这道题练的是什么，一句话。 */
  practice: string
  difficulty: Difficulty
  /** 通关（★1 结果正确）时发一次的经验值，50–150（04 第 2 节）。 */
  xp: number
  /** 关联关卡：这道题练的是哪几关的内容，按大纲顺序。 */
  stages: string[]
  env: ExerciseEnv
  /** 同关卡：planned 还没有页面，draft 测试版，ready 作者验收过。 */
  status: string
  /** 所在区域：outline.json 里写在分组上，读进来时补到每道题上。 */
  zone: ZoneId
  /** 真卡副本（env: gpu）的星级规则，格式同关卡的 lab。 */
  lab?: LabSpec
}

/** 一个区域的副本：这一组练的是什么，和组里的题（按推荐的做题顺序）。 */
export interface ExerciseGroup {
  zone: ZoneId
  practice: string
  items: ExerciseMeta[]
}

type RawExerciseGroup = Omit<ExerciseGroup, 'items'> & { items: Omit<ExerciseMeta, 'zone'>[] }

export const ZONES = outlineData.zones as ZoneMeta[]
export const STAGES = outlineData.stages as StageMeta[]
/** 副本按区域分组；每道题补上所在区域。 */
export const EXERCISES: ExerciseGroup[] = (outlineData.exercises as RawExerciseGroup[])
  .map((g) => ({ ...g, items: g.items.map((e) => ({ ...e, zone: g.zone })) }))
/** 全部副本排成一列：区域按大纲顺序，组里按推荐的做题顺序。副本页底部的上一道 / 下一道按它走。 */
export const EXERCISE_LIST: ExerciseMeta[] = EXERCISES.flatMap((g) => g.items)

const stageIndex = new Map(STAGES.map((s) => [s.id, s]))
const zoneIndex = new Map(ZONES.map((z) => [z.id, z]))
const exerciseIndex = new Map(EXERCISE_LIST.map((e) => [e.id, e]))

export function stageById(id: string): StageMeta | undefined {
  return stageIndex.get(id)
}

export function zoneById(id: string): ZoneMeta | undefined {
  return zoneIndex.get(id as ZoneId)
}

/** 关卡页面的地址（不带站点 base），例如 /novice/assign-threads/。 */
export function stageHref(stage: StageMeta): string {
  return `/${stage.zone}/${stage.slug}/`
}

/** 世界地图地址里点名一关的查询参数：/world/?stage=关卡 id，地图圈出这一关（定级结果页用它，Q-02）。 */
export const MAP_STAGE_PARAM = 'stage'

/** 世界地图的地址（不带站点 base）；给了关卡 id 时地图圈出这一关，例如 /world/?stage=novice-thousand-additions。 */
export function mapHref(stageId = ''): string {
  return stageId ? `/world/?${MAP_STAGE_PARAM}=${encodeURIComponent(stageId)}` : '/world/'
}

/** 关卡或副本的页面已经上线（测试版 draft 或正式版 ready）：只有这些能被链接到，planned / pilot 还没有正式页面。 */
export function isPublished(item: { status: string }): boolean {
  return item.status === 'draft' || item.status === 'ready'
}

/** 按大纲顺序的上一关和下一关（跨区域连着走，例如铸造城第一关的上一关是新手村的 Boss）。 */
export function neighborsOf(stageId: string): { prev: StageMeta | null; next: StageMeta | null } {
  const index = STAGES.findIndex((s) => s.id === stageId)
  if (index < 0) return { prev: null, next: null }
  return { prev: STAGES[index - 1] ?? null, next: STAGES[index + 1] ?? null }
}

/** 这一关用哪种写法 / 路线设置：关卡自己写了 routes 就用它，否则跟区域。 */
export function routesOf(stage: StageMeta): RoutesMode {
  return stage.routes ?? zoneById(stage.zone)?.routes ?? 'shared'
}

export interface ArcGroup {
  arc: string
  stages: StageMeta[]
}

/** 一个区域的关卡按 arc 分组（区域首页的关卡列表）：组按第一次出现的顺序，组里按大纲顺序。 */
export function arcsOf(zone: ZoneId, stages: readonly StageMeta[] = STAGES): ArcGroup[] {
  const own = stages.filter((s) => s.zone === zone)
  return [...new Set(own.map((s) => s.arc))].map((arc) => ({ arc, stages: own.filter((s) => s.arc === arc) }))
}

export interface RouteSplit {
  /** 两条路线共用一份的关卡。 */
  shared: StageMeta[]
  /** 分路线的关卡，按大纲顺序；note 是 outline.json 的 routeNote。 */
  split: { stage: StageMeta; note: RouteNote | null }[]
}

/**
 * 分路线的关卡一关一行。按 routesOf 分，所以关卡自己写的 routes 优先；没有分路线的关卡（新手村）时两项都是空的。
 */
export function routeSplitOf(zone: ZoneId, stages: readonly StageMeta[] = STAGES): RouteSplit {
  const own = stages.filter((s) => s.zone === zone)
  const split = own.filter((s) => routesOf(s) === 'split')
  if (!split.length) return { shared: [], split: [] }
  return {
    shared: own.filter((s) => routesOf(s) !== 'split'),
    split: split.map((stage) => ({ stage, note: stage.routeNote ?? null })),
  }
}

/** 区域的副本入口：副本大厅（/dungeon/，X-01）按区域分组，每组的锚点是区域 id。 */
export function dungeonHref(zone: ZoneId): string {
  return `/dungeon/#${zone}`
}

export function exerciseById(id: string): ExerciseMeta | undefined {
  return exerciseIndex.get(id)
}

/** 一个区域的副本，按推荐的做题顺序；没有副本的区域是空数组。 */
export function exercisesOf(zone: ZoneId): ExerciseMeta[] {
  return EXERCISES.find((g) => g.zone === zone)?.items ?? []
}

/** 副本页面的地址（不带站点 base），例如 /dungeon/vector-scale/。 */
export function exerciseHref(exercise: ExerciseMeta): string {
  return `/dungeon/${exercise.slug}/`
}

/** 副本页底部的上一道和下一道：按 EXERCISE_LIST 的顺序，跨区域连着走（同关卡的 neighborsOf）。 */
export function exerciseNeighbors(id: string): { prev: ExerciseMeta | null; next: ExerciseMeta | null } {
  const index = EXERCISE_LIST.findIndex((e) => e.id === id)
  if (index < 0) return { prev: null, next: null }
  return { prev: EXERCISE_LIST[index - 1] ?? null, next: EXERCISE_LIST[index + 1] ?? null }
}

/** 副本的运行环境，一句话：模拟器副本浏览器就能做，真卡副本写区域的环境（同关卡头的「硬件」）。 */
export function exerciseEnvText(exercise: ExerciseMeta): string {
  if (exercise.env === 'sim') return '浏览器即可（模拟器）'
  return `需要真卡：${zoneById(exercise.zone)?.env ?? ''}`
}

/**
 * 完成一关时交给 completeStage 的选项：Boss 关按 500 XP 发（04 第 2 节）；
 * 新手村记下这次用的写法，分路线的关卡记下路线（04 第 4 节「双语法」「双路线」徽章看它们）。
 * 不在大纲里的 id（预览页的演示关卡）按普通关卡处理，不记写法和路线。
 */
export function completeOptionsFor(stageId: string, prefs: Pick<Prefs, 'lang' | 'route'>): CompleteOptions {
  const stage = stageById(stageId)
  if (!stage) return { kind: 'stage' }
  const options: CompleteOptions = { kind: stage.kind === 'boss' ? 'boss' : 'stage' }
  const routes = routesOf(stage)
  if (routes === 'syntax') options.lang = prefs.lang
  else if (routes === 'split') options.route = prefs.route
  return options
}
