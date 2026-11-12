import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import { prepareWave, usage } from '../../docs/components/kit/wave-view/model.ts'
import {
  CHALLENGE_BLANKS, CHALLENGE_CODE, CHALLENGE_LAUNCH, CHALLENGE_N, FORK_CODE, FORK_LAUNCH, FORK_TEMPLATE, STEP_LAUNCH,
  VARIANTS, WAVE, WIDE_N, forkRows, forkText, jobArgs, judge, judgeFork, laneRate,
} from '../../docs/novice/divergence/challenge.ts'

/**
 * 1-6 分岔路口。两张工作单都是「条件成立的线程做加法（写 c），不成立的做减法（写 d）」：
 * 探索一单步看一支小队怎样先后走完两段，探索二改条件看哪支小队分岔，挑战补 k 和条件判三颗星。
 * 两种写法的同一个程序：事件流（除了行号）、结果和判定都相同。
 */

const LANGS = ['hip', 'python']
const fill = (n, value) => new Array(n).fill(value)
const sums = (n) => Array.from({ length: n }, (_, k) => 11 * (k + 1))
const diffs = (n) => Array.from({ length: n }, (_, k) => -9 * (k + 1))

/** 模板按读者填的内容拼成代码；HIP 和 Python 的整除写法不一样时分开给。 */
function source(template, lang, values = {}) {
  const own = Object.fromEntries(Object.entries(values).map(([name, v]) => [name, typeof v === 'string' ? v : v[lang]]))
  return fillTemplate(parseTemplate(template[lang]), own).source
}

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行。 */
const strip = ({ result }) => ({
  ok: result.ok,
  arrays: result.arrays,
  steps: result.steps,
  events: result.events.map(({ line, ...e }) => e),
})

/** 和沙盒一样跑一次：先按 launch 跑，代码没出错再按 variants 各跑一次。两种写法的事件流（除了行号）和结果相同。 */
function sandbox(template, values, launch, args, variants = []) {
  const byLang = LANGS.map((lang) => {
    const code = source(template, lang, values)
    const main = { launch, result: run(buildRequest(code, lang, launch, args)) }
    const runs = [main]
    if (main.result.ok) {
      for (const { args: own, ...change } of variants) {
        const config = { ...launch, ...change }
        runs.push({ launch: config, result: run(buildRequest(code, lang, config, own ?? args)) })
      }
    }
    return runs
  })
  assert.deepEqual(byLang[1].map(strip), byLang[0].map(strip))
  return byLang
}

/** 探索二：64 个线程、c 和 d 各 64 格，只改条件。两种写法判定相同。 */
function fork(cond) {
  const [hip, python] = sandbox(FORK_TEMPLATE, { cond }, FORK_LAUNCH, jobArgs(FORK_LAUNCH.block))
  const verdict = judgeFork(hip)
  assert.deepEqual(judgeFork(python), verdict)
  return { verdict, main: hip[0] }
}

/** 挑战点一次「运行」：32 个和、32 个差，再按 VARIANTS 换成 64 个和、64 个差。两种写法判定相同。 */
function challenge(values) {
  const [hip, python] = sandbox(CHALLENGE_CODE, values, CHALLENGE_LAUNCH, jobArgs(CHALLENGE_N), VARIANTS)
  const verdict = judge(hip)
  assert.deepEqual(judge(python), verdict)
  return { verdict, runs: hip }
}

const PARITY = { k: { hip: 't / 2', python: 't // 2' }, job: 't % 2 == 0' }
/** 每支小队整队走一边的写法：前 n 个线程做加法，k 就是 t；后 n 个做减法，k = t − n。 */
const HALVES = { k: 't % n', job: 't < n' }

/** 一支小队走过的步：[行, 类别, 掩码]。 */
const trace = (r) => prepareWave(r.result, r.launch).steps.map((s) => [s.line, s.kind, s.mask])

