/**
 * 实验档案馆（L-04）的构建时数据。VitePress 的数据加载器（同 handbook.data.ts）：load() 在构建和开发服务器的 Node 里运行，
 * 结果序列化进页面，浏览页 import { data } from '@course/labArchive.data.ts' 拿到。
 *
 * - 读 docs/lab/data/ 下的全部条目，用 scripts/course/lab-data-check.mjs 检查（和 npm run course:check 同一套规则），
 *   没通过就让构建失败：页面上不会出现格式不对、和凭证对不上的记录。
 * - 每条只给一行摘要（labArchive.ts 的 summarize）。条目全文不进页面，展开详情时再读 /lab/data/<条目 id>.json
 *   （docs/.vitepress/lab-archive.mjs 把条目原样发进站点），档案越来越多，页面的 JS 也不会跟着变大。
 */
import { checkArchive, loadArchive } from '../../scripts/course/lab-data-check.mjs'
import { formatError } from '../../scripts/course/stage-check.mjs'
import { summarize, type ArchiveEntry, type ArchiveSummary } from './labArchive.ts'

export interface LabArchiveData {
  entries: ArchiveSummary[]
}

declare const data: LabArchiveData
export { data }

export default {
  // 相对这个文件：条目改了、加了、删了，或者格式说明改了，都要重新检查
  watch: ['../lab/data/**/*.json', '../lab/schema.json'],
  load(): LabArchiveData {
    const { errors, entries } = checkArchive(loadArchive())
    if (errors.length) {
      throw new Error(`实验档案馆的条目没有通过检查（npm run course:check 也会列出来）：\n${errors.map(formatError).join('\n')}`)
    }
    return { entries: entries.map(({ id, entry }: { id: string; entry: ArchiveEntry }) => summarize(id, entry)) }
  },
}
