<script setup lang="ts">
/**
 * 1-3 探索一「人人都做一整张」（关卡自己的 scenes，不用登记组件）。
 *
 * 1-1 的逐个相加原样写进 kernel（challenge.ts 的 LOOP_CODE，正文里这一段的上面就是这段代码），
 * 旋钮定派几个线程（2 / 4 / 8）。挂载后在 Web Worker 里跑模拟器（docs/sim/client.ts），结果交给
 * RobotGrid 逐步播放：每一步所有机器人一起写同一格，走完以后每一格都被算了「派出的人数」遍。
 * 换人数、换写法都重新跑（事件里的行号跟着写法走）。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import RobotGrid from '@kit/RobotGrid.vue'
import { buildRequest, type Launch } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import { useProgress } from '@course/useProgress.ts'
import { LOOP_CODE, LOOP_N, LOOP_THREADS, addArgs } from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const ARGS = addArgs(LOOP_N)

const threads = ref<number>(LOOP_THREADS[LOOP_THREADS.length - 1])
const launch = computed<Launch>(() => ({ grid: 1, block: threads.value }))
const run = shallowRef<{ launch: Launch; result: RunResult } | null>(null)
const problem = ref('')
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const lang = progress.state.prefs.lang
  const config = { ...launch.value }
  try {
    const result = await client.run(buildRequest(LOOP_CODE[lang], lang, config, ARGS))
    run.value = { launch: config, result }
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着换人数时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `演示没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch([threads, () => progress.state.prefs.lang], simulate)

onMounted(() => {
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())
</script>

<template>
  <section class="ss" :aria-labelledby="titleId">
    <header class="ss__head">
      <span class="ss__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="ss__title">{{ threads }} 个线程，同一张工作单</strong>
      <span class="ss__tag">模拟</span>
    </header>
    <p class="ss__rules">
      每个线程拿到的都是上面那张工作单：c 有 {{ LOOP_N }} 格，循环让 i 从 0 走到 {{ LOOP_N - 1 }}。换一换派出的人数，看每一格被算了几遍。
    </p>

    <div class="ss__knobs">
      <Knob label="派几个线程" :options="LOOP_THREADS" unit=" 个" v-model="threads" />
    </div>

    <p v-if="problem" class="ss__problem" role="alert">{{ problem }}</p>

    <RobotGrid
      :result="run?.result ?? null"
      :launch="run?.launch ?? launch"
      array="c"
      mode="play"
      empty-text="模拟器准备中……"
    />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同 1-2 的挑战卡片（JourneyPlan）。 */
.ss {
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

.ss__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ss__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ss__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ss__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.ss__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.ss__knobs {
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.ss__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

@media (max-width: 639px) {
  .ss {
    padding: 16px 14px;
  }

  .ss__knobs {
    padding: 12px 10px;
  }
}
</style>
