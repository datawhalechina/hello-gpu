import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { formatError } from '../../docs/sim/syntax/errors.ts'
import { estimateTime, latencyTimeline, occupancy } from '../../docs/sim/timing.ts'

const seq = (n, f = (i) => i) => Array.from({ length: n }, (_, i) => f(i))
const floats = (data) => ({ type: 'float', data })
const ints = (data) => ({ type: 'int', data })
const int = (value) => ({ type: 'int', value })

/**
 * 手算例自己给价钱和硬件参数，不用参数表的默认值：参数表里的示意值以后可以改，这些例子不受影响。
 * 算一步 1 个周期；一车 128 字节、元素 4 字节（一车 32 个数），搬一车 4 个周期；
 * LDS 32 个 bank、每个 4 字节，一轮 1 个周期；显存原子加每多一个 lane 多 4 个周期；同步 4 个周期。
 */
const COSTS = { issueCycles: 1, lineCycles: 4, ldsCycles: 1, atomicCycles: 4, barrierCycles: 4, lineBytes: 128, elemBytes: 4, banks: 32, bankBytes: 4 }
/** 每个 SIMD 16 个名额、1024 个 VGPR（wave32 每份 16 个），一个 WGP 4 个 SIMD、128 KB LDS（每份 1 KB）、最多 32 个 block。 */
const HW = {
  waveSlots: 16,
  vgprsPerSimd: 1024,
  vgprGranule: 16,
  maxVgprs: 256,
  simds: 4,
  ldsBytes: 131072,
  ldsGranule: 1024,
  maxLdsPerBlock: 65536,
  maxBlocks: 32,
  maxBlockThreads: 1024,
}

/** 两种写法各跑一次，返回两份事件流。 */
function bothEvents(program, req) {
  return ['hip', 'python'].map((lang) => {
    const r = run({ ...req, lang, source: lang === 'hip' ? program.hip : program.py })
    assert.ok(r.ok, r.ok ? '' : `${lang} 运行出错：${formatError(r.error)}`)
    return r.events
  })
}

/** 示意计时：两种写法的结果逐项相同。返回 HIP 写法的结果。 */
function estimate(program, req, options = COSTS) {
  const [hip, py] = bothEvents(program, req)
  const result = estimateTime(hip, options)
  assert.deepEqual(estimateTime(py, options), result)
  return result
}

/** 时间线：两种写法的结果逐项相同（段里的 event 是事件的位置，两种写法的事件一一对应）。返回 HIP 写法的结果。 */
function timeline(program, req, options) {
  const [hip, py] = bothEvents(program, req)
  const result = latencyTimeline(hip, options)
  assert.deepEqual(latencyTimeline(py, options), result)
  return result
}

/** 一个 wave 的示意时间。 */
const waveTime = (block, wave, compute, memory, sync) => ({ block, wave, compute, memory, sync, cycles: compute + memory + sync })

// ── 程序 ───────────────────────────────────────────────────────────────

/** 每个 wave：0 算 i；1 判断；2 读 a、读 b、写 c（同一步）。 */
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

/** 每个 wave：0 算 i；1 读 x[i * stride]、写 y[i]。 */
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
const stridedArgs = (stride) => ({ grid: 1, block: 32, args: { x: floats(seq(1024)), y: floats(seq(32, () => 0)), stride: int(stride) } })

/** 块内反转（block 最多 128 个线程）。每个 wave：0 算 t；1 算 i；2 读 a（显存）、写 s（LDS）；3 同步；4 读 s（LDS）、写 a（显存）。 */
const REVERSE = {
  hip: `__global__ void reverse(float* a) {
    __shared__ float s[128];
    int t = threadIdx.x;
    int i = blockIdx.x * blockDim.x + t;
    s[t] = a[i];
    __syncthreads();
    a[i] = s[blockDim.x - 1 - t];
}`,
  py: `@kernel
def reverse(a):
    s = shared(128)
    t = threadIdx.x
    i = blockIdx.x * blockDim.x + t
    s[t] = a[i]
    syncthreads()
    a[i] = s[blockDim.x - 1 - t]`,
}
const reverseArgs = (grid, block = 64, wave = 32) => ({ grid, block, wave, args: { a: floats(seq(block * grid)) } })

