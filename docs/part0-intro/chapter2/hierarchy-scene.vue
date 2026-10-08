<script setup lang="ts">
import { computed } from 'vue'
import { lerp, segE } from '../../components/animation/easing'
import { DEMO_THREADS, identifyThread } from './hierarchy-model'

const props = defineProps<{
  step: number
  local: number
  compact: boolean
  reducedMotion: boolean
  selectedBlock: number
  selectedThread: number
  showDetails: boolean
}>()

type Box = { x: number; y: number; w: number; h: number }
type Tile = Box & { opacity: number }
const width = computed(() => props.compact ? 400 : 720)
const height = computed(() => props.compact ? 520 : 440)
const selected = computed(() => identifyThread(props.selectedBlock, props.selectedThread))
const enter = computed(() => props.reducedMotion ? 1 : segE(props.local, 0, 850))
const reveal = computed(() => props.step === 0 || props.reducedMotion ? 1 : segE(props.local, 500, 1000))
const sumReady = computed(() => props.step === 4 && props.local >= 2900)
const adding = computed(() => props.step === 4 && props.local >= 1400 && !sumReady.value)

function overviewBox(block: number): Box {
  return props.compact
    ? { x: 34, y: 72 + block * 188, w: 332, h: 170 }
    : { x: 34 + block * 338, y: 78, w: 314, h: 286 }
}

function blockBox(): Box {
  return { x: 20, y: 68, w: width.value - 40, h: height.value - 120 }
}

function waveBox(wave: number, zoom = false): Box {
  if (zoom) return blockBox()
  const h = (height.value - 160) / 2
  return { x: 32, y: 96 + wave * (h + 12), w: width.value - 64, h }
}

function cells(box: Box, index: number, count: number, columns: number, top: number, bottom = 12): Box {
  const dx = (box.w - 24) / columns
  const dy = (box.h - top - bottom) / Math.ceil(count / columns)
  return { x: box.x + 12 + (index % columns) * dx + 3, y: box.y + top + Math.floor(index / columns) * dy + 3, w: dx - 6, h: dy - 6 }
}

function tileAt(stage: number, item: typeof DEMO_THREADS[number]): Tile {
  if (stage === 0) return { ...cells(overviewBox(item.block), item.thread, 64, 8, 46), opacity: 1 }
  if (item.block !== props.selectedBlock) return { ...cells(overviewBox(item.block), item.thread, 64, 8, 46), opacity: 0 }
  if (stage === 1) return { ...cells(blockBox(), item.thread, 64, props.compact ? 8 : 16, 50), opacity: 1 }
  if (stage === 2) return { ...cells(waveBox(item.wave), item.lane, 32, props.compact ? 8 : 16, 38), opacity: 1 }
  if (item.wave !== selected.value.wave) return { ...cells(waveBox(item.wave), item.lane, 32, props.compact ? 8 : 16, 38), opacity: 0 }
  return { ...cells(waveBox(item.wave, true), item.lane, 32, props.compact ? 4 : 8, 54), opacity: 1 }
}

// 同一批线程始终保留相同 key；位置变化是放大观察，不是创建或调度线程。
const tiles = computed(() => DEMO_THREADS.map(item => {
  const from = tileAt(Math.max(0, props.step - 1), item)
  const to = tileAt(props.step, item)
  const p = props.step === 0 ? 1 : enter.value
  return {
    ...item,
    x: lerp(from.x, to.x, p), y: lerp(from.y, to.y, p),
    w: lerp(from.w, to.w, p), h: lerp(from.h, to.h, p),
    opacity: lerp(from.opacity, to.opacity, p),
    selected: item.block === props.selectedBlock && item.thread === props.selectedThread
  }
}))

const breadcrumb = computed(() => !props.showDetails
  ? props.step === 0 ? '本次启动的全部线程' : props.step < 3 ? '整个任务 › 一个线程块' : '整个任务 › 一个块 › 一个执行小组'
  : props.step === 0 ? 'Grid · 本次启动的全部线程'
  : props.step < 3 ? `Grid › Block ${props.selectedBlock}`
  : `Grid › Block ${props.selectedBlock} › wavefront ${selected.value.wave}`)
