<script setup lang="ts">
import { computed } from 'vue'
import { easeOutCubic, lerp } from '../../components/animation/easing'
import { ADDITION_COMPLETE_MS, TRANSFER_COMPLETE_MS, journeyCopy, journeyState } from './memory-model'

const props = defineProps<{
  step: number
  local: number
  compact: boolean
  reducedMotion: boolean
}>()
type Box = { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number }
const center = (box: Box): Point => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 })
const left = (box: Box): Point => ({ x: box.x, y: center(box).y })
const right = (box: Box): Point => ({ x: box.x + box.w, y: center(box).y })
const state = computed(() => journeyState(props.step, props.local, props.reducedMotion))
const progress = computed(() => journeyCopy(props.local, props.reducedMotion))
const resultProgress = computed(() => props.reducedMotion ? 1 : easeOutCubic(Math.max(0,
  Math.min((props.local - ADDITION_COMPLETE_MS) / (TRANSFER_COMPLETE_MS - ADDITION_COMPLETE_MS), 1))))
const width = computed(() => props.compact ? 400 : 720)

// The layout is fixed across all five steps. Only contents and active paths change.
const layout = computed(() => props.compact ? {
  storage: { x: 12, y: 64, w: 160, h: 340 },
  thread: { x: 208, y: 64, w: 180, h: 532 },
  registers: { x: 220, y: 112, w: 156, h: 280 },
  a: { x: 26, y: 160, w: 132, h: 50 },
  b: { x: 26, y: 236, w: 132, h: 50 },
  output: { x: 26, y: 326, w: 132, h: 54 },
  temporaryA: { x: 232, y: 160, w: 132, h: 50 },
  temporaryB: { x: 232, y: 236, w: 132, h: 50 },
  result: { x: 232, y: 326, w: 132, h: 54 },
  adder: { x: 226, y: 464, w: 144, h: 112 }
} : {
  storage: { x: 20, y: 64, w: 240, h: 316 },
  thread: { x: 324, y: 64, w: 376, h: 316 },
  registers: { x: 340, y: 108, w: 166, h: 254 },
  a: { x: 40, y: 140, w: 200, h: 52 },
  b: { x: 40, y: 215, w: 200, h: 52 },
  output: { x: 40, y: 300, w: 200, h: 52 },
  temporaryA: { x: 354, y: 148, w: 138, h: 46 },
  temporaryB: { x: 354, y: 215, w: 138, h: 46 },
  result: { x: 354, y: 304, w: 138, h: 42 },
  adder: { x: 542, y: 178, w: 140, h: 118 }
})
const inputs = computed(() => [
  { id: 'a', label: 'a[2]', value: state.value.sourceA, box: layout.value.a, destination: layout.value.temporaryA, color: 'var(--ej-a)', soft: 'var(--ej-a-soft)' },
  { id: 'b', label: 'b[2]', value: state.value.sourceB, box: layout.value.b, destination: layout.value.temporaryB, color: 'var(--ej-b)', soft: 'var(--ej-b-soft)' }
])
const readPaths = computed(() => inputs.value.map(input => ({ ...input, points: [right(input.box), left(input.destination)] })))
const requestPath = computed<Point[]>(() => props.compact
  ? [{ x: 208, y: 120 }, { x: 172, y: 120 }]
  : [{ x: 324, y: 113 }, { x: 260, y: 113 }])
const calculationPaths = computed(() => inputs.value.map((input, index) => ({
  ...input,
  points: props.compact
    ? [right(input.destination), { x: 384 - index * 6, y: center(input.destination).y },
      { x: 384 - index * 6, y: 486 + index * 36 }, { x: 370, y: 486 + index * 36 }]
    : [right(input.destination), { x: 518, y: center(input.destination).y }, { x: 542, y: 211 + index * 35 }]
})))
const arithmeticResultPath = computed<Point[]>(() => props.compact
  ? [left(layout.value.adder), { x: 214, y: center(layout.value.adder).y },
    { x: 214, y: center(layout.value.result).y }, left(layout.value.result)]
  : [{ x: center(layout.value.adder).x, y: layout.value.adder.y + layout.value.adder.h },
    { x: center(layout.value.adder).x, y: center(layout.value.result).y }, right(layout.value.result)])
