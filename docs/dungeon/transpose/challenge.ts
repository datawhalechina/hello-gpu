/**
 * 新手村副本「矩阵转置」（X-02）：题目用到的代码、数据、解读和判定（纯函数，单测在 scripts/tests/dungeon-transpose.test.mjs）。
 *
 * 题目：a 有 9 行 32 列，一行接一行存成一维数组（第 r 行第 c 列在 a[r * C + c]）。把它转置进 b：b 有 32 行 9 列，
 * a 的第 r 行第 c 列搬到 b 的第 c 行第 r 列，也就是 b[c * R + r]。模拟器只有一维的 .x（08 第 3 节），
 * 每个线程先算出编号 g，再用 / 和 % 换算成行和列。派 5 组、每组 64 个线程，一共 320 个，比 288 个数多 32 个。
 * 读者补三个空：r、c、写入前的条件；搬的那一行是定的。
 * - ★1 b 正好是 a 的转置。副本的 ★1 就是通关：发这道题的经验值，题解展开（X-01）。
 * - ★2 没有线程读写到 a、b 外面。
 * - ★3 换成 6 行 10 列、10 行 6 列的矩阵，同一份代码照样成立（Sandbox 的 variants 连数据一起换）。
 * 初始内容「能跑但不好」：r、c 都除以 R（只有方阵才碰巧对），也不拦多派的线程。原样运行一颗星都没有。
 *
 * 合并访存不判星，只看（题目要求「观察」）：结果插槽和题解的访存视图（MemoryView）看小队每次读 a、写 b 搬几车。
 * 顺着 a 排（r = g / C，c = g % C）读 a 一车不多搬，写 b 隔 R 个写一个；顺着 b 排（r = g % R，c = g / R）反过来。
 * 9 × 32 时两种排法一共都是 90 车，理想 18 车（模拟，L3 的 analyzeMemory）：转置总有一侧要跨行。
 * 两种写法的事件流（除了行号）和结果一样，判定也一样。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import type { Arg, OobRead, RunResult, SimEvent } from '../../sim/lockstep.ts'
import { analyzeMemory } from '../../sim/memory.ts'
import { SIM_PARAMS } from '../../sim/params.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { explainError, type Launch, type SandboxRun, type SandboxVariant } from '../../components/kit/sandbox/run.ts'

export const EXERCISE_ID = 'dungeon-transpose'

/** 矩阵的形状：几行几列。 */
export interface Shape {
  rows: number
  cols: number
}

/**
 * a 有 9 行 32 列：一行 32 个 float 正好装满一车（模拟器一车 128 字节、一个数 4 字节，示意值），b 有 32 行 9 列。
 * 不是方阵：行数、列数用反了，结果就不对。
 */
export const ROWS = 9
export const COLS = 32
export const SIZE = ROWS * COLS
/** 每组 64 个线程，组数向上取整（1-4）：⌈288 ÷ 64⌉ = 5 组，一共 320 个线程。 */
export const BLOCK = 64
export const LAUNCH: Launch = { grid: Math.ceil(SIZE / BLOCK), block: BLOCK }
export const THREADS = LAUNCH.grid * LAUNCH.block

/** 一车装几个数（params.ts 的示意值：一车 128 字节，一个数 4 字节），一支小队几个线程（wave32，1-5）。 */
export const PER_LINE = SIM_PARAMS.lineBytes / SIM_PARAMS.elemBytes
export const WAVE = 32
/**
 * 9 × 32 时两种排法各搬几车（模拟），题解的正文用：a 一行正好一车，288 个数是 9 支小队的活。
 * 挨着的一侧每次 1 车；跨行的一侧隔 R 个读写一个，32 个数的范围有 32 × R 个数，正好 R 车。
 * 9 支小队一共：挨着的一侧 9 车、跨行的一侧 81 车，两种排法都是 90 车，理想 18 车。单测拿模拟器核对。
 */
export const CARS = {
  across: ROWS,
  total: (SIZE / WAVE) * (1 + ROWS),
  ideal: (2 * SIZE) / PER_LINE,
} as const

/** a[j] = j + 1：每个数都不一样，搬到哪里一眼看得出来；b 一开始全是 0。 */
export function transposeArgs({ rows, cols }: Shape): Record<string, Arg> {
  const n = rows * cols
  return {
    a: { type: 'float', data: Array.from({ length: n }, (_, j) => j + 1) },
    b: { type: 'float', data: new Array<number>(n).fill(0) },
    R: { type: 'int', value: rows },
    C: { type: 'int', value: cols },
  }
}

