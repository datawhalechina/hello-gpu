<script setup lang="ts">
import { computed } from 'vue'
import { ARRIVE_MS, CALCULATE_MS, KEY2, OLD, fmt, motion, syncFrame } from '../../attention-model'
import NumberTransfer from './NumberTransfer.vue'
const props = withDefaults(defineProps<{ step: number; local: number; compact?: boolean; reducedMotion?: boolean }>(), { compact: false, reducedMotion: false })
const state = computed(() => syncFrame(props.step, props.local, props.reducedMotion))
const width = computed(() => props.compact ? 400 : 720)
const cardX = (d: number) => props.compact ? 16 + d * 190 : 40 + d * 350
const cardW = computed(() => props.compact ? 178 : 290)
const consumerY = computed(() => props.compact ? 332 : 276)
const numeratorY = computed(() => props.compact ? 648 : 588)
const center = (d: number) => cardX(d) + cardW.value / 2
</script>
<template>
  <g font-family="inherit" fill="var(--ej-ink)" font-size="20">
    <rect x="16" y="18" :width="width - 32" height="212" rx="9" fill="var(--ej-b-soft)" stroke="var(--ej-b)" />
    <text :x="width / 2" y="49" text-anchor="middle" font-size="22" font-weight="650">共享状态 · 线程 0 写入</text>
    <text :x="width / 2" y="82" text-anchor="middle">已得到 key 2 的 score = 4</text>
    <text x="36" y="120">α = {{ fmt(state.sharedAlpha) }}</text>
    <text :x="compact ? 234 : 440" y="120">β = {{ fmt(state.sharedBeta) }}</text>
    <text x="36" y="156">m = {{ state.published ? 4 : 2 }}</text>
    <text :x="compact ? 190 : 390" y="156">l = {{ fmt(state.l) }}</text>
    <text :x="width / 2" y="196" text-anchor="middle" font-size="18">{{ state.barrierComplete ? '同步完成，当前系数继续保留' : state.published ? '系数已写好，仍需全 block 同步' : '旧基准为 2；本轮系数尚未发布' }}</text>
    <rect x="16" :y="consumerY - 62" :width="width - 32" height="42" rx="6" :fill="state.barrierComplete ? 'var(--ej-c-soft)' : 'var(--ej-panel)'" stroke="var(--ej-line-strong)" />
    <text :x="width / 2" :y="consumerY - 34" text-anchor="middle" font-size="19">{{ state.readable ? '两个消费者已取得当前系数' : state.barrierComplete ? '同步已完成：消费者可以读取' : '写完 → 全 block 同步 → 才能读' }}</text>
    <g v-for="d in [0, 1]" :key="d">
      <rect :x="cardX(d)" :y="consumerY" :width="cardW" height="246" rx="8" fill="var(--ej-surface)" stroke="var(--ej-a)" />
      <text :x="center(d)" :y="consumerY + 30" text-anchor="middle">消费者 {{ d }}</text>
      <text :x="center(d)" :y="consumerY + 66" text-anchor="middle" font-size="18">V₂[{{ d }}] = {{ d === 0 ? 3 : 1 }}</text>
      <text :x="center(d)" :y="consumerY + 104" text-anchor="middle">α = {{ fmt(state.privateAlpha) }}</text>
      <text :x="center(d)" :y="consumerY + 140" text-anchor="middle">β = {{ fmt(state.privateBeta) }}</text>
      <text :x="center(d)" :y="consumerY + 180" text-anchor="middle" font-size="19">旧 a = {{ state.oldOperand ? fmt(state.oldOperand[d]) : '等待读取' }}</text>
      <text :x="center(d)" :y="consumerY + 220" text-anchor="middle" font-size="20">新 a = {{ state.computedNumerator ? fmt(state.computedNumerator[d]) : '待计算' }}</text>
    </g>
    <text :x="width / 2" :y="numeratorY - 29" text-anchor="middle" font-size="20">各自计算 α×旧 a + β×V₂[d]</text>
    <rect x="16" :y="numeratorY" :width="width - 32" height="134" rx="9" fill="var(--ej-c-soft)" stroke="var(--ej-c)" />
    <text :x="width / 2" :y="numeratorY + 30" text-anchor="middle" font-size="21">共享 numerator · 各自更新一项</text>
    <text :x="width / 2" :y="numeratorY + 65" text-anchor="middle" font-size="18">本轮旧值 [{{ OLD.a.map(fmt).join(', ') }}]</text>
    <text v-for="d in [0, 1]" :key="d" :x="center(d)" :y="numeratorY + 105" text-anchor="middle" font-size="22">a[{{ d }}]={{ fmt(state.numerator[d]) }}</text>
    <text :x="width / 2" :y="numeratorY + 178" text-anchor="middle" font-size="19">{{ state.reusable ? '全部消费完成，才允许复用共享系数' : '仍有人使用系数时，不得覆盖' }}</text>
    <template v-for="d in [0, 1]" :key="d">
      <template v-if="step === 2 && state.barrierComplete">
        <NumberTransfer :from="[96, 112]" :to="[center(d), consumerY + 98]" :progress="motion(local, 550, ARRIVE_MS, reducedMotion)" :value="fmt(KEY2.alpha)" color="var(--ej-b)" />
        <NumberTransfer :from="[compact ? 280 : 486, 112]" :to="[center(d), consumerY + 134]" :progress="motion(local, 550, ARRIVE_MS, reducedMotion)" value="1" color="var(--ej-b)" />
      </template>
      <template v-if="step === 3">
        <NumberTransfer :from="[center(d), numeratorY + 98]" :to="[center(d), consumerY + 174]" :progress="motion(local, 0, 550, reducedMotion)" :value="fmt(OLD.a[d])" color="var(--ej-a)" />
        <NumberTransfer v-if="state.computedNumerator" :from="[center(d), consumerY + 214]" :to="[center(d), numeratorY + 98]" :progress="motion(local, ARRIVE_MS, CALCULATE_MS, reducedMotion)" :value="fmt(state.computedNumerator[d])" color="var(--ej-c)" />
      </template>
    </template>
  </g>
</template>
