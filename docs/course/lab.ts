/**
 * 实验室的网页端规则（L-02；07 第 8–10 节、03 第 6 节）：通关码（HGPU1.）的编码、解码和校验，「我的 GPU 卡片」
 * 导入码（HGCARD1.）的解码和校验（L-07，存档和显示在 device.ts），星级规则求值，实验室在哪（Notebook 的路径、
 * 下载和 GitHub 链接），导入失败时怎么跟读者说。
 *
 * 纯 TS，不碰 Vue 和页面：编解码用的 atob / btoa、CompressionStream / DecompressionStream、TextDecoder
 * 浏览器和 Node 22 都有，node --test 可以直接 import。导入成绩、发星发徽章在 useLab.ts，界面在 LabCard.vue。
 *
 * 和 Python 的 hello_gpu.codes（码）、hello_gpu.stars（星级）一一对应，报错的说明也一样：两边跑同一份
 * docs/course/lab-rules.fixtures.json，结果必须一致；改其中一边的规则，另一边和样例一起改。
 * 星级只按规则重新计算，从不读凭证里自带的结论（07 第 8 节）。
 */
import { exerciseById, exerciseHref, isPublished, routesOf, stageById, stageHref, zoneById } from './outline.ts'
import { MAX_STARS } from './progress.ts'

// ── 格式 ──────────────────────────────────────────────────────────────────

/** 通关码的前缀：通关凭证 v1（hg.submit() 生成）。 */
export const CREDENTIAL_PREFIX = 'HGPU1.'
/** 「我的 GPU 卡片」导入码的前缀（hg.device_card() 生成，device.ts 导入）。LabCard 用它认出贴错了地方。 */
export const CARD_PREFIX = 'HGCARD1.'
export const LAB_VERSION = 1
export const LAB_ROUTES = ['hip', 'triton', 'shared'] as const
export type LabRoute = (typeof LAB_ROUTES)[number]
/** 路线的显示名，和 hello_gpu/lab.py 的 _ROUTE_NAMES、nb-build.mjs 的 ROUTE_NAMES 一致。 */
export const ROUTE_NAMES: Record<LabRoute, string> = { hip: 'HIP 路线', triton: 'Triton 路线', shared: '两条路线共用' }
/** 关卡 id：区域（或 dungeon）加 slug，例如 forge-softmax、dungeon-spmv（同 hello_gpu.codes.STAGE_ID）。 */
export const STAGE_ID = /^[a-z]+(?:-[a-z0-9]+)+$/
/** 测量项的名字：小写字母开头，只用小写字母、数字和下划线（同 hello_gpu.codes.METRIC_NAME）。 */
export const METRIC_NAME = /^[a-z][a-z0-9_]*$/
/** 通关链接里成绩所在的片段：<关卡页>#lab=<通关码>（07 第 8 节）。 */
export const LINK_HASH = '#lab='

const GFX = /^gfx[0-9a-f]+$/
const PREFIX = /^(?:HGPU|HGCARD)\d+\./
const BODY = /^[A-Za-z0-9_-]+$/
/** 只认 hello_gpu 写出的规范写法 2026-11-08T10:00:00Z（UTC，精确到秒）。 */
const AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/
const ENV_KEYS = ['rocm', 'torch', 'triton'] as const
/** 正常的码解开不到 1 KB；限制解压后的大小，免得一串恶意的码解出几个 GB（同 Python）。 */
const MAX_JSON_BYTES = 64 * 1024

export interface LabDevice {
  name: string
  gfx: string
  cus: number
}

/** 软件版本；查不到的是 null。 */
export interface LabEnv {
  rocm?: string | null
  torch?: string | null
  triton?: string | null
}

/** 通关凭证 v1（07 第 8 节；格式写在 hello_gpu/codes.py 开头）。 */
export interface LabCredential {
  v: typeof LAB_VERSION
  stage: string
  route: LabRoute
  at: string
  device: LabDevice
  env: LabEnv
  checks: { passed: number; total: number }
  metrics: Record<string, number>
}

