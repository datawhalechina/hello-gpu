/**
 * 1-7 数据住在哪：地图上的地方、给数据挑住处、挑战的代码和判定（纯函数，单测在 scripts/tests/novice-memory-hierarchy.test.mjs）。
 *
 * - 探索一（scenes/FetchTrip.vue）：「取数据」地图。地图上五个地方：工具台（寄存器）、车间货架（LDS）、缓存、
 *   城外仓库（显存）、CPU 内存。点一个地方，线程去那里取一个数，看一趟要等几个周期（模拟）、能装多少、谁拿得到。
 * - 探索二（scenes/PlaceData.vue）：求和工作单里的四个数，读者给每个挑住处，马上看行不行（探索环节，不发星）。
 * - 挑战（scenes/SumSandbox.vue）：add_rows，把 4 排数对齐加起来。工作单里备好了 s（寄存器）、box（LDS）、
 *   out（显存）三个地方，读者补两个空：循环里把和加在哪，最后把哪里的和存进 out[t]。
 *   ★1 32 个和都算对；★2 往返代价降到默认写法的一半以内；★3 降到最少。
 *
 * 往返代价（模拟）：模拟器的事件流里，每个读写显存、LDS 的事件就是这一支小队去那里跑了一趟（取或者存）；
 * 每趟按 params.ts 的 fetchCycles 算（显存 100、LDS 10 个周期，都是示意值）。寄存器里的数不用跑，不算趟数。
 * 两种写法的事件流一样，判定也一样。地图上的容量从 hardware.json 读，都有出处；周期数都是示意值，界面上标「模拟」。
 */
import type { AttemptResult, ChallengeError, Hints } from '../../course/useChallenge.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES, formatParam } from '../../course/hardware.ts'
import type { Arg, SimEvent } from '../../sim/lockstep.ts'
import type { Lang } from '../../sim/syntax/ast.ts'
import { SIM_PARAMS } from '../../sim/params.ts'
import { explainError, type Launch, type SandboxRun } from '../../components/kit/sandbox/run.ts'

export const STAGE_ID = 'novice-memory-hierarchy'

// ── 地图上的地方 ──────────────────────────────────────────────────────────

/** 存数据的地方，按离工位从近到远排。缓存由硬件自己管，挑住处时不能选。 */
export type Place = 'register' | 'lds' | 'cache' | 'vram' | 'host'

export const PLACE_ORDER: readonly Place[] = ['register', 'lds', 'cache', 'vram', 'host']

/** 取一个数，一趟要等几个周期（params.ts 的示意值）。 */
export const FETCH_CYCLES = SIM_PARAMS.fetchCycles

const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID].params

/** 地图上一处的说明。容量从 hardware.json 读（09 第 4 节），周期数是模拟的。 */
export interface PlaceInfo {
  id: Place
  /** 地图上的名字：比喻（术语） */
  name: string
  /** 短名字：旋钮和表格里用 */
  label: string
  /** 在哪 */
  where: string
  /** 谁拿得到 */
  who: string
  /** 能装多少（官方资料） */
  size: string
  /** 取一个数一趟要等几个周期（模拟）；CPU 内存是 null：工作单够不着 */
  cycles: number | null
}

/** 显卡和 CPU 之间的通道，例如 PCIe 5.0 x16。 */
export const BUS = formatParam(HW.bus)
/** 每个线程最多几个寄存器、每个 WGP 的 LDS 多大、显存多大：正文和地图都用这几个数。 */
export const VGPRS = formatParam(HW.vgprsPerThread)
export const LDS_SIZE = formatParam(HW.ldsPerWgp)
export const VRAM_SIZE = formatParam(HW.vramSize)

export const PLACES: Readonly<Record<Place, PlaceInfo>> = {
  register: {
    id: 'register',
    name: '工具台（寄存器）',
    label: '寄存器',
    where: '工位手边',
    who: '只有这个线程',
    size: `每个线程最多 ${VGPRS}，一个装一个数`,
    cycles: FETCH_CYCLES.register,
  },
  lds: {
    id: 'lds',
    name: '车间货架（LDS）',
    label: 'LDS',
    where: 'WGP 里，两间车间合用',
    who: '同一组线程',
    size: `每个 WGP ${LDS_SIZE}`,
    cycles: FETCH_CYCLES.lds,
  },
  cache: {
    id: 'cache',
    name: '缓存',
    label: '缓存',
    where: '芯片上，去显存的路上',
    who: '硬件自己管：留一份取过的数',
    size: `L2 缓存 ${formatParam(HW.l2Cache)}，Infinity Cache ${formatParam(HW.infinityCache)}`,
    cycles: FETCH_CYCLES.cache,
  },
  vram: {
    id: 'vram',
    name: '城外仓库（显存）',
    label: '显存',
    where: '芯片外',
    who: '所有线程',
    size: `${VRAM_SIZE} ${formatParam(HW.vramType)}`,
    cycles: FETCH_CYCLES.vram,
  },
  host: {
    id: 'host',
    name: 'CPU 内存',
    label: 'CPU 内存',
    where: `CPU 那边，隔着 ${BUS}`,
    who: '只有 CPU：工作单够不着',
    size: '看电脑',
    cycles: null,
  },
}

