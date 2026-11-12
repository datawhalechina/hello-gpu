<script setup lang="ts">
/**
 * 提示阶梯（F-12；03 第 4 节「提示阶梯」「错误信息」，04 第 3 节）。
 *
 * 显示一个挑战现在能看的提示：没过第 2 次给方向，第 4 次给位置，第 6 次可以看答案。
 * 在挑战（和综合关的分题）里看答案以后本关最高 2 星（看之前就写明）；探索环节看答案不影响星级。副本（X-01）的挑战同样最高 2 星，
 * 看答案也会让页面下面的题解（Solution）展开，看之前一并写明。
 * 最近一次没过时，先把错误说明写成「现象 / 原因 / 怎么改」，编译器或解析器的原文收在折叠块里。
 *
 * 挑战组件里内嵌一份：<HintLadder :challenge="ch" />（ch 是 useChallenge 的返回值）；
 * 关卡状态栏的提示按钮打开的是同一份状态，两边一起变。
 */
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useData } from 'vitepress'
import { failuresToNext, HINT_STEPS, HINT_UNLOCK, missingErrorParts, type Challenge, type HintStep } from '@course/useChallenge.ts'
import { MAX_STARS_AFTER_ANSWER } from '@course/progress.ts'
import { exerciseById } from '@course/outline.ts'
import { contentError } from './contentError.ts'
import Mascot from './Mascot.vue'

const props = defineProps<{ challenge: Challenge }>()

const STEP_NAMES: Record<HintStep, string> = { direction: '方向提示', location: '位置提示', answer: '看答案' }
/** 小核的一句话（04 第 6 节：不超过 30 字），按解锁到第几级换。 */
const LINES = [
  '先自己试试，没过两次我就给你一个方向。',
  '先给个方向：往这边想想。',
  '再具体一点：看看这个位置。',
  '卡住也没关系，可以直接看答案。',
]

const { page } = useData()
const uid = useId()

const level = computed(() => props.challenge.level.value)
const record = computed(() => props.challenge.record)
const hints = computed(() => props.challenge.hints)
const error = computed(() => props.challenge.lastError.value)
/** 挑战和综合关的分题：看答案以后本关最高 2 星；探索环节不影响。 */
const capsStars = computed(() => props.challenge.kind !== 'explore')
/** 副本的挑战：星的上限说「这道题」，看答案还会展开题解。 */
const isExercise = computed(() => Boolean(exerciseById(props.challenge.stage)))

const steps = computed(() => HINT_STEPS.map((step, i) => ({
  step,
  name: STEP_NAMES[step],
  open: level.value > i,
  at: HINT_UNLOCK[i],
})))

/** 写关卡的人漏写了东西：开发时画红框、控制台报错（这些都在读者操作之后才出现，构建拦不到）。 */
const problem = computed(() => {
  if (!hints.value) return contentError(`挑战「${props.challenge.id}」没有配置提示（useChallenge 的 hints）。`, page.value.relativePath)
  if (!error.value) return ''
  const missing = missingErrorParts(error.value)
  return missing.length ? contentError(`挑战「${props.challenge.id}」的错误说明缺了：${missing.join('、')}。`, page.value.relativePath) : ''
})

const capNote = computed(() => {
  if (!capsStars.value) return '这里是探索环节，看答案不影响星级。'
  const scope = isExercise.value ? '这道题' : '本关'
  if (record.value.revealed) return `看过答案，${scope}最高 ${MAX_STARS_AFTER_ANSWER} 星；已经拿到的星不会收回。`
  return isExercise.value
    ? `在挑战里看答案以后，这道题最高 ${MAX_STARS_AFTER_ANSWER} 星，下面的题解也会展开。`
    : `在挑战里看答案以后，本关最高 ${MAX_STARS_AFTER_ANSWER} 星。`
})

/** 新解锁一级时用 aria-live 播报一句。 */
const announce = ref('')
watch(level, (now, before) => {
  // 重置以后阶梯回到 0：旧的播报清掉，免得读屏再读到过时的一句。
  announce.value = now > before ? `${STEP_NAMES[HINT_STEPS[now - 1]]}解锁了。` : ''
})

const answerOpen = computed(() => record.value.revealed)
const root = ref<HTMLElement | null>(null)
/** 「看答案」按钮点完就换成答案：焦点跟过去，键盘读者从答案接着往下读。 */
function reveal() {
  if (!props.challenge.revealAnswer()) return
  void nextTick(() => root.value?.querySelector<HTMLElement>('.hg-hint__answer')?.focus())
}
</script>

