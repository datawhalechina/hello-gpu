/**
 * 新手村副本「直方图」（X-03）：题目用到的图、代码、解读和判定（纯函数，单测在 scripts/tests/dungeon-histogram.test.mjs）。
 *
 * 题目：一张 16 × 16 的小图，每个像素的亮度分成 8 档（0 最暗，7 最亮），一行接一行存在 a 里。数每一档有几个像素，
 * 写进 hist[0]～hist[7]。派 4 组、每组 64 个线程，一个线程管一个像素：一组正好管图的 4 行。
 * 读者补三个空：货架清不清零、数的那一行、最后合不合并；两次同步是定的。
 * - ★1 8 档都数对：没有数据竞争，没有读写到数组外面，货架先清零再用（不靠模拟器把货架清零）。
 *   副本的 ★1 就是通关：发这道题的经验值，题解展开（X-01）。
 * - ★2 先在货架上数，再合并：每个像素都在货架上原子加，hist 前最多排 4 × 8 = 32 次队。
 * - ★3 只合并数到的档：hist 前只排 11 次队（每组只数到两三档，0 加进去也不变）。
 * 初始内容「能跑但不对」：普通加 hist[a[i]] += 1，不清零，不合并。原样运行一颗星都没有：
 * 原样运行就通关，等于不学也拿经验值（04 开头）。
 *
 * 「排队」只数原子加的次数（同 1-10）：往 hist 上原子加了几次，就是 hist 前排了几次队，不算时间。
 * 模拟器的约定决定了这道题看到的现象（08 第 4 节）：组一个接一个跑，所以组和组之间用普通加碰巧对，只记下数据竞争；
 * 货架每组开始时是 0，所以不清零也碰巧数对。判定按事件流找这两种情况，不靠值猜。
 * 两种写法的事件流（除了行号）和结果一样，判定也一样。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg, OobRead, Race, RunResult, SimEvent } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, type Launch, type SandboxRun } from '../../components/kit/sandbox/run.ts'

export const EXERCISE_ID = 'dungeon-histogram'

/** 图是 16 × 16，亮度分 8 档。 */
export const SIDE = 16
export const LEVELS = 8
export const PIXELS = SIDE * SIDE
/** 每组 64 个线程，正好 4 行像素；派 4 组，一个线程管一个像素。 */
export const BLOCK = 64
export const LAUNCH: Launch = { grid: PIXELS / BLOCK, block: BLOCK }
export const ROWS_PER_BLOCK = BLOCK / SIDE
export const SHELF_NAME = 'box'
export const HIST_NAME = 'hist'

/**
 * 自己画的小图：上面 4 行是天空和太阳（6、7 档），中间是两座山（3、4 档，向光的一面亮一档）和山后的天（5 档），
 * 下面 4 行是地面（0、1 档）和一条小河（2 档）。一行一个字符串，一个字是一个像素的亮度。
 * 一组管 4 行，每组只数到两三档：合并时有一大半的档是 0（★3）。
 */
export const IMAGE: readonly string[] = [
  '6666666666667766',
  '6666666666677776',
  '6666666666677776',
  '6666666666667766',
  '5555555555555555',
  '5555455555555555',
  '5554435555545555',
  '5544433555443555',
  '5444433354443355',
  '4444433344443335',
  '4444433344443333',
  '4444433344443333',
  '0110110210110110',
  '1101101121101101',
  '1011011012011011',
  '0110110110210110',
]

/** 一行接一行排成一维：a[i] 是第 i / 16 行、第 i % 16 列的亮度。 */
export const PIXEL_LEVELS: readonly number[] = IMAGE.join('').split('').map(Number)

/** 亮度 0～7 档画成由暗到亮的灰：这是图本身的颜色，亮色、暗色主题都一样（亮的格子上写深色的字）。 */
export const SHADES: readonly string[] = ['#0f172a', '#273449', '#3f4d63', '#5a687d', '#7b8799', '#a0aab8', '#c8cfd9', '#f1f4f8']

/** 一段像素里每一档各有几个。 */
export function countsOf(levels: readonly number[]): number[] {
  const counts = new Array<number>(LEVELS).fill(0)
  for (const v of levels) counts[v]++
  return counts
}

