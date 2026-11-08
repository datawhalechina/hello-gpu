/**
 * 1-3「线程分组」的星级判定。纯函数，可单测。
 *
 * ★1 所有结果正确；★2 在 ★1 的基础上没有越界写；
 * ★3 在 ★2 的基础上组数最少，并且换一种每组人数后规则依然成立（没有把人数写死）。
 */
import type { Expr, Lang } from '../../sim/expr.ts'
import { minBlocks, simulate, type LaunchConfig } from '../../sim/launch.ts'

export const STAGE_ID = 'novice-thread-groups'

export const STAR_LABELS = [
  '所有结果都正确',
  '没有任何线程写到数组外面',
  '派出的组数最少，而且换一种每组人数，规则照样成立',
] as const

export interface StarVerdict {
  earned: [boolean, boolean, boolean]
  /** 下一颗星还差什么；全部拿到时为空 */
  next: string
}

export function judge(expr: Expr, lang: Lang, cfg: LaunchConfig, altBlockDims: number[]): StarVerdict {
  const r = simulate(expr, lang, cfg)
  if (!r.ok) return { earned: [false, false, false], next: `先让程序跑起来：${r.error}` }
  const s = r.summary

  const s1 = s.allCorrect
  if (!s1) {
    const dup = s.duplicates > 0 ? `，另外有 ${s.duplicates} 个数被重复计算` : ''
    return { earned: [false, false, false], next: `还有 ${s.missing} 个数没人算${dup}。` }
  }

  const s2 = s.oobWrites === 0
  if (!s2) return { earned: [true, false, false], next: `有 ${s.oobWrites} 个线程写到了数组外面。` }

  const fewest = minBlocks(cfg.n, cfg.blockDim)
  if (cfg.gridDim > fewest) {
    return { earned: [true, true, false], next: `组数还能更少：${fewest} 组就够了。` }
  }

  for (const b of altBlockDims) {
    if (b === cfg.blockDim) continue
    const alt = simulate(expr, lang, { ...cfg, blockDim: b, gridDim: minBlocks(cfg.n, b) })
    if (!alt.ok || !alt.summary.allCorrect || alt.summary.oobWrites > 0) {
      return {
        earned: [true, true, false],
        next: `把每组人数换成 ${b}，你的规则就不成立了。是不是把人数写死成了具体的数？`,
      }
    }
  }
  return { earned: [true, true, true], next: '' }
}
