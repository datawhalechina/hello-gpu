/**
 * 1-10 大家一起求和：求和树、两段实验台和挑战用到的代码、数据、解读和判定（纯函数，单测在 scripts/tests/novice-reduction.test.mjs）。
 *
 * - 热身和探索一（scenes/SumTree.vue）：8 个部分和，读者两两配对搭一棵求和树。一次加法把两个数合成一个，
 *   放在「两个数里晚的那一轮 + 1」：同一轮里的加法互不相干，可以同时做。最少 3 轮（8 → 4 → 2 → 1），一个人从头加到尾是 7 轮。
 * - 探索二（scenes/TreeLab.vue）：tree_sum，派 1 组 64 个线程（两支小队），在货架上搭树：第 1 轮隔 1 格配对，之后每轮翻倍；
 *   t 是 2s 的倍数的线程把 box[t + s] 加到 box[t]。旋钮把每一轮之后的同步删掉：小队 0 一口气走完 6 轮，
 *   第 6 轮取第 32 格时，小队 1 一轮都还没加，out[0] 不对。
 * - 探索三（scenes/AtomicLab.vue）：add_all，派 2 组、每组 64 个线程，每个线程把 a[i] 加进 out[0]。普通加：同一支小队的
 *   线程同时读到同一个旧值，写回去只留下一个；原子加：一个都不丢，可 out[0] 前排了 128 次队。
 * - 挑战（scenes/SumSandbox.vue）：sum_all，派 2 组、每组 64 个线程，把 128 个数加进 out[0]。读者改三个空：循环搭到哪为止、
 *   每一轮之后等不等、最后那一行谁去加。★1 out[0] 对、没有数据竞争；★2 out[0] 前只排 2 次队；
 *   ★3 换成 4 组、每组 32 个线程（Sandbox 的 variants 再跑一次）照样成立。
 * - 货架板（scenes/TreeBoard.vue）：treeBoard 照着事件流重算货架每一格、out[0] 到这一步为止的数。
 *   这几张工作单里，写进去的数都是这个线程同一步读到的数加起来（原子加再加上原来的数），所以按事件流就能算出来。
 *
 * 模拟器的约定决定了这一关看到的现象（08 第 4 节）：同一组里小队按编号轮流走，走到同步或者走完才换下一支；
 * 组一个接一个跑；货架每组开始时是 0；一支小队同一步写同一格，留下最后一个线程的。所以删掉同步时总是小队 0 先走、取早；
 * 组和组之间用普通加，模拟器里碰巧对，只记下数据竞争。真卡上先后不确定：正文和解读都写「模拟器里」，不说成硬件行为。
 * 两种写法的事件流（除了行号）一样，解读和判定也一样。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg, OobRead, Race, RunResult, SimEvent } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, stepGroups, type Launch, type SandboxRun, type SandboxVariant, type StepGroup } from '../../components/kit/sandbox/run.ts'
import { prepareWave, syncProgress } from '../../components/kit/wave-view/model.ts'

export const STAGE_ID = 'novice-reduction'

// ── 热身和探索一：搭一棵求和树 ──────────────────────────────────────────────

/** 8 个部分和（同旧版第 9 章 9.2 的例子），合起来是 24。 */
export const TREE_VALUES: readonly number[] = [3, 1, 7, 0, 4, 1, 6, 2]
/** 4 个线程一起加：8 个数一轮最多配 4 对，正好每人一次。 */
export const TREE_THREADS = 4

export interface SumNode {
  id: number
  value: number
  /** 第几轮加出来的：现成的数是 0 */
  round: number
  /** 由哪两个数加出来（id）；现成的数是 null */
  kids: readonly [number, number] | null
  /** 已经加进了哪个数（id）；还没用掉是 null */
  into: number | null
}

/** 一棵（搭到一半的）求和树：nodes[k].id === k，前面是现成的数，后面按加的先后排。 */
export interface SumTree {
  nodes: readonly SumNode[]
}

export function plantTree(values: readonly number[] = TREE_VALUES): SumTree {
  return { nodes: values.map((value, id) => ({ id, value, round: 0, kids: null, into: null })) }
}

/** 还没用掉的数：下一次加法只能从这里挑两个。 */
export function readyNodes(tree: SumTree): SumNode[] {
  return tree.nodes.filter((n) => n.into === null)
}

/** 两个还没用掉的数加成一个，放在两个数里晚的那一轮 + 1。挑的数不能用就原样返回。 */
export function joinNodes(tree: SumTree, a: number, b: number): SumTree {
  const x = tree.nodes[a]
  const y = tree.nodes[b]
  if (!x || !y || a === b || x.into !== null || y.into !== null) return tree
  const id = tree.nodes.length
  const node: SumNode = { id, value: x.value + y.value, round: Math.max(x.round, y.round) + 1, kids: [a, b], into: null }
  return { nodes: [...tree.nodes.map((n) => (n.id === a || n.id === b ? { ...n, into: id } : n)), node] }
}

/** 撤销最后一次加法；一次都没加就原样返回。 */
export function undoJoin(tree: SumTree): SumTree {
  const last = tree.nodes[tree.nodes.length - 1]
  if (!last?.kids) return tree
  return { nodes: tree.nodes.slice(0, -1).map((n) => (n.into === last.id ? { ...n, into: null } : n)) }
}

export function leafCount(tree: SumTree): number {
  return tree.nodes.filter((n) => !n.kids).length
}

/** 加了几次。 */
export function joinCount(tree: SumTree): number {
  return tree.nodes.length - leafCount(tree)
}

/** 合完了：只剩一个数。 */
export function treeDone(tree: SumTree): boolean {
  return tree.nodes.length > 1 && readyNodes(tree).length === 1
}

/** 用到第几轮：最晚的那一次加法在第几轮。 */
export function treeRounds(tree: SumTree): number {
  return tree.nodes.reduce((most, n) => Math.max(most, n.round), 0)
}

/** n 个数最少几轮合完：每轮两两相加，一轮少一半（向上取整）。 */
export function roundsNeeded(n: number): number {
  let rounds = 0
  for (let left = n; left > 1; left = Math.ceil(left / 2)) rounds++
  return rounds
}

/** 每一轮做了几次加法：下标 0 是第 1 轮。 */
export function addsPerRound(tree: SumTree): number[] {
  const per = new Array<number>(treeRounds(tree)).fill(0)
  for (const n of tree.nodes) if (n.kids) per[n.round - 1]++
  return per
}

/** 第 r 轮开始时手上有几个数：r 轮之前加出来（或者现成）、到第 r 轮还没用掉的。 */
function aliveAt(tree: SumTree, r: number): number {
  return tree.nodes.filter((n) => n.round < r && (n.into === null || tree.nodes[n.into].round >= r)).length
}

