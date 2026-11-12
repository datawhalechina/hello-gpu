<script setup lang="ts">
/**
 * 1-13 的挑战「你来当 Agent」（关卡自己的 scenes，不用登记组件）。
 *
 * AgentConsole（A-01）只给「你来当 Agent」（:replay="false"：规则 Agent 从这个起点怎么走，要读者自己走出来），
 * 起点 block 100、步长 8。读者每一步选一样工具和一组参数，执行后看观察，控制台同时写出规则 Agent 换你会怎么选。
 * 交卷或者走满步数，控制台发 finish（带这一轮的 log），challenge.ts 的 judge 判星；没过时 HintLadder 写出
 * 「现象 / 原因 / 怎么改」，没过 2 / 4 / 6 次依次解锁提示（F-12）。
 * 读者这一轮的行动（v-model:actions）存进这一关的草稿槽：刷新以后控制台照着重新走一遍（模拟是确定的），
 * 还原出来的一轮只写出上次的结果，不算一次新的尝试（03 第 4 节）。
 * 判星和写法无关：控制台跑的 kernel 两种写法观察逐项相同（A-01 的单测），本关单测把两种写法都走一遍。
 */
import { computed, ref, useId, watch } from 'vue'
import AgentConsole from '@kit/AgentConsole.vue'
import HintLadder from '@kit/HintLadder.vue'
import type { AgentAction } from '@course/agent/react.ts'
import { describeConfig } from '@course/agent/tasks.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import { HINTS, SEAT_START, STAGE_ID, judge, normalizeDraft, type SeatStep } from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const challenge = useChallenge({ stage: STAGE_ID, id: 'seat', hints: HINTS })

/** 读者这一轮的行动：从草稿槽读（规整过），写回去就自动保存。 */
const actions = computed<AgentAction[]>({
  get: () => normalizeDraft(challenge.draft.value).actions,
  set: (list) => {
    challenge.draft.value = { actions: list }
  },
})

/** 刚交卷的结果（读屏播报）；刷新以后还原出来的上一轮写在 earlier，不播报。 */
const message = ref('')
const earlier = ref('')

// 「再来一次」清空了这一轮：上一轮的结果不再对得上现在的控制台
watch(() => actions.value.length, (n) => {
  if (n > 0) return
  message.value = ''
  earlier.value = ''
})

function onFinish(summary: { log: readonly SeatStep[]; restored: boolean }) {
  const verdict = judge(summary.log, SEAT_START)
  if (summary.restored) {
    const n = verdict.earned.filter(Boolean).length
    earlier.value = verdict.earned[0]
      ? `上次这一轮达到 ${n} 条星级标准。${verdict.next}想重走一轮，点控制台里的「再来一次」。`
      : `上次这一轮没过：${verdict.error?.symptom ?? ''}点控制台里的「再来一次」接着试。`
    return
  }
  earlier.value = ''
  const outcome = challenge.attempt(verdict)
  const capped = outcome.stars.length > challenge.cap.value
    ? `（看过答案，这一关最多记 ${challenge.cap.value} 颗星）`
    : ''
  message.value = outcome.passed
    ? `过了，达到 ${outcome.stars.length} 条星级标准。${verdict.next}${capped}`
    : `没过：${verdict.error?.symptom ?? ''}看下面的「这次的问题」。没过不扣经验值，点控制台里的「再来一次」接着试。`
}

const stars = computed(() => progress.stars(STAGE_ID))
const status = computed(() => message.value || `${earlier.value ? '' : '还没交卷。'}现在已经拿到 ${stars.value} / 3 颗星。`)
</script>

<template>
  <section class="seat" :aria-labelledby="titleId">
    <header class="seat__head">
      <span class="seat__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="seat__title">你来当 Agent</strong>
      <span class="seat__tag">模拟</span>
    </header>
    <p class="seat__rules">起点是 {{ describeConfig(SEAT_START) }}，觉得够好了就交卷。控制台列的三条，是给交出的参数打分的标准；这一关的三颗星，看页面开头的任务卡。</p>

    <AgentConsole v-model:actions="actions" :start="SEAT_START" :replay="false" mode="reader" @finish="onFinish" />

    <p v-if="earlier" class="seat__status">{{ earlier }}</p>
    <p class="seat__status" role="status">{{ status }}</p>

    <HintLadder :challenge="challenge" />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的挑战（1-12 的 ShiftBoard）。 */
.seat {
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

.seat__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.seat__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.seat__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.seat__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.seat__rules,
.seat__status {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

@media (max-width: 639px) {
  .seat {
    padding: 16px 14px;
  }
}
</style>
