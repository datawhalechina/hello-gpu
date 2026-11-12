<script setup lang="ts">
/**
 * 2-5 探索一、二的 trace 浏览器（关卡自己的 scenes，不用登记组件）：一行 PyTorch 在 CPU、GPU 上各做了什么。
 *
 * 三条道同 hg.trace 画的时间线：CPU 上的算子（只画这一行直接调用的那些）、CPU 上的启动（运行时调用）、GPU 上的 kernel；
 * 一个算子和它启动的东西同一种颜色（--hg-group-*，只区分第几组，不表达好坏），GPU 那条道上的编号就是 kernel 表里的 #。
 * 点时间线上的一段，或者 kernel 表里的一行，看它是哪个算子启动的、在 GPU 上排队还是空等；表里的按钮键盘可达，
 * 时间线拿到焦点后也能用方向键选（← → 同一条道上的前后一段，↑ ↓ 换道，Home / End 到两头，Esc 取消）。
 * 选中的那一组在时间线上突出、别的变淡（不只靠颜色：选中的那段加粗描边，表里那一行也标出来）。
 * 时间轴可以看整行，或者只看 CPU 交完以前（数据大时 CPU 那几段很窄）。
 * 数据用 useTraces：你导入的 → 档案馆 → 示意。图按容器的实际宽度画（ResizeObserver，同 2-4 的 RooflineLab），
 * 挂载之前只留一块同样高的空位。
 */
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { formatTick } from '@course/labArchive.ts'
import {
  LANES, busyText, gpuRows, gpuWait, laneItems, lineSummary, nearestItem, pickLine, shareText, slowestIndex, stepItem, timeTicks,
  timeWindow, topOp, usText, type Lane, type LaneItem, type StepMove, type TraceGpu, type TraceLine, type WindowMode,
} from '../trace.ts'
import TraceSource from './TraceSource.vue'
import { useTraces } from './useTraces.ts'

const props = withDefaults(defineProps<{
  /** 先看哪一行：按顺序找第一个有的，都没有就看第一行。 */
  prefer?: readonly string[]
  title?: string
}>(), { prefer: () => [], title: '一行 PyTorch 的 trace' })

const uid = useId()
const titleId = `${uid}-title`
const { set, mine, showReference } = useTraces()

// ── 看哪一行、看哪一段时间 ───────────────────────────────────────────────────

const lineName = ref(pickLine(set.value, props.prefer)?.line.name ?? '')
// 换了数据（导入、换回参考数据）就回到这个浏览器先看的那一行
watch(set, (next) => {
  lineName.value = pickLine(next, props.prefer)?.line.name ?? ''
})
const current = computed(() => set.value.lines.find((l) => l.line.name === lineName.value) ?? pickLine(set.value, props.prefer))
const line = computed(() => current.value?.line ?? null)
const lineOptions = computed(() => set.value.lines.map((l) => l.line.name))

const mode = ref<WindowMode>('all')
const MODE_OPTIONS = [
  { value: 'all', label: '整行' },
  { value: 'cpu', label: 'CPU 交完以前' },
]

// ── 选中的一段 ──────────────────────────────────────────────────────────────

const selected = ref<{ lane: Lane; index: number } | null>(null)
watch(line, () => {
  selected.value = null
})

const summary = computed(() => (line.value ? lineSummary(line.value) : null))
const rows = computed(() => (line.value ? gpuRows(line.value) : []))
const slowest = computed(() => (line.value ? slowestIndex(line.value) : null))
const items = computed(() => (line.value ? laneItems(line.value) : []))
/** GPU 上第几个事件属于哪一组：kernel 表的色块和时间线同色。 */
const gpuGroups = computed(() => new Map(items.value.flatMap((item) => (item.lane === 'gpu' ? [[item.index, item.group] as const] : []))))
/** 选中的那一段属于哪一组（哪个顶层算子）；没选、或者找不到算子是 null。 */
const selectedGroup = computed(() => {
  const s = selected.value
  return s ? (items.value.find((item) => item.lane === s.lane && item.index === s.index)?.group ?? null) : null
})

