/**
 * 外部练习题索引（X-08）：external-problems.json 的类型化读取。
 *
 * 外部题只放链接：题名照原站写，题面不翻译、不改编、不复述。卡片（docs/components/kit/ExternalProblem.vue）只写 id，
 * 题名、来源、许可证、原题链接、关联关卡、我们的题解都从这里取；许可证跟着题库走，每道题的链接都在它的题库下面
 * （scripts/course/course-data-check.mjs 检查）。solution 为 true 的题有一篇原创题解，页面在 /dungeon/external/<id>/
 * （stage-check.mjs 检查页面在不在、上面有没有这道题的卡片）。外部题不发经验值，不进存档。
 *
 * 纯 TS，node --test 可以直接 import。
 */
import externalData from './external-problems.json' with { type: 'json' }
import { STAGES, ZONES, type ZoneId, type ZoneMeta } from './outline.ts'

/** 外部题索引页的地址（不带站点 base）。 */
export const EXTERNAL_PAGE = '/dungeon/external/'

/** 一个题库：卡片上写 name，许可证跟着题库走。 */
export interface ExternalSource {
  name: string
  /** 题库的地址；每道题的链接都在它下面。 */
  url: string
  license: string
  /** 许可证全文的地址。 */
  licenseUrl: string
  /** 最近一次核对题目链接和许可证的日期。 */
  checked: string
}

export interface ExternalProblem {
  /** 「题库键-名字」，也是索引页上的锚点。 */
  id: string
  /** 照原站写，不翻译。 */
  title: string
  /** sources 里的键。 */
  source: string
  /** 原题的地址。 */
  url: string
  /** 推荐区域。 */
  zone: ZoneId
  /** 关联关卡：同区域，按大纲顺序。 */
  stages: string[]
  /** 有一篇原创题解（/dungeon/external/<id>/）。 */
  solution?: true
}

export const EXTERNAL_SOURCES = externalData.sources as Record<string, ExternalSource>
export const EXTERNAL_PROBLEMS = externalData.problems as ExternalProblem[]

const problemIndex = new Map(EXTERNAL_PROBLEMS.map((p) => [p.id, p]))

export function externalProblemById(id: string): ExternalProblem | undefined {
  return problemIndex.get(id)
}

/** 原创题解页的地址（不带站点 base）；这道题没有题解时是空串。 */
export function externalSolutionHref(problem: Pick<ExternalProblem, 'id' | 'solution'>): string {
  return problem.solution ? `${EXTERNAL_PAGE}${problem.id}/` : ''
}

export interface ExternalGroup {
  zone: ZoneMeta
  problems: ExternalProblem[]
}

const stageOrder = new Map(STAGES.map((s, i) => [s.id, i]))

/**
 * 按推荐区域分组：区域按大纲顺序，没有题的区域不出现；组里按第一个关联关卡在大纲里的顺序排（学到哪一关就往下看到哪），
 * 同一关的题保持数据里的先后。
 */
export function externalGroups(problems: readonly ExternalProblem[] = EXTERNAL_PROBLEMS): ExternalGroup[] {
  const order = (p: ExternalProblem) => stageOrder.get(p.stages[0] ?? '') ?? Number.MAX_SAFE_INTEGER
  return ZONES.flatMap((zone) => {
    const inZone = problems
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.zone === zone.id)
      .sort((a, b) => order(a.p) - order(b.p) || a.i - b.i)
      .map(({ p }) => p)
    return inZone.length ? [{ zone, problems: inZone }] : []
  })
}