/** 一次加法的一句话（03 第 1 节第 4 条）：谁加谁，放在第几轮，为什么是这一轮。 */
export function joinStory(tree: SumTree, id: number): string {
  const n = tree.nodes[id]
  if (!n?.kids) return ''
  const [x, y] = n.kids.map((k) => tree.nodes[k])
  const late = Math.max(x.round, y.round)
  let why = '两个数都是现成的，第 1 轮就能加。'
  if (late > 0 && x.round === y.round) why = `两个数都是第 ${late} 轮加出来的，要等第 ${late} 轮做完。`
  else if (late > 0) why = `${(x.round > y.round ? x : y).value} 是第 ${late} 轮才加出来的，要等第 ${late} 轮做完。`
  return `${x.value} + ${y.value} = ${n.value}，放在第 ${n.round} 轮：${why}`
}

/** 搭到这里的一句话：还剩几个数；合完了就说用了几轮、是不是最少，不是最少就指出哪一轮有数在干等。 */
export function treeText(tree: SumTree): string {
  const leaves = leafCount(tree)
  const adds = joinCount(tree)
  if (!adds) return `还没开始：${leaves} 个数都是现成的。先点一个数，再点另一个，把两个数加起来；也可以把一个数拖到另一个上。`
  const rounds = treeRounds(tree)
  const left = readyNodes(tree).length
  if (left > 1) return `加了 ${adds} 次，最晚的一次在第 ${rounds} 轮；还剩 ${left} 个数没合。`
  const total = readyNodes(tree)[0].value
  const per = addsPerRound(tree)
  const perText = per.map((c, r) => `第 ${r + 1} 轮 ${c} 次`).join('、')
  const best = roundsNeeded(leaves)
  if (rounds === best) {
    return `合完了，总和 ${total}：加了 ${adds} 次，只用 ${rounds} 轮（${perText}）。每一轮都把手上的数两两配好，一轮少一半：这是最少的轮数。`
  }
  if (rounds === leaves - 1) {
    return `合完了，总和 ${total}：加了 ${adds} 次，用了 ${rounds} 轮，每轮只有 1 次加法。这就是一个人从头加到尾：每一次都等上一次，另外 ${TREE_THREADS - 1} 个线程一直闲着。`
  }
  const r = per.findIndex((c, k) => c < Math.floor(aliveAt(tree, k + 1) / 2)) + 1
  const alive = aliveAt(tree, r)
  return `合完了，总和 ${total}：加了 ${adds} 次，用了 ${rounds} 轮（${perText}）。还能更少：第 ${r} 轮开始时手上有 ${alive} 个数，`
    + `能配 ${Math.floor(alive / 2)} 对，这一轮只加了 ${per[r - 1]} 次。每一轮先把手上的数两两配好。`
}

/** 最少轮数的一种搭法：每一轮把手上的数挨着两两配对（看答案用；探索环节，不影响星级）。 */
export function bestTree(values: readonly number[] = TREE_VALUES): SumTree {
  let tree = plantTree(values)
  while (readyNodes(tree).length > 1) {
    const ready = readyNodes(tree)
    for (let k = 0; k + 1 < ready.length; k += 2) tree = joinNodes(tree, ready[k].id, ready[k + 1].id)
  }
  return tree
}

// ── 工作单：数据和代码 ────────────────────────────────────────────────────────

/** 一支小队 32 个线程（wave32，1-5）。 */
export const WAVE = 32
/** 货架开 64 格（__shared__ float box[64]）：一组最多 64 个线程，每人一格。 */
export const SHELF = 64
export const SHELF_NAME = 'box'
export const OUT_NAME = 'out'

/** a[j] = j + 1（同 1-7～1-9，从 1 数起）。 */
export function aValue(j: number): number {
  return j + 1
}

/** 1 + 2 + … + n。 */
export function totalOf(n: number): number {
  return (n * (n + 1)) / 2
}

/** a 有 n 个数；out 只有 1 格，一开始是 0。 */
export function sumArgs(n: number): Record<string, Arg> {
  return {
    a: { type: 'float', data: Array.from({ length: n }, (_, j) => aValue(j)) },
    out: { type: 'float', data: [0] },
  }
}

/** 同步那一行（08 第 3 节）；不等的那一行写成注释（手机上的空选项在下拉框里看不出来）。 */
export const SYNC_CALL: Record<Lang, string> = { hip: '__syncthreads();', python: 'syncthreads()' }
export const NO_WAIT: Record<Lang, string> = { hip: '// 不等', python: '# 不等' }
const COMMENT: Record<Lang, string> = { hip: '//', python: '#' }
/** 行尾注释从第几列开始：同一张工作单里几行注释对齐。 */
const NOTE_COLUMN = 37

/** 一行代码加行尾注释。shown 是这一行显示出来的样子（模板里的空按初始内容算），用它对齐注释。 */
function withNote(code: string, note: string, lang: Lang, shown = code): string {
  return `${code}${' '.repeat(Math.max(1, NOTE_COLUMN - shown.length))}${COMMENT[lang]} ${note}`
}

interface SumParts {
  /** kernel 的名字 */
  name: string
  /** while 的终点（s 小于它就再加一轮） */
  stop: string
  stopShown?: string
  /** 每一轮之后的那一行：同步，或者一行注释 */
  wait: string
  /** 每一轮之后那一行的行尾注释（模板里那一行是空，不写注释） */
  waitNote?: string
  /** 循环之后的那一行：存进 out，或者合进 out */
  tail: string
}

/**
 * 搭树的工作单：每人把 a[i] 放上货架的第 t 格，等整组都放好；第 1 轮隔 1 格配对，之后每轮翻倍，
 * t 是 2s 的倍数的线程把右边隔 s 格的数加到自己这一格（同 HIP 文档 Reduction 教程的第一种写法）。
 */
function sumSource(lang: Lang, parts: SumParts): string {
  const shownStop = parts.stopShown ?? parts.stop
  const rows = lang === 'hip'
    ? [
        `__global__ void ${parts.name}(float* a, float* out) {`,
        withNote('    __shared__ float box[64];', '货架开 64 格', lang),
        '    int t = threadIdx.x;',
        '    box[t] = a[blockIdx.x * blockDim.x + t];',
        withNote('    __syncthreads();', '等整组都放好', lang),
        withNote('    int s = 1;', '这一轮隔几格配对', lang),
        withNote(`    while (s < ${parts.stop}) {`, '搭到哪为止', lang, `    while (s < ${shownStop}) {`),
        '        if (t % (2 * s) == 0) box[t] += box[t + s];',
        parts.waitNote ? withNote(`        ${parts.wait}`, parts.waitNote, lang) : `        ${parts.wait}`,
        withNote('        s = s * 2;', '下一轮隔的格数翻倍', lang),
        '    }',
        `    ${parts.tail}`,
        '}',
      ]
    : [
        '@kernel',
        `def ${parts.name}(a, out):`,
        withNote('    box = shared(64)', '货架开 64 格', lang),
        '    t = threadIdx.x',
        '    box[t] = a[blockIdx.x * blockDim.x + t]',
        withNote('    syncthreads()', '等整组都放好', lang),
        withNote('    s = 1', '这一轮隔几格配对', lang),
        withNote(`    while s < ${parts.stop}:`, '搭到哪为止', lang, `    while s < ${shownStop}:`),
        '        if t % (2 * s) == 0:',
        '            box[t] += box[t + s]',
        parts.waitNote ? withNote(`        ${parts.wait}`, parts.waitNote, lang) : `        ${parts.wait}`,
        withNote('        s = s * 2', '下一轮隔的格数翻倍', lang),
        `    ${parts.tail}`,
      ]
  return rows.join('\n')
}