/** GPU 卡片 v1（HGCARD1.；格式写在 hello_gpu/codes.py 开头）：设备比凭证多 wave 和显存，2-4 测过峰值才有 peak。 */
export interface LabCard {
  v: typeof LAB_VERSION
  at: string
  device: LabDevice & {
    /** wave 大小；PyTorch 和 rocminfo 都没给时是 null 或不写。 */
    wave?: number | null
    /** 显存字节数（PyTorch 的 total_memory）。 */
    memory_bytes: number
  }
  env: LabEnv
  /** hg.peak() 测出的峰值带宽（GB/s）和 FP32 FMA 吞吐（TFLOPS）；没测过时不写或是 null。 */
  peak?: { gbps: number; tflops: number } | null
}

/**
 * 码解不开或内容不合格。kind 和 Python 的 CodeError 一样：format（不是完整的码）、version（版本不对）、
 * stage（不是这一关的）、data（数据异常）；网页多三种：card（要通关码的地方贴了 GPU 卡片导入码）、
 * credential（要 GPU 卡片导入码的地方贴了通关码）、browser（浏览器太旧，没有 DecompressionStream）。
 * message 和 Python 的说明一致，怎么改见 explainLabError（通关码）和 device.ts 的 explainCardError（GPU 卡片）。
 */
export type LabErrorKind = 'format' | 'version' | 'stage' | 'data' | 'card' | 'credential' | 'browser'

export class LabCodeError extends Error {
  kind: LabErrorKind
  /** kind 是 stage 时：凭证里写的是哪一关。 */
  found: string

  constructor(kind: LabErrorKind, message: string, found = '') {
    super(message)
    this.name = 'LabCodeError'
    this.kind = kind
    this.found = found
  }
}

const dataError = (message: string) => new LabCodeError('data', message)

// ── 小工具（同 hello_gpu.codes 的 number / positive / count / _show）────────

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 只读对象自己的键：JSON.parse 出来的对象带着原型，metrics.constructor 这种不能算数。 */
function own(object: JsonObject, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 有限的正数，否则是 null。 */
export function positive(value: unknown): number | null {
  const n = finite(value)
  return n !== null && n > 0 ? n : null
}

/** 非负整数，否则是 null。5.0 也算 5：JSON 里的 5 和 5.0 是同一个数。 */
function count(value: unknown): number | null {
  const n = finite(value)
  return n !== null && n >= 0 && Number.isInteger(n) ? n : null
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value === undefined ? null : value) ?? String(value)
  } catch {
    return String(value)
  }
}

function leapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function validAt(at: unknown): boolean {
  const m = typeof at === 'string' ? AT.exec(at) : null
  if (!m) return false
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number)
  const days = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return year >= 1 && days !== undefined && day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59
}

// ── 编码和解码 ────────────────────────────────────────────────────────────
// JSON → UTF-8 → raw deflate → base64url（不补 =），前面加前缀（07 第 8 节）。

