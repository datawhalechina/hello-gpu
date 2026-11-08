<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import './tokens.css'
import Knob from './Knob.vue'
import ThreadGrid from './ThreadGrid.vue'
import { earnStar, ensureLoaded, lang, loaded, log, progress, pushToast, viewAnswer } from './store.ts'
import { parseIndexExpr, type Expr, type Lang } from '../sim/expr.ts'
import { simulate, type LaunchConfig } from '../sim/launch.ts'

type Field = 'blockDim' | 'gridDim' | 'formula' | 'guard'
type Judge = (expr: Expr, lang: Lang, cfg: LaunchConfig, alt: number[]) => { earned: boolean[]; next: string }

const props = withDefaults(
  defineProps<{
    stage: string
    id: string
    n: number
    blockDim: number
    blockDimOptions?: number[]
    gridDim: number
    gridDimMax?: number
    formula?: string
    guard?: boolean
    editable?: Field[]
    /** 需要先锁定答案的「先猜」id */
    requires?: string
    goal?: 'none' | 'covered' | 'covered-no-oob'
    successText?: string
    hints?: string[]
    answer?: string
    /** 挑战模式：传入本关的星级判定函数 */
    judge?: Judge
    altBlockDims?: number[]
    starLabels?: readonly string[]
  }>(),
  {
    blockDimOptions: () => [2, 4, 8],
    gridDimMax: 6,
    formula: '',
    guard: false,
    editable: () => [],
    goal: 'none',
    successText: '',
    hints: () => [],
    answer: '',
    altBlockDims: () => [2, 4, 8],
    starLabels: () => [],
  },
)

const can = (f: Field) => props.editable.includes(f)

const bd = ref(props.blockDim)
const gd = ref(props.gridDim)
const guardOn = ref(props.guard)
const draft = ref(props.formula)
const applied = ref(props.formula)
const failedRuns = ref(0)
const answerShown = ref(false)
const gateSkipped = ref(false)
const everSucceeded = ref(false)

onMounted(ensureLoaded)

const cfg = computed<LaunchConfig>(() => ({ n: props.n, blockDim: bd.value, gridDim: gd.value, guard: guardOn.value }))
const parsed = computed(() => parseIndexExpr(applied.value, lang.value))
const result = computed(() => (parsed.value.ok ? simulate(parsed.value.expr, lang.value, cfg.value) : null))
const dirty = computed(() => can('formula') && draft.value !== applied.value)
const ranOnce = ref(false)
const pad = (count: number) => ' '.repeat(count)
const runError = computed(() => {
  if (!parsed.value.ok) return applied.value.trim() || ranOnce.value ? parsed.value.error.message : ''
  if (result.value && !result.value.ok) {
    return `第 ${result.value.block} 组第 ${result.value.thread} 个线程算下标时出错：${result.value.error}`
  }
  return ''
})

const success = computed(() => {
  const r = result.value
  if (!r || !r.ok) return false
  if (props.judge) return r.summary.allCorrect && r.summary.oobWrites === 0
  if (props.goal === 'covered') return r.summary.allCorrect && r.summary.duplicates === 0
  if (props.goal === 'covered-no-oob') return r.summary.allCorrect && r.summary.duplicates === 0 && r.summary.oobWrites === 0
  return false
})

const verdict = computed(() => {
  if (!props.judge) return null
  if (!parsed.value.ok) return { earned: [false, false, false], next: '先写出拿数的规则，再点运行。' }
  return props.judge(parsed.value.expr, lang.value, cfg.value, props.altBlockDims)
})
const storedStars = computed(() => progress.stages[props.stage]?.stars ?? [])
const capped = computed(() => progress.stages[props.stage]?.answerViewed ?? false)

const gated = computed(() => !!props.requires && loaded.value && !progress.predictions[props.requires] && !gateSkipped.value)
const gatedBeforeLoad = computed(() => !!props.requires && !loaded.value)

const hintLevel = computed(() => (failedRuns.value >= 4 ? 2 : failedRuns.value >= 2 ? 1 : 0))
const canShowAnswer = computed(() => !!props.answer && failedRuns.value >= 6)

watch(success, value => {
  if (value && !everSucceeded.value) {
    everSucceeded.value = true
    log(props.stage, 'lab.success', { lab: props.id, formula: applied.value, cfg: cfg.value })
  }
})

watch(
  () => verdict.value?.earned.join(','),
  () => {
    const v = verdict.value
    if (!v || !loaded.value || gated.value) return
    v.earned.forEach((got, i) => {
      if (!got) return
      if (i === 2 && capped.value) return
      earnStar(props.stage, i, props.starLabels[i] ?? '')
    })
  },
)

watch(lang, () => log(props.stage, 'lab.lang', { lab: props.id, lang: lang.value }))

