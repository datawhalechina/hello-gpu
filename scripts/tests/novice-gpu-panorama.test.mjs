import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES, PENDING } from '../../docs/course/hardware.ts'
import { stageById } from '../../docs/course/outline.ts'
import {
  CARD_SOURCE, DEFAULT_SPEC, START, childCount, clampPath, countsOf, crumbsOf, describe, gridUnits, laneFormula, layoutOf,
  levelsOf, specFromCard, zoomFrame, zoomIn, zoomOut, zoomOutTo,
} from '../../docs/novice/gpu-panorama/panorama.ts'
import { STEP, journeyFrame, journeySteps, stepDuration } from '../../docs/novice/gpu-panorama/journey.ts'
import {
  ALL_PLANS, ARRAY_BYTES, BEST_COPIES, BEST_PLAN, DEFAULT_PLAN, STAR_LABELS, TARGET_COPIES,
  codeLine, hostCode, judge, normalizePlan, opsOf, runPlan,
} from '../../docs/novice/gpu-panorama/challenge.ts'

/** 1-2 走进工坊城：全景图的参数、逐层放大和布局，旅程动画的每一帧，挑战的星级判定（06 第 7 节）。 */

const RX = HARDWARE_DEVICES[DEFAULT_DEVICE_ID].params
const MODES = ['wide', 'narrow']

// ── 全景图的参数 ──────────────────────────────────────────────────────────

test('RX 9070 XT：按结构乘出来的 lane 数，和产品页上的流处理器个数对得上', () => {
  // 计算单元数、流处理器数来自产品页；每个 WGP 两个计算单元、每个计算单元两条 SIMD32 来自 RDNA4 ISA 指南。
  // 两边独立出处，乘出来对上，说明结构上的几个数没有抄错。
  const c = countsOf(DEFAULT_SPEC)
  assert.equal(c.lanes, RX.streamProcessors.value)
  assert.deepEqual(c, { wgps: 32, cus: 64, simds: 128, lanes: 4096 })
  assert.equal(laneFormula(DEFAULT_SPEC), '4096 个 lane = 64 个计算单元 × 2 条 SIMD × 32 个 lane')
})

test('换一张卡（L-07）：数从参数来，全景图的计数、解读和布局跟着变', () => {
  const big = { ...DEFAULT_SPEC, name: '一张假想的卡', cuCount: 96, l2: undefined, infinityCache: undefined, vram: undefined, bus: undefined, waveSizes: [] }
  assert.deepEqual(countsOf(big), { wgps: 48, cus: 96, simds: 192, lanes: 6144 })
  const chip = describe(big, START)
  assert.match(chip.lines[0], /48 个 WGP.*一共 96 个计算单元/)
  // 卡片里没有的数写「[待实测]」，不会冒出 undefined、NaN
  for (const level of levelsOf(big)) {
    const text = JSON.stringify(describe(big, { ...START, level }))
    assert.doesNotMatch(text, /undefined|NaN/, level)
  }
  assert.ok(chip.lines.join('').includes(PENDING))
  assert.ok(describe(big, { ...START, level: 'simd' }).lines.join('').includes(PENDING))
  for (const mode of MODES) assert.equal(layoutOf(big, START, mode).units.length, 48)
})

test('没有 WGP 这一层的卡（每个 WGP 只有 1 个计算单元）：从芯片直接放大到计算单元', () => {
  const flat = { ...DEFAULT_SPEC, cuCount: 40, cusPerWgp: 1 }
  assert.deepEqual(levelsOf(flat), ['chip', 'cu', 'simd', 'lane'])
  assert.equal(countsOf(flat).wgps, 0)
  assert.equal(childCount(flat, START), 40)
  const cu = zoomIn(flat, START, 39)
  assert.equal(cu.level, 'cu')
  assert.equal(cu.cu, 39)
  assert.deepEqual(crumbsOf(flat, cu).map((c) => c.label), ['整块芯片', '计算单元 39'])
  assert.equal(zoomOut(flat, cu).level, 'chip')
  assert.match(describe(flat, START).lines[0], /^40 个计算单元/)
})

