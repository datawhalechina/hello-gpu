import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { loadPyodide } from 'pyodide'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import { prepareWave, usage, utilization } from '../../docs/components/kit/wave-view/model.ts'
import { explainPythonError } from '../../docs/course/agent/pyerror.ts'
import { runPyAgent } from '../../docs/course/agent/pyodide.ts'
import { runAgent } from '../../docs/course/agent/react.ts'
import { rulePolicy } from '../../docs/course/agent/rules.ts'
import { configKey } from '../../docs/course/agent/tasks.ts'
import { createEnv } from '../../docs/course/agent/tools.ts'
import { missingErrorParts } from '../../docs/course/useChallenge.ts'
import { unload, useProgress } from '../../docs/course/useProgress.ts'
import { run } from '../../docs/sim/lockstep.ts'
import { analyzeMemory } from '../../docs/sim/memory.ts'
import { estimateTime } from '../../docs/sim/timing.ts'
import {
  AGENT_START, AGENT_TASK, AGENT_TOUR, ANSWERS, CHECKUPS, FIX_PARTS, FIXED, FIXES, GLOBAL_INDEX, LAUNCH_CYCLES, SPOT_FIXED,
  SPOT_GPU, SPOT_ID, SPOT_OPTIONS, SPOT_REPORT, SPOT_SKIPPED, START_STATE, STARTER,
  agentValues, boardRows, checkRun, checkupRows, fixRecord, judge, judgeAgent, judgeFix, lockSpot, normalizeState, spotLines,
  spotSession, times,
} from '../../docs/novice/boss/challenge.ts'

/**
 * 新手村 Boss 毕业考。三张坏工作单的体检单拿模拟器把两种写法都核对一遍；三道修复题（分题）的判定，
 * 每道都看参考答案、初始写法、写死的数和手机上的每一种选法；本关三颗星把分题的结果合起来判；
 * 识破题的量法和「只认第一次锁定」；你的 Agent 在 Node 里加载 Pyodide 真跑读者的 Python 模板。
 * 两种写法的同一个程序：事件流（除了行号）、结果和判定都相同。
 */

const LANGS = ['hip', 'python']

/** 填空的值可以按写法分开给（HIP 的 / 和 Python 的 //）。 */
const pick = (values, lang) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? v : v[lang]]))

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行。 */
const strip = ({ result }) => ({
  ok: result.ok,
  arrays: result.arrays,
  outside: result.outside.map((o) => ({ ...o, writes: o.writes.map(({ line, ...w }) => w) })),
  steps: result.steps,
  events: result.events.map(({ line, ...e }) => e),
})

/** 和沙盒一样，按一种写法跑一道修复题：先按工作单的派法跑，代码没出错再按 variants 各跑一次。 */
function runOne(part, values, lang) {
  const setup = FIXES[part]
  const source = fillTemplate(parseTemplate(setup.code[lang]), pick(values, lang)).source
  const main = { launch: setup.launch, result: run(buildRequest(source, lang, setup.launch, setup.args)) }
  const runs = [main]
  if (main.result.ok) {
    for (const { args, ...change } of setup.variants) {
      const launch = { ...setup.launch, ...change }
      runs.push({ launch, result: run(buildRequest(source, lang, launch, args ?? setup.args)) })
    }
  }
  return runs
}

/** 两种写法各跑一遍：事件流（除了行号）、结果相同。 */
function sandbox(part, values = {}) {
  const byLang = LANGS.map((lang) => runOne(part, values, lang))
  assert.deepEqual(byLang[1].map(strip), byLang[0].map(strip), `${part} ${JSON.stringify(values)}`)
  return byLang
}

/** 一道修复题点一次「运行」：两种写法判得一样，交回判定、这道题的结果和 HIP 那一次的 runs。 */
function fix(part, values = {}) {
  const [hip, python] = sandbox(part, values)
  const verdict = judgeFix(part, hip)
  assert.deepEqual(judgeFix(part, python), verdict)
  assert.deepEqual(fixRecord(part, python), fixRecord(part, hip))
  return { verdict, record: fixRecord(part, hip), runs: hip }
}

/** 没过：一颗都不算，现象 / 原因 / 怎么改都写了，下一步就是怎么改。 */
function assertFailed(verdict, label) {
  assert.deepEqual(verdict.earned, [false, false, false], label)
  assert.deepEqual(missingErrorParts(verdict.error), [], label)
  assert.equal(verdict.next, verdict.error.fix, label)
}

