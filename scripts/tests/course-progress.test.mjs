import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPlacement, awardBadge, awardExerciseStar, awardStar, collectTerm, completeAgentSide, completeExercise, completeModeOf,
  completeStage, emptyState, exerciseStarCapOf, exportCode, exportJson, getExercise, getStage, importSave, levelOf,
  markAnswerViewed, markExerciseAnswerViewed, markReplayed, migratePilot, normalizeState, PILOT_KEY, PILOT_LANG_KEY,
  PILOT_STAGE_ID, recordPrediction, setPref, shouldRemindExport, starCapOf, summarize, visitExercise, XP_SOURCE_LABEL,
  xpForLevel, xpIntoLevel, xpToNext,
} from '../../docs/course/progress.ts'
import {
  DEMO_STORAGE_KEY, loadState, memoryStorage, onStorageSync, openBackend, saveState, STORAGE_KEY, UNAVAILABLE_NOTICE,
} from '../../docs/course/storage.ts'

const AT = 1_762_000_000_000
const DAY = 86_400_000

/** 固定时间的状态，便于比较导出前后是否完全一致。 */
function fresh() {
  return emptyState(AT)
}

test('等级换算：每 300 XP 一级，不设上限', () => {
  assert.equal(levelOf(0), 1)
  assert.equal(levelOf(299), 1)
  assert.equal(levelOf(300), 2)
  assert.equal(levelOf(2700), 10)
  assert.equal(levelOf(2699), 9)
  assert.equal(levelOf(30000), 101)

  assert.deepEqual([xpIntoLevel(0), xpToNext(0)], [0, 300])
  assert.deepEqual([xpIntoLevel(299), xpToNext(299)], [299, 1])
  assert.deepEqual([xpIntoLevel(300), xpToNext(300)], [0, 300])
  assert.deepEqual([xpIntoLevel(2700), xpToNext(2700)], [0, 300])

  // Lv.N 需要累计 300 × (N − 1)
  assert.equal(xpForLevel(1), 0)
  assert.equal(xpForLevel(10), 2700)
  for (const lv of [1, 2, 7, 10, 42]) assert.equal(levelOf(xpForLevel(lv)), lv)
})

test('04 第 2 节经验值表：每一项都有接口，金额对得上', () => {
  const s = fresh()
  assert.equal(completeStage(s, 'novice-thread-groups', { at: AT }).length > 0, true)
  assert.equal(s.xp, 100) // 完成关卡 100

  awardStar(s, 'novice-thread-groups', 0, { at: AT })
  awardStar(s, 'novice-thread-groups', 1, { at: AT })
  awardStar(s, 'novice-thread-groups', 2, { at: AT })
  assert.equal(s.xp, 100 + 150) // 每颗星 50，最多 3 颗
  assert.equal(getStage(s, 'novice-thread-groups').stars.length, 3)

  completeStage(s, 'novice-boss', { kind: 'boss', at: AT })
  assert.equal(s.bySource.boss, 500) // Boss 500

  completeExercise(s, 'novice-ex-transpose', 150, { at: AT })
  assert.equal(s.bySource.exercise, 150) // 副本每题 50–150
  completeExercise(s, 'novice-ex-scale', 9999, { at: AT })
  completeExercise(s, 'novice-ex-hist', 1, { at: AT })
  assert.deepEqual([s.exercises['novice-ex-scale'].xp, s.exercises['novice-ex-hist'].xp], [150, 50])

  completeAgentSide(s, 'novice-meet-agent', { at: AT })
  assert.equal(s.bySource.agent, 50) // Agent 支线 50

  const before = s.xp
  recordPrediction(s, 'p-groups', 1, false, { stage: 'novice-thread-groups', at: AT })
  assert.equal(s.xp, before) // 先猜 0，猜错也不扣
  assert.deepEqual(s.predictions['p-groups'], { choice: 1, correct: false, at: AT, stage: 'novice-thread-groups' })

  assert.equal(s.xp, Object.values(s.bySource).reduce((a, b) => a + b, 0))
})

