<script setup lang="ts">
/**
 * 1-2 的芯片全景图（关卡自己的 scenes，不用登记组件）：芯片 → WGP → 计算单元 → SIMD → lane，逐层放大。
 *
 * 读者点一个部件（或用方向键挑、回车）就放大到它里面，点面包屑或「缩小一层」退回去（03 第 1 节第 3 条：
 * 随时可以回到开头）。右边（窄屏在下面）写这一层有什么，数都从参数来（03 第 1 节第 4 条：一句话解读）。
 *
 * 参数：传了 spec 就画那一份；不传时跟着读者的「我的 GPU 卡片」（L-07）：选了卡、而且 hardware.json 里有这个 gfx 的
 * 结构，就画你的卡（specFromCard），可以随时换回本书的 RX 9070 XT 对照正文（不改存档里选的卡）；没有卡片时画
 * hardware.json 里的 RX 9070 XT。画的是哪张、数从哪来，写在标题下面那一行。换了一张卡就按新的数重画，原来看到
 * 哪一层就尽量留在哪一层（clampPath）。每一层画在哪由 panorama.ts 的 layoutOf 算好，放大、缩小的衔接（zoomFrame）
 * 也在那里：新的一层从被点的部件里长出来，02 第 3 节。减弱动效时过渡时长 token 归零，直接切换。
 * 存档要等 onMounted 之后才读得到：服务端和水合时都按没有卡片画，读出来以后再换（同「我的成长」页）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { withBase } from 'vitepress'
import { stageById } from '@course/outline.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  DEFAULT_SPEC, START, clampPath, countsOf, crumbsOf, describe, indexAt, layoutOf, levelsOf, normalizeSpec,
  sizeText, specFromCard, zoomFrame, zoomIn, zoomOutTo, type Box, type ChipSpec, type Level, type Mode, type Path, type Unit,
} from '../panorama.ts'

const props = defineProps<{
  /** 要画的那张卡。不传就跟着读者的「我的 GPU 卡片」，没有卡片时是 RX 9070 XT（hardware.json）。 */
  spec?: ChipSpec
}>()

const progress = useProgress()
/** 读者当前选的卡；传了 spec 时不看。 */
const card = computed(() => (props.spec ? null : progress.currentDevice()))
/** 这张卡画得出来吗：hardware.json 里没有它的 gfx 时是 null（结构没有出处）。 */
const cardSpec = computed(() => (card.value ? specFromCard(card.value) : null))
/** 有自己的卡时，读者可以临时换回本书的卡，对照正文里的数。 */
const showBook = ref(false)
const mine = computed(() => Boolean(cardSpec.value) && !showBook.value)
const YOUR_GPU = stageById('forge-your-gpu')

const spec = computed(() => normalizeSpec(props.spec ?? (mine.value && cardSpec.value ? cardSpec.value : DEFAULT_SPEC)))
const counts = computed(() => countsOf(spec.value))
const levels = computed(() => levelsOf(spec.value))

const path = ref<Path>({ ...START })
/** 宽屏和窄屏两套坐标（panorama.ts 的 VIEW）。服务端按宽屏渲染，挂载后按屏幕宽度换。 */
const mode = ref<Mode>('wide')

const layout = computed(() => layoutOf(spec.value, path.value, mode.value))
const reading = computed(() => describe(spec.value, path.value))
const crumbs = computed(() => crumbsOf(spec.value, path.value))
const depth = computed(() => levels.value.indexOf(path.value.level))

/** 每一层一个 key（面包屑连起来）：换层时 Transition 让旧的一层离开、新的一层进来。 */
const levelKey = computed(() => crumbs.value.map((c) => c.label).join(' > '))

// ── 放大、缩小 ──────────────────────────────────────────────────────────

const direction = ref<'in' | 'out'>('in')
const zoom = ref({ ox: 200, oy: 140, sx: 1, sy: 1 })
/** 键盘焦点停在这一层的第几个部件上（roving tabindex：只有它能 Tab 到）。 */
const active = ref(0)
const root = ref<HTMLElement | null>(null)
const backButton = ref<HTMLButtonElement | null>(null)

