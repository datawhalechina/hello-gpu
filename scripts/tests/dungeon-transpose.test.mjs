import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import {
  ARGS, BEST_GUARD, BLANKS, CARS, CODE, LAUNCH, ROWS, RUN_SHAPES, SIZE, VARIANTS, checkTranspose, judge, orderCode, placeText,
  sideCars,
} from '../../docs/dungeon/transpose/challenge.ts'

/**
 * 副本「矩阵转置」：9 行 32 列的 a 转置进 b，派 5 组、每组 64 个线程。读者补 r、c 和写入前的条件，搬的那一行是定的。
 * 判定从事件流里配出每个线程读的 a[from]、写的 b[to]，反推它算出的 r、c；车次（模拟）来自 L3 的 analyzeMemory。
 * 两种写法的事件流（除了行号）、结果和判定都相同。
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

/** 读者填的空按 HIP 风格写；Python 风格里整数除法 / 写成 //，true 写成 True。 */
const toPython = (v) => (v === 'true' ? 'True' : v.replace(/ \/ /g, ' // '))

/** 模板按读者填的空拼成代码；不填就是初始内容。 */
function source(lang, values = {}) {
  const filled = lang === 'python' ? Object.fromEntries(Object.entries(values).map(([k, v]) => [k, toPython(v)])) : values
  return fillTemplate(parseTemplate(CODE[lang]), filled).source
}

/** 点一次「运行」：9 × 32 那一次 + 换形状的两次（同 Sandbox 的 variants）。两种写法的事件流、结果和判定都相同。 */
function attempt(values) {
  const launches = [{ launch: LAUNCH, args: ARGS }, ...VARIANTS.map(({ grid, block, args }) => ({ launch: { grid, block }, args }))]
  const [hip, python] = LANGS.map((lang) => launches.map(({ launch, args }) => ({ launch, result: run(buildRequest(source(lang, values), lang, launch, args)) })))
  hip.forEach((r, k) => assert.deepEqual(strip(python[k].result), strip(r.result)))
  const verdict = judge(hip)
  assert.deepEqual(judge(python), verdict)
  return { verdict, runs: hip }
}

const stars = (verdict) => verdict.earned.filter(Boolean).length
const BY_ROW = { r: 'g / C', c: 'g % C' }
const BY_COL = { r: 'g % R', c: 'g / R' }

test('原样运行：r、c 都除以 R，g = 81 起算出的 r 超过 8，读到 a 外面又写进 b，盖掉放对的数，一颗星都没有', () => {
  const { verdict, runs } = attempt({})
  assert.deepEqual(verdict.earned, [false, false, false])
  const c = checkTranspose(runs[0], RUN_SHAPES[0])
  const first = c.strays[0]
  assert.deepEqual([first.g, first.r, first.c, first.from, first.to], [81, 9, 0, SIZE, 9])
  assert.equal(c.strays.every((m) => m.r >= ROWS), true)
  // b[9] 先被 g = 1 放对，又被 g = 81 盖成模拟器越界读到的 0
  assert.equal(c.wrong[0], 9)
  assert.equal(c.values[9], 0)
  assert.match(verdict.error.cause, /block 1 的 17 号线程（g = 81）算出 r = 9、c = 0/)
  assert.match(verdict.error.fix, /a 一行有 C 个数，不是 R 个/)
})

test('两种排法都拿三颗星：顺着 a 排读 a 一车不多搬、写 b 每次 9 车；顺着 b 排反过来，一共都是 90 车，理想 18 车', () => {
  const expected = { a: { firstRead: 1, firstWrite: ROWS, read: 9, write: 81 }, b: { firstRead: ROWS, firstWrite: 1, read: 81, write: 9 } }
  for (const [order, decode] of [['a', BY_ROW], ['b', BY_COL]]) {
    const { verdict, runs } = attempt({ ...decode, guard: BEST_GUARD })
    assert.deepEqual(verdict.earned, [true, true, true], order)
    runs.forEach((r, k) => {
      const c = checkTranspose(r, RUN_SHAPES[k])
      assert.equal(c.correct, true)
      assert.deepEqual([c.strays.length, c.outside.length, c.uncovered.length, c.doubled.length], [0, 0, 0, 0])
      assert.equal(c.idle, true)
    })
    const cars = sideCars(runs[0].result.events)
    assert.deepEqual({ firstRead: cars.firstRead, firstWrite: cars.firstWrite, read: cars.read, write: cars.write }, expected[order])
    // 题解正文的车次（CARS）和模拟器数的一样
    assert.equal(cars.read + cars.write, CARS.total)
    assert.equal(cars.readIdeal + cars.writeIdeal, CARS.ideal)
    assert.equal(Math.max(cars.firstRead, cars.firstWrite), CARS.across)
  }
})

test('题解对比的两份参考解就是这两种排法：和挑战里补对三个空的代码跑出同样的事件流', () => {
  for (const [order, decode] of [['a', BY_ROW], ['b', BY_COL]]) {
    for (const lang of LANGS) {
      const reference = run(buildRequest(orderCode(order)[lang], lang, LAUNCH, ARGS))
      const filled = run(buildRequest(source(lang, { ...decode, guard: BEST_GUARD }), lang, LAUNCH, ARGS))
      assert.deepEqual(strip(reference), strip(filled), `${order} ${lang}`)
    }
  }
})

