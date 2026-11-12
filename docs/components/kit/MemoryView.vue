<script setup lang="ts">
/**
 * 访存视图（S-08；03 第 3 节，08 第 2、5 节，01 第 2、6、7 节）。
 *
 * 一个 wave 的一次读写显存：每个 lane 要哪个地址，这些地址落在哪几车（cache line），这次搬了几车、理想几车。
 * 显存按车分段画：碰到的每一车画成一节车厢，这次要的格子涂色、写着要它的线程（threadIdx.x），
 * 跟着整车搬来却没人要的格子留白，不是这个数组的地方画斜纹；没碰到的车折成一行，写明有几车没搬。
 * 车次全部来自 L3 的 analyzeMemory（memory-view/model.ts），都是模拟值。
 *
 * 用法（全局注册，Markdown 里直接写）：
 *   放在 Sandbox 里，单步交给沙盒：
 *     <template #result="{ result, step, runs }">
 *       <MemoryView :result="result" :step="step" :launch="runs[0]?.launch ?? launch" :controls="false" />
 *     </template>
 *   关卡自己跑的结果（docs/sim/client.ts），和 RobotGrid 联动：
 *     <RobotGrid :result="result" :launch="launch" array="y" @select="(t) => (picked = t)" />
 *     <MemoryView :result="result" :launch="launch" :thread="picked" />
 *
 * - 一次一次看：第一次、上一次、下一次、最后一次（按事件的先后），拖动进度条；焦点在视图上时 ← → Home End 也能换。
 *   给了 step（沙盒的单步）就只跟着它走，显示这一步的每一次访存（c[i] = a[i] + b[i] 一步有三次）。
 * - 元素大小（4 B / 2 B）、一车多大（32 / 64 / 128 B）是示意值，上面两个开关可以换，换了不用重跑。
 *   要从外面控制就写 v-model:elem-bytes、v-model:line-bytes；不想让读者换就写 :knobs="false"。
 * - thread（RobotGrid 的 select 事件给的线程）：描出它这一次要的格子，下面列出它读写过的全部地址；
 *   它不在这一次里时，翻到它第一次读写显存的那一次（跟着沙盒单步时不翻）。
 * - 状态不只靠颜色：要的格子写着线程号，没人要的留白，不是这个数组的地方斜纹，越界的红色虚线框加「!」，选中的线程描一圈。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'
import type { RunResult } from '@sim/lockstep.ts'
import { SIM_PARAMS } from '@sim/params.ts'
import { contentError } from './contentError.ts'
import Knob from './Knob.vue'
import {
  accessesInStep, accessesUpTo, accessTitle, addrText, carLabel, carsText, cellRuns, describeMemory, efficiency,
  ELEM_OPTIONS, gapLabel, laneFor, layoutAccess, LINE_OPTIONS, memoryUsage, OP_NAME, pickedText, prepareMemory,
  quietStep, threadVisits,
  type CarView, type CellState, type MemAccess, type ThreadRef, type UsageRow,
} from './memory-view/model.ts'
import type { Launch, SandboxStep } from './sandbox/run.ts'
import { percent } from './wave-view/model.ts'

const props = withDefaults(defineProps<{
  /** 模拟器的结果：沙盒 result 插槽给的，或者关卡自己用 docs/sim/client.ts 跑的；还没运行是 null */
  result: RunResult | null
  /** 这次启动的 gridDim.x、blockDim.x（wave 大小以结果为准） */
  launch: Launch
  /** 只看这个数组参数的访存；不写就是全部显存数组 */
  array?: string
  /** 沙盒单步走到的这一步：给了就只显示这一步的访存 */
  step?: SandboxStep | null
  /** 显示自己的「上一次 / 下一次」；放进沙盒时写 false，单步交给沙盒 */
  controls?: boolean
  /** 显示元素大小、一车多大两个开关 */
  knobs?: boolean
  /** 一个元素几个字节（示意），可以 v-model */
  elemBytes?: number
  /** 一车几个字节（示意），可以 v-model */
  lineBytes?: number
  /** 选中的线程（RobotGrid 的 select 事件给的）：描出它要的地址 */
  thread?: ThreadRef | null
  /** 还没运行时的说明 */
  emptyText?: string
}>(), {
  array: '',
  step: null,
  controls: true,
  knobs: true,
  elemBytes: SIM_PARAMS.elemBytes,
  lineBytes: SIM_PARAMS.lineBytes,
  thread: null,
  emptyText: '还没运行。运行以后，这里显示一个 wave 每次读写显存要哪些地址，要搬几车。',
})

const emit = defineEmits<{
  'update:elemBytes': [value: number]
  'update:lineBytes': [value: number]
}>()

