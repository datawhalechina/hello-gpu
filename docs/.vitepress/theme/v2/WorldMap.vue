<script setup lang="ts">
/**
 * 世界地图（P-01；设计稿 Map、Zones 画板；01 第 4–5 节，02 第 3 节「当前位置」，04 第 1 节）。
 *
 * 三个区域、大纲里的全部关卡（包括还没上线的），编号、名称、推荐等级、星级和状态都从
 * outline.json 和进度存档算出来（规则在 docs/course/journey.ts），这里不手写任何关卡信息。
 *
 * 排法：桌面（≥ 960px）是深色地图面板，三个区域从左到右，每个区域三列、按大纲顺序走「之」字：
 *   新手村往上爬、铸造城往下走、试炼场再往上，整条路线一笔连下来（02 第 3 节：时间从左到右）。
 *   横向位置按面板宽度的百分比、纵向按像素，节点和路线都是 HTML，宽度变了照样对得齐。
 *   窄屏和手机是纵向路线。两种排法是同一份 DOM、只换 CSS，键盘和读屏的顺序都是大纲顺序。
 * 「你在这」：已上线、没完成的关卡里最近打开的那一关，没有就是下一个推荐关卡；呼吸光圈
 *   （02 第 3 节），减弱动效下改成静态描边。存档读出来之前不画，免得先标在 1-1 再跳走。
 * 链接点名的关卡（Q-02）：地址带 ?stage=关卡 id（mapHref）时，这一关套一圈琥珀色的环、写「定级推荐」，
 *   欢迎区改说「定级推荐从这一关开始」，页面滚到它、Tab 进地图先落在它上面。水合以后才读地址，首屏和服务端一致。
 * 豁免的关卡（定级测试）写「已豁免」、不画星（showsStars），桌面上也写出来。
 * 键盘：整张地图一个 Tab 停靠点（roving tabindex，同 RobotGrid），方向键沿路线前后移动，
 *   Home / End 到起点 / 终点，Enter 进入关卡；还在建设中的关卡也能停上去，读屏念出「建设中」。
 * 建设中的关卡（M-01）：有旧版对应章节的链接过去，写「先看旧版」；世界地图页把 docs/course/v1.ts 的 LEGACY_BY_STAGE 传给 legacy。
 * 副本入口（X-01）：有副本的区域，区域标签旁的「副本」链到副本大厅里这个区域的那一组（dungeonHref）。
 */
import { computed, onMounted, ref, useId, watch } from 'vue'
import { useRoute, withBase } from 'vitepress'
import Mascot from '@kit/Mascot.vue'
import {
  dungeonHref, exercisesOf, isPublished, MAP_STAGE_PARAM, stageById, stageHref, STAGES, ZONES, type StageMeta,
} from '@course/outline.ts'
import { MAX_STARS } from '@course/progress.ts'
import {
  isNewcomer, showsStars, stageStatus, STATUS_ICONS, STATUS_TEXT, whereAmI, zoneProgress, type StageStatus,
} from '@course/journey.ts'
import { useProgress } from '@course/useProgress.ts'

const props = withDefaults(defineProps<{
  /** M-01：关卡 id → 旧版对应章节的路径（不带站点 base）。建设中的关卡有映射时链接过去，写「先看旧版」。 */
  legacy?: Record<string, string>
}>(), { legacy: () => ({}) })

const { state, loaded } = useProgress()
const uid = useId()

// ── 桌面版面：只由大纲决定，和读者的进度无关，不用响应式 ──────────────────────

const COLS = 3
/** 面板左右留白、区域之间的空隙，占面板宽度的百分比。 */
const PAD_X = 1.5
const GAP_X = 1.5
/**
 * 区域标签那一条的高度、一行关卡的高度、行顶到点的圆心，单位 px。一行最高的是「你在这」那一站：
 * 点 46 + 两行名字 + 「你在这 Lv.N」和星换成两行，约 95px 在圆心下面，120 的行高还留几像素空。
 */
const TOP = 60
const ROW_H = 120
const DOT_Y = 25

const ZONE_W = (100 - 2 * PAD_X - (ZONES.length - 1) * GAP_X) / ZONES.length
const zoneLeft = (k: number) => PAD_X + k * (ZONE_W + GAP_X)
const zoneStages = ZONES.map((zone) => STAGES.filter((s) => s.zone === zone.id))
const ROWS = Math.max(1, ...zoneStages.map((list) => Math.ceil(list.length / COLS)))
const CANVAS_H = TOP + ROWS * ROW_H + 20
const round = (n: number) => Math.round(n * 1000) / 1000

interface Spot {
  stage: StageMeta
  /** 整条路线上的序号（大纲顺序），键盘和「走过的路」都按它。 */
  index: number
  zone: number
  /** 点的圆心：x 是面板宽度的百分比，y 是像素。 */
  x: number
  y: number
}

