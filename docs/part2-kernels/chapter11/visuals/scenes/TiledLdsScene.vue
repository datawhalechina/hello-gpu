<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, lerp, seg, segE } from '../../../../components/animation/easing'

/**
 * 11.3.2 matmul_tiled：一个 block 沿 K 循环推进的真实时间线。
 * 每轮 = 协作装载 tile_a/tile_b（越界填 0）→ __syncthreads()① →
 * 各线程从 LDS 读数累加自己的 accumulator → __syncthreads()② → 下一对 tile 覆盖 LDS。
 * 教学缩略：block = 2×2 线程、kTile=2、K=5（第三轮即尾块，1 列有效 1 列填 0）；
 * A(2×5) × B(5×2)，可手算：C = [[8,10],[11,12]]。
 */
const props = defineProps<{ step: number; local: number }>()

const K = 5
const TILE = 2
const TILE_COUNT = Math.ceil(K / TILE)

const A = [
  [1, 2, 1, 2, 1],
  [3, 1, 2, 1, 2]
]
const B = [
  [1, 1],
  [1, 2],
  [2, 1],
  [1, 1],
  [1, 2]
]
/** acc 累加轨迹：完成 tile 0/1/2 后的值（层 0 = 初始 0） */
const ACC_TRAJECTORY = [
  [[0, 0], [0, 0]],
  [[3, 5], [4, 5]],
  [[7, 8], [9, 8]],
  [[8, 10], [11, 12]]
]

const THREADS = [
  { ty: 0, tx: 0 },
  { ty: 0, tx: 1 },
  { ty: 1, tx: 0 },
  { ty: 1, tx: 1 }
]

/* ---------- 当前轮次：step 0 是总览，step 1/2 = tile0 的装载/累加，step3 = tile1 压缩，step4 = tile2 尾块，step5 = 写回 ---------- */
interface Round { tile: number; phase: 'load' | 'acc'; showBarrier1: boolean; showBarrier2: boolean; compressed: boolean }

function currentRound(): Round {
  if (props.step === 1) return { tile: 0, phase: 'load', showBarrier1: true, showBarrier2: false, compressed: false }
  if (props.step === 2) return { tile: 0, phase: 'acc', showBarrier1: true, showBarrier2: true, compressed: false }
  if (props.step === 3) return { tile: 1, phase: 'acc', showBarrier1: true, showBarrier2: true, compressed: true }
  if (props.step === 4) return { tile: 2, phase: 'acc', showBarrier1: true, showBarrier2: true, compressed: false }
  return { tile: props.step === 0 ? 0 : TILE_COUNT - 1, phase: 'acc', showBarrier1: false, showBarrier2: false, compressed: false }
}

const round = computed(() => currentRound())

/** tile 内 (ty, tx) 格的值：A 窗口 / B 窗口（越界 → null 表示填 0） */
function tileCell(which: 'a' | 'b', ty: number, tx: number, tile: number): number | null {
  if (which === 'a') {
    const col = tile * TILE + tx
    return col < K ? A[ty][col] : null
  }
  const row = tile * TILE + ty
  return row < K ? B[row][tx] : null
}

/* ---------- 几何 ---------- */
const WIN_A_X = 56
const WIN_B_X = 196
const WIN_Y = 66
const WIN_CELL = 34
const winX = (which: string, tx: number) => (which === 'a' ? WIN_A_X : WIN_B_X) + tx * (WIN_CELL + 6)
const winY = (ty: number) => WIN_Y + ty * (WIN_CELL + 6)

const LDS_A_X = 56
const LDS_B_X = 196
const LDS_Y = 196
const LDS_CELL = 40
const ldsX = (which: string, tx: number) => (which === 'a' ? LDS_A_X : LDS_B_X) + tx * (LDS_CELL + 8)
const ldsY = (ty: number) => LDS_Y + ty * (LDS_CELL + 8)

const ACC_X = 452
const ACC_Y = 96
const ACC_CELL = 72
const accX = (tx: number) => ACC_X + tx * (ACC_CELL + 14)
const accY = (ty: number) => ACC_Y + ty * (ACC_CELL + 22)

/** 装载进度（步骤 1；压缩轮 step3 直接呈现已装载） */
function loadE(ty: number, tx: number): number {
  if (props.step === 1) return easeInOutCubic(seg(props.local, 120 + (ty * 2 + tx) * 70, 380 + (ty * 2 + tx) * 70))
  if (props.step === 0) return 0
  return 1
}

