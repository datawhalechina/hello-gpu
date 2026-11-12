/**
 * 「我的成长」页（P-04）用到的计算：图鉴里每个术语点回哪一关、各区域收了几个术语、存档状态里的时间。
 * 页面在 docs/.vitepress/theme/v2/MePage.vue；等级、各区域进度和世界地图共用 progress.ts、journey.ts 的规则。
 *
 * 纯 TS，node --test 可以直接 import；查询函数可以传入别的关卡列表（同 journey.ts），单测用它造「已上线」的关卡。
 * 规则来源：04 第 5 节（图鉴）、第 7 节（进度与存档）。
 */
import { ZONE_TERMS } from './badges.ts'
import { GLOSSARY, termName } from './glossary.ts'
import { isPublished, stageHref, STAGES, ZONES, type StageMeta, type ZoneMeta } from './outline.ts'
import type { ProgressState } from './progress.ts'

export interface CodexItem {
  key: string
  /** 「线程块（block）」：和概念卡、收入图鉴的提示同一个写法（05 第 3 节）。 */
  name: string
  short: string
  /** 第一次学到它的关卡；查不到是 null。 */
  stage: StageMeta | null
  /** 点回那一关的地址（不带站点 base）；那一关还没上线时是空串，进不去。 */
  href: string
}

/**
 * 图鉴：已经收集的术语，按术语表的顺序（也就是课程里学到的先后）。
 * 点回哪一关：存档里记的「第一次学到它的关卡」（04 第 5 节）；没记（不在关卡页上收的）或者大纲里没有那一关时，
 * 用术语表登记的第一关。术语表里已经没有的 key 不显示：没有定义，也不知道点回哪里。
 */
export function codexItems(state: ProgressState, stages: readonly StageMeta[] = STAGES): CodexItem[] {
  const byId = new Map(stages.map((s) => [s.id, s]))
  return Object.entries(GLOSSARY).flatMap(([key, entry]) => {
    const record = state.codex[key]
    if (!record) return []
    const stage = byId.get(record.stage) ?? byId.get(entry.links[0] ?? '') ?? null
    return [{ key, name: termName(key), short: entry.short, stage, href: stage && isPublished(stage) ? stageHref(stage) : '' }]
  })
}

export interface CodexZone {
  zone: ZoneMeta
  /** 这个区域的新术语收了几个。 */
  got: number
  total: number
}

/** 每个区域的新术语收了几个（「图鉴收集家」要收齐一个区域）；还没录术语的区域不列。 */
export function codexZones(state: ProgressState): CodexZone[] {
  return ZONES.flatMap((zone) => {
    const keys = ZONE_TERMS[zone.id] ?? []
    if (!keys.length) return []
    return [{ zone, got: keys.filter((key) => Boolean(state.codex[key])).length, total: keys.length }]
  })
}

const MINUTE = 60_000

/** 「刚刚」「5 分钟前」「3 小时前」「15 天前」：存档状态里的「最后更新」「上次导出」。时间在 now 之后（换过时钟）也算刚刚。 */
export function sinceText(at: number, now: number): string {
  const minutes = Math.floor((now - at) / MINUTE)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 「2026-11-08」：徽章的获得日期、导入前预览里的导出日期，按读者这台设备的时区。 */
export function dateText(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
