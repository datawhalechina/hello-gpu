import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chapters } from '../docs/.vitepress/outline.mjs'

if (process.argv.length > 3) {
  console.error('Usage: node scripts/check-chapter-ui.mjs [output-directory]')
  process.exit(1)
}

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const outputDir = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, 'docs/.vitepress/dist')
const failures = []

// Count rendered elements, excluding inline code and styles that can mention UI classes.
function renderedClasses(html) {
  const markup = html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
  const classes = []

  for (const [tag] of markup.matchAll(/<[a-z][\w:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    for (const attribute of tag.matchAll(/\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      if (attribute[1].toLowerCase() === 'class') {
        classes.push((attribute[2] ?? attribute[3] ?? attribute[4] ?? '').split(/\s+/))
      }
    }
  }

  return classes
}

for (const chapter of chapters) {
  const htmlPath = resolve(outputDir, chapter.source.replace(/^docs\//, '').replace(/\.md$/, '.html'))
  let html

  try {
    html = readFileSync(htmlPath, 'utf8')
  } catch (error) {
    failures.push(`${chapter.source}: cannot read ${htmlPath} (${error.code ?? error.message})`)
    continue
  }

  const classes = renderedClasses(html)
  const count = (className) => classes.filter((tokens) => tokens.includes(className)).length
  const expectedCounts = {
    'hg-chapter-meta': 1,
    'hg-chapter-prelude': 1,
    // Chapter 19 describes a separate hardware baseline in its own content.
    'hg-chapter-baseline': chapter.number === 19 ? 0 : 1,
    'hg-reading-route-cards': chapter.part.prefix === '/part2-kernels/' ? 1 : 0,
  }

  for (const [className, expected] of Object.entries(expectedCounts)) {
    const actual = count(className)
    if (actual !== expected) {
      failures.push(`${chapter.source}: .${className} expected ${expected}, found ${actual}`)
    }
  }

  const guides = count('hg-reading-guide')
  if (guides > 1) {
    failures.push(`${chapter.source}: .hg-reading-guide expected at most 1, found ${guides}`)
  }

  const repeatedLeads = classes.filter((tokens) => tokens.filter((token) => token === 'hg-chapter-lead').length > 1).length
  if (repeatedLeads > 0) {
    failures.push(`${chapter.source}: repeated hg-chapter-lead class on ${repeatedLeads} element(s)`)
  }
}

if (failures.length > 0) {
  console.error(`Chapter UI check failed: ${chapters.length} chapters checked, ${failures.length} violation(s).`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Chapter UI check passed: ${chapters.length} chapters checked; chapter metadata and reading guides are not duplicated.`)
}
