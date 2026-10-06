// 手算模型使用未舍入的 JS 数值；时间仅用于呈现，绝不代表 GPU 延迟。
export const SCORES = Object.freeze([2, 1, 4])
export const VALUES = Object.freeze([[1, 0], [0, 2], [3, 1]].map(row => Object.freeze(row)))
export const ARRIVE_MS = 1100
export const CALCULATE_MS = 1600
export const ACCUMULATE_MS = 2200
export const DURATION_MS = 3600
export interface OnlineState { m: number; l: number; a: number[] }
export const initial = (): OnlineState => ({ m: -Infinity, l: 0, a: [0, 0] })
export function merge(state: OnlineState, scores: readonly number[], values: readonly (readonly number[])[]) {
  const m = Math.max(state.m, ...scores)
  const alpha = state.m === -Infinity ? 0 : Math.exp(state.m - m)
  const weights = scores.map(score => Math.exp(score - m))
  const scaled = { m, l: state.l * alpha, a: state.a.map(value => value * alpha) }
  const next = { m, l: scaled.l + weights.reduce((a, b) => a + b, 0),
    a: scaled.a.map((value, d) => value + weights.reduce((sum, w, j) => sum + w * values[j][d], 0)) }
  return { alpha, weights, scaled, next }
}
export function afterKeys(count: number): OnlineState {
  let state = initial()
  for (let key = 0; key < count; key++) state = merge(state, [SCORES[key]], [VALUES[key]]).next
  return state
}
export const OLD = afterKeys(2)
export const KEY2 = merge(OLD, [SCORES[2]], [VALUES[2]])
export const EXPONENTS = SCORES.map(score => Math.exp(score - Math.max(...SCORES)))
export const PROBABILITIES = EXPONENTS.map(value => value / EXPONENTS.reduce((a, b) => a + b, 0))
export const CONTRIBUTIONS = PROBABILITIES.map((p, key) => VALUES[key].map(value => value * p))
export const OUTPUT = [0, 1].map(d => CONTRIBUTIONS.reduce((sum, row) => sum + row[d], 0))
export function fmt(value: number | null) { return value === null ? '等待' : value === -Infinity ? '−∞' : Number.isInteger(value) ? String(value) : value.toFixed(4) }
export function motion(local: number, start = 0, end = ARRIVE_MS, reduced = false) {
  return reduced ? 1 : Math.max(0, Math.min(1, (local - start) / (end - start)))
}
function time(step: number, local: number, count: number, reduced: boolean) {
  if (!Number.isInteger(step) || step < 0 || step >= count || !Number.isFinite(local) || local < 0) throw new RangeError('无效的教学步骤或时间')
  return reduced ? DURATION_MS : local
}
export function weightedFrame(step: number, local: number, reduced = false) {
  const t = time(step, local, 6, reduced)
  const key = step >= 2 && step <= 4 ? step - 2 : null
  const displayKey = step === 5 ? 2 : key
  const completed = step < 2 ? 0 : step === 5 ? 3 : key! + Number(t >= ACCUMULATE_MS)
  return { step, key, displayKey, weightsReady: step > 1 || (step === 1 && t >= ARRIVE_MS),
    weightReady: step === 5 || key !== null && t >= 550, valueReady: step === 5 || key !== null && t >= ARRIVE_MS,
    contribution: displayKey !== null && (step === 5 || t >= CALCULATE_MS) ? [...CONTRIBUTIONS[displayKey]] : null,
    accumulated: [0, 1].map(d => CONTRIBUTIONS.slice(0, completed).reduce((sum, row) => sum + row[d], 0)),
    output: step === 5 && t >= ARRIVE_MS ? [...OUTPUT] : null }
}
export function onlineFrame(step: number, local: number, reduced = false) {
  const t = time(step, local, 7, reduced)
  const source = step < 3 ? afterKeys(Math.max(0, step - 1)) : afterKeys(2)
  let current = step < 3 ? afterKeys(Math.max(0, step - Number(t < ARRIVE_MS))) : afterKeys(2)
  if (step === 4 && t >= ARRIVE_MS || step === 5) current = { ...KEY2.scaled, a: [...KEY2.scaled.a] }
  if (step > 5 || step === 5 && t >= ARRIVE_MS) current = { ...KEY2.next, a: [...KEY2.next.a] }
  return { step, source, current, alpha: step >= 3 ? KEY2.alpha : step === 1 ? 0 : 1,
    output: step === 6 && t >= ARRIVE_MS ? current.a.map(value => value / current.l) : null }
}
export function tritonFrame(step: number, local: number, reduced = false) {
  const t = time(step, local, 6, reduced)
  const second = step >= 2
  const keys = second ? [2, 3] : [0, 1]
  const mask = keys.map(key => key < SCORES.length)
  const scores = keys.map((key, index) => mask[index] ? SCORES[key] : -Infinity)
  const values = keys.map((key, index) => mask[index] ? [...VALUES[key]] : [0, 0])
  const history = second ? afterKeys(2) : initial()
  const merged = merge(history, scores, values)
  const exponentReady = step === 1 && t >= ARRIVE_MS || step >= 4
  let current = history
  if (!second && step === 1 && t >= ARRIVE_MS) current = merged.next
  if (second && (step === 3 && t >= ARRIVE_MS || step === 4)) current = merged.scaled
  if (step === 4 && t >= ARRIVE_MS || step === 5) current = merged.next
  const tileLoaded = ![0, 2].includes(step) || t >= ARRIVE_MS
  return { step, keys, mask, scores, values, history, current, tileLoaded, exponentReady, weights: merged.weights,
    output: step === 5 && t >= ARRIVE_MS ? current.a.map(value => value / current.l) : null }
}
export function syncFrame(step: number, local: number, reduced = false) {
  const t = time(step, local, 5, reduced)
  const published = step > 1 || step === 1 && t >= ARRIVE_MS
  const barrierComplete = step > 2 || step === 2 && t >= 550
  const readable = step > 2 || step === 2 && t >= ARRIVE_MS
  const oldRead = step > 3 || step === 3 && t >= 550
  const computed = step > 3 || step === 3 && t >= ARRIVE_MS
  const updated = step > 3 || step === 3 && t >= CALCULATE_MS
  const reusable = step === 4 && t >= ARRIVE_MS
  return { step, published, barrierComplete, readable, updated, reusable,
    sharedAlpha: published ? KEY2.alpha : null, sharedBeta: published ? 1 : null,
    privateAlpha: readable ? KEY2.alpha : null, privateBeta: readable ? 1 : null,
    oldOperand: oldRead ? [...OLD.a] : null, computedNumerator: computed ? [...KEY2.next.a] : null,
    oldNumerator: [...OLD.a], numerator: updated ? [...KEY2.next.a] : [...OLD.a],
    l: published ? KEY2.next.l : OLD.l }
}
