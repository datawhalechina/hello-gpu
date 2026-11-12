<script setup lang="ts">
/**
 * 1-9 的两段实验台（关卡自己的 scenes，不用登记组件）：flip 工作单写死，派 1 组 64 个线程（两支小队）。
 *
 * - watch（探索一）：同步写在放和取之间，没有旋钮，从头一步一步走：先放好的小队停在同步处，
 *   等另一支也放好，整组到齐了才取。
 * - move（探索二）：旋钮把同步挪到放之前，或者删掉。一换就重跑，先看跑完的样子，也可以从头一步一步看；
 *   跑完以后写出解读（challenge.ts 的 labText）和模拟器记下的数据竞争（取早了的一处、碰巧取对的一处）。
 * 上面是工作单（跟着写法偏好，跑的就是这一段），这一步在执行的行标「▶」；下面是货架板（ShelfBoard）。
 * 旋钮一动、换写法，就在 Web Worker 里重跑模拟器（docs/sim/client.ts）。
 * 键盘：按钮都是原生的；焦点在货架板上时 ← → 换一步，Home 回到开头，End 跳到最后。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { buildRequest, stepGroups } from '@kit/sandbox/run.ts'
import { codeLines } from '@kit/sandbox/template.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { useProgress } from '@course/useProgress.ts'
import ShelfBoard from './ShelfBoard.vue'
import {
  DEFAULT_WAIT, LAB_ARGS, LAB_LAUNCH, WAITS, WAVE, flipLaunchLine, labCode, labText, raceText, shelfRaces, stepStory,
  type WaitAt,
} from '../challenge.ts'

const props = defineProps<{
  /** watch：探索一，一步一步看；move：探索二，挪同步 */
  variant: 'watch' | 'move'
}>()

const progress = useProgress()
const titleId = `${useId()}-title`
const isMove = props.variant === 'move'
const WAIT_OPTIONS = [...WAITS]
const EXT: Record<Lang, string> = { hip: 'hip', python: 'py' }

const wait = ref<WaitAt>(DEFAULT_WAIT)

/** 挂载之前（服务端渲染、水合）按 HIP 写；挂载以后跟着写法偏好（同 1-5 的单步执行器）。 */
const mounted = ref(false)
const lang = computed<Lang>(() => (mounted.value ? progress.state.prefs.lang : 'hip'))

