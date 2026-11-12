<script setup lang="ts">
/**
 * 线程机器人网格（S-06；03 第 3 节，08 第 5 节，01 第 5–7 节，02 第 1–5 节）。
 *
 * 上面是派出的线程：按 block 分组，一个线程一个线程小机器人，屏幕上是 threadIdx.x，脚下写它写了哪一格；
 * 下面是显存里的一个数组（显存格子），被写到的数组外面的位置单独放在红色虚线框里（越界区）。
 * 全部从模拟器的事件流算出来（robot-grid/model.ts）：写入、越界写、检查后跳过、没人算、重复计算。
 * 指到（键盘移到、手机上点）一个机器人，它写的格子跟着亮；指到一个格子，写它的机器人跟着亮。
 *
 * 用法（全局注册，Markdown 里直接写）：
 *   放在 Sandbox 里，单步交给沙盒：
 *     <template #result="{ result, step, runs }">
 *       <RobotGrid :result="result" :step="step" :launch="runs[0]?.launch ?? launch" array="c" :controls="false" />
 *     </template>
 *   关卡自己跑的结果（docs/sim/client.ts），可以切换「直接看结果 / 逐步播放」：
 *     <RobotGrid :result="result" :launch="{ grid: 4, block: 256 }" array="c" mode="play" />
 *
 * - 两种模式：result 直接显示跑完的样子；play 从头逐步播放（播放、暂停、上一步、下一步、拖动），
 *   一步就是 08 第 4 节的一步（一个 wave 执行一行）。给了 step（沙盒的单步）就只跟着它走。
 * - 线程多了自动缩略：不超过 64 个画 ThreadBot，不超过 256 个画小号机器人（HTML），再多按 block 汇总；
 *   格子超过 64 个换成密排的小方块（02 第 5 节：一个场景的 SVG 元素不超过 2000 个）。
 * - 状态不只靠颜色：形状、记号和文字都不同，每个机器人、格子都有 aria-label，下面有一句话总结。
 * - 键盘：Tab 进到机器人（或格子、越界区）那一排，方向键移动（机器人按 ↑ ↓ 换到上一组、下一组的同一个位置），
 *   Home / End 到两头；回车或空格固定高亮，再按一次或按 Esc 取消。
 * - 固定（点一下）一个机器人时发出 select 事件，给出这个线程的 { block, thread }；取消固定、固定的是格子或组时给 null。
 *   和 MemoryView 联动：<RobotGrid … @select="(t) => (picked = t)" />、<MemoryView … :thread="picked" />。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useData } from 'vitepress'
import type { RunResult } from '@sim/lockstep.ts'
import { contentError } from './contentError.ts'
import ThreadBot from './ThreadBot.vue'
import {
  blockTiles, botLabel, botTag, cellLabel, defaultArray, describeGrid, gridAt, idleGrid, linked, outsideLabel,
  prepareGrid, threadTier, tileCounts, tileLabel, TIERS,
  type BotState, type BotView, type CellView, type GridTarget, type OutsideView, type Writer,
} from './robot-grid/model.ts'
import { describeStep, stepGroups, type Launch, type SandboxStep } from './sandbox/run.ts'

const props = withDefaults(defineProps<{
  /** 模拟器的结果：沙盒 result 插槽给的，或者关卡自己用 docs/sim/client.ts 跑的；还没运行是 null */
  result: RunResult | null
  /** 这次启动的 gridDim.x、blockDim.x（wave 大小以结果为准） */
  launch: Launch
  /** 画成显存格子的数组参数，默认是第一个被写的数组 */
  array?: string
  /** 沙盒单步走到的这一步：给了就只显示到这一步为止 */
  step?: SandboxStep | null
  /** 一开始的显示方式：result 直接看结果，play 逐步播放 */
  mode?: 'result' | 'play'
  /** 显示自己的「直接看结果 / 逐步播放」和播放控件；放进沙盒时写 false，单步交给沙盒 */
  controls?: boolean
  /** 还没运行时显存那一块的说明 */
  emptyText?: string
}>(), {
  array: '',
  step: null,
  mode: 'result',
  controls: true,
  emptyText: '还没运行。运行以后，这里显示每个线程写了哪一格。',
})

const emit = defineEmits<{
  /** 固定的线程：固定一个机器人时是它，取消固定、固定的是格子或组时是 null（MemoryView 的 thread 接它） */
  select: [thread: Writer | null]
}>()

/** 逐步播放每一步停多久（02 第 1 节因果演示 400–800 ms；每秒换不到 3 次，不算闪烁） */
const STEP_MS = 500
/** 08 第 4 节：可视化场景的线程数不超过 1024（lockstep.ts 的 RUN_LIMITS.threads；这里只用类型，不打包解释器） */
const MAX_THREADS = 1024

const { page } = useData()
const root = ref<HTMLElement | null>(null)

const data = computed(() => props.step?.result ?? props.result)

const launchOk = computed(() => {
  const l = props.launch
  return Boolean(l) && Number.isInteger(l.grid) && Number.isInteger(l.block) && l.grid >= 1 && l.block >= 1 && l.grid * l.block <= MAX_THREADS
})
// 拆成两个数再拼：父组件每次渲染传一个新的 { grid, block } 对象时，数没变就不重算、不清掉高亮
const gridDim = computed(() => (launchOk.value ? props.launch.grid : 1))
const blockDim = computed(() => (launchOk.value ? props.launch.block : 1))
const launch = computed(() => ({ grid: gridDim.value, block: blockDim.value }))
const arrayName = computed(() => props.array || defaultArray(data.value) || '')

const problem = computed(() => {
  if (!launchOk.value) {
    return contentError(`RobotGrid 的 launch 要写成 { grid, block }：都是正整数，乘起来不超过 ${MAX_THREADS}。现在是 ${JSON.stringify(props.launch)}。`, page.value.relativePath)
  }
  const r = data.value
  if (r && props.array && !Object.hasOwn(r.arrays, props.array)) {
    const names = Object.keys(r.arrays)
    return contentError(`RobotGrid 要画的数组「${props.array}」不是这次运行的数组参数（${names.length ? `有 ${names.join('、')}` : '这次没有数组参数'}）。`, page.value.relativePath)
  }
  return ''
})

