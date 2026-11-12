import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  GELU_OUTPUT, GELU_STEPS, KERNEL_COUNTS, MAX_IMPORT_CHARS, STEPS_N, appendTraces, archiveTraceSet, busyText, fusePlan, gpuRows,
  gpuWait, laneItems, lineSummary, mergeTraces, nearestItem, parseTraceJson, passTotals, pickLine, sampleTraceSet, shareText,
  shortKernel, slowestIndex, stepItem, storedTraces, timeTicks, timeWindow, topOp, usText,
} from '../../docs/forge/behind-pytorch/trace.ts'
import { loadArchive, validateSchema } from '../course/lab-data-check.mjs'

/**
 * 2-5 一行 PyTorch 背后：trace 浏览器的读法（同 hello_gpu 的 hg.trace）、读者导入的 trace、示意数据、探索三的读写遍数。
 * 和 Notebook 对数用的是 FG-LAB-05 的示例条目：它的 trace 和打印的输出都是 hg.trace 写的。
 */

const FIXTURE_ID = '_example/shared-fixture-2026-11-11'
const fixtureText = readFileSync(new URL(`../../docs/lab/data/${FIXTURE_ID}.json`, import.meta.url), 'utf8')
const fixture = JSON.parse(fixtureText)
const { schema } = loadArchive()
const lineOf = (name) => fixture.traces.flatMap((t) => t.lines).find((l) => l.name === name)
/** 示例条目里 hg.trace 打印的输出（两个 hg.trace 单元）。 */
const printed = fixture.cells.flatMap((c) => c.outputs).filter((o) => o.kind === 'text').map((o) => o.text).join('\n')

/** 一份 trace（同 hg.trace 存的 JSON）：拿示例条目的第一份改。 */
function traceVariant(edit = () => {}) {
  const trace = structuredClone(fixture.traces[0])
  edit(trace)
  return trace
}

const parseError = (value) => {
  const parsed = parseTraceJson(typeof value === 'string' ? value : JSON.stringify(value))
  assert.equal(parsed.ok, false, '应该收不下')
  return parsed.error
}

// ── 读法（同 lab.py 的 _short_kernel、_top_op、_print_line）──────────────────

test('kernel 名字的缩写同 lab.py：去掉 void、模板参数、参数表、命名空间，太长的截断', () => {
  assert.equal(shortKernel('void at::native::vectorized_elementwise_kernel<4, at::native::add<float>, std::array<char*, 2ul> >(int, …)'), 'vectorized_elementwise_kernel')
  assert.equal(shortKernel('void at::native::(anonymous namespace)::softmax_warp_forward<float, float, 8>(float*, float const*, int)'), 'softmax_warp_forward')
  assert.equal(shortKernel('Cijk_Alik_Bljk_SB_MT128x128x16_fixture'), 'Cijk_Alik_Bljk_SB_MT128x128x16_fixture', '没有命名空间和参数表的原样')
  assert.equal(shortKernel('Memcpy DtoD (Device -> Device)'), 'Memcpy DtoD', '拷贝、填充的名字到括号为止')
  const long = `${'k'.repeat(50)}(int)`
  assert.equal(shortKernel(long), `${'k'.repeat(39)}…`, '超过 40 个字截断，带省略号一共 40 个')
  assert.equal(shortKernel('void <lambda>()'), 'void <lambda>()', '去完什么也不剩时用原来的名字')
})

test('「哪个算子启动的」往上找到这一行直接调用的那个：aten::mm 算在 aten::matmul 上', () => {
  const mlp = lineOf('mlp')
  assert.equal(mlp.ops[mlp.gpu[0].op].name, 'aten::mm')
  assert.equal(topOp(mlp, mlp.gpu[0].op), 0)
  assert.equal(gpuRows(mlp)[0].op, 'aten::matmul')
  assert.equal(topOp(mlp, null), null)
  const orphan = structuredClone(mlp)
  orphan.gpu[1].op = null
  assert.equal(gpuRows(orphan)[1].op, '—', '找不到算子写 —，同 lab.py')
})