const run = shallowRef<{ wait: WaitAt; lang: Lang; result: RunResult } | null>(null)
const problem = ref('')
/** 走完了几步：0 是还没开始 */
const position = ref(0)
/** 看整段：探索二换了同步的位置以后先看跑完的样子，一动单步就换成一步一步看 */
const whole = ref(false)
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const l = lang.value
  const w = wait.value
  try {
    const result = await client.run(buildRequest(labCode(w, l), l, LAB_LAUNCH, LAB_ARGS))
    run.value = { wait: w, lang: l, result }
    position.value = 0
    whole.value = isMove
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着拨旋钮时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `实验没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch([wait, lang], simulate)

onMounted(() => {
  mounted.value = true
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())

// ── 这一步 ──────────────────────────────────────────────────────────────

/** 结果和旋钮、写法对得上才用（拨旋钮以后、新结果回来之前，先不画旧的） */
const result = computed(() => {
  const r = run.value
  return r && r.wait === wait.value && r.lang === lang.value && r.result.ok ? r.result : null
})
const groups = computed(() => (result.value ? stepGroups(result.value.events) : []))
const count = computed(() => groups.value.length)
const atEnd = computed(() => !whole.value && count.value > 0 && position.value >= count.value)

function go(to: number) {
  whole.value = false
  position.value = Math.max(0, Math.min(to, count.value))
}

/** 焦点在货架板上时：← → 换一步，Home 回到开头，End 跳到最后。 */
function onKey(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !count.value) return
  const from = whole.value ? count.value : position.value
  const moves: Record<string, number> = { ArrowLeft: from - 1, ArrowRight: whole.value ? 1 : from + 1, Home: 0, End: count.value }
  if (!(e.key in moves)) return
  e.preventDefault()
  go(moves[e.key])
}

// ── 代码 ────────────────────────────────────────────────────────────────

const source = computed(() => labCode(wait.value, lang.value))
const lines = computed(() => codeLines({ source: source.value, ranges: [] }, lang.value, false)
  .map((segs, k) => ({
    n: k + 1,
    segs: segs.map((seg) => ({ text: seg.text, tone: seg.kind === 'text' ? seg.tone : null })),
  })))
const fileName = computed(() => `flip.${EXT[lang.value]}`)
const launchText = computed(() => flipLaunchLine(LAB_LAUNCH, lang.value))
/** 这一步在执行的行；看整段、还没开始时没有 */
const currentLine = computed(() => (!whole.value && position.value > 0 ? groups.value[position.value - 1]?.line ?? null : null))

// ── 文字 ────────────────────────────────────────────────────────────────

const caption = computed(() => {
  const r = result.value
  if (!r) return problem.value ? '' : '模拟器准备中……'
  if (whole.value) return `跑完了：一共 ${count.value} 步。点「从头」或「下一步」，可以一步一步看。`
  if (position.value === 0) return `还没开始：一共 ${count.value} 步，一支小队走一行算一步。点「下一步」。`
  return `第 ${position.value} / ${count.value} 步。${stepStory(r, LAB_LAUNCH, position.value - 1)}`
})

/** 跑完（看整段，或者走到最后一步）才写解读和数据竞争：一步一步看的时候不先说结论。 */
const finished = computed(() => Boolean(result.value) && (whole.value || atEnd.value))
const readout = computed(() => (result.value && finished.value ? labText(wait.value, result.value) : ''))
const examples = computed(() => {
  if (!result.value || !finished.value) return null
  const races = shelfRaces(result.value)
  if (!races.total) return null
  const picks = [races.early[0], races.lucky[0]].filter((r) => r !== undefined)
  return { total: races.total, items: picks.map((r) => raceText(r, LAB_LAUNCH.grid)) }
})
</script>

<template>
  <section class="sl" :aria-labelledby="titleId">
    <header class="sl__head">
      <span class="sl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="sl__title">{{ isMove ? '挪一挪同步：写在哪才管用' : '单步：放上货架，等齐再取' }}</strong>
      <span class="sl__tag">模拟</span>
    </header>
    <p class="sl__rules">
      <template v-if="isMove">还是这张工作单、这 {{ LAB_LAUNCH.block }} 个线程。旋钮把同步挪到放之前，或者删掉，再看货架和 out。</template>
      <template v-else>派 1 组 {{ LAB_LAUNCH.block }} 个线程，排成两支小队：线程 0～{{ WAVE - 1 }} 是小队 0，{{ WAVE }}～{{ 2 * WAVE - 1 }} 是小队 1。每个线程把 a[i] 放上货架的第 t 格，等整组都放好，再取对面那一格。</template>
    </p>

    <div v-if="isMove" class="sl__knobs">
      <Knob label="同步写在哪" :code="lang === 'hip' ? '__syncthreads()' : 'syncthreads()'" :options="WAIT_OPTIONS" v-model="wait" />
    </div>

    <!-- 代码区在亮暗主题下都是深色（01 第 2.4 节），同 1-5 的单步执行器 -->
    <div class="sl__code" data-hg-theme="dark" role="group" :aria-label="`${fileName} 的代码`">
      <p class="sl__file">{{ fileName }}</p>
      <div class="sl__listing" translate="no">
        <div class="sl__lines">
          <div v-for="row in lines" :key="row.n" class="sl__line" :class="{ 'is-current': currentLine === row.n }">
            <span class="sl__ln" aria-hidden="true">{{ row.n }}</span>
            <span class="sl__lc"><span
              v-for="(seg, k) in row.segs"
              :key="k"
              :class="seg.tone ? `is-${seg.tone}` : undefined"
            >{{ seg.text }}</span><span v-if="currentLine === row.n" class="sl__sr">（这一步在这一行）</span></span>
          </div>
        </div>
      </div>
    </div>
    <p class="sl__launch">
      <span class="sl__launch-label">启动时这样写：</span>
      <code translate="no">{{ launchText }}</code>
    </p>

    <div class="sl__transport" role="group" aria-label="一步一步走">
      <button type="button" class="sl__button" :disabled="!count || (!whole && position === 0)" @click="go(0)">从头</button>
      <button type="button" class="sl__button" :disabled="whole || position === 0" @click="go(position - 1)">上一步</button>
      <button type="button" class="sl__button is-primary" :disabled="!count || atEnd" @click="go(whole ? 1 : position + 1)">下一步</button>
      <button type="button" class="sl__button" :disabled="!count || whole || atEnd" @click="go(count)">跳到最后</button>
    </div>
    <p class="sl__caption" aria-live="polite">{{ caption }}</p>
    <p v-if="problem" class="sl__problem" role="alert">{{ problem }}</p>

    <div
      class="sl__board"
      role="group"
      aria-label="货架板：焦点在这里时，← → 换一步，Home 回到开头，End 跳到最后"
      tabindex="0"
      @keydown="onKey"
    >
      <ShelfBoard :result="result" :launch="LAB_LAUNCH" :upto="whole ? null : position" empty-text="模拟器准备中……" />
    </div>

    <p v-if="readout" class="sl__readout">{{ readout }}</p>
    <div v-if="examples" class="sl__races">
      <p class="sl__races-title">模拟器记下的数据竞争：{{ examples.total }} 处，比如</p>
      <ul>
        <li v-for="text in examples.items" :key="text">{{ text }}</li>
      </ul>
      <p class="sl__races-note">模拟器总让小队 0 先走到同步或者走完，所以每次都是它取早。真卡上几支小队交错着走，谁先谁后说不准：这一次取早了，下一次也许又赶上了。</p>
    </div>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同 1-4 的实验台（GroupLab）；代码区、按钮同 1-5 的单步执行器（SquadStepper）。 */
.sl {
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

.sl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.sl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.sl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.sl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.sl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.sl__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* 深色代码区：同 WaveView 的底色、行号色和当前行的琥珀色 */
.sl__code {
  min-width: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-code-dot);
  border-radius: 12px;
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.sl__file {
  margin: 0;
  padding: 6px 12px;
  border-bottom: var(--hg-border-width) solid var(--hg-code-dot);
  color: var(--hg-code-file);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  line-height: 1.6;
}

/* 代码太宽时整块横向滚动（01 第 7 节允许），行号钉在左边 */
.sl__listing {
  overflow-x: auto;
}

.sl__lines {
  width: max-content;
  min-width: 100%;
  padding: 8px 0;
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.75;
}

.sl__line {
  display: grid;
  grid-template-columns: 3.2em minmax(0, 1fr);
  white-space: pre;
}

.sl__ln {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 0 10px 0 14px;
  background: var(--hg-code-bg);
  color: var(--hg-code-line-number);
  text-align: right;
  user-select: none;
}

.sl__lc {
  padding: 0 14px 0 6px;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

/* 这一步在执行的行：琥珀色的底和行号旁的「▶」（不只靠颜色） */
.sl__line.is-current > span {
  background-image: linear-gradient(color-mix(in srgb, var(--hg-code-highlight) 16%, transparent), color-mix(in srgb, var(--hg-code-highlight) 16%, transparent));
}

.sl__line.is-current .sl__ln {
  color: var(--hg-code-highlight);
}

.sl__line.is-current .sl__ln::before {
  content: '▶';
  position: absolute;
  left: 3px;
  width: 10px;
  color: var(--hg-code-highlight);
  font-size: 9px;
  font-weight: 700;
  text-align: center;
}

.sl__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: -4px 0 0;
  font-size: 14px;
}

.sl__launch-label {
  color: var(--hg-ink-2);
}

.sl__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.sl__transport {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.sl__button {
  min-height: 40px;
  padding: 0 16px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.sl__button.is-primary {
  min-width: 6em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.sl__button:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.sl__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sl__button:focus-visible,
.sl__board:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.sl__caption {
  min-height: 3.2em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.sl__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

.sl__board {
  min-width: 0;
  border-radius: var(--hg-radius-control);
}

.sl__readout {
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.sl__races {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
}

.sl__races-title {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 13px;
  font-weight: 700;
}

.sl__races ul {
  margin: 0;
  padding-left: 1.2em;
  color: var(--hg-ink);
  font-size: 14px;
}

.sl__races li {
  margin: 2px 0;
}

.sl__races-note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.sl__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 639px) {
  .sl {
    padding: 16px 14px;
  }

  .sl__knobs {
    padding: 12px 10px;
  }

  .sl__lines {
    font-size: 12px;
  }

  .sl__ln {
    padding: 0 8px 0 12px;
  }
}
</style>
