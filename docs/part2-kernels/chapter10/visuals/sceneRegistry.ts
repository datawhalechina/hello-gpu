import type { Component } from 'vue'
import type { SceneMeta } from '../../../components/animation/sceneTypes'
import { BARRIER_DURATIONS } from '../softmax-model'
import FusedRowScene from './scenes/FusedRowScene.vue'
import ThreeKernelScene from './scenes/ThreeKernelScene.vue'
export type SoftmaxScenario = 'fused-row' | 'three-kernel'
export interface RegisteredScene { meta: SceneMeta; component: Component; static?: boolean }
const barrierSteps = [
  { label: '最大值就位', title: 'shared[0] 保存最大值，读者尚未取得副本', narration: '沿用输入 [1000,1001,1002]，最大值树已经完成。这里只观察同一 block 的线程 0 和线程 32，它们属于不同 wave；其余 254 个线程省略。' },
  { label: '各自读取', title: '读出副本，原来的 shared[0] 保持 1002', narration: '两个代表线程先后取得 maximum=1002 的副本。画面结束时，本例整个 block 的读者都已读完；在此之前，任何线程都不能抢先将 shared[0] 改作 sum。' },
  { label: '全组同步', title: '所有线程共同经过读者屏障', narration: '全 block 到达这道 __syncthreads()，才能继续写下一轮共享数据。前面的树屏障保证最大值已写好，这道屏障保证所有线程已读完；它们保护的是不同的依赖。' },
  { label: '允许覆盖', title: '线程 0 写局部 sum，maximum 的副本仍为 1002', narration: '本例只有 3 列、block=256，因此线程 0 只负责第 0 列。它算出 exp(1000−1002)≈0.1353，再写到 shared[0]。共享槽的用途变了，各线程自己的 maximum 副本继续保留，供后续运算使用。' }
]
export const softmaxScenes: Record<SoftmaxScenario, RegisteredScene> = {
  'fused-row': {
    component: FusedRowScene,
    meta: {
      eyebrow: 'HIP · 同一共享槽的两种用途', title: '读完最大值，才能覆盖共享槽',
      viewBox: '0 0 720 476', mobileViewBox: '0 0 400 620',
      note: '只跟踪 shared[0] 与两个代表读者；其余线程也须经过全 block 屏障。副本表示局部变量，动画节奏不是实际调度或耗时。',
      steps: barrierSteps.map((step, i) => ({ ...step, duration: BARRIER_DURATIONS[i] }))
    }
  },
  'three-kernel': {
    component: ThreeKernelScene, static: true,
    meta: { eyebrow: 'HIP · 三次调用的存储交接', title: '同一行通过全局数组交接', viewBox: '0 0 720 640', mobileViewBox: '0 0 400 640', steps: [] }
  }
}
