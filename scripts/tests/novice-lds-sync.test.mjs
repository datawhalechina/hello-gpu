import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest, stepGroups } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import {
  BEST_TAKE, DEFAULT_TAKE, FLIP_ARGS, FLIP_BLANKS, FLIP_CODE, FLIP_LAUNCH, FLIP_VARIANTS, LAB_ARGS, LAB_LAUNCH, NO_WAIT,
  SYNC_CALL, VARIANT_LAUNCH, WAITS, flipExpected, judge, labCode, labText, shelfBoard, shelfRaces, squadsAt, stepStory,
  waitsOf,
} from '../../docs/novice/lds-sync/challenge.ts'

/**
 * 1-9 车间里的货架。实验台：同步写在放和取之间，整组都放好才取；挪到放之前或者删掉，小队 0 取早了。
 * 挑战补三个空（放之前等不等、放和取之间等不等、取第几格）：每组倒过来、没有数据竞争；只等一次；换成每组 32 个线程照样成立。
 * 两种写法的事件流（除了行号）、结果和判定都相同。
 */

const LANGS = ['hip', 'python']

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行。 */
const strip = (result) => ({ ok: result.ok, arrays: result.arrays, steps: result.steps, events: result.events.map(({ line, ...e }) => e) })
/** 判定里写了第几行（取早了的那一格谁在哪一行取、哪一行放）：比两种写法的判定时，把行号、列号换掉。 */
const noLines = (verdict) => JSON.parse(JSON.stringify(verdict).replace(/第 -?\d+ (行|列)/g, '第 # $1'))

/** 实验台：两种写法各跑一次，事件流（除了行号）和结果相同，交回 HIP 那一次。 */
function lab(wait) {
  const [hip, python] = LANGS.map((lang) => run(buildRequest(labCode(wait, lang), lang, LAB_LAUNCH, LAB_ARGS)))
  assert.deepEqual(strip(python), strip(hip))
  return hip
}

/** 模板按读者填的空拼成代码；没填的空用初始内容。 */
const source = (lang, values = {}) => fillTemplate(parseTemplate(FLIP_CODE[lang]), values).source

/** 挑战点一次「运行」：读者设的那一次 + 换派法的那一次（同 Sandbox：代码出错就不再跑 variants）。两种写法的事件流、结果和判定都相同。 */
function challenge(values = {}) {
  const runsBy = LANGS.map((lang) => {
    const code = source(lang, values[lang] ?? values)
    const main = { launch: FLIP_LAUNCH, result: run(buildRequest(code, lang, FLIP_LAUNCH, FLIP_ARGS)) }
    if (!main.result.ok) return [main]
    return [main, ...FLIP_VARIANTS.map((v) => {
      const launch = { ...FLIP_LAUNCH, ...v }
      return { launch, result: run(buildRequest(code, lang, launch, FLIP_ARGS)) }
    })]
  })
  const [hip, python] = runsBy
  assert.equal(python.length, hip.length)
  hip.forEach((r, k) => assert.deepEqual(strip(python[k].result), strip(r.result)))
  const verdict = judge(hip)
  assert.deepEqual(noLines(judge(python)), noLines(verdict))
  return { verdict, main: hip[0].result, variant: hip[1]?.result }
}

/** 两种写法同一个空的内容：同步那一行两种写法不一样，其余一样。 */
const both = (fill) => ({ hip: fill('hip'), python: fill('python') })
const ONLY_BETWEEN = both((lang) => ({ before: '', between: SYNC_CALL[lang] }))