// ── 体检单 ──────────────────────────────────────────────────────────────────

test('体检单：三张坏工作单原样跑一遍，数都对；越界、示意时间、lane 利用率、车次和 CHECKUPS 一样（两种写法）', () => {
  for (const part of FIX_PARTS) {
    const [runs] = sandbox(part)
    const main = runs[0]
    const check = checkRun(main)
    const memory = analyzeMemory(main.result.events)
    const c = CHECKUPS[part]
    assert.equal(check.arrays.reduce((n, a) => n + a.wrong.length, 0), c.wrong, part)
    assert.deepEqual([check.outsideWrites, check.oobReads], [c.outsideWrites, c.oobReads], part)
    assert.equal(estimateTime(main.result.events).cycles, c.cycles, part)
    assert.equal(utilization(usage(prepareWave(main.result, main.launch))), c.laneUse, part)
    assert.deepEqual([memory.accesses.length, memory.summary.transactions, memory.summary.ideal], [c.accesses, c.transactions, c.ideal], part)
    // 一道都还没做时，本关按工作单原来的样子算
    assert.deepEqual(fixRecord(part, runs), START_STATE[part], part)
  }
  // 三张算出来的数都对：坏在越界、分岔、多搬车，体检单各标出一项
  assert.deepEqual(FIX_PARTS.map((p) => checkupRows(p).map((r) => r.bad)), [
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ])
  assert.equal(CHECKUPS.oob.outsideWrites, 1, '第一张多派的那 1 个线程写到了 c 外面')
})

test('体检单标出来的行，就是修复题里空所在的行（两种写法）', () => {
  for (const part of FIX_PARTS) {
    for (const lang of LANGS) {
      const lines = FIXES[part].code[lang].split('\n')
      const withBlank = lines.flatMap((line, i) => (line.includes('[[') ? [i + 1] : []))
      assert.deepEqual([...FIXES[part].badLines[lang]], withBlank, `${part} ${lang}`)
    }
  }
})

test('修好以后（参考答案）：第二张 68 个周期、读写 12 次，第三张 60 个周期、12 车（模拟），两种写法一样', () => {
  for (const part of ['fork', 'stride']) {
    const [runs] = sandbox(part, ANSWERS[part])
    const events = runs[0].result.events
    const memory = analyzeMemory(events)
    assert.deepEqual(
      [estimateTime(events).cycles, memory.accesses.length, memory.summary.transactions, memory.summary.ideal],
      [FIXED[part].cycles, FIXED[part].accesses, FIXED[part].transactions, FIXED[part].ideal],
      part,
    )
  }
})

// ── 挑战一：三道修复题 ─────────────────────────────────────────────────────

test('修复题：参考答案两种写法都过，换一批数据、换一种派法也成立', () => {
  for (const part of FIX_PARTS) {
    const { verdict, record } = fix(part, ANSWERS[part])
    assert.equal(verdict.earned[0], true, part)
    assert.equal(verdict.error, undefined, part)
    assert.deepEqual(record, { correct: true, passed: true }, part)
    assert.match(verdict.next, /也一样。$/, part)
  }
  assert.match(fix('fork', ANSWERS.fork).verdict.next, /lane 利用率 100%；读写显存从 24 次降到 12 次，示意时间从 120 降到 68 个周期/)
  assert.match(fix('stride', ANSWERS.stride).verdict.next, /搬了 12 车，等于理想车数；示意时间从 204 降到 60 个周期/)
})

test('修复题：初始写法没过，现象 / 原因 / 怎么改指向这张的毛病', () => {
  const oob = fix('oob')
  assertFailed(oob.verdict, 'oob')
  assert.match(oob.verdict.error.symptom, /1 个线程写到了数组外面（c\[63\]），读到 a、b 外面 2 次/)
  assert.match(oob.verdict.error.cause, /c 只有 63 格，最后一格是 c\[62\]/)
  assert.match(oob.verdict.error.fix, /i < n/)

  const fork = fix('fork')
  assertFailed(fork.verdict, 'fork')
  assert.deepEqual(fork.record, { correct: true, passed: false }, '第二张的数本来就对')
  assert.match(fork.verdict.error.symptom, /和、差都对，可 4 支小队在岔路口分成了两拨.*lane 利用率 83\.3%/)
  assert.match(fork.verdict.error.fix, /让整支小队走同一边/)

  const stride = fix('stride')
  assertFailed(stride.verdict, 'stride')
  assert.deepEqual(stride.record, { correct: true, passed: false }, '第三张的数本来就对')
  assert.match(stride.verdict.error.symptom, /搬了 48 车，理想只要 12 车/)
  assert.match(stride.verdict.error.cause, /相邻两个线程拿的数隔 4 个/)
})

