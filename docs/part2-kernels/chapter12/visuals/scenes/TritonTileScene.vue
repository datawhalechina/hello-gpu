<script setup lang="ts">
import { computed } from 'vue'
import { ARRIVE_MS, SCORES, VALUES, fmt, motion, tritonFrame } from '../../attention-model'
import NumberTransfer from './NumberTransfer.vue'
const props = withDefaults(defineProps<{ step: number; local: number; compact?: boolean; reducedMotion?: boolean }>(), { compact: false, reducedMotion: false })
const state = computed(() => tritonFrame(props.step, props.local, props.reducedMotion))
const tile = computed(() => ({ x: props.compact ? 16 : 310, y: props.compact ? 280 : 18, w: props.compact ? 368 : 394 }))
const historyY = computed(() => props.compact ? 540 : 332)
const width = computed(() => props.compact ? 400 : 720)
</script>
<template>
  <g font-family="inherit" fill="var(--ej-ink)" font-size="20">
    <rect x="16" y="18" :width="compact ? 368 : 270" height="228" rx="8" fill="var(--ej-a-soft)" stroke="var(--ej-a)" />
    <text :x="compact ? 200 : 151" y="52" text-anchor="middle" font-size="22">原输入 · 三个 key</text>
    <text x="32" y="88" font-size="18">key</text><text :x="compact ? 124 : 96" y="88" font-size="18">score</text><text :x="compact ? 278 : 224" y="88" text-anchor="middle" font-size="18">V</text>
    <g v-for="(score,key) in SCORES" :key="key">
      <text x="42" :y="126 + key * 47">{{ key }}</text>
      <text :x="compact ? 146 : 116" :y="126 + key * 47">{{ score }}</text>
      <text :x="compact ? 278 : 224" :y="126 + key * 47" text-anchor="middle">[{{ VALUES[key].join(', ') }}]</text>
    </g>
    <rect :x="tile.x" :y="tile.y" :width="tile.w" height="228" rx="8" fill="var(--ej-surface)" stroke="var(--ej-b)" />
    <text :x="tile.x + tile.w / 2" :y="tile.y + 34" text-anchor="middle" font-size="22">{{ step < 2 ? '第一块：key 0、1' : '第二块：key 2、越界位置' }}</text>
    <text :x="tile.x + 14" :y="tile.y + 71" font-size="18">key ↓</text>
    <text :x="tile.x + 110" :y="tile.y + 71" text-anchor="middle" font-size="18">score</text>
    <text :x="tile.x + 222" :y="tile.y + 71" text-anchor="middle" font-size="18">V：分量 →</text>
    <g v-for="(key,i) in state.keys" :key="i">
      <rect :x="tile.x + 9" :y="tile.y + 90 + i * 48" :width="tile.w - 18" height="40" rx="5" :fill="state.mask[i] ? 'var(--ej-b-soft)' : 'var(--ej-panel)'" :stroke="state.mask[i] ? 'var(--ej-b)' : 'var(--ej-line-strong)'" :stroke-dasharray="state.mask[i] ? undefined : '5 4'" />
      <text :x="tile.x + 23" :y="tile.y + 118 + i * 48">{{ state.mask[i] ? key : '无效' }}</text>
      <text :x="tile.x + 110" :y="tile.y + 118 + i * 48" text-anchor="middle">{{ state.tileLoaded ? fmt(state.scores[i]) : '等待' }}</text>
      <text :x="tile.x + 224" :y="tile.y + 118 + i * 48" text-anchor="middle">{{ state.tileLoaded ? state.mask[i] ? `[${state.values[i].join(', ')}]` : '不读取' : '等待' }}</text>
      <text :x="tile.x + tile.w - 22" :y="tile.y + 118 + i * 48" text-anchor="end" font-size="18">{{ state.mask[i] ? '有效' : 'mask' }}</text>
    </g>
    <text :x="tile.x + tile.w / 2" :y="tile.y + 207" text-anchor="middle" font-size="18">指数：{{ state.exponentReady ? `[${state.weights.map(fmt).join(', ')}]` : '等待当前基准' }}</text>
    <template v-if="[0,2].includes(step)">
      <NumberTransfer v-for="(key,i) in state.keys.filter(key => key < 3)" :key="key" :from="[compact ? 146 : 116, 119 + key * 47]" :to="[tile.x + 110, tile.y + 111 + i * 48]" :progress="motion(local, 0, ARRIVE_MS, reducedMotion)" :value="String(SCORES[key])" color="var(--ej-a)" />
      <NumberTransfer v-for="(key,i) in state.keys.filter(key => key < 3)" :key="`v${key}`" :from="[compact ? 278 : 224, 119 + key * 47]" :to="[tile.x + 224, tile.y + 111 + i * 48]" :progress="motion(local, 0, ARRIVE_MS, reducedMotion)" :value="`[${VALUES[key].join(',')}]`" color="var(--ej-b)" />
    </template>
    <text :x="width / 2" :y="historyY - 35" text-anchor="middle" font-size="19">{{ step === 3 ? '旧 l 与旧 a 同乘 exp(−2)' : step >= 2 ? 'mask：score=−∞ → 指数 0' : '每行一个 key，两列为 V 分量' }}</text>
    <rect x="16" :y="historyY" :width="width - 32" height="158" rx="8" fill="var(--ej-c-soft)" stroke="var(--ej-c)" />
    <text :x="width / 2" :y="historyY + 32" text-anchor="middle" font-size="20">跨块保留的状态</text>
    <text :x="width / 2" :y="historyY + 67" text-anchor="middle" font-size="18">旧 l={{ fmt(state.history.l) }}，a=[{{ state.history.a.map(fmt).join(', ') }}]</text>
    <text :x="width / 2" :y="historyY + 105" text-anchor="middle" font-size="21">当前 l={{ fmt(state.current.l) }}</text>
    <text :x="width / 2" :y="historyY + 138" text-anchor="middle" font-size="22">a=[{{ state.current.a.map(fmt).join(', ') }}]</text>
    <text :x="width / 2" :y="historyY + 207" text-anchor="middle" font-size="23">O = {{ state.output ? `[${state.output.map(fmt).join(', ')}]` : '最后再除以 l' }}</text>
    <text :x="width / 2" :y="historyY + 248" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">逻辑行列，不代表硬件 lane</text>
  </g>
</template>
