<script setup lang="ts">
import { computed } from 'vue'
import { segE } from '../../../../components/animation/easing'

/**
 * 11.3.4 Triton grouped ordering：program ID → 输出块映射的两种安排。
 * GROUP_M=1 行优先扫描 vs GROUP_M=8 分组列优先扫描（同组围绕同一列 B）。
 * 教学网格：3 行 × 4 列 = 12 个 program（正文手算例子为 4×3 与 GROUP_M=2）。
 * 映射公式与 kernel 一致：group_id = id // (GROUP*programs_n)，m = first + in_group % group_m，
 * n = in_group // group_m。
 */
const props = defineProps<{ step: number; local: number }>()

const ROWS = 3
const COLS = 4
const TOTAL = ROWS * COLS
const IDS = Array.from({ length: TOTAL }, (_, index) => index)

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** group_m 映射（GROUP_SIZE_M=1 与 8） */
function mapWith(group: 1 | 8, id: number): { m: number; n: number } {
  const perGroup = group * COLS
  const groupId = Math.floor(id / perGroup)
  const firstM = groupId * group
  const groupM = Math.min(ROWS - firstM, group)
  const inGroup = id % perGroup
  return { m: firstM + (inGroup % groupM), n: Math.floor(inGroup / groupM) }
}

const ORDER_ONE = IDS.map(id => mapWith(1, id))
const ORDER_EIGHT = IDS.map(id => mapWith(8, id))

/* ---------- 几何 ---------- */
const GRID_X = [42, 390]
const GRID_Y = 130
const CELL_W = 66
const CELL_H = 54
const GAP = 8
const cellX = (panel: number, n: number) => GRID_X[panel] + n * (CELL_W + GAP)
const cellY = (m: number) => GRID_Y + m * (CELL_H + GAP)

const PANELS = [
  { group: 1 as const, label: 'GROUP_M = 1', order: ORDER_ONE, x: 0 },
  { group: 8 as const, label: 'GROUP_M = 8', order: ORDER_EIGHT, x: 1 }
]

/** 每个 program 的点亮进度：step1（GROUP=1）/ step2（GROUP=8）按 id 逐个点亮 */
function litE(panel: number, id: number): number {
  if (props.step < 1) return 0
  if (props.step === 1) {
    if (panel !== 0) return 0
    return segE(props.local, 120 + id * 230, 340 + id * 230)
  }
  if (props.step === 2) {
    if (panel !== 1) return 0
    return segE(props.local, 120 + id * 230, 340 + id * 230)
  }
  return 0.45
}

/** 当前正在展示的 id（用于高亮 A 行 / B 列读取） */
const currentId = computed(() => {
  if (props.step !== 1 && props.step !== 2) return null
  const id = Math.min(Math.floor(Math.max(0, props.local - 120) / 230), TOTAL - 1)
  return { panel: props.step === 1 ? 0 : 1, id }
})

/** 当前读取的 A 行 / B 列 */
const currentRead = computed(() => {
  const cur = currentId.value
  if (!cur) return null
  const order = cur.panel === 0 ? ORDER_ONE : ORDER_EIGHT
  const { m, n } = order[cur.id]
  return { m, n }
})

const motiveE = computed(() => (props.step === 3 ? segE(props.local, 150, 600) : 0))
const perfE = computed(() => (props.step === 5 ? segE(props.local, 150, 500) : 0))

const captions = [
  '两版 kernel 的数学和 tile 完全相同，只改 program ID 到输出块的映射',
  'GROUP_M=1：编号按行走——(0,0) (0,1) (0,2) (0,3) (1,0)…，相邻 program 读不同的 B 列',
  'GROUP_M=8：同组行先围绕同一列 B——(0,0) (1,0) (2,0) (0,1)…，12 个 program 只需 1 组',
  '动机：相邻 program 在接近的时间访问同一片 B 列，这些数据可能仍在缓存中',
  '这只是编号安排，不强制 GPU 串行执行；收益是否成立要靠实验确认',
  '9070 XT 实测：triton-baseline 0.0987 ms → triton-grouped 0.0867 ms（3.095 TFLOP/s）'
]
</script>

