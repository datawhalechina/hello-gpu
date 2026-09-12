<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, seg, segE } from '../../../../components/animation/easing'

/**
 * 12.4 hip-online：一个 block 处理一个 query 行的同步时间线。
 * 每个 key 一拍，拍内五相：部分点积 → LDS 归约 → 线程 0 更新 m/l/α/β →
 * 屏障广播 → 全线程更新 numerator → 屏障。同步计数器持续累加——
 * 「减少中间写回只是收益的一面，新增的同步同样是成本」（12.6 负结果的成因）。
 * 数据沿用正文手算：scores=[2,1,4]、V=[[1,0],[0,2],[3,1]]；Q/K 取一组
 * 可得到相同分数的值（Q/√D=[1,1]，K=[[1,1],[1,0],[3,1]]），D=2 → block=2 线程。
 */
const props = defineProps<{ step: number; local: number }>()

// 将 1/√D 吸收到 Q，保留正文已缩放的 scores=[2,1,4]。
const QScaled = [1, 1]
const K = [
  [1, 1],
  [1, 0],
  [3, 1]
]
const V = [
  [1, 0],
  [0, 2],
  [3, 1]
]
const SCORES = [2, 1, 4]
const KEYS = [0, 1, 2]
const TIDS = [0, 1]

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** 逐步状态轨迹（精确计算，显示时 toFixed） */
interface State {
  m: number
  l: number
  a: number[]
  alpha: number
  beta: number
}
function stateAfter(keyCount: number): State {
  let m = -Infinity
  let l = 0
  const a = [0, 0]
  let alpha = 0
  let beta = 0
  for (let j = 0; j < keyCount; j++) {
    const score = SCORES[j]
    const newMax = Math.max(m, score)
    alpha = m === -Infinity ? 0 : Math.exp(m - newMax)
    beta = Math.exp(score - newMax)
    l = l * alpha + beta
    for (let d = 0; d < 2; d++) a[d] = a[d] * alpha + beta * V[j][d]
    m = newMax
  }
  return { m, l, a, alpha, beta }
}
const STATES = [0, 1, 2, 3].map(k => stateAfter(k))
const OUTPUT = [STATES[3].a[0] / STATES[3].l, STATES[3].a[1] / STATES[3].l]

/** 每个线程的部分点积：tid_d 计算 Q[d]·K[j][d] */
const partial = (j: number, d: number) => QScaled[d] * K[j][d]

/* ---------- 步骤 1-3 为 key 0..2，每拍内五相 ---------- */
function currentKey(): number | null {
  return props.step >= 1 && props.step <= 3 ? props.step - 1 : null
}

const phase = computed(() => {
  const j = currentKey()
  if (j === null) return null
  return {
    partial: easeInOutCubic(seg(props.local, 120, 380)),
    reduce: easeInOutCubic(seg(props.local, 480, 700)),
    update: easeInOutCubic(seg(props.local, 800, 1080)),
    broadcast: easeInOutCubic(seg(props.local, 1180, 1360)),
    numer: easeInOutCubic(seg(props.local, 1460, 1780)),
    barrier2: segE(props.local, 1880, 2080)
  }
})

/** 部分点积进度（步骤 1） */
function scanE(tid: number): number {
  if (props.step === 0) return easeInOutCubic(seg(props.local, 120 + tid * 200, 400 + tid * 200))
  return 1
}

/** 状态卡按真实计算阶段更新；过渡动画不产生虚构的中间数值。 */
function displayState(): State {
  if (props.step === 0) return { m: -Infinity, l: 0, a: [0, 0], alpha: 0, beta: 0 }
  const j = currentKey()
  if (j === null) return STATES[3]
  const from = STATES[j]
  const to = STATES[j + 1]
  const updated = (phase.value?.update ?? 0) >= 1
  const accumulated = (phase.value?.numer ?? 0) >= 1
  return {
    m: updated ? to.m : from.m,
    l: updated ? to.l : from.l,
    a: accumulated ? to.a : from.a,
    alpha: updated ? to.alpha : from.alpha,
    beta: updated ? to.beta : from.beta
  }
}

const state = computed(displayState)

/** numerator 更新进度（key 拍内最后一相） */
function numerE(): number {
  const j = currentKey()
  if (j === null) return props.step >= 4 ? 1 : 0
  return phase.value?.numer ?? 0
}

