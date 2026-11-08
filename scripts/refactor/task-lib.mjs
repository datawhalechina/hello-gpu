// 重构任务文件的解析、校验与调度逻辑。
// 命令行（scripts/refactor/tasks.mjs）和看板（docs/preview/board/Board.vue）共用本文件，
// 所以这里不能使用任何 Node 专有 API。

export const STATUSES = ['todo', 'doing', 'review', 'done', 'blocked']

export const STATUS_LABEL = {
  todo: '待开始',
  doing: '进行中',
  review: '待验收',
  done: '已完成',
  blocked: '受阻',
}

export const PHASES = {
  0: '基建',
  1: '新手村',
  2: '铸造城',
  3: '试炼场',
  4: '收尾',
}

export const AREAS = {
  infra: '基建',
  sim: '模拟器',
  pages: '全局页面',
  novice: '新手村',
  agent: 'Agent',
  placement: '定级测试',
  dungeon: '副本',
  lab: '实验室',
  forge: '铸造城',
  trial: '试炼场',
  archive: '真机与档案',
  launch: '上线',
  gate: '作者验收',
}

export const SIZES = ['S', 'M', 'L']
export const OWNERS = ['ai', 'author']

export const REQUIRED_FIELDS = [
  'id', 'title', 'phase', 'order', 'area', 'status', 'deps',
  'size', 'gpu', 'owner', 'specs', 'outputs', 'updated',
]

export const SECTIONS = ['目标', '背景', '要做的事', '验收标准', '验证方式', '完成记录', '验收记录']

export const RECORD_PLACEHOLDER = '_待填写：做了什么、改了哪些文件、怎么验证的、遗留问题、待确认事项。_'
export const REVIEW_PLACEHOLDER = '_作者验收后由会话记录。_'

// 依赖处于这些状态时视为已满足：待验收也算，作者验收不通过时任务会被退回。
export const SATISFIED = new Set(['review', 'done'])

const ID_RE = /^[A-Z]+(?:-[A-Z]+)*-\d{2}[a-z]?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseValue(raw) {
  const v = raw.trim()
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((s) => unquote(s.trim())).filter(Boolean)
  }
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+$/.test(v)) return Number(v)
  return unquote(v)
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

export function splitFrontmatter(text) {
  const src = text.replace(/\r\n/g, '\n')
  if (!src.startsWith('---\n')) return { fm: '', body: src, ok: false }
  const end = src.indexOf('\n---', 4)
  if (end < 0) return { fm: '', body: src, ok: false }
  const fm = src.slice(4, end)
  const after = src.indexOf('\n', end + 1)
  const body = after < 0 ? '' : src.slice(after + 1)
  return { fm, body, ok: true }
}

export function parseFrontmatter(text) {
  const { fm, body, ok } = splitFrontmatter(text)
  const data = {}
  if (ok) {
    for (const line of fm.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue
      const i = line.indexOf(':')
      if (i < 0) continue
      data[line.slice(0, i).trim()] = parseValue(line.slice(i + 1))
    }
  }
  return { data, body, ok }
}

export function parseSections(body) {
  const sections = {}
  const order = []
  let current = null
  let buf = []
  const flush = () => {
    if (current !== null) sections[current] = buf.join('\n').trim()
  }
  for (const line of body.split('\n')) {
    const m = /^## (.+?)\s*$/.exec(line)
    if (m) {
      flush()
      current = m[1]
      order.push(current)
      buf = []
    } else if (current !== null) {
      buf.push(line)
    }
  }
  flush()
  return { sections, order }
}

export function checklist(sectionText = '') {
  let done = 0
  let total = 0
  const items = []
  for (const line of sectionText.split('\n')) {
    const m = /^\s*- \[( |x|X)\]\s*(.*)$/.exec(line)
    if (!m) continue
    total += 1
    const ok = m[1] !== ' '
    if (ok) done += 1
    items.push({ ok, text: m[2] })
  }
  return { done, total, items }
}

export function parseTask(text, file = '') {
  const { data, body, ok } = parseFrontmatter(text)
  const { sections, order } = parseSections(body)
  return {
    ...data,
    file,
    hasFrontmatter: ok,
    body,
    sections,
    sectionOrder: order,
    checks: checklist(sections['验收标准']),
    recordFilled: isFilled(sections['完成记录'], RECORD_PLACEHOLDER),
  }
}

function isFilled(text, placeholder) {
  const t = (text || '').trim()
  return t.length > 0 && t !== placeholder
}

