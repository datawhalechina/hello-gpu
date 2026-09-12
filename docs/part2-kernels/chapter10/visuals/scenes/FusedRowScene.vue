<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, lerp, seg, segE } from '../../../../components/animation/easing'

/**
 * 10.5.2 hip-fused-block-lds：一个 block 合作处理一行的时间线。
 * 跨步局部 max → LDS max 树 → 读者屏障（复用 LDS 前所有线程读完最大值，
 * 2026-09-11 修复点）→ 复用 LDS 求 sum → 重算指数写回。
 * 教学缩略：block=4 线程处理 3 列，第 4 线程无有效列，演示单位元（-∞ / 0）；
 * 行数据沿用正文手算 [1000, 1001, 1002]。
 */
const props = defineProps<{ step: number; local: number }>()

const ROW = [1000, 1001, 1002]
const LANES = [0, 1, 2, 3]
const MAXIMUM = 1002
const DENOM = 1.5032
const P = [0.1353, 0.3679, 1]
const OUT = ['0.0900', '0.2447', '0.6652']

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/* ---------- 几何 ---------- */
const ROW_X0 = 87
const ROW_W = 70
const ROW_GAP = 6
const ROW_Y = 44
const ROW_H = 38
const rowX = (column: number) => ROW_X0 + column * 156

const LANE_W = 132
const LANE_H = 50
const LANE_X = [56, 212, 368, 524]
const LANE_Y = 116

const LDS_X0 = 226
const LDS_W = 60
const LDS_GAP = 10
const LDS_Y = 214
const LDS_H = 42
const ldsX = (slot: number) => LDS_X0 + slot * (LDS_W + LDS_GAP)

const OUT_Y = 318
const OUT_W = 96
const outX = (column: number) => 172 + column * (OUT_W + 14)

/** lane 局部 max：lane0-2 读列，lane3 无列 → -∞ */
const LANE_LOCAL_MAX = [1000, 1001, 1002, -Infinity]

/** max 树两轮后 LDS 的值序列（含进度插值） */
const TREE1 = [
  { slots: [1002, 1001, 1002, -Infinity], label: 'stride=2' },
  { slots: [1002, 1001, 1002, -Infinity], label: '' }
]
const TREE_FINAL = [1002, 1001, 1002, -Infinity]
const SUM_SLOTS = [0.1353, 0.3679, 1, 0]

function scanE(lane: number): number {
  if (props.step === 0) return easeInOutCubic(seg(props.local, 120 + lane * 60, 400 + lane * 60))
  return 1
}

/** LDS 槽显示值：按步骤与进度计算 */
function ldsSlot(slot: number): { value: string; e: number; kind: 'init' | 'max' | 'sum' } {
  if (props.step === 0) return { value: '·', e: 0, kind: 'init' }
  if (props.step === 1) {
    // 写入局部 max
    const e = easeInOutCubic(seg(props.local, 100 + slot * 60, 340 + slot * 60))
    const v = LANE_LOCAL_MAX[slot]
    return { value: e > 0.02 ? (v === -Infinity ? '−∞' : String(v)) : '·', e, kind: 'max' }
  }
  if (props.step === 2) {
    // 树归约 stride=2 → stride=1
    const p2 = easeInOutCubic(seg(props.local, 100, 450))
    const p1 = easeInOutCubic(seg(props.local, 560, 910))
    if (slot === 0) {
      const mid = p2 > 0 ? lerp(1000, 1002, p2) : 1000
      const v = p1 > 0 ? lerp(mid, 1002, p1) : mid
      return { value: String(Math.round(v)), e: 1, kind: 'max' }
    }
    if (slot === 1) {
      // stride=1 只更新 shared[0]；shared[1] 保持 1001
      return { value: '1001', e: p2, kind: 'max' }
    }
    return { value: slot === 2 ? '1002' : '−∞', e: p2, kind: 'max' }
  }
  if (props.step === 3) return { value: slot === 0 ? '1002' : '·', e: 1, kind: 'max' }
  if (props.step === 4) {
    // 复用 LDS 求 sum：写入 p 值，树两轮 → shared[0] = 1.5032
    const writeE = easeInOutCubic(seg(props.local, 80 + slot * 55, 300 + slot * 55))
    const p2 = easeInOutCubic(seg(props.local, 480, 780))
    const p1 = easeInOutCubic(seg(props.local, 880, 1180))
    if (slot === 0) {
      const mid = p2 > 0 ? lerp(0.1353, 1.1353, p2) : 0.1353
      const v = p1 > 0 ? lerp(mid, DENOM, p1) : mid
      return { value: v.toFixed(4), e: 1, kind: 'sum' }
    }
    if (slot === 1) {
      // stride=1 只更新 shared[0]；shared[1] 保持 0.3679
      const v = p2 > 0 ? 0.3679 : lerp(0, 0.3679, writeE)
      return { value: v.toFixed(4), e: 1, kind: 'sum' }
    }
    const base = SUM_SLOTS[slot]
    return { value: writeE > 0.02 ? base.toFixed(4) : '·', e: writeE, kind: 'sum' }
  }
  if (props.step === 5) return { value: slot === 0 ? DENOM.toFixed(4) : '已释放', e: 1, kind: 'sum' }
  return { value: '·', e: 0, kind: 'init' }
}