export const ARGS = transposeArgs({ rows: ROWS, cols: COLS })

/**
 * ★3 换的两种形状：一宽一高，组数取刚好够用，都多派 4 个线程。写死 9、32 或 288 的代码会露馅。
 * 行数、列数有公约数（6 和 10）：r = g % R、c = g % C 这种拿两个除数算的写法，在 9 × 32 上碰巧对
 * （9 和 32 互质，余数配得满每一对行、列），换到这两种形状就排不满。
 */
export const VARIANT_SHAPES = [{ rows: 6, cols: 10, block: 32 }, { rows: 10, cols: 6, block: 64 }] as const
export const VARIANTS: SandboxVariant[] = VARIANT_SHAPES.map(({ rows, cols, block }) => ({
  grid: Math.ceil((rows * cols) / block),
  block,
  args: transposeArgs({ rows, cols }),
}))

/** runs 里每一次对应的形状：runs[0] 是题目的 9 × 32，后面按 VARIANTS 的顺序（Sandbox 的约定）。 */
export const RUN_SHAPES: readonly Shape[] = [{ rows: ROWS, cols: COLS }, ...VARIANT_SHAPES]

/** a 的第 r 行第 c 列该去 b 的哪一格，b[k] 该是几（a[j] = j + 1）。 */
function expectedAt(k: number, { rows, cols }: Shape): number {
  return (k % rows) * cols + Math.floor(k / rows) + 1
}

// ── 工作单 ───────────────────────────────────────────────────────────────

/** 一份工作单的三处：r、c、写入前的条件（两种写法各一份）。 */
type Parts = Record<Lang, { r: string; c: string; guard: string }>

/** 搬的那一行是定的；判定靠它从读写的下标反推每个线程算出的 r、c（moves）。 */
function transposeCode(parts: Parts): Record<Lang, string> {
  const { hip, python } = parts
  return {
    hip: `__global__ void transpose(float* a, float* b, int R, int C) {
    int g = blockIdx.x * blockDim.x + threadIdx.x;
    int r = ${hip.r};   // a 的第几行
    int c = ${hip.c};   // a 的第几列
    if (${hip.guard}) {
        b[c * R + r] = a[r * C + c];
    }
}`,
    python: `@kernel
def transpose(a, b, R, C):
    g = blockIdx.x * blockDim.x + threadIdx.x
    r = ${python.r}    # a 的第几行
    c = ${python.c}    # a 的第几列
    if ${python.guard}:
        b[c * R + r] = a[r * C + c]`,
  }
}

/** 初始内容：r、c 都除以 R（只有方阵碰巧对），条件不拦。 */
export const CODE = transposeCode({
  hip: { r: '[[r: g / R]]', c: '[[c: g % R]]', guard: '[[guard: true]]' },
  python: { r: '[[r: g // R]]', c: '[[c: g % R]]', guard: '[[guard: True]]' },
})

export const BEST_GUARD = 'g < R * C'

/** 两种排法：顺着 a 排，第 g 个线程读 a[g]；顺着 b 排，第 g 个线程写 b[g]。只差 r、c 两行。 */
export type Order = 'a' | 'b'
export const ORDERS: readonly { value: Order; label: string }[] = [
  { value: 'a', label: '顺着 a 排' },
  { value: 'b', label: '顺着 b 排' },
]
export const ORDER_DECODE: Record<Order, Record<Lang, { r: string; c: string }>> = {
  a: { hip: { r: 'g / C', c: 'g % C' }, python: { r: 'g // C', c: 'g % C' } },
  b: { hip: { r: 'g % R', c: 'g / R' }, python: { r: 'g % R', c: 'g // R' } },
}

/** 参考解：这种排法的 r、c，条件 g < R * C。 */
export function orderCode(order: Order): Record<Lang, string> {
  const d = ORDER_DECODE[order]
  return transposeCode({ hip: { ...d.hip, guard: BEST_GUARD }, python: { ...d.python, guard: BEST_GUARD } })
}

