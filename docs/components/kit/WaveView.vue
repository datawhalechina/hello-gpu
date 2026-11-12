<script setup lang="ts">
/**
 * 锁步执行视图（S-07；03 第 3 节，08 第 4–5 节，01 第 2.4、6、7 节，02 第 1、3、4 节）。
 *
 * 左边是跑的那段代码（带行号），这一步在执行的行标出来，行尾是这一行的 lane 利用率；
 * 右边是这一步的 wave：一格一个 lane，格子里是 threadIdx.x。在干活的实心，空转（被掩码关掉）的虚线框，
 * 没有线程的斜纹，走到同步的写「‖」；下面是掩码、一句话说清哪些线程在干活，同步时 block 里每个 wave 走到了哪。
 * 再下面是这个 wave 走过的每一步（一条一步），两段分支一段接一段执行、哪些 lane 空转，一眼看得出来。
 * 全部从模拟器的事件流算出来（wave-view/model.ts）。
 *
 * 用法（全局注册，Markdown 里直接写）：
 *   放在 Sandbox 里，单步交给沙盒：
 *     <template #result="{ result, step, runs, source, lang }">
 *       <WaveView :result="result" :step="step" :launch="runs[0]?.launch ?? launch" :source="source" :lang="lang" :controls="false" />
 *     </template>
 *   关卡自己跑的结果（docs/sim/client.ts）：
 *     <WaveView :result="result" :launch="{ grid: 1, block: 32 }" :source="code" lang="hip" file="branch" />
 *
 * - 两种模式：play（默认）从头一步一步走（播放、暂停、上一步、下一步、从头、跳到最后、拖动），一步就是
 *   08 第 4 节的一步；result 直接看整段：每一行和整段的利用率、一个 wave 走过的全部步（可以换 wave）。
 *   给了 step（沙盒的单步）就只跟着它走；放进沙盒、还没单步时看整段。
 * - wave 大小跟着这次运行（launch.wave：32 或 64）。要切换就换 launch 再跑一次，页面上放一个旋钮。
 * - 键盘：焦点在视图上时 ← → 换一步，空格播放或暂停，Home 回到开头，End 跳到最后；按钮、进度条、下拉框是原生控件。
 * - 状态不只靠颜色：实心、虚线框、斜纹、「‖」，每一步还有一句话写清哪些线程在干活、哪些空转。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'
import type { RunResult } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { contentError } from './contentError.ts'
import { describeStep, type Launch, type SandboxStep } from './sandbox/run.ts'
import { codeLines } from './sandbox/template.ts'
import {
  describeLanes, describeUsage, KIND_NAME, laneViews, lineUseLabel, maskRuns, percent, prepareWave, syncLabel,
  syncProgress, usage, utilization, waveStateLabel, waveStates, waveThreads, wavesRun, waveTrace,
  type MaskRun, type WaveStatus, type WaveStep,
} from './wave-view/model.ts'

const props = withDefaults(defineProps<{
  /** 模拟器的结果：沙盒 result 插槽给的，或者关卡自己用 docs/sim/client.ts 跑的；还没运行是 null */
  result: RunResult | null
  /** 这次启动的 gridDim.x、blockDim.x；还没运行时按 wave（默认 32）画出第一个 wave */
  launch: Launch
  /** 跑的那段代码：左边按它显示，行号和事件对得上（沙盒 result 插槽给的 source） */
  source?: string | null
  lang?: Lang | null
  /** 沙盒单步走到的这一步：给了就只显示到这一步为止 */
  step?: SandboxStep | null
  /** 一开始的显示方式：play 逐步播放，result 直接看整段 */
  mode?: 'play' | 'result'
  /** 显示自己的「直接看结果 / 逐步播放」和播放控件；放进沙盒时写 false，单步交给沙盒 */
  controls?: boolean
  /** 代码区文件名栏里的名字，后面按写法接 .hip / .py */
  file?: string
  /** 还没运行时的说明 */
  emptyText?: string
}>(), {
  source: null,
  lang: null,
  step: null,
  mode: 'play',
  controls: true,
  file: 'kernel',
  emptyText: '还没运行。运行以后，这里一步一步显示一个 wave 的 lane：哪些在干活，哪些在空转。',
})

/** 逐步播放每一步停多久（02 第 1 节因果演示 400–800 ms；每秒换不到 3 次，不算闪烁；和 RobotGrid 一样） */
const STEP_MS = 500
/** 08 第 4 节：可视化场景的线程数不超过 1024（lockstep.ts 的 RUN_LIMITS.threads；这里只用类型，不打包解释器） */
const MAX_THREADS = 1024
/** 一个 wave 走过的步最多列多少条：逐步播放时留最近的，看整段时列最前面的 */
const TRACE_MAX = 200
/** 超过这么多条就在框里滚动（框的高度正好放下这么多条） */
const TRACE_ROWS = 10
const EXT: Record<Lang, string> = { hip: 'hip', python: 'py' }
const BAR: Record<MaskRun['state'], string> = { active: 'var(--blk)', idle: 'var(--hg-surface)', empty: 'transparent' }
const STATUS_MARK: Record<WaveStatus, string> = { idle: '·', running: '▶', waiting: '‖', ready: '…', done: '✓' }

