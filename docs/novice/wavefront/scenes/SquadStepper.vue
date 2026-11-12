<script setup lang="ts">
/**
 * 1-5 探索一「一个口令，整队一起动」（关卡自己的 scenes，不用登记组件）：锁步单步执行器。
 *
 * 派 1 组线程，数据和线程一样多（旋钮 1 / 8 / 32 个）。上面是工作单（跟着写法偏好，跑的就是这一段），
 * 这一步在执行的行标「▶」；下面是一条流水线的 32 个工位：有线程的站着线程小机器人，屏幕上是 threadIdx.x，
 * 这一步在干活的工位亮起来，机器人脚下写它这一步做的事（计算、判断、写的那一格）。
 * 一步就是 08 第 4 节的一步（一个 wave 执行一行），和 WaveView、沙盒单步一样从模拟器的事件流算出来
 * （wave-view/model.ts 的 prepareWave，challenge.ts 的 seatsAt）。旋钮一动、换写法，就在 Web Worker 里重跑，
 * 回到还没开始。
 * 键盘：按钮都是原生的；焦点在工位区时 ← → 换一步，Home 回到开头，End 跳到最后。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import ThreadBot from '@kit/ThreadBot.vue'
import { buildRequest, type Launch } from '@kit/sandbox/run.ts'
import { codeLines } from '@kit/sandbox/template.ts'
import { prepareWave, type WaveSource, type WaveStep } from '@kit/wave-view/model.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { useProgress } from '@course/useProgress.ts'
import { KERNEL, STEP_DEFAULT, STEP_THREADS, WAVE, addArgs, launchLine, seatsAt, type SeatView } from '../challenge.ts'

const progress = useProgress()
const titleId = `${useId()}-title`
const THREAD_OPTIONS = [...STEP_THREADS]
const EXT: Record<Lang, string> = { hip: 'hip', python: 'py' }

const threads = ref<number>(STEP_DEFAULT)
const launch = computed<Launch>(() => ({ grid: 1, block: threads.value }))

/** 挂载之前（服务端渲染、水合）按 HIP 写；挂载以后跟着写法偏好（同 1-4 的沙盒）。 */
const mounted = ref(false)
const lang = computed<Lang>(() => (mounted.value ? progress.state.prefs.lang : 'hip'))

const run = shallowRef<{ launch: Launch; lang: Lang; result: RunResult } | null>(null)
const problem = ref('')
/** 走完了几步：0 是还没开始 */
const position = ref(0)
let client: SimClient | null = null

