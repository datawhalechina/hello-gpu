/**
 * 进度存档的浏览器存储：localStorage 读写、持久化申请、跨标签页同步、下载存档文件。
 *
 * 模块顶层不碰 window / localStorage（09 第 3 节：服务端渲染安全），所有宿主 API 都在函数里，
 * 并且全部 try/catch —— 无痕模式下 localStorage 一碰就抛异常，这时退化成内存存储，
 * 由 notice 告诉读者「本次进度不会保存」。
 */
import {
  emptyState, migratePilot, normalizeState, parseState, PILOT_KEY, PILOT_LANG_KEY,
  type ProgressState,
} from './progress.ts'

export const STORAGE_KEY = 'hg-progress-v2'
/**
 * 演示页（frontmatter `demo: true`，例如 /preview/kit/）用的单独存档：
 * 在演示页上拿的星、锁定的预测都写在这里，不进读者的正式存档。
 */
export const DEMO_STORAGE_KEY = 'hg-progress-demo'
export const UNAVAILABLE_NOTICE = '浏览器存储不可用（可能开着无痕模式），本次进度不会保存。'
const PROBE_KEY = 'hg-probe'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  /** 列出全部键（localStorage 有；清空草稿槽时用，没有就跳过）。 */
  readonly length?: number
  key?(index: number): string | null
}

export interface Backend {
  storage: StorageLike
  kind: 'local' | 'memory'
  /** 存储不可用时给读者看的提示，可用时是空串。 */
  notice: string
}

export function memoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    get length() {
      return map.size
    },
    key: (index) => [...map.keys()][index] ?? null,
  }
}

/** 挑一个能用的存储：真的写一次再删掉，因为有的浏览器是写的时候才抛异常。 */
export function openBackend(): Backend {
  try {
    const local = typeof window === 'undefined' ? null : window.localStorage
    if (local) {
      local.setItem(PROBE_KEY, '1')
      local.removeItem(PROBE_KEY)
      return { storage: local, kind: 'local', notice: '' }
    }
  } catch {
    // 无痕模式、存储被禁用、配额为 0：往下走内存存储
  }
  return { storage: memoryStorage(), kind: 'memory', notice: UNAVAILABLE_NOTICE }
}

export interface LoadResult {
  state: ProgressState
  /** 这次读取把试点存档迁进来了（已经写回存储）。 */
  migrated: boolean
}

/**
 * 读存档：没有就给空档。读正式存档时顺手把试点存档（hg-pilot-v1）迁进来并写回；
 * 演示存档不迁。
 */
export function loadState(storage: StorageLike | undefined, at = Date.now(), key = STORAGE_KEY): LoadResult {
  let state: ProgressState | null = null
  try {
    state = parseState(storage?.getItem(key) ?? null, at)
  } catch {
    state = null
  }
  if (!state) state = emptyState(at)

  let migrated = false
  if (key === STORAGE_KEY) {
    try {
      migrated = migratePilot(state, storage?.getItem(PILOT_KEY) ?? null, storage?.getItem(PILOT_LANG_KEY) ?? null, at)
    } catch {
      migrated = false
    }
  }
  if (migrated) saveState(storage, state, key)
  return { state, migrated }
}

/** 写存档，返回有没有写成功（配额满或存储被禁用时是 false）。 */
export function saveState(storage: StorageLike | undefined, state: ProgressState, key = STORAGE_KEY): boolean {
  try {
    if (!storage) return false
    storage.setItem(key, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function clearState(storage: StorageLike | undefined, key = STORAGE_KEY): boolean {
  try {
    storage?.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * 每关一个草稿槽（F-12；03 第 4 节「自动保存」）：挑战的代码、参数、尝试次数和提示进度，
 * 刷新不丢。键是「前缀 + 关卡 id」，值是「挑战 id → 记录」；演示页用单独的前缀，和演示存档一样不碰正式数据。
 * 草稿只留在这台设备上，不进导出的存档（存档码要能贴进聊天框，代码草稿会把它撑得很长）。
 */
export const DRAFT_PREFIX = 'hg-draft-v1:'
export const DEMO_DRAFT_PREFIX = 'hg-draft-demo:'

export function draftKey(stage: string, demo = false): string {
  return `${demo ? DEMO_DRAFT_PREFIX : DRAFT_PREFIX}${stage}`
}

/** 读一关的草稿槽；没有、损坏或者不是对象时给空槽。 */
export function loadDraftSlot(storage: StorageLike | undefined, stage: string, demo = false): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(storage?.getItem(draftKey(stage, demo)) ?? 'null')
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function saveDraftSlot(storage: StorageLike | undefined, stage: string, slot: Record<string, unknown>, demo = false): boolean {
  try {
    if (!storage) return false
    storage.setItem(draftKey(stage, demo), JSON.stringify(slot))
    return true
  } catch {
    return false
  }
}

/** 清空全部草稿槽（正式或演示的一边），重置进度时一起清。 */
export function clearDrafts(storage: StorageLike | undefined, demo = false): void {
  try {
    if (!storage?.key || typeof storage.length !== 'number') return
    const prefix = demo ? DEMO_DRAFT_PREFIX : DRAFT_PREFIX
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) storage.removeItem(key)
  } catch {
    // 清不掉就算了：草稿只影响挑战的初始状态
  }
}

/** 向浏览器申请持久存储，降低被自动清理的概率（04 第 7 节）。失败只当没申请到。 */
export async function requestPersist(): Promise<boolean> {
  try {
    const store = typeof navigator === 'undefined' ? undefined : navigator.storage
    if (!store?.persist) return false
    if (store.persisted && (await store.persisted())) return true
    return await store.persist()
  } catch {
    return false
  }
}

/** 浏览器有没有同意持久存储（「我的成长」页的存档状态）。只查不申请；不支持这个接口或者查不到时是 null。 */
export async function persistedState(): Promise<boolean | null> {
  try {
    const store = typeof navigator === 'undefined' ? undefined : navigator.storage
    if (!store?.persisted) return null
    return await store.persisted()
  } catch {
    return null
  }
}

/**
 * 跨标签页同步：别的标签页改了存档就把新状态交给 handler。
 * 返回取消订阅的函数；服务端渲染时什么都不做。
 */
export function onStorageSync(handler: (state: ProgressState) => void, key = STORAGE_KEY): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: StorageEvent) => {
    try {
      if (event.key === null) {
        // 别的标签页清空了整个存储
        handler(emptyState())
        return
      }
      if (event.key !== key) return
      const next = parseState(event.newValue)
      handler(next ?? emptyState())
    } catch {
      // 同步失败就保持本标签页现状
    }
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

/** 把存档存成文件下载。返回有没有触发成功。 */
export function downloadSave(fileName: string, text: string): boolean {
  try {
    if (typeof document === 'undefined') return false
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return true
  } catch {
    return false
  }
}

/** 把存档码复制到剪贴板，失败时交给调用方自己提示手动复制。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** 读导入的存档文件。 */
export async function readSaveFile(file: Blob): Promise<string> {
  try {
    return await file.text()
  } catch {
    return ''
  }
}

/** 写入一份导入进来的存档（已经过 importSave 校验）。 */
export function replaceState(
  storage: StorageLike | undefined,
  next: ProgressState,
  at = Date.now(),
  key = STORAGE_KEY,
): ProgressState {
  const state = normalizeState(next, at)
  saveState(storage, state, key)
  return state
}
