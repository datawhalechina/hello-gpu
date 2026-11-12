<script setup lang="ts">
/**
 * Agent 控制台（A-01；03 第 3 节组件登记表，02 第 1–4 节，01 第 7 节）。
 *
 * 逐条显示 Agent 的「思考 → 行动 → 观察」。两种模式：
 * - 看规则 Agent（默认）：挂载后在模拟器上把规则 Agent 跑完一轮（docs/course/agent/），再一条一条放出来：
 *   播放、暂停、上一条、下一条、从头、跳到最后、拖动进度条。一步是三条：思考、行动、观察。
 * - 你来当 Agent：读者每一步选一个工具和一组参数，执行后看观察；同时写出规则 Agent 面对同样的历史会选什么，
 *   标明和读者选的一样不一样。交卷或者步数用完就结束，最后和规则 Agent 那一轮比一比。
 *
 * 用法（全局注册，Markdown 里直接写）：
 *   <AgentConsole />                                    向量加法，起点 block 48、步长 4
 *   <AgentConsole :start="{ block: 100, stride: 8 }" />  换一个起点
 *   <AgentConsole :reader="false" :max-steps="6" />     只放规则 Agent（关卡的 Agent 支线），最多 6 步
 *   <AgentConsole mode="reader" @finish="onFinish" />   一开始就让读者当 Agent；读者这一轮结束时发 finish：
 *     { steps, stop: 'finish' | 'limit', verdict, matches, rule, log, restored }，verdict 是交卷的评分（没交卷是 null），
 *     matches 是和规则 Agent 选得一样的步数，rule 是规则 Agent 那一轮的 { steps, stop, verdict }，
 *     log 是读者走的每一步（行动、观察、规则 Agent 会怎么选），restored 见下面的 v-model:actions
 *   <AgentConsole :replay="false" v-model:actions="draft" @finish="onFinish" />
 *     只让读者当 Agent（关卡的挑战：不放规则 Agent 那一轮，它的走法要读者自己走出来）。
 *     v-model:actions 是读者这一轮的行动：每走一步、点「再来一次」都会更新，关卡把它存进草稿槽；
 *     刷新以后传回来，控制台照着重新走一遍（模拟是确定的），走完了就再发一次 finish，restored 是 true
 *     （关卡拿它画出上次的结果，不算一次新的尝试）
 *
 * - 工具在 Web Worker 里跑模拟器（docs/sim/client.ts）；Agent 的规则和示意计时（L3、L4）挂载后才加载，首屏不带。
 * - 两种写法跑出来的观察完全一样（单测逐项核对），控制台固定跑 HIP 写法的 kernel；页面上的代码照常按写法偏好显示。
 * - 键盘：看规则 Agent 时，焦点在控制台上按 ← → 换一条，空格播放或暂停，Home 回到开头，End 跳到最后；
 *   按钮、进度条、旋钮都是原生控件，你来当 Agent 全程只用 Tab、方向键和回车。
 * - 自动播放离开视口、切到别的标签页就暂停；每条停多久按 02 第 2 节的讲解节奏（1500 ms + 每字 60 ms，最多 8 s）。
 *   减弱动效下新的一条直接出现，不淡入。
 * - 状态不只靠颜色：每一条前面写着「思考」「行动」「观察」，和规则 Agent 一样不一样写着「✓ 一样」「≠ 不一样」。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useData } from 'vitepress'
import { createSimClient, type SimClient } from '@sim/client.ts'
import {
  formatAction, MAX_STEPS, runAgent, sameAction, starText, TOOLS,
  type AgentAction, type AgentEnv, type AgentStep, type Decision, type Episode, type Observation, type Policy, type Verdict,
} from '@course/agent/react.ts'
import { describeConfig, TUNE_TASKS, tuneTask, type TuneConfig, type TuneTask } from '@course/agent/tasks.ts'
import type { Runner } from '@course/agent/tools.ts'
import { contentError } from './contentError.ts'
import Knob from './Knob.vue'

type View = 'replay' | 'reader'

/** 读者这一步：行动、观察，以及规则 Agent 面对同样的历史会怎么选。 */
interface ReaderStep extends AgentStep {
  rule: Decision
  same: boolean
}

interface ReaderSummary {
  steps: number
  stop: 'finish' | 'limit'
  verdict: Verdict | null
  matches: number
  rule: { steps: number; stop: Episode['stop']; verdict: Verdict | null } | null
  /** 读者走的每一步：行动、观察、规则 Agent 会怎么选（思考是空的：读者只选行动） */
  log: ReaderStep[]
  /** true：按存下的行动重新走出来的（刷新以后还原），不是读者刚走完的 */
  restored: boolean
}

