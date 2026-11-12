import assert from 'node:assert/strict'
import test from 'node:test'
import { run } from '../../docs/sim/lockstep.ts'
import { SIM_PARAMS } from '../../docs/sim/params.ts'
import { parse as parseKernel } from '../../docs/sim/syntax/index.ts'
import { buildRequest } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import {
  BEST_COST, BEST_PLACEMENT, DATA_ORDER, DEFAULT_COST, DEFAULT_PLACEMENT, PICKABLE, PLACES, PLACE_ORDER, SUM_BLANKS,
  SUM_CODE, SUM_LAUNCH, SUM_M, SUM_N, TARGET_COST, costOf, expectedSums, judge, normalizePlacement, placeVerdict,
  placementSummary, rowsArgs, tripsOf,
} from '../../docs/novice/memory-hierarchy/challenge.ts'

/**
 * 1-7 数据住在哪。地图上越近越快、越小；四个数各有一处最合适的住处；挑战补两个空：循环里把和加在哪、
 * 最后把哪里的和存进 out[t]，往返代价按模拟器的事件流数。两种写法的事件流（除了行号）、结果和判定都相同。
 */

const LANGS = ['hip', 'python']

/** 模板按读者填的内容拼成代码（两种写法里这两个空的写法一样）。 */
const source = (lang, values = {}) => fillTemplate(parseTemplate(SUM_CODE[lang]), values).source

/** 去掉行号（Python 多一行 @kernel），比两种写法的一次运行。 */
const strip = (result) => ({ ok: result.ok, arrays: result.arrays, steps: result.steps, events: result.events.map(({ line, ...e }) => e) })

/** 挑战点一次「运行」：两种写法的事件流（除了行号）、结果和判定都相同。 */
function challenge(values) {
  const [hip, python] = LANGS.map((lang) => [{ launch: SUM_LAUNCH, result: run(buildRequest(source(lang, values), lang, SUM_LAUNCH, rowsArgs())) }])
  assert.deepEqual(strip(python[0].result), strip(hip[0].result))
  const verdict = judge(hip)
  assert.deepEqual(judge(python), verdict)
  return { verdict, result: hip[0].result }
}

const ADD = {
  vram: 'out[t] = out[t] + a[k * n + t]',
  lds: 'box[threadIdx.x] = box[threadIdx.x] + a[k * n + t]',
  register: 's = s + a[k * n + t]',
  replace: 's = a[k * n + t]',
}
const SAVE = { plusS: 'out[t] = out[t] + s', box: 'out[t] = box[threadIdx.x]', s: 'out[t] = s' }

test('地图：从寄存器、LDS、缓存到显存一趟比一趟久；CPU 内存工作单够不着；显存一趟和 L4 的往返延迟是同一个示意值', () => {
  const cycles = PLACE_ORDER.map((p) => PLACES[p].cycles)
  assert.deepEqual(PLACE_ORDER, ['register', 'lds', 'cache', 'vram', 'host'])
  for (let i = 1; i < 4; i++) assert.ok(cycles[i] > cycles[i - 1], `${PLACE_ORDER[i]} 要比 ${PLACE_ORDER[i - 1]} 远`)
  assert.equal(PLACES.host.cycles, null)
  assert.equal(PLACES.vram.cycles, SIM_PARAMS.memLatency)
  // 越近越小：容量都从 hardware.json 来（RX 9070 XT）
  assert.equal(PLACES.register.size, '每个线程最多 256 个，一个装一个数')
  assert.equal(PLACES.lds.size, '每个 WGP 128 KB')
  assert.equal(PLACES.vram.size, '16 GB GDDR6')
})

