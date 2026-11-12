<script setup lang="ts">
/**
 * 概念卡：新术语第一次正式出现的地方（03 第 1 节第 5 条、04 第 5 节、06 第 3 节第 5 项）。
 * 定义、比喻和比喻边界都从 docs/course/glossary.json 读，页面里只写术语的 key，不重复写定义（06 第 6 节）。
 * 卡片进入视口后收入图鉴（collectTerm），记下是在哪一关学到的（页面 frontmatter 的 stage），
 * 顺带判一次徽章（「图鉴收集家」）。版式取自设计稿 Stage 的 NEW TERM 卡片，颜色全部走 tokens.css。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <ConceptCard term="block" />
 *   <ConceptCard term="global-index" code="blockIdx.x * blockDim.x + threadIdx.x">
 *   默认插槽写它在这一关里的样子（可以不写），不要重复定义。
 *   </ConceptCard>
 *
 * term 在术语表里找不到时：开发时页面上显示红框警告，构建时直接报错。
 */
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useData, withBase } from 'vitepress'
import { GLOSSARY, termName } from '@course/glossary.ts'
import { useProgress } from '@course/useProgress.ts'
import { contentError } from './contentError.ts'

const props = defineProps<{
  /** glossary.json 里的键，例如 block、global-index。 */
  term: string
  /** 它在代码里的写法，等宽显示，例如 blockIdx.x。 */
  code?: string
}>()

const { frontmatter, page } = useData()
const progress = useProgress()
const titleId = `${useId()}-term`

const entry = computed(() => GLOSSARY[props.term] ?? null)
const problem = computed(() => (entry.value
  ? ''
  : contentError(
      `ConceptCard 的 term="${props.term}" 在 docs/course/glossary.json 里找不到。检查拼写，或者先在术语表里登记这个术语。`,
      page.value.relativePath,
    )))

/** 首次出现写成「中文（English）」（05 第 3 节）；不翻译的术语只写一次。 */
const name = computed(() => termName(props.term))

const stageId = computed(() => (typeof frontmatter.value.stage === 'string' ? frontmatter.value.stage : ''))
const collected = computed(() => progress.hasTerm(props.term))
/** 冒险者手册（P-05）的术语索引按 glossary 的 key 做锚点。 */
const handbookHref = computed(() => withBase(`/handbook/#${props.term}`))

const root = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function collect() {
  progress.collectTerm(props.term, stageId.value)
  progress.checkBadges({ stage: stageId.value || undefined })
}

// 卡片露出大半（或者高到占了半屏）才算读到，滚动掠过不算。
onMounted(() => {
  if (!entry.value || collected.value || !root.value) return
  if (typeof IntersectionObserver === 'undefined') {
    collect()
    return
  }
  observer = new IntersectionObserver((records) => {
    const seen = records.some((r) =>
      r.isIntersecting && (r.intersectionRatio >= 0.6 || r.intersectionRect.height >= window.innerHeight * 0.5))
    if (!seen) return
    observer?.disconnect()
    observer = null
    collect()
  }, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] })
  observer.observe(root.value)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section ref="root" class="hg-concept" :class="{ 'is-broken': !entry }" :aria-labelledby="entry ? titleId : undefined">
    <template v-if="entry">
      <div class="hg-concept__main">
        <p class="hg-concept__head">
          <span class="hg-concept__eyebrow" aria-hidden="true">NEW TERM</span>
          <strong :id="titleId" class="hg-concept__name">{{ name }}</strong>
          <code v-if="code" class="hg-concept__code">{{ code }}</code>
        </p>
        <p class="hg-concept__short">{{ entry.short }}</p>
        <dl v-if="entry.analogy" class="hg-concept__analogy">
          <div>
            <dt>比喻</dt>
            <dd>{{ entry.analogy }}</dd>
          </div>
          <div v-if="entry.analogyLimit">
            <dt>比喻的边界</dt>
            <dd>{{ entry.analogyLimit }}</dd>
          </div>
        </dl>
        <div v-if="$slots.default" class="hg-concept__more"><slot /></div>
        <a class="hg-concept__link" :href="handbookHref">在冒险者手册里查看</a>
      </div>
      <!-- 收没收进图鉴：文字不同，收进以后多一个对勾（01 第 7 节，不只靠颜色）。 -->
      <span class="hg-concept__badge" :class="{ 'is-collected': collected }" role="status">
        <svg v-if="collected" class="hg-concept__check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
        {{ collected ? '已收入图鉴' : '新术语' }}
      </span>
    </template>
    <p v-else class="hg-concept__error" role="alert" data-hg-content-error>{{ problem }}</p>
  </section>
</template>

<style scoped>
.hg-concept {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 16px;
  margin: 20px 0;
  padding: 16px 20px;
  /* 设计稿是浅紫底配淡紫描边：用紫色和表面色、描边色混出来，亮暗主题都跟着变。 */
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-violet) 35%, var(--hg-border));
  border-radius: var(--hg-radius-card);
  background: color-mix(in srgb, var(--hg-violet) 7%, var(--hg-surface));
  color: var(--hg-ink);
}

.hg-concept__main {
  flex: 1 1 22em;
  min-width: 0;
}

.hg-concept__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0;
}

.hg-concept__eyebrow {
  color: var(--hg-violet-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-concept__name {
  font-family: var(--hg-font-display);
  font-size: 17px;
  font-weight: 700;
}

.hg-concept__code {
  padding: 1px 6px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.hg-concept__short {
  margin: 4px 0 0;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: var(--hg-leading-body);
}

.hg-concept__analogy {
  display: grid;
  gap: 4px;
  margin: 10px 0 0;
  padding: 10px 14px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  font-size: 14px;
  line-height: 1.6;
}

.hg-concept__analogy div {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
}

.hg-concept__analogy dt {
  flex: none;
  min-width: 5.5em;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-concept__analogy dd {
  flex: 1 1 14em;
  margin: 0;
  color: var(--hg-ink-2);
}

.hg-concept__more {
  margin-top: 8px;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: var(--hg-leading-body);
}

.hg-concept__more :deep(p) {
  margin: 0 0 6px;
}

.hg-concept__more :deep(p:last-child) {
  margin-bottom: 0;
}

.hg-concept__link {
  display: inline-block;
  margin-top: 8px;
  color: var(--hg-accent-ink);
  font-size: 14px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.hg-concept__link:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
  border-radius: var(--hg-radius-tag);
}

.hg-concept__badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-violet) 35%, var(--hg-border));
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-violet-ink);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition: color var(--motion-base) var(--motion-ease-out);
}

.hg-concept__check {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 术语键写错：只在开发时看得到（构建会直接失败），所以要足够醒目。 */
.hg-concept.is-broken {
  border: 2px dashed var(--hg-error);
  background: var(--hg-error-soft);
}

.hg-concept__error {
  margin: 0;
  color: var(--hg-error-ink);
  font-weight: 600;
}

@media (max-width: 480px) {
  .hg-concept {
    padding: 14px 16px;
  }
}
</style>
