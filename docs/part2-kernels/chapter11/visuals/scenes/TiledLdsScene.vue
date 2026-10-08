<script setup lang="ts">
import { computed } from 'vue'
import MatrixGrid from '../MatrixGrid.vue'
import { ldsState } from '../matmulModel.mjs'
const props = withDefaults(defineProps<{ step: number; local: number; compact?: boolean; reducedMotion?: boolean }>(), { compact: false, reducedMotion: false })
const state = computed(() => ldsState(props.step, props.local, props.reducedMotion))
const ldsY = computed(() => props.compact ? 393 : 384)
const accX = computed(() => props.compact ? 24 : 408)
const accY = computed(() => props.compact ? 703 : 166)
const sourceA = computed(() => ({ x: 18+58+(state.value.inner ?? 0)*66, y: ldsY.value+74 }))
const sourceB = computed(() => ({ x: 192+58+66, y: ldsY.value+74+(state.value.inner ?? 0)*82 }))
const equation = computed(() => state.value.inner === null ? '部分和跨 K 轮保留' : `${state.value.previous} + ${state.value.left} × ${state.value.right} = ${state.value.previous+state.value.product}`)
const eventLabel = computed(() => {
  if (props.step===0) return '同一 block 的四个线程各负责一个输出'
  if (props.step===1 || props.step===5) return state.value.ready ? '全部写入完成 → 写后屏障完成 → 允许读取' : '各线程正在复制；消费者尚不能读'
  if (props.step===4 || props.step===8) return state.value.ready ? '全部消费者读完 → 读后屏障完成' : '等待其他消费者；不能覆盖旧 tile'
  if (props.step===9) return 'K 方向处理完毕，才写回输出数组'
  return `固定线程 (ty=0,tx=1)，执行 inner=${state.value.inner}`
})
</script>

<template>
  <g font-family="inherit" fill="var(--ej-ink)">
    <text x="20" y="30" font-size="21" font-weight="600">{{ state.tile===0 ? '第 1 轮：读取 K=0、1' : '第 2 轮：K=2 有效，K=3 补 0' }}</text>
    <MatrixGrid transform="translate(18,72)" :values="state.inputsA" title="A 输入窗口" :row-labels="['r0','r1']" :column-labels="[`k${state.kStart}`,`k${state.kStart+1}`]" color="a" />
    <MatrixGrid transform="translate(192,72)" :values="state.inputsB" title="B 输入窗口" :row-labels="[`k${state.kStart}`,`k${state.kStart+1}`]" :column-labels="['c0','c1']" color="b" />
    <g v-if="step===1 || step===5">
      <path :d="`M104 275 V${ldsY-45} M98 ${ldsY-51} L104 ${ldsY-45} L110 ${ldsY-51}`" fill="none" stroke="var(--ej-a)" stroke-width="2.5" />
      <path :d="`M278 275 V${ldsY-45} M272 ${ldsY-51} L278 ${ldsY-45} L284 ${ldsY-51}`" fill="none" stroke="var(--ej-b)" stroke-width="2.5" />
      <text x="20" y="312" font-size="19">各线程复制 A、B 各一格</text>
    </g>
    <MatrixGrid :transform="`translate(18,${ldsY})`" :values="state.sharedA ?? state.inputsA" title="LDS：tile_a" :row-labels="['r0','r1']" :column-labels="['i0','i1']" :active-row="state.inner===null ? null : 0" :active-column="state.inner" color="a" :empty="state.sharedA===null" />
    <MatrixGrid :transform="`translate(192,${ldsY})`" :values="state.sharedB ?? state.inputsB" title="LDS：tile_b" :row-labels="['i0','i1']" :column-labels="['c0','c1']" :active-row="state.inner" :active-column="state.inner===null ? null : 1" color="b" :empty="state.sharedB===null" />

    <g v-if="state.inner!==null">
      <path :d="compact ? `M${sourceA.x} ${sourceA.y+40} V629 Q${sourceA.x} 650 133 673` : `M${sourceA.x} ${sourceA.y+40} V620 Q382 620 399 348`" fill="none" stroke="var(--ej-a)" stroke-width="2" />
      <path :d="compact ? `M${sourceB.x} ${sourceB.y+40} V645 Q${sourceB.x} 665 231 673` : `M${sourceB.x+33} ${sourceB.y} H377 Q387 ${sourceB.y} 399 348`" fill="none" stroke="var(--ej-b)" stroke-width="2" />
      <text v-if="compact" x="180" y="687" text-anchor="middle" font-size="21">{{ state.left }} × {{ state.right }} = {{ state.product }}</text>
    </g>
    <g :transform="`translate(${accX},${accY})`">
      <rect width="288" height="260" rx="12" fill="var(--ej-panel)" stroke="var(--ej-active)" stroke-width="2" />
      <text x="18" y="32" font-size="21" font-weight="600">线程 (ty=0,tx=1)</text>
      <text x="18" y="64" font-size="20">C[0,1] 的临时部分和</text>
      <text x="144" y="119" text-anchor="middle" font-size="34">{{ state.accumulator[0][1] }}</text>
      <text x="144" y="158" text-anchor="middle" font-size="22">{{ equation }}</text>
      <text x="18" y="195" font-size="19">全块四个部分和：</text>
      <text x="144" y="228" text-anchor="middle" font-size="23">[{{ state.accumulator[0].join(', ') }}]　[{{ state.accumulator[1].join(', ') }}]</text>
    </g>
    <g :transform="`translate(${accX},${compact ? 1001 : 488})`">
      <path v-if="step===9" d="M144 -33 V-8 M139 -14 L144 -8 L149 -14" fill="none" stroke="var(--ej-c)" stroke-width="2.5" />
      <rect width="288" height="96" rx="10" :fill="state.output ? 'var(--ej-c-soft)' : 'var(--ej-surface)'" stroke="var(--ej-c)" :stroke-dasharray="state.output ? undefined : '5 4'" />
      <text x="18" y="31" font-size="21">GPU 输出 C[0,1]</text>
      <text x="144" y="72" text-anchor="middle" :font-size="state.output ? 30 : 21">{{ state.output ? state.output[0][1] : '尚未写回' }}</text>
    </g>
    <text v-if="!compact" x="360" y="665" font-size="19" text-anchor="middle" fill="var(--ej-ink-soft)">{{ eventLabel }}</text>
    <text v-else x="24" y="1138" font-size="18" fill="var(--ej-ink-soft)">{{ step===4 || step===8 ? '读完才能覆盖，不能只等当前线程' : '教学 block=2×2；不表示实际执行速度' }}</text>
  </g>
</template>
