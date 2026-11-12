<script setup lang="ts">
/**
 * 我的成长（P-04；设计稿 Me、Rewards 画板；04 第 2、4、5、7 节，01 第 2、6、7 节）。
 *
 * 从上到下：
 * - 等级卡：等级圈（本级经验条）和距下一级、星 / 通关 / 术语 / 徽章、经验值来源（定级给的那部分写「定级」），
 *   14 天没导出存档时温和地提一句；下半张是各区域的完成度和星，数法和世界地图的区域卡片相同（journey.ts 的 zoneProgress）。
 * - 徽章墙：badges.json 的每一枚，没拿到的写获得条件，不画成锁。
 * - 我的 GPU 卡片（L-07）：全局注册的 DeviceCard，导入 hg.device_card() 的导入码，1-2 的全景图跟着换成读者的卡；
 *   外层的 #gpu-card 给全景图「在『我的成长』里导入」的链接跳过来（DeviceCard 是异步组件，锚点放在马上就有的外层上）。
 * - 图鉴（已收集的术语，点回第一次学到它的关卡，见 growth.ts）和存档：导出文件、复制存档码、导入（先校验，
 *   列出「这份存档 / 这台设备现在」的对照，确认覆盖才写入），以及存在哪、浏览器会不会清理、上次什么时候导出。
 * - 设置：写法、路线（和关卡状态栏上的切换是同一项）、简洁模式、减弱动效，清空进度（二次确认；GPU 卡片留着）。
 * 页面不手写关卡、徽章和术语：全部来自进度存档和 outline.json、badges.json、glossary.json。
 * 小核不出场：这一页全是数据（01 第 5 节：小核不出现在数据结论和表格旁边）。
 *
 * 存档要等 onMounted 之后才读得到（09 第 3 节）：读出来之前按空存档画，数字写短横，按钮先禁用，
 * 结构和读出来以后一样，服务端渲染和水合一致（同 HgLevelChip）。
 */
import { computed, nextTick, onMounted, ref, useId } from 'vue'
import { withBase } from 'vitepress'
import PrefSwitch from './PrefSwitch.vue'
import { BADGES } from '@course/badges.ts'
import { GLOSSARY } from '@course/glossary.ts'
import { codexItems, codexZones, dateText, sinceText } from '@course/growth.ts'
import { zoneProgress } from '@course/journey.ts'
import { MAX_STARS, XP_PER_LEVEL, XP_SOURCE_LABEL, type ImportResult, type StateSummary, type XpSource } from '@course/progress.ts'
import { copyText, downloadSave, persistedState, readSaveFile } from '@course/storage.ts'
import { useProgress } from '@course/useProgress.ts'

const progress = useProgress()
const { state, loaded, notice, level, xpIntoLevel, xpToNext, summary, remindExport } = progress
const uid = useId()

/** 数字：存档读出来之前写短横。 */
function show(n: number): number | string {
  return loaded.value ? n : '—'
}

// ── 等级卡 ────────────────────────────────────────────────────────────

/** 等级圈的周长（r = 60）：本级经验攒了多少，就描多长。 */
const RING = 2 * Math.PI * 60
const ringPart = computed(() => (loaded.value ? (xpIntoLevel.value / XP_PER_LEVEL) * RING : 0))
const ringLabel = computed(() => (loaded.value ? `等级 ${level.value}，本级经验 ${xpIntoLevel.value} / ${XP_PER_LEVEL}` : '等级读取中'))

/** 经验值从哪来，顺序同 XP_SOURCE_LABEL；定级给的那部分写「定级」（04 第 2 节）。 */
const sources = computed(() => (Object.keys(XP_SOURCE_LABEL) as XpSource[])
  .filter((key) => state.bySource[key] > 0)
  .map((key) => ({ key, label: XP_SOURCE_LABEL[key], xp: state.bySource[key] })))

/** 04 第 7 节：距离上次导出超过 14 天（从来没导出过也算），提一句，链到下面的存档卡片。没有进度时不提。 */
const exportHint = computed(() => {
  if (!loaded.value || !remindExport.value) return ''
  return state.lastExportAt === null
    ? '你还没有导出过存档。导出一份，换设备或者浏览器清理数据以后还能接着玩。'
    : `上次导出存档是 ${sinceText(state.lastExportAt, Date.now())}，建议再导出一次。`
})

const zones = computed(() => zoneProgress(state).map((p) => {
  const total = p.stages.length
  return { ...p, total, percent: loaded.value && total ? `${Math.round((p.done / total) * 100)}%` : '0%' }
}))

// ── 徽章墙 ────────────────────────────────────────────────────────────

