<script setup lang="ts">
import './tokens.css'
defineProps<{ kind: 'simulated' | 'measured' }>()
</script>

<template>
  <aside class="hgp-evidence" :class="kind">
    <span class="tag">{{ kind === 'simulated' ? '模拟' : '实测' }}</span>
    <span class="text"><slot /></span>
  </aside>
</template>

<style scoped>
.hgp-evidence {
  display: flex;
  gap: 10px;
  align-items: baseline;
  margin: 16px 0;
  padding: 10px 14px;
  border: 1px dashed var(--hg-border);
  border-radius: var(--hgp-radius);
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.tag {
  flex: none;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--vp-c-bg);
  background: var(--hg-sim);
}
.measured .tag {
  background: var(--hg-ok);
}
</style>
