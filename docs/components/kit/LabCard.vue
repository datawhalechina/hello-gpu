<script setup lang="ts">
/**
 * 实验室入口（L-02；03 第 3 节组件登记表、第 6 节，07 第 8–10 节）：打开实验室、导入成绩、按本关规则重新算星，
 * 没有 GPU 时用观摩模式回放一次真实运行（L-05）。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：真卡关卡页和真卡副本页都只写 <LabCard />。
 * 关卡 id 读页面 frontmatter 的 stage（关卡页）或 dungeon（副本页）；星级规则读 outline.json 里这一关的 lab.stars。
 * 预览页这类页面用 stage 属性指定关卡，用 stars 属性给规则（格式同 lab.stars，正式关卡不写）。
 * entries 是实验档案馆里这一关的记录（摘要），参考数据和观摩模式都用它；关卡页不写，读档案馆里这一关的真实记录
 * （构建时的数据加载器 labArchive.data.ts），示例条目不算，正式页面不引用示例。预览页传示例条目演示。
 *
 * 四块：
 * 1. 打开实验室：下载 .ipynb（同源地址，构建时从仓库复制进站点，见 docs/.vitepress/lab-notebooks.mjs）、在 GitHub 查看、
 *    在云平台上打开（平台、链接和说明在 docs/course/lab-platforms.json，L-06；第一次用的读者去实验环境指南）。
 *    分路线的关卡两条路线都渲染出来，显示哪一条由 <html data-hg-route> 上的 CSS 决定（同 RouteBlock），水合前后一致。
 * 2. 导入成绩：粘贴通关码；页面打开时和地址片段变化时读 #lab=，读到就导入，再把片段从地址里清掉。
 * 3. 成绩：设备、校验、测量数据（和参考数据并排）、逐条星级判定、这次发了什么。
 * 4. 观摩模式：档案馆里有这一关的记录时，打开 LabReplay 逐个单元回放（看完再做完检查点，按观摩完成本关：100 XP，不得星）；
 *    还没有记录时按钮写「数据整理中」。
 * 导入、发星、发徽章在 docs/course/useLab.ts；解码、校验、规则在 docs/course/lab.ts。
 * 关卡 id 或规则写错时画红框，构建失败（和 F-09 的内容检查同一套）。
 */
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useData, withBase } from 'vitepress'
import { BADGE_BY_ID } from '@course/badges.ts'
import {
  checkStageStars, codeFromHash, CREDENTIAL_PREFIX, explainLabError, formatAt, formatNumber, githubUrl, labTarget,
  metricLabel, metricUnit, notebookFile, notebookPath, notebookRoutes, ROUTE_NAMES, type LabStar,
} from '@course/lab.ts'
import { data as archive } from '@course/labArchive.data.ts'
import { archiveHref, archiveReference, compareEntries, type ArchiveSummary } from '@course/labArchive.ts'
import { CLOUD_PLATFORMS, platformLink, SETUP_PAGE, setupHref, stepParts } from '@course/labPlatforms.ts'
import { XP_WATCH, type Route } from '@course/progress.ts'
import { useLab } from '@course/useLab.ts'
import { useProgress } from '@course/useProgress.ts'
import { contentError } from './contentError.ts'
import LabReplay from './LabReplay.vue'

/** 分路线的关卡只有这两条路线，「换成另一条」就是这张表。 */
const OTHER_ROUTE = { hip: 'triton', triton: 'hip' } as const

const props = withDefaults(defineProps<{
  /** 关卡 id 或真卡副本 id；不写时读页面 frontmatter 的 stage（关卡页）或 dungeon（副本页）。 */
  stage?: string
  /** 星级规则，格式同 outline.json 的 lab.stars。只给预览页用；正式关卡不写，规则从大纲读。 */
  stars?: readonly LabStar[]
  /** 实验档案馆里这一关的记录（labArchive.ts 的摘要）。只给预览页用；不写时读档案馆里这一关的真实记录。 */
  entries?: readonly ArchiveSummary[]
}>(), { stage: '', stars: undefined, entries: undefined })

