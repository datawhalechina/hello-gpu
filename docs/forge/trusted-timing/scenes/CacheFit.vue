<script setup lang="ts">
/**
 * 2-3 探索三「缓存冷热」（关卡自己的 scenes，不用登记组件）：加法的三个数组装不装得进本书那张卡的缓存，
 * 热缓存、冷缓存那一次各从哪读。
 *
 * 旋钮选数组长度 n = 2^k（默认 2²⁶，Notebook 挑战一开始的长度）。四根条画在同一把尺子上（512 KiB 到 1 GiB，
 * 按 2 的幂画，一格翻一倍）：三个数组、L2、Infinity Cache、冷缓存前读一遍的缓冲区。竖虚线是三个数组画到的地方，
 * 落在缓存条里面就装得下那一级，条上面也写着 ✓ / ✗。下面两行是热缓存、冷缓存那一次从哪读。
 * 示意图：读的地方按装不装得下推断，不是实测。数在 timing.ts（cacheCase、bookCaches、bytesText、rulerPercent、
 * FLUSH_BYTES、RULER），缓存大小出自 hardware.json。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import {
  CACHE_EXPONENTS, CACHE_EXPONENT_DEFAULT, FLUSH_BYTES, RULER,
  bookCaches, bytesText, cacheCase, rulerPercent, type CacheKey, type CacheLevel,
} from '../timing.ts'

const titleId = `${useId()}-title`
const HW_NAME = HARDWARE_DEVICES[DEFAULT_DEVICE_ID].name

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
/** 指数写成上标：26 → ²⁶。 */
const sup = (k: number) => String(k).split('').map((d) => SUP[Number(d)]).join('')
const OPTIONS = CACHE_EXPONENTS.map((e) => ({ value: e, label: `2${sup(e)}` }))

const caches = bookCaches()
/** 本书那张卡的一级缓存。下面的句子按 L2、Infinity Cache 两级写，hardware.json 里查不到就直接报错。 */
function cacheLevel(key: CacheKey): CacheLevel {
  const level = caches.find((c) => c.key === key)
  if (!level) throw new Error(`hardware.json 里查不到本书那张卡的缓存（${key}）`)
  return level
}
const l2 = cacheLevel('l2')
const ic = cacheLevel('infinity')

const exponent = ref<number>(CACHE_EXPONENT_DEFAULT)
const fit = computed(() => cacheCase(exponent.value, caches))
/** 三个数组画到尺子的哪里：强调色那根条的头，四根条上的竖虚线也在这。 */
const dataPct = computed(() => rulerPercent(fit.value.bytes))

interface Bar {
  key: string
  kind: 'data' | 'cache' | 'flush'
  name: string
  value: string
  /** 条画到尺子的百分之几。 */
  pct: number
  /** 缓存那两根条：三个数组装不装得下（恰好装满也算）。 */
  fits?: boolean
}

const bars = computed<Bar[]>(() => [
  { key: 'data', kind: 'data', name: '三个数组', value: bytesText(fit.value.bytes), pct: dataPct.value },
  ...[l2, ic].map((level): Bar => ({
    key: level.key,
    kind: 'cache',
    name: level.label,
    value: level.text,
    pct: rulerPercent(level.bytes),
    fits: fit.value.bytes <= level.bytes,
  })),
  { key: 'flush', kind: 'flush', name: '冷缓存前读一遍', value: bytesText(FLUSH_BYTES), pct: rulerPercent(FLUSH_BYTES) },
])

/** 尺子：一格翻一倍，格数是两头的指数差；两头写字节数。 */
const CELLS = RULER.toExp - RULER.fromExp
const AXIS_FROM = bytesText(2 ** RULER.fromExp)
const AXIS_TO = bytesText(2 ** RULER.toExp)

type Source = CacheKey | 'vram'
const SOURCE_NAME: Record<Source, string> = { l2: 'L2', infinity: 'Infinity Cache', vram: '显存' }
const WARM_TEXT: Record<Source, string> = {
  l2: '紧跟着上一次调用，三个数组都还在 L2 里。',
  infinity: '紧跟着上一次调用，装不进 L2，大多还在 Infinity Cache 里。',
  vram: '两级缓存都装不下，上一次读过的数早被挤出去了。',
}
const COLD_TEXT = `先读一遍 ${bytesText(FLUSH_BYTES)} 的缓冲区，缓存里换成了它的数。`

const FIT_TEXT: Record<Source, string> = {
  l2: `装得进 L2（${l2.text}）。热缓存从 L2 读，冷缓存从显存读，读的地方不一样。数据这么少，一次加法很短，差别可能被启动的开销和波动盖住。`,
  infinity: `装不进 L2（${l2.text}），装得进 Infinity Cache（${ic.text}）。热缓存大多从 Infinity Cache 读，冷缓存从显存读：冷热分得开。`,
  vram: '两级缓存都装不下。冷热都从显存读，差不多快：冷热分不开。',
}
const readout = computed(() =>
  `长度 2${sup(exponent.value)}（${fit.value.n} 个数）：三个数组一共 ${bytesText(fit.value.bytes)}，${FIT_TEXT[fit.value.warmFrom]}`)
</script>

