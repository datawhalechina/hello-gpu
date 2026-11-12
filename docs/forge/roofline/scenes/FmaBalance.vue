<script setup lang="ts">
/**
 * 2-4 探索二「峰值算力：FMA 测试」（关卡自己的 scenes，不用登记组件）：每个线程算得够多，量到的才是算力。
 *
 * 旋钮选每个线程做几次 FMA（1 到 4096，默认 1；4096 是 hg.peak() 的 16 条链 × 256 次）。线程数同 hg.peak()：2²³ 个，
 * 每个读两个数、写一个数。两根条是按峰值带宽搬数据、按峰值算力算各要多久，画在同一把尺子上（长的那根画满）；
 * 屋顶线的假设：两件事同时进行，长的那根说了算。第三根条是量到的算力占峰值算力的几成。
 * 峰值用 usePeak（你的卡 → 档案馆 → 标称）；数在 roofline.ts（fmaWork、balance、FMA_COUNTS、FMA_TEST）。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { bytesText } from '../../trusted-timing/timing.ts'
import { FMA_COUNTS, FMA_COUNT_DEFAULT, FMA_TEST, balance, countText, fmaWork, msText, percentText, powerText, sig } from '../roofline.ts'
import PeakSource from './PeakSource.vue'
import { usePeak } from './usePeak.ts'

const titleId = `${useId()}-title`
const { card, mine, peak, showReference } = usePeak()

const OPTIONS = FMA_COUNTS.map((value) => ({ value, label: String(value) }))
const THREADS = powerText(Math.log2(FMA_TEST.threads))

const count = ref<number>(FMA_COUNT_DEFAULT)
const run = computed(() => balance(peak.value, fmaWork(count.value)))
const memorySlower = computed(() => run.value.memoryMs >= run.value.computeMs)

/** 条上占几成：长的那根画满，短的按比例，至少留 1%。 */
const share = (part: number, whole: number) => Math.min(100, Math.max(1, (part / whole) * 100))

const bars = computed(() => [
  {
    key: 'memory',
    name: `搬数据：读写 ${bytesText(run.value.work.bytes)}`,
    text: msText(run.value.memoryMs),
    pct: share(run.value.memoryMs, run.value.ms),
    slow: memorySlower.value,
  },
  {
    key: 'compute',
    name: `算：${countText(run.value.work.flops)}次浮点运算`,
    text: msText(run.value.computeMs),
    pct: share(run.value.computeMs, run.value.ms),
    slow: !memorySlower.value,
  },
])
const ratePct = computed(() => share(run.value.tflops, peak.value.tflops))

const readout = computed(() => {
  const r = run.value
  const head = `每个线程 ${count.value} 次 FMA：算术强度 ${sig(r.intensity)} FLOP/字节。搬数据要 ${msText(r.memoryMs)}，算要 ${msText(r.computeMs)}。`
  return memorySlower.value
    ? `${head}搬的那件慢，量到的只有 ${sig(r.tflops)} TFLOPS，是峰值算力的 ${percentText(r.ofPeak)}：量的还是带宽，不是算力。`
    : `${head}算的那件慢，量到 ${sig(r.tflops)} TFLOPS，正好是峰值算力。`
})
</script>

<template>
  <section class="fb" :aria-labelledby="titleId">
    <header class="fb__head">
      <span class="fb__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="fb__title">算得够多，量到的才是算力</strong>
      <span class="fb__tag">示意图</span>
    </header>
    <PeakSource :peak="peak" :card="card" :has-mine="!!mine" @toggle="showReference = !showReference" />
    <p class="fb__rules">FMA 测试启动 {{ THREADS }} 个线程。每个线程读两个数、写一个数，一共 12 字节，中间做 m 次 FMA，一次记 2 次浮点运算。搬数据和算同时进行，慢的那件说了算。</p>

    <div class="fb__knobs">
      <Knob label="每个线程做几次 FMA" code="m" :options="OPTIONS" v-model="count" />
    </div>

    <div class="fb__bars" role="img" :aria-label="readout">
      <div v-for="bar in bars" :key="bar.key" class="fb__bar" :class="{ 'is-slow': bar.slow }">
        <div class="fb__line">
          <span class="fb__name">{{ bar.name }}</span>
          <span class="fb__value">{{ bar.text }}</span>
          <span v-if="bar.slow" class="fb__slow">慢的那件</span>
        </div>
        <div class="fb__track"><span class="fb__fill" :style="{ width: `${bar.pct}%` }" /></div>
      </div>
      <div class="fb__bar is-rate">
        <div class="fb__line">
          <span class="fb__name">量到的算力</span>
          <span class="fb__value">{{ sig(run.tflops) }} TFLOPS · 峰值算力的 {{ percentText(run.ofPeak) }}</span>
        </div>
        <div class="fb__track"><span class="fb__fill" :style="{ width: `${ratePct}%` }" /></div>
      </div>
    </div>

    <p class="fb__readout" aria-live="polite">{{ readout }}</p>
    <p class="fb__verdict">算的时间盖过搬数据的时间，量到的才是峰值算力。</p>
    <p class="fb__note">两件事完全重叠、各自跑满峰值，是屋顶线的假设；真卡上搬和算不一定叠得这么齐。</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同探索一和 2-3 的场景。 */
.fb {
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

.fb__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.fb__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.fb__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.fb__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.fb__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.fb__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 三根条：搬、算画在同一把尺子上，量到的算力按峰值算力画 ---------- */

.fb__bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fb__bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.fb__line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 10px;
  font-size: 14px;
}

.fb__name {
  color: var(--hg-ink-2);
}

.fb__value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* 慢的那件：字写着，不只靠颜色。 */
.fb__slow {
  padding: 0 8px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
  font-size: 12px;
  font-weight: 700;
}

.fb__track {
  height: 14px;
  overflow: hidden;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
}

.fb__fill {
  display: block;
  height: 100%;
  background: var(--hg-ink-3);
  transition: width var(--motion-fast) var(--motion-ease-out);
}

.fb__bar.is-slow .fb__fill,
.fb__bar.is-rate .fb__fill {
  background: var(--hg-accent);
}

.fb__bar.is-rate {
  padding-top: 10px;
  border-top: var(--hg-border-width) dashed var(--hg-border);
}

/* ---------- 解读 ---------- */

.fb__readout {
  min-height: 4.8em;
  margin: 0;
  font-size: 15px;
}

.fb__verdict {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.fb__note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

@media (max-width: 480px) {
  .fb {
    padding: 16px;
  }
}
</style>
