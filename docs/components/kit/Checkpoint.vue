<script setup lang="ts">
/**
 * 检查点：关卡末 2–3 道迁移题（03 第 3 节组件登记表、06 第 3 节第 9 项）。
 * 每个选项都有解释：选完一题马上说对错和原因，答错时再给出正确选项的解释，其余选项的解释可以展开看。
 * 全部作答后完成本关（04 第 2 节：完成关卡 = 检查点全部作答，100 XP；每关只计一次，重复作答不再加）。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <Checkpoint :questions="[
 *     { q: '13 对数、每组 4 个线程，至少几组？', options: [
 *       { label: '3 组', why: '3 组只有 12 个线程，最后 1 对数没人算。' },
 *       { label: '4 组', correct: true, why: '4 组 16 个线程，够用；多出来的 3 个要靠边界检查拦住。' },
 *     ] },
 *   ]" />
 *
 * 关卡 id 从页面 frontmatter 的 stage 读；预览页这类没有 stage 的页面用 stage 属性指定。
 * 完成时按 outline.json 判断 Boss 关（500 XP），并记下读者当前的写法或路线（「双语法」「双路线」徽章看它们），
 * 再判一次徽章（「首次通关」等）。作答记录不进存档：刷新后题目回到未作答，但本关已经完成的状态还在。
 * 真卡关卡看完了观摩（LabCard 的观摩模式，L-05）、又没有用真卡拿到星时，按观摩完成（04 第 2 节：100 XP，不得星）。
 * 根元素带 data-stage，观摩看完以后「去做检查点」按它找到本关的检查点。
 */
import { computed, reactive, ref, useId } from 'vue'
import { useData } from 'vitepress'
import { completeOptionsFor } from '@course/outline.ts'
import { XP_BOSS, XP_STAGE, XP_WATCH, type StageMode } from '@course/progress.ts'
import { useProgress } from '@course/useProgress.ts'

interface CheckpointOption {
  label: string
  correct?: boolean
  /** 为什么对 / 为什么不对。每个选项都要写。 */
  why: string
}

interface CheckpointQuestion {
  q: string
  options: CheckpointOption[]
}

const props = defineProps<{
  questions: readonly CheckpointQuestion[]
  /** 关卡 id；不写时读页面 frontmatter 的 stage。 */
  stage?: string
}>()

const { frontmatter } = useData()
const progress = useProgress()
const uid = useId()

const stageId = computed(() => {
  if (props.stage) return props.stage
  return typeof frontmatter.value.stage === 'string' ? frontmatter.value.stage : ''
})

const answers = reactive<(number | null)[]>(props.questions.map(() => null))
const answeredCount = computed(() => answers.filter((a) => a !== null).length)
const allAnswered = computed(() => answeredCount.value === props.questions.length)
const correctCount = computed(
  () => answers.filter((a, i) => a !== null && props.questions[i]?.options[a]?.correct).length,
)

const completed = computed(() => (stageId.value ? progress.stage(stageId.value).completed : false))
const watched = computed(() => (stageId.value ? progress.stage(stageId.value).watched : false))
/** 这次做完按哪种方式完成本关：真卡关卡看完了观摩、又没有用真卡拿到星，是观摩；其余照常。 */
const mode = computed<StageMode>(() => (stageId.value ? progress.completeModeOf(stageId.value) : 'normal'))
/** 观摩完成 100 XP，Boss 关完成 500 XP，其余 100 XP（04 第 2 节）。 */
const reward = computed(() => {
  if (mode.value === 'watch') return XP_WATCH
  return completeOptionsFor(stageId.value, progress.state.prefs).kind === 'boss' ? XP_BOSS : XP_STAGE
})
/** 开头那句：做完会怎样。 */
const lead = computed(() => {
  if (completed.value) return '做完就完成本关。'
  if (mode.value === 'watch') return `你看完了观摩：做完就以观摩完成本关，获得 ${reward.value} XP，不得星。`
  return `做完就完成本关，获得 ${reward.value} XP。`
})
/** 这一次作答是不是让本关第一次完成（决定结语里说不说「获得经验值」），以及是不是按观摩完成的。 */
const firstClear = ref(false)
const clearedBy = ref<StageMode>('normal')

