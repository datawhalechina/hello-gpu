<script setup lang="ts">
/**
 * Boss 探索二「一份提速报告」（关卡自己的 scenes，不用登记组件）：识破题（04 第 4 节「识破假加速」）。
 *
 * 报告和它的计时代码（CodeView，按写法偏好）先摆出来；读者选一项「哪里不对」，锁定以后才揭晓。
 * 同先猜，只记第一次锁定的答案（进度存档的 predictions，id 是 SPOT_ID）：第一次就选对，发「识破假加速」徽章
 * （challenge.ts 的 lockSpot）；也可以不选、直接看答案，不发徽章。猜错不扣分。
 * 揭晓以后多一个开关「改后那次：照报告不同步 / 补上同步」，计时代码、时间线（CPU、GPU 两行，下面一行是三次看表）
 * 和量到的数马上跟着变。时间线照 1-11 的计时台走（challenge.ts 的 spotSession），数都是模拟值；不动画。
 * 开关不存草稿（同前几关只有旋钮的探索），刷新回到报告的量法。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { useProgress } from '@course/useProgress.ts'
import {
  LAUNCH_CYCLES, SPOT_GPU, SPOT_ID, SPOT_OPTIONS, SPOT_REPORT, SPOT_SKIPPED, lockSpot, spotCode, spotLines, spotSession,
  spotText, times, type SpotSegment,
} from '../challenge.ts'
import CodeView from './CodeView.vue'

const ANSWER = SPOT_OPTIONS.findIndex((o) => o.correct)

const progress = useProgress()
const uid = useId()
const titleId = `${uid}-title`
const questionId = `${uid}-q`

/** 还没锁定时读者点中的那个；锁定以后一律以存档为准。 */
const picked = ref<number | null>(null)
const record = computed(() => progress.prediction(SPOT_ID))
const locked = computed(() => record.value !== null)
const skipped = computed(() => record.value?.choice === SPOT_SKIPPED)
const chosen = computed(() => (record.value ? record.value.choice : picked.value))
const spotted = computed(() => Boolean(record.value?.correct))

function lock() {
  if (picked.value !== null) lockSpot(progress, picked.value)
}

/** 揭晓的第一句：先复述读者的选择，再说答案（同先猜）。 */
const verdict = computed(() => {
  if (!locked.value) return ''
  const right = SPOT_OPTIONS[ANSWER].label
  if (skipped.value) return `你没有选，直接看了答案：${right}。`
  const mine = SPOT_OPTIONS[chosen.value ?? 0]?.label ?? ''
  if (spotted.value) return `你选的是「${mine}」：识破了。「识破假加速」徽章到手。`
  return `你选的是「${mine}」。答案是「${right}」。没识破也不扣分，下面拨开关看看量法差在哪。`
})

/** 揭晓时解释两件事：你选的那个为什么不对，答案为什么对。 */
const notes = computed(() => {
  if (!locked.value) return []
  const out: { key: number; badge: string; text: string }[] = []
  const mine = chosen.value
  if (mine !== null && mine !== SPOT_SKIPPED && mine !== ANSWER) out.push({ key: mine, badge: '你的选择', text: SPOT_OPTIONS[mine].why })
  out.push({ key: ANSWER, badge: '答案', text: SPOT_OPTIONS[ANSWER].why })
  return out
})

// ── 揭晓以后：补不补同步 ──────────────────────────────────────────────────

const SYNC_OPTIONS = [
  { value: 'report', label: '照报告：不同步就看表' },
  { value: 'sync', label: '补上同步' },
]
const mode = ref<'report' | 'sync'>('report')
const sync = computed(() => locked.value && mode.value === 'sync')
const session = computed(() => spotSession(sync.value))

