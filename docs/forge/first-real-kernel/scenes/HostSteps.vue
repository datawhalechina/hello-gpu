<script setup lang="ts">
/**
 * 2-2 探索二「运行」（关卡自己的 scenes，不用登记组件）：主机端的五步，申请显存 → 拷进 → 启动 → 同步 → 拷回。
 *
 * 旋钮一选走到第几步，开关决定留不留 ④。上半是数据在哪：主机内存和显存各三块；下半是时间线，
 * CPU、拷贝、GPU 三条道（示意，长短不是实测），竖线是 CPU 走到的地方，竖线右边的活还没做完。
 * 规则和时间线在 kernel.ts（hostState、hostTimeline）。③ 那一行代码按读者当前路线显示：同 RouteBlock，
 * 由 <html data-hg-route> 上的 CSS 决定。
 */
import { computed, ref, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { LAUNCH_LINES, hostState, hostSteps, hostTimeline, type BufferState, type Lane, type StepId } from '../kernel.ts'

const titleId = `${useId()}-title`

const withSync = ref(true)
const step = ref<StepId>('alloc')
const steps = computed(() => hostSteps(withSync.value))
// 去掉 ④ 时正停在 ④：挪到 ⑤，看 CPU 在那里替它等。
watch(withSync, (on) => {
  if (!on && step.value === 'sync') step.value = 'copyOut'
})
const options = computed(() => steps.value.map((s) => ({ value: s.id, label: `${s.mark} ${s.short}` })))
const current = computed(() => steps.value.find((s) => s.id === step.value) ?? steps.value[0])
const state = computed(() => hostState(current.value.id, withSync.value))

const STATE_TEXT: Record<BufferState, string> = { none: '还没有', empty: '空的', data: '有数', pending: '在算', result: '结果' }
const hostBuffers = computed(() => Object.entries(state.value.host).map(([name, s]) => ({ name, state: s })))
const deviceBuffers = computed(() => Object.entries(state.value.device).map(([name, s]) => ({ name, state: s })))

// ── 时间线 ──
const LANES: { id: Lane; name: string }[] = [
  { id: 'cpu', name: 'CPU' },
  { id: 'copy', name: '拷贝' },
  { id: 'gpu', name: 'GPU' },
]
const SEGMENT_TEXT = { run: '', wait: '等', copy: '拷', compute: '在算' } as const
const timeline = computed(() => hostTimeline(withSync.value))
const end = computed(() => Math.max(...timeline.value.map((s) => s.end)))
const order = computed(() => steps.value.map((s) => s.id))
/** 走到这一步、CPU 正要往下走的时刻：这一步 CPU 那一段的结尾。 */
const now = computed(() => Math.max(...timeline.value
  .filter((s) => s.lane === 'cpu' && s.step === current.value.id)
  .map((s) => s.end)))
const lanes = computed(() => LANES.map((lane) => ({
  ...lane,
  segments: timeline.value.filter((s) => s.lane === lane.id && order.value.indexOf(s.step) <= order.value.indexOf(current.value.id)),
})))
const pct = (t: number) => `${(t / end.value) * 100}%`
const laneLabel = computed(() => {
  const gpu = state.value.gpuDone ? 'GPU 已经算完' : order.value.indexOf(current.value.id) >= order.value.indexOf('launch') ? 'GPU 还在算' : 'GPU 还没开始'
  return `时间线：CPU 走到${current.value.mark}${current.value.name}，${gpu}`
})

const STEP_TEXT: Record<StepId, string> = {
  alloc: '显存里划出 d_a、d_b、d_out 三块，里面还没有数。',
  copyIn: 'h_a、h_b 拷进 d_a、d_b。拷完这一行才返回，CPU 一直在等。',
  launch: 'kernel 排进 GPU 的队列，这一行马上返回。GPU 才开始算，d_out 还没好。',
  sync: 'CPU 停在这一行，等 GPU 把 d_out 算完。',
  copyOut: 'd_out 拷回 h_out。GPU 早已算完，拷完 CPU 就拿到了结果。',
}
const text = computed(() => (current.value.id === 'copyOut' && !withSync.value
  ? '没有 ④，CPU 直接走到这一行。拷贝排在 kernel 后面，先等它算完再搬：h_out 照样是对的。'
  : STEP_TEXT[current.value.id]))
const verdict = computed(() => (withSync.value
  ? '③ 一交出去就返回，GPU 还在算：要用结果，先等它算完。'
  : '去掉 ④ 结果也对：拷回排在 kernel 后面，替你等了。'))
</script>

<template>
  <section class="hs" :aria-labelledby="titleId">
    <header class="hs__head">
      <span class="hs__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="hs__title">主机端的五步</strong>
      <span class="hs__tag">示意图</span>
    </header>
    <p class="hs__rules">上面看数据在哪，下面看谁在忙。时间线有 CPU、拷贝、GPU 三条道，条的长短只是示意；竖线是 CPU 走到的地方。</p>

    <div class="hs__knobs">
      <Knob label="走到第几步" :options="options" v-model="step" />
      <Knob label="④ 同步" code="torch.cuda.synchronize()" mode="switch" on="留着" off="去掉" v-model="withSync" />
    </div>

    <div class="hs__mem">
      <div class="hs__side">
        <p class="hs__side-name">主机内存（CPU）</p>
        <ul class="hs__bufs">
          <li v-for="b in hostBuffers" :key="b.name" class="hs__buf" :class="`is-${b.state}`">
            <code>{{ b.name }}</code><span>{{ STATE_TEXT[b.state] }}</span>
          </li>
        </ul>
      </div>
      <div class="hs__side">
        <p class="hs__side-name">显存（GPU）</p>
        <ul class="hs__bufs">
          <li v-for="b in deviceBuffers" :key="b.name" class="hs__buf" :class="`is-${b.state}`">
            <code>{{ b.name }}</code><span>{{ STATE_TEXT[b.state] }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div class="hs__lanes" role="img" :aria-label="laneLabel">
      <div v-for="lane in lanes" :key="lane.id" class="hs__lane">
        <span class="hs__lane-name">{{ lane.name }}</span>
        <div class="hs__track">
          <span
            v-for="(seg, i) in lane.segments"
            :key="i"
            class="hs__seg"
            :class="[`is-${seg.kind}`, { 'is-ahead': seg.end > now }]"
            :style="{ left: pct(seg.start), width: pct(seg.end - seg.start) }"
          >{{ SEGMENT_TEXT[seg.kind] }}</span>
          <span class="hs__now" :style="{ left: pct(now) }" />
        </div>
      </div>
    </div>

    <dl class="hs__code">
      <div>
        <dt>HIP 运行时</dt>
        <dd><code>{{ current.hip }}</code></dd>
      </div>
      <div>
        <dt>Notebook 里</dt>
        <dd>
          <template v-if="current.id === 'launch'">
            <code class="hs__launch" data-route="hip">{{ LAUNCH_LINES.hip }}</code>
            <code class="hs__launch" data-route="triton">{{ LAUNCH_LINES.triton }}</code>
          </template>
          <code v-else>{{ current.torch }}</code>
        </dd>
      </div>
    </dl>

    <p class="hs__readout" aria-live="polite">{{ current.mark }} {{ current.name }}：{{ text }}</p>
    <p class="hs__verdict">{{ verdict }}</p>

    <ul class="hs__legend" aria-label="图例">
      <li><span class="hs__sw is-run" aria-hidden="true" />CPU 在做事</li>
      <li><span class="hs__sw is-wait" aria-hidden="true" />CPU 在等</li>
      <li><span class="hs__sw is-copy" aria-hidden="true" />拷贝</li>
      <li><span class="hs__sw is-compute" aria-hidden="true" />GPU 在算</li>
      <li><span class="hs__sw is-ahead" aria-hidden="true" />竖线右边：CPU 走开时还没做完</li>
    </ul>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同 2-1 的场景。 */
.hs {
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

.hs__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.hs__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hs__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.hs__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.hs__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.hs__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 数据在哪：两边各三块 ---------- */

.hs__mem {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.hs__side {
  padding: 10px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.hs__side-name {
  margin: 0 0 6px;
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 700;
}

.hs__bufs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hs__buf {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 3px 8px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-ink-3);
  font-size: 13px;
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    color var(--motion-fast) var(--motion-ease-out);
}

.hs__buf code {
  font-family: var(--hg-font-mono);
}

/* 状态不只靠颜色：右边写着「空的 / 有数 / 在算 / 结果」，边框也从虚线变实线。 */
.hs__buf.is-empty,
.hs__buf.is-data,
.hs__buf.is-pending,
.hs__buf.is-result {
  border-style: solid;
  color: var(--hg-ink);
}

.hs__buf.is-data {
  background: var(--hg-surface);
}

.hs__buf.is-pending {
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
}

.hs__buf.is-result {
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
  font-weight: 700;
}

/* ---------- 时间线 ---------- */

.hs__lanes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hs__lane {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.hs__lane-name {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
}

.hs__track {
  position: relative;
  height: 24px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
}

.hs__seg {
  position: absolute;
  top: 2px;
  bottom: 2px;
  overflow: hidden;
  border-radius: 3px;
  color: var(--hg-surface);
  font-size: 11px;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
  white-space: nowrap;
}

.hs__seg.is-run {
  background: var(--hg-ink);
}

.hs__seg.is-wait {
  background: repeating-linear-gradient(135deg, var(--hg-idle) 0 4px, transparent 4px 8px);
  color: var(--hg-ink);
}

.hs__seg.is-copy {
  background: var(--hg-sky-ink);
}

.hs__seg.is-compute {
  background: var(--hg-accent-ink);
}

/* CPU 走开时还没做完的活：描一圈虚线框。 */
.hs__seg.is-ahead {
  outline: 2px dashed var(--hg-ink);
  outline-offset: -2px;
}

.hs__now {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  background: var(--hg-error);
}

/* ---------- 代码、解读、图例 ---------- */

.hs__code {
  display: grid;
  gap: 6px;
  margin: 0;
}

.hs__code div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
}

.hs__code dt {
  color: var(--hg-ink-2);
  font-size: 13px;
}

.hs__code dd {
  margin: 0;
}

.hs__code code {
  font-family: var(--hg-font-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
}

/* ③ 的写法按路线显示（默认 HIP，同 RouteBlock）。 */
.hs__launch[data-route='triton'],
html[data-hg-route='triton'] .hs__launch[data-route='hip'] {
  display: none;
}

html[data-hg-route='triton'] .hs__launch[data-route='triton'] {
  display: inline;
}

.hs__readout {
  min-height: 3.2em;
  margin: 0;
  font-size: 15px;
}

.hs__verdict {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.hs__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.hs__legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hs__sw {
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}

.hs__sw.is-run {
  background: var(--hg-ink);
}

.hs__sw.is-wait {
  background: repeating-linear-gradient(135deg, var(--hg-idle) 0 3px, transparent 3px 6px);
}

.hs__sw.is-copy {
  background: var(--hg-sky-ink);
}

.hs__sw.is-compute {
  background: var(--hg-accent-ink);
}

.hs__sw.is-ahead {
  outline: 2px dashed var(--hg-ink);
  outline-offset: -2px;
}

@media (max-width: 480px) {
  .hs__mem {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