function focusUnit(index: number) {
  active.value = index
  // 离开中的旧一层还在 DOM 里，只找现在这一层（data-level）里的部件。
  const el = root.value?.querySelector<SVGGElement>(`[data-level="${levelKey.value}"] [data-unit="${index}"]`)
  if (el) el.focus()
  else if (!layout.value.units.length) backButton.value?.focus()
}

/** 焦点本来就在全景图里（键盘操作）时，换层以后把焦点放到新的一层；用鼠标点的不抢焦点。 */
async function settle(index: number, keepFocus: boolean) {
  active.value = index
  await nextTick()
  if (keepFocus) focusUnit(index)
}

function open(index: number) {
  const next = zoomIn(spec.value, path.value, index)
  if (next === path.value) return
  const keepFocus = Boolean(root.value?.contains(document.activeElement))
  zoom.value = zoomFrame(spec.value, next, next.level, mode.value)
  direction.value = 'in'
  path.value = next
  settle(0, keepFocus)
}

function back(level: Level) {
  const from = path.value
  const next = zoomOutTo(spec.value, from, level)
  if (next === from) return
  const keepFocus = Boolean(root.value?.contains(document.activeElement))
  // 退回去以后，焦点和缩放中心都落在刚才走进去的那个部件上。
  const child = levels.value[levels.value.indexOf(level) + 1]
  zoom.value = zoomFrame(spec.value, from, child, mode.value)
  direction.value = 'out'
  path.value = next
  settle(indexAt(from, child), keepFocus)
}

function backOne() {
  if (depth.value > 0) back(levels.value[depth.value - 1])
}

/** 在全景图里任何地方（部件、面包屑、「缩小一层」）按 Esc 都缩小一层；已经在芯片这一层就不拦。 */
function onRootKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || depth.value === 0 || event.altKey || event.ctrlKey || event.metaKey) return
  event.preventDefault()
  backOne()
}

function onUnitKey(event: KeyboardEvent, index: number) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const n = layout.value.units.length
  const cols = layout.value.cols
  let next: number | null = null
  switch (event.key) {
    case 'ArrowRight': next = Math.min(n - 1, index + 1); break
    case 'ArrowLeft': next = Math.max(0, index - 1); break
    case 'ArrowDown': next = index + cols < n ? index + cols : index; break
    case 'ArrowUp': next = index - cols >= 0 ? index - cols : index; break
    case 'Home': next = 0; break
    case 'End': next = n - 1; break
    case 'Enter':
    case ' ':
      event.preventDefault()
      open(index)
      return
    default:
      return
  }
  event.preventDefault()
  focusUnit(next)
}

// L-07 换了一张卡：路径收回到新卡的范围里，焦点序号也收回来。
watch(spec, (s) => {
  path.value = clampPath(s, path.value)
  active.value = Math.min(active.value, Math.max(0, layout.value.units.length - 1))
})

let query: MediaQueryList | null = null
const onQuery = () => {
  mode.value = query?.matches ? 'narrow' : 'wide'
}

onMounted(() => {
  query = window.matchMedia('(max-width: 639px)')
  onQuery()
  query.addEventListener('change', onQuery)
})

onBeforeUnmount(() => query?.removeEventListener('change', onQuery))

// ── 画法 ─────────────────────────────────────────────────────────────────

const uid = useId()
const hatchId = `${uid}-hatch`
const titleId = `${uid}-title`

const box = (b: Box) => ({ x: b.x, y: b.y, width: b.w, height: b.h })

/** area 里排 count 个小格：rows 行，每行一样多（最后一行可以不满）。 */
function cells(area: Box, count: number, rows: number, gap: number): Box[] {
  const perRow = Math.ceil(count / rows)
  const w = (area.w - gap * (perRow - 1)) / perRow
  const h = (area.h - gap * (rows - 1)) / rows
  return Array.from({ length: count }, (_, i) => ({
    x: area.x + (i % perRow) * (w + gap),
    y: area.y + Math.floor(i / perRow) * (h + gap),
    w,
    h,
  }))
}

