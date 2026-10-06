<script setup lang="ts">
import { computed } from 'vue'
import { twoStageState, tritonState, motion, TRITON_ASSIGNMENTS, TRITON_INPUT } from './reduction-model'
const props=defineProps<{step:number;local:number;compact:boolean;reducedMotion:boolean;mode:'two-stage'|'triton'}>()
const s=computed(()=>twoStageState(props.step,props.local,props.reducedMotion))
const tr=computed(()=>tritonState(props.step,props.local,props.reducedMotion))
const w=computed(()=>props.compact?400:720)
const bw=computed(()=>props.compact?352:320)
const by=(i:number)=>props.compact?66+i*178:66
const bx=(i:number)=>props.compact?24:24+i*352
const py=computed(()=>props.compact?442:278)
const p=computed(()=>motion(props.local,props.reducedMotion))
const partials=computed(()=>props.mode==='triton'?tr.value.partials:s.value.partials)
const output=computed(()=>props.mode==='triton'?tr.value.output:s.value.output)
const indices=(pid:number)=>TRITON_ASSIGNMENTS[pid][props.step>=2&&pid===0?1:0]
</script>
<template>
<g font-family="inherit" fill="var(--ej-ink)" :data-reduction-mode="mode" :data-reduction-step="step">
  <template v-if="mode==='two-stage' && step<3">
    <text x="24" y="32" font-size="20" font-weight="600">只放大 block 0 的线程 0</text>
    <text x="24" y="65" font-size="18" fill="var(--ej-ink-soft)">输入共 16 项 · 2 个 block × 4 线程</text>
    <g v-for="(index,i) in [0,8]" :key="index" :transform="`translate(${24+i*(w-48)/2},110)`">
      <rect :width="(w-48)/2-16" height="110" rx="8" fill="var(--ej-a-soft)" :stroke="step===i+1?'var(--ej-active)':'var(--ej-a)'" :stroke-width="step===i+1?3:1" />
      <text x="16" y="30" font-size="20">input[{{index}}]</text><text x="16" y="77" font-size="32">3</text>
    </g>
    <path :d="`M${w/4} 228 L${w/2} 290 L${w*3/4} 228`" fill="none" stroke="var(--ej-line-strong)" stroke-width="2" />
    <text :x="w/2" y="264" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">下标前进 2 × 4 = 8</text>
    <rect :x="w/2-135" y="294" width="270" height="94" rx="8" fill="var(--ej-c-soft)" stroke="var(--ej-c)" />
    <text :x="w/2" y="325" text-anchor="middle" font-size="20">线程 0 的 local</text>
    <text :x="w/2" y="366" text-anchor="middle" font-size="28" font-weight="700">{{s.selectedLocal}}</text>
    <g v-if="step>0&&p<1&&!reducedMotion">
      <rect :x="(step===1?w/4:w*3/4)+(w/2-(step===1?w/4:w*3/4))*p-17" :y="215+75*p" width="34" height="30" rx="5" fill="var(--ej-a-soft)"/>
      <text :x="(step===1?w/4:w*3/4)+(w/2-(step===1?w/4:w*3/4))*p" :y="237+75*p" text-anchor="middle" font-size="22">3</text>
    </g>
    <text :x="w/2" :y="compact?449:431" text-anchor="middle" font-size="20">{{step===0?'local 从 0 开始':step===1?'0 + input[0] → 3':'3 + input[8] → 6'}}</text>
  </template>
  <template v-else>
    <text x="24" y="32" font-size="20" font-weight="600">{{mode==='triton'?'两个 program，两个累计向量':'先在各 block 内合并'}}</text>
    <g v-for="pid in [0,1]" :key="pid" :transform="`translate(${bx(pid)},${by(pid)})`">
      <rect :width="bw" height="158" rx="8" fill="var(--ej-panel)" stroke="var(--ej-line-strong)" />
      <text x="14" y="28" font-size="20" font-weight="600">{{mode==='triton'?'program':'block'}} {{pid}}</text>
      <template v-if="mode==='two-stage'">
        <g v-for="tid in [0,1,2,3]" :key="tid" :transform="`translate(${14+tid*(bw-28)/4},44)`">
          <text x="2" y="16" font-size="17">线程 {{tid}}</text>
          <rect y="24" :width="(bw-28)/4-8" height="40" rx="4" fill="var(--ej-a-soft)" />
          <text :x="((bw-28)/4-8)/2" y="52" text-anchor="middle" font-size="23">{{s.locals?s.locals[pid][tid]:'待完成'}}</text>
        </g>
        <text x="14" y="139" font-size="21">{{s.sums?`块内和 = ${s.sums[pid]}`:'块内和：尚未合并'}}</text>
      </template>
      <template v-else>
        <text x="14" y="57" font-size="18">{{pid===0?(step>=2?'第二片段：8、9 有效':'第一片段：下标 0–3'):(step>=2?'片段 4–7 · 下一起点 12 结束':'第一片段：下标 4–7')}}</text>
        <g v-for="(index,i) in indices(pid)" :key="i" :transform="`translate(${14+i*(bw-28)/4},71)`">
          <rect :width="(bw-28)/4-8" height="37" rx="4" :fill="index===null?'var(--ej-surface)':'var(--ej-a-soft)'" stroke="var(--ej-line-strong)" :stroke-dasharray="index===null?'4 3':undefined" />
          <text :x="((bw-28)/4-8)/2" y="26" text-anchor="middle" :font-size="index===null?17:23">{{index===null?'补 0':TRITON_INPUT[index]}}</text>
        </g>
        <text x="14" y="140" font-size="19">{{pid===0?`累计 [${tr.accumulator.join(', ')}]`:`累计 [${step>1||step===1&&p===1?'4, 1, 6, 2':'0, 0, 0, 0'}]`}}</text>
      </template>
    </g>
    <path :d="compact?`M200 402 V${py-7}`:`M184 225 L${w/2} ${py-7} L536 225`" fill="none" stroke="var(--ej-active)" stroke-width="2"/>
    <rect x="24" :y="py" :width="w-48" height="80" rx="8" fill="var(--ej-b-soft)" stroke="var(--ej-b)"/>
    <text x="40" :y="py+28" font-size="19">partial 数组 · 各组独占写入</text>
    <text :x="w/2" :y="py+60" text-anchor="middle" font-size="24">{{partials?`[${partials.join(', ')}]`:'[ 未写入, 未写入 ]'}}</text>
    <path :d="`M${w/2} ${py+83} V${py+109}`" fill="none" stroke="var(--ej-line-strong)" stroke-width="2"/>
    <rect x="24" :y="py+114" :width="w-48" height="74" rx="8" :fill="output===null?'var(--ej-surface)':'var(--ej-c-soft)'" stroke="var(--ej-c)"/>
    <text :x="w/2" :y="py+143" text-anchor="middle" font-size="19">第二阶段 · 等第一阶段结束</text>
    <text :x="w/2" :y="py+173" text-anchor="middle" font-size="23" font-weight="600">{{output!==null?`最终和 = ${output}`:mode==='triton'&&tr.finalInput?'读取 [15, 13, 补0, 补0]':'最终输出：尚未写入'}}</text>
  </template>
</g>
</template>
