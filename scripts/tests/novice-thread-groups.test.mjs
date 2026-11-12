import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluate, parseIndexExpr } from '../../docs/sim/expr.ts'
import { describe, minBlocks as minBlocksL1, simulate } from '../../docs/sim/launch.ts'
import { run } from '../../docs/sim/lockstep.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import {
  BLOCK_DIMS, CHALLENGE_BLANKS, CHALLENGE_CODE, CHALLENGE_GRID_MAX, CHALLENGE_LAUNCH, CHALLENGE_N, EXPLORE_LAUNCH,
  EXPLORE_N, GLOBAL_INDEX, RULE_BLANKS, RULE_CODE, STAGE_ID, addArgs, checkCells, judge, judgeRule, kernelSource,
  minBlocks, normalizeLaunch, variantsFor,
} from '../../docs/novice/thread-groups/challenge.ts'
import {
  awardStar, clearedState, completeStage, getStage, levelOf, PILOT_KEY, PILOT_STAGE_ID, recordPrediction, xpIntoLevel,
} from '../../docs/course/progress.ts'
import { loadState, memoryStorage, saveState, STORAGE_KEY } from '../../docs/course/storage.ts'

/**
 * 1-4 线程分组。前 8 个用例来自试点关卡（L1：下标表达式和一维启动的逻辑模型 docs/sim/expr.ts、launch.ts）；
 * 星级和进度两个用例原来测试点自己的 judge 和进度存档，NV-04 把它们换成正式关卡的 judge（模拟器 L2）
 * 和正式存档（试点存档迁进来以后照样成立）。后面是正式关卡的三段探索和挑战，两种写法结果相同。
 */

const env = (block, thread, blockDim = 4, gridDim = 3, n = 10) =>
  ({ 'blockIdx.x': block, 'blockDim.x': blockDim, 'threadIdx.x': thread, 'gridDim.x': gridDim, n })

function parse(src, lang = 'hip') {
  const r = parseIndexExpr(src, lang)
  assert.ok(r.ok, r.ok ? '' : r.error.message)
  return r.expr
}

test('全局下标公式在两种写法下解析成同一棵语法树', () => {
  const src = 'blockIdx.x * blockDim.x + threadIdx.x'
  assert.deepEqual(parse(src, 'hip'), parse(src, 'python'))
  assert.deepEqual(parse(`int i = ${src};`, 'hip'), parse(src, 'hip'))
  assert.deepEqual(parse(`i = ${src}`, 'python'), parse(src, 'python'))
})

test('运算优先级、括号与一元负号', () => {
  const e = parse('(blockIdx.x + 1) * blockDim.x - threadIdx.x')
  const r = evaluate(e, env(2, 1), 'hip')
  assert.deepEqual(r, { ok: true, value: 11 })
  assert.deepEqual(evaluate(parse('-threadIdx.x + 3'), env(0, 1), 'hip'), { ok: true, value: 2 })
})

