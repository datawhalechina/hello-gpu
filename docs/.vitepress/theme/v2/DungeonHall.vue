<script setup lang="ts">
/**
 * 副本大厅（X-01；04 第 1、2 节，PLAN 5.4）。/dungeon/ 用它。
 *
 * 副本挂在区域旁边，可选、不占主线。大厅按区域分组，每组的锚点是区域 id（世界地图和区域首页的副本入口
 * dungeonHref 指到这里）；一道题一行：难度、题名（上线了的是链接）、练的是、经验值、运行环境、关联关卡，
 * 右边是状态和星。状态的说法和世界地图的关卡一样（docs/course/journey.ts 的 exerciseStatus），
 * 区域分组的卡片按区域换装（data-zone，同世界地图和首页的区域卡片）。
 * 数据全部来自 outline.json 的 exercises 和进度存档，这里不手写副本信息。页首另有一句话链到外部练习题索引（X-08）。
 * 存档读出来之前按空存档画（和服务端渲染一样），「已通关」那几句先占位不显示。
 */
import { computed, useId } from 'vue'
import { withBase } from 'vitepress'
import Mascot from '@kit/Mascot.vue'
import {
  DIFFICULTY_LABEL, EXERCISES, exerciseHref, isPublished, stageById, zoneById, type ExerciseMeta, type StageMeta,
} from '@course/outline.ts'
import { getExercise, MAX_STARS, XP_EXERCISE_MAX, XP_EXERCISE_MIN } from '@course/progress.ts'
import { exerciseProgress, exerciseStatus, STATUS_ICONS, STATUS_TEXT } from '@course/journey.ts'
import { EXTERNAL_PAGE } from '@course/externalProblems.ts'
import { useProgress } from '@course/useProgress.ts'

const { state, loaded } = useProgress()
const uid = useId()

const STAR_SLOTS = Array.from({ length: MAX_STARS }, (_, i) => i)

const total = computed(() => exerciseProgress(state))

function rowOf(exercise: ExerciseMeta) {
  const status = exerciseStatus(exercise, state)
  const stars = getExercise(state, exercise.id).stars.length
  const published = isPublished(exercise)
  const related = exercise.stages
    .map((id) => stageById(id))
    .filter((s): s is StageMeta => Boolean(s))
    .map((s) => `${s.code} ${s.title}`)
  return {
    exercise,
    status,
    href: published ? withBase(exerciseHref(exercise)) : '',
    difficulty: DIFFICULTY_LABEL[exercise.difficulty] ?? '',
    env: exercise.env === 'gpu' ? '真卡' : '模拟器',
    related: related.join('、'),
    stars,
    showStars: published || stars > 0,
  }
}

const groups = computed(() => EXERCISES.flatMap((g) => {
  const zone = zoneById(g.zone)
  if (!zone) return []
  return [{ zone, practice: g.practice, progress: exerciseProgress(state, g.items), rows: g.items.map(rowOf) }]
}))
</script>

