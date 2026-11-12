#!/usr/bin/env node
// 用法：node scripts/course/nb-check.mjs（npm run nb:check；npm run course:check 会调用）
//
//   1. gpu: true 的关卡和 env: gpu 的副本上线（status 是 draft 或 ready）时要有源文件；每份源文件生成的 Notebook
//      都在仓库里，而且和现在重新生成的结果逐字节相同。
//   2. notebooks/<区域>/、notebooks/dungeon/ 下的 Notebook：metadata.hello_gpu 的关卡 id 存在于 outline.json，路线对得上；
//      没有哪一本是现有源文件生成不出来的（源文件改名、删除或者路线改了以后留下的旧文件）。
//   3. 必备小节：## 准备、## 动手、## 挑战、## 交成绩 都有，按这个顺序；<!-- lab:header --> 写在第一个二级标题前面，
//      <!-- lab:submit --> 写在「交成绩」里。
//   4. 代码单元不超过 15 行（%%hip 单元连 %%hip 那一行一起算）；Python 单元能通过 python3 -m py_compile（%run、%load_ext
//      这类魔法行和 ! 开头的 shell 行当成 pass）。没有 Python 时跳过语法检查并提示；用环境变量 PYTHON 指定解释器。
//   5. 分路线的关卡，HIP 版和 Triton 版的小节标题一致。
// 下划线开头的源（格式示例）不对应关卡：只查 3、4，不查 1、2、5。
// 检查函数都是纯函数（只有 Python 语法检查要起子进程），scripts/tests/notebook-build.test.mjs 直接喂小样例。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isPublished } from '../../docs/course/outline.ts'
import {
  DUNGEON_DIR, SOURCE_DIR, atxHeading, buildSource, fenceCloses, fenceOpen, formatError, labTargets, listSources,
  notebookPath, notebookRoutes,
} from './nb-build.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** 必备小节，按这个顺序（07 第 5 节）；「练习」不计星，可以没有。 */
export const REQUIRED_SECTIONS = ['准备', '动手', '挑战', '交成绩']
/** 单个代码单元的行数上限（07 第 6 节）。 */
export const MAX_CELL_LINES = 15

export function loadNotebookData() {
  const outline = JSON.parse(readFileSync(resolve(root, 'docs/course/outline.json'), 'utf8'))
  return { outline, sources: listSources(), notebooks: listNotebooks(outline) }
}

/** notebooks/<区域>/ 和 notebooks/dungeon/ 下所有的 .ipynb：[{ file, text }]。点开头的目录（.ipynb_checkpoints）不算。 */
export function listNotebooks(outline, base = root) {
  const found = []
  const walk = (dir) => {
    const path = resolve(base, dir)
    if (!existsSync(path)) return
    const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const child = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.name.endsWith('.ipynb')) found.push({ file: child, text: readFileSync(resolve(base, child), 'utf8') })
    }
  }
  for (const dir of new Set([...(outline?.zones ?? []).map((z) => z.id), DUNGEON_DIR])) walk(`notebooks/${dir}`)
  return found
}

// ── 源文件的格式（示例也查）────────────────────────────────────────────────

/** 必备小节齐全、顺序对，标题和交成绩的标记在该在的地方。返回 [{ line, message }]，line 为 0 表示整份文件的问题。 */
export function checkSections(blocks) {
  const problems = []
  const sections = blocks.filter((b) => b.kind === 'markdown' && b.heading !== null)
  let previous = null
  for (const name of REQUIRED_SECTIONS) {
    const section = sections.find((s) => s.heading === name)
    if (!section) {
      problems.push({ line: 0, message: `缺少「## ${name}」小节（07 第 5 节：${REQUIRED_SECTIONS.join('、')}缺一不可）` })
      continue
    }
    if (previous && section.line < previous.line) {
      problems.push({ line: section.line, message: `「## ${name}」要排在「## ${previous.heading}」后面（07 第 5 节的顺序：${REQUIRED_SECTIONS.join(' → ')}）` })
    }
    previous = section
  }
  const header = blocks.find((b) => b.kind === 'header')
  if (!header) {
    problems.push({ line: 0, message: '缺少 <!-- lab:header -->：标题（关卡、路线、配套网页、时长、硬件）和加载 hello_gpu 的单元由它生成' })
  } else if (sections.length && header.line > sections[0].line) {
    problems.push({ line: header.line, message: '<!-- lab:header --> 要写在第一个二级标题前面' })
  }
  const submit = blocks.find((b) => b.kind === 'submit')
  if (!submit) {
    problems.push({ line: 0, message: '缺少 <!-- lab:submit -->：「## 交成绩」里的 hg.submit 单元由它生成' })
  } else if (sections.filter((s) => s.line < submit.line).at(-1)?.heading !== '交成绩') {
    problems.push({ line: submit.line, message: '<!-- lab:submit --> 要写在「## 交成绩」小节里' })
  }
  return problems
}