/** 32 个线程轮流往 out[0 … m-1] 上原子加 1：每个元素上有 32 / m 个 lane。只有一步。 */
const COUNT = {
  hip: `__global__ void count(int* out, int m) {
    atomicAdd(&out[threadIdx.x % m], 1);
}`,
  py: `@kernel
def count(out, m):
    atomic_add(out, threadIdx.x % m, 1)`,
}
const countArgs = (m) => ({ grid: 1, block: 32, args: { out: ints(seq(32, () => 0)), m: int(m) } })

/** 每个 wave：0 算 i；1 读 x[i]；2、3 算；4 写 y[i]。 */
const SCALE = {
  hip: `__global__ void scale(const float* x, float* y) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    float s = x[i];
    s = s * 2.0;
    s = s + 1.0;
    y[i] = s;
}`,
  py: `@kernel
def scale(x, y):
    i = blockIdx.x * blockDim.x + threadIdx.x
    s = x[i]
    s = s * 2.0
    s = s + 1.0
    y[i] = s`,
}
const scaleArgs = (grid) => ({ grid, block: 32, args: { x: floats(seq(32 * grid)), y: floats(seq(32 * grid, () => 0)) } })

/** 每个线程读 4 个数，每读一个算两下：每一轮「读 → 等 → 算」，用来看等待能藏住多少。 */
const ROUNDS = {
  hip: `__global__ void rounds(const float* x, float* y, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    float s = 0.0;
    for (int r = 0; r < 4; r++) {
        s = s + x[(i + r * 64) % n];
        s = s * 0.5 + 1.0;
        s = s * 0.5 + 1.0;
    }
    y[i] = s;
}`,
  py: `@kernel
def rounds(x, y, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    s = 0.0
    for r in range(4):
        s = s + x[(i + r * 64) % n]
        s = s * 0.5 + 1.0
        s = s * 0.5 + 1.0
    y[i] = s`,
}
const roundsArgs = (grid) => ({ grid, block: 32, args: { x: floats(seq(1024)), y: floats(seq(32 * grid, () => 0)), n: int(1024) } })

// ── 示意计时：手算标准例（两种写法） ────────────────────────────────────

test('计时标准例 1 向量加法：40 个数、两个 wave，每个 wave 算 3 步、搬 3 车；32 个数时 wave 1 的 if 里没人，只花前两步', () => {
  // 每个 wave：计算 3 步 × 1；访存 a、b、c 各 1 车 × 4 = 12（wave 1 只有 8 个 lane，也要整车）
  assert.deepEqual(estimate(VECTOR_ADD, vectorAddArgs(40, 64)), {
    cycles: 30,
    compute: 6,
    memory: 24,
    sync: 0,
    waves: [waveTime(0, 0, 3, 12, 0), waveTime(0, 1, 3, 12, 0)],
  })
  // n = 32：wave 1 的 32 个 lane 都不满足 i < n，整段跳过，只有算 i 和判断两步
  const short = estimate(VECTOR_ADD, vectorAddArgs(32, 64))
  assert.deepEqual(short.waves, [waveTime(0, 0, 3, 12, 0), waveTime(0, 1, 2, 0, 0)])
  assert.equal(short.cycles, 17)
})

test('计时标准例 2 步长 1 / 2 / 4 / 32：读 x 搬 1 / 2 / 4 / 32 车，访存 8 / 12 / 20 / 132 个周期，计算都是 2', () => {
  for (const [stride, lines] of [
    [1, 1],
    [2, 2],
    [4, 4],
    [32, 32],
  ]) {
    // 访存：读 x 的车 + 写 y 的 1 车，每车 4 个周期
    const memory = (lines + 1) * 4
    assert.deepEqual(estimate(STRIDED, stridedArgs(stride)), { cycles: 2 + memory, compute: 2, memory, sync: 0, waves: [waveTime(0, 0, 2, memory, 0)] })
  }
})

test('计时标准例 3 LDS 和同步：块内反转两个 wave，每个 wave 算 5 步、访存 10、同步 4', () => {
  // 访存：读 a 1 车（4）+ 写 s 1 轮（1）+ 读 s 1 轮（1）+ 写 a 1 车（4）= 10；同步一次 4
  assert.deepEqual(estimate(REVERSE, reverseArgs(1)), {
    cycles: 38,
    compute: 10,
    memory: 20,
    sync: 8,
    waves: [waveTime(0, 0, 5, 10, 4), waveTime(0, 1, 5, 10, 4)],
  })
})

