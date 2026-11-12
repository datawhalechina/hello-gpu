<script setup lang="ts">
/**
 * 2-3 探索一「停表的时机」（关卡自己的 scenes，不用登记组件）：同一个加法，三种停表的办法各量到了哪一段。
 *
 * 旋钮一选怎么停表（add() 返回时、等 GPU 算完、GPU 事件），旋钮二选开始计时的时候 GPU 的队列里还排着几个加法。
 * 时间线两条道：上面 CPU，下面 GPU 的队列（示意，长短不是实测）。尺子固定是 CLOCK_TOTAL，换旋钮时不伸缩，
 * 几种情形的长短可以直接比。CPU 道上的竖线是开始计时（像「[」）和停表（像「]」）的地方，GPU 事件画成
 * begin、end 两个时间戳，最下面的括号是这次量到的时间。时间线、量到的区间和倍数都在 timing.ts
 * （stopClock、STOP_MODES、CLOCK_TOTAL），这里只写解读的句子。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import {
  CLOCK_TOTAL,
  QUEUED_DEFAULT,
  QUEUED_OPTIONS,
  STOP_DEFAULT,
  STOP_MODES,
  stopClock,
  type ClockSegment,
  type StopMode,
} from '../timing.ts'

const titleId = `${useId()}-title`

const mode = ref<StopMode>(STOP_DEFAULT)
const queued = ref<number>(QUEUED_DEFAULT)
const MODE_OPTIONS = STOP_MODES.map((m) => ({ value: m.id, label: m.label }))
const QUEUED_CHOICES = QUEUED_OPTIONS.map((q) => ({ value: q, label: String(q) }))
const current = computed(() => STOP_MODES.find((m) => m.id === mode.value) ?? STOP_MODES[0])
const code = computed(() => current.value.code.join('\n'))
const run = computed(() => stopClock(mode.value, queued.value))

// ── 时间线 ──
/** 尺子固定是 CLOCK_TOTAL：换旋钮时不伸缩。 */
const pct = (t: number) => `${(t / CLOCK_TOTAL) * 100}%`
const cpuSegments = computed(() => run.value.segments.filter((s) => s.lane === 'cpu'))
const gpuSegments = computed(() => run.value.segments.filter((s) => s.lane === 'gpu'))

/** 段上的字：CPU 交活的那一下太窄，不写；GPU 空着画虚线框，也不写。 */
function segmentText(seg: ClockSegment): string {
  if (seg.kind === 'wait') return '等'
  if (seg.kind === 'add') return seg.timed ? '要量的加法' : '加法'
  return ''
}

/** GPU 事件的两个时间戳；过了 70% 的那个，字写在竖线左边，不伸出时间线。 */
const ticks = computed(() => {
  const events = run.value.events
  if (!events) return []
  return [
    { name: 'begin', at: events.begin },
    { name: 'end', at: events.end },
  ].map((tick) => ({ ...tick, flip: tick.at / CLOCK_TOTAL > 0.7 }))
})

// ── 解读 ──
const MODE_TEXT: Record<StopMode, (queued: number) => string> = {
  return: (n) => (n === 0
    ? 'add() 一返回就停表：只量到 CPU 把加法排进队列的那一下，GPU 才刚开始算。'
    : 'add() 一返回就停表：只量到 CPU 把加法排进队列的那一下，GPU 还在算前面的加法。'),
  sync: (n) => (n === 0
    ? '等 GPU 算完再停表：量到的是排队加计算，比加法本身多出排队那一下。'
    : `等 GPU 算完再停表：前面排着的 ${n} 个加法也算了进去。`),
  event: (n) => (n === 0
    ? '队列空着：GPU 走到 begin 以后，要等 CPU 把加法交过来，这一小段空等也夹在两个时间戳之间。加法越短，它占得越多。'
    : 'GPU 走到 begin 时，前面的加法已经算完：两个时间戳之间正好是这一个加法。'),
}
/** 倍数留两位有效数字：0.13、1.1、2、2.9、1。 */
const ratioText = computed(() => String(Number(run.value.ratio.toPrecision(2))))
const readout = computed(() => `量到的时间是加法本身的 ${ratioText.value} 倍。${MODE_TEXT[mode.value](queued.value)}`)
const laneLabel = computed(() => `时间线：${current.value.label}，前面排着 ${queued.value} 个加法。${readout.value}`)
</script>

