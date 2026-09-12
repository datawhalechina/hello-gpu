import type { Component } from 'vue'
import type { SceneMeta } from './sceneTypes'
import DependencyScene from './scenes/DependencyScene.vue'
import ParadigmScene from './scenes/ParadigmScene.vue'
import MemoryScene from './scenes/MemoryScene.vue'
import VectorScene from './scenes/VectorScene.vue'
import TritonScene from './scenes/TritonScene.vue'
import { INPUT_A, INPUT_B, MEASURED_BANDWIDTH, OUTPUT_C } from './scenes/data'

export type Scenario = 'dependency' | 'paradigm' | 'memory' | 'vector' | 'triton'

export interface RegisteredScene {
  meta: SceneMeta
  component: Component
}

const dependencySteps = [
  ...INPUT_A.map((a, i) => ({
    label: `位置 ${i}`,
    title: `位置 ${i}：只读自己的两个输入`,
    narration: `位置 ${i} 只读取 A[${i}]=${a} 与 B[${i}]=${INPUT_B[i]}，得到 C[${i}]=${OUTPUT_C[i]}，其他位置不受影响。`
  })),
  {
    label: '并行俯瞰',
    title: '乱序完成也一样成立',
    narration:
      '把 8 列的完成顺序故意打乱：每个位置只依赖自己的两个输入，谁先算完都行——这正是逐元素算子可以大规模并行的原因。',
    duration: 4200
  }
]

const stridedRound = (round: number) =>
  Array.from({ length: 8 }, (_, lane) => lane * 4 + round).join(', ')