/** 手机上的选项：r、c 各四种（除以 R 还是 C、取商还是余数），条件多了不拦、差一个、只看 r 三项。 */
export const BLANKS = {
  r: {
    label: 'a 的第几行 r',
    choices: { hip: ['g / R', 'g / C', 'g % R', 'g % C'], python: ['g // R', 'g // C', 'g % R', 'g % C'] },
  },
  c: {
    label: 'a 的第几列 c',
    choices: { hip: ['g % R', 'g % C', 'g / R', 'g / C'], python: ['g % R', 'g % C', 'g // R', 'g // C'] },
  },
  guard: {
    label: '写入前的条件',
    choices: { hip: ['true', BEST_GUARD, 'g <= R * C', 'r < R'], python: ['True', BEST_GUARD, 'g <= R * C', 'r < R'] },
  },
}

/** 启动那一行（1-2 定的写法）。 */
export function launchLine(lang: Lang): string {
  const { grid, block } = LAUNCH
  return lang === 'hip'
    ? `transpose<<<${grid}, ${block}>>>(d_a, d_b, ${ROWS}, ${COLS});`
    : `transpose[${grid}, ${block}](d_a, d_b, ${ROWS}, ${COLS})`
}

const [WIDE, TALL] = VARIANT_SHAPES

export const STAR_LABELS = [
  `b 正好是 a 的转置：${SIZE} 个数都搬到了对的位置`,
  '没有线程读写到 a、b 外面',
  `换成 ${WIDE.rows} 行 ${WIDE.cols} 列、${TALL.rows} 行 ${TALL.cols} 列的矩阵，同一份代码照样成立`,
] as const

export const HINTS: Hints = {
  direction: 'a 一行有 C 个数。第 g 个数前面有几整行？它在这一行里排第几？',
  location: `看 r、c 两行：一行有几个数，就拿 g 除以几。a 一行有 C 个数，不是 R 个。再看条件：派了 ${THREADS} 个线程，只有 R × C 个数。`,
  answer: `r 写成 g / C，c 写成 g % C（Python 风格写 g // C），条件写成 ${BEST_GUARD}。也可以顺着 b 排：r 写成 g % R，c 写成 g / R。`,
}

// ── 判定 ─────────────────────────────────────────────────────────────────

/**
 * 一个线程搬了一个数：从 a[from] 搬到 b[to]。搬的那一行是定的（b[c * R + r] = a[r * C + c]），
 * 所以 from = r × C + c、to = c × R + r，反推出这个线程算出的 r、c：r = (from × R − to) ÷ (R × C − 1)。
 */
export interface Move {
  block: number
  thread: number
  /** 全局编号 g = blockIdx.x × blockDim.x + threadIdx.x */
  g: number
  from: number
  to: number
  r: number
  c: number
}

/** 一次运行之后 b 的样子，和每个线程搬了什么。 */
export interface TransposeCheck {
  shape: Shape
  size: number
  threads: number
  values: number[]
  /** b 里不对的位置，按下标 */
  wrong: number[]
  /** ★1：程序跑完，b 的每一格都是 a 转置以后该放的数 */
  correct: boolean
  /** 按 g 排 */
  moves: Move[]
  /** 算出的 r、c 超出 a 的那几次搬运：读的不是这一格该搬的数，或者读写到了数组外面 */
  strays: Move[]
  /** 读到 a 外面、写到 b 外面的线程搬的那几次，按 g 排 */
  outside: Move[]
  /** r、c 都在 a 里的搬运，按搬到 b 的位置数：没人搬的位置、被不止一个线程搬的位置 */
  uncovered: number[]
  doubled: number[]
  /** 多派的线程（g 不小于 R × C）一个都没有搬 */
  idle: boolean
}

