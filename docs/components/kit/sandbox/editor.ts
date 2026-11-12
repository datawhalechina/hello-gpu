/**
 * 代码沙盒的编辑器（S-05）：CodeMirror 6。
 *
 * 只由 Sandbox.vue 用动态 import 加载：桌面宽度、沙盒快进入视口时才加载（09 第 3 节、03 第 7 节），
 * 首屏的 JS 里没有它；手机宽度用静态代码加输入框，不加载。
 *
 * - 填空模式：只有模板里标出的空能改（changeFilter 挡住其余的改动，读者试图改别处时回调 onReject）；
 *   空的两头随打字往外扩，空着的空显示成一个虚线框；Tab / Shift-Tab 在空之间跳，最后一个空再按 Tab 离开编辑器。
 * - 完整模式：整段都能改；Tab 缩进（先按 Esc 再按 Tab 离开编辑器，CodeMirror 自带），回车按上一行缩进，
 *   行尾是「{」（HIP）或「:」（Python）时多缩进一级。
 * - 两种模式都是 Ctrl / ⌘ + Enter 运行；当前单步执行到的行、出错的行和列用颜色加行号旁的记号标出。
 * - 语法高亮和不加载编辑器时的静态代码共用 highlight.ts。颜色全部取 tokens.css 的代码区 token，
 *   编辑器挂在 Sandbox 里 data-hg-theme="dark" 的代码区里，错误色、焦点色取的是暗色那一套。
 */
import { countColumn, EditorSelection, EditorState, Prec, RangeSet, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import {
  Decoration, drawSelection, EditorView, GutterMarker, gutterLineClass, keymap, lineNumbers, WidgetType, type Command,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import { getIndentUnit, indentService, indentUnit } from '@codemirror/language'
import type { Lang } from '../../../sim/syntax/ast.ts'
import { highlight } from './highlight.ts'
import type { BlankRange } from './template.ts'

export interface EditorMarks {
  /** 出错的位置（1 起的行、列） */
  error: { line: number; col: number } | null
  /** 单步执行到的行 */
  step: number | null
}

export interface EditorOptions {
  parent: HTMLElement
  lang: Lang
  /** fill：只有空能改；full：整段都能改 */
  mode: 'fill' | 'full'
  source: string
  blanks: readonly BlankRange[]
  /** 读屏读的名字 */
  label: string
  /** 读者改了代码：整段代码，和每个空现在的内容（完整模式下没有空） */
  onChange(source: string, values: Record<string, string>): void
  /** Ctrl / ⌘ + Enter */
  onRun(): void
  /** 填空模式下想改空以外的地方（outside），或者想在空里换行（newline） */
  onReject(reason: 'outside' | 'newline'): void
}

export interface EditorHandle {
  /** 换一整段代码（读草稿、重置、撤销重置）：撤销记录从这里重新开始 */
  setSource(source: string, blanks: readonly BlankRange[]): void
  setMarks(marks: EditorMarks): void
  /** 光标放到第 line 行第 col 列并聚焦（「跳到这一行」） */
  focusAt(line: number, col: number): void
  destroy(): void
}

/** 每个空现在在哪：两头往外扩，在空的边上打的字算在空里（空着的空也一样）。 */
const blankField = StateField.define<readonly BlankRange[]>({
  create: () => [],
  update(blanks, tr) {
    if (!tr.docChanged) return blanks
    return blanks.map((b) => ({ name: b.name, from: tr.changes.mapPos(b.from, -1), to: tr.changes.mapPos(b.to, 1) }))
  },
})

const NO_MARKS: EditorMarks = { error: null, step: null }
const setMarks = StateEffect.define<EditorMarks>()
/** 改了代码，行号就对不上了：标记一律清掉。 */
const markField = StateField.define<EditorMarks>({
  create: () => NO_MARKS,
  update(marks, tr) {
    for (const effect of tr.effects) if (effect.is(setMarks)) return effect.value
    return tr.docChanged ? NO_MARKS : marks
  },
})

class EmptyBlank extends WidgetType {
  toDOM() {
    const box = document.createElement('span')
    box.className = 'cm-hg-blank cm-hg-blank-empty'
    box.setAttribute('aria-hidden', 'true')
    return box
  }

  eq() {
    return true
  }

  ignoreEvent() {
    return false
  }
}

/** 行号旁边的记号：单步到的行是「▶」，出错的行是「!」（不只靠颜色，01 第 7 节）。 */
class LineMarker extends GutterMarker {
  constructor(className: string) {
    super()
    this.elementClass = className
  }
}

const TONE_MARK = {
  keyword: Decoration.mark({ class: 'cm-hg-keyword' }),
  comment: Decoration.mark({ class: 'cm-hg-comment' }),
}
const STEP_LINE = Decoration.line({ class: 'cm-hg-step-line' })
const ERROR_LINE = Decoration.line({ class: 'cm-hg-error-line' })
const ERROR_AT = Decoration.mark({ class: 'cm-hg-error-at' })
const STEP_GUTTER = new LineMarker('cm-hg-gutter-step')
const ERROR_GUTTER = new LineMarker('cm-hg-gutter-error')

function syntax(lang: Lang): Extension {
  return EditorView.decorations.compute(['doc'], (state) =>
    Decoration.set(highlight(state.doc.toString(), lang).map((t) => TONE_MARK[t.tone].range(t.from, t.to))))
}

const blankDecorations = EditorView.decorations.compute([blankField], (state) => {
  const marks = state.field(blankField).map((b) => b.from === b.to
    ? Decoration.widget({ widget: new EmptyBlank(), side: 1 }).range(b.from)
    : Decoration.mark({ class: 'cm-hg-blank', attributes: { 'data-blank': b.name } }).range(b.from, b.to))
  return Decoration.set(marks, true)
})

/** 行号超出范围（代码被换掉了）时不标。 */
function lineAt(state: EditorState, line: number | undefined) {
  return line !== undefined && line >= 1 && line <= state.doc.lines ? state.doc.line(line) : null
}

const markDecorations = EditorView.decorations.compute([markField], (state) => {
  const { error, step } = state.field(markField)
  const out: Range<Decoration>[] = []
  const stepLine = lineAt(state, step ?? undefined)
  if (stepLine) out.push(STEP_LINE.range(stepLine.from))
  const errorLine = lineAt(state, error?.line)
  if (error && errorLine) {
    out.push(ERROR_LINE.range(errorLine.from))
    if (errorLine.length > 0) {
      const at = Math.min(Math.max(errorLine.from + error.col - 1, errorLine.from), errorLine.to - 1)
      out.push(ERROR_AT.range(at, at + 1))
    }
  }
  return Decoration.set(out, true)
})

const markGutters = gutterLineClass.compute([markField], (state) => {
  const { error, step } = state.field(markField)
  const out: Range<GutterMarker>[] = []
  const stepLine = lineAt(state, step ?? undefined)
  const errorLine = lineAt(state, error?.line)
  if (stepLine) out.push(STEP_GUTTER.range(stepLine.from))
  if (errorLine) out.push(ERROR_GUTTER.range(errorLine.from))
  return RangeSet.of(out, true)
})

/** 填空模式：改动必须整个落在某一个空里，而且不能换行；否则整笔改动都不做。 */
function onlyBlanks(onReject: EditorOptions['onReject']): Extension {
  return EditorState.changeFilter.of((tr) => {
    const blanks = tr.startState.field(blankField)
    const problems: ('outside' | 'newline')[] = []
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (!blanks.some((b) => b.from <= fromA && toA <= b.to)) problems.push('outside')
      else if (inserted.lines > 1) problems.push('newline')
    })
    if (!problems.length) return true
    const reason = problems.includes('outside') ? 'outside' : 'newline'
    // 过滤器里不直接改界面：等这一笔处理完再通知
    queueMicrotask(() => onReject(reason))
    return false
  })
}