<template>
  <div class="dh">
    <section class="dh-intro" :aria-labelledby="`${uid}-intro`">
      <Mascot class="dh-intro__art" size="sm">主线之外，来这里练练手。</Mascot>
      <div class="dh-intro__text">
        <h2 :id="`${uid}-intro`" class="dh-hidden">副本怎么玩</h2>
        <!-- 中文段落写在一行里：模板里的换行会变成一个空格。 -->
        <p>副本是挂在区域旁边的练习题：可选，不占主线，什么时候来都行。每道题通关（拿到第一颗星，结果正确）时发一次经验值，{{ XP_EXERCISE_MIN }}–{{ XP_EXERCISE_MAX }} XP，越难给得越多。</p>
        <p>新手村的副本在浏览器里的模拟器上做；铸造城、试炼场的副本要真卡，在实验室里做完，再把通关码交回副本页。每道题都有三级提示，通关或者看过答案以后可以看题解。</p>
        <p>别的题库里也有和各关对得上的题：<a :href="withBase(EXTERNAL_PAGE)">外部练习题</a>按区域列出它们，只链接原题，附几篇原创题解，不发经验值。</p>
        <p class="dh-intro__stats" :class="{ 'is-loading': !loaded }" aria-live="polite">
          <template v-if="loaded">你通关了 {{ total.done }} / {{ total.total }} 道副本，从副本拿到 {{ total.xp }} XP。</template>
        </p>
      </div>
      <nav class="dh-jump" aria-label="按区域跳到副本">
        <a v-for="g in groups" :key="g.zone.id" :href="`#${g.zone.id}`" :data-zone="g.zone.id">{{ g.zone.name }}</a>
      </nav>
    </section>

    <section
      v-for="g in groups"
      :id="g.zone.id"
      :key="g.zone.id"
      class="dh-zone"
      :data-zone="g.zone.id"
      :aria-labelledby="`${uid}-${g.zone.id}`"
    >
      <header class="dh-zone__head">
        <p class="dh-zone__code">{{ g.zone.code }} · 推荐 Lv.{{ g.zone.lv[0] }}–{{ g.zone.lv[1] }}</p>
        <h2 :id="`${uid}-${g.zone.id}`" class="dh-zone__name">{{ g.zone.name }}副本</h2>
        <p class="dh-zone__practice">练的是{{ g.practice }}。运行环境：{{ g.zone.env }}。</p>
        <p class="dh-zone__count" :class="{ 'is-loading': !loaded }">
          <template v-if="loaded">通关 {{ g.progress.done }} / {{ g.progress.total }} 道</template>
        </p>
        <a class="dh-zone__home" :href="withBase(`/${g.zone.id}/`)">回到{{ g.zone.name }}首页</a>
      </header>

      <ol class="dh-list">
        <li
          v-for="r in g.rows"
          :key="r.exercise.id"
          class="dh-row"
          :class="`is-${r.status}`"
          :data-exercise="r.exercise.id"
        >
          <span class="dh-row__dot" aria-hidden="true">
            {{ r.difficulty }}
            <span v-if="STATUS_ICONS[r.status]" class="dh-row__badge">
              <svg viewBox="0 0 16 16"><path v-for="p in STATUS_ICONS[r.status]" :key="p.d" :d="p.d" :class="{ 'is-fill': p.fill }" /></svg>
            </span>
          </span>

          <div class="dh-row__body">
            <h3 class="dh-row__name">
              <a v-if="r.href" class="dh-row__link" :href="r.href">{{ r.exercise.title }}</a>
              <template v-else>{{ r.exercise.title }}</template>
            </h3>
            <p class="dh-row__line"><span class="dh-row__key">练的是</span>{{ r.exercise.practice }}</p>
            <p class="dh-row__meta">
              <!-- 难度画在左边的圆点里（圆点对读屏隐藏），这里只给读屏念。 -->
              <span class="dh-hidden">难度：{{ r.difficulty }}</span>
              <span>通关得 {{ r.exercise.xp }} XP</span>
              <span class="dh-tag">{{ r.env }}</span>
              <span v-if="r.related">关联关卡：{{ r.related }}</span>
            </p>
          </div>

          <p class="dh-row__state">
            <span class="dh-row__status">{{ STATUS_TEXT[r.status] }}</span>
            <span v-if="r.showStars" class="dh-row__stars">
              <span v-for="i in STAR_SLOTS" :key="i" :class="{ 'is-on': i < r.stars }" aria-hidden="true">{{ i < r.stars ? '★' : '☆' }}</span>
              <span class="dh-hidden">，{{ MAX_STARS }} 颗星拿到 {{ r.stars }} 颗</span>
            </span>
          </p>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.dh {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.dh-hidden {
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

/* 大厅里的二级、三级标题：去掉正文标题的分隔线和大间距，间距由卡片给。 */
.dh h2,
.dh h3 {
  margin: 0;
  padding: 0;
  border: 0;
}

/* ---------- 页首：小核一句话、副本怎么玩、你的完成情况、按区域跳转 ---------- */

.dh-intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px 28px;
  padding: 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.dh-intro__text p {
  margin: 0 0 8px;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.dh-intro__stats {
  min-height: 1.65em;
  color: var(--hg-ink) !important;
  font-weight: 600;
}

/* 存档读出来之前不知道读者做到哪了，先占住位置，免得先说「0 道」再改口。 */
.dh-intro__stats.is-loading,
.dh-zone__count.is-loading {
  visibility: hidden;
}

.dh-jump {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dh-jump a {
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

.dh-jump a:hover {
  border-color: var(--hg-accent);
}

.dh-jump a:focus-visible,
.dh-zone__home:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

@media (min-width: 900px) {
  .dh-intro {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    padding: 24px 28px;
  }

  .dh-jump {
    grid-column: 2;
  }
}

/* ---------- 一个区域一张卡（同世界地图的区域卡片：描边带区域强调色，试炼场用它的深紫底） ---------- */

.dh-zone {
  padding: 18px 16px 16px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.dh-zone[data-zone='trial'] {
  background: var(--hg-bg);
}

.dh-zone__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
  margin: 0 0 14px;
}

.dh-zone__code {
  flex: 1 1 100%;
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.dh-zone__name {
  font-family: var(--hg-font-display);
  font-size: 22px;
  line-height: 1.3;
}

.dh-zone__count {
  margin: 0;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.dh-zone__practice {
  flex: 1 1 100%;
  order: 1;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.dh-zone__home {
  margin-left: auto;
  color: var(--hg-accent-ink);
  font-size: 14px;
  font-weight: 600;
}

.dh-list {
  margin: 0;
  padding: 0;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  list-style: none;
  overflow: hidden;
}

/* 一道题：难度点 | 题名、练的是、经验值和关联关卡 | 状态和星。整行可点，链接只包住题名（读屏念出来的是题名）。 */
.dh-row {
  --dot: 40px;
  position: relative;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 6px 14px;
  margin: 0;
  padding: 14px 16px;
  border-top: var(--hg-border-width) solid var(--hg-border);
  transition: background-color var(--motion-fast) var(--motion-ease-out);
}

.dh-row:first-child {
  border-top: 0;
}

.dh-row:has(.dh-row__link:hover) {
  background: var(--hg-surface-2);
}

.dh-row__dot {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--dot);
  height: var(--dot);
  margin-inline: auto;
  border: 1.5px solid var(--hg-ink-3);
  border-radius: 50%;
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.is-doing .dh-row__dot {
  border-color: var(--hg-accent);
  color: var(--hg-accent-ink);
}

/* 完成：强调色铺底 + 对勾角标（01 第 7 节：完成 = 青 + 对勾，不只靠颜色）。 */
.is-done .dh-row__dot {
  border-color: var(--hg-accent-ink);
  background: color-mix(in srgb, var(--hg-accent) 24%, var(--hg-surface));
  color: var(--hg-accent-ink);
}

/* 建设中：虚线、暗一档，不是链接（同世界地图）。 */
.is-soon .dh-row__dot {
  border-style: dashed;
  border-color: var(--hg-idle);
  background: var(--hg-surface-2);
  color: var(--hg-ink-3);
}

.dh-row__badge {
  position: absolute;
  top: -5px;
  right: -7px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: var(--hg-border-width) solid currentColor;
  border-radius: 50%;
  background: var(--hg-surface);
  color: var(--hg-accent-ink);
}

.dh-row__badge svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.dh-row__badge svg .is-fill {
  fill: currentColor;
  stroke: none;
}

.dh-row__body {
  min-width: 0;
}

.dh-row__name {
  margin: 0 0 4px !important;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  line-height: 1.35;
}

.dh-row__link {
  color: var(--hg-ink);
  text-decoration: none;
}

/* 整行都能点：链接的伪元素铺满这一行。 */
.dh-row__link::after {
  content: '';
  position: absolute;
  inset: 0;
}

.dh-row__link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.dh-row__link:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.is-soon .dh-row__name {
  color: var(--hg-ink-2);
}

.dh-row__line {
  margin: 0 0 4px;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.55;
}

.dh-row__key {
  margin-right: 8px;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.dh-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.dh-tag {
  padding: 0 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-ink-2);
  font-size: 12px;
  line-height: 20px;
}

.dh-row__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  grid-column: 2;
  margin: 2px 0 0;
  font-size: 13px;
}

.dh-row__status {
  color: var(--hg-ink-3);
  font-weight: 600;
}

.is-done .dh-row__status,
.is-doing .dh-row__status {
  color: var(--hg-accent-ink);
}

.dh-row__stars {
  color: var(--hg-idle);
  letter-spacing: 1px;
}

.dh-row__stars .is-on {
  color: var(--hg-amber);
}

/* 宽屏：状态和星放到最右边一列。 */
@media (min-width: 768px) {
  .dh-zone {
    padding: 22px 22px 20px;
  }

  .dh-row {
    grid-template-columns: 46px minmax(0, 1fr) auto;
    padding: 16px 20px;
  }

  .dh-row__state {
    grid-column: 3;
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: flex-end;
    margin: 0;
    text-align: right;
  }
}
</style>