/** bytes 流过 transform（压缩或解压）；limit 是结果最多多少字节，超了就停下报错。 */
async function pipe(bytes: Uint8Array, transform: ReadableWritablePair<Uint8Array, Uint8Array>, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(transform).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      throw new LabCodeError('format', '码里的内容太长，不是 Hello GPU 生成的')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

/** 把凭证（CREDENTIAL_PREFIX）或卡片（CARD_PREFIX）的内容编成码。只编码，不检查内容；预览页和单测用它造样例。 */
export async function encodeCode(prefix: string, payload: unknown): Promise<string> {
  if (prefix !== CREDENTIAL_PREFIX && prefix !== CARD_PREFIX) throw new Error(`前缀只能是 ${CREDENTIAL_PREFIX} 或 ${CARD_PREFIX}`)
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('deflate-raw'))
  let binary = ''
  for (const byte of packed) binary += String.fromCharCode(byte)
  return prefix + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 解开一串码，返回前缀和里面的 JSON（同 hello_gpu.codes.decode 的前半段：只解码，不检查内容）。
 * 复制时混进来的空白会被忽略。码不完整、被改过、版本不认识时抛 LabCodeError。
 * 压缩数据结束以后还多出来的字节：浏览器按 Compression Streams 规范报错（和 Python 一样算解不开），
 * Node 的 DecompressionStream 不管它们；解出来的内容反正还要逐项检查，单测不依赖这一点。
 */
export async function decodeCode(code: unknown): Promise<{ prefix: string; payload: unknown }> {
  if (typeof code !== 'string') throw new LabCodeError('format', '码应该是一串文字')
  const text = code.replace(/\s+/g, '')
  const match = PREFIX.exec(text)
  if (!match) throw new LabCodeError('format', `不是 Hello GPU 的码：开头应该是 ${CREDENTIAL_PREFIX} 或 ${CARD_PREFIX}`)
  const prefix = match[0]
  if (prefix !== CREDENTIAL_PREFIX && prefix !== CARD_PREFIX) {
    throw new LabCodeError('version', `版本不对：这里只认识 ${CREDENTIAL_PREFIX} 和 ${CARD_PREFIX} 开头的码，这个码是 ${prefix}`)
  }
  const body = text.slice(prefix.length)
  if (!BODY.test(body)) throw new LabCodeError('format', '码里有不该出现的字符，或者没有复制完整')
  if (typeof DecompressionStream === 'undefined') {
    throw new LabCodeError('browser', '解码要用浏览器自带的 DecompressionStream，这个浏览器还没有')
  }
  let raw: Uint8Array
  try {
    const binary = atob(body.replace(/-/g, '+').replace(/_/g, '/'))
    const packed = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    raw = await pipe(packed, new DecompressionStream('deflate-raw'), MAX_JSON_BYTES)
  } catch (error) {
    if (error instanceof LabCodeError) throw error
    throw new LabCodeError('format', '码不完整或被改动过，解不开')
  }
  try {
    // 保留 BOM：Python 的 json.loads 遇到 BOM 会报错，两边要一致。
    return { prefix, payload: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw)) }
  } catch {
    throw new LabCodeError('format', '码里的内容不是有效的 JSON')
  }
}

function checkCommon(payload: unknown): asserts payload is JsonObject {
  if (!isObject(payload)) throw new LabCodeError('format', '码里装的不是一个 JSON 对象')
  if (finite(own(payload, 'v')) !== LAB_VERSION) {
    throw new LabCodeError('version', `版本不对：这里只认识 v = ${LAB_VERSION}，这个码是 v = ${show(own(payload, 'v'))}`)
  }
  if (!validAt(own(payload, 'at'))) throw dataError('生成时间 at 应该是 2026-11-08T10:00:00Z 这样的 UTC 时间')
}

/** 设备信息（同 hello_gpu.codes._check_device）；card 为 true 时还要有 GPU 卡片多出来的 wave 和 memory_bytes。 */
function checkDevice(device: unknown, card = false) {
  if (!isObject(device)) throw dataError('缺少设备信息 device')
  const name = own(device, 'name')
  if (typeof name !== 'string' || !name.trim()) throw dataError('device.name（GPU 名称）应该是一段文字')
  const gfx = own(device, 'gfx')
  if (typeof gfx !== 'string' || !GFX.test(gfx)) throw dataError('device.gfx（架构）应该是 gfx 加架构编号')
  const cus = count(own(device, 'cus'))
  if (cus === null || cus < 1) throw dataError('device.cus（CU 数）应该是正整数')
  if (!card) return
  const wave = own(device, 'wave')
  if (wave !== undefined && wave !== null && (count(wave) ?? 0) < 1) {
    throw dataError('device.wave（wave 大小）应该是正整数，不知道时写 null')
  }
  const memory = count(own(device, 'memory_bytes'))
  if (memory === null || memory < 1) throw dataError('device.memory_bytes（显存字节数）应该是正整数')
}

function checkEnv(env: unknown) {
  if (!isObject(env)) throw dataError('缺少软件版本 env')
  for (const key of ENV_KEYS) {
    const value = own(env, key)
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw dataError(`env.${key} 应该是版本号文字，查不到时写 null`)
    }
  }
}