<template>
  <section ref="root" class="hg-hint" :aria-labelledby="`${uid}-title`">
    <header class="hg-hint__head">
      <span class="hg-hint__eyebrow" aria-hidden="true">HINT</span>
      <h3 :id="`${uid}-title`" class="hg-hint__title">提示</h3>
      <span v-if="record.attempts" class="hg-hint__count">试了 {{ record.attempts }} 次，没过 {{ record.failures }} 次</span>
    </header>

    <p v-if="problem" class="hg-hint__problem" role="alert" data-hg-content-error>{{ problem }}</p>

    <div class="hg-hint__guide">
      <Mascot mood="hint" :size="56" />
      <p>{{ LINES[level] }}</p>
    </div>

    <div v-if="error" class="hg-hint__error">
      <p class="hg-hint__error-title">这次的问题</p>
      <dl>
        <div><dt>现象</dt><dd>{{ error.symptom }}</dd></div>
        <div><dt>原因</dt><dd>{{ error.cause }}</dd></div>
        <div><dt>怎么改</dt><dd>{{ error.fix }}</dd></div>
      </dl>
      <details v-if="error.raw" class="hg-hint__raw">
        <summary>原始报错</summary>
        <pre><code>{{ error.raw }}</code></pre>
      </details>
    </div>

    <ol v-if="hints" class="hg-hint__steps">
      <li v-for="s in steps" :key="s.step" class="hg-hint__step" :class="{ 'is-open': s.open }">
        <p class="hg-hint__step-name">
          <span class="hg-hint__mark" aria-hidden="true">
            <svg v-if="s.open" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7" /></svg>
            <svg v-else viewBox="0 0 16 16"><rect x="4" y="7.5" width="8" height="6" rx="1.5" /><path d="M5.8 7.5V5.6a2.2 2.2 0 0 1 4.4 0v1.9" /></svg>
          </span>
          {{ s.name }}
          <span v-if="!s.open" class="hg-hint__lock">没过 {{ s.at }} 次后解锁，还差 {{ s.at - record.failures }} 次</span>
        </p>
        <template v-if="s.open">
          <p v-if="s.step === 'direction'" class="hg-hint__text">{{ hints.direction }}</p>
          <p v-else-if="s.step === 'location'" class="hg-hint__text">{{ hints.location }}</p>
          <template v-else>
            <p class="hg-hint__cap">{{ capNote }}</p>
            <button v-if="!answerOpen" type="button" class="hg-hint__reveal" @click="reveal">看答案</button>
            <div v-else class="hg-hint__answer" tabindex="-1">
              <p class="hg-hint__text">{{ hints.answer }}</p>
              <pre v-if="hints.answerCode"><code>{{ hints.answerCode }}</code></pre>
            </div>
          </template>
        </template>
      </li>
    </ol>

    <p v-if="hints && level < 3 && record.failures > 0" class="hg-hint__next">
      再没过 {{ failuresToNext(record.failures) }} 次就解锁{{ STEP_NAMES[HINT_STEPS[level]] }}。没过不扣经验值，可以一直试。
    </p>

    <p class="hg-visually-hidden" aria-live="polite">{{ announce }}</p>
  </section>
</template>

<style scoped>
.hg-hint {
  margin: 20px 0;
  padding: 18px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.hg-hint__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.hg-hint__eyebrow {
  color: var(--hg-amber-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-hint__title {
  margin: 0;
  padding: 0;
  border: 0;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  letter-spacing: 0;
}

.hg-hint__count {
  margin-left: auto;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-hint__problem {
  margin: 12px 0 0;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

.hg-hint__guide {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 10px 0 4px;
}

.hg-hint__guide p {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.hg-hint__error {
  margin: 12px 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
}

.hg-hint__error-title {
  margin: 0 0 6px;
  color: var(--hg-error-ink);
  font-weight: 700;
}

.hg-hint__error dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  margin: 0;
}

.hg-hint__error dl > div {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 8px;
}

.hg-hint__error dt {
  color: var(--hg-ink-2);
  font-weight: 600;
}

.hg-hint__error dd {
  margin: 0;
}

.hg-hint__raw {
  margin-top: 8px;
}

.hg-hint__raw summary {
  color: var(--hg-ink-2);
  font-size: 14px;
  cursor: pointer;
}

.hg-hint__raw pre,
.hg-hint__answer pre {
  margin: 8px 0 0;
  padding: 10px 14px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  overflow-x: auto;
}

/* minmax(0, 1fr)：答案代码很长时在代码块里横向滚动，不把整张卡片撑出屏幕。 */
.hg-hint__steps {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.hg-hint__step {
  margin: 0;
  padding: 10px 14px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.hg-hint__step.is-open {
  border-style: solid;
  border-color: var(--hg-amber);
  background: var(--hg-surface);
}

.hg-hint__step-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin: 0;
  font-weight: 700;
}

.hg-hint__mark svg {
  display: block;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hg-hint__step:not(.is-open) .hg-hint__step-name {
  color: var(--hg-ink-3);
}

.hg-hint__step.is-open .hg-hint__mark {
  color: var(--hg-amber-ink);
}

.hg-hint__lock {
  color: var(--hg-ink-3);
  font-size: 13px;
  font-weight: 400;
}

.hg-hint__text,
.hg-hint__cap {
  margin: 6px 0 0;
}

.hg-hint__cap {
  color: var(--hg-amber-ink);
  font-size: 14px;
}

.hg-hint__reveal {
  min-height: 36px;
  margin-top: 8px;
  padding: 0 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.hg-hint__reveal:hover {
  border-color: var(--hg-amber);
}

.hg-hint__reveal:focus-visible,
.hg-hint__answer:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-hint__answer:focus:not(:focus-visible) {
  outline: none;
}

.hg-hint__next {
  margin: 10px 0 0;
  color: var(--hg-ink-3);
  font-size: 14px;
}

.hg-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
