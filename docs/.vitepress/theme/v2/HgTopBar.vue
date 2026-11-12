<script setup lang="ts">
/**
 * 新版页面顶栏（F-06；设计稿 Map、Me 画板的顶栏）。
 *
 * 桌面端一行排开：站名、地图 / 冒险者手册 / 我的成长、等级与经验值芯片、亮暗切换。
 * 767px 以下导航收进菜单按钮（键盘可开关、Esc 关闭、点外面关闭、换页自动关闭），
 * 等级芯片收窄成「Lv. 和星数」，保证 375px 下顶栏不溢出。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'
import HgLevelChip from './HgLevelChip.vue'
import HgThemeToggle from './HgThemeToggle.vue'

/** match 是页面文件路径的前缀，用它判断「当前在哪一项」，不受站点 base 和 cleanUrls 影响。 */
const NAV = [
  { text: '地图', link: '/world/', match: 'world/' },
  { text: '新手村', link: '/novice/', match: 'novice/' },
  { text: '铸造城', link: '/forge/', match: 'forge/' },
  { text: '试炼场', link: '/trial/', match: 'trial/' },
  { text: '冒险者手册', link: '/handbook/', match: 'handbook/' },
  { text: '我的成长', link: '/me/', match: 'me/' },
  { text: '旧版教程', link: '/v1/', match: 'v1/' },
]

const { page } = useData()
const route = useRoute()

const current = computed(() => page.value.relativePath)
function isCurrent(match: string) {
  return current.value.startsWith(match)
}

const open = ref(false)
const bar = ref<HTMLElement | null>(null)
const menuButton = ref<HTMLButtonElement | null>(null)

function closeMenu(focusButton = false) {
  if (!open.value) return
  open.value = false
  if (focusButton) menuButton.value?.focus()
}

function onPointerDown(event: Event) {
  if (!bar.value?.contains(event.target as Node)) open.value = false
}

watch(open, (value) => {
  if (value) document.addEventListener('pointerdown', onPointerDown)
  else document.removeEventListener('pointerdown', onPointerDown)
})

// 跳到别的页面（VitePress 的前端路由）时把菜单收起来。
watch(() => route.path, () => closeMenu())

onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <header ref="bar" class="hg-top" @keydown.escape="closeMenu(true)">
    <nav class="hg-top__inner" aria-label="站点导航">
      <a class="hg-top__logo" :href="withBase('/')">Hello GPU</a>

      <ul class="hg-top__links">
        <li v-for="item in NAV" :key="item.link">
          <a
            class="hg-top__link"
            :class="{ 'is-current': isCurrent(item.match) }"
            :href="withBase(item.link)"
            :aria-current="isCurrent(item.match) ? 'page' : undefined"
          >{{ item.text }}</a>
        </li>
      </ul>

      <div class="hg-top__right">
        <HgLevelChip />
        <HgThemeToggle />
        <button
          ref="menuButton"
          class="hg-top__menu"
          type="button"
          aria-controls="hg-top-menu"
          :aria-expanded="open"
          :aria-label="open ? '关闭菜单' : '打开菜单'"
          @click="open = !open"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
            <path v-if="open" d="m6 6 12 12M18 6 6 18" />
            <path v-else d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>
    </nav>

    <div v-if="open" id="hg-top-menu" class="hg-top__panel">
      <a
        v-for="item in NAV"
        :key="item.link"
        class="hg-top__panel-link"
        :class="{ 'is-current': isCurrent(item.match) }"
        :href="withBase(item.link)"
        :aria-current="isCurrent(item.match) ? 'page' : undefined"
        @click="closeMenu()"
      >{{ item.text }}</a>
    </div>
  </header>
</template>

<style scoped>
.hg-top {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
  background: var(--hg-surface);
  background: color-mix(in srgb, var(--hg-surface) 92%, transparent);
  backdrop-filter: blur(8px);
}

.hg-top__inner {
  display: flex;
  align-items: center;
  gap: 18px;
  max-width: var(--hg-shell-max);
  margin: 0 auto;
  padding: 10px 24px;
}

.hg-top__logo {
  font-family: var(--hg-font-display);
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--hg-ink);
  text-decoration: none;
  white-space: nowrap;
}

.hg-top__links {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-top__link {
  display: inline-block;
  padding: 5px 10px;
  border-radius: var(--hg-radius-tag);
  font-size: 14px;
  font-weight: 500;
  color: var(--hg-ink-2);
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--motion-instant) var(--motion-ease-out),
    background-color var(--motion-instant) var(--motion-ease-out);
}

.hg-top__link:hover {
  background: var(--hg-surface-2);
  color: var(--hg-ink);
}

/* 当前页用深色药丸，暗色主题自动反过来（01 第 2.2 节：主按钮用 --hg-ink 配底色）。 */
.hg-top__link.is-current {
  background: var(--hg-ink);
  color: var(--hg-bg);
  font-weight: 600;
}

.hg-top__right {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}

.hg-top__menu {
  display: none;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink-2);
  cursor: pointer;
}

.hg-top__menu:hover {
  border-color: var(--hg-ink-3);
  color: var(--hg-ink);
}

.hg-top__panel {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 20px 14px;
  border-top: var(--hg-border-width) solid var(--hg-border);
  background: var(--hg-surface);
}

.hg-top__panel-link {
  padding: 10px 12px;
  border-radius: var(--hg-radius-control);
  font-size: 15px;
  font-weight: 500;
  color: var(--hg-ink-2);
  text-decoration: none;
}

.hg-top__panel-link.is-current {
  background: var(--hg-ink);
  color: var(--hg-bg);
  font-weight: 600;
}

.hg-top__logo:focus-visible,
.hg-top__link:focus-visible,
.hg-top__panel-link:focus-visible,
.hg-top__menu:focus-visible {
  outline: 2px solid var(--hg-accent);
  outline-offset: 2px;
}

@media (max-width: 767px) {
  .hg-top__inner {
    gap: 10px;
    padding: 10px 16px;
  }

  .hg-top__logo {
    font-size: 19px;
  }

  .hg-top__links {
    display: none;
  }

  .hg-top__menu {
    display: inline-grid;
  }
}
</style>
