/**
 * 1-14 的可选环节：读者自己的大模型来当 Agent（A-03；03 第 3、4 节，09 第 3 节）。
 *
 * 读者填入自己的 API Key，大模型代替规则策略做 ReAct 的「思考」：每一步把任务、工具和到目前为止的观察发给大模型，
 * 大模型只回下一步行动（一个 JSON 对象），页面校验过才在模拟器上执行；回的东西不合法就说明哪里不对并停下，不执行。
 * 每一步同时问规则 Agent（rules.ts）面对同样的历史会怎么选，最后和规则 Agent 从同一个起点走的一轮比一比。
 *
 * - 没有后端，也不经过中转：浏览器直接请求读者填写的服务商。两种接口：
 *   OpenAI 兼容（读者自填 base URL 和模型名，请求 {base}/chat/completions）和 Anthropic（{base}/v1/messages）。
 *   能不能从浏览器直连取决于服务商回不回允许跨域（CORS）的响应头，实测结果在 A-03 的完成记录里。
 * - Key 只放进请求头，不进 URL 和请求体；只存在 sessionStorage（关掉标签页就没了），不写进 localStorage，不打印日志。
 *   服务商的报错给读者看之前先抹掉 Key（有的服务商会在报错里回显半截 Key）。不提供默认 Key。
 *
 * 纯 TypeScript：网络请求用调用方给的 fetch（单测传假的），sessionStorage 只在函数里碰（服务端渲染安全）。
 */
import { OBSERVATION_KEYS } from './pyerror.ts'
import { MAX_STEPS, runAgent, sameAction, TOOLS, type AgentEnv, type AgentStep, type Decision, type Episode, type Observation, type Verdict } from './react.ts'
import { rulePolicy } from './rules.ts'
import { describeConfig, type TuneTask } from './tasks.ts'
import { validateAction } from './tools.ts'

export type LlmProvider = 'openai' | 'anthropic'

export interface LlmSettings {
  provider: LlmProvider
  /** 服务商的 base URL：OpenAI 兼容接口后面接 /chat/completions，Anthropic 接口后面接 /v1/messages */
  baseUrl: string
  model: string
  /** 读者自己的 API Key：只放进请求头 */
  key: string
}

export const LLM_PROVIDERS: readonly { value: LlmProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' },
]

/** Anthropic 官方接口的 base URL（https://platform.claude.com/docs/en/api/messages） */
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
/** 一次请求最多等多久（界面约定）；读者随时可以点「停下」。 */
export const LLM_TIMEOUT_MS = 120_000
/** sessionStorage 里的键：接口、地址、模型名和 Key 都存在这一条里。 */
export const LLM_STORAGE_KEY = 'hg-llm-v1'

/**
 * anthropic-version 请求头（https://platform.claude.com/docs/en/api/versioning）。用 2023-06-01：兼容 Anthropic 接口的
 * 其他服务也认它；这里只发 model、max_tokens、system、messages，2026-10-21 版改动的参数一个都没用到。
 */
const ANTHROPIC_VERSION = '2023-06-01'
/** Anthropic 接口必须写 max_tokens。一步的回答是一个短 JSON，1024 够用（界面约定，不是服务商的限制）。 */
const ANTHROPIC_MAX_TOKENS = 1024
/** 一条想法最多留多少字（和 1-14 的 Python Agent 一样） */
const MAX_THOUGHT_CHARS = 500
/** 原话最多留多少字，太长的页面上放不下 */
const MAX_RAW_CHARS = 2000

// ── 设置：检查、请求地址 ────────────────────────────────────────────────────

export type SettingsField = 'baseUrl' | 'model' | 'key'

export interface SettingsIssue {
  field: SettingsField
  message: string
}

export interface SettingsCheck {
  /** 实际请求的地址；地址不能用时是 null */
  endpoint: string | null
  /** 每个框的问题，按框的先后排 */
  issues: SettingsIssue[]
}

/** 本机的地址（localhost、127.x.x.x、[::1]）：只有它们可以用 http://（本地代理、本地模型）。 */
function isLoopback(url: URL): boolean {
  const host = url.hostname
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host)
}

