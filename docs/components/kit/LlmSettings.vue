<script setup lang="ts">
/**
 * 可选：让读者自己的大模型来当 Agent（A-03；03 第 3、4、7 节，09 第 3、6 节）。
 *
 * 1-14 的可选环节。读者选接口（OpenAI 兼容 / Anthropic），填地址、模型名和自己的 API Key，点「让大模型当 Agent」：
 * 大模型代替规则策略做「思考」，每一步只回一个行动（JSON），页面校验过才在模拟器上执行，回的东西不合法就说明哪里不对并停下。
 * 每一步写出规则 Agent 面对同样的历史会怎么选，最后和规则 Agent 从同一个起点走的一轮比一比（docs/course/agent/llm.ts）。
 * - 没有后端、不经过中转：浏览器直接请求读者填的服务商。服务商不允许跨域（CORS）时，报错里说明原因，
 *   「不能直连怎么办」里给出跳过、本地代理、本地模型三条路。
 * - Key 只存在这个标签页的 sessionStorage 里（llm.ts 的 saveLlmSettings），不进 localStorage、链接和日志；不提供默认 Key。
 * - 这一节完全可选：组件不判星、不发经验值、不写进度存档，不填 Key 什么都不会发生。
 *
 * 用法（全局注册成异步组件，Markdown 里直接写）：
 *   <LlmSettings />                                         向量加法，起点 block 48、步长 4
 *   <LlmSettings :start="{ block: 100, stride: 8 }" @result="…" />
 *   result：每跑完一轮发一次 { stop, verdict, steps, matches, rule }，不带 Key 和设置。只用来展示：关卡不要拿它判星、发经验值。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useId, watch } from 'vue'
import { useData } from 'vitepress'
import { createSimClient, type SimClient } from '@sim/client.ts'
import {
  ANTHROPIC_BASE_URL, checkSettings, forgetLlmKey, LLM_PROVIDERS, LLM_TIMEOUT_MS, loadLlmSettings, runLlmAgent, saveLlmSettings, systemPrompt,
  type LlmRun, type LlmSettings, type LlmStep, type SettingsField,
} from '@course/agent/llm.ts'
import { formatAction, MAX_STEPS, starText, type Verdict } from '@course/agent/react.ts'
import { describeConfig, TUNE_TASKS, tuneTask, type TuneConfig, type TuneTask } from '@course/agent/tasks.ts'
import { createEnv } from '@course/agent/tools.ts'
import { contentError } from './contentError.ts'
import Knob from './Knob.vue'

interface LlmResult {
  stop: LlmRun['stop']
  verdict: Verdict | null
  steps: number
  /** 和规则 Agent 选得一样的步数 */
  matches: number
  rule: LlmRun['rule']
}

const props = withDefaults(defineProps<{
  /** 任务 id（docs/course/agent/tasks.ts 的 TUNE_TASKS） */
  task?: string
  /** 起点，要从任务的可选值里选；不写用任务自己的起点 */
  start?: TuneConfig | null
  /** 一轮最多几步（也就是最多请求几次） */
  maxSteps?: number
  title?: string
}>(), {
  task: 'vector-add',
  start: null,
  maxSteps: MAX_STEPS,
  title: '可选：让大模型来当 Agent',
})

const emit = defineEmits<{ result: [result: LlmResult] }>()

const { page } = useData()
const uid = useId()
/** 挂载之前（服务端渲染、水合）按默认值渲染，输入框不能用；挂载以后才读 sessionStorage */
const mounted = ref(false)

// ── 任务和起点 ───────────────────────────────────────────────────────────

