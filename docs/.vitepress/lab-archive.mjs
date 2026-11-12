// 实验档案馆（L-04）的站内文件：档案条目（docs/lab/data/<关卡 id>/<文件>.json）和格式说明（docs/lab/schema.json）
// 原样发进站点的 /lab/data/… 和 /lab/schema.json。浏览页展开详情时按需读条目全文，「下载 JSON」也链到这里：
// 和页面同源，浏览器按 download 属性直接下载。
// - 构建：客户端那一遍把文件写进站点（服务端渲染那一遍不用）；
// - 开发（docs:dev，以及截图巡检自己起的 vitepress dev）：直接从仓库提供这些文件。
// 条目放没放对、格式对不对由 scripts/course/lab-data-check.mjs 检查，这里只发放对了位置的 JSON。
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listArchiveFiles } from '../../scripts/course/lab-data-check.mjs'
import { ARCHIVE_DIR, SCHEMA_FILE } from '../course/labArchive.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ENTRY_FILE = new RegExp(`^${ARCHIVE_DIR}/[^/]+/[^/]+\\.json$`)

/** 站点上的路径（不带 base）→ 仓库里的路径。 */
function siteFiles() {
  const files = [SCHEMA_FILE, ...listArchiveFiles().filter((file) => ENTRY_FILE.test(file))]
  return new Map(files.map((file) => [file.slice('docs/'.length), file]))
}

export function labArchiveFiles() {
  let base = '/'
  let ssr = false
  return {
    name: 'hello-gpu:lab-archive',
    configResolved(config) {
      base = config.base
      ssr = Boolean(config.build.ssr)
    },
    configureServer(server) {
      // 直接加的中间件排在 Vite 自己的前面，这时请求的路径还带着站点的 base。
      // 带查询串的不管：页面里 import 这些 JSON（例如组件预览页的演示数据）时，Vite 用 ?import 请求把它变成 JS 模块
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        const file = !url.includes('?') && url.startsWith(base) ? siteFiles().get(url.slice(base.length)) : undefined
        if (!file) return next()
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        createReadStream(path.join(ROOT, file)).on('error', next).pipe(res)
      })
    },
    async generateBundle() {
      if (ssr) return
      for (const [fileName, file] of siteFiles()) {
        this.emitFile({ type: 'asset', fileName, source: await readFile(path.join(ROOT, file)) })
      }
    },
  }
}