/** 代码单元不超过 MAX_CELL_LINES 行：%%hip 单元在 Notebook 里多一行 %%hip，一起算。 */
export function checkCellLength(blocks) {
  return blocks.filter((b) => b.kind === 'code').flatMap((b) => {
    const count = b.lines.length + (b.magic ? 1 : 0)
    if (count <= MAX_CELL_LINES) return []
    const note = b.magic ? '（连 %%hip 那一行）' : ''
    return [{ line: b.line, message: `代码单元有 ${count} 行${note}，超过 ${MAX_CELL_LINES} 行：拆开，或者把样板代码挪进 hello_gpu（07 第 6 节）` }]
  })
}

/** 要做语法检查的 Python 单元：[{ line, text }]，line 是第一行代码在源文件里的行号。 */
export function pythonCells(blocks) {
  return blocks.filter((b) => b.kind === 'code' && b.lang === 'python' && b.lines.length)
    .map((b) => ({ line: b.start, text: b.lines.join('\n') }))
}

// ── 生成的 Notebook ────────────────────────────────────────────────────────

/** Notebook 里 Markdown 单元的标题（围栏里的不算），写成「## 准备」这样，用来比较两个版本。 */
export function notebookHeadings(notebook) {
  const headings = []
  for (const cell of notebook?.cells ?? []) {
    if (cell?.cell_type !== 'markdown') continue
    const text = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? '')
    let fence = null
    for (const line of text.split('\n')) {
      if (fence) {
        if (fenceCloses(line, fence)) fence = null
        continue
      }
      fence = fenceOpen(line)
      const heading = fence ? null : atxHeading(line)
      if (heading) headings.push(`${'#'.repeat(heading.level)} ${heading.text}`)
    }
  }
  return headings
}

function headingMismatch(hip, triton) {
  for (let i = 0; i < Math.max(hip.length, triton.length); i++) {
    if (hip[i] !== triton[i]) return `第 ${i + 1} 个标题不一致：HIP 版是「${hip[i] ?? '（没有）'}」，Triton 版是「${triton[i] ?? '（没有）'}」`
  }
  return ''
}

// ── 全仓库 ────────────────────────────────────────────────────────────────

/**
 * 除 Python 语法以外的全部检查。输入 { outline, sources: [{ file, dir, slug, text }], notebooks: [{ file, text }] }，
 * 返回 { errors: [{ file, line, message }], cells（交给 pythonSyntaxErrors 的 Python 单元）, sources, examples, notebooks }。
 */
export function checkNotebooks({ outline, sources = [], notebooks = [] }) {
  const errors = []
  const add = (file, line, message) => errors.push({ file, line, message })
  const cells = []
  const expected = new Set()
  const hasSource = new Set()
  const onDisk = new Map(notebooks.map((n) => [n.file, n.text]))
  let examples = 0

  for (const source of sources) {
    const result = buildSource(source, outline)
    errors.push(...result.errors)
    for (const p of [...checkSections(result.blocks), ...checkCellLength(result.blocks)]) add(source.file, p.line, p.message)
    cells.push(...pythonCells(result.blocks).map((cell) => ({ file: source.file, ...cell })))
    if (result.example) {
      examples++
      continue
    }
    if (!result.target) continue
    hasSource.add(result.target.id)
    for (const route of notebookRoutes(result.target)) expected.add(notebookPath(result.target, route))
    for (const { file, json } of result.notebooks) {
      if (!onDisk.has(file)) add(file, 0, `还没有生成：运行 npm run nb:build（源文件 ${source.file}）`)
      else if (onDisk.get(file) !== json) add(file, 0, `不是最新的：和 ${source.file} 现在生成的结果不一样。改源文件后运行 npm run nb:build，不要直接改 .ipynb`)
    }
  }

  const targets = labTargets(outline)
  for (const target of targets) {
    if (!isPublished(target) || hasSource.has(target.id)) continue
    add(`${SOURCE_DIR}/${target.dir}/${target.slug}.md`, 0,
      `大纲里 ${target.id} 的 status 是 ${target.status}，但实验室 Notebook 的源文件不存在（07 第 11 节：真卡${target.label}都要有 Notebook）`)
  }

  const byId = new Map(targets.map((t) => [t.id, t]))
  const versions = new Map()
  for (const { file, text } of notebooks) {
    if (!expected.has(file)) {
      add(file, 0, `没有源文件生成这本 Notebook：它应该由 ${SOURCE_DIR}/<区域>/<slug>.md 生成；源文件改名、删除或者路线改了以后，把旧文件删掉`)
    }
    let notebook
    try {
      notebook = JSON.parse(text)
    } catch (e) {
      add(file, 0, `不是合法的 JSON：${e.message}`)
      continue
    }
    const meta = notebook?.metadata?.hello_gpu ?? {}
    const target = byId.get(meta.stage)
    if (!target) {
      add(file, 0, `metadata.hello_gpu.stage 是 ${JSON.stringify(meta.stage)}，outline.json 里没有这个真卡关卡或副本`)
      continue
    }
    const routes = notebookRoutes(target)
    if (!routes.includes(meta.route)) {
      add(file, 0, `metadata.hello_gpu.route 是 ${JSON.stringify(meta.route)}，${target.id} 应该是 ${routes.join(' 或 ')}`)
      continue
    }
    if (meta.route === 'shared') continue
    const pair = versions.get(target.id) ?? {}
    pair[meta.route] ??= { file, headings: notebookHeadings(notebook) }
    versions.set(target.id, pair)
  }
  for (const { hip, triton } of versions.values()) {
    const mismatch = hip && triton ? headingMismatch(hip.headings, triton.headings) : ''
    if (mismatch) add(triton.file, 0, `${mismatch}（和 ${hip.file} 比；07 第 11 节：两个版本的小节标题要一致）`)
  }

  return { errors, cells, sources: sources.length - examples, examples, notebooks: notebooks.length }
}