test('计时标准例 4 显存原子加排队：32 个 lane 加同一个元素多等 31 × 4；分到 4 个元素每个 8 个 lane，多等 7 × 4；各加各的不用等', () => {
  for (const [m, memory] of [
    [1, 4 + 31 * 4],
    [4, 4 + 7 * 4],
    [32, 4],
  ]) {
    assert.deepEqual(estimate(COUNT, countArgs(m)), { cycles: 1 + memory, compute: 1, memory, sync: 0, waves: [waveTime(0, 0, 1, memory, 0)] })
  }
})

test('计时标准例 5 wave64：一个 wave64 每步算两次、每次访存搬 2 车，和两个 wave32 加起来一样多', () => {
  const wide = estimate(VECTOR_ADD, { ...vectorAddArgs(64, 64), wave: 64 })
  assert.deepEqual(wide, { cycles: 30, compute: 6, memory: 24, sync: 0, waves: [waveTime(0, 0, 6, 24, 0)] })
  const narrow = estimate(VECTOR_ADD, vectorAddArgs(64, 64))
  assert.deepEqual([narrow.cycles, narrow.compute, narrow.memory], [30, 6, 24])
})

// ── 单调性：访存更合并，示意时间不增加 ────────────────────────────────

test('单调性：步长越小（越合并）示意时间越短；LDS 冲突越少示意时间越短；默认参数下也一样', () => {
  const strides = [32, 16, 8, 4, 2, 1]
  for (const options of [COSTS, {}]) {
    const times = strides.map((s) => estimate(STRIDED, stridedArgs(s), options).cycles)
    for (let k = 1; k < times.length; k++) assert.ok(times[k] < times[k - 1], `步长 ${strides[k]} 的 ${times[k]} 应该小于步长 ${strides[k - 1]} 的 ${times[k - 1]}`)
  }
  // LDS：同一个 wave 按步长读共享数组，步长 32 是 32 路冲突，补一格的 33 没有冲突
  const LDS = {
    hip: `__global__ void lds_read(float* out, int stride) {
    __shared__ float s[1056];
    int t = threadIdx.x;
    out[t] = s[t * stride];
}`,
    py: `@kernel
def lds_read(out, stride):
    s = shared(1056)
    t = threadIdx.x
    out[t] = s[t * stride]`,
  }
  const ldsTime = (stride) => estimate(LDS, { grid: 1, block: 32, args: { out: floats(seq(32, () => 0)), stride: int(stride) } }).memory
  // 写 out 1 车 4 + LDS 轮数 × 1
  assert.deepEqual([32, 4, 2, 1, 33].map(ldsTime), [36, 8, 6, 5, 5])
})

test('单调性：随便打乱的访存，换成从一车开头连续放的同样多个数，示意时间不增加', () => {
  // 一个 wave 最多 32 个数，从一车开头连续放只要 1 车、每个元素只有一个 lane，车次和排队都是最少的。线性同余的伪随机数，结果固定
  let state = 2024
  const rand = (n) => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state % n
  }
  for (let round = 0; round < 200; round++) {
    const lanes = 1 + rand(32)
    const scattered = seq(lanes, () => rand(4096) - 512)
    const start = rand(64) * 32
    const packed = seq(lanes, (k) => start + k)
    const op = ['load', 'store', 'atomic'][rand(3)]
    const event = (addrs) => ({ step: 0, block: 0, wave: 0, line: 1, op, mask: '1'.repeat(lanes).padEnd(32, '0'), space: 'global', array: 'x', addrs })
    assert.ok(estimateTime([event(packed)], COSTS).cycles <= estimateTime([event(scattered)], COSTS).cycles, `第 ${round} 次：${op} ${scattered.join(',')}`)
  }
})

// ── 占用率：手算标准例 ─────────────────────────────────────────────────

/** 只看这几项的占用率：每个 SIMD 几个 wave、被谁卡住。 */
const occ = (options) => {
  const r = occupancy({ ...HW, ...options })
  return [r.wavesPerSimd, r.limiter]
}