test('修复题：别的修法也认（只看结果），写死的数在换数据、换派法的那一次露馅', () => {
  // 按组分活也不分岔：前一半的组算和，后一半的组算差
  assert.equal(fix('fork', { k: 't % n', job: 'blockIdx.x < gridDim.x / 2' }).verdict.earned[0], true)
  assert.equal(fix('oob', { guard: 'i <= n - 1' }).verdict.earned[0], true)

  const cases = [
    ['oob', { guard: 'i < 63' }, /换成 40 个数（派法不变）再跑一次：23 个线程写到了数组外面/, /写死具体的数、或者只拦 i 等于 n/],
    ['oob', { guard: 'i != n' }, /换成 40 个数（派法不变）再跑一次：23 个线程写到了数组外面/, /只拦 i 等于 n/],
    ['fork', { k: 't % n', job: 't < 64' }, /换成 32 个和、32 个差（派 2 组、每组 32 个线程）再跑一次：.*d\[0\]～d\[31\] 没人算/, /写死了具体的数/],
    ['fork', { k: 't % n', job: 'blockIdx.x < 2' }, /再跑一次：.*d\[0\]～d\[31\] 没人算/, /写死了具体的数（或者组号）/],
    ['stride', { i: 'blockIdx.x * 32 + threadIdx.x' }, /换成派 2 组、每组 64 个线程（还是 128 个数）再跑一次：c\[96\]～c\[127\] 没人算/, /写死了每组 32 个线程/],
  ]
  for (const [part, values, symptom, cause] of cases) {
    const { verdict, record } = fix(part, values)
    const label = `${part} ${JSON.stringify(values)}`
    assertFailed(verdict, label)
    assert.deepEqual(record, { correct: false, passed: false }, label)
    assert.match(verdict.error.symptom, symptom, label)
    assert.match(verdict.error.cause, cause, label)
  }
})

test('修复题：数不对、越界、分岔的几种写错，各自写出现象和原因', () => {
  const short = fix('oob', { guard: 'i < n - 1' })
  assertFailed(short.verdict, 'i < n - 1')
  assert.match(short.verdict.error.symptom, /c\[62\] 没人算/)
  assert.match(short.verdict.error.cause, /把该算的线程也拦在了外面/)

  const parity = fix('fork', { k: { hip: 't / 2', python: 't // 2' }, job: 't % 2 == 0' })
  assertFailed(parity.verdict, 'parity')
  assert.deepEqual(parity.record, { correct: true, passed: false })
  assert.match(parity.verdict.error.symptom, /4 支小队在岔路口分成了两拨/)

  const overflow = fix('fork', { k: 't', job: 't < n' })
  assertFailed(overflow.verdict, 'k = t')
  assert.match(overflow.verdict.error.symptom, /d\[0\]～d\[63\] 没人算；64 个线程写到了数组外面（d\[64\]～d\[127\]）/)

  const same = fix('stride', { i: 'threadIdx.x' })
  assertFailed(same.verdict, 'threadIdx.x')
  assert.match(same.verdict.error.symptom, /c\[32\]～c\[127\] 没人算；c\[0\]～c\[31\] 被不止一个线程算了/)
  assert.match(same.verdict.error.fix, new RegExp(GLOBAL_INDEX.replace(/[.*+]/g, '\\$&')))

  // 代码出错：模拟器的错误照样写成现象 / 原因 / 怎么改（两种写法的报错位置不一样，各看各的）
  for (const lang of LANGS) {
    const runs = runOne('stride', { i: 'blockIdx.x *' }, lang)
    assertFailed(judgeFix('stride', runs), `syntax ${lang}`)
    assert.deepEqual(fixRecord('stride', runs), { correct: false, passed: false })
  }
})

