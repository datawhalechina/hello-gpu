import { defineConfig, type HeadConfig } from 'vitepress'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import footnote from 'markdown-it-footnote'
import figurePlugin from './markdown-figures.mjs'
import editorialPlugin from './markdown-editorial.mjs'
import { createImageDimensionLookup } from './markdown-image-dimensions.mjs'
import { navItems, sidebar } from './outline.mjs'
import { labNotebookFiles } from './lab-notebooks.mjs'
import { labArchiveFiles } from './lab-archive.mjs'
import { pyodideFiles } from './pyodide-files.mjs'
import { V2_PREFIXES, V2_PUBLIC } from './launch.ts'
import { prefsHeadScript } from '../course/prefAttrs.ts'

function encodeMermaid(value: string) {
  return encodeURIComponent(value)
}

function prepareMathSvgTemplate(value: string) {
  return value
    .replace(/^<mjx-container v-pre /, '<mjx-container ')
    .replace(/ viewbox="([^"]+)"/gi, (_, viewBox: string) =>
      ` :viewBox="'${viewBox}'"`,
    )
    .replace(/&amp;(lt|gt|amp);/g, '&$1;')
}

const isEdgeOne = process.env.EDGEONE === '1'
const baseConfig = isEdgeOne ? '/' : '/hello-gpu/'
const configuredMarkdownRenderers = new WeakSet<object>()
let imageDimensionLookup: ReturnType<typeof createImageDimensionLookup> | undefined

// 新版（v2）页面直接写在最终路径下。上线切换（任务 M-02）之前它们不进旧版导航，
// 统一加 noindex，也不进站内搜索；上线开关 V2_PUBLIC 和新版页面的路径前缀在 ./launch.ts。
// /preview/ 下是内部预览页（看板、组件预览），始终 noindex、不进搜索。
function isHiddenPage(relativePath = '') {
  if (relativePath.startsWith('preview/')) return true
  return !V2_PUBLIC && V2_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
}

/** 新版布局（docs/.vitepress/theme/index.ts 里的 v2Layouts）。 */
const V2_LAYOUTS = new Set(['hg', 'stage', 'dungeon'])
/** 状态栏有进度点的布局：关卡（F-10）和副本（X-01）。 */
const STAGE_BAR_LAYOUTS = new Set(['stage', 'dungeon'])

const HTML_ENTITIES: Record<string, string> = { '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' }

/**
 * 内容组件发现写错的内容（概念卡的术语键不存在、实测证据缺字段……）时，会画一个带
 * data-hg-content-error 属性的红框（docs/components/kit/contentError.ts）。开发时红框就是警告；
 * 构建时在这里从渲染好的页面里把它们找出来，让构建失败。
 */
