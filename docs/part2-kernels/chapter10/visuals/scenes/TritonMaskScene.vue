<script setup lang="ts">
import { computed } from 'vue'
import { copyProgress, displayValue, maskState } from '../../softmax-model'
import FlowArrow from '../FlowArrow.vue'
import ValueRow from '../ValueRow.vue'
const props = defineProps<{ step: number; local: number; compact: boolean; reducedMotion: boolean }>()
const state = computed(() => maskState(props.step, props.local, props.reducedMotion))
const width = computed(() => props.compact ? 400 : 720)
const pitch = computed(() => props.compact ? 94 : 174)
const cellWidth = computed(() => props.compact ? 82 : 146)
const x = computed(() => (width.value - 3 * pitch.value - cellWidth.value) / 2)
const cx = (i: number) => x.value + i * pitch.value + cellWidth.value / 2
const p = computed(() => copyProgress(props.local, props.reducedMotion))
</script>
<template>
  <g font-family="inherit" :data-mask-step="step" :data-output-count="state.output?.length ?? 0">
    <g v-if="step === 1">
      <FlowArrow v-for="i in [0, 1, 2]" :key="i" :points="[{x: cx(i), y: 99}, {x: cx(i), y: 185}]" :progress="p" :value="String(state.input[i])" />
    </g>
    <g v-if="step === 4">
      <FlowArrow v-for="i in [0, 1, 2]" :key="i" :points="[{x: width / 2, y: 522}, {x: cx(i), y: 580}]" :progress="p" value="1.5032" color="c" />
    </g>
    <text :x="x" y="29" font-size="20" font-weight="600" fill="var(--ej-ink)">真实输入 · 只有 3 列</text>
    <ValueRow :values="state.input" :x="x" :y="45" :pitch="pitch" :cell-width="cellWidth" />
    <text :x="cx(3)" y="70" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">无输入</text>
    <rect :x="x - 4" y="122" :width="width - x * 2 + 8" height="28" rx="4" fill="var(--ej-bg)" />
    <text :x="x" y="142" font-size="20" font-weight="600" fill="var(--ej-ink)">一个 program · 4 个逻辑位置</text>
    <ValueRow :values="state.logical ?? [null, null, null, null]" :labels="['有效', '有效', '有效', 'mask关']" :masked="[false, false, false, true]" :x="x" :y="185" :pitch="pitch" :cell-width="cellWidth" />

    <rect :x="width / 2 - 108" y="277" width="216" height="48" rx="7" :fill="state.maximumReady ? 'var(--ej-b-soft)' : 'var(--ej-bg)'" stroke="var(--ej-b)" />
    <text :x="width / 2" y="308" text-anchor="middle" font-size="22" fill="var(--ej-ink)">{{ state.maximumReady ? 'm = −1000' : 'm：等待归约' }}</text>
    <g v-if="step === 2">
      <FlowArrow v-for="i in [0, 1, 2, 3]" :key="i" :points="[{x: cx(i), y: 239}, {x: width / 2, y: 277}]" :progress="p" :value="displayValue(state.logical?.[i] ?? null)" />
    </g>
    <text :x="x" y="363" font-size="20" font-weight="600" fill="var(--ej-ink)">指数 exp(x − m)</text>
    <ValueRow :values="state.exponentials ?? [null, null, null, null]" :masked="[false, false, false, true]" :x="x" :y="380" :pitch="pitch" :cell-width="cellWidth" color="b" />
    <rect :x="width / 2 - 108" y="474" width="216" height="48" rx="7" :fill="state.denominatorReady ? 'var(--ej-b-soft)' : 'var(--ej-bg)'" stroke="var(--ej-b)" />
    <text :x="width / 2" y="505" text-anchor="middle" font-size="22" fill="var(--ej-ink)">{{ state.denominatorReady ? `s ≈ ${displayValue(state.denominator)}` : 's：等待归约' }}</text>
    <g v-if="step === 3 && state.exponentsReady">
      <FlowArrow v-for="i in [0, 1, 2, 3]" :key="i" :points="[{x: cx(i), y: 434}, {x: width / 2, y: 474}]" :progress="copyProgress(Math.max(0, local - 800), reducedMotion, 600)" :value="displayValue(state.exponentials?.[i] ?? null)" color="b" />
    </g>
    <rect :x="x - 4" y="542" width="240" height="28" rx="4" fill="var(--ej-bg)" />
    <text :x="x" y="562" font-size="20" font-weight="600" fill="var(--ej-ink)">真实输出 · 只写 3 项</text>
    <ValueRow :values="state.output ?? [null, null, null]" :x="x" :y="580" :pitch="pitch" :cell-width="cellWidth" color="c" />
    <text :x="cx(3)" y="611" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">不写入</text>

  </g>
</template>