test('观摩模式完成真卡关卡：100 XP 且不给星，回头用真卡做还能拿星', () => {
  const s = fresh()
  const events = completeStage(s, 'forge-first-kernel', { mode: 'watch', at: AT })
  assert.equal(s.xp, 100)
  assert.equal(s.bySource.watch, 100)
  assert.equal(getStage(s, 'forge-first-kernel').watched, true)
  assert.equal(getStage(s, 'forge-first-kernel').stars.length, 0)
  assert.equal(events.some((e) => e.type === 'star'), false)

  awardStar(s, 'forge-first-kernel', 0, { at: AT })
  assert.equal(s.xp, 150)
  completeStage(s, 'forge-first-kernel', { at: AT })
  assert.equal(s.xp, 150) // 补做不重复给完成经验值
  assert.equal(getStage(s, 'forge-first-kernel').watched, false)
})

test('观摩回放（L-05）：看完了、又没用真卡拿到星，做完检查点按观摩完成；拿到过星就照常完成', () => {
  const s = fresh()
  assert.equal(completeModeOf(s, 'forge-softmax'), 'normal')
  assert.deepEqual(markReplayed(s, 'forge-softmax', { at: AT }), []) // 只记下来：不发事件、不给经验值、不算完成
  assert.equal(s.xp, 0)
  assert.equal(getStage(s, 'forge-softmax').completed, false)
  assert.equal(completeModeOf(s, 'forge-softmax'), 'watch')
  completeStage(s, 'forge-softmax', { mode: completeModeOf(s, 'forge-softmax'), at: AT })
  assert.deepEqual([s.bySource.watch, s.bySource.stage], [100, 0])
  assert.equal(getStage(s, 'forge-softmax').watched, true)

  // 先用真卡拿到了星（★1 成立才发），再看观摩：照常完成，经验值记在「完成关卡」
  const t = fresh()
  awardStar(t, 'forge-softmax', 0, { at: AT })
  markReplayed(t, 'forge-softmax', { at: AT })
  assert.equal(completeModeOf(t, 'forge-softmax'), 'normal')
  completeStage(t, 'forge-softmax', { mode: completeModeOf(t, 'forge-softmax'), at: AT })
  assert.deepEqual([t.bySource.watch, t.bySource.stage], [0, 100])
  assert.equal(getStage(t, 'forge-softmax').watched, false)
})

test('每颗星、每次完成只计一次', () => {
  const s = fresh()
  completeStage(s, 'novice-wavefront', { at: AT })
  completeStage(s, 'novice-wavefront', { at: AT })
  completeStage(s, 'novice-wavefront', { kind: 'boss', at: AT })
  assert.equal(s.xp, 100)

  awardStar(s, 'novice-wavefront', 1, { at: AT })
  assert.deepEqual(awardStar(s, 'novice-wavefront', 1, { at: AT }), [])
  assert.equal(s.xp, 150)
  assert.deepEqual(awardStar(s, 'novice-wavefront', 3, { at: AT }), []) // 只有 0/1/2 三颗
  assert.equal(s.xp, 150)

  awardBadge(s, 'first-clear', { at: AT })
  assert.deepEqual(awardBadge(s, 'first-clear', { at: AT }), [])
  assert.equal(Object.keys(s.badges).length, 1)

  collectTerm(s, 'block', { stage: 'novice-thread-groups', at: AT })
  assert.deepEqual(collectTerm(s, 'block', { stage: 'novice-wavefront', at: AT }), [])
  assert.deepEqual(s.codex.block, { at: AT, stage: 'novice-thread-groups' }) // 记第一次学到它的关卡

  recordPrediction(s, 'p-oob', 0, true, { at: AT })
  recordPrediction(s, 'p-oob', 2, false, { at: AT })
  assert.equal(s.predictions['p-oob'].choice, 0) // 只记第一次锁定的答案

  completeExercise(s, 'novice-ex-scale', 100, { at: AT })
  completeExercise(s, 'novice-ex-scale', 100, { at: AT })
  assert.equal(s.bySource.exercise, 100)

  completeAgentSide(s, 'novice-first-agent', { at: AT })
  completeAgentSide(s, 'novice-first-agent', { at: AT })
  assert.equal(s.bySource.agent, 50)
})

