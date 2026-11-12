import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRequest, stepGroups } from '../../docs/components/kit/sandbox/run.ts'
import {
  accessesInStep, accessesUpTo, arrayCars, carRows, cellRuns, ELEM_OPTIONS, laneFor, layoutAccess, LINE_OPTIONS,
  memoryUsage, prepareMemory, threadVisits,
} from '../../docs/components/kit/memory-view/model.ts'
import { MEM_DEMOS, MEM_SANDBOX } from './fixtures/kit/memory-view-demo.ts'
import { run } from '../../docs/sim/lockstep.ts'
import { analyzeMemory } from '../../docs/sim/memory.ts'
import { SIM_PARAMS } from '../../docs/sim/params.ts'

/** 访存视图（S-08）：一个 wave 每一次读写显存要哪些地址、落在哪几车、搬了几车；和 RobotGrid 联动时一个线程读写过哪些地址。 */

const LANGS = ['hip', 'python']
/** 手算例自己给参数（同 S-03 的单测）：一车 128 字节、元素 4 字节，一车正好装 32 个数 */
const CAR = { lineBytes: 128, elemBytes: 4 }
const seq = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i))
const demo = (value) => MEM_DEMOS.find((d) => d.value === value)

function runDemo(value, lang, stride = 1, options = CAR) {
  const d = demo(value)
  const result = run(buildRequest(d.code[lang], lang, d.launch, d.args(stride)))
  assert.ok(result.ok, `${value} ${lang} 步长 ${stride}`)
  return { result, src: prepareMemory(result, d.launch, options) }
}

const carsOf = (layout) => layout.rows.filter((r) => r.kind === 'car').map((r) => r.car)
const hits = (car) => car.cells.filter((c) => c.state === 'hit')

test('步长 1、2、32：读 x 的车次和 S-03 标准例 2 一样（1、2、32 车，理想都是 1 车），画出来的就是碰到的那几车', () => {
  // S-03 标准例 2（sim-memory.test.mjs）：lane k 读 x[k × s]，在第 ⌊k × s ÷ 32⌋ 车
  for (const lang of LANGS) {
    for (const [stride, lines] of [[1, [0]], [2, [0, 1]], [32, seq(32)]]) {
      const { result, src } = runDemo('stride', lang, stride)
      const [read, write] = src.accesses
      assert.deepEqual([read.op, read.array, write.op, write.array], ['load', 'x', 'store', 'y'])
      assert.deepEqual([read.transactions, read.ideal, read.cacheLines], [lines.length, 1, lines], `${lang} 步长 ${stride}`)
      assert.deepEqual([write.transactions, write.ideal], [1, 1])
      // 视图上的数就是 L3 的 analyzeMemory 算的数
      const l3 = analyzeMemory(result.events, CAR).accesses[0]
      assert.deepEqual(
        [read.event, read.transactions, read.ideal, read.cacheLines, read.efficiency],
        [l3.event, l3.transactions, l3.ideal, l3.cacheLines, l3.efficiency],
      )
      // 汇总表：读 x 那一行多搬的车看得出来，写 y 那一行一车不多
      assert.deepEqual(
        memoryUsage(src).rows.map((r) => [r.op, r.array, r.accesses, r.transactions, r.ideal]),
        [['load', 'x', 1, lines.length, 1], ['store', 'y', 1, 1, 1]],
      )

      const layout = layoutAccess(read, 128, 4)
      const cars = carsOf(layout)
      assert.deepEqual(cars.map((c) => c.line), lines)
      // 每一车平分 32 个 lane；每个 lane 要的那一格在它该在的车里，格子上记着这个线程
      assert.deepEqual(cars.map((c) => hits(c).length), lines.map(() => 32 / lines.length))
      for (const l of read.lanes) {
        const car = cars.find((c) => c.line === Math.floor((l.index * 4) / 128))
        assert.deepEqual(car.cells.find((c) => c.index === l.index).threads, [l.thread])
      }
      // 32 车 × 32 格太多，每一车画成一条
      assert.equal(layout.dense, stride === 32)
    }
  }
})

test('两种写法的同一段演示：每一次访存的地址、车次都一样，只有行号不同；沙盒演示的初始代码读 x 要 2 车', () => {
  for (const d of MEM_DEMOS) {
    for (const stride of d.strided ? [0, 1, 2, 4, 32] : [1]) {
      const [hip, py] = LANGS.map((lang) => runDemo(d.value, lang, stride).src.accesses.map(({ line, ...rest }) => rest))
      assert.deepEqual(hip, py, `${d.value} 步长 ${stride}`)
    }
  }
  for (const lang of LANGS) {
    const result = run(buildRequest(MEM_SANDBOX.code[lang], lang, MEM_SANDBOX.launch, MEM_SANDBOX.args))
    assert.ok(result.ok, lang)
    const read = prepareMemory(result, MEM_SANDBOX.launch, CAR).accesses[0]
    assert.deepEqual([read.array, read.transactions, read.ideal], ['x', 2, 1], lang)
  }
})