/** badges.json 的 icon → 24 × 24 的描边路径（01 第 6 节：内联描边 SVG、currentColor，不用 emoji）。 */
const ICONS: Record<string, string[]> = {
  flag: ['M6 21V4', 'M6 4h12l-2.5 4.5L18 13H6'],
  shield: ['M12 3 19 6v5.5c0 4.4-3 7.8-7 9.5-4-1.7-7-5.1-7-9.5V6l7-3Z', 'm9 12 2.2 2.2L15.5 10'],
  magnifier: ['M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z', 'm15.5 15.5 4.5 4.5'],
  sync: ['M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9', 'M19.5 4.5V9H15', 'M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15', 'M4.5 19.5V15H9'],
  brackets: ['M8.5 7 3.5 12l5 5', 'm15.5 7 5 5-5 5', 'm13.5 5-3 14'],
  route: ['M5 21a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z', 'M19 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z', 'M7 19h7.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H17'],
  bot: ['M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z', 'M12 8V4.5', 'M9.5 12.5v2M14.5 12.5v2', 'M3 12v3M21 12v3'],
  flame: ['M12 21a6 6 0 0 1-6-6c0-3.5 3-5.5 3.5-9 2 1.5 3 3.5 3 5.5 1-1 1.5-2.2 1.5-3.5 2.5 2 4 4.5 4 7a6 6 0 0 1-6 6Z'],
  chip: ['M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z', 'M10 10h4v4h-4Z', 'M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3'],
  trophy: ['M7 4h10v5a5 5 0 0 1-10 0V4Z', 'M7 6H4v1a3 3 0 0 0 3.5 3', 'M17 6h3v1a3 3 0 0 1-3.5 3', 'M12 14v3', 'M9 17h6l1 3H8l1-3Z'],
  book: ['M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2Z', 'M12 6.5v13'],
}
/** badges.json 新加了徽章、这里还没画它的图标时，先画一个对勾。 */
const FALLBACK_ICON = ['m7.5 12.5 3 3 6-7']

const badges = computed(() => BADGES.map((b) => ({ ...b, at: state.badges[b.id] ?? 0, paths: ICONS[b.icon] ?? FALLBACK_ICON })))
const badgeCount = computed(() => badges.value.filter((b) => b.at).length)

// ── 图鉴 ──────────────────────────────────────────────────────────────

const TERM_TOTAL = Object.keys(GLOSSARY).length
const codex = computed(() => codexItems(state).map((t) => ({ ...t, href: t.href ? withBase(t.href) : '' })))
const codexLinked = computed(() => codex.value.some((t) => t.href))
const codexSoon = computed(() => codex.value.some((t) => !t.href))
const zoneTerms = computed(() => codexZones(state).map((z) => `${z.zone.name} ${show(z.got)} / ${z.total}`).join('，'))

// ── 存档 ──────────────────────────────────────────────────────────────

/** 浏览器有没有同意持久存储；读存档时已经申请过（storage.ts 的 requestPersist），这里只查。 */
const persisted = ref<boolean | null>(null)
onMounted(async () => {
  persisted.value = await persistedState()
})

/** 存档状态，每条一个圆点：ok 青、warn 琥珀（建议做点什么）、error 红（存不下来）、idle 灰；文字照样写清楚（01 第 7 节）。 */
interface SaveLine {
  tone: 'ok' | 'warn' | 'error' | 'idle'
  text: string
}

const saveLines = computed<SaveLine[]>(() => {
  if (!loaded.value) return []
  const now = Date.now()
  const lines: SaveLine[] = []
  if (notice.value) {
    lines.push({ tone: 'error', text: '浏览器存储不可用（可能开着无痕模式）：这次的进度只留在这个标签页里，关掉就没了。想留下来，现在就导出存档。' })
  } else {
    const updated = state.updatedAt > state.createdAt ? `，最后一次更新：${sinceText(state.updatedAt, now)}` : ''
    lines.push({ tone: 'ok', text: `自动保存在这台设备的浏览器里${updated}。` })
    if (persisted.value === true) lines.push({ tone: 'ok', text: '浏览器已经同意持久保存，不会自动清理这里的进度。' })
    // 同不同意由浏览器自己的规则决定，很多时候是不同意：只是说明，不用琥珀色催读者。
    if (persisted.value === false) lines.push({ tone: 'idle', text: '浏览器没有承诺长期保留：磁盘空间紧张时，可能会清理这里的进度。定期导出一份更稳妥。' })
  }
  const remind = remindExport.value
  if (state.lastExportAt === null) {
    lines.push({ tone: remind ? 'warn' : 'idle', text: remind ? '还没有导出过存档，建议导出一份。' : '还没有导出过存档。' })
  } else {
    const ago = sinceText(state.lastExportAt, now)
    lines.push({ tone: remind ? 'warn' : 'ok', text: remind ? `上次导出存档：${ago}，建议再导出一次。` : `上次导出存档：${ago}。` })
  }
  return lines
})

