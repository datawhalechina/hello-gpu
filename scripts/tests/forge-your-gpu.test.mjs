import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '../../docs/course/hardware.ts'
import {
  BOOK_GPU, MATRIX_SIDES, THREAD_OPTIONS, WAVE_KINDS, binaryText, countsWgps, cuReading, cusPerBox, decimalText,
  gpuFromCard, matrixBytes, memoryFit, memoryText, waveSplit, waveText, waveVerdict,
} from '../../docs/forge/your-gpu/readings.ts'

/** 2-1 开工准备：三段探索里的数（CU 有几个、wave 多大、显存多少）。 */

const RX = HARDWARE_DEVICES[DEFAULT_DEVICE_ID].params
const GiB = 2 ** 30

/** 一张导入过的卡（存档里的样子）；数是假想的，不是哪款真实产品的读数。 */
function card(patch = {}) {
  return {
    id: 'fixture', name: 'Fixture GPU', gfx: 'gfx1201', cus: 64, wave: 32, memoryBytes: 16 * GiB,
    env: { rocm: null, torch: null, triton: null }, peak: null, at: '2026-11-11T00:00:00Z', importedAt: 0, ...patch,
  }
}

// ── 探索一：CU 有几个 ──────────────────────────────────────────────────────

test('PyTorch 报的数：和 hello_gpu 把它换成计算单元的规则互逆（同 test_lab.py 的那张表，环境变量按默认）', () => {
  // [gfx, PyTorch 报的 multi_processor_count, 卡片上的计算单元数]
  const cases = [
    ['gfx1201', 32, 64], // RDNA4：数的是 WGP
    ['gfx1100', 48, 96], // RDNA3
    ['gfx1151', 20, 40], // RDNA3.5
    ['gfx1030', 36, 72], // RDNA2
    ['gfx942', 304, 304], // CDNA 没有 WGP
    ['gfx90a', 104, 104],
    ['gfx1250', 64, 64], // gfx12.5 起不进 WGP 模式
    ['gfx9999', 10, 10], // 不认识的架构照原样
  ]
  for (const [gfx, reported, cus] of cases) {
    const gpu = gpuFromCard(card({ gfx, cus }))
    const torch = cuReading(gpu, 'torch')
    assert.equal(torch.value, reported, gfx)
    assert.equal(torch.unit, reported === cus ? 'cu' : 'wgp', gfx)
    // rocminfo 和卡片报的都是计算单元
    assert.deepEqual([cuReading(gpu, 'rocminfo').value, cuReading(gpu, 'card').value], [cus, cus], gfx)
  }
})

test('按不按 WGP 计数只认完整的 gfx 代号：通用 ISA、大写、空串都按计算单元', () => {
  for (const gfx of ['gfx1010', 'gfx1036', 'gfx1103', 'gfx1200', 'gfx1240']) assert.equal(countsWgps(gfx), true, gfx)
  for (const gfx of ['gfx1250', 'gfx1251', 'gfx900', 'gfx950', 'gfx12-generic', 'GFX1201', 'gfx1201:xnack-', '']) {
    assert.equal(countsWgps(gfx), false, gfx)
  }
})

test('本书的卡：PyTorch 报产品页计算单元数的一半，方格两个一框，和 RDNA4 指南里一个 WGP 两个计算单元对得上', () => {
  assert.equal(BOOK_GPU.cus, RX.cuCount.value)
  assert.equal(BOOK_GPU.gfx, RX.gfx.value)
  assert.equal(cusPerBox(BOOK_GPU.gfx), RX.cusPerWgp.value)
  const torch = cuReading(BOOK_GPU, 'torch')
  assert.deepEqual([torch.value, torch.unit], [RX.cuCount.value / 2, 'wgp'])
  assert.match(torch.text, new RegExp(`乘 2：${RX.cuCount.value} 个`))
})

test('不按 WGP 计数的卡：PyTorch 的数照填，一格一框，解读里不出现「乘 2」', () => {
  const gpu = gpuFromCard(card({ gfx: 'gfx942', cus: 304 }))
  assert.equal(cusPerBox(gpu.gfx), 1)
  for (const source of ['torch', 'rocminfo', 'card']) assert.doesNotMatch(cuReading(gpu, source).text, /乘 2/, source)
})

// ── 探索二：wave 多大 ──────────────────────────────────────────────────────

