<script setup lang="ts">
/**
 * 1-9 的货架板（关卡自己的 scenes，不用登记组件）：两段实验台和挑战沙盒的结果插槽共用。
 *
 * 一次画一组（block）：上面是这一组在货架上的 64 格，下面是这一组要存的 out。数从模拟器的事件流算出来
 * （challenge.ts 的 shelfBoard）：放了的格子写着放上去的数，空着的画虚线框；没放好就被取的格子标「!」（取早了），
 * out 里不对的格子标「✗」。单步时标出这一步放的、取的、存的格子，下面一行写这一组每支小队走到哪了（squadsAt）；
 * 单步跟着这一步的组走，看整段时派了好几组就可以换着看。格子只是看的，不能点；读屏读每一块上面那一行的统计。
 */
import { computed, ref, watch } from 'vue'
import { stepGroups, type Launch } from '@kit/sandbox/run.ts'
import type { RunResult } from '@sim/lockstep.ts'
import { SHELF, WAVE, shelfBoard, spanText, squadsAt } from '../challenge.ts'

const props = withDefaults(defineProps<{
  result: RunResult | null
  launch: Launch
  /** 走完了几步：null 是看整段（不标这一步）；0 是还没开始 */
  upto: number | null
  emptyText?: string
}>(), { emptyText: '还没运行。' })

const groups = computed(() => (props.result ? stepGroups(props.result.events) : []))
/** 这一步（stepGroups 的下标）；看整段、还没开始时是 -1 */
const current = computed(() => (props.upto !== null && props.upto > 0 ? Math.min(props.upto, groups.value.length) - 1 : -1))

const boards = computed(() => {
  const r = props.result
  if (!r) return []
  if (props.upto === null) return shelfBoard(r, props.launch)
  const g = groups.value[current.value]
  return g ? shelfBoard(r, props.launch, g.to, g.from) : shelfBoard(r, props.launch, 0)
})

/** 看整段时选的组：换一次运行，就先看第一个有错的组。 */
const picked = ref(0)
watch(() => props.result, (result) => {
  const all = result ? shelfBoard(result, props.launch) : []
  picked.value = Math.max(0, all.findIndex((b) => b.wrong > 0))
}, { immediate: true })
const shown = computed(() => (current.value >= 0 ? groups.value[current.value].block : picked.value))
const board = computed(() => boards.value[shown.value] ?? null)
const squads = computed(() => (props.result && current.value >= 0 ? squadsAt(props.result, props.launch, current.value) : []))

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
  const filled = b.slots.filter((s) => s.filled).map((s) => s.index)
  const early = b.slots.filter((s) => s.early).map((s) => s.index)
  const put = b.slots.filter((s) => s.put).map((s) => s.index)
  const taken = b.slots.filter((s) => s.taken).map((s) => s.index)
  const parts = [filled.length ? `放好了 ${filled.length} 格（第 ${spanText(filled)} 格）` : '还是空的']
  if (put.length) parts.push(`这一步放了第 ${spanText(put)} 格`)
  if (taken.length) parts.push(`这一步取了第 ${spanText(taken)} 格`)
  if (early.length) parts.push(`第 ${spanText(early)} 格没放好就被取了`)
  return `${parts.join('；')}。`
})

const outStat = computed(() => {
  const b = board.value
  if (!b) return ''
  const written = b.out.filter((c) => c.state !== 'blank')
  if (!written.length) return '还一格都没存。'
  const wrong = b.out.filter((c) => c.state === 'wrong').map((c) => c.index)
  const now = b.out.filter((c) => c.now).map((c) => c.index)
  const parts = [`存了 ${written.length} 格`, wrong.length ? `${wrong.length} 格不对（${spanText(wrong, (v) => `out[${v}]`)}）` : '都对']
  if (now.length) parts.push(`这一步存了 ${spanText(now, (v) => `out[${v}]`)}`)
  return `${parts.join('，')}。`
})

/** 三位数的格子字小一点。 */
const wide = computed(() => (props.launch.grid * props.launch.block) > 99)

const MARK = { idle: '·', running: '▶', waiting: '‖', ready: '…', done: '✓' } as const
const groupStyle = computed(() => ({ '--blk': `var(--hg-group-${shown.value % 6})`, '--blk-soft': `var(--hg-group-${shown.value % 6}-soft)` }))
</script>

