/**
 * 2-5 两个 trace 浏览器和「导入你的 trace」共用的数据（关卡自己的 scenes）。
 * - 参考数据：实验档案馆里这一关最新的真实记录（traces.data.ts），还没有时是示意数据（trace.ts 的 sampleTraceSet）。
 * - 读者导入的 trace 存在本关的草稿槽里（storage.ts；挑战 id 是 TRACE_SLOT，记录的 draft 是 { traces }），刷新不丢；
 *   页面上几个组件读写同一份（模块里的 shallowRef）：在一处导入，两个浏览器都换成读者的数据。
 * - 存档在 onMounted 之后才读得到：挂载之前（服务端渲染、水合）一律用参考数据，水合前后一致（同 2-4 的 usePeak）。
 */
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { loadDraftSlot, saveDraftSlot } from '@course/storage.ts'
import { emptyRecord, normalizeRecord } from '@course/useChallenge.ts'
import { progressStorage, useProgress } from '@course/useProgress.ts'
import { data as archive } from '../traces.data.ts'
import { STAGE_ID, TRACE_SLOT, mergeTraces, sampleTraceSet, storedTraces, type ArchiveTrace, type TraceSet } from '../trace.ts'

/** 参考数据：构建时定好，不随读者变。 */
const reference: TraceSet = archive ?? sampleTraceSet()
/** 读者导入的 trace，按导入的先后；没有是 null。 */
const stored = shallowRef<ArchiveTrace[] | null>(null)
/** 有自己的 trace 时，临时看参考数据（导入的不删）。 */
const showReference = ref(false)
/** 最近一次写草稿槽没写成（太大，或者浏览器不让存）：刷新以后要重新导入。 */
const unsaved = ref(false)

export function useTraces() {
  const progress = useProgress()
  const mounted = ref(false)

  function load() {
    progress.ensureLoaded()
    const record = normalizeRecord(loadDraftSlot(progressStorage(), STAGE_ID, progress.demo.value)[TRACE_SLOT])
    stored.value = storedTraces(record.draft)
  }

  onMounted(() => {
    load()
    mounted.value = true
  })
  // 存档整份换掉（重置、导入存档）时草稿槽也换了，重新读（同 useChallenge）
  watch(() => [progress.demo.value, progress.state.createdAt], () => {
    if (mounted.value) load()
  })

  /** 读者导入的 trace（挂载以后才有）。 */
  const myTraces = computed(() => (mounted.value ? stored.value : null))
  const mine = computed<TraceSet | null>(() => (myTraces.value ? { source: 'mine', entry: null, lines: mergeTraces(myTraces.value) } : null))
  const set = computed(() => (mine.value && !showReference.value ? mine.value : reference))

  /** 换成这些 trace（null 是清掉），写进草稿槽；换了以后先看自己的。 */
  function save(traces: ArchiveTrace[] | null) {
    stored.value = traces
    showReference.value = false
    const storage = progressStorage()
    const demo = progress.demo.value
    const slot = loadDraftSlot(storage, STAGE_ID, demo)
    if (traces) slot[TRACE_SLOT] = { ...emptyRecord(), draft: { traces } }
    else delete slot[TRACE_SLOT]
    unsaved.value = !saveDraftSlot(storage, STAGE_ID, slot, demo)
  }

  return { reference, myTraces, mine, set, showReference, unsaved, save }
}
