import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { loadPyodide } from 'pyodide'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import { explainPythonError, OBSERVATION_KEYS } from '../../docs/course/agent/pyerror.ts'
import { PYODIDE_BYTES, PYODIDE_FILES, PYODIDE_VERSION } from '../../docs/course/agent/pyodide-files.ts'
import { joinThoughts, MAX_OUTPUT_LINES, runPyAgent } from '../../docs/course/agent/pyodide.ts'
import { MAX_STEPS, runAgent, sameAction } from '../../docs/course/agent/react.ts'
import { rulePolicy } from '../../docs/course/agent/rules.ts'
import { VECTOR_ADD_STARTER } from '../../docs/course/agent/starter.ts'
import { allConfigs, VECTOR_ADD } from '../../docs/course/agent/tasks.ts'
import { createEnv, createSyncEnv } from '../../docs/course/agent/tools.ts'
import { run } from '../../docs/sim/lockstep.ts'

/**
 * 读者自己写的 Python Agent（A-02）：在 Node 里加载真正的 Pyodide（和浏览器里同一个包、同一个版本），
 * 跑 1-14 的模板。三个空补对拿三星、每一步和规则 Agent 一样；补错哪个空都拿不到三星；
 * 步数上限、工具用错、交卷以后再调用、各种 Python 错误写成「现象 + 原因 + 怎么改」。
 */

let py
before(async () => {
  py = await loadPyodide()
})
after(() => {
  py = null
})

const template = parseTemplate(VECTOR_ADD_STARTER.code)
const codeWith = (values = {}) => fillTemplate(template, values).source
const ANSWERS = VECTOR_ADD_STARTER.answers
const withStart = (start) => ({ ...VECTOR_ADD, start })
const agent = (code, start = VECTOR_ADD.start, maxSteps) => runPyAgent(py, { code, task: withStart(start), maxSteps }, { run })
const actions = (steps) => steps.map((s) => `${s.action.tool}(${s.action.args.block},${s.action.args.stride})`)

test('自托管的 Pyodide 文件：清单里的字节数、版本和 npm 包一致，依赖写死了版本', () => {
  const require = createRequire(import.meta.url)
  const dir = path.dirname(require.resolve('pyodide/package.json'))
  assert.equal(require('pyodide/package.json').version, PYODIDE_VERSION)
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.dependencies.pyodide, PYODIDE_VERSION, 'package.json 里的 pyodide 要写精确版本')
  for (const f of PYODIDE_FILES) assert.equal(statSync(path.join(dir, f.name)).size, f.bytes, f.name)
  assert.equal(PYODIDE_BYTES, PYODIDE_FILES.reduce((sum, f) => sum + f.bytes, 0))
})

test('模板原样运行：能跑但不好，第一轮就交卷，只拿 ★1', async () => {
  const r = await agent(codeWith())
  assert.equal(r.stop, 'finish')
  assert.equal(r.error, null)
  assert.deepEqual(r.verdict.config, VECTOR_ADD.start)
  assert.deepEqual(r.verdict.earned, [true, false, false])
  assert.deepEqual(actions(r.steps), ['run_kernel(48,4)', 'measure(48,4)', 'inspect_memory(48,4)', 'finish(48,4)'])
})

test('三个空补对：从默认起点拿三星，每一步都和规则 Agent 一样', async () => {
  const r = await agent(codeWith(ANSWERS))
  assert.equal(r.stop, 'finish')
  assert.deepEqual(r.verdict.earned, [true, true, true])
  assert.deepEqual(r.verdict.config, { block: 64, stride: 1 })
  assert.equal(r.steps.length, 10)
  assert.ok(r.steps.every((s) => s.same), '每一步都和规则 Agent 选得一样')
  assert.deepEqual(r.rule, { steps: 10, stop: 'finish', verdict: r.verdict })
  // think() 写下的想法记在下一个行动前面；量、看访存这两步模板里没写想法
  assert.match(r.steps[0].thought, /^起点是 block 48、步长 4。/)
  assert.equal(r.steps[1].thought, '')
  assert.match(r.steps[3].thought, /^搬的车比理想多/)
  assert.match(r.steps[6].thought, /^block 48 不是 32 的倍数/)
  assert.match(r.steps[9].thought, /^576 个周期（模拟）/)
})