const footer = computed(() => (props.showDetails ? [
  `蓝框始终跟踪：Block ${props.selectedBlock} 的线程 ${props.selectedThread}`,
  '格子内的数字是块内线程号，仍是原来的 64 个线程',
  '64 个线程 = 2 个 wavefront × 每组 32 个线程',
  `同一份工作：线程 ${props.selectedThread}，位置是 lane ${selected.value.lane}`,
  sumReady.value ? `线程 ${props.selectedThread}：${selected.value.a} + ${selected.value.b} = ${selected.value.sum}` : '先观察各线程已经拿到的两个数'
] : [
  '蓝框持续跟踪同一个线程',
  '放大一个块，仍是原来的 64 个线程',
  '每组 32 个线程，一个块里有两个执行小组',
  '每个格子里是这个线程取得的两个数',
  sumReady.value ? '同样做加法，各自得到结果' : '一组线程即将共同执行加法'
])[props.step])

const stageTitle = computed(() => props.step === 3
  ? props.showDetails ? '一个线程，占据一个 lane 位置' : '各线程已经拿到的数据'
  : sumReady.value ? '各自得到结果' : adding.value ? '同一条加法指令，32 个位置共同参与' : '各线程已取得的操作数')

function fill(item: typeof tiles.value[number]) {
  if (props.step === 4 && sumReady.value) return 'var(--ej-c-soft)'
  if (props.step === 4 && adding.value) return 'var(--ej-a-soft)'
  return item.selected ? 'var(--ej-a-soft)' : 'var(--ej-bg)'
}
</script>

