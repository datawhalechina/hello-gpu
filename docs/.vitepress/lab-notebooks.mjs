// 实验室 Notebook 的站内下载（L-02；07 第 10 节「下载 .ipynb」）：
// - 构建：把仓库里已经生成的实验室 Notebook（scripts/course/nb-build.mjs 的 labTargets：gpu: true 的关卡、
//   env: gpu 的副本）原样写进站点，路径和仓库里一样（notebooks/<区域>/<slug>/<slug>-hip.ipynb 等），
//   LabCard 的「下载 .ipynb」链到这里：和页面同源，浏览器才会按 download 属性直接下载，而不是打开一页 JSON；
// - 开发（docs:dev，以及截图巡检自己起的 vitepress dev）：直接从仓库的 notebooks/ 提供这些文件。
// 只发大纲里登记了的实验室 Notebook，旧版的 notebooks/part*/ 不进站点。
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { labTargets, notebookPath, notebookRoutes } from '../../scripts/course/nb-build.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const OUTLINE = path.join(ROOT, 'docs/course/outline.json')

/** 大纲里所有实验室 Notebook 在仓库里的路径，只留已经生成了的。 */
function labNotebooks() {
  const outline = JSON.parse(readFileSync(OUTLINE, 'utf8'))
  return labTargets(outline)
    .flatMap((target) => notebookRoutes(target).map((route) => notebookPath(target, route)))
    .filter((file) => existsSync(path.join(ROOT, file)))
}

export function labNotebookFiles() {
  let base = '/'
  let ssr = false
  return {
    name: 'hello-gpu:lab-notebooks',
    configResolved(config) {
      base = config.base
      ssr = Boolean(config.build.ssr)
    },
    configureServer(server) {
      // 直接加的中间件排在 Vite 自己的前面，这时请求的路径还带着站点的 base
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        const file = pathname.startsWith(base) ? pathname.slice(base.length) : ''
        if (!file.startsWith('notebooks/') || !file.endsWith('.ipynb') || !labNotebooks().includes(file)) return next()
        res.setHeader('Content-Type', 'application/x-ipynb+json; charset=utf-8')
        createReadStream(path.join(ROOT, file)).on('error', next).pipe(res)
      })
    },
    async generateBundle() {
      // 服务端渲染那一遍不用：页面的静态文件只来自客户端那一遍
      if (ssr) return
      for (const file of labNotebooks()) {
        this.emitFile({ type: 'asset', fileName: file, source: await readFile(path.join(ROOT, file)) })
      }
    },
  }
}