/** 08 第 4 节：可视化场景的线程数不超过 1024（lockstep.ts 的 RUN_LIMITS.threads；这里只用类型，不打包解释器） */
const MAX_THREADS = 1024
/** 一格一格画时一行几格：按视图的宽度（手机、窄的插槽里少一些），格子才写得下线程号 */
const COLUMN_TIERS = [{ minWidth: 520, cols: 32 }, { minWidth: 340, cols: 16 }, { minWidth: 0, cols: 8 }] as const
/** 选中的线程读写过的地址最多列多少个 */
const VISITS_MAX = 12
const ELEM_ITEMS = ELEM_OPTIONS.map((v) => ({ value: v, label: `${v} B` }))
const LINE_ITEMS = LINE_OPTIONS.map((v) => ({ value: v, label: `${v} B` }))
/** 每一车画成一条时各种格子的颜色；不是这个数组的地方透明，露出底下的斜纹 */
const FILL: Record<CellState, string> = { hit: 'var(--blk)', miss: 'var(--hg-surface)', outside: 'transparent', oob: 'var(--hg-error)' }

const { page } = useData()
const root = ref<HTMLElement | null>(null)
/** 一行最多几格；服务端渲染和挂载之前按最宽的画 */
const columns = ref(32)

const data = computed(() => props.step?.result ?? props.result)

const launchOk = computed(() => {
  const l = props.launch
  return Boolean(l) && Number.isInteger(l.grid) && Number.isInteger(l.block) && l.grid >= 1 && l.block >= 1 && l.grid * l.block <= MAX_THREADS
})
// 拆成两个数再拼：父组件每次渲染传一个新的 { grid, block } 对象时，数没变就不重算
const gridDim = computed(() => (launchOk.value ? props.launch.grid : 1))
const blockDim = computed(() => (launchOk.value ? props.launch.block : 1))
const launch = computed(() => ({ grid: gridDim.value, block: blockDim.value }))

// 元素大小、一车多大：自己的开关能改，父组件写了 v-model 就跟着父组件
const elem = ref(props.elemBytes)
const lineSize = ref(props.lineBytes)
watch(() => props.elemBytes, (v) => {
  elem.value = v
})
watch(() => props.lineBytes, (v) => {
  lineSize.value = v
})
function setElem(v: number | string | boolean) {
  elem.value = Number(v)
  emit('update:elemBytes', elem.value)
}
function setLine(v: number | string | boolean) {
  lineSize.value = Number(v)
  emit('update:lineBytes', lineSize.value)
}

const problem = computed(() => {
  if (!launchOk.value) {
    return contentError(`MemoryView 的 launch 要写成 { grid, block }：都是正整数，乘起来不超过 ${MAX_THREADS}。现在是 ${JSON.stringify(props.launch)}。`, page.value.relativePath)
  }
  if (!ELEM_OPTIONS.includes(elem.value) || !LINE_OPTIONS.includes(lineSize.value)) {
    return contentError(`MemoryView 的元素大小要是 ${ELEM_OPTIONS.join(' / ')} 字节，一车大小要是 ${LINE_OPTIONS.join(' / ')} 字节。现在是 ${elem.value} 和 ${lineSize.value}。`, page.value.relativePath)
  }
  const r = data.value
  if (r && props.array && !Object.hasOwn(r.arrays, props.array)) {
    const names = Object.keys(r.arrays)
    return contentError(`MemoryView 要看的数组「${props.array}」不是这次运行的数组参数（${names.length ? `有 ${names.join('、')}` : '这次没有数组参数'}）。`, page.value.relativePath)
  }
  return ''
})

const src = computed(() => {
  const r = data.value
  if (!r || problem.value) return null
  return prepareMemory(r, launch.value, { lineBytes: lineSize.value, elemBytes: elem.value, array: props.array })
})
const size = computed(() => src.value?.size ?? 32)

// ── 看哪一次 ─────────────────────────────────────────────────────────────

const count = computed(() => src.value?.accesses.length ?? 0)
const external = computed(() => props.step ?? null)
/** 自己挑看哪一次（没有跟着沙盒单步） */
const browse = computed(() => src.value !== null && !external.value)
const ownNav = computed(() => props.controls && browse.value && count.value > 0)
const pos = ref(0)
/** 正在看的那一次（accesses 的下标） */
const cur = computed(() => Math.max(0, Math.min(pos.value, count.value - 1)))

function go(k: number) {
  pos.value = Math.max(0, Math.min(k, count.value - 1))
}

