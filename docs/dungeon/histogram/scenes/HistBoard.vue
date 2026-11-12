<script setup lang="ts">
/**
 * 副本「直方图」的结果板（副本自己的 scenes，不用登记组件）：沙盒结果插槽里用。
 *
 * 上面是 hist 的 8 档：柱子是运行后的数，虚线框是该有的数，数错的档标「✗」并写出该是几；跑完（或单步走到最后）才画。
 * 下面是一张表：每组往 hist 的每一格原子加了几次（显存上排的队，模拟），单步时只数到这一步，这一步加到的格子描一圈。
 * 这一组的 4 行里有这一档的像素，格子铺底色；没有这一档却去加了（加的是 0，白排一次队），格子标「!」。
 * 数都从模拟器的事件流算（challenge.ts 的 addTable）；格子只是看的，不能点。读屏读每一块上面那一行和表格本身。
 */
import { computed } from 'vue'
import type { Launch, SandboxStep } from '@kit/sandbox/run.ts'
import type { RunResult } from '@sim/lockstep.ts'
import { BLOCK_COUNTS, EXPECTED, HIST_NAME, LEVELS, SHADES, SHELF_NAME, addTable } from '../challenge.ts'

const props = withDefaults(defineProps<{
  result: RunResult | null
  launch: Launch
  /** 沙盒单步走到的这一步；看整段是 null */
  step?: SandboxStep | null
  emptyText?: string
}>(), { step: null, emptyText: '还没运行。' })

const finished = computed(() => Boolean(props.result) && (!props.step || props.step.index === props.step.count - 1))
const upto = computed(() => (props.step ? props.step.group.to : props.result?.events.length ?? 0))
const from = computed(() => (props.step ? props.step.group.from : upto.value))

const table = computed(() => (props.result ? addTable(props.result.events, props.launch.grid, upto.value, from.value) : null))

/** 到这一步为止：往 hist 上原子加了几次，往货架上原子加了几次。 */
const totals = computed(() => {
  let hist = 0
  let shelf = 0
  const events = props.result?.events ?? []
  for (let n = 0; n < Math.min(upto.value, events.length); n++) {
    const e = events[n]
    if (e.op !== 'atomic') continue
    if (e.space === 'global' && e.array === HIST_NAME) hist += e.addrs?.length ?? 0
    if (e.space === 'lds' && e.array === SHELF_NAME) shelf += e.addrs?.length ?? 0
  }
  return { hist, shelf }
})

const bars = computed(() => {
  const values = props.result?.arrays[HIST_NAME] ?? []
  const top = Math.max(...EXPECTED, ...values.slice(0, LEVELS), 1)
  return EXPECTED.map((want, level) => {
    const got = values[level] ?? 0
    return { level, got, want, ok: got === want, height: (got / top) * 100, target: (want / top) * 100 }
  })
})
const barsLabel = computed(() => `hist 的 ${LEVELS} 档：${bars.value.map((b) => `第 ${b.level} 档 ${b.got}${b.ok ? '' : `（应该是 ${b.want}）`}`).join('，')}。`)
const barsStat = computed(() => {
  const wrong = bars.value.filter((b) => !b.ok).length
  return wrong ? `数错了 ${wrong} 档：标「✗」的柱子下面写着该是几。` : `${LEVELS} 档都数对了。`
})

const rows = computed(() => {
  const t = table.value
  if (!t) return []
  return t.adds.map((row, block) => ({
    block,
    total: row.reduce((sum, n) => sum + n, 0),
    cells: row.map((n, level) => {
      const has = (BLOCK_COUNTS[block]?.[level] ?? 0) > 0
      return { level, n, has, wasted: n > 0 && !has, now: t.now[block][level] }
    }),
  }))
})
const tableStat = computed(() => {
  const { hist, shelf } = totals.value
  const lead = finished.value ? '' : '到这一步为止：'
  const wasted = rows.value.reduce((sum, r) => sum + r.cells.filter((c) => c.wasted).length, 0)
  const tail = wasted ? `，其中 ${wasted} 次加的是 0（标「!」）` : ''
  return `${lead}hist 前一共排了 ${hist} 次队${tail}；货架上原子加了 ${shelf} 次，每组各排各的。`
})
</script>

