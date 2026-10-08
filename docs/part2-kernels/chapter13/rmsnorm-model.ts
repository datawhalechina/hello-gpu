/** Small mathematical examples, independent of benchmark configurations. */
export const EPSILON = 1e-5
export const COMMIT_MS = 1100
export const X = [3, 4, -3, -4], W = [1, .5, 2, 1]
export const complete = (local: number, reduced = false) => reduced || local >= COMMIT_MS
export const progress = (local: number, reduced = false) => reduced ? 1 : Math.max(0, Math.min(1, local / COMMIT_MS))
export const format = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(4)
export function rmsnorm(row: number[], weights: number[], epsilon = EPSILON) {
  if (!row.length || row.length !== weights.length || epsilon <= 0) throw new RangeError('valid row, weights and epsilon required')
  const squares = row.map(x => x*x), sum = squares.reduce((a,b) => a+b, 0), mean = sum/row.length
  const scale = 1/Math.sqrt(mean+epsilon)
  return {squares, sum, mean, scale, output:row.map((x,i) => x*scale*weights[i])}
}
export const MATH = rmsnorm(X, W)
export function mathState(step: number, local: number, reduced = false) {
  const phase = step - (complete(local,reduced) ? 0 : 1)
  return {squares:phase>=1?MATH.squares:null, sum:phase>=2?MATH.sum:null,
    mean:phase>=3?MATH.mean:null, scale:phase>=4?MATH.scale:null, output:phase>=5?MATH.output:null}
}
export const SERIAL_SUMS = [0,9,25,34,50]
/** Inactive LDS cells retain their old values. */
export const SHARED_ROUNDS = [[9,16,9,16],[18,32,9,16],[50,32,9,16]]
export const MULTI_X = [[3,4,0],[1,2,2],[0,0,0]], MULTI_W = [1,.5,2]
export function rowTile(pid: number) {
  return [0,1].map(slot => {
    const row = pid*2+slot, valid=row<MULTI_X.length
    const values = valid ? [...MULTI_X[row],0] : [0,0,0,0]
    const stats = valid ? rmsnorm(MULTI_X[row],MULTI_W) : null
    return {row, valid, values, mask:values.map((_,c)=>valid&&c<3), stats}
  })
}
export function tileState(step: number, local: number, reduced = false) {
  const phase=step-(complete(local,reduced)?0:1), pid=step>=4?1:0
  return {pid, rows:rowTile(pid), showSum:pid===0?phase>=1:phase>=4,
    showScale:pid===0?phase>=2:phase>=4, showOutput:pid===0?phase>=3:phase>=4}
}
