/**
 * 两种写法共用的检查：名字和作用域、类型、HIP 的隐式转换，以及运行前就能确定的错误
 * （除以字面量 0、步长为 0、共享数组超过上限）。输入是解析器读出来的原始树，输出 ast.ts 里的最终语法树。
 *
 * 类型规则：整数和小数混算得小数；比较、and、or、not 得到真假值；Python 风格的 / 永远得到小数。
 * HIP 的变量、参数都有声明的类型，所以每个值的类型都知道；Python 风格的参数类型由传进来的数据决定，
 * 用到参数的地方类型可能不知道（null），这时检查放过，留给解释器在运行时判断。
 */
import {
  BUILTIN_BASES,
  LIMITS,
  type AtomicStmt,
  type BinaryExpr,
  type CondExpr,
  type ElemType,
  type Expr,
  type IndexExpr,
  type Kernel,
  type Lang,
  type Loc,
  type LoopDir,
  type NameExpr,
  type ScalarType,
  type Stmt,
  type SyncStmt,
} from './ast.ts'
import { fail } from './errors.ts'
import { closestName } from './lex.ts'

/** 解析器的输出。和最终语法树的区别：带着 HIP 的类型声明；Python 风格的第一次赋值还是 assign。 */
export type RawStmt =
  | { kind: 'decl'; type: ScalarType; readonly: boolean; name: string; init: Expr; loc: Loc }
  | { kind: 'assign'; target: NameExpr | IndexExpr; value: Expr; loc: Loc }
  | { kind: 'if'; test: Expr; body: RawStmt[]; orelse: RawStmt[]; loc: Loc }
  | { kind: 'for'; name: string; nameLoc: Loc; start: Expr; stop: Expr; step: Expr; dir: LoopDir | null; body: RawStmt[]; loc: Loc }
  | { kind: 'while'; test: Expr; body: RawStmt[]; loc: Loc }
  | { kind: 'shared'; name: string; elem: ElemType; size: number; sizeLoc: Loc; loc: Loc }
  | SyncStmt
  | (AtomicStmt & { arrayLoc: Loc })

export interface RawParam {
  name: string
  loc: Loc
  /** HIP 的参数声明；Python 风格是 null */
  decl: { array: boolean; type: ScalarType; readonly: boolean } | null
}

export interface RawKernel {
  name: string
  params: RawParam[]
  body: RawStmt[]
  loc: Loc
}

interface Sym {
  kind: 'param' | 'var' | 'loop' | 'shared'
  loc: Loc
  /** 是不是数组；Python 风格的参数在第一次用到之前是 null */
  array: boolean | null
  /** 变量的类型或数组元素的类型；不知道时是 null */
  type: ScalarType | null
  readonly: boolean
}

class Scope {
  vars = new Map<string, Sym>()
  parent: Scope | null
  constructor(parent: Scope | null) {
    this.parent = parent
  }
  find(name: string): Sym | null {
    for (let s: Scope | null = this; s; s = s.parent) {
      const sym = s.vars.get(name)
      if (sym) return sym
    }
    return null
  }
  names(): string[] {
    const out: string[] = []
    for (let s: Scope | null = this; s; s = s.parent) out.push(...s.vars.keys())
    return out
  }
}

interface Typed {
  node: Expr
  type: ScalarType | null
}

const TYPE_NAME: Record<ScalarType, string> = { int: '整数', float: '小数', bool: '真假值' }

/** 内建的名字，两种写法都不能拿来当变量名。查表用 === true，避开 constructor 这类原型上的名字。 */
const RESERVED: Record<string, true> = {
  blockIdx: true, blockDim: true, threadIdx: true, gridDim: true, __syncthreads: true, syncthreads: true,
  atomicAdd: true, atomic_add: true, shared: true, range: true, kernel: true, int: true, float: true, bool: true,
}

/** 另一种写法里的名字：读者切换写法后最容易顺手写错。 */
const FOREIGN_NAMES: Record<Lang, Record<string, string>> = {
  hip: {
    True: 'HIP 里真和假写成 true、false。',
    False: 'HIP 里真和假写成 true、false。',
    None: 'HIP Lite 里用不到 None。',
  },
  python: {
    true: 'Python 里真和假写成 True、False。',
    false: 'Python 里真和假写成 True、False。',
    NULL: 'Py Lite 里用不到空指针。',
    nullptr: 'Py Lite 里用不到空指针。',
  },
}

