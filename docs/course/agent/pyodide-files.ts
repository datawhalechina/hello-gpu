/**
 * 自托管的 Pyodide 文件清单（A-02；09 第 3 节：Pyodide 文件自托管，不依赖海外 CDN）。
 *
 * 构建时 docs/.vitepress/pyodide-files.mjs 从 npm 包 pyodide（package.json 里写死版本）把这几个文件
 * 复制到站点的 pyodide/ 目录（产物里有，仓库里没有）；docs:dev 直接从 node_modules/pyodide 提供。
 * 只有读者在 AgentCode 里点「运行我的 Agent」时浏览器才会请求它们，首屏不加载。
 *
 * 字节数是 pyodide 包里的文件大小，单测逐个核对：升级 pyodide 时单测会提醒更新这里。
 * 下载进度按这里的字节数算；界面上写的「约 xx MB」也从这里算，不手写。
 * 纯数据，构建配置和浏览器两边都导入。
 */

/** pyodide 包的版本（和 package.json 一致，单测核对） */
export const PYODIDE_VERSION = '314.0.7'

/** 文件放在站点 base 下的这个目录里 */
export const PYODIDE_DIR = 'pyodide/'

export interface PyodideFile {
  name: string
  bytes: number
  /** 用 fetch 下载、能数出下载进度的文件；pyodide.mjs、pyodide.asm.mjs 是用 import() 加载的，数不到 */
  fetched: boolean
}

export const PYODIDE_FILES: readonly PyodideFile[] = [
  { name: 'pyodide.mjs', bytes: 17931, fetched: false },
  { name: 'pyodide.asm.mjs', bytes: 1250344, fetched: false },
  { name: 'pyodide.asm.wasm', bytes: 9598218, fetched: true },
  { name: 'python_stdlib.zip', bytes: 2545637, fetched: true },
  { name: 'pyodide-lock.json', bytes: 119077, fetched: true },
]

/** 全部文件一共多少字节：部署多出来的体积，也是读者第一次运行要下载的量（不算服务器压缩） */
export const PYODIDE_BYTES = PYODIDE_FILES.reduce((sum, f) => sum + f.bytes, 0)

/** 能数出进度的那几个文件一共多少字节 */
export const PYODIDE_FETCHED_BYTES = PYODIDE_FILES.reduce((sum, f) => sum + (f.fetched ? f.bytes : 0), 0)

/** 字节数写成「13.5 MB」（1 MB = 1000 × 1000 字节） */
export function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`
}
