// Pyodide 的文件自托管（A-02；09 第 3 节：Pyodide 文件自托管，不依赖海外 CDN）。
// - 构建：把 npm 包 pyodide 里运行要的几个文件（清单在 docs/course/agent/pyodide-files.ts）
//   作为产物写进站点的 pyodide/ 目录，仓库里没有这些文件；
// - 开发（docs:dev，以及截图巡检自己起的 vitepress dev）：直接从 node_modules/pyodide 提供这几个文件。
// 浏览器只在读者点「运行我的 Agent」时才请求它们（docs/components/kit/AgentCode.vue），首屏不加载。
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { PYODIDE_DIR, PYODIDE_FILES } from '../course/agent/pyodide-files.ts'

// .wasm 一定要是 application/wasm：Pyodide 用 WebAssembly.instantiateStreaming 加载，类型不对会失败
const TYPES = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
  '.json': 'application/json; charset=utf-8',
}

export function pyodideFiles() {
  const dir = path.dirname(createRequire(import.meta.url).resolve('pyodide/package.json'))
  let prefix = `/${PYODIDE_DIR}`
  let ssr = false
  return {
    name: 'hello-gpu:pyodide-files',
    configResolved(config) {
      prefix = `${config.base}${PYODIDE_DIR}`
      ssr = Boolean(config.build.ssr)
    },
    configureServer(server) {
      // 直接加的中间件排在 Vite 自己的前面，这时请求的路径还带着站点的 base
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        const file = pathname.startsWith(prefix) ? PYODIDE_FILES.find((f) => f.name === pathname.slice(prefix.length)) : undefined
        if (!file) return next()
        res.setHeader('Content-Type', TYPES[path.extname(file.name)])
        createReadStream(path.join(dir, file.name)).on('error', next).pipe(res)
      })
    },
    async generateBundle() {
      // 服务端渲染那一遍不用：页面的静态文件只来自客户端那一遍
      if (ssr) return
      for (const file of PYODIDE_FILES) {
        this.emitFile({ type: 'asset', fileName: `${PYODIDE_DIR}${file.name}`, source: await readFile(path.join(dir, file.name)) })
      }
    },
  }
}
