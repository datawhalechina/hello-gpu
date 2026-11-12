/**
 * 模拟器 L2：锁步解释器（08 第 4–6 节）。
 *
 * 输入一段 HIP Lite 或 Py Lite 程序、启动配置和数据，按 wave 锁步执行，输出事件流、结束时的数组、
 * 诊断（越界读、数据竞争）和越界区。只回答「线程做了什么、数据去了哪」，不模拟耗时。
 * 同样的程序、数据、种子，一定得到同样的结果；两种写法的同一个程序，除了事件里的行号，结果完全一样。
 *
 * 执行规则：
 * - 一个 block 的线程按 threadIdx.x 顺序切成 wave（默认 32 个一组，可以换成 64）。
 *   最后一个 wave 不满时，多出来的 lane 一直空着。
 * - wave 内锁步：一条语句对所有活跃 lane 同时执行，先算完所有 lane 的值（包括读内存），再一起写。
 *   一条语句、if 或循环的一次判断、一次同步是一「步」，这一步的事件共用一个 step 编号；
 *   没有访存的语句记一个 exec 事件，判断记 branch，同步记 barrier，访存记 load / store / atomic。
 * - if：所有活跃 lane 求条件（branch），条件成立的 lane 执行 then，其余执行 else；
 *   一个 lane 都没有的那一段整段跳过，不记事件。循环每一轮判断一次，掩码逐步收缩，所有 lane 都退出才结束。
 *   && 和 ||、条件表达式只让需要的 lane 去算右边（所以 if (i < n && a[i] > 0) 不会越界读）。
 *   for 按 dir 往上或往下数（见 syntax/ast.ts）；HIP 的步长是变量、正负和条件的方向相反时，
 *   起点满足条件的线程报运行时错误（真机上这个循环不会结束），不满足的一次也不执行。
 * - 同一个 block 的 wave 按编号轮流执行：一个 wave 一直运行到同步或结束，再换下一个；
 *   所有 wave 都停在同一个同步上才一起往下走。只有部分线程到达同步时报「在分支里同步」。
 * - block 一个接一个执行，默认按编号顺序；给了随机种子就打乱顺序（block 的执行顺序本来就不确定）。
 * - 数据竞争：同一个 block 里两次同步之间，不同线程对同一个元素「写-写」或「读-写」，记一条诊断；
 *   不同 block 对同一个全局元素的冲突也记（block 之间没有同步）。原子加之间不算冲突，
 *   原子加和普通读写算。一个元素在同一段里只记第一次冲突。
 * - 越界读得到 0，记一条 oob-read 诊断；越界写不改数组，记进「越界区」。
 * - 数值：整数是 32 位有符号整数，超出范围报运行时错误；小数按 JS 的双精度计算，不模拟 float 的舍入。
 *   除以 0、对 0 取余报运行时错误。// 和 % 遇到负数时按写法取整（HIP 向 0 截断，Python 向下取整），
 *   和 L1 的 expr.ts 一致。写数组元素时按元素类型转换（小数存进整数数组向 0 截断）。
 * - 上限：默认最多 200,000 步、1024 个线程（调用时可以改），超出时报「超出限制」并停下。
 *
 * 出错时也返回出错之前的事件、数组和诊断，方便界面演示「运行到哪一步出的错」。
 */
import type {
  BinaryExpr,
  CondExpr,
  ElemType,
  Expr,
  IndexExpr,
  Kernel,
  Lang,
  Loc,
  ParamSig,
  ScalarType,
  Stmt,
  UnaryExpr,
} from './syntax/ast.ts'
import { fail, SimFailure, type SimError } from './syntax/errors.ts'
import { parse } from './syntax/index.ts'

// ── 对外的类型 ─────────────────────────────────────────────────────────

export type WaveSize = 32 | 64
export type SimOp = 'exec' | 'branch' | 'load' | 'store' | 'barrier' | 'atomic'
export type MemSpace = 'global' | 'lds'

/** 08 第 5 节的事件。array 是补充的字段：访存事件访问的是哪个数组（参数名或共享数组名）。 */
export interface SimEvent {
  step: number
  /** blockIdx.x */
  block: number
  /** block 里的第几个 wave */
  wave: number
  line: number
  op: SimOp
  /** 这一步参与的 lane：'1' 活跃，'0' 空转；长度 = wave 大小，第一个字符是 lane 0 */
  mask: string
  space?: MemSpace
  array?: string
  /** 每个活跃 lane 访问的元素下标，按 lane 顺序；越界的下标照样记 */
  addrs?: number[]
}

/** 数组参数：int 或 float 的元素。 */
export interface ArrayArg {
  type: ElemType
  data: ArrayLike<number>
}
/** 标量参数。 */
export interface ScalarArg {
  type: ScalarType
  value: number | boolean
}
export type Arg = ArrayArg | ScalarArg

export interface RunRequest {
  source: string
  lang: Lang
  /** gridDim.x：多少个 block */
  grid: number
  /** blockDim.x：每个 block 多少个线程 */
  block: number
  /** 按参数名给数据。HIP 写法核对声明的类型；Python 风格的参数类型由这里的 type 决定 */
  args: Record<string, Arg>
  /** wave 大小，默认 32 */
  wave?: WaveSize
  /** 给了就用它打乱 block 的执行顺序；不给按编号顺序 */
  seed?: number | null
  /** 最多多少步，默认 RUN_LIMITS.steps */
  maxSteps?: number
  /** 最多多少个线程，默认 RUN_LIMITS.threads */
  maxThreads?: number
}

/** 一次访问：哪个线程、在哪一行、第几步。 */
export interface Access {
  block: number
  thread: number
  line: number
  step: number
  op: 'read' | 'write' | 'atomic'
}

export interface OobRead {
  kind: 'oob-read'
  space: MemSpace
  array: string
  index: number
  /** 数组长度 */
  length: number
  block: number
  thread: number
  line: number
  step: number
}

export interface Race {
  kind: 'race'
  /** block：同一个 block 里两次同步之间；grid：不同 block 之间 */
  scope: 'block' | 'grid'
  /** 两次访问里有一次是普通的读就是读-写，否则是写-写（原子加算写） */
  conflict: 'write-write' | 'read-write'
  space: MemSpace
  array: string
  index: number
  /** 先发生的访问 */
  first: Access
  /** 后发生、和它冲突的访问 */
  second: Access
}

export type Diagnostic = OobRead | Race

export interface OutsideWrite {
  block: number
  thread: number
  line: number
  step: number
  op: 'store' | 'atomic'
  /** 想写进去的值（原子加是要加的数） */
  value: number
}

