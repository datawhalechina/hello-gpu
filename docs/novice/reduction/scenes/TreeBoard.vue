<script setup lang="ts">
/**
 * 1-10 的货架板（关卡自己的 scenes，不用登记组件）：探索二的实验台和挑战沙盒的结果插槽共用。
 *
 * 一次画一组（block）：上面是这一组在货架上的 64 格，一行 8 格，前 4 行是小队 0 放的，后 4 行是小队 1 放的；
 * 格子里是现在的数（challenge.ts 的 treeBoard 照着事件流重算）。还要用的格子铺这一组的颜色，已经加给别人的变淡，
 * 没放过的是虚线框；这一段写了的格子描实线框、取了的描虚线框；在被加好之前就被取的标「!」，取了没人放过的标「?」。
 * 下面是 out[0]：现在是多少、对不对、前面排了几次队。range 是这一段的事件 [from, to)，null 是看整段（不标这一段）。
 * 单步时跟着这一段的组；看整段时派了好几组就可以换着看。格子只是看的，不能点；读屏读每一块上面的统计句。
 */
import { computed, ref, watch } from 'vue'
import type { Launch } from '@kit/sandbox/run.ts'
import type { Arg, RunResult } from '@sim/lockstep.ts'
import { SHELF, WAVE, spanText, treeBoard } from '../challenge.ts'

const props = withDefaults(defineProps<{
  result: RunResult | null
  launch: Launch
  args: Record<string, Arg>
  /** out[0] 应该是多少 */
  expected: number
  /** 这一段（或者这一步）的事件 [from, to) 和它在哪一组；null 是看整段 */
  range: { from: number; to: number; block: number } | null
  /** 一次往前走多少：实验台一段一段走，沙盒一步一步走 */
  unit?: '段' | '步'
  emptyText?: string
}>(), { unit: '段', emptyText: '还没运行。' })

const data = computed(() => {
  const r = props.result
  if (!r) return null
  return props.range
    ? treeBoard(r, props.args, props.launch, props.expected, props.range.to, props.range.from)
    : treeBoard(r, props.args, props.launch, props.expected)
})

/** 看整段时选的组：换一次运行，回到 block 0。 */
const picked = ref(0)
watch(() => props.result, () => {
  picked.value = 0
})
const shown = computed(() => (props.range ? props.range.block : picked.value))
const shelf = computed(() => data.value?.shelves[shown.value] ?? null)
const many = computed(() => props.launch.grid > 1)

/** 32 格一段：一段正好是一支小队放的。 */
const parts = computed(() => {
  const slots = shelf.value?.slots ?? []
  const out: { squad: number; slots: typeof slots }[] = []
  for (let k = 0; k < slots.length; k += WAVE) out.push({ squad: k / WAVE, slots: slots.slice(k, k + WAVE) })
  return out
})

const shelfStat = computed(() => {
  const s = shelf.value
  if (!s) return ''
  if (!s.started) return '这一组还没开始走。'
  const pick = (test: (slot: (typeof s.slots)[number]) => boolean) => s.slots.filter(test).map((slot) => slot.index)
  const live = pick((slot) => slot.state === 'live')
  const out = [live.length ? `还要用的 ${live.length} 格：第 ${spanText(live)} 格` : '还一格都没放']
  const wrote = pick((slot) => slot.wrote)
  const read = pick((slot) => slot.read)
  if (wrote.length) out.push(`这一${props.unit}写了第 ${spanText(wrote)} 格`)
  if (read.length) out.push(`取了第 ${spanText(read)} 格`)
  const early = pick((slot) => slot.early)
  if (early.length) out.push(`第 ${spanText(early)} 格还没被加好就被取了`)
  const unput = pick((slot) => slot.unput)
  if (unput.length) out.push(`第 ${spanText(unput)} 格没人放过就被取了`)
  return `${out.join('；')}。`
})

const outStat = computed(() => {
  const o = data.value?.out
  if (!o) return ''
  if (o.state === 'blank') return `还没写（应该是 ${o.expected}）。`
  const verdict = o.state === 'right' ? '对了' : `应该是 ${o.expected}`
  const queue = o.queue ? `，前面排了 ${o.queue} 次队` : ''
  return `out[0] = ${o.value}，${verdict}${queue}${o.now ? `；这一${props.unit}写了它` : ''}。`
})

const groupStyle = computed(() => ({ '--blk': `var(--hg-group-${shown.value % 6})`, '--blk-soft': `var(--hg-group-${shown.value % 6}-soft)` }))
</script>

