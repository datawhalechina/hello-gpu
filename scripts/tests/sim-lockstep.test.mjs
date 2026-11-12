import assert from 'node:assert/strict'
import test from 'node:test'
import { RUN_LIMITS, run } from '../../docs/sim/lockstep.ts'
import { formatError } from '../../docs/sim/syntax/errors.ts'

const seq = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i))
const floats = (data) => ({ type: 'float', data })
const ints = (data) => ({ type: 'int', data })
const int = (value) => ({ type: 'int', value })
/** 掩码：前面几位照写，后面补 0 到 wave 大小。 */
const mask = (bits, size = 32) => bits.padEnd(size, '0')
const ones = (n, size = 32) => mask('1'.repeat(n), size)

/** 每次运行都要满足的事件格式（08 第 5 节）：掩码长度 = wave 大小，访存事件每个活跃 lane 一个下标，步号不倒退。 */
function checkEvents(r) {
  let last = -1
  for (const e of r.events) {
    assert.equal(e.mask.length, r.wave)
    assert.match(e.mask, /^[01]+$/)
    assert.ok(e.step >= last, '步号不能倒退')
    last = e.step
    const memory = e.op === 'load' || e.op === 'store' || e.op === 'atomic'
    assert.equal(e.addrs?.length, memory ? e.mask.split('1').length - 1 : undefined)
    if (memory) assert.ok(e.space === 'global' || e.space === 'lds')
  }
}

function ok(req) {
  const r = run(req)
  assert.ok(r.ok, r.ok ? '' : `${req.lang} 运行出错：${formatError(r.error)}\n${req.source}`)
  checkEvents(r)
  return r
}

function failed(req) {
  const r = run(req)
  assert.equal(r.ok, false, `应当出错：\n${req.source}`)
  checkEvents(r)
  return r
}

/** 两种写法的位置必然不同，比较时去掉所有行号。 */
const withoutLines = (r) => JSON.parse(JSON.stringify(r, (key, value) => (key === 'line' ? undefined : value)))

/** 两种写法跑同一个程序：结果、诊断、事件流除了行号逐项相同，行号一一对应。返回 HIP 写法的结果。 */
function bothWritings(program, req) {
  const hip = ok({ ...req, source: program.hip, lang: 'hip' })
  const py = ok({ ...req, source: program.py, lang: 'python' })
  assert.deepEqual(withoutLines(py), withoutLines(hip))
  const lines = new Map()
  hip.events.forEach((e, i) => {
    if (!lines.has(e.line)) lines.set(e.line, py.events[i].line)
    assert.equal(py.events[i].line, lines.get(e.line), `HIP 第 ${e.line} 行对应 Python 的不同行`)
  })
  assert.equal(new Set(lines.values()).size, lines.size)
  return hip
}

/** 事件流的简写：「步号:wave:行号:操作」。 */
const brief = (events) => events.map((e) => `${e.step}:${e.wave}:${e.line}:${e.op}`).join(' ')

// ── 五个手算标准例（两种写法） ────────────────────────────────────────

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

const EVEN_ODD = {
  hip: `__global__ void even_odd(float* a, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        if (threadIdx.x % 2 == 0) {
            a[i] = a[i] * 2;
        } else {
            a[i] = a[i] + 1;
        }
    }
}`,
  py: `@kernel
def even_odd(a, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        if threadIdx.x % 2 == 0:
            a[i] = a[i] * 2
        else:
            a[i] = a[i] + 1`,
}

const reverse = (sync) => ({
  hip: `__global__ void reverse_block(const float* a, float* b) {
    __shared__ float tile[64];
    int t = threadIdx.x;
    int i = blockIdx.x * blockDim.x + t;
    tile[t] = a[i];
${sync ? '    __syncthreads();\n' : ''}    b[i] = tile[blockDim.x - 1 - t];
}`,
  py: `@kernel
def reverse_block(a, b):
    tile = shared(64)
    t = threadIdx.x
    i = blockIdx.x * blockDim.x + t
    tile[t] = a[i]
${sync ? '    syncthreads()\n' : ''}    b[i] = tile[blockDim.x - 1 - t]`,
})

const BLOCK_SUM = {
  hip: `__global__ void block_sum(const float* a, float* out) {
    __shared__ float s[64];
    int t = threadIdx.x;
    s[t] = a[blockIdx.x * blockDim.x + t];
    __syncthreads();
    int stride = blockDim.x / 2;
    while (stride > 0) {
        if (t < stride) {
            s[t] += s[t + stride];
        }
        __syncthreads();
        stride /= 2;
    }
    if (t == 0) {
        out[blockIdx.x] = s[0];
    }
}`,
  py: `@kernel
def block_sum(a, out):
    s = shared(64)
    t = threadIdx.x
    s[t] = a[blockIdx.x * blockDim.x + t]
    syncthreads()
    stride = blockDim.x // 2
    while stride > 0:
        if t < stride:
            s[t] += s[t + stride]
        syncthreads()
        stride //= 2
    if t == 0:
        out[blockIdx.x] = s[0]`,
}

