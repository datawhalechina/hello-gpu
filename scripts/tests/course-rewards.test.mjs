import assert from 'node:assert/strict'
import test from 'node:test'
import {
  awardBadge, awardStar, collectTerm, completeStage, completeExercise, emptyState, XP_PER_LEVEL,
} from '../../docs/course/progress.ts'
import { durationOf, rewardsFrom, rewardText, timeline, TIMING } from '../../docs/course/rewards.ts'

const AT = 1_762_000_000_000

test('连拿三颗星并升级：一次 StarBurst 依次点亮三颗星，接着 LevelUp，时长符合 02 第 6 节', () => {
  const state = emptyState(AT)
  state.xp = XP_PER_LEVEL - 100 // 再拿 150 XP 就升到 Lv.2
  const events = [0, 1, 2].flatMap((i) => awardStar(state, 'novice-wavefront', i, { at: AT }))
  const rewards = rewardsFrom(events)
  assert.deepEqual(rewards, [
    { kind: 'stars', stage: 'novice-wavefront', indices: [0, 1, 2], total: 3, xp: 150 },
    { kind: 'level', level: 2, from: 1 },
  ])

  // 02 第 6 节：每颗星间隔 150 ms；一颗星的放大回落在反馈动效的 300–600 ms 之内；升级整段不超过 1.5 s
  assert.equal(TIMING.starGap, 150)
  assert.ok(TIMING.starPop >= 300 && TIMING.starPop <= 600)
  const slots = timeline(rewards)
  assert.equal(slots[0].start, 0)
  // 第三颗星在入场后 300 ms 开始点亮，再过 500 ms 点完，然后留 700 ms 给读者看
  assert.equal(slots[0].end, TIMING.enter + 2 * TIMING.starGap + TIMING.starPop + TIMING.starHold)
  assert.equal(slots[1].start, slots[0].end, '升级在星星播完以后才开始，不叠在一起')
  assert.ok(slots[1].end - slots[1].start <= 1500)
  assert.equal(slots[1].end, 3300)
})

test('同一批的奖励排队顺序：星 → 升级 → 徽章 → 图鉴 → 其余经验值；星带来的经验值不再单独弹', () => {
  const state = emptyState(AT)
  state.xp = XP_PER_LEVEL - 60
  const events = [
    ...collectTerm(state, 'kernel', { stage: 'novice-assign-threads', at: AT }),
    ...completeStage(state, 'novice-assign-threads', { at: AT }),
    ...awardBadge(state, 'first-clear', { at: AT }),
    ...collectTerm(state, 'thread', { stage: 'novice-assign-threads', at: AT }),
    ...awardStar(state, 'novice-assign-threads', 0, { at: AT }),
    ...completeExercise(state, 'ex-1', 80, { at: AT }),
  ]
  assert.deepEqual(rewardsFrom(events).map((r) => r.kind), ['stars', 'level', 'badge', 'codex', 'xp'])
  const [stars, level, , codex, xp] = rewardsFrom(events)
  assert.equal(stars.xp, 50)
  assert.deepEqual(level, { kind: 'level', level: 2, from: 1 })
  assert.deepEqual(codex.keys, ['kernel', 'thread'])
  assert.equal(xp.amount, 180)
  assert.deepEqual(xp.reasons.length, 2)
})

test('一批里连升好几级只播一次 LevelUp，播最后到达的等级', () => {
  const state = emptyState(AT)
  const events = completeStage(state, 'novice-boss', { kind: 'boss', at: AT }) // 500 XP：Lv.1 → Lv.2
  events.push(...completeExercise(state, 'ex-big', 150, { at: AT }), ...completeStage(state, 'forge-boss', { kind: 'boss', at: AT }))
  const levels = rewardsFrom(events).filter((r) => r.kind === 'level')
  assert.equal(levels.length, 1)
  assert.deepEqual(levels[0], { kind: 'level', level: 4, from: 1 })
})

test('简洁模式 / 减弱动效：每条奖励只显示一句文字，统一按 Toast 的 3 s 排队', () => {
  const rewards = [
    { kind: 'stars', stage: 's', indices: [0, 1, 2], total: 3, xp: 150 },
    { kind: 'level', level: 2, from: 1 },
  ]
  assert.deepEqual(rewards.map((r) => durationOf(r, true)), [3000, 3000])
  assert.deepEqual(timeline(rewards, true).map((s) => [s.start, s.end]), [[0, 3000], [3000, 6000]])
})

test('读屏文字：每种奖励都有一句完整的话', () => {
  assert.equal(rewardText({ kind: 'stars', stage: 's', indices: [1, 2], total: 3, xp: 100 }), '拿到第 2、3 颗星，本关 3 / 3 颗星，经验值 +100。')
  assert.equal(rewardText({ kind: 'level', level: 3, from: 2 }), '升级了：Lv.2 → Lv.3。')
  assert.equal(rewardText({ kind: 'badge', id: 'first-clear' }), '获得新徽章「首次通关」。')
  // 术语按 05 第 3 节的写法：中英文不同写「中文（English）」，不翻译的（kernel）只写一次，和概念卡一致
  assert.equal(rewardText({ kind: 'codex', keys: ['kernel', 'thread', 'no-such-key'] }), '收入图鉴：kernel、线程（thread）、no-such-key。')
  assert.equal(rewardText({ kind: 'xp', amount: 100, reasons: ['完成关卡'] }), '经验值 +100（完成关卡）。')
})
