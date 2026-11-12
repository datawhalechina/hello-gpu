import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { loadPyodide } from 'pyodide'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import { explainPythonError } from '../../docs/course/agent/pyerror.ts'
import { runPyAgent } from '../../docs/course/agent/pyodide.ts'
import { runAgent } from '../../docs/course/agent/react.ts'
import { rulePolicy } from '../../docs/course/agent/rules.ts'
import { allConfigs, configKey } from '../../docs/course/agent/tasks.ts'
import { createEnv, createSyncEnv } from '../../docs/course/agent/tools.ts'
import { missingErrorParts } from '../../docs/course/useChallenge.ts'
import { run } from '../../docs/sim/lockstep.ts'
import {
  BEST, BUDGET_CONFIGS, HINTS, MEMORY_AT_START, RULE_CASES, SPACE, START, STARTER, STEP_LIMIT, SWEEP_STEPS,
  TASK, TIMING_AT_START, TOUR, VARIANTS,
  dictText, judge, normalizeDraft, roundsOf, ruleWalk, startMarks, tryText, walkText,
} from '../../docs/novice/first-agent/challenge.ts'

/**
 * 1-14 造你的第一个 Agent。Agent 调 A-01 的向量加法（1000 个数，调 block 和步长），读者在 Python 模板里补三个空（A-02），
 * 工具在模拟器上跑。正文和探索写死的周期数、车次拿模拟器把两种写法都核对一遍；探索二的规则开关（ruleWalk）
 * 拿 Pyodide 跑真的模板逐个核对；挑战的三颗星各自成立和不成立，两种写法判得一样，手机上 27 种选法的星数。
 */

const LANGS = ['hip', 'python']
const key = configKey
const keys = (configs) => configs.map(configKey)

/** 按写法跑 kernel：AgentCode 的 worker 跑 HIP 写法；Python 写法把同一个请求换成 Python 风格的源码。 */
const runner = (lang) => (lang === 'hip' ? run : (request) => run({ ...request, source: TASK.code.python, lang: 'python' }))

let py
before(async () => {
  py = await loadPyodide()
})
after(() => {
  py = null
})

const template = parseTemplate(STARTER.code)
const codeWith = (values = {}) => fillTemplate(template, values).source
const ANSWERS = STARTER.answers

/** 跑一轮读者的 Agent，写成 AgentCode 的 result 里的一轮（报错照 AgentCode 写成「现象 + 原因 + 怎么改」）。 */
async function runOne(code, start, lang, maxSteps) {
  const r = await runPyAgent(py, { code, task: { ...TASK, start }, maxSteps }, { run: runner(lang) })
  return {
    start,
    stop: r.stop,
    verdict: r.verdict,
    steps: r.steps.length,
    error: r.error ? explainPythonError(r.error) : null,
    log: r.steps.map((s) => ({ action: s.action, observation: s.observation })),
  }
}

/** 照 AgentCode：起点这一轮交卷了（没出错），再从 27 组各跑一轮。 */
async function bench(values, lang = 'hip') {
  const code = codeWith(values)
  const main = await runOne(code, START, lang)
  const variants = []
  if (main.stop === 'finish' && !main.error) for (const start of VARIANTS) variants.push(await runOne(code, start, lang))
  return { ...main, variants }
}

/** 两种写法各跑一遍：交来的结果一样、判得一样，交回 HIP 那一次的结果和判定。 */
async function judgeBoth(values) {
  const [hip, python] = await Promise.all(LANGS.map((lang) => bench(values, lang)))
  assert.deepEqual(python, hip, JSON.stringify(values))
  return { result: hip, verdict: judge(hip) }
}

// ── 正文里的数 ──────────────────────────────────────────────────────────────

