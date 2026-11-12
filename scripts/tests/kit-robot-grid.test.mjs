import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blockTiles, defaultArray, describeGrid, gridAt, idleGrid, linked, prepareGrid, threadTier, TIERS,
} from '../../docs/components/kit/robot-grid/model.ts'
import { buildRequest, stepGroups } from '../../docs/components/kit/sandbox/run.ts'
import { fillTemplate, parseTemplate } from '../../docs/components/kit/sandbox/template.ts'
import { GRID_DEMOS } from './fixtures/kit/robot-grid-demo.ts'
import { ADD_ARGS, ADD_CODE, CHALLENGE_N } from './fixtures/kit/sandbox-demo.ts'
import { parseIndexExpr } from '../../docs/sim/expr.ts'
import { simulate } from '../../docs/sim/launch.ts'
import { run } from '../../docs/sim/lockstep.ts'

/** 线程机器人网格（S-06）：从模拟器的事件流算出谁写了哪一格，和试点关卡的五种状态对得上。 */

const LANGS = ['hip', 'python']

function runCode(source, lang, launch, args) {
  const result = run(buildRequest(source, lang, launch, args))
  return { result, src: prepareGrid(result, launch, 'c') }
}

const demo = (value) => GRID_DEMOS.find((d) => d.value === value)

test('试点关卡的五种状态：读者在沙盒里写的代码跑出来的网格，和试点的逻辑模型逐个线程、逐个格子都一样', () => {
  const FORMULAS = ['threadIdx.x', 'blockIdx.x * blockDim.x', 'blockIdx.x * blockDim.x + threadIdx.x', 'blockIdx.x * 4 + threadIdx.x']
  const seen = new Set()
  for (const lang of LANGS) {
    const template = parseTemplate(ADD_CODE[lang])
    for (const formula of FORMULAS) {
      for (const guard of [false, true]) {
        const source = fillTemplate(template, { i: formula, guard: guard ? 'i < n' : lang === 'hip' ? 'true' : 'True' }).source
        const parsed = parseIndexExpr(formula, lang)
        assert.ok(parsed.ok, formula)
        for (const block of [2, 4, 8]) {
          for (let grid = 1; grid <= 8; grid++) {
            const where = `${lang} i = ${formula} 条件${guard ? ' i < n' : '无'} ${grid} × ${block}`
            const pilot = simulate(parsed.expr, lang, { n: CHALLENGE_N, blockDim: block, gridDim: grid, guard })
            const { result, src } = runCode(source, lang, { grid, block }, ADD_ARGS)
            assert.ok(result.ok && pilot.ok, where)
            const state = gridAt(src)
            assert.equal(state.phase, 'finished', where)
            for (const t of pilot.threads) {
              const bot = state.bots[t.block * block + t.thread]
              const dup = t.status === 'write' && pilot.elements[t.index].length > 1
              const expected = t.status === 'skipped' ? 'skip' : dup ? 'dup' : t.status
              assert.equal(bot.state, expected, `${where} 线程 ${t.block}.${t.thread}`)
              seen.add(bot.state)
            }
            state.cells.forEach((cell, i) => {
              assert.deepEqual(cell.writers, pilot.elements[i], `${where} c[${i}]`)
              const writers = pilot.elements[i].length
              assert.equal(cell.state, writers === 0 ? 'missing' : writers > 1 ? 'dup' : 'write', `${where} c[${i}]`)
              seen.add(cell.state)
            })
            assert.deepEqual(state.outside.map(({ index, writers }) => ({ index, writers })), pilot.outside, where)
            const s = state.summary
            const p = pilot.summary
            assert.deepEqual([s.written, s.missing, s.duplicates, s.oob, s.skipped], [p.covered, p.missing, p.duplicates, p.oobWrites, p.skipped], where)
          }
        }
      }
    }
  }
  for (const name of ['write', 'dup', 'oob', 'skip', 'missing']) assert.ok(seen.has(name), `没有跑出 ${name}`)
})