test('在挑战里看过答案：本关最高 2 星', () => {
  const s = fresh()
  markAnswerViewed(s, 'novice-coalescing', { at: AT })
  assert.equal(starCapOf(s, 'novice-coalescing'), 2)
  awardStar(s, 'novice-coalescing', 0, { at: AT })
  awardStar(s, 'novice-coalescing', 1, { at: AT })
  assert.deepEqual(awardStar(s, 'novice-coalescing', 2, { at: AT }), [])
  assert.equal(getStage(s, 'novice-coalescing').stars.length, 2)
  assert.equal(s.xp, 100)

  // 先拿满 3 颗再看答案，不回收已经拿到的星
  const t = fresh()
  for (const i of [0, 1, 2]) awardStar(t, 'novice-reduction', i, { at: AT })
  markAnswerViewed(t, 'novice-reduction', { at: AT })
  assert.equal(getStage(t, 'novice-reduction').stars.length, 3)

  // 探索环节看答案不影响星级：不调 markAnswerViewed 就不封顶
  const u = fresh()
  for (const i of [0, 1, 2]) awardStar(u, 'novice-reduction', i, { at: AT })
  assert.equal(starCapOf(u, 'novice-reduction'), 3)
})

test('副本：第一次通关发这道题的经验值；星和看答案记在副本里，星不另给经验值，看过答案最高 2 星', () => {
  const s = fresh()
  // 看答案可以在通关之前（提示阶梯没过满 6 次），这时还不算通关
  assert.deepEqual(markExerciseAnswerViewed(s, 'dungeon-a', { at: AT }), [])
  assert.equal(getExercise(s, 'dungeon-a').completed, false)
  assert.equal(exerciseStarCapOf(s, 'dungeon-a'), 2)

  const events = completeExercise(s, 'dungeon-a', 120, { at: AT })
  assert.deepEqual(events.map((e) => e.type), ['xp'])
  assert.deepEqual(completeExercise(s, 'dungeon-a', 120, { at: AT }), []) // 再通关不重复发
  for (const i of [0, 1, 2]) assert.deepEqual(awardExerciseStar(s, 'dungeon-a', i, { at: AT }), [])
  assert.deepEqual(getExercise(s, 'dungeon-a'), { completed: true, xp: 120, at: AT, stars: [0, 1], answerViewed: true, visitedAt: 0 })
  assert.equal(s.xp, 120) // 星不另给经验值
  assert.equal(summarize(s).stars, 0) // 全站的星只数关卡的
  assert.equal(getStage(s, 'dungeon-a').stars.length, 0)

  // 没看答案的副本能拿满 3 颗；先拿满再看答案不回收
  for (const i of [2, 0, 1, 1]) awardExerciseStar(s, 'dungeon-b', i, { at: AT })
  markExerciseAnswerViewed(s, 'dungeon-b', { at: AT })
  assert.deepEqual(getExercise(s, 'dungeon-b').stars, [0, 1, 2])
  assert.deepEqual(awardExerciseStar(s, 'dungeon-b', 3, { at: AT }), []) // 只有 0/1/2 三颗

  // 打开副本只记时间，不发事件、不给经验值
  assert.deepEqual(visitExercise(s, 'dungeon-c', { at: AT + 5 }), [])
  assert.equal(getExercise(s, 'dungeon-c').visitedAt, AT + 5)
  assert.equal(s.xp, 120)
})

test('副本记录的容错读取：只有 { xp, at } 的旧记录算通关，没通关的记录没有经验值，坏的星丢掉', () => {
  const s = normalizeState({
    exercises: {
      old: { xp: 80, at: 5 },
      viewed: { completed: false, xp: 120, at: 9, answerViewed: true, visitedAt: 7 },
      junk: { completed: true, stars: [2, 2, 7, -1, 'x', 0] },
    },
  }, AT)
  assert.deepEqual(s.exercises.old, { completed: true, xp: 80, at: 5, stars: [], answerViewed: false, visitedAt: 0 })
  assert.deepEqual(s.exercises.viewed, { completed: false, xp: 0, at: 0, stars: [], answerViewed: true, visitedAt: 7 })
  assert.deepEqual(s.exercises.junk, { completed: true, xp: 50, at: AT, stars: [0, 2], answerViewed: false, visitedAt: 0 })
})