const spots: Spot[] = []
zoneStages.forEach((list, k) => {
  // 偶数号区域从下往上爬，奇数号从上往下走，区域之间的路就都很短。
  const climbing = k % 2 === 0
  list.forEach((stage, i) => {
    const row = Math.floor(i / COLS)
    const col = row % 2 === 0 ? i % COLS : COLS - 1 - (i % COLS)
    const line = climbing ? ROWS - 1 - row : row
    spots.push({
      stage,
      index: spots.length,
      zone: k,
      x: round(zoneLeft(k) + (ZONE_W * (col + 0.5)) / COLS),
      y: TOP + line * ROW_H + DOT_Y,
    })
  })
})

interface Segment {
  /** 这段路通向哪一站（Spot.index）。 */
  to: number
  dir: 'h' | 'v'
  style: Record<string, string>
}

const across = (x1: number, x2: number, y: number, to: number): Segment =>
  ({ to, dir: 'h', style: { left: `${round(Math.min(x1, x2))}%`, width: `${round(Math.abs(x2 - x1))}%`, top: `${y}px` } })
const down = (x: number, y1: number, y2: number, to: number): Segment =>
  ({ to, dir: 'v', style: { left: `${round(x)}%`, top: `${Math.min(y1, y2)}px`, height: `${Math.abs(y2 - y1)}px` } })

/** 相邻两站之间的路：同一行横着走，换行竖着走（「之」字的拐角在同一列）；跨区域时在两个区域的空隙里拐弯。 */
function route(a: Spot, b: Spot): Segment[] {
  if (a.y === b.y) return [across(a.x, b.x, a.y, b.index)]
  if (a.zone === b.zone) return [down(a.x, a.y, b.y, b.index)]
  const mid = round(zoneLeft(b.zone) - GAP_X / 2)
  return [across(a.x, mid, a.y, b.index), down(mid, a.y, b.y, b.index), across(mid, b.x, b.y, b.index)]
}

const layout = ZONES.map((zone, k) => {
  const own = spots.filter((s) => s.zone === k)
  return {
    zone,
    left: round(zoneLeft(k)),
    spots: own,
    // 进入这个区域的路（包括从上一个区域的 Boss 过来的那段）画在这个区域里，颜色跟这个区域。
    segments: own.filter((s) => s.index > 0).flatMap((s) => route(spots[s.index - 1], s)),
  }
})

const canvasStyle = { '--canvas-h': `${CANVAS_H}px`, '--colw': round(ZONE_W / COLS) }

// ── 读者的进度 ────────────────────────────────────────────────────────

const where = computed(() => (loaded.value ? whereAmI(state) : null))
const hereIndex = computed(() => {
  const id = where.value?.stage.id
  return id ? spots.findIndex((s) => s.stage.id === id) : -1
})
/** 走过的路画到「你在这」为止；全部走完就整条画上；存档读出来之前一段都不画。 */
const trailUntil = computed(() => {
  if (!loaded.value) return -1
  return where.value ? hereIndex.value : spots.length - 1
})

/**
 * 链接点名的关卡：/world/?stage=关卡 id（定级结果页的「在地图上看」）。服务端渲染读不到地址，
 * 所以挂载以后才读，首屏和水合一致；站内只换了查询参数时 pageRoute.query 跟着变。不认识的 id 不理。
 */
const pageRoute = useRoute()
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const picked = computed<StageMeta | null>(() => {
  if (!mounted.value) return null
  const id = new URLSearchParams(pageRoute.query).get(MAP_STAGE_PARAM)
  return (id && stageById(id)) || null
})
const pickedIndex = computed(() => (picked.value ? spots.findIndex((s) => s.stage.id === picked.value?.id) : -1))

function linkOf(path: string): string {
  return path.startsWith('/') ? withBase(path) : path
}

interface MapNode {
  spot: Spot
  status: StageStatus
  boss: boolean
  here: boolean
  /** 链接点名的那一关（定级推荐）。 */
  picked: boolean
  /** 进不去的关卡是空串。 */
  href: string
  /** 建设中，链接的是旧版对应章节。 */
  legacy: boolean
  stars: number
  showStars: boolean
  label: string
}

const nodes = computed<MapNode[]>(() => spots.map((spot) => {
  const { stage } = spot
  const status = stageStatus(stage, state)
  const published = isPublished(stage)
  const legacyPath = published ? '' : props.legacy[stage.id] ?? ''
  const here = spot.index === hereIndex.value
  const picked = spot.index === pickedIndex.value
  const stars = state.stages[stage.id]?.stars.length ?? 0
  const bits = [`${stage.code} ${stage.title}：${stage.subtitle}`, `推荐 Lv.${stage.lv}`, STATUS_TEXT[status]]
  if (stars) bits.push(`${stars} 颗星`)
  if (legacyPath) bits.push('先看旧版对应章节')
  if (picked) bits.push('定级推荐')
  if (here) bits.push('你在这')
  return {
    spot,
    status,
    boss: stage.kind === 'boss',
    here,
    picked,
    href: published ? withBase(stageHref(stage)) : legacyPath ? linkOf(legacyPath) : '',
    legacy: Boolean(legacyPath),
    stars,
    showStars: showsStars(stage, state),
    label: bits.join('，'),
  }
}))

