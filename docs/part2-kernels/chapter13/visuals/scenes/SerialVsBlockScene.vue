<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, seg, segE } from '../../../../components/animation/easing'

/**
 * 13.3 HIP 两个版本的行内分工对照：serial（一个线程顺序处理一行）
 * vs block（256 线程 + LDS 树归约 + 广播）。数据沿用本章动画输入
 * x=[3,4,-3,-4]、w=[1,0.5,2,1]、ε=1e-5；平方和 50，r = rsqrt(50/4+ε) ≈ 0.2828。
 * 结尾给 9070 XT 实测：serial 1.5049 ms、block 0.0584 ms（约 25.8 倍）。
 */
const props = defineProps<{ step: number; local: number }>()

const X = [3, 4, -3, -4]
const W = [1, 0.5, 2, 1]
const COLS = 4
const SQUARE_SUM = 50
const R = 1 / Math.sqrt(SQUARE_SUM / COLS + 1e-5)
const OUT = X.map((value, index) => value * R * W[index])

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/* ---------- 几何 ---------- */
const SER_X = 44
const BLK_X = 396
const PANEL_Y = 40
const PANEL_W = 280
const PANEL_H = 278

const ROW_X = 24
const ROW_Y = 354
const ROW_CELL = 64
const ROW_GAP = 8
const rowX = (col: number) => ROW_X + col * (ROW_CELL + ROW_GAP)

/* ---------- serial 面板 ---------- */
/** 一条 4 步长链：方格依次点亮并传递部分和 */
function serialChainE(col: number): number {
  if (props.step < 1) return 0
  if (props.step === 1) return easeInOutCubic(seg(props.local, 150 + col * 700, 550 + col * 700))
  return 1
}
function serialOutE(): number {
  if (props.step < 2) return 0
  if (props.step === 2) return easeInOutCubic(seg(props.local, 150, 700))
  return 1
}

/* ---------- block 面板 ---------- */
const LANES = [0, 1, 2, 3]
const LDS_X = BLK_X + 20
const LDS_Y = PANEL_Y + 178
const LDS_W = 56
const LDS_GAP = 8
const ldsX = (tid: number) => LDS_X + tid * (LDS_W + LDS_GAP)

function localSqE(tid: number): number {
  if (props.step < 3) return 0
  if (props.step === 3) return easeInOutCubic(seg(props.local, 120 + tid * 70, 360 + tid * 70))
  return 1
}
function sharedWriteE(tid: number): number {
  if (props.step < 4) return 0
  if (props.step === 4) return easeInOutCubic(seg(props.local, 100 + tid * 50, 300 + tid * 50))
  return 1
}
function treeE(round: 0 | 1): number {
  if (props.step < 5) return 0
  if (props.step === 5) {
    return easeInOutCubic(seg(props.local, round === 0 ? 100 : 480, round === 0 ? 380 : 760))
  }
  return 1
}
function rsqrtE(): number {
  if (props.step < 6) return 0
  if (props.step === 6) return easeInOutCubic(seg(props.local, 120, 420))
  return 1
}
function blkOutE(): number {
  if (props.step < 6) return 0
  if (props.step === 6) return easeInOutCubic(seg(props.local, 480, 950))
  return 1
}

/** block 面板同步次数 */
const blkSyncs = computed(() => {
  if (props.step <= 3) return 0
  if (props.step === 4) return sharedWriteE(3) >= 1 ? 1 : 0
  if (props.step === 5) {
    const r1 = seg(props.local, 100, 380) >= 1 ? 1 : 0
    const r2 = seg(props.local, 480, 760) >= 1 ? 1 : 0
    return 1 + r1 + r2
  }
  return 3
})

const ldsValues = computed(() => {
  const values = X.map(value => value * value)
  if (treeE(0) >= 1) {
    values[0] += values[2]
    values[1] += values[3]
  }
  if (treeE(1) >= 1) values[0] += values[1]
  return values
})
const reductionDone = computed(() => treeE(1) >= 1)
const sharedStatus = computed(() => {
  if (props.step < 4) return '等待写入部分和'
  if (props.step === 4) return '写入后同步，再开始归约'
  if (!reductionDone.value) return treeE(0) >= 1 ? 'stride = 1：18 + 32' : 'stride = 2：前后半区相加'
  return `shared[0] = ${SQUARE_SUM}`
})

