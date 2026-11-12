/**
 * 内容写错了怎么办（F-09）：概念卡的术语键不存在、实测证据缺字段……
 * 组件把返回的文案画成醒目的红框，并给那个元素加 data-hg-content-error 属性：
 * 开发时页面上看得到、控制台也报错；构建时 docs/.vitepress/config.mts 的 transformHtml
 * 在渲染出来的页面里找这个属性，找到就让 vitepress build 失败。
 *
 * 不在服务端渲染里直接抛异常：Vue 在生产模式下会吞掉渲染中的异常，只打一行日志，构建照样「成功」。
 */
export function contentError(message: string, page = ''): string {
  const text = page ? `${page}：${message}` : message
  if (!import.meta.env.SSR) console.error(`[Hello GPU] ${text}`)
  return text
}
