import assert from 'node:assert/strict'
import test from 'node:test'
import { PENDING } from '../../docs/course/hardware.ts'
import {
  BASE_MS, CACHE_EXPONENTS, CLOCK_SPAN, CLOCK_TOTAL, FIRST_CALL_EXTRA_MS, FLUSH_BYTES, NOISE_DEFAULT, NOISE_LEVELS,
  QUEUED_OPTIONS, REPEAT_OPTIONS, STOP_MODES,
  bookCaches, bytesText, cacheCase, noiseLab, paramBytes, quantile, relativeGap, rulerPercent, runStats, simulateSamples, stopClock,
} from '../../docs/forge/trusted-timing/timing.ts'

/** 2-3 测得准：三段探索里的数（停表的时机、预热与波动、缓存冷热）。 */

// ── 探索一：停表的时机 ──────────────────────────────────────────────────────

/** 一条道上的段按时间排好，互不重叠。 */
function assertSequential(segments, what) {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start >= sorted[i - 1].end, `${what}：第 ${i} 段和前一段重叠`)
}

test('add() 一返回就停表：只量到排队那一下，GPU 还没算完要量的加法', () => {
  for (const queued of QUEUED_OPTIONS) {
    const run = stopClock('return', queued)
    assert.equal(run.measured.lane, 'cpu')
    assert.equal(run.measured.to - run.measured.from, CLOCK_SPAN.submit, `前面排着 ${queued} 个`)
    assert.ok(run.kernel.to > run.measured.to, '停表的时候 GPU 还在算')
    assert.ok(run.ratio < 1)
  }
})

test('等 GPU 算完再停表：把前面排着的加法也算进去，排得越多量得越长', () => {
  const ratios = QUEUED_OPTIONS.map((queued) => stopClock('sync', queued).ratio)
  for (let i = 1; i < ratios.length; i++) assert.ok(ratios[i] > ratios[i - 1], `排 ${QUEUED_OPTIONS[i]} 个比 ${QUEUED_OPTIONS[i - 1]} 个量得长`)
  for (const queued of QUEUED_OPTIONS) {
    const run = stopClock('sync', queued)
    assert.equal(run.measured.to, run.kernel.to, '停在 GPU 算完要量的加法的那一刻')
    assert.equal(run.measured.from, run.start)
  }
  // Notebook「停表的时机」第二个单元：前面排着两个加法，CPU 计时差不多是 GPU 事件的三倍
  const two = stopClock('sync', 2).measured
  const event = stopClock('event', 2).measured
  assert.ok((two.to - two.from) / (event.to - event.from) > 2.5)
})

test('GPU 事件：前面排着活时正好量到这一个加法；队列空着时多出 GPU 等 CPU 交活的那一小段', () => {
  for (const queued of QUEUED_OPTIONS.filter((q) => q > 0)) {
    const run = stopClock('event', queued)
    assert.equal(run.measured.lane, 'gpu')
    assert.deepEqual(run.events, { begin: run.kernel.from, end: run.kernel.to })
    assert.equal(run.ratio, 1)
    assert.ok(!run.segments.some((s) => s.kind === 'idle'), '前面排着活，GPU 没有空等')
  }
  const empty = stopClock('event', 0)
  const idle = empty.segments.filter((s) => s.kind === 'idle')
  assert.equal(idle.length, 1)
  assert.equal(idle[0].start, empty.events.begin, 'GPU 走到 begin 以后开始空等')
  assert.equal(idle[0].end, empty.kernel.from, '一直等到要量的加法交过来')
  assert.equal(empty.measured.to - empty.measured.from, CLOCK_SPAN.add + CLOCK_SPAN.submit)
})

test('时间线：同一条道上的活不重叠，GPU 按排队的顺序算，最满的队列也画得下', () => {
  for (const { id } of STOP_MODES) {
    for (const queued of QUEUED_OPTIONS) {
      const run = stopClock(id, queued)
      assertSequential(run.segments.filter((s) => s.lane === 'cpu'), `${id}/${queued} 的 CPU`)
      assertSequential(run.segments.filter((s) => s.lane === 'gpu'), `${id}/${queued} 的 GPU`)
      const adds = run.segments.filter((s) => s.lane === 'gpu' && s.kind === 'add')
      assert.equal(adds.length, queued + 1)
      assert.ok(adds.at(-1).timed, '要量的加法排在最后')
      assert.ok(Math.max(...run.segments.map((s) => s.end)) <= CLOCK_TOTAL)
    }
  }
})

test('停表的办法、前面排着的个数写错时直接报错', () => {
  assert.throws(() => stopClock('wall', 0))
  assert.throws(() => stopClock('event', -1))
  assert.throws(() => stopClock('event', 1.5))
})

// ── 探索二：预热与波动（噪声模拟器）────────────────────────────────────────────

