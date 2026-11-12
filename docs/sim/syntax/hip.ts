/**
 * HIP Lite：HIP（C++）的一个小子集（08 第 3 节），解析成 ast.ts 里两种写法共用的语法树。
 *
 * 支持：一个 __global__ kernel；int、float、bool 变量（声明时要给初值）；+ - * / %、比较、&& || !、
 * 三元 ?:；if / else、计数 for、while；a[i] 读写；__shared__ 数组；__syncthreads()；atomicAdd(&a[i], v)；
 * (int)x、float(x) 这样的类型转换。参数可以带 const 和 __restrict__。
 * 常见的写错（漏分号、中文标点、Python 写法、.y / .z、位运算……）都给出中文提示。
 */
import { BUILTIN_BASES, type BinaryOp, type Builtin, type Expr, type IndexExpr, type NameExpr, type ParamSig, type ParseResult, type ScalarType } from './ast.ts'
import { check, type RawKernel, type RawParam, type RawStmt } from './check.ts'
import { fail, SimFailure } from './errors.ts'
import {
  after,
  badChar,
  checkSourceSize,
  closestName,
  isDigit,
  isNameChar,
  isNameStart,
  locOf,
  matchOp,
  normalizeNewlines,
  scanNumber,
  stringError,
  TokenStream,
  type Token,
} from './lex.ts'

const OPS = [
  '<<=', '>>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->', '::',
  '&=', '|=', '^=', '+', '-', '*', '/', '%', '=', '<', '>', '!', '?', ':', '(', ')', '{', '}', '[', ']', ',', ';',
  '&', '|', '^', '~', '.', '@',
] as const

const TYPES: Record<string, ScalarType> = { int: 'int', float: 'float', bool: 'bool' }

/** 常见但 HIP Lite 不支持的类型。 */
const OTHER_TYPES: Record<string, true> = {
  double: true, unsigned: true, signed: true, long: true, short: true, char: true, auto: true, void: true,
  size_t: true, half: true, __half: true, _Float16: true, float2: true, float4: true, int2: true, int4: true,
  uint: true, int32_t: true, uint32_t: true, int64_t: true, uint64_t: true,
}

const KEYWORDS: Record<string, true> = {
  if: true, else: true, for: true, while: true, do: true, switch: true, case: true, default: true, break: true,
  continue: true, return: true, goto: true, int: true, float: true, bool: true, void: true, const: true, true: true,
  false: true, __global__: true, __shared__: true, __device__: true, __host__: true, sizeof: true, struct: true,
  class: true, typedef: true, static: true, new: true, delete: true, this: true, unsigned: true, signed: true,
  long: true, short: true, char: true, double: true, auto: true, and: true, or: true, not: true,
}

/** 赋值运算符，以及 x op= v 展开后用的二元运算。 */
const ASSIGN_OPS: Record<string, BinaryOp | null> = { '=': null, '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%' }

const BITWISE: Record<string, true> = {
  '<<': true, '>>': true, '&': true, '|': true, '^': true, '~': true, '<<=': true, '>>=': true, '&=': true, '|=': true, '^=': true,
}

const FOR_SHAPE = '写成 for (int k = 0; k < n; k++) 这样的计数循环。'

function tokenize(src: string): { tokens: Token[]; comments: Map<number, number> } {
  const tokens: Token[] = []
  /** 行号 → 这一行 // 注释开始的列；报漏分号时提醒「// 在 HIP 里是注释」 */
  const comments = new Map<number, number>()
  let i = 0
  let line = 1
  let lineStart = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\n') {
      line++
      i++
      lineStart = i
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v') {
      i++
      continue
    }
    const at = { line, col: i - lineStart + 1 }
    if (ch === '/' && src[i + 1] === '/') {
      comments.set(line, at.col)
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end < 0) fail('syntax', at, '注释「/*」一直没有结束。', '在注释末尾加上「*/」。')
      for (let k = i; k < end; k++) {
        if (src[k] === '\n') {
          line++
          lineStart = k + 1
        }
      }
      i = end + 2
      continue
    }
    if (ch === '#') fail('syntax', at, 'HIP 风格的沙盒里不用写 # 开头的行（#include、#define）。', '删掉这一行；想写说明就用 // 注释。')
    if (ch === '"' || ch === "'") stringError(at)
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1] ?? ''))) {
      const n = scanNumber(src, i, at, 'hip')
      tokens.push({ kind: 'num', text: src.slice(i, n.end), line, col: at.col, value: n.value, float: n.float })
      i = n.end
      continue
    }
    if (isNameStart(ch)) {
      let j = i + 1
      while (j < src.length && isNameChar(src[j])) j++
      tokens.push({ kind: 'name', text: src.slice(i, j), line, col: at.col, value: 0, float: false })
      i = j
      continue
    }
    const op = matchOp(src, i, OPS)
    if (op === null) badChar(ch, at)
    tokens.push({ kind: 'op', text: op, line, col: at.col, value: 0, float: false })
    i += op.length
  }
  tokens.push({ kind: 'eof', text: '', line, col: i - lineStart + 1, value: 0, float: false })
  return { tokens, comments }
}