const level = computed(() => path.value.level)
const frameTitle = computed(() => {
  const s = spec.value
  const p = path.value
  switch (level.value) {
    case 'chip': return [s.name, s.gfx].filter(Boolean).join(' · ')
    case 'wgp': return `WGP ${p.wgp}`
    case 'cu': return levels.value.includes('wgp') ? `WGP ${p.wgp} › 计算单元 ${p.cu}` : `计算单元 ${p.cu}`
    case 'simd': return `计算单元 ${p.cu} › SIMD ${p.simd}`
    default: return `SIMD ${p.simd} › lane ${p.lane}`
  }
})

function unitLabel(u: Unit): string {
  const s = spec.value
  switch (level.value) {
    case 'chip':
      return levels.value.includes('wgp')
        ? `WGP ${u.index}：${u.parts} 个计算单元。按回车放大。`
        : `计算单元 ${u.index}：${s.simdsPerCu} 条 SIMD。按回车放大。`
    case 'wgp': return `计算单元 ${u.index}：${s.simdsPerCu} 条 SIMD，每条 ${s.lanesPerSimd} 个 lane。按回车放大。`
    case 'cu': return `SIMD ${u.index}：${s.lanesPerSimd} 个 lane。按回车放大。`
    default: return `lane ${u.index}。按回车放大。`
  }
}

interface UnitView extends Unit {
  label: string
  /** 部件里再分的几块：WGP 里的计算单元、计算单元里的 SIMD。 */
  inner: Box[]
  /** 一个个小方块：lane。 */
  marks: Box[]
  /** 一条寄存器（斜纹）。 */
  reg: Box | null
  name: { x: number; y: number; text: string } | null
}

/** 每个能点的部件里画什么，按这一层分：画到下一层的样子，放大以后对得上（02 第 3 节「对象恒常」）。 */
const unitViews = computed<UnitView[]>(() => {
  const s = spec.value
  const narrow = mode.value === 'narrow'
  return layout.value.units.map((u) => {
    const view: UnitView = { ...u, label: unitLabel(u), inner: [], marks: [], reg: null, name: null }
    if (level.value === 'chip') {
      // WGP 里的计算单元（没有 WGP 的卡：计算单元里的 SIMD）：横着的格子左右分，竖着的上下分。
      const area = { x: u.x + 3, y: u.y + 3, w: u.w - 6, h: u.h - 6 }
      view.inner = cells(area, u.parts, u.w >= u.h ? 1 : u.parts, 2)
    } else if (level.value === 'wgp') {
      view.name = { x: u.x + 8, y: u.y + 15, text: `计算单元 ${u.index}` }
      view.inner = cells({ x: u.x + 8, y: u.y + 22, w: u.w - 16, h: u.h - 30 }, s.simdsPerCu, s.simdsPerCu, 6)
      view.marks = view.inner.flatMap((bar) => cells({ x: bar.x + 4, y: bar.y + 4, w: bar.w - 8, h: bar.h - 8 }, s.lanesPerSimd, 1, 1))
    } else if (level.value === 'cu') {
      const regH = narrow ? 16 : 12
      view.name = { x: u.x + 10, y: u.y + 15, text: `SIMD ${u.index}` }
      view.marks = cells({ x: u.x + 10, y: u.y + 22, w: u.w - 20, h: u.h - 22 - regH - 14 }, s.lanesPerSimd, narrow ? 2 : 1, 2)
      view.reg = { x: u.x + 10, y: u.y + u.h - regH - 8, w: u.w - 20, h: regH }
    } else {
      const regH = narrow ? 8 : 4
      view.reg = { x: u.x + 3, y: u.y + u.h - regH - 3, w: u.w - 6, h: regH }
      view.name = { x: u.x + u.w / 2, y: u.y + (u.h - regH) / 2 + 4, text: String(u.index) }
    }
    return view
  })
})

