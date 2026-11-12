/**
 * 全站共用的进度状态（Vue 组合式函数）。
 *
 * 一份模块级的响应式存档，所有组件共用。服务端渲染时它是一份空档，
 * 读 localStorage 放在 onMounted 之后的 ensureLoaded()，保证首屏 HTML 和客户端首次渲染一致。
 * 纯规则在 progress.ts，存储在 storage.ts，这里只负责「响应式 + 写回 + 广播事件」。
 *
 * 演示页（frontmatter `demo: true`）用单独的演示存档：布局在 setup 里调用 usePageStore()，
 * 页面上的组件照常调用 useProgress()，读写的就是演示存档，读者的正式进度不受影响。
 */
import { computed, getCurrentInstance, getCurrentScope, onMounted, onScopeDispose, reactive, readonly, ref, watch } from 'vue'
import * as core from './progress.ts'
import type { DeviceRecord, ExerciseRecord, Prefs, ProgressEvent, ProgressState, StageProgress } from './progress.ts'
import { earnedBadges, type BadgeContext } from './badges.ts'
import {
  clearDrafts, clearState, loadState, onStorageSync, openBackend, replaceState, requestPersist, saveState,
  downloadSave, copyText, DEMO_STORAGE_KEY, STORAGE_KEY, type Backend, type StorageLike,
} from './storage.ts'

/** 服务端渲染时间是 0，加载后换成存档里的真实时间，避免首屏出现服务端/客户端不一致的内容。 */
const state = reactive<ProgressState>(core.emptyState(0))
const loaded = ref(false)
/** 存储不可用时的提示文案，布局拿它显示横幅。 */
const notice = ref('')
const migratedFromPilot = ref(false)
/** 现在用的是不是演示存档。 */
const demo = ref(false)

let backend: Backend | null = null
let stopSync: (() => void) | null = null

const listeners = new Set<(event: ProgressEvent) => void>()

/**
 * 订阅进度事件：发星、升级、得徽章、收入图鉴、加经验值、改偏好。
 * F-13 的 RewardLayer 用它播奖励。在组件或 effectScope 里调用会自动退订。
 */
export function onProgressEvent(handler: (event: ProgressEvent) => void): () => void {
  listeners.add(handler)
  const off = () => void listeners.delete(handler)
  if (getCurrentScope()) onScopeDispose(off)
  return off
}

/** 正式存档或演示存档的键，读、写、同步都跟着它。 */
const storageKey = computed(() => (demo.value ? DEMO_STORAGE_KEY : STORAGE_KEY))

function persist() {
  if (backend) saveState(backend.storage, state, storageKey.value)
}

function startSync() {
  stopSync?.()
  stopSync = backend?.kind === 'local' ? onStorageSync((next) => Object.assign(state, next), storageKey.value) : null
}

/** 所有写操作都走这里：先落盘，再把事件广播出去。 */
function run(events: ProgressEvent[]): ProgressEvent[] {
  persist()
  for (const event of events) {
    for (const handler of [...listeners]) {
      try {
        handler(event)
      } catch {
        // 一个订阅者出错不影响别人
      }
    }
  }
  return events
}

/** 读存档。只在浏览器里做，重复调用无害。 */
export function ensureLoaded() {
  if (loaded.value || typeof window === 'undefined') return
  backend = openBackend()
  notice.value = backend.notice
  const result = loadState(backend.storage, Date.now(), storageKey.value)
  Object.assign(state, result.state)
  migratedFromPilot.value = result.migrated
  loaded.value = true
  if (backend.kind === 'local') void requestPersist()
  startSync()
}

/**
 * 换用正式存档或演示存档。还没读存档时只记下选择，ensureLoaded 读的就是这一份；
 * 已经读过（站内跳转换页）就整份换成另一份，跨标签页同步也跟着换键。
 */
export function switchStore(toDemo: boolean) {
  if (demo.value === toDemo) return
  demo.value = toDemo
  if (!loaded.value || !backend) return
  Object.assign(state, loadState(backend.storage, Date.now(), storageKey.value).state)
  startSync()
}

/**
 * 布局用：按页面 frontmatter 的 demo 选存档，站内跳转时跟着换。
 * 要在布局的 setup 里调用——它早于正文组件挂载，ensureLoaded 第一次读的就是对的那一份。
 */
export function usePageStore(isDemo: () => boolean) {
  watch(isDemo, switchStore, { immediate: true })
}

/** 测试用：丢掉内存里的状态，下次 ensureLoaded 重新读（相当于刷新页面）。 */
export function unload() {
  stopSync?.()
  stopSync = null
  backend = null
  loaded.value = false
  notice.value = ''
  Object.assign(state, core.emptyState(0))
}

/** 存档用的那个存储（localStorage，或者存储不可用时的内存存储）；挑战的草稿槽（useChallenge）也写在这里。读存档之前是 undefined。 */
export function progressStorage(): StorageLike | undefined {
  return backend?.storage
}

const level = computed(() => core.levelOf(state.xp))
const xpIntoLevel = computed(() => core.xpIntoLevel(state.xp))
const xpToNext = computed(() => core.xpToNext(state.xp))
const summary = computed(() => core.summarize(state))
const remindExport = computed(() => core.shouldRemindExport(state))