const source = computed(() => {
  const r = data.value
  if (!r || problem.value || !arrayName.value || !Object.hasOwn(r.arrays, arrayName.value)) return null
  return prepareGrid(r, launch.value, arrayName.value)
})

// ── 播放 ────────────────────────────────────────────────────────────────

const groups = computed(() => (data.value ? stepGroups(data.value.events) : []))
const count = computed(() => groups.value.length)
const external = computed(() => props.step ?? null)
const ownPlayer = computed(() => props.controls && !external.value && source.value !== null)
const view = ref<'result' | 'play'>(props.mode)
const playView = computed(() => ownPlayer.value && view.value === 'play')
/** 逐步播放走完了几步：0 是还没开始 */
const position = ref(0)
const playing = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const span = computed(() => {
  const ext = external.value
  if (ext) return { upto: ext.group.to, current: ext.group }
  if (playView.value) {
    const g = position.value > 0 ? groups.value[position.value - 1] : null
    return { upto: g ? g.to : 0, current: g ?? null }
  }
  return { upto: Number.POSITIVE_INFINITY, current: null }
})

const state = computed(() => (source.value ? gridAt(source.value, span.value.upto, span.value.current) : idleGrid(launch.value)))

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

watch(() => props.mode, (m) => setView(m))
// 新的一次运行：从头放，之前固定的高亮也不再对应
watch(data, () => {
  pause()
  position.value = 0
  hover.value = null
  pinned.value = null
})

const playLabel = computed(() => (playing.value ? '暂停' : position.value >= count.value && count.value ? '重新播放' : '播放'))
const caption = computed(() => {
  const r = data.value
  if (!r || !count.value) return '这次运行没有一步可以播放。'
  if (position.value === 0) return `还没开始：一共 ${count.value} 步（一个 wave 执行一行算一步），点「播放」或「下一步」。`
  const g = groups.value[position.value - 1]
  return `第 ${position.value} / ${count.value} 步：${describeStep(g, r.events, { ...launch.value, wave: r.wave })}`
})

// ── 怎么画 ──────────────────────────────────────────────────────────────

const threads = computed(() => launch.value.grid * launch.value.block)
const tier = computed(() => threadTier(threads.value))
const tight = computed(() => launch.value.grid > TIERS.tightBlocks)
const length = computed(() => source.value?.length ?? 0)
const dense = computed(() => length.value > TIERS.cells)
const narrow = ref(false)
const columns = computed(() => (narrow.value ? 16 : 32))

const blocks = computed(() => {
  const { grid, block } = launch.value
  return Array.from({ length: grid }, (_, b) => ({ block: b, bots: state.value.bots.slice(b * block, b * block + block) }))
})
const tiles = computed(() => (tier.value === 'blocks' ? blockTiles(state.value, launch.value) : []))

const shownCells = computed(() => state.value.cells.slice(0, TIERS.maxCells))
const hiddenCells = computed(() => state.value.cells.length - shownCells.value.length)
/** 密排时每一行第一格的下标（行首标签） */
const rowStarts = computed(() => {
  const out: number[] = []
  if (dense.value) for (let k = 0; k < shownCells.value.length; k += columns.value) out.push(k)
  return out
})
const shownOutside = computed(() => state.value.outside.slice(0, TIERS.maxOutside))
const hiddenOutside = computed(() => state.value.outside.length - shownOutside.value.length)

const groupStyle = (b: number) => ({ '--blk': `var(--hg-group-${b % 6})`, '--blk-soft': `var(--hg-group-${b % 6}-soft)` })
const cellStyle = (cell: CellView) => (cell.writers.length ? groupStyle(cell.writers[0].block) : undefined)

/** ThreadBot 只有 01 第 5 节的五种状态：待命、计算中借「写入」的样子（抱着数据块），待命再变灰。 */
const LOOK: Record<BotState, 'write' | 'skip' | 'oob' | 'dup'> = {
  standby: 'write', busy: 'write', write: 'write', dup: 'dup', oob: 'oob', skip: 'skip',
}
const MINI_MARK: Partial<Record<BotState, string>> = { dup: '×2', oob: '!', skip: 'z' }

function cellGlyph(cell: CellView): string {
  if (cell.state === 'missing') return '?'
  if (cell.state === 'empty') return ''
  if (cell.atomics && !cell.stores) return `+${cell.atomics}`
  return '✓'
}

const tierNote = computed(() => {
  if (tier.value === 'blocks') return `线程多，按组汇总：一块是一组 ${launch.value.block} 个线程，色条是各种状态的人数`
  if (tier.value === 'mini') return '线程多，换成小号机器人：屏幕上的数字是 threadIdx.x'
  return '机器人屏幕上的数字是 threadIdx.x，脚下是它写的格子'
})

const summary = computed(() => describeGrid(state.value, arrayName.value, data.value?.events.length ?? 0))
/** 读屏播报：沙盒单步时由沙盒播报，自动播放时不播报，停下来以后再说 */
const announce = computed(() => {
  if (external.value || playing.value || state.value.phase === 'idle') return ''
  return playView.value ? `${caption.value}${summary.value}` : summary.value
})
const showProgress = computed(() => state.value.phase === 'running' || state.value.phase === 'stopped' || state.value.phase === 'idle')

// ── 悬停联动、固定、键盘 ─────────────────────────────────────────────────

const hover = ref<GridTarget | null>(null)
const pinned = ref<GridTarget | null>(null)
const target = computed(() => hover.value ?? pinned.value)
const lit = computed(() => linked(state.value, target.value, launch.value.block))
watch(launch, () => {
  hover.value = null
  pinned.value = null
})

