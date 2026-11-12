/**
 * 1-2 走进工坊城：挑战「三排数加起来」的规则和星级判定（纯函数，单测在 scripts/tests/novice-gpu-panorama.test.mjs，
 * 06 第 7 节）。
 *
 * 工作单 add 一次只加两排数，所以 out = a + b + c 要启动两次：先算 t = a + b，再算 out = t + c。
 * 读者替每一排数选怎么搬：要不要拷进显存、要不要拷回 CPU。这里按选好的搬法把旅程走一遍：
 * 拷进 → 启动（算 t）→（t 拷回、再拷进）→ 启动（算 out）→ out 拷回，记下每一步对不对、搬了多少。
 *
 * - ★1 CPU 拿到正确的 out：a、b、c 都在显存里，GPU 才算得对；out 拷回来，CPU 才拿得到。
 * - ★2 拷贝不超过 TARGET_COPIES 次：中间结果 t 不来回搬。
 * - ★3 拷贝次数最少：要用的拷进去，要看的拷回来，别的都留在原地。
 *
 * 判定只看搬法，和写法无关：两种写法显示的是同一串操作（hostCode，单测核对），同样的搬法拿同样的星。
 * 这里的数都是算出来的（每排 1000 个数，每个 4 字节），不是计时，也不是硬件参数。
 */
import type { Lang } from '../../course/progress.ts'

/** 这一关在大纲里的 id。 */
export const STAGE_ID = 'novice-gpu-panorama'

/** 每排 1000 个数，和 1-1 的 1000 道加法一样多。 */
export const ARRAY_LENGTH = 1000
/** 一个 float 小数占 4 字节。 */
export const BYTES_PER_NUMBER = 4
export const ARRAY_BYTES = ARRAY_LENGTH * BYTES_PER_NUMBER

// ── 搬法 ─────────────────────────────────────────────────────────────────

/** 输入的一排数：拷进显存，或者不拷。 */
export type InputMove = 'in' | 'none'
/** 中间结果 t：留在显存；拷回 CPU；拷回 CPU 再拷进显存。 */
export type TempMove = 'keep' | 'back' | 'roundtrip'
/** CPU 要的结果 out：拷回 CPU，或者留在显存。 */
export type OutMove = 'back' | 'keep'

export interface Plan {
  a: InputMove
  b: InputMove
  c: InputMove
  t: TempMove
  out: OutMove
}

export type PlanKey = keyof Plan

export interface PlanItem {
  key: PlanKey
  /** 旋钮上的中文名。 */
  label: string
  /** 代码里的名字。 */
  code: string
  options: readonly { value: Plan[PlanKey]; label: string }[]
}

const INPUT_OPTIONS = [
  { value: 'in', label: '拷进显存' },
  { value: 'none', label: '不拷' },
] as const

export const PLAN_ITEMS: readonly PlanItem[] = [
  { key: 'a', label: '第一排数', code: 'a', options: INPUT_OPTIONS },
  { key: 'b', label: '第二排数', code: 'b', options: INPUT_OPTIONS },
  { key: 'c', label: '第三排数', code: 'c', options: INPUT_OPTIONS },
  {
    key: 't',
    label: '中间结果',
    code: 't = a + b',
    options: [
      { value: 'keep', label: '留在显存' },
      { value: 'back', label: '拷回 CPU' },
      { value: 'roundtrip', label: '拷回再拷进' },
    ],
  },
  {
    key: 'out',
    label: 'CPU 要的结果',
    code: 'out = t + c',
    options: [
      { value: 'back', label: '拷回 CPU' },
      { value: 'keep', label: '留在显存' },
    ],
  },
]

/** 默认值「能跑但不好」（03 第 1 节第 3 条）：每次启动都当成一趟单独的旅程，t 拷回 CPU 再拷进去。结果对，多搬了两次。 */
export const DEFAULT_PLAN: Readonly<Plan> = { a: 'in', b: 'in', c: 'in', t: 'roundtrip', out: 'back' }

/** 草稿槽里读出来的搬法可能是旧版本或被手改坏：不认识的地方用默认值。 */
export function normalizePlan(raw: unknown): Plan {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const plan = { ...DEFAULT_PLAN }
  for (const item of PLAN_ITEMS) {
    const value = r[item.key]
    if (item.options.some((o) => o.value === value)) (plan as Record<PlanKey, unknown>)[item.key] = value
  }
  return plan
}

// ── 把旅程走一遍 ──────────────────────────────────────────────────────────

