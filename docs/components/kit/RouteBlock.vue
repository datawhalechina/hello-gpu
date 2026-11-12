<script setup lang="ts">
/**
 * 铸造城、试炼场按路线分开的实现部分（F-11；03 第 5 节、06 第 5 节）。成对写，两块的小标题和顺序保持一致：
 *
 *   <RouteBlock route="hip">
 *
 *   ### 写 kernel
 *   …
 *
 *   </RouteBlock>
 *   <RouteBlock route="triton">
 *
 *   ### 写 kernel
 *   …
 *
 *   </RouteBlock>
 *
 * 只显示读者当前的路线；块顶部有路线标签和「切换路线」。两块都在服务端渲染出来，显示哪一块只由
 * <html data-hg-route> 上的 CSS 决定（docs/course/prefAttrs.ts），水合前后一致，首屏不跳。
 * route 写错时画红框，构建失败（和 F-09 的内容检查同一套）。
 */
import { computed, ref } from 'vue'
import { useData } from 'vitepress'
import type { Route } from '@course/progress.ts'
import { useProgress } from '@course/useProgress.ts'
import { contentError } from './contentError.ts'

const props = defineProps<{ route: string }>()

const LABELS: Record<Route, string> = { hip: 'HIP', triton: 'Triton' }

const { page } = useData()
const progress = useProgress()
const root = ref<HTMLElement | null>(null)

const route = computed(() => (props.route === 'hip' || props.route === 'triton' ? props.route : null))
const other = computed<Route>(() => (route.value === 'triton' ? 'hip' : 'triton'))
const problem = computed(() => (route.value
  ? ''
  : contentError(`RouteBlock 的 route="${props.route}" 不对，只能是 hip 或 triton。`, page.value.relativePath)))

/**
 * 换路线：这一块藏起来、另一条路线的块显示出来。焦点挪到同一组里另一块的「切换路线」上
 * （成对的块是相邻的兄弟元素），键盘读者不会丢位置。
 */
function switchRoute() {
  const target = other.value
  progress.setPref('route', target)
  const el = root.value
  const pair = [el?.previousElementSibling, el?.nextElementSibling]
    .find((s) => s instanceof HTMLElement && s.dataset.route === target)
  pair?.querySelector<HTMLButtonElement>('.hg-route__switch')?.focus()
}
</script>

<template>
  <p v-if="problem" class="hg-route-error" role="alert" data-hg-content-error>{{ problem }}</p>
  <section v-else ref="root" class="hg-route" :data-route="route" :aria-label="`${LABELS[route!]} 路线`">
    <header class="hg-route__head">
      <span class="hg-route__tag">{{ LABELS[route!] }} 路线</span>
      <button type="button" class="hg-route__switch" @click="switchRoute">切换到 {{ LABELS[other] }} 路线</button>
    </header>
    <div class="hg-route__body">
      <slot />
    </div>
  </section>
</template>

<style>
/* 默认（服务端渲染、没有偏好、偏好是 HIP）显示 HIP 路线；属性是 triton 时反过来。 */
.hg-route[data-route='triton'],
html[data-hg-route='triton'] .hg-route[data-route='hip'] {
  display: none;
}

html[data-hg-route='triton'] .hg-route[data-route='triton'] {
  display: block;
}
</style>

<style scoped>
.hg-route {
  margin: 0 0 24px;
  padding: 14px 20px 4px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.hg-route__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  margin: 0 0 10px;
}

.hg-route__tag {
  padding: 2px 10px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  border: var(--hg-border-width) solid var(--hg-border);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-route__switch {
  min-height: 32px;
  padding: 0 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.hg-route__switch:hover {
  border-color: var(--hg-ink-3);
}

.hg-route__switch:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-route-error {
  margin: 0 0 20px;
  padding: 14px 18px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-card);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

@media (max-width: 767px) {
  .hg-route {
    padding: 12px 14px 2px;
  }
}
</style>