/** 累加阶段 token/acc 更新进度 */
function accE(): number {
  if (props.step === 2) return easeInOutCubic(seg(props.local, 120, 900))
  if (props.step === 3) return easeInOutCubic(seg(props.local, 260, 1000))
  if (props.step === 4) return easeInOutCubic(seg(props.local, 260, 1000))
  return props.step === 5 ? 1 : 0
}

/** acc 卡显示值：按内循环已完成的项更新，不生成虚构的小数。 */
function accValue(ty: number, tx: number): string {
  if (props.step === 0) return '·'
  if (props.step === 1) return '0'
  if (props.step >= 5) return String(ACC_TRAJECTORY[3][ty][tx])
  const fromLayer = props.step === 2 ? 0 : props.step === 3 ? 1 : 2
  const p = accE()
  // 动画移动不等于数值插值：只显示实际完成的乘加结果。
  const inner = p >= 1 ? TILE : p >= 0.5 ? 1 : 0
  let value = ACC_TRAJECTORY[fromLayer][ty][tx]
  for (let k = 0; k < inner; k++) {
    value += (tileCell('a', ty, k, round.value.tile) ?? 0)
      * (tileCell('b', k, tx, round.value.tile) ?? 0)
  }
  return String(value)
}

/** 乘积 token：从 LDS 飞向 acc 卡 */
const accTokens = computed(() => {
  if (props.step < 2 || props.step > 4) return []
  const out: { key: string; x1: number; y1: number; x2: number; y2: number; p: number }[] = []
  const p = accE()
  if (p <= 0.02 || p >= 1) return out
  const fromLayer = props.step === 2 ? 0 : props.step === 3 ? 1 : 2
  for (const t of THREADS) {
    const from = ACC_TRAJECTORY[fromLayer][t.ty][t.tx]
    const to = ACC_TRAJECTORY[fromLayer + 1][t.ty][t.tx]
    if (from === to) continue
    out.push({
      key: `${t.ty}-${t.tx}`,
      x1: ldsX('b', 1) + LDS_CELL + 18,
      y1: ldsY(t.ty) + LDS_CELL / 2,
      x2: accX(t.tx) + ACC_CELL / 2,
      y2: accY(t.ty) + ACC_CELL / 2,
      p
    })
  }
  return out
})

const barrier1E = computed(() =>
  round.value.showBarrier1
    ? props.step === 1
      ? segE(props.local, 560, 900)
      : props.step === 3 || props.step === 4
        ? segE(props.local, 80, 240)
        : 1
    : 0
)
const barrier2E = computed(() =>
  round.value.showBarrier2
    ? props.step === 2
      ? segE(props.local, 980, 1250)
      : props.step === 3 || props.step === 4
        ? segE(props.local, 1060, 1220)
        : 1
    : 0
)

const tileDots = computed(() =>
  Array.from({ length: TILE_COUNT }, (_, tile) => ({
    tile,
    active: round.value.tile === tile && props.step >= 1 && props.step <= 4,
    done: props.step === 5 || (props.step >= 1 && tile < round.value.tile)
  }))
)

const captions = [
  '4 个线程合作 C 的一个 2×2 输出块：每个线程只持有一个 accumulator，A、B 的 tile 放进 block 共享的 LDS',
  '装载：每个线程写 tile_a[ty][tx] 与 tile_b[ty][tx] 各一格，写完进入第一道 __syncthreads()',
  '累加：inner = 0..1，每个线程从 LDS 取数乘加进自己的 accumulator；然后第二道 __syncthreads()',
  '第 2 轮：新的一对 tile 覆盖这两块 LDS——第二道同步保证大家都读完了旧值',
  '尾块：K=5 时第三轮只有 1 列/1 行有效，越界格填 0（使乘积为 0）；两次同步照走，不能提前退出',
  '写回：C 的 2×2 块 = [[8,10],[11,12]]；真实 16×16 kernel 的两块 LDS 共 2048 Byte'
]
</script>