function checkBase(baseUrl: string, key: string): { url: URL | null; message: string } {
  const text = baseUrl.trim()
  if (!text) return { url: null, message: '还没填地址（base URL）：照服务商的文档填。' }
  if (key && text.includes(key)) return { url: null, message: '地址里出现了 Key：Key 只填在下面的 Key 框里，地址会出现在浏览器的网络记录里。' }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { url: null, message: '地址要写成完整的网址，以 https:// 开头。' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { url: null, message: '地址要以 https:// 开头。' }
  if (url.protocol === 'http:' && !isLoopback(url)) {
    return { url: null, message: '只有本机的地址（localhost、127.0.0.1）可以用 http://；别的地址要用 https://，不然 Key 会不加密地经过网络。' }
  }
  if (url.username || url.password) return { url: null, message: '地址里不要写用户名和密码。' }
  if (text.includes('?') || text.includes('#')) return { url: null, message: '地址不要带 ? 或 # 后面的部分。' }
  return { url, message: '' }
}

/**
 * 实际请求的地址。和两家官方 SDK 的约定一样：OpenAI 兼容接口在 base URL 后面接 /chat/completions，
 * Anthropic 接口接 /v1/messages。读者把这一段也写进了地址时不再重复接（Anthropic 的地址以 /v1 结尾时只接 /messages）。
 */
function endpointOf(provider: LlmProvider, url: URL): string {
  const base = url.href.replace(/\/+$/, '')
  if (provider === 'anthropic') {
    if (base.endsWith('/v1/messages')) return base
    return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
  }
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

/** 检查读者填的设置：每个框的问题写成一句话，地址能用就给出实际请求的地址。 */
export function checkSettings(s: LlmSettings): SettingsCheck {
  const issues: SettingsIssue[] = []
  const key = s.key.trim()
  const base = checkBase(s.baseUrl, key)
  if (base.message) issues.push({ field: 'baseUrl', message: base.message })
  const model = s.model.trim()
  if (!model) issues.push({ field: 'model', message: '还没填模型名：照服务商的文档填。' })
  else if (key && model.includes(key)) issues.push({ field: 'model', message: '模型名里出现了 Key：Key 只填在 Key 框里。' })
  else if (/\s/.test(model) || model.length > 200) issues.push({ field: 'model', message: '模型名里不能有空格，照服务商的文档原样填。' })
  if (!key) issues.push({ field: 'key', message: '还没填 Key：本站不提供 Key，要用你自己在服务商那里申请的。' })
  else if (/^bearer\s/i.test(key)) issues.push({ field: 'key', message: 'Key 前面不用写 Bearer，只填 Key 本身。' })
  else if (!/^[\x21-\x7e]+$/.test(key)) issues.push({ field: 'key', message: 'Key 里有空格、换行或者中文字符，多半是复制时多带了东西：重新复制一次。' })
  return { endpoint: base.url ? endpointOf(s.provider, base.url) : null, issues }
}

// ── 发给大模型的话 ─────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 观察里每个键是什么意思（写进说明，大模型才知道怎么读观察）。 */
const KEY_NOTES: Readonly<Record<string, string>> = {
  correct: '是否全部算对、没有越界',
  wrong: '算错了几个数',
  out_of_bounds: '越界读写了几次',
  blocks: '派了几组',
  threads: '一共几个线程',
  cycles: '示意的总周期数',
  compute: '其中计算的周期',
  memory: '其中访存的周期',
  sync: '其中同步的周期',
  lane_utilization: 'lane 利用率，0 到 1',
  accesses: '读写显存几次',
  transactions: '一共搬了几车',
  ideal: '理想几车',
  efficiency: '理想车数 ÷ 搬的车数',
  stars: '拿到几颗星',
}

/** 给大模型的说明（system prompt）：任务、kernel、可选值、三星标准、工具和回答的格式。页面上也给读者看。 */
export function systemPrompt(task: TuneTask, maxSteps: number = MAX_STEPS): string {
  const tools = TOOLS.map((t) => {
    const keys = OBSERVATION_KEYS[t.name].map((k) => (KEY_NOTES[k] ? `${k}（${KEY_NOTES[k]}）` : k)).join('、')
    return `- ${t.name}：${t.summary}。观察里有 ${keys}。`
  })
  return [
    '你是一个自动调参的 Agent，在一个 GPU 模拟器上工作。每一步先读到目前为止的观察，想好下一步做什么，再调用一个工具。',
    '',
    `任务：${task.goal}`,
    'kernel（HIP 写法）：',
    task.code.hip,
    '',
    `可以选的参数：block 是 ${task.blocks.join(' / ')}；stride 是 ${task.strides.join(' / ')}。wave 大小是 ${task.wave}。周期数、车数都是模拟值。`,
    '三星标准（★1 不成立时后两颗不算）：',
    ...task.stars.map((s, k) => `★${k + 1} ${s}`),
    '',
    '工具（每个都要给 block 和 stride）：',
    ...tools,
    '',
    `一轮最多 ${maxSteps} 步，调用一次工具算一步；不交卷（finish）就没有分。`,
    '',
    '每一步只回一个 JSON 对象，不写别的内容：',
    '{"thought": "用一两句中文写你看到了什么、为什么这样做", "tool": "工具名", "args": {"block": 整数, "stride": 整数}}',
  ].join('\n')
}

/** 走完第 used 步以后的提问：这一步的观察、还剩几步。只剩最后一步时提醒交卷。 */
function observationPrompt(observation: Observation, used: number, maxSteps: number): string {
  const left = maxSteps - used
  const lines = [
    `第 ${used} 步的观察：${JSON.stringify(observation.data)}`,
    observation.text,
    `已经用了 ${used} 步，还剩 ${left} 步。现在是第 ${used + 1} 步：只回一个 JSON 对象。`,
  ]
  if (left === 1) lines.push('只剩最后一步了：这一步要交卷（finish），不交卷就没有分。')
  return lines.join('\n')
}

// ── 请求 ─────────────────────────────────────────────────────────────────

/** 请求的选项。targetAddressSpace 是 Chrome 的本地网络访问（Local Network Access）要的，别的浏览器不认就忽略。 */
export type LlmRequestInit = RequestInit & { targetAddressSpace?: 'loopback' }

export type FetchLike = (url: string, init: LlmRequestInit) => Promise<Response>

/**
 * 拼出一次请求。Key 只放进请求头：OpenAI 兼容接口是 Authorization: Bearer，Anthropic 接口是 x-api-key；
 * Anthropic 还要 anthropic-dangerous-direct-browser-access: true 才回允许跨域的响应头（官方 SDK 的
 * dangerouslyAllowBrowser 就是加这个头）。不带 cookie，不带来源页面的地址。
 * 请求本机的 http 地址时写上 targetAddressSpace: 'loopback'（Chrome 的 Local Network Access 指南要求这样写）。
 */
function buildRequest(s: LlmSettings, endpoint: string, system: string, messages: readonly ChatMessage[]): LlmRequestInit {
  const key = s.key.trim()
  const model = s.model.trim()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  let body: unknown
  if (s.provider === 'anthropic') {
    headers['x-api-key'] = key
    headers['anthropic-version'] = ANTHROPIC_VERSION
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    body = { model, max_tokens: ANTHROPIC_MAX_TOKENS, system, messages }
  } else {
    headers.authorization = `Bearer ${key}`
    body = { model, messages: [{ role: 'system', content: system }, ...messages] }
  }
  const init: LlmRequestInit = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  }
  const url = new URL(endpoint)
  if (url.protocol === 'http:' && isLoopback(url)) init.targetAddressSpace = 'loopback'
  return init
}

/**
 * 从服务商的回复里取出大模型的文字。认不出是哪种回复（不是这种接口）是 null；认得出、但大模型什么都没写时 text 是空的。
 * truncated：回答太长被截断了。
 */
function replyText(provider: LlmProvider, json: unknown): { text: string; truncated: boolean } | null {
  const j = json as Record<string, unknown> | null
  if (!j || typeof j !== 'object') return null
  if (provider === 'anthropic') {
    if (!Array.isArray(j.content)) return null
    const blocks = j.content as ({ type?: unknown; text?: unknown } | null)[]
    const text = blocks.map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('')
    return { text, truncated: j.stop_reason === 'max_tokens' }
  }
  const choice = Array.isArray(j.choices) ? j.choices[0] as { message?: { content?: unknown }; finish_reason?: unknown } | null : null
  if (!choice || typeof choice !== 'object') return null
  const content = choice.message?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('') : ''
  return { text, truncated: choice.finish_reason === 'length' }
}

// ── 校验大模型的回答 ───────────────────────────────────────────────────────

export type Parsed = { ok: true; decision: Decision } | { ok: false; cause: string }

const FORMAT = '{"thought": "…", "tool": "measure", "args": {"block": 64, "stride": 1}}'

/**
 * 校验大模型的回答：整段是一个 JSON 对象（允许包在一个 ```json 代码块里，允许前面有 <think>…</think>），
 * 只有 thought、tool、args 三个键，thought 是一句话，工具和参数都在任务的可选值里（tools.ts 的 validateAction）。
 * 不合法时说明哪里不对。
 */
export function parseDecision(text: string, task: TuneTask): Parsed {
  let body = text.trim().replace(/^<think>[\s\S]*?<\/think>\s*/, '')
  const fence = /^```[A-Za-z]*[ \t]*\n([\s\S]*?)\n?[ \t]*```$/.exec(body)
  if (fence) body = fence[1].trim()
  if (!body) return { ok: false, cause: '回答是空的，什么都没写。' }
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return { ok: false, cause: `回的不是 JSON：页面要的是一个 JSON 对象，像 ${FORMAT}。` }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, cause: `回的是 JSON，可不是一个对象：页面要的是 ${FORMAT} 这样的一个对象。` }
  }
  const o = value as Record<string, unknown>
  const extra = Object.keys(o).filter((k) => k !== 'thought' && k !== 'tool' && k !== 'args')
  if (extra.length) return { ok: false, cause: `只认 thought、tool、args 三个键，多了 ${extra.join('、')}。` }
  if (o.thought === undefined) return { ok: false, cause: '没写 thought（这一步的想法）。' }
  if (typeof o.thought !== 'string' || !o.thought.trim()) return { ok: false, cause: 'thought 要是一句话（不空的字符串）。' }
  const v = validateAction(task, { tool: o.tool, args: o.args })
  if (!v.ok) return { ok: false, cause: v.message }
  const thought = o.thought.trim()
  return {
    ok: true,
    decision: {
      thought: thought.length > MAX_THOUGHT_CHARS ? `${thought.slice(0, MAX_THOUGHT_CHARS)}……` : thought,
      action: { tool: v.action.tool, args: { block: v.action.args.block, stride: v.action.args.stride } },
    },
  }
}

