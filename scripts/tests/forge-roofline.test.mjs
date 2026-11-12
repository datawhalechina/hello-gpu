import assert from 'node:assert/strict'
import test from 'node:test'
import { HARDWARE_DEVICES, DEFAULT_DEVICE_ID } from '../../docs/course/hardware.ts'
import {
  ADD_N, COPY_EXPONENTS, COPY_EXPONENT_DEFAULT, COPY_OVERHEAD_MS, FMA_COUNTS, FMA_COUNT_DEFAULT, FMA_TEST, MM_KS, MM_K_DEFAULT, MM_SIZE,
  SPEC_PEAK, addWork, archivePeak, balance, boundOf, cardPeak, copyCase, countText, decadeLabel, fmaWork, intensityOf, logFraction,
  logValueAt, mmIntensity, mmWork, msText, nearestK, percentText, pickPeak, powerText, ridgeOf, roofAt, roofAxes, specPeak,
} from '../../docs/forge/roofline/roofline.ts'

/** 2-4 性能的天花板：峰值从哪来、屋顶线（同 hg.roofline）、三段探索里的数。 */

const close = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b)), `${what}：${a} 和 ${b} 对不上`)

/** 两组假想的峰值（不是哪张真卡的实测）：拐点 40 FLOP/字节，和拐点 150 FLOP/字节。 */
const MID = { gbps: 500, tflops: 20 }
const STEEP = { gbps: 200, tflops: 30 }

// ── 屋顶线（同 hello_gpu 的 Roofline.ridge、roof 和表里的「归谁管」）──────────────────

test('拐点是峰值算力 ÷ 峰值带宽；屋顶左边是带宽 × 算术强度，右边是峰值算力，在拐点上接上', () => {
  close(ridgeOf(MID), 40, '拐点')
  close(roofAt(MID, 10), 5, '拐点左边的屋顶')
  assert.equal(roofAt(MID, 400), 20, '拐点右边是峰值算力')
  close(roofAt(MID, ridgeOf(MID)), MID.tflops, '拐点上两条线一样高')
  for (const peak of [MID, STEEP, SPEC_PEAK]) {
    for (const intensity of [0.01, 1 / 12, 1, 10, 100, 1000]) {
      assert.ok(roofAt(peak, intensity) <= peak.tflops, '屋顶不会比峰值算力高')
      assert.ok(roofAt(peak, intensity) <= (peak.gbps * intensity) / 1000 + 1e-12, '也不会比带宽 × 算术强度高')
    }
  }
})

test('归谁管：比拐点小归带宽管，正好在拐点上和右边归算力管（同 hg.roofline 的 intensity < ridge）', () => {
  assert.equal(boundOf(MID, 39.9), 'bandwidth')
  assert.equal(boundOf(MID, 40), 'compute')
  assert.equal(boundOf(MID, 1000), 'compute')
  assert.equal(boundOf(SPEC_PEAK, intensityOf(addWork(ADD_N))), 'bandwidth', '加法在标称峰值的拐点左边')
})

test('屋顶线的假设：慢的那件说了算，量到的算力正好是这一点的屋顶，不超过峰值算力', () => {
  for (const peak of [MID, STEEP, SPEC_PEAK]) {
    for (const count of FMA_COUNTS) {
      const run = balance(peak, fmaWork(count))
      close(run.tflops, roofAt(peak, run.intensity), `每个线程 ${count} 次 FMA`)
      assert.equal(run.ms, Math.max(run.memoryMs, run.computeMs))
      assert.ok(run.ofPeak <= 1 + 1e-12)
      assert.equal(run.bound === 'compute', run.computeMs >= run.memoryMs, '归谁管和哪件慢对得上')
    }
  }
  // 热身：2²⁶ 个数的加法按标称峰值，搬 768 MiB 比做加法慢得多
  const add = balance(SPEC_PEAK, addWork(ADD_N))
  assert.equal(add.work.bytes, 768 * 2 ** 20)
  assert.ok(add.memoryMs > 100 * add.computeMs)
  assert.equal(add.ms, add.memoryMs)
})