const params = (over = {}) => ({ ...NOISE_DEFAULT, ...over })

test('分位数同 hello_gpu 的 _quantile（numpy.percentile 的线性插值）', () => {
  const sorted = [1, 2, 3, 4]
  assert.equal(quantile(sorted, 0), 1)
  assert.equal(quantile(sorted, 1), 4)
  assert.ok(Math.abs(quantile(sorted, 0.1) - 1.3) < 1e-12)
  assert.equal(quantile(sorted, 0.5), 2.5)
  assert.ok(Math.abs(quantile(sorted, 0.9) - 3.7) < 1e-12)
  assert.equal(quantile([7], 0.9), 7)
  assert.throws(() => quantile([], 0.5))
  assert.throws(() => quantile(sorted, 1.5))
})

test('统计：一个慢样本把平均数拉高，中位数和 p10 不受影响', () => {
  const steady = Array.from({ length: 29 }, () => 0.5)
  const stats = runStats([...steady, 5])
  assert.equal(stats.median, 0.5)
  assert.equal(stats.p10, 0.5)
  assert.ok(Math.abs(stats.mean - 0.65) < 1e-12)
  assert.equal(stats.first, 0.5)
  assert.equal(stats.max, 5)
  assert.equal(stats.spread, stats.p10 / stats.p90)
})

test('同一个种子算出同样的样本（服务端渲染和浏览器一致），换种子就换一组', () => {
  const p = params({ repeat: 30 })
  assert.deepEqual(simulateSamples(p, 0), simulateSamples(p, 0))
  assert.notDeepEqual(simulateSamples(p, 0), simulateSamples(params({ repeat: 30, seed: 2 }), 0))
  assert.notDeepEqual(simulateSamples(p, 0).slice(1), simulateSamples(p, 1).slice(1), '两轮各用各的随机数')
})

test('计时次数多了只在后面接着加样本；换噪声大小不挪动慢样本的位置', () => {
  const few = simulateSamples(params({ repeat: 5, warmup: true }), 1)
  const many = simulateSamples(params({ repeat: 300, warmup: true }), 1)
  assert.deepEqual(many.slice(0, 5), few)
  const slow = (level) => simulateSamples(params({ level, repeat: 300, warmup: true }), 1)
    .map((ms, i) => (ms - BASE_MS > 0.19 ? i : -1)).filter((i) => i >= 0)
  const low = new Set(slow('low'))
  const high = new Set(slow('high'))
  for (const i of low) assert.ok(high.has(i), `第 ${i} 个样本在小噪声里慢一截，大噪声里也慢`)
})

test('每个样本都不比加法本身快；噪声越大，样本越散', () => {
  const spreads = NOISE_LEVELS.map(({ id }) => {
    const samples = simulateSamples(params({ level: id, repeat: 300, warmup: true }), 1)
    for (const ms of samples) assert.ok(ms >= BASE_MS)
    return runStats(samples).spread
  })
  for (let i = 1; i < spreads.length; i++) assert.ok(spreads[i] < spreads[i - 1], 'p10 ÷ p90 随噪声变小')
})

test('不预热：第一轮的第一个样本多出第一次调用的开销，第二轮已经热了；平均数被拉高，中位数几乎不动', () => {
  for (const { id } of NOISE_LEVELS) {
    const cold = params({ level: id, warmup: false, repeat: 30 })
    const warm = params({ level: id, warmup: true, repeat: 30 })
    const [coldFirst, coldSecond] = [simulateSamples(cold, 0), simulateSamples(cold, 1)]
    const [warmFirst, warmSecond] = [simulateSamples(warm, 0), simulateSamples(warm, 1)]
    assert.ok(Math.abs(coldFirst[0] - warmFirst[0] - FIRST_CALL_EXTRA_MS) < 1e-12, '只差第一次调用的开销')
    assert.deepEqual(coldFirst.slice(1), warmFirst.slice(1), '其余样本一样')
    assert.deepEqual(coldSecond, warmSecond, '第二轮不受预热影响')
    const [c, w] = [runStats(coldFirst), runStats(warmFirst)]
    assert.ok(c.mean - w.mean > (c.median - w.median) * 10, `${id}：平均数被拉高得多，中位数几乎不动`)
  }
})

test('只测一次碰运气，多测几次取中位数，两轮才对得上（50 组随机数平均）', () => {
  const average = (repeat, pick) => {
    let sum = 0
    for (let seed = 1; seed <= 50; seed++) {
      const [a, b] = noiseLab(params({ level: 'mid', warmup: true, repeat, seed }))
      sum += relativeGap(pick(a), pick(b))
    }
    return sum / 50
  }
  const single = average(30, (s) => s.first)
  const medians = REPEAT_OPTIONS.map((repeat) => average(repeat, (s) => s.median))
  assert.ok(medians[1] < single / 2, '30 次的中位数比单个样本稳得多')
  for (let i = 1; i < medians.length; i++) assert.ok(medians[i] < medians[i - 1], '计时次数越多，两轮的中位数挨得越近')
})