/** 检查通关凭证（同 hello_gpu.codes.check_credential）；给了 stage 时还要求是这一关的。不合格时抛 LabCodeError。 */
export function checkCredential(payload: unknown, stage?: string): asserts payload is LabCredential {
  checkCommon(payload)
  const found = own(payload, 'stage')
  if (typeof found !== 'string' || !STAGE_ID.test(found)) throw dataError('关卡 id（stage）缺失或写法不对')
  if (stage !== undefined && found !== stage) {
    throw new LabCodeError('stage', `这是关卡 ${found} 的通关码，不是本关（${stage}）的`, found)
  }
  if (!(LAB_ROUTES as readonly unknown[]).includes(own(payload, 'route'))) {
    throw dataError('路线（route）只能是 hip、triton 或 shared')
  }
  checkDevice(own(payload, 'device'))
  checkEnv(own(payload, 'env'))
  const checks = own(payload, 'checks')
  const passed = isObject(checks) ? count(own(checks, 'passed')) : null
  const total = isObject(checks) ? count(own(checks, 'total')) : null
  if (passed === null || total === null || total < 1 || passed > total) {
    throw dataError('校验结果 checks 应该是 {passed, total}，0 ≤ passed ≤ total，total ≥ 1')
  }
  const metrics = own(payload, 'metrics')
  if (!isObject(metrics)) throw dataError('缺少测量数据 metrics')
  for (const [name, value] of Object.entries(metrics)) {
    if (!METRIC_NAME.test(name)) throw dataError(`测量项的名字 ${show(name)} 只能用小写字母、数字和下划线，并以字母开头`)
    if (positive(value) === null) throw dataError(`测量项 ${name} 应该是有限的正数，现在是 ${show(value)}`)
  }
}

/** 解开通关码并检查；给了 stage 时必须是这一关的。贴的是 GPU 卡片导入码时报 card。 */
export async function decodeCredential(code: unknown, stage?: string): Promise<LabCredential> {
  const { prefix, payload } = await decodeCode(code)
  if (prefix === CARD_PREFIX) {
    throw new LabCodeError('card', `这是「我的 GPU 卡片」的导入码（${CARD_PREFIX} 开头），不是通关码`)
  }
  checkCredential(payload, stage)
  return payload
}

/** 检查 GPU 卡片（同 hello_gpu.codes.check_card）。不合格时抛 LabCodeError。 */
export function checkCard(payload: unknown): asserts payload is LabCard {
  checkCommon(payload)
  checkDevice(own(payload, 'device'), true)
  checkEnv(own(payload, 'env'))
  const peak = own(payload, 'peak')
  if (peak !== undefined && peak !== null
    && !(isObject(peak) && positive(own(peak, 'gbps')) !== null && positive(own(peak, 'tflops')) !== null)) {
    throw dataError('peak 应该是 {gbps, tflops}，两个都是有限的正数')
  }
}

/** 解开「我的 GPU 卡片」导入码并检查。贴的是通关码时报 credential。 */
export async function decodeCard(code: unknown): Promise<LabCard> {
  const { prefix, payload } = await decodeCode(code)
  if (prefix === CREDENTIAL_PREFIX) {
    throw new LabCodeError('credential', `这是通关码（${CREDENTIAL_PREFIX} 开头），不是「我的 GPU 卡片」的导入码`)
  }
  checkCard(payload)
  return payload
}

// ── 星级规则（07 第 9 节；同 hello_gpu.stars）──────────────────────────────

export type LabRule = { checksAll: true } | { ratio: [string, string]; gte: number }

/** 拿到这颗星时顺带发的徽章：只有 beat-torch（04 第 4 节「打败 torch」：拿到「比 torch 快」的星）。 */
export const STAR_BADGES = ['beat-torch'] as const

export interface LabStar {
  text: string
  rule: LabRule
  badge?: (typeof STAR_BADGES)[number]
}

/** outline.json 里一关（或一道真卡副本）的 lab 字段。 */
export interface LabSpec {
  stars: LabStar[]
}

