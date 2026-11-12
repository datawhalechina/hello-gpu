<script setup lang="ts">
/**
 * 1-10 探索一「搭一棵求和树」（关卡自己的 scenes，不用登记组件）：8 个部分和，读者两两配对，搭出一棵求和树。
 *
 * 先点一个数、再点另一个，两个数加成一个；也可以把一个数拖到另一个上（浏览器自带的拖放，桌面鼠标用）。
 * 新的数放在「两个数里晚的那一轮 + 1」（challenge.ts 的 joinNodes）：一行是一轮，同一轮里的加法互不相干，可以同时做。
 * 每加一次就写一句为什么放在这一轮（joinStory）；合完了写用了几轮、是不是最少，不是最少就指出哪一轮有数在干等（treeText）。
 * 键盘：数都是按钮，Tab 换、回车或空格选；Esc 取消选中。加完以后焦点落到新加出来的数上。
 * 可以撤销、重来；合完了还不是最少的轮数，可以看一棵 3 轮的树（探索环节，不影响星级）。不存草稿（同前几关的探索）。
 */
import { computed, nextTick, ref, shallowRef, useId } from 'vue'
import {
  TREE_THREADS, TREE_VALUES, bestTree, joinCount, joinNodes, joinStory, plantTree, roundsNeeded, treeDone, treeRounds, treeText,
  undoJoin, type SumNode,
} from '../challenge.ts'

const titleId = `${useId()}-title`
const BEST = roundsNeeded(TREE_VALUES.length)

const tree = shallowRef(plantTree())
/** 先点的那个数（id）；没选是 null */
const selected = ref<number | null>(null)
/** 正在拖的数、拖到了哪个数上面 */
const dragging = ref<number | null>(null)
const over = ref<number | null>(null)
/** 刚做的那一下的一句话：加了什么、为什么放在这一轮；撤销、重来、看答案也写一句 */
const story = ref('')
/** 看过 3 轮的树：下面一句话说明这是示范 */
const shown = ref(false)

const chipEls = new Map<number, HTMLElement>()
function setChip(id: number, el: unknown) {
  if (el instanceof HTMLElement) chipEls.set(id, el)
  else chipEls.delete(id)
}

/** 一行是一轮：第 0 行是现成的数，后面每行是那一轮加出来的数。 */
const rows = computed(() => {
  const out: { round: number; nodes: SumNode[] }[] = []
  for (let r = 0; r <= treeRounds(tree.value); r++) out.push({ round: r, nodes: tree.value.nodes.filter((n) => n.round === r) })
  return out
})

const done = computed(() => treeDone(tree.value))
const rounds = computed(() => treeRounds(tree.value))
const joins = computed(() => joinCount(tree.value))
const canShow = computed(() => done.value && rounds.value > BEST && !shown.value)

function valueOf(id: number) {
  return tree.value.nodes[id]?.value
}

/** 一个数的来历：加出来的写「3 + 1」，用掉的写「→ 4」。 */
function fromText(n: SumNode) {
  return n.kids ? `${valueOf(n.kids[0])} + ${valueOf(n.kids[1])}` : ''
}

function label(n: SumNode) {
  const parts = [`${n.value}`]
  if (n.kids) parts.push(`第 ${n.round} 轮由 ${fromText(n)} 加出来`)
  else parts.push('现成的数')
  if (n.into !== null) parts.push(`已经加进了 ${valueOf(n.into)}`)
  else if (selected.value === n.id) parts.push('已选中，再选一个数和它相加')
  return parts.join('，')
}

const status = computed(() => {
  if (selected.value !== null) return `选了 ${valueOf(selected.value)}。再点一个数和它相加；再点它一次就取消。`
  return `${story.value}${treeText(tree.value)}`
})

async function join(a: number, b: number) {
  const next = joinNodes(tree.value, a, b)
  selected.value = null
  if (next === tree.value) return
  tree.value = next
  shown.value = false
  const id = next.nodes.length - 1
  story.value = joinStory(next, id)
  await nextTick()
  chipEls.get(id)?.focus()
}

function choose(id: number) {
  if (selected.value === null) selected.value = id
  else if (selected.value === id) selected.value = null
  else join(selected.value, id)
}

function cancel() {
  selected.value = null
}

function undo() {
  tree.value = undoJoin(tree.value)
  selected.value = null
  shown.value = false
  story.value = '撤销了最后一次加法。'
}

function reset() {
  tree.value = plantTree()
  selected.value = null
  shown.value = false
  story.value = ''
}

function showBest() {
  tree.value = bestTree()
  selected.value = null
  shown.value = true
  story.value = '这是一棵 3 轮的树：每一轮都把手上的数挨着两两配对。'
}

// ── 拖放（桌面鼠标）：把一个数拖到另一个上，等于先点它、再点那一个 ──────────────

function onDragStart(e: DragEvent, id: number) {
  dragging.value = id
  selected.value = null
  e.dataTransfer?.setData('text/plain', String(id))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e: DragEvent, id: number) {
  if (dragging.value === null || dragging.value === id) return
  e.preventDefault()
  over.value = id
}

function onDrop(e: DragEvent, id: number) {
  e.preventDefault()
  const from = dragging.value
  dragging.value = null
  over.value = null
  if (from !== null && from !== id) join(from, id)
}

function onDragEnd() {
  dragging.value = null
  over.value = null
}
</script>

