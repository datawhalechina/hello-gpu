<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import './tokens.css'
import { ensureLoaded, finishStage, log, progress } from './store.ts'

interface Option {
  label: string
  correct?: boolean
  why: string
}
interface Question {
  q: string
  options: Option[]
}

const props = defineProps<{ stage: string; questions: Question[] }>()
const answers = reactive<Array<number | null>>(props.questions.map(() => null))
const allAnswered = computed(() => answers.every(a => a !== null))
const correctCount = computed(() => answers.filter((a, i) => a !== null && props.questions[i].options[a].correct).length)
const completed = computed(() => progress.stages[props.stage]?.completed ?? false)
const stars = computed(() => progress.stages[props.stage]?.stars.length ?? 0)

onMounted(ensureLoaded)

function chosen(qi: number): Option | undefined {
  const a = answers[qi]
  return a === null ? undefined : props.questions[qi].options[a]
}
function right(qi: number): Option | undefined {
  return props.questions[qi].options.find(o => o.correct)
}

function answer(qi: number, oi: number) {
  if (answers[qi] !== null) return
  answers[qi] = oi
  log(props.stage, 'checkpoint.answer', { q: qi, choice: oi, correct: !!props.questions[qi].options[oi].correct })
  if (allAnswered.value) finishStage(props.stage)
}
</script>

<template>
  <section class="hgp-check" aria-label="检查点">
    <div v-for="(item, qi) in questions" :key="qi" class="q">
      <p class="q-text"><span class="num">{{ qi + 1 }}</span>{{ item.q }}</p>
      <div class="opts" role="group" :aria-label="`第 ${qi + 1} 题选项`">
        <button
          v-for="(o, oi) in item.options"
          :key="oi"
          type="button"
          class="opt hgp-focusable"
          :class="{
            chosen: answers[qi] === oi,
            correct: answers[qi] !== null && o.correct,
            wrong: answers[qi] === oi && !o.correct,
          }"
          :disabled="answers[qi] !== null"
          @click="answer(qi, oi)"
        >
          {{ o.label }}
        </button>
      </div>
      <template v-if="chosen(qi)">
        <p class="why">{{ chosen(qi)?.correct ? '对。' : '不对。' }}{{ chosen(qi)?.why }}</p>
        <p v-if="!chosen(qi)?.correct" class="why">
          正确答案是「{{ right(qi)?.label }}」：{{ right(qi)?.why }}
        </p>
      </template>
    </div>
    <div v-if="allAnswered || completed" class="done" role="status">
      <strong>本关完成。</strong>
      <span v-if="allAnswered">检查点答对 {{ correctCount }} / {{ questions.length }} 题，</span>
      <span>挑战拿到 {{ stars }} / 3 颗星。</span>
      <span v-if="stars < 3">回到上面的挑战，还能继续拿星。</span>
    </div>
  </section>
</template>

<style scoped>
.hgp-check {
  display: grid;
  gap: 18px;
  margin: 20px 0;
}
.q-text {
  margin: 0 0 8px;
  font-weight: 600;
}
.num {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-right: 8px;
  border-radius: 50%;
  background: var(--hg-border);
  font-size: 12px;
}
.opts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.opt {
  min-width: 64px;
  min-height: 40px;
  padding: 6px 14px;
  border: 1px solid var(--hg-border);
  border-radius: var(--hgp-radius);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 15px;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out);
}
.opt:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}
.opt:disabled {
  cursor: default;
}
.opt.correct {
  border-color: var(--hg-ok);
  background: var(--hg-ok-soft);
}
.opt.wrong {
  border-color: var(--hg-warn);
  background: var(--hg-warn-soft);
}
.why {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.done {
  padding: 12px 14px;
  border-radius: var(--hgp-radius);
  background: var(--hg-ok-soft);
  font-size: 15px;
}
</style>
