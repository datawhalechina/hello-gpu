import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { prepareWave } from '../../docs/components/kit/wave-view/model.ts'
import {
  BLOCK_DIMS, CHALLENGE_LAUNCH, CHALLENGE_N, GRID_MAX, KERNEL, SPLIT_THREADS, STEP_THREADS, WAVE, WIDE,
  addArgs, judge, normalizeLaunch, seatsAt, splitText, squadReport, squadText, wideLaunch,
} from '../../docs/novice/wavefront/challenge.ts'

/**
 * 1-5 一起行动的小队。工作单写死（1-4 的全局下标 + 边界检查），读者改的是派法：
 * 探索一单步看一个 wave 怎样一起走，探索二看一组怎样排成 wave，挑战按 32 人一队、64 人一队各跑一次判三颗星。
 * 两种写法的同一个派法：事件流（除了行号）、结果和判定都相同。
 */

const LANGS = ['hip', 'python']
const sumOf = (n) => Array.from({ length: n }, (_, k) => 11 * (k + 1))
const fill = (n, value) => new Array(n).fill(value)

/** 两种写法各跑一次 n 对数：结果、步数、事件（只差行号：Python 多一行 @kernel）逐项相同。 */
function runBoth(launch, n) {
  const [hip, python] = LANGS.map((lang) => ({ launch, result: run(buildRequest(KERNEL[lang], lang, launch, addArgs(n))) }))
  const strip = ({ result }) => ({
    ok: result.ok,
    wave: result.wave,
    arrays: result.arrays,
    steps: result.steps,
    events: result.events.map(({ line, ...e }) => e),
  })
  assert.deepEqual(strip(python), strip(hip))
  return { hip, python }
}

/** 挑战点一次「运行」：32 人一队，再同样的派法 64 人一队（wideLaunch）；两种写法判定相同。 */
function challenge(launch) {
  const narrow = runBoth(launch, CHALLENGE_N)
  const wide = runBoth(wideLaunch(launch), CHALLENGE_N)
  const verdict = judge([narrow.hip, wide.hip])
  assert.deepEqual(judge([narrow.python, wide.python]), verdict)
  return { verdict, runs: [narrow.hip, wide.hip] }
}

test('探索一：派 1、8、32 个线程都是 3 步，每一步在岗的线程一起走同一行，空着的工位一直空着', () => {
  for (const t of STEP_THREADS) {
    const { hip, python } = runBoth({ grid: 1, block: t }, t)
    assert.deepEqual(hip.result.arrays.c, sumOf(t))
    for (const [r, lines] of [[hip, [2, 3, 4]], [python, [3, 4, 5]]]) {
      const src = prepareWave(r.result, r.launch)
      assert.deepEqual(src.steps.map((s) => [s.line, s.kind]), [[lines[0], 'stmt'], [lines[1], 'branch'], [lines[2], 'stmt']], `${t} 个线程`)
      for (const s of src.steps) assert.equal(s.mask, '1'.repeat(t) + '0'.repeat(WAVE - t), `${t} 个线程`)
    }
    const src = prepareWave(hip.result, hip.launch)
    // 还没开始：有线程的工位待命，其余没有线程
    assert.deepEqual(seatsAt(src, 0).map((x) => [x.thread, x.state, x.tag]), [
      ...Array.from({ length: t }, (_, k) => [k, 'standby', '']),
      ...fill(WAVE - t, [null, 'empty', '']),
    ])
    // 每一步：在岗的都在干活，脚下写同一件事；写数组那一步各写各的一格
    const tags = [1, 2, 3].map((p) => seatsAt(src, p).filter((x) => x.state === 'active').map((x) => x.tag))
    assert.deepEqual(tags, [fill(t, '计算'), fill(t, '判断'), Array.from({ length: t }, (_, k) => `c[${k}]`)])
    for (let p = 1; p <= 3; p++) {
      assert.ok(seatsAt(src, p).slice(t).every((x) => x.state === 'empty' && x.thread === null && x.tag === ''), `第 ${p} 步`)
    }
  }
})

