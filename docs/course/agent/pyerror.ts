/**
 * 读者 Python Agent 的报错（A-02；03 第 4 节：错误信息写成「现象 + 原因 + 怎么改」，原文放进折叠块）。
 *
 * Python 那边（pyodide.ts 的外壳）把异常整理成 PyError：类型、说明、读者代码里的行和列、原文。
 * 这里按异常类型写成读者看得懂的三句话。纯函数，AgentCode 直接导入（不带 Pyodide 和模拟器），单测直接导入。
 */
import type { ToolName } from './react.ts'

/** 读者代码的一个错误（Python 那边整理好的）。 */
export interface PyError {
  /** Python 的异常类名，例如 SyntaxError、KeyError */
  type: string
  /** 异常自己的说明（语法错误是 msg，其余是 str(异常)） */
  message: string
  /** 出错的位置：读者代码里的行、列（1 起）；找不到是 null */
  line: number | null
  col: number | null
  /** Python 打印的最后一行，例如 NameError: name 'strid' is not defined. Did you mean: 'stride'? */
  summary: string
  /** Python 的原文：只留读者代码里的那几层 */
  raw: string
}

/** 观察 data 的键（tools.ts 的 observe），报 KeyError 时列给读者看；单测核对和真实的观察一致。 */
export const OBSERVATION_KEYS: Readonly<Record<ToolName, readonly string[]>> = {
  run_kernel: ['correct', 'wrong', 'out_of_bounds', 'blocks', 'threads'],
  measure: ['cycles', 'compute', 'memory', 'sync', 'lane_utilization'],
  inspect_memory: ['accesses', 'transactions', 'ideal', 'efficiency'],
  finish: ['stars', 'correct', 'efficiency', 'cycles'],
}

// ── 报错写成「现象 + 原因 + 怎么改」 ─────────────────────────────────────────

export interface ExplainedError {
  symptom: string
  cause: string
  fix: string
  /** Python 的原文 */
  raw: string
}

/** 读者容易敲进去的中文标点（Python 报 invalid character） */
const FULL_WIDTH = /invalid character '(.)' \(U\+(FF08|FF09|FF0C|FF1A|FF1B|FF01|FF1F|FF3B|FF3D|3001|3002|201C|201D|2018|2019|3010|3011)\)/

function syntaxCause(message: string): string {
  const wide = FULL_WIDTH.exec(message)
  if (wide) return `用了中文的标点「${wide[1]}」：Python 只认英文（半角）的标点。`
  if (/Maybe you meant '==' or ':=' instead of '='/.test(message) || /cannot assign to/.test(message)) {
    return '判断两个值相等要写 ==，一个 = 是赋值，不能写在条件里。'
  }
  if (/was never closed|unmatched|does not match/.test(message)) return '括号没有配对：每个「(」「[」「{」都要有对应的「)」「]」「}」。'
  if (/unterminated (triple-quoted )?string/.test(message)) return '引号没有配对：文字要用一对引号包起来。'
  if (/indent/.test(message)) return '缩进不对：Python 靠每行开头的空格分清哪些代码在 if、while 里面。'
  if (/invalid decimal literal/.test(message)) return '数字后面紧跟着字母：数字和名字之间要有运算符或空格。'
  if (/expected ':'/.test(message)) return 'if、elif、else、while 那一行的末尾要有英文冒号「:」。'
  if (/invalid syntax/.test(message)) return '这一行有 Python 不认识的写法：可能多了或少了符号，或者两个值之间少了运算符。'
  return `Python 的说明是：${message}`
}

/**
 * 把读者代码的错误写成「现象 + 原因 + 怎么改」（03 第 4 节）。
 * where(line) 给出这一行在哪，例如「第 1 个空：多搬了吗」；不在空里返回 null。
 */
