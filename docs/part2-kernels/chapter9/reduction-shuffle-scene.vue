<script setup lang="ts">
import {computed} from 'vue'
import {TREE,shuffleState,motion} from './reduction-model'
const props=defineProps<{step:number;local:number;compact:boolean;reducedMotion:boolean}>()
const s=computed(()=>shuffleState(props.step,props.local,props.reducedMotion))
const width=computed(()=>props.compact?400:720)
const pitch=computed(()=>(width.value-48)/8)
const boxWidth=computed(()=>props.compact?36:62)
const p=computed(()=>motion(props.local,props.reducedMotion))
const point=(level:number,index:number)=>({x:24+(index+.5)*pitch.value,y:105+level*112})
const edges=computed(()=>s.value.links.map(edge=>({...edge,
  own:point(edge.level-1,edge.target),from:point(edge.level-1,edge.source),to:point(edge.level,edge.target)
})))
const focus=(level:number)=>level===s.value.round
const ready=(level:number)=>level<=s.value.completedLevel
const noteX=(level:number)=>props.compact?level===1?224:170:level===1?414:300
</script>
<template><g font-family="inherit" fill="var(--ej-ink)" :data-shuffle-round="s.round">
 <text x="24" y="30" font-size="20" font-weight="600">{{compact?'固定位置，向下看每轮结果':'固定各位置，逐轮合并读到的副本'}}</text>
 <text x="24" y="59" font-size="18" fill="var(--ej-ink-soft)">{{s.round===0?'数字上方是位置编号':compact?'斜线读副本，竖线沿用旧值':'斜线：读取另一位置 · 竖线：沿用本位置旧值'}}</text>

 <g v-for="edge in edges" :key="`${edge.level}-${edge.target}`">
  <path :d="`M${edge.own.x} ${edge.own.y+21} V${edge.to.y-22}`" fill="none"
    stroke="var(--ej-line-strong)" stroke-width="1.5" stroke-dasharray="3 4"/>
  <path :d="`M${edge.from.x} ${edge.from.y+21} L${edge.to.x} ${edge.to.y-23}`" fill="none"
    :stroke="focus(edge.level)?'var(--ej-active)':'var(--ej-a)'" :stroke-width="focus(edge.level)?2.5:1.5"
    :opacity="edge.level>s.round?.18:focus(edge.level)?1:.6" />
  <path :d="`M${edge.to.x+1} ${edge.to.y-31} L${edge.to.x} ${edge.to.y-23} L${edge.to.x+9} ${edge.to.y-25}`"
    fill="none" :stroke="focus(edge.level)?'var(--ej-active)':'var(--ej-a)'" stroke-width="1.5"
    :opacity="edge.level>s.round?.18:1" />
  <g v-if="focus(edge.level)&&p<1&&!reducedMotion" :transform="`translate(${edge.from.x+(edge.to.x-edge.from.x)*p},${edge.from.y+21+68*p})`">
   <rect x="-13" y="-15" width="26" height="29" rx="5" fill="var(--ej-surface)" stroke="var(--ej-active)"/>
   <text text-anchor="middle" y="8" font-size="22">{{edge.value}}</text>
  </g>
 </g>

 <g v-for="(row,level) in TREE" :key="level">
  <g v-for="(value,i) in row" :key="i" :transform="`translate(${point(level,i).x},${point(level,i).y})`">
   <text v-if="level===0" y="-30" text-anchor="middle" font-size="17" fill="var(--ej-ink-soft)">{{i}}</text>
   <rect :x="-boxWidth/2" y="-20" :width="boxWidth" height="40" rx="6"
     :fill="ready(level)?level===3?'var(--ej-c-soft)':'var(--ej-a-soft)':'var(--ej-panel)'"
     :stroke="focus(level)?'var(--ej-active)':ready(level)?'var(--ej-a)':'var(--ej-line-strong)'"
     :stroke-width="focus(level)?2:1" :stroke-dasharray="level>s.round?'3 3':undefined" />
   <text text-anchor="middle" y="9" font-size="26" :font-weight="focus(level)?700:500"
     :fill="ready(level)?'var(--ej-ink)':'var(--ej-ink-soft)'">{{ready(level)?value:'·'}}</text>
  </g>
  <g v-if="level>0" :transform="`translate(${noteX(level)},${point(level,0).y-7})`" :opacity="level>s.round?.4:1">
   <text font-size="19" :font-weight="focus(level)?700:400">offset = {{2**(3-level)}}</text>
   <text y="29" font-size="18" fill="var(--ej-ink-soft)">{{level>s.round?'等待本轮合并':level===1?'3 + 4 → 7':level===2?'7 + 13 → 20':'20 + 4 → 24'}}</text>
  </g>
 </g>
 <text x="24" y="505" font-size="18" fill="var(--ej-ink-soft)">{{compact?'只画结果所需的依赖，其他 lane 仍执行':'下一层保留 lane 0 所需的依赖，不表示其他 lane 停止执行'}}</text>
</g></template>