test('探索一：同步写在放和取之间，先放好的小队停在同步处等另一支，整组到齐才取；out 全倒过来，没有数据竞争', () => {
  const result = lab('between')
  assert.equal(result.ok, true)
  assert.deepEqual(result.arrays.out, flipExpected(LAB_LAUNCH))
  assert.deepEqual(result.arrays.out.slice(0, 3), [64, 63, 62])
  assert.equal(shelfRaces(result).total, 0)
  assert.equal(waitsOf(result.events), 1)
  const steps = stepGroups(result.events)
  const stories = steps.map((_, k) => stepStory(result, LAB_LAUNCH, k))
  const arrive = stories.findIndex((s) => s.includes('停下来等'))
  assert.match(stories[arrive], /^小队 0：走到第 \d+ 行的同步，停下来等。这一组 2 支小队，到了 1 支。$/)
  // 小队 0 在同步处等的时候，小队 1 才开始放
  const waiting = squadsAt(result, LAB_LAUNCH, arrive + 3)
  assert.deepEqual(waiting.map((s) => s.status), ['waiting', 'running'])
  assert.match(stories[arrive + 3], /^小队 1：32 个线程把 a\[32\]～a\[63\] 放上货架的第 32～63 格。$/)
  assert.match(stories[arrive + 4], /都到齐了，一起往下走。$/)
  // 到齐以后才取：两支小队取的格子都放好了
  assert.match(stories[arrive + 5], /^小队 0：32 个线程取货架的第 63～32 格，存进 out\[0\]～out\[31\]。这些格子都放好了。$/)
  assert.match(labText('between', result), /^两支小队都放好了才取：out 的 64 个数全倒过来了，一处数据竞争也没有/)
})

test('探索二：删掉同步或者挪到放之前，小队 0 取早了：out 前 32 个是 0，后 32 个碰巧对；64 处数据竞争，32 处取早、32 处碰巧', () => {
  const expected = flipExpected(LAB_LAUNCH)
  for (const wait of ['none', 'before']) {
    const result = lab(wait)
    const out = result.arrays.out
    assert.deepEqual(out.slice(0, 32), new Array(32).fill(0), `${wait}：模拟器让小队 0 先走，取到还没放的格子（货架一开始是 0）`)
    assert.deepEqual(out.slice(32), expected.slice(32), `${wait}：小队 1 后取，碰巧取对了`)
    const races = shelfRaces(result)
    assert.deepEqual([races.total, races.early.length, races.lucky.length, races.other.length], [64, 32, 32, 0])
    assert.deepEqual(races.early.map((r) => r.index), Array.from({ length: 32 }, (_, k) => 32 + k))
    assert.match(labText(wait, result), /out 有 32 个数错了：小队 0 去取第 32～63 格的时候，这些格子还没放，取到的是 0（模拟器里货架一开始是 0）。小队 1 后取，碰巧取对了。模拟器记下 64 处数据竞争。$/)
  }
  assert.equal(waitsOf(lab('none').events), 0)
  assert.equal(waitsOf(lab('before').events), 1, '写在放之前也等了一次，可等错了地方')
  assert.match(labText('before', lab('before')), /^同步写在放之前，等于没等/)
})

test('货架板：一步一步算出每一格的样子，没等就取的格子标出取早了，取早的那一半 out 不对', () => {
  const result = lab('none')
  const steps = stepGroups(result.events)
  const at = (k) => shelfBoard(result, LAB_LAUNCH, steps[k].to, steps[k].from)[0]
  // 小队 0 放好：第 0～31 格放的是 a[0]～a[31]，也就是 1～32
  const put = steps.findIndex((g) => result.events.slice(g.from, g.to).some((e) => e.op === 'store' && e.space === 'lds'))
  const afterPut = at(put)
  assert.deepEqual(afterPut.slots.filter((s) => s.filled).map((s) => s.value), Array.from({ length: 32 }, (_, k) => k + 1))
  assert.equal(afterPut.slots.filter((s) => s.put).length, 32)
  // 下一步小队 0 就取：第 32～63 格还空着
  const take = at(put + 1)
  assert.deepEqual(take.slots.filter((s) => s.early).map((s) => s.index), Array.from({ length: 32 }, (_, k) => 32 + k))
  assert.equal(take.slots.filter((s) => s.taken).length, 32)
  assert.deepEqual([take.out.filter((c) => c.now).length, take.wrong], [32, 32])
  assert.match(stepStory(result, LAB_LAUNCH, put + 1), /其中 32 格还没放：取早了，模拟器里取到 0。$/)
  // 小队 1 最后取第 31～0 格：放是放好了，可中间没有同步
  assert.match(stepStory(result, LAB_LAUNCH, steps.length - 1), /这些格子碰巧都放好了：中间没有同步/)
  const end = shelfBoard(result, LAB_LAUNCH)[0]
  assert.deepEqual([end.out.filter((c) => c.state === 'right').length, end.wrong], [32, 32])
  // 还没开始：货架全空，out 一格都没写
  const start = shelfBoard(result, LAB_LAUNCH, 0)[0]
  assert.deepEqual([start.started, start.slots.some((s) => s.filled), start.out.some((c) => c.state !== 'blank')], [false, false, false])
})