/** 这一次（或沙盒这一步）的访存 */
const shown = computed<MemAccess[]>(() => {
  const s = src.value
  if (!s) return []
  const ext = external.value
  if (ext) return accessesInStep(s, ext.index)
  const a = s.accesses[cur.value]
  return a ? [a] : []
})

// ── 选中的线程 ───────────────────────────────────────────────────────────

const picked = computed<ThreadRef | null>(() => {
  const t = props.thread
  const l = launch.value
  if (!t || !Number.isInteger(t.block) || !Number.isInteger(t.thread)) return null
  return t.block >= 0 && t.block < l.grid && t.thread >= 0 && t.thread < l.block ? t : null
})
const pickedKey = computed(() => (picked.value ? `${picked.value.block}:${picked.value.thread}` : ''))

const visits = computed(() => {
  const s = src.value
  const t = picked.value
  if (!s || !t) return []
  return threadVisits(s, t, external.value ? accessesUpTo(s, external.value.index) : Number.POSITIVE_INFINITY)
})
const shownVisits = computed(() => {
  const now = new Set(shown.value.map((a) => a.index))
  return visits.value.slice(0, VISITS_MAX).map((v) => ({
    access: v.access,
    now: now.has(v.access),
    text: `${OP_NAME[v.op]} ${v.array}[${v.index}] · 第 ${v.cars.join('、')} 车${v.oob ? ' · 数组外面' : ''}`,
  }))
})

/** 选中的线程不在正在看的这一次里：翻到它第一次读写显存的那一次（跟着沙盒单步时不翻） */
function followThread() {
  const s = src.value
  const t = picked.value
  if (!s || !t || external.value) return
  const now = s.accesses[cur.value]
  if (now && laneFor(now, t, s.size)) return
  const first = visits.value[0]
  if (first) pos.value = first.access
}

// 新的一次运行、换了数组：从第一次看起
watch([data, () => props.array], () => {
  pos.value = 0
  followThread()
})
watch(pickedKey, followThread)

// ── 怎么画 ──────────────────────────────────────────────────────────────

/** 每一车画成一条：各段格子的颜色，每 8 格一道竖线 */
function barStyle(car: CarView) {
  const n = car.cells.length
  const stops = cellRuns(car.cells).map((r) => `${FILL[r.state]} ${(r.from / n) * 100}% ${(r.to / n) * 100}%`)
  return { '--fill': `linear-gradient(to right, ${stops.join(', ')})`, '--ticks': Math.max(1, n / 8) }
}

const tracks = computed(() => {
  const s = src.value
  if (!s) return []
  const cols = columns.value
  return shown.value.map((access) => {
    const layout = layoutAccess(access, s.lineBytes, s.elemBytes)
    const lane = laneFor(access, picked.value, s.size)
    const width = Math.min(layout.perLine, cols)
    const rows = layout.rows.map((row) => {
      if (row.kind === 'gap') return { kind: 'gap' as const, text: gapLabel(row) }
      const car = row.car
      // 一格一格画时按 width 个一行切开，行首写这一行第一个数的下标
      const lines: { start: number; cells: { index: number; state: CellState; text: string; picked: boolean }[] }[] = []
      if (!layout.dense) {
        for (let k = 0; k < car.cells.length; k += width) {
          lines.push({
            start: car.cells[k].index,
            cells: car.cells.slice(k, k + width).map((c) => ({
              index: c.index,
              state: c.state,
              text: c.threads.length > 1 ? `×${c.threads.length}` : c.threads.length ? String(c.threads[0]) : '',
              picked: lane?.index === c.index,
            })),
          })
        }
      }
      const pin = lane ? car.cells.findIndex((c) => c.index === lane.index) : -1
      return { kind: 'car' as const, car, label: carLabel(car, access.array), lines, bar: layout.dense ? barStyle(car) : null, pin }
    })
    const b = access.block % 6
    return { access, layout, lane, width, rows, style: { '--blk': `var(--hg-group-${b})`, '--blk-soft': `var(--hg-group-${b}-soft)` } }
  })
})

/** 格子里线程号的位数：三位、四位数时字小一点 */
const digits = computed(() => String(Math.max(0, launch.value.block - 1)).length)
const hasOutside = computed(() => tracks.value.some((t) => t.rows.some((r) => r.kind === 'car' && r.car.outside > 0)))
const hasOob = computed(() => tracks.value.some((t) => t.rows.some((r) => r.kind === 'car' && r.car.oob > 0)))
const anyDense = computed(() => tracks.value.some((t) => t.layout.dense))

// ── 文字 ────────────────────────────────────────────────────────────────

