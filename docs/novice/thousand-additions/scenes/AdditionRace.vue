<script setup lang="ts">
/**
 * 1-1 的分工竞速（关卡自己的 scenes，不用登记组件）：左边 1 位教授，右边 1000 个学徒，做同一批加法。
 *
 * 读者在默认插槽里放的旋钮（Knob）改题目数量或题目种类，这里马上重画（03 第 1 节第 4 条）：
 * 两队的「开赛那一刻」（几个人在算）、时间轴上各自几拍交卷、一句话解读。点「开赛」看比赛的过程，
 * 能暂停、拖动（02 第 3 节：超过 1 秒的动画要能控制；离开视口就暂停）；减弱动效时「开赛」直接跳到结果。
 *
 * 画面全部是 challenge.ts 里纯函数的结果：某一拍时两边各做完几道、几个人在算（02 第 5 节）。
 * 拍数是比赛规则（模拟），动画速度和真实耗时无关，画面上都写明了。
 * 1000 个学徒画成一张点阵：点阵用 SVG 图案铺满，在算的那些用另一个图案盖上去，整张图只有几个元素。
 */
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useProgress } from '@course/useProgress.ts'
import {
  CREW_BEATS, CREW_SIZE, PROF_BEATS, crewAt, crewLap, describeRace, profAt, profLap, raceEnd, type Kind,
} from '../challenge.ts'

const props = defineProps<{
  /** 一共几道加法。 */
  n: number
  kind: Kind
}>()

/** 整场比赛画多久（毫秒）：只为了看得清，和真实耗时无关。 */
const DURATION = 3000
/** 点阵：40 列 × 25 行 = 1000 个学徒，每格 10 个单位。 */
const COLS = 40
const ROWS = CREW_SIZE / COLS
const CELL = 10

const race = computed(() => ({ n: props.n, kind: props.kind }))
const end = computed(() => raceEnd(race.value))
const prof = computed(() => profLap(props.n))
const crew = computed(() => crewLap(race.value))

const t = ref(0)
const playing = ref(false)

const profNow = computed(() => profAt(props.n, t.value))
const crewNow = computed(() => crewAt(race.value, t.value))
const beat = computed(() => Math.floor(t.value))

/** 标题里的题目：逐个相加数道数，累加数「几个数」。 */
const taskText = computed(() => (props.kind === 'sum' ? `累加 ${props.n} 个数` : `逐个相加 ${props.n} 道`))
/** 累加时学徒那边只有 1 个人能干活，其余的是「在等」；逐个相加时没分到题的是「闲着」。 */
const restWord = computed(() => (props.kind === 'sum' ? '在等' : '闲着'))

const profStatus = computed(() => {
  if (profNow.value.finished) return `交卷：${prof.value.beats} 拍`
  return `在算第 ${profNow.value.done + 1} ${props.kind === 'sum' ? '步' : '道'}`
})
const crewStatus = computed(() => {
  const now = crewNow.value
  if (now.finished) return `交卷：${crew.value.beats} 拍`
  return `${now.busy} 人在算，${CREW_SIZE - now.busy} 人${restWord.value}`
})
const crowdLabel = computed(() => {
  const now = crewNow.value
  if (now.finished) return `学徒交卷了：${now.worked} 个干过活，${CREW_SIZE - now.worked} 个一直没活干`
  return `${now.busy} 个学徒在算，${CREW_SIZE - now.busy} 个${restWord.value}`
})

const uid = useId()
const idleId = `${uid}-idle`
const doneId = `${uid}-done`
const busyId = `${uid}-busy`

/** 点阵里的前 count 个学徒：先盖满整行，再盖最后一行的前几个，最多两块矩形。 */
function firstDots(count: number) {
  const rows = Math.floor(count / COLS)
  const rest = count % COLS
  const rects = []
  if (rows) rects.push({ y: 0, width: COLS * CELL, height: rows * CELL })
  if (rest) rects.push({ y: rows * CELL, width: rest * CELL, height: CELL })
  return rects
}
/** 在算的、做完过题的学徒都是编号最小的那些（第几道题就派给第几个学徒）。 */
const busyDots = computed(() => firstDots(crewNow.value.busy))
const doneDots = computed(() => firstDots(crewNow.value.worked))

