<script setup lang="ts">
/**
 * 2-3 探索二「预热与波动」（关卡自己的 scenes，不用登记组件）：噪声模拟器，同一个加法测两轮，比只测一次和测很多次取统计。
 *
 * 旋钮选噪声大小、预热不预热、每轮计时几次；「换一组随机数」把种子加 1，「恢复默认」把四样都放回 NOISE_DEFAULT（能跑但不好）。
 * 换旋钮不换种子，前后比的是同一组随机数。样本全是模拟的，不是实测。
 * 中间两条是两轮的样本，一个点一个样本：横轴固定 0.9–2.0 ms，超出右边的贴在右头、画成 ›；点的上下位置只按先后错开，不表示什么。
 * 浅底是 p10 到 p90，实线是中位数，虚线是平均数，琥珀色的空心圈套住第一个样本（只测一次，测到的就是它）。
 * 下面是两轮的统计表和解读。样本和统计在 timing.ts（noiseLab，分位数的算法同 hg.bench），两轮差多少用 relativeGap。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import {
  BASE_MS,
  FIRST_CALL_EXTRA_MS,
  NOISE_DEFAULT,
  NOISE_LEVELS,
  REPEAT_OPTIONS,
  WARMUP_CALLS,
  noiseLab,
  relativeGap,
  type NoiseLevel,
  type RunStats,
} from '../timing.ts'

const titleId = `${useId()}-title`

const LEVEL_OPTIONS = NOISE_LEVELS.map((l) => ({ value: l.id, label: l.label }))
const REPEAT_KNOB = REPEAT_OPTIONS.map((r) => ({ value: r, label: String(r) }))
const REPEAT_MAX = Math.max(...REPEAT_OPTIONS)
const WARMUP_ON = `先预热 ${WARMUP_CALLS} 次`

const level = ref<NoiseLevel>(NOISE_DEFAULT.level)
const warmup = ref(NOISE_DEFAULT.warmup)
const repeat = ref(NOISE_DEFAULT.repeat)
const seed = ref(NOISE_DEFAULT.seed)
const runs = computed(() => noiseLab({ level: level.value, warmup: warmup.value, repeat: repeat.value, seed: seed.value }))

function reroll() {
  seed.value += 1
}

function reset() {
  level.value = NOISE_DEFAULT.level
  warmup.value = NOISE_DEFAULT.warmup
  repeat.value = NOISE_DEFAULT.repeat
  seed.value = NOISE_DEFAULT.seed
}

// ── 两条横轴 ──
/** 横轴的两头（毫秒），换旋钮时不变：加法本身 1 ms，样本差不多都落在里面；没预热的第一次调用超出右边。 */
const AXIS = { min: 0.9, max: 2.0 }
/** 一个耗时在横轴上的位置（0 到 100），超出两头的贴在头上。 */
const pos = (x: number) => Math.min(Math.max((x - AXIS.min) / (AXIS.max - AXIS.min), 0), 1) * 100
const TICKS = [1, 1.5, 2].map((x) => ({ text: `${x.toFixed(1)} ms`, left: `${pos(x)}%`, end: x >= AXIS.max }))
/** 第 i 个样本的点离横轴顶上几 px：按先后错开（29 行轮一遍），点不叠成一条线。 */
const dotTop = (i: number) => 6 + ((i * 37) % 29)
const RUN_NAMES = ['第一轮', '第二轮'] as const
/** 每轮计时最多的那一档（300 次）：点小一点、淡一点，叠在一起也看得出疏密。 */
const dense = computed(() => repeat.value >= REPEAT_MAX)
const f = (x: number) => x.toFixed(3)

const strips = computed(() => runs.value.map((r, k) => ({
  name: RUN_NAMES[k],
  label: `${RUN_NAMES[k]}，${repeat.value} 个样本：第一个样本 ${f(r.first)} ms，平均数 ${f(r.mean)} ms，中位数 ${f(r.median)} ms，p10 ${f(r.p10)} ms，p90 ${f(r.p90)} ms。`,
  band: { left: `${pos(r.p10)}%`, width: `${pos(r.p90) - pos(r.p10)}%` },
  dots: r.samples.map((x, i) => ({ off: x > AXIS.max, style: { left: `${pos(x)}%`, top: `${dotTop(i)}px` } })),
  mean: { left: `${pos(r.mean)}%` },
  median: { left: `${pos(r.median)}%` },
})))

