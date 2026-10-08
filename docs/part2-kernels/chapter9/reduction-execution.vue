<script setup lang="ts">
import {computed} from 'vue'
import ScenePlayer from '../../components/animation/ScenePlayer.vue'
import {reductionScenes,type ReductionScenario} from './visuals/sceneRegistry'
const props=withDefaults(defineProps<{scenario?:ReductionScenario}>(),{scenario:'two-stage'})
const registered=computed(()=>reductionScenes[props.scenario])
</script>
<template><ScenePlayer :key="scenario" :meta="registered.meta"><template #stage="state"><component :is="registered.component" v-bind="state" :mode="scenario" /></template></ScenePlayer></template>
