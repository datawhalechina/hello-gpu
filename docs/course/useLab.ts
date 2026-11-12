/**
 * 导入实验室成绩（L-02；07 第 8 节，03 第 4、6 节，04 第 2–4 节）：LabCard 用它把通关码变成星、经验值和徽章。
 *
 * - 星走挑战状态（useChallenge，F-12）发：★1（多种形状都通过校验）成立才发星，每颗星只发一次，
 *   挑战里看过答案最高 2 星；副本（dungeon-…）按副本的规则记（★1 成立就算通关，第一次通关发这道题的经验值）。
 *   ★1 没成立算一次没过的尝试，不扣任何东西。
 * - 星级只按本关规则（lab.stars）重新计算，凭证里自带的结论一律不看（07 第 8 节）。
 * - 导入成功就判一次徽章：第一次导入发「真机验证」；规则里标了 badge: "beat-torch" 的星拿到了，发「打败 torch」。
 * - 先用观摩模式完成的关卡（L-05），后来导入的码 ★1 成立：换掉观摩标记（经验值不重复给），算真卡做过了。
 * - 最近一次导入成功的通关码存在这一关的草稿槽里，刷新页面后成绩还在（03 第 4 节「自动保存」）；
 *   重置进度、换存档时草稿槽清空，成绩跟着消失。
 *
 * 地址里的 #lab= 片段由 LabCard 读（它管页面），这里只管「一串码 → 成绩」。
 */