/* ---------- 几何（全场景无重叠布局） ---------- */
const TID_X = 48
const TID_Y = [100, 154]
const TID_W = 190
const TID_H = 44

const LDS_X = 270
const LDS_Y = 110
const LDS_W = 66
const LDS_H = 40

const STATE_X = 380
const STATE_Y = 92
const CARD_W = 150
const CARD_H = 54

const NUM_Y = 240
const NUM_H = 50

const KEY_BAR_Y = 40

const syncCount = computed(() => {
  const j = currentKey()
  if (props.step === 0) return 0
  if (j === null) return 6
  const p = phase.value!
  return j * 2 + (p.barrier2 > 0.5 ? 2 : p.broadcast > 0.5 ? 1 : 0)
})

const outputE = computed(() => (props.step === 4 ? segE(props.local, 150, 550) : 0))
const perfE = computed(() => (props.step === 5 ? segE(props.local, 150, 500) : 0))

const captions = [
  '状态三件套初始化：m = −∞、l = 0、a = 0；两个线程各算 D 的一个分量',
  'key 0：部分点积 → LDS 归约出 score=2 → 线程 0 更新状态（α=0, β=1）→ 广播 → 更新 numerator',
  'key 1：score=1 没有超过 m=2，α=e⁰=1，历史状态不用换尺度，只加 β·V₁',
  'key 2：score=4 迫使旧 l、旧 a 同乘 α=e⁻²——这就是历史状态重缩放',
  '扫描完毕：O = numerator / l = [2.6456, 0.9278]，与物化计算结果一致',
  '计数仅含广播与复用两道屏障；LDS 归约另需同步，实际成本更高'
]
</script>

