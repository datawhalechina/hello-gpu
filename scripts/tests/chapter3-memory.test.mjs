import assert from 'node:assert/strict'
import test from 'node:test'
import {
  JOURNEY_DURATIONS,
  JOURNEY_INPUT,
  ADDITION_COMPLETE_MS,
  TRANSFER_COMPLETE_MS,
  journeyCopy,
  journeyState
} from '../../docs/part0-intro/chapter3/memory-model.ts'

test('读取请求不提前产生操作数、结果或输出', () => {
  for (const step of [0, 1]) {
    for (const local of [0, 800, JOURNEY_DURATIONS[step] - 1]) {
      const state = journeyState(step, local)
      assert.deepEqual([state.sourceA, state.sourceB], [3, 30])
      assert.equal(state.operandA, null)
      assert.equal(state.operandB, null)
      assert.equal(state.temporaryResult, null)
      assert.equal(state.arithmeticResult, null)
      assert.equal(state.output, null)
      assert.equal(state.requestIssued, step === 1)
    }
  }
})

test('加法部件执行运算，寄存器随后保留结果，两者不等同于数组写回', () => {
  const before = journeyState(3, ADDITION_COMPLETE_MS - 1)
  const calculated = journeyState(3, ADDITION_COMPLETE_MS)
  const retained = journeyState(3, TRANSFER_COMPLETE_MS)
  assert.equal(before.arithmeticResult, null)
  assert.equal(calculated.arithmeticResult, 33)
  assert.equal(calculated.temporaryResult, null)
  assert.equal(retained.temporaryResult, 33)
  for (const state of [before, calculated, retained]) {
    assert.deepEqual([state.operandA, state.operandB], [3, 30])
    assert.equal(state.output, null)
    assert.equal(state.cpuReceived, false)
  }
})

test('输入、加法结果、GPU写回在各自阶段完成后才可用', () => {
  const arriving = journeyState(2, TRANSFER_COMPLETE_MS - 1)
  const arrived = journeyState(2, TRANSFER_COMPLETE_MS)
  assert.equal(arriving.operandsReady, false)
  assert.deepEqual([arrived.operandA, arrived.operandB], [3, 30])
  assert.equal(arrived.temporaryResult, null)
  assert.equal(arrived.output, null)

  const adding = journeyState(3, TRANSFER_COMPLETE_MS - 1)
  const added = journeyState(3, TRANSFER_COMPLETE_MS)
  assert.equal(adding.temporaryResult, null)
  assert.equal(added.temporaryResult, 33)
  assert.equal(added.output, null)

  const saving = journeyState(4, TRANSFER_COMPLETE_MS - 1)
  const saved = journeyState(4, TRANSFER_COMPLETE_MS)
  assert.equal(saving.temporaryResult, 33)
  assert.equal(saving.output, null)
  assert.equal(saved.output, 33)
  assert.equal(saved.cpuReceived, false)
})

test('输入值始终保留，反向擦洗不残留已写入结果', () => {
  const initial = journeyState(0, 0)
  for (const step of [4, 2, 3, 1, 4, 0]) {
    const state = journeyState(step, JOURNEY_DURATIONS[step] - 1)
    assert.equal(state.sourceA, JOURNEY_INPUT.a)
    assert.equal(state.sourceB, JOURNEY_INPUT.b)
    assert.equal(state.output, step === 4 ? 33 : null)
  }
  assert.deepEqual(journeyState(0, 0), initial)
  assert.equal(journeyState(2, 0).operandsReady, false)
  assert.equal(journeyState(3, 0).temporaryResult, null)
  assert.equal(journeyState(4, 0).output, null)
})

test('减少动态效果显示当前步骤稳定终态，不跳过读取等待', () => {
  for (let step = 0; step < JOURNEY_DURATIONS.length; step++) {
    assert.deepEqual(journeyState(step, 0, true), journeyState(step, JOURNEY_DURATIONS[step] - 1))
  }
  assert.equal(journeyState(1, 0, true).operandsReady, false)
  assert.equal(journeyCopy(0, true), 1)
  assert.equal(journeyCopy(0), 0)
  assert.equal(journeyCopy(TRANSFER_COMPLETE_MS), 1)
})

test('模型拒绝无效步骤和时间，复制动画有界', () => {
  for (const step of [-1, 5, 1.5, NaN]) assert.throws(() => journeyState(step, 0), RangeError)
  for (const local of [-1, Infinity, NaN]) assert.throws(() => journeyState(0, local), RangeError)
  for (const local of [0, 50, 800, 1599, 1600, 5000]) {
    assert.ok(journeyCopy(local) >= 0 && journeyCopy(local) <= 1)
  }
})
