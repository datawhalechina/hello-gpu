<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, lerp, seg, segE } from '../../../../components/animation/easing'

/**
 * 9.4.3 / 9.5 两阶段归约：grid-stride 局部累加 → 组内合并 → 交出 partial →
 * 第二阶段 kernel 跨组合并。四个步骤对应 9.5 层次表的固定用语
 * （先做局部工作 / 组内合并 / 每组交出结果 / 跨组合并）。
 * 教学缩略：2 个 block × 4 线程、16 个输入（本章手算数组重复两遍）、grid_stride=8；
 * 真实主 shape 为 N=16,777,216、第一阶段 grid 受 CU 数 × 8 限制。
 */
const props = defineProps<{ step: number; local: number }>()

const INPUT = [3, 1, 7, 0, 4, 1, 6, 2, 3, 1, 7, 0, 4, 1, 6, 2]
const N = INPUT.length
const BLOCKS = [0, 1]
const LANES = [0, 1, 2, 3]
const GRID_STRIDE = 8
const PARTIALS = [22, 26]
const FINAL = 48

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/* ---------- 几何 ---------- */
const BAND_X0 = 104
const CELL_W = 26
const CELL_GAP = 4
const BAND_Y = 56
const BAND_H = 34
const cellX = (index: number) => BAND_X0 + index * (CELL_W + CELL_GAP)

const BLOCK_Y = 132
const BLOCK_X = [56, 392]
const BLOCK_W = 272
const BLOCK_H = 170
const LANE_W = 56
const LANE_H = 40
const laneX = (block: number, lane: number) => BLOCK_X[block] + 20 + lane * (LANE_W + 6)
const laneY = BLOCK_Y + 46

const PARTIAL_Y = 342
const STAGE2_Y = 416

const firstIndex = (block: number, lane: number) => block * 4 + lane
const secondIndex = (block: number, lane: number) => firstIndex(block, lane) + GRID_STRIDE
const laneLocal = (block: number, lane: number) =>
  INPUT[firstIndex(block, lane)] + INPUT[secondIndex(block, lane)]

/** 输入带上某格的访问态：0 未访问 1 第一遍 2 第二遍 */
function bandState(index: number): number {
  const round = index < GRID_STRIDE ? 1 : 2
  if (props.step === 0 && round === 2) return 0
  if (props.step > 1 || (props.step === 1 && round === 1)) return round
  const lane = index % 4
  const start = (round === 1 ? 120 : 600) + lane * 45
  return seg(props.local, start, start + 280) > 0 ? round : 0
}

/** 两遍扫描分开呈现；第一步只读 first，第二步才读取 first + grid_stride。 */
function laneE(block: number, lane: number, phase: 'scan1' | 'scan2'): number {
  if (phase === 'scan1') {
    return props.step === 0 ? easeInOutCubic(seg(props.local, 120 + lane * 45, 400 + lane * 45)) : 1
  }
  if (props.step === 0) return 0
  return props.step === 1 ? easeInOutCubic(seg(props.local, 600 + lane * 45, 880 + lane * 45)) : 1
}

/** 组内合并（步骤 2）：树两轮，每 block 的 4 个 local → block 和 */
function treeE(round: 0 | 1): number {
  if (props.step < 2) return 0
  if (props.step === 2) {
    return easeInOutCubic(seg(props.local, round === 0 ? 120 : 560, round === 0 ? 420 : 860))
  }
  return 1
}

function blockSumE(block: number): number {
  if (props.step < 2) return 0
  if (props.step === 2) return easeInOutCubic(seg(props.local, 950, 1250))
  return 1
}

/** 交出 partial（步骤 3） */
function partialE(block: number): number {
  if (props.step < 3) return 0
  if (props.step === 3) return easeInOutCubic(seg(props.local, 150 + block * 260, 480 + block * 260))
  return 1
}

