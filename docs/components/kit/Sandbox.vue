<script setup lang="ts">
/**
 * 代码沙盒（S-05；03 第 3、4、7 节，08 第 3、6 节）。
 *
 * HIP 风格和 Python 风格的 kernel，跟着读者的写法偏好显示一种（F-11）。填空模式只有模板里标出的空能改，
 * 完整模式整段都能改；「运行」在 Web Worker 里跑模拟器（docs/sim/client.ts），「单步」一步一步看，
 * 「重置」回到一开始的代码。代码出错时写成「现象 + 原因 + 怎么改」并标出哪一行，解析器原文收在折叠块里。
 *
 * 用法（全局注册，Markdown 里直接写；模板和判星一般放在关卡的 challenge.ts 里）：
 *   <Sandbox
 *     title="补上每个线程的下标"
 *     :code="{ hip: HIP, python: PY }"                模板，[[名字: 初始内容]] 标出空（sandbox/template.ts）
 *     :blanks="{ i: { label: '下标 i', choices: [...] } }"   可选：空的名字（读屏）和手机上的选项
 *     :launch="{ grid: gridDim, block: blockDim }"
 *     :args="{ a: { type: 'float', data: A }, n: { type: 'int', value: 13 } }"
 *     :variants="[{ grid: 7, block: 2 }]"               可选：同一份代码再按这些配置跑，一起交给 judge；
 *                                                       某一项带上 args 就连数据一起换（换一批数据照样成立）
 *     :judge="judge"                                    可选：(runs) => { earned, next, error? }（06 第 7 节）
 *     :challenge="ch"                                   可选：useChallenge 的返回值（F-12）
 *     @result="…" @step="…">
 *     <template #controls>旋钮</template>
 *     <template #result="{ result, step, runs, source, lang }">RobotGrid、WaveView</template>
 *   </Sandbox>
 *
 * - 接 F-12：给了 challenge，两种写法的代码各自存进它的草稿（draft.code；草稿里别的字段留给关卡自己的参数），
 *   刷新不丢。再给了 judge，每跑完一次记一次尝试（代码出错也算没过），没过的次数驱动提示阶梯；
 *   challenge 配了提示时，沙盒下面放一份 HintLadder，这次的问题由它显示。
 * - 「重置」只把当前写法的代码恢复成模板，可以撤销；关卡自己的参数听 reset 事件自己处理。
 * - 手机宽度（≤ 767px）不加载编辑器：空换成输入框，给了 choices 的换成选项；完整模式有空的话
 *   退化成填空（03 第 7 节），没有空就给一个普通的文本框。
 * - 服务端渲染两种写法都输出、只显示一种（同 LangCode），挂载以后再按偏好和草稿换。编辑器
 *   （sandbox/editor.ts，CodeMirror 6）在沙盒快进入视口时才动态加载，首屏的 JS 里没有它；
 *   加载之前显示的静态代码和编辑器同样的字号、行高和高亮。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, toRaw, useId, watch } from 'vue'
import { useData } from 'vitepress'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { Arg } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { ERROR_KIND_LABEL } from '@sim/syntax/errors.ts'
import type { AttemptOutcome, AttemptResult, Challenge, ChallengeError } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import { contentError } from './contentError.ts'
import HintLadder from './HintLadder.vue'
import type { EditorHandle } from './sandbox/editor.ts'
import {
  buildRequest, describeRun, describeStep, explainError, stepGroups,
  type Launch, type SandboxOutcome, type SandboxRun, type SandboxStep, type SandboxVariant, type StepGroup,
} from './sandbox/run.ts'
import { codeLines, fillTemplate, parseTemplate, type Filled, type Template } from './sandbox/template.ts'

interface BlankOption {
  /** 读屏和手机上的名字，例如「下标 i」；不写就是「第 N 个空」 */
  label?: string
  /** 手机上的选项：两种写法一样就写一个数组，不一样就按写法分开写 */
  choices?: readonly string[] | Partial<Record<Lang, readonly string[]>>
}

const props = withDefaults(defineProps<{
  /** 两种写法的模板 */
  code: Record<Lang, string>
  /** fill：只有标出的空能改；full：整段都能改 */
  mode?: 'fill' | 'full'
  blanks?: Record<string, BlankOption>
  launch: Launch
  /** 按参数名给数据（08 第 4 节「参数」） */
  args: Record<string, Arg>
  variants?: SandboxVariant[]
  judge?: (runs: SandboxRun[]) => AttemptResult
  challenge?: Challenge
  title?: string
  /** 文件名栏里的名字，后面按写法接 .hip / .py */
  file?: string
}>(), { mode: 'fill', title: '代码沙盒', file: 'kernel' })

const emit = defineEmits<{
  result: [outcome: SandboxOutcome]
  step: [step: SandboxStep | null]
  reset: [lang: Lang]
}>()

