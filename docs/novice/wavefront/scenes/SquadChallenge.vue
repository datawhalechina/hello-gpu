<script setup lang="ts">
/**
 * 1-5 的挑战「128 对数」（关卡自己的 scenes，不用登记组件）。
 *
 * 工作单不变，旋钮定每组几个线程、派几组，下面一行是这样派写出来的启动代码（1-2 定的写法，跟着写法偏好）。
 * 点「运行」在 Web Worker 里跑两次模拟器：32 人一队，和同样的派法 64 人一队（challenge.ts 的 wideLaunch），
 * 两次的结果交给 judge 判星，两块小队板（SquadBoard 的 bars）画出排成的小队；没过时 HintLadder 给出
 * 「现象 / 原因 / 怎么改」，没过 2 / 4 / 6 次依次解锁提示（F-12）。派法存进这一关的草稿槽，刷新不丢（03 第 4 节）。
 * 跑的是读者当前写法的工作单；两种写法的结果一样（单测核对），换写法不影响拿星。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import HintLadder from '@kit/HintLadder.vue'
import Knob from '@kit/Knob.vue'
import { buildRequest, type Launch, type SandboxRun } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import SquadBoard from './SquadBoard.vue'
import {
  BLOCK_DIMS, CHALLENGE_LAUNCH, CHALLENGE_N, GRID_MAX, HINTS, KERNEL, STAGE_ID, addArgs, judge, launchLine,
  normalizeLaunch, squadReport, squadText, wideLaunch,
} from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const challenge = useChallenge({ stage: STAGE_ID, id: 'squads', hints: HINTS })
const ARGS = addArgs(CHALLENGE_N)
const BLOCK_OPTIONS = [...BLOCK_DIMS]

const block = ref<number>(CHALLENGE_LAUNCH.block)
const grid = ref<number>(CHALLENGE_LAUNCH.grid)
const launch = computed<Launch>(() => ({ grid: grid.value, block: block.value }))

/** 挂载之前（服务端渲染、水合）按 HIP 写；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const lang = computed(() => (mounted.value ? progress.state.prefs.lang : 'hip'))
const line = computed(() => launchLine(launch.value, lang.value))

/** 最近一次运行的结果；派法一改就清掉，免得读者对着旧结果看（同 1-1 的挑战）。 */
const last = shallowRef<SandboxRun[] | null>(null)
const running = ref(false)
const message = ref('')
let client: SimClient | null = null

watch(launch, (value) => {
  challenge.draft.value = { params: { ...value } }
  if (last.value) {
    last.value = null
    message.value = '派法改了，点「运行」看新的结果。'
  }
})

// 草稿槽在 useChallenge 挂载时读出来（它的 onMounted 先登记），这里接着把上次的派法放回去。
onMounted(() => {
  const draft = challenge.draft.value as { params?: unknown } | null
  const saved = normalizeLaunch(draft?.params)
  block.value = saved.block
  grid.value = saved.grid
  mounted.value = true
  client = createSimClient()
})

onBeforeUnmount(() => client?.dispose())

const stars = computed(() => progress.stars(STAGE_ID))
const status = computed(() => {
  if (running.value) return '模拟器在跑：先按 32 人一队，再按 64 人一队……'
  return message.value || `还没运行。现在已经拿到 ${stars.value} / 3 颗星。`
})

