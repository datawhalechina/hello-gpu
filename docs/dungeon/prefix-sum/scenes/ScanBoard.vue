<script setup lang="ts">
/**
 * 副本「前缀和入门」的货架板（副本自己的 scenes，不用登记组件）：沙盒结果插槽里用，画派 64 个线程的那一次。
 *
 * 上面是货架上的前 blockDim.x 格，下面是 out。数从模拟器的事件流重算（challenge.ts 的 scanBoard）：放了的格子写着现在的数，
 * 取到了别人这一轮已经加过的数的格子标「!」，out 里不对的格子标「✗」。单步时描出这一步取的、放的、存的格子，
 * 再写一句这一步是哪支小队、第几轮、取了哪几格（stepStory）。格子只是看的，不能点；读屏读每一块上面那一行的统计。
 */
import { computed } from 'vue'
import type { Launch, SandboxStep } from '@kit/sandbox/run.ts'
import type { Arg, RunResult } from '@sim/lockstep.ts'
import { WAVE, scanBoard, spans, stepStory } from '../challenge.ts'

const props = withDefaults(defineProps<{
  result: RunResult | null
  launch: Launch
  args: Record<string, Arg>
  /** 沙盒单步走到的这一步；看整段是 null */
  step?: SandboxStep | null
  emptyText?: string
}>(), { step: null, emptyText: '还没运行。' })

const board = computed(() => {
  const r = props.result
  if (!r) return null
  return props.step ? scanBoard(r, props.launch, props.args, props.step.group.to, props.step.group.from) : scanBoard(r, props.launch, props.args)
})
const story = computed(() => (props.result && props.step ? stepStory(props.result, props.step.index) : ''))

/** 32 格一段：一段正好是一支小队的人数，两行。 */
function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = []
  for (let k = 0; k < list.length; k += WAVE) out.push(list.slice(k, k + WAVE))
  return out
}
const slotParts = computed(() => chunks(board.value?.slots ?? []))
const outParts = computed(() => chunks(board.value?.out ?? []))

const shelfStat = computed(() => {
  const b = board.value
  if (!b) return ''
  const filled = b.slots.filter((s) => s.filled).length
  const stale = b.slots.filter((s) => s.stale).map((s) => s.index)
  const taken = b.slots.filter((s) => s.taken).map((s) => s.index)
  const put = b.slots.filter((s) => s.put).map((s) => s.index)
  const parts = [filled ? `放了 ${filled} 格` : '还是空的']
  if (taken.length) parts.push(`这一步取了第 ${spans(taken)} 格`)
  if (put.length) parts.push(`这一步放了第 ${spans(put)} 格`)
  if (stale.length) parts.push(`第 ${spans(stale)} 格被取的时候，这一轮已经加过了（标「!」）`)
  if (!b.exact) parts.push('你的写法重算不出每一格的数，格子里不写数')
  return `${parts.join('；')}。`
})

const outStat = computed(() => {
  const b = board.value
  if (!b) return ''
  const written = b.out.filter((c) => c.state !== 'blank')
  if (!written.length) return '还一格都没存。'
  const wrong = b.out.filter((c) => c.state === 'wrong').map((c) => c.index)
  const now = b.out.filter((c) => c.now).map((c) => c.index)
  const parts = [`存了 ${written.length} 格`, wrong.length ? `${wrong.length} 格不对（${spans(wrong, (v) => `out[${v}]`)}）` : '都对']
  if (now.length) parts.push(`这一步存了 ${spans(now, (v) => `out[${v}]`)}`)
  return `${parts.join('，')}。`
})
</script>