test('占用率标准例 1 VGPR：256 个线程的 block，用 64 / 65 / 100 / 128 / 256 个 VGPR 时每个 SIMD 住 16 / 12 / 8 / 8 / 4 个 wave', () => {
  // 64 个：1024 ÷ 64 = 16，正好用满名额
  assert.deepEqual(occupancy({ ...HW, vgprs: 64, block: 256 }), {
    wavesPerBlock: 8,
    blocks: 8,
    waves: 64,
    wavesPerSimd: 16,
    occupancy: 1,
    limiter: 'slots',
    limits: { slots: 16, vgprs: 16, lds: Infinity, blocks: 64 },
  })
  // 65 个凑整到 80：1024 ÷ 80 = 12 个 wave，一个 WGP 48 个，正好 6 个 block
  assert.deepEqual(occ({ vgprs: 65, block: 256 }), [12, 'vgprs'])
  // 100 个凑整到 112：1024 ÷ 112 = 9 个，一个 WGP 36 个；一个 block 8 个 wave，只放得下 4 个 block，每个 SIMD 8 个
  assert.deepEqual(occupancy({ ...HW, vgprs: 100, block: 256 }), {
    wavesPerBlock: 8,
    blocks: 4,
    waves: 32,
    wavesPerSimd: 8,
    occupancy: 0.5,
    limiter: 'vgprs',
    limits: { slots: 16, vgprs: 8, lds: Infinity, blocks: 64 },
  })
  assert.deepEqual(occ({ vgprs: 128, block: 256 }), [8, 'vgprs'])
  assert.deepEqual(occ({ vgprs: 256, block: 256 }), [4, 'vgprs'])
})

test('占用率标准例 2 LDS：每个 block 用 48 KB 只放得下 2 个 block；用 26000 字节要凑整到 26 KB，只放得下 4 个', () => {
  // 128 KB ÷ 48 KB = 2 个 block，16 个 wave 分给 4 个 SIMD
  assert.deepEqual(occupancy({ ...HW, vgprs: 32, block: 256, lds: 48 * 1024 }), {
    wavesPerBlock: 8,
    blocks: 2,
    waves: 16,
    wavesPerSimd: 4,
    occupancy: 0.25,
    limiter: 'lds',
    limits: { slots: 16, vgprs: 32, lds: 4, blocks: 64 },
  })
  // 26000 字节凑整到 26 × 1024 = 26624：128 KB 里放得下 4 份（不凑整的话能放 5 个）
  assert.deepEqual(occ({ vgprs: 32, block: 256, lds: 26000 }), [8, 'lds'])
  // 1 个字节也占一整份（1 KB）：128 个 block 才用完，不卡
  assert.deepEqual(occ({ vgprs: 32, block: 256, lds: 1 }), [16, 'slots'])
})

test('占用率标准例 3 block 大小：一个 block 的 wave 要一起住进来，3 个 wave 的 block 只能住 21 个；只有一个 wave 的 block 不占 block 名额', () => {
  // 96 个线程 = 3 个 wave：一个 WGP 64 个名额，放 21 个 block、63 个 wave，平均每个 SIMD 15.75 个
  assert.deepEqual(occupancy({ ...HW, vgprs: 32, block: 96 }), {
    wavesPerBlock: 3,
    blocks: 21,
    waves: 63,
    wavesPerSimd: 15.75,
    occupancy: 15.75 / 16,
    limiter: 'slots',
    limits: { slots: 15.75, vgprs: 31.5, lds: Infinity, blocks: 24 },
  })
  // 一个 WGP 最多 8 个 block 时：64 个线程的 block 只能住 8 个（每个 SIMD 4 个 wave）；32 个线程的 block 不受这一条限制
  assert.deepEqual(occ({ vgprs: 32, block: 64, maxBlocks: 8 }), [4, 'blocks'])
  assert.deepEqual(occ({ vgprs: 32, block: 32, maxBlocks: 8 }), [16, 'slots'])
})

test('占用率标准例 4 wave64：每个寄存器占两倍，用 64 个 VGPR 时每个 SIMD 住 8 个 wave64、用 256 个时 2 个', () => {
  // 和 RDNA 演示文稿里的例子同一个规则：wave32 用 64 个住 16 个、用 256 个住 4 个；wave64 用 64 个住 8 个、用 256 个住 2 个
  assert.deepEqual(occ({ vgprs: 64, block: 32 }), [16, 'slots'])
  assert.deepEqual(occ({ vgprs: 256, block: 32 }), [4, 'vgprs'])
  assert.deepEqual(occ({ vgprs: 64, block: 64, wave: 64 }), [8, 'vgprs'])
  assert.deepEqual(occ({ vgprs: 256, block: 64, wave: 64 }), [2, 'vgprs'])
  // 256 个线程的 block 是 4 个 wave64：每个 SIMD 8 个、一个 WGP 32 个，放 8 个 block
  assert.deepEqual(occupancy({ ...HW, vgprs: 64, block: 256, wave: 64 }).blocks, 8)
})

