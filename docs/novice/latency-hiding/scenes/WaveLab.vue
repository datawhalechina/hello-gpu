<script setup lang="ts">
/**
 * 1-12 探索一「一支等，一支算」（关卡自己的 scenes，不用登记组件）。
 *
 * 工作单不变（1-8 挑战的 part_sum），只开放一个旋钮：派几组（1 / 2 / 4 / 8 / 16）。每组 32 个线程，正好一支小队；
 * 每人加的个数跟着变，正好分完 PART_N 个数；每个线程 32 个寄存器，16 支都住得下，只看派几支。
 * 旋钮一动、换写法，就在 Web Worker 里重跑模拟器（docs/sim/client.ts），challenge.ts 的 schedule 把事件流排到
 * 一条流水线上：启动那一行（LaunchCode）、下面那一句（wavesText）和时间线（SimdTimeline）跟着变。
 * 用时那根条的满格是只派 1 组的用时。旋钮不存草稿（同前几关只有旋钮的探索），刷新回到默认。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { buildRequest } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import { useProgress } from '@course/useProgress.ts'
import LaunchCode from './LaunchCode.vue'
import SimdTimeline from './SimdTimeline.vue'
import {
  CYCLES_BY_WAVES, DEFAULT_WAVES, EXPLORE_VGPRS, PART_CODE, PART_N, WAVE, WAVE_OPTIONS,
  evenPlan, launchOf, partArgs, schedule, seatsOf, wavesText,
} from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const OPTIONS = [...WAVE_OPTIONS]
/** 每个线程 32 个寄存器时，一条流水线住得下几支（名额先用完）。 */
const RESIDENT = seatsOf(EXPLORE_VGPRS).resident

/** 默认只派 1 组：能跑但不好（03 第 1 节第 3 条）。 */
const waves = ref<number>(DEFAULT_WAVES)
const plan = computed(() => evenPlan(waves.value))

const run = shallowRef<{ waves: number; result: RunResult } | null>(null)
const problem = ref('')
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const lang = progress.state.prefs.lang
  const p = plan.value
  try {
    const result = await client.run(buildRequest(PART_CODE[lang], lang, launchOf(p), partArgs(p)))
    run.value = { waves: p.waves, result }
    problem.value = result.ok ? '' : `模拟器报错：${result.error.message}`
  } catch (err) {
    // 一个 client 同时只跑一次：连着拨旋钮时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `实验没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch([waves, () => progress.state.prefs.lang], simulate)

onMounted(() => {
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())

/** 结果和旋钮对得上才画（拨旋钮以后、新结果回来之前，先不画旧的）。 */
const current = computed(() => {
  const r = run.value
  if (!r || r.waves !== waves.value || !r.result.ok) return null
  return schedule(r.result.events, RESIDENT)
})
const readout = computed(() => {
  if (current.value) return wavesText(waves.value, current.value)
  return problem.value ? '' : '模拟器准备中……'
})
</script>

<template>
  <section class="wl" :aria-labelledby="titleId">
    <header class="wl__head">
      <span class="wl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="wl__title">派几支小队</strong>
      <span class="wl__tag">模拟</span>
    </header>
    <p class="wl__rules">{{ PART_N }} 个数交给一条流水线。每组 {{ WAVE }} 个线程，正好一支小队；每人加的个数跟着组数变，正好分完。每个线程用 {{ EXPLORE_VGPRS }} 个寄存器，派 16 组也都住得下。</p>

    <div class="wl__knob">
      <Knob v-model="waves" label="派几组" code="gridDim.x" :options="OPTIONS" unit=" 组" />
    </div>

    <LaunchCode :plan="plan" />

    <p v-if="problem" class="wl__problem" role="alert">{{ problem }}</p>
    <p class="wl__readout" aria-live="polite">{{ readout }}</p>

    <SimdTimeline
      v-if="current"
      :schedule="current"
      :scale="CYCLES_BY_WAVES[1]"
      :label="`派 ${waves} 组、每人加 ${plan.each} 个时，一条流水线的时间线`"
    />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的探索（1-11 的 ClockLab）。 */
.wl {
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

.wl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.wl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.wl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.wl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.wl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.wl__knob {
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.wl__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

.wl__readout {
  min-height: 3.2em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .wl {
    padding: 16px 14px;
  }

  .wl__knob {
    padding: 12px 10px;
  }
}
</style>
