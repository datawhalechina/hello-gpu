<script setup lang="ts">
/**
 * 1-1 的挑战「今天的五张单子」（关卡自己的 scenes，不用登记组件）。
 *
 * 每张单子一段代码（按读者的写法显示 HIP 风格或 Python 风格，LangCode）和一个旋钮（Knob）：交给教授，
 * 还是拆开交给 1000 个学徒。点「开工」按 challenge.ts 的 judge 判星，结果表写清每张单子用了几拍、对不对；
 * 没过时 HintLadder 给出「现象 / 原因 / 怎么改」，没过 2 / 4 / 6 次依次解锁提示（F-12）。
 * 派法存进这一关的草稿槽，刷新不丢（03 第 4 节）。
 *
 * 两种写法的同一张单子是同一段程序（单测核对语法树相同），judge 和写法无关：换写法不影响拿星。
 */
import { computed, onMounted, ref, useId, watch } from 'vue'
import HintLadder from '@kit/HintLadder.vue'
import Knob from '@kit/Knob.vue'
import LangCode from '@kit/LangCode.vue'
import { highlight, type Tone } from '@kit/sandbox/highlight.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  CREW_BEATS, CREW_SIZE, DEFAULT_PICKS, JOBS, PROF_BEATS, STAGE_ID, WHO_OPTIONS,
  judge, normalizePicks, runDay, type DayResult, type Who,
} from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`

const challenge = useChallenge({
  stage: STAGE_ID,
  id: 'dispatch',
  hints: {
    direction: '先找拆不开的单子：哪几张的每一步，要用到上一步刚算出来的数？',
    location: '看单子 2 的 s 和单子 5 的 p：它们一边算，一边被自己用到。单子 4 只读 a，不读自己算出来的 d。',
    answer: '单子 1、4 拆给学徒；单子 2、5 交给教授；单子 3 只有 2 道，也交给教授：教授 2 拍，学徒一道就要 4 拍。',
  },
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

const cards = JOBS.map((job, i) => ({
  job,
  label: `单子 ${i + 1}`,
  hip: segments(job.code.hip, 'hip'),
  python: segments(job.code.python, 'python'),
}))

const picks = ref<Who[]>([...DEFAULT_PICKS])
/** 最近一次开工的结果；派法一改就清掉，免得读者对着旧结果看。 */
const lastRun = ref<DayResult | null>(null)
const message = ref('')

watch(picks, (value) => {
  challenge.draft.value = [...value]
  if (lastRun.value) {
    lastRun.value = null
    message.value = '派法改了，点「开工」看新的结果。'
  }
}, { deep: true })

// 草稿槽在 useChallenge 挂载时读出来，这里接着把上次的派法放回去。
onMounted(() => {
  picks.value = normalizePicks(challenge.draft.value)
})

const stars = computed(() => progress.stars(STAGE_ID))
const status = computed(() => message.value || `还没开工。现在已经拿到 ${stars.value} / 3 颗星。`)

function run() {
  const verdict = judge(picks.value)
  const outcome = challenge.attempt(verdict)
  lastRun.value = runDay(picks.value)
  const capped = outcome.stars.length > challenge.cap.value
    ? `（看过答案，这一关最多记 ${challenge.cap.value} 颗星）`
    : ''
  message.value = outcome.passed
    ? `过了，达到 ${outcome.stars.length} 条星级标准。${verdict.next}${capped}`
    : '没过：看下面的「这次的问题」。没过不扣经验值，可以一直试。'
}

/** 03 第 1 节第 3 条：随时可以重置。 */
function reset() {
  picks.value = [...DEFAULT_PICKS]
  lastRun.value = null
  message.value = ''
}

const WHO_TEXT = Object.fromEntries(WHO_OPTIONS.map((o) => [o.value, o.label])) as Record<Who, string>
</script>

<template>
  <section class="ta-board" :aria-labelledby="titleId">
    <header class="ta-board__head">
      <span class="ta-board__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="ta-board__title">今天的五张单子</strong>
      <span class="ta-board__tag">模拟</span>
    </header>
    <p class="ta-board__rules">
      规则：教授 {{ PROF_BEATS }} 拍算完一道，一道接一道；学徒 {{ CREW_BEATS }} 拍算完一道，{{ CREW_SIZE }} 人同时开工，人不够就分几轮。单子一张做完，再做下一张。
    </p>

    <ol class="ta-jobs">
      <li v-for="(card, i) in cards" :key="card.job.id" class="ta-job">
        <div class="ta-job__main">
          <p class="ta-job__title"><span class="ta-job__no">{{ card.label }}</span>{{ card.job.title }}</p>
          <p class="ta-job__detail">{{ card.job.detail }}</p>
          <LangCode>
            <template #hip>
              <div class="language-cpp"><span class="lang">cpp</span><pre><code><span v-for="(seg, k) in card.hip" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
            </template>
            <template #python>
              <div class="language-python"><span class="lang">python</span><pre><code><span v-for="(seg, k) in card.python" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
            </template>
          </LangCode>
        </div>
        <Knob :label="`${card.label} 交给`" :options="WHO_OPTIONS" v-model="picks[i]" />
      </li>
    </ol>

    <div class="ta-board__actions">
      <button type="button" class="ta-button is-primary" @click="run">开工</button>
      <button type="button" class="ta-button" @click="reset">重置派法</button>
    </div>
    <p class="ta-board__status" role="status">{{ status }}</p>

    <table v-if="lastRun" class="ta-result">
      <caption>这次开工的结果（拍数是模拟）</caption>
      <thead>
        <tr><th scope="col">单子</th><th scope="col">交给</th><th scope="col">用时</th><th scope="col">结果</th></tr>
      </thead>
      <tbody>
        <tr v-for="o in lastRun.outcomes" :key="o.job.id" :class="{ 'is-wrong': !o.correct }">
          <th scope="row">{{ cards[o.index].label }}</th>
          <td>{{ WHO_TEXT[o.who] }}</td>
          <td class="is-num">{{ o.beats }} 拍</td>
          <td>
            <span class="ta-result__mark" :class="o.correct ? 'is-right' : 'is-wrong'">
              <svg v-if="o.correct" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
              <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
              {{ o.correct ? '对' : '算错了' }}
            </span>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr><th scope="row" colspan="2">总用时</th><td class="is-num">{{ lastRun.total }} 拍</td><td /></tr>
      </tfoot>
    </table>

    <HintLadder :challenge="challenge" />
  </section>
</template>

<style scoped>
.ta-board {
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

.ta-board__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ta-board__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ta-board__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ta-board__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.ta-board__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.ta-jobs {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 窄屏：说明、代码、旋钮从上往下排；宽屏：旋钮放在右边，和代码底边对齐。 */
.ta-job {
  display: grid;
  gap: 10px 24px;
  min-width: 0;
  margin: 0;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.ta-job__main {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

@media (min-width: 720px) {
  .ta-job {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }
}

.ta-job__title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  margin: 0;
  font-weight: 700;
}

.ta-job__no {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

.ta-job__detail {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

/* 代码区的上下边距交给卡片的 gap。 */
.ta-job :deep(.hg-langcode) {
  margin: 0;
}

.ta-job :deep(div[class*='language-']) {
  margin: 0;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

.ta-board__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.ta-button {
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

.ta-button.is-primary {
  min-width: 6em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.ta-button:hover {
  border-color: var(--hg-accent);
}

.ta-button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.ta-board__status {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* 结果表：.hg-prose 的表格样式之外，数字右对齐、等宽；算错的一行红底（01 第 2.2 节），另有叉号和文字。 */
.ta-result {
  margin: 0;
}

.ta-result caption {
  padding-bottom: 6px;
  color: var(--hg-ink-3);
  font-size: 13px;
  text-align: left;
}

.ta-result .is-num {
  font-family: var(--hg-font-mono);
  text-align: right;
}

.ta-result tr.is-wrong > * {
  background: var(--hg-error-soft);
}

.ta-result tfoot th,
.ta-result tfoot td {
  font-weight: 700;
}

.ta-result__mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.ta-result__mark.is-right {
  color: var(--hg-accent-ink);
}

.ta-result__mark.is-wrong {
  color: var(--hg-error-ink);
}

.ta-result__mark svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (max-width: 639px) {
  .ta-board {
    padding: 16px 14px;
  }

  .ta-job {
    padding: 12px 10px;
  }

  /* 375px 上最长的一行（for 循环头）也放得下，不用横向滚动。 */
  .ta-job :deep(div[class*='language-'] pre) {
    padding: 10px 12px 12px;
  }

  .ta-job :deep(div[class*='language-'] code) {
    font-size: 13px;
  }
}
</style>
