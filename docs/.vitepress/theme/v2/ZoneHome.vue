<script setup lang="ts">
/**
 * 区域首页（P-03；01 第 4–5 节，04 第 1、6 节；设计稿 Zones 画板）：/novice/、/forge/、/trial/ 共用。
 *
 * 是哪个区域看页面 frontmatter 的 zone（布局 HgLayout 也按它换装），正文只写一句主线委托：
 *   <ZoneHome mission="在真卡上铸一个比 torch 更快的算子，再让 Agent 照着做一遍。" />
 * 区域的名字、推荐等级、运行环境、关卡（按 arc 分组，每关「学完能回答」）、两条路线怎么分、副本都从
 * outline.json 读（docs/course/outline.ts）；关卡的状态和星从进度存档算，规则和世界地图相同
 * （docs/course/journey.ts）。这里不手写任何关卡信息。
 *
 * 从上到下：区域头（一句话目标、推荐等级、运行环境、适合谁、关卡数）和小核带来的主线委托（Boss 是委托的终点）
 *   → 你在这个区域的进度和「继续」→ 选路线和「两条路线怎么分」（只有分路线的区域：铸造城、试炼场）
 *   → 按 arc 分组的关卡列表 → 副本入口 → 相邻区域。
 * 选路线就是写存档里的路线偏好，和分路线关卡状态栏上的切换是同一项，铸造城和试炼场共用。哪张卡亮着由
 *   <html data-hg-route> 上的 CSS 决定（同 PrefSwitch），构建出来的页面首屏就是对的；aria-pressed 读完存档再换。
 * 存档读出来之前，状态和星按空存档画（和服务端渲染一样），「继续」那一句先占位、不显示。
 */
import { computed, useId } from 'vue'
import { useData, withBase } from 'vitepress'
import Mascot from '@kit/Mascot.vue'
import { contentError } from '@kit/contentError.ts'
import { BADGE_BY_ID } from '@course/badges.ts'
import {
  arcsOf, dungeonHref, EXERCISES, isPublished, routeSplitOf, stageHref, STAGES, ZONES, zoneById, type StageMeta,
} from '@course/outline.ts'
import { MAX_STARS, type Route } from '@course/progress.ts'
import { showsStars, stageStatus, STATUS_ICONS, STATUS_TEXT, whereAmI, zoneProgress, type StageStatus } from '@course/journey.ts'
import { useProgress } from '@course/useProgress.ts'

const props = defineProps<{
  /** 主线委托（04 第 6 节）：一句话，不超过 30 字；这个区域的 Boss 是它的高潮。 */
  mission: string
}>()

const { frontmatter, page } = useData()
const progress = useProgress()
const { state, loaded, level } = progress
const uid = useId()

const zone = computed(() => {
  const id = frontmatter.value.zone
  return typeof id === 'string' ? zoneById(id) ?? null : null
})

const problem = computed(() => {
  if (!zone.value) {
    return contentError('ZoneHome 只能放在区域首页：frontmatter 的 zone 要写 novice、forge 或 trial。', page.value.relativePath)
  }
  if (!props.mission?.trim()) {
    return contentError('ZoneHome 缺少 mission：每个区域首页要写一句主线委托（04 第 6 节）。', page.value.relativePath)
  }
  return ''
})

/** 「3 小时 50 分钟」：区域里各关时长加起来。 */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h ? `${h} 小时` : '', m ? `${m} 分钟` : ''].filter(Boolean).join(' ') || '0 分钟'
}

/** arc 写成「A 为什么是 GPU：先看全景」：开头的字母排成小方块，后面是组名；没有字母时整句当组名。 */
function arcLabel(arc: string) {
  const m = /^([A-Z])\s+(.+)$/.exec(arc)
  return m ? { letter: m[1], name: m[2] } : { letter: '', name: arc }
}

