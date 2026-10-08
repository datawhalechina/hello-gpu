<script setup lang="ts">
import { computed } from 'vue'
type Point = { x: number; y: number }
const props = withDefaults(defineProps<{ points: Point[]; progress?: number; value?: string; color?: string }>(), { progress: 1, color: 'a' })
const d = computed(() => props.points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '))
const position = computed(() => {
  const lengths = props.points.slice(1).map((p, i) => Math.hypot(p.x - props.points[i].x, p.y - props.points[i].y))
  let distance = lengths.reduce((a, b) => a + b, 0) * props.progress
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const ratio = lengths[i] ? distance / lengths[i] : 1
      return { x: props.points[i].x + (props.points[i + 1].x - props.points[i].x) * ratio,
        y: props.points[i].y + (props.points[i + 1].y - props.points[i].y) * ratio }
    }
    distance -= lengths[i]
  }
  return props.points[props.points.length - 1]
})
const head = computed(() => {
  const end = props.points[props.points.length - 1], from = props.points[props.points.length - 2]
  const length = Math.hypot(end.x - from.x, end.y - from.y) || 1
  const dx = (end.x - from.x) / length, dy = (end.y - from.y) / length
  return `${end.x},${end.y} ${end.x - dx * 9 + dy * 4},${end.y - dy * 9 - dx * 4} ${end.x - dx * 9 - dy * 4},${end.y - dy * 9 + dx * 4}`
})
</script>
<template>
  <g :style="{ color: `var(--ej-${color})` }">
    <path :d="d" fill="none" stroke="currentColor" stroke-width="1.8" />
    <polygon :points="head" fill="currentColor" />
    <g v-if="value && progress > 0 && progress < 1" :transform="`translate(${position.x}, ${position.y})`">
      <rect x="-34" y="-16" width="68" height="32" rx="6" fill="var(--ej-bg)" stroke="currentColor" />
      <text y="6" text-anchor="middle" font-size="18" font-weight="600" fill="var(--ej-ink)">{{ value }}</text>
    </g>
  </g>
</template>