const keyOf = (t: GridTarget | null) => (t ? `${t.kind}:${t.kind === 'bot' ? t.id : t.kind === 'block' ? t.block : t.index}` : '')
const pinnedKey = computed(() => keyOf(pinned.value))
/** 说明行正在讲固定住的那一个：给「取消固定」 */
const showUnpin = computed(() => pinned.value !== null && keyOf(target.value) === pinnedKey.value)
// 固定的是机器人才交出去（MemoryView 按它描出这个线程要的地址）；换了一个线程或者取消固定时发一次
watch(() => (pinned.value?.kind === 'bot' ? pinned.value.id : -1), (id) => {
  const b = launch.value.block
  emit('select', id >= 0 ? { block: Math.floor(id / b), thread: id % b } : null)
})

/** 每一排只有一个 Tab 停靠点（roving tabindex）：记住每一排上次停在哪；换了一次运行、个数变少时落在最后一个 */
const rove = reactive({ bot: 0, block: 0, cell: 0, out: 0 })
const tab = computed(() => ({
  bot: Math.min(rove.bot, threads.value - 1),
  block: Math.min(rove.block, launch.value.grid - 1),
  cell: Math.min(rove.cell, shownCells.value.length - 1),
  out: Math.min(rove.out, shownOutside.value.length - 1),
}))

function targetOf(el: EventTarget | null): GridTarget | null {
  const node = el instanceof Element ? el.closest<HTMLElement>('[data-kind]') : null
  if (!node || !root.value?.contains(node)) return null
  const k = Number(node.dataset.k)
  if (node.dataset.kind === 'bot') return { kind: 'bot', id: k }
  if (node.dataset.kind === 'block') return { kind: 'block', block: k }
  if (node.dataset.kind === 'cell') return { kind: 'cell', index: k }
  if (node.dataset.kind === 'out') return { kind: 'out', index: k }
  return null
}

function setHover(t: GridTarget | null) {
  if (keyOf(t) !== keyOf(hover.value)) hover.value = t
}

/** 指针在一排机器人、格子之间的空隙里时，保留上一个高亮：滚动时格子从指针下面划过，不会亮一下灭一下 */
const GAPS = '.hg-rgrid__blocks, .hg-rgrid__tiles, .hg-rgrid__memory'

function onOver(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return
  const t = targetOf(e.target)
  if (t || !(e.target instanceof Element) || !e.target.closest(GAPS)) setHover(t)
}
function onLeave(e: PointerEvent) {
  if (e.pointerType === 'mouse') setHover(null)
}
/** 只有键盘移过来的焦点（:focus-visible）才当作「指到」；手指点、鼠标点的焦点不算，免得点第二下取消固定以后还亮着 */
function onFocusIn(e: FocusEvent) {
  const t = targetOf(e.target)
  if (!t) return
  if (t.kind === 'bot') rove.bot = t.id
  else if (t.kind === 'block') rove.block = t.block
  else if (t.kind === 'cell') rove.cell = t.index
  else rove.out = Math.max(0, shownOutside.value.findIndex((o) => o.index === t.index))
  if (e.target instanceof Element && e.target.matches(':focus-visible')) setHover(t)
}
function onFocusOut(e: FocusEvent) {
  if (!targetOf(e.relatedTarget)) setHover(null)
}
function onClick(e: MouseEvent) {
  const t = targetOf(e.target)
  if (t) pinned.value = pinnedKey.value === keyOf(t) ? null : t
}

function focusItem(kind: GridTarget['kind'], k: number) {
  root.value?.querySelector<HTMLElement>(`[data-kind="${kind}"][data-k="${k}"]`)?.focus()
}

function onKey(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey) return
  if (e.key === 'Escape') {
    if (pinned.value || hover.value) {
      pinned.value = null
      e.preventDefault()
    }
    return
  }
  const t = targetOf(e.target)
  if (!t) return
  const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
  const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const pick = (k: number, last: number, stride: number) => {
    if (e.key === 'Home') return 0
    if (e.key === 'End') return last
    const next = k + (back ? -stride : stride)
    return next < 0 || next > last ? k : next
  }
  if (t.kind === 'bot') focusItem('bot', pick(t.id, threads.value - 1, vertical ? launch.value.block : 1))
  else if (t.kind === 'block') focusItem('block', pick(t.block, launch.value.grid - 1, 1))
  else if (t.kind === 'cell') focusItem('cell', pick(t.index, shownCells.value.length - 1, vertical && dense.value ? columns.value : 1))
  else {
    const list = shownOutside.value
    const k = list.findIndex((o) => o.index === t.index)
    const next = list[pick(k, list.length - 1, 1)]
    if (next) focusItem('out', next.index)
  }
}

const info = computed(() => {
  const t = target.value
  const s = state.value
  if (!t) return ''
  if (t.kind === 'bot') return s.bots[t.id] ? botLabel(s.bots[t.id], arrayName.value, s.cells) : ''
  if (t.kind === 'cell') return s.cells[t.index] ? cellLabel(s.cells[t.index], arrayName.value) : ''
  if (t.kind === 'out') {
    const o = s.outside.find((x) => x.index === t.index)
    return o ? outsideLabel(o, arrayName.value) : ''
  }
  const tile = blockTiles(s, launch.value)[t.block]
  return tile ? tileLabel(tile) : ''
})

/**
 * 每个机器人、格子只在自己的数据、亮不亮、能不能 Tab 到、固定没有变了的时候才重画（模板里的 v-memo）：
 * 指针划过 1000 个格子时只改动前后两个，不把整张网格重画一遍。没亮的那些变淡由根元素上的 has-target 统一管。
 */
function botClass(bot: BotView) {
  return [`is-${bot.state}`, { 'is-active': bot.active, 'is-lit': lit.value.bots.has(bot.id) }]
}
function cellClass(cell: CellView) {
  return [`is-${cell.state}`, { 'is-active': cell.active, 'is-lit': lit.value.cells.has(cell.index) }]
}
function outClass(o: OutsideView) {
  return { 'is-active': o.active, 'is-lit': lit.value.outside.has(o.index) }
}
/** 一组机器人的 v-memo：组里哪些亮着、Tab 停在哪、固定的是谁，有一样变了这一组才重画 */
function blockSig(block: number): string {
  const lo = block * launch.value.block
  const hi = lo + launch.value.block
  const inside = (id: number) => id >= lo && id < hi
  const litHere = [...lit.value.bots].filter(inside).join(',')
  const pin = pinned.value?.kind === 'bot' && inside(pinned.value.id) ? pinned.value.id : -1
  return `${litHere}|${inside(tab.value.bot) ? tab.value.bot : -1}|${pin}`
}

