<script setup lang="ts">
import { computed } from 'vue'
import { POSITIVE_ROW, stableRow } from '../../softmax-model'
import FlowArrow from '../FlowArrow.vue'
import ValueRow from '../ValueRow.vue'
const props = withDefaults(defineProps<{ compact?: boolean; step?: number; local?: number; reducedMotion?: boolean }>(), { compact: false })
const values = stableRow(POSITIVE_ROW)
const width = computed(() => props.compact ? 400 : 720)
const pitch = computed(() => props.compact ? 126 : 174)
const cellWidth = computed(() => props.compact ? 108 : 142)
const x = computed(() => (width.value - pitch.value * 2 - cellWidth.value) / 2)
const cx = (i: number) => x.value + pitch.value * i + cellWidth.value / 2
</script>
<template>
  <g font-family="inherit">
    <text :x="x" y="29" font-size="20" font-weight="600" fill="var(--ej-ink)">输入 X · 原值保留</text>
    <ValueRow :values="[...POSITIVE_ROW]" :x="x" :y="46" :pitch="pitch" :cell-width="cellWidth" />
    <FlowArrow v-for="i in [0, 1, 2]" :key="`max${i}`" :points="[{x: cx(i), y: 100}, {x: width / 2, y: 160}]" />
    <rect :x="width / 2 - 128" y="116" width="256" height="30" rx="5" fill="var(--ej-bg)" />
    <text :x="width / 2" y="138" text-anchor="middle" font-size="20" fill="var(--ej-ink)">调用 1 · 求最大值</text>
    <rect :x="width / 2 - 145" y="160" width="290" height="48" rx="7" fill="var(--ej-b-soft)" stroke="var(--ej-b)" />
    <text :x="width / 2" y="192" text-anchor="middle" font-size="22" fill="var(--ej-ink)">row_max[0] = 1002</text>
    <FlowArrow :points="[{x: width / 2, y: 208}, {x: width / 2, y: 292}]" color="b" />
    <rect :x="width / 2 - 172" y="226" width="344" height="48" rx="5" fill="var(--ej-bg)" />
    <text :x="width / 2" y="247" text-anchor="middle" font-size="20" fill="var(--ej-ink)">调用 2 · 读取 X 与 row_max</text>
    <text :x="width / 2" y="271" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">计算指数，保存 exp_tmp</text>
    <ValueRow :values="values.exponentials" :x="x" :y="292" :pitch="pitch" :cell-width="cellWidth" color="b" />
    <FlowArrow v-for="i in [0, 1, 2]" :key="`sum${i}`" :points="[{x: cx(i), y: 346}, {x: width / 2, y: 390}]" color="b" />
    <rect :x="width / 2 - 154" y="390" width="308" height="48" rx="7" fill="var(--ej-b-soft)" stroke="var(--ej-b)" />
    <text :x="width / 2" y="422" text-anchor="middle" font-size="22" fill="var(--ej-ink)">row_sum[0] ≈ 1.5032</text>
    <FlowArrow v-for="i in [0, 1, 2]" :key="`out${i}`" :points="[{x: width / 2, y: 438}, {x: cx(i), y: 522}]" color="c" />
    <rect :x="width / 2 - 174" y="454" width="348" height="48" rx="5" fill="var(--ej-bg)" />
    <text :x="width / 2" y="475" text-anchor="middle" font-size="20" fill="var(--ej-ink)">调用 3 · 读取 exp_tmp 与行和</text>
    <text :x="width / 2" y="498" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">逐元素相除，写入 Y</text>
    <ValueRow :values="values.probabilities" :x="x" :y="522" :pitch="pitch" :cell-width="cellWidth" color="c" />
    <text :x="width / 2" y="612" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">橙色框：后续调用读取的全局数组</text>
  </g>
</template>
