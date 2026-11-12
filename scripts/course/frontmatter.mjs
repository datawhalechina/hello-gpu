// Parse the flat frontmatter used by course page checks.
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
