/** 动画与图注共用的教学数据（正文中同一批数字的单一来源）。 */

/** 8.1.1 依赖关系示例数据 */
export const INPUT_A = [2, -1, 4, 3, 0, 5, -2, 1]
export const INPUT_B = [7, 3, -1, 2, 6, -2, 4, 8]
export const OUTPUT_C = INPUT_A.map((value, index) => value + INPUT_B[index])
