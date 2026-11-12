<script setup lang="ts">
/**
 * 关卡布局（F-10；03 第 3 节 StageLayout 的关键行为，06 第 2–3 节，设计稿 Stage 画板）。
 *
 * 页面 frontmatter 只写 stage（outline.json 的 id）：编号、标题、副标题、区域、推荐等级、时长、
 * 真卡要求、前置关卡、上一关 / 下一关都从 outline.json 读，正文只写内容（06 第 2 节）。
 *
 * 结构：吸顶状态栏 → 存储 / 演示页提示 → 关卡头 → 正文（以「# 编号 名称」开头）→
 *       上一关 / 回区域首页 / 下一关 → 页脚；奖励反馈层（F-13）浮在底部。
 * 关卡头里：读者等级低于推荐等级时说一句温和的话，不上锁；前置关卡写明读者有没有完成。
 * 大纲里 status 为 draft 的关卡标「测试版」。还没上线（planned / pilot）的关卡没有正式页面，只写名字不放链接。
 * stage 写错（大纲里没有）时：开发时页面上显示红框，构建失败（和 F-09 的内容检查同一套）。
 * 状态栏、关卡头、底部导航三块（StageBar、StageHead、StageNav）和副本布局 DungeonLayout（X-01）共用。
 */
import { computed, watch } from 'vue'
import { useData, withBase } from 'vitepress'
import { isPublished, neighborsOf, routesOf, stageById, stageHref, zoneById, type StageMeta } from '@course/outline.ts'
import { challengeSection } from '@course/useChallenge.ts'
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

const stageId = computed(() => (typeof frontmatter.value.stage === 'string' ? frontmatter.value.stage : ''))
const stage = computed(() => stageById(stageId.value) ?? null)
const zone = computed(() => (stage.value ? zoneById(stage.value.zone) ?? null : null))

const problem = computed(() => {
  if (stage.value && zone.value) return ''
  const what = stageId.value
    ? `frontmatter 的 stage: ${stageId.value} 在 docs/course/outline.json 里找不到，检查拼写或者先在大纲里登记这一关。`
    : '关卡页（layout: stage）的 frontmatter 缺少 stage，要写 outline.json 里的关卡 id。'
  return contentError(what, page.value.relativePath)
})

/** 进度点：正文的 h2（config.mts 只给关卡页和副本页抽取 h2，服务端渲染就有，水合前后一致）。 */
const sections = computed(() =>
  (page.value.headers ?? []).filter((h) => h.level === 2).map((h) => ({ slug: h.slug, title: h.title })))

/** 状态栏的切换（F-11）：新手村切写法；铸造城、试炼场分路线的关卡切路线；共用一份（shared）的关卡不显示。 */
const switchKind = computed(() => {
  const mode = stage.value ? routesOf(stage.value) : 'shared'
  if (mode === 'syntax') return 'lang'
  return mode === 'split' ? 'route' : null
})

/** 「我已经会了，直接做挑战」（03 第 4 节「随时可跳过」）：正文里以「挑战」开头的那一段。 */
const skip = computed(() => {
  const target = challengeSection(sections.value)
  return target ? { href: `#${target.slug}`, text: '我已经会了，直接做挑战' } : null
})

/** 硬件要求：真卡关卡写区域的环境，其余浏览器就能做（新手村写模拟器）。 */
const hardware = computed(() => {
  const s = stage.value
  const z = zone.value
  if (!s || !z) return ''
  if (s.gpu) return `需要真卡：${z.env}`
  return s.zone === 'novice' ? z.env : '浏览器即可，不需要 GPU'
})

const neighbors = computed(() => neighborsOf(stageId.value))

function hrefOf(target: StageMeta): string {
  return isPublished(target) ? withBase(stageHref(target)) : ''
}

/**
 * 前置关卡就是大纲里的上一关（F-10 第 1 条），关卡头和底部的「上一关」是同一个。
 * 还没上线的关卡谈不上完成没完成；试点关卡迁过来的进度例外，做过就照样显示「已完成」。
 */
const prerequisite = computed<HeadLink | null>(() => {
  const prev = neighbors.value.prev
  if (!prev) return null
  const href = hrefOf(prev)
  const done = progress.stage(prev.id).completed
  return { text: `${prev.code} ${prev.title}`, href, note: '（还没上线）', done: href || done ? done : undefined }
})

const headItems = computed<HeadItem[]>(() => {
  const s = stage.value
  if (!s) return []
  const items: HeadItem[] = [
    { key: '这一关讲', text: s.subtitle },
    { key: '推荐等级', text: `Lv.${s.lv}` },
    { key: '时长', text: `约 ${s.minutes} 分钟` },
    { key: '硬件', text: hardware.value },
  ]
  if (prerequisite.value) items.push({ key: '前置关卡', links: [prerequisite.value] })
  return items
})

/** 等级低于推荐等级：读完存档才判断，提示只是提醒，不挡路。 */
const hint = computed(() => {
  const s = stage.value
  if (!s || !progress.loaded.value || progress.level.value >= s.lv) return ''
  return `这一关推荐 Lv.${s.lv}，你现在是 Lv.${progress.level.value}。关卡不上锁，可以直接开始；卡住了就先去前置关卡看看。`
})

function navOf(target: StageMeta | null, dir: string): NavItem | null {
  return target ? { dir, name: `${target.code} ${target.title}`, href: hrefOf(target) } : null
}

const prevNav = computed(() => navOf(neighbors.value.prev, '上一关'))
const nextNav = computed(() => navOf(neighbors.value.next, '下一关'))

/**
 * 记下最近打开的关卡（世界地图的「你在这」看它）。存档读出来以后才记，免得写进还没读档的空状态；
 * 站内跳到另一关时布局不重建，所以跟着 stage 走。演示页写进演示存档，不碰读者的正式进度。
 */
watch([() => stage.value?.id, progress.loaded], ([id, ready]) => {
  if (id && ready) progress.visitStage(id)
}, { immediate: true })
</script>

<template>
  <div
    class="hg-shell hg-stage"
    :class="{ 'is-plain': plain }"
    :data-zone="stage?.zone"
    :data-hg-motion="motion"
  >
    <a class="hg-skip" href="#hg-main">跳到正文</a>

    <StageBar
      v-if="stage && zone"
      :zone="zone"
      :code="stage.code"
      :title="stage.title"
      :earned="progress.stage(stage.id).stars"
      :sections="sections"
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
        v-if="stage && zone"
        :eyebrow="`${zone.name} · 关卡 ${stage.code}`"
        :beta="stage.status === 'draft'"
        :items="headItems"
        :hint="hint"
        :skip="skip"
      />

      <Content />

      <StageNav
        v-if="stage && zone"
        label="上一关和下一关"
        :prev="prevNav"
        :next="nextNav"
        :home="{ href: withBase(`/${zone.id}/`), text: `回到${zone.name}首页` }"
      />
    </main>

    <HgFooter />

    <RewardLayer />
  </div>
</template>
