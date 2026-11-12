import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_STEPS, runAgent } from '../../docs/course/agent/react.ts'
import { rulePolicy } from '../../docs/course/agent/rules.ts'
import { allConfigs, configKey, VECTOR_ADD } from '../../docs/course/agent/tasks.ts'
import { createEnv } from '../../docs/course/agent/tools.ts'
import { run } from '../../docs/sim/lockstep.ts'

/**
 * Agent 的 ReAct 循环（A-01）：工具在模拟器上给出的观察、规则 Agent 收敛到三星、步数上限、
 * 拿读者的历史问规则 Agent「换你会选什么」。周期数、车次都是模拟值（params.ts 的默认价钱）。
 */

const LANGS = ['hip', 'python']
const TOOL_NAMES = ['run_kernel', 'measure', 'inspect_memory', 'finish']
const act = (tool, block, stride) => ({ tool, args: { block, stride } })
const withStart = (start, task = VECTOR_ADD) => ({ ...task, start })

/** 去掉边界检查的向量加法：多出来的线程读写到数组外面。 */
const UNGUARDED = {
  ...VECTOR_ADD,
  code: {
    hip: `__global__ void add(const float* a, const float* b, float* c, int n, int stride) {
    int first = (blockIdx.x * blockDim.x + threadIdx.x) * stride;
    for (int k = 0; k < stride; k++) {
        int i = first + k;
        c[i] = a[i] + b[i];
    }
}`,
    python: `@kernel
def add(a, b, c, n, stride):
    first = (blockIdx.x * blockDim.x + threadIdx.x) * stride
    for k in range(stride):
        i = first + k
        c[i] = a[i] + b[i]`,
  },
}

test('手算：block 64、步长 1 和 block 32、步长 2 的观察', async () => {
  for (const lang of LANGS) {
    const env = createEnv(VECTOR_ADD, run, lang)
    // block 64、步长 1：1000 个数要 16 组，一共 1024 个线程，32 个 wave
    assert.deepEqual((await env.act(act('run_kernel', 64, 1))).data, { correct: true, wrong: 0, out_of_bounds: 0, blocks: 16, threads: 1024 }, lang)
    // 每个 wave 6 步（first、for 的第一次判断、i、if、c[i] = …、k++ 再判断）：计算 32 × 6 = 192；
    // 读 a、读 b、写 c 各一车，访存 32 × 3 × 4 = 384。最后一个 wave 的 c[i] = … 只有 992–999 这 8 个 lane 在干活
    const t64 = (await env.act(act('measure', 64, 1))).data
    assert.deepEqual(t64, { cycles: 576, compute: 192, memory: 384, sync: 0, lane_utilization: Math.round(((192 * 32 - 24) / (192 * 32)) * 1000) / 1000 }, lang)
    assert.deepEqual((await env.act(act('inspect_memory', 64, 1))).data, { accesses: 96, transactions: 96, ideal: 96, efficiency: 1 }, lang)

    // block 32、步长 2：500 个线程、16 组，每个 wave 2 + 2 × 4 = 10 步，计算 160；
    // 同一步里相邻 lane 隔 2 个数，32 个 lane 要的数跨 2 车：2 车 × 3 个数组 × 2 轮 × 16 个 wave × 4 = 768
    const t32 = (await env.act(act('measure', 32, 2))).data
    assert.deepEqual([t32.cycles, t32.compute, t32.memory, t32.sync], [928, 160, 768, 0], lang)
    assert.deepEqual((await env.act(act('inspect_memory', 32, 2))).data, { accesses: 96, transactions: 192, ideal: 96, efficiency: 0.5 }, lang)
    const done = await env.act(act('finish', 32, 2))
    assert.deepEqual(done.verdict, { config: { block: 32, stride: 2 }, earned: [true, false, false], correct: true, cycles: 928, efficiency: 0.5 }, lang)
    assert.equal(done.data.stars, 1, lang)
  }
})

test('每一组参数都算得对，两种写法的观察逐项相同；★3 的门槛正好是最短的示意时间', async () => {
  const envs = LANGS.map((lang) => createEnv(VECTOR_ADD, run, lang))
  let shortest = Number.POSITIVE_INFINITY
  const three = []
  for (const c of allConfigs(VECTOR_ADD)) {
    const [hip, py] = await Promise.all(envs.map((env) => Promise.all(TOOL_NAMES.map((tool) => env.act(act(tool, c.block, c.stride))))))
    assert.deepEqual(py, hip, configKey(c))
    assert.equal(hip[0].data.correct, true, configKey(c))
    shortest = Math.min(shortest, hip[1].data.cycles)
    if (hip[3].verdict.earned.every(Boolean)) three.push(configKey(c))
  }
  assert.equal(VECTOR_ADD.bestCycles, shortest)
  // 三星：步长 1、block 是 32 的倍数
  assert.deepEqual(three, ['32x1', '64x1', '128x1', '256x1'])
})

