<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, lerp, seg, segE } from '../easing'

/**
 * 8.4.3 合并访存受控对照（8-lane 教学缩略）：
 * 双面板同轮对比——lane 的地址飞落进 32B 教学分桶，连续每轮 1 组、跨步每轮 4 组；
 * 只展示地址分组；独立测量结果由紧邻正文的性能图呈现。
 */
const props = defineProps<{ step: number; local: number }>()

const LANES = Array.from({ length: 8 }, (_, index) => index)
const CELLS = Array.from({ length: 32 }, (_, index) => index)

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/* ---------- 几何常量 ---------- */
const PANEL_Y = 30
const PANEL_H = 216
const P_W = 336
const LANE_W = 34
const LANE_H = 28
const LANE_GAP = 3.5
const LANE_X0 = (P_W - (8 * LANE_W + 7 * LANE_GAP)) / 2
const LANE_Y = 52
const CELL_W = 9
const CELL_GAP = 0.6
const BAND_H = 36
const BAND_X0 = (P_W - (32 * CELL_W + 31 * CELL_GAP)) / 2
const BAND_Y = 122

const PANELS = [
  {
    key: 'c' as const,
    x: 16,
    color: 'var(--ej-a)',
    soft: 'var(--ej-a-soft)',
    kind: '合并',
    title: '连续顺序'
  },
  {
    key: 's' as const,
    x: 368,
    color: 'var(--ej-b)',
    soft: 'var(--ej-b-soft)',
    kind: '分散',
    title: '跨步顺序'
  }
]

const laneX = (lane: number) => LANE_X0 + lane * (LANE_W + LANE_GAP)
const laneCx = (lane: number) => laneX(lane) + LANE_W / 2
const cellX = (addr: number) => BAND_X0 + addr * (CELL_W + CELL_GAP)
const cellCx = (addr: number) => cellX(addr) + CELL_W / 2
const bucketX = (g: number) => cellX(g * 8) - 3
const BUCKET_W = 8 * (CELL_W + CELL_GAP) - CELL_GAP + 6
const bucketCx = (g: number) => bucketX(g) + BUCKET_W / 2
const bucketOf = (addr: number) => Math.floor(addr / 8)

/* ---------- 地址映射：唯一变量是 lane → 下标的排列 ---------- */
const addrOf = (kind: 'c' | 's', round: number, lane: number) =>
  kind === 'c' ? round * 8 + lane : lane * 4 + round

function laneForAddr(kind: 'c' | 's', round: number, addr: number): number {
  if (kind === 'c') {
    const lane = addr - round * 8
    return lane >= 0 && lane < 8 ? lane : -1
  }
  const diff = addr - round
  return diff >= 0 && diff % 4 === 0 && diff / 4 < 8 ? diff / 4 : -1
}

function groupsThisRound(kind: 'c' | 's', round: number): number {
  const buckets = new Set<number>()
  for (const lane of LANES) buckets.add(bucketOf(addrOf(kind, round, lane)))
  return buckets.size
}

function cumGroups(kind: 'c' | 's', uptoRound: number): number {
  const buckets = new Set<string>()
  for (let round = 0; round <= uptoRound; round++) {
    for (const lane of LANES) buckets.add(`${kind}-${round}-${bucketOf(addrOf(kind, round, lane))}`)
  }
  return buckets.size
}

/* ---------- 时间轴：round 是当前步的函数 ---------- */
function activeRound(): number {
  return props.step >= 1 && props.step <= 4 ? props.step - 1 : -1
}

function roundActive(round: number): boolean {
  if (props.step >= 1 && props.step <= 4) return round === props.step - 1
  return props.step === 5
}

function flightStart(round: number, lane: number): number {
  return props.step === 5 ? 250 + round * 700 + lane * 30 : 120 + lane * 45
}

function arriveP(round: number, lane: number): number {
  return easeInOutCubic(seg(props.local, flightStart(round, lane), flightStart(round, lane) + 400))
}

/* ---------- 各元素的逐帧状态 ---------- */

function panelIndex(key: 'c' | 's'): number {
  return key === 'c' ? 0 : 1
}

function panelOpacity(key: 'c' | 's'): number {
  if (props.step === 0) return segE(props.local, panelIndex(key) * 250, 420 + panelIndex(key) * 250)
  return 1
}