export type Op =
  | { kind: 'copy-in'; array: 'a' | 'b' | 'c' | 't' }
  | { kind: 'copy-out'; array: 't' | 'out' }
  | { kind: 'launch'; out: 't' | 'out'; inputs: readonly ['a', 'b'] | readonly ['t', 'c'] }
  | { kind: 'wait' }

export interface OpResult {
  op: Op
  /** 这一步做成了没有：启动时要的数都在显存里；拷回时显存里那排是算对了的。 */
  ok: boolean
  /** 搬了多少字节（只有拷贝有）。 */
  bytes: number
  /** 没做成的原因，例如「显存里没有 b」。 */
  note: string
}

export interface Trip {
  steps: OpResult[]
  copies: number
  bytes: number
  /** CPU 最后拿没拿到 out。 */
  delivered: boolean
  /** CPU 拿到的 out 对不对（没拿到也算不对）。 */
  correct: boolean
  /** 启动时显存里缺了哪几排数。 */
  missing: ('a' | 'b' | 'c')[]
}

/** 一种搬法对应的一串操作：拷进 → 启动 → （t 拷回、拷进）→ 启动 → out 拷回。拷回之前先等 GPU 算完。 */
export function opsOf(plan: Plan): Op[] {
  const p = normalizePlan(plan)
  const ops: Op[] = []
  for (const x of ['a', 'b', 'c'] as const) if (p[x] === 'in') ops.push({ kind: 'copy-in', array: x })
  ops.push({ kind: 'launch', out: 't', inputs: ['a', 'b'] })
  if (p.t !== 'keep') ops.push({ kind: 'wait' }, { kind: 'copy-out', array: 't' })
  if (p.t === 'roundtrip') ops.push({ kind: 'copy-in', array: 't' })
  ops.push({ kind: 'launch', out: 'out', inputs: ['t', 'c'] })
  if (p.out === 'back') ops.push({ kind: 'wait' }, { kind: 'copy-out', array: 'out' })
  return ops
}

/**
 * 按搬法把旅程走一遍。只记每排数「在不在、对不对」：CPU 一开始有 a、b、c；显存一开始什么也没有。
 * 启动时要的数不在显存里，GPU 读到的是显存里原来留下的数，算出来的就不对。
 */
export function runPlan(plan: Plan): Trip {
  const host = new Map<string, boolean>([['a', true], ['b', true], ['c', true]])
  const device = new Map<string, boolean>()
  const missing = new Set<'a' | 'b' | 'c'>()
  const steps: OpResult[] = []
  for (const op of opsOf(plan)) {
    if (op.kind === 'wait') {
      steps.push({ op, ok: true, bytes: 0, note: '' })
    } else if (op.kind === 'copy-in') {
      const good = host.get(op.array) === true
      device.set(op.array, good)
      steps.push({ op, ok: good, bytes: ARRAY_BYTES, note: good ? '' : `拷进去的 ${op.array} 是算错了的` })
    } else if (op.kind === 'copy-out') {
      const good = device.get(op.array) === true
      host.set(op.array, good)
      steps.push({ op, ok: good, bytes: ARRAY_BYTES, note: good ? '' : `显存里的 ${op.array} 是算错了的` })
    } else {
      const absent = op.inputs.filter((x) => !device.has(x))
      const wrong = op.inputs.filter((x) => device.has(x) && device.get(x) !== true)
      for (const x of absent) if (x !== 't') missing.add(x)
      device.set(op.out, absent.length === 0 && wrong.length === 0)
      const note = absent.length ? `显存里没有 ${absent.join('、')}` : wrong.length ? `${wrong.join('、')} 是算错了的` : ''
      steps.push({ op, ok: !note, bytes: 0, note })
    }
  }
  const copies = steps.filter((s) => s.op.kind === 'copy-in' || s.op.kind === 'copy-out')
  const delivered = host.has('out')
  return {
    steps,
    copies: copies.length,
    bytes: copies.reduce((sum, s) => sum + s.bytes, 0),
    delivered,
    correct: delivered && host.get('out') === true,
    missing: ['a', 'b', 'c'].filter((x) => missing.has(x as 'a' | 'b' | 'c')) as ('a' | 'b' | 'c')[],
  }
}

/** 所有搬法（2 × 2 × 2 × 3 × 2 = 48 种）。 */
export const ALL_PLANS: readonly Plan[] = PLAN_ITEMS.reduce<Plan[]>(
  (plans, item) => plans.flatMap((p) => item.options.map((o) => ({ ...p, [item.key]: o.value }))),
  [{ ...DEFAULT_PLAN }],
)

