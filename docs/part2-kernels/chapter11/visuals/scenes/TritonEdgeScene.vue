<script setup lang="ts">
import { computed } from 'vue'
import MatrixGrid from '../MatrixGrid.vue'
import { edgeState } from '../matmulModel.mjs'
const props = withDefaults(defineProps<{ step: number; local: number; compact?: boolean; reducedMotion?: boolean }>(), { compact: false, reducedMotion: false })
const state = computed(() => edgeState(props.step,props.local,props.reducedMotion))
const outputX = computed(() => props.compact ? 86 : 450)
const outputY = computed(() => props.compact ? 466 : 105)
</script>

<template>
  <g font-family="inherit" fill="var(--ej-ink)">
    <text x="20" y="31" font-size="22" font-weight="600">右下角 2×2 输出 tile</text>
    <text x="20" y="65" font-size="20">行 [2,3]、列 [2,3]；只有 C[2,2] 有效</text>
    <MatrixGrid transform="translate(18,112)" :values="state.tileA" title="A 加载窗口" :row-labels="['r2','r3']" :column-labels="[`k${state.kStart}`,`k${state.kStart+1}`]" color="a" :empty="!state.loaded" />
    <MatrixGrid transform="translate(192,112)" :values="state.tileB" title="B 加载窗口" :row-labels="[`k${state.kStart}`,`k${state.kStart+1}`]" :column-labels="['c2','c3']" color="b" :empty="!state.loaded" />
    <text x="20" y="350" font-size="20">A：行 &lt; 3 且 K &lt; 3</text>
    <text x="20" y="382" font-size="20">B：K &lt; 3 且列 &lt; 3</text>
    <text x="20" y="418" font-size="20">{{ state.kStart===0 ? 'C[2,2] 本轮加：1×2 + 0×0 = 2' : 'C[2,2] 本轮加：1×1 + 0×0 = 1' }}</text>
    <g v-if="step===2 || step===4">
      <path :d="compact ? 'M104 318 H10 V445 Q10 500 78 535 M72 530 L78 535 L71 538' : 'M104 318 H10 V555 H388 V175 H440 M434 170 L440 175 L434 180'" fill="none" stroke="var(--ej-a)" stroke-width="2" />
      <path :d="compact ? 'M278 318 H350 V445 Q350 510 300 550 M304 544 L300 550 L307 551' : 'M278 318 H366 V201 H440 M434 196 L440 201 L434 206'" fill="none" stroke="var(--ej-b)" stroke-width="2" />
    </g>
    <g :transform="`translate(${outputX},${outputY})`">
      <text x="100" y="0" text-anchor="middle" font-size="20" font-weight="600">program 临时累加块</text>
      <g v-for="cell in state.outputCells" :key="`${cell.row},${cell.column}`">
        <rect :x="(cell.column-2)*108" :y="28+(cell.row-2)*100" width="98" height="90" rx="8" :fill="cell.valid ? 'var(--ej-c-soft)' : 'var(--ej-panel)'" :stroke="cell.valid ? 'var(--ej-c)' : 'var(--ej-line)'" :stroke-dasharray="cell.valid ? undefined : '5 3'" />
        <text :x="49+(cell.column-2)*108" :y="54+(cell.row-2)*100" text-anchor="middle" font-size="18">({{ cell.row }},{{ cell.column }})</text>
        <text :x="49+(cell.column-2)*108" :y="91+(cell.row-2)*100" text-anchor="middle" font-size="27">{{ cell.value }}</text>
        <text v-if="!cell.valid" :x="49+(cell.column-2)*108" :y="112+(cell.row-2)*100" text-anchor="middle" font-size="18">不写回</text>
      </g>
    </g>
    <g :transform="`translate(${compact ? 24 : 408},${compact ? 760 : 403})`">
      <path v-if="step===5" d="M144 -45 V-10 M139 -16 L144 -10 L149 -16" fill="none" stroke="var(--ej-c)" stroke-width="2.5" />
      <rect width="288" height="126" rx="10" :fill="state.output===null ? 'var(--ej-surface)' : 'var(--ej-c-soft)'" stroke="var(--ej-c)" :stroke-dasharray="state.output===null ? '5 3' : undefined" />
      <text x="16" y="31" font-size="20">C 写回：行 &lt; 3 且列 &lt; 3</text>
      <text x="16" y="65" font-size="20">只有 C[2,2]：</text>
      <text x="144" y="104" text-anchor="middle" :font-size="state.output===null ? 22 : 30">{{ state.output===null ? '尚未写回' : state.output }}</text>
    </g>
    <text :x="compact ? 24 : 360" :y="compact ? 934 : 585" :text-anchor="compact ? 'start' : 'middle'" font-size="18" fill="var(--ej-ink-soft)">{{ compact ? '有效的 0 来自输入；补 0 来自 mask' : 'A、B 各有自己的加载 mask；C 还要单独检查写回范围' }}</text>
  </g>
</template>
