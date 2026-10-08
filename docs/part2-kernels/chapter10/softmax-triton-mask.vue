<script setup lang="ts">
import ScenePlayer from '../../components/animation/ScenePlayer.vue'
import type { SceneMeta } from '../../components/animation/sceneTypes'
import TritonMaskScene from './visuals/scenes/TritonMaskScene.vue'
import { MASK_DURATIONS } from './softmax-model'
const steps = [
  { label: '输入与位置', title: '3 个真实列，用 4 个逻辑位置表示', narration: '输入为 −1002、−1001、−1000。program 的逻辑向量宽度 B=4，第四个位置没有对应的输入元素。这些格子是逻辑位置，不是四个物理线程。' },
  { label: '按 mask 加载', title: '有效位置读取输入，无效位置填负无穷', narration: '前三个位置取得真实输入的副本；第四个位置的 load mask 为假，不读取行外地址，使用 other=−∞。原输入仍保留。' },
  { label: '最大值', title: '负无穷不改变这一行的最大值', narration: '四个逻辑值共同做 max，结果仍为 −1000。若无效位置填 0，它反而会胜过所有真实的负输入；所以 load 的补值必须符合归约语义。' },
  { label: '指数与分母', title: '无效位置的指数为 0', narration: '减去 −1000 后，逻辑值为 −2、−1、0、−∞；取指数得到约 0.1353、0.3679、1、0。第四项给 sum 贡献 0，分母仍为约 1.5032。' },
  { label: '按 mask 写回', title: '只有前三个结果写入输出', narration: '前三个指数分别除以同一个分母，得到约 0.0900、0.2447、0.6652。store mask 仍只允许前三个位置写入；第四个逻辑位置不会创建一个额外输出。' }
]
const meta: SceneMeta = {
  eyebrow: 'Triton · 一行一个 program', title: '补齐逻辑向量，保持原来三列的答案',
  viewBox: '0 0 720 660', mobileViewBox: '0 0 400 660',
  note: '负数行手算示例。B 是逻辑宽度，具体线程映射由编译器安排；动画时间不代表 GPU 耗时。',
  steps: steps.map((step, i) => ({ ...step, duration: MASK_DURATIONS[i] }))
}
</script>
<template>
  <ScenePlayer :meta="meta">
    <template #stage="{ step, local, compact, reducedMotion }">
      <TritonMaskScene :step="step" :local="local" :compact="compact" :reduced-motion="reducedMotion" />
    </template>
  </ScenePlayer>
</template>
