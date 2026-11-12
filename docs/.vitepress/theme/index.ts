import DefaultTheme from 'vitepress/theme'
import './custom.css'
import './v2/tokens.css'
import { useData, withBase, type Theme } from 'vitepress'
import { h, type Component } from 'vue'
import MermaidDiagram from './MermaidDiagram.vue'
import SidebarToggle from './SidebarToggle.vue'
import ImplementationTabs from '../../components/ImplementationTabs.vue'
import ChapterPrelude from './ChapterPrelude.vue'
import ChapterMeta from './ChapterMeta.vue'
import NewStagesNotice from './NewStagesNotice.vue'
import UiIcon from './UiIcon.vue'
import HgLayout from './v2/HgLayout.vue'
import StageLayout from './v2/StageLayout.vue'
import DungeonLayout from './v2/DungeonLayout.vue'
import { registerKit } from '../../components/kit/index.ts'

// 新版布局（09 第 1 节）：frontmatter `layout: hg`（通用页面）、`layout: stage`（关卡）、`layout: dungeon`（副本，X-01）。
// 这些页面不经过默认主题的导航和侧边栏，旧版页面照旧使用默认主题。
const v2Layouts: Record<string, Component> = { hg: HgLayout, stage: StageLayout, dungeon: DungeonLayout }

// 旧版页面顶部的公告条（M-02 上线切换）：告诉老读者新版已上线、旧版地址不变。
const Announcement = () => h('div', {
  class: 'announcement-banner',
}, [h('span', { class: 'announcement-label' }, '新版上线'), h('span', null, '闯关式新版教程已上线（新手村开放），旧版章节地址不变。'), h('a', { href: withBase('/') }, '进入新版 ↗'), h('a', { href: 'https://github.com/datawhalechina/hello-gpu/issues' }, '反馈问题 ↗')])

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('MermaidDiagram', MermaidDiagram)
    app.component('ImplementationTabs', ImplementationTabs)
    app.component('ChapterMeta', ChapterMeta)
    registerKit(app)
  },
  Layout() {
    const { frontmatter } = useData()
    const v2 = v2Layouts[frontmatter.value.layout]
    if (v2) return h(v2)
    return h(DefaultTheme.Layout, null, {
      'layout-top': () => [h(Announcement), h(SidebarToggle)],
      'nav-bar-title-after': () => h('span', { class: 'hg-nav-tagline' }, '从理解到优化'),
      'sidebar-nav-before': () => h('div', { class: 'hg-sidebar-label' }, '全书目录'),
      'sidebar-nav-after': () => h('div', { class: 'hg-sidebar-colophon' }, [
        h('div', { class: 'hg-sidebar-brand' }, [
          h(UiIcon, { name: 'chip', size: 22 }),
          h('strong', null, 'Hello GPU'),
        ]),
        h('span', null, '看懂 GPU，亲手优化每一次计算。'),
      ]),
      // 章节位置条下面是「新版对应关卡」的提示（M-01，新版上线以后才出现）。
      'doc-before': () => [h(ChapterPrelude), h(NewStagesNotice)],
    })
  }
} satisfies Theme
