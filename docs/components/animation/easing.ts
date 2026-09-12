/** 时间轴分段与缓动工具：场景用它们把 step 内的局部进度映射成几何量。 */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3)

export const easeInOutCubic = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2

/** 带轻微过冲的弹出，用于徽章/强调元素的入场 */
export const easeOutBack = (p: number): number => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}

/**
 * 取分段进度：把整体进度 p 在 [start, end] 区间内的部分线性映射到 [0,1]。
 * 场景动画约定：`seg(local, 200, 800)` 表示「本步开始后 200ms–800ms 之间发生」。
 */
export function seg(p: number, start: number, end: number): number {
  if (end <= start) return p >= end ? 1 : 0
  return clamp01((p - start) / (end - start))
}

/** seg + 缓动的组合，最常用的取段方式。 */
export function segE(
  p: number,
  start: number,
  end: number,
  ease: (v: number) => number = easeOutCubic
): number {
  return ease(seg(p, start, end))
}