/** 越界区的一格：一个数组外面的位置，以及想写到这里的线程。 */
export interface OutsideEntry {
  space: MemSpace
  array: string
  /** 共享数组每个 block 一份，记是哪个 block 的；全局数组是 null */
  block: number | null
  index: number
  writes: OutsideWrite[]
}

export interface RunOutput {
  events: SimEvent[]
  /** 每个数组参数结束时的内容；出错时是出错那一刻的内容 */
  arrays: Record<string, number[]>
  /** 越界区，按数组名、block、下标排序 */
  outside: OutsideEntry[]
  /** 越界读和数据竞争，按发生的顺序 */
  diagnostics: Diagnostic[]
  /** 诊断和越界区各最多记 RUN_LIMITS.records 条，多出来的条数 */
  dropped: number
  /** 实际执行的 block 顺序 */
  blockOrder: number[]
  /** 一共执行了多少步 */
  steps: number
  wave: WaveSize
}

export type RunResult = (RunOutput & { ok: true; error: null }) | (RunOutput & { ok: false; error: SimError })

/** 运行时的上限：不是硬件参数，是模拟器为了不卡住页面定的（08 第 4 节）。 */
export const RUN_LIMITS = {
  /** 一次运行最多多少步：一个 wave 执行一条语句、一次判断或一次同步算一步 */
  steps: 200_000,
  /** 一次启动最多多少个线程（gridDim.x × blockDim.x）：可视化场景的上限 */
  threads: 1024,
  /** 诊断、越界区各最多记多少条 */
  records: 1000,
} as const

// ── 入口 ───────────────────────────────────────────────────────────────

/** 同步运行一次。测试直接调用它；页面通过 client.ts 在 Web Worker 里调用。 */
export function run(req: RunRequest): RunResult {
  const wave = req.wave ?? 32
  if (wave !== 32 && wave !== 64) throw new RangeError(`wave 大小只能是 32 或 64，收到的是 ${String(wave)}。`)
  const seed = req.seed ?? null
  if (seed !== null && !Number.isInteger(seed)) throw new RangeError(`随机种子要是整数，收到的是 ${String(seed)}。`)
  const m = new Machine(wave, req.lang, req.maxSteps ?? RUN_LIMITS.steps)
  let globals: ArrayRef[] | null = null
  let order: number[] = []
  try {
    const parsed = parse(req.source, req.lang)
    if (!parsed.ok) throw new SimFailure(parsed.error)
    checkLaunch(parsed.kernel, req.grid, req.block, req.maxThreads ?? RUN_LIMITS.threads)
    const bound = bind(parsed.kernel, parsed.signature, req.args)
    let kernel = parsed.kernel
    if (req.lang === 'python') {
      // 知道了参数类型，再检查一遍：参数相关的类型错误在这里报，需要的转换也补上
      const typed = parse(req.source, 'python', bound.types)
      if (!typed.ok) throw new SimFailure(typed.error)
      kernel = typed.kernel
    }
    const program = compile(kernel, m, bound, req.grid, req.block)
    globals = program.globals
    order = seed === null ? Array.from({ length: req.grid }, (_, i) => i) : shuffle(req.grid, seed)
    execute(m, program, order, req.block)
    return { ok: true, error: null, ...m.output(globals, order, req.args) }
  } catch (err) {
    if (!(err instanceof SimFailure)) throw err
    return { ok: false, error: err.error, ...m.output(globals, order, req.args) }
  }
}

// ── 启动配置和参数 ─────────────────────────────────────────────────────

const INT_MIN = -2_147_483_648
const INT_MAX = 2_147_483_647

function checkLaunch(kernel: Kernel, grid: number, block: number, maxThreads: number) {
  for (const [name, value] of [['gridDim.x', grid], ['blockDim.x', block]] as const) {
    if (!Number.isInteger(value) || value < 1) {
      fail('runtime', kernel.loc, `${name} 要是正整数，现在是 ${String(value)}。`, `把 ${name} 改成 1 或更大的整数。`)
    }
  }
  if (grid * block > maxThreads) {
    fail(
      'limit',
      kernel.loc,
      `这次启动了 ${grid * block} 个线程（gridDim.x = ${grid}，blockDim.x = ${block}），超过了模拟器的上限 ${maxThreads} 个。`,
      '把 gridDim.x 或 blockDim.x 改小一些。',
    )
  }
}

interface Bound {
  /** 每个参数的类型：HIP 照抄声明，Python 风格由数据决定 */
  types: ParamSig[]
  scalars: Map<string, { type: ScalarType; value: number }>
  arrays: Map<string, { elem: ElemType; data: Float64Array }>
}

const TYPE_NAME: Record<ScalarType, string> = { int: '整数', float: '小数', bool: '真假值' }

/** 核对参数和数据：名字对得上，数组和数分清，HIP 声明的数组类型和数据一致；数据本身也要合法。 */
function bind(kernel: Kernel, declared: ParamSig[] | null, args: Record<string, Arg>): Bound {
  const usage = declared ? null : paramUsage(kernel)
  const provided = Object.keys(args)
  const bound: Bound = { types: [], scalars: new Map(), arrays: new Map() }
  kernel.params.forEach((p, i) => {
    const arg = Object.hasOwn(args, p.name) ? args[p.name] : undefined
    if (!arg || typeof arg !== 'object') {
      fail(
        'type',
        p.loc,
        `参数「${p.name}」没有对应的数据。${provided.length ? `这次运行提供的是 ${provided.join('、')}。` : '这次运行没有提供数据。'}`,
        '参数名要和提供的数据对上。',
      )
    }
    const isArray = 'data' in arg
    const sig = declared ? declared[i] : null
    if (sig) {
      const decl = sig.array ? `${sig.type}* ${p.name}` : `${sig.type} ${p.name}`
      if (sig.array && !isArray) fail('type', p.loc, `参数「${p.name}」声明成了数组（${decl}），传进来的却是一个数。`, `改成 ${sig.type} ${p.name}。`)
      if (!sig.array && isArray) fail('type', p.loc, `参数「${p.name}」声明成了一个数（${decl}），传进来的却是数组。`, `改成 ${arg.type}* ${p.name}。`)
      if (sig.array && arg.type !== sig.type) {
        fail('type', p.loc, `参数「${p.name}」声明成 ${sig.type}*，传进来的却是${TYPE_NAME[arg.type] ?? arg.type}数组。`, `改成 ${arg.type}* ${p.name}。`)
      }
    } else {
      const use = usage?.get(p.name)
      if (use === 'array' && !isArray) fail('type', p.loc, `「${p.name}」在 kernel 里当数组用（${p.name}[…]），传进来的却是一个数。`, '检查参数名有没有写错。')
      if (use === 'scalar' && isArray) fail('type', p.loc, `「${p.name}」在 kernel 里当一个数用，传进来的却是数组。`, `要用其中一个元素，写成 ${p.name}[i]。`)
    }
    if (isArray) {
      if (arg.type !== 'int' && arg.type !== 'float') fail('type', p.loc, `传给「${p.name}」的数组类型「${String(arg.type)}」不认识。`, '数组只能是 int 或 float。')
      bound.arrays.set(p.name, { elem: arg.type, data: arrayData(p.name, p.loc, arg) })
      bound.types.push({ name: p.name, array: true, type: arg.type })
    } else {
      const type = sig ? sig.type : arg.type
      if (type !== 'int' && type !== 'float' && type !== 'bool') fail('type', p.loc, `传给「${p.name}」的数据类型「${String(type)}」不认识。`, '只能是 int、float 或 bool。')
      bound.scalars.set(p.name, { type, value: scalarValue(p.name, p.loc, arg, type, sig !== null) })
      bound.types.push({ name: p.name, array: false, type })
    }
  })
  return bound
}