test('换卡时路径收回到新卡的范围里：序号超出就取最后一个，新卡没有的层退回芯片', () => {
  const deep = { level: 'lane', wgp: 31, cu: 1, simd: 1, lane: 31 }
  const small = { ...DEFAULT_SPEC, cuCount: 40, lanesPerSimd: 16 }
  assert.deepEqual(clampPath(small, deep), { level: 'lane', wgp: 19, cu: 1, simd: 1, lane: 15 })
  const flat = { ...DEFAULT_SPEC, cusPerWgp: 1 }
  assert.equal(clampPath(flat, { ...deep, level: 'wgp' }).level, 'chip')
})

/** 「我的 GPU 卡片」里的一张卡（伪造数据，progress.ts 的 DeviceRecord）。 */
const CARD = {
  id: 'gfx1201-48cu-fixture-gpu', name: 'Fixture GPU', gfx: 'gfx1201', cus: 48, wave: 32, memoryBytes: 17_163_091_968,
  env: { rocm: null, torch: '0.0.0+fixture', triton: null }, peak: null, at: '2026-11-08T10:00:00Z', importedAt: 0,
}

test('读者的 GPU 卡片（L-07）：CU 数、wave、显存是卡片的；结构照抄同一个 gfx 的官方资料；卡片里没有的不画', () => {
  const spec = specFromCard(CARD)
  assert.deepEqual(countsOf(spec), { wgps: 24, cus: 48, simds: 96, lanes: 3072 })
  assert.deepEqual([spec.name, spec.gfx, spec.waveSizes, spec.vram], ['Fixture GPU', 'gfx1201', [32], { value: 16, unit: 'GiB' }])
  assert.deepEqual([spec.l2, spec.infinityCache, spec.vramType, spec.bus], [undefined, undefined, undefined, undefined])
  assert.deepEqual(spec.ldsPerWgp, DEFAULT_SPEC.ldsPerWgp)
  // 「这些数从哪来」：卡片里的数写「你的 GPU 卡片」，结构上的数带着 hardware.json 的出处，一条也不缺
  const from = Object.fromEntries(spec.facts.map((f) => [f.label, f]))
  for (const label of ['计算单元（CU）', 'wave 大小', '显存容量', 'LLVM 目标名']) assert.equal(from[label].from, CARD_SOURCE, label)
  for (const key of ['arch', 'cusPerWgp', 'simdsPerCu', 'lanesPerSimd', 'ldsPerWgp']) {
    const fact = from[RX[key].label]
    assert.ok(fact?.url && fact.where.includes(RX[key].where), key)
  }
  for (const level of levelsOf(spec)) {
    assert.doesNotMatch(JSON.stringify(describe(spec, { ...START, level })), /undefined|NaN/, level)
  }
  assert.match(describe(spec, START).lines[2], /16 GiB/)

  // 不知道 wave 大小：用这个 gfx 在官方资料里的 wave 大小
  assert.deepEqual(specFromCard({ ...CARD, wave: null }).waveSizes, DEFAULT_SPEC.waveSizes)
  // hardware.json 里没有这个 gfx：结构没有出处，画不出来
  assert.equal(specFromCard({ ...CARD, gfx: 'gfx1100' }), null)
})

// ── 逐层放大 ─────────────────────────────────────────────────────────────

test('逐层放大：芯片 → WGP 5 → 计算单元 1 → SIMD 0 → lane 12，再一层层退回去', () => {
  let p = START
  for (const [index, level] of [[5, 'wgp'], [1, 'cu'], [0, 'simd'], [12, 'lane']]) {
    p = zoomIn(DEFAULT_SPEC, p, index)
    assert.equal(p.level, level)
  }
  assert.deepEqual(p, { level: 'lane', wgp: 5, cu: 1, simd: 0, lane: 12 })
  assert.deepEqual(crumbsOf(DEFAULT_SPEC, p).map((c) => c.label), ['整块芯片', 'WGP 5', '计算单元 1', 'SIMD 0', 'lane 12'])
  // 最里面一层不能再放大；序号不对时不动
  assert.equal(zoomIn(DEFAULT_SPEC, p, 0), p)
  assert.equal(zoomIn(DEFAULT_SPEC, START, 32), START)
  assert.equal(zoomIn(DEFAULT_SPEC, START, -1), START)
  assert.equal(zoomIn(DEFAULT_SPEC, START, 1.5), START)
  // 往外退：一层，或者直接退到芯片；不能「退」到更里面
  assert.equal(zoomOut(DEFAULT_SPEC, p).level, 'simd')
  assert.equal(zoomOutTo(DEFAULT_SPEC, p, 'chip').level, 'chip')
  assert.equal(zoomOutTo(DEFAULT_SPEC, { ...p, level: 'wgp' }, 'lane').level, 'wgp')
  assert.equal(zoomOut(DEFAULT_SPEC, START), START)
})

