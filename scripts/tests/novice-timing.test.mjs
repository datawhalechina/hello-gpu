import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { analyzeMemory } from '../../docs/sim/memory.ts'
import { estimateTime } from '../../docs/sim/timing.ts'
import { SIM_PARAMS } from '../../docs/sim/params.ts'
import { VECTOR_ADD, requestOf } from '../../docs/course/agent/tasks.ts'
import { createSyncEnv } from '../../docs/course/agent/tools.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import * as reduction from '../../docs/novice/reduction/challenge.ts'
import {
  ADD_CALL, ADD_CARS, ADD_CYCLES, ADD_KERNELS, ADD_STRIDES, ADD_TOTAL_BYTES, AGENT_ORDER, AGENT_TIMERS, BANDWIDTH_CAP,
  BYTE_COUNTS, DEFAULT_AGENT_TIMER, DEFAULT_BENCH, DEFAULT_BYTE_COUNT, FIRST_LAUNCH_CYCLES, LAUNCH_CYCLES, REPORTS, STAR_LABELS,
  SUM_CALL, SUM_COUNTS, SUM_KERNELS, SUM_LAUNCH, SUM_N, SUM_TOTAL_BYTES, SYNC_CALL, TRUSTED_ADD_READINGS, TRUSTED_REPORT,
  agentRun, agentSideDone, bandwidthOf, bandwidthText, codeRows, countedBandwidth, countedBytes, fakeBandwidth, judge,
  normalizeBench, readingsOf, reportLine, runBench, runSession, speedupText, syncText, timingCode, warmupText,
} from '../../docs/novice/timing/challenge.ts'

/**
 * 1-11 测一测有多快。计时台：启动只交出工作单（异步），程序里第一次启动先做一次准备；手算的小例子当标准答案。
 * 两版在 GPU 上的周期数取 L4，拿模拟器把两种写法都跑一遍核对。三份报告：甲没同步、乙没预热、丙可信。
 * 带宽：只数该读写的字节；模拟器里停表前同步，算出来的超不过上限。挑战：同步 ★1、再加预热 ★2、再数对字节 ★3，
 * 每颗星成立和不成立；两种写法的计时代码一行对一行，照着代码走一遍计时台，量到的数一样。支线：Agent 只信计时工具。
 */

const LANGS = ['hip', 'python']
const PLANS = [false, true].flatMap((warmup) => [false, true].map((sync) => ({ warmup, sync })))

/** 跑一次模拟器，交回 L4 的示意周期数和 L3 的车数。 */
function simulate(request) {
  const result = run(request)
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return { cycles: estimateTime(result.events).cycles, cars: analyzeMemory(result.events).summary.transactions, result }
}

// ── 两版在 GPU 上的周期数（L4）──────────────────────────────────────────────

test('向量加法四种步长的周期数和车数，就是 L4、L3 照 A-01 的工作单数出来的；两种写法一样，结果都对', () => {
  for (const stride of VECTOR_ADD.strides) {
    const [hip, python] = LANGS.map((lang) => simulate(requestOf(VECTOR_ADD, { block: 32, stride }, lang)))
    assert.equal(hip.cycles, ADD_CYCLES[stride], `步长 ${stride}`)
    assert.equal(python.cycles, hip.cycles)
    assert.equal(hip.cars, ADD_CARS[stride])
    assert.equal(python.cars, hip.cars)
    assert.deepEqual(hip.result.arrays.c.slice(0, VECTOR_ADD.n), Array.from({ length: VECTOR_ADD.n }, (_, k) => 11 * (k + 1)))
  }
  // 改前步长 4、改后步长 1；控制台的「计时」给 Agent 的也是这个数
  assert.deepEqual(ADD_KERNELS.map((k) => k.cycles), ADD_STRIDES.map((s) => ADD_CYCLES[s]))
  const env = createSyncEnv(VECTOR_ADD, run)
  for (const stride of ADD_STRIDES) {
    assert.equal(env.act({ tool: 'measure', args: { block: 32, stride } }).data.cycles, ADD_CYCLES[stride])
  }
})

