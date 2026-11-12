import assert from 'node:assert/strict'
import test from 'node:test'
import { highlight } from '../../docs/components/kit/sandbox/highlight.ts'
import { buildRequest, describeRun, describeStep, explainError, stepGroups } from '../../docs/components/kit/sandbox/run.ts'
import { codeLines, fillTemplate, parseTemplate, TemplateError } from '../../docs/components/kit/sandbox/template.ts'
import {
  ADD_ARGS, ADD_CODE, CHALLENGE_N, EXPECTED, RELU_ARGS, RELU_CODE, RELU_LAUNCH, judge, variantsFor,
} from './fixtures/kit/sandbox-demo.ts'
import { run } from '../../docs/sim/lockstep.ts'
import { parse } from '../../docs/sim/syntax/index.ts'

/** 代码沙盒（S-05）：填空模板、高亮、运行结果的解读，以及用沙盒做试点关卡的挑战（两种写法结果相同）。 */

const LANGS = ['hip', 'python']

test('模板：[[名字: 初始内容]] 标出空，填好后知道每个空在哪', () => {
  const t = parseTemplate('int i = [[i: threadIdx.x]];\nc[[[k]]] = a[[[j: b[i]]]];')
  assert.deepEqual(t.blanks, [
    { name: 'i', initial: 'threadIdx.x' },
    { name: 'k', initial: '' },
    { name: 'j', initial: 'b[i]' },
  ])
  const initial = fillTemplate(t)
  assert.equal(initial.source, 'int i = threadIdx.x;\nc[] = a[b[i]];')
  for (const r of initial.ranges) {
    assert.equal(initial.source.slice(r.from, r.to), t.blanks.find((b) => b.name === r.name).initial)
  }
  // 读者填的内容换掉初始内容；没填的空照旧；内容里的换行换成空格，行号不会变
  const filled = fillTemplate(t, { i: 'blockIdx.x *\nblockDim.x', k: 'i' })
  assert.equal(filled.source, 'int i = blockIdx.x * blockDim.x;\nc[i] = a[b[i]];')
  assert.deepEqual(filled.ranges.map((r) => filled.source.slice(r.from, r.to)), ['blockIdx.x * blockDim.x', 'i', 'b[i]'])
})

test('模板写错了：报出第几行、错在哪', () => {
  const cases = [
    ['int i = [[i: threadIdx.x;\n', /第 1 行.*没有在这一行里用「]]」结束/],
    ['x\nint i = [[ i ]];', /第 2 行.*紧跟空的名字/],
    ['[[i]] + [[i: 1]]', /名字「i」重复了/],
  ]
  for (const [template, message] of cases) {
    assert.throws(() => parseTemplate(template), (err) => err instanceof TemplateError && message.test(err.message), template)
  }
})

test('高亮：两种写法的关键字、内建名字、注释；点后面的名字和数字的后缀不算', () => {
  const tones = (source, lang) => highlight(source, lang).map((t) => `${t.tone}:${source.slice(t.from, t.to)}`)
  assert.deepEqual(
    tones('__global__ void f(float* a) { // 注释\n  if (threadIdx.x < 2) a[0] = 2.0f; /* 块\n注释 */ __syncthreads(); }', 'hip'),
    ['keyword:__global__', 'keyword:void', 'keyword:float', 'comment:// 注释', 'keyword:if', 'keyword:threadIdx',
      'comment:/* 块\n注释 */', 'keyword:__syncthreads'],
  )
  assert.deepEqual(
    tones('@kernel\ndef f(a, n):  # 注释\n    if not True and n > 1e3:\n        a.if = 0', 'python'),
    ['keyword:@kernel', 'keyword:def', 'comment:# 注释', 'keyword:if', 'keyword:not', 'keyword:True', 'keyword:and'],
  )
})

