<script setup lang="ts">
/**
 * 1-10 探索二「树搬上货架」（关卡自己的 scenes，不用登记组件）：tree_sum 工作单写死，派 1 组 64 个线程（两支小队），
 * 在货架上搭树：第 1 轮隔 1 格配对，之后每轮翻倍，6 轮把 64 个数加成一个，线程 0 存进 out[0]。
 *
 * 旋钮只开放一个：每一轮之后同步，或者不同步。一段是一支小队放数、走完一轮、或者走完循环（challenge.ts 的 treeMoves）；
 * 上一段、下一段一段一段看，下面一句话说清这一段（moveStory），货架板（TreeBoard）画出每一格现在的数。
 * 一开始从头一段一段看；拨了旋钮先看跑完的样子。跑完写解读（labText）：同步时 6 轮加对；不同步时小队 0 第 6 轮取早了。
 * 上面是工作单（跟着写法偏好，跑的就是这一段）：这一段写数的那一行标「▶」，停在同步上时同步那一行标「‖」。
 * 旋钮一动、换写法，就在 Web Worker 里重跑模拟器（docs/sim/client.ts）。
 * 键盘：按钮都是原生的；焦点在货架板上时 ← → 换一段，Home 回到开头，End 跳到最后。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { buildRequest, stepGroups } from '@kit/sandbox/run.ts'
import { codeLines } from '@kit/sandbox/template.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { useProgress } from '@course/useProgress.ts'
import TreeBoard from './TreeBoard.vue'
import {
  DEFAULT_ROUND_WAIT, LAB_ARGS, LAB_LAUNCH, LAB_TOTAL, ROUND_WAITS, WAVE, labText, launchLine, loopLine, moveStory, treeCode,
  treeMoves, type RoundWait,
} from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const WAIT_OPTIONS = [...ROUND_WAITS]
const EXT: Record<Lang, string> = { hip: 'hip', python: 'py' }

const wait = ref<RoundWait>(DEFAULT_ROUND_WAIT)

/** 挂载之前（服务端渲染、水合）按 HIP 写；挂载以后跟着写法偏好（同 1-9 的实验台）。 */
const mounted = ref(false)
const lang = computed<Lang>(() => (mounted.value ? progress.state.prefs.lang : 'hip'))

const run = shallowRef<{ wait: RoundWait; lang: Lang; result: RunResult } | null>(null)
const problem = ref('')
/** 走完了几段：0 是还没开始 */
const position = ref(0)
/** 看整段：拨了旋钮以后先看跑完的样子，一动单步就换成一段一段看 */
const whole = ref(false)
let client: SimClient | null = null