/** 规则写错时抛 Error（中文说明，同 hello_gpu.stars.check_rule）。 */
export function checkRule(rule: unknown): asserts rule is LabRule {
  const keys = isObject(rule) ? Object.keys(rule).sort().join(',') : ''
  if (isObject(rule) && keys === 'checksAll') {
    if (rule.checksAll !== true) throw new Error('checksAll 只能写 true')
    return
  }
  if (isObject(rule) && keys === 'gte,ratio') {
    const ratio = rule.ratio
    if (!(Array.isArray(ratio) && ratio.length === 2 && ratio.every((name) => typeof name === 'string' && METRIC_NAME.test(name)))) {
      throw new Error('ratio 要写成两个测量项的名字，例如 ["gbps", "peak_gbps"]')
    }
    if (ratio[0] === ratio[1]) throw new Error('ratio 的两个测量项不能相同')
    if (positive(rule.gte) === null) throw new Error('gte 要是有限的正数')
    return
  }
  throw new Error(`不认识的规则 ${show(rule)}：只支持 {"checksAll": true} 和 {"ratio": [a, b], "gte": x}`)
}

/** 检查一关的 lab.stars；写错时抛 Error，说明是第几颗星（同 hello_gpu.stars.check_stars）。多出来的键（例如 badge）不管。 */
export function checkStars(stars: unknown): asserts stars is LabStar[] {
  if (!Array.isArray(stars)) throw new Error('lab.stars 要是一个列表')
  stars.forEach((star, i) => {
    const index = i + 1
    if (!isObject(star)) throw new Error(`第 ${index} 颗星要写成 {"text": 说明, "rule": 规则}`)
    const text = star.text
    if (typeof text !== 'string' || !text.trim()) throw new Error(`第 ${index} 颗星缺少说明 text`)
    try {
      checkRule(star.rule)
    } catch (error) {
      throw new Error(`第 ${index} 颗星：${(error as Error).message}`)
    }
  })
}

/**
 * 网页上一关的规则还要满足的几条（Python 的求值器不管，样例里也可以不满足）：
 * 1 到 3 颗星，★1 是 {"checksAll": true}（04 第 3 节：★1 是多种形状都通过校验；挑战状态拿 ★1 判过没过，
 * 没过一颗星都不发）；badge 只能写 STAR_BADGES 里的。
 */
export function checkStageStars(stars: unknown): asserts stars is LabStar[] {
  checkStars(stars)
  if (!stars.length) throw new Error('一颗星都没写：至少要有 ★1 {"text": "多种形状都通过校验", "rule": {"checksAll": true}}')
  if (stars.length > MAX_STARS) throw new Error(`一关最多 ${MAX_STARS} 颗星，现在写了 ${stars.length} 颗`)
  if (!('checksAll' in stars[0].rule)) {
    throw new Error('第 1 颗星的规则要写 {"checksAll": true}：★1 是多种形状都通过校验，没达到时别的星都不发（04 第 3 节）')
  }
  stars.forEach((star, i) => {
    const badge = (star as unknown as JsonObject).badge
    if (badge !== undefined && !(STAR_BADGES as readonly unknown[]).includes(badge)) {
      throw new Error(`第 ${i + 1} 颗星的 badge 只能写 ${STAR_BADGES.join('、')}，现在是 ${show(badge)}`)
    }
  })
}

/** 一颗星的判定和理由，LabCard 逐条列出来。 */
export interface StarVerdict {
  text: string
  earned: boolean
  /** 为什么拿到或没拿到，例如「gbps ÷ peak_gbps = 0.6，要 ≥ 0.6」。 */
  detail: string
  /** 拿到这颗星时顺带发的徽章，没有是 null。 */
  badge: string | null
}

/** 比值的写法：先按 3 位有效数字；要是四舍五入以后看起来和判定对不上（例如 2.1999… 写成 2.20 却没过 2.2），就多写几位。 */
function formatRatio(value: number, gte: number, earned: boolean): string {
  for (let digits = 3; digits < 17; digits++) {
    const text = String(Number(value.toPrecision(digits)))
    if ((Number(text) >= gte) === earned) return text
  }
  return String(value)
}

