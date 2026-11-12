<script setup lang="ts">
/**
 * 1-6 的小队板（关卡自己的 scenes，不用登记组件）：一次运行里每支小队在岔路口怎样走。
 * 数据是 challenge.ts 的 forkRows（从模拟器的写事件数出来：写 c 的 lane 做加法，写 d 的做减法）。
 *
 * 一支小队三行：名字、管的 t、分没分岔、走了几步；下面「加法那一段」「减法那一段」各一条，画法同 WaveView
 * 「这个 wave 走过的步」：这一段在干活的 lane 涂组色，空转的留白，没有线程的露出斜纹，每 8 个 lane 一道竖线。
 * 整队都不走的那一段写「整段跳过」，不画条。分成两拨的小队两条都有，一条接一条走，正好看出两段都要走一遍。
 * 状态不只靠颜色：留白、斜纹、「整段跳过」和每支小队的一句话（读屏读这一句）。
 */
import { computed } from 'vue'
import { JOB_NAME, type ForkRow, type Job } from '../challenge.ts'

const props = defineProps<{
  rows: readonly ForkRow[]
  /** 小队大小：32 或 64 */
  size: number
}>()

const JOBS = ['add', 'sub'] as const
const groupStyle = (b: number) => ({ '--blk': `var(--hg-group-${b % 6})` })
const manyBlocks = computed(() => new Set(props.rows.map((r) => r.block)).size > 1)

function name(r: ForkRow): string {
  return manyBlocks.value ? `第 ${r.block} 组的第 ${r.wave} 支` : `第 ${r.wave} 支`
}

function range(r: ForkRow): string {
  return r.last > r.first ? `t = ${r.first}～${r.last}` : `t = ${r.first}`
}

function count(r: ForkRow, job: 'add' | 'sub'): number {
  return job === 'add' ? r.adds : r.subs
}

/** 一支小队的一句话（也是读屏文字）：管哪些 t，两段各几个 lane 在干活，分没分岔，走了几步。 */
function label(r: ForkRow): string {
  const parts = JOBS.map((job) => (count(r, job) ? `${JOB_NAME[job]}那一段 ${count(r, job)} 个 lane 在干活` : `${JOB_NAME[job]}那一段整段跳过`))
  const verdict = r.split ? '在岔路口分成两拨，两段都要走' : '整队只走一边'
  return `${name(r)}小队（${range(r)}）：${parts.join('，')}；${verdict}，一共走了 ${r.steps} 步。`
}

/** 一段画成一条：这一段在干活的 lane 涂组色，空转的留白，没有线程的透出底下的斜纹。 */
function barStyle(r: ForkRow, job: Job) {
  const n = r.lanes.length
  const threads = r.last - r.first + 1
  const stops: string[] = []
  let from = 0
  const kind = (lane: number) => (lane >= threads ? 'empty' : r.lanes[lane] === job ? 'work' : 'idle')
  for (let lane = 1; lane <= n; lane++) {
    if (lane < n && kind(lane) === kind(from)) continue
    const k = kind(from)
    const color = k === 'work' ? 'var(--blk)' : k === 'idle' ? 'var(--hg-surface)' : 'transparent'
    stops.push(`${color} ${(from / n) * 100}% ${(lane / n) * 100}%`)
    from = lane
  }
  return { '--lanes': `linear-gradient(to right, ${stops.join(', ')})`, '--groups': n / 8 }
}
</script>

<template>
  <ol class="fb" :aria-label="`${rows.length} 支小队在岔路口怎样走`">
    <li v-for="r in rows" :key="`${r.block}-${r.wave}`" class="fb__squad" :style="groupStyle(r.block)">
      <span class="fb__sr">{{ label(r) }}</span>
      <p class="fb__head" aria-hidden="true">
        <strong class="fb__name">{{ name(r) }}</strong>
        <span class="fb__range">{{ range(r) }}</span>
        <span class="fb__tag" :class="r.split ? 'is-split' : 'is-whole'">{{ r.split ? '分成两拨' : '只走一边' }}</span>
        <span class="fb__steps">走了 {{ r.steps }} 步</span>
      </p>
      <div v-for="job in JOBS" :key="job" class="fb__row" aria-hidden="true">
        <span class="fb__job">{{ JOB_NAME[job] }}</span>
        <template v-if="count(r, job)">
          <span class="fb__bar" :style="barStyle(r, job)" />
          <span class="fb__count">{{ count(r, job) }}/{{ size }}</span>
        </template>
        <span v-else class="fb__skip">整段跳过</span>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.fb {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.fb__squad {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 8px 10px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-left: 3px solid var(--blk);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface);
}

.fb__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  margin: 0 0 2px;
  font-size: 13px;
}

.fb__name {
  color: var(--hg-ink);
  font-size: 14px;
}

.fb__range,
.fb__steps {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.fb__steps {
  margin-left: auto;
}

/* 分成两拨用琥珀（01 第 2.2 节：警告），只走一边用中性色；字写在标签里，不只靠颜色 */
.fb__tag {
  padding: 0 7px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.fb__tag.is-split {
  border-color: var(--hg-amber);
  color: var(--hg-amber-ink);
}

/* 一段一行：名字 · 条 · 几个 lane（同 1-5 小队板的 bars） */
.fb__row {
  display: grid;
  grid-template-columns: 2.6em minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 20px;
  color: var(--hg-ink-2);
  font-size: 12px;
}

.fb__job {
  white-space: nowrap;
}

/* 三层背景（同 WaveView 的掩码条）：每 8 个 lane 一道竖线；在干活的涂组色、空转的留白；没有线程的露出斜纹 */
.fb__bar {
  height: 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background:
    linear-gradient(to right, transparent calc(100% - 1px), var(--hg-border-strong) 0) 0 0 / calc(100% / var(--groups)) 100%,
    var(--lanes),
    repeating-linear-gradient(45deg, var(--hg-border) 0 2px, transparent 2px 5px);
}

.fb__count {
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  white-space: nowrap;
}

.fb__skip {
  grid-column: 2 / -1;
  color: var(--hg-ink-3);
}

.fb__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
