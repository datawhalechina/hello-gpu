/**
 * 代码沙盒的填空模板（S-05）。
 *
 * 模板就是两种写法各一段普通代码，读者要填的地方用 [[名字: 初始内容]] 标出来：
 *
 *   int i = [[i: threadIdx.x]];
 *   if ([[guard: true]]) {
 *
 * - 名字只能用字母、数字、下划线和减号，同一段模板里不能重复。两种写法里同一个空用同一个名字，
 *   手机上的选项（Sandbox 的 blanks 属性）按名字对应。
 * - 冒号（和后面的一个空格）之后、]] 之前是初始内容，可以省略：[[i]] 就是空着。
 *   03 第 1 节第 3 条：初始内容最好「能跑但不好」。
 * - 一个空只占一行里的一段，内容不能换行；方括号要成对，所以 a[b[i]] 也能写进空里，
 *   空也能写在下标里：c[[[k: i]]]（「[[[」的第一个「[」是代码）。
 *
 * 填空模式只开放这些空；完整模式把标记换成初始内容，整段都能改（手机上有空的话退化成填空）。
 * 纯函数，不碰 Vue 和浏览器，单测直接导入。
 */
import type { Lang } from '../../../sim/syntax/ast.ts'
import { highlight, type Tone } from './highlight.ts'

export interface Blank {
  name: string
  initial: string
}

export interface Template {
  /** 模板按顺序切成的几段：普通代码，或者一个空 */
  parts: (string | Blank)[]
  blanks: Blank[]
}

/** 填好的代码里一个空占的位置 [from, to)。 */
export interface BlankRange {
  name: string
  from: number
  to: number
}

export interface Filled {
  source: string
  /** 按位置排好序 */
  ranges: BlankRange[]
}

/** 模板本身写错了：给写关卡的人看，Sandbox 把它画成红框（构建时会失败）。 */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

export function parseTemplate(template: string): Template {
  const src = template.replace(/\r\n?/g, '\n')
  const parts: (string | Blank)[] = []
  const blanks: Blank[] = []
  let text = ''
  let i = 0
  while (i < src.length) {
    // 「[[[」：空写在下标里（c[[[k]]]），第一个「[」是代码
    if (!src.startsWith('[[', i) || src[i + 2] === '[') {
      text += src[i++]
      continue
    }
    const line = src.slice(0, i).split('\n').length
    const name = /^[\w-]+/.exec(src.slice(i + 2))?.[0]
    if (!name) throw new TemplateError(`模板第 ${line} 行：「[[」后面要紧跟空的名字，比如 [[i: threadIdx.x]]。`)
    if (blanks.some((b) => b.name === name)) throw new TemplateError(`模板第 ${line} 行：空的名字「${name}」重复了，同一段代码里每个空要用不同的名字。`)
    let j = i + 2 + name.length
    let initial = ''
    if (src[j] === ':') {
      j += src[j + 1] === ' ' ? 2 : 1
      const start = j
      let depth = 0
      while (j < src.length && src[j] !== '\n' && !(depth === 0 && src.startsWith(']]', j))) {
        if (src[j] === '[') depth++
        else if (src[j] === ']') depth--
        j++
      }
      initial = src.slice(start, j)
    }
    if (!src.startsWith(']]', j)) throw new TemplateError(`模板第 ${line} 行：空「${name}」没有在这一行里用「]]」结束（一个空不能跨行）。`)
    if (text) parts.push(text)
    text = ''
    const blank = { name, initial }
    parts.push(blank)
    blanks.push(blank)
    i = j + 2
  }
  if (text) parts.push(text)
  return { parts, blanks }
}

/** 按读者填的内容拼出代码；没填过的空用初始内容。内容里的换行换成空格，免得改动行号。 */
export function fillTemplate(template: Template, values: Readonly<Record<string, string>> = {}): Filled {
  let source = ''
  const ranges: BlankRange[] = []
  for (const part of template.parts) {
    if (typeof part === 'string') {
      source += part
      continue
    }
    const value = String(Object.hasOwn(values, part.name) ? values[part.name] : part.initial).replace(/[\r\n]+/g, ' ')
    ranges.push({ name: part.name, from: source.length, to: source.length + value.length })
    source += value
  }
  return { source, ranges }
}

export interface TextSegment {
  kind: 'text'
  text: string
  tone: Tone | null
}

export interface BlankSegment {
  kind: 'blank'
  name: string
  text: string
}

export type Segment = TextSegment | BlankSegment

/**
 * 不加载编辑器时的代码（服务端渲染、手机上的填空）：按行切好，每行是带颜色的几段文字，
 * 空单独成段（withBlanks 为 false 时空也当普通代码）。和编辑器用同一份高亮。
 */
export function codeLines(filled: Filled, lang: Lang, withBlanks = true): Segment[][] {
  const { source } = filled
  const ranges = withBlanks ? filled.ranges : []
  const tones: (Tone | null)[] = new Array(source.length).fill(null)
  for (const token of highlight(source, lang)) tones.fill(token.tone, token.from, token.to)
  let line: Segment[] = []
  const lines = [line]
  let next = 0
  let i = 0
  for (;;) {
    if (next < ranges.length && ranges[next].from === i) {
      const range = ranges[next++]
      line.push({ kind: 'blank', name: range.name, text: source.slice(range.from, range.to) })
      i = range.to
      continue
    }
    if (i >= source.length) break
    if (source[i] === '\n') {
      line = []
      lines.push(line)
      i++
      continue
    }
    const tone = tones[i]
    const stop = next < ranges.length ? ranges[next].from : source.length
    let end = i + 1
    while (end < stop && source[end] !== '\n' && tones[end] === tone) end++
    line.push({ kind: 'text', text: source.slice(i, end), tone })
    i = end
  }
  return lines
}