test('挑战 ★1：初始写法（放之前、放和取之间都同步，取第 63 - t 格）每组都倒对了、没有数据竞争，可每支小队等了 2 次', () => {
  const { verdict, main } = challenge()
  assert.deepEqual(main.arrays.out, flipExpected(FLIP_LAUNCH))
  assert.deepEqual(main.arrays.out.slice(62, 66), [2, 1, 128, 127], '每组倒自己的 64 个数，不是整段倒过来')
  assert.equal(waitsOf(main.events), 2)
  assert.deepEqual(verdict.earned, [true, false, false])
  assert.match(verdict.next, /^每组的 64 个数都倒过来了，没有数据竞争（模拟）。可每支小队在同步处等了 2 次。/)
})

test('挑战 ★2：删掉放之前那次同步，只等一次；63 写死，换成每组 32 个线程就取到了没放的格子，没有 ★3', () => {
  const { verdict, main, variant } = challenge(ONLY_BETWEEN)
  assert.equal(waitsOf(main.events), 1)
  assert.deepEqual(verdict.earned, [true, true, false])
  assert.deepEqual(variant.arrays.out.slice(0, 32), new Array(32).fill(0), '每组 32 个线程只放了第 0～31 格，第 63～32 格没人放')
  assert.match(verdict.next, /换成 4 组、每组 32 个线程再跑一次：out\[0\] 是 0，应该是 32。对面那一格要跟着每组的人数变：每组 32 个线程时，线程 0 要第 31 格。每组几个线程，写在 blockDim.x 里。$/)
})

test('挑战 ★3：只在放和取之间同步，取第 blockDim.x - 1 - t 格，每组 64 个、32 个线程都倒对了、只等一次', () => {
  for (const take of [BEST_TAKE, 'blockDim.x - t - 1', '(blockDim.x - 1) - t']) {
    const fill = both((lang) => ({ ...ONLY_BETWEEN[lang], take }))
    const { verdict, main, variant } = challenge(fill)
    assert.deepEqual(verdict.earned, [true, true, true], take)
    assert.deepEqual(variant.arrays.out, flipExpected(VARIANT_LAUNCH))
    assert.equal(waitsOf(variant.events), 1)
    assert.equal(shelfRaces(main).total + shelfRaces(variant).total, 0)
  }
})

test('挑战：只留放之前那次同步，或者两次都删掉，小队 0 取早了，一颗星都没有，说清同步错在哪', () => {
  const misplaced = challenge(both((lang) => ({ between: NO_WAIT[lang] }))).verdict
  assert.deepEqual(misplaced.earned, [false, false, false])
  assert.match(misplaced.error.symptom, /^out 有 64 个数不对，模拟器还记下 128 处数据竞争。比如第 32 格（block 0 的货架）：线程 31 在第 \d+ 行取它的时候，线程 32 还没在第 \d+ 行放。$/)
  assert.match(misplaced.error.cause, /^同步写在了放之前/)
  assert.match(misplaced.error.fix, /^在放和取之间同步/)
  const none = challenge(both((lang) => ({ before: NO_WAIT[lang], between: '' }))).verdict
  assert.deepEqual(none.earned, [false, false, false])
  assert.match(none.error.cause, /^放完没等就去取：对面的线程可能还没放/)
  assert.match(none.error.raw, /\n每支小队在同步处等了：0 次$/)
})

