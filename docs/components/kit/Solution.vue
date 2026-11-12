<script setup lang="ts">
/**
 * 副本的题解（X-01；副本骨架「题解：通关或看答案后展开」，03 第 4 节「提示阶梯」）。
 *
 * 用法（组件已全局注册，副本页的 Markdown 里直接写，放在「## 题解」下面）：
 *   <Solution>
 *
 *   题解正文：思路、关键代码（LangCode / RouteBlock）、为什么这样写……
 *
 *   </Solution>
 *
 * 通关（挑战拿到 ★1，结果正确）或者在挑战里看过答案（提示阶梯第三级）以后才展开；之前只说怎么解锁，
 * 题解内容不渲染，读者先自己做。副本 id 从页面 frontmatter 的 dungeon 读，预览页用 exercise 属性指定。
 * 读存档只在浏览器里发生：服务端渲染和水合时一律是收起的样子，读完存档才展开，不会先闪出题解。
 * 读者这一次刚解锁时用 aria-live 播报一句，焦点不动。
 */
import { computed, ref, useId, watch } from 'vue'
import { useData } from 'vitepress'
import { exerciseById } from '@course/outline.ts'
import { useProgress } from '@course/useProgress.ts'
import { contentError } from './contentError.ts'

const props = defineProps<{
  /** 副本 id（outline.json 的 exercises 里的 dungeon-…）；不写就用页面 frontmatter 的 dungeon。 */
  exercise?: string
}>()

const { frontmatter, page } = useData()
const progress = useProgress()
const uid = useId()

const id = computed(() => props.exercise ?? (typeof frontmatter.value.dungeon === 'string' ? frontmatter.value.dungeon : ''))

const problem = computed(() => {
  if (exerciseById(id.value)) return ''
  const what = id.value
    ? `题解（Solution）找不到副本 ${id.value}：检查 frontmatter 的 dungeon 或 exercise 属性，要写 outline.json 的 exercises 里的 id。`
    : '题解（Solution）只能用在副本页：frontmatter 要写 dungeon，或者给它 exercise 属性。'
  return contentError(what, page.value.relativePath)
})

const record = computed(() => progress.exercise(id.value))
const unlocked = computed(() => record.value.completed || record.value.answerViewed)
/** 存档读出来之前一律收着（服务端渲染也是这样），水合前后一致。 */
const open = computed(() => progress.loaded.value && unlocked.value)

const why = computed(() => (record.value.completed
  ? '你已经通关了，下面是参考思路，和你的做法对照着看。'
  : '你在提示阶梯里看过答案，题解也一起展开了。'))

/**
 * 这一次刚解锁才播报：存档读出来那一刻已经解锁的（以前就通关了）不算。
 * 读存档和 loaded 在同一拍里变，第一次看到 loaded 时记下当时的状态作基准。
 */
const announce = ref('')
let baseline: boolean | null = null
watch([() => progress.loaded.value, unlocked], ([loaded, now]) => {
  if (!loaded) return
  if (baseline === null) {
    baseline = now
    return
  }
  if (now && !baseline) announce.value = '题解展开了，就在挑战下面。'
  baseline = now
}, { immediate: true })
</script>

<template>
  <section class="hg-solution" :class="{ 'is-open': open }" :aria-labelledby="`${uid}-label`">
    <p v-if="problem" class="hg-solution__problem" role="alert" data-hg-content-error>{{ problem }}</p>

    <header class="hg-solution__head">
      <span class="hg-solution__eyebrow" aria-hidden="true">SOLUTION</span>
      <span :id="`${uid}-label`" class="hg-solution__label">题解</span>
      <span class="hg-solution__state">{{ open ? '已展开' : '通关后展开' }}</span>
    </header>

    <div v-if="open" class="hg-solution__body">
      <p class="hg-solution__why">{{ why }}</p>
      <slot />
    </div>
    <p v-else class="hg-solution__locked">
      先自己试试：挑战拿到第一颗星（结果正确）以后，题解在这里展开。卡住了就看上面的提示阶梯，没过 6 次可以看答案，看过答案题解也会展开。
    </p>

    <p class="hg-solution__live" aria-live="polite">{{ announce }}</p>
  </section>
</template>

<style scoped>
.hg-solution {
  margin: 20px 0;
  padding: 18px 20px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
}

/* 展开以后是实线卡片，和正文的其他卡片一样。 */
.hg-solution.is-open {
  border-style: solid;
  border-color: var(--hg-border);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
}

.hg-solution__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.hg-solution__eyebrow {
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-solution__label {
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  font-weight: 700;
}

.hg-solution__state {
  margin-left: auto;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-solution__problem {
  margin: 0 0 12px;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

.hg-solution__locked {
  margin: 8px 0 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.hg-solution__why {
  margin: 8px 0 12px;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.hg-solution__body > :last-child {
  margin-bottom: 0;
}

.hg-solution__live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
