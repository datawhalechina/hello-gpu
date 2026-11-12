<script setup lang="ts">
/**
 * 观摩模式（L-05；03 第 6 节第 4 条，04 第 2 节，07 第 10 节第 3 条）：没有 GPU 的读者回放实验档案馆里的一次真实运行。
 * LabCard 的「观摩模式」打开它；不在 kit/index.ts 里全局注册，关卡页不直接写。
 *
 * - 选一条记录：LabCard 给出这一关的档案记录（摘要），分路线的关卡默认选读者当前路线的那条。
 *   条目全文按需读（/lab/data/<条目 id>.json，同档案浏览页的「展开详情」），页面里只带摘要。
 * - 逐个单元回放：一次看一个单元的代码和输出（kit/lab/ArchiveCell：文字原样、表格、图表数据画成 SVG），
 *   「下一个单元」往后走，看过的单元可以点上面的编号回去看。文字输出里的通关码只留前缀（lab.ts 的 hideCredentialCodes）：
 *   那是采集记录的人的成绩，输出里写着「也可以粘贴到关卡页」，读者照着贴就把别人的星当成了自己的。
 * - 看到最后一个单元就算看完：关卡记下「看完过观摩」（progress 的 markReplayed），之后做完检查点按观摩完成本关
 *   （Checkpoint 看 completeModeOf：100 XP，不得星）。真卡副本要在真卡上拿到 ★1 才算通关，看完不记进度。
 * - 看到哪一条、第几个单元存在这一关的草稿槽里（useChallenge，同挑战草稿）：收起再打开、刷新以后接着看。
 */
import { computed, onMounted, ref, shallowRef, useId, watch } from 'vue'
import { withBase } from 'vitepress'
import ArchiveCell from './lab/ArchiveCell.vue'
import { formatAt, hideCredentialCodes, ROUTE_NAMES } from '@course/lab.ts'
import { archiveDataPath, archiveHref, type ArchiveEntry, type ArchiveSummary } from '@course/labArchive.ts'
import { platformById } from '@course/labPlatforms.ts'
import { XP_WATCH } from '@course/progress.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'

/** 回放进度在这一关草稿槽里的编号（导入成绩用的是 lab，见 useLab.ts）。 */
const REPLAY_ID = 'lab-replay'

const props = defineProps<{
  /** 关卡 id 或真卡副本 id。 */
  stage: string
  /** 关卡还是真卡副本（lab.ts 的 labTarget().kind）：副本看完不记进度。 */
  kind: 'stage' | 'dungeon'
  /** 能回放的记录，按 compareEntries 排好（真实记录在前、新的在前），至少一条。 */
  entries: readonly ArchiveSummary[]
}>()

const progress = useProgress()
const uid = useId()
const saved = useChallenge({ stage: props.stage, id: REPLAY_ID, kind: 'explore' })

/** 草稿槽里记的位置。 */
interface ReplayDraft {
  /** 档案条目 id。 */
  entry: string
  /** 正在看第几个单元（从 0 数）。 */
  cell: number
  /** 这一条最远看到了第几个单元。 */
  seen: number
}

/** 草稿槽里读出来的可能被手改坏：不是这个形状就当没看过。 */
function readDraft(raw: unknown): ReplayDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const index = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)
  return typeof r.entry === 'string' ? { entry: r.entry, cell: index(r.cell), seen: index(r.seen) } : null
}

const rows = computed(() => props.entries.map((e) => ({ ...e, platformName: platformById(e.platform)?.name ?? e.platform })))

const chosen = ref('')
const cell = ref(0)
const seen = ref(0)

type Loaded = { status: 'loading' } | { status: 'ready'; entry: ArchiveEntry } | { status: 'error'; message: string }
const loaded = shallowRef<Loaded | null>(null)
const entry = computed(() => (loaded.value?.status === 'ready' ? loaded.value.entry : null))
const errorText = computed(() => (loaded.value?.status === 'error' ? loaded.value.message : ''))
const cells = computed(() => entry.value?.cells ?? [])
const last = computed(() => cells.value.length - 1)
const done = computed(() => cells.value.length > 0 && seen.value >= last.value)