test('探索一：一支小队走到 if/else，判断以后先走加法那一段、再走减法那一段，各有一半 lane 空转，利用率 75%', () => {
  const [hip, python] = sandbox(FORK_CODE, {}, STEP_LAUNCH, jobArgs(STEP_LAUNCH.block)).map((runs) => runs[0])
  const all = '1'.repeat(WAVE)
  const even = '10'.repeat(WAVE / 2)
  const odd = '01'.repeat(WAVE / 2)
  assert.deepEqual(trace(hip), [[2, 'stmt', all], [3, 'branch', all], [4, 'stmt', even], [6, 'stmt', odd]])
  assert.deepEqual(trace(python), [[3, 'stmt', all], [4, 'branch', all], [5, 'stmt', even], [7, 'stmt', odd]])
  // 偶数号写了自己的和，奇数号写了自己的差；另一排的那一格没人动
  const t = Array.from({ length: WAVE }, (_, k) => k)
  assert.deepEqual(hip.result.arrays.c, t.map((k) => (k % 2 === 0 ? 11 * (k + 1) : 0)))
  assert.deepEqual(hip.result.arrays.d, t.map((k) => (k % 2 === 1 ? -9 * (k + 1) : 0)))
  // 正文：4 步 × 32 个 lane，干活的 32 + 32 + 16 + 16 = 96 个
  const u = usage(prepareWave(hip.result, hip.launch))
  assert.deepEqual([u.steps, u.active, u.lanes], [4, 96, 128])
  assert.equal(laneRate(hip), 0.75)
  assert.equal(forkText(forkRows(hip), laneRate(hip)), '这支小队在岔路口分成两拨：16 个做加法、16 个做减法。lane 利用率 75%（模拟）。')
})

test('探索二：同一支小队意见不一致才分岔；岔路口落在两支小队中间时两段各走一支，利用率 100%', () => {
  const cases = {
    // 条件 → 每支小队 [做加法几个, 做减法几个, 走了几步]，整段步数，利用率
    't % 2 == 0': { rows: [[16, 16, 4], [16, 16, 4]], steps: 8, rate: 0.75 },
    't < 16': { rows: [[16, 16, 4], [0, 32, 3]], steps: 7, rate: 192 / 224 },
    't < 32': { rows: [[32, 0, 3], [0, 32, 3]], steps: 6, rate: 1 },
    't < 48': { rows: [[32, 0, 3], [16, 16, 4]], steps: 7, rate: 192 / 224 },
  }
  for (const [cond, want] of Object.entries(cases)) {
    const { main } = fork(cond)
    const rows = forkRows(main)
    assert.deepEqual(rows.map((r) => [r.adds, r.subs, r.steps]), want.rows, cond)
    assert.deepEqual(rows.map((r) => r.split), want.rows.map(([a, s]) => a > 0 && s > 0), cond)
    assert.deepEqual(rows.map((r) => [r.first, r.last]), [[0, 31], [32, 63]], cond)
    assert.equal(prepareWave(main.result, main.launch).steps.length, want.steps, cond)
    assert.equal(laneRate(main), want.rate, cond)
  }
  // 正文里 t < 16 的那组数：7 步、224 个 lane，干活 192 个，85.7%
  assert.equal(forkText(forkRows(fork('t < 16').main), 192 / 224), '第 0 支在岔路口分成两拨：16 个做加法、16 个做减法；第 1 支全做减法，没有分岔。lane 利用率 85.7%（模拟）。')
  assert.equal(forkText(forkRows(fork('t < 32').main), 1), '2 支小队都没有分岔：第 0 支全做加法，第 1 支全做减法。lane 利用率 100%（模拟）。')
})

