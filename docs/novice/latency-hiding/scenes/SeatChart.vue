<script setup lang="ts">
/**
 * 1-12 住得下几支（关卡自己的 scenes，不用登记组件）。
 *
 * 上面一排是一个工位旁边的工具台：一共 LANE_VGPRS 个寄存器（示意），按每个线程用几个分成一份一份，
 * 一份住一支小队（住下的每支小队，在每个工位上都有一个线程）。下面一排是流水线的名额。
 * 两排里先用完的那一排，定了同时住得下几支：涂色的是住下的，空框是空着的。读数和下面那一句
 * （challenge.ts 的 seatsText）跟着寄存器的旋钮马上变（03 第 1 节第 4 条）。数都是模拟。
 */
import { computed } from 'vue'
import { LANE_VGPRS, SLOTS, occupancyOf, percent, seatsOf, seatsText } from '../challenge.ts'

const props = defineProps<{ vgprs: number }>()

const seats = computed(() => seatsOf(props.vgprs))
/** 工具台分成几份；份数比名额多时，多出来的份空着。 */
const shares = computed(() => Array.from({ length: seats.value.byRegisters }, (_, k) => k < seats.value.resident))
const slots = computed(() => Array.from({ length: SLOTS }, (_, k) => k < seats.value.resident))
const occupancy = computed(() => percent(occupancyOf(seats.value.resident)))
const line = computed(() => `${seatsText(seats.value)}，占用率 ${seats.value.resident} ÷ ${SLOTS} = ${occupancy.value}（模拟）。`)
</script>

<template>
  <figure class="sc">
    <div class="sc__row">
      <p class="sc__label">一个工位的工具台：{{ LANE_VGPRS }} 个寄存器，每个线程占 {{ vgprs }} 个</p>
      <div class="sc__bar" role="img" :aria-label="`工具台分成 ${shares.length} 份，${seats.resident} 份有小队住着`">
        <span v-for="(used, k) in shares" :key="k" class="sc__cell" :class="{ 'is-used': used }" />
      </div>
    </div>
    <div class="sc__row">
      <p class="sc__label">流水线的名额：{{ SLOTS }} 个</p>
      <div class="sc__bar" role="img" :aria-label="`${SLOTS} 个名额，住了 ${seats.resident} 个`">
        <span v-for="(used, k) in slots" :key="k" class="sc__cell" :class="{ 'is-used': used }" />
      </div>
    </div>
    <figcaption class="sc__line" aria-live="polite">{{ line }}</figcaption>
  </figure>
</template>

<style scoped>
.sc {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.sc__row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sc__label {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

/* 每一格一样宽：工具台那一排，一格就是一个线程占的那么多个寄存器。 */
.sc__bar {
  display: flex;
  gap: 2px;
  min-width: 0;
}

.sc__cell {
  flex: 1 1 0;
  min-width: 0;
  height: 16px;
  border-radius: 3px;
  background: var(--hg-surface);
  box-shadow: inset 0 0 0 1px var(--hg-border-strong);
}

.sc__cell.is-used {
  background: var(--hg-group-0);
  box-shadow: none;
}

.sc__line {
  color: var(--hg-ink);
  font-size: 14px;
  font-weight: 600;
}
</style>