const pct = (beats: number) => (end.value > 0 ? `${(beats / end.value) * 100}%` : '0%')
const lanes = computed(() => [
  { key: 'prof', name: '教授', lap: prof.value.beats, now: Math.min(t.value, prof.value.beats) },
  { key: 'crew', name: '学徒', lap: crew.value.beats, now: Math.min(t.value, crew.value.beats) },
])
const first = computed(() => {
  if (prof.value.beats === crew.value.beats) return ''
  return prof.value.beats < crew.value.beats ? 'prof' : 'crew'
})

const reading = computed(() => describeRace(race.value))
const playLabel = computed(() => {
  if (playing.value) return '暂停'
  if (t.value >= end.value && end.value > 0) return '再比一场'
  return t.value > 0 ? '继续' : '开赛'
})
/** 拖动的步长：一场最多分 100 格，拍数少的时候一拍一格。 */
const scrubStep = computed(() => Math.max(1, Math.round(end.value / 100)))

// ── 播放 ────────────────────────────────────────────────────────────────

const progress = useProgress()
let raf = 0
let last = 0

function frame(now: number) {
  if (!playing.value) return
  t.value = Math.min(end.value, t.value + ((now - last) * end.value) / DURATION)
  last = now
  if (t.value >= end.value) {
    playing.value = false
    return
  }
  raf = requestAnimationFrame(frame)
}

function pause() {
  playing.value = false
  cancelAnimationFrame(raf)
}

function play() {
  if (end.value <= 0) return
  if (t.value >= end.value) t.value = 0
  // 02 第 4 节：系统的减弱动效、读者在设置里关掉动效或打开简洁模式，都不播放过程，直接给结果。
  const prefs = progress.state.prefs
  if (prefs.reducedMotion || prefs.plain || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    t.value = end.value
    return
  }
  playing.value = true
  last = performance.now()
  raf = requestAnimationFrame(frame)
}

function showResult() {
  pause()
  t.value = end.value
}

function scrub(event: Event) {
  pause()
  t.value = Math.min(end.value, Math.max(0, Number((event.target as HTMLInputElement).value)))
}

// 换了题目：回到开赛那一刻，数字和画面马上换（03 第 1 节第 4 条、02 第 3 节「交互优先」）。
watch(race, () => {
  pause()
  t.value = 0
})

const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
const onVisibility = () => {
  if (document.hidden) pause()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  // 02 第 3 节：离开视口就暂停
  if (typeof IntersectionObserver !== 'undefined' && root.value) {
    observer = new IntersectionObserver((entries) => {
      if (entries.every((entry) => !entry.isIntersecting)) pause()
    })
    observer.observe(root.value)
  }
})

onBeforeUnmount(() => {
  pause()
  document.removeEventListener('visibilitychange', onVisibility)
  observer?.disconnect()
})
</script>

