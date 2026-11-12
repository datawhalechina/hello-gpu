<script setup lang="ts">
/**
 * 2-1 探索一「CU 有几个」（关卡自己的 scenes，不用登记组件）：同一张卡，PyTorch、rocminfo、GPU 卡片各报一个数。
 *
 * 旋钮选「谁在数」，方格图把它数的东西描出来：一格一个计算单元；按 WGP 计数的卡两格一框（一个 WGP），PyTorch 数的是框。
 * 下面一句话说它数的是什么、全景图该填几（readings.ts 的 cuReading）。画哪张卡见 useGpu。
 * 方格只为数数，排法不是芯片的真实版图。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import GpuSource from './GpuSource.vue'
import { useGpu } from './useGpu.ts'
import { CU_SOURCES, cuReading, cusPerBox, type CuSource } from '../readings.ts'

const titleId = `${useId()}-title`
const { card, showBook, gpu } = useGpu()

const OPTIONS = CU_SOURCES.map(({ value, label }) => ({ value, label }))
const source = ref<CuSource>('torch')
const code = computed(() => CU_SOURCES.find((s) => s.value === source.value)?.code ?? '')
const reading = computed(() => cuReading(gpu.value, source.value))

/** 每一框几格：按 WGP 计数的卡两格一框（计算单元数是单数时最后一框只有一格），别的卡一格一框。 */
const perBox = computed(() => cusPerBox(gpu.value.gfx))
const boxes = computed(() => {
  const per = perBox.value
  const total = gpu.value.cus
  return Array.from({ length: Math.ceil(total / per) }, (_, i) => Math.min(per, total - i * per))
})

const chipLabel = computed(() => {
  const g = gpu.value
  const groups = perBox.value > 1 ? `，两个一框，${boxes.value.length} 个 WGP` : ''
  const counting = reading.value.unit === 'wgp' ? '按框数（WGP）' : '按格数（计算单元）'
  return `${g.name}：${g.cus} 个计算单元${groups}。现在${counting}，数到 ${reading.value.value} 个。`
})
</script>

<template>
  <section class="cc" :aria-labelledby="titleId">
    <header class="cc__head">
      <span class="cc__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="cc__title">谁在数计算单元</strong>
      <span class="cc__tag">示意图</span>
    </header>

    <GpuSource :gpu="gpu" :has-card="Boolean(card)" @toggle="showBook = !showBook" />

    <div class="cc__knobs">
      <Knob label="谁在数" :options="OPTIONS" v-model="source" />
    </div>
    <p class="cc__code">
      <span class="cc__code-label">读的是：</span>
      <code translate="no">{{ code }}</code>
    </p>

    <p class="cc__readout" aria-live="polite">
      <strong class="cc__value">{{ reading.value }}</strong>
      <span>{{ reading.unit === 'wgp' ? '个 WGP' : '个计算单元' }}。{{ reading.text }}</span>
    </p>

    <div class="cc__chip" :class="`by-${reading.unit}`" role="img" :aria-label="chipLabel">
      <span v-for="(size, i) in boxes" :key="i" class="cc__box" :class="{ 'is-pair': size > 1 }">
        <span v-for="j in size" :key="j" class="cc__cu" />
      </span>
    </div>

    <ul class="cc__legend" aria-label="图例">
      <li><span class="cc__sw is-cu" aria-hidden="true" />一格：一个计算单元</li>
      <li v-if="perBox > 1"><span class="cc__sw is-box" aria-hidden="true" />一框：一个 WGP（两个计算单元）</li>
      <li>描深的是「{{ OPTIONS.find((o) => o.value === source)?.label }}」数的东西</li>
    </ul>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同新手村的 scenes（例如 1-5 的 SquadSplit）。 */
.cc {
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

.cc__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.cc__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.cc__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.cc__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.cc__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.cc__code {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: -4px 0 0;
  font-size: 14px;
}

.cc__code-label {
  color: var(--hg-ink-2);
}

.cc__code code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.cc__readout {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-height: 1.6em;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.cc__value {
  font-family: var(--hg-font-display);
  font-size: 28px;
  line-height: 1;
}

/* ---------- 方格：一格一个计算单元，按 WGP 计数的卡两格一框 ---------- */

.cc__chip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 6px;
  padding: 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.cc__box {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 2px dashed transparent;
  border-radius: var(--hg-radius-tag);
  transition: border-color var(--motion-fast) var(--motion-ease-out), background-color var(--motion-fast) var(--motion-ease-out);
}

.cc__box.is-pair {
  border-color: var(--hg-border);
}

.cc__cu {
  flex: 1 1 0;
  height: 22px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background: var(--hg-surface);
  transition: background-color var(--motion-fast) var(--motion-ease-out), border-color var(--motion-fast) var(--motion-ease-out);
}

/* 按计算单元数：每一格实心；框退成虚线。按 WGP 数：每一框实线描深、铺浅底，格子留白。形状之外还有图例和读屏文字（01 第 7 节）。 */
.by-cu .cc__cu {
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent);
}

.by-wgp .cc__box {
  border-style: solid;
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent-soft);
}

.cc__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.cc__legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cc__sw {
  display: inline-block;
  width: 14px;
  height: 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background: var(--hg-surface);
}

.cc__sw.is-box {
  width: 22px;
  border: 2px solid var(--hg-accent-ink);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-accent-soft);
}
</style>