test('占用率标准例 5 放不下：1024 个线程的 block 用 256 个 VGPR，一个 WGP 只有 16 个 wave 的寄存器，一个 block 都住不下', () => {
  assert.deepEqual(occupancy({ ...HW, vgprs: 256, block: 1024 }), {
    wavesPerBlock: 32,
    blocks: 0,
    waves: 0,
    wavesPerSimd: 0,
    occupancy: 0,
    limiter: 'vgprs',
    limits: { slots: 16, vgprs: 0, lds: Infinity, blocks: 256 },
  })
  // 用 128 个就住得下一个：每个 SIMD 8 个，正好 32 个
  assert.deepEqual(occ({ vgprs: 128, block: 1024 }), [8, 'vgprs'])
})

// ── 延迟隐藏时间线：手算标准例（两种写法） ──────────────────────────────

/** 时间线的手算例：算一步 1 个周期，搬一车 1 个周期，LDS 一轮 1 个周期，读显存往返 3 个周期，同步 2 个周期。 */
const TL = { issueCycles: 1, lineCycles: 1, ldsCycles: 1, atomicCycles: 1, barrierCycles: 2, memLatency: 3, lineBytes: 128, elemBytes: 4, banks: 32, bankBytes: 4 }
const seg = (block, wave, kind, start, end, event) => ({ block, wave, kind, start, end, event })

test('时间线标准例 1 一个 wave：读数据时 SIMD 只能空等，一点也藏不住；总周期数 = 示意时间 + 往返延迟', () => {
  // 读 x 等 3 + 1 车；写 y 等 1 车。事件：0 算 i、1 读 x、2、3 算、4 写 y
  const r = timeline(SCALE, scaleArgs(1), { ...TL, waves: 16 })
  assert.deepEqual(r, {
    waves: 1,
    skipped: 0,
    segments: [
      seg(0, 0, 'run', 0, 1, 0),
      seg(0, 0, 'run', 1, 2, 1),
      seg(0, 0, 'memory', 2, 6, 1),
      seg(0, 0, 'run', 6, 7, 2),
      seg(0, 0, 'run', 7, 8, 3),
      seg(0, 0, 'run', 8, 9, 4),
      seg(0, 0, 'memory', 9, 10, 4),
    ],
    cycles: 10,
    busy: 5,
    idle: 5,
    waiting: 5,
    hidden: 0,
    hiddenRatio: 0,
  })
  const [events] = bothEvents(SCALE, scaleArgs(1))
  // 示意时间：计算 5 + 访存 2 车；时间线多出一次读显存的往返 3
  assert.equal(estimateTime(events, TL).cycles + 3, r.cycles)
})

test('时间线标准例 2 两个 wave：wave 0 等数据时 SIMD 换 wave 1 来算，等 4 个周期里藏住 2 个', () => {
  // wave 0（block 0）：算 [0,2)，等 [2,6)，算 [6,9)，等 [9,10)
  // wave 1（block 1）：轮不到 [0,2)，算 [2,4)，等 [4,8)；SIMD 空着 [4,6)；准备好了却轮不到 [8,9)，算 [9,12)，等 [12,13)
  // 有人在等的周期：[2,8)、[9,10)、[12,13) 共 8 个，其中 SIMD 在算的有 [2,4)、[6,8)、[9,10) 共 5 个
  assert.deepEqual(timeline(SCALE, scaleArgs(2), { ...TL, waves: 2 }), {
    waves: 2,
    skipped: 0,
    segments: [
      seg(0, 0, 'run', 0, 1, 0),
      seg(1, 0, 'ready', 0, 2, 5),
      seg(0, 0, 'run', 1, 2, 1),
      seg(0, 0, 'memory', 2, 6, 1),
      seg(1, 0, 'run', 2, 3, 5),
      seg(1, 0, 'run', 3, 4, 6),
      seg(1, 0, 'memory', 4, 8, 6),
      seg(0, 0, 'run', 6, 7, 2),
      seg(0, 0, 'run', 7, 8, 3),
      seg(0, 0, 'run', 8, 9, 4),
      seg(1, 0, 'ready', 8, 9, 7),
      seg(0, 0, 'memory', 9, 10, 4),
      seg(1, 0, 'run', 9, 10, 7),
      seg(1, 0, 'run', 10, 11, 8),
      seg(1, 0, 'run', 11, 12, 9),
      seg(1, 0, 'memory', 12, 13, 9),
    ],
    cycles: 13,
    busy: 10,
    idle: 3,
    waiting: 8,
    hidden: 5,
    hiddenRatio: 5 / 8,
  })
})

