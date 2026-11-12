#!/usr/bin/env node
// 用法：node scripts/course/nb-build.mjs（npm run nb:build）；一致性检查见 nb-check.mjs（npm run nb:check）。
//
// 源文件 notebooks/src/<区域>/<slug>.md 是普通 Markdown。下面几种写法生成特殊单元，其余的生成 Markdown 单元：
//   ```python                 Python 代码单元，进所有版本；```python route=hip 只进 HIP 版，route=triton 只进 Triton 版
//   ```hip route=hip          %%hip 单元。第一行自动写成 %%hip <名字> --entry <名字>，名字取第一个 __global__ void 函数；
//                             要别的参数就接着写在围栏信息里，例如 ```hip route=hip add --entry kernel
//   <!-- lab:header -->       标题：关卡、路线、配套网页、时长、硬件（接在前面的 Markdown 单元后面），再加一个
//                             加载 hello_gpu 的代码单元（%run ../../common/bootstrap.py；有 %%hip 单元的版本再 %load_ext hello_gpu）
//   <!-- lab:submit -->       交成绩：说明文字和 hg.submit(关卡 id, 路线, checks=checks, metrics=metrics)
// Markdown 单元在二级标题、代码围栏和这两个标记处切开；别的语言的围栏（```text 等）和 HTML 注释原样留在 Markdown 里，
// 里面的内容不算标题、标记或代码单元。代码单元的首尾空行会去掉。
//
// 分路线（routes: split）的关卡生成 notebooks/<区域>/<slug>/<slug>-hip.ipynb 和 <slug>-triton.ipynb，共用（shared）的
// 生成 <slug>.ipynb。真卡副本的源放 notebooks/src/dungeon/<slug>.md，生成到 notebooks/dungeon/<slug>/，路线跟副本所在的区域。
// 下划线开头的源（_example.md）是格式示例，不对应关卡，不生成文件（nb-check 在内存里按分路线生成，只查格式）。
// 生成的 Notebook 不带输出；同一份源每次生成的结果逐字节相同：单元 id 按顺序编号，JSON 的键按字母排序、缩进 1 格，
// 和 Jupyter 自己保存的格式一样。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** 源文件的目录（07 第 3 节）。 */
export const SOURCE_DIR = 'notebooks/src'
/** 真卡副本的源和生成目录名：notebooks/src/dungeon/、notebooks/dungeon/（X-04 等副本任务）。 */
export const DUNGEON_DIR = 'dungeon'
/** 配套网页所在的站点，和 hello_gpu/lab.py 的 DEFAULT_SITE 一致。 */
export const SITE = 'https://datawhalechina.github.io/hello-gpu'
/** 路线的显示名，和 hello_gpu/lab.py 的 _ROUTE_NAMES 一致。 */
export const ROUTE_NAMES = { hip: 'HIP 路线', triton: 'Triton 路线', shared: '两条路线共用' }
/** 分路线的关卡生成这两个版本。 */
export const SPLIT_ROUTES = ['hip', 'triton']
/** 标题后面的代码单元：生成的 Notebook 在 notebooks/<区域>/<slug>/，往上两级是 notebooks/。 */
export const BOOTSTRAP = '%run ../../common/bootstrap.py'
/** 有 %%hip 单元的版本还要注册 %%hip 魔法。 */
export const LOAD_HIP = '%load_ext hello_gpu'
/** 生成代码单元的围栏语言；别的语言的围栏留在 Markdown 里。 */
export const CELL_LANGS = ['python', 'hip']
/** 源文件里的两个标记：<!-- lab:header -->、<!-- lab:submit -->。 */
export const DIRECTIVES = ['header', 'submit']

