import assert from 'node:assert/strict'
import test from 'node:test'
import { EXERCISE_LIST, STAGES, ZONES } from '../../docs/course/outline.ts'
import {
  applyPlacement, awardExerciseStar, awardStar, completeExercise, completeStage, emptyState, getStage, importSave, exportJson,
  markAnswerViewed, markExerciseAnswerViewed, visitExercise, visitStage,
} from '../../docs/course/progress.ts'
import { exerciseProgress, exerciseStatus, isNewcomer, nextStage, showsStars, stageStatus, whereAmI, zoneProgress } from '../../docs/course/journey.ts'

const AT = 1_762_000_000_000

/** 造一段路线：大纲里现在全是 planned，判断「上线了的关卡」要自己造。 */
function stage(id, status = 'draft', extra = {}) {
  return { id, zone: 'novice', code: id, slug: id, kind: 'stage', title: id, subtitle: '', lv: 1, minutes: 10, status, ...extra }
}
const A = stage('a')
const B = stage('b')
const C = stage('c')
const D = stage('d', 'planned')
const ROUTE = [A, B, C, D]

test('关卡状态的优先级：完成 > 已豁免 > 建设中 > 进行中 > 未开始', () => {
  const s = emptyState(AT)
  assert.equal(stageStatus(A, s), 'todo')
  assert.equal(stageStatus(D, s), 'soon')

  // 打开过、拿到星、看过答案都算开始做了
  visitStage(s, 'a', { at: AT })
  assert.equal(stageStatus(A, s), 'doing')
  awardStar(s, 'b', 0, { at: AT })
  assert.equal(stageStatus(B, s), 'doing')
  markAnswerViewed(s, 'c', { at: AT })
  assert.equal(stageStatus(C, s), 'doing')

  // 还没上线的关卡打开过也还是建设中（进不去）
  visitStage(s, 'd', { at: AT })
  assert.equal(stageStatus(D, s), 'soon')

  // 定级豁免：上没上线都显示已豁免，豁免以后再做完就是完成
  applyPlacement(s, 3, { exempt: ['a', 'd'], at: AT })
  assert.equal(stageStatus(A, s), 'exempt')
  assert.equal(stageStatus(D, s), 'exempt')
  completeStage(s, 'a', { at: AT })
  assert.equal(stageStatus(A, s), 'done')

  // 还没上线的关卡也可能有完成记录（试点关卡迁过来的进度）：做过就是完成
  const t = emptyState(AT)
  completeStage(t, 'd', { at: AT })
  assert.equal(stageStatus(D, t), 'done')
})

test('星级那一栏：上线了的画空星，豁免的不画（04 第 2 节），回去拿到星以后照常画，建设中的没拿过星不画', () => {
  const s = emptyState(AT)
  assert.deepEqual([A, D].map((x) => showsStars(x, s)), [true, false])

  applyPlacement(s, 3, { exempt: ['a', 'd'], at: AT })
  assert.deepEqual([A, D].map((x) => showsStars(x, s)), [false, false])

  awardStar(s, 'a', 0, { at: AT })
  awardStar(s, 'd', 0, { at: AT })
  assert.deepEqual([A, D].map((x) => showsStars(x, s)), [true, true])
})

test('「你在这」：已上线、没完成的关卡里最近打开的；没有就是下一个推荐关卡', () => {
  const s = emptyState(AT)
  assert.deepEqual(whereAmI(s, ROUTE), { stage: A, reason: 'next' })

  visitStage(s, 'b', { at: AT + 1 })
  visitStage(s, 'c', { at: AT + 2 })
  assert.deepEqual(whereAmI(s, ROUTE), { stage: C, reason: 'last' })

  // 回头翻看已经完成的关卡，不把「你在这」拽回去
  completeStage(s, 'a', { at: AT })
  visitStage(s, 'a', { at: AT + 3 })
  assert.deepEqual(whereAmI(s, ROUTE), { stage: C, reason: 'last' })

  // 还在建设中的关卡（占位页）打开过也不算「上次停在那里」
  visitStage(s, 'd', { at: AT + 4 })
  assert.deepEqual(whereAmI(s, ROUTE), { stage: C, reason: 'last' })

  // 打开过的都做完了：回到下一个推荐关卡，跳过豁免的，建设中的照样推荐
  completeStage(s, 'b', { at: AT })
  completeStage(s, 'c', { at: AT })
  assert.deepEqual(whereAmI(s, ROUTE), { stage: D, reason: 'next' })
  applyPlacement(s, 2, { exempt: ['d'], at: AT })
  assert.equal(nextStage(s, ROUTE), null)
  assert.equal(whereAmI(s, ROUTE), null)
})