test('每一层的解读：数都从参数来，说到这一层有什么', () => {
  const at = (level) => describe(DEFAULT_SPEC, { ...START, level, wgp: 5, cu: 1, simd: 0, lane: 12 })
  assert.match(at('chip').lines.join(''), /32 个 WGP.*64 个计算单元.*L2 缓存 8 MiB.*Infinity Cache 64 MB.*16 GB GDDR6.*PCIe 5\.0 x16/)
  assert.match(at('wgp').lines.join(''), /2 个计算单元.*LDS（128 KB）/)
  assert.match(at('cu').lines.join(''), /2 条 SIMD.*每条 32 个 lane.*一共 64 个 lane.*一共 4096 个 lane/)
  // 小队和货架在第几关细讲，编号从大纲取
  assert.match(at('simd').lines.join(''), new RegExp(`32 或 64 人（第 ${stageById('novice-wavefront').code} 关细讲）`))
  assert.match(at('wgp').lines.join(''), new RegExp(`第 ${stageById('novice-lds-sync').code} 关细讲`))
  assert.match(at('lane').lines.join(''), /寄存器.*c\[i\]/)
})

// ── 布局 ─────────────────────────────────────────────────────────────────

const inside = (b, f) => b.x >= f.x - 1e-9 && b.y >= f.y - 1e-9 && b.x + b.w <= f.x + f.w + 1e-9 && b.y + b.h <= f.y + f.h + 1e-9
const overlap = (a, b) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9

test('布局：每一层能点的部件个数对、都在外框里、互不重叠，缓存和 LDS 也在外框里', () => {
  const path = { ...START, wgp: 5, cu: 1, simd: 0, lane: 12 }
  for (const mode of MODES) {
    for (const level of levelsOf(DEFAULT_SPEC)) {
      const p = { ...path, level }
      const l = layoutOf(DEFAULT_SPEC, p, mode)
      assert.equal(l.units.length, childCount(DEFAULT_SPEC, p), `${mode} ${level}`)
      for (const u of [...l.units, ...l.shelves]) assert.ok(inside(u, l.frame), `${mode} ${level} 越出外框`)
      for (const [i, a] of l.units.entries()) {
        for (const b of l.units.slice(i + 1)) assert.ok(!overlap(a, b), `${mode} ${level} 部件重叠`)
        for (const s of l.shelves) assert.ok(!overlap(a, s), `${mode} ${level} 部件压住了 ${s.label}`)
      }
      // 外框下面是显存：在画面里，在外框下方（02 第 3 节：显存在下）
      assert.ok(l.below.y >= l.frame.y + l.frame.h && l.below.y + l.below.h <= l.view.h)
    }
  }
  // 芯片这一层有两层缓存，WGP 这一层有 LDS，SIMD 这一层有「一条指令」
  assert.deepEqual(layoutOf(DEFAULT_SPEC, START, 'wide').shelves.map((s) => `${s.label} ${s.text}`), ['L2 缓存 8 MiB', 'Infinity Cache 64 MB'])
  assert.deepEqual(layoutOf(DEFAULT_SPEC, { ...path, level: 'wgp' }, 'narrow').shelves.map((s) => `${s.label} ${s.text}`), ['LDS 128 KB'])
})

test('布局：1 到 120 个部件都能排进方阵，一个不多、一个不少', () => {
  const area = { x: 20, y: 40, w: 280, h: 182 }
  for (let n = 1; n <= 120; n++) {
    const { units, cols } = gridUnits(n, area, 0.8, 6, () => 2)
    assert.equal(units.length, n)
    assert.deepEqual(units.map((u) => u.index), [...Array(n).keys()])
    assert.ok(cols >= 1 && cols <= 16)
    for (const u of units) assert.ok(inside(u, area) && u.w > 0 && u.h > 0, `${n} 个时越界`)
  }
})

