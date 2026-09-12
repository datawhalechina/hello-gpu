/** 动画与图注共用的教学数据（正文中同一批数字的单一来源）。 */

/** 8.1.1 依赖关系示例数据 */
export const INPUT_A = [2, -1, 4, 3, 0, 5, -2, 1]
export const INPUT_B = [7, 3, -1, 2, 6, -2, 4, 8]
export const OUTPUT_C = INPUT_A.map((value, index) => value + INPUT_B[index])

/**
 * 8.4.3 收尾实测数字唯一来源：
 * code/part2-kernels/chapter8/evidence（2026-07-19 curated，RX 9070 XT，
 * N = 16,777,216，hip-v1 连续/跨步两版，口径见正文 8.6.2）。
 */
export const MEASURED_BANDWIDTH = {
  contiguous: 544.738374,
  strided: 78.423556,
  ratio: '6.95×'
} as const
