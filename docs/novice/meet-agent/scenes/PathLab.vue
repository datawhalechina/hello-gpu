<script setup lang="ts">
/**
 * 1-13 探索二「换个起点」（关卡自己的 scenes，不用登记组件）。
 *
 * 两个旋钮（Knob）选规则 Agent 的起点：block、stride（默认 block 16、步长 2，第二个先猜问的就是它）。
 * 旋钮一动，就在 Web Worker 里让规则 Agent 从这个起点走一轮（A-01 的 createEnv + rulePolicy，和 AgentConsole 一样挂载后才加载），
 * 用 challenge.ts 的 pathOf 缩成几站：每站写着在这组参数上读到了什么（算对没有、周期数、lane 利用率、车次），
 * 以及为什么离开它（紧接着那一步的思考）。上面一句（pathText）写先改了什么、再改了什么、第几步交了哪一组。
 * 走过的起点记下来，拨回去马上画出来。不判星，旋钮不存草稿（同前几关只有旋钮的探索），刷新回到默认。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { createSimClient, type SimClient } from '@sim/client.ts'
import { runAgent, starText, type Policy } from '@course/agent/react.ts'
import { configKey, describeConfig, type TuneConfig } from '@course/agent/tasks.ts'
import { PATH_START, TASK, pathOf, pathText, type PathSummary } from '../challenge.ts'

interface Runtime {
  createEnv: typeof import('@course/agent/tools.ts').createEnv
  percent: typeof import('@course/agent/tools.ts').percent
  rulePolicy: Policy
}

const titleId = `${useId()}-title`
const BLOCKS = [...TASK.blocks]
const STRIDES = [...TASK.strides]

const block = ref<number>(PATH_START.block)
const stride = ref<number>(PATH_START.stride)
const start = computed<TuneConfig>(() => ({ block: block.value, stride: stride.value }))

const runtime = shallowRef<Runtime | null>(null)
const summary = shallowRef<{ key: string; path: PathSummary } | null>(null)
const problem = ref('')
/** 走过的起点：同一个起点规则 Agent 每次都走一样的路（确定性），不用再跑 */
const walked = new Map<string, PathSummary>()
let client: SimClient | null = null
let generation = 0

async function walk() {
  const rt = runtime.value
  const s = start.value
  const key = configKey(s)
  const mine = ++generation
  problem.value = ''
  const hit = walked.get(key)
  if (hit) {
    summary.value = { key, path: hit }
    return
  }
  if (!rt || !client) return
  const sim = client
  try {
    const episode = await runAgent(rt.createEnv({ ...TASK, start: s }, (request) => sim.run(request)), rt.rulePolicy)
    const path = pathOf(episode.steps)
    walked.set(key, path)
    if (mine === generation) summary.value = { key, path }
  } catch (err) {
    // 连着拨旋钮时，上一轮的模拟以 AbortError 结束，不算出错
    const name = err instanceof Error || err instanceof DOMException ? err.name : ''
    if (mine === generation && name !== 'AbortError') {
      problem.value = `规则 Agent 没走起来：${err instanceof Error || err instanceof DOMException ? err.message : String(err)}。刷新页面再试一次。`
    }
  }
}

watch(start, () => void walk())

onMounted(async () => {
  client = createSimClient()
  try {
    const [tools, rules] = await Promise.all([import('@course/agent/tools.ts'), import('@course/agent/rules.ts')])
    runtime.value = { createEnv: tools.createEnv, percent: tools.percent, rulePolicy: rules.rulePolicy }
    await walk()
  } catch (err) {
    problem.value = `Agent 的代码没加载出来：${err instanceof Error ? err.message : String(err)}。刷新页面再试一次。`
  }
})

onBeforeUnmount(() => {
  generation++
  client?.dispose()
  client = null
})

/** 结果和旋钮对得上才画（拨旋钮以后、新的一轮走完之前，先不画旧的）。 */
const current = computed(() => (summary.value?.key === configKey(start.value) ? summary.value.path : null))
const readout = computed(() => {
  if (current.value) return pathText(current.value)
  return problem.value ? '' : '规则 Agent 正在模拟器上走这一轮……'
})

