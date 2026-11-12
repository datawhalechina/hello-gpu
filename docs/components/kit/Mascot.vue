<script setup lang="ts">
/**
 * 小核：屏幕脸的芯片机器人（01 第 5 节「吉祥物与线程小机器人」）。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <Mascot />                              默认表情，装扮跟随所在区域
 *   <Mascot mood="hint" outfit="helmet" />  给提示 + 铸造城的安全帽
 *   <Mascot mood="cheer" size="lg">太棒了，三颗星到手。</Mascot>   带对话气泡
 *
 * 装扮的解析顺序：outfit 属性 → 页面 frontmatter 的 zone → 最近的 [data-zone] 祖先（由 CSS 完成）。
 * 服务端渲染读不到 DOM，所以祖先区域只用 CSS 判断，水合前后的 HTML 完全一致。
 */
import { computed, onMounted, ref, useId } from 'vue'
import { useData } from 'vitepress'

type Mood = 'default' | 'hint' | 'cheer'
type Outfit = 'default' | 'helmet' | 'visor'

const props = withDefaults(defineProps<{
  /** 表情（设计稿的三种）：default 默认、hint 给提示（头顶小灯泡）、cheer 庆祝（眯眼笑 + 星星）。 */
  mood?: Mood
  /** 装扮：default 默认款、helmet 黄色安全帽、visor 青色护目镜；auto（默认）跟随所在区域。 */
  outfit?: Outfit | 'auto'
  /** 画多大：预设 sm 72 / md 120 / lg 200，或直接写像素数。 */
  size?: number | 'sm' | 'md' | 'lg'
}>(), { mood: 'default', outfit: 'auto', size: 'md' })

const SIZES = { sm: 72, md: 120, lg: 200 }
const MOOD_TEXT: Record<Mood, string> = {
  default: '安静地陪在旁边',
  hint: '给你一个提示',
  cheer: '庆祝一下',
}
const OUTFIT_TEXT: Record<Outfit, string> = {
  default: '默认款',
  helmet: '戴着安全帽',
  visor: '戴着护目镜',
}
/** 01 第 4 节：区域只换小核的配饰（铸造城安全帽、试炼场护目镜），语义色不变。 */
const ZONE_OUTFIT: Record<string, Outfit> = { novice: 'default', forge: 'helmet', trial: 'visor' }

const { frontmatter } = useData()

const px = computed(() => {
  const s = props.size
  if (typeof s === 'number' && s > 0) return s
  if (typeof s === 'string' && s in SIZES) return SIZES[s as keyof typeof SIZES]
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : SIZES.md
})

/** 解析得到的装扮；null 表示交给 CSS 跟随最近的 [data-zone] 祖先。 */
const outfit = computed<Outfit | null>(() => {
  if (props.outfit !== 'auto') return props.outfit
  const zone = frontmatter.value?.zone
  return (typeof zone === 'string' && ZONE_OUTFIT[zone]) || null
})

const label = computed(() => {
  const o = outfit.value
  return o && o !== 'default'
    ? `小核，${OUTFIT_TEXT[o]}，${MOOD_TEXT[props.mood]}`
    : `小核，${MOOD_TEXT[props.mood]}`
})

const uid = useId()
const bodyId = `${uid}-body`
const screenId = `${uid}-screen`

// 设计稿：小核话少，每句不超过 30 个字。开发时超了提醒一下，构建产物里没有这段。
const line = ref<HTMLElement>()
if (import.meta.env.DEV) {
  onMounted(() => {
    const text = (line.value?.textContent ?? '').trim()
    if (text.length > 30) console.warn(`[Mascot] 台词 ${text.length} 字，超过 30 字：${text}`)
  })
}
</script>