interface Runtime {
  createEnv: (task: TuneTask, runner: Runner) => AgentEnv
  rulePolicy: Policy
}

const props = withDefaults(defineProps<{
  /** 任务 id（docs/course/agent/tasks.ts 的 TUNE_TASKS） */
  task?: string
  /** 起点，要从任务的可选值里选；不写用任务自己的起点 */
  start?: TuneConfig | null
  /** 一轮最多几步 */
  maxSteps?: number
  /** 一开始显示哪一种：replay 看规则 Agent，reader 你来当 Agent */
  mode?: View
  /** 有没有「你来当 Agent」；只放规则 Agent 时写 false */
  reader?: boolean
  /** 有没有「看规则 Agent」；只让读者当 Agent 时写 false（规则 Agent 照样在后台走一轮，最后拿来比） */
  replay?: boolean
  /** 读者这一轮的行动（v-model:actions）；和控制台手上的不一样时，照着重新走一遍 */
  actions?: readonly AgentAction[] | null
}>(), {
  task: 'vector-add',
  start: null,
  maxSteps: MAX_STEPS,
  mode: 'replay',
  reader: true,
  replay: true,
  actions: null,
})

const emit = defineEmits<{ finish: [summary: ReaderSummary]; 'update:actions': [actions: AgentAction[]] }>()

/** 02 第 2 节：讲解每一条停 1500 ms + 每字 60 ms，最多 8 s（tokens.css 的 --motion-step-*） */
const BEAT_BASE_MS = 1500
const BEAT_CHAR_MS = 60
const BEAT_MAX_MS = 8000
const PARTS = ['思考', '行动', '观察'] as const

const { page } = useData()
const root = ref<HTMLElement | null>(null)
const logBox = ref<HTMLElement | null>(null)
const logScrolls = ref(false)

// ── 任务和起点 ───────────────────────────────────────────────────────────

/** 登记表里的任务；task 写错了是 null */
const listed = computed(() => tuneTask(props.task))
const problem = computed(() => {
  const t = listed.value
  if (!t) return contentError(`AgentConsole 的 task 写成了「${props.task}」，可选的是 ${Object.keys(TUNE_TASKS).join('、')}。`, page.value.relativePath)
  const s = props.start
  if (s && (!t.blocks.includes(s.block) || !t.strides.includes(s.stride))) {
    return contentError(`AgentConsole 的 start 要从可选值里选：block 是 ${t.blocks.join(' / ')}，stride 是 ${t.strides.join(' / ')}；现在是 ${JSON.stringify(s)}。`, page.value.relativePath)
  }
  if (!Number.isInteger(props.maxSteps) || props.maxSteps < 1) {
    return contentError(`AgentConsole 的 max-steps 要是正整数，现在是 ${String(props.maxSteps)}。`, page.value.relativePath)
  }
  if (!props.reader && !props.replay) {
    return contentError('AgentConsole 的 reader 和 replay 不能都写 false：至少留一种模式。', page.value.relativePath)
  }
  return ''
})
// 拆成两个数再拼：父组件每次渲染传一个新的 { block, stride } 对象时，数没变就不重跑
const startBlock = computed(() => props.start?.block ?? listed.value?.start.block ?? 0)
const startStride = computed(() => props.start?.stride ?? listed.value?.start.stride ?? 0)
/** 这次用的任务：起点换成 start；写错了是 null */
const activeTask = computed<TuneTask | null>(() => (listed.value && !problem.value
  ? { ...listed.value, start: { block: startBlock.value, stride: startStride.value } }
  : null))
const limit = computed(() => (problem.value ? MAX_STEPS : props.maxSteps))

// ── 模拟器和 Agent 的代码：挂载后才加载 ─────────────────────────────────────

const runtime = shallowRef<Runtime | null>(null)
const loadError = ref('')
const env = shallowRef<AgentEnv | null>(null)
let client: SimClient | null = null

function simProblem(err: unknown): string {
  const e = err as Error
  return e?.name === 'TimeoutError' ? '模拟器跑得太久，已经停下。刷新页面再试一次。' : `模拟器没跑起来：${e?.message ?? String(err)}`
}

// ── 看规则 Agent ────────────────────────────────────────────────────────

/** 能显示哪一种：没有「你来当 Agent」就只看规则 Agent，没有「看规则 Agent」就只当 Agent */
function allowedView(v: View): View {
  if (!props.reader) return 'replay'
  if (!props.replay) return 'reader'
  return v
}

