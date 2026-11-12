<script setup lang="ts">
/**
 * 外部题卡片（X-01 做的卡片；X-08 改成只写 id，内容从 docs/course/external-problems.json 读）。
 *
 * 卡片上有题名、来源、许可证（链到全文）、关联关卡和原题链接，这道题有我们的原创题解时多一个「读原创题解」。
 * 只收一个 id，没有插槽，也没有任何文字属性：题面一律不进卡片，读者去原站看题。许可证跟着题库走（LeetGPU 是
 * CC BY-NC-ND 4.0，不能翻译或改编题面；GPU MODE reference-kernels 是自定义许可证，不复制内容；GPU-Puzzles 是 MIT，
 * 改编的题要写成自研副本并署名，不用这张卡），数据检查保证每道题的链接都在它的题库下面，许可证不会标错。
 * 关联关卡上线了的给链接，还没上线的只写名字；题解页自己的卡片上不再链接自己。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <ExternalProblem id="leetgpu-reduction" />
 * id 不在数据里时画红框，构建失败（F-09 的内容检查）。
 */
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { EXTERNAL_SOURCES, externalProblemById, externalSolutionHref } from '@course/externalProblems.ts'
import { isPublished, stageById, stageHref, type StageMeta } from '@course/outline.ts'
import { contentError } from './contentError.ts'

const props = defineProps<{
  /** external-problems.json 里题的 id，例如 leetgpu-reduction。 */
  id: string
}>()

const { page } = useData()

const card = computed(() => {
  const problem = externalProblemById(props.id)
  const source = problem ? EXTERNAL_SOURCES[problem.source] : undefined
  if (!problem || !source) return null
  const stages = problem.stages
    .map((id) => stageById(id))
    .filter((s): s is StageMeta => Boolean(s))
    .map((s) => ({ id: s.id, text: `${s.code} ${s.title}`, href: isPublished(s) ? withBase(stageHref(s)) : '' }))
  // 题解页是 docs/dungeon/external/<id>/index.md，地址 /dungeon/external/<id>/：在题解页上就不再链接自己。
  const solution = externalSolutionHref(problem)
  const onSolution = Boolean(solution) && page.value.relativePath === `${solution.slice(1)}index.md`
  return { problem, source, stages, solution: solution && !onSolution ? withBase(solution) : '' }
})

const error = computed(() => (card.value
  ? ''
  : contentError(`外部题卡片的 id「${props.id}」在 docs/course/external-problems.json 里找不到：检查拼写，或者先在那里登记这道题。`, page.value.relativePath)))
</script>

<template>
  <p v-if="!card" class="hg-xprob__problem" role="alert" data-hg-content-error>{{ error }}</p>
  <article v-else class="hg-xprob" :aria-label="`外部题：${card.problem.title}`">
    <span class="hg-xprob__eyebrow">EXTERNAL · 外部题</span>
    <p class="hg-xprob__title">{{ card.problem.title }}</p>
    <dl class="hg-xprob__meta">
      <div>
        <dt>来源</dt>
        <dd>{{ card.source.name }}</dd>
      </div>
      <div>
        <dt>许可证</dt>
        <dd>
          <a :href="card.source.licenseUrl" target="_blank" rel="noreferrer">{{ card.source.license }}<span class="hg-xprob__hidden">（许可证全文，在新标签页打开）</span></a>
        </dd>
      </div>
      <div v-if="card.stages.length" class="hg-xprob__stages">
        <dt>关联关卡</dt>
        <dd>
          <template v-for="(s, i) in card.stages" :key="s.id"><template v-if="i">、</template><a v-if="s.href" :href="s.href">{{ s.text }}</a><span v-else>{{ s.text }}<span class="hg-xprob__soon">（还没上线）</span></span></template>
        </dd>
      </div>
    </dl>
    <p class="hg-xprob__actions">
      <a class="hg-xprob__link" :href="card.problem.url" target="_blank" rel="noreferrer">
        去 {{ card.source.name }} 看题
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5 7 9" /></svg>
        <span class="hg-xprob__hidden">（在新标签页打开）</span>
      </a>
      <a v-if="card.solution" class="hg-xprob__link is-solution" :href="card.solution">
        读原创题解
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8h9M8.5 4l4 4-4 4" /></svg>
      </a>
    </p>
  </article>
</template>

<style scoped>
.hg-xprob {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 16px 0;
  padding: 16px 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.hg-xprob__problem {
  margin: 16px 0;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

.hg-xprob__eyebrow {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-xprob__title {
  margin: 0;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.hg-xprob__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.hg-xprob__meta div {
  display: flex;
  gap: 6px;
  min-width: 0;
}

/* 关联关卡可能有两三关，单独占一行。 */
.hg-xprob__meta .hg-xprob__stages {
  flex: 1 1 100%;
}

.hg-xprob__meta dt {
  flex: none;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  line-height: inherit;
}

.hg-xprob__meta dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.hg-xprob__meta a {
  color: var(--hg-accent-ink);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.hg-xprob__meta a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-xprob__soon {
  color: var(--hg-ink-3);
}

.hg-xprob__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0 0;
}

.hg-xprob__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: var(--hg-border-width) solid var(--hg-accent);
  border-radius: var(--hg-radius-control);
  color: var(--hg-accent-ink);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.hg-xprob__link svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hg-xprob__link:hover {
  background: var(--hg-accent-soft);
}

/* 我们自己的题解：底色先铺上，和去原站的链接分开。 */
.hg-xprob__link.is-solution {
  background: var(--hg-accent-soft);
}

.hg-xprob__link.is-solution:hover {
  background: color-mix(in srgb, var(--hg-accent) 26%, var(--hg-surface));
}

.hg-xprob__link:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-xprob__hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
