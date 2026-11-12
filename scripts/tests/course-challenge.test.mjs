import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_STARS_AFTER_ANSWER } from '../../docs/course/progress.ts'
import {
  canReveal, challengeSection, emptyRecord, failuresToNext, hintLevel, missingErrorParts, normalizeRecord, recordAttempt,
} from '../../docs/course/useChallenge.ts'
import {
  clearDrafts, DEMO_DRAFT_PREFIX, DRAFT_PREFIX, draftKey, loadDraftSlot, memoryStorage, saveDraftSlot,
} from '../../docs/course/storage.ts'

const FAIL = { earned: [false, false, false] }
const ALL = { earned: [true, true, true] }

/** 组合式函数和进度存档都是模块级的单例：每个用例用自己的关卡 id，按经验值的增量判断。 */
let seq = 0
async function fresh(kind = 'challenge') {
  const { useChallenge } = await import('../../docs/course/useChallenge.ts')
  const { useProgress } = await import('../../docs/course/useProgress.ts')
  const stage = `test-challenge-${++seq}`
  const progress = useProgress()
  const make = (k = kind, id = 'main') => useChallenge({ stage, id, kind: k, hints: { direction: '方向', location: '位置', answer: '答案' } })
  return { stage, progress, ch: make(), make }
}

test('提示阶梯：没过第 2、4、6 次分别解锁方向、位置、看答案，每级只解锁一次', () => {
  const record = emptyRecord()
  const unlocked = []
  for (let i = 1; i <= 8; i++) unlocked.push(recordAttempt(record, FAIL).unlocked)
  assert.deepEqual(unlocked, [null, 'direction', null, 'location', null, 'answer', null, null])
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(hintLevel), [0, 0, 1, 1, 2, 2, 3, 3])
  assert.deepEqual([0, 1, 2, 3, 5, 6, 10].map(failuresToNext), [2, 1, 2, 1, 1, 0, 0])
  // 过了不会把阶梯退回去
  recordAttempt(record, ALL)
  assert.equal(record.failures, 8)
  assert.equal(record.attempts, 9)
  assert.equal(hintLevel(record.failures), 3)
})

test('只有 ★1（结果正确）成立才算过；★2、★3 以 ★1 为前提', () => {
  const record = emptyRecord()
  assert.deepEqual(recordAttempt(record, { earned: [false, true, true] }), { passed: false, unlocked: null, stars: [] })
  assert.equal(record.failures, 1)
  assert.deepEqual(recordAttempt(record, { earned: [true, false, true] }).stars, [0, 2])
  assert.equal(record.failures, 1)
})

test('看答案：没过满 6 次不给看', async () => {
  const { ch } = await fresh()
  for (let i = 0; i < 5; i++) ch.attempt(FAIL)
  assert.equal(canReveal(ch.record), false)
  assert.equal(ch.revealAnswer(), false)
  assert.equal(ch.record.revealed, false)
  ch.attempt(FAIL)
  assert.equal(ch.revealAnswer(), true)
  assert.equal(ch.record.revealed, true)
})

test('不惩罚：没过不扣经验值、不限次数，之后照样拿满星', async () => {
  const { stage, progress, ch } = await fresh()
  const before = progress.state.xp
  for (let i = 0; i < 20; i++) ch.attempt(FAIL)
  assert.equal(progress.state.xp, before)
  ch.attempt(ALL)
  assert.equal(progress.stars(stage), 3)
  assert.equal(progress.state.xp, before + 150)
})

test('重复判星不重复加经验值', async () => {
  const { stage, progress, ch } = await fresh()
  const before = progress.state.xp
  ch.attempt({ earned: [true, false, false] })
  ch.attempt({ earned: [true, false, false] })
  assert.equal(progress.state.xp, before + 50)
  ch.attempt(ALL)
  ch.attempt(ALL)
  assert.equal(progress.stars(stage), 3)
  assert.equal(progress.state.xp, before + 150)
})