const caption = computed(() => {
  const s = src.value
  if (!s) return ''
  const ext = external.value
  if (ext) {
    const list = shown.value
    const g = ext.group
    if (!list.length) return quietStep(s.events, g.from, g.to, props.array)
    return `这一步（block ${g.block} 的 wave ${g.wave}，第 ${g.line} 行）有 ${list.length} 次访存：${list.map(accessTitle).join('、')}。`
  }
  const a = s.accesses[cur.value]
  return a ? `第 ${cur.value + 1} / ${count.value} 次访存：block ${a.block} 的 wave ${a.wave}，第 ${a.line} 行，${accessTitle(a)}。` : ''
})

/** 跑了，但是没有可以看的访存 */
const emptyRun = computed(() => {
  const s = src.value
  if (!s || count.value || external.value) return ''
  if (!s.events.length && !s.complete) return `程序没有跑起来${s.errorLine ? `（第 ${s.errorLine} 行有错）` : ''}，没有访存可以看。`
  return props.array ? `这次运行没有读写 ${props.array}。` : '这次运行没有读写显存。'
})

const used = computed(() => {
  const s = src.value
  if (!s) return null
  return memoryUsage(s, external.value ? accessesUpTo(s, external.value.index) : Number.POSITIVE_INFINITY)
})
const summary = computed(() => {
  const s = src.value
  const u = used.value
  if (!s || !u || (!u.accesses && !external.value)) return ''
  let text = describeMemory(u, external.value ? 'sofar' : 'all')
  if (!external.value && !s.complete && s.errorLine) text += `程序在第 ${s.errorLine} 行出错停下了：只算出错之前的访存。`
  return text
})
/** 汇总表一行的键：哪一行代码、读还是写、哪个数组；正在看的这一次属于哪一行也按它找 */
const rowKey = (r: Pick<UsageRow, 'line' | 'op' | 'array'>) => `${r.line}|${r.op}|${r.array}`
const currentRows = computed(() => new Set(shown.value.map(rowKey)))

const rootLabel = computed(() => `访存视图${ownNav.value ? '：焦点在这里时，← → 换一次访存，Home 回到第一次，End 跳到最后一次' : ''}`)
/** 读屏播报：沙盒单步时由沙盒播报；自己换一次、换开关时说这一次搬了几车 */
const announce = computed(() => {
  if (external.value || !src.value) return ''
  const first = tracks.value[0]
  return first ? `${caption.value}${carsText(first.access)}` : emptyRun.value
})

// ── 键盘 ────────────────────────────────────────────────────────────────

/** 焦点在视图上时：← → 换一次，Home 回到第一次，End 跳到最后一次。开关、进度条自己处理方向键。 */
function onKey(e: KeyboardEvent) {
  if (!ownNav.value || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  if ((e.target as HTMLElement).closest('input, select, textarea, .hg-knob')) return
  const key = e.key
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
  e.preventDefault()
  if (key === 'ArrowLeft') go(cur.value - 1)
  else if (key === 'ArrowRight') go(cur.value + 1)
  else go(key === 'Home' ? 0 : count.value - 1)
}

// ── 挂载 ────────────────────────────────────────────────────────────────

let resize: ResizeObserver | null = null

onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  resize = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0
    if (width > 0) columns.value = COLUMN_TIERS.find((t) => width >= t.minWidth)?.cols ?? 8
  })
  resize.observe(root.value)
})

onBeforeUnmount(() => {
  resize?.disconnect()
})
</script>

