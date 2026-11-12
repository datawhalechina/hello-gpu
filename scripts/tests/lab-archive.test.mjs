import assert from 'node:assert/strict'
import test from 'node:test'
import outline from '../../docs/course/outline.json' with { type: 'json' }
import {
  chartModel, compareEntries, facetCounts, filterEntries, linearTicks, logTicks, median, parseEntryId, quantile,
} from '../../docs/course/labArchive.ts'
import {
  checkArchive, checkEvidenceRefs, checkLabArchive, checkSchema, evidenceCards, formatPath, loadArchive, validateSchema,
} from '../course/lab-data-check.mjs'
import { formatError } from '../course/stage-check.mjs'

/**
 * 实验档案馆（L-04）：条目格式（docs/lab/schema.json + 字段之间的规则）、EvidenceCard 的引用、浏览页的筛选和图表坐标。
 * 检查规则都拿仓库里的示例条目改一两处来喂，确认真的会报错，报的是读者看得懂的那一句。
 */

const archive = loadArchive()
const { schema } = archive
const EXAMPLE_ID = '_example/hip-fixture-2026-11-08'
const REAL_ID = 'forge-softmax/hip-fixture-2026-11-08'
const example = JSON.parse(archive.files.find((f) => f.file === `docs/lab/data/${EXAMPLE_ID}.json`).text)

/** 示例条目的一份拷贝，edit 改几处。 */
function variant(edit = () => {}) {
  const entry = structuredClone(example)
  edit(entry)
  return entry
}

/** 同一份数据当成真实记录（去掉 example），放在凭证那一关的目录里用。 */
function real(edit = () => {}) {
  return variant((entry) => {
    delete entry.example
    edit(entry)
  })
}

/** 用 checkArchive 查一组条目 { 条目 id: 内容 }，返回全部问题的文字。 */
function problems(entries) {
  const files = Object.entries(entries).map(([id, entry]) => ({
    file: `docs/lab/data/${id}.json`, text: typeof entry === 'string' ? entry : JSON.stringify(entry),
  }))
  return checkArchive({ schema, files }).errors.map((e) => e.message)
}

/** 只按 schema 查，返回「位置：问题」。 */
function shape(entry) {
  return validateSchema(schema, entry).map((e) => `${formatPath(e.path)}：${e.message}`)
}

function has(messages, text) {
  return messages.some((m) => m.includes(text))
}

function assertHas(messages, text) {
  assert.ok(has(messages, text), `应该有「${text}」，实际是：\n${messages.join('\n')}`)
}

// ── 仓库里的档案 ───────────────────────────────────────────────────────────

test('当前仓库的档案和引用它的页面全部通过检查，示例条目在里面', () => {
  const { errors, entries } = checkLabArchive()
  assert.deepEqual(errors.map(formatError), [])
  assert.ok(entries.some((e) => e.id === EXAMPLE_ID && e.entry.example === true))
})

test('当成真实记录放进凭证那一关的目录，同一份数据也能通过', () => {
  assert.deepEqual(problems({ [REAL_ID]: real() }), [])
})

// ── schema 和形状 ──────────────────────────────────────────────────────────

test('schema 自身：写了校验器不认识的关键字、引用不存在的定义都会报错', () => {
  assert.deepEqual(checkSchema(schema), [])
  const typo = structuredClone(schema)
  typo.properties.date.format = 'date'
  assertHas(checkSchema(typo), '不认识的关键字 format')
  const dangling = structuredClone(schema)
  dangling.properties.collector.$ref = '#/$defs/nothing'
  assertHas(checkSchema(dangling), '$ref "#/$defs/nothing" 找不到')
  // schema 有问题时不再查条目，只报 schema
  assert.deepEqual(checkArchive({ schema: typo, files: [{ file: `docs/lab/data/${EXAMPLE_ID}.json`, text: '{}' }] }).errors.map((e) => e.file), ['docs/lab/schema.json'])
})

