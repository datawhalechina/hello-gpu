<script setup lang="ts">
/**
 * 读者自己的 Python Agent（A-02；03 第 3、4、7 节，09 第 3、6 节）。
 *
 * 1-14：读者在一个 ReAct 循环里补三个空（docs/course/agent/starter.ts），点「运行我的 Agent」，
 * Agent 在模拟器上自己调 block 和访问步长，交卷以后按三星标准评分。
 * - Python 用 Pyodide，第一次点运行时才下载（自托管，约 13.5 MB，docs/course/agent/pyodide-files.ts），
 *   首屏不加载；下载有进度，可以随时停下。代码在 Web Worker 里运行（pyodide-client.ts），页面不会被卡住，
 *   跑得太久（多半是死循环）自动停下。
 * - 每一步按「思考 → 行动 → 观察」列出来，并写出规则 Agent（A-01）面对同样的历史会怎么选；
 *   最后写出交卷的结果、星级，和规则 Agent 从同一个起点走的一轮比一比。
 * - 代码出错写成「现象 + 原因 + 怎么改」，标出哪一行、哪个空（03 第 4 节）；Python 的原文收在折叠块里。
 * - Python 加载不出来（断网、浏览器太旧）时退化为看规则 Agent 的回放（AgentConsole），这一关照样能学完；
 *   不想下载的读者也可以直接点「看规则 Agent 的回放」。
 * - 编辑：桌面宽度、快进入视口时才加载编辑器（sandbox/editor.ts，CodeMirror，和代码沙盒同一个），只有空能改，
 *   Tab / Shift + Tab 在空之间跳，Ctrl / ⌘ + Enter 运行；手机宽度不加载编辑器，空换成选项（03 第 7 节）。
 *
 * 用法（全局注册，Markdown 里直接写）：
 *   <AgentCode />                                          向量加法，起点 block 48、步长 4
 *   <AgentCode :start="{ block: 100, stride: 8 }" @result="…" @fallback="…" />
 *   <AgentCode v-model:values="draft" :variants="[{ block: 16, stride: 2 }]" @result="…" />
 *   result：每跑完一次发一次 { stop, verdict, steps, matches, rule, error, log, variants }，关卡拿它判星；
 *           stop 是 finish（交卷）、limit（步数用完）、end（没交卷就跑完了）、error（代码出错），verdict 是交卷的评分，
 *           log 是每一步的行动和观察
 *   fallback：Python 没加载出来，参数是原因
 *   v-model:values 是读者填的空（空的名字 → 内容）：每改一次都会更新，关卡把它存进草稿槽；刷新以后传回来，代码照着换上
 *     （只换代码，不自动运行：运行要下载 Python）
 *   variants：同一份代码再从这些起点各跑一轮（起点这一轮交卷了才跑），每一轮的 { start, stop, verdict, steps, error, log }
 *     放在 result 的 variants 里，关卡拿它判「换个起点照样成立」；跑到一半出了问题，后面的就不跑了
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { useData, withBase } from 'vitepress'
import { createPyAgentClient, RUN_TIMEOUT_MS, type LoadProgress, type PyAgentClient } from '@course/agent/pyodide-client.ts'
import type { PyRun, PyStep } from '@course/agent/pyodide.ts'
import { explainPythonError, type ExplainedError } from '@course/agent/pyerror.ts'
import { megabytes, PYODIDE_BYTES, PYODIDE_DIR } from '@course/agent/pyodide-files.ts'
import { formatAction, MAX_STEPS, starText, type AgentAction, type Observation, type Verdict } from '@course/agent/react.ts'
import { AGENT_STARTERS, agentStarter } from '@course/agent/starter.ts'
import { describeConfig, tuneTask, type TuneConfig, type TuneTask } from '@course/agent/tasks.ts'
import AgentConsole from './AgentConsole.vue'
import { contentError } from './contentError.ts'
import type { EditorHandle } from './sandbox/editor.ts'
import { codeLines, fillTemplate, parseTemplate } from './sandbox/template.ts'

/** 一步：行动和观察 */
interface AgentCodeStep {
  action: AgentAction
  observation: Observation
}

/** 同一份代码换一个起点（variants）跑的一轮 */
interface AgentCodeVariant {
  start: TuneConfig
  stop: PyRun['stop']
  verdict: Verdict | null
  steps: number
  error: ExplainedError | null
  log: AgentCodeStep[]
}

interface AgentCodeResult {
  stop: PyRun['stop']
  verdict: Verdict | null
  steps: number
  /** 和规则 Agent 选得一样的步数 */
  matches: number
  rule: PyRun['rule']
  error: ExplainedError | null
  /** 起点这一轮每一步的行动和观察 */
  log: AgentCodeStep[]
  /** 换起点再跑的每一轮，按 variants 的顺序；没给 variants、起点这一轮没交卷时是空的 */
  variants: AgentCodeVariant[]
}

const props = withDefaults(defineProps<{
  /** 任务 id（docs/course/agent/tasks.ts 的 TUNE_TASKS，模板在 starter.ts） */
  task?: string
  /** 起点，要从任务的可选值里选；不写用任务自己的起点 */
  start?: TuneConfig | null
  /** 一轮最多几步 */
  maxSteps?: number
  title?: string
  /** 读者填的空（v-model:values）；不给就只在组件里记着 */
  values?: Readonly<Record<string, string>> | null
  /** 同一份代码再从这些起点各跑一轮，要从任务的可选值里选 */
  variants?: readonly TuneConfig[] | null
}>(), {
  task: 'vector-add',
  start: null,
  maxSteps: MAX_STEPS,
  title: '补全你的 Agent',
  values: null,
  variants: null,
})

