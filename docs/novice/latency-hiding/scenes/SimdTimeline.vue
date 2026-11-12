<script setup lang="ts">
/**
 * 1-12 一条流水线的时间线（关卡自己的 scenes，不用登记组件）。
 *
 * 上面三项读数：用时、流水线在算几个周期、等待藏住多少。下面的图，最上一行是流水线：在给小队算就涂色，
 * 空着就留白；再往下每行一支小队（左边是组号）：占着流水线算、等仓库送数据、准备好了等流水线空出来、
 * 住不下在门外等。分批时，竖线是下一批住进来的时候。
 *
 * 横轴是模拟器的周期数，按这一次的总长等比例画。算一步只有一个周期，按比例画几乎看不见，所以每段最少画
 * 1 像素宽（这几段不按比例，准数写在读数里）。用时那根条按 scale 画，几种派法放在一起比。
 * 颜色之外都有文字：读屏读整张图的说明（aria-label，challenge.ts 的 scheduleSummary），每段的 title 写全。
 * 图不动画：旋钮一换，马上画成新的（02 第 4 节，减弱动效下一样）。
 */
import { computed } from 'vue'
import { percent, scheduleSummary, type Schedule, type ScheduleKind } from '../challenge.ts'

const props = defineProps<{
  schedule: Schedule
  /** 读屏先读的一句：这是哪一次排班 */
  label: string
  /** 用时那根条的满格是多少个周期 */
  scale: number
}>()

const KIND_TEXT: Record<ScheduleKind, string> = {
  run: '占着流水线算',
  memory: '等仓库送数据',
  sync: '等同步',
  ready: '准备好了，等流水线空出来',
  queued: '住不下，在门外等',
}

const end = computed(() => Math.max(props.schedule.cycles, 1))

function box(start: number, stop: number) {
  return { left: `${(start / end.value) * 100}%`, width: `${((stop - start) / end.value) * 100}%` }
}

const busy = computed(() => props.schedule.busySpans.map((s) => ({
  key: s.start,
  style: box(s.start, s.end),
  title: `流水线在算：第 ${s.start}～${s.end} 个周期（${s.end - s.start} 个周期）`,
})))

const rows = computed(() => props.schedule.rows.map((row) => ({
  wave: row.wave,
  items: row.segments.map((s) => ({
    key: `${s.kind}-${s.start}`,
    cls: `is-${s.kind}`,
    style: box(s.start, s.end),
    title: `第 ${row.wave} 组的小队，${KIND_TEXT[s.kind]}：第 ${s.start}～${s.end} 个周期（${s.end - s.start} 个周期）`,
  })),
})))

/** 第 2 批起，每一批住进来的时候画一条竖线。 */
const marks = computed(() => props.schedule.batchStarts.slice(1).map((t, k) => ({
  key: t,
  left: `${(t / end.value) * 100}%`,
  title: `第 ${k + 2} 批住进来：第 ${t} 个周期`,
})))

const kinds = computed(() => new Set(props.schedule.rows.flatMap((r) => r.segments.map((s) => s.kind))))
const summary = computed(() => `${props.label}。${scheduleSummary(props.schedule)}`)
const usedWidth = computed(() => `${Math.min(props.schedule.cycles / Math.max(props.scale, 1), 1) * 100}%`)
const hiddenWidth = computed(() => `${Math.min(Math.max(props.schedule.hiddenRatio, 0), 1) * 100}%`)
</script>

