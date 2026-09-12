<script setup lang="ts">
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import type { SceneMeta } from '../../components/animation/sceneTypes'
const x = [3,4,-3,-4], w = [1,.5,2,1], epsilon = 1e-5
const square = x.map(v=>v*v), sum=square.reduce((a,b)=>a+b,0), mean=sum/x.length
const scale=1/Math.sqrt(mean+epsilon), y=x.map((v,i)=>v*scale*w[i])
const fmt=(v:number)=>Number.isInteger(v)?String(v):v.toFixed(4)
const meta: SceneMeta = { eyebrow:'13.1 · RMSNorm',title:'一个行级尺度，怎样影响每个输出？',viewBox:'0 0 720 440',steps:[
{label:'输入',title:'读取一行 x 和对应权重 w',narration:'四个输入和四个权重。epsilon=1e−5，与本章实验默认值相同。动画数值为手算展示。',duration:3000},
{label:'平方',title:'各自平方，负号在这一步消失',narration:'[3,4,−3,−4] 的平方是 [9,16,9,16]。每个平方暂时不依赖其他位置。',duration:3000},
{label:'归约',title:'先把前后半区相加',narration:'按 HIP 的树形归约顺序，9+9=18，16+16=32。这里用四个逻辑位置缩略，不表示实际 block 大小。',duration:3200},
{label:'均值',title:'得到整行平方和，再除以列数',narration:'18+32=50；50/4=12.5。分母是有效列数 4，不能改成填充后的 tile 宽度。',duration:3200},
{label:'尺度',title:'求一个标量，再广播给所有位置',narration:'inverse_rms=1/√(12.5+epsilon)≈0.2828。所有输出共用它，但仍保留各自输入的正负号。',duration:3600},
{label:'输出',title:'各位置乘原输入、同一尺度和自己的权重',narration:'例如第二项为 4×0.2828×0.5≈0.5657。归约将整行收成标量，广播又将标量用于整行。',duration:3600},
{label:'融合',title:'平方与统计值不必写成全局中间数组',narration:'本章 serial、block 和 Triton 都已在一个 kernel 内完成这些步骤。当前计时主要比较协作与配置，不是未融合与融合的对照。',duration:4000},
] }
</script>
<template>
<AlgorithmPlayer :meta="meta"><template #stage="{step,local}">
<text x="24" y="28" class="label">一行 4 列 · x = [3,4,−3,−4] · w = [1,0.5,2,1] · ε = 1e−5</text>
<g v-for="(v,i) in x" :key="i" :transform="`translate(${26+i*170},50)`">
<rect width="156" height="68" rx="8" fill="var(--ej-panel)" stroke="var(--ej-line)" />
<text x="12" y="24" class="label">列 {{i}}</text><text x="12" y="50" class="value">x {{v}} · w {{w[i]}}</text>
<path v-if="step>=1" d="M78 72V102" fill="none" stroke="var(--ej-a)" stroke-width="2" />
<rect v-if="step>=1" x="0" y="110" width="156" height="54" rx="7" fill="var(--ej-panel)" />
<text v-if="step>=1" x="12" y="143" class="value">x² = {{square[i]}}</text>
</g>
<g v-if="step===0"><text x="28" y="185" class="value">先想一想：y[0] 只由 x[0] 和 w[0] 决定吗？</text><text x="28" y="230" class="label">下一步会看到，同一行其他输入也会通过平方和影响它。</text></g>
<g v-if="step===1"><text x="28" y="270" class="value">平方仍是逐元素计算</text><text x="28" y="310" class="label">接下来把这 4 个结果合成一个行级统计量。</text></g>
<g v-if="step===2">
<path d="M104 219L186 256 M444 219L186 256 M274 219L524 256 M614 219L524 256" fill="none" stroke="var(--ej-active)" stroke-width="2" />
<text x="112" y="290" class="value">9 + 9 = 18</text><text x="435" y="290" class="value">16 + 16 = 32</text>
<text x="28" y="366" class="label">每一轮结束后，下一轮才能读取新的部分和。</text></g>
<g v-if="step===3"><text x="28" y="269" class="value">平方和 = 18 + 32 = {{sum}}</text><text x="28" y="311" class="value">mean_square = {{sum}} / {{x.length}} = {{mean}}</text><text x="28" y="366" class="label">不是先求 x 的均值，也没有执行 x − mean(x)。</text></g>
<g v-if="step===4 || step===5">
<rect x="187" y="235" width="342" height="43" rx="8" fill="var(--ej-panel)" stroke="var(--ej-active)" />
<text x="206" y="263" class="value">共享尺度 r = {{fmt(scale)}}</text>
<g v-for="(v,i) in y" :key="i"><path :d="`M358 283 L${104+i*170} 325`" fill="none" stroke="var(--ej-active)" stroke-width="2" /><circle v-if="local<1000" :cx="358+(104+i*170-358)*Math.min(local/1000,1)" :cy="283+42*Math.min(local/1000,1)" r="4" fill="var(--ej-active)" /><text :x="32+i*170" y="357" class="value">{{step===5 ? fmt(v) : 'x['+i+'] × r × w['+i+']'}}</text></g>
<text x="28" y="410" class="label">{{step===5 ? '输出的正负号来自原输入；weight 可以让不同列有不同缩放。' : '广播表示重复使用同一个值，不表示再做四次平方和。'}}</text>
</g>
<g v-if="step===6">
<rect x="26" y="235" width="666" height="176" rx="8" fill="var(--ej-panel)" />
<text x="44" y="269" class="value">kernel 内：平方 → 局部和 → 行归约 → 缩放</text>
<text x="44" y="307" class="label">全局中间 square 数组：不需要</text><text x="44" y="341" class="label">全局中间 row statistic 数组：不需要</text><text x="44" y="379" class="label">HIP 源码仍再次读取 x；物理流量不能只从源码推断。</text>
</g>
</template></AlgorithmPlayer>
</template>
<style scoped>text{fill:var(--ej-ink);font-family:var(--vp-font-family-base)}.label{font-size:14px;fill:var(--ej-ink-soft)}.value{font-size:17px;font-weight:600}</style>