export function explainPythonError(e: PyError, where: (line: number) => string | null = () => null): ExplainedError {
  const place = e.line ? `第 ${e.line} 行${where(e.line) ? `（${where(e.line)}）` : ''}` : '代码里'
  const stopped = `运行到${place}停下了`
  const raw = e.raw || e.summary || `${e.type}: ${e.message}`
  const generic = { symptom: `${stopped}（${e.type}）。`, cause: `Python 的说明是：${e.summary || e.message || e.type}`, fix: '对照下面 Python 的原文找到原因，改好以后再运行。', raw }

  switch (e.type) {
    case 'SyntaxError':
    case 'IndentationError':
    case 'TabError':
      return { symptom: `${place}的写法 Python 看不懂，Agent 一步也没有走。`, cause: syntaxCause(e.message), fix: `改好${place}再运行。`, raw }
    case 'NameError': {
      const name = /name '(\w+)' is not defined/.exec(e.message)?.[1]
      const guess = /Did you mean: '(\w+)'\?/.exec(e.summary)?.[1]
      return {
        symptom: `${stopped}：用到了一个还没有定义的名字${name ? ` ${name}` : ''}。`,
        cause: 'Python 不认识这个名字：可能拼错了、大小写不对，或者它还没有被赋值。',
        fix: guess ? `是不是想写 ${guess}？` : '检查拼写。这段代码里能用的名字有 block、stride、timing、memory、START，工具 run_kernel、measure、inspect_memory、finish，还有 think。',
        raw,
      }
    }
    case 'KeyError':
      return {
        symptom: `${stopped}：观察里没有 ${e.message} 这个键。`,
        cause: '工具给回来的观察是一个字典，只能用它有的键来取值，键名要一字不差。',
        fix: `能用的键：${Object.entries(OBSERVATION_KEYS).map(([tool, keys]) => `${tool} 给回 ${keys.join('、')}`).join('；')}。`,
        raw,
      }
    case 'AttributeError': {
      const attr = /'dict' object has no attribute '(\w+)'/.exec(e.message)?.[1]
      if (!attr) return generic
      return {
        symptom: `${stopped}：观察是字典，不能用 .${attr} 取值。`,
        cause: '字典里的值要用方括号加键名来取。',
        fix: `写成 ["${attr}"]，例如 memory["transactions"]。`,
        raw,
      }
    }
    case 'AgentError':
      return /^已经交卷/.test(e.message)
        ? { symptom: `${stopped}：${e.message}`, cause: '交卷（finish）表示这一轮结束，后面不能再跑、计时或看访存。', fix: '把 finish 放在最后，只调用一次。', raw }
        : { symptom: `${stopped}：${e.message}`, cause: '工具只认任务里给出的可选值，别的值模拟器不会去跑。', fix: '检查算出这个参数的那一行（改步长、改 block 的那几行），让它落在可选值里。', raw }
    case 'TypeError': {
      if (/要是整数/.test(e.message)) return { symptom: `${stopped}：${e.message}。`, cause: '工具的参数 block、stride 都是整数。', fix: '检查算出这个参数的那一行，让它是整数，例如 1，不要写成 "1" 或 1.5。', raw }
      const keyword = /unexpected keyword argument '(\w+)'/.exec(e.message)?.[1]
      if (keyword) return { symptom: `${stopped}：工具没有 ${keyword} 这个参数。`, cause: '工具只认 block 和 stride 两个参数。', fix: '写成 measure(block=64, stride=1) 这样。', raw }
      if (/missing \d+ required positional argument/.test(e.message)) {
        return { symptom: `${stopped}：调用工具时少了参数。`, cause: '每个工具都要同时给 block 和 stride。', fix: '写成 measure(block=64, stride=1) 这样。', raw }
      }
      if (/not supported between instances|unsupported operand|can only concatenate|must be str/.test(e.message)) {
        return { symptom: `${stopped}：两边的值类型对不上。`, cause: '例如拿整个观察字典去和数字比大小，或者把文字和数字加在一起。', fix: '先从观察里取出一个数，例如 memory["transactions"]，再和别的数比较或计算。', raw }
      }
      return generic
    }
    case 'ZeroDivisionError':
      return { symptom: `${stopped}：除数是 0。`, cause: '除以 0 没有结果，Python 直接报错。', fix: '检查除号（/、//、%）右边的值。', raw }
    default:
      return generic
  }
}