const { page } = useData()
const root = ref<HTMLElement | null>(null)
const traceBox = ref<HTMLElement | null>(null)

const data = computed(() => props.step?.result ?? props.result)
const lang = computed<Lang>(() => props.lang ?? 'hip')
const fileName = computed(() => `${props.file}.${EXT[lang.value]}`)

const launchOk = computed(() => {
  const l = props.launch
  return Boolean(l) && Number.isInteger(l.grid) && Number.isInteger(l.block) && l.grid >= 1 && l.block >= 1 && l.grid * l.block <= MAX_THREADS
})
// 拆成两个数再拼：父组件每次渲染传一个新的 { grid, block } 对象时，数没变就不重算
const gridDim = computed(() => (launchOk.value ? props.launch.grid : 1))
const blockDim = computed(() => (launchOk.value ? props.launch.block : 1))
const launch = computed(() => ({ grid: gridDim.value, block: blockDim.value }))

/** 代码按行切好、带上高亮（和沙盒的静态代码同一套） */
const lines = computed(() => {
  if (!props.source) return []
  return codeLines({ source: props.source, ranges: [] }, lang.value, false)
    .map((segs) => segs.map((seg) => ({ text: seg.text, tone: seg.kind === 'text' ? seg.tone : null })))
})

const prepared = computed(() => (data.value && launchOk.value ? prepareWave(data.value, launch.value) : null))

const problem = computed(() => {
  if (!launchOk.value) {
    return contentError(`WaveView 的 launch 要写成 { grid, block }：都是正整数，乘起来不超过 ${MAX_THREADS}。现在是 ${JSON.stringify(props.launch)}。`, page.value.relativePath)
  }
  const s = prepared.value
  if (!s) return ''
  if (!props.source) return contentError('WaveView 要传 source（跑的那段代码）和 lang：左边按它显示代码，标出这一步在哪一行。', page.value.relativePath)
  const last = s.steps.reduce((max, st) => Math.max(max, st.line), 0)
  if (last > lines.value.length) {
    return contentError(`WaveView 的 source 和这次运行对不上：事件里有第 ${last} 行，代码只有 ${lines.value.length} 行。`, page.value.relativePath)
  }
  return ''
})

const src = computed(() => (problem.value ? null : prepared.value))
/** wave 大小：跑过就按这次运行；还没跑按 launch.wave */
const size = computed(() => src.value?.size ?? (props.launch?.wave === 64 ? 64 : 32))

// ── 播放 ────────────────────────────────────────────────────────────────

const count = computed(() => src.value?.steps.length ?? 0)
const external = computed(() => props.step ?? null)
const ownPlayer = computed(() => props.controls && !external.value && src.value !== null)
const view = ref<'result' | 'play'>(props.mode)
const playView = computed(() => ownPlayer.value && view.value === 'play')
/** 逐步播放走完了几步：0 是还没开始 */
const position = ref(0)
const playing = ref(false)
/** 看整段时选的 wave（waveList 的下标） */
const picked = ref(0)
let timer: ReturnType<typeof setTimeout> | null = null

/** 这一步（steps 的下标）：沙盒单步给的，或者自己播放到的；还没开始、看整段时是 -1 */
const current = computed(() => {
  if (external.value) return Math.min(external.value.index, count.value - 1)
  return playView.value ? position.value - 1 : -1
})
/** 看整段：自己的「直接看结果」，或者放在沙盒里、跑完了没有单步 */
const whole = computed(() => src.value !== null && !external.value && !playView.value)
const cur = computed<WaveStep | null>(() => (current.value >= 0 ? src.value?.steps[current.value] ?? null : null))

function clearTimer() {
  if (timer !== null) clearTimeout(timer)
  timer = null
}
function pause() {
  playing.value = false
  clearTimer()
}
function schedule() {
  clearTimer()
  timer = setTimeout(() => {
    timer = null
    if (!playing.value) return
    position.value = Math.min(position.value + 1, count.value)
    if (position.value >= count.value) pause()
    else schedule()
  }, STEP_MS)
}
function play() {
  if (!count.value) return
  if (position.value >= count.value) position.value = 0
  playing.value = true
  position.value += 1
  if (position.value >= count.value) pause()
  else schedule()
}
function go(to: number) {
  pause()
  position.value = Math.max(0, Math.min(to, count.value))
}
function setView(v: 'result' | 'play') {
  pause()
  if (v === 'play' && view.value !== 'play') position.value = 0
  view.value = v
}