const emit = defineEmits<{
  result: [result: AgentCodeResult]
  fallback: [reason: string]
  'update:values': [values: Record<string, string>]
}>()

const { page } = useData()
const uid = useId()
const root = ref<HTMLElement | null>(null)
/** 挂载之前（服务端渲染、水合）按默认值渲染，挂载以后才看屏幕宽度 */
const mounted = ref(false)
const narrow = ref(false)

// ── 任务、起点和模板 ─────────────────────────────────────────────────────

const listed = computed(() => tuneTask(props.task))
const starter = computed(() => agentStarter(props.task))
const problem = computed(() => {
  const t = listed.value
  if (!t || !starter.value) {
    return contentError(`AgentCode 的 task 写成了「${props.task}」，可选的是 ${Object.keys(AGENT_STARTERS).join('、')}。`, page.value.relativePath)
  }
  const s = props.start
  if (s && (!t.blocks.includes(s.block) || !t.strides.includes(s.stride))) {
    return contentError(`AgentCode 的 start 要从可选值里选：block 是 ${t.blocks.join(' / ')}，stride 是 ${t.strides.join(' / ')}；现在是 ${JSON.stringify(s)}。`, page.value.relativePath)
  }
  if (!Number.isInteger(props.maxSteps) || props.maxSteps < 1) {
    return contentError(`AgentCode 的 max-steps 要是正整数，现在是 ${String(props.maxSteps)}。`, page.value.relativePath)
  }
  const odd = (props.variants ?? []).find((v) => !t.blocks.includes(v?.block) || !t.strides.includes(v?.stride))
  if (odd !== undefined) {
    return contentError(`AgentCode 的 variants 里每个起点都要从可选值里选：block 是 ${t.blocks.join(' / ')}，stride 是 ${t.strides.join(' / ')}；现在有 ${JSON.stringify(odd)}。`, page.value.relativePath)
  }
  return ''
})
// 拆成两个数：父组件每次渲染传一个新的 { block, stride } 对象时，数没变就不算换了起点
const startBlock = computed(() => props.start?.block ?? listed.value?.start.block ?? 0)
const startStride = computed(() => props.start?.stride ?? listed.value?.start.stride ?? 0)
const activeTask = computed<TuneTask | null>(() => (listed.value && !problem.value
  ? { ...listed.value, start: { block: startBlock.value, stride: startStride.value } }
  : null))
const limit = computed(() => (problem.value ? MAX_STEPS : props.maxSteps))

const template = computed(() => (starter.value ? parseTemplate(starter.value.code) : null))
/** 读者填的内容；没填过的空用模板的初始内容。改的时候整个换掉，计算属性才跟得上 */
const values = ref<Record<string, string>>({})
const filled = computed(() => (template.value ? fillTemplate(template.value, values.value) : { source: '', ranges: [] }))
const lines = computed(() => codeLines(filled.value, 'python'))

function blankLabel(name: string): string {
  return starter.value?.blanks[name]?.label ?? name
}

/** 每一行上有哪几个空（报错时说「第 2 个空：新的步长」） */
const blanksByLine = computed(() => {
  const map = new Map<number, string[]>()
  for (const r of filled.value.ranges) {
    const line = filled.value.source.slice(0, r.from).split('\n').length
    map.set(line, [...(map.get(line) ?? []), blankLabel(r.name)])
  }
  return map
})

/** 手机上的选项：读者在桌面上写的内容不在选项里时，也放进去当第一项 */
function choicesFor(name: string, current: string): readonly string[] {
  const list = starter.value?.blanks[name]?.choices ?? []
  return list.includes(current) ? list : [current, ...list]
}

// ── 改代码 ──────────────────────────────────────────────────────────────

const notice = ref('')
const undo = ref<Record<string, string> | null>(null)

/** 空的内容整个换掉，也告诉 v-model:values（关卡把它存进草稿槽） */
function commit(next: Record<string, string>) {
  values.value = next
  emit('update:values', { ...next })
}

function edit(next: Record<string, string>) {
  commit({ ...values.value, ...next })
  notice.value = ''
  undo.value = null
}

/** 代码整段换了（重置、撤销重置、换模板、v-model:values 传进来新的）：编辑器跟着换。读者打字时不用，编辑器里已经是新的了。 */
function pushToEditor() {
  editor?.setSource(filled.value.source, filled.value.ranges)
}

function reset() {
  undo.value = { ...values.value }
  commit({})
  pushToEditor()
  notice.value = '三个空已经恢复成一开始的样子。'
}

function undoReset() {
  if (!undo.value) return
  commit(undo.value)
  undo.value = null
  pushToEditor()
  notice.value = '已经撤销重置。'
}

// ── 编辑器：桌面宽度、快进入视口时才加载 ───────────────────────────────────

const host = ref<HTMLElement | null>(null)
const nearView = ref(false)
const editorReady = ref(false)
const editorFailed = ref(false)
let editor: EditorHandle | null = null
let editorWanted = false
let editorTicket = 0

