/**
 * 冒险者手册（P-05）的数据和计算：术语索引的分组和排序、搜索、讲它的关卡、速查卡片。
 * 页面在 docs/.vitepress/theme/v2/Handbook.vue，构建时数据在 handbook.data.ts。
 *
 * 手册不手写术语定义：术语的名字、定义、比喻和比喻边界都从 glossary.json 读（05 第 3、4 节），
 * 和关卡里的概念卡是同一份。速查卡片只写公式、常用写法和容易踩的坑，用到的术语按 glossary 的 key 引用，
 * 点过去看定义；讲它的关卡按 outline.json 的 id 引用，那一关还没上线时不给链接（同世界地图）。
 * 卡片里模拟器的示意数从 docs/sim/params.ts 取，这里不另写。
 *
 * 术语条目的锚点是 glossary 的 key（概念卡链到 /handbook/#<key>），页面上别的锚点都带前缀或者是固定的几节，
 * 不能和 key 重名（单测检查）。
 *
 * 纯 TS，node --test 可以直接 import。
 */
import { SIM_PARAMS } from '../sim/params.ts'
import { GLOSSARY, type GlossaryEntry } from './glossary.ts'
import { isPublished, stageHref, STAGES, ZONES, type StageMeta, type ZoneId } from './outline.ts'

/** 页面的四节。 */
export const SECTION_IDS = {
  cheatsheet: 'cheatsheet',
  terms: 'terms',
  analogies: 'analogies',
  setup: 'setup',
} as const

/** RDNA 上一个 wavefront 的线程数（术语表 wavefront 的定义）；模拟器默认也是 32。 */
const WAVE = 32

// ── 术语索引 ────────────────────────────────────────────────────────────

export interface LetterGroup {
  /** A–Z；不是字母也不是汉字开头的放在「#」。 */
  letter: string
  keys: string[]
}

export interface IndexZone {
  zone: ZoneId
  groups: LetterGroup[]
}

/** 拼音的首字母只有这 23 个（没有 i、u、v 开头的音节）。 */
const PINYIN_INITIALS = 'ABCDEFGHJKLMNOPQRSTWXYZ'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const OTHER = '#'

/**
 * 首字母：英文取第一个字母，汉字取拼音的首字母。
 * ICU 的中文排序规则（CLDR zh，按拼音）在每个首字母的第一个汉字前面放了一个「U+FDD0 + 字母」的分界标记，
 * 汉字排在哪两个标记之间，首字母就是哪个。
 */
function initialOf(name: string, collator: Intl.Collator): string {
  const first = name.trim().charAt(0)
  if (/[A-Za-z]/.test(first)) return first.toUpperCase()
  if (!/\p{Script=Han}/u.test(first)) return OTHER
  let letter = OTHER
  for (const l of PINYIN_INITIALS) if (collator.compare(`\uFDD0${l}`, first) <= 0) letter = l
  return letter
}

/**
 * 按拼音排序的中文排序规则。没有中文排序数据的 Node（small-icu 之类）分不出拼音，直接报错，
 * 免得构建出一份乱序的索引。
 */
export function pinyinCollator(collator: Intl.Collator = new Intl.Collator('zh-CN')): Intl.Collator {
  const probes: [string, string][] = [['阿', 'A'], ['并', 'B'], ['计', 'J'], ['在', 'Z']]
  if (probes.some(([ch, letter]) => initialOf(ch, collator) !== letter)) {
    throw new Error('这个 Node 没有中文（拼音）排序数据，排不了冒险者手册的术语索引：请换用带完整 ICU 的 Node（官方安装包默认就是）。')
  }
  return collator
}

/** 同一个字母里，英文写法的术语排在前面（按字母），汉字的在后面（按拼音）。 */
function compareNames(a: string, b: string, collator: Intl.Collator): number {
  const latin = /^[A-Za-z]/
  const la = latin.test(a)
  if (la !== latin.test(b)) return la ? -1 : 1
  return collator.compare(a, b)
}

