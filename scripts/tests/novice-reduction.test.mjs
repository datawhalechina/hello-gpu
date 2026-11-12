import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import {
  ADD_ARGS, ADD_LAUNCH, ADD_MODES, ADD_TOTAL, BEST_STOP, DEFAULT_STOP, LAB_ARGS, LAB_LAUNCH, LAB_TOTAL, MERGES, MERGE_ORDER,
  NO_WAIT, ROUND_WAITS, SUM_ARGS, SUM_BLANKS, SUM_CODE, SUM_LAUNCH, SUM_TOTAL, SUM_VARIANTS, SYNC_CALL, TREE_VALUES,
  addAllCode, addText, addsPerRound, bestTree, joinNodes, judge, labText, loopLine, moveStory, outWrites, plantTree, queueOf,
  readyNodes, roundsNeeded, roundsOf, sumRaces, treeBoard, treeCode, treeDone, treeMoves, treeRounds, treeText, undoJoin,
  unputReads,
} from '../../docs/novice/reduction/challenge.ts'

/**
 * 1-10 大家一起求和。求和树：同一轮里的加法互不相干，8 个数最少 3 轮，一个人从头加到尾 7 轮。
 * 实验台：64 个线程在货架上搭树，每一轮之后同步，6 轮加出 2080；删掉同步，小队 0 第 6 轮取早了。
 * 大家往同一格加：普通加每支小队只留下一个，原子加一个不丢、排 128 次队。
 * 挑战补三个空（搭到哪为止、每一轮之后等不等、最后谁把什么加进 out[0]）：对、没有数据竞争；只排 2 次队；换成每组 32 个线程照样成立。
 * 两种写法的事件流（除了行号）、结果和判定都相同。
 */

const LANGS = ['hip', 'python']

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行。 */
const strip = (result) => ({ ok: result.ok, arrays: result.arrays, steps: result.steps, events: result.events.map(({ line, ...e }) => e) })
/** 判定里写了第几行、第几列：比两种写法的判定时换掉。 */
const noLines = (verdict) => JSON.parse(JSON.stringify(verdict).replace(/第 -?\d+ (行|列)/g, '第 # $1'))

/** 两种写法各跑一次：事件流（除了行号）和结果相同，交回两次运行（HIP 在前）。 */
function both(code, launch, args) {
  const [hip, python] = LANGS.map((lang) => run(buildRequest(code(lang), lang, launch, args)))
  assert.deepEqual(strip(python), strip(hip))
  return { hip, python }
}

/** 模板按读者填的空拼成代码；没填的空用初始内容。values 可以按写法分开给。 */
const source = (lang, values = {}) => fillTemplate(parseTemplate(SUM_CODE[lang]), values[lang] ?? values).source

/** 挑战点一次「运行」：读者设的那一次 + 换派法的那一次（同 Sandbox：代码出错就不再跑 variants）。两种写法的事件流、结果和判定都相同。 */
function challenge(values = {}) {
  const runsBy = LANGS.map((lang) => {
    const code = source(lang, values)
    const main = { launch: SUM_LAUNCH, result: run(buildRequest(code, lang, SUM_LAUNCH, SUM_ARGS)) }
    if (!main.result.ok) return [main]
    return [main, ...SUM_VARIANTS.map((v) => {
      const launch = { ...SUM_LAUNCH, ...v }
      return { launch, result: run(buildRequest(code, lang, launch, SUM_ARGS)) }
    })]
  })
  const [hip, python] = runsBy
  assert.equal(python.length, hip.length)
  hip.forEach((r, k) => assert.deepEqual(strip(python[k].result), strip(r.result)))
  const verdict = judge(hip)
  assert.deepEqual(noLines(judge(python)), noLines(verdict))
  return { verdict, main: hip[0].result, variant: hip[1]?.result }
}

/** 两种写法的同一个选择：同步、合进 out 的写法两种写法不一样。 */
const pick = (stop, wait, merge) => Object.fromEntries(LANGS.map((lang) => [lang, {
  stop, wait: wait ? SYNC_CALL[lang] : NO_WAIT[lang], merge: MERGES[merge][lang],
}]))

const stars = (verdict) => verdict.earned.filter(Boolean).length

