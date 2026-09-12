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

const X0 = 62
const PITCH = 50
const W = 48
const ROW_Y = { a: 85, b: 157, c: 254 }
const H = 42

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

/** 未处理位置保留可读的底色；当前列随时钟渐显，完成列保持亮度。 */
function valueOpacity(col: ColState): number {
  if (col.mode === 'future') return 0.72
  if (col.mode === 'done') return 0.94
  return lerp(0.72, 1, col.e)
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
  <g class="dependency-scene">
    <defs>
      <marker :id="`${uid}-arrow`" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M1 1 L7 4 L1 7" fill="none" stroke="var(--ej-active)" stroke-width="1.5" />
      </marker>
    </defs>

    <rect x="8" y="12" width="468" height="302" rx="5" fill="var(--ej-bg)" stroke="var(--ej-line)" />
    <rect class="dependency-desktop-detail" x="488" y="12" width="224" height="302" rx="5" fill="var(--ej-bg)" stroke="var(--ej-line)" />
    <text x="24" y="50" dominant-baseline="central" font-size="10" fill="var(--ej-ink-soft)">下标 i</text>

    <template v-for="row in (['a', 'b', 'c'] as const)" :key="row">
      <text x="24" :y="ROW_Y[row] + 21" dominant-baseline="central" font-size="24" font-weight="550" :fill="`var(--ej-${row})`">{{ row.toUpperCase() }}</text>
      <rect x="58" :y="ROW_Y[row] - 4" width="406" :height="H + 8" rx="4" fill="none" stroke="var(--ej-line)" />
    </template>

    <template v-for="(col, j) in cols" :key="`col-${j}`">
      <g v-if="col.mode === 'current'" :opacity="col.e">
        <path :d="`M${cx(j) - 23} 31h46v24h-19l-4 5-4-5h-19Z`" fill="var(--ej-panel)" stroke="var(--ej-active)" stroke-width=".8" />
        <text :x="cx(j)" y="44" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="600" fill="var(--ej-active)">i = {{ j }}</text>
      </g>
      <text v-else :x="cx(j)" y="50" text-anchor="middle" dominant-baseline="central" font-size="11" fill="var(--ej-ink-soft)">{{ j }}</text>

      <template v-for="row in (['a', 'b', 'c'] as const)" :key="`${j}-${row}`">
        <rect :x="cellX(j)" :y="ROW_Y[row]" :width="W" :height="H" rx="2"
          :fill="`var(--ej-${row})`" :fill-opacity="col.mode === 'current' ? lerp(.50, .88, col.e) : col.mode === 'done' ? .70 : .42" />
        <rect v-if="col.mode === 'current'" :x="cellX(j) - 1" :y="ROW_Y[row] - 1" :width="W + 2" :height="H + 2" rx="4"
          fill="none" :stroke="`var(--ej-${row})`" stroke-width="3" :opacity="col.e" />
        <rect v-if="col.mode === 'current'" :x="cellX(j) - 3" :y="ROW_Y[row] - 3" :width="W + 6" :height="H + 6" rx="5"
          fill="none" :stroke="`var(--ej-${row})`" stroke-width="1" :opacity="col.e * .45" />
        <text :x="cx(j)" :y="ROW_Y[row] + 23" text-anchor="middle" dominant-baseline="central"
          font-size="17" font-weight="550" fill="var(--ej-ink)" :opacity="valueOpacity(col)">{{ row === 'a' ? A[j] : row === 'b' ? B[j] : C[j] }}</text>
      </template>

      <g :opacity="col.mode === 'current' ? col.e : overlayOpacity(col) * .20">
        <line :x1="cx(j)" y1="132" :x2="cx(j)" y2="151" stroke="var(--ej-active)" stroke-width="1.6" />
        <line :x1="cx(j)" y1="204" :x2="cx(j)" y2="248" stroke="var(--ej-active)" stroke-width="1.6" :marker-end="`url(#${uid}-arrow)`" />
        <g v-if="col.mode === 'current'">
          <rect :x="cx(j) - 20" y="213" width="40" height="23" rx="12" fill="var(--ej-bg)" stroke="var(--ej-active)" stroke-width=".8" />
          <text :x="cx(j)" y="225" text-anchor="middle" dominant-baseline="central" font-size="10" fill="var(--ej-ink)">相加</text>
        </g>
      </g>
    </template>

    <g class="dependency-desktop-detail">
    <text x="504" y="48" font-size="16" font-weight="600" fill="var(--ej-active)">{{ equation ? '只处理自己的位置' : '每个位置都能独立计算' }}</text>
    <text x="504" y="76" font-size="10.5" fill="var(--ej-ink-soft)">{{ equation ? `下标 ${step} 的计算过程如下：` : '8 个位置可以按任意顺序完成。' }}</text>
    <rect x="504" y="91" width="192" height="101" rx="5" fill="var(--ej-surface)" stroke="var(--ej-line-strong)" />
    <g v-if="equation" font-family="var(--vp-font-family-mono)" text-anchor="middle" font-size="13">
      <text x="600" y="119">
        <tspan v-for="(part, index) in equation.slice(0, 5)" :key="index" :fill="part.fill" :fill-opacity="part.o">{{ part.text }}</tspan>
      </text>
      <text x="600" y="148" :fill="equation[5].fill" :fill-opacity="equation[5].o">{{ equation[5].text }}</text>
      <text x="600" y="177" :fill="equation[6].fill" :fill-opacity="equation[6].o" font-weight="600">{{ equation[6].text }}</text>
    </g>
    <g v-else :opacity="overviewIn" text-anchor="middle">
      <text x="600" y="127" font-size="13" font-family="var(--vp-font-family-mono)">
        <tspan fill="var(--ej-c)">C[i]</tspan><tspan fill="var(--ej-ink-soft)"> = </tspan><tspan fill="var(--ej-a)">A[i]</tspan><tspan fill="var(--ej-ink-soft)"> + </tspan><tspan fill="var(--ej-b)">B[i]</tspan>
      </text>
      <text x="600" y="159" font-size="11" fill="var(--ej-ink-soft)">i 可以取任意位置</text>
    </g>
    <path d="M504 213h192" stroke="var(--ej-line)" />
    <text x="504" y="237" font-size="12" font-weight="600" fill="var(--ej-active)">关键点</text>
    <g fill="var(--ej-ink-soft)" font-size="10.5">
      <circle cx="507" cy="257" r="1.8" fill="var(--ej-active)" /><text x="517" y="261">只读取同一位置的两个输入。</text>
      <circle cx="507" cy="278" r="1.8" fill="var(--ej-active)" /><text x="517" y="282">其他位置的计算不影响结果。</text>
      <text x="504" y="302" fill="var(--ej-ink-faint)" font-size="9.5">逐元素算子可以大规模并行。</text>
    </g>
    </g>
    <g class="dependency-mobile-detail">
      <rect x="8" y="328" width="468" height="108" rx="5" fill="var(--ej-bg)" stroke="var(--ej-line)" />
      <text x="24" y="355" font-size="16" fill="var(--ej-active)">{{ equation ? `在位置 i = ${step}：` : '每个位置都能独立计算' }}</text>
      <text v-if="equation" x="24" y="386" font-size="16" font-family="var(--vp-font-family-mono)">
        <tspan v-for="(part, index) in equation" :key="index" :fill="part.fill" :fill-opacity="part.o">{{ part.text }}</tspan>
      </text>
      <text v-else x="24" y="386" font-size="16" fill="var(--ej-c)" font-family="var(--vp-font-family-mono)">C[i] = A[i] + B[i]</text>
      <text x="24" y="415" font-size="14" fill="var(--ej-ink-soft)">其他位置的计算，不影响这个结果。</text>
    </g>
  </g>
</template>

<style scoped>
.dependency-mobile-detail { display: none; }
@media (max-width: 640px) {
  .dependency-desktop-detail { display: none; }
  .dependency-mobile-detail { display: block; }
}
</style>