const editorLabel = computed(() => {
  const count = template.value?.blanks.length ?? 0
  return `Agent 的 Python 代码，填空：只有标出的 ${count} 个空可以改。Tab 跳到下一个空；Ctrl 加 Enter 运行。`
})

async function syncEditor() {
  const want = mounted.value && nearView.value && !narrow.value && !editorFailed.value && Boolean(template.value)
  if (want === editorWanted) return
  editorWanted = want
  const ticket = ++editorTicket
  editor?.destroy()
  editor = null
  editorReady.value = false
  if (!want) return
  let mod: typeof import('./sandbox/editor.ts')
  try {
    // 按需加载（09 第 3 节）：首屏 JS 里没有编辑器，和代码沙盒共用同一个块
    mod = await import('./sandbox/editor.ts')
  } catch {
    editorFailed.value = true
    return
  }
  if (ticket !== editorTicket || !host.value) return
  editor = mod.createEditor({
    parent: host.value,
    lang: 'python',
    mode: 'fill',
    source: filled.value.source,
    blanks: filled.value.ranges,
    label: editorLabel.value,
    onChange: (_source, next) => edit(next),
    onRun: () => void runMine(),
    onReject: (reason) => {
      notice.value = reason === 'newline' ? '空里不能换行。' : '这里不能改：只有虚线框里的空可以改。'
    },
  })
  editorReady.value = true
  editor.setMarks(marks.value)
}

// ── 运行 ────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'loading' | 'running'
const phase = ref<Phase>('idle')
const progress = ref<LoadProgress | null>(null)
/** Python 没加载出来的原因；空字符串是没出问题 */
const loadFailed = ref('')
const showReplay = ref(false)
/** 这一次走过的步（运行途中一步一步加进来） */
const steps = shallowRef<PyStep[]>([])
const result = shallowRef<PyRun | null>(null)
/** 跑的是哪一段代码：代码改过以后，出错的标记就对不上了 */
const ranSource = ref('')
/** 超时、停下、worker 出错 */
const runProblem = ref('')
/** 换起点再跑到第几个了（运行途中）；没在换起点跑是 null */
const sweep = ref<{ done: number; total: number } | null>(null)
/** 最近一次换起点再跑的每一轮 */
const variantRuns = shallowRef<AgentCodeVariant[]>([])
/** Python 下载过、启动过一次：之后文件在浏览器缓存里，不再提醒下载多大 */
const downloaded = ref(false)
let client: PyAgentClient | null = null

async function runMine() {
  const task = activeTask.value
  const t = template.value
  if (!mounted.value || phase.value !== 'idle' || !task || !t) return
  const empty = t.blanks.find((b) => !(Object.hasOwn(values.value, b.name) ? values.value[b.name] : b.initial).trim())
  if (empty) {
    notice.value = `${blankLabel(empty.name)}还空着：填好再运行。`
    return
  }
  const code = filled.value.source
  notice.value = ''
  undo.value = null
  runProblem.value = ''
  loadFailed.value = ''
  client ??= createPyAgentClient(new URL(withBase(`/${PYODIDE_DIR}`), location.href).href)
  if (!client.ready) {
    phase.value = 'loading'
    progress.value = null
    try {
      await client.load((p) => {
        progress.value = p
      })
    } catch (err) {
      phase.value = 'idle'
      const e = err instanceof Error ? err : new Error(String(err))
      if (e.name === 'AbortError') {
        runProblem.value = '已经停下：Python 还没有加载完，下次点运行会接着下载。'
        return
      }
      loadFailed.value = e.message
      showReplay.value = true
      emit('fallback', e.message)
      return
    }
    downloaded.value = true
  }
  phase.value = 'running'
  steps.value = []
  result.value = null
  variantRuns.value = []
  ranSource.value = code
  try {
    const r = await client.run(
      { code, task: props.task, start: { block: task.start.block, stride: task.start.stride }, maxSteps: limit.value },
      { onStep: (step) => (steps.value = [...steps.value, step]) },
    )
    result.value = r
    steps.value = r.steps
    // 起点这一轮交卷了，同一份代码再从 variants 的每个起点跑一轮（不一步一步显示）
    const runs: AgentCodeVariant[] = []
    const starts = r.stop === 'finish' && !r.error ? props.variants ?? [] : []
    for (const [k, start] of starts.entries()) {
      sweep.value = { done: k, total: starts.length }
      const from = { block: start.block, stride: start.stride }
      try {
        const v = await client.run({ code, task: props.task, start: from, maxSteps: limit.value })
        runs.push({
          start: from,
          stop: v.stop,
          verdict: v.verdict,
          steps: v.steps.length,
          error: v.error ? explainPythonError(v.error, blankAt) : null,
          log: v.steps.map((s) => ({ action: s.action, observation: s.observation })),
        })
      } catch (err) {
        // 读者点了「停下」：这一次不算，交给下面统一处理；超时、worker 出错：记成这一轮出错，后面的不再跑
        if (err instanceof Error && err.name === 'AbortError') throw err
        const timeout = err instanceof Error && err.name === 'TimeoutError'
        runs.push({
          start: from,
          stop: 'error',
          verdict: null,
          steps: 0,
          error: {
            symptom: timeout
              ? `你的 Agent 跑了 ${RUN_TIMEOUT_MS / 1000} 秒还没有结束，已经停下。`
              : `这一轮没有跑完：${err instanceof Error ? err.message : String(err)}`,
            cause: timeout ? '多半是哪里写成了死循环：换了起点，代码走到了起点这一轮没走过的地方。' : '运行 Python 的地方出了问题，不是你的代码写错了。',
            fix: timeout ? '看看空里有没有会一直算下去的写法；每个空只写一个判断或一个数。' : '再运行一次；还是这样就刷新页面。',
            raw: '',
          },
          log: [],
        })
        break
      }
    }
    sweep.value = null
    variantRuns.value = runs
    emit('result', {
      stop: r.stop,
      verdict: r.verdict,
      steps: r.steps.length,
      matches: r.steps.filter((s) => s.same).length,
      rule: r.rule,
      error: explained.value,
      log: r.steps.map((s) => ({ action: s.action, observation: s.observation })),
      variants: runs,
    })
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err))
    runProblem.value = e.name === 'TimeoutError'
      ? `你的 Agent 跑了 ${RUN_TIMEOUT_MS / 1000} 秒还没有结束，已经停下：多半是哪里写成了死循环。Python 也停掉了，下次运行要重新启动它，会多等几秒。`
      : e.name === 'AbortError'
        ? '已经停下。'
        : `运行出了问题：${e.message}`
  } finally {
    phase.value = 'idle'
    progress.value = null
    sweep.value = null
  }
}

