<script setup lang="ts">
/**
 * 线程小机器人：小核的缩小版，一个机器人 = 一个线程（01 第 5 节、第 7 节）。
 * 颜色全部走 tokens.css 的 --hg-art-* 和 --hg-group-* 变量。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <ThreadBot state="write" label="5" color="1" />
 *   <ThreadBot state="oob" label="197" />
 *
 * 五种状态都有形状差别，不靠颜色区分（01 第 7 节）：
 *   写入 = 抱着数据块；检查后跳过 = 熄屏闭眼 + 头顶 z；越界 = 倾斜 12° + 红屏 + 叹号；
 *   重复计算 = ×2 标；等待同步 = 举手。每个机器人都有 aria-label。
 */
import { computed } from 'vue'

type BotState = 'write' | 'skip' | 'oob' | 'dup' | 'sync'

const props = withDefaults(defineProps<{
  /** 状态：write 写入、skip 检查后跳过、oob 越界、dup 重复计算、sync 等待同步。 */
  state?: BotState
  /** 底部色条 = 所在线程块的分类色：组号 0–5（超过循环）、--hg-group-2 这样的 token 名，或任意 CSS 颜色。 */
  color?: string | number
  /** 屏幕下方显示的线程号（threadIdx.x），同时写进 aria-label。 */
  label?: string | number
  /** 画多大：预设 sm 36 / md 60 / lg 84（指宽度），或直接写像素数。 */
  size?: number | 'sm' | 'md' | 'lg'
}>(), { state: 'write', color: 0, label: '', size: 'md' })

const SIZES = { sm: 36, md: 60, lg: 84 }
const RATIO = 68 / 60 // viewBox 的高宽比

const STATES: Record<BotState, { name: string; detail: string }> = {
  write: { name: '写入', detail: '下标在数组里，抱着数据块去放' },
  skip: { name: '检查后跳过', detail: '加了 if (i < n)，屏幕熄灭待机' },
  oob: { name: '越界', detail: '下标超出数组，屏幕报警' },
  dup: { name: '重复计算', detail: '和别的线程写同一个格子' },
  sync: { name: '等待同步', detail: '到了同步点，举手等同伴' },
}

const width = computed(() => {
  const s = props.size
  if (typeof s === 'number' && s > 0) return s
  if (typeof s === 'string' && s in SIZES) return SIZES[s as keyof typeof SIZES]
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : SIZES.md
})
const height = computed(() => Math.round(width.value * RATIO))

/** 分类色：数字按 blockIdx % 6 取 --hg-group-N，`--x` 当 token 名，其余当 CSS 颜色。 */
const stripe = computed(() => {
  const c = props.color
  if (typeof c === 'number') return `var(--hg-group-${((c % 6) + 6) % 6})`
  const t = String(c).trim()
  if (t === '') return 'var(--hg-group-0)'
  if (/^\d+$/.test(t)) return `var(--hg-group-${Number(t) % 6})`
  if (t.startsWith('--')) return `var(${t})`
  return t
})

const text = computed(() => String(props.label ?? ''))
const label = computed(() => {
  const s = STATES[props.state] ?? STATES.write
  const who = text.value === '' ? '线程机器人' : `线程 ${text.value}`
  return `${who}：${s.name}，${s.detail}`
})
</script>

