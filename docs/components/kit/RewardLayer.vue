<script setup lang="ts">
/**
 *
 * 挂在新版两个布局（HgLayout、StageLayout）上，订阅进度事件，统一播放三种奖励：
 * - StarBurst：拿星。小核庆祝，星星依次点亮（每颗间隔 150 ms，放大到 1.15 再回落），「+50 XP · STAR 2/3」。
 * - LevelUp：升级。深色卡片 + 六边形等级徽章 + 少量彩带，整段不超过 1.5 s，点任意处或按 Esc 跳过，不遮住整页。
 * - Toast：新徽章、收入图鉴、其余经验值。底部滑入，3 s 后自动消失，点一下也能关。
 * 同一拍里的事件攒成一批（docs/course/rewards.ts 整理顺序），多条奖励排队一条一条播，不叠在一起。
 *
 * 简洁模式、存档里的「减弱动效」、系统的减弱动态效果：只显示一句文字，没有插画和动画。
 * 每条奖励的文字都写进 aria-live 区域，读屏会读到。默认不播放声音。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { ProgressEvent } from '@course/progress.ts'
import { durationOf, rewardsFrom, rewardText, type Reward } from '@course/rewards.ts'
import { termName } from '@course/glossary.ts'
import { BADGE_BY_ID } from '@course/badges.ts'
import { onProgressEvent, useProgress } from '@course/useProgress.ts'
import Mascot from './Mascot.vue'

const progress = useProgress()

const queue: Reward[] = []
const current = shallowRef<Reward | null>(null)
/** 每条奖励一个新 key：同类奖励连着来也会重新播一遍入场。 */
const play = ref(0)
const announce = ref('')
const textOnly = ref(false)

let pending: ProgressEvent[] = []
let flushQueued = false
let timer: ReturnType<typeof setTimeout> | undefined

function collect(event: ProgressEvent) {
  pending.push(event)
  if (flushQueued) return
  flushQueued = true
  queueMicrotask(() => {
    flushQueued = false
    queue.push(...rewardsFrom(pending))
    pending = []
    if (!current.value) next()
  })
}

/** 播下一条；队列空了就收起。 */
function next() {
  clearTimeout(timer)
  const reward = queue.shift() ?? null
  current.value = reward
  if (!reward) return
  const prefs = progress.state.prefs
  textOnly.value = prefs.plain || prefs.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches
  play.value += 1
  announce.value = rewardText(reward)
  timer = setTimeout(next, durationOf(reward, textOnly.value))
}

/**
 * 点卡片收掉这一条；LevelUp 期间点页面任何地方都跳过（点击照常生效，只是顺手把卡片收掉）。
 * 只在 pointerdown 上处理一次：离场动画里的旧卡片还在 DOM 上，再挂 click 会把刚开始的下一条也跳过。
 */
function onPointer(event: PointerEvent) {
  const onCard = event.target instanceof Element && event.target.closest('.hg-reward__slot:not(.hg-reward-leave-active)')
  if (current.value && (current.value.kind === 'level' || onCard)) next()
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && current.value) next()
}

let off: (() => void) | undefined
onMounted(() => {
  off = onProgressEvent(collect)
  document.addEventListener('pointerdown', onPointer, true)
  document.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  off?.()
  clearTimeout(timer)
  document.removeEventListener('pointerdown', onPointer, true)
  document.removeEventListener('keydown', onKey)
})

/** StarBurst 的三颗星：这一批新拿的播点亮动画（依次延后 150 ms），以前拿到的直接亮着。 */
const stars = computed(() => {
  const r = current.value
  if (r?.kind !== 'stars') return []
  const owned = progress.stage(r.stage).stars
  return [0, 1, 2].map((i) => ({
    on: owned.includes(i) || r.indices.includes(i),
    fresh: r.indices.includes(i),
    delay: `${300 + r.indices.indexOf(i) * 150}ms`,
  }))
})

