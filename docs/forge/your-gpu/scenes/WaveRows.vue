<script setup lang="ts">
/**
 * 2-1 探索二「wave 多大」（关卡自己的 scenes，不用登记组件）：同一组线程，在 wave 32 和 wave 64 的卡上各排成几个 wave。
 *
 * 旋钮选每组线程数（默认 96：32 个一队正好 3 个 wave，64 个一队第二个空一半）。两种卡上下两行，一格一个 lane：
 * 坐了线程的实心，空着的虚线框。导入了 GPU 卡片时，wave 大小和你的卡一样的那一行标「你的卡」（useGpu）。
 * 每行一句解读，最下面一句两种卡放在一起的结论（readings.ts 的 waveText、waveVerdict）。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { useGpu } from './useGpu.ts'
import { THREAD_DEFAULT, THREAD_OPTIONS, WAVE_KINDS, waveSplit, waveText, waveVerdict } from '../readings.ts'

const titleId = `${useId()}-title`
const { card } = useGpu()

const OPTIONS = [...THREAD_OPTIONS]
const threads = ref<number>(THREAD_DEFAULT)

const rows = computed(() => WAVE_KINDS.map((kind) => {
  const split = waveSplit(threads.value, kind.wave)
  return {
    ...kind,
    text: waveText(split),
    mine: card.value?.wave === kind.wave,
    /** 每个 wave 坐了几个线程：前面的坐满，最后一个可能坐不满。 */
    seats: Array.from({ length: split.waves }, (_, i) => (i === split.waves - 1 ? split.last : kind.wave)),
  }
}))
const verdict = computed(() => waveVerdict(threads.value))
</script>

<template>
  <section class="wr" :aria-labelledby="titleId">
    <header class="wr__head">
      <span class="wr__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="wr__title">同一组线程，两种 wave</strong>
      <span class="wr__tag">示意图</span>
    </header>
    <p class="wr__rules">一格是一个 lane。坐了线程的涂满，空着的只有虚线框：空着的 lane 也要陪整个 wave 走完每一步。</p>

    <div class="wr__knobs">
      <Knob label="每组线程数" code="blockDim.x" :options="OPTIONS" unit=" 个" v-model="threads" />
    </div>

    <div v-for="row in rows" :key="row.wave" class="wr__row" :class="{ 'is-mine': row.mine }">
      <p class="wr__label">
        <strong>wave {{ row.wave }}</strong>
        <span>{{ row.arch }} 架构的 {{ row.cards }}</span>
        <span v-if="row.mine" class="wr__mine">你的卡</span>
      </p>
      <div class="wr__waves" role="img" :aria-label="`wave ${row.wave}，${row.arch} 架构：${row.text}`">
        <span v-for="(seated, i) in row.seats" :key="i" class="wr__wave">
          <span v-for="j in row.wave" :key="j" class="wr__lane" :class="{ 'is-idle': j > seated }" />
        </span>
      </div>
      <p class="wr__text">{{ row.text }}</p>
    </div>

    <p class="wr__readout" aria-live="polite">{{ verdict }}</p>

    <ul class="wr__legend" aria-label="图例">
      <li><span class="wr__sw" aria-hidden="true" />坐了线程的 lane</li>
      <li><span class="wr__sw is-idle" aria-hidden="true" />空着的 lane</li>
    </ul>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同探索一（CuCount）。 */
.wr {
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

.wr__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.wr__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.wr__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.wr__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.wr__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.wr__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 一种 wave 一行；你的卡那一行实线框、强调色浅底 ---------- */

.wr__row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.wr__row.is-mine {
  border-style: solid;
  background: var(--hg-accent-soft);
}

.wr__label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  margin: 0;
  font-size: 14px;
}

.wr__label strong {
  font-family: var(--hg-font-mono);
}

.wr__mine {
  padding: 0 8px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-accent-ink);
  font-size: 12px;
  font-weight: 700;
}

.wr__waves {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 一个 wave：16 格一行，32 个 lane 两行、64 个四行；窄屏一行放两个 wave。 */
.wr__wave {
  display: grid;
  grid-template-columns: repeat(16, 6px);
  gap: 1px;
  padding: 3px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface);
}

.wr__lane {
  height: 6px;
  border-radius: 1px;
  background: var(--hg-accent);
  transition: background-color var(--motion-fast) var(--motion-ease-out);
}

.wr__lane.is-idle {
  outline: 1px dashed var(--hg-ink-3);
  outline-offset: -1px;
  background: transparent;
}

.wr__text {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.wr__readout {
  min-height: 1.6em;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.wr__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.wr__legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wr__sw {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--hg-accent);
}

.wr__sw.is-idle {
  outline: 1px dashed var(--hg-ink-3);
  outline-offset: -1px;
  background: transparent;
}
</style>
