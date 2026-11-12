<script setup lang="ts">
/**
 * 旧版教程目录页（M-01；PLAN 第 3 节的 /v1/）。docs/v1/index.md 用它。
 *
 * 列出旧版的全部章节：按篇分组的正文 20 章和 4 个附录（旧版目录 docs/.vitepress/outline.mjs），
 * 每章写编号、标题（链接到原来的地址）、一句话简介，下面是它在新版里对应的关卡（docs/course/v1-map.json）：
 * 已经上线的是链接，还在建设中的是虚线框、写「建设中」，和世界地图的说法一样。
 * 数据都在构建时就定了，不读进度存档，服务端渲染出来就是完整的页面。
 * 这是目录和表格类的页面，小核不出场（01 第 5 节）。
 */
import { useId } from 'vue'
import { withBase } from 'vitepress'
import { isPublished, stageHref, ZONES, type StageMeta } from '@course/outline.ts'
import { STATUS_TEXT } from '@course/journey.ts'
import { stagesOf, V1_CHAPTERS, V1_GROUPS } from '@course/v1.ts'

const uid = useId()

const parts = V1_GROUPS.filter((g) => g.id !== 'appendix')
const chapterCount = parts.reduce((sum, g) => sum + g.chapters.length, 0)
const appendixCount = V1_CHAPTERS.length - chapterCount
const zoneNames = ZONES.map((z) => z.name).join('、')

function chipOf(stage: StageMeta) {
  return {
    id: stage.id,
    name: `${stage.code} ${stage.title}`,
    subtitle: stage.subtitle,
    href: isPublished(stage) ? withBase(stageHref(stage)) : '',
  }
}

const groups = V1_GROUPS.map((g) => ({
  id: g.id,
  eyebrow: g.id === 'appendix' ? 'APPENDIX' : `PART ${g.id.slice(4)}`,
  heading: g.id === 'appendix' ? g.title : `${g.label} ${g.title}`,
  jump: g.id === 'appendix' ? g.label : `${g.label} ${g.title}`,
  landing: g.landing ? withBase(g.landing) : '',
  rows: g.chapters.map((c) => ({ ...c, href: withBase(c.path), stages: stagesOf(c.path).map(chipOf) })),
}))
</script>