test('放大的衔接：按 zoomFrame 缩放，外框正好落在被点的那个部件上', () => {
  const path = { ...START, wgp: 5, cu: 1, simd: 0, lane: 12 }
  for (const mode of MODES) {
    const levels = levelsOf(DEFAULT_SPEC)
    for (const child of levels.slice(1)) {
      const parent = layoutOf(DEFAULT_SPEC, { ...path, level: levels[levels.indexOf(child) - 1] }, mode)
      const unit = parent.units[{ wgp: path.wgp, cu: path.cu, simd: path.simd, lane: path.lane }[child]]
      const { ox, oy, sx, sy } = zoomFrame(DEFAULT_SPEC, path, child, mode)
      const f = parent.frame
      const mapX = (x) => ox + sx * (x - ox)
      const mapY = (y) => oy + sy * (y - oy)
      for (const [got, want] of [[mapX(f.x), unit.x], [mapX(f.x + f.w), unit.x + unit.w], [mapY(f.y), unit.y], [mapY(f.y + f.h), unit.y + unit.h]]) {
        assert.ok(Math.abs(got - want) < 1e-6, `${mode} ${child}：${got} ≠ ${want}`)
      }
    }
  }
})

// ── 旅程动画 ─────────────────────────────────────────────────────────────

test('旅程：出发前，然后四站和大纲写的顺序一样；旁白时长按 02 第 2 节算，通道的名字从参数来', () => {
  const outline = stageById('novice-gpu-panorama').interaction
  const order = outline.slice(outline.indexOf('：') + 1).split('→').map((s) => s.trim())
  const steps = journeySteps(DEFAULT_SPEC.bus)
  assert.deepEqual(steps.map((s) => s.label), ['出发前', ...order])
  assert.ok(steps[STEP.copyIn].narration.includes(`（${RX.bus.value}）`))
  for (const s of steps) assert.equal(s.duration, Math.min(8000, 1500 + s.narration.length * 60))
  assert.equal(stepDuration('字'.repeat(50)), 4500)
  assert.equal(stepDuration('字'.repeat(200)), 8000)
})

const data = (f) => ({ host: f.host, vram: f.vram, dispatched: f.dispatched, packets: f.packets })

test('旅程每一步做完的样子：出发前显存是空的；拷进以后有 a、b；算完有 c；拷回以后 CPU 才有 c', () => {
  const end = (step) => journeyFrame(step, Number.POSITIVE_INFINITY)
  // ScenePlayer 一打开显示第一步做完的样子：还没出发
  assert.deepEqual(data(end(STEP.ready)), { host: { a: 1, b: 1, c: 0 }, vram: { a: 0, b: 0, c: 0 }, dispatched: 0, packets: [] })
  assert.deepEqual(data(end(STEP.copyIn)), { host: { a: 1, b: 1, c: 0 }, vram: { a: 1, b: 1, c: 0 }, dispatched: 0, packets: [] })
  assert.equal(end(STEP.launch).dispatched, 1)
  assert.deepEqual(end(STEP.compute).vram, { a: 1, b: 1, c: 1 })
  assert.equal(end(STEP.compute).host.c, 0)
  assert.equal(end(STEP.compute).computing, false)
  assert.equal(end(STEP.compute).waiting, false)
  assert.deepEqual(end(STEP.copyOut).host, { a: 1, b: 1, c: 1 })
})

test('旅程的中途：a、b 在路上时显存里还没有；算的时候 CPU 在等，c 一点点写进显存；c 往回走', () => {
  const copying = journeyFrame(STEP.copyIn, 1000)
  assert.deepEqual(copying.packets.map((p) => `${p.id}:${p.dir}`), ['a:in', 'b:in'])
  for (const p of copying.packets) assert.ok(p.t > 0 && p.t < 1)
  assert.deepEqual(copying.vram, { a: 0, b: 0, c: 0 })

  const launching = journeyFrame(STEP.launch, 900)
  assert.deepEqual(launching.packets.map((p) => p.id), ['order'])
  assert.equal(launching.dispatched, 0)

  const computing = journeyFrame(STEP.compute, 1600)
  assert.equal(computing.computing, true)
  assert.equal(computing.waiting, true)
  assert.ok(computing.vram.c > 0 && computing.vram.c < 1)

  const back = journeyFrame(STEP.copyOut, 1000)
  assert.deepEqual(back.packets.map((p) => `${p.id}:${p.dir}`), ['c:out'])
  assert.equal(back.host.c, 0)
})

