import type { Component } from 'vue'
import type { SceneMeta } from '../../../../components/animation/sceneTypes'
import SerialVsBlockScene from './scenes/SerialVsBlockScene.vue'

export type RmsnormScenario = 'serial-vs-block'

export interface RegisteredScene {
  meta: SceneMeta
  component: Component
}

export const rmsnormScenes: Record<RmsnormScenario, RegisteredScene> = {
  'serial-vs-block': {
    component: SerialVsBlockScene,
    meta: {
      eyebrow: '13.3 · HIP · 行内分工',
      title: '一行尺度：serial 长链 vs block 树归约',
      viewBox: '0 0 720 500',
      steps: [
        {
          label: '两种分工',
          title: '同一行，两种行内协作方式',
          narration: 'serial 用一个线程顺序处理一行；block 用一整个 block 合作（图中 4 线程，真实 block=256）。行的尺度 r 由整行平方和决定。',
          duration: 3600
        },
        {
          label: 'serial 求和',
          title: '平方和是一条 4 步长链',
          narration: 'square_sum = 3²+4²+3²+4² = 50。不同的行可以同时算，但同一行的累加后一步等前一步——这正是串行的含义。',
          duration: 4200
        },
        {
          label: 'serial 写回',
          title: 'r = rsqrtf(50/4 + ε) ≈ 0.2828',
          narration: '第二遍循环逐列写 y = x·r·w。一行数据被完整扫描两遍。',
          duration: 3800
        },
        {
          label: 'block 局部',
          title: '每线程只算自己列的平方',
          narration: 'tid 处理 tid、tid+blockDim.x……这些列；图中每线程一列。没有有效列的线程 square_sum 仍为 0，正常参与归约。',
          duration: 3800
        },
        {
          label: '写 LDS',
          title: '部分和放入 shared[tid]，第一次同步',
          narration: 'LDS 写入之后必须 __syncthreads()：不能因为某个线程本轮不做加法，就让它跳过屏障。',
          duration: 3800
        },
        {
          label: '树归约',
          title: 'stride = 2 → 1：shared[0] = 50',
          narration: '每一轮树归约之后都要同步。平均值除以 cols=4，不是线程数——这是 13.3 的第三个易错点。',
          duration: 4200
        },
        {
          label: '广播写回',
          title: 'r 广播给全线程，各写各的列',
          narration: '所有线程读取 shared[0] 后这块 LDS 不再被覆盖，因此不需要第 10 章式的读者屏障——判断屏障要看数据的下一次使用。',
          duration: 4400
        },
        {
          label: '实测',
          title: '9070 XT：1.5049 → 0.0584 ms',
          narration: 'block 约为 serial 的 25.8 倍。分工改变的是同一行内的协作方式；两版输出与本章开头的手算一致。',
          duration: 4800
        }
      ]
    }
  }
}
