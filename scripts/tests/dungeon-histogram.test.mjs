import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest, stepGroups } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import {
  ARGS, BLANKS, BLOCK_COUNTS, CLEARS, CODE, COUNTS, EXPECTED, FEWEST, LAUNCH, MERGES, MERGE_CAP, PIXELS, addTable, checkHistogram,
  histText, judge,
} from '../../docs/dungeon/histogram/challenge.ts'

/**
 * 副本「直方图」：16 × 16 的小图，4 组、每组 64 个线程数 8 档亮度。读者补三个空：清零、数、合并。
 * 判定按事件流数往 hist、货架上原子加了几次，找普通加、组和组之间的冲突、没清零就用的格子；
 * 两种写法的事件流（除了行号）、结果和判定都相同。
 */

const LANGS = ['hip', 'python']

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行。 */
const strip = (result) => ({
  ok: result.ok,
  arrays: result.arrays,
  steps: result.steps,
  outside: result.outside.map((o) => ({ ...o, writes: o.writes.map(({ line, ...w }) => w) })),
  diagnostics: result.diagnostics.map((d) => (d.kind === 'race'
    ? { ...d, first: { ...d.first, line: 0 }, second: { ...d.second, line: 0 } }
    : { ...d, line: 0 })),
  events: result.events.map(({ line, ...e }) => e),
})

/** 三个空各选第几种写法（CLEARS / COUNTS / MERGES 的下标，两种写法按位置对应）；不给就是初始内容。 */
const pick = (lang, { clear = 0, count = 0, merge = 0 } = {}) => ({ clear: CLEARS[lang][clear], count: COUNTS[lang][count], merge: MERGES[lang][merge] })
const source = (lang, choice) => fillTemplate(parseTemplate(CODE[lang]), pick(lang, choice)).source

/** 点一次「运行」：两种写法各跑一次，事件流、结果和判定都相同。edit 可以再改一下拼好的代码（完整模式里的写法）。 */
function attempt(choice, edit = (src) => src) {
  const [hip, python] = LANGS.map((lang) => ({ launch: LAUNCH, result: run(buildRequest(edit(source(lang, choice), lang), lang, LAUNCH, ARGS)) }))
  assert.deepEqual(strip(python.result), strip(hip.result))
  const verdict = judge([hip])
  assert.deepEqual(judge([python]), verdict)
  return { verdict, run: hip }
}

const stars = (verdict) => verdict.earned.filter(Boolean).length
const ATOMIC_HIST = { clear: 0, count: 1, merge: 0 }
const SHELF_ALL = { clear: 2, count: 3, merge: 2 }
const BEST = { clear: 2, count: 3, merge: 3 }

test('原样运行：普通加让同一支小队里同一档的线程只留下一个，hist[5] 只数到 3 个（该是 56），一颗星都没有', () => {
  const { verdict, run: r } = attempt()
  assert.deepEqual(verdict.earned, [false, false, false])
  const c = checkHistogram(r)
  assert.equal(c.crowdedHist, true)
  assert.equal(c.globalAdds, 0)
  assert.deepEqual([c.values[5], EXPECTED[5]], [3, 56])
  assert.match(verdict.error.symptom, /hist\[5\] 应该是 56，运行后是 3/)
  assert.match(verdict.error.cause, /hist 上用的是普通加.*写回去只留下一个/)
  assert.match(verdict.error.fix, /atomicAdd\(&hist\[a\[i\]\], 1\).*atomic_add\(hist, a\[i\], 1\)/)
  assert.match(histText(r.result), /数对了 0 档；hist 前一共排了 0 次队/)
})

test('★1：每个像素直接往 hist 原子加，8 档都对，可 hist 前排了 256 次队，每组往每一档加的次数就是这一组这一档的像素数', () => {
  const { verdict, run: r } = attempt(ATOMIC_HIST)
  assert.deepEqual(verdict.earned, [true, false, false])
  const c = checkHistogram(r)
  assert.deepEqual(c.values, [...EXPECTED])
  assert.equal(c.globalAdds, PIXELS)
  assert.deepEqual(c.adds, BLOCK_COUNTS.map((row) => [...row]))
  assert.match(verdict.next, /hist 前一共排了 256 次队.*hist\[5\] 前就排了 56 个/)
})

