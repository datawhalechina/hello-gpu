<script setup lang="ts">
/**
 * 1-4 探索一、探索三的实验台（关卡自己的 scenes，不用登记组件）：代码写死，只开放旋钮。
 *
 * - collide（探索一）：每个线程都按 i = threadIdx.x 拿数，旋钮调每组几个线程（2 / 4 / 8）和派几组（1–6）。
 * - guard（探索三）：拿数的规则已经对了，3 组 × 每组 4 个，开关边界检查 if (i < n)。
 * 代码和启动那一行跟着写法偏好（LangCode，两种都在服务端渲染）。旋钮一动就在 Web Worker 里重跑模拟器
 * （docs/sim/client.ts），结果交给 RobotGrid，它下面那句话就是这一次的解读。
 * 这是试点 LaunchLab「只开放旋钮」的两种用法；要读者写规则的那两处换成了代码沙盒（GroupSandbox）。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import LangCode from '@kit/LangCode.vue'
import RobotGrid from '@kit/RobotGrid.vue'
import { highlight, type Tone } from '@kit/sandbox/highlight.ts'
import { buildRequest, type Launch } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  BLOCK_DIMS, EXPLORE_GRID_MAX, EXPLORE_LAUNCH, EXPLORE_N, GLOBAL_INDEX, addArgs, kernelSource, launchLine,
} from '../challenge.ts'

const props = defineProps<{
  /** collide：探索一，只用 threadIdx.x 拿数；guard：探索三，开关边界检查 */
  variant: 'collide' | 'guard'
}>()

const progress = useProgress()
const titleId = `${useId()}-title`
const ARGS = addArgs(EXPLORE_N)
const BLOCK_OPTIONS = [...BLOCK_DIMS]
const collide = props.variant === 'collide'
const INDEX = collide ? 'threadIdx.x' : GLOBAL_INDEX

const block = ref(EXPLORE_LAUNCH.block)
const grid = ref(EXPLORE_LAUNCH.grid)
const guard = ref(false)
const launch = computed<Launch>(() => ({ grid: grid.value, block: block.value }))

/** 代码按 highlight() 的结果切成几段，关键字和注释着色（和代码沙盒同一套高亮）。 */
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

/** 工作单下面接着写启动那一行（1-2 定的写法），旋钮一动，两个数跟着变。 */
function listing(lang: Lang) {
  const comment = lang === 'hip' ? '//' : '#'
  const head = `${comment} 启动：派 ${launch.value.grid} 组，每组 ${launch.value.block} 个线程`
  return segments(`${kernelSource(lang, INDEX, guard.value)}\n\n${head}\n${launchLine(launch.value, lang)}`, lang)
}

const code = computed(() => ({ hip: listing('hip'), python: listing('python') }))

const run = shallowRef<{ launch: Launch; result: RunResult } | null>(null)
const problem = ref('')
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const lang = progress.state.prefs.lang
  const config = { ...launch.value }
  try {
    const result = await client.run(buildRequest(kernelSource(lang, INDEX, guard.value), lang, config, ARGS))
    run.value = { launch: config, result }
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着拨旋钮时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `实验没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch([block, grid, guard, () => progress.state.prefs.lang], simulate)

onMounted(() => {
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())
</script>

<template>
  <section class="gl" :aria-labelledby="titleId">
    <header class="gl__head">
      <span class="gl__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="gl__title">
        {{ collide ? '每个线程都按 i = threadIdx.x 拿数' : '多出来的线程：加不加边界检查' }}
      </strong>
      <span class="gl__tag">模拟</span>
    </header>
    <p class="gl__rules">
      <template v-if="collide">
        {{ EXPLORE_N }} 对数，代码不变，只调每组几个线程、派几组。看看后面的数有没有人算。
      </template>
      <template v-else>
        {{ EXPLORE_N }} 对数，派 {{ EXPLORE_LAUNCH.grid }} 组、每组 {{ EXPLORE_LAUNCH.block }} 个线程，拿数的规则已经对了。打开、关上边界检查，看多出来的 2 个线程。
      </template>
    </p>

    <div class="gl__knobs">
      <template v-if="collide">
        <Knob label="每组几个线程" code="blockDim.x" :options="BLOCK_OPTIONS" unit=" 个" v-model="block" />
        <Knob label="派几组" code="gridDim.x" :min="1" :max="EXPLORE_GRID_MAX" unit=" 组" v-model="grid" />
      </template>
      <Knob v-else label="边界检查" code="if (i < n)" on="加上了" off="没加" v-model="guard" />
    </div>

    <div class="gl__code">
      <LangCode>
        <template #hip>
          <div class="language-cpp"><span class="lang">cpp</span><pre><code><span v-for="(seg, k) in code.hip" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
        </template>
        <template #python>
          <div class="language-python"><span class="lang">python</span><pre><code><span v-for="(seg, k) in code.python" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
        </template>
      </LangCode>
    </div>

    <p v-if="problem" class="gl__problem" role="alert">{{ problem }}</p>

    <RobotGrid
      :result="run?.result ?? null"
      :launch="run?.launch ?? launch"
      array="c"
      empty-text="模拟器准备中……"
    />
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同 1-3 的探索一（SameSheet）。 */
.gl {
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

.gl__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.gl__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.gl__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.gl__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.gl__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.gl__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.gl__code {
  min-width: 0;
}

.gl__code :deep(.hg-langcode) {
  margin: 0;
}

.gl__code :deep(div[class*='language-']) {
  margin: 0;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

.gl__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

@media (max-width: 639px) {
  .gl {
    padding: 16px 14px;
  }

  .gl__knobs {
    padding: 12px 10px;
  }

  .gl__code :deep(div[class*='language-'] pre) {
    padding: 10px 12px 12px;
  }

  .gl__code :deep(div[class*='language-'] code) {
    font-size: 13px;
  }
}
</style>