const writePath = computed(() => [left(layout.value.result), right(layout.value.output)])
const status = computed(() => state.value.outputReady ? 'GPU 侧已写回 c[2] = 33'
  : props.step === 4 ? '将临时结果写回数组存储'
  : state.value.resultReady ? '临时结果已有 33，c[2] 尚未写入'
  : state.value.additionDone ? '加法已完成，正在保留临时结果'
  : props.step === 3 ? '加法部件使用 3 和 30 执行运算'
  : state.value.operandsReady ? '临时值已到达，输入原值保留'
  : state.value.waitingForInputs ? '等待输入，尚不能执行加法'
  : '数组保存数据；加法部件负责运算')

function path(points: Point[]) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
}
function position(points: Point[], p: number): Point {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y))
  let distance = lengths.reduce((sum, length) => sum + length, 0) * p
  for (let index = 0; index < lengths.length; index++) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      const local = lengths[index] ? distance / lengths[index] : 1
      return { x: lerp(points[index].x, points[index + 1].x, local), y: lerp(points[index].y, points[index + 1].y, local) }
    }
    distance -= lengths[index]
  }
  return points[points.length - 1]
}
function arrow(points: Point[]) {
  const end = points[points.length - 1]
  const from = points[points.length - 2]
  const length = Math.hypot(end.x - from.x, end.y - from.y)
  const dx = (end.x - from.x) / length
  const dy = (end.y - from.y) / length
  return `${end.x},${end.y} ${end.x - dx * 8 + dy * 4},${end.y - dy * 8 - dx * 4} ${end.x - dx * 8 - dy * 4},${end.y - dy * 8 + dx * 4}`
}
</script>