test('★2：先在货架上数、每组每档合并一次，hist 前只排 32 次队；block 0 只有 6、7 两档，另外 6 档加的是 0', () => {
  const { verdict, run: r } = attempt(SHELF_ALL)
  assert.deepEqual(verdict.earned, [true, true, false])
  const c = checkHistogram(r)
  assert.deepEqual([c.globalAdds, c.shelfAdds], [MERGE_CAP, PIXELS])
  assert.ok(c.adds.every((row) => row.every((n) => n === 1)))
  assert.deepEqual(c.wasted.filter((w) => w.block === 0).map((w) => w.level), [0, 1, 2, 3, 4, 5])
  assert.equal(c.wasted.length, MERGE_CAP - FEWEST)
  assert.match(verdict.next, /block 0 管的 4 行只有 6、7 档：hist\[0～5\] 加的都是 0，白排了 6 次队/)
})

test('★3：只合并数到的档，hist 前只排 11 次队，一次也没白排', () => {
  const { verdict, run: r } = attempt(BEST)
  assert.deepEqual(verdict.earned, [true, true, true])
  const c = checkHistogram(r)
  assert.deepEqual(c.values, [...EXPECTED])
  assert.deepEqual([c.globalAdds, c.wasted.length, c.unzeroed.length, c.races.length], [FEWEST, 0, 0, 0])
  assert.deepEqual(c.adds, BLOCK_COUNTS.map((row) => row.map((n) => (n ? 1 : 0))))
})

test('货架没清零：模拟器里货架一开始是 0，8 档碰巧都对，照样一颗星都没有，说清是哪个线程往哪一格上加', () => {
  const { verdict, run: r } = attempt({ ...SHELF_ALL, clear: 0 })
  assert.deepEqual(verdict.earned, [false, false, false])
  const c = checkHistogram(r)
  assert.deepEqual(c.values, [...EXPECTED])
  assert.deepEqual(c.unzeroed[0], { block: 0, thread: 0, index: 6, op: 'atomic' })
  assert.match(verdict.error.symptom, /碰巧都对，可货架没清零就用了：block 0 的线程 0 往 box\[6\] 上加的时候/)
  assert.match(verdict.error.cause, /真卡上货架不会自己清零/)
  // 只往 hist 上加、合并时读了没清零的 box，也算用了没清零的格子
  const read = attempt({ ...ATOMIC_HIST, merge: 3 })
  assert.deepEqual(read.verdict.earned, [false, false, false])
  assert.match(read.verdict.error.symptom, /读 box\[0\] 的时候/)
})

test('合并用普通加：组一个接一个跑，模拟器里碰巧都加上了，可组和组之间有数据竞争，没过', () => {
  const { verdict, run: r } = attempt({ ...SHELF_ALL, merge: 1 })
  assert.deepEqual(verdict.earned, [false, false, false])
  const c = checkHistogram(r)
  assert.deepEqual(c.values, [...EXPECTED])
  assert.ok(c.races.length > 0 && c.races.every((d) => d.space === 'global' && d.scope === 'grid'))
  assert.match(verdict.error.cause, /组和组之间没有同步/)
})

test('合并写成 hist[t] = box[t]：后写的组盖掉前面组的数，hist 正好是 block 3 自己数的', () => {
  const store = (src, lang) => src.replace(lang === 'hip' ? 'hist[t] += box[t];' : 'hist[t] += box[t]', lang === 'hip' ? 'hist[t] = box[t];' : 'hist[t] = box[t]')
  const { verdict, run: r } = attempt({ ...SHELF_ALL, merge: 1 }, store)
  assert.deepEqual(verdict.earned, [false, false, false])
  const c = checkHistogram(r)
  assert.deepEqual(c.values, [...BLOCK_COUNTS[3]])
  assert.equal(c.overwrites, true)
  assert.match(verdict.error.symptom, /hist 正好是最后一组 block 3 自己数的/)
  assert.match(verdict.error.cause, /后写的组把前面组的数盖掉了/)
})

test('只在货架上数、不合并：hist 一次也没加过；货架上普通加：同一档只留下一个', () => {
  const lost = attempt({ clear: 2, count: 3, merge: 0 })
  assert.deepEqual(lost.verdict.earned, [false, false, false])
  assert.match(lost.verdict.error.symptom, /hist 的 8 档都是 0：hist 一次也没加过/)
  assert.match(lost.verdict.error.fix, /atomicAdd\(&hist\[t\], box\[t\]\)/)

  const plain = attempt({ clear: 2, count: 2, merge: 2 })
  assert.deepEqual(plain.verdict.earned, [false, false, false])
  assert.equal(checkHistogram(plain.run).crowdedShelf, true)
  assert.match(plain.verdict.error.cause, /货架上用的是普通加/)
})