const perfE = computed(() => (props.step === 7 ? segE(props.local, 150, 500) : 0))

const captions = [
  '同一行，两种行内分工：左 serial 一线程包办，右 block 四线程协作（真实 block=256）',
  'serial 第一遍：square_sum = 3²+4²+3²+4² = 50——同一行的累加是一条 4 步长链',
  'serial 第二遍：r = rsqrtf(50/4 + ε) ≈ 0.2828，逐个写 y = x·r·w',
  'block 第一遍：每线程只算自己列的平方（无列的线程贡献 0），寄存器累加',
  '部分和写入 shared[tid]，第一次 __syncthreads()',
  '树归约 stride=2 → 1：shared[0] = 50；每轮之后都要同步',
  'r = rsqrtf(50/4 + ε)，各线程缩放自己的列；此后不再覆盖 LDS',
  '9070 XT 实测：1.5049 ms → 0.0584 ms，行内协作带来约 25.8 倍'
]
</script>

<template>
  <g font-family="inherit">
    <!-- 输入行（共用，位于面板下方） -->
    <text x="24" y="342" font-size="11" font-weight="600" fill="var(--ej-ink-soft)">同一行 x = [3, 4, −3, −4] · w = [1, 0.5, 2, 1] · ε = 1e-5</text>
    <g v-for="(value, col) in X" :key="`x-${col}`">
      <rect :x="rowX(col)" :y="ROW_Y" :width="ROW_CELL" :height="40" rx="7" fill="var(--ej-a-soft)" stroke="var(--ej-a)" stroke-width="1.1" />
      <text :x="rowX(col) + ROW_CELL / 2" :y="ROW_Y + 20" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" fill="var(--ej-ink)">{{ value }}</text>
    </g>

    <!-- ============ serial 面板 ============ -->
    <g>
      <rect :x="SER_X" :y="PANEL_Y" :width="PANEL_W" :height="PANEL_H" rx="12" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1" />
      <text :x="SER_X + 18" :y="PANEL_Y + 26" font-size="12" font-weight="700" fill="var(--ej-ink)">serial · 一线程一行</text>
      <text :x="SER_X + PANEL_W - 18" :y="PANEL_Y + 26" text-anchor="end" font-size="9" fill="var(--ej-ink-faint)">1024 个线程各管一行</text>

      <!-- 长链：4 步依次累加 -->
      <g v-for="(value, col) in X" :key="`sc-${col}`">
        <rect
          :x="SER_X + 18 + col * 62" :y="PANEL_Y + 48" width="54" height="40" rx="7"
          :fill="serialChainE(col) > 0.02 ? 'var(--ej-a-soft)' : 'var(--ej-surface)'"
          :stroke="serialChainE(col) > 0.02 ? 'var(--ej-a)' : 'var(--ej-line-strong)'" stroke-width="1.1"
          :opacity="0.4 + 0.6 * serialChainE(col)"
        />
        <text :x="SER_X + 18 + col * 62 + 27" :y="PANEL_Y + 62" text-anchor="middle" font-size="8" fill="var(--ej-ink-faint)">+{{ value < 0 ? `(${value})` : value }}²</text>
        <text :x="SER_X + 18 + col * 62 + 27" :y="PANEL_Y + 77" text-anchor="middle" dominant-baseline="central" font-size="10.5" :font-weight="serialChainE(col) > 0.9 ? 700 : 400" :fill="serialChainE(col) > 0.02 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'">
          {{ serialChainE(col) > 0.02 ? X.slice(0, col + 1).reduce((sum, v) => sum + v * v, 0) : '·' }}
        </text>
        <line
          v-if="col < 3 && serialChainE(col) > 0.3"
          :x1="SER_X + 18 + col * 62 + 56" :y1="PANEL_Y + 68" :x2="SER_X + 18 + (col + 1) * 62 + 4" :y2="PANEL_Y + 68"
          stroke="var(--ej-a)" stroke-width="1.4"
        />
      </g>
      <text :x="SER_X + 18" :y="PANEL_Y + 112" font-size="9.5" fill="var(--ej-ink-soft)">同一行的累加是一条长链：后一步等前一步</text>

      <!-- r 与输出 -->
      <g :opacity="serialOutE()">
        <rect :x="SER_X + 18" :y="PANEL_Y + 128" width="118" height="34" rx="8" fill="var(--ej-active-soft)" stroke="var(--ej-active)" stroke-width="1.1" />
        <text :x="SER_X + 77" :y="PANEL_Y + 145" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="600" fill="var(--ej-active)">r ≈ 0.2828</text>
        <text :x="SER_X + 18" :y="PANEL_Y + 182" font-size="9.5" fill="var(--ej-ink-soft)">第二遍循环：逐列写 y = x·r·w</text>
      </g>
    </g>

    <!-- ============ block 面板 ============ -->
    <g>
      <rect :x="BLK_X" :y="PANEL_Y" :width="PANEL_W" :height="PANEL_H" rx="12" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1" />
      <text :x="BLK_X + 18" :y="PANEL_Y + 26" font-size="12" font-weight="700" fill="var(--ej-ink)">block · 4 线程一行</text>
      <text :x="BLK_X + PANEL_W - 18" :y="PANEL_Y + 26" text-anchor="end" font-size="9" fill="var(--ej-ink-faint)">真实 block=256</text>

      <!-- 各线程局部平方和（两行，y = +40..80 / +86..126） -->
      <g v-for="tid in LANES" :key="`bl-${tid}`">
        <rect
          :x="BLK_X + 18 + (tid % 2) * 128" :y="PANEL_Y + 40 + Math.floor(tid / 2) * 46" width="118" height="40" rx="7"
          :fill="localSqE(tid) > 0.02 ? 'var(--ej-a-soft)' : 'var(--ej-surface)'"
          :stroke="localSqE(tid) > 0.02 ? 'var(--ej-a)' : 'var(--ej-line-strong)'" stroke-width="1.1"
        />
        <text :x="BLK_X + 26 + (tid % 2) * 128" :y="PANEL_Y + 54 + Math.floor(tid / 2) * 46" font-size="8.5" fill="var(--ej-ink-faint)">tid {{ tid }}</text>
        <text :x="BLK_X + 128 + (tid % 2) * 128" :y="PANEL_Y + 66 + Math.floor(tid / 2) * 46" text-anchor="end" dominant-baseline="central" font-size="12" font-weight="600" :fill="localSqE(tid) > 0.02 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'">
          {{ localSqE(tid) > 0.02 ? `${X[tid] < 0 ? `(${X[tid]})` : X[tid]}² = ${X[tid] * X[tid]}` : '·' }}
        </text>
      </g>

      <!-- shared 写入（标签、归约连线与数值各占独立纵向区域） -->
      <text :x="LDS_X" :y="LDS_Y - 34" font-size="9" fill="var(--ej-ink-faint)">shared[0..3]</text>
      <g v-for="tid in LANES" :key="`bs-${tid}`">
        <rect
          :x="ldsX(tid)" :y="LDS_Y" :width="LDS_W" :height="32" rx="6"
          :fill="sharedWriteE(tid) > 0.02 ? 'var(--ej-b-soft)' : 'var(--ej-surface)'"
          :stroke="sharedWriteE(tid) > 0.02 ? 'var(--ej-b)' : 'var(--ej-line-strong)'" stroke-width="1"
        />
        <text :x="ldsX(tid) + LDS_W / 2" :y="LDS_Y + 16" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="600" :fill="sharedWriteE(tid) > 0.02 ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'">
          {{ sharedWriteE(tid) > 0.02 ? ldsValues[tid] : '·' }}
        </text>
      </g>

      <!-- 树归约弧线（峰顶限制在卡片与 shared 之间的空档） -->
      <g :opacity="treeE(0) * (1 - treeE(1))">
        <path :d="`M ${ldsX(2) + LDS_W / 2} ${LDS_Y - 5} Q ${(ldsX(0) + LDS_W / 2 + ldsX(2) + LDS_W / 2) / 2} ${LDS_Y - 18} ${ldsX(0) + LDS_W / 2} ${LDS_Y - 5}`" fill="none" stroke="var(--ej-active)" stroke-width="1.4" />
        <path :d="`M ${ldsX(3) + LDS_W / 2} ${LDS_Y - 5} Q ${(ldsX(1) + LDS_W / 2 + ldsX(3) + LDS_W / 2) / 2} ${LDS_Y - 18} ${ldsX(1) + LDS_W / 2} ${LDS_Y - 5}`" fill="none" stroke="var(--ej-active)" stroke-width="1.4" />
      </g>
      <g :opacity="treeE(1)">
        <path :d="`M ${ldsX(1) + LDS_W / 2} ${LDS_Y - 5} Q ${(ldsX(0) + LDS_W / 2 + ldsX(1) + LDS_W / 2) / 2} ${LDS_Y - 26} ${ldsX(0) + LDS_W / 2} ${LDS_Y - 5}`" fill="none" stroke="var(--ej-active)" stroke-width="1.4" />
      </g>

      <!-- 归约结果 + 同步计数（shared 行下方状态与同步次数） -->
      <text :x="LDS_X" :y="LDS_Y + 50" font-size="10" font-weight="700" fill="var(--ej-active)">{{ sharedStatus }}</text>
      <text :x="BLK_X + PANEL_W - 18" :y="LDS_Y + 50" text-anchor="end" font-size="9.5" fill="var(--ej-ink-soft)">同步 {{ blkSyncs }} 次</text>

      <!-- r 广播徽章（面板底部） -->
      <g :opacity="rsqrtE()">
        <rect :x="BLK_X + 18" :y="PANEL_Y + 240" width="150" height="28" rx="7" fill="var(--ej-active-soft)" stroke="var(--ej-active)" stroke-width="1.1" />
        <text :x="BLK_X + 93" :y="PANEL_Y + 254" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="600" fill="var(--ej-active)">r ≈ 0.2828 广播</text>
      </g>
    </g>

    <!-- 输出（两版一致） -->
    <g :opacity="Math.max(serialOutE(), blkOutE())">
      <text x="24" y="409" font-size="10" fill="var(--ej-ink-faint)">y = x · r · w：</text>
      <g v-for="(value, col) in OUT" :key="`out-${col}`">
        <rect :x="rowX(col)" :y="416" :width="ROW_CELL" :height="36" rx="7" fill="var(--ej-c-soft)" stroke="var(--ej-c)" stroke-width="1.1" />
        <text :x="rowX(col) + ROW_CELL / 2" :y="416 + 18" text-anchor="middle" dominant-baseline="central" font-size="11.5" font-weight="600" fill="var(--ej-ink)">{{ value.toFixed(4) }}</text>
      </g>
    </g>

    <text x="360" y="484" text-anchor="middle" font-size="11" fill="var(--ej-ink-soft)">{{ captions[Math.min(props.step, captions.length - 1)] }}</text>

    <!-- 实测（step 8 覆盖） -->
    <g v-if="props.step === 7" :opacity="perfE">
      <rect x="0" y="0" width="720" height="500" fill="var(--ej-surface)" />
      <text x="360" y="76" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="700" fill="var(--ej-ink)">
        行内协作的收益 · 9070 XT 实测（1024×4096 FP32）
      </text>
      <g v-for="(row, index) in [
          { name: 'rmsnorm_serial', ms: '1.5049 ms', note: '一线程一行，同一行长链累加' },
          { name: 'rmsnorm_block', ms: '0.0584 ms', note: 'block=256，LDS 树归约 + 广播' }
        ]" :key="`pm-${index}`">
        <rect x="120" :y="118 + index * 72" width="480" height="58" rx="10" :fill="index === 1 ? 'var(--ej-active-soft)' : 'var(--ej-panel)'" :stroke="index === 1 ? 'var(--ej-active)' : 'var(--ej-line)'" stroke-width="1.2" />
        <text x="142" :y="140 + index * 72" font-size="12" :font-family="MONO" font-weight="600" :fill="index === 1 ? 'var(--ej-active)' : 'var(--ej-ink)'">{{ row.name }}</text>
        <text x="142" :y="158 + index * 72" font-size="10" fill="var(--ej-ink-soft)">{{ row.note }}</text>
        <text x="576" :y="147 + index * 72" text-anchor="end" dominant-baseline="central" font-size="16" font-weight="700" :fill="index === 1 ? 'var(--ej-active)' : 'var(--ej-ink-soft)'">{{ row.ms }}</text>
      </g>
      <text x="360" y="298" text-anchor="middle" font-size="11.5" fill="var(--ej-ink-soft)">
        block 约为 serial 的 25.8 倍：分工改变的是同一行内的协作方式，行与行之间本来就是并行的
      </text>
      <text x="360" y="324" text-anchor="middle" font-size="9.5" fill="var(--ej-ink-faint)">
        数据来自 2026-07-19 curated evidence（evidence/summary.csv）· 数字为实测
      </text>
    </g>
  </g>
</template>
