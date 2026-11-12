/**
 * Py Lite：线程视角的 Python 写法（08 第 3 节），解析成 ast.ts 里两种写法共用的语法树。
 *
 * 支持：@kernel + def 定义一个 kernel；变量直接赋值（类型由第一次赋值决定）；+ - * / // %、比较、
 * and or not、值1 if 条件 else 值2；if / elif / else、for k in range(…)、while；a[i] 读写；
 * s = shared(64) 或 shared(64, int)；syncthreads()；atomic_add(a, i, v)；int(x)、float(x)。
 * 缩进规则同 Python；括号里可以换行。常见的写错（漏冒号、缩进、HIP 写法、.y / .z……）都给出中文提示。
 */
import { BUILTIN_BASES, type BinaryOp, type Builtin, type ElemType, type Expr, type IndexExpr, type NameExpr, type ParamSig, type ParseResult, type ScalarType } from './ast.ts'
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
  type TokenKind,
} from './lex.ts'

const OPS = [
  '//=', '**=', '>>=', '<<=', '//', '**', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '->', ':=', '&&', '||',
  '++', '--', '<<', '>>', '&=', '|=', '^=', '+', '-', '*', '/', '%', '=', '<', '>', '(', ')', '[', ']', '{', '}', ',',
  ':', ';', '.', '@', '!', '&', '|', '^', '~', '?',
] as const

const OPEN_BRACKET: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSE_BRACKET: Record<string, true> = { ')': true, ']': true, '}': true }

const KEYWORDS: Record<string, true> = {
  False: true, None: true, True: true, and: true, as: true, assert: true, async: true, await: true, break: true,
  class: true, continue: true, def: true, del: true, elif: true, else: true, except: true, finally: true, for: true,
  from: true, global: true, if: true, import: true, in: true, is: true, lambda: true, nonlocal: true, not: true,
  or: true, pass: true, raise: true, return: true, try: true, while: true, with: true, yield: true,
}

/** Py Lite 不支持的语句关键字。 */
const UNSUPPORTED: Record<string, true> = {
  try: true, with: true, class: true, lambda: true, global: true, nonlocal: true, del: true, raise: true,
  assert: true, yield: true, async: true, await: true,
}

/** C 的类型名：读者在 Python 风格里写 int i = 0 时提醒不用写类型。 */
const C_TYPES: Record<string, true> = { int: true, float: true, bool: true, double: true, const: true, unsigned: true, auto: true }

const ASSIGN_OPS: Record<string, BinaryOp | null> = {
  '=': null, '+=': '+', '-=': '-', '*=': '*', '/=': '/', '//=': '//', '%=': '%',
}

const COMPARE: Record<string, BinaryOp> = { '<': '<', '<=': '<=', '>': '>', '>=': '>=', '==': '==', '!=': '!=' }

const BITWISE: Record<string, true> = {
  '<<': true, '>>': true, '&': true, '|': true, '^': true, '~': true, '<<=': true, '>>=': true, '&=': true, '|=': true, '^=': true,
}

const FOR_SHAPE = '写成 for k in range(n):'

