<script setup lang="ts">
/**
 * 定级测试（Q-02；04 第 2 节，03 第 1、4 节，05 第 1–2 节）。
 *
 * 流程：开始 → 新手村组 →（通过）铸造城组 →（通过）试炼场组 → 结果。题库、计分和推荐规则都在
 * docs/course/placement.ts（Q-01），这里只负责一题一题地问、即时解释、出结果和确认写入。
 * - 作答：选完马上说对错和原因（同 Checkpoint 的说法），「不会」记成 null、算答错；答过的题锁住，不能改。
 *   一组结束（答完，或者剩下的全对也不够）时说这一组的结果，通过了可以接着做下一组，也可以到这里看结果。
 *   答题卡按这一组的区域换装（data-zone）。
 * - 随时可以结束：没答的题算答错，placementResult 照样算得出结果。
 * - 结果：推荐区域和等级（只看停在哪个区域）、推荐关卡、先补哪几关（通过了的组里答错的题挂着的关卡），
 *   以及豁免列表：默认全勾，勾掉的不豁免。推荐关卡是按大纲顺序第一个没豁免、没完成的关卡，
 *   和地图「你在这」同一条规则（journey.ts 的 nextStage），勾掉豁免时跟着变。
 * - 写入：点「确认定级」才调 applyPlacement（经验值来源记「定级」，豁免的关卡标「已豁免」、不给星）。
 *   以前定过级的，确认前再问一次：这次的结果会覆盖上次的豁免和等级记录。确认之前存档一个字都不改。
 * - 结果页链接到世界地图，地址带 ?stage=推荐关卡（mapHref），地图圈出这一关。
 * 作答只在内存里，不进存档：刷新就回到开始页。小核只在开始页说一句，结果页全是数据（01 第 5 节）。
 */
import { computed, nextTick, ref, shallowRef, useId } from 'vue'
import { withBase } from 'vitepress'
import Mascot from '@kit/Mascot.vue'
import { codeLines, type TextSegment } from '@kit/sandbox/template.ts'
import { dateText } from '@course/growth.ts'
import { isPublished, mapHref, stageById, stageHref, STAGES, ZONES, zoneById, type StageMeta, type ZoneMeta } from '@course/outline.ts'
import {
  codeOf, isCorrect, nextGroup, passMark, PLACEMENT, placementResult, QUESTION_KIND_LABEL, scoreGroup,
  type CodeLang, type PlacementGroup, type PlacementQuestion,
} from '@course/placement.ts'
import { levelOf, xpForLevel } from '@course/progress.ts'
import { useProgress } from '@course/useProgress.ts'

const progress = useProgress()
const { state, loaded } = progress
const uid = useId()

const GROUPS = PLACEMENT.groups
const KEYS = ['A', 'B', 'C', 'D', 'E', 'F']
const PASS_PERCENT = Math.round(PLACEMENT.passRate * 100)

function zoneOf(id: string): ZoneMeta {
  const zone = zoneById(id)
  if (!zone) throw new Error(`[Hello GPU] 定级题库里的区域 ${id} 不在 outline.json 里`)
  return zone
}

function stageName(stage: StageMeta): string {
  return `${stage.code} ${stage.title}`
}

function stagesOf(ids: readonly string[]): StageMeta[] {
  return ids.map((id) => stageById(id)).filter((s): s is StageMeta => Boolean(s))
}

/** 开始页的三组：几道题、要对几道、错几道就停（剩下的全对也不够）。 */
const groupInfo = GROUPS.map((group) => {
  const total = group.questions.length
  const needed = passMark(total, PLACEMENT.passRate)
  return { zone: zoneOf(group.zone), total, needed, stopAt: total - needed + 1 }
})

interface Located {
  question: PlacementQuestion
  group: PlacementGroup
  /** 第几组（从 0 数）。 */
  k: number
  /** 组里的第几题（从 0 数）。 */
  index: number
}

const LOOKUP = new Map<string, Located>()
GROUPS.forEach((group, k) => group.questions.forEach((question, index) => LOOKUP.set(question.id, { question, group, k, index })))

// ── 作答 ──────────────────────────────────────────────────────────────

type Phase = 'intro' | 'quiz' | 'result'
const phase = ref<Phase>('intro')
/**
 * 题目 id → 选了第几个选项；null 是「不会」。只在内存里。
 * 每次作答整个换成新对象：placement.ts 用 Object.hasOwn 判断答没答，reactive 代理不追踪它，换对象才追踪得到。
 */
const answers = shallowRef<Readonly<Record<string, number | null>>>({})
/** 正在看的题；答完以后还停在这题，等读者点「下一题」。 */
const currentId = ref('')

const questionEl = ref<HTMLElement | null>(null)
const resultEl = ref<HTMLElement | null>(null)