test('探索二：一组按 threadIdx.x 每 32 个排成一个 wave，最后一个坐不满也要走完 3 步', () => {
  const members = { 32: [32], 33: [32, 1], 40: [32, 8], 64: [32, 32] }
  for (const t of SPLIT_THREADS) {
    const { hip } = runBoth({ grid: 1, block: t }, t)
    assert.deepEqual(hip.result.arrays.c, sumOf(t))
    const report = squadReport(hip, t)
    assert.deepEqual(report.squads.map((s) => [s.wave, s.first, s.members, s.work, s.steps]),
      members[t].map((m, w) => [w, w * WAVE, m, m, 3]), `${t} 个线程`)
    assert.deepEqual([report.idle, report.empty], [0, members[t].length * WAVE - t], `${t} 个线程`)
    const last = report.squads.at(-1)
    assert.deepEqual(last.seats, [...fill(last.members, 'work'), ...fill(WAVE - last.members, 'empty')])
  }
  const text = (t) => splitText(squadReport(runBoth({ grid: 1, block: t }, t).hip, t))
  assert.equal(text(40), '40 个线程排成 2 支小队：第 0 支 32 人；第 1 支 8 人，空着 24 个工位。每支小队都走了 3 步。')
  assert.equal(text(33), '33 个线程排成 2 支小队：第 0 支 32 人；第 1 支 1 人，空着 31 个工位。每支小队都走了 3 步。')
  assert.equal(text(32), '32 个线程正好坐满 1 支小队。这支小队走了 3 步。')
})

test('挑战 ★1：线程不够时一颗星都没有，说清哪几格没人算、至少要派几组', () => {
  const { verdict, runs } = challenge({ grid: 2, block: 48 })
  assert.deepEqual(verdict.earned, [false, false, false])
  assert.equal(verdict.error.symptom, '32 个数没人算：c[96]～c[127]。')
  assert.equal(verdict.error.cause, '一共只派出 96 个线程（2 组 × 每组 48 个），比 128 个数少。')
  assert.equal(verdict.error.fix, '组数要向上取整：每组 48 个，至少要派 3 组。')
  assert.equal(verdict.error.raw, `运行后 c = [${runs[0].result.arrays.c.join(', ')}]`)
  // 小队板照样画出来：线程不够时不说「正好最少」
  assert.equal(squadText(squadReport(runs[0], CHALLENGE_N), runs[0].launch),
    '32 人一队：排成 4 支小队；每组 48 个线程，每组最后一支只坐了 16 人，2 支没坐满的小队一共空着 32 个工位。')
})

/** 小队板上那一句（squadText）：这一次的派法排成了什么样。 */
const boardText = (r) => squadText(squadReport(r, CHALLENGE_N), r.launch)

test('挑战 ★2：默认派法算对了，可有坐不满的 wave，还有一个数也没算的 wave', () => {
  const start = challenge(CHALLENGE_LAUNCH)
  assert.deepEqual(start.verdict.earned, [true, false, false])
  assert.deepEqual(start.runs[0].result.arrays.c, sumOf(CHALLENGE_N))
  const narrow = squadReport(start.runs[0], CHALLENGE_N)
  assert.deepEqual(narrow.squads.map((s) => [s.block, s.wave, s.members, s.work]), [
    [0, 0, 32, 32], [0, 1, 16, 16], [1, 0, 32, 32], [1, 1, 16, 16], [2, 0, 32, 32], [2, 1, 16, 0],
  ])
  assert.deepEqual([narrow.fewest, narrow.partial, narrow.empty, narrow.idle], [4, 3, 48, 1])
  // 整队都被 if (i < n) 拦下的 wave 也走了两步（算 i、判断），只是写数那一行不用走
  assert.deepEqual(narrow.squads.map((s) => s.steps), [3, 3, 3, 3, 3, 2])
  // 下一步只说怎么改；哪几支没坐满、哪一支没算数，写在小队板上
  assert.equal(start.verdict.next, '32 人一队排成了 6 支小队，最少只要 4 支：每组线程数取 32 的整数倍，组数取刚好够用。')
  assert.equal(boardText(start.runs[0]), '32 人一队：排成 6 支小队，最少只要 4 支；每组 48 个线程，每组最后一支只坐了 16 人，'
    + '3 支没坐满的小队一共空着 48 个工位；有 1 支小队的线程全被 if (i < n) 拦下，一个数也没算，照样占着流水线。')

  // 多派了一组：wave 都坐满，可多出来的那个一个数也没算，改法只说组数
  const extra = challenge({ grid: 5, block: 32 })
  assert.deepEqual(extra.verdict.earned, [true, false, false])
  assert.equal(extra.verdict.next, '32 人一队排成了 5 支小队，最少只要 4 支：组数取刚好够用。')
  assert.equal(boardText(extra.runs[0]), '32 人一队：排成 5 支小队，最少只要 4 支；有 1 支小队的线程全被 if (i < n) 拦下，一个数也没算，照样占着流水线。')
  // 每组不到 32 个：一个 wave 也坐不满，改法只说每组线程数
  const small = challenge({ grid: 8, block: 16 })
  assert.deepEqual(small.verdict.earned, [true, false, false])
  assert.equal(small.verdict.next, '32 人一队排成了 8 支小队，最少只要 4 支：每组线程数取 32 的整数倍。')
  assert.match(boardText(small.runs[0]), /每组只有 16 个线程，坐不满一支，8 支没坐满的小队一共空着 128 个工位/)
})

