/**
 * 组件测试样例 里 RobotGrid 的演示（S-06）。纯数据和纯函数，单测在 scripts/tests/kit-robot-grid.test.mjs。
 *
 * 一个旋钮换三段演示，页面挂载后在 Web Worker 里跑（docs/sim/client.ts），结果交给 RobotGrid：
 * 1. 五种状态：一段故意写错的 kernel，一次跑出试点关卡的五种状态——组和组之间重叠（重复计算）、
 *    组内隔一个拿（没人算）、条件多放过了两个（越界写），其余的线程被条件拦下（检查后跳过）。
 * 2. 200 个线程：向量加法，线程超过 64 个，机器人换成小号的；格子超过 64 个，换成密排的小方块。
 * 3. 1024 个线程：向量加法，线程超过 256 个，按组汇总；也用来看逐步播放流不流畅。
 */
import type { Arg } from '../../../../docs/sim/lockstep.ts'
import type { Lang } from '../../../../docs/sim/syntax/ast.ts'
import type { Launch } from '../../../../docs/components/kit/sandbox/run.ts'

export interface GridDemo {
  value: string
  label: string
  /** 一句话说清这段演示看什么 */
  note: string
  code: Record<Lang, string>
  launch: Launch
  args: Record<string, Arg>
}

const SHOW_N = 14

const SHOW_CODE: Record<Lang, string> = {
  hip: `__global__ void show(float* c, int n) {
    // 故意写错：每组只往后挪 3 格，组内又隔一个拿
    int i = blockIdx.x * 3 + threadIdx.x * 2;
    if (i < n + 2) {  // 条件多放过了两个
        c[i] = 1.0f;
    }
}`,
  python: `@kernel
def show(c, n):
    # 故意写错：每组只往后挪 3 格，组内又隔一个拿
    i = blockIdx.x * 3 + threadIdx.x * 2
    if i < n + 2:  # 条件多放过了两个
        c[i] = 1.0`,
}

export const ADD_CODE: Record<Lang, string> = {
  hip: `__global__ void add(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) {
        c[i] = a[i] + b[i];
    }
}`,
  python: `@kernel
def add(a, b, c, n):
    i = blockIdx.x * blockDim.x + threadIdx.x
    if i < n:
        c[i] = a[i] + b[i]`,
}

/** 向量加法的数据：a[k] = k + 1，b[k] = 10 × (k + 1)，c 全是 0。 */
export function addArgs(n: number): Record<string, Arg> {
  return {
    a: { type: 'float', data: Array.from({ length: n }, (_, k) => k + 1) },
    b: { type: 'float', data: Array.from({ length: n }, (_, k) => 10 * (k + 1)) },
    c: { type: 'float', data: new Array<number>(n).fill(0) },
    n: { type: 'int', value: n },
  }
}

export const GRID_DEMOS: readonly GridDemo[] = [
  {
    value: 'states',
    label: '五种状态',
    note: `${SHOW_N} 个格子，派出 5 组 × 每组 4 个线程，下标故意算错：一次跑出写入、重复计算、没人算、越界写、检查后跳过。`,
    code: SHOW_CODE,
    launch: { grid: 5, block: 4 },
    args: { c: { type: 'float', data: new Array<number>(SHOW_N).fill(0) }, n: { type: 'int', value: SHOW_N } },
  },
  {
    value: 'mini',
    label: '200 个线程',
    note: '向量加法，n = 190，派出 5 组 × 每组 40 个：线程超过 64 个，换成小号机器人；格子超过 64 个，换成小方块。',
    code: ADD_CODE,
    launch: { grid: 5, block: 40 },
    args: addArgs(190),
  },
  {
    value: 'blocks',
    label: '1024 个线程',
    note: '向量加法，n = 1000，派出 4 组 × 每组 256 个：线程超过 256 个，按组汇总。切到「逐步播放」看 96 步的播放。',
    code: ADD_CODE,
    launch: { grid: 4, block: 256 },
    args: addArgs(1000),
  },
]
