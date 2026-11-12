/**
 * 组件测试样例 里 WaveView 的演示（S-07）。纯数据，单测在 scripts/tests/kit-wave-view.test.mjs。
 *
 * 一个旋钮换三段演示，另一个旋钮换 wave 大小（32 / 64 个 lane）；页面挂载后在 Web Worker 里跑
 * （docs/sim/client.ts），结果和跑的那段代码一起交给 WaveView：
 * 1. 分支：if / else 把一个 wave 分成两拨，两段路径依次执行，每一段都有一半 lane 空转。
 * 2. 同步：每组 64 个线程，wave32 时一组是两个 wave，先走到同步的 wave 停下来等另一个；两组一个接一个。
 * 3. 循环：块内求和，每一轮干活的 lane 减半（16、8、4、2、1），每一轮之后同步一次。
 */
import type { Arg, WaveSize } from '../../../../docs/sim/lockstep.ts'
import type { Lang } from '../../../../docs/sim/syntax/ast.ts'
import type { Launch } from '../../../../docs/components/kit/sandbox/run.ts'

export interface WaveDemo {
  value: string
  label: string
  /** 一句话说清这段演示看什么 */
  note: string
  /** 代码区文件名栏里的名字 */
  file: string
  code: Record<Lang, string>
  /** gridDim.x 和 blockDim.x；wave 大小由页面上的旋钮定 */
  launch: Launch
  args: Record<string, Arg>
}

export const WAVE_SIZES: readonly { value: WaveSize; label: string }[] = [
  { value: 32, label: 'wave32' },
  { value: 64, label: 'wave64' },
]

const BRANCH_CODE: Record<Lang, string> = {
  hip: `__global__ void branch(float* c) {
    int t = threadIdx.x;
    if (t % 2 == 0) {
        c[t] = t * 2.0f;
    } else {
        c[t] = t + 0.5f;
    }
}`,
  python: `@kernel
def branch(c):
    t = threadIdx.x
    if t % 2 == 0:
        c[t] = t * 2.0
    else:
        c[t] = t + 0.5`,
}

const FLIP_CODE: Record<Lang, string> = {
  hip: `__global__ void flip(float* a) {
    __shared__ float s[64];
    int t = threadIdx.x;
    int i = blockIdx.x * blockDim.x + t;
    s[t] = a[i];
    __syncthreads();
    a[i] = s[blockDim.x - 1 - t];
}`,
  python: `@kernel
def flip(a):
    s = shared(64)
    t = threadIdx.x
    i = blockIdx.x * blockDim.x + t
    s[t] = a[i]
    syncthreads()
    a[i] = s[blockDim.x - 1 - t]`,
}

const SUM_CODE: Record<Lang, string> = {
  hip: `__global__ void block_sum(const float* a, float* out) {
    __shared__ float s[32];
    int t = threadIdx.x;
    s[t] = a[t];
    __syncthreads();
    int gap = 16;
    while (gap > 0) {
        if (t < gap) {
            s[t] = s[t] + s[t + gap];
        }
        __syncthreads();
        gap = gap / 2;
    }
    if (t == 0) {
        out[0] = s[0];
    }
}`,
  python: `@kernel
def block_sum(a, out):
    s = shared(32)
    t = threadIdx.x
    s[t] = a[t]
    syncthreads()
    gap = 16
    while gap > 0:
        if t < gap:
            s[t] = s[t] + s[t + gap]
        syncthreads()
        gap = gap // 2
    if t == 0:
        out[0] = s[0]`,
}

const count = (n: number) => Array.from({ length: n }, (_, k) => k + 1)

export const WAVE_DEMOS: readonly WaveDemo[] = [
  {
    value: 'branch',
    label: '分支',
    note: '1 组 32 个线程：threadIdx.x 是偶数的走 if，奇数的走 else。两段路径一段接一段执行，每一段都有一半 lane 空转。换成 wave64 时这一组只占一个 wave 的一半，另一半 lane 没有线程。',
    file: 'branch',
    code: BRANCH_CODE,
    launch: { grid: 1, block: 32 },
    args: { c: { type: 'float', data: new Array<number>(32).fill(0) } },
  },
  {
    value: 'sync',
    label: '同步',
    note: '2 组 × 每组 64 个线程：每个线程把自己的数存进共享数组，同步以后倒着取回来。wave32 时一组是两个 wave，先走到同步的 wave 停下来等另一个；两组一组接一组跑。',
    file: 'flip',
    code: FLIP_CODE,
    launch: { grid: 2, block: 64 },
    args: { a: { type: 'float', data: count(128) } },
  },
  {
    value: 'loop',
    label: '循环',
    note: '1 组 32 个线程把 32 个数加起来：每一轮只有前一半线程干活（16、8、4、2、1 个），其余 lane 空转；每一轮之后都要同步，等大家写完再进下一轮。',
    file: 'block_sum',
    code: SUM_CODE,
    launch: { grid: 1, block: 32 },
    args: { a: { type: 'float', data: count(32) }, out: { type: 'float', data: [0] } },
  },
]
