#!/usr/bin/env node
// 校验新版关卡页、副本页和外部题页：docs/{novice,forge,trial}/<slug>/index.md、docs/dungeon/<slug>/index.md 的元数据、骨架、
// 组件、代码块长度和禁用词；docs/dungeon/external/ 下的外部题索引页和原创题解页的组件、禁用词，题解页和外部题数据对得上。
// 用法：node scripts/course/stage-check.mjs（npm run course:check 会调用）
//
// 规则来源：课程规则（元数据）、第 3 节（骨架顺序）、第 4 节（代码块长度）、第 8 节（完成定义）；
// 课程规则（新手村代码 10 行、新术语 3 个）、第 5 节（禁用词）；课程规则（组件登记表）；
// （题解页的目录是 docs/course/external-problems.json 里题的 id，页面上放这道题的 ExternalProblem 卡片，来源和许可证写在卡片上）。
//
// 只检查 outline.json 里 status 为 draft 或 ready 的关卡和副本：planned 的只有占位页（pilot 是 NV-04 之前试点关卡的状态）。
// 检查函数都是纯函数（输入文件名、正文和几份数据），scripts/tests/course-stage-check.test.mjs 直接喂小样例
// 验证每条规则的通过和不通过。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseFrontmatter } from './frontmatter.mjs'
import { MAX_NEW_TERMS_PER_STAGE, compileBannedWords, findBanned } from './course-data-check.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** 新版关卡所在的三个目录（09 第 1 节）。 */
export const ZONE_DIRS = ['novice', 'forge', 'trial']
/** 副本页的目录：docs/dungeon/<slug>/index.md，地址 /dungeon/<slug>/（X-01 第 3 条）。大厅 docs/dungeon/index.md 不在子目录里，不是副本页。 */
export const DUNGEON_DIR = 'dungeon'
/**
 * 外部练习题（X-08）的目录：索引页 docs/dungeon/external/index.md，题解页 docs/dungeon/external/<题的 id>/index.md。
 * 它在副本目录下面，但不是副本：副本检查按 layout: dungeon 认副本页，会跳过这里。
 */
export const EXTERNAL_DIR = 'dungeon/external'
/** 只有上线了的关卡（06 第 8 节：做完改成 draft，作者验收后改成 ready）才按规范检查。 */
export const CHECKED_STATUS = new Set(['draft', 'ready'])
/** evidence 的合法取值（06 第 2 节，和 EvidenceCard 的 kind 一致）。 */
export const EVIDENCE_KINDS = ['simulated', 'measured', 'mixed']
/** 骨架里能自动检查的组件，按 06 第 3 节的顺序：任务卡 → 先猜 → 原理 → 检查点 → 证据。 */
export const SKELETON = ['Mission', 'Predict', 'ConceptCard', 'Checkpoint', 'EvidenceCard']
/** 副本骨架里能自动检查的组件，按 X-01 第 3 条的顺序：题目 → 题解 → 证据。模拟器副本的挑战（Sandbox，提示阶梯在它里面）可能写在本页 import 的 scenes/*.vue 里，查不到。 */
export const DUNGEON_SKELETON = ['Mission', 'Solution', 'EvidenceCard']
/** 真卡关卡和真卡副本的「挑战」是实验室入口：关卡里排在原理之后、检查点之前（06 第 3 节第 6 项），副本里排在题解之前（X-01 第 3 条）。 */
export const LAB_COMPONENT = 'LabCard'
/** 单段代码的行数上限（05 第 1 节、06 第 4 节）。铸造城的 30 行允许「更长的折叠」，判断不了，不在这里查。 */
export const MAX_CODE_LINES = { novice: 10 }
/** Vue 和 VitePress 的内置标签：它们不是内容组件，不用登记。 */
const BUILTIN_TAGS = new Set([
  'Component', 'KeepAlive', 'Suspense', 'Teleport', 'Transition', 'TransitionGroup',
  'Badge', 'ClientOnly', 'Content',
])