const REVERSE_ARGS = { a: floats(seq(64, (i) => i + 1)), b: floats(seq(64, () => 0)) }

test('标准例 1 向量加法：2 个 block × 4 个线程算 6 个数，越过 n 的 2 个线程在 if 里空转', () => {
  const r = bothWritings(VECTOR_ADD, {
    grid: 2,
    block: 4,
    args: { a: floats([0, 1, 2, 3, 4, 5]), b: floats([10, 20, 30, 40, 50, 60]), c: floats(seq(6, () => 0)), n: int(6) },
  })
  assert.deepEqual(r.arrays.c, [10, 21, 32, 43, 54, 65])
  const all = ones(4)
  const two = ones(2)
  const mem = (step, block, op, array, m, addrs) => ({ step, block, wave: 0, line: 4, op, mask: m, space: 'global', array, addrs })
  assert.deepEqual(r.events, [
    { step: 0, block: 0, wave: 0, line: 2, op: 'exec', mask: all },
    { step: 1, block: 0, wave: 0, line: 3, op: 'branch', mask: all },
    mem(2, 0, 'load', 'a', all, [0, 1, 2, 3]),
    mem(2, 0, 'load', 'b', all, [0, 1, 2, 3]),
    mem(2, 0, 'store', 'c', all, [0, 1, 2, 3]),
    { step: 3, block: 1, wave: 0, line: 2, op: 'exec', mask: all },
    { step: 4, block: 1, wave: 0, line: 3, op: 'branch', mask: all },
    mem(5, 1, 'load', 'a', two, [4, 5]),
    mem(5, 1, 'load', 'b', two, [4, 5]),
    mem(5, 1, 'store', 'c', two, [4, 5]),
  ])
  assert.deepEqual([r.steps, r.blockOrder, r.diagnostics, r.outside], [6, [0, 1], [], []])
})

test('标准例 2 带分支：偶数 lane 先走 then，奇数 lane 再走 else，两段都记事件', () => {
  const r = bothWritings(EVEN_ODD, { grid: 1, block: 8, args: { a: floats(seq(8)), n: int(8) } })
  assert.deepEqual(r.arrays.a, [0, 2, 4, 4, 8, 6, 12, 8])
  const all = ones(8)
  const even = mask('10101010')
  const odd = mask('01010101')
  assert.deepEqual(r.events, [
    { step: 0, block: 0, wave: 0, line: 2, op: 'exec', mask: all },
    { step: 1, block: 0, wave: 0, line: 3, op: 'branch', mask: all },
    { step: 2, block: 0, wave: 0, line: 4, op: 'branch', mask: all },
    { step: 3, block: 0, wave: 0, line: 5, op: 'load', mask: even, space: 'global', array: 'a', addrs: [0, 2, 4, 6] },
    { step: 3, block: 0, wave: 0, line: 5, op: 'store', mask: even, space: 'global', array: 'a', addrs: [0, 2, 4, 6] },
    { step: 4, block: 0, wave: 0, line: 7, op: 'load', mask: odd, space: 'global', array: 'a', addrs: [1, 3, 5, 7] },
    { step: 4, block: 0, wave: 0, line: 7, op: 'store', mask: odd, space: 'global', array: 'a', addrs: [1, 3, 5, 7] },
  ])
})

test('标准例 3 块内反转 + 同步：两个 wave 都到齐同步才往下走，结果正确、没有竞争', () => {
  const r = bothWritings(reverse(true), { grid: 1, block: 64, args: REVERSE_ARGS })
  assert.deepEqual(r.arrays.b, seq(64, (i) => 64 - i))
  assert.equal(
    brief(r.events),
    '0:0:3:exec 1:0:4:exec 2:0:5:load 2:0:5:store 3:0:6:barrier ' +
      '4:1:3:exec 5:1:4:exec 6:1:5:load 6:1:5:store 7:1:6:barrier ' +
      '8:0:7:load 8:0:7:store 9:1:7:load 9:1:7:store',
  )
  const read = r.events.find((e) => e.op === 'load' && e.array === 'tile' && e.wave === 0)
  assert.deepEqual([read.space, read.addrs], ['lds', seq(32, (i) => 63 - i)])
  assert.deepEqual(r.diagnostics, [])
})