test('定级换算：Lv.10 = 2700 XP，来源标「定级」，豁免关卡不自动给星', () => {
  const s = fresh()
  applyPlacement(s, 10, { exempt: ['novice-thousand-additions', 'novice-gpu-panorama'], at: AT })
  assert.equal(s.xp, 2700)
  assert.equal(levelOf(s.xp), 10)
  assert.equal(s.bySource.placement, 2700)
  assert.equal(XP_SOURCE_LABEL.placement, '定级')
  assert.equal(s.placement.level, 10)

  const exempt = getStage(s, 'novice-thousand-additions')
  assert.equal(exempt.exempt, true)
  assert.equal(exempt.stars.length, 0)
  assert.equal(exempt.completed, false)

  // 随时可以回去拿星
  awardStar(s, 'novice-thousand-additions', 0, { at: AT })
  assert.equal(s.xp, 2750)

  // 重新定级只补差额，不叠加
  applyPlacement(s, 10, { at: AT })
  assert.equal(s.bySource.placement, 2700)
  applyPlacement(s, 12, { at: AT })
  assert.equal(s.bySource.placement, 3300)
  applyPlacement(s, 3, { at: AT })
  assert.equal(s.bySource.placement, 3300)
})

test('重新定级覆盖上次的豁免：上次豁免、这次没豁免的取消豁免，等级记录换成这次的，经验值不收回', () => {
  const s = fresh()
  applyPlacement(s, 10, { exempt: ['novice-thousand-additions', 'novice-gpu-panorama', 'novice-boss'], at: AT })
  completeStage(s, 'novice-gpu-panorama', { at: AT })

  applyPlacement(s, 1, { exempt: ['novice-assign-threads', 'novice-boss'], at: AT + 1 })
  assert.equal(getStage(s, 'novice-thousand-additions').exempt, false)
  assert.equal(getStage(s, 'novice-gpu-panorama').exempt, false)
  // 豁免期间做完的关卡照样算完成
  assert.equal(getStage(s, 'novice-gpu-panorama').completed, true)
  assert.equal(getStage(s, 'novice-assign-threads').exempt, true)
  assert.equal(getStage(s, 'novice-boss').exempt, true)
  assert.deepEqual(s.placement, { level: 1, xp: 2700, at: AT + 1, exempt: ['novice-assign-threads', 'novice-boss'] })
  assert.equal(s.bySource.placement, 2700)
})

test('进度事件：发星、升级、得徽章、收入图鉴都发得出来', () => {
  const s = fresh()
  const star = awardStar(s, 'novice-divergence', 0, { at: AT })
  assert.deepEqual(star.find((e) => e.type === 'star'), { type: 'star', stage: 'novice-divergence', index: 0, stars: 1 })
  assert.equal(star.some((e) => e.type === 'xp' && e.amount === 50 && e.source === 'star'), true)
  assert.equal(star.some((e) => e.type === 'level'), false)

  const up = applyPlacement(s, 2, { at: AT })
  assert.deepEqual(up.find((e) => e.type === 'level'), { type: 'level', level: 2, from: 1 })

  assert.deepEqual(awardBadge(s, 'zero-oob', { at: AT }), [{ type: 'badge', id: 'zero-oob' }])
  assert.deepEqual(collectTerm(s, 'grid', { stage: 'novice-thread-groups', at: AT }), [
    { type: 'codex', key: 'grid', stage: 'novice-thread-groups' },
  ])
  assert.deepEqual(setPref(s, 'plain', true, { at: AT }), [{ type: 'pref', key: 'plain', value: true }])
  assert.deepEqual(setPref(s, 'plain', true, { at: AT }), []) // 没变化就不发事件
})

test('偏好：写法、路线、简洁模式、减弱动效', () => {
  const s = fresh()
  setPref(s, 'lang', 'python', { at: AT })
  setPref(s, 'route', 'triton', { at: AT })
  setPref(s, 'plain', true, { at: AT })
  setPref(s, 'reducedMotion', true, { at: AT })
  assert.deepEqual(s.prefs, { lang: 'python', route: 'triton', plain: true, reducedMotion: true })
})

/** 造一份内容齐全的存档，用来验证导出导入。 */
function richState() {
  const s = fresh()
  applyPlacement(s, 4, { exempt: ['novice-thousand-additions'], at: AT })
  completeStage(s, 'novice-thread-groups', { at: AT })
  for (const i of [0, 1, 2]) awardStar(s, 'novice-thread-groups', i, { at: AT })
  completeStage(s, 'novice-boss', { kind: 'boss', at: AT })
  completeStage(s, 'forge-first-kernel', { mode: 'watch', at: AT })
  markReplayed(s, 'forge-softmax', { at: AT })
  completeAgentSide(s, 'novice-first-agent', { at: AT })
  completeExercise(s, 'novice-ex-hist', 120, { at: AT })
  awardExerciseStar(s, 'novice-ex-hist', 1, { at: AT })
  markExerciseAnswerViewed(s, 'novice-ex-scale', { at: AT })
  visitExercise(s, 'novice-ex-scale', { at: AT })
  markAnswerViewed(s, 'novice-coalescing', { at: AT })
  awardBadge(s, 'first-clear', { at: AT })
  collectTerm(s, 'block', { stage: 'novice-thread-groups', at: AT })
  recordPrediction(s, 'p-groups', 1, true, { stage: 'novice-thread-groups', at: AT })
  setPref(s, 'lang', 'python', { at: AT })
  return s
}