<template>
  <div class="tb" :style="groupStyle">
    <p v-if="!data" class="tb__empty">{{ emptyText }}</p>
    <template v-else-if="shelf">
      <div v-if="many" class="tb__pick" role="group" aria-label="看哪一组的货架">
        <button
          v-for="s in data.shelves"
          :key="s.block"
          type="button"
          class="tb__pick-button"
          :aria-pressed="s.block === shown"
          :disabled="range !== null"
          @click="picked = s.block"
        >block {{ s.block }}</button>
        <span v-if="range !== null" class="tb__pick-note">单步时跟着这一{{ unit }}的组</span>
      </div>

      <section class="tb__part" :aria-label="`${many ? `block ${shown} 的` : ''}货架（LDS）`">
        <p class="tb__title">{{ many ? `block ${shown} 的` : '' }}货架（LDS）：{{ SHELF }} 格</p>
        <p class="tb__stat">{{ shelfStat }}</p>
        <div v-for="part in parts" :key="part.squad" class="tb__chunk" aria-hidden="true">
          <span class="tb__chunk-label">第 {{ part.slots[0].index }}～{{ part.slots[part.slots.length - 1].index }} 格（小队 {{ part.squad }} 放的）</span>
          <div class="tb__cells">
            <span
              v-for="s in part.slots"
              :key="s.index"
              class="tb__cell"
              :class="[`is-${s.state}`, { 'is-wrote': s.wrote, 'is-read': s.read && !s.wrote, 'is-early': s.early, 'is-unput': s.unput }]"
            >{{ s.value ?? '' }}</span>
          </div>
        </div>
        <p v-if="!data.exact" class="tb__note">这份代码里写进货架的数不只是加起来（比如乘了一个数），货架板只标格子的状态，不写数。</p>
      </section>

      <section class="tb__part" aria-label="out[0]">
        <p class="tb__title">out[0]（显存）</p>
        <div class="tb__out">
          <span class="tb__cell is-out" :class="[`is-${data.out.state}`, { 'is-wrote': data.out.now }]" aria-hidden="true">{{ data.out.state === 'blank' ? '' : data.out.value }}</span>
          <p class="tb__stat">{{ outStat }}</p>
        </div>
      </section>

      <ul class="tb__legend" aria-label="图例">
        <li><span class="tb__sw is-live" aria-hidden="true" />还要用</li>
        <li><span class="tb__sw is-spent" aria-hidden="true" />已经加给别的格子</li>
        <li><span class="tb__sw is-empty" aria-hidden="true" />没放过</li>
        <li><span class="tb__sw is-wrote" aria-hidden="true" />这一{{ unit }}写的</li>
        <li><span class="tb__sw is-read" aria-hidden="true" />这一{{ unit }}取的</li>
        <li><span class="tb__sw is-early" aria-hidden="true" />！还没加好就被取了</li>
        <li v-if="shelf.slots.some((s) => s.unput)"><span class="tb__sw is-early" aria-hidden="true" />？没人放过就被取了</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
/* 外框、换组按钮、图例同 1-9 的货架板（ShelfBoard）。 */
.tb {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.tb__empty {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.tb__pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}

.tb__pick-button {
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

.tb__pick-button[aria-pressed='true'] {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.tb__pick-button:disabled {
  cursor: default;
}

.tb__pick-button:disabled:not([aria-pressed='true']) {
  opacity: 0.5;
}

.tb__pick-button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.tb__pick-note {
  color: var(--hg-ink-3);
  font-size: 12px;
}

.tb__part {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tb__title {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.tb__stat {
  margin: 0;
  color: var(--hg-ink);
  font-size: 13px;
}

.tb__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 12px;
}

.tb__chunk {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.tb__chunk-label {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

/* 一行 8 格：一支小队放的 32 格正好 4 行。格子不超过 52px 宽，四位数也放得下 */
.tb__cells {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 3px;
  max-width: calc(8 * 52px + 7 * 3px);
}

.tb__cell {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 0;
  height: 28px;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 4px;
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    border-color var(--motion-fast) var(--motion-ease-out),
    opacity var(--motion-fast) var(--motion-ease-out);
}

/* 还要用：铺这一组的分类色（01 第 2.3 节：分类色只分组，不表示对错） */
.tb__cell.is-live {
  border-color: var(--blk);
  background: var(--blk-soft);
}

/* 已经加给别的格子：变淡 */
.tb__cell.is-spent {
  color: var(--hg-ink-3);
  opacity: 0.55;
}

.tb__cell.is-empty,
.tb__cell.is-blank {
  border-style: dashed;
  background: transparent;
}

/* 这一段写的、取的：实线框、虚线框（不只靠颜色） */
.tb__cell.is-wrote {
  z-index: 1;
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 0;
  opacity: 1;
}

.tb__cell.is-read {
  z-index: 1;
  outline: 2px dashed var(--hg-accent-ink);
  outline-offset: 0;
  opacity: 1;
}

/* 还没加好就被取了、没人放过就被取了、out 不对：红框 + 角上的记号 */
.tb__cell.is-early,
.tb__cell.is-unput,
.tb__cell.is-wrong {
  border-style: solid;
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  opacity: 1;
}

.tb__cell.is-early::after,
.tb__cell.is-unput::after,
.tb__cell.is-wrong::after,
.tb__cell.is-right::after {
  position: absolute;
  top: 1px;
  right: 2px;
  font-size: 8px;
  line-height: 1;
}

.tb__cell.is-early::after {
  content: '!';
}

.tb__cell.is-unput::after {
  content: '?';
}

.tb__cell.is-wrong::after {
  content: '✗';
}

.tb__cell.is-right {
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent-soft);
}

.tb__cell.is-right::after {
  content: '✓';
  color: var(--hg-accent-ink);
}

.tb__out {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
}

.tb__cell.is-out {
  width: 64px;
  height: 32px;
  font-size: 13px;
}

.tb__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.tb__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

.tb__sw {
  position: relative;
  display: inline-block;
  width: 14px;
  height: 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background: var(--hg-surface);
}

.tb__sw.is-live {
  border-color: var(--blk);
  background: var(--blk-soft);
}

.tb__sw.is-spent {
  opacity: 0.55;
}

.tb__sw.is-empty {
  border-style: dashed;
  background: transparent;
}

.tb__sw.is-wrote {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: -1px;
}

.tb__sw.is-read {
  outline: 2px dashed var(--hg-accent-ink);
  outline-offset: -1px;
}

.tb__sw.is-early {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
}

@media (max-width: 479px) {
  .tb {
    padding: 10px;
  }

  .tb__cell {
    font-size: 10px;
    letter-spacing: -0.03em;
  }
}
</style>