/** Python 风格的参数没有声明，看 kernel 里怎么用：a[i] 是数组，单独出现是数。检查器保证不会两种都有。 */
function paramUsage(kernel: Kernel): Map<string, 'array' | 'scalar'> {
  const params = new Set(kernel.params.map((p) => p.name))
  const use = new Map<string, 'array' | 'scalar'>()
  const mark = (name: string, how: 'array' | 'scalar') => {
    if (params.has(name)) use.set(name, how)
  }
  const expr = (e: Expr): void => {
    switch (e.kind) {
      case 'name':
        mark(e.name, 'scalar')
        break
      case 'index':
        mark(e.array, 'array')
        expr(e.index)
        break
      case 'unary':
      case 'cast':
        expr(e.arg)
        break
      case 'binary':
        expr(e.left)
        expr(e.right)
        break
      case 'cond':
        expr(e.test)
        expr(e.body)
        expr(e.orelse)
        break
    }
  }
  const stmts = (list: Stmt[]): void => {
    for (const s of list) {
      switch (s.kind) {
        case 'let':
          expr(s.init)
          break
        case 'assign':
          expr(s.target)
          expr(s.value)
          break
        case 'if':
          expr(s.test)
          stmts(s.body)
          stmts(s.orelse)
          break
        case 'for':
          expr(s.start)
          expr(s.stop)
          expr(s.step)
          stmts(s.body)
          break
        case 'while':
          expr(s.test)
          stmts(s.body)
          break
        case 'atomic':
          mark(s.array, 'array')
          expr(s.index)
          expr(s.value)
          break
      }
    }
  }
  stmts(kernel.body)
  return use
}

function arrayData(name: string, at: Loc, arg: ArrayArg): Float64Array {
  const src = arg.data
  if (!src || typeof src !== 'object' || typeof src.length !== 'number') fail('type', at, `传给「${name}」的 data 不是数组。`, '数组参数写成 { type, data: [...] }。')
  const out = new Float64Array(src.length)
  for (let i = 0; i < src.length; i++) {
    const v = src[i]
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('type', at, `传给「${name}」的第 ${i} 个元素不是有限的数（${String(v)}）。`, '数组里只能放有限的数。')
    if (arg.type === 'int' && (!Number.isInteger(v) || v < INT_MIN || v > INT_MAX)) {
      fail('type', at, `传给「${name}」的整数数组里，第 ${i} 个元素 ${v} 不是 32 位整数。`, '整数数组里只能放 -2147483648 到 2147483647 之间的整数。')
    }
    out[i] = v + 0
  }
  return out
}

/** 标量参数的值。HIP 按声明的类型转换（和 C++ 传参一样）；Python 风格要求数据本身合法。 */
function scalarValue(name: string, at: Loc, arg: ScalarArg, type: ScalarType, declared: boolean): number {
  const raw = arg.value
  const v = typeof raw === 'boolean' ? Number(raw) : raw
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('type', at, `传给「${name}」的值不是有限的数（${String(raw)}）。`, '标量参数写成 { type, value }。')
  if (type === 'bool') return v !== 0 ? 1 : 0
  if (type === 'float') return v + 0
  const t = declared ? Math.trunc(v) : v
  if (!Number.isInteger(t) || t < INT_MIN || t > INT_MAX) fail('type', at, `传给「${name}」的值 ${v} 不是 32 位整数。`, '整数参数只能是 -2147483648 到 2147483647 之间的整数。')
  return t + 0
}

/** 用种子打乱 block 顺序（mulberry32 + Fisher-Yates），同一个种子永远得到同一个顺序。 */
function shuffle(n: number, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  let s = seed >>> 0
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = order[i]
    order[i] = order[j]
    order[j] = tmp
  }
  return order
}

// ── 访问记录：判断数据竞争 ─────────────────────────────────────────────

const READ = 0
const WRITE = 1
const ATOMIC = 2

/**
 * 每个元素记最近一段（两次同步之间）里的访问：写、读、原子加三类，每类记两个不同的访问者，
 * 这样就能回答「有没有别的线程（或 block）这样访问过」。按 1024 个元素一页，用到才分配。
 *
 * 每个元素 26 个整数：[0] 这些记录属于哪一段，[1] 这一段报过冲突没有；之后 6 条记录，
 * 每条 4 个整数：block、thread、line、step（block 是 -1 表示空）。
 */
const PAGE_BITS = 10
const PAGE = 1 << PAGE_BITS
const STRIDE = 26
const W1 = 2
const R1 = 10
const A1 = 18

class AccessTable {
  /** true：按 block 区分访问者（block 之间的冲突）；false：按线程区分（block 内的冲突） */
  readonly byBlock: boolean
  private readonly pages: Array<Int32Array | undefined> = []
  /** 最近一次 touch 的那一页 */
  page: Int32Array = new Int32Array(0)

  constructor(byBlock: boolean) {
    this.byBlock = byBlock
  }

  /** 找到元素 index 的记录，返回它在 this.page 里的位置；记录属于更早的段时先清空。 */
  touch(index: number, epoch: number): number {
    const p = index >>> PAGE_BITS
    let page = this.pages[p]
    if (!page) {
      page = new Int32Array(PAGE * STRIDE)
      this.pages[p] = page
    }
    this.page = page
    const o = (index & (PAGE - 1)) * STRIDE
    if (page[o] !== epoch) {
      page[o] = epoch
      page[o + 1] = 0
      for (let r = W1; r < STRIDE; r += 4) page[o + r] = -1
    }
    return o
  }
}

