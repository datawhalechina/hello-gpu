/**
 * 关卡沙盒里的下标表达式。
 *
 * HIP 风格和 Python 风格共用同一棵语法树：两种写法的变量名相同，
 * 只有除法的含义不同（HIP 的 / 对整数截断取整；Python 的 / 得到小数，// 才是整除）。
 */

export type Lang = 'hip' | 'python'

export const VAR_NAMES = ['blockIdx.x', 'blockDim.x', 'threadIdx.x', 'gridDim.x', 'n'] as const
export type VarName = (typeof VAR_NAMES)[number]
export type Env = Record<VarName, number>

export type BinOp = '+' | '-' | '*' | '/' | '//' | '%'

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'var'; name: VarName }
  | { kind: 'neg'; arg: Expr }
  | { kind: 'bin'; op: BinOp; left: Expr; right: Expr }

export interface ExprError {
  message: string
  /** 出错位置在原始输入中的字符下标 */
  at: number
}

export type ParseResult = { ok: true; expr: Expr } | { ok: false; error: ExprError }
export type EvalResult = { ok: true; value: number } | { ok: false; error: string }

type Token =
  | { type: 'num'; value: number; at: number }
  | { type: 'var'; name: VarName; at: number }
  | { type: 'op'; op: BinOp | '(' | ')'; at: number }

const BASE_NAMES: Record<string, string> = {
  blockIdx: 'blockIdx.x',
  blockDim: 'blockDim.x',
  threadIdx: 'threadIdx.x',
  gridDim: 'gridDim.x',
}

const NAME_LIST = VAR_NAMES.join('、')

class ParseFailure extends Error {
  at: number
  constructor(message: string, at: number) {
    super(message)
    this.at = at
  }
}

/** 去掉读者顺手写上的 `int i =`、`i =` 和行尾分号，只留下表达式本身。 */
function stripStatement(src: string): { body: string; offset: number } {
  let body = src
  let offset = 0
  const prefix = body.match(/^\s*(?:(?:int|auto|long|size_t)\s+)?i\s*=(?!=)\s*/)
  if (prefix) {
    offset = prefix[0].length
    body = body.slice(offset)
  }
  body = body.replace(/;\s*$/, '')
  return { body, offset }
}

function tokenize(body: string, offset: number, lang: Lang): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    const at = offset + i
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (/[0-9]/.test(ch)) {
      let j = i
      while (j < body.length && /[0-9]/.test(body[j])) j++
      if (body[j] === '.' && /[0-9]/.test(body[j + 1] ?? '')) {
        throw new ParseFailure('本关的下标只用整数，不需要小数。', at)
      }
      tokens.push({ type: 'num', value: Number(body.slice(i, j)), at })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < body.length && /[A-Za-z0-9_]/.test(body[j])) j++
      const base = body.slice(i, j)
      let member = ''
      if (body[j] === '.') {
        let k = j + 1
        while (k < body.length && /[A-Za-z0-9_]/.test(body[k])) k++
        member = body.slice(j + 1, k)
        j = k
      }
      const full = member ? `${base}.${member}` : base
      if ((VAR_NAMES as readonly string[]).includes(full)) {
        tokens.push({ type: 'var', name: full as VarName, at })
      } else if (base in BASE_NAMES && !member) {
        throw new ParseFailure(`${base} 后面要加 .x，写成 ${BASE_NAMES[base]}。`, at)
      } else if (base in BASE_NAMES && (member === 'y' || member === 'z')) {
        throw new ParseFailure(`本关的数据是一排数，只用 .x 这一维，请写 ${BASE_NAMES[base]}。`, at)
      } else {
        throw new ParseFailure(`不认识「${full}」。可以用的名字有：${NAME_LIST}。`, at)
      }
      i = j
      continue
    }
    if (ch === '/' && body[i + 1] === '/') {
      if (lang === 'hip') {
        throw new ParseFailure('在 HIP（C++）里，// 是注释的开头，后面的内容都会被忽略。整数相除直接写 /。', at)
      }
      tokens.push({ type: 'op', op: '//', at })
      i += 2
      continue
    }
    if ('+-*/%()'.includes(ch)) {
      tokens.push({ type: 'op', op: ch as BinOp | '(' | ')', at })
      i++
      continue
    }
    throw new ParseFailure(`看不懂这个符号：「${ch}」。`, at)
  }
  return tokens
}

