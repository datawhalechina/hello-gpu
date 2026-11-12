<script setup lang="ts">
/**
 * 先猜：读者先锁定一个答案，才看得到揭晓（03 第 1 节第 2 条、第 3 节组件登记表）。
 * 猜错不扣分、猜对也不加分；只记第一次锁定的答案（写进进度存档，F-04 的 recordPrediction），
 * 揭晓时对照「你刚才猜的是……」。不想猜的人可以「跳过预测，直接看」（03 第 4 节）。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <Predict
 *     stage="novice-thread-groups"
 *     id="p-groups"
 *     question="10 对数，每组 4 个线程，至少要派几组？"
 *     :options="[
 *       { label: '2 组', why: '2 组只有 8 个线程，还剩 2 对数没人算。' },
 *       { label: '3 组', correct: true, why: '3 组共 12 个线程，够用，还多出 2 个。' },
 *     ]"
 *   >
 *   默认插槽是揭晓后补充的话，可以不写。
 *   </Predict>
 *
 * id 是这道预测在全站的唯一编号（存档按它去重），stage 是关卡 id。
 * 选项不标 correct 也可以——「说说你的第一反应」这类题只对照不判对错。
 */
import { computed, ref, useId } from 'vue'
import { useProgress } from '@course/useProgress.ts'

interface PredictOption {
  /** 选项文字，用读者的话说。 */
  label: string
  /** 标出正确答案；一道题最多标一个，不标就只对照不判对错。 */
  correct?: boolean
  /** 揭晓时解释这个选项为什么对或为什么不对。 */
  why?: string
}

const props = defineProps<{
  /** 关卡 id（outline.json 里的那个）。 */
  stage: string
  /** 这道预测的唯一编号，存档按它只记第一次。 */
  id: string
  /** 问题，一句话。 */
  question: string
  options: readonly PredictOption[]
}>()

/** 存档里的「跳过预测」：choice 记成 -1，和没选过区分开。 */
const SKIPPED = -1

const progress = useProgress()
const uid = useId()
const titleId = `${uid}-q`

/** 还没锁定时读者点中的那个；锁定后一律以存档为准。 */
const picked = ref<number | null>(null)

const record = computed(() => progress.prediction(props.id))
const locked = computed(() => record.value !== null)
const skipped = computed(() => record.value?.choice === SKIPPED)
const chosen = computed(() => (record.value ? record.value.choice : picked.value))
const answer = computed(() => props.options.findIndex((o) => o.correct))

function lock() {
  if (picked.value === null || locked.value) return
  const index = picked.value
  progress.recordPrediction(props.id, index, Boolean(props.options[index]?.correct), props.stage)
}

function skip() {
  if (locked.value) return
  progress.recordPrediction(props.id, SKIPPED, false, props.stage)
}

/** 揭晓的第一句话：先复述读者的选择，再说答案（03 第 1 节第 2 条）。 */
const verdict = computed(() => {
  if (!locked.value) return ''
  const right = answer.value >= 0 ? props.options[answer.value].label : ''
  if (skipped.value) {
    return right ? `你跳过了这次预测。答案是「${right}」。` : '你跳过了这次预测，下面直接看结果。'
  }
  const mine = props.options[chosen.value ?? 0]?.label ?? ''
  if (answer.value < 0) return `你刚才猜的是「${mine}」。`
  if (record.value?.correct) return `你刚才猜的是「${mine}」，猜对了。`
  return `你刚才猜的是「${mine}」，答案是「${right}」。没猜中也不扣分，接下来正好看看为什么。`
})

/** 揭晓时解释两件事：你选的那个为什么不对，正确的那个为什么对。 */
const notes = computed(() => {
  if (!locked.value) return []
  const out: { key: number; badge: string; text: string }[] = []
  const mine = chosen.value
  if (mine !== null && mine !== SKIPPED && props.options[mine]?.why) {
    out.push({ key: mine, badge: '你的选择', text: props.options[mine].why as string })
  }
  if (answer.value >= 0 && answer.value !== mine && props.options[answer.value].why) {
    out.push({ key: answer.value, badge: '答案', text: props.options[answer.value].why as string })
  }
  return out
})

/** 选项都很短时按设计稿排成一行（「2 组 / 3 组 / 4 组 / 我不确定」），长句子仍然竖排。 */
const compact = computed(() => props.options.every((o) => o.label.length <= 10))
</script>

