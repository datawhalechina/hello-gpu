<script setup lang="ts">
/**
 * 新手村的两种写法（F-11；03 第 5 节、06 第 5 节）：同一段代码的 HIP 风格和 Python 风格，按读者的写法偏好显示一份。
 *
 *   <LangCode>
 *   <template #hip>
 *
 *   ```cpp
 *   c[i] = a[i] + b[i];
 *   ```
 *
 *   </template>
 *   <template #python>
 *
 *   ```python
 *   c[i] = a[i] + b[i]
 *   ```
 *
 *   </template>
 *   </LangCode>
 *
 * 两份都在服务端渲染出来，显示哪一份只由 <html data-hg-lang> 上的 CSS 决定（docs/course/prefAttrs.ts）：
 * 组件渲染的东西和偏好无关，水合前后一致；构建出来的页面首屏就是读者选的写法，不会先显示一份再跳。
 * 块顶部写着现在是哪种写法，旁边可以直接换；关卡状态栏里也有同一个切换，全站记住。
 */
import { ref } from 'vue'
import type { Lang } from '@course/progress.ts'
import { useProgress } from '@course/useProgress.ts'

const PANES: { lang: Lang; label: string }[] = [
  { lang: 'hip', label: 'HIP 风格' },
  { lang: 'python', label: 'Python 风格' },
]

const progress = useProgress()
const root = ref<HTMLElement | null>(null)

/** 换写法：被点的按钮跟着它那一份藏起来，焦点挪到另一份的同一个按钮上，键盘读者不会丢位置。 */
function switchTo(lang: Lang) {
  progress.setPref('lang', lang)
  root.value?.querySelector<HTMLButtonElement>(`[data-lang="${lang}"] .hg-langcode__switch`)?.focus()
}
</script>

<template>
  <div ref="root" class="hg-langcode">
    <div v-for="(pane, i) in PANES" :key="pane.lang" class="hg-langcode__pane" :data-lang="pane.lang">
      <p class="hg-langcode__bar">
        <span class="hg-langcode__tag">{{ pane.label }}</span>
        <button type="button" class="hg-langcode__switch" @click="switchTo(PANES[1 - i].lang)">
          换成 {{ PANES[1 - i].label }}
        </button>
      </p>
      <slot :name="pane.lang" />
    </div>
  </div>
</template>

<style>
/* 默认（服务端渲染、没有偏好、偏好是 HIP）显示 HIP 风格；属性是 python 时反过来。 */
.hg-langcode__pane[data-lang='python'],
html[data-hg-lang='python'] .hg-langcode__pane[data-lang='hip'] {
  display: none;
}

html[data-hg-lang='python'] .hg-langcode__pane[data-lang='python'] {
  display: block;
}
</style>

<style scoped>
.hg-langcode {
  margin: 0 0 20px;
}

.hg-langcode__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0 0 6px;
  font-size: 13px;
}

.hg-langcode__tag {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-langcode__switch {
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--hg-accent-ink);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.hg-langcode__switch:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
  border-radius: var(--hg-radius-tag);
}

/* 代码块自己的下边距交给整个组件。 */
.hg-langcode :deep(div[class*='language-']) {
  margin-bottom: 0;
}
</style>