const { frontmatter, page } = useData()
const progress = useProgress()
const uid = useId()
const root = ref<HTMLElement | null>(null)
/** 「你的成绩」那一段：从通关链接回来、导入成功时跳到这里。 */
const resultEl = ref<HTMLElement | null>(null)

const stageId = computed(() => {
  const fm = frontmatter.value
  if (props.stage) return props.stage
  if (typeof fm.stage === 'string' && fm.stage) return fm.stage
  return typeof fm.dungeon === 'string' ? fm.dungeon : ''
})
const target = computed(() => labTarget(stageId.value))
const rules = computed<unknown>(() => props.stars ?? target.value?.stars ?? null)

const problem = computed(() => {
  const where = page.value.relativePath
  const id = stageId.value
  if (!id) return contentError('LabCard 找不到关卡 id：页面 frontmatter 没有 stage（真卡关卡）或 dungeon（真卡副本），也没有传 stage 属性。', where)
  if (!target.value) return contentError(`LabCard 的 ${id} 不是 outline.json 里的真卡关卡（gpu: true）或真卡副本（env: gpu），没有实验室。`, where)
  if (rules.value === null) return contentError(`outline.json 里的 ${id} 还没有 lab.stars（星级规则，07 第 9 节）。`, where)
  try {
    checkStageStars(rules.value)
  } catch (error) {
    return contentError(`${id} 的星级规则 lab.stars 写错了：${(error as Error).message}`, where)
  }
  return ''
})

const lab = useLab({ stage: stageId.value, stars: () => (problem.value ? [] : (rules.value as LabStar[])) })
const { result, error, busy } = lab
const scope = computed(() => (target.value?.kind === 'dungeon' ? '这道题' : '本关'))
/** 实验档案馆里这一关的记录：真实记录在前、新的在前（同档案浏览页）。 */
const records = computed(() => {
  const own = props.entries ?? archive.entries.filter((e) => e.stage === stageId.value && !e.example)
  return [...own].sort(compareEntries)
})
/** 参考数据：档案馆里这一关的每条记录，和读者的数字列在同一张表里。 */
const reference = computed(() => records.value.map(archiveReference))

// ── 打开实验室 ──────────────────────────────────────────────────────────────

const split = computed(() => target.value?.routes === 'split')
const notebooks = computed(() => {
  const t = target.value
  if (!t) return []
  return notebookRoutes(t).map((route) => {
    const path = notebookPath(t, route)
    return {
      route, path, file: notebookFile(t, route), dir: `notebooks/${t.dir}/${t.slug}/`,
      href: withBase(`/${path}`), github: githubUrl(path),
    }
  })
})

/** 云平台（lab-platforms.json）：链接、指南里那一节、点开以后的两三步（{path} 在模板里换成这一本的路径）。 */
const clouds = CLOUD_PLATFORMS.map((p) => ({
  id: p.id, name: p.name, label: p.open.label, href: platformLink(p.open), guide: setupHref(p), steps: p.open.steps,
}))

/** 换路线：这一块藏起来、另一条路线的那块显示出来（偏好同步写到 <html> 上），焦点跟到那一块的切换按钮。 */
function switchRoute(from: Route) {
  const to = OTHER_ROUTE[from]
  progress.setPref('route', to)
  root.value?.querySelector<HTMLButtonElement>(`.hg-lab__way[data-route='${to}'] .hg-lab__switch`)?.focus()
}

// ── 导入成绩 ────────────────────────────────────────────────────────────────

const input = ref('')

async function submit() {
  if (!input.value.trim() || busy.value) return
  if (await lab.importCode(input.value)) input.value = ''
}

/** 通关码里没有换行：在输入框里按 Enter 就是导入（输入法正在选字时的 Enter 不算，Shift + Enter 照常换行）。 */
function onEnter(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  void submit()
}

