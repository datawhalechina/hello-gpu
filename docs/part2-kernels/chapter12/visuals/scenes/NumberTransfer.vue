<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ from: number[]; to: number[]; progress: number; value: string; color?: string }>()
const x = computed(() => props.from[0] + (props.to[0] - props.from[0]) * props.progress)
const y = computed(() => props.from[1] + (props.to[1] - props.from[1]) * props.progress)
</script>
<template>
  <g :stroke="color ?? 'var(--ej-active)'" fill="none" aria-hidden="true">
    <line :x1="from[0]" :y1="from[1]" :x2="to[0]" :y2="to[1]" stroke-width="2" stroke-dasharray="5 5" />
    <g v-if="progress > 0 && progress < 1" :transform="`translate(${x},${y})`">
      <rect x="-42" y="-17" width="84" height="34" rx="6" fill="var(--ej-bg)" />
      <text y="6" text-anchor="middle" :fill="color ?? 'var(--ej-active)'" stroke="none" font-size="20">{{ value }}</text>
    </g>
  </g>
</template>
