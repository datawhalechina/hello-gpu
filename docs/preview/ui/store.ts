/**
 * 试点页面的共享状态：语法偏好、进度、经验值提示和试玩日志。
 *
 * 服务端渲染时不读 localStorage；各组件在 onMounted 里调用 ensureLoaded()，
 * 保证首次客户端渲染与服务端 HTML 一致，加载完成后再响应式更新。
 */
import { reactive, ref } from 'vue'
import type { Lang } from '../sim/expr.ts'
import {
  addLog, awardStar, completeStage, emptyState, learnTerm, levelOf, loadState,
  markAnswerViewed, recordPrediction, resetStage, saveState, type PilotState,
} from '../sim/progress.ts'

const LANG_KEY = 'hg-pilot-lang'

export const progress = reactive<PilotState>(emptyState())
export const lang = ref<Lang>('hip')
export const loaded = ref(false)

export interface Toast {
  id: number
  text: string
  kind: 'xp' | 'level' | 'info'
}
export const toasts = reactive<Toast[]>([])
let toastSeq = 0

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export function ensureLoaded() {
  if (loaded.value || typeof window === 'undefined') return
  Object.assign(progress, loadState(storage()))
  try {
    const saved = storage()?.getItem(LANG_KEY)
    if (saved === 'hip' || saved === 'python') lang.value = saved
  } catch {
    // 存储不可用时使用默认语法
  }
  loaded.value = true
}

function persist() {
  saveState(storage(), progress)
}

export function setLang(next: Lang, stage: string) {
  if (lang.value === next) return
  lang.value = next
  try {
    storage()?.setItem(LANG_KEY, next)
  } catch {
    // 忽略
  }
  log(stage, 'lang.change', { lang: next })
}

export function pushToast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastSeq
  toasts.push({ id, text, kind })
  setTimeout(() => {
    const i = toasts.findIndex(t => t.id === id)
    if (i >= 0) toasts.splice(i, 1)
  }, 2600)
}

function gain(amount: number, reason: string) {
  if (!amount) return
  const before = levelOf(progress.xp - amount).level
  pushToast(`+${amount} XP · ${reason}`, 'xp')
  const after = levelOf(progress.xp).level
  if (after > before) pushToast(`升到 Lv.${after}`, 'level')
}

export function log(stage: string, type: string, data?: Record<string, unknown>) {
  addLog(progress, { t: Date.now(), stage, type, data })
  persist()
}

export function earnStar(stage: string, index: number, label: string) {
  const xp = awardStar(progress, stage, index)
  if (xp) {
    log(stage, 'star', { index, label })
    gain(xp, `第 ${index + 1} 颗星`)
  }
  return xp > 0
}

export function finishStage(stage: string) {
  const xp = completeStage(progress, stage)
  if (xp) {
    log(stage, 'stage.complete')
    gain(xp, '完成本关')
  }
}

export function viewAnswer(stage: string, lab: string, capsStars: boolean) {
  if (capsStars) markAnswerViewed(progress, stage)
  log(stage, 'lab.answer', { lab, capsStars })
}

export function lockPrediction(stage: string, id: string, choice: number, correct: boolean) {
  if (recordPrediction(progress, id, choice, correct, Date.now())) {
    log(stage, 'predict.lock', { id, choice, correct })
  }
}

export function collectTerm(stage: string, term: string) {
  if (learnTerm(progress, term)) log(stage, 'codex.learn', { term })
}

export function resetStageProgress(stage: string, predictionIds: string[]) {
  resetStage(progress, stage, predictionIds)
  persist()
}

export function exportLog(stage: string) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      viewport: typeof window === 'undefined' ? null : { w: window.innerWidth, h: window.innerHeight },
      lang: lang.value,
      xp: progress.xp,
      stage: progress.stages[stage] ?? null,
      predictions: progress.predictions,
      codex: progress.codex,
      events: progress.log.filter(e => e.stage === stage),
    },
    null,
    2,
  )
}
