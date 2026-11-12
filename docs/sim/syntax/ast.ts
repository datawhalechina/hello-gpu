/**
 * HIP Lite 和 Py Lite 共用的语法树（08 第 3 节）。两种写法的同一个程序解析出来逐项相同，
 * 只有位置 loc 不同（唯一的例外是步长不是字面量的 for，见下面的 dir）；后面的解释器、可视化、判星都只认这棵树。
 *
 * 为了让「同一个程序」真的得到同一棵树，有几条约定：
 * - 变量不带类型标注，类型由初值决定。HIP 里声明的类型和初值类型不一样时（float s = n;），
 *   解析器补上显式的 cast；Python 风格要自己写 float(n)。字面量直接换成目标类型（float s = 0; 和 s = 0.0 相同）。
 *   之后再赋值时，整数存进小数变量会补上 cast（两种写法一样）；小数存进整数变量，HIP 补上截断的 cast，
 *   Python 风格报类型错误。类型在解析时不知道的地方（Python 风格的参数）由解释器在运行时处理。
 * - '/' 永远是小数除法，'//' 是整数除法：HIP 里两个整数相除写 /，解析器记成 '//'。
 *   '//' 和 '%' 遇到负数时两种语言的取整方向不同（HIP 向 0 截断，Python 向下取整），
 *   解释器按写法区分，和 L1 的 expr.ts 一致。
 * - for 是计数循环：起点、终点、步长只在进入循环时算一次；往上数（dir 是 'up'）时 k < stop 才继续，
 *   往下数（'down'）时 k > stop 才继续。HIP 的 k <= n 记成 stop = n + 1，k >= n 记成 stop = n - 1。
 *   循环体里不能改循环变量，也不能改终点、步长用到的变量（两种语言在这两种情况下结果不同）。
 * - for 的方向 dir：HIP 由条件决定（< 和 <= 往上数，> 和 >= 往下数），步长是字面量时解析器检查它的正负和条件一致。
 *   Python 的 range 没有条件，方向由步长的正负决定（和 Python 一样）：步长是字面量时解析时就知道，记下来；
 *   不是字面量时记 null，运行时按步长的正负走。
 *   HIP 的步长是变量（k += s）而 s 的正负和 dir 相反时，这个循环在真机上不会结束：起点满足条件的线程
 *   由解释器报运行时错误，起点不满足条件的一次也不执行（和真机一样）。所以步长不是字面量时，
 *   两种写法的树在 dir 上不同：HIP 记条件的方向，Python 记 null。
 * - 写数组元素时按数组的元素类型转换：参数数组看传进来的数据，共享数组看声明。
 * - 变量只在声明它的代码块里有效（Python 风格也一样），不能和外层的名字重名。
 */
import type { Lang } from '../expr.ts'
import type { SimError } from './errors.ts'

export type { Lang }

/** 源码位置：行、列都从 1 开始，列按 UTF-16 字符数计（和编辑器一致）。 */
export interface Loc {
  line: number
  col: number
}

export type ScalarType = 'int' | 'float' | 'bool'
/** 数组元素只能是整数或小数。 */
export type ElemType = 'int' | 'float'

/** 内建变量。只支持一维的 .x；.y、.z 后面的关卡再讲。 */
export const BUILTINS = ['blockIdx.x', 'blockDim.x', 'threadIdx.x', 'gridDim.x'] as const
export type Builtin = (typeof BUILTINS)[number]
/** 内建变量点号前面的部分，比如 threadIdx。 */
export const BUILTIN_BASES: readonly string[] = BUILTINS.map((b) => b.slice(0, -2))

/** 语法层的上限：不是硬件参数，是模拟器为了不卡住页面、不占太多内存定的。 */
export const LIMITS = {
  /** 源码最多多少行、多少个字符 */
  sourceLines: 200,
  sourceChars: 10_000,
  /** 代码块、括号、一元运算和一串二元运算加起来最多套多少层；也保证后面递归处理语法树时不会爆栈 */
  depth: 32,
  /** 一个 kernel 里所有共享数组加起来最多多少个元素 */
  sharedElements: 4096,
  /** 整数字面量的最大值（32 位有符号整数） */
  maxInt: 2_147_483_647,
} as const

/** '/' 小数除法；'//' 整数除法；'and'、'or' 是 HIP 的 &&、||。比较的结果是真假值。 */
export type BinaryOp = '+' | '-' | '*' | '/' | '//' | '%' | '<' | '<=' | '>' | '>=' | '==' | '!=' | 'and' | 'or'
/** '-' 取负；'not' 是 HIP 的 !。 */
export type UnaryOp = '-' | 'not'

