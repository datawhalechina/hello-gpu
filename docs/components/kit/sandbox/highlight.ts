/**
 * 代码沙盒的语法高亮（S-05）：只认 HIP Lite 和 Py Lite 用得到的关键字、内建名字和注释。
 *
 * 编辑器（editor.ts，CodeMirror）和不加载编辑器时的静态代码（服务端渲染、手机上的填空）共用这一份，
 * 两边的颜色完全一样。纯函数，不碰 Vue 和浏览器。
 *
 * 01 第 2.4 节的代码区只规定了关键字的颜色，所以只分两种：keyword（关键字和 blockIdx、__syncthreads
 * 这些内建名字）、comment（注释）；其余照代码区的正文色显示。
 */
import type { Lang } from '../../../sim/syntax/ast.ts'

export type Tone = 'keyword' | 'comment'

/** source 里 [from, to) 这一段按 tone 着色。按位置排好序，互不重叠。 */
export interface Token {
  from: number
  to: number
  tone: Tone
}

const KEYWORDS: Record<Lang, Set<string>> = {
  hip: new Set((
    'if else for while do break continue return void int float bool const true false __global__ __shared__ '
    + '__device__ __host__ __restrict__ __restrict blockIdx blockDim threadIdx gridDim __syncthreads atomicAdd'
  ).split(' ')),
  python: new Set((
    'def if elif else for in while and or not True False None return break continue pass range shared int float '
    + 'bool blockIdx blockDim threadIdx gridDim syncthreads atomic_add'
  ).split(' ')),
}

export function highlight(source: string, lang: Lang): Token[] {
  const tokens: Token[] = []
  const keywords = KEYWORDS[lang]
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const lineComment = lang === 'hip' ? ch === '/' && source[i + 1] === '/' : ch === '#'
    if (lineComment) {
      const end = source.indexOf('\n', i)
      const to = end < 0 ? source.length : end
      tokens.push({ from: i, to, tone: 'comment' })
      i = to
      continue
    }
    if (lang === 'hip' && ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const to = end < 0 ? source.length : end + 2
      tokens.push({ from: i, to, tone: 'comment' })
      i = to
      continue
    }
    // 名字；Python 的 @kernel 连同 @ 整个算关键字
    const decorator = lang === 'python' && ch === '@'
    if (/[A-Za-z_]/.test(decorator ? (source[i + 1] ?? '') : ch)) {
      let end = i + 1
      while (end < source.length && /\w/.test(source[end])) end++
      // 写在点后面的名字不算：blockIdx.x 的 x 不会被误判
      if (decorator || (keywords.has(source.slice(i, end)) && source[i - 1] !== '.')) {
        tokens.push({ from: i, to: end, tone: 'keyword' })
      }
      i = end
      continue
    }
    // 数字里的字母（1e5、2.0f）不能被当成名字的开头
    if (/[0-9]/.test(ch)) {
      while (i < source.length && /[\w.]/.test(source[i])) i++
      continue
    }
    i++
  }
  return tokens
}
