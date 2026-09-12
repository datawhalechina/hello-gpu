<script setup lang="ts">
import { computed, useId } from 'vue'
import { segE } from '../easing'

/**
 * 8.1.2 两种编程范式：上方共用问题区（N=6、启动覆盖 0–7），
 * 下方 HIP（thread 拿标量 i）与 Triton（program 拿一块 offsets）双面板，末步逐项对照。
 */
const props = defineProps<{ step: number; local: number }>()

const N = 6
const INDICES = Array.from({ length: 8 }, (_, index) => index)

const STRIP_X = 101
const STRIP_PITCH = 66
const STRIP_W = 56

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const uid = useId()

/* ---------- 顶部问题区 ---------- */

const stripBuild = (index: number) =>
  props.step === 0 ? segE(props.local, 80 + index * 55, 320 + index * 55) : 1

const nLine = computed(() =>
  props.step === 0 ? segE(props.local, 550, 800) : 1
)

/** step1 时 HIP 占用高亮淡入，step2 开头淡出；Triton 同理 */
const stripHipOverlay = computed(() =>
  props.step === 1 ? segE(props.local, 0, 350) : props.step === 2 ? 1 - segE(props.local, 0, 300) : 0
)
const stripTriOverlay = computed(() =>
  props.step === 2 ? segE(props.local, 0, 350) : 0
)

/* ---------- 面板可见度 ---------- */

const hipPanelOpacity = computed(() =>
  props.step === 1 ? 1 : props.step === 2 ? 0.26 : props.step === 3 ? 0 : 0.4
)
const triPanelOpacity = computed(() =>
  props.step === 2 ? 1 : props.step === 1 ? 0.26 : props.step === 3 ? 0 : 0.4
)

/** 面板内部元素只在「自己的步骤」里做入场 stagger，其余步骤保持建成态 */
const hipBuild = computed(() => (props.step === 1 ? 1 : 0))

const hipThreads = computed(() =>
  INDICES.map(index => ({
    index,
    invalid: index >= N,
    e: props.step === 1 ? segE(props.local, 150 + index * 70, 430 + index * 70) : 1
  }))
)

const triPrograms = computed(() =>
  [
    { id: 0, offsets: [0, 1, 2, 3], y: 264 },
    { id: 1, offsets: [4, 5, 6, 7], y: 306 }
  ].map((program, row) => ({
    ...program,
    e: props.step === 2 ? segE(props.local, 150 + row * 200, 430 + row * 200) : 1
  }))
)

/* ---------- 末步对照表 ---------- */

const tableRows = [
  { label: '源码主语', hip: 'thread', tri: 'program' },
  { label: '索引对象', hip: '标量 i', tri: '一块 offsets' },
  { label: '边界保护', hip: 'if (i < N)', tri: 'mask = offsets < N' },
  { label: '启动网格', hip: 'block 组成 grid', tri: 'program 组成 grid' }
]

const tableRowE = (row: number) =>
  props.step === 3 ? segE(props.local, 150 + row * 180, 420 + row * 180) : 0

const tableNoteE = computed(() =>
  props.step === 3 ? segE(props.local, 950, 1300) : 0
)
</script>

