import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRequest, stepGroups, stepMask } from '../../docs/components/kit/sandbox/run.ts'
import {
  laneViews, percent, prepareWave, syncProgress, usage, utilization, waveStates, wavesRun, waveTrace,
} from '../../docs/components/kit/wave-view/model.ts'
import { WAVE_DEMOS } from './fixtures/kit/wave-view-demo.ts'
import { run } from '../../docs/sim/lockstep.ts'

/** 锁步执行视图（S-07）：从事件流算出每一步哪些 lane 在干活、每一行和整段的 lane 利用率、同步处谁在等。 */

const LANGS = ['hip', 'python']
const demo = (value) => WAVE_DEMOS.find((d) => d.value === value)

function runDemo(value, lang, wave = 32) {
  const d = demo(value)
  const launch = { ...d.launch, wave }
  const result = run(buildRequest(d.code[lang], lang, launch, d.args))
  assert.ok(result.ok, `${value} ${lang} wave${wave}`)
  return { result, src: prepareWave(result, launch) }
}

const lanesWith = (lanes, state) => lanes.filter((l) => l.state === state).map((l) => l.lane)
const range = (from, to) => Array.from({ length: to - from }, (_, k) => from + k)

test('分支：if 和 else 两段路径一段接一段执行，每一段空转的正好是没走这条路的 lane', () => {
  for (const lang of LANGS) {
    const { result, src } = runDemo('branch', lang)
    assert.deepEqual(src.steps.map((s) => s.kind), ['stmt', 'branch', 'stmt', 'stmt'], lang)
    const even = range(0, 32).filter((l) => l % 2 === 0)
    const odd = range(0, 32).filter((l) => l % 2 === 1)
    const [then, orelse] = [src.steps[2], src.steps[3]].map((s) => laneViews(src.size, src.block, s.wave, s))
    assert.deepEqual([lanesWith(then, 'active'), lanesWith(then, 'idle')], [even, odd], lang)
    assert.deepEqual([lanesWith(orelse, 'active'), lanesWith(orelse, 'idle')], [odd, even], lang)
    // 两段写的是同一个数组的不同一半：合起来每个线程正好写了一次
    assert.deepEqual(result.arrays.c, range(0, 32).map((t) => (t % 2 === 0 ? t * 2 : t + 0.5)), lang)

    // 手算：32 + 32 + 16 + 16 个 lane 在干活，4 步 × 32 个 lane
    const u = usage(src)
    assert.deepEqual([u.steps, u.active, u.lanes], [4, 96, 128], lang)
    assert.equal(utilization(u), 0.75)
    assert.deepEqual(u.lines.map(utilization), [1, 1, 0.5, 0.5], lang)
  }
})

test('两种写法的同一段演示：每一步的 wave、类别、掩码都一样，只有行号不同；换成 wave64 也一样', () => {
  for (const d of WAVE_DEMOS) {
    for (const wave of [32, 64]) {
      const [hip, py] = LANGS.map((lang) => runDemo(d.value, lang, wave).src)
      const strip = (src) => src.steps.map(({ line, ...rest }) => rest)
      assert.deepEqual(strip(hip), strip(py), `${d.value} wave${wave}`)
      assert.ok(hip.steps.every((s) => s.mask.length === wave))
      assert.deepEqual(usage(hip).lines.map(utilization), usage(py).lines.map(utilization), `${d.value} wave${wave}`)
    }
  }
})

test('lane 利用率的分母是 wave 大小：block 只占半个 wave 时，没有线程的 lane 也算没干活', () => {
  const branch64 = runDemo('branch', 'hip', 64).src
  const lanes = laneViews(branch64.size, branch64.block, 0, branch64.steps[0])
  assert.deepEqual(lanesWith(lanes, 'active'), range(0, 32))
  assert.deepEqual(lanesWith(lanes, 'empty'), range(32, 64))
  assert.ok(lanes.filter((l) => l.state === 'empty').every((l) => l.thread === null))
  // 和 wave32 同样的活，lane 多了一倍：利用率减半
  assert.equal(utilization(usage(branch64)), 0.375)

  // 还没开始：有线程的 lane 待命，没有线程的照样空着；wave 1 的 lane 0 是 threadIdx.x 32
  const idle = laneViews(32, 48, 1, null)
  assert.deepEqual(lanesWith(idle, 'standby'), range(0, 16))
  assert.deepEqual(lanesWith(idle, 'empty'), range(16, 32))
  assert.equal(idle[0].thread, 32)
})

