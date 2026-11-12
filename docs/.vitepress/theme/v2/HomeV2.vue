<script setup lang="ts">
/**
 *
 * 从上到下：深色英雄区（小核、一句话介绍、主按钮）→ 三个区域 → 前言和旧版教程两个入口
 * → 项目信息（Datawhale、GitHub、贡献者）。
 *
 * 主按钮分新老访客，规则和世界地图、区域首页是同一套（docs/course/journey.ts）：
 * - 第一次来（isNewcomer）：「开始冒险」和「定级测试」。开始冒险去新手村第一关；第一关还没上线时去前言，
 *   前言里有三类读者各自的起点。
 * - 再来：whereAmI 找最近打开、还没完成的已上线关卡，按钮是「继续上次的关卡」；没有这样的关卡时是下一关
 *   （「开始下一关」），下一关还在建设中就去世界地图，全部走完去「我的成长」。没做过定级、关卡也没走完的读者，
 *   旁边一直有「定级测试」。
 * 存档读出来之前不知道是哪一种，按钮这一块先按第一次来的样子占住位置、不显示，免得先说错再改口（同世界地图的欢迎区）。
 *
 * 区域卡片的名字、一句话、推荐等级、运行环境、适合谁、关卡数都从 outline.json 读；旧版教程的入口是旧版目录页 /v1/（M-01）；
 * 贡献者用旧首页的名单（../contributors.ts），样式按 01 的 token 重写。
 */
import { computed, useId } from 'vue'
import { withBase } from 'vitepress'
import Mascot from '@kit/Mascot.vue'
import { isPublished, stageHref, STAGES, ZONES } from '@course/outline.ts'
import { isNewcomer, whereAmI } from '@course/journey.ts'
import { useProgress } from '@course/useProgress.ts'
import { contributors, contributorsUrl, contributeUrl } from '../contributors.ts'

const REPO = 'https://github.com/datawhalechina/hello-gpu'
const ORG = 'https://github.com/datawhalechina'

const { state, loaded } = useProgress()
const uid = useId()

// ── 主按钮：新老访客 ─────────────────────────────────────────────────────

interface Hero {
  /** 按钮上面的一句话；name 是关卡的编号和名字，加粗。 */
  before: string
  name: string
  after: string
  primary: { text: string; href: string }
  /** 那句话说的就是主按钮去哪（老访客），读屏把它念成主按钮的说明。 */
  describes: boolean
  placement: boolean
}

const first = STAGES.find((s) => s.zone === 'novice')
const NEWCOMER: Hero = {
  before: '会 PyTorch 或写过算子？先做定级测试，跳过已经会的关卡。',
  name: '',
  after: '',
  primary: { text: '开始冒险', href: withBase(first && isPublished(first) ? stageHref(first) : '/preface/') },
  describes: false,
  placement: true,
}

const hero = computed<Hero>(() => {
  if (!loaded.value || isNewcomer(state)) return NEWCOMER
  const w = whereAmI(state)
  // 全部走完就不用再定级了（同世界地图的欢迎区）。
  if (!w) {
    return { before: '三个区域的关卡都走完了。', name: '', after: '', primary: { text: '看看我的成长', href: withBase('/me/') }, describes: true, placement: false }
  }
  const placement = !state.placement
  const name = `${w.stage.code} ${w.stage.title}`
  if (!isPublished(w.stage)) {
    return { before: '下一关是 ', name, after: '，还在建设中。', primary: { text: '看世界地图', href: withBase('/world/') }, describes: true, placement }
  }
  const last = w.reason === 'last'
  return {
    before: last ? '你上次停在 ' : '下一关是 ',
    name,
    after: '。',
    primary: { text: last ? '继续上次的关卡' : '开始下一关', href: withBase(stageHref(w.stage)) },
    describes: true,
    placement,
  }
})

// ── 区域卡片：全部来自 outline.json ─────────────────────────────────────────

const zones = ZONES.map((zone) => {
  const stages = STAGES.filter((s) => s.zone === zone.id)
  const bosses = stages.filter((s) => s.kind === 'boss').length
  return {
    ...zone,
    href: withBase(`/${zone.id}/`),
    count: bosses ? `${stages.length - bosses} 关 + Boss` : `${stages.length} 关`,
  }
})

