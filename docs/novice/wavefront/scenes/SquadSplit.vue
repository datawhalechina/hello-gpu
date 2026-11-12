<script setup lang="ts">
/**
 * 1-5 探索二「第 33 个线程」（关卡自己的 scenes，不用登记组件）：一组线程怎样排成小队。
 *
 * 派 1 组，旋钮选这一组几个线程（32 / 33 / 40 / 64），数据和线程一样多，工作单不变。旋钮一动、换写法，
 * 就在 Web Worker 里重跑模拟器（docs/sim/client.ts），小队板（SquadBoard 的 bots）画出排成的小队、
 * 每支坐了几个人、空着几个工位、走了几步，下面一句话是这一次的解读（challenge.ts 的 splitText）。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { buildRequest, type Launch } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import { useProgress } from '@course/useProgress.ts'
import SquadBoard from './SquadBoard.vue'
import { KERNEL, SPLIT_DEFAULT, SPLIT_THREADS, WAVE, addArgs, launchLine, splitText, squadReport } from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const THREAD_OPTIONS = [...SPLIT_THREADS]

const threads = ref<number>(SPLIT_DEFAULT)
const launch = computed<Launch>(() => ({ grid: 1, block: threads.value }))

/** 挂载之前（服务端渲染、水合）按 HIP 写；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const lang = computed(() => (mounted.value ? progress.state.prefs.lang : 'hip'))
const line = computed(() => launchLine(launch.value, lang.value))

const run = shallowRef<{ launch: Launch; result: RunResult } | null>(null)
const problem = ref('')
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const l = progress.state.prefs.lang
  const config = { ...launch.value }
  try {
    const result = await client.run(buildRequest(KERNEL[l], l, config, addArgs(config.block)))
    run.value = { launch: config, result }
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着拨旋钮时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `实验没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch([threads, () => progress.state.prefs.lang], simulate)

onMounted(() => {
  mounted.value = true
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())

/** 结果和旋钮对得上才画（拨旋钮以后、新结果回来之前，先不画旧的） */
const report = computed(() => {
  const r = run.value
  if (!r || r.launch.block !== threads.value || !r.result.ok) return null
  return squadReport(r, r.launch.block)
})
</script>

<template>
  <section class="sp" :aria-labelledby="titleId">
    <header class="sp__head">
      <span class="sp__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="sp__title">一组线程，排成几支小队</strong>
      <span class="sp__tag">模拟</span>
    </header>
    <p class="sp__rules">派 1 组线程，数据和线程一样多，工作单不变。一条流水线 {{ WAVE }} 个工位，换着派几个线程，看它们怎样排成小队。</p>

    <div class="sp__knobs">
      <Knob label="这一组派几个线程" code="blockDim.x" :options="THREAD_OPTIONS" unit=" 个" v-model="threads" />
    </div>
    <p class="sp__launch">
      <span class="sp__launch-label">启动时这样写：</span>
      <code translate="no">{{ line }}</code>
    </p>

    <p v-if="problem" class="sp__problem" role="alert">{{ problem }}</p>
    <p class="sp__readout" aria-live="polite">{{ report ? splitText(report) : problem ? '' : '模拟器准备中……' }}</p>
    <SquadBoard v-if="report" :squads="report.squads" :size="report.size" />

    <ul class="sp__legend" aria-label="图例">
      <li><span class="sp__sw" aria-hidden="true" />站着线程小机器人的工位</li>
      <li><span class="sp__sw is-empty" aria-hidden="true" />空着的工位（没有线程）</li>
    </ul>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同探索一（SquadStepper）。 */
.sp {
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

.sp__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.sp__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.sp__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.sp__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.sp__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.sp__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.sp__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: -4px 0 0;
  font-size: 14px;
}

.sp__launch-label {
  color: var(--hg-ink-2);
}

.sp__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.sp__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

.sp__readout {
  min-height: 1.6em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.sp__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.sp__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

.sp__sw {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: var(--hg-border-width) solid var(--hg-ink-3);
  border-radius: 4px;
  background: var(--hg-surface);
}

.sp__sw.is-empty {
  border-style: dashed;
  border-color: var(--hg-border-strong);
  background: transparent;
}

@media (max-width: 639px) {
  .sp {
    padding: 16px 14px;
  }

  .sp__knobs {
    padding: 12px 10px;
  }
}
</style>