/** 一类访问里有没有和 id 不同的访问者：有就返回那条记录的位置，没有返回 -1。 */
function otherThan(p: Int32Array, r1: number, id: number, idAt: number): number {
  if (p[r1] === -1) return -1
  if (p[r1 + idAt] !== id) return r1
  return p[r1 + 4] === -1 ? -1 : r1 + 4
}

// ── 机器状态 ───────────────────────────────────────────────────────────

type Vec = Float64Array
type Lanes = Int32Array

interface Wave {
  /** block 里的第几个 wave */
  index: number
  /** lane 0 的 threadIdx.x */
  base: number
  /** 有线程的 lane：0 … count - 1 */
  alive: Lanes
  count: number
  /** 每个变量一行，每个 lane 一格 */
  regs: Vec[]
  /** 每个 lane 的 threadIdx.x */
  tid: Vec
}

interface ArrayRef {
  name: string
  space: MemSpace
  elem: ElemType
  data: Float64Array
  /** 同一个 block 里、两次同步之间的访问 */
  local: AccessTable
  /** 不同 block 之间的访问；共享数组每个 block 一份，没有这一项 */
  cross: AccessTable | null
}

const SYNC_HINT = '同步要等同一个 block 的所有线程，只能写在所有线程都会走到的地方：把它移到 if 外面；在循环里时，让每个线程的循环次数一样。'

class Machine {
  readonly W: WaveSize
  readonly lang: Lang
  readonly maxSteps: number
  readonly events: SimEvent[] = []
  readonly diagnostics: Diagnostic[] = []
  private readonly outside = new Map<string, OutsideEntry>()
  private outsideCount = 0
  private dropped = 0
  steps = 0
  /** 当前这一步的编号、行号；quiet 表示这一步还没有记事件（没有访存的语句要补一个 exec） */
  step = -1
  line = 0
  quiet = true
  /** 当前 block 的 blockIdx.x，以及每个 lane 都是它的向量 */
  block = 0
  readonly blockVec: Vec
  /** 同一个 block 里两次同步之间是一段；每到一个新 block、每过一次同步加一 */
  epoch = 0
  private readonly maskBuf: Uint8Array
  private readonly decoder = new TextDecoder()
  /** 报错时用这种写法的同步名字 */
  private readonly syncName: string

  constructor(W: WaveSize, lang: Lang, maxSteps: number) {
    this.W = W
    this.lang = lang
    this.maxSteps = maxSteps
    this.blockVec = new Float64Array(W)
    this.maskBuf = new Uint8Array(W).fill(48)
    this.syncName = lang === 'hip' ? '__syncthreads()' : 'syncthreads()'
  }

  /** 开始新的一步。 */
  begin(s: CStmt) {
    if (this.steps >= this.maxSteps) {
      fail('limit', s.loc, `已经运行了 ${this.maxSteps} 步还没结束，超过了模拟器的上限。`, '多半是有循环停不下来，检查循环条件会不会变成假；数据或线程很多时，也可以改小一些。')
    }
    this.step = this.steps++
    this.line = s.line
    this.quiet = true
  }

  emit(w: Wave, op: SimOp, lanes: Lanes, n: number, ref?: ArrayRef, addrs?: number[]) {
    this.quiet = false
    const e: SimEvent = { step: this.step, block: this.block, wave: w.index, line: this.line, op, mask: this.mask(lanes, n) }
    if (ref) {
      e.space = ref.space
      e.array = ref.name
      e.addrs = addrs
    }
    this.events.push(e)
  }

  private mask(lanes: Lanes, n: number): string {
    const buf = this.maskBuf
    for (let k = 0; k < n; k++) buf[lanes[k]] = 49
    const s = this.decoder.decode(buf)
    for (let k = 0; k < n; k++) buf[lanes[k]] = 48
    return s
  }

  startBlock(b: number) {
    this.block = b
    this.blockVec.fill(b)
    this.epoch++
  }

  /** 所有 wave 都停在同步上了：确认停的是同一个同步，然后开始新的一段。 */
  release(waves: Wave[], waiting: Array<SyncPoint | null>) {
    const first = waiting.find((s) => s !== null)!
    const threads = (pick: (s: SyncPoint | null) => boolean) => describeThreads(waves.filter((_, i) => pick(waiting[i])))
    const absent = waiting.indexOf(null) >= 0
    const other = waiting.find((s) => s !== null && s !== first)
    if (absent) {
      fail('runtime', first.loc, `在分支里同步：第 ${first.line} 行的 ${this.syncName} 只有线程 ${threads((s) => s === first)} 到达，线程 ${threads((s) => s === null)} 没有经过这里就运行完了。`, SYNC_HINT)
    }
    if (other) {
      fail(
        'runtime',
        first.loc,
        `在分支里同步：线程 ${threads((s) => s === first)} 停在第 ${first.line} 行的同步，线程 ${threads((s) => s === other)} 停在第 ${other.line} 行的同步，等的不是同一个同步。`,
        SYNC_HINT,
      )
    }
    this.epoch++
  }

  /** wave 里只有部分 lane 走到了同步。 */
  partialSync(s: SyncPoint, w: Wave, lanes: Lanes, n: number) {
    const here = new Set<number>()
    for (let k = 0; k < n; k++) here.add(lanes[k])
    const at: number[] = []
    const away: number[] = []
    for (let l = 0; l < w.count; l++) (here.has(l) ? at : away).push(w.base + l)
    fail(
      'runtime',
      s.loc,
      `在分支里同步：第 ${s.line} 行的 ${this.syncName} 只有线程 ${ranges(at)} 到达，同一个 wave 的线程 ${ranges(away)} 走了另一条路。`,
      SYNC_HINT,
    )
  }

  // ── 访存 ──

  access(ref: ArrayRef, i: number, op: number, w: Wave, l: number) {
    this.check(ref.local, ref, i, op, w, l, this.epoch, 'block')
    if (ref.cross) this.check(ref.cross, ref, i, op, w, l, 1, 'grid')
  }

