<script setup lang="ts">
/**
 * 副本「前缀和入门」题目里的小图（副本自己的 scenes，不用登记组件）：8 个零件、3 轮，货架上每一格怎么变。
 * 每一轮，第 t 格加上左边隔 s 格（第 t - s 格）这一轮之前的数；t 小于 s 的格子左边没有那么多格，不变（虚线框）。
 * 第 7 格那一列描出来：它每一轮从哪一格加过来。数从 challenge.ts 的 flagAt 算，是一张静态的表，读屏按表格读。
 */
import { flagAt } from '../challenge.ts'

const N = 8
const start = Array.from({ length: N }, (_, j) => flagAt(j))
/** 每一轮之后的样子：照着工作单，先按这一轮之前的数取，再加。 */
const rounds: { gap: number; values: number[] }[] = []
let prev = start
for (let gap = 1; gap < N; gap *= 2) {
  const before = prev
  prev = before.map((v, t) => (t >= gap ? v + before[t - gap] : v))
  rounds.push({ gap, values: prev })
}
const rows = [
  { label: '放上货架', gap: 0, values: start },
  ...rounds.map((r, k) => ({ label: `第 ${k + 1} 轮（隔 ${r.gap} 格）`, gap: r.gap, values: r.values })),
]
/** 第 7 格每一轮从哪一格加过来：上一行的第 7 - s 格 */
const PICK = N - 1
const sources = rows.map((row) => (row.gap ? PICK - row.gap : -1))
const story = rounds.map((r, k) => `第 ${k + 1} 轮加上第 ${PICK - r.gap} 格`).join('，')
</script>

<template>
  <figure class="ss">
    <div class="ss__wrap">
      <table class="ss__table">
        <caption class="ss__caption">{{ N }} 个零件（合格 1，不合格 0），每一轮货架上的数</caption>
        <thead>
          <tr>
            <th scope="col">这一步</th>
            <th v-for="t in N" :key="t" scope="col">第 {{ t - 1 }} 格</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, r) in rows" :key="row.label">
            <th scope="row">{{ row.label }}</th>
            <td
              v-for="(v, t) in row.values"
              :key="t"
              :class="{
                'is-kept': row.gap > 0 && t < row.gap,
                'is-pick': t === PICK,
                'is-source': r + 1 < rows.length && t === sources[r + 1],
              }"
            >{{ v }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <figcaption class="ss__note">
      描粗的是第 {{ PICK }} 格，里面画虚线的是它下一轮要取的那一格：{{ story }}，取的都是上一行、这一轮之前的数。{{ rounds.length }} 轮以后，第 {{ PICK }} 格就是第 0～{{ PICK }} 格的和 {{ rows[rows.length - 1].values[PICK] }}。
      外框是虚线的格子，左边没有那么多格，这一轮不变。
    </figcaption>
  </figure>
</template>

<style scoped>
.ss {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 20px 0;
  padding: 16px 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

/* 表格窄屏放不下时在这一块里横着滚，页面不跟着滚（01 第 7 节）。 */
.ss__wrap {
  min-width: 0;
  overflow-x: auto;
}

/* VitePress 正文里的表格是 display: block、带竖线和隔行底色，这里换回占满一行的普通表格（同 1-7 的 TripBoard）。 */
.ss__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: separate;
  border-spacing: 3px;
  font-variant-numeric: tabular-nums;
}

.ss .ss__table tr {
  border: 0;
  background-color: transparent;
}

.ss__caption {
  padding-bottom: 4px;
  color: var(--hg-ink-2);
  font-size: 13px;
  text-align: left;
}

.ss .ss__table th,
.ss .ss__table td {
  padding: 4px 2px;
  border: 0;
  font-size: 13px;
  text-align: center;
  white-space: nowrap;
}

.ss__table thead th {
  color: var(--hg-ink-3);
  font-size: 11px;
  font-weight: 600;
}

.ss .ss__table th[scope='row'] {
  padding-right: 8px;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
}

.ss .ss__table td {
  min-width: 26px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 4px;
  background: var(--hg-group-0-soft);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-weight: 700;
}

.ss .ss__table td.is-kept {
  border-style: dashed;
  background: transparent;
  color: var(--hg-ink-3);
}

.ss .ss__table td.is-pick {
  border: 2px solid var(--hg-accent-ink);
}

.ss .ss__table td.is-source {
  outline: 2px dashed var(--hg-accent-ink);
  outline-offset: -4px;
}

.ss__note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

@media (max-width: 479px) {
  .ss {
    padding: 12px;
  }
}
</style>
