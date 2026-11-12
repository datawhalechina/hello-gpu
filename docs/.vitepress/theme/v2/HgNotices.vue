<script setup lang="ts">
/**
 * 外壳顶部的两条提示（HgLayout、StageLayout 共用）：
 * 浏览器存储不可用时（隐私模式等）F-04 给出的提示；演示页（frontmatter demo: true）的说明。
 */
import { useProgress } from '@course/useProgress.ts'

const { notice, demo } = useProgress()
</script>

<template>
  <p v-if="notice" class="hg-notice" role="status">{{ notice }}</p>
  <p v-if="demo" class="hg-notice is-demo">演示页面：这里的进度单独保存在演示存档里，不会计入你的真实进度。</p>
</template>

<style scoped>
.hg-notice {
  max-width: var(--hg-shell-max, 1120px);
  width: 100%;
  margin: 16px auto 0;
  padding: 10px 16px;
  border: var(--hg-border-width) solid var(--hg-amber);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  font-size: 14px;
  color: var(--hg-amber-ink);
}

/* 演示页提示只是说明，不是警告：用中性色。 */
.hg-notice.is-demo {
  border-color: var(--hg-border-strong);
  color: var(--hg-ink-2);
}

@media (max-width: 767px) {
  .hg-notice {
    margin-top: 12px;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }
}
</style>
