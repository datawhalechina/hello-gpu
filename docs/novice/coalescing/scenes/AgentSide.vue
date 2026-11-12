<script setup lang="ts">
/**
 * 1-8 的 Agent 支线（06 第 3 节第 7 项；关卡自己的 scenes，不用登记组件）。
 *
 * AgentConsole（A-01）在 1000 道向量加法上调 block 和访问步长 stride，从「每组 32 个、步长 4」出发：
 * 先看规则 Agent 走一遍（看访存读到多搬了，就把步长改成 1）；再「你来当 Agent」交一次卷。
 * 交出的参数算对、不多搬（控制台的 ★2），支线完成，进度存档记一次 Agent 支线的经验值（04 第 2 节）。
 * 只交卷不算（challenge.ts 的 agentSideDone）；控制台本身不发经验值。
 */
import { computed, ref } from 'vue'
import AgentConsole from '@kit/AgentConsole.vue'
import type { Verdict } from '@course/agent/react.ts'
import { describeConfig } from '@course/agent/tasks.ts'
import { XP_AGENT_SIDE } from '@course/progress.ts'
import { useProgress } from '@course/useProgress.ts'
import { AGENT_START, STAGE_ID, agentSideDone } from '../challenge.ts'

const progress = useProgress()
/** 最近一次交卷（或走满步数）以后的那一句 */
const note = ref('')
const done = computed(() => progress.stage(STAGE_ID).agentSide)

function onFinish(summary: { verdict: Verdict | null }) {
  const v = summary.verdict
  if (!v) {
    note.value = '走满了步数，没有交卷。点「再来一次」，这回记得交卷。'
    return
  }
  const config = describeConfig(v.config)
  if (agentSideDone(v)) {
    progress.completeAgentSide(STAGE_ID)
    note.value = `你交的 ${config} 算对了，也不多搬：支线完成。`
    return
  }
  note.value = v.correct
    ? `你交的 ${config} 算对了，可搬的车比理想多。点「再来一次」，换一组参数再交。`
    : `你交的 ${config} 没有算对。点「再来一次」，先运行确认结果对，再交卷。`
}
</script>

<template>
  <div class="as">
    <p class="as__rule">
      先看规则 Agent 走一遍，再点「你来当 Agent」自己试。交出的参数算对、不多搬（控制台的第 2 颗星），支线就完成了，加 {{ XP_AGENT_SIDE }} 经验值。周期数是模拟器估的示意时间，怎样在真卡上量，后面的关卡再讲。
    </p>
    <AgentConsole :start="AGENT_START" @finish="onFinish" />
    <p class="as__status" aria-live="polite">
      {{ note || (done ? '支线已完成：你交过一组算对、不多搬的参数。' : '') }}
    </p>
  </div>
</template>

<style scoped>
.as {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 20px 0;
}

.as__rule {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.as__status {
  min-height: 1.6em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}
</style>