/** 搭树的工作单里 while 那一行是第几行（从 1 数起）：每一轮在这里判断一次。 */
export function loopLine(source: string): number {
  return source.split('\n').findIndex((row) => row.trimStart().startsWith('while')) + 1
}

// ── 探索二：树搬上货架 ────────────────────────────────────────────────────────

/** 派 1 组 64 个线程，排成两支小队。 */
export const LAB_LAUNCH: Launch = { grid: 1, block: SHELF }
export const LAB_ARGS = sumArgs(LAB_LAUNCH.grid * LAB_LAUNCH.block)
export const LAB_TOTAL = totalOf(LAB_LAUNCH.grid * LAB_LAUNCH.block)

/** 每一轮之后等不等。 */
export type RoundWait = 'sync' | 'none'
export const ROUND_WAITS: readonly { value: RoundWait; label: string }[] = [
  { value: 'sync', label: '同步' },
  { value: 'none', label: '不同步' },
]
export const DEFAULT_ROUND_WAIT: RoundWait = 'sync'

const STORE_OUT: Record<Lang, string> = { hip: 'if (t == 0) out[0] = box[0];', python: 'if t == 0: out[0] = box[0]' }

/** 实验台的工作单：搭满（s 小于 blockDim.x 就再加一轮），每一轮之后同步或者不同步，最后线程 0 把第 0 格存进 out[0]。 */
export function treeCode(wait: RoundWait, lang: Lang): string {
  return sumSource(lang, {
    name: 'tree_sum',
    stop: 'blockDim.x',
    wait: wait === 'sync' ? SYNC_CALL[lang] : NO_WAIT[lang],
    waitNote: wait === 'sync' ? '每一轮之后等整组' : undefined,
    tail: STORE_OUT[lang],
  })
}

/** 启动那一行（1-2 定的写法）。 */
export function launchLine(kernel: string, launch: Launch, lang: Lang): string {
  return lang === 'hip'
    ? `${kernel}<<<${launch.grid}, ${launch.block}>>>(d_a, d_out);`
    : `${kernel}[${launch.grid}, ${launch.block}](d_a, d_out)`
}

// ── 数一数 ────────────────────────────────────────────────────────────────────

/** 一个事件的掩码里，哪几个 lane 在做（按 lane 顺序，和 addrs 一一对应）。 */
function lanesOf(e: SimEvent): number[] {
  const out: number[] = []
  for (let k = 0; k < e.mask.length; k++) if (e.mask[k] === '1') out.push(k)
  return out
}

/** out 前排了几次队：往 out 上做原子加的线程一共几个。 */
export function queueOf(events: readonly SimEvent[]): number {
  let n = 0
  for (const e of events) if (e.op === 'atomic' && e.array === OUT_NAME) n += e.addrs?.length ?? 0
  return n
}

/** 货架上、显存上的数据竞争（模拟器的诊断）。 */
export interface SumRaces {
  total: number
  /** 货架上先取后写：取的时候，别的线程这一轮还没把它加好 */
  early: Race[]
  /** 货架上先写后取，可中间没有同步：这一次碰巧取对了 */
  lucky: Race[]
  /** 显存上的：往 out 上读了又写，中间没有同步（普通加） */
  global: Race[]
}

export function sumRaces(result: RunResult): SumRaces {
  const races: SumRaces = { total: 0, early: [], lucky: [], global: [] }
  for (const d of result.diagnostics) {
    if (d.kind !== 'race') continue
    races.total++
    if (d.space === 'global') races.global.push(d)
    else if (d.first.op === 'read') races.early.push(d)
    else races.lucky.push(d)
  }
  return races
}

/**
 * 每个小队做加法的那几步（step 编号，按先后）：同一步里既取货架、又往货架上写。第 0 轮放数取的是 a，不算。
 * 键是「block:wave」。
 */
export function addSteps(result: RunResult): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const g of stepGroups(result.events)) {
    const own = result.events.slice(g.from, g.to)
    const shelf = (op: SimEvent['op']) => own.some((e) => e.op === op && e.space === 'lds' && e.array === SHELF_NAME)
    if (!shelf('load') || !(shelf('store') || shelf('atomic'))) continue
    const key = `${g.block}:${g.wave}`
    out.set(key, [...(out.get(key) ?? []), g.step])
  }
  return out
}

/** 每组搭了几轮：block 0 的小队 0 做了几次加法（这几张工作单里，线程 0 每一轮都要加）。不认写法，两种写法一样。 */
export function roundsOf(result: RunResult): number {
  return addSteps(result).get('0:0')?.length ?? 0
}

/** 取了这一组没人放过的格子：同一组里，这一格在被取之前一次都没写过（越界的不算，另外记）。 */
export interface UnputRead {
  block: number
  thread: number
  index: number
  step: number
}

export function unputReads(result: RunResult): UnputRead[] {
  const written = new Map<number, Set<number>>()
  const out: UnputRead[] = []
  for (const e of result.events) {
    if (e.space !== 'lds' || e.array !== SHELF_NAME) continue
    let set = written.get(e.block)
    if (!set) written.set(e.block, (set = new Set()))
    const lanes = lanesOf(e)
    const addrs = e.addrs ?? []
    if (e.op === 'load') {
      addrs.forEach((index, k) => {
        if (index >= 0 && index < SHELF && !set.has(index)) out.push({ block: e.block, thread: e.wave * result.wave + lanes[k], index, step: e.step })
      })
    } else {
      for (const index of addrs) set.add(index)
    }
  }
  return out
}

/** 一串数分成连着的几段（往上、往下数都算连着；步长一样也算，比如 0、4、8、12）。 */
function runsOf(list: readonly number[]): { from: number; to: number; step: number }[] {
  const runs: { from: number; to: number; step: number }[] = []
  for (const v of list) {
    const last = runs[runs.length - 1]
    if (last) {
      const gap = v - last.to
      if (last.from === last.to && gap !== 0) {
        last.to = v
        last.step = gap
        continue
      }
      if (gap === last.step && gap !== 0) {
        last.to = v
        continue
      }
      // 只有两个数的一段，后面换了步长：第二个数让给下一段（0、33、34……63 写成「0、33～63」）
      if (gap !== 0 && last.to - last.from === last.step) {
        runs.push({ from: last.to, to: v, step: gap })
        last.to = last.from
        last.step = 0
        continue
      }
    }
    runs.push({ from: v, to: v, step: 0 })
  }
  return runs
}

