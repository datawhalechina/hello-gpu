// 一维 wave32 教学模型；数值仅供手算，不代表实测输出。
export const BLOCK_COUNT = 2
export const THREADS_PER_BLOCK = 64
export const WAVE_SIZE = 32

export function identifyThread(block: number, thread: number) {
  if (!Number.isInteger(block) || block < 0 || block >= BLOCK_COUNT ||
      !Number.isInteger(thread) || thread < 0 || thread >= THREADS_PER_BLOCK) {
    throw new RangeError('线程必须属于本例的两个 Block，块内编号为 0～63')
  }
  const wave = Math.floor(thread / WAVE_SIZE)
  const lane = thread % WAVE_SIZE
  const a = lane + 1
  const b = a * 10
  return { block, thread, wave, lane, a, b, sum: a + b }
}

export const DEMO_THREADS = Array.from({ length: BLOCK_COUNT * THREADS_PER_BLOCK }, (_, id) => ({
  id,
  ...identifyThread(Math.floor(id / THREADS_PER_BLOCK), id % THREADS_PER_BLOCK)
}))