/** 焦点在视图上时：← → 换一步，空格播放或暂停，Home 回到开头，End 跳到最后。看整段时先切到逐步播放。 */
function onKey(e: KeyboardEvent) {
  if (!ownPlayer.value || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const target = e.target as HTMLElement
  if (target.closest('input, select, textarea')) return
  const key = e.key
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(key) || (key === ' ' && target instanceof HTMLButtonElement)) return
  e.preventDefault()
  if (!playView.value) setView('play')
  if (key === ' ') {
    if (playing.value) pause()
    else play()
  } else if (key === 'ArrowLeft') go(position.value - 1)
  else if (key === 'ArrowRight') go(position.value + 1)
  else go(key === 'Home' ? 0 : count.value)
}

watch(() => props.mode, (m) => setView(m))
// 新的一次运行：从头放，看整段时回到第一个 wave
watch(data, () => {
  pause()
  position.value = 0
  picked.value = 0
})

const playLabel = computed(() => (playing.value ? '暂停' : position.value >= count.value && count.value ? '重新播放' : '播放'))
const caption = computed(() => {
  const s = src.value
  if (!s || !count.value) return '这次运行没有一步可以看。'
  if (position.value === 0) return `还没开始：一共 ${count.value} 步（一个 wave 执行一行算一步），点「播放」或「下一步」。`
  return `第 ${position.value} / ${count.value} 步：${describeStep(s.steps[position.value - 1], s.events, { ...launch.value, wave: s.size })}`
})

// ── 看哪个 wave、lane ──────────────────────────────────────────────────────

const waveList = computed(() => (src.value ? wavesRun(src.value) : []))
/** 右边和下面画的是哪个 wave：这一步的；看整段时是选的那个；还没开始是第一个跑的 */
const focus = computed(() => {
  const c = cur.value
  if (c) return { block: c.block, wave: c.wave }
  const list = waveList.value
  const pick = whole.value ? list[Math.min(picked.value, list.length - 1)] : list[0]
  return pick ? { block: pick.block, wave: pick.wave } : { block: 0, wave: 0 }
})
const focusThreads = computed(() => waveThreads(size.value, launch.value.block, focus.value.wave))
const focusRange = computed(() => {
  const first = focus.value.wave * size.value
  return focusThreads.value > 0 ? `${first}–${first + focusThreads.value - 1}` : '—'
})

const lanes = computed(() => laneViews(size.value, launch.value.block, focus.value.wave, cur.value))
const laneText = computed(() => describeLanes(lanes.value, 3))
const laneAria = computed(() => `block ${focus.value.block} 的 wave ${focus.value.wave}：${describeLanes(lanes.value)}`)
/** 格子里线程号的位数：三位、四位数时字小一点 */
const digits = computed(() => String(Math.max(0, focus.value.wave * size.value + focusThreads.value - 1)).length)
/** 掩码按 8 个 lane 一组写，和格子一行 16 个对得上 */
const maskGroups = computed(() => {
  const mask = cur.value?.mask ?? ''
  const out: string[] = []
  for (let k = 0; k < mask.length; k += 8) out.push(mask.slice(k, k + 8))
  return out
})

const sync = computed(() => {
  const s = src.value
  const c = cur.value
  if (!s || !c || c.kind !== 'barrier') return ''
  const progress = syncProgress(s, current.value)
  return progress ? syncLabel(progress, c.line) : ''
})
const states = computed(() => (src.value && cur.value && src.value.waves > 1 ? waveStates(src.value, current.value) : []))

const groupStyle = (b: number) => ({ '--blk': `var(--hg-group-${b % 6})`, '--blk-soft': `var(--hg-group-${b % 6}-soft)` })

// ── 利用率 ──────────────────────────────────────────────────────────────

const used = computed(() => (src.value ? usage(src.value, whole.value ? Number.POSITIVE_INFINITY : current.value + 1) : null))
const score = computed(() => (used.value ? percent(utilization(used.value)) : ''))
/** 出错停下的行：看整段，或者走到最后一步时标出来 */
const showError = computed(() => Boolean(src.value && !src.value.complete && (whole.value || current.value === count.value - 1)))

const rows = computed(() => {
  const byLine = new Map((used.value?.lines ?? []).map((l) => [l.line, l]))
  return lines.value.map((segs, k) => {
    const n = k + 1
    const use = byLine.get(n)
    return { n, segs, rate: use ? utilization(use) : null, label: use ? lineUseLabel(use, size.value) : '' }
  })
})

const summary = computed(() => {
  const s = src.value
  const u = used.value
  if (!s || !u) return ''
  if (!count.value) return `程序没有跑起来${s.errorLine ? `（第 ${s.errorLine} 行有错）` : ''}，没有一步可以看。`
  let text = describeUsage(u, s.size, whole.value ? 'all' : 'sofar')
  if (showError.value && s.errorLine) text += `程序在第 ${s.errorLine} 行出错停下了：只算出错之前走过的步。`
  return text
})

// ── 这个 wave 走过的步 ───────────────────────────────────────────────────

