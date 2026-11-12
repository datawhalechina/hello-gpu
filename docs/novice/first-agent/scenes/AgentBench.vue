<script setup lang="ts">
/**
 * 1-14 的挑战「补全你的 Agent」（关卡自己的 scenes，不用登记组件）。
 *
 * AgentCode（A-02，全局注册的异步组件）：读者在 Python 模板里补三个空，点「运行我的 Agent」。起点 block 48、步长 4；
 * 起点这一轮交卷了，同一份代码再从搜索空间里另外 27 组（VARIANTS）各跑一轮。result 交给 challenge.ts 的 judge 判星，
 * useChallenge 记尝试、发星；没过时 HintLadder 写出「现象 / 原因 / 怎么改」，没过 2 / 4 / 6 次依次解锁提示（F-12）。
 * 代码出错时 AgentCode 自己写出了这次的问题（带行号和 Python 的原文），这里不再交给 HintLadder 重复一遍。
 * 三个空（v-model:values）存进这一关的草稿槽，刷新不丢；不自动运行（运行要下载 Python）。
 * 下面的表（SpaceGrid）是最近一次 28 个起点各拿到几颗星，起点那格写着「起点」。
 * 判星和写法无关：worker 跑 HIP 写法的 kernel，两种写法观察逐项相同（A-01 的单测），本关单测把两种写法都跑一遍。
 */
import { computed, ref, shallowRef, useId } from 'vue'
import HintLadder from '@kit/HintLadder.vue'
import { starText } from '@course/agent/react.ts'
import { configKey, describeConfig, sameConfig } from '@course/agent/tasks.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  HINTS, SPACE, STAGE_ID, START, VARIANTS, judge, normalizeDraft, startMarks,
  type BenchResult, type BenchVariant, type GridCell,
} from '../challenge.ts'
import SpaceGrid from './SpaceGrid.vue'

/** AgentCode 的 result 事件里判星要用的部分（别的字段这里用不到）。 */
type CodeResult = Pick<BenchResult, 'stop' | 'verdict' | 'error' | 'log'> & { variants: readonly BenchVariant[] }

const progress = useProgress()
const titleId = `${useId()}-title`
const challenge = useChallenge({ stage: STAGE_ID, id: 'bench', hints: HINTS })

/** 读者填的三个空：从草稿槽读（规整过），写回去就自动保存。 */
const values = computed<Record<string, string>>({
  get: () => normalizeDraft(challenge.draft.value).values,
  set: (next) => {
    challenge.draft.value = { values: next }
  },
})

const last = shallowRef<BenchResult | null>(null)
const message = ref('')
/** Python 没加载出来的原因 */
const fallback = ref('')

function onResult(r: CodeResult) {
  const result: BenchResult = { stop: r.stop, verdict: r.verdict, error: r.error, log: r.log, variants: r.variants }
  last.value = result
  fallback.value = ''
  const verdict = judge(result)
  // 代码出错：AgentCode 已经写出这次的问题（行号、原文、跳到那一行），提示阶梯只记次数、给提示
  const outcome = challenge.attempt(r.stop === 'error' ? { earned: verdict.earned, next: verdict.next } : verdict)
  const capped = outcome.stars.length > challenge.cap.value ? `（看过答案，这一关最多记 ${challenge.cap.value} 颗星）` : ''
  if (outcome.passed) {
    message.value = `过了，达到 ${outcome.stars.length} 条星级标准。${verdict.next}${capped}`
    return
  }
  const where = r.stop === 'error' ? '代码下面的「这次的问题」写了原因和怎么改。' : '看下面的「这次的问题」。'
  message.value = `没过：${verdict.error?.symptom ?? ''}${where}没过不扣经验值，改好了再运行。`
}

function onFallback(reason: string) {
  fallback.value = reason
}

const stars = computed(() => progress.stars(STAGE_ID))
const status = computed(() => {
  if (message.value) return message.value
  const now = `现在已经拿到 ${stars.value} / 3 颗星。`
  if (fallback.value) {
    return `Python 没有加载出来（${fallback.value}）：这一关的星要等你的 Agent 真的跑起来才能拿。上面放的是规则 Agent 的一轮，三个空补对以后你的 Agent 每一步都和它一样；检查点照样能答。${now}`
  }
  return `还没运行。${now}`
})

/** 表上每一格：从这组出发的那一轮拿到几颗星（控制台的评分）、没交卷、出错，还是没跑。 */
const cells = computed(() => {
  const out: Record<string, GridCell> = {}
  if (!last.value) return out
  for (const m of startMarks(last.value)) {
    const at = `从 ${describeConfig(m.config)} 出发`
    const tag = sameConfig(m.config, START) ? '起点' : undefined
    const key = configKey(m.config)
    if (m.stop === null) out[key] = { text: '·', label: `${at}：没有跑`, tone: 'muted', tag }
    else if (m.stars !== null) {
      const earned = [0, 1, 2].map((k) => k < m.stars!)
      out[key] = { text: starText(earned), label: `${at}：交卷，${m.stars} 颗星`, tone: m.stars === 3 ? 'good' : 'bad', tag }
    } else if (m.stop === 'error') out[key] = { text: '出错', label: `${at}：代码出错停下了`, tone: 'bad', tag }
    else out[key] = { text: '没交卷', label: `${at}：没有交卷`, tone: 'bad', tag }
  }
  return out
})

const summary = computed(() => {
  const r = last.value
  if (!r) return ''
  const marks = startMarks(r)
  const full = marks.filter((m) => m.stars === 3).length
  const ran = marks.filter((m) => m.stop !== null).length
  if (ran === 1) return `起点这一轮${r.stop === 'finish' ? '交卷以后出了错' : '没有交卷'}，没有换起点再跑。`
  return `${SPACE.length} 个起点里，${full} 个调到了三颗星（控制台的评分）${ran < SPACE.length ? `，${SPACE.length - ran} 个没有跑` : ''}。`
})
</script>

<template>
  <section class="ab" :aria-labelledby="titleId">
    <header class="ab__head">
      <span class="ab__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="ab__title">补全你的 Agent</strong>
      <span class="ab__tag">模拟</span>
    </header>
    <p class="ab__rules">起点是 {{ describeConfig(START) }}。交卷以后，同一份代码会从另外 {{ VARIANTS.length }} 组各跑一轮。下面卡片里列的三条，是给交出的参数打分的标准；这一关的三颗星，看页面开头的任务卡。</p>

    <AgentCode v-model:values="values" :start="START" :variants="VARIANTS" @result="onResult" @fallback="onFallback" />

    <p class="ab__status" role="status">{{ status }}</p>

    <div v-if="last" class="ab__space">
      <p class="ab__summary">{{ summary }}</p>
      <SpaceGrid :cells="cells" caption="同一份代码从每一组出发，各拿到几颗星（控制台的评分）" />
    </div>

    <HintLadder :challenge="challenge" />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的挑战（1-13 的 AgentSeat）。 */
.ab {
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

.ab__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ab__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ab__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ab__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.ab__rules,
.ab__status,
.ab__summary {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.ab__status {
  color: var(--hg-ink);
}

/* AgentCode 自己有 20px 的上下外边距，卡片里用 gap 隔开就够了 */
.ab :deep(.hg-agentcode) {
  margin: 0;
}

.ab__space {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

@media (max-width: 639px) {
  .ab {
    padding: 16px 14px;
  }
}
</style>