/** 显存一趟是寄存器的几倍（模拟）。 */
export const VRAM_RATIO = FETCH_CYCLES.vram / FETCH_CYCLES.register

// ── 探索一：取数据 ────────────────────────────────────────────────────────

/** 地图上点了一个地方以后的那一句（03 第 1 节第 4 条：一句话解读）。 */
export function fetchText(place: Place): string {
  const c = FETCH_CYCLES
  switch (place) {
    case 'register':
      return `工具台（寄存器）上的数随手就拿：一趟 ${c.register} 个周期（模拟）。可它只归这一个线程，每个线程最多 ${VGPRS}。`
    case 'lds':
      return `车间货架（LDS）：一趟 ${c.lds} 个周期（模拟），是工具台的 ${c.lds / c.register} 倍。同一组线程都拿得到，每个 WGP 一共 ${LDS_SIZE}。`
    case 'cache':
      return `缓存里正好留着一份：一趟 ${c.cache} 个周期（模拟）。缓存由硬件自己管，取过的数它会留一份；没留下的，还得去显存。`
    case 'vram':
      return `城外仓库（显存）：一趟 ${c.vram} 个周期（模拟），是工具台的 ${VRAM_RATIO} 倍。所有线程都拿得到，能装 ${VRAM_SIZE}。`
    case 'host':
      return `CPU 内存，工作单够不着：先用 hipMemcpy（Python 风格是 to_device）把整排数拷进显存，走的是 ${BUS}。拷进来以后，再从显存取。`
  }
}

// ── 探索二：给数据挑住处 ──────────────────────────────────────────────────

/** 求和工作单里的四个数。 */
export type DataId = 'input' | 'partial' | 'handoff' | 'result'

export const DATA_ORDER: readonly DataId[] = ['input', 'partial', 'handoff', 'result']

/** 要加的数有多少个，一个 float 4 字节（同 1-2）。 */
export const INPUT_COUNT = 1_000_000
const INPUT_MB = (INPUT_COUNT * 4) / 1_000_000

export interface DataItem {
  id: DataId
  /** 地图上的小标签 */
  tag: string
  /** 是什么 */
  name: string
  /** 谁要用、用几次 */
  detail: string
}

export const DATA_ITEMS: Readonly<Record<DataId, DataItem>> = {
  input: { id: 'input', tag: 'a', name: `a：要加的 ${INPUT_COUNT / 10_000} 万个数`, detail: `一共 ${INPUT_MB} MB，一开始在 CPU 那边；每个线程读其中几个。` },
  partial: { id: 'partial', tag: 's', name: 's：自己加到一半的和', detail: '每个线程一个，每加一个数就要用一次。' },
  handoff: { id: 'handoff', tag: '交接', name: '交接的和：组里每人一个', detail: '一组 32 个线程各交一个 s，0 号线程要把它们加起来。' },
  result: { id: 'result', tag: '总和', name: '总和', detail: '算完以后 CPU 要用。' },
}

/** 挑住处时能选的地方：缓存由硬件自己管，不在里面。 */
export const PICKABLE: readonly Place[] = ['register', 'lds', 'vram', 'host']

/** best：最合适；ok：能用，但离工位远；no：放不下、拿不到或者够不着。 */
export type Fit = 'best' | 'ok' | 'no'

export interface PlaceVerdict {
  fit: Fit
  text: string
}

export type Placement = Record<DataId, Place>

/** 默认「能跑但不好」（03 第 1 节第 3 条）：全放城外仓库。都能算对，可 s 和交接的和每用一次都要跑一趟仓库。 */
export const DEFAULT_PLACEMENT: Readonly<Placement> = { input: 'vram', partial: 'vram', handoff: 'vram', result: 'vram' }