test('搜索空间：28 组的周期数、车次和工具交回来的观察一致，两种写法一样；最快的 4 组都是 576 个周期', async () => {
  assert.equal(SPACE.length, TASK.blocks.length * TASK.strides.length)
  assert.deepEqual(keys(SPACE.map((c) => c.config)), keys(allConfigs(TASK)))
  for (const lang of LANGS) {
    const env = createEnv(TASK, run, lang)
    for (const cell of SPACE) {
      const act = async (tool) => (await env.act({ tool, args: cell.config })).data
      const label = `${lang} ${key(cell.config)}`
      assert.equal((await act('run_kernel')).correct, true, label)
      assert.equal((await act('measure')).cycles, cell.cycles, label)
      const memory = await act('inspect_memory')
      assert.deepEqual([memory.transactions, memory.ideal], [cell.transactions, cell.ideal], label)
    }
  }
  assert.deepEqual(keys(BEST.map((c) => c.config)), ['32x1', '64x1', '128x1', '256x1'])
  assert.equal(Math.min(...SPACE.map((c) => c.cycles)), TASK.bestCycles)
  // 起点这一圈：正文写出来的两个字典就是 measure、inspect_memory 交回来的
  const sync = createSyncEnv(TASK, run)
  assert.deepEqual(sync.act({ tool: 'measure', args: START }).data, TIMING_AT_START)
  assert.deepEqual(sync.act({ tool: 'inspect_memory', args: START }).data, MEMORY_AT_START)
  assert.equal(dictText(MEMORY_AT_START), '{ "accesses": 132, "transactions": 384, "ideal": 132, "efficiency": 0.344 }')
})

test('热身：上一关的规则 Agent 从 block 48、步长 4 出发，28 组里只试了 3 组、走 10 步', async () => {
  for (const lang of LANGS) {
    const ep = await runAgent(createEnv({ ...TASK, start: START }, run, lang), rulePolicy)
    const tried = [...new Map(ep.steps.filter((s) => s.action.tool !== 'finish').map((s) => [key(s.action.args), s.action.args])).values()]
    assert.deepEqual(keys(tried), keys(TOUR.path), lang)
    assert.equal(ep.steps.length, TOUR.steps, lang)
  }
  assert.deepEqual(START, TASK.start)
})

test('探索一：全试一遍每组 2 步、一共 57 步；一轮 15 步只够试 7 组；试几组以后的一句', () => {
  assert.equal(SWEEP_STEPS, 57)
  assert.equal(BUDGET_CONFIGS, 7)
  assert.ok(BUDGET_CONFIGS * 2 + 1 <= STEP_LIMIT && (BUDGET_CONFIGS + 1) * 2 + 1 > STEP_LIMIT)
  const all = SPACE.map((c) => c.config)
  // 解读里的数：试了几组、用了几步、目前最快的那组（一样快的取先试的）、一轮的步数用完没有
  assert.match(tryText([]), /一组都还没试/)
  assert.match(tryText([START]), /试了 1 组，用了 2 步。.*block 48、步长 4，1748 个周期/)
  assert.match(tryText([{ block: 128, stride: 1 }, { block: 32, stride: 1 }]), /用了 4 步。.*block 128、步长 1，576 个周期/)
  assert.match(tryText(all.slice(0, 7)), /用了 14 步.*只剩交卷那 1 步.*block 32、步长 1，576 个周期/)
  assert.match(tryText(all.slice(0, 8)), /用了 16 步，超出一轮的 15 步/)
  assert.match(tryText(all), /用了 56 步.*一共 57 步。最快的 4 组都是 576 个周期/)
})

// ── 探索二：规则开关就是模板的三个空 ────────────────────────────────────────

/** 规则一开着：第 1、2 个空填对；规则二开着：第 3 个空填对；关着：初始内容。 */
function valuesOf(rules) {
  return {
    ...(rules.stride ? { extra: ANSWERS.extra, stride: ANSWERS.stride } : {}),
    ...(rules.block ? { block: ANSWERS.block } : {}),
  }
}

const RULES = [
  { stride: false, block: false },
  { stride: true, block: false },
  { stride: false, block: true },
  { stride: true, block: true },
]