/** 读屏念的这一个单元：小节和一句话说明。 */
const cellLabel = computed(() => {
  const c = cells.value[cell.value]
  return c ? `${c.section}${c.title ? `，${c.title}` : ''}` : ''
})

/** 默认回放哪一条：读者当前路线的那条（分路线的关卡），没有就是第一条（真实记录在前、新的在前）。 */
function defaultEntry(): string {
  return (props.entries.find((e) => e.route === progress.state.prefs.route) ?? props.entries[0])?.id ?? ''
}

/** 正在看的单元：文字输出里的通关码换成只剩前缀，hidden 记下这一格有没有换过。 */
const shown = computed(() => {
  const c = cells.value[cell.value]
  if (!c) return null
  let hidden = false
  const outputs = c.outputs.map((output) => {
    if (output.kind !== 'text') return output
    const text = hideCredentialCodes(output.text)
    if (text === output.text) return output
    hidden = true
    return { ...output, text }
  })
  return { cell: { ...c, outputs }, hidden }
})

// ── 读条目全文 ────────────────────────────────────────────────────────────

/** 读过的条目：换回来不用再读一遍。 */
const read = new Map<string, ArchiveEntry>()
/** 每次读一个序号：慢的那次回来时读者已经换了一条，就丢掉它。 */
let latest = 0

async function load(id: string) {
  const mine = ++latest
  const hit = read.get(id)
  if (hit) {
    loaded.value = { status: 'ready', entry: hit }
    settle()
    return
  }
  loaded.value = { status: 'loading' }
  try {
    const response = await fetch(withBase(archiveDataPath(id)))
    if (!response.ok) throw new Error(`服务器返回 ${response.status}`)
    const data = (await response.json()) as ArchiveEntry
    if (!Array.isArray(data?.cells) || !data.cells.length) throw new Error('这条记录里没有 Notebook 单元')
    read.set(id, data)
    if (mine !== latest) return
    loaded.value = { status: 'ready', entry: data }
    settle()
  } catch (error) {
    if (mine === latest) loaded.value = { status: 'error', message: (error as Error).message }
  }
}

/** 读到条目以后：记的位置超出这条的单元数就收回来；之前已经看完的，补记一次「看完过」。 */
function settle() {
  cell.value = Math.min(cell.value, last.value)
  seen.value = Math.max(Math.min(seen.value, last.value), cell.value)
  if (done.value) finish()
}

// ── 回放 ──────────────────────────────────────────────────────────────────

function persist() {
  const draft: ReplayDraft = { entry: chosen.value, cell: cell.value, seen: seen.value }
  saved.draft.value = draft
}

function choose(id: string) {
  if (id === chosen.value) return
  chosen.value = id
  cell.value = 0
  seen.value = 0
  persist()
  void load(id)
}

/** 去第 index 个单元：往后只能一个一个走（最远到看过的下一个），往回随便。 */
function go(index: number) {
  if (!entry.value || index === cell.value || index < 0 || index > last.value || index > seen.value + 1) return
  cell.value = index
  seen.value = Math.max(seen.value, index)
  persist()
  if (done.value) finish()
}

/** 看完了：关卡记下「看完过观摩」，做完检查点时按观摩完成。副本不记。 */
function finish() {
  if (props.kind === 'stage' && !progress.stage(props.stage).replayed) progress.markReplayed(props.stage)
}

/** 从草稿槽接着看：记的那一条还在就回到记的位置，否则从默认那一条的开头看。 */
function restore() {
  const draft = readDraft(saved.record.draft)
  const keep = draft && props.entries.some((e) => e.id === draft.entry) ? draft : null
  if (keep && keep.entry === chosen.value && keep.cell === cell.value && keep.seen === seen.value) return
  chosen.value = keep?.entry ?? defaultEntry()
  cell.value = keep?.cell ?? 0
  seen.value = Math.max(keep?.seen ?? 0, cell.value)
  if (chosen.value) void load(chosen.value)
}

// 草稿槽在 useChallenge 挂载时读好（它的 onMounted 先登记）；换存档、重置以后它重新读，这里跟着回到记下的位置。
onMounted(restore)
watch(() => saved.record.draft, restore)