function answer(qi: number, oi: number) {
  if (answers[qi] !== null) return
  answers[qi] = oi
  if (allAnswered.value) finish()
}

function finish() {
  const id = stageId.value
  if (!id) {
    console.error('[Hello GPU] Checkpoint 找不到关卡 id：页面 frontmatter 没有 stage，也没有传 stage 属性，这次作答不会记进度。')
    return
  }
  const before = progress.stage(id).completed
  clearedBy.value = mode.value
  progress.completeStage(id, { ...completeOptionsFor(id, progress.state.prefs), mode: mode.value })
  progress.checkBadges({ stage: id })
  firstClear.value = !before && progress.stage(id).completed
}

/** 再做一遍：清空作答，完成状态和经验值不变。 */
function retry() {
  answers.fill(null)
  firstClear.value = false
}

const rightOf = (qi: number) => props.questions[qi]?.options.find((o) => o.correct)
</script>

<template>
  <section class="hg-check" :data-stage="stageId || undefined" :aria-labelledby="`${uid}-title`">
    <header class="hg-check__head">
      <p :id="`${uid}-title`" class="hg-check__title">检查点 · {{ questions.length }} 道小题</p>
      <p class="hg-check__lead">{{ lead }}猜错不扣分，每个选项都有解释。</p>
      <p class="hg-check__count" aria-hidden="true">{{ answeredCount }} / {{ questions.length }}</p>
    </header>

    <ol class="hg-check__list">
      <li v-for="(item, qi) in questions" :key="qi" class="hg-check__q">
        <p :id="`${uid}-q${qi}`" class="hg-check__text">
          <span class="hg-check__num" aria-hidden="true">{{ qi + 1 }}</span>
          <span>{{ item.q }}</span>
        </p>
        <div class="hg-check__options" role="group" :aria-labelledby="`${uid}-q${qi}`">
          <!-- 答过以后用 aria-disabled 而不是 disabled：按钮不会把焦点弄丢，键盘读者可以接着往下走。 -->
          <button
            v-for="(option, oi) in item.options"
            :key="oi"
            type="button"
            class="hg-check__option"
            :class="{
              'is-chosen': answers[qi] === oi,
              'is-right': answers[qi] !== null && option.correct,
              'is-wrong': answers[qi] === oi && !option.correct,
            }"
            :aria-pressed="answers[qi] === oi"
            :aria-disabled="answers[qi] !== null"
            @click="answer(qi, oi)"
          >
            <span class="hg-check__label">{{ option.label }}</span>
            <span v-if="answers[qi] !== null && option.correct" class="hg-check__mark is-right">答案</span>
            <span v-else-if="answers[qi] === oi" class="hg-check__mark is-wrong">你的选择</span>
          </button>
        </div>

        <div class="hg-check__why" aria-live="polite">
          <template v-if="answers[qi] !== null">
            <p class="hg-check__verdict" :class="item.options[answers[qi] as number]?.correct ? 'is-right' : 'is-wrong'">
              {{ item.options[answers[qi] as number]?.correct ? '答对了。' : '不对。' }}{{ item.options[answers[qi] as number]?.why }}
            </p>
            <p v-if="!item.options[answers[qi] as number]?.correct && rightOf(qi)" class="hg-check__verdict">
              正确答案是「{{ rightOf(qi)?.label }}」：{{ rightOf(qi)?.why }}
            </p>
            <details class="hg-check__others">
              <summary>看看每个选项的解释</summary>
              <ul>
                <li v-for="(option, oi) in item.options" :key="oi">
                  <strong>{{ option.label }}</strong>{{ option.correct ? '（答案）' : '' }}：{{ option.why }}
                </li>
              </ul>
            </details>
          </template>
        </div>
      </li>
    </ol>

    <div class="hg-check__done" role="status">
      <template v-if="allAnswered">
        <p>
          <strong v-if="!stageId">这一页没有关卡 id，这次作答不记进度。</strong>
          <strong v-else-if="firstClear">{{ clearedBy === 'watch' ? '本关以观摩完成' : '本关完成' }}，获得 {{ reward }} XP。</strong>
          <strong v-else>本关已经完成过了，这次不重复加经验值。</strong>
          检查点答对 {{ correctCount }} / {{ questions.length }} 题。<template v-if="firstClear && clearedBy === 'watch'">观摩不得星：以后在真卡上做完实验室、导入通关码，照样可以拿星。</template>
        </p>
        <button type="button" class="hg-check__retry" @click="retry">再做一遍</button>
      </template>
      <p v-else-if="completed" class="hg-check__note">
        本关已经{{ watched ? '以观摩' : '' }}完成。想再练一遍，可以重新作答（不再加经验值）。
      </p>
    </div>
  </section>
