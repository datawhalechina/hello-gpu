<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import './tokens.css'
import { collectTerm, ensureLoaded, progress } from './store.ts'

const props = defineProps<{ stage: string; term: string; en?: string; code?: string }>()
const root = ref<HTMLElement | null>(null)
const known = computed(() => progress.codex.includes(props.term))
let observer: IntersectionObserver | undefined

onMounted(() => {
  ensureLoaded()
  if (typeof IntersectionObserver === 'undefined' || !root.value) return
  observer = new IntersectionObserver(
    entries => {
      if (entries.some(e => e.isIntersecting)) {
        collectTerm(props.stage, props.term)
        observer?.disconnect()
      }
    },
    { threshold: 0.8 },
  )
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="root" class="hgp-concept">
    <div class="head">
      <strong>{{ term }}</strong>
      <span v-if="en" class="en">{{ en }}</span>
      <code v-if="code">{{ code }}</code>
      <span class="badge" :class="{ known }">{{ known ? '已收入图鉴' : '新词' }}</span>
    </div>
    <div class="def"><slot /></div>
  </div>
</template>

<style scoped>
.hgp-concept {
  margin: 12px 0;
  padding: 12px 14px;
  border: 1px solid var(--hg-border);
  border-left: 4px solid var(--hg-sim);
  border-radius: var(--hgp-radius);
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}
.en {
  color: var(--vp-c-text-2);
  font-size: 14px;
}
.badge {
  margin-left: auto;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--hg-sim);
  color: var(--vp-c-bg);
  font-size: 12px;
  font-weight: 600;
  transition: background var(--motion-base) var(--ease-out);
}
.badge.known {
  background: var(--hg-border);
  color: var(--vp-c-text-2);
}
.def :deep(p) {
  margin: 6px 0 0;
}
</style>
