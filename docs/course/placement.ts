/**
 * 定级测试（Q-01）：题库 placement.json 的类型化读取、计分和推荐（04 第 2 节，PLAN 5.5 节）。
 *
 * 纯 TS，node --test 可以直接 import；定级页面（Q-02）只调这里的函数，不自己数分。
 * 题库的格式（每组 6–8 题、每题挂 1–3 关、每个选项都有解释……）由 scripts/course/course-data-check.mjs 检查。
 *
 * 规则：
 * - 三组题按区域顺序作答：新手村 → 铸造城 → 试炼场。一组答对的比例低于 passRate 就停下，推荐从这个区域开始。
 *   没答的、选了「不会」（null）的、选了不存在的选项的，都算答错。所以一组没答完、剩下的全答对也不够时就可以停下，
 *   结果和答完一样。
 * - 只有通过了的组才豁免关卡：答对的题挂着的关卡，加上这个区域的 Boss（Boss 是综合挑战，单独一道题证明不了，
 *   整组通过才豁免）。没通过的那组一关都不豁免：答对的题可能是蒙的，零基础的读者要从第一关开始。
 * - 推荐等级：停在哪个区域，就是这个区域推荐等级的下限；三组都通过，是最后一个区域的上限。
 * - 推荐关卡：按大纲顺序第一个没豁免的关卡，和世界地图「你在这」同一条规则（journey.ts 的 nextStage），
 *   所以确认定级以后，地图指的就是这一关。通过了的组里答错的题，挂着的关卡不豁免（gaps），
 *   它们排在推荐区域前面，地图会先带读者补上。
 */
import placementData from './placement.json' with { type: 'json' }
import { STAGES, ZONES, type ZoneId } from './outline.ts'
import type { Lang } from './progress.ts'

/** 三种题型：选择、估值（先估一个数再选）、读代码判断结果。 */
export type QuestionKind = 'choice' | 'estimate' | 'code'

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = { choice: '选择', estimate: '估值', code: '读代码' }

/**
 * 读代码题的代码按写法给，每种写法是一行一行的数组：新手村的题 hip、python 两种写法都给（模拟器能跑的同一个程序），
 * 铸造城、试炼场的题只给一种（PyTorch 写成 python，汇编写成 asm）。
 */
export type CodeLang = 'hip' | 'python' | 'asm'

export const CODE_LANGS: readonly CodeLang[] = ['hip', 'python', 'asm']

/** 和 Checkpoint 的选项同一个形状。 */
export interface PlacementOption {
  label: string
  /** 正确选项，每题恰好一个。 */
  correct?: boolean
  /** 为什么对 / 为什么不对，每个选项都要写。 */
  why: string
}

export interface PlacementQuestion {
  /** 全题库唯一，作答记录按它存。 */
  id: string
  kind: QuestionKind
  /** 答对就可以豁免的关卡：同一个区域的 1–3 关，按大纲顺序，不含 Boss。 */
  stages: string[]
  q: string
  /** 只有读代码题有。 */
  code?: Partial<Record<CodeLang, string[]>>
  options: PlacementOption[]
}

export interface PlacementGroup {
  zone: ZoneId
  questions: PlacementQuestion[]
}

export interface PlacementBank {
  /** 一组至少答对这个比例才算通过。 */
  passRate: number
  /** 按区域顺序，一个区域一组。 */
  groups: PlacementGroup[]
}

export const PLACEMENT: PlacementBank = {
  passRate: placementData.passRate,
  groups: placementData.groups as PlacementGroup[],
}

/** 读者的作答：题目 id → 选了第几个选项（从 0 数）；null 是「不会」，算答错。没有这个键的题是还没答。 */
export type PlacementAnswers = Readonly<Record<string, number | null>>

/** 这样选对不对。null、undefined、不存在的选项都算答错。 */
export function isCorrect(question: PlacementQuestion, choice: number | null | undefined): boolean {
  return typeof choice === 'number' && question.options[choice]?.correct === true
}

/** 读代码题按读者选的写法给代码；这道题没有这种写法时给它有的第一种。不是读代码题是 null。 */
export function codeOf(question: PlacementQuestion, lang: Lang): { lang: CodeLang; text: string } | null {
  const code = question.code
  if (!code) return null
  const pick = code[lang] ? lang : CODE_LANGS.find((l) => code[l])
  return pick ? { lang: pick, text: code[pick]!.join('\n') } : null
}

