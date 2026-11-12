import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from '../../docs/sim/syntax/index.ts'
import { formatError } from '../../docs/sim/syntax/errors.ts'
import {
  BEST_PICKS, BEST_TOTAL, CREW_BEATS, CREW_SIZE, DEFAULT_PICKS, JOBS, PROF_BEATS, RACE_COUNTS, STAR_LABELS, TARGET_BEATS,
  crewAt, crewLap, describeRace, judge, normalizePicks, profAt, profLap, raceEnd, runDay, runJob,
} from '../../docs/novice/thousand-additions/challenge.ts'

/** 1-1 一千道加法：比赛规则、某一拍的画面、五张单子的代码和星级判定（06 第 7 节）。 */

// ── 比赛规则：几拍交卷 ─────────────────────────────────────────────────────

test('逐个相加：教授一道接一道；学徒每轮 1000 人同时做，题目少时教授反而快', () => {
  // 手算：教授 n 拍；学徒 ⌈n / 1000⌉ 轮，每轮 4 拍
  const expect = { 1: [1, 4], 10: [10, 4], 100: [100, 4], 1000: [1000, 4], 10000: [10000, 40] }
  for (const n of RACE_COUNTS) {
    const race = { n, kind: 'add' }
    assert.deepEqual([profLap(n).beats, crewLap(race).beats], expect[n], `${n} 道`)
    assert.equal(raceEnd(race), Math.max(...expect[n]))
  }
  assert.equal(crewLap({ n: 10, kind: 'add' }).workers, 10)
  assert.equal(crewLap({ n: 10000, kind: 'add' }).workers, CREW_SIZE)
  // 交卷的先后：1 道时教授快，4 道打平，5 道起学徒快
  assert.ok(profLap(1).beats < crewLap({ n: 1, kind: 'add' }).beats)
  assert.equal(profLap(4).beats, crewLap({ n: 4, kind: 'add' }).beats)
  assert.ok(profLap(5).beats > crewLap({ n: 5, kind: 'add' }).beats)
})

test('累加：学徒只能 1 个人从头加到尾，题目再多也比教授慢', () => {
  for (const n of RACE_COUNTS) {
    const crew = crewLap({ n, kind: 'sum' })
    assert.deepEqual(crew, { beats: n * CREW_BEATS, workers: 1 }, `${n} 个数`)
    assert.equal(profLap(n).beats, n * PROF_BEATS)
    assert.ok(crew.beats > profLap(n).beats)
  }
  assert.equal(raceEnd({ n: 1000, kind: 'sum' }), 4000)
})

test('没有题目、题目数不合法：两边都是 0 拍', () => {
  for (const n of [0, -3, Number.NaN]) {
    assert.deepEqual(profLap(n), { beats: 0, workers: 0 })
    assert.deepEqual(crewLap({ n, kind: 'add' }), { beats: 0, workers: 0 })
    assert.equal(raceEnd({ n, kind: 'sum' }), 0)
  }
})

// ── 某一拍的画面（02 第 5 节：画面是时间的纯函数）───────────────────────────

test('开赛那一刻：教授 1 人在算；学徒逐个相加时有几道题就几个人在算，累加时只有 1 个', () => {
  assert.deepEqual(profAt(1000, 0), { done: 0, busy: 1, finished: false })
  assert.deepEqual(crewAt({ n: 1000, kind: 'add' }, 0), { done: 0, busy: 1000, worked: 0, finished: false })
  assert.deepEqual(crewAt({ n: 10, kind: 'add' }, 0), { done: 0, busy: 10, worked: 0, finished: false })
  assert.deepEqual(crewAt({ n: 1000, kind: 'sum' }, 0), { done: 0, busy: 1, worked: 0, finished: false })
})

