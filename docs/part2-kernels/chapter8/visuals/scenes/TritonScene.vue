<script setup lang="ts">
import { computed, useId } from 'vue'
import { easeInOutCubic, lerp, seg, segE } from '../easing'

/**
 * 8.5.5 Triton tile 与 mask：program 生成 offsets（pid×BLOCK+arange），
 * 同一组逻辑位置依次读取 A、读取 B、执行 A+B、写回 C；mask=false 的位置
 * 加载用 other=0 填充，填充值可以参与逐元素加法，但结果从不写回（N=13, BLOCK_SIZE=8）。
 */
const props = defineProps<{ step: number; local: number }>()

const TILE_N = 8
const ROW_N = 16
const N = 13

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const uid = useId()

/* ---------- 几何 ---------- */
const LEFT_X = 16
const LEFT_Y = 36
const LEFT_W = 210
const LEFT_H = 270
const TILE_X = 36
const TILE_PITCH = 22
const TILE_W = 20
const TILE_H = 38
const TILE_Y = 140

const ROW_X = 300
const ROW_PITCH = 24.5
const ROW_CELL_W = 22
const ROW_H = 32
const ROW_A_Y = 70
const ROW_B_Y = 126
const ROW_C_Y = 300

const PHASES = ['tl.load A', 'tl.load B', 'A + B', 'tl.store C']
const MEM_ROWS = ['A', 'B', 'C'] as const

const rowX = (offset: number) => ROW_X + offset * ROW_PITCH
const rowCx = (offset: number) => rowX(offset) + ROW_CELL_W / 2
const tileX = (index: number) => TILE_X + index * TILE_PITCH
const tileCx = (index: number) => tileX(index) + TILE_W / 2

const uidHatch = `${uid}-hatch`

/* ---------- 步骤 → program / phase ---------- */
const prog = computed(() => Math.floor(props.step / 4))
const phase = computed(() => props.step % 4)
const offsets = computed(() => Array.from({ length: TILE_N }, (_, i) => prog.value * 8 + i))

/* ---------- 逐帧状态 ---------- */

/** 右侧内存行整体入场 */
function rowBuildE(delay: number): number {
  return props.step === 0 ? segE(props.local, 100 + delay, 400 + delay) : 1
}

/** tile 与 mask 行随 program 切换重建 */
function tileBuildE(index: number): number {
  if (phase.value !== 0) return 1
  return segE(props.local, 60 + index * 45, 300 + index * 45)
}

/** 载入/写回后的行内高亮 */
function rowCellE(row: 'A' | 'B' | 'C', offset: number): number {
  const i = offset - prog.value * 8
  if (i < 0 || i >= TILE_N) return 0
  if (offset >= N) return 0
  const neededPhase = row === 'A' ? 0 : row === 'B' ? 1 : 3
  if (phase.value < neededPhase) return 0
  if (phase.value === neededPhase) {
    return flightP(i) > 0 ? lerp(0, 0.55, flightP(i)) : 0
  }
  return 0.55
}

function flightStart(i: number): number {
  return 120 + i * 45
}

function flightP(i: number): number {
  return easeInOutCubic(seg(props.local, flightStart(i), flightStart(i) + 400))
}

/** 加载到达 tile 后的 other=0 角标（仅 mask=false 位置） */
function otherTagE(i: number): number {
  const offset = offsets.value[i]
  if (offset < N) return 0
  if (phase.value >= 2) return 1
  return seg(props.local, flightStart(i) + 360, flightStart(i) + 440)
}

/** 写回阶段 mask=false 位置上的 ✕ */
function storeBlockE(i: number): number {
  const offset = offsets.value[i]
  if (offset < N || phase.value !== 3) return 0
  return seg(props.local, flightStart(i) + 360, flightStart(i) + 440)
}

/** phase 2：tile 逐位置相加的脉冲动效 */
const addGlowE = computed(() => (phase.value === 2 ? segE(props.local, 100, 500) : 0))

