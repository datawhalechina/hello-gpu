import type { Component } from 'vue'
import type { SceneMeta } from '../../../../components/animation/sceneTypes'
import TiledLdsScene from './scenes/TiledLdsScene.vue'
import GroupOrderScene from './scenes/GroupOrderScene.vue'

export type MatmulScenario = 'tiled-lds' | 'group-order'

export interface RegisteredScene {
  meta: SceneMeta
  component: Component
}

export const matmulScenes: Record<MatmulScenario, RegisteredScene> = {
  'tiled-lds': {
    component: TiledLdsScene,
    meta: {
      eyebrow: '11.3.2 · HIP · LDS 分块',
      title: '一个 block 沿 K 循环：装载、两道同步、累加',
      viewBox: '0 0 720 420',
      steps: [
        {
          label: '分工',
          title: '4 个线程合作一个 2×2 输出块',
          narration: 'block(0,0) 负责 C 的左上 2×2：每个线程只持有一个 accumulator。A 的 2 列、B 的 2 行组成一对 tile，放进 block 共享的 LDS。',
          duration: 3800
        },
        {
          label: 'tile 0 装载',
          title: '协作装载，然后第一道 __syncthreads()',
          narration: '每个线程写 tile_a[ty][tx] 与 tile_b[ty][tx] 各一格。栅栏保证整个 block 都完成装载，任何线程才能开始读取。',
          duration: 4400
        },
        {
          label: 'tile 0 累加',
          title: 'inner = 0..1：从 LDS 取数乘加',
          narration: '每个线程做 2 次乘加，accumulator 从 0 变成本轮的部分和；随后第二道 __syncthreads()——只有大家都读完了，下一对 tile 才能覆盖 LDS。',
          duration: 4800
        },
        {
          label: 'tile 1',
          title: '新的一对 tile 覆盖两块 LDS',
          narration: '装载、栅栏、累加、栅栏。accumulator 不清零——它跨 K 轮保留部分和。两道同步的对仗是 tiled kernel 的协作约定。',
          duration: 4600
        },
        {
          label: 'tile 2 尾块',
          title: 'K=5：1 列有效，其余填 0',
          narration: '越界格填 0，使对应乘积为 0，乘加照做但不改变结果；两次同步照走——M/N 越界的线程不能提前退出，否则栅栏凑不齐。',
          duration: 4600
        },
        {
          label: '写回',
          title: 'accumulator 即最终答案',
          narration: 'C 的 2×2 块 = [[8,10],[11,12]]。真实 kernel 为 16×16 tile：两块 LDS 共 2048 Byte；两次同步的成本换来 A/B 的 block 级复用。',
          duration: 4400
        }
      ]
    }
  },
  'group-order': {
    component: GroupOrderScene,
    meta: {
      eyebrow: '11.3.4 · Triton · GROUP_M 映射',
      title: 'program 编号顺序：从按行走改为围绕同一列 B',
      viewBox: '0 0 720 420',
      steps: [
        {
          label: '映射',
          title: '只改 program ID → 输出块的映射',
          narration: '两版 Triton kernel 的数学和 tile 完全相同：GROUP_M=1 与 GROUP_M=8 之间只差一段编号计算。',
          duration: 3400
        },
        {
          label: 'GROUP_M=1',
          title: '编号按行走：相邻 program 读不同 B 列',
          narration: 'id 0,1,2,3 对应 (0,0) (0,1) (0,2) (0,3)——每个 program 换一列 B，同一列 B 要被分批多次读取。',
          duration: 4800
        },
        {
          label: 'GROUP_M=8',
          title: '同组行先围绕同一列 B',
          narration: 'id 0,1,2 对应 (0,0) (1,0) (2,0)：同一列 B 被相邻编号连续访问，随后再换到 (0,1) (1,1) (2,1)。12 个 program 只需 1 组。',
          duration: 4800
        },
        {
          label: '缓存动机',
          title: '相邻 program 复用同一片输入',
          narration: '相邻 program 在接近的时间访问同一片 B，这些数据可能仍在缓存中。这是编号与数据位置的安排，不改变任何计算。',
          duration: 3800
        },
        {
          label: '边界',
          title: '安排 ≠ 执行顺序',
          narration: 'GPU 不严格按编号串行执行；缓存命中率是否改善、能否抵消其他开销，仍需实验确认。',
          duration: 3200
        },
        {
          label: '实测',
          title: '9070 XT：0.0987 → 0.0867 ms',
          narration: 'triton-baseline 2.720 TFLOP/s，triton-grouped 3.095 TFLOP/s。同时观察中心值与进程范围：grouped 的范围更宽。数据来自 curated evidence。',
          duration: 4600
        }
      ]
    }
  }
}