/**
 * 术语索引：按区域（大纲顺序）分，区域里按首字母分组，组里按拼音 / 字母排。还没登记术语的区域不列。
 * 要用中文排序规则，所以在构建时由 handbook.data.ts 算好，页面直接用结果。
 */
export function termIndex(
  glossary: Readonly<Record<string, Pick<GlossaryEntry, 'term' | 'zone'>>> = GLOSSARY,
  collator: Intl.Collator = pinyinCollator(),
): IndexZone[] {
  return ZONES.flatMap((zone) => {
    const byLetter = new Map<string, string[]>()
    for (const [key, entry] of Object.entries(glossary)) {
      if (entry.zone !== zone.id) continue
      const letter = initialOf(entry.term, collator)
      byLetter.set(letter, [...(byLetter.get(letter) ?? []), key])
    }
    if (!byLetter.size) return []
    const groups = [...LETTERS, OTHER].flatMap((letter) => {
      const keys = byLetter.get(letter)
      return keys ? [{ letter, keys: keys.sort((a, b) => compareNames(glossary[a].term, glossary[b].term, collator)) }] : []
    })
    return [{ zone: zone.id, groups }]
  })
}

/** 字母组的锚点，例如 terms-novice-b；「#」组是 terms-novice-other。 */
export function letterAnchor(zone: string, letter: string): string {
  return `${SECTION_IDS.terms}-${zone}-${letter === OTHER ? 'other' : letter.toLowerCase()}`
}

/** 英文名和中文名只差大小写（Agent / agent）或者完全一样（kernel）时不再写一遍。 */
export function englishName(entry: Pick<GlossaryEntry, 'term' | 'en'>): string {
  return entry.en && entry.en.toLowerCase() !== entry.term.toLowerCase() ? entry.en : ''
}

// ── 搜索 ────────────────────────────────────────────────────────────────

/** 搜索词：全角转半角、转小写，按空白拆开。几段都要出现才算找到（顺序不限）。 */
export function queryTokens(query: string): string[] {
  return query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean)
}

function matches(fields: readonly (string | undefined)[], tokens: readonly string[]): boolean {
  if (!tokens.length) return true
  const text = fields.filter(Boolean).join('\n').normalize('NFKC').toLowerCase()
  return tokens.every((t) => text.includes(t))
}

/** 术语条目：中文名、英文名、key、定义、比喻、比喻边界里出现就算。比喻表的一行跟着它的术语条目显示。 */
export function termMatches(key: string, tokens: readonly string[], glossary: Readonly<Record<string, GlossaryEntry>> = GLOSSARY): boolean {
  const e = glossary[key]
  return Boolean(e) && matches([key, e.term, e.en, e.short, e.analogy, e.analogyLimit], tokens)
}

// ── 讲它的关卡 ──────────────────────────────────────────────────────────

export interface StageLink {
  id: string
  code: string
  title: string
  /** 关卡页地址（不带站点 base）；那一关还没上线（planned / pilot）时是空串，不给链接。 */
  href: string
}

/** 大纲里没有这一关时是 null。 */
export function stageLink(id: string, stages: readonly StageMeta[] = STAGES): StageLink | null {
  const stage = stages.find((s) => s.id === id)
  if (!stage) return null
  return { id, code: stage.code, title: stage.title, href: isPublished(stage) ? stageHref(stage) : '' }
}

// ── 速查卡片 ────────────────────────────────────────────────────────────

export interface CardTable {
  caption: string
  head: string[]
  rows: string[][]
}

export interface CheatCard {
  /** 锚点是 card-<id>。 */
  id: string
  title: string
  /** 讲它的关卡（outline.json 的 id），第一个是主要讲它的那一关。 */
  stages: string[]
  /** 用到的术语（glossary 的 key），点过去看定义。 */
  terms: string[]
  /** 公式，一行一条，等宽显示。 */
  formula?: string[]
  /** 两种写法的同一段代码，按读者的写法偏好显示一份。 */
  code?: { hip: string; python: string }
  table?: CardTable
  /** 用法和容易踩的坑，一条一两句；反引号里的是代码。 */
  notes: string[]
}

export function cardAnchor(id: string): string {
  return `card-${id}`
}