// ── 出了问题：现象 + 原因 + 怎么改（03 第 4 节） ─────────────────────────────────

export interface LlmProblem {
  /** network：请求失败（含浏览器拦下的跨域请求）；http：服务商回了错误；timeout：等太久；reply：回复看不懂；output：大模型的回答不合法；sim：模拟器出错 */
  kind: 'network' | 'http' | 'timeout' | 'reply' | 'output' | 'sim'
  symptom: string
  cause: string
  fix: string
  /** 原文：服务商或大模型的原话、浏览器的报错，Key 已经抹掉；没有是空字符串 */
  raw: string
}

/**
 * 给读者看的原文：先抹掉 Key（整段 Key、服务商回显的半截 Key，例如 sk-abc*****wxyz、****wxyz，还有 sk- 开头的长串），
 * 再截到 max 个字。
 */
function shown(text: string, key: string, max = MAX_RAW_CHARS): string {
  let out = text
  const k = key.trim()
  if (k.length >= 4) out = out.split(k).join('***')
  // 半截 Key 里的点只算夹在字母数字中间的，句末的句号留着
  out = out.replace(/[\w-]*(?:\.[\w-]+)*\*{3,}[\w-]*(?:\.[\w-]+)*/g, '***').replace(/\bsk-[\w-]{8,}/g, 'sk-***')
  return out.length > max ? `${out.slice(0, max)}……` : out
}

