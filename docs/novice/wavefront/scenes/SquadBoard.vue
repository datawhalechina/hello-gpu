<script setup lang="ts">
/**
 * 1-5 的小队板（关卡自己的 scenes，不用登记组件）：一次运行排成了哪些小队，每支小队的工位坐成什么样。
 * 数据是 challenge.ts 的 squadsOf（从模拟器的事件流数出来）。
 *
 * - bots（探索二，只派 1 组）：每支小队一排工位，有线程的站着线程小机器人（屏幕上是 threadIdx.x），
 *   被 if (i < n) 拦下的机器人熄屏打瞌睡（ThreadBot 的「检查后跳过」），没有线程的工位是虚线框。
 *   窄屏一行 8 个工位，宽屏一行 16 个（同 1-3 的工位图）。
 * - bars（挑战，最多 32 支小队）：按组分开，一支小队一条，同 WaveView 的掩码条：算了数的涂组色，
 *   被拦下的留白，没有线程的露出斜纹；每 8 个工位一道竖线。超过 12 支时在框里滚动。
 * 状态不只靠颜色：机器人的样子、虚线框、斜纹，每支小队还有一句话（读屏读这一句）。
 */
import { computed } from 'vue'
import ThreadBot from '@kit/ThreadBot.vue'
import type { Seat, Squad } from '../challenge.ts'

const props = withDefaults(defineProps<{
  squads: readonly Squad[]
  /** 小队大小：32 或 64 */
  size: number
  mode?: 'bots' | 'bars'
}>(), { mode: 'bots' })

/** bars 超过这么多支就在框里滚动 */
const SCROLL_SQUADS = 12

const groupStyle = (b: number) => ({ '--blk': `var(--hg-group-${b % 6})`, '--blk-soft': `var(--hg-group-${b % 6}-soft)` })

/** 按组分开：组号、这一组几个线程、排成的小队。 */
const byBlock = computed(() => {
  const out: { block: number; threads: number; squads: Squad[] }[] = []
  for (const s of props.squads) {
    let g = out[out.length - 1]
    if (g?.block !== s.block) {
      g = { block: s.block, threads: 0, squads: [] }
      out.push(g)
    }
    g.threads += s.members
    g.squads.push(s)
  }
  return out
})
const scrolls = computed(() => props.mode === 'bars' && props.squads.length > SCROLL_SQUADS)

function range(s: Squad): string {
  return s.members > 1 ? `threadIdx.x ${s.first}–${s.first + s.members - 1}` : `threadIdx.x ${s.first}`
}

/** 一支小队的一句话（也是读屏文字）：坐了几个人，几个被拦下，空着几个工位，走了几步。 */
function squadLabel(s: Squad): string {
  const who = byBlock.value.length > 1 ? `第 ${s.block} 组的第 ${s.wave} 支小队` : `第 ${s.wave} 支小队`
  const parts = [`${who}（${range(s)}）坐了 ${s.members} 人`]
  if (s.work < s.members) parts.push(s.work ? `${s.members - s.work} 人被 if (i < n) 拦下` : '全被 if (i < n) 拦下')
  if (s.members < props.size) parts.push(`空着 ${props.size - s.members} 个工位`)
  parts.push(`走了 ${s.steps} 步`)
  return `${parts.join('，')}。`
}

/** bars 一条后面的短字：几个人，几个被拦下，空着几个工位。 */
function rowText(s: Squad): string {
  const parts = [`${s.members} 人`]
  if (s.work < s.members) parts.push(`拦下 ${s.members - s.work}`)
  if (s.members < props.size) parts.push(`空 ${props.size - s.members}`)
  return parts.join(' · ')
}

const COLOR: Record<Seat, string> = { work: 'var(--blk)', skip: 'var(--hg-surface)', empty: 'transparent' }

/** 一支小队画成一条：连着的同一种工位并成一段。 */
function barStyle(s: Squad) {
  const n = s.seats.length
  const stops: string[] = []
  let from = 0
  for (let lane = 1; lane <= n; lane++) {
    if (lane < n && s.seats[lane] === s.seats[from]) continue
    stops.push(`${COLOR[s.seats[from]]} ${(from / n) * 100}% ${(lane / n) * 100}%`)
    from = lane
  }
  return { '--seats': `linear-gradient(to right, ${stops.join(', ')})`, '--groups': n / 8 }
}
</script>