/** 只由大纲决定、和读者进度无关的部分。 */
const view = computed(() => {
  const z = zone.value
  if (!z) return null
  const stages = STAGES.filter((s) => s.zone === z.id)
  const bosses = stages.filter((s) => s.kind === 'boss')
  const gpu = stages.filter((s) => s.gpu).length
  const index = ZONES.indexOf(z)
  return {
    zone: z,
    stages,
    boss: bosses[bosses.length - 1] ?? null,
    badge: BADGE_BY_ID.get(`zone-graduate-${z.id}`) ?? null,
    count: bosses.length ? `${stages.length - bosses.length} 关 + Boss` : `${stages.length} 关`,
    minutes: duration(stages.reduce((n, s) => n + s.minutes, 0)),
    needsGpu: gpu > 0,
    // 要不要真卡，只给和区域里多数关卡不一样的关卡标出来：大多要真卡的区域标「浏览器即可」，反过来标「需要真卡」。
    mostlyGpu: gpu * 2 > stages.length,
    split: routeSplitOf(z.id),
    arcs: arcsOf(z.id).map((g) => ({ ...arcLabel(g.arc), arc: g.arc, stages: g.stages })),
    exercises: EXERCISES.find((e) => e.zone === z.id) ?? null,
    prev: ZONES[index - 1] ?? null,
    next: ZONES[index + 1] ?? null,
  }
})

// ── 读者的进度 ────────────────────────────────────────────────────────

/** 在这个区域里走到哪了：区域内最近打开、还没完成的已上线关卡，没有就是区域里下一个推荐关卡（规则同世界地图）。 */
const here = computed(() => (loaded.value && view.value ? whereAmI(state, view.value.stages) : null))

const stats = computed(() => {
  const v = view.value
  if (!v) return null
  const [p] = zoneProgress(state, [v.zone])
  const total = p.stages.length
  return { ...p, total, percent: loaded.value && total ? `${Math.round((p.done / total) * 100)}%` : '0%' }
})

const resume = computed(() => {
  const v = view.value
  if (!v || !loaded.value) return null
  const w = here.value
  if (!w) return { before: `${v.zone.name}的关卡都走完了。`, name: '', after: '', cta: null }
  const name = `${w.stage.code} ${w.stage.title}`
  const published = isPublished(w.stage)
  return {
    before: w.reason === 'last' ? '你上次停在 ' : '下一关是 ',
    name,
    after: published ? '。' : '，还在建设中。',
    cta: published ? { text: `${w.reason === 'last' ? '继续' : '开始'}：${name}`, href: withBase(stageHref(w.stage)) } : null,
  }
})

/** 读者等级低于区域的推荐等级：只是提醒，区域不上锁（04 第 1 节）。 */
const levelHint = computed(() => {
  const v = view.value
  if (!v || !loaded.value || level.value >= v.zone.lv[0]) return null
  return { min: v.zone.lv[0], level: level.value, prev: v.prev, placement: !state.placement }
})

const bossDone = computed(() => Boolean(view.value?.boss && stageStatus(view.value.boss, state) === 'done'))
const bossHref = computed(() => (view.value?.boss && isPublished(view.value.boss) ? withBase(stageHref(view.value.boss)) : ''))

interface StageCard {
  stage: StageMeta
  status: StageStatus
  boss: boolean
  /** 还没上线的关卡进不去，是空串。 */
  href: string
  stars: number
  showStars: boolean
  /** 区域里的「从这里继续」：last 上次停在这，next 下一关。 */
  here: 'last' | 'next' | null
  /** 和区域里多数关卡不一样的硬件要求，一样时是空串。 */
  hardware: string
}

const groups = computed(() => (view.value?.arcs ?? []).map((g) => ({
  ...g,
  cards: g.stages.map((stage): StageCard => {
    const status = stageStatus(stage, state)
    const published = isPublished(stage)
    const stars = state.stages[stage.id]?.stars.length ?? 0
    const mostlyGpu = view.value?.mostlyGpu ?? false
    return {
      stage,
      status,
      boss: stage.kind === 'boss',
      href: published ? withBase(stageHref(stage)) : '',
      stars,
      showStars: showsStars(stage, state),
      here: here.value?.stage.id === stage.id ? here.value.reason : null,
      hardware: stage.gpu === mostlyGpu ? '' : stage.gpu ? '需要真卡' : '浏览器即可',
    }
  }),
})))

const STAR_SLOTS = Array.from({ length: MAX_STARS }, (_, i) => i)

// ── 选路线（铸造城、试炼场） ─────────────────────────────────────────────

/** short 是手机上「两条路线怎么分」每格前面的列名。 */
const ROUTES: { value: Route; name: string; short: string; text: string }[] = [
  { value: 'hip', name: 'HIP 路线', short: 'HIP', text: '用 C++ 写 kernel，按线程思考。申请显存、拷贝、启动这些主机端代码也由你来写。' },
  { value: 'triton', name: 'Triton 路线', short: 'Triton', text: '用 Python 写 kernel，按块（tile）思考。块里的数据怎么分给线程，交给 Triton 编译器。' },
]

