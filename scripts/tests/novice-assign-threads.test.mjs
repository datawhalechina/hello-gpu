import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import {
  CHALLENGE_N, DEFAULT_THREADS, EXPLORE_LAUNCH, EXPLORE_N, LOOP_CODE, LOOP_N, LOOP_THREADS, OWN_CELL_BLANKS, OWN_CELL_CODE,
  THREAD_CHOICES, VARIANT_N, addArgs, challengeLaunch, challengeVariants, checkCells, judge, judgeOwnCell, normalizeThreads,
} from '../../docs/novice/assign-threads/challenge.ts'
import { run } from '../../docs/sim/lockstep.ts'
import { parse } from '../../docs/sim/syntax/index.ts'

/** 1-3 给线程派活：循环原样搬进 kernel、认领自己的一格、挑战的三颗星（两种写法结果相同）。 */

const LANGS = ['hip', 'python']
const sumOf = (n) => Array.from({ length: n }, (_, k) => 11 * (k + 1))

function source(lang, i) {
  return fillTemplate(parseTemplate(OWN_CELL_CODE[lang]), { i }).source
}

/** 沙盒点一次「运行」做的事：读者设的那一次，代码没出错再按 variants 各跑一次（带了 args 就换数据）。 */
function sandboxRuns(code, lang, launch, args, variants = []) {
  const main = { launch, result: run(buildRequest(code, lang, launch, args)) }
  if (!main.result.ok) return [main]
  return [main, ...variants.map(({ args: own, ...change }) => {
    const config = { ...launch, ...change }
    return { launch: config, result: run(buildRequest(code, lang, config, own ?? args)) }
  })]
}

/** 两种写法跑同一份代码：结果、越界区、步数、事件逐项相同（事件只差行号：Python 多一行 @kernel）。 */
function bothLangs(runsOf) {
  const [hip, python] = LANGS.map(runsOf)
  const strip = (runs) => runs.map(({ launch, result }) => ({
    launch,
    ok: result.ok,
    arrays: result.arrays,
    outside: result.outside.map((o) => ({ ...o, writes: o.writes.map(({ line, ...w }) => w) })),
    diagnostics: result.diagnostics.length,
    steps: result.steps,
    events: result.events.map(({ line, ...e }) => e),
  }))
  assert.deepEqual(strip(python), strip(hip))
  return { hip, python }
}

/** 探索二：两种写法跑出来逐项相同，判定也相同。 */
function exploreBoth(i) {
  const { hip, python } = bothLangs((lang) => sandboxRuns(source(lang, i), lang, EXPLORE_LAUNCH, addArgs(EXPLORE_N)))
  const verdict = judgeOwnCell(hip)
  assert.deepEqual(judgeOwnCell(python), verdict)
  return { verdict, result: hip[0].result }
}

/** 挑战：读者设的 12 个数，加上 variants 的 20 个数；两种写法跑出来逐项相同，判星也相同。 */
function challengeBoth(i, choice) {
  const { hip, python } = bothLangs((lang) => sandboxRuns(source(lang, i), lang, challengeLaunch(choice), addArgs(CHALLENGE_N), challengeVariants(choice)))
  const verdict = judge(hip)
  assert.deepEqual(judge(python), verdict)
  return { verdict, runs: hip }
}

test('热身和探索一：循环原样写进 kernel，结果对，可派几个线程每格就被算几遍', () => {
  for (const threads of LOOP_THREADS) {
    const runs = bothLangs((lang) => sandboxRuns(LOOP_CODE[lang], lang, { grid: 1, block: threads }, addArgs(LOOP_N))).hip
    const check = checkCells(runs[0])
    assert.equal(check.correct, true, `派 ${threads} 个`)
    assert.deepEqual(check.writers, new Array(LOOP_N).fill(threads), `派 ${threads} 个`)
    assert.deepEqual(check.outside, [])
  }
})

test('探索二：只有 threadIdx.x 让 8 个线程各算一格；手机上的每个选项两种写法都能跑', () => {
  const passed = OWN_CELL_BLANKS.i.choices.filter((i) => exploreBoth(i).verdict.earned[0])
  assert.deepEqual(passed, ['threadIdx.x'])
  const right = exploreBoth('threadIdx.x')
  assert.deepEqual(right.result.arrays.c, sumOf(EXPLORE_N))
  assert.equal(right.verdict.error, undefined)
})

test('探索二没过：说清是大家挤一格，还是错开了一格', () => {
  const same = exploreBoth('0').verdict
  assert.deepEqual(same.earned, [false, false, false])
  assert.equal(same.error.symptom, '8 个线程都算了 c[0]，另外 7 格没人算。')
  assert.match(same.error.cause, /固定的数/)
  assert.match(same.error.fix, /threadIdx\.x/)
  const shifted = exploreBoth('threadIdx.x + 1').verdict
  assert.equal(shifted.error.symptom, '1 个数没人算：c[0]；另外 1 个线程写到了数组外面。')
  assert.match(shifted.error.cause, /没有从 0 开始/)
  const spread = exploreBoth('threadIdx.x * 2').verdict
  assert.match(spread.error.symptom, /^4 个数没人算：c\[1\]、c\[3\]、c\[5\]、c\[7\]；另外 4 个线程写到了数组外面。$/)
})

