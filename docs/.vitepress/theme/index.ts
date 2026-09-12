import DefaultTheme from 'vitepress/theme'
import './custom.css'
import type { Theme } from 'vitepress'
import { h } from 'vue'
import MermaidDiagram from './MermaidDiagram.vue'
import SidebarToggle from './SidebarToggle.vue'
import ImplementationTabs from '../../components/ImplementationTabs.vue'

const Announcement = () => h('div', {
  class: 'announcement-banner',
}, '⚠️ Alpha内测版本警告：此为早期内部构建版本，尚不完整且可能存在错误，欢迎大家提Issue反馈问题或建议。')

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('MermaidDiagram', MermaidDiagram)
    app.component('ImplementationTabs', ImplementationTabs)
  },
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-top': () => [h(Announcement), h(SidebarToggle)],
    })
  }
} satisfies Theme
