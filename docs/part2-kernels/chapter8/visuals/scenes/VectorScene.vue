<script setup lang="ts">
import { computed } from 'vue'
import { easeInOutCubic, lerp, seg, segE } from '../easing'

/**
 * 8.4.5 float4 与尾部：N=18 个 FP32 在源码中重解释为 4 个 float4 组 + 标量尾部。
 * 字节标尺体现 16B 对齐；结尾强调「源码重解释 ≠ 物理显存事务一定减少」。
 */
const props = defineProps<{ step: number; local: number }>()

const N = 18
const GROUPS = [0, 1, 2, 3]
const TAIL = [16, 17]

const STRIP_X = 74
const PITCH = 32
const GAP = 4
const CELL_W = PITCH - GAP
const STRIP_Y = 150
const H = 44
const SLOT_Y = 54
const SLOT_H = 40

const cellX = (index: number) => STRIP_X + index * PITCH
const cellCx = (index: number) => cellX(index) + CELL_W / 2
const slotX = (group: number) => STRIP_X + group * 4 * PITCH

/** 每格入场 */
function cellBuild(index: number): number {
  return props.step === 0 ? segE(props.local, 60 + index * 35, 340 + index * 35) : 1
}

/** 第 1 步：第 j 组的 4 格打包飞入 float4 槽 */
function tokenP(group: number): number {
  if (props.step < 1) return 0
  if (props.step === 1) return easeInOutCubic(seg(props.local, 250 + group * 260, 900 + group * 260))
  return 1
}

/** 已打包的格子留下淡影 */
function groupedCellE(index: number): number {
  if (props.step < 1 || index >= 16) return 1
  const group = Math.floor(index / 4)
  return lerp(1, 0.22, seg(tokenP(group), 0.08, 0.5))
}

const slotsFilled = computed(() => GROUPS.map(group => seg(tokenP(group), 0.75, 1)))

const tailE = computed(() => (props.step > 2 ? 1 : props.step === 2 ? segE(props.local, 0, 400) : 0))
const tailChipE = computed(() => (props.step > 2 ? 1 : props.step === 2 ? segE(props.local, 300, 700) : 0))

const endMsgE = computed(() => (props.step >= 3 ? segE(props.local, 200, 700) : 0))
const endSubE = computed(() => (props.step >= 3 ? segE(props.local, 450, 950) : 0))

const RULER_TICKS = [0, 4, 8, 12, 16, 18]
</script>