export function checkTranspose(run: SandboxRun, shape: Shape): TransposeCheck {
  const { launch, result } = run
  const { rows, cols } = shape
  const size = rows * cols
  const values = result.arrays.b ?? []
  // 同一步里先读 a、再写 b（一个 wave 执行搬的那一行），按 lane 配成一对
  const reads = new Map<number, Map<number, number>>()
  const moves: Move[] = []
  for (const e of result.events) {
    if (e.space !== 'global' || (e.op !== 'load' && e.op !== 'store')) continue
    const addrs = e.addrs ?? []
    const lanes: number[] = []
    for (let lane = 0; lane < e.mask.length; lane++) if (e.mask[lane] === '1') lanes.push(lane)
    if (e.op === 'load' && e.array === 'a') {
      reads.set(e.step, new Map(lanes.map((lane, k) => [lane, addrs[k]])))
      continue
    }
    if (e.op !== 'store' || e.array !== 'b') continue
    const from = reads.get(e.step)
    lanes.forEach((lane, k) => {
      const source = from?.get(lane)
      if (source === undefined) return
      const thread = e.wave * result.wave + lane
      const to = addrs[k]
      const r = (source * rows - to) / (size - 1)
      moves.push({ block: e.block, thread, g: e.block * launch.block + thread, from: source, to, r, c: source - r * cols })
    })
  }
  moves.sort((p, q) => p.g - q.g)
  const strays = moves.filter((m) => m.r < 0 || m.r >= rows || m.c < 0 || m.c >= cols)
  const counts = new Array<number>(size).fill(0)
  for (const m of moves) if (m.r >= 0 && m.r < rows && m.c >= 0 && m.c < cols) counts[m.to]++
  const wrong = values.flatMap((v, k) => (v === expectedAt(k, shape) ? [] : [k]))
  return {
    shape,
    size,
    threads: launch.grid * launch.block,
    values,
    wrong,
    correct: result.ok && values.length === size && !wrong.length,
    moves,
    strays,
    outside: moves.filter((m) => m.from < 0 || m.from >= size || m.to < 0 || m.to >= size),
    uncovered: counts.flatMap((n, k) => (n === 0 ? [k] : [])),
    doubled: counts.flatMap((n, k) => (n > 1 ? [k] : [])),
    idle: moves.every((m) => m.g < size),
  }
}

function who(m: Move): string {
  return `block ${m.block} 的 ${m.thread} 号线程（g = ${m.g}）`
}

/** 「读到了 a 外面（a[288]，模拟器里读到 0），又写进了 b[9]」：这个线程搬了什么。 */
function moveText(m: Move, size: number): string {
  const read = m.from >= 0 && m.from < size ? `读的是 a[${m.from}]` : `读到了 a 外面（a[${m.from}]，模拟器里读到 0）`
  const write = m.to >= 0 && m.to < size ? `写进了 b[${m.to}]` : `写到了 b 外面（b[${m.to}]）`
  return `${read}，又${write}`
}

/** b[k] 是 b 的第几行第几列、该放 a 的哪一个数。 */
function slotText(k: number, { rows, cols }: Shape): string {
  const row = Math.floor(k / rows)
  const col = k % rows
  return `b[${k}]（b 的第 ${row} 行第 ${col} 列）该放 a 第 ${col} 行第 ${row} 列的数 a[${col * cols + row}] = ${col * cols + row + 1}`
}

/**
 * ★1 不成立时：说清现象、原因、怎么改（03 第 4 节）。按这个顺序找原因：
 * 代码出错；有线程算出的行、列超出了 a（多派的线程没拦住，或者换算用错了除数）；
 * 行、列都在 a 里，可有的位置被搬了好几次、有的没人搬（r、c 用了不同的除数）；有的位置没人搬（条件拦多了）；都不是。
 */