function retry() {
  showReplay.value = false
  void runMine()
}

// 换了任务（模板）：读者填的内容对不上了，清掉；换了起点、步数上限：上一次的结果对不上了
watch(template, () => {
  commit({})
  undo.value = null
  pushToEditor()
})
watch([template, activeTask, limit], () => {
  if (phase.value === 'running') client?.stop()
  steps.value = []
  result.value = null
  variantRuns.value = []
  runProblem.value = ''
})

// v-model:values：传进来的和手上的不一样（刷新以后读出了草稿、换了存档）就换上，编辑器跟着换；
// 读者自己改的会原样传回来，内容一样就不动编辑器（不然光标会跳）
watch(() => props.values, (incoming) => {
  if (!incoming) return
  const next: Record<string, string> = {}
  for (const [name, v] of Object.entries(incoming)) if (typeof v === 'string') next[name] = v
  const mine = values.value
  if (Object.keys(next).length === Object.keys(mine).length && Object.entries(next).every(([k, v]) => mine[k] === v)) return
  values.value = next
  undo.value = null
  pushToEditor()
}, { immediate: true })

// ── 显示 ────────────────────────────────────────────────────────────────

const stale = computed(() => result.value !== null && ranSource.value !== filled.value.source)

/** 报错时这一行上有哪几个空（「第 2 个空：新的步长」），起点这一轮和换起点的几轮都用它 */
const blankAt = (line: number) => blanksByLine.value.get(line)?.join('、') ?? null

const explained = computed<ExplainedError | null>(() => {
  const e = result.value?.error
  return e ? explainPythonError(e, blankAt) : null
})

/** 出错的位置：代码改过了就不标（行号可能对不上） */
const errorAt = computed(() => {
  const e = result.value?.error
  return e?.line && !stale.value ? { line: e.line, col: e.col ?? 1 } : null
})
const marks = computed(() => ({ error: errorAt.value, step: null }))
watch(marks, (value) => editor?.setMarks(value))

const percent = computed(() => {
  const p = progress.value
  return p && p.total > 0 ? Math.min(100, Math.floor((p.loaded / p.total) * 100)) : 0
})
const loadingText = computed(() => {
  const p = progress.value
  if (p && p.loaded >= p.total) return '下载完了，正在启动 Python……'
  return `正在下载 Python 运行环境：${percent.value}%`
})

const status = computed(() => {
  if (phase.value === 'loading') return { tone: '', text: loadingText.value }
  if (phase.value === 'running' && sweep.value) {
    return { tone: '', text: `你的 Agent 交卷了。同一份代码换起点再跑：${sweep.value.done} / ${sweep.value.total}……` }
  }
  if (phase.value === 'running') return { tone: '', text: `你的 Agent 正在模拟器上调参：已经走了 ${steps.value.length} 步……` }
  if (runProblem.value) return { tone: 'bad', text: runProblem.value }
  if (loadFailed.value) return { tone: 'bad', text: `Python 没有加载出来：${loadFailed.value}。` }
  const r = result.value
  if (!r) return { tone: '', text: '把虚线框里的三个空补好，再点「运行我的 Agent」。' }
  const again = stale.value ? '代码改过了，再运行一次看新的结果。' : ''
  const n = r.steps.length
  if (r.verdict) {
    const { earned, config } = r.verdict
    return { tone: earned.every(Boolean) ? 'good' : '', text: `你的 Agent 用了 ${n} 步交卷：${describeConfig(config)}，拿到 ${earned.filter(Boolean).length} 颗星（${starText(earned)}）。${again}` }
  }
  if (r.stop === 'limit') return { tone: 'bad', text: `${n} 步用完了，你的 Agent 还没有交卷：不交卷就没有分。看看它是不是在原地打转，参数一直没变。${again}` }
  if (r.stop === 'end') return { tone: 'bad', text: `程序跑完了，可是没有调用 finish 交卷：不交卷就没有分。${again}` }
  const where = r.error?.line ? `第 ${r.error.line} 行出错了` : '代码出错了'
  return { tone: 'bad', text: `${where}，你的 Agent 停在了第 ${n} 步：看下面「这次的问题」。${again}` }
})