/**
 * 一个 wavefront 的 lane 各读一个数、相邻 lane 隔 stride 个数时，这一次要搬几车。
 * 算法同模拟器 L3（docs/sim/memory.ts）：数组从一车的开头放起，数这些数碰到了几个不同的 cache line。
 */
export function carsForStride(
  stride: number,
  { lanes = WAVE, elemBytes = SIM_PARAMS.elemBytes, lineBytes = SIM_PARAMS.lineBytes }: { lanes?: number; elemBytes?: number; lineBytes?: number } = {},
): number {
  const lines = new Set<number>()
  for (let lane = 0; lane < lanes; lane++) {
    const from = lane * stride * elemBytes
    for (let line = Math.floor(from / lineBytes); line <= Math.floor((from + elemBytes - 1) / lineBytes); line++) lines.add(line)
  }
  return lines.size
}

const STRIDES = [1, 2, 4, 32]

/** 1234567 → 1,234,567（不用 toLocaleString：服务端和浏览器的区域设置可能不同）。 */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** vector add（n = 2^24 个 float）：读 a、b，写 c。 */
const VECTOR_ADD_BYTES = 3 * 2 ** 24 * 4

export const CARDS: CheatCard[] = [
  {
    id: 'global-index',
    title: '全局下标和边界检查',
    stages: ['novice-thread-groups'],
    terms: ['global-index', 'block', 'thread'],
    code: {
      hip: 'int i = blockIdx.x * blockDim.x + threadIdx.x;\nif (i < n) {\n    c[i] = a[i] + b[i];\n}',
      python: 'i = blockIdx.x * blockDim.x + threadIdx.x\nif i < n:\n    c[i] = a[i] + b[i]',
    },
    notes: [
      '派出的线程常常比 n 多，边界检查把多出来的挡在数组外面。',
      '忘了边界检查：多出来的线程会写到数组外面，而且不一定马上报错。',
      '只用 `threadIdx.x` 当下标：每一组都在重复算前几个元素。',
    ],
  },
  {
    id: 'blocks',
    title: '要派几组：向上取整',
    stages: ['novice-thread-groups'],
    terms: ['block', 'grid'],
    formula: ['组数 = ⌈n ÷ 每组线程数⌉'],
    code: {
      hip: 'int threads = 256;\nint blocks = (n + threads - 1) / threads;',
      python: 'threads = 256\nblocks = (n + threads - 1) // threads',
    },
    notes: [
      '直接拿 n 整除每组线程数：除不尽时少派一组，最后几个元素没人算。',
      '向上取整以后，最后一组可能有多出来的线程，靠边界检查挡住。',
    ],
  },
  {
    id: 'waves',
    title: '一组分成几个 wavefront',
    stages: ['novice-wavefront'],
    terms: ['wavefront', 'lane', 'simd'],
    formula: [`wavefront 数 = ⌈每组线程数 ÷ ${WAVE}⌉`],
    notes: [
      `RDNA 原生的 wavefront 是 ${WAVE} 个线程；用 wave64 时把 ${WAVE} 换成 64。`,
      `每组线程数最好取 ${WAVE} 的倍数：48 个线程要分成 2 个 wavefront，第 2 个只有 16 个 lane 干活。`,
    ],
  },
  {
    id: 'divergence',
    title: '分支发散的代价',
    stages: ['novice-divergence'],
    terms: ['branch-divergence', 'exec-mask', 'lane'],
    formula: ['lane 利用率 = 这一步干活的 lane 数 ÷ wavefront 大小'],
    notes: [
      '同一个 wavefront 里，if 和 else 两边都有线程要走：两段先后各执行一遍，耗时约等于两段相加。',
      '按线程编号的奇偶分支，每一段都只有一半 lane 干活。',
      '让同一个 wavefront 的线程走同一边（比如按 wavefront 的编号分支），就不会发散。',
    ],
  },
  {
    id: 'cars',
    title: '一次访存搬几车',
    stages: ['novice-coalescing'],
    terms: ['coalescing', 'cache-line', 'stride'],
    formula: ['车次 = 一个 wavefront 这次读写碰到的 cache line 数'],
    table: {
      caption: `模拟器示意：一车 ${SIM_PARAMS.lineBytes} 字节，一个数 ${SIM_PARAMS.elemBytes} 字节，一个 wavefront ${WAVE} 个 lane。`,
      head: ['访问步长', ...STRIDES.map(String)],
      rows: [['搬几车', ...STRIDES.map((s) => String(carsForStride(s)))]],
    },
    notes: [
      '步长越小，同样多的数挤进越少的车；步长 1 最省。',
      '真卡上一车多少字节：[待实测]。',
    ],
  },
  {
    id: 'sync',
    title: '共享数组和同步',
    stages: ['novice-lds-sync'],
    terms: ['lds', 'barrier', 'race-condition'],
    code: {
      hip: [
        '__shared__ float s[256];',
        's[threadIdx.x] = a[i];     // 先写自己那一格',
        '__syncthreads();           // 等整组都写完',
        'b[i] = s[(threadIdx.x + 1) % blockDim.x];',
      ].join('\n'),
      python: [
        's = shared(256)',
        's[threadIdx.x] = a[i]      # 先写自己那一格',
        'syncthreads()              # 等整组都写完',
        'b[i] = s[(threadIdx.x + 1) % blockDim.x]',
      ].join('\n'),
    },
    notes: [
      '先写、再同步、再读别人的那一格。少了同步，别人可能还没写进去。',
      '同步要放在整组线程都会走到的地方。放进只有一部分线程会走的分支里，模拟器会报错，真机上可能卡住或者算错。',
    ],
  },
  {
    id: 'bandwidth',
    title: '有效带宽怎么算',
    stages: ['novice-timing'],
    terms: ['bandwidth', 'warmup', 'async-launch'],
    formula: ['有效带宽 = 读写的总字节数 ÷ 耗时', 'GB/s = 字节数 ÷ 秒数 ÷ 10⁹'],
    notes: [
      'vector add（n 个 float）：读 a、b，写 c，一共 3 × n × 4 字节。',
      `n = 2²⁴ 时一共 ${grouped(VECTOR_ADD_BYTES)} 字节；耗时 t 毫秒，有效带宽约 ${(VECTOR_ADD_BYTES / 1e6).toFixed(1)} ÷ t GB/s。`,
      '正式计时前先预热几次。kernel 是异步启动的，停表前先同步，等它真的算完；不然测出来的是假加速。',
    ],
  },
  {
    id: 'occupancy',
    title: '占用率的直觉',
    stages: ['novice-latency-hiding', 'trial-occupancy'],
    terms: ['occupancy', 'latency-hiding', 'register', 'lds'],
    notes: [
      '能同时住下几个 wavefront，看寄存器、LDS、wave 名额哪一样先用完。',
      '每个线程用的寄存器越多，一个 SIMD 能同时住下的 wavefront 越少。',
      '每组用的 LDS 越多，能同时住下的组越少。',
      '住下的 wavefront 越多，一个在等数据时，越有别的能顶上，等待越容易藏住。',
      '等待已经藏住以后，再提高占用率，速度不会再明显变快。',
    ],
  },
]

/** 卡片：标题、公式、代码、表格、提醒，以及用到的术语的中英文名里出现就算。 */
export function cardMatches(card: CheatCard, tokens: readonly string[], glossary: Readonly<Record<string, GlossaryEntry>> = GLOSSARY): boolean {
  return matches([
    card.title,
    ...(card.formula ?? []),
    card.code?.hip,
    card.code?.python,
    card.table?.caption,
    ...(card.table ? [...card.table.head, ...card.table.rows.flat()] : []),
    ...card.notes,
    ...card.terms.flatMap((key) => [glossary[key]?.term, glossary[key]?.en]),
  ], tokens)
}

/** 「只用 `threadIdx.x` 当下标」→ 普通文字和代码交替的几段。 */
export function inlineSegments(text: string): { text: string; code: boolean }[] {
  return text.split('`').flatMap((part, i) => (part ? [{ text: part, code: i % 2 === 1 }] : []))
}