/** 飞行 token */
const flights = computed(() => {
  const out: {
    key: string
    x1: number
    y1: number
    x2: number
    y2: number
    p: number
    o: number
    color: string
  }[] = []
  if (phase.value === 2) return out
  for (let i = 0; i < TILE_N; i++) {
    const offset = offsets.value[i]
    // mask=false 的位置在 tile 内填 0，不绘制任何连接越界地址的访存 token。
    if (offset >= N) continue
    let x1: number
    let y1: number
    if (phase.value === 0) {
      x1 = rowCx(offset)
      y1 = ROW_A_Y + ROW_H / 2
    } else if (phase.value === 1) {
      x1 = rowCx(offset)
      y1 = ROW_B_Y + ROW_H / 2
    } else {
      x1 = tileCx(i)
      y1 = TILE_Y + TILE_H / 2
    }
    let x2: number
    let y2: number
    if (phase.value === 3) {
      x2 = rowCx(offset)
      y2 = ROW_C_Y + ROW_H / 2
    } else {
      x2 = tileCx(i)
      y2 = TILE_Y + TILE_H / 2
    }
    const p = flightP(i)
    const o =
      seg(props.local, flightStart(i) - 40, flightStart(i) + 90) *
      (1 - seg(props.local, flightStart(i) + 330, flightStart(i) + 420))
    if (o <= 0.02 || p <= 0) continue
    out.push({
      key: `${i}`,
      x1,
      y1,
      x2,
      y2,
      p,
      o,
      color: phase.value === 0
          ? 'var(--ej-a)'
          : phase.value === 1
            ? 'var(--ej-b)'
            : 'var(--ej-c)'
    })
  }
  return out
})
</script>