// ── 看完以后 ──────────────────────────────────────────────────────────────

/** 本页这一关的检查点（Checkpoint 的根元素带 data-stage）。 */
const checkpoint = shallowRef<HTMLElement | null>(null)
onMounted(() => {
  if (props.kind !== 'stage') return
  checkpoint.value = document.querySelector<HTMLElement>(`.hg-check[data-stage="${CSS.escape(props.stage)}"]`)
})

const doneText = computed(() => {
  if (props.kind === 'dungeon') return '副本要在真卡上拿到 ★1 才算通关：观摩只是看一遍真实的运行，不记进度。'
  const s = progress.stage(props.stage)
  if (s.completed) {
    return s.watched
      ? '本关已经以观摩完成。以后有了 GPU，在 Notebook 里做完挑战、导入通关码，照样可以拿星。'
      : '本关已经完成过了，观摩不再加经验值。'
  }
  if (s.stars.length) return '你已经用真卡拿到了星，做完本页的检查点照常完成本关。'
  return `接下来做完本页的检查点，就以观摩完成本关：+${XP_WATCH} XP，不得星。以后有了 GPU，导入通关码照样可以拿星。`
})
const showJump = computed(() => Boolean(checkpoint.value) && !progress.stage(props.stage).completed)

/** 跳到本页的检查点，焦点放在第一个还能选的选项上。 */
function toCheckpoint() {
  const el = checkpoint.value
  if (!el) return
  el.scrollIntoView({ block: 'start' })
  el.querySelector<HTMLElement>('.hg-check__option:not([aria-disabled="true"])')?.focus({ preventScroll: true })
}
</script>

<template>
  <div class="hg-replay">
    <fieldset class="hg-replay__pick">
      <legend class="hg-replay__label">选一条运行记录</legend>
      <label
        v-for="row in rows"
        :key="row.id"
        class="hg-replay__entry"
        :class="{ 'is-chosen': row.id === chosen, 'is-example': row.example }"
      >
        <input
          type="radio"
          class="hg-replay__radio"
          :name="`${uid}-entry`"
          :value="row.id"
          :checked="row.id === chosen"
          @change="choose(row.id)"
        />
        <span class="hg-replay__entry-body">
          <span class="hg-replay__tags">
            <span class="hg-replay__tag is-route">{{ ROUTE_NAMES[row.route] }}</span>
            <span v-if="row.example" class="hg-replay__tag is-example">示例，不是实测</span>
          </span>
          <span class="hg-replay__device">{{ row.deviceInfo.name }}</span>
          <span class="hg-replay__meta">{{ formatAt(row.at) }} · {{ row.platformName }} · {{ row.cells }} 个单元</span>
        </span>
      </label>
    </fieldset>
    <p v-if="chosen" class="hg-replay__source">
      完整环境和原始计时样本在<a :href="withBase(archiveHref(chosen))">实验档案馆的这条记录</a>里。
    </p>

    <p v-if="!loaded || loaded.status === 'loading'" class="hg-replay__wait" role="status">正在读取这条记录……</p>
    <p v-else-if="errorText" class="hg-replay__error" role="alert">
      读不到这条记录（{{ errorText }}）。检查网络以后
      <button type="button" class="hg-replay__btn" @click="load(chosen)">再试一次</button>
    </p>
    <div v-else-if="entry" class="hg-replay__player">
      <p v-if="entry.note" class="hg-replay__note">{{ entry.note }}</p>

      <ol class="hg-replay__steps" aria-label="这条记录的单元">
        <li v-for="(c, i) in cells" :key="i">
          <button
            type="button"
            class="hg-replay__step"
            :aria-current="i === cell ? 'step' : undefined"
            :disabled="i > seen"
            @click="go(i)"
          >
            <span class="hg-replay__num" aria-hidden="true">{{ i + 1 }}</span>
            {{ c.section }}
            <span class="hg-visually-hidden">：第 {{ i + 1 }} 个单元{{ c.title ? `，${c.title}` : '' }}{{ i > seen ? '，还没看到' : '' }}</span>
          </button>
        </li>
      </ol>

      <p class="hg-replay__count" aria-live="polite">
        第 {{ cell + 1 }} / {{ cells.length }} 个单元<span class="hg-visually-hidden">：{{ cellLabel }}</span>
      </p>
      <ArchiveCell v-if="shown" :key="`${chosen}:${cell}`" :cell="shown.cell" />
      <p v-if="shown?.hidden" class="hg-replay__fine">通关链接和通关码只留了开头：那是采集这条记录的人的成绩，不是你的。</p>

      <div class="hg-replay__nav">
        <button type="button" class="hg-replay__btn" :aria-disabled="cell === 0" @click="go(cell - 1)">上一个单元</button>
        <button type="button" class="hg-replay__btn is-primary" :aria-disabled="cell >= last" @click="go(cell + 1)">下一个单元</button>
      </div>

      <div v-if="done" class="hg-replay__done" role="status">
        <p><strong>看完了这次运行。</strong>{{ doneText }}</p>
        <button v-if="showJump" type="button" class="hg-replay__btn" @click="toCheckpoint">去做检查点</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hg-replay {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  margin: 12px 0 0;
}