test('挑战里看过答案：本关最高 2 星，之前拿到的星不收回', async () => {
  const { stage, progress, ch } = await fresh()
  for (let i = 0; i < 6; i++) ch.attempt(FAIL)
  ch.revealAnswer()
  assert.equal(ch.cap.value, MAX_STARS_AFTER_ANSWER)
  assert.equal(progress.starCap(stage), MAX_STARS_AFTER_ANSWER)
  const before = progress.state.xp
  ch.attempt(ALL)
  assert.equal(progress.stars(stage), 2)
  assert.equal(progress.state.xp, before + 100)

  const other = await fresh()
  other.ch.attempt(ALL)
  for (let i = 0; i < 6; i++) other.ch.attempt(FAIL)
  other.ch.revealAnswer()
  assert.equal(other.progress.stars(other.stage), 3)
})

test('探索环节：看答案不影响星级，探索的尝试也不发星', async () => {
  const { stage, progress, make } = await fresh('explore')
  const explore = make('explore', 'explore')
  for (let i = 0; i < 6; i++) explore.attempt(FAIL)
  assert.equal(explore.revealAnswer(), true)
  explore.attempt(ALL)
  assert.equal(progress.stars(stage), 0)
  assert.equal(progress.starCap(stage), 3)
  assert.equal(explore.cap.value, 3)

  make('challenge', 'main').attempt(ALL)
  assert.equal(progress.stars(stage), 3)
})

test('综合关的分题：记次数、给提示，自己不发星；分题里看过答案，本关合起来判星时最高 2 星', async () => {
  const { useChallenge } = await import('../../docs/course/useChallenge.ts')
  const { stage, progress, make } = await fresh('part')
  const part = make('part', 'part')
  part.attempt(ALL)
  assert.equal(progress.stars(stage), 0)
  assert.equal(part.cap.value, 3)
  for (let i = 0; i < 6; i++) part.attempt(FAIL)
  assert.equal(part.record.failures, 6)
  assert.equal(part.revealAnswer(), true)
  assert.equal(part.cap.value, MAX_STARS_AFTER_ANSWER)
  assert.equal(progress.starCap(stage), MAX_STARS_AFTER_ANSWER)
  // 关卡把分题合起来判星，交给一个不带提示的挑战发
  useChallenge({ stage, id: 'boss' }).attempt(ALL)
  assert.equal(progress.stars(stage), MAX_STARS_AFTER_ANSWER)
})

test('副本的挑战：★1 成立才算通关，发这道题的经验值（只发一次），星记在副本里不另给经验值；看过答案最高 2 星', async () => {
  const { useChallenge } = await import('../../docs/course/useChallenge.ts')
  const { useProgress } = await import('../../docs/course/useProgress.ts')
  const { exerciseById } = await import('../../docs/course/outline.ts')
  const progress = useProgress()
  // 副本 id 要是大纲里真有的：经验值按大纲里这道题的 xp 发
  const id = 'dungeon-histogram'
  const { xp } = exerciseById(id)
  const ch = useChallenge({ stage: id, id: 'main', hints: { direction: '方向', location: '位置', answer: '答案' } })
  const before = progress.state.xp

  for (let i = 0; i < 6; i++) ch.attempt({ earned: [false, true, true] })
  assert.equal(progress.exercise(id).completed, false)
  assert.equal(progress.state.xp, before)

  assert.equal(ch.revealAnswer(), true)
  assert.equal(progress.exercise(id).answerViewed, true)
  assert.equal(ch.cap.value, MAX_STARS_AFTER_ANSWER)

  ch.attempt(ALL)
  ch.attempt(ALL)
  assert.equal(progress.exercise(id).completed, true)
  assert.deepEqual(progress.exercise(id).stars, [0, 1])
  assert.equal(progress.state.xp, before + xp)
  assert.equal(progress.stars(id), 0) // 不当成关卡发星
})

