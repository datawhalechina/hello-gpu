<script setup lang="ts">
/**
 * 1-14 探索二「两条规则」（关卡自己的 scenes，不用登记组件）。
 *
 * 两个开关（Knob）：规则一「多搬了，就把步长改成 1」、规则二「block 不是 32 的倍数，就往上取到 32 的倍数」，默认都关（能跑但不好）。
 * Agent 从挑战的起点 block 48、步长 4 出发，照模板的样子一圈一圈走：每圈运行、计时、看访存（3 步），再照开着的规则改，
 * 没有能改的就交卷。challenge.ts 的 ruleWalk 是读者那份 Python 模板的 JS 双胞胎（单测拿 Pyodide 跑真的模板逐个核对）：
 * 规则一开着就是第 1、2 个空填对，规则二开着就是第 3 个空填对。
 * 走过的格子在搜索空间表（SpaceGrid）上写着第几圈，起点、交卷写成角标；上面一句（walkText）写试了几组、第几步交卷、
 * 为什么还不是三星。开关一拨马上重算（纯函数，不跑模拟器）。不判星，不存草稿，刷新回到默认。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { configKey, describeConfig } from '@course/agent/tasks.ts'
import { ruleWalk, START, WAVE, walkText, type GridCell } from '../challenge.ts'
import SpaceGrid from './SpaceGrid.vue'

const titleId = `${useId()}-title`
/** 第几圈：①②③…（一轮最多 15 步，最多 5 圈） */
const ROUND_MARKS = ['①', '②', '③', '④', '⑤']

const strideRule = ref(false)
const blockRule = ref(false)
const walk = computed(() => ruleWalk(START, { stride: strideRule.value, block: blockRule.value }))
const readout = computed(() => walkText(walk.value))
const route = computed(() => walk.value.path.map(describeConfig).join(' → '))

const cells = computed(() => {
  const w = walk.value
  const out: Record<string, GridCell> = {}
  w.path.forEach((c, i) => {
    const last = i === w.path.length - 1
    const finished = last && w.verdict !== null
    const full = finished && w.verdict!.earned.every(Boolean)
    const tag = finished ? '交卷' : i === 0 ? '起点' : undefined
    out[configKey(c)] = {
      text: ROUND_MARKS[i] ?? String(i + 1),
      label: `第 ${i + 1} 圈：${describeConfig(c)}${i === 0 ? '（起点）' : ''}${finished ? '，在这里交卷' : ''}`,
      tone: full ? 'good' : 'path',
      tag,
    }
  })
  return out
})
</script>

<template>
  <section class="rl" :aria-labelledby="titleId">
    <header class="rl__head">
      <span class="rl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="rl__title">两条规则</strong>
      <span class="rl__tag">模拟</span>
    </header>
    <p class="rl__rules">Agent 从 {{ describeConfig(START) }} 出发：每一圈运行、计时、看访存，再照它会的规则改参数；没有能改的，就交卷。拨开关，教它规则或者收回去。</p>

    <div class="rl__knobs">
      <Knob v-model="strideRule" mode="switch" label="规则一：多搬了，就把步长改成 1" on="会" off="不会" />
      <Knob v-model="blockRule" mode="switch" :label="`规则二：block 不是 ${WAVE} 的倍数，就往上取到 ${WAVE} 的倍数`" on="会" off="不会" />
    </div>

    <p class="rl__readout" aria-live="polite">{{ readout }}</p>
    <p class="rl__route"><span class="rl__badge">走过</span>{{ route }}</p>

    <SpaceGrid :cells="cells" :caption="`Agent 从 ${describeConfig(START)} 出发，每一圈停在哪组参数`" />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的探索（1-13 的 PathLab）。 */
.rl {
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

.rl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.rl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.rl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.rl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.rl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.rl__knobs {
  display: grid;
  gap: 14px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .rl__knobs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.rl__readout {
  min-height: 1.6em;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.rl__route {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.7;
}

/* 「走过」标签同 1-13 PathLab 的「思考」：虚线框 */
.rl__badge {
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
  .rl {
    padding: 16px 14px;
  }
}
</style>