const trace = computed(() => {
  const s = src.value
  if (!s) return { rows: [] as WaveStep[], hidden: 0, total: 0 }
  const all = waveTrace(s, focus.value.block, focus.value.wave, whole.value ? Number.POSITIVE_INFINITY : current.value)
  const total = s.byWave[focus.value.block * s.waves + focus.value.wave]?.length ?? 0
  if (all.length <= TRACE_MAX) return { rows: all, hidden: 0, total }
  return { rows: whole.value ? all.slice(0, TRACE_MAX) : all.slice(-TRACE_MAX), hidden: all.length - TRACE_MAX, total }
})
const scrolls = computed(() => trace.value.rows.length > TRACE_ROWS)

/** 一步画成一条：在干活的 lane 涂组色，空转的留白，没有线程的露出底下的斜纹；每 8 个 lane 一道竖线。 */
function barStyle(step: WaveStep) {
  const n = size.value
  const threads = waveThreads(n, launch.value.block, step.wave)
  const stops = maskRuns(step.mask, threads).map((r) => `${BAR[r.state]} ${(r.from / n) * 100}% ${(r.to / n) * 100}%`)
  return { ...groupStyle(step.block), '--mask': `linear-gradient(to right, ${stops.join(', ')})`, '--groups': n / 8 }
}

// 逐步播放时跟着最新的一步滚到底；看整段、换 wave 时回到最上面
watch(trace, async () => {
  await nextTick()
  const box = traceBox.value
  if (box) box.scrollTop = whole.value ? 0 : box.scrollHeight
})

// ── 文字 ────────────────────────────────────────────────────────────────

const hasEmpty = computed(() => launch.value.block % size.value !== 0)
const hasSync = computed(() => Boolean(src.value?.steps.some((s) => s.kind === 'barrier')))
const rootLabel = computed(() => `锁步执行视图${ownPlayer.value ? '：焦点在这里时，← → 换一步，空格播放或暂停，Home 回到开头，End 跳到最后' : ''}`)
/** 读屏播报：沙盒单步时由沙盒播报，自动播放时不播报，停下来以后再说 */
const announce = computed(() => {
  if (external.value || playing.value || !src.value) return ''
  if (whole.value) return summary.value
  return `${caption.value}${cur.value ? laneText.value : ''}${sync.value}`
})

// ── 挂载 ────────────────────────────────────────────────────────────────

let observer: IntersectionObserver | null = null
const onVisibility = () => {
  if (document.hidden) pause()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  // 02 第 3 节：离开视口就暂停
  if (typeof IntersectionObserver !== 'undefined' && root.value) {
    observer = new IntersectionObserver((entries) => {
      if (entries.every((entry) => !entry.isIntersecting)) pause()
    })
    observer.observe(root.value)
  }
})

onBeforeUnmount(() => {
  pause()
  document.removeEventListener('visibilitychange', onVisibility)
  observer?.disconnect()
})
</script>