/** 服务商报错里的那句话：各家的 JSON 不一样（error.message、message、detail、数组……），找不到就用原文。 */
function providerMessage(body: string): string {
  const find = (v: unknown, depth: number): string | null => {
    if (depth > 4 || v === null || v === undefined) return null
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.length ? find(v[0], depth + 1) : null
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      for (const k of ['message', 'detail', 'error', 'msg']) {
        const m = Object.hasOwn(o, k) ? find(o[k], depth + 1) : null
        if (m) return m
      }
    }
    return null
  }
  const t = body.trim()
  try {
    return find(JSON.parse(t), 0) ?? t
  } catch {
    return t
  }
}

function httpProblem(status: number, body: string, key: string): LlmProblem {
  const said = shown(providerMessage(body), key, 300)
  const raw = `HTTP ${status}${said ? `：${said}` : ''}`
  if (status === 401 || status === 403) {
    return { kind: 'http', raw, symptom: `服务商拒绝了这次请求（HTTP ${status}）。`, cause: 'Key 不对、过期了，或者这个 Key 没有用这个模型的权限。', fix: '到服务商的控制台核对 Key，重新复制粘贴（前后不要带空格），再运行一次。' }
  }
  if (status === 404) {
    return { kind: 'http', raw, symptom: '服务商说找不到（HTTP 404）。', cause: '地址或者模型名不对：OpenAI 兼容接口会在地址后面接 /chat/completions，Anthropic 接口接 /v1/messages。', fix: '对照服务商的文档核对地址（上面写着实际请求的地址）和模型名。' }
  }
  if (status === 402) {
    return { kind: 'http', raw, symptom: '服务商说要付费（HTTP 402）。', cause: '账户余额或者额度不够了。', fix: '到服务商的控制台看看余额；不想花钱就跳过这一节，不影响通关和星级。' }
  }
  if (status === 429) {
    return { kind: 'http', raw, symptom: '请求太多，或者额度用完了（HTTP 429）。', cause: '服务商限制了请求的频率或者用量。', fix: '等一会儿再运行；还是不行就到服务商的控制台看看额度。' }
  }
  if (status >= 500) {
    return { kind: 'http', raw, symptom: `服务商那边出错了（HTTP ${status}）。`, cause: '服务商暂时不可用，或者太忙。', fix: '等一会儿再运行一次。' }
  }
  return { kind: 'http', raw, symptom: `服务商说这次请求有问题（HTTP ${status}）。`, cause: '多半是模型名写错了，或者这个模型不支持这种请求。下面是服务商的原话。', fix: '核对模型名；照服务商的原话改。' }
}

