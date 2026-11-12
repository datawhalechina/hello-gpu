import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_STEPS, runAgent } from '../../docs/course/agent/react.ts'
import { rulePolicy } from '../../docs/course/agent/rules.ts'
import { VECTOR_ADD, configKey } from '../../docs/course/agent/tasks.ts'
import { createEnv, percent } from '../../docs/course/agent/tools.ts'
import { missingErrorParts } from '../../docs/course/useChallenge.ts'
import { run } from '../../docs/sim/lockstep.ts'
import {
  HINTS, PATH, PATH_START, SEAT, SEAT_START, STEP_LIMIT, TASK, TOUR, TOUR_START,
  firstLapse, judge, normalizeDraft, pathOf, pathText,
} from '../../docs/novice/meet-agent/challenge.ts'

/**
 * 1-13 认识 Agent。Agent 调 A-01 的向量加法（1000 个数，调 block 和步长），工具在模拟器上跑。
 * 正文写死的车次、lane 利用率和规则 Agent 走的路，拿模拟器把两种写法都走一遍核对；
 * 探索二把一轮缩成几站（pathOf、pathText）；挑战「你来当 Agent」的三颗星各自成立和不成立，两种写法判得一样。
 */

const LANGS = ['hip', 'python']
const act = (tool, block, stride) => ({ tool, args: { block, stride } })
const observeAll = (block, stride) => ['run_kernel', 'measure', 'inspect_memory'].map((tool) => act(tool, block, stride))
const keys = (configs) => configs.map(configKey)

/** 在这种写法的环境里依次执行这些行动，交回读者的这一轮（每步的行动和观察）。 */
async function play(actions, lang, task = { ...TASK, start: SEAT_START }) {
  const env = createEnv(task, run, lang)
  const log = []
  for (const action of actions) log.push({ action, observation: await env.act(action) })
  return log
}

/** 两种写法各走一遍，判得一样，交回 HIP 那一次的判定。 */
async function judgeBoth(actions, start = SEAT_START) {
  const [hip, python] = await Promise.all(LANGS.map(async (lang) => judge(await play(actions, lang, { ...TASK, start }), start)))
  assert.deepEqual(python, hip, JSON.stringify(actions))
  return hip
}

const episode = (start, lang = 'hip', maxSteps) => runAgent(createEnv({ ...TASK, start }, run, lang), rulePolicy, { maxSteps })

// ── 正文里的数 ──────────────────────────────────────────────────────────────

test('探索一：规则 Agent 从 block 48、步长 4 出发，第 3 步看访存读到 384 车、理想 132 车，走 10 步换两次参数交卷', async () => {
  const [hip, python] = await Promise.all(LANGS.map((lang) => episode(TOUR_START, lang)))
  assert.deepEqual(python, hip)
  assert.deepEqual(TOUR_START, VECTOR_ADD.start)
  const third = hip.steps[2]
  assert.deepEqual(third.action, act('inspect_memory', 48, 4))
  assert.deepEqual([third.observation.data.transactions, third.observation.data.ideal], [TOUR.transactions, TOUR.ideal])
  // 第 4 步的思考拿第 3 步的观察当理由，把步长改成 1
  assert.match(hip.steps[3].thought, new RegExp(`${TOUR.transactions} 车，理想只要 ${TOUR.ideal} 车`))
  assert.deepEqual(hip.steps[3].action, act('run_kernel', 48, 1))
  assert.deepEqual(keys(pathOf(hip.steps).stops.map((s) => s.config)), keys(TOUR.path))
  assert.equal(hip.steps.length, TOUR.steps)
})