const view = ref<View>(allowedView(props.mode))
const episode = shallowRef<Episode | null>(null)
const replayError = ref('')
/** 放出来了几条：0 是还没开始，每一步三条 */
const position = ref(0)
const playing = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
let generation = 0

const steps = computed(() => episode.value?.steps ?? [])
const beats = computed(() => steps.value.length * 3)
const replayReady = computed(() => view.value === 'replay' && episode.value !== null)

function beatText(b: number): string {
  const s = steps.value[Math.floor(b / 3)]
  if (!s) return ''
  const part = b % 3
  return part === 0 ? s.thought : part === 1 ? formatAction(s.action) : s.observation.text
}

function clearTimer() {
  if (timer !== null) clearTimeout(timer)
  timer = null
}
function pause() {
  playing.value = false
  clearTimer()
}
/** 刚放出来的那条读完再放下一条 */
function schedule() {
  clearTimer()
  const wait = Math.min(BEAT_MAX_MS, BEAT_BASE_MS + beatText(position.value - 1).length * BEAT_CHAR_MS)
  timer = setTimeout(() => {
    timer = null
    if (!playing.value) return
    position.value = Math.min(position.value + 1, beats.value)
    if (position.value >= beats.value) pause()
    else schedule()
  }, wait)
}
function play() {
  if (!beats.value) return
  if (position.value >= beats.value) position.value = 0
  playing.value = true
  position.value += 1
  if (position.value >= beats.value) pause()
  else schedule()
}
function go(to: number) {
  pause()
  position.value = Math.max(0, Math.min(to, beats.value))
}

/** 在模拟器上把规则 Agent 跑完一轮。换了任务、起点、步数上限就重跑；旧的那次跑完也不要了。 */
async function runReplay() {
  const e = env.value
  const rt = runtime.value
  const mine = ++generation
  pause()
  episode.value = null
  position.value = 0
  replayError.value = ''
  if (!e || !rt) return
  try {
    const ep = await runAgent(e, rt.rulePolicy, { maxSteps: limit.value })
    if (mine === generation) episode.value = ep
  } catch (err) {
    if (mine === generation && (err as Error)?.name !== 'AbortError') replayError.value = simProblem(err)
  }
}

/** 放出来的步，每步放到第几条 */
const shown = computed(() => {
  const out: { index: number; step: AgentStep; parts: number }[] = []
  steps.value.forEach((step, index) => {
    const parts = Math.min(3, position.value - index * 3)
    if (parts > 0) out.push({ index, step, parts })
  })
  return out
})

const playLabel = computed(() => (playing.value ? '暂停' : position.value >= beats.value && beats.value ? '重新播放' : '播放'))

const caption = computed(() => {
  const n = steps.value.length
  if (position.value === 0) return `还没开始：规则 Agent 这一轮走了 ${n} 步，每一步都是思考、行动、观察三条。点「播放」或「下一条」。`
  const b = position.value - 1
  return `第 ${Math.floor(b / 3) + 1} / ${n} 步 · ${PARTS[b % 3]}`
})

function episodeLine(ep: Pick<Episode, 'steps' | 'stop' | 'verdict'>, who: string): string {
  const v = ep.verdict
  if (!v) return `${who}走满了 ${ep.steps.length} 步，没有交卷。`
  return `${who}用了 ${ep.steps.length} 步交卷：${describeConfig(v.config)}，拿到 ${v.earned.filter(Boolean).length} 颗星（${starText(v.earned)}）。`
}

const ended = computed(() => episode.value !== null && beats.value > 0 && position.value >= beats.value)
const ruleLine = computed(() => (episode.value ? episodeLine(episode.value, '规则 Agent ') : ''))

// ── 你来当 Agent ────────────────────────────────────────────────────────

const readerSteps = shallowRef<ReaderStep[]>([])
const form = reactive({ tool: 'run_kernel', block: 0, stride: 0 })
const busy = ref(false)
/** 正在按传进来的行动重新走一遍（v-model:actions） */
const restoring = ref(false)
const readerError = ref('')
/** 刚还原出来的一轮：读屏先不播报（页面一打开就念一段观察会吓人），读者再走一步才接着播报 */
const quiet = ref(false)
/** 每清空一次加一：还原到一半时清空了、或者又换了一份行动，旧的那次走完也不要了 */
let readerGeneration = 0