// ── 挂载 ────────────────────────────────────────────────────────────────

let media: MediaQueryList | null = null
let observer: IntersectionObserver | null = null
const onMedia = () => {
  narrow.value = Boolean(media?.matches)
}
const onVisibility = () => {
  if (document.hidden) pause()
}

onMounted(() => {
  media = window.matchMedia('(max-width: 767px)')
  media.addEventListener('change', onMedia)
  onMedia()
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
  media?.removeEventListener('change', onMedia)
  document.removeEventListener('visibilitychange', onVisibility)
  observer?.disconnect()
})
</script>

<template>
  <div
    ref="root"
    class="hg-rgrid"
    :class="{ 'has-target': target !== null }"
    role="group"
    :aria-label="`线程机器人网格：派出 ${threads} 个线程${arrayName ? `，显存里的数组 ${arrayName}` : ''}`"
    @pointerover="onOver"
    @pointerleave="onLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @click="onClick"
    @keydown="onKey"
  >
    <p v-if="problem" class="hg-rgrid__problem" role="alert" data-hg-content-error>{{ problem }}</p>

    <div v-if="ownPlayer" class="hg-rgrid__toolbar">
      <div class="hg-rgrid__modes" role="group" aria-label="显示方式">
        <button type="button" class="hg-rgrid__mode" :aria-pressed="view === 'result'" @click="setView('result')">直接看结果</button>
        <button type="button" class="hg-rgrid__mode" :aria-pressed="view === 'play'" @click="setView('play')">逐步播放</button>
      </div>
      <template v-if="playView">
        <div class="hg-rgrid__transport" role="group" aria-label="逐步播放">
          <button type="button" class="hg-rgrid__button" :disabled="position === 0" @click="go(0)">从头</button>
          <button type="button" class="hg-rgrid__button" :disabled="position === 0" @click="go(position - 1)">上一步</button>
          <button type="button" class="hg-rgrid__button is-primary" :disabled="!count" @click="playing ? pause() : play()">{{ playLabel }}</button>
          <button type="button" class="hg-rgrid__button" :disabled="position >= count" @click="go(position + 1)">下一步</button>
          <button type="button" class="hg-rgrid__button" :disabled="position >= count" @click="go(count)">跳到最后</button>
        </div>
        <input
          class="hg-rgrid__range"
          type="range"
          min="0"
          :max="count"
          step="1"
          :value="position"
          aria-label="拖动到第几步"
          :aria-valuetext="position ? `第 ${position} / ${count} 步` : '还没开始'"
          @input="go(Number(($event.target as HTMLInputElement).value))"
        >
        <p class="hg-rgrid__caption">{{ caption }}</p>
        <p class="hg-rgrid__speed">播放速度不代表 GPU 耗时。</p>
      </template>
    </div>

    <div class="hg-rgrid__head">
      <span class="hg-rgrid__label">派出的线程</span>
      <span class="hg-rgrid__meta">{{ launch.grid }} 组 × 每组 {{ launch.block }} 个 = {{ threads }} 个</span>
      <span class="hg-rgrid__note">{{ tierNote }}</span>
    </div>

    <div v-if="tier === 'blocks'" class="hg-rgrid__tiles" :class="{ 'is-tight': tight }" role="group" :aria-label="`${launch.grid} 组线程，按组汇总`">
      <button
        v-for="tile in tiles"
        :key="tile.block"
        v-memo="[tile, tight, lit.blocks.has(tile.block), tab.block === tile.block, pinnedKey === `block:${tile.block}`]"
        type="button"
        class="hg-rgrid__tile"
        :class="{ 'is-active': tile.active, 'is-lit': lit.blocks.has(tile.block) }"
        :style="groupStyle(tile.block)"
        data-kind="block"
        :data-k="tile.block"
        :tabindex="tab.block === tile.block ? 0 : -1"
        :aria-label="tileLabel(tile)"
        :aria-pressed="pinnedKey === `block:${tile.block}`"
      >
        <span class="hg-rgrid__tile-name"><span class="hg-rgrid__dot" />{{ tight ? tile.block : `第 ${tile.block} 组` }}</span>
        <span class="hg-rgrid__bar" aria-hidden="true">
          <span v-for="c in tileCounts(tile)" :key="c.state" :class="`is-${c.state}`" :style="{ flexGrow: c.count }" />
        </span>
        <span v-if="!tight" class="hg-rgrid__tile-text" aria-hidden="true">{{ tileCounts(tile).map((c) => `${c.name} ${c.count}`).join(' · ') }}</span>
      </button>
    </div>

    <div v-else class="hg-rgrid__blocks">
      <section
        v-for="b in blocks"
        :key="b.block"
        v-memo="[b.bots, tier, state.current?.block === b.block, blockSig(b.block)]"
        class="hg-rgrid__block"
        :class="{ 'is-active': state.current?.block === b.block }"
        :style="groupStyle(b.block)"
        :aria-label="`第 ${b.block} 组（blockIdx.x = ${b.block}），${b.bots.length} 个线程`"
      >
        <h4 class="hg-rgrid__block-name"><span class="hg-rgrid__dot" />第 {{ b.block }} 组 <code>blockIdx.x = {{ b.block }}</code></h4>
        <ul class="hg-rgrid__bots" :class="`is-${tier}`">
          <li v-for="bot in b.bots" :key="bot.id">
            <button
              v-if="tier === 'bots'"
              type="button"
              class="hg-rgrid__bot"
              :class="botClass(bot)"
              data-kind="bot"
              :data-k="bot.id"
              :tabindex="tab.bot === bot.id ? 0 : -1"
              :aria-label="botLabel(bot, arrayName, state.cells)"
              :aria-pressed="pinnedKey === `bot:${bot.id}`"
            >
              <ThreadBot :state="LOOK[bot.state]" :color="bot.block" :label="bot.thread" :size="44" aria-hidden="true" />
              <span class="hg-rgrid__tag">{{ botTag(bot, arrayName, state.cells) }}</span>
            </button>
            <button
              v-else
              type="button"
              class="hg-rgrid__mini"
              :class="botClass(bot)"
              data-kind="bot"
              :data-k="bot.id"
              :tabindex="tab.bot === bot.id ? 0 : -1"
              :aria-label="botLabel(bot, arrayName, state.cells)"
              :aria-pressed="pinnedKey === `bot:${bot.id}`"
            >
              <span class="hg-rgrid__screen">{{ bot.thread }}</span>
              <span v-if="MINI_MARK[bot.state]" class="hg-rgrid__mark" aria-hidden="true">{{ MINI_MARK[bot.state] }}</span>
            </button>
          </li>
        </ul>
      </section>
    </div>

    <div class="hg-rgrid__head">
      <span class="hg-rgrid__label">显存里的 {{ arrayName || '数组' }}</span>
      <span v-if="source" class="hg-rgrid__meta">{{ arrayName }}[0…{{ length - 1 }}]，{{ length }} 格</span>
      <span v-if="dense" class="hg-rgrid__note">格子多，换成小方块：每行 {{ columns }} 格，行首是这一行第一格的下标</span>
    </div>

    <p v-if="!source" class="hg-rgrid__empty">{{ emptyText }}</p>

    <div v-else class="hg-rgrid__memory">
      <ol v-if="!dense" class="hg-rgrid__cells" :aria-label="`数组 ${arrayName} 的 ${length} 个格子`">
        <li v-for="cell in shownCells" :key="cell.index" v-memo="[cell, lit.cells.has(cell.index), tab.cell === cell.index, pinnedKey === `cell:${cell.index}`]">
          <button
            type="button"
            class="hg-rgrid__cell"
            :class="cellClass(cell)"
            :style="cellStyle(cell)"
            data-kind="cell"
            :data-k="cell.index"
            :tabindex="tab.cell === cell.index ? 0 : -1"
            :aria-label="cellLabel(cell, arrayName)"
            :aria-pressed="pinnedKey === `cell:${cell.index}`"
          >
            <span class="hg-rgrid__addr">{{ arrayName }}[{{ cell.index }}]</span>
            <span class="hg-rgrid__glyph" aria-hidden="true">{{ cellGlyph(cell) }}</span>
            <span v-if="cell.state === 'dup'" class="hg-rgrid__badge" aria-hidden="true">×{{ cell.stores }}</span>
          </button>
        </li>
      </ol>

      <div v-else class="hg-rgrid__dense" role="group" :aria-label="`数组 ${arrayName} 的 ${length} 个格子`" :style="{ '--cols': columns }">
        <!-- 行首的下标钉在第一列，格子自动排进后面的列；两个 v-for 都是一层，格子的 v-memo 才生效 -->
        <span v-for="start in rowStarts" :key="`row-${start}`" class="hg-rgrid__row" :style="{ gridRow: start / columns + 1 }" aria-hidden="true">{{ start }}</span>
        <button
          v-for="cell in shownCells"
          :key="cell.index"
          v-memo="[cell, lit.cells.has(cell.index), tab.cell === cell.index, pinnedKey === `cell:${cell.index}`]"
          type="button"
          class="hg-rgrid__speck"
          :class="cellClass(cell)"
          :style="cellStyle(cell)"
          data-kind="cell"
          :data-k="cell.index"
          :tabindex="tab.cell === cell.index ? 0 : -1"
          :aria-label="cellLabel(cell, arrayName)"
          :aria-pressed="pinnedKey === `cell:${cell.index}`"
        />
      </div>
      <p v-if="hiddenCells" class="hg-rgrid__more">后面还有 {{ hiddenCells }} 格没有画出来（总结里的数照样算上了）。</p>

      <div v-if="state.outside.length" class="hg-rgrid__outside" role="group" :aria-label="`数组外面（越界区）：${state.outside.length} 个位置被写到`">
        <p class="hg-rgrid__out-label" aria-hidden="true">数组外面 · 越界</p>
        <ol class="hg-rgrid__cells">
          <li v-for="(o, k) in shownOutside" :key="o.index" v-memo="[o, lit.outside.has(o.index), tab.out === k, pinnedKey === `out:${o.index}`]">
            <button
              type="button"
              class="hg-rgrid__cell is-oob"
              :class="outClass(o)"
              data-kind="out"
              :data-k="o.index"
              :tabindex="tab.out === k ? 0 : -1"
              :aria-label="outsideLabel(o, arrayName)"
              :aria-pressed="pinnedKey === `out:${o.index}`"
            >
              <span class="hg-rgrid__addr">{{ arrayName }}[{{ o.index }}]</span>
              <span class="hg-rgrid__glyph" aria-hidden="true">!</span>
              <span v-if="o.writers.length > 1" class="hg-rgrid__badge" aria-hidden="true">×{{ o.writers.length }}</span>
            </button>
          </li>
        </ol>
        <p v-if="hiddenOutside" class="hg-rgrid__more">还有 {{ hiddenOutside }} 个位置没有画出来。</p>
      </div>
    </div>

    <p v-if="state.phase !== 'idle'" class="hg-rgrid__info" :class="{ 'is-on': target }">
      <template v-if="target">
        <span>{{ info }}</span>
        <button v-if="showUnpin" type="button" class="hg-rgrid__link" @click.stop="pinned = null">取消固定</button>
      </template>
      <template v-else>指到机器人或格子上（手机上点一下），另一边对应的会亮起来；点一下可以固定。</template>
    </p>

    <p v-if="summary" class="hg-rgrid__summary">{{ summary }}</p>
    <p class="hg-rgrid__sr" aria-live="polite">{{ announce }}</p>

    <ul class="hg-rgrid__legend" aria-label="图例">
      <li><span class="hg-rgrid__sw is-write" aria-hidden="true">✓</span>写入</li>
      <li><span class="hg-rgrid__sw is-oob" aria-hidden="true">!</span>越界写</li>
      <li><span class="hg-rgrid__sw is-skip" aria-hidden="true">z</span>检查后跳过</li>
      <li><span class="hg-rgrid__sw is-missing" aria-hidden="true">?</span>没人算</li>
      <li><span class="hg-rgrid__sw is-dup" aria-hidden="true">×2</span>重复计算</li>
      <li v-if="showProgress"><span class="hg-rgrid__sw is-standby" aria-hidden="true" />待命 / 计算中</li>
    </ul>
  </div>