function judge(rule: LabRule, credential: unknown): { earned: boolean; detail: string } {
  const source = isObject(credential) ? credential : {}
  if ('checksAll' in rule) {
    const checks = own(source, 'checks')
    const passed = isObject(checks) ? count(own(checks, 'passed')) : null
    const total = isObject(checks) ? count(own(checks, 'total')) : null
    if (passed === null || total === null) return { earned: false, detail: '凭证里没有校验结果' }
    const earned = total >= 1 && passed === total
    const rest = total - passed
    return { earned, detail: `${passed}/${total} 项通过校验${!earned && rest > 0 ? `，还差 ${rest} 项` : ''}` }
  }
  const metrics = own(source, 'metrics')
  const values = rule.ratio.map((name) => (isObject(metrics) ? own(metrics, name) : undefined))
  for (const [i, name] of rule.ratio.entries()) {
    if (values[i] === undefined) return { earned: false, detail: `凭证里没有 ${name}` }
    if (positive(values[i]) === null) return { earned: false, detail: `${name} 不是正数` }
  }
  const value = (values[0] as number) / (values[1] as number)
  const gte = positive(rule.gte) as number
  const earned = value >= gte
  return { earned, detail: `${rule.ratio[0]} ÷ ${rule.ratio[1]} = ${formatRatio(value, gte, earned)}，要 ≥ ${gte}` }
}

/** 按规则逐颗判定这份凭证拿到了哪些星，带上理由。规则写错时抛 Error；凭证里缺数、数不合格只算没拿到。 */
export function judgeStars(stars: unknown, credential: unknown): StarVerdict[] {
  checkStars(stars)
  return stars.map((star) => ({
    text: star.text,
    ...judge(star.rule, credential),
    badge: typeof star.badge === 'string' ? star.badge : null,
  }))
}

/** 按规则逐颗判断拿到了哪些星，返回和 stars 一样长的 true / false 列表（同 hello_gpu.stars.evaluate）。 */
export function evaluateStars(stars: unknown, credential: unknown): boolean[] {
  return judgeStars(stars, credential).map((v) => v.earned)
}

// ── 实验室在哪 ────────────────────────────────────────────────────────────

/** 教程仓库：GitHub 上查看 Notebook、在云平台上克隆仓库都用它（和站点页脚的仓库地址一致）。 */
export const LAB_REPO = 'https://github.com/datawhalechina/hello-gpu'
/** 站点对应的分支（和 config.mts 的「在 GitHub 上编辑此页」一致）。 */
export const LAB_BRANCH = 'dev'

/**
 * 有实验室的一关（gpu: true 的关卡）或一道真卡副本（env: gpu），字段和 nb-build.mjs 的 resolveTarget 对应：
 * Notebook 在 notebooks/<dir>/<slug>/，通关链接指向 page。
 */
export interface LabTarget {
  id: string
  kind: 'stage' | 'dungeon'
  /** 显示名：关卡写「2-9 Softmax」，副本写「副本 标题」。 */
  name: string
  dir: string
  slug: string
  /** 页面地址（不带站点 base），例如 /forge/softmax/。 */
  page: string
  routes: 'split' | 'shared'
  status: string
  /** outline.json 里的 lab.stars，还没写是 null（内容没检查过，用前先 checkStageStars）。 */
  stars: unknown
}

/** 关卡 id 或副本 id 对应的实验室；不是真卡关卡或真卡副本时是 null。 */
export function labTarget(id: string): LabTarget | null {
  const stage = stageById(id)
  if (stage) {
    if (!stage.gpu) return null
    return {
      id, kind: 'stage', name: `${stage.code} ${stage.title}`, dir: stage.zone, slug: stage.slug, page: stageHref(stage),
      routes: routesOf(stage) === 'split' ? 'split' : 'shared', status: stage.status, stars: stage.lab?.stars ?? null,
    }
  }
  const exercise = exerciseById(id)
  if (!exercise || exercise.env !== 'gpu') return null
  return {
    id, kind: 'dungeon', name: `副本 ${exercise.title}`, dir: 'dungeon', slug: exercise.slug, page: exerciseHref(exercise),
    routes: zoneById(exercise.zone)?.routes === 'split' ? 'split' : 'shared', status: exercise.status, stars: exercise.lab?.stars ?? null,
  }
}

/** 这一关有哪几个版本的 Notebook：分路线的是 hip 和 triton，共用的只有 shared（同 nb-build.mjs）。 */
export function notebookRoutes(target: Pick<LabTarget, 'routes'>): LabRoute[] {
  return target.routes === 'split' ? ['hip', 'triton'] : ['shared']
}