test('修复题：手机上的选项，每道只有参考答案那一组能过（两种写法）', () => {
  for (const part of FIX_PARTS) {
    const { blanks } = FIXES[part]
    const names = Object.keys(blanks)
    for (const lang of LANGS) {
      const lists = names.map((name) => {
        const choices = blanks[name].choices
        return Array.isArray(choices) ? choices : choices[lang]
      })
      let combos = [{}]
      names.forEach((name, i) => {
        combos = combos.flatMap((c) => lists[i].map((choice) => ({ ...c, [name]: choice })))
      })
      const passed = combos.filter((values) => judgeFix(part, runOne(part, values, lang)).earned[0])
      assert.deepEqual(passed, [ANSWERS[part]], `${part} ${lang}`)
    }
  }
})

// ── 本关三颗星 ──────────────────────────────────────────────────────────────

test('本关三颗星：★1 三张都修对，★2 第二、三张都不浪费，★3 Agent 交出三星参数；HIP、Python 都拿得到三星', () => {
  assert.deepEqual(judge(START_STATE).earned, [false, false, false])
  assert.match(judge(START_STATE).next, /第一张还在越界；第二张还在分岔；第三张还在多搬车；你的 Agent 还没交出三星参数/)
  for (const lang of [0, 1]) {
    const records = Object.fromEntries(FIX_PARTS.map((p) => [p, fixRecord(p, sandbox(p, ANSWERS[p])[lang])]))
    const all = { ...records, agent: true }
    assert.deepEqual(judge(all).earned, [true, true, true], LANGS[lang])
    assert.match(judge(all).next, /三颗星的标准都达到了/)
    // 只修好第一张：★1 成立，第二、三张还在浪费
    assert.deepEqual(judge({ ...START_STATE, oob: records.oob }).earned, [true, false, false])
    // 第二、三张都修好了，第一张还在越界：★2 成立，可 ★1 不成立（useChallenge 一颗都不发）
    assert.deepEqual(judge({ ...all, oob: START_STATE.oob }).earned, [false, true, true])
    // 第二张又改坏了：数不对，★1、★2 都不成立
    assert.deepEqual(judge({ ...all, fork: { correct: false, passed: false } }).earned, [false, false, true])
    // 第三张数对、还在多搬车：★2 不成立
    assert.deepEqual(judge({ ...all, stride: START_STATE.stride }).earned, [true, false, true])
    assert.deepEqual(judge({ ...all, agent: false }).earned, [true, true, false])
  }
})

test('本关的草稿：读坏的数据回到起始状态，过了一定算修对，第一张修对就是过了；成绩单跟着状态写', () => {
  for (const raw of [null, 7, 'x', [], { oob: 'yes' }, { fork: { correct: 1, passed: true } }]) {
    assert.deepEqual(normalizeState(raw), START_STATE, JSON.stringify(raw))
  }
  assert.deepEqual(normalizeState({ stride: { correct: false, passed: true }, oob: { correct: true, passed: false }, agent: true }), {
    ...START_STATE,
    oob: { correct: true, passed: true },
    stride: { correct: true, passed: true },
    agent: true,
  })
  const rows = (state) => boardRows(state).map((r) => [r.key, r.status, r.done])
  assert.deepEqual(rows(START_STATE), [
    ['oob', '还在越界', false],
    ['fork', '数对了，还在分岔', false],
    ['stride', '数对了，还在多搬车', false],
    ['agent', '还没交出三星参数', false],
  ])
  const done = { oob: { correct: true, passed: true }, fork: { correct: true, passed: true }, stride: { correct: false, passed: false }, agent: true }
  assert.deepEqual(rows(done), [
    ['oob', '修好了', true],
    ['fork', '修好了', true],
    ['stride', '数还不对', false],
    ['agent', '交出了三星参数', true],
  ])
})

// ── 探索二：识破题 ─────────────────────────────────────────────────────────

test('识破：改后那次没同步就看表，只量到交出工作单的周期，快了 11.2 倍是假的；补上同步快了 2.8 倍（模拟）', () => {
  assert.deepEqual([SPOT_GPU.before, SPOT_GPU.after], [CHECKUPS.stride.cycles, FIXED.stride.cycles], '报告量的就是第三张修前修后')
  assert.deepEqual([SPOT_REPORT.before, SPOT_REPORT.after], [LAUNCH_CYCLES + SPOT_GPU.before, LAUNCH_CYCLES])
  assert.deepEqual([SPOT_FIXED.before, SPOT_FIXED.after], [LAUNCH_CYCLES + SPOT_GPU.before, LAUNCH_CYCLES + SPOT_GPU.after])
  assert.equal(times(SPOT_REPORT.before, SPOT_REPORT.after), '11.2')
  assert.equal(times(SPOT_FIXED.before, SPOT_FIXED.after), '2.8')
  // 不同步时表停在 GPU 算完之前；同步了，t2 正好落在 GPU 算完的那一刻
  const gpuEnd = (s) => Math.max(...s.segments.filter((x) => x.lane === 'gpu').map((x) => x.to))
  assert.ok(SPOT_REPORT.t2 < gpuEnd(SPOT_REPORT))
  assert.equal(SPOT_FIXED.t2, gpuEnd(SPOT_FIXED))
  assert.deepEqual(spotSession(false), SPOT_REPORT)
  // 只有一个答案，就是没同步
  const answers = SPOT_OPTIONS.filter((o) => o.correct)
  assert.equal(answers.length, 1)
  assert.match(answers[0].label, /没同步就看表/)
})

