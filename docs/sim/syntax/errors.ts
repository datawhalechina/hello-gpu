/**
 * 模拟器的错误（08 第 3 节）：中文，带行列号，分语法、类型、运行时、超出限制四类。
 *
 * message 说哪里错、为什么；hint 说怎么改。界面按 03 第 4 节写成「现象 + 原因 + 怎么改」时，
 * 现象由类别和位置给出，原因用 message，怎么改用 hint；formatError 的整行文字是「解析器原文」。
 * 解析器、检查器和后面的解释器都用 fail() 抛错，在入口处接住变成 SimError。
 */
import type { Loc } from './ast.ts'

export type ErrorKind = 'syntax' | 'type' | 'runtime' | 'limit'

export const ERROR_KIND_LABEL: Record<ErrorKind, string> = {
  syntax: '语法错误',
  type: '类型错误',
  runtime: '运行时错误',
  limit: '超出限制',
}

export interface SimError {
  kind: ErrorKind
  message: string
  hint: string
  line: number
  col: number
}

export class SimFailure extends Error {
  error: SimError
  constructor(error: SimError) {
    super(formatError(error))
    this.name = 'SimFailure'
    this.error = error
  }
}

export function fail(kind: ErrorKind, at: Loc, message: string, hint: string): never {
  throw new SimFailure({ kind, message, hint, line: at.line, col: at.col })
}

/** 例如「第 3 行第 9 列，语法错误：少了分号「;」。在这一行末尾加上「;」。」 */
export function formatError(error: SimError): string {
  return `第 ${error.line} 行第 ${error.col} 列，${ERROR_KIND_LABEL[error.kind]}：${error.message}${error.hint}`
}
