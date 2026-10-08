<script setup lang="ts">
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import type { SceneMeta } from '../../components/animation/sceneTypes'
import DotProductScene from './visuals/scenes/DotProductScene.vue'
import ReusePicker from './visuals/ReusePicker.vue'
withDefaults(defineProps<{ mode?: 'dot' | 'tile' }>(), { mode: 'tile' })
const meta: SceneMeta = {
  eyebrow: 'MATMUL · 点积', title: '固定 C[0,0]：临时部分和怎样变成输出',
  viewBox: '0 0 720 550', mobileViewBox: '0 0 360 770',
  steps: [
    { label:'输入', title:'固定 A 第0行与 B 第0列', narration:'沿K配对的输入分别为[1,2,3]与[1,2,0]。线程的临时部分和从0开始，输出位置尚未写回。', duration:3000 },
    { label:'加 1', title:'k=0：0 + 1×1 = 1', narration:'读取两个输入值的副本，相乘后加到临时部分和。A和B中的原值仍在原处。', duration:3000 },
    { label:'加 4', title:'k=1：1 + 2×2 = 5', narration:'第二对输入的乘积是4。沿K累加的是同一个临时部分和，此时还没有写C。', duration:3000 },
    { label:'加 0', title:'k=2：5 + 3×0 = 5', narration:'第三项确实执行了乘加，但乘积为0，因此部分和仍是5。', duration:3000 },
    { label:'写回', title:'三项都处理完，才存入 C[0,0]', narration:'将最终部分和5写回GPU输出数组。其他输出各自由相应线程完成自己的点积。', duration:3200 },
  ],
}
</script>

<template>
  <ReusePicker v-if="mode==='tile'" />
  <AlgorithmPlayer v-else :meta="meta">
    <template #stage="{step,local,compact,reducedMotion}">
      <DotProductScene :step="step" :local="local" :compact="compact" :reduced-motion="reducedMotion" />
    </template>
  </AlgorithmPlayer>
</template>
