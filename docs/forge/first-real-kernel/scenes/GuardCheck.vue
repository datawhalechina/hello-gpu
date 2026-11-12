<script setup lang="ts">
/**
 * 2-2 探索三「校验」（关卡自己的 scenes，不用登记组件）：Notebook 的 7 个长度，护栏查越界写。
 *
 * 旋钮选长度（默认 1000，热身那道题），开关选写没写边界检查（默认没写，第一版 kernel）。
 * 上半：选中的长度在两条路线上各派出几个位置，最后一组多出来的写没写进输出后面的护栏（示意图，不按比例）。
 * 下半：7 个长度的结果表，同 hg.check 打印的 ✓ / ✗（越界写几个），最后一行是通过几个。
 * 读者当前路线那一行、那一列加重：同 RouteBlock，由 <html data-hg-route> 上的 CSS 决定。数在 kernel.ts（checkCase）。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { CHECK_LENGTHS, GUARD_ELEMENTS, LENGTH_DEFAULT, LENGTH_LABELS, ROUTE_GROUPS, checkCase, checkReport, type CheckCase } from '../kernel.ts'

const titleId = `${useId()}-title`

const n = ref<number>(LENGTH_DEFAULT)
const bounded = ref(false)
const OPTIONS = CHECK_LENGTHS.map((value) => ({ value, label: LENGTH_LABELS[value] ?? String(value) }))
const nLabel = computed(() => LENGTH_LABELS[n.value] ?? String(n.value))

function caseText(c: CheckCase, unit: string): string {
  const sent = `派出 ${c.groups} ${unit}共 ${c.launched} 个位置`
  if (c.extra === 0) return `${sent}，正好盖住输出，没有多出来的：✓`
  if (c.oob === 0) return `${sent}，多出 ${c.extra} 个；边界检查拦住了它们，护栏没变：✓`
  return `${sent}，多出的 ${c.extra} 个写进了输出后面的护栏：✗ 越界写 ${c.oob} 个`
}

const rows = computed(() => ROUTE_GROUPS.map((r) => {
  const c = checkCase(n.value, r.group, bounded.value)
  return {
    ...r,
    c,
    text: caseText(c, r.unit),
    // 多出来的那段画在护栏开头，宽度按它占一组的比例（示意，至少画得出数字）。
    width: `${Math.max(24, Math.round((c.extra / r.group) * 100))}%`,
  }
}))
const reports = computed(() => ROUTE_GROUPS.map((r) => ({ ...r, ...checkReport(r.group, bounded.value) })))
const verdict = computed(() => {
  if (bounded.value) return '写了边界检查：两条路线 7 个长度都过，护栏一个没变。'
  const [hip, triton] = reports.value
  return `没写边界检查：只有组大小整数倍的长度能过，HIP ${hip.passed}/${hip.total}，Triton ${triton.passed}/${triton.total}。`
})
</script>

<template>
  <section class="gc" :aria-labelledby="titleId">
    <header class="gc__head">
      <span class="gc__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="gc__title">护栏查越界写</strong>
      <span class="gc__tag">示意图</span>
    </header>
    <p class="gc__rules">
      一条是一段显存：中间是输出，前后各 {{ GUARD_ELEMENTS }} 个元素的护栏，事先填满。kernel 写到护栏上，<code>hg.check</code> 就数得出来。
    </p>

    <div class="gc__knobs">
      <Knob label="长度" code="n" :options="OPTIONS" v-model="n" />
      <Knob label="边界检查" mode="switch" on="写了" off="没写" v-model="bounded" />
    </div>

    <div v-for="row in rows" :key="row.route" class="gc__row" :data-route="row.route">
      <p class="gc__label">
        <strong>{{ row.name }}</strong>
        <span>{{ row.label }}</span>
        <span class="gc__mine">你的路线</span>
      </p>
      <div class="gc__strip" role="img" :aria-label="`${row.name}，长度 ${nLabel}：${row.text}`">
        <span class="gc__guard">护栏</span>
        <span class="gc__out">输出 {{ nLabel }} 个</span>
        <span class="gc__guard is-after">
          <span
            v-if="row.c.extra"
            class="gc__extra"
            :class="row.c.oob ? 'is-oob' : 'is-blocked'"
            :style="{ width: row.width }"
          >{{ row.c.extra }}</span>
          <span class="gc__guard-name">护栏</span>
        </span>
      </div>
      <p class="gc__text">{{ row.text }}</p>
    </div>

    <table class="gc__table">
      <caption>7 个长度的校验，同 <code>hg.check</code> 打印的结果（✗ 后面是越界写的个数）</caption>
      <thead>
        <tr>
          <th scope="col">长度</th>
          <th v-for="r in reports" :key="r.route" scope="col" :data-route="r.route">{{ r.name }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(len, i) in CHECK_LENGTHS" :key="len" :class="{ 'is-current': len === n }">
          <th scope="row">{{ LENGTH_LABELS[len] ?? len }}</th>
          <td v-for="r in reports" :key="r.route" :data-route="r.route" :class="r.cases[i].passed ? 'is-pass' : 'is-fail'">
            {{ r.cases[i].passed ? '✓' : `✗ 越界 ${r.cases[i].oob}` }}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">通过</th>
          <td v-for="r in reports" :key="r.route" :data-route="r.route">{{ r.passed }}/{{ r.total }}</td>
        </tr>
      </tfoot>
    </table>

    <p class="gc__readout" aria-live="polite">{{ verdict }}</p>

    <ul class="gc__legend" aria-label="图例">
      <li><span class="gc__sw is-guard" aria-hidden="true" />护栏</li>
      <li><span class="gc__sw is-oob" aria-hidden="true" />越界写进护栏</li>
      <li><span class="gc__sw is-blocked" aria-hidden="true" />被边界检查拦住</li>
    </ul>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「示意图」标签同 2-1 的场景。 */