test('除法：HIP 截断取整，Python 的 / 得到小数会被拒绝，// 是向下取整', () => {
  const div = src => [evaluate(parse(src, 'hip'), env(0, 3), 'hip'), evaluate(parse(src, 'python'), env(0, 3), 'python')]
  const [hip, py] = div('threadIdx.x / 2')
  assert.deepEqual(hip, { ok: true, value: 1 })
  assert.equal(py.ok, false)
  assert.match(py.error, /\/\//)
  assert.deepEqual(evaluate(parse('-threadIdx.x // 2', 'python'), env(0, 3), 'python'), { ok: true, value: -2 })
  // 除得尽也不行：Python 里 8 / 1 是 8.0，不能当下标；HIP 里是整数 8
  const exact = 'blockIdx.x * blockDim.x / 1 + threadIdx.x'
  assert.equal(evaluate(parse(exact, 'python'), env(2, 0), 'python').ok, false)
  assert.deepEqual(evaluate(parse(exact, 'hip'), env(2, 0), 'hip'), { ok: true, value: 8 })
  assert.equal(evaluate(parse('(threadIdx.x / 1) // 1', 'python'), env(0, 3), 'python').ok, false)
  assert.deepEqual(evaluate(parse('-threadIdx.x / 2', 'hip'), env(0, 3), 'hip'), { ok: true, value: -1 })
})

test('读者常见的写错方式都有可读的错误提示', () => {
  const err = (src, lang = 'hip') => {
    const r = parseIndexExpr(src, lang)
    assert.equal(r.ok, false, `应当报错：${src}`)
    return r.error.message
  }
  assert.match(err(''), /先写出/)
  assert.match(err('threadIdx'), /\.x/)
  assert.match(err('threadIdx.y'), /只用 \.x/)
  assert.match(err('blockIdx.x * blockDim'), /\.x/)
  assert.match(err('tid'), /不认识/)
  assert.match(err('blockIdx.x // 2', 'hip'), /注释/)
  assert.match(err('(blockIdx.x + 1'), /右括号/)
  assert.match(err('blockIdx.x blockDim.x'), /运算符/)
  assert.match(err('blockIdx.x *'), /没写完/)
  assert.match(err('1.5 * threadIdx.x'), /整数/)
})

test('正确公式 + 3 组 × 4：10 个数全部覆盖，2 个越界；加上检查后变成跳过', () => {
  const e = parse('blockIdx.x * blockDim.x + threadIdx.x')
  const r = simulate(e, 'hip', { n: 10, blockDim: 4, gridDim: 3, guard: false })
  assert.ok(r.ok)
  assert.equal(r.summary.allCorrect, true)
  assert.equal(r.summary.duplicates, 0)
  assert.equal(r.summary.oobWrites, 2)
  assert.deepEqual(r.outside.map(o => o.index), [10, 11])
  const g = simulate(e, 'hip', { n: 10, blockDim: 4, gridDim: 3, guard: true })
  assert.ok(g.ok)
  assert.equal(g.summary.oobWrites, 0)
  assert.equal(g.summary.skipped, 2)
  assert.match(describe(g, 10), /全部算对/)
})

test('只用 threadIdx.x：每组都去抢前几个数，后面的数没人算', () => {
  const r = simulate(parse('threadIdx.x'), 'python', { n: 10, blockDim: 4, gridDim: 3, guard: false })
  assert.ok(r.ok)
  assert.equal(r.summary.covered, 4)
  assert.equal(r.summary.missing, 6)
  assert.equal(r.summary.duplicates, 4)
  assert.deepEqual(r.elements[0], [{ block: 0, thread: 0 }, { block: 1, thread: 0 }, { block: 2, thread: 0 }])
})

test('边界检查只写 i < n：负数下标依然算越界', () => {
  const r = simulate(parse('threadIdx.x - 1'), 'hip', { n: 4, blockDim: 4, gridDim: 1, guard: true })
  assert.ok(r.ok)
  assert.equal(r.summary.oobWrites, 1)
  assert.deepEqual(r.outside, [{ index: -1, writers: [{ block: 0, thread: 0 }] }])
})

test('Python 写法里的小数下标会让整次运行报错，并指出是哪个线程', () => {
  const r = simulate(parse('threadIdx.x / 2', 'python'), 'python', { n: 4, blockDim: 4, gridDim: 1, guard: false })
  assert.equal(r.ok, false)
  // 第一个线程就出错：0 / 2 得到 0.0，同样是小数类型
  assert.deepEqual([r.block, r.thread], [0, 0])
})

// ── 正式关卡：沙盒里的代码在模拟器（L2）里真正跑 ─────────────────────────────

const LANGS = ['hip', 'python']
const sumOf = (n) => Array.from({ length: n }, (_, k) => 11 * (k + 1))
/** 挑战里写入前的条件：「不检查」两种写法字面量不一样。 */
const ALWAYS = { hip: 'true', python: 'True' }

function fill(template, lang, values) {
  return fillTemplate(parseTemplate(template[lang]), values).source
}

/** 沙盒点一次「运行」做的事：读者设的那一次，代码没出错再按 variants 各跑一次。 */
function sandboxRuns(code, lang, launch, args, variants = []) {
  const main = { launch, result: run(buildRequest(code, lang, launch, args)) }
  if (!main.result.ok) return [main]
  return [main, ...variants.map((change) => {
    const config = { ...launch, ...change }
    return { launch: config, result: run(buildRequest(code, lang, config, args)) }
  })]
}

/** 两种写法跑同一份代码：结果、越界区、步数、事件逐项相同（事件只差行号：Python 多一行 @kernel）。 */
function bothLangs(runsOf) {
  const [hip, python] = LANGS.map(runsOf)
  const strip = (runs) => runs.map(({ launch, result }) => ({
    launch,
    ok: result.ok,
    arrays: result.arrays,
    outside: result.outside.map((o) => ({ ...o, writes: o.writes.map(({ line, ...w }) => w) })),
    diagnostics: result.diagnostics.length,
    steps: result.steps,
    events: result.events.map(({ line, ...e }) => e),
  }))
  assert.deepEqual(strip(python), strip(hip))
  return { hip, python }
}

/** 探索一、三：写死的工作单（kernelSource），10 对数；返回 HIP 那一次（两种写法逐项相同）。 */
function labBoth(index, guard, launch) {
  return bothLangs((lang) => sandboxRuns(kernelSource(lang, index, guard), lang, launch, addArgs(EXPLORE_N))).hip[0]
}

/** 探索二：两种写法跑出来逐项相同，判定也相同。 */
function ruleBoth(i, launch = EXPLORE_LAUNCH) {
  const { hip, python } = bothLangs((lang) => sandboxRuns(fill(RULE_CODE, lang, { i }), lang, launch, addArgs(EXPLORE_N)))
  const verdict = judgeRule(hip)
  assert.deepEqual(judgeRule(python), verdict)
  return { verdict, run: hip[0] }
}

/** 挑战：读者设的那一次，加上 variantsFor 的另外两种每组线程数；guard 不写就是「不检查」。 */
function challengeBoth(i, guard, launch) {
  const { hip, python } = bothLangs((lang) => sandboxRuns(
    fill(CHALLENGE_CODE, lang, { i, guard: guard ?? ALWAYS[lang] }), lang, launch, addArgs(CHALLENGE_N), variantsFor(launch)))
  const verdict = judge(hip)
  assert.deepEqual(judge(python), verdict)
  return { verdict, runs: hip }
}

test('星级：正确、无越界、最少组数且不写死人数', () => {
  const four = { grid: 4, block: 4 }
  assert.deepEqual(challengeBoth(GLOBAL_INDEX, 'i < n', four).verdict.earned, [true, true, true])
  assert.equal(minBlocks(13, 4), 4)
  assert.equal(minBlocksL1(13, 4), minBlocks(13, 4))

  const noGuard = challengeBoth(GLOBAL_INDEX, undefined, four).verdict
  assert.deepEqual(noGuard.earned, [true, false, false])
  assert.match(noGuard.next, /3 个线程/)

  const tooMany = challengeBoth(GLOBAL_INDEX, 'i < n', { grid: 5, block: 4 }).verdict
  assert.deepEqual(tooMany.earned, [true, true, false])
  assert.match(tooMany.next, /4 组就够了/)

  const hardCoded = challengeBoth('blockIdx.x * 4 + threadIdx.x', 'i < n', four).verdict
  assert.deepEqual(hardCoded.earned, [true, true, false])
  assert.match(hardCoded.next, /写死/)

  assert.deepEqual(challengeBoth('threadIdx.x', 'i < n', four).verdict.earned, [false, false, false])
})

test('探索一：只用 threadIdx.x，怎么调每组线程数和组数，后面的数都没人算', () => {
  for (const block of BLOCK_DIMS) {
    for (let grid = 1; grid <= 6; grid++) {
      const where = `${grid} 组 × 每组 ${block} 个`
      const check = checkCells(labBoth('threadIdx.x', false, { grid, block }))
      // 每组都从 c[0] 算起：只有前 blockDim.x 格有人算，每格被算「组数」遍
      const reach = Math.min(block, EXPLORE_N)
      assert.deepEqual(check.writers, Array.from({ length: EXPLORE_N }, (_, k) => (k < reach ? grid : 0)), where)
      assert.equal(check.correct, false, where)
    }
  }
})

test('探索二：只有全局下标让每对数都有人算、没人重复；把人数写死，换每组线程数就露馅', () => {
  const passed = RULE_BLANKS.i.choices.filter((i) => ruleBoth(i).verdict.earned[0])
  assert.deepEqual(passed, [GLOBAL_INDEX, 'blockIdx.x * 4 + threadIdx.x'])
  const right = ruleBoth(GLOBAL_INDEX)
  assert.deepEqual(right.run.result.arrays.c, sumOf(EXPLORE_N))
  assert.equal(right.verdict.error, undefined)
  // 过了也说清：多出来的 2 个线程写到了数组外面，那是探索三的事
  assert.match(right.verdict.next, /多出来的 2 个线程.*c\[10\]、c\[11\]/)
  for (const block of BLOCK_DIMS) {
    const launch = { grid: minBlocks(EXPLORE_N, block), block }
    assert.equal(ruleBoth(GLOBAL_INDEX, launch).verdict.earned[0], true, `每组 ${block} 个`)
    assert.equal(ruleBoth('blockIdx.x * 4 + threadIdx.x', launch).verdict.earned[0], block === 4, `写死 4，每组 ${block} 个`)
  }
  // 线程正好 10 个：没有多出来的
  assert.match(ruleBoth(GLOBAL_INDEX, { grid: 5, block: 2 }).verdict.next, /正好 10 个/)
})

test('探索二没过：说清是每组都从 0 数起、相邻几组叠在一起，还是线程不够', () => {
  const start = ruleBoth('threadIdx.x').verdict
  assert.deepEqual(start.earned, [false, false, false])
  assert.equal(start.error.symptom, 'c[0]～c[3] 被不止一个线程算了，6 个数没人算（c[4]～c[9]）。')
  assert.match(start.error.cause, /每一组都从 c\[0\] 算起.*3 组就把前几格各算了 3 遍/)
  assert.match(start.error.fix, /blockIdx\.x \* blockDim\.x \+ threadIdx\.x/)
  const overlap = ruleBoth('blockIdx.x + threadIdx.x').verdict
  assert.equal(overlap.error.symptom, 'c[1]～c[4] 被不止一个线程算了，4 个数没人算（c[6]～c[9]）。')
  assert.match(overlap.error.cause, /相邻几组算的格子叠在了一起/)
  const few = ruleBoth(GLOBAL_INDEX, { grid: 2, block: 4 }).verdict
  assert.equal(few.error.symptom, '2 个数没人算：c[8]、c[9]。')
  assert.match(few.error.cause, /只派出 8 个线程（2 组 × 每组 4 个）/)
  assert.match(few.error.fix, /至少要派 3 组/)
})

test('探索三：多出来的 2 个线程没有边界检查就写到 c[10]、c[11]；加上检查就什么都不做', () => {
  const plain = checkCells(labBoth(GLOBAL_INDEX, false, EXPLORE_LAUNCH))
  assert.equal(plain.correct, true)
  assert.deepEqual([plain.outside, plain.outsideWrites], [[10, 11], 2])
  const guarded = labBoth(GLOBAL_INDEX, true, EXPLORE_LAUNCH)
  const check = checkCells(guarded)
  assert.deepEqual(guarded.result.arrays.c, sumOf(EXPLORE_N))
  assert.deepEqual([check.outside, check.duplicates, check.missing], [[], [], []])
  // 12 个线程只写了 10 次：另外 2 个检查后跳过
  assert.equal(check.writers.reduce((a, b) => a + b, 0), 10)
})

test('挑战 ★1：初始代码每组都从 0 开始拿数；下标对了线程不够时，说的是组数；只用组的编号时，说的是 threadIdx.x', () => {
  const start = challengeBoth('threadIdx.x', undefined, CHALLENGE_LAUNCH)
  assert.deepEqual(start.verdict.earned, [false, false, false])
  assert.equal(start.verdict.error.symptom, 'c[0]～c[3] 被不止一个线程算了，9 个数没人算（c[4]～c[12]）。')
  assert.equal(start.verdict.error.raw, `运行后 c = [${start.runs[0].result.arrays.c.join(', ')}]`)
  // 代码出错时不跑 variants；没出错但 ★1 没过时也照样跑（★3 要用）
  assert.equal(start.runs.length, 3)

  const few = challengeBoth(GLOBAL_INDEX, 'i < n', CHALLENGE_LAUNCH).verdict
  assert.deepEqual(few.earned, [false, false, false])
  assert.equal(few.error.symptom, '5 个数没人算：c[8]～c[12]。')
  assert.match(few.error.fix, /每组 4 个，至少要派 4 组/)

  const blockOnly = challengeBoth('blockIdx.x * blockDim.x', 'i < n', { grid: 4, block: 4 }).verdict
  assert.deepEqual(blockOnly.earned, [false, false, false])
  assert.match(blockOnly.error.cause, /下标里没有用到自己在组里的编号 threadIdx\.x/)

  // 条件太严，把该算的线程拦在外面：线程够了，说的是条件
  const strict = challengeBoth(GLOBAL_INDEX, 'i < n - 1', { grid: 4, block: 4 }).verdict
  assert.equal(strict.error.symptom, '1 个数没人算：c[12]。')
  assert.match(strict.error.cause, /条件把该算的线程拦在了外面/)
})

test('挑战 ★2：不检查、或者条件差一个（i <= n）都会写到数组外面，结果却是对的', () => {
  const { verdict, runs } = challengeBoth(GLOBAL_INDEX, undefined, { grid: 4, block: 4 })
  assert.deepEqual(verdict.earned, [true, false, false])
  assert.deepEqual(runs[0].result.arrays.c, sumOf(CHALLENGE_N))
  assert.deepEqual(runs[0].result.outside.map((o) => [o.array, o.index]), [['c', 13], ['c', 14], ['c', 15]])
  assert.match(verdict.next, /^有 3 个线程写到了数组外面（c\[13\]～c\[15\]）：派出了 16 个线程，只有 13 个数/)
  const offByOne = challengeBoth(GLOBAL_INDEX, 'i <= n', { grid: 4, block: 4 }).verdict
  assert.deepEqual(offByOne.earned, [true, false, false])
  assert.match(offByOne.next, /^有 1 个线程写到了数组外面（c\[13\]）.*数组最后一格是 c\[12\]/)
})

test('挑战 ★3：真的换成另外两种每组线程数再跑；多派一组、把每组 4 个写死都不行', () => {
  const { verdict, runs } = challengeBoth(GLOBAL_INDEX, 'i < n', { grid: 4, block: 4 })
  assert.deepEqual(runs.map((r) => [r.launch.grid, r.launch.block]), [[4, 4], [7, 2], [2, 8]])
  assert.deepEqual(verdict.earned, [true, true, true])
  const hardcoded = challengeBoth('blockIdx.x * 4 + threadIdx.x', 'i < n', { grid: 4, block: 4 }).verdict
  assert.match(hardcoded.next, /把每组线程数换成 2（派 7 组）/)
  // 没有 variants 的结果判不了 ★3
  assert.deepEqual(judge(runs.slice(0, 1)).earned, [true, true, false])
})

test('挑战：每组 2、4、8 个线程，组数取刚好够用，两种写法都拿满三颗星', () => {
  for (const block of BLOCK_DIMS) {
    const launch = { grid: minBlocks(CHALLENGE_N, block), block }
    const { verdict, runs } = challengeBoth(GLOBAL_INDEX, 'i < n', launch)
    assert.deepEqual(verdict.earned, [true, true, true], `每组 ${block} 个`)
    for (const r of runs) assert.deepEqual(r.result.arrays.c, sumOf(CHALLENGE_N), `每组 ${r.launch.block} 个`)
  }
  // 手机上的选项：只有全局下标 + i < n 能拿满
  const full = []
  for (const i of CHALLENGE_BLANKS.i.choices) {
    for (const guard of CHALLENGE_BLANKS.guard.choices.hip) {
      const g = guard === 'true' ? undefined : guard
      if (challengeBoth(i, g, { grid: 4, block: 4 }).verdict.earned.every(Boolean)) full.push([i, guard])
    }
  }
  assert.deepEqual(full, [[GLOBAL_INDEX, 'i < n']])
})

test('两种写法的工作单和模板解析成同一棵语法树（除了位置）', () => {
  const strip = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  const pairs = [
    [kernelSource('hip', 'threadIdx.x', false), kernelSource('python', 'threadIdx.x', false)],
    [kernelSource('hip', GLOBAL_INDEX, true), kernelSource('python', GLOBAL_INDEX, true)],
    [fill(RULE_CODE, 'hip', { i: GLOBAL_INDEX }), fill(RULE_CODE, 'python', { i: GLOBAL_INDEX })],
    [fill(CHALLENGE_CODE, 'hip', { i: GLOBAL_INDEX, guard: 'i < n' }), fill(CHALLENGE_CODE, 'python', { i: GLOBAL_INDEX, guard: 'i < n' })],
  ]
  for (const [hipSource, pySource] of pairs) {
    const hip = parseKernel(hipSource, 'hip')
    const python = parseKernel(pySource, 'python')
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(strip(python.kernel), strip(hip.kernel))
  }
})

test('草稿里的派法坏了或是旧的：回到默认值', () => {
  assert.deepEqual(normalizeLaunch({ grid: 3, block: 8 }, CHALLENGE_LAUNCH, CHALLENGE_GRID_MAX), { grid: 3, block: 8 })
  for (const raw of [undefined, null, 'x', { grid: 0, block: 3 }, { grid: 9, block: '4' }, { grid: 2.5 }]) {
    assert.deepEqual(normalizeLaunch(raw, CHALLENGE_LAUNCH, CHALLENGE_GRID_MAX), CHALLENGE_LAUNCH, JSON.stringify(raw))
  }
  assert.deepEqual(normalizeLaunch({ grid: 8, block: 2 }, EXPLORE_LAUNCH, 6), { grid: EXPLORE_LAUNCH.grid, block: 2 })
})

// ── 进度：试点存档（hg-pilot-v1）迁进正式存档以后，试点的进度规则照样成立 ─────────────

const AT = 1_700_000_000_000

/** 试点进度模块（NV-04 删除）存下来的样子：version 1，stages 按关卡 id，预测按 id。 */
function pilotSave({ stars = [], completed = false, answerViewed = false, xp = 0, predictions = {} } = {}) {
  return JSON.stringify({ version: 1, xp, stages: { [STAGE_ID]: { stars, completed, answerViewed } }, predictions, codex: [], log: [] })
}

test('进度：星和完成各只计一次，看过答案后第三颗星不再发放，每 300 XP 升一级', () => {
  assert.equal(PILOT_STAGE_ID, STAGE_ID)
  const storage = memoryStorage()
  storage.setItem(PILOT_KEY, pilotSave({ stars: [0], answerViewed: true, xp: 50, predictions: { 'p-groups': { choice: 1, correct: true, at: AT } } }))
  const { state: s, migrated } = loadState(storage, AT)
  assert.equal(migrated, true)
  const gained = (events) => events.filter((e) => e.type === 'xp').reduce((n, e) => n + e.amount, 0)
  assert.equal(gained(awardStar(s, STAGE_ID, 0, { at: AT })), 0)
  assert.equal(gained(awardStar(s, STAGE_ID, 1, { at: AT })), 50)
  // 试点里看过答案：迁过来以后本关最高 2 星，第三颗不再发放
  assert.equal(gained(awardStar(s, STAGE_ID, 2, { at: AT })), 0)
  assert.equal(gained(completeStage(s, STAGE_ID, { at: AT })), 100)
  assert.equal(gained(completeStage(s, STAGE_ID, { at: AT })), 0)
  assert.equal(s.xp, 200)
  assert.deepEqual([levelOf(s.xp), xpIntoLevel(s.xp)], [1, 200])
  assert.equal(levelOf(300), 2)

  // 试点里锁定的预测带过来，正式页面上同一个 id 不会再记第二次
  recordPrediction(s, 'p-groups', 2, false, { stage: STAGE_ID, at: AT })
  assert.equal(s.predictions['p-groups'].choice, 1)

  // 试点的「清空本关进度」（PilotLog）去掉了，读者在「我的成长」清空进度：
  // 进度清掉、迁移记录留着，这台设备上的试点存档不会再迁进来一遍
  const cleared = clearedState(s, AT)
  assert.deepEqual([cleared.xp, getStage(cleared, STAGE_ID).stars, cleared.predictions['p-groups']], [0, [], undefined])
  saveState(storage, cleared)
  assert.equal(loadState(storage, AT + 1).state.xp, 0)
})

test('进度存取：损坏或旧版本的数据回到空状态，存储不可用时不抛错', () => {
  for (const raw of ['{broken', JSON.stringify({ version: 0, xp: 999, stages: { [STAGE_ID]: { stars: [0, 1, 2], completed: true } } })]) {
    const storage = memoryStorage()
    storage.setItem(PILOT_KEY, raw)
    const { state, migrated } = loadState(storage, AT)
    assert.equal(migrated, false, raw)
    assert.equal(state.xp, 0, raw)
    assert.equal(storage.getItem(STORAGE_KEY), null, raw)
  }
  const deny = () => { throw new Error('denied') }
  const throwing = { getItem: deny, setItem: deny, removeItem: deny }
  assert.equal(loadState(throwing, AT).state.xp, 0)
  assert.equal(saveState(throwing, loadState(throwing, AT).state), false)
})
