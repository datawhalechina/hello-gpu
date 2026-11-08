import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluate, parseIndexExpr } from '../../docs/preview/sim/expr.ts'
import { describe, minBlocks, simulate } from '../../docs/preview/sim/launch.ts'
import { judge } from '../../docs/preview/novice/thread-groups/challenge.ts'
import {
  awardStar, completeStage, emptyState, levelOf, loadState, markAnswerViewed,
  recordPrediction, resetStage, saveState, STORAGE_KEY,
} from '../../docs/preview/sim/progress.ts'

const env = (block, thread, blockDim = 4, gridDim = 3, n = 10) =>
  ({ 'blockIdx.x': block, 'blockDim.x': blockDim, 'threadIdx.x': thread, 'gridDim.x': gridDim, n })

function parse(src, lang = 'hip') {
  const r = parseIndexExpr(src, lang)
  assert.ok(r.ok, r.ok ? '' : r.error.message)
  return r.expr
}

test('全局下标公式在两种写法下解析成同一棵语法树', () => {
  const src = 'blockIdx.x * blockDim.x + threadIdx.x'
  assert.deepEqual(parse(src, 'hip'), parse(src, 'python'))
  assert.deepEqual(parse(`int i = ${src};`, 'hip'), parse(src, 'hip'))
  assert.deepEqual(parse(`i = ${src}`, 'python'), parse(src, 'python'))
})

test('运算优先级、括号与一元负号', () => {
  const e = parse('(blockIdx.x + 1) * blockDim.x - threadIdx.x')
  const r = evaluate(e, env(2, 1), 'hip')
  assert.deepEqual(r, { ok: true, value: 11 })
  assert.deepEqual(evaluate(parse('-threadIdx.x + 3'), env(0, 1), 'hip'), { ok: true, value: 2 })
})

