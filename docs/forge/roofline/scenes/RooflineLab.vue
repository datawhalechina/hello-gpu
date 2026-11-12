<script setup lang="ts">
/**
 * 2-4 探索三「屋顶线」（关卡自己的 scenes，不用登记组件）：用这组峰值画屋顶线，拖动矩阵乘的点，看它在拐点哪边、归谁管。
 *
 * 双对数坐标：横轴是算术强度（FLOP/字节），纵轴是算力（TFLOPS）。屋顶 = min(峰值带宽 × 算术强度, 峰值算力)，
 * 斜坡和平顶交在拐点（竖虚线）；拐点左边铺浅底、写「归带宽管」，右边写「归算力管」。三个点都画在各自的屋顶上，
 * 那是它们最快能到的地方：
 * - 加法（Notebook 的 2²⁶ 个数）：算术强度定死在 1/12，拖不动，点它会说为什么；
 * - 矩阵乘（4096×k 乘 k×4096）：拖方块、在图上点一下、用旋钮或方向键换 k（2 的幂，16 到 4096）；
 * - FMA 测试：hg.peak() 量峰值算力的 kernel。k = 4096 时矩阵乘和它的算术强度一样（都是 4096 × 2 ÷ 12）。
 * 图按容器的实际宽度画（ResizeObserver，同 kit/lab/ArchiveOutput），刻度的字号就是像素；高度由 CSS 定，
 * 挂载之前只留一块同样高的空位。不只靠颜色区分：三个点形状不同，图下面的表写着每个点的数和归谁管。
 * 峰值用 usePeak（你的卡 → 档案馆 → 标称）；数在 roofline.ts。
 */
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import {
  ADD_N, BOUND_TEXT, FMA_TEST, MM_KS, MM_K_DEFAULT, MM_SIZE, addWork, decadeLabel, fmaWork, intensityOf, logFraction, logValueAt,
  mmIntensity, nearestK, powerText, ridgeOf, roofAt, roofAxes, roofPoint, sig, type Bound,
} from '../roofline.ts'
import PeakSource from './PeakSource.vue'
import { usePeak } from './usePeak.ts'

const uid = useId()
const titleId = `${uid}-title`
const { card, mine, peak, showReference } = usePeak()

// ── 三个点 ──────────────────────────────────────────────────────────────────

const ADD_INTENSITY = intensityOf(addWork(ADD_N))
const FMA_COUNT = FMA_TEST.chains * FMA_TEST.iterations
const FMA_INTENSITY = intensityOf(fmaWork(FMA_COUNT))
const K_OPTIONS = MM_KS.map((value) => ({ value, label: String(value) }))

const k = ref<number>(MM_K_DEFAULT)
/** 点了加法或 FMA 测试那一下的说明；换 k 时清掉。 */
const note = ref('')
watch(k, () => {
  note.value = ''
})

const ridge = computed(() => ridgeOf(peak.value))
type PointKey = 'add' | 'mm' | 'fma'
const rows = computed(() => [
  { key: 'add' as PointKey, name: `加法（${powerText(26)} 个数）`, ...roofPoint(peak.value, ADD_INTENSITY) },
  { key: 'mm' as PointKey, name: `矩阵乘（k = ${k.value}）`, ...roofPoint(peak.value, mmIntensity(k.value)) },
  { key: 'fma' as PointKey, name: 'FMA 测试', ...roofPoint(peak.value, FMA_INTENSITY) },
])
const mm = computed(() => rows.value[1])

const SIDE: Record<Bound, string> = { bandwidth: '左边', compute: '右边' }
const BOUND_SHORT: Record<Bound, string> = { bandwidth: '带宽', compute: '算力' }

