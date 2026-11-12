<script setup lang="ts">
/**
 * 关卡状态栏的提示按钮（F-12；03 第 3 节 StageLayout「提示按钮」）。
 *
 * 打开一块挂在状态栏下面的面板，里面是本页挑战的提示阶梯（HintLadder）：
 * 最近动过的那个挑战；都没动过就是本关的星级挑战。和正文里内嵌的那份是同一个状态。
 * 按钮上的数字是已经解锁到第几级。Esc 或点面板外面关掉，焦点回到按钮。
 *
 * 挑战只在浏览器里登记（挂载以后），服务端渲染时按钮上没有数字，水合前后一致。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { activeChallenge } from '@course/useChallenge.ts'
import HintLadder from '@kit/HintLadder.vue'

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)

const level = computed(() => activeChallenge.value?.level.value ?? 0)
const label = computed(() => (level.value ? `提示（已解锁 ${level.value} 级）` : '提示'))

function onOutside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close(false)
}

function close(refocus = true) {
  open.value = false
  if (refocus) button.value?.focus()
}

async function toggle() {
  open.value = !open.value
  if (!open.value) return
  await nextTick()
  panel.value?.focus()
}

watch(open, (now) => {
  if (now) document.addEventListener('pointerdown', onOutside)
  else document.removeEventListener('pointerdown', onOutside)
})

onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside))
</script>

<template>
  <div ref="root" class="hg-hintbtn" @keydown.esc="open && close()">
    <button
      ref="button"
      type="button"
      class="hg-hintbtn__button"
      :aria-expanded="open"
      aria-controls="hg-hint-panel"
      :aria-label="label"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" />
      </svg>
      <span class="hg-hintbtn__text" aria-hidden="true">提示</span>
      <span v-if="level" class="hg-hintbtn__badge" aria-hidden="true">{{ level }}</span>
    </button>

    <div
      v-if="open"
      id="hg-hint-panel"
      ref="panel"
      class="hg-hintbtn__panel"
      role="dialog"
      aria-label="提示"
      tabindex="-1"
    >
      <HintLadder v-if="activeChallenge" :challenge="activeChallenge" />
      <p v-else class="hg-hintbtn__empty">这一页还没有带提示的挑战。挑战里没过两次，这里就会给出第一条提示。</p>
    </div>
  </div>
</template>

<style scoped>
.hg-hintbtn__button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink-2);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.hg-hintbtn__button:hover,
.hg-hintbtn__button[aria-expanded='true'] {
  border-color: var(--hg-amber);
  color: var(--hg-ink);
}

.hg-hintbtn__button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-hintbtn__button svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hg-hintbtn__badge {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-amber);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 700;
}

/* 面板挂在吸顶状态栏的下沿（状态栏是最近的定位祖先），跟着状态栏走。 */
.hg-hintbtn__panel {
  position: absolute;
  top: calc(100% + 8px);
  right: max(24px, calc((100% - 1440px) / 2 + 24px));
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100vh - 140px);
  overflow-y: auto;
  border-radius: var(--hg-radius-card);
  outline: none;
}

.hg-hintbtn__panel :deep(.hg-hint) {
  margin: 0;
}

.hg-hintbtn__empty {
  margin: 0;
  padding: 16px 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink-2);
  font-size: 14px;
}

@media (max-width: 1023px) {
  .hg-hintbtn__text {
    display: none;
  }
}

@media (max-width: 767px) {
  .hg-hintbtn__panel {
    right: 16px;
    left: 16px;
    width: auto;
  }
}
</style>
