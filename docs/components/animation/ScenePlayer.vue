<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSceneClock } from './useSceneClock'
import type { SceneMeta } from './sceneTypes'

const props = defineProps<{ meta: SceneMeta }>()

const durations = computed(() => props.meta.steps.map(step => step.duration ?? 2600))
const clock = useSceneClock(durations)

const rootEl = ref<HTMLElement | null>(null)

const currentStep = computed(() => props.meta.steps[clock.stepIndex.value])
const pct = computed(() =>
  clock.total.value > 0 ? `${((clock.time.value / clock.total.value) * 100).toFixed(2)}%` : '0%'
)
const stageLabel = computed(
  () =>
    `${props.meta.title}，第 ${clock.stepIndex.value + 1}/${clock.stepCount.value} 步：${currentStep.value.title}。${currentStep.value.narration}`
)

function manualStep(direction: number) {
  clock.goToStep(clock.stepIndex.value + direction)
}

function manualGo(index: number) {
  clock.goToStep(index)
}

function manualToggle() {
  if (clock.playing.value) {
    clock.pause()
  } else {
    clock.play()
  }
}

function onScrubStart() {
  clock.pause()
}

function onScrub(event: Event) {
  clock.pause()
  clock.seek(Number((event.target as HTMLInputElement).value))
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target instanceof HTMLInputElement) return
  const onButton = target instanceof HTMLButtonElement
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    manualStep(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    manualStep(1)
  } else if (event.key === ' ' && !onButton) {
    event.preventDefault()
    manualToggle()
  }
}

let observer: IntersectionObserver | undefined

onMounted(() => {
  clock.reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  clock.seek(Math.max(0, durations.value[0] - 1))

  document.addEventListener('visibilitychange', onVisibility)
  if (typeof IntersectionObserver === 'undefined' || !rootEl.value) {
    return
  }

  observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) {
        clock.pause()
      }
    },
    { threshold: 0.35 }
  )
  observer.observe(rootEl.value)
})

function onVisibility() {
  if (document.hidden) clock.pause()
}

