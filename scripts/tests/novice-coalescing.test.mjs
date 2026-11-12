import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { analyzeMemory } from '../../docs/sim/memory.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import { createEnv } from '../../docs/course/agent/tools.ts'
import { rulePolicy } from '../../docs/course/agent/rules.ts'
import { runAgent } from '../../docs/course/agent/react.ts'
import { VECTOR_ADD } from '../../docs/course/agent/tasks.ts'
import {
  AGENT_START, BEST_CARS, BEST_INDEX, DEFAULT_INDEX, DEFAULT_STRIDE, LAB_N, PART_ARGS, PART_BLANKS,
  PART_CODE, PART_LAUNCH, PART_TOTAL, PART_VARIANTS, SPLIT_LAUNCH, SPLIT_M, STRIDES, STRIDE_CODE, WAVE, agentSideDone,
  countCars, coverageOf, judge, labArgs, labCars, labExpected, partCars, splitCode, splitText, strideLaunch, strideText,
} from '../../docs/novice/coalescing/challenge.ts'

/**
 * 1-8 排好队一起取。实验台：步长越大，小队一次读写搬的车越多；每人做好几道时，隔着分一车不多搬。
 * 挑战补一个空（第 k 轮、第 t 个线程拿第几个数），车次按模拟器的事件流数（L3 的 analyzeMemory）。
 * 两种写法的事件流（除了行号）、结果、车次和判定都相同。
 */

const LANGS = ['hip', 'python']

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行。 */
const strip = (result) => ({ ok: result.ok, arrays: result.arrays, steps: result.steps, events: result.events.map(({ line, ...e }) => e) })

/** 两种写法各跑一次，事件流（除了行号）和结果相同，交回 HIP 那一次。 */
function both(code, launch, args) {
  const [hip, python] = LANGS.map((lang) => run(buildRequest(code[lang], lang, launch, args)))
  assert.deepEqual(strip(python), strip(hip))
  return hip
}

const labRun = (stride) => both(STRIDE_CODE, strideLaunch(stride), labArgs({ stride }))
const splitRun = (split) => both({ hip: splitCode(split, 'hip'), python: splitCode(split, 'python') }, SPLIT_LAUNCH, labArgs({ m: SPLIT_M }))

/** 模板按读者填的 i 拼成代码；不填就是初始内容。 */
const source = (lang, i) => fillTemplate(parseTemplate(PART_CODE[lang]), i === undefined ? {} : { i }).source

/** 挑战点一次「运行」：读者设的那一次 + 换派法的那一次（同 Sandbox 的 variants）。两种写法的事件流、结果和判定都相同。 */
function challenge(i) {
  const variant = PART_VARIANTS[0]
  const variantLaunch = { grid: variant.grid, block: variant.block }
  const runsBy = LANGS.map((lang) => [
    { launch: PART_LAUNCH, result: run(buildRequest(source(lang, i), lang, PART_LAUNCH, PART_ARGS)) },
    { launch: variantLaunch, result: run(buildRequest(source(lang, i), lang, variantLaunch, variant.args)) },
  ])
  const [hip, python] = runsBy
  for (let k = 0; k < 2; k++) assert.deepEqual(strip(python[k].result), strip(hip[k].result))
  const verdict = judge(hip)
  assert.deepEqual(judge(python), verdict)
  return { verdict, main: hip[0].result, variant: hip[1].result }
}

test('热身：小队隔 4 个要一个，a[0]～a[124] 散在 4 车里，每车用上 8 个', () => {
  const result = labRun(DEFAULT_STRIDE)
  const first = analyzeMemory(result.events).accesses[0]
  const e = result.events[first.event]
  assert.equal(e.array, 'a')
  assert.deepEqual(e.addrs, Array.from({ length: WAVE }, (_, t) => t * DEFAULT_STRIDE))
  assert.deepEqual(first.cacheLines, [0, 1, 2, 3])
  assert.equal(first.transactions, 4)
  assert.equal(first.ideal, 1)
})

