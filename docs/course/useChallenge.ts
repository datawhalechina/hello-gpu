/**
 * 挑战状态（F-12；03 第 4 节「反馈与容错」，04 第 3 节「看过答案本关最高 2 星」）。
 *
 * 所有挑战共用：尝试次数；提示阶梯（没过第 2、4、6 次分别解锁方向提示、位置提示、看答案）；
 * 在挑战里看答案以后本关最高 2 星，探索环节看答案不影响星级；把 judge 的结果交给进度存档发星
 * （每颗星只发一次）；每关一个草稿槽，代码、参数和提示进度自动保存，刷新不丢。
 * 副本（X-01）也用它：stage 写副本 id 时，★1 成立就算通关，第一次通关发这道题的经验值，
 * 星记在副本的进度里、不另给经验值（04 第 2 节：副本每题 50–150 XP）。
 * 综合关（新手村 Boss）有好几道分题（part）：每道照挑战记次数、给提示，看答案以后本关照样最高 2 星，
 * 可分题自己不发星；关卡把几道分题的结果合起来判星，交给本关一个不带提示的 challenge 发。
 *
 * 前半部分是纯规则，不碰 Vue 和浏览器，单测直接调用；后半部分 useChallenge 把它接到
 * 进度存档（useProgress）和草稿槽（storage.ts）上，并把带提示的挑战登记给状态栏的提示按钮。
 *
 * 用法（关卡的挑战组件里）：
 *   const ch = useChallenge({ stage: 'novice-thread-groups', id: 'launch', hints: { direction, location, answer } })
 *   ch.draft.value = { blockDim: 4 }      // 读者改的参数，自动保存
 *   ch.attempt(judge(simResult, config))  // { earned: [bool, bool, bool], next, error? }
 *   <HintLadder :challenge="ch" />        // 提示阶梯；状态栏的提示按钮打开的是同一份
 */
import {
  computed, getCurrentInstance, onBeforeUnmount, onMounted, reactive, readonly, ref, shallowReactive, shallowRef, watch,
  type ComputedRef, type Ref,
} from 'vue'
import { MAX_STARS } from './progress.ts'
import { exerciseById } from './outline.ts'
import { loadDraftSlot, saveDraftSlot } from './storage.ts'
import { progressStorage, useProgress } from './useProgress.ts'

// ── 纯规则 ────────────────────────────────────────────────────────────────

/** 没过第几次解锁下一级（03 第 4 节）：方向提示、位置提示、看答案。 */
export const HINT_UNLOCK = [2, 4, 6] as const
export type HintStep = 'direction' | 'location' | 'answer'
export const HINT_STEPS: readonly HintStep[] = ['direction', 'location', 'answer']

/** 没过 failures 次时解锁到第几级：0 还没有提示，1 方向，2 位置，3 可以看答案。 */
export function hintLevel(failures: number): number {
  return HINT_UNLOCK.filter((n) => failures >= n).length
}

/** 离解锁下一级还差几次没过；全部解锁以后是 0。 */
export function failuresToNext(failures: number): number {
  const next = HINT_UNLOCK.find((n) => failures < n)
  return next === undefined ? 0 : next - failures
}

/**
 * challenge：本关的星级挑战；explore：探索环节的交互，看答案不影响星级，也不发星；
 * part：综合关里的一道分题，过没过只看它自己，记次数、给提示，看答案以后本关最高 2 星，但不发星。
 */
export type ChallengeKind = 'challenge' | 'explore' | 'part'

/** 03 第 4 节：错误信息写成「现象 + 原因 + 怎么改」，编译器或解析器的原文放进折叠块。 */
export interface ChallengeError {
  symptom: string
  cause: string
  fix: string
  raw?: string
}

/** 错误说明缺了哪几部分（中文名），HintLadder 据此画红框提醒写关卡的人。 */
export function missingErrorParts(error: ChallengeError): string[] {
  const parts: [keyof ChallengeError, string][] = [['symptom', '现象'], ['cause', '原因'], ['fix', '怎么改']]
  return parts.filter(([key]) => !String(error?.[key] ?? '').trim()).map(([, name]) => name)
}

/** 一次尝试交进来的结果：06 第 7 节 judge 的输出，没过时再带上错误说明。 */
export interface AttemptResult {
  /** 三颗星各自成立没有。 */
  earned: readonly boolean[]
  /** 下一步的一句话（judge 给的）。 */
  next?: string
  error?: ChallengeError
}

