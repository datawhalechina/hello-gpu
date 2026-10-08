import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SCORES, VALUES, ARRIVE_MS, CALCULATE_MS, ACCUMULATE_MS, DURATION_MS,
  OLD, KEY2, PROBABILITIES, OUTPUT, afterKeys, initial, merge,
  weightedFrame, onlineFrame, tritonFrame, syncFrame, motion,
} from '../../docs/part2-kernels/chapter12/attention-model.ts'

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-13, `${actual} != ${expected}`)
const vectorClose = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, d) => close(value, expected[d]))
}
const directDenominator = Math.exp(-2) + Math.exp(-3) + 1
const directOutput = [(Math.exp(-2) + 3) / directDenominator, (2 * Math.exp(-3) + 1) / directDenominator]

test('同一概率用于两个 V 分量，三项贡献得到直接加权和', () => {
  close(PROBABILITIES.reduce((sum, p) => sum + p, 0), 1)
  vectorClose(OUTPUT, directOutput)
  for (let key = 0; key < 3; key++) {
    const before = weightedFrame(key + 2, ACCUMULATE_MS - 1)
    const after = weightedFrame(key + 2, ACCUMULATE_MS)
    const contribution = [0, 1].map(d => PROBABILITIES[key] * VALUES[key][d])
    vectorClose(after.contribution, contribution)
    vectorClose(after.accumulated, before.accumulated.map((v, d) => v + contribution[d]))
  }
})

test('概率、乘法操作数、贡献、累计、写出分别完成，不提前显示后续值', () => {
  assert.equal(weightedFrame(0, DURATION_MS).weightsReady, false)
  assert.equal(weightedFrame(1, ARRIVE_MS - 1).weightsReady, false)
  assert.equal(weightedFrame(1, ARRIVE_MS).weightsReady, true)
  assert.equal(weightedFrame(2, 549).weightReady, false)
  assert.equal(weightedFrame(2, 550).weightReady, true)
  assert.equal(weightedFrame(2, ARRIVE_MS - 1).valueReady, false)
  assert.equal(weightedFrame(2, ARRIVE_MS).valueReady, true)
  assert.equal(weightedFrame(2, CALCULATE_MS - 1).contribution, null)
  assert.notEqual(weightedFrame(2, CALCULATE_MS).contribution, null)
  assert.deepEqual(weightedFrame(2, ACCUMULATE_MS - 1).accumulated, [0, 0])
  assert.equal(weightedFrame(4, DURATION_MS).output, null)
  assert.equal(weightedFrame(5, ARRIVE_MS - 1).output, null)
  vectorClose(weightedFrame(5, ARRIVE_MS).output, directOutput)
  assert.deepEqual(weightedFrame(5, 0).contribution, weightedFrame(4, DURATION_MS).contribution)
})

test('在线更新把旧分母与两个旧累计同乘 exp(-2)，保留未舍入值', () => {
  assert.equal(OLD.m, 2)
  close(OLD.l, 1 + Math.exp(-1))
  vectorClose(OLD.a, [1, 2 * Math.exp(-1)])
  close(KEY2.alpha, Math.exp(-2))
  close(KEY2.scaled.l, Math.exp(-2) + Math.exp(-3))
  vectorClose(KEY2.scaled.a, [Math.exp(-2), 2 * Math.exp(-3)])
  close(KEY2.next.l, directDenominator)
  vectorClose(KEY2.next.a, [Math.exp(-2) + 3, 2 * Math.exp(-3) + 1])
  assert.notEqual(KEY2.scaled.l, Number(KEY2.scaled.l.toFixed(4)))
  assert.deepEqual(onlineFrame(3, DURATION_MS).current, OLD)
  assert.deepEqual(onlineFrame(4, ARRIVE_MS - 1).current, OLD)
  assert.deepEqual(onlineFrame(4, ARRIVE_MS).current, KEY2.scaled)
  assert.deepEqual(onlineFrame(5, ARRIVE_MS - 1).current, KEY2.scaled)
  assert.deepEqual(onlineFrame(5, ARRIVE_MS).current, KEY2.next)
  for (const step of [3, 4, 5, 6]) assert.deepEqual(onlineFrame(step, DURATION_MS).source, OLD)
  assert.equal(onlineFrame(6, ARRIVE_MS - 1).output, null)
  vectorClose(onlineFrame(6, ARRIVE_MS).output, directOutput)
})

