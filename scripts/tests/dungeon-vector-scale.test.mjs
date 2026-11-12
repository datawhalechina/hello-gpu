import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import {
  ARGS, BEST_GUARD, BLANKS, CODE, GLOBAL_INDEX, K, LAUNCH, N, THREADS, VARIANTS, checkScale, judge, valueText,
} from '../../docs/dungeon/vector-scale/challenge.ts'

/**
 * 副本「向量缩放」：200 个数原地乘以 10，派 4 组、每组 64 个线程。读者补下标 i 和写入前的条件。
 * 判定按事件流数每一格被几个线程写了、谁读写到了 x 外面；两种写法的事件流（除了行号）、结果和判定都相同。
 */

const LANGS = ['hip', 'python']

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行。 */
const strip = (result) => ({
  ok: result.ok,
  arrays: result.arrays,
  steps: result.steps,
  outside: result.outside.map((o) => ({ ...o, writes: o.writes.map(({ line, ...w }) => w) })),
  events: result.events.map(({ line, ...e }) => e),
})

/** 模板按读者填的空拼成代码；不填就是初始内容。 */
const source = (lang, values = {}) => fillTemplate(parseTemplate(CODE[lang]), values).source

/**
 * 点一次「运行」：题目的那一次 + 换派法的两次（同 Sandbox 的 variants）。两种写法的事件流、结果和判定都相同。
 * values 是读者填的空；两种写法填得不一样（true / True）时写成 { hip: {…}, python: {…} }。
 */
function attempt(values = {}) {
  const launches = [{ launch: LAUNCH, args: ARGS }, ...VARIANTS.map(({ grid, block, args }) => ({ launch: { grid, block }, args }))]
  const [hip, python] = LANGS.map((lang) => launches.map(({ launch, args }) => {
    const filled = source(lang, values.hip ? values[lang] : values)
    return { launch, result: run(buildRequest(filled, lang, launch, args)) }
  }))
  hip.forEach((r, k) => assert.deepEqual(strip(python[k].result), strip(r.result)))
  const verdict = judge(hip)
  assert.deepEqual(judge(python), verdict)
  return { verdict, runs: hip }
}

/** 手机上第 k 个选项：两种写法的选项按位置对应。 */
const choice = (blank, lang, k) => (Array.isArray(blank.choices) ? blank.choices : blank.choices[lang])[k]

const stars = (verdict) => verdict.earned.filter(Boolean).length

test('原样运行：4 组都从 x[0] 乘起，x[0]～x[63] 各被 4 个线程乘（模拟器里成了 10⁴ 倍），x[64]～x[199] 没人乘，一颗星都没有', () => {
  const { verdict, runs } = attempt()
  assert.deepEqual(verdict.earned, [false, false, false])
  const c = checkScale(runs[0])
  assert.deepEqual(c.repeated, Array.from({ length: 64 }, (_, j) => j))
  assert.deepEqual(c.missing, Array.from({ length: N - 64 }, (_, j) => 64 + j))
  assert.deepEqual(c.writers[0], [0, 1, 2, 3].map((block) => ({ block, thread: 0 })))
  assert.equal(c.values[0], K ** 4)
  // 现象写出乘错的那一格和没人乘的那一段，原因点名碰到同一格的线程
  assert.match(verdict.error.symptom, /x\[0\] 应该是 10，运行后是 10000；x\[64\]～x\[199\] 没人乘/)
  assert.match(verdict.error.cause, /x\[0\] 被 4 个线程各乘了一次（block 0 的 0 号、block 1 的 0 号、block 2 的 0 号 等线程）/)
  assert.match(valueText(runs[0].result), /64 个乘了不止一次，136 个还是原来的数/)
})

