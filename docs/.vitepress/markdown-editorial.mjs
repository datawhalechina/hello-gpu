// Presentation-only wrappers: the chapter source, heading IDs and experiment text stay intact.
export default function editorialPlugin(md) {
  const renderText = md.renderer.rules.text
  md.renderer.rules.text = (tokens, index, options, env, self) => {
    const token = tokens[index]
    if (!token.meta?.chapterHeading) return renderText(tokens, index, options, env, self)
    const match = /^(第\s*\d+\s*章\s*)/.exec(token.content)
    if (!match) return renderText(tokens, index, options, env, self)
    const number = match[0].match(/\d+/)[0].padStart(2, '0')
    const title = md.utils.escapeHtml(token.content.slice(match[0].length))
      .replace(/^([A-Za-z][A-Za-z -]*：)(.+)$/, '$1<span class="hg-heading-subtitle">$2</span>')
    return `<span class="hg-heading-number">${md.utils.escapeHtml(match[0])}</span><span class="hg-heading-ordinal" aria-hidden="true">${number}</span><span class="hg-heading-text">${title}</span>`
  }
  md.core.ruler.after('inline', 'hello-gpu-editorial', (state) => {
    const path = state.env.relativePath || state.env.path || ''
    if (!/part\d[^/]*\/chapter\d+\//.test(path)) return
    const tokens = state.tokens
    const title = tokens.findIndex(token => token.type === 'heading_open' && token.tag === 'h1')
    if (title < 0) return
    const firstText = tokens[title + 1]?.children?.find(token => token.type === 'text')
    if (firstText) firstText.meta = { ...firstText.meta, chapterHeading: true }
    let leadOpen = -1
    let leadClose = -1
    for (let i = title + 1; i < tokens.length; i++) {
      if (tokens[i].type === 'heading_open' && tokens[i].tag === 'h2') {
        if (tokens[i + 1]?.content.trim() === '本章导读') tokens[i].attrJoin('class', 'hg-lead-heading')
        else break
      }
      if (tokens[i].type === 'blockquote_open' && leadOpen < 0) leadOpen = i
      if (leadOpen >= 0 && tokens[i].type === 'blockquote_close' && tokens[i].level === tokens[leadOpen].level) { leadClose = i; break }
    }
    if (leadOpen >= 0) tokens[leadOpen].attrJoin('class', 'hg-chapter-lead')
    if (leadClose < 0) {
      // Some chapters use ordinary paragraphs instead of a blockquote for the lead.
      const guide = tokens.findIndex(token => token.type === 'heading_open' && token.attrGet('class') === 'hg-lead-heading')
      if (guide >= 0) {
        const start = guide + 3
        let end = start
        let paragraphs = 0
        while (tokens[end]?.type === 'paragraph_open' && paragraphs < 2) {
          const close = tokens.findIndex((token, index) => index > end && token.type === 'paragraph_close' && token.level === tokens[end].level)
          if (close < 0) break
          end = close + 1
          paragraphs++
        }
        if (end > start) {
          const open = new state.Token('html_block', '', 0)
          open.content = '<div class="hg-chapter-lead">\n'
          const close = new state.Token('html_block', '', 0)
          close.content = '</div>\n'
          tokens.splice(end, 0, close)
          tokens.splice(start, 0, open)
          leadClose = end + 1
        }
      }
    }
    if (leadClose >= 0) {
      const meta = new state.Token('html_block', '', 0)
      meta.content = '<ChapterMeta />\n'
      tokens.splice(leadClose + 1, 0, meta)
    } else {
      const meta = new state.Token('html_block', '', 0)
      meta.content = '<ChapterMeta />\n'
      tokens.splice(title + 3, 0, meta)
    }
    if (!path.includes('part2-kernels/')) return
    for (let i = title + 1; i < tokens.length; i++) {
      if (tokens[i].type !== 'table_open') continue
      const end = tokens.findIndex((token, index) => index > i && token.type === 'table_close')
      if (end < 0) break
      const text = tokens.slice(i, end).filter(token => token.type === 'inline').map(token => token.content).join(' ')
      if (!text.startsWith('阅读路线')) break
      const open = new state.Token('html_block', '', 0)
      open.content = '<details class="hg-reading-guide"><summary>阅读路线与前置知识</summary>\n'
      const close = new state.Token('html_block', '', 0)
      close.content = '</details>\n'
      tokens.splice(end + 1, 0, close)
      tokens.splice(i, 0, open)
      break
    }
  })
}