  private check(t: AccessTable, ref: ArrayRef, i: number, op: number, w: Wave, l: number, epoch: number, scope: 'block' | 'grid') {
    const o = t.touch(i, epoch)
    const p = t.page
    const thread = w.base + l
    const idAt = t.byBlock ? 0 : 1
    const id = t.byBlock ? this.block : thread
    // 读和写、原子加冲突；写和所有访问冲突；原子加和读、写冲突，原子加之间不冲突
    let hit = otherThan(p, o + W1, id, idAt)
    if (hit < 0 && op !== ATOMIC) hit = otherThan(p, o + A1, id, idAt)
    if (hit < 0 && op !== READ) hit = otherThan(p, o + R1, id, idAt)
    if (hit >= 0 && p[o + 1] !== epoch) {
      p[o + 1] = epoch
      const rel = hit - o
      const firstOp: Access['op'] = rel < R1 ? 'write' : rel < A1 ? 'read' : 'atomic'
      const secondOp: Access['op'] = op === READ ? 'read' : op === WRITE ? 'write' : 'atomic'
      this.record({
        kind: 'race',
        scope,
        conflict: firstOp === 'read' || secondOp === 'read' ? 'read-write' : 'write-write',
        space: ref.space,
        array: ref.name,
        index: i,
        first: { block: p[hit], thread: p[hit + 1], line: p[hit + 2], step: p[hit + 3], op: firstOp },
        second: { block: this.block, thread, line: this.line, step: this.step, op: secondOp },
      })
    }
    const r1 = o + (op === READ ? R1 : op === WRITE ? W1 : A1)
    const r = p[r1] === -1 ? r1 : p[r1 + 4] === -1 && p[r1 + idAt] !== id ? r1 + 4 : -1
    if (r >= 0) {
      p[r] = this.block
      p[r + 1] = thread
      p[r + 2] = this.line
      p[r + 3] = this.step
    }
  }

  oobRead(ref: ArrayRef, i: number, w: Wave, l: number) {
    this.record({
      kind: 'oob-read',
      space: ref.space,
      array: ref.name,
      index: i,
      length: ref.data.length,
      block: this.block,
      thread: w.base + l,
      line: this.line,
      step: this.step,
    })
  }

  outsideWrite(ref: ArrayRef, i: number, w: Wave, l: number, op: 'store' | 'atomic', value: number) {
    if (this.outsideCount >= RUN_LIMITS.records) {
      this.dropped++
      return
    }
    this.outsideCount++
    const block = ref.space === 'lds' ? this.block : null
    const key = `${ref.name} ${block} ${i}`
    let entry = this.outside.get(key)
    if (!entry) {
      entry = { space: ref.space, array: ref.name, block, index: i, writes: [] }
      this.outside.set(key, entry)
    }
    entry.writes.push({ block: this.block, thread: w.base + l, line: this.line, step: this.step, op, value })
  }

  private record(d: Diagnostic) {
    if (this.diagnostics.length < RUN_LIMITS.records) this.diagnostics.push(d)
    else this.dropped++
  }

  // ── 运行时错误 ──

  who(w: Wave, l: number) {
    return `线程（blockIdx.x = ${this.block}，threadIdx.x = ${w.base + l}）`
  }

  divideByZero(at: Loc, w: Wave, l: number, op: string): never {
    const what = op === '%' ? '对 0 取余数' : '除以 0'
    fail('runtime', at, `${this.who(w, l)}在这里${what}。`, '先用 if 确认除数不是 0，或者换一个除数。')
  }

  /** 32 位整数：超出范围报错，顺便把 -0 变成 0。 */
  int(v: number, at: Loc, w: Wave, l: number): number {
    if (v > INT_MAX || v < INT_MIN) {
      fail('runtime', at, `${this.who(w, l)}在这里算出 ${v}，超出了 32 位整数的范围（${INT_MIN} 到 ${INT_MAX}）。`, '检查这里的运算；要存很大的数，改用小数。')
    }
    return v + 0
  }

  /** 小数转整数：向 0 截断。 */
  toInt(v: number, at: Loc, w: Wave, l: number): number {
    if (!Number.isFinite(v)) fail('runtime', at, `${this.who(w, l)}要把 ${v} 转成整数，可它不是一个有限的数。`, '检查前面的运算。')
    return this.int(Math.trunc(v), at, w, l)
  }

  output(globals: ArrayRef[] | null, order: number[], args: Record<string, Arg>): RunOutput {
    const arrays: Record<string, number[]> = {}
    if (globals) {
      for (const ref of globals) arrays[ref.name] = Array.from(ref.data)
    } else {
      // 还没开始运行就出错：数组保持传进来的样子
      for (const [name, arg] of Object.entries(args)) {
        if (arg && typeof arg === 'object' && 'data' in arg && arg.data && typeof arg.data.length === 'number') arrays[name] = Array.from(arg.data)
      }
    }
    const outside = [...this.outside.values()].sort(
      (a, b) => (a.array < b.array ? -1 : a.array > b.array ? 1 : 0) || (a.block ?? -1) - (b.block ?? -1) || a.index - b.index,
    )
    return { events: this.events, arrays, outside, diagnostics: this.diagnostics, dropped: this.dropped, blockOrder: order, steps: this.steps, wave: this.W }
  }
}

/** 把一组线程号写成「0–15、17、20–31」。 */
function ranges(threads: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < threads.length; ) {
    let j = i
    while (j + 1 < threads.length && threads[j + 1] === threads[j] + 1) j++
    parts.push(j === i ? `${threads[i]}` : `${threads[i]}–${threads[j]}`)
    i = j + 1
  }
  return parts.join('、')
}

function describeThreads(waves: Wave[]): string {
  const threads: number[] = []
  for (const w of waves) for (let l = 0; l < w.count; l++) threads.push(w.base + l)
  return ranges(threads)
}

// ── 编译：语法树 → 按 wave 求值的闭包 ──────────────────────────────────

/** 对 lanes[0 … n) 这些 lane 求值，结果放在返回数组的对应 lane 上（其他位置不管）。 */
type Eval = (w: Wave, lanes: Lanes, n: number) => Vec

interface CExpr {
  type: ScalarType
  ev: Eval
}

interface StmtBase {
  line: number
  loc: Loc
}

type CStmt =
  | (StmtBase & { kind: 'set'; slot: number; value: CExpr })
  | (StmtBase & { kind: 'store' | 'atomic'; ref: ArrayRef; index: CExpr; value: CExpr })
  | (StmtBase & { kind: 'if'; test: CExpr; body: CStmt[]; orelse: CStmt[] })
  | (StmtBase & { kind: 'for'; slot: number; name: string; start: CExpr; stop: CExpr; step: CExpr; dir: 1 | -1 | 0; body: CStmt[] })
  | (StmtBase & { kind: 'while'; test: CExpr; body: CStmt[] })
  | (StmtBase & { kind: 'sync' })

type SyncPoint = Extract<CStmt, { kind: 'sync' }>