function run() {
  ranOnce.value = true
  applied.value = draft.value
  const ok = parsed.value.ok && result.value?.ok
  const succeeded = ok && success.value
  if (!succeeded) failedRuns.value++
  log(props.stage, 'lab.run', {
    lab: props.id,
    formula: applied.value,
    lang: lang.value,
    cfg: cfg.value,
    ok,
    success: succeeded,
    error: runError.value || undefined,
    summary: result.value && result.value.ok ? result.value.summary : undefined,
    failedRuns: failedRuns.value,
  })
  if (failedRuns.value === 2 || failedRuns.value === 4) log(props.stage, 'lab.hint', { lab: props.id, level: hintLevel.value })
}

function setBlockDim(v: number) {
  bd.value = v
  log(props.stage, 'lab.knob', { lab: props.id, key: 'blockDim', value: v })
}
function setGridDim(v: number) {
  gd.value = v
  log(props.stage, 'lab.knob', { lab: props.id, key: 'gridDim', value: v })
}
function toggleGuard() {
  guardOn.value = !guardOn.value
  log(props.stage, 'lab.guard', { lab: props.id, value: guardOn.value })
}

function showAnswer() {
  answerShown.value = true
  viewAnswer(props.stage, props.id, !!props.judge)
  if (props.judge) pushToast('看过答案，本关最高 2 星', 'info')
}
function fillAnswer() {
  draft.value = props.answer
  run()
}
function skipGate() {
  gateSkipped.value = true
  log(props.stage, 'lab.gate.skip', { lab: props.id })
}
</script>

