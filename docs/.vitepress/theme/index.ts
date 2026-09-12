import DefaultTheme from 'vitepress/theme'
import './custom.css'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import MermaidDiagram from './MermaidDiagram.vue'
import SidebarToggle from './SidebarToggle.vue'
import ImplementationTabs from '../../components/ImplementationTabs.vue'
import ChapterPrelude from './ChapterPrelude.vue'
import ChapterMeta from './ChapterMeta.vue'

const Announcement = () => h('div', {
  class: 'announcement-banner',
}, [h('span', { class: 'announcement-label' }, 'ALPHA'), h('span', null, '教程正在持续完善，部分内容仍待补充。'), h('a', { href: 'https://github.com/datawhalechina/hello-gpu/issues' }, '反馈问题 ↗')])

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('MermaidDiagram', MermaidDiagram)
    app.component('ImplementationTabs', ImplementationTabs)
    app.component('ChapterMeta', ChapterMeta)
  },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-top': () => [h(Announcement), h(SidebarToggle)],
      'nav-bar-title-after': () => h('span', { class: 'hg-nav-tagline' }, '从理解到优化'),
      'sidebar-nav-before': () => h('div', { class: 'hg-sidebar-label' }, '全书目录'),
      'sidebar-nav-after': () => h('div', { class: 'hg-sidebar-colophon' }, [h('strong', null, 'Hello GPU'), h('span', null, '看懂 GPU，亲手优化每一次计算。')]),
      'doc-before': () => h(ChapterPrelude),
    })
  }
} satisfies Theme