export function loadStageData() {
  const read = (p) => readFileSync(resolve(root, p), 'utf8')
  return {
    outline: JSON.parse(read('docs/course/outline.json')),
    glossary: JSON.parse(read('docs/course/glossary.json')),
    components: JSON.parse(read('docs/course/components.json')),
    bannedWords: JSON.parse(read('docs/course/banned-words.json')),
    componentRules: JSON.parse(read('scripts/course/rules.json')).components,
    kitSource: read('docs/components/kit/index.ts'),
    pages: listStagePages(),
    dungeonPages: listDungeonPages(),
    external: JSON.parse(read('docs/course/external-problems.json')),
    externalPages: listExternalPages(),
  }
}

/** 磁盘上所有 docs/{novice,forge,trial}/<slug>/index.md。 */
export function listStagePages() {
  return ZONE_DIRS.flatMap((zone) => listIndexPages(zone))
}

/** 磁盘上所有 docs/dungeon/<目录>/index.md：只看子目录，大厅 docs/dungeon/index.md 不算。 */
export function listDungeonPages() {
  return listIndexPages(DUNGEON_DIR)
}

/** 外部题的索引页和磁盘上所有题解页 docs/dungeon/external/<目录>/index.md。 */
export function listExternalPages() {
  const index = `docs/${EXTERNAL_DIR}/index.md`
  const own = existsSync(resolve(root, index)) ? [{ file: index, text: readFileSync(resolve(root, index), 'utf8') }] : []
  return [...own, ...listIndexPages(EXTERNAL_DIR)]
}

/** docs/<dir>/ 下每个子目录里的 index.md（没有 index.md 的子目录跳过）。 */
function listIndexPages(dir) {
  const base = resolve(root, 'docs', dir)
  if (!existsSync(base)) return []
  const pages = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = `docs/${dir}/${entry.name}/index.md`
    if (!existsSync(resolve(root, file))) continue
    pages.push({ file, text: readFileSync(resolve(root, file), 'utf8') })
  }
  return pages
}

/** docs/novice/thread-groups/index.md → { zone: 'novice', slug: 'thread-groups' }。 */
export function pagePath(file) {
  const m = /docs\/(novice|forge|trial)\/([^/]+)\/index\.md$/.exec(file.replace(/\\/g, '/'))
  return m ? { zone: m[1], slug: m[2] } : { zone: '', slug: '' }
}

/** docs/dungeon/vector-scale/index.md → { slug: 'vector-scale' }；不是副本页的路径 slug 是空串。 */
export function dungeonPagePath(file) {
  const m = /docs\/dungeon\/([^/]+)\/index\.md$/.exec(file.replace(/\\/g, '/'))
  return { slug: m ? m[1] : '' }
}

/** docs/dungeon/external/leetgpu-softmax/index.md → { id: 'leetgpu-softmax' }；索引页和别的路径 id 是空串。 */
export function externalPagePath(file) {
  const m = /docs\/dungeon\/external\/([^/]+)\/index\.md$/.exec(file.replace(/\\/g, '/'))
  return { id: m ? m[1] : '' }
}

/** 这一关要出现哪些骨架组件：真卡关卡的挑战是实验室入口。 */
export function skeletonFor(stage) {
  if (!stage?.gpu) return SKELETON
  const at = SKELETON.indexOf('Checkpoint')
  return [...SKELETON.slice(0, at), LAB_COMPONENT, ...SKELETON.slice(at)]
}

/** 这道副本要出现哪些骨架组件：真卡副本的挑战是实验室入口，排在题解前面。 */
export function dungeonSkeletonFor(exercise) {
  if (exercise?.env !== 'gpu') return DUNGEON_SKELETON
  const at = DUNGEON_SKELETON.indexOf('Solution')
  return [...DUNGEON_SKELETON.slice(0, at), LAB_COMPONENT, ...DUNGEON_SKELETON.slice(at)]
}

/** outline.json 的副本按区域分组、题目上不写区域：摊平成一列，把分组的 zone 补到每道题上（同 outline.ts 的 EXERCISE_LIST）。 */
function exerciseList(outline) {
  const groups = Array.isArray(outline?.exercises) ? outline.exercises : []
  return groups.flatMap((g) => (Array.isArray(g?.items) ? g.items : []).map((e) => ({ ...e, zone: g.zone })))
}