test('静态代码：按行切开，空单独成段（空着的空也有一段），颜色和编辑器同一份', () => {
  const filled = fillTemplate(parseTemplate('int i = [[i: threadIdx.x]]; // 下标\nif ([[g]]) {}'))
  const lines = codeLines(filled, 'hip')
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0], [
    { kind: 'text', text: 'int', tone: 'keyword' },
    { kind: 'text', text: ' i = ', tone: null },
    { kind: 'blank', name: 'i', text: 'threadIdx.x' },
    { kind: 'text', text: '; ', tone: null },
    { kind: 'text', text: '// 下标', tone: 'comment' },
  ])
  assert.deepEqual(lines[1].map((s) => s.kind === 'blank' ? `[${s.name}:${s.text}]` : s.text), ['if', ' (', '[g:]', ') {}'])
  // 完整模式不按空切：同样的代码，空的内容当普通代码，照样高亮
  const plain = codeLines(filled, 'hip', false)
  assert.ok(plain.flat().every((s) => s.kind === 'text'))
  assert.equal(plain.map((line) => line.map((s) => s.text).join('')).join('\n'), filled.source)
  assert.deepEqual(plain[0][2], { kind: 'text', text: 'threadIdx', tone: 'keyword' })
})

test('模拟器的错误写成现象、原因、怎么改，原文放进折叠块', () => {
  const syntax = run(buildRequest('__global__ void f(int n) {\n    int i = 0\n}', 'hip', { grid: 1, block: 4 }, { n: { type: 'int', value: 1 } }))
  assert.equal(syntax.ok, false)
  const e = explainError(syntax.error)
  assert.match(e.symptom, /^第 2 行第 \d+ 列有语法错误，程序没有运行。$/)
  assert.equal(e.cause, syntax.error.message)
  assert.equal(e.fix, syntax.error.hint)
  assert.match(e.raw, /^第 2 行第 \d+ 列，语法错误：/)

  const runtime = run(buildRequest('@kernel\ndef f(a, n):\n    a[0] = n // (n - 1)', 'python', { grid: 1, block: 1 },
    { a: { type: 'int', data: [0] }, n: { type: 'int', value: 1 } }))
  assert.equal(runtime.ok, false)
  assert.match(explainError(runtime.error).symptom, /^运行到第 3 行第 \d+ 列时出错，程序停下了。$/)
})

test('单步：每一步是一个 wave 执行的一行，说清是谁、第几行、几个线程一起做了什么', () => {
  for (const lang of LANGS) {
    const source = fillTemplate(parseTemplate(RELU_CODE[lang])).source
    const result = run(buildRequest(source, lang, RELU_LAUNCH, RELU_ARGS))
    assert.equal(result.ok, true, lang)
    assert.deepEqual(result.arrays.x, [3, 0, 4, 0, 0, 9, 0, 6, 5, 0])
    const groups = stepGroups(result.events)
    // 08 第 4 节：每一步至少记一个事件，所以分出来的步数就是模拟器数的步数
    assert.equal(groups.length, result.steps)
    for (const g of groups) {
      for (const e of result.events.slice(g.from, g.to)) assert.deepEqual([e.step, e.line, e.block, e.wave], [g.step, g.line, g.block, g.wave])
    }
    const texts = groups.map((g) => describeStep(g, result.events, RELU_LAUNCH))
    const off = lang === 'python' ? 1 : 0
    assert.deepEqual(texts, [
      `block 0，第 ${2 + off} 行：16 个线程一起计算。`,
      `block 0，第 ${3 + off} 行：16 个线程一起判断条件。`,
      `block 0，第 ${4 + off} 行：10 个线程一起判断条件，读 x。`,
      `block 0，第 ${5 + off} 行：5 个线程一起写 x。`,
    ])
    assert.equal(describeRun(result, RELU_LAUNCH), '16 个线程，一共 4 步。')
  }
})

/** 沙盒点一次「运行」做的事：读者设的启动配置跑一次，代码没出错再按 variants 各跑一次。 */
function sandboxRuns(lang, values, launch) {
  const source = fillTemplate(parseTemplate(ADD_CODE[lang]), values).source
  const main = { launch, result: run(buildRequest(source, lang, launch, ADD_ARGS)) }
  if (!main.result.ok) return [main]
  return [main, ...variantsFor(launch).map((l) => ({ launch: l, result: run(buildRequest(source, lang, l, ADD_ARGS)) }))]
}