/** 一站读到的：算对没有、周期数、lane 利用率、车次（都是模拟）。 */
function seenText(stop: PathSummary['stops'][number]): string {
  const parts: string[] = []
  if (stop.correct !== null) parts.push(stop.correct ? '全部算对' : '有数算错了')
  if (stop.cycles !== null) parts.push(`${stop.cycles} 个周期`)
  if (stop.laneUse !== null && runtime.value) parts.push(`lane 利用率 ${runtime.value.percent(stop.laneUse)}`)
  if (stop.transactions !== null) parts.push(`搬了 ${stop.transactions} 车，理想 ${stop.ideal} 车`)
  return parts.join(' · ')
}
</script>

<template>
  <section class="pl" :aria-labelledby="titleId">
    <header class="pl__head">
      <span class="pl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="pl__title">换个起点</strong>
      <span class="pl__tag">模拟</span>
    </header>
    <p class="pl__rules">规则 Agent 的规则不变，只换它的起点。旋钮一动，它就从新的起点在模拟器上走一轮；下面按它停过的参数分站，每站写着读到了什么、为什么离开。</p>

    <div class="pl__knobs">
      <Knob v-model="block" label="起点：每组线程数" code="block" :options="BLOCKS" />
      <Knob v-model="stride" label="起点：访问步长" code="stride" :options="STRIDES" />
    </div>

    <p v-if="problem" class="pl__problem" role="alert">{{ problem }}</p>
    <p class="pl__readout" aria-live="polite">{{ readout }}</p>

    <ol v-if="current" class="pl__stops" :aria-label="`从 ${describeConfig(start)} 出发，规则 Agent 停过的参数`">
      <li v-for="(stop, k) in current.stops" :key="k" class="pl-stop">
        <p class="pl-stop__head">
          <span class="pl-stop__config">{{ describeConfig(stop.config) }}</span>
          <span class="pl-stop__steps">{{ stop.first === stop.last ? `第 ${stop.first} 步` : `第 ${stop.first}–${stop.last} 步` }}</span>
        </p>
        <p class="pl-stop__seen">读到：{{ seenText(stop) }}</p>
        <p v-if="stop.why" class="pl-stop__why"><span class="pl-stop__badge">思考</span>{{ stop.why }}</p>
      </li>
      <li v-if="current.verdict" class="pl-stop is-finish">
        <p class="pl-stop__head">
          <span class="pl-stop__config">交卷：{{ describeConfig(current.verdict.config) }}</span>
          <span class="pl-stop__steps">第 {{ current.steps }} 步</span>
        </p>
        <p class="pl-stop__seen">
          <span aria-hidden="true">{{ starText(current.verdict.earned) }}</span>
          控制台评了 {{ current.verdict.earned.filter(Boolean).length }} 颗星，{{ current.verdict.cycles }} 个周期（模拟）
        </p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的探索（1-12 的 WaveLab）。 */
.pl {
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

.pl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.pl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.pl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.pl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.pl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* 旋钮：宽屏两列，窄屏一列（同 1-12 的挑战）。 */
.pl__knobs {
  display: grid;
  gap: 14px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .pl__knobs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.pl__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

.pl__readout {
  min-height: 1.6em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

/* 几站：一站一块，左边一道竖线连起来，像一条路（不只靠颜色：每站写着第几步、读到什么、思考） */
.pl__stops {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pl-stop {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px 10px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-left: 4px solid var(--hg-accent);
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
}

.pl-stop.is-finish {
  border-left-color: var(--hg-ink);
  background: var(--hg-surface-2);
}

.pl-stop p {
  margin: 0;
}

.pl-stop__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 12px;
}

.pl-stop__config {
  font-weight: 700;
}

.pl-stop__steps {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.pl-stop__seen {
  color: var(--hg-ink);
  font-size: 14px;
  line-height: 1.7;
}

.pl-stop__why {
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.7;
}

/* 「思考」标签同 AgentConsole：虚线框 */
.pl-stop__badge {
  display: inline-block;
  margin-right: 8px;
  padding: 0 8px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
  line-height: 22px;
}

@media (max-width: 639px) {
  .pl {
    padding: 16px 14px;
  }

  .pl__knobs {
    padding: 12px 10px;
  }
}
</style>