test('下一个推荐关卡按大纲顺序补空：跳着做的读者先被推荐回漏掉的那一关', () => {
  const s = emptyState(AT)
  completeStage(s, 'a', { at: AT })
  completeStage(s, 'c', { at: AT })
  assert.equal(nextStage(s, ROUTE), B)
  applyPlacement(s, 2, { exempt: ['b'], at: AT })
  assert.equal(nextStage(s, ROUTE), D)
})

test('第一次来：没经验值、没定级，也没打开、豁免过任何一关', () => {
  assert.equal(isNewcomer(emptyState(AT)), true)

  const visited = emptyState(AT)
  visitStage(visited, 'a', { at: AT })
  assert.equal(isNewcomer(visited), false)

  // 定级到 Lv.1 不加经验值、也没有豁免，但已经做过定级了
  const placed = emptyState(AT)
  applyPlacement(placed, 1, { at: AT })
  assert.equal(isNewcomer(placed), false)

  const done = emptyState(AT)
  completeStage(done, 'a', { at: AT })
  assert.equal(isNewcomer(done), false)
})

test('打开关卡只记时间：不加经验值、不发事件，导出导入后还在，旧存档没有这一项按没打开过', () => {
  const s = emptyState(AT)
  assert.deepEqual(visitStage(s, 'a', { at: AT + 5 }), [])
  assert.equal(s.xp, 0)
  assert.equal(getStage(s, 'a').visitedAt, AT + 5)
  assert.equal(getStage(s, 'a').completed, false)

  const back = importSave(exportJson(s, AT + 6), AT + 7)
  assert.equal(back.ok, true)
  assert.equal(getStage(back.state, 'a').visitedAt, AT + 5)

  const old = importSave(JSON.stringify({
    app: 'hello-gpu', v: 2, exportedAt: AT,
    state: { v: 2, xp: 100, bySource: { stage: 100 }, stages: { a: { completed: true, stars: [], at: AT } } },
  }), AT)
  assert.equal(old.ok, true)
  assert.equal(getStage(old.state, 'a').visitedAt, 0)
})

test('区域进度：大纲里每一关都落在自己的区域里，一关不少；豁免的不算通关', () => {
  const s = emptyState(AT)
  const first = STAGES[0]
  completeStage(s, first.id, { at: AT })
  awardStar(s, first.id, 0, { at: AT })
  awardStar(s, first.id, 1, { at: AT })
  applyPlacement(s, 3, { exempt: [STAGES[1].id], at: AT })

  const zones = zoneProgress(s)
  assert.deepEqual(zones.map((z) => z.zone.id), ZONES.map((z) => z.id))
  assert.deepEqual(zones.flatMap((z) => z.stages), STAGES, '地图按区域分组后，顺序和数量都要和大纲一样')
  for (const z of zones) assert.ok(z.stages.every((x) => x.zone === z.zone.id))

  const home = zones.find((z) => z.zone.id === first.zone)
  assert.deepEqual([home.done, home.exempt, home.stars], [1, 1, 2])
})

test('副本的状态和关卡同一套说法：完成 > 建设中 > 进行中 > 未开始；完成情况按通关算', () => {
  const s = emptyState(AT)
  const exercise = (id, status = 'draft') => ({ ...EXERCISE_LIST[0], id, status })
  const [x, y, z, soon] = [exercise('x'), exercise('y'), exercise('z'), exercise('w', 'planned')]
  assert.deepEqual([x, soon].map((e) => exerciseStatus(e, s)), ['todo', 'soon'])

  // 打开过、拿过星、看过答案都算开始做了；还没上线的打开过也还是建设中
  visitExercise(s, 'x', { at: AT })
  awardExerciseStar(s, 'y', 1, { at: AT })
  markExerciseAnswerViewed(s, 'z', { at: AT })
  visitExercise(s, 'w', { at: AT })
  assert.deepEqual([x, y, z, soon].map((e) => exerciseStatus(e, s)), ['doing', 'doing', 'doing', 'soon'])

  // 通关就是完成，还没上线的也算（做过就是做过），定级不豁免副本
  completeExercise(s, 'x', 80, { at: AT })
  completeExercise(s, 'w', 150, { at: AT })
  applyPlacement(s, 10, { exempt: ['y'], at: AT })
  assert.deepEqual([x, y, soon].map((e) => exerciseStatus(e, s)), ['done', 'doing', 'done'])
  assert.deepEqual(exerciseProgress(s, [x, y, z, soon]), { done: 2, total: 4, xp: 230 })
  assert.deepEqual(exerciseProgress(s), { done: 0, total: EXERCISE_LIST.length, xp: 0 })
})
