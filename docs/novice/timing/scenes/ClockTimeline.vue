<script setup lang="ts">
/**
 * 1-11 的计时时间线（关卡自己的 scenes，不用登记组件）：CPU、GPU 两条时间线，再加一条「表」，
 * 画出每一次计时从看表到再看表的那一段。
 *
 * 横轴是模拟器的周期数，按这一次计时的总长等比例画。交出工作单只有几十个周期，按比例画几乎看不见，
 * 所以很短的段最少画一小截（这几段不按比例，准数写在下面的读数里）。预热那一次画成淡色、标「预热」。
 * 颜色之外都有文字：段里放得下就写在段里，每段的 title 写全，读屏读整条时间线的说明（aria-label）。
 * 时间线不动画：旋钮一换，马上画成新的（02 第 4 节，减弱动效下一样）。
 */
import { computed } from 'vue'
import type { Kernel, Segment, Session } from '../challenge.ts'

const props = defineProps<{
  session: Session
  kernels: readonly Kernel[]
  /** 读屏先读的一句：这是哪一次计时 */
  label: string
}>()

/** 很短的段最少画多宽（占整条的百分之几）；窄屏上再由 CSS 的最小像素宽度兜底。 */
const MIN_WIDTH = 0.5
/** 段里写字的门槛：至少占整条的百分之几。 */
const LABEL_WIDTH = 13

/** 「改前：每人连着算 4 个」→「改前」。 */
function shortName(k: number): string {
  return props.kernels[k]?.label.split('：')[0] ?? ''
}

const end = computed(() => Math.max(props.session.end, 1))

function box(from: number, to: number) {
  const left = (from / end.value) * 100
  const width = Math.max(((to - from) / end.value) * 100, MIN_WIDTH)
  return { left: `${Math.min(left, 100 - width)}%`, width: `${width}%`, wide: width >= LABEL_WIDTH }
}

const KIND_TEXT: Record<Segment['kind'], string> = {
  setup: '第一次的准备',
  launch: '启动',
  wait: '等 GPU',
  run: '',
}

function segmentText(s: Segment): string {
  const what = s.kind === 'run' ? `算${shortName(s.kernel)}` : KIND_TEXT[s.kind]
  return s.warmup ? `预热·${what}` : what
}

const lanes = computed(() => (['cpu', 'gpu'] as const).map((lane) => ({
  lane,
  name: lane === 'cpu' ? 'CPU' : 'GPU',
  items: props.session.segments.filter((s) => s.lane === lane).map((s) => {
    const b = box(s.from, s.to)
    return {
      key: `${s.kind}-${s.kernel}-${s.from}`,
      cls: [`is-${s.kind}`, s.kind === 'run' ? `is-k${s.kernel}` : '', s.warmup ? 'is-warm' : ''],
      style: { left: b.left, width: b.width },
      text: b.wide ? segmentText(s) : '',
      title: `${segmentText(s)}：第 ${s.from}～${s.to} 个周期（${s.to - s.from} 个周期）`,
    }
  }),
})))

const clocks = computed(() => props.session.readings.map((r) => {
  const b = box(r.t0, r.t1)
  return {
    key: r.kernel,
    cls: `is-k${r.kernel}`,
    style: { left: b.left, width: b.width },
    text: b.wide ? `${shortName(r.kernel)} ${r.cycles}` : '',
    title: `${shortName(r.kernel)}：第 ${r.t0} 个周期看表，第 ${r.t1} 个周期再看表，量到 ${r.cycles} 个周期`,
  }
}))

/** 读屏的说明：每一次计时看表、再看表在哪，GPU 什么时候在算这一份。 */
const summary = computed(() => {
  const runs = props.session.segments.filter((s) => s.kind === 'run' && !s.warmup)
  const parts = props.session.readings.map((r) => {
    const run = runs.find((s) => s.kernel === r.kernel)
    const gpu = run ? `，GPU 在第 ${run.from}～${run.to} 个周期算这一份` : ''
    return `${shortName(r.kernel)}：第 ${r.t0} 个周期看表，第 ${r.t1} 个周期再看表，量到 ${r.cycles} 个周期${gpu}`
  })
  return `${props.label}（模拟，一共 ${props.session.end} 个周期）。${parts.join('；')}。`
})
</script>

