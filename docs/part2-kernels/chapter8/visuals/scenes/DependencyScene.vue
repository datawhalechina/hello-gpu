<script setup lang="ts">
import { computed, useId } from 'vue'
import { lerp, segE } from '../easing'
import { INPUT_A, INPUT_B, OUTPUT_C } from './data'

/**
 * 8.1.1 依赖关系：逐列点亮 C[i] = A[i] + B[i]，
 * 结尾「并行俯瞰」以乱序节奏完成全部 8 列，直观呈现位置之间的独立性。
 */
const props = defineProps<{ step: number; local: number }>()

const A = INPUT_A
const B = INPUT_B
const C = OUTPUT_C
const N = 8
/** 并行俯瞰步的乱序完成顺序：谁先算完都可以 */
const ORDER = [5, 0, 3, 7, 1, 6, 2, 4]

const X0 = 128
const PITCH = 66
const W = 56
const ROW_Y = { a: 84, b: 150, c: 216 }
const H = 46

const uid = useId()

interface ColState {
  mode: 'future' | 'current' | 'done'
  /** 0=未处理 1=完成，中间值用于入场过渡 */
  e: number
}

const cols = computed<ColState[]>(() =>
  Array.from({ length: N }, (_, j) => {
    if (props.step < N) {
      if (j < props.step) return { mode: 'done', e: 1 }
      if (j > props.step) return { mode: 'future', e: 0 }
      return { mode: 'current', e: segE(props.local, 60, 620) }
    }
    const pos = ORDER.indexOf(j)
    const e = segE(props.local, 150 + pos * 130, 470 + pos * 130)
    if (e <= 0) return { mode: 'future', e: 0 }
    return e >= 1 ? { mode: 'done', e: 1 } : { mode: 'current', e }
  })
)

const cellX = (j: number) => X0 + j * PITCH
const cx = (j: number) => cellX(j) + W / 2

/** 数值文字透明度：未处理 0.4 → 处理中渐显 → 完成 0.78 */
function valueOpacity(col: ColState): number {
  if (col.mode === 'future') return 0.4
  if (col.mode === 'done') return 0.78
  return lerp(0.4, 1, col.e)
}

/** 覆盖高亮透明度：完成态保留半透明残影，表示已累计算完 */
function overlayOpacity(col: ColState): number {
  if (col.mode === 'future') return 0
  if (col.mode === 'done') return 0.5
  return col.e
}

const equation = computed(() => {
  if (props.step >= N) return null
  const s = props.step
  const o = (start: number, end: number) => segE(props.local, start, end)
  return [
    { text: `C[${s}]`, fill: 'var(--ej-c)', o: o(0, 250) },
    { text: ' = ', fill: 'var(--ej-ink-soft)', o: o(120, 350) },
    { text: `A[${s}]`, fill: 'var(--ej-a)', o: o(220, 470) },
    { text: ' + ', fill: 'var(--ej-ink-soft)', o: o(320, 550) },
    { text: `B[${s}]`, fill: 'var(--ej-b)', o: o(400, 650) },
    { text: ` = ${A[s]} + ${B[s]}`, fill: 'var(--ej-ink-soft)', o: o(550, 850) },
    { text: ` = ${C[s]}`, fill: 'var(--ej-c)', o: o(750, 1100) }
  ]
})

const overviewIn = computed(() =>
  props.step >= N ? segE(props.local, 1350, 1900) : 0
)
</script>

