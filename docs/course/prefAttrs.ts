/**
 * 写法 / 路线偏好落到 <html> 的属性上（F-11；03 第 5 节）。
 *
 * LangCode、RouteBlock 在服务端渲染时两份内容都输出，显示哪一份只由 CSS 按这两个属性决定：
 * 组件渲染出来的东西和偏好无关，水合前后完全一致。属性在两处写：
 * - 构建出来的新版页面在 <head> 里先跑 prefsHeadScript（docs/.vitepress/config.mts 的 transformHead），
 *   首屏之前就按存档写好，刷新后不会先显示默认写法再跳成读者选的那一种；
 * - 读完存档以后、读者每次切换时，由布局（useShell）调用 applyPrefAttrs 同步。
 * 没有属性时 CSS 按默认值（HIP）显示。
 */
import type { Prefs } from './progress.ts'
import { DEMO_STORAGE_KEY, STORAGE_KEY } from './storage.ts'

export const LANG_ATTR = 'data-hg-lang'
export const ROUTE_ATTR = 'data-hg-route'

export function applyPrefAttrs(root: Element, prefs: Pick<Prefs, 'lang' | 'route'>) {
  root.setAttribute(LANG_ATTR, prefs.lang)
  root.setAttribute(ROUTE_ATTR, prefs.route)
}

/**
 * 放进 <head> 的内联脚本：从正式存档（演示页是演示存档）读出写法和路线，写到 <html> 上。
 * 只认合法取值；存储不可用或存档损坏时什么都不做，页面按默认值显示。
 */
export function prefsHeadScript(demo = false): string {
  const key = JSON.stringify(demo ? DEMO_STORAGE_KEY : STORAGE_KEY)
  return `(()=>{try{const p=(JSON.parse(localStorage.getItem(${key})||'{}')||{}).prefs||{},d=document.documentElement;`
    + `if(p.lang==='hip'||p.lang==='python')d.setAttribute('${LANG_ATTR}',p.lang);`
    + `if(p.route==='hip'||p.route==='triton')d.setAttribute('${ROUTE_ATTR}',p.route)}catch(e){}})()`
}