const mmText = computed(() => {
  const p = mm.value
  const head = `矩阵乘（${MM_SIZE}×${k.value} 乘 ${k.value}×${MM_SIZE}）：算术强度 ${sig(p.intensity)} FLOP/字节，`
    + `在拐点（${sig(ridge.value)}）${SIDE[p.bound]}，${BOUND_TEXT[p.bound]}。`
  return p.bound === 'bandwidth'
    ? `${head}最快 ${sig(p.roof)} TFLOPS，就是峰值带宽 × 算术强度。k 越大，每搬 1 字节算得越多，点往右挪。`
    : `${head}最快 ${sig(p.roof)} TFLOPS，就是峰值算力；k 再大，屋顶也不会再高。`
})
const readout = computed(() => note.value || mmText.value)
const sliderText = computed(() => `k = ${k.value}：算术强度 ${sig(mm.value.intensity)} FLOP/字节，${BOUND_TEXT[mm.value.bound]}`)

const ADD_NOTE = '加法拖不动：每个数做 1 次加法、搬 12 字节，不管 n 多大，算术强度都是 1/12。n 只决定实测的点离屋顶多远。'
const FMA_NOTE = `FMA 测试是量峰值算力用的：每个线程做 ${FMA_COUNT} 次 FMA，算术强度固定在 ${sig(FMA_INTENSITY)} FLOP/字节。拖方块（矩阵乘）试试。`

// ── 画布 ──────────────────────────────────────────────────────────────────

