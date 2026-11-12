import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { analyzeLdsBanks, analyzeMemory } from '../../docs/sim/memory.ts'
import { formatError } from '../../docs/sim/syntax/errors.ts'

const seq = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i))
const floats = (data) => ({ type: 'float', data })
const ints = (data) => ({ type: 'int', data })
const int = (value) => ({ type: 'int', value })

/**
 * 手算例自己给参数，不用参数表的默认值：参数表里的示意值以后可以改，这些例子不受影响。
 * 一车 128 字节、元素 4 字节，一车正好装 32 个数；LDS 32 个 bank，每个 4 字节，第 w 个字在第 w % 32 个 bank。
 */
const CAR = { lineBytes: 128, elemBytes: 4 }
const BANKS = { banks: 32, bankBytes: 4, elemBytes: 4 }

/** 两种写法各跑一次，返回两份事件流。 */
function bothEvents(program, req) {
  return ['hip', 'python'].map((lang) => {
    const r = run({ ...req, lang, source: lang === 'hip' ? program.hip : program.py })
    assert.ok(r.ok, r.ok ? '' : `${lang} 运行出错：${formatError(r.error)}`)
    return r.events
  })
}

/** 显存分析：两种写法的结果逐项相同。返回 HIP 写法的事件流和分析结果。 */
function memory(program, req, options = CAR) {
  const [hip, py] = bothEvents(program, req)
  const report = analyzeMemory(hip, options)
  assert.deepEqual(analyzeMemory(py, options), report)
  return { events: hip, report }
}

/** LDS 分析：两种写法的结果逐项相同。返回 HIP 写法的事件流和分析结果。 */
function banks(program, req, options = BANKS) {
  const [hip, py] = bothEvents(program, req)
  const report = analyzeLdsBanks(hip, options)
  assert.deepEqual(analyzeLdsBanks(py, options), report)
  return { events: hip, report }
}

/** 一次刚好装满一车（或更少）的访存：lanes 个 lane 要 lanes 个不同的数，都在第 line 车。 */
const oneCar = (event, lanes, line) => ({ event, lanes, elements: lanes, cacheLines: [line], transactions: 1, ideal: 1, efficiency: 1 })

// ── 程序 ───────────────────────────────────────────────────────────────

const VECTOR_ADD = {
  hip: `__global__ void vector_add(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        c[i] = a[i] + b[i];
    }
}`,
  py: `@kernel
def vector_add(a, b, c, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        c[i] = a[i] + b[i]`,
}
const vectorAddArgs = (n, block) => ({ grid: 1, block, args: { a: floats(seq(n)), b: floats(seq(n)), c: floats(seq(n, () => 0)), n: int(n) } })

/** 事件：0 算 i；1 读 x[i * stride]；2 写 y[i]。 */
const STRIDED = {
  hip: `__global__ void strided(const float* x, float* y, int stride) {
    int i = threadIdx.x;
    y[i] = x[i * stride];
}`,
  py: `@kernel
def strided(x, y, stride):
    i = threadIdx.x
    y[i] = x[i * stride]`,
}
const stridedArgs = (stride, block = 32) => ({ grid: 1, block, args: { x: floats(seq(1024)), y: floats(seq(block, () => 0)), stride: int(stride) } })

/** 事件：0 算 i；1 读 idx[i]；2 读 x[idx[i]]；3 写 y[i]。 */
const GATHER = {
  hip: `__global__ void gather(const float* x, const int* idx, float* y) {
    int i = threadIdx.x;
    y[i] = x[idx[i]];
}`,
  py: `@kernel
def gather(x, idx, y):
    i = threadIdx.x
    y[i] = x[idx[i]]`,
}
const gatherArgs = (idx) => ({ grid: 1, block: idx.length, args: { x: floats(seq(1024)), idx: ints(idx), y: floats(seq(idx.length, () => 0)) } })

/** 只看访问的位置，共享数组里是什么无所谓。事件：0 算 t；1 读 s[t * stride]（LDS）；2 写 out[t]（显存）。 */
const LDS_READ = {
  hip: `__global__ void lds_read(float* out, int stride) {
    __shared__ float s[1024];
    int t = threadIdx.x;
    out[t] = s[t * stride];
}`,
  py: `@kernel
def lds_read(out, stride):
    s = shared(1024)
    t = threadIdx.x
    out[t] = s[t * stride]`,
}
const ldsArgs = (stride, block = 32) => ({ grid: 1, block, args: { out: floats(seq(block, () => 0)), stride: int(stride) } })

