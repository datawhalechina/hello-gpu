<script setup lang="ts">
/**
 * 任务卡：一句话任务 + 星级标准 + 已经拿到的星（03 第 1 节第 1/6 条、第 3 节组件登记表）。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <Mission
 *     stage="novice-thread-groups"
 *     goal="派出刚好够用的线程，把 10 对数全部加完，而且谁都不能写到数组外面。"
 *     :stars="['所有数都算对', '没有线程白跑一趟', '换一种每组人数也成立']"
 *   >
 *   默认插槽是故事或补充说明，可以不写。
 *   </Mission>
 *
 * 星级标准在关卡开头公示（03 第 1 节第 6 条），拿到第几颗就点亮第几行；
 * 星从进度存档里读（F-04），stage 是 outline.json 里的关卡 id；副本页（X-01）写副本 id，读的是副本的星。
 * 读存档只在浏览器里发生，服务端渲染时是一张「还没拿星」的卡，水合前后结构一致。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { MAX_STARS_AFTER_ANSWER } from '@course/progress.ts'
import { exerciseById } from '@course/outline.ts'
import { useProgress } from '@course/useProgress.ts'

const props = withDefaults(defineProps<{
  /** 关卡 id（outline.json 里的那个），用它从存档里读已经拿到的星；副本页写副本 id（dungeon-…）。 */
  stage: string
  /** 一句话任务：用读者的话说，成败可以判定。 */
  goal: string
  /** 星级标准，从 ★1 到 ★3；少写几条也可以。 */
  stars?: readonly string[]
}>(), { stars: () => [] })

const progress = useProgress()
const exercise = computed(() => Boolean(exerciseById(props.stage)))
/** 关卡和副本的进度都有 stars、answerViewed 两项，任务卡只看这两项。 */
const record = computed(() => (exercise.value ? progress.exercise(props.stage) : progress.stage(props.stage)))
const earned = computed(() => record.value.stars)
/** 在挑战里看过答案：本关（这道题）此后最高 2 星（03 第 4 节、04 第 3 节）。 */
const capped = computed(() => record.value.answerViewed)
const scope = computed(() => (exercise.value ? '这道题' : '本关'))

const rows = computed(() => props.stars.map((label, index) => ({
  label,
  index,
  earned: earned.value.includes(index),
})))

const summary = computed(
  () => `${scope.value}任务：${props.goal} 星级标准 ${props.stars.length} 条，已获得 ${earned.value.length} 颗星。`,
)

/**
 * 只有「这次刚拿到」的星才播点亮动效（02 第 6 节：依次点亮，每颗间隔 150 ms，
 * 放大到 1.15 再回落）；重新打开页面时不会把旧的星再庆祝一遍。
 */
const fresh = ref<readonly number[]>([])
let timer = 0

onMounted(() => {
  let known = [...earned.value]
  watch(() => earned.value.join(','), () => {
    const added = earned.value.filter((i) => !known.includes(i))
    known = [...earned.value]
    if (added.length === 0) return
    fresh.value = added
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { fresh.value = [] }, 1600)
  })
})
</script>

<template>
  <section class="hg-mission" :aria-label="summary">
    <span class="hg-mission__eyebrow" aria-hidden="true">MISSION</span>
    <p class="hg-mission__goal">{{ goal }}</p>

    <ul v-if="rows.length" class="hg-mission__stars">
      <li
        v-for="row in rows"
        :key="row.index"
        class="hg-mission__row"
        :class="{ 'is-earned': row.earned, 'is-fresh': fresh.includes(row.index) }"
        :style="{ '--hg-star-delay': `${row.index * 150}ms` }"
      >
        <span class="hg-mission__star" aria-hidden="true">{{ row.earned ? '★' : '☆' }}</span>
        <span class="hg-mission__label">{{ row.label }}</span>
        <span class="hg-mission__state">{{ row.earned ? '已获得' : '未获得' }}</span>
      </li>
    </ul>

    <p v-if="capped" class="hg-mission__note">
      你在挑战里看过答案，{{ scope }}最高 {{ MAX_STARS_AFTER_ANSWER }} 星。
    </p>

    <div v-if="$slots.default" class="hg-mission__story"><slot /></div>
  </section>
</template>

<style scoped>
.hg-mission {
  margin: 20px 0;
  padding: 20px 22px;
  /* 设计稿是浅青底配同色描边；描边由强调色和描边色混出来，换区域时跟着换。 */
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-card);
  background: var(--hg-accent-soft);
  color: var(--hg-ink);
}

.hg-mission__eyebrow {
  display: block;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-mission__goal {
  margin: 4px 0 10px;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  font-weight: 700;
  line-height: 1.5;
}

.hg-mission__stars {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 不靠颜色单独表达信息（01 第 7 节）：实心 ★ / 空心 ☆ + 「已获得 / 未获得」文字。 */
.hg-mission__row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  color: var(--hg-ink-3);
  font-size: 15px;
  line-height: 1.6;
}

.hg-mission__row.is-earned {
  color: var(--hg-ink);
}

.hg-mission__star {
  flex: none;
  color: var(--hg-idle);
  font-size: 18px;
  line-height: 1.4;
  transition: color var(--motion-base) var(--motion-ease-out);
}

.hg-mission__row.is-earned .hg-mission__star {
  color: var(--hg-amber);
}

.hg-mission__label {
  flex: 1;
  min-width: 0;
}

.hg-mission__state {
  flex: none;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-mission__row.is-earned .hg-mission__state {
  color: var(--hg-amber-ink);
}

.hg-mission__note {
  margin: 10px 0 0;
  color: var(--hg-amber-ink);
  font-size: 13px;
}

.hg-mission__story {
  margin-top: 10px;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: var(--hg-leading-body);
}

.hg-mission__story :deep(p) {
  margin: 0 0 6px;
}

.hg-mission__story :deep(p:last-child) {
  margin-bottom: 0;
}

@media (max-width: 480px) {
  .hg-mission {
    padding: 16px 16px;
  }
  .hg-mission__row {
    flex-wrap: wrap;
  }
}

/* 拿星：放大到 1.15 再回落，每颗间隔 150 ms（02 第 6 节）。只给这次新拿到的星。 */
@keyframes hg-mission-star {
  0% { transform: scale(1); }
  45% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

.hg-mission__row.is-fresh .hg-mission__star {
  animation: hg-mission-star var(--motion-slow) var(--motion-ease-out-back) var(--hg-star-delay) both;
}

/*
 * 减弱动效（02 第 4 节）：系统设置和站点设置（布局根元素的 data-hg-motion="reduce"）
 * 都要关掉缩放；自定义 @keyframes 不受时长 token 影响，这里单独处理。
 */
@media (prefers-reduced-motion: reduce) {
  .hg-mission__row.is-fresh .hg-mission__star {
    animation: none;
  }
}

[data-hg-motion='reduce'] .hg-mission__row.is-fresh .hg-mission__star {
  animation: none;
}
</style>
