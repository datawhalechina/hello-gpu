<script setup lang="ts">
import ScenePlayer from '../../components/animation/ScenePlayer.vue'
import type { SceneMeta } from '../../components/animation/sceneTypes'
import MathScene from './visuals/scenes/MathScene.vue'
import { MATH_DURATIONS } from './softmax-model'
const steps = [
  { label: '输入', title: '跟踪同一行的三个数', narration: '输入是 1000、1001、1002。原值一直保留在顶行；最大值、分母与输出尚未产生。' },
  { label: '汇入 max', title: '三个输入共同决定一个最大值', narration: '箭头把整行输入送到最大值归约，完成后得到 m=1002。它属于整行，下一步每个位置都需要这个数。' },
  { label: '分发 m', title: '每项输入减去同一个 m', narration: '把 1002 的副本分发给各位置，分别计算 1000−1002、1001−1002、1002−1002，得到 −2、−1、0。顶行原值保留。' },
  { label: '取指数', title: '各位置得到稳定指数', narration: '对 −2、−1、0 分别取指数，得到约 0.1353、0.3679、1.0000。此时还没有分母，也不能写出最终概率。' },
  { label: '汇入 sum', title: '三个指数共同决定一个分母', narration: '把整行指数相加，得到 s≈1.5032；原来的指数仍保留，用于下一步的除法。' },
  { label: '分发 s', title: '每项指数除以同一个 s', narration: '把分母分发给各位置，计算 p/s，得到约 0.0900、0.2447、0.6652。未舍入值的和为 1，四位小数的和为 0.9999，差别来自显示舍入。' }
]
const meta: SceneMeta = {
  eyebrow: '手算示例 · 一行三个值', title: '整行归约，再将标量分发给各位置',
  viewBox: '0 0 720 600', mobileViewBox: '0 0 400 600',
  note: '箭头表示数据依赖与值的副本，不指定物理线程或存储位置；动画速度不表示 GPU 耗时。',
  steps: steps.map((step, i) => ({ ...step, duration: MATH_DURATIONS[i] }))
}
</script>
<template>
  <ScenePlayer :meta="meta">
    <template #stage="{ step, local, compact, reducedMotion }">
      <MathScene :step="step" :local="local" :compact="compact" :reduced-motion="reducedMotion" />
    </template>
  </ScenePlayer>
</template>
