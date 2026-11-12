<script setup lang="ts">
/**
 * 关卡状态栏（F-10；03 第 3 节 StageLayout 的关键行为，设计稿 Stage 画板顶部）。
 *
 * 吸顶一条：回地图、区域和关卡号、关卡名、本关进度点、工具位（写法 / 路线切换 F-11、
 * 提示按钮 F-12，用 tools 插槽填）、等级与经验、本关星级、亮暗切换。
 * 副本页（X-01 的 DungeonLayout）用同一条：编号位置写「副本」，星是这道副本的星，左上角回副本大厅。
 *
 * 进度点按正文的 h2 生成（页面数据里的 headers，服务端渲染就有，水合前后一致），
 * 是普通的锚点链接：Tab 到上面回车就跳到那一段。滚动时高亮读者正在读的那一段。
 * 1440px 以上进度点带段名；放不下（段多、段名长、工具多）或者屏幕更窄时只留圆点和当前段名；
 * 767px 以下进度点和工具位换到第二行，回地图只留箭头。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, withBase } from 'vitepress'
import type { ZoneMeta } from '@course/outline.ts'
import HgLevelChip from './HgLevelChip.vue'
import HgThemeToggle from './HgThemeToggle.vue'

const props = withDefaults(defineProps<{
  zone: ZoneMeta
  /** 区域名后面那一截：关卡号（例如 1-4），副本页写「副本」。 */
  code: string
  title: string
  /** 已经拿到的星序号（0 / 1 / 2）。 */
  earned: readonly number[]
  /** 正文的 h2：锚点和标题。 */
  sections: readonly { slug: string; title: string }[]
  /** 星和进度点的读屏文字说的是谁：关卡是「本关」，副本是「这道题」。 */
  scope?: string
  /** 左上角回哪儿（不带站点 base）：关卡回地图，副本回副本大厅。 */
  back?: { href: string; text: string }
}>(), { scope: '本关', back: () => ({ href: '/world/', text: '回地图' }) })

const route = useRoute()

const starLabel = computed(() => `${props.scope}已获得 ${props.earned.length} / 3 颗星`)

/** 正在读的那一段（-1 表示还在第一段之前：任务卡、先猜那一带）。 */
const current = ref(-1)
const currentTitle = computed(() => props.sections[current.value]?.title ?? '开始')

const bar = ref<HTMLElement | null>(null)
const lower = ref<HTMLElement | null>(null)
const stepsNav = ref<HTMLElement | null>(null)
let frame = 0
let resizer: ResizeObserver | null = null

function measure() {
  frame = 0
  // 标题滚到状态栏下面一点的位置就算进入这一段。点进度点跳过去时标题停在 scroll-padding-top 处
  // （shell.css），判定线要比它再低一点，否则刚跳到的那一段反而不亮。
  const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
  const line = Math.max(bar.value?.offsetHeight ?? 64, padding) + 24
  let index = -1
  props.sections.forEach((section, i) => {
    const el = document.getElementById(section.slug)
    if (el && el.getBoundingClientRect().top <= line) index = i
  })
  // 最后一段往往很短，标题到不了状态栏下面；滚到底时就算最后一段。
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
  if (atBottom && props.sections.length) index = props.sections.length - 1
  current.value = index
}

function onScroll() {
  if (!frame) frame = requestAnimationFrame(measure)
}

/**
 * 带段名的进度点放不下时退成「圆点 + 当前段名」（加 is-crowded，样式和窄屏一样）。
 * 同一个回调里先摘掉、量完再决定，中间不会画出来。只观察进度点外面那一格和工具位：
 * 它们的大小不随 is-crowded 变化，不会来回触发。
 */
function fit() {
  const nav = stepsNav.value
  const list = nav?.querySelector('ol')
  if (!nav || !list) return
  nav.classList.remove('is-crowded')
  nav.classList.toggle('is-crowded', list.scrollWidth > nav.clientWidth + 1)
}

