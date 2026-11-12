<script setup lang="ts">
/**
 * Boss 的成绩单（关卡自己的 scenes，不用登记组件）：几道分题最近一次的结果，和本关三颗星各差什么。
 * 分题的结果是 useBoss 的 state（存在本关草稿槽里），星是进度存档里已经拿到的（任务卡上同一份）。
 * 挂载以后才读草稿和存档：服务端渲染时按一道都没做画，水合前后一致。
 */
import { computed, useId } from 'vue'
import { useProgress } from '@course/useProgress.ts'
import { STAGE_ID, STAR_LABELS, boardRows, judge } from '../challenge.ts'
import type { Boss } from './useBoss.ts'

const props = defineProps<{
  /** 本关的三颗星（页面上 useBoss 的返回值） */
  boss: Boss
}>()

const progress = useProgress()
const titleId = `${useId()}-title`

const rows = computed(() => boardRows(props.boss.state.value))
const verdict = computed(() => judge(props.boss.state.value))
const stars = computed(() => STAR_LABELS.map((label, i) => {
  const got = progress.stage(STAGE_ID).stars.includes(i)
  const now = verdict.value.earned[i]
  let text = '还没达到'
  if (got) text = '已拿到'
  else if (now && !verdict.value.earned[0]) text = '达到了，等第一颗星一起发'
  else if (now) text = `看过答案，这一关最多记 ${progress.starCap(STAGE_ID)} 颗星`
  return { label, got, text }
}))
</script>

<template>
  <section class="bb" :aria-labelledby="titleId">
    <header class="bb__head">
      <span class="bb__eyebrow" aria-hidden="true">REPORT</span>
      <strong :id="titleId" class="bb__title">毕业考成绩单</strong>
    </header>

    <ul class="bb__rows" aria-label="每道题最近一次的结果">
      <li v-for="row in rows" :key="row.key" class="bb__row" :class="{ 'is-done': row.done }">
        <span class="bb__mark" aria-hidden="true">{{ row.done ? '✓' : '·' }}</span>
        <span class="bb__name">{{ row.name }}</span>
        <span class="bb__status">{{ row.status }}</span>
      </li>
    </ul>

    <ol class="bb__stars" aria-label="本关三颗星">
      <li v-for="(s, i) in stars" :key="i" class="bb__star" :class="{ 'is-got': s.got }">
        <span class="bb__star-icon" aria-hidden="true">{{ s.got ? '★' : '☆' }}</span>
        <span class="bb__star-label">{{ s.label }}</span>
        <span class="bb__star-text">{{ s.text }}</span>
      </li>
    </ol>

    <p class="bb__next" aria-live="polite">{{ verdict.next }}</p>
  </section>
</template>

<style scoped>
.bb {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 20px 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.bb__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.bb__eyebrow {
  color: var(--hg-amber-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.bb__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.bb__rows,
.bb__stars {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bb__row {
  display: grid;
  grid-template-columns: 1.2em 12em 1fr;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.bb__mark {
  color: var(--hg-ink-3);
  font-weight: 700;
  text-align: center;
}

.bb__row.is-done .bb__mark {
  color: var(--hg-accent-ink);
}

.bb__name {
  font-weight: 600;
}

.bb__status {
  color: var(--hg-ink-2);
  font-size: 15px;
}

.bb__row.is-done .bb__status {
  color: var(--hg-accent-ink);
}

.bb__star {
  display: grid;
  grid-template-columns: 1.2em 1fr auto;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0;
  font-size: 15px;
}

.bb__star-icon {
  color: var(--hg-ink-3);
  text-align: center;
}

.bb__star.is-got .bb__star-icon {
  color: var(--hg-amber);
}

.bb__star-text {
  color: var(--hg-ink-3);
  font-size: 13px;
  white-space: nowrap;
}

.bb__star.is-got .bb__star-text {
  color: var(--hg-amber-ink);
}

.bb__next {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .bb {
    padding: 16px 14px;
  }

  .bb__row {
    grid-template-columns: 1.2em 1fr;
  }

  .bb__status {
    grid-column: 2;
  }

  .bb__star {
    grid-template-columns: 1.2em 1fr;
  }

  .bb__star-text {
    grid-column: 2;
    white-space: normal;
  }
}
</style>