const saveMsg = ref('')
/** 自动复制失败时摆出来让读者手动复制的存档码。 */
const manualCode = ref('')
const manualEl = ref<HTMLTextAreaElement | null>(null)

function exportFile() {
  const save = progress.exportSave()
  saveMsg.value = downloadSave(save.fileName, save.json)
    ? `已下载存档文件 ${save.fileName}。在另一台设备上打开「我的成长」，点「导入存档」选这个文件。`
    : '没能下载存档文件，可以改用「复制存档码」。'
}

async function copyCode() {
  const { code } = progress.exportSave()
  manualCode.value = ''
  if (await copyText(code)) {
    saveMsg.value = '存档码已复制。在另一台设备上打开「我的成长」，点「导入存档」粘贴进去。'
    return
  }
  saveMsg.value = '没能自动复制，请手动复制下面的存档码。'
  manualCode.value = code
  await nextTick()
  manualEl.value?.focus()
  manualEl.value?.select()
}

// 导入：先校验、给出对照，读者确认覆盖才写进存档（04 第 7 节；inspectSave 只读不写）。
const importOpen = ref(false)
const importBtn = ref<HTMLButtonElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const codeText = ref('')
const importError = ref('')
const pending = ref<Extract<ImportResult, { ok: true }> | null>(null)
const confirmEl = ref<HTMLElement | null>(null)
const codeEl = ref<HTMLTextAreaElement | null>(null)

/** 导入前对照的各行：这份存档和这台设备现在各有多少。 */
const COMPARE: { key: Exclude<keyof StateSummary, 'updatedAt'>; label: string; pre: string; post: string }[] = [
  { key: 'level', label: '等级', pre: 'Lv.', post: '' },
  { key: 'xp', label: '经验值', pre: '', post: ' XP' },
  { key: 'stages', label: '通关', pre: '', post: ' 关' },
  { key: 'stars', label: '星', pre: '', post: ' 颗' },
  { key: 'badges', label: '徽章', pre: '', post: ' 枚' },
  { key: 'terms', label: '图鉴', pre: '', post: ' 个术语' },
]

function clearImport() {
  codeText.value = ''
  importError.value = ''
  pending.value = null
}

function toggleImport() {
  importOpen.value = !importOpen.value
  if (!importOpen.value) clearImport()
}

async function inspect(text: string) {
  const result = progress.inspectSave(text)
  if (!result.ok) {
    pending.value = null
    importError.value = `没能读这份存档：${result.error}。`
    return
  }
  importError.value = ''
  pending.value = result
  await nextTick()
  confirmEl.value?.focus()
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 清掉选择，同一个文件改过以后还能再选一次。
  input.value = ''
  if (file) await inspect(await readSaveFile(file))
}

async function confirmImport() {
  if (!pending.value) return
  progress.applySave(pending.value.state)
  importOpen.value = false
  clearImport()
  saveMsg.value = `已导入：现在是 Lv.${level.value}，通关 ${summary.value.stages} 关，${summary.value.stars} 颗星。`
  await nextTick()
  importBtn.value?.focus()
}

/** 不导入这一份：收起对照，焦点回到存档码的输入框，可以换一份再检查。 */
async function cancelImport() {
  pending.value = null
  await nextTick()
  codeEl.value?.focus()
}

// ── 设置 ──────────────────────────────────────────────────────────────

const SWITCHES = [
  { key: 'plain', name: '简洁模式', desc: '收起点阵底纹和小核插画，奖励只用文字提示，动效也一起减弱。' },
  { key: 'reducedMotion', name: '减弱动效', desc: '关掉页面上的过渡和动画，奖励只用文字提示。系统打开了「减弱动态效果」时，这里关着也会减弱。' },
] as const

const clearOpen = ref(false)
const clearBtn = ref<HTMLButtonElement | null>(null)
const clearCancel = ref<HTMLButtonElement | null>(null)
const settingsMsg = ref('')

async function openClear() {
  clearOpen.value = true
  settingsMsg.value = ''
  // 焦点先落在「取消」上：误按 Enter 也不会清掉进度。
  await nextTick()
  clearCancel.value?.focus()
}

async function closeClear() {
  clearOpen.value = false
  await nextTick()
  clearBtn.value?.focus()
}