.gc {
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

.gc__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.gc__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.gc__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.gc__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.gc__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.gc code {
  font-family: var(--hg-font-mono);
  font-size: 0.92em;
}

.gc__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* ---------- 一条路线一行；读者当前的路线实线框、强调色浅底（默认 HIP，同 RouteBlock） ---------- */

.gc__row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.gc__row[data-route='hip'],
html[data-hg-route='triton'] .gc__row[data-route='triton'] {
  border-style: solid;
  background: var(--hg-accent-soft);
}

html[data-hg-route='triton'] .gc__row[data-route='hip'] {
  border-style: dashed;
  background: var(--hg-surface-2);
}

.gc__mine {
  display: none;
  padding: 0 8px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-accent-ink);
  font-size: 12px;
  font-weight: 700;
}

.gc__row[data-route='hip'] .gc__mine,
html[data-hg-route='triton'] .gc__row[data-route='triton'] .gc__mine {
  display: inline-block;
}

html[data-hg-route='triton'] .gc__row[data-route='hip'] .gc__mine {
  display: none;
}

.gc__label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  margin: 0;
  font-size: 14px;
}

.gc__label strong {
  font-family: var(--hg-font-mono);
}

/* 一段显存：前护栏、输出、后护栏，不按比例。 */
.gc__strip {
  display: flex;
  height: 32px;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  font-size: 12px;
  line-height: 30px;
  white-space: nowrap;
}

.gc__guard {
  position: relative;
  flex: 0 0 16%;
  overflow: hidden;
  background: repeating-linear-gradient(135deg, var(--hg-border-strong) 0 4px, var(--hg-surface) 4px 8px);
  color: var(--hg-ink-2);
  text-align: center;
}

.gc__guard.is-after {
  flex-basis: 34%;
}

.gc__guard-name {
  position: relative;
}

.gc__out {
  flex: 1 1 auto;
  overflow: hidden;
  border-right: var(--hg-border-width) solid var(--hg-border-strong);
  border-left: var(--hg-border-width) solid var(--hg-border-strong);
  background: var(--hg-surface);
  font-weight: 600;
  text-align: center;
  text-overflow: ellipsis;
}

.gc__extra {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  overflow: hidden;
  color: var(--hg-surface);
  font-family: var(--hg-font-mono);
  font-weight: 700;
  text-align: center;
}

.gc__extra.is-oob {
  background: var(--hg-error);
}

.gc__extra.is-blocked {
  outline: 2px dashed var(--hg-accent-ink);
  outline-offset: -2px;
  background: var(--hg-surface);
  color: var(--hg-accent-ink);
}

.gc__text {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

/* ---------- 结果表 ---------- */

.gc__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 13px;
}

.gc__table caption {
  margin-bottom: 6px;
  color: var(--hg-ink-2);
  font-size: 13px;
  text-align: left;
}

.gc__table th,
.gc__table td {
  padding: 4px 8px;
  border: var(--hg-border-width) solid var(--hg-border);
  background: transparent;
  text-align: left;
  white-space: nowrap;
}

.gc__table tbody th,
.gc__table tfoot th {
  font-family: var(--hg-font-mono);
  font-weight: 600;
}

.gc__table td.is-pass {
  color: var(--hg-accent-ink);
}

.gc__table td.is-fail {
  color: var(--hg-error-ink);
}

.gc__table tr.is-current th,
.gc__table tr.is-current td {
  background: var(--hg-surface-2);
  font-weight: 700;
}

.gc__table tfoot td {
  font-weight: 700;
}

/* 读者当前路线那一列加粗（默认 HIP）。 */
.gc__table [data-route='hip'],
html[data-hg-route='triton'] .gc__table [data-route='triton'] {
  font-weight: 700;
}

html[data-hg-route='triton'] .gc__table [data-route='hip'] {
  font-weight: 400;
}

.gc__readout {
  min-height: 1.6em;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.gc__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.gc__legend li {
  display: flex;
  align-items: center;
  gap: 6px;
}

.gc__sw {
  display: inline-block;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}

.gc__sw.is-guard {
  background: repeating-linear-gradient(135deg, var(--hg-border-strong) 0 3px, var(--hg-surface) 3px 6px);
  outline: 1px solid var(--hg-border-strong);
}

.gc__sw.is-oob {
  background: var(--hg-error);
}

.gc__sw.is-blocked {
  outline: 2px dashed var(--hg-accent-ink);
  outline-offset: -2px;
}
</style>
