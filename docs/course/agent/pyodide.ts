/**
 * 运行读者写的 Python Agent（A-02；09 第 3 节，03 第 4 节）。
 *
 * 1-14 的读者用 Python 补全 ReAct 循环的三个空（starter.ts），点「运行我的 Agent」以后：
 * - Pyodide（编译成 WebAssembly 的 CPython）在一个 Web Worker 里运行读者的代码（pyodide.worker.ts），
 *   主线程通过 pyodide-client.ts 和它说话。Pyodide 的文件自托管（pyodide-files.ts），读者点运行时才下载。
 * - 读者的代码调用的工具就是 A-01 的工具（tools.ts）：Python 调用时要马上拿到观察，所以模拟器在同一个
 *   worker 里同步地跑（createSyncEnv + lockstep.ts 的 run），观察和规则 Agent 看到的逐项相同。
 * - 每调用一次工具是一步，记一条 { thought, action, observation }；think() 写下的想法记在下一步前面。
 *   同时问规则 Agent（rules.ts）面对同样的历史会怎么选，好和读者的 Agent 一步一步对比。
 * - 步数上限、交卷和 A-01 的 runAgent 一样：最多 maxSteps 步，交卷（finish）以后不能再调用工具。
 * - 读者代码的错误（语法错误、运行时错误）由 Python 那边整理成 PyError（类型、说明、行和列、原文），
 *   主线程用 pyerror.ts 写成「现象 + 原因 + 怎么改」（03 第 4 节）。
 *
 * 这个文件不碰浏览器：runPyAgent 拿一个已经加载好的 Pyodide，单测在 Node 里用 pyodide 包直接跑它。
 */
import type { RunRequest, RunResult } from '../../sim/lockstep.ts'
import type { PyError } from './pyerror.ts'
import { MAX_STEPS, runAgent, sameAction, type AgentAction, type AgentStep, type Decision, type Episode, type Verdict } from './react.ts'
import { rulePolicy } from './rules.ts'
import type { TuneTask } from './tasks.ts'
import { createSyncEnv } from './tools.ts'

/** 读者的 Agent 走的一步，外加规则 Agent 面对同样的历史会怎么选。 */
export interface PyStep extends AgentStep {
  rule: Decision
  same: boolean
}

export interface PyRun {
  steps: PyStep[]
  /** finish：交卷了；limit：步数用完；end：程序跑完了，没有交卷；error：程序出错停下了 */
  stop: 'finish' | 'limit' | 'end' | 'error'
  verdict: Verdict | null
  /** 程序出的错；交卷以后才出错时，stop 仍是 finish，错误也写在这里 */
  error: PyError | null
  /** print 打印的内容，一行一条 */
  output: string[]
  /** 打印得太多，后面的没留下 */
  truncated: boolean
  maxSteps: number
  /** 规则 Agent 从同一个起点走的一轮 */
  rule: { steps: number; stop: Episode['stop']; verdict: Verdict | null }
}

/** 用到的 Pyodide 接口（pyodide 包的 PyodideAPI 里的一小部分）。 */
export interface PyRuntime {
  runPython(code: string): unknown
  setStdout(options: { batched: (line: string) => void }): void
  setStderr(options: { batched: (line: string) => void }): void
}

export interface PyAgentRequest {
  /** 读者的代码（三个空已经填进去） */
  code: string
  /** 任务；start 是这一轮的起点 */
  task: TuneTask
  maxSteps?: number
}

export interface PyAgentHooks {
  /** 同步地跑模拟器：worker 和单测都传 lockstep.ts 的 run */
  run(request: RunRequest): RunResult
  /** 每走完一步 */
  onStep?(step: PyStep): void
}

/** 一次最多留多少行打印（读者在循环里 print 时不至于把页面撑爆） */
export const MAX_OUTPUT_LINES = 200

/** 一条想法最多留多少字 */
const MAX_THOUGHT_CHARS = 500

/**
 * Python 那边的外壳：定义工具和 think，编译、运行读者的代码，把结果和错误整理成 JSON。
 * - 工具调用 bridge.act（JavaScript），拿回 JSON：ok 给观察的字典；limit（步数用完）抛 StepLimit，
 *   它继承 BaseException，读者写的 except Exception 接不住；别的情况抛 AgentError，说明由 JavaScript 写好。
 * - 读者的代码在一个新的命名空间里运行，文件名记成 <agent>：报错时只留这个文件里的那几层。
 * 最后一行的值（run_agent）就是 runPython 的返回值。
 */