// ── Markdown 扫描 ──────────────────────────────────────────────────────────

function stripComments(line, state) {
  let out = ''
  let rest = line
  while (rest) {
    if (state.inComment) {
      const end = rest.indexOf('-->')
      if (end < 0) return out
      state.inComment = false
      rest = rest.slice(end + 3)
    } else {
      const start = rest.indexOf('<!--')
      if (start < 0) return out + rest
      out += rest.slice(0, start)
      state.inComment = true
      rest = rest.slice(start + 4)
    }
  }
  return out
}

/** 行内代码里的 `<Foo>` 和禁用词不算数。 */
function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, ' ')
}

function collectImport(line, imports) {
  const m = /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+\.vue['"]/.exec(line)
  if (m) imports.add(m[1])
}

/**
 * 把一份关卡页或副本页的 Markdown 拆成检查要用的东西：
 * frontmatter 的值和行号、正文（去掉围栏代码块、script / style、注释和行内代码）、
 * 围栏代码块、按出现顺序排好的组件标签、页面自己 import 的 .vue 组件、标题。
 */
export function scanMarkdown(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const fmLines = new Map()
  let hasFrontmatter = false
  let bodyStart = 0
  if (lines[0] === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') { hasFrontmatter = true; bodyStart = i + 1; break }
    }
  }
  if (hasFrontmatter) {
    for (let i = 1; i < bodyStart - 1; i++) {
      const m = /^([A-Za-z_][\w-]*)\s*:/.exec(lines[i])
      if (m && !fmLines.has(m[1])) fmLines.set(m[1], i + 1)
    }
  }
  const { data } = parseFrontmatter(text)

  const prose = []
  const codeBlocks = []
  const tags = []
  const headings = []
  const imports = new Set()
  const state = { inComment: false }
  let fence = null
  let html = ''

  for (let i = bodyStart; i < lines.length; i++) {
    const no = i + 1
    const raw = lines[i]
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(raw)
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) {
        fence.end = no
        codeBlocks.push(fence)
        fence = null
      } else {
        fence.lines.push(raw)
      }
      continue
    }
    if (html) {
      if (html === 'script') collectImport(raw, imports)
      if (raw.includes(`</${html}`)) html = ''
      continue
    }
    const open = /^\s*(`{3,}|~{3,})(.*)$/.exec(raw)
    if (open) {
      fence = { char: open[1][0], len: open[1].length, start: no, end: 0, lang: open[2].trim().split(/\s+/)[0] ?? '', lines: [] }
      continue
    }
    const htmlOpen = /^\s*<(script|style)\b/.exec(raw)
    if (htmlOpen) {
      html = htmlOpen[1]
      if (html === 'script') collectImport(raw, imports)
      if (raw.includes(`</${html}`)) html = ''
      continue
    }
    const clean = stripInlineCode(stripComments(raw, state))
    prose.push({ no, text: clean })
    const h = /^(#{1,6})\s+(.*)$/.exec(clean.trim())
    if (h) headings.push({ no, level: h[1].length, text: h[2].trim() })
    for (const m of clean.matchAll(/<([A-Z][A-Za-z0-9]*)/g)) tags.push({ name: m[1], no })
  }
  // 没闭合的围栏：按到文件末尾算，长度检查照样生效。
  if (fence) { fence.end = lines.length; codeBlocks.push(fence) }

  return { hasFrontmatter, data, fmLines, bodyStart: bodyStart + 1, prose, codeBlocks, tags, headings, imports }
}

// ── 单个关卡页 ─────────────────────────────────────────────────────────────

/**
 * 检查一个关卡页，返回 { file, line, message } 列表。纯函数：outline、glossary、组件登记表和禁用词表都从参数来。
 * 关卡由文件路径（docs/<区域>/<slug>/）对应到 outline，frontmatter 里的 stage 要和它一致。
 */
export function checkStagePage({ file, text, outline, glossary = {}, components, bannedWords }) {
  const errors = []
  const add = (line, message) => errors.push({ file, line, message })
  const { zone, slug } = pagePath(file)
  const stages = outline?.stages ?? []
  const stage = stages.find((s) => s.zone === zone && s.slug === slug) ?? null
  const scan = scanMarkdown(text)
  const at = (key) => scan.fmLines.get(key) ?? 1

  // ── frontmatter（06 第 2 节）──
  if (!scan.hasFrontmatter) {
    add(1, '缺少 frontmatter：关卡页要写 layout、stage、newTerms、evidence 四项（06 第 2 节）')
  }
  if (scan.data.layout !== 'stage') {
    const got = scan.data.layout ? `现在是 ${scan.data.layout}` : '现在没写'
    add(at('layout'), `frontmatter 的 layout 要写 stage，${got}（06 第 2 节）`)
  }
  const declared = scan.data.stage
  if (!declared) {
    add(at('stage'), 'frontmatter 缺少 stage：写 docs/course/outline.json 里的关卡 id（06 第 2 节）')
  } else if (!stages.some((s) => s.id === declared)) {
    add(at('stage'), `stage: ${declared} 在 docs/course/outline.json 里找不到，检查拼写或者先在大纲里登记这一关`)
  } else if (stage && declared !== stage.id) {
    add(at('stage'), `stage: ${declared} 和目录对不上：docs/${zone}/${slug}/ 对应的是 ${stage.id}`)
  }

  const terms = scan.data.newTerms
  if (terms === undefined) {
    add(at('newTerms'), 'frontmatter 缺少 newTerms：本关的新术语，没有就写 []（06 第 2 节）')
  } else if (!Array.isArray(terms)) {
    add(at('newTerms'), `newTerms 要写成数组，例如 newTerms: [block, grid]，现在是 ${terms}`)
  } else {
    for (const term of terms) {
      if (!Object.hasOwn(glossary, term)) {
        add(at('newTerms'), `newTerms 里的 ${term} 不在 docs/course/glossary.json 里，先登记术语再用（05 第 3 节）`)
      }
    }
    if (zone === 'novice' && terms.length > MAX_NEW_TERMS_PER_STAGE) {
      add(at('newTerms'), `新手村每关新术语不超过 ${MAX_NEW_TERMS_PER_STAGE} 个，这一关有 ${terms.length} 个（05 第 1 节）`)
    }
  }

  checkEvidence(scan, add)

  // ── 骨架第 1 项：正文以「# <编号> <名称>」开头（06 第 3 节）──
  const h1 = scan.headings.find((h) => h.level === 1)
  if (stage) checkHeading(scan, h1, `${stage.code} ${stage.title}`, '06 第 3 节第 1 项', add)

  // ── 骨架：组件齐全且顺序正确（06 第 3 节）──
  checkSkeleton(scan, skeletonFor(stage), {
    line: h1?.no ?? 1,
    source: '06 第 3 节',
    why: { [LAB_COMPONENT]: '真卡关卡的挑战是实验室入口' },
  }, add)

  // ── 和副本页共用：只用登记过的组件、单段代码的长度、禁用词 ──
  checkRegisteredTags(scan, components, add)
  checkCodeLength(scan, zone, outline, add)
  checkBannedText(scan, bannedWords, add)

  return errors.sort((a, b) => a.line - b.line)
}

// ── 单个副本页（X-01）─────────────────────────────────────────────────────

/**
 * 检查一个副本页，返回 { file, line, message } 列表。纯函数：outline、组件登记表和禁用词表都从参数来。
 * 副本由目录名（docs/dungeon/<slug>/）对应到 outline.json 的 exercises，frontmatter 里的 dungeon 要和它一致；
 * 代码块长度按副本所在的区域算。副本页不要求 newTerms、Predict、ConceptCard、Checkpoint。
 */
export function checkDungeonPage({ file, text, outline, components, bannedWords }) {
  const errors = []
  const add = (line, message) => errors.push({ file, line, message })
  const { slug } = dungeonPagePath(file)
  const exercises = exerciseList(outline)
  const exercise = exercises.find((e) => e.slug === slug) ?? null
  const scan = scanMarkdown(text)
  const at = (key) => scan.fmLines.get(key) ?? 1

  // ── frontmatter（X-01 副本页；evidence 同关卡页）──
  if (!scan.hasFrontmatter) {
    add(1, '缺少 frontmatter：副本页要写 layout、dungeon、evidence 三项（X-01 副本页）')
  }
  if (scan.data.layout !== 'dungeon') {
    const got = scan.data.layout ? `现在是 ${scan.data.layout}` : '现在没写'
    add(at('layout'), `frontmatter 的 layout 要写 dungeon，${got}（X-01 副本页）`)
  }
  const declared = scan.data.dungeon
  if (!declared) {
    add(at('dungeon'), 'frontmatter 缺少 dungeon：写 docs/course/outline.json 的 exercises 里的副本 id（X-01 副本页）')
  } else if (!exercises.some((e) => e.id === declared)) {
    add(at('dungeon'), `dungeon: ${declared} 在 docs/course/outline.json 的 exercises 里找不到，检查拼写或者先在大纲里登记这道副本`)
  } else if (exercise && declared !== exercise.id) {
    add(at('dungeon'), `dungeon: ${declared} 和目录对不上：docs/dungeon/${slug}/ 对应的是 ${exercise.id}`)
  }
  checkEvidence(scan, add)

  // ── 题目：正文以「# <题名>」开头 ──
  const h1 = scan.headings.find((h) => h.level === 1)
  if (exercise) checkHeading(scan, h1, exercise.title, 'X-01 副本页', add)

  // ── 骨架：题目 → 挑战 → 提示阶梯 → 题解 → 证据，能查的是 Mission →（真卡副本的 LabCard →）Solution → EvidenceCard ──
  checkSkeleton(scan, dungeonSkeletonFor(exercise), {
    line: h1?.no ?? 1,
    source: 'X-01 副本页',
    why: { [LAB_COMPONENT]: '真卡副本的挑战是实验室入口', Solution: '题解放在 <Solution> 里，通关或看过答案才展开' },
  }, add)

  // ── 和关卡页共用：只用登记过的组件、单段代码的长度（按副本所在区域）、禁用词 ──
  checkRegisteredTags(scan, components, add)
  checkCodeLength(scan, exercise?.zone, outline, add)
  checkBannedText(scan, bannedWords, add)

  return errors.sort((a, b) => a.line - b.line)
}

// ── 外部题页（X-08）───────────────────────────────────────────────────────

/**
 * 检查外部题的索引页或一篇题解页，返回 { file, line, message } 列表。纯函数：外部题数据、组件登记表和禁用词表都从参数来。
 * 两种页面都只用登记过的组件、不写禁用词（和关卡页同一套）。题解页的目录名是 external-problems.json 里一道题的 id，
 * 这道题要标 solution: true（索引页的卡片才链接过来）；页面上放这道题的卡片 <ExternalProblem id="<id>" />：
 * 来源、许可证和原题链接都在卡片上，正文只写我们自己的思路和代码。
 */
export function checkExternalPage({ file, text, external, components, bannedWords }) {
  const errors = []
  const add = (line, message) => errors.push({ file, line, message })
  const { id } = externalPagePath(file)
  const scan = scanMarkdown(text)

  if (id) {
    const problem = (external?.problems ?? []).find((p) => p?.id === id)
    if (!problem) {
      add(1, `目录名 ${id} 不是 docs/course/external-problems.json 里的外部题 id：题解页的目录要和题的 id 一致（X-08）`)
    } else if (problem.solution !== true) {
      add(1, `${id} 在 docs/course/external-problems.json 里没写 solution: true：有题解页就标上，索引页的卡片才会链接过来（X-08）`)
    }
    const cards = scan.prose.flatMap((line) => [...line.text.matchAll(/<ExternalProblem\b[^>]*?\bid="([^"]*)"/g)].map((m) => m[1]))
    if (!cards.includes(id)) {
      const h1 = scan.headings.find((h) => h.level === 1)
      add(h1?.no ?? scan.bodyStart, `题解页要放这道题的卡片 <ExternalProblem id="${id}" />：来源、许可证和原题链接写在卡片上，正文不复述题面（X-08）`)
    }
  }

  checkRegisteredTags(scan, components, add)
  checkBannedText(scan, bannedWords, add)
  return errors.sort((a, b) => a.line - b.line)
}

// ── 关卡页和副本页共用的规则 ───────────────────────────────────────────────

/** 正文的第一个一级标题要写成 want；一个一级标题都没有，就报在正文第一行。 */
function checkHeading(scan, h1, want, source, add) {
  if (!h1) add(scan.bodyStart, `正文要以「# ${want}」开头（${source}）`)
  else if (h1.text !== want) add(h1.no, `正文标题要写「# ${want}」，现在是「# ${h1.text}」（${source}）`)
}