/** Tab / Shift-Tab：跳到下一个 / 上一个空并选中它的内容；没有了就交给浏览器，焦点离开编辑器。 */
function jump(dir: 1 | -1): Command {
  return (view) => {
    const blanks = view.state.field(blankField)
    const head = view.state.selection.main.head
    const inside = blanks.findIndex((b) => b.from <= head && head <= b.to)
    let target: BlankRange | undefined
    if (inside >= 0) target = blanks[inside + dir]
    else if (dir > 0) target = blanks.find((b) => b.from > head)
    else target = [...blanks].reverse().find((b) => b.to < head)
    if (!target) return false
    view.dispatch({ selection: EditorSelection.single(target.from, target.to), scrollIntoView: true })
    return true
  }
}

/** 完整模式的 Tab：没选中文字时补空格到下一级缩进，选中了就整行缩进。 */
const insertIndent: Command = (view) => {
  const { state } = view
  if (state.selection.ranges.some((r) => !r.empty)) return indentMore(view)
  const unit = getIndentUnit(state)
  view.dispatch(state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head)
    const insert = ' '.repeat(unit - (countColumn(line.text.slice(0, range.head - line.from), state.tabSize) % unit))
    return { changes: { from: range.head, insert }, range: EditorSelection.cursor(range.head + insert.length) }
  }), { scrollIntoView: true, userEvent: 'input' })
  return true
}

/**
 * 回车后的缩进：跟上一行一样；上一行（光标前的部分）以「{」或「:」结尾时多一级，HIP 光标后面是「}」时少一级。
 * 光标在行首时看上面最近的一个非空行。
 */
function smartIndent(lang: Lang): Extension {
  return indentService.of((cx, pos) => {
    const { doc } = cx.state
    const line = doc.lineAt(pos)
    let before = line.text.slice(0, pos - line.from)
    for (let n = line.number - 1; !before.trim() && n >= 1; n--) before = doc.line(n).text
    const opens = before.trimEnd().endsWith(lang === 'python' ? ':' : '{')
    const closes = lang === 'hip' && /^\s*\}/.test(line.text.slice(pos - line.from))
    const indent = cx.countColumn(before, before.search(/\S|$/))
    return Math.max(0, indent + (opens ? cx.unit : 0) - (closes && !opens ? cx.unit : 0))
  })
}