/** 交卷以后，和规则 Agent 那一轮比一比 */
const comparison = computed(() => {
  const r = result.value
  if (!r || r.stop === 'error') return []
  const rule = r.rule.verdict
    ? `规则 Agent 从同一个起点用了 ${r.rule.steps} 步交卷：${describeConfig(r.rule.verdict.config)}，拿到 ${r.rule.verdict.earned.filter(Boolean).length} 颗星（${starText(r.rule.verdict.earned)}）。`
    : `规则 Agent 从同一个起点走满了 ${r.rule.steps} 步，没有交卷。`
  const matches = r.steps.filter((s) => s.same).length
  const same = matches === r.steps.length && r.steps.length === r.rule.steps
    ? '你的 Agent 每一步都和它选得一样。'
    : `你的 Agent 走的 ${r.steps.length} 步里，有 ${matches} 步和它选得一样。`
  return [rule, same]
})

/** 换起点再跑的一句：几个起点交出了三颗星的参数，第一个没交出的是哪个、怎么了 */
const sweepText = computed(() => {
  const runs = variantRuns.value
  if (!runs.length) return ''
  const total = props.variants?.length ?? runs.length
  const full = runs.filter((v) => v.verdict?.earned.every(Boolean)).length
  const head = `同一份代码换了 ${total} 个起点再跑：${full} 个交出了三颗星的参数`
  const miss = runs.find((v) => !v.verdict?.earned.every(Boolean))
  const cut = runs.length < total ? `，后面 ${total - runs.length} 个没有再跑` : ''
  if (!miss) return `${head}${cut}。`
  const what = miss.verdict
    ? `交了 ${describeConfig(miss.verdict.config)}（${starText(miss.verdict.earned)}）。`
    : miss.stop === 'limit'
      ? `走满 ${miss.steps} 步没有交卷。`
      : miss.stop === 'end'
        ? '没有交卷就跑完了。'
        : miss.error?.symptom ?? '出错停下了。'
  return `${head}${cut}。比如从 ${describeConfig(miss.start)} 出发：${what}`
})

/** 一步要显示的几行：行动、观察写成函数调用和一行 JSON（逗号后面空一格，窄屏上能折行） */
const rows = computed(() => steps.value.map((s, index) => ({
  index,
  thought: s.thought,
  action: formatAction(s.action),
  text: s.observation.text,
  json: `{ ${Object.entries(s.observation.data).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ')} }`,
  same: s.same,
  rule: formatAction(s.rule.action),
})))

const logBox = ref<HTMLElement | null>(null)
const logScrolls = ref(false)
// 记录框跟着最新的一步滚到底
watch(steps, async () => {
  await nextTick()
  const box = logBox.value
  if (!box) {
    logScrolls.value = false
    return
  }
  box.scrollTop = box.scrollHeight
  logScrolls.value = box.scrollHeight > box.clientHeight + 1
})

function jumpTo(line: number, col: number) {
  if (editor) {
    editor.focusAt(line, col)
    return
  }
  const row = root.value?.querySelector<HTMLElement>(`[data-line="${line}"]`)
  row?.scrollIntoView({ block: 'nearest' })
  row?.querySelector<HTMLElement>('input, select')?.focus()
}

const downloadNote = `第一次运行要下载 Python 运行环境（约 ${megabytes(PYODIDE_BYTES)}，只下载一次）；不点运行就不会下载。`

// ── 挂载 ────────────────────────────────────────────────────────────────

let media: MediaQueryList | null = null
let observer: IntersectionObserver | null = null
function onMedia() {
  narrow.value = Boolean(media?.matches)
}

watch([mounted, nearView, narrow, editorFailed, template], () => void syncEditor())

onMounted(() => {
  media = window.matchMedia('(max-width: 767px)')
  media.addEventListener('change', onMedia)
  narrow.value = media.matches
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
  client?.dispose()
  client = null
  editorTicket++
  editor?.destroy()
  editor = null
  observer?.disconnect()
  media?.removeEventListener('change', onMedia)
})
</script>