test('探索二的默认起点 block 16、步长 2：一车没多搬、lane 利用率 49.8%，规则 Agent 先改 block 再改步长', async () => {
  const [hip, python] = await Promise.all(LANGS.map((lang) => episode(PATH_START, lang)))
  assert.deepEqual(python, hip)
  const first = pathOf(hip.steps).stops[0]
  assert.deepEqual([first.transactions, first.ideal], [PATH.transactions, PATH.ideal])
  assert.equal(percent(first.laneUse), PATH.laneUse)
  assert.deepEqual(keys(pathOf(hip.steps).stops.map((s) => s.config)), keys(PATH.path))
})

test('挑战的起点 block 100、步长 8 搬 768 车、理想 120 车；block 128、步长 1 搬 96 车等于理想，576 个周期', async () => {
  for (const lang of LANGS) {
    const env = createEnv(TASK, run, lang)
    const start = (await env.act(act('inspect_memory', 100, 8))).data
    assert.deepEqual([start.transactions, start.ideal], [SEAT.transactions, SEAT.ideal], lang)
    const best = (await env.act(act('inspect_memory', SEAT.best.block, SEAT.best.stride))).data
    assert.deepEqual([best.transactions, best.ideal], [SEAT.bestTransactions, SEAT.bestTransactions], lang)
    assert.equal((await env.act(act('measure', SEAT.best.block, SEAT.best.stride))).data.cycles, SEAT.bestCycles, lang)
  }
  assert.equal(SEAT.bestCycles, VECTOR_ADD.bestCycles)
})

// ── 探索二：一轮缩成几站 ────────────────────────────────────────────────────

test('pathOf：连着用同一组参数的几步算一站，「为什么」是紧接着那一步的思考，交卷那一步不算一站', async () => {
  const ep = await episode(TOUR_START)
  const p = pathOf(ep.steps)
  assert.deepEqual(p.stops.map((s) => [configKey(s.config), s.first, s.last]), [['48x4', 1, 3], ['48x1', 4, 6], ['64x1', 7, 9]])
  assert.deepEqual(p.stops.map((s) => s.why), [ep.steps[3].thought, ep.steps[6].thought, ep.steps[9].thought])
  assert.deepEqual(p.stops.map((s) => [s.correct, s.cycles, s.transactions, s.ideal]), [
    [true, 1748, 384, 132],
    [true, 876, 156, 126],
    [true, 576, 96, 96],
  ])
  assert.equal(p.steps, 10)
  assert.deepEqual(p.verdict.earned, [true, true, true])
})

test('pathText：先改什么、再改什么、第几步交卷；起点就最好时直接交卷；只改一样；走满步数没交卷', async () => {
  assert.equal(pathText(pathOf((await episode(TOUR_START)).steps)), '先改步长，再改 block，第 10 步交卷：block 64、步长 1。')
  assert.equal(pathText(pathOf((await episode(PATH_START)).steps)), '先改 block，再改步长，第 10 步交卷：block 32、步长 1。')
  assert.equal(pathText(pathOf((await episode({ block: 64, stride: 1 })).steps)), '起点就没有能改的地方：运行、计时、看访存以后，第 4 步交卷：block 64、步长 1。')
  assert.equal(pathText(pathOf((await episode({ block: 32, stride: 2 })).steps)), '只改了步长，第 7 步交卷：block 32、步长 1。')
  assert.equal(pathText(pathOf((await episode({ block: 16, stride: 1 })).steps)), '只改了 block，第 7 步交卷：block 32、步长 1。')
  // 只给 1 步：规则 Agent 手上还没有量过的参数，交不了卷
  const short = pathOf((await episode(TOUR_START, 'hip', 1)).steps)
  assert.equal(short.verdict, null)
  assert.equal(short.stops[0].why, '')
  assert.equal(pathText(short), '走满了 1 步，没有交卷。')
})

// ── 挑战：你来当 Agent ──────────────────────────────────────────────────────

