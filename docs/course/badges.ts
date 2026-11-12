/**
 * 徽章定义与判定（04 第 4 节）。
 *
 * 定义在 badges.json，判定集中在这里；关卡只调用 `earnedBadges()` 拿到新达成的 id，
 * 再交给进度存档的 `awardBadge(id)` 发放。纯函数，node --test 可以直接 import。
 *
 * 有些条件存档里没有记（挑战过程中有没有越界写、这次拿到的是不是「比 torch 快」的星），
 * 由调用方在 BadgeContext 里带进来；跨会话才能攒齐的条件（双语法、双路线）记在存档里。
 */
import badgeData from './badges.json' with { type: 'json' }
import glossaryData from './glossary.json' with { type: 'json' }
import outlineData from './outline.json' with { type: 'json' }
import { isPublished } from './outline.ts'
import { getStage, starsOf, MAX_STARS, type ProgressState } from './progress.ts'

export interface BadgeDef {
  id: string
  name: string
  /** 一句话说清这枚徽章证明了什么能力。 */
  desc: string
  /** 描边 SVG 图标名（01 第 6 节：图标用内联 SVG，不用 emoji）。 */
  icon: string
  /** 获得条件，文案和 04 第 4 节的表一致；判定由 BADGE_RULES 实现。 */
  condition: string
}

export const BADGES = badgeData as BadgeDef[]
export const BADGE_BY_ID = new Map(BADGES.map((b) => [b.id, b]))

interface StageMeta {
  id: string
  zone: string
  code: string
  kind: string
  status: string
}

const stages = outlineData.stages as StageMeta[]
const zones = (outlineData.zones as { id: string }[]).map((z) => z.id)

/** 区域 id → 这个区域的全部关卡 id。 */
export const ZONE_STAGES: Record<string, string[]> = Object.fromEntries(
  zones.map((z) => [z, stages.filter((s) => s.zone === z).map((s) => s.id)]),
)

/** 区域 id → Boss 关 id，「区域毕业」按它判定。 */
export const ZONE_BOSS: Record<string, string> = Object.fromEntries(
  zones.flatMap((z) => {
    const boss = stages.find((s) => s.zone === z && s.kind === 'boss')
    return boss ? [[z, boss.id] as const] : []
  }),
)

/** 区域 id → 这个区域的全部新术语 key，「图鉴收集家」按它判定。 */
export const ZONE_TERMS: Record<string, string[]> = Object.fromEntries(
  zones.map((z) => [
    z,
    Object.entries(glossaryData as Record<string, { zone: string }>)
      .filter(([, t]) => t.zone === z)
      .map(([key]) => key),
  ]),
)

/**
 * 区域 id → 这个区域的关卡是不是都上线了（测试版或正式版）。术语跟着关卡一关关登记（铸造城、试炼场就是这样），
 * 关卡都上线以后，这个区域的术语表才是全的。
 */
export const ZONE_PUBLISHED: Record<string, boolean> = Object.fromEntries(
  zones.map((z) => [z, stages.filter((s) => s.zone === z).every(isPublished)]),
)

/**
 * 「图鉴收集家」：有一个区域的新术语一个不落地收齐了。这个区域要关卡全部上线（术语表录全了），而且录了术语：
 * 否则读完一个区域的头一关、或者一个还没录术语的区域，都会白送一枚。zoneTerms、zonePublished 默认用课程数据，单测可以传别的。
 */
export function codexCollected(
  codex: ProgressState['codex'],
  zoneTerms: Readonly<Record<string, readonly string[]>> = ZONE_TERMS,
  zonePublished: Readonly<Record<string, boolean>> = ZONE_PUBLISHED,
): boolean {
  return Object.entries(zoneTerms).some(([zone, terms]) =>
    zonePublished[zone] === true && terms.length > 0 && terms.every((key) => Boolean(codex[key])))
}

/** 「同步大师」要集齐 1-9、1-10 的全部星（04 第 4 节）。 */
export const SYNC_MASTER_STAGES = ['1-9', '1-10'].map((code) => stages.find((s) => s.code === code)?.id ?? code)

/** 存档里没有、只有调用方当场知道的事实。 */
export interface BadgeContext {
  /** 刚刚完成或刚刚拿到星的关卡 id。 */
  stage?: string
  /** 这一轮挑战从头到尾没有越界写。 */
  noOutOfBounds?: boolean
  /** 在「识破」环节选对了。 */
  spotted?: boolean
  /** 这次拿到的是「比 torch 快」的那颗星。 */
  beatTorch?: boolean
  /** 这次导入了真卡实验室的通关码。 */
  labCode?: boolean
}

export type BadgeRule = (state: ProgressState, ctx: BadgeContext) => boolean

export const BADGE_RULES: Record<string, BadgeRule> = {
  'first-clear': (state) => Object.values(state.stages).some((s) => s.completed),

  'no-out-of-bounds': (state, ctx) =>
    ctx.noOutOfBounds === true && Boolean(ctx.stage) && starsOf(state, ctx.stage as string) >= MAX_STARS,

  'spot-fake-speedup': (_state, ctx) => ctx.spotted === true,

  'sync-master': (state) => SYNC_MASTER_STAGES.every((id) => starsOf(state, id) >= MAX_STARS),

  'dual-syntax': (state) =>
    (ZONE_STAGES.novice ?? []).some((id) => {
      const s = getStage(state, id)
      return s.completed && s.langs.includes('hip') && s.langs.includes('python')
    }),

  'dual-route': (state) =>
    ['forge', 'trial'].some((zone) =>
      (ZONE_STAGES[zone] ?? []).some((id) => {
        const s = getStage(state, id)
        return s.completed && s.routes.includes('hip') && s.routes.includes('triton')
      }),
    ),

  'first-agent': (state) => getStage(state, 'novice-first-agent').completed,

  'beat-torch': (_state, ctx) => ctx.beatTorch === true,

  'real-machine': (_state, ctx) => ctx.labCode === true,

  'codex-collector': (state) => codexCollected(state.codex),
}

// 观摩完成的 Boss 不算通过（04 第 4 节：每枚徽章都对应一项可以验证的能力）；以后用真卡做完，观摩标记清掉，照样发。
for (const zone of zones) {
  BADGE_RULES[`zone-graduate-${zone}`] = (state) => {
    const boss = ZONE_BOSS[zone]
    if (!boss) return false
    const s = getStage(state, boss)
    return s.completed && !s.watched
  }
}

/**
 * 这一刻新达成、而且还没拿到的徽章 id，顺序和 badges.json 一致。
 * 调用方拿去逐个 awardBadge；已经拿到的不会再出现。
 */
export function earnedBadges(state: ProgressState, ctx: BadgeContext = {}): string[] {
  return BADGES.filter((b) => !state.badges[b.id] && BADGE_RULES[b.id]?.(state, ctx) === true).map((b) => b.id)
}