/** 每个数最合适的地方（单测核对每个数正好有一处是 best）。 */
export const BEST_PLACEMENT: Readonly<Placement> = { input: 'vram', partial: 'register', handoff: 'lds', result: 'vram' }

const UNREACHABLE = '工作单够不着 CPU 内存：要先拷进显存。'

/** 一个数放在一个地方行不行，为什么（03 第 4 节：说清哪里不行、为什么）。 */
export function placeVerdict(data: DataId, place: Place): PlaceVerdict {
  const c = FETCH_CYCLES
  if (place === 'cache') return { fit: 'no', text: '缓存选不了：留哪些数由硬件自己定。' }
  switch (data) {
    case 'input':
      if (place === 'register') return { fit: 'no', text: `放不下：每个线程最多 ${VGPRS}寄存器，a 有 ${INPUT_COUNT / 10_000} 万个数。` }
      if (place === 'lds') return { fit: 'no', text: `放不下：LDS 每个 WGP 才 ${LDS_SIZE}，a 有 ${INPUT_MB} MB。` }
      if (place === 'vram') return { fit: 'best', text: `放得下（${VRAM_SIZE}），所有线程都拿得到。从 CPU 那边拷进来一次就行。` }
      return { fit: 'no', text: UNREACHABLE }
    case 'partial':
      if (place === 'register') return { fit: 'best', text: `离工位最近：每用一次只要 ${c.register} 个周期（模拟）。s 只有自己用，放工具台正好。` }
      if (place === 'lds') return { fit: 'ok', text: `能用，可每用一次要 ${c.lds} 个周期（模拟）。货架是一组合用的，自己用的数不用放那儿。` }
      if (place === 'vram') return { fit: 'ok', text: `能用，可每用一次都要跑一趟城外仓库：${c.vram} 个周期（模拟）。` }
      return { fit: 'no', text: UNREACHABLE }
    case 'handoff':
      if (place === 'register') return { fit: 'no', text: '0 号线程拿不到：工具台只归自己，别的线程看不见。' }
      if (place === 'lds') return { fit: 'best', text: `同一组都拿得到，又在芯片上：一趟 ${c.lds} 个周期（模拟）。` }
      if (place === 'vram') return { fit: 'ok', text: `能用，大家都拿得到；可一趟 ${c.vram} 个周期（模拟），比货架远得多。` }
      return { fit: 'no', text: UNREACHABLE }
    case 'result':
      if (place === 'register') return { fit: 'no', text: 'CPU 拿不到：工作单做完，工具台上的数就没了。' }
      if (place === 'lds') return { fit: 'no', text: 'CPU 拿不到：这一组做完，货架上的数就没了。' }
      if (place === 'vram') return { fit: 'best', text: '写进显存，算完再拷回 CPU（hipMemcpy，Python 风格是 to_host）。' }
      return { fit: 'no', text: '工作单写不到 CPU 内存：先写进显存，再拷回去。' }
  }
}

/** 草稿或旧数据里读出来的住处可能不认识：不认识的用默认值。 */
export function normalizePlacement(raw: unknown): Placement {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = { ...DEFAULT_PLACEMENT }
  for (const id of DATA_ORDER) {
    const v = src[id]
    if (typeof v === 'string' && (PICKABLE as readonly string[]).includes(v)) out[id] = v as Place
  }
  return out
}

/** 四个数一起看：几个最合适、几个能用但远、几个不行，下面那一句话。 */
export function placementSummary(placement: Readonly<Placement>): { best: number; ok: number; no: number; text: string } {
  let best = 0
  let ok = 0
  let no = 0
  for (const id of DATA_ORDER) {
    const fit = placeVerdict(id, placement[id]).fit
    if (fit === 'best') best++
    else if (fit === 'ok') ok++
    else no++
  }
  const total = DATA_ORDER.length
  let text: string
  if (best === total) text = `${total} 个数都住对了：自己用的放工具台，组里交接的放货架，大家都要的、CPU 要拿回的放显存。`
  else if (no) text = `有 ${no} 个数住不下、拿不到或者够不着，先把它们挪走。`
  else text = `${total} 个数都能用。还有 ${ok} 个住得太远：每用一次都要多等，挪近一点试试。`
  return { best, ok, no, text }
}

// ── 挑战：4 排数加起来 ────────────────────────────────────────────────────

