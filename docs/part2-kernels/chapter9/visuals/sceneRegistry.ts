import type { Component } from 'vue'
import type { SceneMeta } from '../../../components/animation/sceneTypes'
import WaveShuffleScene from './scenes/WaveShuffleScene.vue'
import TwoStageScene from './scenes/TwoStageScene.vue'

export type ReductionScenario = 'shuffle' | 'two-stage'

export interface RegisteredScene {
  meta: SceneMeta
  component: Component
}

export const reductionScenes: Record<ReductionScenario, RegisteredScene> = {
  shuffle: {
    component: WaveShuffleScene,
    meta: {
      eyebrow: '9.4.3 · HIP · wavefront 内归约',
      title: '__shfl_down：寄存器之间的求和树',
      viewBox: '0 0 720 330',
      steps: [
        {
          label: '8 个 lane',
          title: '每个 lane 的寄存器里有一个输入',
          narration: '8 个 lane 分别持有 3、1、7、0、4、1、6、2。shuffle 直接读其他 lane 的寄存器，不经过 LDS，也不需要 block 屏障。',
          duration: 3200
        },
        {
          label: 'offset=4',
          title: 'lane 0–3 吸收 lane 4–7 的值',
          narration: 'offset = warpSize/2 = 4：lane i 读取 lane i+4 并相加，得到 7、2、13、2。本图只继续追踪最终和依赖的前半区，并不表示其他 lane 停止执行。',
          duration: 4200
        },
        {
          label: 'offset=2',
          title: '继续追踪 lane 0–1',
          narration: 'offset = 2：lane 0 吸收 lane 2 得到 20，lane 1 吸收 lane 3 得到 4。寄存器交换仍在 wavefront 内部完成。',
          duration: 3600
        },
        {
          label: 'offset=1',
          title: '最后一轮合并',
          narration: 'offset = 1：lane 0 吸收 lane 1 的部分和。三轮短依赖之后，整段的和已经落进一个寄存器。',
          duration: 3200
        },
        {
          label: '交出结果',
          title: 'lane 0 持有 24',
          narration: '只有 lane 0 的结果会被采用：它随后写入 LDS 或 partials，等待 block 与第二阶段继续合并——下一张动画接上这一步。',
          duration: 3600
        }
      ]
    }
  },
  'two-stage': {
    component: TwoStageScene,
    meta: {
      eyebrow: '9.4.3 → 9.5 · HIP · 两阶段归约',
      title: '先压规模，再一次合并',
      viewBox: '0 0 720 540',
      steps: [
        {
          label: '第一遍读取',
          title: '先做局部工作：每个线程认领自己的下标',
          narration: 'first = blockIdx×4 + thread：block 0 的 4 个线程读下标 0–3，block 1 读 4–7。local 只属于当前线程，更新它不需要同步。',
          duration: 3600
        },
        {
          label: '第二遍读取',
          title: 'grid-stride：同一个线程再走一步',
          narration: '下标整体 +8（grid_stride = gridDim×blockDim）：线程把第二遍的输入累加进同一个 local。16 个输入现在只剩 8 个局部和。',
          duration: 4200
        },
        {
          label: '组内合并',
          title: '每个 block 内部合成一个和',
          narration: 'block 0 内 shuffle/LDS 树把 6、2、14、0 合成 22；block 1 把 8、2、12、4 合成 26。组内合并是第一层收敛。',
          duration: 4600
        },
        {
          label: '交出 partial',
          title: '每组交出一个 partial',
          narration: '每个 block 把结果写进自己独占的 partials[blockIdx.x]：[22, 26]。第一阶段到此结束，全局内存里只有一份很小的 partial 数组。',
          duration: 3800
        },
        {
          label: '跨组合并',
          title: '第二阶段 kernel 读取 partial 数组',
          narration: '普通 block 屏障管不到跨 block 的顺序；同一 stream 的第二次 kernel 启动给出明确边界，读 partials 求 22 + 26 = 48。',
          duration: 4200
        },
        {
          label: '实测对照',
          title: '9070 XT 实测：三个层次的差距',
          narration: '同一道题：hip-atomic 34.46 ms、hip-lds 4.33 ms、hip-two-stage 0.059 ms。层次决定了量级；数字来自 2026-07-19 curated evidence。',
          duration: 5000
        }
      ]
    }
  }
}