export function indexById(tasks) {
  const map = new Map()
  for (const t of tasks) map.set(t.id, t)
  return map
}

export function unmetDeps(task, byId) {
  return (task.deps || []).filter((d) => !SATISFIED.has(byId.get(d)?.status))
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)))
}

// 可以开工的任务：待开始、依赖已满足、由 AI 会话执行；可选按 GPU 过滤。
export function availableTasks(tasks, { gpu = true, includeAuthor = false } = {}) {
  const byId = indexById(tasks)
  return sortTasks(tasks).filter((t) => {
    if (t.status !== 'todo') return false
    if (!includeAuthor && t.owner !== 'ai') return false
    if (!gpu && t.gpu) return false
    return unmetDeps(t, byId).length === 0
  })
}

// 已经到达的作者验收关口：依赖都已满足、还没验收。到达关口时会话停下，请作者先验收。
export function pendingGates(tasks) {
  const byId = indexById(tasks)
  return sortTasks(tasks).filter((t) =>
    t.owner === 'author' && t.status !== 'done' && unmetDeps(t, byId).length === 0)
}

// 等作者处理的事项：待验收的任务，以及依赖已满足的作者验收关口。
export function waitingForAuthor(tasks) {
  const byId = indexById(tasks)
  return sortTasks(tasks).filter((t) =>
    t.status === 'review' ||
    (t.owner === 'author' && t.status === 'todo' && unmetDeps(t, byId).length === 0))
}

export function summarize(tasks) {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  const byPhase = {}
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1
    const p = (byPhase[t.phase] ||= { total: 0, done: 0, review: 0 })
    p.total += 1
    if (t.status === 'done') p.done += 1
    if (t.status === 'review') p.review += 1
  }
  return { total: tasks.length, byStatus, byPhase }
}

function findCycles(tasks) {
  const byId = indexById(tasks)
  const state = new Map()
  const cycles = []
  const visit = (id, path) => {
    const s = state.get(id)
    if (s === 'done') return
    if (s === 'active') {
      cycles.push([...path.slice(path.indexOf(id)), id].join(' → '))
      return
    }
    state.set(id, 'active')
    for (const d of byId.get(id)?.deps || []) if (byId.has(d)) visit(d, [...path, id])
    state.set(id, 'done')
  }
  for (const t of tasks) visit(t.id, [])
  return cycles
}

// 返回中文错误列表；空数组表示全部通过。
export function validateTasks(tasks, { specNames = null } = {}) {
  const errors = []
  const seen = new Map()
  for (const t of tasks) {
    const where = t.file || t.id || '(未知文件)'
    if (!t.hasFrontmatter) {
      errors.push(`${where}：缺少 frontmatter`)
      continue
    }
    for (const f of REQUIRED_FIELDS) {
      if (t[f] === undefined || t[f] === '') errors.push(`${where}：缺少字段 ${f}`)
    }
    if (t.id && !ID_RE.test(t.id)) errors.push(`${where}：编号格式不对（${t.id}），应类似 F-01、FG-LAB-02、F-05a`)
    if (t.id && t.file) {
      const base = t.file.split('/').pop().replace(/\.md$/, '')
      if (base !== t.id) errors.push(`${where}：文件名应与编号一致（${t.id}.md）`)
    }
    if (t.id) {
      if (seen.has(t.id)) errors.push(`${where}：编号 ${t.id} 与 ${seen.get(t.id)} 重复`)
      seen.set(t.id, where)
    }
    if (t.status && !STATUSES.includes(t.status)) errors.push(`${where}：状态 ${t.status} 不合法，只能是 ${STATUSES.join(' / ')}`)
    if (t.area && !(t.area in AREAS)) errors.push(`${where}：area ${t.area} 不合法`)
    if (t.phase !== undefined && !(t.phase in PHASES)) errors.push(`${where}：phase ${t.phase} 不合法`)
    if (t.size && !SIZES.includes(t.size)) errors.push(`${where}：size 只能是 S / M / L`)
    if (t.owner && !OWNERS.includes(t.owner)) errors.push(`${where}：owner 只能是 ai / author`)
    if (t.area === 'gate' && t.owner !== 'author') errors.push(`${where}：作者验收关口的 owner 必须是 author`)
    if (typeof t.gpu !== 'boolean') errors.push(`${where}：gpu 必须是 true 或 false`)
    if (typeof t.order !== 'number') errors.push(`${where}：order 必须是整数`)
    if (t.updated && !DATE_RE.test(String(t.updated))) errors.push(`${where}：updated 应为 YYYY-MM-DD`)
    for (const key of ['deps', 'specs', 'outputs']) {
      if (t[key] !== undefined && !Array.isArray(t[key])) errors.push(`${where}：${key} 必须是 [a, b] 形式的列表`)
    }
    if (specNames && Array.isArray(t.specs)) {
      for (const s of t.specs) if (!specNames.includes(s)) errors.push(`${where}：规范 ${s} 不存在（refactor/specs/${s}.md）`)
    }
    const missing = SECTIONS.filter((s) => !(s in t.sections))
    if (missing.length) errors.push(`${where}：缺少小节 ${missing.map((s) => `「${s}」`).join('')}`)
    const present = t.sectionOrder.filter((s) => SECTIONS.includes(s))
    const expected = SECTIONS.filter((s) => present.includes(s))
    if (present.join('|') !== expected.join('|')) errors.push(`${where}：小节顺序应为 ${SECTIONS.join(' → ')}`)
    if (t.owner === 'ai' && t.checks.total === 0) errors.push(`${where}：「验收标准」里至少要有一条 - [ ] 复选项`)
    if ((t.status === 'review' || t.status === 'done') && t.owner === 'ai' && !t.recordFilled) {
      errors.push(`${where}：状态为 ${t.status}，但「完成记录」还没填写`)
    }
  }
  const byId = indexById(tasks)
  for (const t of tasks) {
    for (const d of t.deps || []) {
      if (d === t.id) errors.push(`${t.file || t.id}：不能依赖自己`)
      else if (!byId.has(d)) errors.push(`${t.file || t.id}：依赖 ${d} 不存在`)
    }
  }
  for (const c of findCycles(tasks)) errors.push(`循环依赖：${c}`)
  const doing = tasks.filter((t) => t.status === 'doing')
  if (doing.length > 1) errors.push(`同时有 ${doing.length} 个进行中的任务（${doing.map((t) => t.id).join('、')}），一次只能做一个`)
  return errors
}

