import assert from 'node:assert/strict'
import test from 'node:test'
import { ZONE_TERMS } from '../../docs/course/badges.ts'
import { codexItems, codexZones, dateText, sinceText } from '../../docs/course/growth.ts'
import { STAGES, ZONES } from '../../docs/course/outline.ts'
import { collectTerm, emptyState } from '../../docs/course/progress.ts'

const AT = 1_762_000_000_000
const MINUTE = 60_000
const DAY = 86_400_000

/** 只把这两关当成已经上线、其余都没上线，看图鉴能不能点回去（不随大纲里真实的上线进度变）。 */
const PUBLISHED = new Set(['novice-thread-groups', 'novice-wavefront'])
const stages = STAGES.map((s) => ({ ...s, status: PUBLISHED.has(s.id) ? 'draft' : 'planned' }))

test('图鉴：按课程顺序列出收集过的术语，点回第一次学到它的关卡，那一关没上线就不给链接', () => {
  const s = emptyState(AT)
  collectTerm(s, 'wavefront', { stage: 'novice-wavefront', at: AT })
  // 在 1-5 才第一次读到「线程块」的卡片：点回 1-5，不是术语表登记的 1-4
  collectTerm(s, 'block', { stage: 'novice-wavefront', at: AT + 1 })
  // 不在关卡页上收的（没记关卡）、记的关卡大纲里没有：都按术语表登记的第一关
  collectTerm(s, 'parallel', { stage: '', at: AT + 2 })
  collectTerm(s, 'grid', { stage: 'preview-demo', at: AT + 3 })
  // 术语表里没有的 key：没有定义，也不知道点回哪里，不显示
  collectTerm(s, 'no-such-term', { stage: 'novice-wavefront', at: AT + 4 })

  const items = codexItems(s, stages)
  assert.deepEqual(items.map((t) => t.key), ['parallel', 'block', 'grid', 'wavefront'])
  const by = Object.fromEntries(items.map((t) => [t.key, t]))
  assert.equal(by.block.name, '线程块（block）')
  assert.deepEqual([by.block.stage.code, by.block.href], ['1-5', '/novice/wavefront/'])
  assert.deepEqual([by.grid.stage.code, by.grid.href], ['1-4', '/novice/thread-groups/'])
  // 1-1 没上线：知道是哪一关，但进不去
  assert.deepEqual([by.parallel.stage.code, by.parallel.href], ['1-1', ''])
})

test('各区域的图鉴进度：只数这个区域的新术语，还没录术语的区域不列', () => {
  const s = emptyState(AT)
  collectTerm(s, 'block', { stage: 'novice-thread-groups', at: AT })
  collectTerm(s, 'grid', { stage: 'novice-thread-groups', at: AT })
  collectTerm(s, 'no-such-term', { stage: 'novice-thread-groups', at: AT })

  const zones = codexZones(s)
  assert.deepEqual(zones.map((z) => z.zone.id), ZONES.filter((z) => ZONE_TERMS[z.id].length > 0).map((z) => z.id))
  const novice = zones.find((z) => z.zone.id === 'novice')
  assert.deepEqual([novice.got, novice.total], [2, ZONE_TERMS.novice.length])
  for (const z of zones) if (z.zone.id !== 'novice') assert.equal(z.got, 0)
})

test('存档状态里的时间：刚刚、分钟、小时、天的分界', () => {
  assert.equal(sinceText(AT - 59_000, AT), '刚刚')
  assert.equal(sinceText(AT - MINUTE, AT), '1 分钟前')
  assert.equal(sinceText(AT - 59 * MINUTE, AT), '59 分钟前')
  assert.equal(sinceText(AT - 60 * MINUTE, AT), '1 小时前')
  assert.equal(sinceText(AT - DAY + MINUTE, AT), '23 小时前')
  assert.equal(sinceText(AT - DAY, AT), '1 天前')
  assert.equal(sinceText(AT - 15 * DAY, AT), '15 天前')
  // 存档时间比现在还晚（读者把时钟往回调了）：不写「-3 分钟前」
  assert.equal(sinceText(AT + 3 * MINUTE, AT), '刚刚')

  // 按读者这台设备的时区写日期，月和日补零
  assert.equal(dateText(new Date(2026, 0, 5, 23, 30).getTime()), '2026-01-05')
  assert.equal(dateText(new Date(2026, 10, 30, 0, 5).getTime()), '2026-11-30')
})