/** keep：换写法时留在原来那一段（两种写法的段数一样）；拨了旋钮先看整段。 */
async function simulate(view: 'start' | 'whole' | 'keep') {
  if (!client) return
  const l = lang.value
  const w = wait.value
  try {
    const result = await client.run(buildRequest(treeCode(w, l), l, LAB_LAUNCH, LAB_ARGS))
    run.value = { wait: w, lang: l, result }
    if (view !== 'keep') {
      position.value = 0
      whole.value = view === 'whole'
    }
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着拨旋钮时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `实验没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch(wait, () => simulate('whole'))
watch(lang, () => simulate('keep'))

onMounted(() => {
  mounted.value = true
  client = createSimClient()
  simulate('start')
})

onBeforeUnmount(() => client?.dispose())

// ── 这一段 ──────────────────────────────────────────────────────────────

/** 结果和旋钮、写法对得上才用（拨旋钮以后、新结果回来之前，先不画旧的） */
const result = computed(() => {
  const r = run.value
  return r && r.wait === wait.value && r.lang === lang.value && r.result.ok ? r.result : null
})
const source = computed(() => treeCode(wait.value, lang.value))
const moves = computed(() => (result.value ? treeMoves(result.value, loopLine(source.value)) : []))
const count = computed(() => moves.value.length)
const atEnd = computed(() => !whole.value && count.value > 0 && position.value >= count.value)

function go(to: number) {
  whole.value = false
  position.value = Math.max(0, Math.min(to, count.value))
}

/** 焦点在货架板上时：← → 换一段，Home 回到开头，End 跳到最后。 */
function onKey(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !count.value) return
  const from = whole.value ? count.value : position.value
  const targets: Record<string, number> = { ArrowLeft: from - 1, ArrowRight: whole.value ? 1 : from + 1, Home: 0, End: count.value }
  if (!(e.key in targets)) return
  e.preventDefault()
  go(targets[e.key])
}

/** 这一段（看整段、还没开始时没有） */
const move = computed(() => (!whole.value && position.value > 0 ? moves.value[position.value - 1] ?? null : null))
/** 货架板画到哪：看整段是全部；还没开始画空的货架 */
const range = computed(() => {
  const m = move.value
  if (m) return { from: m.from, to: m.to, block: m.block }
  return whole.value ? null : { from: 0, to: 0, block: 0 }
})

// ── 代码 ────────────────────────────────────────────────────────────────

const lines = computed(() => codeLines({ source: source.value, ranges: [] }, lang.value, false)
  .map((segs, k) => ({
    n: k + 1,
    segs: segs.map((seg) => ({ text: seg.text, tone: seg.kind === 'text' ? seg.tone : null })),
  })))
const fileName = computed(() => `tree_sum.${EXT[lang.value]}`)
const launchText = computed(() => launchLine('tree_sum', LAB_LAUNCH, lang.value))

/** 这一段写数的那一行（放数、加、存 out），没写数就是这一段最后一步的那一行 */
const currentLine = computed(() => {
  const m = move.value
  const r = result.value
  if (!m || !r) return null
  const own = r.events.slice(m.from, m.to)
  const write = [...own].reverse().find((e) => e.op === 'store' || e.op === 'atomic')
  return write?.line ?? stepGroups(r.events)[m.last]?.line ?? null
})
/** 这一段停在同步上：同步那一行 */
const waitLine = computed(() => {
  const m = move.value
  const r = result.value
  return m?.barrier && r ? stepGroups(r.events)[m.last]?.line ?? null : null
})

// ── 文字 ────────────────────────────────────────────────────────────────

const caption = computed(() => {
  const r = result.value
  if (!r) return problem.value ? '' : '模拟器准备中……'
  if (whole.value) return `跑完了：一共 ${count.value} 段。点「从头」或「下一段」，可以一段一段看。`
  if (position.value === 0) return `还没开始：一共 ${count.value} 段，一支小队放好数、走完一轮，各算一段。点「下一段」。`
  return `第 ${position.value} / ${count.value} 段。${moveStory(r, LAB_LAUNCH, moves.value, position.value - 1)}`
})

/** 跑完（看整段，或者走到最后一段）才写解读：一段一段看的时候不先说结论。 */
const readout = computed(() => (result.value && (whole.value || atEnd.value) ? labText(result.value) : ''))
const wrong = computed(() => (result.value?.arrays.out?.[0] ?? LAB_TOTAL) !== LAB_TOTAL)
</script>

<template>
  <section class="tl" :aria-labelledby="titleId">
    <header class="tl__head">
      <span class="tl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="tl__title">一段一段看：树搬上货架</strong>
      <span class="tl__tag">模拟</span>
    </header>
    <p class="tl__rules">派 1 组 {{ LAB_LAUNCH.block }} 个线程，排成两支小队：线程 0～{{ WAVE - 1 }} 是小队 0，{{ WAVE }}～{{ 2 * WAVE - 1 }} 是小队 1。每人先把一个数放上货架，再一轮一轮两两相加；旋钮决定每一轮之后等不等整组。</p>

    <div class="tl__knobs">
      <Knob label="每一轮之后" :code="lang === 'hip' ? '__syncthreads()' : 'syncthreads()'" :options="WAIT_OPTIONS" v-model="wait" />
    </div>

    <!-- 代码区在亮暗主题下都是深色（01 第 2.4 节），同 1-9 的实验台 -->
    <div class="tl__code" data-hg-theme="dark" role="group" :aria-label="`${fileName} 的代码`">
      <p class="tl__file">{{ fileName }}</p>
      <div class="tl__listing" translate="no">
        <div class="tl__lines">
          <div
            v-for="row in lines"
            :key="row.n"
            class="tl__line"
            :class="{ 'is-current': currentLine === row.n, 'is-wait': waitLine === row.n && currentLine !== row.n }"
          >
            <span class="tl__ln" aria-hidden="true">{{ row.n }}</span>
            <span class="tl__lc"><span
              v-for="(seg, k) in row.segs"
              :key="k"
              :class="seg.tone ? `is-${seg.tone}` : undefined"
            >{{ seg.text }}</span><span v-if="currentLine === row.n" class="tl__sr">（这一段在这一行写数）</span><span
              v-else-if="waitLine === row.n"
              class="tl__sr"
            >（这一段停在这一行的同步上）</span></span>
          </div>
        </div>
      </div>
    </div>
    <p class="tl__launch">
      <span class="tl__launch-label">启动时这样写：</span>
      <code translate="no">{{ launchText }}</code>
    </p>

    <div class="tl__transport" role="group" aria-label="一段一段走">
      <button type="button" class="tl__button" :disabled="!count || (!whole && position === 0)" @click="go(0)">从头</button>
      <button type="button" class="tl__button" :disabled="whole || position === 0" @click="go(position - 1)">上一段</button>
      <button type="button" class="tl__button is-primary" :disabled="!count || atEnd" @click="go(whole ? 1 : position + 1)">下一段</button>
      <button type="button" class="tl__button" :disabled="!count || whole || atEnd" @click="go(count)">跳到最后</button>
    </div>
    <p class="tl__caption" aria-live="polite">{{ caption }}</p>
    <p v-if="problem" class="tl__problem" role="alert">{{ problem }}</p>

    <div
      class="tl__board"
      role="group"
      aria-label="货架板：焦点在这里时，← → 换一段，Home 回到开头，End 跳到最后"
      tabindex="0"
      @keydown="onKey"
    >
      <TreeBoard :result="result" :launch="LAB_LAUNCH" :args="LAB_ARGS" :expected="LAB_TOTAL" :range="range" empty-text="模拟器准备中……" />
    </div>

    <p v-if="readout" class="tl__readout" :class="{ 'is-wrong': wrong }">{{ readout }}</p>
    <p v-if="readout && wrong" class="tl__note">模拟器总让小队 0 先走到同步或者走完，所以每次都是它取早。真卡上两支小队交错着走，谁先谁后说不准：这一次取早了，下一次也许又赶上了。</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签、深色代码区、按钮同 1-9 的实验台（ShelfLab）。 */
.tl {
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

.tl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.tl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.tl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.tl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.tl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.tl__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.tl__code {
  min-width: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-code-dot);
  border-radius: 12px;
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.tl__file {
  margin: 0;
  padding: 6px 12px;
  border-bottom: var(--hg-border-width) solid var(--hg-code-dot);
  color: var(--hg-code-file);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  line-height: 1.6;
}

/* 代码太宽时整块横向滚动（01 第 7 节允许），行号钉在左边。读屏用的说明是绝对定位的，留在这一块里，不把页面撑宽 */
.tl__listing {
  position: relative;
  overflow-x: auto;
}

.tl__lines {
  width: max-content;
  min-width: 100%;
  padding: 8px 0;
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.75;
}

.tl__line {
  display: grid;
  grid-template-columns: 3.2em minmax(0, 1fr);
  white-space: pre;
}

.tl__ln {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 0 10px 0 14px;
  background: var(--hg-code-bg);
  color: var(--hg-code-line-number);
  text-align: right;
  user-select: none;
}

.tl__lc {
  padding: 0 14px 0 6px;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

/* 这一段写数的那一行：琥珀色的底和行号旁的「▶」；停在同步上的那一行：行号旁的「‖」（不只靠颜色） */
.tl__line.is-current > span,
.tl__line.is-wait > span {
  background-image: linear-gradient(color-mix(in srgb, var(--hg-code-highlight) 16%, transparent), color-mix(in srgb, var(--hg-code-highlight) 16%, transparent));
}

.tl__line.is-wait > span {
  background-image: linear-gradient(color-mix(in srgb, var(--hg-code-highlight) 8%, transparent), color-mix(in srgb, var(--hg-code-highlight) 8%, transparent));
}

.tl__line.is-current .tl__ln,
.tl__line.is-wait .tl__ln {
  color: var(--hg-code-highlight);
}

.tl__line.is-current .tl__ln::before,
.tl__line.is-wait .tl__ln::before {
  position: absolute;
  left: 3px;
  width: 10px;
  color: var(--hg-code-highlight);
  font-size: 9px;
  font-weight: 700;
  text-align: center;
}

.tl__line.is-current .tl__ln::before {
  content: '▶';
}

.tl__line.is-wait .tl__ln::before {
  content: '‖';
}

.tl__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: -4px 0 0;
  font-size: 14px;
}

.tl__launch-label {
  color: var(--hg-ink-2);
}

.tl__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.tl__transport {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.tl__button {
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

.tl__button.is-primary {
  min-width: 6em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.tl__button:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.tl__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tl__button:focus-visible,
.tl__board:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.tl__caption {
  min-height: 4.8em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.tl__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

.tl__board {
  min-width: 0;
  border-radius: var(--hg-radius-control);
}

.tl__readout {
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.tl__readout.is-wrong {
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
}

.tl__note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.tl__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 639px) {
  .tl {
    padding: 16px 14px;
  }

  .tl__knobs {
    padding: 12px 10px;
  }

  .tl__lines {
    font-size: 12px;
  }

  .tl__ln {
    padding: 0 8px 0 12px;
  }
}
</style>