test('一步的 lane 按整条语句算：&& 右边的读只让一部分 lane 做，判断照样是全部 lane', () => {
  const source = `__global__ void k(float* x, int n) {
    int i = threadIdx.x;
    if (i < n && x[i] < 0.0f) {
        x[i] = 0.0f;
    }
}`
  const launch = { grid: 1, block: 8 }
  const result = run(buildRequest(source, 'hip', launch, { x: { type: 'float', data: [1, -2, 3, -4, 5] }, n: { type: 'int', value: 5 } }))
  assert.ok(result.ok)
  const g = stepGroups(result.events)[1]
  // 这一步先记了 5 个 lane 读 x，再记 8 个 lane 的判断
  assert.deepEqual(result.events.slice(g.from, g.to).map((e) => e.op), ['load', 'branch'])
  assert.equal(stepMask(result.events, g), '11111111'.padEnd(32, '0'))
  const src = prepareWave(result, launch)
  assert.deepEqual(src.steps.map((s) => s.active), [8, 8, 2])
  assert.deepEqual(src.steps.map((s) => s.kind), ['stmt', 'branch', 'stmt'])
})

test('同步：先走到的 wave 停下来等，等齐了一起往下走；一组跑完再跑下一组', () => {
  for (const lang of LANGS) {
    const { src } = runDemo('sync', lang)
    const sync = src.steps.find((s) => s.kind === 'barrier').line
    const line = (k) => src.steps[k].line
    // 每个 wave 5 步：t、i、存进共享数组、同步、取回来；wave 0 先跑到同步，wave 1 再跑到同步，然后两个依次取回
    assert.deepEqual(src.steps.map((s) => `${s.block}.${s.wave}`), ['0.0', '0.0', '0.0', '0.0', '0.1', '0.1', '0.1', '0.1', '0.0', '0.1',
      '1.0', '1.0', '1.0', '1.0', '1.1', '1.1', '1.1', '1.1', '1.0', '1.1'])
    const states = (k) => waveStates(src, k).map((s) => [s.status, s.line])
    assert.deepEqual(states(0), [['running', line(0)], ['idle', null]], lang)
    assert.deepEqual(states(3), [['running', sync], ['idle', null]], lang)
    assert.deepEqual(syncProgress(src, 3), { arrived: 1, total: 2 })
    assert.deepEqual(states(5), [['waiting', sync], ['running', line(5)]], lang)
    assert.deepEqual(states(7), [['ready', sync], ['running', sync]], lang)
    assert.deepEqual(syncProgress(src, 7), { arrived: 2, total: 2 })
    assert.deepEqual(states(8), [['running', line(8)], ['ready', sync]], lang)
    assert.deepEqual(states(9), [['done', null], ['running', line(9)]], lang)
    // 第二组从头来过，第一组的进度不带过来
    assert.deepEqual(states(10), [['running', line(10)], ['idle', null]], lang)
    assert.deepEqual(syncProgress(src, 13), { arrived: 1, total: 2 })
    assert.equal(syncProgress(src, 12), null)
    // 同步那一步的 lane 是「走到同步」
    assert.deepEqual(lanesWith(laneViews(src.size, src.block, 0, src.steps[3]), 'sync'), range(0, 32))
    assert.deepEqual(waveStates(src, 5).map((s) => [s.first, s.last]), [[0, 31], [32, 63]])
  }

  // wave64：一组只有一个 wave，走到同步就接着走
  const { src } = runDemo('sync', 'hip', 64)
  const at = src.steps.findIndex((s) => s.kind === 'barrier')
  assert.deepEqual(syncProgress(src, at), { arrived: 1, total: 1 })
  assert.deepEqual(waveStates(src, at).map((s) => s.status), ['running'])
})

test('循环：每一轮干活的 lane 减半；到每一步为止的利用率逐步累加，放到最后和整段一样', () => {
  const { result, src } = runDemo('loop', 'python')
  assert.deepEqual(result.arrays.out, [528])
  const body = src.steps.filter((s) => s.kind === 'stmt' && s.active < 32)
  assert.deepEqual(body.map((s) => s.active), [16, 8, 4, 2, 1, 1])
  const u = usage(src)
  // 手算：32 步里 26 步是整个 wave（864 − 26 × 32 = 32 = 16 + 8 + 4 + 2 + 1 + 1）
  assert.deepEqual([u.steps, u.active, u.lanes], [32, 864, 1024])
  const add = u.lines.find((l) => l.line === body[0].line)
  assert.deepEqual([add.steps, add.active, add.lanes], [5, 31, 160])
  assert.deepEqual(add.kinds, { branch: 0, stmt: 5, barrier: 0 })

  let before = { steps: 0, active: 0, lanes: 0 }
  for (let k = 0; k <= src.steps.length; k++) {
    const part = usage(src, k)
    assert.equal(part.steps, k)
    assert.equal(part.active - before.active, k ? src.steps[k - 1].active : 0)
    assert.equal(part.lanes, k * 32)
    before = part
  }
  assert.deepEqual(usage(src, src.steps.length), u)
  assert.deepEqual(usage(src, 1e9), u)
  // 一个 wave 走过的步：到第 k 步为止
  assert.deepEqual(waveTrace(src, 0, 0, 4).map((s) => s.index), [0, 1, 2, 3, 4])
  assert.equal(waveTrace(src, 0, 0).length, 32)
})

