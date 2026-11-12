/**
 * 实验室能在哪里跑（L-06；07 第 10 节）：lab-platforms.json 的类型化读取。
 *
 * - 实验环境指南 /handbook/setup/ 用 facts：每个平台的 GPU 和 ROCm / PyTorch / Triton 版本，写法同 hardware.json，
 *   每项带出处，查不到的是 PENDING（「[待实测]」），页面上照样显示这几个字。
 * - LabCard 用云平台的 open：「在云平台上打开」里的链接和两三步说明。
 *
 * 指南里每个平台那一节的锚点就是平台 id（setupHref）。scripts/course/course-data-check.mjs 检查这份数据和指南里的锚点。
 */
import platformData from './lab-platforms.json' with { type: 'json' }
import { formatParam, PENDING, type HardwareParam, type HardwareSource } from './hardware.ts'
import { LAB_REPO } from './lab.ts'

/** 实验环境指南的地址（不带站点 base）。 */
export const SETUP_PAGE = '/handbook/setup/'

/** 每个平台都列这几项，顺序就是指南里的顺序。 */
export const PLATFORM_FACTS = ['gpu', 'gfx', 'rocm', 'torch', 'triton'] as const
export type PlatformFactKey = (typeof PLATFORM_FACTS)[number]

/** cloud 是浏览器里打开的云平台（LabCard 给链接），local 是读者自己的机器。 */
export const PLATFORM_KINDS = ['cloud', 'local'] as const
export type PlatformKind = (typeof PLATFORM_KINDS)[number]

/** link 和 steps 里能用的占位符。 */
export const LINK_PLACEHOLDER = '{repo}'
export const STEP_PLACEHOLDER = '{path}'

export interface PlatformOpen {
  /** 链接上的字。 */
  label: string
  /** {repo} 换成教程仓库去掉 https:// 的部分。 */
  link: string
  /** 点开链接以后的两三步；{path} 换成 Notebook 在仓库里的路径，反引号里的字是代码。 */
  steps: string[]
}

export interface LabPlatform {
  /** 指南里这一节的锚点。 */
  id: string
  name: string
  kind: PlatformKind
  facts: Record<PlatformFactKey, HardwareParam>
  /** 云平台才有。 */
  open?: PlatformOpen
}

export type CloudPlatform = LabPlatform & { kind: 'cloud'; open: PlatformOpen }

export const PLATFORM_SOURCES = platformData.sources as Record<string, HardwareSource>
export const LAB_PLATFORMS = platformData.platforms as LabPlatform[]
export const CLOUD_PLATFORMS = LAB_PLATFORMS.filter((p): p is CloudPlatform => p.kind === 'cloud' && Boolean(p.open))

export function platformById(id: string): LabPlatform | undefined {
  return LAB_PLATFORMS.find((p) => p.id === id)
}

/** 平台在指南里的那一节；不给平台时是指南开头。 */
export function setupHref(platform?: Pick<LabPlatform, 'id'>): string {
  return platform ? `${SETUP_PAGE}#${platform.id}` : SETUP_PAGE
}

export interface PlatformFact {
  key: PlatformFactKey
  label: string
  /** 「10.0.0」「AMD Radeon 8060S」「[待实测]」。 */
  text: string
  pending: boolean
  source: HardwareSource | null
  where: string | null
}

/** 平台的一项事实，连同出处。 */
export function platformFact(platform: LabPlatform, key: PlatformFactKey): PlatformFact {
  const param = platform.facts[key]
  const pending = !param || param.value === PENDING
  const source = !pending && param.source && Object.hasOwn(PLATFORM_SOURCES, param.source) ? PLATFORM_SOURCES[param.source] : null
  return {
    key,
    label: param?.label ?? key,
    text: formatParam(param),
    pending,
    source,
    where: source ? param.where ?? null : null,
  }
}

/** 云平台的「打开」链接：{repo} 换成教程仓库去掉 https:// 的部分（AUP Learning Cloud 的 /hub/git/<仓库> 就要这种写法）。 */
export function platformLink(open: Pick<PlatformOpen, 'link'>, repo: string = LAB_REPO): string {
  const bare = repo.replace(/^https:\/\//, '')
  return open.link.replaceAll(LINK_PLACEHOLDER, () => bare)
}

export interface StepPart {
  text: string
  code: boolean
}

/** 一步说明拆成文字和代码片段：{path} 换成 Notebook 在仓库里的路径，反引号之间的是代码。 */
export function stepParts(step: string, path: string): StepPart[] {
  return step
    .replaceAll(STEP_PLACEHOLDER, () => path)
    .split('`')
    .map((text, i) => ({ text, code: i % 2 === 1 }))
    .filter((part) => part.text !== '')
}