</template>

<style scoped>
.hg-check {
  margin: 20px 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.hg-check__head {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 12px;
  margin-bottom: 14px;
}

.hg-check__title {
  margin: 0;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  font-weight: 700;
}

.hg-check__lead {
  grid-column: 1;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.hg-check__count {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  margin: 0;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-variant-numeric: tabular-nums;
}

.hg-check__list {
  display: grid;
  gap: 18px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-check__q {
  margin: 0;
}

.hg-check__text {
  display: flex;
  gap: 10px;
  margin: 0 0 10px;
  font-weight: 600;
  line-height: 1.6;
}

.hg-check__num {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  border-radius: 50%;
  background: var(--hg-surface-2);
  border: var(--hg-border-width) solid var(--hg-border);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-check__options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hg-check__option {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 64px;
  min-height: 42px;
  max-width: 100%;
  padding: 8px 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--motion-ease-out),
    background-color var(--motion-fast) var(--motion-ease-out);
}

.hg-check__option:not([aria-disabled='true']):hover {
  border-color: var(--hg-accent);
}

.hg-check__option[aria-disabled='true'] {
  cursor: default;
}

.hg-check__option:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* 答案用强调色、选错的用错误色，另外都有文字标记（01 第 7 节）。 */
.hg-check__option.is-right {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

.hg-check__option.is-wrong {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
}

.hg-check__label {
  min-width: 0;
}

.hg-check__mark {
  padding: 1px 8px;
  border-radius: var(--hg-radius-pill);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  white-space: nowrap;
}

.hg-check__mark.is-right {
  background: var(--hg-surface);
  color: var(--hg-accent-ink);
}

.hg-check__mark.is-wrong {
  background: var(--hg-surface);
  color: var(--hg-error-ink);
}

.hg-check__verdict {
  margin: 10px 0 0;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.6;
}

.hg-check__verdict.is-right {
  color: var(--hg-ink);
}

.hg-check__others {
  margin-top: 8px;
  color: var(--hg-ink-3);
  font-size: 14px;
}

.hg-check__others summary {
  width: fit-content;
  border-radius: var(--hg-radius-tag);
  cursor: pointer;
}

.hg-check__others summary:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-check__others ul {
  margin: 6px 0 0;
  padding-left: 20px;
  list-style: disc;
  color: var(--hg-ink-2);
  line-height: 1.6;
}

/* 播报区一直留在页面上（空的时候没有高度），出现文字时读屏才念得出来。 */
.hg-check__done:not(:empty) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  margin-top: 18px;
  padding: 12px 16px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-accent-soft);
  font-size: 15px;
}

.hg-check__done p {
  margin: 0;
}

.hg-check__note {
  color: var(--hg-ink-2);
}

.hg-check__retry {
  min-height: 40px;
  padding: 0 16px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.hg-check__retry:hover {
  border-color: var(--hg-accent);
}

.hg-check__retry:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

@media (max-width: 480px) {
  .hg-check {
    padding: 16px;
  }
  .hg-check__option {
    flex: 1 1 100%;
  }
}
</style>