/** lane 芯片内显示的当前下标 */
function laneAddrE(round: number, lane: number): number {
  if (round < 0 || props.step >= 5) return 0
  return seg(props.local, 100 + lane * 45, 260 + lane * 45)
}

function cellE(kind: 'c' | 's', addr: number): number {
  let e = 0
  for (let round = 0; round < 4; round++) {
    if (!roundActive(round)) continue
    const lane = laneForAddr(kind, round, addr)
    if (lane < 0) continue
    const p = arriveP(round, lane)
    e = Math.max(e, p <= 0 ? 0 : lerp(0.4, 0.92, p))
  }
  if (props.step >= 2 && props.step <= 4) {
    for (let round = 0; round < props.step - 1; round++) {
      if (laneForAddr(kind, round, addr) >= 0) e = Math.max(e, 0.4)
    }
  }
  return e
}

function bucketTouched(kind: 'c' | 's', g: number, round: number): boolean {
  return LANES.some(lane => bucketOf(addrOf(kind, round, lane)) === g)
}

function bucketE(kind: 'c' | 's', g: number): number {
  if (props.step >= 1 && props.step <= 4) {
    const round = props.step - 1
    if (!bucketTouched(kind, g, round)) return 0
    let arrived = 0
    let total = 0
    for (const lane of LANES) {
      if (bucketOf(addrOf(kind, round, lane)) !== g) continue
      total++
      if (arriveP(round, lane) > 0.85) arrived++
    }
    return total ? arrived / total : 0
  }
  if (props.step === 5) {
    let best = 0
    for (let round = 0; round < 4; round++) {
      if (!bucketTouched(kind, g, round)) continue
      best = Math.max(best, seg(props.local, 250 + round * 700, 650 + round * 700))
    }
    return best
  }
  return 0
}

/** 分桶角标 ×n：本步结束时该桶被访问过的次数 */
function bucketVisits(kind: 'c' | 's', g: number): number {
  if (props.step < 1 || props.step > 5) return 0
  const upto = props.step <= 4 ? props.step - 1 : 3
  let visits = 0
  for (let round = 0; round <= upto; round++) {
    if (bucketTouched(kind, g, round)) visits++
  }
  return visits
}

function counterText(kind: 'c' | 's'): string {
  if (props.step === 0) return '等待第 1 轮…'
  if (props.step <= 4) {
    const round = props.step - 1
    return `本轮 ${groupsThisRound(kind, round)} 组 · 累计 ${cumGroups(kind, round)} 组次`
  }
  return `4 轮累计 ${cumGroups(kind, 3)} 组次`
}

function formulaText(key: 'c' | 's'): string {
  const round = activeRound()
  if (props.step === 5) return key === 'c' ? 'round = 0 … 3' : 'round = 0 … 3'
  if (round < 0) return key === 'c' ? 'index = round × 8 + lane' : 'index = lane × 4 + round'
  return key === 'c' ? `index = ${round} × 8 + lane` : `index = lane × 4 + ${round}`
}

/** 飞行中的地址 token */
const tokens = computed(() => {
  const out: { key: string; kind: 'c' | 's'; x: number; y: number; o: number }[] = []
  if (props.step < 1 || props.step > 5) return out
  const rounds = props.step <= 4 ? [props.step - 1] : [0, 1, 2, 3]
  for (const kind of ['c', 's'] as const) {
    for (const round of rounds) {
      for (const lane of LANES) {
        const p = arriveP(round, lane)
        const start = flightStart(round, lane)
        const o =
          seg(props.local, start - 40, start + 90) *
          (1 - seg(props.local, start + 330, start + 420))
        if (o <= 0.02 || p <= 0) continue
        out.push({
          key: `${kind}-${round}-${lane}`,
          kind,
          x: lerp(laneCx(lane), cellCx(addrOf(kind, round, lane)), p),
          y: lerp(LANE_Y + LANE_H + 4, BAND_Y + BAND_H / 2, p),
          o
        })
      }
    }
  }
  return out
})

</script>