/** 第二阶段（步骤 4） */
const stage2E = computed(() =>
  props.step === 4 ? easeInOutCubic(seg(props.local, 150, 550)) : props.step > 4 ? 1 : 0
)
const stage2PairE = computed(() =>
  props.step === 4 ? easeInOutCubic(seg(props.local, 650, 1000)) : props.step > 4 ? 1 : 0
)

/** lane 卡上显示的 local 值（随两遍扫描累加） */
function laneDisplay(block: number, lane: number): number | null {
  const e1 = laneE(block, lane, 'scan1')
  const e2 = laneE(block, lane, 'scan2')
  if (props.step <= 1) {
    const first = INPUT[firstIndex(block, lane)]
    const second = INPUT[secondIndex(block, lane)]
    if (e1 <= 0.02) return null
    const v1 = lerp(0, first, e1)
    return Math.round((v1 + lerp(0, second, Math.max(0, e2))) * 100) / 100
  }
  return laneLocal(block, lane)
}

/* ---------- 实测收尾（步骤 5） ---------- */
const barsE = computed(() => (props.step === 5 ? segE(props.local, 150, 500) : 0))
const MEASURED = [
  { name: 'hip-atomic', ms: '34.46 ms', note: '全部线程竞争同一地址' },
  { name: 'hip-lds', ms: '4.33 ms', note: '每 block 提交一次原子加' },
  { name: 'hip-two-stage', ms: '0.059 ms', note: '局部累加 + shuffle + 两阶段' }
]
</script>

