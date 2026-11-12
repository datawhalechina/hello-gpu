import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest, stepGroups } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import {
  ARGS, BLANKS, BLOCK, CODE, LAUNCH, NO_WAIT, SYNC_CALL, VARIANTS, VARIANT_BLOCKS, checkScan, judge, prefixOf, roundsFor, scanArgs,
  scanBoard, stepStory, waitsFor,
} from '../../docs/dungeon/prefix-sum/challenge.ts'

/**
 * 副本「前缀和入门」：64 个零件（合格 1、不合格 0）的前缀和，1 组 64 个线程在货架上每轮隔的格数翻倍。
 * 读者改三个空：循环走到哪为止、取之前等不等、取完放之前等不等。判定按事件流数数据竞争、走了几轮、每支小队等了几次；
 * 两种写法的事件流（除了行号）、结果和判定都相同。
 */

const LANGS = ['hip', 'python']

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行。 */
const strip = (result) => ({
  ok: result.ok,
  arrays: result.arrays,
  steps: result.steps,
  diagnostics: result.diagnostics.map((d) => (d.kind === 'race'
    ? { ...d, first: { ...d.first, line: 0 }, second: { ...d.second, line: 0 } }
    : { ...d, line: 0 })),
  events: result.events.map(({ line, ...e }) => e),
})

/** 三个空：stop 是终点，before / between 写 true 表示「等」（同步），false 表示不等；不给就是初始内容。 */
function source(lang, { stop, before, between } = {}) {
  const values = {}
  if (stop !== undefined) values.stop = stop
  if (before !== undefined) values.before = before ? SYNC_CALL[lang] : NO_WAIT[lang]
  if (between !== undefined) values.between = between ? SYNC_CALL[lang] : NO_WAIT[lang]
  return fillTemplate(parseTemplate(CODE[lang]), values).source
}

/** 点一次「运行」：每组 64 个线程那一次 + 换派法的两次（同 Sandbox 的 variants）。两种写法的事件流、结果和判定都相同。 */
function attempt(choice) {
  const launches = [{ launch: LAUNCH, args: ARGS }, ...VARIANTS.map(({ grid, block, args }) => ({ launch: { grid, block }, args }))]
  const [hip, python] = LANGS.map((lang) => launches.map(({ launch, args }) => ({ launch, result: run(buildRequest(source(lang, choice), lang, launch, args)) })))
  hip.forEach((r, k) => assert.deepEqual(strip(python[k].result), strip(r.result)))
  const verdict = judge(hip)
  assert.deepEqual(judge(python), verdict)
  return { verdict, runs: hip }
}

const stars = (verdict) => verdict.earned.filter(Boolean).length
const FIXED = { before: false, between: true }
const BEST = { ...FIXED, stop: 'blockDim.x' }

test('原样运行：取完不等，小队 1 取到小队 0 这一轮已经加过的数，out[32] 起错了 31 个，一颗星都没有', () => {
  const { verdict, runs } = attempt()
  assert.deepEqual(verdict.earned, [false, false, false])
  const c = checkScan(runs[0])
  assert.deepEqual([c.wrong.length, c.wrong[0], c.waits, c.rounds], [31, 32, waitsFor(BLOCK), roundsFor(BLOCK)])
  const r = c.races.stale[0]
  assert.deepEqual([r.index, r.first.thread, r.first.op, r.second.thread, r.second.op], [31, 31, 'write', 32, 'read'])
  assert.match(verdict.error.symptom, /out\[32\] 应该是 23，运行后是 36。线程 32 在第 1 轮取第 31 格的时候，线程 31 这一轮已经把左边的数加进去了/)
  assert.match(verdict.error.cause, /线程 31 在小队 0，模拟器让它先走完这一轮，小队 1 才来取/)
  assert.match(verdict.error.fix, /取完、放之前同步一次/)
})

test('★1：取之前、取完都等，out 都对，可每支小队等了 19 次（每一轮三次），只要 13 次', () => {
  const { verdict, runs } = attempt({ before: true, between: true })
  assert.deepEqual(verdict.earned, [true, false, false])
  const c = checkScan(runs[0])
  assert.deepEqual(c.values, prefixOf(BLOCK))
  assert.deepEqual([c.waits, c.rounds], [1 + 3 * roundsFor(BLOCK), roundsFor(BLOCK)])
  assert.match(verdict.next, /out\[63\] = 46。每支小队等了 19 次，只要等 13 次：取之前那一次是多余的/)
})

test('★2：只在取完、放之前等，每支小队 13 次；终点写死 64，换成每组 128 个线程只走 6 轮，out[64] 起都少加了', () => {
  const { verdict, runs } = attempt(FIXED)
  assert.deepEqual(verdict.earned, [true, true, false])
  assert.equal(checkScan(runs[0]).waits, waitsFor(BLOCK))
  const big = checkScan(runs[1])
  assert.deepEqual([big.block, big.rounds, big.wrong.length, big.wrong[0]], [128, 6, 64, 64])
  assert.match(verdict.next, /换成每组 128 个线程再跑一次，out 有 64 个数不对：比如 out\[64\].*终点是不是写死了/)
  // 每组 32 个线程时多走一轮：数对，可多等两次
  const small = checkScan(runs[2])
  assert.deepEqual([small.wrong.length, small.rounds, small.waits], [0, 6, waitsFor(32) + 2])
})

test('★3：终点写 blockDim.x，三种派法都对、都不多等（64、128、32 个线程各走 6、7、5 轮）', () => {
  const { verdict, runs } = attempt(BEST)
  assert.deepEqual(verdict.earned, [true, true, true])
  runs.forEach((r) => {
    const c = checkScan(r)
    assert.equal(c.correct, true)
    assert.deepEqual(r.result.arrays.out, prefixOf(c.block))
    assert.deepEqual([c.rounds, c.waits], [roundsFor(c.block), waitsFor(c.block)])
  })
  assert.deepEqual(runs.map((r) => r.launch.block), [BLOCK, ...VARIANT_BLOCKS])
})