/** 存进草稿槽的记录。 */
export interface ChallengeRecord {
  attempts: number
  /** 没过的次数，提示阶梯看它；只增不减，也不扣任何东西。 */
  failures: number
  /** 看过答案没有。 */
  revealed: boolean
  /** 读者的代码和参数，格式由挑战组件自己定（要能 JSON 序列化）。 */
  draft: unknown
}

export function emptyRecord(): ChallengeRecord {
  return { attempts: 0, failures: 0, revealed: false, draft: null }
}

/** 草稿槽里读出来的东西可能被手改坏：缺的补默认值，类型不对的丢掉。 */
export function normalizeRecord(raw: unknown): ChallengeRecord {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
  const failures = count(r.failures)
  return {
    attempts: Math.max(count(r.attempts), failures),
    failures,
    revealed: r.revealed === true,
    draft: r.draft === undefined ? null : r.draft,
  }
}

export interface AttemptOutcome {
  /** ★1 成立（结果正确）就算过了。 */
  passed: boolean
  /** 这一次刚解锁的那级提示，没有就是 null。 */
  unlocked: HintStep | null
  /** 这次该发的星（序号）。★1 不成立时一颗都不发：结果不对，效率再高也不算。 */
  stars: number[]
}

/** 记一次尝试。没过只记次数：不扣经验值，也没有次数上限（03 第 4 节「不惩罚」）。 */
export function recordAttempt(record: ChallengeRecord, result: AttemptResult): AttemptOutcome {
  const earned = Array.from({ length: MAX_STARS }, (_, i) => Boolean(result?.earned?.[i]))
  const passed = earned[0]
  const before = hintLevel(record.failures)
  record.attempts += 1
  if (!passed) record.failures += 1
  const after = hintLevel(record.failures)
  return {
    passed,
    unlocked: after > before ? HINT_STEPS[after - 1] : null,
    stars: passed ? earned.flatMap((ok, i) => (ok ? [i] : [])) : [],
  }
}

/** 没过满 6 次才能看答案。 */
export function canReveal(record: ChallengeRecord): boolean {
  return hintLevel(record.failures) >= HINT_STEPS.length
}

/**
 * 「我已经会了，直接做挑战」的去处（03 第 4 节「随时可跳过」）：
 * 正文骨架里标题以「挑战」开头的那一段（06 第 3 节第 6 项）。
 */
export function challengeSection<T extends { title: string }>(sections: readonly T[]): T | null {
  return sections.find((s) => s.title.trim().startsWith('挑战')) ?? null
}

// ── 组合式函数 ────────────────────────────────────────────────────────────

/** 三级提示的内容：方向（往哪想）、位置（看哪里）、答案（answerCode 是答案代码，可以不写）。 */
export interface Hints {
  direction: string
  location: string
  answer: string
  answerCode?: string
}

export interface ChallengeOptions {
  /**
   * 关卡 id（outline.json 里的那个）：星发给它，草稿槽也按它分。
   * 也可以写副本 id（outline.json 的 exercises 里的 dungeon-…）：星和经验值按副本的规则记。
   */
  stage: string
  /** 这个挑战在本关里的编号，同一关有多个带提示的交互时用来区分。 */
  id: string
  kind?: ChallengeKind
  hints?: Hints
}

export interface Challenge {
  readonly stage: string
  readonly id: string
  readonly kind: ChallengeKind
  readonly hints: Hints | null
  /** 尝试次数、没过次数、看没看过答案、草稿（只读，改草稿用 draft）。 */
  readonly record: Readonly<ChallengeRecord>
  /** 解锁到第几级（0–3）。 */
  readonly level: ComputedRef<number>
  /** 本关现在最多还能拿几颗星（挑战里看过答案是 2；探索环节不受影响，总是 3）。 */
  readonly cap: ComputedRef<number>
  /** 最近一次没过的错误说明，过了就清空。 */
  readonly lastError: Readonly<Ref<ChallengeError | null>>
  /** 最近一次 judge 给的下一步。 */
  readonly next: Readonly<Ref<string>>
  /** 读者的代码和参数：赋值就自动保存。 */
  readonly draft: Ref<unknown>
  attempt(result: AttemptResult): AttemptOutcome
  /** 看答案：没过满 6 次时不给看，返回 false。 */
  revealAnswer(): boolean
  /** 把代码和参数恢复成挑战的默认值（提示进度不变）。 */
  resetDraft(): void
}