test('三个空补对：28 个起点都拿三星，走法和规则 Agent 一模一样', async () => {
  for (const start of allConfigs(VECTOR_ADD)) {
    const r = await agent(codeWith(ANSWERS), start)
    const rule = await runAgent(createEnv(withStart(start), run), rulePolicy)
    const label = `起点 ${start.block}×${start.stride}`
    assert.equal(r.stop, 'finish', label)
    assert.deepEqual(r.verdict.earned, [true, true, true], label)
    assert.deepEqual(actions(r.steps), actions(rule.steps), label)
    assert.ok(r.steps.length <= MAX_STEPS, label)
  }
})

test('只补对两个空拿不到三星：每个空都管用', async () => {
  const wrong = async (name, value) => agent(codeWith({ ...ANSWERS, [name]: value }))
  // 看不出多搬了：先把 block 改成 64，步长一直是 4
  const extra = await wrong('extra', 'False')
  assert.deepEqual([extra.stop, extra.verdict.config, extra.verdict.earned], ['finish', { block: 64, stride: 4 }, [true, false, false]])
  // 看出多搬了，步长却没改：原地打转，走满 15 步也没交卷
  const stride = await wrong('stride', 'stride')
  assert.deepEqual([stride.stop, stride.verdict, stride.steps.length], ['limit', null, MAX_STEPS])
  assert.deepEqual(new Set(actions(stride.steps).map((a) => a.replace(/^\w+/, ''))), new Set(['(48,4)']))
  // block 一直是 48：最后一个 wave 有 lane 空着，还多搬了几车
  const block = await wrong('block', 'False')
  assert.deepEqual([block.stop, block.verdict.config, block.verdict.earned], ['finish', { block: 48, stride: 1 }, [true, false, false]])
})

test('步数上限：走满就停，不执行第 maxSteps + 1 步；except Exception 也接不住', async () => {
  const short = await agent(codeWith(ANSWERS), VECTOR_ADD.start, 4)
  assert.deepEqual([short.stop, short.steps.length, short.maxSteps], ['limit', 4, 4])
  // 读者想把「步数用完」当成普通异常吞掉：照样停下，不会变成死循环
  const greedy = await agent('while True:\n    try:\n        measure(block=64, stride=1)\n    except Exception:\n        pass')
  assert.deepEqual([greedy.stop, greedy.steps.length, greedy.error], ['limit', MAX_STEPS, null])
})

test('参数不在可选值里：不执行、不算一步，在调用它的那一行报错', async () => {
  const r = await agent(codeWith({ ...ANSWERS, stride: 'stride * 2' }))
  assert.equal(r.stop, 'error')
  assert.equal(r.steps.length, 6)
  assert.deepEqual(actions(r.steps).slice(3), ['run_kernel(48,8)', 'measure(48,8)', 'inspect_memory(48,8)'])
  assert.equal(r.error.type, 'AgentError')
  assert.equal(r.error.line, 5)
  assert.match(r.error.message, /stride 只能是 1 \/ 2 \/ 4 \/ 8，收到的是 16/)
  const text = explainPythonError(r.error)
  assert.match(text.symptom, /^运行到第 5 行停下了：stride 只能是/)
  // 参数不是整数：Python 那边先挡住
  const notInt = await agent(codeWith({ ...ANSWERS, stride: '"1"' }))
  assert.equal(notInt.error.type, 'TypeError')
  assert.match(notInt.error.message, /run_kernel 的 stride 要是整数，收到的是 '1'/)
})

test('交卷以后不能再调用工具；没交卷就跑完了是 end', async () => {
  const twice = await agent('finish(block=64, stride=1)\nmeasure(block=64, stride=1)')
  assert.equal(twice.stop, 'finish')
  assert.deepEqual(twice.verdict.earned, [true, true, true])
  assert.equal(twice.steps.length, 1)
  assert.deepEqual([twice.error.type, twice.error.line], ['AgentError', 2])
  assert.match(explainPythonError(twice.error).fix, /finish 放在最后/)
  const quiet = await agent('memory = inspect_memory(block=64, stride=1)')
  assert.deepEqual([quiet.stop, quiet.verdict, quiet.steps.length], ['end', null, 1])
})