async function confirmClear() {
  progress.resetAll()
  settingsMsg.value = '进度已经清空，设置和 GPU 卡片留着。'
  await closeClear()
}
</script>

<template>
  <div class="me">
    <section class="me-card me-hero" :aria-labelledby="`${uid}-title`">
      <div class="me-hero__top">
        <svg class="me-ring" viewBox="0 0 140 140" role="img" :aria-label="ringLabel">
          <circle class="me-ring__track" cx="70" cy="70" r="60" />
          <circle
            v-if="ringPart > 0"
            class="me-ring__fill"
            cx="70"
            cy="70"
            r="60"
            :stroke-dasharray="`${ringPart.toFixed(1)} ${RING.toFixed(1)}`"
            transform="rotate(-90 70 70)"
          />
          <text class="me-ring__label" x="70" y="58" text-anchor="middle">LEVEL</text>
          <text class="me-ring__level" x="70" y="96" text-anchor="middle">{{ show(level) }}</text>
        </svg>

        <div class="me-hero__intro">
          <p class="me-eyebrow">LOCAL PROFILE · 本地存档</p>
          <h1 :id="`${uid}-title`" class="me-hero__title">我的成长</h1>
          <p class="me-hero__next">
            本级经验 {{ show(xpIntoLevel) }} / {{ XP_PER_LEVEL }}，再攒 {{ show(xpToNext) }} XP 升到 Lv.{{ show(level + 1) }}。
          </p>
        </div>

        <div class="me-hero__more">
          <ul class="me-stats" aria-label="累计">
            <li><strong>{{ show(summary.stars) }}</strong>颗星</li>
            <li><strong>{{ show(summary.stages) }}</strong>关已通关</li>
            <li><strong>{{ show(codex.length) }}</strong>个术语</li>
            <li><strong>{{ show(badgeCount) }}</strong>枚徽章</li>
          </ul>
          <p class="me-hero__sources">
            累计 {{ show(state.xp) }} XP<template v-if="sources.length">：<template v-for="(s, i) in sources" :key="s.key"><template v-if="i"> · </template>{{ s.label }} {{ s.xp }}</template></template>
          </p>
          <p class="me-hero__note">进度只存在这台设备的浏览器里，不用登录。</p>
          <p v-if="exportHint" class="me-line is-warn">
            <span class="me-dot" aria-hidden="true" /><span>{{ exportHint }}<a class="me-link" :href="`#${uid}-save`">去导出</a></span>
          </p>
        </div>
      </div>

      <div class="me-zones">
        <div class="me-card__head">
          <h2 :id="`${uid}-zones`">各区域</h2>
          <a class="me-link" :href="withBase('/world/')">看世界地图</a>
        </div>
        <ul class="me-zones__list" :aria-labelledby="`${uid}-zones`">
          <li v-for="z in zones" :key="z.zone.id" class="me-zone">
            <p class="me-zone__name">
              <a :href="withBase(`/${z.zone.id}/`)">{{ z.zone.name }}</a>
              <span class="me-zone__lv">推荐 Lv.{{ z.zone.lv[0] }}–{{ z.zone.lv[1] }}</span>
            </p>
            <span class="me-bar" aria-hidden="true"><span :data-zone="z.zone.id" :style="{ width: z.percent }" /></span>
            <p class="me-zone__nums">
              已通关 {{ show(z.done) }} / {{ z.total }}<template v-if="loaded && z.exempt"> · 已豁免 {{ z.exempt }}</template>
              · ★ {{ show(z.stars) }} / {{ z.total * MAX_STARS }}
            </p>
          </li>
        </ul>
      </div>
    </section>

    <section class="me-card" :aria-labelledby="`${uid}-badges`">
      <div class="me-card__head">
        <h2 :id="`${uid}-badges`">徽章</h2>
        <span class="me-count">{{ show(badgeCount) }} / {{ BADGES.length }}</span>
      </div>
      <p class="me-card__note">每一枚对应一项能力。还没拿到的，写着怎么拿。</p>
      <ul class="me-badges">
        <li v-for="b in badges" :key="b.id" class="me-badge" :class="{ 'is-earned': b.at }">
          <svg class="me-badge__art" viewBox="0 0 60 60" aria-hidden="true">
            <path class="me-badge__hex" d="M30 4 52 17v26L30 56 8 43V17Z" />
            <svg class="me-badge__icon" x="17" y="17" width="26" height="26" viewBox="0 0 24 24">
              <path v-for="d in b.paths" :key="d" :d="d" />
            </svg>
          </svg>
          <div class="me-badge__text">
            <strong class="me-badge__name">{{ b.name }}</strong>
            <template v-if="b.at">
              <span class="me-badge__desc">{{ b.desc }}</span>
              <span class="me-badge__when">{{ dateText(b.at) }} 获得</span>
            </template>
            <span v-else class="me-badge__desc"><span class="me-badge__key">获得条件</span>{{ b.condition }}</span>
          </div>
        </li>
      </ul>
    </section>

    <div id="gpu-card" class="me-device">
      <DeviceCard :level="2" />
    </div>

    <div class="me-pair">
      <section class="me-card" :aria-labelledby="`${uid}-codex`">
        <div class="me-card__head">
          <h2 :id="`${uid}-codex`">图鉴</h2>
          <span class="me-count">{{ show(codex.length) }} / {{ TERM_TOTAL }}</span>
        </div>
        <ul v-if="codex.length" class="me-terms">
          <li v-for="t in codex" :key="t.key">
            <a v-if="t.href && t.stage" class="me-term" :href="t.href" :title="t.short">
              {{ t.name }}<span class="me-term__stage" aria-hidden="true">{{ t.stage.code }}</span><span class="me-hidden">，回到 {{ t.stage.code }} {{ t.stage.title }}</span>
            </a>
            <span v-else class="me-term is-soon" :title="t.short">
              {{ t.name }}<template v-if="t.stage"><span class="me-term__stage" aria-hidden="true">{{ t.stage.code }}</span><span class="me-hidden">，{{ t.stage.code }} {{ t.stage.title }}还在建设中</span></template>
            </span>
          </li>
        </ul>
        <p v-else class="me-empty">
          <template v-if="loaded">还没有收集到术语。关卡里第一次出现的新术语卡（NEW TERM），读到就会收进这里。</template>
        </p>
        <p class="me-card__note">
          <template v-if="codexLinked">点一个词，回到第一次学到它的关卡复习。</template><template v-if="codexSoon">虚线框的词，那一关还在建设中。</template>收齐一个区域的新术语，拿「图鉴收集家」徽章：{{ zoneTerms }}。
        </p>
      </section>

      <section :id="`${uid}-save`" class="me-card" :aria-labelledby="`${uid}-save-title`" tabindex="-1">
        <h2 :id="`${uid}-save-title`">存档与换设备</h2>
        <ul class="me-lines">
          <li v-for="line in saveLines" :key="line.text" class="me-line" :class="`is-${line.tone}`">
            <span class="me-dot" aria-hidden="true" /><span>{{ line.text }}</span>
          </li>
        </ul>

        <div class="me-actions">
          <button type="button" class="me-btn is-primary" :disabled="!loaded" @click="exportFile">导出存档文件</button>
          <button type="button" class="me-btn" :disabled="!loaded" @click="copyCode">复制存档码</button>
          <button
            ref="importBtn"
            type="button"
            class="me-btn"
            :disabled="!loaded"
            :aria-expanded="importOpen"
            :aria-controls="importOpen ? `${uid}-import` : undefined"
            @click="toggleImport"
          >
            导入存档
          </button>
        </div>
        <p class="me-msg" role="status">{{ saveMsg }}</p>
        <textarea
          v-if="manualCode"
          ref="manualEl"
          class="me-code"
          readonly
          rows="3"
          aria-label="存档码"
          :value="manualCode"
          @focus="($event.target as HTMLTextAreaElement).select()"
        />

        <div v-if="importOpen" :id="`${uid}-import`" class="me-import">
          <p class="me-import__lead">选一个存档文件，或者粘贴存档码。写入之前，会先列出存档里有什么。</p>
          <div class="me-actions">
            <button type="button" class="me-btn" @click="fileInput?.click()">选择存档文件</button>
            <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFile" />
          </div>
          <label class="me-import__label" :for="`${uid}-code`">或者粘贴存档码</label>
          <textarea
            :id="`${uid}-code`"
            ref="codeEl"
            v-model="codeText"
            class="me-code"
            rows="3"
            spellcheck="false"
            autocomplete="off"
          />
          <div class="me-actions">
            <button type="button" class="me-btn" :disabled="!codeText.trim()" @click="inspect(codeText)">检查存档码</button>
          </div>
          <p v-if="importError" class="me-import__error" role="alert">{{ importError }}</p>

          <div
            v-if="pending"
            class="me-confirm"
            role="group"
            :aria-labelledby="`${uid}-import-title`"
            @keydown.escape="cancelImport"
          >
            <p :id="`${uid}-import-title`" ref="confirmEl" class="me-confirm__title" tabindex="-1">
              这份存档是 {{ dateText(pending.exportedAt) }} 导出的，要用它覆盖这台设备上的进度吗？
            </p>
            <table class="me-compare">
              <thead>
                <tr>
                  <th scope="col"><span class="me-hidden">项目</span></th>
                  <th scope="col">这份存档</th>
                  <th scope="col">这台设备现在</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in COMPARE" :key="row.key">
                  <th scope="row">{{ row.label }}</th>
                  <td>{{ row.pre }}{{ pending.summary[row.key] }}{{ row.post }}</td>
                  <td>{{ row.pre }}{{ summary[row.key] }}{{ row.post }}</td>
                </tr>
              </tbody>
            </table>
            <p class="me-confirm__warn">{{ pending.warning }}</p>
            <div class="me-actions">
              <button type="button" class="me-btn is-primary" @click="confirmImport">覆盖并导入</button>
              <button type="button" class="me-btn" @click="cancelImport">取消</button>
            </div>
          </div>
        </div>

        <p class="me-card__note">存档里有经验值、星、徽章、图鉴、GPU 卡片和设置。挑战里写到一半的代码只留在这台设备上，不进存档。</p>
      </section>
    </div>

    <section class="me-card" :aria-labelledby="`${uid}-settings`">
      <h2 :id="`${uid}-settings`">设置</h2>
      <ul class="me-settings">
        <li class="me-setting">
          <div class="me-setting__text">
            <p class="me-setting__name">代码写法</p>
            <p class="me-setting__desc">新手村的关卡用哪种写法显示代码。关卡顶部也能随时切换。</p>
          </div>
          <PrefSwitch kind="lang" />
        </li>
        <li class="me-setting">
          <div class="me-setting__text">
            <p class="me-setting__name">实现路线</p>
            <p class="me-setting__desc">铸造城、试炼场分路线的关卡显示哪一条。区域首页和关卡顶部也能切换。</p>
          </div>
          <PrefSwitch kind="route" />
        </li>
        <li v-for="s in SWITCHES" :key="s.key" class="me-setting">
          <div class="me-setting__text">
            <p :id="`${uid}-${s.key}`" class="me-setting__name">{{ s.name }}</p>
            <p :id="`${uid}-${s.key}-desc`" class="me-setting__desc">{{ s.desc }}</p>
          </div>
          <button
            type="button"
            role="switch"
            class="me-switch"
            :aria-checked="state.prefs[s.key]"
            :aria-labelledby="`${uid}-${s.key}`"
            :aria-describedby="`${uid}-${s.key}-desc`"
            :disabled="!loaded"
            @click="progress.setPref(s.key, !state.prefs[s.key])"
          >
            <span class="me-switch__track" aria-hidden="true"><span class="me-switch__knob" /></span>
            <span class="me-switch__text" aria-hidden="true">{{ state.prefs[s.key] ? '开' : '关' }}</span>
          </button>
        </li>
        <li class="me-setting">
          <div class="me-setting__text">
            <p class="me-setting__name">清空进度</p>
            <p class="me-setting__desc">删掉这台设备上的经验值、星、徽章、图鉴和挑战草稿，从头开始。上面的设置和「我的 GPU 卡片」留着。</p>
          </div>
          <button
            ref="clearBtn"
            type="button"
            class="me-btn"
            :disabled="!loaded"
            :aria-expanded="clearOpen"
            :aria-controls="clearOpen ? `${uid}-clear` : undefined"
            @click="clearOpen ? closeClear() : openClear()"
          >
            清空进度…
          </button>
          <div
            v-if="clearOpen"
            :id="`${uid}-clear`"
            class="me-confirm"
            role="group"
            :aria-labelledby="`${uid}-clear-title`"
            @keydown.escape="closeClear"
          >
            <p :id="`${uid}-clear-title`" class="me-confirm__title">确定要清空进度吗？</p>
            <p class="me-confirm__warn">清空以后没法撤销。想留一份，先在上面导出存档。</p>
            <div class="me-actions">
              <button type="button" class="me-btn is-primary" @click="confirmClear">确认清空</button>
              <button ref="clearCancel" type="button" class="me-btn" @click="closeClear">取消</button>
            </div>
          </div>
        </li>
      </ul>
      <p class="me-msg" role="status">{{ settingsMsg }}</p>
    </section>
  </div>