async function simulate() {
  if (!client) return
  const l = lang.value
  const config = { ...launch.value }
  try {
    const result = await client.run(buildRequest(KERNEL[l], l, config, addArgs(config.block)))
    run.value = { launch: config, lang: l, result }
    position.value = 0
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着拨旋钮时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `实验没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch([threads, lang], simulate)

onMounted(() => {
  mounted.value = true
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())

// ── 这一步 ──────────────────────────────────────────────────────────────

/** 结果和旋钮对得上才用（拨旋钮以后、新结果回来之前，先按新的人数画待命的机器人） */
const src = computed<WaveSource | null>(() => {
  const r = run.value
  if (!r || r.launch.block !== threads.value || r.lang !== lang.value || !r.result.ok) return null
  return prepareWave(r.result, r.launch)
})
const count = computed(() => src.value?.steps.length ?? 0)
const cur = computed<WaveStep | null>(() => (position.value > 0 ? src.value?.steps[position.value - 1] ?? null : null))

const seats = computed<SeatView[]>(() => {
  if (src.value) return seatsAt(src.value, position.value)
  return Array.from({ length: WAVE }, (_, lane) => (lane < threads.value
    ? { lane, thread: lane, state: 'standby', tag: '' }
    : { lane, thread: null, state: 'empty', tag: '' }))
})

function go(to: number) {
  position.value = Math.max(0, Math.min(to, count.value))
}

/** 焦点在工位区时：← → 换一步，Home 回到开头，End 跳到最后。 */
function onKey(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const moves: Record<string, () => number> = {
    ArrowLeft: () => position.value - 1,
    ArrowRight: () => position.value + 1,
    Home: () => 0,
    End: () => count.value,
  }
  const move = moves[e.key]
  if (!move) return
  e.preventDefault()
  go(move())
}

// ── 代码 ────────────────────────────────────────────────────────────────

const lines = computed(() => codeLines({ source: KERNEL[lang.value], ranges: [] }, lang.value, false)
  .map((segs, k) => ({
    n: k + 1,
    segs: segs.map((seg) => ({ text: seg.text, tone: seg.kind === 'text' ? seg.tone : null })),
  })))
const fileName = computed(() => `add.${EXT[lang.value]}`)
const launchText = computed(() => launchLine(launch.value, lang.value))

// ── 文字 ────────────────────────────────────────────────────────────────

/** 这一步整队在做的事：判断、读写数组，或者计算；writes 是这一步有没有写数组。 */
function doing(step: WaveStep, s: WaveSource): { text: string; writes: boolean } {
  if (step.kind === 'branch') return { text: '判断条件', writes: false }
  const own = s.events.slice(step.from, step.to)
  const names = (op: string) => [...new Set(own.filter((e) => e.op === op).map((e) => e.array))].join('、')
  const reads = names('load')
  const writes = names('store')
  if (writes) return { text: reads ? `读 ${reads}，写 ${writes}` : `写 ${writes}`, writes: true }
  return { text: '计算', writes: false }
}

const caption = computed(() => {
  const s = src.value
  if (!s) return problem.value ? '' : '模拟器准备中……'
  if (!cur.value) return `还没开始：一共 ${count.value} 步，一步走一行。点「下一步」。`
  const step = cur.value
  const who = step.active === 1 ? '1 个线程' : `${step.active} 个线程一起`
  return `第 ${position.value} / ${count.value} 步，第 ${step.line} 行：${who}${doing(step, s).text}。`
})

/** 一句话解读（03 第 1 节第 4 条）：几步走完，空着几个工位。 */
const readout = computed(() => {
  const s = src.value
  if (!s) return ''
  const t = threads.value
  const empty = s.size - t
  const head = `派 ${t} 个线程：一共 ${count.value} 步，每一步整队只走一行`
  return empty
    ? `${head}。另外 ${empty} 个工位没有线程，这 ${count.value} 步都空着。`
    : `${head}。${t} 个工位正好坐满。`
})

const seatsLabel = computed(() => {
  const empty = seats.value.filter((x) => x.state === 'empty').length
  const head = `一条流水线的 ${WAVE} 个工位，${WAVE - empty} 个站着线程小机器人`
  const s = src.value
  const step = cur.value
  if (!s || !step) return `${head}，都在待命。焦点在这里时，← → 换一步。`
  const what = doing(step, s)
  const tags = seats.value.filter((x) => x.state === 'active').map((x) => x.tag)
  const cells = !what.writes ? '' : tags.length > 1 ? `，从 ${tags[0]} 到 ${tags[tags.length - 1]} 各写一格` : `，写的是 ${tags[0]}`
  const who = step.active === 1 ? '1 个在干活' : `${step.active} 个一起干活`
  return `${head}；这一步 ${who}：${what.text}${cells}。焦点在这里时，← → 换一步。`
})
</script>

<template>
  <section class="ss" :aria-labelledby="titleId">
    <header class="ss__head">
      <span class="ss__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="ss__title">单步执行器：一个口令，整队一起动</strong>
      <span class="ss__tag">模拟</span>
    </header>
    <p class="ss__rules">派 1 组线程，数据和线程一样多。代码里亮起的那一行，就是这一步全队在做的事；机器人脚下写着它这一步做了什么。</p>

    <div class="ss__knobs">
      <Knob label="这一组派几个线程" code="blockDim.x" :options="THREAD_OPTIONS" unit=" 个" v-model="threads" />
    </div>

    <!-- 代码区在亮暗主题下都是深色（01 第 2.4 节），同 WaveView -->
    <div class="ss__code" data-hg-theme="dark" role="group" :aria-label="`${fileName} 的代码`">
      <p class="ss__file">{{ fileName }}</p>
      <div class="ss__listing" translate="no">
        <div class="ss__lines">
          <div v-for="row in lines" :key="row.n" class="ss__line" :class="{ 'is-current': cur?.line === row.n }">
            <span class="ss__ln" aria-hidden="true">{{ row.n }}</span>
            <span class="ss__lc"><span
              v-for="(seg, k) in row.segs"
              :key="k"
              :class="seg.tone ? `is-${seg.tone}` : undefined"
            >{{ seg.text }}</span><span v-if="cur?.line === row.n" class="ss__sr">（这一步在这一行）</span></span>
          </div>
        </div>
      </div>
    </div>
    <p class="ss__launch">
      <span class="ss__launch-label">启动时这样写：</span>
      <code translate="no">{{ launchText }}</code>
    </p>

    <div class="ss__transport" role="group" aria-label="一步一步走">
      <button type="button" class="ss__button" :disabled="position === 0" @click="go(0)">从头</button>
      <button type="button" class="ss__button" :disabled="position === 0" @click="go(position - 1)">上一步</button>
      <button type="button" class="ss__button is-primary" :disabled="!count || position >= count" @click="go(position + 1)">下一步</button>
    </div>
    <p class="ss__caption" aria-live="polite">{{ caption }}</p>
    <p v-if="problem" class="ss__problem" role="alert">{{ problem }}</p>

    <div class="ss__simd" role="group" :aria-label="seatsLabel" tabindex="0" @keydown="onKey">
      <div
        v-for="seat in seats"
        :key="seat.lane"
        class="ss__seat"
        :class="`is-${seat.state}`"
        aria-hidden="true"
      >
        <ThreadBot v-if="seat.thread !== null" class="ss__bot" :label="seat.thread" :size="30" />
        <span class="ss__say">{{ seat.tag }}</span>
        <span class="ss__no">{{ seat.lane }}</span>
      </div>
    </div>

    <p v-if="readout" class="ss__readout">{{ readout }}</p>
    <ul class="ss__legend" aria-label="图例">
      <li><span class="ss__sw is-active" aria-hidden="true" />这一步在干活</li>
      <li><span class="ss__sw is-standby" aria-hidden="true" />有线程，还没开始</li>
      <li><span class="ss__sw is-empty" aria-hidden="true" />空着的工位（没有线程）</li>
    </ul>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同 1-4 的实验台（GroupLab）。 */
.ss {
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

.ss__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ss__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ss__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ss__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.ss__rules {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.ss__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* 深色代码区：同 WaveView 的底色、行号色和当前行的琥珀色 */
.ss__code {
  min-width: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-code-dot);
  border-radius: 12px;
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.ss__file {
  margin: 0;
  padding: 6px 12px;
  border-bottom: var(--hg-border-width) solid var(--hg-code-dot);
  color: var(--hg-code-file);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  line-height: 1.6;
}

/* 代码太宽时整块横向滚动（01 第 7 节允许），行号钉在左边 */
.ss__listing {
  overflow-x: auto;
}

.ss__lines {
  width: max-content;
  min-width: 100%;
  padding: 8px 0;
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.75;
}

.ss__line {
  display: grid;
  grid-template-columns: 3.2em minmax(0, 1fr);
  white-space: pre;
}

.ss__ln {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 0 10px 0 14px;
  background: var(--hg-code-bg);
  color: var(--hg-code-line-number);
  text-align: right;
  user-select: none;
}

.ss__lc {
  padding: 0 14px 0 6px;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

/* 这一步在执行的行：琥珀色的底和行号旁的「▶」（不只靠颜色） */
.ss__line.is-current > span {
  background-image: linear-gradient(color-mix(in srgb, var(--hg-code-highlight) 16%, transparent), color-mix(in srgb, var(--hg-code-highlight) 16%, transparent));
}

.ss__line.is-current .ss__ln {
  color: var(--hg-code-highlight);
}

.ss__line.is-current .ss__ln::before {
  content: '▶';
  position: absolute;
  left: 3px;
  width: 10px;
  color: var(--hg-code-highlight);
  font-size: 9px;
  font-weight: 700;
  text-align: center;
}

.ss__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: -4px 0 0;
  font-size: 14px;
}

.ss__launch-label {
  color: var(--hg-ink-2);
}

.ss__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.ss__transport {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.ss__button {
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

.ss__button.is-primary {
  min-width: 6em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.ss__button:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.ss__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ss__button:focus-visible,
.ss__simd:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.ss__caption {
  min-height: 1.6em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}

.ss__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}

/* 一条流水线：窄屏一行 8 个工位，宽屏一行 16 个（同 1-3 的工位图） */
.ss__simd {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  padding: 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .ss__simd {
    grid-template-columns: repeat(16, minmax(0, 1fr));
  }
}

/* 工位：有线程是实线框 + 机器人，空着是虚线框；这一步在干活的描强调色、铺浅底（不只靠颜色：还有脚下的字） */
.ss__seat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  min-width: 0;
  min-height: 72px;
  padding: 4px 0 3px;
  border: var(--hg-border-width) solid var(--hg-ink-3);
  border-radius: 6px;
  background: var(--hg-surface);
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    border-color var(--motion-fast) var(--motion-ease-out);
}

.ss__seat.is-active {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
  box-shadow: inset 0 0 0 1px var(--hg-accent);
}

.ss__seat.is-empty {
  border-style: dashed;
  border-color: var(--hg-border-strong);
  background: transparent;
}

.ss__bot {
  max-width: 100%;
  height: auto;
}

/* 还没开始：机器人变灰变淡（同 RobotGrid 的「待命」） */
.ss__seat.is-standby .ss__bot {
  opacity: 0.4;
  filter: grayscale(1);
}

.ss__say {
  min-height: 1.3em;
  max-width: 100%;
  overflow: hidden;
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
}

.ss__no {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 10px;
  line-height: 1;
}

.ss__readout {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.ss__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.ss__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

.ss__sw {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: var(--hg-border-width) solid var(--hg-ink-3);
  border-radius: 4px;
  background: var(--hg-surface);
}

.ss__sw.is-active {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

.ss__sw.is-standby {
  opacity: 0.5;
}

.ss__sw.is-empty {
  border-style: dashed;
  border-color: var(--hg-border-strong);
  background: transparent;
}

.ss__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 639px) {
  .ss {
    padding: 16px 14px;
  }

  .ss__knobs {
    padding: 12px 10px;
  }

  .ss__simd {
    gap: 4px;
    padding: 8px 6px;
  }

  .ss__lines {
    font-size: 12px;
  }

  .ss__ln {
    padding: 0 8px 0 12px;
  }
}
</style>