const current = computed(() => LOOKUP.get(currentId.value) ?? null)
const answered = computed(() => (current.value ? Object.hasOwn(answers.value, current.value.question.id) : false))
/** 这题选了什么：没答是 undefined，「不会」是 null。 */
const choice = computed(() => (current.value && answered.value ? answers.value[current.value.question.id] : undefined))
const right = computed(() => (current.value ? isCorrect(current.value.question, choice.value) : false))
const rightOption = computed(() => current.value?.question.options.find((o) => o.correct) ?? null)
const score = computed(() => (current.value ? scoreGroup(current.value.group, answers.value) : null))
const zone = computed(() => (current.value ? zoneOf(current.value.group.zone) : null))

/** 这一组每道题的样子（进度点）：答对、答错（含「不会」）、正在做、还没做。 */
const steps = computed(() => {
  const c = current.value
  if (!c) return []
  return c.group.questions.map((q, i) => {
    const done = Object.hasOwn(answers.value, q.id)
    return {
      n: i + 1,
      current: q.id === c.question.id,
      mark: !done ? 'todo' : isCorrect(q, answers.value[q.id]) ? 'right' : 'wrong',
    }
  })
})

const relatedText = computed(() => (current.value ? stagesOf(current.value.question.stages).map(stageName).join('、') : ''))

/** 读代码题：新手村按读者的写法给（两种都有，可以换），其余区域给题库里的那一种。 */
const code = computed(() => {
  const c = current.value
  const picked = c ? codeOf(c.question, state.prefs.lang) : null
  if (!c || !picked) return null
  const both = Boolean(c.question.code?.hip && c.question.code?.python)
  const label: Record<CodeLang, string> = both
    ? { hip: 'HIP 风格', python: 'Python 风格', asm: '' }
    : { hip: 'HIP', python: 'Python', asm: '汇编（示意）' }
  const lines: Pick<TextSegment, 'text' | 'tone'>[][] = picked.lang === 'asm'
    ? picked.text.split('\n').map((text) => [{ text, tone: null }])
    : codeLines({ source: picked.text, ranges: [] }, picked.lang, false).map((line) => line.map((s) => ({ text: s.text, tone: s.kind === 'text' ? s.tone : null })))
  return { lang: picked.lang, label: label[picked.lang], both, lines }
})

function switchLang() {
  progress.setPref('lang', state.prefs.lang === 'hip' ? 'python' : 'hip')
}

type Upcoming = { kind: 'next'; id: string } | { kind: 'group'; id: string; zone: ZoneMeta; total: number } | { kind: 'end' }

/** 答完这题以后去哪：同一组的下一题、下一组的第一题，或者测完了。 */
const upcoming = computed<Upcoming | null>(() => {
  const c = current.value
  if (!c || !answered.value) return null
  const group = nextGroup(answers.value)
  const first = group?.questions.find((q) => !Object.hasOwn(answers.value, q.id))
  if (!group || !first) return { kind: 'end' }
  if (group === c.group) return { kind: 'next', id: first.id }
  return { kind: 'group', id: first.id, zone: zoneOf(group.zone), total: group.questions.length }
})

/** 这一组结束了（答完，或者提前停下）时说的那句话。 */
const groupEnd = computed(() => {
  const s = score.value
  const z = zone.value
  if (!s || !z || !answered.value || !s.done) return null
  if (s.passed) return { passed: true, text: `${z.name}组通过了：答对 ${s.correct} / ${s.total}，要对 ${s.needed}。` }
  const text = s.answered < s.total
    ? `${z.name}组到这里结束：答对 ${s.correct} / ${s.answered}，剩下 ${s.total - s.answered} 题全对也凑不够 ${s.needed} 题。`
    : `${z.name}组没通过：答对 ${s.correct} / ${s.total}，要对 ${s.needed}。`
  return { passed: false, text: `${text}推荐你从${z.name}开始。` }
})

async function focusLater(el: { value: HTMLElement | null }) {
  await nextTick()
  el.value?.focus()
}

function start() {
  answers.value = {}
  dropped.value = []
  overwriteOpen.value = false
  confirmed.value = null
  currentId.value = GROUPS[0].questions[0].id
  phase.value = 'quiz'
  void focusLater(questionEl)
}

function pick(option: number | null) {
  const c = current.value
  if (!c || answered.value) return
  answers.value = { ...answers.value, [c.question.id]: option }
}

function advance() {
  const u = upcoming.value
  if (!u || u.kind === 'end') {
    finish()
    return
  }
  currentId.value = u.id
  void focusLater(questionEl)
}

/** 看结果：测完了，或者读者中途结束（没答的题算答错）。 */
function finish() {
  phase.value = 'result'
  void focusLater(resultEl)
}

// ── 结果 ──────────────────────────────────────────────────────────────

const result = computed(() => placementResult(answers.value))
/** 读者勾掉的豁免。 */
const dropped = ref<string[]>([])
const exemptNow = computed(() => result.value.exempt.filter((id) => !dropped.value.includes(id)))

