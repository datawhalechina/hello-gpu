import { defineConfig } from 'vitepress'
import { existsSync } from 'node:fs'
import footnote from 'markdown-it-footnote'
import figurePlugin from './markdown-figures.mjs'
import editorialPlugin from './markdown-editorial.mjs'
import { navItems, sidebar } from './outline.mjs'

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

export default defineConfig({
  lang: 'zh-CN',
  title: 'Hello GPU',
  description: 'GPU 算子优化入门 + Agent 自动化（AMD Radeon RX 9070 XT + ROCm 7.13 / 原生 Ubuntu 24.04 实测）',
  base: baseConfig,

  cleanUrls: true,
  appearance: 'dark',

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
    config(md) {
      // Client/server builds can initialize the same renderer concurrently.
      // Register plugins and renderer wrappers only once on each instance.
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
