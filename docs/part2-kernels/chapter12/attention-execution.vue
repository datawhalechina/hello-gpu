<script setup lang="ts">
import { computed } from 'vue'
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import { attentionScenes, type AttentionScenario } from './visuals/sceneRegistry'

/**
 * 第 12 章执行视角动画入口：按 scenario 装配对应场景。
 * 与 attention-journey.vue（在线状态数学视角）互补，场景实现见 ./visuals/。
 */
const props = withDefaults(defineProps<{ scenario?: AttentionScenario }>(), {
  scenario: 'online-sync'
})

const registered = computed(() => attentionScenes[props.scenario])
</script>

<template>
  <AlgorithmPlayer :meta="registered.meta">
    <template #stage="{ step, local }">
      <component :is="registered.component" :step="step" :local="local" />
    </template>
  </AlgorithmPlayer>
</template>
