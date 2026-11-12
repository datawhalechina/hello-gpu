/**
 * 主线程调用模拟器（08 第 6 节）：在 Web Worker 里运行 lockstep.ts，用 Promise 拿结果，可以超时、可以取消。
 *
 *   const sim = createSimClient()          // 在 onMounted 里创建；模块顶层不碰 Worker，服务端渲染也安全
 *   const result = await sim.run({ source, lang: 'hip', grid: 2, block: 64, args })
 *
 * - 读者代码的错误不算失败：promise 照常给出 result，错误在 result.error 里（和同步接口一样）。
 * - 一个 client 同一时间只运行一次：上一次还没结束就开始新的一次，上一次以 AbortError 拒绝
 *   （「重新运行」「重置」正好需要这样）。要同时运行几段程序就建几个 client。
 * - 超时（默认 DEFAULT_TIMEOUT_MS）：停掉 worker，promise 以 TimeoutError 拒绝。
 *   有步数上限，正常的程序不会超时；超时多半是数据太大，界面提示「运行太久，已停下」即可。
 * - 取消（options.signal 或 dispose()）：停掉 worker，promise 以 AbortError 拒绝。
 * - 停掉的 worker 下次运行时重新创建。
 * - request 要是普通对象：Vue 的响应式对象不能直接发给 worker，先用 toRaw 或复制一份。
 *
 * 测试不经过这里，直接调用 lockstep.ts 的同步接口 run。
 */
import type { RunRequest, RunResult, SimEvent } from './lockstep.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'

export const DEFAULT_TIMEOUT_MS = 5000

export interface RunOptions {
  /** 多少毫秒还没有结果就停下，默认 DEFAULT_TIMEOUT_MS */
  timeout?: number
  signal?: AbortSignal
}

export interface SimClient {
  run(request: RunRequest, options?: RunOptions): Promise<RunResult>
  /** 停下正在进行的运行（以 AbortError 拒绝）并释放 worker */
  dispose(): void
}

interface Pending {
  id: number
  /** 分批收到的事件，最后拼进结果 */
  events: SimEvent[]
  resolve(result: RunResult): void
  reject(error: Error): void
}

export function createSimClient(): SimClient {
  let worker: Worker | null = null
  let pending: Pending | null = null
  let nextId = 1

  /** 结束当前这一次：worker 可能还在算，直接停掉，下次运行再新建。 */
  const settle = (error: Error) => {
    const p = pending
    if (!p) return
    pending = null
    worker?.terminate()
    worker = null
    p.reject(error)
  }

  const spawn = (): Worker => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending
      const data = e.data
      if (!p || data.id !== p.id) return
      // 事件分批到达（见 worker.ts）：收下一批就回 ack，worker 收到 ack 才发下一批；收齐了再给结果
      if ('events' in data) {
        p.events.push(...data.events)
        w.postMessage({ id: p.id, ack: true } satisfies WorkerRequest)
        return
      }
      pending = null
      if ('crash' in data) p.reject(new Error(`模拟器出错了：${data.crash}`))
      else p.resolve({ ...data.result, events: p.events })
    }
    w.onerror = (e) => settle(new Error(`模拟器的 worker 出错了：${e.message}`))
    return w
  }

  return {
    run(request, { timeout = DEFAULT_TIMEOUT_MS, signal } = {}) {
      settle(new DOMException('新的运行开始了，上一次运行已取消。', 'AbortError'))
      if (signal?.aborted) return Promise.reject(new DOMException('运行已取消。', 'AbortError'))
      const id = nextId++
      // 不用 Promise.withResolvers：Vite 默认的构建目标（Safari 16.4、Chrome 111）还没有它，构建也不补
      return new Promise<RunResult>((resolve, reject) => {
        const onAbort = () => {
          if (pending?.id === id) settle(new DOMException('运行已取消。', 'AbortError'))
        }
        const timer = setTimeout(() => {
          if (pending?.id === id) settle(new DOMException(`运行超过 ${timeout} 毫秒还没有结果，已经停下。`, 'TimeoutError'))
        }, timeout)
        const done = () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        pending = {
          id,
          events: [],
          resolve: (result) => {
            done()
            resolve(result)
          },
          reject: (error) => {
            done()
            reject(error)
          },
        }
        worker ??= spawn()
        worker.postMessage({ id, request } satisfies WorkerRequest)
      })
    },
    dispose() {
      settle(new DOMException('模拟器已关闭。', 'AbortError'))
    },
  }
}