/** 每排 32 个数，派 1 组 32 个线程（正好一支小队），一个线程管一列。 */
export const SUM_N = 32
/** 4 排。 */
export const SUM_M = 4
export const SUM_LAUNCH: Launch = { grid: 1, block: SUM_N }

/** add_rows：s 在工具台（寄存器），box 在车间货架（LDS），a、out 在城外仓库（显存）。add、save 是两个空。 */
function rowsCode(add: string, save: string): Record<Lang, string> {
  return {
    hip: `__global__ void add_rows(float* a, float* out, int n, int m) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    float s = 0;                // 工具台（寄存器）
    __shared__ float box[32];   // 车间货架（LDS）
    for (int k = 0; k < m; k++) {
        ${add};
    }
    ${save};
}`,
    python: `@kernel
def add_rows(a, out, n, m):
    t = blockIdx.x * blockDim.x + threadIdx.x
    s = 0.0              # 工具台（寄存器）
    box = shared(32)     # 车间货架（LDS）
    for k in range(m):
        ${add}
    ${save}`,
  }
}

/** 第 k 排的第 t 个数在 a[k * n + t]。 */
export const NEXT_NUMBER = 'a[k * n + t]'

/** 初始内容「能跑但不好」：和直接加在显存的 out[t] 上，最后再把 s（还是 0）加进去。算得对，可每轮都跑三趟仓库。 */
export const DEFAULT_ADD = `out[t] = out[t] + ${NEXT_NUMBER}`
export const DEFAULT_SAVE = 'out[t] = out[t] + s'
export const SUM_CODE = rowsCode(`[[add: ${DEFAULT_ADD}]]`, `[[save: ${DEFAULT_SAVE}]]`)

/** 手机上的选项：加在仓库、货架、工具台三处的写法都有，再加一个「没加上去」的。 */
export const SUM_BLANKS = {
  add: {
    label: '循环里：把取来的数加到哪',
    choices: [DEFAULT_ADD, `box[threadIdx.x] = box[threadIdx.x] + ${NEXT_NUMBER}`, `s = s + ${NEXT_NUMBER}`, `s = ${NEXT_NUMBER}`],
  },
  save: {
    label: '最后：存进 out[t] 的是',
    choices: [DEFAULT_SAVE, 'out[t] = box[threadIdx.x]', 'out[t] = s'],
  },
}

/** 第 k 排是 a[k * n] 到 a[k * n + n − 1]：a[j] = j + 1，和 1-3～1-6 一样从 1 数起；out 一开始全是 0。 */
export function rowsArgs(n = SUM_N, m = SUM_M): Record<string, Arg> {
  return {
    a: { type: 'float', data: Array.from({ length: n * m }, (_, j) => j + 1) },
    out: { type: 'float', data: new Array<number>(n).fill(0) },
    n: { type: 'int', value: n },
    m: { type: 'int', value: m },
  }
}

/** 第 t 列的和：a[t] + a[n + t] + … + a[(m − 1)n + t]。 */
export function expectedSums(n = SUM_N, m = SUM_M): number[] {
  return Array.from({ length: n }, (_, t) => {
    let s = 0
    for (let k = 0; k < m; k++) s += k * n + t + 1
    return s
  })
}

/** 启动那一行（1-2 定的写法）。 */
export function launchLine(lang: Lang): string {
  return lang === 'hip'
    ? `add_rows<<<${SUM_LAUNCH.grid}, ${SUM_LAUNCH.block}>>>(d_a, d_out, ${SUM_N}, ${SUM_M});`
    : `add_rows[${SUM_LAUNCH.grid}, ${SUM_LAUNCH.block}](d_a, d_out, ${SUM_N}, ${SUM_M})`
}

// ── 往返代价 ──────────────────────────────────────────────────────────────

/** 一处跑了几趟：取（读）几趟，存（写、原子加）几趟。 */
export interface Legs {
  load: number
  store: number
}

export interface Trips {
  vram: Legs
  lds: Legs
}

/** 数一串事件里，这支小队去显存、LDS 各跑了几趟：每个读写显存、LDS 的事件是一趟。 */
export function tripsOf(events: readonly SimEvent[]): Trips {
  const trips: Trips = { vram: { load: 0, store: 0 }, lds: { load: 0, store: 0 } }
  for (const e of events) {
    if (!e.space) continue
    const legs = e.space === 'global' ? trips.vram : trips.lds
    if (e.op === 'load') legs.load++
    else legs.store++
  }
  return trips
}

export function tripCount(legs: Legs): number {
  return legs.load + legs.store
}