test('挑战：取第几格算错，一颗星都没有：按全局下标 i 数格子、多算一格都取到货架外面，取自己那一格就没倒过来', () => {
  // 63 - i：block 0 取对了，block 1 的格子号变成负数
  const global = challenge(both((lang) => ({ ...ONLY_BETWEEN[lang], take: '63 - i' }))).verdict
  assert.deepEqual(global.earned, [false, false, false])
  assert.match(global.error.symptom, /^有 64 次取到了货架外面。比如第一次：block 1 的线程 0 要第 -1 格，货架只有第 0～63 格/)
  assert.match(global.error.cause, /^block 0 取对了，后面的组却取到了货架外面：每组有自己的货架，格子都从 0 数起/)
  // 64 - t：线程 0 要第 64 格
  const plusOne = challenge(both((lang) => ({ ...ONLY_BETWEEN[lang], take: '64 - t' }))).verdict
  assert.deepEqual(plusOne.earned, [false, false, false])
  assert.match(plusOne.error.symptom, /^有 2 次取到了货架外面。比如第一次：block 0 的线程 0 要第 64 格/)
  // t：取自己放的那一格，out 和 a 一模一样
  const own = challenge(both((lang) => ({ ...ONLY_BETWEEN[lang], take: 't' }))).verdict
  assert.deepEqual(own.earned, [false, false, false])
  assert.match(own.error.symptom, /^out 有 128 个数不对：比如 out\[0\] 是 1，应该是 64。$/)
  assert.match(own.error.fix, /线程 t 取的那一格，加上 t 正好是 63。$/)
})

test('挑战：同步写进只有一半线程会走的分支，模拟器报「在分支里同步」，一颗星都没有', () => {
  const branch = both((lang) => ({
    before: lang === 'hip' ? `if (t < 32) { ${SYNC_CALL.hip} }` : `if t < 32: ${SYNC_CALL.python}`,
  }))
  for (const lang of LANGS) {
    const result = run(buildRequest(source(lang, branch[lang]), lang, FLIP_LAUNCH, FLIP_ARGS))
    assert.equal(result.ok, false, lang)
    const verdict = judge([{ launch: FLIP_LAUNCH, result }])
    assert.deepEqual(verdict.earned, [false, false, false])
    assert.match(verdict.error.symptom, /^运行到第 \d+ 行第 \d+ 列时出错，程序停下了。$/)
    assert.match(verdict.error.cause, /^在分支里同步/)
  }
})

test('挑战：手机上的选项，两次都等 1 颗星，只在放和取之间等 2 颗，再跟着每组的人数取 3 颗，别的都是 0 颗', () => {
  assert.deepEqual(FLIP_BLANKS.take.choices, [DEFAULT_TAKE, '64 - t', '63 - i', BEST_TAKE])
  for (const lang of LANGS) {
    const waits = FLIP_BLANKS.before.choices[lang]
    assert.deepEqual(waits, [SYNC_CALL[lang], NO_WAIT[lang]])
    assert.deepEqual(FLIP_BLANKS.between.choices[lang], waits)
  }
  const stars = {}
  for (const before of [0, 1]) {
    for (const between of [0, 1]) {
      for (const take of FLIP_BLANKS.take.choices) {
        const fill = both((lang) => ({ before: FLIP_BLANKS.before.choices[lang][before], between: FLIP_BLANKS.between.choices[lang][between], take }))
        stars[`${before}${between} ${take}`] = challenge(fill).verdict.earned.filter(Boolean).length
      }
    }
  }
  const got = Object.entries(stars).filter(([, n]) => n > 0)
  assert.deepEqual(Object.fromEntries(got), {
    [`00 ${DEFAULT_TAKE}`]: 1,
    [`00 ${BEST_TAKE}`]: 1,
    [`10 ${DEFAULT_TAKE}`]: 2,
    [`10 ${BEST_TAKE}`]: 3,
  })
})

test('挑战：两种写法的工作单解析成同一棵语法树（除了位置），实验台三种同步位置也一样', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  const sources = [
    ...[{}, ONLY_BETWEEN, both((lang) => ({ ...ONLY_BETWEEN[lang], take: BEST_TAKE }))].map((v) => (lang) => source(lang, v[lang] ?? v)),
    ...WAITS.map(({ value }) => (lang) => labCode(value, lang)),
  ]
  for (const code of sources) {
    const [hip, python] = LANGS.map((lang) => parseKernel(code(lang), lang))
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(plain(python.kernel), plain(hip.kernel))
  }
})