test('ruleWalk 和真的 Python 模板一步不差：28 个起点 × 4 种开法 × 两种写法', async () => {
  for (const rules of RULES) {
    const code = codeWith(valuesOf(rules))
    for (const start of allConfigs(TASK)) {
      const walk = ruleWalk(start, rules)
      for (const lang of LANGS) {
        const r = await runOne(code, start, lang)
        const label = `${JSON.stringify(rules)} ${key(start)} ${lang}`
        assert.equal(r.stop, walk.stop, label)
        assert.equal(r.steps, walk.steps, label)
        assert.deepEqual(keys(roundsOf(r.log)), keys(walk.path), label)
        assert.deepEqual(r.verdict && { config: r.verdict.config, earned: r.verdict.earned }, walk.verdict, label)
      }
    }
  }
})

test('ruleWalk 的步数上限和 Python 一样：圈走到一半、交卷那一步都会停在上限', async () => {
  const code = codeWith(valuesOf({ stride: true, block: true }))
  for (const maxSteps of [2, 3, 4, 9, 10]) {
    const walk = ruleWalk(START, { stride: true, block: true }, maxSteps)
    const r = await runOne(code, START, 'hip', maxSteps)
    assert.deepEqual([r.stop, r.steps, keys(roundsOf(r.log))], [walk.stop, walk.steps, keys(walk.path)], `maxSteps ${maxSteps}`)
  }
  // 少一步交不了卷，正好够就交卷
  assert.equal(ruleWalk(START, { stride: true, block: true }, 9).stop, 'limit')
  assert.equal(ruleWalk(START, { stride: true, block: true }, 10).stop, 'finish')
})

test('探索二的四种开法：两条都会走到三星，少一条停在半路', () => {
  const brief = (w) => [keys(w.path), w.steps, w.verdict && key(w.verdict.config), w.verdict?.earned]
  assert.deepEqual(brief(RULE_CASES.none), [['48x4'], 4, '48x4', [true, false, false]])
  assert.deepEqual(brief(RULE_CASES.stride), [['48x4', '48x1'], 7, '48x1', [true, false, false]])
  assert.deepEqual(brief(RULE_CASES.block), [['48x4', '64x4'], 7, '64x4', [true, false, false]])
  assert.deepEqual(brief(RULE_CASES.both), [['48x4', '48x1', '64x1'], 10, '64x1', [true, true, true]])
  assert.deepEqual(keys(RULE_CASES.both.path), keys(TOUR.path), '两条都会，走的就是上一关规则 Agent 那一轮')
  assert.match(walkText(RULE_CASES.none), /试了 1 组，第 4 步交卷：block 48、步长 4，★☆☆.*搬了 384 车，理想只要 132 车/)
  assert.match(walkText(RULE_CASES.stride), /试了 2 组，第 7 步交卷：block 48、步长 1，★☆☆.*block 48 不是 32 的倍数.*876 个周期/)
  assert.match(walkText(RULE_CASES.block), /试了 2 组，第 7 步交卷：block 64、步长 4，★☆☆.*搬了 384 车，理想只要 96 车/)
  assert.match(walkText(RULE_CASES.both), /试了 3 组，第 10 步交卷：block 64、步长 1，★★★.*576 个周期/)
  assert.match(walkText(ruleWalk(START, { stride: true, block: true }, 9)), /走满了 9 步，没有交卷/)
})

// ── 挑战：补全你的 Agent ────────────────────────────────────────────────────

test('三颗星：三个空补对，起点和另外 27 组都调到又快又省，两种写法判得一样', async () => {
  const { result, verdict } = await judgeBoth(ANSWERS)
  assert.deepEqual(verdict.earned, [true, true, true])
  assert.equal(verdict.error, undefined)
  assert.equal(result.variants.length, 27)
  assert.deepEqual(keys(VARIANTS), keys(allConfigs(TASK).filter((c) => key(c) !== key(START))))
  assert.match(verdict.next, /走了 10 步，交了 block 64、步长 1：不多搬，576 个周期.*另外 27 组当起点，也都调到又快又省/)
  assert.ok(startMarks(result).every((m) => m.stars === 3 && m.stop === 'finish'))
})

