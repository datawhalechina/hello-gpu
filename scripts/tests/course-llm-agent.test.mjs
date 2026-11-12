import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ANTHROPIC_BASE_URL, checkSettings, forgetLlmKey, LLM_STORAGE_KEY, loadLlmSettings, parseDecision, runLlmAgent, saveLlmSettings, systemPrompt,
} from '../../docs/course/agent/llm.ts'
import { OBSERVATION_KEYS } from '../../docs/course/agent/pyerror.ts'
import { runAgent, TOOLS } from '../../docs/course/agent/react.ts'
import { rulePolicy } from '../../docs/course/agent/rules.ts'
import { VECTOR_ADD } from '../../docs/course/agent/tasks.ts'
import { createEnv } from '../../docs/course/agent/tools.ts'
import { run } from '../../docs/sim/lockstep.ts'

/**
 * 读者自己的大模型来当 Agent（A-03）：用假的 fetch 扮演服务商，不发真的网络请求。
 * 大模型照着规则 Agent 回答时拿三星、每一步和规则 Agent 一样；回答不合法就停下、不执行；
 * 请求出问题写成「现象 + 原因 + 怎么改」；Key 只在请求头和 sessionStorage 里，返回给页面的东西里没有它。
 */

const KEY = 'sk-test-0123456789abcdefWXYZ'
const OPENAI = { provider: 'openai', baseUrl: 'https://llm.example.com/v1', model: 'test-model', key: KEY }
const ANTHROPIC = { provider: 'anthropic', baseUrl: ANTHROPIC_BASE_URL, model: 'test-model', key: KEY }

/** 规则 Agent 从默认起点走的一轮：假的大模型照着它回答 */
const ref = await runAgent(createEnv(VECTOR_ADD, run), rulePolicy)
const answer = (k) => JSON.stringify({ thought: ref.steps[k].thought, tool: ref.steps[k].action.tool, args: ref.steps[k].action.args })

const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const openaiReply = (content, finish = 'stop') => json({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }] })
const anthropicReply = (text) => json({ type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' })

/** 假的服务商：第 k 次请求回 reply(k)，请求都记下来 */
function provider(reply) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return reply(calls.length - 1, init)
  }
  return { calls, fetch }
}

/** 记下环境执行过的每一个行动 */
function countingEnv() {
  const env = createEnv(VECTOR_ADD, run)
  const acts = []
  return { acts, env: { task: env.task, act: (action) => (acts.push(action), env.act(action)) } }
}

const abortError = () => new DOMException('The operation was aborted.', 'AbortError')
/** 一直不回，直到请求被取消 */
function hang(init) {
  if (init.signal.aborted) return Promise.reject(abortError())
  return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(abortError()), { once: true }))
}