/** 整张图的直方图：hist 最后应该是这 8 个数。 */
export const EXPECTED: readonly number[] = countsOf(PIXEL_LEVELS)
/** 每组管的 4 行里，每一档各有几个像素（第 b 组是 a[64b]～a[64b + 63]）。 */
export const BLOCK_COUNTS: readonly (readonly number[])[] = Array.from(
  { length: LAUNCH.grid },
  (_, b) => countsOf(PIXEL_LEVELS.slice(b * BLOCK, (b + 1) * BLOCK)),
)
/** 每组数到了哪几档（这一组至少有一个像素是这一档）。 */
export const BLOCK_LEVELS: readonly (readonly number[])[] = BLOCK_COUNTS.map((c) => c.flatMap((n, k) => (n ? [k] : [])))
/** ★2：每组每档最多往 hist 上加一次。 */
export const MERGE_CAP = LAUNCH.grid * LEVELS
/** ★3：每组只加数到的档，一共几次（这张图是 11 次）。 */
export const FEWEST = BLOCK_LEVELS.reduce((n, list) => n + list.length, 0)

/** a 是 256 个像素的亮度，hist 一开始 8 档都是 0。 */
export const ARGS: Record<string, Arg> = {
  a: { type: 'int', data: [...PIXEL_LEVELS] },
  hist: { type: 'int', data: new Array<number>(LEVELS).fill(0) },
  n: { type: 'int', value: PIXELS },
}

// ── 工作单 ───────────────────────────────────────────────────────────────

const COMMENT: Record<Lang, string> = { hip: '//', python: '#' }
/** 行尾注释从第几列开始：同一张工作单里几行注释对齐。 */
const NOTE_COLUMN = 41

/** 一行代码加行尾注释。shown 是这一行显示出来的样子（模板里的空按初始内容算），用它对齐注释。 */
function withNote(code: string, note: string, lang: Lang, shown = code): string {
  return `${code}${' '.repeat(Math.max(1, NOTE_COLUMN - shown.length))}${COMMENT[lang]} ${note}`
}

/** 三处由读者来写：清零、数、合并。 */
interface Parts {
  clear: string
  count: string
  /** count 这一行显示出来的样子（模板里是空的初始内容），对齐行尾注释用 */
  countShown?: string
  merge: string
}

/** 一组：清零，等；每个线程把自己那个像素数一下，等；最后合并。两次同步是定的。 */
function histSource(lang: Lang, p: Parts): string {
  const countShown = p.countShown ?? p.count
  const rows = lang === 'hip'
    ? [
        '__global__ void histogram(int* a, int* hist, int n) {',
        withNote('    __shared__ int box[8];', '货架开 8 格，一档一格', lang),
        '    int t = threadIdx.x;',
        withNote('    int i = blockIdx.x * blockDim.x + t;', '第 i 个像素', lang),
        `    ${p.clear}`,
        withNote('    __syncthreads();', '等整组都清好', lang),
        withNote(`    if (i < n) ${p.count}`, '数一个像素', lang, `    if (i < n) ${countShown}`),
        withNote('    __syncthreads();', '等整组都数完', lang),
        `    ${p.merge}`,
        '}',
      ]
    : [
        '@kernel',
        'def histogram(a, hist, n):',
        withNote('    box = shared(8, int)', '货架开 8 格，一档一格', lang),
        '    t = threadIdx.x',
        withNote('    i = blockIdx.x * blockDim.x + t', '第 i 个像素', lang),
        `    ${p.clear}`,
        withNote('    syncthreads()', '等整组都清好', lang),
        withNote(`    if i < n: ${p.count}`, '数一个像素', lang, `    if i < n: ${countShown}`),
        withNote('    syncthreads()', '等整组都数完', lang),
        `    ${p.merge}`,
      ]
  return rows.join('\n')
}