test('形状：缺字段、多余字段、类型、取值、写法和范围都报出位置', () => {
  assert.deepEqual(shape(example), [])
  assertHas(shape(variant((e) => { delete e.collector })), '（顶层）：缺少 collector')
  assertHas(shape(variant((e) => { e.credentail = {} })), 'credentail：不认识的字段 credentail')
  assertHas(shape(variant((e) => { e.credential.route = 'cuda' })), 'credential.route：只能是 "hip"、"triton"、"shared" 之一，现在是 "cuda"')
  assertHas(shape(variant((e) => { e.date = '2026/11/08' })), 'date：格式不对："2026/11/08"，应该像 "2026-11-08"')
  assertHas(shape(variant((e) => { e.credential.metrics.GBps = 1 })), 'credential.metrics.GBps：名字 "GBps" 不合格')
  assertHas(shape(variant((e) => { e.credential.metrics.gbps = 0 })), 'credential.metrics.gbps：应该大于 0，现在是 0')
  assertHas(shape(variant((e) => { e.environment.device.cus = 9.5 })), 'environment.device.cus：应该是整数，现在是 9.5')
  assertHas(shape(variant((e) => { e.collector = '  ' })), 'collector：不能是空白')
  assertHas(shape(variant((e) => { e.samples[1].ms[3] = '0.45' })), 'samples[1].ms[3]：应该是数，现在是 文字 "0.45"')
})

test('输出按 kind 区分三种写法：报的是写了的那一种的错', () => {
  assertHas(shape(variant((e) => { delete e.cells[4].outputs[0].rows })), 'cells[4].outputs[0]：缺少 rows')
  const wrongKind = shape(variant((e) => { e.cells[0].outputs[0].kind = 'image' }))
  assert.deepEqual(wrongKind, ['cells[0].outputs[0].kind：只能是 "text"、"table"、"chart" 之一，现在是 "image"'])
})

test('档案目录里只放 <关卡 id>/<文件>.json，JSON 写坏了说清楚', () => {
  const misplaced = checkArchive({ schema, files: [{ file: 'docs/lab/data/README.md', text: '说明' }] }).errors.map((e) => e.message)
  assertHas(misplaced, '档案目录里只放档案条目')
  assertHas(problems({ [REAL_ID]: '{ "version": 1, ' }), '不是合法的 JSON')
})

// ── 字段之间 ───────────────────────────────────────────────────────────────

test('示例只放在 _example/，真实记录放在凭证那一关的目录里', () => {
  assertHas(problems({ [EXAMPLE_ID]: real() }), '要写 "example": true')
  assertHas(problems({ [REAL_ID]: example }), '只能放在 _example/ 里')
  assertHas(problems({ 'forge-roofline/hip-fixture-2026-11-08': real() }), '放在 forge-roofline/ 下，凭证却是 forge-softmax 的')
})

test('文件名里的路线、设备、日期和凭证对得上', () => {
  assertHas(problems({ 'forge-softmax/softmax-run1': real() }), '文件名要写成 <路线>-<设备>-<日期>.json')
  assertHas(problems({ 'forge-softmax/triton-fixture-2026-11-08': real() }), '文件名里的路线是 triton，凭证的 route 是 hip')
  assertHas(problems({ 'forge-softmax/hip-fixture-2026-11-09': real() }), '文件名里的日期是 2026-11-09，date 写的是 2026-11-08')
  const late = problems({ 'forge-softmax/hip-fixture-2026-11-09': real((e) => { e.date = '2026-11-09' }) })
  assertHas(late, 'date 是 2026-11-09，凭证生成于 2026-11-08T10:00:00Z')
  // hardware.json 登记过的卡，文件名里用它的 id
  const rx = (e) => { e.credential.device.name = 'AMD Radeon RX 9070 XT'; e.environment.device.name = 'AMD Radeon RX 9070 XT' }
  assertHas(problems({ [REAL_ID]: real(rx) }), 'AMD Radeon RX 9070 XT 在 docs/course/hardware.json 里登记为 rx-9070-xt')
  assert.deepEqual(problems({ 'forge-softmax/hip-rx-9070-xt-2026-11-08': real(rx) }), [])
})