export function notebookFile(target: Pick<LabTarget, 'slug'>, route: LabRoute): string {
  return `${target.slug}${route === 'shared' ? '' : `-${route}`}.ipynb`
}

/** Notebook 在仓库里的路径（07 第 3 节）；站点上也放在同一个路径下（docs/.vitepress/lab-notebooks.mjs）。 */
export function notebookPath(target: Pick<LabTarget, 'dir' | 'slug'>, route: LabRoute): string {
  return `notebooks/${target.dir}/${target.slug}/${notebookFile(target, route)}`
}

/** 在 GitHub 上查看仓库里的一个文件。 */
export function githubUrl(path: string): string {
  return `${LAB_REPO}/blob/${LAB_BRANCH}/${path}`
}

/** 页面地址片段里的通关码：#lab=<码> 返回码，不是通关链接的片段返回 null。 */
export function codeFromHash(hash: string): string | null {
  if (!hash.startsWith(LINK_HASH)) return null
  const code = hash.slice(LINK_HASH.length)
  try {
    return decodeURIComponent(code)
  } catch {
    return code
  }
}

/** 文字里的通关码（通关链接 #lab= 后面那串也算）：HGPU 前缀加 base64url。 */
const CREDENTIAL_IN_TEXT = /HGPU\d+\.[A-Za-z0-9_-]+/g

/**
 * 把一段文字里的通关码换成只剩前缀（L-05：观摩模式回放档案记录的「交成绩」输出时用）。那是采集这条记录的人的成绩，
 * 输出里还写着「也可以粘贴到关卡页的『导入成绩』里」，照着贴进来，别人的星就成了读者自己的。
 */
export function hideCredentialCodes(text: string): string {
  return text.replace(CREDENTIAL_IN_TEXT, (code) => `${code.slice(0, code.indexOf('.') + 1)}…`)
}

// ── 显示 ──────────────────────────────────────────────────────────────────

/** 档案馆里的一条参考记录（L-04 的档案条目带着凭证的这几项），LabCard 把它和读者的数字列在一起。 */
export interface LabReference {
  /** 档案条目 id（docs/lab/data/<关卡>/<文件名去掉 .json>），链接到 /lab/#<id>。 */
  entry: string
  route: LabRoute
  at: string
  device: LabDevice
  metrics: Record<string, number>
}

/**
 * hg.compare(...).metrics()、hg.race()、hg.warm_cold(...).metrics、hg.roofline(...).metrics 和 hg.trace(...).metrics 写出的测量项
 * （L-01、FG-LAB-01、FG-LAB-03、FG-LAB-04、FG-LAB-05）。其余的按后缀认：「<名字>_ms」是那个实现的耗时中位数；
 * hg.roofline 给每个点写「<点名>_gbps」「_tflops」「_intensity」「_roof_tflops」（这个算术强度下的屋顶）；
 * hg.trace 给每一行写「<行名>_kernels」（kernel 数）、「_gpu_ms」（GPU 忙的时间）、「_span_ms」（从开始到算完）。
 */
const METRIC_LABELS: Record<string, string> = {
  median_ms: '耗时中位数',
  p10_ms: '耗时 p10',
  p90_ms: '耗时 p90',
  gbps: '有效带宽',
  tflops: '算力',
  peak_gbps: '这张卡的峰值带宽（实测）',
  peak_tflops: '这张卡的峰值算力（实测）',
  ridge: '这张卡的拐点',
  cpu_ms: 'CPU 的耗时中位数',
  trip_ms: '算上拷进拷回的耗时中位数',
  cold_ms: '冷缓存的耗时中位数',
  cold_p10_ms: '冷缓存的耗时 p10',
  cold_p90_ms: '冷缓存的耗时 p90',
  cold_gbps: '冷缓存的有效带宽',
}