test('五种状态的演示一次跑出全部五种状态，两种写法一样', () => {
  const d = demo('states')
  const states = LANGS.map((lang) => {
    const { result, src } = runCode(d.code[lang], lang, d.launch, d.args)
    assert.ok(result.ok, lang)
    return gridAt(src)
  })
  assert.deepEqual(states[0], states[1])
  const [s] = states
  const bots = s.bots.map((b) => b.state)
  for (const name of ['write', 'dup', 'oob', 'skip']) assert.ok(bots.includes(name), name)
  assert.deepEqual(s.cells.filter((c) => c.state === 'missing').map((c) => c.index), [1])
  assert.deepEqual(s.cells.filter((c) => c.state === 'dup').map((c) => c.index), [6, 9, 12])
  assert.deepEqual(s.outside.map((o) => o.index), [14, 15])
  assert.match(describeGrid(s, 'c', 1), /14 个格子写了 13 个，还有 1 个没人算；3 个格子.*；2 个线程写到了数组外面；2 个线程检查后跳过/)
})

test('逐步播放：还没轮到的待命，wave 走完才算跳过，走完才有「没人算」；放到最后和直接看结果一样', () => {
  const d = demo('states')
  const { result, src } = runCode(d.code.hip, 'hip', d.launch, d.args)
  const groups = stepGroups(result.events)
  assert.ok(groups.length > 1)
  const start = gridAt(src, 0)
  assert.equal(start.phase, 'running')
  assert.ok(start.bots.every((b) => b.state === 'standby' && !b.active))
  assert.ok(start.cells.every((c) => c.state === 'empty'))
  let before = start
  groups.forEach((g, k) => {
    const s = gridAt(src, g.to, g)
    const last = k === groups.length - 1
    assert.equal(s.phase, last ? 'finished' : 'running')
    // 这一步在做事的线程正好是这一步的掩码
    const ev = result.events[g.from]
    const active = s.bots.filter((b) => b.active).map((b) => b.id)
    const lanes = [...ev.mask].flatMap((bit, lane) => (bit === '1' ? [ev.block * d.launch.block + ev.wave * result.wave + lane] : []))
    assert.deepEqual(active, lanes, `第 ${k + 1} 步`)
    assert.deepEqual(s.current, { block: ev.block, wave: ev.wave })
    if (!last) assert.ok(s.cells.every((c) => c.state !== 'missing'), `第 ${k + 1} 步还不能说没人算`)
    for (const bot of s.bots) {
      const mine = result.events.flatMap((e, i) => (e.block === bot.block && e.wave === Math.floor(bot.thread / result.wave) ? [i] : []))
      if (bot.state === 'skip') assert.ok(mine.at(-1) < g.to, `第 ${k + 1} 步：线程 ${bot.id} 的 wave 还没走完就算了跳过`)
      if (bot.state === 'standby') assert.ok(!mine.length || mine[0] >= g.to, `第 ${k + 1} 步：线程 ${bot.id} 已经轮到了还在待命`)
      // 状态只往前走：写过、跳过的不会退回待命或计算中
      const prev = before.bots[bot.id].state
      if (!['standby', 'busy'].includes(prev)) assert.ok(!['standby', 'busy'].includes(bot.state), `第 ${k + 1} 步：线程 ${bot.id} 从 ${prev} 退回了 ${bot.state}`)
    }
    // 这一步写到的格子
    const written = new Set(result.events.slice(g.from, g.to).filter((e) => e.op === 'store').flatMap((e) => e.addrs))
    assert.deepEqual(s.cells.filter((c) => c.active).map((c) => c.index), [...written].filter((i) => i >= 0 && i < 14).sort((a, b) => a - b))
    before = s
  })
  const end = gridAt(src, groups.at(-1).to)
  assert.deepEqual(end, gridAt(src))
})