function replyProblem(provider: LlmProvider, body: string, notJson: boolean, key: string): LlmProblem {
  const label = LLM_PROVIDERS.find((p) => p.value === provider)?.label ?? provider
  return {
    kind: 'reply',
    symptom: notJson ? '服务商的回复不是 JSON，看不懂。' : '服务商回了消息，可是认不出里面哪里是大模型的回答。',
    cause: `这个地址回的不像 ${label} 接口：接口类型可能选错了，或者地址指到了别的网页。`,
    fix: '核对上面的接口类型和地址（上面写着实际请求的地址）。',
    raw: shown(body, key),
  }
}

// ── 问一次大模型 ───────────────────────────────────────────────────────────

type ModelReply =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'problem'; problem: LlmProblem }
  | { kind: 'stopped' }

/** 问一次大模型。读者点了停下是 stopped；请求失败、等太久、服务商报错、回复看不懂都写成 problem，不抛异常。 */
async function callModel(
  s: LlmSettings,
  endpoint: string,
  system: string,
  messages: readonly ChatMessage[],
  options: { fetch: FetchLike; signal?: AbortSignal; timeoutMs: number },
): Promise<ModelReply> {
  const { signal, timeoutMs } = options
  if (signal?.aborted) return { kind: 'stopped' }
  const key = s.key.trim()
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    let response: Response
    let body: string
    try {
      response = await options.fetch(endpoint, { ...buildRequest(s, endpoint, system, messages), signal: controller.signal })
      body = await response.text()
    } catch (err) {
      if (signal?.aborted) return { kind: 'stopped' }
      if (timedOut) {
        return {
          kind: 'problem',
          problem: {
            kind: 'timeout',
            symptom: `等了 ${Math.round(timeoutMs / 1000)} 秒，服务商还没有回复，已经停下。`,
            cause: '服务商太忙，或者这个模型想得太久。',
            fix: '再运行一次；总是这样就换一个回得快的模型。',
            raw: '',
          },
        }
      }
      return {
        kind: 'problem',
        problem: {
          kind: 'network',
          symptom: '浏览器没有拿到服务商的回复：请求失败了。',
          cause: '常见的原因有三个：这个服务商不允许网页直接调用（浏览器的跨域限制，CORS）；Key 不对——有的服务商在 Key 不对时，回复里不带允许跨域的响应头，浏览器也只能报「请求失败」；地址写错了，或者网络不通。',
          fix: '先核对地址和 Key。都没错的话，多半是这个服务商不支持浏览器直连：可以用本地代理（见下面「不能直连怎么办」），也可以跳过这一节，不影响通关和星级。',
          raw: shown(String((err as Error)?.message ?? err), key),
        },
      }
    }
    if (!response.ok) return { kind: 'problem', problem: httpProblem(response.status, body, key) }
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      return { kind: 'problem', problem: replyProblem(s.provider, body, true, key) }
    }
    const reply = replyText(s.provider, json)
    if (!reply) return { kind: 'problem', problem: replyProblem(s.provider, body, false, key) }
    return { kind: 'text', ...reply }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

