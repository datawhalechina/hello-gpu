<script setup lang="ts">
/**
 * 写法 / 路线切换（F-11；03 第 5 节，设计稿 Stage 状态栏右侧的分段按钮）。
 * kind="lang"：新手村的 HIP / Python 风格；kind="route"：铸造城、试炼场的 HIP / Triton 路线。
 * 两个偏好分开存（setPref），全站共用；切换后全页的 LangCode / RouteBlock 跟着变。
 *
 * 哪个按钮亮由 <html data-hg-lang / data-hg-route> 上的 CSS 决定（和 LangCode 同一个来源，
 * 构建出来的页面首屏就是对的）；aria-pressed 等读完存档才换成读者的偏好，水合前后一致。
 */
import { computed } from 'vue'
import type { Lang, Route } from '@course/progress.ts'
import { useProgress } from '@course/useProgress.ts'

const props = defineProps<{ kind: 'lang' | 'route' }>()

const progress = useProgress()

const options = computed(() => (props.kind === 'lang'
  ? [{ value: 'hip', label: 'HIP' }, { value: 'python', label: 'Python' }]
  : [{ value: 'hip', label: 'HIP' }, { value: 'triton', label: 'Triton' }]))
const label = computed(() => (props.kind === 'lang' ? '代码写法' : '实现路线'))
const current = computed(() => (props.kind === 'lang' ? progress.state.prefs.lang : progress.state.prefs.route))

function pick(value: string) {
  if (props.kind === 'lang') progress.setPref('lang', value as Lang)
  else progress.setPref('route', value as Route)
}
</script>

<template>
  <div class="hg-prefswitch" :data-kind="kind" role="group" :aria-label="label">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="hg-prefswitch__btn"
      :aria-pressed="current === o.value"
      @click="pick(o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style>
.hg-prefswitch {
  display: inline-flex;
  flex: none;
  padding: 3px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.hg-prefswitch__btn {
  min-height: 30px;
  padding: 0 11px;
  border: 0;
  border-radius: calc(var(--hg-radius-control) - 3px);
  background: transparent;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    color var(--motion-fast) var(--motion-ease-out);
}

.hg-prefswitch__btn:hover {
  color: var(--hg-ink);
}

.hg-prefswitch__btn:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

/* 选中的那一个：表面色底、深字、一层卡片阴影（设计稿 Stage 的分段按钮）。没有属性时（服务端渲染、还没读存档）默认 HIP。 */
.hg-prefswitch__btn:first-child,
html[data-hg-lang='python'] .hg-prefswitch[data-kind='lang'] .hg-prefswitch__btn:last-child,
html[data-hg-route='triton'] .hg-prefswitch[data-kind='route'] .hg-prefswitch__btn:last-child {
  background: var(--hg-surface);
  color: var(--hg-ink);
  box-shadow: var(--hg-shadow);
}

html[data-hg-lang='python'] .hg-prefswitch[data-kind='lang'] .hg-prefswitch__btn:first-child,
html[data-hg-route='triton'] .hg-prefswitch[data-kind='route'] .hg-prefswitch__btn:first-child {
  background: transparent;
  color: var(--hg-ink-3);
  box-shadow: none;
}
</style>