// ── 统计表 ──
const ROWS: { label: string; key: Exclude<keyof RunStats, 'samples'>; digits: number }[] = [
  { label: '只测一次（第一个样本）', key: 'first', digits: 3 },
  { label: '平均数', key: 'mean', digits: 3 },
  { label: '中位数', key: 'median', digits: 3 },
  { label: 'p10', key: 'p10', digits: 3 },
  { label: 'p90', key: 'p90', digits: 3 },
  { label: 'p10 ÷ p90', key: 'spread', digits: 2 },
]
const table = computed(() => ROWS.map((row) => ({ ...row, values: runs.value.map((r) => r[row.key].toFixed(row.digits)) })))

// ── 解读 ──
/** 百分比：不到 1% 留两位小数，不到 10% 留一位，再大取整。 */
function pct(x: number): string {
  const v = x * 100
  return `${v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : v.toFixed(0)}%`
}
/** 几倍：两位有效数字，末尾的 0 不写（3.0 写成 3）。 */
const times = (x: number) => String(Number(x.toPrecision(2)))

/** 第二句：没预热，先说第一次调用的开销；预热了，看中位数是不是比单个样本稳。 */
function whyText(a: RunStats, gapFirst: number, gapMed: number): string {
  if (!warmup.value) {
    return `第一轮没预热：第一个样本是中位数的 ${times(a.first / a.median)} 倍，把平均数拉到 ${f(a.mean)} ms，中位数还是 ${f(a.median)} ms。`
  }
  if (gapMed < gapFirst / 2) return '中位数比单个样本稳得多。换一组随机数再看：单个样本跳来跳去，中位数几乎不动。'
  if (repeat.value < REPEAT_MAX) return `只测 ${repeat.value} 次，中位数也还在晃。把每轮计时次数调大，两轮的中位数会挨得更近。`
  return '这组随机数里，两轮的第一个样本碰巧挨得很近。换一组随机数再看：单个样本跳来跳去，中位数几乎不动。'
}

const readout = computed(() => {
  const [a, b] = runs.value
  const gapFirst = relativeGap(a.first, b.first)
  const gapMed = relativeGap(a.median, b.median)
  return [
    `只测一次：两轮的第一个样本差 ${pct(gapFirst)}。测 ${repeat.value} 次取中位数：两轮差 ${pct(gapMed)}。`,
    whyText(a, gapFirst, gapMed),
    `p10 ÷ p90：第一轮 ${a.spread.toFixed(2)}，第二轮 ${b.spread.toFixed(2)}；越接近 1 越稳，挑战的 ★2 要它不小于 0.9。`,
  ]
})
</script>

