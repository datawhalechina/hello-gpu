/**
 * 1-1 一千道加法：分工竞速的比赛规则、挑战「今天的五张单子」和星级判定。纯函数，单测在
 * scripts/tests/novice-thousand-additions.test.mjs（06 第 7 节）。
 *
 * 这一关不用模拟器（大纲 sim: []）。比赛规则就是下面三个数，全部是模拟，不是真实 CPU、GPU 的速度：
 * 教授 1 拍算完一道加法；学徒 4 拍算完一道，但 1000 个学徒可以同时开工。
 *
 * 两种题，对应新手村的两个例子：
 * - 逐个相加（向量加法 c[i] = a[i] + b[i]）：每一道只用自己那一对数，可以拆给学徒同时做。
 * - 累加（求和 s = s + a[i]）：每一步要用上一步的和。学徒那边只能派 1 个人从头加到尾；
 *   要是硬拆给 1000 个人同时做，谁也拿不到上一步的和，交上来的结果是错的（挑战里的 ★1 看这一点）。
 *
 * 动画只读这里的纯函数：某一拍时两边各做完几道、有几个人在算（02 第 5 节：画面是时间的纯函数）。
 */
import type { Lang } from '../../course/progress.ts'

/** 这一关在大纲里的 id。 */
export const STAGE_ID = 'novice-thousand-additions'

// ── 比赛规则（模拟）──────────────────────────────────────────────────────

/** 教授算一道要几拍。 */
export const PROF_BEATS = 1
/** 学徒算一道要几拍。 */
export const CREW_BEATS = 4
/** 学徒一共几个。 */
export const CREW_SIZE = 1000

/** add：逐个相加（每道互不相关）；sum：累加（每一步要用上一步的和）。 */
export type Kind = 'add' | 'sum'

export const KIND_OPTIONS: readonly { value: Kind; label: string }[] = [
  { value: 'add', label: '逐个相加' },
  { value: 'sum', label: '累加' },
]

/** 探索一可以选的题目数量。 */
export const RACE_COUNTS = [1, 10, 100, 1000, 10000] as const

export interface Race {
  /** 一共几道加法（累加 n 个数也按 n 道算：从 0 开始，每加一个数是一道）。 */
  n: number
  kind: Kind
}

/** 一方的成绩：几拍交卷，最多同时有几个人在算。 */
export interface Lap {
  beats: number
  workers: number
}

const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/** 教授：一道接一道。两种题对他一样。 */
export function profLap(n: number): Lap {
  const total = count(n)
  return { beats: total * PROF_BEATS, workers: total > 0 ? 1 : 0 }
}

/** 学徒：逐个相加时按轮做，每轮最多 1000 人同时动笔；累加时只能 1 个人从头加到尾。 */
export function crewLap(race: Race): Lap {
  const total = count(race.n)
  if (total === 0) return { beats: 0, workers: 0 }
  if (race.kind === 'sum') return { beats: total * CREW_BEATS, workers: 1 }
  return { beats: Math.ceil(total / CREW_SIZE) * CREW_BEATS, workers: Math.min(total, CREW_SIZE) }
}

/** 比赛要画到第几拍：两边都交卷为止。 */
export function raceEnd(race: Race): number {
  return Math.max(profLap(race.n).beats, crewLap(race).beats)
}

/** 某一拍时一方的样子：做完了几道，这一拍有几个人在算（交卷以后是 0）。 */
export interface Snapshot {
  done: number
  busy: number
  finished: boolean
}

export function profAt(n: number, t: number): Snapshot {
  const total = count(n)
  const done = Math.min(total, Math.max(0, Math.floor(t / PROF_BEATS)))
  return { done, busy: done < total ? 1 : 0, finished: done >= total }
}

/** 学徒那边还要知道：到这一拍为止，有几个学徒做完过题（画面上和一直闲着的人分开画）。 */
export interface CrewSnapshot extends Snapshot {
  worked: number
}

