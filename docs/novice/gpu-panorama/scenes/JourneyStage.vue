<script setup lang="ts">
/**
 * 1-2「一份活的旅程」的画面（ScenePlayer 的 stage 插槽里画，根元素是 SVG 的 <g>）。
 *
 * 画什么全由 journey.ts 的 journeyFrame(step, local) 决定（02 第 5 节：画面是时间的纯函数）。
 * 空间约定（02 第 3 节）：CPU 这边在左，GPU 这边在右；显存在下，计算单元在上；读的箭头从显存指向计算，
 * 写的箭头反过来。数据走实线的通道，交工作单（控制）走虚线。三排数沿用全书的 A 蓝、B 橙、C 绿（ScenePlayer 的配色）。
 * compact 是窄屏的竖版构图（ScenePlayer 的 mobileViewBox）。
 */
import { computed } from 'vue'
import { lerp } from '../../../components/animation/easing.ts'
import { STEP, journeyFrame, type Packet } from '../journey.ts'

const props = withDefaults(defineProps<{
  step: number
  local: number
  compact?: boolean
  /** 只显示每一步做完的样子：系统或站点设置了减弱动效。 */
  still?: boolean
  /** 芯片上画几个车间（WGP），和全景图一样多。 */
  wgps?: number
  /** 显卡和 CPU 之间的通道，例如 PCIe 5.0 x16。 */
  bus?: string
}>(), { compact: false, still: false, wgps: 32, bus: '' })

type Row = 'a' | 'b' | 'c'
const ROWS: Row[] = ['a', 'b', 'c']
const CELLS = 8

/** 两套构图：宽屏 720 × 400，窄屏 400 × 560。 */
const L = computed(() => (props.compact
  ? {
      sideY: 24,
      host: { x: 12, w: 144 },
      dev: { x: 216, w: 172 },
      cpu: { y: 34, h: 92 },
      chip: { y: 34, h: 222 },
      grid: { cols: 4, x: 228, y: 64, w: 148, h: 138 },
      cache: { y: 212, h: 32 },
      mem: { y: 296, h: 232 },
      rowY: [348, 408, 468],
      rowH: 34,
      label: 13,
    }
  : {
      sideY: 22,
      host: { x: 24, w: 190 },
      dev: { x: 436, w: 260 },
      cpu: { y: 36, h: 96 },
      chip: { y: 36, h: 172 },
      grid: { cols: 8, x: 450, y: 64, w: 232, h: 92 },
      cache: { y: 164, h: 30 },
      mem: { y: 236, h: 140 },
      rowY: [268, 306, 344],
      rowH: 26,
      label: 13,
    }))

const frame = computed(() => journeyFrame(props.step, props.still ? Number.POSITIVE_INFINITY : props.local))

/** 一排数：名字 + 8 个格子；fill 是有多满（0–1），按格子数点亮。 */
function rowCells(side: 'host' | 'dev', row: Row, fill: number) {
  const l = L.value
  const col = side === 'host' ? l.host : l.dev
  const y = l.rowY[ROWS.indexOf(row)]
  const x0 = col.x + 34
  const w = (col.w - 34 - 14 - (CELLS - 1) * 3) / CELLS
  const lit = Math.round(fill * CELLS)
  return {
    name: { x: col.x + 14, y: y + l.rowH / 2 + 5 },
    cells: Array.from({ length: CELLS }, (_, i) => ({ x: x0 + i * (w + 3), y, w, h: l.rowH, on: i < lit })),
  }
}

const hostRows = computed(() => ROWS.map((row) => ({ row, ...rowCells('host', row, frame.value.host[row]) })))
const devRows = computed(() => ROWS.map((row) => ({ row, ...rowCells('dev', row, frame.value.vram[row]) })))

/** 路上的东西画在哪：一排数从这边的那一排走到那边的同一排；工作单从 CPU 走到芯片。 */
function packetAt(p: Packet) {
  const l = L.value
  if (p.id === 'order') {
    const from = l.host.x + l.host.w / 2
    const to = l.dev.x + l.dev.w / 2
    return { x: lerp(from, to, p.t), y: l.cpu.y + l.cpu.h / 2 }
  }
  const y = l.rowY[ROWS.indexOf(p.id)] + l.rowH / 2
  const hostX = l.host.x + l.host.w / 2
  const devX = l.dev.x + l.dev.w / 2
  return p.dir === 'in' ? { x: lerp(hostX, devX, p.t), y } : { x: lerp(devX, hostX, p.t), y }
}

const packets = computed(() => frame.value.packets.map((p) => ({ ...p, ...packetAt(p) })))

/** 芯片上的车间：一间间亮起来（工作单分下去），算的时候描边变成强调色。 */
const shops = computed(() => {
  const g = L.value.grid
  const n = Math.max(1, Math.floor(props.wgps))
  const cols = g.cols
  const rows = Math.ceil(n / cols)
  const gap = 4
  const w = (g.w - gap * (cols - 1)) / cols
  const h = (g.h - gap * (rows - 1)) / rows
  const lit = Math.round(frame.value.dispatched * n)
  return Array.from({ length: n }, (_, i) => ({
    x: g.x + (i % cols) * (w + gap),
    y: g.y + Math.floor(i / cols) * (h + gap),
    w,
    h,
    on: i < lit,
  }))
})

