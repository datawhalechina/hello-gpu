<script setup lang="ts">
import { computed, onMounted } from 'vue'
import './tokens.css'
import { ensureLoaded, progress } from './store.ts'

const props = defineProps<{ stage: string; goal: string; stars: readonly string[] }>()
const earned = computed(() => progress.stages[props.stage]?.stars ?? [])
const capped = computed(() => progress.stages[props.stage]?.answerViewed ?? false)
onMounted(ensureLoaded)
</script>

<template>
  <section class="hgp-mission" aria-label="本关任务">
    <div class="tag">任务</div>
    <p class="story"><slot /></p>
    <p class="goal">{{ goal }}</p>
    <ul class="stars">
      <li v-for="(label, i) in stars" :key="i" :class="{ earned: earned.includes(i) }">
        <span class="star" aria-hidden="true">★</span>
        <span>{{ label }}</span>
        <span class="sr-only">{{ earned.includes(i) ? '（已获得）' : '（未获得）' }}</span>
      </li>
    </ul>
    <p v-if="capped" class="note">你在挑战里看过答案，本关最高 2 星。</p>
  </section>
</template>

<style scoped>
.hgp-mission {
  position: relative;
  margin: 20px 0;
  padding: 18px 18px 12px;
  border: 1.5px solid var(--vp-c-brand-1);
  border-radius: var(--hgp-radius);
  background: var(--vp-c-brand-soft);
}
.tag {
  position: absolute;
  top: -11px;
  left: 14px;
  padding: 0 8px;
  border-radius: 4px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-size: 12px;
  font-weight: 700;
  line-height: 22px;
}
.story {
  margin: 4px 0 8px;
  color: var(--vp-c-text-2);
}
.goal {
  margin: 0 0 10px;
  font-size: 17px;
  font-weight: 600;
}
.stars {
  margin: 0;
  padding: 0;
  list-style: none;
}
.stars li {
  display: flex;
  gap: 8px;
  margin: 4px 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.star {
  color: var(--hg-border);
  transition: color var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out);
}
li.earned {
  color: var(--vp-c-text-1);
}
li.earned .star {
  color: var(--hg-warn);
}
.note {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
</style>
