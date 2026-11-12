<script setup lang="ts">
/**
 * 实验档案馆里的一个 Notebook 输出（L-04）：文字原样显示，表格画成表，图表数据画成 SVG 折线图或柱状图。
 * 档案浏览页的详情用它，观摩模式（L-05）回放 Notebook 时也可以用。不在 kit/index.ts 里全局注册：不是关卡正文里直接写的组件。
 *
 * 图表按容器的实际宽度画（ResizeObserver），刻度的字号就是像素，窄屏上不会缩成看不清的小字；
 * 挂载之前不知道宽度，只留一块同样高的空位（档案详情在浏览器里读到条目以后才出现，不经过服务端渲染）。
 * 不只靠颜色区分（01 第 7 节）：每条线的点形状不同，有图例；「看数据」展开是同一份数据的表格，读屏读这张表。
 * 坐标和刻度在 labArchive.ts 的 chartModel 里算。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { chartModel, formatTick, type ArchiveOutput } from '@course/labArchive.ts'

const props = defineProps<{ output: ArchiveOutput }>()

const chart = computed(() => (props.output.kind === 'chart' ? props.output : null))

const box = ref<HTMLElement | null>(null)
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

/** 窄屏矮一点，图不至于又窄又高。 */
const height = computed(() => (width.value < 480 ? 220 : 260))
const model = computed(() => (chart.value && width.value > 0 ? chartModel(chart.value, width.value, height.value) : null))

/** 一位等宽数字大约多宽（像素）：横轴的刻度挤不下时隔一个显示一个。 */
const DIGIT_WIDTH = 7
const xTicks = computed(() => {
  const shown: { at: number; label: string }[] = []
  for (const tick of model.value?.xTicks ?? []) {
    const last = shown.at(-1)
    if (!last || tick.at - last.at >= ((last.label.length + tick.label.length) / 2) * DIGIT_WIDTH + 10) shown.push(tick)
  }
  return shown
})

/** 第几条线的点画成什么形状：圆、方、菱形、三角轮流。 */
function markerPath(index: number, x: number, y: number): string {
  const [cx, cy] = [x.toFixed(1), y.toFixed(1)]
  switch (index % 4) {
    case 0: return `M${(x - 3.5).toFixed(1)} ${cy}a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z`
    case 1: return `M${(x - 3).toFixed(1)} ${(y - 3).toFixed(1)}h6v6h-6Z`
    case 2: return `M${cx} ${(y - 4.5).toFixed(1)}l4.5 4.5l-4.5 4.5l-4.5 -4.5Z`
    default: return `M${cx} ${(y - 4.5).toFixed(1)}l4.5 7.5h-9Z`
  }
}

const ariaLabel = computed(() => {
  const c = chart.value
  if (!c) return ''
  const kind = c.chart === 'bar' ? '柱状图' : '折线图'
  return `${kind}：横轴是${c.x.label}，纵轴是${c.y.label}，${c.series.map((s) => s.name).join('、')}。数值见「看数据」里的表格。`
})

/** 「看数据」的表：一行一个横坐标，一列一条线；空着的点写「—」。 */
const dataRows = computed(() => {
  const c = chart.value
  if (!c) return []
  return c.x.values.map((x, i) => ({
    x: typeof x === 'number' ? formatTick(x) : x,
    values: c.series.map((s) => (typeof s.values[i] === 'number' ? formatTick(s.values[i] as number) : '—')),
  }))
})
</script>