/** 树归约弧线：step2（max）与 step4（sum）各两轮 */
const arcs = computed(() => {
  if (props.step !== 2 && props.step !== 4) return []
  const start1 = props.step === 2 ? 100 : 480
  const start2 = props.step === 2 ? 560 : 880
  const list: { x1: number; x2: number; p: number }[] = []
  const p2a = easeInOutCubic(seg(props.local, start1, start1 + 350))
  const p2b = easeInOutCubic(seg(props.local, start1, start1 + 350))
  if (p2a > 0) {
    list.push({ x1: ldsX(2) + LDS_W / 2, x2: ldsX(0) + LDS_W / 2, p: p2a })
    list.push({ x1: ldsX(3) + LDS_W / 2, x2: ldsX(1) + LDS_W / 2, p: p2b })
  }
  const p1 = easeInOutCubic(seg(props.local, start2, start2 + 350))
  if (p1 > 0) list.push({ x1: ldsX(1) + LDS_W / 2, x2: ldsX(0) + LDS_W / 2, p: p1 })
  return list
})

const barrierE = computed(() => (props.step === 3 ? segE(props.local, 120, 480) : 0))

const outE = computed(() =>
  props.step === 5 ? OUT.map((_, column) => easeInOutCubic(seg(props.local, 150 + column * 140, 420 + column * 140))) : OUT.map(() => 0)
)

const captions = [
  'lane c 负责第 c 列；第 4 个线程没有有效列，局部 max 停留在初值 −∞',
  '先把 4 个局部 max 写入 LDS，再用屏障保证每个槽都已写好',
  'stride=2 → 1：先合并前后半区，再把两个部分最大值合成 1002',
  '读者屏障：所有线程都读完 shared[0] 之后，LDS 才能被 sum 复用',
  '把 LDS 改作 sum 空间：p 值写入后树归约两轮，分母 1.5032',
  '最后一遍输入：重算 exp 并归一化写回，随后看 9070 XT 实测'
]
</script>