/** 页面上带提示的挑战，状态栏的提示按钮从这里挑一个打开。只在浏览器里登记（挂载后），服务端渲染时是空的。 */
const ladders = shallowReactive<Challenge[]>([])
/**
 * 最近一次有动作（尝试、看答案）、带提示的那个。不带提示的不算（Boss 把分题合起来判星的那一个），
 * 免得它盖掉读者刚做的那道分题。shallowRef：Challenge 里有 ref 和 computed，不能被深层代理拆开。
 */
const recent = shallowRef<Challenge | null>(null)

/** 提示按钮打开哪一个：最近动过的；都没动过就是本关的星级挑战或分题；再没有就是第一个。 */
export const activeChallenge = computed<Challenge | null>(() => {
  if (recent.value && ladders.includes(recent.value)) return recent.value
  return ladders.find((c) => c.kind !== 'explore') ?? ladders[0] ?? null
})

/** 草稿写得很频繁（拖滑块、打字），合并成每 300 ms 最多写一次。 */
const SAVE_DELAY = 300

export function useChallenge(options: ChallengeOptions): Challenge {
  const progress = useProgress()
  const kind = options.kind ?? 'challenge'
  const record = reactive<ChallengeRecord>(emptyRecord())
  const lastError = ref<ChallengeError | null>(null)
  const next = ref('')
  let loadedSlot = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const level = computed(() => hintLevel(record.failures))
  /** 副本的挑战：星和经验值按副本的规则记（见文件开头）。 */
  const exercise = exerciseById(options.stage) ?? null
  const cap = computed(() => {
    if (kind === 'explore') return MAX_STARS
    return exercise ? progress.exerciseStarCap(exercise.id) : progress.starCap(options.stage)
  })

  function save() {
    clearTimeout(timer)
    timer = undefined
    if (!loadedSlot) return
    const storage = progressStorage()
    const demo = progress.demo.value
    const slot = loadDraftSlot(storage, options.stage, demo)
    slot[options.id] = { ...record }
    saveDraftSlot(storage, options.stage, slot, demo)
  }

  function saveSoon() {
    clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY)
  }

  /** 从草稿槽读：挂载后读一次；换存档（演示页 ↔ 正式页）、重置、导入存档以后再读一次。 */
  function load() {
    progress.ensureLoaded()
    Object.assign(record, normalizeRecord(loadDraftSlot(progressStorage(), options.stage, progress.demo.value)[options.id]))
    lastError.value = null
    next.value = ''
    loadedSlot = true
  }

  const draft = computed<unknown>({
    get: () => record.draft,
    set: (value) => {
      record.draft = value
      saveSoon()
    },
  })

  const challenge: Challenge = {
    stage: options.stage,
    id: options.id,
    kind,
    hints: options.hints ?? null,
    record: readonly(record) as Readonly<ChallengeRecord>,
    level,
    cap,
    lastError: readonly(lastError),
    next: readonly(next),
    draft,
    attempt(result) {
      const outcome = recordAttempt(record, result)
      lastError.value = outcome.passed ? null : (result.error ?? null)
      next.value = result.next ?? ''
      if (challenge.hints) recent.value = challenge
      // 星只在挑战里发（分题不发，关卡合起来判）；同一颗星进度存档只发一次，重复判星不重复加经验值。
      if (kind === 'challenge') {
        if (exercise) {
          if (outcome.passed) progress.passExercise(exercise.id, exercise.xp, outcome.stars)
        } else {
          for (const index of outcome.stars) progress.awardStar(options.stage, index)
        }
      }
      save()
      return outcome
    },
    revealAnswer() {
      if (!canReveal(record)) return false
      recent.value = challenge
      if (!record.revealed) {
        record.revealed = true
        if (kind !== 'explore') {
          if (exercise) progress.markExerciseAnswerViewed(exercise.id)
          else progress.markAnswerViewed(options.stage)
        }
        save()
      }
      return true
    },
    resetDraft() {
      record.draft = null
      save()
    },
  }

  if (getCurrentInstance()) {
    onMounted(() => {
      load()
      if (challenge.hints) ladders.push(challenge)
    })
    // 存档整份换掉（演示页 ↔ 正式页、重置、导入）时 createdAt 跟着变，草稿槽重新读。
    watch(() => [progress.demo.value, progress.state.createdAt], () => {
      if (loadedSlot) load()
    })
    onBeforeUnmount(() => {
      if (timer) save()
      const index = ladders.indexOf(challenge)
      if (index >= 0) ladders.splice(index, 1)
      if (recent.value === challenge) recent.value = null
    })
  } else {
    // 组件外（单测、脚本）：没有挂载这一步，直接读草稿槽。
    load()
  }

  return challenge
}
