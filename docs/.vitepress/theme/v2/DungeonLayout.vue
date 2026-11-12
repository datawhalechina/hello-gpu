<script setup lang="ts">
/**
 * 副本布局（X-01；04 第 1、2 节，03 第 4 节）。frontmatter 写 layout: dungeon。
 *
 * 页面 frontmatter 只写 dungeon（outline.json 的 exercises 里的 id）和 evidence：题名、区域、练的是、难度、
 * 经验值、运行环境、关联关卡、上一道 / 下一道都从 outline.json 读，正文只写内容。
 * 状态栏、头部、底部导航和关卡布局共用（StageBar、StageHead、StageNav）：状态栏的编号位置写「副本」，
 * 星是这道题的星，左上角回副本大厅；头部写练的是、难度、经验值、运行环境和关联关卡（做没做完）；
 * 关联关卡里有已经上线、读者还没做完的，说一句温和的话，不上锁。
 *
 * 正文骨架（scripts/course/stage-check.mjs 检查）：题目（正文开头写题面，Mission 写一句话任务和三条星级标准）→
 * 挑战（模拟器副本用 Sandbox，真卡副本用 LabCard）→ 提示阶梯（挑战里的 HintLadder）→
 * 题解（Solution：通关或在挑战里看过答案以后展开）→ 证据（EvidenceCard）。
 * 经验值：挑战用 useChallenge({ stage: 副本 id })，★1 成立就算通关，第一次通关发这道题的经验值（50–150），
 * 星记在副本自己的进度里、不另给经验值（docs/course/useChallenge.ts）。
 * dungeon 写错（大纲里没有）时：开发时页面上显示红框，构建失败（和 F-09 的内容检查同一套）。
 */
import { computed, watch } from 'vue'
import { useData, withBase } from 'vitepress'
import {
  DIFFICULTY_LABEL, dungeonHref, exerciseById, exerciseEnvText, exerciseHref, exerciseNeighbors, isPublished, stageById,
  stageHref, zoneById, type ExerciseMeta, type StageMeta,
} from '@course/outline.ts'
import { useProgress } from '@course/useProgress.ts'
import { contentError } from '@kit/contentError.ts'
import StageBar from './StageBar.vue'
import StageHead, { type HeadItem, type HeadLink } from './StageHead.vue'
import StageNav, { type NavItem } from './StageNav.vue'
import PrefSwitch from './PrefSwitch.vue'
import HintButton from './HintButton.vue'
import HgNotices from './HgNotices.vue'
import HgFooter from './HgFooter.vue'
import RewardLayer from '@kit/RewardLayer.vue'
import { useShell } from './useShell.ts'
import './shell.css'

const { frontmatter, page } = useData()
const { plain, motion } = useShell()
const progress = useProgress()

const exerciseId = computed(() => (typeof frontmatter.value.dungeon === 'string' ? frontmatter.value.dungeon : ''))
const exercise = computed(() => exerciseById(exerciseId.value) ?? null)
const zone = computed(() => (exercise.value ? zoneById(exercise.value.zone) ?? null : null))

const problem = computed(() => {
  if (exercise.value && zone.value) return ''
  const what = exerciseId.value
    ? `frontmatter 的 dungeon: ${exerciseId.value} 在 docs/course/outline.json 的 exercises 里找不到，检查拼写或者先在大纲里登记这道副本。`
    : '副本页（layout: dungeon）的 frontmatter 缺少 dungeon，要写 outline.json 的 exercises 里的副本 id。'
  return contentError(what, page.value.relativePath)
})

/** 进度点：正文的 h2（config.mts 只给关卡页和副本页抽取 h2）。 */
const sections = computed(() =>
  (page.value.headers ?? []).filter((h) => h.level === 2).map((h) => ({ slug: h.slug, title: h.title })))

/** 状态栏的切换跟着区域（F-11）：新手村的副本切写法，铸造城、试炼场的副本两条路线都有参考解，切路线。 */
const switchKind = computed(() => {
  const mode = zone.value?.routes
  if (mode === 'syntax') return 'lang'
  return mode === 'split' ? 'route' : null
})