const isPicked = (lane: Lane, index: number) => selected.value?.lane === lane && selected.value.index === index

function toggle(lane: Lane, index: number) {
  selected.value = isPicked(lane, index) ? null : { lane, index }
}

// ── 画布 ──────────────────────────────────────────────────────────────────

const box = ref<HTMLElement | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)
const width = ref(0)
let observer: ResizeObserver | null = null
onMounted(() => {
  if (!box.value) return
  width.value = Math.floor(box.value.clientWidth)
  observer = new ResizeObserver(([entry]) => {
    width.value = Math.floor(entry.contentRect.width)
  })
  observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

/** 绘图区四周留的位置（像素）：左边写道名，下边写时间刻度。 */
const PAD = { left: 40, right: 12, top: 4, bottom: 22 }
const LANE_H = 26
const LANE_GAP = 10
const HEIGHT = PAD.top + LANES.length * LANE_H + (LANES.length - 1) * LANE_GAP + PAD.bottom
/** 再短的段也画这么宽（像素），看得见、点得到。 */
const MIN_W = 2
/** 12px 的字一个大约多宽（像素）：段里写得下才写名字。 */
const CHAR_W = 7
const LANE_NAME: Record<Lane, string> = { op: '算子', launch: '启动', gpu: 'GPU' }

const laneTop = (lane: Lane) => PAD.top + LANES.indexOf(lane) * (LANE_H + LANE_GAP)

/** 段里写什么：算子那条道写算子名（去掉 aten::），GPU 那条道写 kernel 表里的编号；写不下就不写。 */
function barLabel(l: TraceLine, item: LaneItem, w: number): string {
  const text = item.lane === 'op' ? (l.ops[item.index].name.split('::').at(-1) ?? '') : item.lane === 'gpu' ? `#${item.index + 1}` : ''
  return text && text.length * CHAR_W + 8 <= w ? text : ''
}

const chart = computed(() => {
  const l = line.value
  if (!l || width.value <= PAD.left + PAD.right + 40) return null
  const win = timeWindow(l, mode.value)
  const left = PAD.left
  const right = width.value - PAD.right
  const scale = (right - left) / (win.to - win.from)
  const sx = (t: number) => left + (t - win.from) * scale
  const bars = items.value.flatMap((item) => {
    const x0 = sx(item.start)
    const x1 = sx(item.start + item.dur)
    if (x1 < left || x0 > right) return []
    const x = Math.min(Math.max(x0, left), right - MIN_W)
    const w = Math.max(Math.min(x1, right) - x, MIN_W)
    return [{ ...item, x, y: laneTop(item.lane), w, label: barLabel(l, item, w) }]
  })
  const ticks = timeTicks(win, Math.max(2, Math.floor((right - left) / 90))).map((t) => ({ x: sx(t), label: formatTick(t) }))
  return { win, left, right, scale, bars, ticks, axisY: HEIGHT - PAD.bottom }
})

function barClass(bar: LaneItem) {
  const picked = isPicked(bar.lane, bar.index)
  const group = selectedGroup.value
  return [`is-${bar.lane}`, { 'is-picked': picked, 'is-dim': !!selected.value && !picked && (group === null || bar.group !== group) }]
}

const groupStyle = (group: number | null) => ({ '--g': group === null ? 'var(--hg-idle)' : `var(--hg-group-${group % 6})` })

/** 在图上点一下：按点的高度找道，按横坐标找最近的一段（8 像素以内）；点中已选的那段或者空白处就取消。 */
function onClick(event: MouseEvent) {
  const c = chart.value
  const rect = svgEl.value?.getBoundingClientRect()
  if (!c || !rect) return
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const lane = LANES.find((name) => y >= laneTop(name) - LANE_GAP / 2 && y <= laneTop(name) + LANE_H + LANE_GAP / 2)
  const hit = lane && x >= c.left - 8 && x <= c.right + 8 ? nearestItem(items.value, lane, c.win.from + (x - c.left) / c.scale, 8 / c.scale) : null
  selected.value = hit && !isPicked(hit.lane, hit.index) ? { lane: hit.lane, index: hit.index } : null
}

const KEY_MOVES: Record<string, StepMove> = {
  ArrowLeft: 'prev', ArrowRight: 'next', ArrowUp: 'up', ArrowDown: 'down', Home: 'first', End: 'last',
}

/** 时间线拿到焦点时用键盘选一段（规则在 trace.ts 的 stepItem）；Esc 取消选中。 */
function onKey(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'Escape') {
    if (!selected.value) return
    selected.value = null
    event.preventDefault()
    return
  }
  const move = KEY_MOVES[event.key]
  if (!move) return
  event.preventDefault()
  const next = stepItem(items.value, selected.value, move)
  if (next) selected.value = { lane: next.lane, index: next.index }
}

// ── 解读 ──────────────────────────────────────────────────────────────────

const KIND_NAME: Record<TraceGpu['kind'], string> = { kernel: 'kernel', memcpy: '拷贝', memset: '填充' }

function gpuText(l: TraceLine, i: number): string {
  const row = rows.value[i]
  const e = row.event
  const w = gpuWait(l, i)
  const head = `第 ${i + 1} 个${e.kind === 'kernel' ? ' kernel' : KIND_NAME[e.kind]}：${row.op} 启动的 ${row.kernel}。`
    + `GPU 上从 ${usText(e.start)} 开始，跑了 ${usText(e.dur)}，占 GPU 时间的 ${shareText(row.share)}。`
  const launch = e.launch === null ? '' : l.launches[e.launch].name
  if (w.kind === 'queued') {
    return `${head}${launch} 在 ${usText(w.handedAt ?? 0)} 返回，它就排进了 GPU 的队列；前面的活到 ${usText(w.freeAt)} 才做完，它排了 ${usText(w.queueUs ?? 0)}。`
  }
  if (w.kind === 'waited') {
    const first = !l.gpu.slice(0, i).some((other) => other.stream === e.stream)
    return first
      ? `${head}这一行开始以后，CPU 先走一遍 Python 和 PyTorch 的分派，${launch} 到 ${usText(w.handedAt ?? 0)} 才返回：GPU 空着等了 ${usText(w.idleUs)}。`
      : `${head}前面的活在 ${usText(w.freeAt)} 就做完了，${launch} 到 ${usText(w.handedAt ?? 0)} 才返回：GPU 空着等了 ${usText(w.idleUs)}。`
  }
  return `${head}trace 里没找到启动它的运行时调用，看不出它等了多久。`
}

function launchText(l: TraceLine, i: number): string {
  const launch = l.launches[i]
  const top = topOp(l, launch.op)
  const kernels = l.gpu.flatMap((e, k) => (e.launch === i ? [k] : []))
  const where = top === null ? '不在哪个算子里' : `${l.ops[top].name} 里调用的`
  const head = `${launch.name}（${where}）：CPU 上从 ${usText(launch.start)} 开始，用了 ${usText(launch.dur)}。`
  return kernels.length
    ? `${head}它交给 GPU 的是第 ${kernels.map((k) => k + 1).join('、')} 个，GPU 上 ${usText(l.gpu[kernels[0]].start)} 才开始算。`
    : `${head}GPU 上没有找到它交出去的事件。`
}

function opText(l: TraceLine, i: number): string {
  const op = l.ops[i]
  const inner = l.ops.filter((other, k) => k !== i && topOp(l, k) === i).map((other) => other.name)
  const kernels = l.gpu.flatMap((e, k) => (topOp(l, e.op) === i ? [k] : []))
  const busy = kernels.reduce((sum, k) => sum + l.gpu[k].dur, 0)
  const head = `${op.name}：这一行直接调用的算子，CPU 上从 ${usText(op.start)} 开始，用了 ${usText(op.dur)}${inner.length ? `，里面又调用了 ${[...new Set(inner)].join('、')}` : ''}。`
  return kernels.length
    ? `${head}它启动了 ${kernels.length} 个（第 ${kernels.map((k) => k + 1).join('、')} 个），在 GPU 上一共跑了 ${usText(busy)}。`
    : `${head}它没有在 GPU 上启动东西。`
}

const readout = computed(() => {
  const l = line.value
  const s = selected.value
  if (!l) return ''
  if (!s) {
    return l.gpu.length
      ? '点时间线上的一段，或者下面表里的一行，看它是哪个算子启动的、在 GPU 上排队还是空等。'
      : '这一行在 GPU 上一个事件也没有：没有启动 kernel（还没写完，或者算的东西不在 GPU 上）。'
  }
  return s.lane === 'gpu' ? gpuText(l, s.index) : s.lane === 'launch' ? launchText(l, s.index) : opText(l, s.index)
})

const slowestText = computed(() => {
  const i = slowest.value
  if (i === null) return ''
  const row = rows.value[i]
  return `最耗时的是第 ${i + 1} 个：${row.op} 启动的 ${row.kernel}，占 GPU 时间的 ${shareText(row.share)}。`
})

const busyVerdict = computed(() => {
  const s = summary.value
  if (!s || !line.value?.gpu.length) return ''
  const busy = busyText(s.busy)
  if (s.busy >= 0.9) return `GPU 忙的时间占 ${busy}：CPU 在 ${usText(s.cpuUs)} 就交完了这一行，后面的活都在 GPU 的队列里排着。`
  if (s.busy < 0.5) return `GPU 忙的时间只占 ${busy}：kernel 一下就算完，GPU 大部分时间空着，等 CPU 把下一个交过来。`
  return `GPU 忙的时间占 ${busy}：还有 ${usText(s.idleUs)} GPU 空着，在等 CPU 把活交过来。`
})

const others = computed(() => {
  const s = summary.value
  return s ? [s.memcpy ? `${s.memcpy} 次拷贝` : '', s.memset ? `${s.memset} 次填充` : ''].filter(Boolean).join('、') : ''
})

const svgLabel = computed(() => {
  const s = summary.value
  return line.value && s
    ? `${line.value.name} 这一行的时间线：${s.kernels} 个 kernel，从开始到算完 ${usText(s.spanUs)}，GPU 忙的比例 ${busyText(s.busy)}。`
      + '用方向键选一段：左右换前后，上下换道，Esc 取消；下面的表也列着每个 kernel。'
    : ''
})
</script>

<template>
  <section class="tb" :aria-labelledby="titleId">
    <header class="tb__head">
      <span class="tb__eyebrow" aria-hidden="true">TRACE</span>
      <strong :id="titleId" class="tb__title">{{ title }}</strong>
    </header>
    <TraceSource :source="set.source" :line="current" :entry="set.entry" :has-mine="!!mine" @toggle="showReference = !showReference" />

    <div class="tb__knobs">
      <Knob label="看哪一行" :options="lineOptions" v-model="lineName" />
      <Knob label="时间轴" :options="MODE_OPTIONS" v-model="mode" />
    </div>

    <dl v-if="summary" class="tb__stats">
      <div>
        <dt>kernel 数</dt>
        <dd>{{ summary.kernels }}<small v-if="others">（另有 {{ others }}）</small></dd>
      </div>
      <div>
        <dt>GPU 忙</dt>
        <dd>{{ usText(summary.gpuUs) }}</dd>
      </div>
      <div>
        <dt>从开始到算完</dt>
        <dd>{{ usText(summary.spanUs) }}</dd>
      </div>
      <div>
        <dt>GPU 忙的比例</dt>
        <dd>{{ busyText(summary.busy) }}</dd>
      </div>
      <div>
        <dt>CPU 交完</dt>
        <dd>{{ usText(summary.cpuUs) }}</dd>
      </div>
    </dl>

    <figure class="tb__figure">
      <p class="tb__axis">上面两条道在 CPU 上（PyTorch 的算子、启动 kernel 的运行时调用），最下面一条在 GPU 上；同色的是同一个算子</p>
      <div ref="box" class="tb__plot" :style="{ height: `${HEIGHT}px` }">
        <svg
          v-if="chart"
          ref="svgEl"
          class="tb__svg"
          :width="width"
          :height="HEIGHT"
          :viewBox="`0 0 ${width} ${HEIGHT}`"
          role="group"
          tabindex="0"
          :aria-label="svgLabel"
          @click="onClick"
          @keydown="onKey"
        >
          <g aria-hidden="true">
            <template v-for="lane in LANES" :key="lane">
              <rect class="tb__lane" :x="chart.left" :y="laneTop(lane)" :width="chart.right - chart.left" :height="LANE_H" />
              <text class="tb__lane-name" :x="chart.left - 6" :y="laneTop(lane) + LANE_H / 2" text-anchor="end" dominant-baseline="middle">{{ LANE_NAME[lane] }}</text>
            </template>
            <line class="tb__base" :x1="chart.left" :x2="chart.right" :y1="chart.axisY" :y2="chart.axisY" />
            <g v-for="(t, i) in chart.ticks" :key="`t${i}`">
              <line class="tb__grid" :x1="t.x" :x2="t.x" :y1="PAD.top" :y2="chart.axisY + 3" />
              <text class="tb__tick" :x="t.x" :y="chart.axisY + 15" :text-anchor="t.x > chart.right - 24 ? 'end' : 'middle'">{{ t.label }}</text>
            </g>
            <g v-for="bar in chart.bars" :key="`${bar.lane}${bar.index}`" class="tb__bar" :class="barClass(bar)" :style="groupStyle(bar.group)">
              <rect :x="bar.x" :y="bar.lane === 'launch' ? bar.y + 5 : bar.y" :width="bar.w" :height="bar.lane === 'launch' ? LANE_H - 10 : LANE_H" rx="2" />
              <text v-if="bar.label" :x="bar.x + bar.w / 2" :y="bar.y + LANE_H / 2" text-anchor="middle" dominant-baseline="middle">{{ bar.label }}</text>
            </g>
          </g>
        </svg>
      </div>
      <p class="tb__axis is-x">横轴：从这一行开始算起的时间（µs）</p>
    </figure>

    <p class="tb__readout" aria-live="polite">{{ readout }}</p>

    <div v-if="rows.length" class="tb__rows">
      <table class="tb__table">
        <caption>GPU 上的 {{ rows.length }} 个事件，按开始的先后；点一行在时间线上找到它</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">哪个算子启动的 · kernel</th>
            <th scope="col">耗时</th>
            <th scope="col">占 GPU 时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.index" :class="{ 'is-picked': isPicked('gpu', row.index), 'is-slowest': row.index === slowest }">
            <td>{{ row.index + 1 }}</td>
            <td>
              <button type="button" class="tb__pick" :aria-pressed="isPicked('gpu', row.index)" @click="toggle('gpu', row.index)">
                <span class="tb__swatch" :style="groupStyle(gpuGroups.get(row.index) ?? null)" aria-hidden="true" />
                <span class="tb__op">{{ row.op }}</span>
                <span class="tb__kernel" translate="no">{{ row.event.kind === 'kernel' ? row.kernel : `${KIND_NAME[row.event.kind]}：${row.kernel}` }}</span>
              </button>
            </td>
            <td>{{ usText(row.event.dur) }}</td>
            <td>{{ shareText(row.share) }}<span v-if="row.index === slowest" class="tb__badge">最耗时</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="slowestText" class="tb__verdict">{{ slowestText }}</p>
    <p v-if="busyVerdict" class="tb__verdict">{{ busyVerdict }}</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、标签同 2-4 的场景。 */
.tb {
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

.tb__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.tb__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.tb__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.tb__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 汇总：同 hg.trace 打印的五个数 ---------- */

.tb__stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 8px;
  margin: 0;
}

.tb__stats div {
  padding: 8px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
}

.tb__stats dt {
  color: var(--hg-ink-2);
  font-size: 13px;
}

.tb__stats dd {
  margin: 2px 0 0;
  font-family: var(--hg-font-display);
  font-size: 17px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.tb__stats small {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-body);
  font-size: 12px;
  font-weight: 400;
}

/* ---------- 时间线：高度由这里定，挂载前后一样高 ---------- */

.tb__figure {
  margin: 0;
}

.tb__axis {
  margin: 0 0 6px;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.tb__axis.is-x {
  margin: 4px 0 0;
  text-align: right;
}

.tb__plot {
  min-width: 0;
}

.tb__svg {
  display: block;
  cursor: pointer;
  user-select: none;
}

.tb__svg:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.tb__lane {
  fill: var(--hg-surface-2);
}

.tb__lane-name {
  fill: var(--hg-ink-2);
  font-size: 12px;
}

.tb__base {
  stroke: var(--hg-border-strong);
  stroke-width: 1;
}

.tb__grid {
  stroke: var(--hg-border);
  stroke-width: 1;
}

.tb__tick {
  fill: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

/* 分组色在亮暗两种主题里一样（01 第 2.3 节），上面的字用固定的深色才看得清。 */
.tb__bar rect {
  fill: var(--g);
  stroke: var(--hg-border-strong);
  stroke-width: 0.5;
  transition: opacity var(--motion-fast) var(--motion-ease-out);
}

.tb__bar text {
  fill: var(--hg-code-bg);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
  pointer-events: none;
}

.tb__bar.is-dim rect,
.tb__bar.is-dim text {
  opacity: 0.25;
}

.tb__bar.is-picked rect {
  stroke: var(--hg-ink);
  stroke-width: 2;
}

/* ---------- 解读和 kernel 表 ---------- */

/* 解读换成长的那句时下面的表少跳一点：至少留两行高（窄屏上解读本来就更长）。 */
.tb__readout {
  min-height: 3.4em;
  margin: 0;
  font-size: 15px;
}

.tb__rows {
  max-height: 24em;
  overflow-y: auto;
}

.tb__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 14px;
}

.tb__table caption {
  margin-bottom: 6px;
  color: var(--hg-ink-2);
  font-size: 13px;
  text-align: left;
}

.tb__table th,
.tb__table td {
  padding: 4px 8px;
  border: 0;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
  background: none;
  text-align: left;
  vertical-align: middle;
}

.tb__table thead th {
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 600;
}

.tb__table td {
  font-variant-numeric: tabular-nums;
}

/* 耗时：数和单位不拆成两行。 */
.tb__table td:nth-child(3) {
  white-space: nowrap;
}

.tb__table tr.is-picked {
  background: var(--hg-accent-soft);
}

.tb__pick {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0 8px;
  width: 100%;
  min-height: 40px;
  padding: 4px 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tb__pick:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.tb__swatch {
  grid-row: span 2;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--g);
}

.tb__op {
  font-weight: 600;
}

.tb__kernel {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.tb__badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
  font-size: 12px;
  font-weight: 700;
}

.tb__verdict {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

@media (max-width: 520px) {
  .tb {
    padding: 16px;
  }

  .tb__table th,
  .tb__table td {
    padding: 4px;
  }
}
</style>