test('求和两版的周期数，就是 L4 照 1-10 挑战的初始写法、三星写法数出来的；两种写法一样，out[0] 都对', () => {
  assert.equal(SUM_N, reduction.SUM_N)
  assert.deepEqual({ ...SUM_LAUNCH }, { ...reduction.SUM_LAUNCH })
  const versions = [
    {},
    { stop: reduction.BEST_STOP, merge: { hip: reduction.MERGES.oneAtomic.hip, python: reduction.MERGES.oneAtomic.python } },
  ]
  versions.forEach((values, v) => {
    const [hip, python] = LANGS.map((lang) => {
      const fill = { ...values, merge: values.merge?.[lang] ?? undefined }
      if (!fill.merge) delete fill.merge
      const code = fillTemplate(parseTemplate(reduction.SUM_CODE[lang]), fill).source
      return simulate(buildRequest(code, lang, reduction.SUM_LAUNCH, reduction.SUM_ARGS))
    })
    assert.equal(hip.cycles, SUM_KERNELS[v].cycles, SUM_KERNELS[v].label)
    assert.equal(python.cycles, hip.cycles)
    assert.deepEqual(hip.result.arrays.out, [reduction.SUM_TOTAL])
  })
  assert.equal(SUM_TOTAL_BYTES, SUM_N * 4 + 4)
})

// ── 计时台：手算的标准例 ────────────────────────────────────────────────────

test('计时台：一份 100 个周期的工作单，四种写法量到的数都能手算', () => {
  const K = 100
  const got = Object.fromEntries(PLANS.map((p) => [`${p.warmup ? '预热' : '不预热'}/${p.sync ? '同步' : '不同步'}`, readingsOf(p, [{ cycles: K }])[0]]))
  assert.deepEqual(got, {
    '不预热/不同步': FIRST_LAUNCH_CYCLES + LAUNCH_CYCLES, // 第一次启动那一行慢，可还是没等 GPU
    '不预热/同步': FIRST_LAUNCH_CYCLES + LAUNCH_CYCLES + K,
    '预热/不同步': LAUNCH_CYCLES, // 只量到交出工作单
    '预热/同步': LAUNCH_CYCLES + K,
  })
  assert.deepEqual([LAUNCH_CYCLES, FIRST_LAUNCH_CYCLES], [SIM_PARAMS.launchCycles, SIM_PARAMS.firstLaunchCycles])
})

test('计时台：启动是异步的，CPU 交完工作单就往下走；GPU 一份做完才做下一份，同步要等交出去的都做完', () => {
  const s = runSession({ warmup: true, sync: false }, ADD_KERNELS)
  const runs = s.segments.filter((x) => x.kind === 'run')
  // 预热、计时各一份，按交来的先后一份接一份，不重叠
  assert.equal(runs.length, 4)
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i].from >= runs[i - 1].to)
  // 改前那次计时：表停在交出工作单的那一刻，GPU 这时才开工
  const [r0] = s.readings
  const timed0 = runs.find((x) => x.kernel === 0 && !x.warmup)
  assert.equal(r0.t1, timed0.from)
  assert.ok(timed0.to > r0.t1)
  // 改后那次预热的同步，连改前那份没量到的活一起等完
  const wait = s.segments.find((x) => x.kind === 'wait' && x.kernel === 1 && x.warmup)
  assert.equal(wait.to, runs.find((x) => x.kernel === 1 && x.warmup).to)
  assert.ok(wait.from < timed0.to)
  // 第一次的准备只做一次，落在最先启动的那一行上
  assert.deepEqual(s.segments.filter((x) => x.kind === 'setup').map((x) => [x.lane, x.from, x.to, x.warmup]), [['cpu', 0, FIRST_LAUNCH_CYCLES, true]])
  assert.equal(s.end, runs.at(-1).to)
})

// ── 热身和探索一、二：三份报告 ──────────────────────────────────────────────

test('三份报告：甲没同步一点没快，乙没预热快了 7.9 倍，丙可信、快了 2.9 倍', () => {
  assert.deepEqual(REPORTS.map(reportLine), [
    '甲：改前 20、改后 20 个周期，一点没快',
    '乙：改前 4700、改后 596 个周期，快了 7.9 倍',
    '丙：改前 1700、改后 596 个周期，快了 2.9 倍',
  ])
  // 只有丙量到的两个数都只比 GPU 真正算的多交出工作单那一下
  const close = REPORTS.map((r) => readingsOf(r.plan, ADD_KERNELS).every((c, i) => c === ADD_KERNELS[i].cycles + LAUNCH_CYCLES))
  assert.deepEqual(close, [false, false, true])
  assert.equal(TRUSTED_REPORT, 2)
  // 丙算出来的倍数和 GPU 真正的倍数一样（一位小数）
  assert.equal(speedupText(...TRUSTED_ADD_READINGS), speedupText(ADD_KERNELS[0].cycles, ADD_KERNELS[1].cycles))
})