const KERNELSPEC = { display_name: 'Python 3', language: 'python', name: 'python3' }
/** 代码单元的围栏要顶格写；缩进的围栏（列表里的）留在 Markdown 里。 */
const CELL_FENCE = /^(`{3,}|~{3,})(.*)$/
const DIRECTIVE = /^\s*<!--\s*lab:\s*([^\s>]*)\s*-->\s*$/
/** HIP 单元里第一个 kernel 的名字；跳过 __launch_bounds__(…)。 */
const KERNEL_NAME = /__global__[\s\S]*?\bvoid\s+(?:__launch_bounds__\s*\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/

// ── Markdown 的小工具 ──────────────────────────────────────────────────────

/** 围栏的开头（``` 或 ~~~，最多缩进 3 格）：返回 { char, len }，不是围栏返回 null。 */
export function fenceOpen(line) {
  const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
  return m ? { char: m[1][0], len: m[1].length } : null
}

/** 这一行能不能闭合 fence：同一种字符、不比开头短、后面只有空白。 */
export function fenceCloses(line, fence) {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
  return Boolean(m) && m[1][0] === fence.char && m[1].length >= fence.len
}

/** ATX 标题（# 到 ######）：返回 { level, text }，不是标题返回 null。 */
export function atxHeading(line) {
  const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line)
  return m ? { level: m[1].length, text: (m[2] ?? '').trim() } : null
}

/** 读完这一行之后是不是还在 HTML 注释里。 */
function inCommentAfter(line, inComment) {
  let rest = line
  for (;;) {
    const at = rest.indexOf(inComment ? '-->' : '<!--')
    if (at < 0) return inComment
    rest = rest.slice(at + (inComment ? 3 : 4))
    inComment = !inComment
  }
}

/** 去掉首尾的空行，返回 [第一行的下标, 剩下的行]。 */
function trimBlank(lines) {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start++
  while (end > start && !lines[end - 1].trim()) end--
  return [start, lines.slice(start, end)]
}

function escapeMd(text) {
  return String(text).replace(/[\\[\]|]/g, '\\$&')
}

const byLine = (a, b) => a.line - b.line

// ── 解析源文件 ─────────────────────────────────────────────────────────────

/**
 * 把源文件拆成块，返回 { blocks, errors }。块有四种，都带源文件里的行号 line：
 *   markdown：lines（去掉了首尾空行），heading 是开头的二级标题文字（不是二级标题开头的是 null）；
 *   code：lang（python / hip）、route（null / hip / triton）、magic（hip 单元的 %%hip 那一行）、
 *         lines（去掉了首尾空行），start 是第一行代码的行号；
 *   header、submit：两个标记。
 * errors 是 { line, message }，按行号排好。
 */
export function parseSource(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  const errors = []
  const error = (line, message) => errors.push({ line, message })
  let markdown = null
  let fence = null
  let inComment = false
  const append = (no, line, heading = null) => {
    markdown ??= { kind: 'markdown', line: no, heading, lines: [] }
    markdown.lines.push(line)
  }
  const flush = () => {
    if (markdown) {
      const [skipped, kept] = trimBlank(markdown.lines)
      if (kept.length) blocks.push({ ...markdown, line: markdown.line + skipped, lines: kept })
    }
    markdown = null
  }

  for (let i = 0; i < lines.length; i++) {
    const no = i + 1
    const line = lines[i]
    if (fence) {
      append(no, line)
      if (fenceCloses(line, fence)) fence = null
      continue
    }
    if (inComment) {
      append(no, line)
      inComment = inCommentAfter(line, true)
      continue
    }
    const cell = CELL_FENCE.exec(line)
    const tokens = cell ? cell[2].trim().split(/\s+/).filter(Boolean) : []
    if (cell && CELL_LANGS.includes(tokens[0])) {
      flush()
      const own = { char: cell[1][0], len: cell[1].length }
      let close = i + 1
      while (close < lines.length && !fenceCloses(lines[close], own)) close++
      if (close >= lines.length) {
        error(no, `代码围栏没有闭合：到文件末尾也没有结尾的 ${cell[1]}`)
        break
      }
      blocks.push(codeBlock(no, tokens, lines.slice(i + 1, close), error))
      i = close
      continue
    }
    const open = fenceOpen(line)
    if (open) {
      fence = { ...open, line: no }
      append(no, line)
      continue
    }
    const directive = DIRECTIVE.exec(line)
    if (directive) {
      flush()
      if (DIRECTIVES.includes(directive[1])) blocks.push({ kind: directive[1], line: no })
      else error(no, `不认识的标记 lab:${directive[1]}：只有 <!-- lab:header --> 和 <!-- lab:submit -->`)
      continue
    }
    const heading = atxHeading(line)
    if (heading?.level === 2) flush()
    append(no, line, heading?.level === 2 ? heading.text : null)
    inComment = inCommentAfter(line, false)
  }
  if (fence) error(fence.line, `围栏没有闭合：到文件末尾也没有结尾的 ${fence.char.repeat(fence.len)}`)
  flush()
  return { blocks, errors: errors.sort(byLine) }
}