/** 两种写法跑同一份代码：结果、诊断、越界区、判星逐项相同，事件只差行号（Python 多一行 @kernel）。 */
function bothLangs(values, launch) {
  const [hip, python] = LANGS.map((lang) => sandboxRuns(lang, values[lang] ?? values, launch))
  const strip = (runs) => runs.map(({ launch: l, result }) => ({
    launch: l,
    ok: result.ok,
    arrays: result.arrays,
    outside: result.outside.map((o) => ({ ...o, writes: o.writes.map(({ line, ...w }) => w) })),
    diagnostics: result.diagnostics.length,
    steps: result.steps,
    events: result.events.map(({ line, ...e }) => e),
  }))
  assert.deepEqual(strip(python), strip(hip))
  const verdict = judge(hip)
  assert.deepEqual(judge(python), verdict)
  return { verdict, result: hip[0].result }
}

const GLOBAL = 'blockIdx.x * blockDim.x + threadIdx.x'
const guard = (hip, python = hip) => ({ hip: { i: GLOBAL, guard: hip }, python: { i: GLOBAL, guard: python } })

test('试点挑战 ★1：初始代码每组都从 0 开始拿数，现象、原因、怎么改都说清', () => {
  const { verdict, result } = bothLangs({}, { grid: 2, block: 4 })
  assert.deepEqual(verdict.earned, [false, false, false])
  assert.match(verdict.error.symptom, /^9 个数没人算（c\[4\]、c\[5\].*c\[12\]），4 个数被不止一个线程算了。$/)
  assert.match(verdict.error.fix, /blockIdx\.x \* blockDim\.x \+ threadIdx\.x/)
  assert.equal(verdict.error.raw, `运行后 c = [${result.arrays.c.join(', ')}]`)
  // 规则对了但组数不够：说的是线程不够，不是下标
  const short = bothLangs(guard('i < n', 'i < n'), { grid: 3, block: 4 }).verdict
  assert.deepEqual(short.earned, [false, false, false])
  assert.match(short.error.cause, /只派出 12 个线程/)
  assert.match(short.error.fix, /至少要 4 组/)
})

test('试点挑战 ★2：没有边界检查、或者条件差一个（i <= n）都会写到数组外面', () => {
  const none = bothLangs({ hip: { i: GLOBAL }, python: { i: GLOBAL } }, { grid: 4, block: 4 })
  assert.deepEqual(none.verdict.earned, [true, false, false])
  assert.deepEqual(none.result.arrays.c, EXPECTED)
  assert.match(none.verdict.next, /往数组外面写了 3 次/)
  const offByOne = bothLangs(guard('i <= n'), { grid: 4, block: 4 })
  assert.deepEqual(offByOne.verdict.earned, [true, false, false])
  assert.deepEqual(offByOne.result.outside.map((o) => [o.array, o.index]), [['c', CHALLENGE_N]])
})

test('试点挑战 ★3：组数多派了不行，把每组人数写死也不行；两种写法都能拿满三颗星', () => {
  const extra = bothLangs(guard('i < n'), { grid: 5, block: 4 }).verdict
  assert.deepEqual(extra.earned, [true, true, false])
  assert.match(extra.next, /4 组就够了/)
  const fixed = { hip: { i: 'blockIdx.x * 4 + threadIdx.x', guard: 'i < n' }, python: { i: 'blockIdx.x * 4 + threadIdx.x', guard: 'i < n' } }
  const hardcoded = bothLangs(fixed, { grid: 4, block: 4 }).verdict
  assert.deepEqual(hardcoded.earned, [true, true, false])
  assert.match(hardcoded.next, /换成 2（7 组）.*写死/)
  for (const block of [2, 4, 8]) {
    const full = bothLangs(guard('i < n'), { grid: Math.ceil(CHALLENGE_N / block), block })
    assert.deepEqual(full.verdict.earned, [true, true, true], `每组 ${block} 个`)
    assert.deepEqual(full.result.arrays.c, EXPECTED)
  }
})

test('试点挑战的两种模板解析成同一棵语法树（除了位置）', () => {
  const strip = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  const values = { i: GLOBAL, guard: 'i < n' }
  const [hip, python] = LANGS.map((lang) => parse(fillTemplate(parseTemplate(ADD_CODE[lang]), values).source, lang))
  assert.equal(hip.ok && python.ok, true)
  assert.deepEqual(strip(python.kernel), strip(hip.kernel))
})