const TOOL_OPTIONS = TOOLS.map((t) => ({ value: t.name, label: t.label }))
const toolSummary = computed(() => TOOLS.find((t) => t.name === form.tool)?.summary ?? '')
const pending = computed<AgentAction>(() => ({ tool: form.tool, args: { block: form.block, stride: form.stride } }))
const readerVerdict = computed(() => readerSteps.value.at(-1)?.observation.verdict ?? null)
const readerDone = computed(() => readerVerdict.value !== null || readerSteps.value.length >= limit.value)

function resetReader() {
  readerGeneration++
  restoring.value = false
  readerSteps.value = []
  readerError.value = ''
  quiet.value = false
  form.tool = 'run_kernel'
  form.block = startBlock.value
  form.stride = startStride.value
}

/** 「再来一次」：清空这一轮，也告诉 v-model:actions。 */
function restart() {
  resetReader()
  emit('update:actions', [])
}

/** 读者这一轮的行动，复制一份交出去：外面存进草稿、改了它，也改不到这里的记录。 */
function actionsOf(list: readonly ReaderStep[]): AgentAction[] {
  return list.map((s) => ({ tool: s.action.tool, args: { ...s.action.args } }))
}

function sameActions(a: readonly AgentAction[], b: readonly AgentAction[]): boolean {
  return a.length === b.length && a.every((x, i) => sameAction(x, b[i]))
}

const readerSummary = computed<Omit<ReaderSummary, 'restored'> | null>(() => {
  if (!readerDone.value) return null
  const list = readerSteps.value
  const ep = episode.value
  return {
    steps: list.length,
    stop: readerVerdict.value ? 'finish' : 'limit',
    verdict: readerVerdict.value,
    matches: list.filter((s) => s.same).length,
    rule: ep ? { steps: ep.steps.length, stop: ep.stop, verdict: ep.verdict } : null,
    log: list,
  }
})

/** 走一步：先问规则 Agent（只看到目前为止的历史），再执行读者选的。 */
async function stepWith(e: AgentEnv, rt: Runtime, before: readonly ReaderStep[], action: AgentAction): Promise<ReaderStep> {
  const rule = await rt.rulePolicy({ task: e.task, steps: before.slice(), maxSteps: limit.value })
  const observation: Observation = await e.act(action)
  return { thought: '', action, observation, rule, same: sameAction(rule.action, action) }
}

async function readerAct() {
  const e = env.value
  const rt = runtime.value
  if (!e || !rt || busy.value || restoring.value || readerDone.value) return
  const action = pending.value
  const before = readerSteps.value
  const mine = readerGeneration
  busy.value = true
  readerError.value = ''
  try {
    const step = await stepWith(e, rt, before, action)
    if (env.value !== e || mine !== readerGeneration) return
    readerSteps.value = [...before, step]
    quiet.value = false
    emit('update:actions', actionsOf(readerSteps.value))
    if (readerSummary.value) emit('finish', { ...readerSummary.value, restored: false })
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') readerError.value = simProblem(err)
  } finally {
    busy.value = false
  }
}

/**
 * 照着传进来的行动重新走一遍（v-model:actions；刷新以后还原草稿）。模拟是确定的，走出来的观察和上次一样。
 * 交卷或者走满步数就停，多出来的行动不要；走完了发一次 finish（restored），关卡拿它画出上次的结果。
 */