test('导出 → 清空 → 导入后数据完全一致（JSON 文件和存档码都算）', () => {
  const s = richState()
  const json = exportJson(s, AT)
  assert.equal(s.lastExportAt, AT)
  const snapshot = JSON.parse(JSON.stringify(s))

  const storage = memoryStorage()
  saveState(storage, s)
  storage.removeItem(STORAGE_KEY)
  assert.equal(loadState(storage, AT).state.xp, 0) // 真的清空了

  const back = importSave(json, AT)
  assert.equal(back.ok, true)
  assert.deepEqual(back.state, snapshot)
  assert.deepEqual(back.summary, summarize(s))
  assert.match(back.warning, /覆盖/)

  const code = exportCode(s, AT)
  assert.match(code, /^[A-Za-z0-9_-]+$/) // base64url，可以直接贴
  const fromCode = importSave(code, AT)
  assert.equal(fromCode.ok, true)
  assert.deepEqual(fromCode.state, snapshot)
})

test('导入前校验：版本不对、不是本站存档、内容损坏都给得出话说', () => {
  const s = richState()
  const payload = JSON.parse(exportJson(s, AT))

  assert.match(importSave(JSON.stringify({ ...payload, v: 1 }), AT).error, /版本/)
  assert.match(importSave(JSON.stringify({ ...payload, app: 'other' }), AT).error, /Hello GPU/)
  assert.match(importSave('{ 坏掉的内容', AT).error, /读不出/)
  assert.match(importSave('   ', AT).error, /空/)
})

test('14 天没导出就提醒（没有进度时不打扰）', () => {
  const empty = fresh()
  assert.equal(shouldRemindExport(empty, AT + 30 * DAY), false)

  const s = richState()
  assert.equal(shouldRemindExport(s, AT + 13 * DAY), false)
  assert.equal(shouldRemindExport(s, AT + 15 * DAY), true)
  exportJson(s, AT + 15 * DAY)
  assert.equal(shouldRemindExport(s, AT + 16 * DAY), false)
})

/** 试点存档：完成 + 2 颗星 + 看过答案，还有预测和图鉴。 */
const PILOT_SAVE = JSON.stringify({
  version: 1,
  xp: 200,
  stages: { [PILOT_STAGE_ID]: { stars: [0, 1], completed: true, answerViewed: true } },
  predictions: { 'p-groups': { choice: 1, correct: true, at: AT - DAY } },
  codex: ['线程块', '网格'],
  log: [{ t: AT - DAY, stage: PILOT_STAGE_ID, type: 'star', data: { index: 0 } }],
})

test('旧版迁移：hg-pilot-v1 的试点关卡进度搬进 v2', () => {
  const storage = memoryStorage()
  storage.setItem(PILOT_KEY, PILOT_SAVE)
  storage.setItem(PILOT_LANG_KEY, 'python')

  const first = loadState(storage, AT)
  assert.equal(first.migrated, true)
  const s = first.state
  const stage = getStage(s, PILOT_STAGE_ID)
  assert.deepEqual(stage.stars, [0, 1])
  assert.equal(stage.completed, true)
  assert.equal(stage.answerViewed, true)
  assert.equal(s.xp, 200) // 100 完成 + 2 × 50，按 v2 的规则重算
  assert.deepEqual(s.bySource.stage, 100)
  assert.deepEqual(s.bySource.star, 100)
  assert.equal(s.predictions['p-groups'].choice, 1)
  // 试点存的是中文术语名，迁移时换成 glossary.json 的 key（F-07）
  assert.deepEqual(Object.keys(s.codex), ['block', 'grid'])
  assert.equal(s.prefs.lang, 'python')
  assert.deepEqual(stage.langs, ['python'])
  assert.equal(s.migrated[PILOT_KEY], AT)
  assert.equal('log' in s, false) // 试玩日志不进 v2

  // 已经写回了 v2，再读一次不会重复迁移、不会重复加分
  const second = loadState(storage, AT + DAY)
  assert.equal(second.migrated, false)
  assert.equal(second.state.xp, 200)
  assert.equal(migratePilot(second.state, PILOT_SAVE, 'python', AT + DAY), false)

  // 看过答案的关卡迁移后照样封顶 2 星
  assert.deepEqual(awardStar(second.state, PILOT_STAGE_ID, 2, { at: AT }), [])
})

