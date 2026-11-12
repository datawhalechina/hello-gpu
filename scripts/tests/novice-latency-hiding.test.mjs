import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { missingErrorParts } from '../../docs/course/useChallenge.ts'
import * as coalescing from '../../docs/novice/coalescing/challenge.ts'
import {
  BEST_CYCLES, CYCLES_BY_VGPRS, CYCLES_BY_WAVES, DEFAULT_PLAN, EACH_OPTIONS, FETCH_WAIT, LANE_VGPRS, LDS_EXAMPLES,
  LINE_CYCLES, PART_CODE, PART_N, PART_TOTAL, REGISTER_WAVES, SLOTS, STEPS_PER_FETCH, STEP_CYCLES, TARGET_CYCLES,
  VGPR_OPTIONS, WAVE, WAVE_OPTIONS, evenPlan, judge, launchCode, launchOf, ldsSeats, normalizePlan, partArgs, schedule,
  seatsOf,
} from '../../docs/novice/latency-hiding/challenge.ts'

/**
 * 1-12 藏起等待。工作单是 1-8 挑战的三星写法 part_sum，2048 个数交给一条流水线。
 * 住得下几支：每个工位 1024 个寄存器（示意）按每个线程用的个数分，名额 16 个封顶；货架按每组用的 KB 分。
 * 时间线：同时住得下的小队一批一批住进来，每一批用 L4 的 latencyTimeline 排；手算的小例子当标准答案。
 * 探索一、二的周期数写成常数，这里拿模拟器把两种写法都跑一遍核对。挑战：120 种派法 × 两种写法，
 * 每颗星成立和不成立；★1 不成立时「现象 / 原因 / 怎么改」三样都写了。
 */

const LANGS = ['hip', 'python']
const ALL_PLANS = WAVE_OPTIONS.flatMap((waves) => EACH_OPTIONS.flatMap((each) => VGPR_OPTIONS.map((vgprs) => ({ waves, each, vgprs }))))

/** 跑一次模拟器：这种派法、这种写法。 */
function simulate(plan, lang) {
  const result = run(buildRequest(PART_CODE[lang], lang, launchOf(plan), partArgs(plan)))
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result
}

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行（同 1-8、1-10 的单测）。 */
const noLine = ({ line, ...rest }) => rest
const strip = (result) => ({ arrays: result.arrays, steps: result.steps, diagnostics: result.diagnostics.map(noLine), events: result.events.map(noLine) })

/** 两种写法各跑一次：事件流（除了行号）和结果一样，交回 HIP 那一次。 */
function both(plan) {
  const [hip, python] = LANGS.map((lang) => simulate(plan, lang))
  assert.deepEqual(strip(python), strip(hip), JSON.stringify(plan))
  return hip
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0)
const stars = (verdict) => verdict.earned.filter(Boolean).length
const key = ({ waves, each, vgprs }) => `${waves}-${each}-${vgprs}`

// ── 工作单 ──────────────────────────────────────────────────────────────────

test('工作单就是 1-8 挑战的三星写法：i 那一行填 k * T + t', () => {
  const best = coalescing.BEST_INDEX
  for (const lang of LANGS) {
    assert.equal(PART_CODE[lang], coalescing.PART_CODE[lang].replace(`[[i: ${coalescing.DEFAULT_INDEX}]]`, best))
  }
})

test('正好分完的五种派法：两种写法事件流一样，part 加起来都是 1 + 2 + … + 2048', () => {
  for (const waves of WAVE_OPTIONS) {
    const plan = evenPlan(waves)
    assert.equal(plan.waves * WAVE * plan.each, PART_N)
    const result = both(plan)
    assert.equal(result.arrays.part.length, waves * WAVE)
    assert.equal(sum(result.arrays.part), PART_TOTAL)
    assert.deepEqual(result.diagnostics, [])
  }
})

test('启动那一行：两种写法都是两行，派几组、每组几个、每人加几个都一样', () => {
  for (const plan of [DEFAULT_PLAN, evenPlan(16), { waves: 8, each: 2, vgprs: 128 }]) {
    const [hip, python] = LANGS.map((lang) => launchCode(plan, lang).split('\n'))
    assert.equal(hip.length, 2)
    assert.equal(python.length, 2)
    assert.equal(hip[1], `part_sum<<<${plan.waves}, ${WAVE}>>>(d_a, d_part, ${plan.each});`)
    assert.equal(python[1], `part_sum[${plan.waves}, ${WAVE}](d_a, d_part, ${plan.each})`)
    assert.equal(hip[0].slice(2), python[0].slice(1))
  }
})

