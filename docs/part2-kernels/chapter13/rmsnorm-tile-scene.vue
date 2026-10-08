<script setup lang="ts">
import {computed} from 'vue'
import {tileState,format,MULTI_W} from './rmsnorm-model'
const props=defineProps<{step:number;local:number;compact:boolean;reducedMotion:boolean}>()
const s=computed(()=>tileState(props.step,props.local,props.reducedMotion))
const panelWidth=computed(()=>props.compact?352:324)
</script>
<template><g font-family="inherit" fill="var(--ej-ink)">
<text x="24" y="33" font-size="21" font-weight="600">program {{s.pid}} · 有效列数始终是 3</text>
<g v-for="(row,r) in s.rows" :key="row.row" :transform="`translate(${compact?24:24+r*348},${compact?63+r*265:63})`">
 <rect :width="panelWidth" height="249" rx="8" fill="var(--ej-panel)" :stroke="row.valid?'var(--ej-a)':'var(--ej-line)'"/>
 <text x="14" y="28" font-size="19">第 {{row.row}} 行 · {{row.valid?'有效':'不存在'}}</text>
 <g v-for="(v,c) in row.values" :key="c" :transform="`translate(${14+c*(panelWidth-28)/4},44)`">
  <rect :width="(panelWidth-28)/4-6" height="54" rx="5" :fill="row.mask[c]?'var(--ej-a-soft)':'var(--ej-panel)'" :stroke="row.mask[c]?'var(--ej-a)':'var(--ej-line)'" :stroke-dasharray="row.mask[c]?undefined:'4 3'"/>
  <text :x="((panelWidth-28)/4-6)/2" y="33" text-anchor="middle" :font-size="row.mask[c]?26:17">{{row.mask[c]?v:'mask'}}</text>
 </g>
 <template v-if="row.valid">
  <text x="14" y="126" font-size="19">平方和：{{s.showSum?row.stats!.sum:'等待归约'}}</text>
  <text x="14" y="160" font-size="19">r：{{s.showScale?format(row.stats!.scale):'等待计算'}}</text>
  <text x="14" y="198" font-size="18">三个输出</text>
  <text x="14" y="229" font-size="21">{{s.showOutput?row.stats!.output.map(format).join(' · '):'等待尺度与权重'}}</text>
 </template>
 <template v-else><text x="14" y="141" font-size="22">不加载，也不写回</text><text x="14" y="184" font-size="19">不是一行有效的零输入</text></template>
</g>
<text x="24" :y="compact?602:368" font-size="19">{{step>=3?`同列共享 w = [${MULTI_W.join(', ')}]`:'虚线格仅提供零贡献，不增加列数'}}</text>
</g></template>