/** 数线程：事件 0 原子加 s[0]（LDS）；1 同步；2 判断；3 线程 0 读 s[0]（LDS）；4 写 out[0]（显存）。 */
const COUNT = {
  hip: `__global__ void count(int* out) {
    __shared__ int s[1];
    atomicAdd(&s[0], 1);
    __syncthreads();
    if (threadIdx.x == 0) {
        out[0] = s[0];
    }
}`,
  py: `@kernel
def count(out):
    s = shared(1)
    atomic_add(s, 0, 1)
    syncthreads()
    if threadIdx.x == 0:
        out[0] = s[0]`,
}

// ── 手算标准例（两种写法） ────────────────────────────────────────────

test('标准例 1 连续访问：向量加法 40 个数、两个 wave，每次访存一车；wave 1 只有 8 个 lane 也要搬整整一车', () => {
  const { events, report } = memory(VECTOR_ADD, vectorAddArgs(40, 64))
  // wave 0 要 a[0 … 31]：字节 0–127，第 0 车；wave 1 要 a[32 … 39]：字节 128–159，第 1 车
  assert.deepEqual([events[2].array, events[2].addrs], ['a', seq(32)])
  assert.deepEqual([events[7].array, events[7].addrs], ['a', seq(8, (i) => 32 + i)])
  assert.deepEqual(report.accesses, [oneCar(2, 32, 0), oneCar(3, 32, 0), oneCar(4, 32, 0), oneCar(7, 8, 1), oneCar(8, 8, 1), oneCar(9, 8, 1)])
  assert.deepEqual(report.summary, { transactions: 6, ideal: 6, efficiency: 1 })
})

test('标准例 2 步长 2 / 4 / 32：读 x 要搬 2 / 4 / 32 车，理想都是 1 车', () => {
  // lane k 读 x[k × s]，在第 ⌊k × s ÷ 32⌋ 车：步长 2 是第 0、1 车，步长 4 是第 0–3 车，步长 32 每个 lane 一车
  for (const [stride, lines] of [
    [2, [0, 1]],
    [4, [0, 1, 2, 3]],
    [32, seq(32)],
  ]) {
    const { events, report } = memory(STRIDED, stridedArgs(stride))
    assert.deepEqual([events[1].array, events[1].addrs], ['x', seq(32, (k) => k * stride)])
    const n = lines.length
    assert.deepEqual(report.accesses, [{ event: 1, lanes: 32, elements: 32, cacheLines: lines, transactions: n, ideal: 1, efficiency: 1 / n }, oneCar(2, 32, 0)])
    // 加上写 y 的 1 车
    assert.deepEqual(report.summary, { transactions: n + 1, ideal: 2, efficiency: 2 / (n + 1) })
  }
})

test('标准例 3 广播：32 个 lane 都读 x[0]，只要 1 个数，搬 1 车', () => {
  const { events, report } = memory(STRIDED, stridedArgs(0))
  assert.deepEqual(events[1].addrs, seq(32, () => 0))
  assert.deepEqual(report.accesses[0], { event: 1, lanes: 32, elements: 1, cacheLines: [0], transactions: 1, ideal: 1, efficiency: 1 })
})

test('标准例 4 随机：8 个 lane 按 idx 取 x，落在 6 车里；同样 8 个数只是打乱顺序，还是 1 车', () => {
  // 一车 32 个数：5、2 在第 0 车，37 在第 1 车，64、70 在第 2 车，129 在第 4 车，300 在第 9 车，1000 在第 31 车
  const scattered = memory(GATHER, gatherArgs([5, 300, 37, 129, 1000, 64, 70, 2]))
  assert.deepEqual(scattered.events[2].addrs, [5, 300, 37, 129, 1000, 64, 70, 2])
  assert.deepEqual(scattered.report.accesses, [
    oneCar(1, 8, 0),
    { event: 2, lanes: 8, elements: 8, cacheLines: [0, 1, 2, 4, 9, 31], transactions: 6, ideal: 1, efficiency: 1 / 6 },
    oneCar(3, 8, 0),
  ])
  // 合并只看碰到哪几车，不看 lane 按什么顺序要
  const shuffled = memory(GATHER, gatherArgs([3, 0, 7, 5, 1, 6, 2, 4]))
  assert.deepEqual(shuffled.report.accesses[1], oneCar(2, 8, 0))
})