test('标准例 4 去掉同步：wave 0 读到还没写的 0，wave 1 读到 wave 0 写的值；每个元素记一条读-写竞争', () => {
  const r = bothWritings(reverse(false), { grid: 1, block: 64, args: REVERSE_ARGS })
  assert.deepEqual(r.arrays.b, [...seq(32, () => 0), ...seq(32, (i) => 32 - i)])
  assert.equal(r.diagnostics.length, 64)
  // wave 0 第 6 行（b[i] = tile[…]）先读了 tile[32 … 63]，wave 1 第 5 行（tile[t] = a[i]）再写
  assert.deepEqual(r.diagnostics[0], {
    kind: 'race',
    scope: 'block',
    conflict: 'read-write',
    space: 'lds',
    array: 'tile',
    index: 32,
    first: { block: 0, thread: 31, line: 6, step: 3, op: 'read' },
    second: { block: 0, thread: 32, line: 5, step: 6, op: 'write' },
  })
  // wave 0 先写了 tile[0 … 31]，wave 1 再读
  assert.deepEqual(r.diagnostics[32].first, { block: 0, thread: 31, line: 5, step: 2, op: 'write' })
  assert.deepEqual(r.diagnostics[32].second, { block: 0, thread: 32, line: 6, step: 7, op: 'read' })
  assert.deepEqual(new Set(r.diagnostics.map((d) => d.index)), new Set(seq(64)))
})

test('标准例 5 树状归约：每轮 then 的掩码减半，wave 1 从不进入；两个 block 各自求和', () => {
  const r = bothWritings(BLOCK_SUM, { grid: 2, block: 64, args: { a: floats(seq(128, (i) => i + 1)), out: floats([0, 0]) } })
  assert.deepEqual(r.arrays.out, [2080, 6176])
  assert.deepEqual(r.diagnostics, [])
  for (const block of [0, 1]) {
    const adds = r.events.filter((e) => e.block === block && e.line === 9 && e.op === 'store')
    assert.deepEqual(adds.map((e) => e.wave), [0, 0, 0, 0, 0, 0])
    assert.deepEqual(adds.map((e) => e.mask), [ones(32), ones(16), ones(8), ones(4), ones(2), ones(1)])
  }
  // 每个 wave 过 7 次同步：开头 1 次，循环 6 轮
  assert.equal(r.events.filter((e) => e.op === 'barrier').length, 2 * 2 * 7)
})

test('同样的程序、数据和种子，事件流逐项相同', () => {
  for (const [program, args] of [
    [VECTOR_ADD, { a: floats(seq(100)), b: floats(seq(100)), c: floats(seq(100, () => 0)), n: int(100) }],
    [reverse(false), { a: floats(seq(128)), b: floats(seq(128, () => 0)) }],
    [BLOCK_SUM, { a: floats(seq(128)), out: floats([0, 0]) }],
  ]) {
    for (const lang of ['hip', 'python']) {
      const req = { source: lang === 'hip' ? program.hip : program.py, lang, grid: 2, block: 64, seed: 7, args }
      assert.deepEqual(run(req), run(req))
    }
  }
})

// ── 08 第 4 节的每条规则 ──────────────────────────────────────────────

const STORE_TID = { hip: '__global__ void k(int* a) {\n    a[threadIdx.x] = threadIdx.x;\n}', py: '@kernel\ndef k(a):\n    a[threadIdx.x] = threadIdx.x' }

test('§4 wave 切分：按 threadIdx.x 顺序切，默认 wave32，可以换成 wave64；不满的 wave 后面空着', () => {
  const args = { a: ints(seq(40, () => -1)) }
  const w32 = bothWritings(STORE_TID, { grid: 1, block: 40, args })
  assert.deepEqual(
    w32.events.map((e) => [e.wave, e.mask, e.addrs]),
    [
      [0, ones(32), seq(32)],
      [1, ones(8), seq(8, (i) => 32 + i)],
    ],
  )
  const w64 = bothWritings(STORE_TID, { grid: 1, block: 40, wave: 64, args })
  assert.deepEqual(w64.events.map((e) => [e.wave, e.mask]), [[0, ones(40, 64)]])
  assert.equal(w64.wave, 64)
  assert.deepEqual(w64.arrays.a, seq(40))
})

