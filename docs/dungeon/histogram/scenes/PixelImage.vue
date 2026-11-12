<script setup lang="ts">
/**
 * 副本「直方图」题目里的小图（副本自己的 scenes，不用登记组件）：16 × 16 个像素，每格写着它的亮度（0～7 档），
 * 底色越亮档越高。右边标出每组管哪 4 行（一组 64 个线程，一个线程管一个像素）。静态的图，不能点；
 * 读屏读整张图的一句话和下面每组数到了哪几档。
 */
import { BLOCK_LEVELS, IMAGE, LEVELS, ROWS_PER_BLOCK, SHADES, SIDE } from '../challenge.ts'

const rows = IMAGE.map((line) => line.split('').map(Number))
const bands = BLOCK_LEVELS.map((levels, block) => ({ block, from: block * ROWS_PER_BLOCK, to: (block + 1) * ROWS_PER_BLOCK - 1, levels }))
const LABEL = `一张 ${SIDE} × ${SIDE} 的小图，每个像素写着亮度 0～${LEVELS - 1} 档：上面 4 行是天空和太阳（6、7 档），中间是两座山和山后的天（3、4、5 档），下面 4 行是地面和一条小河（0、1、2 档）。`
</script>

<template>
  <figure class="px">
    <div class="px__body">
      <div class="px__grid" role="img" :aria-label="LABEL">
        <template v-for="(row, r) in rows" :key="r">
          <span
            v-for="(level, c) in row"
            :key="c"
            class="px__cell"
            :class="{ 'is-band-top': r > 0 && r % ROWS_PER_BLOCK === 0, 'is-light': level >= 4 }"
            :style="{ background: SHADES[level] }"
            aria-hidden="true"
          >{{ level }}</span>
        </template>
      </div>
      <ol class="px__bands" aria-label="每组管哪 4 行">
        <li v-for="b in bands" :key="b.block" class="px__band">
          <strong>block {{ b.block }}</strong>
          <span>第 {{ b.from }}～{{ b.to }} 行</span>
          <span class="px__band-levels">{{ b.levels.join('、') }} 档</span>
        </li>
      </ol>
    </div>
    <figcaption class="px__caption">
      <span class="px__legend" aria-hidden="true">
        <span>暗</span>
        <span v-for="(shade, level) in SHADES" :key="level" class="px__swatch" :class="{ 'is-light': level >= 4 }" :style="{ background: shade }">{{ level }}</span>
        <span>亮</span>
      </span>
      <span>a[i] 是第 i / {{ SIDE }} 行、第 i % {{ SIDE }} 列那个像素的亮度。每组 64 个线程，正好管 4 行。</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.px {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 20px 0;
  padding: 16px 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.px__body {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 12px 18px;
}

/* 一行 16 格，格子是正方形，宽屏时不超过 22px。 */
.px__grid {
  display: grid;
  flex: 1 1 260px;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 1px;
  max-width: calc(16 * 22px + 15 * 1px);
  min-width: 0;
}

.px__cell {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  min-width: 0;
  overflow: hidden;
  border-radius: 2px;
  color: #e2e8f0;
  font-family: var(--hg-font-mono);
  font-size: 9px;
  line-height: 1;
}

.px__cell.is-light {
  color: #0f172a;
}

/* 每组的第一行上面空出一道缝：一组 4 行 */
.px__cell.is-band-top {
  margin-top: 4px;
}

.px__bands {
  display: flex;
  flex: 1 1 180px;
  flex-direction: column;
  justify-content: space-around;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.px__band {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  margin: 0;
  padding: 4px 10px;
  border-left: 3px solid var(--hg-border-strong);
  color: var(--hg-ink-2);
  font-size: 13px;
}

.px__band strong {
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.px__band-levels {
  color: var(--hg-ink);
}

.px__caption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.px__legend {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.px__swatch {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: 3px;
  color: #e2e8f0;
  font-family: var(--hg-font-mono);
  font-size: 10px;
}

.px__swatch.is-light {
  color: #0f172a;
}

@media (max-width: 479px) {
  .px {
    padding: 12px;
  }
}
</style>