/** 回副本大厅，落在这个区域的那一组。 */
const hall = computed(() => (zone.value ? dungeonHref(zone.value.id) : '/dungeon/'))

/** 关联关卡：上线了的放链接；做没做完写出来（还没上线的关卡谈不上，做过的照样算）。 */
const related = computed(() => (exercise.value?.stages ?? [])
  .map((id) => stageById(id))
  .filter((s): s is StageMeta => Boolean(s))
  .map((s): HeadLink => {
    const href = isPublished(s) ? withBase(stageHref(s)) : ''
    const done = progress.stage(s.id).completed
    return { text: `${s.code} ${s.title}`, href, note: '（还没上线）', done: href || done ? done : undefined }
  }))

const headItems = computed<HeadItem[]>(() => {
  const e = exercise.value
  if (!e) return []
  const items: HeadItem[] = [
    { key: '练的是', text: e.practice },
    { key: '难度', text: DIFFICULTY_LABEL[e.difficulty] ?? '' },
    { key: '经验值', text: `通关得 ${e.xp} XP` },
    { key: '运行环境', text: exerciseEnvText(e) },
  ]
  if (related.value.length) items.push({ key: '关联关卡', links: related.value })
  return items
})

/** 关联关卡里有上线了、还没做完的：读完存档才判断，只是提醒，不挡路。 */
const hint = computed(() => {
  if (!progress.loaded.value) return ''
  const missing = related.value.filter((l) => l.href && !l.done)
  if (!missing.length) return ''
  const names = missing.map((l) => `「${l.text}」`).join('')
  return `这道题用到${names}里学的东西，${missing.length > 1 ? '这几关' : '这一关'}你还没做完。副本不上锁，可以直接开始；卡住了就先回去看看。`
})

const neighbors = computed(() => exerciseNeighbors(exerciseId.value))

function navOf(target: ExerciseMeta | null, dir: string): NavItem | null {
  if (!target) return null
  const zoneName = zoneById(target.zone)?.name ?? ''
  return { dir, name: `${zoneName} · ${target.title}`, href: isPublished(target) ? withBase(exerciseHref(target)) : '' }
}

const prevNav = computed(() => navOf(neighbors.value.prev, '上一道'))
const nextNav = computed(() => navOf(neighbors.value.next, '下一道'))

/** 记下打开过这道题（副本大厅的「进行中」看它）；存档读出来以后才记，演示页写进演示存档。 */
watch([() => exercise.value?.id, progress.loaded], ([id, ready]) => {
  if (id && ready) progress.visitExercise(id)
}, { immediate: true })
</script>

<template>
  <div
    class="hg-shell hg-stage hg-dungeon"
    :class="{ 'is-plain': plain }"
    :data-zone="exercise?.zone"
    :data-hg-motion="motion"
  >
    <a class="hg-skip" href="#hg-main">跳到正文</a>

    <StageBar
      v-if="exercise && zone"
      :zone="zone"
      code="副本"
      :title="exercise.title"
      :earned="progress.exercise(exercise.id).stars"
      :sections="sections"
      scope="这道题"
      :back="{ href: hall, text: '回副本大厅' }"
    >
      <template #tools>
        <PrefSwitch v-if="switchKind" :kind="switchKind" />
        <HintButton />
      </template>
    </StageBar>

    <HgNotices />

    <main id="hg-main" class="hg-main hg-prose" tabindex="-1">
      <p v-if="problem" class="hg-stage-error" role="alert" data-hg-content-error>{{ problem }}</p>

      <StageHead
        v-if="exercise && zone"
        :eyebrow="`${zone.name} · 副本`"
        :beta="exercise.status === 'draft'"
        :items="headItems"
        :hint="hint"
      />

      <Content />

      <StageNav
        v-if="exercise && zone"
        label="上一道和下一道副本"
        :prev="prevNav"
        :next="nextNav"
        :home="{ href: withBase(hall), text: '回到副本大厅' }"
      />
    </main>

    <HgFooter />

    <RewardLayer />
  </div>
</template>