test('汇总、最耗时和占 GPU 时间和 Notebook 打印的对得上（示例条目是 hg.trace 写的）', () => {
  for (const line of fixture.traces.flatMap((t) => t.lines)) {
    const s = lineSummary(line)
    assert.ok(
      printed.includes(`这一行从开始到算完 ${usText(s.spanUs)}，GPU 忙的时间占 ${busyText(s.busy)}；CPU 交完这一行用了 ${usText(s.cpuUs)}`),
      `${line.name} 的汇总和打印的不一样`,
    )
    assert.ok(printed.includes(`${line.name}：启动了 ${s.kernels} 个 kernel，GPU 忙了 ${usText(s.gpuUs)}`), `${line.name} 的 kernel 数`)
    const i = slowestIndex(line)
    const row = gpuRows(line)[i]
    assert.ok(printed.includes(`最耗时的是第 ${i + 1} 个：${row.op} 启动的 ${row.kernel}，占 GPU 时间的 ${shareText(row.share)}`), `${line.name} 的最耗时`)
  }
  // 一样长时取前面那个（steps_small 的 8 个都是 2.04 µs）
  assert.equal(slowestIndex(lineOf('steps_small')), 0)
  assert.equal(slowestIndex({ ...lineOf('mlp'), gpu: [] }), null)
})

test('排队还是空等：CPU 交出去时前面的活还没做完是排队；GPU 先空下来是空等，第一个从这一行开始算', () => {
  const mlp = lineOf('mlp')
  const first = gpuWait(mlp, 0)
  assert.equal(first.kind, 'waited')
  assert.equal(first.freeAt, 0)
  assert.equal(first.idleUs, mlp.gpu[0].start)
  const second = gpuWait(mlp, 1)
  assert.equal(second.kind, 'queued', '数据大：add 交出去时矩阵乘还在算')
  assert.equal(second.freeAt, mlp.gpu[0].start + mlp.gpu[0].dur)
  assert.ok(Math.abs(second.queueUs - (mlp.gpu[1].start - (mlp.launches[1].start + mlp.launches[1].dur))) < 1e-9)
  const small = lineOf('steps_small')
  for (let i = 1; i < small.gpu.length; i++) assert.equal(gpuWait(small, i).kind, 'waited', `数据小：第 ${i + 1} 个 kernel 时 GPU 在空等`)
  const lost = structuredClone(mlp)
  lost.gpu[2].launch = null
  assert.equal(gpuWait(lost, 2).kind, 'unknown')
  assert.equal(gpuWait(lost, 2).queueUs, null)
})

test('另一条队列上的活不算「前面的活」', () => {
  const line = structuredClone(lineOf('mlp'))
  line.gpu[1].stream = 1
  assert.equal(gpuWait(line, 1).freeAt, 0)
  assert.equal(gpuWait(line, 2).freeAt, line.gpu[0].start + line.gpu[0].dur, '第三个和第一个在同一条队列上')
})

// ── 时间线 ─────────────────────────────────────────────────────────────────

test('时间线：算子那条道只画顶层算子，启动和 GPU 跟着顶层算子分组，同 lab.py 的配色', () => {
  const mlp = lineOf('mlp')
  const items = laneItems(mlp)
  assert.deepEqual(items.filter((i) => i.lane === 'op').map((i) => mlp.ops[i.index].name), ['aten::matmul', 'aten::add', 'aten::gelu'])
  assert.deepEqual(items.filter((i) => i.lane === 'gpu').map((i) => i.group), [0, 1, 2], 'kernel 和启动它的算子同组')
  assert.deepEqual(items.filter((i) => i.lane === 'launch').map((i) => i.group), [0, 1, 2])
})