const code = computed(() => ({ hip: spotCode('hip', sync.value).join('\n'), python: spotCode('python', sync.value).join('\n') }))
/** 揭晓以后标一行：补上的同步；没补时标出停表太早的那一行（t2）。揭晓之前不标，免得透出答案。 */
const marks = computed(() => {
  if (!locked.value) return {}
  const lines = spotLines('hip', sync.value)
  const at = sync.value ? lines.findIndex((l) => l.mark) : lines.length - 1
  return { hip: [at + 1], python: [at + 1] }
})

const KIND_TEXT: Record<SpotSegment['kind'], string> = { launch: '启动', wait: '等 GPU', run: '' }
/** 段里写字的门槛：至少占整条的百分之几（短的段只靠颜色和 title）。 */
const LABEL_WIDTH = 14

function segmentText(s: SpotSegment): string {
  const which = s.which === 'before' ? '改前' : '改后'
  return s.kind === 'run' ? `算${which}` : `${KIND_TEXT[s.kind]}${which}`
}

const lanes = computed(() => (['cpu', 'gpu'] as const).map((lane) => ({
  lane,
  name: lane === 'cpu' ? 'CPU' : 'GPU',
  items: session.value.segments.filter((s) => s.lane === lane).map((s) => {
    const width = ((s.to - s.from) / session.value.end) * 100
    return {
      key: `${s.kind}-${s.which}`,
      cls: [`is-${s.kind}`, `is-${s.which}`],
      style: { left: `${(s.from / session.value.end) * 100}%`, width: `${width}%` },
      text: width >= LABEL_WIDTH ? segmentText(s) : '',
      title: `${segmentText(s)}：第 ${s.from}～${s.to} 个周期（${s.to - s.from} 个周期，模拟）`,
    }
  }),
})))

/** 三次看表：t1 的名字写在竖线左边，t2 写在右边（落在最右头时也写左边），两次挨得近时名字不叠在一起。 */
const ticks = computed(() => (['t0', 't1', 't2'] as const).map((name) => {
  const at = session.value[name]
  const left = name === 't1' || (name === 't2' && at >= session.value.end)
  return { name, at, left, style: { left: `${(at / session.value.end) * 100}%` } }
}))

const timelineLabel = computed(() => {
  const s = session.value
  const gpuEnd = s.segments.filter((x) => x.lane === 'gpu').reduce((m, x) => Math.max(m, x.to), 0)
  return `时间线（模拟）：t0 = ${s.t0} 看表；CPU 交出改前那张（${LAUNCH_CYCLES} 个周期），GPU 算 ${SPOT_GPU.before} 个周期，CPU 同步等它算完，t1 = ${s.t1}；`
    + `CPU 交出改后那张（${LAUNCH_CYCLES} 个周期）${sync.value ? '，同步等 GPU 算完' : '就看表'}，t2 = ${s.t2}；GPU 算改后那张，到第 ${gpuEnd} 个周期才做完。`
})
</script>

