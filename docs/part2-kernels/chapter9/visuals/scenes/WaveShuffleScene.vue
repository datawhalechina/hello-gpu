<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, lerp, seg, segE } from '../../../../components/animation/easing'

/**
 * 9.4.3 wavefront 内 shuffle 归约的逐步特写。
 * `value += __shfl_down(value, offset)`：低 lane 读取高 lane 的寄存器值并相加，
 * offset 从 warpSize/2 逐轮折半——全程不经过 LDS，也不需要 block 屏障。
 * 教学缩略：warpSize=32 缩略为 8 lane（真实为 16→8→4→2→1 五轮），只追踪 lane 0
 * 最终需要的路径；数据沿用本章手算数组，总和 24 与 @fig-reduction-tree 一致。
 */
const props = defineProps<{ step: number; local: number }>()

const INPUT = [3, 1, 7, 0, 4, 1, 6, 2]
const OFFSETS = [4, 2, 1]
const LANES = Array.from({ length: 8 }, (_, index) => index)

const X0 = 62
const PITCH = 76
const W = 64
const ROW_Y = 128
const H = 52

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const laneX = (lane: number) => X0 + lane * PITCH
const laneCx = (lane: number) => laneX(lane) + W / 2

interface LaneState {
  /** 当前寄存器里显示的值 */
  value: number
  /** 0 = 还没轮到；1 = 本步动画已完成 */
  e: number
  /** 本轮是否仍参与后续计算 */
  alive: boolean
  /** 本轮作为读取源（被低 lane 吸收后退出） */
  retiring: boolean
}

/** 每一步结束时各 lane 的值与存活状态 */
function stateAfter(stepIndex: number): { values: number[]; aliveMask: boolean[] } {
  const values = [...INPUT]
  const rounds = Math.min(stepIndex, OFFSETS.length)
  // 只画最终 lane 0 所依赖的归约树；其余 lane 的中间结果不再追踪。
  for (let round = 0; round < rounds; round++) {
    const offset = OFFSETS[round]
    for (let lane = 0; lane < offset; lane++) values[lane] += values[lane + offset]
  }
  return { values, aliveMask: LANES.map(lane => lane < (8 >> rounds)) }
}

const lanes = computed<LaneState[]>(() => {
  if (props.step === 0) {
    return LANES.map(lane => ({
      value: INPUT[lane],
      e: segE(props.local, 60 + lane * 45, 300 + lane * 45),
      alive: true,
      retiring: false
    }))
  }
  if (props.step > OFFSETS.length) {
    const { values, aliveMask } = stateAfter(OFFSETS.length)
    return LANES.map(lane => ({ value: values[lane], e: 1, alive: aliveMask[lane], retiring: false }))
  }
  const offset = OFFSETS[props.step - 1]
  const { values } = stateAfter(props.step - 1)
  const nextValues = stateAfter(props.step).values
  return LANES.map(lane => {
    const e = easeInOutCubic(seg(props.local, 150 + lane * 40, 550 + lane * 40))
    return {
      value: lane < offset && e >= 1 ? nextValues[lane] : values[lane],
      e: 1,
      alive: lane < offset,
      retiring: lane >= offset && lane < offset * 2
    }
  })
})

/** 本轮的交换箭头（弧线）与飞行圆点 */
const arcs = computed(() => {
  if (props.step === 0 || props.step > OFFSETS.length) return []
  const offset = OFFSETS[props.step - 1]
  const rows: { lane: number; x1: number; x2: number; p: number }[] = []
  for (let lane = 0; lane < offset; lane++) {
    const p = easeInOutCubic(seg(props.local, 150 + lane * 40, 550 + lane * 40))
    if (p <= 0) continue
    rows.push({
      lane,
      x1: laneCx(lane + offset),
      x2: laneCx(lane),
      p
    })
  }
  return rows
})

const stepCaptions = [
  { formula: 'offset = 4 · 2 · 1（warpSize/2 逐轮折半）', text: '8 个 lane 各持一个输入值，等待交换' },
  { formula: 'offset = 4', text: 'lane 0–3 读取 lane 4–7 的寄存器值并相加；其余 lane 的后续值不再追踪' },
  { formula: 'offset = 2', text: '本图继续追踪 lane 0–1；寄存器交换仍在 wavefront 内部完成' },
  { formula: 'offset = 1', text: '最后一轮：lane 0 吸收 lane 1 的部分和' },
  { formula: 'wavefront 归约完成', text: 'lane 0 的寄存器里就是整段的和 24；接下来由 lane 0 写 LDS，等待 block 合并' }
]

const caption = computed(() => stepCaptions[Math.min(props.step, stepCaptions.length - 1)])