/** 解析一条下标表达式。空输入、未知名字、括号不配对都会给出读者能看懂的错误。 */
export function parseIndexExpr(src: string, lang: Lang): ParseResult {
  try {
    const { body, offset } = stripStatement(src)
    if (!body.trim()) throw new ParseFailure('先写出拿数的规则。', offset)
    const tokens = tokenize(body, offset, lang)
    let pos = 0
    const end = offset + body.length
    const peek = () => tokens[pos]
    const isOp = (op: string) => {
      const t = peek()
      return t !== undefined && t.type === 'op' && t.op === op
    }

    const parseExpr = (): Expr => {
      let left = parseTerm()
      while (isOp('+') || isOp('-')) {
        const op = (tokens[pos++] as { op: BinOp }).op
        left = { kind: 'bin', op, left, right: parseTerm() }
      }
      return left
    }
    const parseTerm = (): Expr => {
      let left = parseUnary()
      while (isOp('*') || isOp('/') || isOp('//') || isOp('%')) {
        const op = (tokens[pos++] as { op: BinOp }).op
        left = { kind: 'bin', op, left, right: parseUnary() }
      }
      return left
    }
    const parseUnary = (): Expr => {
      if (isOp('-')) {
        pos++
        return { kind: 'neg', arg: parseUnary() }
      }
      if (isOp('+')) {
        pos++
        return parseUnary()
      }
      return parsePrimary()
    }
    const parsePrimary = (): Expr => {
      const t = peek()
      if (!t) throw new ParseFailure('规则没写完：最后还缺一个数或名字。', end)
      if (t.type === 'num') {
        pos++
        return { kind: 'num', value: t.value }
      }
      if (t.type === 'var') {
        pos++
        return { kind: 'var', name: t.name }
      }
      if (t.op === '(') {
        pos++
        const inner = parseExpr()
        if (!isOp(')')) throw new ParseFailure('少了一个右括号「)」。', peek()?.at ?? end)
        pos++
        return inner
      }
      if (t.op === ')') throw new ParseFailure('多了一个右括号「)」。', t.at)
      throw new ParseFailure(`「${t.op}」前面还缺一个数或名字。`, t.at)
    }

    const expr = parseExpr()
    const rest = peek()
    if (rest) {
      if (rest.type === 'op' && rest.op === ')') throw new ParseFailure('多了一个右括号「)」。', rest.at)
      throw new ParseFailure('两个数或名字之间缺少运算符，比如 * 或 +。', rest.at)
    }
    return { ok: true, expr }
  } catch (err) {
    if (err instanceof ParseFailure) return { ok: false, error: { message: err.message, at: err.at } }
    throw err
  }
}

function floorMod(a: number, b: number) {
  return ((a % b) + b) % b
}

/** 求值时同时记录类型：Python 的 / 永远得到小数类型，哪怕除得尽（8 / 1 是 8.0）。 */
interface Typed {
  v: number
  float: boolean
}

/** 按某种语言的规则求值；结果必须是整数类型，因为它要当数组下标用。 */
export function evaluate(expr: Expr, env: Env, lang: Lang): EvalResult {
  const visit = (e: Expr): Typed => {
    switch (e.kind) {
      case 'num':
        return { v: e.value, float: false }
      case 'var':
        return { v: env[e.name], float: false }
      case 'neg': {
        const a = visit(e.arg)
        return { v: -a.v, float: a.float }
      }
      case 'bin': {
        const l = visit(e.left)
        const r = visit(e.right)
        const float = l.float || r.float
        switch (e.op) {
          case '+':
            return { v: l.v + r.v, float }
          case '-':
            return { v: l.v - r.v, float }
          case '*':
            return { v: l.v * r.v, float }
          case '/':
            if (r.v === 0) throw new RangeError('除以 0 了。')
            return lang === 'hip' ? { v: Math.trunc(l.v / r.v), float: false } : { v: l.v / r.v, float: true }
          case '//':
            if (r.v === 0) throw new RangeError('除以 0 了。')
            return { v: Math.floor(l.v / r.v), float }
          case '%':
            if (r.v === 0) throw new RangeError('对 0 取余数了。')
            return { v: lang === 'hip' ? l.v % r.v : floorMod(l.v, r.v), float }
        }
      }
    }
  }
  try {
    const { v: value, float } = visit(expr)
    if (float || !Number.isInteger(value)) {
      return {
        ok: false,
        error: '下标必须是整数。Python 里 / 的结果是小数类型，哪怕除得尽（8 / 1 得到 8.0）。整数相除要用 //。',
      }
    }
    return { ok: true, value: value === 0 ? 0 : value }
  } catch (err) {
    if (err instanceof RangeError) return { ok: false, error: err.message }
    throw err
  }
}