/** 每一处的几种写法（两种写法按位置对应）：手机上的选项，也是单测和题解用的写法。 */
export const CLEARS: Record<Lang, readonly string[]> = {
  hip: ['// 不清零', 'box[t] = 0;', 'if (t < 8) box[t] = 0;'],
  python: ['# 不清零', 'box[t] = 0', 'if t < 8: box[t] = 0'],
}
export const COUNTS: Record<Lang, readonly string[]> = {
  hip: ['hist[a[i]] += 1;', 'atomicAdd(&hist[a[i]], 1);', 'box[a[i]] += 1;', 'atomicAdd(&box[a[i]], 1);'],
  python: ['hist[a[i]] += 1', 'atomic_add(hist, a[i], 1)', 'box[a[i]] += 1', 'atomic_add(box, a[i], 1)'],
}
export const MERGES: Record<Lang, readonly string[]> = {
  hip: [
    '// 不合并',
    'if (t < 8) hist[t] += box[t];',
    'if (t < 8) atomicAdd(&hist[t], box[t]);',
    'if (t < 8 && box[t] > 0) atomicAdd(&hist[t], box[t]);',
  ],
  python: [
    '# 不合并',
    'if t < 8: hist[t] += box[t]',
    'if t < 8: atomic_add(hist, t, box[t])',
    'if t < 8 and box[t] > 0: atomic_add(hist, t, box[t])',
  ],
}

/** 初始内容：不清零，普通加直接往 hist 上数，不合并。 */
export const CODE: Record<Lang, string> = {
  hip: histSource('hip', {
    clear: `[[clear: ${CLEARS.hip[0]}]]`,
    count: `[[count: ${COUNTS.hip[0]}]]`,
    countShown: COUNTS.hip[0],
    merge: `[[merge: ${MERGES.hip[0]}]]`,
  }),
  python: histSource('python', {
    clear: `[[clear: ${CLEARS.python[0]}]]`,
    count: `[[count: ${COUNTS.python[0]}]]`,
    countShown: COUNTS.python[0],
    merge: `[[merge: ${MERGES.python[0]}]]`,
  }),
}

export const BLANKS = {
  clear: { label: '数之前：货架清不清零', choices: CLEARS },
  count: { label: '数一个像素：加在哪、怎么加', choices: COUNTS },
  merge: { label: '数完以后：怎么合进 hist', choices: MERGES },
}

/** 启动那一行（1-2 定的写法）。 */
export function launchLine(lang: Lang): string {
  const { grid, block } = LAUNCH
  return lang === 'hip'
    ? `histogram<<<${grid}, ${block}>>>(d_a, d_hist, ${PIXELS});`
    : `histogram[${grid}, ${block}](d_a, d_hist, ${PIXELS})`
}

export const STAR_LABELS = [
  `hist 的 ${LEVELS} 档都数对：没有数据竞争，货架先清零再用`,
  `先在货架上数，再合并：hist 前最多排 ${MERGE_CAP} 次队`,
  `只合并数到的档：hist 前只排 ${FEWEST} 次队`,
] as const

export const HINTS: Hints = {
  direction: 'hist 里的数比该有的少很多。普通加 hist[a[i]] += 1 是读出来、加 1、写回去：一支小队 32 个线程同时读到同一个旧值，会怎样？',
  location: '先改数的那一行：换成原子加。想少排队，就先加在这一组的货架 box 上：数之前把 8 格清零（货架只有 8 格），数完再把 8 档合进 hist。',
  answer: `清零写 ${CLEARS.hip[2]}，数的那一行写 ${COUNTS.hip[3]}，合并写 ${MERGES.hip[3]}`
    + `（Python 风格依次写 ${CLEARS.python[2]}、${COUNTS.python[3]}、${MERGES.python[3]}）。`,
}

// ── 判定 ─────────────────────────────────────────────────────────────────

/** 一个线程：在第几组、组里第几个。 */
export interface Thread {
  block: number
  thread: number
}

/** 一次用了没清零的格子：这一组还没有线程往 box[index] 写过，就有线程往上加（atomic）或者读（load）它。 */
export interface Unzeroed extends Thread {
  index: number
  op: 'load' | 'atomic'
}

/** 一次运行之后 hist 的样子，以及谁往哪里加了几次。 */
export interface HistCheck {
  values: number[]
  /** hist 里数错的档 */
  wrong: number[]
  /** ★1：8 档都对，没有数据竞争，没有读写到数组外面，货架先清零再用 */
  correct: boolean
  /** 往 hist 上原子加了几次（hist 前排了几次队） */
  globalAdds: number
  /** 往货架上原子加了几次 */
  shelfAdds: number
  /** 普通地写 hist 写了几次（hist[k] += …、hist[k] = …） */
  histWrites: number
  /** adds[b][k]：第 b 组往 hist[k] 上原子加了几次 */
  adds: number[][]
  /** 第 b 组往 hist[k] 上原子加了，可这一组一个这一档的像素都没有（加的是 0） */
  wasted: { block: number; level: number }[]
  /** 一支小队同一步里，好几个线程普通地写 hist（或 box）的同一格：只留下一个 */
  crowdedHist: boolean
  crowdedShelf: boolean
  /** 往 hist 上只写不读（hist[k] = …）：后写的盖掉先写的 */
  overwrites: boolean
  races: Race[]
  oobReads: OobRead[]
  /** 写到数组外面：哪个数组（共享数组带组号）、哪一格、谁写的 */
  oobWrites: { array: string; index: number; block: number; thread: number }[]
  unzeroed: Unzeroed[]
}

