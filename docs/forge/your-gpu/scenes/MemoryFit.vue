<script setup lang="ts">
/**
 * 2-1 探索三「显存多少」（关卡自己的 scenes，不用登记组件）：n×n 的 FP32 矩阵乘要同时放下 A、B、C 三个矩阵，
 * 这张卡的显存放不放得下。
 *
 * 旋钮选 n；整条是这张卡的显存，涂上的是三个矩阵（超出时涂满整条、换成斜纹，写「放不下」）。同一个量按 GiB 和 GB
 * 各写一遍（readings.ts 的 binaryText、decimalText），一句话解读见 memoryText。
 * 本书的卡按产品页的 16 GB 比（示意，1 GB 按 10⁹ 字节）；你的卡按 GPU 卡片里 PyTorch 读到的 total_memory 比。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import GpuSource from './GpuSource.vue'
import { useGpu } from './useGpu.ts'
import { MATRIX_DEFAULT, MATRIX_SIDES, binaryText, decimalText, memoryFit, memoryText } from '../readings.ts'

const titleId = `${useId()}-title`
const { card, showBook, gpu } = useGpu()

const OPTIONS = [...MATRIX_SIDES]
const n = ref<number>(MATRIX_DEFAULT)
const fit = computed(() => memoryFit(n.value, gpu.value.memory))
const text = computed(() => memoryText(fit.value, gpu.value))
/** 涂多长：不超过整条；太小也留一道，看得见。 */
const fill = computed(() => `max(3px, ${Math.min(1, fit.value.share) * 100}%)`)
</script>

<template>
  <section class="mf" :aria-labelledby="titleId">
    <header class="mf__head">
      <span class="mf__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="mf__title">显存放得下多大的矩阵</strong>
      <span class="mf__tag">示意图</span>
    </header>

    <GpuSource :gpu="gpu" :has-card="Boolean(card)" @toggle="showBook = !showBook" />

    <div class="mf__knobs">
      <Knob label="矩阵边长" code="n" :options="OPTIONS" v-model="n" />
    </div>

    <dl class="mf__facts">
      <div>
        <dt>三个矩阵</dt>
        <dd>3 × {{ n }}² × 4 字节 = {{ binaryText(fit.bytes) }}（{{ decimalText(fit.bytes) }}）</dd>
      </div>
      <div>
        <dt>这张卡的显存</dt>
        <dd v-if="gpu.memory.exact">{{ gpu.memory.text }}（{{ decimalText(gpu.memory.bytes) }}），PyTorch 读到的总量</dd>
        <dd v-else>{{ gpu.memory.text }}，产品页上的标称容量（按它画，示意）</dd>
      </div>
    </dl>

    <div class="mf__bar" role="img" :aria-label="text">
      <span class="mf__fill" :class="{ 'is-over': !fit.fits }" :style="{ width: fill }" />
    </div>

    <p class="mf__readout" aria-live="polite">{{ text }}</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同探索一（CuCount）。 */
.mf {
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

.mf__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.mf__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.mf__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.mf__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.mf__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.mf__facts {
  display: grid;
  gap: 6px;
  margin: 0;
  font-size: 14px;
}

.mf__facts div {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
}

.mf__facts dt {
  flex: 0 0 6.5em;
  color: var(--hg-ink-2);
}

.mf__facts dd {
  flex: 1 1 14em;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

/* 整条是显存；涂上的是三个矩阵。放不下时涂满整条、换成红色斜纹（形状之外还有文字，01 第 7 节）。 */
.mf__bar {
  height: 22px;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
}

.mf__fill {
  display: block;
  height: 100%;
  background: var(--hg-accent);
  transition: width var(--motion-base) var(--motion-ease-in-out);
}

.mf__fill.is-over {
  background: repeating-linear-gradient(-45deg, var(--hg-error) 0 6px, var(--hg-error-soft) 6px 12px);
}

.mf__readout {
  min-height: 1.6em;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
</style>
