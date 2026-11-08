<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  STATUSES, STATUS_LABEL, PHASES, AREAS, PROMPTS, parseTask, sortTasks, indexById, unmetDeps,
  availableTasks, waitingForAuthor, pendingGates, summarize, fillPrompt, promptText,
} from '../../../scripts/refactor/task-lib.mjs'

type Task = ReturnType<typeof parseTask> & Record<string, any>

const raw = import.meta.glob('../../../refactor/tasks/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const tasks: Task[] = sortTasks(
  Object.entries(raw)
    .filter(([path]) => !path.split('/').pop()!.startsWith('_'))
    .map(([path, text]) => parseTask(text, `refactor/tasks/${path.split('/').pop()}`)),
)
const byId = indexById(tasks)
const stats = summarize(tasks)
const next = availableTasks(tasks, { gpu: true }).slice(0, 4)
const waiting = waitingForAuthor(tasks)
const gates = pendingGates(tasks)
const pct = stats.total ? Math.round((stats.byStatus.done / stats.total) * 100) : 0

const phase = ref('all')
const area = ref('all')
const query = ref('')
const mobileStatus = ref('todo')
const selectedId = ref<string | null>(null)
const copied = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return tasks.filter((t) => {
    if (phase.value !== 'all' && String(t.phase) !== phase.value) return false
    if (area.value !== 'all' && t.area !== area.value) return false
    if (q && !`${t.id} ${t.title}`.toLowerCase().includes(q)) return false
    return true
  })
})

const columns = computed(() => STATUSES.map((s) => {
  const list = filtered.value.filter((t) => t.status === s)
  const groups: { phase: number; items: Task[] }[] = []
  for (const t of list) {
    const last = groups[groups.length - 1]
    if (last && last.phase === t.phase) last.items.push(t)
    else groups.push({ phase: t.phase, items: [t] })
  }
  return { status: s, label: STATUS_LABEL[s], count: list.length, groups }
}))

const selected = computed(() => (selectedId.value ? byId.get(selectedId.value) as Task | undefined : undefined))

function unmet(t: Task) {
  return unmetDeps(t, byId)
}

function open(id: string) {
  selectedId.value = id
  if (typeof history !== 'undefined') history.replaceState(null, '', `#${id}`)
}

function close() {
  selectedId.value = null
  if (typeof history !== 'undefined') history.replaceState(null, '', location.pathname + location.search)
}

async function copy(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  copied.value = key
  setTimeout(() => { if (copied.value === key) copied.value = '' }, 1600)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && selectedId.value) close()
}

function syncHash() {
  const id = decodeURIComponent(location.hash.slice(1))
  selectedId.value = id && byId.has(id) ? id : null
}

onMounted(() => {
  syncHash()
  window.addEventListener('keydown', onKey)
  window.addEventListener('hashchange', syncHash)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('hashchange', syncHash)
  document.documentElement.style.overflow = ''
})

watch(selectedId, (id) => {
  if (typeof document === 'undefined') return
  document.documentElement.style.overflow = id ? 'hidden' : ''
})