/** 一个事件的掩码里，哪几个 lane 在做（按 lane 顺序，和 addrs 一一对应）。 */
function lanesOf(e: SimEvent): number[] {
  const out: number[] = []
  for (let k = 0; k < e.mask.length; k++) if (e.mask[k] === '1') out.push(k)
  return out
}

/** 每组往 hist 每一格上原子加的次数，只数前 upto 个事件；[from, upto) 里加到的格子记进 now。 */
export function addTable(events: readonly SimEvent[], grid: number, upto = events.length, from = upto) {
  const adds = Array.from({ length: grid }, () => new Array<number>(LEVELS).fill(0))
  const now = Array.from({ length: grid }, () => new Array<boolean>(LEVELS).fill(false))
  const end = Math.min(upto, events.length)
  for (let n = 0; n < end; n++) {
    const e = events[n]
    if (e.op !== 'atomic' || e.space !== 'global' || e.array !== HIST_NAME || !adds[e.block]) continue
    for (const k of e.addrs ?? []) {
      if (k < 0 || k >= LEVELS) continue
      adds[e.block][k]++
      if (n >= from) now[e.block][k] = true
    }
  }
  return { adds, now }
}

export function checkHistogram(run: SandboxRun): HistCheck {
  const { result, launch } = run
  const values = result.arrays[HIST_NAME] ?? []
  const wrong = EXPECTED.flatMap((v, k) => (values[k] === v ? [] : [k]))
  const { adds } = addTable(result.events, launch.grid)
  const wasted: HistCheck['wasted'] = []
  adds.forEach((row, block) => row.forEach((n, level) => {
    if (n > 0 && !BLOCK_COUNTS[block]?.[level]) wasted.push({ block, level })
  }))

  let globalAdds = 0
  let shelfAdds = 0
  let histWrites = 0
  let crowdedHist = false
  let crowdedShelf = false
  let overwrites = false
  // 每组的货架上，哪几格已经有线程写过（清零）；没写过就往上加或者读，用的是没清零的格子
  const cleared = new Map<number, Set<number>>()
  const unzeroed: Unzeroed[] = []
  const histLoads = new Set<number>()
  for (const e of result.events) {
    if (e.op === 'load' && e.space === 'global' && e.array === HIST_NAME) histLoads.add(e.step)
  }
  for (const e of result.events) {
    const addrs = e.addrs ?? []
    if (e.op === 'atomic') {
      if (e.space === 'global' && e.array === HIST_NAME) globalAdds += addrs.length
      if (e.space === 'lds' && e.array === SHELF_NAME) shelfAdds += addrs.length
    }
    // 一支小队同一步里，好几个线程普通地写同一格（下标有重复）：只留下一个
    const crowded = e.op === 'store' && new Set(addrs).size < addrs.length
    if (e.op === 'store' && e.array === HIST_NAME && e.space === 'global') {
      histWrites += addrs.length
      if (crowded) crowdedHist = true
      if (!histLoads.has(e.step)) overwrites = true
    }
    if (crowded && e.array === SHELF_NAME && e.space === 'lds') crowdedShelf = true
    if (e.space !== 'lds' || e.array !== SHELF_NAME) continue
    let set = cleared.get(e.block)
    if (!set) cleared.set(e.block, (set = new Set()))
    if (e.op === 'store') {
      for (const k of addrs) set.add(k)
    } else if (e.op === 'load' || e.op === 'atomic') {
      const lanes = lanesOf(e)
      addrs.forEach((k, j) => {
        if (k < 0 || k >= LEVELS || set.has(k)) return
        unzeroed.push({ block: e.block, thread: e.wave * result.wave + lanes[j], index: k, op: e.op === 'load' ? 'load' : 'atomic' })
      })
    }
  }

  const races = result.diagnostics.filter((d): d is Race => d.kind === 'race')
  const oobReads = result.diagnostics.filter((d): d is OobRead => d.kind === 'oob-read')
  const oobWrites = result.outside.flatMap((o) => o.writes.map((w) => ({ array: o.array, index: o.index, block: w.block, thread: w.thread })))
  return {
    values,
    wrong,
    correct: result.ok && values.length === LEVELS && !wrong.length && !races.length && !oobReads.length && !oobWrites.length && !unzeroed.length,
    globalAdds,
    shelfAdds,
    histWrites,
    adds,
    wasted,
    crowdedHist,
    crowdedShelf,
    overwrites,
    races,
    oobReads,
    oobWrites,
    unzeroed,
  }
}

