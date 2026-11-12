<script setup lang="ts">
/**
 * 1-11 探索一、二（关卡自己的 scenes，不用登记组件）：把热身里的报告重演一遍。
 *
 * 量的是 1-8 的改动：1000 道向量加法，改前每人连着算 4 个，改后挨着拿，两版各量一次。只开放一个旋钮：
 * - variant="sync"：停表前同步不同步（预热了），默认不同步，重演报告甲；
 * - variant="warmup"：预热没有（停表前同步了），默认没有，重演报告乙。
 * 旋钮一换，计时代码、时间线、读数和下面那一句马上跟着变（03 第 1 节第 4 条）。计时台是纯函数
 * （challenge.ts 的 runSession），不跑模拟器：两版在 GPU 上的周期数是 L4 算好的常数，单测核对。
 * 旋钮不存草稿（同前几关只有旋钮的探索），刷新回到默认。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import ClockTimeline from './ClockTimeline.vue'
import TimingCode from './TimingCode.vue'
import { ADD_CALL, ADD_KERNELS, runSession, speedupText, syncText, warmupText, type Plan } from '../challenge.ts'

const props = defineProps<{ variant: 'sync' | 'warmup' }>()

const titleId = `${useId()}-title`
/** 默认重演出错的那份报告：能跑但不好（03 第 1 节第 3 条）。 */
const on = ref(false)

const plan = computed<Plan>(() => (props.variant === 'sync' ? { warmup: true, sync: on.value } : { warmup: on.value, sync: true }))
const session = computed(() => runSession(plan.value, ADD_KERNELS))
const readout = computed(() => (props.variant === 'sync' ? syncText(on.value) : warmupText(on.value)))

const title = computed(() => (props.variant === 'sync' ? '表停在哪' : '第一次最慢'))
const rules = computed(() => (props.variant === 'sync'
  ? '两版都先空跑了一次。只换一处：再看表之前，等不等 GPU 算完。'
  : '两版都在停表前同步。只换一处：开始计时之前，先不先空跑一次。'))

const rows = computed(() => session.value.readings.map((r) => ({
  name: ADD_KERNELS[r.kernel].label,
  cycles: r.cycles,
  gpu: ADD_KERNELS[r.kernel].cycles,
})))
const conclusion = computed(() => {
  const [before, after] = session.value.readings.map((r) => r.cycles)
  return speedupText(before, after)
})
</script>

<template>
  <section class="cl" :aria-labelledby="titleId">
    <header class="cl__head">
      <span class="cl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="cl__title">{{ title }}</strong>
      <span class="cl__tag">模拟</span>
    </header>
    <p class="cl__rules">{{ rules }}时间都按模拟器的周期数算，不是实测。</p>

    <div class="cl__knob">
      <Knob v-if="variant === 'sync'" v-model="on" label="再看表之前" mode="switch" on="同步：等 GPU 算完" off="不同步，直接看表" />
      <Knob v-else v-model="on" label="开始计时之前" mode="switch" on="先空跑一次，等它算完" off="不预热" />
    </div>

    <TimingCode :plan="plan" :call="ADD_CALL" />

    <ClockTimeline :session="session" :kernels="ADD_KERNELS" :label="`${title}：两版向量加法各量一次`" />

    <table class="cl-result">
      <caption>两版各量到多少（模拟）</caption>
      <thead>
        <tr><th scope="col">哪一版</th><th scope="col">量到</th><th scope="col">GPU 上算了</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.name">
          <th scope="row">{{ row.name }}</th>
          <td class="is-num">{{ row.cycles }}</td>
          <td class="is-num">{{ row.gpu }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr><th scope="row">算出来</th><td colspan="2">{{ conclusion }}</td></tr>
      </tfoot>
    </table>

    <p class="cl__readout" aria-live="polite">{{ readout }}</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的探索（1-7 的 FetchTrip）。 */
.cl {
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

.cl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.cl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.cl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.cl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.cl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.cl__knob {
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* 读数表：.hg-prose 的表格样式之外，数字右对齐、等宽。 */
.cl-result {
  margin: 0;
}

.cl-result caption {
  padding-bottom: 6px;
  color: var(--hg-ink-3);
  font-size: 13px;
  text-align: left;
}

.cl-result .is-num {
  font-family: var(--hg-font-mono);
  text-align: right;
  white-space: nowrap;
}

.cl-result tfoot th,
.cl-result tfoot td {
  font-weight: 700;
}

.cl__readout {
  min-height: 3.2em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .cl {
    padding: 16px 14px;
  }

  .cl__knob {
    padding: 12px 10px;
  }

  .cl-result th,
  .cl-result td {
    padding: 6px 6px;
    font-size: 13px;
  }
}
</style>