function codeBlock(no, [lang, ...rest], body, error) {
  const block = { kind: 'code', lang, route: null, magic: null, line: no, start: no + 1, lines: [] }
  const args = []
  for (const token of rest) {
    const attr = /^([A-Za-z][\w-]*)=(.*)$/.exec(token)
    if (!attr) {
      if (lang === 'hip') args.push(token)
      else error(no, `python 围栏只能写 route=hip 或 route=triton，不认识「${token}」`)
    } else if (attr[1] !== 'route') {
      error(no, `围栏里不认识的设置「${token}」：只有 route=hip 和 route=triton`)
    } else if (!SPLIT_ROUTES.includes(attr[2])) {
      error(no, `route 只能是 hip 或 triton，现在是「${attr[2]}」`)
    } else if (block.route) {
      error(no, 'route 只能写一次')
    } else {
      block.route = attr[2]
    }
  }
  const [skipped, kept] = trimBlank(body)
  block.start = no + 1 + skipped
  block.lines = kept
  if (!kept.length) error(no, '空的代码单元：删掉这个围栏，或者写上代码')
  if (lang === 'hip') {
    if (block.route === 'triton') error(no, 'HIP 单元不能只进 Triton 版：写 route=hip，两个版本都要就不写 route')
    const name = KERNEL_NAME.exec(kept.join('\n'))?.[1]
    if (args.length) block.magic = `%%hip ${args.join(' ')}`
    else if (name) block.magic = `%%hip ${name} --entry ${name}`
    else if (kept.length) error(no, '这个 HIP 单元里找不到 __global__ void 函数，生成不了 %%hip 那一行：把参数写在围栏信息里，例如 ```hip route=hip add --entry kernel')
  }
  return block
}

// ── 源文件对应的关卡 ───────────────────────────────────────────────────────

/**
 * 源文件 notebooks/src/<dir>/<slug>.md 对应的真卡关卡或副本，返回 { target } 或 { error }。target 的字段：
 * id；kind（stage / dungeon）；label（关卡 / 副本）；name（标题里显示的名字）；dir、slug；page（站内地址）；
 * routes（split / shared）；minutes（副本没有，是 null）；env（所在区域的运行环境）；status。
 */