test('三颗星：规则 Agent 从挑战的起点走的一轮、提示里的答案，两种写法都拿到', async () => {
  for (const lang of LANGS) {
    const ep = await episode(SEAT_START, lang)
    assert.deepEqual(judge(ep.steps, SEAT_START).earned, [true, true, true], lang)
  }
  // 提示里的答案：先在起点运行、计时、看访存，换成 128 × 1 再看一遍，交卷
  const answer = [...observeAll(100, 8), ...observeAll(128, 1), act('finish', 128, 1)]
  assert.equal(HINTS.answerCode, answer.map((a) => `${a.tool}(block=${a.args.block}, stride=${a.args.stride})`).join('\n'))
  const verdict = await judgeBoth(answer)
  assert.deepEqual(verdict.earned, [true, true, true])
  assert.equal(verdict.error, undefined)
})

test('★1 不成立：走满步数没交卷、交的那组没运行过、运行的是别的组；一颗星都不发，现象 / 原因 / 怎么改都写了', async () => {
  const cases = [
    // 走满 15 步，一直在运行
    Array.from({ length: STEP_LIMIT }, () => act('run_kernel', 100, 8)),
    // 量过、看过访存，就是没运行
    [act('measure', 128, 1), act('inspect_memory', 128, 1), act('finish', 128, 1)],
    // 运行的是起点，交的是另一组
    [...observeAll(100, 8), act('finish', 128, 1)],
  ]
  for (const actions of cases) {
    const v = await judgeBoth(actions)
    assert.deepEqual(v.earned, [false, false, false], JSON.stringify(actions))
    assert.deepEqual(missingErrorParts(v.error), [])
    assert.equal(v.next, v.error.fix)
  }
  assert.match((await judgeBoth(cases[0])).error.symptom, /走满了 15 步/)
  assert.match((await judgeBoth(cases[2])).error.symptom, /block 128、步长 1，可这一组一次都没运行过/)
})

test('★1 不成立：交的那组运行时观察说算错了（去掉边界检查的 kernel 越界）', async () => {
  // 去掉 if (i < n)：48 × 4 一共 288 个线程，要算 1152 个数，越界读写
  const code = {
    hip: VECTOR_ADD.code.hip.replace(/ {8}if \(i < n\) \{\n {12}(c\[i\] = a\[i\] \+ b\[i\];)\n {8}\}/, '        $1'),
    python: VECTOR_ADD.code.python.replace(/ {8}if i < n:\n {12}(c\[i\] = a\[i\] \+ b\[i\])/, '        $1'),
  }
  for (const lang of LANGS) assert.ok(!code[lang].includes('< n'), lang)
  const results = []
  for (const lang of LANGS) {
    const log = await play([...observeAll(48, 4), act('finish', 48, 4)], lang, { ...TASK, code, start: { block: 48, stride: 4 } })
    assert.equal(log[0].observation.data.correct, false)
    results.push(judge(log, { block: 48, stride: 4 }))
  }
  assert.deepEqual(results[1], results[0])
  assert.deepEqual(results[0].earned, [false, false, false])
  assert.match(results[0].error.symptom, /算错了/)
  assert.deepEqual(missingErrorParts(results[0].error), [])
})

test('★2：交的参数要又快又省；看清楚了才换、交的是起点，只有 ★1 ★3', async () => {
  const v = await judgeBoth([...observeAll(100, 8), act('finish', 100, 8)])
  assert.deepEqual(v.earned, [true, false, true])
  assert.match(v.next, /搬的车比理想多，示意时间 3320 个周期，没到 576 个周期以内/)
  // 照着规则 Agent 先改了步长、没改 block：block 100 的 lane 空着，还多搬，到不了 576
  const w = await judgeBoth([...observeAll(100, 8), ...observeAll(100, 1), act('finish', 100, 1)])
  assert.deepEqual(w.earned, [true, false, true])
})