// ── 住得下几支 ──────────────────────────────────────────────────────────────

test('寄存器：1024 ÷ 每个线程用的个数，名额 16 个封顶；64 个时两样正好一起用完', () => {
  const seats = VGPR_OPTIONS.map((v) => seatsOf(v))
  assert.deepEqual(seats.map((s) => [s.vgprs, s.byRegisters, s.resident, s.limiter]), [
    [32, 32, 16, 'slots'],
    [64, 16, 16, 'both'],
    [128, 8, 8, 'registers'],
    [256, 4, 4, 'registers'],
  ])
  for (const s of seats) assert.equal(s.byRegisters, LANE_VGPRS / s.vgprs)
  assert.equal(SLOTS, 16)
})

test('货架：一个 WGP 128 KB、4 条流水线合用；8 KB 一组住 16 组、每条 4 支，2 KB 住满名额，检查点的 16 KB 每条 2 支', () => {
  assert.deepEqual(LDS_EXAMPLES.map((e) => [e.kb, e.groups, e.perSimd, e.limiter]), [
    [8, 16, 4, 'lds'],
    [2, 64, 16, 'slots'],
  ])
  const q = ldsSeats(16)
  assert.deepEqual([q.groups, q.perSimd, q.limiter], [8, 2, 'lds'])
})

// ── 时间线：手算的标准例 ────────────────────────────────────────────────────

test('只派 1 支：没有重叠，用时 = 算的周期 + 每次取数等 104 个周期 + 最后写 part 搬一车；一点没藏住', () => {
  const s = schedule(both(evenPlan(1)).events, 16)
  const fetches = PART_N / WAVE
  // 开头 t、T、s 三步，每轮 3 步，最后一次判断和写 part 各一步
  assert.equal(s.busy, (3 + fetches * STEPS_PER_FETCH + 2) * STEP_CYCLES)
  assert.equal(s.cycles, s.busy + fetches * FETCH_WAIT + LINE_CYCLES)
  assert.deepEqual([s.cycles, s.hidden, s.hiddenRatio, s.batches], [CYCLES_BY_WAVES[1], 0, 0, 1])
  assert.equal(FETCH_WAIT, 104)
})

test('两支、每人加 1 个：住得下 2 支时 122 个周期、藏住 8 / 114；只住得下 1 支时分两批 232 个周期，第 2 支在门外等 116 个', () => {
  const events = both({ waves: 2, each: 1, vgprs: 32 }).events
  // 一支自己做：8 步，取 a 等 104、写 part 等 4，一共 116
  const together = schedule(events, 2)
  // 0 号算 [0,6) 去取数；1 号等到 6 才轮到，算 [6,12)；0 号的数在 110 回来，算两步写 part，等到 116；1 号接着算两步，等到 122
  assert.deepEqual(
    [together.cycles, together.busy, together.waiting, together.hidden, together.batches],
    [122, 16, 114, 8, 1],
  )
  assert.deepEqual(together.rows[1].segments.slice(0, 2), [{ kind: 'ready', start: 0, end: 6 }, { kind: 'run', start: 6, end: 12 }])

  const apart = schedule(events, 1)
  assert.deepEqual([apart.cycles, apart.busy, apart.waiting, apart.hidden, apart.batches], [232, 16, 216, 0, 2])
  assert.deepEqual(apart.batchStarts, [0, 116])
  assert.deepEqual(apart.rows[1].segments[0], { kind: 'queued', start: 0, end: 116 })
  // 0 号：算 [0,6)、[110,112)；1 号在第二批：算 [116,122)、[226,228)
  assert.deepEqual(apart.busySpans, [{ start: 0, end: 6 }, { start: 110, end: 112 }, { start: 116, end: 122 }, { start: 226, end: 228 }])
})

test('时间线的每一行首尾相接、不重叠，从 0 排到这支做完；流水线一次只给一支算', () => {
  for (const [plan, resident] of [[evenPlan(16), 16], [evenPlan(16), 4], [evenPlan(4), 2]]) {
    const s = schedule(both(plan).events, resident)
    for (const row of s.rows) {
      assert.equal(row.segments[0].start, 0)
      for (let k = 1; k < row.segments.length; k++) assert.equal(row.segments[k].start, row.segments[k - 1].end)
    }
    const runs = s.rows.flatMap((r) => r.segments.filter((x) => x.kind === 'run')).sort((a, b) => a.start - b.start)
    for (let k = 1; k < runs.length; k++) assert.ok(runs[k].start >= runs[k - 1].end, `${JSON.stringify(plan)}：两支同时在算`)
    assert.equal(sum(runs.map((r) => r.end - r.start)), s.busy)
    assert.equal(Math.max(...s.rows.map((r) => r.segments[r.segments.length - 1].end)), s.cycles)
  }
})