/** 一串数写成「0～31」「0、4、8……60」：连着的写一段，隔着一样多的写头三个和最后一个；最多写两段，再多写「等」。 */
export function spanText(list: readonly number[], name: (v: number) => string = String): string {
  const runs = runsOf(list)
  const shown = runs.slice(0, 2).map(({ from, to, step }) => {
    if (from === to) return name(from)
    const count = Math.abs(to - from) / Math.abs(step) + 1
    if (Math.abs(step) === 1 && count > 2) return `${name(from)}～${name(to)}`
    if (count <= 3) return Array.from({ length: count }, (_, k) => name(from + k * step)).join('、')
    return `${name(from)}、${name(from + step)}、${name(from + 2 * step)}……${name(to)}`
  })
  return `${shown.join('、')}${runs.length > 2 ? ' 等' : ''}`
}

// ── 货架板：照着事件流重算每一格的数 ─────────────────────────────────────────

export type SlotState = 'empty' | 'live' | 'spent'

export interface TreeSlot {
  index: number
  /** 这一格现在的数；还没放过是 null */
  value: number | null
  /** empty：没放过；live：还要用；spent：已经加给别的格子了 */
  state: SlotState
  /** 这一步写了这一格 */
  wrote: boolean
  /** 这一步取了这一格 */
  read: boolean
  /** 到这一步为止，有线程在它被加好之前就取了它（数据竞争：先取后写） */
  early: boolean
  /** 到这一步为止，有线程取了它，可这一组没人放过它 */
  unput: boolean
}

export interface ShelfView {
  block: number
  slots: TreeSlot[]
  /** 这一组开始走了没有 */
  started: boolean
}

export interface OutView {
  value: number
  expected: number
  state: 'blank' | 'right' | 'wrong'
  /** 这一步写了 out[0] */
  now: boolean
  /** 到这一步为止，out[0] 前排了几次队 */
  queue: number
}

export interface TreeBoardData {
  shelves: ShelfView[]
  out: OutView
  /** 重算出来的数和模拟器的结果对得上（读者在空里写了乘法这类写法时对不上，货架板就不写数） */
  exact: boolean
}

/** 一步里写 out 的那一下：写之前、写之后是多少，几个线程写的，普通写时留下的是哪个线程。 */
export interface OutWrite {
  step: number
  block: number
  wave: number
  op: 'store' | 'atomic'
  lanes: number
  /** 这些线程读到的 out[0]（普通加时大家读到同一个旧值；只写不读是 null） */
  seen: number | null
  before: number
  after: number
  /** 普通写时留下的那个线程（threadIdx.x）；原子加是 null */
  kept: number | null
}

interface Replay {
  shelves: Map<number, (number | null)[]>
  spent: Map<number, Set<number>>
  arrays: Record<string, number[]>
  outWrites: OutWrite[]
}

/**
 * 照着事件流把前 end 个事件重做一遍（end 落在一步的边界上）：每一步先算每个 lane 读到的数加起来是多少，
 * 再按 lane 的顺序写（同模拟器：同一格写好几次时留下最后一个 lane 的；原子加一个一个加上去）。
 */
function replay(result: RunResult, args: Readonly<Record<string, Arg>>, end: number): Replay {
  const arrays: Record<string, number[]> = {}
  for (const [name, arg] of Object.entries(args)) if ('data' in arg) arrays[name] = Array.from(arg.data)
  const shelves = new Map<number, (number | null)[]>()
  const spent = new Map<number, Set<number>>()
  const outWrites: OutWrite[] = []
  const shelf = (b: number) => {
    let s = shelves.get(b)
    if (!s) {
      shelves.set(b, (s = new Array<number | null>(SHELF).fill(null)))
      spent.set(b, new Set())
    }
    return s
  }
  const read = (e: SimEvent, index: number): number => {
    if (e.space === 'lds') return shelf(e.block)[index] ?? 0
    return arrays[e.array ?? '']?.[index] ?? 0
  }
  const { events } = result
  for (const g of stepGroups(events)) {
    if (g.from >= end) break
    const own = events.slice(g.from, Math.min(g.to, end))
    const sums = new Map<number, number>()
    let seen: number | null = null
    for (const e of own) {
      if (e.op !== 'load') continue
      const lanes = lanesOf(e)
      const addrs = e.addrs ?? []
      for (let k = 0; k < addrs.length; k++) {
        const v = read(e, addrs[k])
        sums.set(lanes[k], (sums.get(lanes[k]) ?? 0) + v)
        if (e.space === 'global' && e.array === OUT_NAME) seen = v
      }
    }
    const stored = new Set<number>()
    for (const e of own) {
      if (e.op !== 'store' && e.op !== 'atomic') continue
      const lanes = lanesOf(e)
      const addrs = e.addrs ?? []
      if (e.space === 'lds' && e.array === SHELF_NAME) {
        const s = shelf(e.block)
        addrs.forEach((index, k) => {
          if (index < 0 || index >= SHELF) return
          const v = sums.get(lanes[k]) ?? 0
          s[index] = e.op === 'atomic' ? (s[index] ?? 0) + v : v
          stored.add(index)
          spent.get(e.block)?.delete(index)
        })
      } else if (e.space === 'global') {
        const data = arrays[e.array ?? '']
        if (!data) continue
        const before = data[0] ?? 0
        let kept: number | null = null
        for (let k = 0; k < addrs.length; k++) {
          const index = addrs[k]
          if (index < 0 || index >= data.length) continue
          const v = sums.get(lanes[k]) ?? 0
          data[index] = e.op === 'atomic' ? data[index] + v : v
          if (e.op === 'store') kept = e.wave * result.wave + lanes[k]
        }
        if (e.array === OUT_NAME) {
          outWrites.push({
            step: e.step, block: e.block, wave: e.wave, op: e.op === 'atomic' ? 'atomic' : 'store', lanes: addrs.length,
            seen, before, after: data[0] ?? 0, kept,
          })
        }
      }
    }
    // 这一步写了货架、又取了别的格子：取的那几格已经加给别人了（第 0 轮放数时取的是 a，不算）
    if (stored.size) {
      for (const e of own) {
        if (e.op !== 'load' || e.space !== 'lds' || e.array !== SHELF_NAME) continue
        for (const index of e.addrs ?? []) if (index >= 0 && index < SHELF && !stored.has(index)) spent.get(e.block)?.add(index)
      }
    }
  }
  return { shelves, spent, arrays, outWrites }
}

/**
 * 货架板：每组货架上每一格、out[0] 到前 upto 个事件为止的样子；[from, upto) 是这一步（或者一段）的事件，标出这一段写的、取的格子。
 * expected 是 out[0] 应该是多少。
 */
