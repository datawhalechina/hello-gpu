/**
 * 组件测试样例 里 MemoryView 的演示（S-08）。纯数据，单测在 scripts/tests/kit-memory-view.test.mjs。
 *
 * 一个旋钮换演示，跨步读还有一个旋钮换步长；页面挂载后在 Web Worker 里跑（docs/sim/client.ts），
 * 同一次运行交给 RobotGrid 和 MemoryView：固定（点一下）一个机器人，访存视图翻到它那一次访存、描出它要的地址。
 * 1. 跨步读：y[i] = x[i * stride]，一组 32 个线程，正好一个 wave32。读 x 时步长 1 搬一车，步长 2 两车，
 *    步长 32 每个 lane 一车（和 S-03 的标准例 2 一样）；步长 0 是 32 个 lane 都读 x[0]（广播），只搬一车。
 * 2. 向量加法：40 个数、一组 64 个线程，两个 wave。wave 1 只有 8 个 lane 在干活，也要搬整整一车，
 *    车里后 24 格不是这个数组的地方。
 * 另有一个完整模式的沙盒（MEM_SANDBOX）：改下标，点「运行」看整段，点「单步」一步一步看。
 */
import type { Arg } from '../../../../docs/sim/lockstep.ts'
import type { Lang } from '../../../../docs/sim/syntax/ast.ts'
import type { Launch } from '../../../../docs/components/kit/sandbox/run.ts'
import { ADD_CODE, addArgs } from './robot-grid-demo.ts'

export interface MemDemo {
  value: string
  label: string
  /** 一句话说清这段演示看什么 */
  note: string
  code: Record<Lang, string>
  launch: Launch
  /** 数据：跨步读按步长给，向量加法不看步长 */
  args: (stride: number) => Record<string, Arg>
  /** RobotGrid 画哪个数组（被写的那个） */
  grid: string
  /** 有没有步长旋钮 */
  strided: boolean
}

/** 步长旋钮的可选值；0 是 32 个 lane 都读 x[0]（广播） */
export const MEM_STRIDES = [
  { value: 0, label: '0（广播）' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 32, label: '32' },
] as const

const WAVE_BLOCK = 32
/** 跨步读的数据：x[k] = k，一共 1024 个，步长 32 时最后一个 lane 读 x[992]，还在数组里；y 全是 0 */
const X: Arg = { type: 'float', data: Array.from({ length: 1024 }, (_, k) => k) }
const Y: Arg = { type: 'float', data: new Array<number>(WAVE_BLOCK).fill(0) }

const STRIDE_CODE: Record<Lang, string> = {
  hip: `__global__ void strided(const float* x, float* y, int stride) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    y[i] = x[i * stride];
}`,
  python: `@kernel
def strided(x, y, stride):
    i = blockIdx.x * blockDim.x + threadIdx.x
    y[i] = x[i * stride]`,
}

export const MEM_DEMOS: readonly MemDemo[] = [
  {
    value: 'stride',
    label: '跨步读',
    note: `y[i] = x[i * stride]：一组 ${WAVE_BLOCK} 个线程，正好一个 wave32。换步长，看读 x 要搬几车：步长 1 一车，步长 2 两车，步长 32 每个 lane 一车；写 y 一直是一车。`,
    code: STRIDE_CODE,
    launch: { grid: 1, block: WAVE_BLOCK },
    args: (stride) => ({ x: X, y: Y, stride: { type: 'int', value: stride } }),
    grid: 'y',
    strided: true,
  },
  {
    value: 'add',
    label: '向量加法',
    note: '40 个数，一组 64 个线程，两个 wave：wave 1 只有 8 个 lane 在干活，读 a、读 b、写 c 也各要搬整整一车，车里后 24 格不是这个数组的地方。',
    code: ADD_CODE,
    launch: { grid: 1, block: 64 },
    args: () => addArgs(40),
    grid: 'c',
    strided: false,
  },
]

/** 沙盒里的跨步读：步长写在代码里，读者改下标再运行、单步 */
export const MEM_SANDBOX: { code: Record<Lang, string>; launch: Launch; args: Record<string, Arg> } = {
  code: {
    hip: `__global__ void strided(const float* x, float* y) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    y[i] = x[i * 2];
}`,
    python: `@kernel
def strided(x, y):
    i = blockIdx.x * blockDim.x + threadIdx.x
    y[i] = x[i * 2]`,
  },
  launch: { grid: 1, block: WAVE_BLOCK },
  args: { x: X, y: Y },
}