<template>
  <section class="nl" :aria-labelledby="titleId">
    <header class="nl__head">
      <span class="nl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="nl__title">噪声模拟器</strong>
      <span class="nl__tag">模拟</span>
    </header>
    <p class="nl__rules">
      同一个加法测两轮。这是模拟：加法本身设成 {{ BASE_MS }} ms，每次计时再加上随机噪声，多数只慢一点，偶尔慢一截。不预热时，第一次调用另外多花 {{ FIRST_CALL_EXTRA_MS }} ms。
    </p>

    <div class="nl__knobs">
      <Knob label="噪声" :options="LEVEL_OPTIONS" v-model="level" />
      <Knob label="预热" mode="switch" :on="WARMUP_ON" off="不预热" v-model="warmup" />
      <Knob label="每轮计时" :options="REPEAT_KNOB" unit=" 次" v-model="repeat" />
    </div>
    <div class="nl__actions">
      <button type="button" class="nl__button" @click="reroll">换一组随机数</button>
      <button type="button" class="nl__button" @click="reset">恢复默认</button>
    </div>

    <div class="nl__strips" :class="{ 'is-dense': dense }">
      <div v-for="s in strips" :key="s.name" class="nl__row">
        <span class="nl__run" aria-hidden="true">{{ s.name }}</span>
        <div class="nl__track" role="img" :aria-label="s.label">
          <span class="nl__band" :style="s.band" />
          <span
            v-for="(d, i) in s.dots"
            :key="i"
            class="nl__dot"
            :class="{ 'is-off': d.off, 'is-first': i === 0 }"
            :style="d.style"
          >{{ d.off ? '›' : '' }}</span>
          <span class="nl__mark is-mean" :style="s.mean" />
          <span class="nl__mark is-median" :style="s.median" />
        </div>
      </div>
      <div class="nl__axis" aria-hidden="true">
        <span class="nl__axis-note">（模拟）</span>
        <div class="nl__ticks">
          <span v-for="t in TICKS" :key="t.text" class="nl__tick" :class="{ 'is-end': t.end }" :style="{ left: t.left }">{{ t.text }}</span>
        </div>
      </div>
    </div>

    <table class="nl__table">
      <caption>两轮的统计（毫秒，模拟）</caption>
      <thead>
        <tr>
          <th scope="col" />
          <th v-for="name in RUN_NAMES" :key="name" scope="col">{{ name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in table" :key="row.key" :class="{ 'is-median': row.key === 'median' }">
          <th scope="row">{{ row.label }}</th>
          <td v-for="(value, k) in row.values" :key="k">{{ value }}</td>
        </tr>
      </tbody>
    </table>

    <p class="nl__readout" aria-live="polite">
      <span v-for="(line, i) in readout" :key="i">{{ line }}</span>
    </p>

    <ul class="nl__legend" aria-label="图例">
      <li><span class="nl__sw is-dot" aria-hidden="true" />一个样本</li>
      <li><span class="nl__sw is-first" aria-hidden="true" />只测一次时测到的：第一个样本</li>
      <li><span class="nl__sw is-median" aria-hidden="true" />中位数</li>
      <li><span class="nl__sw is-mean" aria-hidden="true" />平均数</li>
      <li><span class="nl__sw is-band" aria-hidden="true" />p10 到 p90：中间八成样本</li>
      <li><span class="nl__sw is-off" aria-hidden="true">›</span>超出右边的样本</li>
    </ul>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同 2-2 的场景。 */
.nl {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 20px 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.nl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.nl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.nl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.nl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.nl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.nl__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* 两个按钮同 2-1 GpuSource 的次要按钮。 */
.nl__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.nl__button {
  min-height: 34px;
  padding: 0 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-instant) var(--motion-ease-out);
}

.nl__button:hover {
  border-color: var(--hg-accent);
}

.nl__button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* ---------- 两轮的样本：一个点一个样本，横轴固定 ---------- */

.nl__strips {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

/* 两条横轴和刻度共用一套列宽，刻度才对得上；4.5em 按 .nl__strips 的字号算，这两行自己不改字号。 */
.nl__row,
.nl__axis {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 8px;
}

.nl__row {
  align-items: center;
}

.nl__run {
  color: var(--hg-ink-2);
  font-weight: 700;
}

.nl__track {
  position: relative;
  isolation: isolate;
  height: 48px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
}

/* p10 到 p90：中间八成样本，浅底加两条边线。 */
.nl__band {
  position: absolute;
  top: 0;
  bottom: 0;
  box-sizing: border-box;
  border-right: 1px solid var(--hg-accent-ink);
  border-left: 1px solid var(--hg-accent-ink);
  background: var(--hg-accent-soft);
}

/* 一个样本：点画在 ::before 上（半透明），第一个样本的圈画在 ::after 上，不跟着变淡。 */
.nl__dot {
  position: absolute;
  width: 7px;
  height: 7px;
  transform: translateX(-50%);
}

.nl__dot::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--hg-ink-3);
  opacity: 0.6;
}

.nl__strips.is-dense .nl__dot {
  width: 5px;
  height: 5px;
}

.nl__strips.is-dense .nl__dot::before {
  opacity: 0.35;
}

/* 超出右边的样本：贴在右头，画成琥珀色的 ›。 */
.nl__dot.is-off {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--hg-amber-ink);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}