test('探索一、二的那一句跟着计时台：没同步两版都是 20；没预热改前多出第一次的准备；都做了是 1700 和 596', () => {
  assert.match(syncText(false), /两版都只量到 20 个周期/)
  assert.match(syncText(false), /还要算 1680 个周期/)
  assert.match(syncText(true), /改前 1700、改后 596 个周期/)
  assert.match(syncText(true), /快了 2\.9 倍/)
  assert.match(warmupText(false), /改前量到 4700 个周期/)
  assert.match(warmupText(false), new RegExp(`多出 ${FIRST_LAUNCH_CYCLES}`))
  assert.match(warmupText(false), /快了 7\.9 倍/)
  assert.match(warmupText(true), /改前 1700、改后 596 个周期，快了 2\.9 倍/)
})

test('倍数和带宽写成一位小数，100 以上写整数；一样快、变慢都写得出来', () => {
  assert.equal(speedupText(20, 20), '一点没快')
  assert.equal(speedupText(1700, 596), '快了 2.9 倍')
  assert.equal(speedupText(3020, 20), '快了 151 倍')
  assert.equal(speedupText(300, 600), '慢了 2.0 倍')
})

// ── 探索三：有效带宽 ────────────────────────────────────────────────────────

test('探索三：a、b、c 都数是 12000 字节；改后的有效带宽是改前的 2.9 倍，和快了几倍一样', () => {
  assert.equal(DEFAULT_BYTE_COUNT, 'c')
  assert.deepEqual(BYTE_COUNTS.map((c) => countedBytes(c.value, 1)), [4000, 8000, ADD_TOTAL_BYTES, ADD_CARS[1] * SIM_PARAMS.lineBytes])
  assert.equal(ADD_TOTAL_BYTES, 3 * VECTOR_ADD.n * 4)
  const [before, after] = [0, 1].map((v) => countedBandwidth('abc', v))
  assert.equal((after / before).toFixed(1), (TRUSTED_ADD_READINGS[0] / TRUSTED_ADD_READINGS[1]).toFixed(1))
  assert.match(bandwidthText('abc'), /改后 20\.1、改前 7\.1 字节\/周期/)
})

test('探索三：按搬的车数，改前多搬的车也算进去，「带宽」反倒比改后高', () => {
  assert.ok(countedBandwidth('cars', 0) > countedBandwidth('cars', 1))
  assert.match(bandwidthText('cars'), /改前 28\.9 反倒比改后的 20\.6 高/)
  assert.match(bandwidthText('cars'), /288 车/)
})

test('上限：模拟器里停表前同步，算出来的有效带宽超不过 32 字节/周期；没同步量到的 20 个周期一算就超了', () => {
  assert.equal(BANDWIDTH_CAP, SIM_PARAMS.lineBytes / SIM_PARAMS.lineCycles)
  for (const stride of VECTOR_ADD.strides) {
    assert.ok(bandwidthOf(ADD_TOTAL_BYTES, ADD_CYCLES[stride]) <= BANDWIDTH_CAP, `步长 ${stride}`)
    // 按车数算也超不过：搬一车就要 lineCycles 个周期
    assert.ok(bandwidthOf(ADD_CARS[stride] * SIM_PARAMS.lineBytes, ADD_CYCLES[stride]) <= BANDWIDTH_CAP)
  }
  for (const k of SUM_KERNELS) assert.ok(bandwidthOf(SUM_TOTAL_BYTES, k.cycles) <= BANDWIDTH_CAP)
  for (const plan of PLANS.filter((p) => p.sync)) {
    for (const [i, c] of readingsOf(plan, ADD_KERNELS).entries()) assert.ok(bandwidthOf(ADD_TOTAL_BYTES, c) <= BANDWIDTH_CAP, `${JSON.stringify(plan)} 第 ${i} 版`)
  }
  assert.deepEqual(fakeBandwidth(), { cycles: 20, bandwidth: 600, overCap: '18.8' })
})