const zones = computed(() => layout.map((z) => ({
  ...z,
  nodes: z.spots.map((s) => nodes.value[s.index]),
  dungeon: exercisesOf(z.zone.id).length ? withBase(dungeonHref(z.zone.id)) : '',
})))

const STAR_SLOTS = Array.from({ length: MAX_STARS }, (_, i) => i)

type LegendItem = { key: string; cls: string; text: string; icon?: StageStatus }

const LEGEND: LegendItem[] = [
  { key: 'done', cls: 'is-done', text: STATUS_TEXT.done, icon: 'done' },
  { key: 'doing', cls: 'is-doing', text: STATUS_TEXT.doing, icon: 'doing' },
  { key: 'todo', cls: 'is-todo', text: STATUS_TEXT.todo },
  { key: 'exempt', cls: 'is-exempt', text: STATUS_TEXT.exempt, icon: 'exempt' },
  { key: 'soon', cls: 'is-soon', text: STATUS_TEXT.soon },
  { key: 'boss', cls: 'is-todo is-boss', text: 'Boss' },
  { key: 'here', cls: 'is-todo is-here', text: '你在这' },
]
/** 链接点名了一关时，图例多一项「定级推荐」。 */
const legend = computed<LegendItem[]>(() => (picked.value ? [...LEGEND, { key: 'picked', cls: 'is-todo is-picked', text: '定级推荐' }] : LEGEND))

// ── 键盘：一个 Tab 停靠点，方向键沿路线走 ─────────────────────────────────

const nodeEls: (HTMLElement | null)[] = []
function setNodeEl(el: unknown, index: number) {
  nodeEls[index] = el instanceof HTMLElement ? el : null
}

/** 读者自己停过的那一站；没停过时 Tab 进来落在链接点名的那一关，再是「你在这」，再没有就是起点。 */
const focused = ref<number | null>(null)
const tabStop = computed(() => focused.value ?? (pickedIndex.value >= 0 ? pickedIndex.value : Math.max(0, hereIndex.value)))

/**
 * 链接点名了一关：页面从顶上开始，滚到刚好看得见它（瞬间滚动，没有动画）。放到下一个任务里滚：
 * 站内跳转时 VitePress 在新页面挂载以后才把页面滚回顶部，而且是平滑滚动；这里先瞬间回到顶部、
 * 打断它，再滚到这一关，免得两段滚动互相抢。
 */
watch(pickedIndex, (index) => {
  if (index < 0) return
  setTimeout(() => {
    const el = nodeEls[index]
    if (!el) return
    window.scrollTo({ top: 0, behavior: 'instant' })
    el.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }, 0)
})

const KEY_STEP: Record<string, (i: number, last: number) => number> = {
  ArrowRight: (i) => i + 1,
  ArrowDown: (i) => i + 1,
  ArrowLeft: (i) => i - 1,
  ArrowUp: (i) => i - 1,
  Home: () => 0,
  End: (_, last) => last,
}