export function treeBoard(
  result: RunResult, args: Readonly<Record<string, Arg>>, launch: Launch, expected: number,
  upto = result.events.length, from = upto,
): TreeBoardData {
  const end = Math.min(upto, result.events.length)
  const state = replay(result, args, end)
  const full = end >= result.events.length ? state : replay(result, args, result.events.length)
  const finalOut = result.arrays[OUT_NAME]?.[0] ?? 0
  const exact = (full.arrays[OUT_NAME]?.[0] ?? 0) === finalOut
  const now = result.events.slice(Math.min(from, end), end)
  const lastStep = end > 0 ? result.events[end - 1].step : -1
  // 先取后写的那一格：取的那一刻就标出来（取早了），不等后来写它的那一步
  const early = result.diagnostics.filter((d): d is Race => d.kind === 'race' && d.space === 'lds' && d.first.op === 'read' && d.first.step <= lastStep)
  const unput = unputReads(result).filter((u) => u.step <= lastStep)
  const startedBlocks = new Set(result.events.slice(0, end).map((e) => e.block))

  const shelves: ShelfView[] = Array.from({ length: launch.grid }, (_, block) => {
    const values = state.shelves.get(block) ?? new Array<number | null>(SHELF).fill(null)
    const spent = state.spent.get(block) ?? new Set<number>()
    const slots = values.map((value, index): TreeSlot => ({
      index,
      value: exact ? value : null,
      state: value === null ? 'empty' : spent.has(index) ? 'spent' : 'live',
      wrote: false,
      read: false,
      early: early.some((r) => r.first.block === block && r.index === index),
      unput: unput.some((u) => u.block === block && u.index === index),
    }))
    for (const e of now) {
      if (e.block !== block || e.space !== 'lds' || e.array !== SHELF_NAME) continue
      for (const index of e.addrs ?? []) {
        const slot = slots[index]
        if (!slot) continue
        if (e.op === 'load') slot.read = true
        else slot.wrote = true
      }
    }
    return { block, slots, started: startedBlocks.has(block) }
  })

  const written = state.outWrites.length > 0
  const value = end >= result.events.length ? finalOut : state.arrays[OUT_NAME]?.[0] ?? 0
  const outNow = now.some((e) => e.space === 'global' && e.array === OUT_NAME && (e.op === 'store' || e.op === 'atomic'))
  return {
    shelves,
    out: {
      value,
      expected,
      state: !written ? 'blank' : value === expected ? 'right' : 'wrong',
      now: outNow,
      queue: queueOf(result.events.slice(0, end)),
    },
    exact,
  }
}

/** 每一次往 out[0] 写：给探索三按小队列出来（整段跑完的样子）。 */
export function outWrites(result: RunResult, args: Readonly<Record<string, Arg>>): OutWrite[] {
  return replay(result, args, result.events.length).outWrites
}

// ── 探索二的单步：一支小队走完一轮算一段 ───────────────────────────────────────

export type MoveKind = 'put' | 'round' | 'tail'

/** 实验台的一段：一支小队把数放上货架、走完一轮、或者走完循环以后的那几行。 */
export interface TreeMove {
  /** stepGroups 的下标：这一段的第一步、最后一步 */
  first: number
  last: number
  /** 事件下标 [from, to) */
  from: number
  to: number
  block: number
  wave: number
  kind: MoveKind
  /** round：第几轮；tail：一共走了几轮；put：0 */
  round: number
  /** 这一段停在同步上 */
  barrier: boolean
}

/**
 * 把单步的一步一步合成一段一段：换了小队、走到同步，就是新的一段；同一支小队没有同步时，
 * 在 while 那一行每判断一次（进入新的一轮）分一段。loop 是 while 那一行（loopLine）。
 */
export function treeMoves(result: RunResult, loop: number): TreeMove[] {
  const { events } = result
  const groups = stepGroups(events)
  const has = (g: StepGroup, op: SimEvent['op']) => events.slice(g.from, g.to).some((e) => e.op === op)
  // while 那一行的判断：每一轮一次，最后一次不进循环
  const isCheck = (g: StepGroup) => g.line === loop && has(g, 'branch')
  const checks = new Map<string, number>()
  for (const g of groups) if (isCheck(g)) checks.set(`${g.block}:${g.wave}`, (checks.get(`${g.block}:${g.wave}`) ?? 0) + 1)

  const moves: TreeMove[] = []
  const seen = new Map<string, number>()
  let cur: TreeMove | null = null
  /** 这一段里已经判断过一次 while 了：再判断就是下一轮，另起一段 */
  let checked = false
  for (const [k, g] of groups.entries()) {
    const key = `${g.block}:${g.wave}`
    const check = isCheck(g)
    if (cur && (cur.block !== g.block || cur.wave !== g.wave || (check && checked))) {
      moves.push(cur)
      cur = null
    }
    if (!cur) {
      cur = { first: k, last: k, from: g.from, to: g.to, block: g.block, wave: g.wave, kind: 'put', round: 0, barrier: false }
      checked = false
    }
    cur.last = k
    cur.to = g.to
    if (check) {
      const n = (seen.get(key) ?? 0) + 1
      seen.set(key, n)
      const total = checks.get(key) ?? n
      checked = true
      cur.kind = n < total ? 'round' : 'tail'
      cur.round = n < total ? n : total - 1
    }
    if (has(g, 'barrier')) {
      cur.barrier = true
      moves.push(cur)
      cur = null
    }
  }
  if (cur) moves.push(cur)
  return moves
}

/** 到第 step 步为止（含），这支小队做了几轮加法。 */
function roundsDone(result: RunResult, block: number, wave: number, step: number): number {
  return (addSteps(result).get(`${block}:${wave}`) ?? []).filter((s) => s <= step).length
}