test('换元素大小、一车大小只是重新分车：2 字节时步长 2 只要 1 车、一车 64 个数；一车 64 字节时连续 32 个数要 2 车，32 字节要 4 车', () => {
  const read = runDemo('stride', 'hip', 2, { lineBytes: 128, elemBytes: 2 }).src.accesses[0]
  assert.deepEqual([read.transactions, read.ideal], [1, 1])
  const [car] = carsOf(layoutAccess(read, 128, 2))
  assert.equal(car.cells.length, 64)
  assert.deepEqual(hits(car).map((c) => c.index), seq(32, (k) => 2 * k))

  for (const [lineBytes, n] of [[64, 2], [32, 4]]) {
    const r = runDemo('stride', 'python', 1, { lineBytes, elemBytes: 4 }).src.accesses[0]
    assert.deepEqual([r.transactions, r.ideal, r.cacheLines], [n, n, seq(n)])
    assert.deepEqual(carsOf(layoutAccess(r, lineBytes, 4)).map((c) => c.cells.length), new Array(n).fill(lineBytes / 4))
  }

  // 两个开关默认停在参数表的值上；给的组合都能整除，一个元素不会跨两车
  assert.ok(ELEM_OPTIONS.includes(SIM_PARAMS.elemBytes) && LINE_OPTIONS.includes(SIM_PARAMS.lineBytes))
  for (const e of ELEM_OPTIONS) for (const l of LINE_OPTIONS) assert.equal(l % e, 0, `${l} B ÷ ${e} B`)
})

test('向量加法 40 个数、两个 wave：wave 1 只有 8 个 lane 也搬整整一车，后 24 格不是数组的地方；一步里读 a、读 b、写 c 三次', () => {
  const { result, src } = runDemo('add', 'hip')
  assert.deepEqual(src.accesses.map((a) => `${a.wave}:${a.op} ${a.array}`), ['0:load a', '0:load b', '0:store c', '1:load a', '1:load b', '1:store c'])

  const tail = src.accesses[3]
  assert.deepEqual([tail.lanes.length, tail.cacheLines, tail.transactions, tail.ideal], [8, [1], 1, 1])
  // a 一共 160 字节、2 车；wave 1 没碰第 0 车，折成一行
  assert.equal(arrayCars(40, 128, 4), 2)
  const layout = layoutAccess(tail, 128, 4)
  assert.deepEqual(layout.rows.map((r) => r.kind), ['gap', 'car'])
  assert.deepEqual(layout.rows[0], { kind: 'gap', from: 0, to: 0, outside: false })
  const car = layout.rows[1].car
  assert.deepEqual(hits(car).map((c) => [c.index, c.threads]), seq(8, (k) => [32 + k, [32 + k]]))
  assert.deepEqual(car.cells.filter((c) => c.state === 'outside').map((c) => c.index), seq(24, (k) => 40 + k))
  assert.deepEqual([car.used, car.outside, car.oob], [8, 24, 0])
  // 画成一条时的两段：前 8 格要了，后 24 格不是数组的地方
  assert.deepEqual(cellRuns(car.cells), [{ state: 'hit', from: 0, to: 8 }, { state: 'outside', from: 8, to: 32 }])

  // 沙盒单步的一步：wave 0 走到 c[i] = a[i] + b[i] 那一步有三次访存；算 i、判断的两步没有
  const groups = stepGroups(result.events)
  const s = src.accesses[0].step
  assert.equal(groups[s].line, src.accesses[0].line)
  assert.deepEqual(accessesInStep(src, s).map((a) => a.index), [0, 1, 2])
  assert.deepEqual([accessesInStep(src, 0), accessesInStep(src, 1)], [[], []])
  assert.deepEqual([accessesUpTo(src, s - 1), accessesUpTo(src, s), accessesUpTo(src, groups.length - 1)], [0, 3, 6])

  // 汇总：按代码行、读写、数组分组；加起来和 analyzeMemory 的总数一样；只算前 3 次时是 wave 0 的
  const u = memoryUsage(src)
  assert.deepEqual(u.rows.map((r) => [r.op, r.array, r.accesses, r.transactions, r.ideal]), [['load', 'a', 2, 2, 2], ['load', 'b', 2, 2, 2], ['store', 'c', 2, 2, 2]])
  const l3 = analyzeMemory(result.events, CAR).summary
  assert.deepEqual([u.accesses, u.transactions, u.ideal], [6, l3.transactions, l3.ideal])
  assert.deepEqual([memoryUsage(src, 3).accesses, memoryUsage(src, 3).transactions], [3, 3])

  // 只看 b：两次访存重新编号，步还是原来的步；没有读 b 的步里一次也没有
  const onlyB = prepareMemory(result, demo('add').launch, { ...CAR, array: 'b' })
  assert.deepEqual(onlyB.accesses.map((a) => [a.index, a.event, a.step, a.wave]), [1, 4].map((k, i) => [i, src.accesses[k].event, src.accesses[k].step, src.accesses[k].wave]))
  assert.deepEqual(accessesInStep(onlyB, s).map((a) => a.array), ['b'])
  assert.deepEqual([accessesUpTo(onlyB, s), accessesUpTo(onlyB, groups.length - 1)], [1, 2])
  assert.deepEqual(memoryUsage(onlyB).rows.map((r) => r.array), ['b'])
})

