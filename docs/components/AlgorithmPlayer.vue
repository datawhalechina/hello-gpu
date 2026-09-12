<script setup lang="ts">
import ScenePlayer from './animation/ScenePlayer.vue'
import type { SceneMeta } from './animation/sceneTypes'
defineProps<{ meta: SceneMeta }>()
</script>
<template>
  <ScenePlayer :meta="meta"><template #stage="state"><slot name="stage" v-bind="state" /></template></ScenePlayer>
</template>
