/** Pure teaching states. Times control arrival only; numeric values never interpolate. */
export const A = [[1, 2, 3], [4, 5, 6]]
export const B = [[1, 0], [2, 1], [0, 2]]
export const FINAL = [[5, 8], [14, 17]]
export const ARRIVAL_MS = 650
const arrived = (local, reducedMotion) => reducedMotion || local >= ARRIVAL_MS
const clamp = (value, end) => Math.max(0, Math.min(Math.trunc(value), end))
export const prefix = count => A.map(row => B[0].map((_, column) =>
  row.slice(0, count).reduce((sum, value, k) => sum + value * B[k][column], 0)))

export function dotState(step, local = Infinity, reducedMotion = false) {
  step = clamp(step, 4)
  const ready = arrived(local, reducedMotion)
  const completed = step === 4 ? 3 : Math.max(0, step - (ready ? 0 : 1))
  const k = step >= 1 && step <= 3 ? step - 1 : null
  return { step, ready, k, accumulator: prefix(completed)[0][0],
    previous: k === null ? null : prefix(k)[0][0],
    a: k === null ? null : A[0][k], b: k === null ? null : B[k][0],
    product: k === null ? null : A[0][k] * B[k][0],
    output: step === 4 && ready ? FINAL[0][0] : null }
}

export function reuseSelection(matrix = 'a', row = 0, column = 1) {
  const values = matrix === 'a' ? A : B
  if (!values[row] || values[row][column] === undefined) throw new RangeError('input cell does not exist')
  const value = values[row][column]
  const contributions = matrix === 'a'
    ? B[0].map((_, c) => ({ row, column: c, left: value, right: B[column][c], amount: value * B[column][c] }))
    : A.map((aRow, r) => ({ row: r, column, left: aRow[row], right: value, amount: aRow[row] * value }))
  return { matrix, row, column, value, contributions }
}

export const LDS_STEPS = ['target', 'load-first', 'inner-0', 'inner-1', 'readers-done',
  'load-tail', 'tail-inner-0', 'tail-inner-1', 'tail-readers-done', 'store']
export function ldsState(step, local = Infinity, reducedMotion = false) {
  step = clamp(step, LDS_STEPS.length - 1)
  const ready = arrived(local, reducedMotion)
  const tile = step >= 5 ? 1 : 0
  const kStart = tile * 2
  const inputsA = A.map((row, r) => [0, 1].map(c => ({ value: row[kStart + c] ?? 0, valid: kStart + c < 3, row: r, column: kStart + c })))
  const inputsB = [0, 1].map(r => [0, 1].map(c => ({ value: B[kStart + r]?.[c] ?? 0, valid: kStart + r < 3, row: kStart + r, column: c })))
  const loadStep = step === 1 || step === 5
  const loaded = step > 0 && (!loadStep || ready)
  const writeBarrierComplete = loaded
  const inner = step === 2 || step === 6 ? 0 : step === 3 || step === 7 ? 1 : null
  const beforeCount = step <= 2 ? 0 : step <= 5 ? 2 : step === 6 ? 2 : 3
  let completed = 0
  if (step === 2) completed = ready ? 1 : 0
  else if (step === 3) completed = ready ? 2 : 1
  else if (step >= 4 && step <= 5) completed = 2
  else if (step === 6) completed = ready ? 3 : 2
  else if (step >= 7) completed = 3
  const accumulator = prefix(completed)
  const readersDone = (step === 4 || step === 8) && ready
  const lhs = inner === null ? null : inputsA[0][inner].value
  const rhs = inner === null ? null : inputsB[inner][1].value
  // A new load does not erase the previous shared values before its copies arrive.
  const sharedA = step === 5 && !ready
    ? A.map((row, r) => row.slice(0, 2).map((value, column) => ({ value, valid: true, row: r, column })))
    : loaded ? inputsA : null
  const sharedB = step === 5 && !ready
    ? B.slice(0, 2).map((row, r) => row.map((value, column) => ({ value, valid: true, row: r, column })))
    : loaded ? inputsB : null
  return { step, phase: LDS_STEPS[step], ready, tile, kStart, inputsA, inputsB,
    loaded, sharedA, sharedB, writeBarrierComplete, inner, accumulator, readersDone,
    canOverwrite: readersDone, left: lhs, right: rhs,
    previous: inner === null ? null : prefix(inner === 0 ? beforeCount : (tile === 0 ? 1 : 3))[0][1],
    product: inner === null ? null : lhs * rhs,
    output: step === 9 && ready ? FINAL.map(row => row.slice()) : null }
}

export function groupMapping(id, group, rows = 3, columns = 4) {
  if (!Number.isInteger(id) || id < 0 || id >= rows * columns || group < 1) throw new RangeError('invalid program mapping')
  const perGroup = group * columns
  const groupId = Math.floor(id / perGroup)
  const first = groupId * group
  const actualGroup = Math.min(rows - first, group)
  const within = id % perGroup
  return { id, row: first + within % actualGroup, column: Math.floor(within / actualGroup), actualGroup }
}

export const EDGE_A = [[1, 2, 3], [4, 5, 6], [1, 0, 1]]
export const EDGE_B = [[1, 0, 2], [2, 1, 0], [0, 2, 1]]
export function edgeState(step, local = Infinity, reducedMotion = false) {
  step = clamp(step, 5)
  const ready = arrived(local, reducedMotion)
  const kStart = step >= 3 ? 2 : 0
  const tileA = [2, 3].map(row => [kStart, kStart + 1].map(column => ({
    row, column, valid: row < 3 && column < 3, value: EDGE_A[row]?.[column] ?? 0,
    reason: [row >= 3 ? 'M' : '', column >= 3 ? 'K' : ''].filter(Boolean).join('+') })))
  const tileB = [kStart, kStart + 1].map(row => [2, 3].map(column => ({
    row, column, valid: row < 3 && column < 3, value: EDGE_B[row]?.[column] ?? 0,
    reason: [row >= 3 ? 'K' : '', column >= 3 ? 'N' : ''].filter(Boolean).join('+') })))
  let accumulator = 0
  if (step >= 3 || (step === 2 && ready)) accumulator = 2
  if (step === 5 || (step === 4 && ready)) accumulator = 3
  return { step, ready, kStart, tileA, tileB, loaded: step > 0 && (!(step === 1 || step === 3) || ready),
    accumulator, output: step === 5 && ready ? 3 : null,
    outputCells: [2, 3].flatMap(row => [2, 3].map(column => ({ row, column, valid: row < 3 && column < 3,
      value: row === 2 && column === 2 ? accumulator : 0 }))) }
}
