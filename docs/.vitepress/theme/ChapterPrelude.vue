<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { chapters, parts } from '../outline.mjs'
import UiIcon from './UiIcon.vue'
const { page } = useData()
const chapter = computed(() => chapters.find(item => item.source === `docs/${page.value.relativePath}`))
const partNumber = computed(() => chapter.value ? parts.indexOf(chapter.value.part) : -1)
</script>
<template>
  <div v-if="chapter" class="hg-chapter-prelude">
    <nav aria-label="章节位置" class="hg-breadcrumb"><a :href="withBase('/curriculum/')">第 {{ partNumber }} 篇 · {{ chapter.part.title }}</a><UiIcon name="chevron" :size="13" /><span>第 {{ chapter.number }} 章</span></nav>
    <img v-if="partNumber === 2" class="hg-chapter-art" :src="withBase('/images/ui/gpu-chapter.webp')" alt="" width="420" height="270" aria-hidden="true">
  </div>
</template>
