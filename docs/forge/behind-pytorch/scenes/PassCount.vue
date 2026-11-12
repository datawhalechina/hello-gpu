<script setup lang="ts">
/**
 * 2-5 探索三「反复读写显存」（关卡自己的 scenes，不用登记组件）：GELU 的 tanh 近似照公式拆成 8 步（同 Notebook 的
 * gelu_steps），旋钮选合成几个 kernel，看每个 kernel 从显存读进哪些数组、写回哪些，一共读写几遍。
 * 遍数按算法数（trace.ts 的 fusePlan）：每个 kernel 把外面来的数组各读一遍，把后面的 kernel 还要用的结果和最后的 y 各写一遍；
 * 每遍搬一个和 x 一样大的数组（Notebook 的 2²⁶ 个 FP32 数）。耗时按本书那张卡的标称带宽算最快多久（2-4 的屋顶线），标「示意」。
 * 不只靠颜色：读、写的小方块形状不同（实心、空心），旁边写着数组名和遍数。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { SPEC_PEAK, msText, powerText, sig } from '../../roofline/roofline.ts'
import { bytesText } from '../../trusted-timing/timing.ts'
import { GELU_OUTPUT, GELU_STEPS, KERNEL_COUNTS, KERNEL_COUNT_DEFAULT, STEPS_N, fusePlan, moveUs, passTotals } from '../trace.ts'

const uid = useId()
const titleId = `${uid}-title`
const OPTIONS = KERNEL_COUNTS.map((n) => ({ value: n, label: `${n} 个` }))
const kernels = ref<number>(KERNEL_COUNT_DEFAULT)
const plan = computed(() => fusePlan(kernels.value))
const totals = computed(() => passTotals(plan.value))

/** 一遍：读或者写一个和 x 一样大的 FP32 数组。 */
const ARRAY_BYTES = 4 * STEPS_N
const BEST = passTotals(fusePlan(1))
const BEST_MS = moveUs(BEST.passes * ARRAY_BYTES, SPEC_PEAK) / 1000

const readout = computed(() => {
  const { reads, writes, passes } = totals.value
  const ms = moveUs(passes * ARRAY_BYTES, SPEC_PEAK) / 1000
  const middle = plan.value.flatMap((k) => k.writes).filter((name) => name !== GELU_OUTPUT)
  const head = `${kernels.value} 个 kernel：读 ${reads} 遍、写 ${writes} 遍，一共 ${passes} 遍，搬 ${bytesText(passes * ARRAY_BYTES)}；`
    + `按 ${SPEC_PEAK.gbps} GB/s 算，最快 ${msText(ms)}`
  return middle.length
    ? `${head}，是一个 kernel 算完（${msText(BEST_MS)}）的 ${sig(passes / BEST.passes)} 倍。写回显存、又读回来的中间结果：${middle.join('、')}。`
    : `${head}。中间结果都留在 kernel 里，显存只读 x、只写 y。`
})
</script>

<template>
  <section class="pc" :aria-labelledby="titleId">
    <header class="pc__head">
      <span class="pc__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="pc__title">GELU 拆成几个 kernel</strong>
    </header>
    <p class="pc__rules">
      x 是 {{ powerText(26) }} 个 FP32 数（{{ bytesText(ARRAY_BYTES) }}），每个中间结果也这么大。每个 kernel 从显存读进它要的数组，算完把后面还要用的写回去。
    </p>

    <div class="pc__knobs">
      <Knob label="8 步合成几个 kernel" :options="OPTIONS" v-model="kernels" />
    </div>

    <ol class="pc__kernels">
      <li v-for="(k, i) in plan" :key="`${kernels}-${i}`" class="pc__kernel">
        <p class="pc__name">kernel {{ i + 1 }}</p>
        <ul class="pc__code" translate="no">
          <li v-for="s in k.steps" :key="s"><code>{{ GELU_STEPS[s].code }}</code></li>
        </ul>
        <p class="pc__io">
          <span class="pc__line">
            <i v-for="name in k.reads" :key="`r${name}`" class="pc__box is-read" aria-hidden="true" />
            读 <code>{{ k.reads.join('、') }}</code>
          </span>
          <span class="pc__line">
            <i v-for="name in k.writes" :key="`w${name}`" class="pc__box is-write" aria-hidden="true" />
            写 <code>{{ k.writes.join('、') }}</code>
          </span>
        </p>
      </li>
    </ol>

    <div class="pc__total" aria-hidden="true">
      <span class="pc__total-name">{{ kernels }} 个 kernel</span>
      <span class="pc__strip">
        <i v-for="n in totals.reads" :key="`r${n}`" class="pc__box is-read" />
        <i v-for="n in totals.writes" :key="`w${n}`" class="pc__box is-write" />
      </span>
      <template v-if="kernels > 1">
        <span class="pc__total-name">1 个 kernel</span>
        <span class="pc__strip">
          <i v-for="n in BEST.reads" :key="`br${n}`" class="pc__box is-read" />
          <i v-for="n in BEST.writes" :key="`bw${n}`" class="pc__box is-write" />
        </span>
      </template>
    </div>

    <p class="pc__readout" aria-live="polite">{{ readout }}</p>
    <p class="pc__verdict">每切开一刀，切口上的中间结果就要写回显存、再读出来一遍。这几步都归带宽管，遍数多几倍，耗时也差不多多几倍。</p>
    <p class="pc__note">实心方块是读、空心是写，每块 {{ bytesText(ARRAY_BYTES) }}。耗时是示意：按 {{ SPEC_PEAK.device }} 的标称带宽算最快多久，真卡上的数看 Notebook 里的 trace。</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、旋钮区同本关和 2-4 的场景。 */
.pc {
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

.pc__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.pc__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.pc__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.pc__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.pc__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 每个 kernel 一张小卡 ---------- */

.pc__kernels {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pc__kernel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 10px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.pc__name {
  margin: 0;
  font-family: var(--hg-font-display);
  font-size: 14px;
  font-weight: 700;
}

.pc__code {
  margin: 0;
  padding: 0;
  list-style: none;
}

.pc__code li {
  margin: 0;
}

.pc__code code {
  font-family: var(--hg-font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.pc__io {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.pc__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}

.pc__line code {
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

/* 读是实心块，写是空心块：形状不同，不只靠颜色（01 第 7 节）。 */
.pc__box {
  display: inline-block;
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid var(--hg-accent-ink);
  border-radius: 2px;
}

.pc__box.is-read {
  background: var(--hg-accent-ink);
}

.pc__box.is-write {
  background: var(--hg-surface);
}

/* ---------- 合计：和一个 kernel 的比 ---------- */

.pc__total {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 6px 12px;
}

.pc__total-name {
  color: var(--hg-ink-2);
  font-size: 13px;
  white-space: nowrap;
}

.pc__strip {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.pc__readout {
  min-height: 4.8em;
  margin: 0;
  font-size: 15px;
}

.pc__verdict {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.pc__note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

@media (max-width: 520px) {
  .pc {
    padding: 16px;
  }

  .pc__kernels {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  }
}
</style>
