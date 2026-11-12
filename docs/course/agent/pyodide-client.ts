/**
 * 主线程运行读者的 Python Agent（A-02）：在 Web Worker 里加载 Pyodide、运行代码（pyodide.worker.ts）。
 *
 *   const agent = createPyAgentClient(new URL(withBase('/pyodide/'), location.href).href)  // onMounted 以后再建
 *   await agent.load((p) => …)        // 第一次会下载 Pyodide（pyodide-files.ts）；加载好以后不再下载
 *   const result = await agent.run({ code, task: 'vector-add', start, maxSteps }, { onStep })
 *
 * - load 失败（断网、文件缺失、浏览器不支持 WebAssembly 或模块 worker）以 Error 拒绝；再调用 load 会重新来过。
 * - run：读者代码的错误不算失败，在 result.error 里。超过 timeout（默认 RUN_TIMEOUT_MS，多半是死循环）就停掉
 *   worker，以 TimeoutError 拒绝；stop()、dispose() 停掉 worker，以 AbortError 拒绝。worker 停掉以后，
 *   下次运行要重新启动 Python（文件一般已经在浏览器缓存里）。
 * - 一次只运行一个：读者的代码同步运行，上一次没结束时 worker 收不到新的消息，所以新的运行先停掉旧的 worker。
 * 模块顶层不碰 Worker、location，服务端渲染时导入也安全。
 */
import type { PyRun, PyStep } from './pyodide.ts'
import type { PyWorkerRequest, PyWorkerResponse } from './pyodide.worker.ts'
import type { TuneConfig } from './tasks.ts'

/** 读者的代码最多跑多久。不是硬件参数：正常的一轮在模拟器上不到 1 秒，跑到这么久多半是死循环。 */
export const RUN_TIMEOUT_MS = 10000

export interface LoadProgress {
  /** 已经下载的字节数（能数到的那几个文件，见 pyodide-files.ts） */
  loaded: number
  total: number
}

export interface PyAgentRunRequest {
  code: string
  /** 任务 id（tasks.ts 的 TUNE_TASKS） */
  task: string
  start: TuneConfig
  maxSteps: number
}

export interface PyAgentRunOptions {
  /** 每走完一步（运行途中就会收到） */
  onStep?(step: PyStep): void
  timeout?: number
}

export interface PyAgentClient {
  /** Python 已经加载好，可以直接运行 */
  readonly ready: boolean
  load(onProgress?: (progress: LoadProgress) => void): Promise<void>
  run(request: PyAgentRunRequest, options?: PyAgentRunOptions): Promise<PyRun>
  /** 停下正在进行的加载或运行（以 AbortError 拒绝），停掉 worker */
  stop(): void
  dispose(): void
}

interface Pending {
  id: number
  onStep?(step: PyStep): void
  resolve(result: PyRun): void
  reject(error: Error): void
}

export function createPyAgentClient(indexURL: string): PyAgentClient {
  let worker: Worker | null = null
  let loading: Promise<void> | null = null
  let ready = false
  let onProgress: ((progress: LoadProgress) => void) | undefined
  let settleLoad: { resolve(): void; reject(error: Error): void } | null = null
  let pending: Pending | null = null
  let nextId = 1

  /** 停掉 worker：正在加载的、正在运行的都以 error 拒绝。 */
  const kill = (error: Error) => {
    worker?.terminate()
    worker = null
    ready = false
    loading = null
    const load = settleLoad
    settleLoad = null
    load?.reject(error)
    const p = pending
    pending = null
    p?.reject(error)
  }

  const spawn = (): Worker => {
    const w = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<PyWorkerResponse>) => {
      if (w !== worker) return
      const data = e.data
      switch (data.type) {
        case 'progress':
          onProgress?.({ loaded: data.loaded, total: data.total })
          return
        case 'ready': {
          ready = true
          const load = settleLoad
          settleLoad = null
          load?.resolve()
          return
        }
        case 'load-error':
          kill(new Error(data.message))
          return
        default: {
          const p = pending
          if (!p || data.id !== p.id) return
          if (data.type === 'step') {
            p.onStep?.(data.step)
            return
          }
          pending = null
          if (data.type === 'done') p.resolve(data.result)
          else p.reject(new Error(data.message))
        }
      }
    }
    w.onerror = (e) => {
      e.preventDefault()
      if (w === worker) kill(new Error(e.message || 'Python 的 worker 没有启动起来。'))
    }
    return w
  }

  const client: PyAgentClient = {
    get ready() {
      return ready
    },
    load(progress) {
      if (progress) onProgress = progress
      if (loading) return loading
      // 不用 Promise.withResolvers：Vite 默认的构建目标（Safari 16.4、Chrome 111）还没有它，构建也不补（同 docs/sim/client.ts）
      const current = new Promise<void>((resolve, reject) => {
        settleLoad = { resolve, reject }
      })
      loading = current
      try {
        worker = spawn()
        worker.postMessage({ type: 'load', indexURL } satisfies PyWorkerRequest)
      } catch (err) {
        // 浏览器不支持模块 worker 等：同样算加载失败，下次 load 重新来过
        kill(err instanceof Error ? err : new Error(String(err)))
      }
      return current
    },
    async run(request, { onStep, timeout = RUN_TIMEOUT_MS } = {}) {
      if (pending) kill(new DOMException('新的运行开始了，上一次运行已经停下。', 'AbortError'))
      await client.load()
      const w = worker
      if (!w) throw new DOMException('Python 已经停下。', 'AbortError')
      const id = nextId++
      // 同上，不用 Promise.withResolvers
      return new Promise<PyRun>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending?.id === id) kill(new DOMException(`运行超过 ${timeout} 毫秒还没有结束，已经停下。`, 'TimeoutError'))
        }, timeout)
        pending = {
          id,
          onStep,
          resolve: (result) => {
            clearTimeout(timer)
            resolve(result)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        }
        w.postMessage({ type: 'run', id, ...request } satisfies PyWorkerRequest)
      })
    },
    stop() {
      kill(new DOMException('已经停下。', 'AbortError'))
    },
    dispose() {
      onProgress = undefined
      kill(new DOMException('Python 已经关闭。', 'AbortError'))
    },
  }
  return client
}