// ── 工作量（同 Notebook 和 hg.check_mm_cost）──────────────────────────────────

test('工作量：加法每个数 1 次运算、12 字节；矩阵乘同 hg.check_mm_cost 的五种形状', () => {
  for (const n of [1, 2 ** 12, ADD_N]) close(intensityOf(addWork(n)), 1 / 12, `${n} 个数的加法`)
  // Notebook 屋顶线一节：4096 的方阵写成 2 * 4096**3 和 3 * 4 * 4096**2
  assert.deepEqual(mmWork(4096, 4096, 4096), { flops: 2 * 4096 ** 3, bytes: 3 * 4 * 4096 ** 2 })
  // lab.py 的 _MM_SHAPES：只看方阵查不出把 m·k·n 写成 n³ 这类错
  for (const [m, k, n] of [[4096, 16, 4096], [8192, 8192, 1], [512, 64, 2048], [1, 1, 1]]) {
    assert.deepEqual(mmWork(m, k, n), { flops: 2 * m * k * n, bytes: 4 * (m * k + k * n + m * n) }, `${m}×${k} 乘 ${k}×${n}`)
  }
})

test('FMA 测试同 hg.peak()：4096 次 FMA 的算术强度和 4096 的方阵矩阵乘一样，都远在标称拐点右边', () => {
  const count = FMA_TEST.chains * FMA_TEST.iterations
  assert.equal(FMA_COUNTS.at(-1), count, '旋钮最后一档就是 hg.peak() 的 16 条链 × 256 次')
  close(intensityOf(fmaWork(count)), mmIntensity(MM_SIZE), '两个都是 4096 × 2 ÷ 12')
  assert.ok(intensityOf(fmaWork(count)) > 5 * ridgeOf(SPEC_PEAK))
  assert.equal(balance(SPEC_PEAK, fmaWork(count)).bound, 'compute', 'hg.peak() 量到的是算力')
  assert.equal(balance(SPEC_PEAK, fmaWork(FMA_COUNT_DEFAULT)).bound, 'bandwidth', '默认 1 次：量到的还是带宽（能跑但不好）')
})

// ── 探索一：拷贝多大 ──────────────────────────────────────────────────────────

test('拷贝：越大越接近峰值带宽、永远到不了；64 KiB 大多是固定开销，512 MiB 到 99%', () => {
  const runs = COPY_EXPONENTS.map((e) => copyCase(e, SPEC_PEAK))
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i].gbps > runs[i - 1].gbps, `${COPY_EXPONENTS[i]} 比 ${COPY_EXPONENTS[i - 1]} 量得快`)
  for (const run of runs) {
    assert.ok(run.ofPeak < 1)
    assert.equal(run.moved, 2 * run.bytes, '读一遍、写一遍')
    close(run.ms, COPY_OVERHEAD_MS + run.transferMs, '一次拷贝的时间')
  }
  const small = copyCase(COPY_EXPONENT_DEFAULT, SPEC_PEAK)
  assert.equal(small.bytes, 64 * 2 ** 10, '默认是 Notebook 里那次 64 KiB 的小拷贝')
  assert.ok(small.overheadMs > 10 * small.transferMs)
  const big = runs.at(-1)
  assert.equal(big.bytes, 512 * 2 ** 20, '最后一档是 hg.peak() 拷的 512 MiB')
  assert.ok(big.ofPeak > 0.99)
})

test('拷贝：两块缓冲区一起装得下的最小一级缓存（恰好装满也算），装不下是 null', () => {
  const caches = [{ key: 'l2', label: 'L2', bytes: 8 * 2 ** 20, text: '8 MiB' }, { key: 'infinity', label: 'Infinity Cache', bytes: 64e6, text: '64 MB' }]
  const fit = (e) => copyCase(e, SPEC_PEAK, caches).cache?.key ?? null
  assert.equal(fit(14), 'l2')
  assert.equal(fit(20), 'l2', '每块 4 MiB，两块正好 8 MiB')
  assert.equal(fit(21), 'infinity')
  assert.equal(fit(22), 'infinity', '两块 32 MiB，装得进 64 MB')
  assert.equal(fit(24), null, '两块 128 MiB，都装不下')
  assert.equal(fit(27), null)
})