/** 地址片段是 #lab=<通关码>：先把片段从地址里清掉（刷新、分享这个地址不会再导入一遍），再导入。 */
async function importFromHash() {
  const code = codeFromHash(location.hash)
  if (code === null) return
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  const imported = await lab.importCode(code)
  // 从 Notebook 点链接回来的读者要看的就是成绩（没导入成功时是卡片开头，原因写在「导入成绩」里）。刚打开页面时
  // 上面的内容（字体、异步加载的组件）还在长高，先算好位置再平滑滚动会停在离卡片很远的地方：等排版停下来，再一下跳过去。
  await layoutSettled()
  const target = imported && resultEl.value ? resultEl.value : root.value
  target?.scrollIntoView({ block: 'start', behavior: 'instant' })
}

/** 页面高度 100 ms 内不再变化（最多等 2 秒），就当排版稳定了。 */
async function layoutSettled() {
  await document.fonts?.ready
  let height = -1
  for (let i = 0; i < 20 && document.documentElement.scrollHeight !== height; i++) {
    height = document.documentElement.scrollHeight
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

onMounted(() => {
  if (problem.value) return
  void importFromHash()
  window.addEventListener('hashchange', importFromHash)
})
onBeforeUnmount(() => window.removeEventListener('hashchange', importFromHash))

const errorText = computed(() => (error.value ? explainLabError(error.value, stageId.value) : null))

// ── 成绩 ────────────────────────────────────────────────────────────────────

const credential = computed(() => result.value?.credential ?? null)

const envText = computed(() => {
  const env = credential.value?.env
  return env ? `ROCm ${env.rocm ?? '—'} · PyTorch ${env.torch ?? '—'} · Triton ${env.triton ?? '—'}` : ''
})

/** 测量数据一项一行：读者凭证里的按原顺序，参考记录里多出来的接在后面；没有的格子写「—」。 */
const metricRows = computed(() => {
  const mine = credential.value?.metrics
  if (!mine) return []
  const columns = [mine, ...reference.value.map((r) => r.metrics)]
  const names = [...new Set(columns.flatMap((metrics) => Object.keys(metrics)))]
  return names.map((name) => ({
    name,
    label: metricLabel(name),
    cells: columns.map((metrics) => (Object.hasOwn(metrics, name) ? `${formatNumber(metrics[name])} ${metricUnit(name)}`.trim() : '—')),
  }))
})

/** 这次导入发了什么，一两句话。 */
const outcome = computed(() => {
  const r = result.value
  if (!r) return ''
  if (error.value) return '刚才那串没有导入成功（原因在上面），下面还是上一次导入的成绩。'
  if (r.restored) return '这是你上次导入的成绩，存在这台设备上；星和经验值在导入时已经发过了。'
  const lines: string[] = []
  if (!r.passed) {
    lines.push(`★1 没有达到：「${r.verdicts[0]?.text ?? '结果正确'}」是拿星的前提，这次没有发星。改好以后重新运行「交成绩」单元，再导入一次。`)
  } else if (r.awarded.length) {
    lines.push(`新拿到 ${r.awarded.map((i) => `★${i + 1}`).join('、')}${r.xp > 0 ? `，经验值 +${r.xp}` : ''}。`)
  } else if (!r.capped.length) {
    lines.push('达到的星之前都拿到了：每颗星只计一次，经验值不重复加。')
  }
  if (r.capped.length) {
    lines.push(`你在挑战里看过答案，${scope.value}最多 2 颗星，${r.capped.map((i) => `★${i + 1}`).join('、')} 这次没有发。`)
  }
  if (r.badges.length) lines.push(`新徽章：${r.badges.map((id) => `「${BADGE_BY_ID.get(id)?.name ?? id}」`).join('')}。`)
  return lines.join('')
})

/** 读屏播报：导入成功时念一句这次发了什么（失败的说明框自己是 role="alert"）。 */
const announce = ref('')
watch(result, (r) => {
  announce.value = r && !r.restored ? `导入成功。${outcome.value}` : ''
})

// ── 观摩模式 ────────────────────────────────────────────────────────────────

const watching = ref(false)
/** 进度存档在挂载以后才读：之前不显示跟进度有关的话，水合前后一致（LabCard 是异步组件，水合时存档可能已经读好了）。 */
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})