/** 实验台这一段的一句话：哪支小队，第几轮、几个线程把隔几格的数加过来、有没有取早，停在同步上时到了几支小队。 */
export function moveStory(result: RunResult, launch: Launch, moves: readonly TreeMove[], index: number): string {
  const m = moves[index]
  if (!m) return ''
  const own = result.events.slice(m.from, m.to)
  const steps = new Set(own.map((e) => e.step))
  const squad = launch.grid > 1 ? `block ${m.block} 的小队 ${m.wave}` : `小队 ${m.wave}`
  const put = own.find((e) => e.op === 'store' && e.space === 'lds' && e.array === SHELF_NAME)
  let text = ''
  if (m.kind === 'put') {
    text = put ? `${squad}：${put.addrs?.length ?? 0} 个线程把 a 里的数放上货架的第 ${spanText(put.addrs ?? [])} 格。` : `${squad}：开始走。`
  } else if (m.kind === 'round') {
    const s = 2 ** (m.round - 1)
    const head = `${squad} 第 ${m.round} 轮（隔 ${s} 格配对）`
    if (!put) text = `${head}：这支小队里没有线程要加。`
    else {
      const who = lanesOf(put).map((l) => m.wave * result.wave + l)
      text = who.length === 1
        ? `${head}：线程 ${who[0]} 把右边隔 ${s} 格的数加到自己那一格。`
        : `${head}：${who.length} 个线程（线程 ${spanText(who)}）各把右边隔 ${s} 格的数加到自己那一格。`
    }
    const early = sumRaces(result).early.filter((r) => steps.has(r.first.step))
    if (early.length) {
      const slots = [...new Set(early.map((r) => r.index))]
      const owners = [...new Set(early.map((r) => Math.floor(r.second.thread / result.wave)))].map((w) => `小队 ${w}`).join('、')
      text += `可第 ${spanText(slots)} 格要等${owners} 先加好，它还没走到这一轮：取早了。`
    }
  } else {
    const write = outWrites(result, LAB_ARGS).find((w) => steps.has(w.step))
    text = `${squad}：${m.round} 轮都走完了，循环结束。`
    text += write ? `线程 0 把第 0 格的数存进 out[0]：out[0] = ${write.after}。` : '这支小队没有线程要存 out[0]。'
  }
  if (m.barrier) {
    const p = syncProgress(prepareWave(result, launch), m.last)
    if (p && p.total > 1 && p.arrived < p.total) text += `走到同步，停下来等：这一组 ${p.total} 支小队，到了 ${p.arrived} 支。`
    else if (p && p.total > 1) text += `也走到了同步：${p.total} 支小队都到齐了，一起往下走。`
  } else if (m.kind === 'round' && moves[index + 1]?.kind === 'round' && moves[index + 1]?.wave === m.wave) {
    text += '没有同步，接着走下一轮。'
  }
  return text
}

/** 实验台跑完以后的一句话（03 第 1 节第 4 条）：out[0] 对不对、几轮、谁取早了、几处数据竞争。 */
export function labText(result: RunResult): string {
  if (!result.ok) return ''
  const out = result.arrays[OUT_NAME]?.[0] ?? 0
  const rounds = roundsOf(result)
  const races = sumRaces(result)
  if (out === LAB_TOTAL && !races.total) {
    return `${rounds} 轮就把 ${LAB_LAUNCH.block} 个数加成了 ${out}（模拟）：每一轮做加法的线程少一半，轮与轮之间整组等齐，下一轮取的都是加好的数。`
  }
  let where = ''
  const e = races.early[0]
  if (e) {
    const owner = Math.floor(e.second.thread / result.wave)
    const done = roundsDone(result, e.second.block, owner, e.first.step)
    const at = stepGroups(result.events).find((g) => g.step === e.first.step)
    const value = at ? treeBoard(result, LAB_ARGS, LAB_LAUNCH, LAB_TOTAL, at.from).shelves[e.first.block]?.slots[e.index]?.value : null
    const state = done ? `才加到第 ${done} 轮` : '一轮都还没加'
    where = `线程 ${e.first.thread} 在第 ${roundsDone(result, e.first.block, Math.floor(e.first.thread / result.wave), e.first.step)} 轮`
      + `取第 ${e.index} 格的时候，小队 ${owner} ${state}，取到的是 ${value ?? '?'}。`
  }
  const others = races.total - races.early.length
  const rest = others
    ? `模拟器一共记下 ${races.total} 处数据竞争：另外 ${others} 处是同一支小队里，这一轮写、下一轮取，中间没有同步，模拟器里一支小队一起走，碰巧取对了。`
    : `模拟器记下 ${races.total} 处数据竞争。`
  return `删掉每一轮之后的同步，out[0] 是 ${out}，应该是 ${LAB_TOTAL}。小队 0 没人拦着，一口气走完 ${rounds} 轮：${where}${rest}`
}

// ── 探索三：大家往同一格加 ────────────────────────────────────────────────────

/** 派 2 组、每组 64 个线程，一共 128 个数。 */
export const ADD_LAUNCH: Launch = { grid: 2, block: SHELF }
export const ADD_ARGS = sumArgs(ADD_LAUNCH.grid * ADD_LAUNCH.block)
export const ADD_TOTAL = totalOf(ADD_LAUNCH.grid * ADD_LAUNCH.block)

export type AddMode = 'plain' | 'atomic'
export const ADD_MODES: readonly { value: AddMode; label: string }[] = [
  { value: 'plain', label: '普通加' },
  { value: 'atomic', label: '原子加' },
]
export const DEFAULT_ADD_MODE: AddMode = 'plain'

/** 往 out[0] 上加的那一行。 */
export const ADD_LINE: Record<AddMode, Record<Lang, string>> = {
  plain: { hip: 'out[0] += a[i];', python: 'out[0] += a[i]' },
  atomic: { hip: 'atomicAdd(&out[0], a[i]);', python: 'atomic_add(out, 0, a[i])' },
}

export function addAllCode(mode: AddMode, lang: Lang): string {
  const note = mode === 'plain' ? '普通加' : '原子加'
  return lang === 'hip'
    ? [
        '__global__ void add_all(float* a, float* out) {',
        '    int i = blockIdx.x * blockDim.x + threadIdx.x;',
        withNote(`    ${ADD_LINE[mode].hip}`, note, lang),
        '}',
      ].join('\n')
    : [
        '@kernel',
        'def add_all(a, out):',
        '    i = blockIdx.x * blockDim.x + threadIdx.x',
        withNote(`    ${ADD_LINE[mode].python}`, note, lang),
      ].join('\n')
}

/** 探索三跑完以后的一句话：out[0] 是多少，丢了多少，排了几次队，几处数据竞争。 */
export function addText(mode: AddMode, result: RunResult): string {
  if (!result.ok) return ''
  const out = result.arrays[OUT_NAME]?.[0] ?? 0
  const n = ADD_LAUNCH.grid * ADD_LAUNCH.block
  if (mode === 'atomic') {
    return `out[0] = ${out}，${n} 个数一个都没丢（模拟）。可大家都往同一格加，原子加只能一个一个来：out[0] 前排了 ${queueOf(result.events)} 次队。`
  }
  const writes = outWrites(result, ADD_ARGS).length
  const races = sumRaces(result).total
  return `out[0] = ${out}，应该是 ${ADD_TOTAL}：${n} 个数只留下了 ${writes} 个，每支小队只留下一个线程的。模拟器还记下 ${races} 处数据竞争。`
}

// ── 挑战：两组一起求和 ────────────────────────────────────────────────────────

/** 派 2 组、每组 64 个线程，一共 128 个数。 */
export const SUM_LAUNCH: Launch = { grid: 2, block: SHELF }
/** ★3 换一种派法：4 组、每组 32 个线程，还是这 128 个数。 */
export const VARIANT_LAUNCH: Launch = { grid: 4, block: WAVE }
export const SUM_N = SUM_LAUNCH.grid * SUM_LAUNCH.block
export const SUM_ARGS = sumArgs(SUM_N)
export const SUM_TOTAL = totalOf(SUM_N)
/** 换派法再跑一次：数据不变（4 × 32 也是 128 个数），用沙盒自己的 args。 */
export const SUM_VARIANTS: SandboxVariant[] = [{ ...VARIANT_LAUNCH }]