function onKeydown(event: KeyboardEvent, index: number) {
  const step = KEY_STEP[event.key]
  if (!step || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  event.preventDefault()
  const last = spots.length - 1
  nodeEls[Math.min(last, Math.max(0, step(index, last)))]?.focus()
}

// ── 欢迎区与区域卡片 ─────────────────────────────────────────────────────

interface Welcome {
  eyebrow: string
  before: string
  name: string
  after: string
  cta: { text: string; href: string } | null
  placement: boolean
}

/** 进入一关的按钮：上线了的进关卡；建设中、有旧版映射的先看旧版；都没有就不给按钮。 */
function ctaOf(stage: StageMeta, verb: string): Welcome['cta'] {
  if (isPublished(stage)) return { text: `${verb}：${stage.code} ${stage.title}`, href: withBase(stageHref(stage)) }
  const legacyPath = props.legacy[stage.id] ?? ''
  return legacyPath ? { text: '先看旧版', href: linkOf(legacyPath) } : null
}

const welcome = computed<Welcome>(() => {
  const blank: Welcome = { eyebrow: 'WELCOME', before: '', name: '', after: '', cta: null, placement: false }
  if (!loaded.value) return blank
  // 从定级结果页过来（链接点名了一关）：说定级推荐的这一关。
  const p = picked.value
  if (p) {
    return {
      eyebrow: 'PLACEMENT',
      before: '定级推荐从 ',
      name: `${p.code} ${p.title}`,
      after: isPublished(p) ? ' 开始。' : ' 开始。这一关还在建设中。',
      cta: ctaOf(p, stageStatus(p, state) === 'doing' ? '继续' : '开始'),
      placement: false,
    }
  }
  const w = where.value
  if (!w) {
    return { ...blank, eyebrow: 'WELCOME BACK', before: '三个区域的关卡都走完了。', cta: { text: '看看我的成长', href: withBase('/me/') } }
  }
  const { stage } = w
  const fresh = isNewcomer(state)
  const placement = !state.placement
  let after = fresh ? ' 开始。' : '。'
  if (!isPublished(stage)) after += '这一关还在建设中。'
  if (fresh && placement) after += '学过一些 GPU 编程的话，可以先做定级测试，跳过已经会的关卡。'
  return {
    eyebrow: fresh ? 'WELCOME' : 'WELCOME BACK',
    before: fresh ? '第一次来？路线从 ' : w.reason === 'last' ? '你上次停在 ' : '下一关是 ',
    name: `${stage.code} ${stage.title}`,
    after,
    cta: ctaOf(stage, w.reason === 'last' ? '继续' : '开始'),
    placement,
  }
})

const cards = computed(() => zoneProgress(state).map((p) => {
  const total = p.stages.length
  const bosses = p.stages.filter((s) => s.kind === 'boss').length
  return {
    ...p,
    total,
    count: bosses ? `${total - bosses} 关 + Boss` : `${total} 关`,
    percent: loaded.value && total ? `${Math.round((p.done / total) * 100)}%` : '0%',
  }
}))
</script>

<template>
  <div class="hg-world">
    <section class="hg-welcome" :class="{ 'is-loading': !loaded }" aria-label="欢迎">
      <Mascot class="hg-welcome__mascot" size="sm" />
      <div class="hg-welcome__body" :aria-busy="!loaded">
        <p class="hg-welcome__eyebrow">{{ welcome.eyebrow }}</p>
        <p class="hg-welcome__line">
          {{ welcome.before }}<strong v-if="welcome.name">{{ welcome.name }}</strong>{{ welcome.name ? welcome.after : '' }}
        </p>
      </div>
      <div v-if="welcome.cta || welcome.placement" class="hg-welcome__actions">
        <a v-if="welcome.cta" class="hg-welcome__button is-primary" :href="welcome.cta.href">{{ welcome.cta.text }}</a>
        <a v-if="welcome.placement" class="hg-welcome__button" :href="withBase('/placement/')">定级测试</a>
      </div>
    </section>

    <section
      class="hg-wmap"
      data-hg-theme="dark"
      :aria-labelledby="`${uid}-map`"
      :aria-describedby="`${uid}-keys`"
    >
      <h2 :id="`${uid}-map`" class="hg-world__hidden">关卡路线</h2>

      <div class="hg-wmap__canvas" :style="canvasStyle">
        <section
          v-for="z in zones"
          :key="z.zone.id"
          class="hg-wmap__zone"
          :data-zone="z.zone.id"
          :style="{ '--zx': z.left, '--zw': round(ZONE_W) }"
          :aria-labelledby="`${uid}-${z.zone.id}`"
        >
          <span class="hg-wmap__area" aria-hidden="true" />
          <span
            v-for="(seg, i) in z.segments"
            :key="i"
            class="hg-wmap__seg"
            :class="[`is-${seg.dir}`, { 'is-trail': seg.to <= trailUntil }]"
            :style="seg.style"
            aria-hidden="true"
          />

          <div class="hg-wmap__zonehead">
            <h3 :id="`${uid}-${z.zone.id}`" class="hg-wmap__tag">
              <span class="hg-wmap__zcode">{{ z.zone.code }} · </span>{{ z.zone.name }} · Lv.{{ z.zone.lv[0] }}–{{ z.zone.lv[1] }}
            </h3>
            <a v-if="z.dungeon" class="hg-wmap__dungeon" :href="z.dungeon">副本</a>
            <span v-else class="hg-wmap__dungeon">副本 · 建设中</span>
          </div>

          <ol class="hg-wmap__stops">
            <li
              v-for="n in z.nodes"
              :key="n.spot.stage.id"
              class="hg-wmap__stop"
              :class="[`is-${n.status}`, {
                'is-boss': n.boss,
                'is-here': n.here,
                'is-picked': n.picked,
                'is-trail-in': n.spot.index <= trailUntil,
                'is-trail-out': n.spot.index + 1 <= trailUntil,
              }]"
              :style="{ '--x': n.spot.x, '--y': n.spot.y }"
              :data-stage="n.spot.stage.id"
            >
              <component
                :is="n.href ? 'a' : 'span'"
                :ref="(el: unknown) => setNodeEl(el, n.spot.index)"
                class="hg-wmap__node"
                :href="n.href || undefined"
                :role="n.href ? undefined : 'link'"
                :aria-disabled="n.href ? undefined : 'true'"
                :aria-label="n.label"
                :aria-current="n.here ? 'location' : undefined"
                :tabindex="n.spot.index === tabStop ? 0 : -1"
                @focus="focused = n.spot.index"
                @keydown="onKeydown($event, n.spot.index)"
              >
                <span class="hg-wmap__dot" aria-hidden="true">
                  {{ n.spot.stage.code }}
                  <span v-if="STATUS_ICONS[n.status]" class="hg-wmap__badge">
                    <svg viewBox="0 0 16 16"><path v-for="p in STATUS_ICONS[n.status]" :key="p.d" :d="p.d" :class="{ 'is-fill': p.fill }" /></svg>
                  </span>
                  <span v-if="n.here" class="hg-wmap__pulse" />
                </span>
                <span class="hg-wmap__text" aria-hidden="true">
                  <span class="hg-wmap__name">{{ n.spot.stage.title }}</span>
                  <span class="hg-wmap__meta">
                    <span v-if="n.here" class="hg-wmap__here">你在这</span>
                    <span v-if="n.picked" class="hg-wmap__pick">定级推荐</span>
                    <span><span class="hg-wmap__more">推荐 </span>Lv.{{ n.spot.stage.lv }}</span>
                    <span class="hg-wmap__more">约 {{ n.spot.stage.minutes }} 分钟</span>
                    <span class="hg-wmap__more" :class="{ 'is-kept': n.status === 'exempt' }">{{ STATUS_TEXT[n.status] }}</span>
                    <span v-if="n.legacy">先看旧版</span>
                    <span v-if="n.showStars" class="hg-wmap__stars">
                      <span v-for="i in STAR_SLOTS" :key="i" :class="{ 'is-on': i < n.stars }">{{ i < n.stars ? '★' : '☆' }}</span>
                    </span>
                  </span>
                </span>
              </component>
            </li>
          </ol>
        </section>
      </div>

      <div class="hg-wmap__foot">
        <ul class="hg-wmap__legend" aria-label="图例">
          <li v-for="item in legend" :key="item.key" class="hg-wmap__key" :class="item.cls">
            <span class="hg-wmap__dot" aria-hidden="true">
              <svg v-if="item.icon" viewBox="0 0 16 16"><path v-for="p in STATUS_ICONS[item.icon]" :key="p.d" :d="p.d" :class="{ 'is-fill': p.fill }" /></svg>
            </span>
            {{ item.text }}
          </li>
        </ul>
        <p :id="`${uid}-keys`" class="hg-wmap__keys">
          键盘：Tab 进入地图，方向键沿路线前后移动，Home / End 到起点 / 终点，Enter 进入关卡。
        </p>
      </div>
    </section>

    <section class="hg-zones" :aria-labelledby="`${uid}-zones`">
      <h2 :id="`${uid}-zones`" class="hg-world__hidden">各区域进度</h2>
      <ul class="hg-zones__list">
        <li v-for="c in cards" :key="c.zone.id" class="hg-zones__card" :data-zone="c.zone.id">
          <p class="hg-zones__code">{{ c.zone.code }}</p>
          <h3 class="hg-zones__name"><a :href="withBase(`/${c.zone.id}/`)">{{ c.zone.name }}</a></h3>
          <p class="hg-zones__meta">
            <span>{{ c.zone.env }}</span> · <span>{{ c.count }}</span> · <span>推荐 Lv.{{ c.zone.lv[0] }}–{{ c.zone.lv[1] }}</span>
          </p>
          <span class="hg-zones__bar" aria-hidden="true"><span :style="{ width: c.percent }" /></span>
          <p class="hg-zones__progress">
            已通关 {{ loaded ? c.done : '—' }} / {{ c.total }}<template v-if="loaded && c.exempt"> · 已豁免 {{ c.exempt }}</template>
            · ★ {{ loaded ? c.stars : '—' }} / {{ c.total * MAX_STARS }}
          </p>
        </li>
      </ul>
    </section>

    <p class="hg-world__note">区域从不上锁：推荐等级只是建议。</p>
  </div>