</template>

<style scoped>
.me {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.me-hidden {
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

/* 卡片标题：去掉正文 h2 的分隔线和大间距，卡片之间的间距由 .me 的 gap 给。 */
.me h2 {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: var(--hg-text-card-title);
  letter-spacing: 0;
}

.me-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

/* 从「去导出」跳过来时，存档卡片拿到焦点，不画焦点框（不是可操作的控件）。 */
.me-card:focus {
  outline: none;
}

/* 我的 GPU 卡片：DeviceCard 自己画卡片框，去掉它在关卡正文里用的上下外边距和阴影，和这一页别的卡片一样。 */
.me-device {
  min-width: 0;
  scroll-margin-top: 80px;
}

.me-device :deep(.hg-device) {
  margin: 0;
  padding: 20px 22px;
  box-shadow: none;
}

.me-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
}

.me-count {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.me-card__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
  line-height: 1.6;
}

.me-link {
  font-size: 14px;
  white-space: nowrap;
}

/* ---------- 按钮：主按钮深墨底、反色字，强调色只留给进度和焦点（01 第 2.2 节） ---------- */

.me-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.me-btn {
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 40px;
  padding: 0 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.me-btn.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.me-btn:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.me-btn:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.me-btn:disabled {
  cursor: default;
  opacity: 0.55;
}

.me-msg {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

/* 没有消息时也留在页面上（读屏要先有这个 role=status 区域，后来写进去的话才会念），只是抵掉卡片里的间距。 */
.me-msg:empty {
  margin-top: -14px;
}

/* ---------- 等级卡 ---------- */

.me-hero {
  gap: 22px;
  padding: 24px 28px;
  box-shadow: var(--hg-shadow);
}

/* 桌面：等级圈占左边两行，右边是标题和数字；手机：等级圈和标题一行，数字整行排在下面。 */
.me-hero__top {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px 26px;
  align-items: center;
}

.me-ring {
  grid-row: 1 / span 2;
  width: 132px;
  height: 132px;
}

.me-ring__track,
.me-ring__fill {
  fill: none;
  stroke-width: 10;
}

.me-ring__track {
  stroke: var(--hg-border);
}

.me-ring__fill {
  stroke: var(--hg-accent);
  stroke-linecap: round;
  transition: stroke-dasharray var(--motion-base) var(--motion-ease-out);
}

.me-ring__label {
  fill: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.me-ring__level {
  fill: var(--hg-ink);
  font-family: var(--hg-font-display);
  font-size: 40px;
  font-weight: 700;
}

.me-hero__intro {
  min-width: 0;
}

.me-eyebrow {
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.me .me-hero__title {
  margin: 2px 0 6px;
}

.me-hero__next {
  margin: 0;
  color: var(--hg-ink-2);
}

.me-hero__more {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  grid-column: 2;
}

.me-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.me-stats li {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  padding: 5px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font-size: 13px;
}

.me-stats strong {
  color: var(--hg-ink);
  font-family: var(--hg-font-display);
  font-size: 18px;
}

.me-hero__sources {
  margin: 0;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.me-hero__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 14px;
}

/* 各区域：和世界地图的区域卡片同一套数，进度条按区域换色（data-zone 只换强调色这一项）。 */
.me-zones {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 18px;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.me-zones__list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 14px 28px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.me-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

.me-zone__name {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 2px 10px;
  margin: 0;
  font-size: 15px;
}

.me-zone__name a {
  color: var(--hg-ink);
  font-weight: 700;
  text-decoration: none;
}

.me-zone__name a:hover {
  text-decoration: underline;
}

.me-zone__lv {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.me-bar {
  display: block;
  height: 6px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-border);
  overflow: hidden;
}

.me-bar span {
  display: block;
  height: 100%;
  background: var(--hg-accent);
  transition: width var(--motion-base) var(--motion-ease-out);
}

.me-zone__nums {
  margin: 0;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

/* ---------- 徽章墙：拿到的实线六边形、紫色（同 RewardLayer 的「新徽章」）；没拿到的虚线、灰色，写获得条件，不画锁 ---------- */

.me-badges {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
  gap: 16px 18px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.me-badge {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0;
}

.me-badge__art {
  flex: none;
  width: 56px;
  height: 56px;
}

.me-badge__hex {
  fill: var(--hg-surface-2);
  stroke: var(--hg-border-strong);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  stroke-linejoin: round;
}

.me-badge__icon {
  fill: none;
  stroke: var(--hg-idle);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.me-badge.is-earned .me-badge__hex {
  fill: var(--hg-group-2-soft);
  stroke: var(--hg-violet);
  stroke-dasharray: none;
}

.me-badge.is-earned .me-badge__icon {
  stroke: var(--hg-violet-ink);
}

.me-badge__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-top: 4px;
}

.me-badge__name {
  font-size: 15px;
  line-height: 1.4;
}

.me-badge:not(.is-earned) .me-badge__name {
  color: var(--hg-ink-2);
}

.me-badge__desc {
  color: var(--hg-ink-3);
  font-size: 13px;
  line-height: 1.5;
}

.me-badge__key {
  margin-right: 6px;
  color: var(--hg-ink-2);
  font-weight: 600;
}

.me-badge__when {
  color: var(--hg-violet-ink);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

/* ---------- 图鉴和存档：桌面并排，窄屏上下排 ---------- */

.me-pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
  gap: 20px;
}

.me-terms {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.me-terms li {
  margin: 0;
}

.me-term {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font-size: 14px;
  text-decoration: none;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

a.me-term:hover {
  border-color: var(--hg-accent);
  text-decoration: none;
}

a.me-term:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* 那一关还在建设中，点不回去：虚线框，同世界地图「建设中」的画法。 */
.me-term.is-soon {
  border-style: dashed;
  border-color: var(--hg-border-strong);
  color: var(--hg-ink-2);
}

.me-term__stage {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
}

.me-empty {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.me-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.me-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.55;
}

.me-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--hg-accent);
  transform: translateY(-1px);
}

.me-line.is-warn .me-dot {
  background: var(--hg-amber);
}

.me-line.is-error {
  color: var(--hg-error-ink);
}

.me-line.is-error .me-dot {
  background: var(--hg-error);
}

.me-line.is-idle .me-dot {
  background: var(--hg-idle);
}

.me-line .me-link {
  margin-left: 6px;
}

.me-code {
  width: 100%;
  min-height: 72px;
  padding: 8px 10px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  word-break: break-all;
}

.me-code:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

.me-import {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.me-import__lead {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.me-import__label {
  margin-top: 4px;
  color: var(--hg-ink-2);
  font-size: 14px;
  font-weight: 600;
}

.me-import .me-code {
  background: var(--hg-surface);
}

.me-import__error {
  margin: 0;
  padding: 8px 12px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-size: 14px;
}

/* 覆盖、清空之前的确认：琥珀色描边 = 警告（01 第 2.2 节）。 */
.me-confirm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-amber);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
}

.me-confirm__title {
  margin: 0;
  color: var(--hg-ink);
  font-weight: 700;
  outline: none;
}

.me-confirm__warn {
  margin: 0;
  color: var(--hg-amber-ink);
  font-size: 14px;
  font-weight: 600;
}

.me .me-compare {
  width: 100%;
  margin: 0;
  font-size: 14px;
}

.me .me-compare th,
.me .me-compare td {
  padding: 6px 10px;
}

.me .me-compare td {
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

/* ---------- 设置 ---------- */

.me-settings {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.me-setting {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 24px;
  margin: 0;
  padding: 14px 0;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.me-setting:first-child {
  padding-top: 0;
  border-top: 0;
}

.me-setting__text {
  flex: 1 1 280px;
  min-width: 0;
}

.me-setting__name {
  margin: 0;
  font-weight: 700;
}

.me-setting__desc {
  margin: 2px 0 0;
  color: var(--hg-ink-3);
  font-size: 14px;
  line-height: 1.55;
}

.me-setting .me-confirm {
  flex: 1 1 100%;
}

/* 开关：开 = 深墨底、圆点在右，关 = 浅底描边、圆点在左；旁边写「开 / 关」，不只靠颜色和位置。 */
.me-switch {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 4px;
  border: 0;
  border-radius: var(--hg-radius-control);
  background: none;
  color: var(--hg-ink-2);
  font: inherit;
  cursor: pointer;
}

.me-switch:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.me-switch:disabled {
  cursor: default;
  opacity: 0.55;
}

.me-switch__track {
  position: relative;
  width: 42px;
  height: 24px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface-2);
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    border-color var(--motion-fast) var(--motion-ease-out);
}

.me-switch__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--hg-ink-3);
  transition: transform var(--motion-fast) var(--motion-ease-out);
}

.me-switch[aria-checked='true'] .me-switch__track {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
}

.me-switch[aria-checked='true'] .me-switch__knob {
  background: var(--hg-surface);
  transform: translateX(18px);
}

.me-switch__text {
  width: 1em;
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

/* ---------- 手机 ---------- */

@media (max-width: 767px) {
  .me-card,
  .me-device :deep(.hg-device) {
    padding: 16px;
  }

  .me-hero {
    padding: 18px 16px;
  }

  .me-hero__top {
    gap: 12px 16px;
  }

  .me-ring {
    grid-row: 1;
    width: 88px;
    height: 88px;
  }

  .me-hero__more {
    grid-column: 1 / -1;
  }

  .me-stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .me-badges {
    gap: 12px;
  }

  .me-badge__art {
    width: 44px;
    height: 44px;
  }

  .me-badge__text {
    padding-top: 0;
  }
}
</style>
