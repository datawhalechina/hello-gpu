<script setup lang="ts">
/**
 * 1-7 探索二「给数据挑住处」（关卡自己的 scenes，不用登记组件）：求和工作单里的四个数，读者给每个挑住处。
 *
 * 先用旋钮选一个数，再点地图（StorageMap）上的一个地方，把它挪过去；地图上每个地方写着住在这里的数。
 * 一挪就判（challenge.ts 的 placeVerdict）：最合适、能用但远、不行，并说为什么（03 第 4 节）。
 * 默认四个数都在城外仓库：都能用，可 s 和交接的和住得太远（03 第 1 节第 3 条：能跑但不好）。
 * 缓存点了也挪不过去：留哪些数由硬件自己定。探索环节，不发星，也不存草稿（同前几关只有旋钮的探索）。
 */
import { computed, reactive, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import StorageMap from './StorageMap.vue'
import {
  DATA_ITEMS, DATA_ORDER, DEFAULT_PLACEMENT, PLACES, placeVerdict, placementSummary,
  type DataId, type Fit, type Place, type Placement,
} from '../challenge.ts'

const titleId = `${useId()}-title`

const DATA_OPTIONS = DATA_ORDER.map((id) => ({ value: id, label: DATA_ITEMS[id].tag }))
const FIT_TEXT: Record<Fit, string> = { best: '最合适', ok: '能用，但远', no: '不行' }

const current = ref<DataId>('partial')
const placement = reactive<Placement>({ ...DEFAULT_PLACEMENT })
/** 点了缓存：数挪不过去，这一句说为什么；挪了别的、换了数就清掉。 */
const note = ref('')

function move(place: Place) {
  if (place === 'cache') {
    note.value = placeVerdict(current.value, 'cache').text
    return
  }
  note.value = ''
  placement[current.value] = place
}

function choose(id: DataId) {
  current.value = id
  note.value = ''
}

function reset() {
  Object.assign(placement, DEFAULT_PLACEMENT)
  note.value = ''
}

const item = computed(() => DATA_ITEMS[current.value])
const verdict = computed(() => placeVerdict(current.value, placement[current.value]))
const rows = computed(() => DATA_ORDER.map((id) => ({ id, place: placement[id], ...placeVerdict(id, placement[id]) })))
const summary = computed(() => placementSummary(placement))
const moved = computed(() => DATA_ORDER.some((id) => placement[id] !== DEFAULT_PLACEMENT[id]))

/** 「s 住在寄存器」「交接住在 LDS」：中文和英文之间才空一格（05 第 7 节）。 */
const latin = (text: string) => /^[A-Za-z]/.test(text)
const lead = computed(() => {
  const tag = item.value.tag
  const where = PLACES[placement[current.value]].label
  return `${tag}${latin(tag) ? ' ' : ''}住在${latin(where) ? ' ' : ''}${where}`
})

/** 住在一个地方的数（地图上的小标签）。 */
function residents(place: Place) {
  return rows.value.filter((r) => r.place === place)
}
</script>

<template>
  <section class="pd" :aria-labelledby="titleId">
    <header class="pd__head">
      <span class="pd__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="pd__title">给数据挑住处</strong>
      <span class="pd__tag">模拟</span>
    </header>
    <p class="pd__rules">求和工作单里有四个数，一开始都住在城外仓库。先选一个数，再点地图上的地方，把它挪过去。挑的时候看三件事：谁要用，放不放得下，离工位多远。</p>

    <div class="pd__pick">
      <Knob label="要挪的数" :options="DATA_OPTIONS" :model-value="current" @update:model-value="choose($event as DataId)" />
      <p class="pd__what"><strong>{{ item.name }}</strong>：{{ item.detail }}</p>
    </div>

    <StorageMap pickable :selected="placement[current]" :label="`取数据地图：点一个地方，把 ${item.tag} 挪过去`" @pick="move">
      <template #place="{ place }">
        <span v-if="residents(place).length" class="pd__chips">
          <span
            v-for="r in residents(place)"
            :key="r.id"
            class="pd__chip"
            :class="[`is-${r.fit}`, { 'is-current': r.id === current }]"
          >{{ DATA_ITEMS[r.id].tag }}<span class="pd__sr">（{{ FIT_TEXT[r.fit] }}）</span></span>
        </span>
      </template>
    </StorageMap>

    <p class="pd__verdict" :class="`is-${note ? 'no' : verdict.fit}`" aria-live="polite">
      <template v-if="note">{{ note }}</template>
      <template v-else>
        <span class="pd__fit">{{ FIT_TEXT[verdict.fit] }}</span>{{ lead }}：{{ verdict.text }}
      </template>
    </p>

    <ul class="pd__list" aria-label="四个数现在住在哪">
      <li v-for="r in rows" :key="r.id" :class="`is-${r.fit}`">
        <span class="pd__fit">{{ FIT_TEXT[r.fit] }}</span>
        <span>{{ DATA_ITEMS[r.id].tag }} · {{ PLACES[r.place].label }}</span>
      </li>
    </ul>
    <p class="pd__summary">{{ summary.text }}</p>

    <div class="pd__actions">
      <button type="button" class="pd-button" :disabled="!moved" @click="reset">全放回城外仓库</button>
    </div>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同探索一（FetchTrip）。 */
.pd {
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

.pd__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.pd__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.pd__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.pd__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.pd__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.pd__pick {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.pd__what {
  margin: 0;
  font-size: 14px;
}

/* 地图上住在这里的数：小药丸，当前选中的那个描粗；合不合适用颜色和括号里的字一起说（01 第 7 节）。 */
.pd__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  margin-top: 6px;
}

.pd__chip {
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
}

.pd__chip.is-best {
  border-color: var(--hg-accent-ink);
  color: var(--hg-accent-ink);
}

.pd__chip.is-ok {
  border-color: var(--hg-amber);
  color: var(--hg-amber-ink);
}

.pd__chip.is-no {
  border-style: dashed;
  border-color: var(--hg-error);
  color: var(--hg-error-ink);
}

.pd__chip.is-current {
  box-shadow: 0 0 0 2px var(--hg-ink);
}

.pd__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.pd__verdict {
  min-height: 3.2em;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.pd__fit {
  display: inline-block;
  margin-right: 8px;
  padding: 0 8px;
  border-radius: var(--hg-radius-pill);
  font-size: 12px;
  font-weight: 700;
  vertical-align: 1px;
}

.is-best > .pd__fit {
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

.is-ok > .pd__fit {
  background: color-mix(in srgb, var(--hg-amber) 16%, transparent);
  color: var(--hg-amber-ink);
}

.is-no > .pd__fit {
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
}

.pd__verdict.is-no:not(:has(.pd__fit)) {
  color: var(--hg-error-ink);
}

.pd__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 6px 14px;
  margin: 0;
  padding: 0;
  font-size: 13px;
  list-style: none;
}

.pd__list li {
  display: flex;
  align-items: baseline;
  margin: 0;
}

.pd__summary {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.pd__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.pd-button {
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

.pd-button:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.pd-button:disabled {
  color: var(--hg-ink-3);
  cursor: default;
}

.pd-button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

@media (max-width: 639px) {
  .pd {
    padding: 16px 14px;
  }

  .pd__pick {
    padding: 12px 10px;
  }
}
</style>
