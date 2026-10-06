<script setup lang="ts">
import { computed } from 'vue'
import ScenePlayer from '../../components/animation/ScenePlayer.vue'
import { softmaxScenes, type SoftmaxScenario } from './visuals/sceneRegistry'
const props = withDefaults(defineProps<{ scenario?: SoftmaxScenario }>(), { scenario: 'fused-row' })
const registered = computed(() => softmaxScenes[props.scenario])
const staticLabel = '三个 kernel 的静态数据交接。输入1000、1001、1002；调用1写最大值1002；调用2读取原输入和最大值，写指数0.1353、0.3679、1与行和1.5032；调用3读取指数和行和，写输出0.0900、0.2447、0.6652。橙色框是全局中间数组。'
</script>
<template>
  <section v-if="registered.static" class="ej softmax-static" :aria-label="registered.meta.title">
    <p class="static-title">{{ registered.meta.title }}</p>
    <svg class="static-desktop" :viewBox="registered.meta.viewBox" role="img" :aria-label="staticLabel"><component :is="registered.component" :compact="false" /></svg>
    <svg class="static-mobile" :viewBox="registered.meta.mobileViewBox" role="img" :aria-label="staticLabel"><component :is="registered.component" :compact="true" /></svg>
    <p class="static-note">这里只跟踪一行，数组的原值在读取后保留。箭头是数据依赖，不表示耗时或硬件线路。</p>
  </section>
  <ScenePlayer v-else :meta="registered.meta">
    <template #stage="{ step, local, compact, reducedMotion }">
      <component :is="registered.component" :step="step" :local="local" :compact="compact" :reduced-motion="reducedMotion" />
    </template>
  </ScenePlayer>
</template>
<style scoped>
.softmax-static { --ej-bg: #f8faf9; --ej-panel: #e8efec; --ej-line-strong: #becdc6; --ej-ink: #203532; --ej-ink-soft: #61736c; --ej-a: #347baa; --ej-a-soft: rgba(52,123,170,.15); --ej-b: #b96b32; --ej-b-soft: rgba(185,107,50,.16); --ej-c: #3b8c60; --ej-c-soft: rgba(59,140,96,.15); padding: 16px; border: 1px solid var(--ej-line-strong); border-radius: 8px; background: var(--ej-bg); }
.static-title { margin: 0 0 10px; font-size: 18px; font-weight: 600; color: var(--ej-ink); }
.softmax-static svg { width: 100%; height: auto; display: block; }
.softmax-static .static-mobile { display: none; }
.static-note { margin: 10px 0 0; font-size: 14px; line-height: 1.7; color: var(--ej-ink-soft); }
@media(max-width: 640px) { .softmax-static { padding: 8px; } .softmax-static .static-desktop { display: none; } .softmax-static .static-mobile { display: block; } }
</style>
