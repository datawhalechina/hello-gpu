import assert from 'node:assert/strict'
import test from 'node:test'
import { DEMO_THREADS, identifyThread } from '../../docs/part0-intro/chapter2/hierarchy-model.ts'

test('两个块共 128 个线程，每个 wavefront 恰好覆盖 32 个不同位置且不跨块', () => {
  assert.equal(DEMO_THREADS.length, 128)
  assert.equal(new Set(DEMO_THREADS.map(t => `${t.block}:${t.thread}`)).size, 128)
  const groups = Map.groupBy(DEMO_THREADS, t => `${t.block}:${t.wave}`)
  assert.deepEqual([...groups.keys()], ['0:0', '0:1', '1:0', '1:1'])
  for (const group of groups.values()) {
    assert.equal(group.length, 32)
    assert.equal(new Set(group.map(t => t.block)).size, 1)
    assert.deepEqual(group.map(t => t.lane), Array.from({ length: 32 }, (_, i) => i))
  }
})

test('跨越 31/32 边界时 lane 归零，切换块号不会改变块内分组', () => {
  const cases = [[0, 0, 0], [31, 0, 31], [32, 1, 0], [35, 1, 3], [63, 1, 31]]
  for (const block of [0, 1]) {
    for (const [thread, wave, lane] of cases) {
      const actual = identifyThread(block, thread)
      assert.deepEqual([actual.block, actual.thread, actual.wave, actual.lane], [block, thread, wave, lane])
    }
  }
})

test('最后一步的手算输入与结果一致，输入值不冒充线程编号', () => {
  const results = [32, 33, 34, 35].map(thread => {
    const { a, b, sum } = identifyThread(0, thread)
    return [a, b, sum]
  })
  assert.deepEqual(results, [[1, 10, 11], [2, 20, 22], [3, 30, 33], [4, 40, 44]])
  for (const item of DEMO_THREADS) assert.equal(item.sum, item.a + item.b)
})