test('标准例 5 LDS bank 冲突：步长 1 / 2 / 4 / 32 要 1 / 2 / 4 / 32 轮；补一格（步长 33）和广播都是 1 轮', () => {
  // lane k 要第 k × s 个字，在第 (k × s) % 32 个 bank：
  // 步长 2 只用双数 bank，每个 2 个字；步长 4 用 8 个 bank，每个 4 个字；步长 32 全在 bank 0；
  // 步长 33 的 lane k 正好在 bank k；广播 32 个 lane 要同一个字，只算 1 个请求
  for (const [stride, requests, passes] of [
    [1, 32, 1],
    [2, 32, 2],
    [4, 32, 4],
    [32, 32, 32],
    [33, 32, 1],
    [0, 1, 1],
  ]) {
    const { events, report } = banks(LDS_READ, ldsArgs(stride))
    assert.deepEqual([events[1].space, events[1].addrs], ['lds', seq(32, (k) => k * stride)])
    assert.deepEqual(report.accesses, [{ event: 1, lanes: 32, requests, passes, ideal: 1, efficiency: 1 / passes }])
    // 显存那边只有写 out 这一次；LDS 不算车次
    assert.deepEqual(
      analyzeMemory(events, CAR).accesses.map((a) => a.event),
      [2],
    )
  }
})

test('标准例 6 LDS 原子加：32 个 lane 加同一个字要一个一个来，32 轮；线程 0 读回来 1 轮', () => {
  const { events, report } = banks(COUNT, { grid: 1, block: 32, args: { out: ints([0]) } })
  assert.deepEqual([events[0].op, events[0].addrs], ['atomic', seq(32, () => 0)])
  assert.deepEqual(report.accesses, [
    { event: 0, lanes: 32, requests: 32, passes: 32, ideal: 1, efficiency: 1 / 32 },
    { event: 3, lanes: 1, requests: 1, passes: 1, ideal: 1, efficiency: 1 },
  ])
  assert.deepEqual(report.summary, { passes: 33, ideal: 2, efficiency: 2 / 33 })
})

// ── 参数和边界 ─────────────────────────────────────────────────────────

test('wave64：连续读 64 个数要 2 车、2 轮，理想也是 2；64 个 lane 广播还是 1 个数、1 车、1 轮', () => {
  // a[0 … 63]：256 字节，第 0、1 车；LDS 第 0 … 63 个字，每个 bank 2 个
  const wide = memory(VECTOR_ADD, { ...vectorAddArgs(64, 64), wave: 64 })
  assert.deepEqual(wide.report.accesses[0], { event: 2, lanes: 64, elements: 64, cacheLines: [0, 1], transactions: 2, ideal: 2, efficiency: 1 })
  const wideLds = banks(LDS_READ, { ...ldsArgs(1, 64), wave: 64 })
  assert.deepEqual(wideLds.report.accesses, [{ event: 1, lanes: 64, requests: 64, passes: 2, ideal: 2, efficiency: 1 }])

  // 理想车次、理想轮数按不同的数算，不按 lane 数算
  const broadcast = memory(STRIDED, { ...stridedArgs(0, 64), wave: 64 })
  assert.deepEqual(broadcast.report.accesses[0], { event: 1, lanes: 64, elements: 1, cacheLines: [0], transactions: 1, ideal: 1, efficiency: 1 })
  const broadcastLds = banks(LDS_READ, { ...ldsArgs(0, 64), wave: 64 })
  assert.deepEqual(broadcastLds.report.accesses, [{ event: 1, lanes: 64, requests: 1, passes: 1, ideal: 1, efficiency: 1 }])
})