export function crewAt(race: Race, t: number): CrewSnapshot {
  const total = count(race.n)
  if (race.kind === 'sum') {
    const done = Math.min(total, Math.max(0, Math.floor(t / CREW_BEATS)))
    return { done, busy: done < total ? 1 : 0, worked: done > 0 ? 1 : 0, finished: done >= total }
  }
  const rounds = Math.max(0, Math.floor(t / CREW_BEATS))
  const done = Math.min(total, rounds * CREW_SIZE)
  return {
    done,
    busy: Math.min(CREW_SIZE, total - done),
    worked: done > 0 ? Math.min(total, CREW_SIZE) : 0,
    finished: done >= total,
  }
}

/** 探索环节的一句话解读（03 第 1 节第 4 条：参数一变就给可视化和一句解读）。 */
export function describeRace(race: Race): string {
  const n = count(race.n)
  const prof = profLap(n).beats
  const crew = crewLap(race)
  if (race.kind === 'sum') {
    return `累加 ${n} 个数：教授一步接一步，${prof} 拍算完；学徒每一步都要等上一步的和，只能派 1 个人从头加到尾，要 ${crew.beats} 拍，另外 ${CREW_SIZE - 1} 个人帮不上忙。`
  }
  if (crew.beats < prof) {
    const rounds = Math.ceil(n / CREW_SIZE)
    const how = rounds > 1
      ? `学徒分 ${rounds} 轮，每轮 ${CREW_SIZE} 人同时动笔`
      : `${crew.workers} 个学徒同时动笔`
    // 「是学徒的 2.5 倍」：最多一位小数
    const ratio = Number((prof / crew.beats).toFixed(1))
    return `${n} 道加法：${how}，${crew.beats} 拍交卷；教授一道接一道，要 ${prof} 拍，是学徒的 ${ratio} 倍。`
  }
  if (crew.beats === prof) return `${n} 道加法：两边都是 ${prof} 拍，打平。`
  return `${n} 道加法：教授 ${prof} 拍就交卷；学徒一道也要 ${crew.beats} 拍，${CREW_SIZE} 个人里只有 ${crew.workers} 个有活干，人多帮不上忙。`
}

// ── 挑战：今天的五张单子 ──────────────────────────────────────────────────

/** prof：交给教授，一道接一道；crew：拆开交给 1000 个学徒，每人一道、同时开工。 */
export type Who = 'prof' | 'crew'

export const WHO_OPTIONS: readonly { value: Who; label: string }[] = [
  { value: 'prof', label: '教授' },
  { value: 'crew', label: '1000 个学徒' },
]

export interface Job {
  id: string
  /** 单子上的一句话。 */
  title: string
  /** 再说清楚一点：每一道用到哪些数。 */
  detail: string
  /** 一共几道加法。 */
  n: number
  /** 每一步要不要用上一步算出来的结果（数据依赖）。单测从两种写法的代码里各分析一遍，和它核对。 */
  dependent: boolean
  /** 有依赖的单子拆给学徒同时做，交上来的是什么样（★1 没过时的「现象」）。 */
  splitResult?: string
  /** 代码里用到的数组，单测把代码包成 kernel 解析时当参数。 */
  arrays: readonly string[]
  /** 两种写法的同一段代码（06 第 5 节），解析出来的语法树必须相同。 */
  code: Record<Lang, string>
}