test('程序出错停下：只有出错之前跑完的 block 算走完，空着的格子不说成没人算', () => {
  const source = `__global__ void f(float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    int k = 10 / (2 - blockIdx.x);
    if (i < n) {
        c[i] = 1.0f;
    }
}`
  const launch = { grid: 4, block: 4 }
  const { result, src } = runCode(source, 'hip', launch, { c: { type: 'float', data: new Array(12).fill(0) }, n: { type: 'int', value: 7 } })
  assert.equal(result.ok, false)
  assert.equal(result.error.kind, 'runtime')
  const s = gridAt(src)
  assert.equal(s.phase, 'stopped')
  const byBlock = (b) => s.bots.filter((bot) => bot.block === b).map((bot) => bot.state)
  assert.deepEqual(byBlock(0), ['write', 'write', 'write', 'write'])
  assert.deepEqual(byBlock(1), ['write', 'write', 'write', 'skip'])
  assert.deepEqual(byBlock(2), ['busy', 'busy', 'busy', 'busy'])
  assert.deepEqual(byBlock(3), ['standby', 'standby', 'standby', 'standby'])
  assert.deepEqual(s.cells.map((c) => c.state), [...new Array(7).fill('write'), ...new Array(5).fill('empty')])
  assert.equal(s.summary.missing, 0)
  assert.match(describeGrid(s, 'c', result.events.length), /^程序出错停下了，停下时 c 的 12 个格子写了 7 个；1 个线程检查后跳过；4 个线程还在待命。$/)

  // 一步都没跑（语法错误）：还是运行前的样子
  const broken = runCode('__global__ void f(float* c) {\n    c[0] = \n}', 'hip', launch, { c: { type: 'float', data: [0, 0] } })
  const idle = gridAt(broken.src)
  assert.equal(idle.phase, 'stopped')
  assert.ok(idle.bots.every((b) => b.state === 'standby'))
  assert.match(describeGrid(idle, 'c', 0), /没有跑起来/)
})

test('原子加不算重复计算；一个线程写好几格、同一格写两遍都照实记', () => {
  const atomic = runCode(`__global__ void h(float* c) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    atomicAdd(&c[t % 2], 1.0f);
}`, 'hip', { grid: 2, block: 4 }, { c: { type: 'float', data: [0, 0, 0] } })
  const a = gridAt(atomic.src)
  assert.deepEqual(a.cells.map((c) => [c.state, c.writers.length, c.stores, c.atomics]), [['write', 4, 0, 4], ['write', 4, 0, 4], ['missing', 0, 0, 0]])
  assert.ok(a.bots.every((b) => b.state === 'write'))

  const stride = runCode(`__global__ void s(float* c, int n) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    for (int k = t; k < n; k += 2) {
        c[k] = 1.0f;
        c[k] = 2.0f;
    }
}`, 'hip', { grid: 1, block: 2 }, { c: { type: 'float', data: new Array(7).fill(0) }, n: { type: 'int', value: 7 } })
  const s = gridAt(stride.src)
  assert.deepEqual(s.bots.map((b) => b.writes), [[0, 2, 4, 6], [1, 3, 5]])
  assert.ok(s.cells.every((c) => c.state === 'write' && c.stores === 1))
})

test('分支里只有一部分 lane 在写：下标按活跃的 lane 一一对应，空转的 lane 不占位置', () => {
  for (const lang of LANGS) {
    const source = lang === 'hip'
      ? `__global__ void odd(float* c) {
    if (threadIdx.x % 2 == 1) {
        c[threadIdx.x / 2] = 1.0f;
    }
}`
      : `@kernel
def odd(c):
    if threadIdx.x % 2 == 1:
        c[threadIdx.x // 2] = 1.0`
    const { result, src } = runCode(source, lang, { grid: 1, block: 8 }, { c: { type: 'float', data: new Array(4).fill(0) } })
    assert.ok(result.ok, lang)
    const s = gridAt(src)
    assert.deepEqual(s.bots.map((b) => b.state), ['skip', 'write', 'skip', 'write', 'skip', 'write', 'skip', 'write'], lang)
    assert.deepEqual(s.bots.map((b) => b.writes), [[], [0], [], [1], [], [2], [], [3]], lang)
    assert.deepEqual(s.cells.map((c) => c.writers), [1, 3, 5, 7].map((thread) => [{ block: 0, thread }]), lang)
  }
})