const badge = computed(() => (current.value?.kind === 'badge' ? BADGE_BY_ID.get(current.value.id) ?? null : null))
</script>

<template>
  <div class="hg-reward">
    <p class="hg-reward__live" aria-live="polite" aria-atomic="true">{{ announce }}</p>

    <Transition name="hg-reward" :css="!textOnly">
      <div v-if="current" :key="play" class="hg-reward__slot" aria-hidden="true">
        <p v-if="textOnly" class="hg-reward__text">{{ announce }}</p>

        <div v-else-if="current.kind === 'stars'" class="hg-reward__card hg-starburst">
          <Mascot mood="cheer" :size="64" />
          <div class="hg-starburst__body">
            <span class="hg-reward__eyebrow is-amber">STAR EARNED</span>
            <span class="hg-starburst__stars">
              <span
                v-for="(s, i) in stars"
                :key="i"
                class="hg-starburst__star"
                :class="{ 'is-on': s.on, 'is-fresh': s.fresh }"
                :style="{ '--hg-star-delay': s.delay }"
              >★</span>
            </span>
            <span class="hg-starburst__pill">+{{ current.xp }} XP · STAR {{ current.total }}/3</span>
          </div>
        </div>

        <div v-else-if="current.kind === 'level'" class="hg-reward__card hg-levelup">
          <svg class="hg-levelup__badge" viewBox="0 0 140 140" width="96" height="96">
            <circle class="hg-levelup__track" cx="70" cy="70" r="64" />
            <circle class="hg-levelup__ring" cx="70" cy="70" r="64" transform="rotate(-90 70 70)" />
            <path class="hg-levelup__hex" d="M70 26 L106 47 L106 93 L70 114 L34 93 L34 47 Z" />
            <text class="hg-levelup__lv" x="70" y="64" text-anchor="middle">LV</text>
            <text class="hg-levelup__num" x="70" y="94" text-anchor="middle">{{ current.level }}</text>
            <g class="hg-levelup__confetti">
              <circle cx="18" cy="24" r="3" style="--c: var(--hg-art-amber)" />
              <rect x="116" y="18" width="6" height="10" rx="1.5" style="--c: var(--hg-group-0)" transform="rotate(25 119 23)" />
              <rect x="12" y="110" width="6" height="10" rx="1.5" style="--c: var(--hg-group-2)" transform="rotate(-20 15 115)" />
              <circle cx="124" cy="112" r="2.5" style="--c: var(--hg-group-4)" />
            </g>
          </svg>
          <div class="hg-levelup__body">
            <span class="hg-reward__eyebrow is-led">LEVEL UP</span>
            <strong class="hg-levelup__title">升到 Lv.{{ current.level }}</strong>
            <span class="hg-levelup__sub">再得 {{ progress.xpToNext.value }} XP 升到 Lv.{{ current.level + 1 }} · 点任意处继续</span>
          </div>
        </div>

        <div v-else class="hg-reward__card hg-toast">
          <svg v-if="current.kind === 'badge'" class="hg-toast__medal" viewBox="0 0 120 130" width="40" height="44">
            <path class="hg-toast__ribbon" d="M42 96 L34 126 L48 118 L56 128 L62 102 Z M78 96 L86 126 L72 118 L64 128 L58 102 Z" />
            <path class="hg-toast__hex" d="M60 8 L100 31 L100 77 L60 100 L20 77 L20 31 Z" />
            <path class="hg-toast__check" d="M45 54 L55 64 L76 41" />
          </svg>
          <div class="hg-toast__body">
            <template v-if="current.kind === 'badge'">
              <span class="hg-reward__eyebrow is-violet">NEW BADGE</span>
              <strong>{{ badge?.name ?? current.id }}</strong>
              <span v-if="badge" class="hg-toast__sub">{{ badge.desc }}</span>
            </template>
            <template v-else-if="current.kind === 'codex'">
              <span class="hg-reward__eyebrow is-violet">NEW TERM</span>
              <strong>收入图鉴</strong>
              <span class="hg-toast__sub">{{ current.keys.map(termName).join('、') }}</span>
            </template>
            <template v-else>
              <span class="hg-reward__eyebrow is-accent">XP</span>
              <strong class="hg-toast__xp">+{{ current.amount }} XP</strong>
              <span class="hg-toast__sub">{{ current.reasons.join('、') }}</span>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hg-reward__live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* 底部居中，不遮住整页；手机上左右各留 16px。 */
