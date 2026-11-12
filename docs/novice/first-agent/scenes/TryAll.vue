<script setup lang="ts">
/**
 * 1-14 探索一「全试一遍」（关卡自己的 scenes，不用登记组件）。
 *
 * 搜索空间的 28 组参数摆成一张表（SpaceGrid）。两个旋钮（Knob）选一组，点「试这一组」：全试一遍的做法，
 * 每组运行一次、计一次时，用 2 步，格子里写出周期数（模拟）；「全试一遍」把还没试的都试了；「重来」清空。
 * 点表上的格子也能试那一组（鼠标、触屏的捷径；键盘用旋钮和按钮）。
 * 上面一句（challenge.ts 的 tryText）写试了几组、用了几步、目前最快的是哪组：试到第 7 组，一轮 15 步只剩交卷那 1 步；
 * 28 组全试完，最快的 4 组标出来。下面一条步数条，过了一轮的 15 步换成提醒色，旁边写着数（不只靠颜色）。
 * 周期数是 SPACE 里的模拟值（单测拿模拟器核对），不在浏览器里跑模拟器。不判星，不存草稿（同前几关只有旋钮的探索），刷新回到默认。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { configKey, describeConfig, type TuneConfig } from '@course/agent/tasks.ts'
import { cellOf, fastestOf, SPACE, START, STEP_LIMIT, TASK, TRY_STEPS, tryText, type GridCell } from '../challenge.ts'
import SpaceGrid from './SpaceGrid.vue'

const titleId = `${useId()}-title`
const BLOCKS = [...TASK.blocks]
const STRIDES = [...TASK.strides]

const block = ref<number>(START.block)
const stride = ref<number>(START.stride)
const picked = computed<TuneConfig>(() => ({ block: block.value, stride: stride.value }))
/** 试过的几组，按先后 */
const tried = ref<TuneConfig[]>([])
const triedKeys = computed(() => new Set(tried.value.map(configKey)))
/** 点了已经试过的那组：说一声，不再算步数 */
const note = ref('')

function tryOne(c: TuneConfig) {
  block.value = c.block
  stride.value = c.stride
  if (triedKeys.value.has(configKey(c))) {
    note.value = `${describeConfig(c)} 已经试过了：${cellOf(c).cycles} 个周期（模拟），不用再花步数。`
    return
  }
  note.value = ''
  tried.value = [...tried.value, c]
}

function tryAll() {
  note.value = ''
  tried.value = [...tried.value, ...SPACE.map((cell) => cell.config).filter((c) => !triedKeys.value.has(configKey(c)))]
}

function reset() {
  note.value = ''
  tried.value = []
}

const used = computed(() => tried.value.length * TRY_STEPS)
const over = computed(() => used.value + 1 > STEP_LIMIT)
const readout = computed(() => tryText(tried.value))

const cells = computed(() => {
  const best = fastestOf(tried.value)
  const out: Record<string, GridCell> = {}
  for (const cell of SPACE) {
    const key = configKey(cell.config)
    const at = describeConfig(cell.config)
    if (!triedKeys.value.has(key)) {
      out[key] = { text: '?', label: `${at}：还没试`, tone: 'muted' }
      continue
    }
    const fastest = best !== null && cell.cycles === best.cycles
    out[key] = fastest
      ? { text: String(cell.cycles), label: `${at}：${cell.cycles} 个周期（模拟），目前最快`, tone: 'best', tag: '最快' }
      : { text: String(cell.cycles), label: `${at}：${cell.cycles} 个周期（模拟）` }
  }
  return out
})
</script>

<template>
  <section class="ta" :aria-labelledby="titleId">
    <header class="ta__head">
      <span class="ta__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="ta__title">全试一遍</strong>
      <span class="ta__tag">模拟</span>
    </header>
    <p class="ta__rules">表里是 {{ SPACE.length }} 组参数，一格一组。选一组点「试这一组」：运行一次、计一次时，用 {{ TRY_STEPS }} 步，格子里写出要多少个周期。也可以直接点格子。</p>

    <div class="ta__knobs">
      <Knob v-model="block" label="每组线程数" code="block" :options="BLOCKS" />
      <Knob v-model="stride" label="访问步长" code="stride" :options="STRIDES" />
    </div>

    <div class="ta__actions">
      <button type="button" class="ta__button is-primary" @click="tryOne(picked)">试这一组（{{ TRY_STEPS }} 步）</button>
      <button type="button" class="ta__button" :disabled="tried.length === SPACE.length" @click="tryAll">全试一遍</button>
      <button type="button" class="ta__button" :disabled="tried.length === 0" @click="reset">重来</button>
    </div>

    <p class="ta__readout" aria-live="polite">{{ readout }}<template v-if="note"> {{ note }}</template></p>

    <div class="ta__meter" :class="{ 'is-over': over }">
      <span class="ta__bar" aria-hidden="true"><span class="ta__fill" :style="{ width: `${Math.min(used, STEP_LIMIT) / STEP_LIMIT * 100}%` }" /></span>
      <span class="ta__count">用了 {{ used }} 步 · 一轮最多 {{ STEP_LIMIT }} 步，最后 1 步留给交卷</span>
    </div>

    <SpaceGrid
      :cells="cells"
      :selected="configKey(picked)"
      pickable
      :caption="`全试一遍：${SPACE.length} 组参数，试过的写着周期数（模拟）`"
      @pick="tryOne"
    />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的探索（1-13 的 PathLab）。 */
.ta {
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

.ta__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ta__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ta__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ta__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.ta__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* 旋钮：宽屏两列，窄屏一列（同 1-13 的 PathLab）。 */
.ta__knobs {
  display: grid;
  gap: 14px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .ta__knobs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.ta__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* 按钮同 1-9 的实验台（ShelfLab）。 */
.ta__button {
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

.ta__button.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.ta__button:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.ta__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ta__button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.ta__readout {
  min-height: 1.6em;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

/* 步数条：一轮 15 步，超出以后换提醒色（旁边的字写着数，不只靠颜色）。 */
.ta__meter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.ta__bar {
  flex: 1 1 160px;
  height: 10px;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-bg);
}

.ta__fill {
  display: block;
  height: 100%;
  background: var(--hg-accent);
}

.ta__meter.is-over .ta__fill {
  background: var(--hg-amber);
}

.ta__meter.is-over .ta__count {
  color: var(--hg-amber-ink);
  font-weight: 700;
}

@media (max-width: 639px) {
  .ta {
    padding: 16px 14px;
  }
}
</style>
