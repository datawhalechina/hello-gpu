<script setup lang="ts">
import { computed } from 'vue'
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import { attentionScenes, type AttentionScenario } from './visuals/sceneRegistry'
import MaterializeFlowScene from './visuals/scenes/MaterializeFlowScene.vue'
const props = withDefaults(defineProps<{ scenario?: AttentionScenario }>(), { scenario: 'materialize-flow' })
const registered = computed(() => props.scenario === 'materialize-flow' ? null : attentionScenes[props.scenario])
</script>
<template>
  <MaterializeFlowScene v-if="scenario === 'materialize-flow'" />
  <AlgorithmPlayer v-else-if="registered" :key="scenario" :meta="registered.meta">
    <template #stage="state">
      <component :is="registered.component" :step="state.step" :local="state.local" :compact="state.compact" :reduced-motion="state.reducedMotion ?? state['reduced-motion'] ?? false" />
    </template>
  </AlgorithmPlayer>
</template>
