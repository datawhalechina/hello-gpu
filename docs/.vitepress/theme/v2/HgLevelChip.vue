<script setup lang="ts">
/**
 * 等级与经验值芯片（设计稿 Map 画板顶栏；01 第 2.2、3 节）。
 * 顶栏和关卡状态栏（F-10）共用，数据只来自 useProgress()。
 * 关卡状态栏旁边另有「本关星级」，所以那里传 :stars="false"，不再显示全站星数。
 *
 * 存档要等 onMounted 之后才读得到（09 第 3 节），所以 loaded 之前显示占位：
 * 占位和真实内容的结构、尺寸完全一样，只有数字换成短横，进度条停在 0，
 * 这样服务端渲染和水合后的 HTML 一致，数据到位时也不会跳动。
 */
import { computed } from 'vue'
import { XP_PER_LEVEL } from '@course/progress.ts'
import { useProgress } from '@course/useProgress.ts'

const props = withDefaults(defineProps<{
  /** 显示全站累计的星数。 */
  stars?: boolean
}>(), { stars: true })

const { loaded, level, xpIntoLevel, summary } = useProgress()

const percent = computed(() => `${Math.round((xpIntoLevel.value / XP_PER_LEVEL) * 100)}%`)
const label = computed(() => {
  if (!loaded.value) return '等级与经验值读取中'
  const base = `等级 ${level.value}，本级经验 ${xpIntoLevel.value} / ${XP_PER_LEVEL}`
  return props.stars ? `${base}，已得 ${summary.value.stars} 颗星` : base
})
</script>

<template>
  <div class="hg-chip" :class="{ 'is-loading': !loaded }" role="img" :aria-label="label">
    <strong class="hg-chip__level">Lv.{{ loaded ? level : '—' }}</strong>
    <span class="hg-chip__bar" aria-hidden="true">
      <span class="hg-chip__fill" :style="{ width: loaded ? percent : '0%' }" />
    </span>
    <span class="hg-chip__xp">{{ loaded ? xpIntoLevel : '—' }}/{{ XP_PER_LEVEL }} XP</span>
    <span v-if="stars" class="hg-chip__stars">
      <span class="hg-chip__star" aria-hidden="true">★</span>{{ loaded ? summary.stars : '—' }}
    </span>
  </div>
</template>

<style scoped>
.hg-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  color: var(--hg-ink-2);
  white-space: nowrap;
}

.hg-chip__level,
.hg-chip__stars {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--hg-font-display);
  font-size: 15px;
  font-weight: 700;
  color: var(--hg-ink);
}

.hg-chip__star {
  color: var(--hg-amber);
}

.hg-chip__bar {
  width: 110px;
  height: 6px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-border);
  overflow: hidden;
}

.hg-chip__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--hg-accent);
  transition: width var(--motion-base) var(--motion-ease-out);
}

.hg-chip__xp {
  font-variant-numeric: tabular-nums;
}

/* 占位态：数字还没读出来，用次要文字色，不抢注意力。 */
.hg-chip.is-loading .hg-chip__level,
.hg-chip.is-loading .hg-chip__stars {
  color: var(--hg-ink-3);
}

.hg-chip.is-loading .hg-chip__star {
  color: var(--hg-idle);
}

/* 手机端只留等级和星数，进度条和经验值数字收起（顶栏不溢出）。 */
@media (max-width: 767px) {
  .hg-chip {
    gap: 8px;
  }

  .hg-chip__bar,
  .hg-chip__xp {
    display: none;
  }
}
</style>