<template>
  <g font-family="inherit">
    <g v-if="props.step !== 5">
    <!-- 顶部公式 -->
    <text x="360" y="26" text-anchor="middle" font-size="10.5" :font-family="MONO" fill="var(--ej-ink-soft)">
      program_m = first + in_group % group_m　·　program_n = in_group // group_m
    </text>

    <!-- 两个网格 -->
    <g v-for="panel in PANELS" :key="`panel-${panel.group}`">
      <text :x="GRID_X[panel.x] + (COLS * (CELL_W + GAP) - GAP) / 2" y="106" text-anchor="middle" font-size="12" font-weight="700" :fill="props.step === (panel.group === 1 ? 1 : 2) ? 'var(--ej-active)' : 'var(--ej-ink)'">{{ panel.label }}</text>
      <g v-for="(cell, id) in panel.order" :key="`pc-${panel.group}-${id}`">
        <rect
          :x="cellX(panel.x, cell.n)" :y="cellY(cell.m)" :width="CELL_W" :height="CELL_H" rx="9"
          :fill="litE(panel.x, id) > 0.02 ? (panel.group === 1 ? 'var(--ej-a-soft)' : 'var(--ej-b-soft)') : 'var(--ej-surface)'"
          :stroke="litE(panel.x, id) > 0.02 ? (panel.group === 1 ? 'var(--ej-a)' : 'var(--ej-b)') : 'var(--ej-line-strong)'"
          stroke-width="1.1"
          :opacity="0.35 + 0.65 * litE(panel.x, id)"
        />
        <text
          :x="cellX(panel.x, cell.n) + CELL_W / 2" :y="cellY(cell.m) + 20" text-anchor="middle" dominant-baseline="central"
          font-size="10" fill="var(--ej-ink-faint)"
        >块 ({{ cell.m }},{{ cell.n }})</text>
        <text
          :x="cellX(panel.x, cell.n) + CELL_W / 2" :y="cellY(cell.m) + 38" text-anchor="middle" dominant-baseline="central"
          font-size="13" :font-weight="litE(panel.x, id) > 0.9 ? 700 : 400"
          :fill="litE(panel.x, id) > 0.02 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'"
        >id {{ id }}</text>
      </g>
    </g>

    <!-- 当前行/列读取高亮：左侧行标 + 顶部列标 -->
    <g v-if="currentRead && props.step <= 3">
      <rect :x="GRID_X[currentId!.panel] - 6" :y="cellY(currentRead.m) - 3" :width="COLS * (CELL_W + GAP) - GAP + 12" :height="CELL_H + 6" rx="11" fill="none" stroke="var(--ej-a)" stroke-width="1.5" />
      <text :x="GRID_X[currentId!.panel] + 144" y="78" text-anchor="middle" font-size="10" font-weight="700" fill="var(--ej-a)">当前读取 A 行 {{ currentRead.m }} · B 列 {{ currentRead.n }}</text>
      <text :x="cellX(currentId!.panel, currentRead.n) + CELL_W / 2" :y="GRID_Y - 10" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--ej-b)">读 B 列 {{ currentRead.n }}</text>
    </g>

    <!-- 缓存动机（step 3） -->
    <g v-if="props.step === 3" :opacity="motiveE">
      <rect x="150" y="330" width="420" height="40" rx="9" fill="var(--ej-b-soft)" stroke="var(--ej-b)" stroke-width="1.2" />
      <text x="360" y="350" text-anchor="middle" dominant-baseline="central" font-size="11.5" font-weight="600" fill="var(--ej-ink)">
        同一组 program 围绕同一列 B 工作——数据可能仍在缓存中
      </text>
    </g>

    <!-- 底部说明 -->
    <text x="360" y="402" text-anchor="middle" font-size="11" fill="var(--ej-ink-soft)">{{ captions[Math.min(props.step, captions.length - 1)] }}</text>

    </g>

    <!-- 实测（step 5）：隐藏前一场景，避免转场时两套文字叠加。 -->
    <g v-if="props.step === 5" :opacity="perfE">
      <rect x="0" y="0" width="720" height="420" fill="var(--ej-surface)" />
      <text x="360" y="80" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="700" fill="var(--ej-ink)">
        编号安排的收益 · 9070 XT 实测（512³ FP32）
      </text>
      <g>
        <rect x="120" y="120" width="480" height="58" rx="10" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1.2" />
        <text x="142" y="142" font-size="12" :font-family="MONO" font-weight="600" fill="var(--ej-ink)">triton-baseline（GROUP_M=1）</text>
        <text x="142" y="160" font-size="10" fill="var(--ej-ink-soft)">2.720 TFLOP/s</text>
        <text x="576" y="149" text-anchor="end" dominant-baseline="central" font-size="16" font-weight="700" fill="var(--ej-ink-soft)">0.0987 ms</text>
      </g>
      <g>
        <rect x="120" y="196" width="480" height="58" rx="10" fill="var(--ej-active-soft)" stroke="var(--ej-active)" stroke-width="1.4" />
        <text x="142" y="218" font-size="12" :font-family="MONO" font-weight="600" fill="var(--ej-active)">triton-grouped（GROUP_M=8）</text>
        <text x="142" y="236" font-size="10" fill="var(--ej-ink-soft)">3.095 TFLOP/s · 同一 kernel，只改映射</text>
        <text x="576" y="225" text-anchor="end" dominant-baseline="central" font-size="16" font-weight="700" fill="var(--ej-active)">0.0867 ms</text>
      </g>
      <text x="360" y="292" text-anchor="middle" font-size="11" fill="var(--ej-ink-soft)">
        中心值与三进程范围一起看：grouped 的进程范围更宽，改善并非在所有进程上都稳定
      </text>
      <text x="360" y="316" text-anchor="middle" font-size="9.5" fill="var(--ej-ink-faint)">
        数据来自 2026-07-19 curated evidence（evidence/summary.csv）
      </text>
    </g>
  </g>
</template>
