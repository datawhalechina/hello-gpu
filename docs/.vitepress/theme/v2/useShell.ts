/**
 * 两种新版布局（HgLayout、StageLayout）共用的外壳状态：演示存档的选择、简洁模式、减弱动效，
 * 以及把写法 / 路线偏好同步到 <html> 上（F-11，LangCode、RouteBlock 的 CSS 按它显示）。
 * 要在布局的 setup 里调用——演示存档必须赶在正文组件第一次读存档之前选好。
 */
import { computed, watch } from 'vue'
import { useData } from 'vitepress'
import { applyPrefAttrs } from '@course/prefAttrs.ts'
import { usePageStore, useProgress } from '@course/useProgress.ts'

export function useShell() {
  const { frontmatter } = useData()
  // 演示页（frontmatter demo: true）用单独的演示存档，不碰读者的真实进度。
  usePageStore(() => frontmatter.value.demo === true)

  // 偏好只能从 state 上现取：读存档时 useProgress 会整体替换 state.prefs，
  // 解构出来的那份引用停在替换之前的空档上，不会跟着更新。
  const { state, loaded } = useProgress()

  /** 简洁模式（01 第 4 节、04 第 8 节）：收起点阵底纹，顺带关掉动效。 */
  const plain = computed(() => state.prefs.plain)

  /**
   * 减弱动效（02 第 4 节）：系统的 prefers-reduced-motion 由 tokens.css 直接处理，
   * 这里只负责读者在存档里的设置——关掉动效，或者打开简洁模式。
   * 存档读出来之前偏好都是默认值（false），所以首屏 HTML 和水合后一致。
   */
  const motion = computed(() => (state.prefs.reducedMotion || plain.value ? 'reduce' : undefined))

  // 写法 / 路线偏好：读完存档才同步（之前 state 里是默认值，不能盖掉 <head> 脚本按存档写好的属性）；
  // 同步执行，读者点了切换，同一个事件里全页的 LangCode / RouteBlock 就已经换好，组件可以接着挪焦点。
  if (typeof document !== 'undefined') {
    watch(
      () => (loaded.value ? `${state.prefs.lang}|${state.prefs.route}` : ''),
      (key) => {
        if (key) applyPrefAttrs(document.documentElement, state.prefs)
      },
      { immediate: true, flush: 'sync' },
    )
  }

  return { plain, motion }
}