<template>
  <g>
    <text x="708" y="16" text-anchor="end" dominant-baseline="central" font-size="9.5" fill="var(--ej-ink-faint)">
      32B 为教学分桶 · 非硬件事务计数
    </text>

    <!-- ============ 双面板 ============ -->
    <g
      v-for="panel in PANELS"
      :key="`panel-${panel.key}`"
      :transform="`translate(${panel.x}, ${PANEL_Y})`"
      :opacity="panelOpacity(panel.key)"
    >
      <rect :width="P_W" :height="PANEL_H" rx="12" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1" />
      <rect x="16" y="12" width="92" height="20" rx="10" :fill="panel.soft" :stroke="panel.color" stroke-width="1" />
      <text x="62" y="22" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" :fill="panel.color">{{ panel.kind }} · {{ panel.title }}</text>
      <text x="324" y="22" text-anchor="end" dominant-baseline="central" :font-size="10" :font-family="MONO" fill="var(--ej-ink-soft)">{{ formulaText(panel.key) }}</text>

      <!-- 8 个 lane -->
      <g v-for="lane in LANES" :key="`lane-${lane}`">
        <rect :x="laneX(lane)" :y="LANE_Y" :width="LANE_W" :height="LANE_H" rx="7" fill="var(--ej-surface)" stroke="var(--ej-line-strong)" stroke-width="1" />
        <text :x="laneCx(lane)" :y="LANE_Y + 10" text-anchor="middle" font-size="9.5" fill="var(--ej-ink-faint)">L{{ lane }}</text>
        <text
          :x="laneCx(lane)"
          :y="LANE_Y + 22"
          text-anchor="middle"
          dominant-baseline="central"
          :font-size="10"
          :font-family="MONO"
          font-weight="600"
          :fill="panel.color"
          :opacity="laneAddrE(activeRound(), lane)"
        >{{ activeRound() >= 0 ? addrOf(panel.key, activeRound(), lane) : '' }}</text>
      </g>

      <!-- 32 格地址带 + 分桶框 -->
      <g v-for="addr in CELLS" :key="`cell-${addr}`">
        <rect :x="cellX(addr)" :y="BAND_Y" :width="CELL_W" :height="BAND_H" rx="2" fill="var(--ej-surface)" stroke="var(--ej-line)" stroke-width="0.8" />
        <rect
          :x="cellX(addr)"
          :y="BAND_Y"
          :width="CELL_W"
          :height="BAND_H"
          rx="2"
          :fill="panel.soft"
          :stroke="panel.color"
          stroke-width="1.1"
          :opacity="cellE(panel.key, addr)"
        />
      </g>
      <g v-for="g in 4" :key="`bucket-${g}`">
        <rect
          :x="bucketX(g - 1)"
          :y="BAND_Y - 4"
          :width="BUCKET_W"
          :height="BAND_H + 8"
          rx="5"
          fill="none"
          :stroke="panel.color"
          stroke-width="1.5"
          :opacity="bucketE(panel.key, g - 1)"
        />
        <text
          :x="bucketCx(g - 1)"
          :y="BAND_Y - 12"
          text-anchor="middle"
          dominant-baseline="central"
          font-size="9.5"
          font-weight="700"
          :fill="panel.color"
          :opacity="bucketVisits(panel.key, g - 1) > 0 ? 0.85 : 0"
        >×{{ bucketVisits(panel.key, g - 1) }}</text>
        <text
          :x="bucketCx(g - 1)"
          :y="BAND_Y + 56"
          text-anchor="middle"
          dominant-baseline="central"
          font-size="9.5"
          fill="var(--ej-ink-faint)"
        >G{{ g - 1 }}</text>
      </g>

      <text x="168" y="196" text-anchor="middle" dominant-baseline="central" font-size="11.5" font-weight="600" :fill="panel.color">{{ counterText(panel.key) }}</text>
    </g>

    <!-- 飞行中的地址 token -->
    <g v-for="token in tokens" :key="token.key" :opacity="token.o">
      <circle
        :cx="PANELS.find(p => p.key === token.kind)!.x + token.x"
        :cy="PANEL_Y + token.y"
        r="4.5"
        :fill="token.kind === 'c' ? 'var(--ej-a)' : 'var(--ej-b)'"
      />
    </g>

    <text x="360" y="273" text-anchor="middle" font-size="10" fill="var(--ej-ink-faint)">
      两边最终覆盖相同的 32 个元素；真实时间由下一张实测图比较。
    </text>
  </g>
</template>