/**
 * 骨架组件要齐全，并且第一次出现的先后和 want 一致。缺项报在 line（一级标题那一行）；
 * why 给个别组件写缺了时的理由，其余写「骨架不能缺项」。
 */
function checkSkeleton(scan, want, { line, source, why = {} }, add) {
  const firstAt = new Map()
  scan.tags.forEach((tag, idx) => { if (!firstAt.has(tag.name)) firstAt.set(tag.name, { idx, no: tag.no }) })
  for (const name of want) {
    if (firstAt.has(name)) continue
    add(line, `骨架缺少 <${name}>：${why[name] ?? '骨架不能缺项'}（${source}，顺序 ${want.join(' → ')}）`)
  }
  const present = want.filter((name) => firstAt.has(name))
  for (let i = 1; i < present.length; i++) {
    const prev = firstAt.get(present[i - 1])
    const cur = firstAt.get(present[i])
    if (cur.idx < prev.idx) {
      add(cur.no, `<${present[i]}> 出现在 <${present[i - 1]}> 前面，骨架顺序应该是 ${want.join(' → ')}（${source}）`)
    }
  }
}

/** evidence 要写，而且只能是 EVIDENCE_KINDS 之一（06 第 2 节）。 */
function checkEvidence(scan, add) {
  const line = scan.fmLines.get('evidence') ?? 1
  const evidence = scan.data.evidence
  if (!evidence) {
    add(line, `frontmatter 缺少 evidence：本关的数字是模拟还是实测，取值 ${EVIDENCE_KINDS.join(' | ')}（06 第 2 节）`)
  } else if (!EVIDENCE_KINDS.includes(evidence)) {
    add(line, `evidence: ${evidence} 不合法，只能是 ${EVIDENCE_KINDS.join(' | ')}（06 第 2 节）`)
  }
}