<template>
  <g font-family="inherit">
    <g v-if="props.step !== 5">
    <!-- key 时间线 -->
    <g v-for="(j, index) in KEYS" :key="`kb-${j}`">
      <rect
        :x="48 + index * 96" :y="KEY_BAR_Y" width="88" height="26" rx="13"
        :fill="currentKey() === j ? 'var(--ej-active-soft)' : props.step > index + 1 ? 'var(--ej-panel)' : 'var(--ej-surface)'"
        :stroke="currentKey() === j ? 'var(--ej-active)' : 'var(--ej-line-strong)'" stroke-width="1.2"
      />
      <text :x="48 + index * 96 + 44" :y="KEY_BAR_Y + 13" text-anchor="middle" dominant-baseline="central" font-size="10.5" :font-weight="currentKey() === j ? 700 : 400" :fill="currentKey() === j ? 'var(--ej-active)' : 'var(--ej-ink-soft)'">key {{ j }} · s={{ SCORES[j] }}</text>
    </g>

    <!-- 两个线程卡：部分点积 -->
    <text :x="TID_X" y="88" font-size="10" font-weight="700" fill="var(--ej-ink-soft)">部分点积（Q̂ = Q / √D）</text>
    <g v-for="tid in TIDS" :key="`tid-${tid}`">
      <rect :x="TID_X" :y="TID_Y[tid]" :width="TID_W" :height="TID_H" rx="8" fill="var(--ej-surface)" :stroke="scanE(tid) > 0.02 || props.step > 0 ? 'var(--ej-a)' : 'var(--ej-line-strong)'" stroke-width="1.2" />
      <text :x="TID_X + 10" :y="TID_Y[tid] + 15" font-size="9" fill="var(--ej-ink-faint)">tid {{ tid }} · 分量 d={{ tid }}</text>
      <text :x="TID_X + TID_W - 10" :y="TID_Y[tid] + 31" text-anchor="end" dominant-baseline="central" font-size="12" :font-weight="600" fill="var(--ej-ink)">
        <template v-if="props.step === 0">{{ scanE(tid) > 0.02 ? `Q̂[${tid}]·K[0][${tid}] = ${partial(0, tid)}` : '·' }}</template>
        <template v-else-if="currentKey() !== null">{{ phase!.partial > 0.02 || props.step > 1 ? `Q̂·K = ${partial(currentKey()!, tid)}` : '·' }}</template>
        <template v-else>✓</template>
      </text>
    </g>
    <line x1="240" y1="130" x2="268" y2="130" stroke="var(--ej-a)" stroke-width="1" stroke-dasharray="3 2" opacity="0.6" />

    <!-- LDS 归约格 -->
    <text :x="LDS_X" y="100" font-size="10" font-weight="700" fill="var(--ej-ink-soft)">LDS 归约</text>
    <rect :x="LDS_X" :y="LDS_Y" :width="LDS_W" :height="LDS_H" rx="8"
      :fill="(currentKey() !== null && (phase!.reduce > 0.02 || props.step > 1)) ? 'var(--ej-active-soft)' : 'var(--ej-surface)'"
      :stroke="(currentKey() !== null && (phase!.reduce > 0.02 || props.step > 1)) ? 'var(--ej-active)' : 'var(--ej-line-strong)'" stroke-width="1.2" />
    <text :x="LDS_X + LDS_W / 2" :y="LDS_Y + LDS_H / 2" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="700" fill="var(--ej-ink)">
      <template v-if="currentKey() !== null && phase!.reduce > 0.02">score={{ SCORES[currentKey()!] }}</template>
      <template v-else-if="props.step >= 4">✓</template>
      <template v-else>·</template>
    </text>

    <!-- 状态三件套 + 系数（2×2） -->
    <text :x="STATE_X" y="80" font-size="10" font-weight="700" fill="var(--ej-ink-soft)">state[0:4]（线程 0 更新）</text>
    <g v-for="(card, index) in [
        { label: 'm', value: state.m === -Infinity ? '−∞' : state.m.toFixed(1) },
        { label: 'l', value: state.l.toFixed(4) },
        { label: 'α', value: state.alpha.toFixed(4) },
        { label: 'β', value: state.beta.toFixed(4) }
      ]" :key="`st-${index}`">
      <rect :x="STATE_X + (index % 2) * (CARD_W + 10)" :y="STATE_Y + Math.floor(index / 2) * (CARD_H + 8)" :width="CARD_W" :height="CARD_H" rx="8"
        :fill="index < 2 ? 'var(--ej-panel)' : 'var(--ej-b-soft)'"
        :stroke="index < 2 ? 'var(--ej-line)' : 'var(--ej-b)'" stroke-width="1.1"
      />
      <text :x="STATE_X + (index % 2) * (CARD_W + 10) + 12" :y="STATE_Y + Math.floor(index / 2) * (CARD_H + 8) + 20" font-size="10.5" font-weight="700" :fill="index < 2 ? 'var(--ej-ink-soft)' : 'var(--ej-b)'">{{ card.label }}</text>
      <text :x="STATE_X + (index % 2) * (CARD_W + 10) + CARD_W - 12" :y="STATE_Y + Math.floor(index / 2) * (CARD_H + 8) + CARD_H / 2 + 4" text-anchor="end" dominant-baseline="central" font-size="14" font-weight="600" fill="var(--ej-ink)">{{ card.value }}</text>
    </g>
    <text :x="STATE_X" y="218" font-size="9" fill="var(--ej-ink-faint)">m、l 是累计标量；α、β 是本轮广播给全线程的缩放系数</text>

    <!-- numerator 卡（state 下方一行两列） -->
    <text :x="STATE_X" y="234" font-size="10" font-weight="700" fill="var(--ej-c)">numerator（全线程更新）</text>
    <g v-for="d in TIDS" :key="`num-${d}`">
      <rect :x="STATE_X + d * (CARD_W + 10)" :y="NUM_Y" :width="CARD_W" :height="NUM_H" rx="8"
        :fill="numerE() > 0.05 || props.step >= 4 ? 'var(--ej-c-soft)' : 'var(--ej-surface)'"
        :stroke="numerE() > 0.05 || props.step >= 4 ? 'var(--ej-c)' : 'var(--ej-line-strong)'" stroke-width="1.2"
      />
      <text :x="STATE_X + d * (CARD_W + 10) + 12" :y="NUM_Y + 16" font-size="9" fill="var(--ej-ink-faint)">a[{{ d }}]</text>
      <text :x="STATE_X + d * (CARD_W + 10) + CARD_W - 12" :y="NUM_Y + NUM_H / 2 + 6" text-anchor="end" dominant-baseline="central" font-size="13" font-weight="700" fill="var(--ej-ink)">
        {{ state.a[d].toFixed(4) }}
      </text>
    </g>

    <!-- 屏障标记 -->
    <g v-if="currentKey() !== null">
      <text x="360" y="304" text-anchor="middle" font-size="10" :font-weight="phase!.barrier2 > 0.5 ? 700 : 400" :fill="phase!.barrier2 > 0.5 ? 'var(--ej-active)' : 'var(--ej-ink-faint)'">
        {{ phase!.barrier2 > 0.5 ? '屏障 ②：防止下一轮覆盖系数' : phase!.broadcast > 0.5 ? '屏障 ①：广播 α、β' : '__syncthreads()' }}
      </text>
    </g>

    <!-- 输出（step 4） -->
    <g v-if="props.step === 4" :opacity="outputE">
      <rect x="48" y="312" width="322" height="42" rx="9" fill="var(--ej-c-soft)" stroke="var(--ej-c)" stroke-width="1.3" />
      <text x="209" y="333" text-anchor="middle" dominant-baseline="central" font-size="12.5" font-weight="700" fill="var(--ej-c)">
        O = a / l = [{{ OUTPUT[0].toFixed(4) }}, {{ OUTPUT[1].toFixed(4) }}]
      </text>
      <text x="48" y="372" font-size="10" fill="var(--ej-ink-soft)">扫描完全部 key 后，用累计分母 l 对每个输出分量归一化。</text>
    </g>

    <!-- 同步计数器 -->
    <g>
      <rect x="580" y="308" width="116" height="34" rx="8" fill="var(--ej-panel)" stroke="var(--ej-line-strong)" stroke-width="1.1" />
      <text x="638" y="320" text-anchor="middle" font-size="9" fill="var(--ej-ink-soft)">广播 / 复用屏障</text>
      <text x="638" y="334" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="700" fill="var(--ej-ink)">{{ syncCount }} 次</text>
    </g>

    <text x="360" y="406" text-anchor="middle" font-size="11" fill="var(--ej-ink-soft)">{{ captions[Math.min(props.step, captions.length - 1)] }}</text>
    <text x="708" y="18" text-anchor="end" font-size="9" fill="var(--ej-ink-faint)">D=2 → 2 线程教学缩略 · 真实 block=256, D=64</text>

    </g>

    <!-- 实测（step 5）：隐藏前一场景，避免转场时两套文字叠加。 -->
    <g v-if="props.step === 5" :opacity="perfE">
      <rect x="0" y="0" width="720" height="430" fill="var(--ej-surface)" />
      <text x="360" y="72" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="700" fill="var(--ej-ink)">
        少写回 ≠ 更快 · 9070 XT 实测（S=128, D=64）
      </text>
      <g v-for="(row, index) in [
          { name: 'hip-materialized', ms: '0.0586 ms', note: '3 次 dispatch，物化 Scores/P', active: false },
          { name: 'hip-online', ms: '0.2274 ms', note: '1 次 dispatch，每 key 多次 block 同步', active: true }
        ]" :key="`pm-${index}`">
        <rect x="120" :y="104 + index * 72" width="480" height="58" rx="10"
          :fill="row.active ? 'var(--ej-b-soft)' : 'var(--ej-panel)'"
          :stroke="row.active ? 'var(--ej-b)' : 'var(--ej-line)'" stroke-width="1.2" />
        <text x="142" :y="126 + index * 72" font-size="12" :font-family="MONO" font-weight="600" :fill="row.active ? 'var(--ej-b)' : 'var(--ej-ink)'">{{ row.name }}</text>
        <text x="142" :y="144 + index * 72" font-size="10" fill="var(--ej-ink-soft)">{{ row.note }}</text>
        <text x="576" :y="133 + index * 72" text-anchor="end" dominant-baseline="central" font-size="16" font-weight="700" :fill="row.active ? 'var(--ej-b)' : 'var(--ej-ink-soft)'">{{ row.ms }}</text>
      </g>
      <text x="360" y="272" text-anchor="middle" font-size="11" fill="var(--ej-ink-soft)">
        online 约为物化的 3.9 倍——同步成本压过了省下的写回；Triton 分块在线版 0.0174 ms 更快
      </text>
      <text x="360" y="296" text-anchor="middle" font-size="9.5" fill="var(--ej-ink-faint)">
        历史实验数据（2026-07-19）· 同步修正版见 12.6 与 sync-fix 记录
      </text>
    </g>
  </g>
</template>
