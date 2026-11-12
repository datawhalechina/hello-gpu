<script setup lang="ts">
/**
 * 1-12 的挑战「给一条流水线排班」（关卡自己的 scenes，不用登记组件）。
 *
 * 工作单不变（1-8 挑战的 part_sum），三个旋钮（Knob）：派几组、每人加几个、每个线程用几个寄存器。
 * 旋钮一动，下面那一句（coverText：一共拿几个数，够不够、多不多）、启动那一行（LaunchCode）和
 * 住得下几支（SeatChart）马上跟着变（03 第 1 节第 4 条）。点「运行」在 Web Worker 里跑一次模拟器，
 * judge 判星；每个数都加对了，就画出这次的时间线（SimdTimeline）。没过时 HintLadder 给出
 * 「现象 / 原因 / 怎么改」，没过 2 / 4 / 6 次依次解锁提示（F-12）。派法存进这一关的草稿槽，刷新不丢（03 第 4 节）。
 * 跑的是读者当前写法的工作单；两种写法的事件流一样（单测核对），换写法不影响拿星。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import HintLadder from '@kit/HintLadder.vue'
import Knob from '@kit/Knob.vue'
import { buildRequest } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import LaunchCode from './LaunchCode.vue'
import SeatChart from './SeatChart.vue'
import SimdTimeline from './SimdTimeline.vue'
import {
  CYCLES_BY_WAVES, DEFAULT_PLAN, EACH_OPTIONS, HINTS, PART_CODE, PART_N, STAGE_ID, VGPR_OPTIONS, WAVE, WAVE_OPTIONS,
  coverText, judge, launchOf, normalizePlan, partArgs, schedule, seatsOf, type Plan,
} from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const challenge = useChallenge({ stage: STAGE_ID, id: 'shift', hints: HINTS })
const WAVES = [...WAVE_OPTIONS]
const EACHES = [...EACH_OPTIONS]
const VGPRS = [...VGPR_OPTIONS]

const waves = ref<number>(DEFAULT_PLAN.waves)
const each = ref<number>(DEFAULT_PLAN.each)
const vgprs = ref<number>(DEFAULT_PLAN.vgprs)
const plan = computed<Plan>(() => ({ waves: waves.value, each: each.value, vgprs: vgprs.value }))
const cover = computed(() => coverText(plan.value))

/** 最近一次运行；派法一改就清掉，免得读者对着旧结果看（同 1-5 的挑战）。 */
const last = shallowRef<{ plan: Plan; result: RunResult; passed: boolean } | null>(null)
const running = ref(false)
const message = ref('')
let client: SimClient | null = null

watch(plan, (value) => {
  challenge.draft.value = { ...value }
  if (last.value) {
    last.value = null
    message.value = '派法改了，点「运行」看新的结果。'
  }
})

// 草稿槽在 useChallenge 挂载时读出来（它的 onMounted 先登记），这里接着把上次的派法放回去。
onMounted(() => {
  const saved = normalizePlan(challenge.draft.value)
  waves.value = saved.waves
  each.value = saved.each
  vgprs.value = saved.vgprs
  client = createSimClient()
})

onBeforeUnmount(() => client?.dispose())

const stars = computed(() => progress.stars(STAGE_ID))
const status = computed(() => {
  if (running.value) return '模拟器在跑……'
  return message.value || `还没运行。现在已经拿到 ${stars.value} / 3 颗星。`
})