/** 只用登记过的组件、Vue / VitePress 的内置标签和本页 import 的 .vue（03 第 3 节）；同一个组件只报第一次。 */
function checkRegisteredTags(scan, components, add) {
  const allowed = new Set([...(components?.components ?? []).map((c) => c.name), ...BUILTIN_TAGS, ...scan.imports])
  const reported = new Set()
  for (const tag of scan.tags) {
    if (allowed.has(tag.name) || reported.has(tag.name)) continue
    reported.add(tag.name)
    add(tag.no, `<${tag.name}> 不在组件登记表里：关卡只能用 docs/course/components.json 里登记过的组件，或者本页 import 的 scenes/*.vue（03 第 3 节）`)
  }
}

/** 单段代码的长度按区域限（05 第 1 节、06 第 4 节）：MAX_CODE_LINES 里没有的区域不查。 */
function checkCodeLength(scan, zone, outline, add) {
  const limit = MAX_CODE_LINES[zone]
  if (!limit) return
  const zoneName = outline?.zones?.find((z) => z.id === zone)?.name ?? zone
  for (const block of scan.codeBlocks) {
    if (block.lines.length > limit) {
      add(block.start, `${zoneName}单个代码块不超过 ${limit} 行，这一块有 ${block.lines.length} 行：拆短，或者把它移到后面的区域（05 第 1 节）`)
    }
  }
}