// ── 大模型当 Agent：走一轮 ───────────────────────────────────────────────────

/** 大模型走的一步，外加规则 Agent 面对同样的历史会怎么选。 */
export interface LlmStep extends AgentStep {
  rule: Decision
  same: boolean
}

export interface LlmRun {
  steps: LlmStep[]
  /** finish：交卷了；limit：步数用完；invalid：大模型的回答不合法，停下了；error：请求或模拟器出了问题；stopped：读者点了停下 */
  stop: 'finish' | 'limit' | 'invalid' | 'error' | 'stopped'
  verdict: Verdict | null
  problem: LlmProblem | null
  maxSteps: number
  /** 规则 Agent 从同一个起点走的一轮，交卷或者走满步数时才有（好比一比）；别的情况、或者它没跑成时是 null */
  rule: { steps: number; stop: Episode['stop']; verdict: Verdict | null } | null
}

export interface LlmAgentRequest {
  settings: LlmSettings
  /** 模拟器环境（tools.ts 的 createEnv）；任务和起点从 env.task 读 */
  env: AgentEnv
  maxSteps?: number
  signal?: AbortSignal
  /** 一次请求最多等多久，默认 LLM_TIMEOUT_MS */
  timeoutMs?: number
}

export interface LlmAgentHooks {
  fetch: FetchLike
  /** 开始等第 index 步（0 起）的回答 */
  onAsk?(index: number): void
  /** 每走完一步 */
  onStep?(step: LlmStep): void
}

/**
 * 让大模型当 Agent 走一轮：每一步问一次大模型，校验它的回答，合法才在模拟器上执行。交卷、步数用完、
 * 回答不合法、请求出了问题、读者点了停下，都会停。设置不对（调用方没先 checkSettings）抛 RangeError。
 */