/** 推荐关卡：按大纲顺序第一个没豁免、没完成的关卡，确认以后地图的「你在这」就是它（没在别的关卡做到一半的话）。 */
const recommended = computed<StageMeta | null>(() => {
  const exempt = new Set(exemptNow.value)
  return STAGES.find((s) => !exempt.has(s.id) && !state.stages[s.id]?.completed) ?? null
})

/** 推荐关卡不在推荐区域时，说清为什么先去那一关。 */
const recommendNote = computed(() => {
  const s = recommended.value
  if (!s) return '所有关卡都豁免或者做完了。想拿星，挑一关回去做；也可以去副本练手。'
  if (result.value.gaps.includes(s.id)) return '这一关挂着的题你答错了，所以不豁免。它在大纲里排在最前面，地图会先带你补上。'
  if (dropped.value.includes(s.id)) return '你取消了这一关的豁免，它在大纲里排在最前面。'
  return ''
})

const groupRows = computed(() => GROUPS.map((group) => {
  const z = zoneOf(group.zone)
  const s = result.value.groups.find((g) => g.zone === group.zone)
  if (!s) return { zone: z, verdict: 'skip', label: '没做', text: '前面一组没通过，这一组不用做。' }
  // 在这一组开头就结束了：一题没答，按没通过算（推荐从这个区域开始）。
  if (s.answered === 0) return { zone: z, verdict: 'skip', label: '没做', text: `一题没答，按没通过算 · 要对 ${s.needed}` }
  const parts = [`答对 ${s.correct} / ${s.total}`]
  if (s.answered < s.total) parts.push(`答了 ${s.answered} 题`)
  parts.push(`要对 ${s.needed}`)
  return { zone: z, verdict: s.passed ? 'pass' : 'fail', label: s.passed ? '通过' : '没通过', text: parts.join(' · ') }
}))

const gaps = computed(() => stagesOf(result.value.gaps))

const exemptGroups = computed(() => ZONES
  .map((z) => ({ zone: z, stages: stagesOf(result.value.exempt).filter((s) => s.zone === z.id) }))
  .filter((g) => g.stages.length))

function setExempt(id: string, keep: boolean) {
  dropped.value = keep ? dropped.value.filter((x) => x !== id) : [...dropped.value, id]
}

const headline = computed(() => {
  const r = result.value
  return r.zone ? zoneOf(r.zone).name : '三组都通过了'
})

// 经验值：定级给的只补差额（applyPlacement），已有的经验值不动，所以确认后的等级可能比推荐等级高。
const granted = computed(() => state.placement?.xp ?? 0)
const xpGain = computed(() => Math.max(0, xpForLevel(result.value.level) - granted.value))
const levelAfter = computed(() => levelOf(state.xp + xpGain.value))
const xpText = computed(() => {
  if (xpGain.value > 0) return `经验值 +${xpGain.value}（来源记作「定级」），确认后是 Lv.${levelAfter.value}。`
  if (granted.value > 0) return `上次定级已经给过 ${granted.value} XP，这次不再加经验值。`
  return `Lv.${result.value.level} 不加经验值。`
})

// ── 确认写入 ──────────────────────────────────────────────────────────

/** 上次定级（只在读完存档以后说，免得首屏先说「没定过」再改口）。 */
const previous = computed(() => (loaded.value ? state.placement : null))
const overwriteOpen = ref(false)
const overwriteCancel = ref<HTMLButtonElement | null>(null)
const confirmBtn = ref<HTMLButtonElement | null>(null)
const doneEl = ref<HTMLElement | null>(null)
/** 这次确认写进去的结果；没确认是 null。 */
const confirmed = ref<{ level: number; exempt: number; xp: number; stage: StageMeta | null } | null>(null)

function onConfirm() {
  if (!loaded.value) return
  if (state.placement) {
    overwriteOpen.value = true
    // 焦点先落在「取消」上：误按 Enter 也不会覆盖。
    void focusLater(overwriteCancel)
    return
  }
  apply()
}

function closeOverwrite() {
  overwriteOpen.value = false
  void focusLater(confirmBtn)
}

function apply() {
  const level = result.value.level
  const exempt = [...exemptNow.value]
  const xp = xpGain.value
  const stage = recommended.value
  progress.applyPlacement(level, exempt)
  overwriteOpen.value = false
  confirmed.value = { level, exempt: exempt.length, xp, stage }
  void focusLater(doneEl)
}

const doneText = computed(() => {
  const c = confirmed.value
  if (!c) return ''
  let text = `定级完成：Lv.${c.level}，${c.exempt ? `豁免 ${c.exempt} 关` : '没有豁免关卡'}`
  if (c.xp) text += `，经验值 +${c.xp}`
  text += '。'
  if (c.stage) text += `地图上的「你在这」会落在 ${stageName(c.stage)}（你没在别的关卡做到一半的话）。`
  return text
})

function link(stage: StageMeta | null): string {
  return withBase(mapHref(stage?.id ?? ''))
}
</script>