const legacyHref = withBase('/v1/')
</script>

<template>
  <div class="hg-home">
    <!-- 设计稿 Main 的深色英雄区（01 第 2.5 节）；小核在欢迎区出场（01 第 5 节），简洁模式收起。 -->
    <section class="hg-home__hero" data-hg-theme="dark" :aria-labelledby="`${uid}-title`">
      <Mascot class="hg-home__mascot" :size="140" />
      <div class="hg-home__intro">
        <p class="hg-home__eyebrow">GPU KERNEL OPTIMIZATION · LEVEL-BASED</p>
        <!-- 窄屏放不下一行时在「闯关学」后面换行，不把「编程」拆开。 -->
        <h1 :id="`${uid}-title`" class="hg-home__title">闯关学 <span class="hg-home__keep">AMD GPU 编程</span></h1>
        <p class="hg-home__lead">先在浏览器里看懂 GPU 怎么执行，再到真卡上把算子推近硬件上限。</p>
        <div class="hg-home__start" :class="{ 'is-loading': !loaded }" :aria-busy="!loaded">
          <p :id="`${uid}-line`" class="hg-home__line">
            {{ hero.before }}<strong v-if="hero.name">{{ hero.name }}</strong>{{ hero.after }}
          </p>
          <p class="hg-home__actions">
            <a
              class="hg-home__btn is-primary"
              :href="hero.primary.href"
              :aria-describedby="hero.describes ? `${uid}-line` : undefined"
            >{{ hero.primary.text }}</a>
            <a v-if="hero.placement" class="hg-home__btn" :href="withBase('/placement/')">定级测试</a>
          </p>
        </div>
      </div>
    </section>

    <section :aria-labelledby="`${uid}-zones`">
      <h2 :id="`${uid}-zones`" class="hg-home__h2">三个区域</h2>
      <p class="hg-home__sub">
        由浅到深。区域从不上锁，推荐等级只是建议；全部关卡在<a :href="withBase('/world/')">世界地图</a>上。
      </p>
      <ul class="hg-home__zones">
        <li v-for="z in zones" :key="z.id" class="hg-home__zone" :data-zone="z.id">
          <p class="hg-home__zcode">{{ z.code }}</p>
          <h3 class="hg-home__zname"><a :href="z.href">{{ z.name }}</a></h3>
          <p class="hg-home__zsummary">{{ z.summary }}</p>
          <p class="hg-home__zmeta"><span>推荐 Lv.{{ z.lv[0] }}–{{ z.lv[1] }}</span> · <span>{{ z.env }}</span></p>
          <p class="hg-home__zmeta"><span>适合：{{ z.readers }}</span> · <span>{{ z.count }}</span></p>
          <svg class="hg-home__go" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </li>
      </ul>
    </section>

    <section :aria-labelledby="`${uid}-doors`">
      <h2 :id="`${uid}-doors`" class="hg-home__hidden">更多入口</h2>
      <ul class="hg-home__doors">
        <li class="hg-home__door">
          <h3 class="hg-home__dname"><a :href="withBase('/preface/')">前言</a></h3>
          <p class="hg-home__dtext">这本教程怎么玩、三类读者从哪里开始、需要什么环境、进度存在哪。</p>
          <svg class="hg-home__go" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </li>
        <li class="hg-home__door">
          <h3 class="hg-home__dname"><a :href="legacyHref">旧版教程</a></h3>
          <p class="hg-home__dtext">原来按章节写的教程：从第一个 kernel，到经典算子优化，再到算子优化 Agent。内容仍然可用。</p>
          <svg class="hg-home__go" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </li>
      </ul>
    </section>

    <section class="hg-home__about" :aria-labelledby="`${uid}-about`">
      <h2 :id="`${uid}-about`" class="hg-home__h2">关于这个项目</h2>
      <p class="hg-home__sub">
        Hello GPU 由 Datawhale 社区发起，在 GitHub 上开源。纠错、复跑实验、补充实测数据，都欢迎提 issue 或 PR。
      </p>
      <ul class="hg-home__out">
        <li>
          <a class="hg-home__btn" :href="REPO" target="_blank" rel="noreferrer">
            GitHub 仓库
            <svg class="hg-home__ext" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M13 5h6v6M19 5l-9 9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </li>
        <li>
          <a class="hg-home__btn" :href="ORG" target="_blank" rel="noreferrer">
            Datawhale 的 GitHub
            <svg class="hg-home__ext" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M13 5h6v6M19 5l-9 9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </li>
        <li>
          <a class="hg-home__btn" :href="contributeUrl" target="_blank" rel="noreferrer">
            参与贡献
            <svg class="hg-home__ext" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M13 5h6v6M19 5l-9 9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </li>
      </ul>

      <div class="hg-home__peoplehead">
        <h3 :id="`${uid}-people`" class="hg-home__h3">贡献者</h3>
        <a class="hg-home__all" :href="contributorsUrl" target="_blank" rel="noreferrer">
          查看全部贡献
          <svg class="hg-home__ext" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M13 5h6v6M19 5l-9 9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      </div>
      <ul class="hg-home__people" :aria-labelledby="`${uid}-people`">
        <li v-for="p in contributors" :key="p.login">
          <a
            class="hg-home__person"
            :href="p.url"
            target="_blank"
            rel="noreferrer"
            :aria-label="`${p.name}，${p.role}，GitHub 主页（新窗口）`"
          >
            <img :src="withBase(p.avatar)" alt="" width="44" height="44" loading="lazy" decoding="async" />
            <span class="hg-home__pname">{{ p.name }}</span>
            <span class="hg-home__prole">{{ p.role }}<template v-if="p.affiliation"> · {{ p.affiliation }}</template></span>
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.hg-home {
  display: flex;
  flex-direction: column;
  gap: 44px;
}

