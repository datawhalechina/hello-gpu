<script setup lang="ts">
import { lang, setLang } from './store.ts'
import type { Lang } from '../sim/expr.ts'

defineProps<{ stage: string }>()
const choices: Array<{ value: Lang; label: string }> = [
  { value: 'hip', label: 'HIP' },
  { value: 'python', label: 'Python' },
]
</script>

<template>
  <div class="hgp-lang" role="radiogroup" aria-label="代码写法">
    <span class="label">代码写法</span>
    <button
      v-for="c in choices"
      :key="c.value"
      type="button"
      role="radio"
      class="hgp-focusable"
      :aria-checked="lang === c.value"
      :class="{ on: lang === c.value }"
      @click="setLang(c.value, stage)"
    >
      {{ c.label }}
    </button>
  </div>
</template>

<style scoped>
.hgp-lang {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.label {
  margin-right: 4px;
  color: var(--vp-c-text-2);
}
button {
  min-height: 30px;
  padding: 2px 12px;
  border: 1px solid var(--hg-border);
  border-radius: 999px;
  background: transparent;
  color: var(--vp-c-text-2);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out);
}
button.on {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
</style>