<template>
  <section class="sr" :class="{ 'is-locked': locked }" :aria-labelledby="titleId">
    <header class="sr__head">
      <span class="sr__eyebrow" aria-hidden="true">SPOT</span>
      <strong :id="titleId" class="sr__title">识破：这份报告哪里不对？</strong>
      <span class="sr__tag">模拟</span>
    </header>

    <div class="sr__report">
      <p class="sr__report-title">提速报告：第三张改好了</p>
      <p class="sr__report-body">
        改前 t1 − t0 = <strong>{{ SPOT_REPORT.before }}</strong> 个周期，改后 t2 − t1 = <strong>{{ SPOT_REPORT.after }}</strong> 个周期：
        快了 <strong>{{ times(SPOT_REPORT.before, SPOT_REPORT.after) }}</strong> 倍。下面是计时代码，<code>now()</code> 看一眼时钟。
      </p>
    </div>

    <CodeView :code="code" :marks="marks" />

    <p :id="questionId" class="sr__question">快了 {{ times(SPOT_REPORT.before, SPOT_REPORT.after) }} 倍，问题出在哪？</p>
    <div class="sr__options" role="radiogroup" :aria-labelledby="questionId">
      <label
        v-for="(option, index) in SPOT_OPTIONS"
        :key="index"
        class="sr__option"
        :class="{
          'is-picked': chosen === index,
          'is-answer': locked && option.correct,
          'is-wrong': locked && chosen === index && !option.correct,
        }"
      >
        <input type="radio" :name="uid" :value="index" :checked="chosen === index" :disabled="locked" @change="picked = index">
        <span class="sr__label">{{ option.label }}</span>
        <span v-if="locked && (chosen === index || option.correct)" class="sr__badges">
          <span v-if="chosen === index" class="sr__badge">你的选择</span>
          <span v-if="option.correct" class="sr__badge is-right">答案</span>
        </span>
      </label>
    </div>

    <div v-if="!locked" class="sr__actions">
      <button type="button" class="sr__button is-primary" :disabled="picked === null" @click="lock">锁定答案</button>
      <button type="button" class="sr__button" @click="lockSpot(progress, SPOT_SKIPPED)">不选了，直接看答案</button>
      <span class="sr__hint">只认第一次锁定的答案：第一次就选对，拿「识破假加速」徽章。选错不扣分。</span>
    </div>

    <div v-show="locked" class="sr__reveal" aria-live="polite">
      <template v-if="locked">
        <p class="sr__verdict">{{ verdict }}</p>
        <p v-for="note in notes" :key="note.key" class="sr__note">
          <span class="sr__badge" :class="{ 'is-right': note.badge === '答案' }">{{ note.badge }}</span>
          {{ note.text }}
        </p>
      </template>
    </div>

    <div v-if="locked" class="sr__lab">
      <Knob v-model="mode" label="改后那一次" :options="SYNC_OPTIONS" />

      <div class="sr__timeline" role="img" :aria-label="timelineLabel">
        <div v-for="lane in lanes" :key="lane.lane" class="sr__lane">
          <span class="sr__lane-name" aria-hidden="true">{{ lane.name }}</span>
          <div class="sr__track" aria-hidden="true">
            <span v-for="s in lane.items" :key="s.key" class="sr__seg" :class="s.cls" :style="s.style" :title="s.title">{{ s.text }}</span>
          </div>
        </div>
        <div class="sr__lane">
          <span class="sr__lane-name" aria-hidden="true">表</span>
          <div class="sr__track is-ticks" aria-hidden="true">
            <span v-for="t in ticks" :key="t.name" class="sr__tick" :class="[`is-${t.name}`, { 'is-left': t.left }]" :style="t.style">{{ t.name }}</span>
          </div>
        </div>
      </div>

      <p class="sr__readings">
        改前 t1 − t0 = {{ session.before }}，改后 t2 − t1 = {{ session.after }} 个周期：快了 {{ times(session.before, session.after) }} 倍（模拟）。
      </p>
      <p class="sr__text" aria-live="polite">{{ spotText(sync) }}</p>
    </div>
  </section>
</template>

