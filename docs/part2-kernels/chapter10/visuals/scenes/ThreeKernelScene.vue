<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, lerp, seg, segE } from '../../../../components/animation/easing'

/**
 * 10.5.1 hip-baseline-3kernel：三个 kernel 用全局中间数组串接的数据流。
 * dispatch1 写 row_max；dispatch2 读 X 与 row_max，写 exp_tmp + row_sum；
 * dispatch3 读 exp_tmp 与 row_sum，归一化写 Y。exp_tmp 是 4096×1024 FP32 = 16 MiB，
 * 写一次读一次 = 32 MiB 逻辑访问。图为 3 行 × 3 列教学缩略。
 */
const props = defineProps<{ step: number; local: number }>()

const ROWS = [0, 1, 2]
const COLS = [0, 1, 2]

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/* ---------- 几何 ---------- */
const X_X = 40
const X_Y = 96
const CELL = 52
const GAP = 8
const gridX = (col: number) => X_X + col * (CELL + GAP)
const gridY = (row: number) => X_Y + row * (CELL + GAP)

const ARR_Y = [96, 210, 330]
const ARR_LABEL = ['row_max（每行 1 个）', 'exp_tmp（每元素 · 16 MiB）', 'row_sum（每行 1 个）']
const ARR_COLOR = ['var(--ej-active)', 'var(--ej-b)', 'var(--ej-c)']

const K_Y = [70, 190, 310]
const K_X = 470
const K_W = 214
const Y_Y = 338
const Y_CELL = 28
const outputX = (column: number) => X_X + column * 34
const outputY = (row: number) => Y_Y + row * 34
const expX = (column: number) => 238 + column * 60
const expY = (row: number) => ARR_Y[1] + 6 + row * 12

const cell = (row: number, col: number) => ({ row, col, x: gridX(col), y: gridY(row) })
const CELLS = ROWS.flatMap(row => COLS.map(col => cell(row, col)))

/** dispatch 1：行 max —— 每行的扫描进度 */
function k1Progress(row: number): number {
  if (props.step === 0 || props.step > 1) return props.step > 1 ? 1 : 0
  return easeInOutCubic(seg(props.local, 120 + row * 220, 480 + row * 220))
}

/** dispatch 2：exp + sum */
function k2Progress(row: number): number {
  if (props.step === 2) return easeInOutCubic(seg(props.local, 120 + row * 220, 480 + row * 220))
  return props.step > 2 ? 1 : 0
}

/** dispatch 3：归一化 */
function k3Progress(row: number): number {
  if (props.step === 3) return easeInOutCubic(seg(props.local, 120 + row * 220, 480 + row * 220))
  return props.step > 3 ? 1 : 0
}

const trafficE = computed(() => (props.step === 4 ? segE(props.local, 150, 600) : 0))
const fusionE = computed(() => (props.step === 5 ? segE(props.local, 150, 600) : 0))

/** 飞行 token */
const tokens = computed(() => {
  const out: { key: string; x1: number; y1: number; x2: number; y2: number; p: number; color: string }[] = []
  const push = (x1: number, y1: number, x2: number, y2: number, start: number, color: string) => {
    const p = easeInOutCubic(seg(props.local, start, start + 300))
    if (p > 0.02 && p < 0.98) out.push({ key: `${x1}-${y1}-${x2}-${y2}-${start}`, x1, y1, x2, y2, p, color })
  }
  for (const { row, col } of CELLS) {
    const x = gridX(col) + CELL / 2
    const y = gridY(row) + CELL / 2
    if (props.step === 1) {
      const t = 120 + row * 220
      push(x, y, K_X + 18, K_Y[0] + 24, t, 'var(--ej-active)')
      if (col === 0) push(K_X, K_Y[0] + 42, 266 + row * 60, ARR_Y[0] + 22, t + 360, 'var(--ej-active)')
    }
    if (props.step === 2) {
      const t = 120 + row * 220
      push(x, y, K_X + 18, K_Y[1] + 24, t, 'var(--ej-b)')
      push(K_X, K_Y[1] + 42, expX(col) + 26, expY(row) + 4, t + 360, 'var(--ej-b)')
      if (col === 0) {
        push(266 + row * 60, ARR_Y[0] + 22, K_X, K_Y[1] + 24, t, 'var(--ej-active)')
        push(K_X, K_Y[1] + 42, 266 + row * 60, ARR_Y[2] + 22, t + 360, 'var(--ej-c)')
      }
    }
    if (props.step === 3) {
      const t = 120 + row * 220
      push(expX(col) + 26, expY(row) + 4, K_X, K_Y[2] + 24, t, 'var(--ej-b)')
      if (col === 0) push(266 + row * 60, ARR_Y[2] + 22, K_X, K_Y[2] + 24, t, 'var(--ej-c)')
      push(K_X, K_Y[2] + 42, outputX(col) + Y_CELL / 2, outputY(row) + Y_CELL / 2, t + 360, 'var(--ej-c)')
    }
  }
  return out
})