<template>
  <section class="hgp-lab" :class="{ gated: gated || gatedBeforeLoad }">
    <div v-if="gated" class="gate" role="note">
      <p>先在上面猜一猜，再动手看结果。</p>
      <button type="button" class="hgp-btn" @click="skipGate">跳过预测，直接看</button>
    </div>

    <div class="body" :inert="gated || gatedBeforeLoad">
      <div class="controls">
        <Knob
          v-if="can('blockDim')"
          label="每组人数"
          code="blockDim.x"
          :options="blockDimOptions"
          :model-value="bd"
          @update:model-value="setBlockDim"
        />
        <div v-else class="fixed">每组人数 <code>blockDim.x</code> = <strong>{{ bd }}</strong></div>
        <Knob
          v-if="can('gridDim')"
          label="组数"
          code="gridDim.x"
          :min="1"
          :max="gridDimMax"
          :model-value="gd"
          @update:model-value="setGridDim"
        />
        <div v-else class="fixed">组数 <code>gridDim.x</code> = <strong>{{ gd }}</strong></div>
        <div class="fixed">数据个数 <code>n</code> = <strong>{{ n }}</strong></div>
      </div>

      <div class="code" :class="lang" role="group" aria-label="kernel 代码">
        <template v-if="lang === 'hip'">
          <div class="line"><span class="kw">__global__ void</span> add(</div>
          <div class="line">{{ pad(4) }}<span class="ty">float</span>* a, <span class="ty">float</span>* b, <span class="ty">float</span>* c, <span class="ty">int</span> n) {</div>
        </template>
        <template v-else>
          <div class="line"><span class="kw">@kernel</span></div>
          <div class="line"><span class="kw">def</span> add(a, b, c, n):</div>
        </template>
        <div class="line expr-line">
          <span class="pre">{{ pad(4) + (lang === 'hip' ? 'int i = ' : 'i = ') }}</span>
          <input
            v-if="can('formula')"
            v-model="draft"
            class="expr hgp-focusable"
            :class="{ bad: !!runError && !dirty }"
            :aria-label="'下标规则 i'"
            :placeholder="'写出 i 的计算规则'"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="off"
            @keydown.enter.prevent="run"
          />
          <span v-else class="fixed-expr">{{ applied }}</span>
          <span v-if="lang === 'hip'" class="pre semi">;</span>
        </div>
        <div v-if="guardOn" class="line guard-line">{{ pad(4) }}<span class="kw">if</span>{{ lang === 'hip' ? ' (i < n)' : ' i < n:' }}<button
            v-if="can('guard')"
            type="button"
            class="guard-x hgp-focusable"
            aria-label="去掉边界检查"
            @click="toggleGuard"
          >去掉</button></div>
        <div v-else-if="can('guard')" class="line">{{ pad(4) }}<button type="button" class="guard-add hgp-focusable" @click="toggleGuard">＋ 加一行边界检查</button></div>
        <div class="line">{{ pad(guardOn ? 8 : 4) }}c[i] = a[i] + b[i]{{ lang === 'hip' ? ';' : '' }}</div>
        <div v-if="lang === 'hip'" class="line">}</div>
      </div>

      <div v-if="can('formula')" class="run-row">
        <button type="button" class="hgp-btn primary" @click="run">运行 ▶</button>
        <span v-if="dirty" class="dirty">规则改了，按 Enter 或点「运行」看结果。</span>
        <span class="names">可以用：<code>blockIdx.x</code> <code>blockDim.x</code> <code>threadIdx.x</code></span>
      </div>
      <p v-if="runError && !dirty" class="error" role="alert">{{ runError }}</p>

      <ThreadGrid
        :result="result && result.ok ? result : null"
        :cfg="cfg"
        :empty-text="runError ? '规则有错误，按上面的提示改好再运行。' : '先写出拿数的规则，再点运行。'"
      />

      <div class="feedback">
        <p v-if="success && successText && !judge" class="success" role="status">✓ {{ successText }}</p>
        <p v-if="!success && hintLevel >= 1 && hints[0]" class="hint">提示：{{ hints[0] }}</p>
        <p v-if="!success && hintLevel >= 2 && hints[1]" class="hint">再提示一点：{{ hints[1] }}</p>
        <div v-if="!success && canShowAnswer" class="answer">
          <button v-if="!answerShown" type="button" class="hgp-btn" @click="showAnswer">
            查看答案{{ judge ? '（本关最高 2 星）' : '' }}
          </button>
          <p v-else>
            答案：<code>{{ answer }}</code>
            <button type="button" class="hgp-btn" @click="fillAnswer">填入并运行</button>
          </p>
        </div>
      </div>

      <div v-if="verdict" class="stars" aria-label="挑战星级">
        <div v-for="(label, i) in starLabels" :key="i" class="star-row" :class="{ on: storedStars.includes(i) || verdict.earned[i] }">
          <span class="star" aria-hidden="true">★</span>
          <span>{{ label }}</span>
          <span v-if="i === 2 && capped && !storedStars.includes(2)" class="capped">（看过答案，不再发放）</span>
        </div>
        <p v-if="verdict.next" class="next">下一颗星：{{ verdict.next }}</p>
        <p v-else class="next done">三颗星全部拿到了。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hgp-lab {
  position: relative;
  margin: 20px 0;
  padding: 16px;
  border: 1px solid var(--hg-border);
  border-radius: var(--hgp-radius);
  background: var(--vp-c-bg-soft);
}
.body {
  display: grid;
  gap: 14px;
  transition: opacity var(--motion-base) var(--ease-out), filter var(--motion-base) var(--ease-out);
}
.gated .body {
  opacity: 0.35;
  filter: blur(1.5px);
}
.gate {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  text-align: center;
  font-weight: 600;
}
.gate p {
  margin: 0;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 24px;
}
.fixed {
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.fixed strong {
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
}
.code {
  padding: 12px 14px;
  border-radius: var(--hgp-radius);
  background: var(--vp-code-block-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  line-height: 1.75;
  overflow-x: auto;
}
.line {
  white-space: pre;
  min-height: 1.75em;
}
.expr-line {
  display: flex;
  align-items: center;
}
.kw {
  color: var(--hg-block-2);
}
.ty {
  color: var(--hg-block-1);
}
.expr {
  flex: 1;
  min-width: 0;
  max-width: 40ch;
  padding: 2px 8px;
  border: 1.5px solid var(--vp-c-brand-1);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
}
.expr.bad {
  border-color: var(--hg-error);
}
.semi {
  margin-left: 6px;
}
.fixed-expr {
  color: var(--vp-c-text-1);
  font-weight: 600;
}
.guard-line {
  color: var(--hg-ok);
}
.guard-add,
.guard-x {
  padding: 0 8px;
  border: 1.5px dashed var(--hg-ok);
  border-radius: 6px;
  background: transparent;
  color: var(--hg-ok);
  font: inherit;
  cursor: pointer;
}
.guard-x {
  margin-left: 10px;
  border-style: solid;
  border-color: var(--hg-border);
  color: var(--vp-c-text-2);
  font-size: 12px;
}
.run-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
}
.dirty {
  font-size: 13px;
  color: var(--hg-warn);
}
.names {
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.error {
  margin: 0;
  padding: 8px 12px;
  border-left: 3px solid var(--hg-error);
  border-radius: 4px;
  background: var(--hg-error-soft);
  font-size: 14px;
}
.feedback {
  display: grid;
  gap: 6px;
}
.feedback p {
  margin: 0;
}
.success {
  padding: 8px 12px;
  border-radius: 4px;
  background: var(--hg-ok-soft);
  color: var(--vp-c-text-1);
  font-weight: 600;
}
.hint {
  padding: 8px 12px;
  border-left: 3px solid var(--hg-sim);
  border-radius: 4px;
  background: var(--hg-surface);
  font-size: 14px;
}
.answer p {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.stars {
  padding: 10px 12px;
  border: 1px solid var(--hg-border);
  border-radius: var(--hgp-radius);
}
.star-row {
  display: flex;
  gap: 8px;
  margin: 2px 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.star {
  color: var(--hg-border);
  transition: color var(--motion-base) var(--ease-out);
}
.star-row.on {
  color: var(--vp-c-text-1);
}
.star-row.on .star {
  color: var(--hg-warn);
}
.capped {
  font-size: 12px;
}
.next {
  margin: 6px 0 0;
  font-size: 14px;
  font-weight: 600;
}
.next.done {
  color: var(--hg-ok);
}
</style>