test('存档损坏或版本不对时退回空档，不抛异常', () => {
  const storage = memoryStorage()
  storage.setItem(STORAGE_KEY, '{不是 JSON')
  assert.equal(loadState(storage, AT).state.xp, 0)
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, xp: 999 }))
  assert.equal(loadState(storage, AT).state.xp, 0)
  // 缺字段的存档补齐默认值
  storage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, xp: 150 }))
  const s = loadState(storage, AT).state
  assert.equal(s.xp, 150)
  assert.deepEqual(s.prefs, { lang: 'hip', route: 'hip', plain: false, reducedMotion: false })
})

test('隐私模式：localStorage 抛异常时退化成内存存储并提示「本次进度不会保存」', () => {
  const broken = {
    getItem() {
      throw new DOMException('denied')
    },
    setItem() {
      throw new DOMException('denied')
    },
    removeItem() {
      throw new DOMException('denied')
    },
  }
  globalThis.window = { localStorage: broken }
  try {
    const backend = openBackend()
    assert.equal(backend.kind, 'memory')
    assert.equal(backend.notice, UNAVAILABLE_NOTICE)
    assert.match(backend.notice, /本次进度不会保存/)

    // 退化之后照样能玩，只是存不下来
    const { state } = loadState(backend.storage, AT)
    completeStage(state, 'novice-wavefront', { at: AT })
    assert.equal(saveState(backend.storage, state), true)
    assert.equal(saveState(broken, state), false) // 直接写坏掉的存储也只是返回 false
    assert.equal(loadState(broken, AT).state.xp, 0)
  } finally {
    delete globalThis.window
  }
})

test('服务端渲染：没有 window 时读写和订阅都安全', () => {
  assert.equal(typeof globalThis.window, 'undefined')
  assert.equal(loadState(undefined, AT).state.xp, 0)
  assert.equal(saveState(undefined, fresh()), false)
  const off = onStorageSync(() => assert.fail('服务端不应该收到同步'))
  assert.equal(typeof off, 'function')
  off()
})

test('跨标签页同步：别的标签页改了存档就拿到新状态', () => {
  const handlers = new Set()
  globalThis.window = {
    addEventListener: (type, fn) => void (type === 'storage' && handlers.add(fn)),
    removeEventListener: (type, fn) => void handlers.delete(fn),
  }
  try {
    const seen = []
    const off = onStorageSync((state) => seen.push(state))
    const other = richState()
    for (const fn of handlers) fn({ key: STORAGE_KEY, newValue: JSON.stringify(other) })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].xp, other.xp)

    for (const fn of handlers) fn({ key: 'hg-other', newValue: 'x' })
    assert.equal(seen.length, 1) // 别的键不管

    for (const fn of handlers) fn({ key: null, newValue: null }) // 别的标签页清空了存储
    assert.equal(seen.length, 2)
    assert.equal(seen[1].xp, 0)

    off()
    assert.equal(handlers.size, 0)
  } finally {
    delete globalThis.window
  }
})

test('组合式函数：服务端渲染不读存储，事件广播给订阅者（F-13 用）', async () => {
  assert.equal(typeof globalThis.window, 'undefined')
  const store = await import('../../docs/course/useProgress.ts')
  const p = store.useProgress()
  p.ensureLoaded() // 没有 window：什么都不读，状态保持空档
  assert.equal(p.loaded.value, false)
  assert.equal(p.state.xp, 0)
  assert.equal(p.level.value, 1)

  const seen = []
  const off = store.onProgressEvent((e) => seen.push(e.type))
  p.completeStage('novice-thread-groups')
  p.awardStar('novice-thread-groups', 0)
  p.collectTerm('block', 'novice-thread-groups')
  p.awardBadge('first-clear')
  p.setPref('lang', 'python')
  assert.deepEqual(seen, ['xp', 'stage', 'xp', 'star', 'codex', 'badge', 'pref'])
  assert.equal(p.state.xp, 150)
  assert.equal(p.stars('novice-thread-groups'), 1)
  assert.equal(p.hasBadge('first-clear'), true)
  assert.equal(p.hasTerm('block'), true)

  // 导出 → 清空 → 导入，走组合式函数这一层也要一致
  const save = store.exportSave(AT)
  const before = JSON.parse(JSON.stringify(p.state))
  store.resetAll()
  assert.equal(p.state.xp, 0)
  const result = p.inspectSave(save.json)
  assert.equal(result.ok, true)
  store.applySave(result.state)
  assert.deepEqual(JSON.parse(JSON.stringify(p.state)), before)

  off()
  store.unload()
})

