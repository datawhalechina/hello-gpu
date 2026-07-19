import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chapters, parts, repoBaseUrl } from './outline.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..', '..')
const writeStubs = process.argv.includes('--write-stubs')
const checkOnly = process.argv.includes('--check')
const changedFiles = []

function part2MetadataErrors() {
  const part = parts.find((item) => item.prefix === '/part2-kernels/')
  const errors = []

  if (!part) {
    return ['docs/.vitepress/outline.mjs: missing Part 2 outline metadata']
  }

  if (typeof part.landing !== 'string' || part.landing.trim() === '') {
    errors.push('docs/.vitepress/outline.mjs: missing Part 2 landing metadata')
  }
  if (typeof part.landingSource !== 'string' || part.landingSource.trim() === '') {
    errors.push('docs/.vitepress/outline.mjs: missing Part 2 landingSource metadata')
  }

  const landingPage = join(repoRoot, part.landingSource || 'docs/part2-kernels/index.md')
  if (!existsSync(landingPage)) {
    errors.push('docs/part2-kernels/index.md: missing Part 2 landing page')
  }

  for (const chapter of chapters.filter((item) => item.part.prefix === part.prefix)) {
    for (const field of ['code', 'status', 'summary']) {
      if (typeof chapter[field] !== 'string' || chapter[field].trim() === '') {
        errors.push(`${chapter.source}: missing ${field} metadata`)
      }
    }
  }

  return errors
}

async function readText(path) {
  return readFile(path, 'utf8')
}

async function writeIfChanged(path, content) {
  let current = null
  if (existsSync(path)) {
    current = await readText(path)
  }

  if (current === content) {
    return
  }

  changedFiles.push(path)
  if (!checkOnly) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

function chapterMarkdown(chapter) {
  const sectionMarkdown = chapter.sections
    .map(([title, body], index) => `## ${chapter.number}.${index + 1} ${title}\n\n${body}`)
    .join('\n\n')

  return `---\ntitle: "第${chapter.number}章 ${chapter.title}"\ndescription: "Hello GPU 第${chapter.number}章 · ${chapter.summary}"\n---\n\n# 第${chapter.number}章 ${chapter.title}\n\n## 本章导读\n\n> ${chapter.lead}\n\n${sectionMarkdown}\n\n## 本章小结\n\n- 本章目前是 Alpha 阶段的大纲骨架，正式正文会在对应实验跑通后补齐。\n- 涉及命令、输出或性能数字的内容，后续必须在 Radeon RX 9070 XT + ROCm 7.13 / 原生 Ubuntu 24.04 上实测。\n- 与本章相关的代码、日志和实验底稿会放在 \`${chapter.code}/\`。\n\n## 延伸阅读\n\n- 待补：正式正文完成时补充对应官方文档、论文或工具链接。\n`
}

function syncChapterMetadata(existing, chapter) {
  let next = existing

  if (/^---\n[\s\S]*?\n---\n/.test(next)) {
    const frontmatter = `---\ntitle: "第${chapter.number}章 ${chapter.title}"\ndescription: "Hello GPU 第${chapter.number}章 · ${chapter.summary}"\n---\n`
    next = next.replace(/^---\n[\s\S]*?\n---\n/, frontmatter)
  } else {
    next = `---\ntitle: "第${chapter.number}章 ${chapter.title}"\ndescription: "Hello GPU 第${chapter.number}章 · ${chapter.summary}"\n---\n\n${next}`
  }

  if (/^# 第\d+章 .+$/m.test(next)) {
    next = next.replace(/^# 第\d+章 .+$/m, `# 第${chapter.number}章 ${chapter.title}`)
  } else if (/^# .+$/m.test(next)) {
    next = next.replace(/^# .+$/m, `# 第${chapter.number}章 ${chapter.title}`)
  } else {
    next = next.replace(/^(---\n[\s\S]*?\n---\n)/, `$1\n# 第${chapter.number}章 ${chapter.title}\n`)
  }

  next = next.replace(/^(#{2,4}) \d+((?:\.\d+)+) /gm, `$1 ${chapter.number}$2 `)

  return next
}

async function syncChapters() {
  for (const chapter of chapters) {
    const path = join(repoRoot, chapter.source)
    if (!existsSync(path) || writeStubs) {
      await writeIfChanged(path, chapterMarkdown(chapter))
      continue
    }

    const current = await readText(path)
    await writeIfChanged(path, syncChapterMetadata(current, chapter))
  }
}

function readmeDirectory() {
  const lines = [
    '## 目录',
    '',
    `> 前言 + ${parts.length - 1} 篇正文，共 ${chapters.length} 章。显示章号由 \`docs/.vitepress/outline.mjs\` 自动生成，新增章节后运行 \`npm run docs:sync-outline\` 即可同步 README 与站点导航。`,
    '',
    '| 章节名 | 简介 | 状态 |',
    '| ---- | ---- | ---- |',
  ]

  for (const part of parts) {
    const partTitle = part.landingSource
      ? `[${part.readmeTitle}](${repoBaseUrl}/${part.landingSource})`
      : part.readmeTitle
    lines.push(`| **${partTitle}** | | |`)
    for (const chapter of chapters.filter((item) => item.part.prefix === part.prefix)) {
      lines.push(`| [第 ${chapter.number} 章 ${chapter.title}](${repoBaseUrl}/${chapter.source}) | ${chapter.summary} | ${chapter.status} |`)
    }
  }

  return `${lines.join('\n')}\n`
}

async function syncReadme() {
  const path = join(repoRoot, 'README.md')
  const current = await readText(path)
  const next = current.replace(/## 目录\n[\s\S]*?\n## 贡献者名单/, `${readmeDirectory()}\n## 贡献者名单`)
  await writeIfChanged(path, next)
}

async function main() {
  if (checkOnly) {
    const metadataErrors = part2MetadataErrors()
    if (metadataErrors.length > 0) {
      console.error('Part 2 outline metadata is incomplete:')
      for (const error of metadataErrors) {
        console.error(`- ${error}`)
      }
      process.exit(1)
    }
  }

  await syncChapters()
  await syncReadme()

  if (checkOnly && changedFiles.length > 0) {
    console.error('Docs outline is out of sync:')
    for (const path of changedFiles) {
      console.error(`- ${path}`)
    }
    process.exit(1)
  }

  if (changedFiles.length > 0) {
    console.log(`Synced docs outline (${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'}).`)
  } else {
    console.log('Docs outline already in sync.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