test('时间线标准例 3 同步：同一个 block 的两个 wave 等最后一个到齐，再过 2 个周期一起往下走', () => {
  // 每个 wave：算 t、i、「读 a 写 s」三步，等 3 + 1 车 + 1 轮 = 5；同步那一步算 1，等齐再过 2；最后一步算 1，等 1 轮 + 1 车 = 2。
  // 事件：wave 0 的五步从事件 0、1、2、4、10 开始，wave 1 的从 5、6、7、9、12 开始。
  // wave 0：算 [0,3)，等 [3,8)，算 [8,9) 到同步；wave 1：算 [3,6)，等 [6,11)，算 [11,12) 到同步，12 + 2 = 14 一起放行；
  // 之后 wave 0 算 [14,15)、等 [15,17)，wave 1 轮不到 [14,15)、算 [15,16)、等 [16,18)
  const r = timeline(REVERSE, reverseArgs(1), { ...TL, waves: 2 })
  assert.deepEqual(
    r.segments.filter((s) => s.kind === 'sync'),
    [seg(0, 0, 'sync', 9, 14, 4), seg(0, 1, 'sync', 12, 14, 9)],
  )
  assert.deepEqual(
    r.segments.filter((s) => s.kind === 'run').map((s) => [s.wave, s.start, s.event]),
    [
      [0, 0, 0],
      [0, 1, 1],
      [0, 2, 2],
      [1, 3, 5],
      [1, 4, 6],
      [1, 5, 7],
      [0, 8, 4],
      [1, 11, 9],
      [0, 14, 10],
      [1, 15, 12],
    ],
  )
  // 有人在等：[3,14)、[15,18) 共 14 个周期；其中 SIMD 在算 [3,6)、[8,9)、[11,12)、[15,16) 共 6 个
  assert.deepEqual([r.cycles, r.busy, r.idle, r.waiting, r.hidden, r.hiddenRatio], [18, 10, 8, 14, 6, 6 / 14])
})

test('时间线标准例 4 住几个画几个：4 个 block 住得下 3 个时只画前 3 个；3 个以上一样的 wave 一共 5N + 1 个周期，等待只露出最后 1 个周期', () => {
  const r = timeline(SCALE, scaleArgs(4), { ...TL, waves: 3 })
  assert.deepEqual([r.waves, r.skipped, [...new Set(r.segments.map((s) => s.block))]], [3, 1, [0, 1, 2]])
  // N 个 wave 先依次算两步：第 k 个算 [2k, 2k + 2)，等 [2k + 2, 2k + 6)，这些等待连成 [2, 2N + 4)。
  // N ≥ 3 时 SIMD 在 2N 空出来，wave 0 早就准备好了，之后第 k 个算 [2N + 3k, 2N + 3k + 3)、写 y 等 1 个周期，
  // SIMD 一直有活，只有最后一个 wave 写 y 的那 1 个周期空着。
  // 有人在等的周期：[2, 2N + 4) 加上 wave 1 … N-1 写 y 各 1 个，共 3N + 1 个，只有 1 个没藏住。
  const [events] = bothEvents(SCALE, scaleArgs(16))
  for (let n = 3; n <= 16; n++) {
    const t = latencyTimeline(events, { ...TL, waves: n })
    assert.deepEqual([t.waves, t.cycles, t.busy, t.idle, t.waiting, t.hidden], [n, 5 * n + 1, 5 * n, 1, 3 * n + 1, 3 * n], `${n} 个 wave`)
  }
})

// ── 单调性：占用率越高，被藏住的比例不降低 ───────────────────────────────