test('自动保存：每关一个草稿槽，刷新后尝试次数、看答案和参数都还在；演示页用单独的槽', async () => {
  const storage = memoryStorage()
  globalThis.window = { localStorage: storage, addEventListener() {}, removeEventListener() {} }
  const store = await import('../../docs/course/useProgress.ts')
  const { useChallenge } = await import('../../docs/course/useChallenge.ts')
  store.unload()
  try {
    store.ensureLoaded()
    const ch = useChallenge({ stage: 'test-draft', id: 'launch' })
    ch.draft.value = { blockDim: 8, guard: true }
    for (let i = 0; i < 6; i++) ch.attempt(FAIL) // 尝试会立刻写盘
    ch.revealAnswer()

    // 「刷新」：同一关同一个挑战重新读
    const again = useChallenge({ stage: 'test-draft', id: 'launch' })
    assert.deepEqual({ ...again.record }, { attempts: 6, failures: 6, revealed: true, draft: { blockDim: 8, guard: true } })
    assert.equal(again.level.value, 3)
    // 同一关的另一个挑战、另一关：互不影响
    assert.equal(useChallenge({ stage: 'test-draft', id: 'other' }).record.attempts, 0)
    assert.equal(useChallenge({ stage: 'test-draft-2', id: 'launch' }).record.attempts, 0)

    // 演示页：单独的草稿槽，正式的一个字节都不动
    const realRaw = storage.getItem(draftKey('test-draft'))
    store.switchStore(true)
    const demo = useChallenge({ stage: 'test-draft', id: 'launch' })
    assert.equal(demo.record.attempts, 0)
    demo.attempt(FAIL)
    assert.equal(storage.getItem(draftKey('test-draft')), realRaw)
    assert.equal(loadDraftSlot(storage, 'test-draft', true).launch.attempts, 1)

    // 演示页上的重置只清演示这一边的草稿槽
    store.resetAll()
    assert.equal(storage.getItem(draftKey('test-draft', true)), null)
    assert.equal(storage.getItem(draftKey('test-draft')), realRaw)
  } finally {
    store.switchStore(false)
    store.unload()
    delete globalThis.window
  }
})

test('草稿槽读坏数据：缺的补默认值，类型不对的丢掉，不抛异常', () => {
  const storage = memoryStorage()
  storage.setItem(draftKey('s'), '{oops')
  assert.deepEqual(loadDraftSlot(storage, 's'), {})
  storage.setItem(draftKey('s'), '[1,2]')
  assert.deepEqual(loadDraftSlot(storage, 's'), {})
  assert.deepEqual(normalizeRecord({ attempts: -3, failures: '7', revealed: 'yes' }), { attempts: 0, failures: 0, revealed: false, draft: null })
  assert.deepEqual(normalizeRecord({ attempts: 1, failures: 4.6, draft: [1] }), { attempts: 4, failures: 4, revealed: false, draft: [1] })
  assert.deepEqual(normalizeRecord(null), emptyRecord())

  saveDraftSlot(storage, 'a', { x: 1 })
  saveDraftSlot(storage, 'b', { x: 2 }, true)
  storage.setItem('hg-progress-v2', '{}')
  clearDrafts(storage)
  assert.equal(storage.getItem(`${DRAFT_PREFIX}a`), null)
  assert.notEqual(storage.getItem(`${DEMO_DRAFT_PREFIX}b`), null)
  assert.equal(storage.getItem('hg-progress-v2'), '{}')
})

test('随时可跳过：「我已经会了，直接做挑战」指向标题以「挑战」开头的那一段', () => {
  const sections = [{ slug: '热身', title: '热身' }, { slug: '挑战-派出刚好够用的线程', title: '挑战：派出刚好够用的线程' }, { slug: '检查点', title: '检查点' }]
  assert.equal(challengeSection(sections)?.slug, '挑战-派出刚好够用的线程')
  assert.equal(challengeSection([{ slug: 'x', title: '我的挑战' }]), null)
  assert.equal(challengeSection([]), null)
})

test('错误说明要写全「现象 + 原因 + 怎么改」，缺哪部分就报哪部分', () => {
  assert.deepEqual(missingErrorParts({ symptom: '越界', cause: '线程多了', fix: '加边界检查' }), [])
  assert.deepEqual(missingErrorParts({ symptom: '越界', cause: ' ', fix: '' }), ['原因', '怎么改'])
})