// ── 挑战：量一量求和 ────────────────────────────────────────────────────────

const ALL_BENCH = PLANS.flatMap((p) => SUM_COUNTS.map((c) => ({ ...p, count: c.value })))
const stars = (plan) => judge(plan).earned.filter(Boolean).length

test('挑战：默认的计时代码（不预热、不同步、照搬 3 × n × 4）一颗星都没有，「现象 / 原因 / 怎么改」三样都写了', () => {
  assert.deepEqual(DEFAULT_BENCH, { warmup: false, sync: false, count: 'copy' })
  const v = judge(DEFAULT_BENCH)
  assert.deepEqual(v.earned, [false, false, false])
  for (const part of ['symptom', 'cause', 'fix']) assert.ok(v.error?.[part], part)
  assert.match(v.error.symptom, /改后只量到 20 个周期/)
})

test('挑战 ★1：只要没同步，不管预热和字节数，一颗星都没有；同步了就有 ★1', () => {
  for (const plan of ALL_BENCH) {
    const v = judge(plan)
    assert.equal(v.earned[0], plan.sync, JSON.stringify(plan))
    if (!plan.sync) assert.deepEqual(v.earned, [false, false, false])
  }
})

test('挑战 ★2：同步了没预热只有一颗星，改前多算了第一次的准备，「快了 9.7 倍」不可信', () => {
  for (const count of SUM_COUNTS.map((c) => c.value)) {
    const v = judge({ warmup: false, sync: true, count })
    assert.deepEqual(v.earned, [true, false, false])
    assert.match(v.next, /改前量到 3596 个周期/)
    assert.match(v.next, /「快了 9\.7 倍」不可信/)
  }
  assert.deepEqual(runBench({ warmup: false, sync: true, count: 'readWrite' }).readings, [3596, 372])
})

test('挑战 ★3：预热、同步之后，字节数写 n × 4 + 4 才有三颗星；照搬向量加法、只数 out 都是两颗', () => {
  assert.equal(stars({ warmup: true, sync: true, count: 'readWrite' }), 3)
  // 字节数写错时，下一步写出求和该读写的字节数
  for (const count of ['copy', 'out']) assert.match(judge({ warmup: true, sync: true, count }).next, new RegExp(`= ${SUM_TOTAL_BYTES} 字节`))
  for (const count of ['copy', 'out']) assert.equal(stars({ warmup: true, sync: true, count }), 2)
  // 三颗星只有一种写法
  assert.deepEqual(ALL_BENCH.filter((p) => stars(p) === 3), [{ warmup: true, sync: true, count: 'readWrite' }])
  const best = runBench({ warmup: true, sync: true, count: 'readWrite' })
  assert.deepEqual(best.readings, [596, 372])
  assert.equal(best.speedup, '快了 1.6 倍')
  assert.equal(best.bytes, SUM_TOTAL_BYTES)
  assert.match(judge({ warmup: true, sync: true, count: 'readWrite' }).next, /516 ÷ 372 ≈ 1\.4 字节\/周期/)
  assert.equal(STAR_LABELS.length, 3)
})

test('挑战：草稿槽里读出来的计时代码被改坏了，用默认值补上', () => {
  assert.deepEqual(normalizeBench(null), DEFAULT_BENCH)
  assert.deepEqual(normalizeBench({ warmup: 'yes', sync: true, count: 'everything' }), { warmup: false, sync: true, count: 'copy' })
  assert.deepEqual(normalizeBench({ warmup: true, sync: true, count: 'readWrite', extra: 1 }), { warmup: true, sync: true, count: 'readWrite' })
})

// ── 两种写法的计时代码 ──────────────────────────────────────────────────────