test('§4 锁步：一条语句所有 lane 先读完再一起写，a[t + 1] = a[t] 是整体右移而不是连锁复制', () => {
  const program = {
    hip: '__global__ void shift(int* a) {\n    int t = threadIdx.x;\n    a[t + 1] = a[t];\n}',
    py: '@kernel\ndef shift(a):\n    t = threadIdx.x\n    a[t + 1] = a[t]',
  }
  const r = bothWritings(program, { grid: 1, block: 8, args: { a: ints(seq(9, (i) => i + 1)) } })
  assert.deepEqual(r.arrays.a, [1, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(r.events.map((e) => [e.step, e.op]), [[0, 'exec'], [1, 'load'], [1, 'store']])
  // 同一段里线程 t + 1 读、线程 t 写同一个元素：7 条读-写竞争
  assert.equal(r.diagnostics.length, 7)
  assert.deepEqual(r.diagnostics[0].first, { block: 0, thread: 1, line: 3, step: 1, op: 'read' })
  assert.deepEqual(r.diagnostics[0].second, { block: 0, thread: 0, line: 3, step: 1, op: 'write' })
})

test('§4 if：一个 lane 都不走的那一段整段跳过；&& 右边只让左边成立的 lane 去算，不会越界读', () => {
  const uniform = {
    hip: '__global__ void k(int* a) {\n    if (blockDim.x > 4) {\n        a[threadIdx.x] = 1;\n    } else {\n        a[threadIdx.x] = 2;\n    }\n}',
    py: '@kernel\ndef k(a):\n    if blockDim.x > 4:\n        a[threadIdx.x] = 1\n    else:\n        a[threadIdx.x] = 2',
  }
  const r = bothWritings(uniform, { grid: 1, block: 8, args: { a: ints(seq(8, () => 0)) } })
  assert.deepEqual(r.events.map((e) => [e.op, e.line]), [['branch', 2], ['store', 3]])

  const guarded = {
    hip: '__global__ void k(const int* a, int* b, int n) {\n    int i = threadIdx.x;\n    if (i < n && a[i] > 0) {\n        b[i] = 1;\n    }\n}',
    py: '@kernel\ndef k(a, b, n):\n    i = threadIdx.x\n    if i < n and a[i] > 0:\n        b[i] = 1',
  }
  const g = bothWritings(guarded, { grid: 1, block: 8, args: { a: ints([5, 0, 7, -1]), b: ints([0, 0, 0, 0]), n: int(4) } })
  assert.deepEqual(g.arrays.b, [1, 0, 1, 0])
  assert.deepEqual(g.diagnostics, [])
  const load = g.events.find((e) => e.op === 'load')
  assert.deepEqual([load.mask, load.addrs], [ones(4), [0, 1, 2, 3]])
})

test('§4 循环：每个 lane 单独判断，掩码逐轮收缩，所有 lane 都退出才结束', () => {
  const counting = {
    hip: '__global__ void k(int* a) {\n    int t = threadIdx.x;\n    for (int k = 0; k < t; k++) {\n        a[t] += 1;\n    }\n}',
    py: '@kernel\ndef k(a):\n    t = threadIdx.x\n    for k in range(t):\n        a[t] += 1',
  }
  const r = bothWritings(counting, { grid: 1, block: 4, args: { a: ints([0, 0, 0, 0]) } })
  assert.deepEqual(r.arrays.a, [0, 1, 2, 3])
  const masks = r.events.filter((e) => e.op !== 'load').map((e) => `${e.op} ${e.mask.slice(0, 4)}`)
  assert.deepEqual(masks, ['exec 1111', 'branch 1111', 'store 0111', 'branch 0111', 'store 0011', 'branch 0011', 'store 0001', 'branch 0001'])

  const halving = {
    hip: '__global__ void k(int* steps) {\n    int v = threadIdx.x;\n    while (v > 0) {\n        v /= 2;\n        steps[threadIdx.x] += 1;\n    }\n}',
    py: '@kernel\ndef k(steps):\n    v = threadIdx.x\n    while v > 0:\n        v //= 2\n        steps[threadIdx.x] += 1',
  }
  const h = bothWritings(halving, { grid: 1, block: 8, args: { steps: ints(seq(8, () => 0)) } })
  assert.deepEqual(h.arrays.steps, [0, 1, 2, 2, 3, 3, 3, 3])
  // v 依次是 0 … 7：第一轮后 lane 2–7 还剩 1、1、2、2、3、3，第二轮后 lane 4–7 还剩 1
  const tests = h.events.filter((e) => e.op === 'branch').map((e) => e.mask.slice(0, 8))
  assert.deepEqual(tests, ['11111111', '01111111', '00111111', '00001111'])
})

const syncIn = (cond) => ({
  hip: `__global__ void k(float* a) {\n    if (${cond}) {\n        __syncthreads();\n    }\n    a[threadIdx.x] = 1;\n}`,
  py: `@kernel\ndef k(a):\n    if ${cond}:\n        syncthreads()\n    a[threadIdx.x] = 1`,
})

test('§4 同步：在分支里同步，只有部分线程到达时报运行时错误；整个 block 走同一条路时可以', () => {
  const args = { a: floats(seq(64, () => 0)) }
  for (const [cond, block, pattern] of [
    // 同一个 wave 里分开了
    ['threadIdx.x < 16', 32, /只有线程 0–15 到达，同一个 wave 的线程 16–31 走了另一条路/],
    // 一个 wave 到了，另一个 wave 没经过就运行完了
    ['threadIdx.x < 32', 64, /只有线程 0–31 到达，线程 32–63 没有经过这里就运行完了/],
  ]) {
    for (const [lang, line] of [['hip', 3], ['python', 4]]) {
      const p = syncIn(cond)
      const r = failed({ source: lang === 'hip' ? p.hip : p.py, lang, grid: 1, block, args })
      assert.deepEqual([r.error.kind, r.error.line, r.error.col], ['runtime', line, 9], formatError(r.error))
      assert.match(r.error.message, /^在分支里同步：/)
      assert.match(r.error.message, pattern)
      assert.ok(r.events.some((e) => e.op === 'barrier'))
    }
  }
  const twoSyncs = '__global__ void k(float* a) {\n    if (threadIdx.x < 32) {\n        __syncthreads();\n    } else {\n        __syncthreads();\n    }\n}'
  const r = failed({ source: twoSyncs, lang: 'hip', grid: 1, block: 64, args })
  assert.match(r.error.message, /线程 0–31 停在第 3 行的同步，线程 32–63 停在第 5 行的同步/)

  const fine = bothWritings(syncIn('blockDim.x == 64'), { grid: 1, block: 64, args })
  assert.deepEqual(fine.events.filter((e) => e.op === 'barrier').map((e) => [e.wave, e.mask]), [[0, ones(32)], [1, ones(32)]])
})

test('§4 数据竞争：写-写、block 之间的冲突都记；原子加之间不算，普通读写会丢掉更新', () => {
  const lastWriter = {
    hip: '__global__ void k(int* out) {\n    out[0] = blockIdx.x * 10 + threadIdx.x;\n}',
    py: '@kernel\ndef k(out):\n    out[0] = blockIdx.x * 10 + threadIdx.x',
  }
  const w = bothWritings(lastWriter, { grid: 2, block: 2, args: { out: ints([0]) } })
  assert.deepEqual(w.arrays.out, [11])
  const at = (block, thread, step) => ({ block, thread, line: 2, step, op: 'write' })
  const race = (scope, first, second) => ({ kind: 'race', scope, conflict: 'write-write', space: 'global', array: 'out', index: 0, first, second })
  assert.deepEqual(w.diagnostics, [race('block', at(0, 0, 0), at(0, 1, 0)), race('grid', at(0, 0, 0), at(1, 0, 1)), race('block', at(1, 0, 1), at(1, 1, 1))])

  const sum = (atomic) => ({
    hip: `__global__ void k(const float* a, float* total) {\n    int i = blockIdx.x * blockDim.x + threadIdx.x;\n    ${atomic ? 'atomicAdd(&total[0], a[i]);' : 'total[0] += a[i];'}\n}`,
    py: `@kernel\ndef k(a, total):\n    i = blockIdx.x * blockDim.x + threadIdx.x\n    ${atomic ? 'atomic_add(total, 0, a[i])' : 'total[0] += a[i]'}`,
  })
  const args = { a: floats(seq(8, (i) => i + 1)), total: floats([0]) }
  const good = bothWritings(sum(true), { grid: 2, block: 4, args })
  assert.deepEqual([good.arrays.total, good.diagnostics], [[36], []])
  assert.deepEqual(good.events.filter((e) => e.op === 'atomic').map((e) => e.addrs), [[0, 0, 0, 0], [0, 0, 0, 0]])
  // 一个 wave 的 4 个线程同时读到同一个旧值，最后一个 lane 写的留下：0 + 4，再 4 + 8
  const bad = bothWritings(sum(false), { grid: 2, block: 4, args })
  assert.deepEqual(bad.arrays.total, [12])
  assert.deepEqual(new Set(bad.diagnostics.map((d) => `${d.scope} ${d.conflict}`)), new Set(['block read-write', 'grid read-write']))
})

test('§4 越界：越界读得到 0 并记 oob-read；越界写不改数组，记进越界区（共享数组按 block 分开）', () => {
  const program = {
    hip: '__global__ void k(float* a, float* b) {\n    int t = threadIdx.x;\n    b[t] = a[t + 2];\n    a[t + 2] = t;\n}',
    py: '@kernel\ndef k(a, b):\n    t = threadIdx.x\n    b[t] = a[t + 2]\n    a[t + 2] = t',
  }
  const r = bothWritings(program, { grid: 1, block: 4, args: { a: floats([1, 2, 3, 4]), b: floats([0, 0, 0, 0]) } })
  assert.deepEqual(r.arrays, { a: [1, 2, 0, 1], b: [3, 4, 0, 0] })
  const oob = (index, thread) => ({ kind: 'oob-read', space: 'global', array: 'a', index, length: 4, block: 0, thread, line: 3, step: 1 })
  assert.deepEqual(r.diagnostics, [oob(4, 2), oob(5, 3)])
  const outside = (index, thread) => ({ space: 'global', array: 'a', block: null, index, writes: [{ block: 0, thread, line: 4, step: 2, op: 'store', value: thread }] })
  assert.deepEqual(r.outside, [outside(4, 2), outside(5, 3)])
  assert.deepEqual(r.events.find((e) => e.op === 'load').addrs, [2, 3, 4, 5])

  const shared = '__global__ void k(int* a) {\n    __shared__ int tile[4];\n    tile[threadIdx.x + 2] = blockIdx.x;\n}'
  const s = ok({ source: shared, lang: 'hip', grid: 2, block: 4, args: { a: ints([0]) } })
  assert.deepEqual(s.outside.map((o) => [o.space, o.array, o.block, o.index, o.writes.map((x) => x.value)]), [
    ['lds', 'tile', 0, 4, [0]],
    ['lds', 'tile', 0, 5, [0]],
    ['lds', 'tile', 1, 4, [1]],
    ['lds', 'tile', 1, 5, [1]],
  ])
})

test('§4 block 顺序：默认按编号；给随机种子就打乱，同一个种子同一个顺序，事件按这个顺序出现', () => {
  const program = { hip: '__global__ void k(int* out) {\n    out[0] = blockIdx.x;\n}', py: '@kernel\ndef k(out):\n    out[0] = blockIdx.x' }
  const req = { grid: 8, block: 1, args: { out: ints([-1]) } }
  const plain = bothWritings(program, req)
  assert.deepEqual([plain.blockOrder, plain.arrays.out], [seq(8), [7]])

  const orders = new Set()
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = bothWritings(program, { ...req, seed })
    assert.deepEqual([...r.blockOrder].sort(), seq(8))
    assert.deepEqual(r.events.map((e) => e.block), r.blockOrder)
    // 最后执行的 block 写的值留下：执行顺序不同，结果也不同
    assert.deepEqual(r.arrays.out, [r.blockOrder.at(-1)])
    assert.deepEqual(run({ ...req, seed, source: program.hip, lang: 'hip' }).blockOrder, r.blockOrder)
    orders.add(r.blockOrder.join())
  }
  assert.ok(orders.size > 1)
})

test('§4 上限：默认 200000 步，超出时报「超出限制」并返回之前的事件；线程默认最多 1024 个，可以调', () => {
  assert.equal(RUN_LIMITS.steps, 200_000)
  assert.equal(RUN_LIMITS.threads, 1024)
  const forever = '__global__ void k(int* a) {\n    int x = 0;\n    while (true) {\n        x = x + 1;\n    }\n}'
  const r = failed({ source: forever, lang: 'hip', grid: 1, block: 1, args: { a: ints([0]) } })
  assert.deepEqual([r.error.kind, r.error.line, r.steps, r.events.length], ['limit', 4, 200_000, 200_000])
  assert.match(r.error.message, /200000 步/)
  const small = failed({ source: forever, lang: 'hip', grid: 1, block: 1, maxSteps: 50, args: { a: ints([0]) } })
  assert.equal(small.steps, 50)

  const empty = { source: '__global__ void k(int* a) {\n}', lang: 'hip', block: 256, args: { a: ints([0]) } }
  const many = failed({ ...empty, grid: 5 })
  assert.equal(many.error.kind, 'limit')
  assert.match(many.error.message, /1280 个线程.*上限 1024 个/)
  ok({ ...empty, grid: 4 })
  ok({ ...empty, grid: 5, maxThreads: 2048 })
  assert.equal(failed({ ...empty, grid: 0 }).error.kind, 'runtime')
})

// ── 数值、参数和运行时错误 ────────────────────────────────────────────

test('数值：// 和 % 遇到负数按写法取整；小数存进整数数组向 0 截断', () => {
  const hip = ok({
    source: '__global__ void k(int* q, int* r) {\n    int t = threadIdx.x - 2;\n    q[threadIdx.x] = t / 2;\n    r[threadIdx.x] = t % 2;\n}',
    lang: 'hip',
    grid: 1,
    block: 4,
    args: { q: ints([9, 9, 9, 9]), r: ints([9, 9, 9, 9]) },
  })
  assert.deepEqual(hip.arrays, { q: [-1, 0, 0, 0], r: [0, -1, 0, 1] })
  const py = ok({
    source: '@kernel\ndef k(q, r):\n    t = threadIdx.x - 2\n    q[threadIdx.x] = t // 2\n    r[threadIdx.x] = t % 2',
    lang: 'python',
    grid: 1,
    block: 4,
    args: { q: ints([9, 9, 9, 9]), r: ints([9, 9, 9, 9]) },
  })
  assert.deepEqual(py.arrays, { q: [-1, -1, 0, 0], r: [0, 1, 0, 1] })

  const half = {
    hip: '__global__ void k(const int* a, int* b) {\n    b[threadIdx.x] = a[threadIdx.x] / 2.0;\n}',
    py: '@kernel\ndef k(a, b):\n    b[threadIdx.x] = a[threadIdx.x] / 2.0',
  }
  assert.deepEqual(bothWritings(half, { grid: 1, block: 2, args: { a: ints([-3, 3]), b: ints([0, 0]) } }).arrays.b, [-1, 1])
})

test('参数：Python 风格的类型由数据决定，相关的类型错误运行前报出；HIP 核对声明', () => {
  const scale = {
    hip: '__global__ void scale(float* x, float alpha) {\n    x[threadIdx.x] = alpha * x[threadIdx.x];\n}',
    py: '@kernel\ndef scale(x, alpha):\n    x[threadIdx.x] = alpha * x[threadIdx.x]',
  }
  // HIP 把传进来的整数转成声明的 float；Python 风格的 alpha 本来就是小数
  assert.deepEqual(ok({ source: scale.hip, lang: 'hip', grid: 1, block: 2, args: { x: floats([1, 2]), alpha: int(3) } }).arrays.x, [3, 6])
  assert.deepEqual(ok({ source: scale.py, lang: 'python', grid: 1, block: 2, args: { x: floats([1, 2]), alpha: { type: 'float', value: 0.5 } } }).arrays.x, [0.5, 1])

  const narrowing = failed({ source: '@kernel\ndef k(a, alpha):\n    s = 0\n    s = alpha\n    a[0] = s', lang: 'python', grid: 1, block: 1, args: { a: floats([0]), alpha: { type: 'float', value: 0.5 } } })
  assert.deepEqual([narrowing.error.kind, narrowing.error.line, narrowing.error.col], ['type', 4, 5])
  const floatIndex = failed({ source: '@kernel\ndef k(a, i):\n    a[i] = 1', lang: 'python', grid: 1, block: 1, args: { a: floats([0]), i: { type: 'float', value: 0 } } })
  assert.deepEqual([floatIndex.error.kind, floatIndex.error.line], ['type', 3])
  assert.match(floatIndex.error.message, /下标必须是整数/)

  for (const [source, lang, args, pattern] of [
    ['__global__ void k(int* a) {\n}', 'hip', { a: floats([0]) }, /声明成 int\*，传进来的却是小数数组/],
    ['__global__ void k(float* a) {\n}', 'hip', { a: { type: 'float', value: 1 } }, /声明成了数组/],
    ['@kernel\ndef k(a):\n    a[0] = 1', 'python', { a: int(1) }, /当数组用/],
    ['@kernel\ndef k(a, x):\n    a[0] = x', 'python', { a: floats([0]) }, /「x」没有对应的数据。这次运行提供的是 a/],
  ]) {
    const r = failed({ source, lang, grid: 1, block: 1, args })
    assert.equal(r.error.kind, 'type', formatError(r.error))
    assert.match(r.error.message, pattern)
  }
})

test('运行时错误：指出哪个线程在哪一行，返回出错之前的结果', () => {
  const div = failed({
    source: '__global__ void k(int* a) {\n    int t = threadIdx.x;\n    a[t] = 10 / (t - 2);\n}',
    lang: 'hip',
    grid: 1,
    block: 4,
    args: { a: ints([0, 0, 0, 0]) },
  })
  assert.deepEqual([div.error.kind, div.error.line, div.error.col], ['runtime', 3, 15])
  assert.match(div.error.message, /threadIdx\.x = 2）在这里除以 0/)
  assert.deepEqual(div.events.map((e) => e.op), ['exec'])

  const overflow = failed({ source: '@kernel\ndef k(a, n):\n    a[0] = n * n', lang: 'python', grid: 1, block: 1, args: { a: ints([0]), n: int(65536) } })
  assert.equal(overflow.error.kind, 'runtime')
  assert.match(overflow.error.message, /4294967296，超出了 32 位整数的范围/)

  const zero = failed({ source: '@kernel\ndef k(a, s):\n    for k in range(0, 4, s):\n        a[0] = k', lang: 'python', grid: 1, block: 1, args: { a: ints([0]), s: int(0) } })
  assert.deepEqual([zero.error.kind, zero.error.line], ['runtime', 3])
  assert.match(zero.error.message, /步长是 0/)
})

test('for 的方向：HIP 的步长是变量、正负和条件相反时，起点满足条件的线程报运行时错误（真机上不会结束），不满足的一次也不执行；Python 的 range 按步长的正负走', () => {
  // 线程 2 的步长是 -1：k 从 0 往下走，k < n 一直成立
  const endless = failed({
    source: '__global__ void k(int* a, int n) {\n    int t = threadIdx.x;\n    int s = t == 2 ? -1 : 1;\n    for (int k = 0; k < n; k += s) {\n        a[t] += 1;\n    }\n}',
    lang: 'hip',
    grid: 1,
    block: 4,
    args: { a: ints([0, 0, 0, 0]), n: int(3) },
  })
  assert.deepEqual([endless.error.kind, endless.error.line, endless.error.col], ['runtime', 4, 5])
  assert.match(endless.error.message, /threadIdx\.x = 2）的步长是 -1.*这个循环在真机上不会结束/)
  assert.match(endless.error.hint, /步长的正负/)
  // 进入循环时就停下：一轮也没执行
  assert.deepEqual(endless.arrays.a, [0, 0, 0, 0])

  // 往下数的条件配 k -= s、s 是负数：k 越来越大
  const down = failed({ source: '__global__ void k(int* a, int n, int s) {\n    for (int k = n; k >= 1; k -= s) {\n        a[0] += 1;\n    }\n}', lang: 'hip', grid: 1, block: 1, args: { a: ints([0]), n: int(3), s: int(-1) } })
  assert.deepEqual([down.error.kind, down.error.line], ['runtime', 2])
  assert.match(down.error.message, /步长是 1.*越来越大.*这个循环在真机上不会结束/)

  // 起点就不满足条件：真机上一次也不执行，这里也一样。线程 3 从 3 数起、步长 -1，k < 2 一开始就不成立
  const fromT = (h) => ({ grid: 1, block: 4, args: { a: ints([0, 0, 0, 0]) }, source: h })
  const hip = ok({ ...fromT('__global__ void k(int* a) {\n    int t = threadIdx.x;\n    int s = t == 3 ? -1 : 1;\n    for (int k = t; k < 2; k += s) {\n        a[t] += 1;\n    }\n}'), lang: 'hip' })
  assert.deepEqual(hip.arrays.a, [2, 1, 0, 0])
  // Python 的 range 没有条件：线程 3 的 range(3, 2, -1) 往下数一次。同一段代码在两种语言里本来就不一样，所以树的 dir 也不同
  const py = ok({ ...fromT('@kernel\ndef k(a):\n    t = threadIdx.x\n    s = -1 if t == 3 else 1\n    for k in range(t, 2, s):\n        a[t] += 1'), lang: 'python' })
  assert.deepEqual(py.arrays.a, [2, 1, 0, 1])
})

// ── 性能 ─────────────────────────────────────────────────────────────

test('性能：1024 个线程每个走 100 步，超过 150 ms 才算失败（目标 50 ms）', (t) => {
  const busy = `__global__ void busy(float* a, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    float s = 0;
    for (int k = 0; k < 48; k++) {
        s += a[(i + k) % n];
    }
    a[i] = s;
}`
  const req = { source: busy, lang: 'hip', grid: 4, block: 256, args: { a: floats(seq(1024, (i) => i % 7)), n: int(1024) } }
  run(req) // 预热
  const t0 = performance.now()
  const r = run(req)
  const ms = performance.now() - t0
  t.diagnostic(`1024 线程 × 100 步：${ms.toFixed(1)} ms`)
  assert.ok(r.ok)
  // 每个 wave 正好 100 步：两句赋值、49 次循环判断、48 次累加、一次写回
  const steps = new Map()
  for (const e of r.events) steps.set(`${e.block}/${e.wave}`, (steps.get(`${e.block}/${e.wave}`) ?? new Set()).add(e.step))
  assert.equal(steps.size, 32)
  assert.deepEqual(new Set([...steps.values()].map((s) => s.size)), new Set([100]))
  assert.ok(ms < 150, `用了 ${ms.toFixed(1)} ms`)
})
