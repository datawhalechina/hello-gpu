/**
 * 冒险者手册（P-05）的构建时数据。VitePress 的数据加载器：文件名以 .data.ts 结尾，load() 在构建（和开发服务器）的
 * Node 里运行，结果序列化进页面，页面里 import { data } from '@course/handbook.data.ts' 拿到。
 *
 * - 术语索引的分组和顺序：按拼音排要用中文排序规则，各浏览器带的排序数据不一定一样，
 *   所以在这里用 Node 的 ICU 算一次（handbook.ts 的 termIndex），服务端渲染和浏览器用同一份结果，水合前后一致。
 * - 实验环境指南（L-06 的 docs/handbook/setup/index.md）写好了没有：写好了，手册里的入口自动变成链接，不用改手册。
 */
import { termIndex, type IndexZone } from './handbook.ts'

export interface HandbookData {
  index: IndexZone[]
  setupReady: boolean
}

declare const data: HandbookData
export { data }

/** 相对这个文件。术语表改了要重排索引；指南页加上或删掉时入口要跟着变。 */
const SETUP_PAGE = '../handbook/setup/index.md'

export default {
  watch: ['./glossary.json', SETUP_PAGE],
  load(files: string[]): HandbookData {
    return {
      index: termIndex(),
      setupReady: files.some((file) => file.replace(/\\/g, '/').endsWith(SETUP_PAGE.slice(2))),
    }
  },
}