function arith(a: ScalarType | null, b: ScalarType | null): ScalarType | null {
  if (a === 'float' || b === 'float') return 'float'
  if (a === null || b === null) return null
  return 'int'
}

/** 类型转换；字面量直接换成目标类型（float s = 0; 和 s = 0.0 得到同一个节点）。 */
function castNode(node: Expr, to: ScalarType, loc: Loc = node.loc): Expr {
  if (node.kind === 'num' || node.kind === 'bool') {
    const v = node.kind === 'bool' ? Number(node.value) : node.value
    if (to === 'bool') return { kind: 'bool', value: v !== 0, loc: node.loc }
    return { kind: 'num', type: to, value: (to === 'int' ? Math.trunc(v) : v) || 0, loc: node.loc }
  }
  return { kind: 'cast', type: to, arg: node, loc }
}

/** 表达式里读到的变量名（不含数组名）。 */
function namesIn(e: Expr, out: string[] = []): string[] {
  switch (e.kind) {
    case 'name':
      out.push(e.name)
      break
    case 'index':
      namesIn(e.index, out)
      break
    case 'unary':
    case 'cast':
      namesIn(e.arg, out)
      break
    case 'binary':
      namesIn(e.left, out)
      namesIn(e.right, out)
      break
    case 'cond':
      namesIn(e.test, out)
      namesIn(e.body, out)
      namesIn(e.orelse, out)
      break
  }
  return out
}

/** 一段代码里被赋值的变量，以及第一次赋值的位置。 */
function assignedNames(stmts: Stmt[], out = new Map<string, Loc>()): Map<string, Loc> {
  for (const s of stmts) {
    if (s.kind === 'assign' && s.target.kind === 'name' && !out.has(s.target.name)) out.set(s.target.name, s.target.loc)
    if (s.kind === 'if') {
      assignedNames(s.body, out)
      assignedNames(s.orelse, out)
    }
    if (s.kind === 'for' || s.kind === 'while') assignedNames(s.body, out)
  }
  return out
}

/** Python 风格里第一个 / 的位置：下标是小数时，多半是它造成的。 */
function firstTrueDivision(e: Expr): Loc | null {
  switch (e.kind) {
    case 'binary':
      if (e.op === '/') return e.loc
      return firstTrueDivision(e.left) ?? firstTrueDivision(e.right)
    case 'unary':
    case 'cast':
      return e.kind === 'cast' ? null : firstTrueDivision(e.arg)
    case 'index':
      return null
    case 'cond':
      return firstTrueDivision(e.body) ?? firstTrueDivision(e.orelse)
    default:
      return null
  }
}

