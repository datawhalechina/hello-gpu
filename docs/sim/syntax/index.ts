/**
 * 语法层入口：按写法选解析器。两种写法的同一个程序得到同一棵语法树（位置 loc 除外），见 ast.ts。
 *
 * types 只对 Python 风格有用：参数类型由数据决定，解释器拿到数据后传进来，见 py.ts 的 parsePy。
 * HIP 写法的参数类型写在代码里，忽略 types。
 */
import type { Lang, ParamSig, ParseResult } from './ast.ts'
import { parseHip } from './hip.ts'
import { parsePy } from './py.ts'

export function parse(source: string, lang: Lang, types?: readonly ParamSig[]): ParseResult {
  return lang === 'hip' ? parseHip(source) : parsePy(source, types)
}