/** 循环的终点：初始写 1，一轮都不搭；★3 要跟着每组的人数变。 */
export const DEFAULT_STOP = '1'
export const BEST_STOP = 'blockDim.x'

/** 最后那一行的四种写法：每人原子加自己那一格（初始）、每人普通加、线程 0 普通加、线程 0 原子加。 */
export type MergeKind = 'everyAtomic' | 'everyPlain' | 'onePlain' | 'oneAtomic'
export const MERGES: Record<MergeKind, Record<Lang, string>> = {
  everyAtomic: { hip: 'atomicAdd(&out[0], box[t]);', python: 'atomic_add(out, 0, box[t])' },
  everyPlain: { hip: 'out[0] += box[t];', python: 'out[0] += box[t]' },
  onePlain: { hip: 'if (t == 0) out[0] += box[0];', python: 'if t == 0: out[0] += box[0]' },
  oneAtomic: { hip: 'if (t == 0) atomicAdd(&out[0], box[0]);', python: 'if t == 0: atomic_add(out, 0, box[0])' },
}
export const MERGE_ORDER: readonly MergeKind[] = ['everyAtomic', 'everyPlain', 'onePlain', 'oneAtomic']

/** 挑战的工作单：三个空。初始一轮都不搭，每个线程把自己那一格原子加进 out[0]：对，可排了 128 次队（能跑但不好）。 */
export const SUM_CODE = Object.fromEntries((['hip', 'python'] as const).map((lang) => [lang, sumSource(lang, {
  name: 'sum_all',
  stop: `[[stop: ${DEFAULT_STOP}]]`,
  stopShown: DEFAULT_STOP,
  wait: `[[wait: ${SYNC_CALL[lang]}]]`,
  tail: `[[merge: ${MERGES.everyAtomic[lang]}]]`,
})])) as Record<Lang, string>

/** 手机上的选项：搭到哪为止；每一轮之后等不等；最后那一行谁去加。 */
export const SUM_BLANKS = {
  stop: { label: '循环搭到哪为止（s 小于它就再加一轮）', choices: [DEFAULT_STOP, '32', '64', BEST_STOP] },
  wait: { label: '每一轮之后：等不等', choices: { hip: [SYNC_CALL.hip, NO_WAIT.hip], python: [SYNC_CALL.python, NO_WAIT.python] } },
  merge: {
    label: '最后：谁把什么加进 out[0]',
    choices: { hip: MERGE_ORDER.map((k) => MERGES[k].hip), python: MERGE_ORDER.map((k) => MERGES[k].python) },
  },
}

export const STAR_LABELS = [
  `out[0] 是 ${SUM_N} 个数的和，没有数据竞争`,
  `out[0] 前只排 ${SUM_LAUNCH.grid} 次队：每组只派一个线程去加`,
  `换成 ${VARIANT_LAUNCH.grid} 组、每组 ${VARIANT_LAUNCH.block} 个线程，同一份代码照样对、只排 ${VARIANT_LAUNCH.grid} 次队`,
] as const

export const HINTS: Hints = {
  direction: '先看 out[0] 前排了几次队：每个线程都去加，就排 128 次。能不能先在组里把 64 个数加成一个，再派一个线程去加？',
  location: '改三个虚线框：while 后面那个数（搭到哪为止）、每一轮之后等不等、最后那一行谁把什么加进 out[0]。搭完树，这一组的和在第 0 格。',
  answer: `循环搭到 ${BEST_STOP} 为止，每一轮之后留着同步；最后一行写 ${MERGES.oneAtomic.hip}`
    + `（Python 风格写 ${MERGES.oneAtomic.python}）。终点写 64 也能加对 64 个线程一组的，可换成每组 32 个线程，最后一轮就取到了没人放的格子。`,
}

/**
 * ★1：out[0] 是全部的和，没有数据竞争。没做到时写成「现象 / 原因 / 怎么改」（03 第 4 节），按这个顺序找原因：
 * 代码出错；取到了货架外面；存到了 out 外面；货架上没等（每一轮之后不同步）；out 上用普通加；数不对（没搭完、加重了）。
 */