<template>
  <g>
    <defs>
      <pattern :id="uidHatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ej-bad)" stroke-width="1.5" opacity="0.45" />
      </pattern>
    </defs>

    <!-- ============ 左：program / offsets / tile / mask ============ -->
    <g>
      <rect :x="LEFT_X" :y="LEFT_Y" :width="LEFT_W" :height="LEFT_H" rx="12" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1" />
      <rect :x="LEFT_X + 16" :y="LEFT_Y + 16" width="178" height="40" rx="9" fill="var(--ej-surface)" stroke="var(--ej-b)" stroke-width="1.2" />
      <text :x="LEFT_X + 28" :y="LEFT_Y + 30" font-size="9.5" fill="var(--ej-ink-faint)">program · BLOCK_SIZE = 8</text>
      <text :x="LEFT_X + 28" :y="LEFT_Y + 46" font-size="14" font-weight="700" fill="var(--ej-ink)">pid = {{ prog }}</text>

      <text :x="LEFT_X + 16" y="112" :font-size="10" :font-family="MONO" fill="var(--ej-ink-soft)">offs = pid × 8 + arange(0, 8)</text>
      <text :x="LEFT_X + 16" y="128" :font-size="10.5" :font-family="MONO" font-weight="600" fill="var(--ej-b)">
        = {{ prog }} × 8 + [0…7] = [{{ offsets[0] }}…{{ offsets[7] }}]
      </text>

      <!-- tile：8 个逻辑位置 -->
      <g v-for="(offset, i) in offsets" :key="`tile-${i}`" :opacity="tileBuildE(i)">
        <rect
          :x="tileX(i)"
          :y="TILE_Y"
          :width="TILE_W"
          :height="TILE_H"
          rx="6"
          :fill="offset >= N ? 'var(--ej-bad-soft)' : 'var(--ej-surface)'"
          :stroke="offset >= N ? 'var(--ej-bad)' : 'var(--ej-line-strong)'"
          :stroke-dasharray="offset >= N ? '3 2' : undefined"
          stroke-width="1"
        />
        <rect
          v-if="offset >= N"
          :x="tileX(i)"
          :y="TILE_Y"
          :width="TILE_W"
          :height="TILE_H"
          rx="6"
          :fill="`url(#${uidHatch})`"
        />
        <text
          :x="tileCx(i)"
          :y="TILE_Y + 14"
          text-anchor="middle"
          dominant-baseline="central"
          font-size="11"
          font-weight="600"
          :fill="offset >= N ? 'var(--ej-ink-soft)' : 'var(--ej-ink)'"
        >{{ offset }}</text>
        <text
          v-if="otherTagE(i) > 0"
          :x="tileCx(i)"
          :y="TILE_Y + 30"
          text-anchor="middle"
          font-size="10"
          font-weight="600"
          fill="var(--ej-bad)"
          :opacity="otherTagE(i)"
        >0</text>
      </g>

      <!-- mask 行 -->
      <text :x="TILE_X" y="196" font-size="9.5" fill="var(--ej-ink-faint)">mask</text>
      <g v-for="(offset, i) in offsets" :key="`mask-${i}`" :opacity="tileBuildE(i)">
        <rect
          :x="tileX(i)"
          y="202"
          :width="TILE_W"
          height="16"
          rx="4"
          :fill="offset >= N ? 'var(--ej-bad-soft)' : 'var(--ej-a-soft)'"
        />
        <text
          :x="tileCx(i)"
          y="210"
          text-anchor="middle"
          dominant-baseline="central"
          font-size="9"
          font-weight="700"
          :fill="offset >= N ? 'var(--ej-bad)' : 'var(--ej-a)'"
        >{{ offset >= N ? 'F' : 'T' }}</text>
      </g>

      <!-- phase 2 相加说明 -->
      <text :x="TILE_X + 87" y="244" text-anchor="middle" font-size="10" fill="var(--ej-ink-soft)" :opacity="addGlowE">
        逐位置 c = a + b
      </text>
      <text v-if="prog === 1" :x="TILE_X + 87" y="262" text-anchor="middle" font-size="10" fill="var(--ej-ink-soft)" :opacity="addGlowE">
        填充值相加，结果不写回
      </text>
      <text v-if="prog === 1" :x="TILE_X + 87" y="286" text-anchor="middle" font-size="10" fill="var(--ej-bad)">
        F：load 填 0；store 跳过
      </text>
    </g>

    <!-- ============ 右：全局内存中的 A / B / C ============ -->
    <g v-for="(row, rowIndex) in MEM_ROWS" :key="`row-${row}`">
      <text
        x="288"
        :y="(rowIndex === 0 ? ROW_A_Y : rowIndex === 1 ? ROW_B_Y : ROW_C_Y) + ROW_H / 2"
        text-anchor="end"
        dominant-baseline="central"
        font-size="13"
        font-weight="700"
        :fill="rowIndex === 0 ? 'var(--ej-a)' : rowIndex === 1 ? 'var(--ej-b)' : 'var(--ej-c)'"
      >{{ row }}</text>
    </g>
    <g v-for="offset in ROW_N" :key="`acell-${offset}`">
      <rect
        :x="rowX(offset - 1)"
        :y="ROW_A_Y"
        :width="ROW_CELL_W"
        :height="ROW_H"
        rx="5"
        fill="var(--ej-surface)"
        stroke="var(--ej-line)"
        stroke-width="1"
        :opacity="rowBuildE(0)"
      />
      <rect
        :x="rowX(offset - 1)"
        :y="ROW_A_Y"
        :width="ROW_CELL_W"
        :height="ROW_H"
        rx="5"
        fill="var(--ej-a-soft)"
        stroke="var(--ej-a)"
        stroke-width="1"
        :opacity="rowCellE('A', offset - 1) * rowBuildE(0)"
      />
      <rect
        :x="rowX(offset - 1)"
        :y="ROW_B_Y"
        :width="ROW_CELL_W"
        :height="ROW_H"
        rx="5"
        fill="var(--ej-surface)"
        stroke="var(--ej-line)"
        stroke-width="1"
        :opacity="rowBuildE(150)"
      />
      <rect
        :x="rowX(offset - 1)"
        :y="ROW_B_Y"
        :width="ROW_CELL_W"
        :height="ROW_H"
        rx="5"
        fill="var(--ej-b-soft)"
        stroke="var(--ej-b)"
        stroke-width="1"
        :opacity="rowCellE('B', offset - 1) * rowBuildE(150)"
      />
      <rect
        :x="rowX(offset - 1)"
        :y="ROW_C_Y"
        :width="ROW_CELL_W"
        :height="ROW_H"
        rx="5"
        fill="var(--ej-surface)"
        stroke="var(--ej-line)"
        stroke-width="1"
        :opacity="rowBuildE(300)"
      />
      <rect
        :x="rowX(offset - 1)"
        :y="ROW_C_Y"
        :width="ROW_CELL_W"
        :height="ROW_H"
        rx="5"
        fill="var(--ej-c-soft)"
        stroke="var(--ej-c)"
        stroke-width="1"
        :opacity="rowCellE('C', offset - 1) * rowBuildE(300)"
      />
      <text
        :x="rowCx(offset - 1)"
        :y="ROW_A_Y + ROW_H / 2"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="10"
        fill="var(--ej-ink-soft)"
        :opacity="rowBuildE(0) * 0.9"
      >{{ offset - 1 }}</text>
      <text
        :x="rowCx(offset - 1)"
        :y="ROW_B_Y + ROW_H / 2"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="10"
        fill="var(--ej-ink-soft)"
        :opacity="rowBuildE(150) * 0.9"
      >{{ offset - 1 }}</text>
      <text
        :x="rowCx(offset - 1)"
        :y="ROW_C_Y + ROW_H / 2"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="10"
        fill="var(--ej-ink-soft)"
        :opacity="rowBuildE(300) * 0.9 * (offset - 1 >= N ? 1 - storeBlockE(offset - 9) : 1)"
      >{{ offset - 1 }}</text>
    </g>

    <!-- 越界区（≥13）：斜纹覆盖 -->
    <g v-for="offset in 3" :key="`oob-${offset}`">
      <rect
        v-for="(y, rowIndex) in [ROW_A_Y, ROW_B_Y, ROW_C_Y]"
        :key="`oob-${offset}-${rowIndex}`"
        :x="rowX(offset + 12)"
        :y="y"
        :width="ROW_CELL_W"
        :height="ROW_H"
        rx="5"
        fill="var(--ej-bad-soft)"
        stroke="none"
      />
      <rect
        v-for="(y, rowIndex) in [ROW_A_Y, ROW_B_Y, ROW_C_Y]"
        :key="`oobh-${offset}-${rowIndex}`"
        :x="rowX(offset + 12)"
        :y="y"
        :width="ROW_CELL_W"
        :height="ROW_H"
        rx="5"
        :fill="`url(#${uidHatch})`"
        :opacity="rowBuildE(400)"
      />
    </g>

    <!-- N=13 边界线 -->
    <g :opacity="rowBuildE(400)">
      <line
        :x1="ROW_X + 13 * ROW_PITCH - 1.25"
        y1="58"
        :x2="ROW_X + 13 * ROW_PITCH - 1.25"
        y2="342"
        stroke="var(--ej-ink-soft)"
        stroke-width="1.4"
        stroke-dasharray="5 4"
      />
      <text :x="ROW_X + 13 * ROW_PITCH + 4" y="60" font-size="9.5" font-weight="600" fill="var(--ej-ink-soft)">N = 13</text>
    </g>

    <!-- 写回阶段 mask=false 位置（tile 索引 5–7，对应下标 13–15）的 ✕ -->
    <g v-for="mi in [5, 6, 7]" :key="`block-${mi}`">
      <text
        :x="rowCx(mi + 8)"
        :y="ROW_C_Y + ROW_H / 2"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="13"
        font-weight="700"
        fill="var(--ej-bad)"
        :opacity="storeBlockE(mi)"
      >✕</text>
    </g>

    <!-- 飞行 token -->
    <g v-for="flight in flights" :key="`fl-${flight.key}`" :opacity="flight.o">
      <circle
        :cx="lerp(flight.x1, flight.x2, flight.p)"
        :cy="lerp(flight.y1, flight.y2, flight.p)"
        r="4.5"
        :fill="flight.color"
      />
    </g>

    <!-- ============ 底部流水线 ============ -->
    <text x="48" y="344" font-size="10" fill="var(--ej-ink-faint)">program {{ prog }} 的四个阶段</text>
    <g v-for="(label, i) in PHASES" :key="`ph-${i}`">
      <rect
        :x="48 + i * 158"
        y="352"
        width="150"
        height="30"
        rx="8"
        :fill="phase === i ? 'var(--ej-active-soft)' : 'var(--ej-panel)'"
        :stroke="phase === i ? 'var(--ej-active)' : 'var(--ej-line)'"
        stroke-width="1.2"
      />
      <text
        :x="48 + i * 158 + 75"
        y="367"
        text-anchor="middle"
        dominant-baseline="central"
        :font-size="10.5"
        :font-family="MONO"
        :font-weight="phase === i ? 700 : 400"
        :fill="phase === i ? 'var(--ej-active)' : phase > i ? 'var(--ej-ink-soft)' : 'var(--ej-ink-faint)'"
      >{{ label }}</text>
    </g>
  </g>
</template>