<template>
  <figure class="tl">
    <div class="tl__chart" role="img" :aria-label="summary">
      <div v-for="lane in lanes" :key="lane.lane" class="tl__lane">
        <span class="tl__name" aria-hidden="true">{{ lane.name }}</span>
        <span class="tl__track" aria-hidden="true">
          <span v-for="item in lane.items" :key="item.key" class="tl__seg" :class="item.cls" :style="item.style" :title="item.title">{{ item.text }}</span>
        </span>
      </div>
      <div class="tl__lane">
        <span class="tl__name" aria-hidden="true">表</span>
        <span class="tl__track is-clock" aria-hidden="true">
          <span v-for="c in clocks" :key="c.key" class="tl__clock" :class="c.cls" :style="c.style" :title="c.title">{{ c.text }}</span>
        </span>
      </div>
      <div class="tl__axis" aria-hidden="true">
        <span>0</span>
        <span>{{ session.end }} 个周期（模拟）</span>
      </div>
    </div>
    <figcaption class="tl__legend">
      <span class="tl__key"><i class="tl__swatch is-setup" />第一次的准备</span>
      <span class="tl__key"><i class="tl__swatch is-launch" />启动：交出工作单</span>
      <span class="tl__key"><i class="tl__swatch is-wait" />同步：等 GPU</span>
      <span v-for="(k, i) in kernels" :key="k.label" class="tl__key"><i class="tl__swatch" :class="`is-k${i}`" />GPU 算{{ shortName(i) }}</span>
      <span class="tl__key"><i class="tl__swatch is-warm-key" />淡色：预热那一次</span>
      <span class="tl__key"><i class="tl__swatch is-clock-key" />表：看表到再看表</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.tl {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  min-width: 0;
}

.tl__chart {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 12px 8px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.tl__lane {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tl__name {
  flex: none;
  width: 2.6em;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
}

.tl__track {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 28px;
  border-radius: 6px;
  background: var(--hg-surface);
  box-shadow: inset 0 0 0 1px var(--hg-border);
}

.tl__track.is-clock {
  height: 22px;
}

.tl__seg,
.tl__clock {
  position: absolute;
  top: 3px;
  bottom: 3px;
  overflow: hidden;
  padding: 0 4px;
  border-radius: 4px;
  color: var(--hg-ink);
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  text-overflow: clip;
  white-space: nowrap;
}

.tl__clock {
  line-height: 16px;
}

.tl__seg.is-setup,
.tl__swatch.is-setup {
  background: var(--hg-group-3-soft);
  box-shadow: inset 0 0 0 2px var(--hg-amber);
}

.tl__seg.is-launch,
.tl__swatch.is-launch {
  background: var(--hg-ink-2);
  color: var(--hg-surface);
}

.tl__seg.is-wait,
.tl__swatch.is-wait {
  background: repeating-linear-gradient(135deg, var(--hg-surface-2) 0 5px, var(--hg-border) 5px 7px);
  box-shadow: inset 0 0 0 1px var(--hg-border-strong);
  color: var(--hg-ink-2);
}

.tl__seg.is-k0,
.tl__swatch.is-k0,
.tl__clock.is-k0 {
  background: var(--hg-group-0-soft);
  box-shadow: inset 0 0 0 2px var(--hg-group-0);
}

.tl__seg.is-k1,
.tl__swatch.is-k1,
.tl__clock.is-k1 {
  background: var(--hg-group-1-soft);
  box-shadow: inset 0 0 0 2px var(--hg-group-1);
}

/* 预热那一次：淡色，字照样看得清。 */
.tl__seg.is-warm {
  opacity: 0.55;
}

.tl__clock {
  font-family: var(--hg-font-mono);
}

.tl__axis {
  display: flex;
  justify-content: space-between;
  padding-left: calc(2.6em + 8px);
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

.tl__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  color: var(--hg-ink-2);
  font-size: 12px;
}

.tl__key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.tl__swatch {
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 3px;
}

.tl__swatch.is-warm-key {
  background: var(--hg-group-0-soft);
  box-shadow: inset 0 0 0 2px var(--hg-group-0);
  opacity: 0.55;
}

.tl__swatch.is-clock-key {
  background: var(--hg-surface);
  box-shadow: inset 0 0 0 2px var(--hg-ink-2);
}
</style>