/** 往返代价（模拟）：显存每趟 fetchCycles.vram 个周期，LDS 每趟 fetchCycles.lds 个周期；寄存器不用跑，不算。 */
export function costOf(trips: Trips): number {
  return tripCount(trips.vram) * FETCH_CYCLES.vram + tripCount(trips.lds) * FETCH_CYCLES.lds
}

/** 默认写法：每轮取 out[t]、取 a、存 out[t] 三趟，最后取 out[t]、存 out[t] 两趟，都在显存（单测核对和模拟器数的一样）。 */
export const DEFAULT_COST = (3 * SUM_M + 2) * FETCH_CYCLES.vram
/** ★2：降到默认写法的一半以内。 */
export const TARGET_COST = DEFAULT_COST / 2
/** ★3：最少。4 个数各从显存取一趟，和存一趟，中间的和一直在寄存器里。 */
export const BEST_COST = (SUM_M + 1) * FETCH_CYCLES.vram

export const STAR_LABELS = [
  `${SUM_N} 个和都算对`,
  `往返代价（模拟）降到 ${TARGET_COST} 个周期以内，是默认写法的一半`,
  `往返代价降到最少（${BEST_COST} 个周期）：中间的和放在离工位最近的地方，一趟也不多跑`,
] as const

/** 「城外仓库 14 趟（取 9、存 5）」「车间货架 9 趟（取 5、存 4）」；没去过的不写。 */
export function tripText(trips: Trips): string {
  const parts: string[] = []
  const one = (name: string, legs: Legs) => {
    const n = tripCount(legs)
    if (n) parts.push(`${name} ${n} 趟（取 ${legs.load}、存 ${legs.store}）`)
  }
  one('城外仓库', trips.vram)
  one('车间货架', trips.lds)
  return parts.length ? parts.join('，') : '一趟也没跑'
}

export const HINTS: Hints = {
  direction: '和在循环里一个一个加：加在哪，每一轮就要往那里跑一趟。回想地图：哪里离工位最近？',
  location: '两个空都要改：循环里把取来的数加到工具台的 s 上；最后一行把 s 存进 out[t]。',
  answer: `循环里写 s = s + ${NEXT_NUMBER}，最后一行写 out[t] = s：${SUM_M} 个数各取一趟，和存一趟，往返代价 ${BEST_COST} 个周期（模拟）。`,
}

// ── 判定 ─────────────────────────────────────────────────────────────────

/** 和加在哪：工具台的 s、货架的 box、仓库的 out[t]。 */
type Spot = 'register' | 'lds' | 'vram'
/** 最后一行从哪拿和：工具台的 s，或者货架上的 box。 */
type Source = Exclude<Spot, 'vram'>

const SPOT_NAME: Record<Spot, string> = {
  register: '工具台的 s',
  lds: '货架上的 box',
  vram: '仓库里的 out[t]',
}

/** 最后一行拿错了地方，拿到的为什么是 0。模拟器里货架一开始是 0，真卡上不会清零，所以只说「没放过数」（08 第 4 节）。 */
const SOURCE_EMPTY: Record<Source, string> = {
  register: 's 一直是 0',
  lds: 'box 上没放过数',
}

/**
 * 从事件里看出两件事：循环里把和存到了哪（循环那一行有没有写显存、写 LDS；都没写就是加在寄存器上），
 * 最后一行读了哪（读 LDS 就是 box；不读 LDS 就是 s，可能再加上读回来的 out[t]）。
 * 循环那一行是 for 的判断那一行的下一行（两种写法都是），最后一行在它后面。
 */
function shapeOf(events: readonly SimEvent[]): { acc: Spot | null; saved: boolean; from: Source } {
  const branch = events.find((e) => e.op === 'branch')
  const body = branch ? branch.line + 1 : -1
  const inLoop = events.filter((e) => e.line === body && e.space && e.op !== 'load')
  const after = events.filter((e) => e.line > body && e.space)
  let acc: Spot | null = 'register'
  if (inLoop.some((e) => e.space === 'global' && e.array === 'out')) acc = 'vram'
  else if (inLoop.some((e) => e.space === 'lds')) acc = 'lds'
  else if (inLoop.length) acc = null
  const saved = after.some((e) => e.op !== 'load' && e.space === 'global' && e.array === 'out')
  const from: Source = after.some((e) => e.op === 'load' && e.space === 'lds') ? 'lds' : 'register'
  return { acc, saved, from }
}

