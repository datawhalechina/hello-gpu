<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, lerp, seg, segE } from '../../../../components/animation/easing'

/**
 * 12.2 物化（materialize）数据流：三个 kernel 用全局数组 Scores [S,S]、P [S,S] 串接。
 * 教学缩略 S=4、D=2；真实 S=128 时两个 FP32 中间数组按「写一次、读一次」
 * 计 16S² = 256 KiB 逻辑访问（算法读写数，非硬件事务计数）。
 */
const props = defineProps<{ step: number; local: number }>()

const KEYS = [0, 1, 2, 3]
const DIMS = [0, 1]

/* dispatch 的行扫描进度 */
function dispatchRow(step: number, row: number): number {
  if (props.step === step) return easeInOutCubic(seg(props.local, 140 + row * 200, 460 + row * 200))
  return props.step > step ? 1 : 0
}

const scoresE = (row: number) => dispatchRow(1, row)
const probE = (row: number) => dispatchRow(2, row)
const outE = (row: number) => dispatchRow(3, row)

/* ---------- 几何 ---------- */
const QK_X = 40
const Q_Y = 64
const K_Y = 178
const V_Y = 292
const QKV_W = 64
const QKV_H = 18

const SCORES_X = 260
const P_X = 452
const GRID_Y = 64
const CELL = 30
const GRID_GAP = 6
const gx = (base: number, col: number) => base + col * (CELL + GRID_GAP)
const gy = (row: number) => GRID_Y + row * (CELL + GRID_GAP)

const O_X = 610
const O_Y = 100
const O_W = 40
const O_H = 30

const DISPATCH_Y = 350

/** 飞行 token */
const tokens = computed(() => {
  const out: { key: string; x1: number; y1: number; x2: number; y2: number; p: number; color: string }[] = []
  const push = (x1: number, y1: number, x2: number, y2: number, start: number, color: string) => {
    const p = easeInOutCubic(seg(props.local, start, start + 260))
    if (p > 0.03 && p < 0.97) out.push({ key: `${x1}-${y1}-${x2}-${y2}-${start}`, x1, y1, x2, y2, p, color })
  }
  for (const row of KEYS) {
    const targetY = gy(row) + CELL / 2
    if (props.step === 1) {
      push(QK_X + QKV_W, Q_Y + row * (QKV_H + 4) + QKV_H / 2, SCORES_X - 10, targetY, 140 + row * 200, 'var(--ej-a)')
      push(QK_X + QKV_W, K_Y + QKV_H / 2, SCORES_X - 10, targetY, 160 + row * 200, 'var(--ej-a)')
    }
    if (props.step === 2) {
      push(SCORES_X + 4 * (CELL + GRID_GAP) - GRID_GAP, targetY, P_X - 10, targetY, 140 + row * 200, 'var(--ej-b)')
    }
    if (props.step === 3) {
      push(P_X + 4 * (CELL + GRID_GAP) - GRID_GAP, targetY, O_X - 10, O_Y + row * (O_H + 6) + O_H / 2, 140 + row * 200, 'var(--ej-c)')
      push(QK_X + QKV_W, V_Y + QKV_H / 2, O_X - 10, O_Y + row * (O_H + 6) + O_H / 2, 170 + row * 200, 'var(--ej-c)')
    }
  }
  return out
})

const trafficE = computed(() => (props.step === 4 ? segE(props.local, 150, 600) : 0))

const captions = [
  '物化 = 把中间结果真正保存成数组：这条链上的 Scores 和 P 都是 S×S 的全局数组',
  'dispatch 1 · 算分数：一线程一个 query-key 点积，scores[row*seq+col]',
  'dispatch 2 · 逐行 Softmax：一 block 一行，读 Scores 写 P',
  'dispatch 3 · 加权和：一线程一输出元素，读 P 与 V 写 O',
  '两个 FP32 中间数组：容量 2S²×4 Byte，写+读逻辑量 16S² Byte（S=128 → 256 KiB）',
  '问题：不保存完整 Scores 和 P，能否得到同一个加权和？——12.3 的在线路线'
]
</script>