/** 禁用词（05 第 5 节）：逐行查正文，代码块、行内代码和 HTML 注释在扫描时已经去掉了。 */
function checkBannedText(scan, bannedWords, add) {
  for (const word of compileBannedWords(bannedWords)) {
    for (const line of scan.prose) {
      if (!line.text.trim()) continue
      const hit = findBanned(line.text, word)
      if (hit !== null) add(line.no, `不要写「${hit}」：${word.fix}（05 第 5 节）`)
    }
  }
}

// ── 两份数据文件自身 ───────────────────────────────────────────────────────

/** 组件登记表要和 课程组件规则、以及 kit 里全局注册的组件对得上。 */
export function checkComponents(components, { specRows = [], kitSource = '' } = {}) {
  const errors = []
  const list = components?.components ?? []
  if (!list.length) errors.push('components.json 是空的')
  const seen = new Set()
  for (const c of list) {
    const where = c?.name ?? JSON.stringify(c)
    if (!c?.name || !/^[A-Z][A-Za-z0-9]*$/.test(c.name)) errors.push(`components.json 里的「${where}」name 要写成大写开头的组件名`)
    else if (seen.has(c.name)) errors.push(`components.json 里的 ${c.name} 重复登记了`)
    else seen.add(c.name)
    if (!c?.use) errors.push(`components.json 里的 ${where} 缺少 use（用途）`)
    if (c?.pendingSpec && !c?.note) errors.push(`components.json 里的 ${where} 标了 pendingSpec，要在 note 里写清它服务哪个结论、等谁确认`)
  }
  const inSpec = new Set(specRows.flatMap((r) => r.names))
  for (const name of inSpec) {
    if (!seen.has(name)) errors.push(`课程组件规则登记了 ${name}，docs/course/components.json 里没有`)
  }
  for (const c of list) {
    if (!c?.name || inSpec.has(c.name) || c.pendingSpec) continue
    errors.push(`components.json 里的 ${c.name} 不在 课程组件规则里：先请作者确认，确认前标上 pendingSpec 和 note`)
  }
  for (const m of kitSource.matchAll(/app\.component\('([^']+)'/g)) {
    if (!seen.has(m[1])) errors.push(`docs/components/kit/index.ts 全局注册了 ${m[1]}，但 components.json 里没登记`)
  }
  return errors
}