const theme = EditorView.theme({
  '&': { color: 'var(--hg-code-ink)', backgroundColor: 'transparent', fontSize: '14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--hg-font-mono)', lineHeight: '1.85' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--hg-code-ink)' },
  '.cm-line': { padding: '0 18px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--hg-code-ink)', borderLeftWidth: '2px' },
  '.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--hg-code-keyword) 22%, transparent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--hg-code-keyword) 34%, transparent)',
  },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--hg-code-line-number)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { position: 'relative', minWidth: '2ch', padding: '0 10px 0 22px' },
  '.cm-hg-gutter-step::before, .cm-hg-gutter-error::before': {
    position: 'absolute', left: '4px', width: '14px', textAlign: 'center', fontWeight: '700',
  },
  '.cm-hg-gutter-step': { color: 'var(--hg-code-highlight)' },
  '.cm-hg-gutter-step::before': { content: '"▶"', fontSize: '10px' },
  '.cm-hg-gutter-error': { color: 'var(--hg-error-ink)' },
  '.cm-hg-gutter-error::before': { content: '"!"' },
  '.cm-hg-keyword': { color: 'var(--hg-code-keyword)' },
  '.cm-hg-comment': { color: 'var(--hg-code-file)' },
  '.cm-hg-blank': {
    padding: '1px 0',
    borderRadius: '4px',
    outline: '1px dashed color-mix(in srgb, var(--hg-code-highlight) 70%, transparent)',
    outlineOffset: '1px',
    backgroundColor: 'color-mix(in srgb, var(--hg-code-highlight) 10%, transparent)',
  },
  '.cm-hg-blank, .cm-hg-blank .cm-hg-keyword': { color: 'var(--hg-code-highlight)' },
  '.cm-hg-blank-empty': { display: 'inline-block', width: '3ch', height: '1.3em', verticalAlign: 'middle' },
  '.cm-hg-step-line': { backgroundColor: 'color-mix(in srgb, var(--hg-code-highlight) 14%, transparent)' },
  '.cm-hg-error-line': { backgroundColor: 'var(--hg-error-soft)' },
  '.cm-hg-error-at': {
    textDecoration: 'underline wavy var(--hg-error)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '4px',
  },
}, { dark: true })

export function createEditor(options: EditorOptions): EditorHandle {
  const { lang, mode } = options
  const extensions: Extension[] = [
    Prec.high(keymap.of([
      { key: 'Mod-Enter', run: () => (options.onRun(), true) },
      mode === 'fill' ? { key: 'Tab', run: jump(1), shift: jump(-1) } : { key: 'Tab', run: insertIndent, shift: indentLess },
    ])),
    // Mod-Alt-\ 会按缩进规则重排选中的行：Python 的缩进本身就是代码，不能自动重排
    keymap.of([...defaultKeymap.filter((b) => b.key !== 'Mod-Alt-\\'), ...historyKeymap]),
    history(),
    lineNumbers(),
    drawSelection(),
    EditorState.tabSize.of(4),
    indentUnit.of('    '),
    smartIndent(lang),
    syntax(lang),
    blankDecorations,
    markField,
    markDecorations,
    markGutters,
    theme,
    EditorView.contentAttributes.of({
      'aria-label': options.label,
      spellcheck: 'false',
      autocapitalize: 'off',
      autocorrect: 'off',
      translate: 'no',
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return
      const source = update.state.doc.toString()
      const values = Object.fromEntries(update.state.field(blankField).map((b) => [b.name, source.slice(b.from, b.to)]))
      options.onChange(source, values)
    }),
  ]
  if (mode === 'fill') extensions.push(onlyBlanks(options.onReject))

  const stateFor = (source: string, blanks: readonly BlankRange[]) => {
    const tracked = mode === 'fill' ? blanks : []
    const first = tracked[0]
    return EditorState.create({
      doc: source,
      // 第一次用 Tab 进来就停在第一个空上，内容选中，直接打字就能换掉
      selection: first ? EditorSelection.single(first.from, first.to) : undefined,
      extensions: [blankField.init(() => tracked), ...extensions],
    })
  }

  const view = new EditorView({ parent: options.parent, state: stateFor(options.source, options.blanks) })

  return {
    setSource(source, blanks) {
      view.setState(stateFor(source, blanks))
    },
    setMarks(marks) {
      view.dispatch({ effects: setMarks.of(marks) })
    },
    focusAt(line, col) {
      const target = lineAt(view.state, line)
      if (!target) return
      const pos = Math.min(target.from + Math.max(col - 1, 0), target.to)
      view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true })
      view.focus()
    },
    destroy() {
      view.destroy()
    },
  }
}