<template>
  <section class="sc" :aria-labelledby="titleId">
    <header class="sc__head">
      <span class="sc__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="sc__title">停表的时机</strong>
      <span class="sc__tag">示意图</span>
    </header>
    <p class="sc__rules">上面一条是 CPU，下面一条是 GPU 的队列，时间从左往右走；条的长短只是示意。GPU 道上写着「要量的加法」的那一段是要量的，最下面的括号是这次量到的时间。</p>

    <div class="sc__knobs">
      <Knob label="停表" :options="MODE_OPTIONS" v-model="mode" />
      <Knob label="前面排着的加法" :options="QUEUED_CHOICES" unit=" 个" v-model="queued" />
    </div>

    <div class="sc__lanes" role="img" :aria-label="laneLabel">
      <div class="sc__lane">
        <span class="sc__lane-name">CPU</span>
        <div class="sc__track">
          <span
            v-for="(seg, i) in cpuSegments"
            :key="i"
            class="sc__seg"
            :class="`is-${seg.kind}`"
            :style="{ left: pct(seg.start), width: pct(seg.end - seg.start) }"
          >{{ segmentText(seg) }}</span>
          <span class="sc__mark" :style="{ left: pct(run.start) }" />
          <span v-if="run.measured.lane === 'cpu'" class="sc__mark is-stop" :style="{ left: pct(run.measured.to) }" />
        </div>
      </div>
      <div class="sc__lane is-gpu">
        <span class="sc__lane-name">GPU</span>
        <div class="sc__track">
          <span
            v-for="(seg, i) in gpuSegments"
            :key="i"
            class="sc__seg"
            :class="[`is-${seg.kind}`, { 'is-timed': seg.timed }]"
            :style="{ left: pct(seg.start), width: pct(seg.end - seg.start) }"
          >{{ segmentText(seg) }}</span>
          <template v-for="tick in ticks" :key="tick.name">
            <span class="sc__tick" :style="{ left: pct(tick.at) }" />
            <span class="sc__tick-label" :class="{ 'is-flip': tick.flip }" :style="{ left: pct(tick.at) }">{{ tick.name }}</span>
          </template>
        </div>
      </div>
      <div class="sc__lane">
        <span class="sc__lane-name">量到</span>
        <div class="sc__track is-measured">
          <span class="sc__span" :style="{ left: pct(run.measured.from), width: pct(run.measured.to - run.measured.from) }" />
        </div>
      </div>
    </div>

    <div>
      <p class="sc__how">这样计时：</p>
      <pre class="sc__code" translate="no"><code>{{ code }}</code></pre>
    </div>

    <p class="sc__readout" aria-live="polite">{{ readout }}</p>
    <p class="sc__verdict">CPU 计时量的是 CPU 等了多久；GPU 事件量的是 GPU 走过的那一段。</p>

    <ul class="sc__legend" aria-label="图例">
      <li><span class="sc__sw is-submit" aria-hidden="true" />CPU 在把加法交给 GPU</li>
      <li><span class="sc__sw is-wait" aria-hidden="true" />CPU 在等</li>
      <li><span class="sc__sw is-add" aria-hidden="true" />GPU 在算前面的加法</li>
      <li><span class="sc__sw is-timed" aria-hidden="true" />GPU 在算要量的加法</li>
      <li><span class="sc__sw is-idle" aria-hidden="true" />GPU 空着，等 CPU 交活</li>
      <li><span class="sc__sw is-start" aria-hidden="true" />开始计时</li>
      <li><span class="sc__sw is-stop" aria-hidden="true" />停表</li>
      <li><span class="sc__sw is-event" aria-hidden="true" />GPU 事件的时间戳</li>
      <li><span class="sc__sw is-span" aria-hidden="true" />量到的时间</li>
    </ul>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同 2-2 的场景（HostSteps）。 */