test('旅程的画面是时间的纯函数：一步里只往前走，步与步之间接得上（拖动进度条不跳）', () => {
  const steps = journeySteps(DEFAULT_SPEC.bus)
  const last = steps.length - 1
  for (let s = 0; s <= last; s++) {
    let prev = journeyFrame(s, 0)
    for (let t = 50; t <= steps[s].duration; t += 50) {
      const f = journeyFrame(s, t)
      for (const side of ['host', 'vram']) for (const k of ['a', 'b', 'c']) assert.ok(f[side][k] >= prev[side][k], `第 ${s} 步 ${t} ms 的 ${side}.${k} 往回走了`)
      assert.ok(f.dispatched >= prev.dispatched)
      prev = f
    }
    // 一步的结尾就是做完的样子，下一步的开头接着它
    assert.deepEqual(data(journeyFrame(s, steps[s].duration)), data(journeyFrame(s, Number.POSITIVE_INFINITY)))
    if (s < last) assert.deepEqual(data(journeyFrame(s + 1, 0)), data(journeyFrame(s, Number.POSITIVE_INFINITY)))
  }
  // 拖到时间轴外面：开始前按 0 算，步数超出按最后一步算
  assert.deepEqual(journeyFrame(STEP.copyIn, -100), journeyFrame(STEP.copyIn, 0))
  assert.deepEqual(journeyFrame(9, Number.POSITIVE_INFINITY), journeyFrame(last, Number.POSITIVE_INFINITY))
})

// ── 挑战：三排数加起来 ─────────────────────────────────────────────────────

test('默认搬法「能跑但不好」：结果对，t 拷回又拷进，多搬两次，只有 ★1', () => {
  const trip = runPlan(DEFAULT_PLAN)
  assert.equal(trip.correct, true)
  assert.equal(trip.copies, 6)
  assert.equal(trip.bytes, 6 * ARRAY_BYTES)
  const verdict = judge(DEFAULT_PLAN)
  assert.deepEqual(verdict.earned, [true, false, false])
  assert.match(verdict.next, new RegExp(`拷贝 6 次.*目标是不超过 ${TARGET_COPIES} 次。t 从显存拷回 CPU、又拷进显存，来回搬了 8000 字节`))
})

test('最佳搬法只有一种：a、b、c 拷进显存，t 留在显存，out 拷回；三颗星', () => {
  const best = ALL_PLANS.filter((p) => runPlan(p).correct && runPlan(p).copies === BEST_COPIES)
  assert.equal(best.length, 1)
  assert.deepEqual({ ...BEST_PLAN }, { a: 'in', b: 'in', c: 'in', t: 'keep', out: 'back' })
  assert.equal(BEST_COPIES, 4)
  const verdict = judge(BEST_PLAN)
  assert.deepEqual(verdict.earned, [true, true, true])
  assert.equal(verdict.error, undefined)
  assert.match(verdict.next, /拷贝 4 次，一共 16000 字节/)
})

test('★2 和 ★3 分得开：t 只拷回不拷进，结果照样对（显存里那份还在），拷贝 5 次', () => {
  const plan = { ...BEST_PLAN, t: 'back' }
  assert.equal(runPlan(plan).correct, true)
  const verdict = judge(plan)
  assert.deepEqual(verdict.earned, [true, true, false])
  assert.match(verdict.next, /拷贝 5 次.*还能少 1 次。t 拷回 CPU 这一次用不上/)
  // 目标卡在中间：默认的 6 次过不了，5 次能过，最少的 4 次也能过
  assert.ok(runPlan(DEFAULT_PLAN).copies > TARGET_COPIES)
  assert.ok(runPlan(plan).copies <= TARGET_COPIES && BEST_COPIES <= TARGET_COPIES)
  assert.match(STAR_LABELS[1], new RegExp(`不超过 ${TARGET_COPIES} 次`))
})

