/** Hand arithmetic only. Geometry may interpolate; committed values never do. */
export const REDUCTION_INPUT = [3, 1, 7, 0, 4, 1, 6, 2]
export const COMMIT_MS = 1100
export const ready = (local: number, reduced = false) => reduced || local >= COMMIT_MS
export const motion = (local: number, reduced = false) => reduced ? 1 : Math.max(0, Math.min(1, local / COMMIT_MS))
export function halfTree(input: number[]) {
  if (!input.length || (input.length & (input.length - 1))) throw new RangeError('power-of-two input required')
  const levels = [input.slice()]
  while (levels.at(-1)!.length > 1) {
    const previous = levels.at(-1)!, half = previous.length / 2
    levels.push(previous.slice(0, half).map((v, i) => v + previous[i + half]))
  }
  return levels
}
export const TREE = halfTree(REDUCTION_INPUT)
/** Adjacent pairing keeps the introductory tree crossing-free in input order. */
export function adjacentTree(input: number[]) {
  if (!input.length || (input.length & (input.length - 1))) throw new RangeError('power-of-two input required')
  const levels = [input.slice()]
  while (levels.at(-1)!.length > 1) {
    const previous = levels.at(-1)!
    levels.push(Array.from({length:previous.length/2}, (_,i) => previous[2*i]+previous[2*i+1]))
  }
  return levels
}
export const SUM_TREE = adjacentTree(REDUCTION_INPUT)
export function sumTreeState(step: number, local: number, reduced = false) {
  const round = Math.max(0, Math.min(3, step))
  const completedLevel = round - (round > 0 && !ready(local,reduced) ? 1 : 0)
  return {round, completedLevel,
    levels:SUM_TREE.map((values,level) => values.map(value => level<=completedLevel?value:null)),
    output:completedLevel===3?SUM_TREE[3][0]:null}
}
export const LONG_INPUT = [...REDUCTION_INPUT, ...REDUCTION_INPUT]
export function twoStageState(step: number, local: number, reduced = false) {
  const done = ready(local, reduced), phase = step - (done ? 0 : 1)
  const locals = [0, 1].map(b => [0, 1, 2, 3].map(t => LONG_INPUT[b * 4 + t] + LONG_INPUT[b * 4 + t + 8]))
  const sums = locals.map(v => v.reduce((a, b) => a + b, 0))
  return { selectedLocal: phase < 1 ? 0 : phase === 1 ? 3 : 6,
    locals: phase >= 3 ? locals : null, sums: phase >= 4 ? sums : null,
    partials: phase >= 5 ? sums : null, finalReadable: step >= 6,
    output: phase >= 6 ? sums[0] + sums[1] : null }
}
export function programAssignments(size: number, width: number, programs: number) {
  return Array.from({length: programs}, (_, pid) => {
    const chunks: (number | null)[][] = []
    for (let start = pid * width; start < size; start += programs * width)
      chunks.push(Array.from({length: width}, (_, i) => start + i < size ? start + i : null))
    return chunks
  })
}
export const TRITON_INPUT = LONG_INPUT.slice(0, 10)
export const TRITON_ASSIGNMENTS = programAssignments(10, 4, 2)
export function tritonState(step: number, local: number, reduced = false) {
  const phase = step - (ready(local, reduced) ? 0 : 1)
  const accumulator = phase < 1 ? [0,0,0,0] : phase < 2 ? [3,1,7,0] : [6,2,7,0]
  return { accumulator, partials: phase >= 3 ? [15,13] : null, finalInput: phase >= 4 ? [15,13,0,0] : null,
    output: phase >= 5 ? 28 : null }
}
/** Only the dependency cone needed by lane 0 is drawn, not all shuffle results. */
export function shuffleState(step: number, local: number, reduced = false) {
  const round = Math.max(0, Math.min(step, 3)), visible = round - (round > 0 && !ready(local, reduced) ? 1 : 0)
  const links = TREE.slice(1).flatMap((row,i) => row.map((_,target) => ({level:i+1, target, source:target+row.length, value:TREE[i][target+row.length]})))
  return { round, completedLevel:visible, links, source: TREE[Math.max(0, round - 1)], values: TREE[visible], offset: round ? 2 ** (3 - round) : null,
    result: step >= 3 && visible === 3 ? 24 : null }
}