export function resolveTarget(outline, dir, slug) {
  const zones = outline?.zones ?? []
  if (dir === DUNGEON_DIR) {
    for (const group of outline?.exercises ?? []) {
      const item = (group.items ?? []).find((e) => e.slug === slug)
      if (!item) continue
      if (item.env !== 'gpu') return { error: `副本 ${item.id} 在浏览器里做（env: ${item.env}），没有实验室 Notebook` }
      const zone = zones.find((z) => z.id === group.zone)
      return {
        target: {
          id: item.id, kind: 'dungeon', label: '副本', name: item.title, dir, slug, page: `/${DUNGEON_DIR}/${slug}/`,
          routes: zone?.routes === 'split' ? 'split' : 'shared', minutes: null, env: zone?.env ?? '', status: item.status,
        },
      }
    }
    return { error: `outline.json 的 exercises 里没有 slug 为 ${slug} 的副本：源文件名要和副本的 slug 一致` }
  }
  const zone = zones.find((z) => z.id === dir)
  if (!zone) return { error: `${SOURCE_DIR}/ 下只放区域目录（${zones.map((z) => z.id).join('、')}）和 ${DUNGEON_DIR}/，没有 ${dir} 这个区域` }
  const stage = (outline?.stages ?? []).find((s) => s.zone === dir && s.slug === slug)
  if (!stage) return { error: `outline.json 的${zone.name}里没有 slug 为 ${slug} 的关卡：源文件名要和关卡的 slug 一致` }
  if (!stage.gpu) return { error: `${stage.id} 不需要真卡（gpu: false），没有实验室 Notebook` }
  return {
    target: {
      id: stage.id, kind: 'stage', label: '关卡', name: `${stage.code} ${stage.title}`, dir, slug, page: `/${dir}/${slug}/`,
      routes: (stage.routes ?? zone.routes) === 'split' ? 'split' : 'shared', minutes: stage.minutes ?? null,
      env: zone.env ?? '', status: stage.status,
    },
  }
}

/** 下划线开头的源是格式示例：不对应关卡，按一个分路线的假关卡生成，两条路线都走一遍。 */
export function exampleTarget(dir, slug) {
  return {
    id: `${dir}-${slug}`, kind: 'stage', label: '关卡', name: '格式示例', dir, slug, page: `/${dir}/`,
    routes: 'split', minutes: null, env: '', status: null,
  }
}

export function isExample(slug) {
  return slug.startsWith('_')
}

/** 大纲里所有有实验室的关卡（gpu: true）和副本（env: gpu）。 */
export function labTargets(outline) {
  const stages = (outline?.stages ?? []).filter((s) => s.gpu)
    .map((s) => resolveTarget(outline, s.zone, s.slug).target)
  const exercises = (outline?.exercises ?? []).flatMap((g) => g.items ?? []).filter((e) => e.env === 'gpu')
    .map((e) => resolveTarget(outline, DUNGEON_DIR, e.slug).target)
  return [...stages, ...exercises].filter(Boolean)
}

/** 这一关生成哪几个版本：分路线的是 hip 和 triton，共用的只有 shared。 */
export function notebookRoutes(target) {
  return target.routes === 'split' ? SPLIT_ROUTES : ['shared']
}

export function notebookName(target, route) {
  return `${target.slug}${route === 'shared' ? '' : `-${route}`}.ipynb`
}

/** 生成的 Notebook 在仓库里的路径（07 第 3 节）。 */
export function notebookPath(target, route) {
  return `notebooks/${target.dir}/${target.slug}/${notebookName(target, route)}`
}

// ── 两个标记展开成的单元 ───────────────────────────────────────────────────