<style scoped>
/* 卡片同先猜（Predict）：识破题也是先选、锁定、再揭晓；眉标用琥珀色，和先猜的紫色分开。 */
.sr {
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

.sr__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.sr__eyebrow {
  color: var(--hg-amber-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.sr__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.sr__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.sr__report {
  padding: 12px 16px;
  border-left: 3px solid var(--hg-amber);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.sr__report-title {
  margin: 0 0 4px;
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 700;
}

.sr__report-body {
  margin: 0;
  font-size: 15px;
}

.sr__report-body code {
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.sr__question {
  margin: 0;
  font-family: var(--hg-font-display);
  font-size: 17px;
  font-weight: 700;
}

.sr__options {
  display: grid;
  gap: 10px;
}

.sr__option {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  min-height: 46px;
  padding: 10px 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--motion-ease-out),
    background-color var(--motion-fast) var(--motion-ease-out);
}

.sr__option:hover {
  border-color: var(--hg-accent);
}

.sr__option.is-picked {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

.is-locked .sr__option {
  cursor: default;
}

.is-locked .sr__option:hover {
  border-color: var(--hg-border-strong);
}

.sr__option.is-answer,
.is-locked .sr__option.is-answer:hover {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

.sr__option.is-wrong,
.is-locked .sr__option.is-wrong:hover {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
}

.sr__option:has(input:focus-visible) {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.sr__option input {
  flex: none;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--hg-accent-ink);
}

.sr__option input:focus-visible {
  outline: none;
}

.sr__label {
  flex: 1 1 0;
  min-width: 0;
  line-height: 1.5;
}

.sr__badges {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.sr__badge {
  flex: none;
  padding: 2px 8px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  white-space: nowrap;
}

.sr__badge.is-right {
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

.sr__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}

.sr__button {
  min-height: 42px;
  padding: 0 18px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--motion-ease-out),
    background-color var(--motion-fast) var(--motion-ease-out);
}

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节，同先猜）。 */
.sr__button.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.sr__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.sr__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sr__button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.sr__hint {
  color: var(--hg-ink-3);
  font-size: 13px;
}

.sr__reveal {
  padding: 12px 16px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.sr__reveal:empty {
  display: none;
}

.sr__verdict {
  margin: 0;
  font-weight: 600;
  line-height: 1.6;
}

.sr__note {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 8px 0 0;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.6;
}

.sr__lab {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 时间线：左边一列写 CPU、GPU、表，右边按周期数等比例画段（同 1-11 的计时时间线）。 */
.sr__timeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.sr__lane {
  display: grid;
  grid-template-columns: 3em 1fr;
  align-items: center;
  gap: 8px;
}

.sr__lane-name {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
}

.sr__track {
  position: relative;
  height: 28px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface);
}

.sr__track.is-ticks {
  height: 22px;
  background: transparent;
}

.sr__seg {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 3px;
  overflow: hidden;
  border-radius: var(--hg-radius-tag);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.sr__seg.is-launch {
  background: var(--hg-ink-2);
  color: var(--hg-surface);
}

.sr__seg.is-wait {
  background: repeating-linear-gradient(135deg, var(--hg-surface-2) 0 5px, var(--hg-border) 5px 7px);
  color: var(--hg-ink-2);
}

.sr__seg.is-run.is-before {
  background: var(--hg-group-0-soft);
  box-shadow: inset 0 0 0 1px var(--hg-group-0);
  color: var(--hg-ink);
}

.sr__seg.is-run.is-after {
  background: var(--hg-group-1-soft);
  box-shadow: inset 0 0 0 1px var(--hg-group-1);
  color: var(--hg-ink);
}

/* 三次看表：竖线加名字，t2 用琥珀色，停表的那一刻一眼看得到。 */
.sr__tick {
  position: absolute;
  top: 0;
  padding-left: 4px;
  border-left: 2px solid var(--hg-ink-2);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
  line-height: 22px;
  white-space: nowrap;
  transform: translateX(-1px);
}

/* 名字写在竖线左边：竖线换到右边，整块往左挪自己的宽度。 */
.sr__tick.is-left {
  padding-right: 4px;
  padding-left: 0;
  border-right: 2px solid var(--hg-ink-2);
  border-left: 0;
  transform: translateX(calc(-100% + 1px));
}

.sr__tick.is-t2 {
  border-color: var(--hg-amber);
  color: var(--hg-amber-ink);
}

.sr__readings,
.sr__text {
  margin: 0;
  font-size: 15px;
}

.sr__readings {
  font-weight: 600;
}

@media (max-width: 639px) {
  .sr {
    padding: 16px 14px;
  }

  .sr__button {
    flex: 1 1 100%;
  }
}
</style>
