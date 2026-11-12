<script setup lang="ts">
/**
 * 1-11 的挑战「量一量求和」（关卡自己的 scenes，不用登记组件）。
 *
 * 量 1-10 挑战的改动：改前每个线程都把自己那一格原子加进 out[0]，改后先搭树、每组只原子加一次。
 * 三个旋钮（Knob）：开始计时之前预热不预热、再看表之前同步不同步、字节数怎么写。下面按读者的写法偏好
 * （LangCode）显示计时代码，旋钮一换代码马上跟着变（03 第 1 节第 4 条）。点「开始计时」按 challenge.ts 的
 * judge 判星，计时台照同一份代码把两版各量一次：时间线、读数表、快了几倍、改后的有效带宽都写出来；
 * 没过时 HintLadder 给出「现象 / 原因 / 怎么改」，没过 2 / 4 / 6 次依次解锁提示（F-12）。
 * 计时代码存进这一关的草稿槽，刷新不丢（03 第 4 节）。
 *
 * 两种写法显示的是同一串操作（单测核对），judge 和写法无关：换写法不影响拿星。
 */
import { computed, onMounted, ref, useId, watch } from 'vue'
import HintLadder from '@kit/HintLadder.vue'
import Knob from '@kit/Knob.vue'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import ClockTimeline from './ClockTimeline.vue'
import TimingCode from './TimingCode.vue'
import {
  DEFAULT_BENCH, HINTS, STAGE_ID, SUM_CALL, SUM_COUNTS, SUM_KERNELS, SUM_N, SUM_TOTAL_BYTES,
  decimal, judge, normalizeBench, runBench, type BenchPlan, type BenchResult,
} from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`

const challenge = useChallenge({ stage: STAGE_ID, id: 'bench', hints: HINTS })

const plan = ref<BenchPlan>({ ...DEFAULT_BENCH })
/** 最近一次计时的结果；代码一改就清掉，免得读者对着旧结果看。 */
const lastRun = ref<BenchResult | null>(null)
const message = ref('')

watch(plan, (value) => {
  challenge.draft.value = { ...value }
  if (lastRun.value) {
    lastRun.value = null
    message.value = '计时代码改了，点「开始计时」看新的结果。'
  }
}, { deep: true })

// 草稿槽在 useChallenge 挂载时读出来，这里接着把上次的计时代码放回去。
onMounted(() => {
  plan.value = normalizeBench(challenge.draft.value)
})

const bytesExpr = computed(() => SUM_COUNTS.find((c) => c.value === plan.value.count)?.expr ?? SUM_COUNTS[0].expr)
const stars = computed(() => progress.stars(STAGE_ID))
const status = computed(() => message.value || `还没计时。现在已经拿到 ${stars.value} / 3 颗星。`)

function run() {
  const verdict = judge(plan.value)
  const outcome = challenge.attempt(verdict)
  lastRun.value = runBench(plan.value)
  const capped = outcome.stars.length > challenge.cap.value
    ? `（看过答案，这一关最多记 ${challenge.cap.value} 颗星）`
    : ''
  message.value = outcome.passed
    ? `过了，达到 ${outcome.stars.length} 条星级标准。${verdict.next}${capped}`
    : '没过：看下面的「这次的问题」。没过不扣经验值，可以一直试。'
}

/** 03 第 1 节第 3 条：随时可以重置。 */
function reset() {
  plan.value = { ...DEFAULT_BENCH }
  lastRun.value = null
  message.value = ''
}

const rows = computed(() => {
  const r = lastRun.value
  if (!r) return []
  return SUM_KERNELS.map((k, i) => ({ name: k.label, cycles: r.readings[i], gpu: k.cycles }))
})
</script>

<template>
  <section class="tb" :aria-labelledby="titleId">
    <header class="tb__head">
      <span class="tb__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="tb__title">量一量求和</strong>
      <span class="tb__tag">模拟</span>
    </header>
    <p class="tb__rules">
      两版求和都是 {{ SUM_N }} 个数，派 2 组、每组 64 个线程。改前：每个线程都把自己那一格原子加进 out[0]；
      改后：先在货架上搭树，每组只派线程 0 原子加一次。同一份计时代码把两版各量一次，代码里的 n 是 {{ SUM_N }}。
    </p>

    <div class="tb__knobs">
      <Knob v-model="plan.warmup" label="开始计时之前" mode="switch" on="先空跑一次，等它算完" off="不预热" />
      <Knob v-model="plan.sync" label="再看表之前" mode="switch" on="同步：等 GPU 算完" off="不同步，直接看表" />
      <Knob v-model="plan.count" label="字节数（bytes）" :options="SUM_COUNTS" />
    </div>

    <TimingCode :plan="plan" :call="SUM_CALL" :bytes-expr="bytesExpr" />

    <div class="tb__actions">
      <button type="button" class="tb-button is-primary" @click="run">开始计时</button>
      <button type="button" class="tb-button" @click="reset">重置计时代码</button>
    </div>
    <p class="tb__status" role="status">{{ status }}</p>

    <template v-if="lastRun">
      <ClockTimeline :session="lastRun.session" :kernels="SUM_KERNELS" label="这次的计时：两版求和各量一次" />
      <table class="tb-result">
        <caption>这次量到的（模拟）。「GPU 上算了」是模拟器知道的准数，真卡上看不到</caption>
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
          <tr><th scope="row">算出来</th><td colspan="2">{{ lastRun.speedup }}</td></tr>
          <tr>
            <th scope="row">改后的有效带宽</th>
            <td colspan="2">
              {{ lastRun.bytes }} ÷ {{ lastRun.readings[1] }} ≈ {{ decimal(lastRun.bandwidth) }} 字节/周期
              <span class="tb-result__truth">（按该读写的 {{ SUM_TOTAL_BYTES }} 字节、GPU 上算的 {{ SUM_KERNELS[1].cycles }} 个周期：{{ decimal(lastRun.trueBandwidth) }}）</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </template>

    <HintLadder :challenge="challenge" />
  </section>
</template>

<style scoped>
.tb {
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

.tb__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.tb__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.tb__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.tb__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.tb__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* 旋钮：宽屏两列，窄屏一列（同 1-2 的挑战）。 */
.tb__knobs {
  display: grid;
  gap: 14px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .tb__knobs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.tb__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.tb-button {
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

.tb-button.is-primary {
  min-width: 6em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.tb-button:hover {
  border-color: var(--hg-accent);
}

.tb-button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.tb__status {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* 结果表：.hg-prose 的表格样式之外，数字右对齐、等宽（同 1-2 的挑战）。 */
.tb-result {
  margin: 0;
}

.tb-result caption {
  padding-bottom: 6px;
  color: var(--hg-ink-3);
  font-size: 13px;
  text-align: left;
}

.tb-result .is-num {
  font-family: var(--hg-font-mono);
  text-align: right;
  white-space: nowrap;
}

.tb-result tfoot th,
.tb-result tfoot td {
  font-weight: 700;
}

.tb-result__truth {
  display: block;
  color: var(--hg-ink-3);
  font-size: 13px;
  font-weight: 400;
}

@media (max-width: 639px) {
  .tb {
    padding: 16px 14px;
  }

  .tb__knobs {
    padding: 12px 10px;
  }

  .tb-result th,
  .tb-result td {
    padding: 6px 6px;
    font-size: 13px;
  }
}
</style>