test('求和树：配对放在两个数里晚的那一轮 + 1；8 个数两两配最少 3 轮（4、2、1 次加法），一个人从头加到尾 7 轮', () => {
  assert.equal(roundsNeeded(TREE_VALUES.length), 3)
  const best = bestTree()
  assert.equal(treeDone(best), true)
  assert.equal(treeRounds(best), 3)
  assert.deepEqual(addsPerRound(best), [4, 2, 1])
  assert.equal(readyNodes(best)[0].value, 24)
  assert.match(treeText(best), /只用 3 轮.*最少的轮数/)

  let chain = plantTree()
  for (let k = 1, acc = 0; k < TREE_VALUES.length; k++, acc = chain.nodes.length - 1) chain = joinNodes(chain, acc, k)
  assert.equal(treeRounds(chain), 7)
  assert.deepEqual(addsPerRound(chain), [1, 1, 1, 1, 1, 1, 1])
  assert.equal(readyNodes(chain)[0].value, 24)
  assert.match(treeText(chain), /用了 7 轮.*一个人从头加到尾/)

  // 第 1 轮配满 4 对，第 2 轮只加 1 次：4 轮，指出第 2 轮手上 4 个数只配了 1 对
  let mid = plantTree()
  for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7]]) mid = joinNodes(mid, a, b)
  mid = joinNodes(joinNodes(joinNodes(mid, 8, 9), 12, 10), 13, 11)
  assert.equal(treeRounds(mid), 4)
  assert.match(treeText(mid), /第 2 轮开始时手上有 4 个数，能配 2 对，这一轮只加了 1 次/)
})

test('求和树：用掉的数、同一个数、不存在的数都不能再挑；撤销只退最后一次加法', () => {
  const one = joinNodes(plantTree(), 0, 1)
  assert.equal(one.nodes[8].value, 4)
  assert.equal(one.nodes[8].round, 1)
  assert.equal(joinNodes(one, 0, 2), one)
  assert.equal(joinNodes(one, 2, 2), one)
  assert.equal(joinNodes(one, 2, 99), one)
  const two = joinNodes(one, 8, 2)
  assert.equal(two.nodes[9].round, 2, '4 是第 1 轮才加出来的，和它相加要放在第 2 轮')
  assert.deepEqual(undoJoin(two), one)
  assert.deepEqual(undoJoin(plantTree()), plantTree())
})

test('探索二：每一轮之后同步，64 个线程 6 轮加出 2080，没有数据竞争；一支小队走完一轮算一段，先到的小队在同步处等另一支', () => {
  const { hip } = both((lang) => treeCode('sync', lang), LAB_LAUNCH, LAB_ARGS)
  assert.equal(hip.ok, true)
  assert.deepEqual(hip.arrays.out, [LAB_TOTAL])
  assert.equal(sumRaces(hip).total, 0)
  assert.equal(roundsOf(hip), 6)
  const moves = treeMoves(hip, loopLine(treeCode('sync', 'hip')))
  // 两支小队各：放数、6 轮、收尾
  assert.deepEqual(moves.map((m) => `${m.kind}${m.round}w${m.wave}`), [
    'put0w0', 'put0w1',
    ...[1, 2, 3, 4, 5, 6].flatMap((r) => [`round${r}w0`, `round${r}w1`]),
    'tail6w0', 'tail6w1',
  ])
  assert.match(moveStory(hip, LAB_LAUNCH, moves, 2), /小队 0 第 1 轮（隔 1 格配对）：16 个线程.*停下来等：这一组 2 支小队，到了 1 支/)
  assert.match(moveStory(hip, LAB_LAUNCH, moves, 3), /小队 1 第 1 轮.*都到齐了/)
  assert.match(moveStory(hip, LAB_LAUNCH, moves, 13), /小队 1 第 6 轮（隔 32 格配对）：这支小队里没有线程要加/)
  assert.match(moveStory(hip, LAB_LAUNCH, moves, 14), /out\[0\] = 2080/)
  assert.match(labText(hip), /^6 轮就把 64 个数加成了 2080/)
})