test('指到一个东西，另一边对应的亮起来', () => {
  const d = demo('states')
  const { src } = runCode(d.code.hip, 'hip', d.launch, d.args)
  const s = gridAt(src)
  const B = d.launch.block
  const sorted = (set) => [...set].sort((x, y) => x - y)
  // c[6] 被第 0 组第 3 个、第 2 组第 0 个写了
  const cell = linked(s, { kind: 'cell', index: 6 }, B)
  assert.deepEqual(sorted(cell.bots), [3, 8])
  assert.deepEqual(sorted(cell.blocks), [0, 2])
  assert.deepEqual(sorted(linked(s, { kind: 'bot', id: 8 }, B).cells), [6])
  // 越界区的 c[14] 是第 4 组第 1 个写的
  const out = linked(s, { kind: 'out', index: 14 }, B)
  assert.deepEqual(sorted(out.bots), [17])
  assert.deepEqual(sorted(linked(s, { kind: 'bot', id: 17 }, B).outside), [14])
  // 第 4 组：12 是重复的格子，14 写到了外面，16、18 被拦下
  const block = linked(s, { kind: 'block', block: 4 }, B)
  assert.deepEqual(sorted(block.bots), [16, 17, 18, 19])
  assert.deepEqual(sorted(block.cells), [12])
  assert.deepEqual(sorted(block.outside), [14])
  assert.equal(linked(s, null, B).bots.size, 0)
})

test('线程多了自动缩略：64 个以内画机器人，256 个以内画小号机器人，再多按组汇总', () => {
  assert.deepEqual([1, TIERS.bots, TIERS.bots + 1, TIERS.mini, TIERS.mini + 1, 1024].map(threadTier), ['bots', 'bots', 'mini', 'mini', 'blocks', 'blocks'])
  assert.equal(threadTier(demo('states').launch.grid * demo('states').launch.block), 'bots')
  assert.equal(threadTier(demo('mini').launch.grid * demo('mini').launch.block), 'mini')

  const d = demo('blocks')
  const { result, src } = runCode(d.code.python, 'python', d.launch, d.args)
  assert.ok(result.ok)
  assert.equal(threadTier(d.launch.grid * d.launch.block), 'blocks')
  const s = gridAt(src)
  const tiles = blockTiles(s, d.launch)
  assert.deepEqual(tiles.map((t) => t.threads), [256, 256, 256, 256])
  assert.deepEqual(tiles.map((t) => t.counts.write), [256, 256, 256, 232])
  assert.deepEqual(tiles.map((t) => t.counts.skip), [0, 0, 0, 24])
  assert.equal(s.summary.written, 1000)
  // 逐步播放时，正在执行的那一组亮着
  const g = stepGroups(result.events)[40]
  const partial = blockTiles(gridAt(src, g.to, g), d.launch)
  assert.deepEqual(partial.map((t) => t.active), [0, 1, 2, 3].map((b) => b === result.events[g.from].block))
})

test('还没运行：线程按启动配置排好，全都待命；没指定数组时画第一个被写的数组', () => {
  const idle = idleGrid({ grid: 3, block: 4 })
  assert.equal(idle.phase, 'idle')
  assert.deepEqual(idle.bots.map((b) => [b.block, b.thread]), [0, 1, 2].flatMap((b) => [0, 1, 2, 3].map((t) => [b, t])))
  assert.ok(idle.bots.every((b) => b.state === 'standby'))
  assert.equal(describeGrid(idle, 'c', 0), '')
  const d = demo('mini')
  const { result } = runCode(d.code.hip, 'hip', d.launch, d.args)
  assert.equal(defaultArray(result), 'c')
  assert.equal(defaultArray(null), null)
})

test('1024 个线程逐步播放：每一步都能很快算出来', () => {
  const d = demo('blocks')
  const { result, src } = runCode(d.code.hip, 'hip', d.launch, d.args)
  const groups = stepGroups(result.events)
  assert.equal(groups.length, 96)
  const t0 = performance.now()
  let worst = 0
  for (const g of groups) {
    const s0 = performance.now()
    gridAt(src, g.to, g)
    worst = Math.max(worst, performance.now() - s0)
  }
  const total = performance.now() - t0
  // 本机 96 步一共 20–30 ms、最慢一步 2 ms 以内；放宽很多，只防止写成每一步都从头重算整个运行那样的慢法
  assert.ok(total < 600 && worst < 60, `96 步一共 ${total.toFixed(1)} ms，最慢一步 ${worst.toFixed(1)} ms`)
})