function wrongText(run: SandboxRun, c: TransposeCheck): ChallengeError {
  const { result } = run
  if (!result.ok) return explainError(result.error)
  const { rows, cols } = c.shape
  const k = c.wrong[0]
  const raw = [
    `运行后 b[0]～b[3] = ${c.values.slice(0, 4).join('、')}（应该是 ${[0, 1, 2, 3].map((j) => expectedAt(j, c.shape)).join('、')}）`,
    `不对的位置：${c.wrong.length} 个`,
    `算出的行、列超出 a 的线程：${c.strays.length} 个`,
    `没人搬的位置：${c.uncovered.length} 个；被不止一个线程搬的位置：${c.doubled.length} 个`,
    `读写到 a、b 外面的线程：${c.outside.length} 个`,
  ].join('\n')
  const symptom = `b 里有 ${c.wrong.length} 个数不对：比如 ${slotText(k, c.shape)}，运行后是 ${c.values[k]}。`

  if (c.strays.length) {
    const s = c.strays[0]
    const decode = c.strays.some((m) => m.g < c.size)
    return {
      symptom,
      cause: `有的线程算出的行、列超出了 a：比如 ${who(s)}算出 r = ${s.r}、c = ${s.c}，可 a 只有 ${rows} 行 ${cols} 列（r 是 0～${rows - 1}，c 是 0～${cols - 1}）。它${moveText(s, c.size)}。`,
      fix: decode
        ? '换算行和列时，拿 g 除以「一行有几个数」：商是第几行，余数是这一行的第几个。a 一行有 C 个数，不是 R 个。'
        : '写入前的条件要拦住多派的线程：g 从 0 到 R × C − 1 正好一个线程一个数，g 不小于 R × C 的线程什么都不做。',
      raw,
    }
  }
  if (c.doubled.length && c.uncovered.length) {
    return {
      symptom,
      cause: `每个线程算出的行、列都在 a 里，可有的数被好几个线程搬、有的没人搬：比如 b[${c.doubled[0]}] 被搬了不止一次，b[${c.uncovered[0]}] 没人搬。`
        + '算出来的 r、c 配不满 a 的每一行、每一列。',
      fix: '第 g 个数的行和列，拿同一个除数去除（一行有几个数）：商是第几行，余数是这一行的第几个。',
      raw,
    }
  }
  if (c.uncovered.length) {
    return {
      symptom,
      cause: `每个线程搬的数都放对了位置，可有 ${c.uncovered.length} 个位置没有线程搬：条件把该干活的线程拦在了外面。`,
      fix: '条件只拦住 g 不小于 R × C 的线程。',
      raw,
    }
  }
  return {
    symptom,
    cause: 'b 里这一格的数不是 a 转置过来的。',
    fix: '只改 r、c 和条件三个空，搬的那一行保持原样：b[c * R + r] = a[r * C + c]。',
    raw,
  }
}

/** ★3 换形状再跑的那一次：哪里不成立，一句话；成立是 null。 */
function variantProblem(run: SandboxRun, shape: Shape): string | null {
  const c = checkTranspose(run, shape)
  const lead = `换成 ${shape.rows} 行 ${shape.cols} 列（派 ${run.launch.grid} 组、每组 ${run.launch.block} 个线程）再跑一次`
  if (!run.result.ok) return `${lead}，程序出错了：${run.result.error.message}`
  const fixed = 'r、c 和条件里有没有写死的数？一行几个数用 C，一共几行用 R。'
  if (!c.correct) {
    const error = wrongText(run, c)
    return `${lead}，b 里有 ${c.wrong.length} 个数不对。${error.cause}${c.strays.length ? fixed : error.fix}`
  }
  if (c.outside.length) {
    const m = c.outside[0]
    return `${lead}：${c.outside.length} 个线程读写到了 a、b 外面，比如 ${who(m)}${moveText(m, c.size)}。${fixed}`
  }
  return null
}

/** 读 a、写 b 各搬了几车（模拟）：整段加起来，和小队第一次读 a、第一次写 b 各几车。 */
export interface SideCars {
  read: number
  readIdeal: number
  write: number
  writeIdeal: number
  firstRead: number
  firstWrite: number
}

export function sideCars(events: readonly SimEvent[]): SideCars {
  const cars: SideCars = { read: 0, readIdeal: 0, write: 0, writeIdeal: 0, firstRead: 0, firstWrite: 0 }
  for (const access of analyzeMemory(events).accesses) {
    const e = events[access.event]
    if (e.op === 'load' && e.array === 'a') {
      cars.read += access.transactions
      cars.readIdeal += access.ideal
      cars.firstRead ||= access.transactions
    } else if (e.op === 'store' && e.array === 'b') {
      cars.write += access.transactions
      cars.writeIdeal += access.ideal
      cars.firstWrite ||= access.transactions
    }
  }
  return cars
}

/** 一句话：读 a、写 b 各搬了几车，哪一侧挨着、哪一侧跨行（模拟）。 */
export function carsText(cars: SideCars): string {
  const head = `读 a 一共搬了 ${cars.read} 车，写 b 搬了 ${cars.write} 车，理想各 ${cars.readIdeal} 车（模拟）`
  if (cars.read === cars.readIdeal && cars.write > cars.writeIdeal) {
    return `${head}：小队读 a 挨着读，每次 ${cars.firstRead} 车；写 b 要跨行，每次 ${cars.firstWrite} 车。`
  }
  if (cars.write === cars.writeIdeal && cars.read > cars.readIdeal) {
    return `${head}：小队写 b 挨着写，每次 ${cars.firstWrite} 车；读 a 要跨行，每次 ${cars.firstRead} 车。`
  }
  return `${head}。`
}