<template>
  <div class="v1">
    <section class="v1-intro" :aria-labelledby="`${uid}-intro`">
      <h2 :id="`${uid}-intro`" class="v1-hidden">关于旧版教程</h2>
      <!-- 中文段落写在一行里：模板里的换行会变成一个空格。 -->
      <p class="v1-intro__lead">这是旧版教程，内容仍然可用。</p>
      <p>旧版按章节写：{{ parts.length }} 篇正文共 {{ chapterCount }} 章，另有 {{ appendixCount }} 个附录。每一章原来的地址都没变，收藏的链接照样能打开。</p>
      <p>新版把这些内容拆成了{{ zoneNames }}里的关卡。每章下面列出它在新版里对应的关卡：已经上线的可以直接进去，还在建设中的先读旧版这一章。全部关卡在<a :href="withBase('/world/')">世界地图</a>上。</p>
      <nav class="v1-jump" aria-label="按篇跳转">
        <a v-for="g in groups" :key="g.id" :href="`#${g.id}`">{{ g.jump }}</a>
      </nav>
    </section>

    <section
      v-for="g in groups"
      :id="g.id"
      :key="g.id"
      class="v1-group"
      :aria-labelledby="`${uid}-${g.id}`"
    >
      <header class="v1-group__head">
        <p class="v1-group__eyebrow">{{ g.eyebrow }}</p>
        <h2 :id="`${uid}-${g.id}`" class="v1-group__name">{{ g.heading }}</h2>
        <a v-if="g.landing" class="v1-group__landing" :href="g.landing">本篇读法与实验说明</a>
      </header>

      <ol class="v1-list">
        <li v-for="c in g.rows" :key="c.path" class="v1-row">
          <span class="v1-row__label">{{ c.label }}</span>
          <div class="v1-row__body">
            <h3 class="v1-row__name"><a class="v1-row__link" :href="c.href">{{ c.title }}</a></h3>
            <p class="v1-row__summary">{{ c.summary }}</p>
            <div class="v1-row__new">
              <span class="v1-row__key" aria-hidden="true">新版</span>
              <ul class="v1-chips" :aria-label="`${c.label}在新版里对应的关卡`">
                <li v-for="s in c.stages" :key="s.id">
                  <a v-if="s.href" class="v1-chip" :href="s.href">{{ s.name }}<span class="v1-chip__sub">{{ s.subtitle }}</span></a>
                  <span v-else class="v1-chip is-soon">{{ s.name }}<span class="v1-chip__sub">{{ s.subtitle }}</span><span class="v1-chip__soon">{{ STATUS_TEXT.soon }}</span></span>
                </li>
              </ul>
            </div>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.v1 {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.v1-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* 目录里的二级、三级标题：去掉正文标题的分隔线和大间距，间距由卡片给。 */
.v1 h2,
.v1 h3 {
  margin: 0;
  padding: 0;
  border: 0;
}

/* ---------- 页首：这是旧版、地址没变、和新版的关系、按篇跳转 ---------- */

.v1-intro {
  padding: 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.v1-intro p {
  margin: 0 0 8px;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.v1-intro .v1-intro__lead {
  color: var(--hg-ink);
  font-size: var(--hg-text-card-title);
  font-weight: 600;
}

.v1-jump {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}

.v1-jump a {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-ink-2);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.v1-jump a:hover {
  border-color: var(--hg-ink-3);
  color: var(--hg-ink);
}

.v1-jump a:focus-visible,
.v1-group__landing:focus-visible,
.v1-row__link:focus-visible,
.v1-chip:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

@media (min-width: 900px) {
  .v1-intro {
    padding: 24px 28px;
  }
}

/* ---------- 一篇一张卡 ---------- */

.v1-group {
  padding: 18px 16px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.v1-group__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
  margin: 0 0 14px;
}

.v1-group__eyebrow {
  flex: 1 1 100%;
  margin: 0;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  letter-spacing: var(--hg-tracking-eyebrow);
}

.v1-group__name {
  font-family: var(--hg-font-display);
  font-size: 22px;
  line-height: 1.3;
}

.v1-group__landing {
  margin-left: auto;
  color: var(--hg-accent-ink);
  font-size: 14px;
  font-weight: 600;
}

.v1-list {
  margin: 0;
  padding: 0;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  list-style: none;
  overflow: hidden;
}

/* 一章：编号 | 标题、简介、新版对应的关卡。 */
.v1-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px 16px;
  margin: 0;
  padding: 14px 16px;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.v1-row:first-child {
  border-top: 0;
}

.v1-row__label {
  color: var(--hg-ink-3);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.6;
}

.v1-row__body {
  min-width: 0;
}

.v1-row__name {
  margin: 0 0 4px !important;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  line-height: 1.35;
}

.v1-row__link {
  color: var(--hg-ink);
  text-decoration: none;
}

.v1-row__link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.v1-row__summary {
  margin: 0 0 8px;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.55;
}

.v1-row__new {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.v1-row__key {
  flex: none;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.v1-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.v1-chips li {
  margin: 0;
}

/* 已上线的关卡：实线描边、能点；建设中：虚线、暗一档，不是链接（同世界地图）。 */
.v1-chip {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 6px;
  max-width: 100%;
  padding: 2px 10px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 55%, var(--hg-border));
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.6;
  text-decoration: none;
}

a.v1-chip:hover {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

.v1-chip__sub {
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 400;
}

.v1-chip.is-soon {
  border-style: dashed;
  border-color: var(--hg-idle);
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font-weight: 500;
}

.v1-chip.is-soon .v1-chip__sub {
  color: var(--hg-ink-3);
}

.v1-chip__soon {
  color: var(--hg-ink-3);
  font-size: 12px;
}

@media (min-width: 768px) {
  .v1-group {
    padding: 22px 22px 20px;
  }

  .v1-row {
    grid-template-columns: 64px minmax(0, 1fr);
    padding: 16px 20px;
  }

  .v1-row__label {
    padding-top: 2px;
  }
}
</style>
