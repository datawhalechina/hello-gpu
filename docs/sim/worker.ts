/**
 * 模拟器的 Web Worker 入口（08 第 6 节）：主线程的 client.ts 发来 { id, request }，
 * 这里调用 lockstep.ts 的 run，按同一个 id 把结果发回去。模拟在 worker 里运行，页面不会被卡住。
 *
 * 事件分批发回：主线程收到消息时要在自己的线程上把数据解开，步数上限附近的运行有几十万个事件，
 * 一次解开要几百毫秒，页面会卡住；连着发很多批也不行，消息排着队，页面同样刷新不了。
 * 所以一批只发 EVENT_CHUNK 个事件，主线程收下一批回一个 ack，这里收到 ack 才发下一批，
 * 中间主线程空下来就能刷新页面；事件发完以后发去掉了事件的结果，client.ts 再拼回去。
 *
 * 读者代码的错误（语法、类型、运行时、超出限制）在 result.error 里；crash 只表示模拟器自己出了问题。
 * 只有在 worker 里才注册消息处理，所以 node 导入这个文件也不会出错；测试直接调用 lockstep.ts 的 run。
 */
import { run, type RunRequest, type RunResult, type SimEvent } from './lockstep.ts'

/** 开始一次运行；或者确认收到了 id 这次运行的一批事件 */
export type WorkerRequest = { id: number; request: RunRequest } | { id: number; ack: true }

/** 先是若干条 events，最后一条 result（其中 events 是空的）；出错时只有一条 crash。 */
export type WorkerResponse = { id: number; events: SimEvent[] } | { id: number; result: RunResult } | { id: number; crash: string }

/** 每批多少个事件：主线程解开一批平均几毫秒 */
const EVENT_CHUNK = 2000

const scope = globalThis as unknown as {
  WorkerGlobalScope?: unknown
  addEventListener(type: 'message', listener: (e: MessageEvent<WorkerRequest>) => void): void
  postMessage(message: WorkerResponse): void
}

/** 还没发完的那次运行 */
let outbox: { id: number; result: RunResult; next: number } | null = null

function sendNext() {
  if (!outbox) return
  const { id, result, next } = outbox
  if (next < result.events.length) {
    outbox.next = next + EVENT_CHUNK
    scope.postMessage({ id, events: result.events.slice(next, next + EVENT_CHUNK) })
  } else {
    outbox = null
    scope.postMessage({ id, result: { ...result, events: [] } })
  }
}

if (typeof scope.WorkerGlobalScope !== 'undefined') {
  scope.addEventListener('message', (e) => {
    const data = e.data
    if ('ack' in data) {
      if (outbox?.id === data.id) sendNext()
      return
    }
    try {
      outbox = { id: data.id, result: run(data.request), next: 0 }
    } catch (err) {
      outbox = null
      scope.postMessage({ id: data.id, crash: err instanceof Error ? err.message : String(err) })
      return
    }
    sendNext()
  })
}