<template>
  <section ref="root" class="ta-race" :aria-label="`分工竞速：教授和 ${CREW_SIZE} 个学徒，${taskText}`">
    <header class="ta-race__head">
      <span class="ta-race__eyebrow" aria-hidden="true">LAB</span>
      <strong class="ta-race__title">分工竞速：{{ taskText }}</strong>
      <span class="ta-race__tag">模拟</span>
    </header>

    <div v-if="$slots.default" class="ta-race__knobs"><slot /></div>

    <div class="ta-race__teams">
      <figure class="ta-team is-prof">
        <figcaption class="ta-team__head">
          <strong>教授</strong>
          <span>1 人 · {{ PROF_BEATS }} 拍一道</span>
        </figcaption>
        <div class="ta-team__art">
          <span
            class="ta-core"
            :class="{ 'is-busy': profNow.busy > 0 }"
            role="img"
            :aria-label="profNow.busy > 0 ? '教授在算' : '教授没在算'"
          />
        </div>
        <p class="ta-team__status" :class="{ 'is-done': profNow.finished }">
          <svg v-if="profNow.finished" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
          {{ profStatus }}
        </p>
        <p class="ta-team__count"><b>{{ profNow.done }}</b> / {{ n }} {{ kind === 'sum' ? '步' : '道' }}</p>
      </figure>

      <figure class="ta-team is-crew">
        <figcaption class="ta-team__head">
          <strong>学徒</strong>
          <span>{{ CREW_SIZE }} 人 · {{ CREW_BEATS }} 拍一道</span>
        </figcaption>
        <div class="ta-team__art">
          <svg
            class="ta-crowd"
            :viewBox="`0 0 ${COLS * CELL} ${ROWS * CELL}`"
            role="img"
            :aria-label="crowdLabel"
          >
            <defs>
              <pattern :id="idleId" :width="CELL" :height="CELL" patternUnits="userSpaceOnUse">
                <circle :cx="CELL / 2" :cy="CELL / 2" r="2.4" class="ta-dot is-idle" />
              </pattern>
              <pattern :id="doneId" :width="CELL" :height="CELL" patternUnits="userSpaceOnUse">
                <circle :cx="CELL / 2" :cy="CELL / 2" r="2.8" class="ta-dot is-done" />
              </pattern>
              <pattern :id="busyId" :width="CELL" :height="CELL" patternUnits="userSpaceOnUse">
                <circle :cx="CELL / 2" :cy="CELL / 2" r="3.6" class="ta-dot is-busy" />
              </pattern>
            </defs>
            <rect :width="COLS * CELL" :height="ROWS * CELL" :fill="`url(#${idleId})`" />
            <rect v-for="(r, k) in doneDots" :key="`d${k}`" :y="r.y" :width="r.width" :height="r.height" :fill="`url(#${doneId})`" />
            <rect v-for="(r, k) in busyDots" :key="`b${k}`" :y="r.y" :width="r.width" :height="r.height" :fill="`url(#${busyId})`" />
          </svg>
        </div>
        <p class="ta-team__status" :class="{ 'is-done': crewNow.finished }">
          <svg v-if="crewNow.finished" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
          {{ crewStatus }}
        </p>
        <p class="ta-team__count"><b>{{ crewNow.done }}</b> / {{ n }} {{ kind === 'sum' ? '步' : '道' }}</p>
      </figure>
    </div>

    <div class="ta-clock">
      <p class="ta-clock__label">时间轴（拍）</p>
      <div class="ta-clock__lanes" aria-hidden="true">
        <div v-for="lane in lanes" :key="lane.key" class="ta-lane">
          <span class="ta-lane__name">{{ lane.name }}</span>
          <span class="ta-lane__track">
            <i class="ta-lane__lap" :style="{ width: pct(lane.lap) }" />
            <i class="ta-lane__fill" :style="{ width: pct(lane.now) }" />
            <i class="ta-lane__head" :style="{ left: pct(t) }" />
          </span>
          <span class="ta-lane__value">
            {{ lane.lap }} 拍<em v-if="first === lane.key">先交卷</em>
          </span>
        </div>
      </div>

      <div class="ta-clock__transport">
        <button type="button" class="ta-button is-primary" @click="playing ? pause() : play()">{{ playLabel }}</button>
        <button type="button" class="ta-button" :disabled="t >= end" @click="showResult">直接看结果</button>
        <input
          class="ta-clock__range"
          type="range"
          min="0"
          :max="end"
          :step="scrubStep"
          :value="t"
          aria-label="拖动比赛时间"
          :aria-valuetext="`第 ${beat} 拍`"
          @input="scrub"
        >
        <span class="ta-clock__now">第 {{ beat }} 拍</span>
      </div>
      <p class="ta-clock__note">拍数是比赛规则（模拟），动画速度不代表真实耗时。</p>
    </div>

    <p class="ta-race__read" role="status">{{ reading }}</p>
  </section>