<template>
  <div ref="root" class="hg-agentcode">
    <section class="hg-agentcode__card" :aria-labelledby="`${uid}-title`">
      <header class="hg-agentcode__head">
        <span class="hg-agentcode__eyebrow" aria-hidden="true">AGENT</span>
        <h3 :id="`${uid}-title`" class="hg-agentcode__title">{{ title }}</h3>
        <span class="hg-agentcode__mode">Python · 填空</span>
      </header>

      <p v-if="problem" class="hg-agentcode__problem" role="alert" data-hg-content-error>{{ problem }}</p>

      <template v-if="activeTask && starter">
        <div class="hg-agentcode__task">
          <p class="hg-agentcode__goal">{{ activeTask.goal }}</p>
          <ol class="hg-agentcode__stars" aria-label="三星标准">
            <li v-for="(text, k) in activeTask.stars" :key="k">
              <span class="hg-agentcode__star" aria-hidden="true">★{{ k + 1 }}</span>
              <span class="hg-agentcode__sr">第 {{ k + 1 }} 颗星：</span>{{ text }}
            </li>
          </ol>
          <p class="hg-agentcode__meta">起点：{{ describeConfig(activeTask.start) }} · 一轮最多 {{ limit }} 步 · 周期数、车次都是模拟值</p>
        </div>

        <!-- 代码区在亮暗主题下都是深色（01 第 2.4 节）：里面的错误色、焦点色取暗色那一套 -->
        <div class="hg-agentcode__code" data-hg-theme="dark">
          <p class="hg-agentcode__bar">
            <span class="hg-agentcode__file">{{ starter.file }}.py</span>
            <span class="hg-agentcode__count">{{ template?.blanks.length ?? 0 }} 个空</span>
          </p>
          <div class="hg-agentcode__body">
            <div ref="host" class="hg-agentcode__editor" />
            <div v-if="!editorReady" class="hg-agentcode__static" role="group" aria-label="Agent 的 Python 代码" translate="no">
              <div
                v-for="(line, n) in lines"
                :key="n"
                class="hg-agentcode__line"
                :class="{ 'is-error': errorAt?.line === n + 1 }"
                :data-line="n + 1"
              >
                <span class="hg-agentcode__ln" aria-hidden="true">{{ n + 1 }}</span>
                <span class="hg-agentcode__lc"><template
                  v-for="(seg, k) in line"
                  :key="seg.kind === 'blank' ? `b-${seg.name}` : `t-${k}`"
                ><span v-if="seg.kind === 'text'" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span><span
                  v-else-if="narrow"
                  class="hg-agentcode__choice"
                ><select
                  class="hg-agentcode__blank"
                  :value="seg.text"
                  :aria-label="blankLabel(seg.name)"
                  :data-blank="seg.name"
                  :style="{ width: `${Math.max(seg.text.length, 3)}ch` }"
                  @change="edit({ [seg.name]: ($event.target as HTMLSelectElement).value })"
                ><option v-for="choice in choicesFor(seg.name, seg.text)" :key="choice" :value="choice">{{ choice || '（空着）' }}</option></select></span><input
                  v-else
                  class="hg-agentcode__blank"
                  type="text"
                  :value="seg.text"
                  :aria-label="blankLabel(seg.name)"
                  :data-blank="seg.name"
                  :style="{ width: `${Math.max(seg.text.length, 3) + 2}ch` }"
                  :disabled="!mounted"
                  autocapitalize="off"
                  autocomplete="off"
                  autocorrect="off"
                  spellcheck="false"
                  @input="edit({ [seg.name]: ($event.target as HTMLInputElement).value })"
                  @keydown.enter.prevent="runMine"
                ></template></span>
              </div>
            </div>
          </div>
        </div>

        <p class="hg-agentcode__legend">
          工具：<code translate="no">run_kernel</code> 跑一次、<code translate="no">measure</code> 计时、<code translate="no">inspect_memory</code> 看访存、<code translate="no">finish</code> 交卷，都要给 <code translate="no">block</code> 和 <code translate="no">stride</code>，给回来的字典就是观察；<code translate="no">think("…")</code> 写下想法，记在下一步前面。
        </p>

        <div class="hg-agentcode__actions">
          <button
            v-if="phase === 'idle'"
            type="button"
            class="hg-agentcode__button is-primary"
            :disabled="!mounted"
            @click="runMine"
          >运行我的 Agent</button>
          <button v-else type="button" class="hg-agentcode__button is-primary" @click="client?.stop()">停下</button>
          <button type="button" class="hg-agentcode__button" :disabled="!mounted || phase !== 'idle'" @click="reset">重置</button>
          <button type="button" class="hg-agentcode__button" :aria-expanded="showReplay" @click="showReplay = !showReplay">
            {{ showReplay ? '收起规则 Agent 的回放' : '看规则 Agent 的回放' }}
          </button>
          <span class="hg-agentcode__keys">在代码里按 Ctrl + Enter（Mac 上是 Cmd + Enter）也能运行</span>
        </div>

        <p v-if="phase === 'idle' && !downloaded && !loadFailed" class="hg-agentcode__note">{{ downloadNote }}</p>
        <div v-if="phase === 'loading'" class="hg-agentcode__loading">
          <!-- 不写 value 就是不确定进度：启动 Python 那一段数不出进度 -->
          <progress
            v-if="progress && progress.loaded < progress.total"
            class="hg-agentcode__progress"
            max="100"
            :value="percent"
            :aria-valuetext="loadingText"
            aria-label="下载 Python 运行环境"
          />
          <progress v-else class="hg-agentcode__progress" :aria-valuetext="loadingText" aria-label="启动 Python" />
        </div>

        <p class="hg-agentcode__status" :class="status.tone ? `is-${status.tone}` : undefined">
          <span role="status">{{ status.text }}</span>
          <button v-if="errorAt && explained" type="button" class="hg-agentcode__link" @click="jumpTo(errorAt.line, errorAt.col)">
            跳到第 {{ errorAt.line }} 行
          </button>
        </p>
        <p v-if="notice" class="hg-agentcode__notice">
          <span role="status">{{ notice }}</span>
          <button v-if="undo" type="button" class="hg-agentcode__link" @click="undoReset">撤销</button>
        </p>

        <div v-if="explained" class="hg-agentcode__error">
          <p class="hg-agentcode__error-title">这次的问题</p>
          <dl>
            <div><dt>现象</dt><dd>{{ explained.symptom }}</dd></div>
            <div><dt>原因</dt><dd>{{ explained.cause }}</dd></div>
            <div><dt>怎么改</dt><dd>{{ explained.fix }}</dd></div>
          </dl>
          <details class="hg-agentcode__raw">
            <summary>Python 的原文</summary>
            <pre translate="no"><code>{{ explained.raw }}</code></pre>
          </details>
        </div>

        <ol
          v-if="rows.length"
          ref="logBox"
          class="hg-agentcode__log"
          :tabindex="logScrolls ? 0 : undefined"
          :aria-label="logScrolls ? '你的 Agent 走过的步（可以滚动）' : '你的 Agent 走过的步'"
        >
          <li v-for="row in rows" :key="row.index" class="hg-agentcode__step">
            <p class="hg-agentcode__step-head">
              <span>第 {{ row.index + 1 }} 步</span>
              <span class="hg-agentcode__match" :class="row.same ? 'is-same' : 'is-diff'">
                <template v-if="row.same">✓ 和规则 Agent 一样</template>
                <template v-else>≠ 规则 Agent 会选 <code translate="no">{{ row.rule }}</code></template>
              </span>
            </p>
            <div v-if="row.thought" class="hg-agentcode__row is-thought">
              <span class="hg-agentcode__tag">思考</span>
              <p class="hg-agentcode__text">{{ row.thought }}</p>
            </div>
            <div class="hg-agentcode__row is-action">
              <span class="hg-agentcode__tag">行动</span>
              <p class="hg-agentcode__text"><code class="hg-agentcode__call" translate="no">{{ row.action }}</code></p>
            </div>
            <div class="hg-agentcode__row is-observation">
              <span class="hg-agentcode__tag">观察</span>
              <div class="hg-agentcode__text">
                <p>{{ row.text }}</p>
                <code class="hg-agentcode__json" translate="no">{{ row.json }}</code>
              </div>
            </div>
          </li>
        </ol>

        <div v-if="comparison.length" class="hg-agentcode__result">
          <p v-for="(line, k) in comparison" :key="k">{{ line }}</p>
          <p v-if="sweepText">{{ sweepText }}</p>
        </div>

        <details v-if="result?.output.length" class="hg-agentcode__output">
          <summary>程序打印的内容（{{ result.output.length }} 行{{ result.truncated ? '，后面的没留下' : '' }}）</summary>
          <pre translate="no"><code>{{ result.output.join('\n') }}</code></pre>
        </details>

        <div v-if="loadFailed" class="hg-agentcode__fallback">
          <p>不用 Python 也能学完这一关：下面是规则 Agent 从同一个起点走的一轮。三个空都补对以后，你的 Agent 每一步都会和它一样。</p>
          <button type="button" class="hg-agentcode__button" @click="retry">再试一次加载 Python</button>
        </div>

        <div v-if="showReplay" class="hg-agentcode__replay">
          <AgentConsole :task="task" :start="activeTask.start" :max-steps="limit" :reader="false" />
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.hg-agentcode {
  margin: 20px 0;
}