test('步长 0（广播）：32 个 lane 都要 x[0]，只算一个数、搬一车，那一格记着全部 32 个线程', () => {
  const read = runDemo('stride', 'python', 0).src.accesses[0]
  assert.deepEqual([read.elements, read.transactions, read.ideal], [1, 1, 1])
  const [car] = carsOf(layoutAccess(read, 128, 4))
  assert.deepEqual(car.cells[0].threads, seq(32))
  assert.deepEqual([car.used, car.cells.filter((c) => c.state === 'miss').length], [1, 31])
})

test('越界：要到数组外面的格子单独标出来，照样算车次；没碰到的车按数组的边界切开', () => {
  const shift = (offset) => `__global__ void shift(const float* x, float* y) {
    int i = threadIdx.x;
    y[i] = x[i + ${offset}];
}`
  const launch = { grid: 1, block: 32 }
  const args = { x: { type: 'float', data: seq(32) }, y: { type: 'float', data: seq(32, () => 0) } }
  // 越界读返回 0、记诊断，程序照样跑完（08 第 4 节）
  const result = run(buildRequest(shift(30), 'hip', launch, args))
  assert.ok(result.ok)
  const read = prepareMemory(result, launch, CAR).accesses[0]
  assert.deepEqual([read.cacheLines, read.transactions, read.ideal], [[0, 1], 2, 1])
  const [inside, beyond] = carsOf(layoutAccess(read, 128, 4))
  assert.deepEqual(hits(inside).map((c) => [c.index, c.threads]), [[30, [0]], [31, [1]]])
  assert.deepEqual(beyond.cells.filter((c) => c.state === 'oob').map((c) => c.threads[0]), seq(30, (k) => k + 2))
  assert.deepEqual([beyond.used, beyond.oob, beyond.outside], [30, 30, 2])

  // 负的下标在第 -1 车：前 2 个 lane 越界，这一车其余 30 格不是数组的地方
  const negSrc = prepareMemory(run(buildRequest(shift(-2), 'hip', launch, args)), launch, CAR)
  const [before] = carsOf(layoutAccess(negSrc.accesses[0], 128, 4))
  assert.deepEqual([before.line, before.oob, before.outside, before.cells[0].index], [-1, 2, 30, -32])
  // 线程 0 要的 x[-2] 也记着在数组外面
  assert.deepEqual(threadVisits(negSrc, { block: 0, thread: 0 }).map((v) => [v.index, v.cars, v.oob]), [[-2, [-1], true], [0, [0], false]])

  const brief = (rows) => rows.map((r) => (r.kind === 'car' ? r.line : `${r.from}..${r.to}${r.outside ? ' 外' : ''}`))
  assert.deepEqual(brief(carRows([3], 8)), ['0..2', 3, '4..7'])
  assert.deepEqual(brief(carRows([0, 5], 2)), [0, '1..1', '2..4 外', 5])
  assert.deepEqual(brief(carRows([-3, 2], 4)), [-3, '-2..-1 外', '0..1', 2, '3..3'])
  assert.deepEqual(brief(carRows([0, 1], 2)), [0, 1])
})