<template>
  <g>
    <text x="74" y="26" dominant-baseline="central" font-size="11.5" font-weight="600" fill="var(--ej-ink-soft)">
      输入 A · N = 18 个 FP32 · 每个占 4 Byte
    </text>

    <!-- float4 槽 -->
    <g v-for="group in GROUPS" :key="`slot-${group}`">
      <rect
        :x="slotX(group)"
        :y="SLOT_Y"
        width="124"
        :height="SLOT_H"
        rx="9"
        :fill="slotsFilled[group] ? 'var(--ej-a-soft)' : 'var(--ej-surface)'"
        :stroke="slotsFilled[group] ? 'var(--ej-a)' : 'var(--ej-line-strong)'"
        :stroke-width="slotsFilled[group] ? 1.6 : 1"
        :stroke-dasharray="slotsFilled[group] ? undefined : '5 4'"
        :opacity="props.step >= 1 ? 1 : 0"
      />
      <text
        :x="slotX(group) + 62"
        :y="SLOT_Y + 20"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="10.5"
        :font-weight="slotsFilled[group] ? 700 : 500"
        :fill="slotsFilled[group] ? 'var(--ej-a)' : 'var(--ej-ink-faint)'"
        :opacity="props.step >= 1 ? 1 : 0"
      >float4 v{{ group }}</text>
    </g>

    <!-- 飞行中的 float4 块 -->
    <g v-for="group in GROUPS" :key="`token-${group}`" :opacity="props.step === 1 && tokenP(group) > 0 ? 1 : 0">
      <rect
        v-if="props.step === 1 && tokenP(group) > 0"
        :x="slotX(group)"
        :y="lerp(STRIP_Y, SLOT_Y, tokenP(group))"
        width="124"
        :height="lerp(H, SLOT_H, tokenP(group))"
        rx="9"
        fill="var(--ej-a-soft)"
        stroke="var(--ej-a)"
        stroke-width="1.4"
        :opacity="1 - seg(tokenP(group), 0.9, 1)"
      />
    </g>

    <!-- 18 个标量格 -->
    <g v-for="index in N" :key="`cell-${index}`" :opacity="cellBuild(index - 1)">
      <rect
        :x="cellX(index - 1)"
        :y="STRIP_Y"
        :width="CELL_W"
        :height="H"
        rx="6"
        fill="var(--ej-surface)"
        stroke="var(--ej-line)"
        stroke-width="1"
        :opacity="groupedCellE(index - 1)"
      />
      <rect
        v-if="index - 1 >= 16"
        :x="cellX(index - 1)"
        :y="STRIP_Y"
        :width="CELL_W"
        :height="H"
        rx="6"
        fill="var(--ej-active-soft)"
        stroke="var(--ej-active)"
        stroke-width="1.6"
        :opacity="tailE"
      />
      <text
        :x="cellCx(index - 1)"
        :y="STRIP_Y + 22"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="12"
        font-weight="600"
        fill="var(--ej-ink)"
        :opacity="Math.max(groupedCellE(index - 1), index - 1 >= 16 ? tailE : 0)"
      >{{ index - 1 }}</text>
    </g>

    <!-- 字节标尺 -->
    <line :x1="STRIP_X" y1="122" :x2="STRIP_X + 18 * PITCH" y2="122" stroke="var(--ej-line-strong)" stroke-width="1" />
    <g v-for="tick in RULER_TICKS" :key="`tick-${tick}`">
      <line :x1="STRIP_X + tick * PITCH" y1="122" :x2="STRIP_X + tick * PITCH" y2="129" stroke="var(--ej-line-strong)" stroke-width="1" />
      <text :x="STRIP_X + tick * PITCH" y="138" text-anchor="middle" font-size="9.5" fill="var(--ej-ink-faint)">{{ tick * 4 }}</text>
    </g>
    <text :x="STRIP_X + 18 * PITCH + 14" y="138" font-size="9.5" fill="var(--ej-ink-faint)">Byte</text>

    <!-- 标量尾部路径 -->
    <g :opacity="tailChipE">
      <path
        :d="`M ${cellCx(TAIL[0])} 198 V 206 H ${cellCx(TAIL[1])} V 198 M ${(cellCx(TAIL[0]) + cellCx(TAIL[1])) / 2} 206 V 242`"
        fill="none"
        stroke="var(--ej-active)"
        stroke-width="1.4"
        stroke-dasharray="4 3"
        :opacity="tailChipE"
      />
      <rect x="530" y="242" width="146" height="40" rx="8" fill="var(--ej-active-soft)" stroke="var(--ej-active)" stroke-width="1.2" />
      <text x="548" y="256" dominant-baseline="central" font-size="11.5" font-weight="600" fill="var(--ej-active)">标量路径</text>
      <text x="548" y="278" font-size="9" fill="var(--ej-ink-soft)">A[16]、A[17] 逐个处理</text>
    </g>

    <!-- 收束语 -->
    <g :opacity="endMsgE">
      <text x="330" y="306" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="600" fill="var(--ej-ink)">
        float4 是源码类型重解释 ≠ 物理显存事务一定减少
      </text>
    </g>
    <g :opacity="endSubE">
      <text x="330" y="326" text-anchor="middle" dominant-baseline="central" font-size="10.5" fill="var(--ej-ink-soft)">
        输入 B 的读取与输出 C 的写回采用同样分组
      </text>
    </g>
  </g>
</template>