test('设置：地址按接口接成实际请求的地址；http 只给本机；Key 不能出现在地址和模型名里', () => {
  const endpoint = (provider, baseUrl) => checkSettings({ ...OPENAI, provider, baseUrl }).endpoint
  assert.equal(endpoint('openai', 'https://api.example.com'), 'https://api.example.com/chat/completions')
  assert.equal(endpoint('openai', 'https://api.example.com/v1/'), 'https://api.example.com/v1/chat/completions')
  assert.equal(endpoint('openai', 'https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions')
  assert.equal(endpoint('openai', 'http://localhost:11434/v1/'), 'http://localhost:11434/v1/chat/completions')
  assert.equal(endpoint('anthropic', ANTHROPIC_BASE_URL), 'https://api.anthropic.com/v1/messages')
  assert.equal(endpoint('anthropic', 'https://gateway.example.com/anthropic/v1'), 'https://gateway.example.com/anthropic/v1/messages')
  assert.equal(endpoint('anthropic', 'https://gateway.example.com/v1/messages'), 'https://gateway.example.com/v1/messages')

  const issues = (patch) => checkSettings({ ...OPENAI, ...patch }).issues.map((i) => i.field)
  assert.deepEqual(issues({}), [])
  for (const baseUrl of ['http://127.0.0.1:4000', 'http://[::1]:4000/v1', 'http://localhost:8080/v1']) assert.deepEqual(issues({ baseUrl }), [], baseUrl)
  for (const baseUrl of ['', 'api.example.com/v1', 'ftp://api.example.com', 'http://api.example.com/v1', 'http://192.168.1.5:8080/v1',
    'https://user:pass@api.example.com/v1', 'https://api.example.com/v1?api-version=1', `https://api.example.com/${KEY}/v1`]) {
    assert.deepEqual(issues({ baseUrl }), ['baseUrl'], baseUrl)
  }
  // Key 写进了地址：地址不能用，也不给出实际请求的地址
  assert.equal(checkSettings({ ...OPENAI, baseUrl: `https://api.example.com/v1?key=${KEY}` }).endpoint, null)
  for (const model of ['', '  ', 'gpt 4', KEY]) assert.deepEqual(issues({ model }), ['model'], model)
  for (const key of ['', '   ', `Bearer ${KEY}`, 'sk-abc 123', 'sk-中文']) assert.deepEqual(issues({ key }), ['key'], key)
  // 前后的空格不算：复制时常带上
  assert.deepEqual(issues({ key: ` ${KEY}\n`, model: ' test-model ', baseUrl: ' https://api.example.com/v1 ' }), [])
  assert.deepEqual(issues({ baseUrl: '', model: '', key: '' }), ['baseUrl', 'model', 'key'])
})

test('OpenAI 兼容：大模型照着规则 Agent 回答，交卷拿三星，每一步都一样；Key 只在请求头里，对话里带着每一步的观察', async () => {
  const { calls, fetch } = provider((k) => openaiReply(answer(k)))
  const steps = []
  const r = await runLlmAgent({ settings: OPENAI, env: createEnv(VECTOR_ADD, run) }, { fetch, onStep: (s) => steps.push(s) })
  assert.equal(r.stop, 'finish')
  assert.deepEqual(r.verdict.earned, [true, true, true])
  assert.equal(r.steps.length, ref.steps.length)
  assert.ok(r.steps.every((s) => s.same))
  assert.deepEqual(r.steps.map((s) => s.action), ref.steps.map((s) => s.action))
  assert.deepEqual(r.rule, { steps: ref.steps.length, stop: 'finish', verdict: ref.verdict })
  assert.equal(r.problem, null)
  assert.deepEqual(steps, r.steps)

  assert.equal(calls.length, ref.steps.length)
  calls.forEach(({ url, init, body }, k) => {
    assert.equal(url, 'https://llm.example.com/v1/chat/completions')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.authorization, `Bearer ${KEY}`)
    assert.equal(init.credentials, 'omit')
    assert.equal(init.targetAddressSpace, undefined)
    assert.ok(!url.includes(KEY) && !init.body.includes(KEY), '请求体和地址里没有 Key')
    assert.equal(body.model, 'test-model')
    const [system, ...chat] = body.messages
    assert.equal(system.role, 'system')
    // 第 k 次请求：起点 + 前 k 步各一问一答
    assert.deepEqual(chat.map((m) => m.role), Array.from({ length: 2 * k + 1 }, (_, i) => (i % 2 ? 'assistant' : 'user')))
    for (let j = 0; j < k; j++) {
      assert.deepEqual(JSON.parse(chat[2 * j + 1].content), JSON.parse(answer(j)), `第 ${k + 1} 次请求里第 ${j + 1} 步的回答`)
      assert.ok(chat[2 * j + 2].content.includes(JSON.stringify(ref.steps[j].observation.data)), `第 ${k + 1} 次请求里第 ${j + 1} 步的观察`)
    }
  })
  assert.ok(!JSON.stringify(r).includes(KEY), '返回给页面的结果里没有 Key')
})

