<script setup lang="ts">
/**
 * 副本「矩阵转置」题解里的对比（副本自己的 scenes，不用登记组件）：读和写，哪一侧不合并。
 *
 * 参考解有两种排法，只差 r、c 两行：顺着 a 排（第 g 个线程读 a[g]）、顺着 b 排（第 g 个线程写 b[g]）。
 * 两种排法一挂载就在 Web Worker 里各跑一次（docs/sim/client.ts），换写法偏好时重跑；旋钮只换看哪一次。
 * 两个访存视图（MemoryView）一个只看读 a、一个只看写 b（array 属性），各显示小队第一次读、第一次写搬了几车；
 * 下面的表写两种排法整段各搬了几车。车次都来自 L3 的 analyzeMemory，是模拟值。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import LangCode from '@kit/LangCode.vue'
import MemoryView from '@kit/MemoryView.vue'
import { highlight, type Tone } from '@kit/sandbox/highlight.ts'
import { buildRequest } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { useProgress } from '@course/useProgress.ts'
import { ARGS, LAUNCH, ORDERS, ORDER_DECODE, orderCode, orderText, sideCars, type Order } from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const order = ref<Order>('a')

/** r、c 两行按 highlight() 的结果切成几段，关键字和注释着色（和代码沙盒同一套高亮，同 1-8 的实验台）。 */
function segments(lang: Lang) {
  const { r, c } = ORDER_DECODE[order.value][lang]
  const source = lang === 'hip'
    ? `int r = ${r};   // a 的第几行\nint c = ${c};   // a 的第几列`
    : `r = ${r}    # a 的第几行\nc = ${c}    # a 的第几列`
  const parts: { text: string; tone: Tone | '' }[] = []
  let at = 0
  for (const token of highlight(source, lang)) {
    if (token.from > at) parts.push({ text: source.slice(at, token.from), tone: '' })
    parts.push({ text: source.slice(token.from, token.to), tone: token.tone })
    at = token.to
  }
  if (at < source.length) parts.push({ text: source.slice(at), tone: '' })
  return parts
}

const code = computed(() => ({ hip: segments('hip'), python: segments('python') }))

const runs = shallowRef<Record<Order, RunResult> | null>(null)
const problem = ref('')
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const lang = progress.state.prefs.lang
  try {
    const next = {} as Record<Order, RunResult>
    for (const { value } of ORDERS) next[value] = await client.run(buildRequest(orderCode(value)[lang], lang, LAUNCH, ARGS))
    runs.value = next
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着换写法时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `对比没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch(() => progress.state.prefs.lang, simulate)

onMounted(() => {
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())

const result = computed(() => runs.value?.[order.value] ?? null)
/** 两种排法整段各搬了几车：表里两行都写，正在看的那一行描出来。 */
const rows = computed(() => {
  const r = runs.value
  if (!r) return []
  return ORDERS.map(({ value, label }) => ({ value, label, cars: sideCars(r[value].events) }))
})
const readout = computed(() => {
  const row = rows.value.find((r) => r.value === order.value)
  if (row) return orderText(order.value, row.cars)
  return problem.value ? '' : '模拟器准备中……'
})
</script>

<template>
  <section class="tc" :aria-labelledby="titleId">
    <header class="tc__head">
      <span class="tc__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="tc__title">读和写，哪一侧跨行</strong>
      <span class="tc__tag">模拟</span>
    </header>
    <p class="tc__rules">两种排法只差下面两行。切换排法，看小队第一次读 a、第一次写 b 各搬几车。</p>

    <div class="tc__knobs">
      <Knob label="排法" :options="ORDERS" v-model="order" />
    </div>

    <div class="tc__code">
      <LangCode>
        <template #hip>
          <div class="language-cpp"><span class="lang">cpp</span><pre><code><span v-for="(seg, k) in code.hip" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
        </template>
        <template #python>
          <div class="language-python"><span class="lang">python</span><pre><code><span v-for="(seg, k) in code.python" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
        </template>
      </LangCode>
    </div>

    <p v-if="problem" class="tc__problem" role="alert">{{ problem }}</p>
    <p class="tc__readout" aria-live="polite">{{ readout }}</p>

    <div v-if="rows.length" class="tc__table-wrap">
      <table class="tc__table">
        <caption class="tc__caption">两种排法整段各搬了几车（模拟）</caption>
        <thead>
          <tr>
            <th scope="col">排法</th>
            <th scope="col">读 a</th>
            <th scope="col">写 b</th>
            <th scope="col">一共</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.value" :class="{ 'is-current': row.value === order }">
            <th scope="row">{{ row.label }}</th>
            <td>{{ row.cars.read }} 车</td>
            <td>{{ row.cars.write }} 车</td>
            <td>{{ row.cars.read + row.cars.write }} 车</td>
          </tr>
          <tr class="is-ideal">
            <th scope="row">理想</th>
            <td>{{ rows[0].cars.readIdeal }} 车</td>
            <td>{{ rows[0].cars.writeIdeal }} 车</td>
            <td>{{ rows[0].cars.readIdeal + rows[0].cars.writeIdeal }} 车</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="tc__views">
      <div class="tc__view">
        <p class="tc__side">读的这一侧：a</p>
        <MemoryView :result="result" :launch="LAUNCH" array="a" :controls="false" :knobs="false" empty-text="模拟器准备中……" />
      </div>
      <div class="tc__view">
        <p class="tc__side">写的这一侧：b</p>
        <MemoryView :result="result" :launch="LAUNCH" array="b" :controls="false" :knobs="false" empty-text="模拟器准备中……" />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签、代码区同 1-8 的实验台（CarLab）。 */
.tc {
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

.tc__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.tc__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.tc__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.tc__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.tc__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.tc__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.tc__code {
  min-width: 0;
}

.tc__code :deep(.hg-langcode) {
  margin: 0;
}

.tc__code :deep(div[class*='language-']) {
  margin: 0;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

.tc__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

.tc__readout {
  min-height: 1.6em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

/* 表格窄屏放不下时在这一块里横着滚，页面不跟着滚（01 第 7 节）。 */
.tc__table-wrap {
  min-width: 0;
  overflow-x: auto;
}

/* VitePress 正文里的表格是 display: block、带竖线和隔行底色，这里换回占满一行的普通表格（同 1-7 的 TripBoard）。 */
.tc__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.tc .tc__table tr {
  border: 0;
  background-color: transparent;
}

.tc__caption {
  padding-bottom: 6px;
  color: var(--hg-ink-2);
  font-size: 13px;
  text-align: left;
}

.tc .tc__table th,
.tc .tc__table td {
  padding: 6px 10px;
  border: 0;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
  text-align: left;
  white-space: nowrap;
}

.tc__table thead th {
  color: var(--hg-ink-2);
  font-weight: 600;
}

.tc .tc__table tbody tr.is-current {
  background: var(--hg-surface-2);
}

.tc__table tbody tr.is-current th {
  box-shadow: inset 3px 0 0 var(--hg-accent);
}

.tc__table tbody tr.is-ideal {
  color: var(--hg-ink-2);
}

.tc__views {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.tc__view {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tc__side {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .tc {
    padding: 16px 14px;
  }

  .tc__knobs {
    padding: 12px 10px;
  }

  .tc__code :deep(div[class*='language-'] pre) {
    padding: 10px 12px 12px;
  }

  .tc__code :deep(div[class*='language-'] code) {
    font-size: 13px;
  }

  .tc .tc__table th,
  .tc .tc__table td {
    padding: 6px 8px;
  }
}
</style>
