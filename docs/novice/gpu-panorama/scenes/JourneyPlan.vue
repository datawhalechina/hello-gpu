<script setup lang="ts">
/**
 * 1-2 的挑战「三排数加起来」（关卡自己的 scenes，不用登记组件）。
 *
 * 五个旋钮（Knob）：a、b、c 拷不拷进显存，中间结果 t 怎么办，CPU 要的 out 拷不拷回来。下面按读者的
 * 写法偏好（LangCode）显示这种搬法写出来的代码，选一下就变（03 第 1 节第 4 条）。点「出发」按
 * challenge.ts 的 judge 判星，结果表逐步写清做了什么、搬了多少、对不对；没过时 HintLadder 给出
 * 「现象 / 原因 / 怎么改」，没过 2 / 4 / 6 次依次解锁提示（F-12）。搬法存进这一关的草稿槽，刷新不丢。
 *
 * 两种写法显示的是同一串操作（单测核对），judge 和写法无关：换写法不影响拿星。
 */
import { computed, onMounted, ref, useId, watch } from 'vue'
import HintLadder from '@kit/HintLadder.vue'
import Knob from '@kit/Knob.vue'
import LangCode from '@kit/LangCode.vue'
import { highlight, type Tone } from '@kit/sandbox/highlight.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  ARRAY_BYTES, ARRAY_LENGTH, BYTES_PER_NUMBER, DEFAULT_PLAN, PLAN_ITEMS, STAGE_ID,
  hostCode, judge, normalizePlan, runPlan, type Op, type Plan, type Trip,
} from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`

const challenge = useChallenge({
  stage: STAGE_ID,
  id: 'journey',
  hints: {
    direction: '先把五排数分三类：GPU 要用的、CPU 要看的、只在 GPU 上倒一次手的。',
    location: '看中间结果 t：第一次启动把它写进显存，第二次启动从显存里读它，CPU 用不到它。',
    answer: 'a、b、c 拷进显存；t 留在显存；out 拷回 CPU。一共拷贝 4 次。',
  },
})

const plan = ref<Plan>({ ...DEFAULT_PLAN })
/** 最近一次出发的结果；搬法一改就清掉，免得读者对着旧结果看。 */
const lastRun = ref<Trip | null>(null)
const message = ref('')

watch(plan, (value) => {
  challenge.draft.value = { ...value }
  if (lastRun.value) {
    lastRun.value = null
    message.value = '搬法改了，点「出发」看新的结果。'
  }
}, { deep: true })

// 草稿槽在 useChallenge 挂载时读出来，这里接着把上次的搬法放回去。
onMounted(() => {
  plan.value = normalizePlan(challenge.draft.value)
})

/** 代码按 highlight() 的结果切成几段，关键字和注释着色（和代码沙盒同一套高亮）。 */
function segments(source: string, lang: 'hip' | 'python') {
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

const code = computed(() => ({
  hip: segments(hostCode(plan.value, 'hip'), 'hip'),
  python: segments(hostCode(plan.value, 'python'), 'python'),
}))

const stars = computed(() => progress.stars(STAGE_ID))
const status = computed(() => message.value || `还没出发。现在已经拿到 ${stars.value} / 3 颗星。`)

function run() {
  const verdict = judge(plan.value)
  const outcome = challenge.attempt(verdict)
  lastRun.value = runPlan(plan.value)
  const capped = outcome.stars.length > challenge.cap.value
    ? `（看过答案，这一关最多记 ${challenge.cap.value} 颗星）`
    : ''
  message.value = outcome.passed
    ? `过了，达到 ${outcome.stars.length} 条星级标准。${verdict.next}${capped}`
    : '没过：看下面的「这次的问题」。没过不扣经验值，可以一直试。'
}

/** 03 第 1 节第 3 条：随时可以重置。 */
function reset() {
  plan.value = { ...DEFAULT_PLAN }
  lastRun.value = null
  message.value = ''
}

/** 结果表里的一行写什么。「等 GPU 算完」不搬东西，也不会出错，表里不列。 */
function opText(op: Op): string {
  if (op.kind === 'copy-in') return `${op.array} 拷进显存`
  if (op.kind === 'copy-out') return `${op.array} 拷回 CPU`
  if (op.kind === 'launch') return `启动：${op.out} = ${op.inputs.join(' + ')}`
  return '等 GPU 算完'
}

const rows = computed(() => (lastRun.value?.steps ?? []).filter((s) => s.op.kind !== 'wait'))
const outcomeText = computed(() => {
  const trip = lastRun.value
  if (!trip) return ''
  if (!trip.delivered) return 'CPU 没拿到 out'
  return trip.correct ? 'CPU 拿到了 out，结果对' : 'CPU 拿到的 out 不对'
})
</script>

<template>
  <section class="jp" :aria-labelledby="titleId">
    <header class="jp__head">
      <span class="jp__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="jp__title">三排数加起来</strong>
      <span class="jp__tag">模拟</span>
    </header>
    <p class="jp__rules">
      工作单 add 一次只加两排数，所以要启动两次：先算 <code>t = a + b</code>，再算 <code>out = t + c</code>。CPU 只要 out。
      每排 {{ ARRAY_LENGTH }} 个数，每个数 {{ BYTES_PER_NUMBER }} 字节（字节是数据大小的单位），拷一排就是 {{ ARRAY_BYTES }} 字节。
    </p>

    <div class="jp__knobs">
      <Knob v-for="item in PLAN_ITEMS" :key="item.key" :label="item.label" :code="item.code" :options="item.options" v-model="plan[item.key]" />
    </div>

    <div class="jp__code">
      <p class="jp__code-note">这样搬，代码写出来是（申请显存的几行省略了，d_ 开头的是显存里的那一份）：</p>
      <LangCode>
        <template #hip>
          <div class="language-cpp"><span class="lang">cpp</span><pre><code><span v-for="(seg, k) in code.hip" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
        </template>
        <template #python>
          <div class="language-python"><span class="lang">python</span><pre><code><span v-for="(seg, k) in code.python" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
        </template>
      </LangCode>
    </div>

    <div class="jp__actions">
      <button type="button" class="jp-button is-primary" @click="run">出发</button>
      <button type="button" class="jp-button" @click="reset">重置搬法</button>
    </div>
    <p class="jp__status" role="status">{{ status }}</p>

    <table v-if="lastRun" class="jp-result">
      <caption>这次的旅程（按顺序；字节数是算出来的）</caption>
      <thead>
        <tr><th scope="col">第几步</th><th scope="col">做什么</th><th scope="col">搬了多少</th><th scope="col">结果</th></tr>
      </thead>
      <tbody>
        <tr v-for="(s, i) in rows" :key="i" :class="{ 'is-wrong': !s.ok }">
          <th scope="row" class="is-num">{{ i + 1 }}</th>
          <td>{{ opText(s.op) }}</td>
          <td class="is-num">{{ s.bytes ? `${s.bytes} 字节` : '—' }}</td>
          <td>
            <span class="jp-result__mark" :class="s.ok ? 'is-right' : 'is-wrong'">
              <svg v-if="s.ok" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
              <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
              {{ s.ok ? '对' : s.note }}
            </span>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr><th scope="row" colspan="2">拷贝 {{ lastRun.copies }} 次</th><td class="is-num">{{ lastRun.bytes }} 字节</td><td :class="{ 'is-bad': !lastRun.correct }">{{ outcomeText }}</td></tr>
      </tfoot>
    </table>

    <HintLadder :challenge="challenge" />
  </section>
</template>

<style scoped>
.jp {
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

.jp__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.jp__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.jp__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.jp__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.jp__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* 旋钮：宽屏两列，窄屏一列。 */
.jp__knobs {
  display: grid;
  gap: 14px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .jp__knobs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.jp__code {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.jp__code-note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.jp__code :deep(.hg-langcode) {
  margin: 0;
}

.jp__code :deep(div[class*='language-']) {
  margin: 0;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

.jp__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.jp-button {
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

.jp-button.is-primary {
  min-width: 6em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.jp-button:hover {
  border-color: var(--hg-accent);
}

.jp-button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.jp__status {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* 结果表：.hg-prose 的表格样式之外，数字右对齐、等宽；出错的一行红底（01 第 2.2 节），另有叉号和文字。 */
.jp-result {
  margin: 0;
}

.jp-result caption {
  padding-bottom: 6px;
  color: var(--hg-ink-3);
  font-size: 13px;
  text-align: left;
}

.jp-result .is-num {
  font-family: var(--hg-font-mono);
  text-align: right;
  white-space: nowrap;
}

.jp-result tr.is-wrong > * {
  background: var(--hg-error-soft);
}

.jp-result tfoot th,
.jp-result tfoot td {
  font-weight: 700;
}

.jp-result tfoot .is-bad {
  color: var(--hg-error-ink);
}

.jp-result__mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.jp-result__mark.is-right {
  color: var(--hg-accent-ink);
}

.jp-result__mark.is-wrong {
  color: var(--hg-error-ink);
}

.jp-result__mark svg {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (max-width: 639px) {
  .jp {
    padding: 16px 14px;
  }

  .jp__knobs {
    padding: 12px 10px;
  }

  .jp__code :deep(div[class*='language-'] pre) {
    padding: 10px 12px 12px;
  }

  .jp__code :deep(div[class*='language-'] code) {
    font-size: 13px;
  }

  .jp-result th,
  .jp-result td {
    padding: 6px 6px;
    font-size: 13px;
  }
}
</style>