interface Program {
  body: CStmt[]
  /** 变量个数（每个 wave 的寄存器行数） */
  slots: number
  /** 标量参数：放在哪个变量里、初值 */
  inits: Array<{ slot: number; value: number }>
  globals: ArrayRef[]
  shared: ArrayRef[]
}

/**
 * 把（已经检查过类型的）语法树编译成闭包。每个表达式节点有自己的结果数组，
 * 一条语句求值时每个节点最多算一次，所以可以重复使用；跨过同步还要用的值（循环的终点、步长）另外复制。
 */
function compile(kernel: Kernel, m: Machine, bound: Bound, grid: number, blockDim: number): Program {
  const W = m.W
  const locals = new Map<string, { slot: number; type: ScalarType }>()
  const arrays = new Map<string, ArrayRef>()
  const globals: ArrayRef[] = []
  const shared: ArrayRef[] = []
  const inits: Program['inits'] = []
  let slots = 0
  const newSlot = (name: string, type: ScalarType) => {
    const slot = slots++
    locals.set(name, { slot, type })
    return slot
  }

  for (const p of kernel.params) {
    const a = bound.arrays.get(p.name)
    if (a) {
      const ref: ArrayRef = { name: p.name, space: 'global', elem: a.elem, data: a.data, local: new AccessTable(false), cross: new AccessTable(true) }
      arrays.set(p.name, ref)
      globals.push(ref)
    } else {
      // 标量参数也是每个线程自己的变量：可以改，改了不影响别的线程
      const s = bound.scalars.get(p.name)!
      inits.push({ slot: newSlot(p.name, s.type), value: s.value })
    }
  }

  const constant = (value: number, type: ScalarType): CExpr => {
    const v = new Float64Array(W).fill(value)
    return { type, ev: () => v }
  }

  const map1 = (a: CExpr, type: ScalarType, f: (x: number, w: Wave, l: number) => number): CExpr => {
    const out = new Float64Array(W)
    return {
      type,
      ev: (w, lanes, n) => {
        const x = a.ev(w, lanes, n)
        for (let k = 0; k < n; k++) {
          const l = lanes[k]
          out[l] = f(x[l], w, l)
        }
        return out
      },
    }
  }

  const map2 = (a: CExpr, b: CExpr, type: ScalarType, f: (x: number, y: number, w: Wave, l: number) => number): CExpr => {
    const out = new Float64Array(W)
    return {
      type,
      ev: (w, lanes, n) => {
        const x = a.ev(w, lanes, n)
        const y = b.ev(w, lanes, n)
        for (let k = 0; k < n; k++) {
          const l = lanes[k]
          out[l] = f(x[l], y[l], w, l)
        }
        return out
      },
    }
  }

  /** 转换成 to 类型：整数、真假值变小数，真假值变整数，数值不用变；小数变整数向 0 截断。 */
  const convert = (a: CExpr, to: ScalarType, at: Loc): CExpr => {
    if (a.type === to) return a
    if (to === 'float' || (to === 'int' && a.type === 'bool')) return { type: to, ev: a.ev }
    if (to === 'bool') return map1(a, 'bool', (x) => (x !== 0 ? 1 : 0))
    return map1(a, 'int', (x, w, l) => m.toInt(x, at, w, l))
  }

  const load = (e: IndexExpr): CExpr => {
    const ref = arrays.get(e.array)!
    const index = expr(e.index)
    const out = new Float64Array(W)
    return {
      type: ref.elem,
      ev: (w, lanes, n) => {
        const iv = index.ev(w, lanes, n)
        const data = ref.data
        const addrs: number[] = new Array(n)
        for (let k = 0; k < n; k++) {
          const l = lanes[k]
          const i = iv[l]
          addrs[k] = i
          if (i >= 0 && i < data.length) {
            m.access(ref, i, READ, w, l)
            out[l] = data[i]
          } else {
            m.oobRead(ref, i, w, l)
            out[l] = 0
          }
        }
        m.emit(w, 'load', lanes, n, ref, addrs)
        return out
      },
    }
  }

  const unary = (e: UnaryExpr): CExpr => {
    const a = expr(e.arg)
    if (e.op === 'not') return map1(a, 'bool', (x) => (x === 0 ? 1 : 0))
    if (a.type === 'float') return map1(a, 'float', (x) => -x)
    return map1(a, 'int', (x, w, l) => m.int(0 - x, e.loc, w, l))
  }

  /** && 和 ||：左边已经决定结果的 lane 不算右边（右边里的读内存只对需要的 lane 发生）。 */
  const logic = (a: CExpr, b: CExpr, isAnd: boolean): CExpr => {
    const out = new Float64Array(W)
    const rest = new Int32Array(W)
    return {
      type: 'bool',
      ev: (w, lanes, n) => {
        const x = a.ev(w, lanes, n)
        let r = 0
        for (let k = 0; k < n; k++) {
          const l = lanes[k]
          if ((x[l] !== 0) === isAnd) rest[r++] = l
          else out[l] = isAnd ? 0 : 1
        }
        if (r > 0) {
          const y = b.ev(w, rest, r)
          for (let k = 0; k < r; k++) {
            const l = rest[k]
            out[l] = y[l] !== 0 ? 1 : 0
          }
        }
        return out
      },
    }
  }

  const binary = (e: BinaryExpr): CExpr => {
    const a = expr(e.left)
    const b = expr(e.right)
    const at = e.loc
    const hip = m.lang === 'hip'
    switch (e.op) {
      case 'and':
        return logic(a, b, true)
      case 'or':
        return logic(a, b, false)
      case '<':
        return map2(a, b, 'bool', (x, y) => (x < y ? 1 : 0))
      case '<=':
        return map2(a, b, 'bool', (x, y) => (x <= y ? 1 : 0))
      case '>':
        return map2(a, b, 'bool', (x, y) => (x > y ? 1 : 0))
      case '>=':
        return map2(a, b, 'bool', (x, y) => (x >= y ? 1 : 0))
      case '==':
        return map2(a, b, 'bool', (x, y) => (x === y ? 1 : 0))
      case '!=':
        return map2(a, b, 'bool', (x, y) => (x !== y ? 1 : 0))
      case '/':
        return map2(a, b, 'float', (x, y, w, l) => {
          if (y === 0) m.divideByZero(at, w, l, '/')
          return x / y
        })
    }
    const type: ScalarType = a.type === 'float' || b.type === 'float' ? 'float' : 'int'
    const float = type === 'float'
    switch (e.op) {
      case '+':
        return float ? map2(a, b, type, (x, y) => x + y) : map2(a, b, type, (x, y, w, l) => m.int(x + y, at, w, l))
      case '-':
        return float ? map2(a, b, type, (x, y) => x - y) : map2(a, b, type, (x, y, w, l) => m.int(x - y, at, w, l))
      case '*':
        return float ? map2(a, b, type, (x, y) => x * y) : map2(a, b, type, (x, y, w, l) => m.int(x * y, at, w, l))
      case '//':
        // 整数：HIP 向 0 截断，Python 向下取整；小数（只有 Python 风格）向下取整
        return map2(a, b, type, (x, y, w, l) => {
          if (y === 0) m.divideByZero(at, w, l, '//')
          if (float) return Math.floor(x / y)
          return m.int(hip ? Math.trunc(x / y) : Math.floor(x / y), at, w, l)
        })
      case '%':
        // HIP：余数和被除数同号；Python：余数和除数同号
        return map2(a, b, type, (x, y, w, l) => {
          if (y === 0) m.divideByZero(at, w, l, '%')
          let r = x % y
          if (!hip && r !== 0 && r < 0 !== y < 0) r += y
          return r + 0
        })
      default:
        throw new Error(`未知的运算符 ${e.op}`)
    }
  }

  const cond = (e: CondExpr): CExpr => {
    const test = expr(e.test)
    const yes = expr(e.body)
    const no = expr(e.orelse)
    const out = new Float64Array(W)
    const a = new Int32Array(W)
    const b = new Int32Array(W)
    return {
      // 检查器已经让两边类型一致（不一致时补了转换）
      type: yes.type,
      ev: (w, lanes, n) => {
        const t = test.ev(w, lanes, n)
        let na = 0
        let nb = 0
        for (let k = 0; k < n; k++) {
          const l = lanes[k]
          if (t[l] !== 0) a[na++] = l
          else b[nb++] = l
        }
        if (na > 0) {
          const v = yes.ev(w, a, na)
          for (let k = 0; k < na; k++) out[a[k]] = v[a[k]]
        }
        if (nb > 0) {
          const v = no.ev(w, b, nb)
          for (let k = 0; k < nb; k++) out[b[k]] = v[b[k]]
        }
        return out
      },
    }
  }

  const expr = (e: Expr): CExpr => {
    switch (e.kind) {
      case 'num':
        return constant(e.value, e.type)
      case 'bool':
        return constant(e.value ? 1 : 0, 'bool')
      case 'builtin':
        if (e.name === 'threadIdx.x') return { type: 'int', ev: (w) => w.tid }
        if (e.name === 'blockIdx.x') return { type: 'int', ev: () => m.blockVec }
        return constant(e.name === 'blockDim.x' ? blockDim : grid, 'int')
      case 'name': {
        const v = locals.get(e.name)!
        const slot = v.slot
        return { type: v.type, ev: (w) => w.regs[slot] }
      }
      case 'index':
        return load(e)
      case 'unary':
        return unary(e)
      case 'binary':
        return binary(e)
      case 'cond':
        return cond(e)
      case 'cast':
        return convert(expr(e.arg), e.type, e.loc)
    }
  }

  /** 一个代码块：块里声明的变量出了块就不能用了（检查器保证不会和外层重名）。 */
  const block = (list: Stmt[]): CStmt[] => {
    const declared: string[] = []
    const out: CStmt[] = []
    for (const s of list) {
      const c = stmt(s, declared)
      if (c) out.push(c)
    }
    for (const name of declared) locals.delete(name)
    return out
  }

  const stmt = (s: Stmt, declared: string[]): CStmt | null => {
    const base = { line: s.loc.line, loc: s.loc }
    switch (s.kind) {
      case 'let': {
        const value = expr(s.init)
        declared.push(s.name)
        return { ...base, kind: 'set', slot: newSlot(s.name, value.type), value }
      }
      case 'assign': {
        const t = s.target
        if (t.kind === 'name') {
          const v = locals.get(t.name)!
          return { ...base, kind: 'set', slot: v.slot, value: convert(expr(s.value), v.type, s.loc) }
        }
        // 先算等号右边，再算下标（C++17 和 Python 都是这个顺序）
        const ref = arrays.get(t.array)!
        const value = convert(expr(s.value), ref.elem, s.loc)
        return { ...base, kind: 'store', ref, index: expr(t.index), value }
      }
      case 'atomic': {
        const ref = arrays.get(s.array)!
        const index = expr(s.index)
        return { ...base, kind: 'atomic', ref, index, value: convert(expr(s.value), ref.elem, s.loc) }
      }
      case 'if':
        return { ...base, kind: 'if', test: expr(s.test), body: block(s.body), orelse: block(s.orelse) }
      case 'for': {
        const start = expr(s.start)
        const stop = expr(s.stop)
        const step = expr(s.step)
        const slot = newSlot(s.name, 'int')
        const body = block(s.body)
        locals.delete(s.name)
        // dir：1 往上数、-1 往下数、0 按每个 lane 步长的正负走
        return { ...base, kind: 'for', slot, name: s.name, start, stop, step, dir: s.dir === 'up' ? 1 : s.dir === 'down' ? -1 : 0, body }
      }
      case 'while':
        return { ...base, kind: 'while', test: expr(s.test), body: block(s.body) }
      case 'shared': {
        // 共享数组不是一步：每个 block 开始时清零，整个 block 共用
        const ref: ArrayRef = { name: s.name, space: 'lds', elem: s.elem, data: new Float64Array(s.size), local: new AccessTable(false), cross: null }
        arrays.set(s.name, ref)
        shared.push(ref)
        return null
      }
      case 'sync':
        return { ...base, kind: 'sync' }
    }
  }

  const body = block(kernel.body)
  return { body, slots, inits, globals, shared }
}