<template>
  <div class="hg-mascot" :class="`hg-mascot--${outfit ?? 'auto'}`">
    <div v-if="$slots.default" class="hg-mascot__speech">
      <p ref="line" class="hg-mascot__line"><slot /></p>
    </div>

    <svg class="hg-mascot__art" :width="px" :height="px" viewBox="0 0 120 120" role="img" :aria-label="label">
      <defs>
        <linearGradient :id="bodyId" x1="0" y1="0" x2="0" y2="1">
          <stop class="m-body-a" offset="0" />
          <stop class="m-body-b" offset="1" />
        </linearGradient>
        <linearGradient :id="screenId" x1="0" y1="0" x2="0" y2="1">
          <stop class="m-screen-a" offset="0" />
          <stop class="m-screen-b" offset="1" />
        </linearGradient>
      </defs>

      <ellipse class="m-shadow" cx="60" cy="113" rx="30" ry="4" />

      <g class="hg-mascot__breathe">
        <!-- 天线：光晕 + 杆 + 琥珀色小灯 -->
        <circle class="m-glow" cx="60" cy="9" r="9" />
        <path class="m-wire" d="M60 22 V12" stroke-width="2.5" stroke-linecap="round" />
        <circle class="m-lamp" cx="60" cy="9" r="4.5" stroke-width="2" />

        <!-- 芯片引脚当手，底下两只脚 -->
        <rect class="m-metal" x="13" y="48" width="13" height="5" rx="2.5" stroke-width="2" />
        <rect class="m-metal" x="13" y="60" width="13" height="5" rx="2.5" stroke-width="2" />
        <rect class="m-metal" x="13" y="72" width="13" height="5" rx="2.5" stroke-width="2" />
        <rect class="m-metal" x="94" y="48" width="13" height="5" rx="2.5" stroke-width="2" />
        <rect class="m-metal" x="94" y="60" width="13" height="5" rx="2.5" stroke-width="2" />
        <rect class="m-metal" x="94" y="72" width="13" height="5" rx="2.5" stroke-width="2" />
        <rect class="m-metal" x="40" y="97" width="14" height="11" rx="4" stroke-width="2" />
        <rect class="m-metal" x="66" y="97" width="14" height="11" rx="4" stroke-width="2" />

        <!-- 身体：圆角方块 + 顶部高光 + 下角装饰线 -->
        <rect class="m-outline" x="24" y="22" width="72" height="78" rx="20" :fill="`url(#${bodyId})`" stroke-width="2.5" />
        <path class="m-highlight" d="M36 29 Q60 24 84 29" stroke-width="3" stroke-linecap="round" />
        <path class="m-trim" d="M30 84 H37 V91 M90 84 H83 V91" stroke-width="1.6" stroke-linecap="round" />

        <!-- 屏幕脸 -->
        <rect class="m-outline" x="33" y="35" width="54" height="38" rx="11" :fill="`url(#${screenId})`" stroke-width="2" />

        <g v-if="mood === 'default'" class="hg-mascot__eyes">
          <rect class="m-eye" x="45" y="45" width="8" height="13" rx="4" />
          <rect class="m-eye" x="67" y="45" width="8" height="13" rx="4" />
          <rect class="m-glint" x="47" y="47" width="2.5" height="3.5" rx="1.2" />
          <rect class="m-glint" x="69" y="47" width="2.5" height="3.5" rx="1.2" />
        </g>
        <g v-else-if="mood === 'hint'" class="hg-mascot__eyes">
          <rect class="m-eye" x="49" y="42" width="8" height="11" rx="4" />
          <rect class="m-eye" x="69" y="42" width="8" height="11" rx="4" />
          <rect class="m-glint" x="51" y="44" width="2.5" height="3.5" rx="1.2" />
          <rect class="m-glint" x="71" y="44" width="2.5" height="3.5" rx="1.2" />
        </g>
        <g v-else>
          <path class="m-eye-line" d="M44 54 Q49 46 54 54 M66 54 Q71 46 76 54" stroke-width="3" stroke-linecap="round" />
        </g>

        <circle class="m-blush" cx="40" cy="63" r="2.6" />
        <circle class="m-blush" cx="80" cy="63" r="2.6" />

        <path
          v-if="mood === 'hint'"
          class="m-eye-line"
          d="M55 64 H65"
          stroke-width="2.5"
          stroke-linecap="round"
        />
        <path
          v-else
          class="m-eye-line"
          :d="mood === 'cheer' ? 'M52 61 Q60 69 68 61' : 'M54 63 Q60 67.5 66 63'"
          stroke-width="2.5"
          stroke-linecap="round"
        />

        <!-- 胸口的脉冲图标 -->
        <rect class="m-panel" x="49" y="78" width="22" height="14" rx="3.5" stroke-width="1.8" />
        <path
          class="m-pulse"
          d="M52 86 L55 86 L57 81 L60 90 L63 83 L65 86 L68 86"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <!-- 区域装扮（设计稿 Zones）：安全帽、护目镜 -->
        <g class="hg-mascot__helmet">
          <path class="m-helmet" d="M26 30 Q60 4 94 30 Z" stroke-width="2.5" stroke-linejoin="round" />
          <rect class="m-helmet-brim" x="22" y="27" width="76" height="7" rx="3.5" stroke-width="2.5" />
        </g>
        <g class="hg-mascot__visor">
          <rect class="m-visor" x="30" y="41" width="60" height="22" rx="11" stroke-width="2.5" />
        </g>

        <!-- 给提示：头顶小灯泡 -->
        <g v-if="mood === 'hint'">
          <circle class="m-bulb" cx="96" cy="16" r="8" stroke-width="2" />
          <path class="m-wire" d="M93 26 H99" stroke-width="2" stroke-linecap="round" />
          <path class="m-bulb-ray" d="M96 12 V18" stroke-width="2" stroke-linecap="round" />
        </g>

        <!-- 庆祝：星星和小火花 -->
        <g v-if="mood === 'cheer'">
          <path class="m-star hg-mascot__spark" d="M98 14 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" stroke-width="1.3" />
          <path
            class="m-spark hg-mascot__spark hg-mascot__spark--late"
            d="M18 22 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 z"
            stroke-width="1.2"
          />
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.hg-mascot {
  /* 插画配色（tokens.css 的 --hg-art-*）；换装时在下面整组替换 */
  --m-body-a: var(--hg-art-body-top);
  --m-body-b: var(--hg-art-body);
  --m-eye: var(--hg-art-led);
  --m-antenna: var(--hg-art-antenna);
  --m-wire: var(--hg-art-line);

  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.hg-mascot__art {
  display: block;
  overflow: visible;
}

/*
 * 换装：写了 outfit 或页面 frontmatter 有 zone 时用 --helmet / --visor；
 * 没写（--auto）时跟随最近的 [data-zone] 祖先，服务端渲染和水合的 HTML 一致。
 * 区域容器不嵌套，所以这里用后代选择器就够。
 */
.hg-mascot--helmet,
[data-zone='forge'] .hg-mascot--auto {
  --m-body-a: var(--hg-art-forge-body);
  --m-body-b: var(--hg-art-forge-body);
  --m-eye: var(--hg-art-forge-led);
  --m-antenna: var(--hg-art-forge-antenna);
}

.hg-mascot--visor,
[data-zone='trial'] .hg-mascot--auto {
  --m-body-a: var(--hg-art-trial-body);
  --m-body-b: var(--hg-art-trial-body);
  --m-eye: var(--hg-art-trial-led);
  --m-antenna: var(--hg-art-trial-antenna);
  --m-wire: var(--hg-art-trial-wire);
}

.hg-mascot__helmet,
.hg-mascot__visor {
  display: none;
}

.hg-mascot--helmet .hg-mascot__helmet,
[data-zone='forge'] .hg-mascot--auto .hg-mascot__helmet,
.hg-mascot--visor .hg-mascot__visor,
[data-zone='trial'] .hg-mascot--auto .hg-mascot__visor {
  display: block;
}

/* ---------- 插画配色：组件里不写十六进制值 ---------- */
.m-body-a { stop-color: var(--m-body-a); }
.m-body-b { stop-color: var(--m-body-b); }
.m-screen-a { stop-color: var(--hg-art-screen-top); }
.m-screen-b { stop-color: var(--hg-art-screen); }

.m-shadow { fill: var(--hg-art-shadow); }
.m-glow { fill: var(--m-antenna); opacity: 0.18; }
.m-wire { fill: none; stroke: var(--m-wire); }
.m-lamp { fill: var(--m-antenna); stroke: var(--hg-art-line); }
.m-metal { fill: var(--hg-art-metal); stroke: var(--hg-art-line); }
.m-outline { stroke: var(--hg-art-line); }
.m-highlight { fill: none; stroke: var(--hg-art-white); }
.m-trim { fill: none; stroke: var(--hg-art-trim); opacity: 0.7; }
.m-eye { fill: var(--m-eye); }
.m-eye-line { fill: none; stroke: var(--m-eye); }
.m-glint { fill: var(--hg-art-white); }
.m-blush { fill: var(--hg-art-blush); opacity: 0.85; }
.m-panel { fill: var(--hg-art-white); stroke: var(--hg-art-line); }
.m-pulse { fill: none; stroke: var(--hg-art-pulse); }
.m-helmet { fill: var(--hg-art-helmet); stroke: var(--hg-art-line); }
.m-helmet-brim { fill: var(--hg-art-helmet-brim); stroke: var(--hg-art-line); }
.m-visor { fill: var(--hg-art-visor); fill-opacity: 0.25; stroke: var(--hg-art-visor); }
.m-bulb { fill: var(--hg-art-bulb); stroke: var(--hg-art-line); }
.m-bulb-ray { fill: none; stroke: var(--hg-art-antenna); }
.m-star { fill: var(--hg-art-amber); stroke: var(--hg-art-line); }
.m-spark { fill: var(--hg-art-spark); stroke: var(--hg-art-line); }

/* ---------- 对话气泡：台词不超过 30 字 ---------- */
.hg-mascot__speech {
  position: relative;
  max-width: 18em;
  padding: 10px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
}

.hg-mascot__speech::after {
  content: '';
  position: absolute;
  bottom: -6px;
  left: 50%;
  width: 10px;
  height: 10px;
  transform: translateX(-50%) rotate(45deg);
  border-right: var(--hg-border-width) solid var(--hg-border);
  border-bottom: var(--hg-border-width) solid var(--hg-border);
  background: var(--hg-surface);
}

.hg-mascot__line {
  margin: 0;
  color: var(--hg-ink);
  font-family: var(--hg-font-body);
  font-size: var(--hg-text-handbook);
  line-height: 1.55;
  text-align: center;
}

/*
 * 待机动效（02 第 1、2 节）：呼吸 + 眨眼 + 庆祝时的小火花。
 * 弹性只给吉祥物和奖励；位移幅度 1.5 个画布单位，频率远低于每秒 3 次。
 */
@keyframes hg-mascot-breathe {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1.5px); }
}

