<script setup lang="ts">
/**
 * 1-11 探索三「算出有效带宽」（关卡自己的 scenes，不用登记组件）。
 *
 * 两版向量加法都照报告丙的量法（预热、停表前同步）量到的周期数，读者只换一个旋钮：字节数怎么数——
 * 只数 c、只数 a 和 b、a b c 都数、按搬的车数。下面两行写出算式和结果，条的满格是模拟器里有效带宽的上限
 * （一车 128 字节、4 个周期，challenge.ts 的 BANDWIDTH_CAP），旋钮一换马上重算（03 第 1 节第 4 条）。
 * 默认只数 c：能算，可数少了。旋钮不存草稿，刷新回到默认。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import {
  ADD_KERNELS, ADD_STRIDES, BANDWIDTH_CAP, BYTE_COUNTS, DEFAULT_BYTE_COUNT, TRUSTED_ADD_READINGS,
  bandwidthText, countFormula, countedBandwidth, decimal, type ByteCount,
} from '../challenge.ts'

const titleId = `${useId()}-title`
const count = ref<ByteCount>(DEFAULT_BYTE_COUNT)

const rows = computed(() => ADD_KERNELS.map((k, v) => {
  const bw = countedBandwidth(count.value, v)
  return {
    name: k.label,
    formula: `${countFormula(count.value, ADD_STRIDES[v])} 字节 ÷ ${TRUSTED_ADD_READINGS[v]} 个周期`,
    value: decimal(bw),
    fill: `${Math.min(bw / BANDWIDTH_CAP, 1) * 100}%`,
    cls: `is-k${v}`,
  }
}))
const readout = computed(() => bandwidthText(count.value))
</script>

<template>
  <section class="bw" :aria-labelledby="titleId">
    <header class="bw__head">
      <span class="bw__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="bw__title">算出有效带宽</strong>
      <span class="bw__tag">模拟</span>
    </header>
    <p class="bw__rules">
      两版都照报告丙的量法：改前量到 {{ TRUSTED_ADD_READINGS[0] }}、改后 {{ TRUSTED_ADD_READINGS[1] }} 个周期。
      有效带宽 = 字节数 ÷ 用时，字节数怎么数由你来选。条的满格是模拟器里的上限：每个周期 {{ BANDWIDTH_CAP }} 字节。
    </p>

    <div class="bw__knob">
      <Knob v-model="count" label="字节数怎么数" :options="BYTE_COUNTS" />
    </div>

    <ul class="bw__rows">
      <li v-for="row in rows" :key="row.name" class="bw__row">
        <span class="bw__name">{{ row.name }}</span>
        <span class="bw__formula">{{ row.formula }} ≈ <b>{{ row.value }}</b> 字节/周期</span>
        <span class="bw__track" aria-hidden="true">
          <span class="bw__fill" :class="row.cls" :style="{ width: row.fill }" />
          <span class="bw__cap">上限 {{ BANDWIDTH_CAP }}</span>
        </span>
      </li>
    </ul>

    <p class="bw__readout" aria-live="polite">{{ readout }}</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的探索（1-7 的 FetchTrip）。 */
.bw {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 20px 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.bw__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.bw__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.bw__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.bw__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.bw__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.bw__knob {
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.bw__rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bw__row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}

.bw__name {
  font-size: 14px;
  font-weight: 700;
}

.bw__formula {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.bw__formula b {
  color: var(--hg-ink);
}

/* 底槽就是上限：条按「带宽 ÷ 上限」占满格的几成。 */
.bw__track {
  position: relative;
  display: block;
  height: 14px;
  margin-right: 4.5em;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  box-shadow: inset 0 0 0 1px var(--hg-border);
}

.bw__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.bw__fill.is-k0 {
  background: var(--hg-group-0);
}

.bw__fill.is-k1 {
  background: var(--hg-group-1);
}

.bw__cap {
  position: absolute;
  top: 50%;
  left: 100%;
  padding-left: 6px;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  white-space: nowrap;
  transform: translateY(-50%);
}

.bw__readout {
  min-height: 3.2em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .bw {
    padding: 16px 14px;
  }

  .bw__knob {
    padding: 12px 10px;
  }
}
</style>
