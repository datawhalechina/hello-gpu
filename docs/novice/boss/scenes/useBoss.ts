/**
 * 新手村 Boss 的本关三颗星（关卡自己的组合式函数，不是登记组件）。
 *
 * 几道分题（三道修复题、你的 Agent）各自跑完以后，把这道题最近一次的结果报上来（report），这里合进 BossState
 * （存在本关草稿槽的 boss 一格，刷新不丢），交给 challenge.ts 的 judge 判星，再用一个不带提示的 challenge 发星：
 * ★1 不成立时一颗都不发，分题里看过答案本关最高 2 星，都照 useChallenge 的规矩。
 * 页面（index.md）只调用一次，把返回值交给各道分题的场景：几道分题共用同一份状态，不会互相覆盖。
 */
import { computed, type ComputedRef } from 'vue'
import { useChallenge } from '@course/useChallenge.ts'
import { STAGE_ID, judge, normalizeState, type BossState } from '../challenge.ts'

export interface Boss {
  /** 各道分题最近一次的结果；一道都没做时按工作单原来的样子算 */
  state: ComputedRef<BossState>
  /** 一道分题跑完了：记下它这次的结果，合起来判一次星 */
  report: (patch: Partial<BossState>) => void
}

export function useBoss(): Boss {
  const challenge = useChallenge({ stage: STAGE_ID, id: 'boss' })
  const state = computed(() => normalizeState(challenge.draft.value))
  return {
    state,
    report(patch) {
      const next: BossState = { ...state.value, ...patch }
      challenge.draft.value = next
      challenge.attempt(judge(next))
    },
  }
}
