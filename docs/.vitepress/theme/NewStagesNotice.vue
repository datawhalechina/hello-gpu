<script setup lang="ts">
/**
 * 旧版页面顶部的「新版对应关卡」提示（M-01）。主题 index.ts 把它放在默认主题的 doc-before 插槽里，章节位置条下面。
 *
 * 这一页所在的旧版章节（章里的补充页面跟着所在的章）在 docs/course/v1-map.json 里对应的关卡，
 * 已经上线的列出来、链接过去；一个都没有就不显示。
 * 新版上线（docs/.vitepress/launch.ts 的 V2_PUBLIC）之前不显示：09 第 1 节，上线之前旧版页面不链接新版页面。
 */
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { stageHref } from '@course/outline.ts'
import { chapterOfPage, noticeStagesOf } from '@course/v1.ts'
import { V2_PUBLIC } from '../launch.ts'

const { page } = useData()

const stages = computed(() => (V2_PUBLIC ? noticeStagesOf(page.value.relativePath) : []).map((s) => ({
  id: s.id,
  name: `${s.code} ${s.title}`,
  subtitle: s.subtitle,
  href: withBase(stageHref(s)),
})))
/** 附录不是「章」。 */
const which = computed(() => (chapterOfPage(page.value.relativePath)?.startsWith('/appendix/') ? '这个附录' : '这一章'))
</script>

<template>
  <aside v-if="stages.length" class="hg-v1-notice" aria-label="新版里的对应关卡">
    <p class="hg-v1-notice__text"><span class="hg-v1-notice__tag">新版</span>{{ which }}的内容，新版闯关教程里也有：</p>
    <ul class="hg-v1-notice__list">
      <li v-for="s in stages" :key="s.id">
        <a class="hg-v1-notice__link" :href="s.href">{{ s.name }}<span class="hg-v1-notice__sub">{{ s.subtitle }}</span></a>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
/*
 * 放在旧版页面里，颜色用新版的 token（tokens.css 是全局的，跟着 html.dark 换亮暗）。
 * 第 2 篇各章在暗色下右上角有一张绝对定位的装饰图：提示条和标题一样叠在它上面，
 * 底色用不透明的卡片色垫底（暗色的 --hg-accent-soft 是半透明的，不垫的话图会透出来）。
 */
.hg-v1-notice {
  position: relative;
  z-index: 1;
  margin: 0 0 20px;
  padding: 12px 16px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-control);
  background: linear-gradient(var(--hg-accent-soft), var(--hg-accent-soft)), var(--hg-surface);
  font-family: var(--hg-font-body);
}

.hg-v1-notice__text {
  margin: 0 0 8px;
  color: var(--hg-ink);
  font-size: 14px;
  line-height: 1.6;
}

.hg-v1-notice__tag {
  margin-right: 8px;
  padding: 1px 8px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-accent-ink);
  color: var(--hg-surface);
  font-size: 12px;
  font-weight: 700;
}

.hg-v1-notice__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-v1-notice__list li {
  margin: 0;
}

.hg-v1-notice__link {
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

.hg-v1-notice__link:hover {
  border-color: var(--hg-accent);
}

.hg-v1-notice__link:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-v1-notice__sub {
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 400;
}
</style>