test('★3：起点也算手上的一组；换参数、交卷之前三样观察要齐；没执行的行动不算换参数', async () => {
  // 一上来就换到 128 × 1：起点 100 × 8 一样都没看
  const jump = await judgeBoth([act('run_kernel', 128, 1), act('finish', 128, 1)])
  assert.deepEqual(jump.earned, [true, true, false])
  assert.match(jump.next, /第 1 步换到 block 128、步长 1 时，block 100、步长 8 还没「运行」「计时」「看访存」/)

  // 起点看清楚了，交的那组只运行过：交卷时缺计时、看访存
  const atFinish = await judgeBoth([...observeAll(100, 8), act('run_kernel', 128, 1), act('finish', 128, 1)])
  assert.deepEqual(atFinish.earned, [true, true, false])
  assert.match(atFinish.next, /第 5 步交卷时，block 128、步长 1 还没「计时」「看访存」/)

  // 换参数前少了一样：起点没看访存
  const noMemory = await judgeBoth([act('run_kernel', 100, 8), act('measure', 100, 8), ...observeAll(128, 1), act('finish', 128, 1)])
  assert.deepEqual(noMemory.earned, [true, true, false])
  assert.match(noMemory.next, /第 3 步换到 block 128、步长 1 时，block 100、步长 8 还没「看访存」/)

  // 中间夹一个参数不在可选值里的行动：没执行，不算换参数，也不算看过
  const withInvalid = await judgeBoth([...observeAll(100, 8), act('run_kernel', 99, 1), ...observeAll(128, 1), act('finish', 128, 1)])
  assert.deepEqual(withInvalid.earned, [true, true, true])

  // 换回看清楚过的那组再交，也算有凭据
  const back = await judgeBoth([...observeAll(100, 8), ...observeAll(128, 1), ...observeAll(100, 1), act('finish', 128, 1)])
  assert.deepEqual(back.earned, [true, true, true])
})

test('firstLapse：手上这组从起点数起；看清楚以后交卷没有缺口', async () => {
  const log = await play([act('measure', 64, 1)], 'hip')
  assert.deepEqual(firstLapse(log, SEAT_START), { step: 1, config: SEAT_START, missing: ['run_kernel', 'measure', 'inspect_memory'], to: { block: 64, stride: 1 } })
  // 同一个起点、同一组参数：没换参数，也没交卷，没有缺口
  assert.equal(firstLapse(await play([act('measure', 100, 8)], 'hip'), SEAT_START), null)
  assert.equal(firstLapse(await play([...observeAll(100, 8), act('finish', 100, 8)], 'hip'), SEAT_START), null)
})

test('草稿：只留合法的前几步，遇到不合法的截断，交卷以后、超过步数上限的不要；读坏了是空的', () => {
  const ok = [act('run_kernel', 100, 8), act('measure', 100, 8)]
  assert.deepEqual(normalizeDraft({ actions: ok }), { actions: ok })
  assert.deepEqual(normalizeDraft({ actions: [ok[0], act('teleport', 100, 8), ok[1]] }), { actions: [ok[0]] })
  assert.deepEqual(normalizeDraft({ actions: [ok[0], act('measure', 99, 8), ok[1]] }), { actions: [ok[0]] })
  assert.deepEqual(normalizeDraft({ actions: [ok[0], act('finish', 100, 8), ok[1]] }), { actions: [ok[0], act('finish', 100, 8)] })
  assert.equal(normalizeDraft({ actions: Array.from({ length: 30 }, () => ok[0]) }).actions.length, MAX_STEPS)
  // 多出来的参数丢掉，只留 block 和 stride
  assert.deepEqual(normalizeDraft({ actions: [{ tool: 'measure', args: { block: 64, stride: 1, extra: 1 } }] }), { actions: [act('measure', 64, 1)] })
  for (const raw of [null, undefined, 'x', 3, {}, { actions: 'x' }, { actions: [null] }, { actions: [{ tool: 'measure' }] }]) {
    assert.deepEqual(normalizeDraft(raw), { actions: [] }, JSON.stringify(raw))
  }
})