<template>
  <pre v-if="output.kind === 'text'" class="hg-aout hg-aout--text"><samp translate="no">{{ output.text }}</samp></pre>

  <div v-else-if="output.kind === 'table'" class="hg-aout hg-aout--table">
    <table>
      <caption v-if="output.caption">{{ output.caption }}</caption>
      <thead>
        <tr><th v-for="(column, i) in output.columns" :key="i" scope="col">{{ column }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="(row, r) in output.rows" :key="r">
          <td v-for="(cell, i) in row" :key="i" :class="{ 'is-number': typeof cell === 'number' }">{{ cell ?? '' }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <figure v-else-if="chart" class="hg-aout hg-aout--chart">
    <figcaption v-if="chart.caption" class="hg-aout__caption">{{ chart.caption }}</figcaption>
    <p class="hg-aout__axis">
      纵轴：{{ chart.y.label }}<template v-if="chart.y.unit">（{{ chart.y.unit }}）</template><template v-if="chart.y.scale === 'log'">，对数刻度</template>
    </p>
    <div ref="box" class="hg-aout__plot" :style="{ height: `${height}px` }">
      <svg
        v-if="model"
        :width="model.width"
        :height="model.height"
        :viewBox="`0 0 ${model.width} ${model.height}`"
        role="img"
        :aria-label="ariaLabel"
      >
        <g class="hg-aout__grid">
          <line v-for="(t, i) in model.yTicks" :key="i" :x1="model.plot.left" :x2="model.plot.right" :y1="t.at" :y2="t.at" />
        </g>
        <line class="hg-aout__base" :x1="model.plot.left" :x2="model.plot.right" :y1="model.plot.bottom" :y2="model.plot.bottom" />
        <g class="hg-aout__ticks">
          <text v-for="(t, i) in model.yTicks" :key="`y${i}`" :x="model.plot.left - 6" :y="t.at" text-anchor="end" dominant-baseline="middle">{{ t.label }}</text>
          <text v-for="(t, i) in xTicks" :key="`x${i}`" :x="t.at" :y="model.plot.bottom + 17" text-anchor="middle">{{ t.label }}</text>
        </g>
        <rect
          v-for="(b, i) in model.bars"
          :key="`b${i}`"
          class="hg-aout__bar"
          :class="`is-s${b.index % 6}`"
          :x="b.x"
          :y="b.y"
          :width="Math.max(b.width - 2, 1)"
          :height="b.height"
        />
        <g v-for="line in model.lines" :key="line.index" class="hg-aout__line" :class="`is-s${line.index % 6}`">
          <path class="hg-aout__path" :d="line.path" />
          <path v-for="(p, i) in line.points" :key="i" class="hg-aout__mark" :d="markerPath(line.index, p.x, p.y)" />
        </g>
      </svg>
    </div>
    <p class="hg-aout__axis is-x">
      横轴：{{ chart.x.label }}<template v-if="chart.x.unit">（{{ chart.x.unit }}）</template><template v-if="chart.x.scale === 'log'">，对数刻度</template>
    </p>
    <ul v-if="chart.series.length > 1" class="hg-aout__legend">
      <li v-for="(s, i) in chart.series" :key="i" :class="`is-s${i % 6}`">
        <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
          <line v-if="chart.chart === 'line'" x1="1" x2="21" y1="7" y2="7" />
          <path :d="chart.chart === 'line' ? markerPath(i, 11, 7) : 'M5 2h12v10h-12Z'" />
        </svg>
        {{ s.name }}
      </li>
    </ul>
    <details class="hg-aout__data">
      <summary>看数据</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">{{ chart.x.label }}<template v-if="chart.x.unit">（{{ chart.x.unit }}）</template></th>
            <th v-for="(s, i) in chart.series" :key="i" scope="col">{{ s.name }}<template v-if="chart.y.unit">（{{ chart.y.unit }}）</template></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in dataRows" :key="r">
            <th scope="row">{{ row.x }}</th>
            <td v-for="(value, i) in row.values" :key="i" class="is-number">{{ value }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>

<style scoped>
.hg-aout {
  margin: 0;
}

/* ---------- 文字：Notebook 打印出来的样子，长行换行，不横向滚动 ---------- */

.hg-aout--text {
  margin: 0;
  padding: 10px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.hg-aout--text samp {
  font-family: inherit;
}

/* ---------- 表格：窄屏上表格自己横向滚动 ---------- */

.hg-aout--table {
  max-width: 100%;
  overflow-x: auto;
}

.hg-aout table {
  display: table;
  width: auto;
  max-width: none;
  margin: 0;
  overflow: visible;
  border-collapse: collapse;
  font-size: 13.5px;
  line-height: 1.5;
}

.hg-aout caption {
  padding-bottom: 6px;
  color: var(--hg-ink-3);
  font-size: 13px;
  text-align: left;
}

.hg-aout th,
.hg-aout td {
  padding: 5px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  text-align: left;
  white-space: nowrap;
}

.hg-aout th {
  background: var(--hg-surface-2);
  font-weight: 600;
}

.hg-aout td {
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.hg-aout .is-number {
  text-align: right;
}

/* ---------- 图表 ---------- */

.hg-aout--chart {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.hg-aout__caption {
  color: var(--hg-ink-2);
  font-size: 13.5px;
}

.hg-aout__axis {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 12.5px;
}

.hg-aout__axis.is-x {
  text-align: right;
}

.hg-aout__plot {
  width: 100%;
  min-width: 0;
}

.hg-aout__plot svg {
  display: block;
  overflow: visible;
}

.hg-aout__grid line {
  stroke: var(--hg-border);
  stroke-width: 1;
}

.hg-aout__base {
  stroke: var(--hg-border-strong);
  stroke-width: 1;
}

.hg-aout__ticks text {
  fill: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

/* 线的颜色用线程块分类色（01 第 2.3 节：只区分第几组，不表达对错），形状另外区分 */
.is-s0 { --hg-aout-color: var(--hg-group-0); }
.is-s1 { --hg-aout-color: var(--hg-group-1); }
.is-s2 { --hg-aout-color: var(--hg-group-2); }
.is-s3 { --hg-aout-color: var(--hg-group-3); }
.is-s4 { --hg-aout-color: var(--hg-group-4); }
.is-s5 { --hg-aout-color: var(--hg-group-5); }

.hg-aout__path {
  fill: none;
  stroke: var(--hg-aout-color);
  stroke-width: 2;
  stroke-linejoin: round;
}

.hg-aout__mark {
  fill: var(--hg-aout-color);
  stroke: var(--hg-surface);
  stroke-width: 1;
}

.hg-aout__bar {
  fill: var(--hg-aout-color);
}

.hg-aout__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12.5px;
}

.hg-aout__legend li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.hg-aout__legend line {
  stroke: var(--hg-aout-color);
  stroke-width: 2;
}

.hg-aout__legend path {
  fill: var(--hg-aout-color);
}

.hg-aout__data {
  margin-top: 4px;
  max-width: 100%;
  overflow-x: auto;
}

.hg-aout__data summary {
  width: fit-content;
  color: var(--hg-ink-2);
  font-size: 13px;
  cursor: pointer;
}

.hg-aout__data summary:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
  border-radius: var(--hg-radius-tag);
}

.hg-aout__data table {
  margin-top: 6px;
}
</style>