test('探索二的判定：两支都不分岔、两种活都有人做才算过；没过时说清是哪支分岔、还是有一种活没人做', () => {
  for (const cond of ['t < 32', 't >= 32', { hip: 't / 32 == 1', python: 't // 32 == 1' }]) {
    const { verdict } = fork(cond)
    assert.deepEqual(verdict.earned, [true, false, false], JSON.stringify(cond))
    assert.equal(verdict.error, undefined)
  }
  const parity = fork('t % 2 == 0').verdict
  assert.deepEqual(parity.earned, [false, false, false])
  assert.equal(parity.error.symptom, '2 支小队都在岔路口分成了两拨，lane 利用率 75%（模拟）。')
  assert.match(parity.error.cause, /第 0 支 16 个成立、16 个不成立，第 1 支 16 个成立、16 个不成立/)
  // 只有第 1 支分岔：只点它的名
  const late = fork('t < 48').verdict
  assert.deepEqual(late.earned, [false, false, false])
  assert.equal(late.error.symptom, '第 1 支小队在岔路口分成了两拨，lane 利用率 85.7%（模拟）。')
  // 整组都走一边：没有分岔，可减法没人做
  const all = fork('t < 64').verdict
  assert.deepEqual(all.earned, [false, false, false])
  assert.equal(all.error.symptom, '没有小队分岔，可减法没人做。')
  assert.match(all.error.cause, /else 那一边整段跳过/)
  // 代码出错：说清哪一行出错、为什么（Python 多一行 @kernel，行号差 1）
  const broken = sandbox(FORK_TEMPLATE, { cond: { hip: 't / 0 == 0', python: 't // 0 == 0' } }, FORK_LAUNCH, jobArgs(FORK_LAUNCH.block))
  broken.forEach((runs, i) => {
    const verdict = judgeFork(runs)
    assert.deepEqual(verdict.earned, [false, false, false])
    assert.equal(verdict.error.symptom, `运行到第 ${3 + i} 行第 13 列时出错，程序停下了。`)
    assert.equal(verdict.next, '把除数换成不是 0 的数。')
  })
})

test('挑战 ★1：和、差没算对时一颗星都没有，按条件、k 越界、k 重复的顺序说清原因', () => {
  // 条件改了、k 没跟着改：做加法的 32 个线程只算到 c[0]～c[15]，每格两个
  const halfK = challenge({ k: PARITY.k, job: 't < n' }).verdict
  assert.deepEqual(halfK.earned, [false, false, false])
  assert.equal(halfK.error.symptom, '16 个和没人算：c[16]～c[31]；16 个差没人算：d[0]～d[15]。')
  assert.equal(halfK.error.cause, '做加法的 32 个线程算出的 k 只有 16 种（0～15）：有的格子几个线程都算，有的格子没人算。')
  assert.equal(halfK.next, '改 k：让做加法的 32 个线程正好分到 c[0]～c[31]，一人一格。')
  // k = t：做减法的线程写到 d 外面
  const raw = challenge({ k: 't', job: 't < n' }).verdict
  assert.deepEqual(raw.earned, [false, false, false])
  assert.equal(raw.error.symptom, '32 个差没人算：d[0]～d[31]；有 32 次写到了 c、d 外面。')
  assert.equal(raw.error.cause, '做减法的线程算出的 k 是 32～63，可 d 只有 32 格（d[0]～d[31]）。')
  // 做加法的人数不对：先改条件
  const few = challenge({ k: 't % 32', job: 't < 16' }).verdict
  assert.deepEqual(few.earned, [false, false, false])
  assert.equal(few.error.symptom, '16 个和没人算：c[16]～c[31]。')
  assert.equal(few.error.cause, '做加法的线程有 16 个，做减法的有 48 个；可和、差各 32 个，一个线程只算一格。')
  assert.equal(few.error.fix, '改条件：让正好 32 个线程做加法，另外 32 个做减法。')
  assert.match(few.error.raw, /^运行后\nc = \[11, 22, .*\]\nd = \[-9, -18, .*\]$/)
})

