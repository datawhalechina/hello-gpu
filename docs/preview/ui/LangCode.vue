<script setup lang="ts">
import { onMounted } from 'vue'
import { ensureLoaded, lang } from './store.ts'
onMounted(ensureLoaded)
</script>

<template>
  <div class="hgp-langcode">
    <div v-show="lang === 'hip'"><slot name="hip" /></div>
    <div v-show="lang === 'python'"><slot name="python" /></div>
  </div>
</template>