<template>
  <g>
    <defs>
      <marker
        :id="`${uid}-arrow`"
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M1 1 L7 4 L1 7 Z" fill="var(--ej-ink-soft)" />
      </marker>
    </defs>

    <!-- 顶部方程：当前列的实时代数 / 并行俯瞰的泛化形式 -->
    <text
      x="360"
      y="30"
      text-anchor="middle"
      dominant-baseline="central"
      font-size="15.5"
      font-weight="600"
    >
      <template v-if="equation">
        <tspan
          v-for="(part, index) in equation"
          :key="index"
          :fill="part.fill"
          :fill-opacity="part.o"
          :font-weight="index === equation.length - 1 ? 700 : 600"
        >{{ part.text }}</tspan>
      </template>
      <template v-else>
        <tspan fill="var(--ej-c)" :fill-opacity="overviewIn">C[i]</tspan>
        <tspan fill="var(--ej-ink-soft)" :fill-opacity="overviewIn"> = </tspan>
        <tspan fill="var(--ej-a)" :fill-opacity="overviewIn">A[i]</tspan>
        <tspan fill="var(--ej-ink-soft)" :fill-opacity="overviewIn"> + </tspan>
        <tspan fill="var(--ej-b)" :fill-opacity="overviewIn">B[i]</tspan>
        <tspan fill="var(--ej-ink-faint)" :fill-opacity="overviewIn * 0.9">　（i 取任意位置）</tspan>
      </template>
    </text>

    <!-- 左侧行标签与运算符 -->
    <text x="110" :y="ROW_Y.a + 23" text-anchor="end" dominant-baseline="central" font-size="14" font-weight="600" fill="var(--ej-a)">A</text>
    <text x="110" y="145" text-anchor="end" dominant-baseline="central" font-size="15" fill="var(--ej-ink-faint)">+</text>
    <text x="110" :y="ROW_Y.b + 23" text-anchor="end" dominant-baseline="central" font-size="14" font-weight="600" fill="var(--ej-b)">B</text>
    <text x="110" y="211" text-anchor="end" dominant-baseline="central" font-size="15" fill="var(--ej-ink-faint)">=</text>
    <text x="110" :y="ROW_Y.c + 23" text-anchor="end" dominant-baseline="central" font-size="14" font-weight="600" fill="var(--ej-c)">C</text>

    <template v-for="(col, j) in cols" :key="`col-${j}`">
      <!-- 列聚光灯 -->
      <rect
        v-if="col.e > 0 && col.mode === 'current'"
        :x="cellX(j) - 7"
        y="52"
        :width="W + 14"
        height="216"
        rx="12"
        fill="var(--ej-active-soft)"
        :opacity="col.e"
      />

      <!-- 列头 -->
      <text
        :x="cx(j)"
        y="66"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="10.5"
        :fill="col.mode === 'future' ? 'var(--ej-ink-faint)' : 'var(--ej-active)'"
        :font-weight="col.mode === 'future' ? 400 : 600"
        :opacity="col.mode === 'current' ? lerp(0.5, 1, col.e) : 1"
      >位置 {{ j }}</text>

      <!-- 三行数据格：底格 + 高亮覆盖 + 数值 -->
      <template v-for="row in (['a', 'b', 'c'] as const)" :key="`${j}-${row}`">
        <rect
          :x="cellX(j)"
          :y="ROW_Y[row]"
          :width="W"
          :height="H"
          rx="9"
          fill="var(--ej-surface)"
          stroke="var(--ej-line)"
          stroke-width="1"
        />
        <rect
          :x="cellX(j)"
          :y="ROW_Y[row]"
          :width="W"
          :height="H"
          rx="9"
          :fill="`var(--ej-${row}-soft)`"
          :stroke="`var(--ej-${row})`"
          :stroke-width="col.mode === 'current' ? 1.8 : 1"
          :opacity="overlayOpacity(col)"
        />
        <text
          :x="cx(j)"
          :y="ROW_Y[row] + 25"
          text-anchor="middle"
          dominant-baseline="central"
          font-size="15"
          font-weight="600"
          :fill="`var(--ej-${row})`"
          :opacity="valueOpacity(col)"
        >{{ row === 'a' ? A[j] : row === 'b' ? B[j] : C[j] }}</text>
      </template>

      <!-- 列内数据流箭头 -->
      <g :opacity="overlayOpacity(col)">
        <line
          :x1="cx(j)"
          y1="132"
          :x2="cx(j)"
          y2="144"
          stroke="var(--ej-ink-soft)"
          stroke-width="1.6"
          :marker-end="`url(#${uid}-arrow)`"
        />
        <line
          :x1="cx(j)"
          y1="198"
          :x2="cx(j)"
          y2="210"
          stroke="var(--ej-ink-soft)"
          stroke-width="1.6"
          :marker-end="`url(#${uid}-arrow)`"
        />
      </g>
    </template>

    <!-- 并行俯瞰结语 -->
    <g :opacity="overviewIn">
      <text x="360" y="300" text-anchor="middle" dominant-baseline="central" font-size="13.5" font-weight="600" fill="var(--ej-ink)">
        8 个位置互不依赖 → 可以按任意顺序、同时计算
      </text>
      <text x="360" y="318" text-anchor="middle" dominant-baseline="central" font-size="11" fill="var(--ej-ink-soft)">
        GPU 会把这些位置分给大量执行单元并行处理（下一节：两种分工视角）
      </text>
    </g>
  </g>
</template>
