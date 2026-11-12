<script setup lang="ts">
/**
 * 1-10 探索三「大家往同一格加」（关卡自己的 scenes，不用登记组件）：add_all 工作单写死，派 2 组、每组 64 个线程，
 * 每个线程把自己的 a[i] 加进 out[0]（a[j] = j + 1，一共 128 个数）。
 *
 * 旋钮只开放一个：普通加（out[0] += a[i]）还是原子加。一换就在 Web Worker 里重跑模拟器（docs/sim/client.ts），
 * 下面按小队列出每一次往 out[0] 写：普通加时一支小队的线程都读到同一个旧值，写回去只留下一个（challenge.ts 的 outWrites）；
 * 原子加时一个接一个加上去。最后一句解读（addText）：out[0] 是多少、丢了多少、排了几次队、几处数据竞争。
 * 上面是工作单（跟着写法偏好，跑的就是这一段），往 out[0] 加的那一行标「▶」。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import { buildRequest } from '@kit/sandbox/run.ts'
import { codeLines } from '@kit/sandbox/template.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  ADD_ARGS, ADD_LAUNCH, ADD_LINE, ADD_MODES, ADD_TOTAL, DEFAULT_ADD_MODE, addAllCode, addText, launchLine, outWrites,
  type AddMode,
} from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const MODE_OPTIONS = [...ADD_MODES]
const EXT: Record<Lang, string> = { hip: 'hip', python: 'py' }

const mode = ref<AddMode>(DEFAULT_ADD_MODE)

/** 挂载之前（服务端渲染、水合）按 HIP 写；挂载以后跟着写法偏好（同 1-9 的实验台）。 */
const mounted = ref(false)
const lang = computed<Lang>(() => (mounted.value ? progress.state.prefs.lang : 'hip'))