const box = ref<HTMLElement | null>(null)
const svgEl = ref<SVGSVGElement | null>(null)
const mmEl = ref<SVGGElement | null>(null)
const size = ref({ width: 0, height: 0 })
let observer: ResizeObserver | null = null
onMounted(() => {
  if (!box.value) return
  size.value = { width: Math.floor(box.value.clientWidth), height: Math.floor(box.value.clientHeight) }
  observer = new ResizeObserver(([entry]) => {
    size.value = { width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }
  })
  observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

/** 绘图区四周留的位置（像素）：左边写纵轴刻度，下边写横轴刻度。 */
const PAD = { left: 46, right: 14, top: 14, bottom: 26 }
/** 一位等宽数字大约多宽（像素）：横轴的刻度挤不下时隔一个写一个。 */
const DIGIT_WIDTH = 7
/** 「← 归带宽管」「归算力管 →」大约多宽（像素，12px 的字）。 */
const SIDE_WIDTH = 76

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

const chart = computed(() => {
  const { width, height } = size.value
  if (width <= PAD.left + PAD.right || height <= PAD.top + PAD.bottom) return null
  const { x, y } = roofAxes(peak.value)
  const left = PAD.left
  const right = width - PAD.right
  const top = PAD.top
  const bottom = height - PAD.bottom
  const sx = (v: number) => left + logFraction(v, x) * (right - left)
  const sy = (v: number) => bottom - logFraction(v, y) * (bottom - top)
  const xMin = 10 ** x.from
  const xMax = 10 ** x.to
  const roof = ([[xMin, roofAt(peak.value, xMin)], [ridge.value, peak.value.tflops], [xMax, peak.value.tflops]] as const)
    .map(([a, b]) => `${sx(a).toFixed(1)},${sy(b).toFixed(1)}`)
    .join(' ')
  const xTicks = range(x.from, x.to).map((e) => ({ at: sx(10 ** e), label: decadeLabel(e) }))
  const step = (right - left) / Math.max(1, x.to - x.from)
  const widest = Math.max(...xTicks.map((t) => t.label.length)) * DIGIT_WIDTH + 8
  const every = Math.ceil(widest / step)
  const ridgeX = sx(ridge.value)
  return {
    x, left, right, top, bottom, ridgeX, roof,
    xTicks: xTicks.filter((_, i) => i % every === 0),
    xGrid: xTicks.map((t) => t.at),
    yTicks: range(y.from, y.to).map((e) => ({ at: sy(10 ** e), label: decadeLabel(e) })),
    /** 拐点两边的「归带宽管」「归算力管」：离图的边太近、写不下时不写（表里也有）。 */
    sides: { bandwidth: ridgeX - left >= SIDE_WIDTH, compute: right - ridgeX >= SIDE_WIDTH },
    points: Object.fromEntries(rows.value.map((r) => [r.key, { x: sx(r.intensity), y: sy(r.roof) }])) as Record<PointKey, { x: number; y: number }>,
  }
})

/** 菱形（FMA 测试）的路径。 */
const diamond = (x: number, y: number, r: number) => `M${x.toFixed(1)} ${(y - r).toFixed(1)}l${r} ${r}l${-r} ${r}l${-r} ${-r}Z`

// ── 拖动和键盘 ─────────────────────────────────────────────────────────────

const dragging = ref(false)
/** 按下的地方离加法、FMA 测试的点多近（像素）算点中了它们。 */
const HIT = 14

function local(event: PointerEvent): { x: number; y: number } | null {
  const rect = svgEl.value?.getBoundingClientRect()
  return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null
}

function moveTo(px: number) {
  const c = chart.value
  if (!c) return
  const fraction = Math.min(1, Math.max(0, (px - c.left) / (c.right - c.left)))
  k.value = nearestK(logValueAt(fraction, c.x))
}

function onPointerDown(event: PointerEvent) {
  const at = local(event)
  const c = chart.value
  if (event.button !== 0 || !at || !c) return
  const near = (key: PointKey) => Math.hypot(c.points[key].x - at.x, c.points[key].y - at.y) <= HIT
  if (!near('mm')) {
    if (near('add')) {
      note.value = ADD_NOTE
      return
    }
    if (near('fma')) {
      note.value = FMA_NOTE
      return
    }
  }
  event.preventDefault()
  dragging.value = true
  svgEl.value?.setPointerCapture(event.pointerId)
  mmEl.value?.focus({ preventScroll: true })
  moveTo(at.x)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  const at = local(event)
  if (at) moveTo(at.x)
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  if (svgEl.value?.hasPointerCapture(event.pointerId)) svgEl.value.releasePointerCapture(event.pointerId)
}

/** 矩阵乘的点是 slider：← ↓ 换小一档，→ ↑ 换大一档，Home / End 到两头（同 Knob 的步进器）。 */
function onKey(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const at = MM_KS.indexOf(k.value as (typeof MM_KS)[number])
  const last = MM_KS.length - 1
  const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? Math.min(at + 1, last)
    : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? Math.max(at - 1, 0)
      : event.key === 'Home' ? 0
        : event.key === 'End' ? last
          : null
  if (next === null) return
  event.preventDefault()
  k.value = MM_KS[next]
}
</script>

<template>
  <section class="rl" :aria-labelledby="titleId">
    <header class="rl__head">
      <span class="rl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="rl__title">这张卡的屋顶线</strong>
    </header>
    <PeakSource :peak="peak" :card="card" :has-mine="!!mine" @toggle="showReference = !showReference" />
    <p class="rl__rules">三个点都画在各自的屋顶上，那是它们最快能到的地方。拖动方块（矩阵乘），或者在图上点一下，换中间那一维 k：A 是 {{ MM_SIZE }}×k，B 是 k×{{ MM_SIZE }}。</p>

    <div class="rl__knobs">
      <Knob label="矩阵乘中间那一维" code="k" :options="K_OPTIONS" v-model="k" />
    </div>

    <figure class="rl__figure">
      <p class="rl__axis">纵轴：算力（TFLOPS），对数刻度</p>
      <div ref="box" class="rl__plot">
        <svg
          v-if="chart"
          ref="svgEl"
          class="rl__svg"
          :class="{ 'is-dragging': dragging }"
          :width="size.width"
          :height="size.height"
          :viewBox="`0 0 ${size.width} ${size.height}`"
          role="group"
          :aria-label="`屋顶线：拐点 ${sig(ridge)} FLOP/字节；${sliderText}`"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <g aria-hidden="true">
            <rect class="rl__zone" :x="chart.left" :y="chart.top" :width="Math.max(0, chart.ridgeX - chart.left)" :height="chart.bottom - chart.top" />
            <line v-for="(at, i) in chart.xGrid" :key="`gx${i}`" class="rl__grid" :x1="at" :x2="at" :y1="chart.top" :y2="chart.bottom" />
            <line v-for="(t, i) in chart.yTicks" :key="`gy${i}`" class="rl__grid" :x1="chart.left" :x2="chart.right" :y1="t.at" :y2="t.at" />
            <line class="rl__base" :x1="chart.left" :x2="chart.right" :y1="chart.bottom" :y2="chart.bottom" />
            <text v-for="(t, i) in chart.yTicks" :key="`ty${i}`" class="rl__tick" :x="chart.left - 6" :y="t.at" text-anchor="end" dominant-baseline="middle">{{ t.label }}</text>
            <text
              v-for="(t, i) in chart.xTicks"
              :key="`tx${i}`"
              class="rl__tick"
              :x="t.at"
              :y="chart.bottom + 17"
              :text-anchor="t.at > chart.right - 20 ? 'end' : 'middle'"
            >{{ t.label }}</text>
            <line class="rl__ridge" :x1="chart.ridgeX" :x2="chart.ridgeX" :y1="chart.top" :y2="chart.bottom" />
            <text v-if="chart.sides.bandwidth" class="rl__side" :x="chart.ridgeX - 6" :y="chart.bottom - 8" text-anchor="end">← 归带宽管</text>
            <text v-if="chart.sides.compute" class="rl__side" :x="chart.ridgeX + 6" :y="chart.bottom - 8" text-anchor="start">归算力管 →</text>
            <polyline class="rl__roof" :points="chart.roof" />
            <circle class="rl__add" :cx="chart.points.add.x" :cy="chart.points.add.y" r="5.5" />
            <path class="rl__fma" :d="diamond(chart.points.fma.x, chart.points.fma.y, 8)" />
          </g>
          <g
            ref="mmEl"
            class="rl__mm"
            role="slider"
            tabindex="0"
            aria-orientation="horizontal"
            aria-label="矩阵乘的点：中间那一维 k"
            :aria-valuemin="MM_KS[0]"
            :aria-valuemax="MM_KS[MM_KS.length - 1]"
            :aria-valuenow="k"
            :aria-valuetext="sliderText"
            :style="{ transform: `translate(${chart.points.mm.x}px, ${chart.points.mm.y}px)` }"
            @keydown="onKey"
          >
            <circle class="rl__ring" r="13" />
            <rect class="rl__square" x="-5.5" y="-5.5" width="11" height="11" />
            <text class="rl__label" x="-10" y="-10" text-anchor="end">k = {{ k }}</text>
          </g>
        </svg>
      </div>
      <p class="rl__axis is-x">横轴：算术强度（FLOP/字节），对数刻度</p>
    </figure>

    <p class="rl__readout" aria-live="polite">{{ readout }}</p>

    <table class="rl__table">
      <caption>拐点（竖虚线）：{{ sig(ridge) }} FLOP/字节，就是峰值算力 {{ sig(peak.tflops) }} TFLOPS ÷ 峰值带宽 {{ sig(peak.gbps) }} GB/s</caption>
      <thead>
        <tr>
          <th scope="col">算子</th>
          <th scope="col">算术强度</th>
          <th scope="col">最快 TFLOPS</th>
          <th scope="col">归谁管</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key" :class="{ 'is-mm': row.key === 'mm' }">
          <th scope="row">
            <svg class="rl__icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle v-if="row.key === 'add'" class="rl__add" cx="7" cy="7" r="4.5" />
              <rect v-else-if="row.key === 'mm'" class="rl__square" x="2.5" y="2.5" width="9" height="9" />
              <path v-else class="rl__fma" :d="diamond(7, 7, 5.5)" />
            </svg>{{ row.name }}
          </th>
          <td>{{ sig(row.intensity) }}</td>
          <td>{{ sig(row.roof) }}</td>
          <td>{{ BOUND_SHORT[row.bound] }}</td>
        </tr>
      </tbody>
    </table>

    <p class="rl__verdict">横坐标定了归谁管：拐点左边先看搬数据，右边先看计算。点最高只到屋顶。</p>
    <p class="rl__note">拷贝测试不做浮点运算，画不到图上：它量的是斜坡有多陡（峰值带宽）；FMA 测试量的是平顶有多高（峰值算力）。</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、标签同探索一、二和 2-3 的场景。 */
.rl {
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

.rl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.rl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.rl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.rl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.rl__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 图：高度由这里定，挂载前后一样高 ---------- */

.rl__figure {
  margin: 0;
}

.rl__axis {
  margin: 0 0 4px;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.rl__axis.is-x {
  margin: 4px 0 0;
  text-align: right;
}

.rl__plot {
  height: 300px;
  min-width: 0;
}

.rl__svg {
  display: block;
  touch-action: pan-y;
  cursor: pointer;
  user-select: none;
}

.rl__svg.is-dragging {
  cursor: grabbing;
}

.rl__zone {
  fill: var(--hg-surface-2);
}

.rl__grid {
  stroke: var(--hg-border);
  stroke-width: 1;
}

.rl__base {
  stroke: var(--hg-border-strong);
  stroke-width: 1;
}

.rl__tick {
  fill: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

.rl__side {
  fill: var(--hg-ink-2);
  font-size: 12px;
}

.rl__ridge {
  stroke: var(--hg-ink-3);
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
}

.rl__roof {
  fill: none;
  stroke: var(--hg-accent-ink);
  stroke-width: 2.5;
  stroke-linejoin: round;
}

/* 三个点：圆、方、菱形，形状不同，不只靠颜色（01 第 7 节）。 */
.rl__add {
  fill: var(--hg-sky-ink);
  stroke: var(--hg-surface);
  stroke-width: 1.5;
}

.rl__fma {
  fill: var(--hg-surface);
  stroke: var(--hg-violet-ink);
  stroke-width: 2;
}

.rl__square {
  fill: var(--hg-accent);
  stroke: var(--hg-ink);
  stroke-width: 1.5;
}

.rl__mm {
  cursor: grab;
  outline: none;
}

.rl__svg.is-dragging .rl__mm {
  cursor: grabbing;
}

/* 焦点环：拿到焦点（键盘或者拖动）时出现。 */
.rl__ring {
  fill: transparent;
  stroke: var(--hg-accent-ink);
  stroke-width: 2;
  visibility: hidden;
}

.rl__mm:focus .rl__ring {
  visibility: visible;
}

/* 标签描一圈底色，压在网格线上也看得清。 */
.rl__label {
  fill: var(--hg-ink);
  font-size: 12px;
  font-weight: 700;
  paint-order: stroke;
  stroke: var(--hg-surface);
  stroke-width: 4px;
  stroke-linejoin: round;
}

/* ---------- 解读和表 ---------- */

.rl__readout {
  min-height: 4.8em;
  margin: 0;
  font-size: 15px;
}

.rl__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 14px;
}

.rl__table caption {
  margin-bottom: 6px;
  color: var(--hg-ink-2);
  font-size: 13px;
  text-align: left;
}

.rl__table th,
.rl__table td {
  padding: 6px 8px;
  border: 0;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
  background: none;
  text-align: left;
}

.rl__table thead th {
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 600;
}

.rl__table td {
  font-variant-numeric: tabular-nums;
}

.rl__table tbody th {
  font-weight: 500;
}

.rl__table tr.is-mm {
  background: var(--hg-accent-soft);
}

/* 表头图标：VitePress 的基础样式把 svg 设成块级，这里改回行内，和名字排在一行。 */
.rl__icon {
  display: inline-block;
  margin-right: 6px;
  vertical-align: -2px;
}

.rl__verdict {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.rl__note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

@media (max-width: 520px) {
  .rl {
    padding: 16px;
  }

  .rl__plot {
    height: 250px;
  }

  .rl__table th,
  .rl__table td {
    padding: 6px 4px;
  }
}
</style>