onUnmounted(() => {
  observer?.disconnect()
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <section
    ref="rootEl"
    class="ej"
    role="group"
    tabindex="0"
    :aria-label="`${meta.title}（交互式教学动画：← → 切换步骤，空格播放暂停，可拖动进度条擦洗）`"
    @keydown="onKeydown"
  >
    <header class="ej-head">
      <div class="ej-headings">
        <span class="ej-eyebrow">{{ meta.eyebrow }}</span>
        <span class="ej-title">{{ meta.title }}</span>
      </div>
      <span class="ej-count" aria-hidden="true">
        <b>{{ clock.stepIndex.value + 1 }}</b><i>/</i>{{ clock.stepCount.value }}
      </span>
    </header>

    <div class="ej-stage" :class="{ 'has-mobile-scene': meta.mobileViewBox }">
      <svg class="ej-desktop-scene" :viewBox="meta.viewBox" role="img" :aria-label="stageLabel">
        <slot name="stage" :step="clock.stepIndex.value" :local="clock.stepLocal.value" />
      </svg>
      <svg v-if="meta.mobileViewBox" class="ej-mobile-scene" :viewBox="meta.mobileViewBox" role="img" :aria-label="stageLabel">
        <slot name="stage" :step="clock.stepIndex.value" :local="clock.stepLocal.value" />
      </svg>
    </div>

    <p v-if="!meta.mobileViewBox" class="ej-scroll-hint">左右滑动画布，查看完整过程</p>

    <div class="ej-narration-space">
      <!-- 同一网格内的隐藏说明按当前宽度自然换行，为最长一步预留空间。 -->
      <p v-for="(step, index) in meta.steps" :key="index" class="ej-narration ej-narration-measure" aria-hidden="true">
        <strong>{{ step.title }}</strong>
        <span>{{ step.narration }}</span>
      </p>
      <p class="ej-narration" :aria-live="clock.playing.value ? 'off' : 'polite'">
        <strong>{{ currentStep.title }}</strong>
        <span>{{ currentStep.narration }}</span>
      </p>
    </div>

    <div class="ej-controls">
      <div class="ej-buttons">
        <button
          type="button"
          class="ej-btn"
          :disabled="clock.stepIndex.value === 0"
          aria-label="上一步"
          @click="manualStep(-1)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3m4-4L3 8l4 4" /></svg>
          <span>上一步</span>
        </button>
        <button
          type="button"
          class="ej-btn is-primary"
          :aria-label="clock.playing.value ? '暂停' : '播放'"
          @click="manualToggle()"
        >
          <svg v-if="clock.playing.value" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5.5 3.5v9M10.5 3.5v9" />
          </svg>
          <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L12.4 8Z" /></svg>
          <span>{{ clock.playing.value ? '暂停' : '播放' }}</span>
        </button>
        <button
          type="button"
          class="ej-btn"
          :disabled="clock.stepIndex.value === clock.stepCount.value - 1"
          aria-label="下一步"
          @click="manualStep(1)"
        >
          <span>下一步</span>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10m-4-4 4 4-4 4" /></svg>
        </button>
      </div>
      <div class="ej-timeline">
      <input
        class="ej-range"
        type="range"
        :min="0"
        :max="clock.total.value"
        step="1"
        :value="Math.floor(clock.time.value)"
        :style="{ '--ej-pct': pct }"
        aria-label="动画时间轴，可拖动擦洗到任意中间状态"
        :aria-valuetext="`第 ${clock.stepIndex.value + 1} 步：${currentStep.label}`"
        @pointerdown="onScrubStart"
        @input="onScrub"
      />
        <div class="ej-chips" aria-label="跳转到指定步骤">
          <button
            v-for="(step, index) in meta.steps"
            :key="step.label"
            type="button"
            class="ej-chip"
            :class="{ 'is-active': index === clock.stepIndex.value, 'is-done': index < clock.stepIndex.value }"
            :aria-current="index === clock.stepIndex.value ? 'step' : undefined"
            :title="step.label"
            @click="manualGo(index)"
          >
            <i aria-hidden="true">{{ index + 1 }}</i><span>{{ step.label }}</span>
          </button>
        </div>
      </div>
      <div class="ej-progress" aria-hidden="true">
        <span>步骤 {{ clock.stepIndex.value + 1 }} / {{ clock.stepCount.value }}</span>
        <strong>{{ currentStep.label }}</strong>
      </div>
    </div>

    <p class="ej-note">算法过程示意 · 可单步查看、拖动进度或播放；动画速度不代表 GPU 耗时。</p>
  </section>
</template>

<style scoped>
.ej {
  /* 全书统一语义色：A 蓝、B 橙、C 绿；活动状态用鼠尾草绿。 */
  --ej-bg: #f8faf9;
  --ej-surface: #f1f5f3;
  --ej-panel: #e8efec;
  --ej-line: #d7e0dc;
  --ej-line-strong: #becdc6;
  --ej-ink: #203532;
  --ej-ink-soft: #61736c;
  --ej-ink-faint: #82938b;
  --ej-a: #347baa;
  --ej-a-soft: rgba(52, 123, 170, .15);
  --ej-b: #b96b32;
  --ej-b-soft: rgba(185, 107, 50, .16);
  --ej-c: #3b8c60;
  --ej-c-soft: rgba(59, 140, 96, .15);
  --ej-active: #306753;
  --ej-active-soft: rgba(48, 103, 83, .10);
  --ej-on-active: #f5faf7;
  --ej-bad: #82938b;
  --ej-bad-soft: rgba(130, 147, 139, .16);
  --ej-shadow: rgba(17, 34, 27, .05);
  scroll-margin-top: calc(var(--vp-layout-top-height, 0px) + var(--vp-nav-height, 64px) + 64px);
  border: 1px solid var(--ej-line);
  border-radius: 8px;
  background: var(--ej-bg);
  padding: 22px 22px 15px;
  color: var(--ej-ink);
  text-align: left;
}

.ej:focus-visible {
  outline: 2px solid var(--ej-active);
  outline-offset: 3px;
}

.ej-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.ej-headings {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.ej-eyebrow {
  font-size: 10px;
  font-weight: 550;
  letter-spacing: .08em;
  color: var(--ej-ink-soft);
}

.ej-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--ej-ink);
}

.ej-count {
  flex: none;
  font-size: 12px;
  color: var(--ej-ink-faint);
  font-variant-numeric: tabular-nums;
}

.ej-count b {
  color: var(--ej-active);
  font-size: 16px;
  font-weight: 550;
}

.ej-count i {
  font-style: normal;
  margin: 0 5px;
}

.ej-stage {
  border: 1px solid var(--ej-line);
  border-radius: 5px;
  background: var(--ej-surface);
  overflow-x: auto;
}

.ej-stage svg {
  display: block;
  width: 100%;
  height: auto;
  min-width: 560px;
}

.ej-scroll-hint {
  display: none;
}

.ej-narration-space {
  display: grid;
  margin-top: 15px;
}

.ej-narration-measure {
  visibility: hidden;
  pointer-events: none;
  user-select: none;
}

.ej-narration {
  grid-area: 1 / 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.85;
  color: var(--ej-ink-soft);
}

.ej-narration strong {
  color: var(--ej-ink);
  font-weight: 550;
  margin-right: 8px;
}

.ej-controls {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--ej-line);
}

.ej-buttons {
  display: flex;
  gap: 8px;
  flex: none;
}

.ej-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  border-radius: 5px;
  border: 1px solid var(--ej-line-strong);
  background: transparent;
  color: var(--ej-ink-soft);
  cursor: pointer;
  padding: 8px 12px;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
}

.ej-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ej-btn:disabled {
  opacity: .35;
  cursor: default;
}

.ej-btn.is-primary {
  order: -1;
  padding-inline: 15px;
  border-radius: 22px;
  background: var(--ej-active);
  border-color: var(--ej-active);
  color: var(--ej-on-active);
}

.ej-btn:not(:disabled):hover {
  border-color: var(--ej-active);
  color: var(--ej-active);
}