const run = shallowRef<{ mode: AddMode; lang: Lang; result: RunResult } | null>(null)
const problem = ref('')
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const l = lang.value
  const m = mode.value
  try {
    const result = await client.run(buildRequest(addAllCode(m, l), l, ADD_LAUNCH, ADD_ARGS))
    run.value = { mode: m, lang: l, result }
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着拨旋钮时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `实验没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch([mode, lang], simulate)

onMounted(() => {
  mounted.value = true
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())

/** 结果和旋钮、写法对得上才用（拨旋钮以后、新结果回来之前，先不画旧的） */
const result = computed(() => {
  const r = run.value
  return r && r.mode === mode.value && r.lang === lang.value && r.result.ok ? r.result : null
})

const source = computed(() => addAllCode(mode.value, lang.value))
const lines = computed(() => codeLines({ source: source.value, ranges: [] }, lang.value, false)
  .map((segs, k) => ({
    n: k + 1,
    segs: segs.map((seg) => ({ text: seg.text, tone: seg.kind === 'text' ? seg.tone : null })),
  })))
/** 旋钮换的那一行：往 out[0] 加的那一行 */
const addLine = computed(() => source.value.split('\n').findIndex((row) => row.includes(ADD_LINE[mode.value][lang.value])) + 1)
const fileName = computed(() => `add_all.${EXT[lang.value]}`)
const launchText = computed(() => launchLine('add_all', ADD_LAUNCH, lang.value))

/** 每一次往 out[0] 写，一支小队一行。 */
const rows = computed(() => {
  const r = result.value
  if (!r) return []
  return outWrites(r, ADD_ARGS).map((w) => {
    const who = `block ${w.block} 的小队 ${w.wave}`
    const text = w.op === 'store'
      ? `${w.lanes} 个线程都读到 out[0] = ${w.seen}，各加各的；写回去只留下线程 ${w.kept} 的：out[0] = ${w.after}。`
      : `${w.lanes} 个线程排队，一个接一个加：out[0] 从 ${w.before} 加到 ${w.after}。`
    return { key: `${w.block}:${w.wave}`, who, text }
  })
})

const readout = computed(() => (result.value ? addText(mode.value, result.value) : ''))
const wrong = computed(() => (result.value?.arrays.out?.[0] ?? ADD_TOTAL) !== ADD_TOTAL)
</script>

<template>
  <section class="al" :aria-labelledby="titleId">
    <header class="al__head">
      <span class="al__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="al__title">大家往同一格加</strong>
      <span class="al__tag">模拟</span>
    </header>
    <p class="al__rules">派 {{ ADD_LAUNCH.grid }} 组、每组 {{ ADD_LAUNCH.block }} 个线程，a 里一共 {{ ADD_LAUNCH.grid * ADD_LAUNCH.block }} 个数，a[j] = j + 1。每个线程把自己那个数加进 out[0]，加对了是 {{ ADD_TOTAL }}。</p>

    <div class="al__knobs">
      <Knob label="往 out[0] 上加" :options="MODE_OPTIONS" v-model="mode" />
    </div>

    <!-- 代码区在亮暗主题下都是深色（01 第 2.4 节），同 1-9 的实验台 -->
    <div class="al__code" data-hg-theme="dark" role="group" :aria-label="`${fileName} 的代码`">
      <p class="al__file">{{ fileName }}</p>
      <div class="al__listing" translate="no">
        <div class="al__lines">
          <div v-for="row in lines" :key="row.n" class="al__line" :class="{ 'is-current': addLine === row.n }">
            <span class="al__ln" aria-hidden="true">{{ row.n }}</span>
            <span class="al__lc"><span
              v-for="(seg, k) in row.segs"
              :key="k"
              :class="seg.tone ? `is-${seg.tone}` : undefined"
            >{{ seg.text }}</span><span v-if="addLine === row.n" class="al__sr">（旋钮换的是这一行）</span></span>
          </div>
        </div>
      </div>
    </div>
    <p class="al__launch">
      <span class="al__launch-label">启动时这样写：</span>
      <code translate="no">{{ launchText }}</code>
    </p>

    <p v-if="problem" class="al__problem" role="alert">{{ problem }}</p>
    <p v-else-if="!result" class="al__wait">模拟器准备中……</p>
    <template v-else>
      <ol class="al__rows" aria-label="每支小队往 out[0] 写的那一下">
        <li v-for="row in rows" :key="row.key" class="al__row">
          <span class="al__who">{{ row.who }}</span>
          <span>{{ row.text }}</span>
        </li>
      </ol>
      <p class="al__readout" :class="{ 'is-wrong': wrong }" aria-live="polite">{{ readout }}</p>
      <p v-if="wrong" class="al__note">模拟器让小队一支接一支走，同一步写同一格时留下最后一个线程的。真卡上留下哪一个、几支小队谁先谁后，都说不准，可总有数被盖掉。</p>
    </template>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签、深色代码区同 1-9 的实验台（ShelfLab）。 */
.al {
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

.al__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.al__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.al__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.al__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.al__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.al__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.al__code {
  min-width: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-code-dot);
  border-radius: 12px;
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.al__file {
  margin: 0;
  padding: 6px 12px;
  border-bottom: var(--hg-border-width) solid var(--hg-code-dot);
  color: var(--hg-code-file);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  line-height: 1.6;
}

/* 代码太宽时整块横向滚动（01 第 7 节允许），行号钉在左边。读屏用的说明是绝对定位的，留在这一块里，不把页面撑宽 */
.al__listing {
  position: relative;
  overflow-x: auto;
}

.al__lines {
  width: max-content;
  min-width: 100%;
  padding: 8px 0;
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.75;
}

.al__line {
  display: grid;
  grid-template-columns: 3.2em minmax(0, 1fr);
  white-space: pre;
}

.al__ln {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 0 10px 0 14px;
  background: var(--hg-code-bg);
  color: var(--hg-code-line-number);
  text-align: right;
  user-select: none;
}

.al__lc {
  padding: 0 14px 0 6px;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

/* 旋钮换的那一行：琥珀色的底和行号旁的「▶」（不只靠颜色） */
.al__line.is-current > span {
  background-image: linear-gradient(color-mix(in srgb, var(--hg-code-highlight) 16%, transparent), color-mix(in srgb, var(--hg-code-highlight) 16%, transparent));
}

.al__line.is-current .al__ln {
  color: var(--hg-code-highlight);
}

.al__line.is-current .al__ln::before {
  content: '▶';
  position: absolute;
  left: 3px;
  width: 10px;
  color: var(--hg-code-highlight);
  font-size: 9px;
  font-weight: 700;
  text-align: center;
}

.al__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: -4px 0 0;
  font-size: 14px;
}

.al__launch-label {
  color: var(--hg-ink-2);
}

.al__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.al__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

.al__wait {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.al__rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  font-size: 14px;
  list-style: none;
}

.al__row {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin: 0;
}

.al__who {
  flex: none;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

.al__readout {
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.al__readout.is-wrong {
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
}

.al__note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.al__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 639px) {
  .al {
    padding: 16px 14px;
  }

  .al__knobs {
    padding: 12px 10px;
  }

  .al__lines {
    font-size: 12px;
  }

  .al__ln {
    padding: 0 8px 0 12px;
  }
}
</style>