test('探索二：删掉每一轮之后的同步，小队 0 一口气走完 6 轮，第 6 轮取第 32 格时小队 1 一轮都没加：out[0] 是 561，31 处数据竞争', () => {
  const { hip } = both((lang) => treeCode('none', lang), LAB_LAUNCH, LAB_ARGS)
  assert.deepEqual(hip.arrays.out, [528 + 33])
  const races = sumRaces(hip)
  assert.equal(races.total, 31)
  assert.deepEqual(races.early.map((r) => [r.index, r.first.thread, r.second.thread]), [[32, 0, 32]])
  const moves = treeMoves(hip, loopLine(treeCode('none', 'hip')))
  // 小队 0 的 6 轮都排在小队 1 的第 1 轮前面
  assert.deepEqual(moves.slice(2, 9).map((m) => `${m.kind}${m.round}w${m.wave}`), ['round1w0', 'round2w0', 'round3w0', 'round4w0', 'round5w0', 'round6w0', 'tail6w0'])
  assert.match(moveStory(hip, LAB_LAUNCH, moves, 7), /第 32 格要等小队 1 先加好.*取早了/)
  assert.match(moveStory(hip, LAB_LAUNCH, moves, 2), /没有同步，接着走下一轮/)
  assert.match(labText(hip), /out\[0\] 是 561，应该是 2080.*线程 0 在第 6 轮取第 32 格的时候，小队 1 一轮都还没加，取到的是 33/)
})

test('货架板：照着事件流重算每一格的部分和，加给别人的格子标出来，取早的那一格在取的那一刻就标出来', () => {
  const sync = run(buildRequest(treeCode('sync', 'hip'), 'hip', LAB_LAUNCH, LAB_ARGS))
  const moves = treeMoves(sync, loopLine(treeCode('sync', 'hip')))
  // 两支小队都走完第 1 轮：偶数格是相邻两个数的和，奇数格已经加给左边了
  const round1 = treeBoard(sync, LAB_ARGS, LAB_LAUNCH, LAB_TOTAL, moves[3].to, moves[2].from)
  assert.equal(round1.exact, true)
  const [shelf] = round1.shelves
  assert.deepEqual(shelf.slots.slice(0, 4).map((s) => [s.value, s.state]), [[3, 'live'], [2, 'spent'], [7, 'live'], [4, 'spent']])
  assert.equal(shelf.slots[0].wrote && shelf.slots[1].read, true)
  assert.equal(round1.out.state, 'blank')
  const end = treeBoard(sync, LAB_ARGS, LAB_LAUNCH, LAB_TOTAL)
  assert.equal(end.shelves[0].slots[0].value, LAB_TOTAL)
  assert.equal(end.shelves[0].slots.filter((s) => s.state === 'live').length, 1)
  assert.deepEqual([end.out.value, end.out.state], [LAB_TOTAL, 'right'])

  const none = run(buildRequest(treeCode('none', 'hip'), 'hip', LAB_LAUNCH, LAB_ARGS))
  const nm = treeMoves(none, loopLine(treeCode('none', 'hip')))
  const before = treeBoard(none, LAB_ARGS, LAB_LAUNCH, LAB_TOTAL, nm[6].to)
  assert.equal(before.shelves[0].slots[32].early, false)
  const taken = treeBoard(none, LAB_ARGS, LAB_LAUNCH, LAB_TOTAL, nm[7].to, nm[7].from)
  assert.deepEqual([taken.shelves[0].slots[32].early, taken.shelves[0].slots[32].value], [true, 33])
  const last = treeBoard(none, LAB_ARGS, LAB_LAUNCH, LAB_TOTAL)
  assert.deepEqual([last.out.value, last.out.state], [561, 'wrong'])
})

test('探索三：普通加每支小队读到同一个旧值、只留下最后一个线程的，out[0] 是 320；原子加一个不丢，可排了 128 次队', () => {
  assert.deepEqual(ADD_MODES.map((m) => m.value), ['plain', 'atomic'])
  const plain = both((lang) => addAllCode('plain', lang), ADD_LAUNCH, ADD_ARGS).hip
  assert.deepEqual(plain.arrays.out, [320])
  assert.deepEqual(outWrites(plain, ADD_ARGS).map((w) => [w.block, w.wave, w.seen, w.after, w.kept]), [
    [0, 0, 0, 32, 31], [0, 1, 32, 96, 63], [1, 0, 96, 192, 31], [1, 1, 192, 320, 63],
  ])
  assert.equal(queueOf(plain.events), 0)
  assert.match(addText('plain', plain), /out\[0\] = 320，应该是 8256：128 个数只留下了 4 个/)

  const atomic = both((lang) => addAllCode('atomic', lang), ADD_LAUNCH, ADD_ARGS).hip
  assert.deepEqual(atomic.arrays.out, [ADD_TOTAL])
  assert.equal(sumRaces(atomic).total, 0)
  assert.equal(queueOf(atomic.events), 128)
  assert.match(addText('atomic', atomic), /一个都没丢.*排了 128 次队/)
})

