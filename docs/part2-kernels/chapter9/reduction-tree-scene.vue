<script setup lang="ts">
import { computed } from 'vue'
import { SUM_TREE, sumTreeState, motion } from './reduction-model'

const props = defineProps<{step:number;local:number;compact:boolean;reducedMotion:boolean}>()
const state = computed(() => sumTreeState(props.step, props.local, props.reducedMotion))
const width = computed(() => props.compact ? 400 : 720)
const nodeWidth = computed(() => props.compact ? 36 : 64)
const progress = computed(() => motion(props.local, props.reducedMotion))
// The same tree stays on screen. Only the current layer's copied values move.
const point = (level:number, index:number) => ({
  x:24+(index+.5)*(width.value-48)/SUM_TREE[level].length,
  y:80+level*100
})
const edges = computed(() => SUM_TREE.slice(1).flatMap((row,i) => row.flatMap((_,parent) =>
  [0,1].map(side => ({level:i+1, parent, side, source:point(i,parent*2+side), target:point(i+1,parent), value:SUM_TREE[i][parent*2+side]}))
)))
const nodeReady = (level:number) => level <= state.value.completedLevel
const highlight = (level:number) => level === state.value.round
</script>

<template>
<g font-family="inherit" fill="var(--ej-ink)" :data-reduction-tree-step="state.round">
  <text :x="width/2" y="30" text-anchor="middle" font-size="20" font-weight="600">{{state.round===0?'8 个输入，逐层合成 1 个和':`第 ${state.round} 轮 · ${SUM_TREE[state.round].length} 次加法`}}</text>

  <g v-for="edge in edges" :key="`${edge.level}-${edge.parent}-${edge.side}`">
    <path :d="`M${edge.source.x} ${edge.source.y+21} L${edge.target.x} ${edge.target.y-22}`" fill="none"
      :stroke="highlight(edge.level)?'var(--ej-active)':edge.level<state.round?'var(--ej-a)':'var(--ej-line-strong)'"
      :stroke-width="highlight(edge.level)?3:1.5" :stroke-dasharray="edge.level>state.round?'4 4':undefined" />
    <g v-if="highlight(edge.level)&&progress<1&&!reducedMotion"
      :transform="`translate(${edge.source.x+(edge.target.x-edge.source.x)*progress},${edge.source.y+21+57*progress})`">
      <rect x="-13" y="-14" width="26" height="28" rx="5" fill="var(--ej-surface)" stroke="var(--ej-active)" />
      <text text-anchor="middle" y="8" font-size="22">{{edge.value}}</text>
    </g>
  </g>

  <g v-for="(row,level) in SUM_TREE" :key="level">
    <g v-for="(value,i) in row" :key="i" :transform="`translate(${point(level,i).x},${point(level,i).y})`">
      <circle v-if="level>0" cy="-31" r="10" fill="var(--ej-surface)" :stroke="highlight(level)?'var(--ej-active)':'var(--ej-line-strong)'" />
      <text v-if="level>0" y="-25" text-anchor="middle" font-size="19" :fill="level<=state.round?'var(--ej-ink)':'var(--ej-ink-soft)'">+</text>
      <rect :x="-nodeWidth/2" y="-20" :width="nodeWidth" height="40" rx="7"
        :fill="nodeReady(level)?level===3?'var(--ej-c-soft)':'var(--ej-a-soft)':'var(--ej-panel)'"
        :stroke="highlight(level)?'var(--ej-active)':nodeReady(level)?'var(--ej-a)':'var(--ej-line-strong)'"
        :stroke-width="highlight(level)?2.5:1" :stroke-dasharray="level>state.round?'3 3':undefined" />
      <text text-anchor="middle" y="9" font-size="26" :font-weight="highlight(level)?700:500"
        :fill="nodeReady(level)?'var(--ej-ink)':'var(--ej-ink-soft)'">{{nodeReady(level)?value:'·'}}</text>
    </g>
  </g>

  <text :x="width/2" y="444" text-anchor="middle" font-size="19" font-weight="600">{{state.round===0?'从上往下，每两个值合并一次':state.output!==null?'总和 = 24 · 共 7 次加法，3 轮合并':['','8 → 4 · 四对分别相加','4 → 2 · 合并上一层的部分和','2 → 1 · 合并最后两个值'][state.round]}}</text>
</g>
</template>