// ── Python 语法 ────────────────────────────────────────────────────────────

const MAGIC_LINE = /^(\s*)(?:%{1,2}[A-Za-z_]|!(?!=))/

/** 把单元里的 IPython 行魔法和 ! 开头的 shell 行换成同样缩进的 pass（行号不变）；单元魔法（%% 开头）的单元不是 Python，返回 null。 */
export function plainPython(text) {
  const lines = text.split('\n')
  if (lines[0].trimStart().startsWith('%%')) return null
  return `${lines.map((line) => {
    const m = MAGIC_LINE.exec(line)
    return m ? `${m[1]}pass` : line
  }).join('\n')}\n`
}

/** py_compile 的报错：每段以 File "…", line N 开头，最后一行是 SyntaxError: … 这样的说明。 */
function compileErrors(stderr) {
  return String(stderr).split(/^(?=\s*File ")/m).flatMap((chunk) => {
    const m = /^\s*File "([^"]+)", line (\d+)/.exec(chunk)
    if (!m) return []
    const message = chunk.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
    return [{ path: m[1], line: Number(m[2]), message }]
  })
}

/**
 * 用 python -m py_compile 检查 cells（[{ file, line, text }]）的语法。返回 { checked, errors, skipped }：
 * 找不到能运行的 Python 时 skipped 是原因、不报错。py_compile 遇到第一个错误就停（Python 3.10 起），
 * 所以从出错的下一个单元接着查，直到全部查完。
 */
export function pythonSyntaxErrors(cells, { python = process.env.PYTHON || 'python3' } = {}) {
  const jobs = cells.map((cell) => ({ ...cell, code: plainPython(cell.text) })).filter((job) => job.code !== null)
  const probe = spawnSync(python, ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    return { checked: 0, errors: [], skipped: probe.error?.code === 'ENOENT' ? `没有找到 ${python}` : `${python} 运行不了` }
  }
  if (!jobs.length) return { checked: 0, errors: [] }
  const dir = mkdtempSync(join(tmpdir(), 'hello-gpu-nb-check-'))
  try {
    const paths = jobs.map((job, i) => {
      const path = join(dir, `cell${i}.py`)
      writeFileSync(path, job.code)
      return path
    })
    const index = new Map(paths.map((path, i) => [path, i]))
    const errors = []
    let next = 0
    while (next < paths.length) {
      const run = spawnSync(python, ['-m', 'py_compile', '-'], { input: `${paths.slice(next).join('\n')}\n`, encoding: 'utf8' })
      if (run.error) throw run.error
      if (run.status === 0) break
      const found = compileErrors(run.stderr).filter((e) => index.has(e.path))
      if (!found.length) {
        const first = jobs[next]
        errors.push({ file: first.file, line: first.line, message: `Python 语法检查没有跑完：${String(run.stderr).trim().split('\n').at(-1) || `退出码 ${run.status}`}` })
        break
      }
      for (const e of found) {
        const job = jobs[index.get(e.path)]
        errors.push({ file: job.file, line: job.line + e.line - 1, message: `Python 语法错误：${e.message}` })
      }
      next = Math.max(...found.map((e) => index.get(e.path))) + 1
    }
    return { checked: jobs.length, errors }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = loadNotebookData()
  const { errors, cells, sources, examples, notebooks } = checkNotebooks(data)
  const syntax = pythonSyntaxErrors(cells)
  errors.push(...syntax.errors)
  if (syntax.skipped) console.warn(`⚠ 跳过了 Python 语法检查：${syntax.skipped}。装好 Python 3，或者用环境变量 PYTHON 指定解释器`)
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${formatError(e)}`)
    console.error(`Notebook 检查未通过：${errors.length} 个问题`)
    process.exit(1)
  }
  const python = syntax.skipped ? '没有检查 Python 语法' : `Python 单元 ${syntax.checked} 个语法都对`
  console.log(`Notebook 检查通过：源文件 ${sources} 份（另有格式示例 ${examples} 份），生成的 Notebook ${notebooks} 本，${python}`)
}