test('比赛中途和交卷：按拍数取整，交卷以后没人在算', () => {
  // 教授：第 412.7 拍做完 412 道，第 1000 拍交卷
  assert.deepEqual(profAt(1000, 412.7), { done: 412, busy: 1, finished: false })
  assert.deepEqual(profAt(1000, 1000), { done: 1000, busy: 0, finished: true })
  // 学徒逐个相加 1000 道：第 3.9 拍还没做完，第 4 拍一起交卷
  assert.deepEqual(crewAt({ n: 1000, kind: 'add' }, 3.9), { done: 0, busy: 1000, worked: 0, finished: false })
  assert.deepEqual(crewAt({ n: 1000, kind: 'add' }, 4), { done: 1000, busy: 0, worked: 1000, finished: true })
  // 10000 道分 10 轮：第 39 拍做完 9 轮，最后一轮还是那 1000 个人在算
  assert.deepEqual(crewAt({ n: 10000, kind: 'add' }, 39), { done: 9000, busy: 1000, worked: 1000, finished: false })
  assert.deepEqual(crewAt({ n: 10000, kind: 'add' }, 40), { done: 10000, busy: 0, worked: 1000, finished: true })
  // 2500 道：第 3 轮只剩 500 道，只有 500 人有活干
  assert.deepEqual(crewAt({ n: 2500, kind: 'add' }, 8), { done: 2000, busy: 500, worked: 1000, finished: false })
  // 1 道：交卷以后只有 1 个学徒干过活，另外 999 个一直没活干
  assert.deepEqual(crewAt({ n: 1, kind: 'add' }, 4), { done: 1, busy: 0, worked: 1, finished: true })
  // 累加：4 拍一步，从头到尾只有 1 个学徒在干活
  assert.deepEqual(crewAt({ n: 1000, kind: 'sum' }, 9), { done: 2, busy: 1, worked: 1, finished: false })
  assert.deepEqual(crewAt({ n: 1000, kind: 'sum' }, 4000), { done: 1000, busy: 0, worked: 1, finished: true })
})

test('拖到时间轴外面：开赛前算 0 道，交卷后不会多算', () => {
  assert.deepEqual(profAt(10, -5), { done: 0, busy: 1, finished: false })
  assert.deepEqual(profAt(10, 99), { done: 10, busy: 0, finished: true })
  assert.deepEqual(crewAt({ n: 10, kind: 'add' }, -1), { done: 0, busy: 10, worked: 0, finished: false })
  assert.deepEqual(crewAt({ n: 10, kind: 'sum' }, 1e9), { done: 10, busy: 0, worked: 1, finished: true })
})

test('一句话解读：说对谁先交卷和各自几拍', () => {
  assert.match(describeRace({ n: 1, kind: 'add' }), /教授 1 拍就交卷.*4 拍/)
  assert.match(describeRace({ n: 1000, kind: 'add' }), /1000 个学徒同时动笔，4 拍交卷.*要 1000 拍，是学徒的 250 倍/)
  assert.match(describeRace({ n: 10, kind: 'add' }), /是学徒的 2\.5 倍/)
  assert.match(describeRace({ n: 10000, kind: 'add' }), /分 10 轮.*40 拍交卷.*要 10000 拍/)
  assert.match(describeRace({ n: 4, kind: 'add' }), /打平/)
  assert.match(describeRace({ n: 1000, kind: 'sum' }), /1000 拍算完.*要 4000 拍，另外 999 个人帮不上忙/)
})

// ── 五张单子的代码：两种写法是同一个程序，标的「有没有依赖」和代码对得上 ─────────────

/** 两种写法的位置必然不同，比较语法树时去掉 loc。 */
const shape = (node) => JSON.parse(JSON.stringify(node, (key, value) => (key === 'loc' ? undefined : value)))
const key = (expr) => JSON.stringify(shape(expr))
const indent = (code) => code.split('\n').map((line) => `    ${line}`).join('\n')

/** 页面上只显示循环本身，解析时包成一个 kernel：用到的数组当参数。 */
const WRAP = {
  hip: (job) => `__global__ void job(${job.arrays.map((a) => `float* ${a}`).join(', ')}) {\n${indent(job.code.hip)}\n}\n`,
  python: (job) => `@kernel\ndef job(${job.arrays.join(', ')}):\n${indent(job.code.python)}\n`,
}

function kernelOf(job, lang) {
  const r = parse(WRAP[lang](job), lang)
  assert.ok(r.ok, r.ok ? '' : `${job.id} 的 ${lang} 写法解析失败：${formatError(r.error)}`)
  return r.kernel
}