</template>

<style scoped>
.hg-rgrid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: 14px;
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.hg-rgrid__problem {
  margin: 0;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

/* ── 模式切换和播放 ── */

.hg-rgrid__toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
}

.hg-rgrid__modes {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 3px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  box-shadow: inset 0 0 0 1px var(--hg-border);
}

.hg-rgrid__mode {
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

.hg-rgrid__mode[aria-pressed='true'] {
  background: var(--hg-surface);
  color: var(--hg-ink);
  box-shadow: var(--hg-shadow);
}

.hg-rgrid__transport {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hg-rgrid__button {
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
.hg-rgrid__button.is-primary {
  min-width: 6.5em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-rgrid__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.hg-rgrid__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-rgrid__range {
  width: 100%;
  margin: 0;
  accent-color: var(--hg-accent);
}

.hg-rgrid__caption {
  margin: 0;
  color: var(--hg-ink);
  font-size: 14px;
  line-height: 1.6;
}

.hg-rgrid__speed {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 12px;
}

/* ── 标题行 ── */

.hg-rgrid__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
}

.hg-rgrid__label {
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 700;
}

.hg-rgrid__meta {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-rgrid__note {
  color: var(--hg-ink-3);
  font-size: 12px;
}

/* ── 线程：按组排开 ── */

.hg-rgrid__blocks,
.hg-rgrid__tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hg-rgrid__block {
  min-width: 0;
  max-width: 100%;
  padding: 8px 10px 6px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  transition: border-color var(--motion-base) var(--motion-ease-out);
}

.hg-rgrid__block.is-active {
  border-color: var(--hg-accent);
}

.hg-rgrid__block-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 4px;
  padding: 0;
  border: 0;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-body);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.5;
}

.hg-rgrid__block-name code {
  padding: 0;
  background: none;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 500;
}

.hg-rgrid__dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--blk);
}