test('★1：缺了哪排输入、out 没拷回，一颗星都不发，说清现象、原因、怎么改', () => {
  for (const x of ['a', 'b', 'c']) {
    const verdict = judge({ ...BEST_PLAN, [x]: 'none' })
    assert.deepEqual(verdict.earned, [false, false, false], x)
    for (const part of ['symptom', 'cause', 'fix']) assert.ok(verdict.error[part].trim(), `${x} ${part}`)
    assert.match(verdict.error.symptom, new RegExp(`显存里没有 ${x}`))
    assert.equal(verdict.error.fix, `把 ${x} 拷进显存。`)
    assert.equal(verdict.next, verdict.error.fix)
  }
  const kept = judge({ ...BEST_PLAN, out: 'keep' })
  assert.deepEqual(kept.earned, [false, false, false])
  assert.match(kept.error.symptom, /CPU 没拿到 out/)
  assert.match(kept.error.fix, /把 out 拷回 CPU/)

  // 两样都错：两条都要说到
  const both = judge({ ...DEFAULT_PLAN, a: 'none', b: 'none', out: 'keep' })
  assert.match(both.error.symptom, /显存里没有 a、b.*CPU 没拿到 out/)
  assert.match(both.error.fix, /把 a、b 拷进显存。最后把 out 拷回 CPU。/)

  // 结果表逐步写对错：错的数拷来拷去，每一步都标成错，不会显示「对」
  const rows = runPlan({ ...DEFAULT_PLAN, b: 'none' }).steps.filter((s) => s.op.kind !== 'wait')
  assert.deepEqual(rows.map((s) => s.ok), [true, true, false, false, false, false, false])
  assert.deepEqual(rows.map((s) => s.note).filter(Boolean), ['显存里没有 b', '显存里的 t 是算错了的', '拷进去的 t 是算错了的', 't 是算错了的', '显存里的 out 是算错了的'])
})

test('48 种搬法：结果对 ⇔ 三排输入都拷进、out 拷回；拷贝次数就是代码里拷贝的行数', () => {
  assert.equal(ALL_PLANS.length, 48)
  assert.equal(new Set(ALL_PLANS.map((p) => JSON.stringify(p))).size, 48)
  for (const p of ALL_PLANS) {
    const trip = runPlan(p)
    const want = p.a === 'in' && p.b === 'in' && p.c === 'in' && p.out === 'back'
    assert.equal(trip.correct, want, JSON.stringify(p))
    const verdict = judge(p)
    if (!want) assert.deepEqual(verdict.earned, [false, false, false])
    else assert.equal(verdict.earned[0], true)
    const copyLines = hostCode(p, 'hip').split('\n').filter((l) => l.startsWith('hipMemcpy('))
    assert.equal(copyLines.length, trip.copies)
    assert.equal(trip.bytes, trip.copies * ARRAY_BYTES)
  }
})

test('两种写法：同一种搬法写出来是同一串操作，每段不超过 10 行（05 第 1 节）', () => {
  const pattern = {
    'copy-in': { hip: /^hipMemcpy\(d_(\w+), \1, bytes, hipMemcpyHostToDevice\);$/, python: /^d_(\w+) = to_device\(\1\)$/ },
    'copy-out': { hip: /^hipMemcpy\((\w+), d_\1, bytes, hipMemcpyDeviceToHost\);$/, python: /^(\w+) = to_host\(d_\1\)$/ },
    launch: { hip: /^add<<<blocks, threads>>>\((.+)\);$/, python: /^add\[blocks, threads\]\((.+)\)$/ },
    wait: { hip: /^hipDeviceSynchronize\(\);$/, python: /^synchronize\(\)$/ },
  }
  for (const p of ALL_PLANS) {
    const ops = opsOf(p)
    const hip = hostCode(p, 'hip').split('\n')
    const py = hostCode(p, 'python').split('\n')
    assert.equal(hip.length, ops.length)
    assert.equal(py.length, ops.length)
    assert.ok(ops.length <= 10)
    ops.forEach((op, i) => {
      const h = pattern[op.kind].hip.exec(hip[i])
      const y = pattern[op.kind].python.exec(py[i])
      assert.ok(h && y, `${JSON.stringify(p)} 第 ${i + 1} 行：${hip[i]} / ${py[i]}`)
      // 拷的是同一排数，启动时传的是同一串参数
      assert.equal(h[1] ?? '', y[1] ?? '')
    })
  }
  assert.equal(codeLine({ kind: 'launch', out: 'out', inputs: ['t', 'c'] }, 'python'), 'add[blocks, threads](d_t, d_c, d_out, n)')
})

test('草稿里的搬法坏了：不认识的地方用默认值，判出来的星一样', () => {
  assert.deepEqual(normalizePlan(null), { ...DEFAULT_PLAN })
  assert.deepEqual(normalizePlan({ a: 'none', t: 'teleport', out: 7, extra: 'x' }), { ...DEFAULT_PLAN, a: 'none' })
  assert.deepEqual(judge({ t: 'keep' }).earned, judge(normalizePlan({ t: 'keep' })).earned)
  assert.deepEqual(judge({ t: 'keep' }).earned, [true, true, true])
})