const HARNESS = `
import json
import sys
import traceback


class StepLimit(BaseException):
    """步数用完了：这一轮到此为止，不是代码写错了。"""


class AgentError(Exception):
    """工具用得不对：参数不在可选值里、交卷以后还在调用。"""


_bridge = None


def _tool(name):
    def tool(block, stride):
        for key, value in (("block", block), ("stride", stride)):
            if isinstance(value, bool) or not isinstance(value, int):
                raise TypeError(f"{name} 的 {key} 要是整数，收到的是 {value!r}")
        reply = json.loads(_bridge.act(name, block, stride))
        if reply["status"] == "limit":
            raise StepLimit()
        if reply["status"] != "ok":
            raise AgentError(reply["message"])
        return reply["data"]

    tool.__name__ = tool.__qualname__ = name
    return tool


def think(text):
    _bridge.think(str(text))


_NAMES = {"think": think}
for _name in ("run_kernel", "measure", "inspect_memory", "finish"):
    _NAMES[_name] = _tool(_name)


def _error(exc, line=None, col=None):
    te = traceback.TracebackException.from_exception(exc)
    frames = [f for f in te.stack if f.filename == "<agent>"]
    te.stack = traceback.StackSummary.from_list(frames)
    if line is None and frames:
        line = frames[-1].lineno
        colno = getattr(frames[-1], "colno", None)
        col = None if colno is None else colno + 1
    return {
        "type": type(exc).__name__,
        "message": exc.msg if isinstance(exc, SyntaxError) else str(exc),
        "line": line,
        "col": col,
        "summary": "".join(te.format_exception_only()).strip(),
        "raw": "".join(te.format()).strip(),
    }


def run_agent(code, block, stride, bridge):
    global _bridge
    _bridge = bridge
    try:
        try:
            compiled = compile(code, "<agent>", "exec")
        except SyntaxError as exc:
            return json.dumps({"status": "error", "error": _error(exc, exc.lineno, exc.offset)})
        names = {"__name__": "__main__", "START": (block, stride)}
        names.update(_NAMES)
        try:
            exec(compiled, names)
        except StepLimit:
            return json.dumps({"status": "limit"})
        except BaseException as exc:
            return json.dumps({"status": "error", "error": _error(exc)})
        return json.dumps({"status": "end"})
    finally:
        _bridge = None
        sys.stdout.flush()
        sys.stderr.flush()


run_agent
`

type Harness = (code: string, block: number, stride: number, bridge: object) => string

/** 每个 Pyodide 只装一次外壳。 */
const harnesses = new WeakMap<PyRuntime, Harness>()

function harnessOf(py: PyRuntime): Harness {
  let h = harnesses.get(py)
  if (!h) {
    h = py.runPython(HARNESS) as Harness
    harnesses.set(py, h)
  }
  return h
}

/** 把几次 think() 接成一段：前一句以标点结尾就直接接，否则空一格。 */
export function joinThoughts(parts: readonly string[]): string {
  let out = ''
  for (const raw of parts) {
    const s = raw.trim()
    if (!s) continue
    out = !out || /[。！？；：，.!?;:,]$/.test(out) ? out + s : `${out} ${s}`
  }
  return out.length > MAX_THOUGHT_CHARS ? `${out.slice(0, MAX_THOUGHT_CHARS)}……` : out
}

type Reply = { status: 'ok'; data: Record<string, unknown> } | { status: 'limit' } | { status: 'error'; message: string }

/**
 * 在一个加载好的 Pyodide 里运行读者的 Agent。Python 是同步运行的：这个函数返回之前，读者的代码已经跑完
 * （死循环要由调用方在别的线程上停掉 worker）。规则 Agent 那一轮用同一个环境跑，同一组参数不重复跑模拟器。
 * 模拟器自己出的错、外壳本身的错原样抛出；读者代码的错在结果的 error 里。
 */
export async function runPyAgent(py: PyRuntime, request: PyAgentRequest, hooks: PyAgentHooks): Promise<PyRun> {
  const { code, task } = request
  const maxSteps = request.maxSteps ?? MAX_STEPS
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new RangeError(`maxSteps 要是正整数，收到的是 ${String(maxSteps)}。`)
  const env = createSyncEnv(task, hooks.run)
  const steps: PyStep[] = []
  let thoughts: string[] = []
  let verdict: Verdict | null = null
  const output: string[] = []
  let truncated = false

  const bridge = {
    think(text: string) {
      thoughts.push(String(text))
    },
    act(tool: string, block: number, stride: number): string {
      if (verdict) return JSON.stringify({ status: 'error', message: '已经交卷了：交卷以后这一轮就结束了，不能再调用工具。' } satisfies Reply)
      if (steps.length >= maxSteps) return JSON.stringify({ status: 'limit' } satisfies Reply)
      const action: AgentAction = { tool, args: { block, stride } }
      // 先问规则 Agent（只看到这一步之前的历史），再执行读者的行动
      const rule = rulePolicy({ task, steps: steps.slice(), maxSteps })
      const observation = env.act(action)
      // 不合法的行动（参数不在可选值里）不执行，也不算一步：在读者的代码里报错，指到调用它的那一行
      if (!observation.ok) return JSON.stringify({ status: 'error', message: String(observation.data.error ?? observation.text) } satisfies Reply)
      const step: PyStep = { thought: joinThoughts(thoughts), action, observation, rule, same: sameAction(rule.action, action) }
      thoughts = []
      steps.push(step)
      if (observation.verdict) verdict = observation.verdict
      hooks.onStep?.(step)
      return JSON.stringify({ status: 'ok', data: observation.data } satisfies Reply)
    },
  }

  const print = (line: string) => {
    if (output.length < MAX_OUTPUT_LINES) output.push(line)
    else truncated = true
  }
  py.setStdout({ batched: print })
  py.setStderr({ batched: print })
  let result: { status: 'end' | 'limit' } | { status: 'error'; error: PyError }
  try {
    result = JSON.parse(harnessOf(py)(code, task.start.block, task.start.stride, bridge))
  } finally {
    // 跑完以后打印不再记到这一次里
    py.setStdout({ batched: () => {} })
    py.setStderr({ batched: () => {} })
  }

  const error = result.status === 'error' ? result.error : null
  const stop: PyRun['stop'] = verdict ? 'finish' : error ? 'error' : result.status === 'limit' ? 'limit' : 'end'

  // 规则 Agent 从同一个起点走一轮（用同一个环境：读者跑过的参数不再跑）
  const ruleEpisode = await runAgent({ task, act: async (a) => env.act(a) }, rulePolicy, { maxSteps })
  return {
    steps,
    stop,
    verdict,
    error,
    output,
    truncated,
    maxSteps,
    rule: { steps: ruleEpisode.steps.length, stop: ruleEpisode.stop, verdict: ruleEpisode.verdict },
  }
}