<template>
  <div class="pl">
    <!-- ── 开始页 ── -->
    <section v-if="phase === 'intro'" class="pl-card pl-intro" :aria-labelledby="`${uid}-intro`">
      <div class="pl-hello">
        <Mascot class="pl-hello__art" size="sm" />
        <p class="pl-hello__line">先做几道小题，我帮你找起点。</p>
      </div>
      <h2 :id="`${uid}-intro`" class="pl-title">怎么测</h2>
      <p class="pl-lead">
        题目分三组，按新手村 → 铸造城 → 试炼场的顺序做。一组答对 {{ PASS_PERCENT }}%，进下一组；不到，就停在这一组，推荐你从这个区域开始。
      </p>
      <ul class="pl-groups">
        <li v-for="(g, k) in groupInfo" :key="g.zone.id" class="pl-group" :data-zone="g.zone.id">
          <span class="pl-group__num">{{ k + 1 }}</span>
          <span class="pl-group__name">{{ g.zone.name }}</span>
          <span class="pl-group__meta">{{ g.total }} 题 · 答对 {{ g.needed }} 题过关 · 错 {{ g.stopAt }} 题就停</span>
        </li>
      </ul>
      <ul class="pl-rules">
        <li>选完马上告诉你对错和原因，答过的题不能改。</li>
        <li>没把握就点「不会」，别硬猜：蒙对的题会让你跳过还没学会的关卡。</li>
        <li>中途可以随时结束，没答的题算答错。</li>
        <li>测完先看结果：不想跳过的关卡可以勾掉，点「确认定级」才写进进度。</li>
      </ul>
      <p v-if="previous" class="pl-notice">
        你在 {{ dateText(previous.at) }} 定过级：Lv.{{ previous.level }}，豁免 {{ previous.exempt.length }} 关。重新测试不会马上改动进度；测完确认时才覆盖上次的结果，到时还会再问你一次。
      </p>
      <div class="pl-actions">
        <button type="button" class="pl-btn is-primary" @click="start">{{ previous ? '重新测试' : '开始测试' }}</button>
      </div>
    </section>

    <!-- ── 答题 ── -->
    <section
      v-else-if="phase === 'quiz' && current && zone && score"
      class="pl-card pl-quiz"
      :data-zone="zone.id"
      :aria-labelledby="`${uid}-q`"
    >
      <header class="pl-quiz__head">
        <p class="pl-eyebrow">第 {{ current.k + 1 }} 组 / 共 {{ GROUPS.length }} 组 · {{ zone.name }} · Lv.{{ zone.lv[0] }}–{{ zone.lv[1] }}</p>
        <button type="button" class="pl-textbtn" @click="finish">结束测试，看结果</button>
      </header>

      <div class="pl-progress">
        <ol class="pl-steps" aria-hidden="true">
          <li v-for="s in steps" :key="s.n" class="pl-step" :class="[`is-${s.mark}`, { 'is-current': s.current }]">
            {{ s.mark === 'right' ? '✓' : s.mark === 'wrong' ? '✗' : s.n }}
          </li>
        </ol>
        <p class="pl-count">第 {{ current.index + 1 }} / {{ score.total }} 题 · 答对 {{ score.correct }} · 过关要对 {{ score.needed }}</p>
      </div>

      <h2 :id="`${uid}-q`" ref="questionEl" class="pl-q" tabindex="-1">
        <span class="pl-q__kind">{{ QUESTION_KIND_LABEL[current.question.kind] }}</span>
        <span class="pl-q__text">{{ current.question.q }}</span>
      </h2>

      <figure v-if="code" class="pl-code">
        <figcaption class="pl-code__bar">
          <span class="pl-code__file">{{ code.label }}</span>
          <button v-if="code.both" type="button" class="pl-code__switch" @click="switchLang">
            换成 {{ code.lang === 'hip' ? 'Python 风格' : 'HIP 风格' }}
          </button>
        </figcaption>
        <div class="pl-code__body" role="region" :aria-label="`${code.label}代码`" tabindex="0">
          <div v-for="(line, li) in code.lines" :key="li" class="pl-code__line">
            <span class="pl-code__ln" aria-hidden="true">{{ li + 1 }}</span>
            <span class="pl-code__lc"><span v-for="(seg, si) in line" :key="si" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></span>
          </div>
        </div>
      </figure>

      <!-- 答过以后用 aria-disabled 而不是 disabled：按钮不会把焦点弄丢，键盘读者可以接着往下走（同 Checkpoint）。 -->
      <div class="pl-options" role="group" :aria-labelledby="`${uid}-q`">
        <button
          v-for="(option, oi) in current.question.options"
          :key="oi"
          type="button"
          class="pl-option"
          :class="{ 'is-right': answered && option.correct, 'is-wrong': choice === oi && !option.correct }"
          :aria-pressed="choice === oi"
          :aria-disabled="answered"
          @click="pick(oi)"
        >
          <span class="pl-option__key" aria-hidden="true">{{ KEYS[oi] }}</span>
          <span class="pl-option__label">{{ option.label }}</span>
          <span v-if="answered && option.correct" class="pl-mark is-right">答案</span>
          <span v-else-if="choice === oi" class="pl-mark is-wrong">你的选择</span>
        </button>
        <button
          type="button"
          class="pl-option is-skip"
          :class="{ 'is-wrong': choice === null }"
          :aria-pressed="choice === null"
          :aria-disabled="answered"
          @click="pick(null)"
        >
          <span class="pl-option__label">不会，跳过这题</span>
          <span v-if="choice === null" class="pl-mark is-wrong">你的选择</span>
        </button>
      </div>

      <div class="pl-why" aria-live="polite">
        <template v-if="answered">
          <p class="pl-verdict" :class="right ? 'is-right' : 'is-wrong'">
            <strong>{{ right ? '答对了。' : choice === null ? '这题算答错。' : '不对。' }}</strong>
            <template v-if="typeof choice === 'number'">{{ current.question.options[choice]?.why }}</template>
          </p>
          <p v-if="!right && rightOption" class="pl-verdict">正确答案是「{{ rightOption.label }}」：{{ rightOption.why }}</p>
          <p class="pl-related">对应关卡：{{ relatedText }}</p>
          <details class="pl-others">
            <summary>看看每个选项的解释</summary>
            <ul>
              <li v-for="(option, oi) in current.question.options" :key="oi">
                <strong>{{ KEYS[oi] }}. {{ option.label }}</strong>{{ option.correct ? '（答案）' : '' }}：{{ option.why }}
              </li>
            </ul>
          </details>
          <p v-if="groupEnd" class="pl-groupend" :class="groupEnd.passed ? 'is-pass' : 'is-fail'">
            <span class="pl-groupend__mark" aria-hidden="true">{{ groupEnd.passed ? '✓' : '✗' }}</span>{{ groupEnd.text }}
          </p>
        </template>
      </div>

      <div v-if="upcoming" class="pl-actions">
        <button v-if="upcoming.kind === 'next'" type="button" class="pl-btn is-primary" @click="advance">下一题</button>
        <template v-else-if="upcoming.kind === 'group'">
          <button type="button" class="pl-btn is-primary" @click="advance">下一组：{{ upcoming.zone.name }}（{{ upcoming.total }} 题）</button>
          <button type="button" class="pl-btn" @click="finish">到这里，看结果</button>
        </template>
        <button v-else type="button" class="pl-btn is-primary" @click="finish">看结果</button>
      </div>
    </section>

    <!-- ── 结果 ── -->
    <template v-else-if="phase === 'result'">
      <section class="pl-card pl-result" :aria-labelledby="`${uid}-result`">
        <p class="pl-eyebrow">定级结果</p>
        <h2 :id="`${uid}-result`" ref="resultEl" class="pl-title" tabindex="-1">从哪里开始</h2>
        <dl class="pl-facts">
          <div class="pl-fact">
            <dt>推荐区域</dt>
            <dd>{{ headline }}</dd>
          </div>
          <div class="pl-fact">
            <dt>推荐等级</dt>
            <dd>Lv.{{ result.level }}</dd>
          </div>
          <div class="pl-fact is-wide">
            <dt>推荐关卡</dt>
            <dd>
              <template v-if="recommended">
                {{ stageName(recommended) }}<span v-if="!isPublished(recommended)" class="pl-soon">建设中</span>
              </template>
              <template v-else>全部豁免</template>
            </dd>
          </div>
        </dl>
        <p v-if="recommendNote" class="pl-note">{{ recommendNote }}</p>
        <div class="pl-actions">
          <a v-if="recommended && isPublished(recommended)" class="pl-btn is-primary" :href="withBase(stageHref(recommended))">开始：{{ stageName(recommended) }}</a>
          <a class="pl-btn" :href="link(recommended)">在地图上看{{ recommended ? '推荐关卡' : '' }}</a>
        </div>
      </section>

      <section class="pl-card" :aria-labelledby="`${uid}-scores`">
        <h2 :id="`${uid}-scores`" class="pl-title">三组的成绩</h2>
        <ul class="pl-scores">
          <li v-for="row in groupRows" :key="row.zone.id" class="pl-score" :class="`is-${row.verdict}`">
            <span class="pl-score__zone">{{ row.zone.name }}</span>
            <span class="pl-score__verdict"><span aria-hidden="true">{{ row.verdict === 'pass' ? '✓ ' : row.verdict === 'fail' ? '✗ ' : '– ' }}</span>{{ row.label }}</span>
            <span class="pl-score__text">{{ row.text }}</span>
          </li>
        </ul>
      </section>

      <section v-if="gaps.length" class="pl-card" :aria-labelledby="`${uid}-gaps`">
        <h2 :id="`${uid}-gaps`" class="pl-title">先补这几关</h2>
        <p class="pl-desc">这些关卡所在的组通过了，可它们挂着的题你答错了，所以不豁免。地图按大纲顺序走，会先带你补上。</p>
        <ul class="pl-stagelist">
          <li v-for="s in gaps" :key="s.id"><span class="pl-stagecode">{{ s.code }}</span>{{ s.title }}</li>
        </ul>
      </section>

      <section v-if="exemptGroups.length" class="pl-card" :aria-labelledby="`${uid}-exempt`">
        <div class="pl-card__head">
          <h2 :id="`${uid}-exempt`" class="pl-title">豁免的关卡</h2>
          <span class="pl-count">{{ exemptNow.length }} / {{ result.exempt.length }} 关</span>
        </div>
        <p class="pl-desc">豁免的关卡在地图上标「已豁免」：没有星，不算通关，随时可以回去做、拿星。Boss 跟着整组豁免，区域毕业徽章要打过 Boss 才有。不想跳过的，把勾去掉。</p>
        <fieldset v-for="g in exemptGroups" :key="g.zone.id" class="pl-exempt" :disabled="Boolean(confirmed)">
          <legend class="pl-exempt__zone">{{ g.zone.name }}</legend>
          <label v-for="s in g.stages" :key="s.id" class="pl-check">
            <input type="checkbox" :checked="!dropped.includes(s.id)" @change="setExempt(s.id, ($event.target as HTMLInputElement).checked)">
            <span class="pl-stagecode">{{ s.code }}</span>
            <span>{{ s.title }}</span>
          </label>
        </fieldset>
      </section>

      <section class="pl-card pl-confirm" :aria-labelledby="`${uid}-confirm`">
        <h2 :id="`${uid}-confirm`" class="pl-title">确认定级</h2>
        <template v-if="!confirmed">
          <p class="pl-desc">
            确认后写进进度：推荐等级 Lv.{{ result.level }}，{{ exemptNow.length ? `豁免 ${exemptNow.length} 关` : '不豁免关卡' }}。{{ xpText }}不确认，进度不变。
          </p>
          <div class="pl-actions">
            <button
              ref="confirmBtn"
              type="button"
              class="pl-btn is-primary"
              :disabled="!loaded"
              :aria-expanded="previous ? overwriteOpen : undefined"
              @click="onConfirm"
            >
              确认定级
            </button>
            <button type="button" class="pl-btn" @click="start">重新测试</button>
          </div>
          <div
            v-if="overwriteOpen && previous"
            class="pl-overwrite"
            role="group"
            :aria-labelledby="`${uid}-overwrite`"
            @keydown.escape="closeOverwrite"
          >
            <p :id="`${uid}-overwrite`" class="pl-overwrite__title">要覆盖上次的定级吗？</p>
            <p class="pl-overwrite__warn">
              上次（{{ dateText(previous.at) }}）是 Lv.{{ previous.level }}，豁免 {{ previous.exempt.length }} 关。确认以后，豁免换成这次勾选的 {{ exemptNow.length }} 关，等级记录换成 Lv.{{ result.level }}；上次定级给的经验值不收回。
            </p>
            <div class="pl-actions">
              <button type="button" class="pl-btn is-primary" @click="apply">覆盖上次的定级</button>
              <button ref="overwriteCancel" type="button" class="pl-btn" @click="closeOverwrite">取消</button>
            </div>
          </div>
        </template>
        <template v-else>
          <p ref="doneEl" class="pl-done" tabindex="-1">{{ doneText }}</p>
          <div class="pl-actions">
            <a class="pl-btn is-primary" :href="link(confirmed.stage)">去地图看看</a>
            <a v-if="confirmed.stage && isPublished(confirmed.stage)" class="pl-btn" :href="withBase(stageHref(confirmed.stage))">开始：{{ stageName(confirmed.stage) }}</a>
            <button type="button" class="pl-btn" @click="start">重新测试</button>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pl {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 8px;
  font-size: 15px;
  line-height: 1.6;
}

