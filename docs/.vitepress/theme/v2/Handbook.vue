<script setup lang="ts">
/**
 * 冒险者手册（P-05；设计稿 Handbook 画板；05 第 3、4 节，01 第 3、6、7 节）。
 *
 * 左边（窄屏在上面）是搜索和目录，右边四节：
 * - 速查卡片：公式、常用写法、容易踩的坑，每张写着讲它的关卡（还没上线的关卡是虚线框、不是链接，同世界地图）。
 *   代码有两种写法，按读者的写法偏好显示一份：两份都渲染，<html data-hg-lang> 上的 CSS 决定显示哪份（同 LangCode），
 *   水合前后一致；高亮和沙盒的静态代码同一份（sandbox/template.ts）。
 * - 术语索引：按区域分，区域里按拼音 / 字母分组排序（构建时算好，见 handbook.data.ts）。
 *   条目的锚点是 glossary 的 key，概念卡的「在冒险者手册里查看」链到这里，跳过来的那一条描边。
 * - 工坊城比喻表：术语表里有比喻的术语，比喻和比喻边界放在同一行（05 第 4 节）。
 * - 实验环境指南的入口：L-06 写好 /handbook/setup/ 以后自动变成链接。
 * 术语的名字、定义、比喻全部来自 glossary.json，这一页不手写术语定义；卡片的内容在 docs/course/handbook.ts。
 * 搜索同时过滤前三节，目录上的数字跟着变。
 * 小核不出场：01 第 5 节，小核不出现在数据结论和表格旁边。
 */
import { computed, onMounted, ref, useId } from 'vue'
import { useRoute, withBase } from 'vitepress'
import PrefSwitch from './PrefSwitch.vue'
import { GLOSSARY } from '@course/glossary.ts'
import { data } from '@course/handbook.data.ts'
import {
  CARDS,
  SECTION_IDS,
  cardAnchor,
  cardMatches,
  englishName,
  inlineSegments,
  letterAnchor,
  queryTokens,
  stageLink,
  termMatches,
} from '@course/handbook.ts'
import { ZONES, zoneById } from '@course/outline.ts'
import { codeLines } from '@kit/sandbox/template.ts'

const uid = useId()

// ── 速查卡片 ────────────────────────────────────────────────────────────

const PANES = [
  { lang: 'hip', label: 'HIP 风格' },
  { lang: 'python', label: 'Python 风格' },
] as const

const cards = CARDS.map((card) => ({
  ...card,
  anchor: cardAnchor(card.id),
  stageLinks: card.stages.flatMap((id) => stageLink(id) ?? []),
  noteParts: card.notes.map(inlineSegments),
  panes: card.code
    ? PANES.map((pane) => ({
      ...pane,
      lines: codeLines({ source: card.code![pane.lang], ranges: [] }, pane.lang, false)
        .map((segs) => segs.map((seg) => ({ text: seg.text, tone: seg.kind === 'text' ? seg.tone : null }))),
    }))
    : [],
}))

// ── 术语 ────────────────────────────────────────────────────────────────

const terms = Object.fromEntries(Object.entries(GLOSSARY).map(([key, entry]) => [key, {
  key,
  term: entry.term,
  en: englishName(entry),
  short: entry.short,
  analogy: entry.analogy ?? '',
  limit: entry.analogyLimit ?? '',
  stageLinks: entry.links.flatMap((id) => stageLink(id) ?? []),
  cards: cards.filter((card) => card.terms.includes(key)),
}]))

const TERM_TOTAL = Object.keys(GLOSSARY).length
/** 比喻表：有比喻的术语，按术语表的顺序（也就是课程里学到的先后）。 */
const ANALOGY_KEYS = Object.keys(GLOSSARY).filter((key) => GLOSSARY[key].analogy)
/** 还没登记术语的区域（只在术语索引下面提一句）。 */
const emptyZones = ZONES.filter((zone) => !data.index.some((z) => z.zone === zone.id)).map((zone) => zone.name).join('、')
/** 有还没上线的关卡（虚线框、进不去）时，说一句虚线框是什么意思。 */
const anySoon = [...cards, ...Object.values(terms)].some((item) => item.stageLinks.some((s) => !s.href))