test('探索一：步长 s，小队每次读写搬 s 车；128 道算完一共 12 × s 车，理想都是 12 车；结果都对', () => {
  for (const stride of STRIDES) {
    const result = labRun(stride)
    assert.deepEqual(result.arrays.c, labExpected(), `步长 ${stride} 要算对`)
    assert.equal(strideLaunch(stride).grid * strideLaunch(stride).block * stride, LAB_N, '组数刚好够用')
    const m = analyzeMemory(result.events)
    assert.ok(m.accesses.every((a) => a.transactions === stride && a.ideal === 1), `步长 ${stride} 每次都搬 ${stride} 车`)
    const cars = countCars(result.events)
    assert.deepEqual(cars, { first: stride, transactions: labCars(stride), ideal: labCars(1) })
  }
  assert.equal(labCars(DEFAULT_STRIDE), 48)
  assert.equal(labCars(1), 12)
})

test('探索一的解读跟着模拟器数的车：步长 1 一车不多搬；步长 4 散在 4 车、每车用上 8 个，一共 48 车、理想 12 车', () => {
  assert.match(strideText(1, countCars(labRun(1).events)), /正好装满 1 车。128 道算完一共搬了 12 车，一车都没多搬/)
  assert.match(strideText(4, countCars(labRun(4).events)), /散在 4 车里，每车只用上 8 个。128 道算完一共搬了 48 车，理想 12 车/)
})

test('探索二：每人 4 道，甲（连着分）每轮搬 4 车、一共 48 车；乙（隔着分）每轮 1 车、一共 12 车；两种分法都算对', () => {
  const chunk = splitRun('chunk')
  const spread = splitRun('spread')
  for (const result of [chunk, spread]) assert.deepEqual(result.arrays.c, labExpected())
  assert.deepEqual(countCars(chunk.events), { first: 4, transactions: 48, ideal: 12 })
  assert.deepEqual(countCars(spread.events), { first: 1, transactions: 12, ideal: 12 })
  // 甲就是探索一的步长 4，乙和步长 1 一样少，可只派了 1 组
  assert.equal(countCars(chunk.events).transactions, labCars(SPLIT_M))
  assert.match(splitText('chunk', countCars(chunk.events)), /散在 4 车里。4 轮算完 128 道，一共搬了 48 车，理想 12 车/)
  assert.match(splitText('spread', countCars(spread.events)), /一共搬了 12 车，一车都没多搬/)
})

test('挑战 ★1：初始写法（连着拿）每个数都加一次，可每轮读 a 搬 4 车，一共 17 车、理想 5 车', () => {
  const { verdict, main } = challenge()
  assert.equal(main.arrays.part.reduce((s, v) => s + v, 0), PART_TOTAL)
  assert.deepEqual(coverageOf(main).missing, [])
  assert.deepEqual(coverageOf(main).repeated, [])
  assert.deepEqual(partCars(main.events), { read: 16, write: 1, transactions: 17, ideal: BEST_CARS, firstRead: 4, gap: 4 })
  assert.deepEqual(verdict.earned, [true, false, false])
  assert.match(verdict.next, /^一共搬了 17 车，理想 5 车（模拟）：读 a 16 车，写 part 1 车。第 0 轮，小队要的 32 个数隔 4 个一个，散在 4 车里。/)
})

test('挑战 ★2：把 32 写死（或写成 blockDim.x）一组时降到最少，换成 2 组就有数重了、有数没人加，没有 ★3', () => {
  for (const i of ['k * 32 + t', 'k * blockDim.x + t']) {
    const { verdict, main, variant } = challenge(i)
    assert.equal(partCars(main.events).transactions, BEST_CARS)
    assert.deepEqual(verdict.earned, [true, true, false], i)
    assert.deepEqual(coverageOf(variant).repeated, Array.from({ length: 32 }, (_, k) => 32 + k))
    assert.deepEqual(coverageOf(variant).missing, Array.from({ length: 32 }, (_, k) => 96 + k))
    assert.match(verdict.next, /换成 2 组、每组 32 个线程、每人加 2 个再跑一次：a\[32\]～a\[63\] 加了不止一次，a\[96\]～a\[127\] 没人加。/)
    assert.match(verdict.next, /现在一共 64 个线程，第 1 轮该从 a\[64\] 拿起。一共几个线程，工作单里写在 T 里。$/)
  }
})