/** lane 这一层：三格寄存器（a[i] + b[i] = c[i]），下面的显存里同名的三格，读的箭头向上，写的箭头向下。 */
const laneParts = computed(() => {
  const narrow = mode.value === 'narrow'
  const w = narrow ? 70 : 78
  const y = narrow ? 112 : 80
  const h = narrow ? 48 : 44
  const xs = narrow ? [24, 118, 212] : [36, 150, 264]
  const memY = narrow ? 346 : 236
  const memH = narrow ? 34 : 28
  return {
    head: { x: xs[0], y: y - 12 },
    regs: ['a[i]', 'b[i]', 'c[i]'].map((name, i) => ({ name, box: { x: xs[i], y, w, h } })),
    ops: [{ text: '+', x: (xs[0] + w + xs[1]) / 2 }, { text: '=', x: (xs[1] + w + xs[2]) / 2 }].map((o) => ({ ...o, y: y + h / 2 + 6 })),
    mem: ['a[i]', 'b[i]', 'c[i]'].map((name, i) => ({ name, box: { x: xs[i], y: memY, w, h: memH } })),
    // 读的箭头从显存指向寄存器，写的箭头反过来（02 第 3 节）；箭头旁边写「读」「写」。
    arrows: xs.map((x, i) => ({ x: x + w / 2, from: i < 2 ? memY : y + h, to: i < 2 ? y + h : memY, up: i < 2, labelY: (y + h + memY) / 2 + 4 })),
  }
})

/** 芯片和显存之间的几条连线（显存接口），只是示意。 */
const wires = computed(() => {
  const f = layout.value.frame
  const b = layout.value.below
  const n = 8
  return Array.from({ length: n }, (_, i) => ({ x: f.x + (f.w * (i + 0.5)) / n, y1: f.y + f.h, y2: b.y }))
})

const stageLabel = computed(() =>
  `芯片全景图：${spec.value.name}。现在看的是 ${crumbs.value.map((c) => c.label).join(' › ')}。方向键挑部件，回车放大，Esc 缩小一层。`)

/** 「每一层有几个」：整块芯片 1 块 → … → lane 4096 个，现在这一层高亮。 */
const ladder = computed(() => {
  const c = counts.value
  const all: { level: Level; name: string; count: string }[] = [
    { level: 'chip', name: '芯片', count: '1 块' },
    { level: 'wgp', name: 'WGP', count: `${c.wgps} 个` },
    { level: 'cu', name: '计算单元', count: `${c.cus} 个` },
    { level: 'simd', name: 'SIMD', count: `${c.simds} 条` },
    { level: 'lane', name: 'lane', count: `${c.lanes} 个` },
  ]
  return all.filter((row) => levels.value.includes(row.level))
})

const zoomVars = computed(() => ({
  '--pz-ox': `${zoom.value.ox}px`,
  '--pz-oy': `${zoom.value.oy}px`,
  '--pz-sx': zoom.value.sx,
  '--pz-sy': zoom.value.sy,
  '--pz-isx': 1 / zoom.value.sx,
  '--pz-isy': 1 / zoom.value.sy,
}))
</script>