export async function runLlmAgent(request: LlmAgentRequest, hooks: LlmAgentHooks): Promise<LlmRun> {
  const { settings, env, signal } = request
  const { task } = env
  const maxSteps = request.maxSteps ?? MAX_STEPS
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new RangeError(`maxSteps 要是正整数，收到的是 ${String(maxSteps)}。`)
  const check = checkSettings(settings)
  if (!check.endpoint || check.issues.length) throw new RangeError(`设置不对：${check.issues.map((i) => i.message).join(' ')}`)
  const endpoint = check.endpoint
  const system = systemPrompt(task, maxSteps)
  const messages: ChatMessage[] = [{ role: 'user', content: `起点：${describeConfig(task.start)}。一轮最多 ${maxSteps} 步。现在是第 1 步：只回一个 JSON 对象。` }]
  const steps: LlmStep[] = []
  let stop: LlmRun['stop'] = 'limit'
  let problem: LlmProblem | null = null
  let verdict: Verdict | null = null

  while (steps.length < maxSteps) {
    if (signal?.aborted) {
      stop = 'stopped'
      break
    }
    hooks.onAsk?.(steps.length)
    const reply = await callModel(settings, endpoint, system, messages, { fetch: hooks.fetch, signal, timeoutMs: request.timeoutMs ?? LLM_TIMEOUT_MS })
    if (reply.kind === 'stopped') {
      stop = 'stopped'
      break
    }
    if (reply.kind === 'problem') {
      stop = 'error'
      problem = reply.problem
      break
    }
    const parsed = parseDecision(reply.text, task)
    if (!parsed.ok) {
      stop = 'invalid'
      problem = {
        kind: 'output',
        symptom: `大模型第 ${steps.length + 1} 步回的内容不合法，页面没有执行它，这一轮停在了这里。`,
        cause: reply.truncated ? `${parsed.cause}回答太长，被服务商截断了。` : parsed.cause,
        fix: '大模型每次的回答不一定一样，可以再运行一次；总是出错就换一个模型。它的原话在下面，可以对照「发给大模型的说明」里要求的格式看看哪里不对。',
        raw: shown(reply.text, settings.key),
      }
      break
    }
    const { decision } = parsed
    // 先问规则 Agent（只看这一步之前的历史），再执行大模型的行动
    const rule = rulePolicy({ task, steps: steps.slice(), maxSteps })
    let observation: Observation
    try {
      observation = await env.act(decision.action)
    } catch (err) {
      const e = err as Error
      if (e?.name === 'AbortError' || signal?.aborted) stop = 'stopped'
      else {
        stop = 'error'
        problem = {
          kind: 'sim',
          symptom: e?.name === 'TimeoutError' ? '模拟器跑得太久，已经停下。' : '模拟器没跑起来。',
          cause: '这和大模型无关，是页面上的模拟器出了问题。',
          fix: '刷新页面再试一次。',
          raw: String(e?.message ?? err),
        }
      }
      break
    }
    const step: LlmStep = { thought: decision.thought, action: decision.action, observation, rule, same: sameAction(rule.action, decision.action) }
    steps.push(step)
    hooks.onStep?.(step)
    if (observation.verdict) {
      stop = 'finish'
      verdict = observation.verdict
      break
    }
    // 记进对话的只有校验过的 JSON（去掉了代码块、<think> 这些包装）
    messages.push(
      { role: 'assistant', content: JSON.stringify({ thought: decision.thought, tool: decision.action.tool, args: decision.action.args }) },
      { role: 'user', content: observationPrompt(observation, steps.length, maxSteps) },
    )
  }

  // 交卷或者走满步数：规则 Agent 从同一个起点走一轮，好比一比（同一个环境：大模型跑过的参数不再跑）。
  // 出了问题、读者停下时不比，免得读者看到报错之前还要等它
  let rule: LlmRun['rule'] = null
  if (stop === 'finish' || stop === 'limit') {
    try {
      const ep = await runAgent(env, rulePolicy, { maxSteps })
      rule = { steps: ep.steps.length, stop: ep.stop, verdict: ep.verdict }
    } catch {
      rule = null
    }
  }
  return { steps, stop, verdict, problem, maxSteps, rule }
}

// ── 存在 sessionStorage 里 ───────────────────────────────────────────────────

/** 这个标签页的 sessionStorage；用不了（服务端渲染、浏览器禁用了存储）是 null。只在函数里碰。 */
function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** 读这个标签页里存的设置；没有或者看不懂是 null。 */
export function loadLlmSettings(): LlmSettings | null {
  try {
    const raw = sessionStore()?.getItem(LLM_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Record<keyof LlmSettings, unknown>> | null
    if (!v || typeof v !== 'object') return null
    const text = (x: unknown) => (typeof x === 'string' ? x : '')
    return { provider: v.provider === 'anthropic' ? 'anthropic' : 'openai', baseUrl: text(v.baseUrl), model: text(v.model), key: text(v.key) }
  } catch {
    return null
  }
}

/** 存进这个标签页的 sessionStorage（关掉标签页就没了）；存不了返回 false。 */
export function saveLlmSettings(s: LlmSettings): boolean {
  try {
    const store = sessionStore()
    if (!store) return false
    store.setItem(LLM_STORAGE_KEY, JSON.stringify({ provider: s.provider, baseUrl: s.baseUrl, model: s.model, key: s.key }))
    return true
  } catch {
    return false
  }
}

/** 忘掉 Key：接口、地址、模型名留着，只把 Key 从 sessionStorage 里删掉。 */
export function forgetLlmKey(): void {
  const s = loadLlmSettings()
  if (s) saveLlmSettings({ ...s, key: '' })
}