test('★1 成立、★2 不成立：条件差一个（i <= n）时只有 i = 200 的那个线程读写到 x 外面；不拦时多派的 56 个都出去', () => {
  const offByOne = attempt({ i: GLOBAL_INDEX })
  assert.deepEqual(offByOne.verdict.earned, [true, false, false])
  const c = checkScale(offByOne.runs[0])
  assert.equal(c.correct, true)
  assert.deepEqual(c.oobWrites, [{ block: 3, thread: 8, index: N }])
  assert.deepEqual(c.oobReads.map((d) => [d.block, d.thread, d.index]), [[3, 8, N]])
  assert.match(offByOne.verdict.next, /block 3 的 8 号线程算出 i = 200.*条件差了一个/)

  const open = attempt({ hip: { i: GLOBAL_INDEX, guard: 'true' }, python: { i: GLOBAL_INDEX, guard: 'True' } })
  assert.deepEqual(open.verdict.earned, [true, false, false])
  const o = checkScale(open.runs[0])
  assert.equal(o.oobWrites.length, THREADS - N)
  assert.equal(o.oobReads.length, THREADS - N)
  assert.doesNotMatch(open.verdict.next, /差了一个/)
})

test('★3：下标写死每组 64 个，换成每组 32 个就有格子没人乘；条件写死 200，换成 100 个数就读写到外面', () => {
  const block64 = attempt({ i: 'blockIdx.x * 64 + threadIdx.x', guard: BEST_GUARD })
  assert.deepEqual(block64.verdict.earned, [true, true, false])
  assert.deepEqual(checkScale(block64.runs[1]).missing, [...Array.from({ length: 32 }, (_, j) => 32 + j), 96, 97, 98, 99])
  assert.match(block64.verdict.next, /^换成每组 32 个线程、100 个数（派 4 组）再跑一次：x\[32\]～x\[63\]、x\[96\]～x\[99\] 没人乘/)

  const n200 = attempt({ i: GLOBAL_INDEX, guard: 'i < 200' })
  assert.deepEqual(n200.verdict.earned, [true, true, false])
  assert.equal(checkScale(n200.runs[1]).oobWrites.length, 28)
  // 换成 300 个数时，x[200]～x[299] 没人乘
  assert.deepEqual(checkScale(n200.runs[2]).missing, Array.from({ length: 100 }, (_, j) => 200 + j))
})

test('参考解三颗星：三种派法下每一格都正好被一个线程乘，多派的线程一次也没读写 x', () => {
  const { verdict, runs } = attempt({ i: GLOBAL_INDEX, guard: BEST_GUARD })
  assert.deepEqual(verdict.earned, [true, true, true])
  for (const r of runs) {
    const c = checkScale(r)
    assert.equal(c.correct, true)
    assert.deepEqual([c.oobReads.length, c.oobWrites.length], [0, 0])
    assert.ok(c.writers.every((w) => w.length === 1))
    assert.deepEqual(r.result.arrays.x, Array.from({ length: c.n }, (_, j) => K * (j + 1)))
  }
  assert.match(valueText(runs[0].result), /都成了原来的 10 倍：x\[0\] = 10，x\[199\] = 2000/)
})

test('代码写错：语法错误照样一颗星都没有，说清第几行', () => {
  for (const lang of LANGS) {
    const result = run(buildRequest(source(lang, { i: 'blockIdx.x *' }), lang, LAUNCH, ARGS))
    const verdict = judge([{ launch: LAUNCH, result }])
    assert.deepEqual(verdict.earned, [false, false, false])
    assert.match(verdict.error.symptom, /^第 \d+ 行第 \d+ 列有语法错误/)
  }
})

test('手机上的 16 种选法：只用 threadIdx.x、忘乘每组人数 0 颗；条件不对 1 颗；写死 64 或 200 两颗；全对三颗', () => {
  const table = BLANKS.i.choices.map((_, a) => BLANKS.guard.choices.hip.map((_, b) => {
    const values = Object.fromEntries(LANGS.map((lang) => [lang, { i: choice(BLANKS.i, lang, a), guard: choice(BLANKS.guard, lang, b) }]))
    return stars(attempt(values).verdict)
  }))
  assert.deepEqual(table, [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 2, 2], [1, 1, 2, 3]])
})

test('两种写法的工作单解析成同一棵语法树（除了位置）', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  for (const values of [{}, { i: GLOBAL_INDEX, guard: BEST_GUARD }]) {
    const [hip, python] = LANGS.map((lang) => parseKernel(source(lang, values), lang))
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(plain(python.kernel), plain(hip.kernel))
  }
})
