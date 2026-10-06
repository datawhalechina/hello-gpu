<script setup lang="ts">
import { displayValue } from '../softmax-model'
withDefaults(defineProps<{
  values: (number | null)[]
  x: number
  y: number
  pitch: number
  cellWidth: number
  labels?: string[]
  masked?: boolean[]
  color?: string
}>(), { color: 'a' })
</script>
<template>
  <g v-for="(value, index) in values" :key="index" :data-column="index" :data-value="value ?? 'unavailable'">
    <text v-if="labels" :x="x + index * pitch + cellWidth / 2" :y="y - 12" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">{{ labels[index] }}</text>
    <rect :x="x + index * pitch" :y="y" :width="cellWidth" height="54" rx="7"
      :fill="value === null ? 'var(--ej-bg)' : `var(--ej-${color}-soft)`"
      :stroke="value === null || masked?.[index] ? 'var(--ej-line-strong)' : `var(--ej-${color})`"
      :stroke-dasharray="value === null || masked?.[index] ? '5 4' : undefined" stroke-width="1.6" />
    <text :x="x + index * pitch + cellWidth / 2" :y="y + 34" text-anchor="middle"
      :font-size="value === null ? 18 : 24" font-weight="600" :fill="value === null ? 'var(--ej-ink-soft)' : 'var(--ej-ink)'">{{ displayValue(value) }}</text>
  </g>
</template>