function contentErrorsIn(html: string) {
  return [...html.matchAll(/<[a-z]+\s[^>]*\bdata-hg-content-error\b[^>]*>([^<]*)</g)]
    .map((m) => m[1].replace(/&(?:quot|#39|lt|gt|amp);/g, (e) => HTML_ENTITIES[e]).trim())
}

export default defineConfig({
  lang: 'zh-CN',
  title: 'Hello GPU',
  description: 'GPU 算子优化入门 + Agent 自动化（AMD Radeon RX 9070 XT + ROCm 10.0 / 原生 Ubuntu 24.04 实测）',
  base: baseConfig,

  cleanUrls: true,
  appearance: 'dark',
  // Authoring rules for AI-assisted writing live beside the pages they govern.
  srcExclude: ['**/AGENTS.md', '**/CLAUDE.md', 'preview/**'],

  transformHead({ pageData }) {
    const head: HeadConfig[] = []
    // 新版布局的页面：首屏之前按存档把写法 / 路线偏好写到 <html> 上（F-11，见 docs/course/prefAttrs.ts）。
    if (V2_LAYOUTS.has(pageData.frontmatter.layout)) head.push(['script', {}, prefsHeadScript(pageData.frontmatter.demo === true)])
    if (isHiddenPage(pageData.relativePath)) {
      const own = (pageData.frontmatter.head ?? []) as Array<[string, Record<string, string>?]>
      if (!own.some(([tag, attrs]) => tag === 'meta' && attrs?.name === 'robots')) head.push(['meta', { name: 'robots', content: 'noindex' }])
    }
    return head
  },

  transformHtml(html, id) {
    const errors = contentErrorsIn(html)
    if (errors.length) throw new Error(`内容检查没通过（${id}）：\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  },

  vite: {
    // 代码沙盒的编辑器（S-05）是动态 import 的，开发服务器启动时扫描不到：先预构建，免得第一次打开沙盒时
    // Vite 临时重新打包依赖、整页刷新。只影响 docs:dev，构建出来的 CodeMirror 照样是单独按需加载的块。
    optimizeDeps: {
      include: ['@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language'],
    },
    resolve: {
      alias: {
        '@course': fileURLToPath(new URL('../course', import.meta.url)),
        '@kit': fileURLToPath(new URL('../components/kit', import.meta.url)),
        '@sim': fileURLToPath(new URL('../sim', import.meta.url)),
      },
    },
    // 1-14 读者写的 Python Agent（A-02）：Pyodide 的文件自托管在站点的 pyodide/ 目录下（不进仓库）；
    // 实验室 Notebook（L-02）：LabCard 的「下载 .ipynb」用同源地址，构建时从仓库的 notebooks/ 复制进站点；
    // 实验档案馆（L-04）：条目原文和格式说明发进站点的 /lab/data/、/lab/schema.json，浏览页展开详情时按需读
    plugins: [pyodideFiles(), labNotebookFiles(), labArchiveFiles()],
  },

  transformPageData(pageData) {
    // Keep the shared algorithm and experiment sections in the outline;
    // language-specific subheadings live inside implementation tabs.
    if (pageData.relativePath.startsWith('part2-kernels/')) {
      pageData.frontmatter.outline = [2, 2]
    }
    if (/^part\d[^/]*\/chapter\d+\//.test(pageData.relativePath)) {
      pageData.frontmatter.pageClass = 'hg-chapter'
      const codePath = pageData.relativePath.replace(/\/index\.md$/, '/')
      pageData.frontmatter.hasChapterCode = existsSync(new URL(`../../code/${codePath}`, import.meta.url))
    }
    // 关卡和副本状态栏的进度点按正文的 h2 生成（F-10），只有这两种页面留着抽出来的 h2，其他页面的页面数据不变。
    if (!STAGE_BAR_LAYOUTS.has(pageData.frontmatter.layout)) pageData.headers = []
  },

  vue: {
    template: {
      compilerOptions: {
        isCustomElement: (tag: string) => tag.startsWith('mjx-'),
      },
    },
  },

  markdown: {
    math: true,
    headers: { level: [2] },
    async config(md) {
      // Client/server builds can initialize the same renderer concurrently.
      // Register plugins and renderer wrappers only once on each instance.
      if (configuredMarkdownRenderers.has(md)) return
      const getImageDimensions = await (imageDimensionLookup ??= createImageDimensionLookup(
        fileURLToPath(new URL('../', import.meta.url)),
      ))
      if (configuredMarkdownRenderers.has(md)) return
      configuredMarkdownRenderers.add(md)

      md.use(footnote)
      md.use(figurePlugin)
      md.use(editorialPlugin)

      // VitePress 2 alpha lowercases MathJax's static SVG viewBox while
      // compiling Markdown. Bind it explicitly so Vue preserves the
      // case-sensitive attribute and the glyph coordinate system.
      const mathInline = md.renderer.rules.math_inline!
      md.renderer.rules.math_inline = (tokens, idx, options, env, self) =>
        prepareMathSvgTemplate(
          mathInline(tokens, idx, options, env, self),
        )

      const mathBlock = md.renderer.rules.math_block!
      md.renderer.rules.math_block = (tokens, idx, options, env, self) =>
        prepareMathSvgTemplate(
          mathBlock(tokens, idx, options, env, self),
        )

      // 同一条脚注被多次引用时，默认会渲染成 [6]、[6:1]、[6:2] …
      // 对读者没有意义，统一只显示脚注序号，让回跳锚点照常工作。
      md.renderer.rules.footnote_caption = (tokens, idx) => {
        const n = Number(tokens[idx].meta.id + 1).toString()
        return `[${n}]`
      }

      const fence = md.renderer.rules.fence!
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        const language = token.info.trim().split(/\s+/)[0]

        if (language === 'mermaid') {
          return `<MermaidDiagram code="${encodeMermaid(token.content)}" />`
        }

        return fence(tokens, idx, options, env, self)
      }

      // Rewrite ![](*.png) → ![](*.webp) at render time so authors keep
      // editing PNG locally while the built site serves WebP.
      const defaultImage =
        md.renderer.rules.image ||
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options))
      md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        const srcIndex = token.attrIndex('src')
        if (srcIndex >= 0) {
          const src = token.attrs![srcIndex][1]
          const dimensions = getImageDimensions(src, env.path || env.relativePath)
          if (dimensions && token.attrIndex('width') < 0 && token.attrIndex('height') < 0) {
            token.attrSet('width', String(dimensions.width))
            token.attrSet('height', String(dimensions.height))
          }
          if (/\.png(\?.*)?$/i.test(src)) {
            token.attrs![srcIndex][1] = src.replace(/\.png(\?.*)?$/i, (_, q) => `.webp${q ?? ''}`)
          }
        }
        if (token.attrIndex('loading') < 0) {
          token.attrSet('loading', 'lazy')
        }
        if (token.attrIndex('decoding') < 0) {
          token.attrSet('decoding', 'async')
        }
        return defaultImage(tokens, idx, options, env, self)
      }
    },
  },

  themeConfig: {
    nav: navItems,
    sidebarMenuLabel: '全书目录',
    returnToTopLabel: '返回顶部',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换至浅色',
    darkModeSwitchTitle: '切换至深色',

    search: {
      provider: 'local',
      options: {
        // 未上线的新版页面和内部预览页不进站内搜索（见上面的 isHiddenPage）。
        async _render(src, env, md) {
          const html = await md.renderAsync(src, env)
          if (env.frontmatter?.search === false || isHiddenPage(env.relativePath)) return ''
          return html
        },
        translations: {
          button: {
            buttonText: '搜索章节、算子关键词…',
            buttonAriaLabel: '搜索文档',
          },
          modal: {
            noResultsText: '无法找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
            },
          },
        },
      },
    },

    sidebar,


    editLink: {
      pattern: 'https://github.com/datawhalechina/hello-gpu/blob/dev/docs/:path',
      text: '在 GitHub 上编辑此页',
    },

    outline: {
      level: [1, 3],
      label: '本页目录',
    },

    footer: {
      message: '<a href="https://beian.miit.gov.cn/" target="_blank">京ICP备2026002630号-1</a> | <a href="https://beian.mps.gov.cn/#/query/webSearch?code=11010602202215" rel="noreferrer" target="_blank">京公网安备11010602202215号</a>',
      copyright: '本作品采用 <a href="http://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank">知识共享署名-非商业性使用-相同方式共享 4.0 国际许可协议（CC BY-NC-SA 4.0）</a> 进行许可',
    },
  },
})
