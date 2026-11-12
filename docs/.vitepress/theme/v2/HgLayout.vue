<script setup lang="ts">
/**
 * 新版通用页面外壳（F-06）：地图、前言、我的成长、手册等非关卡页面共用。
 * 关卡页面走 StageLayout（F-10），顶栏里的等级芯片和亮暗切换两个组件和这里共用。
 *
 * 结构：吸顶顶栏 → 存储提示（存不住进度时才出现）→ 演示页提示 → 点阵底的正文 → 页脚；
 * 奖励反馈层（F-13）浮在底部，拿星、升级、得徽章时出现。
 * 区域换装看 frontmatter 的 zone：写成 data-zone，tokens.css 里换底色、点阵和强调色；
 * 没写 zone 时不加这个属性，用默认主题（01 第 4 节）。
 */
import { computed } from 'vue'
import { useData } from 'vitepress'
import HgTopBar from './HgTopBar.vue'
import HgNotices from './HgNotices.vue'
import HgFooter from './HgFooter.vue'
import RewardLayer from '@kit/RewardLayer.vue'
import { useShell } from './useShell.ts'
import './shell.css'

const { frontmatter } = useData()
// 演示存档的选择、简洁模式、减弱动效（设置界面在「我的成长」页的 MePage，这里只接上存档里的偏好）。
const { plain, motion } = useShell()

const zone = computed(() => {
  const value = frontmatter.value.zone
  return typeof value === 'string' && value ? value : undefined
})
</script>

<template>
  <div
    class="hg-shell"
    :class="{ 'is-plain': plain }"
    :data-zone="zone"
    :data-hg-motion="motion"
  >
    <a class="hg-skip" href="#hg-main">跳到正文</a>

    <HgTopBar />

    <HgNotices />

    <main id="hg-main" class="hg-main hg-prose" tabindex="-1">
      <Content />
    </main>

    <HgFooter />

    <RewardLayer />
  </div>
</template>

<style scoped>
/* 外壳的底色、跳转链接、正文容器在 shell.css 里，和关卡布局共用；这里只定通用页面的版心宽度。 */
.hg-shell {
  --hg-shell-max: 1120px;
}
</style>