/** 一串数写成「[196, 200, 204, …]」：太长只写前 8 个。 */
function listText(values: readonly number[]): string {
  const head = values.slice(0, 8).join(', ')
  return `[${head}${values.length > 8 ? ', …' : ''}]`
}

/**
 * 32 个和算对了没有；没算对时写成「现象 / 原因 / 怎么改」（03 第 4 节）。按这个顺序找原因：
 * 每轮把和换成了新取来的数（只剩最后一排）；和全是 0（循环加在一处，最后存的是另一处）；别的。
 */
function wrong(run: SandboxRun): ChallengeError | null {
  const { result } = run
  if (!result.ok) return explainError(result.error)
  const out = result.arrays.out ?? []
  const want = expectedSums()
  const bad = want.flatMap((v, t) => (out[t] === v ? [] : [t]))
  if (!bad.length) return null

  const t0 = bad[0]
  const symptom = `${bad.length} 个和不对：out[${t0}] 应该是 ${want[t0]}，算出来是 ${out[t0] ?? 0}。`
  const raw = `运行后 out = ${listText(out)}\n应该是 ${listText(want)}`
  const last = want.map((_, t) => (SUM_M - 1) * SUM_N + t + 1)

  if (out.every((v, t) => v === last[t])) {
    return {
      symptom,
      cause: '每一轮都把和换成了新取来的数，没有加上去，最后只剩第 4 排的数。',
      fix: `加的时候带上原来的和：比如 s = s + ${NEXT_NUMBER}。`,
      raw,
    }
  }
  if (out.every((v) => v === 0)) {
    const { acc, saved, from } = shapeOf(result.events)
    if (!saved) {
      return { symptom, cause: '最后一行没有把和存进 out[t]。', fix: '最后一行写成 out[t] = 循环里加出来的那个和。', raw }
    }
    if (acc && acc !== from) {
      const cause = acc === 'vram'
        ? `循环把和加在仓库里的 out[t] 上，最后一行却用${SPOT_NAME[from]} 把它盖掉了：${SOURCE_EMPTY[from]}。`
        : `循环把和加在${SPOT_NAME[acc]} 上，最后存进 out[t] 的却是${SPOT_NAME[from]}：${SOURCE_EMPTY[from]}。`
      return { symptom, cause, fix: '最后一行要存的，是循环里加出来的那个和：两个空要说的是同一个地方。', raw }
    }
  }
  return {
    symptom,
    cause: '循环里加出来的和，没有原样存进 out[t]。',
    fix: `循环里把 ${NEXT_NUMBER} 加到一个地方，最后一行把那里的和存进 out[t]。`,
    raw,
  }
}

/**
 * 挑战的星级判定（06 第 7 节）：runs[0] 是 4 排数、派 32 个线程的那一次。★1 不成立时一颗都不发，
 * 并给出「现象 / 原因 / 怎么改」；★2 看往返代价不超过 TARGET_COST；★3 看等于 BEST_COST（最少）。
 */
export function judge(runs: readonly SandboxRun[]): AttemptResult {
  const [main] = runs
  const error = wrong(main)
  if (error) return { earned: [false, false, false], next: error.fix, error }
  const trips = tripsOf(main.result.events)
  const cost = costOf(trips)
  const spent = `往返代价 ${cost} 个周期（模拟）：${tripText(trips)}。`
  if (cost > TARGET_COST) {
    const loopVram = shapeOf(main.result.events).acc === 'vram'
    return {
      earned: [true, false, false],
      next: loopVram
        ? `${spent}循环里每加一个数，都要去仓库取 out[t]、再存回去。把和挪到离工位近的地方，最后存一趟 out[t] 就够了。`
        : `${spent}还要降到 ${TARGET_COST} 个周期以内：看看哪几趟是可以不跑的。`,
    }
  }
  if (cost > BEST_COST) {
    const extraRead = trips.vram.load > SUM_M
    let why = '还能再少：看看哪几趟是可以不跑的。'
    if (tripCount(trips.lds)) why = '货架比仓库近，可 s 只有自己用：放工具台，一趟都不用跑。'
    else if (extraRead) why = '最后一行还去仓库取了一趟 out[t]。它一开始是 0，不用取，直接存 s。'
    return { earned: [true, true, false], next: `${spent}${why}` }
  }
  return {
    earned: [true, true, true],
    next: `${spent}${SUM_M} 个数各取一趟，和存一趟，中间的和一直在工具台上。三颗星的标准都达到了。`,
  }
}
