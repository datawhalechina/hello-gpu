/**
 * 奖励队列（F-13；02 第 6 节「奖励动效」，04 第 8 节「庆祝动效可以关闭」）。
 *
 * 进度存档每次变化都会广播事件（useProgress 的 onProgressEvent）。同一个操作在同一拍里发出的事件
 * 先攒成一批，在这里整理成一条条奖励，交给 RewardLayer 依次播放，不叠在一起：
 *   星（StarBurst，星带来的经验值算在里面）→ 升级（LevelUp）→ 新徽章 → 收入图鉴 → 其余经验值（Toast）。
 * 每条奖励播多久、播放时间线怎么排也在这里算，纯函数，单测直接调用。
 */
import { BADGE_BY_ID } from './badges.ts'
import { termName } from './glossary.ts'
import { XP_STAR, type ProgressEvent } from './progress.ts'

export type Reward =
  /** 拿星：同一关这一批拿到的星，一起点亮。 */
  | { kind: 'stars'; stage: string; indices: number[]; total: number; xp: number }
  /** 升级：一批里连升几级也只播一次，播最后到达的等级。 */
  | { kind: 'level'; level: number; from: number }
  | { kind: 'badge'; id: string }
  /** 收入图鉴：一批里收进的几个术语合成一条。 */
  | { kind: 'codex'; keys: string[] }
  /** 不是星带来的经验值（完成关卡、Boss、副本、支线），一批合成一条。 */
  | { kind: 'xp'; amount: number; reasons: string[] }

/** 02 第 6 节和第 1 节的时间参数（毫秒）。 */
export const TIMING = {
  /** 卡片滑入（--motion-base）。 */
  enter: 300,
  /** 拿星：每颗星间隔 150 ms。 */
  starGap: 150,
  /** 一颗星放大到 1.15 再回落（--motion-slow；反馈类动效 300–600 ms）。 */
  starPop: 500,
  /** 星都点亮以后留给读者看一眼。 */
  starHold: 700,
  /** 升级整段不超过 1.5 s，点一下就跳过。 */
  levelUp: 1500,
  /** 徽章、图鉴、经验值的 Toast：3 s 后自动消失。 */
  toast: 3000,
} as const

export function rewardsFrom(events: readonly ProgressEvent[]): Reward[] {
  const stars = new Map<string, Reward & { kind: 'stars' }>()
  let level: (Reward & { kind: 'level' }) | null = null
  const badges: Reward[] = []
  const codex: string[] = []
  let xp = 0
  const reasons: string[] = []

  for (const e of events) {
    if (e.type === 'star') {
      const group = stars.get(e.stage) ?? { kind: 'stars', stage: e.stage, indices: [], total: 0, xp: 0 }
      group.indices.push(e.index)
      group.total = Math.max(group.total, e.stars)
      group.xp += XP_STAR
      stars.set(e.stage, group)
    } else if (e.type === 'level') {
      level = { kind: 'level', level: Math.max(level?.level ?? 0, e.level), from: Math.min(level?.from ?? e.from, e.from) }
    } else if (e.type === 'badge') {
      badges.push({ kind: 'badge', id: e.id })
    } else if (e.type === 'codex') {
      if (!codex.includes(e.key)) codex.push(e.key)
    } else if (e.type === 'xp' && e.source !== 'star') {
      xp += e.amount
      if (!reasons.includes(e.reason)) reasons.push(e.reason)
    }
  }

  return [
    ...[...stars.values()].map((s) => ({ ...s, indices: [...s.indices].sort((a, b) => a - b) })),
    ...(level ? [level] : []),
    ...badges,
    ...(codex.length ? [{ kind: 'codex' as const, keys: codex }] : []),
    ...(xp > 0 ? [{ kind: 'xp' as const, amount: xp, reasons }] : []),
  ]
}

/**
 * 一条奖励占多久（下一条在它结束后才开始）。textOnly：简洁模式或减弱动效，只显示文字，一律按 Toast 算。
 */
export function durationOf(reward: Reward, textOnly = false): number {
  if (textOnly) return TIMING.toast
  if (reward.kind === 'stars') return TIMING.enter + (reward.indices.length - 1) * TIMING.starGap + TIMING.starPop + TIMING.starHold
  if (reward.kind === 'level') return TIMING.levelUp
  return TIMING.toast
}

export interface Slot {
  reward: Reward
  start: number
  end: number
}

/** 排成一条时间线：一条接一条，不重叠。 */
export function timeline(rewards: readonly Reward[], textOnly = false, start = 0): Slot[] {
  let t = start
  return rewards.map((reward) => {
    const slot = { reward, start: t, end: t + durationOf(reward, textOnly) }
    t = slot.end
    return slot
  })
}

/** 给读屏播报、也是简洁模式下显示的那一句话。 */
export function rewardText(reward: Reward): string {
  switch (reward.kind) {
    case 'stars':
      return `拿到第 ${reward.indices.map((i) => i + 1).join('、')} 颗星，本关 ${reward.total} / 3 颗星，经验值 +${reward.xp}。`
    case 'level':
      return `升级了：Lv.${reward.from} → Lv.${reward.level}。`
    case 'badge':
      return `获得新徽章「${BADGE_BY_ID.get(reward.id)?.name ?? reward.id}」。`
    case 'codex':
      return `收入图鉴：${reward.keys.map(termName).join('、')}。`
    case 'xp':
      return `经验值 +${reward.amount}（${reward.reasons.join('、')}）。`
  }
}