/** 禁用词表自身：词不重复、正则能编译、每条都写了改法。 */
export function checkBannedWords(bannedWords) {
  const errors = []
  const list = bannedWords?.words ?? []
  if (!list.length) errors.push('banned-words.json 是空的')
  const seen = new Set()
  for (const w of list) {
    const where = w?.word ?? JSON.stringify(w)
    if (!w?.word) errors.push(`banned-words.json 里有一条缺少 word：${where}`)
    else if (seen.has(w.word)) errors.push(`banned-words.json 里的「${w.word}」重复了`)
    else seen.add(w.word)
    if (!w?.fix) errors.push(`banned-words.json 里的「${where}」缺少 fix（改成什么）`)
    if (w?.pattern) {
      try {
        new RegExp(w.pattern)
      } catch (e) {
        errors.push(`banned-words.json 里「${where}」的 pattern 不是合法正则：${e.message}`)
      }
    }
  }
  return errors
}

// ── 全仓库 ────────────────────────────────────────────────────────────────

/**
 * 全仓库：两份登记表自身、上线的关卡页和副本页、外部题的索引页和题解页。返回 { errors, checked, dungeons, externals }：
 * checked 是查过的关卡页数，dungeons 是查过的副本页数，externals 是查过的外部题页数（索引页加题解页）。
 */
