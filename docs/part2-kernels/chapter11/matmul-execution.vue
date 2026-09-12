<script setup lang="ts">
import { computed } from 'vue'
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import { matmulScenes, type MatmulScenario } from './visuals/sceneRegistry'

/**
 * 第 11 章执行视角动画入口：按 scenario 装配对应场景。
 * 与 matmul-journey.vue（点积/外积数学视角）互补，场景实现见 ./visuals/。
 */
const props = withDefaults(defineProps<{ scenario?: MatmulScenario }>(), {
  scenario: 'tiled-lds'
})

const registered = computed(() => matmulScenes[props.scenario])
</script>

<template>
  <AlgorithmPlayer :meta="registered.meta">
    <template #stage="{ step, local }">
      <component :is="registered.component" :step="step" :local="local" />
    </template>
  </AlgorithmPlayer>
</template>
