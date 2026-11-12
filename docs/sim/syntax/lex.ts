/**
 * 两种写法共用的词法工具：记号、数字、中文标点、源码大小上限、名字纠错。
 */
import { LIMITS, type Lang, type Loc } from './ast.ts'
import { fail } from './errors.ts'

export type TokenKind = 'name' | 'num' | 'op' | 'newline' | 'indent' | 'dedent' | 'eof'

export interface Token {
  kind: TokenKind
  /** 原文；newline、indent、dedent、eof 是空串 */
  text: string
  line: number
  col: number
  /** 数字的值；其他记号是 0 */
  value: number
  /** 数字是不是小数写法（带小数点、指数或 f 后缀） */
  float: boolean
}

export function locOf(t: Token): Loc {
  return { line: t.line, col: t.col }
}

/** 紧跟在记号后面的位置：报「这里少了 ;」时指向上一个记号的末尾，而不是下一行。 */
export function after(t: Token): Loc {
  return { line: t.line, col: t.col + t.text.length }
}

/** 统一换行符；\r\n 只出现在行尾，换掉不影响任何记号的行列号。 */
export function normalizeNewlines(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

export function checkSourceSize(source: string) {
  if (source.length > LIMITS.sourceChars) {
    const before = source.slice(0, LIMITS.sourceChars)
    const line = before.split('\n').length
    const col = LIMITS.sourceChars - before.lastIndexOf('\n')
    fail('limit', { line, col }, `代码有 ${source.length} 个字符，超过了模拟器的上限 ${LIMITS.sourceChars} 个。`, '沙盒里只写 kernel 本身，删掉用不到的部分。')
  }
  const lines = source.split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
  if (lines.length > LIMITS.sourceLines) {
    fail('limit', { line: LIMITS.sourceLines + 1, col: 1 }, `代码有 ${lines.length} 行，超过了模拟器的上限 ${LIMITS.sourceLines} 行。`, '沙盒里只写 kernel 本身，删掉用不到的部分。')
  }
}

export const isDigit = (ch: string) => ch >= '0' && ch <= '9'
export const isNameStart = (ch: string) => /^[A-Za-z_]$/.test(ch)
export const isNameChar = (ch: string) => /^[A-Za-z0-9_]$/.test(ch)

/** 中文输入法下最容易打出来的符号，以及它们对应的英文符号。 */
const FULLWIDTH: Record<string, string> = {
  '；': ';', '，': ',', '、': ',', '：': ':', '（': '(', '）': ')', '【': '[', '】': ']', '［': '[', '］': ']',
  '｛': '{', '｝': '}', '＝': '=', '＋': '+', '－': '-', '＊': '*', '／': '/', '％': '%', '＜': '<', '＞': '>',
  '《': '<', '》': '>', '！': '!', '？': '?', '＆': '&', '｜': '|', '。': '.', '．': '.', '“': '"', '”': '"',
  '‘': "'", '’': "'",
}

/** 看不懂的字符：中文标点、全角空格、中文名字分别给出提示。 */
export function badChar(ch: string, at: Loc): never {
  if (ch === '\u3000') fail('syntax', at, '这里有一个中文全角空格。', '把它换成普通的空格。')
  const ascii = FULLWIDTH[ch]
  if (ascii !== undefined) fail('syntax', at, `这里用了中文标点「${ch}」。`, `切换到英文输入法，换成「${ascii}」。`)
  if (/\p{L}/u.test(ch)) fail('syntax', at, `代码里不能出现「${ch}」。`, '名字只能用英文字母、数字和下划线；中文可以写在注释里。')
  fail('syntax', at, `看不懂这个符号「${ch}」。`, '检查是不是多打了字符。')
}

export function stringError(at: Loc): never {
  fail('syntax', at, '模拟器里用不到字符串。', '删掉引号和里面的内容；想写说明就写成注释。')
}

/** 从 src[start] 读一个数。HIP 的小数可以带 f 后缀；只认十进制。 */
export function scanNumber(src: string, start: number, at: Loc, lang: Lang): { end: number; value: number; float: boolean } {
  let i = start
  while (isDigit(src[i] ?? '')) i++
  let float = false
  if (src[i] === '.') {
    float = true
    i++
    while (isDigit(src[i] ?? '')) i++
  }
  const sign = src[i + 1] === '+' || src[i + 1] === '-' ? 1 : 0
  if ((src[i] === 'e' || src[i] === 'E') && isDigit(src[i + 1 + sign] ?? '')) {
    float = true
    i += 1 + sign
    while (isDigit(src[i] ?? '')) i++
  }
  const text = src.slice(start, i)
  if (lang === 'hip' && (src[i] === 'f' || src[i] === 'F')) {
    if (!float) fail('syntax', at, `整数 ${text} 后面不能直接加 f。`, `小数要带小数点，写成 ${text}.0f。`)
    i++
  }
  if (isNameChar(src[i] ?? '')) {
    if (text === '0' && (src[i] === 'x' || src[i] === 'X')) {
      fail('syntax', at, '模拟器只认十进制的数。', '把十六进制换成十进制，比如 0x10 写成 16。')
    }
    if (lang === 'python' && float && (src[i] === 'f' || src[i] === 'F')) {
      fail('syntax', at, `Python 里小数 ${text} 后面不用加 f。`, `直接写 ${text}。`)
    }
    fail('syntax', at, `数字 ${text} 后面紧跟着字母「${src[i]}」。`, '数字和名字之间要有运算符；名字不能以数字开头。')
  }
  if (!float && text.length > 1 && text[0] === '0') fail('syntax', at, `整数 ${text} 不要以 0 开头。`, `写成 ${Number(text)}。`)
  const value = Number(text)
  if (!float && value > LIMITS.maxInt) {
    fail('limit', at, `整数 ${text} 太大了，模拟器里的整数最大是 ${LIMITS.maxInt}。`, '换一个小一点的数。')
  }
  return { end: i, value, float }
}

/** 按顺序匹配运算符：列表里长的写在前面。 */
export function matchOp(src: string, i: number, ops: readonly string[]): string | null {
  for (const op of ops) if (src.startsWith(op, i)) return op
  return null
}

/** 编辑距离，用来猜读者想写的名字。 */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** 在候选里找一个和 name 最像的：只差大小写，或者拼错一两个字母（太短的名字不猜）。 */
export function closestName(name: string, candidates: Iterable<string>): string | null {
  const lower = name.toLowerCase()
  const limit = name.length <= 2 ? 0 : name.length <= 5 ? 1 : 2
  let best: string | null = null
  let bestDistance = limit + 1
  for (const c of candidates) {
    if (c === name) continue
    if (c.toLowerCase() === lower) return c
    const d = distance(lower, c.toLowerCase())
    if (d < bestDistance) {
      best = c
      bestDistance = d
    }
  }
  return best
}

/** 记号流：解析器在上面前进；enter / leave 计嵌套层数，超过上限报「超出限制」，不会把调用栈撑爆。 */
export class TokenStream {
  list: Token[]
  pos = 0
  depth = 0
  constructor(list: Token[]) {
    this.list = list
  }
  peek(ahead = 0): Token {
    return this.list[Math.min(this.pos + ahead, this.list.length - 1)]
  }
  next(): Token {
    const t = this.peek()
    if (this.pos < this.list.length - 1) this.pos++
    return t
  }
  /** 上一个读过的记号 */
  prev(): Token {
    return this.list[Math.max(this.pos - 1, 0)]
  }
  is(text: string, ahead = 0): boolean {
    const t = this.peek(ahead)
    return (t.kind === 'op' || t.kind === 'name') && t.text === text
  }
  accept(text: string): Token | null {
    return this.is(text) ? this.next() : null
  }
  enter(at: Token) {
    this.depth++
    if (this.depth > LIMITS.depth) {
      fail('limit', locOf(at), `代码嵌套超过了 ${LIMITS.depth} 层（代码块、括号和一长串运算都算）。`, '把复杂的式子拆成几行，用中间变量保存结果。')
    }
  }
  leave() {
    this.depth--
  }
}