test('噪声小、中时热缓存测得稳（p10 ÷ p90 ≥ 0.9，挑战的 ★2），噪声大时拿不到', () => {
  const spread = (level) => runStats(simulateSamples(params({ level, repeat: 300, warmup: true }), 0)).spread
  assert.ok(spread('low') >= 0.9)
  assert.ok(spread('mid') >= 0.9)
  assert.ok(spread('high') < 0.9)
})

test('两个数差多少按小的那个算；不是正数时报错', () => {
  assert.equal(relativeGap(1, 1.5), 0.5)
  assert.equal(relativeGap(1.5, 1), 0.5)
  assert.throws(() => relativeGap(0, 1))
})

// ── 探索三：缓存冷热 ────────────────────────────────────────────────────────

test('容量按出处的单位换成字节：MiB 按 2²⁰，MB 按 10⁶；查不到的不算', () => {
  assert.equal(paramBytes({ label: 'L2', value: 8, unit: 'MiB' }), 8 * 2 ** 20)
  assert.equal(paramBytes({ label: 'IC', value: 64, unit: 'MB' }), 64e6)
  assert.equal(paramBytes({ label: 'x', value: PENDING }), null)
  assert.equal(paramBytes({ label: 'x', value: 3, unit: '个' }), null)
  assert.equal(paramBytes(undefined), null)
})

test('本书那张卡有两级缓存，从小到大；冷缓存前读的 512 MiB 比它们都大', () => {
  const caches = bookCaches()
  assert.deepEqual(caches.map((c) => c.key), ['l2', 'infinity'])
  assert.ok(caches[0].bytes < caches[1].bytes)
  assert.ok(cacheCase(20).flushCovers)
  assert.ok(caches.every((c) => FLUSH_BYTES > c.bytes))
})

test('Notebook 的两个加法：12 MiB 装不进 L2、装得进 Infinity Cache；768 MiB 哪一级都装不下', () => {
  const small = cacheCase(20)
  assert.equal(small.bytes, 12 * 2 ** 20)
  assert.equal(small.fits?.key, 'infinity')
  assert.equal(small.warmFrom, 'infinity')
  const big = cacheCase(26)
  assert.equal(big.bytes, 768 * 2 ** 20)
  assert.equal(big.fits, null)
  assert.equal(big.warmFrom, 'vram')
  for (const exponent of CACHE_EXPONENTS) assert.equal(cacheCase(exponent).coldFrom, 'vram', '冷缓存那一次都从显存读')
})

test('数组越长，装得下的那一级越远：L2 → Infinity Cache → 显存，不回头', () => {
  const order = ['l2', 'infinity', 'vram']
  const at = CACHE_EXPONENTS.map((e) => order.indexOf(cacheCase(e).warmFrom))
  for (let i = 1; i < at.length; i++) assert.ok(at[i] >= at[i - 1])
  assert.equal(at[0], 0)
  assert.equal(at.at(-1), 2)
  // 和别的缓存大小比：恰好装满也算装得下
  const exact = cacheCase(10, [{ key: 'l2', label: 'L2', bytes: 12 * 2 ** 10, text: '12 KiB' }])
  assert.equal(exact.warmFrom, 'l2')
  assert.equal(cacheCase(11, [{ key: 'l2', label: 'L2', bytes: 12 * 2 ** 10, text: '12 KiB' }]).warmFrom, 'vram')
  assert.throws(() => cacheCase(2.5))
})

test('尺子按 log₂ 画：长度翻一倍挪一格，两头之外贴边', () => {
  const at = CACHE_EXPONENTS.map((e) => rulerPercent(cacheCase(e).bytes))
  for (let i = 1; i < at.length; i++) assert.ok(at[i] > at[i - 1])
  assert.equal(rulerPercent(2 ** 19), 0)
  assert.equal(rulerPercent(2 ** 30), 100)
  assert.equal(rulerPercent(1), 0)
  assert.equal(rulerPercent(2 ** 40), 100)
  assert.ok(Math.abs((rulerPercent(2 ** 25) - rulerPercent(2 ** 24)) - 100 / 11) < 0.02)
})

test('字节数写成 KiB、MiB、GiB', () => {
  assert.deepEqual(CACHE_EXPONENTS.map((e) => bytesText(cacheCase(e).bytes)), ['768 KiB', '3 MiB', '12 MiB', '48 MiB', '192 MiB', '768 MiB'])
  assert.equal(bytesText(FLUSH_BYTES), '512 MiB')
  assert.equal(bytesText(64e6), '61 MiB')
  assert.equal(bytesText(2 ** 31), '2 GiB')
  assert.equal(bytesText(100), '100 B')
})