test('条件：差一个时顺着 a 排的 g = 288 读到 a 外面、盖掉 b[9]，没过；顺着 b 排只写到 b 外面一格，一颗星；只看 r 拦不住顺着 b 排', () => {
  const rowOff = attempt({ ...BY_ROW, guard: 'g <= R * C' })
  assert.deepEqual(rowOff.verdict.earned, [false, false, false])
  const strays = checkTranspose(rowOff.runs[0], RUN_SHAPES[0]).strays
  assert.deepEqual(strays.map((m) => [m.g, m.r, m.c, m.to]), [[SIZE, ROWS, 0, 9]])
  assert.match(rowOff.verdict.error.fix, /条件要拦住多派的线程/)

  const colOff = attempt({ ...BY_COL, guard: 'g <= R * C' })
  assert.deepEqual(colOff.verdict.earned, [true, false, false])
  assert.deepEqual(checkTranspose(colOff.runs[0], RUN_SHAPES[0]).outside.map((m) => [m.g, m.to]), [[SIZE, SIZE]])
  assert.match(colOff.verdict.next, /条件差了一个/)

  const colByR = attempt({ ...BY_COL, guard: 'r < R' })
  assert.deepEqual(colByR.verdict.earned, [true, false, false])
  assert.equal(checkTranspose(colByR.runs[0], RUN_SHAPES[0]).outside.length, 32)
  assert.match(colByR.verdict.next, /拦它们要看 g，不能只看 r/)

  // 顺着 a 排时，多派的线程算出的 r 正好是 R，r < R 拦得住
  assert.deepEqual(attempt({ ...BY_ROW, guard: 'r < R' }).verdict.earned, [true, true, true])
})

test('★3：写死 32 或 288 的代码在 9 × 32 上对，换成 6 行 10 列就露馅', () => {
  const cols32 = attempt({ r: 'g / 32', c: 'g % 32', guard: BEST_GUARD })
  assert.deepEqual(cols32.verdict.earned, [true, true, false])
  assert.equal(checkTranspose(cols32.runs[1], RUN_SHAPES[1]).correct, false)
  assert.match(cols32.verdict.next, /^换成 6 行 10 列（派 2 组、每组 32 个线程）再跑一次，b 里有 \d+ 个数不对。.*有没有写死的数/)

  const size288 = attempt({ ...BY_ROW, guard: 'g < 288' })
  assert.deepEqual(size288.verdict.earned, [true, true, false])
  assert.equal(checkTranspose(size288.runs[1], RUN_SHAPES[1]).correct, false)
})

test('★3：r = g % R、c = g % C 在 9 × 32 上碰巧对（9 和 32 互质），换成 6 行 10 列就有的数搬两次、有的没人搬', () => {
  const crt = attempt({ r: 'g % R', c: 'g % C', guard: BEST_GUARD })
  assert.deepEqual(crt.verdict.earned, [true, true, false])
  const wide = checkTranspose(crt.runs[1], RUN_SHAPES[1])
  assert.equal(wide.strays.length, 0)
  assert.ok(wide.doubled.length > 0 && wide.uncovered.length > 0)
  assert.match(crt.verdict.next, /配不满 a 的每一行、每一列/)
})

test('结果上面那一行：原样运行写搬对了几个、哪一格不对；参考解写都搬对了', () => {
  const initial = attempt({}).runs[0].result
  assert.match(placeText(initial), /搬对了 9 个，279 个不对。比如 b\[9\] 该是 2，现在是 0/)
  const solved = attempt({ ...BY_ROW, guard: BEST_GUARD }).runs[0].result
  assert.match(placeText(solved), /^b 的 288 个数都搬对了/)
})

test('代码写错：语法错误照样一颗星都没有，说清第几行', () => {
  for (const lang of LANGS) {
    const result = run(buildRequest(source(lang, { r: 'g /' }), lang, LAUNCH, ARGS))
    const verdict = judge([{ launch: LAUNCH, result }])
    assert.deepEqual(verdict.earned, [false, false, false])
    assert.match(verdict.error.symptom, /^第 \d+ 行第 \d+ 列有语法错误/)
  }
})

test('手机上的 64 种选法：三颗星只有顺着 a 排（条件 g < R * C 或 r < R）和顺着 b 排（条件 g < R * C）', () => {
  // Python 风格的选项和 HIP 风格按位置对应：/ 写成 //，true 写成 True
  for (const key of ['r', 'c', 'guard']) assert.deepEqual(BLANKS[key].choices.python, BLANKS[key].choices.hip.map(toPython), key)
  const three = []
  const count = [0, 0, 0, 0]
  for (const r of BLANKS.r.choices.hip) {
    for (const c of BLANKS.c.choices.hip) {
      for (const guard of BLANKS.guard.choices.hip) {
        const n = stars(attempt({ r, c, guard }).verdict)
        count[n]++
        if (n === 3) three.push(`${r} | ${c} | ${guard}`)
      }
    }
  }
  assert.deepEqual(three, ['g / C | g % C | g < R * C', 'g / C | g % C | r < R', 'g % R | g / R | g < R * C'])
  assert.deepEqual(count, [54, 3, 4, 3])
})

test('两种写法的工作单解析成同一棵语法树（除了位置）', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  for (const values of [{}, { ...BY_ROW, guard: BEST_GUARD }, { ...BY_COL, guard: BEST_GUARD }]) {
    const [hip, python] = LANGS.map((lang) => parseKernel(source(lang, values), lang))
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(plain(python.kernel), plain(hip.kernel))
  }
})