const listed = computed(() => tuneTask(props.task))
const problem = computed(() => {
  const t = listed.value
  if (!t) return contentError(`LlmSettings 的 task 写成了「${props.task}」，可选的是 ${Object.keys(TUNE_TASKS).join('、')}。`, page.value.relativePath)
  const s = props.start
  if (s && (!t.blocks.includes(s.block) || !t.strides.includes(s.stride))) {
    return contentError(`LlmSettings 的 start 要从可选值里选：block 是 ${t.blocks.join(' / ')}，stride 是 ${t.strides.join(' / ')}；现在是 ${JSON.stringify(s)}。`, page.value.relativePath)
  }
  if (!Number.isInteger(props.maxSteps) || props.maxSteps < 1) {
    return contentError(`LlmSettings 的 max-steps 要是正整数，现在是 ${String(props.maxSteps)}。`, page.value.relativePath)
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
const prompt = computed(() => (activeTask.value ? systemPrompt(activeTask.value, limit.value) : ''))

// ── 设置：存在这个标签页的 sessionStorage 里 ────────────────────────────────────

const settings = reactive<LlmSettings>({ provider: 'openai', baseUrl: '', model: '', key: '' })
const showKey = ref(false)
/** 点过一次运行以后才把每个框的问题标出来，空表单不先报错 */
const tried = ref(false)
/** sessionStorage 用不了（浏览器禁用了存储）：刷新以后要重新填 */
const unsaved = ref(false)
const notice = ref('')

const check = computed(() => checkSettings(settings))
function issueOf(field: SettingsField): string {
  return tried.value ? check.value.issues.find((i) => i.field === field)?.message ?? '' : ''
}

const baseEl = ref<HTMLInputElement | null>(null)
const modelEl = ref<HTMLInputElement | null>(null)
const keyEl = ref<HTMLInputElement | null>(null)

// 换接口：地址还空着就填上 Anthropic 的官方地址；从 Anthropic 换回来时，没改过的官方地址清掉
watch(() => settings.provider, (provider) => {
  const base = settings.baseUrl.trim()
  if (provider === 'anthropic' && !base) settings.baseUrl = ANTHROPIC_BASE_URL
  else if (provider === 'openai' && base === ANTHROPIC_BASE_URL) settings.baseUrl = ''
})
watch(settings, () => {
  if (mounted.value) unsaved.value = !saveLlmSettings({ ...settings })
})

function forgetKey() {
  forgetLlmKey()
  settings.key = ''
  showKey.value = false
  notice.value = '已经忘掉 Key：这个标签页里不再存它。'
}

// ── 运行 ────────────────────────────────────────────────────────────────

const running = ref(false)
const steps = shallowRef<LlmStep[]>([])
const result = shallowRef<LlmRun | null>(null)
let controller: AbortController | null = null
let client: SimClient | null = null

async function start() {
  const task = activeTask.value
  if (!mounted.value || running.value || !task) return
  tried.value = true
  notice.value = ''
  const first = check.value.issues[0]
  if (first) {
    const el = { baseUrl: baseEl, model: modelEl, key: keyEl }[first.field].value
    el?.focus()
    return
  }
  running.value = true
  steps.value = []
  result.value = null
  const mine = new AbortController()
  controller = mine
  client ??= createSimClient()
  const sim = client
  try {
    const run = await runLlmAgent(
      { settings: { ...settings }, env: createEnv(task, (request) => sim.run(request)), maxSteps: limit.value, signal: mine.signal },
      {
        // 包一层：window.fetch 不能挂在别的对象上调用
        fetch: (url, init) => fetch(url, init),
        onStep: (step) => {
          if (controller === mine) steps.value = [...steps.value, step]
        },
      },
    )
    if (controller !== mine) return
    result.value = run
    steps.value = run.steps
    emit('result', { stop: run.stop, verdict: run.verdict, steps: run.steps.length, matches: run.steps.filter((s) => s.same).length, rule: run.rule })
  } catch (err) {
    // runLlmAgent 只在设置不对时抛错，上面已经检查过；真走到这里，把原因写出来，不让按钮卡住
    if (controller === mine) notice.value = `没有跑起来：${(err as Error)?.message ?? String(err)}`
  } finally {
    if (controller === mine) {
      controller = null
      running.value = false
    }
  }
}

function stop() {
  controller?.abort()
}

// 换了任务、起点、步数上限：正在跑的停下，上一轮的结果对不上了
watch([activeTask, limit], () => {
  controller?.abort()
  controller = null
  running.value = false
  steps.value = []
  result.value = null
})

// ── 显示 ────────────────────────────────────────────────────────────────

const basePlaceholder = computed(() => (settings.provider === 'anthropic' ? ANTHROPIC_BASE_URL : 'https://…'))
const baseHint = computed(() => (settings.provider === 'anthropic'
  ? `官方地址是 ${ANTHROPIC_BASE_URL}，页面会在后面接 /v1/messages。`
  : '照服务商文档里写的 base URL 填，页面会在后面接 /chat/completions。'))

const status = computed(() => {
  const n = steps.value.length
  if (running.value) {
    if (steps.value.at(-1)?.observation.verdict || n >= limit.value) return { tone: '', text: `大模型这一轮走完了（${n} 步）。规则 Agent 正在从同一个起点走一轮，好比一比……` }
    return { tone: '', text: `第 ${n + 1} 步：等大模型回答……（已经走了 ${n} 步，一步请求一次）` }
  }
  const r = result.value
  if (!r) return { tone: '', text: '填好上面几项，再点「让大模型当 Agent」。不填也没关系：这一节可以跳过。' }
  if (r.verdict) {
    const { earned, config } = r.verdict
    return { tone: earned.every(Boolean) ? 'good' : '', text: `大模型用了 ${n} 步交卷：${describeConfig(config)}，拿到 ${earned.filter(Boolean).length} 颗星（${starText(earned)}）。` }
  }
  if (r.stop === 'limit') return { tone: 'bad', text: `${n} 步用完了，大模型还没有交卷：不交卷就没有分。` }
  if (r.stop === 'stopped') return { tone: '', text: n ? `已经停下，走过的 ${n} 步留在下面。` : '已经停下。' }
  if (r.stop === 'invalid') return { tone: 'bad', text: `大模型第 ${n + 1} 步回的内容不合法，页面没有执行它：看下面「这次的问题」。` }
  return { tone: 'bad', text: `这一轮停在了第 ${n + 1} 步：看下面「这次的问题」。` }
})

/** 交卷或者走满步数以后，和规则 Agent 那一轮比一比 */
const comparison = computed(() => {
  const r = result.value
  if (!r?.rule || (r.stop !== 'finish' && r.stop !== 'limit')) return []
  const rule = r.rule.verdict
    ? `规则 Agent 从同一个起点用了 ${r.rule.steps} 步交卷：${describeConfig(r.rule.verdict.config)}，拿到 ${r.rule.verdict.earned.filter(Boolean).length} 颗星（${starText(r.rule.verdict.earned)}）。`
    : `规则 Agent 从同一个起点走满了 ${r.rule.steps} 步，没有交卷。`
  const matches = r.steps.filter((s) => s.same).length
  const same = matches === r.steps.length && r.steps.length === r.rule.steps
    ? '大模型每一步都和它选得一样。'
    : `大模型走的 ${r.steps.length} 步里，有 ${matches} 步和它选得一样。`
  return [rule, same]
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

/** 本站的地址（给本地模型的 OLLAMA_ORIGINS 用）；挂载以后才知道 */
const origin = ref('')

// ── 挂载 ────────────────────────────────────────────────────────────────

onMounted(() => {
  const saved = loadLlmSettings()
  if (saved) Object.assign(settings, saved)
  origin.value = location.origin
  mounted.value = true
})

onBeforeUnmount(() => {
  controller?.abort()
  controller = null
  client?.dispose()
  client = null
})
</script>

<template>
  <div class="hg-llm">
    <section class="hg-llm__card" :aria-labelledby="`${uid}-title`">
      <header class="hg-llm__head">
        <span class="hg-llm__eyebrow" aria-hidden="true">LLM</span>
        <h3 :id="`${uid}-title`" class="hg-llm__title">{{ title }}</h3>
        <span class="hg-llm__mode">可以跳过</span>
      </header>

      <p v-if="problem" class="hg-llm__problem" role="alert" data-hg-content-error>{{ problem }}</p>

      <template v-if="activeTask">
        <p class="hg-llm__intro">
          这一节可以跳过：<strong>不填 Key 不影响通关和星级。</strong>想看看大模型会怎么调参，就填上你自己的 API Key：大模型代替规则 Agent 做「思考」这一步，每一步只回一个行动（JSON），页面检查过才在模拟器上执行，最后和规则 Agent 比一比。
        </p>

        <div class="hg-llm__privacy" role="note" aria-label="关于 Key">
          <p class="hg-llm__privacy-head">Key 只在你的浏览器里，直接发给你填写的服务商。</p>
          <ul>
            <li>本站没有服务器，请求不经过任何中转。</li>
            <li>Key 存在这个标签页的 sessionStorage 里，关掉标签页就没了；不写进 localStorage、链接或日志。点「忘掉 Key」马上删掉。</li>
            <li>本站不提供 Key。建议用一个专门拿来试、设了额度上限的 Key。每走一步请求一次，一轮最多 {{ limit }} 次，费用按你的服务商算。</li>
          </ul>
        </div>

        <div class="hg-llm__task">
          <p class="hg-llm__goal">{{ activeTask.goal }}</p>
          <ol class="hg-llm__stars" aria-label="三星标准">
            <li v-for="(text, k) in activeTask.stars" :key="k">
              <span class="hg-llm__star" aria-hidden="true">★{{ k + 1 }}</span>
              <span class="hg-llm__sr">第 {{ k + 1 }} 颗星：</span>{{ text }}
            </li>
          </ol>
          <p class="hg-llm__meta">起点：{{ describeConfig(activeTask.start) }} · 一轮最多 {{ limit }} 步 · 周期数、车次都是模拟值</p>
        </div>

        <div class="hg-llm__form" role="group" aria-label="大模型的设置">
          <Knob v-model="settings.provider" label="接口" :options="LLM_PROVIDERS" :disabled="!mounted || running" />

          <div class="hg-llm__field">
            <label class="hg-llm__label" :for="`${uid}-base`">地址（base URL）</label>
            <input
              :id="`${uid}-base`"
              ref="baseEl"
              v-model="settings.baseUrl"
              class="hg-llm__input"
              type="url"
              inputmode="url"
              :placeholder="basePlaceholder"
              :disabled="!mounted || running"
              :aria-invalid="issueOf('baseUrl') ? 'true' : undefined"
              :aria-describedby="`${uid}-base-note`"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              translate="no"
              @keydown.enter.prevent="start"
            >
            <p :id="`${uid}-base-note`" class="hg-llm__hint" :class="{ 'is-issue': issueOf('baseUrl') }">{{ issueOf('baseUrl') || baseHint }}</p>
          </div>

          <div class="hg-llm__field">
            <label class="hg-llm__label" :for="`${uid}-model`">模型名</label>
            <input
              :id="`${uid}-model`"
              ref="modelEl"
              v-model="settings.model"
              class="hg-llm__input"
              type="text"
              placeholder="照服务商文档里的模型名填"
              :disabled="!mounted || running"
              :aria-invalid="issueOf('model') ? 'true' : undefined"
              :aria-describedby="`${uid}-model-note`"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              translate="no"
              @keydown.enter.prevent="start"
            >
            <p :id="`${uid}-model-note`" class="hg-llm__hint" :class="{ 'is-issue': issueOf('model') }">{{ issueOf('model') || '原样照抄，大小写和连字符都要一样。' }}</p>
          </div>

          <div class="hg-llm__field">
            <label class="hg-llm__label" :for="`${uid}-key`">API Key</label>
            <div class="hg-llm__keyrow">
              <input
                :id="`${uid}-key`"
                ref="keyEl"
                v-model="settings.key"
                class="hg-llm__input"
                :type="showKey ? 'text' : 'password'"
                placeholder="你自己的 Key"
                :disabled="!mounted || running"
                :aria-invalid="issueOf('key') ? 'true' : undefined"
                :aria-describedby="`${uid}-key-note`"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                translate="no"
                @keydown.enter.prevent="start"
              >
              <button type="button" class="hg-llm__button" :aria-pressed="showKey" :disabled="!mounted" @click="showKey = !showKey">显示</button>
              <button type="button" class="hg-llm__button" :disabled="!mounted || running || !settings.key" @click="forgetKey">忘掉 Key</button>
            </div>
            <p :id="`${uid}-key-note`" class="hg-llm__hint" :class="{ 'is-issue': issueOf('key') }">{{ issueOf('key') || 'Key 只放进请求头，发给下面这个地址。' }}</p>
          </div>

          <p class="hg-llm__endpoint">
            <template v-if="check.endpoint">会请求 <code translate="no">{{ check.endpoint }}</code>，Key 只发给这个地址。</template>
            <template v-else>填好地址以后，这里写出实际请求的地址。</template>
          </p>
        </div>

        <div class="hg-llm__actions">
          <button v-if="!running" type="button" class="hg-llm__button is-primary" :disabled="!mounted" @click="start">让大模型当 Agent</button>
          <button v-else type="button" class="hg-llm__button is-primary" @click="stop">停下</button>
          <span class="hg-llm__keys">一次请求最多等 {{ LLM_TIMEOUT_MS / 1000 }} 秒，随时可以停下</span>
        </div>

        <p v-if="notice" class="hg-llm__notice" role="status">{{ notice }}</p>
        <p v-if="unsaved" class="hg-llm__notice">这个浏览器不让网页存东西：设置只在这个页面上有效，刷新以后要重新填。</p>

        <p class="hg-llm__status" :class="status.tone ? `is-${status.tone}` : undefined">
          <span role="status">{{ status.text }}</span>
        </p>

        <div v-if="result?.problem" class="hg-llm__error">
          <p class="hg-llm__error-title">这次的问题</p>
          <dl>
            <div><dt>现象</dt><dd>{{ result.problem.symptom }}</dd></div>
            <div><dt>原因</dt><dd>{{ result.problem.cause }}</dd></div>
            <div><dt>怎么改</dt><dd>{{ result.problem.fix }}</dd></div>
          </dl>
          <details v-if="result.problem.raw" class="hg-llm__raw">
            <summary>{{ result.problem.kind === 'output' ? '大模型的原话' : '原文' }}</summary>
            <pre translate="no"><code>{{ result.problem.raw }}</code></pre>
          </details>
        </div>

        <ol
          v-if="rows.length"
          ref="logBox"
          class="hg-llm__log"
          :tabindex="logScrolls ? 0 : undefined"
          :aria-label="logScrolls ? '大模型走过的步（可以滚动）' : '大模型走过的步'"
        >
          <li v-for="row in rows" :key="row.index" class="hg-llm__step">
            <p class="hg-llm__step-head">
              <span>第 {{ row.index + 1 }} 步</span>
              <span class="hg-llm__match" :class="row.same ? 'is-same' : 'is-diff'">
                <template v-if="row.same">✓ 和规则 Agent 一样</template>
                <template v-else>≠ 规则 Agent 会选 <code translate="no">{{ row.rule }}</code></template>
              </span>
            </p>
            <div class="hg-llm__row is-thought">
              <span class="hg-llm__tag">思考</span>
              <p class="hg-llm__text">{{ row.thought }}</p>
            </div>
            <div class="hg-llm__row is-action">
              <span class="hg-llm__tag">行动</span>
              <p class="hg-llm__text"><code class="hg-llm__call" translate="no">{{ row.action }}</code></p>
            </div>
            <div class="hg-llm__row is-observation">
              <span class="hg-llm__tag">观察</span>
              <div class="hg-llm__text">
                <p>{{ row.text }}</p>
                <code class="hg-llm__json" translate="no">{{ row.json }}</code>
              </div>
            </div>
          </li>
        </ol>

        <div v-if="comparison.length" class="hg-llm__result">
          <p v-for="(line, k) in comparison" :key="k">{{ line }}</p>
        </div>

        <details class="hg-llm__more">
          <summary>不能直连怎么办</summary>
          <p>网页只能直接请求允许跨域（CORS）的服务商，这由服务商决定，页面改不了。你的服务商不允许时：</p>
          <ul>
            <li>跳过这一节：不影响通关和星级。</li>
            <li>用本地代理：在自己电脑上运行一个转发请求的程序，由它把请求转给服务商，并在回复里加上允许跨域的响应头；把上面的地址改成代理的地址（例如 <code translate="no">http://localhost:端口号</code>）。Key 只经过你自己的电脑。</li>
            <li>
              用本地模型：例如 <a href="https://docs.ollama.com/api/openai-compatibility" target="_blank" rel="noopener noreferrer">Ollama 的 OpenAI 兼容接口</a>，地址填 <code translate="no">http://localhost:11434/v1</code>。它默认只接受 127.0.0.1、0.0.0.0 上的网页跨域请求，要先用 <code translate="no">OLLAMA_ORIGINS</code> 加上本站的地址<template v-if="origin">（<code translate="no">{{ origin }}</code>）</template>，见 <a href="https://docs.ollama.com/faq" target="_blank" rel="noopener noreferrer">Ollama 的 FAQ</a>。
            </li>
          </ul>
          <p>从 https 的网页请求本机的 http 地址时，浏览器可能会先问你是否允许这个网站访问本机上的服务（Chrome 的「本地网络访问」），选允许才连得上。</p>
        </details>

        <details class="hg-llm__more">
          <summary>发给大模型的说明</summary>
          <p>每一步发给大模型的是下面这段说明，再加上起点和到目前为止每一步的观察（JSON）、还剩几步。大模型回的 JSON 先由页面检查：工具名对不对、参数在不在可选值里，都对才执行。</p>
          <pre translate="no"><code>{{ prompt }}</code></pre>
        </details>
      </template>
    </section>
  </div>
</template>

<style scoped>
.hg-llm {
  margin: 20px 0;
}

.hg-llm__card {
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

.hg-llm__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.hg-llm__eyebrow {
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-llm__title {
  margin: 0;
  padding: 0;
  border: 0;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  letter-spacing: 0;
}

.hg-llm__mode {
  margin-left: auto;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-llm__problem {
  margin: 0;
  padding: 10px 14px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

.hg-llm__intro,
.hg-llm__task p,
.hg-llm__privacy p,
.hg-llm__endpoint {
  margin: 0;
}

.hg-llm__intro {
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.7;
}

.hg-llm__intro strong {
  color: var(--hg-ink);
}

/* ── 关于 Key：实线框 + 标题，不只靠颜色 ── */

.hg-llm__privacy {
  padding: 10px 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-left-width: 4px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  font-size: 14px;
  line-height: 1.7;
}

.hg-llm__privacy-head {
  font-weight: 700;
}

.hg-llm__privacy ul,
.hg-llm__more ul {
  margin: 4px 0 0;
  padding-left: 1.3em;
}

.hg-llm__privacy li,
.hg-llm__more li {
  margin: 2px 0;
  color: var(--hg-ink-2);
}

/* ── 任务和星级标准（和 Agent 控制台一样） ── */

.hg-llm__task {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hg-llm__goal {
  font-family: var(--hg-font-display);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.5;
}

.hg-llm__stars {
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

.hg-llm__star {
  display: inline-block;
  min-width: 2.6em;
  color: var(--hg-amber-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

.hg-llm__meta,
.hg-llm__keys {
  color: var(--hg-ink-3);
  font-size: 13px;
  line-height: 1.6;
}

/* ── 设置 ── */

.hg-llm__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
}

.hg-llm__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.hg-llm__label {
  color: var(--hg-ink-2);
  font-size: 14px;
  font-weight: 700;
}

.hg-llm__input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 0 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 14px;
  /* 等宽字体的连字会把 :// 画成别的样子：地址、Key 要一个字一个字照原样显示 */
  font-variant-ligatures: none;
}

.hg-llm__input::placeholder {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-body);
}

.hg-llm__input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 有问题的框：红色描边 + 下面一句话写清哪里不对（不只靠颜色） */
.hg-llm__input[aria-invalid='true'] {
  border-color: var(--hg-error);
}

.hg-llm__keyrow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hg-llm__keyrow .hg-llm__input {
  flex: 1 1 14rem;
}

.hg-llm__hint {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
  line-height: 1.6;
}

.hg-llm__hint.is-issue {
  color: var(--hg-error-ink);
  font-weight: 600;
}

.hg-llm__hint.is-issue::before {
  content: '! ';
  font-weight: 700;
}

.hg-llm__endpoint {
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.7;
}

.hg-llm__endpoint code,
.hg-llm__match code,
.hg-llm__more code {
  padding: 1px 5px;
  border-radius: 6px;
  background: var(--hg-surface-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
  font-variant-ligatures: none;
}

/* ── 按钮和状态 ── */

.hg-llm__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}

.hg-llm__button {
  min-height: 42px;
  padding: 0 16px;
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
.hg-llm__button.is-primary {
  min-width: 8em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-llm__button[aria-pressed='true'] {
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

.hg-llm__button:not(:disabled):hover {
  border-color: var(--hg-accent);
}

.hg-llm__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-llm__input:focus-visible,
.hg-llm__button:focus-visible,
.hg-llm__log:focus-visible,
.hg-llm__more summary:focus-visible,
.hg-llm__raw summary:focus-visible,
.hg-llm__more a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-llm__status,
.hg-llm__notice {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.6;
}

.hg-llm__status.is-good {
  color: var(--hg-accent-ink);
}

.hg-llm__status.is-bad {
  color: var(--hg-error-ink);
}

.hg-llm__notice {
  color: var(--hg-amber-ink);
  font-size: 14px;
}

/* ── 报错：现象、原因、怎么改（和代码沙盒一样） ── */

.hg-llm__error {
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
}

.hg-llm__error-title {
  margin: 0 0 6px;
  color: var(--hg-error-ink);
  font-weight: 700;
}

.hg-llm__error dl {
  display: grid;
  gap: 4px;
  margin: 0;
}

.hg-llm__error dl > div {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 8px;
}

.hg-llm__error dt {
  color: var(--hg-ink-2);
  font-weight: 600;
}

.hg-llm__error dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.hg-llm__raw {
  margin-top: 8px;
}

.hg-llm__raw summary,
.hg-llm__more summary {
  color: var(--hg-ink-2);
  font-size: 14px;
  cursor: pointer;
}

.hg-llm__raw pre,
.hg-llm__more pre {
  margin: 8px 0 0;
  padding: 10px 14px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ── 走过的步：一步一块，思考、行动、观察三种标签形状各不相同（和 Agent 控制台一样） ── */

.hg-llm__log {
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

.hg-llm__step {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
}

.hg-llm__step-head {
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

.hg-llm__match {
  font-family: var(--hg-font-body);
  font-size: 13px;
}

.hg-llm__match.is-same {
  color: var(--hg-accent-ink);
}

.hg-llm__match.is-diff {
  color: var(--hg-amber-ink);
}

.hg-llm__row {
  display: grid;
  grid-template-columns: 5.6rem minmax(0, 1fr);
  gap: 4px 10px;
  align-items: start;
  padding: 2px 0 2px 8px;
}

@container (max-width: 460px) {
  .hg-llm__row {
    grid-template-columns: minmax(0, 1fr);
  }

  .hg-llm__tag {
    justify-self: start;
  }
}

.hg-llm__tag {
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

.is-thought > .hg-llm__tag {
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  color: var(--hg-ink-2);
}

.is-action > .hg-llm__tag {
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.is-observation > .hg-llm__tag {
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

.hg-llm__text {
  min-width: 0;
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
}

.hg-llm__text p {
  margin: 0;
}

.is-thought .hg-llm__text {
  color: var(--hg-ink-2);
}

.hg-llm__call,
.hg-llm__json {
  font-family: var(--hg-font-mono);
  overflow-wrap: anywhere;
}

.hg-llm__call {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font-size: 13px;
}

.hg-llm__json {
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

/* ── 结果、折叠的说明 ── */

.hg-llm__result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  font-size: 14px;
  line-height: 1.7;
}

.hg-llm__result p {
  margin: 0;
}

.hg-llm__more {
  font-size: 14px;
  line-height: 1.7;
}

.hg-llm__more p {
  margin: 8px 0 0;
  color: var(--hg-ink-2);
}

.hg-llm__more a {
  color: var(--hg-accent-ink);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.hg-llm__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 767px) {
  .hg-llm__card {
    padding: 16px 14px;
  }

  .hg-llm__form {
    padding: 12px;
  }

  .hg-llm__keys {
    display: none;
  }
}
</style>
