<script setup lang="ts">
/**
 * 1-12 探索二「工具台占地方」（关卡自己的 scenes，不用登记组件）。
 *
 * 派 16 组、每人加 4 个，工作单不变，只开放一个旋钮：每个线程用几个寄存器（32 / 64 / 128 / 256，默认 256）。
 * 寄存器只影响住得下几支，不改小队做的事：模拟器挂载时（和换写法时）在 Web Worker 里跑一次，
 * 旋钮一动，只用同一份事件流重新排班（challenge.ts 的 schedule），马上画出来（03 第 1 节第 4 条）。
 * 上面是住得下几支（SeatChart），下面是那一句（registersText）和时间线（SimdTimeline）；
 * 用时那根条的满格是每个线程 256 个寄存器时的用时。旋钮不存草稿，刷新回到默认。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { buildRequest } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import { useProgress } from '@course/useProgress.ts'
import SeatChart from './SeatChart.vue'
import SimdTimeline from './SimdTimeline.vue'
import {
  CYCLES_BY_VGPRS, DEFAULT_VGPRS, PART_CODE, REGISTER_WAVES, VGPR_OPTIONS,
  evenPlan, launchOf, partArgs, registersText, schedule, seatsOf,
} from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const OPTIONS = [...VGPR_OPTIONS]
const PLAN = evenPlan(REGISTER_WAVES)

/** 默认 256 个：能跑但不好（03 第 1 节第 3 条）。 */
const vgprs = ref<number>(DEFAULT_VGPRS)

const result = shallowRef<RunResult | null>(null)
const problem = ref('')
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const lang = progress.state.prefs.lang
  try {
    const r = await client.run(buildRequest(PART_CODE[lang], lang, launchOf(PLAN), partArgs(PLAN)))
    result.value = r
    problem.value = r.ok ? '' : `模拟器报错：${r.error.message}`
  } catch (err) {
    if ((err as Error).name !== 'AbortError') problem.value = `实验没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch(() => progress.state.prefs.lang, simulate)

onMounted(() => {
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())

const current = computed(() => {
  const r = result.value
  if (!r || !r.ok) return null
  return schedule(r.events, seatsOf(vgprs.value).resident)
})
const readout = computed(() => {
  if (current.value) return registersText(vgprs.value, current.value)
  return problem.value ? '' : '模拟器准备中……'
})
</script>

<template>
  <section class="rl" :aria-labelledby="titleId">
    <header class="rl__head">
      <span class="rl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="rl__title">每个线程用几个寄存器</strong>
      <span class="rl__tag">模拟</span>
    </header>
    <p class="rl__rules">派 {{ PLAN.waves }} 组、每人加 {{ PLAN.each }} 个，工作单不变。只换一处：每个线程用几个寄存器。真程序里这个数由编译器定，这里直接设定，只为看清后果。</p>

    <div class="rl__knob">
      <Knob v-model="vgprs" label="每个线程用的寄存器" :options="OPTIONS" unit=" 个" />
    </div>

    <SeatChart :vgprs="vgprs" />

    <p v-if="problem" class="rl__problem" role="alert">{{ problem }}</p>
    <p class="rl__readout" aria-live="polite">{{ readout }}</p>

    <SimdTimeline
      v-if="current"
      :schedule="current"
      :scale="CYCLES_BY_VGPRS[256]"
      :label="`派 ${PLAN.waves} 组、每个线程 ${vgprs} 个寄存器时，一条流水线的时间线`"
    />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同探索一（WaveLab）。 */
.rl {
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

.rl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.rl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.rl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.rl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.rl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.rl__knob {
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.rl__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

.rl__readout {
  min-height: 3.2em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .rl {
    padding: 16px 14px;
  }

  .rl__knob {
    padding: 12px 10px;
  }
}
</style>