/** 把一段计时代码照字面读回来：预热没有（看表之前启动过）、停表前同步没有（启动之后、再看表之前同步过）。 */
function planOf(code, lang, call) {
  const ops = code.split('\n').map((line) => line.replace(lang === 'hip' ? /\s*\/\/.*$/ : /\s*#.*$/, '').trim()).filter(Boolean).map((line) => {
    if (line === call[lang]) return 'launch'
    if (line === SYNC_CALL[lang]) return 'sync'
    if (/\bt0 = now\(\)/.test(line)) return 't0'
    if (/\bt1 = now\(\)/.test(line)) return 't1'
    return 'other'
  })
  const t0 = ops.indexOf('t0')
  const t1 = ops.indexOf('t1')
  const timed = ops.indexOf('launch', t0)
  assert.ok(t0 >= 0 && timed > t0 && t1 > timed, code)
  return {
    warmup: ops.slice(0, t0).includes('launch') && ops.slice(0, t0).includes('sync'),
    sync: ops.slice(timed, t1).includes('sync'),
  }
}

test('两种写法：计时代码一行对一行，旋钮管的行一样；照着代码读回来的写法就是旋钮的写法', () => {
  for (const plan of PLANS) {
    for (const [call, bytes] of [[ADD_CALL, undefined], [SUM_CALL, 'n * 4 + 4']]) {
      const [hip, python] = LANGS.map((lang) => codeRows(plan, call, lang, bytes))
      assert.deepEqual(python.map((r) => [r.knob, r.note]), hip.map((r) => [r.knob, r.note]))
      for (const lang of LANGS) assert.deepEqual(planOf(timingCode(plan, call, lang, bytes), lang, call), plan, `${lang} ${JSON.stringify(plan)}`)
    }
  }
})

test('两种写法都能拿三颗星：三星的计时代码两种写法都有预热、停表前同步和 n × 4 + 4，照着走一遍计时台量到的一样', () => {
  const best = { warmup: true, sync: true, count: 'readWrite' }
  const expr = SUM_COUNTS.find((c) => c.value === best.count).expr
  const [hip, python] = LANGS.map((lang) => timingCode(best, SUM_CALL, lang, expr))
  assert.match(hip, /double bytes = n \* 4 \+ 4;/)
  assert.match(python, /nbytes = n \* 4 \+ 4/)
  const readings = LANGS.map((lang, i) => readingsOf(planOf([hip, python][i], lang, SUM_CALL), SUM_KERNELS))
  assert.deepEqual(readings[1], readings[0])
  assert.deepEqual(judge({ ...planOf(python, 'python', SUM_CALL), count: best.count }).earned, [true, true, true])
  assert.deepEqual(judge({ ...planOf(hip, 'hip', SUM_CALL), count: best.count }).earned, [true, true, true])
})

// ── 支线：Agent 只信计时工具 ────────────────────────────────────────────────

test('支线：没同步就看表，四组都量到 20，Agent 分不出快慢，交了起点步长 4，一颗星', () => {
  assert.deepEqual(AGENT_ORDER, [4, 1, 2, 8])
  assert.equal(DEFAULT_AGENT_TIMER, 'noSync')
  const r = agentRun('noSync')
  assert.deepEqual(r.rows.map((x) => x.reading), [20, 20, 20, 20])
  assert.equal(r.pick, 4)
  assert.deepEqual(r.earned, [true, false, false])
  assert.equal(agentSideDone(r), false)
})

test('支线：没预热也挑对了步长 1，可起点那一次多算了第一次的准备；预热、同步才算支线完成', () => {
  const lazy = agentRun('noWarmup')
  assert.equal(lazy.pick, 1)
  assert.equal(lazy.rows[0].reading, FIRST_LAUNCH_CYCLES + LAUNCH_CYCLES + ADD_CYCLES[4])
  assert.match(lazy.note, /快了 7\.9 倍/)
  assert.equal(agentSideDone(lazy), false)
  const good = agentRun('trusted')
  assert.equal(good.pick, 1)
  assert.deepEqual(good.rows.map((x) => x.reading - x.truth), [LAUNCH_CYCLES, LAUNCH_CYCLES, LAUNCH_CYCLES, LAUNCH_CYCLES])
  assert.equal(agentSideDone(good), true)
})

test('支线：Agent 交的那组拿几颗星，和 A-01 控制台交卷的评分一样', () => {
  const env = createSyncEnv(VECTOR_ADD, run)
  for (const t of AGENT_TIMERS) {
    const r = agentRun(t.value)
    const verdict = env.act({ tool: 'finish', args: { block: 32, stride: r.pick } }).verdict
    assert.deepEqual(r.earned, verdict.earned, t.value)
  }
})