<template>
  <g font-family="inherit">
    <!-- ============ 输入行 ============ -->
    <text x="56" y="26" font-size="10.5" font-weight="600" fill="var(--ej-ink-soft)">同一行 3 列（正文手算数据）· block=4 线程教学缩略</text>
    <g v-for="(value, column) in ROW" :key="`in-${column}`">
      <rect :x="rowX(column)" :y="ROW_Y" :width="ROW_W" :height="ROW_H" rx="7" fill="var(--ej-a-soft)" stroke="var(--ej-a)" stroke-width="1.1" />
      <text :x="rowX(column) + ROW_W / 2" :y="ROW_Y + ROW_H / 2 + 1" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" fill="var(--ej-ink)">{{ value }}</text>
    </g>
    <rect :x="rowX(3)" :y="ROW_Y" :width="ROW_W" :height="ROW_H" rx="7" fill="var(--ej-bad-soft)" stroke="var(--ej-bad)" stroke-dasharray="4 3" stroke-width="1" />
    <text :x="rowX(3) + ROW_W / 2" :y="ROW_Y + ROW_H / 2 + 1" text-anchor="middle" dominant-baseline="central" font-size="10.5" fill="var(--ej-ink-faint)">无列</text>

    <!-- ============ lane 卡（局部 max） ============ -->
    <g v-for="lane in LANES" :key="`lane-${lane}`">
      <rect :x="LANE_X[lane]" :y="LANE_Y" :width="LANE_W" :height="LANE_H" rx="8" fill="var(--ej-surface)" :stroke="scanE(lane) > 0.02 ? 'var(--ej-a)' : 'var(--ej-line-strong)'" stroke-width="1.2" />
      <text :x="LANE_X[lane] + 10" :y="LANE_Y + 15" font-size="9" fill="var(--ej-ink-faint)">t{{ lane }}</text>
      <text :x="LANE_X[lane] + LANE_W - 10" :y="LANE_Y + 15" text-anchor="end" font-size="8.5" :font-family="MONO" fill="var(--ej-ink-faint)">local max</text>
      <text :x="LANE_X[lane] + LANE_W / 2" :y="LANE_Y + 37" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" :fill="scanE(lane) > 0.02 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'">
        {{ scanE(lane) > 0.02 ? (LANE_LOCAL_MAX[lane] === -Infinity ? '−∞' : LANE_LOCAL_MAX[lane]) : '·' }}
      </text>
      <line
        v-if="lane < 3 && scanE(lane) > 0.3"
        :x1="rowX(lane) + ROW_W / 2" :y1="ROW_Y + ROW_H" :x2="LANE_X[lane] + LANE_W / 2" :y2="LANE_Y"
        stroke="var(--ej-a)" stroke-width="1" stroke-dasharray="3 2" opacity="0.5"
      />
    </g>

    <!-- ============ LDS 带 ============ -->
    <text x="80" y="240" font-size="11" font-weight="700" fill="var(--ej-ink-soft)">LDS</text>
    <text x="80" y="255" font-size="8.5" fill="var(--ej-ink-faint)">shared[0..3]</text>
    <g v-for="slot in [0, 1, 2, 3]" :key="`lds-${slot}`">
      <rect
        :x="ldsX(slot)" :y="LDS_Y" :width="LDS_W" :height="LDS_H" rx="7"
        :fill="ldsSlot(slot).kind === 'sum' && ldsSlot(slot).e > 0 ? 'var(--ej-b-soft)' : ldsSlot(slot).e > 0 ? 'var(--ej-active-soft)' : 'var(--ej-surface)'"
        :stroke="ldsSlot(slot).e > 0 ? (ldsSlot(slot).kind === 'sum' ? 'var(--ej-b)' : 'var(--ej-active)') : 'var(--ej-line)'"
        stroke-width="1.2"
      />
      <text
        :x="ldsX(slot) + LDS_W / 2" :y="LDS_Y + LDS_H / 2 + 1" text-anchor="middle" dominant-baseline="central"
        font-size="12" font-weight="600"
        :fill="ldsSlot(slot).e > 0.02 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'"
      >{{ ldsSlot(slot).value }}</text>
    </g>

    <!-- 树归约弧线 -->
    <g v-for="(arc, index) in arcs" :key="`arc-${index}`">
      <path
        :d="`M ${arc.x2} ${LDS_Y - 6} Q ${(arc.x1 + arc.x2) / 2} ${LDS_Y - 44} ${arc.x1} ${LDS_Y - 6}`"
        fill="none" stroke="var(--ej-active)" stroke-width="1.5"
        :opacity="arc.p >= 1 ? 0.35 : 0.85"
        :stroke-dasharray="arc.p >= 1 ? '3 3' : undefined"
      />
      <circle
        :cx="lerp(arc.x1, arc.x2, arc.p)"
        :cy="LDS_Y - 6 - 76 * arc.p * (1 - arc.p)"
        r="4" fill="var(--ej-active)" :opacity="arc.p >= 1 ? 0 : 1"
      />
    </g>

    <!-- ============ 读者屏障 ============ -->
    <g :opacity="0.25 + 0.75 * barrierE">
      <line x1="40" y1="282" x2="680" y2="282" :stroke="barrierE > 0.5 ? 'var(--ej-c)' : 'var(--ej-line-strong)'" :stroke-width="barrierE > 0.5 ? 2 : 1" :stroke-dasharray="barrierE > 0.5 ? undefined : '5 4'" />
      <text x="360" y="297" text-anchor="middle" font-size="10" :font-weight="barrierE > 0.5 ? 700 : 400" :fill="barrierE > 0.5 ? 'var(--ej-c)' : 'var(--ej-ink-faint)'">
        __syncthreads()：所有线程读完 maximum，LDS 才能改作 sum 空间
      </text>
    </g>

    <!-- ============ 输出行 ============ -->
    <g v-for="(value, column) in OUT" :key="`out-${column}`" :opacity="outE[column]">
      <rect :x="outX(column)" :y="OUT_Y" :width="OUT_W" :height="34" rx="7" fill="var(--ej-c-soft)" stroke="var(--ej-c)" stroke-width="1.2" />
      <text :x="outX(column) + OUT_W / 2" :y="OUT_Y + 17" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="600" fill="var(--ej-ink)">{{ value }}</text>
    </g>
    <text x="60" :y="OUT_Y + 17" font-size="10.5" fill="var(--ej-ink-faint)">y = p / 1.5032</text>

    <text x="360" y="378" text-anchor="middle" font-size="11" fill="var(--ej-ink-soft)">{{ captions[Math.min(props.step, captions.length - 1)] }}</text>

    <!-- ============ 实测收尾（步骤 7） ============ -->
    <g v-if="props.step === 6">
      <rect x="0" y="0" width="720" height="400" fill="var(--ej-bg)" />
      <g :opacity="segE(props.local, 150, 500)">
      <text x="360" y="62" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="700" fill="var(--ej-ink)">
        融合收益 · 9070 XT 实测（4096 × 1024 FP32）
      </text>
      <g>
        <rect x="120" y="100" width="480" height="58" rx="10" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1.2" />
        <text x="142" y="122" font-size="12" :font-family="MONO" font-weight="600" fill="var(--ej-ink)">hip-baseline-3kernel</text>
        <text x="142" y="140" font-size="10" fill="var(--ej-ink-soft)">3 次 dispatch · 全局 row_max / exp_tmp / row_sum 往返</text>
        <text x="576" y="129" text-anchor="end" dominant-baseline="central" font-size="16" font-weight="700" fill="var(--ej-ink-soft)">0.744 ms</text>
      </g>
      <g>
        <rect x="120" y="176" width="480" height="58" rx="10" fill="var(--ej-active-soft)" stroke="var(--ej-active)" stroke-width="1.4" />
        <text x="142" y="198" font-size="12" :font-family="MONO" font-weight="600" fill="var(--ej-active)">hip-fused-block-lds</text>
        <text x="142" y="216" font-size="10" fill="var(--ej-ink-soft)">1 次 dispatch · LDS 复用 · 免去 exp_tmp（16 MiB）</text>
        <text x="576" y="205" text-anchor="end" dominant-baseline="central" font-size="16" font-weight="700" fill="var(--ej-active)">0.116 ms</text>
      </g>
      <text x="360" y="266" text-anchor="middle" font-size="11.5" fill="var(--ej-ink-soft)">
        约为 baseline 的六分之一；代价是源码扫描输入三次并重算指数
      </text>
      <text x="360" y="292" text-anchor="middle" font-size="10" fill="var(--ej-ink-faint)">
        数据来自 2026-07-19 curated evidence（evidence/summary.csv）· 数字为实测，上方动画为 3 列教学缩略
      </text>
      </g>
    </g>
  </g>
</template>