// ── 峰值从哪来：你的卡 → 档案馆 → 标称 ─────────────────────────────────────────

/** 存档里的一张卡（假想的数，不是哪款真实产品的读数）。 */
function card(peak) {
  return {
    id: 'gfx9999-10cu-fixture-gpu', name: 'Fixture GPU', gfx: 'gfx9999', cus: 10, wave: 32, memoryBytes: 2 ** 30,
    env: { rocm: null, torch: null, triton: null }, peak, at: '2026-11-09T08:00:00Z', importedAt: 0,
  }
}

/** 档案馆的一行摘要（伪造数据）。 */
function entry(changes = {}) {
  return {
    id: 'forge-roofline/shared-fixture-2026-11-09', stage: 'forge-roofline', route: 'shared', device: 'fixture',
    deviceInfo: { name: 'Fixture GPU', gfx: 'gfx9999', cus: 10 }, date: '2026-11-09', at: '2026-11-09T08:30:00Z', collector: 'test',
    example: false, platform: 'local', checks: { passed: 5, total: 5 }, metrics: { peak_gbps: 500, peak_tflops: 20, ridge: 40 },
    env: { rocm: null, torch: null, triton: null }, samples: 0, cells: 0,
    ...changes,
  }
}

test('峰值：卡片带着峰值就用你的卡；没测过峰值的卡、没有卡，退到档案馆，再退到标称', () => {
  const mine = pickPeak(card({ gbps: 612.4, tflops: 24.3, at: '2026-11-10T00:00:00Z' }), [entry()])
  assert.deepEqual({ source: mine.source, gbps: mine.gbps, tflops: mine.tflops, at: mine.at }, { source: 'card', gbps: 612.4, tflops: 24.3, at: '2026-11-10T00:00:00Z' })
  assert.equal(pickPeak(card(null), [entry()]).source, 'archive')
  assert.equal(pickPeak(null, [entry()]).source, 'archive')
  assert.equal(pickPeak(null, []), SPEC_PEAK)
  for (const bad of [{ gbps: 0, tflops: 20 }, { gbps: 500, tflops: Number.NaN }, { gbps: -1, tflops: 20 }]) {
    assert.equal(cardPeak(card({ ...bad, at: '2026-11-10T00:00:00Z' })), null, `卡片里的峰值 ${JSON.stringify(bad)} 不用`)
  }
})

test('档案馆：只认这一关的真实记录、凭证里带着两个峰值的；几条都有时用新的那条', () => {
  assert.equal(archivePeak([entry({ example: true })]), null, '示例条目不算')
  assert.equal(archivePeak([entry({ stage: 'forge-trusted-timing' })]), null, '别的关卡的记录不算')
  assert.equal(archivePeak([entry({ metrics: { add_gbps: 480 } })]), null, '凭证里没有峰值')
  const older = entry({ id: 'forge-roofline/shared-a-2026-11-01', at: '2026-11-01T00:00:00Z', metrics: { peak_gbps: 400, peak_tflops: 10 } })
  const newer = entry({ id: 'forge-roofline/shared-b-2026-11-20', at: '2026-11-20T00:00:00Z', metrics: { peak_gbps: 600, peak_tflops: 30 } })
  const peak = archivePeak([older, newer, entry({ example: true, at: '2026-12-01T00:00:00Z' })])
  assert.deepEqual({ entry: peak.entry, gbps: peak.gbps, tflops: peak.tflops }, { entry: newer.id, gbps: 600, tflops: 30 })
})

test('标称峰值：hardware.json 里显存带宽要是 GB/s、FP32 算力要是 TFLOPS，缺了或单位不对就不用', () => {
  const device = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
  const peak = specPeak(device)
  assert.equal(peak.source, 'spec')
  assert.equal(peak.device, device.name)
  const params = device.params
  assert.equal(specPeak({ ...device, params: { ...params, memoryBandwidth: { ...params.memoryBandwidth, unit: 'GiB/s' } } }), null)
  assert.equal(specPeak({ ...device, params: { ...params, peakFp32: { ...params.peakFp32, value: '[待实测]' } } }), null)
  const { peakFp32, ...withoutFp32 } = params
  assert.equal(specPeak({ ...device, params: withoutFp32 }), null)
})