</template>

<style scoped>
.hg-world {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 8px;
  font-size: 15px;
  line-height: 1.6;
}

.hg-world__hidden {
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

/* ---------- 欢迎区（设计稿 Map 顶部；01 第 5 节：小核可以出现在地图欢迎区） ---------- */

.hg-welcome {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px 20px;
  padding: 18px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
}

.hg-welcome__mascot {
  flex: none;
}

/* 简洁模式收起插画（01 第 4 节）。 */
.hg-shell.is-plain .hg-welcome__mascot {
  display: none;
}

.hg-welcome__body {
  flex: 1 1 360px;
  min-width: 0;
}

/* 存档读出来之前不知道该说哪句，先占住位置，免得先说错再改口。 */
.hg-welcome.is-loading .hg-welcome__body {
  visibility: hidden;
}

.hg-welcome__eyebrow {
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-welcome__line {
  min-height: 1.6em;
  margin: 2px 0 0;
  color: var(--hg-ink);
  font-size: 17px;
}

.hg-welcome__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hg-welcome__button {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-weight: 600;
  text-decoration: none;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节）。 */
.hg-welcome__button.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-welcome__button:hover {
  border-color: var(--hg-accent);
}

.hg-welcome__button:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

@media (max-width: 767px) {
  .hg-welcome {
    padding: 16px;
  }

  .hg-welcome__body {
    flex-basis: 180px;
  }

  .hg-welcome__line {
    font-size: 16px;
  }
}

/*
 * ---------- 地图面板 ----------
 * 面板永远是深色（data-hg-theme="dark"，设计稿 Map），每个区域写 data-zone，强调色跟着区域换（01 第 4 节）。
 * 先写窄屏的纵向路线，≥ 960px 再换成三个区域并排的地图。
 */

/* --hg-wmap-bg 在面板上取值，区域里面（试炼场会改 --hg-bg）也拿得到面板本身的底色。 */
.hg-wmap {
  --hg-wmap-bg: var(--hg-bg);
  display: flex;
  flex-direction: column;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background-color: var(--hg-wmap-bg);
  background-image: var(--hg-dot-pattern);
  background-size: 18px 18px;
  box-shadow: var(--hg-shadow-hero);
  color: var(--hg-ink);
  overflow: hidden;
}

.hg-shell.is-plain .hg-wmap {
  background-image: none;
}

.hg-wmap__canvas {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
}

/* --hg-wmap-plate：区域底色（面板底色上叠 7% 的区域色），文字的衬底、Boss 双圈的间隙都用它，看上去是挖空的。 */
.hg-wmap__zone {
  --hg-wmap-plate: color-mix(in srgb, var(--hg-accent-2) 7%, var(--hg-wmap-bg));
  padding: 12px 8px 8px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent-2) 65%, transparent);
  border-radius: var(--hg-radius-card);
  background: color-mix(in srgb, var(--hg-accent-2) 7%, transparent);
}

.hg-wmap__area,
.hg-wmap__seg {
  display: none;
}

.hg-wmap__zonehead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 10px;
  margin: 0 0 6px;
  padding: 0 4px;
}

