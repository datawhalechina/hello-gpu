<script setup lang="ts">
/**
 * 1-7 探索一「取数据」地图（关卡自己的 scenes，不用登记组件）：点地图上的一个地方，线程去那里取一个数。
 *
 * 每个 GPU 上的地方下面一条「等了多久」的条：长度按 params.ts 的 fetchCycles（模拟）画，显存那一条最长；
 * 取过的条留着，好几处取完放在一起比。点了马上换解读那一句（03 第 1 节第 4 条：数字先变），条再慢慢长出来：
 * 长出来的时间也按周期数算，显存那一条 1 秒，动画速度不代表 GPU 耗时（02 第 3 节）。
 * 减弱动效（系统设置或站点设置）时条直接画好。CPU 内存没有条：工作单够不着，解读里说怎么把数拷进显存。
 */
import { computed, ref, useId } from 'vue'
import StorageMap from './StorageMap.vue'
import { FETCH_CYCLES, PLACES, fetchText, type Place } from '../challenge.ts'

const titleId = `${useId()}-title`

/** 条的满格：显存一趟。 */
const FULL = FETCH_CYCLES.vram
/** 条长出来的时间：每个周期 10 毫秒，显存 1 秒（02 第 1 节：因果演示每个子动作 400–800 ms，最长那一条也不超过 1 秒）。 */
const MS_PER_CYCLE = 10

const selected = ref<Place | null>(null)
/** 取过的地方；值是第几次取，换一个值就让那一条从头再长一次。 */
const fetched = ref<Partial<Record<Place, number>>>({})
let count = 0

function pick(place: Place) {
  selected.value = place
  if (PLACES[place].cycles !== null) fetched.value = { ...fetched.value, [place]: ++count }
}

function reset() {
  selected.value = null
  fetched.value = {}
}

const readout = computed(() => (selected.value ? fetchText(selected.value) : '点地图上的一个地方：线程去那里取一个数。'))

function barStyle(place: Place) {
  const cycles = PLACES[place].cycles ?? 0
  return { '--w': `${Math.max((cycles / FULL) * 100, 1.5)}%`, '--d': `${cycles * MS_PER_CYCLE}ms` }
}
</script>

<template>
  <section class="ft" :aria-labelledby="titleId">
    <header class="ft__head">
      <span class="ft__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="ft__title">取数据地图</strong>
      <span class="ft__tag">模拟</span>
    </header>
    <p class="ft__rules">点一个地方，线程去那里取一个数。条有多长，就等了多久：按模拟的周期数画，动画速度不代表 GPU 耗时。能装多少来自 AMD 的官方资料。</p>

    <StorageMap pickable :selected="selected" label="取数据地图：点一个地方，去那里取一个数" @pick="pick">
      <template #place="{ place }">
        <span v-if="place === 'host'" class="ft__far">{{ selected === 'host' ? '够不着' : '' }}</span>
        <span v-else class="ft__wait">
          <span class="ft__track" aria-hidden="true">
            <span v-if="fetched[place]" :key="fetched[place]" class="ft__bar" :style="barStyle(place)" />
          </span>
          <span class="ft__val">{{ fetched[place] ? `一趟 ${PLACES[place].cycles} 个周期` : '还没取过' }}</span>
        </span>
      </template>
    </StorageMap>

    <p class="ft__readout" aria-live="polite">{{ readout }}</p>
    <div class="ft__actions">
      <button type="button" class="ft-button" :disabled="!selected" @click="reset">清空重来</button>
    </div>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的探索（1-5 的 SquadSplit）。 */
.ft {
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

.ft__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ft__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ft__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ft__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.ft__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.ft__wait {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 6px;
}

/* 条的底槽占满一行里能占的地方；条按周期数占满格的几成，从左往右长出来。 */
.ft__track {
  flex: 1 1 120px;
  height: 10px;
  overflow: hidden;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  box-shadow: inset 0 0 0 1px var(--hg-border);
}

.ft__bar {
  display: block;
  width: var(--w);
  height: 100%;
  border-radius: inherit;
  background: var(--hg-idle);
  transform-origin: left center;
  animation: ft-grow var(--d) linear;
}

@keyframes ft-grow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

/* 字数不同的说明占同样宽，几条底槽才一样长，条和条能直接比。 */
.ft__val {
  flex: none;
  min-width: 8.5em;
  text-align: right;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.ft__far {
  color: var(--hg-error-ink);
  font-size: 12px;
  font-weight: 700;
}

.ft__readout {
  min-height: 3.2em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.ft__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.ft-button {
  min-height: 40px;
  padding: 0 16px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.ft-button:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.ft-button:disabled {
  color: var(--hg-ink-3);
  cursor: default;
}

.ft-button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

@media (max-width: 639px) {
  .ft {
    padding: 16px 14px;
  }
}

/*
 * 减弱动效（02 第 4 节）：自定义 @keyframes 不受时长 token 影响，系统设置和站点设置（data-hg-motion）都要关掉，
 * 条直接画好。
 */
@media (prefers-reduced-motion: reduce) {
  .ft__bar {
    animation: none;
  }
}

[data-hg-motion='reduce'] .ft__bar {
  animation: none;
}
</style>