test('时间轴：整行到从开始到算完，CPU 那段到 CPU 交完；GPU 上早一点的事件也画得进来；刻度都在两头之间', () => {
  const mlp = lineOf('mlp')
  assert.deepEqual(timeWindow(mlp, 'all'), { from: 0, to: mlp.span_us })
  assert.deepEqual(timeWindow(mlp, 'cpu'), { from: 0, to: mlp.cpu_us })
  const early = structuredClone(mlp)
  early.gpu[0].start = -0.5
  assert.equal(timeWindow(early, 'all').from, -0.5)
  for (const mode of ['all', 'cpu']) {
    const win = timeWindow(mlp, mode)
    const ticks = timeTicks(win, 4)
    assert.ok(ticks.length >= 2, `${mode}：至少两个刻度`)
    assert.ok(ticks.every((t) => t >= win.from && t <= win.to), `${mode}：刻度出了两头`)
  }
})

test('在图上点一下：落在段里就是它，旁边一点也算，太远不算', () => {
  const items = laneItems(lineOf('mlp'))
  const gpu = items.filter((i) => i.lane === 'gpu')
  assert.equal(nearestItem(items, 'gpu', gpu[1].start + 1, 0).index, 1)
  assert.equal(nearestItem(items, 'gpu', gpu[2].start + gpu[2].dur + 3, 5).index, 2)
  assert.equal(nearestItem(items, 'gpu', gpu[2].start + gpu[2].dur + 30, 5), null)
  assert.equal(nearestItem(items, 'op', gpu[2].start, 5), null, '只在点的那条道上找')
})

test('键盘在时间线上走：没选时先到第一个 kernel；左右在同一条道上走到头就停；上下换道时先找同一个算子的那段', () => {
  const items = laneItems(lineOf('mlp'))
  const at = (lane, index) => ({ lane, index })
  const pick = (from, move) => {
    const item = stepItem(items, from, move)
    return item && `${item.lane}${item.index}`
  }
  assert.equal(pick(null, 'next'), 'gpu0')
  assert.equal(pick(null, 'last'), 'gpu2')
  assert.equal(pick(at('gpu', 0), 'next'), 'gpu1')
  assert.equal(pick(at('gpu', 2), 'next'), 'gpu2', '走到头停在原地')
  assert.equal(pick(at('gpu', 1), 'first'), 'gpu0')
  // add 的 kernel 在 GPU 上 2.9 ms 才开始，时间上离它最近的是最后一次启动；同组优先，找到的是 add 自己那次
  assert.equal(pick(at('gpu', 1), 'up'), 'launch1')
  assert.equal(pick(at('launch', 1), 'up'), 'op2', '再往上是 aten::add（ops 里的序号 2）')
  assert.equal(pick(at('op', 2), 'up'), 'op2', '最上面一条道再往上不动')
  assert.equal(pick(at('op', 0), 'down'), 'launch0')
  assert.equal(stepItem([], null, 'next'), null)
  const cpuOnly = items.filter((i) => i.lane !== 'gpu')
  assert.equal(stepItem(cpuOnly, null, 'next').lane, 'op', '没有 GPU 事件时从最上面一条有段的道开始')
})

// ── 浏览器读哪份 trace ──────────────────────────────────────────────────────

test('几份 trace 合在一起：同名的行留后记的那次，位置按第一次出现；记录时间早的排前面', () => {
  const [first, second] = fixture.traces
  const later = structuredClone(first)
  later.at = '2026-11-11T09:00:00Z'
  later.lines[0].span_us += 1
  const merged = mergeTraces([later, first, second])
  assert.deepEqual(merged.map((l) => l.line.name), ['mlp', 'steps', 'mine', 'steps_small', 'mine_small'])
  assert.equal(merged[0].line.span_us, later.lines[0].span_us)
  assert.equal(merged[0].at, later.at)
})