test('Anthropic：Key 放在 x-api-key，带版本头和浏览器直连头，system 单独放；回答包在代码块里、前面有 <think> 也认', async () => {
  const { calls, fetch } = provider((k) => anthropicReply(`<think>先看观察。</think>\n\`\`\`json\n${answer(k)}\n\`\`\``))
  const r = await runLlmAgent({ settings: ANTHROPIC, env: createEnv(VECTOR_ADD, run) }, { fetch })
  assert.equal(r.stop, 'finish')
  assert.deepEqual(r.verdict.earned, [true, true, true])
  assert.ok(r.steps.every((s) => s.same))
  for (const { url, init, body } of calls) {
    assert.equal(url, 'https://api.anthropic.com/v1/messages')
    assert.equal(init.headers['x-api-key'], KEY)
    assert.equal(init.headers.authorization, undefined)
    assert.match(init.headers['anthropic-version'], /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true')
    assert.equal(typeof body.system, 'string')
    assert.ok(Number.isInteger(body.max_tokens) && body.max_tokens > 0)
    assert.equal(body.messages[0].role, 'user')
    assert.ok(body.messages.every((m) => m.role === 'user' || m.role === 'assistant'))
    // 记进对话的是校验过的 JSON，不带 <think> 和代码块
    assert.ok(body.messages.every((m) => !m.content.includes('<think>') && !m.content.includes('```')))
  }

  // 本机的 http 地址（本地代理）：写上 targetAddressSpace，Chrome 的本地网络访问要它
  const local = provider((k) => anthropicReply(answer(k)))
  const viaProxy = await runLlmAgent({ settings: { ...ANTHROPIC, baseUrl: 'http://127.0.0.1:4000' }, env: createEnv(VECTOR_ADD, run) }, { fetch: local.fetch })
  assert.equal(viaProxy.stop, 'finish')
  assert.equal(local.calls[0].url, 'http://127.0.0.1:4000/v1/messages')
  assert.equal(local.calls[0].init.targetAddressSpace, 'loopback')
})

test('回答不合法：说明哪里不对，这一步不执行，也不再往下问', async () => {
  const cases = [
    ['不是 JSON', '我觉得应该先计时。', /不是 JSON/],
    ['空的', '   ', /空的/],
    ['数组', '[1, 2]', /不是一个对象/],
    ['多了键', '{"thought": "量一量", "tool": "measure", "args": {"block": 48, "stride": 4}, "confidence": 0.9}', /多了 confidence/],
    ['没写 thought', '{"tool": "measure", "args": {"block": 48, "stride": 4}}', /没写 thought/],
    ['没有这个工具', '{"thought": "看看", "tool": "profile", "args": {"block": 48, "stride": 4}}', /没有 profile 这个工具/],
    ['参数写成了字符串', '{"thought": "看看", "tool": "measure", "args": {"block": "48", "stride": 4}}', /block 只能是/],
    ['参数不在可选值里', '{"thought": "看看", "tool": "measure", "args": {"block": 60, "stride": 4}}', /block 只能是 16 \/ 32/],
    ['少了参数', '{"thought": "看看", "tool": "measure", "args": {"block": 48}}', /没写 stride/],
  ]
  for (const [name, bad, cause] of cases) {
    for (const at of [0, 2]) {
      const { calls, fetch } = provider((k) => openaiReply(k === at ? bad : answer(k)))
      const { acts, env } = countingEnv()
      const r = await runLlmAgent({ settings: OPENAI, env }, { fetch })
      assert.equal(r.stop, 'invalid', name)
      assert.equal(r.steps.length, at, name)
      assert.equal(calls.length, at + 1, `${name}：停下以后不再请求`)
      // 环境只执行过大模型合法的那几步；出了问题不和规则 Agent 比，规则 Agent 也不跑
      assert.equal(acts.length, at, `${name}：不合法的那一步没有执行`)
      assert.equal(r.rule, null, name)
      assert.equal(r.problem.kind, 'output', name)
      assert.match(r.problem.cause, cause, name)
      assert.match(r.problem.symptom, new RegExp(`第 ${at + 1} 步`), name)
      if (bad.trim()) assert.equal(r.problem.raw, bad, `${name}：附上大模型的原话`)
    }
  }
  // 回答被截断：原因里写明
  const cut = provider(() => openaiReply('{"thought": "先跑一次', 'length'))
  const r = await runLlmAgent({ settings: OPENAI, env: createEnv(VECTOR_ADD, run) }, { fetch: cut.fetch })
  assert.match(r.problem.cause, /截断/)
})

test('parseDecision：合法的回答整理成行动，太长的想法截短', () => {
  const ok = parseDecision('{"thought": " 步长改成 1。 ", "tool": "run_kernel", "args": {"stride": 1, "block": 48}}', VECTOR_ADD)
  assert.deepEqual(ok, { ok: true, decision: { thought: '步长改成 1。', action: { tool: 'run_kernel', args: { block: 48, stride: 1 } } } })
  const long = parseDecision(JSON.stringify({ thought: '想'.repeat(600), tool: 'finish', args: { block: 64, stride: 1 } }), VECTOR_ADD)
  assert.equal(long.decision.thought, `${'想'.repeat(500)}……`)
})

test('请求出了问题：写成现象、原因、怎么改，原文里抹掉了 Key', async () => {
  const masked = `${KEY.slice(0, 6)}*****${KEY.slice(-4)}`
  const cases = [
    ['Key 不对', () => json({ error: { message: `Incorrect API key provided: ${KEY} (${masked}).`, type: 'invalid_request_error' } }, 401), 'http', /401/, /Key/],
    ['额度', () => json({ error: { message: 'Rate limit reached' } }, 429), 'http', /429/, /频率|用量/],
    ['服务商出错', () => json('upstream error', 503), 'http', /503/, /不可用|太忙/],
    ['地址不对', () => json({ detail: 'Not Found' }, 404), 'http', /404/, /地址/],
    ['被浏览器拦下', () => Promise.reject(new TypeError('Failed to fetch')), 'network', /请求失败/, /CORS/],
    ['不是 JSON', () => new Response('<!doctype html><title>login</title>', { status: 200 }), 'reply', /不是 JSON/, /接口/],
    ['不是这种接口', () => json({ result: 'ok' }), 'reply', /认不出/, /接口/],
  ]
  for (const [name, reply, kind, symptom, cause] of cases) {
    const { calls, fetch } = provider(reply)
    const r = await runLlmAgent({ settings: OPENAI, env: createEnv(VECTOR_ADD, run) }, { fetch })
    assert.equal(r.stop, 'error', name)
    assert.equal(calls.length, 1, name)
    assert.equal(r.steps.length, 0, name)
    assert.equal(r.problem.kind, kind, name)
    assert.match(r.problem.symptom, symptom, name)
    assert.match(r.problem.cause, cause, name)
    assert.ok(r.problem.fix, name)
    const text = JSON.stringify(r)
    assert.ok(!text.includes(KEY) && !text.includes(masked) && !text.includes(KEY.slice(0, 12)), `${name}：结果里没有 Key`)
    // 出了问题不和规则 Agent 比：报错马上出来，不用等它走一轮
    assert.equal(r.rule, null, name)
  }
  const said = await runLlmAgent({ settings: OPENAI, env: createEnv(VECTOR_ADD, run) }, { fetch: provider(() => json({ error: { message: `Incorrect API key provided: ${KEY}.` } }, 401)).fetch })
  assert.match(said.problem.raw, /^HTTP 401：Incorrect API key provided: \*\*\*\.$/)
})

test('等太久就停下；读者点「停下」就停下，走过的步留着', { timeout: 10_000 }, async () => {
  const slow = await runLlmAgent({ settings: OPENAI, env: createEnv(VECTOR_ADD, run), timeoutMs: 20 }, { fetch: (_url, init) => hang(init) })
  assert.equal(slow.stop, 'error')
  assert.equal(slow.problem.kind, 'timeout')

  const reader = new AbortController()
  const { calls, fetch } = provider((k, init) => {
    if (k < 2) return openaiReply(answer(k))
    reader.abort()
    return hang(init)
  })
  const r = await runLlmAgent({ settings: OPENAI, env: createEnv(VECTOR_ADD, run), signal: reader.signal }, { fetch })
  assert.equal(r.stop, 'stopped')
  assert.equal(r.steps.length, 2)
  assert.equal(calls.length, 3)
  assert.equal(r.problem, null)
  assert.equal(r.rule, null)
})

test('步数用完：一直不交卷就停在上限；只剩最后一步时提醒大模型交卷', async () => {
  const again = '{"thought": "再跑一次。", "tool": "run_kernel", "args": {"block": 48, "stride": 4}}'
  const { calls, fetch } = provider(() => openaiReply(again))
  const r = await runLlmAgent({ settings: OPENAI, env: createEnv(VECTOR_ADD, run), maxSteps: 4 }, { fetch })
  assert.equal(r.stop, 'limit')
  assert.equal(r.steps.length, 4)
  assert.equal(calls.length, 4)
  assert.equal(r.verdict, null)
  const lastAsk = calls.map(({ body }) => body.messages.at(-1).content)
  assert.deepEqual(lastAsk.map((m) => m.includes('finish')), [false, false, false, true])
  assert.ok(calls[0].body.messages[0].content.includes('一轮最多 4 步'))
})

test('给大模型的说明：每个工具、观察里的每个键都有解释，可选值和三星标准都在', () => {
  const prompt = systemPrompt(VECTOR_ADD)
  for (const t of TOOLS) assert.ok(prompt.includes(`- ${t.name}：`), t.name)
  for (const key of new Set(Object.values(OBSERVATION_KEYS).flat())) assert.match(prompt, new RegExp(`${key}（[^）]+）`), key)
  assert.ok(prompt.includes(VECTOR_ADD.blocks.join(' / ')) && prompt.includes(VECTOR_ADD.strides.join(' / ')))
  for (const star of VECTOR_ADD.stars) assert.ok(prompt.includes(star), star)
  assert.ok(!prompt.includes('sk-'))
})

test('存储：设置和 Key 只存在 sessionStorage，忘掉 Key 只删 Key；存储用不了也不出错', () => {
  const fake = () => {
    const data = new Map()
    return {
      data,
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      removeItem: (k) => data.delete(k),
    }
  }
  const session = fake()
  const local = fake()
  local.setItem = () => assert.fail('不能写 localStorage')
  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  define('sessionStorage', session)
  define('localStorage', local)
  try {
    assert.equal(loadLlmSettings(), null)
    assert.equal(saveLlmSettings(ANTHROPIC), true)
    assert.deepEqual([...session.data.keys()], [LLM_STORAGE_KEY])
    assert.ok(session.data.get(LLM_STORAGE_KEY).includes(KEY))
    assert.deepEqual(loadLlmSettings(), ANTHROPIC)
    forgetLlmKey()
    assert.deepEqual(loadLlmSettings(), { ...ANTHROPIC, key: '' })
    assert.ok(!session.data.get(LLM_STORAGE_KEY).includes(KEY))
    assert.equal(local.data.size, 0)

    session.setItem(LLM_STORAGE_KEY, '{oops')
    assert.equal(loadLlmSettings(), null)
    session.setItem(LLM_STORAGE_KEY, JSON.stringify({ provider: 'gemini', baseUrl: 3, key: KEY }))
    assert.deepEqual(loadLlmSettings(), { provider: 'openai', baseUrl: '', model: '', key: KEY })

    // 浏览器禁用了存储：读写都抛异常
    define('sessionStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    assert.equal(saveLlmSettings(OPENAI), false)
    assert.equal(loadLlmSettings(), null)
    delete globalThis.sessionStorage
    assert.equal(saveLlmSettings(OPENAI), false)
    assert.equal(loadLlmSettings(), null)
  } finally {
    delete globalThis.sessionStorage
    delete globalThis.localStorage
  }
})