<template>
  <div
    ref="root"
    class="hg-wave"
    role="group"
    :aria-label="rootLabel"
    :tabindex="ownPlayer ? 0 : undefined"
    @keydown="onKey"
  >
    <p v-if="problem" class="hg-wave__problem" role="alert" data-hg-content-error>{{ problem }}</p>

    <div v-if="ownPlayer" class="hg-wave__toolbar">
      <div class="hg-wave__modes" role="group" aria-label="显示方式">
        <button type="button" class="hg-wave__mode" :aria-pressed="view === 'result'" @click="setView('result')">直接看结果</button>
        <button type="button" class="hg-wave__mode" :aria-pressed="view === 'play'" @click="setView('play')">逐步播放</button>
      </div>
      <template v-if="playView">
        <div class="hg-wave__transport" role="group" aria-label="逐步播放">
          <button type="button" class="hg-wave__button" :disabled="position === 0" @click="go(0)">从头</button>
          <button type="button" class="hg-wave__button" :disabled="position === 0" @click="go(position - 1)">上一步</button>
          <button type="button" class="hg-wave__button is-primary" :disabled="!count" @click="playing ? pause() : play()">{{ playLabel }}</button>
          <button type="button" class="hg-wave__button" :disabled="position >= count" @click="go(position + 1)">下一步</button>
          <button type="button" class="hg-wave__button" :disabled="position >= count" @click="go(count)">跳到最后</button>
        </div>
        <input
          class="hg-wave__range"
          type="range"
          min="0"
          :max="count"
          step="1"
          :value="position"
          aria-label="拖动到第几步"
          :aria-valuetext="position ? `第 ${position} / ${count} 步` : '还没开始'"
          @input="go(Number(($event.target as HTMLInputElement).value))"
        >
        <p class="hg-wave__caption">{{ caption }}</p>
        <p class="hg-wave__note">播放速度不代表 GPU 耗时。焦点在这个视图上时，← → 换一步，空格播放或暂停。</p>
      </template>
    </div>

    <div class="hg-wave__main">
      <!-- 代码区在亮暗主题下都是深色（01 第 2.4 节）：里面的错误色取暗色那一套 -->
      <div class="hg-wave__code" data-hg-theme="dark" role="group" :aria-label="`${fileName} 的代码，行尾是这一行的 lane 利用率`">
        <p class="hg-wave__file">
          <span>{{ fileName }}</span>
          <span v-if="src" class="hg-wave__file-note">行尾：{{ whole ? '' : '到这一步为止' }}这一行的 lane 利用率</span>
        </p>
        <p v-if="!rows.length" class="hg-wave__nocode">运行以后，这里显示跑的那段代码。</p>
        <div v-else class="hg-wave__listing" translate="no">
          <div class="hg-wave__lines">
            <div
              v-for="row in rows"
              :key="row.n"
              class="hg-wave__line"
              :class="{ 'is-current': cur?.line === row.n, 'is-error': showError && src?.errorLine === row.n }"
            >
              <span class="hg-wave__ln" aria-hidden="true">{{ row.n }}</span>
              <span class="hg-wave__lc"><span
                v-for="(seg, k) in row.segs"
                :key="k"
                :class="seg.tone ? `is-${seg.tone}` : undefined"
              >{{ seg.text }}</span><span v-if="cur?.line === row.n" class="hg-wave__sr">（这一步在这一行）</span></span>
              <span class="hg-wave__use" :title="row.label || undefined">
                <template v-if="row.rate !== null">
                  <span class="hg-wave__meter" aria-hidden="true"><span :style="{ width: `${row.rate * 100}%` }" /></span>
                  <span class="hg-wave__sr">第 {{ row.n }} 行的 lane 利用率</span>{{ percent(row.rate) }}
                </template>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="whole" class="hg-wave__side" role="group" aria-label="整段的 lane 利用率">
        <p class="hg-wave__score"><strong>{{ score }}</strong><span>整段的 lane 利用率（模拟）</span></p>
        <p class="hg-wave__summary">{{ summary }}</p>
        <label v-if="waveList.length > 1" class="hg-wave__pick">
          <span>下面列出哪个 wave 走过的步</span>
          <span class="hg-wave__select">
            <select v-model.number="picked">
              <option v-for="(w, k) in waveList" :key="k" :value="k">block {{ w.block }} · wave {{ w.wave }}（{{ w.steps }} 步）</option>
            </select>
          </span>
        </label>
      </div>

      <div v-else class="hg-wave__side" role="group" :aria-label="cur ? '这一步的 wave' : '第一个 wave'">
        <div class="hg-wave__head">
          <span class="hg-wave__label">{{ cur ? '这一步的 wave' : src ? '第一个跑的 wave' : '一个 wave' }}</span>
          <span class="hg-wave__meta">block {{ focus.block }} · wave {{ focus.wave }} · threadIdx.x {{ focusRange }}</span>
        </div>
        <div
          class="hg-wave__lanes"
          :class="`is-d${digits}`"
          role="img"
          :aria-label="laneAria"
          :style="groupStyle(focus.block)"
        >
          <span v-for="l in lanes" :key="l.lane" class="hg-wave__lane" :class="`is-${l.state}`">{{ l.state === 'sync' ? '‖' : l.thread ?? '' }}</span>
        </div>
        <p v-if="maskGroups.length" class="hg-wave__mask">
          <span class="hg-wave__mask-label">掩码</span>
          <code><span v-for="(g, k) in maskGroups" :key="k">{{ g }}</span></code>
        </p>
        <p class="hg-wave__lanes-text">{{ laneText }}</p>
        <p v-if="sync" class="hg-wave__sync">{{ sync }}</p>
        <ul v-if="states.length" class="hg-wave__waves" :aria-label="`block ${focus.block} 的 ${states.length} 个 wave 走到了哪`">
          <li v-for="s in states" :key="s.wave" :class="`is-${s.status}`">
            <span class="hg-wave__wmark" aria-hidden="true">{{ STATUS_MARK[s.status] }}</span>
            <span class="hg-wave__wname">wave {{ s.wave }}</span>
            <span class="hg-wave__wrange">threadIdx.x {{ s.first }}–{{ s.last }}</span>
            <span class="hg-wave__wtext">{{ waveStateLabel(s, cur?.kind ?? null) }}</span>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="src" class="hg-wave__history" role="group" :aria-label="`block ${focus.block} 的 wave ${focus.wave} 走过的步`">
      <div class="hg-wave__head">
        <span class="hg-wave__label">这个 wave 走过的步</span>
        <span class="hg-wave__meta">block {{ focus.block }} · wave {{ focus.wave }} · {{ whole ? `一共 ${trace.total} 步` : `走了 ${trace.rows.length + trace.hidden} / ${trace.total} 步` }}</span>
        <span class="hg-wave__hint">一条是一步：涂色的 lane 在干活，留白的空转<template v-if="hasEmpty">，斜纹的没有线程</template></span>
      </div>
      <p v-if="!trace.rows.length" class="hg-wave__none">还没开始。</p>
      <template v-else>
        <p v-if="trace.hidden && !whole" class="hg-wave__more">更早的 {{ trace.hidden }} 步没有列出来。</p>
        <ol
          ref="traceBox"
          class="hg-wave__trace"
          :class="{ 'is-scroll': scrolls }"
          :tabindex="scrolls ? 0 : undefined"
          :aria-label="scrolls ? '这个 wave 走过的步（可以滚动）' : undefined"
        >
          <li
            v-for="row in trace.rows"
            :key="row.index"
            v-memo="[row, row.index === current, size]"
            class="hg-wave__row"
            :class="{ 'is-current': row.index === current }"
          >
            <span class="hg-wave__sr">第 {{ row.index + 1 }} 步，第 {{ row.line }} 行（{{ KIND_NAME[row.kind] }}）：{{ row.active }} / {{ size }} 个 lane 在干活{{ row.index === current ? '，就是这一步' : '' }}</span>
            <span class="hg-wave__row-line" aria-hidden="true">第 {{ row.line }} 行</span>
            <span class="hg-wave__row-kind" :class="`is-${row.kind}`" aria-hidden="true">{{ KIND_NAME[row.kind] }}</span>
            <span class="hg-wave__bar" :style="barStyle(row)" aria-hidden="true" />
            <span class="hg-wave__row-count" aria-hidden="true">{{ row.active }}/{{ size }}</span>
          </li>
        </ol>
        <p v-if="trace.hidden && whole" class="hg-wave__more">后面还有 {{ trace.hidden }} 步没有列出来（利用率照样算上了）。</p>
      </template>
    </div>

    <p v-if="!src" class="hg-wave__empty">{{ emptyText }}</p>
    <p v-if="summary && !whole" class="hg-wave__summary">{{ summary }}</p>
    <p class="hg-wave__sr" aria-live="polite">{{ announce }}</p>

    <ul class="hg-wave__legend" aria-label="图例">
      <li><span class="hg-wave__sw is-active" aria-hidden="true" />在干活</li>
      <li><span class="hg-wave__sw is-idle" aria-hidden="true" />空转（被掩码关掉）</li>
      <li v-if="hasEmpty"><span class="hg-wave__sw is-empty" aria-hidden="true" />没有线程</li>
      <li v-if="hasSync"><span class="hg-wave__sw is-sync" aria-hidden="true">‖</span>走到同步，等齐再走</li>
    </ul>
  </div>