test('一个浏览器先看哪一行：prefer 里第一个有的，都没有看第一行', () => {
  const set = { source: 'mine', entry: null, lines: mergeTraces(fixture.traces) }
  assert.equal(pickLine(set, ['mlp_small', 'mlp']).line.name, 'mlp')
  assert.equal(pickLine(set, ['nothing']).line.name, 'mlp')
  assert.equal(pickLine({ ...set, lines: [] }, ['mlp']), null)
})

test('档案馆的参考 trace：示例条目不算；真实记录里挑新的、带 trace 的', () => {
  const asReal = (at, edit = () => {}) => {
    const entry = structuredClone(fixture)
    delete entry.example
    entry.credential.at = at
    edit(entry)
    return entry
  }
  assert.equal(archiveTraceSet([{ id: FIXTURE_ID, entry: fixture }]), null)
  const older = { id: 'forge-behind-pytorch/shared-fixture-2026-11-10', entry: asReal('2026-11-10T08:00:00Z') }
  const newer = { id: 'forge-behind-pytorch/shared-fixture-2026-11-11', entry: asReal('2026-11-11T08:00:00Z') }
  const bare = { id: 'forge-behind-pytorch/shared-fixture-2026-11-12', entry: asReal('2026-11-12T08:00:00Z', (e) => delete e.traces) }
  const other = { id: 'forge-softmax/shared-fixture-2026-11-13', entry: asReal('2026-11-13T08:00:00Z', (e) => { e.credential.stage = 'forge-softmax' }) }
  const set = archiveTraceSet([older, bare, other, newer])
  assert.equal(set.source, 'archive')
  assert.equal(set.entry, newer.id)
  assert.deepEqual(set.lines.map((l) => l.line.name), ['mlp', 'steps', 'mine', 'steps_small', 'mine_small'])
})

// ── 读者导入的 trace ───────────────────────────────────────────────────────

test('导入：hg.trace 存的一份 trace 和档案条目都收，只留格式里的字段', () => {
  const single = parseTraceJson(JSON.stringify(fixture.traces[1]))
  assert.equal(single.ok, true)
  assert.deepEqual(single.traces, [fixture.traces[1]])
  const entry = parseTraceJson(fixtureText)
  assert.equal(entry.ok, true)
  assert.equal(entry.traces.length, fixture.traces.length)
  const extra = parseTraceJson(JSON.stringify(traceVariant((t) => {
    t.note = '多出来的'
    t.lines[0].gpu[0].extra = 1
  })))
  assert.deepEqual(extra.traces[0], fixture.traces[0], '多出来的字段不收')
})

test('导入：不是 JSON、不是 trace、版本不对、太大，各说各的原因', () => {
  const json = parseError('{ "v": 1, "lines": [')
  assert.equal(json.kind, 'json')
  assert.ok(json.raw, '解析器的原文留着，页面放进折叠块')
  assert.equal(parseError('[1, 2]').kind, 'shape')
  const credential = parseError(fixture.credential)
  assert.equal(credential.kind, 'shape')
  assert.match(credential.message, /通关凭证/)
  assert.equal(parseError({ hello: 'world' }).kind, 'shape')
  const version = parseError(traceVariant((t) => { t.v = 2 }))
  assert.equal(version.kind, 'version')
  assert.match(version.message, /^v 是 2/, '最外层的字段只写字段名')
  assert.equal(parseError(' '.repeat(MAX_IMPORT_CHARS + 1)).kind, 'size')
  assert.equal(parseError({ ...structuredClone(fixture), traces: [] }).kind, 'empty')
  assert.equal(parseError(traceVariant((t) => { t.lines = [] })).kind, 'empty')
})