const captions = [
  '三个 kernel 串成一条链：行最大值 → 指数与行和 → 归一化；连接它们的不是寄存器，是全局数组',
  'dispatch 1：一线程一行，串行扫出 row_max[row]',
  'dispatch 2：读 X 与 row_max，把指数写进 exp_tmp，同时累计 row_sum',
  'dispatch 3：一线程一元素，用 index / columns 找到所属行，除以 row_sum 写回 Y',
  '代价：exp_tmp 写一次读一次 = 32 MiB 逻辑访问，外加两次 dispatch 的往返',
  '融合路线把整行交给同一组执行单元：实测 0.744 → 0.116 ms（下一张动画拆解它的执行时间线）'
]
</script>

<template>
  <g font-family="inherit">
    <!-- 输入 X -->
    <text x="40" y="78" font-size="11" font-weight="700" fill="var(--ej-a)">X · 3 × 3 教学缩略</text>
    <g v-for="c in CELLS" :key="`x-${c.row}-${c.col}`">
      <rect :x="c.x" :y="c.y" :width="CELL" :height="CELL" rx="7" fill="var(--ej-a-soft)" stroke="var(--ej-a)" stroke-width="1" />
      <text :x="c.x + CELL / 2" :y="c.y + CELL / 2 + 1" text-anchor="middle" dominant-baseline="central" font-size="9.5" fill="var(--ej-ink-soft)">x</text>
    </g>

    <!-- 输出 Y -->
    <text x="40" y="322" font-size="11" font-weight="700" fill="var(--ej-c)">Y · 与输入逐元素对应</text>
    <g v-for="c in CELLS" :key="`y-${c.row}-${c.col}`">
      <rect
        :x="outputX(c.col)" :y="outputY(c.row)" :width="Y_CELL" :height="Y_CELL" rx="5"
        fill="var(--ej-c-soft)" stroke="var(--ej-c)" stroke-width="0.8"
        :opacity="props.step >= 4 ? 0.9 : k3Progress(c.row)"
      />
    </g>

    <!-- 全局中间数组带 -->
    <g v-for="(arrIndex) in [0, 1, 2]" :key="`arr-${arrIndex}`">
      <text x="228" :y="ARR_Y[arrIndex] - 12" font-size="9.5" font-weight="600" :fill="ARR_COLOR[arrIndex]">{{ ARR_LABEL[arrIndex] }}</text>
      <rect x="228" :y="ARR_Y[arrIndex]" width="196" height="44" rx="8" fill="var(--ej-surface)" stroke="var(--ej-line-strong)" stroke-width="1" />
      <g v-if="arrIndex === 0">
        <rect v-for="row in 3" :key="`rm-${row}`" :x="240 + (row - 1) * 60" :y="ARR_Y[0] + 10" width="52" height="24" rx="5"
          :fill="k1Progress(row - 1) > 0.05 ? 'var(--ej-active-soft)' : 'var(--ej-panel)'"
          :stroke="k1Progress(row - 1) > 0.05 ? 'var(--ej-active)' : 'var(--ej-line)'" stroke-width="1"
        />
        <text v-for="row in 3" :key="`rmt-${row}`" :x="266 + (row - 1) * 60" :y="ARR_Y[0] + 22" text-anchor="middle" dominant-baseline="central" font-size="9" fill="var(--ej-ink-soft)">m{{ row - 1 }}</text>
      </g>
      <g v-if="arrIndex === 1">
        <rect v-for="c in CELLS" :key="`et-${c.row}-${c.col}`" :x="expX(c.col)" :y="expY(c.row)" width="52" height="8" rx="3"
          :fill="k2Progress(c.row) > 0.05 ? 'var(--ej-b-soft)' : 'var(--ej-panel)'"
          :stroke="k2Progress(c.row) > 0.05 ? 'var(--ej-b)' : 'var(--ej-line)'" stroke-width="0.8"
        />
        <text v-if="props.step >= 4" x="326" :y="ARR_Y[1] + 60" text-anchor="middle" font-size="8.5" fill="var(--ej-b)">写一次 + 读一次</text>
      </g>
      <g v-if="arrIndex === 2">
        <rect v-for="row in 3" :key="`rs-${row}`" :x="240 + (row - 1) * 60" :y="ARR_Y[2] + 10" width="52" height="24" rx="5"
          :fill="k2Progress(row - 1) > 0.05 ? 'var(--ej-c-soft)' : 'var(--ej-panel)'"
          :stroke="k2Progress(row - 1) > 0.05 ? 'var(--ej-c)' : 'var(--ej-line)'" stroke-width="1"
        />
        <text v-for="row in 3" :key="`rst-${row}`" :x="266 + (row - 1) * 60" :y="ARR_Y[2] + 22" text-anchor="middle" dominant-baseline="central" font-size="9" fill="var(--ej-ink-soft)">s{{ row - 1 }}</text>
      </g>
    </g>

    <!-- dispatch 卡 -->
    <g v-for="k in [0, 1, 2]" :key="`k-${k}`">
      <rect
        :x="K_X" :y="K_Y[k]" :width="K_W" height="70" rx="9"
        :fill="props.step === k + 1 ? 'var(--ej-active-soft)' : 'var(--ej-panel)'"
        :stroke="props.step === k + 1 ? 'var(--ej-active)' : 'var(--ej-line)'"
        :stroke-width="props.step === k + 1 ? 1.6 : 1"
      />
      <text :x="K_X + 16" :y="K_Y[k] + 21" font-size="11.5" font-weight="700" :fill="props.step === k + 1 ? 'var(--ej-active)' : 'var(--ej-ink)'">dispatch {{ k + 1 }}</text>
      <text :x="K_X + 16" :y="K_Y[k] + 39" font-size="9.5" fill="var(--ej-ink-soft)">
        <tspan :x="K_X + 16">{{ ['一线程一行', '读 X 与 row_max', '读 exp_tmp 与 row_sum'][k] }}</tspan>
        <tspan :x="K_X + 16" dy="16">{{ ['写 row_max', '写 exp_tmp 与 row_sum', '归一化，写 Y'][k] }}</tspan>
      </text>
    </g>

    <!-- 飞行 token -->
    <g v-for="token in tokens" :key="`tk-${token.key}`">
      <circle :cx="lerp(token.x1, token.x2, token.p)" :cy="lerp(token.y1, token.y2, token.p)" r="4" :fill="token.color" />
    </g>

    <!-- 逻辑流量累计（step 5） -->
    <g :opacity="trafficE">
      <rect x="228" y="402" width="196" height="26" rx="7" fill="var(--ej-b-soft)" stroke="var(--ej-b)" stroke-width="1" />
      <text x="326" y="415" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="600" fill="var(--ej-b)">exp_tmp：32 MiB 逻辑访问</text>
    </g>

    <!-- 底部说明 -->
    <text x="360" y="478" text-anchor="middle" font-size="11" fill="var(--ej-ink-soft)">{{ captions[Math.min(props.step, captions.length - 1)] }}</text>

    <!-- 融合对照（step 6 覆盖） -->
    <g v-if="props.step === 5">
      <rect x="0" y="0" width="720" height="500" fill="var(--ej-bg)" />
      <g :opacity="fusionE">
      <text x="360" y="70" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="700" fill="var(--ej-ink)">融合路线：把整行交给同一组执行单元</text>
      <g>
        <rect x="110" y="110" width="240" height="120" rx="11" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1.2" />
        <text x="230" y="136" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ej-ink-soft)">baseline · 3 次 dispatch</text>
        <text x="230" y="162" text-anchor="middle" font-size="10.5" fill="var(--ej-ink-soft)">中间结果经全局数组</text>
        <text x="230" y="182" text-anchor="middle" font-size="10.5" fill="var(--ej-ink-soft)">exp_tmp 往返 32 MiB</text>
        <text x="230" y="210" text-anchor="middle" font-size="14" :font-family="MONO" font-weight="700" fill="var(--ej-ink-soft)">0.744 ms</text>
      </g>
      <text x="360" y="175" text-anchor="middle" font-size="18" font-weight="700" fill="var(--ej-ink-faint)">→</text>
      <g>
        <rect x="370" y="110" width="240" height="120" rx="11" fill="var(--ej-active-soft)" stroke="var(--ej-active)" stroke-width="1.5" />
        <text x="490" y="136" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ej-active)">fused · 1 次 dispatch</text>
        <text x="490" y="162" text-anchor="middle" font-size="10.5" fill="var(--ej-ink-soft)">LDS 复用，无 exp_tmp</text>
        <text x="490" y="182" text-anchor="middle" font-size="10.5" fill="var(--ej-ink-soft)">代价：扫描输入三次</text>
        <text x="490" y="210" text-anchor="middle" font-size="14" :font-family="MONO" font-weight="700" fill="var(--ej-active)">0.116 ms</text>
      </g>
      <text x="360" y="278" text-anchor="middle" font-size="10.5" fill="var(--ej-ink-faint)">
        9070 XT · 4096×1024 FP32 · 2026-07-19 curated evidence · 数字为实测
      </text>
      </g>
    </g>
  </g>
</template>