export const sceneRegistry: Record<Scenario, RegisteredScene> = {
  dependency: {
    component: DependencyScene,
    meta: {
      eyebrow: '8.1 语义层 · Element-Wise',
      title: '位置 i 独立计算 C[i] = A[i] + B[i]',
      viewBox: '0 0 720 330',
      steps: dependencySteps
    }
  },
  paradigm: {
    component: ParadigmScene,
    meta: {
      eyebrow: '编程范式 · HIP / Triton',
      title: '同一个 Vector Add，两种分工视角',
      viewBox: '0 0 720 396',
      steps: [
        {
          label: '固定问题',
          title: '先固定问题：只允许写回有效位置 0–5',
          narration: 'N=6，但启动范围覆盖位置 0–7；两种写法都只能写回 C[0] 到 C[5]。',
          duration: 3200
        },
        {
          label: 'HIP 展开',
          title: 'HIP：每个 thread 拿一个标量 i',
          narration: 'HIP kernel 描述一个线程的工作：当前线程得到标量下标 i，线程 6 和 7 由 if 关闭。',
          duration: 4200
        },
        {
          label: 'Triton 展开',
          title: 'Triton：每个 program 拿一块 offsets',
          narration: 'Triton kernel 描述一个 program 的工作：当前 program 生成一块 offsets，超出 N 的位置由 mask 关闭。',
          duration: 4200
        },
        {
          label: '逐项对照',
          title: '数学不变，但概念不是等价替换',
          narration: 'HIP 从 thread 生成标量 i，Triton 从 program 生成一块 offsets；两条路径最终都只写回有效位置 0–5。',
          duration: 4600
        }
      ]
    }
  },
  memory: {
    component: MemoryScene,
    meta: {
      eyebrow: '8.4 HIP · 合并访存 · 8-lane 教学缩略',
      title: '同样 8 个 lane，地址排法决定触及几组',
      viewBox: '0 0 720 420',
      steps: [
        {
          label: '两种排法',
          title: '同一批元素，两种下标排法',
          narration:
            '同样 8 个 lane、同样 32 个元素。唯一变量：每轮内 lane 到下标的排列——左边 index = round×8+lane（连续），右边 index = lane×4+round（跨步）。',
          duration: 3400
        },
        ...[0, 1, 2, 3].map(round => ({
          label: `第 ${round + 1} 轮`,
          title: `第 ${round + 1} 轮：8 个 lane 的地址飞向内存`,
          narration: `连续排列的 8 个下标 [${round * 8}…${round * 8 + 7}] 全部落进同一个 32B 组（本轮 1 组）；跨步排列 [${stridedRound(round)}] 散布在 4 个组（本轮 4 组）。`,
          duration: 3400
        })),
        {
          label: '累计落点',
          title: '4 轮累计：打包次数差 4 倍',
          narration: '同样是每轮读 8 个元素、读 4 轮：连续累计只触及 4 个 32B 组，跨步累计触及 16 个组。',
          duration: 4400
        },
        {
          label: '实测带宽',
          title: '9070 XT 实测：差距约 6.95×',
          narration: `连续 ${MEASURED_BANDWIDTH.contiguous.toFixed(1)} GB/s，跨步 ${MEASURED_BANDWIDTH.strided.toFixed(1)} GB/s（N=16,777,216，hip-v1 两版，口径见 8.5.2）。32B 分桶是教学模型，不是硬件事务计数。`,
          duration: 5000
        }
      ]
    }
  },
  vector: {
    component: VectorScene,
    meta: {
      eyebrow: '8.4 HIP · float4 向量化',
      title: '四个 FP32 组成 float4，尾部单独处理',
      viewBox: '0 0 720 340',
      steps: [
        {
          label: '标量布局',
          title: '先把 A 看成 18 个独立元素',
          narration: 'N=18 个 FP32，每个占 4 Byte——这是 v0/v1/v2 标量世界的做法。',
          duration: 3000
        },
        {
          label: 'float4 分组',
          title: '前 16 个元素组成 4 个 float4',
          narration: 'A[0–15] 在源码中重解释为 4 个 float4 组；四组同时成立，动画的先后只是讲解顺序。',
          duration: 4000
        },
        {
          label: '标量尾部',
          title: '最后 2 个元素走标量路径',
          narration: 'A[16]、A[17] 不足一组，回到标量路径逐个处理。',
          duration: 3200
        },
        {
          label: '边界与代价',
          title: '源码重解释 ≠ 物理事务减少',
          narration: 'float4 只是源码层面的类型重解释，不等于物理显存事务一定减少；输入 B 的读取与输出 C 的写回采用同样分组。',
          duration: 4000
        }
      ]
    }
  },
  triton: {
    component: TritonScene,
    meta: {
      eyebrow: '8.4 Triton · Tile · N=13, BLOCK_SIZE=8',
      title: '生成 offsets，再用 mask 关掉越界位置',
      viewBox: '0 0 720 400',
      steps: [
        {
          label: 'P0 · 读取 A',
          title: 'P0 · 读取 A：offsets 全部有效',
          narration: 'program 0 生成 offsets=[0…7]，mask 全为 true：从 A 读取 8 个位置。',
          duration: 3600
        },
        {
          label: 'P0 · 读取 B',
          title: 'P0 · 读取 B：同一组 offsets',
          narration: '同一组 offsets 从 B 读取对应位置，mask 仍然全为 true。',
          duration: 3600
        },
        {
          label: 'P0 · A+B',
          title: 'P0 · 逐位置相加',
          narration: '8 个位置各自执行 c = a + b；mask=true 的位置全部参与。',
          duration: 3000
        },
        {
          label: 'P0 · 写回 C',
          title: 'P0 · 写回 C',
          narration: '结果写回 C[0–7]，全部是有效位置。',
          duration: 3600
        },
        {
          label: 'P1 · 读取 A',
          title: 'P1 · 读取 A：3 个越界位置',
          narration: 'program 1 生成 offsets=[8…15]，其中 13、14、15 mask=false：加载用 other=0 填充，不产生越界访问。',
          duration: 3600
        },
        {
          label: 'P1 · 读取 B',
          title: 'P1 · 读取 B：越界位置同样填充',
          narration: 'mask=false 的位置继续用 other=0 填充，这些地址从未被发送到内存。',
          duration: 3600
        },
        {
          label: 'P1 · A+B',
          title: 'P1 · 相加：填充值的结果不会写回',
          narration: '加法仍按位置计算；13–15 的输入由 other=0 填充。下一步 tl.store 使用 mask，只写回有效位置的结果。',
          duration: 3000
        },
        {
          label: 'P1 · 写回 C',
          title: 'P1 · 写回 C：13–15 不写回',
          narration: '结果只写回 C[8–12]；13–15 从未写回，越界地址全程没有被触碰。',
          duration: 3600
        }
      ]
    }
  }
}