<template>
  <g font-family="inherit">
    <!-- tile 计数器 -->
    <g v-for="(dot, index) in tileDots" :key="`td-${index}`">
      <rect
        :x="286 + index * 62" y="24" width="54" height="22" rx="11"
        :fill="dot.active ? 'var(--ej-active-soft)' : dot.done ? 'var(--ej-panel)' : 'var(--ej-surface)'"
        :stroke="dot.active ? 'var(--ej-active)' : 'var(--ej-line-strong)'" stroke-width="1.2"
      />
      <text :x="286 + index * 62 + 27" y="35" text-anchor="middle" dominant-baseline="central" font-size="10.5" :font-weight="dot.active ? 700 : 400" :fill="dot.active ? 'var(--ej-active)' : dot.done ? 'var(--ej-ink-soft)' : 'var(--ej-ink-faint)'">tile {{ index }}</text>
    </g>

    <!-- A / B tile 窗口 -->
    <text :x="WIN_A_X" y="52" font-size="10" font-weight="700" fill="var(--ej-a)">A 本轮 2 列</text>
    <text :x="WIN_B_X" y="52" font-size="10" font-weight="700" fill="var(--ej-b)">B 本轮 2 行</text>
    <g v-for="t in THREADS" :key="`wa-${t.ty}-${t.tx}`">
      <rect
        :x="winX('a', t.tx)" :y="winY(t.ty)" :width="WIN_CELL" :height="WIN_CELL" rx="6"
        fill="var(--ej-a-soft)" stroke="var(--ej-a)" stroke-width="1"
        :opacity="props.step === 0 ? 0.35 : 0.95"
      />
      <text :x="winX('a', t.tx) + WIN_CELL / 2" :y="winY(t.ty) + WIN_CELL / 2 + 1" text-anchor="middle" dominant-baseline="central" font-size="11.5" fill="var(--ej-ink)">{{ tileCell('a', t.ty, t.tx, round.tile) ?? 0 }}</text>
      <text v-if="tileCell('a', t.ty, t.tx, round.tile) === null && props.step === 4" :x="winX('a', t.tx) + WIN_CELL / 2" :y="winY(t.ty) + WIN_CELL - 2" text-anchor="middle" font-size="7.5" fill="var(--ej-bad)">填 0</text>
    </g>
    <g v-for="t in THREADS" :key="`wb-${t.ty}-${t.tx}`">
      <rect
        :x="winX('b', t.tx)" :y="winY(t.ty)" :width="WIN_CELL" :height="WIN_CELL" rx="6"
        fill="var(--ej-b-soft)" stroke="var(--ej-b)" stroke-width="1"
        :opacity="props.step === 0 ? 0.35 : 0.95"
      />
      <text :x="winX('b', t.tx) + WIN_CELL / 2" :y="winY(t.ty) + WIN_CELL / 2 + 1" text-anchor="middle" dominant-baseline="central" font-size="11.5" fill="var(--ej-ink)">{{ tileCell('b', t.ty, t.tx, round.tile) ?? 0 }}</text>
      <text v-if="tileCell('b', t.ty, t.tx, round.tile) === null && props.step === 4" :x="winX('b', t.tx) + WIN_CELL / 2" :y="winY(t.ty) + WIN_CELL - 2" text-anchor="middle" font-size="7.5" fill="var(--ej-bad)">填 0</text>
    </g>

    <!-- 矩阵整体的装载箭头只占用两层之间的留白，不穿过数值格。 -->
    <g v-if="props.step === 1" opacity="0.8">
      <path d="M94 148 V165 M90 161 L94 165 L98 161" fill="none" stroke="var(--ej-a)" stroke-width="1.4" />
      <path d="M234 148 V165 M230 161 L234 165 L238 161" fill="none" stroke="var(--ej-b)" stroke-width="1.4" />
    </g>

    <!-- LDS 两块 -->
    <text :x="LDS_A_X" y="184" font-size="10" font-weight="700" fill="var(--ej-ink-soft)">LDS tile_a[2][2]</text>
    <text :x="LDS_B_X" y="184" font-size="10" font-weight="700" fill="var(--ej-ink-soft)">LDS tile_b[2][2]</text>
    <g v-for="t in THREADS" :key="`sa-${t.ty}-${t.tx}`">
      <rect :x="ldsX('a', t.tx)" :y="ldsY(t.ty)" :width="LDS_CELL" :height="LDS_CELL" rx="7"
        :fill="loadE(t.ty, t.tx) > 0.02 ? 'var(--ej-a-soft)' : 'var(--ej-surface)'"
        :stroke="loadE(t.ty, t.tx) > 0.02 ? 'var(--ej-a)' : 'var(--ej-line-strong)'" stroke-width="1.1"
        :stroke-dasharray="loadE(t.ty, t.tx) > 0.02 ? undefined : '3 2'"
      />
      <text :x="ldsX('a', t.tx) + LDS_CELL / 2" :y="ldsY(t.ty) + LDS_CELL / 2 + 1" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="600" :fill="loadE(t.ty, t.tx) > 0.02 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'">{{ loadE(t.ty, t.tx) > 0.02 ? tileCell('a', t.ty, t.tx, round.tile) ?? 0 : '·' }}</text>
    </g>
    <g v-for="t in THREADS" :key="`sb-${t.ty}-${t.tx}`">
      <rect :x="ldsX('b', t.tx)" :y="ldsY(t.ty)" :width="LDS_CELL" :height="LDS_CELL" rx="7"
        :fill="loadE(t.ty, t.tx) > 0.02 ? 'var(--ej-b-soft)' : 'var(--ej-surface)'"
        :stroke="loadE(t.ty, t.tx) > 0.02 ? 'var(--ej-b)' : 'var(--ej-line-strong)'" stroke-width="1.1"
        :stroke-dasharray="loadE(t.ty, t.tx) > 0.02 ? undefined : '3 2'"
      />
      <text :x="ldsX('b', t.tx) + LDS_CELL / 2" :y="ldsY(t.ty) + LDS_CELL / 2 + 1" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="600" :fill="loadE(t.ty, t.tx) > 0.02 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'">{{ loadE(t.ty, t.tx) > 0.02 ? tileCell('b', t.ty, t.tx, round.tile) ?? 0 : '·' }}</text>
    </g>

    <!-- 栅栏①② -->
    <g :opacity="barrier1E">
      <rect x="56" y="286" width="278" height="24" rx="7" fill="var(--ej-active-soft)" stroke="var(--ej-active)" stroke-width="1.1" :opacity="0.4 + 0.6 * barrier1E" />
      <text x="195" y="298" text-anchor="middle" dominant-baseline="central" font-size="9.5" font-weight="600" fill="var(--ej-active)">__syncthreads() ①　装载完成</text>
    </g>
    <g :opacity="barrier2E">
      <rect x="356" y="286" width="308" height="24" rx="7" fill="var(--ej-active-soft)" stroke="var(--ej-active)" stroke-width="1.1" :opacity="0.4 + 0.6 * barrier2E" />
      <text x="510" y="298" text-anchor="middle" dominant-baseline="central" font-size="9.5" font-weight="600" fill="var(--ej-active)">__syncthreads() ②　才能覆盖 LDS</text>
    </g>

    <!-- acc 卡 2×2 -->
    <text :x="ACC_X" y="80" font-size="10" font-weight="700" fill="var(--ej-c)">各线程的 accumulator（C 的 2×2 块）</text>
    <g v-for="t in THREADS" :key="`acc-${t.ty}-${t.tx}`">
      <rect :x="accX(t.tx)" :y="accY(t.ty)" :width="ACC_CELL" :height="ACC_CELL" rx="9"
        :fill="accE() > 0.02 || props.step >= 5 ? 'var(--ej-c-soft)' : 'var(--ej-surface)'"
        :stroke="accE() > 0.02 || props.step >= 5 ? 'var(--ej-c)' : 'var(--ej-line-strong)'" stroke-width="1.2"
      />
      <text :x="accX(t.tx) + 8" :y="accY(t.ty) + 14" font-size="8" fill="var(--ej-ink-faint)">t{{ t.ty }}{{ t.tx }}</text>
      <text :x="accX(t.tx) + ACC_CELL / 2" :y="accY(t.ty) + ACC_CELL / 2 + 8" text-anchor="middle" dominant-baseline="central" font-size="17" font-weight="700" fill="var(--ej-ink)">{{ accValue(t.ty, t.tx) }}</text>
    </g>

    <!-- 累加 token -->
    <g v-for="token in accTokens" :key="`at-${token.key}`">
      <circle :cx="lerp(token.x1, token.x2, token.p)" :cy="lerp(token.y1, token.y2, token.p)" r="4.5" fill="var(--ej-active)" />
    </g>

    <!-- 尾块角标 -->
    <g v-if="props.step === 4" :opacity="segE(props.local, 300, 600)">
      <rect x="56" y="336" width="238" height="40" rx="8" fill="var(--ej-bad-soft)" stroke="var(--ej-bad)" stroke-width="1.1" />
      <text x="175" y="356" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="600" fill="var(--ej-ink-soft)">K=5：第三轮 1 列有效，其余填 0</text>
    </g>

    <text x="360" y="412" text-anchor="middle" font-size="11" fill="var(--ej-ink-soft)">{{ captions[Math.min(props.step, captions.length - 1)] }}</text>
    <text x="708" y="16" text-anchor="end" font-size="9" fill="var(--ej-ink-faint)">kTile=2 教学缩略 · 真实 16×16</text>
  </g>
</template>