/** 一串数写成「8～63」「0、3」：连着的并成一段，最多写两段，再多写「等」。 */
export function spans(list: readonly number[], name: (v: number) => string = String): string {
  const runs: [number, number][] = []
  for (const v of [...new Set(list)].sort((p, q) => p - q)) {
    const last = runs[runs.length - 1]
    if (last && v === last[1] + 1) last[1] = v
    else runs.push([v, v])
  }
  const shown = runs.slice(0, 2).map(([from, to]) => (from === to ? name(from) : `${name(from)}～${name(to)}`))
  return `${shown.join('、')}${runs.length > 2 ? ' 等' : ''}`
}

const ATOMIC_COUNT = `atomicAdd(&box[a[i]], 1);（Python 风格写 atomic_add(box, a[i], 1)）`
const ATOMIC_MERGE = `${MERGES.hip[2]}（Python 风格写 ${MERGES.python[2]}）`

/**
 * ★1 不成立时：说清现象、原因、怎么改（03 第 4 节）。按这个顺序找原因：
 * 代码出错；读写到数组外面；数错了（普通加只留下一个、没合并、合并时盖掉、别的）；
 * 数对了，可有数据竞争（碰巧对）；数对了，可货架没清零就用了（碰巧对）。
 */
function wrongText(run: SandboxRun, c: HistCheck): ChallengeError {
  const { result } = run
  if (!result.ok) return explainError(result.error)
  const raw = [
    `hist：${c.values.join('、')}（应该是 ${EXPECTED.join('、')}）`,
    `hist 前排队：${c.globalAdds} 次；货架上原子加：${c.shelfAdds} 次`,
    `数据竞争：${c.races.length} 处（hist 上 ${c.races.filter((r) => r.space === 'global').length} 处，货架上 ${c.races.filter((r) => r.space === 'lds').length} 处）`,
    `读到数组外面 ${c.oobReads.length} 次，写到数组外面 ${c.oobWrites.length} 次`,
    `用了没清零的格子：${c.unzeroed.length} 次`,
  ].join('\n')

  const outsideShelf = c.oobWrites.filter((w) => w.array === SHELF_NAME)
  if (outsideShelf.length) {
    const who = [...new Set(outsideShelf.filter((w) => w.block === outsideShelf[0].block).map((w) => w.thread))]
    return {
      symptom: `有 ${outsideShelf.length} 次写到了货架外面：比如 block ${outsideShelf[0].block} 的线程 ${spans(who)} 往 box[${spans(who)}] 写，可货架只有 box[0]～box[${LEVELS - 1}]（模拟器没让它写进去）。`,
      cause: `清零那一行让每个线程都清自己那一格，可一组有 ${run.launch.block} 个线程，货架只有 ${LEVELS} 格。真卡上写到货架外面，可能改掉别的数据。`,
      fix: `只让前 ${LEVELS} 个线程清零：${CLEARS.hip[2]}（Python 风格写 ${CLEARS.python[2]}）。`,
      raw,
    }
  }
  if (c.oobReads.length || c.oobWrites.length) {
    const d = c.oobReads[0]
    const w = c.oobWrites[0]
    const what = d
      ? `block ${d.block} 的线程 ${d.thread} 读 ${d.array}[${d.index}]，可 ${d.array} 只有 ${d.length} 格（模拟器里读到 0）`
      : `block ${w.block} 的线程 ${w.thread} 往 ${w.array}[${w.index}] 写，可那一格在 ${w.array} 外面（模拟器没让它写进去）`
    return {
      symptom: `有线程读写到了数组外面：比如 ${what}。`,
      cause: `hist 和货架都只有 ${LEVELS} 格：下标是 t 的那几行，只有 t 小于 ${LEVELS} 的线程能做。`,
      fix: `用 t 当下标的那几行，前面加上条件 t < ${LEVELS}。`,
      raw,
    }
  }
  if (c.wrong.length) {
    // 拿错得最多的那一档举例
    const k = c.wrong.reduce((best, j) => (Math.abs(c.values[j] - EXPECTED[j]) > Math.abs(c.values[best] - EXPECTED[best]) ? j : best), c.wrong[0])
    const symptom = `hist 的 ${LEVELS} 档里有 ${c.wrong.length} 档数错了：比如 hist[${k}] 应该是 ${EXPECTED[k]}，运行后是 ${c.values[k]}。`
    if (!c.globalAdds && !c.histWrites) {
      const counted = c.shelfAdds > 0 || c.crowdedShelf
      return {
        symptom: `hist 的 ${LEVELS} 档都是 0：hist 一次也没加过。`,
        cause: counted
          ? '每组只在货架上数，没有合进 hist：货架只归这一组，程序结束就没了。'
          : '没有线程往 hist 上加：数的那一行没有数到 hist 里。',
        fix: counted
          ? `数完以后，让每组的前 ${LEVELS} 个线程各把一档合进 hist：${ATOMIC_MERGE}。`
          : `数的那一行用原子加：${COUNTS.hip[1]}（Python 风格写 ${COUNTS.python[1]}）。`,
        raw,
      }
    }
    if (c.crowdedHist || c.crowdedShelf) {
      const where = c.crowdedHist ? 'hist 上' : '货架上'
      const line = c.crowdedHist ? 'hist[a[i]] += 1' : 'box[a[i]] += 1'
      return {
        symptom,
        cause: `${where}用的是普通加：${line} 要做三件事，读出这一格、加 1、写回去。一支小队 ${result.wave} 个线程同一步做这三件事，`
          + '同一档的线程读到的是同一个旧值，各加各的 1，写回去只留下一个。',
        fix: c.crowdedHist
          ? `数的那一行换成原子加：${COUNTS.hip[1]}（Python 风格写 ${COUNTS.python[1]}），读、加、写一口气做完。`
          : `在货架上也用原子加：${ATOMIC_COUNT}。`,
        raw,
      }
    }
    if (c.overwrites) {
      const last = BLOCK_COUNTS[BLOCK_COUNTS.length - 1]
      const lastOnly = c.values.every((v, j) => v === last[j])
      return {
        symptom: `${symptom}${lastOnly ? `hist 正好是最后一组 block ${BLOCK_COUNTS.length - 1} 自己数的。` : ''}`,
        cause: '合并那一行是写，不是加：每组都把自己的 8 档写进 hist，后写的组把前面组的数盖掉了。',
        fix: `合并时把这一组的数加上去，而且用原子加：${ATOMIC_MERGE}。`,
        raw,
      }
    }
    return {
      symptom,
      cause: '有的像素没数到，或者数了不止一次：比如既往 hist 上加，又把货架上的数合进 hist。',
      fix: `每个像素只数一次：先在货架上原子加（${ATOMIC_COUNT}），数完每组再把 8 档各合并一次。`,
      raw,
    }
  }
  if (c.races.length) {
    const r = c.races.find((x) => x.space === 'global') ?? c.races[0]
    if (r.space === 'global') {
      return {
        symptom: `hist 的 ${LEVELS} 档碰巧都对，可模拟器在 hist 上记下 ${c.races.filter((x) => x.space === 'global').length} 处数据竞争：`
          + `比如 hist[${r.index}]，block ${r.first.block} 的线程 ${r.first.thread} 和 block ${r.second.block} 的线程 ${r.second.thread} 都改了它，其中有普通加。`,
        cause: `组和组之间没有同步。模拟器让 ${run.launch.grid} 组一个接一个跑，碰巧都加上了；真卡上几组同时跑，可能同时读到旧的 hist[${r.index}]，有一组的数就丢了。`,
        fix: `往 hist 上加，都用原子加：${ATOMIC_MERGE}。`,
        raw,
      }
    }
    return {
      symptom: `hist 的 ${LEVELS} 档碰巧都对，可模拟器在货架上记下 ${c.races.length} 处数据竞争：比如 block ${r.first.block} 的 box[${r.index}]，`
        + `线程 ${r.first.thread} 和线程 ${r.second.thread} 都碰了它，中间没有同步。`,
      cause: '清零、数、合并是三件事，每件事都要等整组做完，才能做下一件：没清好就数，数到一半就合并，结果都说不准。',
      fix: '清零之后、合并之前各同步一次，这两行同步不要删。',
      raw,
    }
  }
  const u = c.unzeroed[0]
  return {
    symptom: `hist 的 ${LEVELS} 档碰巧都对，可货架没清零就用了：block ${u.block} 的线程 ${u.thread} ${u.op === 'atomic' ? `往 box[${u.index}] 上加的时候` : `读 box[${u.index}] 的时候`}，这一组还没人把它清零。`,
    cause: '模拟器里货架一开始是 0，这次碰巧数对了。真卡上货架不会自己清零，上面是之前留下的数，往上加就全乱了。',
    fix: `数之前先把这一组的 ${LEVELS} 格清零：${CLEARS.hip[2]}（Python 风格写 ${CLEARS.python[2]}）。清零那一行后面已经有同步。`,
    raw,
  }
}

