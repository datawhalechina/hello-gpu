<script setup lang="ts">
import { computed } from 'vue'
import { barrierState, copyProgress, displayValue, READ_FIRST_MS, READ_ALL_MS } from '../../softmax-model'
import FlowArrow from '../FlowArrow.vue'
const props = defineProps<{ step: number; local: number; compact: boolean; reducedMotion: boolean }>()
const state = computed(() => barrierState(props.step, props.local, props.reducedMotion))
const width = computed(() => props.compact ? 400 : 720)
const cardWidth = computed(() => props.compact ? 352 : 304)
const cards = computed(() => props.compact ? [{ x: 24, y: 222 }, { x: 24, y: 390 }] : [{ x: 32, y: 228 }, { x: 384, y: 228 }])
const shared = computed(() => ({ x: width.value / 2 - 104, y: 68, w: 208, h: 88 }))
const statusY = computed(() => props.compact ? 576 : 431)
const readPaths = computed(() => cards.value.map((card, i) => {
  // Route to the corresponding private slot; input copy keeps shared[0] intact.
  const start = { x: shared.value.x + (i ? shared.value.w : 0), y: 108 }
  const side = props.compact ? (i ? 386 : 14) : (i ? 690 : 18)
  return [start, { x: side, y: 108 }, { x: side, y: card.y + 74 }, { x: card.x + (i ? cardWidth.value : 0), y: card.y + 74 }]
}))
const writePath = computed(() => {
  const card = cards.value[0]
  return [{ x: card.x + 12, y: card.y + 116 },
    { x: props.compact ? 8 : 20, y: card.y + 116 }, { x: props.compact ? 8 : 20, y: 181 },
    { x: width.value / 2, y: 181 }, { x: width.value / 2, y: 156 }]
})
</script>
<template>
  <g font-family="inherit" :data-barrier-step="step" :data-all-read="state.allReadersReady" :data-barrier-passed="state.barrierPassed">
    <text :x="width / 2" y="31" text-anchor="middle" font-size="20" font-weight="600" fill="var(--ej-ink)">同一个 block · 256 个线程</text>
    <g :data-shared-value="state.sharedValue">
      <rect :x="shared.x" :y="shared.y" :width="shared.w" :height="shared.h" rx="8" :fill="state.overwritten ? 'var(--ej-b-soft)' : 'var(--ej-a-soft)'" :stroke="state.overwritten ? 'var(--ej-b)' : 'var(--ej-a)'" stroke-width="2" />
      <text :x="width / 2" y="94" text-anchor="middle" font-size="20" fill="var(--ej-ink)">shared[0]</text>
      <text :x="width / 2" y="125" text-anchor="middle" font-size="28" font-weight="600" fill="var(--ej-ink)">{{ displayValue(state.sharedValue) }}</text>
      <text :x="width / 2" y="149" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">{{ state.sharedRole }}</text>
    </g>
    <g v-for="(reader, i) in state.readers" :key="reader.thread" :data-reader="reader.thread" :data-maximum="reader.maximum ?? 'unread'">
      <rect :x="cards[i].x" :y="cards[i].y" :width="cardWidth" height="142" rx="8" fill="var(--ej-panel)" stroke="var(--ej-line-strong)" />
      <text :x="cards[i].x + 16" :y="cards[i].y + 29" font-size="20" font-weight="600" fill="var(--ej-ink)">线程 {{ reader.thread }} · wave {{ reader.wave }}</text>
      <rect :x="cards[i].x + 12" :y="cards[i].y + 45" :width="cardWidth - 24" height="47" rx="6" :fill="reader.maximum === null ? 'var(--ej-bg)' : 'var(--ej-a-soft)'" :stroke="reader.maximum === null ? 'var(--ej-line-strong)' : 'var(--ej-a)'" :stroke-dasharray="reader.maximum === null ? '5 4' : undefined" />
      <text :x="cards[i].x + 26" :y="cards[i].y + 75" font-size="20" fill="var(--ej-ink)">maximum</text>
      <text :x="cards[i].x + cardWidth - 27" :y="cards[i].y + 75" text-anchor="end" font-size="24" font-weight="600" fill="var(--ej-ink)">{{ reader.maximum ?? '未读' }}</text>
      <rect v-if="state.localSum !== null && i === 0" :x="cards[i].x + 12" :y="cards[i].y + 100" :width="cardWidth - 24" height="32" rx="5" fill="var(--ej-b-soft)" stroke="var(--ej-b)" />
      <text :x="cards[i].x + cardWidth / 2" :y="cards[i].y + 122" text-anchor="middle" font-size="18" :fill="state.localSum !== null && i === 0 ? 'var(--ej-b)' : 'var(--ej-ink-soft)'">{{ state.localSum !== null && i === 0 ? `local_sum ≈ ${displayValue(state.localSum)}` : reader.maximum === null ? '等待取得副本' : '自己的副本继续保留' }}</text>
    </g>
    <g v-if="step === 1">
      <FlowArrow v-for="(points, i) in readPaths" :key="i" :points="points" :progress="copyProgress(local, reducedMotion, i === 0 ? READ_FIRST_MS : READ_ALL_MS)" value="1002" />
    </g>
    <FlowArrow v-if="step === 3" :points="writePath" :progress="copyProgress(local, reducedMotion)" value="0.1353" color="b" />
    <g>
      <line x1="24" :y1="statusY" :x2="width - 24" :y2="statusY" :stroke="state.barrierPassed ? 'var(--ej-c)' : 'var(--ej-line-strong)'" :stroke-dasharray="state.barrierPassed ? undefined : '6 5'" stroke-width="2" />
      <rect :x="width / 2 - 157" :y="statusY - 16" width="314" height="32" rx="6" fill="var(--ej-bg)" />
      <text :x="width / 2" :y="statusY + 7" text-anchor="middle" font-size="20" :fill="state.barrierPassed ? 'var(--ej-c)' : 'var(--ej-ink-soft)'">{{ state.barrierPassed ? '全 block 已经过读者屏障' : state.allReadersReady ? '全体已读完，下一步同步' : '还有读者未取得 maximum' }}</text>
    </g>
  </g>
</template>