.hg-wmap__tag {
  margin: 0;
  padding: 2px 10px;
  border: var(--hg-border-width) solid var(--hg-accent);
  border-radius: var(--hg-radius-tag);
  background: color-mix(in srgb, var(--hg-bg) 85%, transparent);
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.hg-wmap__dungeon {
  padding: 1px 10px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-3);
  font-size: 12px;
  white-space: nowrap;
}

a.hg-wmap__dungeon {
  border-style: solid;
  border-color: var(--hg-accent);
  color: var(--hg-accent-ink);
  font-weight: 600;
  text-decoration: none;
}

a.hg-wmap__dungeon:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-wmap__stops {
  position: relative;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 一站：--dot 是点的直径；窄屏的点放在固定宽度（--slot）的一列里，路线才是一条直线。 */
.hg-wmap__stop {
  --dot: 40px;
  --slot: 46px;
  position: relative;
  margin: 0;
}

.hg-wmap__stop.is-here {
  --dot: 44px;
}

.hg-wmap__stop.is-boss {
  --dot: 46px;
}

/* 纵向路线：每一站上半截画进来的路，下半截画出去的路；走过的是实线，没走过的是虚线。 */
.hg-wmap__stop::before,
.hg-wmap__stop::after {
  content: '';
  position: absolute;
  left: calc(6px + var(--slot) / 2 - 1px);
  border-left: 2px dashed var(--hg-idle);
}

.hg-wmap__stop::before {
  top: 0;
  height: calc(6px + var(--dot) / 2);
}

.hg-wmap__stop::after {
  top: calc(6px + var(--dot) / 2);
  bottom: 0;
}

.hg-wmap__stop:first-child::before,
.hg-wmap__stop:last-child::after {
  display: none;
}

.hg-wmap__stop.is-trail-in::before,
.hg-wmap__stop.is-trail-out::after {
  left: calc(6px + var(--slot) / 2 - 1.5px);
  border-left: 3px solid var(--hg-accent);
}

.hg-wmap__node {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px;
  border-radius: var(--hg-radius-control);
  color: var(--hg-ink);
  text-decoration: none;
  outline: none;
  /* 链接点名了这一关时滚到它：上面让出吸顶顶栏，下面留一点空。 */
  scroll-margin: 96px 0 24px;
}

.hg-wmap__node:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

a.hg-wmap__node:hover .hg-wmap__dot {
  border-color: var(--hg-ink);
}

a.hg-wmap__node:hover .hg-wmap__name {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ---------- 点：编号在点里，状态靠底色、描边、角标三样一起表达（01 第 7 节） ---------- */

.hg-wmap__dot {
  position: relative;
  display: grid;
  flex: none;
  place-items: center;
  width: var(--dot);
  height: var(--dot);
  margin-inline: calc((var(--slot, var(--dot)) - var(--dot)) / 2);
  border: 1.5px solid var(--hg-ink-3);
  border-radius: 50%;
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  transition:
    background-color var(--motion-base) var(--motion-ease-out),
    border-color var(--motion-base) var(--motion-ease-out),
    color var(--motion-base) var(--motion-ease-out);
}

.is-done .hg-wmap__dot {
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent);
  color: var(--hg-bg);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--hg-accent) 18%, transparent);
}

.is-doing .hg-wmap__dot {
  border-color: var(--hg-accent);
  color: var(--hg-accent-ink);
}

.is-exempt .hg-wmap__dot {
  border-color: var(--hg-accent);
  /* --hg-accent-soft 在暗色下是半透明的，路线会从点里透出来，所以混进不透明的卡片底色。 */
  background: color-mix(in srgb, var(--hg-accent) 14%, var(--hg-surface));
  color: var(--hg-accent-ink);
}

/* 建设中：虚线、暗一档，不是链接。 */
.is-soon .hg-wmap__dot {
  border-style: dashed;
  border-color: var(--hg-idle);
  background: var(--hg-surface-2);
  color: var(--hg-ink-3);
}