const PANES: { lang: Lang; label: string; ext: string }[] = [
  { lang: 'hip', label: 'HIP 风格', ext: 'hip' },
  { lang: 'python', label: 'Python 风格', ext: 'py' },
]
const LANGS: Lang[] = ['hip', 'python']

const { page } = useData()
const uid = useId()
const progress = useProgress()
const root = ref<HTMLElement | null>(null)

/** 挂载之前（服务端渲染、水合）一律按默认值渲染，水合前后一致；挂载以后才看偏好、屏幕宽度和草稿。 */
const mounted = ref(false)
const narrow = ref(false)
const lang = computed<Lang>(() => (mounted.value ? progress.state.prefs.lang : 'hip'))

const parsed = computed(() => {
  const templates: Partial<Record<Lang, Template>> = {}
  let problem = ''
  for (const { lang: l, label } of PANES) {
    const text = props.code?.[l]
    if (!text) {
      problem ||= `沙盒缺少${label}的代码（code.${l}）。`
      continue
    }
    try {
      templates[l] = parseTemplate(text)
    } catch (err) {
      problem ||= `${label}的${(err as Error).message}`
    }
  }
  return { templates, problem }
})
const templateProblem = computed(() => (parsed.value.problem ? contentError(parsed.value.problem, page.value.relativePath) : ''))

// ── 草稿：两种写法各一份，空的内容和（完整模式）整段代码 ─────────────────────

interface LangDraft {
  values: Record<string, string>
  code: string | null
}
const drafts = reactive<Record<Lang, LangDraft>>({ hip: { values: {}, code: null }, python: { values: {}, code: null } })

/** 这种写法现在按空来改：填空模式，或者手机上有空的完整模式。 */
function usesBlanks(l: Lang): boolean {
  return props.mode === 'fill' || (narrow.value && Boolean(parsed.value.templates[l]?.blanks.length))
}

const filledBy = computed(() => {
  const out = {} as Record<Lang, Filled>
  for (const l of LANGS) {
    const template = parsed.value.templates[l]
    const filled = template ? fillTemplate(template, drafts[l].values) : { source: '', ranges: [] }
    out[l] = usesBlanks(l) ? filled : { source: drafts[l].code ?? filled.source, ranges: [] }
  }
  return out
})

const linesBy = computed(() => {
  const out = {} as Record<Lang, ReturnType<typeof codeLines>>
  for (const l of LANGS) out[l] = codeLines(filledBy.value[l], l, usesBlanks(l))
  return out
})

let written: unknown = null

function saveDraft() {
  const ch = props.challenge
  if (!ch) return
  const current = toRaw(ch.draft.value)
  const base = current && typeof current === 'object' && !Array.isArray(current) ? (current as Record<string, unknown>) : {}
  const code = Object.fromEntries(LANGS.map((l) => [l, { values: { ...drafts[l].values }, code: drafts[l].code }]))
  written = { ...base, code }
  ch.draft.value = written
}

/** 草稿槽读出来的东西可能被手改坏：不认识的丢掉。 */
function loadDraft(value: unknown) {
  const code = value && typeof value === 'object' ? (value as { code?: unknown }).code : null
  for (const l of LANGS) {
    const raw = code && typeof code === 'object' ? (code as Record<string, unknown>)[l] : null
    const draft = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const values: Record<string, string> = {}
    if (draft.values && typeof draft.values === 'object') {
      for (const [name, v] of Object.entries(draft.values)) if (typeof v === 'string') values[name] = v
    }
    drafts[l] = { values, code: typeof draft.code === 'string' ? draft.code : null }
  }
  undo.value = null
  refresh()
}

// 草稿槽在关卡的 useChallenge 挂载时才读好（比沙盒晚）；换存档、重置演示存档时也会整份换掉。
watch(() => props.challenge?.record.draft, (value) => {
  if (toRaw(value) !== written) loadDraft(value)
})

// ── 编辑器：桌面宽度、快进入视口时才加载 ───────────────────────────────────

const hosts: Partial<Record<Lang, HTMLElement | null>> = {}
const nearView = ref(false)
const editorLang = ref<Lang | null>(null)
const editorFailed = ref(false)
let editor: EditorHandle | null = null
let editorTicket = 0

type View = 'editor' | 'blanks' | 'code' | 'textarea'
function viewOf(l: Lang): View {
  if (editorLang.value === l) return 'editor'
  if (usesBlanks(l)) return 'blanks'
  return mounted.value && (narrow.value || editorFailed.value) ? 'textarea' : 'code'
}