<template>
  <g font-family="inherit">
    <!-- ============ 输入带 ============ -->
    <text x="104" y="36" font-size="10.5" font-weight="600" fill="var(--ej-ink-soft)">输入 N = 16（教学缩略）</text>
    <g v-for="(value, index) in INPUT" :key="`cell-${index}`">
      <rect
        :x="cellX(index)"
        :y="BAND_Y"
        :width="CELL_W"
        :height="BAND_H"
        rx="5"
        :fill="bandState(index) === 0 ? 'var(--ej-surface)' : bandState(index) === 1 ? 'var(--ej-b-soft)' : 'var(--ej-a-soft)'"
        :stroke="bandState(index) === 0 ? 'var(--ej-line)' : bandState(index) === 1 ? 'var(--ej-b)' : 'var(--ej-a)'"
        stroke-width="1.1"
      />
      <text
        :x="cellX(index) + CELL_W / 2"
        :y="BAND_Y + BAND_H / 2 + 1"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="10.5"
        :fill="bandState(index) === 0 ? 'var(--ej-ink-faint)' : 'var(--ej-ink)'"
      >{{ value }}</text>
    </g>
    <text x="104" y="106" font-size="9.5" fill="var(--ej-ink-faint)">
      <tspan :font-family="MONO">first = blockIdx×4 + thread</tspan>　·　第二遍 +8（<tspan :font-family="MONO">grid_stride = 8</tspan>）
    </text>

    <!-- ============ 两个 block 卡 ============ -->
    <g v-for="block in BLOCKS" :key="`block-${block}`">
      <rect :x="BLOCK_X[block]" :y="BLOCK_Y" :width="BLOCK_W" :height="BLOCK_H" rx="11" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1" />
      <text :x="BLOCK_X[block] + 20" :y="BLOCK_Y + 24" font-size="11.5" font-weight="700" fill="var(--ej-ink)">block {{ block }}</text>
      <text :x="BLOCK_X[block] + BLOCK_W - 20" :y="BLOCK_Y + 24" text-anchor="end" font-size="9.5" fill="var(--ej-ink-faint)">4 线程 · 真实 block=256</text>
      <g v-for="lane in LANES" :key="`lane-${block}-${lane}`">
        <rect
          :x="laneX(block, lane)"
          :y="laneY"
          :width="LANE_W"
          :height="LANE_H"
          rx="7"
          fill="var(--ej-surface)"
          :stroke="laneE(block, lane, 'scan1') > 0.02 ? 'var(--ej-a)' : 'var(--ej-line-strong)'"
          stroke-width="1.2"
        />
        <text
          :x="laneX(block, lane) + LANE_W / 2"
          :y="laneY + 14"
          text-anchor="middle"
          font-size="8.5"
          fill="var(--ej-ink-faint)"
        >t{{ lane }}</text>
        <text
          :x="laneX(block, lane) + LANE_W / 2"
          :y="laneY + 29"
          text-anchor="middle"
          dominant-baseline="central"
          font-size="12"
          font-weight="600"
          :fill="laneE(block, lane, 'scan1') > 0.02 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'"
        >{{ laneDisplay(block, lane) ?? '·' }}</text>
      </g>
      <!-- 每轮留出独立纵向空间，边界连接到数值框而不是穿过框内文字。 -->
      <g v-for="pair in [0, 1]" :key="`pair-${block}-${pair}`" :opacity="treeE(0)">
        <line v-for="source in [pair, pair + 2]" :key="source"
          :x1="laneX(block, source) + LANE_W / 2" :y1="laneY + LANE_H"
          :x2="BLOCK_X[block] + 76 + pair * 120" y2="234"
          stroke="var(--ej-active)" stroke-width="1.2" />
        <rect :x="BLOCK_X[block] + 32 + pair * 120" y="234" width="88" height="24" rx="6"
          fill="var(--ej-surface)" stroke="var(--ej-active)" />
        <text :x="BLOCK_X[block] + 76 + pair * 120" y="246" text-anchor="middle" dominant-baseline="central"
          font-size="11" fill="var(--ej-ink)">{{ laneLocal(block, pair) + laneLocal(block, pair + 2) }}</text>
        <line :x1="BLOCK_X[block] + 76 + pair * 120" y1="258" :x2="BLOCK_X[block] + 136" y2="274"
          stroke="var(--ej-active)" stroke-width="1.2" :opacity="treeE(1)" />
      </g>
      <g :opacity="blockSumE(block)">
        <rect :x="BLOCK_X[block] + 86" y="274" width="100" height="24" rx="7"
          fill="var(--ej-active-soft)" stroke="var(--ej-active)" stroke-width="1.2" />
        <text :x="BLOCK_X[block] + 136" y="286" text-anchor="middle" dominant-baseline="central"
          font-size="11" font-weight="700" fill="var(--ej-active)">block 和 = {{ PARTIALS[block] }}</text>
      </g>
    </g>

    <!-- ============ partial 数组 + 阶段分界 ============ -->
    <text x="360" y="326" text-anchor="middle" font-size="10.5" font-weight="600" fill="var(--ej-ink-soft)">partials（第一阶段写、第二阶段读）</text>
    <g v-for="block in BLOCKS" :key="`partial-${block}`">
      <line :x1="BLOCK_X[block] + 136" y1="298" :x2="BLOCK_X[block] + 136" :y2="PARTIAL_Y"
        stroke="var(--ej-b)" stroke-width="1.2" :opacity="partialE(block)" />
      <rect
        :x="BLOCK_X[block] + 66" :y="PARTIAL_Y" width="140" height="30" rx="7"
        :fill="partialE(block) > 0 ? 'var(--ej-b-soft)' : 'var(--ej-surface)'"
        :stroke="partialE(block) > 0 ? 'var(--ej-b)' : 'var(--ej-line-strong)'"
        :stroke-dasharray="partialE(block) > 0 ? undefined : '4 3'"
        stroke-width="1.2"
        :opacity="0.35 + 0.65 * partialE(block)"
      />
      <text
        :x="BLOCK_X[block] + 136" :y="PARTIAL_Y + 15" text-anchor="middle" dominant-baseline="central"
        font-size="12" font-weight="700" :fill="partialE(block) > 0 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'"
      >{{ partialE(block) > 0.02 ? `partials[${block}] = ${PARTIALS[block]}` : '·' }}</text>
    </g>
    <line x1="40" y1="398" x2="680" y2="398" stroke="var(--ej-line-strong)" stroke-dasharray="6 5" :opacity="props.step >= 4 ? 0.9 : 0.35" />
    <text x="680" y="392" text-anchor="end" font-size="9" fill="var(--ej-ink-faint)">第一阶段结束 → 第二阶段 kernel</text>

    <!-- 第二阶段合并：加号位于两个输入框之间，连线汇入输出上沿。 -->
    <g :opacity="stage2E">
      <g v-for="(block, index) in BLOCKS" :key="`stage2-${block}`">
        <line :x1="BLOCK_X[block] + 136" :y1="PARTIAL_Y + 30" :x2="276 + index * 168" :y2="STAGE2_Y"
          stroke="var(--ej-b)" stroke-width="1.2" />
        <rect :x="216 + index * 168" :y="STAGE2_Y" width="120" height="34" rx="8"
          fill="var(--ej-surface)" stroke="var(--ej-line-strong)" stroke-width="1.2" />
        <text :x="276 + index * 168" :y="STAGE2_Y + 17" text-anchor="middle" dominant-baseline="central"
          font-size="12" fill="var(--ej-ink)">{{ PARTIALS[block] }}</text>
        <line :x1="276 + index * 168" :y1="STAGE2_Y + 34" x2="360" y2="476"
          stroke="var(--ej-c)" stroke-width="1.3" :opacity="stage2PairE" />
      </g>
      <text x="360" :y="STAGE2_Y + 17" text-anchor="middle" dominant-baseline="central" font-size="16" fill="var(--ej-ink-soft)">+</text>
      <g :opacity="stage2PairE">
        <rect x="287" y="476" width="146" height="34" rx="9" fill="var(--ej-c-soft)" stroke="var(--ej-c)" stroke-width="1.4" />
        <text x="360" y="493" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="700" fill="var(--ej-c)">output = {{ FINAL }}</text>
      </g>
    </g>

    <!-- ============ 实测收尾（步骤 6） ============ -->
    <g v-if="props.step === 5">
      <rect x="0" y="0" width="720" height="540" rx="0" fill="var(--ej-bg)" />
      <g :opacity="barsE">
      <text x="360" y="66" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="700" fill="var(--ej-ink)">
        9070 XT 实测 · N = 16,777,216（主 shape）
      </text>
      <g v-for="(row, index) in MEASURED" :key="`m-${row.name}`">
        <rect
          :x="130" :y="120 + index * 74" width="460" height="56" rx="10"
          :fill="index === 2 ? 'var(--ej-active-soft)' : 'var(--ej-panel)'"
          :stroke="index === 2 ? 'var(--ej-active)' : 'var(--ej-line)'"
          stroke-width="1.2"
        />
        <text :x="152" :y="142 + index * 74" font-size="12" :font-family="MONO" font-weight="600" :fill="index === 2 ? 'var(--ej-active)' : 'var(--ej-ink)'">{{ row.name }}</text>
        <text :x="152" :y="160 + index * 74" font-size="10" fill="var(--ej-ink-soft)">{{ row.note }}</text>
        <text :x="566" :y="148 + index * 74" text-anchor="end" dominant-baseline="central" font-size="16" font-weight="700" :fill="index === 2 ? 'var(--ej-active)' : 'var(--ej-ink-soft)'">{{ row.ms }}</text>
      </g>
      <text x="360" y="368" text-anchor="middle" font-size="10.5" fill="var(--ej-ink-soft)">
        hip-two-stage 逻辑有效带宽 1135.9 GB/s（口径与三进程范围见 9.5 与 evidence/summary.csv）
      </text>
      <text x="360" y="388" text-anchor="middle" font-size="9.5" fill="var(--ej-ink-faint)">
        数据 2026-07-19 curated evidence · 数字为实测，动画中的小数组演示与该规模无关
      </text>
      </g>
    </g>
  </g>
</template>
