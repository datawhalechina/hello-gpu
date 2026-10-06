<script setup lang="ts">
import { computed } from 'vue'
import { ACCUMULATE_MS, ARRIVE_MS, CALCULATE_MS, SCORES, VALUES, PROBABILITIES, fmt, motion, weightedFrame } from '../../attention-model'
import NumberTransfer from './NumberTransfer.vue'
const props = withDefaults(defineProps<{ step: number; local: number; compact?: boolean; reducedMotion?: boolean }>(), { compact: false, reducedMotion: false })
const state = computed(() => weightedFrame(props.step, props.local, props.reducedMotion))
const rowY = (key: number) => 72 + key * 54
const cardX = (d: number) => props.compact ? 16 + d * 190 : 52 + d * 340
const cardW = computed(() => props.compact ? 178 : 296)
const resultY = computed(() => props.compact ? 474 : 448)
const sourceP = computed(() => [props.compact ? 172 : 326, rowY(state.value.key ?? 0) - 7])
const sourceV = computed(() => [props.compact ? 298 : 524, rowY(state.value.key ?? 0) - 7])
</script>
<template>
  <g font-family="inherit" fill="var(--ej-ink)" font-size="20">
    <text :x="compact ? 26 : 74" y="32" font-weight="650">key</text>
    <text :x="compact ? 108 : 197" y="32" text-anchor="middle">分数</text>
    <text :x="compact ? 166 : 324" y="32" text-anchor="middle">概率 p</text>
    <text :x="compact ? 298 : 524" y="32" text-anchor="middle">V · 两个分量</text>
    <g v-for="(score, key) in SCORES" :key="key">
      <rect x="16" :y="rowY(key) - 32" :width="compact ? 368 : 688" height="44" rx="7" :fill="state.key === key ? 'var(--ej-a-soft)' : 'var(--ej-panel)'" :stroke="state.key === key ? 'var(--ej-a)' : 'var(--ej-line)'" />
      <text :x="compact ? 32 : 86" :y="rowY(key)">{{ key }}</text>
      <text :x="compact ? 108 : 197" :y="rowY(key)" text-anchor="middle">{{ score }}</text>
      <text :x="compact ? 172 : 326" :y="rowY(key)" text-anchor="middle" fill="var(--ej-a)">{{ state.weightsReady ? fmt(PROBABILITIES[key]) : '待计算' }}</text>
      <text :x="compact ? 298 : 524" :y="rowY(key)" text-anchor="middle" fill="var(--ej-b)">[{{ VALUES[key].join(', ') }}]</text>
    </g>
    <text :x="compact ? 200 : 360" y="235" text-anchor="middle" font-size="20">{{ step === 5 ? '全部贡献已累计，写出两个分量' : state.key === null ? '同一概率，分别乘 V 的两个分量' : `正在加入 key ${state.key} 的贡献` }}</text>
    <g v-for="d in [0, 1]" :key="d">
      <rect :x="cardX(d)" y="276" :width="cardW" height="134" rx="9" fill="var(--ej-surface)" stroke="var(--ej-b)" />
      <text :x="cardX(d) + cardW / 2" y="303" text-anchor="middle">分量 {{ d }}</text>
      <text :x="cardX(d) + cardW / 2" y="340" text-anchor="middle" font-size="20">
        {{ state.displayKey !== null && state.weightReady ? fmt(PROBABILITIES[state.displayKey]) : 'p' }} × {{ state.displayKey !== null && state.valueReady ? VALUES[state.displayKey][d] : 'V' }}
      </text>
      <text :x="cardX(d) + cardW / 2" y="382" text-anchor="middle" font-size="24" fill="var(--ej-c)">= {{ state.contribution ? fmt(state.contribution[d]) : '待计算' }}</text>
      <rect :x="cardX(d)" :y="resultY" :width="cardW" height="98" rx="9" fill="var(--ej-c-soft)" stroke="var(--ej-c)" />
      <text :x="cardX(d) + cardW / 2" :y="resultY + 30" text-anchor="middle">累计分量 {{ d }}</text>
      <text :x="cardX(d) + cardW / 2" :y="resultY + 70" text-anchor="middle" font-size="26">{{ fmt(state.accumulated[d]) }}</text>
      <template v-if="state.key !== null">
        <NumberTransfer :from="sourceP" :to="[cardX(d) + cardW / 2 - 38, 328]" :progress="motion(local, 0, 550, reducedMotion)" :value="fmt(PROBABILITIES[state.key])" color="var(--ej-a)" />
        <NumberTransfer :from="sourceV" :to="[cardX(d) + cardW / 2 + 55, 328]" :progress="motion(local, 550, ARRIVE_MS, reducedMotion)" :value="String(VALUES[state.key][d])" color="var(--ej-b)" />
        <NumberTransfer v-if="state.contribution" :from="[cardX(d) + cardW / 2, 392]" :to="[cardX(d) + cardW / 2, resultY]" :progress="motion(local, CALCULATE_MS, ACCUMULATE_MS, reducedMotion)" :value="fmt(state.contribution[d])" color="var(--ej-c)" />
      </template>
    </g>
    <rect x="16" :y="resultY + 126" :width="compact ? 368 : 688" height="64" rx="8" fill="var(--ej-surface)" stroke="var(--ej-c)" />
    <text :x="compact ? 200 : 360" :y="resultY + 165" text-anchor="middle" font-size="23">O = {{ state.output ? `[${state.output.map(fmt).join(', ')}]` : '尚未写出' }}</text>
    <NumberTransfer v-if="step === 5" v-for="d in [0, 1]" :key="d" :from="[cardX(d) + cardW / 2, resultY + 63]" :to="[compact ? 180 + d * 94 : 328 + d * 94, resultY + 157]" :progress="motion(local, 0, ARRIVE_MS, reducedMotion)" :value="fmt(state.accumulated[d])" color="var(--ej-c)" />
    <text :x="compact ? 200 : 360" :y="resultY + 222" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">输入保留；先累计，再写出向量</text>
  </g>
</template>
