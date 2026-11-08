<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import './tokens.css'
import { ensureLoaded, lockPrediction, progress } from './store.ts'

interface Option {
  label: string
  correct?: boolean
  why?: string
}

const props = defineProps<{ stage: string; id: string; question: string; options: Option[] }>()
const picked = ref<number | null>(null)
const record = computed(() => progress.predictions[props.id])
const locked = computed(() => record.value !== undefined)
const chosen = computed(() => (record.value ? record.value.choice : picked.value))

onMounted(ensureLoaded)

function lock() {
  if (picked.value === null) return
  lockPrediction(props.stage, props.id, picked.value, !!props.options[picked.value].correct)
}
</script>

<template>
  <fieldset class="hgp-predict" :class="{ locked }">
    <legend><span class="tag">先猜一猜</span>{{ question }}</legend>
    <div class="opts">
      <label
        v-for="(o, i) in options"
        :key="i"
        class="opt"
        :class="{ picked: chosen === i, correct: locked && o.correct, wrong: locked && chosen === i && !o.correct }"
      >
        <input type="radio" :name="id" :checked="chosen === i" :disabled="locked" @change="picked = i" />
        <span class="text">{{ o.label }}</span>
        <span v-if="locked && chosen === i" class="badge you">你的选择</span>
        <span v-if="locked && o.correct" class="badge ans">答案</span>
        <span v-if="locked && o.why && (chosen === i || o.correct)" class="why">{{ o.why }}</span>
      </label>
    </div>
    <div v-if="!locked" class="actions">
      <button type="button" class="hgp-btn primary" :disabled="picked === null" @click="lock">锁定答案</button>
      <span class="hint">猜错不扣分，猜对也不加分，第一反应最有用。</span>
    </div>
    <div v-else class="reveal" aria-live="polite">
      <p class="verdict">{{ record?.correct ? '猜对了。' : '没猜中也没关系，接下来正好看看为什么。' }}</p>
      <div class="more"><slot /></div>
    </div>
  </fieldset>
</template>

<style scoped>
.hgp-predict {
  margin: 20px 0;
  padding: 14px 16px 12px;
  border: 1px solid var(--hg-border);
  border-radius: var(--hgp-radius);
  background: var(--hg-surface);
}
legend {
  padding: 0 4px;
  font-weight: 600;
  font-size: 16px;
}
.tag {
  margin-right: 8px;
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--hg-sim);
  color: var(--vp-c-bg);
  font-size: 12px;
  vertical-align: 2px;
}
.opts {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}
.opt {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--hg-border);
  border-radius: var(--hgp-radius);
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out);
}
.opt:hover {
  border-color: var(--vp-c-brand-1);
}
.opt.picked {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.locked .opt {
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
input {
  accent-color: var(--vp-c-brand-1);
}
input:focus-visible {
  outline: 2px solid var(--hg-focus);
  outline-offset: 2px;
}
.text {
  flex: 1;
  min-width: 10em;
}
.badge {
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
.badge.you {
  background: var(--hg-border);
}
.badge.ans {
  background: var(--hg-ok);
  color: var(--vp-c-bg);
}
.why {
  flex-basis: 100%;
  padding-left: 22px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 12px;
}
.hint {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.reveal {
  margin-top: 12px;
}
.verdict {
  margin: 0 0 4px;
  font-weight: 600;
}
.more :deep(p) {
  margin: 4px 0;
}
</style>
