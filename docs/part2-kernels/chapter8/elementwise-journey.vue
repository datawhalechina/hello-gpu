<script setup lang="ts">
import { computed } from 'vue'
import ScenePlayer from './visuals/ScenePlayer.vue'
import { sceneRegistry, type Scenario } from './visuals/sceneRegistry'

/**
 * 第 8 章教学动画统一入口：按 scenario 装配对应场景与播放器外壳。
 * 场景实现见 ./visuals/（时间轴确定性渲染，支持拖动擦洗）。
 */
const props = withDefaults(defineProps<{ scenario?: Scenario }>(), {
  scenario: 'dependency'
})

const registered = computed(() => sceneRegistry[props.scenario])
</script>

<template>
  <ScenePlayer :meta="registered.meta">
    <template #stage="{ step, local }">
      <component :is="registered.component" :step="step" :local="local" />
    </template>
  </ScenePlayer>
</template>
