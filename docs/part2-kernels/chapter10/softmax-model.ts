// Hand-checkable teaching states. Milliseconds control drawing, never GPU timing.
export const COPY_MS = 1400
export const READ_FIRST_MS = 700
export const READ_ALL_MS = 1600
export const EXP_MS = 800
export const POSITIVE_ROW = Object.freeze([1000, 1001, 1002])
export const NEGATIVE_ROW = Object.freeze([-1002, -1001, -1000])
export const MATH_DURATIONS = Object.freeze([3000, 4000, 4000, 3500, 4000, 4200])
export const BARRIER_DURATIONS = Object.freeze([3200, 4200, 3800, 4200])
export const MASK_DURATIONS = Object.freeze([3000, 4000, 3800, 4400, 4200])

function validate(step: number, count: number, local: number) {
  if (!Number.isInteger(step) || step < 0 || step >= count) throw new RangeError('无效的教学步骤')
  if (!Number.isFinite(local) || local < 0) throw new RangeError('步骤时间必须为非负有限数')
}
export function copyProgress(local: number, reducedMotion = false, duration = COPY_MS) {
  return reducedMotion ? 1 : Math.min(1, Math.max(0, local / duration))
}
function ready(step: number, target: number, local: number, reducedMotion: boolean, duration = COPY_MS) {
  return step > target || (step === target && (reducedMotion || local >= duration))
}
export function stableRow(input: readonly number[]) {
  const maximum = Math.max(...input)
  const shifted = input.map(value => value - maximum)
  const exponentials = shifted.map(Math.exp)
  const denominator = exponentials.reduce((sum, value) => sum + value, 0)
  return { maximum, shifted, exponentials, denominator, probabilities: exponentials.map(value => value / denominator) }
}
const positive = stableRow(POSITIVE_ROW)
const negative = stableRow(NEGATIVE_ROW)

export function mathState(step: number, local: number, reducedMotion = false) {
  validate(step, MATH_DURATIONS.length, local)
  const maximumReady = ready(step, 1, local, reducedMotion)
  const shiftedReady = ready(step, 2, local, reducedMotion)
  const exponentsReady = ready(step, 3, local, reducedMotion)
  const denominatorReady = ready(step, 4, local, reducedMotion)
  const outputReady = ready(step, 5, local, reducedMotion)
  return {
    step, input: [...POSITIVE_ROW],
    maximum: maximumReady ? positive.maximum : null,
    shifted: shiftedReady ? [...positive.shifted] : null,
    exponentials: exponentsReady ? [...positive.exponentials] : null,
    denominator: denominatorReady ? positive.denominator : null,
    output: outputReady ? [...positive.probabilities] : null,
    maximumReady, shiftedReady, exponentsReady, denominatorReady, outputReady
  }
}

export function barrierState(step: number, local: number, reducedMotion = false) {
  validate(step, BARRIER_DURATIONS.length, local)
  const readers = [READ_FIRST_MS, READ_ALL_MS].map(at => ready(step, 1, local, reducedMotion, at))
  const allReadersReady = readers.every(Boolean)
  const barrierPassed = ready(step, 2, local, reducedMotion)
  const overwritten = ready(step, 3, local, reducedMotion)
  return {
    step, input: [...POSITIVE_ROW], blockSize: 256,
    readers: readers.map((isReady, index) => ({ thread: index * 32, wave: index, maximum: isReady ? 1002 : null })),
    allReadersReady, barrierPassed, overwritten,
    sharedValue: overwritten ? positive.exponentials[0] : 1002,
    sharedRole: overwritten ? '局部 sum' : '行最大值',
    // t0 owns column 0 in this 3-column row. Other valid columns belong to t1/t2.
    localSum: step === 3 ? positive.exponentials[0] : null
  }
}

export function maskState(step: number, local: number, reducedMotion = false) {
  validate(step, MASK_DURATIONS.length, local)
  const loaded = ready(step, 1, local, reducedMotion)
  const maximumReady = ready(step, 2, local, reducedMotion)
  const exponentsReady = ready(step, 3, local, reducedMotion, EXP_MS)
  const denominatorReady = ready(step, 3, local, reducedMotion)
  const outputReady = ready(step, 4, local, reducedMotion)
  return {
    step, input: [...NEGATIVE_ROW], columns: 3, block: 4, valid: [true, true, true, false],
    logical: loaded ? [...NEGATIVE_ROW, -Infinity] : null,
    maximum: maximumReady ? negative.maximum : null,
    shifted: maximumReady ? [...negative.shifted, -Infinity] : null,
    exponentials: exponentsReady ? [...negative.exponentials, 0] : null,
    denominator: denominatorReady ? negative.denominator : null,
    output: outputReady ? [...negative.probabilities] : null,
    loaded, maximumReady, exponentsReady, denominatorReady, outputReady
  }
}
export function displayValue(value: number | null, digits = 4): string {
  if (value === null) return '未就绪'
  if (value === -Infinity) return '−∞'
  return Number.isInteger(value) ? String(value).replace('-', '−') : value.toFixed(digits)
}
