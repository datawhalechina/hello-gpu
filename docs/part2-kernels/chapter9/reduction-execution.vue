<script setup lang="ts">
import { computed } from 'vue'
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import { reductionScenes, type ReductionScenario } from './visuals/sceneRegistry'

/**
 * 第 9 章执行视角动画入口：按 scenario 装配对应场景。
 * 与 reduction-journey.vue（求和树数学视角）互补，场景实现见 ./visuals/。
 */
const props = withDefaults(defineProps<{ scenario?: ReductionScenario }>(), {
  scenario: 'two-stage'
})

const registered = computed(() => reductionScenes[props.scenario])
</script>

<template>
  <AlgorithmPlayer :meta="registered.meta">
    <template #stage="{ step, local }">
      <component :is="registered.component" :step="step" :local="local" />
    </template>
  </AlgorithmPlayer>
</template>