test('导入：字段不对时说清是哪一项，序号要指得到，行名不能重复', () => {
  const cases = [
    [(t) => { t.lines[0].gpu[0].op = 9 }, /^lines\[0\]\.gpu\[0\]\.op 是 9，ops 只有 4 个/],
    [(t) => { t.lines[0].gpu[0].launch = -1 }, /^lines\[0\]\.gpu\[0\]\.launch 是 -1/],
    [(t) => { t.lines[0].ops[1].parent = 1 }, /^lines\[0\]\.ops\[1\]\.parent 是 1，上层算子要排在它前面/],
    [(t) => { t.lines[0].gpu[0].kind = 'marker' }, /^lines\[0\]\.gpu\[0\]\.kind 要是 kernel、memcpy 或 memset/],
    [(t) => { t.lines[0].gpu[0].dur = -1 }, /^lines\[0\]\.gpu\[0\]\.dur 要是不小于 0 的数/],
    [(t) => { t.lines[0].span_us = 'long' }, /^lines\[0\]\.span_us 要是不小于 0 的数/],
    [(t) => { t.lines[0].runs = 0 }, /^lines\[0\]\.runs 要是不小于 1 的整数/],
    [(t) => { t.device.cus = 0 }, /^device\.cus 要是不小于 1 的整数/],
    [(t) => { t.env.torch = 2 }, /^env\.torch 要是版本号或 null/],
    [(t) => { delete t.at }, /^at 要是一段文字/],
    [(t) => { t.lines.push(structuredClone(t.lines[0])) }, /有两行都叫 "mlp"/],
  ]
  for (const [edit, message] of cases) {
    const error = parseError(traceVariant(edit))
    assert.equal(error.kind, 'field', String(message))
    assert.match(error.message, message)
  }
  const nested = parseError({ ...structuredClone(fixture), traces: [fixture.traces[0], traceVariant((t) => { t.lines[0].ops[0].name = '' })] })
  assert.match(nested.message, /^traces\[1\]\.lines\[0\]\.ops\[0\]\.name 要是一段文字/, '档案条目里的 trace 带上它在 traces 里的位置')
})

test('存进草稿槽的 trace 刷新后再查一遍：好的原样读回，坏了就不要', () => {
  assert.deepEqual(storedTraces({ traces: fixture.traces }), fixture.traces)
  assert.equal(storedTraces({ traces: [traceVariant((t) => { t.lines[0].gpu[0].op = 99 })] }), null)
  assert.equal(storedTraces({ traces: [] }), null)
  assert.equal(storedTraces(null), null)
  assert.equal(storedTraces('坏了'), null)
})

test('接着导入：新的接在后面，同一份导入两次只留一份', () => {
  const [a, b] = fixture.traces
  assert.deepEqual(appendTraces([a], [b]), [a, b])
  assert.deepEqual(appendTraces([a, b], [structuredClone(a)]), [a, b])
  const again = structuredClone(a)
  again.at = '2026-11-12T00:00:00Z'
  assert.equal(appendTraces([a], [again]).length, 2, '记录时间不同就是另一份')
})

// ── 示意数据 ────────────────────────────────────────────────────────────────

test('示意数据过得了档案馆的 trace 格式，也过得了导入时的检查', () => {
  const set = sampleTraceSet()
  assert.equal(set.source, 'sample')
  const trace = { v: 1, at: '2026-11-11T00:00:00Z', device: set.lines[0].device, env: { rocm: null, torch: null, triton: null }, lines: set.lines.map((l) => l.line) }
  assert.deepEqual(validateSchema({ $defs: schema.$defs, $ref: '#/$defs/trace' }, trace), [])
  assert.equal(parseTraceJson(JSON.stringify(trace)).ok, true)
  for (const { line } of set.lines) {
    for (const group of ['ops', 'launches', 'gpu']) {
      line[group].forEach((e, i) => {
        if (i) assert.ok(e.start >= line[group][i - 1].start, `${line.name}.${group} 按开始时间排`)
        assert.ok(e.start + e.dur <= line.span_us + 1e-9, `${line.name}.${group}[${i}] 在从开始到算完之内`)
      })
    }
    const ends = Math.max(line.cpu_us, ...line.gpu.map((e) => e.start + e.dur))
    assert.ok(Math.abs(ends - line.span_us) < 1e-6, `${line.name}：span_us 是 CPU 交完和 GPU 算完里晚的那个`)
    assert.ok(Math.abs(line.gpu.reduce((s, e) => s + e.dur, 0) - line.gpu_us) < 1e-6, `${line.name}：一条队列上不重叠，gpu_us 是各段之和`)
  }
})