test('两 key 的首块与逐 key 处理等价，尾块只有一个有效项', () => {
  assert.deepEqual(merge(initial(), SCORES.slice(0, 2), VALUES.slice(0, 2)).next, afterKeys(2))
  assert.equal(tritonFrame(0, ARRIVE_MS - 1).tileLoaded, false)
  assert.equal(tritonFrame(0, ARRIVE_MS).tileLoaded, true)
  assert.equal(tritonFrame(1, ARRIVE_MS - 1).exponentReady, false)
  assert.deepEqual(tritonFrame(1, ARRIVE_MS).current, OLD)
  const tail = tritonFrame(2, ARRIVE_MS)
  assert.deepEqual(tail.keys, [2, 3])
  assert.deepEqual(tail.mask, [true, false])
  assert.deepEqual(tail.scores, [4, -Infinity])
  assert.deepEqual(tail.values, [[3, 1], [0, 0]])
  assert.deepEqual(tail.weights, [1, 0])
  assert.deepEqual(tail.current, OLD)
  assert.deepEqual(tritonFrame(3, ARRIVE_MS - 1).current, OLD)
  assert.deepEqual(tritonFrame(3, ARRIVE_MS).current, KEY2.scaled)
  assert.deepEqual(tritonFrame(4, ARRIVE_MS - 1).current, KEY2.scaled)
  assert.deepEqual(tritonFrame(4, ARRIVE_MS).current, KEY2.next)
  assert.equal(tritonFrame(5, ARRIVE_MS - 1).output, null)
  vectorClose(tritonFrame(5, ARRIVE_MS).output, directOutput)
})

test('HIP 系数发布后先完成屏障，消费者才取得副本', () => {
  assert.equal(syncFrame(1, ARRIVE_MS - 1).sharedAlpha, null)
  close(syncFrame(1, ARRIVE_MS).sharedAlpha, Math.exp(-2))
  assert.equal(syncFrame(1, DURATION_MS).privateAlpha, null)
  assert.equal(syncFrame(2, 549).barrierComplete, false)
  assert.equal(syncFrame(2, 550).barrierComplete, true)
  assert.equal(syncFrame(2, ARRIVE_MS - 1).privateAlpha, null)
  close(syncFrame(2, ARRIVE_MS).privateAlpha, Math.exp(-2))
  assert.equal(syncFrame(2, ARRIVE_MS).privateBeta, 1)
  assert.deepEqual(syncFrame(2, DURATION_MS).numerator, OLD.a)
})

test('HIP 读取旧累计、算出新值、共享写回与允许覆盖是不同状态', () => {
  assert.equal(syncFrame(3, 549).oldOperand, null)
  assert.deepEqual(syncFrame(3, 550).oldOperand, OLD.a)
  assert.equal(syncFrame(3, ARRIVE_MS - 1).computedNumerator, null)
  assert.deepEqual(syncFrame(3, ARRIVE_MS).computedNumerator, KEY2.next.a)
  assert.deepEqual(syncFrame(3, CALCULATE_MS - 1).numerator, OLD.a)
  assert.deepEqual(syncFrame(3, CALCULATE_MS).numerator, KEY2.next.a)
  assert.equal(syncFrame(3, DURATION_MS).reusable, false)
  assert.equal(syncFrame(4, ARRIVE_MS - 1).reusable, false)
  assert.equal(syncFrame(4, ARRIVE_MS).reusable, true)
})

test('所有模型按步骤和局部时间确定，倒放不会残留后续结果或改变源数据', () => {
  for (const [frame, count] of [[weightedFrame, 6], [onlineFrame, 7], [tritonFrame, 6], [syncFrame, 5]]) {
    const snapshots = Array.from({ length: count }, (_, step) => frame(step, 0))
    for (let step = count - 1; step >= 0; step--) {
      frame(count - 1, DURATION_MS)
      assert.deepEqual(frame(step, 0), snapshots[step])
    }
  }
  const isolated = onlineFrame(6, DURATION_MS)
  isolated.source.a[0] = 999
  isolated.current.a[0] = 999
  assert.equal(onlineFrame(3, 0).source.a[0], 1)
  vectorClose(onlineFrame(6, DURATION_MS).output, directOutput)
  assert.deepEqual(SCORES, [2, 1, 4])
  assert.deepEqual(VALUES, [[1, 0], [0, 2], [3, 1]])
})

test('减少动态效果显示当前步稳定终态，仍保留重缩放和屏障边界', () => {
  for (const [frame, count] of [[weightedFrame, 6], [onlineFrame, 7], [tritonFrame, 6], [syncFrame, 5]]) {
    for (let step = 0; step < count; step++) assert.deepEqual(frame(step, 0, true), frame(step, DURATION_MS - 1))
  }
  assert.deepEqual(onlineFrame(4, 0, true).current, KEY2.scaled)
  assert.deepEqual(tritonFrame(3, 0, true).current, KEY2.scaled)
  assert.equal(syncFrame(1, 0, true).privateAlpha, null)
  assert.deepEqual(syncFrame(2, 0, true).numerator, OLD.a)
  assert.equal(motion(0, 0, ARRIVE_MS, true), 1)
})

test('拒绝无效步骤和时间，移动位置有界且不改数值', () => {
  for (const [frame, count] of [[weightedFrame, 6], [onlineFrame, 7], [tritonFrame, 6], [syncFrame, 5]]) {
    for (const step of [-1, count, 1.5, NaN]) assert.throws(() => frame(step, 0), RangeError)
    for (const local of [-1, Infinity, NaN]) assert.throws(() => frame(0, local), RangeError)
  }
  assert.equal(motion(0, 550, 1100), 0)
  assert.equal(motion(825, 550, 1100), 0.5)
  assert.equal(motion(5000, 550, 1100), 1)
})