const roundDots = computed(() =>
  OFFSETS.map((offset, index) => ({
    offset,
    active: props.step === index + 1,
    done: props.step > index + 1
  }))
)
</script>

<template>
  <g font-family="inherit">
    <!-- 顶部：公式与轮次胶囊 -->
    <text x="360" y="26" text-anchor="middle" dominant-baseline="central" font-size="12" :font-family="MONO" fill="var(--ej-ink-soft)">
      {{ caption.formula }}
    </text>
    <g v-for="(dot, index) in roundDots" :key="`dot-${index}`">
      <rect
        :x="252 + index * 76"
        y="40"
        width="68"
        height="22"
        rx="11"
        :fill="dot.active ? 'var(--ej-active-soft)' : dot.done ? 'var(--ej-panel)' : 'var(--ej-surface)'"
        :stroke="dot.active ? 'var(--ej-active)' : 'var(--ej-line-strong)'"
        stroke-width="1.2"
      />
      <text
        :x="252 + index * 76 + 34"
        y="51"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="10.5"
        :font-weight="dot.active ? 700 : 400"
        :fill="dot.active ? 'var(--ej-active)' : dot.done ? 'var(--ej-ink-soft)' : 'var(--ej-ink-faint)'"
      >offset={{ dot.offset }}</text>
    </g>

    <!-- lane 寄存器行 -->
    <g v-for="(laneState, lane) in lanes" :key="`lane-${lane}`">
      <rect
        :x="laneX(lane)"
        :y="ROW_Y"
        :width="W"
        :height="H"
        rx="9"
        :fill="laneState.alive ? 'var(--ej-surface)' : 'var(--ej-bad-soft)'"
        :stroke="laneState.alive ? 'var(--ej-a)' : 'var(--ej-line)'"
        :stroke-width="laneState.alive && laneState.e > 0 && props.step > 0 ? 1.6 : 1"
        :stroke-dasharray="laneState.alive ? undefined : '4 3'"
        :opacity="laneState.alive ? 1 : 0.75"
      />
      <text :x="laneCx(lane)" :y="ROW_Y + 14" text-anchor="middle" font-size="9.5" fill="var(--ej-ink-faint)">lane {{ lane }}</text>
      <text
        :x="laneCx(lane)"
        :y="ROW_Y + 36"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="17"
        font-weight="600"
        :fill="laneState.alive ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'"
      >{{ laneState.e > 0.02 ? Math.round(laneState.value * 100) / 100 : '·' }}</text>
      <text
        v-if="!laneState.alive"
        :x="laneCx(lane)"
        :y="ROW_Y + H + 14"
        text-anchor="middle"
        font-size="9"
        fill="var(--ej-ink-faint)"
      >不再追踪</text>
    </g>

    <!-- 交换弧线与飞行圆点 -->
    <g v-for="arc in arcs" :key="`arc-${arc.lane}`">
      <path
        :d="`M ${arc.x2} ${ROW_Y - 8} Q ${(arc.x1 + arc.x2) / 2} ${ROW_Y - 62} ${arc.x1} ${ROW_Y - 8}`"
        fill="none"
        stroke="var(--ej-active)"
        stroke-width="1.6"
        :opacity="arc.p >= 1 ? 0.4 : 0.85"
        :stroke-dasharray="arc.p >= 1 ? '3 3' : undefined"
      />
      <circle
        :cx="lerp(arc.x1, arc.x2, arc.p)"
        :cy="ROW_Y - 8 - 108 * arc.p * (1 - arc.p)"
        r="4.5"
        fill="var(--ej-active)"
        :opacity="arc.p >= 1 ? 0 : 1"
      />
    </g>

    <!-- 汇合高亮：最后一步 lane 0 交出 -->
    <g v-if="props.step === 4" :opacity="segE(props.local, 200, 600)">
      <rect x="254" y="248" width="212" height="40" rx="9" fill="var(--ej-c-soft)" stroke="var(--ej-c)" stroke-width="1.4" />
      <text x="360" y="268" text-anchor="middle" dominant-baseline="central" font-size="13.5" font-weight="700" fill="var(--ej-c)">
        lane 0 → 24，交给下一步
      </text>
    </g>

    <!-- 底部说明 -->
    <text x="360" y="318" text-anchor="middle" font-size="12" fill="var(--ej-ink-soft)">{{ caption.text }}</text>
    <text x="708" y="14" text-anchor="end" font-size="9" fill="var(--ej-ink-faint)">wave32 共 5 轮 · 此处用 8 lane 演示 lane 0 的依赖树</text>
  </g>
</template>