test('一组里有第二支小队（blockDim.x 不是 32）：这一关排不了，直接报错', () => {
  const result = run(buildRequest(PART_CODE.hip, 'hip', { grid: 1, block: 64 }, partArgs({ waves: 2, each: 32, vgprs: 32 })))
  assert.throws(() => schedule(result.events, 16), RangeError)
  assert.throws(() => schedule([], 0), RangeError)
})

// ── 探索一、二 ──────────────────────────────────────────────────────────────

test('探索一：派 1 / 2 / 4 / 8 / 16 组，用时就是 CYCLES_BY_WAVES；派得越多越快、藏得越多，16 支也藏不全', () => {
  let last = null
  for (const waves of WAVE_OPTIONS) {
    const s = schedule(both(evenPlan(waves)).events, seatsOf(32).resident)
    assert.equal(s.cycles, CYCLES_BY_WAVES[waves], `${waves} 组`)
    assert.equal(s.batches, 1)
    if (last) {
      assert.ok(s.cycles < last.cycles, `${waves} 组`)
      assert.ok(s.hiddenRatio > last.hiddenRatio, `${waves} 组`)
    }
    last = s
  }
  // 16 支轮一圈只有 48 个周期的活，填不满 104 个周期的等待
  assert.ok(16 * STEPS_PER_FETCH * STEP_CYCLES < FETCH_WAIT)
  assert.ok(last.hiddenRatio > 0.5 && last.hiddenRatio < 1)
  assert.equal(Math.round(CYCLES_BY_WAVES[1] / CYCLES_BY_WAVES[16]), 13)
})

test('探索二：派 16 组，每个线程的寄存器越多住下越少，分的批越多、用时越长、藏得越少', () => {
  const events = both(evenPlan(REGISTER_WAVES)).events
  const rows = VGPR_OPTIONS.map((v) => {
    const s = schedule(events, seatsOf(v).resident)
    return [v, s.resident, s.batches, s.cycles, s.hiddenRatio]
  })
  assert.deepEqual(rows.map((r) => r.slice(0, 4)), [
    [32, 16, 1, CYCLES_BY_VGPRS[32]],
    [64, 16, 1, CYCLES_BY_VGPRS[64]],
    [128, 8, 2, CYCLES_BY_VGPRS[128]],
    [256, 4, 4, CYCLES_BY_VGPRS[256]],
  ])
  assert.equal(CYCLES_BY_VGPRS[32], CYCLES_BY_WAVES[16])
  for (let k = 2; k < rows.length; k++) {
    assert.ok(rows[k][3] > rows[k - 1][3])
    assert.ok(rows[k][4] < rows[k - 1][4])
  }
  // 每一批做的事一样：4 支一批、每人加 4 个，4 批的用时是一批的 4 倍
  const one = schedule(both({ waves: 4, each: 4, vgprs: 32 }).events, 4)
  assert.equal(CYCLES_BY_VGPRS[256], 4 * one.cycles)
})

// ── 挑战 ────────────────────────────────────────────────────────────────────

/** 星数的标准答案：算对的派法只有五种组数各一种，按寄存器分。 */
const EXPECTED = new Map([
  ...VGPR_OPTIONS.flatMap((v) => [[key({ waves: 1, each: 64, vgprs: v }), 1], [key({ waves: 2, each: 32, vgprs: v }), 1], [key({ waves: 4, each: 16, vgprs: v }), 1]]),
  [key({ waves: 8, each: 8, vgprs: 32 }), 2],
  [key({ waves: 8, each: 8, vgprs: 64 }), 2],
  [key({ waves: 8, each: 8, vgprs: 128 }), 2],
  [key({ waves: 8, each: 8, vgprs: 256 }), 1],
  [key({ waves: 16, each: 4, vgprs: 32 }), 3],
  [key({ waves: 16, each: 4, vgprs: 64 }), 3],
  [key({ waves: 16, each: 4, vgprs: 128 }), 2],
  [key({ waves: 16, each: 4, vgprs: 256 }), 1],
])