/** <!-- lab:header --> 展开成的 Markdown 行和代码行（07 第 4 节）；hip 表示这个版本有 %%hip 单元。 */
export function headerCells(target, route, hip) {
  const columns = [[target.label, `[${escapeMd(target.name)}](${SITE}${target.page})`], ['路线', ROUTE_NAMES[route]]]
  if (target.minutes) columns.push(['时长', `约 ${target.minutes} 分钟`])
  columns.push(['硬件', target.env ? `需要真卡：${escapeMd(target.env)}` : '需要真卡'])
  const about = target.kind === 'dungeon' ? '题目和题解' : '先猜、原理和可视化'
  const text = [
    `| ${columns.map(([key]) => key).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    `| ${columns.map(([, value]) => value).join(' | ')} |`,
    '',
    `${about}都在${target.label}页上，这里在真卡上写代码、校验、计时，最后交成绩。`,
  ]
  if (route !== 'shared') {
    const other = route === 'hip' ? 'triton' : 'hip'
    text.push(`另一条路线：[${ROUTE_NAMES[other]}](${notebookName(target, other)})。`)
  }
  text.push('', '下一个单元加载仓库里的 `hello_gpu` 教学包，不安装任何东西。')
  return [text, hip ? [BOOTSTRAP, LOAD_HIP] : [BOOTSTRAP]]
}

/** <!-- lab:submit --> 展开成的 Markdown 行和代码行（07 第 7、8 节）：checks、metrics 由「挑战」里的代码给出。 */
export function submitCells(target, route) {
  const page = `${SITE}${target.page}`
  const text = [
    '运行下面的单元生成通关凭证，它会打印通关链接和通关码。',
    '',
    `- 在浏览器里打开通关链接，成绩会导入[${target.label}页](${page})；也可以把通关码粘贴到${target.label}页的「导入成绩」里。`,
    `- 交上去的是挑战里的 \`checks\`（校验结果）和 \`metrics\`（测量数据），不含个人信息；星级由${target.label}页按规则计算。`,
  ]
  return [text, [`hg.submit(${JSON.stringify(target.id)}, ${JSON.stringify(route)}, checks=checks, metrics=metrics)`]]
}

// ── 生成 ───────────────────────────────────────────────────────────────────

/**
 * 按 target 的路线把一份源文件生成 Notebook。返回 { blocks, notebooks, errors }：
 * notebooks 是 [{ route, file, notebook, json }]，json 就是要写进 file 的内容；有错误时 notebooks 为空。
 */
export function buildNotebooks(text, target) {
  const { blocks, errors } = parseSource(text)
  const seen = {}
  for (const block of blocks) {
    if (DIRECTIVES.includes(block.kind)) {
      if (seen[block.kind]) errors.push({ line: block.line, message: `<!-- lab:${block.kind} --> 只能写一次，第 ${seen[block.kind]} 行已经有了` })
      else seen[block.kind] = block.line
    } else if (block.kind === 'code' && block.route && target.routes !== 'split') {
      errors.push({ line: block.line, message: `${target.id} 两条路线共用一份 Notebook（routes: ${target.routes}），代码单元不能写 route=${block.route}` })
    }
  }
  if (errors.length) return { blocks, notebooks: [], errors: errors.sort(byLine) }
  const notebooks = notebookRoutes(target).map((route) => {
    const notebook = toNotebook(cellsFor(blocks, target, route), target, route)
    return { route, file: notebookPath(target, route), notebook, json: serializeNotebook(notebook) }
  })
  return { blocks, notebooks, errors }
}

/** 一个版本的单元：[{ type: markdown / code, lines }]。代码围栏总是切开 Markdown，所以两个版本的 Markdown 单元一一对应。 */
function cellsFor(blocks, target, route) {
  const included = (block) => !block.route || block.route === route
  const hip = blocks.some((b) => b.kind === 'code' && b.lang === 'hip' && included(b))
  const cells = []
  let markdown = null
  const flush = () => {
    if (markdown) cells.push({ type: 'markdown', lines: markdown })
    markdown = null
  }
  for (const block of blocks) {
    if (block.kind === 'markdown') {
      flush()
      markdown = [...block.lines]
    } else if (block.kind === 'code') {
      flush()
      if (included(block)) cells.push({ type: 'code', lines: block.magic ? [block.magic, ...block.lines] : block.lines })
    } else {
      // 标记的说明文字接在前面的 Markdown 单元后面（例如「## 交成绩」和交成绩的说明在同一个单元里）。
      const [text, code] = block.kind === 'header' ? headerCells(target, route, hip) : submitCells(target, route)
      markdown = markdown ? [...markdown, '', ...text] : [...text]
      flush()
      cells.push({ type: 'code', lines: code })
    }
  }
  flush()
  return cells
}