test('元素和车的大小：元素 2 字节时一车装 64 个数，步长 2 只要 1 车、1 轮；一车 64 字节时 32 个 float 要 2 车', () => {
  // x[2k] 在第 4k、4k + 1 个字节，32 个 lane 都在字节 0–125 里
  const half = memory(STRIDED, stridedArgs(2), { lineBytes: 128, elemBytes: 2 })
  assert.deepEqual(half.report.accesses[0], { event: 1, lanes: 32, elements: 32, cacheLines: [0], transactions: 1, ideal: 1, efficiency: 1 })
  // wave64 连续读 64 个 2 字节的数：128 字节，1 车（4 字节时是 2 车）
  const halfWide = memory(VECTOR_ADD, { ...vectorAddArgs(64, 64), wave: 64 }, { lineBytes: 128, elemBytes: 2 })
  assert.deepEqual(halfWide.report.accesses[0], oneCar(2, 64, 0))
  // LDS 里 lane k 的 s[2k] 正好在第 k 个字、第 k 个 bank
  const halfLds = banks(LDS_READ, ldsArgs(2), { ...BANKS, elemBytes: 2 })
  assert.deepEqual(halfLds.report.accesses, [{ event: 1, lanes: 32, requests: 32, passes: 1, ideal: 1, efficiency: 1 }])

  // 一车 64 字节：连续 32 个 float 是 128 字节，2 车，理想也是 2 车
  const short = memory(STRIDED, stridedArgs(1), { lineBytes: 64, elemBytes: 4 })
  assert.deepEqual(short.report.accesses[0], { event: 1, lanes: 32, elements: 32, cacheLines: [0, 1], transactions: 2, ideal: 2, efficiency: 1 })
})

/** 手写的访存事件：前 addrs.length 个 lane 活跃。 */
const access = (space, addrs, op = 'load') => ({ step: 0, block: 0, wave: 0, line: 1, op, mask: '1'.repeat(addrs.length).padEnd(32, '0'), space, array: 'x', addrs })

test('边界：没对齐的 32 个数跨两车；负的下标在第 -1 车、bank 按余数算；显存的原子加照样算车次；没有访存时效率记 1', () => {
  const events = [
    { step: 0, block: 0, wave: 0, line: 1, op: 'exec', mask: '1'.repeat(32) },
    // x[8 … 39]：字节 32–159，第 0、1 车
    access('global', seq(32, (i) => i + 8)),
    // x[32 … 63]：字节 128–255，正好第 1 车
    access('global', seq(32, (i) => i + 32)),
    // x[-1 … 30]：字节 -4–123，第 -1、0 车
    access('global', seq(32, (i) => i - 1)),
    // 32 个 lane 原子加 x[0]：1 个数，1 车
    access('global', seq(32, () => 0), 'atomic'),
    // 第 -1 个字和第 31 个字都在 bank 31；第 -32 个字在 bank 0
    access('lds', [-1, 31, -32]),
  ]
  assert.deepEqual(analyzeMemory(events, CAR), {
    accesses: [
      { event: 1, lanes: 32, elements: 32, cacheLines: [0, 1], transactions: 2, ideal: 1, efficiency: 0.5 },
      oneCar(2, 32, 1),
      { event: 3, lanes: 32, elements: 32, cacheLines: [-1, 0], transactions: 2, ideal: 1, efficiency: 0.5 },
      { event: 4, lanes: 32, elements: 1, cacheLines: [0], transactions: 1, ideal: 1, efficiency: 1 },
    ],
    summary: { transactions: 6, ideal: 4, efficiency: 4 / 6 },
  })
  assert.deepEqual(analyzeLdsBanks(events, BANKS), {
    accesses: [{ event: 5, lanes: 3, requests: 3, passes: 2, ideal: 1, efficiency: 0.5 }],
    summary: { passes: 2, ideal: 1, efficiency: 0.5 },
  })
  assert.deepEqual(analyzeMemory(events.slice(0, 1), CAR), { accesses: [], summary: { transactions: 0, ideal: 0, efficiency: 1 } })
  assert.deepEqual(analyzeLdsBanks(events.slice(0, 5), BANKS), { accesses: [], summary: { passes: 0, ideal: 0, efficiency: 1 } })
})

test('参数要是正整数，否则抛出 RangeError', () => {
  const events = [access('global', [0]), access('lds', [0])]
  for (const bad of [0, -128, 1.5, Number.NaN]) {
    assert.throws(() => analyzeMemory(events, { lineBytes: bad }), RangeError)
    assert.throws(() => analyzeMemory(events, { elemBytes: bad }), RangeError)
    assert.throws(() => analyzeLdsBanks(events, { banks: bad }), RangeError)
    assert.throws(() => analyzeLdsBanks(events, { bankBytes: bad }), RangeError)
    assert.throws(() => analyzeLdsBanks(events, { elemBytes: bad }), RangeError)
  }
})