.sc {
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

.sc__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.sc__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.sc__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.sc__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.sc__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.sc__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 时间线 ---------- */

.sc__lanes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sc__lane {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

/* GPU 道上方留出写 begin、end 的地方：一直留着，换旋钮时版面不跳。 */
.sc__lane.is-gpu {
  padding-top: 14px;
}

.sc__lane-name {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
}

.sc__track {
  position: relative;
  height: 24px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
}

/* 量到的那一行只画括号，不铺底。 */
.sc__track.is-measured {
  height: 12px;
  background: none;
}

.sc__seg {
  position: absolute;
  top: 2px;
  bottom: 2px;
  overflow: hidden;
  border-radius: 3px;
  color: var(--hg-ink);
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
  text-overflow: clip;
  white-space: nowrap;
}

.sc__seg.is-submit {
  background: var(--hg-ink);
}

.sc__seg.is-wait {
  background: repeating-linear-gradient(135deg, var(--hg-idle) 0 4px, transparent 4px 8px);
}

.sc__seg.is-add {
  background: var(--hg-border-strong);
}

.sc__seg.is-add.is-timed {
  background: var(--hg-accent-ink);
  color: var(--hg-surface);
}

/* GPU 空着：不铺底，只描一圈虚线。 */
.sc__seg.is-idle {
  outline: 2px dashed var(--hg-idle);
  outline-offset: -2px;
}

/* 开始计时像「[」、停表像「]」：竖线两头带短横，不只靠颜色分。 */
.sc__mark {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 6px;
  margin-left: -1px;
  border: 2px solid var(--hg-sky-ink);
  border-right: 0;
}

.sc__mark.is-stop {
  margin-left: -5px;
  border: 2px solid var(--hg-error);
  border-left: 0;
}

/* GPU 事件的时间戳：竖线比道高出一点，字写在道的上方。 */
.sc__tick {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  margin-left: -1px;
  background: var(--hg-violet-ink);
}

.sc__tick-label {
  position: absolute;
  bottom: calc(100% + 1px);
  padding: 0 4px;
  color: var(--hg-violet-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 700;
  line-height: 13px;
  white-space: nowrap;
}

/* 靠右的那个写在竖线左边，不伸出时间线。 */
.sc__tick-label.is-flip {
  transform: translateX(-100%);
}

/* 量到的时间：括号两头对着开始和停的时刻；只有半格宽时也看得见。 */
.sc__span {
  position: absolute;
  top: 0;
  height: 10px;
  min-width: 4px;
  border: 2px solid var(--hg-ink);
  border-top: 0;
}

/* ---------- 代码、解读、图例 ---------- */

.sc__how {
  margin: 0 0 6px;
  color: var(--hg-ink-2);
  font-size: 13px;
}

/* 代码比卡片宽时在代码块里横向滚动，不把卡片撑出屏幕。 */
.sc__code {
  margin: 0;
  padding: 10px 12px;
  overflow-x: auto;
  border-radius: var(--hg-radius-control);
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre;
}

.sc__code code {
  font: inherit;
}

.sc__readout {
  min-height: 3.2em;
  margin: 0;
  font-size: 15px;
}

.sc__verdict {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
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
  gap: 6px;
}

.sc__sw {
  display: inline-block;
  flex: none;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}

.sc__sw.is-submit {
  background: var(--hg-ink);
}

.sc__sw.is-wait {
  background: repeating-linear-gradient(135deg, var(--hg-idle) 0 3px, transparent 3px 6px);
}

.sc__sw.is-add {
  background: var(--hg-border-strong);
}

.sc__sw.is-timed {
  background: var(--hg-accent-ink);
}

.sc__sw.is-idle {
  outline: 2px dashed var(--hg-idle);
  outline-offset: -2px;
}

/* 线一类的图例画成和图里一样的形状：「[」「]」、一条竖线、「└┘」。 */
.sc__sw.is-start,
.sc__sw.is-stop,
.sc__sw.is-event,
.sc__sw.is-span {
  border-radius: 0;
}

.sc__sw.is-start,
.sc__sw.is-stop {
  width: 6px;
  height: 14px;
}

.sc__sw.is-start {
  border: 2px solid var(--hg-sky-ink);
  border-right: 0;
}

.sc__sw.is-stop {
  border: 2px solid var(--hg-error);
  border-left: 0;
}

.sc__sw.is-event {
  width: 2px;
  height: 14px;
  background: var(--hg-violet-ink);
}

.sc__sw.is-span {
  height: 8px;
  border: 2px solid var(--hg-ink);
  border-top: 0;
}
</style>
