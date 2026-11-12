<script setup lang="ts">
/**
 * 实验档案馆（L-04；07 第 8、10 节，09 第 4 节）：真卡上的完整运行记录，正文里的实测数字都从这里引用。
 *
 * - 列表来自构建时的数据加载器（@course/labArchive.data.ts），每条一行摘要。按区域、关卡、设备筛选，
 *   每个选项后面写着按另外两项筛完还剩几条；按大纲顺序分关卡（真卡副本排在它所在区域的关卡后面），
 *   一关里真实记录在前、示例在后、新的在前。每一关的分组以关卡 id 为锚点（/lab/#forge-softmax）。
 * - 展开详情时才读条目全文（/lab/data/<条目 id>.json），读到以后交给 LabEntryDetail。
 * - 地址里的 #<条目 id>（EvidenceCard、LabCard 的「档案条目」链接）：这一条描边并自动展开；被筛选藏起来时先清空筛选；
 *   档案里没有这一条时在页头说一句。挂载以后才读地址：服务端渲染和水合时都没有描边、没有展开，前后一致。
 * - 示例条目（_example/）标着「示例，不是实测」。
 * 小核不出场：01 第 5 节，小核不出现在数据结论和表格旁边。
 */
import { computed, nextTick, onMounted, reactive, ref, shallowReactive, useId, watch } from 'vue'
import { useRoute, withBase } from 'vitepress'
import LabEntryDetail from './LabEntryDetail.vue'
import { data } from '@course/labArchive.data.ts'
import { ROUTE_NAMES, formatAt, formatNumber, labTarget, metricLabel, metricUnit } from '@course/lab.ts'
import {
  archiveDataPath, compareEntries, facetCounts, filterEntries, headlineMetrics, type ArchiveEntry, type ArchiveFilters,
} from '@course/labArchive.ts'
import { platformById } from '@course/labPlatforms.ts'
import { EXERCISE_LIST, STAGES, ZONES, exerciseById, isPublished, stageById, zoneById } from '@course/outline.ts'

const uid = useId()

// ── 列表 ────────────────────────────────────────────────────────────────

/** 有实验室的关卡和真卡副本，按区域、大纲顺序（同一个区域里关卡在前、副本在后）。 */
const LAB_ORDER = new Map(ZONES.flatMap((zone) => [
  ...STAGES.filter((s) => s.zone === zone.id && s.gpu).map((s) => s.id),
  ...EXERCISE_LIST.filter((e) => e.zone === zone.id && e.env === 'gpu').map((e) => e.id),
]).map((id, i) => [id, i]))
/** 有真卡关卡的区域：铸造城、试炼场。 */
const LAB_ZONES = ZONES.filter((zone) => STAGES.some((s) => s.zone === zone.id && s.gpu))

/** 关卡（或真卡副本）在哪个区域。 */
function zoneOf(stage: string): string {
  return stageById(stage)?.zone ?? exerciseById(stage)?.zone ?? ''
}

function byLabOrder(a: string, b: string): number {
  return (LAB_ORDER.get(a) ?? LAB_ORDER.size) - (LAB_ORDER.get(b) ?? LAB_ORDER.size)
}

const rows = data.entries.map((entry) => ({
  ...entry,
  zone: zoneOf(entry.stage),
  platformName: platformById(entry.platform)?.name ?? entry.platform,
  headline: headlineMetrics(entry.metrics).map(([name, value]) => ({
    name, label: metricLabel(name), text: `${formatNumber(value)} ${metricUnit(name)}`.trim(),
  })),
}))
const exampleCount = rows.filter((row) => row.example).length
/** 设备下拉框里的名字：文件名里的写法 → GPU 名称。 */
const DEVICE_NAMES = new Map(rows.map((row) => [row.device, row.deviceInfo.name]))

// ── 筛选 ────────────────────────────────────────────────────────────────

const NO_FILTERS: ArchiveFilters = { zone: '', stage: '', device: '' }
const filters = reactive<ArchiveFilters>({ ...NO_FILTERS })
const filtered = computed(() => Boolean(filters.zone || filters.stage || filters.device))
const shown = computed(() => filterEntries(rows, filters))

