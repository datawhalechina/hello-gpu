<script setup lang="ts">
/**
 * 1-7 挑战的「跑了几趟」表（关卡自己的 scenes，不用登记组件）：放在代码沙盒的结果插槽里。
 *
 * 从模拟器的事件流数这支小队去城外仓库（显存）、车间货架（LDS）各跑了几趟，按 params.ts 的 fetchCycles
 * 算往返代价（模拟）；工具台（寄存器）上的数不用跑，不算趟数。单步时只数到这一步为止，这一步去过的地方标「这一步」。
 * 最后一行是合计，旁边写两条星级线（第二颗星、最少），读者对着看还差多少。
 */
import { computed } from 'vue'
import type { RunResult, SimEvent } from '@sim/lockstep.ts'
import type { SandboxStep } from '@kit/sandbox/run.ts'
import { BEST_COST, FETCH_CYCLES, TARGET_COST, costOf, tripCount, tripsOf } from '../challenge.ts'

const props = defineProps<{
  result: RunResult | null
  step: SandboxStep | null
}>()

/** 到这一步为止的事件，和这一步自己的事件。没在单步时就是整段。 */
const slices = computed(() => {
  const s = props.step
  if (s) return { done: s.result.events.slice(0, s.group.to), now: s.result.events.slice(s.group.from, s.group.to) }
  return { done: props.result?.events ?? [], now: [] as SimEvent[] }
})

const trips = computed(() => tripsOf(slices.value.done))
const nowSpaces = computed(() => new Set(slices.value.now.map((e) => e.space).filter(Boolean)))
const cost = computed(() => costOf(trips.value))

const rows = computed(() => [
  { key: 'vram', name: '城外仓库（显存）', legs: trips.value.vram, cycles: FETCH_CYCLES.vram, now: nowSpaces.value.has('global') },
  { key: 'lds', name: '车间货架（LDS）', legs: trips.value.lds, cycles: FETCH_CYCLES.lds, now: nowSpaces.value.has('lds') },
])

const partial = computed(() => Boolean(props.step && props.step.index < props.step.count - 1))
</script>

<template>
  <div class="tb">
    <p v-if="!result" class="tb__empty">还没运行：补好两个空，点「运行」。这里数一数这支小队去仓库、货架各跑了几趟。</p>
    <div v-else class="tb__scroll">
      <table class="tb__table">
        <caption>{{ partial ? `跑到第 ${step!.index + 1} 步为止` : '这一次一共' }}跑了几趟（周期数是模拟的）</caption>
        <thead>
          <tr>
            <th scope="col">地方</th>
            <th scope="col">趟数</th>
            <th scope="col">每趟几个周期</th>
            <th scope="col">往返代价</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.key" :class="{ 'is-now': r.now }">
            <th scope="row">{{ r.name }}<span v-if="r.now" class="tb__now">这一步</span></th>
            <td class="is-num">{{ tripCount(r.legs) }} 趟<span class="tb__legs">取 {{ r.legs.load }}、存 {{ r.legs.store }}</span></td>
            <td class="is-num">{{ r.cycles }}</td>
            <td class="is-num">{{ tripCount(r.legs) * r.cycles }}</td>
          </tr>
          <tr>
            <th scope="row">工具台（寄存器）</th>
            <td colspan="3">随手就拿，不用跑，不算趟数</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colspan="3">合计（模拟，单位：周期）</th>
            <td class="is-num is-total">{{ cost }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p v-if="result" class="tb__goal">第二颗星：{{ TARGET_COST }} 个周期以内。第三颗星：最少，{{ BEST_COST }} 个周期。</p>
  </div>
</template>

<style scoped>
.tb {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.tb__empty,
.tb__goal {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

/* 表格窄屏放不下时在这一块里横着滚，页面不跟着滚（01 第 7 节）。 */
.tb__scroll {
  min-width: 0;
  overflow-x: auto;
}

/* VitePress 正文里的表格是 display: block、带竖线和隔行底色，这里换回占满一行的普通表格。 */
.tb__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 14px;
}

.tb .tb__table tr {
  border: 0;
  background-color: transparent;
}

.tb__table caption {
  margin-bottom: 6px;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
  text-align: left;
}

.tb .tb__table th,
.tb .tb__table td {
  padding: 6px 8px;
  border: 0;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
  text-align: left;
  vertical-align: top;
}

.tb__table thead th {
  color: var(--hg-ink-3);
  font-size: 12px;
  font-weight: 600;
}

.tb__table tbody th {
  font-weight: 600;
}

.tb .tb__table tfoot th,
.tb .tb__table tfoot td {
  border-bottom: 0;
  font-weight: 700;
}

.is-num {
  font-family: var(--hg-font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.is-total {
  color: var(--hg-ink);
}

.tb__legs {
  display: block;
  color: var(--hg-ink-3);
  font-size: 12px;
}

/* 单步时这一步去过的地方：浅强调底 + 「这一步」字样，不只靠颜色。 */
.tb .tb__table tr.is-now {
  background: var(--hg-accent-soft);
}

.tb__now {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-accent-ink);
  color: var(--hg-surface);
  font-size: 11px;
  font-weight: 700;
  vertical-align: 1px;
}

@media (max-width: 479px) {
  .tb {
    padding: 10px;
  }

  .tb__table {
    font-size: 13px;
  }

  .tb .tb__table th,
  .tb .tb__table td {
    padding: 5px 4px;
  }
}
</style>