/* 卡片标题：去掉正文 h2 的分隔线和大间距（同「我的成长」）。 */
.pl h2 {
  margin: 0;
  padding: 0;
  border: 0;
  letter-spacing: 0;
}

.pl-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.pl-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
}

.pl-title {
  font-size: var(--hg-text-card-title);
}

/* 程序挪过来的焦点（换题、出结果）不画焦点框：它们不是可操作的控件。 */
.pl-title:focus,
.pl-q:focus,
.pl-done:focus {
  outline: none;
}

.pl-eyebrow {
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  letter-spacing: var(--hg-tracking-eyebrow);
}

.pl-lead,
.pl-desc,
.pl-note {
  margin: 0;
}

.pl-desc {
  color: var(--hg-ink-2);
}

.pl-note {
  color: var(--hg-ink-2);
  font-size: 14px;
}

.pl-count {
  margin: 0;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

/* ---------- 按钮：主按钮深墨底、反色字，强调色只留给进度和焦点（01 第 2.2 节） ---------- */

.pl-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pl-btn {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-weight: 600;
  line-height: 1.3;
  text-decoration: none;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.pl-btn.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.pl-btn:hover:not(:disabled) {
  border-color: var(--hg-accent);
}

.pl-btn:focus-visible,
.pl-textbtn:focus-visible,
.pl-code__switch:focus-visible,
.pl-option:focus-visible,
.pl-others summary:focus-visible,
.pl-code__body:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.pl-btn:disabled {
  cursor: default;
  opacity: 0.55;
}

.pl-textbtn {
  padding: 4px 0;
  border: 0;
  background: none;
  color: var(--hg-ink-2);
  font: inherit;
  font-size: 14px;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.pl-textbtn:hover {
  color: var(--hg-ink);
}

/* ---------- 开始页 ---------- */

.pl-hello {
  display: flex;
  align-items: center;
  gap: 14px;
}

.pl-hello__art {
  flex: none;
}

/* 简洁模式收起插画（01 第 4 节）。 */
.hg-shell.is-plain .pl-hello__art {
  display: none;
}

.pl-hello__line {
  margin: 0;
  padding: 8px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  font-weight: 600;
}

.pl-groups {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pl-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 0;
  padding: 10px 14px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
  color: var(--hg-ink);
}

.pl-group__num {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--hg-accent);
  color: var(--hg-bg);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
}

.pl-group__name {
  font-weight: 700;
}

.pl-group__meta {
  color: var(--hg-ink-2);
  font-size: 14px;
}

.pl-rules {
  margin: 0;
  padding-left: 22px;
  color: var(--hg-ink-2);
}

.pl-rules li {
  margin: 4px 0;
}

/* 以前定过级：琥珀色描边 = 提醒（01 第 2.2 节）。 */
.pl-notice {
  margin: 0;
  padding: 10px 14px;
  border: var(--hg-border-width) solid var(--hg-amber);
  border-radius: var(--hg-radius-control);
  color: var(--hg-ink);
  font-size: 14px;
}

/* ---------- 答题 ---------- */

.pl-quiz__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 16px;
}

.pl-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.pl-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 进度点：对勾、叉、序号三种写法，不只靠颜色（01 第 7 节）。 */
.pl-step {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin: 0;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: 50%;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
}

.pl-step.is-right {
  border-color: var(--hg-accent);
  background: var(--hg-accent);
  color: var(--hg-bg);
}

.pl-step.is-wrong {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
}

.pl-step.is-current {
  border-width: 2px;
  border-color: var(--hg-ink);
  color: var(--hg-ink);
}

.pl-q {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: var(--hg-font-body);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.6;
}

.pl-q__kind {
  align-self: flex-start;
  padding: 0 8px;
  border: var(--hg-border-width) solid var(--hg-accent);
  border-radius: var(--hg-radius-tag);
  color: var(--hg-accent-ink);
  font-size: 12px;
  font-weight: 700;
  line-height: 20px;
}

/* 代码区（01 第 2.4 节）：深色底、顶部一条文件名栏，和代码沙盒同一套颜色。 */
.pl-code {
  margin: 0;
  overflow: hidden;
  border: var(--hg-border-width) solid var(--hg-code-dot);
  border-radius: 14px;
  background: var(--hg-code-bg);
  color: var(--hg-code-ink);
}

.pl-code__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 7px 14px;
  border-bottom: var(--hg-border-width) solid var(--hg-code-dot);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  line-height: 1.6;
}