<template>
  <ol v-if="mode === 'bots'" class="sb">
    <li v-for="s in squads" :key="`${s.block}-${s.wave}`" class="sb__squad" :style="groupStyle(s.block)">
      <p class="sb__name">
        <strong>第 {{ s.wave }} 支小队</strong>
        <span class="sb__meta">{{ range(s) }} · {{ s.members }} 人<template v-if="s.members < size"> · 空着 {{ size - s.members }} 个工位</template> · 走了 {{ s.steps }} 步</span>
      </p>
      <div class="sb__seats" role="img" :aria-label="squadLabel(s)">
        <span v-for="(seat, lane) in s.seats" :key="lane" class="sb__seat" :class="`is-${seat}`">
          <ThreadBot
            v-if="seat !== 'empty'"
            class="sb__bot"
            :state="seat === 'skip' ? 'skip' : 'write'"
            :color="s.block"
            :label="s.first + lane"
            :size="26"
            aria-hidden="true"
          />
          <span class="sb__no">{{ lane }}</span>
        </span>
      </div>
    </li>
  </ol>

  <div
    v-else
    class="sb sb--bars"
    :class="{ 'is-scroll': scrolls }"
    role="group"
    :tabindex="scrolls ? 0 : undefined"
    :aria-label="`${size} 人一队排成的 ${squads.length} 支小队${scrolls ? '（可以滚动）' : ''}`"
  >
    <section v-for="g in byBlock" :key="g.block" class="sb__block" :style="groupStyle(g.block)">
      <p class="sb__block-name"><span class="sb__dot" aria-hidden="true" />第 {{ g.block }} 组 · {{ g.threads }} 个线程</p>
      <ol class="sb__rows">
        <li v-for="s in g.squads" :key="s.wave" class="sb__row">
          <span class="sb__sr">{{ squadLabel(s) }}</span>
          <span class="sb__row-name" aria-hidden="true">第 {{ s.wave }} 支</span>
          <span class="sb__bar" :style="barStyle(s)" aria-hidden="true" />
          <span class="sb__row-count" aria-hidden="true">{{ rowText(s) }}</span>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.sb {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sb__squad {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.sb__name {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  margin: 0;
  font-size: 14px;
}

.sb__meta {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

/* 一支小队的工位：窄屏一行 8 个，宽屏一行 16 个；外框是这一组的颜色 */
.sb__seats {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 5px;
  padding: 8px;
  border: var(--hg-border-width) solid var(--blk);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .sb__seats {
    grid-template-columns: repeat(16, minmax(0, 1fr));
  }
}

/* 有线程的工位是实线框 + 机器人，空着的是虚线框（同 1-3 的工位图）：不只靠颜色 */
.sb__seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  min-width: 0;
  min-height: 52px;
  padding: 3px 0 2px;
  border: var(--hg-border-width) solid var(--hg-ink-3);
  border-radius: 6px;
  background: var(--hg-surface);
}

.sb__seat.is-empty {
  border-style: dashed;
  border-color: var(--hg-border-strong);
  background: transparent;
}

.sb__bot {
  max-width: 100%;
  height: auto;
}

.sb__no {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 10px;
  line-height: 1;
}

/* ── bars：按组分开，一支小队一条 ── */

.sb--bars {
  gap: 8px;
}

/* 超过 SCROLL_SQUADS 支在框里滚动 */
.sb--bars.is-scroll {
  max-height: 340px;
  padding: 6px 8px;
  overflow-y: auto;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-tag);
}

.sb--bars.is-scroll:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.sb__block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sb__block-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.sb__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--blk);
}

.sb__rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 宽屏一行：第几支 · 条 · 几个人；窄屏把条放到第二行，字不挤 */
.sb__row {
  position: relative;
  display: grid;
  grid-template-areas: 'name bar count';
  grid-template-columns: 3.6em minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px 8px;
  min-height: 22px;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
}

.sb__row-name {
  grid-area: name;
  white-space: nowrap;
}

.sb__row-count {
  grid-area: count;
  color: var(--hg-ink);
  white-space: nowrap;
}

/* 三层背景（同 WaveView 的掩码条）：每 8 个工位一道竖线；算了数的涂组色、被拦下的留白；没有线程的露出斜纹 */
.sb__bar {
  grid-area: bar;
  height: 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background:
    linear-gradient(to right, transparent calc(100% - 1px), var(--hg-border-strong) 0) 0 0 / calc(100% / var(--groups)) 100%,
    var(--seats),
    repeating-linear-gradient(45deg, var(--hg-border) 0 2px, transparent 2px 5px);
}

.sb__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 639px) {
  .sb__seats {
    gap: 4px;
    padding: 6px;
  }

  .sb__row {
    grid-template-areas: 'name count' 'bar bar';
    grid-template-columns: auto minmax(0, 1fr);
    padding-bottom: 4px;
    font-size: 11px;
  }
}
</style>