test('模板原样运行：第一圈就交卷，只有 ★1；下一步指向第 1 个空', async () => {
  const { result, verdict } = await judgeBoth({})
  assert.deepEqual(verdict.earned, [true, false, false])
  assert.match(verdict.next, /交了 block 48、步长 4：搬了 384 车，理想只要 132 车（模拟），多搬了。第 1 个空要从看访存的观察里看出多搬了/)
  // 本来就是最快的 4 组当起点，原样运行也交出三星参数
  assert.deepEqual(startMarks(result).filter((m) => m.stars === 3).map((m) => key(m.config)), ['32x1', '64x1', '128x1', '256x1'])
})

test('★2 不成立：只补了规则一停在 block 48、步长 1；只补了规则二停在 block 64、步长 4', async () => {
  const noBlock = await judgeBoth({ ...ANSWERS, block: 'False' })
  assert.deepEqual(noBlock.verdict.earned, [true, false, false])
  assert.match(noBlock.verdict.next, /交了 block 48、步长 1：block 48 不是 32 的倍数.*第 3 个空要看出 block 不是 32 的倍数/)
  const noExtra = await judgeBoth({ ...ANSWERS, extra: 'False' })
  assert.deepEqual(noExtra.verdict.earned, [true, false, false])
  assert.match(noExtra.verdict.next, /交了 block 64、步长 4：搬了 384 车，理想只要 96 车/)
})

test('★1 不成立：原地打转、出错、参数不在可选值里；一颗星都不发，现象 / 原因 / 怎么改都写了', async () => {
  // 看出多搬了，步长却没改：走满 15 步没交卷
  const spin = await judgeBoth({ ...ANSWERS, stride: 'stride' })
  assert.equal(spin.result.stop, 'limit')
  assert.deepEqual(spin.verdict.earned, [false, false, false])
  assert.match(spin.verdict.error.symptom, /走满了 15 步，你的 Agent 还没交卷：最后几圈一直停在 block 48、步长 4/)
  assert.match(spin.verdict.error.cause, /原地打转。看出多搬了，可第 2 个空给的新步长还是 4/)
  assert.equal(spin.result.variants.length, 0, '起点这一轮没交卷，不换起点再跑')
  // 中文括号：语法错误，一步也没走
  const wide = await judgeBoth({ ...ANSWERS, extra: 'memory["transactions"] > memory["ideal"]）' })
  assert.equal(wide.result.stop, 'error')
  assert.match(wide.verdict.error.symptom, /的写法 Python 看不懂，Agent 一步也没有走/)
  // 步长越改越大：16 不在可选值里，AgentError
  const double = await judgeBoth({ ...ANSWERS, stride: 'stride * 2' })
  assert.equal(double.result.stop, 'error')
  assert.match(double.verdict.error.symptom, /stride 只能是 1 \/ 2 \/ 4 \/ 8，收到的是 16/)
  for (const v of [spin.verdict, wide.verdict, double.verdict]) {
    assert.deepEqual(v.earned, [false, false, false])
    assert.deepEqual(missingErrorParts(v.error), [])
    assert.equal(v.next, v.error.fix)
  }
})