.hg-rgrid__bots {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-rgrid__bots.is-mini {
  gap: 6px 4px;
  padding: 4px 2px 2px;
}

.hg-rgrid__bots li {
  margin: 0;
}

/* 一个线程：ThreadBot + 脚下写它写了哪一格 */
.hg-rgrid__bot {
  --lift: 0px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  /* 至少一个机器人宽；脚下的字（c[12] ×2、c[15] !）长了就跟着变宽，不截断 */
  min-width: 52px;
  padding: 6px 3px 4px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transform: translateY(var(--lift));
  transition:
    transform var(--motion-fast) var(--motion-ease-out),
    opacity var(--motion-base) var(--motion-ease-out),
    background-color var(--motion-base) var(--motion-ease-out);
}

.hg-rgrid__bot :deep(svg) {
  transition: opacity var(--motion-base) var(--motion-ease-out), filter var(--motion-base) var(--motion-ease-out);
}

.hg-rgrid__tag {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.3;
  white-space: nowrap;
}

.hg-rgrid__bot.is-oob .hg-rgrid__tag {
  color: var(--hg-error-ink);
}

.hg-rgrid__bot.is-dup .hg-rgrid__tag {
  color: var(--hg-amber-ink);
}

.hg-rgrid__bot.is-skip .hg-rgrid__tag,
.hg-rgrid__bot.is-standby .hg-rgrid__tag,
.hg-rgrid__bot.is-busy .hg-rgrid__tag {
  color: var(--hg-ink-3);
  font-weight: 500;
}

/* 还没轮到：变灰变淡（文字「待命」） */
.hg-rgrid__bot.is-standby :deep(svg) {
  opacity: 0.4;
  filter: grayscale(1);
}

/* 小号机器人：机器人的脸（深色屏幕 + 线程号）和底部的组色条，用 HTML 画，不占 SVG 元素 */
.hg-rgrid__mini {
  --lift: 0px;
  --tilt: 0deg;
  position: relative;
  display: grid;
  place-items: start center;
  width: 28px;
  height: 32px;
  padding: 3px 0 0;
  border: 1.6px solid var(--hg-art-line);
  border-radius: 8px;
  background:
    linear-gradient(var(--hg-art-line), var(--hg-art-line)) bottom 6px left 0 / 100% 1.6px no-repeat,
    linear-gradient(var(--blk), var(--blk)) bottom / 100% 6px no-repeat,
    var(--hg-art-white);
  color: inherit;
  font: inherit;
  cursor: pointer;
  transform: translateY(var(--lift)) rotate(var(--tilt));
  transition:
    transform var(--motion-fast) var(--motion-ease-out),
    opacity var(--motion-base) var(--motion-ease-out);
}

.hg-rgrid__screen {
  display: grid;
  place-items: center;
  width: 20px;
  height: 14px;
  border-radius: 4px;
  background: var(--hg-art-screen);
  color: var(--hg-art-led);
  font-family: var(--hg-font-mono);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  transition: background-color var(--motion-base) var(--motion-ease-out), color var(--motion-base) var(--motion-ease-out);
}

.hg-rgrid__mark {
  position: absolute;
  top: -7px;
  right: -8px;
  min-width: 13px;
  padding: 0 3px;
  border-radius: var(--hg-radius-pill);
  font-family: var(--hg-font-mono);
  font-size: 9px;
  font-weight: 700;
  line-height: 13px;
  text-align: center;
}

.hg-rgrid__mini.is-oob {
  --tilt: 12deg;
}

.hg-rgrid__mini.is-oob .hg-rgrid__screen {
  background: var(--hg-art-screen-alert);
  color: var(--hg-art-led-alert);
}

.hg-rgrid__mini.is-oob .hg-rgrid__mark {
  background: var(--hg-art-alert);
  color: var(--hg-art-white);
}

.hg-rgrid__mini.is-dup .hg-rgrid__mark {
  background: var(--hg-art-amber);
  color: var(--hg-art-line);
}

.hg-rgrid__mini.is-skip {
  background:
    linear-gradient(var(--hg-art-line), var(--hg-art-line)) bottom 6px left 0 / 100% 1.6px no-repeat,
    linear-gradient(var(--hg-art-skip-stripe), var(--hg-art-skip-stripe)) bottom / 100% 6px no-repeat,
    var(--hg-art-white);
}

.hg-rgrid__mini.is-skip .hg-rgrid__screen {
  background: var(--hg-art-screen-top);
  color: var(--hg-art-led-off);
}

.hg-rgrid__mini.is-skip .hg-rgrid__mark {
  top: -9px;
  right: -6px;
  color: var(--hg-art-zzz);
  font-size: 11px;
}

.hg-rgrid__mini.is-standby {
  opacity: 0.4;
  filter: grayscale(1);
}

/* 当前这一步在做事的线程：头顶一个「▶」，整个抬起一点 */
.hg-rgrid__bot.is-active,
.hg-rgrid__mini.is-active {
  --lift: -3px;
}

.hg-rgrid__bot.is-active {
  background: var(--hg-accent-soft);
}

.hg-rgrid__bot.is-active::before,
.hg-rgrid__mini.is-active::before {
  content: '▶';
  position: absolute;
  color: var(--hg-accent-ink);
  font-size: 9px;
  line-height: 1;
  transform: rotate(90deg);
}

.hg-rgrid__bot {
  position: relative;
}

.hg-rgrid__bot.is-active::before {
  top: -2px;
}

.hg-rgrid__mini.is-active::before {
  top: -12px;
  left: 9px;
}

/* 按组汇总的块 */
.hg-rgrid__tile {
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 手机上一行能放两块 */
  flex: 0 1 168px;
  min-width: 132px;
  padding: 8px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--motion-base) var(--motion-ease-out),
    opacity var(--motion-base) var(--motion-ease-out),
    transform var(--motion-fast) var(--motion-ease-out);
}