.pl-code__file {
  color: var(--hg-code-file);
}

.pl-code__switch {
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--hg-code-highlight);
  font: inherit;
  font-family: var(--hg-font-body);
  font-size: 13px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.pl-code__body {
  padding: 12px 0;
  overflow-x: auto;
  font-family: var(--hg-font-mono);
  font-size: 14px;
  line-height: 1.85;
}

.pl-code__body:focus-visible {
  outline-offset: -2px;
}

.pl-code__line {
  display: flex;
  min-width: max-content;
  white-space: pre;
}

.pl-code__ln {
  flex: none;
  box-sizing: border-box;
  min-width: calc(2ch + 32px);
  padding: 0 10px 0 22px;
  color: var(--hg-code-line-number);
  text-align: right;
  user-select: none;
}

.pl-code__lc {
  padding: 0 18px 0 6px;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

/* 选项：一行一个，前面写 A–E；答过以后答案描强调色、选错的描错误色，另外都有文字标记（01 第 7 节）。 */
.pl-options {
  display: grid;
  gap: 8px;
}

.pl-option {
  display: flex;
  align-items: center;
  gap: 4px 12px;
  min-height: 44px;
  padding: 8px 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--motion-ease-out),
    background-color var(--motion-fast) var(--motion-ease-out);
}