test('★3 不成立：起点能调到三星，换了起点不行（写死了数、改得太慢、block 改不动）', async () => {
  const cases = [
    // block == 48：只认起点的 48，block 16、100 都不改
    [{ ...ANSWERS, block: 'block == 48' }, '16x1', /从 block 16、步长 1 出发，交了 block 16、步长 1：block 16 不是 32 的倍数/],
    // stride - 3：从 4 改到 1 碰巧对，从 2、8 出发就出了可选值
    [{ ...ANSWERS, stride: 'stride - 3' }, '16x2', /从 block 16、步长 2 出发：运行到第 \d+ 行停下了/],
    // block % 64 != 0：32 的倍数里只认 64 的倍数，block 32 往上取整还是 32，原地打转
    [{ ...ANSWERS, block: 'block % 64 != 0' }, '16x1', /从 block 16、步长 1 出发：走满了 15 步.*一直停在 block 32、步长 1.*第 3 个空说 block 32 不合适/],
    // stride // 2：一次只减半，从步长 8 出发还要改 block 时，15 步不够
    [{ ...ANSWERS, stride: 'stride // 2' }, '16x8', /从 block 16、步长 8 出发：走满了 15 步.*一次只改一点/],
  ]
  for (const [values, first, message] of cases) {
    const { result, verdict } = await judgeBoth(values)
    const label = JSON.stringify(values)
    assert.deepEqual(verdict.earned, [true, true, false], label)
    assert.match(verdict.next, message, label)
    assert.match(verdict.next, /判断里别写死某一个起点的数/, label)
    // 表上第一个没调好的格子就是 next 里说的那一个
    assert.equal(key(startMarks(result).find((m) => m.stars !== 3).config), first, label)
  }
})

test('★3 只认跑完的：换起点的几轮少了（停下、出了问题），就不算成立', async () => {
  const full = await bench(ANSWERS)
  // 按 VARIANTS 的顺序跑：前 10 组跑完了，第 11 组（跳过起点 48 × 4 以后的 48 × 8）没有结果
  const cut = { ...full, variants: full.variants.slice(0, 10) }
  const v = judge(cut)
  assert.deepEqual(v.earned, [true, true, false])
  assert.match(v.next, /有 17 组没调到又快又省。从 block 48、步长 8 出发的那一轮没有跑完。再运行一次，等换起点的几轮都跑完。$/)
  assert.deepEqual(startMarks(cut).filter((m) => m.stop === null).length, 17)
})

test('手机上的选项：27 种选法里只有三个空都选对才拿三星；每种都判得出来', async () => {
  const names = Object.keys(STARTER.blanks)
  const tally = { 0: 0, 1: 0, 2: 0, 3: 0 }
  for (const a of STARTER.blanks[names[0]].choices) {
    for (const b of STARTER.blanks[names[1]].choices) {
      for (const c of STARTER.blanks[names[2]].choices) {
        const values = { [names[0]]: a, [names[1]]: b, [names[2]]: c }
        const v = judge(await bench(values))
        const stars = v.earned.filter(Boolean).length
        tally[stars] += 1
        if (stars === 3) assert.deepEqual(values, ANSWERS)
        if (!v.earned[0]) assert.deepEqual(missingErrorParts(v.error), [], JSON.stringify(values))
      }
    }
  }
  assert.equal(tally[3], 1)
  assert.equal(tally[2], 0, '手机上拿得到 ★2 的选法也一定拿得到 ★3')
  assert.equal(tally[0] + tally[1] + tally[2] + tally[3], 27)
})

test('提示：答案就是 starter.ts 的参考答案；方向提示不漏答案，位置提示指到观察的键', () => {
  for (const value of Object.values(ANSWERS)) assert.ok(HINTS.answerCode.includes(value), value)
  assert.doesNotMatch(HINTS.direction, /transactions|% 32/)
  assert.match(HINTS.location, /memory\["transactions"\]/)
})

test('草稿：只留模板里有的空、一行以内的文字；读坏了是空的', () => {
  assert.deepEqual(normalizeDraft({ values: ANSWERS }), { values: { ...ANSWERS } })
  assert.deepEqual(normalizeDraft({ values: { extra: 'True', other: 'x', block: 3, stride: 'a\nb' } }), { values: { extra: 'True' } })
  assert.deepEqual(normalizeDraft({ values: { extra: 'x'.repeat(201) } }), { values: {} })
  for (const raw of [null, undefined, 'x', 3, {}, { values: 'x' }, { values: null }, []]) {
    assert.deepEqual(normalizeDraft(raw), { values: {} }, JSON.stringify(raw))
  }
})