export const JOBS: readonly Job[] = [
  {
    id: 'add-1000',
    title: '1000 对数逐个相加',
    detail: 'c 的每一格 = a 的这一格 + b 的这一格。',
    n: 1000,
    dependent: false,
    arrays: ['a', 'b', 'c'],
    code: {
      hip: 'for (int i = 0; i < 1000; i++) {\n    c[i] = a[i] + b[i];\n}',
      python: 'for i in range(1000):\n    c[i] = a[i] + b[i]',
    },
  },
  {
    id: 'sum-1000',
    title: '把 1000 个数加成一个总和',
    detail: 's 从 0 开始，把 a 里的数一个一个加进去。',
    n: 1000,
    dependent: true,
    splitResult: '1000 个学徒拿到的 s 都还是 0，各自只加了自己那一个数，交上来的总和只是其中一个数。',
    arrays: ['a'],
    code: {
      hip: 'float s = 0;\nfor (int i = 0; i < 1000; i++) {\n    s = s + a[i];\n}',
      python: 's = 0.0\nfor i in range(1000):\n    s = s + a[i]',
    },
  },
  {
    id: 'add-2',
    title: '2 对数逐个相加',
    detail: '和单子 1 一样，只是只有 2 对。',
    n: 2,
    dependent: false,
    arrays: ['a', 'b', 'c'],
    code: {
      hip: 'for (int i = 0; i < 2; i++) {\n    c[i] = a[i] + b[i];\n}',
      python: 'for i in range(2):\n    c[i] = a[i] + b[i]',
    },
  },
  {
    id: 'neighbor',
    title: '每个数加上它后面那个数',
    detail: 'd 的每一格 = a 的这一格 + a 的下一格，一共 1000 格。',
    n: 1000,
    dependent: false,
    arrays: ['a', 'd'],
    code: {
      hip: 'for (int i = 0; i < 1000; i++) {\n    d[i] = a[i] + a[i + 1];\n}',
      python: 'for i in range(1000):\n    d[i] = a[i] + a[i + 1]',
    },
  },
  {
    id: 'running',
    title: '算累计和',
    detail: 'p 的下一格 = p 的这一格 + a 的这一格，一共 1000 格。',
    n: 1000,
    dependent: true,
    splitResult: '每个学徒拿到的「p 的这一格」还没人算好，除了第一格，加出来的都不是累计和。',
    arrays: ['a', 'p'],
    code: {
      hip: 'for (int i = 0; i < 1000; i++) {\n    p[i + 1] = p[i] + a[i];\n}',
      python: 'for i in range(1000):\n    p[i + 1] = p[i] + a[i]',
    },
  },
]

/** 默认值「能跑但不好」（03 第 1 节第 3 条）：全交给教授，结果都对，就是慢。 */
export const DEFAULT_PICKS: readonly Who[] = JOBS.map(() => 'prof')

/** 草稿槽里读出来的派法可能是旧版本或被手改坏：长度不对、值不认识的地方用默认值。 */
export function normalizePicks(raw: unknown): Who[] {
  const list = Array.isArray(raw) ? raw : []
  return JOBS.map((_, i) => (list[i] === 'crew' || list[i] === 'prof' ? list[i] : DEFAULT_PICKS[i]))
}

export interface JobOutcome {
  /** 第几张单子（0 起）。 */
  index: number
  job: Job
  who: Who
  beats: number
  correct: boolean
}

/** 一张单子交给谁、用几拍、结果对不对。有依赖的单子拆给学徒：几拍就交卷了，但结果是错的。 */
export function runJob(job: Job, who: Who, index = JOBS.indexOf(job)): JobOutcome {
  if (who === 'prof') return { index, job, who, beats: job.n * PROF_BEATS, correct: true }
  return { index, job, who, beats: Math.ceil(job.n / CREW_SIZE) * CREW_BEATS, correct: !job.dependent }
}

export interface DayResult {
  outcomes: JobOutcome[]
  /** 一张做完再做下一张，所以总用时是每张相加。 */
  total: number
  allCorrect: boolean
}

export function runDay(picks: readonly Who[]): DayResult {
  const outcomes = normalizePicks(picks).map((who, i) => runJob(JOBS[i], who, i))
  return {
    outcomes,
    total: outcomes.reduce((sum, o) => sum + o.beats, 0),
    allCorrect: outcomes.every((o) => o.correct),
  }
}

/** 每张单子的最佳派法：结果对的前提下用时最短。 */
export const BEST_PICKS: readonly Who[] = JOBS.map((job, i) => {
  const crew = runJob(job, 'crew', i)
  return crew.correct && crew.beats < runJob(job, 'prof', i).beats ? 'crew' : 'prof'
})

