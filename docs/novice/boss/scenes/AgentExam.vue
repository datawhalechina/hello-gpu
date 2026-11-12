<script setup lang="ts">
/**
 * Boss 挑战二「让你的 Agent 调到三星」（关卡自己的 scenes，不用登记组件）。
 *
 * AgentCode（A-02，全局注册的异步组件），起点 block 16、步长 8（1-13、1-14 都没从这里出发过）。
 * 三个空先接你在第 1-14 关补的（那一关的草稿槽，挂载以后读一次）；那一关没补过，就是模板的初始内容。
 * 在这里改过以后存进本关这道分题的草稿，刷新不丢；不自动运行（运行要下载 Python）。
 * judgeAgent 判这道分题过没过（useChallenge 的 part：记次数、给提示，看答案以后本关最高 2 星，不发星），
 * 再把「交出三星参数没有」报给本关（useBoss），第三颗星由本关合起来发。
 * 代码出错时 AgentCode 自己写出了这次的问题（带行号和 Python 的原文），这里不再交给 HintLadder 重复一遍（同 1-14）。
 */
import { computed, onMounted, ref, useId } from 'vue'
import HintLadder from '@kit/HintLadder.vue'
import { describeConfig } from '@course/agent/tasks.ts'
import { loadDraftSlot } from '@course/storage.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { progressStorage, useProgress } from '@course/useProgress.ts'
import { AGENT_HINTS, AGENT_START, FIRST_AGENT_DRAFT, STAGE_CODES, STAGE_ID, agentValues, judgeAgent, type AgentRun } from '../challenge.ts'
import type { Boss } from './useBoss.ts'

const props = defineProps<{
  /** 本关的三颗星（页面上 useBoss 的返回值）：跑完以后报给它 */
  boss: Boss
}>()

const progress = useProgress()
const titleId = `${useId()}-title`
const challenge = useChallenge({ stage: STAGE_ID, id: 'agent', kind: 'part', hints: AGENT_HINTS })

/** 第 1-14 关补的三个空（那一关的草稿槽里，挑战 id 是 bench）：挂载以后读一次。 */
const carried = ref<Record<string, string> | null>(null)
onMounted(() => {
  progress.ensureLoaded()
  const record = loadDraftSlot(progressStorage(), FIRST_AGENT_DRAFT.stage, progress.demo.value)[FIRST_AGENT_DRAFT.id]
  carried.value = agentValues(record && typeof record === 'object' && 'draft' in record ? record.draft : null)
})

/** 读者在这里改过的三个空；没改过是 null，用第 1-14 关的。 */
const own = computed(() => agentValues(challenge.draft.value))
const values = computed<Record<string, string>>({
  get: () => own.value ?? carried.value ?? {},
  set: (next) => {
    challenge.draft.value = { values: next }
  },
})
const origin = computed(() => {
  if (own.value) return '三个空是你在这一关改过的。'
  if (carried.value) return `三个空已经换成你在第 ${STAGE_CODES.firstAgent} 关补的：直接运行，看你的 Agent 从新起点出发调得怎样。`
  return `你还没在第 ${STAGE_CODES.firstAgent} 关补过这三个空，下面是模板的初始内容：照那一关学的补上。`
})

const message = ref('')
/** Python 没加载出来的原因 */
const fallback = ref('')

function onResult(r: AgentRun) {
  fallback.value = ''
  const run: AgentRun = { stop: r.stop, verdict: r.verdict, error: r.error, log: r.log }
  const verdict = judgeAgent(run)
  // 代码出错：AgentCode 已经写出这次的问题（行号、原文、跳到那一行），提示阶梯只记次数、给提示
  const outcome = challenge.attempt(r.stop === 'error' ? { earned: verdict.earned, next: verdict.next } : verdict)
  props.boss.report({ agent: outcome.passed })
  if (outcome.passed) {
    message.value = `过了：${verdict.next}`
    return
  }
  const where = r.stop === 'error' ? '代码下面的「这次的问题」写了原因和怎么改。' : '看下面的「这次的问题」。'
  message.value = `没过：${verdict.error?.symptom ?? ''}${where}没过不扣经验值，改好了再运行。`
}

function onFallback(reason: string) {
  fallback.value = reason
}

const status = computed(() => {
  if (message.value) return message.value
  if (fallback.value) {
    return `Python 没有加载出来（${fallback.value}）：第三颗星要等你的 Agent 真的跑起来才能拿。上面放的是规则 Agent 的一轮，三个空补对以后你的 Agent 每一步都和它一样。`
  }
  return props.boss.state.value.agent ? '上一次运行，你的 Agent 交出了三星参数。' : '还没运行。'
})
</script>

<template>
  <section class="ax" :aria-labelledby="titleId">
    <header class="ax__head">
      <span class="ax__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="ax__title">你的 Agent：从新起点出发</strong>
      <span class="ax__tag">模拟</span>
    </header>
    <p class="ax__rules">
      起点是 {{ describeConfig(AGENT_START) }}。{{ origin }}下面卡片里列的三条，是控制台给交出的参数打分的标准：三条都达到，这道题就过了。
    </p>

    <AgentCode v-model:values="values" :start="AGENT_START" @result="onResult" @fallback="onFallback" />

    <p class="ax__status" role="status">{{ status }}</p>

    <HintLadder :challenge="challenge" />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同 1-14 的挑战（AgentBench）。 */
.ax {
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

.ax__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ax__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ax__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ax__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.ax__rules,
.ax__status {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.ax__status {
  color: var(--hg-ink);
}

/* AgentCode 自己有 20px 的上下外边距，卡片里用 gap 隔开就够了 */
.ax :deep(.hg-agentcode) {
  margin: 0;
}

@media (max-width: 639px) {
  .ax {
    padding: 16px 14px;
  }
}
</style>