test('挑战：120 种派法 × 两种写法的星数；拿星和写法无关，三颗星只有 16 组、每人 4 个、寄存器 32 或 64 个', () => {
  for (const plan of ALL_PLANS) {
    const [hip, python] = LANGS.map((lang) => judge(plan, simulate(plan, lang)))
    assert.deepEqual(python, hip, key(plan))
    assert.equal(stars(hip), EXPECTED.get(key(plan)) ?? 0, key(plan))
    // ★1 不成立一颗都不发；★3 成立 ★2 也成立
    if (!hip.earned[0]) assert.deepEqual(hip.earned, [false, false, false], key(plan))
    if (hip.earned[2]) assert.equal(hip.earned[1], true, key(plan))
    assert.ok(hip.next.length > 0)
  }
})

test('挑战 ★1 不成立：读到 a 外面、有数没人加，都写了「现象 / 原因 / 怎么改」，一颗星都没有', () => {
  const over = { waves: 16, each: 8, vgprs: 64 }
  const short = { waves: 16, each: 2, vgprs: 64 }
  const overRun = both(over)
  assert.ok(overRun.diagnostics.some((d) => d.kind === 'oob-read' && d.array === 'a'))
  const shortRun = both(short)
  assert.equal(sum(shortRun.arrays.part), sum(Array.from({ length: PART_N / 2 }, (_, j) => j + 1)))
  for (const [plan, result] of [[over, overRun], [short, shortRun]]) {
    const v = judge(plan, result)
    assert.deepEqual(v.earned, [false, false, false])
    assert.ok(v.error)
    assert.deepEqual(missingErrorParts(v.error), [])
    assert.equal(v.next, v.error.fix)
  }
  assert.notEqual(judge(over, overRun).error.symptom, judge(short, shortRun).error.symptom)
})

test('挑战 ★2：同样 8 组、每人 8 个，寄存器 256 个时只住得下 4 支，超过目标；128 个时 8 支都住下，达到目标', () => {
  const fat = { waves: 8, each: 8, vgprs: 256 }
  const slim = { waves: 8, each: 8, vgprs: 128 }
  const fatTime = schedule(both(fat).events, seatsOf(fat.vgprs).resident)
  const slimTime = schedule(both(slim).events, seatsOf(slim.vgprs).resident)
  assert.equal(fatTime.batches, 2)
  assert.ok(fatTime.cycles > TARGET_CYCLES)
  assert.equal(slimTime.batches, 1)
  assert.ok(slimTime.cycles <= TARGET_CYCLES)
  assert.deepEqual(judge(fat, both(fat)).earned, [true, false, false])
  assert.deepEqual(judge(slim, both(slim)).earned, [true, true, false])
})

test('挑战 ★3：最短的 527 个周期就是所有算对的派法里最短的，只有 16 支一起住下才达到', () => {
  const valid = ALL_PLANS.filter((p) => p.waves * WAVE * p.each === PART_N)
  const times = valid.map((p) => ({ plan: p, cycles: schedule(simulate(p, 'hip').events, seatsOf(p.vgprs).resident).cycles }))
  const best = Math.min(...times.map((t) => t.cycles))
  assert.equal(best, BEST_CYCLES)
  assert.ok(BEST_CYCLES < TARGET_CYCLES && TARGET_CYCLES < CYCLES_BY_WAVES[4])
  for (const t of times.filter((x) => x.cycles === best)) {
    assert.equal(t.plan.waves, 16)
    assert.equal(seatsOf(t.plan.vgprs).resident, 16)
  }
})

test('挑战：默认派法能跑但不好（★1 成立，★2 不成立）；草稿槽里读出来的派法被改坏了，用默认值补上', () => {
  assert.deepEqual(judge(DEFAULT_PLAN, both(DEFAULT_PLAN)).earned, [true, false, false])
  assert.deepEqual(normalizePlan(null), { ...DEFAULT_PLAN })
  assert.deepEqual(normalizePlan({ waves: 3, each: '4', vgprs: 100 }), { ...DEFAULT_PLAN })
  assert.deepEqual(normalizePlan({ waves: 16, each: 4, vgprs: 64, extra: true }), { waves: 16, each: 4, vgprs: 64 })
  // judge 自己也先补默认值：草稿里的怪值不会让判定出错
  const v = judge({ waves: 16, each: 4, vgprs: 999 }, both({ waves: 16, each: 4, vgprs: 256 }))
  assert.deepEqual(v.earned, [true, false, false])
})
