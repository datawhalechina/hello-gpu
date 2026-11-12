<script setup lang="ts">
/**
 * 外部练习题索引（X-08）。/dungeon/external/ 用它。
 *
 * 外部题按推荐区域分组（区域按大纲顺序，组里按第一个关联关卡在大纲里的顺序），一道题一张 ExternalProblem 卡片：
 * 题名、来源、许可证、关联关卡、原题链接和我们的原创题解都由卡片从 external-problems.json 读，这里不手写题目信息，
 * 也不写任何题面。组的锚点是区域 id，卡片的锚点是题的 id（/dungeon/external/#forge、#leetgpu-reduction）。
 * 区域卡片按区域换装（data-zone，同副本大厅）；页尾列出题库、许可证全文和最近一次核对的日期。
 * 外部题不发经验值，不读存档。
 */
import { useId } from 'vue'
import { withBase } from 'vitepress'
import { EXTERNAL_SOURCES, externalGroups } from '@course/externalProblems.ts'
import { dungeonHref } from '@course/outline.ts'

const uid = useId()

const groups = externalGroups().map((g) => ({ ...g, solutions: g.problems.filter((p) => p.solution).length }))
const sources = Object.entries(EXTERNAL_SOURCES).map(([key, source]) => ({ key, ...source }))
</script>

<template>
  <div class="xi">
    <nav class="xi-jump" aria-label="按区域跳到外部题">
      <a v-for="g in groups" :key="g.zone.id" :href="`#${g.zone.id}`" :data-zone="g.zone.id">{{ g.zone.name }}</a>
      <a href="#sources">题库和许可证</a>
    </nav>

    <section
      v-for="g in groups"
      :id="g.zone.id"
      :key="g.zone.id"
      class="xi-zone"
      :data-zone="g.zone.id"
      :aria-labelledby="`${uid}-${g.zone.id}`"
    >
      <header class="xi-zone__head">
        <p class="xi-zone__code">{{ g.zone.code }} · 推荐 Lv.{{ g.zone.lv[0] }}–{{ g.zone.lv[1] }}</p>
        <h2 :id="`${uid}-${g.zone.id}`" class="xi-zone__name">{{ g.zone.name }}</h2>
        <p class="xi-zone__count">{{ g.problems.length }} 道<template v-if="g.solutions">，{{ g.solutions }} 篇原创题解</template></p>
        <a class="xi-zone__more" :href="withBase(dungeonHref(g.zone.id))">{{ g.zone.name }}的副本</a>
      </header>

      <ul class="xi-list">
        <li v-for="p in g.problems" :id="p.id" :key="p.id" class="xi-item">
          <ExternalProblem :id="p.id" />
        </li>
      </ul>
    </section>

    <section id="sources" class="xi-sources" :aria-labelledby="`${uid}-sources`">
      <h2 :id="`${uid}-sources`" class="xi-sources__title">题库和许可证</h2>
      <p class="xi-sources__note">题面归原站所有。本站对这几个题库都只放链接，下面是它们的许可证全文和我们最近一次核对链接的日期。</p>
      <table class="xi-sources__table">
        <thead>
          <tr>
            <th scope="col">题库</th>
            <th scope="col">许可证</th>
            <th scope="col" class="xi-sources__date">核对日期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sources" :key="s.key">
            <td><a :href="s.url" target="_blank" rel="noreferrer">{{ s.name }}<span class="xi-hidden">（在新标签页打开）</span></a></td>
            <td><a :href="s.licenseUrl" target="_blank" rel="noreferrer">{{ s.license }}<span class="xi-hidden">（许可证全文，在新标签页打开）</span></a></td>
            <td class="xi-sources__date">{{ s.checked }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.xi {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.xi-hidden {
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

/* 索引里的二级标题：去掉正文标题的分隔线和大间距，间距由卡片给（同副本大厅）。 */
.xi h2 {
  margin: 0;
  padding: 0;
  border: 0;
}

/* ---------- 按区域跳转 ---------- */

.xi-jump {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.xi-jump a {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-accent-ink);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.xi-jump a:hover {
  border-color: var(--hg-accent);
}

.xi-jump a:focus-visible,
.xi-zone__more:focus-visible,
.xi-sources a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* ---------- 一个区域一张卡（同副本大厅：描边带区域强调色，试炼场用它的深紫底） ---------- */

.xi-zone {
  padding: 18px 16px 16px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.xi-zone[data-zone='trial'] {
  background: var(--hg-bg);
}

.xi-zone__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
  margin: 0 0 14px;
}

.xi-zone__code {
  flex: 1 1 100%;
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.xi-zone__name {
  font-family: var(--hg-font-display);
  font-size: 22px;
  line-height: 1.3;
}

.xi-zone__count {
  margin: 0;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.xi-zone__more {
  margin-left: auto;
  color: var(--hg-accent-ink);
  font-size: 14px;
  font-weight: 600;
}

/* 卡片排成网格：宽屏两到三列，窄屏一列；卡片自己的上下外边距去掉，同一行一样高。 */
.xi-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.xi-item {
  display: flex;
  min-width: 0;
  margin: 0;
}

.xi-item > :deep(*) {
  flex: 1;
  min-width: 0;
  margin: 0;
}

/* ---------- 题库和许可证 ---------- */

.xi-sources__title {
  font-family: var(--hg-font-display);
  font-size: 22px;
  line-height: 1.3;
}

.xi-sources__note {
  margin: 10px 0 12px;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.xi-sources__table {
  margin: 0;
}

/* 日期不拆行；表格太宽时整张表在自己的框里横向滚动（.hg-prose table），页面不跟着滚。 */
.xi-sources__date {
  white-space: nowrap;
}

@media (min-width: 768px) {
  .xi-zone {
    padding: 22px 22px 20px;
  }
}
</style>