test('一组线程排成几个 wave：前面的坐满，最后一个坐剩下的，空着的 lane 不到一整个 wave', () => {
  for (const threads of [1, 20, 31, 32, 33, 96, 100, 160, 256, 1024]) {
    for (const { wave } of WAVE_KINDS) {
      const s = waveSplit(threads, wave)
      assert.equal((s.waves - 1) * wave + s.last, threads, `${threads}/${wave}`)
      assert.ok(s.last >= 1 && s.last <= wave && s.idle === wave - s.last, `${threads}/${wave}`)
    }
  }
  assert.deepEqual(waveSplit(96, 32), { threads: 96, wave: 32, waves: 3, last: 32, idle: 0 })
  assert.deepEqual(waveSplit(96, 64), { threads: 96, wave: 64, waves: 2, last: 32, idle: 32 })
  assert.equal(waveText(waveSplit(96, 32)), '32 个一队：3 个 wave，个个坐满。')
  assert.equal(waveText(waveSplit(96, 64)), '64 个一队：2 个 wave，最后一个只坐了 32 个，空着 32 个 lane。')
})

test('结论：64 的倍数两种卡都坐满，只是 32 的倍数时 wave 64 的卡空一半；旋钮的每个选项都落在这两种里', () => {
  assert.match(waveVerdict(128), /两种卡上的 wave 都坐满/)
  assert.match(waveVerdict(96), /wave 32 的卡坐满，wave 64 的卡最后一个 wave 空着一半/)
  assert.match(waveVerdict(100), /都坐不满/)
  for (const threads of THREAD_OPTIONS) assert.equal(threads % 32, 0, threads)
  assert.ok(THREAD_OPTIONS.some((t) => t % 64 !== 0) && THREAD_OPTIONS.some((t) => t % 64 === 0))
})

// ── 探索三：显存多少 ──────────────────────────────────────────────────────

test('三个 FP32 矩阵的大小：按 1024 和按 1000 进位各写一遍', () => {
  assert.equal(matrixBytes(32768), 12 * GiB)
  const shown = MATRIX_SIDES.map((n) => [binaryText(matrixBytes(n)), decimalText(matrixBytes(n))])
  assert.deepEqual(shown, [
    ['12 MiB', '12.6 MB'],
    ['192 MiB', '201 MB'],
    ['3 GiB', '3.2 GB'],
    ['12 GiB', '12.9 GB'],
    ['48 GiB', '51.5 GB'],
  ])
})

test('本书的卡按产品页的 16 GB 比：每个选项不管 GB 按 10⁹ 还是 2³⁰ 算，放不放得下都一样', () => {
  assert.equal(BOOK_GPU.memory.exact, false)
  assert.equal(BOOK_GPU.memory.text, `${RX.vramSize.value} ${RX.vramSize.unit}`)
  const asBinary = { ...BOOK_GPU.memory, bytes: RX.vramSize.value * GiB }
  for (const n of MATRIX_SIDES) {
    assert.equal(memoryFit(n, BOOK_GPU.memory).fits, memoryFit(n, asBinary).fits, n)
  }
  assert.equal(memoryFit(32768, BOOK_GPU.memory).fits, true)
  assert.equal(memoryFit(65536, BOOK_GPU.memory).fits, false)
  // 标称容量不精确：只说按它算放不放得下，不写占了百分之几
  assert.equal(memoryText(memoryFit(32768, BOOK_GPU.memory), BOOK_GPU), '三个矩阵 12 GiB（12.9 GB），没超过产品页的 16 GB：按标称容量算放得下。')
  assert.match(memoryText(memoryFit(65536, BOOK_GPU.memory), BOOK_GPU), /^三个矩阵 48 GiB（51.5 GB），超过了产品页的 16 GB：放不下/)
})

test('你的卡按卡片里的字节数比：写出占比；刚好装满也只说按总量算放得下', () => {
  const mine = gpuFromCard(card({ memoryBytes: 24 * GiB }))
  assert.equal(mine.memory.text, '24 GiB')
  assert.equal(memoryText(memoryFit(32768, mine.memory), mine), '三个矩阵 12 GiB（12.9 GB），占你这张卡的显存总量的 50%：按总量算放得下。')
  const exact = gpuFromCard(card({ memoryBytes: 12 * GiB }))
  assert.match(memoryText(memoryFit(32768, exact.memory), exact), /的 100%：按总量算放得下/)
  assert.equal(memoryFit(65536, exact.memory).fits, false)
  // 很小的占比写「不到 1%」，不四舍五入成 0%
  assert.match(memoryText(memoryFit(1024, mine.memory), mine), /占你这张卡的显存总量的不到 1%：按总量算放得下/)
})