function editorLabel(l: Lang): string {
  const name = PANES.find((p) => p.lang === l)?.label ?? ''
  if (!usesBlanks(l)) return `${name}的代码，可以直接改。Tab 缩进，先按 Esc 再按 Tab 离开编辑器；Ctrl 加 Enter 运行。`
  const count = parsed.value.templates[l]?.blanks.length ?? 0
  return `${name}的代码，填空：只有标出的 ${count} 个空可以改。Tab 跳到下一个空；Ctrl 加 Enter 运行。`
}

async function syncEditor() {
  const want = mounted.value && nearView.value && !narrow.value && !editorFailed.value && parsed.value.templates[lang.value]
    ? lang.value
    : null
  if (want === editorLang.value) return
  const ticket = ++editorTicket
  editor?.destroy()
  editor = null
  editorLang.value = null
  if (!want) return
  let mod: typeof import('./sandbox/editor.ts')
  try {
    mod = await import('./sandbox/editor.ts')
  } catch {
    editorFailed.value = true
    return
  }
  const host = hosts[want]
  if (ticket !== editorTicket || !host) return
  const filled = filledBy.value[want]
  editor = mod.createEditor({
    parent: host,
    lang: want,
    mode: usesBlanks(want) ? 'fill' : 'full',
    source: filled.source,
    blanks: filled.ranges,
    label: editorLabel(want),
    onChange: (source, values) => edit(want, usesBlanks(want) ? { values } : { code: source }),
    onRun: runAll,
    onReject: (reason) => {
      notice.value = reason === 'newline' ? '空里不能换行。' : '这里不能改：只有虚线框里的空可以改。'
    },
  })
  editorLang.value = want
  editor.setMarks(marks.value)
}

/** 代码被整段换掉（读草稿、重置、撤销重置）：编辑器跟着换。读者自己打字时不用，编辑器里已经是新的了。 */
function pushToEditor() {
  const l = editorLang.value
  if (editor && l) editor.setSource(filledBy.value[l].source, filledBy.value[l].ranges)
}

// ── 改代码 ──────────────────────────────────────────────────────────────

const notice = ref('')
const undo = ref<{ lang: Lang; draft: LangDraft } | null>(null)

function edit(l: Lang, change: Partial<LangDraft>) {
  if (change.values) drafts[l].values = { ...drafts[l].values, ...change.values }
  if (change.code !== undefined) drafts[l].code = change.code
  notice.value = ''
  undo.value = null
  stopStepping()
  saveDraft()
}

function onInput(l: Lang, name: string, event: Event) {
  edit(l, { values: { [name]: (event.target as HTMLInputElement | HTMLSelectElement).value } })
}

/** 手机上的选项：只在窄屏给；读者在桌面上写的内容不在选项里时，也放进去当第一项。 */
function choicesFor(l: Lang, name: string): readonly string[] | null {
  if (!narrow.value) return null
  const choices = props.blanks?.[name]?.choices
  const list = Array.isArray(choices) ? choices : (choices as Partial<Record<Lang, readonly string[]>> | undefined)?.[l]
  return list?.length ? list : null
}

function blankLabel(l: Lang, name: string): string {
  const index = parsed.value.templates[l]?.blanks.findIndex((b) => b.name === name) ?? -1
  return props.blanks?.[name]?.label ?? `第 ${index + 1} 个空`
}

