import type { Component } from 'vue'
import type { SceneMeta } from '../../../../components/animation/sceneTypes'
import MaterializeFlowScene from './scenes/MaterializeFlowScene.vue'
import OnlineSyncScene from './scenes/OnlineSyncScene.vue'

export type AttentionScenario = 'materialize-flow' | 'online-sync'

export interface RegisteredScene {
  meta: SceneMeta
  component: Component
}

export const attentionScenes: Record<AttentionScenario, RegisteredScene> = {
  'materialize-flow': {
    component: MaterializeFlowScene,
    meta: {
      eyebrow: '12.2 · 物化数据流',
      title: 'Scores 和 P 各经历一次全局写入与读取',
      viewBox: '0 0 720 420',
      steps: [
        {
          label: '物化管线',
          title: 'Q、K → Scores → P → O',
          narration: '物化 = 把中间结果真正保存成数组。本章 HIP 基线分三个 kernel：算分数、逐行 Softmax、计算加权和，每一步都留下可检查的数组。',
          duration: 3800
        },
        {
          label: '算分数',
          title: 'dispatch 1：一线程一个点积',
          narration: 'row = index / seq，col = index % seq；内循环对 D 维做点乘，乘 scale 后写进 Scores。S×S 的矩阵第一次落盘。',
          duration: 3800
        },
        {
          label: '行 Softmax',
          title: 'dispatch 2：一 block 一行',
          narration: '读 Scores 的一行，做稳定 Softmax（减最大值、指数、求和、归一化），把概率写进 P。第二个 S×S 数组落盘。',
          duration: 3800
        },
        {
          label: '加权和',
          title: 'dispatch 3：读 P 与 V 写 O',
          narration: '一线程一输出元素：row = index / dim，d = index % dim，沿 key 累加 probabilities[row*seq+col] × value[col*dim+d]。',
          duration: 3800
        },
        {
          label: '往返代价',
          title: '16S² Byte 的逻辑中间数据',
          narration: '两个 FP32 中间数组容量 2S²×4 Byte；按写一次、读一次计算共 16S² Byte（S=128 → 256 KiB）。数的是算法读写，不是硬件计数。',
          duration: 4200
        },
        {
          label: '在线钩子',
          title: '不物化，还能得到同一个加权和吗',
          narration: '问题于是变成：不保存完整 Scores 和 P，能否仍然得到同一个加权和？12.3 的在线路线给出肯定答案——下一张动画拆解它的同步成本。',
          duration: 4200
        }
      ]
    }
  },
  'online-sync': {
    component: OnlineSyncScene,
    meta: {
      eyebrow: '12.4 · HIP · 在线单 kernel',
      title: '每个 key 的同步时间线：归约、更新、广播、累计',
      viewBox: '0 0 720 430',
      steps: [
        {
          label: '初始化',
          title: '状态三件套：m = −∞、l = 0、a = 0',
          narration: 'block 的两个线程各负责 D 的一个分量。部分点积先各自计算，随后在 LDS 中归约出一个 score。',
          duration: 3600
        },
        {
          label: 'key 0',
          title: 'score=2：状态从单位元起飞',
          narration: 'm′=2，α=e^(−∞−2)=0（旧状态清零），β=e⁰=1；l=1，a=[1,0]。每个 key 至少两道屏障：广播系数一道，更新 numerator 后一道。',
          duration: 5000
        },
        {
          label: 'key 1',
          title: 'score=1：最大值没变，历史不用换尺度',
          narration: 'α=e⁰=1，β=e⁻¹≈0.3679；l=1.3679，a=[1, 0.7358]。旧累计原样保留，只追加 β·V₁。',
          duration: 4600
        },
        {
          label: 'key 2',
          title: 'score=4：旧 l、旧 a 同乘 α=e⁻²',
          narration: '新最大值迫使历史状态换尺度：恒等式 e^(s−m′) = e^(s−m)·e^(m−m′) 正好给出这一系数。l=1.1851，a=[3.1353, 1.0995]。',
          duration: 5000
        },
        {
          label: '输出',
          title: 'O = a / l = [2.6456, 0.9278]',
          narration: '与物化计算得到相同的数学结果；归一化留到扫描完全部 key 之后一次完成。',
          duration: 3800
        },
        {
          label: '成本',
          title: '少写回 ≠ 更快',
          narration: '每个 key 至少 2 次 block 同步，且 query 没有跨行复用：hip-online 0.2274 ms 约为物化版 3.9 倍。减少中间写回只是收益的一面。',
          duration: 4800
        }
      ]
    }
  }
}