<template>
  <section class="cf" :aria-labelledby="titleId">
    <header class="cf__head">
      <span class="cf__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="cf__title">装不装得进缓存</strong>
      <span class="cf__tag">示意图</span>
    </header>
    <p class="cf__rules">加法读 x、y，写 out，n 个数一共 12n 字节。条的长短按 2 的幂画，往右一格翻一倍；缓存是 {{ HW_NAME }} 的。</p>

    <div class="cf__knobs">
      <Knob label="数组长度" code="n" :options="OPTIONS" v-model="exponent" />
    </div>

    <div class="cf__bars" role="img" :aria-label="readout">
      <div v-for="bar in bars" :key="bar.key" class="cf__bar" :class="`is-${bar.kind}`">
        <div class="cf__line">
          <span class="cf__name">{{ bar.name }}</span>
          <span class="cf__value">{{ bar.value }}</span>
          <span v-if="bar.fits !== undefined" class="cf__fit" :class="bar.fits ? 'is-in' : 'is-out'">{{ bar.fits ? '✓ 装得下' : '✗ 装不下' }}</span>
        </div>
        <div class="cf__track">
          <span class="cf__fill" :style="{ width: `${bar.pct}%` }" />
          <span class="cf__guide" :style="{ left: `${dataPct}%` }" />
        </div>
      </div>
      <div class="cf__axis" :style="{ '--cf-cells': CELLS }">
        <span>{{ AXIS_FROM }}</span>
        <span>{{ AXIS_TO }}</span>
      </div>
    </div>

    <dl class="cf__reads">
      <div>
        <dt>热缓存那一次</dt>
        <dd><span class="cf__src" :class="`is-${fit.warmFrom}`">{{ SOURCE_NAME[fit.warmFrom] }}</span>{{ WARM_TEXT[fit.warmFrom] }}</dd>
      </div>
      <div>
        <dt>冷缓存那一次</dt>
        <dd><span class="cf__src" :class="`is-${fit.coldFrom}`">{{ SOURCE_NAME[fit.coldFrom] }}</span>{{ COLD_TEXT }}</dd>
      </div>
    </dl>

    <p class="cf__readout" aria-live="polite">{{ readout }}</p>
    <p class="cf__verdict">装得下，热缓存那一次才从缓存读；装不下，冷热都从显存读。</p>
    <p class="cf__note">缓存大小出自 AMD 产品页（Infinity Cache）和 ROCm 的 GPU 规格表（L2），你的卡可能不一样。</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同 2-2 的场景。 */
.cf {
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

.cf__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.cf__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.cf__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.cf__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.cf__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.cf__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 四根条：同一把尺子，按 2 的幂画 ---------- */

.cf__bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cf__bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cf__line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 8px;
  font-size: 13px;
}

.cf__name {
  color: var(--hg-ink-2);
}

.cf__bar.is-data .cf__name {
  color: var(--hg-ink);
  font-weight: 700;
}

.cf__value {
  font-variant-numeric: tabular-nums;
}

/* 装不装得下：✓ / ✗ 和字都写着，不只靠颜色。 */
.cf__fit {
  font-size: 12px;
  font-weight: 700;
}

.cf__fit.is-in {
  color: var(--hg-accent-ink);
}

.cf__fit.is-out {
  color: var(--hg-ink-3);
}

.cf__track {
  position: relative;
  height: 14px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
}

.cf__fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-ink-3);
}

.cf__bar.is-data .cf__fill {
  background: var(--hg-accent);
}

/* 冷缓存前读的缓冲区：斜纹加实线框，和缓存条分得开。 */
.cf__bar.is-flush .cf__fill {
  border: var(--hg-border-width) solid var(--hg-idle);
  background: repeating-linear-gradient(135deg, var(--hg-idle) 0 4px, transparent 4px 8px);
}

/* 竖虚线：三个数组画到的地方，四根条上同一个位置；落在缓存条里面就装得下。 */
.cf__guide {
  position: absolute;
  top: -3px;
  bottom: -3px;
  border-left: var(--hg-border-width) dashed var(--hg-accent-ink);
}

/* 尺子：一格一个刻度（格数 --cf-cells 由 RULER 算出），最右边补一个刻度。 */
.cf__axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-top: 7px;
  border-top: var(--hg-border-width) solid var(--hg-border-strong);
  background:
    linear-gradient(var(--hg-border-strong), var(--hg-border-strong)) right top / var(--hg-border-width) 5px no-repeat,
    repeating-linear-gradient(90deg, var(--hg-border-strong) 0 var(--hg-border-width), transparent var(--hg-border-width) calc(100% / var(--cf-cells))) left top / 100% 5px no-repeat;
  color: var(--hg-ink-3);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* ---------- 热缓存、冷缓存那一次从哪读 ---------- */

.cf__reads {
  display: grid;
  gap: 8px;
  margin: 0;
  font-size: 14px;
}

.cf__reads > div {
  display: grid;
  grid-template-columns: 6.5em minmax(0, 1fr);
  gap: 2px 10px;
  align-items: baseline;
}

.cf__reads dt {
  color: var(--hg-ink-2);
}

.cf__reads dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

/* 读的地方：缓存是强调色浅底，显存是灰底加边框；名字写在标签里，不只靠颜色。 */
.cf__src {
  display: inline-block;
  margin-right: 8px;
  padding: 0 8px;
  border: var(--hg-border-width) solid transparent;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.cf__src.is-vram {
  border-color: var(--hg-border-strong);
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
}

/* ---------- 解读 ---------- */

.cf__readout {
  min-height: 3.2em;
  margin: 0;
  font-size: 15px;
}

.cf__verdict {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.cf__note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

@media (max-width: 480px) {
  .cf__reads > div {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