const zoneCounts = computed(() => facetCounts(rows, filters, 'zone'))
const zoneAll = computed(() => filterEntries(rows, filters, 'zone').length)

/** 关卡下拉框：按区域分组，只列有记录的关卡；选中的那一关筛完是 0 条也留着，下拉框不会变成空白。 */
const stageGroups = computed(() => {
  const counts = facetCounts(rows, filters, 'stage')
  const ids = [...new Set([...counts.keys(), ...(filters.stage ? [filters.stage] : [])])].sort(byLabOrder)
  return LAB_ZONES
    .map((zone) => ({
      zone,
      options: ids.filter((id) => zoneOf(id) === zone.id).map((id) => ({ id, label: labTarget(id)?.name ?? id, count: counts.get(id) ?? 0 })),
    }))
    .filter((group) => group.options.length)
})
const stageAll = computed(() => filterEntries(rows, filters, 'stage').length)

const deviceOptions = computed(() => {
  const counts = facetCounts(rows, filters, 'device')
  const ids = [...new Set([...counts.keys(), ...(filters.device ? [filters.device] : [])])]
  return ids.map((id) => ({ id, label: DEVICE_NAMES.get(id) ?? id, count: counts.get(id) ?? 0 }))
})
const deviceAll = computed(() => filterEntries(rows, filters, 'device').length)

// 换了区域、选中的关卡不在这个区域里：关卡回到「全部」
watch(() => filters.zone, (zone) => {
  if (zone && filters.stage && zoneOf(filters.stage) !== zone) filters.stage = ''
})

function clearFilters() {
  Object.assign(filters, NO_FILTERS)
}

const foundText = computed(() => {
  const examples = exampleCount ? `（其中 ${exampleCount} 条是示例）` : ''
  return filtered.value ? `找到 ${shown.value.length} 条，共 ${rows.length} 条记录${examples}。` : `共 ${rows.length} 条记录${examples}。`
})

const groups = computed(() => {
  const byStage = new Map<string, typeof rows>()
  for (const row of shown.value) byStage.set(row.stage, [...(byStage.get(row.stage) ?? []), row])
  return [...byStage.keys()].sort(byLabOrder).map((stage) => {
    const target = labTarget(stage)
    return {
      stage,
      name: target?.name ?? stage,
      zone: zoneById(zoneOf(stage))?.name ?? '',
      href: target && isPublished(target) ? target.page : '',
      entries: [...byStage.get(stage)!].sort(compareEntries),
    }
  })
})

// ── 展开详情 ────────────────────────────────────────────────────────────

type Detail = { status: 'loading' } | { status: 'ready'; entry: ArchiveEntry } | { status: 'error'; message: string }

const open = reactive(new Set<string>())
/** 读过的条目全文：收起再展开不用重新读。 */
const details = shallowReactive(new Map<string, Detail>())

async function load(id: string) {
  if (details.has(id) && details.get(id)!.status !== 'error') return
  details.set(id, { status: 'loading' })
  try {
    const response = await fetch(withBase(archiveDataPath(id)))
    if (!response.ok) throw new Error(`服务器返回 ${response.status}`)
    details.set(id, { status: 'ready', entry: await response.json() as ArchiveEntry })
  } catch (error) {
    details.set(id, { status: 'error', message: (error as Error).message })
  }
}

function toggle(id: string) {
  if (open.has(id)) {
    open.delete(id)
    return
  }
  open.add(id)
  void load(id)
}

// ── 从 EvidenceCard、LabCard 跳过来的条目 ──────────────────────────────

