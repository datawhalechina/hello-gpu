<script setup lang="ts">
/**
 * 1-11 的 Agent 支线（06 第 3 节第 7 项；关卡自己的 scenes，不用登记组件）：Agent 会不会被测错的时间骗到？
 *
 * Agent 调 A-01 的向量加法（1000 道，每组 32 个线程）：从起点步长 4 出发，四种步长各量一次，交量出来最快的那组，
 * 比手上最快的还快才换。只开放一个旋钮：Agent 的计时工具怎么写（不同步就看表 / 同步了没预热 / 预热、停表前同步），
 * 默认是会骗人的那种。旋钮一换，日志、Agent 交的那组和它拿到的星（A-01 的三星标准）马上跟着变。
 * 每一步写成 AgentConsole 的样子：行动（工具和参数）→ 观察（Agent 读到的数）；旁边一列是 GPU 上真正算的，
 * 模拟器知道，Agent 看不到。
 * 读者给 Agent 换上「预热、停表前同步」，Agent 交出三星的那组，支线完成，进度存档记一次 Agent 支线的经验值
 * （04 第 2 节，challenge.ts 的 agentSideDone）。
 */
import { computed, ref, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { formatAction, starText } from '@course/agent/react.ts'
import { XP_AGENT_SIDE } from '@course/progress.ts'
import { useProgress } from '@course/useProgress.ts'
import { ADD_BLOCK, AGENT_TIMERS, DEFAULT_AGENT_TIMER, STAGE_ID, agentRun, agentSideDone, type AgentTimer } from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const timer = ref<AgentTimer>(DEFAULT_AGENT_TIMER)
const run = computed(() => agentRun(timer.value))
const done = computed(() => progress.stage(STAGE_ID).agentSide)

watch(run, (r) => {
  if (agentSideDone(r)) progress.completeAgentSide(STAGE_ID)
})

const steps = computed(() => run.value.rows.map((row, i) => ({
  n: i + 1,
  action: formatAction({ tool: 'measure', args: { block: ADD_BLOCK, stride: row.stride } }),
  seen: `${row.reading} 个周期`,
  truth: row.truth,
})))
const finish = computed(() => formatAction({ tool: 'finish', args: { block: ADD_BLOCK, stride: run.value.pick } }))
</script>

<template>
  <section class="at" :aria-labelledby="titleId">
    <header class="at__head">
      <span class="at__eyebrow" aria-hidden="true">AGENT</span>
      <strong :id="titleId" class="at__title">给 Agent 一块表</strong>
      <span class="at__tag">模拟</span>
    </header>
    <p class="at__rules">
      Agent 从步长 4 出发，把步长 4、1、2、8 各量一次，交量出来最快的那组：比手上最快的还快才换。
      它只读得到计时工具交回来的数。给它换一种计时工具，看它交哪一组。换成量得准的那种，支线就完成了，加 {{ XP_AGENT_SIDE }} 经验值。
    </p>

    <div class="at__knob">
      <Knob v-model="timer" label="Agent 的计时工具" :options="AGENT_TIMERS" />
    </div>

    <table class="at-log">
      <caption>Agent 这一轮（周期数都是模拟）</caption>
      <thead>
        <tr><th scope="col">步</th><th scope="col">行动</th><th scope="col">观察：Agent 读到的</th><th scope="col">GPU 上算了</th></tr>
      </thead>
      <tbody>
        <tr v-for="s in steps" :key="s.n">
          <td class="is-num">{{ s.n }}</td>
          <td><code>{{ s.action }}</code></td>
          <td class="is-num">{{ s.seen }}</td>
          <td class="is-num">{{ s.truth }}</td>
        </tr>
        <tr class="is-finish">
          <td class="is-num">{{ steps.length + 1 }}</td>
          <td><code>{{ finish }}</code></td>
          <td colspan="2"><span aria-hidden="true">{{ starText(run.earned) }}</span><span class="at__sr">{{ run.earned.filter(Boolean).length }} 颗星</span></td>
        </tr>
      </tbody>
    </table>

    <p class="at__thought"><span class="at__badge">思考</span>{{ run.thought }}</p>
    <p class="at__note" aria-live="polite">{{ run.note }}</p>
    <p v-if="done" class="at__status">支线已完成：你给 Agent 换上了量得准的计时工具。</p>
  </section>
</template>

<style scoped>
.at {
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

.at__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.at__eyebrow {
  color: var(--hg-violet-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.at__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.at__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.at__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.at__knob {
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* 日志表：.hg-prose 的表格样式之外，数字右对齐、等宽；行动写成函数调用（同 AgentConsole）。 */
.at-log {
  margin: 0;
}

.at-log caption {
  padding-bottom: 6px;
  color: var(--hg-ink-3);
  font-size: 13px;
  text-align: left;
}

.at-log .is-num {
  font-family: var(--hg-font-mono);
  text-align: right;
  white-space: nowrap;
}

.at-log code {
  overflow-wrap: anywhere;
}

.at-log tr.is-finish td {
  font-weight: 700;
}

.at__thought {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 0;
  font-size: 15px;
}

.at__badge {
  padding: 1px 8px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  box-shadow: inset 0 0 0 1px var(--hg-border-strong);
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.at__note {
  min-height: 3.2em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

/* 只给读屏读：星级的字数（★☆☆ 读出来没有意义）。 */
.at__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.at__status {
  min-height: 0;
  margin: 0;
  color: var(--hg-accent-ink);
  font-size: 15px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .at {
    padding: 16px 14px;
  }

  .at__knob {
    padding: 12px 10px;
  }

  .at-log th,
  .at-log td {
    padding: 6px 6px;
    font-size: 13px;
  }
}
</style>