.ej-btn.is-primary:not(:disabled):hover {
  color: var(--ej-on-active);
  filter: brightness(1.06);
}

.ej-btn:focus-visible, .ej-chip:focus-visible, .ej-range:focus-visible {
  outline: 2px solid var(--ej-active);
  outline-offset: 3px;
}

.ej-timeline {
  flex: 1;
  min-width: 90px;
  padding-top: 9px;
}

.ej-range {
  display: block;
  width: 100%;
  appearance: none;
  -webkit-appearance: none;
  height: 3px;
  border-radius: 2px;
  background: linear-gradient(to right, var(--ej-active) var(--ej-pct), var(--ej-line-strong) var(--ej-pct));
  cursor: pointer;
  margin: 0;
}

.ej-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--ej-active);
  border: 2px solid var(--ej-bg);
  box-shadow: 0 0 0 1px var(--ej-active);
}

.ej-range::-moz-range-thumb {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ej-active);
  border: 2px solid var(--ej-bg);
  box-shadow: 0 0 0 1px var(--ej-active);
}

.ej-chips {
  display: flex;
  justify-content: space-between;
  gap: 0;
  margin-top: 4px;
}

.ej-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  padding: 4px 1px;
  border: 0;
  background: transparent;
  color: var(--ej-ink-faint);
  font-size: 10px;
  cursor: pointer;
}

.ej-chip i {
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

.ej-chip span {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.ej-chip:hover, .ej-chip.is-done {
  color: var(--ej-ink-soft);
}

.ej-chip.is-active {
  color: var(--ej-active);
  font-weight: 700;
}

.ej-progress {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: none;
  min-width: 56px;
  max-width: 110px;
  font-size: 10px;
  line-height: 1.6;
  color: var(--ej-ink-soft);
}

.ej-progress strong {
  font-size: 11px;
  color: var(--ej-ink);
  font-weight: 500;
}

.ej-note {
  margin: 12px 0 0;
  font-size: 10px;
  line-height: 1.6;
  color: var(--ej-ink-faint);
  text-align: right;
}

@media (max-width: 1100px) {
  .ej-controls {
    flex-wrap: wrap;
    gap: 12px 18px;
  }
  .ej-progress {
    margin-left: auto;
  }
}

@media (max-width: 640px) {
  .ej {
    padding: 16px 12px 12px;
  }
  .ej-head {
    margin-bottom: 13px;
    gap: 12px;
  }
  .ej-title {
    font-size: 14px;
  }
  .ej-eyebrow {
    font-size: 9px;
  }
  .ej-scroll-hint {
    display: block;
    margin: 6px 0 0;
    font-size: 10px;
    line-height: 1.5;
    color: var(--ej-ink-faint);
  }
  .ej-narration-space {
    margin-top: 12px;
  }
  .ej-narration {
    font-size: 11px;
  }
  .ej-narration strong {
    display: block;
    margin: 0 0 2px;
  }
  .ej-controls {
    display: grid;
    grid-template-columns: minmax(0,1fr) auto;
    gap: 15px;
    margin-top: 14px;
    padding-top: 14px;
  }
  .ej-buttons {
    grid-column: 1 / -1;
    justify-content: center;
  }
  .ej-btn {
    min-height: 40px;
    padding: 8px 14px;
    font-size: 12px;
  }
  .ej-timeline {
    min-width: 0;
  }
  .ej-progress {
    max-width: 82px;
  }
  .ej-note {
    text-align: left;
    font-size: 9px;
  }
}

@media print {
  .ej-controls, .ej-scroll-hint {
    display: none;
  }
  .ej-stage {
    overflow: visible;
  }
  .ej-stage svg {
    min-width: 0;
  }
}

.ej-stage .ej-mobile-scene {
  display: none;
}

@media (max-width: 640px) {
  .ej-stage.has-mobile-scene .ej-desktop-scene {
    display: none;
  }
  .ej-stage.has-mobile-scene .ej-mobile-scene {
    display: block;
    min-width: 0;
  }
}
</style>

<style>
/* SVG 场景继承这些变量；输入与输出在明暗主题中始终保持相同语义。 */

html.dark .ej {
  --ej-bg: #0c1416;
  --ej-surface: #101b1e;
  --ej-panel: #172528;
  --ej-line: #293b3e;
  --ej-line-strong: #40565a;
  --ej-ink: #edf4f2;
  --ej-ink-soft: #a7b8b5;
  --ej-ink-faint: #718782;
  --ej-a: #65afdc;
  --ej-a-soft: rgba(74, 155, 205, .20);
  --ej-b: #e69b5d;
  --ej-b-soft: rgba(221, 137, 67, .20);
  --ej-c: #79cda0;
  --ej-c-soft: rgba(94, 188, 139, .20);
  --ej-active: #c7e4d7;
  --ej-active-soft: rgba(199, 228, 215, .10);
  --ej-on-active: #19372e;
  --ej-bad: #6f8580;
  --ej-bad-soft: rgba(111, 133, 128, .18);
  --ej-shadow: rgba(0, 0, 0, .16);
}
</style>