.hg-agentcode__card {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 18px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.hg-agentcode__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.hg-agentcode__eyebrow {
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-agentcode__title {
  margin: 0;
  padding: 0;
  border: 0;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  letter-spacing: 0;
}

.hg-agentcode__mode {
  margin-left: auto;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-agentcode__problem {
  margin: 0;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

/* ── 任务和星级标准（和 Agent 控制台一样） ── */

.hg-agentcode__task {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hg-agentcode__task p,
.hg-agentcode__legend,
.hg-agentcode__note {
  margin: 0;
}

.hg-agentcode__goal {
  font-family: var(--hg-font-display);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.5;
}

.hg-agentcode__stars {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.6;
}

.hg-agentcode__star {
  display: inline-block;
  min-width: 2.6em;
  color: var(--hg-amber-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

.hg-agentcode__meta,
.hg-agentcode__note,
.hg-agentcode__keys {
  color: var(--hg-ink-3);
  font-size: 13px;
  line-height: 1.6;
}

/* ── 代码区（和代码沙盒一样） ── */

.hg-agentcode__code {
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-code-dot);
  border-radius: 14px;
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.hg-agentcode__bar {
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

.hg-agentcode__file,
.hg-agentcode__count {
  color: var(--hg-code-file);
}

.hg-agentcode__body {
  position: relative;
  overflow-x: auto;
}

.hg-agentcode__body:focus-within {
  box-shadow: inset 0 0 0 2px var(--hg-accent-ink);
}

.hg-agentcode__body:has(.hg-agentcode__blank:focus-visible) {
  box-shadow: none;
}

/* 编辑器（CodeMirror）的样式在 sandbox/editor.ts 里；没有编辑器时这一层是空的 */
.hg-agentcode__editor:empty {
  display: none;
}

/* 不加载编辑器时的代码：字号、行高、行号宽度和编辑器一样，换成编辑器时不跳 */
.hg-agentcode__static {
  min-width: max-content;
  padding: 12px 0;
  font-family: var(--hg-font-mono);
  font-size: 14px;
  line-height: 1.85;
}

.hg-agentcode__line {
  display: flex;
  white-space: pre;
}

.hg-agentcode__ln {
  position: relative;
  flex: none;
  box-sizing: border-box;
  min-width: calc(2ch + 32px);
  padding: 0 10px 0 22px;
  color: var(--hg-code-line-number);
  text-align: right;
  user-select: none;
}

.hg-agentcode__lc {
  padding: 0 18px 0 6px;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

.hg-agentcode__line.is-error {
  background: var(--hg-error-soft);
}

/* 出错的行在行号旁有「!」（不只靠颜色，01 第 7 节） */
.hg-agentcode__line.is-error .hg-agentcode__ln::before {
  content: '!';
  position: absolute;
  left: 4px;
  width: 14px;
  color: var(--hg-error-ink);
  font-weight: 700;
  text-align: center;
}

/* 空：虚线框 + 读者要改的表达式的颜色（01 第 2.4 节），不只靠颜色 */
.hg-agentcode__blank {
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

.hg-agentcode__choice {
  position: relative;
  display: inline-block;
}

.hg-agentcode__choice::after {
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

select.hg-agentcode__blank {
  appearance: none;
  padding-right: 1.7em;
  cursor: pointer;
}

.hg-agentcode__blank option {
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.hg-agentcode__blank:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

.hg-agentcode__legend {
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.7;
}

.hg-agentcode__legend code,
.hg-agentcode__match code {
  padding: 1px 5px;
  border-radius: 6px;
  background: var(--hg-surface-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
}

/* ── 按钮、进度和状态 ── */

.hg-agentcode__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}

.hg-agentcode__button {
  min-height: 42px;
  padding: 0 18px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节） */
.hg-agentcode__button.is-primary {
  min-width: 8em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-agentcode__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.hg-agentcode__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-agentcode__button:focus-visible,
.hg-agentcode__link:focus-visible,
.hg-agentcode__log:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-agentcode__progress {
  display: block;
  width: 100%;
  height: 10px;
  accent-color: var(--hg-accent);
}

.hg-agentcode__status,
.hg-agentcode__notice {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.6;
}

.hg-agentcode__status.is-good {
  color: var(--hg-accent-ink);
}

.hg-agentcode__status.is-bad {
  color: var(--hg-error-ink);
}

.hg-agentcode__notice {
  color: var(--hg-amber-ink);
  font-size: 14px;
}

.hg-agentcode__link {
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

/* ── 报错：现象、原因、怎么改（和代码沙盒一样） ── */

.hg-agentcode__error {
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
}

.hg-agentcode__error-title {
  margin: 0 0 6px;
  color: var(--hg-error-ink);
  font-weight: 700;
}

.hg-agentcode__error dl {
  display: grid;
  gap: 4px;
  margin: 0;
}

.hg-agentcode__error dl > div {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 8px;
}

.hg-agentcode__error dt {
  color: var(--hg-ink-2);
  font-weight: 600;
}

.hg-agentcode__error dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.hg-agentcode__raw,
.hg-agentcode__output {
  margin-top: 8px;
}

.hg-agentcode__raw summary,
.hg-agentcode__output summary {
  color: var(--hg-ink-2);
  font-size: 14px;
  cursor: pointer;
}

.hg-agentcode__raw pre,
.hg-agentcode__output pre {
  margin: 8px 0 0;
  padding: 10px 14px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ── 走过的步：一步一块，思考、行动、观察三种标签形状各不相同（和 Agent 控制台一样） ── */

.hg-agentcode__log {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 30rem;
  margin: 0;
  padding: 2px;
  overflow-y: auto;
  list-style: none;
  overscroll-behavior: contain;
}

.hg-agentcode__step {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
}

.hg-agentcode__step-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
}

.hg-agentcode__match {
  font-family: var(--hg-font-body);
  font-size: 13px;
}

.hg-agentcode__match.is-same {
  color: var(--hg-accent-ink);
}

.hg-agentcode__match.is-diff {
  color: var(--hg-amber-ink);
}

.hg-agentcode__row {
  display: grid;
  grid-template-columns: 5.6rem minmax(0, 1fr);
  gap: 4px 10px;
  align-items: start;
  padding: 2px 0 2px 8px;
}

@container (max-width: 460px) {
  .hg-agentcode__row {
    grid-template-columns: minmax(0, 1fr);
  }

  .hg-agentcode__tag {
    justify-self: start;
  }
}

.hg-agentcode__tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 8px;
  border: var(--hg-border-width) solid transparent;
  border-radius: var(--hg-radius-tag);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}

.is-thought > .hg-agentcode__tag {
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  color: var(--hg-ink-2);
}

.is-action > .hg-agentcode__tag {
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.is-observation > .hg-agentcode__tag {
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

.hg-agentcode__text {
  min-width: 0;
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
}

.hg-agentcode__text p {
  margin: 0;
}

.is-thought .hg-agentcode__text {
  color: var(--hg-ink-2);
}

.hg-agentcode__call,
.hg-agentcode__json {
  font-family: var(--hg-font-mono);
  overflow-wrap: anywhere;
}

.hg-agentcode__call {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font-size: 13px;
}

.hg-agentcode__json {
  display: block;
  margin-top: 4px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

/* ── 结果、退化 ── */

.hg-agentcode__result,
.hg-agentcode__fallback {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  font-size: 14px;
  line-height: 1.7;
}

.hg-agentcode__result p,
.hg-agentcode__fallback p {
  margin: 0;
}

.hg-agentcode__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 767px) {
  .hg-agentcode__card {
    padding: 16px 14px;
  }

  .hg-agentcode__keys {
    display: none;
  }
}
</style>