<template>
  <div class="sc">
    <p v-if="!result || !board" class="sc__empty">{{ emptyText }}</p>
    <template v-else>
      <p v-if="story" class="sc__story">{{ story }}</p>

      <section class="sc__part" aria-label="货架（LDS）">
        <p class="sc__title">货架（LDS）：第 0～{{ launch.block - 1 }} 格</p>
        <p class="sc__stat">{{ shelfStat }}</p>
        <div v-for="(part, k) in slotParts" :key="k" class="sc__chunk" aria-hidden="true">
          <span class="sc__chunk-label">第 {{ k * WAVE }}～{{ k * WAVE + part.length - 1 }} 格（小队 {{ k }}）</span>
          <div class="sc__cells">
            <span
              v-for="s in part"
              :key="s.index"
              class="sc__cell"
              :class="{ 'is-filled': s.filled, 'is-empty': !s.filled, 'is-stale': s.stale, 'is-now': s.put || s.taken }"
            >{{ s.filled ? s.value ?? '' : '' }}</span>
          </div>
        </div>
      </section>

      <section class="sc__part" aria-label="out">
        <p class="sc__title">out：out[0]～out[{{ launch.block - 1 }}]</p>
        <p class="sc__stat">{{ outStat }}</p>
        <div v-for="(part, k) in outParts" :key="k" class="sc__chunk" aria-hidden="true">
          <span class="sc__chunk-label">out[{{ part[0].index }}]～[{{ part[part.length - 1].index }}]</span>
          <div class="sc__cells">
            <span v-for="c in part" :key="c.index" class="sc__cell" :class="[`is-${c.state}`, { 'is-now': c.now }]">{{ c.value ?? '' }}</span>
          </div>
        </div>
      </section>

      <ul class="sc__legend" aria-label="图例">
        <li><span class="sc__sw is-empty" aria-hidden="true" />还没放</li>
        <li><span class="sc__sw is-filled" aria-hidden="true" />放了（写着现在的数）</li>
        <li><span class="sc__sw is-stale" aria-hidden="true" />被取时这一轮已经加过了</li>
        <li><span class="sc__sw is-wrong" aria-hidden="true" />out 不对</li>
        <li v-if="step"><span class="sc__sw is-now" aria-hidden="true" />这一步取、放、存的格子</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
/* 同 1-9 的货架板（ShelfBoard）：一行 16 格，一段 32 格是一支小队的人数。 */
.sc {
  --blk: var(--hg-group-0);
  --blk-soft: var(--hg-group-0-soft);

  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  container-type: inline-size;
}

.sc__empty {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.sc__story {
  margin: 0;
  padding: 8px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-size: 13px;
}

.sc__part {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sc__title {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.sc__stat {
  margin: 0;
  color: var(--hg-ink);
  font-size: 13px;
}

.sc__chunk {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sc__chunk-label {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

.sc__cells {
  display: grid;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 2px;
  max-width: calc(16 * 30px + 15 * 2px);
}

.sc__cell {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  min-width: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    border-color var(--motion-fast) var(--motion-ease-out);
}

@container (min-width: 520px) {
  .sc__cell {
    font-size: 11px;
  }
}

.sc__cell.is-empty,
.sc__cell.is-blank {
  border-style: dashed;
  background: transparent;
}

.sc__cell.is-filled {
  border-color: var(--blk);
  background: var(--blk-soft);
}

/* 被取时已经加过、out 不对：红框 + 角上的记号（不只靠颜色） */
.sc__cell.is-stale,
.sc__cell.is-wrong {
  border-style: solid;
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
}

.sc__cell.is-stale::after,
.sc__cell.is-wrong::after {
  position: absolute;
  top: 0;
  right: 1px;
  color: var(--hg-error-ink);
  font-size: 7px;
  line-height: 1;
}

.sc__cell.is-stale::after {
  content: '!';
}

.sc__cell.is-wrong::after {
  content: '✗';
}

/* 这一步取的、放的、存的格子：描一圈强调色 */
.sc__cell.is-now {
  z-index: 1;
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 0;
}

.sc__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.sc__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

.sc__sw {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background: var(--hg-surface);
}

.sc__sw.is-empty {
  border-style: dashed;
  background: transparent;
}

.sc__sw.is-filled {
  border-color: var(--blk);
  background: var(--blk-soft);
}

.sc__sw.is-stale,
.sc__sw.is-wrong {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
}

.sc__sw.is-now {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: -1px;
}

@media (max-width: 479px) {
  .sc {
    padding: 10px;
  }
}
</style>