<template>
  <figure class="st">
    <dl class="st__stats">
      <div class="st__stat">
        <dt>用时</dt>
        <dd>
          <span class="st__meter" aria-hidden="true"><span class="st__fill is-time" :style="{ width: usedWidth }" /></span>
          <span class="st__num">{{ schedule.cycles }} 个周期</span>
        </dd>
      </div>
      <div class="st__stat">
        <dt>流水线在算</dt>
        <dd>
          <span class="st__num">{{ schedule.busy }} 个周期（{{ percent(schedule.busy / Math.max(schedule.cycles, 1)) }}）</span>
        </dd>
      </div>
      <div class="st__stat">
        <dt>等待藏住</dt>
        <dd>
          <span class="st__meter" aria-hidden="true"><span class="st__fill is-hidden" :style="{ width: hiddenWidth }" /></span>
          <span class="st__num">{{ percent(schedule.hiddenRatio) }}</span>
          <span class="st__sub">有小队在等的 {{ schedule.waiting }} 个周期里，{{ schedule.hidden }} 个周期流水线在给别的小队算</span>
        </dd>
      </div>
    </dl>

    <div class="st__chart" role="img" :aria-label="summary">
      <div class="st__lane is-simd">
        <span class="st__name" aria-hidden="true">流水线</span>
        <span class="st__track" aria-hidden="true">
          <span v-for="b in busy" :key="b.key" class="st__seg is-busy" :style="b.style" :title="b.title" />
          <span v-for="m in marks" :key="m.key" class="st__mark" :style="{ left: m.left }" :title="m.title" />
        </span>
      </div>
      <div class="st__waves" :class="{ 'is-dense': rows.length > 4 }">
        <div v-for="row in rows" :key="row.wave" class="st__lane">
          <span class="st__name is-wave" aria-hidden="true">{{ row.wave }}</span>
          <span class="st__track" aria-hidden="true">
            <span v-for="item in row.items" :key="item.key" class="st__seg" :class="item.cls" :style="item.style" :title="item.title" />
            <span v-for="m in marks" :key="m.key" class="st__mark" :style="{ left: m.left }" />
          </span>
        </div>
      </div>
      <div class="st__axis" aria-hidden="true">
        <span>0</span>
        <span>{{ schedule.cycles }} 个周期（模拟）</span>
      </div>
    </div>

    <figcaption class="st__legend">
      <span class="st__key"><i class="st__swatch is-run" />算：最上一行是流水线，下面每行一支小队，左边是组号</span>
      <span class="st__key"><i class="st__swatch is-memory" />等仓库送数据</span>
      <span v-if="kinds.has('ready')" class="st__key"><i class="st__swatch is-ready" />准备好了，等流水线空出来</span>
      <span v-if="kinds.has('queued')" class="st__key"><i class="st__swatch is-queued" />住不下，在门外等</span>
      <span v-if="marks.length" class="st__key"><i class="st__swatch is-mark" />竖线：下一批住进来</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.st {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  min-width: 0;
}

/* 读数：宽屏三列，窄屏一列。 */
.st__stats {
  display: grid;
  gap: 8px 16px;
  margin: 0;
}

@media (min-width: 640px) {
  .st__stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.st__stat {
  min-width: 0;
}

.st__stat dt {
  color: var(--hg-ink-3);
  font-size: 12px;
  font-weight: 700;
}

.st__stat dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  margin: 2px 0 0;
}

.st__meter {
  position: relative;
  flex: 1 1 4em;
  min-width: 4em;
  max-width: 10em;
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--hg-surface-2);
  box-shadow: inset 0 0 0 1px var(--hg-border);
}

.st__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 4px;
}

.st__fill.is-time {
  background: var(--hg-ink-2);
}

.st__fill.is-hidden {
  background: var(--hg-group-0);
}

.st__num {
  font-family: var(--hg-font-mono);
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}

.st__sub {
  flex-basis: 100%;
  color: var(--hg-ink-3);
  font-size: 12px;
}

.st__chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 12px 8px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.st__waves {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.st__lane {
  display: flex;
  align-items: center;
  gap: 8px;
}

.st__name {
  flex: none;
  width: 42px;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.st__name.is-wave {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 400;
  line-height: 1;
  text-align: right;
}

.st__track {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 14px;
  border-radius: 3px;
  background: var(--hg-surface);
  box-shadow: inset 0 0 0 1px var(--hg-border);
}

.st__lane.is-simd .st__track {
  height: 20px;
}

/* 小队多时每行压扁，16 行也不太高。 */
.st__waves.is-dense {
  gap: 2px;
}

.st__waves.is-dense .st__track {
  height: 8px;
}

.st__waves.is-dense .st__name.is-wave {
  font-size: 9px;
}

.st__seg {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 1px;
}

.st__seg.is-busy,
.st__seg.is-run,
.st__swatch.is-run {
  background: var(--hg-group-0);
}

.st__seg.is-memory,
.st__swatch.is-memory {
  background: repeating-linear-gradient(135deg, var(--hg-surface-2) 0 3px, var(--hg-border-strong) 3px 4px);
}

.st__seg.is-sync {
  background: var(--hg-group-3-soft);
}

.st__seg.is-ready,
.st__swatch.is-ready {
  background: var(--hg-group-0-soft);
}

.st__seg.is-queued,
.st__swatch.is-queued {
  border: 1px dashed var(--hg-border-strong);
  background: transparent;
}

.st__mark {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  margin-left: -1px;
  background: var(--hg-ink);
}

.st__axis {
  display: flex;
  justify-content: space-between;
  padding-left: 50px;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

.st__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: var(--hg-ink-2);
  font-size: 12px;
}

.st__key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.st__swatch {
  display: inline-block;
  flex: none;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}

.st__swatch.is-mark {
  width: 2px;
  background: var(--hg-ink);
}
</style>