test('识破：两种写法的计时代码一行对一行；补上同步只多一行，标在最后一次看表之前', () => {
  for (const sync of [false, true]) {
    const [hip, python] = LANGS.map((lang) => spotLines(lang, sync))
    assert.equal(hip.length, python.length)
    assert.deepEqual(hip.map((l) => [l.note, l.mark]), python.map((l) => [l.note, l.mark]))
    assert.ok(hip.length <= 10, '新手村一段代码不超过 10 行')
  }
  const before = spotLines('hip', false)
  const after = spotLines('hip', true)
  assert.equal(after.length, before.length + 1)
  assert.deepEqual(after.flatMap((l, i) => (l.mark ? [i] : [])), [after.length - 2])
  assert.equal(after[after.length - 2].code, 'hipDeviceSynchronize();')
  assert.equal(spotLines('python', true).at(-2).code, 'synchronize()')
})

test('识破：只认第一次锁定的答案；第一次就选对发「识破假加速」徽章，选错、跳过都不发', () => {
  const progress = useProgress()
  const right = SPOT_OPTIONS.findIndex((o) => o.correct)
  const wrong = SPOT_OPTIONS.findIndex((o) => !o.correct)

  unload()
  assert.deepEqual(lockSpot(progress, wrong), [])
  assert.equal(progress.prediction(SPOT_ID).correct, false)
  // 选错以后再选对：不改第一次的答案，也不发徽章
  assert.deepEqual(lockSpot(progress, right), [])
  assert.equal(progress.prediction(SPOT_ID).choice, wrong)
  assert.equal(progress.state.badges['spot-fake-speedup'], undefined)

  unload()
  assert.deepEqual(lockSpot(progress, SPOT_SKIPPED), [])
  assert.equal(progress.state.badges['spot-fake-speedup'], undefined)

  unload()
  assert.deepEqual(lockSpot(progress, right), ['spot-fake-speedup'])
  assert.ok(progress.state.badges['spot-fake-speedup'])
  assert.deepEqual(lockSpot(progress, right), [], '已经锁定过：不再发')
  unload()
})

// ── 挑战二：你的 Agent ─────────────────────────────────────────────────────

/** 按写法跑 kernel：AgentCode 的 worker 跑 HIP 写法；Python 写法把同一个请求换成 Python 风格的源码。 */
const runner = (lang) => (lang === 'hip' ? run : (request) => run({ ...request, source: AGENT_TASK.code.python, lang: 'python' }))

let py
before(async () => {
  py = await loadPyodide()
})
after(() => {
  py = null
})

const template = parseTemplate(STARTER.code)

/** 跑一轮读者的 Agent，写成 AgentCode 的 result（报错照 AgentCode 写成「现象 + 原因 + 怎么改」）。 */
async function agentRun(values, lang) {
  const code = fillTemplate(template, values).source
  const r = await runPyAgent(py, { code, task: { ...AGENT_TASK, start: AGENT_START } }, { run: runner(lang) })
  return {
    stop: r.stop,
    verdict: r.verdict,
    error: r.error ? explainPythonError(r.error) : null,
    log: r.steps.map((s) => ({ action: s.action, observation: s.observation })),
  }
}

/** 两种写法各跑一遍：结果一样、判得一样。 */
async function agentBoth(values) {
  const [hip, python] = await Promise.all(LANGS.map((lang) => agentRun(values, lang)))
  assert.deepEqual(python, hip, JSON.stringify(values))
  return { result: hip, verdict: judgeAgent(hip) }
}

const keysOf = (log) => [...new Set(log.filter((s) => s.action.tool === 'run_kernel').map((s) => configKey(s.action.args)))]