<template>
  <section class="hg-predict" :class="{ 'is-locked': locked }">
    <p :id="titleId" class="hg-predict__head">
      <span class="hg-predict__eyebrow" aria-hidden="true">PREDICT</span>
      <span class="hg-predict__question">{{ question }}</span>
    </p>

    <div class="hg-predict__options" :class="{ 'is-compact': compact }" role="radiogroup" :aria-labelledby="titleId">
      <label
        v-for="(option, index) in options"
        :key="index"
        class="hg-predict__option"
        :class="{
          'is-picked': chosen === index,
          'is-answer': locked && option.correct,
          'is-wrong': locked && chosen === index && !option.correct,
        }"
      >
        <input
          type="radio"
          :name="uid"
          :value="index"
          :checked="chosen === index"
          :disabled="locked"
          @change="picked = index"
        >
        <span class="hg-predict__label">{{ option.label }}</span>
        <!-- 两枚徽章作为一组整体换行：窄格子里先把徽章挤到第二行，不把「3 组」拆成两行。 -->
        <span v-if="locked && (chosen === index || option.correct)" class="hg-predict__badges">
          <span v-if="chosen === index" class="hg-predict__badge is-you">你的选择</span>
          <span v-if="option.correct" class="hg-predict__badge is-right">答案</span>
        </span>
      </label>
    </div>

    <div v-if="!locked" class="hg-predict__actions">
      <button type="button" class="hg-predict__button is-primary" :disabled="picked === null" @click="lock">
        锁定答案
      </button>
      <button type="button" class="hg-predict__button" @click="skip">跳过预测，直接看</button>
      <span class="hg-predict__hint">猜错不扣分，猜对也不加分，第一反应最有用。</span>
    </div>

    <div v-show="locked" class="hg-predict__reveal" aria-live="polite">
      <template v-if="locked">
        <p class="hg-predict__verdict">{{ verdict }}</p>
        <p v-for="note in notes" :key="note.key" class="hg-predict__note">
          <span class="hg-predict__badge" :class="note.badge === '答案' ? 'is-right' : 'is-you'">{{ note.badge }}</span>
          {{ note.text }}
        </p>
        <div v-if="$slots.default" class="hg-predict__more"><slot /></div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.hg-predict {
  margin: 20px 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.hg-predict__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0 0 12px;
}

.hg-predict__eyebrow {
  color: var(--hg-violet-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-predict__question {
  flex: 1;
  min-width: 12em;
  font-family: var(--hg-font-display);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.5;
}

.hg-predict__options {
  display: grid;
  gap: 10px;
}

.hg-predict__options.is-compact {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 120px), 1fr));
}

.hg-predict__option {
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

.hg-predict__option:hover {
  border-color: var(--hg-accent);
}

.hg-predict__option.is-picked {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

/* 锁定后：答案描边用强调色，选错的那个用错误色，两种都另有文字徽章（01 第 7 节）。 */
.is-locked .hg-predict__option {
  cursor: default;
}

.is-locked .hg-predict__option:hover {
  border-color: var(--hg-border-strong);
}

.hg-predict__option.is-answer,
.is-locked .hg-predict__option.is-answer:hover {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

.hg-predict__option.is-wrong,
.is-locked .hg-predict__option.is-wrong:hover {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
}

.hg-predict__option:has(input:focus-visible) {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-predict__option input {
  flex: none;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--hg-accent-ink);
}

.hg-predict__option input:focus-visible {
  outline: none;
}

/* 长选项：文字在单选框右边自己折行，不整段掉到下一行。 */
.hg-predict__label {
  flex: 1 1 0;
  min-width: 0;
  line-height: 1.5;
}

/* 短选项排成一行时：文字不折行，地方不够就让徽章整组换到下一行。 */
.is-compact .hg-predict__label {
  flex-basis: auto;
  white-space: nowrap;
}

.hg-predict__badges {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.hg-predict__badge {
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

.hg-predict__badge.is-right {
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

.hg-predict__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  margin-top: 14px;
}

.hg-predict__button {
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

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节）。 */
.hg-predict__button.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-predict__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.hg-predict__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-predict__button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-predict__hint {
  color: var(--hg-ink-3);
  font-size: 13px;
}

.hg-predict__reveal {
  margin-top: 14px;
  padding: 12px 16px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.hg-predict__verdict {
  margin: 0;
  font-weight: 600;
  line-height: 1.6;
}

.hg-predict__note {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 8px 0 0;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.6;
}

.hg-predict__more {
  margin-top: 8px;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: var(--hg-leading-body);
}

.hg-predict__more :deep(p) {
  margin: 0 0 6px;
}

.hg-predict__more :deep(p:last-child) {
  margin-bottom: 0;
}

@media (max-width: 480px) {
  .hg-predict {
    padding: 16px 16px;
  }
  .hg-predict__button {
    flex: 1 1 100%;
  }
}
</style>