// ── 搜索 ────────────────────────────────────────────────────────────────

const query = ref('')
const tokens = computed(() => queryTokens(query.value))

const shownCards = computed(() => cards.filter((card) => cardMatches(card, tokens.value)))
const shownKeys = computed(() => new Set(Object.keys(GLOSSARY).filter((key) => termMatches(key, tokens.value))))
const shownAnalogies = computed(() => ANALOGY_KEYS.filter((key) => shownKeys.value.has(key)))

const shownIndex = computed(() => data.index.flatMap((z) => {
  const groups = z.groups.flatMap((g) => {
    const keys = g.keys.filter((key) => shownKeys.value.has(key))
    return keys.length ? [{ letter: g.letter, anchor: letterAnchor(z.zone, g.letter), keys }] : []
  })
  if (!groups.length) return []
  const total = z.groups.reduce((n, g) => n + g.keys.length, 0)
  const count = groups.reduce((n, g) => n + g.keys.length, 0)
  return [{ zone: zoneById(z.zone)!, total, count, groups }]
}))

const searching = computed(() => tokens.value.length > 0)

const foundText = computed(() => {
  if (!searching.value) return ''
  const parts = [
    { n: shownCards.value.length, unit: '张卡片' },
    { n: shownKeys.value.size, unit: '个术语' },
    { n: shownAnalogies.value.length, unit: '条比喻' },
  ].filter((p) => p.n > 0)
  return parts.length
    ? `找到 ${parts.map((p) => `${p.n} ${p.unit}`).join('、')}。`
    : `没有找到「${query.value.trim()}」。中文名、英文名、定义里的词都能搜，换个说法试试。`
})

const toc = computed(() => [
  { id: SECTION_IDS.cheatsheet, label: '速查卡片', count: shownCards.value.length },
  { id: SECTION_IDS.terms, label: '术语索引', count: shownKeys.value.size },
  { id: SECTION_IDS.analogies, label: '工坊城比喻表', count: shownAnalogies.value.length },
  { id: SECTION_IDS.setup, label: '实验环境指南', count: null },
])

/**
 * 点页内链接（卡片上的术语、术语条目下的卡片、字母）时，要去的那一条被搜索藏起来了：先清空搜索。
 * VitePress 在下一帧才滚动到锚点，那时候它已经重新渲染出来了。
 */
function revealTarget(event: MouseEvent) {
  const href = (event.target as Element).closest('a')?.getAttribute('href') ?? ''
  if (searching.value && href.startsWith('#') && !document.getElementById(decodeURIComponent(href.slice(1)))) query.value = ''
}

// ── 从概念卡跳过来的条目 ────────────────────────────────────────────────