</template>

<style scoped>
.ta-race {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 20px 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.ta-race__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ta-race__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ta-race__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ta-race__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.ta-race__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 28px;
}

/* ---------- 两队：主机（CPU）在左，设备（GPU）在右（02 第 3 节）；窄屏上下排 ---------- */

.ta-race__teams {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 12px;
}

.ta-team {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.ta-team__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}

.ta-team__head strong {
  font-size: 16px;
}

.ta-team__head span {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.ta-team__art {
  display: grid;
  flex: 1;
  place-items: center;
  min-height: 112px;
}

/* 教授：一个大方块（强核）；在算时是强调色，没在算时是灰的空框。 */
.ta-core {
  display: block;
  width: 72px;
  height: 72px;
  border: 2px solid var(--hg-idle);
  border-radius: 16px;
  background: var(--hg-surface);
  transition: background-color var(--motion-base) var(--motion-ease-out), border-color var(--motion-base) var(--motion-ease-out);
}

.ta-core.is-busy {
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent);
}

/* 学徒：1000 个小点（小核）。在算的点最大、强调色；做完过题的是淡强调色；一直没活干的是小灰点。 */
.ta-crowd {
  display: block;
  width: 100%;
  max-width: 400px;
  height: auto;
}

.ta-dot.is-idle {
  fill: var(--hg-idle);
  opacity: 0.55;
}

.ta-dot.is-done {
  fill: var(--hg-accent);
  opacity: 0.5;
}

.ta-dot.is-busy {
  fill: var(--hg-accent);
}

.ta-team__status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 1.6em;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.ta-team__status.is-done {
  color: var(--hg-accent-ink);
  font-weight: 600;
}

.ta-team__status svg {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ta-team__count {
  margin: 0;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.ta-team__count b {
  color: var(--hg-ink);
  font-family: var(--hg-font-display);
  font-size: 18px;
}

/* ---------- 时间轴：时间从左到右（02 第 3 节）；淡色框是各自几拍交卷，实心是到这一拍做到哪了 ---------- */

.ta-clock {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ta-clock__label {
  margin: 0;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.ta-clock__lanes {
  display: grid;
  gap: 6px;
}

.ta-lane {
  display: grid;
  grid-template-columns: 2.5em minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.ta-lane__name {
  color: var(--hg-ink-2);
}

.ta-lane__track {
  position: relative;
  height: 14px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
  box-shadow: inset 0 0 0 1px var(--hg-border);
}

.ta-lane__lap,
.ta-lane__fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: var(--hg-radius-tag);
}

/* 几拍就交卷的那一队，框也至少留 3px，看得见。 */
.ta-lane__lap {
  min-width: 3px;
  background: var(--hg-accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hg-accent) 55%, transparent);
}

.ta-lane__fill {
  background: var(--hg-accent);
}

.ta-lane__head {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  border-radius: 1px;
  background: var(--hg-ink);
}

.ta-lane__value {
  min-width: 6.5em;
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  white-space: nowrap;
}

.ta-lane__value em {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-body);
  font-style: normal;
  font-weight: 600;
}

.ta-clock__transport {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}

.ta-button {
  min-height: 36px;
  padding: 0 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.ta-button.is-primary {
  min-width: 6.5em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.ta-button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.ta-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ta-clock__range {
  flex: 1 1 10em;
  min-width: 0;
  margin: 0;
  accent-color: var(--hg-accent);
}

.ta-clock__now {
  min-width: 6em;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.ta-button:focus-visible,
.ta-clock__range:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.ta-clock__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 12px;
}

.ta-race__read {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-accent-soft);
  color: var(--hg-ink);
  font-size: 15px;
}

@media (max-width: 639px) {
  .ta-race {
    padding: 16px 14px;
  }

  .ta-race__teams {
    grid-template-columns: minmax(0, 1fr);
  }

  .ta-team__art {
    min-height: 0;
  }

  .ta-lane__value {
    min-width: 0;
  }
}
</style>