<template>
  <g font-family="inherit" :data-hierarchy-step="step" :data-selected-thread="selectedThread" :data-selected-wave="selected.wave" :data-selected-lane="selected.lane">
    <text x="20" y="30" :font-size="compact ? 15 : 18" font-weight="600" fill="var(--ej-ink)">{{ breadcrumb }}</text>

    <g v-if="step === 0">
      <rect x="16" y="46" :width="width - 32" :height="height - 92" rx="8" fill="none" stroke="var(--ej-line-strong)" stroke-dasharray="6 4" />
      <g v-for="block in [0, 1]" :key="block">
        <rect :x="overviewBox(block).x" :y="overviewBox(block).y" :width="overviewBox(block).w" :height="overviewBox(block).h" rx="7" fill="var(--ej-panel)" :stroke="block === selectedBlock ? 'var(--ej-active)' : 'var(--ej-line-strong)'" />
        <text :x="overviewBox(block).x + 16" :y="overviewBox(block).y + 28" :font-size="compact ? 16 : 19" font-weight="600" fill="var(--ej-ink)">{{ showDetails ? `Block ${block}` : '线程块' }} · 64 个线程</text>
      </g>
    </g>

    <g v-else :opacity="reveal">
      <rect v-if="step < 3" x="20" y="68" :width="width - 40" :height="height - 120" rx="8" fill="var(--ej-panel)" stroke="var(--ej-line-strong)" />
      <g v-if="step === 1">
        <text x="36" y="100" :font-size="compact ? 17 : 20" font-weight="600" fill="var(--ej-ink)">{{ showDetails ? `Block ${selectedBlock}` : '这个块' }} 的 64 个线程</text>
      </g>
      <g v-if="step === 2">
        <g v-for="wave in [0, 1]" :key="wave">
          <rect :x="waveBox(wave).x" :y="waveBox(wave).y" :width="waveBox(wave).w" :height="waveBox(wave).h" rx="6" :fill="wave === selected.wave ? 'var(--ej-a-soft)' : 'var(--ej-surface)'" :stroke="wave === selected.wave ? 'var(--ej-a)' : 'var(--ej-line-strong)'" stroke-width="1.5" />
          <text :x="waveBox(wave).x + 14" :y="waveBox(wave).y + 25" :font-size="compact ? 15 : 18" font-weight="600" fill="var(--ej-ink)">{{ showDetails ? `wavefront ${wave} · 线程 ${wave * 32}～${wave * 32 + 31}` : '一个执行小组 · 32 个线程' }}</text>
        </g>
      </g>
      <g v-if="step >= 3">
        <rect x="20" y="68" :width="width - 40" :height="height - 120" rx="8" fill="var(--ej-a-soft)" stroke="var(--ej-a)" stroke-width="1.5" />
        <text :x="width / 2" y="99" text-anchor="middle" :font-size="compact ? 16 : 20" font-weight="600" fill="var(--ej-ink)">
          {{ stageTitle }}
        </text>
      </g>
    </g>

    <g v-for="tile in tiles" :key="tile.id" :opacity="tile.opacity" :data-thread="`${tile.block}:${tile.thread}`" :data-wave="tile.wave" :data-lane="tile.lane">
      <rect :x="tile.x" :y="tile.y" :width="tile.w" :height="tile.h" :rx="step === 0 ? 2 : 4" :fill="fill(tile)" :stroke="tile.selected ? 'var(--ej-a)' : (step === 4 && sumReady) ? 'var(--ej-c)' : 'var(--ej-line-strong)'" :stroke-width="tile.selected ? 3 : 1" />
      <text v-if="showDetails && step === 0 && tile.selected" :x="tile.x + tile.w / 2" :y="tile.y + tile.h / 2" text-anchor="middle" dominant-baseline="central" :font-size="compact ? 10 : 13" font-weight="700" fill="var(--ej-a)">{{ tile.thread }}</text>
      <g v-if="step > 0" :opacity="reveal">
        <text v-if="step < 3 && showDetails" :x="tile.x + tile.w / 2" :y="tile.y + tile.h / 2" text-anchor="middle" dominant-baseline="central" :font-size="compact ? 14 : 16" :font-weight="tile.selected ? 700 : 400" :fill="tile.selected ? 'var(--ej-a)' : 'var(--ej-ink)'">{{ tile.thread }}</text>
        <g v-if="step >= 3">
          <text v-if="showDetails" :x="tile.x + tile.w / 2" :y="tile.y + tile.h * .30" text-anchor="middle" dominant-baseline="central" font-size="14" :font-weight="tile.selected ? 700 : 400" fill="var(--ej-ink)">线程 {{ tile.thread }}</text>
          <text :x="tile.x + tile.w / 2" :y="tile.y + tile.h * (showDetails ? .74 : .50)" text-anchor="middle" dominant-baseline="central" :font-size="showDetails ? (compact ? 14 : 15) : (compact ? 15 : 17)" :font-weight="tile.selected || sumReady ? 700 : 400" :fill="sumReady ? 'var(--ej-c)' : tile.selected ? 'var(--ej-a)' : 'var(--ej-ink-soft)'">{{ step === 3 && showDetails ? `lane ${tile.lane}` : sumReady ? `= ${tile.sum}` : `${tile.a} + ${tile.b}` }}</text>
        </g>
      </g>
    </g>

    <g v-if="step > 0" :opacity="reveal">
      <rect :x="width - (compact ? 128 : 158)" y="40" :width="compact ? 108 : 138" height="22" rx="4" fill="var(--ej-panel)" stroke="var(--ej-line-strong)" />
      <text :x="width - (compact ? 74 : 89)" y="55" text-anchor="middle" :font-size="compact ? 11 : 13" fill="var(--ej-ink-soft)">{{ showDetails ? `Block ${1 - selectedBlock}` : '另一个块' }} · 64 线程</text>
    </g>
    <text :x="width / 2" :y="height - 21" text-anchor="middle" :font-size="compact ? 13 : 17" font-weight="500" fill="var(--ej-ink)">{{ footer }}</text>
  </g>
</template>
