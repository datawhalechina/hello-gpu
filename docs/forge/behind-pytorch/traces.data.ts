/**
 * 2-5 trace 浏览器的参考数据（构建时）。VitePress 的数据加载器（同 course/labArchive.data.ts）：load() 在构建和开发服务器的
 * Node 里运行，结果序列化进本关的页面。
 *
 * 读 docs/lab/data/ 下的全部条目，用 scripts/course/lab-data-check.mjs 检查（和 npm run course:check 同一套规则）；
 * 挑这一关的真实记录里带 trace 的、最新的那条（trace.ts 的 archiveTraceSet，示例条目不算），只把它的 trace 放进页面。
 * 还没有这样的记录时是 null，浏览器用示意数据。
 */
import { checkArchive, loadArchive } from '../../../scripts/course/lab-data-check.mjs'
import { formatError } from '../../../scripts/course/stage-check.mjs'
import { archiveTraceSet, type TraceSet } from './trace.ts'

declare const data: TraceSet | null
export { data }

export default {
  // 相对这个文件：条目改了、加了、删了，或者格式说明改了，都要重新挑
  watch: ['../../lab/data/**/*.json', '../../lab/schema.json'],
  load(): TraceSet | null {
    const { errors, entries } = checkArchive(loadArchive())
    if (errors.length) {
      throw new Error(`实验档案馆的条目没有通过检查（npm run course:check 也会列出来）：\n${errors.map(formatError).join('\n')}`)
    }
    return archiveTraceSet(entries)
  },
}