<template>
  <div
    ref="root"
    class="hg-mem"
    role="group"
    :aria-label="rootLabel"
    :tabindex="ownNav ? 0 : undefined"
    @keydown="onKey"
  >
    <p v-if="problem" class="hg-mem__problem" role="alert" data-hg-content-error>{{ problem }}</p>

    <div v-if="knobs" class="hg-mem__knobs">
      <Knob label="元素大小" code="elemBytes" :options="ELEM_ITEMS" :model-value="elem" @update:model-value="setElem" />
      <Knob label="一车多大" code="cache line" :options="LINE_ITEMS" :model-value="lineSize" @update:model-value="setLine" />
      <p class="hg-mem__note">两个都是示意值：换了马上重新分车，不用重跑。模拟器的数组都是 4 B，2 B 用来看「元素变小，一车装得下更多个」。</p>
    </div>

    <div v-if="ownNav" class="hg-mem__toolbar">
      <div class="hg-mem__transport" role="group" aria-label="一次一次看访存">
        <button type="button" class="hg-mem__button" :disabled="cur === 0" @click="go(0)">第一次</button>
        <button type="button" class="hg-mem__button" :disabled="cur === 0" @click="go(cur - 1)">上一次</button>
        <button type="button" class="hg-mem__button is-primary" :disabled="cur >= count - 1" @click="go(cur + 1)">下一次</button>
        <button type="button" class="hg-mem__button" :disabled="cur >= count - 1" @click="go(count - 1)">最后一次</button>
      </div>
      <input
        v-if="count > 1"
        class="hg-mem__range"
        type="range"
        min="1"
        :max="count"
        step="1"
        :value="cur + 1"
        aria-label="拖动到第几次访存"
        :aria-valuetext="`第 ${cur + 1} / ${count} 次访存`"
        @input="go(Number(($event.target as HTMLInputElement).value) - 1)"
      >
      <p class="hg-mem__note">一次访存是一个 wave 读或写一个数组；焦点在这个视图上时，← → 换一次。</p>
    </div>

    <p v-if="caption" class="hg-mem__caption">{{ caption }}</p>
    <p v-if="!src && !problem" class="hg-mem__empty">{{ emptyText }}</p>
    <p v-else-if="emptyRun" class="hg-mem__empty">{{ emptyRun }}</p>

    <section
      v-for="t in tracks"
      :key="t.access.event"
      class="hg-mem__track"
      :style="t.style"
      :aria-label="`${accessTitle(t.access)}：block ${t.access.block} 的 wave ${t.access.wave}，第 ${t.access.line} 行`"
    >
      <div class="hg-mem__head">
        <h4 class="hg-mem__title">{{ accessTitle(t.access) }}</h4>
        <span class="hg-mem__meta">block {{ t.access.block }} · wave {{ t.access.wave }} · 第 {{ t.access.line }} 行 · {{ t.access.lanes.length }} 个 lane</span>
      </div>

      <p class="hg-mem__score">
        <span class="hg-mem__num"><span class="hg-mem__num-label">这次搬了</span><strong>{{ t.access.transactions }}</strong> 车</span>
        <span class="hg-mem__num is-ideal"><span class="hg-mem__num-label">理想是</span><strong>{{ t.access.ideal }}</strong> 车</span>
        <span class="hg-mem__formula">理想 = ⌈{{ t.access.elements }} 个数 × {{ elem }} B ÷ {{ lineSize }} B⌉ · 模拟</span>
      </p>
      <p class="hg-mem__text">{{ addrText(t.access) }}</p>
      <p class="hg-mem__hint">
        一车 {{ lineSize }} B，装 {{ t.layout.perLine }} 个数；{{ t.layout.dense ? '车多，每一车画成一条：一格一个数，涂色的是这次要的' : '格子里的数字是要它的线程（threadIdx.x）' }}
      </p>

      <div class="hg-mem__cars" :class="[{ 'is-dense': t.layout.dense }, `is-d${digits}`]" role="group" :aria-label="`${t.access.array} 这次碰到的 ${t.access.transactions} 车`">
        <template v-for="(row, k) in t.rows" :key="k">
          <p v-if="row.kind === 'gap'" class="hg-mem__gap">⋯ {{ row.text }}</p>
          <div v-else-if="!row.bar" class="hg-mem__car" role="img" :aria-label="row.label">
            <p class="hg-mem__car-head" aria-hidden="true">
              <span class="hg-mem__car-name">第 {{ row.car.line }} 车</span>
              <span>字节 {{ row.car.from }}–{{ row.car.to }}</span>
              <span>要了 {{ row.car.used }} / {{ row.car.cells.length }} 个</span>
              <span v-if="row.car.oob" class="hg-mem__car-oob">! {{ row.car.oob }} 个越界</span>
            </p>
            <div v-for="line in row.lines" :key="line.start" class="hg-mem__line" :style="{ '--cols': t.width }" aria-hidden="true">
              <span class="hg-mem__line-start">{{ t.access.array }}[{{ line.start }}]</span>
              <span class="hg-mem__cells">
                <span
                  v-for="c in line.cells"
                  :key="c.index"
                  class="hg-mem__cell"
                  :class="[`is-${c.state}`, { 'is-picked': c.picked }]"
                >{{ c.text }}</span>
              </span>
            </div>
          </div>
          <div v-else class="hg-mem__strip" role="img" :aria-label="row.label">
            <span class="hg-mem__strip-name" aria-hidden="true">第 {{ row.car.line }} 车</span>
            <span class="hg-mem__strip-start" aria-hidden="true">{{ t.access.array }}[{{ row.car.cells[0]?.index }}]</span>
            <span class="hg-mem__bar" :style="row.bar" aria-hidden="true">
              <span
                v-if="row.pin >= 0"
                class="hg-mem__pin"
                :style="{ left: `${(row.pin / row.car.cells.length) * 100}%`, width: `${100 / row.car.cells.length}%` }"
              />
            </span>
            <span class="hg-mem__strip-count" :class="{ 'is-oob': row.car.oob }" aria-hidden="true">{{ row.car.oob ? '! ' : '' }}{{ row.car.used }}/{{ row.car.cells.length }}</span>
          </div>
        </template>
      </div>
      <p v-if="t.layout.hidden" class="hg-mem__more">还有 {{ t.layout.hidden }} 车没有画出来（车次照样算上了）。</p>

      <p class="hg-mem__verdict">{{ carsText(t.access) }}</p>
      <p v-if="picked" class="hg-mem__picked">{{ pickedText(t.access, picked, size, lineSize, elem) }}</p>
    </section>

    <div v-if="picked && src" class="hg-mem__thread" role="group" aria-label="选中的线程读写过的地址">
      <p class="hg-mem__thread-name">
        <span class="hg-mem__label">选中的线程</span>
        第 {{ picked.block }} 组第 {{ picked.thread }} 个（blockIdx.x = {{ picked.block }}，threadIdx.x = {{ picked.thread }}）
      </p>
      <p v-if="!visits.length" class="hg-mem__text">{{ external ? '到这一步为止' : '这次运行里' }}它没有读写显存{{ array ? `里的 ${array}` : '' }}。</p>
      <template v-else>
        <p class="hg-mem__text">它读写过的地址（{{ external ? '到这一步为止' : '一共' }} {{ visits.length }} 次{{ browse ? '，点一个看那一次' : '' }}）：</p>
        <ul class="hg-mem__visits">
          <li v-for="v in shownVisits" :key="v.access">
            <button v-if="browse" type="button" class="hg-mem__visit" :aria-pressed="v.now" @click="go(v.access)">{{ v.text }}</button>
            <span v-else class="hg-mem__visit" :class="{ 'is-now': v.now }">{{ v.text }}<span v-if="v.now" class="hg-mem__sr">（就是这一步）</span></span>
          </li>
        </ul>
        <p v-if="visits.length > VISITS_MAX" class="hg-mem__more">还有 {{ visits.length - VISITS_MAX }} 次没有列出来。</p>
      </template>
    </div>

    <div v-if="summary" class="hg-mem__summary">
      <p class="hg-mem__total">{{ summary }}</p>
      <div v-if="used && used.rows.length" class="hg-mem__table-wrap">
        <table class="hg-mem__table">
          <caption class="hg-mem__sr">{{ external ? '到这一步为止' : '整段' }}每一行代码的读写一共搬了几车（模拟）</caption>
          <thead>
            <tr>
              <th scope="col">哪一行</th>
              <th scope="col">次数</th>
              <th scope="col">搬了</th>
              <th scope="col">理想</th>
              <th scope="col">效率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in used.rows" :key="rowKey(r)" :class="{ 'is-current': currentRows.has(rowKey(r)) }">
              <th scope="row"><span class="hg-mem__keep">第 {{ r.line }} 行</span> · <span class="hg-mem__keep">{{ OP_NAME[r.op] }} {{ r.array }}</span></th>
              <td>{{ r.accesses }}</td>
              <td>{{ r.transactions }} 车</td>
              <td>{{ r.ideal }} 车</td>
              <td>{{ percent(efficiency(r)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <p class="hg-mem__sr" aria-live="polite">{{ announce }}</p>

    <ul v-if="tracks.length" class="hg-mem__legend" aria-label="图例">
      <li><span class="hg-mem__sw is-hit" aria-hidden="true">{{ anyDense ? '' : 3 }}</span>这次要的</li>
      <li><span class="hg-mem__sw is-miss" aria-hidden="true" />跟着整车搬来、没人要</li>
      <li v-if="hasOutside"><span class="hg-mem__sw is-outside" aria-hidden="true" />不是这个数组的地方</li>
      <li v-if="hasOob"><span class="hg-mem__sw is-oob" aria-hidden="true">!</span>要到了数组外面（越界）</li>
      <li v-if="picked"><span class="hg-mem__sw is-picked" aria-hidden="true" />选中的线程要的</li>
    </ul>
  </div>
</template>

<style scoped>
.hg-mem {
  container-type: inline-size;
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

.hg-mem:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-mem__problem {
  margin: 0;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

/* ── 两个开关、一次一次看（按钮和 RobotGrid、WaveView 一样） ── */

.hg-mem__knobs {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 28px;
  padding-bottom: 10px;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
}

.hg-mem__knobs .hg-mem__note {
  flex: 1 1 100%;
}

.hg-mem__toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
}

.hg-mem__transport {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hg-mem__button {
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
.hg-mem__button.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-mem__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.hg-mem__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-mem__range {
  width: 100%;
  margin: 0;
  accent-color: var(--hg-accent);
}

.hg-mem__note,
.hg-mem__hint,
.hg-mem__more {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 12px;
  line-height: 1.55;
}

.hg-mem__caption,
.hg-mem__text,
.hg-mem__verdict,
.hg-mem__picked,
.hg-mem__total,
.hg-mem__empty {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}

.hg-mem__text {
  color: var(--hg-ink-2);
}

.hg-mem__empty {
  padding: 12px 14px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  color: var(--hg-ink-3);
}

/* ── 一次访存 ── */

.hg-mem__track {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.hg-mem__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
}

.hg-mem__title {
  margin: 0;
  padding: 0;
  border: 0;
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.4;
}

.hg-mem__meta,
.hg-mem__formula {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-mem__score {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 18px;
  margin: 0;
}

.hg-mem__num {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.hg-mem__num strong {
  color: var(--hg-ink);
  font-family: var(--hg-font-display);
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
}

.hg-mem__num.is-ideal strong {
  color: var(--hg-ink-2);
  font-size: 22px;
}

.hg-mem__num-label {
  font-size: 13px;
}

.hg-mem__formula {
  color: var(--hg-ink-3);
}

.hg-mem__verdict {
  color: var(--hg-ink);
  font-weight: 600;
}

.hg-mem__picked {
  padding: 6px 10px;
  border: var(--hg-border-width) solid var(--hg-accent);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-accent-soft);
  color: var(--hg-ink);
}

/* ── 车：一车一节车厢（上面敞开的框），格子装在里面（01 第 6 节：cache line = 一组格子外的括号） ── */

.hg-mem__cars {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.hg-mem__cars.is-dense {
  gap: 3px;
}

.hg-mem__gap {
  margin: 0;
  padding: 2px 0 2px 10px;
  border-left: var(--hg-border-width) dashed var(--hg-border-strong);
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

.hg-mem__car {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 6px 8px 8px;
  border: var(--hg-border-width) solid var(--hg-ink-3);
  border-top: 0;
  border-radius: 0 0 10px 10px;
  background: var(--hg-surface);
}

.hg-mem__car-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 10px;
  margin: 0;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

.hg-mem__car-name {
  color: var(--hg-ink);
  font-family: var(--hg-font-body);
  font-size: 12px;
  font-weight: 700;
}

.hg-mem__car-oob {
  color: var(--hg-error-ink);
  font-weight: 700;
}

/* 一行格子：行首是这一行第一个数的下标（字号定在这一层，列宽的 em 跟着它算） */
.hg-mem__line {
  display: grid;
  grid-template-columns: 6em minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  font-size: 10px;
}

.hg-mem__line-start {
  overflow: hidden;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 1em;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hg-mem__cells {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: 2px;
  /* 一行格子少（一车 8 个数）时不把格子拉得太宽 */
  max-width: calc(var(--cols) * 26px);
}

.hg-mem__cell {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  min-width: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    border-color var(--motion-fast) var(--motion-ease-out);
}

.hg-mem__cars.is-d3 .hg-mem__cell {
  font-size: 8px;
}

.hg-mem__cars.is-d4 .hg-mem__cell {
  font-size: 7px;
  letter-spacing: -0.04em;
}

.hg-mem__cell.is-hit {
  border-color: var(--blk);
  background: var(--blk-soft);
}

/* 不是这个数组的地方：斜纹、没有边框（01 第 7 节：不只靠颜色） */
.hg-mem__cell.is-outside {
  border-color: transparent;
  background: repeating-linear-gradient(45deg, var(--hg-border) 0 2px, transparent 2px 5px);
}

/* 要到了数组外面：红色虚线框 + 斜纹底（同越界区） */
.hg-mem__cell.is-oob {
  border: var(--hg-border-width) dashed var(--hg-error);
  background: repeating-linear-gradient(45deg, var(--hg-error-soft) 0 3px, transparent 3px 6px);
  color: var(--hg-error-ink);
}

.hg-mem__cell.is-picked {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

/* 车多时每一车画成一条（字号定在这一层，列宽的 em 跟着它算） */
.hg-mem__strip {
  display: grid;
  grid-template-columns: 4.4em 6em minmax(0, 1fr) 3.6em;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
}

.hg-mem__strip-name {
  color: var(--hg-ink-2);
  font-size: 1em;
  font-weight: 700;
  white-space: nowrap;
}

.hg-mem__strip-start,
.hg-mem__strip-count {
  overflow: hidden;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hg-mem__strip-count {
  text-align: right;
}

.hg-mem__strip-count.is-oob {
  color: var(--hg-error-ink);
  font-weight: 700;
}

/*
 * 一条三层背景：每 8 格一道竖线；各段格子的颜色（涂色的是这次要的，白的没人要）；
 * 不是这个数组的那几格透明，露出最底下的斜纹。
 */
.hg-mem__bar {
  position: relative;
  height: 12px;
  border: var(--hg-border-width) solid var(--hg-ink-3);
  border-radius: 3px;
  background:
    linear-gradient(to right, transparent calc(100% - 1px), var(--hg-border-strong) 0) 0 0 / calc(100% / var(--ticks)) 100%,
    var(--fill),
    repeating-linear-gradient(45deg, var(--hg-border) 0 2px, transparent 2px 5px);
}

/* 选中的线程要的那一格：在条上描一圈 */
.hg-mem__pin {
  position: absolute;
  top: -4px;
  bottom: -4px;
  min-width: 4px;
  border-radius: 2px;
  outline: 2px solid var(--hg-accent-ink);
}

/* ── 选中的线程 ── */

.hg-mem__thread {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
}

.hg-mem__thread-name {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.hg-mem__label {
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 700;
}

.hg-mem__visits {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-mem__visits li {
  margin: 0;
}

.hg-mem__visit {
  display: inline-block;
  padding: 3px 10px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  line-height: 1.5;
}

button.hg-mem__visit {
  cursor: pointer;
}

button.hg-mem__visit:hover {
  border-color: var(--hg-accent);
}

.hg-mem__visit[aria-pressed='true'],
.hg-mem__visit.is-now {
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent-soft);
  font-weight: 700;
}

/* ── 汇总 ── */

.hg-mem__summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.hg-mem__total {
  color: var(--hg-ink);
  font-weight: 600;
}

.hg-mem__table-wrap {
  max-width: 100%;
  overflow-x: auto;
}

.hg-mem__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 13px;
}

.hg-mem__table th,
.hg-mem__table td {
  padding: 4px 8px;
  border: 0;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
  background: none;
  text-align: right;
  white-space: nowrap;
}

.hg-mem__table thead th {
  color: var(--hg-ink-3);
  font-size: 12px;
  font-weight: 600;
}

.hg-mem__table th:first-child {
  text-align: left;
}

.hg-mem__table tbody th {
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-weight: 600;
}

.hg-mem__keep {
  white-space: nowrap;
}

.hg-mem__table td {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
}

.hg-mem__table tr {
  border: 0;
  background: none;
}

/* 正在看的那一次属于哪一行：描一道强调色，再加一个「▶」（不只靠颜色） */
.hg-mem__table tr.is-current th:first-child::before {
  content: '▶ ';
  color: var(--hg-accent-ink);
  font-size: 9px;
}

.hg-mem__table tr.is-current > * {
  background: var(--hg-accent-soft);
}

.hg-mem__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* 图例：每种格子都有自己的样子，不只靠颜色（01 第 7 节） */
.hg-mem__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  list-style: none;
}

.hg-mem__legend li {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
}

.hg-mem__sw {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 3px;
  background: var(--hg-surface);
  font-family: var(--hg-font-mono);
  font-size: 9px;
  font-weight: 700;
}

.hg-mem__sw.is-hit {
  border-color: var(--hg-group-0);
  background: var(--hg-group-0-soft);
  color: var(--hg-ink);
}

.hg-mem__sw.is-outside {
  border-color: transparent;
  background: repeating-linear-gradient(45deg, var(--hg-border) 0 2px, transparent 2px 5px);
}

.hg-mem__sw.is-oob {
  border-style: dashed;
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
}

.hg-mem__sw.is-picked {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

.hg-mem__button:focus-visible,
.hg-mem__range:focus-visible,
.hg-mem__visit:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

@media (max-width: 767px) {
  .hg-mem {
    padding: 12px;
  }

  .hg-mem__track {
    padding: 10px;
  }
}

/* 窄的时候：每一车画成一条时不写这一车第一个数的下标，行首的下标窄一点；汇总表的字小一点，第一列可以折行 */
@container (max-width: 520px) {
  .hg-mem__strip {
    grid-template-columns: 4.2em minmax(0, 1fr) 3.4em;
    gap: 6px;
  }

  .hg-mem__strip-start {
    display: none;
  }

  .hg-mem__line {
    grid-template-columns: 5em minmax(0, 1fr);
    gap: 4px;
  }

  .hg-mem__table {
    font-size: 12px;
  }

  .hg-mem__table th,
  .hg-mem__table td {
    padding: 4px 5px;
  }

  .hg-mem__table tbody th {
    white-space: normal;
  }
}
</style>