.hg-home__hidden {
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

/* ---------- 英雄区：亮暗主题下都是深色面板（data-hg-theme="dark"），配色同世界地图的地图面板 ---------- */

.hg-home__hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px 36px;
  padding: 36px 40px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background-color: var(--hg-bg);
  background-image: var(--hg-dot-pattern);
  background-size: 18px 18px;
  box-shadow: var(--hg-shadow-hero);
  color: var(--hg-ink);
}

.hg-shell.is-plain .hg-home__hero {
  background-image: none;
}

/* 深色底上天线杆用浅色（tokens.css 的 --hg-art-trial-wire：「深色底上的天线杆」），其余配色不变。 */
.hg-home__hero .hg-home__mascot {
  --m-wire: var(--hg-art-trial-wire);
  flex: none;
}

/* 简洁模式收起插画（01 第 4 节）。 */
.hg-shell.is-plain .hg-home__mascot {
  display: none;
}

.hg-home__intro {
  display: flex;
  flex: 1 1 460px;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.hg-home__eyebrow {
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-home__title {
  margin: 0;
  padding: 0;
  border: 0;
  color: var(--hg-ink);
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-h1);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: var(--hg-tracking-h1);
}

.hg-home__keep {
  white-space: nowrap;
}

.hg-home__lead {
  max-width: 34em;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 17px;
}

.hg-home__start {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 6px;
}

/* 存档读出来之前不知道是新访客还是老访客，先占住位置（按第一次来的样子），不显示。 */
.hg-home__start.is-loading {
  visibility: hidden;
}

.hg-home__line {
  min-height: 1.6em;
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
}

.hg-home__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
}

/* ---------- 按钮：主按钮深墨底、反色字（暗色下反过来），强调色只留给进度和焦点（01 第 2.2 节） ---------- */

.hg-home__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 18px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  text-decoration: none;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.hg-home__btn.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-home__btn:hover {
  border-color: var(--hg-accent);
  text-decoration: none;
}

.hg-home__btn:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-home__ext {
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: var(--hg-ink-3);
}

/* ---------- 小节标题 ---------- */

.hg-home__h2 {
  margin: 0 0 6px;
  padding: 0;
  border: 0;
  font-size: 24px;
}

.hg-home__h3 {
  margin: 0;
  font-size: var(--hg-text-card-title);
}