test('凭证过得了 LabCard 导入时的检查，关卡有实验室，路线和大纲一致', () => {
  assertHas(problems({ [REAL_ID]: real((e) => { e.credential.checks.passed = 6 }) }), '凭证过不了 LabCard 导入时的检查：校验结果 checks')
  const plain = outline.stages.find((s) => !s.gpu).id
  const noLab = problems({ [`${plain}/hip-fixture-2026-11-08`]: real((e) => { e.credential.stage = plain }) })
  assertHas(noLab, `凭证的 stage 是 ${plain}，它不是 outline.json 里的真卡关卡`)
  const shared = problems({ 'forge-softmax/shared-fixture-2026-11-08': real((e) => { e.credential.route = 'shared' }) })
  assertHas(shared, '2-9 Softmax分 HIP、Triton 两条路线，route 应该是 hip 或 triton，现在是 shared')
})

test('环境里的设备和软件版本和凭证一致，平台登记过', () => {
  assertHas(problems({ [REAL_ID]: real((e) => { e.environment.device.cus = 12 }) }), 'environment.device.cus 是 12，凭证里是 10')
  assertHas(problems({ [REAL_ID]: real((e) => { e.environment.software.torch = '9.9.9' }) }), 'environment.software.torch 是 "9.9.9"')
  assertHas(problems({ [REAL_ID]: real((e) => { e.environment.platform = 'my-laptop' }) }), 'lab-platforms.json 里没有这个平台')
})

test('原始样本：个数等于计时次数，测量数据里的耗时是样本算出来的', () => {
  assertHas(problems({ [REAL_ID]: real((e) => { e.samples[0].ms.pop() }) }), '计时 30 次，ms 却有 29 个')
  assertHas(problems({ [REAL_ID]: real((e) => { e.credential.metrics.median_ms = 0.3 }) }), '测量数据的 median_ms 是 0.3，和哪一组样本的中位数都对不上')
  assertHas(problems({ [REAL_ID]: real((e) => { e.credential.metrics.p90_ms = 0.4 }) }), '测量数据的 p90_ms 是 0.4，mine 那组样本算出来是 0.368')
  assertHas(problems({ [REAL_ID]: real((e) => { e.credential.metrics.torch_ms = 0.5 }) }), '测量数据的 torch_ms 是 0.5，torch 那组样本的中位数是 0.45035')
  assertHas(problems({ [REAL_ID]: real((e) => { e.samples = [] }) }), '测量数据里有 median_ms，但没有原始样本')
  assertHas(problems({ [REAL_ID]: real((e) => { e.samples[1].label = 'mine' }) }), '实现名 mine 重复了')
})

test('Notebook 单元：按小节顺序排，表格和图表的行列对得上，对数轴只放正数', () => {
  const swapped = real((e) => { [e.cells[0], e.cells[5]] = [e.cells[5], e.cells[0]] })
  assertHas(problems({ [REAL_ID]: swapped }), '单元按 Notebook 的顺序排（准备 → 动手 → 挑战 → 交成绩 → 练习）')
  assertHas(problems({ [REAL_ID]: real((e) => { e.cells[4].outputs[0].rows[0].pop() }) }), 'cells[4].outputs[0]：表格第 1 行有 6 格，表头有 7 列')
  assertHas(problems({ [REAL_ID]: real((e) => { e.cells[2].outputs[0].series[0].values.pop() }) }), 'cells[2].outputs[0]：线「mine」有 4 个值，横轴有 5 个')
  assertHas(problems({ [REAL_ID]: real((e) => { e.cells[2].outputs[0].x.values = ['a', 'b', 'c', 'd', 'e'] }) }), '折线图（line）的横轴要是数')
  assertHas(problems({ [REAL_ID]: real((e) => { e.cells[2].outputs[0].x.values[0] = 0 }) }), '横轴是对数刻度，值都要是正数')
  assertHas(problems({ [REAL_ID]: real((e) => { e.cells[1] = { section: '动手', outputs: [] } }) }), 'cells[1] 既没有代码也没有输出')
})

test('同一张卡在文件名里只有一种写法，一种写法只对应一张卡', () => {
  const twoSlugs = problems({ [REAL_ID]: real(), 'forge-softmax/triton-fixture-gpu-2026-11-08': real((e) => { e.credential.route = 'triton' }) })
  assertHas(twoSlugs, '「Fixture GPU（伪造数据）」在别的条目里写成 fixture，这里写成 fixture-gpu')
  const other = (e) => { e.credential.route = 'triton'; e.credential.device.name = 'Other GPU'; e.environment.device.name = 'Other GPU' }
  const twoCards = problems({ [REAL_ID]: real(), 'forge-softmax/triton-fixture-2026-11-08': real(other) })
  assertHas(twoCards, '文件名里的设备 fixture 在别的条目里是「Fixture GPU（伪造数据）」，这里是「Other GPU」')
})