test('挑战 ★2：默认写法算对了，可两支小队都在岔路口分成两拨，利用率 80%', () => {
  const { verdict, runs } = challenge(PARITY)
  assert.deepEqual(verdict.earned, [true, false, false])
  assert.deepEqual(runs[0].result.arrays.c, sums(CHALLENGE_N))
  assert.deepEqual(runs[0].result.arrays.d, diffs(CHALLENGE_N))
  // 每支小队：算 t、算 k、判断、加法 16 个、减法 16 个，一共 5 步
  assert.deepEqual(forkRows(runs[0]).map((r) => [r.adds, r.subs, r.steps, r.split]), [[16, 16, 5, true], [16, 16, 5, true]])
  assert.equal(laneRate(runs[0]), 0.8)
  assert.equal(verdict.next, '2 支小队都在岔路口分成了两拨，lane 利用率 80%（模拟）。让同一支小队的线程做同一种活：岔路口要落在两支小队的交界上。改了条件，k 也要跟着改。')
})

test('挑战 ★3：真的换成 64 个和、64 个差再跑一次；写死了 32 的只到两颗星', () => {
  const fixed = challenge({ k: 't % 32', job: 't < 32' })
  assert.deepEqual(fixed.runs.map((r) => r.launch), [CHALLENGE_LAUNCH, { grid: 1, block: 2 * WIDE_N }])
  assert.deepEqual(fixed.verdict.earned, [true, true, false])
  assert.match(fixed.verdict.next, /^换成 64 个和、64 个差就不对了：32 个和没人算：c\[32\]～c\[63\]；32 个差没人算：d\[32\]～d\[63\]。/)
  assert.match(fixed.verdict.next, /多半是哪里写死了 32：换成 n。$/)
  // 没有换数据那一次，判不了 ★3
  assert.deepEqual(judge(fixed.runs.slice(0, 1)).earned, [true, true, false])
  for (const values of [HALVES, { k: 't % n', job: 't >= n' }]) {
    const { verdict, runs } = challenge(values)
    assert.deepEqual(verdict.earned, [true, true, true], JSON.stringify(values))
    assert.deepEqual(runs[1].result.arrays.c, sums(WIDE_N))
    assert.deepEqual(runs[1].result.arrays.d, diffs(WIDE_N))
    // 64 个和、64 个差：4 支小队，两支整队做一种活
    assert.deepEqual(forkRows(runs[1]).map((r) => r.split), fill(4, false))
    assert.equal(laneRate(runs[0]), 1)
    assert.equal(laneRate(runs[1]), 1)
  }
  assert.equal(challenge(HALVES).verdict.next,
    '两批数据都算对了：32 个和、32 个差时 2 支小队，64 个和、64 个差时 4 支，每支都只走一边，lane 利用率都是 100%（模拟）。三颗星的标准都达到了。')
})

test('挑战：手机上的选项两两组合，只有默认写法停在一颗星，写死 32 的停在两颗，k = t % n 配 t < n 或 t >= n 拿满三颗', () => {
  const reached = { 0: [], 1: [], 2: [], 3: [] }
  const { k, job } = CHALLENGE_BLANKS
  k.choices.hip.forEach((hipK, i) => {
    for (const cond of job.choices) {
      const { earned } = challenge({ k: { hip: hipK, python: k.choices.python[i] }, job: cond }).verdict
      reached[earned.filter(Boolean).length].push(`${hipK} | ${cond}`)
    }
  })
  assert.deepEqual(reached[1], ['t / 2 | t % 2 == 0'])
  assert.deepEqual(reached[2], ['t % 32 | t < 32', 't % 32 | t < n', 't % 32 | t >= n', 't % n | t < 32'])
  assert.deepEqual(reached[3], ['t % n | t < n', 't % n | t >= n'])
  assert.equal(reached[0].length, 18)
})

test('两种写法的两张工作单解析成同一棵语法树（除了位置）', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  for (const [template, values] of [[FORK_TEMPLATE, {}], [CHALLENGE_CODE, {}], [CHALLENGE_CODE, HALVES]]) {
    const [hip, python] = LANGS.map((lang) => parseKernel(source(template, lang, values), lang))
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(plain(python.kernel), plain(hip.kernel))
  }
})