/** nbformat 4.5：单元带 id；代码单元没有输出；metadata 写关卡 id 和路线（07 第 3 节）。键按字母顺序写。 */
function toNotebook(cells, target, route) {
  return {
    cells: cells.map(({ type, lines }, index) => {
      const id = `cell-${String(index).padStart(3, '0')}`
      const source = lines.map((line, i) => (i < lines.length - 1 ? `${line}\n` : line))
      return type === 'markdown'
        ? { cell_type: 'markdown', id, metadata: {}, source }
        : { cell_type: 'code', execution_count: null, id, metadata: {}, outputs: [], source }
    }),
    metadata: {
      hello_gpu: { route, stage: target.id },
      kernelspec: { ...KERNELSPEC },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  }
}

/** 和 Jupyter 保存时一样：缩进 1 格，非 ASCII 字符原样写，文件末尾换行（键的顺序由 toNotebook 保证）。 */
export function serializeNotebook(notebook) {
  return `${JSON.stringify(notebook, null, 1)}\n`
}

// ── 仓库 ──────────────────────────────────────────────────────────────────

/** 仓库里所有的源文件 notebooks/src/<dir>/<slug>.md：[{ file, dir, slug, text }]，按路径排序。 */
export function listSources(base = root) {
  const dir = resolve(base, SOURCE_DIR)
  if (!existsSync(dir)) return []
  const entries = (path) => readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return entries(dir)
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .flatMap((zone) => entries(resolve(dir, zone.name))
      .filter((f) => f.isFile() && f.name.endsWith('.md'))
      .map((f) => ({
        file: `${SOURCE_DIR}/${zone.name}/${f.name}`,
        dir: zone.name,
        slug: f.name.slice(0, -'.md'.length),
        text: readFileSync(resolve(dir, zone.name, f.name), 'utf8'),
      })))
}

/**
 * 生成一份源文件，返回 { example, target, blocks, notebooks, errors }；errors 带上源文件路径 file。
 * 格式示例按 exampleTarget 生成；找不到对应关卡时照样解析出 blocks，方便 nb-check 检查格式。
 */
export function buildSource(source, outline) {
  const example = isExample(source.slug)
  const { target, error } = example ? { target: exampleTarget(source.dir, source.slug) } : resolveTarget(outline, source.dir, source.slug)
  const withFile = (e) => ({ file: source.file, ...e })
  if (!target) {
    const { blocks, errors } = parseSource(source.text)
    return { example, target: null, blocks, notebooks: [], errors: [{ file: source.file, line: 0, message: error }, ...errors.map(withFile)] }
  }
  const { blocks, notebooks, errors } = buildNotebooks(source.text, target)
  return { example, target, blocks, notebooks, errors: errors.map(withFile) }
}

export function formatError(e) {
  return e.line ? `${e.file}:${e.line} ${e.message}` : `${e.file} ${e.message}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outline = JSON.parse(readFileSync(resolve(root, 'docs/course/outline.json'), 'utf8'))
  const errors = []
  let sources = 0
  let examples = 0
  let written = 0
  let unchanged = 0
  for (const source of listSources()) {
    const result = buildSource(source, outline)
    errors.push(...result.errors)
    if (result.example) {
      examples++
      continue
    }
    sources++
    for (const { file, json } of result.notebooks) {
      const path = resolve(root, file)
      if (existsSync(path) && readFileSync(path, 'utf8') === json) {
        unchanged++
        continue
      }
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, json)
      written++
    }
  }
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${formatError(e)}`)
    console.error(`Notebook 生成未完成：${errors.length} 个问题，有问题的源文件没有生成`)
    process.exit(1)
  }
  console.log(`Notebook 已生成：${sources} 份源文件，写入 ${written} 本，${unchanged} 本没有变化（格式示例 ${examples} 份不生成）`)
}