export interface NumExpr {
  kind: 'num'
  type: 'int' | 'float'
  value: number
  loc: Loc
}
export interface BoolExpr {
  kind: 'bool'
  value: boolean
  loc: Loc
}
/** 局部变量、循环变量或标量参数。数组只能出现在 IndexExpr 和 AtomicStmt 里。 */
export interface NameExpr {
  kind: 'name'
  name: string
  loc: Loc
}
export interface BuiltinExpr {
  kind: 'builtin'
  name: Builtin
  loc: Loc
}
/** array[index]：array 是数组参数或共享数组。 */
export interface IndexExpr {
  kind: 'index'
  array: string
  index: Expr
  loc: Loc
}
export interface UnaryExpr {
  kind: 'unary'
  op: UnaryOp
  arg: Expr
  loc: Loc
}
/** loc 是运算符的位置。 */
export interface BinaryExpr {
  kind: 'binary'
  op: BinaryOp
  left: Expr
  right: Expr
  loc: Loc
}
/** HIP 的 test ? body : orelse；Python 的 body if test else orelse。 */
export interface CondExpr {
  kind: 'cond'
  test: Expr
  body: Expr
  orelse: Expr
  loc: Loc
}
/** 显式类型转换：HIP 的 (int)x、int(x)，Python 的 int(x)；也包括解析器为 HIP 隐式转换补上的。 */
export interface CastExpr {
  kind: 'cast'
  type: ScalarType
  arg: Expr
  loc: Loc
}

export type Expr = NumExpr | BoolExpr | NameExpr | BuiltinExpr | IndexExpr | UnaryExpr | BinaryExpr | CondExpr | CastExpr

/** 声明变量并给初值：HIP 的 int i = …;，Python 风格里第一次给 i 赋值。 */
export interface LetStmt {
  kind: 'let'
  name: string
  init: Expr
  loc: Loc
}
/** 给已有的变量或数组元素赋值。x += v 这类写法展开成 x = x + v。 */
export interface AssignStmt {
  kind: 'assign'
  target: NameExpr | IndexExpr
  value: Expr
  loc: Loc
}
/** HIP 的 else if 和 Python 的 elif 都是 orelse 里只有一条 if。 */
export interface IfStmt {
  kind: 'if'
  test: Expr
  body: Stmt[]
  orelse: Stmt[]
  loc: Loc
}
/** 往上数还是往下数，见文件开头。 */
export type LoopDir = 'up' | 'down'
/** 计数循环，语义见文件开头。 */
export interface ForStmt {
  kind: 'for'
  name: string
  start: Expr
  stop: Expr
  step: Expr
  /** 'up' 是 k < stop 才继续，'down' 是 k > stop 才继续；null 表示按运行时步长的正负走（Python 的 range，步长不是字面量） */
  dir: LoopDir | null
  body: Stmt[]
  loc: Loc
}
export interface WhileStmt {
  kind: 'while'
  test: Expr
  body: Stmt[]
  loc: Loc
}
/** 共享数组：同一个 block 的线程共用一份。只能写在 kernel 最外层，大小是固定的整数。 */
export interface SharedStmt {
  kind: 'shared'
  name: string
  elem: ElemType
  size: number
  loc: Loc
}
/** block 内同步：HIP 的 __syncthreads()，Python 的 syncthreads()。 */
export interface SyncStmt {
  kind: 'sync'
  loc: Loc
}
/** 原子加 array[index] += value：多个线程同时加也不会互相覆盖。 */
export interface AtomicStmt {
  kind: 'atomic'
  op: 'add'
  array: string
  index: Expr
  value: Expr
  loc: Loc
}

export type Stmt = LetStmt | AssignStmt | IfStmt | ForStmt | WhileStmt | SharedStmt | SyncStmt | AtomicStmt

export interface Param {
  name: string
  loc: Loc
}

/** 整个程序：一个 kernel。 */
export interface Kernel {
  kind: 'kernel'
  name: string
  params: Param[]
  body: Stmt[]
  loc: Loc
}

/**
 * 参数类型。HIP 写法在代码里声明，解析结果的 signature 给出，解释器用它核对传进来的数据；
 * Python 风格的参数类型由数据决定，解释器按数据整理成同样的形状，传回 parse 再检查一遍。
 */
export interface ParamSig {
  name: string
  array: boolean
  type: ScalarType
}

export type ParseResult =
  | { ok: true; kernel: Kernel; signature: ParamSig[] | null }
  | { ok: false; error: SimError }
