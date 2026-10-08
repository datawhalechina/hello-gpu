<script setup lang="ts">
import { computed } from 'vue'
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import type { SceneMeta } from '../../components/animation/sceneTypes'
import { DURATION_MS } from './attention-model'
import WeightedSumScene from './visuals/scenes/WeightedSumScene.vue'
import OnlineStateScene from './visuals/scenes/OnlineStateScene.vue'
const props = withDefaults(defineProps<{ mode?: 'weighted' | 'online' }>(), { mode: 'online' })
const descriptions = {
  weighted: [
    ['输入', '固定一个 query 的三个 key', '三个 score 是 2、1、4；每个 V 都有两个分量。先保留这些输入，输出还未写出。'],
    ['概率', '将三个 score 转成概率', '减去最大值 4，计算指数再除以指数和。得到三个概率，它们各自用于对应 V 的两个分量。'],
    ['key 0', '第一项贡献进入两个累计值', 'p₀ 乘 V₀=[1,0]，得到 [0.1142,0]。两个分量分别累加；源概率和 V 不会被移走。'],
    ['key 1', '第二项只增加分量 1', 'p₁ 乘 V₁=[0,2]，得到 [0,0.0840]。零分量也按同一乘法规则处理。'],
    ['key 2', '第三项贡献加入已有累计', 'p₂ 乘 V₂=[3,1]，得到 [2.5314,0.8438]，分别加到两个已有累计值上。'],
    ['输出', '三个 key 全部处理完，写出 O', '最终 O≈[2.6456,0.9278]。一个概率是标量，一次乘法却贡献整个向量。'],
  ],
  online: [
    ['初始化', '为同一行保留三个状态', 'm 是最大值，l 是指数和，a 有两个加权累计分量。初始为 −∞、0、[0,0]。'],
    ['key 0', '以第一个 score 为基准', 'score=2，指数为 1。得到 m=2、l=1、a=[1,0]；此时还不能当作最终输出。'],
    ['key 1', '最大值不变，加入较小项', 'score=1，指数为 exp(−1)。得到 l≈1.3679、a≈[1,0.7358]，仍保留基准 m=2。'],
    ['保留旧值', '新 score=4，先保留已有贡献', '旧 l 和两个旧 a 都基于 m=2。新最大值变为 4，下一步必须把所有历史项一起换基准。'],
    ['重缩放', '旧 l 与两个旧 a 同乘 exp(−2)', '得到 l≈0.1851、a≈[0.1353,0.0996]。旧值仍在左侧可核对，此步尚未加入 key 2。'],
    ['加入新项', '新项指数为 1，加入 V₂', '在重缩放后的 l 上加 1，两个 a 分别加 3 和 1。得到 l≈1.1851、a≈[3.1353,1.0996]。'],
    ['最终除法', '两个分量分别除以同一个 l', '所有 key 处理完后，O=a/l≈[2.6456,0.9278]，与直接概率加权和一致。'],
  ],
}
const meta = computed<SceneMeta>(() => ({ eyebrow: 'ATTENTION · 一行手算',
  title: props.mode === 'weighted' ? '一个概率怎样贡献两个输出分量' : '新最大值到来后，保留并更新历史贡献',
  viewBox: props.mode === 'weighted' ? '0 0 720 700' : '0 0 720 620',
  mobileViewBox: props.mode === 'weighted' ? '0 0 400 730' : '0 0 400 850',
  note: '数学步骤示意；数字不插值，动画速度不表示 GPU 耗时。',
  steps: descriptions[props.mode].map(([label, title, narration]) => ({ label, title, narration, duration: DURATION_MS })),
}))
</script>
<template>
  <AlgorithmPlayer :key="mode" :meta="meta">
    <template #stage="state">
      <component :is="mode === 'weighted' ? WeightedSumScene : OnlineStateScene" :step="state.step" :local="state.local" :compact="state.compact" :reduced-motion="state.reducedMotion ?? state['reduced-motion'] ?? false" />
    </template>
  </AlgorithmPlayer>
</template>