<template>
  <div class="sb" :style="groupStyle">
    <p v-if="!result" class="sb__empty">{{ emptyText }}</p>
    <template v-else-if="board">
      <div v-if="launch.grid > 1" class="sb__pick" role="group" aria-label="看哪一组的货架">
        <button
          v-for="b in boards"
          :key="b.block"
          type="button"
          class="sb__pick-button"
          :aria-pressed="b.block === shown"
          :disabled="current >= 0"
          @click="picked = b.block"
        >block {{ b.block }}<span v-if="b.wrong" class="sb__pick-bad">：{{ b.wrong }} 格不对</span></button>
        <span v-if="current >= 0" class="sb__pick-note">单步时跟着这一步的组</span>
      </div>

      <section class="sb__part" :aria-label="`${launch.grid > 1 ? `block ${shown} 的` : ''}货架（LDS）`">
        <p class="sb__title">{{ launch.grid > 1 ? `block ${shown} 的` : '' }}货架（LDS）：{{ SHELF }} 格</p>
        <p class="sb__stat">{{ shelfStat }}</p>
        <div v-for="(part, k) in slotParts" :key="k" class="sb__chunk" aria-hidden="true">
          <span class="sb__chunk-label">第 {{ k * WAVE }}～{{ k * WAVE + part.length - 1 }} 格</span>
          <div class="sb__cells" :class="{ 'is-wide': wide }">
            <span
              v-for="s in part"
              :key="s.index"
              class="sb__cell"
              :class="{ 'is-filled': s.filled, 'is-empty': !s.filled, 'is-early': s.early, 'is-put': s.put, 'is-taken': s.taken }"
            >{{ s.filled ? s.value ?? '?' : '' }}</span>
          </div>
        </div>
      </section>

      <section class="sb__part" :aria-label="`${launch.grid > 1 ? `block ${shown} 的` : ''} out`">
        <p class="sb__title">{{ launch.grid > 1 ? `block ${shown} 存的 ` : '' }}out：out[{{ board.out[0].index }}]～out[{{ board.out[board.out.length - 1].index }}]</p>
        <p class="sb__stat">{{ outStat }}</p>
        <div v-for="(part, k) in outParts" :key="k" class="sb__chunk" aria-hidden="true">
          <span class="sb__chunk-label">out[{{ part[0].index }}]～[{{ part[part.length - 1].index }}]</span>
          <div class="sb__cells" :class="{ 'is-wide': wide }">
            <span v-for="c in part" :key="c.index" class="sb__cell" :class="[`is-${c.state}`, { 'is-now': c.now }]">{{ c.value ?? '' }}</span>
          </div>
        </div>
      </section>

      <ul v-if="squads.length" class="sb__squads" aria-label="这一组的小队走到哪了">
        <li v-for="s in squads" :key="s.wave" class="sb__squad" :class="`is-${s.status}`">
          <span class="sb__squad-mark" aria-hidden="true">{{ MARK[s.status] }}</span>
          <span>小队 {{ s.wave }}（线程 {{ s.first }}～{{ s.last }}）：{{ s.text }}</span>
        </li>
      </ul>

      <ul class="sb__legend" aria-label="图例">
        <li><span class="sb__sw is-empty" aria-hidden="true" />空着</li>
        <li><span class="sb__sw is-filled" aria-hidden="true" />放好了（写着放的数）</li>
        <li><span class="sb__sw is-early" aria-hidden="true" />没放好就被取了</li>
        <li><span class="sb__sw is-wrong" aria-hidden="true" />out 不对</li>
        <li><span class="sb__sw is-now" aria-hidden="true" />这一步放、取、存的格子</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.sb {
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

.sb__empty {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.sb__pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}

.sb__pick-button {
  min-height: 34px;
  padding: 0 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.sb__pick-button[aria-pressed='true'] {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.sb__pick-button:disabled {
  cursor: default;
}

.sb__pick-button:disabled:not([aria-pressed='true']) {
  opacity: 0.5;
}

.sb__pick-button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.sb__pick-bad {
  font-weight: 500;
}

.sb__pick-note {
  color: var(--hg-ink-3);
  font-size: 12px;
}

.sb__part {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sb__title {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.sb__stat {
  margin: 0;
  color: var(--hg-ink);
  font-size: 13px;
}

.sb__chunk {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.sb__chunk-label {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

/* 一行 16 格：一段 32 格（一支小队的人数）正好两行。格子是正方形，宽屏时不超过 30px。 */
.sb__cells {
  display: grid;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 2px;
  max-width: calc(16 * 30px + 15 * 2px);
}

.sb__cell {
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

.sb__cells.is-wide .sb__cell {
  font-size: 8px;
  letter-spacing: -0.04em;
}

@container (min-width: 520px) {
  .sb__cell {
    font-size: 11px;
  }

  .sb__cells.is-wide .sb__cell {
    font-size: 10px;
  }
}

/* 货架的格子：空着是虚线框，放好了铺这一组的分类色（01 第 2.3 节：分类色只分组，不表示对错） */
.sb__cell.is-empty,
.sb__cell.is-blank {
  border-style: dashed;
  background: transparent;
}

.sb__cell.is-filled {
  border-color: var(--blk);
  background: var(--blk-soft);
}

/* 没放好就被取了、out 不对：红框 + 角上的记号（不只靠颜色） */
.sb__cell.is-early,
.sb__cell.is-wrong {
  border-style: solid;
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
}

.sb__cell.is-early::after,
.sb__cell.is-wrong::after {
  position: absolute;
  top: 0;
  right: 1px;
  color: var(--hg-error-ink);
  font-size: 7px;
  line-height: 1;
}

.sb__cell.is-early::after {
  content: '!';
}

.sb__cell.is-wrong::after {
  content: '✗';
}

/* 这一步放的、取的、存的格子：描一圈强调色 */
.sb__cell.is-put,
.sb__cell.is-taken,
.sb__cell.is-now {
  z-index: 1;
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 0;
}

.sb__squads {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 8px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface);
  font-size: 13px;
  list-style: none;
}

.sb__squad {
  display: flex;
  gap: 8px;
  margin: 0;
}

.sb__squad-mark {
  flex: none;
  width: 1.2em;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-weight: 700;
  text-align: center;
}

.sb__squad.is-running .sb__squad-mark {
  color: var(--hg-accent-ink);
}

.sb__squad.is-waiting .sb__squad-mark {
  color: var(--hg-amber-ink);
}

.sb__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.sb__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

.sb__sw {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background: var(--hg-surface);
}

.sb__sw.is-empty {
  border-style: dashed;
  background: transparent;
}

.sb__sw.is-filled {
  border-color: var(--blk);
  background: var(--blk-soft);
}

.sb__sw.is-early,
.sb__sw.is-wrong {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
}

.sb__sw.is-now {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: -1px;
}

@media (max-width: 479px) {
  .sb {
    padding: 10px;
  }
}
</style>