test('挑战 ★3：真的按 64 人一队再跑一次；每组 32 个时 64 人一队只坐一半', () => {
  const four = challenge({ grid: 4, block: 32 })
  assert.deepEqual(four.runs.map((r) => [r.launch, r.result.wave]), [[{ grid: 4, block: 32 }, WAVE], [{ grid: 4, block: 32, wave: WIDE }, WIDE]])
  assert.deepEqual(four.verdict.earned, [true, true, false])
  assert.equal(four.verdict.next, '32 人一队已经最少了。64 人一队排成了 4 支小队，最少只要 2 支：每组线程数取 64 的整数倍。')
  assert.equal(boardText(four.runs[0]), '32 人一队：排成 4 支小队，正好最少，每支都坐满。')
  assert.equal(boardText(four.runs[1]), '64 人一队：排成 4 支小队，最少只要 2 支；每组只有 32 个线程，坐不满一支，4 支没坐满的小队一共空着 128 个工位。')
  // 没有 64 人一队那一次，判不了 ★3
  assert.deepEqual(judge(four.runs.slice(0, 1)).earned, [true, true, false])
  for (const launch of [{ grid: 2, block: 64 }, { grid: 1, block: 128 }]) {
    const { verdict, runs } = challenge(launch)
    assert.deepEqual(verdict.earned, [true, true, true], JSON.stringify(launch))
    assert.deepEqual(runs.map((r) => squadReport(r, CHALLENGE_N).squads.map((s) => s.members)), [fill(4, 32), fill(2, 64)])
    assert.equal(verdict.next, '32 人一队排成 4 支，64 人一队排成 2 支，每支都坐满。三颗星的标准都达到了。')
  }
})

test('挑战：所有派法里，线程够就有 ★1，只有 4 组 × 32 个到 ★2，只有 2 组 × 64 个、1 组 × 128 个拿满三颗星', () => {
  const reached = { 2: [], 3: [] }
  for (const block of BLOCK_DIMS) {
    for (let grid = 1; grid <= GRID_MAX; grid++) {
      const { earned } = challenge({ grid, block }).verdict
      assert.equal(earned[0], grid * block >= CHALLENGE_N, `${grid} 组 × ${block}`)
      const stars = earned.filter(Boolean).length
      if (stars >= 2) reached[stars].push(`${grid}×${block}`)
    }
  }
  assert.deepEqual(reached, { 2: ['4×32'], 3: ['2×64', '1×128'] })
})

test('两种写法的工作单解析成同一棵语法树（除了位置）', () => {
  const strip = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  const hip = parseKernel(KERNEL.hip, 'hip')
  const python = parseKernel(KERNEL.python, 'python')
  assert.equal(hip.ok && python.ok, true)
  assert.deepEqual(strip(python.kernel), strip(hip.kernel))
})

test('草稿里的派法坏了或是旧的：坏的那一项回到默认值', () => {
  assert.deepEqual(normalizeLaunch({ grid: 2, block: 64 }), { grid: 2, block: 64 })
  for (const raw of [undefined, null, 'x', { grid: 0, block: 99 }, { grid: 2.5 }, { grid: '2', block: '64' }]) {
    assert.deepEqual(normalizeLaunch(raw), CHALLENGE_LAUNCH, JSON.stringify(raw))
  }
  assert.deepEqual(normalizeLaunch({ grid: GRID_MAX + 1, block: 64 }), { grid: CHALLENGE_LAUNCH.grid, block: 64 })
  assert.deepEqual(normalizeLaunch({ grid: 2, block: 4 }), { grid: 2, block: CHALLENGE_LAUNCH.block })
})
