<script setup lang="ts">
/**
 * 2-2 探索一「编译」（关卡自己的 scenes，不用登记组件）：同样一块元素，HIP 派几个线程，Triton 派几个。
 *
 * 旋钮选一组 / 一块管几个元素（256、1024、4096，默认 1024）。两条路线上下两行，一格是一个 wave：
 * HIP 一个线程算一个元素，元素越多 wave 越多，超过一组的上限就画成派不出去；Triton 一个 program 总是
 * num_warps 个 wave，块越大，每个线程分到的元素越多。读者当前路线那一行标「你的路线」：同 RouteBlock，
 * 由 <html data-hg-route> 上的 CSS 决定，水合前后一致。导入了 GPU 卡片时按你的卡的 gfx 代号定 wave 大小。
 */
import { computed, onMounted, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { useProgress } from '@course/useProgress.ts'
import { BOOK_WAVE, HIP_MAX_THREADS, TILE_DEFAULT, TILE_OPTIONS, TRITON_NUM_WARPS, tileSplit, waveOf } from '../kernel.ts'

const titleId = `${useId()}-title`
const progress = useProgress()
// 存档在挂载以后才读得到：挂载之前（服务端渲染、水合）一律按本书的卡画，水合前后一致。
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const card = computed(() => (mounted.value ? progress.currentDevice() : null))
const cardWave = computed(() => (card.value ? waveOf(card.value.gfx) : null))
const wave = computed(() => cardWave.value ?? BOOK_WAVE)
const source = computed(() => (cardWave.value && card.value
  ? `按你的卡算：${card.value.name}（${card.value.gfx}），wave ${wave.value}`
  : `按本书的卡算：wave ${BOOK_WAVE}`))

const OPTIONS = [...TILE_OPTIONS]
const elements = ref<number>(TILE_DEFAULT)
const split = computed(() => tileSplit(elements.value, wave.value))

const hipText = computed(() => {
  const { elements: e, hip } = split.value
  return hip.fits
    ? `${e} 个元素派 ${hip.threads} 个线程（${hip.waves} 个 wave），一个线程算一个。`
    : `${e} 个元素要 ${e} 个线程，超过一组的上限 ${HIP_MAX_THREADS} 个：这一组派不出去。`
})
const tritonText = computed(() => {
  const { elements: e, triton } = split.value
  return `一个 program ${triton.threads} 个线程（${triton.waves} 个 wave），${e} 个元素每个线程分 ${triton.perThread} 个。`
})
const verdict = computed(() => {
  const { elements: e, hip, triton } = split.value
  return hip.fits
    ? `同样 ${e} 个元素，HIP 派 ${hip.threads} 个线程，Triton 派 ${triton.threads} 个：BLOCK 是元素数，不是线程数。`
    : `HIP 一组最多 ${HIP_MAX_THREADS} 个线程，装不下 ${e} 个元素；Triton 照样派 ${triton.threads} 个线程，每个分 ${triton.perThread} 个。`
})
</script>

<template>
  <section class="tt" :aria-labelledby="titleId">
    <header class="tt__head">
      <span class="tt__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="tt__title">一个线程一个元素，还是一个 program 一块</strong>
      <span class="tt__tag">示意图</span>
    </header>
    <p class="tt__rules">一格是一个 wave（{{ wave }} 个线程）。HIP 的组大小就是线程数；Triton 的 BLOCK 是一块有几个元素，线程数由 <code>num_warps</code>（默认 {{ TRITON_NUM_WARPS }}）定。</p>

    <div class="tt__knobs">
      <Knob label="一组 / 一块的元素数" code="blockDim.x · BLOCK" :options="OPTIONS" unit=" 个" v-model="elements" />
      <p class="tt__source">{{ source }}</p>
    </div>

    <div class="tt__row" data-route="hip">
      <p class="tt__label">
        <strong>HIP</strong>
        <span>一个线程算一个元素</span>
        <span class="tt__mine">你的路线</span>
      </p>
      <div
        v-if="split.hip.fits"
        class="tt__waves"
        role="img"
        :aria-label="`HIP：${split.hip.waves} 个 wave，共 ${split.hip.threads} 个线程`"
      >
        <span v-for="i in split.hip.waves" :key="i" class="tt__wave" />
      </div>
      <p v-else class="tt__over" role="img" :aria-label="`HIP：${split.elements} 个线程超过一组的上限 ${HIP_MAX_THREADS} 个`">
        超过一组的上限 {{ HIP_MAX_THREADS }} 个线程
      </p>
      <p class="tt__text">{{ hipText }}</p>
    </div>

    <div class="tt__row" data-route="triton">
      <p class="tt__label">
        <strong>Triton</strong>
        <span>一个 program 算一块 tile</span>
        <span class="tt__mine">你的路线</span>
      </p>
      <div
        class="tt__waves"
        role="img"
        :aria-label="`Triton：${split.triton.waves} 个 wave，共 ${split.triton.threads} 个线程，每个线程 ${split.triton.perThread} 个元素`"
      >
        <span v-for="i in split.triton.waves" :key="i" class="tt__wave is-tile">
          <i>每线程 ×{{ split.triton.perThread }}</i>
        </span>
      </div>
      <p class="tt__text">{{ tritonText }}</p>
    </div>

    <p class="tt__readout" aria-live="polite">{{ verdict }}</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同 2-1 的场景。 */
.tt {
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

.tt__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.tt__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.tt__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.tt__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.tt__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.tt__knobs {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.tt__source {
  margin: 0;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  overflow-wrap: anywhere;
}

/* ---------- 一条路线一行；读者当前的路线实线框、强调色浅底（默认 HIP，同 RouteBlock） ---------- */

.tt__row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.tt__row[data-route='hip'],
html[data-hg-route='triton'] .tt__row[data-route='triton'] {
  border-style: solid;
  background: var(--hg-accent-soft);
}

html[data-hg-route='triton'] .tt__row[data-route='hip'] {
  border-style: dashed;
  background: var(--hg-surface-2);
}

.tt__mine {
  display: none;
  padding: 0 8px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-accent-ink);
  font-size: 12px;
  font-weight: 700;
}

.tt__row[data-route='hip'] .tt__mine,
html[data-hg-route='triton'] .tt__row[data-route='triton'] .tt__mine {
  display: inline-block;
}

html[data-hg-route='triton'] .tt__row[data-route='hip'] .tt__mine {
  display: none;
}

.tt__label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  margin: 0;
  font-size: 14px;
}

.tt__label strong {
  font-family: var(--hg-font-mono);
}

.tt__waves {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* 一个 wave 一格；Triton 的格子宽一些，写着每个线程分几个元素。 */
.tt__wave {
  display: block;
  width: 22px;
  height: 14px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-accent);
}

.tt__wave.is-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 88px;
  height: 26px;
  padding: 0 8px;
  background: var(--hg-violet-ink);
}

.tt__wave.is-tile i {
  color: var(--hg-surface);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
  white-space: nowrap;
}

.tt__over {
  margin: 0;
  padding: 6px 10px;
  border: var(--hg-border-width) dashed var(--hg-error);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-size: 14px;
  font-weight: 600;
}

.tt__text {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.tt__readout {
  min-height: 1.6em;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.tt code {
  font-family: var(--hg-font-mono);
  font-size: 0.92em;
}
</style>
