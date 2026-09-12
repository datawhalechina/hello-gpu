import type { Component } from 'vue'
import type { SceneMeta } from '../../../components/animation/sceneTypes'
import FusedRowScene from './scenes/FusedRowScene.vue'
import ThreeKernelScene from './scenes/ThreeKernelScene.vue'

export type SoftmaxScenario = 'fused-row' | 'three-kernel'

export interface RegisteredScene {
  meta: SceneMeta
  component: Component
}

export const softmaxScenes: Record<SoftmaxScenario, RegisteredScene> = {
  'fused-row': {
    component: FusedRowScene,
    meta: {
      eyebrow: '10.5.2 · HIP · 一 block 一行',
      title: 'LDS 复用的时间线：max 树、读者屏障、sum 树',
      viewBox: '0 0 720 400',
      steps: [
        {
          label: '跨步扫描',
          title: 'lane 沿列跨步，先求局部 max',
          narration: 'block 的 4 个线程沿列跨步：t0–t2 分别读到 1000、1001、1002；t3 没有有效列，局部 max 停留在初值 −∞——单位元参与归约但不改变结果。',
          duration: 4000
        },
        {
          label: '写入 LDS',
          title: '每个线程写入自己的局部 max',
          narration: 'shared[0..3] = [1000, 1001, 1002, −∞]。先完成协作写入并同步，下一步才能读取其他线程的槽位。',
          duration: 4200
        },
        {
          label: '最大值就位',
          title: 'stride=2 → 1：shared[0] = 1002',
          narration: '第一轮合并前后半区，第二轮合并两个部分最大值，得到 1002。各线程读取最大值后，还要再同步，才能安全地复用 LDS。',
          duration: 3600
        },
        {
          label: '读者屏障',
          title: '所有线程读完 maximum，LDS 才能改作 sum 空间',
          narration: '这是 2026-09-11 修复的缺陷：如果一个 wavefront 先覆盖 shared[0]，另一个尚未读取最大值的 wavefront 就会拿错数据。复用共享存储要同时照顾写者和读者。',
          duration: 4600
        },
        {
          label: 'sum 树',
          title: '复用同一块 LDS 求分母',
          narration: '各线程重算 p = e^(x−m) 写回 LDS：0.1353、0.3679、1、0。树归约两轮后 shared[0] = 1.5032，即整行的分母。',
          duration: 4600
        },
        {
          label: '写回',
          title: '最后一遍输入：重算 exp 并归一化',
          narration: 'output = expf(x − maximum) / denominator：得到 0.0900、0.2447、0.6652。源码扫描输入三次、重算指数两次，换来免掉全局 exp_tmp。',
          duration: 4200
        },
        {
          label: '实测',
          title: '9070 XT：融合约为 baseline 的六分之一',
          narration: 'hip-baseline-3kernel 0.744 ms，hip-fused-block-lds 0.116 ms；中间数组 exp_tmp（16 MiB）被整体省去。数据来自 2026-07-19 curated evidence。',
          duration: 5000
        }
      ]
    }
  },
  'three-kernel': {
    component: ThreeKernelScene,
    meta: {
      eyebrow: '10.5.1 · HIP · baseline 三 kernel',
      title: '中间结果放在全局数组里的代价',
      viewBox: '0 0 720 500',
      steps: [
        {
          label: '三个 kernel',
          title: '一条用全局数组串起来的链',
          narration: '行最大值 → 指数与行和 → 归一化。三个 dispatch 之间传递的不是寄存器，而是 row_max、exp_tmp、row_sum 三个全局数组。',
          duration: 3800
        },
        {
          label: 'dispatch 1',
          title: '一线程一行，写出 row_max',
          narration: '每个线程串行扫一整行求最大值。相邻线程处理相邻行，读取地址相隔 columns 个元素——这与读取相邻列的映射完全不同。',
          duration: 3800
        },
        {
          label: 'dispatch 2',
          title: '指数物化进 exp_tmp',
          narration: '第二次 dispatch 读 X 与 row_max，把每个元素的指数写进 exp_tmp，同时累计 row_sum。4096×1024 的 exp_tmp 占 16 MiB 显存。',
          duration: 3800
        },
        {
          label: 'dispatch 3',
          title: '归一化写回 Y',
          narration: '一线程一元素：output[index] = exponentials[index] / row_sum[index / columns]。exp_tmp 被整读一遍。',
          duration: 3800
        },
        {
          label: '往返代价',
          title: 'exp_tmp 写一次读一次 = 32 MiB',
          narration: '按每个数组写一次、读一次计算，仅 exp_tmp 就有 32 MiB 逻辑访问，外加两次 dispatch 的启动与往返。这是算法读写数，不是硬件事务计数。',
          duration: 4000
        },
        {
          label: '融合对照',
          title: '把整行交给同一组执行单元',
          narration: '融合路线在同一 block 内完成 max → exp → sum → normalize：实测 0.744 → 0.116 ms。执行时间线见下一张动画。',
          duration: 4600
        }
      ]
    }
  }
}