async function runOnce() {
  if (!client || running.value) return
  const lang = progress.state.prefs.lang
  const p = { ...plan.value }
  running.value = true
  message.value = ''
  try {
    const result = await client.run(buildRequest(PART_CODE[lang], lang, launchOf(p), partArgs(p)))
    // 跑的时候拨了旋钮：这次的结果对不上现在的派法，不算一次尝试
    if (p.waves !== waves.value || p.each !== each.value || p.vgprs !== vgprs.value) return
    const verdict = judge(p, result)
    const outcome = challenge.attempt(verdict)
    last.value = { plan: p, result, passed: verdict.earned[0] }
    const capped = outcome.stars.length > challenge.cap.value
      ? `（看过答案，这一关最多记 ${challenge.cap.value} 颗星）`
      : ''
    message.value = outcome.passed
      ? `过了，达到 ${outcome.stars.length} 条星级标准。${verdict.next}${capped}`
      : '没过：看下面的「这次的问题」。没过不扣经验值，可以一直试。'
  } catch (err) {
    if ((err as Error).name !== 'AbortError') message.value = `没跑起来：${(err as Error).message}。再点一次「运行」。`
  } finally {
    running.value = false
  }
}

/** 03 第 1 节第 3 条：随时可以重置。 */
function reset() {
  waves.value = DEFAULT_PLAN.waves
  each.value = DEFAULT_PLAN.each
  vgprs.value = DEFAULT_PLAN.vgprs
  last.value = null
  message.value = ''
}

/** 每个数都加对了，才画这次的时间线：没加对时，先看「这次的问题」。 */
const board = computed(() => {
  const l = last.value
  if (!l || !l.passed || !l.result.ok) return null
  return schedule(l.result.events, seatsOf(l.plan.vgprs).resident)
})
const boardLabel = computed(() => {
  const p = last.value?.plan
  return p ? `这次的排班：派 ${p.waves} 组、每人加 ${p.each} 个、每个线程 ${p.vgprs} 个寄存器` : ''
})
</script>

<template>
  <section class="sb" :aria-labelledby="titleId">
    <header class="sb__head">
      <span class="sb__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="sb__title">给一条流水线排班</strong>
      <span class="sb__tag">模拟</span>
    </header>
    <p class="sb__rules">{{ PART_N }} 个数交给一条流水线，工作单不变。你来定：派几组（每组 {{ WAVE }} 个线程，一支小队）、每人加几个、每个线程用几个寄存器。点「运行」，模拟器把这样派的结果算出来。</p>

    <div class="sb__knobs">
      <Knob v-model="waves" label="派几组" code="gridDim.x" :options="WAVES" unit=" 组" />
      <Knob v-model="each" label="每人加几个" code="m" :options="EACHES" unit=" 个" />
      <Knob v-model="vgprs" label="每个线程用的寄存器" :options="VGPRS" unit=" 个" />
    </div>
    <p class="sb__cover" aria-live="polite">{{ cover }}</p>

    <LaunchCode :plan="plan" />
    <SeatChart :vgprs="vgprs" />

    <div class="sb__actions">
      <button type="button" class="sb-button is-primary" :disabled="running" @click="runOnce">运行</button>
      <button type="button" class="sb-button" @click="reset">重置派法</button>
    </div>
    <p class="sb__status" role="status">{{ status }}</p>

    <SimdTimeline v-if="board" :schedule="board" :scale="CYCLES_BY_WAVES[1]" :label="boardLabel" />

    <HintLadder :challenge="challenge" />
  </section>
</template>

<style scoped>
/* 卡片、旋钮区、按钮同 1-11 的挑战（TimingBench）。 */
.sb {
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

.sb__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.sb__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.sb__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.sb__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.sb__rules,
.sb__status {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* 旋钮：宽屏两列，窄屏一列（同 1-11 的挑战）。 */
.sb__knobs {
  display: grid;
  gap: 14px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .sb__knobs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.sb__cover {
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.sb__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.sb-button {
  min-height: 40px;
  padding: 0 16px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.sb-button.is-primary {
  min-width: 6em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.sb-button:hover {
  border-color: var(--hg-accent);
}

.sb-button:disabled {
  cursor: progress;
  opacity: 0.6;
}

.sb-button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

@media (max-width: 639px) {
  .sb {
    padding: 16px 14px;
  }

  .sb__knobs {
    padding: 12px 10px;
  }
}
</style>