function switchTo(l: Lang) {
  progress.setPref('lang', l)
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-lang="${l}"] .hg-sandbox__switch`)?.focus())
}

// ── 运行、单步、重置 ────────────────────────────────────────────────────

interface Done {
  lang: Lang
  source: string
  runs: SandboxRun[]
}
interface Finished extends Done {
  verdict: AttemptResult | null
  /** 记成了一次尝试（给了 challenge 和 judge）时的结果 */
  outcome: AttemptOutcome | null
}
interface Stepping extends Done {
  groups: StepGroup[]
  index: number
}

let client: SimClient | null = null
let controller: AbortController | null = null
const running = ref(false)
/** 模拟器以外的问题：超时、worker 出错 */
const problem = ref('')
const last = shallowRef<Finished | null>(null)
const stepping = shallowRef<Stepping | null>(null)

/** 按当前写法的代码跑一次：读者的启动配置，接着是 variants（代码出错就不用再跑了）。 */
async function execute(): Promise<Done | null> {
  if (!client || running.value || templateProblem.value) return null
  const l = lang.value
  const { source } = filledBy.value[l]
  const ctl = new AbortController()
  controller = ctl
  running.value = true
  problem.value = ''
  notice.value = ''
  undo.value = null
  try {
    const launch: Launch = { ...props.launch }
    const main = await client.run(buildRequest(source, l, launch, props.args), { signal: ctl.signal })
    const runs: SandboxRun[] = [{ launch, result: main }]
    for (const { args, ...change } of main.ok ? props.variants ?? [] : []) {
      const config: Launch = { ...launch, ...change }
      runs.push({ launch: config, result: await client.run(buildRequest(source, l, config, args ?? props.args), { signal: ctl.signal }) })
    }
    return { lang: l, source, runs }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') problem.value = (err as Error).message
    return null
  } finally {
    if (controller === ctl) {
      controller = null
      running.value = false
    }
  }
}

/** 跑完一次：判星、记尝试，把结果交给父组件。 */
function finish(done: Done) {
  const main = done.runs[0].result
  let verdict: AttemptResult | null = null
  if (!main.ok) verdict = { earned: [false, false, false], next: '先让程序跑起来。', error: explainError(main.error) }
  else if (props.judge) verdict = props.judge(done.runs)
  const outcome = props.challenge && props.judge && verdict ? props.challenge.attempt(verdict) : null
  last.value = { lang: done.lang, source: done.source, runs: done.runs, verdict, outcome }
  emit('result', { lang: done.lang, source: done.source, runs: done.runs, verdict })
}

function emitStep() {
  const s = stepping.value
  emit('step', s ? { index: s.index, count: s.groups.length, group: s.groups[s.index], result: s.runs[0].result } : null)
}

function stopStepping() {
  if (!stepping.value) return
  stepping.value = null
  emitStep()
}

async function runAll() {
  if (running.value) return
  stopStepping()
  const done = await execute()
  if (done) finish(done)
}

/** 第一下先跑完整个程序（在 worker 里），再从第一步开始一步一步放；走到最后一步再按一下就是跑完。 */
async function step() {
  if (running.value) return
  const s = stepping.value
  if (s) {
    if (s.index + 1 < s.groups.length) stepping.value = { ...s, index: s.index + 1 }
    else {
      stepping.value = null
      finish(s)
    }
    emitStep()
    return
  }
  const done = await execute()
  if (!done) return
  const groups = stepGroups(done.runs[0].result.events)
  if (!groups.length) {
    finish(done)
    return
  }
  last.value = null
  stepping.value = { ...done, groups, index: 0 }
  emitStep()
}

/** 代码被整段换掉以后：旧的结果、单步和标记都作废。 */
function refresh() {
  stopStepping()
  last.value = null
  problem.value = ''
  pushToEditor()
}

function reset() {
  controller?.abort()
  const l = lang.value
  undo.value = { lang: l, draft: { values: { ...drafts[l].values }, code: drafts[l].code } }
  drafts[l] = { values: {}, code: null }
  refresh()
  saveDraft()
  notice.value = '代码已经恢复成一开始的样子。'
  emit('reset', l)
}

function undoReset() {
  const u = undo.value
  if (!u) return
  drafts[u.lang] = u.draft
  undo.value = null
  refresh()
  saveDraft()
  notice.value = '已经撤销重置。'
}

/** 换了写法：上一种写法的结果和单步不再对应现在的代码。 */
watch(lang, () => {
  refresh()
  notice.value = ''
  undo.value = null
})

/** 关卡换了模板（比如同一个沙盒换一道题）：按新模板重新拼代码，旧的结果作废。 */
watch(parsed, refresh)

// ── 显示 ────────────────────────────────────────────────────────────────

/** 现在要标的行：单步到的行，或者出错的位置；代码改过了就不标（行号可能对不上）。 */
const marks = computed(() => {
  const l = lang.value
  const current = filledBy.value[l].source
  const s = stepping.value
  const step = s && s.lang === l && s.source === current ? s.groups[s.index].line : null
  const r = last.value
  const main = !s && r && r.lang === l && r.source === current ? r.runs[0].result : null
  return { step, error: main && !main.ok ? { line: main.error.line, col: main.error.col } : null }
})
watch(marks, (value) => editor?.setMarks(value))

const stale = computed(() => Boolean(last.value && last.value.source !== filledBy.value[last.value.lang].source))

const status = computed(() => {
  if (running.value) return { tone: '', text: '运行中……' }
  if (problem.value) return { tone: 'bad', text: problem.value }
  const s = stepping.value
  if (s) {
    const where = describeStep(s.groups[s.index], s.runs[0].result.events, s.runs[0].launch)
    return { tone: 'step', text: `第 ${s.index + 1} / ${s.groups.length} 步：${where}` }
  }
  const r = last.value
  if (!r) {
    const what = props.mode === 'fill' ? '把虚线框里的空补好' : '改好代码'
    return { tone: '', text: `${what}，再点「运行」；也可以用「单步」一步一步看。` }
  }
  const again = stale.value ? '代码改过了，再运行一次看新的结果。' : ''
  const main = r.runs[0].result
  if (!main.ok) return { tone: 'bad', text: `第 ${main.error.line} 行出错了（${ERROR_KIND_LABEL[main.error.kind]}）。${again}` }
  const ran = `运行完成：${describeRun(main, r.runs[0].launch)}`
  const v = r.verdict
  if (!v) return { tone: 'good', text: ran + again }
  // 综合关的分题过没过不只看数对不对（Boss 的第二、三张数本来就对），没过就说「还没过」
  const missed = props.challenge?.kind === 'part' ? '还没过' : '结果还不对'
  if (!v.earned[0]) return { tone: 'bad', text: `${ran}${missed}：${v.error?.symptom ?? v.next ?? ''}${again}` }
  const cap = props.challenge && r.outcome && r.outcome.stars.length > props.challenge.cap.value
    ? `看过答案，这一关最多记 ${props.challenge.cap.value} 颗星。`
    : ''
  // 探索环节和分题不发星（F-12），过了就不说「达到几条星级标准」
  if (props.challenge && props.challenge.kind !== 'challenge') return { tone: 'good', text: `${ran}过了。${v.next ?? ''}${again}` }
  return { tone: 'good', text: `${ran}过了，达到 ${v.earned.filter(Boolean).length} 条星级标准。${v.next ?? ''}${cap}${again}` }
})

const stepLabel = computed(() => {
  const s = stepping.value
  if (!s) return '单步'
  return s.index + 1 < s.groups.length ? '下一步' : '走完，看结果'
})

/** 出错的位置：跳过去改。代码改过了就不给（行号可能对不上）。 */
const errorAt = computed(() => {
  const main = last.value?.runs[0].result
  return main && !main.ok && !stale.value && last.value?.lang === lang.value ? main.error : null
})

const showLadder = computed(() => Boolean(props.challenge?.hints))
/** 这次的问题：记成了尝试、下面又有提示阶梯时由提示阶梯显示，这里不重复。 */
const shownError = computed<ChallengeError | null>(() => {
  const r = last.value
  if (!r?.verdict || r.verdict.earned[0]) return null
  if (r.outcome && showLadder.value) return null
  return r.verdict.error ?? null
})

function jumpTo(line: number, col: number) {
  if (editor) {
    editor.focusAt(line, col)
    return
  }
  const pane = root.value?.querySelector<HTMLElement>(`.hg-sandbox__pane[data-lang="${lang.value}"]`)
  const area = pane?.querySelector<HTMLTextAreaElement>('textarea')
  if (area) {
    const offset = area.value.split('\n').slice(0, line - 1).reduce((n, text) => n + text.length + 1, 0) + col - 1
    area.focus()
    area.setSelectionRange(offset, offset)
    return
  }
  const row = pane?.querySelector<HTMLElement>(`[data-line="${line}"]`)
  row?.scrollIntoView({ block: 'nearest' })
  row?.querySelector<HTMLElement>('input, select')?.focus()
}

const slotStep = computed<SandboxStep | null>(() => {
  const s = stepping.value
  return s ? { index: s.index, count: s.groups.length, group: s.groups[s.index], result: s.runs[0].result } : null
})
/** 交给 result 插槽的那一次：正在单步的，或者最近跑完的。source、lang 是跑的那段代码（WaveView 按它显示代码、标出当前行）。 */
const shown = computed(() => stepping.value ?? last.value)
const slotResult = computed(() => shown.value?.runs[0].result ?? null)
const slotRuns = computed(() => shown.value?.runs ?? [])

// ── 挂载 ────────────────────────────────────────────────────────────────

let media: MediaQueryList | null = null
let observer: IntersectionObserver | null = null
function onMedia() {
  narrow.value = Boolean(media?.matches)
}

watch([mounted, nearView, narrow, lang, editorFailed], syncEditor)

onMounted(() => {
  client = createSimClient()
  media = window.matchMedia('(max-width: 767px)')
  media.addEventListener('change', onMedia)
  narrow.value = media.matches
  loadDraft(props.challenge?.record.draft)
  mounted.value = true
  if (typeof IntersectionObserver === 'undefined' || !root.value) {
    nearView.value = true
    return
  }
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    nearView.value = true
    observer?.disconnect()
  }, { rootMargin: '400px 0px' })
  observer.observe(root.value)
})

onBeforeUnmount(() => {
  controller?.abort()
  client?.dispose()
  editor?.destroy()
  editor = null
  observer?.disconnect()
  media?.removeEventListener('change', onMedia)
})
</script>

<template>
  <div ref="root" class="hg-sandbox">
    <section class="hg-sandbox__card" :aria-labelledby="`${uid}-title`">
      <header class="hg-sandbox__head">
        <span class="hg-sandbox__eyebrow" aria-hidden="true">LAB</span>
        <h3 :id="`${uid}-title`" class="hg-sandbox__title">{{ title }}</h3>
        <span class="hg-sandbox__mode">{{ mode === 'fill' ? '填空' : '完整代码' }}</span>
      </header>

      <p v-if="templateProblem" class="hg-sandbox__problem" role="alert" data-hg-content-error>{{ templateProblem }}</p>

      <div v-if="$slots.controls" class="hg-sandbox__controls">
        <slot name="controls" />
      </div>

      <div
        v-for="(pane, i) in PANES"
        :key="pane.lang"
        class="hg-sandbox__pane"
        :data-lang="pane.lang"
        :style="mounted ? { display: pane.lang === lang ? 'block' : 'none' } : undefined"
      >
        <!-- 代码区在亮暗主题下都是深色（01 第 2.4 节）：里面的错误色、焦点色取暗色那一套 -->
        <div class="hg-sandbox__code" data-hg-theme="dark">
          <p class="hg-sandbox__bar">
            <span class="hg-sandbox__file">{{ file }}.{{ pane.ext }}</span>
            <button type="button" class="hg-sandbox__switch" @click="switchTo(PANES[1 - i].lang)">
              换成 {{ PANES[1 - i].label }}
            </button>
          </p>
          <div class="hg-sandbox__body">
            <div :ref="(el) => { hosts[pane.lang] = el as HTMLElement | null }" class="hg-sandbox__editor" />
            <div
              v-if="viewOf(pane.lang) === 'blanks' || viewOf(pane.lang) === 'code'"
              class="hg-sandbox__static"
              role="group"
              :aria-label="`${pane.label}的代码`"
              translate="no"
            >
              <div
                v-for="(line, n) in linesBy[pane.lang]"
                :key="n"
                class="hg-sandbox__line"
                :class="{
                  'is-step': pane.lang === lang && marks.step === n + 1,
                  'is-error': pane.lang === lang && marks.error?.line === n + 1,
                }"
                :data-line="n + 1"
              >
                <span class="hg-sandbox__ln" aria-hidden="true">{{ n + 1 }}</span>
                <span class="hg-sandbox__lc"><template
                  v-for="(seg, k) in line"
                  :key="seg.kind === 'blank' ? `b-${seg.name}` : `t-${k}`"
                ><span v-if="seg.kind === 'text'" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span><span
                  v-else-if="choicesFor(pane.lang, seg.name)"
                  class="hg-sandbox__choice"
                ><select
                  class="hg-sandbox__blank"
                  :value="seg.text"
                  :aria-label="blankLabel(pane.lang, seg.name)"
                  :data-blank="seg.name"
                  :style="{ width: `${Math.max(seg.text.length, 3)}ch` }"
                  @change="onInput(pane.lang, seg.name, $event)"
                ><option v-if="!choicesFor(pane.lang, seg.name)?.includes(seg.text)" :value="seg.text">{{ seg.text || '（空着）' }}</option><option
                  v-for="choice in choicesFor(pane.lang, seg.name)"
                  :key="choice"
                  :value="choice"
                >{{ choice }}</option></select></span><input
                  v-else
                  class="hg-sandbox__blank"
                  type="text"
                  :value="seg.text"
                  :aria-label="blankLabel(pane.lang, seg.name)"
                  :data-blank="seg.name"
                  :style="{ width: `${Math.max(seg.text.length, 3) + 2}ch` }"
                  :disabled="!mounted"
                  autocapitalize="off"
                  autocomplete="off"
                  autocorrect="off"
                  spellcheck="false"
                  @input="onInput(pane.lang, seg.name, $event)"
                  @keydown.enter.prevent="runAll"
                ></template></span>
              </div>
            </div>
            <div v-else-if="viewOf(pane.lang) === 'textarea'" class="hg-sandbox__plain">
              <!-- 普通文本框没有行号：旁边单独一列，单步到的行、出错的行照样标出来 -->
              <span class="hg-sandbox__gutter" aria-hidden="true"><span
                v-for="n in linesBy[pane.lang].length"
                :key="n"
                class="hg-sandbox__ln"
                :class="{
                  'is-step': pane.lang === lang && marks.step === n,
                  'is-error': pane.lang === lang && marks.error?.line === n,
                }"
              >{{ n }}</span></span>
              <textarea
                class="hg-sandbox__textarea"
                :value="filledBy[pane.lang].source"
                :rows="linesBy[pane.lang].length + 1"
                :aria-label="editorLabel(pane.lang)"
                wrap="off"
                autocapitalize="off"
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"
                translate="no"
                @input="edit(pane.lang, { code: ($event.target as HTMLTextAreaElement).value })"
                @keydown.ctrl.enter.prevent="runAll"
                @keydown.meta.enter.prevent="runAll"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="hg-sandbox__actions">
        <button type="button" class="hg-sandbox__button is-primary" :disabled="!mounted || running || !!templateProblem" @click="runAll">运行</button>
        <button type="button" class="hg-sandbox__button" :disabled="!mounted || running || !!templateProblem" @click="step">{{ stepLabel }}</button>
        <button type="button" class="hg-sandbox__button" :disabled="!mounted" @click="reset">重置</button>
        <span class="hg-sandbox__keys">在代码里按 Ctrl + Enter（Mac 上是 Cmd + Enter）也能运行</span>
      </div>

      <p class="hg-sandbox__status" :class="status.tone ? `is-${status.tone}` : undefined">
        <span role="status">{{ status.text }}</span>
        <button v-if="errorAt" type="button" class="hg-sandbox__link" @click="jumpTo(errorAt.line, errorAt.col)">
          跳到第 {{ errorAt.line }} 行
        </button>
      </p>
      <p v-if="notice" class="hg-sandbox__notice">
        <span role="status">{{ notice }}</span>
        <button v-if="undo" type="button" class="hg-sandbox__link" @click="undoReset">撤销</button>
      </p>

      <div v-if="shownError" class="hg-sandbox__error">
        <p class="hg-sandbox__error-title">这次的问题</p>
        <dl>
          <div><dt>现象</dt><dd>{{ shownError.symptom }}</dd></div>
          <div><dt>原因</dt><dd>{{ shownError.cause }}</dd></div>
          <div><dt>怎么改</dt><dd>{{ shownError.fix }}</dd></div>
        </dl>
        <details v-if="shownError.raw" class="hg-sandbox__raw">
          <summary>原始报错</summary>
          <pre><code>{{ shownError.raw }}</code></pre>
        </details>
      </div>

      <div v-if="$slots.result" class="hg-sandbox__result">
        <slot name="result" :result="slotResult" :step="slotStep" :runs="slotRuns" :source="shown?.source ?? null" :lang="shown?.lang ?? null" />
      </div>
    </section>

    <HintLadder v-if="challenge && showLadder" :challenge="challenge" />
  </div>
</template>

<style>
/* 默认（服务端渲染、没有偏好、偏好是 HIP）显示 HIP 风格；属性是 python 时反过来。挂载以后由行内样式决定。 */
.hg-sandbox__pane[data-lang='python'],
html[data-hg-lang='python'] .hg-sandbox__pane[data-lang='hip'] {
  display: none;
}

html[data-hg-lang='python'] .hg-sandbox__pane[data-lang='python'] {
  display: block;
}
</style>

<style scoped>
.hg-sandbox {
  margin: 20px 0;
}

.hg-sandbox__card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.hg-sandbox__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.hg-sandbox__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-sandbox__title {
  margin: 0;
  padding: 0;
  border: 0;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  letter-spacing: 0;
}

.hg-sandbox__mode {
  margin-left: auto;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-sandbox__problem {
  margin: 0;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

.hg-sandbox__controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 28px;
  align-items: flex-end;
}

/* ── 代码区 ── */

.hg-sandbox__code {
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-code-dot);
  border-radius: 14px;
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.hg-sandbox__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  margin: 0;
  padding: 7px 14px;
  border-bottom: var(--hg-border-width) solid var(--hg-code-dot);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  line-height: 1.6;
}

.hg-sandbox__file {
  color: var(--hg-code-file);
}

.hg-sandbox__switch {
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--hg-accent-ink);
  font: inherit;
  font-family: var(--hg-font-body);
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.hg-sandbox__switch:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
  border-radius: var(--hg-radius-tag);
}

/* 焦点在代码里时整块描一圈（画在深色代码区里面，用暗色的焦点色才看得清） */
.hg-sandbox__body {
  position: relative;
  overflow-x: auto;
}

.hg-sandbox__body:focus-within {
  box-shadow: inset 0 0 0 2px var(--hg-accent-ink);
}

.hg-sandbox__body:has(.hg-sandbox__blank:focus-visible) {
  box-shadow: none;
}

/* 编辑器（CodeMirror）的样式在 sandbox/editor.ts 里；没有编辑器时这一层是空的 */
.hg-sandbox__editor:empty {
  display: none;
}

/* 不加载编辑器时的代码：字号、行高、行号宽度和编辑器一样，换成编辑器时不跳 */
.hg-sandbox__static {
  min-width: max-content;
  padding: 12px 0;
  font-family: var(--hg-font-mono);
  font-size: 14px;
  line-height: 1.85;
}

.hg-sandbox__line {
  display: flex;
  white-space: pre;
}

.hg-sandbox__ln {
  position: relative;
  flex: none;
  box-sizing: border-box;
  min-width: calc(2ch + 32px);
  padding: 0 10px 0 22px;
  color: var(--hg-code-line-number);
  text-align: right;
  user-select: none;
}

.hg-sandbox__lc {
  padding: 0 18px 0 6px;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

.hg-sandbox__line.is-step {
  background: color-mix(in srgb, var(--hg-code-highlight) 14%, transparent);
}

.hg-sandbox__line.is-error {
  background: var(--hg-error-soft);
}

.hg-sandbox__line.is-step .hg-sandbox__ln::before,
.hg-sandbox__line.is-error .hg-sandbox__ln::before,
.hg-sandbox__ln.is-step::before,
.hg-sandbox__ln.is-error::before {
  position: absolute;
  left: 4px;
  width: 14px;
  font-weight: 700;
  text-align: center;
}

.hg-sandbox__line.is-step .hg-sandbox__ln::before,
.hg-sandbox__ln.is-step::before {
  content: '▶';
  color: var(--hg-code-highlight);
  font-size: 10px;
}

.hg-sandbox__line.is-error .hg-sandbox__ln::before,
.hg-sandbox__ln.is-error::before {
  content: '!';
  color: var(--hg-error-ink);
}

/* 空：虚线框 + 读者要改的表达式的颜色（01 第 2.4 节），不只靠颜色 */
.hg-sandbox__blank {
  box-sizing: content-box;
  min-width: 3ch;
  max-width: 60ch;
  margin: 0 1px;
  padding: 0 4px;
  border: var(--hg-border-width) dashed color-mix(in srgb, var(--hg-code-highlight) 70%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--hg-code-highlight) 10%, transparent);
  color: var(--hg-code-highlight);
  font: inherit;
  line-height: 1.5;
  vertical-align: baseline;
}

/* 手机上的选项：去掉各浏览器不一样的原生箭头，自己画一个「▾」，看得出能点开选 */
.hg-sandbox__choice {
  position: relative;
  display: inline-block;
}

.hg-sandbox__choice::after {
  content: '▾';
  position: absolute;
  top: 50%;
  right: 7px;
  color: var(--hg-code-highlight);
  font-size: 12px;
  line-height: 1;
  transform: translateY(-50%);
  pointer-events: none;
}

select.hg-sandbox__blank {
  appearance: none;
  padding-right: 1.7em;
  cursor: pointer;
}

.hg-sandbox__blank option {
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.hg-sandbox__blank:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

/* 手机上没有空的完整模式：普通文本框，左边一列行号（字号、行高和静态代码一样，逐行对齐） */
.hg-sandbox__plain {
  display: flex;
  align-items: flex-start;
}

.hg-sandbox__gutter {
  display: flex;
  flex: none;
  flex-direction: column;
  padding: 12px 0;
  font-family: var(--hg-font-mono);
  font-size: 14px;
  line-height: 1.85;
}

.hg-sandbox__textarea {
  display: block;
  flex: 1;
  box-sizing: border-box;
  min-width: 0;
  min-height: 10em;
  margin: 0;
  padding: 12px 18px 12px 6px;
  border: 0;
  background: transparent;
  color: var(--hg-code-ink);
  font-family: var(--hg-font-mono);
  font-size: 14px;
  line-height: 1.85;
  white-space: pre;
  overflow-x: auto;
  resize: vertical;
  tab-size: 4;
}

.hg-sandbox__textarea:focus {
  outline: none;
}

/* ── 按钮和状态 ── */

.hg-sandbox__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}

.hg-sandbox__button {
  min-height: 42px;
  padding: 0 18px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--motion-ease-out),
    background-color var(--motion-fast) var(--motion-ease-out);
}

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节）。 */
.hg-sandbox__button.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-sandbox__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.hg-sandbox__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-sandbox__button:focus-visible,
.hg-sandbox__link:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-sandbox__keys {
  color: var(--hg-ink-3);
  font-size: 13px;
}

.hg-sandbox__status,
.hg-sandbox__notice {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.6;
}

.hg-sandbox__status.is-good {
  color: var(--hg-accent-ink);
}

.hg-sandbox__status.is-bad {
  color: var(--hg-error-ink);
}

.hg-sandbox__status.is-step {
  color: var(--hg-ink);
}

.hg-sandbox__notice {
  color: var(--hg-amber-ink);
  font-size: 14px;
}

.hg-sandbox__link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--hg-accent-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.hg-sandbox__error {
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
}

.hg-sandbox__error-title {
  margin: 0 0 6px;
  color: var(--hg-error-ink);
  font-weight: 700;
}

.hg-sandbox__error dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  margin: 0;
}

.hg-sandbox__error dl > div {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 8px;
}

.hg-sandbox__error dt {
  color: var(--hg-ink-2);
  font-weight: 600;
}

.hg-sandbox__error dd {
  margin: 0;
}

.hg-sandbox__raw {
  margin-top: 8px;
}

.hg-sandbox__raw summary {
  color: var(--hg-ink-2);
  font-size: 14px;
  cursor: pointer;
}

.hg-sandbox__raw pre {
  margin: 8px 0 0;
  padding: 10px 14px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  white-space: pre-wrap;
}

.hg-sandbox__result:empty {
  display: none;
}

@media (max-width: 767px) {
  .hg-sandbox__card {
    padding: 16px 14px;
  }

  .hg-sandbox__keys {
    display: none;
  }
}
</style>