/** Python 的记号：除了普通记号，还有换行、缩进、取消缩进；括号里的换行不算。 */
function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  const indents = [0]
  let indentChar = ''
  const brackets: Token[] = []
  let i = 0
  let line = 1
  let lineStart = 0
  let lineHasTokens = false
  let atLineStart = true
  const push = (kind: TokenKind, text: string, col: number, value = 0, float = false) => {
    tokens.push({ kind, text, line, col, value, float })
    if (kind !== 'indent' && kind !== 'dedent' && kind !== 'newline') lineHasTokens = true
  }
  while (i < src.length) {
    if (atLineStart) {
      atLineStart = false
      let j = i
      while (src[j] === ' ' || src[j] === '\t') j++
      // 空行和只有注释的行不影响缩进
      if (j >= src.length || src[j] === '\n' || src[j] === '#') {
        i = j
        continue
      }
      for (let k = i; k < j; k++) {
        if (indentChar === '') indentChar = src[k]
        else if (src[k] !== indentChar) {
          fail('syntax', { line, col: k - lineStart + 1 }, '缩进里混用了 Tab 和空格。', '统一用空格缩进，每一层 4 个空格。')
        }
      }
      const width = j - i
      if (width > indents[indents.length - 1]) {
        indents.push(width)
        push('indent', '', width + 1)
      } else {
        while (width < indents[indents.length - 1]) {
          indents.pop()
          push('dedent', '', width + 1)
        }
        if (width !== indents[indents.length - 1]) {
          fail('syntax', { line, col: width + 1 }, '这一行的缩进和前面的代码对不上。', '让它和同一层的代码左边对齐。')
        }
      }
      i = j
      continue
    }
    const ch = src[i]
    const at = { line, col: i - lineStart + 1 }
    if (ch === '\n') {
      if (brackets.length === 0 && lineHasTokens) {
        push('newline', '', at.col)
        lineHasTokens = false
      }
      line++
      i++
      lineStart = i
      atLineStart = brackets.length === 0
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\f') {
      i++
      continue
    }
    if (ch === '#') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '\\') fail('syntax', at, '模拟器不支持用「\\」把一行接到下一行。', '长的式子可以放在括号里分几行写。')
    if (ch === '"' || ch === "'") stringError(at)
    if (isDigit(ch) || (ch === '.' && isDigit(src[i + 1] ?? ''))) {
      const n = scanNumber(src, i, at, 'python')
      push('num', src.slice(i, n.end), at.col, n.value, n.float)
      i = n.end
      continue
    }
    if (isNameStart(ch)) {
      let j = i + 1
      while (j < src.length && isNameChar(src[j])) j++
      push('name', src.slice(i, j), at.col)
      i = j
      continue
    }
    const op = matchOp(src, i, OPS)
    if (op === null) badChar(ch, at)
    push('op', op, at.col)
    i += op.length
    // 括号要在这里配对：没配上的括号会把后面几行连成一行，到了解析时就很难说清错在哪
    const token = tokens[tokens.length - 1]
    if (Object.hasOwn(OPEN_BRACKET, op)) brackets.push(token)
    else if (CLOSE_BRACKET[op] === true) {
      const open = brackets.pop()
      if (open === undefined) fail('syntax', at, `多了一个「${op}」。`, '删掉它，或者在前面补上配对的左括号。')
      if (OPEN_BRACKET[open.text] !== op) {
        fail('syntax', at, `「${op}」和第 ${open.line} 行第 ${open.col} 列的「${open.text}」配不上。`, `那里的「${open.text}」要用「${OPEN_BRACKET[open.text]}」来配对。`)
      }
    }
  }
  const unclosed = brackets.pop()
  if (unclosed !== undefined) {
    fail('syntax', locOf(unclosed), `这个「${unclosed.text}」一直没有配对的「${OPEN_BRACKET[unclosed.text]}」。`, `在式子结束的地方补上「${OPEN_BRACKET[unclosed.text]}」。`)
  }
  const endCol = i - lineStart + 1
  if (lineHasTokens) push('newline', '', endCol)
  while (indents.length > 1) {
    indents.pop()
    push('dedent', '', 1)
  }
  push('eof', '', endCol)
  return tokens
}