test('规则 Agent：从起点 block 48、步长 4 出发，先改步长、再改 block，交卷拿到三星', async () => {
  const ep = await runAgent(createEnv(VECTOR_ADD, run), rulePolicy)
  assert.equal(ep.stop, 'finish')
  assert.deepEqual(ep.verdict.earned, [true, true, true])
  const visited = [...new Set(ep.steps.map((s) => configKey(s.action.args)))]
  assert.deepEqual(visited, ['48x4', '48x1', '64x1'])
  assert.equal(ep.steps.at(-1).action.tool, 'finish')
})

test('规则 Agent：从任何一组参数出发都在步数上限内交卷拿到三星；先确认算对再计时，看过访存才换参数', async () => {
  const thoughts = []
  for (const start of allConfigs(VECTOR_ADD)) {
    const task = withStart(start)
    const [hip, py, again] = await Promise.all([
      runAgent(createEnv(task, run, 'hip'), rulePolicy),
      runAgent(createEnv(task, run, 'python'), rulePolicy),
      runAgent(createEnv(task, run, 'hip'), rulePolicy),
    ])
    const where = configKey(start)
    // 确定性：同样的输入同样的过程；两种写法也一样
    assert.deepEqual(again, hip, where)
    assert.deepEqual(py, hip, where)
    assert.equal(hip.stop, 'finish', where)
    assert.ok(hip.steps.length <= MAX_STEPS, where)
    assert.deepEqual(hip.verdict.earned, [true, true, true], where)
    assert.deepEqual(hip.steps[0].action, act('run_kernel', start.block, start.stride), where)

    const seen = new Map()
    let previous = null
    for (const s of hip.steps) {
      const key = configKey(s.action.args)
      const known = seen.get(key) ?? new Set()
      if (s.action.tool === 'measure') assert.ok(known.has('run_kernel'), `${where}：${key} 没跑过就计时`)
      if (s.action.tool === 'finish') {
        for (const tool of ['run_kernel', 'measure', 'inspect_memory']) assert.ok(known.has(tool), `${where}：交卷的 ${key} 没有 ${tool}`)
      } else if (previous && previous !== key) {
        assert.ok(seen.get(previous).has('inspect_memory'), `${where}：没看 ${previous} 的访存就换成了 ${key}`)
      }
      known.add(s.action.tool)
      seen.set(key, known)
      previous = key
      thoughts.push(s.thought)
    }
  }
  // 每一步的 thought 都是写完整的中文句子，没有漏填的占位
  for (const t of thoughts) {
    assert.match(t, /\p{Script=Han}/u, t)
    assert.match(t, /。$/, t)
    assert.doesNotMatch(t, /undefined|NaN|null|Infinity|\[object/, t)
  }
})

test('步数上限：不交卷的策略走满上限就停；步数不够时，规则 Agent 在最后一步交出量过的最快的那组', async () => {
  const stubborn = () => ({ thought: '再量一次。', action: act('measure', 48, 4) })
  const ep = await runAgent(createEnv(VECTOR_ADD, run), stubborn)
  assert.deepEqual([ep.stop, ep.steps.length, ep.verdict], ['limit', MAX_STEPS, null])
  const short = await runAgent(createEnv(VECTOR_ADD, run), stubborn, { maxSteps: 4 })
  assert.deepEqual([short.stop, short.steps.length], ['limit', 4])

  // 只有 6 步：前 5 步量过 block 48、步长 4（1748）和 block 48、步长 1（876），第 6 步交后者，只有 ★1
  const six = await runAgent(createEnv(VECTOR_ADD, run), rulePolicy, { maxSteps: 6 })
  assert.deepEqual([six.stop, six.steps.length], ['finish', 6])
  assert.deepEqual(six.verdict.config, { block: 48, stride: 1 })
  assert.deepEqual(six.verdict.earned, [true, false, false])
  // 只有 1 步：什么都没量过，交不出东西
  const one = await runAgent(createEnv(VECTOR_ADD, run), rulePolicy, { maxSteps: 1 })
  assert.deepEqual([one.stop, one.verdict], ['limit', null])
  await assert.rejects(runAgent(createEnv(VECTOR_ADD, run), rulePolicy, { maxSteps: 0 }), RangeError)
})

test('不合法的行动不执行：观察写清楚哪里不对，这一步照样算', async () => {
  let calls = 0
  const env = createEnv(VECTOR_ADD, (req) => {
    calls++
    return run(req)
  })
  // 观察要点名哪里不对：哪个工具、哪个参数、收到的值
  const cases = [
    [{ tool: 'compile', args: {} }, /compile/],
    [act('measure', 63, 1), /block.*63/],
    [{ tool: 'measure', args: { block: 64, stride: '1' } }, /stride.*"1"/],
    [{ tool: 'measure', args: { block: 64 } }, /stride/],
    [{ tool: 'measure', args: { block: 64, stride: 1, wave: 64 } }, /wave/],
    [null, /tool/],
  ]
  for (const [action, why] of cases) {
    const o = await env.act(action)
    assert.equal(o.ok, false)
    assert.match(o.text, why)
    assert.match(String(o.data.error), why)
  }
  assert.equal(calls, 0)
  const ep = await runAgent(env, () => ({ thought: '先编译一下。', action: { tool: 'compile', args: {} } }), { maxSteps: 3 })
  assert.deepEqual([ep.stop, ep.steps.length], ['limit', 3])
  assert.ok(ep.steps.every((s) => !s.observation.ok))
})

test('拿读者的历史问规则 Agent：没跑过先跑，慢的不要，回到最快的那组看完访存再交卷', async () => {
  const env = createEnv(VECTOR_ADD, run)
  const steps = []
  const ask = (maxSteps = MAX_STEPS) => rulePolicy({ task: VECTOR_ADD, steps: steps.slice(), maxSteps }).action
  const take = async (action) => steps.push({ thought: '', action, observation: await env.act(action) })

  assert.deepEqual(ask(), act('run_kernel', 48, 4))
  // 读者没跑就先计时：规则 Agent 要先确认这组算得对
  await take(act('measure', 64, 1))
  assert.deepEqual(ask(), act('run_kernel', 64, 1))
  await take(act('run_kernel', 64, 1))
  assert.deepEqual(ask(), act('inspect_memory', 64, 1))
  // 读者去量一组更慢的：不要它，回到最快的那组
  await take(act('run_kernel', 32, 8))
  assert.deepEqual(ask(), act('measure', 32, 8))
  await take(act('measure', 32, 8))
  const back = rulePolicy({ task: VECTOR_ADD, steps: steps.slice(), maxSteps: MAX_STEPS })
  assert.deepEqual(back.action, act('inspect_memory', 64, 1))
  assert.match(back.thought, /3208.*576/)
  await take(act('inspect_memory', 64, 1))
  assert.deepEqual(ask(), act('finish', 64, 1))
  // 读者试了一组不在可选值里的：不算数，照样从最快的那组往下想
  await take(act('measure', 63, 1))
  assert.deepEqual(ask(), act('finish', 64, 1))
  // 只剩最后一步：交出最快的那组
  await take(act('run_kernel', 16, 1))
  assert.deepEqual(ask(), act('measure', 16, 1))
  assert.deepEqual(ask(steps.length + 1), act('finish', 64, 1))
})

test('结果不对时：运行报出越界，交卷一颗星也没有；规则 Agent 不给算错的参数计时，也不交它', async () => {
  for (const lang of LANGS) {
    const env = createEnv(UNGUARDED, run, lang)
    // block 48、步长 4：288 个线程连着算 4 个，多出 1152 − 1000 = 152 个数，每个读 a、读 b、写 c 各越界一次
    const ran = await env.act(act('run_kernel', 48, 4))
    assert.deepEqual(ran.data, { correct: false, wrong: 0, out_of_bounds: 152 * 3, blocks: 6, threads: 288 }, lang)
    assert.match(ran.text, /越界.*456/, lang)
    assert.deepEqual((await env.act(act('finish', 48, 4))).verdict.earned, [false, false, false], lang)
    // block 64、步长 1 少了边界检查反而更快（544 个周期），也一车不多搬，可是越界了：一颗星也不给
    const fast = await env.act(act('finish', 64, 1))
    assert.ok(fast.verdict.cycles <= UNGUARDED.bestCycles, lang)
    assert.deepEqual(fast.verdict.earned, [false, false, false], lang)
    // 正好 1000 个线程的 block 100、步长 1 没有越界
    assert.equal((await env.act(act('run_kernel', 100, 1))).data.correct, true, lang)
  }
  const ep = await runAgent(createEnv(UNGUARDED, run), rulePolicy, { maxSteps: 30 })
  assert.equal(ep.stop, 'finish')
  assert.equal(ep.verdict.correct, true)
  const wrong = new Set(ep.steps.filter((s) => s.action.tool === 'run_kernel' && !s.observation.data.correct).map((s) => configKey(s.action.args)))
  assert.ok(wrong.size > 0)
  for (const s of ep.steps) {
    if (s.action.tool !== 'run_kernel') assert.ok(!wrong.has(configKey(s.action.args)), `${s.action.tool} 用了算错的 ${configKey(s.action.args)}`)
  }
})

test('环境一次只跑一个模拟：同时来的行动排队，同一组参数只跑一次；跑失败的下次重跑', async () => {
  let running = 0
  let peak = 0
  let calls = 0
  const env = createEnv(VECTOR_ADD, async (req) => {
    calls++
    running++
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    running--
    return run(req)
  })
  const obs = await Promise.all([act('measure', 64, 1), act('measure', 32, 2), act('inspect_memory', 64, 1), act('run_kernel', 48, 4)].map((a) => env.act(a)))
  assert.ok(obs.every((o) => o.ok))
  assert.deepEqual([peak, calls], [1, 3])

  let fail = true
  const flaky = createEnv(VECTOR_ADD, (req) => {
    if (fail) {
      fail = false
      throw Object.assign(new Error('运行太久，已停下'), { name: 'TimeoutError' })
    }
    return run(req)
  })
  await assert.rejects(flaky.act(act('measure', 64, 1)), { name: 'TimeoutError' })
  assert.equal((await flaky.act(act('measure', 64, 1))).data.cycles, 576)
})