export function checkStages(data = loadStageData()) {
  const {
    outline, glossary, components, bannedWords, componentRules = [], kitSource = '', pages = [], dungeonPages = [], external = null, externalPages = [],
  } = data
  const errors = []
  const push = (file, line, message) => errors.push({ file, line, message })

  for (const message of checkComponents(components, { specRows: componentRules, kitSource })) {
    push('docs/course/components.json', 0, message)
  }
  for (const message of checkBannedWords(bannedWords)) {
    push('docs/course/banned-words.json', 0, message)
  }

  const byPath = new Map((outline?.stages ?? []).map((s) => [`${s.zone}/${s.slug}`, s]))
  const checked = new Set()
  for (const page of pages) {
    const { zone, slug } = pagePath(page.file)
    const stage = byPath.get(`${zone}/${slug}`)
    if (!stage) {
      const zoneName = outline?.zones?.find((z) => z.id === zone)?.name ?? zone
      push(page.file, 1, `目录名 ${slug} 在 outline.json 的${zoneName}里找不到对应的关卡：目录要和大纲的 slug 一致`)
      continue
    }
    // planned 的占位页（以及 pilot 状态的试点页）先不按规范查（06 第 8 节：关卡做完才改成 draft）。
    if (!CHECKED_STATUS.has(stage.status)) continue
    checked.add(stage.id)
    errors.push(...checkStagePage({ file: page.file, text: page.text, outline, glossary, components, bannedWords }))
  }
  for (const stage of outline?.stages ?? []) {
    if (!CHECKED_STATUS.has(stage.status) || checked.has(stage.id)) continue
    push(`docs/${stage.zone}/${stage.slug}/index.md`, 0, `大纲里 ${stage.id} 的 status 是 ${stage.status}，但这个页面不存在`)
  }

  // ── 副本页（X-01）：目录名对应到 exercises 的 slug ──
  const exercises = exerciseList(outline)
  const bySlug = new Map(exercises.map((e) => [e.slug, e]))
  const dungeons = new Set()
  for (const page of dungeonPages) {
    const { slug } = dungeonPagePath(page.file)
    const exercise = bySlug.get(slug)
    if (!exercise) {
      // 目录不是副本、也没写 layout: dungeon 的页面不是副本页（例如外部题索引页 docs/dungeon/external/，下面单独查），不归这里查。
      if (parseFrontmatter(page.text).data.layout !== 'dungeon') continue
      push(page.file, 1, `目录名 ${slug} 在 outline.json 的 exercises 里找不到对应的副本：副本页的目录要和副本的 slug 一致，不是副本的页面不要用 layout: dungeon`)
      continue
    }
    // planned 的副本只有占位页，先不按规范查（同关卡）。
    if (!CHECKED_STATUS.has(exercise.status)) continue
    dungeons.add(exercise.id)
    errors.push(...checkDungeonPage({ file: page.file, text: page.text, outline, components, bannedWords }))
  }
  for (const exercise of exercises) {
    if (!CHECKED_STATUS.has(exercise.status) || dungeons.has(exercise.id)) continue
    push(`docs/${DUNGEON_DIR}/${exercise.slug}/index.md`, 0, `大纲里 ${exercise.id} 的 status 是 ${exercise.status}，但这个页面不存在`)
  }

  // ── 外部题页（X-08）：索引页和题解页；标了 solution: true 的题要有题解页 ──
  const solutionPages = new Set()
  for (const page of externalPages) {
    const { id } = externalPagePath(page.file)
    if (id) solutionPages.add(id)
    errors.push(...checkExternalPage({ file: page.file, text: page.text, external, components, bannedWords }))
  }
  for (const problem of external?.problems ?? []) {
    if (problem?.solution !== true || solutionPages.has(problem.id)) continue
    push(`docs/${EXTERNAL_DIR}/${problem.id}/index.md`, 0, `docs/course/external-problems.json 里 ${problem.id} 写了 solution: true，但题解页不存在`)
  }

  return { errors, checked: checked.size, dungeons: dungeons.size, externals: externalPages.length }
}

export function formatError(e) {
  return e.line ? `${e.file}:${e.line} ${e.message}` : `${e.file} ${e.message}`
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const data = loadStageData()
  const { errors, checked, dungeons, externals } = checkStages(data)
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${formatError(e)}`)
    console.error(`关卡检查未通过：${errors.length} 个问题`)
    process.exit(1)
  }
  const total = data.outline.stages.filter((s) => CHECKED_STATUS.has(s.status)).length
  const dungeonTotal = exerciseList(data.outline).filter((e) => CHECKED_STATUS.has(e.status)).length
  console.log(`关卡检查通过：${checked} / ${total} 个上线关卡页，${dungeons} / ${dungeonTotal} 个上线副本页，${externals} 个外部题页（登记组件 ${data.components.components.length} 个，禁用词 ${data.bannedWords.words.length} 条）`)
}