.nl__dot.is-off::before {
  content: none;
}

/* 第一个样本（只测一次，测到的就是它）：琥珀色的空心圈，压在别的点和竖线上面。 */
.nl__dot.is-first {
  z-index: 1;
}

.nl__dot.is-first::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  box-sizing: border-box;
  width: 13px;
  height: 13px;
  border: 2px solid var(--hg-amber-ink);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

/* 中位数实线，平均数虚线：不只靠颜色分。 */
.nl__mark {
  position: absolute;
  top: 0;
  bottom: 0;
  transform: translateX(-50%);
}

.nl__mark.is-median {
  border-left: 2px solid var(--hg-ink);
}

.nl__mark.is-mean {
  border-left: 2px dashed var(--hg-ink-2);
}

/* 刻度贴着第二条横轴的下沿：抵掉 .nl__strips 的行距。 */
.nl__axis {
  align-items: start;
  margin-top: -6px;
  color: var(--hg-ink-3);
}

.nl__axis-note {
  padding-top: 5px;
  font-size: 12px;
  line-height: 16px;
}

.nl__ticks {
  position: relative;
  height: 22px;
}

.nl__tick {
  position: absolute;
  top: 0;
  padding-top: 5px;
  font-family: var(--hg-font-mono);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  transform: translateX(-50%);
}

.nl__tick::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  width: 1px;
  height: 4px;
  background: var(--hg-border-strong);
}

/* 最右的刻度靠右对齐，不伸出横轴。 */
.nl__tick.is-end {
  transform: translateX(-100%);
}

.nl__tick.is-end::before {
  right: 0;
  left: auto;
}

/* ---------- 统计表 ---------- */

.nl__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 13px;
}

.nl__table caption {
  margin-bottom: 6px;
  color: var(--hg-ink-2);
  font-size: 13px;
  text-align: left;
}

.nl__table th,
.nl__table td {
  padding: 4px 8px;
  border: var(--hg-border-width) solid var(--hg-border);
  background: transparent;
  text-align: left;
}

.nl__table tbody th {
  font-weight: 400;
}

/* 数字等宽、靠右，小数点上下对齐；行名可以折行，数字不折。 */
.nl__table thead th,
.nl__table td {
  text-align: right;
  white-space: nowrap;
}

.nl__table td {
  font-family: var(--hg-font-mono);
}

/* 中位数是要记下来的那个数，整行加粗。 */
.nl__table tr.is-median th,
.nl__table tr.is-median td {
  font-weight: 700;
}

/* ---------- 解读、图例 ---------- */

.nl__readout {
  margin: 0;
  font-size: 15px;
}

.nl__readout span {
  display: block;
}

/* 第一句是结论：只测一次和取中位数，两轮各差多少。 */
.nl__readout span:first-child {
  font-weight: 600;
}

.nl__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.nl__legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nl__sw {
  display: inline-block;
  flex: none;
  box-sizing: border-box;
}

.nl__sw.is-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--hg-ink-3);
  opacity: 0.6;
}

.nl__sw.is-first {
  width: 13px;
  height: 13px;
  border: 2px solid var(--hg-amber-ink);
  border-radius: 50%;
}

.nl__sw.is-median,
.nl__sw.is-mean {
  width: 2px;
  height: 16px;
}

.nl__sw.is-median {
  border-left: 2px solid var(--hg-ink);
}

.nl__sw.is-mean {
  border-left: 2px dashed var(--hg-ink-2);
}

.nl__sw.is-band {
  width: 14px;
  height: 10px;
  border-right: 1px solid var(--hg-accent-ink);
  border-left: 1px solid var(--hg-accent-ink);
  background: var(--hg-accent-soft);
}

.nl__sw.is-off {
  color: var(--hg-amber-ink);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}

@media (prefers-reduced-motion: reduce) {
  .nl__button {
    transition: none;
  }
}
</style>
