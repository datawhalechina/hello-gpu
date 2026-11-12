/**
 * Agent 要调的任务（A-01）：一个 kernel、可以调的参数、起点和三星标准。
 *
 * 纯数据和纯函数，只从模拟器导入类型：AgentConsole 直接导入它，服务端渲染时就能画出任务和星级标准；
 * 跑模拟器、算示意时间的部分（tools.ts）由组件按需加载。
 *
 * 新手村的 Agent 只调两个参数，都是前面关卡调过的：
 * - block：每组线程数（blockDim.x，1-4）。不是 wave 大小的整数倍时，每组最后一个 wave 有 lane 空着（1-5），
 *   后面几组的开头也落在一车的中间，一个 wave 要的数跨两车（1-8）。
 * - stride：访问步长。每个线程连着算 stride 个数，所以同一步里相邻两个线程隔 stride 个数（1-8 的跨步读），
 *   一个 wave 要的数散在 stride 车里。
 * 组数取刚好够用：⌈⌈n ÷ stride⌉ ÷ block⌉。kernel 有边界检查，任何一组参数都算得对（单测逐个检查），
 * 调的是快慢。三星：★1 算对；★2 搬的车数等于理想车数；★3 示意时间不超过 bestCycles。
 * bestCycles 是全部参数里最短的示意时间（模拟值，用 params.ts 的默认价钱算），单测逐个配置算出来核对。
 */
import type { Arg, RunRequest } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'

/** 一组参数。写成 type（不是 interface），这样它也是一个普通的「名字 → 值」对象，可以直接当行动的参数。 */
export type TuneConfig = {
  /** 每组多少个线程（blockDim.x） */
  block: number
  /** 访问步长：每个线程连着算几个数，也就是同一步里相邻两个线程隔几个数 */
  stride: number
}

export interface TuneTask {
  id: string
  /** 一句话任务（03 第 1 节第 1 条） */
  goal: string
  /** 代码区的文件名，后面按写法接 .hip / .py */
  file: string
  code: Record<Lang, string>
  /** 一共多少个数 */
  n: number
  /** wave 大小 */
  wave: 32 | 64
  /** block 的可选值，从小到大 */
  blocks: readonly number[]
  /** stride 的可选值，从小到大 */
  strides: readonly number[]
  /** 起点：能跑但不好（03 第 1 节第 3 条） */
  start: TuneConfig
  /** 三条星级标准（03 第 1 节第 6 条：在开头公示） */
  stars: readonly [string, string, string]
  /** ★3 的门槛：示意时间（模拟）不超过多少个周期 */
  bestCycles: number
}

const N = 1000
const BEST_CYCLES = 576

const VECTOR_ADD_CODE: Record<Lang, string> = {
  hip: `__global__ void add(const float* a, const float* b, float* c, int n, int stride) {
    // 每个线程连着算 stride 个数：相邻两个线程隔 stride 个数
    int first = (blockIdx.x * blockDim.x + threadIdx.x) * stride;
    for (int k = 0; k < stride; k++) {
        int i = first + k;
        if (i < n) {
            c[i] = a[i] + b[i];
        }
    }
}`,
  python: `@kernel
def add(a, b, c, n, stride):
    # 每个线程连着算 stride 个数：相邻两个线程隔 stride 个数
    first = (blockIdx.x * blockDim.x + threadIdx.x) * stride
    for k in range(stride):
        i = first + k
        if i < n:
            c[i] = a[i] + b[i]`,
}

/** 向量加法：1000 个数（1-1「一千道加法」），调 block 和访问步长。 */
export const VECTOR_ADD: TuneTask = {
  id: 'vector-add',
  goal: `把 ${N} 个数的向量加法调到三星：可以改每组线程数 block 和访问步长 stride。`,
  file: 'add',
  code: VECTOR_ADD_CODE,
  n: N,
  wave: 32,
  blocks: [16, 32, 48, 64, 100, 128, 256],
  strides: [1, 2, 4, 8],
  start: { block: 48, stride: 4 },
  stars: [
    `算对：${N} 个数都对，没有越界`,
    '不多搬：读写显存搬的车数等于理想车数',
    `最快：示意时间不超过 ${BEST_CYCLES} 个周期（模拟）`,
  ],
  bestCycles: BEST_CYCLES,
}

export const TUNE_TASKS: Readonly<Record<string, TuneTask>> = { [VECTOR_ADD.id]: VECTOR_ADD }

/** 按 id 找任务，找不到是 null。 */
export function tuneTask(id: string): TuneTask | null {
  return Object.hasOwn(TUNE_TASKS, id) ? TUNE_TASKS[id] : null
}

/** 一组参数的键，例如 48x4。 */
export function configKey(c: TuneConfig): string {
  return `${c.block}x${c.stride}`
}

export function sameConfig(a: TuneConfig, b: TuneConfig): boolean {
  return a.block === b.block && a.stride === b.stride
}

/** 给人读的写法，例如「block 48、步长 4」。 */
export function describeConfig(c: TuneConfig): string {
  return `block ${c.block}、步长 ${c.stride}`
}

/** 这组参数在不在任务的可选值里。 */
export function inSpace(task: TuneTask, c: TuneConfig): boolean {
  return task.blocks.includes(c.block) && task.strides.includes(c.stride)
}

/** 全部参数，block 在外层、stride 在里层，都从小到大。 */
export function allConfigs(task: TuneTask): TuneConfig[] {
  return task.blocks.flatMap((block) => task.strides.map((stride) => ({ block, stride })))
}

/** 这组参数派几组：每个线程连着算 stride 个数，组数取刚好够用。 */
export function gridOf(task: TuneTask, c: TuneConfig): number {
  return Math.ceil(Math.ceil(task.n / c.stride) / c.block)
}

/** 第 k 个数的正确结果：a[k] = k + 1，b[k] = 10 × (k + 1)。 */
export function expectedAt(k: number): number {
  return 11 * (k + 1)
}

/** 发给模拟器的请求：数据都是普通对象，可以直接发给 Web Worker。 */
export function requestOf(task: TuneTask, c: TuneConfig, lang: Lang): RunRequest {
  const args: Record<string, Arg> = {
    a: { type: 'float', data: Array.from({ length: task.n }, (_, k) => k + 1) },
    b: { type: 'float', data: Array.from({ length: task.n }, (_, k) => 10 * (k + 1)) },
    c: { type: 'float', data: new Array<number>(task.n).fill(0) },
    n: { type: 'int', value: task.n },
    stride: { type: 'int', value: c.stride },
  }
  return { source: task.code[lang], lang, grid: gridOf(task, c), block: c.block, wave: task.wave, args }
}