test('清零写成 box[t] = 0：每组线程 8～63 写到货架外面，没过', () => {
  const { verdict, run: r } = attempt({ ...BEST, clear: 1 })
  assert.deepEqual(verdict.earned, [false, false, false])
  const c = checkHistogram(r)
  assert.equal(c.oobWrites.length, LAUNCH.grid * (LAUNCH.block - 8))
  assert.match(verdict.error.symptom, /block 0 的线程 8～63 往 box\[8～63\] 写，可货架只有 box\[0\]～box\[7\]/)
  assert.match(verdict.error.fix, /if \(t < 8\) box\[t\] = 0;/)
})

test('删掉清零后面的同步（完整模式）：小队 1 往格子上加时，小队 0 的清零和它之间没有同步，记下货架上的数据竞争', () => {
  const noWait = (src, lang) => src.replace(lang === 'hip' ? '    __syncthreads();' : '    syncthreads()', lang === 'hip' ? '    // 不等' : '    # 不等')
  const { verdict, run: r } = attempt(BEST, noWait)
  assert.deepEqual(verdict.earned, [false, false, false])
  const c = checkHistogram(r)
  assert.ok(c.races.length > 0 && c.races.every((d) => d.space === 'lds'))
  assert.match(verdict.error.cause, /清零、数、合并是三件事/)
})

test('单步：表格只数到这一步为止，这一步加到的格子标出来', () => {
  const { run: r } = attempt(BEST)
  const { events } = r.result
  // block 2 合并的那一步：往 hist[3]、hist[4]、hist[5] 各加一次
  const merge2 = stepGroups(events).find((g) => g.block === 2 && events.slice(g.from, g.to).some((e) => e.op === 'atomic' && e.space === 'global'))
  const { adds, now } = addTable(events, LAUNCH.grid, merge2.to, merge2.from)
  assert.deepEqual(adds.map((row) => row.reduce((s, n) => s + n, 0)), [2, 3, 3, 0])
  assert.deepEqual(now[2], [false, false, false, true, true, true, false, false])
  assert.ok(now.filter((_, b) => b !== 2).every((row) => row.every((x) => !x)))
})

test('代码写错：语法错误照样一颗星都没有，说清第几行', () => {
  for (const lang of LANGS) {
    const src = fillTemplate(parseTemplate(CODE[lang]), { count: lang === 'hip' ? 'atomicAdd(&box[a[i]], 1' : 'atomic_add(box, a[i], 1' }).source
    const result = run(buildRequest(src, lang, LAUNCH, ARGS))
    const verdict = judge([{ launch: LAUNCH, result }])
    assert.deepEqual(verdict.earned, [false, false, false])
    assert.match(verdict.error.symptom, /^第 \d+ 行第 \d+ 列有语法错误/)
  }
})

test('手机上的 48 种选法：三颗星只有「清零、货架上原子加、只合并数到的档」，两颗星只有每档都合并', () => {
  for (const key of ['clear', 'count', 'merge']) assert.equal(BLANKS[key].choices.hip.length, BLANKS[key].choices.python.length, key)
  const byStars = [[], [], [], []]
  for (let clear = 0; clear < CLEARS.hip.length; clear++) {
    for (let count = 0; count < COUNTS.hip.length; count++) {
      for (let merge = 0; merge < MERGES.hip.length; merge++) byStars[stars(attempt({ clear, count, merge }).verdict)].push(`${clear}${count}${merge}`)
    }
  }
  assert.deepEqual(byStars[3], ['233'])
  assert.deepEqual(byStars[2], ['232'])
  // 一颗星：直接往 hist 原子加（不碰货架，或者清零以后合并的是 0）
  assert.deepEqual(byStars[1], ['010', '210', '212', '213'])
  assert.equal(byStars[0].length, 42)
})

test('两种写法的工作单解析成同一棵语法树（除了位置）', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  for (const choice of [undefined, ATOMIC_HIST, BEST]) {
    const [hip, python] = LANGS.map((lang) => parseKernel(source(lang, choice), lang))
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(plain(python.kernel), plain(hip.kernel))
  }
})