// —— 极简 Markdown 渲染：只处理任务文件里会出现的写法 ——
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])_([^_]+)_(?=[^_]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}
function md(text = '') {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let code = false
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      closeList()
      out.push(code ? '</code></pre>' : '<pre><code>')
      code = !code
      continue
    }
    if (code) { out.push(esc(line) + '\n'); continue }
    const check = /^\s*- \[( |x|X)\]\s*(.*)$/.exec(line)
    const bullet = /^(\s*)- (.*)$/.exec(line)
    const num = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (check) {
      if (list !== 'ul') { closeList(); out.push('<ul class="md-checks">'); list = 'ul' }
      out.push(`<li class="${check[1] === ' ' ? '' : 'ok'}"><span class="box" aria-hidden="true"></span>${inline(check[2])}</li>`)
    } else if (bullet) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li${bullet[1].length ? ' class="sub"' : ''}>${inline(bullet[2])}</li>`)
    } else if (num) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
      out.push(`<li>${inline(num[1])}</li>`)
    } else if (line.trim()) {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    } else {
      closeList()
    }
  }
  closeList()
  if (code) out.push('</code></pre>')
  return out.join('')
}

const DETAIL_SECTIONS = ['目标', '背景', '要做的事', '验收标准', '验证方式', '完成记录', '验收记录']
</script>

<template>
  <div class="hgb">
    <header class="head">
      <div class="head-text">
        <p class="eyebrow">REFACTOR BOARD · refactor/v2</p>
        <h1>Hello GPU 重构看板</h1>
        <p class="sub">数据直接读取 <code>refactor/tasks/*.md</code>。本地运行 <code>npm run docs:dev</code> 时，任务文件一改，看板就会刷新。状态怎么变、谁来改，见 <code>refactor/README.md</code>。</p>
      </div>
      <div class="total" aria-label="总体进度">
        <div class="ring" :style="{ '--p': pct }"><span>{{ pct }}<small>%</small></span></div>
        <div class="total-text">
          <strong>{{ stats.byStatus.done }} / {{ stats.total }}</strong>
          <span>已完成</span>
        </div>
      </div>
    </header>

    <button v-if="gates.length" type="button" class="gate" @click="open(gates[0].id)">
      <span class="eyebrow">GATE</span>
      <span class="gate-text">到达作者验收关口 <b class="mono">{{ gates[0].id }}</b> {{ gates[0].title }}。执行者已停下，作者验收后才继续。</span>
      <span class="gate-go">查看要做的事 →</span>
    </button>

    <section class="chips" aria-label="按状态统计">
      <div v-for="s in STATUSES" :key="s" class="chip" :data-status="s">
        <span class="dot" aria-hidden="true"></span>{{ STATUS_LABEL[s] }}<b>{{ stats.byStatus[s] }}</b>
      </div>
    </section>

    <section class="phases" aria-label="阶段进度">
      <button
        v-for="(name, p) in PHASES" :key="p" type="button" class="phase"
        :class="{ on: phase === String(p) }"
        @click="phase = phase === String(p) ? 'all' : String(p)"
      >
        <span class="phase-top"><span class="mono">阶段 {{ p }}</span><span class="phase-name">{{ name }}</span></span>
        <span class="phase-bar" aria-hidden="true">
          <i class="done" :style="{ width: `${(stats.byPhase[p]?.done || 0) / (stats.byPhase[p]?.total || 1) * 100}%` }"></i>
          <i class="review" :style="{ width: `${(stats.byPhase[p]?.review || 0) / (stats.byPhase[p]?.total || 1) * 100}%` }"></i>
        </span>
        <span class="phase-num">{{ stats.byPhase[p]?.done || 0 }} / {{ stats.byPhase[p]?.total || 0 }}<template v-if="stats.byPhase[p]?.review"> · {{ stats.byPhase[p].review }} 待验收</template></span>
      </button>
    </section>

    <section class="duo">
      <div class="panel">
        <h2><span class="eyebrow">NEXT</span>下一步可以做</h2>
        <p v-if="!next.length" class="empty">现在没有可以开始的任务，先看看右边等你处理的事项。</p>
        <ul class="mini">
          <li v-for="t in next" :key="t.id">
            <button type="button" @click="open(t.id)">
              <span class="mono cid">{{ t.id }}</span>
              <span class="mini-title">{{ t.title }}</span>
              <span v-if="t.gpu" class="tag gpu">GPU</span>
            </button>
          </li>
        </ul>
        <h2 class="h2-gap"><span class="eyebrow">YOU</span>等你处理</h2>
        <p v-if="!waiting.length" class="empty">没有待验收的任务。</p>
        <ul class="mini">
          <li v-for="t in waiting.slice(0, 6)" :key="t.id">
            <button type="button" @click="open(t.id)">
              <span class="mono cid">{{ t.id }}</span>
              <span class="mini-title">{{ t.title }}</span>
              <span class="tag" :class="t.owner === 'author' ? 'author' : 'review'">{{ t.owner === 'author' ? '作者关口' : '待验收' }}</span>
            </button>
          </li>
        </ul>
        <p v-if="waiting.length > 6" class="more">还有 {{ waiting.length - 6 }} 项，在「待验收」一列查看。</p>
      </div>

      <div class="panel">
        <h2><span class="eyebrow">PROMPTS</span>固定提示词</h2>
        <p class="hint">执行者在仓库目录打开 Claude Code，粘贴「连续模式」，一个会话可以连续做到下一个作者关口；也可以用「开工」一次只做一个任务。<code>&lt;编号&gt;</code> 换成任务编号，点开任务卡片可以复制已填好编号的版本。</p>
        <div v-for="p in PROMPTS" :key="p.key" class="prompt">
          <div class="prompt-head">
            <span class="prompt-label">{{ p.label }}</span>
            <button type="button" class="copy" @click="copy(p.key, p.text)">{{ copied === p.key ? '已复制' : '复制' }}</button>
          </div>
          <p class="prompt-text">{{ p.text }}</p>
        </div>
      </div>
    </section>

    <section class="filters" aria-label="筛选">
      <label>
        <span>阶段</span>
        <select v-model="phase">
          <option value="all">全部</option>
          <option v-for="(name, p) in PHASES" :key="p" :value="String(p)">{{ p }} {{ name }}</option>
        </select>
      </label>
      <label>
        <span>领域</span>
        <select v-model="area">
          <option value="all">全部</option>
          <option v-for="(name, a) in AREAS" :key="a" :value="a">{{ name }}</option>
        </select>
      </label>
      <label class="search">
        <span>搜索</span>
        <input v-model="query" type="search" placeholder="编号或标题，例如 NV-04、Softmax">
      </label>
      <span class="count">显示 {{ filtered.length }} / {{ tasks.length }}</span>
    </section>

    <div class="tabs" role="tablist" aria-label="切换状态列">
      <button
        v-for="c in columns" :key="c.status" type="button" role="tab"
        :aria-selected="mobileStatus === c.status" :class="{ on: mobileStatus === c.status }"
        @click="mobileStatus = c.status"
      >{{ c.label }} {{ c.count }}</button>
    </div>

    <section class="board">
      <div
        v-for="c in columns" :key="c.status" class="col" :data-status="c.status"
        :class="{ 'mobile-on': mobileStatus === c.status }"
      >
        <div class="col-head"><span class="dot" aria-hidden="true"></span>{{ c.label }}<b>{{ c.count }}</b></div>
        <div class="col-body">
          <p v-if="!c.count" class="empty">暂无</p>
          <template v-for="g in c.groups" :key="g.phase">
            <p class="group">阶段 {{ g.phase }} · {{ PHASES[g.phase] }}</p>
            <button v-for="t in g.items" :key="t.id" type="button" class="card" @click="open(t.id)">
              <span class="card-top">
                <span class="mono cid">{{ t.id }}</span>
                <span class="size">{{ t.size }}</span>
                <span v-if="t.gpu" class="tag gpu">GPU</span>
                <span v-if="t.owner === 'author'" class="tag author">作者</span>
              </span>
              <span class="card-title">{{ t.title }}</span>
              <span class="card-meta">
                <span>{{ AREAS[t.area] }}</span>
                <span v-if="t.status === 'todo' && unmet(t).length" class="wait">等 {{ unmet(t).slice(0, 2).join('、') }}<template v-if="unmet(t).length > 2"> 等 {{ unmet(t).length }} 项</template></span>
              </span>
              <span v-if="t.checks.total && t.owner === 'ai'" class="progress">
                <span class="pbar" aria-hidden="true"><i :style="{ width: `${t.checks.done / t.checks.total * 100}%` }"></i></span>
                <span class="mono">{{ t.checks.done }}/{{ t.checks.total }}</span>
              </span>
            </button>
          </template>
        </div>
      </div>
    </section>

    <div v-if="selected" class="scrim" @click.self="close">
      <aside class="drawer" role="dialog" aria-modal="true" :aria-label="`${selected.id} ${selected.title}`">
        <div class="drawer-head">
          <div>
            <p class="mono cid">{{ selected.id }} · {{ STATUS_LABEL[selected.status] }}</p>
            <h2>{{ selected.title }}</h2>
          </div>
          <button type="button" class="close" aria-label="关闭" @click="close">×</button>
        </div>
        <dl class="meta">
          <div><dt>阶段</dt><dd>{{ selected.phase }} {{ PHASES[selected.phase] }}</dd></div>
          <div><dt>领域</dt><dd>{{ AREAS[selected.area] }}</dd></div>
          <div><dt>规模</dt><dd>{{ selected.size }}</dd></div>
          <div><dt>执行</dt><dd>{{ selected.owner === 'author' ? '作者' : 'AI 会话' }}{{ selected.gpu ? ' · 需要 AMD GPU' : '' }}</dd></div>
          <div class="wide">
            <dt>依赖</dt>
            <dd>
              <span v-if="!selected.deps.length">无</span>
              <button v-for="d in selected.deps" :key="d" type="button" class="dep" :data-status="byId.get(d)?.status" @click="open(d)">
                {{ d }} · {{ STATUS_LABEL[byId.get(d)?.status] || '不存在' }}
              </button>
            </dd>
          </div>
          <div class="wide"><dt>规范</dt><dd><code v-for="s in selected.specs" :key="s">refactor/specs/{{ s }}.md</code></dd></div>
          <div class="wide"><dt>产出</dt><dd><code v-for="o in selected.outputs" :key="o">{{ o }}</code></dd></div>
          <div class="wide"><dt>文件</dt><dd><code>{{ selected.file }}</code> · 更新于 {{ selected.updated }}</dd></div>
        </dl>
        <div class="drawer-prompts">
          <template v-if="selected.owner === 'ai'">
            <button type="button" class="copy" @click="copy('d-one', fillPrompt(promptText('one'), selected.id))">{{ copied === 'd-one' ? '已复制' : '复制开工提示词' }}</button>
          </template>
          <button type="button" class="copy" @click="copy('d-pass', fillPrompt(promptText('pass'), selected.id))">{{ copied === 'd-pass' ? '已复制' : '复制「验收通过」' }}</button>
          <button type="button" class="copy" @click="copy('d-fail', fillPrompt(promptText('fail'), selected.id))">{{ copied === 'd-fail' ? '已复制' : '复制「验收不通过」' }}</button>
        </div>
        <section v-for="name in DETAIL_SECTIONS" :key="name" class="sec">
          <h3>{{ name }}<span v-if="name === '验收标准'" class="mono sec-count">{{ selected.checks.done }}/{{ selected.checks.total }}</span></h3>
          <div class="md" v-html="md(selected.sections[name])"></div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.hgb {
  --bg: #F5F7FB; --dot: #D5DCE8; --surface: #FFFFFF; --surface-2: #F8FAFC;
  --border: #E2E8F0; --border-strong: #CBD5E1; --ink: #0F172A; --ink-2: #475569; --ink-3: #64748B;
  --accent: #0F766E; --accent-soft: rgba(20, 184, 166, .12);
  --s-todo: #94A3B8; --s-doing: #0369A1; --s-review: #B45309; --s-done: #0F766E; --s-blocked: #DC2626;
  --violet: #7C3AED; --code: #0B1220;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --sans: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-family: var(--sans);
  color: var(--ink);
  background-color: var(--bg);
  background-image: radial-gradient(var(--dot) 1px, transparent 1px);
  background-size: 22px 22px;
  min-height: 100vh;
  padding: 32px max(16px, calc((100vw - 1320px) / 2)) 64px;
  box-sizing: border-box;
}
.dark .hgb {
  --bg: #0B1220; --dot: #1E293B; --surface: #111A2E; --surface-2: #0F172A;
  --border: #253049; --border-strong: #334155; --ink: #E2E8F0; --ink-2: #AAB4CF; --ink-3: #8391B3;
  --accent: #2DD4BF; --accent-soft: rgba(45, 212, 191, .14);
  --s-todo: #64748B; --s-doing: #38BDF8; --s-review: #FBBF24; --s-done: #2DD4BF; --s-blocked: #F87171;
  --violet: #A78BFA;
}
.hgb *, .hgb *::before, .hgb *::after { box-sizing: border-box; }
.hgb button { font: inherit; color: inherit; cursor: pointer; }
.hgb code { font-family: var(--mono); font-size: .86em; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 1px 5px; color: var(--ink); }
.mono { font-family: var(--mono); }
.eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: .12em; color: var(--accent); margin: 0; font-weight: 600; }

.head { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; margin-bottom: 20px; }
.head h1 { font-size: clamp(26px, 4vw, 36px); line-height: 1.15; margin: 6px 0 8px; letter-spacing: -.01em; border: 0; padding: 0; }
.sub { margin: 0; color: var(--ink-2); max-width: 720px; line-height: 1.7; font-size: 14px; }
.total { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.ring {
  --p: 0; width: 84px; height: 84px; border-radius: 50%;
  background: conic-gradient(var(--accent) calc(var(--p) * 1%), var(--border) 0);
  display: grid; place-items: center;
}
.ring span { width: 66px; height: 66px; border-radius: 50%; background: var(--surface); display: flex; align-items: center; justify-content: center; gap: 1px; font-family: var(--mono); font-size: 20px; font-weight: 600; }
.ring small { font-size: 11px; color: var(--ink-3); align-self: center; margin-top: 4px; }
.total-text { display: flex; flex-direction: column; }
.total-text strong { font-family: var(--mono); font-size: 18px; }
.total-text span { color: var(--ink-3); font-size: 13px; }

.gate { width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; margin-bottom: 16px; padding: 12px 16px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--s-review) 50%, transparent); background: color-mix(in srgb, var(--s-review) 10%, var(--surface)); }
.gate .eyebrow { color: var(--s-review); }
.gate-text { flex: 1; font-size: 14px; line-height: 1.6; }
.gate-go { font-size: 13px; color: var(--s-review); white-space: nowrap; }
.gate:focus-visible { outline: 2px solid var(--s-review); outline-offset: 2px; }
@media (max-width: 760px) { .gate { flex-wrap: wrap; } .gate-go { width: 100%; } }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid var(--border); background: var(--surface); border-radius: 999px; font-size: 13px; color: var(--ink-2); }
.chip b { font-family: var(--mono); color: var(--ink); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--s-todo); flex-shrink: 0; }
[data-status="doing"] .dot { background: var(--s-doing); }
[data-status="review"] .dot { background: var(--s-review); }
[data-status="done"] .dot { background: var(--s-done); }
[data-status="blocked"] .dot { background: var(--s-blocked); }

.phases { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.phase { text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; transition: border-color .2s; }
.phase:hover { border-color: var(--border-strong); }
.phase.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.phase:focus-visible, .card:focus-visible, .copy:focus-visible, .mini button:focus-visible, .tabs button:focus-visible, .dep:focus-visible, .close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.phase-top { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--ink-3); }
.phase-name { color: var(--ink); font-weight: 600; font-size: 14px; }
.phase-bar { display: flex; height: 6px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); overflow: hidden; }
.phase-bar i { display: block; height: 100%; }
.phase-bar .done { background: var(--s-done); }
.phase-bar .review { background: var(--s-review); }
.phase-num { font-family: var(--mono); font-size: 12px; color: var(--ink-2); }

.duo { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-bottom: 20px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
.panel h2 { display: flex; align-items: baseline; gap: 10px; font-size: 16px; margin: 0 0 10px; border: 0; padding: 0; line-height: 1.4; }
.h2-gap { margin-top: 18px !important; }
.empty, .more, .hint { color: var(--ink-3); font-size: 13px; margin: 4px 0 8px; line-height: 1.7; }
.mini { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mini li { margin: 0; }
.mini button { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; }
.mini button:hover { border-color: var(--border-strong); }
.mini-title { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cid { font-size: 12px; color: var(--accent); font-weight: 600; white-space: nowrap; margin: 0; }
.tag { font-family: var(--mono); font-size: 10.5px; padding: 1px 6px; border-radius: 6px; border: 1px solid var(--border-strong); color: var(--ink-2); white-space: nowrap; }
.tag.gpu { color: var(--violet); border-color: color-mix(in srgb, var(--violet) 45%, transparent); }
.tag.author, .tag.review { color: var(--s-review); border-color: color-mix(in srgb, var(--s-review) 45%, transparent); }

.prompt { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-top: 8px; background: var(--surface-2); }
.prompt-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.prompt-label { font-size: 13px; font-weight: 600; }
.prompt-text { margin: 6px 0 0; font-family: var(--mono); font-size: 12.5px; line-height: 1.7; color: var(--ink-2); word-break: break-all; }
.copy { flex-shrink: 0; font-size: 12px !important; padding: 4px 10px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); transition: border-color .2s; }
.copy:hover { border-color: var(--accent); color: var(--accent); }

.filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; margin-bottom: 12px; }
.filters label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-3); }
.filters select, .filters input { font: inherit; font-size: 14px; color: var(--ink); background: var(--surface); border: 1px solid var(--border-strong); border-radius: 8px; padding: 6px 10px; min-width: 140px; }
.filters .search { flex: 1; min-width: 200px; }
.filters .search input { width: 100%; }
.count { font-family: var(--mono); font-size: 12px; color: var(--ink-3); padding-bottom: 8px; }

.tabs { display: none; }
.board { display: grid; grid-template-columns: repeat(5, minmax(220px, 1fr)); gap: 12px; overflow-x: auto; padding-bottom: 4px; }
.col { background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; display: flex; flex-direction: column; min-width: 0; }
.col-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; font-weight: 600; font-size: 14px; border-bottom: 1px solid var(--border); }
.col-head b { margin-left: auto; font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
.col-body { padding: 8px 10px 12px; display: flex; flex-direction: column; gap: 8px; max-height: 72vh; overflow-y: auto; }
.group { margin: 6px 2px 0; font-family: var(--mono); font-size: 11px; color: var(--ink-3); letter-spacing: .04em; }
.card { text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; transition: border-color .2s, transform .2s; }
.card:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.card-top { display: flex; align-items: center; gap: 6px; }
.size { font-family: var(--mono); font-size: 11px; color: var(--ink-3); margin-left: auto; }
.card-title { font-size: 13.5px; line-height: 1.5; }
.card-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; color: var(--ink-3); }
.wait { color: var(--ink-3); }
.progress { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--ink-3); }
.pbar { flex: 1; height: 4px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); overflow: hidden; }
.pbar i { display: block; height: 100%; background: var(--s-done); }

.scrim { position: fixed; inset: 0; background: rgba(11, 18, 32, .42); z-index: 100; display: flex; justify-content: flex-end; }
.drawer { width: min(640px, 100vw); height: 100%; overflow-y: auto; background: var(--surface); border-left: 1px solid var(--border); padding: 20px 24px 40px; box-shadow: -12px 0 40px rgba(15, 23, 42, .18); }
.drawer-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.drawer-head h2 { font-size: 20px; margin: 4px 0 0; line-height: 1.4; border: 0; padding: 0; }
.close { border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; width: 32px; height: 32px; font-size: 18px !important; line-height: 1; flex-shrink: 0; }
.meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 14px; margin: 16px 0; padding: 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; }
.meta div { min-width: 0; }
.meta .wide { grid-column: 1 / -1; }
.meta dt { font-size: 11px; color: var(--ink-3); font-family: var(--mono); letter-spacing: .06em; }
.meta dd { margin: 2px 0 0; font-size: 13px; display: flex; flex-wrap: wrap; gap: 6px; overflow-wrap: anywhere; }
.dep { font-family: var(--mono); font-size: 12px !important; border: 1px solid var(--border-strong); background: var(--surface); border-radius: 6px; padding: 2px 8px; }
.dep[data-status="done"], .dep[data-status="review"] { color: var(--s-done); border-color: color-mix(in srgb, var(--s-done) 40%, transparent); }
.drawer-prompts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.sec h3 { font-size: 14px; margin: 18px 0 6px; display: flex; gap: 8px; align-items: baseline; border: 0; padding: 0; }
.sec-count { font-size: 12px; color: var(--ink-3); font-weight: 400; }
.md { font-size: 14px; line-height: 1.75; color: var(--ink-2); overflow-wrap: anywhere; }
.md :deep(p) { margin: 4px 0; }
.md :deep(ul), .md :deep(ol) { margin: 4px 0; padding-left: 20px; }
.md :deep(ul) { list-style: disc; }
.md :deep(ol) { list-style: decimal; }
.md :deep(li) { margin: 2px 0; }
.md :deep(li.sub) { margin-left: 16px; list-style: circle; }
.md :deep(.md-checks) { list-style: none; padding-left: 0; }
.md :deep(.md-checks li) { display: flex; gap: 8px; align-items: baseline; }
.md :deep(.box) { width: 13px; height: 13px; border: 1.5px solid var(--border-strong); border-radius: 4px; flex-shrink: 0; position: relative; top: 2px; }
.md :deep(li.ok .box) { background: var(--s-done); border-color: var(--s-done); }
.md :deep(li.ok) { color: var(--ink); }
.md :deep(pre) { background: var(--code); color: #E2E8F0; padding: 10px 12px; border-radius: 8px; overflow-x: auto; font-size: 12.5px; }
.md :deep(pre code) { background: none; border: 0; color: inherit; padding: 0; }
.md :deep(a) { color: var(--accent); }

@media (max-width: 1100px) {
  .phases { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .duo { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .hgb { padding-top: 20px; }
  .head { flex-direction: column; align-items: flex-start; }
  .phases { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tabs { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 10px; padding-bottom: 2px; }
  .tabs button { flex-shrink: 0; font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); }
  .tabs button.on { border-color: var(--accent); color: var(--accent); }
  .board { display: block; overflow: visible; }
  .col { display: none; }
  .col.mobile-on { display: flex; }
  .col-body { max-height: none; }
  .drawer { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .card, .phase, .copy { transition: none; }
  .card:hover { transform: none; }
}
</style>