/** 表达式里读到的变量，和「数组[下标]」（下标转成字符串，好比较）。 */
function readsOf(expr, out) {
  if (expr.kind === 'name') out.push({ name: expr.name })
  else if (expr.kind === 'index') {
    out.push({ array: expr.array, at: key(expr.index) })
    readsOf(expr.index, out)
  } else if (expr.kind === 'unary' || expr.kind === 'cast') readsOf(expr.arg, out)
  else if (expr.kind === 'binary') {
    readsOf(expr.left, out)
    readsOf(expr.right, out)
  } else if (expr.kind === 'cond') for (const part of [expr.test, expr.body, expr.orelse]) readsOf(part, out)
  return out
}

/**
 * 循环的某一步写进去的东西，有没有被另一步读到。单子的代码只有两种依赖的样子：
 * 循环外声明的变量在循环里又读又写（s = s + a[i]），或者同一个数组写一格、读另一格（p[i + 1] = p[i] + a[i]）。
 */
function loopOf(kernel) {
  const loops = kernel.body.filter((s) => s.kind === 'for')
  assert.equal(loops.length, 1, '每张单子是一个循环')
  return loops[0]
}

function hasDependency(kernel) {
  const outer = new Set(kernel.body.filter((s) => s.kind === 'let').map((s) => s.name))
  const writes = []
  const reads = []
  for (const st of loopOf(kernel).body) {
    assert.equal(st.kind, 'assign', '单子的循环里只有赋值')
    if (st.target.kind === 'name') writes.push({ name: st.target.name })
    else {
      writes.push({ array: st.target.array, at: key(st.target.index) })
      readsOf(st.target.index, reads)
    }
    readsOf(st.value, reads)
  }
  return writes.some((w) => (w.name
    ? outer.has(w.name) && reads.some((r) => r.name === w.name)
    : reads.some((r) => r.array === w.array && r.at !== w.at)))
}

/** 循环跑几次，也就是这张单子有几道加法（起点、终点、步长都是写死的数）。 */
function tripCount(kernel) {
  const { start, stop, step } = loopOf(kernel)
  for (const part of [start, stop, step]) assert.equal(part.kind, 'num')
  return Math.ceil((stop.value - start.value) / step.value)
}

test('两种写法：每张单子的 HIP 风格和 Python 风格解析成同一棵语法树', () => {
  for (const job of JOBS) {
    assert.deepEqual(shape(kernelOf(job, 'python')), shape(kernelOf(job, 'hip')), job.id)
  }
})

test('两种写法：单子标的道数、有没有依赖，和代码分析出来的一致', () => {
  for (const job of JOBS) {
    for (const lang of ['hip', 'python']) {
      const kernel = kernelOf(job, lang)
      assert.equal(tripCount(kernel), job.n, `${job.id} 的 ${lang} 写法：循环次数和 n 不一致`)
      assert.equal(hasDependency(kernel), job.dependent, `${job.id} 的 ${lang} 写法：依赖和 dependent 不一致`)
    }
    // 有依赖的单子拆给学徒要说清交上来的是什么样（★1 没过时的「现象」）
    assert.equal(Boolean(job.splitResult), job.dependent, job.id)
  }
  // 五张单子里拆得开、拆不开的都有，也有一张小到不值得拆
  assert.ok(JOBS.some((j) => j.dependent) && JOBS.some((j) => !j.dependent))
  assert.ok(JOBS.some((j) => !j.dependent && j.n * PROF_BEATS < CREW_BEATS))
})

// ── 星级判定 ─────────────────────────────────────────────────────────────

test('一张单子：交给教授一道一拍、结果都对；拆给学徒几拍做完，有依赖的结果是错的', () => {
  const [add, sum, small] = JOBS
  assert.deepEqual([runJob(add, 'prof').beats, runJob(add, 'prof').correct], [1000, true])
  assert.deepEqual([runJob(add, 'crew').beats, runJob(add, 'crew').correct], [4, true])
  assert.deepEqual([runJob(sum, 'prof').beats, runJob(sum, 'prof').correct], [1000, true])
  assert.deepEqual([runJob(sum, 'crew').beats, runJob(sum, 'crew').correct], [4, false])
  assert.deepEqual([runJob(small, 'prof').beats, runJob(small, 'crew').beats], [2, 4])
  // 单子一张做完再做下一张：总用时是每张相加
  assert.equal(runDay(DEFAULT_PICKS).total, JOBS.reduce((s, j) => s + j.n * PROF_BEATS, 0))
})

