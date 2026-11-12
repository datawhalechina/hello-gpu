<script setup lang="ts">
/**
 * 深入一点：默认折叠的补充段落（03 第 1 节第 5 条、第 3 节组件登记表）。
 * 原理只给一句话定义，细节、推导、边界情况放进这里，不打断主线阅读。
 * 用原生 <details>，键盘和读屏都不用额外处理；颜色全部走 tokens.css。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <DeepDive title="组数为什么写成 (n + 256 − 1) / 256？">
 *
 *   正文……（前后留空行，里面照常写 Markdown）
 *
 *   </DeepDive>
 */
defineProps<{
  /** 折叠条上的标题，前面会自动加「深入一点」眉标。 */
  title: string
}>()
</script>

<template>
  <details class="hg-deepdive">
    <summary class="hg-deepdive__summary">
      <span class="hg-deepdive__eyebrow" aria-hidden="true">深入一点</span>
      <span class="hg-deepdive__title">{{ title }}</span>
      <svg class="hg-deepdive__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </summary>
    <div class="hg-deepdive__body"><slot /></div>
  </details>
</template>

<style scoped>
.hg-deepdive {
  margin: 20px 0;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.hg-deepdive__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 14px 18px;
  border-radius: var(--hg-radius-card);
  cursor: pointer;
  list-style: none;
}

.hg-deepdive__summary::-webkit-details-marker {
  display: none;
}

.hg-deepdive__summary:hover {
  background: var(--hg-surface-2);
}

.hg-deepdive__summary:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-deepdive__eyebrow {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-deepdive__title {
  flex: 1;
  min-width: 10em;
  font-family: var(--hg-font-display);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.5;
}

.hg-deepdive__chevron {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: var(--hg-ink-3);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform var(--motion-fast) var(--motion-ease-out);
}

.hg-deepdive[open] .hg-deepdive__chevron {
  transform: rotate(180deg);
}

.hg-deepdive__body {
  padding: 0 18px 14px;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: var(--hg-leading-body);
}

.hg-deepdive__body :deep(> :first-child) {
  margin-top: 0;
}

.hg-deepdive__body :deep(> :last-child) {
  margin-bottom: 0;
}
</style>