<template>
  <section ref="root" class="pz" :aria-labelledby="titleId" @keydown="onRootKey">
    <header class="pz__head">
      <span class="pz__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="pz__title">芯片全景图：{{ spec.name }}</strong>
      <span class="pz__tag">示意图</span>
    </header>

    <!-- 画的是哪张卡、数从哪来（L-07）：没有卡片时标出本书的卡和出处，有卡片时可以和本书的卡来回换。 -->
    <div v-if="!props.spec" class="pz__source" :class="{ 'is-mine': mine }">
      <span class="pz__source-tag">{{ mine ? '你的卡' : '本书的卡' }}</span>
      <p class="pz__source-text">
        <template v-if="mine && card">
          数来自你的 GPU 卡片（导入码 {{ card.at.slice(0, 10) }} 生成）：CU 数、wave 大小、显存是你的卡的，内部结构按同一架构的官方资料画。
        </template>
        <template v-else-if="cardSpec">正文说的就是这张卡，数来自 AMD 官方资料。</template>
        <template v-else-if="card">
          你的 GPU 卡片是 {{ card.name }}（{{ card.gfx }}）。本书的硬件资料里还没有 {{ card.gfx }} 的内部结构，这里先画本书的实验卡。
        </template>
        <template v-else>
          数来自 AMD 官方资料。到了铸造城第 {{ YOUR_GPU?.code }} 关，在你的卡上运行 <code translate="no">hg.device_card()</code>，导入「我的 GPU 卡片」，这里就换成你的卡：<a :href="withBase('/me/#gpu-card')">在「我的成长」里导入</a>
        </template>
      </p>
      <button v-if="cardSpec" type="button" class="pz__button" @click="showBook = !showBook">
        {{ showBook ? '换回我的卡' : '看本书的卡' }}
      </button>
    </div>

    <nav class="pz__crumbs" aria-label="全景图看到哪一层">
      <ol>
        <li v-for="(crumb, i) in crumbs" :key="crumb.level">
          <button v-if="i < crumbs.length - 1" type="button" class="pz__crumb" @click="back(crumb.level)">{{ crumb.label }}</button>
          <span v-else class="pz__crumb is-current" aria-current="location">{{ crumb.label }}</span>
        </li>
      </ol>
      <button ref="backButton" type="button" class="pz__button" :disabled="depth === 0" @click="backOne">缩小一层</button>
    </nav>

    <div class="pz__body">
      <svg
        class="pz__stage"
        :class="`is-${mode}`"
        :viewBox="`0 0 ${layout.view.w} ${layout.view.h}`"
        role="group"
        :aria-label="stageLabel"
        :style="zoomVars"
      >
        <defs>
          <!-- 存储（缓存、LDS、寄存器、显存）用斜纹，和计算的部件分开；不靠颜色区分（01 第 7 节）。 -->
          <pattern :id="hatchId" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" class="pz-hatch__bg" />
            <line x1="0" y1="0" x2="0" y2="6" class="pz-hatch__line" />
          </pattern>
        </defs>

        <Transition :name="`pz-${direction}`">
          <g :key="levelKey" class="pz-level" :data-level="levelKey">
            <!-- 外框下面：显存。芯片这一层画实物和接口线，往里放大以后只留一条提示。 -->
            <template v-if="level === 'chip'">
              <line v-for="(w, i) in wires" :key="`w${i}`" class="pz-wire" :x1="w.x" :x2="w.x" :y1="w.y1" :y2="w.y2" />
              <rect class="pz-store" v-bind="box(layout.below)" rx="10" :fill="`url(#${hatchId})`" />
              <text class="pz-label is-strong" :x="layout.below.x + 14" :y="layout.below.y + 21">显存（芯片外面）</text>
              <text class="pz-label is-mono" :x="layout.below.x + 14" :y="layout.below.y + 38">{{ [sizeText(spec.vram), spec.vramType].filter(Boolean).join(' ') || '容量[待实测]' }}</text>
            </template>
            <template v-else-if="level !== 'lane'">
              <rect class="pz-ghost" v-bind="box(layout.below)" rx="10" />
              <text class="pz-label is-faint" :x="layout.below.x + 14" :y="layout.below.y + layout.below.h / 2 + 4">显存在芯片外面，在下方</text>
            </template>

            <rect class="pz-frame" v-bind="box(layout.frame)" rx="14" />
            <text class="pz-label is-title" :x="layout.title.x" :y="layout.title.y">{{ frameTitle }}</text>

            <!-- 外框里不能点的部分：缓存、LDS、「一条指令」 -->
            <g v-for="shelf in layout.shelves" :key="shelf.key">
              <template v-if="shelf.key === 'banner'">
                <rect class="pz-banner" v-bind="box(shelf)" rx="8" />
                <text class="pz-label is-strong" :x="shelf.x + 12" :y="shelf.y + shelf.h / 2 + 4">{{ shelf.label }} → {{ shelf.text }}</text>
              </template>
              <template v-else>
                <rect class="pz-store" v-bind="box(shelf)" rx="8" :fill="`url(#${hatchId})`" />
                <text class="pz-label is-strong" :x="shelf.x + 10" :y="shelf.y + shelf.h / 2 + 4">
                  {{ shelf.key === 'lds' ? 'LDS（共享货架）' : shelf.label }}<tspan v-if="shelf.text" class="pz-label is-mono" dx="8">{{ shelf.text }}</tspan>
                </text>
              </template>
            </g>

            <!-- 能点的部件：芯片里的 WGP、WGP 里的计算单元、计算单元里的 SIMD、SIMD 里的 lane -->
            <g
              v-for="u in unitViews"
              :key="u.index"
              class="pz-unit"
              :data-unit="u.index"
              role="button"
              :tabindex="u.index === active ? 0 : -1"
              :aria-label="u.label"
              @click="open(u.index)"
              @keydown="onUnitKey($event, u.index)"
              @focus="active = u.index"
            >
              <rect class="pz-unit__box" v-bind="box(u)" :rx="level === 'simd' ? 5 : 7" />
              <rect v-for="(p, k) in u.inner" :key="`i${k}`" class="pz-part" v-bind="box(p)" rx="3" />
              <rect v-for="(m, k) in u.marks" :key="`m${k}`" :class="level === 'cu' ? 'pz-lane' : 'pz-tick'" v-bind="box(m)" :rx="level === 'cu' ? 1.5 : 0" />
              <template v-if="u.reg">
                <rect class="pz-store" v-bind="box(u.reg)" rx="2" :fill="`url(#${hatchId})`" />
                <text v-if="level === 'cu'" class="pz-label is-small" :x="u.reg.x + 6" :y="u.reg.y + u.reg.h - 3.5">寄存器</text>
              </template>
              <text
                v-if="u.name"
                class="pz-label"
                :class="{ 'is-strong': level === 'cu', 'is-small': level === 'simd', 'is-center': level === 'simd' }"
                :x="u.name.x"
                :y="u.name.y"
              >{{ u.name.text }}</text>
            </g>

            <!-- lane：寄存器里的一次加法 -->
            <template v-if="level === 'lane'">
              <text class="pz-label" :x="laneParts.head.x" :y="laneParts.head.y">寄存器（这个 lane 手边的工具台）</text>
              <g v-for="r in laneParts.regs" :key="r.name">
                <rect class="pz-store" v-bind="box(r.box)" rx="8" :fill="`url(#${hatchId})`" />
                <text class="pz-label is-code is-center" :x="r.box.x + r.box.w / 2" :y="r.box.y + r.box.h / 2 + 5">{{ r.name }}</text>
              </g>
              <text v-for="o in laneParts.ops" :key="o.text" class="pz-label is-op is-center" :x="o.x" :y="o.y">{{ o.text }}</text>
              <text v-for="(a, i) in laneParts.arrows" :key="`t${i}`" class="pz-label is-faint" :x="a.x + 8" :y="a.labelY">{{ a.up ? '读' : '写' }}</text>

              <rect class="pz-ghost" v-bind="box(layout.below)" rx="10" />
              <text class="pz-label is-faint" :x="layout.below.x + 10" :y="layout.below.y + 13">显存</text>
              <g v-for="m in laneParts.mem" :key="m.name">
                <rect class="pz-cell" v-bind="box(m.box)" rx="6" />
                <text class="pz-label is-code is-center" :x="m.box.x + m.box.w / 2" :y="m.box.y + m.box.h / 2 + 5">{{ m.name }}</text>
              </g>
              <g v-for="(a, i) in laneParts.arrows" :key="`a${i}`" class="pz-arrow" :class="a.up ? 'is-read' : 'is-write'">
                <line :x1="a.x" :x2="a.x" :y1="a.from + (a.up ? -2 : 2)" :y2="a.to + (a.up ? 8 : -8)" />
                <path :d="a.up ? `M${a.x - 5} ${a.to + 9} L${a.x} ${a.to + 1} L${a.x + 5} ${a.to + 9} Z` : `M${a.x - 5} ${a.to - 9} L${a.x} ${a.to - 1} L${a.x + 5} ${a.to - 9} Z`" />
              </g>
            </template>
          </g>
        </Transition>
      </svg>

      <div class="pz__side">
        <ol class="pz__ladder" aria-label="每一层有几个">
          <li v-for="row in ladder" :key="row.level" :class="{ 'is-current': row.level === level }">
            <span>{{ row.name }}</span><b>{{ row.count }}</b>
          </li>
        </ol>
        <div class="pz__read" aria-live="polite">
          <p class="pz__read-title">{{ reading.title }}</p>
          <ul>
            <li v-for="(line, i) in reading.lines" :key="i">{{ line }}</li>
          </ul>
          <p class="pz__next">{{ reading.next }}</p>
        </div>
      </div>
    </div>

    <details class="pz__facts">
      <summary>这些数从哪来</summary>
      <ul>
        <li v-for="fact in spec.facts" :key="fact.label">
          <span class="pz__fact-name">{{ fact.label }}</span>
          <span class="pz__fact-value">{{ fact.text }}</span>
          <span class="pz__fact-from">
            <a v-if="fact.url" :href="fact.url" target="_blank" rel="noopener">{{ fact.from }}</a><template v-else>{{ fact.from }}</template><template v-if="fact.where">：{{ fact.where }}</template>
          </span>
        </li>
      </ul>
      <p>图里只画了和计算有关的部件，位置和大小比例都是示意，不是芯片的真实版图。</p>
    </details>
  </section>