/** 白排的队写成一句话：哪一组、哪几档加的是 0。 */
function wastedText(c: HistCheck): string {
  const block = c.wasted[0].block
  const levels = c.wasted.filter((w) => w.block === block).map((w) => w.level)
  const kept = BLOCK_LEVELS[block]
  return `block ${block} 管的 4 行只有 ${kept.join('、')} 档：hist[${spans(levels)}] 加的都是 0，白排了 ${levels.length} 次队`
}

/**
 * 星级判定（06 第 7 节）：runs[0] 是派 4 组、每组 64 个线程的那一次（这道题不换派法）。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」；★2 看是不是先在货架上数、hist 前最多排 32 次队；
 * ★3 看是不是只合并数到的档（hist 前只排 11 次队）。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main] = runs
  const c = checkHistogram(main)
  if (!c.correct) {
    const error = wrongText(main, c)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const head = `${LEVELS} 档都数对了，没有数据竞争（模拟）。`
  if (c.shelfAdds < PIXELS) {
    const busiest = EXPECTED.indexOf(Math.max(...EXPECTED))
    const lead = c.globalAdds > MERGE_CAP
      ? `可 hist 前一共排了 ${c.globalAdds} 次队：每个像素都去显存原子加一次，hist[${busiest}] 前就排了 ${EXPECTED[busiest]} 个。`
      : `hist 前只排了 ${c.globalAdds} 次队，可这一次没在货架上数。`
    return {
      earned: [true, false, false],
      next: `${head}${lead}先在每组的货架上数（货架要先清零），数完每组每档只往 hist 加一次。`,
    }
  }
  if (c.globalAdds > MERGE_CAP) {
    return {
      earned: [true, false, false],
      next: `${head}在货架上数了，可 hist 前还是排了 ${c.globalAdds} 次队：数的时候只加货架，最后每组每档只往 hist 加一次。`,
    }
  }
  if (c.globalAdds > FEWEST) {
    return {
      earned: [true, true, false],
      next: `${head}先在货架上数，hist 前只排了 ${c.globalAdds} 次队。可 ${wastedText(c)}。0 加进去 hist 也不变，用不着去排队。`,
    }
  }
  return {
    earned: [true, true, true],
    next: `${head}先在货架上数，hist 前只排了 ${c.globalAdds} 次队：每组只合并数到的档，一次也没白排。三颗星的标准都达到了。`,
  }
}

/** 结果上面那一行：hist 数对了几档、排了几次队（模拟）。单步时只在最后一步写。 */
export function histText(result: RunResult | null): string {
  if (!result) return ''
  if (!result.ok) return '程序没有跑完：hist 停在出错那一刻的样子。'
  const values = result.arrays[HIST_NAME] ?? []
  const right = EXPECTED.filter((v, k) => values[k] === v).length
  let adds = 0
  for (const e of result.events) if (e.op === 'atomic' && e.space === 'global' && e.array === HIST_NAME) adds += e.addrs?.length ?? 0
  const lead = right === LEVELS ? `hist 的 ${LEVELS} 档都数对了` : `hist 的 ${LEVELS} 档数对了 ${right} 档`
  return `${lead}；hist 前一共排了 ${adds} 次队（模拟）。`
}
