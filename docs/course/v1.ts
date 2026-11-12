/**
 * 旧版教程和新版关卡的对应（M-01）：docs/course/v1-map.json 的类型化读取。
 *
 * 旧版的章节以旧版目录 docs/.vitepress/outline.mjs 为准：5 篇正文的 20 章和 4 个附录，地址都不变。
 * v1-map.json 写「旧章节路径 → 新版关卡 id 列表」，多对多：一章列出新版里讲同一件事的关卡，按大纲顺序；
 * 章按旧版目录的顺序写，每章至少对应一关（scripts/course/course-data-check.mjs 的 checkV1Map 检查）。
 *
 * 用在三处：
 * - /v1/ 旧版目录页（theme/v2/V1Catalog.vue）：每章后面列出对应的关卡，还在建设中的也列；
 * - 旧版页面顶部（theme/NewStagesNotice.vue）：这一页所在的章对应的关卡里，已经上线的；
 * - 世界地图（WorldMap.vue 的 legacy）：还在建设中的关卡链接旧版里对应它的第一章，写「先看旧版」。
 *
 * 纯 TS，node --test 可以直接 import。
 */
import v1Map from './v1-map.json' with { type: 'json' }
import { appendices, chapters, parts } from '../.vitepress/outline.mjs'
import { isPublished, stageById, type StageMeta } from './outline.ts'

/** outline.mjs 里用到的字段（它是旧版的 JS 文件，没有类型）。 */
interface OldPart {
  prefix: string
  title: string
  landing?: string
}

interface OldChapter {
  part: OldPart
  number: number
  title: string
  summary: string
  path: string
}

interface OldAppendix {
  title: string
  summary: string
  path: string
}

export interface V1Chapter {
  /** 页面地址（不带站点 base），例如 /part0-intro/chapter2/；也是 v1-map.json 的键。 */
  path: string
  /** 「第 2 章」「附录 A」。 */
  label: string
  title: string
  summary: string
}

export interface V1Group {
  /** /v1/ 页面里这一组的锚点：part0 … part4、appendix。 */
  id: string
  /** 「第 0 篇」「附录」。 */
  label: string
  title: string
  /** 篇首页的地址（只有第 2 篇有「本篇读法与实验说明」），没有是空串。 */
  landing: string
  chapters: V1Chapter[]
}

/** 附录的标题写成「附录 A · 环境安装细节与常见坑」，拆成编号和标题。 */
function appendixOf(a: OldAppendix): V1Chapter {
  const [label, ...rest] = a.title.split(' · ')
  return rest.length
    ? { path: a.path, label, title: rest.join(' · '), summary: a.summary }
    : { path: a.path, label: '附录', title: a.title, summary: a.summary }
}

const oldChapters = chapters as OldChapter[]

/** 旧版目录：按篇分组的正文各章，最后是附录（outline.mjs 的附录数组里有一个空位，跳过）。 */
export const V1_GROUPS: V1Group[] = [
  ...(parts as OldPart[]).map((part, i) => ({
    id: `part${i}`,
    label: `第 ${i} 篇`,
    title: part.title,
    landing: part.landing ?? '',
    chapters: oldChapters
      .filter((c) => c.part === part)
      .map((c) => ({ path: c.path, label: `第 ${c.number} 章`, title: c.title, summary: c.summary })),
  })),
  { id: 'appendix', label: '附录', title: '附录', landing: '', chapters: (appendices as (OldAppendix | undefined)[]).filter((a): a is OldAppendix => Boolean(a)).map(appendixOf) },
]

/** 旧版的全部章节，按旧版目录的顺序：先正文各章，再附录。 */
export const V1_CHAPTERS: V1Chapter[] = V1_GROUPS.flatMap((g) => g.chapters)

/** v1-map.json 原样：旧章节路径 → 新版关卡 id。 */
export const V1_MAP = v1Map as Record<string, string[]>

/** 一章对应的关卡，按 v1-map.json 写的顺序（大纲顺序）；大纲里找不到的 id 跳过（检查脚本会报出来）。 */
export function stagesOf(path: string, map: Record<string, string[]> = V1_MAP): StageMeta[] {
  const ids = Object.hasOwn(map, path) ? map[path] : []
  return ids.map((id) => stageById(id)).filter((s): s is StageMeta => Boolean(s))
}

/**
 * 一个旧版页面属于哪一章：relativePath 是 VitePress 的 page.relativePath（例如 part0-intro/chapter3/experiments.md），
 * 落在哪一章的目录下就是哪一章。章里的补充页面（第 3 章的实验、第 17 章的报告）跟着所在的章；
 * 篇首页（/part2-kernels/）、旧首页和新版页面不在任何一章里，是 null。
 */
export function chapterOfPage(relativePath: string, paths: readonly string[] = V1_CHAPTERS.map((c) => c.path)): string | null {
  const at = `/${relativePath.replace(/^\/+/, '')}`
  return paths.find((p) => at.startsWith(p)) ?? null
}

/** 旧版页面顶部要提示的关卡：这一页所在的章对应的关卡里，已经上线的（测试版 draft 或正式版 ready）。 */
export function noticeStagesOf(relativePath: string, map: Record<string, string[]> = V1_MAP): StageMeta[] {
  const chapter = chapterOfPage(relativePath, Object.keys(map))
  return chapter ? stagesOf(chapter, map).filter(isPublished) : []
}

/**
 * 世界地图的「先看旧版」：关卡 id → 旧版里对应这一关的第一章（order 是旧版目录的顺序）。
 * 一关对应好几章时取最靠前的一章，所以一章只写它真正讲到的关卡，免得把后面更合适的那一章挤掉；
 * 没有对应章节的关卡（新版新写的内容）不在结果里。地图只给还在建设中的关卡用它。
 */
export function legacyByStage(
  map: Record<string, string[]> = V1_MAP,
  order: readonly string[] = V1_CHAPTERS.map((c) => c.path),
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const path of order) {
    for (const id of Object.hasOwn(map, path) ? map[path] : []) {
      if (!Object.hasOwn(out, id)) out[id] = path
    }
  }
  return out
}

export const LEGACY_BY_STAGE: Readonly<Record<string, string>> = legacyByStage()