test('挑住处：每个数正好一处最合适；缓存和 CPU 内存谁都住不进去；寄存器别人看不见，CPU 也拿不到', () => {
  for (const id of DATA_ORDER) {
    const best = PLACE_ORDER.filter((p) => placeVerdict(id, p).fit === 'best')
    assert.deepEqual(best, [BEST_PLACEMENT[id]], id)
    assert.equal(placeVerdict(id, 'cache').fit, 'no')
    assert.equal(placeVerdict(id, 'host').fit, 'no')
  }
  assert.deepEqual(BEST_PLACEMENT, { input: 'vram', partial: 'register', handoff: 'lds', result: 'vram' })
  // 要交给 0 号线程的和放寄存器、CPU 要的结果放寄存器或 LDS：拿不到
  assert.equal(placeVerdict('handoff', 'register').fit, 'no')
  assert.equal(placeVerdict('result', 'register').fit, 'no')
  assert.equal(placeVerdict('result', 'lds').fit, 'no')
  // 100 万个数放不进寄存器和 LDS
  assert.equal(placeVerdict('input', 'register').fit, 'no')
  assert.equal(placeVerdict('input', 'lds').fit, 'no')
  // 缓存不在能选的地方里
  assert.equal(PICKABLE.includes('cache'), false)
})

test('挑住处：默认全放显存，四个都能用、两个太远；全挑对了四个都最合适；存档里的怪值换回默认', () => {
  assert.deepEqual(
    (({ best, ok, no }) => ({ best, ok, no }))(placementSummary(DEFAULT_PLACEMENT)),
    { best: 2, ok: 2, no: 0 },
  )
  assert.deepEqual((({ best, ok, no }) => ({ best, ok, no }))(placementSummary(BEST_PLACEMENT)), { best: 4, ok: 0, no: 0 })
  assert.equal(placementSummary({ ...BEST_PLACEMENT, input: 'host' }).no, 1)
  assert.deepEqual(normalizePlacement({ input: 'cache', partial: 'register', handoff: 42, extra: 'lds' }), { ...DEFAULT_PLACEMENT, partial: 'register' })
  assert.deepEqual(normalizePlacement(null), DEFAULT_PLACEMENT)
})

test('热身：c[i] = a[i] + b[i] 这一行，每个线程跑 3 趟显存（取 a[i]、取 b[i]、存 c[i]）', () => {
  const code = {
    hip: '__global__ void add(float* a, float* b, float* c, int n) {\n    int i = blockIdx.x * blockDim.x + threadIdx.x;\n    if (i < n) {\n        c[i] = a[i] + b[i];\n    }\n}',
    python: '@kernel\ndef add(a, b, c, n):\n    i = blockIdx.x * blockDim.x + threadIdx.x\n    if i < n:\n        c[i] = a[i] + b[i]',
  }
  const args = { a: { type: 'float', data: [1, 2] }, b: { type: 'float', data: [10, 20] }, c: { type: 'float', data: [0, 0] }, n: { type: 'int', value: 2 } }
  for (const lang of LANGS) {
    const result = run(buildRequest(code[lang], lang, { grid: 1, block: 2 }, args))
    assert.deepEqual(result.arrays.c, [11, 22])
    assert.deepEqual(tripsOf(result.events), { vram: { load: 2, store: 1 }, lds: { load: 0, store: 0 } })
  }
})

test('挑战 ★1：默认写法算对了，可循环里每轮都去仓库取 out[t]、存 out[t]，一共 14 趟、1400 个周期（模拟）', () => {
  const { verdict, result } = challenge({})
  assert.deepEqual(result.arrays.out, expectedSums())
  assert.deepEqual(tripsOf(result.events), { vram: { load: 2 * SUM_M + 1, store: SUM_M + 1 }, lds: { load: 0, store: 0 } })
  assert.equal(costOf(tripsOf(result.events)), DEFAULT_COST)
  assert.equal(TARGET_COST * 2, DEFAULT_COST)
  assert.deepEqual(verdict.earned, [true, false, false])
  assert.match(verdict.next, /^往返代价 1400 个周期（模拟）：城外仓库 14 趟（取 9、存 5）。循环里每加一个数/)
})

test('挑战 ★2：和放货架、或者放工具台却多读一趟 out[t]，都在一半以内，但不是最少', () => {
  const lds = challenge({ add: ADD.lds, save: SAVE.box })
  assert.deepEqual(tripsOf(lds.result.events), { vram: { load: SUM_M, store: 1 }, lds: { load: SUM_M + 1, store: SUM_M } })
  assert.equal(costOf(tripsOf(lds.result.events)), 590)
  assert.deepEqual(lds.verdict.earned, [true, true, false])
  assert.match(lds.verdict.next, /货架比仓库近，可 s 只有自己用：放工具台/)

  const extra = challenge({ add: ADD.register, save: SAVE.plusS })
  assert.equal(costOf(tripsOf(extra.result.events)), 600)
  assert.deepEqual(extra.verdict.earned, [true, true, false])
  assert.match(extra.verdict.next, /最后一行还去仓库取了一趟 out\[t\]/)
})