import { getCurrentInstance, onMounted, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { decodeCredential, judgeStars, LabCodeError, type LabCredential, type LabStar, type StarVerdict } from './lab.ts'
import { completeOptionsFor, exerciseById } from './outline.ts'
import { useChallenge, type Challenge } from './useChallenge.ts'
import { useProgress } from './useProgress.ts'

/** 实验室在挑战状态里的编号：同一关只有一个实验室，草稿槽里的这一格存最近一次导入的通关码。 */
export const LAB_CHALLENGE_ID = 'lab'

export interface LabImport {
  /** 去掉空白以后的通关码。 */
  code: string
  credential: LabCredential
  /** 按本关规则逐颗判定的结果。 */
  verdicts: StarVerdict[]
  /** ★1 成立没有：没成立时一颗星都不发。 */
  passed: boolean
  /** 这次导入新拿到的星（序号）。 */
  awarded: number[]
  /** 这次导入加的经验值。 */
  xp: number
  /** 这次新得的徽章 id。 */
  badges: string[]
  /** 判定拿到了、但因为看过答案（最高 2 星）没发出去的星。 */
  capped: number[]
  /** 刷新页面以后从草稿槽读出来的上一次导入：只显示，不重新发奖励。 */
  restored: boolean
}

export interface LabOptions {
  /** 关卡 id 或真卡副本 id。 */
  stage: string
  /** 本关的星级规则（outline.json 的 lab.stars，调用方先检查过）。 */
  stars: () => readonly LabStar[]
}

export interface Lab {
  readonly challenge: Challenge
  /** 最近一次导入（或刷新后读出来的上一次导入）的成绩。 */
  readonly result: Readonly<ShallowRef<LabImport | null>>
  /** 最近一次导入失败的原因；下一次导入成功就清掉。 */
  readonly error: Readonly<ShallowRef<LabCodeError | null>>
  /** 正在解码。 */
  readonly busy: Readonly<Ref<boolean>>
  /** 导入一串通关码：成功返回成绩，失败返回 null（原因在 error 里）。 */
  importCode(code: string): Promise<LabImport | null>
}

export function useLab(options: LabOptions): Lab {
  const progress = useProgress()
  const challenge = useChallenge({ stage: options.stage, id: LAB_CHALLENGE_ID })
  const exercise = exerciseById(options.stage)
  /** 关卡和副本的进度都有 stars（已经拿到的星序号）；副本的星记在副本自己的进度里。 */
  const recordOf: (id: string) => { stars: number[] } = exercise ? progress.exercise : progress.stage
  const result = shallowRef<LabImport | null>(null)
  const error = shallowRef<LabCodeError | null>(null)
  const busy = ref(false)
  /** 每次解码一个序号：慢的那次回来时已经有更新的导入了，就丢掉它的结果。 */
  let latest = 0

  async function importCode(code: string): Promise<LabImport | null> {
    const seq = ++latest
    busy.value = true
    try {
      const credential = await decodeCredential(code, options.stage)
      if (seq !== latest) return null
      const verdicts = judgeStars(options.stars(), credential)
      const before = [...recordOf(options.stage).stars]
      const xp = progress.state.xp
      const compact = code.replace(/\s+/g, '')
      // 先写草稿再尝试：attempt 会立刻把草稿槽存下来。
      challenge.draft.value = compact
      const outcome = challenge.attempt({ earned: verdicts.map((v) => v.earned) })
      const after = recordOf(options.stage).stars
      // 观摩完成的关卡用真卡过了 ★1：completeStage 照常完成一次，只换掉观摩标记，不重复给经验值（副本没有观摩完成）。
      if (outcome.passed && !exercise && progress.stage(options.stage).watched) {
        progress.completeStage(options.stage, completeOptionsFor(options.stage, progress.state.prefs))
      }
      // 「打败 torch」：这一次拿到了标 beat-torch 的那颗星（★1 成立、这颗达到，并且记进了进度；看过答案被封顶的不算）。
      const beatTorch = verdicts.some((v, i) => v.badge === 'beat-torch' && outcome.stars.includes(i) && after.includes(i))
      const badges = progress.checkBadges({ stage: options.stage, labCode: true, beatTorch })
      error.value = null
      result.value = {
        code: compact,
        credential,
        verdicts,
        passed: outcome.passed,
        awarded: after.filter((i) => !before.includes(i)),
        xp: progress.state.xp - xp,
        badges,
        capped: outcome.stars.filter((i) => !after.includes(i)),
        restored: false,
      }
      return result.value
    } catch (caught) {
      if (seq === latest) {
        if (!(caught instanceof LabCodeError)) console.error('[Hello GPU] 导入通关码时出错：', caught)
        error.value = caught instanceof LabCodeError ? caught : new LabCodeError('format', '码解不开')
      }
      return null
    } finally {
      if (seq === latest) {
        busy.value = false
        // 没导入成功：上一次导入的成绩照常显示（正在导入时没读草稿槽，这里补读）。
        if (!result.value && challenge.record.draft) void restore()
      }
    }
  }

  /**
   * 从草稿槽读出上一次导入的通关码，重新解码、按现在的规则判一遍，只显示，不发奖励。
   * 正在导入时不读：带着通关链接打开页面时，挑战状态挂载后才读出草稿槽，这次读回会排在导入后面；它要是换掉序号，
   * 导入的结果就被丢掉，「正在导入…」也一直停着（R-01 在真卡的通关链接上碰到）。导入完会写进草稿槽，用不着读回。
   */
  async function restore() {
    if (busy.value) return
    const draft = challenge.record.draft
    const code = typeof draft === 'string' ? draft : ''
    if (!code) {
      result.value = null
      error.value = null
      return
    }
    if (result.value?.code === code) return
    const seq = ++latest
    try {
      const credential = await decodeCredential(code, options.stage)
      if (seq !== latest) return
      const verdicts = judgeStars(options.stars(), credential)
      result.value = {
        code, credential, verdicts, passed: verdicts[0]?.earned ?? false, awarded: [], xp: 0, badges: [], capped: [], restored: true,
      }
    } catch {
      // 存下的码已经解不开（升级了格式、手改了存储）：当作没导入过。
      if (seq === latest) result.value = null
    }
  }

  // 草稿槽在 useChallenge 挂载时读好（它的 onMounted 先登记）；换存档、重置时它重新读，这里跟着变。
  if (getCurrentInstance()) onMounted(() => void restore())
  else void restore()
  watch(() => challenge.record.draft, () => void restore())

  return { challenge, result, error, busy, importCode }
}