test('终点写 128：多走一轮（s = 64 那一轮没有线程要取），只有一颗星；写 32：只走 5 轮，out[32] 起少加了，没过', () => {
  const extra = attempt({ ...FIXED, stop: '128' })
  assert.deepEqual(extra.verdict.earned, [true, false, false])
  assert.match(extra.verdict.next, /多走了 1 轮：s = 64 那一轮，t 都小于 s，没有线程要取/)

  const short = attempt({ ...FIXED, stop: '32' })
  assert.deepEqual(short.verdict.earned, [false, false, false])
  const c = checkScan(short.runs[0])
  assert.deepEqual([c.rounds, c.wrong[0], c.races.total], [5, 32, 0])
  assert.match(short.verdict.error.cause, /循环只走了 5 轮：每一格只加到了左边 31 个数，64 个数要走 6 轮/)
})

test('只有一支小队（每组 32 个线程）时取完不等：同一步里先读完再写，out 碰巧都对，照样记下数据竞争、没过', () => {
  const launch = { grid: 1, block: 32 }
  for (const lang of LANGS) {
    const result = run(buildRequest(source(lang, { before: false, between: false, stop: 'blockDim.x' }), lang, launch, scanArgs(32)))
    const c = checkScan({ launch, result })
    assert.deepEqual([c.wrong.length, c.races.stale.length], [0, 0])
    assert.ok(c.races.lucky.length > 0)
    const verdict = judge([{ launch, result }])
    assert.deepEqual(verdict.earned, [false, false, false])
    assert.match(verdict.error.symptom, /碰巧都对，可模拟器在货架上记下 \d+ 处数据竞争/)
  }
})

test('货架板：照着事件流重算的货架和 out 跟模拟器对得上；单步到小队 1 第 1 轮取数那一步，第 31 格标出取到了加过的数', () => {
  const { runs } = attempt()
  const { result } = runs[0]
  const whole = scanBoard(result, LAUNCH, ARGS)
  assert.equal(whole.exact, true)
  assert.deepEqual(whole.out.map((c) => c.value), result.arrays.out)
  assert.equal(whole.out.filter((c) => c.state === 'wrong').length, 31)

  const groups = stepGroups(result.events)
  const take = groups.findIndex((g) => g.wave === 1 && result.events.slice(g.from, g.to).some((e) => e.op === 'load' && e.space === 'lds'))
  const g = groups[take]
  const board = scanBoard(result, LAUNCH, ARGS, g.to, g.from)
  // 取的这一步：小队 1 取第 31～62 格，第 31 格是小队 0 这一轮刚加过的（1 + 1 = 2，本来是 1）
  assert.deepEqual(board.slots.filter((s) => s.taken).map((s) => s.index), Array.from({ length: 32 }, (_, k) => 31 + k))
  assert.deepEqual(board.slots.filter((s) => s.stale).map((s) => s.index), [31])
  assert.equal(board.slots[31].value, 2)
  assert.match(stepStory(result, take), /^小队 1 第 1 轮：32 个线程各取左边隔 1 格的数（第 31～62 格），拿在手上。其中第 31 格这一轮已经被加过了/)

  const best = attempt(BEST).runs[0].result
  const done = scanBoard(best, LAUNCH, ARGS)
  assert.equal(done.exact, true)
  assert.deepEqual(done.slots.map((s) => s.value), prefixOf(BLOCK))
})

test('代码写错：语法错误照样一颗星都没有，说清第几行', () => {
  for (const lang of LANGS) {
    const result = run(buildRequest(fillTemplate(parseTemplate(CODE[lang]), { stop: 'blockDim.' }).source, lang, LAUNCH, ARGS))
    const verdict = judge([{ launch: LAUNCH, result }])
    assert.deepEqual(verdict.earned, [false, false, false])
    assert.match(verdict.error.symptom, /^第 \d+ 行第 \d+ 列有语法错误/)
  }
})

test('手机上的 16 种选法：三颗星只有「终点 blockDim.x、取之前不等、取完放之前等」', () => {
  const choice = (blank, lang, k) => (Array.isArray(blank.choices) ? blank.choices : blank.choices[lang])[k]
  for (const key of ['before', 'between']) assert.equal(BLANKS[key].choices.hip.length, BLANKS[key].choices.python.length)
  const byStars = [[], [], [], []]
  for (const stop of BLANKS.stop.choices) {
    for (let b = 0; b < 2; b++) {
      for (let w = 0; w < 2; w++) {
        const before = choice(BLANKS.before, 'hip', b) === SYNC_CALL.hip
        const between = choice(BLANKS.between, 'hip', w) === SYNC_CALL.hip
        byStars[stars(attempt({ stop, before, between }).verdict)].push(`${stop}|${before ? '等' : '不等'}|${between ? '等' : '不等'}`)
      }
    }
  }
  assert.deepEqual(byStars[3], ['blockDim.x|不等|等'])
  assert.deepEqual(byStars[2], ['64|不等|等'])
  assert.deepEqual(byStars[1], ['64|等|等', '128|等|等', '128|不等|等', 'blockDim.x|等|等'])
  assert.equal(byStars[0].length, 10)
})

test('两种写法的工作单解析成同一棵语法树（除了位置）', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  for (const choice of [undefined, BEST]) {
    const [hip, python] = LANGS.map((lang) => parseKernel(source(lang, choice), lang))
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(plain(python.kernel), plain(hip.kernel))
  }
})
