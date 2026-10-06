<script setup lang="ts">
withDefaults(defineProps<{
  values: Array<Array<{ value: number; valid: boolean }>>
  title: string
  rowLabels: string[]
  columnLabels: string[]
  color?: 'a' | 'b' | 'c'
  activeRow?: number | null
  activeColumn?: number | null
  empty?: boolean
}>(), { color: 'a', activeRow: null, activeColumn: null, empty: false })
</script>

<template>
  <g font-family="inherit" fill="var(--ej-ink)">
    <text x="86" y="0" text-anchor="middle" font-size="20" font-weight="600">{{ title }}</text>
    <text v-for="(label, c) in columnLabels" :key="`c${c}`" :x="58+c*66" y="30" text-anchor="middle" font-size="18">{{ label }}</text>
    <g v-for="(row, r) in values" :key="r">
      <text x="7" :y="70+r*82" text-anchor="middle" font-size="18">{{ rowLabels[r] }}</text>
      <g v-for="(cell, c) in row" :key="c">
        <rect :x="28+c*66" :y="42+r*82" width="60" height="74" rx="7"
          :fill="empty ? 'var(--ej-surface)' : cell.valid ? `var(--ej-${color}-soft)` : 'var(--ej-panel)'"
          :stroke="r===activeRow && c===activeColumn ? 'var(--ej-active)' : 'var(--ej-line-strong)'"
          :stroke-width="r===activeRow && c===activeColumn ? 3 : 1.2"
          :stroke-dasharray="cell.valid ? undefined : '5 3'" />
        <text :x="58+c*66" :y="73+r*82" text-anchor="middle" font-size="24" font-weight="600">{{ empty ? '·' : cell.value }}</text>
        <text :x="58+c*66" :y="100+r*82" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">{{ empty ? '待写' : cell.valid ? '有效' : '补 0' }}</text>
      </g>
    </g>
  </g>
</template>
