<script setup lang="ts">
/**
 * 实验档案馆里的一个 Notebook 单元（L-04）：所在小节、一句话说明、代码和关键输出。
 * 档案浏览页的详情用它，观摩模式（L-05）按条目里的顺序逐个回放时也可以用。不在 kit/index.ts 里全局注册。
 * 代码区按 01 第 2.4 节：亮暗主题下都是深色底，顶上一条文件名栏写语言；代码区里面可以横向滚动。
 */
import ArchiveOutput from './ArchiveOutput.vue'
import type { ArchiveCell } from '@course/labArchive.ts'

defineProps<{ cell: ArchiveCell }>()
</script>

<template>
  <section class="hg-acell">
    <p class="hg-acell__head">
      <span class="hg-acell__section">{{ cell.section }}</span>
      <span v-if="cell.title" class="hg-acell__title">{{ cell.title }}</span>
    </p>
    <div v-if="cell.code" class="hg-acell__code">
      <p class="hg-acell__bar">{{ cell.lang === 'hip' ? 'HIP（%%hip 单元）' : 'Python' }}</p>
      <pre><code translate="no">{{ cell.code }}</code></pre>
    </div>
    <ArchiveOutput v-for="(output, i) in cell.outputs" :key="i" :output="output" />
  </section>
</template>

<style scoped>
.hg-acell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.hg-acell__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin: 0;
  color: var(--hg-ink);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.hg-acell__section {
  padding: 0 8px;
  border: var(--hg-border-width) solid var(--hg-sky-ink);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-sky-ink);
  font-size: var(--hg-text-label);
  font-weight: 700;
  line-height: 20px;
  white-space: nowrap;
}

.hg-acell__code {
  border-radius: var(--hg-radius-control);
  background: var(--hg-code-bg);
  overflow: hidden;
}

.hg-acell__bar {
  margin: 0;
  padding: 6px 14px 0;
  color: var(--hg-code-file);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

/* 字号和行高写在 pre 上：行盒的高度由块的字号决定，只写在 code 上行距会被正文的 15px 撑大 */
.hg-acell__code pre {
  margin: 0;
  padding: 6px 14px 12px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}

.hg-acell__code code {
  color: var(--hg-code-ink);
  font-family: var(--hg-font-mono);
}
</style>