/** 结果对的搬法里，拷贝最少的次数（★3 的标准）。 */
export const BEST_COPIES = Math.min(...ALL_PLANS.filter((p) => runPlan(p).correct).map((p) => runPlan(p).copies))
/** 拷贝最少的那种搬法（单测核对只有一种）。 */
export const BEST_PLAN: Readonly<Plan> = ALL_PLANS.find((p) => runPlan(p).correct && runPlan(p).copies === BEST_COPIES)!
/** ★2 的效率目标：多一次拷贝还能过，t 来回搬（多两次）就过不了（单测核对这个数和默认搬法对得上）。 */
export const TARGET_COPIES = 5

export const STAR_LABELS = [
  'CPU 拿到正确的 out',
  `拷贝不超过 ${TARGET_COPIES} 次`,
  '拷贝次数最少',
] as const

// ── 两种写法的代码 ─────────────────────────────────────────────────────────

/** 一行代码对应一个操作。申请显存的几行省略了（正文里写明），d_ 开头的是显存里的那一份。 */
export function codeLine(op: Op, lang: Lang): string {
  if (op.kind === 'wait') return lang === 'hip' ? 'hipDeviceSynchronize();' : 'synchronize()'
  if (op.kind === 'copy-in') {
    return lang === 'hip' ? `hipMemcpy(d_${op.array}, ${op.array}, bytes, hipMemcpyHostToDevice);` : `d_${op.array} = to_device(${op.array})`
  }
  if (op.kind === 'copy-out') {
    return lang === 'hip' ? `hipMemcpy(${op.array}, d_${op.array}, bytes, hipMemcpyDeviceToHost);` : `${op.array} = to_host(d_${op.array})`
  }
  const args = `${op.inputs.map((x) => `d_${x}`).join(', ')}, d_${op.out}, n`
  return lang === 'hip' ? `add<<<blocks, threads>>>(${args});` : `add[blocks, threads](${args})`
}

export function hostCode(plan: Plan, lang: Lang): string {
  return opsOf(plan).map((op) => codeLine(op, lang)).join('\n')
}

// ── 星级判定 ─────────────────────────────────────────────────────────────

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

/**
 * 星级判定（06 第 7 节）：输入搬法，输出三颗星各自成立没有和下一步的一句话。
 * ★1 CPU 拿到正确的 out；★2 拷贝不超过 TARGET_COPIES 次；★3 拷贝次数最少。★1 不成立时一颗都不发。
 */
export function judge(plan: Plan): Verdict {
  const p = normalizePlan(plan)
  const trip = runPlan(p)

  if (!trip.correct) {
    const symptoms: string[] = []
    const causes: string[] = []
    const fixes: string[] = []
    if (trip.missing.length) {
      const names = trip.missing.join('、')
      symptoms.push(`启动的时候，显存里没有 ${names}，算出来的 out 不对。`)
      causes.push('GPU 干活只从显存里取数据。没拷进去的那排，GPU 读到的是显存里原来留下的数。')
      fixes.push(`把 ${names} 拷进显存。`)
    }
    if (!trip.delivered) {
      symptoms.push('CPU 没拿到 out：结果还留在显存里，CPU 的内存里那排 out 是空的。')
      causes.push('GPU 算完的结果写在显存里，不会自己回到 CPU 那边。')
      fixes.push('最后把 out 拷回 CPU。')
    }
    const error: Problem = { symptom: symptoms.join(''), cause: causes.join(''), fix: fixes.join('') }
    return { earned: [false, false, false], next: error.fix, error }
  }

  const total = `拷贝 ${trip.copies} 次，一共 ${trip.bytes} 字节`
  if (trip.copies > TARGET_COPIES) {
    const why = p.t === 'roundtrip'
      ? `t 从显存拷回 CPU、又拷进显存，来回搬了 ${ARRAY_BYTES * 2} 字节。它本来就在显存里，第二次启动可以直接用。`
      : ''
    return { earned: [true, false, false], next: `${total}，目标是不超过 ${TARGET_COPIES} 次。${why}` }
  }

  if (trip.copies > BEST_COPIES) {
    const why = p.t === 'back'
      ? 't 拷回 CPU 这一次用不上：CPU 只要 out，第二次启动读的是显存里的 t。'
      : ''
    return { earned: [true, true, false], next: `${total}，还能少 ${trip.copies - BEST_COPIES} 次。${why}` }
  }

  return {
    earned: [true, true, true],
    next: `${total}：要用的拷进去，要看的拷回来，中间结果 t 一直留在显存里。`,
  }
}
