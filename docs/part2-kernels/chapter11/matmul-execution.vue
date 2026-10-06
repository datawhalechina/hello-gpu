<script setup lang="ts">
import { computed } from 'vue'
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import GroupOrderScene from './visuals/scenes/GroupOrderScene.vue'
import { matmulScenes, type MatmulScenario } from './visuals/sceneRegistry'
const props = withDefaults(defineProps<{ scenario?: MatmulScenario }>(), { scenario: 'tiled-lds' })
const registered = computed(() => props.scenario==='group-order' ? null : matmulScenes[props.scenario])
</script>

<template>
  <GroupOrderScene v-if="scenario==='group-order'" />
  <AlgorithmPlayer v-else-if="registered" :meta="registered.meta">
    <template #stage="{ step, local, compact, reducedMotion }">
      <component :is="registered.component" :step="step" :local="local" :compact="compact" :reduced-motion="reducedMotion" />
    </template>
  </AlgorithmPlayer>
</template>