// ── 探索三：拖动矩阵乘的点 ─────────────────────────────────────────────────────

test('矩阵乘：k 越大越往右，接近 1024 FLOP/字节；k = 16 在标称拐点左边，k = 4096 在右边', () => {
  for (let i = 1; i < MM_KS.length; i++) assert.ok(mmIntensity(MM_KS[i]) > mmIntensity(MM_KS[i - 1]))
  assert.ok(mmIntensity(MM_KS.at(-1)) < 1024)
  assert.equal(MM_K_DEFAULT, 16, '默认是 Notebook 挑战的起点')
  assert.equal(boundOf(SPEC_PEAK, mmIntensity(MM_K_DEFAULT)), 'bandwidth')
  assert.equal(boundOf(SPEC_PEAK, mmIntensity(4096)), 'compute')
  // 拐点挪到 150 FLOP/字节（假想的峰值），矩阵乘要到 k = 512 才过拐点
  assert.equal(MM_KS.find((k) => boundOf(STEEP, mmIntensity(k)) === 'compute'), 512)
})

test('拖到哪：每一档的算术强度拖回原来那一档；两档之间按对数距离取近的，拖出图外取两头', () => {
  for (const k of MM_KS) assert.equal(nearestK(mmIntensity(k)), k)
  const [a, b] = [mmIntensity(64), mmIntensity(128)]
  assert.equal(nearestK(a * (b / a) ** 0.4), 64)
  assert.equal(nearestK(a * (b / a) ** 0.6), 128)
  assert.equal(nearestK(1e-6), 16)
  assert.equal(nearestK(1e6), 4096)
  assert.equal(nearestK(0), 16)
})

test('坐标轴：三个点和拐点都在图里，拐点离两头至少两个数量级；屋顶从左端到平顶都画得下', () => {
  const extremes = [SPEC_PEAK, MID, STEEP, { gbps: 50, tflops: 200 }, { gbps: 3000, tflops: 1 }]
  for (const peak of extremes) {
    const { x, y } = roofAxes(peak)
    const ridge = Math.log10(ridgeOf(peak))
    assert.ok(ridge - x.from >= 2 && x.to - ridge >= 2, `${JSON.stringify(peak)} 的拐点`)
    for (const intensity of [intensityOf(addWork(ADD_N)), ...MM_KS.map(mmIntensity), intensityOf(fmaWork(4096))]) {
      const at = logFraction(intensity, x)
      assert.ok(at > 0 && at < 1, `算术强度 ${intensity} 在横轴里`)
    }
    assert.ok(roofAt(peak, 10 ** x.from) >= 10 ** y.from, '屋顶左端不掉出图底')
    assert.ok(peak.tflops < 10 ** y.to, '平顶下面还留着一截')
    close(logValueAt(logFraction(123.4, x), x), 123.4, '位置和数来回换')
  }
})

// ── 写法 ──────────────────────────────────────────────────────────────────

test('写法：时间 0.1 ms 以下换成微秒；比例 10% 以下留一位小数；次数按万、亿写；刻度和上标', () => {
  assert.equal(msText(1.2582912), '1.26 ms')
  assert.equal(msText(0.157), '0.157 ms')
  assert.equal(msText(0.0102), '10.2 µs')
  assert.equal(msText(0.0000205), '0.0205 µs')
  assert.equal(percentText(0.994), '99%')
  assert.equal(percentText(0.0196), '2.0%')
  assert.equal(countText(2 ** 26), '6711 万')
  assert.equal(countText(2 * 4096 * 2 ** 23), '687 亿')
  assert.equal(countText(512), '512')
  assert.deepEqual([-3, -1, 0, 1, 4].map(decadeLabel), ['0.001', '0.1', '1', '10', '10000'])
  assert.equal(powerText(26), '2²⁶')
  assert.equal(powerText(14), '2¹⁴')
})