/** CPU 这一步在干什么，写在 CPU 框里（画面的文字等价物之一，02 第 4 节）。 */
const cpuNote = computed(() => {
  const f = frame.value
  switch (Math.floor(props.step)) {
    case STEP.ready: return '准备好了 a、b'
    case STEP.copyIn: return f.vram.a >= 1 && f.vram.b >= 1 ? 'a、b 拷进了显存' : 'a、b 在路上'
    case STEP.launch: return '交出了工作单'
    case STEP.compute: return f.waiting ? '在等 GPU 算完' : 'GPU 算完了'
    default: return f.host.c >= 1 ? '拿到 c 了' : 'c 在路上'
  }
})

/** 读、写的箭头：显存 → 芯片（读 a、b），芯片 → 显存（写 c）。 */
const arrows = computed(() => {
  const l = L.value
  const top = l.chip.y + l.chip.h
  const bottom = l.mem.y
  const xs = props.compact ? [250, 290, 360] : [478, 520, 652]
  return xs.map((x, i) => ({ x, up: i < 2, from: i < 2 ? bottom : top, to: i < 2 ? top : bottom }))
})

const busY = computed(() => L.value.rowY[1] + L.value.rowH / 2)
</script>

<template>
  <g class="tj" :class="{ 'is-compact': compact }">
    <!-- 两边的标题 -->
    <text class="tj-side" :x="L.host.x" :y="L.sideY">CPU 这边</text>
    <text class="tj-side" :x="L.dev.x" :y="L.sideY">GPU 这边（显卡）</text>

    <!-- 中间：数据走的通道（实线），交工作单（虚线） -->
    <rect class="tj-road" :x="L.host.x + L.host.w" :y="busY - 16" :width="L.dev.x - L.host.x - L.host.w" height="32" />
    <text v-if="!compact" class="tj-note is-center" :x="(L.host.x + L.host.w + L.dev.x) / 2" :y="busY - 24">{{ bus ? `通道 ${bus}` : '通道' }}</text>
    <text v-else class="tj-note is-center" :x="(L.host.x + L.host.w + L.dev.x) / 2" :y="busY + 34">通道</text>
    <line class="tj-control" :x1="L.host.x + L.host.w" :x2="L.dev.x" :y1="L.cpu.y + L.cpu.h / 2" :y2="L.cpu.y + L.cpu.h / 2" />
    <text v-if="!compact" class="tj-note is-center" :x="(L.host.x + L.host.w + L.dev.x) / 2" :y="L.cpu.y + L.cpu.h / 2 - 10">启动：交工作单</text>

    <!-- CPU 和它的内存 -->
    <rect class="tj-box" :x="L.host.x" :y="L.cpu.y" :width="L.host.w" :height="L.cpu.h" rx="14" />
    <text class="tj-title" :x="L.host.x + 14" :y="L.cpu.y + 30">CPU</text>
    <text class="tj-note" :class="{ 'is-wait': frame.waiting }" :x="L.host.x + 14" :y="L.cpu.y + L.cpu.h - 18">{{ cpuNote }}</text>

    <rect class="tj-box" :x="L.host.x" :y="L.mem.y" :width="L.host.w" :height="L.mem.h" rx="14" />
    <text class="tj-head" :x="L.host.x + 14" :y="L.mem.y + 20">CPU 的内存</text>
    <g v-for="r in hostRows" :key="`h${r.row}`">
      <text class="tj-name" :x="r.name.x" :y="r.name.y">{{ r.row }}</text>
      <rect v-for="(c, i) in r.cells" :key="i" class="tj-cell" :class="[`is-${r.row}`, { 'is-on': c.on }]" :x="c.x" :y="c.y" :width="c.w" :height="c.h" rx="3" />
    </g>

    <!-- GPU：上面是芯片（车间 + 缓存），下面是显存 -->
    <rect class="tj-box" :x="L.dev.x" :y="L.chip.y" :width="L.dev.w" :height="L.chip.h" rx="14" />
    <text class="tj-head" :x="L.dev.x + 14" :y="L.chip.y + 20">GPU 芯片</text>
    <rect
      v-for="(s, i) in shops"
      :key="`s${i}`"
      class="tj-shop"
      :class="{ 'is-on': s.on, 'is-busy': s.on && frame.computing }"
      :x="s.x"
      :y="s.y"
      :width="s.w"
      :height="s.h"
      rx="2"
    />
    <rect class="tj-cache" :x="L.dev.x + 14" :y="L.cache.y" :width="L.dev.w - 28" :height="L.cache.h" rx="6" />
    <text class="tj-note" :x="L.dev.x + 24" :y="L.cache.y + L.cache.h / 2 + 4">缓存</text>

    <rect class="tj-box" :x="L.dev.x" :y="L.mem.y" :width="L.dev.w" :height="L.mem.h" rx="14" />
    <text class="tj-head" :x="L.dev.x + 14" :y="L.mem.y + 20">显存</text>
    <g v-for="r in devRows" :key="`d${r.row}`">
      <text class="tj-name" :x="r.name.x" :y="r.name.y">{{ r.row }}</text>
      <rect v-for="(c, i) in r.cells" :key="i" class="tj-cell" :class="[`is-${r.row}`, { 'is-on': c.on }]" :x="c.x" :y="c.y" :width="c.w" :height="c.h" rx="3" />
    </g>

    <!-- 计算：读的箭头向上（a、b），写的箭头向下（c） -->
    <g v-if="frame.computing" class="tj-arrows">
      <g v-for="(a, i) in arrows" :key="`a${i}`" class="tj-arrow" :class="a.up ? 'is-read' : 'is-write'">
        <line :x1="a.x" :x2="a.x" :y1="a.from" :y2="a.up ? a.to + 8 : a.to - 8" />
        <path :d="a.up ? `M${a.x - 5} ${a.to + 9} L${a.x} ${a.to + 1} L${a.x + 5} ${a.to + 9} Z` : `M${a.x - 5} ${a.to - 9} L${a.x} ${a.to - 1} L${a.x + 5} ${a.to - 9} Z`" />
      </g>
    </g>

    <!-- 路上的东西 -->
    <g v-for="p in packets" :key="p.id" :transform="`translate(${p.x} ${p.y})`">
      <template v-if="p.id === 'order'">
        <rect class="tj-order" :x="compact ? -26 : -36" y="-15" :width="compact ? 52 : 72" height="30" rx="6" />
        <text class="tj-name is-center" x="0" y="5">{{ compact ? '工作单' : '工作单 add' }}</text>
      </template>
      <template v-else>
        <rect class="tj-packet" :class="`is-${p.id}`" :x="compact ? -24 : -30" y="-14" :width="compact ? 48 : 60" height="28" rx="6" />
        <text class="tj-name is-center" x="0" y="5">{{ p.id }}</text>
      </template>
    </g>
  </g>
