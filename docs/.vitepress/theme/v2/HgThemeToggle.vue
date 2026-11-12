<script setup lang="ts">
/**
 * 亮暗切换（F-06）。顶栏和关卡状态栏（F-10）共用。
 *
 * 和 VitePress 自己的外观设置是同一个开关：都读写 useData().isDark
 * （@vueuse 的 useDark，localStorage 键 vitepress-theme-appearance），
 * 所以在新版页面切换之后，旧版页面和系统的 html.dark 都跟着变。
 *
 * 服务端渲染拿不到 localStorage，图标亮暗一律交给 CSS 的 html.dark 决定；
 * 只有 aria 状态等挂载之后再更新，保证水合前后的 HTML 一致。
 */
import { computed, inject, onMounted, ref } from 'vue'
import { useData } from 'vitepress'

const { isDark } = useData()
// 默认主题用 toggle-appearance 注入过渡动画；新版布局不经过默认主题时退回直接取反。
const toggleAppearance = inject('toggle-appearance', () => {
  isDark.value = !isDark.value
})

const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const pressed = computed(() => mounted.value && isDark.value)
</script>

<template>
  <button
    class="hg-theme-toggle"
    type="button"
    :aria-pressed="pressed"
    aria-label="切换亮色 / 暗色主题"
    @click="toggleAppearance()"
  >
    <svg class="hg-theme-toggle__icon hg-theme-toggle__sun" viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.4v2.2M12 19.4v2.2M4.2 12H2m20 0h-2.2M6.3 6.3 4.8 4.8m14.4 14.4-1.5-1.5M6.3 17.7l-1.5 1.5M19.2 4.8l-1.5 1.5" />
    </svg>
    <svg class="hg-theme-toggle__icon hg-theme-toggle__moon" viewBox="0 0 24 24" width="18" height="18"
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20.6 14.2A8.6 8.6 0 0 1 9.8 3.4a8.6 8.6 0 1 0 10.8 10.8z" />
    </svg>
  </button>
</template>

<style scoped>
.hg-theme-toggle {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink-2);
  cursor: pointer;
  transition: color var(--motion-instant) var(--motion-ease-out),
    border-color var(--motion-instant) var(--motion-ease-out);
}

.hg-theme-toggle:hover {
  border-color: var(--hg-ink-3);
  color: var(--hg-ink);
}

.hg-theme-toggle:focus-visible {
  outline: 2px solid var(--hg-accent);
  outline-offset: 2px;
}

/* 两个图标叠在同一格里，由 html.dark 决定显示哪一个（不读 JS 状态，水合前后一致）。 */
.hg-theme-toggle__icon {
  grid-area: 1 / 1;
  transition: opacity var(--motion-instant) var(--motion-ease-out);
}

.hg-theme-toggle__moon {
  opacity: 0;
}

.dark .hg-theme-toggle__sun {
  opacity: 0;
}

.dark .hg-theme-toggle__moon {
  opacity: 1;
}
</style>