/* 你在这（设计稿 Map：琥珀色，比别的点大一圈）。 */
.is-here .hg-wmap__dot {
  border-color: var(--hg-amber-ink);
  background: var(--hg-amber);
  color: var(--hg-bg);
  box-shadow: 0 0 20px color-mix(in srgb, var(--hg-amber) 50%, transparent);
}

/* 链接点名的一关（定级推荐）：点外面再套一圈琥珀色的环；旁边写「定级推荐」，不只靠颜色。Boss 的粉圈外面再套。 */
.is-picked .hg-wmap__dot {
  outline: 2px solid var(--hg-amber);
  outline-offset: 4px;
}

.is-boss.is-picked .hg-wmap__dot {
  outline-offset: 7px;
}

/* Boss：更大，外面再套一圈粉色描边，点里写 BOSS（设计稿 Map）。 */
.is-boss .hg-wmap__dot {
  box-shadow: 0 0 0 3px var(--hg-wmap-plate), 0 0 0 4.5px var(--hg-map-boss);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.is-boss.is-todo .hg-wmap__dot,
.is-boss.is-soon .hg-wmap__dot {
  color: var(--hg-map-boss-ink);
}

.hg-wmap__badge {
  position: absolute;
  top: -5px;
  right: -7px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: var(--hg-border-width) solid currentColor;
  border-radius: 50%;
  background: var(--hg-wmap-plate);
  color: var(--hg-accent-ink);
}

.hg-wmap__dot svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hg-wmap__dot svg .is-fill {
  fill: currentColor;
  stroke: none;
}

/* 呼吸光圈（02 第 3 节：缩放 0.8 → 1.8、透明度 0.7 → 0，1.8 s 一圈）。 */
.hg-wmap__pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(var(--dot) + 18px);
  height: calc(var(--dot) + 18px);
  border: 2px solid var(--hg-amber);
  border-radius: 50%;
  pointer-events: none;
  transform: translate(-50%, -50%);
  animation: hg-wmap-pulse 1.8s var(--motion-ease-out) infinite;
}

@keyframes hg-wmap-pulse {
  from {
    opacity: 0.7;
    transform: translate(-50%, -50%) scale(0.8);
  }

  to {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.8);
  }
}

/* 减弱动效（02 第 4 节）：系统设置和站点设置都停掉光圈，改成一圈静态描边。 */
@media (prefers-reduced-motion: reduce) {
  .hg-wmap__pulse {
    animation: none;
  }
}

[data-hg-motion='reduce'] .hg-wmap__pulse {
  animation: none;
}

/* ---------- 名字和一行小字 ---------- */

.hg-wmap__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-top: 2px;
}

.hg-wmap__name {
  color: var(--hg-ink);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.is-soon .hg-wmap__name {
  color: var(--hg-ink-2);
  font-weight: 500;
}

.hg-wmap__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 8px;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  line-height: 18px;
}

.hg-wmap__more {
  font-family: var(--hg-font-body);
}

.hg-wmap__here {
  padding: 0 6px;
  border-radius: var(--hg-radius-tag);
  background: var(--hg-amber);
  color: var(--hg-bg);
  font-family: var(--hg-font-body);
  font-size: 11px;
  font-weight: 700;
}

.hg-wmap__pick {
  padding: 0 5px;
  border: var(--hg-border-width) solid var(--hg-amber);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-amber-ink);
  font-family: var(--hg-font-body);
  font-size: 11px;
  font-weight: 700;
}

.hg-wmap__stars {
  letter-spacing: 1px;
}

.hg-wmap__stars .is-on {
  color: var(--hg-amber);
}

/* ---------- 图例和键盘说明：窄屏放在路线前面，桌面放在地图下面 ---------- */

.hg-wmap__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 20px;
  order: -1;
  padding: 12px 16px;
  border-bottom: var(--hg-border-width) solid var(--hg-border);
}

.hg-wmap__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--hg-ink-2);
  font-size: 12px;
}