<template>
  <div class="hb">
    <p v-if="!result" class="hb__empty">{{ emptyText }}</p>
    <template v-else>
      <section v-if="finished" class="hb__part" aria-label="hist 的 8 档">
        <p class="hb__title">hist：每一档几个像素</p>
        <p class="hb__stat">{{ barsStat }}</p>
        <div class="hb__bars" role="img" :aria-label="barsLabel">
          <div v-for="b in bars" :key="b.level" class="hb__col" :class="{ 'is-wrong': !b.ok }" aria-hidden="true">
            <span class="hb__value">{{ b.got }}</span>
            <span class="hb__track">
              <span class="hb__target" :style="{ height: `${b.target}%` }" />
              <span class="hb__bar" :style="{ height: `${b.height}%` }" />
            </span>
            <span class="hb__level">
              <span class="hb__swatch" :style="{ background: SHADES[b.level] }" />{{ b.level }}
            </span>
            <span class="hb__want">{{ b.ok ? '✓' : `✗ 应 ${b.want}` }}</span>
          </div>
        </div>
      </section>
      <p v-else class="hb__stat">hist 的数跑完再画。下面先看每组往 hist 加了几次。</p>

      <section class="hb__part" aria-label="每组往 hist 原子加了几次">
        <p class="hb__title">每组往 hist 的每一格原子加了几次（显存上排的队，模拟）</p>
        <p class="hb__stat">{{ tableStat }}</p>
        <div class="hb__table-wrap">
          <table class="hb__table">
            <thead>
              <tr>
                <th scope="col">组</th>
                <th v-for="level in LEVELS" :key="level" scope="col">hist[{{ level - 1 }}]</th>
                <th scope="col">合计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.block">
                <th scope="row">block {{ r.block }}</th>
                <td
                  v-for="c in r.cells"
                  :key="c.level"
                  :class="{ 'is-has': c.has, 'is-wasted': c.wasted, 'is-now': c.now }"
                  :aria-label="`block ${r.block} 往 hist[${c.level}] 加了 ${c.n} 次${c.has ? '' : '，这一组没有这一档的像素'}`"
                >{{ c.n || '·' }}</td>
                <td class="hb__total">{{ r.total }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <ul class="hb__legend" aria-label="图例">
        <li><span class="hb__sw is-bar" aria-hidden="true" />运行后的数</li>
        <li><span class="hb__sw is-target" aria-hidden="true" />该有的数</li>
        <li><span class="hb__sw is-has" aria-hidden="true" />这一组有这一档的像素</li>
        <li><span class="hb__sw is-wasted" aria-hidden="true" />没有这一档，加的是 0</li>
        <li v-if="step"><span class="hb__sw is-now" aria-hidden="true" />这一步加到的格子</li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.hb {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.hb__empty {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.hb__part {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.hb__title {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.hb__stat {
  margin: 0;
  color: var(--hg-ink);
  font-size: 13px;
}

/* 8 根柱子：柱子是运行后的数，虚线框是该有的数（不只靠颜色：数错的柱子下面写「✗ 应 N」）。 */
.hb__bars {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  max-width: 480px;
}

.hb__col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 0;
}

.hb__value {
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.hb__track {
  position: relative;
  width: 100%;
  max-width: 34px;
  height: 96px;
  border-bottom: var(--hg-border-width) solid var(--hg-border-strong);
}

.hb__target,
.hb__bar {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 70%;
  transform: translateX(-50%);
  border-radius: 3px 3px 0 0;
}

.hb__target {
  border: 1.5px dashed var(--hg-ink-3);
  border-bottom: 0;
}

.hb__bar {
  width: 46%;
  background: var(--hg-accent);
  transition: height var(--motion-fast) var(--motion-ease-out);
}

.hb__col.is-wrong .hb__bar {
  background: var(--hg-error);
}

.hb__level {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.hb__swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: 2px;
}

.hb__want {
  color: var(--hg-ink-3);
  font-size: 11px;
  white-space: nowrap;
}

.hb__col.is-wrong .hb__want {
  color: var(--hg-error-ink);
  font-weight: 700;
}

/* 表格窄屏放不下时在这一块里横着滚，页面不跟着滚（01 第 7 节）。 */
.hb__table-wrap {
  min-width: 0;
  overflow-x: auto;
}

/* VitePress 正文里的表格是 display: block、带竖线和隔行底色，这里换回占满一行的普通表格（同 1-7 的 TripBoard）。 */
.hb__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.hb .hb__table tr {
  border: 0;
  background-color: transparent;
}

.hb .hb__table th,
.hb .hb__table td {
  padding: 5px 6px;
  border: 0;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
  text-align: center;
  white-space: nowrap;
}

.hb .hb__table th[scope='row'] {
  text-align: left;
}

.hb__table thead th {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 600;
}

.hb .hb__table td.is-has {
  background: var(--hg-accent-soft);
}

.hb .hb__table td.is-wasted {
  position: relative;
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 700;
}

.hb .hb__table td.is-wasted::after {
  position: absolute;
  top: 1px;
  right: 3px;
  content: '!';
  font-size: 10px;
}

.hb .hb__table td.is-now {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: -2px;
}

.hb__total {
  color: var(--hg-ink);
  font-weight: 700;
}

.hb__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.hb__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

.hb__sw {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background: var(--hg-surface);
}

.hb__sw.is-bar {
  border-color: var(--hg-accent);
  background: var(--hg-accent);
}

.hb__sw.is-target {
  border: 1.5px dashed var(--hg-ink-3);
  background: transparent;
}

.hb__sw.is-has {
  border-color: var(--hg-border);
  background: var(--hg-accent-soft);
}

.hb__sw.is-wasted {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
}

.hb__sw.is-now {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: -1px;
}

@media (max-width: 479px) {
  .hb {
    padding: 10px;
  }

  .hb .hb__table th,
  .hb .hb__table td {
    padding: 5px 4px;
  }
}
</style>