/** 路线偏好是全站一项：分路线的区域都跟着它（现在是铸造城和试炼场）。 */
const SPLIT_ZONES = ZONES.filter((z) => z.routes === 'split').map((z) => z.name).join('和')

const route = computed(() => state.prefs.route)

function pickRoute(value: Route) {
  progress.setPref('route', value)
}
</script>

<template>
  <p v-if="problem" class="zh-error" role="alert" data-hg-content-error>{{ problem }}</p>

  <div v-else-if="view" class="zh">
    <header class="zh-hero">
      <div class="zh-hero__intro">
        <p class="zh-hero__code">{{ view.zone.code }}</p>
        <h1 class="zh-hero__title">{{ view.zone.name }}</h1>
        <p class="zh-hero__lead">{{ view.zone.summary }}。</p>
        <dl class="zh-facts">
          <div><dt>推荐等级</dt><dd>Lv.{{ view.zone.lv[0] }}–{{ view.zone.lv[1] }}</dd></div>
          <div>
            <dt>运行环境</dt>
            <dd>{{ view.zone.env }}<template v-if="view.needsGpu">，<a class="zh-facts__link" :href="withBase('/handbook/setup/')">怎么准备</a></template></dd>
          </div>
          <div><dt>适合</dt><dd>{{ view.zone.readers }}</dd></div>
          <div><dt>关卡</dt><dd>{{ view.count }}，约 {{ view.minutes }}</dd></div>
          <div v-if="view.zone.routes === 'syntax'"><dt>写法</dt><dd>HIP 或 Python 风格，关卡里随时切换</dd></div>
          <div v-else-if="view.split.split.length"><dt>路线</dt><dd>HIP 或 Triton，关卡里随时切换</dd></div>
        </dl>
      </div>

      <!-- 小核只陪着主线委托出场（01 第 5 节：不挨着数据和表格）；装扮跟着 frontmatter 的 zone 走。 -->
      <section class="zh-quest" aria-label="主线委托">
        <Mascot class="zh-quest__art" :size="88" />
        <div class="zh-quest__card">
          <p class="zh-quest__eyebrow">
            <span aria-hidden="true">MISSION</span>
            <span v-if="bossDone" class="zh-quest__done">委托完成</span>
          </p>
          <p class="zh-quest__line">{{ mission }}</p>
          <p v-if="view.boss" class="zh-quest__boss">
            终点是 Boss「<a v-if="bossHref" :href="bossHref">{{ view.boss.title }}</a><template v-else>{{ view.boss.title }}</template>」<template v-if="view.badge">，通过后拿到「{{ view.badge.name }}」徽章</template>。
          </p>
        </div>
      </section>
    </header>

    <section
      v-if="stats"
      class="zh-progress"
      :class="{ 'is-loading': !loaded }"
      :aria-labelledby="`${uid}-progress`"
    >
      <h2 :id="`${uid}-progress`" class="zh-hidden">你在{{ view.zone.name }}的进度</h2>
      <div class="zh-progress__stats">
        <span class="zh-progress__bar" aria-hidden="true"><span :style="{ width: stats.percent }" /></span>
        <p class="zh-progress__nums">
          已通关 {{ loaded ? stats.done : '—' }} / {{ stats.total }}<template v-if="loaded && stats.exempt"> · 已豁免 {{ stats.exempt }}</template>
          · ★ {{ loaded ? stats.stars : '—' }} / {{ stats.total * MAX_STARS }}
        </p>
      </div>
      <p class="zh-progress__line" :aria-busy="!loaded">
        <template v-if="resume">{{ resume.before }}<strong v-if="resume.name">{{ resume.name }}</strong>{{ resume.after }}</template>
      </p>
      <a v-if="resume?.cta" class="zh-btn is-primary" :href="resume.cta.href">{{ resume.cta.text }}</a>
      <p v-if="levelHint" class="zh-progress__hint">
        这个区域推荐 Lv.{{ levelHint.min }} 起，你现在是 Lv.{{ levelHint.level }}。区域不上锁，可以直接开始<template v-if="levelHint.prev">；觉得吃力，先回<a :href="withBase(`/${levelHint.prev.id}/`)">{{ levelHint.prev.name }}</a></template>。<template v-if="levelHint.placement">学过 GPU 编程的话，可以先做<a :href="withBase('/placement/')">定级测试</a>，跳过已经会的关卡。</template>
      </p>
    </section>

    <section v-if="view.split.split.length" class="zh-route" :aria-labelledby="`${uid}-route`">
      <h2 :id="`${uid}-route`">选一条路线</h2>
      <p class="zh-route__intro">
        两条路线的题目、硬件讲解和实测数据都一样，只有写 kernel 的部分不同。选好以后，{{ SPLIT_ZONES }}分路线的关卡都显示这条路线。每关顶部也能随时切换。
      </p>

      <div class="zh-route__pick" role="group" aria-label="实现路线">
        <button
          v-for="r in ROUTES"
          :key="r.value"
          type="button"
          class="zh-route__opt"
          :data-route="r.value"
          :aria-pressed="route === r.value"
          @click="pickRoute(r.value)"
        >
          <span class="zh-route__head">
            <strong class="zh-route__name">{{ r.name }}</strong>
            <span class="zh-route__picked" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path :d="STATUS_ICONS.done?.[0].d" /></svg>
              已选
            </span>
          </span>
          <span class="zh-route__text">{{ r.text }}</span>
        </button>
      </div>

      <h3 :id="`${uid}-split`" class="zh-route__sub">两条路线怎么分</h3>
      <table class="zh-split" :aria-labelledby="`${uid}-split`">
        <thead>
          <tr>
            <th scope="col">关卡</th>
            <th scope="col">两条路线共用</th>
            <th v-for="r in ROUTES" :key="r.value" scope="col" :class="`is-${r.value}`">
              {{ r.name }}<span class="zh-split__picked" aria-hidden="true">已选</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="view.split.shared.length">
            <th scope="row">
              <template v-for="(s, i) in view.split.shared" :key="s.id"><template v-if="i">、</template><span class="zh-split__code">{{ s.code }}</span></template>
            </th>
            <td data-label="两条路线">全部共用</td>
            <td v-for="r in ROUTES" :key="r.value" :class="`is-${r.value} is-empty`" :data-label="r.short">—</td>
          </tr>
          <tr v-for="row in view.split.split" :key="row.stage.id">
            <th scope="row">{{ row.stage.code }} {{ row.stage.title }}</th>
            <td data-label="共用">{{ row.note?.shared ?? '—' }}</td>
            <td v-for="r in ROUTES" :key="r.value" :class="`is-${r.value}`" :data-label="r.short">{{ row.note?.[r.value] ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="zh-stages" :aria-labelledby="`${uid}-stages`">
      <h2 :id="`${uid}-stages`">关卡</h2>
      <div v-for="g in groups" :key="g.arc" class="zh-arc">
        <h3 class="zh-arc__title">
          <span v-if="g.letter" class="zh-arc__letter" aria-hidden="true">{{ g.letter }}</span>{{ g.name }}
        </h3>
        <ol class="zh-arc__list">
          <li
            v-for="c in g.cards"
            :key="c.stage.id"
            class="zh-stage"
            :class="[`is-${c.status}`, { 'is-boss': c.boss, 'is-here': c.here }]"
            :data-stage="c.stage.id"
          >
            <span class="zh-stage__dot" aria-hidden="true">
              {{ c.boss ? 'BOSS' : c.stage.code }}
              <span v-if="STATUS_ICONS[c.status]" class="zh-stage__badge">
                <svg viewBox="0 0 16 16"><path v-for="p in STATUS_ICONS[c.status]" :key="p.d" :d="p.d" :class="{ 'is-fill': p.fill }" /></svg>
              </span>
            </span>

            <div class="zh-stage__body">
              <h4 class="zh-stage__name">
                <a v-if="c.href" class="zh-stage__link" :href="c.href"><span class="zh-hidden">{{ c.stage.code }} </span>{{ c.stage.title }}</a>
                <template v-else><span class="zh-hidden">{{ c.stage.code }} </span>{{ c.stage.title }}</template>
                <span class="zh-stage__sub">{{ c.stage.subtitle }}</span>
              </h4>
              <p class="zh-stage__line"><span class="zh-stage__key">学完能回答</span>{{ c.stage.question }}</p>
              <p v-if="c.boss" class="zh-stage__line"><span class="zh-stage__key">挑战</span>{{ c.stage.interaction }}</p>
              <p class="zh-stage__meta">
                <span>推荐 Lv.{{ c.stage.lv }}</span>
                <span>约 {{ c.stage.minutes }} 分钟</span>
                <span v-if="c.hardware" class="zh-tag">{{ c.hardware }}</span>
                <span v-if="c.stage.agentSide" class="zh-tag">Agent 支线</span>
              </p>
            </div>

            <p class="zh-stage__state">
              <span v-if="c.here" class="zh-stage__here">{{ c.here === 'last' ? '上次停在这' : '下一关' }}</span>
              <span class="zh-stage__status">{{ STATUS_TEXT[c.status] }}</span>
              <span v-if="c.showStars" class="zh-stage__stars">
                <span v-for="i in STAR_SLOTS" :key="i" :class="{ 'is-on': i < c.stars }" aria-hidden="true">{{ i < c.stars ? '★' : '☆' }}</span>
                <span class="zh-hidden">，{{ MAX_STARS }} 颗星拿到 {{ c.stars }} 颗</span>
              </span>
            </p>
          </li>
        </ol>
      </div>
    </section>

    <section v-if="view.exercises" class="zh-dungeon" :aria-labelledby="`${uid}-dungeon`">
      <div class="zh-dungeon__text">
        <h2 :id="`${uid}-dungeon`">副本</h2>
        <p>挂在区域旁边的可选练习，不占主线，做完也拿经验值。</p>
        <p>
          首批：{{ view.exercises.items.map((e) => e.title).join('、') }}。练的是{{ view.exercises.practice }}。
        </p>
      </div>
      <a class="zh-btn" :href="withBase(dungeonHref(view.zone.id))">去副本大厅</a>
    </section>

    <nav class="zh-foot" aria-label="其他区域">
      <p class="zh-foot__note">区域从不上锁：推荐等级只是建议。</p>
      <ul class="zh-foot__links">
        <li v-if="view.prev"><a :href="withBase(`/${view.prev.id}/`)">← 上一个区域：{{ view.prev.name }}</a></li>
        <li><a :href="withBase('/world/')">看世界地图</a></li>
        <li v-if="view.next"><a :href="withBase(`/${view.next.id}/`)">下一个区域：{{ view.next.name }} →</a></li>
      </ul>
    </nav>
  </div>
</template>

<style scoped>
/*
 * --zh-soft：浅强调色底。--hg-accent-soft 在暗色下是半透明的，直接铺在页面上会透出点阵，
 * 所以叠在一层不透明的卡片底色上。
 */
.zh {
  --zh-soft: linear-gradient(var(--hg-accent-soft), var(--hg-accent-soft)) var(--hg-surface);
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.zh-hidden {
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

.zh-error {
  margin: 0 0 24px;
  padding: 14px 18px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-card);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}

/* 区域页面里的二级标题：去掉正文 h2 的分隔线，段落之间的间距由 .zh 的 gap 给。 */
.zh h2 {
  margin: 0 0 12px;
  padding: 0;
  border: 0;
  font-size: 24px;
}

/* ---------- 按钮：主按钮深墨底、反色字，强调色只留给进度和焦点（01 第 2.2 节） ---------- */

.zh-btn {
  display: inline-flex;
  flex: none;
  align-items: center;
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

.zh-btn.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.zh-btn:hover {
  border-color: var(--hg-accent);
  text-decoration: none;
}

.zh-btn:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* ---------- 区域头：左边是区域本身，右边是小核带来的主线委托 ---------- */

.zh-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px 36px;
  padding: 22px 20px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
}

.zh-hero__code {
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.zh-hero__title {
  margin: 2px 0 8px;
}

.zh-hero__lead {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 17px;
}

/* 每一项按内容宽度排，放不下整项换行。 */
.zh-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 32px;
  margin: 18px 0 0;
}

.zh-facts div {
  min-width: 0;
  max-width: 100%;
}

.zh-facts dt {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.zh-facts__link {
  white-space: nowrap;
}

.zh-facts dd {
  margin: 2px 0 0;
  color: var(--hg-ink);
  font-size: 15px;
  line-height: 1.5;
}

.zh-quest {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.zh-quest__art {
  flex: none;
}

/* 简洁模式收起插画（01 第 4 节），委托照样留着。 */
.hg-shell.is-plain .zh-quest__art {
  display: none;
}

/* 配色同关卡里的任务卡（Mission）：浅强调色底、同色描边。 */
.zh-quest__card {
  flex: 1 1 auto;
  min-width: 0;
  padding: 14px 18px 16px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-card);
  background: var(--hg-accent-soft);
}

.zh-quest__eyebrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.zh-quest__done {
  padding: 0 8px;
  border: var(--hg-border-width) solid var(--hg-accent);
  border-radius: var(--hg-radius-pill);
  font-family: var(--hg-font-body);
  letter-spacing: 0;
}

.zh-quest__line {
  margin: 4px 0 8px;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  font-weight: 700;
  line-height: 1.5;
}

.zh-quest__boss {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.55;
}

/* 手机：区域信息一项一行、名字在左，首屏留给主线委托；小核小一号，委托卡片宽一些。 */
@media (max-width: 767px) {
  .zh-facts {
    flex-direction: column;
    gap: 6px;
  }

  .zh-facts div {
    display: flex;
    gap: 12px;
  }

  .zh-facts dt {
    flex: none;
    width: 5em;
    padding-top: 2px;
  }

  .zh-facts dd {
    margin: 0;
  }

  .zh-quest__art :deep(svg) {
    width: 56px;
    height: 56px;
  }
}

@media (min-width: 900px) {
  .zh-hero {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 420px);
    align-items: center;
    padding: 28px 32px;
  }

  .zh-quest {
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .zh-quest__card {
    align-self: stretch;
  }
}

/* ---------- 进度和「继续」 ---------- */

.zh-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
  padding: 16px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.zh-progress__stats {
  flex: 1 1 220px;
  min-width: 0;
  max-width: 360px;
}

.zh-progress__bar {
  display: block;
  height: 6px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-border);
  overflow: hidden;
}

.zh-progress__bar span {
  display: block;
  height: 100%;
  background: var(--hg-accent);
  transition: width var(--motion-base) var(--motion-ease-out);
}

.zh-progress__nums {
  margin: 6px 0 0;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.zh-progress__line {
  flex: 1 1 260px;
  min-height: 1.65em;
  margin: 0;
}

/* 存档读出来之前不知道该说哪句，先占住位置，免得先说错再改口（同世界地图的欢迎区）。 */
.zh-progress.is-loading .zh-progress__line {
  visibility: hidden;
}

.zh-progress__hint {
  flex: 1 1 100%;
  margin: 0;
  padding-top: 12px;
  border-top: var(--hg-border-width) solid var(--hg-border);
  color: var(--hg-ink-2);
  font-size: 14px;
}

/* ---------- 选路线（铸造城、试炼场） ---------- */

.zh-route__intro {
  max-width: 44em;
  margin: 0 0 14px;
  color: var(--hg-ink-2);
}

.zh-route__pick {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.zh-route__opt {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--motion-ease-out),
    background-color var(--motion-fast) var(--motion-ease-out);
}

.zh-route__opt:hover {
  border-color: var(--hg-accent);
}

.zh-route__opt:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.zh-route__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
}

.zh-route__name {
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
}

.zh-route__picked {
  display: none;
  align-items: center;
  gap: 4px;
  color: var(--hg-accent-ink);
  font-size: 13px;
  font-weight: 700;
}

.zh-route__picked svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.zh-route__text {
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.55;
}

/*
 * 选中的那条路线：强调色描边 + 浅强调色底 + 「已选」和对勾（不只靠颜色）。按 <html data-hg-route> 判断，
 * 没有属性时（服务端渲染、存档里没选过）默认 HIP，和 PrefSwitch 同一个写法。
 */
.zh-route__opt[data-route='hip'],
html[data-hg-route='triton'] .zh-route__opt[data-route='triton'] {
  border-color: var(--hg-accent);
  background: var(--zh-soft);
  box-shadow: inset 0 0 0 1px var(--hg-accent);
}

html[data-hg-route='triton'] .zh-route__opt[data-route='hip'] {
  border-color: var(--hg-border-strong);
  background: var(--hg-surface);
  box-shadow: none;
}

.zh-route__opt[data-route='hip'] .zh-route__picked,
html[data-hg-route='triton'] .zh-route__opt[data-route='triton'] .zh-route__picked {
  display: inline-flex;
}

html[data-hg-route='triton'] .zh-route__opt[data-route='hip'] .zh-route__picked {
  display: none;
}

.zh-route__sub {
  margin: 24px 0 10px;
  font-size: 18px;
}

/* 「两条路线怎么分」：选中路线的那一列铺浅强调色，表头写「已选」。 */
.zh-split {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: collapse;
  font-size: 14px;
  line-height: 1.55;
}

.zh-split th,
.zh-split td {
  padding: 9px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.zh-split thead th {
  background: var(--hg-surface-2);
  white-space: nowrap;
}

.zh-split tbody th {
  min-width: 7em;
  background: var(--hg-surface);
  font-weight: 600;
}

.zh-split td {
  background: var(--hg-surface);
  color: var(--hg-ink-2);
}

.zh-split .is-hip,
html[data-hg-route='triton'] .zh-split .is-triton {
  background: var(--zh-soft);
}

.zh-split td.is-hip,
html[data-hg-route='triton'] .zh-split td.is-triton {
  color: var(--hg-ink);
}

html[data-hg-route='triton'] .zh-split td.is-hip {
  background: var(--hg-surface);
  color: var(--hg-ink-2);
}

html[data-hg-route='triton'] .zh-split thead .is-hip {
  background: var(--hg-surface-2);
}

/* 「2-12」这样的编号不从中间断开，只在顿号处换行。 */
.zh-split__code {
  white-space: nowrap;
}

.zh-split__picked {
  display: none;
  margin-left: 8px;
  color: var(--hg-accent-ink);
  font-size: 12px;
}

.zh-split thead .is-hip .zh-split__picked,
html[data-hg-route='triton'] .zh-split thead .is-triton .zh-split__picked {
  display: inline;
}

html[data-hg-route='triton'] .zh-split thead .is-hip .zh-split__picked {
  display: none;
}

/* 手机上四列放不下：每一关排成一张小卡，格子前面写简短的列名；全部共用那一行不列空的两格。 */
@media (max-width: 767px) {
  .zh-split,
  .zh-split tbody,
  .zh-split tr,
  .zh-split th,
  .zh-split td {
    display: block;
  }

  .zh-split thead {
    display: none;
  }

  .zh-split tr {
    margin: 0 0 10px;
    padding: 10px 14px;
    border: var(--hg-border-width) solid var(--hg-border);
    border-radius: var(--hg-radius-control);
    background: var(--hg-surface);
  }

  .zh-split tbody th,
  .zh-split td {
    min-width: 0;
    padding: 3px 0;
    border: 0;
    background: none;
  }

  .zh-split td.is-empty {
    display: none;
  }

  .zh-split td::before {
    content: attr(data-label);
    margin-right: 8px;
    color: var(--hg-ink-3);
    font-family: var(--hg-font-mono);
    font-size: 11px;
  }

  .zh-split td.is-hip,
  html[data-hg-route='triton'] .zh-split td.is-triton {
    margin: 2px -8px;
    padding: 3px 8px;
    border-radius: var(--hg-radius-tag);
    background: var(--zh-soft);
  }

  html[data-hg-route='triton'] .zh-split td.is-hip {
    margin: 0;
    padding: 3px 0;
    background: none;
  }
}

/* ---------- 关卡列表：按 arc 分组，一关一行 ---------- */

.zh-arc + .zh-arc {
  margin-top: 22px;
}

.zh-arc__title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
  font-size: 18px;
}

.zh-arc__letter {
  display: grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-tag);
  background: var(--zh-soft);
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.zh-arc__list {
  margin: 0;
  padding: 0;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  list-style: none;
  overflow: hidden;
}

/* 一关：点 | 名称、学完能回答、推荐等级和时长 | 状态和星。整行可点，链接只包住名称（读屏念出来的是关卡名）。 */
.zh-stage {
  --dot: 40px;
  position: relative;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  gap: 6px 14px;
  margin: 0;
  padding: 14px 16px;
  border-top: var(--hg-border-width) solid var(--hg-border);
  transition: background-color var(--motion-fast) var(--motion-ease-out);
}

.zh-stage:first-child {
  border-top: 0;
}

.zh-stage.is-boss {
  --dot: 46px;
}

.zh-stage:has(.zh-stage__link:hover) {
  background: var(--hg-surface-2);
}

.zh-stage__dot {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--dot);
  height: var(--dot);
  margin-inline: auto;
  border: 1.5px solid var(--hg-ink-3);
  border-radius: 50%;
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.is-doing .zh-stage__dot {
  border-color: var(--hg-accent);
  color: var(--hg-accent-ink);
}

/* 完成：强调色铺底 + 对勾角标（01 第 7 节：完成 = 青 + 对勾，不只靠颜色）。 */
.is-done .zh-stage__dot {
  border-color: var(--hg-accent-ink);
  background: color-mix(in srgb, var(--hg-accent) 24%, var(--hg-surface));
  color: var(--hg-accent-ink);
}

.is-exempt .zh-stage__dot {
  border-color: var(--hg-accent);
  background: var(--hg-surface-2);
  color: var(--hg-accent-ink);
}

/* 建设中：虚线、暗一档，不是链接（同世界地图）。 */
.is-soon .zh-stage__dot {
  border-style: dashed;
  border-color: var(--hg-idle);
  background: var(--hg-surface-2);
  color: var(--hg-ink-3);
}

/* Boss：更大，外面再套一圈区域色（试炼场是紫），点里写 BOSS。 */
.is-boss .zh-stage__dot {
  box-shadow: 0 0 0 3px var(--hg-surface), 0 0 0 4.5px var(--hg-accent-2);
  letter-spacing: 0.02em;
}

/* 区域里的「从这里继续」：点外一圈强调色光晕。 */
.is-here .zh-stage__dot {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--hg-accent) 30%, transparent);
}

.is-boss.is-here .zh-stage__dot {
  box-shadow:
    0 0 0 3px var(--hg-surface),
    0 0 0 4.5px var(--hg-accent-2),
    0 0 0 9px color-mix(in srgb, var(--hg-accent) 30%, transparent);
}

.zh-stage__badge {
  position: absolute;
  top: -5px;
  right: -7px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: var(--hg-border-width) solid currentColor;
  border-radius: 50%;
  background: var(--hg-surface);
  color: var(--hg-accent-ink);
}

.zh-stage__badge svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.zh-stage__badge svg .is-fill {
  fill: currentColor;
  stroke: none;
}

.zh-stage__body {
  min-width: 0;
}

.zh-stage__name {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 10px;
  margin: 0 0 4px;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  line-height: 1.35;
}

.zh-stage__link {
  color: var(--hg-ink);
  text-decoration: none;
}

/* 整行都能点：链接的伪元素铺满这一行。 */
.zh-stage__link::after {
  content: '';
  position: absolute;
  inset: 0;
}

.zh-stage__link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.zh-stage__link:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.is-soon .zh-stage__name {
  color: var(--hg-ink-2);
}

.zh-stage__sub {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-body);
  font-size: 14px;
  font-weight: 500;
}