function parseTokens(tokens: Token[]): RawKernel {
  const ts = new TokenStream(tokens)

  /** 别的语言里的写法、Py Lite 不支持的运算符：给专门的提示。其他记号什么都不做。 */
  function foreign(t: Token) {
    const at = locOf(t)
    if (t.kind === 'op') {
      switch (t.text) {
        case '&&':
          fail('syntax', at, 'Python 里不用 &&。', '「并且」写成 and。')
        case '||':
          fail('syntax', at, 'Python 里不用 ||。', '「或者」写成 or。')
        case '!':
          fail('syntax', at, 'Python 里不用「!」表示「不是」。', '「不是」写成 not，「不等于」写成 !=。')
        case '++':
          fail('syntax', at, 'Python 没有 ++。', '加 1 写成 i += 1。')
        case '--':
          fail('syntax', at, 'Python 没有 --。', '减 1 写成 i -= 1。')
        case '{':
        case '}':
          fail('syntax', at, 'Python 不用 { } 表示代码块。', '用冒号和缩进：if 条件: 换行后多缩进 4 个空格。')
        case '?':
          fail('syntax', at, 'Python 的条件表达式不用 ? :。', '写成 值1 if 条件 else 值2。')
        case '**':
        case '**=':
          fail('syntax', at, 'Py Lite 不支持 ** 乘方。', '平方写成 x * x。')
        case ':=':
          fail('syntax', at, 'Py Lite 不支持 :=。', '先单独写一行赋值。')
      }
      if (BITWISE[t.text] === true) {
        const shift = t.text.startsWith('<<') || t.text.startsWith('>>')
        fail('syntax', at, `Py Lite 不支持位运算「${t.text}」。`, shift ? '乘以 2 写成 * 2，整除 2 写成 // 2。' : '改用 + - * // % 和比较来写。')
      }
    }
    if (t.kind === 'name' && (t.text === 'in' || t.text === 'is')) {
      fail('syntax', at, `Py Lite 不支持「${t.text}」。`, '用 ==、!=、<、> 来比较。')
    }
  }

  /** 读到一个不该出现的记号：常见的写错给专门的提示，其余的说明这里本来应该是什么。 */
  function unexpected(t: Token, expected: string, hint = '检查这一行的写法。'): never {
    const at = locOf(t)
    switch (t.kind) {
      case 'eof':
        fail('syntax', at, `代码没写完就结束了，这里还缺${expected}。`, '检查最后几行有没有写完。')
      case 'newline':
        fail('syntax', at, `这一行没写完，行末还缺${expected}。`, hint)
      case 'indent':
        fail('syntax', at, '这一行多缩进了。', '和上一行的左边对齐。')
      case 'dedent':
        fail('syntax', at, `缩进提前结束了，这里还缺${expected}。`, hint)
    }
    foreign(t)
    if (t.kind === 'name' || t.kind === 'num') {
      fail('syntax', at, `「${t.text}」前面少了运算符。`, '两个值之间要有运算符，比如 + 或 *；两句要分成两行写。')
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

  /** if、for、while、def 这一行末尾的冒号。 */
  function colon(kw: Token) {
    if (ts.accept(':') !== null) return
    const t = ts.peek()
    if (t.kind === 'newline' || t.kind === 'eof') {
      fail('syntax', after(ts.prev()), `「${kw.text}」这一行的末尾少了冒号「:」。`, 'Python 的 if、elif、else、for、while、def 这一行都要以冒号结尾。')
    }
    if (t.kind === 'op' && t.text === '{') fail('syntax', locOf(t), 'Python 不用 { } 表示代码块。', '把「{」换成冒号「:」，下一行多缩进 4 个空格。')
    unexpected(t, '冒号「:」')
  }

  function identifier(what: string): Token {
    const t = ts.peek()
    if (t.kind !== 'name') unexpected(t, what)
    if (KEYWORDS[t.text] === true) fail('syntax', locOf(t), `「${t.text}」是 Python 的关键字，不能当${what}。`, '换一个名字。')
    return ts.next()
  }

  function file(): RawKernel {
    const first = ts.peek()
    const at = locOf(first)
    if (first.kind === 'eof') fail('syntax', at, '还没有写代码。', '先写一个 kernel：第一行 @kernel，第二行 def 名字(参数):')
    if (first.kind === 'indent') fail('syntax', at, '第一行不要缩进。', '让 @kernel 顶格写。')
    if (!ts.is('@')) {
      if (ts.is('def')) fail('syntax', at, 'def 上面要加一行 @kernel。', '@kernel 告诉模拟器：这个函数是 kernel，每个线程都会运行它。')
      if (ts.is('import') || ts.is('from')) fail('syntax', at, '这里不需要 import。', '模拟器已经认识 blockIdx、syncthreads 这些名字，直接从 @kernel 开始写。')
      if (ts.is('__global__')) fail('syntax', at, '这是 HIP 风格的写法。', '切换到 HIP 风格，或者改写成 Python 风格（@kernel 和 def）。')
      fail('syntax', at, '代码要从 @kernel 开始。', '第一行写 @kernel，第二行写 def 名字(参数):')
    }
    ts.next()
    if (!(ts.is('kernel') && ts.peek(1).kind === 'newline')) {
      fail('syntax', at, 'kernel 上面要单独写一行 @kernel。', 'Python 风格统一写 @kernel，不用 @cuda.jit 这类写法。')
    }
    ts.next()
    ts.next()
    if (ts.peek().kind === 'indent') fail('syntax', locOf(ts.peek()), 'def 要和 @kernel 左边对齐。', '去掉 def 前面的空格。')
    const def = expect('def', '@kernel 下面要写 def。', '写成 def 名字(参数):')
    const name = identifier('kernel 的名字')
    const open = expect('(', 'kernel 的名字后面要跟参数列表「(」。', '写成 def 名字(a, n):')
    const params: RawParam[] = []
    while (!ts.is(')')) {
      const p = ts.peek()
      if (p.kind === 'op' && (p.text === '*' || p.text === '**')) fail('syntax', locOf(p), 'kernel 的参数只写名字。', '比如 def f(a, n):')
      const pn = identifier('参数名')
      if (ts.is(':')) fail('syntax', locOf(ts.peek()), '参数只写名字，不用写类型。', `把「${pn.text}: …」改成「${pn.text}」。`)
      if (ts.is('=')) fail('syntax', locOf(ts.peek()), '参数不能有默认值。', `只写 ${pn.text}。`)
      params.push({ name: pn.text, loc: locOf(pn), decl: null })
      if (ts.accept(',') === null) break
    }
    if (ts.peek().kind === 'name') fail('syntax', locOf(ts.peek()), '参数之间要用逗号「,」隔开。', '比如 def f(a, n):')
    closeParen(open)
    if (ts.is('->')) fail('syntax', locOf(ts.peek()), 'kernel 不用写返回类型。', '去掉「-> …」。')
    colon(def)
    const body = suite(def)
    const rest = ts.peek()
    if (rest.kind !== 'eof') fail('syntax', locOf(rest), 'kernel 结束以后不能再写别的代码。', '沙盒里只写一个 kernel；检查最后几行的缩进。')
    return { name: name.text, params, body, loc: locOf(name) }
  }

  /** 冒号后面的代码：换行后缩进的一段，或者写在同一行的简单语句。 */
  function suite(kw: Token): RawStmt[] {
    if (ts.peek().kind !== 'newline') {
      ts.enter(kw)
      const out = simpleLine()
      ts.leave()
      return out
    }
    ts.next()
    const indent = ts.peek()
    if (indent.kind !== 'indent') fail('syntax', locOf(indent), `「${kw.text}」下面的代码要缩进。`, '在下一行行首多加 4 个空格。')
    ts.next()
    ts.enter(indent)
    const out: RawStmt[] = []
    while (ts.peek().kind !== 'dedent' && ts.peek().kind !== 'eof') out.push(...statement())
    if (ts.peek().kind === 'dedent') ts.next()
    ts.leave()
    return out
  }

  function statement(): RawStmt[] {
    const t = ts.peek()
    const at = locOf(t)
    if (t.kind === 'indent') fail('syntax', at, '这一行多缩进了。', '和上一行的左边对齐。')
    if (t.kind === 'op' && t.text === '@') fail('syntax', at, 'kernel 里面不能再写 @。', '每个程序只有一个 kernel。')
    if (t.kind === 'name') {
      switch (t.text) {
        case 'if':
          return [ifStmt()]
        case 'for':
          return [forStmt()]
        case 'while':
          return [whileStmt()]
        case 'elif':
        case 'else':
          fail('syntax', at, `这个 ${t.text} 前面没有对应的 if。`, `检查 ${t.text} 和 if 是不是左边对齐。`)
        case 'def':
          fail('syntax', at, 'kernel 里面不能再定义函数。', '把要用的计算直接写进 kernel 里。')
        case 'return':
          fail('syntax', at, 'Py Lite 不支持 return。', '想让一部分线程什么都不做，把后面的代码放进 if i < n: 下面。')
        case 'break':
        case 'continue':
          fail('syntax', at, `Py Lite 不支持 ${t.text}。`, '改写循环的条件，或者用 if 包住不想执行的部分。')
        case 'import':
        case 'from':
          fail('syntax', at, '这里不需要 import。', '模拟器已经认识 blockIdx、syncthreads 这些名字。')
      }
      if (UNSUPPORTED[t.text] === true) fail('syntax', at, `Py Lite 不支持 ${t.text}。`, '只用赋值、if、for、while 来写。')
    }
    return simpleLine()
  }

  function ifStmt(): RawStmt {
    const kw = ts.next()
    const test = expression()
    if (ts.is('=')) fail('syntax', locOf(ts.peek()), '条件里判断相等要写 ==。', '一个 = 是赋值，两个 == 才是比较。')
    colon(kw)
    const body = suite(kw)
    let orelse: RawStmt[] = []
    const next = ts.peek()
    if (next.kind === 'name' && next.text === 'elif') {
      ts.enter(next)
      orelse = [ifStmt()]
      ts.leave()
    } else if (next.kind === 'name' && next.text === 'else') {
      ts.next()
      if (ts.is('if')) fail('syntax', locOf(next), 'Python 里写 elif，不写 else if。', '把 else if 改成 elif。')
      colon(next)
      orelse = suite(next)
    }
    return { kind: 'if', test, body, orelse, loc: locOf(kw) }
  }

  function forStmt(): RawStmt {
    const kw = ts.next()
    if (ts.is('(')) fail('syntax', locOf(ts.peek()), 'Python 的 for 不用括号。', FOR_SHAPE)
    const name = identifier('循环变量')
    if (ts.is(',')) fail('syntax', locOf(ts.peek()), 'for 后面只能写一个循环变量。', FOR_SHAPE)
    if (ts.accept('in') === null) unexpected(ts.peek(), '「in」', FOR_SHAPE)
    const r = ts.peek()
    if (!(r.kind === 'name' && r.text === 'range' && ts.is('(', 1))) {
      fail('syntax', locOf(r), 'for 只能配合 range 使用。', '要遍历数组，就用下标：for k in range(n): 里面读 a[k]。')
    }
    ts.next()
    const open = ts.next()
    const args: Expr[] = []
    while (!ts.is(')')) {
      args.push(expression())
      if (ts.accept(',') === null) break
    }
    closeParen(open)
    if (args.length === 0) fail('syntax', locOf(r), 'range 里至少要写终点。', '比如 range(n)。')
    if (args.length > 3) fail('syntax', locOf(r), 'range 最多写三个数：起点、终点、步长。', '比如 range(0, n, 2)。')
    const zero: Expr = { kind: 'num', type: 'int', value: 0, loc: locOf(r) }
    const one: Expr = { kind: 'num', type: 'int', value: 1, loc: locOf(r) }
    const start = args.length === 1 ? zero : args[0]
    const stop = args.length === 1 ? args[0] : args[1]
    const step = args.length === 3 ? args[2] : one
    colon(kw)
    const body = suite(kw)
    return { kind: 'for', name: name.text, nameLoc: locOf(name), start, stop, step, dir: null, body, loc: locOf(kw) }
  }

  function whileStmt(): RawStmt {
    const kw = ts.next()
    const test = expression()
    if (ts.is('=')) fail('syntax', locOf(ts.peek()), '条件里判断相等要写 ==。', '一个 = 是赋值，两个 == 才是比较。')
    colon(kw)
    return { kind: 'while', test, body: suite(kw), loc: locOf(kw) }
  }

  /** 一行简单语句：可以用分号隔开几句，以换行结束。 */
  function simpleLine(): RawStmt[] {
    const out: RawStmt[] = []
    for (;;) {
      const s = simple()
      if (s !== null) out.push(s)
      if (ts.accept(';') === null || ts.peek().kind === 'newline') break
    }
    const end = ts.peek()
    if (end.kind === 'newline') {
      ts.next()
      return out
    }
    unexpected(end, '换行', '一行只写一句；两句要分成两行写。')
  }

  function assignTarget(lhs: Expr, op: Token): NameExpr | IndexExpr {
    if (lhs.kind === 'name' || lhs.kind === 'index') return lhs
    if (lhs.kind === 'builtin') fail('syntax', lhs.loc, `${lhs.name} 是内建变量，只能读，不能改。`, '需要改的话，先把它存进自己的变量。')
    fail('syntax', locOf(op), `「${op.text}」左边要是一个变量或数组元素。`, '比如 x = … 或 a[i] = …。')
  }

  /** 赋值、syncthreads()、atomic_add(…)、s = shared(…)、pass。pass 返回 null。 */
  function simple(): RawStmt | null {
    const t = ts.peek()
    const at = locOf(t)
    if (t.kind === 'name') {
      if (t.text === 'pass') {
        ts.next()
        return null
      }
      if (t.text === 'syncthreads' && ts.is('(', 1)) {
        ts.next()
        ts.next()
        if (!ts.is(')')) fail('syntax', locOf(ts.peek()), 'syncthreads() 不需要参数。', '写成 syncthreads()。')
        ts.next()
        return { kind: 'sync', loc: at }
      }
      if (t.text === 'atomic_add' && ts.is('(', 1)) return atomicAdd()
      if (ts.is('=', 1) && ts.is('shared', 2) && ts.is('(', 3)) return sharedDecl()
      if (C_TYPES[t.text] === true && ts.peek(1).kind === 'name') {
        fail('syntax', at, 'Python 风格不用写类型。', `直接写 ${ts.peek(1).text} = …。`)
      }
      if (t.text === '__shared__') fail('syntax', at, 'Python 风格里共享数组写成 s = shared(64)。', '把这一行改成 名字 = shared(大小)。')
    }
    const lhs = expression()
    const op = ts.peek()
    if (op.kind === 'op' && Object.hasOwn(ASSIGN_OPS, op.text)) {
      const target = assignTarget(lhs, op)
      ts.next()
      const rhs = expression()
      if (ts.is('=')) fail('syntax', locOf(ts.peek()), 'Py Lite 不支持连续赋值（a = b = 0）。', '分成两行写。')
      const bin = ASSIGN_OPS[op.text]
      const value: Expr = bin === null ? rhs : { kind: 'binary', op: bin, left: target, right: rhs, loc: locOf(op) }
      return { kind: 'assign', target, value, loc: target.loc }
    }
    if (op.kind === 'op' && op.text === ',') fail('syntax', locOf(op), 'Py Lite 不支持一次给几个变量赋值。', '每个变量单独写一行。')
    if (op.kind === 'newline' || (op.kind === 'op' && op.text === ';')) {
      if (lhs.kind === 'binary' && lhs.op === '==') fail('syntax', lhs.loc, '这一行只是比较，没有赋值。', '赋值只写一个 =，比如 x = 0。')
      fail('syntax', lhs.loc, '这一行算出了一个值，但没有存到任何地方。', '要保存结果就写成 x = …。')
    }
    unexpected(op, '换行')
  }

  function sharedDecl(): RawStmt {
    const name = identifier('共享数组的名字')
    ts.next()
    ts.next()
    const open = ts.next()
    const size = ts.peek()
    if (size.kind !== 'num' || size.float) {
      fail('syntax', locOf(size), '共享数组的大小要直接写一个整数，比如 64。', '大小要事先定好，不能用变量或式子。')
    }
    ts.next()
    let elem: ElemType = 'float'
    if (ts.accept(',') !== null) {
      const t = ts.peek()
      if (!(t.kind === 'name' && (t.text === 'int' || t.text === 'float'))) {
        fail('syntax', locOf(t), 'shared 的第二个参数是元素类型，只能写 int 或 float。', '比如 shared(64, int)；不写就是 float。')
      }
      ts.next()
      elem = t.text === 'int' ? 'int' : 'float'
    }
    closeParen(open)
    return { kind: 'shared', name: name.text, elem, size: size.value, sizeLoc: locOf(size), loc: locOf(name) }
  }

  function atomicAdd(): RawStmt {
    const fn = ts.next()
    const open = ts.next()
    const shape = '写成 atomic_add(a, i, v)：数组、下标、要加的值。'
    const arr = ts.peek()
    if (!(arr.kind === 'name' && ts.is(',', 1))) {
      if (arr.kind === 'name' && ts.is('[', 1)) fail('syntax', locOf(arr), 'atomic_add 的第一个参数只写数组名，下标单独写。', shape)
      fail('syntax', locOf(arr), 'atomic_add 的第一个参数要写数组名。', shape)
    }
    ts.next()
    ts.next()
    const index = expression()
    expect(',', 'atomic_add 要写三个参数。', shape)
    const value = expression()
    closeParen(open)
    return { kind: 'atomic', op: 'add', array: arr.text, arrayLoc: locOf(arr), index, value, loc: locOf(fn) }
  }

  // ── 表达式：优先级从低到高 ──────────────────────────────────────────────

  function expression(): Expr {
    ts.enter(ts.peek())
    const e = conditional()
    ts.leave()
    return e
  }

  function conditional(): Expr {
    const body = orTest()
    const kw = ts.accept('if')
    if (kw === null) return body
    const test = orTest()
    if (ts.accept('else') === null) unexpected(ts.peek(), '「else」', '条件表达式写成 值1 if 条件 else 值2。')
    return { kind: 'cond', test, body, orelse: expression(), loc: locOf(kw) }
  }

  /** 左结合的一层二元运算。每多一个运算符算一层嵌套，长式子会被上限挡住，后面递归处理语法树时不会爆栈。 */
  function chain(next: () => Expr, ops: Record<string, BinaryOp>): Expr {
    let left = next()
    let levels = 0
    for (;;) {
      const t = ts.peek()
      if (!((t.kind === 'op' || t.kind === 'name') && Object.hasOwn(ops, t.text))) break
      ts.next()
      ts.enter(t)
      levels++
      left = { kind: 'binary', op: ops[t.text], left, right: next(), loc: locOf(t) }
    }
    for (; levels > 0; levels--) ts.leave()
    return left
  }

  const orTest = (): Expr => chain(andTest, { or: 'or' })
  const andTest = (): Expr => chain(notTest, { and: 'and' })
  const arith = (): Expr => chain(term, { '+': '+', '-': '-' })
  const term = (): Expr => chain(factor, { '*': '*', '/': '/', '//': '//', '%': '%' })

  function notTest(): Expr {
    const t = ts.peek()
    if (!(t.kind === 'name' && t.text === 'not')) return comparison()
    ts.next()
    ts.enter(t)
    const arg = notTest()
    ts.leave()
    return { kind: 'unary', op: 'not', arg, loc: locOf(t) }
  }

  /** Python 的 a < b < c 是 a < b and b < c，HIP 里却不是；为了两种写法一致，比较只能写一次。 */
  function comparison(): Expr {
    const left = arith()
    const t = ts.peek()
    if (!(t.kind === 'op' && Object.hasOwn(COMPARE, t.text))) return left
    ts.next()
    const node: Expr = { kind: 'binary', op: COMPARE[t.text], left, right: arith(), loc: locOf(t) }
    const again = ts.peek()
    if (again.kind === 'op' && Object.hasOwn(COMPARE, again.text)) {
      fail('syntax', locOf(again), '比较不能连着写（像 a < b < c）。', '拆成两个比较，写成 a < b and b < c。')
    }
    return node
  }

  function factor(): Expr {
    const t = ts.peek()
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      ts.next()
      ts.enter(t)
      const arg = factor()
      ts.leave()
      return t.text === '+' ? arg : { kind: 'unary', op: '-', arg, loc: locOf(t) }
    }
    const base = primary()
    if (ts.is('**')) unexpected(ts.peek(), '运算符')
    return base
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

  /** 式子里的函数调用：只有类型转换能算出值。 */
  function call(fn: Token): Expr {
    const at = locOf(fn)
    switch (fn.text) {
      case 'int':
      case 'float':
      case 'bool': {
        const open = ts.next()
        if (ts.is(')')) fail('syntax', locOf(ts.peek()), `${fn.text}(…) 里要写一个值。`, `比如 ${fn.text}(x)。`)
        const arg = expression()
        if (ts.is(',')) fail('syntax', locOf(ts.peek()), '类型转换只能有一个参数。', `写成 ${fn.text}(x)。`)
        closeParen(open)
        return { kind: 'cast', type: fn.text as ScalarType, arg, loc: at }
      }
      case 'syncthreads':
      case 'atomic_add':
        fail('syntax', at, `${fn.text}(…) 要单独写成一行。`, '它不算出值，不能放在式子里。')
      case 'shared':
        fail('syntax', at, 'shared(…) 只能单独写成一行，比如 s = shared(64)。', '共享数组要先起个名字，再用 s[i] 读写。')
      case 'range':
        fail('syntax', at, 'range(…) 只能写在 for 里。', FOR_SHAPE)
      case '__syncthreads':
        fail('syntax', at, 'Python 风格里同步写成 syncthreads()。', '去掉前面的两个下划线。')
      case 'atomicAdd':
        fail('syntax', at, 'Python 风格里原子加写成 atomic_add(a, i, v)。', '三个参数分别是数组、下标、要加的值。')
      case 'print':
        fail('syntax', at, '模拟器里不能打印。', '想看变量怎么变，用单步执行。')
      case 'len':
        fail('syntax', at, 'Py Lite 不支持 len。', '数组的长度作为参数传进来，比如 n。')
    }
    const guess = closestName(fn.text, ['syncthreads', 'atomic_add', 'shared', 'range', 'int', 'float'])
    fail(
      'syntax',
      at,
      `不认识函数「${fn.text}」。`,
      guess ? `是不是想写「${guess}」？` : 'Py Lite 能调用的只有 syncthreads()、atomic_add(a, i, v)、shared(n)、range(…)、int(…)、float(…)。',
    )
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
      if (ts.is(',')) fail('syntax', locOf(ts.peek()), 'Py Lite 不支持元组。', '一个括号里只写一个式子。')
      closeParen(t)
      return inner
    }
    if (t.kind === 'op' && t.text === '[') fail('syntax', at, 'Py Lite 不支持列表。', '数组只能是 kernel 的参数或 shared(…) 共享数组。')
    if (t.kind !== 'name') {
      if (t.kind !== 'op') unexpected(t, '一个数或名字')
      foreign(t)
      fail('syntax', at, `「${t.text}」前面还缺一个数或名字。`, '检查这里是不是漏写了什么。')
    }
    ts.next()
    if (t.text === 'True' || t.text === 'False') return { kind: 'bool', value: t.text === 'True', loc: at }
    if (t.text === 'None') fail('syntax', at, 'Py Lite 里用不到 None。', '用 0 或 False。')
    if (KEYWORDS[t.text] === true) fail('syntax', at, `「${t.text}」是 Python 的关键字，不能放在式子里。`, '检查这一行的写法。')
    if (BUILTIN_BASES.includes(t.text)) return builtin(t)
    if (ts.is('.')) {
      const guess = closestName(t.text, BUILTIN_BASES)
      if (guess) fail('syntax', at, `不认识「${t.text}」。`, `是不是想写「${guess}.x」？`)
      fail('syntax', at, `「${t.text}」后面不能接「.」。`, '只有 blockIdx、blockDim、threadIdx、gridDim 后面能接 .x。')
    }
    if (ts.is('(')) return call(t)
    if (!ts.is('[')) return { kind: 'name', name: t.text, loc: at }
    ts.next()
    const index = expression()
    if (ts.is(':')) fail('syntax', locOf(ts.peek()), 'Py Lite 不支持切片。', '一次只取一个元素：a[i]。')
    if (ts.is(',')) fail('syntax', locOf(ts.peek()), 'Py Lite 只支持一维数组，下标只能写一个。', '二维的数据可以摊平成一维，用 row * 宽度 + col 当下标。')
    if (ts.accept(']') === null) unexpected(ts.peek(), '右方括号「]」')
    if (ts.is('[')) fail('syntax', locOf(ts.peek()), 'Py Lite 只支持一维数组，下标只能写一个。', '二维的数据可以摊平成一维，用 row * 宽度 + col 当下标。')
    return { kind: 'index', array: t.text, index, loc: at }
  }

  return file()
}

/**
 * 解析 Py Lite 程序。出错时返回第一个错误（中文，带行列号）。
 *
 * Python 风格的参数类型由传进来的数据决定。只解析时不知道，用到参数的地方检查放过；
 * 解释器拿到数据以后把类型传进来（types）再检查一遍，这些地方的类型错误就在运行前报出来，
 * HIP 的隐式转换（比如整数存进小数变量）也会补上，和 HIP 写法得到同一棵树。
 */
export function parsePy(source: string, types?: readonly ParamSig[]): ParseResult {
  try {
    const src = normalizeNewlines(source)
    checkSourceSize(src)
    const raw = parseTokens(tokenize(src))
    if (types) {
      raw.params = raw.params.map((p) => {
        const t = types.find((s) => s.name === p.name)
        return t ? { ...p, decl: { array: t.array, type: t.type, readonly: false } } : p
      })
    }
    return { ok: true, kernel: check(raw, 'python'), signature: null }
  } catch (err) {
    if (err instanceof SimFailure) return { ok: false, error: err.error }
    throw err
  }
}
