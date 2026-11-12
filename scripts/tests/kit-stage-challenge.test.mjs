import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALT_BLOCK_DIMS, CHALLENGE_N, STAR_LABELS, describe, indexOf, judge, minBlocks, run,
} from './fixtures/kit/stage-challenge.ts'

/** 迷你关卡 组件测试样例 的模拟和星级判定（06 第 7 节：judge 是纯函数，每颗星都要覆盖）。 */

const cfg = (over = {}) => ({ n: CHALLENGE_N, blockDim: 4, gridDim: 4, formula: 'global', guard: true, ...over })

test('下标规则：三种拿数的写法算出的 i', () => {
  // 第 2 组（blockIdx.x = 2）里排第 3 的线程，每组 4 个
  assert.equal(indexOf('tid', 2, 3, 4), 3)
  assert.equal(indexOf('block', 2, 3, 4), 8)
  assert.equal(indexOf('global', 2, 3, 4), 11)
  assert.equal(minBlocks(13, 4), 4)
  assert.equal(minBlocks(12, 4), 3)
})

test('模拟：覆盖、重复、越界、被边界检查拦下', () => {
  // 规则写成 threadIdx.x：每组都去写 c[0]～c[3]，后面的数没人算
  const collide = run(cfg({ formula: 'tid', gridDim: 4, guard: false }))
  assert.equal(collide.covered, 4)
  assert.equal(collide.missing, 9)
  assert.equal(collide.duplicates, 4)
  assert.equal(collide.allCorrect, false)
  assert.equal(collide.threads.filter((t) => t.state === 'dup').length, 16)

  // 规则对了但没有边界检查：16 个线程里 3 个越界
  const oob = run(cfg({ guard: false }))
  assert.equal(oob.covered, CHALLENGE_N)
  assert.equal(oob.duplicates, 0)
  assert.equal(oob.oob, 3)
  assert.equal(oob.skipped, 0)
  assert.equal(oob.allCorrect, true)

  // 加上边界检查：同样 3 个线程，什么也不做
  const guarded = run(cfg())
  assert.equal(guarded.oob, 0)
  assert.equal(guarded.skipped, 3)
  assert.deepEqual(guarded.writers, new Array(CHALLENGE_N).fill(1))
})

test('★1 不成立时一颗星都不发，并给出现象 / 原因 / 怎么改', () => {
  for (const [formula, gridDim] of [['tid', 4], ['block', 4], ['global', 2]]) {
    const verdict = judge(cfg({ formula, gridDim, guard: false }))
    assert.deepEqual(verdict.earned, [false, false, false], `${formula} / ${gridDim} 组`)
    assert.ok(verdict.error, '没过要带错误说明')
    for (const key of ['symptom', 'cause', 'fix']) {
      assert.ok(String(verdict.error[key] ?? '').trim(), `${formula} 缺少 ${key}`)
    }
  }
  // 组数不够：规则对了也算不完
  assert.match(judge(cfg({ gridDim: 2, guard: false })).error.fix, /向上取整/)
})

test('★2 要没有越界写，★3 要组数最少且换一种每组人数也成立', () => {
  // ★1 成立、有越界：只发第一颗
  const oob = judge(cfg({ guard: false }))
  assert.deepEqual(oob.earned, [true, false, false])
  assert.match(oob.next, /边界检查/)

  // 组数多派了一组
  const extra = judge(cfg({ gridDim: 5 }))
  assert.deepEqual(extra.earned, [true, true, false])
  assert.match(extra.next, /组数还能更少/)

  // 每组 13 个、1 组：这一次没有越界，但换成每组 2 个就会有，★3 不给
  const hardcoded = judge(cfg({ blockDim: CHALLENGE_N, gridDim: 1, guard: false }), ALT_BLOCK_DIMS)
  assert.deepEqual(hardcoded.earned, [true, true, false])
  assert.match(hardcoded.next, /换成 2/)

  // 三颗星：规则对、有边界检查、组数最少
  const perfect = judge(cfg())
  assert.deepEqual(perfect.earned, [true, true, true])
  assert.equal(perfect.error, undefined)
  assert.equal(STAR_LABELS.length, 3)
  // 换一种每组人数照样三颗星
  assert.deepEqual(judge(cfg({ blockDim: 8, gridDim: 2 })).earned, [true, true, true])
})

test('一句话解读跟着参数变', () => {
  assert.match(describe({ n: 10, blockDim: 4, gridDim: 2, formula: 'tid', guard: false }), /没人算/)
  assert.match(describe({ n: 10, blockDim: 4, gridDim: 3, formula: 'global', guard: false }), /写到了数组外面/)
  assert.match(describe({ n: 10, blockDim: 4, gridDim: 3, formula: 'global', guard: true }), /边界检查拦下/)
  assert.match(describe({ n: 12, blockDim: 4, gridDim: 3, formula: 'global', guard: false }), /没有人越界/)
})
