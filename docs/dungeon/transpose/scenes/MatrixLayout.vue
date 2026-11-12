<script setup lang="ts">
/**
 * 副本「矩阵转置」题目里的小例子（副本自己的 scenes，不用登记组件；静态图，不跑模拟器）。
 *
 * 2 行 3 列的 a 和它的转置 b（3 行 2 列），下面是它们在显存里排成的一维数组。a 的第 0 行用强调色的浅底，
 * 第 1 行用灰底，搬到 b 里底色不变：a 的一行变成 b 的一列，在 b 的一维数组里隔一个放一个。
 * 状态不只靠颜色：每格写着数，一维数组每格下面写着下标，图例写明两种底色。
 */
const ROWS = 2
const COLS = 3
/** a[j] = j + 1；b 的第 k 格放 a 的第 k % R 行、第 k / R 列（b[c * R + r] = a[r * C + c]）。 */
const A = Array.from({ length: ROWS * COLS }, (_, j) => j + 1)
const B = A.map((_, k) => A[(k % ROWS) * COLS + Math.floor(k / ROWS)])
/** 这个数在 a 的第几行（a[j] = j + 1）。 */
const rowOf = (v: number) => Math.floor((v - 1) / COLS)

const rowsText = (list: number[], cols: number) =>
  Array.from({ length: list.length / cols }, (_, r) => `第 ${r} 行是 ${list.slice(r * cols, r * cols + cols).join('、')}`).join('，')
const A_LABEL = `a 有 ${ROWS} 行 ${COLS} 列：${rowsText(A, COLS)}`
const B_LABEL = `b 有 ${COLS} 行 ${ROWS} 列：${rowsText(B, ROWS)}`
const flatLabel = (name: string, list: number[]) => `显存里的 ${name}：${list.map((v, k) => `${name}[${k}] = ${v}`).join('，')}`
</script>

<template>
  <figure class="ml">
    <div class="ml__pair">
      <div class="ml__matrix">
        <p class="ml__name">a：{{ ROWS }} 行 {{ COLS }} 列</p>
        <div class="ml__grid" :style="{ '--cols': COLS }" role="img" :aria-label="A_LABEL">
          <span v-for="v in A" :key="v" class="ml__cell" :class="`is-row${rowOf(v)}`" aria-hidden="true">{{ v }}</span>
        </div>
      </div>
      <span class="ml__arrow" aria-hidden="true">转置 →</span>
      <div class="ml__matrix">
        <p class="ml__name">b：{{ COLS }} 行 {{ ROWS }} 列</p>
        <div class="ml__grid" :style="{ '--cols': ROWS }" role="img" :aria-label="B_LABEL">
          <span v-for="v in B" :key="v" class="ml__cell" :class="`is-row${rowOf(v)}`" aria-hidden="true">{{ v }}</span>
        </div>
      </div>
    </div>

    <div class="ml__flat">
      <p class="ml__name">显存里的 a，一行接一行</p>
      <ol class="ml__line" role="img" :aria-label="flatLabel('a', A)">
        <li v-for="(v, k) in A" :key="k" aria-hidden="true">
          <span class="ml__cell" :class="`is-row${rowOf(v)}`">{{ v }}</span>
          <span class="ml__index">a[{{ k }}]</span>
        </li>
      </ol>
      <p class="ml__name">显存里的 b，一行接一行</p>
      <ol class="ml__line" role="img" :aria-label="flatLabel('b', B)">
        <li v-for="(v, k) in B" :key="k" aria-hidden="true">
          <span class="ml__cell" :class="`is-row${rowOf(v)}`">{{ v }}</span>
          <span class="ml__index">b[{{ k }}]</span>
        </li>
      </ol>
    </div>

    <figcaption class="ml__caption">
      <span class="ml__key"><span class="ml__swatch is-row0" aria-hidden="true" />a 的第 0 行</span>
      <span class="ml__key"><span class="ml__swatch is-row1" aria-hidden="true" />a 的第 1 行</span>
      <span>a 的一行在显存里挨着放；转置以后变成 b 的一列，在 b 里隔 {{ ROWS }} 格放一个。</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.ml {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 16px 0 20px;
  padding: 18px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.ml__pair {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
}

.ml__matrix {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ml__name {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.ml__grid {
  display: grid;
  grid-template-columns: repeat(var(--cols), 40px);
  gap: 4px;
}

.ml__cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 36px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 6px;
  font-family: var(--hg-font-mono);
  font-size: 15px;
  font-weight: 600;
}

.ml__cell.is-row0,
.ml__swatch.is-row0 {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

.ml__cell.is-row1,
.ml__swatch.is-row1 {
  border-style: dashed;
  background: var(--hg-surface-2);
}

.ml__arrow {
  color: var(--hg-ink-2);
  font-size: 14px;
  font-weight: 600;
}

.ml__flat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ml__line {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 6px;
  padding: 0;
  list-style: none;
}

.ml__line li {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.ml__index {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.ml__caption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.ml__key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ml__swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
}

@media (max-width: 639px) {
  .ml {
    padding: 14px 12px;
  }
}
</style>