.hg-reward__slot {
  position: fixed;
  left: 50%;
  bottom: max(20px, env(safe-area-inset-bottom));
  z-index: 40;
  width: min(380px, calc(100vw - 32px));
  transform: translateX(-50%);
  cursor: pointer;
}

.hg-reward__card,
.hg-reward__text {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0;
  padding: 14px 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.hg-reward__text {
  font-size: 15px;
  font-weight: 600;
}

.hg-reward__eyebrow {
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-reward__eyebrow.is-amber { color: var(--hg-amber-ink); }
.hg-reward__eyebrow.is-violet { color: var(--hg-violet-ink); }
.hg-reward__eyebrow.is-accent { color: var(--hg-accent-ink); }
.hg-reward__eyebrow.is-led { color: var(--hg-art-led); }

/* ---------- StarBurst ---------- */

.hg-starburst__body,
.hg-toast__body,
.hg-levelup__body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.hg-starburst__stars {
  display: inline-flex;
  gap: 4px;
  font-size: 26px;
  line-height: 1;
}

.hg-starburst__star {
  display: inline-block;
  color: var(--hg-idle);
}

.hg-starburst__star.is-on {
  color: var(--hg-amber);
}

.hg-starburst__pill {
  padding: 5px 10px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-ink);
  color: var(--hg-surface);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

/*
 * 拿星：从灰色小星放大到 1.15 再回落成金色（02 第 6 节），每颗依次延后 150 ms。
 * 过冲已经写在 keyframes 里，缓动用 ease-out；再叠 easeOutBack 会冲到 1.2 左右。
 */
@keyframes hg-reward-star {
  0% { transform: scale(0.6); color: var(--hg-idle); }
  45% { transform: scale(1.15); color: var(--hg-amber); }
  100% { transform: scale(1); color: var(--hg-amber); }
}

.hg-starburst__star.is-fresh {
  animation: hg-reward-star var(--motion-slow) var(--motion-ease-out) var(--hg-star-delay) both;
}

/* ---------- LevelUp：深色卡片在亮暗主题下都一样 ---------- */

.hg-levelup {
  border-color: var(--hg-art-screen-top);
  background: var(--hg-art-screen);
  box-shadow: var(--hg-shadow-hero);
  color: var(--hg-code-ink);
}

.hg-levelup__badge {
  flex: none;
  overflow: visible;
}

.hg-levelup__track {
  fill: none;
  stroke: var(--hg-art-screen-top);
  stroke-width: 8;
}

.hg-levelup__ring {
  fill: none;
  stroke: var(--hg-art-antenna-on);
  stroke-width: 8;
  stroke-linecap: round;
  stroke-dasharray: 402 402;
}

.hg-levelup__hex {
  fill: var(--hg-art-screen-top);
  stroke: var(--hg-art-antenna-on);
  stroke-width: 2;
}

.hg-levelup__lv {
  fill: var(--hg-art-led);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 700;
}

.hg-levelup__num {
  fill: var(--hg-art-white);
  font-family: var(--hg-font-display);
  font-size: 34px;
  font-weight: 700;
}

.hg-levelup__confetti > * {
  fill: var(--c);
}

.hg-levelup__title {
  font-family: var(--hg-font-display);
  font-size: 24px;
  color: var(--hg-art-white);
}

.hg-levelup__sub {
  color: var(--hg-code-file);
  font-size: 13px;
}

/* 等级徽章：环走一圈、徽章轻微过冲到 1.08（写在 keyframes 里，奖励可以弹跳，02 第 2 节）；彩带从徽章边上散开。整段 600 ms 内播完。 */
@keyframes hg-reward-ring {
  from { stroke-dashoffset: 402; }
  to { stroke-dashoffset: 0; }
}

@keyframes hg-reward-pop {
  0% { transform: scale(0.8); opacity: 0; }
  60% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes hg-reward-confetti {
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

.hg-levelup__ring {
  animation: hg-reward-ring var(--motion-slow) var(--motion-ease-out) both;
}

.hg-levelup__hex,
.hg-levelup__lv,
.hg-levelup__num {
  transform-origin: 70px 70px;
  animation: hg-reward-pop var(--motion-slow) var(--motion-ease-out) both;
}

.hg-levelup__confetti > * {
  transform-box: fill-box;
  transform-origin: center;
  animation: hg-reward-confetti var(--motion-slow) var(--motion-ease-out) 100ms both;
}

/* ---------- Toast ---------- */

.hg-toast__medal {
  flex: none;
}

.hg-toast__ribbon {
  fill: var(--hg-violet);
  stroke: var(--hg-art-line);
  stroke-width: 2.2;
  stroke-linejoin: round;
}

.hg-toast__hex {
  fill: var(--hg-group-2-soft);
  stroke: var(--hg-art-line);
  stroke-width: 2.5;
  stroke-linejoin: round;
}

.hg-toast__check {
  fill: none;
  stroke: var(--hg-art-pulse);
  stroke-width: 6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hg-toast__body strong {
  font-size: 16px;
}

.hg-toast__xp {
  font-family: var(--hg-font-display);
}

.hg-toast__sub {
  color: var(--hg-ink-2);
  font-size: 13px;
}

/* ---------- 入场、离场 ---------- */

.hg-reward-enter-active {
  transition:
    opacity var(--motion-base) var(--motion-ease-out),
    transform var(--motion-base) var(--motion-ease-out);
}

.hg-reward-leave-active {
  transition: opacity var(--motion-fast) var(--motion-ease-in);
}

.hg-reward-enter-from {
  opacity: 0;
  transform: translate(-50%, 16px);
}

.hg-reward-leave-to {
  opacity: 0;
}

/*
 * 区域差异（02 第 2 节）。上面的 keyframes 自己写了过冲（星 1.15、等级徽章 1.08），换缓动收不掉，按区域换 keyframes：
 * 铸造城只留彩带的弹跳，星和等级徽章直接放大到原尺寸；试炼场只保留淡入和位移，不缩放。
 */
[data-zone='forge'] .hg-starburst__star.is-fresh {
  animation-name: hg-reward-star-flat;
}

[data-zone='forge'] .hg-levelup__hex,
[data-zone='forge'] .hg-levelup__lv,
[data-zone='forge'] .hg-levelup__num {
  animation-name: hg-reward-pop-flat;
}

@keyframes hg-reward-star-flat {
  from { transform: scale(0.6); color: var(--hg-idle); }
  to { transform: scale(1); color: var(--hg-amber); }
}

@keyframes hg-reward-pop-flat {
  from { transform: scale(0.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

[data-zone='trial'] .hg-starburst__star.is-fresh,
[data-zone='trial'] .hg-levelup__hex,
[data-zone='trial'] .hg-levelup__lv,
[data-zone='trial'] .hg-levelup__num,
[data-zone='trial'] .hg-levelup__confetti > * {
  animation-name: hg-reward-fade;
}

@keyframes hg-reward-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 减弱动效：正常情况下已经换成纯文字（textOnly）；这里再兜一层，自定义 @keyframes 不受时长 token 影响。 */
@media (prefers-reduced-motion: reduce) {
  .hg-reward * {
    animation: none !important;
  }
}

[data-hg-motion='reduce'] .hg-reward * {
  animation: none !important;
}

@media (max-width: 767px) {
  .hg-reward__slot {
    bottom: max(16px, env(safe-area-inset-bottom));
  }

  .hg-levelup__badge {
    width: 72px;
    height: 72px;
  }
}
</style>
