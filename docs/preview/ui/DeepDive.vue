<script setup lang="ts">
import './tokens.css'
defineProps<{ title: string }>()
</script>

<template>
  <details class="hgp-deep">
    <summary>深入一点：{{ title }}</summary>
    <div class="content"><slot /></div>
  </details>
</template>

<style scoped>
.hgp-deep {
  margin: 16px 0;
  border: 1px solid var(--hg-border);
  border-radius: var(--hgp-radius);
}
summary {
  padding: 10px 14px;
  font-weight: 600;
  cursor: pointer;
}
summary:focus-visible {
  outline: 2px solid var(--hg-focus);
  outline-offset: 2px;
}
.content {
  padding: 0 14px 10px;
}
</style>