.pl-option:not([aria-disabled='true']):hover {
  border-color: var(--hg-accent);
}

.pl-option[aria-disabled='true'] {
  cursor: default;
}

.pl-option__key {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: 50%;
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
}

.pl-option__label {
  flex: 1 1 auto;
  min-width: 0;
}

.pl-option.is-skip {
  border-style: dashed;
  color: var(--hg-ink-2);
}

.pl-option.is-right {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
}

.pl-option.is-wrong {
  border-style: solid;
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
}

.pl-mark {
  flex: none;
  padding: 1px 8px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  white-space: nowrap;
}

.pl-mark.is-right {
  color: var(--hg-accent-ink);
}

.pl-mark.is-wrong {
  color: var(--hg-error-ink);
}

/* 播报区一直留在页面上（空的时候没有高度，抵掉卡片里的间距），出现文字时读屏才念得出来。 */
.pl-why:empty {
  margin-top: -14px;
}

.pl-why {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pl-verdict {
  margin: 0;
  color: var(--hg-ink-2);
}

.pl-verdict.is-right {
  color: var(--hg-ink);
}

.pl-verdict.is-right strong {
  color: var(--hg-accent-ink);
}

.pl-verdict.is-wrong strong {
  color: var(--hg-error-ink);
}

.pl-related {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 14px;
}

.pl-others {
  color: var(--hg-ink-3);
  font-size: 14px;
}

.pl-others summary {
  width: fit-content;
  border-radius: var(--hg-radius-tag);
  cursor: pointer;
}

.pl-others ul {
  margin: 6px 0 0;
  padding-left: 20px;
  color: var(--hg-ink-2);
}

.pl-others li {
  margin: 4px 0;
}

.pl-groupend {
  display: flex;
  gap: 8px;
  margin: 4px 0 0;
  padding: 10px 14px;
  border-radius: var(--hg-radius-control);
  font-weight: 600;
}

.pl-groupend.is-pass {
  background: var(--hg-accent-soft);
}

.pl-groupend.is-fail {
  border: var(--hg-border-width) solid var(--hg-amber);
}

.pl-groupend__mark {
  flex: none;
  color: var(--hg-accent-ink);
}

.pl-groupend.is-fail .pl-groupend__mark {
  color: var(--hg-amber-ink);
}

/* ---------- 结果 ---------- */

.pl-facts {
  display: grid;
  grid-template-columns: 1fr 1fr 2fr;
  gap: 10px;
  margin: 0;
}

.pl-fact {
  padding: 12px 14px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-control);
  background: var(--hg-accent-soft);
}