/* ---------- 选记录 ---------- */

.hg-replay__pick {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.hg-replay__label {
  margin: 0 0 6px;
  padding: 0;
  font-size: 14px;
  font-weight: 600;
}

.hg-replay__entry {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.hg-replay__entry:hover,
.hg-replay__entry.is-chosen {
  border-color: var(--hg-accent-ink);
}

/* 示例：虚线框（同档案浏览页），不只靠颜色 */
.hg-replay__entry.is-example {
  border-style: dashed;
}

.hg-replay__radio {
  flex: none;
  width: 16px;
  height: 16px;
  margin: 3px 0 0;
  accent-color: var(--hg-accent-ink);
}

.hg-replay__radio:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-replay__entry-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.hg-replay__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.hg-replay__tag {
  padding: 0 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-ink-2);
  font-size: var(--hg-text-label);
  font-weight: 700;
  line-height: 20px;
  white-space: nowrap;
}

.hg-replay__tag.is-route {
  border-color: var(--hg-sky-ink);
  color: var(--hg-sky-ink);
}

.hg-replay__tag.is-example {
  border-style: dashed;
  border-color: var(--hg-amber);
  color: var(--hg-amber-ink);
}

.hg-replay__device {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.hg-replay__meta,
.hg-replay__source {
  color: var(--hg-ink-2);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.hg-replay__source {
  margin: 0;
}

/* ---------- 回放 ---------- */

.hg-replay__wait,
.hg-replay__error {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.hg-replay__error {
  color: var(--hg-error-ink);
}

.hg-replay__player {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  padding: 12px 0 0;
  border-top: var(--hg-border-width) dashed var(--hg-border);
}

.hg-replay__note {
  margin: 0;
  padding: 8px 12px;
  border: var(--hg-border-width) dashed var(--hg-amber);
  border-radius: var(--hg-radius-control);
  font-size: 14px;
}

.hg-replay__steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-replay__steps li {
  margin: 0;
}

/* 单元编号：看过的实线框，正在看的深底反色，还没看到的虚线框、点不了（形状不同，不只靠颜色）。 */
.hg-replay__step {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px 0 4px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.hg-replay__step:disabled {
  border-style: dashed;
  color: var(--hg-ink-3);
  cursor: default;
}

.hg-replay__step[aria-current='step'] {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-replay__num {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.hg-replay__step:disabled .hg-replay__num {
  color: var(--hg-ink-3);
}

.hg-replay__fine {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.hg-replay__count {
  margin: 0;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-replay__nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
}

.hg-replay__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
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

.hg-replay__btn:hover {
  border-color: var(--hg-accent);
}

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节，同 LabCard 的「导入」）。 */
.hg-replay__btn.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

/* 到头了：按钮留在原处、焦点不丢，只是点了没反应 */
.hg-replay__btn[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-replay__btn:focus-visible,
.hg-replay__step:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-replay__done {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  padding: 12px 14px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-accent-soft);
  font-size: 15px;
}

.hg-replay__done p {
  flex: 1 1 18em;
  margin: 0;
}

.hg-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