const route = useRoute()
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
/** 地址里的 #key 指着的条目描边。挂载以后才读地址：服务端渲染和水合时都没有描边，前后一致。 */
const target = computed(() => (mounted.value ? route.hash.replace(/^#/, '') : ''))
</script>

<template>
  <div class="hb" @click="revealTarget">
    <header class="hb-head">
      <p class="hb-eyebrow">HANDBOOK</p>
      <h1 class="hb-head__title">冒险者手册</h1>
      <p class="hb-head__lead">公式、术语和比喻，都在这一页查。术语的定义和关卡里的概念卡出自同一份术语表。</p>
    </header>

    <div class="hb-body">
      <aside class="hb-side" aria-label="搜索和目录">
        <div class="hb-search" role="search">
          <label class="hb-search__label" :for="`${uid}-q`">搜索手册</label>
          <input
            :id="`${uid}-q`"
            v-model="query"
            class="hb-search__input"
            type="search"
            placeholder="LDS、线程块、带宽"
            autocomplete="off"
            spellcheck="false"
            @keydown.esc="query = ''"
          >
          <p class="hb-search__found" role="status">{{ foundText }}</p>
        </div>
        <nav class="hb-toc" aria-label="手册目录">
          <ul>
            <li v-for="item in toc" :key="item.id">
              <a :href="`#${item.id}`">
                <span>{{ item.label }}</span>
                <span v-if="item.count !== null" class="hb-toc__count">{{ item.count }}</span>
                <span v-else-if="!data.setupReady" class="hb-toc__soon">建设中</span>
              </a>
            </li>
          </ul>
        </nav>
      </aside>

      <div class="hb-main">
        <!-- 速查卡片 -->
        <section :id="SECTION_IDS.cheatsheet" class="hb-section" :aria-labelledby="`${uid}-cards`">
          <div class="hb-section__head">
            <h2 :id="`${uid}-cards`">速查卡片</h2>
            <div class="hb-section__tool">
              <span class="hb-section__tool-label" aria-hidden="true">代码写法</span>
              <PrefSwitch kind="lang" />
            </div>
          </div>
          <p class="hb-section__note">
            公式、常用写法和容易踩的坑。每张卡片下面写着讲它的关卡<template v-if="anySoon">；虚线框的关卡还在建设中，暂时进不去</template>。
          </p>

          <ul v-if="shownCards.length" class="hb-cards">
            <li v-for="card in shownCards" :id="card.anchor" :key="card.id" class="hb-card" :class="{ 'is-target': target === card.anchor }">
              <h3 class="hb-card__title">{{ card.title }}</h3>

              <p v-for="line in card.formula ?? []" :key="line" class="hb-formula">{{ line }}</p>

              <div v-if="card.panes.length" class="hb-code">
                <div v-for="pane in card.panes" :key="pane.lang" class="hb-code__pane" :data-lang="pane.lang">
                  <p class="hb-code__bar">{{ pane.label }}</p>
                  <pre class="hb-code__pre"><code><template v-for="(line, n) in pane.lines" :key="n"><template v-if="n">{{ '\n' }}</template><span
                    v-for="(seg, k) in line"
                    :key="k"
                    :class="seg.tone ? `is-${seg.tone}` : undefined"
                  >{{ seg.text }}</span></template></code></pre>
                </div>
              </div>

              <table v-if="card.table" class="hb-mini">
                <caption>{{ card.table.caption }}</caption>
                <thead>
                  <tr><th v-for="h in card.table.head" :key="h" scope="col">{{ h }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in card.table.rows" :key="row[0]">
                    <th scope="row">{{ row[0] }}</th>
                    <td v-for="(cell, k) in row.slice(1)" :key="k">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>

              <ul class="hb-notes">
                <li v-for="(parts, k) in card.noteParts" :key="k">
                  <template v-for="(part, j) in parts" :key="j"><code v-if="part.code">{{ part.text }}</code><template v-else>{{ part.text }}</template></template>
                </li>
              </ul>

              <div class="hb-card__foot">
                <p class="hb-line">
                  <span class="hb-line__key">术语</span>
                  <a v-for="key in card.terms" :key="key" class="hb-chip" :href="`#${key}`">{{ terms[key].term }}</a>
                </p>
                <p class="hb-line">
                  <span class="hb-line__key">讲它的关卡</span>
                  <template v-for="s in card.stageLinks" :key="s.id">
                    <a v-if="s.href" class="hb-chip" :href="withBase(s.href)">{{ s.code }} {{ s.title }}</a>
                    <span v-else class="hb-chip is-soon">{{ s.code }} {{ s.title }}<span class="hb-hidden">（还在建设中）</span></span>
                  </template>
                </p>
              </div>
            </li>
          </ul>
          <p v-else class="hb-empty">没有匹配的速查卡片。</p>
        </section>

        <!-- 术语索引 -->
        <section :id="SECTION_IDS.terms" class="hb-section" :aria-labelledby="`${uid}-terms`">
          <div class="hb-section__head">
            <h2 :id="`${uid}-terms`">术语索引</h2>
            <span class="hb-count">{{ searching ? `${shownKeys.size} / ` : '' }}{{ TERM_TOTAL }} 个</span>
          </div>
          <p class="hb-section__note">按区域分，区域里按拼音 / 字母排。<template v-if="anySoon">虚线框的关卡还在建设中。</template></p>

          <div v-for="z in shownIndex" :key="z.zone.id" class="hb-zone">
            <div class="hb-zone__head">
              <h3 class="hb-zone__name">{{ z.zone.name }}</h3>
              <span class="hb-count">{{ searching ? `${z.count} / ` : '' }}{{ z.total }} 个</span>
            </div>
            <nav class="hb-letters" :aria-label="`${z.zone.name}术语的首字母`">
              <a v-for="g in z.groups" :key="g.letter" :href="`#${g.anchor}`">{{ g.letter }}</a>
            </nav>

            <div v-for="g in z.groups" :id="g.anchor" :key="g.letter" class="hb-letter">
              <h4 class="hb-letter__mark">{{ g.letter }}</h4>
              <dl class="hb-terms">
                <div v-for="key in g.keys" :id="key" :key="key" class="hb-term" :class="{ 'is-target': target === key }">
                  <dt class="hb-term__name">
                    <dfn>{{ terms[key].term }}</dfn>
                    <span v-if="terms[key].en" class="hb-term__en" lang="en">{{ terms[key].en }}</span>
                  </dt>
                  <dd class="hb-term__body">
                    <p class="hb-term__short">{{ terms[key].short }}</p>
                    <template v-if="terms[key].analogy">
                      <p class="hb-term__analogy"><span class="hb-line__key">工坊城里</span>{{ terms[key].analogy }}</p>
                      <p class="hb-term__analogy"><span class="hb-line__key">比喻边界</span>{{ terms[key].limit }}</p>
                    </template>
                    <p class="hb-line">
                      <span class="hb-line__key">出现在</span>
                      <template v-for="s in terms[key].stageLinks" :key="s.id">
                        <a v-if="s.href" class="hb-chip" :href="withBase(s.href)">{{ s.code }} {{ s.title }}</a>
                        <span v-else class="hb-chip is-soon">{{ s.code }} {{ s.title }}<span class="hb-hidden">（还在建设中）</span></span>
                      </template>
                    </p>
                    <p v-if="terms[key].cards.length" class="hb-line">
                      <span class="hb-line__key">速查</span>
                      <a v-for="card in terms[key].cards" :key="card.id" class="hb-chip" :href="`#${card.anchor}`">{{ card.title }}</a>
                    </p>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          <p v-if="!shownIndex.length" class="hb-empty">没有匹配的术语。</p>
          <p v-if="emptyZones && !searching" class="hb-section__note hb-section__note--after">{{ emptyZones }}的术语还没有登记，关卡写好时补进来。</p>
        </section>

        <!-- 工坊城比喻表 -->
        <section :id="SECTION_IDS.analogies" class="hb-section" :aria-labelledby="`${uid}-analogies`">
          <div class="hb-section__head">
            <h2 :id="`${uid}-analogies`">工坊城比喻表</h2>
            <span class="hb-count">{{ searching ? `${shownAnalogies.length} / ` : '' }}{{ ANALOGY_KEYS.length }} 条</span>
          </div>
          <p class="hb-section__note">全站只用这一套比喻，每一条后面写着它在哪里不成立。</p>

          <table v-if="shownAnalogies.length" class="hb-analogy">
            <thead>
              <tr>
                <th scope="col">概念</th>
                <th scope="col">工坊城里</th>
                <th scope="col">比喻边界</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="key in shownAnalogies" :key="key">
                <th scope="row"><a :href="`#${key}`">{{ terms[key].term }}</a></th>
                <td>{{ terms[key].analogy }}</td>
                <td>{{ terms[key].limit }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="hb-empty">没有匹配的比喻。</p>
        </section>

        <!-- 实验环境指南 -->
        <section :id="SECTION_IDS.setup" class="hb-section" :aria-labelledby="`${uid}-setup`">
          <div class="hb-section__head">
            <h2 :id="`${uid}-setup`">实验环境指南</h2>
          </div>
          <div class="hb-setup" :class="{ 'is-soon': !data.setupReady }">
            <p class="hb-setup__lead">铸造城和试炼场的实验室要在 AMD GPU 上跑。指南讲怎样在云平台或本地准备环境，怎样一键打开实验室的 Notebook。</p>
            <ul class="hb-setup__zones">
              <li v-for="zone in ZONES" :key="zone.id">
                <span class="hb-setup__zone">{{ zone.name }}</span>{{ zone.env }}
              </li>
            </ul>
            <a v-if="data.setupReady" class="hb-btn" :href="withBase('/handbook/setup/')">打开实验环境指南</a>
            <p v-else class="hb-setup__soon">
              <span class="hb-tag">建设中</span>
              <span>指南还在写。没有 GPU 也能先往下走：真卡关卡可以选「观摩模式」，回放实验档案馆里的真实运行记录，能通关，但不得星。</span>
            </p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style>
/* 代码的两种写法：默认（服务端渲染、没有偏好、偏好是 HIP）显示 HIP 风格，属性是 python 时反过来（同 LangCode）。 */
.hb-code__pane[data-lang='python'],
html[data-hg-lang='python'] .hb-code__pane[data-lang='hip'] {
  display: none;
}

html[data-hg-lang='python'] .hb-code__pane[data-lang='python'] {
  display: block;
}
</style>

<style scoped>
.hb {
  font-size: var(--hg-text-handbook);
}

.hb-hidden {
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

.hb-head {
  margin-bottom: 24px;
}

.hb-eyebrow {
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hb .hb-head__title {
  margin: 2px 0 8px;
}

.hb-head__lead {
  max-width: 44em;
  margin: 0;
  color: var(--hg-ink-2);
}

/* ---------- 两栏：桌面上搜索和目录在左边吸顶，窄屏在上面 ---------- */

.hb-body {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 28px;
  align-items: start;
}

.hb-side {
  position: sticky;
  top: 84px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.hb-search {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hb-search__label {
  color: var(--hg-ink-3);
  font-size: 13px;
  font-weight: 600;
}

.hb-search__input {
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
}

.hb-search__input::placeholder {
  color: var(--hg-ink-3);
}

.hb-search__input:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

.hb-search__found {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
  line-height: 1.5;
}

.hb-toc ul {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hb-toc li {
  margin: 0;
}

.hb-toc a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: var(--hg-radius-tag);
  color: var(--hg-ink-2);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: background-color var(--motion-fast) var(--motion-ease-out);
}

.hb-toc a:hover {
  background: var(--hg-surface-2);
  color: var(--hg-ink);
}

.hb-toc a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

.hb-toc__count {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hb-toc__soon {
  color: var(--hg-ink-3);
  font-size: 12.5px;
}

@media (max-width: 959px) {
  .hb-body {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .hb-side {
    position: static;
  }

  .hb-toc ul {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
  }

  .hb-toc a {
    min-height: 32px;
    border: var(--hg-border-width) solid var(--hg-border);
    background: var(--hg-surface-2);
  }
}

/* ---------- 每一节 ---------- */

.hb-main {
  min-width: 0;
}

.hb-section + .hb-section {
  margin-top: 40px;
}

.hb-section__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 6px;
}

/* 节标题：去掉正文 h2 的分隔线和大间距，节与节之间的间距由 .hb-section 给。 */
.hb .hb-section__head h2 {
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 24px;
}

.hb-section__tool {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.hb-section__tool-label {
  color: var(--hg-ink-3);
  font-size: 13px;
}

.hb-section__note {
  margin: 0 0 16px;
  color: var(--hg-ink-3);
  font-size: 14px;
  line-height: 1.6;
}

.hb .hb-section__note--after {
  margin: 16px 0 0;
}

.hb-count {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hb-empty {
  margin: 0;
  padding: 16px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  color: var(--hg-ink-2);
  font-size: 14px;
}

/*
 * 从别处跳过来的那一条：强调色描边加浅底，描边比平常粗（不只靠颜色）。
 * 术语条目是卡片里的一行，描边画在行内（.hb-term.is-target 在术语索引那一段）。
 */
.hb-card.is-target {
  border-color: var(--hg-accent);
  box-shadow: 0 0 0 1px var(--hg-accent);
  background: var(--hg-accent-soft);
}

/* 跳过来时 VitePress 把焦点交给这一条（读屏从这里往下读），描边已经标出位置，不再画焦点框。 */
.hb-card:focus,
.hb-term:focus {
  outline: none;
}

/* ---------- 速查卡片 ---------- */

.hb-cards {
  display: grid;
  /* 380px：放不下两张这么宽的卡片时排成一栏，代码区宽，不挤成两栏横向滚动 */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr));
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hb-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  margin: 0;
  padding: 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.hb .hb-card__title {
  margin: 0;
  font-size: var(--hg-text-card-title);
}

.hb-formula {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 13.5px;
  line-height: 1.6;
}

/* 代码区（01 第 2.4 节）：亮暗主题下都是深色底，顶部一条写着写法的文件名栏。 */
.hb-code__pane {
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-code-dot);
  border-radius: var(--hg-radius-control);
  background: var(--hg-code-bg);
}

.hb-code__bar {
  margin: 0;
  padding: 6px 10px;
  border-bottom: var(--hg-border-width) solid var(--hg-code-dot);
  color: var(--hg-code-file);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hb-code__pre {
  margin: 0;
  padding: 10px;
  overflow-x: auto;
  color: var(--hg-code-ink);
  font-family: var(--hg-font-mono);
  /*
   * 12px：版心封顶以后（视口 1168px 以上），两栏卡片的代码区里放得下一整行下标公式（46 个字符，
   * JetBrains Mono 每个字 0.64em），不用横向滚动；更窄的屏幕上代码区自己横向滚动（01 第 7 节）。
   */
  font-size: 12px;
  line-height: 1.7;
}

/* VitePress 的基础样式给 code 单独设了字体，这里跟着 pre 走。 */
.hb-code__pre code {
  color: inherit;
  font: inherit;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

.hb-mini {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.hb-mini caption {
  caption-side: bottom;
  padding-top: 6px;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-body);
  font-size: 12.5px;
  line-height: 1.5;
  text-align: left;
}

.hb-mini th,
.hb-mini td {
  padding: 5px 8px;
  border: var(--hg-border-width) solid var(--hg-border);
  text-align: center;
}

.hb-mini th[scope='row'],
.hb-mini thead th:first-child {
  background: var(--hg-surface-2);
  font-family: var(--hg-font-body);
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}

.hb-notes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0 0 0 18px;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.6;
}

.hb-notes li {
  margin: 0;
}

.hb-card__foot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

/* ---------- 一行标签：术语、关卡、速查 ---------- */

.hb-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 13px;
}

.hb-line__key {
  margin-right: 2px;
  color: var(--hg-ink-3);
  font-size: 12.5px;
}

.hb-chip {
  display: inline-flex;
  align-items: baseline;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface-2);
  color: var(--hg-ink);
  font-size: 13px;
  line-height: 1.6;
  text-decoration: none;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

a.hb-chip:hover {
  border-color: var(--hg-accent);
  text-decoration: none;
}

a.hb-chip:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* 那一关还在建设中，进不去：虚线框，同世界地图「建设中」的画法。 */
.hb-chip.is-soon {
  border-style: dashed;
  border-color: var(--hg-border-strong);
  background: transparent;
  color: var(--hg-ink-2);
}

/* ---------- 术语索引 ---------- */

.hb-zone + .hb-zone {
  margin-top: 28px;
}

.hb-zone__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.hb .hb-zone__name {
  margin: 0;
  font-size: var(--hg-text-card-title);
}

.hb-letters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 10px 0 14px;
}

.hb-letters a {
  display: grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-tag);
  background: var(--hg-surface);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.hb-letters a:hover {
  border-color: var(--hg-accent);
  color: var(--hg-ink);
}

.hb-letters a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

/* 桌面：字母在左边一栏，条目在右边；窄屏字母在条目上面。 */
.hb-letter {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 12px;
}

.hb-letter + .hb-letter {
  margin-top: 12px;
}

.hb .hb-letter__mark {
  margin: 14px 0 0;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 18px;
}

/* 一个字母一张卡片，一个术语一行：名字一栏、定义和链接一栏（按字母往下读，不在两栏之间来回跳）。 */
.hb-terms {
  margin: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.hb-term {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 4px 20px;
  padding: 14px 18px;
}

.hb-term + .hb-term {
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.hb-term__name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.hb-term__name dfn {
  color: var(--hg-ink);
  font-family: var(--hg-font-display);
  font-size: 17px;
  font-style: normal;
  font-weight: 700;
  line-height: 1.4;
}

.hb-term__en {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12.5px;
  line-height: 1.4;
}

.hb-term__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  margin: 0;
}

.hb-term__body p {
  margin: 0;
}

.hb-term__short {
  color: var(--hg-ink);
  line-height: 1.6;
}

.hb-term__analogy {
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.6;
}

.hb-term__analogy .hb-line__key {
  margin-right: 8px;
}

.hb-term.is-target {
  background: var(--hg-accent-soft);
  box-shadow: inset 0 0 0 2px var(--hg-accent);
}

@media (max-width: 639px) {
  .hb-term {
    grid-template-columns: minmax(0, 1fr);
    padding: 12px 14px;
  }

  .hb-term__name {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
  }
}

@media (max-width: 559px) {
  .hb-letter {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .hb .hb-letter__mark {
    margin: 0;
    font-size: 15px;
  }
}

/* ---------- 比喻表 ---------- */

.hb .hb-analogy {
  display: table;
  width: 100%;
  margin: 0;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 14px;
  line-height: 1.6;
}

.hb-analogy th,
.hb-analogy td {
  padding: 8px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  vertical-align: top;
  text-align: left;
}

.hb-analogy thead th {
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font-size: 13px;
  font-weight: 600;
}

.hb-analogy thead th:first-child {
  width: 22%;
}

.hb-analogy thead th:nth-child(2) {
  width: 34%;
}

/* 700：中文系统字体多半没有 600，会退回常规字重，和英文的术语名粗细对不上。 */
.hb-analogy tbody th {
  background: var(--hg-surface);
  font-weight: 700;
}

.hb-analogy td {
  background: var(--hg-surface);
  color: var(--hg-ink-2);
}

.hb-analogy td:nth-child(2) {
  color: var(--hg-ink);
}

@media (max-width: 559px) {
  .hb .hb-analogy {
    font-size: 13px;
  }

  .hb-analogy th,
  .hb-analogy td {
    padding: 6px 8px;
  }
}

/* ---------- 实验环境指南 ---------- */

.hb-setup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

/* 还没写好：虚线框（同世界地图「建设中」）。 */
.hb-setup.is-soon {
  border-style: dashed;
  border-color: var(--hg-border-strong);
}

.hb-setup__lead {
  margin: 0;
}

.hb-setup__zones {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.hb-setup__zones li {
  margin: 0;
}

.hb-setup__zone {
  display: inline-block;
  min-width: 4.5em;
  color: var(--hg-ink);
  font-weight: 600;
}

.hb-setup__soon {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.6;
}

.hb-tag {
  flex: none;
  padding: 0 8px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12.5px;
}

.hb-btn {
  display: inline-flex;
  align-self: flex-start;
  align-items: center;
  min-height: 40px;
  padding: 0 16px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-ink);
  color: var(--hg-surface);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.hb-btn:hover {
  text-decoration: none;
}

.hb-btn:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}
</style>
