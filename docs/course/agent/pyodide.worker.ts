/**
 * 运行读者 Python Agent 的 Web Worker（A-02）：主线程的 pyodide-client.ts 发来 load、run，
 * 这里加载 Pyodide、在模拟器上运行读者的代码（pyodide.ts 的 runPyAgent），每走完一步发一次，最后发结果（打印的内容在结果里）。
 *
 * - load：从站点自托管的目录（indexURL，绝对地址）import pyodide.mjs，再 loadPyodide。
 *   下载进度：Pyodide 用 fetch 取 wasm、标准库和锁文件，这里把 worker 的 fetch 包一层，一边往下传一边数字节，
 *   分母是 pyodide-files.ts 记的字节数；pyodide.mjs、pyodide.asm.mjs 用 import() 加载，数不到。
 *   加载失败要马上告诉主线程：Pyodide 在 wasm 下载或实例化失败时只在控制台打一行警告、然后一直等下去，
 *   所以这里在文件下载失败（HTTP 错误、断网）和 WebAssembly 实例化失败时自己报 load-error。
 * - run：读者的代码同步运行，这期间收不到别的消息；死循环由主线程超时以后停掉整个 worker。
 * 只有在 worker 里才注册消息处理，node 导入这个文件也不会出错（和 docs/sim/worker.ts 一样）。
 */
import type { PyodideAPI } from 'pyodide'
import { run } from '../../sim/lockstep.ts'
import { PYODIDE_FETCHED_BYTES, PYODIDE_FILES } from './pyodide-files.ts'
import { runPyAgent, type PyRun, type PyStep } from './pyodide.ts'
import { tuneTask, type TuneConfig } from './tasks.ts'

export type PyWorkerRequest =
  | { type: 'load'; indexURL: string }
  | { type: 'run'; id: number; code: string; task: string; start: TuneConfig; maxSteps: number }

export type PyWorkerResponse =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'load-error'; message: string }
  | { type: 'step'; id: number; step: PyStep }
  | { type: 'done'; id: number; result: PyRun }
  | { type: 'crash'; id: number; message: string }

/** 下载进度最多每隔多少毫秒报一次 */
const PROGRESS_EVERY_MS = 100

const scope = globalThis as unknown as {
  WorkerGlobalScope?: unknown
  fetch: typeof fetch
  addEventListener(type: 'message', listener: (e: MessageEvent<PyWorkerRequest>) => void): void
  postMessage(message: PyWorkerResponse): void
}

let py: PyodideAPI | null = null
let failed = false

function fail(message: string) {
  if (failed || py) return
  failed = true
  scope.postMessage({ type: 'load-error', message })
}

/** 把 fetch 和 WebAssembly.instantiateStreaming 包一层：数下载的字节，失败时马上报告。 */
function watchLoading(indexURL: string) {
  const counted = new Set(PYODIDE_FILES.filter((f) => f.fetched).map((f) => f.name))
  const realFetch = scope.fetch.bind(scope)
  let loaded = 0
  let reported = 0
  const report = (force: boolean) => {
    const now = Date.now()
    if (!force && now - reported < PROGRESS_EVERY_MS) return
    reported = now
    scope.postMessage({ type: 'progress', loaded: Math.min(loaded, PYODIDE_FETCHED_BYTES), total: PYODIDE_FETCHED_BYTES })
  }

  scope.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const name = url.startsWith(indexURL) ? url.slice(indexURL.length).split('?')[0] : ''
    if (!counted.has(name)) return realFetch(input, init)
    let response: Response
    try {
      response = await realFetch(input, init)
    } catch (err) {
      fail(`${name} 没有下载下来（${(err as Error)?.message ?? String(err)}）`)
      throw err
    }
    if (!response.ok) fail(`${name} 没有下载下来（HTTP ${response.status}）`)
    if (!response.ok || !response.body) return response
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          report(true)
          controller.close()
          return
        }
        loaded += value.byteLength
        report(false)
        controller.enqueue(value)
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })
    // 换了包装，响应头原样带上：instantiateStreaming 要看 Content-Type 是不是 application/wasm
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }

  // WebAssembly 是命名空间，类型上不能赋值；运行时它的属性是可写的
  const wasm = WebAssembly as { instantiateStreaming: typeof WebAssembly.instantiateStreaming }
  const instantiate = wasm.instantiateStreaming.bind(WebAssembly)
  wasm.instantiateStreaming = async (source, imports) => {
    try {
      return await instantiate(source, imports)
    } catch (err) {
      fail(`这个浏览器没能启动 Python 的 WebAssembly（${(err as Error)?.message ?? String(err)}）`)
      throw err
    }
  }
}

async function load(indexURL: string) {
  watchLoading(indexURL)
  // 不能静态导入：pyodide.mjs 是自托管的静态文件（不进打包），地址由主线程在运行时给出（站点 base 下的 pyodide/），
  // 它要和同一目录里的 pyodide.asm.mjs、wasm 是同一个版本
  const mod = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as { loadPyodide(options: { indexURL: string }): Promise<PyodideAPI> }
  const loaded = await mod.loadPyodide({ indexURL })
  if (failed) return
  py = loaded
  scope.postMessage({ type: 'ready' })
}

async function execute(request: Extract<PyWorkerRequest, { type: 'run' }>) {
  const { id } = request
  try {
    const task = tuneTask(request.task)
    if (!py) throw new Error('Python 还没有加载好。')
    if (!task) throw new Error(`没有 ${request.task} 这个任务。`)
    const result = await runPyAgent(py, { code: request.code, task: { ...task, start: request.start }, maxSteps: request.maxSteps }, {
      run,
      onStep: (step) => scope.postMessage({ type: 'step', id, step }),
    })
    scope.postMessage({ type: 'done', id, result })
  } catch (err) {
    scope.postMessage({ type: 'crash', id, message: err instanceof Error ? err.message : String(err) })
  }
}

if (typeof scope.WorkerGlobalScope !== 'undefined') {
  scope.addEventListener('message', (e) => {
    const data = e.data
    if (data.type === 'load') {
      load(data.indexURL).catch((err) => fail((err as Error)?.message ?? String(err)))
      return
    }
    void execute(data)
  })
}