/**
 * 星级判定（06 第 7 节）：runs[0] 是 9 行 32 列、派 5 组的那一次，后面是 VARIANTS 的两种形状（RUN_SHAPES 的顺序）。
 * ★1 不成立时一颗都不发，并给出「现象 / 原因 / 怎么改」；★2 看这一次有没有读写到 a、b 外面；★3 看换了形状还成不成立。
 * 合并访存不判星：过了 ★1 以后，下一步的那句话写出读 a、写 b 各搬了几车。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main, ...others] = runs
  const c = checkTranspose(main, RUN_SHAPES[0])
  if (!c.correct) {
    const error = wrongText(main, c)
    return { earned: [false, false, false], next: error.fix, error }
  }
  const cars = carsText(sideCars(main.result.events))
  const extra = c.threads - c.size
  if (c.outside.length) {
    const m = c.outside[0]
    const offByOne = c.outside.every((o) => o.g === c.size)
    const why = offByOne
      ? '条件差了一个：g 等于 R × C 的线程也放进来了。最后一个数是第 R × C − 1 个，条件写 g < R * C。'
      : c.outside.every((o) => o.r >= 0 && o.r < ROWS)
        ? `这几个线程算出的 r 都在 0～${ROWS - 1} 里：拦它们要看 g，不能只看 r。`
        : '写入前的条件要拦住 g 不小于 R × C 的线程。'
    return {
      earned: [true, false, false],
      next: `${SIZE} 个数都搬对了。可多派的 ${extra} 个线程里，有 ${c.outside.length} 个读写到了 a、b 外面：比如 ${who(m)}算出 r = ${m.r}、c = ${m.c}，${moveText(m, c.size)}。${why}`,
    }
  }
  if (!others.length) return { earned: [true, true, false], next: `再换一种形状跑一次，才知道代码里有没有写死的数。${cars}` }
  for (let k = 0; k < others.length; k++) {
    const problem = variantProblem(others[k], RUN_SHAPES[k + 1])
    if (problem) return { earned: [true, true, false], next: `${problem}${cars}` }
  }
  return {
    earned: [true, true, true],
    next: `${SIZE} 个数都搬对了，${c.idle ? `多派的 ${extra} 个线程都被条件拦住` : `多派的 ${extra} 个线程没有读写到 a、b 外面`}；换成 ${WIDE.rows} 行 ${WIDE.cols} 列、${TALL.rows} 行 ${TALL.cols} 列也照样成立。三颗星的标准都达到了。${cars}题解里比一比两种排法。`,
  }
}

/** 结果上面那一行：b 搬对了多少（9 行 32 列那一次）。单步时只在最后一步写。 */
export function placeText(result: RunResult | null): string {
  if (!result) return ''
  if (!result.ok) return '程序没有跑完：b 停在出错那一刻的样子。'
  const shape = RUN_SHAPES[0]
  const b = result.arrays.b ?? []
  const wrong = b.flatMap((v, k) => (v === expectedAt(k, shape) ? [] : [k]))
  if (!wrong.length) return `b 的 ${b.length} 个数都搬对了：b 的第 c 行第 r 列，正好是 a 的第 r 行第 c 列。`
  const k = wrong[0]
  return `b 的 ${b.length} 个数：搬对了 ${b.length - wrong.length} 个，${wrong.length} 个不对。比如 b[${k}] 该是 ${expectedAt(k, shape)}，现在是 ${b[k]}。`
}

/** 题解里两种排法的那一句（03 第 1 节第 4 条：一句话解读）。 */
export function orderText(order: Order, cars: SideCars): string {
  if (order === 'a') {
    return `顺着 a 排：小队的 ${WAVE} 个线程读 a 的同一行，挨着读，每次 ${cars.firstRead} 车；写 b 时隔 ${ROWS} 个写一个，每次 ${cars.firstWrite} 车。`
      + `一共 ${cars.read + cars.write} 车，理想 ${cars.readIdeal + cars.writeIdeal} 车（模拟）。`
  }
  return `顺着 b 排：小队写 b 挨着写，每次 ${cars.firstWrite} 车；读 a 时要跨 ${ROWS} 行，每次 ${cars.firstRead} 车。`
    + `一共 ${cars.read + cars.write} 车，理想 ${cars.readIdeal + cars.writeIdeal} 车（模拟）。`
}
