<script setup lang="ts">
/**
 * 1-8 两段实验台（关卡自己的 scenes，不用登记组件）：代码写死，只开放一个旋钮，结果交给访存视图（MemoryView）。
 *
 * - stride（探索一）：128 道向量加法，每组 32 个线程，每个线程连着算 stride 道。旋钮调 stride（1 / 2 / 4），
 *   组数跟着变，刚好够用。
 * - split（探索二）：128 道加法交给 1 组 32 个线程，每人 4 道。旋钮切换甲（连着分）、乙（隔着分）。
 * 代码和启动那一行跟着写法偏好（LangCode，两种都在服务端渲染）。旋钮一动、换写法，就在 Web Worker 里重跑模拟器
 * （docs/sim/client.ts）；旋钮下面一句话是这一次的解读（challenge.ts 的 strideText / splitText），
 * 访存视图一次一次看小队每次读写搬了几车。元素大小、一车多大两个开关收起来：这一关只调步长和分法。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import LangCode from '@kit/LangCode.vue'
import MemoryView from '@kit/MemoryView.vue'
import { highlight, type Tone } from '@kit/sandbox/highlight.ts'
import { buildRequest, type Launch } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  DEFAULT_SPLIT, DEFAULT_STRIDE, LAB_N, SPLITS, SPLIT_LAUNCH, SPLIT_M, STRIDES, STRIDE_CODE, WAVE,
  countCars, labArgs, labLaunchLine, splitCode, splitText, strideLaunch, strideText, type Split,
} from '../challenge.ts'

const props = defineProps<{
  /** stride：探索一，调步长；split：探索二，换分法 */
  variant: 'stride' | 'split'
}>()

const progress = useProgress()
const titleId = `${useId()}-title`
const isStride = props.variant === 'stride'
const STRIDE_OPTIONS = [...STRIDES]

const stride = ref<number>(DEFAULT_STRIDE)
const split = ref<Split>(DEFAULT_SPLIT)
/** 旋钮现在的值：结果和它对得上才画 */
const setting = computed(() => (isStride ? String(stride.value) : split.value))
const launch = computed<Launch>(() => (isStride ? strideLaunch(stride.value) : SPLIT_LAUNCH))
/** 启动那一行的最后一个参数：stride，或者每人几道 m */
const last = computed(() => (isStride ? stride.value : SPLIT_M))

function kernel(lang: Lang): string {
  return isStride ? STRIDE_CODE[lang] : splitCode(split.value, lang)
}

function args() {
  return isStride ? labArgs({ stride: stride.value }) : labArgs({ m: SPLIT_M })
}

/** 代码按 highlight() 的结果切成几段，关键字和注释着色（和代码沙盒同一套高亮，同 1-4 的实验台）。 */
function segments(source: string, lang: Lang) {
  const parts: { text: string; tone: Tone | '' }[] = []
  let at = 0
  for (const token of highlight(source, lang)) {
    if (token.from > at) parts.push({ text: source.slice(at, token.from), tone: '' })
    parts.push({ text: source.slice(token.from, token.to), tone: token.tone })
    at = token.to
  }
  if (at < source.length) parts.push({ text: source.slice(at), tone: '' })
  return parts
}

/** 工作单下面接着写启动那一行（1-2 定的写法），旋钮一动，数跟着变。 */
function listing(lang: Lang) {
  const comment = lang === 'hip' ? '//' : '#'
  const l = launch.value
  const each = isStride ? `每人连着算 ${stride.value} 道` : `每人 ${SPLIT_M} 道`
  const head = `${comment} 启动：派 ${l.grid} 组，每组 ${l.block} 个线程，${each}`
  return segments(`${kernel(lang)}\n\n${head}\n${labLaunchLine(l, last.value, lang)}`, lang)
}

const code = computed(() => ({ hip: listing('hip'), python: listing('python') }))

const run = shallowRef<{ setting: string; launch: Launch; result: RunResult } | null>(null)
const problem = ref('')
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const lang = progress.state.prefs.lang
  const key = setting.value
  const config = { ...launch.value }
  try {
    const result = await client.run(buildRequest(kernel(lang), lang, config, args()))
    run.value = { setting: key, launch: config, result }
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着拨旋钮时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `实验没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch([setting, () => progress.state.prefs.lang], simulate)

onMounted(() => {
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())

/** 结果和旋钮对得上才写解读（拨旋钮以后、新结果回来之前，先不写旧的） */
const readout = computed(() => {
  const r = run.value
  if (!r || r.setting !== setting.value || !r.result.ok) return problem.value ? '' : '模拟器准备中……'
  const cars = countCars(r.result.events)
  return isStride ? strideText(stride.value, cars) : splitText(split.value, cars)
})
</script>

<template>
  <section class="cl" :aria-labelledby="titleId">
    <header class="cl__head">
      <span class="cl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="cl__title">{{ isStride ? `调步长：小队一次搬几车` : `换分法：每人 ${SPLIT_M} 道，怎么分` }}</strong>
      <span class="cl__tag">模拟</span>
    </header>
    <p class="cl__rules">
      <template v-if="isStride">
        {{ LAB_N }} 道加法，每组 {{ WAVE }} 个线程，正好一支小队。组数跟着步长变，刚好够用。访存视图一次一次看：小队每次读写，要的数落在哪几车。
      </template>
      <template v-else>
        {{ LAB_N }} 道加法交给 1 组 {{ WAVE }} 个线程，每人 {{ SPLIT_M }} 道。两种分法只差 i 那一行，访存视图看小队每一轮要的数落在哪几车。
      </template>
    </p>

    <div class="cl__knobs">
      <Knob v-if="isStride" label="访问步长" code="stride" :options="STRIDE_OPTIONS" v-model="stride" />
      <Knob v-else label="分法" :options="SPLITS" v-model="split" />
    </div>

    <div class="cl__code">
      <LangCode>
        <template #hip>
          <div class="language-cpp"><span class="lang">cpp</span><pre><code><span v-for="(seg, k) in code.hip" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
        </template>
        <template #python>
          <div class="language-python"><span class="lang">python</span><pre><code><span v-for="(seg, k) in code.python" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
        </template>
      </LangCode>
    </div>

    <p v-if="problem" class="cl__problem" role="alert">{{ problem }}</p>
    <p class="cl__readout" aria-live="polite">{{ readout }}</p>

    <MemoryView
      :result="run?.result ?? null"
      :launch="run?.launch ?? launch"
      :knobs="false"
      empty-text="模拟器准备中……"
    />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签、代码区同 1-4 的实验台（GroupLab）。 */
.cl {
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

.cl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.cl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.cl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.cl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.cl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.cl__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.cl__code {
  min-width: 0;
}

.cl__code :deep(.hg-langcode) {
  margin: 0;
}

.cl__code :deep(div[class*='language-']) {
  margin: 0;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

.cl__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

.cl__readout {
  min-height: 1.6em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .cl {
    padding: 16px 14px;
  }

  .cl__knobs {
    padding: 12px 10px;
  }

  .cl__code :deep(div[class*='language-'] pre) {
    padding: 10px 12px 12px;
  }

  .cl__code :deep(div[class*='language-'] code) {
    font-size: 13px;
  }
}
</style>