export function check(raw: RawKernel, lang: Lang): Kernel {
  const top = new Scope(null)
  /** 出了代码块的名字：再用到时告诉读者它在哪里定义、为什么不能用 */
  const retired = new Map<string, { loc: Loc; block: string }>()
  let sharedTotal = 0

  const retire = (scope: Scope, block: string) => {
    for (const [name, sym] of scope.vars) retired.set(name, { loc: sym.loc, block })
  }

  /** 新名字：不能是保留的名字，也不能和外层已有的名字重名。 */
  const declare = (name: string, loc: Loc, scope: Scope, hint: string) => {
    if (RESERVED[name] === true) fail('syntax', loc, `「${name}」是模拟器内建的名字，不能拿来当变量名。`, '换一个名字。')
    const old = scope.find(name)
    if (old) {
      const what = old.kind === 'param' ? '是参数了' : '定义过了'
      fail('syntax', loc, `「${name}」在第 ${old.loc.line} 行已经${what}。`, hint)
    }
  }

  const resolve = (name: string, loc: Loc, scope: Scope, missing?: [string, string]): Sym => {
    const sym = scope.find(name)
    if (sym) return sym
    const foreign = Object.hasOwn(FOREIGN_NAMES[lang], name) ? FOREIGN_NAMES[lang][name] : null
    if (foreign) fail('syntax', loc, `不认识「${name}」。`, foreign)
    const gone = retired.get(name)
    if (gone) {
      fail(
        'syntax',
        loc,
        `「${name}」是在第 ${gone.loc.line} 行的 ${gone.block}里定义的，出了 ${gone.block}就不能用了。`,
        lang === 'hip'
          ? `如果后面还要用，在 ${gone.block}前面声明它（比如 int ${name} = 0;），${gone.block}里只写 ${name} = …;。`
          : `如果后面还要用，在 ${gone.block}前面先给它一个初值，比如 ${name} = 0。`,
      )
    }
    const guess = closestName(name, scope.names())
    if (guess) fail('syntax', loc, `不认识「${name}」。`, `是不是想写「${guess}」？`)
    const builtin = closestName(name, BUILTIN_BASES)
    if (builtin) fail('syntax', loc, `不认识「${name}」。`, `是不是想写「${builtin}.x」？`)
    if (missing) fail('syntax', loc, missing[0], missing[1])
    fail(
      'syntax',
      loc,
      `不认识「${name}」。`,
      lang === 'hip' ? `变量要先声明再用，比如 int ${name} = 0;。` : `变量要先赋值再用，比如 ${name} = 0。`,
    )
  }

  /** 值放进 to 类型的变量：放宽（整数 → 小数、真假值 → 整数）两种写法都自动转；HIP 还会截断小数，Python 风格报错。 */
  const convert = (v: Typed, to: ScalarType | null, name: string, at: Loc): Expr => {
    const from = v.type
    if (to === null || from === null || from === to) return v.node
    if (to === 'float' || (to === 'int' && from === 'bool') || lang === 'hip') return castNode(v.node, to)
    fail(
      'type',
      at,
      `「${name}」第一次赋值时是${TYPE_NAME[to]}，这里却要存${TYPE_NAME[from]}。`,
      to === 'int'
        ? `想让它存小数，就把第一次赋值写成小数（比如 ${name} = 0.0）；只要整数部分就写 int(…)。`
        : '换一个新变量来存这个值。',
    )
  }

  const zeroDivisor = (divisor: Expr, op: string) => {
    if (divisor.kind !== 'num' || divisor.value !== 0) return
    const what = op === '%' ? '对 0 取余数' : '除以 0'
    fail('runtime', divisor.loc, `这里${what}，每个线程运行到这一行都会出错。`, '把除数换成不是 0 的数。')
  }

  const index = (e: IndexExpr, scope: Scope, write: boolean, at: Loc = e.loc): Typed => {
    const sym = resolve(e.array, at, scope)
    if (sym.array === false) {
      fail('type', at, `「${e.array}」是一个数，不是数组，后面不能加 [ ]。`, '只有数组参数和共享数组才能写成 a[i]。')
    }
    sym.array = true
    if (write && sym.readonly) {
      fail('type', at, `「${e.array}」声明成了 const，只能读，不能写。`, '去掉参数前面的 const，或者把结果写到别的数组里。')
    }
    const i = expr(e.index, scope)
    if (i.type === 'float') {
      const slash = lang === 'python' ? firstTrueDivision(i.node) : null
      if (slash) fail('type', slash, '下标必须是整数。Python 里 / 的结果是小数，哪怕除得尽（8 / 1 得到 8.0）。', '整数相除要用 //。')
      fail('type', i.node.loc, '下标必须是整数，这里算出来的是小数。', lang === 'hip' ? '把下标换成整数，或者写成 (int)(…)。' : '把下标换成整数，或者写成 int(…)。')
    }
    return { node: { kind: 'index', array: e.array, index: i.node, loc: e.loc }, type: sym.type }
  }

  const binary = (e: BinaryExpr, scope: Scope): Typed => {
    const l = expr(e.left, scope)
    const r = expr(e.right, scope)
    const node = (op = e.op): Expr => ({ kind: 'binary', op, left: l.node, right: r.node, loc: e.loc })
    switch (e.op) {
      case '+':
      case '-':
      case '*':
        return { node: node(), type: arith(l.type, r.type) }
      case '/':
        zeroDivisor(r.node, '/')
        // HIP 里两个整数相除是整数除法，和 Python 的 // 是同一个节点
        if (lang === 'hip' && l.type !== 'float' && r.type !== 'float') return { node: node('//'), type: 'int' }
        return { node: node(), type: 'float' }
      case '//':
        zeroDivisor(r.node, '//')
        return { node: node(), type: arith(l.type, r.type) }
      case '%':
        zeroDivisor(r.node, '%')
        if (lang === 'hip' && (l.type === 'float' || r.type === 'float')) {
          fail('type', e.loc, 'HIP 里 % 只能用在两个整数之间，这里有小数。', '检查 % 两边的值，换成整数。')
        }
        return { node: node(), type: arith(l.type, r.type) }
      default:
        return { node: node(), type: 'bool' }
    }
  }

  const cond = (e: CondExpr, scope: Scope): Typed => {
    const test = expr(e.test, scope).node
    let a = expr(e.body, scope)
    let b = expr(e.orelse, scope)
    let type = a.type === b.type ? a.type : null
    if (a.type !== null && b.type !== null && a.type !== b.type) {
      const to: ScalarType = a.type === 'float' || b.type === 'float' ? 'float' : 'int'
      if (lang === 'python' && to === 'float') {
        fail('type', e.loc, '条件表达式的两个结果一个是整数、一个是小数。', '让两边类型一致，比如把 0 写成 0.0。')
      }
      if (a.type !== to) a = { node: castNode(a.node, to), type: to }
      if (b.type !== to) b = { node: castNode(b.node, to), type: to }
      type = to
    }
    return { node: { kind: 'cond', test, body: a.node, orelse: b.node, loc: e.loc }, type }
  }

  const expr = (e: Expr, scope: Scope): Typed => {
    switch (e.kind) {
      case 'num':
        return { node: e, type: e.type }
      case 'bool':
        return { node: e, type: 'bool' }
      case 'builtin':
        return { node: e, type: 'int' }
      case 'name': {
        const sym = resolve(e.name, e.loc, scope)
        if (sym.array === true) {
          fail('type', e.loc, `「${e.name}」是数组，不能直接当成一个数来用。`, `要用其中一个元素，写成 ${e.name}[i]。`)
        }
        sym.array = false
        return { node: e, type: sym.type }
      }
      case 'index':
        return index(e, scope, false)
      case 'unary': {
        const arg = expr(e.arg, scope)
        if (e.op === 'not') return { node: { kind: 'unary', op: 'not', arg: arg.node, loc: e.loc }, type: 'bool' }
        if (arg.node.kind === 'num') return { node: { ...arg.node, value: -arg.node.value || 0, loc: e.loc }, type: arg.type }
        return { node: { kind: 'unary', op: '-', arg: arg.node, loc: e.loc }, type: arg.type === 'bool' ? 'int' : arg.type }
      }
      case 'binary':
        return binary(e, scope)
      case 'cond':
        return cond(e, scope)
      case 'cast':
        return { node: castNode(expr(e.arg, scope).node, e.type, e.loc), type: e.type }
    }
  }

  const loopOperand = (e: Expr, scope: Scope, what: string): Expr => {
    const v = expr(e, scope)
    if (v.type === 'float') fail('type', v.node.loc, `循环的${what}要是整数，这里是小数。`, lang === 'hip' ? '换成整数，或者写成 (int)(…)。' : '换成整数，或者写成 int(…)。')
    return v.node
  }

  const block = (list: RawStmt[], parent: Scope, name: string): Stmt[] => {
    const scope = new Scope(parent)
    const out = list.map((s) => statement(s, scope))
    retire(scope, name)
    return out
  }

  const statement = (s: RawStmt, scope: Scope): Stmt => {
    switch (s.kind) {
      case 'decl': {
        declare(s.name, s.loc, scope, `要改它的值，去掉前面的类型，直接写 ${s.name} = …;。`)
        const init = convert(expr(s.init, scope), s.type, s.name, s.loc)
        scope.vars.set(s.name, { kind: 'var', loc: s.loc, array: false, type: s.type, readonly: s.readonly })
        return { kind: 'let', name: s.name, init, loc: s.loc }
      }
      case 'assign': {
        const t = s.target
        if (t.kind === 'index') {
          const target = index(t, scope, true).node as IndexExpr
          return { kind: 'assign', target, value: expr(s.value, scope).node, loc: s.loc }
        }
        const sym = lang === 'hip'
          ? resolve(t.name, t.loc, scope, [`「${t.name}」还没有声明。`, `第一次用变量要写上类型，比如 int ${t.name} = …;。`])
          : scope.find(t.name)
        if (!sym) {
          // Python 风格：第一次赋值就是声明
          declare(t.name, t.loc, scope, '')
          const init = expr(s.value, scope)
          scope.vars.set(t.name, { kind: 'var', loc: t.loc, array: false, type: init.type, readonly: false })
          return { kind: 'let', name: t.name, init: init.node, loc: s.loc }
        }
        if (sym.kind === 'loop') {
          fail('syntax', t.loc, `「${t.name}」是循环变量，循环会自己改它，循环里不能再给它赋值。`, '需要另一个值，就用一个新变量。')
        }
        if (sym.array === true) fail('type', t.loc, `「${t.name}」是数组，不能整个赋值。`, `要改其中一个元素，写成 ${t.name}[i] = …。`)
        if (sym.readonly) fail('type', t.loc, `「${t.name}」声明成了 const，只能读，不能改。`, '去掉 const，或者用一个新变量。')
        sym.array = false
        const value = convert(expr(s.value, scope), sym.type, t.name, t.loc)
        return { kind: 'assign', target: { kind: 'name', name: t.name, loc: t.loc }, value, loc: s.loc }
      }
      case 'if':
        return {
          kind: 'if',
          test: expr(s.test, scope).node,
          body: block(s.body, scope, 'if 语句'),
          orelse: block(s.orelse, scope, 'else 分支'),
          loc: s.loc,
        }
      case 'for': {
        const start = loopOperand(s.start, scope, '起点')
        const stop = loopOperand(s.stop, scope, '终点')
        const step = loopOperand(s.step, scope, '步长')
        if (step.kind === 'num' && step.value === 0) {
          fail(
            'runtime',
            step.loc,
            lang === 'hip' ? '循环的步长是 0，循环变量一直不变，循环停不下来。' : 'range 的步长是 0，Python 运行到这里会报错。',
            '把步长改成不是 0 的数。',
          )
        }
        // Python 的 range 没有条件：步长是字面量时方向就是它的正负，不是字面量时留到运行时按正负走
        const dir = s.dir ?? (step.kind === 'num' ? (step.value > 0 ? 'up' : 'down') : null)
        declare(s.name, s.nameLoc, scope, '换一个新名字当循环变量。')
        const inner = new Scope(scope)
        inner.vars.set(s.name, { kind: 'loop', loc: s.nameLoc, array: false, type: 'int', readonly: false })
        const body = s.body.map((b) => statement(b, inner))
        retire(inner, 'for 循环')
        const changed = assignedNames(body)
        for (const [what, e] of [['终点', stop], ['步长', step]] as const) {
          for (const name of namesIn(e)) {
            const at = changed.get(name)
            if (at) {
              fail(
                'syntax',
                at,
                `循环的${what}用到了「${name}」，可是循环里又改了「${name}」。`,
                `HIP 每一轮都会重新算${what}，Python 的 range 只在开始时算一次，两种写法的结果会不一样。先把它存进一个新变量，用新变量当${what}。`,
              )
            }
          }
        }
        return { kind: 'for', name: s.name, start, stop, step, dir, body, loc: s.loc }
      }
      case 'while':
        return { kind: 'while', test: expr(s.test, scope).node, body: block(s.body, scope, 'while 循环'), loc: s.loc }
      case 'shared': {
        if (scope !== top) fail('syntax', s.loc, '共享数组要声明在 kernel 的最外层，不能放在 if 或循环里面。', '把这一行移到 kernel 的开头。')
        declare(s.name, s.loc, scope, '换一个新名字。')
        if (s.size < 1) fail('syntax', s.sizeLoc, '共享数组至少要有 1 个元素。', '把大小改成正整数，比如 64。')
        sharedTotal += s.size
        if (sharedTotal > LIMITS.sharedElements) {
          fail('limit', s.sizeLoc, `共享数组一共有 ${sharedTotal} 个元素，超过了模拟器的上限 ${LIMITS.sharedElements} 个。`, '把共享数组改小一些。')
        }
        scope.vars.set(s.name, { kind: 'shared', loc: s.loc, array: true, type: s.elem, readonly: false })
        return { kind: 'shared', name: s.name, elem: s.elem, size: s.size, loc: s.loc }
      }
      case 'sync':
        return s
      case 'atomic': {
        const target = index({ kind: 'index', array: s.array, index: s.index, loc: s.loc }, scope, true, s.arrayLoc).node as IndexExpr
        return { kind: 'atomic', op: 'add', array: s.array, index: target.index, value: expr(s.value, scope).node, loc: s.loc }
      }
    }
  }

  const params = raw.params.map((p) => {
    if (RESERVED[p.name] === true) fail('syntax', p.loc, `「${p.name}」是模拟器内建的名字，不能拿来当参数名。`, '换一个名字。')
    if (top.vars.has(p.name)) fail('syntax', p.loc, `参数「${p.name}」写了两次。`, '每个参数用不同的名字。')
    const d = p.decl
    top.vars.set(p.name, { kind: 'param', loc: p.loc, array: d ? d.array : null, type: d ? d.type : null, readonly: d ? d.readonly : false })
    return { name: p.name, loc: p.loc }
  })
  const body = raw.body.map((s) => statement(s, top))
  return { kind: 'kernel', name: raw.name, params, body, loc: raw.loc }
}
