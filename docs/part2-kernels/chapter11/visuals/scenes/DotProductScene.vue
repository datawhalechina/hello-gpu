<script setup lang="ts">
import { computed } from 'vue'
import { A, B, dotState, ARRIVAL_MS } from '../matmulModel.mjs'
const props = withDefaults(defineProps<{ step: number; local: number; compact?: boolean; reducedMotion?: boolean }>(), { compact: false, reducedMotion: false })
const state = computed(() => dotState(props.step, props.local, props.reducedMotion))
const width = computed(() => props.compact ? 360 : 720)
const accX = computed(() => props.compact ? 24 : 416)
const accY = computed(() => props.compact ? 385 : 140)
const outputY = computed(() => props.compact ? 577 : 345)
const progress = computed(() => props.reducedMotion ? 1 : Math.min(props.local / ARRIVAL_MS, 1))
</script>

<template>
  <g font-family="inherit" fill="var(--ej-ink)">
    <text x="24" y="30" font-size="22" font-weight="600">固定输出 C[0,0]</text>
    <text x="24" y="66" font-size="20">A 第 0 行 · 输入保持不变</text>
    <g v-for="(value,k) in A[0]" :key="`a${k}`">
      <rect :x="24+k*100" y="83" width="88" height="62" rx="8" fill="var(--ej-a-soft)" :stroke="state.k===k ? 'var(--ej-a)' : 'var(--ej-line)'" :stroke-width="state.k===k ? 3 : 1" />
      <text :x="68+k*100" y="121" text-anchor="middle" font-size="26">{{ value }}</text>
      <text :x="68+k*100" y="171" text-anchor="middle" font-size="18">k={{ k }}</text>
    </g>
    <text x="24" y="207" font-size="20">B 第 0 列 · 按 k 对齐</text>
    <g v-for="(row,k) in B" :key="`b${k}`">
      <rect :x="24+k*100" y="224" width="88" height="62" rx="8" fill="var(--ej-b-soft)" :stroke="state.k===k ? 'var(--ej-b)' : 'var(--ej-line)'" :stroke-width="state.k===k ? 3 : 1" />
      <text :x="68+k*100" y="262" text-anchor="middle" font-size="26">{{ row[0] }}</text>
    </g>
    <path v-if="state.k!==null" :d="`M${68+state.k*100} 176 V193`" stroke="var(--ej-active)" fill="none" stroke-width="2" stroke-dasharray="4 3" />
    <text x="24" y="331" font-size="22">{{ state.k===null ? '沿 k 取对应元素，乘后相加' : `${state.a} × ${state.b} = ${state.product}` }}</text>

    <g :transform="`translate(${accX},${accY})`">
      <rect width="288" height="146" rx="12" fill="var(--ej-panel)" stroke="var(--ej-active)" stroke-width="2" />
      <text x="20" y="33" font-size="21" font-weight="600">线程的临时部分和</text>
      <text x="144" y="92" font-size="36" text-anchor="middle">{{ state.accumulator }}</text>
      <text x="20" y="126" font-size="20">{{ state.k===null ? state.output===null ? '尚未写入 C' : '写回后仍保留累计值' : `${state.previous} + ${state.product} = ${state.previous+state.product}` }}</text>
    </g>
    <g v-if="state.k!==null && !state.ready && !reducedMotion">
      <path :d="compact ? 'M166 344 V375' : 'M322 316 Q384 316 406 250'" fill="none" stroke="var(--ej-active)" stroke-width="2" />
      <circle :cx="compact ? 166 : 322+84*progress" :cy="compact ? 344+31*progress : 316-66*progress" r="5" fill="var(--ej-active)" />
    </g>
    <g :transform="`translate(${compact ? 24 : 416},${outputY})`">
      <path v-if="step===4" d="M144 -39 V-8 M139 -14 L144 -8 L149 -14" fill="none" stroke="var(--ej-c)" stroke-width="2.5" />
      <rect width="288" height="114" rx="12" :fill="state.output===null ? 'var(--ej-surface)' : 'var(--ej-c-soft)'" stroke="var(--ej-c)" :stroke-dasharray="state.output===null ? '5 4' : undefined" />
      <text x="20" y="32" font-size="21">GPU 输出 C[0,0]</text>
      <text x="144" y="81" text-anchor="middle" :font-size="state.output===null ? 22 : 32">{{ state.output===null ? '尚未写回' : state.output }}</text>
    </g>
    <text :x="width/2" :y="compact ? 736 : 510" text-anchor="middle" font-size="19" fill="var(--ej-ink-soft)">{{ step===4 ? '累加器保留 5，写回的是它的值' : '算出临时值，不等于已经写回数组' }}</text>
  </g>
</template>
