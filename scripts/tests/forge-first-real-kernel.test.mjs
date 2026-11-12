import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '../../docs/course/hardware.ts'
import {
  BOOK_WAVE, CHECK_LENGTHS, GUARD_ELEMENTS, HIP_MAX_THREADS, HOST_STEPS, ROUTE_GROUPS, TILE_OPTIONS, TRITON_NUM_WARPS,
  checkCase, checkReport, hostState, hostSteps, hostTimeline, tileSplit, waveOf,
} from '../../docs/forge/first-real-kernel/kernel.ts'

/** 2-2 第一个真 kernel：三段探索里的数（编译、运行、校验）。 */

const RX = HARDWARE_DEVICES[DEFAULT_DEVICE_ID].params

// ── 探索一：编译（一个线程，还是一块 tile）──────────────────────────────────

test('wave 大小按 gfx 代号的主版本定：gfx10 起 32，更早的 64（同 Triton AMD 后端的规则）；写法不对的读不出', () => {
  for (const gfx of ['gfx1201', 'gfx1200', 'gfx1151', 'gfx1100', 'gfx1030', 'gfx1010']) assert.equal(waveOf(gfx), 32, gfx)
  for (const gfx of ['gfx942', 'gfx950', 'gfx90a', 'gfx908', 'gfx906', 'gfx900']) assert.equal(waveOf(gfx), 64, gfx)
  for (const gfx of ['gfx12-generic', 'GFX1201', 'gfx1201:xnack-', 'gfx', '']) assert.equal(waveOf(gfx), null, gfx)
})

test('本书的卡按 wave 32 画，和 hardware.json 里它的 gfx 代号对得上', () => {
  assert.equal(waveOf(RX.gfx.value), BOOK_WAVE)
  assert.ok(RX.waveSizes.value.includes(BOOK_WAVE))
})

test('Triton 一个 program 的线程数只看 num_warps 和 wave 大小，块越大每个线程分得越多', () => {
  for (const wave of [32, 64]) {
    for (const elements of TILE_OPTIONS) {
      const { triton } = tileSplit(elements, wave)
      assert.equal(triton.threads, TRITON_NUM_WARPS * wave, `${elements}/${wave}`)
      assert.equal(triton.waves, TRITON_NUM_WARPS)
      // 旋钮的每个选项都能整分给线程，每个线程至少一个元素
      assert.ok(Number.isInteger(triton.perThread) && triton.perThread >= 1, `${elements}/${wave}`)
      assert.equal(triton.perThread * triton.threads, elements)
    }
  }
  // 正文和检查点用到的几个数
  assert.deepEqual(tileSplit(1024, 32).triton, { threads: 128, waves: 4, perThread: 8 })
  assert.deepEqual(tileSplit(4096, 32).triton, { threads: 128, waves: 4, perThread: 32 })
  assert.deepEqual(tileSplit(1024, 64).triton, { threads: 256, waves: 4, perThread: 4 })
})

test('HIP 一个线程算一个元素：组大小就是线程数，超过上限的那一组派不出去', () => {
  assert.deepEqual(tileSplit(256, 32).hip, { threads: 256, waves: 8, fits: true })
  assert.deepEqual(tileSplit(HIP_MAX_THREADS, 32).hip, { threads: 1024, waves: 32, fits: true })
  assert.deepEqual(tileSplit(1024, 64).hip, { threads: 1024, waves: 16, fits: true })
  assert.equal(tileSplit(4096, 32).hip.fits, false)
  assert.ok(TILE_OPTIONS.some((e) => e > HIP_MAX_THREADS), '旋钮里要有一个 HIP 装不下的块')
  for (const e of TILE_OPTIONS) assert.equal(e & (e - 1), 0, `${e} 要是 2 的幂（tl.arange 的要求）`)
})

test('块的大小和 wave 大小写错时直接报错，不画出半截的图', () => {
  assert.throws(() => tileSplit(0), /正整数/)
  assert.throws(() => tileSplit(1.5), /正整数/)
  assert.throws(() => tileSplit(1024, 48), /32 和 64/)
})

// ── 探索二：运行（主机端五步）────────────────────────────────────────────────

/** 一条道上的段按时间排好，互不重叠。 */
function assertSequential(segments, what) {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start >= sorted[i - 1].end, `${what} 的第 ${i} 段和前一段重叠`)
}

test('五步的顺序同 Notebook；去掉 ④ 只剩四步', () => {
  assert.deepEqual(HOST_STEPS.map((s) => s.mark), ['①', '②', '③', '④', '⑤'])
  assert.deepEqual(hostSteps(true).map((s) => s.id), ['alloc', 'copyIn', 'launch', 'sync', 'copyOut'])
  assert.deepEqual(hostSteps(false).map((s) => s.id), ['alloc', 'copyIn', 'launch', 'copyOut'])
})