test('选中一个线程：它这一次要哪个地址、它读写过的全部地址；被条件拦下的线程一次也没有', () => {
  const strided = runDemo('stride', 'hip', 2).src
  assert.deepEqual(laneFor(strided.accesses[0], { block: 0, thread: 5 }, 32), { lane: 5, thread: 5, index: 10 })
  assert.deepEqual(
    threadVisits(strided, { block: 0, thread: 5 }).map((v) => [v.access, v.op, v.array, v.index, v.cars, v.oob]),
    [[0, 'load', 'x', 10, [0], false], [1, 'store', 'y', 5, [0], false]],
  )

  const add = runDemo('add', 'python').src
  const t35 = { block: 0, thread: 35 }
  // 线程 35 在 wave 1：wave 0 的访存里没有它，它第一次读写显存是第 3 次访存
  assert.equal(laneFor(add.accesses[0], t35, 32), null)
  assert.deepEqual(threadVisits(add, t35).map((v) => [v.access, v.array, v.index, v.cars]), [[3, 'a', 35, [1]], [4, 'b', 35, [1]], [5, 'c', 35, [1]]])
  // 跟着沙盒单步时只看到这一步为止的访存
  assert.deepEqual(threadVisits(add, t35, 4).map((v) => v.access), [3])
  // 线程 50 也在 wave 1，可是 i = 50 不小于 n = 40，被条件拦下
  assert.equal(laneFor(add.accesses[3], { block: 0, thread: 50 }, 32), null)
  assert.deepEqual(threadVisits(add, { block: 0, thread: 50 }), [])

  // 越界的线程：记着它要到了数组外面
  const launch = { grid: 1, block: 32 }
  const source = `__global__ void f(const float* x, float* y) {
    int i = threadIdx.x;
    y[i] = x[i + 30];
}`
  const oob = prepareMemory(run(buildRequest(source, 'hip', launch, { x: { type: 'float', data: seq(32) }, y: { type: 'float', data: seq(32, () => 0) } })), launch, CAR)
  assert.deepEqual(threadVisits(oob, { block: 0, thread: 3 }).map((v) => [v.index, v.cars, v.oob]), [[33, [1], true], [3, [0], false]])
})

test('程序出错停下：只有出错之前记下的访存；一步都没走就没有访存', () => {
  const source = `__global__ void f(const float* a, float* c) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    c[i] = a[i] / (1 - blockIdx.x);
}`
  const launch = { grid: 2, block: 4 }
  const result = run(buildRequest(source, 'hip', launch, { a: { type: 'float', data: seq(8, (k) => k + 1) }, c: { type: 'float', data: seq(8, () => 0) } }))
  assert.equal(result.ok, false)
  const src = prepareMemory(result, launch, CAR)
  assert.deepEqual([src.complete, src.errorLine], [false, 3])
  // block 0 读 a、写 c；block 1 读了 a，除以 0 停下，没有写 c
  assert.deepEqual(src.accesses.map((a) => `${a.block}:${a.op} ${a.array}`), ['0:load a', '0:store c', '1:load a'])

  const broken = run(buildRequest('__global__ void f(float* c) {\n    c[0] = \n}', 'hip', launch, { c: { type: 'float', data: [0] } }))
  const none = prepareMemory(broken, launch, CAR)
  assert.deepEqual([none.accesses, Array.from(none.stepStart), memoryUsage(none).accesses], [[], [0], 0])
})

test('车多：wave64 步长 32 碰到 64 车，每一车画成一条；只画前 maxCars 车，其余记下没画的车数', () => {
  const d = demo('stride')
  const launch = { grid: 1, block: 64, wave: 64 }
  const result = run(buildRequest(d.code.hip, 'hip', launch, { x: { type: 'float', data: seq(2048) }, y: { type: 'float', data: seq(64, () => 0) }, stride: { type: 'int', value: 32 } }))
  assert.ok(result.ok)
  const read = prepareMemory(result, launch, CAR).accesses[0]
  assert.deepEqual([read.lanes.length, read.transactions, read.ideal], [64, 64, 2])
  const all = layoutAccess(read, 128, 4)
  assert.deepEqual([carsOf(all).length, all.hidden, all.dense], [64, 0, true])
  const capped = layoutAccess(read, 128, 4, 10)
  assert.deepEqual([carsOf(capped).length, capped.hidden], [10, 54])
  assert.deepEqual(carsOf(capped).map((c) => c.line), seq(10))
})

test('1024 个线程、上千次访存：准备一次和每一次分车都很快', () => {
  const source = `__global__ void f(const float* a, float* c) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    float s = 0.0f;
    for (int k = 0; k < 40; k++) {
        s += a[(t * 7 + k * 13) % 1024];
    }
    c[t] = s;
}`
  const launch = { grid: 8, block: 128 }
  const result = run(buildRequest(source, 'hip', launch, { a: { type: 'float', data: new Array(1024).fill(1) }, c: { type: 'float', data: new Array(1024).fill(0) } }))
  assert.ok(result.ok)
  const t0 = performance.now()
  const src = prepareMemory(result, launch)
  const prepared = performance.now() - t0
  // 32 个 wave，每个读 a 40 次、写 c 1 次
  assert.equal(src.accesses.length, 32 * 41)
  let worst = 0
  for (const a of src.accesses) {
    const s0 = performance.now()
    layoutAccess(a, src.lineBytes, src.elemBytes)
    worst = Math.max(worst, performance.now() - s0)
  }
  // 本机准备 7–12 ms，分车平均 0.01 ms、最慢的一次 1 ms 多；放宽很多，只防止写成每一次都从头扫整个事件流那样的慢法
  assert.ok(prepared < 1500 && worst < 100, `准备 ${prepared.toFixed(1)} ms，最慢一次 ${worst.toFixed(1)} ms`)
})
