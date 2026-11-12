import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BOOTSTRAP, LOAD_HIP, SITE, buildNotebooks, buildSource, parseSource, resolveTarget } from '../course/nb-build.mjs'
import { MAX_CELL_LINES, checkNotebooks, pythonSyntaxErrors } from '../course/nb-check.mjs'

// 大纲用小样例（免得单测跟着课程内容变）：分路线和共用的真卡关卡各一关、一关模拟器关，真卡副本和模拟器副本各一道。
const outline = {
  zones: [
    { id: 'novice', name: '新手村', env: '浏览器即可（模拟器）', routes: 'syntax' },
    { id: 'forge', name: '铸造城', env: '云 GPU', routes: 'split' },
  ],
  stages: [
    { id: 'novice-demo', zone: 'novice', slug: 'demo', code: '1-1', title: '模拟器关', gpu: false, minutes: 10, status: 'draft' },
    { id: 'forge-split', zone: 'forge', slug: 'split', code: '2-2', title: '分路线', gpu: true, minutes: 30, status: 'planned' },
    { id: 'forge-shared', zone: 'forge', slug: 'shared', code: '2-1', title: '共用', gpu: true, routes: 'shared', minutes: 20, status: 'planned' },
  ],
  exercises: [
    { zone: 'novice', items: [{ id: 'dungeon-sim', slug: 'sim', title: '模拟器副本', env: 'sim', status: 'planned' }] },
    { zone: 'forge', items: [{ id: 'dungeon-row', slug: 'row', title: '行求和', env: 'gpu', status: 'planned' }] },
  ],
}

const F = '```'
/** 一份合格的分路线源文件；每条测试只改它的一处。 */
const GOOD = [
  '# 2-2 分路线（实验室）', '', '<!-- lab:header -->', '',
  '## 准备', '', `${F}python`, 'import hello_gpu as hg', F, '',
  '## 动手', '', '两条路线共用的说明。', '',
  `${F}python`, 'x = 1', F, '',
  `${F}hip route=hip`, '__global__ void add(const float* a, const float* b, float* out, int n) {}', F, '',
  `${F}python route=triton`, 'y = 2', F, '',
  '## 挑战', '', `${F}python`, 'checks = {"passed": 1, "total": 1}', 'metrics = {"median_ms": 1.0}', F, '',
  '## 交成绩', '', '<!-- lab:submit -->', '',
].join('\n')
/** GOOD 去掉只进一条路线的两个单元，给共用关卡用。 */
const SHARED = GOOD.replace(`${F}hip route=hip\n__global__ void add(const float* a, const float* b, float* out, int n) {}\n${F}\n\n`, '')
  .replace(`${F}python route=triton\ny = 2\n${F}\n\n`, '')

const EXAMPLE = readFileSync(new URL('../../notebooks/src/forge/_example.md', import.meta.url), 'utf8')

function target(dir, slug) {
  const { target: found, error } = resolveTarget(outline, dir, slug)
  assert.ok(found, error)
  return found
}

/** 源文件里第一个包含 needle 的行号。 */
function lineOf(text, needle) {
  const index = text.split('\n').findIndex((line) => line.includes(needle))
  assert.ok(index >= 0, `源文件里没有 ${needle}`)
  return index + 1
}

function build(text, dir = 'forge', slug = 'split') {
  const result = buildNotebooks(text, target(dir, slug))
  assert.deepEqual(result.errors, [])
  return Object.fromEntries(result.notebooks.map((nb) => [nb.route, nb]))
}

/** 一本 Notebook 的单元：[{ type, text }]。 */
function cells(nb) {
  return nb.notebook.cells.map((c) => ({ type: c.cell_type, text: c.source.join('') }))
}

const codeCells = (nb) => cells(nb).filter((c) => c.type === 'code').map((c) => c.text)

function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortedKeys(value[k])]))
  return value
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const CELL_KEYS = {
  markdown: ['cell_type', 'id', 'metadata', 'source'],
  code: ['cell_type', 'execution_count', 'id', 'metadata', 'outputs', 'source'],
}