test('挑战 ★3：隔着拿、跳一共几个线程（k * T + t），一组、两组都每个数只加一次、一车不多搬', () => {
  for (const i of [BEST_INDEX, 't + k * T', 'T * k + t']) {
    const { verdict, main, variant } = challenge(i)
    assert.deepEqual(verdict.earned, [true, true, true], i)
    for (const result of [main, variant]) {
      assert.equal(result.arrays.part.reduce((s, v) => s + v, 0), PART_TOTAL)
      const cars = partCars(result.events)
      assert.equal(cars.transactions, cars.ideal)
    }
    assert.equal(partCars(main.events).transactions, BEST_CARS)
  }
})

test('挑战：没加对时一颗星都没有，写清哪些数重了、哪些没人加，或者读到了 a 外面', () => {
  // 每一轮只往后挪 m 个：几轮拿的数叠在一起
  const overlap = challenge('k * m + t').verdict
  assert.deepEqual(overlap.earned, [false, false, false])
  assert.match(overlap.error.symptom, /^84 个数没人加，36 个数加了不止一次：比如 a\[44\]～a\[127\] 没人加，a\[4\] 加了 2 次/)
  assert.match(overlap.error.cause, /一共只拿 128 次，正好够每个数拿一次/)
  assert.match(overlap.error.raw, /^运行后 part 加起来是 2880，应该是 1 \+ 2 \+ … \+ 128 = 8256\n/)
  // 跳的是线程数、往后挪的却是轮数：4 号线程就到了 a 外面
  const outside = challenge('t * T + k').verdict
  assert.deepEqual(outside.earned, [false, false, false])
  assert.match(outside.error.symptom, /^有 112 次读到了 a 外面：比如 4 号线程要了 a\[128\]/)
  // 代码写错：语法错误照样一颗星都没有，说清第几行
  for (const lang of LANGS) {
    const result = run(buildRequest(source(lang, 'k * T +'), lang, PART_LAUNCH, PART_ARGS))
    const verdict = judge([{ launch: PART_LAUNCH, result }])
    assert.deepEqual(verdict.earned, [false, false, false])
    assert.match(verdict.error.symptom, /^第 \d+ 行第 \d+ 列有语法错误/)
  }
})

test('挑战：手机上的四个选项，连着拿 1 颗星、叠着拿 0 颗、写死 32 两颗、用 T 三颗', () => {
  assert.deepEqual(PART_BLANKS.i.choices, [DEFAULT_INDEX, 'k * m + t', 'k * 32 + t', BEST_INDEX])
  const stars = PART_BLANKS.i.choices.map((i) => challenge(i).verdict.earned.filter(Boolean).length)
  assert.deepEqual(stars, [1, 0, 2, 3])
})

test('挑战：两种写法的工作单解析成同一棵语法树（除了位置）', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  for (const i of [undefined, BEST_INDEX, 'k * 32 + t']) {
    const [hip, python] = LANGS.map((lang) => parseKernel(source(lang, i), lang))
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(plain(python.kernel), plain(hip.kernel))
  }
})

test('支线：规则 Agent 从每组 32 个、步长 4 出发，看访存读到多搬了，就把步长改成 1，交卷拿到三颗星', async () => {
  const episode = await runAgent(createEnv({ ...VECTOR_ADD, start: AGENT_START }, run), rulePolicy)
  const tools = episode.steps.map((s) => s.action.tool)
  assert.deepEqual(tools, ['run_kernel', 'measure', 'inspect_memory', 'run_kernel', 'measure', 'inspect_memory', 'finish'])
  const memory = episode.steps[2].observation.data
  assert.ok(memory.transactions > memory.ideal, '起点多搬了')
  assert.deepEqual(episode.steps[3].action.args, { block: AGENT_START.block, stride: 1 })
  assert.deepEqual(episode.steps[6].observation.verdict.earned, [true, true, true])
})

test('支线完成看读者交卷：算对、不多搬才算；只交卷、没交卷都不算', () => {
  const verdict = (earned) => ({ config: AGENT_START, earned, correct: earned[0], cycles: 0, efficiency: 1 })
  assert.equal(agentSideDone(verdict([true, true, false])), true)
  assert.equal(agentSideDone(verdict([true, true, true])), true)
  assert.equal(agentSideDone(verdict([true, false, false])), false)
  assert.equal(agentSideDone(verdict([false, false, false])), false)
  assert.equal(agentSideDone(null), false)
})