onMounted(() => {
  measure()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  if (typeof ResizeObserver !== 'undefined' && lower.value) {
    resizer = new ResizeObserver(fit)
    resizer.observe(lower.value)
    const tools = lower.value.querySelector('.hg-stagebar__tools')
    if (tools) resizer.observe(tools)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  if (frame) cancelAnimationFrame(frame)
  resizer?.disconnect()
})

// 站内跳到另一关：正文换了，重新量一次。
watch(() => route.path, () => requestAnimationFrame(() => {
  measure()
  fit()
}))
</script>

<template>
  <header ref="bar" class="hg-stagebar">
    <div class="hg-stagebar__inner">
      <a class="hg-stagebar__back" :href="withBase(back.href)" :aria-label="back.text">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
        <span class="hg-stagebar__back-text">{{ back.text }}</span>
      </a>

      <p class="hg-stagebar__title">
        <span class="hg-stagebar__eyebrow">{{ zone.name }} · {{ code }}</span>
        <strong class="hg-stagebar__name">{{ title }}</strong>
      </p>

      <div ref="lower" class="hg-stagebar__lower">
        <nav v-if="sections.length" ref="stepsNav" class="hg-stagebar__steps" :aria-label="`${scope}进度`">
          <ol>
            <li v-for="(section, i) in sections" :key="section.slug">
              <a
                class="hg-stagebar__step"
                :class="{ 'is-current': i === current, 'is-past': i < current }"
                :href="`#${section.slug}`"
                :aria-current="i === current ? 'step' : undefined"
                :title="section.title"
              >
                <span class="hg-stagebar__dot" aria-hidden="true" />
                <span class="hg-stagebar__label">{{ section.title }}</span>
              </a>
            </li>
          </ol>
          <span class="hg-stagebar__now" aria-hidden="true">{{ currentTitle }}</span>
        </nav>

        <!-- 工具位：写法 / 路线切换（F-11）、提示按钮（F-12）。 -->
        <div v-if="$slots.tools" class="hg-stagebar__tools"><slot name="tools" /></div>
      </div>

      <div class="hg-stagebar__right">
        <HgLevelChip :stars="false" />
        <span class="hg-stagebar__stars" role="img" :aria-label="starLabel">
          <span v-for="i in 3" :key="i" :class="{ 'is-on': earned.includes(i - 1) }" aria-hidden="true">{{ earned.includes(i - 1) ? '★' : '☆' }}</span>
        </span>
        <HgThemeToggle />
      </div>
    </div>
  </header>
</template>

<style scoped>
.hg-stagebar {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
  background: var(--hg-surface);
  background: color-mix(in srgb, var(--hg-surface) 92%, transparent);
  backdrop-filter: blur(8px);
}

.hg-stagebar__inner {
  display: flex;
  align-items: center;
  gap: 10px 16px;
  max-width: 1440px;
  margin: 0 auto;
  padding: 10px 24px;
}

.hg-stagebar__back {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 38px;
  padding: 0 12px 0 8px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.hg-stagebar__back svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hg-stagebar__back:hover {
  border-color: var(--hg-border-strong);
}

.hg-stagebar__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  line-height: 1.3;
}

.hg-stagebar__eyebrow {
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  letter-spacing: var(--hg-tracking-eyebrow);
  white-space: nowrap;
}

.hg-stagebar__name {
  overflow: hidden;
  font-family: var(--hg-font-display);
  font-size: 18px;
  letter-spacing: var(--hg-tracking-h1);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 进度点和工具位占中间剩下的全部宽度：进度点居中，工具位靠右。 */
.hg-stagebar__lower {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.hg-stagebar__lower:empty {
  display: none;
}

.hg-stagebar__steps {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin: 0 auto;
}

.hg-stagebar__steps ol {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 进度点：读过的是强调色实心点，正在读的是深色药丸，后面的是空心灰点。 */
.hg-stagebar__step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 2px 10px;
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-3);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition:
    background-color var(--motion-base) var(--motion-ease-out),
    color var(--motion-base) var(--motion-ease-out);
}

.hg-stagebar__step:hover {
  color: var(--hg-ink);
}

.hg-stagebar__label {
  max-width: 7em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hg-stagebar__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border: 1.5px solid var(--hg-border-strong);
  border-radius: 50%;
  transition:
    background-color var(--motion-base) var(--motion-ease-out),
    border-color var(--motion-base) var(--motion-ease-out);
}

.hg-stagebar__step.is-past {
  color: var(--hg-ink-2);
}

.hg-stagebar__step.is-past .hg-stagebar__dot {
  border-color: var(--hg-accent);
  background: var(--hg-accent);
}

.hg-stagebar__step.is-current {
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-stagebar__step.is-current .hg-stagebar__dot {
  border-color: var(--hg-accent);
  background: var(--hg-accent);
}

.hg-stagebar__now {
  display: none;
  min-width: 0;
  overflow: hidden;
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hg-stagebar__right {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
}

.hg-stagebar__stars {
  display: inline-flex;
  gap: 1px;
  color: var(--hg-idle);
  font-size: 16px;
  letter-spacing: 1px;
}

.hg-stagebar__stars .is-on {
  color: var(--hg-amber);
}

.hg-stagebar__tools {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.hg-stagebar__back:focus-visible,
.hg-stagebar__step:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/*
 * 只留圆点，旁边写正在读的那一段：1440px 以下，或者宽屏上带段名也放不下（is-crowded，见 fit()）。
 * 两组规则内容相同，一组按屏幕宽度、一组按测量结果。
 */
@media (max-width: 1439px) {
  .hg-stagebar__step {
    padding: 6px 3px;
  }

  .hg-stagebar__step.is-current {
    background: transparent;
  }

  .hg-stagebar__step.is-current .hg-stagebar__dot {
    width: 10px;
    height: 10px;
    border-color: var(--hg-ink);
    background: var(--hg-ink);
  }

  .hg-stagebar__label {
    display: none;
  }

  .hg-stagebar__now {
    display: inline;
  }
}

.hg-stagebar__steps.is-crowded .hg-stagebar__step {
  padding: 6px 3px;
}

.hg-stagebar__steps.is-crowded .hg-stagebar__step.is-current {
  background: transparent;
}

.hg-stagebar__steps.is-crowded .hg-stagebar__step.is-current .hg-stagebar__dot {
  width: 10px;
  height: 10px;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
}

.hg-stagebar__steps.is-crowded .hg-stagebar__label {
  display: none;
}

.hg-stagebar__steps.is-crowded .hg-stagebar__now {
  display: inline;
}

/* 1200px 以下：等级芯片只留等级，经验条和数字收起（读屏照样读到完整数字）。 */
@media (max-width: 1199px) {
  .hg-stagebar__right :deep(.hg-chip__bar),
  .hg-stagebar__right :deep(.hg-chip__xp) {
    display: none;
  }
}

/* 1024px 以下：回地图只留箭头。 */
@media (max-width: 1023px) {
  .hg-stagebar__back {
    padding: 0 9px;
  }

  .hg-stagebar__back-text {
    display: none;
  }
}

/* 767px 以下：进度点和工具位换到第二行（次要信息折叠，375px 不溢出）。 */
@media (max-width: 767px) {
  .hg-stagebar__inner {
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 8px 16px 6px;
  }

  .hg-stagebar__title {
    flex: 1 1 0;
  }

  .hg-stagebar__name {
    font-size: 16px;
  }

  .hg-stagebar__right {
    gap: 8px;
  }

  .hg-stagebar__lower {
    order: 1;
    flex: 1 1 100%;
    gap: 10px;
  }

  .hg-stagebar__steps {
    margin: 0 auto 0 0;
  }
}
</style>
