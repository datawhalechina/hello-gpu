<script setup lang="ts">
import { computed } from 'vue'
import { copyProgress, displayValue, mathState } from '../../softmax-model'
import FlowArrow from '../FlowArrow.vue'
import ValueRow from '../ValueRow.vue'
const props = defineProps<{ step: number; local: number; compact: boolean; reducedMotion: boolean }>()
const state = computed(() => mathState(props.step, props.local, props.reducedMotion))
const width = computed(() => props.compact ? 400 : 720)
const cellWidth = computed(() => props.compact ? 112 : 152)
const pitch = computed(() => props.compact ? 130 : 190)
const x = computed(() => (width.value - 2 * pitch.value - cellWidth.value) / 2)
const cx = (column: number) => x.value + column * pitch.value + cellWidth.value / 2
const p = computed(() => copyProgress(props.local, props.reducedMotion))
const work = computed(() => state.value.exponentials ?? state.value.shifted ?? [null, null, null])
const workLabel = computed(() => state.value.exponentsReady ? '稳定指数 p' : props.step === 3 ? '对各项取指数' : '平移后的值 x − m')
const arrows = computed(() => {
  if (props.step === 1) return state.value.input.map((v, i) => ({ key: `max${i}`, points: [{ x: cx(i), y: 106 }, { x: width.value / 2, y: 162 }], value: displayValue(v), color: 'a' }))
  if (props.step === 2) return [0, 1, 2].map(i => ({ key: `shift${i}`, points: [{ x: width.value / 2, y: 214 }, { x: cx(i), y: 270 }], value: '1002', color: 'b' }))
  if (props.step === 4) return (state.value.exponentials ?? []).map((v, i) => ({ key: `sum${i}`, points: [{ x: cx(i), y: 324 }, { x: width.value / 2, y: 380 }], value: displayValue(v), color: 'a' }))
  if (props.step === 5) return [0, 1, 2].map(i => ({ key: `divide${i}`, points: [{ x: width.value / 2, y: 432 }, { x: cx(i), y: 492 }], value: '1.5032', color: 'b' }))
  return []
})
</script>
<template>
  <g font-family="inherit" :data-math-step="step" :data-output-ready="state.outputReady">
    <FlowArrow v-for="arrow in arrows" :key="arrow.key" :points="arrow.points" :value="arrow.value" :color="arrow.color" :progress="p" />
    <text :x="x" y="33" font-size="20" font-weight="600" fill="var(--ej-ink)">输入 x · 原值保留</text>
    <ValueRow :values="state.input" :x="x" :y="52" :pitch="pitch" :cell-width="cellWidth" />
    <g :data-maximum="state.maximum ?? 'unavailable'">
      <rect :x="width / 2 - 91" y="162" width="182" height="52" rx="7" :fill="state.maximumReady ? 'var(--ej-b-soft)' : 'var(--ej-bg)'" stroke="var(--ej-b)" :stroke-dasharray="state.maximumReady ? undefined : '5 4'" />
      <text :x="width / 2" y="195" text-anchor="middle" font-size="22" fill="var(--ej-ink)">{{ state.maximumReady ? `m = ${state.maximum}` : 'm：等待归约' }}</text>
    </g>
    <rect :x="x - 4" y="235" width="210" height="25" rx="4" fill="var(--ej-bg)" />
    <text :x="x" y="254" font-size="20" font-weight="600" fill="var(--ej-ink)">{{ workLabel }}</text>
    <ValueRow :values="work" :x="x" :y="270" :pitch="pitch" :cell-width="cellWidth" />
    <g v-if="step === 3 && !state.exponentsReady">
      <text v-for="(value, i) in state.shifted" :key="i" :x="cx(i)" y="350" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">exp({{ value }})</text>
    </g>
    <g :data-denominator="state.denominator ?? 'unavailable'">
      <rect :x="width / 2 - 99" y="380" width="198" height="52" rx="7" :fill="state.denominatorReady ? 'var(--ej-b-soft)' : 'var(--ej-bg)'" stroke="var(--ej-b)" :stroke-dasharray="state.denominatorReady ? undefined : '5 4'" />
      <text :x="width / 2" y="413" text-anchor="middle" font-size="22" fill="var(--ej-ink)">{{ state.denominatorReady ? `s ≈ ${displayValue(state.denominator)}` : 's：等待归约' }}</text>
    </g>
    <rect :x="x - 4" y="456" width="165" height="25" rx="4" fill="var(--ej-bg)" />
    <text :x="x" y="475" font-size="20" font-weight="600" fill="var(--ej-ink)">输出 y = p / s</text>
    <ValueRow :values="state.output ?? [null, null, null]" :x="x" :y="492" :pitch="pitch" :cell-width="cellWidth" color="c" />

    <text :x="width / 2" y="580" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">{{ step === 1 || step === 4 ? '整行汇入一个标量' : step === 2 ? '各项输入都减去同一个 m' : step === 5 ? '各项指数都除以同一个 s' : step === 3 ? '每个位置分别计算 exp' : '每列一个输入；整行共享统计值' }}</text>
  </g>
</template>