/** 最短的总用时，★3 的标准。 */
export const BEST_TOTAL = runDay(BEST_PICKS).total

/** ★2 的效率目标：拆得开的大单子都拆给学徒才达得到（单测核对这个数和单子对得上）。 */
export const TARGET_BEATS = 2100

export const STAR_LABELS = [
  '每张单子的结果都对',
  `总用时不超过 ${TARGET_BEATS} 拍（模拟）`,
  '总用时最短',
] as const

/** 03 第 4 节：没过时写成「现象 + 原因 + 怎么改」。 */
export interface Problem {
  symptom: string
  cause: string
  fix: string
}

export interface Verdict {
  earned: [boolean, boolean, boolean]
  /** 下一颗星还差什么；三颗都拿到时是一句收尾的话。 */
  next: string
  error?: Problem
}

const name = (o: JobOutcome) => `单子 ${o.index + 1}`

/**
 * 星级判定（06 第 7 节）：输入每张单子派给谁，输出三颗星各自成立没有和下一步的一句话。
 * ★1 结果都对；★2 总用时不超过 TARGET_BEATS；★3 总用时最短。★1 不成立时一颗都不发。
 * 和写法无关：两种写法看到的是同一段代码（单测核对语法树相同），同样的派法拿同样的星。
 */
export function judge(picks: readonly Who[]): Verdict {
  const day = runDay(picks)

  const wrong = day.outcomes.filter((o) => !o.correct)
  if (wrong.length > 0) {
    const names = wrong.map(name).join('、')
    const error: Problem = {
      symptom: wrong.map((o) => `${name(o)} 算错了：${o.job.splitResult ?? '交上来的结果不对。'}`).join(''),
      cause: `${names} 的每一步都要用上一步算出来的数。拆给学徒同时做，谁也拿不到上一步的结果。`,
      fix: `有依赖的单子不能拆：把${names} 交给教授，一道接一道做。`,
    }
    return { earned: [false, false, false], next: error.fix, error }
  }

  if (day.total > TARGET_BEATS) {
    // 最该拆的那张：交给教授、拆给学徒能省得最多。
    const slow = day.outcomes
      .filter((o) => o.who === 'prof')
      .map((o) => ({ o, crew: runJob(o.job, 'crew', o.index) }))
      .filter(({ crew }) => crew.correct)
      .sort((x, y) => (y.o.beats - y.crew.beats) - (x.o.beats - x.crew.beats))[0]
    const why = slow
      ? `${name(slow.o)}（${slow.o.job.title}）交给了教授，用了 ${slow.o.beats} 拍；它的每一道互不相关，拆给学徒只要 ${slow.crew.beats} 拍。`
      : ''
    return { earned: [true, false, false], next: `总用时 ${day.total} 拍，目标是不超过 ${TARGET_BEATS} 拍。${why}` }
  }

  if (day.total > BEST_TOTAL) {
    const better = day.outcomes
      .map((o) => ({ o, other: runJob(o.job, o.who === 'prof' ? 'crew' : 'prof', o.index) }))
      .find(({ o, other }) => other.correct && other.beats < o.beats)
    const who = { prof: '教授', crew: '学徒' } as const
    const why = better
      ? `${name(better.o)} 交给${who[better.o.who]}要 ${better.o.beats} 拍，交给${who[better.other.who]}只要 ${better.other.beats} 拍${better.o.who === 'crew' ? '：题目太少时，人多帮不上忙' : ''}。`
      : ''
    return { earned: [true, true, false], next: `总用时 ${day.total} 拍，还能再快 ${day.total - BEST_TOTAL} 拍。${why}` }
  }

  const stuck = day.outcomes.filter((o) => o.job.dependent).reduce((sum, o) => sum + o.beats, 0)
  return {
    earned: [true, true, true],
    next: `总用时 ${day.total} 拍，其中 ${stuck} 拍花在拆不开的单子上：拆不开的部分，决定了最快能有多快。`,
  }
}
