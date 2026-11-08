<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { withBase } from 'vitepress'
import './tokens.css'
import LangSwitch from './LangSwitch.vue'
import { ensureLoaded, log, progress, toasts } from './store.ts'
import { levelOf } from '../sim/progress.ts'

const props = defineProps<{
  stage: string
  zone: string
  code: string
  lv: number
  minutes: number
  hardware: string
  prereq?: { label: string; href: string }
}>()

const level = computed(() => levelOf(progress.xp))
const earned = computed(() => progress.stages[props.stage]?.stars ?? [])

let openedAt = 0
function onVisibility() {
  if (document.visibilityState === 'hidden') log(props.stage, 'stage.hidden', { ms: Date.now() - openedAt })
}
onMounted(() => {
  ensureLoaded()
  openedAt = Date.now()
  log(props.stage, 'stage.open', { w: window.innerWidth })
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  log(props.stage, 'stage.leave', { ms: Date.now() - openedAt })
})
</script>

<template>
  <div class="hgp-header">
    <div class="hgp-meta">
      <span class="hgp-zone">{{ zone }}</span>
      <span>关卡 {{ code }}</span>
      <span>推荐 Lv.{{ lv }}</span>
      <span>约 {{ minutes }} 分钟</span>
      <span>{{ hardware }}</span>
      <span v-if="prereq">前置：<a :href="withBase(prereq.href)">{{ prereq.label }}</a></span>
    </div>
    <div class="hgp-player">
      <div class="hgp-level" role="img" :aria-label="`等级 ${level.level}，本级经验 ${level.into} / ${level.need}`">
        <strong>Lv.{{ level.level }}</strong>
        <span class="hgp-bar"><span :style="{ width: `${(level.into / level.need) * 100}%` }" /></span>
        <span class="hgp-xp">{{ level.into }}/{{ level.need }} XP</span>
      </div>
      <div class="hgp-stars" role="img" :aria-label="`本关已获得 ${earned.length} 颗星`">
        <span v-for="i in 3" :key="i" :class="{ on: earned.includes(i - 1) }" aria-hidden="true">★</span>
      </div>
      <LangSwitch :stage="stage" />
    </div>
    <div class="hgp-toasts" aria-live="polite">
      <TransitionGroup name="hgp-toast">
        <div v-for="t in toasts" :key="t.id" :class="['hgp-toast', t.kind]">{{ t.text }}</div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.hgp-header {
  display: grid;
  gap: 12px;
  margin: 8px 0 24px;
  padding: 14px 16px;
  border: 1px solid var(--hg-border);
  border-radius: var(--hgp-radius);
  background: var(--hg-surface);
}
.hgp-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.hgp-zone {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.hgp-player {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 18px;
}
.hgp-level {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.hgp-bar {
  position: relative;
  width: 96px;
  height: 6px;
  border-radius: 3px;
  background: var(--hg-border);
  overflow: hidden;
}
.hgp-bar > span {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
  background: var(--hg-ok);
  transition: width var(--motion-slow) var(--ease-out);
}
.hgp-xp {
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
}
.hgp-stars span {
  font-size: 16px;
  color: var(--hg-border);
  transition: color var(--motion-base) var(--ease-out);
}
.hgp-stars span.on {
  color: var(--hg-warn);
}
.hgp-toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 100;
  display: grid;
  gap: 8px;
  justify-items: end;
  pointer-events: none;
}
.hgp-toast {
  max-width: min(320px, calc(100vw - 32px));
  padding: 8px 14px;
  border-radius: var(--hgp-radius);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--hg-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-size: 14px;
  font-weight: 600;
}
.hgp-toast.xp {
  border-color: var(--hg-ok);
}
.hgp-toast.level {
  border-color: var(--hg-warn);
  color: var(--hg-warn);
}
.hgp-toast-enter-active,
.hgp-toast-leave-active {
  transition: opacity var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out);
}
.hgp-toast-enter-from,
.hgp-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