// ── trace（hg.trace() 存的 JSON）──────────────────────────────────────────

const TRACE_ID = '_example/shared-fixture-2026-11-11'
const REAL_TRACE_ID = 'forge-behind-pytorch/shared-fixture-2026-11-11'
const traced = JSON.parse(archive.files.find((f) => f.file === `docs/lab/data/${TRACE_ID}.json`).text)

/** 带 trace 的示例条目（2-5）当成真实记录，edit 改几处。 */
function realTraced(edit = () => {}) {
  const entry = structuredClone(traced)
  delete entry.example
  edit(entry)
  return entry
}

/** 改第一份 trace 的第一行（mlp：matmul、里层的 mm、add、gelu 四个算子，三次启动，三个 kernel），返回全部问题。 */
function lineProblems(edit) {
  return problems({ [REAL_TRACE_ID]: realTraced((e) => edit(e.traces[0].lines[0])) })
}

test('trace 的形状：三组事件各有各的字段，GPU 上的事件只有三种，序号是非负整数或 null', () => {
  assert.deepEqual(shape(traced), [])
  assert.deepEqual(problems({ [REAL_TRACE_ID]: realTraced() }), [])
  const at = 'traces[0].lines[0]'
  assertHas(shape(realTraced((e) => { e.traces[0].lines[0].gpu[0].kind = 'sync' })), `${at}.gpu[0].kind：只能是 "kernel"、"memcpy"、"memset" 之一`)
  assertHas(shape(realTraced((e) => { e.traces[0].lines[0].ops[1].parent = -1 })), `${at}.ops[1].parent：应该 ≥ 0，现在是 -1`)
  assertHas(shape(realTraced((e) => { delete e.traces[0].lines[0].gpu_us })), `${at}：缺少 gpu_us`)
  assertHas(shape(realTraced((e) => { e.traces[0].lines[0].launches[0].kernel = 0 })), `${at}.launches[0].kernel：不认识的字段 kernel`)
})

test('trace 和凭证来自同一次运行：同一张卡、同一套软件，测量数据算得出来', () => {
  assertHas(problems({ [REAL_TRACE_ID]: realTraced((e) => { e.traces[1].device.cus = 12 }) }), 'traces[1].device.cus 是 12，凭证里是 10')
  assertHas(problems({ [REAL_TRACE_ID]: realTraced((e) => { e.traces[0].env.torch = '9.9.9' }) }), 'traces[0].env.torch 是 "9.9.9"')
  const metric = problems({ [REAL_TRACE_ID]: realTraced((e) => { e.credential.metrics.mine_gpu_ms = 0.3 }) })
  assertHas(metric, '测量数据和 traces 里 mine 那一行对不上（mine_gpu_ms 是 0.3，算出来是 0.262')
  const kernels = problems({ [REAL_TRACE_ID]: realTraced((e) => { e.credential.metrics.steps_kernels = 7 }) })
  assertHas(kernels, 'steps_kernels 是 7，算出来是 8')
  const twice = problems({ [REAL_TRACE_ID]: realTraced((e) => { e.traces[1].lines[1].name = 'steps' }) })
  assertHas(twice, 'traces[1].lines[1]（steps）：行名重复了')
})