test('读者代码的错误：只留读者代码里的那几层，写成现象 + 原因 + 怎么改', async () => {
  // 中文括号：语法错误，一步也没走；指到第 1 个空所在的第 8 行
  const wide = await agent(codeWith({ ...ANSWERS, extra: 'memory["transactions"] > memory["ideal"]）' }))
  assert.deepEqual([wide.stop, wide.steps.length, wide.error.type, wide.error.line], ['error', 0, 'SyntaxError', 8])
  const where = (line) => (line === 8 ? '第 1 个空：多搬了吗' : null)
  const w = explainPythonError(wide.error, where)
  assert.equal(w.symptom, '第 8 行（第 1 个空：多搬了吗）的写法 Python 看不懂，Agent 一步也没有走。')
  assert.match(w.cause, /中文的标点「）」/)
  // 键名写错：KeyError，列出能用的键
  const key = await agent(codeWith({ ...ANSWERS, extra: 'memory["transaction"] > memory["ideal"]' }))
  assert.deepEqual([key.error.type, key.error.line, key.steps.length], ['KeyError', 8, 3])
  assert.doesNotMatch(key.error.raw, /<exec>|run_agent/, '原文里没有外壳自己的那几层')
  assert.match(explainPythonError(key.error).fix, /inspect_memory 给回 accesses、transactions、ideal、efficiency/)
  // 名字拼错：Python 猜到想写什么
  const name = await agent(codeWith({ ...ANSWERS, block: 'blok % 32 != 0' }))
  assert.deepEqual([name.error.type, name.error.line], ['NameError', 11])
  assert.equal(explainPythonError(name.error).fix, '是不是想写 block？')
  // 用点取字典里的值
  const attr = await agent(codeWith({ ...ANSWERS, extra: 'memory.transactions > memory.ideal' }))
  assert.equal(attr.error.type, 'AttributeError')
  assert.equal(explainPythonError(attr.error).fix, '写成 ["transactions"]，例如 memory["transactions"]。')
  // 拿字典和数字比大小
  const type = await agent(codeWith({ ...ANSWERS, extra: 'memory > memory["ideal"]' }))
  assert.equal(type.error.type, 'TypeError')
  assert.match(explainPythonError(type.error).cause, /拿整个观察字典去和数字比大小/)
})

test('print 的内容留下来，太多时截断；每次运行的名字互不影响', async () => {
  const printed = await agent(codeWith({ ...ANSWERS, extra: 'print("看访存", memory["transactions"]) or memory["transactions"] > memory["ideal"]' }))
  assert.deepEqual(printed.output, ['看访存 384', '看访存 156', '看访存 96'])
  assert.equal(printed.truncated, false)
  const flood = await agent(`for i in range(${MAX_OUTPUT_LINES + 50}):\n    print(i)`)
  assert.deepEqual([flood.output.length, flood.output.at(-1), flood.truncated], [MAX_OUTPUT_LINES, String(MAX_OUTPUT_LINES - 1), true])
  await agent('leftover = 1')
  const fresh = await agent('print(leftover)')
  assert.equal(fresh.error.type, 'NameError')
})

test('观察的键：报 KeyError 时列出的键和工具真正给回的一致；同步环境和 A-01 的环境给的观察一样', async () => {
  const sync = createSyncEnv(VECTOR_ADD, run)
  const env = createEnv(VECTOR_ADD, run)
  for (const config of allConfigs(VECTOR_ADD)) {
    for (const [tool, keys] of Object.entries(OBSERVATION_KEYS)) {
      const action = { tool, args: config }
      const o = sync.act(action)
      assert.deepEqual(Object.keys(o.data), keys, tool)
      assert.deepEqual(o, await env.act(action), `${tool} ${config.block}×${config.stride}`)
    }
  }
  assert.deepEqual(sync.act({ tool: 'measure', args: { block: 50, stride: 1 } }).ok, false)
})

test('想法接成一段：前一句有标点就直接接，否则空一格；太长截断', () => {
  assert.equal(joinThoughts(['先跑一次。', ' 再量一量。']), '先跑一次。再量一量。')
  assert.equal(joinThoughts(['step one', 'step two', '', '  ']), 'step one step two')
  assert.equal(joinThoughts([]), '')
  const long = joinThoughts(['想'.repeat(600)])
  assert.equal(long, `${'想'.repeat(500)}……`)
})

test('和规则 Agent 对比：问的是规则 Agent 面对读者自己的历史会怎么选', async () => {
  // 读者先计时、再跑：第一步规则 Agent 会先跑（不一样）；第二步读者的历史里只有计时，
  // 规则 Agent 还没见过这组参数算没算对，也会选「跑一次」（一样）。
  // 要是拿规则 Agent 自己那一轮来比，第二步它是在计时，就成了「不一样」。
  const r = await agent('measure(block=48, stride=4)\nrun_kernel(block=48, stride=4)')
  assert.deepEqual(r.steps.map((s) => s.same), [false, true])
  assert.ok(sameAction(r.steps[0].rule.action, { tool: 'run_kernel', args: { block: 48, stride: 4 } }))
  assert.deepEqual(r.steps[1].rule, rulePolicy({ task: VECTOR_ADD, steps: r.steps.slice(0, 1), maxSteps: MAX_STEPS }))
})