<template>
  <svg
    class="hg-bot"
    :class="`hg-bot--${state}`"
    :style="{ '--bot-group': stripe }"
    :width="width"
    :height="height"
    viewBox="0 0 60 68"
    role="img"
    :aria-label="label"
  >
    <ellipse class="b-shadow" cx="28" cy="65" rx="15" ry="2.5" />

    <!-- 越界时整个身子倾斜 12°（叹号、z、×2 标不跟着转） -->
    <g :transform="state === 'oob' ? 'rotate(12 28 34)' : undefined">
      <path class="b-line" d="M28 13 V7" stroke-width="1.6" stroke-linecap="round" />
      <circle class="b-lamp" cx="28" cy="5.5" r="3" stroke-width="1.3" />

      <rect class="b-metal" x="8" y="30" width="6" height="4" rx="2" stroke-width="1.3" />
      <rect class="b-metal" x="42" y="30" width="6" height="4" rx="2" stroke-width="1.3" />
      <rect class="b-metal" x="18" y="55" width="7" height="7" rx="2.5" stroke-width="1.4" />
      <rect class="b-metal" x="31" y="55" width="7" height="7" rx="2.5" stroke-width="1.4" />

      <rect class="b-body" x="13" y="13" width="30" height="44" rx="10" stroke-width="1.8" />
      <!-- 底部色条 = 所在线程块 -->
      <path class="b-stripe" d="M13 47 H43 Q43 57 33 57 H23 Q13 57 13 47 Z" stroke-width="1.8" />

      <rect class="b-screen" x="17" y="18" width="22" height="16" rx="5" />
      <g v-if="state !== 'skip'">
        <rect class="b-eye" x="21.5" y="22" width="4" height="7" rx="2" />
        <rect class="b-eye" x="30.5" y="22" width="4" height="7" rx="2" />
      </g>
      <path v-else class="b-eye-closed" d="M21 26.5h5M30 26.5h5" stroke-width="1.8" stroke-linecap="round" />

      <text v-if="text" class="b-label" x="28" y="44" text-anchor="middle" font-size="9">{{ text }}</text>

      <!-- 写入 / 重复计算：抱着的数据块 -->
      <g v-if="state === 'write' || state === 'dup'">
        <path class="b-box-top" d="M44 34 l6 -3 l6 3 l-6 3 z" stroke-width="1.2" stroke-linejoin="round" />
        <path class="b-box-left" d="M44 34 v7 l6 3 v-7 z" stroke-width="1.2" stroke-linejoin="round" />
        <path class="b-box-right" d="M56 34 v7 l-6 3 v-7 z" stroke-width="1.2" stroke-linejoin="round" />
      </g>

      <!-- 等待同步：举起的手 -->
      <g v-else-if="state === 'sync'">
        <path class="b-line" d="M8 31 L3 21" stroke-width="2" stroke-linecap="round" />
        <circle class="b-metal" cx="3" cy="20" r="2.4" stroke-width="1.3" />
      </g>
    </g>

    <!-- 越界：红色叹号 -->
    <g v-if="state === 'oob'">
      <circle class="b-alert" cx="49" cy="10" r="7" />
      <path class="b-alert-mark" d="M49 6v5" stroke-width="2" stroke-linecap="round" />
      <circle class="b-alert-dot" cx="49" cy="14" r="1.2" />
    </g>

    <!-- 检查后跳过：头顶的 z -->
    <g v-else-if="state === 'skip'">
      <text class="b-zzz" x="44" y="13" font-size="9">z</text>
      <text class="b-zzz" x="50" y="7" font-size="7">z</text>
    </g>

    <!-- 重复计算：×2 标 -->
    <g v-else-if="state === 'dup'">
      <rect class="b-dup" x="40" y="3" width="18" height="11" rx="5.5" />
      <text class="b-dup-text" x="49" y="11.5" text-anchor="middle" font-size="8">×2</text>
    </g>
  </svg>
</template>

<style scoped>
/*
 * 配色（tokens.css 的 --hg-art-*）：--bot-group 由 color 属性写在行内，
 * 各状态只改 --bot-* 这一层，所以状态变化可以直接用颜色过渡。
 */
.hg-bot {
  --bot-stripe: var(--bot-group, var(--hg-group-0));
  --bot-lamp: var(--hg-art-antenna-on);
  --bot-screen: var(--hg-art-screen);
  --bot-eye: var(--hg-art-led);

  display: block;
  overflow: visible;
}

.hg-bot--skip {
  --bot-stripe: var(--hg-art-skip-stripe);
  --bot-lamp: var(--hg-art-led-off);
  --bot-screen: var(--hg-art-screen-top);
}

.hg-bot--oob {
  --bot-lamp: var(--hg-art-alert);
  --bot-screen: var(--hg-art-screen-alert);
  --bot-eye: var(--hg-art-led-alert);
}

.hg-bot--dup {
  --bot-lamp: var(--hg-art-amber);
  --bot-eye: var(--hg-art-gold);
}

.hg-bot--sync {
  --bot-lamp: var(--hg-art-sync);
}

.b-shadow { fill: var(--hg-art-shadow); }
.b-line { fill: none; stroke: var(--hg-art-line); }
.b-metal { fill: var(--hg-art-metal); stroke: var(--hg-art-line); }
.b-body { fill: var(--hg-art-white); stroke: var(--hg-art-line); }
.b-eye-closed { fill: none; stroke: var(--hg-art-led-off); }
.b-box-top { fill: var(--hg-art-bulb); stroke: var(--hg-art-line); }
.b-box-left { fill: var(--hg-art-gold); stroke: var(--hg-art-line); }
.b-box-right { fill: var(--hg-art-amber); stroke: var(--hg-art-line); }
.b-alert { fill: var(--hg-art-alert); }
.b-alert-mark { fill: none; stroke: var(--hg-art-white); }
.b-alert-dot { fill: var(--hg-art-white); }
.b-dup { fill: var(--hg-art-amber); }

.b-label,
.b-dup-text {
  fill: var(--hg-art-line);
  font-family: var(--hg-font-mono);
  font-weight: 700;
}

.b-zzz {
  fill: var(--hg-art-zzz);
  font-family: var(--hg-font-mono);
  font-weight: 700;
}

/* 状态过渡（02 第 1 节）：200–300 ms 的颜色变化；减弱动效时时长 token 归零，直接切换。 */
.b-lamp,
.b-screen,
.b-eye,
.b-stripe {
  transition: fill var(--motion-base) var(--motion-ease-out);
}

.b-lamp { fill: var(--bot-lamp); stroke: var(--hg-art-line); }
.b-screen { fill: var(--bot-screen); }
.b-eye { fill: var(--bot-eye); }
.b-stripe { fill: var(--bot-stripe); stroke: var(--hg-art-line); }
</style>