test('时间线：启动马上返回，GPU 在 CPU 走开以后才算完；同一条道上的活不重叠，拷回排在计算后面', () => {
  for (const withSync of [true, false]) {
    const segments = hostTimeline(withSync)
    for (const lane of ['cpu', 'copy', 'gpu']) assertSequential(segments.filter((s) => s.lane === lane), `${lane}（withSync=${withSync}）`)
    const launch = segments.find((s) => s.lane === 'cpu' && s.step === 'launch')
    const compute = segments.find((s) => s.lane === 'gpu')
    const copyIn = segments.find((s) => s.lane === 'copy' && s.step === 'copyIn')
    const copyOut = segments.find((s) => s.lane === 'copy' && s.step === 'copyOut')
    assert.ok(compute.start >= launch.end && compute.start >= copyIn.end, '先拷进、再启动，GPU 才开始算')
    assert.ok(launch.end < compute.end, '启动的那一行在 GPU 算完之前就返回了')
    assert.ok(copyOut.start >= compute.end, '拷回要等 kernel 算完')
    // 拷进时 CPU 一直等到拷完；拷回时 CPU 等到拷完才拿到结果
    const cpu = segments.filter((s) => s.lane === 'cpu')
    assert.equal(cpu.find((s) => s.step === 'copyIn').end, copyIn.end)
    assert.equal(Math.max(...cpu.map((s) => s.end)), copyOut.end)
  }
})

test('留着 ④：CPU 在 ④ 等到 GPU 算完；去掉 ④：CPU 在 ⑤ 里等，结束的时刻一样', () => {
  const kept = hostTimeline(true)
  const dropped = hostTimeline(false)
  const computeEnd = kept.find((s) => s.lane === 'gpu').end
  assert.equal(kept.find((s) => s.step === 'sync').end, computeEnd)
  assert.equal(dropped.some((s) => s.step === 'sync'), false)
  const waitOut = dropped.find((s) => s.lane === 'cpu' && s.step === 'copyOut')
  assert.ok(waitOut.start < computeEnd, '去掉 ④ 以后，CPU 在 GPU 算完之前就走到了 ⑤')
  const end = (segments) => Math.max(...segments.map((s) => s.end))
  assert.equal(end(dropped), end(kept))
})

test('每一步之后数据在哪：③ 时 d_out 还在算，等过（④ 或 ⑤）才是结果，h_out 只在 ⑤ 以后有', () => {
  assert.deepEqual(hostState('alloc', true).device, { d_a: 'empty', d_b: 'empty', d_out: 'empty' })
  assert.deepEqual(hostState('copyIn', true).device, { d_a: 'data', d_b: 'data', d_out: 'empty' })
  const launch = hostState('launch', true)
  assert.equal(launch.device.d_out, 'pending')
  assert.equal(launch.gpuDone, false)
  assert.equal(hostState('sync', true).device.d_out, 'result')
  assert.equal(hostState('sync', true).host.h_out, 'none')
  for (const withSync of [true, false]) {
    const last = hostState('copyOut', withSync)
    assert.equal(last.gpuDone, true)
    assert.deepEqual([last.device.d_out, last.host.h_out], ['result', 'result'])
  }
  assert.throws(() => hostState('sync', false), /没有 sync/)
})

// ── 探索三：校验（多种长度 + 护栏）──────────────────────────────────────────

test('没写边界检查：越界写的个数就是最后一组多出来的，HIP 3/7、Triton 2/7（同 FG-LAB-02 冒烟时 hg.check 报的数）', () => {
  const [hip, triton] = ROUTE_GROUPS.map((r) => checkReport(r.group, false))
  assert.deepEqual(hip.cases.map((c) => c.oob), [255, 1, 0, 24, 0, 0, 255])
  assert.deepEqual(triton.cases.map((c) => c.oob), [1023, 769, 768, 24, 0, 0, 1023])
  assert.deepEqual([hip.passed, triton.passed, hip.total], [3, 2, 7])
  // 热身那道题：长度 1000，两条路线都派出 1024 个位置
  for (const r of ROUTE_GROUPS) assert.deepEqual([checkCase(1000, r.group, false).launched, checkCase(1000, r.group, false).oob], [1024, 24])
})

test('写了边界检查：7 个长度两条路线都过，护栏一个没变', () => {
  for (const r of ROUTE_GROUPS) {
    const report = checkReport(r.group, true)
    assert.equal(report.passed, report.total, r.name)
    assert.ok(report.cases.every((c) => c.oob === 0))
  }
})

test('派出去的位置刚好盖住长度：组数向上取整，多出来的不到一组，也都落在护栏里', () => {
  for (const r of ROUTE_GROUPS) {
    for (const n of [...CHECK_LENGTHS, 2, 999, 4097, 65535]) {
      const c = checkCase(n, r.group, false)
      assert.ok(c.launched >= n && (c.groups - 1) * r.group < n, `${r.name} n=${n}`)
      assert.equal(c.extra, c.launched - n)
      assert.ok(c.extra < r.group && c.extra < GUARD_ELEMENTS, `${r.name} n=${n}`)
      assert.equal(c.passed, c.extra === 0)
    }
  }
  assert.throws(() => checkCase(0, 256, false), /正整数/)
  assert.throws(() => checkCase(1000, 0, false), /正整数/)
})

test('7 个长度里有整组的，也有多一点、少一点的：两条路线都既有过的也有不过的', () => {
  for (const r of ROUTE_GROUPS) {
    const report = checkReport(r.group, false)
    assert.ok(report.passed > 0 && report.passed < report.total, r.name)
  }
})