</template>

<style scoped>
.pz {
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

.pz__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.pz__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.pz__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.pz__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

/* ---------- 画的是哪张卡（L-07）：标签 + 一句出处 + 换卡按钮；窄屏时按钮折到下一行 ---------- */

.pz__source {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 12px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* 你的卡：强调区域底色（01 第 2 节），标签用强调色的文字色；本书的卡：虚线框、浅灰底。 */
.pz__source.is-mine {
  border-style: solid;
  background: var(--hg-accent-soft);
}

.pz__source-tag {
  flex: none;
  padding: 1px 10px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.pz__source.is-mine .pz__source-tag {
  color: var(--hg-accent-ink);
}

.pz__source-text {
  flex: 1 1 16em;
  min-width: 0;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.6;
}

.pz__source-text a {
  white-space: nowrap;
}

/* ---------- 面包屑 + 缩小一层 ---------- */

.pz__crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}

.pz__crumbs ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pz__crumbs li {
  display: flex;
  align-items: center;
}

.pz__crumbs li + li::before {
  content: '›';
  margin: 0 6px;
  color: var(--hg-ink-3);
}

.pz__crumb {
  padding: 2px 6px;
  border: 0;
  border-radius: var(--hg-radius-tag);
  background: none;
  color: var(--hg-accent-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.pz__crumb:hover {
  text-decoration: underline;
}

.pz__crumb.is-current {
  color: var(--hg-ink);
  cursor: default;
}

.pz__button {
  min-height: 34px;
  padding: 0 12px;
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

.pz__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.pz__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.pz__crumb:focus-visible,
.pz__button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* ---------- 画面 + 解读：宽屏左右，窄屏上下 ---------- */

.pz__body {
  display: grid;
  gap: 16px;
}

@media (min-width: 760px) {
  .pz__body {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    align-items: start;
  }
}

.pz__stage {
  display: block;
  width: 100%;
  height: auto;
  overflow: hidden;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.pz__stage.is-wide {
  aspect-ratio: 400 / 280;
}

.pz__stage.is-narrow {
  aspect-ratio: 320 / 400;
}

/* 放大、缩小：以 (--pz-ox, --pz-oy) 为中心缩放（panorama.ts 的 zoomFrame），时长 --motion-slow，减弱动效时归零。 */
.pz-level {
  transform-box: view-box;
  transform-origin: var(--pz-ox) var(--pz-oy);
}

.pz-in-enter-active,
.pz-in-leave-active,
.pz-out-enter-active,
.pz-out-leave-active {
  transition:
    transform var(--motion-slow) var(--motion-ease-in-out),
    opacity var(--motion-slow) var(--motion-ease-in-out);
}

.pz-in-enter-from,
.pz-out-leave-to {
  opacity: 0;
  transform: scale(var(--pz-sx), var(--pz-sy));
}

.pz-in-leave-to,
.pz-out-enter-from {
  opacity: 0;
  transform: scale(var(--pz-isx), var(--pz-isy));
}

.pz-frame {
  fill: var(--hg-surface);
  stroke: var(--hg-border-strong);
  stroke-width: 1.2;
}

.pz-ghost {
  fill: none;
  stroke: var(--hg-border-strong);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.pz-wire {
  stroke: var(--hg-border-strong);
  stroke-width: 1.5;
}

.pz-store {
  stroke: var(--hg-border-strong);
  stroke-width: 1;
}

.pz-hatch__bg {
  fill: var(--hg-surface-2);
}

.pz-hatch__line {
  stroke: var(--hg-border);
  stroke-width: 2;
}

.pz-banner {
  fill: var(--hg-surface-2);
  stroke: var(--hg-border-strong);
  stroke-width: 1;
}

.pz-cell {
  fill: var(--hg-surface);
  stroke: var(--hg-border-strong);
  stroke-width: 1;
}

.pz-unit {
  cursor: pointer;
  outline: none;
}

.pz-unit__box {
  fill: var(--hg-surface);
  stroke: var(--hg-border-strong);
  stroke-width: 1;
  transition: stroke var(--motion-fast) var(--motion-ease-out), fill var(--motion-fast) var(--motion-ease-out);
}

.pz-unit:hover .pz-unit__box {
  fill: var(--hg-accent-soft);
  stroke: var(--hg-accent);
}

/* 键盘焦点：外框加粗变成强调色（SVG 里的 outline 各浏览器画得不一样，改画在框上）。 */
.pz-unit:focus-visible .pz-unit__box {
  fill: var(--hg-accent-soft);
  stroke: var(--hg-accent-ink);
  stroke-width: 2.5;
}

.pz-part {
  fill: var(--hg-surface-2);
  stroke: var(--hg-border-strong);
  stroke-width: 0.8;
}

.pz-tick {
  fill: var(--hg-ink-3);
  opacity: 0.55;
}

.pz-lane {
  fill: var(--hg-surface-2);
  stroke: var(--hg-ink-3);
  stroke-width: 0.8;
}

.pz-label {
  fill: var(--hg-ink-2);
  font-family: var(--hg-font-body);
  font-size: 11px;
}

.pz-label.is-title {
  fill: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 700;
}

.pz-label.is-strong {
  fill: var(--hg-ink);
  font-weight: 600;
}

.pz-label.is-mono {
  fill: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-weight: 500;
}

.pz-label.is-small {
  font-size: 9.5px;
}

.pz-label.is-faint {
  fill: var(--hg-ink-3);
}

.pz-label.is-code {
  fill: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

.pz-label.is-op {
  fill: var(--hg-ink-2);
  font-family: var(--hg-font-display);
  font-size: 18px;
  font-weight: 700;
}

.pz-label.is-center {
  text-anchor: middle;
}

.pz-arrow line {
  stroke: var(--hg-ink-3);
  stroke-width: 1.5;
}

.pz-arrow path {
  fill: var(--hg-ink-3);
}

.pz-arrow.is-write line {
  stroke-dasharray: 5 4;
}

/* ---------- 右边：每层几个 + 这一层的解读 ---------- */

.pz__side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.pz__ladder {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pz__ladder li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font-size: 13px;
}

.pz__ladder b {
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-weight: 700;
}

.pz__ladder li.is-current {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

.pz__read {
  padding: 12px 14px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.pz__read-title {
  margin: 0 0 6px;
  font-weight: 700;
}

.pz__read ul {
  margin: 0;
  padding-left: 1.2em;
}

.pz__read li {
  margin: 4px 0;
  color: var(--hg-ink);
  font-size: 15px;
}

.pz__next {
  margin: 8px 0 0;
  color: var(--hg-accent-ink);
  font-size: 14px;
  font-weight: 600;
}

/* ---------- 出处 ---------- */

.pz__facts {
  font-size: 13px;
}

.pz__facts summary {
  color: var(--hg-ink-2);
  font-weight: 600;
  cursor: pointer;
}

.pz__facts summary:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.pz__facts ul {
  margin: 8px 0;
  padding: 0;
  list-style: none;
}

.pz__facts li {
  display: flex;
  flex-wrap: wrap;
  gap: 0 8px;
  padding: 4px 0;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
}

.pz__fact-name {
  color: var(--hg-ink-2);
}

.pz__fact-value {
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-weight: 700;
}

.pz__fact-from {
  flex-basis: 100%;
  min-width: 0;
  color: var(--hg-ink-3);
  overflow-wrap: anywhere;
}

.pz__facts p {
  margin: 6px 0 0;
  color: var(--hg-ink-3);
}

@media (max-width: 639px) {
  .pz {
    padding: 16px 14px;
  }
}
</style>
