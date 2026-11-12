<script setup lang="ts">
/**
 * 2-4 探索一「峰值带宽：拷贝测试」（关卡自己的 scenes，不用登记组件）：拷贝要够大，量到的才是显存的速度。
 *
 * 旋钮选每块缓冲区多大（64 KiB 到 512 MiB，默认 64 KiB：Notebook 里那次小拷贝）。第一根条是一次拷贝的时间，
 * 分成固定开销（示意值）和按峰值带宽搬一遍的时间；第二根条是量到的有效带宽占峰值带宽的几成。
 * 两块缓冲区一起装得进本书那张卡的 L2 或 Infinity Cache 时写明：真卡上读写的可能是缓存，这张图不算缓存快多少。
 * 峰值用 usePeak（你的卡 → 档案馆 → 标称）；数在 roofline.ts（copyCase、COPY_EXPONENTS、COPY_OVERHEAD_MS）。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { bytesText } from '../../trusted-timing/timing.ts'
import { COPY_EXPONENTS, COPY_EXPONENT_DEFAULT, COPY_OVERHEAD_MS, copyCase, msText, percentText, powerText, sig } from '../roofline.ts'
import PeakSource from './PeakSource.vue'
import { usePeak } from './usePeak.ts'

const titleId = `${useId()}-title`
const { card, mine, peak, showReference } = usePeak()

const OPTIONS = COPY_EXPONENTS.map((e) => ({ value: e, label: bytesText(4 * 2 ** e) }))
const OVERHEAD = msText(COPY_OVERHEAD_MS)

const exponent = ref<number>(COPY_EXPONENT_DEFAULT)
const copy = computed(() => copyCase(exponent.value, peak.value))

/** 条上的一段占几成：太短的那段至少留 1%，看得见。 */
const share = (part: number, whole: number) => Math.min(100, Math.max(1, (part / whole) * 100))
const overheadPct = computed(() => share(copy.value.overheadMs, copy.value.ms))
const movePct = computed(() => share(copy.value.transferMs, copy.value.ms))
const ratePct = computed(() => share(copy.value.gbps, peak.value.gbps))

const cacheText = computed(() => {
  const c = copy.value
  return c.cache
    ? `两块一共 ${bytesText(c.moved)}，装得进 ${c.cache.label}（${c.cache.text}）：真卡上读写的可能是缓存。`
    : `两块一共 ${bytesText(c.moved)}，L2 和 Infinity Cache 都装不下：读写都在显存。`
})

const readout = computed(() => {
  const c = copy.value
  const verdict = c.ofPeak >= 0.9 && !c.cache
    ? '固定开销摊开了，数据也装不进缓存：量到的就是显存的速度。'
    : c.cache
      ? '量到的不全是显存的速度。'
      : '固定开销还占着一截，离峰值还远。'
  return `每块 ${powerText(c.exponent)} 个数（${bytesText(c.bytes)}）：按峰值带宽搬一遍要 ${msText(c.transferMs)}，`
    + `加上 ${OVERHEAD} 的固定开销，量到 ${sig(c.gbps)} GB/s，是峰值带宽的 ${percentText(c.ofPeak)}。${verdict}`
})
</script>

<template>
  <section class="cs" :aria-labelledby="titleId">
    <header class="cs__head">
      <span class="cs__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="cs__title">拷贝多大才量得到峰值</strong>
      <span class="cs__tag">示意图</span>
    </header>
    <PeakSource :peak="peak" :card="card" :has-mine="!!mine" @toggle="showReference = !showReference" />
    <p class="cs__rules">拷贝读一遍、写一遍，搬的字节数是一块缓冲区的两倍。每次拷贝另有 {{ OVERHEAD }} 的固定开销（示意值）。</p>

    <div class="cs__knobs">
      <Knob label="每块缓冲区" code="src" :options="OPTIONS" v-model="exponent" />
    </div>

    <div class="cs__bars" role="img" :aria-label="readout">
      <div class="cs__line">
        <span class="cs__name">一次拷贝</span>
        <span class="cs__value">{{ msText(copy.ms) }}</span>
      </div>
      <div class="cs__track">
        <span class="cs__seg is-overhead" :style="{ width: `${overheadPct}%` }" />
        <span class="cs__seg is-move" :style="{ width: `${movePct}%` }" />
      </div>
      <ul class="cs__legend">
        <li class="is-overhead">固定开销 {{ OVERHEAD }}</li>
        <li class="is-move">搬数据 {{ msText(copy.transferMs) }}</li>
      </ul>
      <div class="cs__line">
        <span class="cs__name">量到的有效带宽</span>
        <span class="cs__value">{{ sig(copy.gbps) }} GB/s · 峰值的 {{ percentText(copy.ofPeak) }}</span>
      </div>
      <div class="cs__track">
        <span class="cs__seg is-rate" :style="{ width: `${ratePct}%` }" />
      </div>
    </div>

    <p class="cs__cache" :class="copy.cache ? 'is-in' : 'is-out'">
      <span class="cs__badge">{{ copy.cache ? '缓存装得下' : '缓存装不下' }}</span>{{ cacheText }}
    </p>
    <p class="cs__readout" aria-live="polite">{{ readout }}</p>
    <p class="cs__verdict">拷贝要够大：固定开销摊得开，数据装不进缓存，量到的才是显存的速度。</p>
    <p class="cs__note">固定开销是示意值；缓存只看装不装得下，按本书那张卡的 L2 和 Infinity Cache 算，没算缓存快多少。</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同 2-3 的场景。 */
.cs {
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

.cs__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.cs__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.cs__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.cs__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.cs__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.cs__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 两根条：一次拷贝的时间、量到的有效带宽 ---------- */

.cs__bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cs__line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0 10px;
  font-size: 14px;
}

.cs__line:not(:first-child) {
  margin-top: 8px;
}

.cs__name {
  color: var(--hg-ink-2);
}

.cs__value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.cs__track {
  display: flex;
  height: 16px;
  overflow: hidden;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
}

.cs__seg {
  height: 100%;
  transition: width var(--motion-fast) var(--motion-ease-out);
}

/* 固定开销：斜纹，和搬数据分得开，不只靠颜色。 */
.cs__seg.is-overhead {
  background: repeating-linear-gradient(135deg, var(--hg-idle) 0 4px, transparent 4px 8px);
  box-shadow: inset 0 0 0 var(--hg-border-width) var(--hg-idle);
}

.cs__seg.is-move,
.cs__seg.is-rate {
  background: var(--hg-accent);
}

.cs__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--hg-ink-2);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.cs__legend li::before {
  content: '';
  display: inline-block;
  width: 12px;
  height: 10px;
  margin-right: 6px;
  border-radius: 2px;
  vertical-align: -1px;
}

.cs__legend .is-overhead::before {
  background: repeating-linear-gradient(135deg, var(--hg-idle) 0 3px, transparent 3px 6px);
  box-shadow: inset 0 0 0 var(--hg-border-width) var(--hg-idle);
}

.cs__legend .is-move::before {
  background: var(--hg-accent);
}

/* ---------- 缓存装不装得下：字写着，不只靠颜色 ---------- */

.cs__cache {
  margin: 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.cs__badge {
  display: inline-block;
  margin-right: 8px;
  padding: 0 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.cs__cache.is-in .cs__badge {
  border-color: transparent;
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

/* ---------- 解读 ---------- */

.cs__readout {
  min-height: 4.8em;
  margin: 0;
  font-size: 15px;
}

.cs__verdict {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.cs__note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

@media (max-width: 480px) {
  .cs {
    padding: 16px;
  }
}
</style>