// —— 写回任务文件（只改需要的行，保留其余格式） ——

export function setField(text, key, value) {
  const src = text.replace(/\r\n/g, '\n')
  const end = src.indexOf('\n---', 4)
  const fm = src.slice(0, end)
  const rest = src.slice(end)
  const re = new RegExp(`^${key}:.*$`, 'm')
  const line = `${key}: ${value}`
  const next = re.test(fm) ? fm.replace(re, line) : `${fm}\n${line}`
  return next + rest
}

export function appendToSection(text, section, line) {
  const src = text.replace(/\r\n/g, '\n')
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l.trim() === `## ${section}`)
  if (start < 0) return `${src.replace(/\n*$/, '')}\n\n## ${section}\n\n${line}\n`
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { end = i; break }
  }
  const content = lines.slice(start + 1, end).filter((l) => {
    const t = l.trim()
    return t !== REVIEW_PLACEHOLDER && t !== RECORD_PLACEHOLDER
  })
  while (content.length && !content[content.length - 1].trim()) content.pop()
  while (content.length && !content[0].trim()) content.shift()
  const block = ['', ...content, line, '']
  return [...lines.slice(0, start + 1), ...block, ...lines.slice(end)].join('\n')
}

// 固定提示词：看板展示、README 收录；`tasks check` 会确认 README 里的文字和这里一致。
export const PROMPTS = [
  {
    key: 'next',
    label: '开工：领取下一个任务',
    text: '按 refactor/README.md 的「会话流程」继续 Hello GPU 重构：领取下一个可开始的任务，完成后提交并推送到 refactor/v2 分支，最后告诉我做了什么、怎么验证的。',
  },
  {
    key: 'one',
    label: '做指定的任务',
    text: '按 refactor/README.md 的「会话流程」完成重构任务 <编号>，完成后提交并推送到 refactor/v2 分支，最后告诉我做了什么、怎么验证的。',
  },
  { key: 'pass', label: '验收通过', text: '验收任务 <编号>：通过' },
  { key: 'fail', label: '验收不通过', text: '验收任务 <编号>：不通过（原因：……）' },
  { key: 'batch', label: '按阶段批量验收', text: '验收阶段 <阶段号>：除下面列出的任务外全部通过。<编号>：不通过（原因：……）' },
]

export function fillPrompt(text, id) {
  return id ? text.replaceAll('<编号>', id) : text
}