test('除法：HIP 截断取整，Python 的 / 得到小数会被拒绝，// 是向下取整', () => {
  const div = src => [evaluate(parse(src, 'hip'), env(0, 3), 'hip'), evaluate(parse(src, 'python'), env(0, 3), 'python')]
  const [hip, py] = div('threadIdx.x / 2')
  assert.deepEqual(hip, { ok: true, value: 1 })
  assert.equal(py.ok, false)
  assert.match(py.error, /\/\//)
  assert.deepEqual(evaluate(parse('-threadIdx.x // 2', 'python'), env(0, 3), 'python'), { ok: true, value: -2 })
  // 除得尽也不行：Python 里 8 / 1 是 8.0，不能当下标；HIP 里是整数 8
  const exact = 'blockIdx.x * blockDim.x / 1 + threadIdx.x'
  assert.equal(evaluate(parse(exact, 'python'), env(2, 0), 'python').ok, false)
  assert.deepEqual(evaluate(parse(exact, 'hip'), env(2, 0), 'hip'), { ok: true, value: 8 })
  assert.equal(evaluate(parse('(threadIdx.x / 1) // 1', 'python'), env(0, 3), 'python').ok, false)
  assert.deepEqual(evaluate(parse('-threadIdx.x / 2', 'hip'), env(0, 3), 'hip'), { ok: true, value: -1 })
})

test('读者常见的写错方式都有可读的错误提示', () => {
  const err = (src, lang = 'hip') => {
    const r = parseIndexExpr(src, lang)
    assert.equal(r.ok, false, `应当报错：${src}`)
    return r.error.message
  }
  assert.match(err(''), /先写出/)
  assert.match(err('threadIdx'), /\.x/)
  assert.match(err('threadIdx.y'), /只用 \.x/)
  assert.match(err('blockIdx.x * blockDim'), /\.x/)
  assert.match(err('tid'), /不认识/)
  assert.match(err('blockIdx.x // 2', 'hip'), /注释/)
  assert.match(err('(blockIdx.x + 1'), /右括号/)
  assert.match(err('blockIdx.x blockDim.x'), /运算符/)
  assert.match(err('blockIdx.x *'), /没写完/)
  assert.match(err('1.5 * threadIdx.x'), /整数/)
})

test('正确公式 + 3 组 × 4：10 个数全部覆盖，2 个越界；加上检查后变成跳过', () => {
  const e = parse('blockIdx.x * blockDim.x + threadIdx.x')
  const r = simulate(e, 'hip', { n: 10, blockDim: 4, gridDim: 3, guard: false })
  assert.ok(r.ok)
  assert.equal(r.summary.allCorrect, true)
  assert.equal(r.summary.duplicates, 0)
  assert.equal(r.summary.oobWrites, 2)
  assert.deepEqual(r.outside.map(o => o.index), [10, 11])
  const g = simulate(e, 'hip', { n: 10, blockDim: 4, gridDim: 3, guard: true })
  assert.ok(g.ok)
  assert.equal(g.summary.oobWrites, 0)
  assert.equal(g.summary.skipped, 2)
  assert.match(describe(g, 10), /全部算对/)
})

test('只用 threadIdx.x：每组都去抢前几个数，后面的数没人算', () => {
  const r = simulate(parse('threadIdx.x'), 'python', { n: 10, blockDim: 4, gridDim: 3, guard: false })
  assert.ok(r.ok)
  assert.equal(r.summary.covered, 4)
  assert.equal(r.summary.missing, 6)
  assert.equal(r.summary.duplicates, 4)
  assert.deepEqual(r.elements[0], [{ block: 0, thread: 0 }, { block: 1, thread: 0 }, { block: 2, thread: 0 }])
})

test('边界检查只写 i < n：负数下标依然算越界', () => {
  const r = simulate(parse('threadIdx.x - 1'), 'hip', { n: 4, blockDim: 4, gridDim: 1, guard: true })
  assert.ok(r.ok)
  assert.equal(r.summary.oobWrites, 1)
  assert.deepEqual(r.outside, [{ index: -1, writers: [{ block: 0, thread: 0 }] }])
})

test('Python 写法里的小数下标会让整次运行报错，并指出是哪个线程', () => {
  const r = simulate(parse('threadIdx.x / 2', 'python'), 'python', { n: 4, blockDim: 4, gridDim: 1, guard: false })
  assert.equal(r.ok, false)
  // 第一个线程就出错：0 / 2 得到 0.0，同样是小数类型
  assert.deepEqual([r.block, r.thread], [0, 0])
})

test('星级：正确、无越界、最少组数且不写死人数', () => {
  const cfg = { n: 13, blockDim: 4, gridDim: 4, guard: true }
  const good = parse('blockIdx.x * blockDim.x + threadIdx.x')
  assert.deepEqual(judge(good, 'hip', cfg, [2, 4, 8]).earned, [true, true, true])
  assert.equal(minBlocks(13, 4), 4)

  const noGuard = judge(good, 'hip', { ...cfg, guard: false }, [2, 4, 8])
  assert.deepEqual(noGuard.earned, [true, false, false])
  assert.match(noGuard.next, /3 个线程/)

  const tooMany = judge(good, 'hip', { ...cfg, gridDim: 5 }, [2, 4, 8])
  assert.deepEqual(tooMany.earned, [true, true, false])
  assert.match(tooMany.next, /4 组就够了/)

  const hardCoded = judge(parse('blockIdx.x * 4 + threadIdx.x'), 'hip', cfg, [2, 4, 8])
  assert.deepEqual(hardCoded.earned, [true, true, false])
  assert.match(hardCoded.next, /写死/)

  assert.deepEqual(judge(parse('threadIdx.x'), 'hip', cfg, [2, 4, 8]).earned, [false, false, false])
})

test('进度：星和完成各只计一次，看过答案后第三颗星不再发放，每 300 XP 升一级', () => {
  const s = emptyState()
  assert.equal(awardStar(s, 'x', 0), 50)
  assert.equal(awardStar(s, 'x', 0), 0)
  markAnswerViewed(s, 'x')
  assert.equal(awardStar(s, 'x', 2), 0)
  assert.equal(awardStar(s, 'x', 1), 50)
  assert.equal(completeStage(s, 'x'), 100)
  assert.equal(completeStage(s, 'x'), 0)
  assert.equal(s.xp, 200)
  assert.deepEqual(levelOf(s.xp), { level: 1, into: 200, need: 300 })
  assert.deepEqual(levelOf(300).level, 2)

  assert.equal(recordPrediction(s, 'p', 1, true, 0), true)
  assert.equal(recordPrediction(s, 'p', 2, false, 0), false)
  assert.equal(s.predictions.p.choice, 1)

  resetStage(s, 'x', ['p'])
  assert.equal(s.xp, 0)
  assert.equal(s.stages.x, undefined)
  assert.equal(s.predictions.p, undefined)
})

test('进度存取：损坏或旧版本的数据回到空状态，存储不可用时不抛错', () => {
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  const s = emptyState()
  s.xp = 150
  saveState(storage, s)
  assert.equal(loadState(storage).xp, 150)
  store.set(STORAGE_KEY, '{broken')
  assert.equal(loadState(storage).xp, 0)
  store.set(STORAGE_KEY, JSON.stringify({ version: 0, xp: 999 }))
  assert.equal(loadState(storage).xp, 0)
  const throwing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(loadState(throwing).xp, 0)
  assert.doesNotThrow(() => saveState(throwing, s))
})