async function restoreReader(list: readonly AgentAction[]) {
  const e = env.value
  const rt = runtime.value
  if (!e || !rt) return
  resetReader()
  const mine = readerGeneration
  restoring.value = true
  try {
    const out: ReaderStep[] = []
    for (const raw of list) {
      if (out.length >= limit.value || out.at(-1)?.observation.verdict) break
      const action: AgentAction = { tool: String(raw?.tool), args: { ...(raw?.args ?? {}) } }
      const step = await stepWith(e, rt, out, action)
      if (env.value !== e || mine !== readerGeneration) return
      out.push(step)
    }
    readerSteps.value = out
    quiet.value = true
    // 表单停在最后一步选的工具和参数上（和读者自己走的时候一样）
    const last = out.at(-1)?.action
    const t = activeTask.value
    if (last && t && TOOLS.some((x) => x.name === last.tool)) form.tool = last.tool
    if (last && t?.blocks.includes(last.args.block as number)) form.block = last.args.block as number
    if (last && t?.strides.includes(last.args.stride as number)) form.stride = last.args.stride as number
    if (out.length !== list.length) emit('update:actions', actionsOf(out))
    if (readerSummary.value) emit('finish', { ...readerSummary.value, restored: true })
  } catch (err) {
    const aborted = (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError'
    if (mine === readerGeneration && !aborted) readerError.value = simProblem(err)
  } finally {
    if (mine === readerGeneration) restoring.value = false
  }
}

const readerHead = computed(() => {
  const s = readerSummary.value
  if (!s) return ''
  return s.verdict
    ? `你用了 ${s.steps} 步交卷：${describeConfig(s.verdict.config)}，拿到 ${s.verdict.earned.filter(Boolean).length} 颗星（${starText(s.verdict.earned)}）。`
    : `${s.steps} 步用完了，这一轮没有交卷：不交卷就没有分。`
})

// ── 换任务、换起点 ─────────────────────────────────────────────────────

watch([runtime, activeTask, limit], ([rt, t]) => {
  env.value = rt && t && client ? rt.createEnv(t, (request) => client!.run(request)) : null
  resetReader()
  void runReplay()
}, { immediate: true })

function setView(v: View) {
  pause()
  view.value = allowedView(v)
}
watch(() => [props.mode, props.reader, props.replay] as const, ([m]) => setView(m))

// v-model:actions：传进来的和手上的不一样（刷新以后读出了草稿、换了存档），照着重新走一遍；传进来空的就清空
watch([env, () => props.actions] as const, ([e, list]) => {
  if (!e || !list || sameActions(list, actionsOf(readerSteps.value))) return
  if (list.length === 0) resetReader()
  else void restoreReader(list)
})

// ── 键盘、滚动、播报 ────────────────────────────────────────────────────

/** 看规则 Agent 时焦点在控制台上：← → 换一条，空格播放或暂停，Home 回到开头，End 跳到最后。 */
function onKey(e: KeyboardEvent) {
  if (!replayReady.value || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const target = e.target as HTMLElement
  if (target.closest('input, select, textarea')) return
  const key = e.key
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(key) || (key === ' ' && target instanceof HTMLButtonElement)) return
  e.preventDefault()
  if (key === ' ') {
    if (playing.value) pause()
    else play()
  } else if (key === 'ArrowLeft') go(position.value - 1)
  else if (key === 'ArrowRight') go(position.value + 1)
  else go(key === 'Home' ? 0 : beats.value)
}

// 记录框跟着最新的一条滚到底
watch([position, readerSteps, view, episode], async () => {
  await nextTick()
  const box = logBox.value
  if (!box) {
    logScrolls.value = false
    return
  }
  box.scrollTop = box.scrollHeight
  logScrolls.value = box.scrollHeight > box.clientHeight + 1
})

const rootLabel = computed(() => `Agent 控制台${replayReady.value ? '：焦点在这里时，← → 换一条，空格播放或暂停，Home 回到开头，End 跳到最后' : ''}`)

/** 读屏播报：手动换一条时读这一条，自动播放时不读，停下来以后再说 */
const announce = computed(() => {
  if (view.value === 'reader') {
    const last = readerSteps.value.at(-1)
    if (!last || quiet.value) return ''
    return `第 ${readerSteps.value.length} 步，观察：${last.observation.text}规则 Agent ${last.same ? '和你选的一样' : `会选 ${formatAction(last.rule.action)}`}。${readerHead.value}`
  }
  if (playing.value || !episode.value || position.value === 0) return ''
  return `${caption.value}：${beatText(position.value - 1)}${ended.value ? ruleLine.value : ''}`
})

/** 观察的数据写成一行 JSON，逗号后面空一格，窄屏上能折行 */
function json(data: Observation['data']): string {
  return `{ ${Object.entries(data).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(', ')} }`
}

// ── 挂载 ────────────────────────────────────────────────────────────────

let observer: IntersectionObserver | null = null
const onVisibility = () => {
  if (document.hidden) pause()
}

onMounted(async () => {
  document.addEventListener('visibilitychange', onVisibility)
  // 02 第 3 节：离开视口就暂停
  if (typeof IntersectionObserver !== 'undefined' && root.value) {
    observer = new IntersectionObserver((entries) => {
      if (entries.every((entry) => !entry.isIntersecting)) pause()
    })
    observer.observe(root.value)
  }
  client = createSimClient()
  try {
    const [tools, rules] = await Promise.all([import('@course/agent/tools.ts'), import('@course/agent/rules.ts')])
    runtime.value = { createEnv: tools.createEnv, rulePolicy: rules.rulePolicy }
  } catch (err) {
    loadError.value = `Agent 的代码没加载出来：${(err as Error)?.message ?? String(err)}。刷新页面再试一次。`
  }
})

onBeforeUnmount(() => {
  generation++
  pause()
  document.removeEventListener('visibilitychange', onVisibility)
  observer?.disconnect()
  client?.dispose()
  client = null
})
</script>

<template>
  <div
    ref="root"
    class="hg-agent"
    role="group"
    :aria-label="rootLabel"
    :tabindex="replayReady ? 0 : undefined"
    @keydown="onKey"
  >
    <p v-if="problem" class="hg-agent__problem" role="alert" data-hg-content-error>{{ problem }}</p>

    <template v-if="activeTask">
      <div class="hg-agent__head">
        <p class="hg-agent__eyebrow">Agent 控制台</p>
        <p class="hg-agent__goal">{{ activeTask.goal }}</p>
        <ol class="hg-agent__stars" aria-label="三星标准">
          <li v-for="(text, k) in activeTask.stars" :key="k">
            <span class="hg-agent__star" aria-hidden="true">★{{ k + 1 }}</span>
            <span class="hg-agent__sr">第 {{ k + 1 }} 颗星：</span>{{ text }}
          </li>
        </ol>
        <p class="hg-agent__meta">起点：{{ describeConfig(activeTask.start) }} · 一轮最多 {{ limit }} 步 · 周期数、车次都是模拟值</p>
      </div>

      <div v-if="props.reader && props.replay" class="hg-agent__modes" role="group" aria-label="控制台模式">
        <button type="button" class="hg-agent__mode" :aria-pressed="view === 'replay'" @click="setView('replay')">看规则 Agent</button>
        <button type="button" class="hg-agent__mode" :aria-pressed="view === 'reader'" @click="setView('reader')">你来当 Agent</button>
      </div>

      <p v-if="loadError" class="hg-agent__error" role="alert">{{ loadError }}</p>

      <!-- 看规则 Agent -->
      <template v-if="view === 'replay'">
        <p v-if="replayError" class="hg-agent__error" role="alert">{{ replayError }}</p>
        <p v-else-if="!episode && !loadError" class="hg-agent__wait">规则 Agent 正在模拟器上走这一轮……</p>

        <div v-if="episode" class="hg-agent__toolbar">
          <div class="hg-agent__transport" role="group" aria-label="一条一条看">
            <button type="button" class="hg-agent__button" :disabled="position === 0" @click="go(0)">从头</button>
            <button type="button" class="hg-agent__button" :disabled="position === 0" @click="go(position - 1)">上一条</button>
            <button type="button" class="hg-agent__button is-primary" :disabled="!beats" @click="playing ? pause() : play()">{{ playLabel }}</button>
            <button type="button" class="hg-agent__button" :disabled="position >= beats" @click="go(position + 1)">下一条</button>
            <button type="button" class="hg-agent__button" :disabled="position >= beats" @click="go(beats)">跳到最后</button>
          </div>
          <input
            class="hg-agent__range"
            type="range"
            min="0"
            :max="beats"
            step="1"
            :value="position"
            aria-label="拖动到第几条"
            :aria-valuetext="position ? caption : '还没开始'"
            @input="go(Number(($event.target as HTMLInputElement).value))"
          >
          <p class="hg-agent__caption">{{ caption }}</p>
          <p class="hg-agent__note">播放速度不代表 GPU 耗时。焦点在控制台上时，← → 换一条，空格播放或暂停。</p>
        </div>

        <ol
          v-if="shown.length"
          ref="logBox"
          class="hg-agent__log"
          :tabindex="logScrolls ? 0 : undefined"
          :aria-label="logScrolls ? '规则 Agent 走过的步（可以滚动）' : '规则 Agent 走过的步'"
        >
          <li v-for="item in shown" :key="item.index" class="hg-agent__step">
            <p class="hg-agent__step-head">第 {{ item.index + 1 }} 步</p>
            <div class="hg-agent__row is-thought" :class="{ 'is-current': position === item.index * 3 + 1 }">
              <span class="hg-agent__tag">思考</span>
              <p class="hg-agent__text">{{ item.step.thought }}</p>
            </div>
            <div v-if="item.parts > 1" class="hg-agent__row is-action" :class="{ 'is-current': position === item.index * 3 + 2 }">
              <span class="hg-agent__tag">行动</span>
              <p class="hg-agent__text"><code class="hg-agent__call" translate="no">{{ formatAction(item.step.action) }}</code></p>
            </div>
            <div v-if="item.parts > 2" class="hg-agent__row is-observation" :class="{ 'is-current': position === item.index * 3 + 3 }">
              <span class="hg-agent__tag">观察</span>
              <div class="hg-agent__text">
                <p>{{ item.step.observation.text }}</p>
                <code class="hg-agent__json" translate="no">{{ json(item.step.observation.data) }}</code>
              </div>
            </div>
          </li>
        </ol>

        <p v-if="ended" class="hg-agent__result">
          <strong>{{ ruleLine }}</strong>
          <template v-if="episode?.stop === 'limit'">步数上限是 {{ limit }} 步，不交卷就没有分。</template>
        </p>
      </template>

      <!-- 你来当 Agent -->
      <template v-else>
        <p class="hg-agent__intro">
          你来当 Agent：每一步选一个工具和一组参数，点「执行这一步」看观察。执行以后，下面写出规则 Agent 换你会怎么选。交卷或者走满 {{ limit }} 步就结束。
        </p>

        <ol
          v-if="readerSteps.length"
          ref="logBox"
          class="hg-agent__log"
          :tabindex="logScrolls ? 0 : undefined"
          :aria-label="logScrolls ? '你走过的步（可以滚动）' : '你走过的步'"
        >
          <li v-for="(s, k) in readerSteps" :key="k" class="hg-agent__step">
            <p class="hg-agent__step-head">第 {{ k + 1 }} 步</p>
            <div class="hg-agent__row is-action">
              <span class="hg-agent__tag">你的行动</span>
              <p class="hg-agent__text"><code class="hg-agent__call" translate="no">{{ formatAction(s.action) }}</code></p>
            </div>
            <div class="hg-agent__row is-observation">
              <span class="hg-agent__tag">观察</span>
              <div class="hg-agent__text">
                <p>{{ s.observation.text }}</p>
                <code class="hg-agent__json" translate="no">{{ json(s.observation.data) }}</code>
              </div>
            </div>
            <div class="hg-agent__row is-rule" :class="s.same ? 'is-same' : 'is-diff'">
              <span class="hg-agent__tag">规则 Agent</span>
              <div class="hg-agent__text">
                <p>
                  <span class="hg-agent__match">{{ s.same ? '✓ 一样' : '≠ 不一样' }}</span>
                  它会选 <code class="hg-agent__call" translate="no">{{ formatAction(s.rule.action) }}</code>
                </p>
                <p class="hg-agent__why">它的想法：{{ s.rule.thought }}</p>
              </div>
            </div>
          </li>
        </ol>

        <p v-if="readerError" class="hg-agent__error" role="alert">{{ readerError }}</p>

        <div v-if="readerSummary" class="hg-agent__result">
          <p><strong>{{ readerHead }}</strong></p>
          <p v-if="episode">{{ episodeLine(episode, '规则 Agent 从同一个起点') }}</p>
          <p>你走的 {{ readerSummary.steps }} 步里，有 {{ readerSummary.matches }} 步和规则 Agent 选得一样。</p>
          <button type="button" class="hg-agent__button" @click="restart">再来一次</button>
        </div>

        <div v-else class="hg-agent__form" role="group" :aria-label="`第 ${readerSteps.length + 1} 步：选工具和参数`">
          <div class="hg-agent__knobs">
            <Knob label="工具" :options="TOOL_OPTIONS" v-model="form.tool" />
            <Knob label="每组线程数" code="block" :options="activeTask.blocks" v-model="form.block" />
            <Knob label="访问步长" code="stride" :options="activeTask.strides" v-model="form.stride" />
          </div>
          <p class="hg-agent__summary">{{ toolSummary }}</p>
          <div class="hg-agent__go">
            <code class="hg-agent__call" translate="no">{{ formatAction(pending) }}</code>
            <button type="button" class="hg-agent__button is-primary" :disabled="!env || busy || restoring" @click="readerAct">{{ busy ? '正在执行……' : restoring ? '正在还原……' : '执行这一步' }}</button>
            <span class="hg-agent__count">第 {{ readerSteps.length + 1 }} / {{ limit }} 步</span>
          </div>
          <p v-if="!env && !loadError" class="hg-agent__note">模拟器还在准备，稍等一下。</p>
          <p v-else-if="restoring" class="hg-agent__note">照着你上次走过的步重新走一遍……</p>
        </div>
      </template>
    </template>

    <p class="hg-agent__sr" aria-live="polite">{{ announce }}</p>
  </div>
</template>

<style scoped>
.hg-agent {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: 14px;
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.hg-agent:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-agent__problem,
.hg-agent__error {
  margin: 0;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

/* ── 任务和星级标准 ── */

.hg-agent__head {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hg-agent__head p {
  margin: 0;
}

.hg-agent__eyebrow {
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-agent__goal {
  font-family: var(--hg-font-display);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.5;
}

.hg-agent__stars {
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

.hg-agent__star {
  display: inline-block;
  min-width: 2.6em;
  color: var(--hg-amber-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

.hg-agent__meta,
.hg-agent__note,
.hg-agent__count {
  color: var(--hg-ink-3);
  font-size: 12px;
}

/* ── 模式切换和播放（和锁步执行视图一样） ── */

.hg-agent__modes {
  display: inline-flex;
  flex-wrap: wrap;
  align-self: flex-start;
  gap: 2px;
  padding: 3px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  box-shadow: inset 0 0 0 1px var(--hg-border);
}

.hg-agent__mode {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--hg-ink-2);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--motion-ease-out), color var(--motion-fast) var(--motion-ease-out);
}

.hg-agent__mode[aria-pressed='true'] {
  background: var(--hg-surface);
  color: var(--hg-ink);
  box-shadow: var(--hg-shadow);
}

.hg-agent__mode:focus-visible,
.hg-agent__button:focus-visible,
.hg-agent__range:focus-visible,
.hg-agent__log:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-agent__toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
}

.hg-agent__toolbar p,
.hg-agent__wait,
.hg-agent__intro,
.hg-agent__summary,
.hg-agent__note {
  margin: 0;
}

.hg-agent__transport {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hg-agent__button {
  min-height: 36px;
  padding: 0 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节） */
.hg-agent__button.is-primary {
  min-width: 6.5em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-agent__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.hg-agent__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-agent__range {
  width: 100%;
  margin: 0;
  accent-color: var(--hg-accent);
}

.hg-agent__caption {
  color: var(--hg-ink);
  font-size: 14px;
  line-height: 1.6;
}

.hg-agent__wait,
.hg-agent__intro {
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.7;
}

/* ── 记录：一步一块，每块是思考、行动、观察三条 ── */

.hg-agent__log {
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

.hg-agent__step {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
}

.hg-agent__step-head {
  margin: 0;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
}

.hg-agent__row {
  display: grid;
  grid-template-columns: 5.6rem minmax(0, 1fr);
  gap: 4px 10px;
  align-items: start;
  padding: 2px 0 2px 8px;
  border-left: 3px solid transparent;
  animation: hg-agent-in var(--motion-base) var(--motion-ease-out) both;
}

.hg-agent__row.is-current {
  border-left-color: var(--hg-accent);
}

@keyframes hg-agent-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

/* 窄的时候标签放在上面 */
@container (max-width: 460px) {
  .hg-agent__row {
    grid-template-columns: minmax(0, 1fr);
  }

  .hg-agent__tag {
    justify-self: start;
  }
}

/* 三种标签形状和底色各不相同，文字写明是哪一种（01 第 7 节：不只靠颜色） */
.hg-agent__tag {
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

.is-thought > .hg-agent__tag {
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  color: var(--hg-ink-2);
}

.is-action > .hg-agent__tag {
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.is-observation > .hg-agent__tag {
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

.is-rule > .hg-agent__tag {
  border-color: var(--hg-violet);
  color: var(--hg-violet-ink);
}

.hg-agent__text {
  min-width: 0;
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
}

.hg-agent__text p {
  margin: 0;
}

.is-thought .hg-agent__text {
  color: var(--hg-ink-2);
}

.hg-agent__call,
.hg-agent__json {
  font-family: var(--hg-font-mono);
  overflow-wrap: anywhere;
}

.hg-agent__call {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font-size: 13px;
}

.hg-agent__json {
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

.hg-agent__match {
  margin-right: 4px;
  font-weight: 700;
}

.is-same .hg-agent__match {
  color: var(--hg-accent-ink);
}

.is-diff .hg-agent__match {
  color: var(--hg-amber-ink);
}

.hg-agent__why {
  color: var(--hg-ink-2);
  font-size: 13px;
}

/* ── 结果 ── */

.hg-agent__result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  padding: 10px 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  font-size: 14px;
  line-height: 1.7;
}

.hg-agent__result p {
  margin: 0;
}

/* ── 你来当 Agent 的表单 ── */

.hg-agent__form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 10px;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.hg-agent__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 24px;
}

.hg-agent__summary {
  color: var(--hg-ink-2);
  font-size: 13px;
}

.hg-agent__go {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.hg-agent__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/*
 * 减弱动效（02 第 4 节）：系统设置和站点设置（布局根元素的 data-hg-motion="reduce"）。
 * 自定义 @keyframes 不受时长 token 影响，两种都要关掉：新的一条直接出现。
 */
@media (prefers-reduced-motion: reduce) {
  .hg-agent__row {
    animation: none;
  }
}

[data-hg-motion='reduce'] .hg-agent__row {
  animation: none;
}
</style>