<template>
  <section class="st" :aria-labelledby="titleId">
    <header class="st__head">
      <span class="st__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="st__title">搭一棵求和树</strong>
      <span class="st__tag">模拟</span>
    </header>
    <p class="st__rules">{{ TREE_VALUES.length }} 个部分和，{{ TREE_THREADS }} 个线程一起加。先点一个数，再点另一个，两个数加成一个；也可以把一个数拖到另一个上。新加出来的数放在哪一轮，由它的两个数里晚的那个决定。</p>

    <div class="st__meter" aria-hidden="true">
      <span>加了 <b>{{ joins }}</b> 次</span>
      <span>用到第 <b>{{ rounds }}</b> 轮</span>
      <span>最少 {{ BEST }} 轮</span>
    </div>

    <ol class="st__rows" aria-label="求和树：一行是一轮">
      <li v-for="row in rows" :key="row.round" class="st__row">
        <p class="st__row-label">
          <template v-if="row.round === 0">现成的数</template>
          <template v-else>第 {{ row.round }} 轮<span class="st__row-count">：{{ row.nodes.length }} 次加法{{ row.nodes.length > 1 ? '同时做' : '' }}</span></template>
        </p>
        <div class="st__chips">
          <template v-for="n in row.nodes" :key="n.id">
            <button
              v-if="n.into === null && !done"
              :ref="(el) => setChip(n.id, el)"
              type="button"
              class="st__chip is-ready"
              :class="{ 'is-over': over === n.id, 'is-dragging': dragging === n.id }"
              :aria-pressed="selected === n.id"
              :aria-label="label(n)"
              draggable="true"
              @click="choose(n.id)"
              @keydown.esc="cancel"
              @dragstart="onDragStart($event, n.id)"
              @dragover="onDragOver($event, n.id)"
              @dragleave="over === n.id && (over = null)"
              @drop="onDrop($event, n.id)"
              @dragend="onDragEnd"
            >
              <span class="st__value">{{ n.value }}</span>
              <span v-if="n.kids" class="st__from" aria-hidden="true">{{ fromText(n) }}</span>
            </button>
            <span
              v-else
              :ref="(el) => setChip(n.id, el)"
              class="st__chip"
              :class="n.into === null ? 'is-root' : 'is-used'"
              :tabindex="n.into === null ? -1 : undefined"
              role="img"
              :aria-label="label(n)"
            >
              <span class="st__value">{{ n.value }}</span>
              <span v-if="n.kids" class="st__from" aria-hidden="true">{{ fromText(n) }}</span>
              <span v-if="n.into !== null" class="st__into" aria-hidden="true">→ {{ valueOf(n.into) }}</span>
            </span>
          </template>
        </div>
      </li>
    </ol>

    <p class="st__status" :class="{ 'is-done': done }" aria-live="polite">{{ status }}</p>

    <div class="st__actions">
      <button type="button" class="st__button" :disabled="!joins" @click="undo">撤销一步</button>
      <button type="button" class="st__button" :disabled="!joins" @click="reset">重来</button>
      <button v-if="canShow" type="button" class="st__button is-primary" @click="showBest">看一棵 {{ BEST }} 轮的树</button>
    </div>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签、按钮同 1-9 的实验台（ShelfLab）。 */
.st {
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

.st__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.st__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.st__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.st__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.st__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.st__meter {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.st__meter b {
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
}

.st__rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  list-style: none;
}

.st__row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.st__row + .st__row {
  padding-top: 10px;
  border-top: var(--hg-border-width) dashed var(--hg-border-strong);
}

.st__row-label {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 700;
}

.st__row-count {
  font-weight: 500;
}

.st__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* 一个数：上面是数，下面一行小字写来历（3 + 1）或去向（→ 4）。按钮至少 44px 高，手指点得到 */
.st__chip {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 48px;
  padding: 4px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  line-height: 1.15;
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    border-color var(--motion-fast) var(--motion-ease-out),
    opacity var(--motion-fast) var(--motion-ease-out);
}

.st__value {
  font-family: var(--hg-font-mono);
  font-size: 17px;
  font-weight: 700;
}

.st__from,
.st__into {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.st__chip.is-ready {
  border-color: var(--hg-group-0);
  background: var(--hg-group-0-soft);
  cursor: grab;
}

.st__chip.is-ready:hover {
  border-color: var(--hg-accent);
}

.st__chip.is-ready[aria-pressed='true'] {
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent-soft);
  box-shadow: inset 0 0 0 2px var(--hg-accent-ink);
}

.st__chip.is-over {
  border-style: dashed;
  border-color: var(--hg-accent-ink);
  box-shadow: inset 0 0 0 2px var(--hg-accent-ink);
}

.st__chip.is-dragging {
  opacity: 0.5;
}

.st__chip.is-ready:focus-visible,
.st__chip.is-root:focus-visible,
.st__button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* 已经加给别人的数：变淡、虚线框，不能再挑 */
.st__chip.is-used {
  border-style: dashed;
  background: transparent;
  opacity: 0.6;
}

/* 最后剩下的那一个：总和 */
.st__chip.is-root {
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent-soft);
}

.st__status {
  min-height: 3.2em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.st__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.st__button {
  min-height: 40px;
  padding: 0 16px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.st__button.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.st__button:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.st__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 639px) {
  .st {
    padding: 16px 14px;
  }

  .st__rows {
    padding: 10px;
  }
}

/* 窄屏：8 个数挤一行，按钮窄一点，高度不变 */
@media (max-width: 479px) {
  .st__chips {
    gap: 4px;
  }

  .st__chip {
    min-width: 32px;
    padding: 4px 5px;
  }

  .st__value {
    font-size: 15px;
  }
}
</style>