export function useProgress() {
  if (getCurrentInstance()) onMounted(ensureLoaded)

  return {
    state,
    loaded,
    notice,
    migratedFromPilot,
    /** 当前页面用的是演示存档（frontmatter demo: true），布局据此提示读者。 */
    demo: readonly(demo),
    level,
    xpIntoLevel,
    xpToNext,
    summary,
    remindExport,
    prefs: state.prefs,

    // 读
    stage: (id: string): StageProgress => core.getStage(state, id),
    stars: (id: string) => core.starsOf(state, id),
    starCap: (id: string) => core.starCapOf(state, id),
    /** 做完检查点时这一关按哪种方式完成：看完了观摩、又没有用真卡拿到星，是观摩（100 XP，不得星）。 */
    completeModeOf: (id: string) => core.completeModeOf(state, id),
    exercise: (id: string): ExerciseRecord => core.getExercise(state, id),
    exerciseStarCap: (id: string) => core.exerciseStarCapOf(state, id),
    hasBadge: (id: string) => Boolean(state.badges[id]),
    hasTerm: (key: string) => Boolean(state.codex[key]),
    prediction: (id: string) => state.predictions[id] ?? null,
    /** 「我的 GPU 卡片」里当前选中的那张；没有时是 null（全景图画本书的实验卡）。 */
    currentDevice: (): DeviceRecord | null => core.currentDevice(state),

    // 写
    completeStage: (id: string, opts?: core.CompleteOptions) => run(core.completeStage(state, id, opts)),
    awardStar: (id: string, index: number) => run(core.awardStar(state, id, index)),
    markAnswerViewed: (id: string) => run(core.markAnswerViewed(state, id)),
    /** 看完了一次观摩回放（L-05 的 LabReplay 调用），之后做完检查点按观摩完成本关。 */
    markReplayed: (id: string) => run(core.markReplayed(state, id)),
    completeAgentSide: (id: string) => run(core.completeAgentSide(state, id)),
    /** 打开了一关（关卡布局在存档读出来以后调用），世界地图的「你在这」看它。 */
    visitStage: (id: string) => run(core.visitStage(state, id)),
    /**
     * 通过一道副本（★1 结果正确）：第一次通过发这道题的经验值，再记下这次拿到的星（副本的星不另给经验值）。
     * 副本挑战（useChallenge）和以后真卡副本的成绩导入都走这里。
     */
    passExercise: (id: string, xp: number, stars: readonly number[] = []) => {
      const events = core.completeExercise(state, id, xp)
      for (const index of stars) core.awardExerciseStar(state, id, index)
      return run(events)
    },
    markExerciseAnswerViewed: (id: string) => run(core.markExerciseAnswerViewed(state, id)),
    /** 打开了一道副本（副本布局在存档读出来以后调用），副本大厅的「进行中」看它。 */
    visitExercise: (id: string) => run(core.visitExercise(state, id)),
    awardBadge: (id: string) => run(core.awardBadge(state, id)),
    /** 按 04 第 4 节的条件判一遍，把新达成的徽章发出去，返回这次发了哪几枚。 */
    checkBadges: (ctx: BadgeContext = {}) => {
      const ids = earnedBadges(state, ctx)
      for (const id of ids) run(core.awardBadge(state, id))
      return ids
    },
    collectTerm: (key: string, stage = '') => run(core.collectTerm(state, key, { stage })),
    recordPrediction: (id: string, choice: number, correct: boolean, stage = '') =>
      run(core.recordPrediction(state, id, choice, correct, { stage })),
    setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => run(core.setPref(state, key, value)),
    applyPlacement: (lv: number, exempt: string[] = []) => run(core.applyPlacement(state, lv, { exempt })),
    /** 存一张 GPU 卡片（device.ts 解出来的）并选为当前；返回新加、更新、一样还是更旧（见 progress.ts 的 saveDevice）。 */
    saveDevice: (record: DeviceRecord) => {
      const saved = core.saveDevice(state, record)
      run([])
      return saved
    },
    selectDevice: (id: string) => {
      const ok = core.selectDevice(state, id)
      run([])
      return ok
    },
    removeDevice: (id: string) => {
      const ok = core.removeDevice(state, id)
      run([])
      return ok
    },

    // 导出 / 导入
    exportSave,
    downloadSave: (at = Date.now()) => {
      const save = exportSave(at)
      return downloadSave(save.fileName, save.json)
    },
    copySaveCode: async (at = Date.now()) => copyText(exportSave(at).code),
    inspectSave: core.importSave,
    applySave,
    resetAll,

    onProgressEvent,
    ensureLoaded,
  }
}

/** 导出存档：同一个时间戳下的 JSON 文件和存档码，并记下 lastExportAt。 */
export function exportSave(at = Date.now()) {
  const json = core.exportJson(state, at)
  const code = core.exportCode(state, at)
  persist()
  return { json, code, fileName: core.exportFileName(at), at }
}

/**
 * 写入导入进来的存档（调用方先用 inspectSave 校验并提示会覆盖）。这台设备迁过的旧存档照样记成迁过：
 * 旧存档的内容已经并进被覆盖的那份进度里了，不记的话，下次读存档会把它再迁一遍，并进刚导入的进度。
 */
export function applySave(next: ProgressState) {
  const merged = { ...next, migrated: { ...state.migrated, ...next.migrated } }
  Object.assign(state, replaceState(backend?.storage, merged, Date.now(), storageKey.value))
}

/** 清空当前这一份存档（正式或演示），连同这一边的挑战草稿槽；偏好和迁移记录留着（见 clearedState）。 */
export function resetAll() {
  const next = core.clearedState(state)
  clearState(backend?.storage, storageKey.value)
  clearDrafts(backend?.storage, demo.value)
  Object.assign(state, next)
  persist()
}