test('示意数据讲得通正文的话：数据大时 GPU 一直忙、矩阵乘最耗时；数据小时 GPU 大半在等；分步的耗时跟着读写遍数', () => {
  const lines = Object.fromEntries(sampleTraceSet().lines.map((l) => [l.line.name, l.line]))
  assert.deepEqual(Object.keys(lines), ['mlp', 'mlp_small', 'steps', 'steps_small'])
  assert.ok(lineSummary(lines.mlp).busy > 0.9)
  assert.ok(lineSummary(lines.steps).busy > 0.9)
  assert.ok(lineSummary(lines.mlp_small).busy < 0.5)
  assert.ok(lineSummary(lines.steps_small).busy < 0.5)
  assert.equal(gpuRows(lines.mlp)[slowestIndex(lines.mlp)].op, 'aten::matmul')
  // 和 hg.trace 记下的分步写法同样 8 个算子、同样的先后（示例条目里的 steps）
  assert.deepEqual(lines.steps.ops.map((o) => o.name), lineOf('steps').ops.map((o) => o.name))
  assert.deepEqual(GELU_STEPS.map((s) => s.op), lineOf('steps').ops.map((o) => o.name))
  const unit = lines.steps.gpu[0].dur / (GELU_STEPS[0].reads.length + 1)
  lines.steps.gpu.forEach((e, i) => {
    assert.ok(Math.abs(e.dur - unit * (GELU_STEPS[i].reads.length + 1)) < 0.01, `第 ${i + 1} 步的耗时和它读写的遍数成比例`)
  })
})

// ── 探索三：读写遍数 ────────────────────────────────────────────────────────

test('分步写法读 10 遍、写 8 遍（同 Notebook），一个 kernel 各 1 遍；合得越多，遍数越少', () => {
  assert.deepEqual(passTotals(fusePlan(8)), { reads: 10, writes: 8, passes: 18 })
  assert.deepEqual(passTotals(fusePlan(1)), { reads: 1, writes: 1, passes: 2 })
  assert.deepEqual(fusePlan(1)[0], { steps: [0, 1, 2, 3, 4, 5, 6, 7], reads: ['x'], writes: [GELU_OUTPUT] })
  const passes = KERNEL_COUNTS.map((k) => passTotals(fusePlan(k)).passes)
  passes.slice(1).forEach((p, i) => assert.ok(p < passes[i], `${KERNEL_COUNTS[i + 1]} 个 kernel 比 ${KERNEL_COUNTS[i]} 个搬得少`))
  assert.equal(STEPS_N, 2 ** 26, 'Notebook 的 big')
})

test('合成几个 kernel 时：外面来的数组每个只读一遍，后面还要用的中间结果才写回显存', () => {
  const [first, second] = fusePlan(2)
  assert.deepEqual(first, { steps: [0, 1, 2, 3], reads: ['x'], writes: ['a', 'd'] }, 'x 在第一个 kernel 里用了三次，只读一遍；a、d 后面要用')
  assert.deepEqual(second, { steps: [4, 5, 6, 7], reads: ['d', 'a'], writes: ['y'] })
  for (const k of KERNEL_COUNTS) {
    const plan = fusePlan(k)
    assert.deepEqual(plan.flatMap((p) => p.steps), [0, 1, 2, 3, 4, 5, 6, 7], `${k} 个 kernel 按顺序做完 8 步`)
    assert.ok(plan.at(-1).writes.includes(GELU_OUTPUT), '最后的结果一定写回去')
  }
  assert.throws(() => fusePlan(3), /分不成 3 个/)
})