test('挑战 ★1：初始写法（一轮都不搭，每个线程把自己那一格原子加进 out[0]）结果对、没有数据竞争，可排了 128 次队', () => {
  const { verdict, main } = challenge()
  assert.deepEqual(main.arrays.out, [SUM_TOTAL])
  assert.equal(roundsOf(main), 0)
  assert.equal(queueOf(main.events), 128)
  assert.deepEqual(verdict.earned, [true, false, false])
  assert.match(verdict.next, /排了 128 次队/)
})

test('挑战 ★2：搭到 64 为止、每组线程 0 原子加，只排 2 次队；换成每组 32 个线程，最后一轮取了没人放的第 32 格，没有 ★3', () => {
  const { verdict, main, variant } = challenge(pick('64', true, 'oneAtomic'))
  assert.equal(roundsOf(main), 6)
  assert.equal(queueOf(main.events), 2)
  assert.deepEqual(verdict.earned, [true, true, false])
  assert.deepEqual(variant.arrays.out, [SUM_TOTAL], '模拟器里货架开始是 0，和碰巧对')
  assert.deepEqual(unputReads(variant).map((u) => [u.block, u.thread, u.index]), [[0, 0, 32], [1, 0, 32], [2, 0, 32], [3, 0, 32]])
  assert.match(verdict.next, /取了第 32 格.*没人放过那一格.*blockDim\.x/)
})

test('挑战 ★3：搭到 blockDim.x 为止、每一轮之后同步、每组线程 0 原子加：每组 64 个、32 个线程都对，只排组数那么多次队', () => {
  const { verdict, main, variant } = challenge(pick(BEST_STOP, true, 'oneAtomic'))
  assert.deepEqual(verdict.earned, [true, true, true])
  assert.equal(queueOf(main.events), SUM_LAUNCH.grid)
  assert.deepEqual(variant.arrays.out, [SUM_TOTAL])
  assert.equal(roundsOf(variant), 5)
  assert.equal(queueOf(variant.events), 4)
  assert.equal(unputReads(variant).length, 0)
})

test('挑战：每一轮之后不等，小队 0 取早了，一颗星都没有，说清要在每一轮之后同步', () => {
  const { verdict, main } = challenge(pick(BEST_STOP, false, 'oneAtomic'))
  assert.notDeepEqual(main.arrays.out, [SUM_TOTAL])
  assert.deepEqual(verdict.earned, [false, false, false])
  assert.match(verdict.error.symptom, /第 32 格（block 0）：线程 0 去取的时候，线程 32 这一轮还没把它加好/)
  assert.match(verdict.error.cause, /每一轮之后没等/)
  assert.match(verdict.error.fix, /每一轮的加法之后同步/)
})

test('挑战：out[0] 上用普通加，分清两种错：线程 0 普通加碰巧对了、组和组之间没同步；大家都普通加，每支小队只留下一个', () => {
  const one = challenge(pick(BEST_STOP, true, 'onePlain'))
  assert.deepEqual(one.main.arrays.out, [SUM_TOTAL])
  assert.deepEqual(one.verdict.earned, [false, false, false])
  assert.match(one.verdict.error.symptom, /碰巧对了.*block 0 的线程 0 和 block 1 的线程 0/)
  assert.match(one.verdict.error.cause, /组和组之间没有同步/)
  assert.match(one.verdict.error.fix, /原子加/)

  const every = challenge(pick(DEFAULT_STOP, true, 'everyPlain'))
  assert.deepEqual(every.main.arrays.out, [320])
  assert.match(every.verdict.error.cause, /同一支小队的线程同时读到同一个旧值/)
})