.pl-fact dt {
  color: var(--hg-ink-2);
  font-size: 13px;
}

.pl-fact dd {
  margin: 2px 0 0;
  font-family: var(--hg-font-display);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
}

.pl-soon {
  margin-left: 8px;
  padding: 1px 8px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-body);
  font-size: 13px;
  font-weight: 600;
  vertical-align: middle;
  white-space: nowrap;
}

.pl-scores {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pl-score {
  display: grid;
  grid-template-columns: 5em 6em 1fr;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0;
  padding: 8px 0;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.pl-score:first-child {
  padding-top: 0;
  border-top: 0;
}

.pl-score__zone {
  font-weight: 700;
}

.pl-score__verdict {
  font-weight: 600;
}

.pl-score.is-pass .pl-score__verdict {
  color: var(--hg-accent-ink);
}

.pl-score.is-fail .pl-score__verdict {
  color: var(--hg-amber-ink);
}

.pl-score.is-skip {
  color: var(--hg-ink-3);
}

.pl-score__text {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.pl-score.is-skip .pl-score__text {
  font-family: var(--hg-font-body);
}

.pl-stagelist {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pl-stagelist li {
  margin: 0;
  padding: 4px 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
}

.pl-stagecode {
  margin-right: 6px;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

.pl-exempt {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px 16px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.pl-exempt__zone {
  grid-column: 1 / -1;
  margin-bottom: 2px;
  padding: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  font-weight: 700;
}

.pl-check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  cursor: pointer;
}

.pl-exempt:disabled .pl-check {
  cursor: default;
  opacity: 0.7;
}

.pl-check input {
  flex: none;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--hg-accent);
}

.pl-check input:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.pl-check .pl-stagecode {
  margin-right: 0;
}

/* 覆盖上次定级之前的确认：琥珀色描边 = 警告（同「我的成长」的清空和导入）。 */
.pl-overwrite {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-amber);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
}

.pl-overwrite__title {
  margin: 0;
  font-weight: 700;
}

.pl-overwrite__warn {
  margin: 0;
  color: var(--hg-amber-ink);
  font-size: 14px;
  font-weight: 600;
}

.pl-done {
  margin: 0;
  padding: 12px 16px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-accent-soft);
}

@media (max-width: 767px) {
  .pl-card {
    padding: 16px;
  }

  .pl-facts {
    grid-template-columns: 1fr 1fr;
  }

  .pl-fact.is-wide {
    grid-column: 1 / -1;
  }

  .pl-fact dd {
    font-size: 19px;
  }

  .pl-score {
    grid-template-columns: auto 1fr;
  }

  .pl-score__text {
    grid-column: 1 / -1;
  }
}
</style>