test('挑战 ★3：和放在工具台的 s 上，4 个数各取一趟、和存一趟，往返代价最少', () => {
  for (const add of [ADD.register, 's += a[k * n + t]']) {
    const { verdict, result } = challenge({ add, save: SAVE.s })
    assert.deepEqual(result.arrays.out, expectedSums())
    assert.equal(costOf(tripsOf(result.events)), BEST_COST)
    assert.deepEqual(verdict.earned, [true, true, true], add)
  }
  assert.equal(BEST_COST, (SUM_M + 1) * SIM_PARAMS.fetchCycles.vram)
})

test('挑战：没算对时一颗星都没有，说清和加在哪、最后存的是哪里', () => {
  // 每轮把 s 换成新取来的数：只剩第 4 排
  const replace = challenge({ add: ADD.replace, save: SAVE.s }).verdict
  assert.deepEqual(replace.earned, [false, false, false])
  assert.equal(replace.error.symptom, `${SUM_N} 个和不对：out[0] 应该是 196，算出来是 97。`)
  assert.match(replace.error.cause, /没有加上去，最后只剩第 4 排的数/)
  // 加在仓库的 out[t] 上，最后又用 s 盖掉
  const covered = challenge({ add: ADD.vram, save: SAVE.s }).verdict
  assert.deepEqual(covered.earned, [false, false, false])
  assert.equal(covered.error.cause, '循环把和加在仓库里的 out[t] 上，最后一行却用工具台的 s 把它盖掉了：s 一直是 0。')
  // 加在 s 上，最后存的却是货架上的 box
  const wrongShelf = challenge({ add: ADD.register, save: SAVE.box }).verdict
  assert.equal(wrongShelf.error.cause, '循环把和加在工具台的 s 上，最后存进 out[t] 的却是货架上的 box：box 上没放过数。')
  assert.match(wrongShelf.error.raw, /^运行后 out = \[0, 0, 0, 0, 0, 0, 0, 0, …\]\n应该是 \[196, 200, 204/)
})

test('挑战：手机上的选项两两组合，默认写法一颗星，放货架或多读一趟两颗星，只有放工具台、存 s 拿满三颗', () => {
  const reached = { 0: [], 1: [], 2: [], 3: [] }
  for (const add of SUM_BLANKS.add.choices) {
    for (const save of SUM_BLANKS.save.choices) {
      const { earned } = challenge({ add, save }).verdict
      reached[earned.filter(Boolean).length].push(`${add} | ${save}`)
    }
  }
  assert.deepEqual(reached[1], [`${ADD.vram} | ${SAVE.plusS}`])
  assert.deepEqual(reached[2], [`${ADD.lds} | ${SAVE.box}`, `${ADD.register} | ${SAVE.plusS}`])
  assert.deepEqual(reached[3], [`${ADD.register} | ${SAVE.s}`])
  assert.equal(reached[0].length, 8)
})

test('挑战：单步时只数到这一步为止（默认写法第一轮之后，仓库跑了 3 趟）', () => {
  const { result } = challenge({})
  const firstBody = result.events.findIndex((e) => e.op === 'store')
  assert.deepEqual(tripsOf(result.events.slice(0, firstBody + 1)), { vram: { load: 2, store: 1 }, lds: { load: 0, store: 0 } })
})

test('两种写法的挑战工作单解析成同一棵语法树（除了位置）', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'loc' || key === 'nameLoc' || key === 'arrayLoc' ? undefined : v)))
  for (const values of [{}, { add: ADD.register, save: SAVE.s }, { add: ADD.lds, save: SAVE.box }]) {
    const [hip, python] = LANGS.map((lang) => parseKernel(source(lang, values), lang))
    assert.equal(hip.ok && python.ok, true)
    assert.deepEqual(plain(python.kernel), plain(hip.kernel))
  }
})
