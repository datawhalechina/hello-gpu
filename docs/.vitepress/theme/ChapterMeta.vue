<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { chapters } from '../outline.mjs'
import UiIcon from './UiIcon.vue'
const { page } = useData()
const chapter = computed(() => chapters.find(item => item.source === `docs/${page.value.relativePath}`))
const hasRoutes = computed(() => chapter.value?.part.prefix === '/part2-kernels/')
const implementationId = computed(() => `ch${chapter.value?.number}-${[9, 10].includes(chapter.value?.number) ? 'implementation' : 'implementations'}`)
</script>
<template>
  <div v-if="chapter" class="hg-chapter-meta">
    <div v-if="page.frontmatter.hasChapterCode || hasRoutes" class="hg-chapter-resources">
      <a v-if="page.frontmatter.hasChapterCode" :href="`https://github.com/datawhalechina/hello-gpu/tree/dev/${chapter.code}`"><UiIcon name="code" />配套代码 <UiIcon name="chevron" :size="13" /></a>
      <a v-if="hasRoutes" :href="withBase('/appendix/programming-models/')"><UiIcon name="book" />编程范式附录 <UiIcon name="chevron" :size="13" /></a>
    </div>
    <p v-if="chapter.number !== 19" class="hg-chapter-baseline"><UiIcon name="chip" :size="17" /><span>实验基线</span><span>Radeon RX 9070 XT <i>·</i> ROCm 7.13 <i>·</i> 原生 Ubuntu 24.04</span></p>
    <div v-if="hasRoutes" class="hg-reading-route-cards">
      <a :href="`#${implementationId}-hip-panel`"><UiIcon name="code" :size="32" /><span><strong>HIP 深入路线</strong><small>从线程分工到访存与协作</small></span><UiIcon name="chevron" :size="16" /></a>
      <a :href="`#${implementationId}-triton-panel`"><UiIcon name="grid" :size="30" /><span><strong>Triton 快速路线</strong><small>用数据块表达同一个算子</small></span><UiIcon name="chevron" :size="16" /></a>
    </div>
  </div>
</template>