<template>
  <g font-family="inherit" :data-memory-step="step" :data-operands-ready="state.operandsReady"
    :data-result-ready="state.resultReady" :data-output-ready="state.outputReady">
    <text :x="width / 2" y="28" text-anchor="middle" font-size="18" font-weight="600" fill="var(--ej-ink)">a[2] + b[2] → c[2]</text>

    <g data-memory-region="array-storage">
      <rect :x="layout.storage.x" :y="layout.storage.y" :width="layout.storage.w" :height="layout.storage.h" rx="8" fill="var(--ej-panel)" stroke="var(--ej-line-strong)" />
      <text :x="layout.storage.x + 16" :y="layout.storage.y + 29" font-size="18" font-weight="600" fill="var(--ej-ink)">数组存储</text>
      <text v-if="!compact" :x="layout.storage.x + 16" :y="layout.storage.y + 52" font-size="15" fill="var(--ej-ink-soft)">输入与输出的存放位置</text>
      <g v-for="input in inputs" :key="input.id" :data-input="input.id" :data-source-value="input.value">
        <rect :x="input.box.x" :y="input.box.y" :width="input.box.w" :height="input.box.h" rx="5" :fill="input.soft" :stroke="input.color" stroke-width="1.5" />
        <text :x="input.box.x + 12" :y="input.box.y + 21" font-size="16" :fill="input.color">{{ input.label }}</text>
        <text :x="input.box.x + input.box.w - 14" :y="input.box.y + 38" text-anchor="end" font-size="28" font-weight="600" :fill="input.color">{{ input.value }}</text>
      </g>
      <g :data-output-value="state.output ?? 'unwritten'">
        <rect :x="layout.output.x" :y="layout.output.y" :width="layout.output.w" :height="layout.output.h" rx="5" :fill="state.outputReady ? 'var(--ej-c-soft)' : 'var(--ej-bg)'" :stroke="state.outputReady ? 'var(--ej-c)' : 'var(--ej-line-strong)'" :stroke-dasharray="state.outputReady ? undefined : '4 4'" />
        <text :x="layout.output.x + 12" :y="layout.output.y + 21" font-size="16" fill="var(--ej-ink-soft)">c[2]</text>
        <text :x="layout.output.x + layout.output.w - 14" :y="layout.output.y + 39" text-anchor="end" :font-size="state.outputReady ? 28 : 16" :font-weight="state.outputReady ? 600 : 400" :fill="state.outputReady ? 'var(--ej-c)' : 'var(--ej-ink-soft)'">{{ state.outputReady ? state.output : '未写入' }}</text>
      </g>
    </g>

    <g data-memory-region="thread">
      <rect :x="layout.thread.x" :y="layout.thread.y" :width="layout.thread.w" :height="layout.thread.h" rx="8" fill="var(--ej-panel)" stroke="var(--ej-line-strong)" />
      <text :x="layout.thread.x + 16" :y="layout.thread.y + 29" font-size="18" font-weight="600" fill="var(--ej-ink)">本线程</text>
      <g data-memory-region="registers">
        <rect :x="layout.registers.x" :y="layout.registers.y" :width="layout.registers.w" :height="layout.registers.h" rx="6" fill="var(--ej-surface)" stroke="var(--ej-line-strong)" />
        <text :x="center(layout.registers).x" :y="layout.registers.y + 25" text-anchor="middle" font-size="16" font-weight="600" fill="var(--ej-ink)">临时值 · 寄存器</text>
        <g v-for="input in inputs" :key="input.id">
          <rect :x="input.destination.x" :y="input.destination.y" :width="input.destination.w" :height="input.destination.h" rx="5" :fill="state.operandsReady ? input.soft : 'var(--ej-bg)'" :stroke="state.operandsReady ? input.color : 'var(--ej-line-strong)'" :stroke-dasharray="state.operandsReady ? undefined : '4 4'" />
          <text :x="input.destination.x + 10" :y="input.destination.y + 29" :font-size="compact ? 16 : 15" fill="var(--ej-ink-soft)">来自 {{ input.label }}</text>
          <text :x="input.destination.x + input.destination.w - 12" :y="input.destination.y + 31" text-anchor="end" font-size="24" font-weight="600" :fill="state.operandsReady ? input.color : 'var(--ej-ink-faint)'">{{ state.operandsReady ? input.value : '—' }}</text>
        </g>
        <g :data-temporary-result="state.temporaryResult ?? 'unavailable'">
          <rect :x="layout.result.x" :y="layout.result.y" :width="layout.result.w" :height="layout.result.h" rx="5" :fill="state.resultReady ? 'var(--ej-c-soft)' : 'var(--ej-bg)'" :stroke="state.resultReady ? 'var(--ej-c)' : 'var(--ej-line-strong)'" :stroke-dasharray="state.resultReady ? undefined : '4 4'" />
          <text :x="layout.result.x + 10" :y="center(layout.result).y + 6" :font-size="compact ? 16 : 15" fill="var(--ej-ink-soft)">临时结果</text>
          <text :x="layout.result.x + layout.result.w - 12" :y="center(layout.result).y + 8" text-anchor="end" font-size="24" font-weight="600" :fill="state.resultReady ? 'var(--ej-c)' : 'var(--ej-ink-faint)'">{{ state.temporaryResult ?? '—' }}</text>
        </g>
      </g>

      <g data-memory-region="arithmetic" :data-arithmetic-result="state.arithmeticResult ?? 'unavailable'">
        <rect :x="layout.adder.x" :y="layout.adder.y" :width="layout.adder.w" :height="layout.adder.h" rx="6" :fill="step === 3 ? 'var(--ej-active-soft)' : 'var(--ej-bg)'" :stroke="step === 3 ? 'var(--ej-active)' : 'var(--ej-line-strong)'" :stroke-width="step === 3 ? 2 : 1" />
        <text :x="center(layout.adder).x" :y="layout.adder.y + 25" text-anchor="middle" font-size="18" font-weight="600" fill="var(--ej-ink)">执行加法</text>
        <text :x="center(layout.adder).x" :y="layout.adder.y + 65" text-anchor="middle" font-size="34" font-weight="600" :fill="step === 3 ? 'var(--ej-active)' : 'var(--ej-ink-soft)'">+</text>
        <text :x="center(layout.adder).x" :y="layout.adder.y + 94" text-anchor="middle" font-size="16" :fill="state.additionDone ? 'var(--ej-c)' : 'var(--ej-ink-soft)'">{{ state.additionDone ? '得到 33' : step === 3 ? '3 + 30' : state.operandsReady ? '输入就绪' : '等待输入' }}</text>
      </g>
    </g>

    <g v-if="step === 1">
      <path :d="path(requestPath)" fill="none" stroke="var(--ej-ink-soft)" stroke-width="2" stroke-dasharray="4 4" />
      <polygon :points="arrow(requestPath)" fill="var(--ej-ink-soft)" />
      <circle :cx="position(requestPath, progress).x" :cy="position(requestPath, progress).y" r="5" fill="var(--ej-ink-soft)" />
      <text :x="compact ? 190 : 292" y="51" text-anchor="middle" font-size="16" fill="var(--ej-ink-soft)">读取请求</text>
    </g>

    <g v-if="step === 2">
      <g v-for="input in readPaths" :key="input.id">
        <path :d="path(input.points)" fill="none" :stroke="input.color" stroke-width="2" />
        <polygon :points="arrow(input.points)" :fill="input.color" />
        <g v-if="!state.operandsReady" :transform="`translate(${position(input.points, progress).x}, ${position(input.points, progress).y})`">
          <circle r="17" fill="var(--ej-bg)" :stroke="input.color" stroke-width="2" />
          <text text-anchor="middle" dominant-baseline="central" font-size="16" font-weight="600" :fill="input.color">{{ input.value }}</text>
        </g>
      </g>
    </g>

    <g v-if="step === 3">
      <g v-for="input in calculationPaths" :key="input.id">
        <path :d="path(input.points)" fill="none" :stroke="input.color" stroke-width="2" />
        <polygon :points="arrow(input.points)" :fill="input.color" />
      </g>
      <g v-if="state.additionDone">
        <path :d="path(arithmeticResultPath)" fill="none" stroke="var(--ej-c)" stroke-width="2" />
        <polygon :points="arrow(arithmeticResultPath)" fill="var(--ej-c)" />
        <g v-if="!state.resultReady" :transform="`translate(${position(arithmeticResultPath, resultProgress).x}, ${position(arithmeticResultPath, resultProgress).y})`">
          <circle r="17" fill="var(--ej-bg)" stroke="var(--ej-c)" stroke-width="2" />
          <text text-anchor="middle" dominant-baseline="central" font-size="16" font-weight="600" fill="var(--ej-c)">33</text>
        </g>
      </g>
    </g>

    <g v-if="step === 4">
      <path :d="path(writePath)" fill="none" stroke="var(--ej-c)" stroke-width="2" />
      <polygon :points="arrow(writePath)" fill="var(--ej-c)" />
      <g v-if="!state.outputReady" :transform="`translate(${position(writePath, progress).x}, ${position(writePath, progress).y})`">
        <circle r="18" fill="var(--ej-bg)" stroke="var(--ej-c)" stroke-width="2" />
        <text text-anchor="middle" dominant-baseline="central" font-size="16" font-weight="600" fill="var(--ej-c)">33</text>
      </g>
    </g>

    <text :x="width / 2" :y="compact ? 623 : 412" text-anchor="middle" font-size="16" font-weight="500" fill="var(--ej-ink)">{{ status }}</text>
  </g>
</template>