@keyframes hg-mascot-blink {
  0%, 92%, 100% { transform: scaleY(1); }
  95% { transform: scaleY(0.12); }
}

@keyframes hg-mascot-twinkle {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.82); opacity: 0.65; }
}

.hg-mascot__breathe {
  animation: hg-mascot-breathe 3.6s var(--motion-ease-in-out) infinite;
}

.hg-mascot__eyes {
  transform-box: fill-box;
  transform-origin: 50% 50%;
  animation: hg-mascot-blink 5.2s var(--motion-ease-in-out) infinite;
}

.hg-mascot__spark {
  transform-box: fill-box;
  transform-origin: 50% 50%;
  animation: hg-mascot-twinkle 1.8s var(--motion-ease-in-out) infinite;
}

.hg-mascot__spark--late {
  animation-delay: 0.6s;
}

/*
 * 减弱动效（02 第 4 节）：系统设置和站点设置（布局根元素的 data-hg-motion="reduce"）
 * 都要关掉位移、缩放和循环动画；自定义 @keyframes 不受时长 token 影响，这里单独处理。
 */
@media (prefers-reduced-motion: reduce) {
  .hg-mascot__breathe,
  .hg-mascot__eyes,
  .hg-mascot__spark {
    animation: none;
  }
}

[data-hg-motion='reduce'] .hg-mascot__breathe,
[data-hg-motion='reduce'] .hg-mascot__eyes,
[data-hg-motion='reduce'] .hg-mascot__spark {
  animation: none;
}
</style>