/** 一组 total 道题至少答对几道才算通过。减去一个很小的数，免得 0.7 × 10 这样的浮点误差多要一道。 */
export function passMark(total: number, passRate: number): number {
  return Math.max(0, Math.ceil(passRate * total - 1e-9))
}

export interface GroupScore {
  zone: ZoneId
  total: number
  /** 答了几道（选「不会」也算答了）。 */
  answered: number
  correct: number
  /** 至少答对几道才算通过。 */
  needed: number
  /** 答对的够了。没答的算错，所以中途退出也算得出来。 */
  passed: boolean
  /** 这一组结束了：全答完了，或者剩下的全答对也不够（提前停下）。 */
  done: boolean
}

export function scoreGroup(group: PlacementGroup, answers: PlacementAnswers, passRate: number = PLACEMENT.passRate): GroupScore {
  let answered = 0
  let correct = 0
  for (const question of group.questions) {
    // 原型上的键（比如 constructor）不算作答。
    const choice = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined
    if (choice === undefined) continue
    answered++
    if (isCorrect(question, choice)) correct++
  }
  const total = group.questions.length
  const needed = passMark(total, passRate)
  return {
    zone: group.zone,
    total,
    answered,
    correct,
    needed,
    passed: correct >= needed,
    done: answered === total || correct + (total - answered) < needed,
  }
}

/** 该做哪一组：前面的组都通过了、还没做完的那组。测试结束（某组没通过，或者全都通过了）是 null。 */
export function nextGroup(answers: PlacementAnswers, bank: PlacementBank = PLACEMENT): PlacementGroup | null {
  for (const group of bank.groups) {
    const score = scoreGroup(group, answers, bank.passRate)
    if (!score.done) return group
    if (!score.passed) return null
  }
  return null
}

export interface PlacementResult {
  /** 推荐从哪个区域开始：第一个没通过的组；全都通过是 null。 */
  zone: ZoneId | null
  level: number
  /** 推荐关卡：按大纲顺序第一个没豁免的关卡；全部豁免是 null。 */
  stage: string | null
  /** 豁免的关卡，按大纲顺序。确认定级时交给 applyPlacement。 */
  exempt: string[]
  /** 通过了的组里没豁免的关卡（答错的题挂着的），按大纲顺序。 */
  gaps: string[]
  /** 做到的每一组的得分，按作答顺序；停下的那组在最后。 */
  groups: GroupScore[]
}

/** 按到目前为止的作答算出定级结果，规则见文件开头。中途退出也能算：没答的题算答错。 */
export function placementResult(answers: PlacementAnswers, bank: PlacementBank = PLACEMENT): PlacementResult {
  const groups: GroupScore[] = []
  const exempt = new Set<string>()
  const passedZones = new Set<ZoneId>()
  let zone: ZoneId | null = null
  for (const group of bank.groups) {
    const score = scoreGroup(group, answers, bank.passRate)
    groups.push(score)
    if (!score.passed) {
      zone = group.zone
      break
    }
    passedZones.add(group.zone)
    for (const question of group.questions) {
      // isCorrect 只认数字，原型上的键读出来也算答错。
      if (!isCorrect(question, answers[question.id])) continue
      for (const id of question.stages) exempt.add(id)
    }
    for (const stage of STAGES) {
      if (stage.zone === group.zone && stage.kind === 'boss') exempt.add(stage.id)
    }
  }
  // 停下的区域取推荐等级的下限；全都通过取最后一个区域的上限。
  const levelZone = ZONES.find((z) => z.id === (zone ?? bank.groups.at(-1)?.zone))
  const level = zone ? levelZone?.lv[0] : levelZone?.lv[1]
  return {
    zone,
    level: level ?? 1,
    stage: STAGES.find((s) => !exempt.has(s.id))?.id ?? null,
    exempt: STAGES.filter((s) => exempt.has(s.id)).map((s) => s.id),
    gaps: STAGES.filter((s) => passedZones.has(s.zone) && !exempt.has(s.id)).map((s) => s.id),
    groups,
  }
}