test('最佳派法：大的、拆得开的给学徒，拆不开的和太小的给教授；三颗星', () => {
  assert.deepEqual([...BEST_PICKS], ['crew', 'prof', 'prof', 'crew', 'prof'])
  assert.equal(BEST_TOTAL, 2010)
  const verdict = judge(BEST_PICKS)
  assert.deepEqual(verdict.earned, [true, true, true])
  assert.equal(verdict.error, undefined)
  assert.match(verdict.next, /2010 拍，其中 2000 拍花在拆不开的单子上/)
})

test('★1：有依赖的单子拆给学徒，一颗星都不发，说清现象、原因、怎么改', () => {
  const picks = [...BEST_PICKS]
  picks[1] = 'crew'
  const one = judge(picks)
  assert.deepEqual(one.earned, [false, false, false])
  for (const part of ['symptom', 'cause', 'fix']) assert.ok(one.error[part].trim(), part)
  assert.match(one.error.symptom, /^单子 2 算错了/)
  assert.match(one.error.fix, /把单子 2 交给教授/)
  assert.equal(one.next, one.error.fix)

  // 全拆：最快（20 拍），但两张有依赖的都算错了
  const all = judge(JOBS.map(() => 'crew'))
  assert.deepEqual(all.earned, [false, false, false])
  assert.match(all.error.fix, /把单子 2、单子 5 交给教授/)
})

test('★2：拆得开的大单子留给教授，总用时超过目标；指出省得最多的那张', () => {
  const allProf = judge(DEFAULT_PICKS)
  assert.deepEqual(allProf.earned, [true, false, false])
  assert.match(allProf.next, new RegExp(`总用时 4002 拍，目标是不超过 ${TARGET_BEATS} 拍。单子 1`))

  const picks = [...BEST_PICKS]
  picks[3] = 'prof'
  const one = judge(picks)
  assert.deepEqual(one.earned, [true, false, false])
  assert.match(one.next, /单子 4（每个数加上它后面那个数）交给了教授，用了 1000 拍.*只要 4 拍/)
})

test('★3：只差一张小单子拆给了学徒，★2 达到但不是最短', () => {
  const picks = [...BEST_PICKS]
  picks[2] = 'crew'
  const verdict = judge(picks)
  assert.deepEqual(verdict.earned, [true, true, false])
  assert.match(verdict.next, /总用时 2012 拍，还能再快 2 拍。单子 3 交给学徒要 4 拍，交给教授只要 2 拍/)
})

test('目标拍数把 ★2 和 ★3 分开：最短的能过，小单子派错也能过，大单子派错就过不了', () => {
  assert.ok(BEST_TOTAL <= TARGET_BEATS)
  assert.match(STAR_LABELS[1], new RegExp(`不超过 ${TARGET_BEATS} 拍`))
  for (const [i, job] of JOBS.entries()) {
    if (job.dependent) continue
    const picks = [...BEST_PICKS]
    picks[i] = BEST_PICKS[i] === 'crew' ? 'prof' : 'crew'
    const total = runDay(picks).total
    if (job.n * PROF_BEATS < CREW_BEATS) assert.ok(total <= TARGET_BEATS, `${job.id} 派错仍在目标内`)
    else assert.ok(total > TARGET_BEATS, `${job.id} 派错就超过目标`)
  }
})

test('草稿里的派法坏了：长度不对、值不认识的地方用默认（交给教授）', () => {
  assert.deepEqual(normalizePicks(null), [...DEFAULT_PICKS])
  assert.deepEqual(normalizePicks(['crew']), ['crew', 'prof', 'prof', 'prof', 'prof'])
  assert.deepEqual(normalizePicks(['crew', 'boss', 7, 'crew', 'prof', 'crew']), ['crew', 'prof', 'prof', 'crew', 'prof'])
  assert.deepEqual(judge(['crew']).earned, judge(normalizePicks(['crew'])).earned)
})