async function runBoth() {
  if (!client || running.value) return
  const l = progress.state.prefs.lang
  const config = { ...launch.value }
  running.value = true
  message.value = ''
  try {
    const main: SandboxRun = { launch: config, result: await client.run(buildRequest(KERNEL[l], l, config, ARGS)) }
    const runs = [main]
    if (main.result.ok) {
      const wide = wideLaunch(config)
      runs.push({ launch: wide, result: await client.run(buildRequest(KERNEL[l], l, wide, ARGS)) })
    }
    // 跑的时候拨了旋钮：这次的结果对不上现在的派法，不算一次尝试
    if (config.grid !== grid.value || config.block !== block.value) return
    const verdict = judge(runs)
    const outcome = challenge.attempt(verdict)
    last.value = runs
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
  block.value = CHALLENGE_LAUNCH.block
  grid.value = CHALLENGE_LAUNCH.grid
  last.value = null
  message.value = ''
}

/** 两块小队板：32 人一队、64 人一队（代码出错时只有第一块）。 */
const boards = computed(() => (last.value ?? []).filter((r) => r.result.ok).map((r) => {
  const report = squadReport(r, CHALLENGE_N)
  return { size: report.size, squads: report.squads, text: squadText(report, r.launch) }
}))
</script>

<template>
  <section class="sc" :aria-labelledby="titleId">
    <header class="sc__head">
      <span class="sc__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="sc__title">{{ CHALLENGE_N }} 对数：每组几个线程，派几组</strong>
      <span class="sc__tag">模拟</span>
    </header>
    <p class="sc__rules">工作单不变。定好每组几个线程、派几组，点「运行」：同样的派法，先按 32 人一队跑一次，再按 64 人一队跑一次。</p>

    <div class="sc__knobs">
      <Knob label="每组几个线程" code="blockDim.x" :options="BLOCK_OPTIONS" unit=" 个" v-model="block" />
      <Knob label="派几组" code="gridDim.x" :min="1" :max="GRID_MAX" unit=" 组" v-model="grid" />
    </div>
    <p class="sc__launch">
      <span class="sc__launch-label">启动时这样写：</span>
      <code translate="no">{{ line }}</code>
    </p>
    <p class="sc__note">一共派出 {{ grid * block }} 个线程，n 是 {{ CHALLENGE_N }}。</p>

    <div class="sc__actions">
      <button type="button" class="sc__button is-primary" :disabled="running" @click="runBoth">运行</button>
      <button type="button" class="sc__button" @click="reset">重置派法</button>
    </div>
    <p class="sc__status" role="status">{{ status }}</p>

    <div v-if="boards.length" class="sc__boards">
      <section v-for="b in boards" :key="b.size" class="sc__board" :aria-label="`${b.size} 人一队的结果`">
        <p class="sc__board-text"><span class="sc__wave" aria-hidden="true">wave{{ b.size }}</span>{{ b.text }}</p>
        <SquadBoard :squads="b.squads" :size="b.size" mode="bars" />
      </section>
      <ul class="sc__legend" aria-label="图例">
        <li><span class="sc__sw is-work" aria-hidden="true" />算了数（涂所在组的颜色）</li>
        <li><span class="sc__sw is-skip" aria-hidden="true" />被 if (i &lt; n) 拦下</li>
        <li><span class="sc__sw is-empty" aria-hidden="true" />空着的工位（没有线程）</li>
      </ul>
    </div>

    <HintLadder :challenge="challenge" />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签、按钮同 1-1 的挑战（JobBoard）和本关的探索。 */
.sc {
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

.sc__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.sc__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.sc__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.sc__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.sc__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.sc__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.sc__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: -4px 0 0;
  font-size: 14px;
}

.sc__launch-label {
  color: var(--hg-ink-2);
}

.sc__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.sc__note {
  margin: -8px 0 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.sc__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.sc__button {
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

.sc__button.is-primary {
  min-width: 6em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.sc__button:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.sc__button:disabled {
  opacity: 0.45;
  cursor: progress;
}

.sc__button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.sc__status {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.sc__boards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sc__board {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.sc__board-text {
  margin: 0;
  color: var(--hg-ink);
  font-size: 14px;
}

.sc__wave {
  margin-right: 8px;
  padding: 1px 6px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.sc__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.sc__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

/* 图例的三种工位，同小队板的条：涂色、留白、斜纹（不只靠颜色） */
.sc__sw {
  display: inline-block;
  width: 16px;
  height: 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
}

.sc__sw.is-work {
  background: var(--hg-group-0);
}

.sc__sw.is-skip {
  background: var(--hg-surface);
}

.sc__sw.is-empty {
  background: repeating-linear-gradient(45deg, var(--hg-border) 0 2px, transparent 2px 5px);
}

@media (max-width: 639px) {
  .sc {
    padding: 16px 14px;
  }

  .sc__knobs {
    padding: 12px 10px;
  }

  .sc__board {
    padding: 10px;
  }
}
</style>