function parseTokens(tokens: Token[], comments: Map<number, number>): { raw: RawKernel; signature: ParamSig[] } {
  const ts = new TokenStream(tokens)

  /** 别的语言里的写法、HIP Lite 不支持的运算符：给专门的提示。其他记号什么都不做。 */
  function foreign(t: Token) {
    const at = locOf(t)
    if (t.kind === 'name') {
      if (t.text === 'and' || t.text === 'or') fail('syntax', at, `HIP 里不用「${t.text}」。`, '「并且」写成 &&，「或者」写成 ||。')
      if (t.text === 'if') fail('syntax', at, 'HIP 里不能这样写条件表达式。', '写成 条件 ? 值1 : 值2。')
    }
    if (t.kind === 'op') {
      if (BITWISE[t.text] === true) {
        const shift = t.text.startsWith('<<') || t.text.startsWith('>>')
        fail('syntax', at, `HIP Lite 不支持位运算「${t.text}」。`, shift ? '乘以 2 写成 * 2，除以 2 写成 / 2。' : '改用 + - * / % 和比较来写。')
      }
      if (t.text === '++' || t.text === '--') fail('syntax', at, `${t.text} 只能单独写成一句。`, `比如 i${t.text};，不要写在式子中间。`)
      if (t.text === '->' || t.text === '::') fail('syntax', at, `HIP Lite 不支持「${t.text}」。`, '数组元素写成 a[i]。')
    }
  }

  /** 读到一个不该出现的记号：常见的写错给专门的提示，其余的说明这里本来应该是什么。 */
  function unexpected(t: Token, expected: string, hint = '检查这一行的写法。'): never {
    const at = locOf(t)
    if (t.kind === 'eof') fail('syntax', at, `代码没写完就结束了，这里还缺${expected}。`, '检查最后几行是不是少了「}」「)」或「;」。')
    foreign(t)
    if (t.kind === 'name' || t.kind === 'num') {
      fail('syntax', at, `「${t.text}」前面少了运算符或分号。`, '两个值之间要有运算符，比如 + 或 *；两句之间要用「;」隔开。')
    }
    fail('syntax', at, `这里应该是${expected}，却写了「${t.text}」。`, hint)
  }

  function expect(text: string, message: string, hint: string): Token {
    const t = ts.accept(text)
    if (t === null) fail('syntax', locOf(ts.peek()), message, hint)
    return t
  }

  function closeParen(open: Token) {
    if (ts.accept(')') === null) unexpected(ts.peek(), '右括号「)」', `和第 ${open.line} 行第 ${open.col} 列的「(」配对。`)
  }

  /** 一句话末尾的分号：漏写时指向上一个记号的末尾。 */
  function semicolon() {
    if (ts.accept(';') !== null) return
    const prev = ts.prev()
    const t = ts.peek()
    if (t.kind === 'eof' || t.line > prev.line || t.text === '}') {
      const end = after(prev)
      const comment = comments.get(prev.line)
      const extra = comment !== undefined && comment >= end.col
        ? '另外注意：HIP 里 // 是注释的开头，后面的内容都会被忽略；整数相除直接写 /。'
        : ''
      fail('syntax', end, '这一句末尾少了分号「;」。', `在「${prev.text}」后面加上「;」。${extra}`)
    }
    unexpected(t, '分号「;」')
  }

  function identifier(what: string): Token {
    const t = ts.peek()
    if (t.kind !== 'name') unexpected(t, what)
    if (KEYWORDS[t.text] === true) fail('syntax', locOf(t), `「${t.text}」是 HIP 的关键字，不能当${what}。`, '换一个名字。')
    return ts.next()
  }

  function typeName(what: string): ScalarType {
    const t = ts.peek()
    if (t.kind === 'name' && Object.hasOwn(TYPES, t.text)) {
      ts.next()
      return TYPES[t.text]
    }
    if (t.kind === 'name' && OTHER_TYPES[t.text] === true) {
      fail('syntax', locOf(t), `HIP Lite 只支持 int、float、bool 三种类型，不支持「${t.text}」。`, '整数用 int，小数用 float。')
    }
    if (t.kind === 'name') fail('syntax', locOf(t), `不认识类型「${t.text}」。`, '整数用 int，小数用 float，真假值用 bool。')
    unexpected(t, `${what}的类型`)
  }

  function kernel(): RawKernel & { signature: ParamSig[] } {
    const first = ts.peek()
    if (first.kind === 'eof') fail('syntax', locOf(first), '还没有写代码。', '先写一个 kernel：__global__ void 名字(参数) { … }')
    if (!ts.is('__global__')) {
      const at = locOf(first)
      if (ts.is('@') || ts.is('def')) fail('syntax', at, '这是 Python 风格的写法。', '切换到 Python 风格，或者改写成 __global__ void 名字(…) { … }。')
      if (ts.is('__device__') || ts.is('__host__')) fail('syntax', at, '沙盒里只写一个 kernel，不支持 __device__ 函数。', '把要用的计算直接写进 kernel 里。')
      if (ts.is('void')) fail('syntax', at, 'kernel 前面要加 __global__。', '写成 __global__ void 名字(…) { … }。')
      fail('syntax', at, '代码要从 __global__ void 开始，写一个 kernel。', '写成 __global__ void 名字(参数) { … }。')
    }
    ts.next()
    if (!ts.is('void')) {
      const t = ts.peek()
      if (t.kind === 'name' && (Object.hasOwn(TYPES, t.text) || OTHER_TYPES[t.text] === true)) {
        fail('syntax', locOf(t), 'kernel 不能有返回值。', '返回类型写成 void。')
      }
      fail('syntax', locOf(t), '__global__ 后面要写 void。', '写成 __global__ void 名字(…) { … }。')
    }
    ts.next()
    const name = identifier('kernel 的名字')
    const open = expect('(', 'kernel 的名字后面要跟参数列表「(」。', '写成 __global__ void 名字(float* a, int n) { … }。')
    const params: RawParam[] = []
    const signature: ParamSig[] = []
    if (ts.is('void') && ts.is(')', 1)) ts.next()
    if (!ts.is(')')) {
      do {
        const p = param()
        if (p.decl) signature.push({ name: p.name, array: p.decl.array, type: p.decl.type })
        params.push(p)
      } while (ts.accept(',') !== null)
    }
    if (ts.peek().kind === 'name') fail('syntax', locOf(ts.peek()), '参数之间要用逗号「,」隔开。', '比如 (float* a, int n)。')
    closeParen(open)
    if (!ts.is('{')) fail('syntax', locOf(ts.peek()), 'kernel 的代码要放在一对 { } 里。', '在参数列表后面写「{」，最后用「}」结束。')
    const body = block()
    const rest = ts.peek()
    if (rest.kind !== 'eof') fail('syntax', locOf(rest), 'kernel 结束以后不能再写别的代码。', '沙盒里只写一个 kernel；检查是不是多了「}」。')
    return { name: name.text, params, body, loc: locOf(name), signature }
  }

  function param(): RawParam {
    const t = ts.peek()
    if (t.kind === 'name' && (ts.is(',', 1) || ts.is(')', 1)) && !Object.hasOwn(TYPES, t.text)) {
      fail('syntax', locOf(t), `参数「${t.text}」前面要写类型。`, `比如 float* ${t.text} 或 int ${t.text}。`)
    }
    let readonly = ts.accept('const') !== null
    const typeTok = ts.peek()
    const type = typeName('参数')
    if (ts.accept('const') !== null) readonly = true
    const array = ts.accept('*') !== null
    if (array) {
      if (ts.is('__restrict__') || ts.is('__restrict')) ts.next()
      if (ts.is('*')) fail('syntax', locOf(ts.peek()), 'HIP Lite 不支持指针的指针（**）。', '数组参数写成 float* a。')
      if (type === 'bool') fail('type', locOf(typeTok), '数组只支持 int 和 float 两种元素。', '把 bool* 换成 int*。')
    }
    if (ts.is('&')) fail('syntax', locOf(ts.peek()), 'HIP Lite 不支持引用参数（&）。', '数组参数写成 float* a，数写成 int n。')
    const name = identifier('参数名')
    if (ts.is('[')) fail('syntax', locOf(ts.peek()), '数组参数要写成指针的样子。', `写成 ${typeTok.text}* ${name.text}。`)
    return { name: name.text, loc: locOf(name), decl: { array, type, readonly } }
  }

  function block(): RawStmt[] {
    const open = ts.next()
    ts.enter(open)
    const out: RawStmt[] = []
    while (!ts.is('}')) {
      if (ts.peek().kind === 'eof') fail('syntax', locOf(open), '这个「{」没有配对的「}」。', '在代码块结束的地方加上「}」。')
      out.push(...statement())
    }
    ts.next()
    ts.leave()
    return out
  }

  /** if、for、while、else 后面的一句或一个代码块。 */
  function branch(kw: Token): RawStmt[] {
    if (ts.is('{')) return block()
    if (ts.is(';')) fail('syntax', locOf(ts.peek()), `「${kw.text}」后面紧跟着分号，它就管不到下一句了。`, '去掉这个分号。')
    ts.enter(kw)
    const out = statement()
    ts.leave()
    return out
  }

  function statement(): RawStmt[] {
    const t = ts.peek()
    const at = locOf(t)
    if (t.kind === 'op') {
      if (t.text === ';') {
        ts.next()
        return []
      }
      if (t.text === '{') fail('syntax', at, '这里不需要单独的一对 { }。', '去掉这对大括号，或者把它放在 if、for、while 后面。')
      if (t.text === '@') fail('syntax', at, '这是 Python 风格的写法。', '切换到 Python 风格，或者改写成 HIP 风格。')
    }
    if (t.kind === 'name') {
      switch (t.text) {
        case 'if':
          return [ifStmt()]
        case 'for':
          return [forStmt()]
        case 'while':
          return [whileStmt()]
        case '__shared__':
          return [sharedDecl()]
        case 'const':
        case 'int':
        case 'float':
        case 'bool':
          return declaration()
        case 'return':
          fail('syntax', at, 'HIP Lite 不支持 return。', '想让一部分线程什么都不做，把后面的代码放进 if (i < n) { … } 里。')
        case 'break':
        case 'continue':
          fail('syntax', at, `HIP Lite 不支持 ${t.text}。`, '改写循环的条件，或者用 if 包住不想执行的部分。')
        case 'else':
          fail('syntax', at, '这个 else 前面没有对应的 if。', '检查 if 后面的 { } 是不是配对，if (…) 后面是不是多了分号。')
        case 'do':
        case 'switch':
        case 'case':
        case 'goto':
          fail('syntax', at, `HIP Lite 不支持 ${t.text}。`, '用 if / else、for、while 来写。')
        case 'elif':
          fail('syntax', at, 'HIP 里没有 elif。', '写成 else if (…) { … }。')
        case 'def':
        case 'pass':
          fail('syntax', at, `「${t.text}」是 Python 的写法。`, t.text === 'pass' ? 'HIP 里什么都不做就写一对空的 { }。' : '切换到 Python 风格，或者改写成 HIP 风格。')
      }
      if (OTHER_TYPES[t.text] === true || (ts.peek(1).kind === 'name' && KEYWORDS[t.text] !== true)) return declaration()
    }
    const s = simple()
    semicolon()
    return [s]
  }

  function declaration(): RawStmt[] {
    const readonly = ts.accept('const') !== null
    const typeTok = ts.peek()
    const type = typeName('变量')
    const out: RawStmt[] = []
    do {
      if (ts.is('*')) fail('syntax', locOf(ts.peek()), 'HIP Lite 不支持指针变量。', '数组只能是 kernel 的参数或 __shared__ 数组。')
      const name = identifier('变量名')
      if (ts.is('[')) {
        fail('syntax', locOf(ts.peek()), 'HIP Lite 不支持在 kernel 里声明普通数组。', 'block 里的线程要共用的数组，写成 __shared__ float s[64];。')
      }
      if (!ts.is('=')) {
        if (ts.is(';') || ts.is(',')) fail('syntax', after(name), `声明「${name.text}」时要给一个初值。`, `写成 ${typeTok.text} ${name.text} = 0;。`)
        unexpected(ts.peek(), '等号「=」', `写成 ${typeTok.text} ${name.text} = …;。`)
      }
      ts.next()
      out.push({ kind: 'decl', type, readonly, name: name.text, init: expression(), loc: locOf(name) })
    } while (ts.accept(',') !== null)
    semicolon()
    return out
  }

  function sharedDecl(): RawStmt {
    ts.next()
    const typeTok = ts.peek()
    const elem = typeName('共享数组元素')
    if (elem === 'bool') fail('type', locOf(typeTok), '共享数组只支持 int 和 float 两种元素。', '把 bool 换成 int。')
    const name = identifier('共享数组的名字')
    if (!ts.is('[')) fail('syntax', locOf(ts.peek()), '共享数组要写上大小。', `写成 __shared__ ${typeTok.text} ${name.text}[64];。`)
    ts.next()
    const size = ts.peek()
    if (size.kind !== 'num' || size.float) {
      fail('syntax', locOf(size), '共享数组的大小要直接写一个整数，比如 64。', '大小要事先定好，不能用变量或式子。')
    }
    ts.next()
    if (ts.accept(']') === null) unexpected(ts.peek(), '右方括号「]」')
    if (ts.is('[')) fail('syntax', locOf(ts.peek()), 'HIP Lite 只支持一维数组。', '二维的数据可以摊平成一维，用 row * 宽度 + col 当下标。')
    if (ts.is('=')) fail('syntax', locOf(ts.peek()), '共享数组不能在声明时给初值。', '声明以后，让每个线程给自己负责的元素赋值。')
    semicolon()
    return { kind: 'shared', name: name.text, elem, size: size.value, sizeLoc: locOf(size), loc: locOf(name) }
  }

  function condition(kw: Token): Expr {
    if (!ts.is('(')) fail('syntax', locOf(ts.peek()), `${kw.text} 后面的条件要用括号括起来。`, `写成 ${kw.text} (条件) { … }。`)
    const open = ts.next()
    const test = expression()
    if (ts.is('=')) fail('syntax', locOf(ts.peek()), '条件里判断相等要写 ==。', '一个 = 是赋值，两个 == 才是比较。')
    closeParen(open)
    return test
  }

  function ifStmt(): RawStmt {
    const kw = ts.next()
    const test = condition(kw)
    const body = branch(kw)
    let orelse: RawStmt[] = []
    const elseTok = ts.accept('else')
    if (elseTok !== null) {
      if (ts.is('if')) {
        ts.enter(elseTok)
        orelse = [ifStmt()]
        ts.leave()
      } else {
        orelse = branch(elseTok)
      }
    }
    return { kind: 'if', test, body, orelse, loc: locOf(kw) }
  }

  function whileStmt(): RawStmt {
    const kw = ts.next()
    const test = condition(kw)
    return { kind: 'while', test, body: branch(kw), loc: locOf(kw) }
  }

  /** 整数字面量（可以带负号）的值；不是字面量时为 null。 */
  function literalValue(e: Expr): number | null {
    if (e.kind === 'num' && e.type === 'int') return e.value
    if (e.kind === 'unary' && e.op === '-') {
      const v = literalValue(e.arg)
      return v === null ? null : -v
    }
    return null
  }

  /** k <= n 记成 stop = n + 1，k >= n 记成 stop = n - 1；n 是字面量时直接算出来。 */
  function shift(e: Expr, by: 1 | -1): Expr {
    const v = literalValue(e)
    if (v !== null) return { kind: 'num', type: 'int', value: v + by, loc: e.loc }
    return { kind: 'binary', op: by > 0 ? '+' : '-', left: e, right: { kind: 'num', type: 'int', value: 1, loc: e.loc }, loc: e.loc }
  }

  function forStmt(): RawStmt {
    const kw = ts.next()
    const open = expect('(', 'for 后面要跟括号。', FOR_SHAPE)
    if (!ts.is('int')) {
      const t = ts.peek()
      if (t.kind === 'name' && (Object.hasOwn(TYPES, t.text) || OTHER_TYPES[t.text] === true)) {
        fail('type', locOf(t), '循环变量要用 int。', FOR_SHAPE)
      }
      if (t.kind === 'name' && ts.is('=', 1)) fail('syntax', locOf(t), '循环变量要在 for 里声明。', `写成 for (int ${t.text} = …; …)。`)
      fail('syntax', locOf(t), 'for 的第一部分要声明循环变量。', FOR_SHAPE)
    }
    ts.next()
    const name = identifier('循环变量')
    if (ts.is(';')) fail('syntax', after(name), `循环变量「${name.text}」要给一个起点。`, `写成 int ${name.text} = 0。`)
    expect('=', `循环变量「${name.text}」后面要写 = 起点。`, FOR_SHAPE)
    const start = expression()
    if (ts.is(',')) fail('syntax', locOf(ts.peek()), 'HIP Lite 的 for 只能有一个循环变量。', FOR_SHAPE)
    if (ts.accept(';') === null) unexpected(ts.peek(), '分号「;」', FOR_SHAPE)

    const v = ts.peek()
    if (!(v.kind === 'name' && v.text === name.text)) {
      fail('syntax', locOf(v), `for 的条件要以循环变量「${name.text}」开头。`, `比如 ${name.text} < n。`)
    }
    ts.next()
    const cmp = ts.peek()
    if (!(cmp.kind === 'op' && (cmp.text === '<' || cmp.text === '<=' || cmp.text === '>' || cmp.text === '>='))) {
      fail('syntax', locOf(cmp), 'for 的条件只支持 <、<=、>、>=。', `比如 ${name.text} < n。`)
    }
    ts.next()
    const bound = additive()
    if (ts.is('&&') || ts.is('||')) fail('syntax', locOf(ts.peek()), 'for 的条件只能写一个比较。', '条件更复杂的循环，请改用 while。')
    if (ts.accept(';') === null) unexpected(ts.peek(), '分号「;」', FOR_SHAPE)

    const step = update(name)
    closeParen(open)

    const up = cmp.text === '<' || cmp.text === '<='
    const stepValue = literalValue(step)
    if (stepValue !== null && stepValue !== 0 && stepValue > 0 !== up) {
      fail(
        'syntax',
        locOf(cmp),
        up
          ? `${name.text} 每一轮都在变小，条件却是 ${name.text} ${cmp.text} …，这个循环停不下来。`
          : `${name.text} 每一轮都在变大，条件却是 ${name.text} ${cmp.text} …，这个循环停不下来。`,
        up ? '往下数的循环，条件写成 > 或 >=。' : '往上数的循环，条件写成 < 或 <=。',
      )
    }
    const stop = cmp.text === '<=' ? shift(bound, 1) : cmp.text === '>=' ? shift(bound, -1) : bound
    const body = branch(kw)
    return { kind: 'for', name: name.text, nameLoc: locOf(name), start, stop, step, dir: up ? 'up' : 'down', body, loc: locOf(kw) }
  }

  /** for 的第三部分：k++、k--、k += s、k -= s、k = k + s、k = k - s。返回步长。 */
  function update(name: Token): Expr {
    const one = (t: Token, value: 1 | -1): Expr => ({ kind: 'num', type: 'int', value, loc: locOf(t) })
    const negate = (e: Expr, t: Token): Expr => ({ kind: 'unary', op: '-', arg: e, loc: locOf(t) })
    const loopVar = () => {
      const t = ts.peek()
      if (!(t.kind === 'name' && t.text === name.text)) {
        fail('syntax', locOf(t), `for 的第三部分要改循环变量「${name.text}」。`, `比如 ${name.text}++。`)
      }
      ts.next()
    }
    const pre = ts.peek()
    if (pre.text === '++' || pre.text === '--') {
      ts.next()
      loopVar()
      return one(pre, pre.text === '++' ? 1 : -1)
    }
    loopVar()
    const op = ts.peek()
    if (op.text === '++' || op.text === '--') {
      ts.next()
      return one(op, op.text === '++' ? 1 : -1)
    }
    if (op.text === '+=' || op.text === '-=') {
      ts.next()
      const s = expression()
      return op.text === '+=' ? s : negate(s, op)
    }
    if (op.text === '=') {
      ts.next()
      const rhs = expression()
      if (rhs.kind === 'binary' && (rhs.op === '+' || rhs.op === '-') && rhs.left.kind === 'name' && rhs.left.name === name.text) {
        return rhs.op === '+' ? rhs.right : negate(rhs.right, op)
      }
    }
    fail('syntax', locOf(op), `for 的第三部分只支持 ${name.text}++、${name.text}--、${name.text} += 步长、${name.text} -= 步长。`, '每一轮乘 2、除以 2 这样的循环，请改用 while。')
  }

  function assignTarget(lhs: Expr, op: Token): NameExpr | IndexExpr {
    if (lhs.kind === 'name' || lhs.kind === 'index') return lhs
    if (lhs.kind === 'builtin') fail('syntax', lhs.loc, `${lhs.name} 是内建变量，只能读，不能改。`, '需要改的话，先把它存进自己的变量。')
    fail('syntax', locOf(op), `「${op.text}」左边要是一个变量或数组元素。`, '比如 x = …; 或 a[i] = …;。')
  }

  function stepBy(target: NameExpr | IndexExpr, op: Token): RawStmt {
    const one: Expr = { kind: 'num', type: 'int', value: 1, loc: locOf(op) }
    const value: Expr = { kind: 'binary', op: op.text === '++' ? '+' : '-', left: target, right: one, loc: locOf(op) }
    return { kind: 'assign', target, value, loc: target.loc }
  }

  /** 赋值、i++、函数调用这类简单语句（不含分号）。 */
  function simple(): RawStmt {
    const t = ts.peek()
    if (t.kind === 'op' && (t.text === '++' || t.text === '--')) {
      ts.next()
      return stepBy(assignTarget(unary(), t), t)
    }
    if (t.kind === 'name' && ts.is('(', 1)) return call()
    const lhs = expression()
    const op = ts.peek()
    if (op.kind === 'op' && Object.hasOwn(ASSIGN_OPS, op.text)) {
      const target = assignTarget(lhs, op)
      ts.next()
      const rhs = expression()
      if (ts.is('=')) fail('syntax', locOf(ts.peek()), 'HIP Lite 不支持连续赋值（a = b = 0）。', '分成两句写。')
      const bin = ASSIGN_OPS[op.text]
      const value: Expr = bin === null ? rhs : { kind: 'binary', op: bin, left: target, right: rhs, loc: locOf(op) }
      return { kind: 'assign', target, value, loc: target.loc }
    }
    if (op.kind === 'op' && (op.text === '++' || op.text === '--')) {
      const target = assignTarget(lhs, op)
      ts.next()
      return stepBy(target, op)
    }
    if (op.text === ';' || op.text === '}' || op.kind === 'eof' || op.line > ts.prev().line) {
      if (lhs.kind === 'binary' && lhs.op === '==') fail('syntax', lhs.loc, '这一句只是比较，没有赋值。', '赋值只写一个 =，比如 x = 0;。')
      fail('syntax', lhs.loc, '这一句算出了一个值，但没有存到任何地方。', '要保存结果就写成 x = …;。')
    }
    unexpected(op, '分号「;」')
  }

  function call(): RawStmt {
    const fn = ts.next()
    const open = ts.next()
    if (fn.text === '__syncthreads') {
      if (!ts.is(')')) fail('syntax', locOf(ts.peek()), '__syncthreads() 不需要参数。', '写成 __syncthreads();。')
      ts.next()
      return { kind: 'sync', loc: locOf(fn) }
    }
    if (fn.text === 'atomicAdd') {
      const shape = '写成 atomicAdd(&a[i], v);。'
      if (ts.accept('&') === null) fail('syntax', locOf(ts.peek()), 'atomicAdd 的第一个参数要写成 &a[i]。', shape)
      const arr = ts.peek()
      if (arr.kind !== 'name' || !ts.is('[', 1)) fail('syntax', locOf(arr), 'atomicAdd 的第一个参数要写成 &a[i]。', shape)
      ts.next()
      ts.next()
      const index = expression()
      if (ts.accept(']') === null) unexpected(ts.peek(), '右方括号「]」')
      expect(',', 'atomicAdd 要写两个参数：要加到哪里、加多少。', shape)
      const value = expression()
      closeParen(open)
      return { kind: 'atomic', op: 'add', array: arr.text, arrayLoc: locOf(arr), index, value, loc: locOf(fn) }
    }
    callError(fn)
  }

  function callError(fn: Token): never {
    const at = locOf(fn)
    switch (fn.text) {
      case 'syncthreads':
        fail('syntax', at, 'HIP 里同步写成 __syncthreads()。', '前面加两个下划线：__syncthreads();。')
      case 'atomic_add':
        fail('syntax', at, 'HIP 里原子加写成 atomicAdd。', '写成 atomicAdd(&a[i], v);。')
      case 'shared':
        fail('syntax', at, 'HIP 里共享数组写成 __shared__ float s[64];。', '把这一行改成 __shared__ 声明，放在 kernel 开头。')
      case 'range':
        fail('syntax', at, 'HIP 里没有 range。', FOR_SHAPE)
      case 'printf':
      case 'print':
        fail('syntax', at, '模拟器里不能打印。', '想看变量怎么变，用单步执行。')
      case 'static_cast':
        fail('syntax', at, 'HIP Lite 不支持 static_cast。', '类型转换写成 (int)x 或 (float)x。')
    }
    if (fn.text.startsWith('atomic')) fail('syntax', at, `HIP Lite 只支持 atomicAdd，不支持 ${fn.text}。`, '用 atomicAdd(&a[i], v) 来写。')
    const guess = closestName(fn.text, ['__syncthreads', 'atomicAdd'])
    fail(
      'syntax',
      at,
      `不认识函数「${fn.text}」。`,
      guess ? `是不是想写「${guess}」？` : 'HIP Lite 能调用的只有 __syncthreads() 和 atomicAdd(&a[i], v)；类型转换写成 (int)x、(float)x。',
    )
  }

  // ── 表达式：优先级从低到高 ──────────────────────────────────────────────

  function expression(): Expr {
    ts.enter(ts.peek())
    const e = ternary()
    ts.leave()
    return e
  }

  function ternary(): Expr {
    const test = logicalOr()
    const q = ts.accept('?')
    if (q === null) return test
    const body = expression()
    if (ts.accept(':') === null) unexpected(ts.peek(), '冒号「:」', '条件表达式写成 条件 ? 值1 : 值2。')
    return { kind: 'cond', test, body, orelse: expression(), loc: locOf(q) }
  }

  /** 左结合的一层二元运算。每多一个运算符算一层嵌套，长式子会被上限挡住，后面递归处理语法树时不会爆栈。 */
  function chain(next: () => Expr, ops: Record<string, BinaryOp>): Expr {
    let left = next()
    let levels = 0
    for (;;) {
      const t = ts.peek()
      if (t.kind !== 'op' || !Object.hasOwn(ops, t.text)) break
      ts.next()
      if (t.text === '*' && ts.is('*')) fail('syntax', locOf(t), 'HIP 里没有 ** 乘方运算。', '平方写成 x * x。')
      ts.enter(t)
      levels++
      left = { kind: 'binary', op: ops[t.text], left, right: next(), loc: locOf(t) }
    }
    for (; levels > 0; levels--) ts.leave()
    return left
  }

  /** 比较只能写一次：a < b < c 在 C++ 里的意思和数学上不一样。 */
  function comparison(next: () => Expr, ops: Record<string, BinaryOp>): Expr {
    const left = next()
    const t = ts.peek()
    if (t.kind !== 'op' || !Object.hasOwn(ops, t.text)) return left
    ts.next()
    const node: Expr = { kind: 'binary', op: ops[t.text], left, right: next(), loc: locOf(t) }
    const again = ts.peek()
    if (again.kind === 'op' && Object.hasOwn(ops, again.text)) {
      fail('syntax', locOf(again), '比较不能连着写（像 a < b < c）。', '拆成两个比较，写成 a < b && b < c。')
    }
    return node
  }

  const logicalOr = (): Expr => chain(logicalAnd, { '||': 'or' })
  const logicalAnd = (): Expr => chain(equality, { '&&': 'and' })
  const equality = (): Expr => comparison(relational, { '==': '==', '!=': '!=' })
  const relational = (): Expr => comparison(additive, { '<': '<', '<=': '<=', '>': '>', '>=': '>=' })
  const additive = (): Expr => chain(multiplicative, { '+': '+', '-': '-' })
  const multiplicative = (): Expr => chain(unary, { '*': '*', '/': '/', '%': '%' })

  function unary(): Expr {
    const t = ts.peek()
    const at = locOf(t)
    if (t.kind === 'op') {
      switch (t.text) {
        case '-':
        case '!':
        case '+': {
          ts.next()
          ts.enter(t)
          const arg = unary()
          ts.leave()
          if (t.text === '+') return arg
          return { kind: 'unary', op: t.text === '-' ? '-' : 'not', arg, loc: at }
        }
        case '++':
        case '--':
          fail('syntax', at, `${t.text} 只能单独写成一句。`, `比如 i${t.text};，不要写在式子中间。`)
        case '&':
          fail('syntax', at, '「&」只能用在 atomicAdd(&a[i], v) 里。', 'HIP Lite 不支持取地址和指针。')
        case '*':
          fail('syntax', at, 'HIP Lite 不支持指针（*p）。', '数组元素写成 a[i]。')
        case '~':
          unexpected(t, '一个数或名字')
        case '(': {
          const typeTok = ts.peek(1)
          if (typeTok.kind === 'name' && (Object.hasOwn(TYPES, typeTok.text) || OTHER_TYPES[typeTok.text] === true)) {
            ts.next()
            const type = typeName('转换')
            if (ts.is('*')) fail('syntax', locOf(ts.peek()), 'HIP Lite 不支持指针类型的转换。', '只能转换成 int、float 或 bool。')
            closeParen(t)
            ts.enter(t)
            const arg = unary()
            ts.leave()
            return { kind: 'cast', type, arg, loc: at }
          }
        }
      }
    }
    if (t.kind === 'name' && t.text === 'not') fail('syntax', at, 'HIP 里不用「not」。', '「不是」写成 !。')
    return primary()
  }

  function builtin(base: Token): Expr {
    if (!ts.is('.')) fail('syntax', after(base), `${base.text} 后面要加 .x。`, `写成 ${base.text}.x。`)
    ts.next()
    const m = ts.peek()
    if (m.kind === 'name' && (m.text === 'y' || m.text === 'z')) {
      const dim = m.text === 'y' ? '第二维' : '第三维'
      fail('syntax', locOf(base), `${base.text}.${m.text} 是${dim}的写法，后面的关卡再讲。`, `这一关的数据排成一行，只用 ${base.text}.x。`)
    }
    if (!(m.kind === 'name' && m.text === 'x')) {
      fail('syntax', locOf(m), `${base.text} 后面只能接 .x。`, `写成 ${base.text}.x（.y、.z 后面的关卡再讲）。`)
    }
    ts.next()
    if (ts.is('[')) fail('type', locOf(ts.peek()), `${base.text}.x 是一个数，后面不能加 [ ]。`, '只有数组参数和共享数组才能写成 a[i]。')
    return { kind: 'builtin', name: `${base.text}.x` as Builtin, loc: locOf(base) }
  }

  function primary(): Expr {
    const t = ts.peek()
    const at = locOf(t)
    if (t.kind === 'num') {
      ts.next()
      return { kind: 'num', type: t.float ? 'float' : 'int', value: t.value, loc: at }
    }
    if (t.kind === 'op' && t.text === '(') {
      ts.next()
      const inner = expression()
      closeParen(t)
      return inner
    }
    if (t.kind !== 'name') {
      if (t.kind === 'eof') unexpected(t, '一个数或名字')
      foreign(t)
      fail('syntax', at, `「${t.text}」前面还缺一个数或名字。`, '检查这里是不是漏写了什么。')
    }
    ts.next()
    if (t.text === 'true' || t.text === 'false') return { kind: 'bool', value: t.text === 'true', loc: at }
    if (Object.hasOwn(TYPES, t.text) && ts.is('(')) {
      const open = ts.next()
      const arg = expression()
      if (ts.is(',')) fail('syntax', locOf(ts.peek()), '类型转换只能有一个参数。', `写成 ${t.text}(x)。`)
      closeParen(open)
      return { kind: 'cast', type: TYPES[t.text], arg, loc: at }
    }
    if (BUILTIN_BASES.includes(t.text)) return builtin(t)
    if (ts.is('.')) {
      const guess = closestName(t.text, BUILTIN_BASES)
      if (guess) fail('syntax', at, `不认识「${t.text}」。`, `是不是想写「${guess}.x」？`)
      fail('syntax', at, `「${t.text}」后面不能接「.」。`, '只有 blockIdx、blockDim、threadIdx、gridDim 后面能接 .x。')
    }
    if (ts.is('(')) {
      if (t.text === '__syncthreads' || t.text === 'atomicAdd') fail('syntax', at, `${t.text}(…) 要单独写成一句。`, '它不算出值，不能放在式子里。')
      callError(t)
    }
    if (KEYWORDS[t.text] === true) fail('syntax', at, `「${t.text}」是关键字，不能放在式子里。`, '检查这一行的写法。')
    if (!ts.is('[')) return { kind: 'name', name: t.text, loc: at }
    ts.next()
    const index = expression()
    if (ts.accept(']') === null) unexpected(ts.peek(), '右方括号「]」')
    if (ts.is('[')) fail('syntax', locOf(ts.peek()), 'HIP Lite 只支持一维数组，下标只能写一个。', '二维的数据可以摊平成一维，用 row * 宽度 + col 当下标。')
    return { kind: 'index', array: t.text, index, loc: at }
  }

  const { signature, ...raw } = kernel()
  return { raw, signature }
}

/** 解析 HIP Lite 程序。出错时返回第一个错误（中文，带行列号）。 */
export function parseHip(source: string): ParseResult {
  try {
    const src = normalizeNewlines(source)
    checkSourceSize(src)
    const { tokens, comments } = tokenize(src)
    const { raw, signature } = parseTokens(tokens, comments)
    return { ok: true, kernel: check(raw, 'hip'), signature }
  } catch (err) {
    if (err instanceof SimFailure) return { ok: false, error: err.error }
    throw err
  }
}