test('演示存档：demo 页的进度写到单独的键，正式存档一个字节都不变', async () => {
  const storage = memoryStorage()
  const real = fresh()
  completeStage(real, 'novice-wavefront', { at: AT })
  saveState(storage, real)
  const realRaw = storage.getItem(STORAGE_KEY)
  // 演示存档不迁移试点存档：迁移只该发生在正式存档上
  storage.setItem(PILOT_KEY, PILOT_SAVE)
  assert.equal(loadState(storage, AT, DEMO_STORAGE_KEY).migrated, false)
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), null)
  storage.removeItem(PILOT_KEY)

  globalThis.window = { localStorage: storage, addEventListener() {}, removeEventListener() {} }
  const store = await import('../../docs/course/useProgress.ts')
  try {
    // 布局的 setup 先选好演示存档（这时还没读存档），正文组件挂载后才读
    store.switchStore(true)
    const p = store.useProgress()
    p.ensureLoaded()
    assert.equal(p.demo.value, true)
    assert.equal(p.state.xp, 0)

    p.completeStage('demo-stage')
    p.awardStar('demo-stage', 0)
    p.recordPrediction('demo-predict', 1, true, 'demo-stage')
    assert.equal(storage.getItem(STORAGE_KEY), realRaw)
    assert.equal(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)).xp, 150)

    // 站内跳到正式页面：整份换回正式存档，演示进度不跟过来
    store.switchStore(false)
    assert.equal(p.demo.value, false)
    assert.equal(p.state.xp, 100)
    assert.equal(p.stars('demo-stage'), 0)
    assert.equal(p.prediction('demo-predict'), null)

    // 再回到演示页，演示进度还在；演示页上的重置只清演示存档
    store.switchStore(true)
    assert.equal(p.stars('demo-stage'), 1)
    store.resetAll()
    assert.equal(p.state.xp, 0)
    assert.equal(JSON.parse(storage.getItem(DEMO_STORAGE_KEY)).xp, 0)
    assert.equal(storage.getItem(STORAGE_KEY), realRaw)
  } finally {
    store.switchStore(false)
    store.unload()
    delete globalThis.window
  }
})

test('清空进度留下设置；清空、导入以后刷新，这台设备的试点存档不会再迁进来', async () => {
  const storage = memoryStorage()
  storage.setItem(PILOT_KEY, PILOT_SAVE)
  globalThis.window = { localStorage: storage, addEventListener() {}, removeEventListener() {} }
  const store = await import('../../docs/course/useProgress.ts')
  try {
    const p = store.useProgress()
    p.ensureLoaded()
    assert.equal(p.state.xp, 200) // 第一次读存档时迁进来
    p.setPref('plain', true)
    p.setPref('route', 'triton')

    store.resetAll()
    assert.equal(p.state.xp, 0)
    assert.deepEqual(p.state.prefs, { lang: 'hip', route: 'triton', plain: true, reducedMotion: false })
    store.unload() // 刷新页面
    p.ensureLoaded()
    assert.equal(p.state.xp, 0)
    assert.equal(getStage(p.state, PILOT_STAGE_ID).completed, false)
    assert.equal(p.state.prefs.plain, true)

    // 另一台设备导出的存档（没有迁移记录）覆盖进来，刷新以后还是那一份
    const other = fresh()
    completeStage(other, 'novice-wavefront', { at: AT })
    const result = p.inspectSave(exportJson(other, AT))
    store.applySave(result.state)
    store.unload()
    p.ensureLoaded()
    assert.equal(p.state.xp, 100)
    assert.deepEqual(Object.keys(p.state.stages), ['novice-wavefront'])
  } finally {
    store.unload()
    delete globalThis.window
  }
})