.hg-rgrid__tile.is-active {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

.hg-rgrid__tile-name {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.hg-rgrid__tile-text {
  color: var(--hg-ink-2);
  font-size: 12px;
  line-height: 1.5;
}

.hg-rgrid__tiles.is-tight {
  gap: 6px;
}

.hg-rgrid__tiles.is-tight .hg-rgrid__tile {
  flex: 0 0 52px;
  min-width: 0;
  padding: 5px 6px;
  gap: 4px;
}

.hg-rgrid__tiles.is-tight .hg-rgrid__tile-name {
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

/* 色条：各种状态的人数。文字（或读屏的 aria-label）给出确切人数，不只靠颜色 */
.hg-rgrid__bar {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-border);
}

.hg-rgrid__bar > span {
  flex-basis: 0;
  min-width: 2px;
}

.hg-rgrid__bar .is-write {
  background: var(--blk);
}

.hg-rgrid__bar .is-dup {
  background: var(--hg-amber);
}

.hg-rgrid__bar .is-oob {
  background: repeating-linear-gradient(45deg, var(--hg-error) 0 3px, var(--hg-error-soft) 3px 6px);
}

.hg-rgrid__bar .is-skip {
  background: var(--hg-idle);
}

.hg-rgrid__bar .is-busy {
  background: var(--hg-ink-3);
}

.hg-rgrid__bar .is-standby {
  background: transparent;
}

/* ── 显存格子 ── */

.hg-rgrid__memory {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 12px;
}

.hg-rgrid__cells {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-rgrid__cells li {
  margin: 0;
}

.hg-rgrid__cell {
  --lift: 0px;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 46px;
  height: 44px;
  padding: 0;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  cursor: pointer;
  transform: translateY(var(--lift));
  transition:
    background-color var(--motion-base) var(--motion-ease-out),
    border-color var(--motion-base) var(--motion-ease-out),
    opacity var(--motion-base) var(--motion-ease-out),
    transform var(--motion-fast) var(--motion-ease-out);
}

.hg-rgrid__addr {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 10px;
  line-height: 1.2;
}

.hg-rgrid__glyph {
  min-height: 1.2em;
  font-family: var(--hg-font-mono);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
}

.hg-rgrid__cell.is-write,
.hg-rgrid__cell.is-dup {
  border-color: var(--blk);
  background: var(--blk-soft);
}

.hg-rgrid__cell.is-write .hg-rgrid__glyph {
  color: var(--hg-accent-ink);
}

.hg-rgrid__cell.is-missing {
  border-style: dashed;
  border-color: var(--hg-error);
}

.hg-rgrid__cell.is-missing .hg-rgrid__glyph {
  color: var(--hg-error-ink);
}

.hg-rgrid__cell.is-dup .hg-rgrid__glyph {
  color: var(--hg-amber-ink);
}

.hg-rgrid__badge {
  position: absolute;
  top: -8px;
  right: -8px;
  padding: 0 5px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-art-amber);
  color: var(--hg-art-line);
  font-family: var(--hg-font-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
}

/* 这一步刚写到的格子：描一圈强调色 */
.hg-rgrid__cell.is-active,
.hg-rgrid__speck.is-active {
  box-shadow: 0 0 0 2px var(--hg-accent);
}

/* 密排的小方块：只靠形状 + 颜色 + 读屏文字；写入实心、没人算空心红虚线、重复琥珀斜纹 */
.hg-rgrid__dense {
  display: grid;
  flex: 1 1 100%;
  /* 桌面上不铺满整行：1000 格时每格十几像素，整块不至于太高 */
  max-width: 640px;
  grid-template-columns: max-content repeat(var(--cols), minmax(0, 1fr));
  gap: 3px;
  align-items: center;
}

.hg-rgrid__row {
  grid-column: 1;
  padding-right: 6px;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 10px;
  text-align: right;
}

.hg-rgrid__speck {
  --lift: 0px;
  aspect-ratio: 1;
  min-width: 0;
  padding: 0;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 2px;
  background: transparent;
  cursor: pointer;
  transform: translateY(var(--lift));
  /* 只过渡填色：上千个小方块一起做透明度过渡，每一帧都要在主线程重算样式 */
  transition: background-color var(--motion-base) var(--motion-ease-out);
}

.hg-rgrid__speck.is-write {
  border-color: var(--blk);
  background: var(--blk);
}

.hg-rgrid__speck.is-dup {
  border-color: var(--hg-amber);
  background: repeating-linear-gradient(45deg, var(--hg-amber) 0 2px, var(--hg-surface) 2px 4px);
}

.hg-rgrid__speck.is-missing {
  border: 1.5px dashed var(--hg-error);
}

.hg-rgrid__more {
  flex: 1 1 100%;
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 12px;
}

/* 越界区：红色虚线框 + 斜纹底（01 第 6 节） */
.hg-rgrid__outside {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;
  padding: 8px 10px 10px;
  border: 1.5px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: repeating-linear-gradient(45deg, var(--hg-error-soft) 0 8px, transparent 8px 16px);
}

.hg-rgrid__out-label {
  margin: 0;
  color: var(--hg-error-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 700;
}

.hg-rgrid__cell.is-oob {
  border-color: var(--hg-error);
  background: var(--hg-surface);
}

.hg-rgrid__cell.is-oob .hg-rgrid__addr,
.hg-rgrid__cell.is-oob .hg-rgrid__glyph {
  color: var(--hg-error-ink);
}

/* ── 悬停联动：对应的一边抬起来、描边，其余变淡 ── */

.hg-rgrid__bot.is-lit,
.hg-rgrid__mini.is-lit,
.hg-rgrid__cell.is-lit,
.hg-rgrid__speck.is-lit,
.hg-rgrid__tile.is-lit {
  --lift: -2px;
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

/*
 * 指到一个东西时（根元素 has-target），没亮的都变淡：只改根元素一个 class，不用逐个改。
 * 密排的小方块不变淡（上千个一起变要卡一下），亮着的照样描边、抬起来。
 */
.hg-rgrid.has-target .hg-rgrid__bot:not(.is-lit),
.hg-rgrid.has-target .hg-rgrid__mini:not(.is-lit),
.hg-rgrid.has-target .hg-rgrid__cell:not(.is-lit),
.hg-rgrid.has-target .hg-rgrid__tile:not(.is-lit) {
  opacity: 0.45;
}

.hg-rgrid__bot:focus-visible,
.hg-rgrid__mini:focus-visible,
.hg-rgrid__cell:focus-visible,
.hg-rgrid__speck:focus-visible,
.hg-rgrid__tile:focus-visible,
.hg-rgrid__mode:focus-visible,
.hg-rgrid__button:focus-visible,
.hg-rgrid__link:focus-visible,
.hg-rgrid__range:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* 越界：出现时闪一下引起注意（02 第 1 节：150–250 ms，最多 2 次） */
.hg-rgrid__bot.is-oob,
.hg-rgrid__cell.is-oob {
  animation: hg-rgrid-flash 240ms var(--motion-ease-out) 2;
}

@keyframes hg-rgrid-flash {
  50% {
    transform: translateY(var(--lift)) scale(1.08);
  }
}

/* ── 文字 ── */

.hg-rgrid__empty,
.hg-rgrid__info,
.hg-rgrid__summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}

.hg-rgrid__empty {
  padding: 12px 14px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  color: var(--hg-ink-3);
}

.hg-rgrid__info {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  min-height: 1.6em;
  color: var(--hg-ink-3);
}

.hg-rgrid__info.is-on {
  color: var(--hg-ink);
}

.hg-rgrid__link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--hg-accent-ink);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.hg-rgrid__summary {
  color: var(--hg-ink);
  font-weight: 600;
}

.hg-rgrid__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* 图例：每种状态都有记号，不只靠颜色（01 第 7 节） */
.hg-rgrid__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.hg-rgrid__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

.hg-rgrid__sw {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 16px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 4px;
  font-family: var(--hg-font-mono);
  font-size: 9px;
  font-weight: 700;
}

.hg-rgrid__sw.is-write {
  border-color: var(--hg-group-0);
  background: var(--hg-group-0-soft);
  color: var(--hg-accent-ink);
}

.hg-rgrid__sw.is-oob {
  border-color: var(--hg-error);
  background: repeating-linear-gradient(45deg, var(--hg-error-soft) 0 3px, transparent 3px 6px);
  color: var(--hg-error-ink);
}

.hg-rgrid__sw.is-skip {
  border-style: dashed;
  border-color: var(--hg-idle);
  color: var(--hg-ink-3);
}

.hg-rgrid__sw.is-missing {
  border-style: dashed;
  border-color: var(--hg-error);
  color: var(--hg-error-ink);
}

.hg-rgrid__sw.is-dup {
  border-color: var(--hg-amber);
  color: var(--hg-amber-ink);
}

.hg-rgrid__sw.is-standby {
  border-color: var(--hg-border);
  background: var(--hg-surface-2);
  opacity: 0.6;
}

@media (max-width: 767px) {
  .hg-rgrid {
    padding: 12px;
  }

  .hg-rgrid__bot {
    min-width: 46px;
  }

  .hg-rgrid__bot :deep(svg) {
    width: 40px;
    height: auto;
  }

  .hg-rgrid__cell {
    width: 42px;
  }
}

/*
 * 减弱动效（02 第 4 节）：时长 token 已经归零，位移变成直接切换；
 * 自定义 @keyframes 不受时长 token 影响，系统设置和站点设置（data-hg-motion）都要关掉。
 */
@media (prefers-reduced-motion: reduce) {
  .hg-rgrid__bot.is-oob,
  .hg-rgrid__cell.is-oob {
    animation: none;
  }
}

[data-hg-motion='reduce'] .hg-rgrid__bot.is-oob,
[data-hg-motion='reduce'] .hg-rgrid__cell.is-oob {
  animation: none;
}
</style>