test('挑战：数不对时说清是没搭完、加重了、取到货架外面，还是每组各存一格（要再启动一次）', () => {
  const none = challenge(pick(DEFAULT_STOP, true, 'oneAtomic'))
  assert.deepEqual(none.main.arrays.out, [1 + 65])
  assert.match(none.verdict.error.cause, /循环一轮都没走/)

  const half = challenge(pick('32', true, 'oneAtomic'))
  assert.match(half.verdict.error.cause, /只搭了 5 轮：第 0 格里只加了前 32 个数.*要搭 6 轮/)

  const twice = challenge(pick(BEST_STOP, true, 'everyAtomic'))
  assert.equal(twice.main.arrays.out[0] > SUM_TOTAL, true)
  assert.match(twice.verdict.error.cause, /部分和.*重复/)

  const far = challenge(pick('128', true, 'oneAtomic'))
  assert.match(far.verdict.error.symptom, /取到了货架外面.*第 64 格/)

  const own = challenge(Object.fromEntries(LANGS.map((lang) => [lang, {
    stop: BEST_STOP, merge: lang === 'hip' ? 'if (t == 0) out[blockIdx.x] = box[0];' : 'if t == 0: out[blockIdx.x] = box[0]',
  }])))
  assert.deepEqual(own.verdict.earned, [false, false, false])
  assert.match(own.verdict.error.symptom, /往 out\[1\] 存，可 out 只有 1 格/)
  assert.match(own.verdict.error.cause, /再启动一次/)
})

test('挑战：手机上的选项，初始写法 1 颗星，搭到 64 为止再让线程 0 原子加 2 颗，搭到 blockDim.x 为止 3 颗，别的都是 0 颗', () => {
  assert.deepEqual(SUM_BLANKS.stop.choices, [DEFAULT_STOP, '32', '64', BEST_STOP])
  for (const lang of LANGS) {
    assert.deepEqual(SUM_BLANKS.wait.choices[lang], [SYNC_CALL[lang], NO_WAIT[lang]])
    assert.deepEqual(SUM_BLANKS.merge.choices[lang], MERGE_ORDER.map((k) => MERGES[k][lang]))
  }
  const got = {}
  for (const stop of SUM_BLANKS.stop.choices) {
    for (const wait of [true, false]) {
      for (const merge of MERGE_ORDER) {
        const n = stars(challenge(pick(stop, wait, merge)).verdict)
        if (n) got[`${stop} ${wait ? '等' : '不等'} ${merge}`] = n
      }
    }
  }
  assert.deepEqual(got, {
    [`${DEFAULT_STOP} 等 everyAtomic`]: 1,
    [`${DEFAULT_STOP} 不等 everyAtomic`]: 1,
    '64 等 oneAtomic': 2,
    [`${BEST_STOP} 等 oneAtomic`]: 3,
  })
})

test('货架板：挑战的每一种手机选项，重算出来的 out[0] 都和模拟器的结果一样', () => {
  for (const stop of SUM_BLANKS.stop.choices) {
    for (const wait of [true, false]) {
      for (const merge of MERGE_ORDER) {
        const result = run(buildRequest(source('hip', pick(stop, wait, merge)), 'hip', SUM_LAUNCH, SUM_ARGS))
        const board = treeBoard(result, SUM_ARGS, SUM_LAUNCH, SUM_TOTAL)
        assert.equal(board.exact, true, `${stop} ${wait} ${merge}`)
        assert.equal(board.out.value, result.arrays.out[0])
      }
    }
  }
})

test('两种写法的工作单解析成同一棵语法树（除了位置）：挑战的初始写法和三星写法、实验台两种同步、往同一格加的两种写法', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  const sources = [
    (lang) => source(lang),
    (lang) => source(lang, pick(BEST_STOP, true, 'oneAtomic')),
    ...ROUND_WAITS.map(({ value }) => (lang) => treeCode(value, lang)),
    ...ADD_MODES.map(({ value }) => (lang) => addAllCode(value, lang)),
  ]
  for (const code of sources) {
    const [hip, python] = LANGS.map((lang) => parseKernel(code(lang), lang))
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(plain(python.kernel), plain(hip.kernel))
  }
})