test('挑战 ★1：初始代码大家挤一格；下标对了线程不够时，说的是线程不够', () => {
  const start = challengeBoth('0', DEFAULT_THREADS)
  assert.deepEqual(start.verdict.earned, [false, false, false])
  assert.equal(start.verdict.error.symptom, `${DEFAULT_THREADS} 个线程都算了 c[0]，另外 ${CHALLENGE_N - 1} 格没人算。`)
  assert.equal(start.verdict.error.raw, `运行后 c = [${start.runs[0].result.arrays.c.join(', ')}]`)
  const few = challengeBoth('threadIdx.x', 8).verdict
  assert.deepEqual(few.earned, [false, false, false])
  assert.equal(few.error.symptom, '4 个数没人算：c[8]～c[11]。')
  assert.match(few.error.cause, /只派了 8 个线程/)
  assert.match(few.error.fix, /数据有几个，就派几个/)
  // 线程够了、下标错开一格：说的是下标，不是线程
  const shifted = challengeBoth('threadIdx.x + 1', 16).verdict
  assert.deepEqual(shifted.earned, [false, false, false])
  assert.match(shifted.error.cause, /没有从 0 开始/)
})

test('挑战 ★2：多派的线程照着工作单写到了数组外面，结果却是对的；没写到外面、只是多派了也不行', () => {
  const { verdict, runs } = challengeBoth('threadIdx.x', 16)
  assert.deepEqual(verdict.earned, [true, false, false])
  assert.deepEqual(runs[0].result.arrays.c, sumOf(CHALLENGE_N))
  assert.deepEqual(runs[0].result.outside.map((o) => [o.array, o.index]), [['c', 12], ['c', 13], ['c', 14], ['c', 15]])
  assert.match(verdict.next, /^派出了 16 个线程，只有 12 个数：多出来的 4 个线程照着工作单写到了 c\[12\]～c\[15\]/)
  // 绕回来算的 4 个线程没有越界，可活是重复的：★2 要的是派的线程刚好够用
  const wrapped = challengeBoth('threadIdx.x % 12', 16).verdict
  assert.deepEqual(wrapped.earned, [true, false, false])
  assert.match(wrapped.next, /有 4 个线程的活是重复的/)
})

test('挑战 ★3：真的换成 20 个数再跑；派法写死 12、下标写死 12 都不行', () => {
  const fixed = challengeBoth('threadIdx.x', 12)
  assert.deepEqual(fixed.verdict.earned, [true, true, false])
  assert.equal(fixed.runs[1].result.arrays.c.length, VARIANT_N)
  assert.equal(fixed.runs[1].launch.block, 12)
  assert.match(fixed.verdict.next, /还是只派 12 个线程，c\[12\]～c\[19\] 没人算。派法选 n/)
  const hardcoded = challengeBoth('11 - threadIdx.x', 'n').verdict
  assert.deepEqual(hardcoded.earned, [true, true, false])
  assert.match(hardcoded.next, /派了 20 个线程，可 c\[12\]～c\[19\] 没人算：i 里是不是写死了 12/)
})

test('挑战：选 n、i 写成 threadIdx.x（倒着认领也行），两种写法都拿满三颗星', () => {
  for (const i of ['threadIdx.x', 'n - 1 - threadIdx.x']) {
    const { verdict, runs } = challengeBoth(i, 'n')
    assert.deepEqual(verdict.earned, [true, true, true], i)
    assert.deepEqual(runs.map((r) => r.launch.block), [CHALLENGE_N, VARIANT_N], i)
    assert.deepEqual(runs[1].result.arrays.c, sumOf(VARIANT_N), i)
  }
})

test('两种写法的工作单解析成同一棵语法树（除了位置）', () => {
  const strip = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  for (const [hipSource, pySource] of [[LOOP_CODE.hip, LOOP_CODE.python], [source('hip', 'threadIdx.x'), source('python', 'threadIdx.x')]]) {
    const hip = parse(hipSource, 'hip')
    const python = parse(pySource, 'python')
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(strip(python.kernel), strip(hip.kernel))
  }
})

test('草稿里的派法坏了或是旧的：回到默认的 8 个', () => {
  for (const choice of THREAD_CHOICES) assert.equal(normalizeThreads(choice), choice)
  for (const raw of [undefined, null, '12', 20, 'N', { threads: 12 }]) assert.equal(normalizeThreads(raw), DEFAULT_THREADS)
})