/** nbformat 4.5 的必需字段（nbformat.v4.5.schema.json）：顶层的四项，单元的必需字段且不能多出别的，id 合法且不重复。 */
function nbformatProblems(nb) {
  const problems = []
  const expect = (ok, what) => {
    if (!ok) problems.push(what)
  }
  expect(nb.nbformat === 4, 'nbformat 是 4')
  expect(Number.isInteger(nb.nbformat_minor) && nb.nbformat_minor >= 5, 'nbformat_minor ≥ 5（单元要带 id）')
  expect(isObject(nb.metadata), 'metadata 是对象')
  expect(typeof nb.metadata?.kernelspec?.name === 'string' && typeof nb.metadata?.kernelspec?.display_name === 'string', 'kernelspec 有 name、display_name')
  expect(typeof nb.metadata?.language_info?.name === 'string', 'language_info 有 name')
  expect(Array.isArray(nb.cells), 'cells 是数组')
  const ids = new Set()
  for (const [i, cell] of (nb.cells ?? []).entries()) {
    const keys = CELL_KEYS[cell.cell_type]
    expect(keys && Object.keys(cell).sort().join() === keys.join(), `第 ${i} 个单元的字段`)
    expect(typeof cell.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(cell.id) && !ids.has(cell.id), `第 ${i} 个单元的 id`)
    ids.add(cell.id)
    expect(isObject(cell.metadata), `第 ${i} 个单元的 metadata`)
    expect(Array.isArray(cell.source) && cell.source.every((s) => typeof s === 'string'), `第 ${i} 个单元的 source`)
    if (cell.cell_type === 'code') expect(cell.execution_count === null && Array.isArray(cell.outputs) && !cell.outputs.length, `第 ${i} 个代码单元不带输出`)
  }
  return problems
}

// ── 生成 ───────────────────────────────────────────────────────────────────

test('示例源生成的 HIP 版和 Triton 版符合 nbformat 4.5 的必需字段，不带输出，键按字母排序', () => {
  const result = buildSource({ file: 'notebooks/src/forge/_example.md', dir: 'forge', slug: '_example', text: EXAMPLE }, outline)
  assert.equal(result.example, true)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.notebooks.map((nb) => nb.route), ['hip', 'triton'])
  for (const { json, route } of result.notebooks) {
    const nb = JSON.parse(json)
    assert.deepEqual(nbformatProblems(nb), [], route)
    assert.deepEqual(nb.metadata.hello_gpu, { route, stage: 'forge-_example' })
    // Jupyter 保存时也按字母排序：打开再保存不会产生无关的改动。
    assert.equal(json, `${JSON.stringify(sortedKeys(nb), null, 1)}\n`, route)
  }
})

test('同一份源多次生成结果逐字节相同，CRLF 换行的源也一样', () => {
  const first = buildNotebooks(GOOD, target('forge', 'split')).notebooks.map((nb) => nb.json)
  const again = buildNotebooks(GOOD, target('forge', 'split')).notebooks.map((nb) => nb.json)
  const crlf = buildNotebooks(GOOD.replace(/\n/g, '\r\n'), target('forge', 'split')).notebooks.map((nb) => nb.json)
  assert.equal(first.length, 2)
  assert.deepEqual(again, first)
  assert.deepEqual(crlf, first)
  assert.ok(first.every((json) => !json.includes('\r')))
})

test('分路线的关卡生成两本：不写 route 的单元两本都有，route=hip / route=triton 只进对应的一本', () => {
  const { hip, triton } = build(GOOD)
  assert.equal(hip.file, 'notebooks/forge/split/split-hip.ipynb')
  assert.equal(triton.file, 'notebooks/forge/split/split-triton.ipynb')
  assert.deepEqual(hip.notebook.metadata.hello_gpu, { route: 'hip', stage: 'forge-split' })
  assert.deepEqual(triton.notebook.metadata.hello_gpu, { route: 'triton', stage: 'forge-split' })
  const hipCode = codeCells(hip)
  const tritonCode = codeCells(triton)
  assert.ok(hipCode.includes('x = 1') && tritonCode.includes('x = 1'))
  assert.ok(hipCode.some((c) => c.startsWith('%%hip add --entry add\n__global__ void add(')))
  assert.ok(!hipCode.includes('y = 2'))
  assert.ok(tritonCode.includes('y = 2'))
  assert.ok(!tritonCode.some((c) => c.includes('%%hip')))
})