</template>

<style scoped>
.tj-side {
  fill: var(--ej-ink-soft);
  font-family: var(--hg-font-mono, monospace);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.tj-box {
  fill: var(--ej-bg);
  stroke: var(--ej-line-strong);
  stroke-width: 1.2;
}

.tj-title {
  fill: var(--ej-ink);
  font-family: var(--hg-font-display, sans-serif);
  font-size: 22px;
  font-weight: 700;
}

.tj-head {
  fill: var(--ej-ink);
  font-size: 13px;
  font-weight: 700;
}

.tj-note {
  fill: var(--ej-ink-soft);
  font-size: 12px;
}

.tj-note.is-wait {
  fill: var(--ej-active);
  font-weight: 700;
}

.tj-note.is-center,
.tj-name.is-center {
  text-anchor: middle;
}

.tj-name {
  fill: var(--ej-ink);
  font-family: var(--hg-font-mono, monospace);
  font-size: 13px;
  font-weight: 700;
}

.tj-road {
  fill: var(--ej-panel);
  stroke: var(--ej-line);
  stroke-width: 1;
}

.tj-control {
  stroke: var(--ej-ink-faint);
  stroke-width: 1.5;
  stroke-dasharray: 6 5;
}

.tj-cell {
  fill: none;
  stroke: var(--ej-line-strong);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.tj-cell.is-on {
  stroke-dasharray: none;
}

.tj-cell.is-a.is-on {
  fill: var(--ej-a-soft);
  stroke: var(--ej-a);
}

.tj-cell.is-b.is-on {
  fill: var(--ej-b-soft);
  stroke: var(--ej-b);
}

.tj-cell.is-c.is-on {
  fill: var(--ej-c-soft);
  stroke: var(--ej-c);
}

.tj-packet {
  stroke-width: 1.5;
}

.tj-packet.is-a {
  fill: var(--ej-a-soft);
  stroke: var(--ej-a);
}

.tj-packet.is-b {
  fill: var(--ej-b-soft);
  stroke: var(--ej-b);
}

.tj-packet.is-c {
  fill: var(--ej-c-soft);
  stroke: var(--ej-c);
}

.tj-order {
  fill: var(--ej-surface);
  stroke: var(--ej-ink);
  stroke-width: 1.5;
}

.tj-shop {
  fill: var(--ej-surface);
  stroke: var(--ej-line-strong);
  stroke-width: 1;
}

.tj-shop.is-on {
  fill: var(--ej-active-soft);
  stroke: var(--ej-active);
}

.tj-shop.is-busy {
  stroke-width: 2;
}

.tj-cache {
  fill: var(--ej-panel);
  stroke: var(--ej-line);
  stroke-width: 1;
}

.tj-arrow line {
  stroke: var(--ej-ink-soft);
  stroke-width: 2;
}

.tj-arrow.is-write line {
  stroke: var(--ej-c);
}

.tj-arrow path {
  fill: var(--ej-ink-soft);
}

.tj-arrow.is-write path {
  fill: var(--ej-c);
}
</style>