.hg-wmap__key {
  --dot: 18px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.hg-wmap__key .hg-wmap__dot {
  border-width: var(--hg-border-width);
  box-shadow: none;
}

.hg-wmap__key.is-boss .hg-wmap__dot {
  box-shadow: 0 0 0 2px var(--hg-wmap-bg), 0 0 0 3px var(--hg-map-boss);
}

.hg-wmap__key.is-picked .hg-wmap__dot {
  outline-offset: 2px;
}

.hg-wmap__key.is-done .hg-wmap__dot svg {
  color: var(--hg-bg);
}

.hg-wmap__keys {
  display: none;
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 12px;
}

/* ---------- 桌面：三个区域并排的地图 ---------- */

@media (min-width: 960px) {
  .hg-wmap__canvas {
    position: relative;
    display: block;
    height: var(--canvas-h);
    padding: 0;
  }

  .hg-wmap__zone {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
  }

  .hg-wmap__area {
    position: absolute;
    top: 12px;
    bottom: 12px;
    left: calc(var(--zx) * 1%);
    display: block;
    width: calc(var(--zw) * 1%);
    border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent-2) 65%, transparent);
    border-radius: var(--hg-radius-card);
    background: color-mix(in srgb, var(--hg-accent-2) 7%, transparent);
  }

  /* 路线：没走过的是虚线，走过的（到「你在这」为止）是区域强调色的实线。 */
  .hg-wmap__seg {
    position: absolute;
    z-index: 1;
    display: block;
    pointer-events: none;
  }

  .hg-wmap__seg.is-h {
    border-top: 2px dashed var(--hg-idle);
    transform: translateY(-1px);
  }

  .hg-wmap__seg.is-v {
    border-left: 2px dashed var(--hg-idle);
    transform: translateX(-1px);
  }

  .hg-wmap__seg.is-trail.is-h {
    border-top: 3px solid var(--hg-accent);
    transform: translateY(-1.5px);
  }

  .hg-wmap__seg.is-trail.is-v {
    border-left: 3px solid var(--hg-accent);
    transform: translateX(-1.5px);
  }

  .hg-wmap__zonehead {
    position: absolute;
    z-index: 3;
    top: 24px;
    left: calc(var(--zx) * 1% + 12px);
    flex-wrap: nowrap;
    width: calc(var(--zw) * 1% - 24px);
    margin: 0;
    padding: 0;
  }

  .hg-wmap__stops {
    position: static;
  }

  /* 一站的锚点是点的圆心：左右居中，往上挪半个点。 */
  .hg-wmap__stop {
    --dot: 42px;
    position: absolute;
    z-index: 2;
    top: calc(var(--y) * 1px);
    left: calc(var(--x) * 1%);
    width: calc(var(--colw) * 1% - 6px);
    transform: translate(-50%, calc(var(--dot) / -2));
  }

  .hg-wmap__stop.is-here {
    --dot: 46px;
  }

  .hg-wmap__stop.is-boss {
    --dot: 50px;
  }

  .hg-wmap__stop::before,
  .hg-wmap__stop::after {
    display: none;
  }

  .hg-wmap__node {
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 0 0 2px;
    text-align: center;
  }

  .hg-wmap__node:focus-visible {
    outline-offset: 4px;
  }

  .hg-wmap__dot {
    margin-inline: 0;
  }

  /* 换行处的竖线从名字后面穿过去：名字和小字垫一块区域底色，线就像从文字下面走。 */
  .hg-wmap__text {
    align-items: center;
    max-width: 100%;
    padding: 1px 3px;
    border-radius: var(--hg-radius-tag);
    background: var(--hg-wmap-plate);
  }

  .hg-wmap__name {
    display: -webkit-box;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.3;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .hg-wmap__meta {
    justify-content: center;
    gap: 2px 6px;
    font-size: 11px;
    line-height: 16px;
  }

  /*
   * 「推荐」「约 N 分钟」「状态」只在纵向路线里写出来；地图上状态看点的样子和图例。
   * 豁免例外：写出「已豁免」（它没有星，只看点的样子分不清豁免和没做）。
   * 「你在这」和「定级推荐」是同一关时只写「你在这」，一行放不下两个标签；环和欢迎区那句话说明它是推荐的。
   */
  .hg-wmap__more,
  .is-here .hg-wmap__pick {
    display: none;
  }

  .hg-wmap__more.is-kept {
    display: inline;
  }

  .hg-wmap__foot {
    order: 0;
    border-top: var(--hg-border-width) solid var(--hg-border);
    border-bottom: 0;
  }

  .hg-wmap__keys {
    display: block;
  }
}

/* 窄一点的桌面（960–1099px）一个区域只有两百多像素宽，标签省掉「ZONE N」，副本入口才放得下；区域卡片里照样写。 */
@media (min-width: 960px) and (max-width: 1099px) {
  .hg-wmap__zcode {
    display: none;
  }
}

/* ---------- 区域卡片（设计稿 Map 底部） ---------- */

.hg-zones__list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hg-zones__card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 16px 18px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
}

/* 试炼场是深色区域（01 第 4 节），卡片用它的深紫底。 */
.hg-zones__card[data-zone='trial'] {
  background: var(--hg-bg);
}

.hg-zones__code {
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-zones__name {
  margin: 0;
  font-family: var(--hg-font-display);
  font-size: 19px;
  line-height: 1.3;
}

.hg-zones__name a {
  color: var(--hg-ink);
  text-decoration: none;
}

.hg-zones__name a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.hg-zones__name a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-zones__meta {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

/* 每一段整段换行，「Lv.20–30」不会断在中间。 */
.hg-zones__meta span {
  white-space: nowrap;
}

.hg-zones__bar {
  display: block;
  height: 6px;
  margin-top: 4px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-border);
  overflow: hidden;
}

.hg-zones__bar span {
  display: block;
  height: 100%;
  background: var(--hg-accent);
  transition: width var(--motion-base) var(--motion-ease-out);
}

.hg-zones__progress {
  margin: 0;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.hg-world__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 14px;
}
</style>
