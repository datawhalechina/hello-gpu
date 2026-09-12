<script setup lang="ts">
import { computed } from 'vue'
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import { rmsnormScenes, type RmsnormScenario } from './visuals/sceneRegistry'

/**
 * 第 13 章执行视角动画入口：按 scenario 装配对应场景。
 * 与 rmsnorm-journey.vue（公式数值视角）互补，场景实现见 ./visuals/。
 */
const props = withDefaults(defineProps<{ scenario?: RmsnormScenario }>(), {
  scenario: 'serial-vs-block'
})

const registered = computed(() => rmsnormScenes[props.scenario])
</script>

<template>
  <AlgorithmPlayer :meta="registered.meta">
    <template #stage="{ step, local }">
      <component :is="registered.component" :step="step" :local="local" />
    </template>
  </AlgorithmPlayer>
</template>
