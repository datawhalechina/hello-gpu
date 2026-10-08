<script setup lang="ts">
import {computed} from 'vue'
import {X,W,MATH,format,mathState,progress} from './rmsnorm-model'
const props=defineProps<{step:number;local:number;compact:boolean;reducedMotion:boolean}>()
const s=computed(()=>mathState(props.step,props.local,props.reducedMotion))
const p=computed(()=>progress(props.local,props.reducedMotion))
const width=computed(()=>props.compact?400:720), cols=computed(()=>props.compact?2:4)
const card=computed(()=>(width.value-48)/cols.value), middle=computed(()=>props.compact?340:245)
</script>
<template><g font-family="inherit" fill="var(--ej-ink)">
<text x="24" y="32" font-size="20" font-weight="600">{{step<2?'原输入保留在上方':'先得到整行统计量'}}</text>
<g v-for="(v,i) in X" :key="i" :transform="`translate(${24+i%cols*card},${58+Math.floor(i/cols)*125})`">
 <rect :width="card-12" height="108" rx="8" fill="var(--ej-panel)" stroke="var(--ej-line)"/>
 <text x="12" y="25" font-size="18">列 {{i}} · w={{W[i]}}</text><text x="12" y="55" font-size="25">x = {{v}}</text>
 <text x="12" y="88" font-size="21" fill="var(--ej-a)">{{step===0?'':`x² = ${s.squares?.[i] ?? '…'}`}}</text>
</g>
<g v-if="step>=2">
 <path v-if="step===2" :d="`M${width/2} ${compact?292:172} V${middle-10}`" fill="none" stroke="var(--ej-a)" stroke-width="2"/>
 <rect x="24" :y="middle" :width="width-48" height="86" rx="8" fill="var(--ej-c-soft)" stroke="var(--ej-c)"/>
 <text :x="width/2" :y="middle+31" text-anchor="middle" font-size="19">{{step===2?'9 + 16 + 9 + 16':step===3?'平方和 / 有效列数':step===4?'r = 1 / √(12.5 + ε)':'同一行使用同一个 r'}}</text>
 <text :x="width/2" :y="middle+65" text-anchor="middle" font-size="27">{{step===2?(s.sum??'等待求和'):step===3?(s.mean===null?'等待除法':'50 / 4 = 12.5'):(s.scale===null?'等待计算':format(MATH.scale))}}</text>
</g>
<template v-if="step===5"><g v-for="(v,i) in MATH.output" :key="i">
 <path :d="`M${width/2} ${middle+88} L${24+(i+.5)*(width-48)/4} ${middle+108}`" fill="none" stroke="var(--ej-c)"/>
 <circle v-if="p<1" :cx="width/2+(24+(i+.5)*(width-48)/4-width/2)*p" :cy="middle+88+20*p" r="4" fill="var(--ej-c)"/>
 <text :x="24+(i+.5)*(width-48)/4" :y="middle+137" text-anchor="middle" :font-size="compact?19:24">{{s.output?format(v):'…'}}</text>
</g></template>
<text v-else x="24" :y="compact?516:407" font-size="19">{{step===0?'目标：求出这一行的四个输出':step===1?'四个平方，下一步合成一个和':'中间结果确定后，才能继续下一步'}}</text>
</g></template>