<template>
  <g font-family="inherit">
    <!-- 输入矩阵 -->
    <text :x="QK_X" y="50" font-size="10" font-weight="700" fill="var(--ej-a)">Q 4×2</text>
    <g v-for="row in KEYS" :key="`q-${row}`">
      <rect :x="QK_X" :y="Q_Y + row * (QKV_H + 4)" :width="QKV_W" :height="QKV_H" rx="5" fill="var(--ej-a-soft)" stroke="var(--ej-a)" stroke-width="0.9" />
      <text :x="QK_X + QKV_W / 2" :y="Q_Y + row * (QKV_H + 4) + QKV_H / 2" text-anchor="middle" dominant-baseline="central" font-size="8.5" fill="var(--ej-ink-soft)">q{{ row }}</text>
    </g>
    <text :x="QK_X" y="164" font-size="10" font-weight="700" fill="var(--ej-a)">K 4×2</text>
    <g v-for="row in KEYS" :key="`k-${row}`">
      <rect :x="QK_X" :y="K_Y + row * (QKV_H + 4)" :width="QKV_W" :height="QKV_H" rx="5" fill="var(--ej-a-soft)" stroke="var(--ej-a)" stroke-width="0.9" />
      <text :x="QK_X + QKV_W / 2" :y="K_Y + row * (QKV_H + 4) + QKV_H / 2" text-anchor="middle" dominant-baseline="central" font-size="8.5" fill="var(--ej-ink-soft)">k{{ row }}</text>
    </g>
    <text :x="QK_X" y="278" font-size="10" font-weight="700" fill="var(--ej-b)">V 4×2</text>
    <g v-for="row in KEYS" :key="`v-${row}`">
      <rect :x="QK_X" :y="V_Y + row * (QKV_H + 4)" :width="QKV_W" :height="QKV_H" rx="5" fill="var(--ej-b-soft)" stroke="var(--ej-b)" stroke-width="0.9" />
      <text :x="QK_X + QKV_W / 2" :y="V_Y + row * (QKV_H + 4) + QKV_H / 2" text-anchor="middle" dominant-baseline="central" font-size="8.5" fill="var(--ej-ink-soft)">v{{ row }}</text>
    </g>

    <!-- Scores 网格 -->
    <text :x="SCORES_X" y="50" font-size="10.5" font-weight="700" fill="var(--ej-active)">Scores [S,S]</text>
    <g v-for="row in KEYS" :key="`sr-${row}`">
      <rect v-for="col in KEYS" :key="`sc-${row}-${col}`" :x="gx(SCORES_X, col)" :y="gy(row)" :width="CELL" :height="CELL" rx="6"
        :fill="scoresE(row) > 0.05 ? 'var(--ej-active-soft)' : 'var(--ej-surface)'"
        :stroke="scoresE(row) > 0.05 ? 'var(--ej-active)' : 'var(--ej-line)'" stroke-width="1"
      />
    </g>

    <!-- P 网格 -->
    <text :x="P_X" y="50" font-size="10.5" font-weight="700" fill="var(--ej-b)">P [S,S]</text>
    <g v-for="row in KEYS" :key="`pr-${row}`">
      <rect v-for="col in KEYS" :key="`pc-${row}-${col}`" :x="gx(P_X, col)" :y="gy(row)" :width="CELL" :height="CELL" rx="6"
        :fill="probE(row) > 0.05 ? 'var(--ej-b-soft)' : 'var(--ej-surface)'"
        :stroke="probE(row) > 0.05 ? 'var(--ej-b)' : 'var(--ej-line)'" stroke-width="1"
      />
    </g>

    <!-- O 矩阵 -->
    <text :x="O_X" y="86" font-size="10.5" font-weight="700" fill="var(--ej-c)">O [S,D]</text>
    <g v-for="row in KEYS" :key="`or-${row}`">
      <rect v-for="col in DIMS" :key="`oc-${row}-${col}`" :x="O_X + col * (O_W + 6)" :y="O_Y + row * (O_H + 6)" :width="O_W" :height="O_H" rx="6"
        :fill="outE(row) > 0.05 ? 'var(--ej-c-soft)' : 'var(--ej-surface)'"
        :stroke="outE(row) > 0.05 ? 'var(--ej-c)' : 'var(--ej-line)'" stroke-width="1"
      />
    </g>

    <!-- dispatch 卡 -->
    <g v-for="(label, index) in ['① 算分数', '② 逐行 Softmax', '③ 加权和']" :key="`dk-${index}`">
      <rect
        :x="260 + index * 148" :y="DISPATCH_Y" width="140" height="30" rx="8"
        :fill="props.step === index + 1 ? 'var(--ej-active-soft)' : 'var(--ej-panel)'"
        :stroke="props.step === index + 1 ? 'var(--ej-active)' : 'var(--ej-line)'" stroke-width="1.1"
      />
      <text :x="260 + index * 148 + 70" :y="DISPATCH_Y + 15" text-anchor="middle" dominant-baseline="central" font-size="10.5" :font-weight="props.step === index + 1 ? 700 : 400" :fill="props.step === index + 1 ? 'var(--ej-active)' : 'var(--ej-ink-soft)'">{{ label }}</text>
    </g>

    <!-- token -->
    <g v-for="token in tokens" :key="`tk-${token.key}`">
      <circle :cx="lerp(token.x1, token.x2, token.p)" :cy="lerp(token.y1, token.y2, token.p)" r="4" :fill="token.color" />
    </g>

    <!-- 逻辑流量徽章 -->
    <g v-if="props.step === 4" :opacity="trafficE">
      <rect x="260" y="300" width="286" height="30" rx="8" fill="var(--ej-b-soft)" stroke="var(--ej-b)" stroke-width="1.1" />
      <text x="403" y="315" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="600" fill="var(--ej-b)">
        Scores + P 各写一次读一次 = 16S² Byte
      </text>
    </g>

    <text x="360" y="408" text-anchor="middle" font-size="11" fill="var(--ej-ink-soft)">{{ captions[Math.min(props.step, captions.length - 1)] }}</text>
    <text x="708" y="20" text-anchor="end" font-size="9" fill="var(--ej-ink-faint)">S=4 教学缩略 · 真实 S=128, D=64</text>
  </g>
</template>