<template>
  <g>
    <defs>
      <pattern :id="`${uid}-hatch`" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ej-bad)" stroke-width="1.6" opacity="0.5" />
      </pattern>
    </defs>

    <!-- ============ 顶部问题区：位置 0–7，N=6 ============ -->
    <text x="101" y="14" font-size="11" font-weight="600" fill="var(--ej-ink-soft)">同一道题：C[i] = A[i] + B[i]，启动范围覆盖位置 0–7</text>
    <g v-for="index in INDICES" :key="`strip-${index}`" :opacity="stripBuild(index)">
      <rect
        :x="STRIP_X + index * STRIP_PITCH"
        y="24"
        :width="STRIP_W"
        height="44"
        rx="8"
        :fill="index >= N ? 'var(--ej-bad-soft)' : 'var(--ej-surface)'"
        :stroke="index >= N ? 'var(--ej-bad)' : 'var(--ej-line-strong)'"
        :stroke-dasharray="index >= N ? '4 3' : undefined"
        stroke-width="1.2"
      />
      <rect
        v-if="index >= N"
        :x="STRIP_X + index * STRIP_PITCH"
        y="24"
        :width="STRIP_W"
        height="44"
        rx="8"
        :fill="`url(#${uid}-hatch)`"
      />
      <text
        :x="STRIP_X + index * STRIP_PITCH + STRIP_W / 2"
        y="46"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="13.5"
        font-weight="600"
        :fill="index >= N ? 'var(--ej-ink-soft)' : 'var(--ej-ink)'"
      >{{ index }}{{ index >= N ? ' ✕' : '' }}</text>
      <!-- 拥有者高亮：HIP（青）→ Triton（琥珀）交接 -->
      <rect
        :x="STRIP_X + index * STRIP_PITCH"
        y="24"
        :width="STRIP_W"
        height="44"
        rx="8"
        :fill="index >= N ? 'none' : 'var(--ej-a-soft)'"
        :opacity="index >= N ? 0 : stripHipOverlay"
      />
      <rect
        :x="STRIP_X + index * STRIP_PITCH"
        y="24"
        :width="STRIP_W"
        height="44"
        rx="8"
        fill="none"
        stroke="var(--ej-a)"
        stroke-width="2"
        :opacity="index >= N ? 0 : stripHipOverlay * 0.9"
      />
      <rect
        :x="STRIP_X + index * STRIP_PITCH"
        y="24"
        :width="STRIP_W"
        height="44"
        rx="8"
        :fill="index >= N ? 'none' : 'var(--ej-b-soft)'"
        :opacity="index >= N ? 0 : stripTriOverlay"
      />
      <rect
        :x="STRIP_X + index * STRIP_PITCH"
        y="24"
        :width="STRIP_W"
        height="44"
        rx="8"
        fill="none"
        stroke="var(--ej-b)"
        stroke-width="2"
        :opacity="index >= N ? 0 : stripTriOverlay * 0.9"
      />
    </g>
    <g :opacity="nLine">
      <line :x1="STRIP_X + 6 * STRIP_PITCH - 5" y1="16" :x2="STRIP_X + 6 * STRIP_PITCH - 5" y2="76" stroke="var(--ej-c)" stroke-width="1.8" stroke-dasharray="5 4" />
      <text :x="STRIP_X + 6 * STRIP_PITCH + 3" y="20" font-size="10.5" font-weight="600" fill="var(--ej-c)">N = 6</text>
    </g>

    <!-- ============ HIP 面板 ============ -->
    <g :opacity="hipPanelOpacity">
      <rect x="24" y="104" width="324" height="258" rx="12" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1" />
      <rect x="40" y="118" width="74" height="20" rx="10" fill="var(--ej-a-soft)" stroke="var(--ej-a)" stroke-width="1" />
      <text x="77" y="128" text-anchor="middle" dominant-baseline="central" :font-size="10" font-weight="700" fill="var(--ej-a)">HIP / SIMT</text>
      <text x="324" y="128" text-anchor="end" dominant-baseline="central" font-size="9.5" fill="var(--ej-ink-faint)">blockIdx = 0 · blockDim = 8</text>
      <text x="40" y="158" font-size="13.5" font-weight="600" fill="var(--ej-ink)">每个 thread 执行标量代码</text>
      <text x="40" y="176" font-size="10.5" fill="var(--ej-ink-faint)">Scalar Program · Blocked Threads</text>
      <text x="40" y="196" font-size="11.5" fill="var(--ej-ink-soft)">kernel 正文站在一个 thread：先算出标量下标 i</text>
      <rect x="40" y="206" width="292" height="28" rx="6" fill="var(--ej-surface)" stroke="var(--ej-line)" stroke-width="1" />
      <text x="52" y="220" dominant-baseline="central" :font-size="10" :font-family="MONO" fill="var(--ej-ink)">i = blockIdx.x × blockDim.x + threadIdx.x</text>

      <g v-for="thread in hipThreads" :key="`hip-t-${thread.index}`" :opacity="thread.e">
        <rect
          :x="40 + (thread.index % 4) * 75"
          :y="thread.index < 4 ? 248 : 298"
          width="66"
          height="44"
          rx="8"
          fill="var(--ej-surface)"
          :stroke="thread.invalid ? 'var(--ej-bad)' : 'var(--ej-a)'"
          :stroke-width="thread.invalid ? 1 : 1.4"
          :stroke-dasharray="thread.invalid ? '4 3' : undefined"
        />
        <text
          :x="40 + (thread.index % 4) * 75 + 33"
          :y="thread.index < 4 ? 263 : 313"
          text-anchor="middle"
          font-size="9.5"
          fill="var(--ej-ink-faint)"
        >thread {{ thread.index }}</text>
        <text
          :x="40 + (thread.index % 4) * 75 + 33"
          :y="thread.index < 4 ? 280 : 330"
          text-anchor="middle"
          dominant-baseline="central"
          font-size="11.5"
          font-weight="600"
          :fill="thread.invalid ? 'var(--ej-ink-soft)' : 'var(--ej-a)'"
        >{{ thread.invalid ? 'if = false' : `i = ${thread.index}` }}</text>
      </g>
      <text x="186" y="354" text-anchor="middle" font-size="10.5" fill="var(--ej-ink-soft)">
        <tspan :font-family="MONO">if (i &lt; N)</tspan><tspan>：一个线程保护一个标量位置</tspan>
      </text>
    </g>

    <!-- ============ Triton 面板 ============ -->
    <g :opacity="triPanelOpacity">
      <rect x="372" y="104" width="324" height="258" rx="12" fill="var(--ej-panel)" stroke="var(--ej-line)" stroke-width="1" />
      <rect x="388" y="118" width="58" height="20" rx="10" fill="var(--ej-b-soft)" stroke="var(--ej-b)" stroke-width="1" />
      <text x="417" y="128" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="var(--ej-b)">TRITON</text>
      <text x="672" y="128" text-anchor="end" dominant-baseline="central" font-size="9.5" fill="var(--ej-ink-faint)">grid = (2,) · BLOCK_SIZE = 4</text>
      <text x="388" y="158" font-size="13.5" font-weight="600" fill="var(--ej-ink)">分块 program · 编译器安排线程</text>
      <text x="388" y="176" font-size="10.5" fill="var(--ej-ink-faint)">Blocked Program · Scalar Threads</text>
      <text x="388" y="196" font-size="11.5" fill="var(--ej-ink-soft)">kernel 描述一个 program，一次生成一块 offsets</text>
      <rect x="388" y="206" width="292" height="28" rx="6" fill="var(--ej-surface)" stroke="var(--ej-line)" stroke-width="1" />
      <text x="400" y="220" dominant-baseline="central" :font-size="11" :font-family="MONO" fill="var(--ej-ink)">offsets = pid × 4 + tl.arange(0, 4)</text>
      <rect x="388" y="238" width="292" height="20" rx="6" fill="var(--ej-surface)" stroke="var(--ej-line)" stroke-width="1" :opacity="props.step >= 2 ? 1 : 0" />
      <text x="400" y="248" dominant-baseline="central" :font-size="10.5" :font-family="MONO" fill="var(--ej-b)" :opacity="props.step >= 2 ? 1 : 0">mask = offsets &lt; N</text>

      <g v-for="program in triPrograms" :key="`tri-p-${program.id}`" :opacity="program.e">
        <text x="400" :y="program.y + 17" dominant-baseline="central" font-size="11.5" font-weight="600" fill="var(--ej-ink-soft)">program {{ program.id }}</text>
        <g v-for="(offset, cellIndex) in program.offsets" :key="`tri-${program.id}-${offset}`">
          <rect
            :x="500 + cellIndex * 38"
            :y="program.y"
            width="32"
            height="34"
            rx="7"
            :fill="offset >= N ? 'var(--ej-bad-soft)' : 'var(--ej-b-soft)'"
            :stroke="offset >= N ? 'var(--ej-bad)' : 'var(--ej-b)'"
            :stroke-dasharray="offset >= N ? '4 3' : undefined"
            stroke-width="1.2"
          />
          <rect
            v-if="offset >= N"
            :x="500 + cellIndex * 38"
            :y="program.y"
            width="32"
            height="34"
            rx="7"
            :fill="`url(#${uid}-hatch)`"
          />
          <text
            :x="500 + cellIndex * 38 + 16"
            :y="program.y + 17"
            text-anchor="middle"
            dominant-baseline="central"
            font-size="12.5"
            font-weight="600"
            :fill="offset >= N ? 'var(--ej-ink-soft)' : 'var(--ej-b)'"
          >{{ offset }}{{ offset >= N ? '✕' : '' }}</text>
        </g>
      </g>
      <text x="534" y="354" text-anchor="middle" font-size="10.5" fill="var(--ej-ink-soft)">一个 mask 逐位置保护整块数据</text>
    </g>

    <!-- ============ 末步：逐项对照表 ============ -->
    <g>
      <g :opacity="tableRowE(0)">
        <text x="150" y="136" text-anchor="end" font-size="10.5" fill="var(--ej-ink-faint)">对照维度</text>
        <text x="279" y="136" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ej-a)">HIP · thread</text>
        <text x="558" y="136" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ej-b)">Triton · program</text>
      </g>
      <template v-for="(row, rowIndex) in tableRows" :key="`row-${row.label}`">
        <g :opacity="tableRowE(rowIndex + 1)">
          <text x="150" :y="160 + rowIndex * 50 + 22" text-anchor="end" dominant-baseline="central" font-size="11.5" font-weight="600" fill="var(--ej-ink-soft)">{{ row.label }}</text>
          <rect x="162" :y="160 + rowIndex * 50" width="234" height="44" rx="8" fill="var(--ej-a-soft)" opacity="0.75" />
          <text x="178" :y="160 + rowIndex * 50 + 22" dominant-baseline="central" :font-size="12.5" :font-family="rowIndex > 0 ? MONO : undefined" fill="var(--ej-ink)">{{ row.hip }}</text>
          <rect x="420" :y="160 + rowIndex * 50" width="276" height="44" rx="8" fill="var(--ej-b-soft)" opacity="0.75" />
          <text x="436" :y="160 + rowIndex * 50 + 22" dominant-baseline="central" :font-size="12.5" :font-family="rowIndex > 0 ? MONO : undefined" fill="var(--ej-ink)">{{ row.tri }}</text>
        </g>
      </template>
      <text x="360" y="386" text-anchor="middle" font-size="10.5" fill="var(--ej-ink-soft)" :opacity="tableNoteE">
        blockDim.x 给出每个 block 的 thread 数；BLOCK_SIZE 是逻辑 tile 宽度——tl.arange 不创建线程，执行安排交给编译器
      </text>
    </g>
  </g>
</template>