test('trace 里的一行：按开始时间排，序号指得到，上层算子在前，时间加得起来', () => {
  const where = 'traces[0].lines[0]（mlp）：'
  assertHas(lineProblems((l) => { l.gpu.reverse() }), `${where}gpu[1] 比前一个开始得早`)
  assertHas(lineProblems((l) => { l.ops[1].parent = 2 }), `${where}ops[1] 的上层算子是 ops[2]：上层算子要排在它前面`)
  assertHas(lineProblems((l) => { l.launches[0].op = 4 }), `${where}launches[0] 的 op 是 4，ops 只有 4 个`)
  assertHas(lineProblems((l) => { l.gpu[0].launch = 9 }), `${where}gpu[0] 的 launch 是 9，launches 只有 3 个`)
  assertHas(lineProblems((l) => { l.gpu[1].stream = 2 }), `${where}gpu[1] 在队列 2 上，前面只出现过 1 条`)
  assertHas(lineProblems((l) => { l.gpu_us += 5 }), `${where}gpu_us 是 3219，gpu 里各段合起来是 3214 µs`)
  assertHas(lineProblems((l) => { l.span_us -= 1 }), `${where}gpu[2] 到 3225.76 µs 才结束，晚于从开始到算完的 3224.76 µs`)
  assertHas(lineProblems((l) => { l.span_us += 10 }), `${where}span_us 是 3235.76，CPU 交完（cpu_us）和 GPU 算完里晚的那个是 3225.76`)
})

// ── EvidenceCard 的引用 ───────────────────────────────────────────────────

test('找 EvidenceCard：标签可以跨行、用单引号；代码块和注释里的不算', () => {
  const text = [
    '---', 'title: 示例', '---', '',
    '<EvidenceCard kind="measured" hardware="A GPU"',
    "  date='2026-11-08' entry=\"forge-softmax/hip-a-2026-11-08\">正文</EvidenceCard>",
    '', '```md', '<EvidenceCard kind="measured" entry="in-code/x">', '```',
    '<!-- <EvidenceCard kind="measured" entry="in-comment/x"> -->',
    '<EvidenceCard kind="simulated" />',
  ].join('\n')
  assert.deepEqual(evidenceCards(text), [
    { line: 5, attrs: { kind: 'measured', hardware: 'A GPU', date: '2026-11-08', entry: 'forge-softmax/hip-a-2026-11-08' } },
    { line: 12, attrs: { kind: 'simulated' } },
  ])
})

test('EvidenceCard：条目要在档案里，硬件和日期照条目写，正式页面不能引用示例', () => {
  const result = checkArchive(archive)
  const refs = (file, attrs) => checkEvidenceRefs({ pages: [{ file, text: `<EvidenceCard ${attrs}>说明</EvidenceCard>\n` }], archive: result })
    .errors.map((e) => e.message)
  const good = `hardware="Fixture GPU（伪造数据）" date="2026-11-08" entry="${EXAMPLE_ID}"`
  assert.deepEqual(refs('docs/preview/kit/index.md', `kind="measured" ${good}`), [])
  assertHas(refs('docs/forge/softmax/index.md', `kind="mixed" ${good}`), `EvidenceCard 引用的 ${EXAMPLE_ID} 是示例条目`)
  assertHas(refs('docs/preview/kit/index.md', 'kind="measured" entry="forge-softmax/hip-x-2026-01-01"'), '在实验档案馆里找不到：应该有 docs/lab/data/forge-softmax/hip-x-2026-01-01.json')
  assertHas(refs('docs/preview/kit/index.md', `kind="measured" hardware="AMD Radeon RX 9070 XT" entry="${EXAMPLE_ID}"`), 'hardware="AMD Radeon RX 9070 XT"，档案条目 _example/hip-fixture-2026-11-08 的设备是「Fixture GPU（伪造数据）」')
  assertHas(refs('docs/preview/kit/index.md', `kind="measured" date="2026-11-09" entry="${EXAMPLE_ID}"`), 'date="2026-11-09"，档案条目 _example/hip-fixture-2026-11-08 的日期是 2026-11-08')
  // 模拟数据不链档案条目，不查
  assert.deepEqual(refs('docs/forge/softmax/index.md', 'kind="simulated" entry="nothing/here"'), [])
})

// ── 浏览页用的纯函数 ───────────────────────────────────────────────────────

test('条目 id 拆成目录、路线、设备和日期', () => {
  assert.deepEqual(parseEntryId('forge-softmax/hip-rx-9070-xt-2026-11-08'), { dir: 'forge-softmax', route: 'hip', device: 'rx-9070-xt', date: '2026-11-08' })
  assert.deepEqual(parseEntryId('_example/shared-fixture-2026-11-09'), { dir: '_example', route: 'shared', device: 'fixture', date: '2026-11-09' })
  for (const bad of ['forge-softmax/cuda-a-2026-11-08', 'forge-softmax/hip-2026-11-08', 'a/b/hip-x-2026-11-08', 'hip-x-2026-11-08', 'forge-softmax/hip-X-2026-11-08']) {
    assert.equal(parseEntryId(bad), null, bad)
  }
})