.zh-stage__line {
  margin: 0 0 4px;
  color: var(--hg-ink-2);
  font-size: 15px;
  line-height: 1.55;
}

.zh-stage__key {
  margin-right: 8px;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.zh-stage__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.zh-tag {
  padding: 0 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-ink-2);
  font-size: 12px;
  line-height: 20px;
}

.zh-stage__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  grid-column: 2;
  margin: 2px 0 0;
  font-size: 13px;
}

.zh-stage__status {
  color: var(--hg-ink-3);
  font-weight: 600;
}

.is-done .zh-stage__status,
.is-doing .zh-stage__status,
.is-exempt .zh-stage__status {
  color: var(--hg-accent-ink);
}

.zh-stage__here {
  padding: 0 8px;
  border: var(--hg-border-width) solid var(--hg-accent);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-accent-ink);
  font-size: 12px;
  font-weight: 700;
  line-height: 20px;
}

.zh-stage__stars {
  color: var(--hg-idle);
  letter-spacing: 1px;
}

.zh-stage__stars .is-on {
  color: var(--hg-amber);
}

/* 宽屏：状态和星放到最右边一列。 */
@media (min-width: 768px) {
  .zh-stage {
    grid-template-columns: 46px minmax(0, 1fr) auto;
    padding: 16px 20px;
  }

  .zh-stage__state {
    grid-column: 3;
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: flex-end;
    margin: 0;
    text-align: right;
  }
}

/* ---------- 副本入口 ---------- */

.zh-dungeon {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px 28px;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.zh-dungeon__text {
  flex: 1 1 320px;
  min-width: 0;
}

.zh-dungeon h2 {
  margin-bottom: 6px;
  font-size: 20px;
}

.zh-dungeon p {
  margin: 0 0 4px;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.zh-dungeon p:last-child {
  margin-bottom: 0;
}

/* ---------- 相邻区域 ---------- */

.zh-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 24px;
  padding-top: 16px;
  border-top: var(--hg-border-width) solid var(--hg-border);
  font-size: 14px;
}

.zh-foot__note {
  margin: 0;
  color: var(--hg-ink-3);
}

.zh-foot__links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.zh-foot__links li {
  margin: 0;
}

.zh-foot__links a {
  font-weight: 600;
}
</style>
