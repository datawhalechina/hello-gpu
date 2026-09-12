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

    <div class="ej-stage">
      <svg :viewBox="meta.viewBox" role="img" :aria-label="stageLabel">
        <slot name="stage" :step="clock.stepIndex.value" :local="clock.stepLocal.value" />
      </svg>
    </div>

    <p class="ej-scroll-hint">左右滑动画布，查看完整过程</p>

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
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3 5.5 8l5 5" /></svg>
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
        </button>
        <button
          type="button"
          class="ej-btn"
          :disabled="clock.stepIndex.value === clock.stepCount.value - 1"
          aria-label="下一步"
          @click="manualStep(1)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5.5 3 5 5-5 5" /></svg>
        </button>
      </div>
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
    </div>

    <p class="ej-note">算法过程示意 · 可单步查看、拖动进度或播放；动画速度不代表 GPU 耗时。</p>

    <div class="ej-chips">
      <button
        v-for="(step, index) in meta.steps"
        :key="step.label"
        type="button"
        class="ej-chip"
        :class="{ 'is-active': index === clock.stepIndex.value }"
        @click="manualGo(index)"
      >
        <i aria-hidden="true">{{ index + 1 }}</i>{{ step.label }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.ej {
  /* 视觉 token：全书统一的语义配色（输入 A=青、输入 B=琥珀、输出 C=玫红，
     活动=靛蓝、禁用/越界=中性灰），明暗主题各一份，场景内 SVG 只引用变量。 */
  --ej-bg: #ffffff;
  --ej-surface: #f8fafc;
  --ej-panel: #f1f5f9;
  --ej-line: #e2e8f0;
  --ej-line-strong: #cbd5e1;
  --ej-ink: #0f172a;
  --ej-ink-soft: #64748b;
  --ej-ink-faint: #94a3b8;
  --ej-a: #0891b2;
  --ej-a-soft: rgba(8, 145, 178, 0.13);
  --ej-b: #d97706;
  --ej-b-soft: rgba(217, 119, 6, 0.15);
  --ej-c: #db2777;
  --ej-c-soft: rgba(219, 39, 119, 0.12);
  --ej-active: #4f46e5;
  --ej-active-soft: rgba(79, 70, 229, 0.1);
  --ej-bad: #94a3b8;
  --ej-bad-soft: rgba(148, 163, 184, 0.16);
  --ej-shadow: rgba(15, 23, 42, 0.08);

  scroll-margin-top: calc(var(--vp-layout-top-height, 0px) + var(--vp-nav-height, 64px) + 64px);
  border: 1px solid var(--ej-line);
  border-radius: 12px;
  background: var(--ej-bg);
  padding: 14px 16px 12px;
  box-shadow: 0 1px 3px var(--ej-shadow);
}

.ej-note { font-size: 12px; line-height: 1.5; color: var(--ej-ink-soft); margin: 10px 0 0; }

.ej:focus-visible {
  outline: 2px solid var(--ej-active);
  outline-offset: 2px;
}

.ej-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.ej-headings {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ej-eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ej-active);
}

.ej-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ej-ink);
}

.ej-count {
  flex: none;
  font-size: 12px;
  color: var(--ej-ink-faint);
  font-variant-numeric: tabular-nums;
}

.ej-count b {
  color: var(--ej-ink);
  font-size: 15px;
}

.ej-count i {
  font-style: normal;
  margin: 0 2px;
}

.ej-stage {
  border: 1px solid var(--ej-line);
  border-radius: 10px;
  background: var(--ej-surface);
  overflow: hidden;
}

.ej-stage svg {
  display: block;
  width: 100%;
  height: auto;
  min-width: 560px;
}

.ej-stage { overflow-x: auto; }

.ej-scroll-hint { display: none; }

.ej-narration-space { display: grid; }

.ej-narration-measure {
  visibility: hidden;
  pointer-events: none;
  user-select: none;
}

.ej-narration {
  grid-area: 1 / 1;
  min-width: 0;
  margin: 10px 2px 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--ej-ink-soft);
}

.ej-narration strong {
  color: var(--ej-ink);
  font-weight: 600;
  margin-right: 8px;
}

.ej-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
}

.ej-buttons {
  display: flex;
  gap: 6px;
  flex: none;
}

.ej-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--ej-line-strong);
  background: var(--ej-bg);
  color: var(--ej-ink-soft);
  cursor: pointer;
  padding: 0;
}

.ej-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ej-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.ej-btn.is-primary {
  background: var(--ej-active);
  border-color: var(--ej-active);
  color: #ffffff;
}

.ej-btn.is-primary svg { fill: none; stroke: currentColor; }

.ej-btn:not(:disabled):hover {
  border-color: var(--ej-active);
  color: var(--ej-active);
}

.ej-btn.is-primary:not(:disabled):hover {
  color: #ffffff;
  filter: brightness(1.08);
}

.ej-range {
  flex: 1;
  appearance: none;
  -webkit-appearance: none;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--ej-active) var(--ej-pct),
    var(--ej-line-strong) var(--ej-pct)
  );
  cursor: pointer;
  margin: 0;
}

.ej-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--ej-bg);
  border: 2.5px solid var(--ej-active);
  box-shadow: 0 1px 4px var(--ej-shadow);
}

.ej-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--ej-bg);
  border: 2.5px solid var(--ej-active);
  box-shadow: 0 1px 4px var(--ej-shadow);
}

.ej-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.ej-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px 3px 5px;
  border-radius: 999px;
  border: 1px solid var(--ej-line-strong);
  background: transparent;
  color: var(--ej-ink-soft);
  font-size: 12px;
  cursor: pointer;
}

.ej-chip i {
  font-style: normal;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--ej-panel);
  color: var(--ej-ink-faint);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.ej-chip.is-active {
  border-color: var(--ej-active);
  background: var(--ej-active-soft);
  color: var(--ej-ink);
  font-weight: 600;
}

.ej-chip.is-active i {
  background: var(--ej-active);
  color: #ffffff;
}

@media (max-width: 640px) {
  .ej-scroll-hint {
    display: block;
    margin: 6px 2px 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--ej-ink-soft);
  }

  .ej {
    padding: 12px 12px 10px;
  }

  .ej-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .ej-buttons {
    justify-content: center;
  }

  .ej-chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .ej-chip {
    flex: none;
  }
}
</style>

<style>
/* 暗色主题 token：独立非 scoped 块，确保 html.dark 选择器原样输出。
   .ej 类名为本组件独有，全局声明安全。 */
html.dark .ej {
  --ej-bg: #101828;
  --ej-surface: #0c1424;
  --ej-panel: #17223a;
  --ej-line: #263450;
  --ej-line-strong: #3b4d6d;
  --ej-ink: #e6edf7;
  --ej-ink-soft: #9aa8bf;
  --ej-ink-faint: #64748b;
  --ej-a: #22d3ee;
  --ej-a-soft: rgba(34, 211, 238, 0.14);
  --ej-b: #fbbf24;
  --ej-b-soft: rgba(251, 191, 36, 0.15);
  --ej-c: #f472b6;
  --ej-c-soft: rgba(244, 114, 182, 0.15);
  --ej-active: #818cf8;
  --ej-active-soft: rgba(129, 140, 248, 0.14);
  --ej-bad: #64748b;
  --ej-bad-soft: rgba(100, 116, 139, 0.22);
  --ej-shadow: rgba(0, 0, 0, 0.32);
}
</style>