</template>

<style scoped>
.hg-wave {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: 14px;
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.hg-wave:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-wave__problem {
  margin: 0;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

/* ── 模式切换和播放（和 RobotGrid 一样） ── */

.hg-wave__toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
}

.hg-wave__modes {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 3px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  box-shadow: inset 0 0 0 1px var(--hg-border);
}

.hg-wave__mode {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--hg-ink-2);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--motion-ease-out), color var(--motion-fast) var(--motion-ease-out);
}

.hg-wave__mode[aria-pressed='true'] {
  background: var(--hg-surface);
  color: var(--hg-ink);
  box-shadow: var(--hg-shadow);
}

.hg-wave__transport {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hg-wave__button {
  min-height: 36px;
  padding: 0 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节） */
.hg-wave__button.is-primary {
  min-width: 6.5em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-wave__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.hg-wave__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-wave__range {
  width: 100%;
  margin: 0;
  accent-color: var(--hg-accent);
}

.hg-wave__caption {
  margin: 0;
  color: var(--hg-ink);
  font-size: 14px;
  line-height: 1.6;
}

.hg-wave__note,
.hg-wave__hint {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 12px;
}

/* ── 左边代码，右边 wave；窄的时候上下排 ── */

.hg-wave__main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

@container (min-width: 720px) {
  .hg-wave__main {
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  }
}

/* 深色代码区（01 第 2.4 节），和沙盒同样的底色、行号色、高亮色 */
.hg-wave__code {
  min-width: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-code-dot);
  border-radius: 12px;
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.hg-wave__file {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 2px 12px;
  margin: 0;
  padding: 6px 12px;
  border-bottom: var(--hg-border-width) solid var(--hg-code-dot);
  color: var(--hg-code-file);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  line-height: 1.6;
}

.hg-wave__file-note {
  font-family: var(--hg-font-body);
  font-size: 12px;
}

.hg-wave__nocode {
  margin: 0;
  padding: 14px 12px;
  color: var(--hg-code-file);
  font-size: 13px;
}

/* 代码太宽时整块横向滚动；行号钉在左边，利用率钉在右边 */
.hg-wave__listing {
  overflow-x: auto;
}

.hg-wave__lines {
  width: max-content;
  min-width: 100%;
  padding: 8px 0;
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.75;
}

.hg-wave__line {
  display: grid;
  grid-template-columns: 3.4em minmax(0, 1fr) 7.4em;
  white-space: pre;
}

.hg-wave__ln,
.hg-wave__use {
  position: sticky;
  z-index: 1;
  background: var(--hg-code-bg);
}

.hg-wave__ln {
  left: 0;
  padding: 0 10px 0 14px;
  color: var(--hg-code-line-number);
  text-align: right;
  user-select: none;
}

.hg-wave__lc {
  padding: 0 12px 0 6px;
}

.hg-wave__use {
  right: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 0 12px 0 8px;
  color: var(--hg-code-ink);
  font-size: 12px;
}

/*
 * 这一行没有走过：不挡住底下的代码（长的行在这里还能看到）。当前行、出错行的底色也交给底下代码那一格，
 * 不叠两层（这条要比下面「当前行」那条更具体）。
 */
.hg-wave__line > .hg-wave__use:empty {
  background: none;
}

.hg-wave__meter {
  flex: none;
  width: 28px;
  height: 6px;
  overflow: hidden;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-code-dot);
}

.hg-wave__meter > span {
  display: block;
  height: 100%;
  background: var(--hg-code-safe);
  transition: width var(--motion-base) var(--motion-ease-out);
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

/* 这一步在执行的行：琥珀色的底和行号旁的「▶」（不只靠颜色） */
.hg-wave__line.is-current > span {
  background-image: linear-gradient(color-mix(in srgb, var(--hg-code-highlight) 16%, transparent), color-mix(in srgb, var(--hg-code-highlight) 16%, transparent));
}

.hg-wave__line.is-current .hg-wave__ln {
  color: var(--hg-code-highlight);
}

.hg-wave__line.is-current .hg-wave__ln::before,
.hg-wave__line.is-error .hg-wave__ln::before {
  position: absolute;
  left: 3px;
  width: 10px;
  font-weight: 700;
  text-align: center;
}

.hg-wave__line.is-current .hg-wave__ln::before {
  content: '▶';
  color: var(--hg-code-highlight);
  font-size: 9px;
}

.hg-wave__line.is-error > span {
  background-image: linear-gradient(var(--hg-error-soft), var(--hg-error-soft));
}

.hg-wave__line.is-error .hg-wave__ln::before {
  content: '!';
  color: var(--hg-error-ink);
}

/* ── 右边：这一步的 wave，或者整段的利用率 ── */

.hg-wave__side {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.hg-wave__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
}

.hg-wave__label {
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 700;
}

.hg-wave__meta {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

/* lane：一行 16 个，格子里是 threadIdx.x */
.hg-wave__lanes {
  display: grid;
  grid-template-columns: repeat(16, minmax(0, 1fr));
  gap: 3px;
  max-width: 480px;
}

.hg-wave__lane {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  min-width: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: 5px;
  background: var(--hg-surface-2);
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    border-color var(--motion-fast) var(--motion-ease-out),
    color var(--motion-fast) var(--motion-ease-out);
}

.hg-wave__lanes.is-d3 .hg-wave__lane {
  font-size: 8px;
}

.hg-wave__lanes.is-d4 .hg-wave__lane {
  font-size: 7px;
  letter-spacing: -0.04em;
}

.hg-wave__lane.is-active,
.hg-wave__lane.is-sync {
  border-color: var(--blk);
  background: var(--blk-soft);
  color: var(--hg-ink);
}

.hg-wave__lane.is-sync {
  font-size: 11px;
}

/* 空转：虚线框、不填色（01 第 7 节：跳过 / 空闲 = 灰 + 虚线） */
.hg-wave__lane.is-idle {
  border-style: dashed;
  border-color: var(--hg-idle);
  background: transparent;
  color: var(--hg-ink-3);
}

/* 没有线程：斜纹，没有字 */
.hg-wave__lane.is-empty {
  border-color: transparent;
  background: repeating-linear-gradient(45deg, var(--hg-border) 0 2px, transparent 2px 5px);
}

.hg-wave__mask {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  margin: 0;
}

.hg-wave__mask-label {
  color: var(--hg-ink-3);
  font-size: 12px;
}

.hg-wave__mask code {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.6em;
  padding: 0;
  border: 0;
  background: none;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.hg-wave__lanes-text,
.hg-wave__sync,
.hg-wave__summary,
.hg-wave__empty {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}

.hg-wave__lanes-text {
  color: var(--hg-ink-2);
}

.hg-wave__sync {
  padding: 6px 10px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
}

.hg-wave__waves {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  font-size: 13px;
  list-style: none;
}

.hg-wave__waves li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 8px;
  margin: 0;
  color: var(--hg-ink-2);
}

.hg-wave__waves li.is-running {
  color: var(--hg-ink);
  font-weight: 600;
}

.hg-wave__wmark {
  width: 1em;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  text-align: center;
}

.hg-wave__waves li.is-running .hg-wave__wmark {
  color: var(--hg-accent-ink);
}

.hg-wave__wname,
.hg-wave__wrange {
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.hg-wave__wrange {
  color: var(--hg-ink-3);
}

/* 整段：大号的利用率 */
.hg-wave__score {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0;
}

.hg-wave__score strong {
  font-family: var(--hg-font-display);
  font-size: 36px;
  font-weight: 700;
  line-height: 1.1;
}

.hg-wave__score span {
  color: var(--hg-ink-3);
  font-size: 13px;
}

.hg-wave__summary {
  color: var(--hg-ink);
  font-weight: 600;
}

.hg-wave__pick {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--hg-ink-3);
  font-size: 12px;
}

/* 站点的基础样式去掉了下拉框的原生箭头：自己画一个「▾」，看得出能点开选（同沙盒手机上的选项） */
.hg-wave__select {
  position: relative;
  align-self: flex-start;
  max-width: 100%;
}

.hg-wave__select::after {
  content: '▾';
  position: absolute;
  top: 50%;
  right: 11px;
  color: var(--hg-ink-2);
  font-size: 12px;
  line-height: 1;
  transform: translateY(-50%);
  pointer-events: none;
}

.hg-wave__pick select {
  max-width: 100%;
  min-height: 36px;
  padding: 0 2.2em 0 10px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  cursor: pointer;
}

/* ── 这个 wave 走过的步：一条一步 ── */

.hg-wave__history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.hg-wave__trace {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 2px;
  list-style: none;
}

/* 超过 TRACE_ROWS 条在框里滚动：一条 20px + 间隔 2px */
.hg-wave__trace.is-scroll {
  max-height: calc(10 * 22px + 4px);
  overflow-y: auto;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-tag);
}

.hg-wave__row {
  display: grid;
  grid-template-columns: 4.6em 2.6em minmax(0, 1fr) 4.4em;
  align-items: center;
  gap: 8px;
  height: 20px;
  margin: 0;
  padding: 0 6px;
  border-radius: 4px;
  color: var(--hg-ink-2);
  font-size: 12px;
}

.hg-wave__row.is-current {
  background: var(--hg-accent-soft);
  box-shadow: inset 0 0 0 1px var(--hg-accent);
  color: var(--hg-ink);
}

.hg-wave__row-line,
.hg-wave__row-count {
  font-family: var(--hg-font-mono);
  white-space: nowrap;
}

.hg-wave__row-count {
  text-align: right;
}

.hg-wave__row-kind {
  white-space: nowrap;
}

.hg-wave__row-kind.is-stmt {
  color: var(--hg-ink);
}

/*
 * 掩码画成一条（三层背景）：每 8 个 lane 一道竖线；在干活的涂组色、空转的留白；
 * 没有线程的那几格透明，露出最底下的斜纹。
 */
.hg-wave__bar {
  height: 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background:
    linear-gradient(to right, transparent calc(100% - 1px), var(--hg-border-strong) 0) 0 0 / calc(100% / var(--groups)) 100%,
    var(--mask),
    repeating-linear-gradient(45deg, var(--hg-border) 0 2px, transparent 2px 5px);
}

.hg-wave__none,
.hg-wave__more {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 12px;
}

.hg-wave__empty {
  padding: 12px 14px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  color: var(--hg-ink-3);
}

.hg-wave__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* 图例：每种 lane 都有自己的样子，不只靠颜色（01 第 7 节） */
.hg-wave__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.hg-wave__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

.hg-wave__sw {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 4px;
  font-family: var(--hg-font-mono);
  font-size: 10px;
  font-weight: 700;
}

.hg-wave__sw.is-active,
.hg-wave__sw.is-sync {
  border-color: var(--hg-group-0);
  background: var(--hg-group-0-soft);
  color: var(--hg-ink);
}

.hg-wave__sw.is-idle {
  border-style: dashed;
  border-color: var(--hg-idle);
}

.hg-wave__sw.is-empty {
  border-color: transparent;
  background: repeating-linear-gradient(45deg, var(--hg-border) 0 2px, transparent 2px 5px);
}

.hg-wave__mode:focus-visible,
.hg-wave__button:focus-visible,
.hg-wave__range:focus-visible,
.hg-wave__pick select:focus-visible,
.hg-wave__trace:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

@media (max-width: 767px) {
  .hg-wave {
    padding: 12px;
  }

  .hg-wave__lanes {
    gap: 2px;
  }

  .hg-wave__row {
    grid-template-columns: 4.4em 2.4em minmax(0, 1fr) 3.8em;
    gap: 6px;
    padding: 0 4px;
    font-size: 11px;
  }
}

/*
 * 窄的时候（手机）：代码小一号，行尾只写百分比、不画小条，少挡一点代码；
 * 放在最后，盖过上面同样写法的默认值。
 */
@container (max-width: 480px) {
  .hg-wave__lines {
    font-size: 12px;
  }

  .hg-wave__line {
    grid-template-columns: 2.8em minmax(0, 1fr) 3.8em;
  }

  .hg-wave__ln {
    padding: 0 8px 0 12px;
  }

  .hg-wave__use {
    padding: 0 6px 0 4px;
    font-size: 10px;
  }

  .hg-wave__meter {
    display: none;
  }
}
</style>