test('共用的关卡只生成一本 <slug>.ipynb；写了 route 的单元报错', () => {
  const { shared } = build(SHARED, 'forge', 'shared')
  assert.equal(shared.file, 'notebooks/forge/shared/shared.ipynb')
  assert.deepEqual(shared.notebook.metadata.hello_gpu, { route: 'shared', stage: 'forge-shared' })

  const wrong = buildNotebooks(GOOD, target('forge', 'shared'))
  assert.deepEqual(wrong.notebooks, [])
  assert.deepEqual(wrong.errors.map((e) => e.line), [lineOf(GOOD, 'hip route=hip'), lineOf(GOOD, 'python route=triton')])
  assert.match(wrong.errors[0].message, /route=hip/)
})

test('lab:header 展开成标题（关卡、路线、配套网页、时长、硬件）和加载 hello_gpu 的单元，有 %%hip 单元的版本才注册 %%hip', () => {
  const { hip, triton } = build(GOOD)
  const head = cells(hip)[0].text
  assert.match(head, /^# 2-2 分路线（实验室）\n/)
  assert.ok(head.includes(`[2-2 分路线](${SITE}/forge/split/)`))
  for (const part of ['HIP 路线', '约 30 分钟', '需要真卡：云 GPU', '(split-triton.ipynb)']) assert.ok(head.includes(part), part)
  assert.ok(cells(triton)[0].text.includes('(split-hip.ipynb)'))
  assert.equal(codeCells(hip)[0], `${BOOTSTRAP}\n${LOAD_HIP}`)
  assert.equal(codeCells(triton)[0], BOOTSTRAP)
  assert.equal(codeCells(build(SHARED, 'forge', 'shared').shared)[0], BOOTSTRAP)
})

test('lab:submit 展开成交成绩的说明和 hg.submit(关卡 id, 路线, checks=checks, metrics=metrics)', () => {
  const { hip, triton } = build(GOOD)
  assert.equal(codeCells(hip).at(-1), 'hg.submit("forge-split", "hip", checks=checks, metrics=metrics)')
  assert.equal(codeCells(triton).at(-1), 'hg.submit("forge-split", "triton", checks=checks, metrics=metrics)')
  const submitText = cells(hip).at(-2)
  assert.equal(submitText.type, 'markdown')
  assert.match(submitText.text, /^## 交成绩\n/)
  assert.ok(submitText.text.includes(`${SITE}/forge/split/`))

  const row = build(GOOD, 'dungeon', 'row')
  assert.equal(row.hip.file, 'notebooks/dungeon/row/row-hip.ipynb')
  assert.equal(codeCells(row.triton).at(-1), 'hg.submit("dungeon-row", "triton", checks=checks, metrics=metrics)')
  assert.ok(cells(row.hip)[0].text.includes(`[行求和](${SITE}/dungeon/row/)`))
})

test('Markdown 在二级标题、代码单元处切开；别的语言的围栏和 HTML 注释里的内容原样留在 Markdown 里', () => {
  const extra = [
    '### 小标题不切开', '',
    `${F}text`, '## 围栏里的不是标题', '<!-- lab:submit -->', `${F}python`, F, '',
    '<!--', `${F}python`, 'commented_out = True', F, '-->', '',
  ].join('\n')
  const text = GOOD.replace('两条路线共用的说明。', `两条路线共用的说明。\n\n${extra}`)
  const { hip } = build(text)
  const play = cells(hip).find((c) => c.text.startsWith('## 动手'))
  assert.ok(play.text.includes('### 小标题不切开'))
  assert.ok(play.text.includes('## 围栏里的不是标题\n<!-- lab:submit -->'))
  assert.ok(play.text.includes('commented_out = True'))
  assert.ok(!codeCells(hip).some((c) => c.includes('commented_out')))
  assert.equal(codeCells(hip).filter((c) => c.startsWith('hg.submit(')).length, 1)
  assert.deepEqual(cells(hip).filter((c) => c.type === 'markdown').map((c) => c.text.split('\n')[0]).filter((l) => l.startsWith('## ')),
    ['## 准备', '## 动手', '## 挑战', '## 交成绩'])
})

test('%%hip 那一行：默认按第一个 __global__ void 函数写 <名字> --entry <名字>，围栏里写了参数就照抄', () => {
  const magic = (fence, body) => parseSource(`${F}${fence}\n${body}\n${F}\n`)
  assert.equal(magic('hip route=hip', '__global__ void __launch_bounds__(256) scale(const float* a, float* out, int n) {}').blocks[0].magic,
    '%%hip scale --entry scale')
  assert.equal(magic('hip route=hip vector_add --entry kernel', '__global__ void kernel(const float* a) {}').blocks[0].magic,
    '%%hip vector_add --entry kernel')
  const missing = magic('hip route=hip', '__device__ float twice(float x) { return 2 * x; }')
  assert.equal(missing.errors.length, 1)
  assert.equal(missing.errors[0].line, 1)
})

test('写错的源文件报出出错的行号，不生成 Notebook', () => {
  const unclosed = GOOD.replace(`metrics = {"median_ms": 1.0}\n${F}`, 'metrics = {"median_ms": 1.0}')
  const twice = GOOD.replace('## 交成绩', '<!-- lab:header -->\n\n## 交成绩')
  const cases = [
    // [情形, 源文件, 报错的行号]
    ['代码围栏没闭合', unclosed, lineOf(unclosed, 'checks = {') - 1],
    ['不认识的标记', GOOD.replace('lab:submit', 'lab:submitt'), lineOf(GOOD, 'lab:submit')],
    ['route 写错', GOOD.replace('python route=triton', 'python route=cuda'), lineOf(GOOD, 'python route=triton')],
    ['不认识的设置', GOOD.replace('python route=triton', 'python rout=triton'), lineOf(GOOD, 'python route=triton')],
    ['python 围栏多写了东西', GOOD.replace('python route=triton', 'python route=triton numbered'), lineOf(GOOD, 'python route=triton')],
    ['HIP 单元只进 Triton 版', GOOD.replace('hip route=hip', 'hip route=triton'), lineOf(GOOD, 'hip route=hip')],
    ['空的代码单元', GOOD.replace('x = 1', ''), lineOf(GOOD, 'x = 1') - 1],
    ['标题标记写了两次', twice, lineOf(twice, '## 交成绩') - 2],
  ]
  for (const [name, text, line] of cases) {
    const { notebooks, errors } = buildNotebooks(text, target('forge', 'split'))
    assert.deepEqual(notebooks, [], name)
    assert.deepEqual(errors.map((e) => e.line), [line], `${name}：${JSON.stringify(errors)}`)
  }
})

test('源文件要对应大纲里的真卡关卡或真卡副本，文件名就是 slug', () => {
  assert.match(resolveTarget(outline, 'forge', 'nope').error, /slug 为 nope/)
  assert.match(resolveTarget(outline, 'novice', 'demo').error, /gpu: false/)
  assert.match(resolveTarget(outline, 'sandbox', 'demo').error, /没有 sandbox 这个区域/)
  assert.match(resolveTarget(outline, 'dungeon', 'sim').error, /env: sim/)
  assert.match(resolveTarget(outline, 'dungeon', 'nope').error, /slug 为 nope/)
  // 副本的路线跟所在的区域，没有时长。
  assert.deepEqual(
    (({ id, routes, page, minutes, env }) => ({ id, routes, page, minutes, env }))(target('dungeon', 'row')),
    { id: 'dungeon-row', routes: 'split', page: '/dungeon/row/', minutes: null, env: '云 GPU' },
  )
})

// ── 检查 ───────────────────────────────────────────────────────────────────

const SPLIT_SOURCE = { file: 'notebooks/src/forge/split.md', dir: 'forge', slug: 'split', text: GOOD }

/** 把一份源文件现在生成的结果当作仓库里的 Notebook。 */
function onDisk(source = SPLIT_SOURCE) {
  return buildSource(source, outline).notebooks.map(({ file, json }) => ({ file, text: json }))
}

const messages = (result) => result.errors.map((e) => `${e.file}${e.line ? `:${e.line}` : ''} ${e.message}`)

test('生成结果和源文件一致时检查通过；没生成、不是最新、多出来的 Notebook 都报出来', () => {
  const notebooks = onDisk()
  assert.deepEqual(messages(checkNotebooks({ outline, sources: [SPLIT_SOURCE], notebooks })), [])

  const [hip, triton] = notebooks
  const missing = checkNotebooks({ outline, sources: [SPLIT_SOURCE], notebooks: [hip] })
  assert.deepEqual(missing.errors.map((e) => [e.file, /还没有生成/.test(e.message)]), [[triton.file, true]])

  const stale = checkNotebooks({ outline, sources: [SPLIT_SOURCE], notebooks: [hip, { ...triton, text: triton.text.replace('y = 2', 'y = 3') }] })
  assert.deepEqual(stale.errors.map((e) => [e.file, /不是最新的/.test(e.message)]), [[triton.file, true]])

  // 路线从 split 改成 shared 以后留下的旧文件：metadata 指向的关卡在，但没有源文件生成它。
  const leftover = { file: 'notebooks/forge/split/split.ipynb', text: triton.text }
  const extra = checkNotebooks({ outline, sources: [SPLIT_SOURCE], notebooks: [...notebooks, leftover] })
  assert.deepEqual(extra.errors.map((e) => [e.file, /没有源文件/.test(e.message)]), [[leftover.file, true]])
})

test('上线（draft / ready）的真卡关卡和副本要有源文件，planned 的还没写，不查', () => {
  assert.deepEqual(messages(checkNotebooks({ outline })), [])
  const published = {
    ...outline,
    stages: outline.stages.map((s) => (s.id === 'forge-shared' ? { ...s, status: 'draft' } : s)),
    exercises: outline.exercises.map((g) => ({ ...g, items: g.items.map((e) => ({ ...e, status: 'ready' })) })),
  }
  assert.deepEqual(checkNotebooks({ outline: published }).errors.map((e) => e.file), ['notebooks/src/forge/shared.md', 'notebooks/src/dungeon/row.md'])
})

test('Notebook 的 metadata 要指向大纲里的真卡关卡，路线要和关卡的路线设置一致', () => {
  const [hip, triton] = onDisk()
  const unknown = { ...hip, text: hip.text.replace('"stage": "forge-split"', '"stage": "forge-nope"') }
  const result = checkNotebooks({ outline, sources: [SPLIT_SOURCE], notebooks: [unknown, triton] })
  assert.ok(result.errors.some((e) => e.file === hip.file && /forge-nope/.test(e.message)), messages(result).join('\n'))

  const wrongRoute = { ...hip, text: hip.text.replace('"route": "hip"', '"route": "shared"') }
  const routed = checkNotebooks({ outline, sources: [SPLIT_SOURCE], notebooks: [wrongRoute, triton] })
  assert.ok(routed.errors.some((e) => e.file === hip.file && /应该是 hip 或 triton/.test(e.message)), messages(routed).join('\n'))
})

test('分路线的两本 Notebook 小节标题不一致时报错', () => {
  const [hip, triton] = onDisk()
  const renamed = { ...triton, text: triton.text.replace('"## 挑战"', '"## 挑战一下"') }
  const result = checkNotebooks({ outline, sources: [SPLIT_SOURCE], notebooks: [hip, renamed] })
  const mismatch = result.errors.find((e) => /标题不一致/.test(e.message))
  assert.ok(mismatch, messages(result).join('\n'))
  assert.equal(mismatch.file, triton.file)
  assert.match(mismatch.message, /HIP 版是「## 挑战」，Triton 版是「## 挑战一下」/)
})

test('必备小节缺了、顺序错了，或者两个标记不在该在的地方，都要报；格式示例不查关卡和生成文件', () => {
  // 每个问题记成 [行号, 问题里的关键字]；0 表示整份文件的问题。
  const check = (text) => checkNotebooks({ outline, sources: [{ file: 'notebooks/src/forge/_demo.md', dir: 'forge', slug: '_demo', text }] })
    .errors.map((e) => [e.line, e.message])
  const expectOne = (text, line, pattern) => {
    const found = check(text)
    assert.equal(found.length, 1, JSON.stringify(found))
    assert.equal(found[0][0], line)
    assert.match(found[0][1], pattern)
  }
  assert.deepEqual(check(GOOD), [])
  assert.deepEqual(check(EXAMPLE), [])

  expectOne(GOOD.replace('## 挑战', '## 试试看'), 0, /缺少「## 挑战」/)
  // 「挑战」跑到了「动手」前面：报在「挑战」那一行。
  const swapped = GOOD.replace('## 动手', '## 临时').replace('## 挑战', '## 动手').replace('## 临时', '## 挑战')
  expectOne(swapped, lineOf(swapped, '## 挑战'), /「## 挑战」要排在「## 动手」后面/)
  const submitEarly = GOOD.replace('<!-- lab:submit -->', '').replace('## 挑战\n', '## 挑战\n\n<!-- lab:submit -->\n')
  expectOne(submitEarly, lineOf(submitEarly, 'lab:submit'), /交成绩/)
  const headerLate = GOOD.replace('<!-- lab:header -->', '').replace('## 动手', '<!-- lab:header -->\n\n## 动手')
  expectOne(headerLate, lineOf(headerLate, 'lab:header'), /第一个二级标题前面/)
  expectOne(GOOD.replace('<!-- lab:header -->', ''), 0, /缺少 <!-- lab:header -->/)
  expectOne(GOOD.replace('<!-- lab:submit -->', ''), 0, /缺少 <!-- lab:submit -->/)
})

test(`代码单元最多 ${MAX_CELL_LINES} 行，%%hip 单元连 %%hip 那一行一起算`, () => {
  const python = (n) => Array.from({ length: n }, (_, i) => `v${i} = ${i}`).join('\n')
  const hip = (n) => ['__global__ void add(const float* a, const float* b, float* out, int n) {', ...Array.from({ length: n - 2 }, () => '    ;'), '}'].join('\n')
  const lengths = (text) => checkNotebooks({ outline, sources: [{ file: 'notebooks/src/forge/_demo.md', dir: 'forge', slug: '_demo', text }] })
    .errors.map((e) => e.line)
  assert.deepEqual(lengths(GOOD.replace('x = 1', python(MAX_CELL_LINES))), [])
  assert.deepEqual(lengths(GOOD.replace('x = 1', python(MAX_CELL_LINES + 1))), [lineOf(GOOD, 'x = 1') - 1])
  const hipLine = lineOf(GOOD, 'hip route=hip')
  const hipBody = '__global__ void add(const float* a, const float* b, float* out, int n) {}'
  assert.deepEqual(lengths(GOOD.replace(hipBody, hip(MAX_CELL_LINES - 1))), [])
  assert.deepEqual(lengths(GOOD.replace(hipBody, hip(MAX_CELL_LINES))), [hipLine])
})

const PYTHON = process.env.PYTHON || 'python3'
const noPython = spawnSync(PYTHON, ['--version']).status !== 0

test('Python 语法错误报在源文件的行上，一个出错后照样查后面的单元；魔法行和 shell 行不算错', { skip: noPython && `没有 ${PYTHON}` }, () => {
  const cells = [
    { file: 'a.md', line: 10, text: '%run ../../common/bootstrap.py\n%load_ext hello_gpu\n!ls\nif True:\n    %time x = 1' },
    { file: 'a.md', line: 20, text: 'x = 1\ndef f(:\n    pass' },
    { file: 'b.md', line: 5, text: 'ok = True' },
    { file: 'b.md', line: 30, text: 'y = (1,' },
    { file: 'b.md', line: 40, text: 'print("最后一个也查到了")' },
  ]
  const result = pythonSyntaxErrors(cells, { python: PYTHON })
  assert.equal(result.checked, cells.length)
  assert.deepEqual(result.errors.map((e) => `${e.file}:${e.line}`), ['a.md:21', 'b.md:30'])
  assert.ok(result.errors.every((e) => /^Python 语法错误：\w*Error/.test(e.message)), JSON.stringify(result.errors))
})

test('没有 Python 时跳过语法检查并说明原因，不算失败', () => {
  const result = pythonSyntaxErrors([{ file: 'a.md', line: 1, text: 'def f(:' }], { python: 'hello-gpu-no-such-python' })
  assert.deepEqual(result.errors, [])
  assert.match(result.skipped, /没有找到 hello-gpu-no-such-python/)
})