test('单调性：VGPR 用得越少，每个 SIMD 住的 wave 越多，等待被藏住的比例不降低', () => {
  // 16 个 wave，每个 wave 一个 block，做的事一样；VGPR 从多到少，占用率从 4 个 wave 涨到 16 个
  const [events] = bothEvents(ROUNDS, roundsArgs(16))
  for (const options of [{}, { memLatency: 0 }, { memLatency: 20 }, { memLatency: 400, lineCycles: 1 }, { issueCycles: 3, memLatency: 50 }]) {
    const ratios = []
    let last = 0
    for (const vgprs of [256, 200, 160, 128, 100, 80, 64, 32]) {
      const o = occupancy({ vgprs, block: 32 })
      assert.ok(o.wavesPerSimd >= last, `${vgprs} 个 VGPR`)
      last = o.wavesPerSimd
      ratios.push(latencyTimeline(events, { ...options, waves: o.wavesPerSimd }).hiddenRatio)
    }
    for (let k = 1; k < ratios.length; k++) assert.ok(ratios[k] >= ratios[k - 1], `${JSON.stringify(options)}：${ratios.join('、')}`)
    assert.ok(ratios[0] < ratios[ratios.length - 1], `${JSON.stringify(options)}：住 16 个应该比住 4 个藏得多`)
  }
})

test('单调性：一个 block 两个 wave、带同步时，住的 wave 越多，等待被藏住的比例也不降低（wave32 和 wave64）', () => {
  for (const [wave, block] of [
    [32, 64],
    [64, 128],
  ]) {
    const [events] = bothEvents(REVERSE, reverseArgs(8, block, wave))
    for (const options of [TL, {}, { memLatency: 7, barrierCycles: 0 }]) {
      let prev = -1
      for (let n = 2; n <= 16; n++) {
        const t = latencyTimeline(events, { ...options, waves: n })
        assert.equal(t.waves, n - (n % 2))
        assert.ok(t.hiddenRatio >= prev, `wave${wave}、${JSON.stringify(options)}、${n} 个`)
        prev = t.hiddenRatio
      }
    }
  }
})

// ── 边界和参数 ─────────────────────────────────────────────────────────

test('没有事件：示意时间是 0；时间线是空的，没有等待，比例记 1', () => {
  assert.deepEqual(estimateTime([]), { cycles: 0, compute: 0, memory: 0, sync: 0, waves: [] })
  assert.deepEqual(latencyTimeline([]), { waves: 0, skipped: 0, segments: [], cycles: 0, busy: 0, idle: 0, waiting: 0, hidden: 0, hiddenRatio: 1 })
})

test('参数不对时抛出 RangeError：价钱要是整数（算一步至少 1 个周期），占用率的输入要在硬件允许的范围里，block 要住得下', () => {
  const [events] = bothEvents(SCALE, scaleArgs(1))
  for (const bad of [-1, 1.5, Number.NaN]) {
    for (const key of ['issueCycles', 'lineCycles', 'ldsCycles', 'atomicCycles', 'barrierCycles']) {
      assert.throws(() => estimateTime(events, { [key]: bad }), RangeError, key)
      assert.throws(() => latencyTimeline(events, { [key]: bad }), RangeError, key)
    }
    assert.throws(() => latencyTimeline(events, { memLatency: bad }), RangeError)
    assert.throws(() => latencyTimeline(events, { waves: bad }), RangeError)
  }
  assert.throws(() => estimateTime(events, { issueCycles: 0 }), RangeError)
  assert.throws(() => latencyTimeline(events, { waves: 0 }), RangeError)
  // 车的大小交给 L3 检查
  assert.throws(() => estimateTime(events, { lineBytes: 0 }), RangeError)

  for (const bad of [{ vgprs: 0 }, { vgprs: 257 }, { vgprs: 1.5 }, { block: 0 }, { block: 1025 }, { lds: -1 }, { lds: 65537 }, { wave: 48 }, { waveSlots: 0 }, { simds: 2.5 }]) {
    assert.throws(() => occupancy({ vgprs: 64, block: 256, ...bad }), RangeError, JSON.stringify(bad))
  }
  assert.doesNotThrow(() => occupancy({ vgprs: 256, block: 1024, lds: 65536 }))

  // 一个 block 有 2 个 wave，SIMD 只住 1 个：放不下
  const [pair] = bothEvents(REVERSE, reverseArgs(1))
  assert.throws(() => latencyTimeline(pair, { waves: 1 }), /block 0 有 2 个 wave，SIMD 最多同时住 1 个/)
})
