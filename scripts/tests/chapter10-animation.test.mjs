import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COPY_MS, READ_FIRST_MS, READ_ALL_MS, EXP_MS,
  MATH_DURATIONS, BARRIER_DURATIONS, MASK_DURATIONS,
  mathState, barrierState, maskState, copyProgress, displayValue
} from '../../docs/part2-kernels/chapter10/softmax-model.ts'

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`)
test('数学过程先汇入标量，再分发，结果只在完成后出现', () => {
  const fields = ['maximum', 'shifted', 'exponentials', 'denominator', 'output']
  for (let step = 1; step <= 5; step++) {
    assert.equal(mathState(step, COPY_MS - 1)[fields[step - 1]], null)
    assert.notEqual(mathState(step, COPY_MS)[fields[step - 1]], null)
  }
  const state = mathState(5, COPY_MS)
  assert.deepEqual(state.input, [1000, 1001, 1002])
  assert.equal(state.maximum, 1002)
  assert.deepEqual(state.shifted, [-2, -1, 0])
  close(state.denominator, Math.exp(-2) + Math.exp(-1) + 1)
  close(state.output.reduce((a, b) => a + b), 1)
  assert.deepEqual(state.output.map(v => v.toFixed(4)), ['0.0900', '0.2447', '0.6652'])
})
test('屏障前各读者必须取得最大值，屏障后才能覆盖 LDS', () => {
  for (const local of [0, READ_FIRST_MS - 1]) assert.deepEqual(barrierState(1, local).readers.map(r => r.maximum), [null, null])
  assert.deepEqual(barrierState(1, READ_FIRST_MS).readers.map(r => r.maximum), [1002, null])
  assert.equal(barrierState(1, READ_ALL_MS - 1).allReadersReady, false)
  assert.equal(barrierState(1, READ_ALL_MS).allReadersReady, true)
  assert.equal(barrierState(1, READ_ALL_MS).barrierPassed, false)
  assert.equal(barrierState(2, COPY_MS - 1).barrierPassed, false)
  assert.equal(barrierState(2, COPY_MS).barrierPassed, true)
  assert.equal(barrierState(3, COPY_MS - 1).sharedValue, 1002)
  const final = barrierState(3, COPY_MS)
  close(final.sharedValue, Math.exp(-2))
  assert.deepEqual(final.readers.map(r => r.maximum), [1002, 1002])
  assert.equal(final.sharedRole, '局部 sum')
})
test('负数行的 padding 为负无穷，指数贡献零，只写回三个真实元素', () => {
  assert.equal(maskState(1, COPY_MS - 1).logical, null)
  assert.deepEqual(maskState(1, COPY_MS).logical, [-1002, -1001, -1000, -Infinity])
  assert.equal(maskState(2, COPY_MS).maximum, -1000)
  assert.deepEqual(maskState(2, COPY_MS).shifted, [-2, -1, 0, -Infinity])
  assert.equal(maskState(3, EXP_MS - 1).exponentials, null)
  assert.equal(maskState(3, EXP_MS).exponentials[3], 0)
  assert.equal(maskState(3, COPY_MS - 1).denominator, null)
  assert.equal(maskState(4, COPY_MS - 1).output, null)
  const state = maskState(4, COPY_MS)
  assert.equal(state.output.length, 3)
  assert.deepEqual(state.valid, [true, true, true, false])
  close(state.output.reduce((a, b) => a + b), 1)
  assert.deepEqual(state.output.map(v => v.toFixed(4)), ['0.0900', '0.2447', '0.6652'])
})
test('旧值保留、输入无副作用；逆向跳步不残留结果', () => {
  for (const [state, durations] of [[mathState, MATH_DURATIONS], [barrierState, BARRIER_DURATIONS], [maskState, MASK_DURATIONS]]) {
    const initial = state(0, 0)
    for (const step of [durations.length - 1, 1, 0, durations.length - 1, 0]) {
      const s = state(step, durations[step] - 1)
      assert.deepEqual(s.input, initial.input)
      s.input[0] = 42
    }
    assert.deepEqual(state(0, 0), initial)
  }
  assert.equal(barrierState(0, 0).sharedValue, 1002)
  assert.equal(mathState(0, 0).output, null)
  assert.equal(maskState(0, 0).output, null)
})
test('减少动态效果直接给当前语义终态，不越过后续屏障', () => {
  for (const [state, durations] of [[mathState, MATH_DURATIONS], [barrierState, BARRIER_DURATIONS], [maskState, MASK_DURATIONS]]) {
    for (let step = 0; step < durations.length; step++) assert.deepEqual(state(step, 0, true), state(step, durations[step] - 1))
  }
  assert.equal(barrierState(1, 0, true).barrierPassed, false)
  assert.equal(barrierState(2, 0, true).overwritten, false)
  assert.equal(copyProgress(0, true), 1)
})
test('所有擦洗时刻的 shared 值都是真实旧值或新值，不插值', () => {
  for (let local = 0; local < 4200; local += 73) {
    const s = barrierState(3, local)
    assert.ok(s.sharedValue === 1002 || s.sharedValue === Math.exp(-2))
  }
  for (const fn of [mathState, barrierState, maskState]) {
    for (const step of [-1, 999, 1.2, NaN]) assert.throws(() => fn(step, 0), RangeError)
    for (const local of [-1, NaN, Infinity]) assert.throws(() => fn(0, local), RangeError)
  }
  assert.equal(displayValue(-Infinity), '−∞')
  assert.equal(displayValue(null), '未就绪')
})