// ── 执行 ───────────────────────────────────────────────────────────────

function execute(m: Machine, program: Program, order: number[], blockDim: number) {
  const W = m.W
  for (const b of order) {
    m.startBlock(b)
    for (const ref of program.shared) ref.data.fill(0)
    const waves: Wave[] = []
    for (let base = 0; base < blockDim; base += W) {
      const count = Math.min(W, blockDim - base)
      const alive = new Int32Array(count)
      for (let l = 0; l < count; l++) alive[l] = l
      const tid = new Float64Array(W)
      for (let l = 0; l < W; l++) tid[l] = base + l
      const regs: Vec[] = []
      for (let s = 0; s < program.slots; s++) regs.push(new Float64Array(W))
      for (const p of program.inits) regs[p.slot].fill(p.value)
      waves.push({ index: base / W, base, alive, count, regs, tid })
    }
    // 一个 wave 运行到同步或结束再换下一个；都停在同步上就一起往下走
    const runs = waves.map((w) => exec(m, program.body, w, w.alive, w.count))
    const waiting: Array<SyncPoint | null> = waves.map(() => null)
    const done = waves.map(() => false)
    for (;;) {
      for (let i = 0; i < waves.length; i++) {
        if (done[i]) continue
        const r = runs[i].next()
        if (r.done) {
          done[i] = true
          waiting[i] = null
        } else {
          waiting[i] = r.value
        }
      }
      if (waiting.every((s) => s === null)) break
      m.release(waves, waiting)
    }
  }
}