test('打乱 block 的顺序时，wave 按第一次跑的先后列出，每个 wave 的步数不变', () => {
  const d = demo('sync')
  const launch = { ...d.launch, seed: 7 }
  const result = run(buildRequest(d.code.hip, 'hip', launch, d.args))
  assert.ok(result.ok)
  const src = prepareWave(result, launch)
  const order = wavesRun(src)
  assert.deepEqual(order.map((w) => w.block), [result.blockOrder[0], result.blockOrder[0], result.blockOrder[1], result.blockOrder[1]])
  assert.deepEqual(order.map((w) => w.wave), [0, 1, 0, 1])
  assert.ok(order.every((w) => w.steps === 5))
  assert.deepEqual(waveTrace(src, order[3].block, 1).map((s) => s.block), new Array(5).fill(order[3].block))
})

test('程序出错停下：只算出错之前走过的步；一步都没走就是 0', () => {
  const source = `__global__ void f(float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    int k = 10 / (1 - blockIdx.x);
    if (i < n) {
        c[i] = 1.0f;
    }
}`
  const launch = { grid: 2, block: 4 }
  const result = run(buildRequest(source, 'hip', launch, { c: { type: 'float', data: new Array(8).fill(0) }, n: { type: 'int', value: 6 } }))
  assert.equal(result.ok, false)
  const src = prepareWave(result, launch)
  assert.equal(src.complete, false)
  assert.equal(src.errorLine, 3)
  // block 0 走完 4 步；block 1 走完第 2 行，第 3 行除以 0：出错的那一步还没记事件就停下了
  assert.deepEqual(src.steps.map((s) => `${s.block}:${s.line}`), ['0:2', '0:3', '0:4', '0:5', '1:2'])
  assert.equal(usage(src).steps, 5)

  const broken = run(buildRequest('__global__ void f(float* c) {\n    c[0] = \n}', 'hip', launch, { c: { type: 'float', data: [0] } }))
  const none = prepareWave(broken, launch)
  assert.deepEqual([none.steps.length, none.complete], [0, false])
  assert.equal(utilization(usage(none)), 0)
  assert.deepEqual(wavesRun(none), [])
})

test('百分比：整数照写，其余留一位小数；没到 100% 的不写成 100%，不是 0 的不写成 0%', () => {
  assert.deepEqual([1, 0.75, 0.5, 0].map(percent), ['100%', '75%', '50%', '0%'])
  assert.equal(percent(45 / 64), '70.3%')
  assert.equal(percent(0.99996), '99.9%')
  assert.equal(percent(0.000001), '0.1%')
})

test('1024 个线程、上万步：准备一次和每一步算利用率都很快', () => {
  const source = `__global__ void f(const float* a, float* c) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    float s = 0.0f;
    for (int k = 0; k < 200; k++) {
        if (t % 4 == k % 4) {
            s += a[k];
        }
    }
    c[t] = s;
}`
  const launch = { grid: 8, block: 128 }
  const result = run(buildRequest(source, 'hip', launch, { a: { type: 'float', data: new Array(200).fill(1) }, c: { type: 'float', data: new Array(1024).fill(0) } }))
  assert.ok(result.ok)
  const t0 = performance.now()
  const src = prepareWave(result, launch)
  const prepared = performance.now() - t0
  assert.ok(src.steps.length > 15000, `${src.steps.length} 步`)
  let worst = 0
  for (let k = 0; k <= src.steps.length; k += 500) {
    const s0 = performance.now()
    usage(src, k)
    waveStates(src, Math.max(0, k - 1))
    worst = Math.max(worst, performance.now() - s0)
  }
  // 每 4 个 lane 里只有 1 个在加：if 那一行 25%
  const add = usage(src).lines.find((l) => l.kinds.stmt && l.active < l.lanes)
  assert.equal(utilization(add), 0.25)
  // 本机准备 30 ms 左右、每一步 1 ms 以内；放宽很多，只防止写成每一步都从头扫整个事件流那样的慢法
  assert.ok(prepared < 1500 && worst < 100, `准备 ${prepared.toFixed(1)} ms，最慢一步 ${worst.toFixed(1)} ms`)
})