.hg-home__sub {
  max-width: 44em;
  margin: 0 0 16px;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* ---------- 区域卡片和入口卡片：整张卡都能点（名字链接的伪元素铺满卡片），读屏只念名字 ---------- */

.hg-home__zones,
.hg-home__doors {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-home__zones {
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.hg-home__doors {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.hg-home__zone,
.hg-home__door {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 18px 48px 18px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

/* 区域卡片的描边带一点区域强调色（同世界地图的区域卡片）；试炼场是深色区域，卡片用它的深紫底（01 第 4 节）。 */
.hg-home__zone {
  border-color: color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
}

.hg-home__zone[data-zone='trial'] {
  background: var(--hg-bg);
}

.hg-home__zone:hover,
.hg-home__door:hover {
  border-color: var(--hg-accent);
}

.hg-home__zcode {
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-home__zname,
.hg-home__dname {
  margin: 0;
  font-family: var(--hg-font-display);
  font-size: 19px;
  line-height: 1.3;
}

.hg-home__zname a,
.hg-home__dname a {
  color: var(--hg-ink);
  text-decoration: none;
}

.hg-home__zname a:focus-visible,
.hg-home__dname a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* 键盘聚焦时描整张卡，链接自己不再描；不支持 :has 的浏览器照样描链接。鼠标点击不描（只看 :focus-visible）。 */
@supports selector(:has(*)) {
  .hg-home__zname a:focus-visible,
  .hg-home__dname a:focus-visible {
    outline: none;
  }

  .hg-home__zone:has(a:focus-visible),
  .hg-home__door:has(a:focus-visible) {
    outline: 2px solid var(--hg-accent-ink);
    outline-offset: 2px;
  }
}

.hg-home__zname a::after,
.hg-home__dname a::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.hg-home__zsummary,
.hg-home__dtext {
  margin: 0;
  color: var(--hg-ink);
  font-size: 14px;
  line-height: 1.6;
}

.hg-home__zmeta {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

/* 每一段整段换行，「Lv.20–30」不会断在中间。 */
.hg-home__zmeta span {
  white-space: nowrap;
}

.hg-home__go {
  position: absolute;
  top: 18px;
  right: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: var(--hg-ink-3);
  transition: color var(--motion-fast) var(--motion-ease-out), transform var(--motion-fast) var(--motion-ease-out);
}

.hg-home__zone:hover .hg-home__go,
.hg-home__door:hover .hg-home__go {
  color: var(--hg-accent-ink);
  transform: translateX(3px);
}

/* ---------- 项目信息 ---------- */

.hg-home__out {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0 0 28px;
  padding: 0;
  list-style: none;
}

.hg-home__out li {
  margin: 0;
}

.hg-home__peoplehead {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 16px;
  margin-bottom: 12px;
}

.hg-home__all {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--hg-ink-2);
  font-size: 14px;
  text-decoration: none;
}

.hg-home__all:hover {
  color: var(--hg-ink);
  text-decoration: underline;
}

.hg-home__people {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-home__people li {
  margin: 0;
}

.hg-home__person {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 12px;
  /* 卡片按同一行里最高的那张拉高；名字和角色在矮卡片里居中，不被拉开。 */
  align-content: center;
  align-items: center;
  height: 100%;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
  text-decoration: none;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.hg-home__person:hover {
  border-color: var(--hg-accent);
  text-decoration: none;
}

.hg-home__person:focus-visible,
.hg-home__all:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-home__person img {
  grid-row: 1 / 3;
  width: 44px;
  height: 44px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: 50%;
  background: var(--hg-surface-2);
  object-fit: cover;
}

.hg-home__pname {
  min-width: 0;
  font-weight: 700;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.hg-home__prole {
  min-width: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
  line-height: 1.45;
}

/* ---------- 手机 ---------- */

@media (max-width: 767px) {
  .hg-home {
    gap: 36px;
  }

  .hg-home__hero {
    gap: 14px;
    padding: 22px 18px 24px;
  }

  .hg-home__hero .hg-home__mascot :deep(svg) {
    width: 76px;
    height: 76px;
  }

  .hg-home__intro {
    gap: 10px;
  }

  .hg-home__lead {
    font-size: 16px;
  }

  .hg-home__h2 {
    font-size: 22px;
  }

  .hg-home__people {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }

  .hg-home__person {
    grid-template-columns: 1fr;
    grid-template-rows: none;
    row-gap: 8px;
    align-content: start;
    align-items: start;
  }

  .hg-home__person img {
    grid-row: auto;
  }
}
</style>