/** 一个 wave 执行一段语句，lanes[0 … n) 是活跃的 lane。遇到同步就停下（yield），等整个 block 到齐。 */
function* exec(m: Machine, list: CStmt[], w: Wave, lanes: Lanes, n: number): Generator<SyncPoint, void, undefined> {
  for (const s of list) {
    switch (s.kind) {
      case 'set': {
        m.begin(s)
        const v = s.value.ev(w, lanes, n)
        const r = w.regs[s.slot]
        for (let k = 0; k < n; k++) {
          const l = lanes[k]
          r[l] = v[l]
        }
        if (m.quiet) m.emit(w, 'exec', lanes, n)
        break
      }
      case 'store':
      case 'atomic': {
        m.begin(s)
        let iv: Vec
        let v: Vec
        if (s.kind === 'store') {
          v = s.value.ev(w, lanes, n)
          iv = s.index.ev(w, lanes, n)
        } else {
          iv = s.index.ev(w, lanes, n)
          v = s.value.ev(w, lanes, n)
        }
        write(m, s, w, lanes, n, iv, v)
        break
      }
      case 'if': {
        m.begin(s)
        const t = s.test.ev(w, lanes, n)
        m.emit(w, 'branch', lanes, n)
        const yes = new Int32Array(n)
        const no = new Int32Array(n)
        let ny = 0
        let nn = 0
        for (let k = 0; k < n; k++) {
          const l = lanes[k]
          if (t[l] !== 0) yes[ny++] = l
          else no[nn++] = l
        }
        if (ny > 0) yield* exec(m, s.body, w, yes, ny)
        if (nn > 0 && s.orelse.length > 0) yield* exec(m, s.orelse, w, no, nn)
        break
      }
      case 'for': {
        // 起点、终点、步长只在进入循环时算一次。往上数时 k < 终点才继续，往下数时 k > 终点才继续；
        // 方向由 s.dir 决定，s.dir 是 0（Python 的 range，步长不是字面量）时看这个 lane 步长的正负
        m.begin(s)
        const k0 = s.start.ev(w, lanes, n)
        const reg = w.regs[s.slot]
        for (let k = 0; k < n; k++) reg[lanes[k]] = k0[lanes[k]]
        const stop = Float64Array.from(s.stop.ev(w, lanes, n))
        const step = Float64Array.from(s.step.ev(w, lanes, n))
        const dir = s.dir
        for (let k = 0; k < n; k++) {
          const l = lanes[k]
          if (step[l] === 0) fail('runtime', s.loc, `${m.who(w, l)}的循环步长是 0，循环变量一直不变，循环停不下来。`, '把步长改成不是 0 的数。')
          // 步长的正负和方向相反（只会是 HIP 的步长是变量）：起点满足条件就永远满足，真机上停不下来；不满足就一次也不执行
          if (step[l] * dir < 0 && (dir > 0 ? reg[l] < stop[l] : reg[l] > stop[l])) {
            fail(
              'runtime',
              s.loc,
              `${m.who(w, l)}的步长是 ${step[l]}：${s.name} 越来越${dir > 0 ? '小' : '大'}，循环条件一直成立，这个循环在真机上不会结束。`,
              `检查步长的正负：条件是 < 或 <= 时，${s.name} 每一轮要变大；条件是 > 或 >= 时，${s.name} 每一轮要变小。`,
            )
          }
        }
        const cur = Int32Array.from(lanes.subarray(0, n))
        let cn = n
        for (let first = true; ; first = false) {
          if (!first) {
            m.begin(s)
            for (let k = 0; k < cn; k++) {
              const l = cur[k]
              reg[l] = m.int(reg[l] + step[l], s.loc, w, l)
            }
          }
          m.emit(w, 'branch', cur, cn)
          let c = 0
          for (let k = 0; k < cn; k++) {
            const l = cur[k]
            if (dir > 0 || (dir === 0 && step[l] > 0) ? reg[l] < stop[l] : reg[l] > stop[l]) cur[c++] = l
          }
          cn = c
          if (cn === 0) break
          yield* exec(m, s.body, w, cur, cn)
        }
        break
      }
      case 'while': {
        const cur = Int32Array.from(lanes.subarray(0, n))
        let cn = n
        for (;;) {
          m.begin(s)
          const t = s.test.ev(w, cur, cn)
          m.emit(w, 'branch', cur, cn)
          let c = 0
          for (let k = 0; k < cn; k++) if (t[cur[k]] !== 0) cur[c++] = cur[k]
          cn = c
          if (cn === 0) break
          yield* exec(m, s.body, w, cur, cn)
        }
        break
      }
      case 'sync': {
        m.begin(s)
        m.emit(w, 'barrier', lanes, n)
        if (n !== w.count) m.partialSync(s, w, lanes, n)
        yield s
        break
      }
    }
  }
}

/** 写数组（store）或原子加（atomic）：先读完所有 lane 的值，再按 lane 顺序写；同一个位置被写多次时最后一个 lane 留下。 */
function write(m: Machine, s: Extract<CStmt, { kind: 'store' | 'atomic' }>, w: Wave, lanes: Lanes, n: number, iv: Vec, v: Vec) {
  const ref = s.ref
  const data = ref.data
  const atomic = s.kind === 'atomic'
  const addrs: number[] = new Array(n)
  for (let k = 0; k < n; k++) {
    const l = lanes[k]
    const i = iv[l]
    addrs[k] = i
    if (i >= 0 && i < data.length) {
      m.access(ref, i, atomic ? ATOMIC : WRITE, w, l)
      if (!atomic) data[i] = v[l]
      else data[i] = ref.elem === 'int' ? m.int(data[i] + v[l], s.loc, w, l) : data[i] + v[l]
    } else {
      m.outsideWrite(ref, i, w, l, s.kind, v[l])
    }
  }
  m.emit(w, s.kind, lanes, n, ref, addrs)
}