/** 按后缀认的测量项：长的后缀在前（_roof_tflops 要先于 _tflops，_gpu_ms、_span_ms 要先于 _ms）。 */
const METRIC_SUFFIXES: readonly [string, string][] = [
  ['_roof_tflops', '的屋顶'],
  ['_intensity', '的算术强度'],
  ['_tflops', '的算力'],
  ['_gbps', '的有效带宽'],
  ['_kernels', '的 kernel 数'],
  ['_gpu_ms', '在 GPU 上忙的时间'],
  ['_span_ms', '从开始到算完'],
  ['_ms', '的耗时中位数'],
]

export function metricLabel(name: string): string {
  if (METRIC_LABELS[name]) return METRIC_LABELS[name]
  const suffix = METRIC_SUFFIXES.find(([end]) => name.endsWith(end) && name.length > end.length)
  return suffix ? `${name.slice(0, -suffix[0].length)} ${suffix[1]}` : name
}

export function metricUnit(name: string): string {
  if (name.endsWith('_ms')) return 'ms'
  if (name === 'gbps' || name.endsWith('_gbps')) return 'GB/s'
  if (name === 'tflops' || name.endsWith('_tflops')) return 'TFLOPS'
  if (name === 'ridge' || name.endsWith('_intensity')) return 'FLOP/字节'
  if (name.endsWith('_kernels')) return '个'
  return ''
}

/** 测量值的写法：4 位有效数字（同 hello_gpu 打印的 .4g），特别大或特别小时用科学计数法。 */
export function formatNumber(value: number): string {
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return value.toPrecision(4)
  return String(Number(value.toPrecision(4)))
}

/** 凭证的生成时间：2026-11-08T10:00:00Z → 2026-11-08 10:00（UTC）。 */
export function formatAt(at: string): string {
  const m = AT.exec(at)
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}（UTC）` : at
}

/** 导入失败时给读者看的话：现象、原因、怎么改（03 第 4 节）；link 是可以去的那一关（不带站点 base）。 */
export interface LabErrorText {
  symptom: string
  cause: string
  fix: string
  link: { href: string; text: string } | null
}

export function explainLabError(error: LabCodeError, stage: string): LabErrorText {
  const plain = { cause: `${error.message}。`, link: null }
  switch (error.kind) {
    case 'version':
      return {
        ...plain,
        symptom: '通关码的版本不对，这一页认不出来。',
        fix: '网页和 Notebook 要是同一版：先刷新这一页；还不行就在仓库目录里运行 git pull，更新 Notebook 和 hello_gpu，再重新运行「交成绩」单元。',
      }
    case 'stage': {
      const other = labTarget(error.found)
      const here = labTarget(stage)
      return {
        symptom: '这是另一关的通关码。',
        cause: `这串码记的是${other ? `「${other.name}」` : `关卡 ${error.found} `}的成绩，不是本关${here ? `「${here.name}」` : ''}的。`,
        fix: '每一关的通关码只能在那一关的页面上导入；本关的成绩要用本关的 Notebook 生成。',
        link: other && isPublished(other) ? { href: other.page, text: `去「${other.name}」导入` } : null,
      }
    }
    case 'data':
      return {
        ...plain,
        symptom: '通关码能解开，但里面的数据不对。',
        fix: '重新运行 Notebook 最后的「交成绩」单元，用新生成的通关码；通关码里的内容不要手改。',
      }
    case 'card':
      return {
        ...plain,
        symptom: '贴进来的是「我的 GPU 卡片」导入码，不是通关码。',
        cause: `${CARD_PREFIX} 开头的码由 hg.device_card() 生成，记的是这张卡的参数，不是本关的成绩。`,
        fix: `这里要的是本关 Notebook 最后一个单元 hg.submit() 打印的、${CREDENTIAL_PREFIX} 开头的通关码。`,
      }
    case 'browser':
      return {
        ...plain,
        symptom: '这个浏览器解不开通关码。',
        fix: '换用新版的 Chrome、Edge、Firefox 或 Safari 再导入。',
      }
    default:
      return {
        ...plain,
        symptom: '这串字符不是完整的通关码。',
        fix: `回到 Notebook，把「交成绩」单元打印的 ${CREDENTIAL_PREFIX} 开头的那一整串复制过来；也可以直接点它上面那行通关链接。`,
      }
  }
}