function wrongSum(run: SandboxRun): ChallengeError | null {
  const { result, launch } = run
  if (!result.ok) return explainError(result.error)
  const n = launch.grid * launch.block
  const expected = totalOf(n)
  const out = result.arrays[OUT_NAME]?.[0] ?? 0
  const races = sumRaces(result)
  const queue = queueOf(result.events)
  const rounds = roundsOf(result)
  const outside = result.diagnostics.filter((d): d is OobRead => d.kind === 'oob-read' && d.space === 'lds')
  const raw = [
    `out[0]：${out}（应该是 ${expected}）`,
    `每组搭了：${rounds} 轮`,
    `out[0] 前排队：${queue} 次`,
    `数据竞争：${races.total} 处（货架上 ${races.early.length + races.lucky.length} 处，out 上 ${races.global.length} 处）`,
    `取到货架外面：${outside.length} 次`,
  ].join('\n')

  if (outside.length) {
    const d = outside[0]
    return {
      symptom: `有 ${outside.length} 次取到了货架外面。比如 block ${d.block} 的线程 ${d.thread} 要第 ${d.index} 格，货架只有第 0～${SHELF - 1} 格（模拟器里取到 0）。`,
      cause: '循环多搭了：隔的格数翻倍以后超出了这一组的格子，线程 0 去取右边的格子，取到了货架外面。',
      fix: `搭到 s 不小于每组的人数为止：每组 ${launch.block} 个线程，最后一轮隔 ${launch.block / 2} 格。人数写在 blockDim.x 里。`,
      raw,
    }
  }
  const spill = result.outside.find((o) => o.array === OUT_NAME)
  if (spill) {
    const w = spill.writes[0]
    return {
      symptom: `block ${w.block} 的线程 ${w.thread} 往 out[${spill.index}] 存，可 out 只有 1 格（模拟器没让它写进去）。`,
      cause: '每组把和存进自己的格子，是「再启动一次」的写法：存好以后，还要再启动一次 kernel，把这几格加起来。这个沙盒只启动一次。',
      fix: '让每组的线程 0 用原子加，把这一组的和加进 out[0]。',
      raw,
    }
  }
  if (races.early.length || races.lucky.length) {
    const r = races.early[0] ?? races.lucky[0]
    const seen = out === expected
      ? `out[0] 碰巧对了，可模拟器在货架上记下 ${races.early.length + races.lucky.length} 处数据竞争。`
      : `out[0] 是 ${out}，应该是 ${expected}；模拟器在货架上记下 ${races.early.length + races.lucky.length} 处数据竞争。`
    const detail = r.first.op === 'read'
      ? `比如第 ${r.index} 格（block ${r.first.block}）：线程 ${r.first.thread} 去取的时候，线程 ${r.second.thread} 这一轮还没把它加好。`
      : `比如第 ${r.index} 格（block ${r.first.block}）：线程 ${r.first.thread} 这一轮刚写好，线程 ${r.second.thread} 没等同步就在下一轮取了。`
    return {
      symptom: `${seen}${detail}`,
      cause: '每一轮之后没等：下一轮要取的格子，可能是别的线程这一轮才加好的。一组有两支小队，谁先走到哪一轮说不准。',
      fix: `在每一轮的加法之后同步（HIP 风格写 ${SYNC_CALL.hip}，Python 风格写 ${SYNC_CALL.python}），整组都加完这一轮，再走下一轮。`,
      raw,
    }
  }
  if (races.global.length) {
    const r = races.global[0]
    // 一支小队好几个线程同一步普通写 out[0]：大家读到同一个旧值，只留下一个；否则是每组一个线程，组和组之间没同步
    const crowded = result.events.some((e) => e.op === 'store' && e.array === OUT_NAME && (e.addrs?.length ?? 0) > 1)
    const seen = out === expected
      ? `out[0] 碰巧对了，可模拟器在 out[0] 上记下 ${races.global.length} 处数据竞争`
      : `out[0] 是 ${out}，应该是 ${expected}；模拟器在 out[0] 上记下 ${races.global.length} 处数据竞争`
    return {
      symptom: crowded
        ? `${seen}。`
        : `${seen}：block ${r.first.block} 的线程 ${r.first.thread} 和 block ${r.second.block} 的线程 ${r.second.thread} 都对 out[0] 读了又写，中间没有同步。`,
      cause: crowded
        ? '大家用普通加往 out[0] 上加：同一支小队的线程同时读到同一个旧值，各加各的，写回去只留下一个。'
        : '组和组之间没有同步。模拟器让两组一个接一个跑，两组的和都加上了；真卡上两组可能同时读到旧的 out[0]，有一组的和就丢了。',
      fix: `往 out[0] 上加用原子加：HIP 风格写 atomicAdd(&out[0], v);，Python 风格写 atomic_add(out, 0, v)。`,
      raw,
    }
  }
  if (out !== expected) {
    const need = roundsNeeded(launch.block)
    if (queue > launch.grid && rounds > 0) {
      return {
        symptom: `out[0] 是 ${out}，比 ${expected} 多：同一个数被加了好几次。`,
        cause: '搭过树以后，好几格里装的已经是部分和，每个线程再把自己那一格加进 out[0]，前面的数就重复了。',
        fix: '搭完树，这一组的和在第 0 格：只让线程 0 把 box[0] 加进 out[0]。',
        raw,
      }
    }
    if (rounds < need) {
      return {
        symptom: `out[0] 是 ${out}，应该是 ${expected}。`,
        cause: rounds === 0
          ? '循环一轮都没走：第 0 格里只有线程 0 自己放的数，这一组别的数还没加进来。'
          : `循环只搭了 ${rounds} 轮：第 0 格里只加了前 ${2 ** rounds} 个数，这一组 ${launch.block} 个数要搭 ${need} 轮。`,
        fix: `让循环一直搭到 s 不小于每组的人数为止（每组几个线程，写在 blockDim.x 里）。`,
        raw,
      }
    }
    return {
      symptom: `out[0] 是 ${out}，应该是 ${expected}。`,
      cause: '有的数没加进来，或者加了不止一次。',
      fix: '每组先在货架上搭完树（第 0 格就是这一组的和），再让线程 0 把它原子加进 out[0]。',
      raw,
    }
  }
  return null
}

/** ★3 换派法再跑的那一次：哪里不成立，一句话；成立是 null。 */
function variantProblem(run: SandboxRun): string | null {
  const { grid, block } = run.launch
  const lead = `换成 ${grid} 组、每组 ${block} 个线程再跑一次`
  const { result } = run
  if (!result.ok) return `${lead}，程序出错了：${result.error.message}`
  const unput = unputReads(result)
  if (unput.length) {
    const u = unput[0]
    return `${lead}：block ${u.block} 的线程 ${u.thread} 取了第 ${u.index} 格，可这一组只有 ${block} 个线程，没人放过那一格`
      + `（模拟器里是 0，碰巧不影响和；真卡上那里是之前留下的数）。循环的终点要跟着每组的人数变：每组几个线程，写在 blockDim.x 里。`
  }
  const error = wrongSum(run)
  if (error) return `${lead}：${error.symptom}`
  const queue = queueOf(result.events)
  if (queue > grid) return `${lead}，out[0] 前排了 ${queue} 次队。`
  return null
}

/**
 * 挑战的星级判定（06 第 7 节）：runs[0] 是派 2 组、每组 64 个线程的那一次，runs[1] 是换派法的那一次（SUM_VARIANTS）。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」；★2 看 out[0] 前只排了组数那么多次队；★3 看换派法以后 ★1、★2 照样成立。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, variant] = runs
  const error = wrongSum(main)
  if (error) return { earned: [false, false, false], next: error.fix, error }
  const queue = queueOf(main.result.events)
  const head = `out[0] = ${SUM_TOTAL}，没有数据竞争（模拟）。`
  if (queue > main.launch.grid) {
    return {
      earned: [true, false, false],
      next: `${head}可 out[0] 前排了 ${queue} 次队：每个线程都去加。原子加只能一个一个来：先在组里把 ${main.launch.block} 个数加成一个，只派一个线程去加。`,
    }
  }
  const problem = variant ? variantProblem(variant) : '还没有换派法再跑一次。'
  const rounds = roundsOf(main.result)
  if (problem) return { earned: [true, true, false], next: `${head}每组搭了 ${rounds} 轮，out[0] 前只排了 ${queue} 次队。${problem}` }
  return {
    earned: [true, true, true],
    next: `${head}每组搭了 ${rounds} 轮，out[0] 前只排了 ${queue} 次队；换成 ${VARIANT_LAUNCH.grid} 组、每组 ${VARIANT_LAUNCH.block} 个线程也照样成立。三颗星的标准都达到了。`,
  }
}

/** 沙盒结果插槽里一次运行的一句话：out[0] 对不对、几处数据竞争、搭了几轮、排了几次队。 */
export function runSummary(run: SandboxRun): string {
  const { result, launch } = run
  const lead = `派 ${launch.grid} 组、每组 ${launch.block} 个线程`
  if (!result.ok) return `${lead}：程序没有跑完。`
  const expected = totalOf(launch.grid * launch.block)
  const out = result.arrays[OUT_NAME]?.[0] ?? 0
  const races = sumRaces(result).total
  const outText = out === expected ? `out[0] = ${out}，对` : `out[0] = ${out}，应该是 ${expected}`
  const raceText = races ? `${races} 处数据竞争` : '没有数据竞争'
  return `${lead}：${outText}，${raceText}；每组搭了 ${roundsOf(result)} 轮，out[0] 前排了 ${queueOf(result.events)} 次队（模拟）。`
}