/** 观摩模式是什么：关卡看完再做完检查点就完成本关；副本没有观摩通关。 */
const watchHint = computed(() => {
  const what = '回放实验档案馆里的一次真实运行：选一条记录，逐个单元看代码和输出。'
  if (target.value?.kind === 'dungeon') return `${what}副本要在真卡上拿到 ★1 才算通关，观摩只是看一遍，不记进度。`
  return `${what}看完再做完本页的检查点，就以观摩完成本关：+${XP_WATCH} XP，不得星；以后有了 GPU，导入通关码照样可以拿星。`
})

/** 收起时的一句进度：观摩完成过、或者看完了还没做检查点。副本没有观摩完成。 */
const watchStatus = computed(() => {
  if (!mounted.value || target.value?.kind !== 'stage') return ''
  const s = progress.stage(stageId.value)
  if (s.completed) return s.watched ? '本关已经以观摩完成。' : ''
  return s.replayed ? '你看完过一次观摩，做完本页的检查点就完成本关。' : ''
})
</script>

<template>
  <p v-if="problem" class="hg-lab-error" role="alert" data-hg-content-error>{{ problem }}</p>
  <section v-else ref="root" class="hg-lab" :aria-labelledby="`${uid}-title`">
    <header class="hg-lab__head">
      <span class="hg-lab__eyebrow" aria-hidden="true">LAB</span>
      <h3 :id="`${uid}-title`" class="hg-lab__title">实验室 · {{ target?.name }}</h3>
      <p class="hg-lab__lead">
        动手的部分在 Notebook 里：在真卡上补全标了 TODO 的代码、校验、计时，最后一个单元打印通关链接和通关码。把成绩带回这一页，网页按{{ scope }}的规则算星。没有 GPU 的话，可以用最后的观摩模式看一次真实的运行。
      </p>
    </header>

    <section class="hg-lab__part" :aria-labelledby="`${uid}-open`">
      <h4 :id="`${uid}-open`" class="hg-lab__step"><span class="hg-lab__num" aria-hidden="true">1</span>打开实验室</h4>
      <div v-for="nb in notebooks" :key="nb.route" class="hg-lab__way" :data-route="nb.route">
        <p class="hg-lab__file">
          <span v-if="split" class="hg-lab__tag">{{ ROUTE_NAMES[nb.route] }}</span>
          <code translate="no">{{ nb.path }}</code>
        </p>
        <ul class="hg-lab__links">
          <li><a class="hg-lab__link" :href="nb.href" :download="nb.file">下载 .ipynb</a></li>
          <li><a class="hg-lab__link" :href="nb.github" target="_blank" rel="noopener">在 GitHub 查看</a></li>
          <li v-if="nb.route !== 'shared'">
            <button type="button" class="hg-lab__switch" @click="switchRoute(nb.route)">
              换成 {{ ROUTE_NAMES[OTHER_ROUTE[nb.route]] }}
            </button>
          </li>
        </ul>
        <p class="hg-lab__note">
          Notebook 要在仓库的 <code translate="no">{{ nb.dir }}</code> 里运行：开头的
          <code translate="no">%run ../../common/bootstrap.py</code> 从那里加载 hello_gpu 教学包。下载下来的放回这个目录。
        </p>
        <details class="hg-lab__cloud">
          <summary>在云平台上打开</summary>
          <div v-for="cloud in clouds" :key="cloud.id" class="hg-lab__platform">
            <p class="hg-lab__platform-head">
              <span class="hg-lab__platform-name">{{ cloud.name }}</span>
              <a :href="cloud.href" target="_blank" rel="noopener">{{ cloud.label }}</a>
              <a :href="withBase(cloud.guide)">第一次用看这里</a>
            </p>
            <ol>
              <li v-for="(step, i) in cloud.steps" :key="i">
                <template v-for="(part, j) in stepParts(step, nb.path)" :key="j">
                  <code v-if="part.code" translate="no">{{ part.text }}</code>
                  <template v-else>{{ part.text }}</template>
                </template>
              </li>
            </ol>
          </div>
          <p>
            账号、费用，以及在自己的机器上怎么装，见<a :href="withBase(SETUP_PAGE)">实验环境指南</a>：每种环境都从零写到在 Notebook 里打出你的 GPU 卡片。
          </p>
        </details>
      </div>
    </section>

    <section class="hg-lab__part" :aria-labelledby="`${uid}-import`">
      <h4 :id="`${uid}-import`" class="hg-lab__step"><span class="hg-lab__num" aria-hidden="true">2</span>导入成绩</h4>
      <p class="hg-lab__hint">点 Notebook 打印的通关链接，会回到这一页自动导入；也可以把通关码贴在下面。</p>
      <form class="hg-lab__form" @submit.prevent="submit">
        <label :for="`${uid}-code`" class="hg-lab__label">通关码</label>
        <textarea
          :id="`${uid}-code`"
          v-model="input"
          class="hg-lab__input"
          rows="3"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          translate="no"
          :placeholder="`${CREDENTIAL_PREFIX}……`"
          @keydown.enter.exact="onEnter"
        />
        <button type="submit" class="hg-lab__submit" :disabled="busy || !input.trim()">{{ busy ? '正在导入…' : '导入' }}</button>
      </form>
      <div v-if="errorText" class="hg-lab__problem" role="alert">
        <p class="hg-lab__problem-title">没能导入</p>
        <dl>
          <div><dt>现象</dt><dd>{{ errorText.symptom }}</dd></div>
          <div><dt>原因</dt><dd>{{ errorText.cause }}</dd></div>
          <div>
            <dt>怎么改</dt>
            <dd>
              {{ errorText.fix }}
              <a v-if="errorText.link" :href="withBase(errorText.link.href)">{{ errorText.link.text }}</a>
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <section v-if="result && credential" ref="resultEl" class="hg-lab__part" :aria-labelledby="`${uid}-result`">
      <h4 :id="`${uid}-result`" class="hg-lab__step"><span class="hg-lab__num" aria-hidden="true">3</span>你的成绩</h4>
      <dl class="hg-lab__meta">
        <div><dt>路线</dt><dd>{{ ROUTE_NAMES[credential.route] }}</dd></div>
        <div><dt>设备</dt><dd>{{ credential.device.name }} · {{ credential.device.gfx }} · {{ credential.device.cus }} CU</dd></div>
        <div><dt>软件</dt><dd>{{ envText }}</dd></div>
        <div><dt>生成于</dt><dd>{{ formatAt(credential.at) }}</dd></div>
        <div><dt>校验</dt><dd>{{ credential.checks.passed }}/{{ credential.checks.total }} 项通过</dd></div>
      </dl>

      <table class="hg-lab__table">
        <thead>
          <tr>
            <th scope="col">测量项</th>
            <th scope="col">你的</th>
            <th v-for="r in reference" :key="r.entry" scope="col">参考：{{ r.device.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in metricRows" :key="row.name">
            <th scope="row">
              <span v-if="row.label !== row.name">{{ row.label }}</span>
              <code translate="no">{{ row.name }}</code>
            </th>
            <td v-for="(cell, i) in row.cells" :key="i">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="reference.length" class="hg-lab__note">
        参考数据来自实验档案馆：<template v-for="(r, i) in reference" :key="r.entry"><template v-if="i">；</template>{{ r.device.name }}（{{ ROUTE_NAMES[r.route] }}，{{ formatAt(r.at) }}）<a :href="withBase(archiveHref(r.entry))">档案条目</a></template>。
      </p>
      <p v-else class="hg-lab__note">参考数据：实验档案馆里还没有这一关的记录。</p>

      <ul class="hg-lab__stars" aria-label="星级判定">
        <li v-for="(v, i) in result.verdicts" :key="i" class="hg-lab__star" :class="{ 'is-earned': v.earned }">
          <span class="hg-lab__glyph" aria-hidden="true">{{ v.earned ? '★' : '☆' }}</span>
          <span class="hg-lab__rule">
            <span class="hg-lab__rule-text">★{{ i + 1 }} {{ v.text }}</span>
            <span class="hg-lab__detail">{{ v.detail }}</span>
          </span>
          <span class="hg-lab__state">{{ v.earned ? '达到' : '没达到' }}</span>
        </li>
      </ul>
      <p class="hg-lab__outcome">{{ outcome }}</p>
      <p class="hg-lab__fine">星级由这一页按{{ scope }}的规则重新计算；凭证里就算写了结论，也一律不看。</p>
    </section>

    <section class="hg-lab__part" :aria-labelledby="`${uid}-watch`">
      <h4 :id="`${uid}-watch`" class="hg-lab__step">观摩模式<span class="hg-lab__tag">没有 GPU 时</span></h4>
      <p class="hg-lab__hint">{{ watchHint }}</p>
      <p v-if="watchStatus && !watching" class="hg-lab__note">{{ watchStatus }}</p>
      <button
        v-if="records.length"
        type="button"
        class="hg-lab__switch"
        :aria-expanded="watching"
        :aria-controls="`${uid}-replay`"
        @click="watching = !watching"
      >
        {{ watching ? '收起观摩' : '开始观摩' }}
      </button>
      <template v-else>
        <button type="button" class="hg-lab__switch is-pending" aria-disabled="true" :aria-describedby="`${uid}-pending`">数据整理中</button>
        <p :id="`${uid}-pending`" class="hg-lab__note hg-lab__pending">实验档案馆里还没有{{ scope }}的运行记录，整理好以后就能观摩。</p>
      </template>
      <LabReplay v-if="watching && records.length" :id="`${uid}-replay`" :stage="stageId" :kind="target?.kind ?? 'stage'" :entries="records" />
    </section>

    <p class="hg-visually-hidden" aria-live="polite">{{ announce }}</p>
  </section>
</template>

<style>
/* 默认（服务端渲染、没有偏好、偏好是 HIP）显示 HIP 路线；属性是 triton 时反过来（同 RouteBlock）。 */
.hg-lab__way[data-route='triton'],
html[data-hg-route='triton'] .hg-lab__way[data-route='hip'] {
  display: none;
}

html[data-hg-route='triton'] .hg-lab__way[data-route='triton'] {
  display: block;
}
</style>

<style scoped>
.hg-lab {
  margin: 20px 0;
  padding: 18px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.hg-lab__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.hg-lab__eyebrow {
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-lab__title {
  margin: 0;
  padding: 0;
  border: 0;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  letter-spacing: 0;
}

.hg-lab__lead {
  flex-basis: 100%;
  margin: 6px 0 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.hg-lab__part {
  margin: 16px 0 0;
  padding: 14px 0 0;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.hg-lab__step {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-family: var(--hg-font-display);
  font-size: 16px;
}

.hg-lab__num {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-ink);
  color: var(--hg-surface);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.hg-lab__file {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin: 0 0 8px;
}

/* 路径很长：手机上在任意位置折行，不把卡片撑出屏幕。 */
.hg-lab__file code,
.hg-lab__note code,
.hg-lab__cloud code {
  overflow-wrap: anywhere;
}

.hg-lab__tag {
  padding: 2px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-lab__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}

.hg-lab__links li {
  margin: 0;
}

.hg-lab__link,
.hg-lab__switch,
.hg-lab__submit {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.hg-lab__link:hover,
.hg-lab__switch:hover,
.hg-lab__submit:not(:disabled):hover {
  border-color: var(--hg-accent);
}

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节）。 */
.hg-lab__submit {
  justify-content: center;
  min-width: 6.5em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-lab__submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 档案馆里还没有这一关的记录：虚线框、浅色字，点了没反应（不只靠颜色；用 aria-disabled，键盘和读屏还能找到它）。 */
.hg-lab__switch.is-pending,
.hg-lab__switch.is-pending:hover {
  border-style: dashed;
  border-color: var(--hg-border-strong);
  color: var(--hg-ink-3);
  cursor: not-allowed;
}

.hg-lab__note.hg-lab__pending {
  margin: 8px 0 0;
}

.hg-lab__link:focus-visible,
.hg-lab__switch:focus-visible,
.hg-lab__submit:focus-visible,
.hg-lab__input:focus-visible,
.hg-lab__cloud summary:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-lab__note,
.hg-lab__hint,
.hg-lab__fine {
  margin: 0 0 8px;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.hg-lab__fine {
  margin: 8px 0 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.hg-lab__cloud {
  margin: 0;
  padding: 8px 12px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  font-size: 14px;
}

.hg-lab__cloud summary {
  font-weight: 600;
  cursor: pointer;
}

.hg-lab__cloud > p {
  margin: 10px 0 0;
}

/* 每个云平台一段：名字、链接和指南入口，下面两三步说明；平台之间用虚线隔开。 */
.hg-lab__platform {
  margin: 10px 0 0;
  padding: 10px 0 0;
  border-top: var(--hg-border-width) dashed var(--hg-border);
}

.hg-lab__platform-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
  margin: 0;
}

.hg-lab__platform-name {
  font-weight: 700;
}

.hg-lab__platform ol {
  margin: 6px 0 0;
}

.hg-lab__form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 6px 10px;
}

.hg-lab__label {
  grid-column: 1 / -1;
  font-size: 14px;
  font-weight: 600;
}

.hg-lab__input {
  width: 100%;
  min-height: 72px;
  padding: 8px 10px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
  resize: vertical;
}

.hg-lab__problem {
  margin: 12px 0 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
}

.hg-lab__problem-title {
  margin: 0 0 6px;
  color: var(--hg-error-ink);
  font-weight: 700;
}

.hg-lab__problem dl,
.hg-lab__meta {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  margin: 0;
}

.hg-lab__problem dl > div,
.hg-lab__meta > div {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 8px;
}

.hg-lab__problem dt,
.hg-lab__meta dt {
  color: var(--hg-ink-2);
  font-weight: 600;
}

.hg-lab__problem dd,
.hg-lab__meta dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.hg-lab__meta {
  margin: 0 0 12px;
  font-size: 15px;
}

.hg-lab__table {
  margin: 0 0 8px;
}

.hg-lab__table th[scope='row'] {
  font-weight: 400;
}

.hg-lab__table th[scope='row'] span {
  display: block;
}

.hg-lab__table td {
  font-family: var(--hg-font-mono);
  font-size: 14px;
  white-space: nowrap;
}

.hg-lab__stars {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

/* 不靠颜色单独表达信息（01 第 7 节）：实心 ★ / 空心 ☆ + 「达到 / 没达到」文字。 */
.hg-lab__star {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  color: var(--hg-ink-3);
}

.hg-lab__star.is-earned {
  color: var(--hg-ink);
}

.hg-lab__glyph {
  flex: none;
  color: var(--hg-idle);
  font-size: 18px;
  line-height: 1.4;
}

.hg-lab__star.is-earned .hg-lab__glyph {
  color: var(--hg-amber);
}

.hg-lab__rule {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.hg-lab__rule-text {
  font-size: 15px;
  font-weight: 600;
}

.hg-lab__detail {
  font-family: var(--hg-font-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.hg-lab__state {
  flex: none;
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-lab__star.is-earned .hg-lab__state {
  color: var(--hg-amber-ink);
}

.hg-lab__outcome {
  margin: 12px 0 0;
  font-weight: 600;
}

.hg-lab-error {
  margin: 0 0 20px;
  padding: 14px 18px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-card);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
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

@media (max-width: 480px) {
  .hg-lab {
    padding: 16px;
  }

  .hg-lab__form {
    grid-template-columns: minmax(0, 1fr);
  }

  .hg-lab__submit {
    justify-self: start;
  }
}
</style>
