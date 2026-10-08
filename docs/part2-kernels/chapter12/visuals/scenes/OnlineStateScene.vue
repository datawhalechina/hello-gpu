<script setup lang="ts">
import { computed } from 'vue'
import { ARRIVE_MS, KEY2, SCORES, VALUES, fmt, motion, onlineFrame } from '../../attention-model'
import NumberTransfer from './NumberTransfer.vue'
const props = withDefaults(defineProps<{ step: number; local: number; compact?: boolean; reducedMotion?: boolean }>(), { compact: false, reducedMotion: false })
const state = computed(() => onlineFrame(props.step, props.local, props.reducedMotion))
const key = computed(() => props.step >= 3 ? 2 : Math.max(0, props.step - 1))
const source = computed(() => ({ x: 20, y: 86, w: props.compact ? 360 : 304 }))
const target = computed(() => ({ x: props.compact ? 20 : 396, y: props.compact ? 446 : 86, w: props.compact ? 360 : 304 }))
const rows = ['m', 'l', 'a[0]', 'a[1]']
const sourceValues = computed(() => [state.value.source.m, state.value.source.l, ...state.value.source.a])
const targetValues = computed(() => [state.value.current.m, state.value.current.l, ...state.value.current.a])
const outputY = computed(() => props.compact ? 730 : 486)
const action = computed(() => [
  ['初始化', 'm = −∞，l = 0，a = [0, 0]'],
  ['加入 key 0', '指数 1，贡献 [1, 0]'],
  ['加入 key 1', '指数 exp(−1)，贡献 [0, 2exp(−1)]'],
  ['新最大值：2 → 4', '旧 l 与旧 a 都必须换基准'],
  ['历史项同乘 exp(−2)', 'α = 0.1353…'],
  ['加入 key 2 的新贡献', 'l 加 1；a 加 [3, 1]'],
  ['全部 key 已处理', '两个分量分别除以同一个 l'],
][props.step])
</script>
<template>
  <g font-family="inherit" fill="var(--ej-ink)" font-size="21">
    <text :x="compact ? 200 : 360" y="32" text-anchor="middle">key {{ key }}：score={{ SCORES[key] }}，V=[{{ VALUES[key].join(', ') }}]</text>
    <text :x="compact ? 200 : 360" y="60" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">固定同一个 query，输入保持不变</text>
    <g v-for="(box, side) in [source, target]" :key="side">
      <rect :x="box.x" :y="box.y" :width="box.w" height="224" rx="9" :fill="side === 0 ? 'var(--ej-a-soft)' : 'var(--ej-c-soft)'" :stroke="side === 0 ? 'var(--ej-a)' : 'var(--ej-c)'" />
      <text :x="box.x + box.w / 2" :y="box.y + 32" text-anchor="middle" font-weight="650">{{ side === 0 ? '本轮开始的状态' : '当前保留的状态' }}</text>
      <g v-for="(label, i) in rows" :key="label">
        <text :x="box.x + 22" :y="box.y + 77 + i * 40">{{ label }}</text>
        <text :x="box.x + box.w - 24" :y="box.y + 77 + i * 40" text-anchor="end" font-size="24">{{ fmt((side === 0 ? sourceValues : targetValues)[i]) }}</text>
      </g>
    </g>
    <rect :x="compact ? 20 : 84" :y="compact ? 334 : 340" :width="compact ? 360 : 552" height="86" rx="8" fill="var(--ej-b-soft)" stroke="var(--ej-b)" />
    <text :x="compact ? 200 : 360" :y="compact ? 365 : 371" text-anchor="middle" font-size="22">{{ action[0] }}</text>
    <text :x="compact ? 200 : 360" :y="compact ? 397 : 403" text-anchor="middle" font-size="18">{{ action[1] }}</text>
    <template v-if="step === 4">
      <NumberTransfer v-for="i in [1,2,3]" :key="i" :from="[source.x + source.w - 26, source.y + 70 + i * 40]" :to="[target.x + target.w - 26, target.y + 70 + i * 40]" :progress="motion(local, 0, ARRIVE_MS, reducedMotion)" :value="fmt(sourceValues[i])" color="var(--ej-a)" />
    </template>
    <template v-if="step === 5">
      <NumberTransfer v-for="(value,d) in VALUES[2]" :key="d" :from="[compact ? 260 : 516, 38]" :to="[target.x + target.w - 26, target.y + 150 + d * 40]" :progress="motion(local, 0, ARRIVE_MS, reducedMotion)" :value="String(value)" color="var(--ej-b)" />
    </template>
    <text :x="compact ? 200 : 360" :y="outputY - 30" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">{{ step === 4 ? `缩放后 l=${fmt(KEY2.scaled.l)}，尚未加新项` : step >= 5 ? '本轮旧值保留，可与更新结果核对' : 'm 决定当前指数使用哪个基准' }}</text>
    <rect x="20" :y="outputY" :width="compact ? 360 : 680" height="66" rx="8" fill="var(--ej-surface)" stroke="var(--ej-c)" />
    <text :x="compact ? 200 : 360" :y="outputY + 41" text-anchor="middle" font-size="23">O = {{ state.output ? `[${state.output.map(fmt).join(', ')}]` : '最后再做 a / l' }}</text>
    <text :x="compact ? 200 : 360" :y="outputY + 102" text-anchor="middle" font-size="18" fill="var(--ej-ink-soft)">显示四位小数，计算不提前舍入</text>
  </g>
</template>