const route = useRoute()
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
/** 地址里的 #<条目 id>。挂载以后才读：服务端渲染和水合时都没有，前后一致。 */
const target = computed(() => (mounted.value ? route.hash.replace(/^#/, '') : ''))
/** 条目 id 都带 /；地址里是一个带 / 的 id，档案里却没有这一条。 */
const missing = computed(() => (target.value.includes('/') && !rows.some((row) => row.id === target.value) ? target.value : ''))

watch(target, async (id) => {
  if (!rows.some((row) => row.id === id)) return
  if (!shown.value.some((row) => row.id === id)) clearFilters()
  open.add(id)
  await load(id)
  await nextTick()
  // 详情展开以后页面才够长：再滚一次，让这一条的开头停在顶栏下面（被筛选藏起来的，清空筛选以后也靠这一次滚到）
  if (target.value === id) document.getElementById(id)?.scrollIntoView({ block: 'start' })
})
</script>

<template>
  <div class="la">
    <header class="la-head">
      <p class="la-eyebrow">LAB ARCHIVE</p>
      <h1 class="la-head__title">实验档案馆</h1>
      <p class="la-head__lead">
        铸造城和试炼场正文里的实测数字，都出自这里的记录。每条记录是一次真卡上的完整运行：通关凭证、完整环境、原始样本和 Notebook 的关键输出，展开就能看。
      </p>
      <p v-if="missing" class="la-missing" role="status">
        地址里的档案条目 <code translate="no">{{ missing }}</code> 不在档案馆里：可能写错了，或者这条记录改了名字。下面是现有的全部记录。
      </p>
    </header>

    <section class="la-filters" :aria-labelledby="`${uid}-filters`">
      <h2 :id="`${uid}-filters`" class="la-hidden">筛选</h2>
      <fieldset class="la-zones">
        <legend class="la-label">区域</legend>
        <div class="la-zones__options">
          <label class="la-zone">
            <input v-model="filters.zone" type="radio" :name="`${uid}-zone`" value="">
            <span class="la-zone__text">全部<span class="la-count">{{ zoneAll }}</span></span>
          </label>
          <label v-for="zone in LAB_ZONES" :key="zone.id" class="la-zone">
            <input v-model="filters.zone" type="radio" :name="`${uid}-zone`" :value="zone.id">
            <span class="la-zone__text">{{ zone.name }}<span class="la-count">{{ zoneCounts.get(zone.id) ?? 0 }}</span></span>
          </label>
        </div>
      </fieldset>
      <label class="la-field">
        <span class="la-label">关卡</span>
        <select v-model="filters.stage" class="la-select">
          <option value="">全部关卡（{{ stageAll }} 条）</option>
          <optgroup v-for="group in stageGroups" :key="group.zone.id" :label="group.zone.name">
            <option v-for="o in group.options" :key="o.id" :value="o.id">{{ o.label }}（{{ o.count }} 条）</option>
          </optgroup>
        </select>
      </label>
      <label class="la-field">
        <span class="la-label">设备</span>
        <select v-model="filters.device" class="la-select">
          <option value="">全部设备（{{ deviceAll }} 条）</option>
          <option v-for="o in deviceOptions" :key="o.id" :value="o.id">{{ o.label }}（{{ o.count }} 条）</option>
        </select>
      </label>
      <div class="la-found">
        <p role="status">{{ foundText }}</p>
        <button v-if="filtered" type="button" class="la-btn" @click="clearFilters">清除筛选</button>
      </div>
    </section>

    <p v-if="!rows.length" class="la-empty">
      档案馆里还没有记录。铸造城、试炼场的关卡在真卡上跑通以后，参考运行记录会存进这里。
    </p>
    <p v-else-if="!groups.length" class="la-empty">没有符合筛选的记录，换一个条件或者清除筛选。</p>

    <section v-for="group in groups" :id="group.stage" :key="group.stage" class="la-group" :aria-labelledby="`${uid}-${group.stage}`">
      <div class="la-group__head">
        <h2 :id="`${uid}-${group.stage}`" class="la-group__title">{{ group.name }}</h2>
        <span class="la-tag">{{ group.zone }}</span>
        <span class="la-count">{{ group.entries.length }} 条</span>
        <a v-if="group.href" class="la-group__link" :href="withBase(group.href)">去关卡页</a>
        <span v-else class="la-group__soon">关卡页还在建设中</span>
      </div>

      <ul class="la-entries">
        <li
          v-for="row in group.entries"
          :id="row.id"
          :key="row.id"
          class="la-entry"
          :class="{ 'is-target': target === row.id, 'is-example': row.example }"
        >
          <div class="la-entry__head">
            <p class="la-entry__tags">
              <span class="la-tag is-route">{{ ROUTE_NAMES[row.route] }}</span>
              <span v-if="row.example" class="la-tag is-example">示例，不是实测</span>
            </p>
            <h3 class="la-entry__device">{{ row.deviceInfo.name }}</h3>
            <p class="la-entry__meta">
              <span translate="no">{{ row.deviceInfo.gfx }}</span> · {{ row.deviceInfo.cus }} 个计算单元 · {{ formatAt(row.at) }}
              · {{ row.platformName }} · 采集：{{ row.collector }}
            </p>
          </div>

          <dl class="la-entry__numbers">
            <div>
              <dt>校验</dt>
              <dd>{{ row.checks.passed }}/{{ row.checks.total }} 通过</dd>
            </div>
            <div v-for="m in row.headline" :key="m.name">
              <dt>{{ m.label }}</dt>
              <dd>{{ m.text }}</dd>
            </div>
          </dl>

          <button
            type="button"
            class="la-toggle"
            :aria-expanded="open.has(row.id)"
            :aria-controls="`${uid}-detail-${row.id}`"
            @click="toggle(row.id)"
          >
            <svg class="la-toggle__icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor"
              stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 6l4 4 4-4" />
            </svg>
            {{ open.has(row.id) ? '收起详情' : '展开详情' }}
          </button>

          <div v-if="open.has(row.id)" :id="`${uid}-detail-${row.id}`" class="la-entry__detail">
            <p v-if="details.get(row.id)?.status === 'loading'" class="la-note" role="status">正在读取这条记录……</p>
            <p v-else-if="details.get(row.id)?.status === 'error'" class="la-note is-error" role="alert">
              读不到这条记录（{{ (details.get(row.id) as { message: string }).message }}）。检查网络以后
              <button type="button" class="la-btn" @click="load(row.id)">再试一次</button>
            </p>
            <LabEntryDetail
              v-else-if="details.get(row.id)?.status === 'ready'"
              :id="row.id"
              :entry="(details.get(row.id) as { entry: ArchiveEntry }).entry"
            />
          </div>
        </li>
      </ul>
    </section>

    <section class="la-format" :aria-labelledby="`${uid}-format`">
      <h2 :id="`${uid}-format`" class="la-format__title">记录的格式</h2>
      <p>
        每条记录是仓库里的一个 JSON 文件：<code translate="no">docs/lab/data/&lt;关卡 id&gt;/&lt;路线&gt;-&lt;设备&gt;-&lt;日期&gt;.json</code>，
        字段的写法见 <a :href="withBase('/lab/schema.json')" download>schema.json</a>。
        新增或修改记录以后运行 <code translate="no">npm run course:check</code>：它按格式检查每个字段，还核对文件名、凭证、环境和原始样本对不对得上。
        示例放在 <code translate="no">_example/</code>，标着「示例，不是实测」，正文不能引用。
      </p>
    </section>
  </div>
</template>

<style scoped>
.la {
  font-size: var(--hg-text-handbook);
}

.la-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ---------- 页头 ---------- */

.la-head {
  margin-bottom: 20px;
}

/* 眉标：实验（LAB）用天蓝（01 第 3 节） */
.la-eyebrow {
  margin: 0;
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.la .la-head__title {
  margin: 2px 0 8px;
}

.la-head__lead {
  max-width: 44em;
  margin: 0;
  color: var(--hg-ink-2);
}

.la-missing {
  max-width: 44em;
  margin: 14px 0 0;
  padding: 10px 14px;
  border: var(--hg-border-width) dashed var(--hg-amber);
  border-radius: var(--hg-radius-control);
  color: var(--hg-ink);
  font-size: 14px;
}

/* ---------- 筛选 ---------- */

.la-filters {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr);
  align-items: end;
  gap: 14px 20px;
  margin-bottom: 28px;
  padding: 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.la-label {
  display: block;
  margin-bottom: 6px;
  padding: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
  font-weight: 600;
}

.la-zones {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

/* 区域：分段控件（单选框藏在每一段里，键盘用方向键切换） */
.la-zones__options {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.la-zone {
  position: relative;
  display: inline-flex;
}

.la-zone input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.la-zone__text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: calc(var(--hg-radius-control) - 3px);
  color: var(--hg-ink-2);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color var(--motion-fast) var(--motion-ease-out), color var(--motion-fast) var(--motion-ease-out);
}

.la-zone input:checked + .la-zone__text {
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.la-zone input:checked + .la-zone__text .la-count {
  color: inherit;
}

.la-zone input:focus-visible + .la-zone__text {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

.la-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.la-select {
  width: 100%;
  min-height: 40px;
  padding: 0 10px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
}

.la-select:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

.la-found {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
}

.la-found p {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.la-count {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.la-btn {
  min-height: 32px;
  padding: 0 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 13.5px;
  cursor: pointer;
}

.la-btn:hover {
  background: var(--hg-surface-2);
}

.la-btn:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

@media (max-width: 767px) {
  .la-filters {
    grid-template-columns: minmax(0, 1fr);
  }
}

.la-empty {
  margin: 0 0 28px;
  padding: 16px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  color: var(--hg-ink-2);
  font-size: 14px;
}

/* ---------- 一关一组 ---------- */

.la-group + .la-group {
  margin-top: 32px;
}

.la-group {
  scroll-margin-top: 80px;
}

.la-group__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  margin-bottom: 12px;
}

/* 正文 h2 的分隔线和大间距去掉，组与组之间的间距由 .la-group 给 */
.la .la-group__title {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 22px;
}

.la-group__link,
.la-group__soon {
  margin-left: auto;
  font-size: 14px;
}

.la-group__soon {
  color: var(--hg-ink-3);
}

.la-tag {
  padding: 0 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-ink-2);
  font-size: var(--hg-text-label);
  font-weight: 700;
  line-height: 20px;
  white-space: nowrap;
}

/* 示例：虚线框 + 字，不只靠颜色（01 第 7 节） */
.la-tag.is-example {
  border-style: dashed;
  border-color: var(--hg-amber);
  color: var(--hg-amber-ink);
}

.la-tag.is-route {
  border-color: var(--hg-sky-ink);
  color: var(--hg-sky-ink);
}

.la-entries {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.la-entry {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  margin: 0;
  padding: 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  scroll-margin-top: 80px;
}

.la-entry.is-example {
  border-style: dashed;
  border-color: var(--hg-border-strong);
}

/* 从别处跳过来的那一条：强调色描边加浅底，描边比平常粗（同手册） */
.la-entry.is-target {
  border-style: solid;
  border-color: var(--hg-accent);
  box-shadow: 0 0 0 1px var(--hg-accent);
}

/* 跳过来时 VitePress 把焦点交给这一条（读屏从这里往下读），描边已经标出位置，不再画焦点框 */
.la-entry:focus {
  outline: none;
}

.la-entry__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.la-entry__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
}

.la .la-entry__device {
  margin: 0;
  font-size: var(--hg-text-card-title);
}

.la-entry__meta {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13.5px;
  overflow-wrap: anywhere;
}

.la-entry__numbers {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
}

.la-entry__numbers dt {
  color: var(--hg-ink-3);
  font-size: 12.5px;
}

.la-entry__numbers dd {
  margin: 0;
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 15px;
  font-weight: 700;
}

.la-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  min-height: 36px;
  padding: 0 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.la-toggle:hover {
  border-color: var(--hg-ink-3);
}

.la-toggle:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

.la-toggle__icon {
  transition: transform var(--motion-fast) var(--motion-ease-out);
}

.la-toggle[aria-expanded='true'] .la-toggle__icon {
  transform: rotate(180deg);
}

.la-entry__detail {
  min-width: 0;
  padding-top: 14px;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.la-note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.la-note.is-error {
  color: var(--hg-error-ink);
}

/* ---------- 格式说明 ---------- */

.la-format {
  margin-top: 40px;
  padding-top: 20px;
  border-top: var(--hg-border-width) solid var(--hg-border);
  color: var(--hg-ink-2);
  font-size: 14px;
}

.la .la-format__title {
  margin: 0 0 8px;
  padding: 0;
  border: 0;
  font-size: 18px;
}

.la-format p {
  margin: 0;
}

.la-format code {
  overflow-wrap: anywhere;
}
</style>