test('中位数和分位数的算法同 hello_gpu（statistics.median、线性插值）', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(quantile([5, 1, 4, 2, 3], 0.1), 1.4)
  assert.ok(Math.abs(quantile([5, 1, 4, 2, 3], 0.9) - 4.6) < 1e-12)
})

test('筛选：每一项的条数按另外两项筛完再数', () => {
  const rows = [
    { id: 'a', zone: 'forge', stage: 'forge-softmax', device: 'x' },
    { id: 'b', zone: 'forge', stage: 'forge-norm', device: 'y' },
    { id: 'c', zone: 'trial', stage: 'trial-attention', device: 'x' },
  ]
  const filters = { zone: 'forge', stage: '', device: 'x' }
  assert.deepEqual(filterEntries(rows, filters).map((r) => r.id), ['a'])
  assert.deepEqual([...facetCounts(rows, filters, 'zone')], [['forge', 1], ['trial', 1]])
  assert.deepEqual([...facetCounts(rows, filters, 'device')], [['x', 1], ['y', 1]])
  assert.deepEqual([...facetCounts(rows, filters, 'stage')], [['forge-softmax', 1]])
})

test('同一关里的顺序：真实记录在前、示例在后，新的在前', () => {
  const entry = (id, at, example = false) => ({ id, at, example, route: 'hip', device: 'x' })
  const sorted = [entry('old', '2026-01-01T00:00:00Z'), entry('demo', '2026-12-01T00:00:00Z', true), entry('new', '2026-06-01T00:00:00Z')]
    .sort(compareEntries).map((e) => e.id)
  assert.deepEqual(sorted, ['new', 'old', 'demo'])
})

test('图表坐标：点落在绘图区里，空着的点把折线断开，对数轴按数量级等距', () => {
  const line = { kind: 'chart', chart: 'line', x: { label: 'n', values: [1, 2, 3, 4] }, y: { label: 't' }, series: [{ name: 'a', values: [1, null, 3, 4] }] }
  const model = chartModel(line, 400, 200)
  const [drawn] = model.lines
  assert.equal(drawn.points.length, 3)
  assert.equal(drawn.path.match(/M/g).length, 2)
  for (const p of drawn.points) {
    assert.ok(p.x >= model.plot.left && p.x <= model.plot.right && p.y >= model.plot.top && p.y <= model.plot.bottom, JSON.stringify(p))
  }
  const log = chartModel({ ...line, x: { label: 'n', scale: 'log', values: [1, 10, 100] }, series: [{ name: 'a', values: [1, 2, 3] }] }, 400, 200)
  const xs = log.lines[0].points.map((p) => p.x)
  assert.ok(Math.abs((xs[1] - xs[0]) - (xs[2] - xs[1])) < 1e-9)
  // 柱子从同一条 0 线往上长，高度和值成正比
  const bar = chartModel({ kind: 'chart', chart: 'bar', x: { label: 'k', values: ['a', 'b'] }, y: { label: 'v' }, series: [{ name: 's', values: [1, 2] }] }, 300, 200)
  assert.ok(Math.abs(bar.bars[1].height - 2 * bar.bars[0].height) < 1e-9)
  assert.ok(Math.abs((bar.bars[0].y + bar.bars[0].height) - (bar.bars[1].y + bar.bars[1].height)) < 1e-9)
})

test('刻度：线性的步长取 1、2、2.5、5 乘 10 的幂并盖住数据，对数的取 10 的整数次幂', () => {
  assert.deepEqual(linearTicks(0.3643, 0.3791), [0.36, 0.365, 0.37, 0.375, 0.38])
  assert.deepEqual(linearTicks(1, 30), [0, 10, 20, 30])
  assert.deepEqual(logTicks(0.0571, 40), [0.01, 0.1, 1, 10, 100])
  assert.deepEqual(logTicks(2, 8), [1, 2, 5, 10])
})