test('Agent：三个空补对，从 block 16、步长 8 出发走 10 步交 block 32、步长 1，控制台三星；和规则 Agent 一样', async () => {
  const { result, verdict } = await agentBoth(STARTER.answers)
  assert.equal(verdict.earned[0], true)
  assert.equal(verdict.error, undefined)
  assert.equal(result.log.length, AGENT_TOUR.steps)
  assert.deepEqual(keysOf(result.log), AGENT_TOUR.path.map(configKey))
  assert.match(verdict.next, /从 block 16、步长 8 出发，你的 Agent 走了 10 步，交了 block 32、步长 1：不多搬，576 个周期/)
  for (const lang of LANGS) {
    const ep = await runAgent(createEnv({ ...AGENT_TASK, start: AGENT_START }, runner(lang), lang), rulePolicy)
    assert.equal(ep.steps.length, AGENT_TOUR.steps, lang)
    assert.deepEqual(keysOf(ep.steps), AGENT_TOUR.path.map(configKey), lang)
  }
})

test('Agent：原样运行、只补一条规则都交了没调好的参数，没过；指向该补的空', async () => {
  const cases = [
    [{}, /交了 block 16、步长 8：搬的车比理想多/, /第 1 个空要从看访存的观察里看出多搬了/],
    [{ ...STARTER.answers, block: 'False' }, /交了 block 16、步长 1：示意时间 1134 个周期，没到 576 个周期以内/, /第 3 个空要看出 block 不是 32 的倍数/],
    [{ ...STARTER.answers, extra: 'False' }, /交了 block 32、步长 8：搬的车比理想多/, /第 1 个空要从看访存的观察里看出多搬了/],
  ]
  for (const [values, symptom, cause] of cases) {
    const { result, verdict } = await agentBoth(values)
    const label = JSON.stringify(values)
    assert.equal(result.stop, 'finish', label)
    assertFailed(verdict, label)
    assert.match(verdict.error.symptom, symptom, label)
    assert.match(verdict.error.cause, cause, label)
  }
})

test('Agent：走满步数、没交卷、代码出错，没过；现象 / 原因 / 怎么改都写了', async () => {
  // 一次只减半：从步长 8 出发还要改 block，15 步不够
  const slow = await agentBoth({ ...STARTER.answers, stride: 'stride // 2' })
  assert.equal(slow.result.stop, 'limit')
  assertFailed(slow.verdict, 'stride // 2')
  assert.match(slow.verdict.error.symptom, /走满了 15 步，你的 Agent 还没交卷/)
  // 步长越改越大：16 不在可选值里，Agent 出错停下
  const double = await agentBoth({ ...STARTER.answers, stride: 'stride * 2' })
  assert.equal(double.result.stop, 'error')
  assertFailed(double.verdict, 'stride * 2')
  assert.match(double.verdict.error.symptom, /stride 只能是 1 \/ 2 \/ 4 \/ 8，收到的是 16/)
  // 没交卷就跑完了
  const end = judgeAgent({ stop: 'end', verdict: null, error: null, log: [] })
  assertFailed(end, 'end')
  assert.match(end.error.fix, /finish\(block=block, stride=stride\)/)
})

test('Agent：手机上 27 种选法，只有参考答案那一组从 block 16、步长 8 出发能过', async () => {
  const names = Object.keys(STARTER.blanks)
  let combos = [{}]
  for (const name of names) combos = combos.flatMap((c) => STARTER.blanks[name].choices.map((choice) => ({ ...c, [name]: choice })))
  assert.equal(combos.length, 27)
  const passed = []
  for (const values of combos) {
    const r = await agentRun(values, 'hip')
    if (judgeAgent(r).earned[0]) passed.push(values)
  }
  assert.deepEqual(passed, [STARTER.answers])
})

test('Agent 的三个空：本关或第 1-14 关的草稿只留模板里有的空、一行以内的字；一个都没有是 null', () => {
  assert.deepEqual(agentValues({ values: { extra: 'a > b', stride: '1', other: 'x' } }), { extra: 'a > b', stride: '1' })
  assert.deepEqual(agentValues({ values: { block: 'block % 32 != 0', extra: 'x\ny', stride: 'y'.repeat(201) } }), { block: 'block % 32 != 0' })
  for (const raw of [null, 3, 'x', { values: null }, { values: { other: '1' } }, { values: { extra: 5 } }]) {
    assert.equal(agentValues(raw), null, JSON.stringify(raw))
  }
})
