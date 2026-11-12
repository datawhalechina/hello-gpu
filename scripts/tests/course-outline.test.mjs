import assert from 'node:assert/strict'
import test from 'node:test'
import {
  arcsOf, completeOptionsFor, EXERCISE_LIST, EXERCISES, exerciseById, exerciseHref, exerciseNeighbors, exercisesOf, routeSplitOf,
  routesOf, stageById, STAGES, ZONES,
} from '../../docs/course/outline.ts'

const PREFS = { lang: 'python', route: 'triton' }

test('完成关卡的选项：Boss 关按 Boss 发经验值，新手村记写法，分路线的关卡记路线', () => {
  const noviceStage = STAGES.find((s) => s.zone === 'novice' && s.kind === 'stage')
  const noviceBoss = STAGES.find((s) => s.zone === 'novice' && s.kind === 'boss')
  const forgeSplit = STAGES.find((s) => s.zone === 'forge' && s.kind === 'stage' && routesOf(s) === 'split')
  const forgeShared = STAGES.find((s) => s.zone === 'forge' && routesOf(s) === 'shared')
  const trialBoss = STAGES.find((s) => s.zone === 'trial' && s.kind === 'boss')

  assert.deepEqual(completeOptionsFor(noviceStage.id, PREFS), { kind: 'stage', lang: 'python' })
  assert.deepEqual(completeOptionsFor(noviceBoss.id, PREFS), { kind: 'boss', lang: 'python' })
  assert.deepEqual(completeOptionsFor(forgeSplit.id, PREFS), { kind: 'stage', route: 'triton' })
  // 纯硬件或工具类关卡两条路线共用一份，不算「用某条路线通关」
  assert.deepEqual(completeOptionsFor(forgeShared.id, PREFS), { kind: 'stage' })
  assert.deepEqual(completeOptionsFor(trialBoss.id, PREFS), { kind: 'boss', route: 'triton' })
  // 不在大纲里的 id（预览页的演示关卡）按普通关卡处理
  assert.deepEqual(completeOptionsFor('demo-kit-checkpoint', PREFS), { kind: 'stage' })
})

test('关卡的写法 / 路线设置：关卡自己写了就用它，否则跟区域', () => {
  for (const stage of STAGES) {
    const mode = routesOf(stage)
    if (stage.routes) assert.equal(mode, stage.routes, stage.id)
    else assert.equal(mode, stage.zone === 'novice' ? 'syntax' : 'split', stage.id)
  }
  assert.equal(stageById('novice-thread-groups')?.code, '1-4')
  assert.equal(stageById('不存在的关卡'), undefined)
})

test('区域首页的关卡列表：按 arc 分组，一关不漏、不重复，顺序和大纲一致', () => {
  for (const zone of ZONES) {
    const own = STAGES.filter((s) => s.zone === zone.id)
    const groups = arcsOf(zone.id)
    assert.deepEqual(groups.flatMap((g) => g.stages), own, zone.id)
    assert.equal(new Set(groups.map((g) => g.arc)).size, groups.length, `${zone.id} 的 arc 重复成了两组`)
    for (const g of groups) assert.ok(g.stages.every((s) => s.arc === g.arc), `${zone.id}：${g.arc}`)
  }
  const at = (id, arc) => ({ ...STAGES[0], id, arc })
  const odd = [at('a', 'X'), at('b', 'Y'), at('c', 'X')]
  assert.deepEqual(arcsOf(STAGES[0].zone, odd).map((g) => [g.arc, g.stages.map((s) => s.id)]), [['X', ['a', 'c']], ['Y', ['b']]])
})

test('「两条路线怎么分」：共用的合成一行，分路线的一关一行，每关都有说明', () => {
  for (const zone of ZONES) {
    const own = STAGES.filter((s) => s.zone === zone.id)
    const { shared, split } = routeSplitOf(zone.id)
    if (zone.routes === 'syntax') {
      // 新手村不分路线：没有这张表
      assert.deepEqual({ shared, split }, { shared: [], split: [] })
      continue
    }
    assert.ok(split.length > 0 && shared.length > 0, zone.id)
    // 两部分合起来正好是这个区域的全部关卡，各自按大纲顺序
    const ids = (list) => list.map((s) => s.id)
    assert.deepEqual(ids(shared), ids(own.filter((s) => routesOf(s) !== 'split')), zone.id)
    assert.deepEqual(ids(split.map((row) => row.stage)), ids(own.filter((s) => routesOf(s) === 'split')), zone.id)
    for (const { stage, note } of split) {
      assert.ok(note?.shared && note.hip && note.triton, `${stage.id} 分路线，outline.json 里要写 routeNote 的 shared、hip、triton`)
    }
    for (const stage of shared) assert.equal(stage.routeNote, undefined, `${stage.id} 两条路线共用，不该写 routeNote`)
  }
})

test('副本：每道题带上所在区域，上一道 / 下一道按分组顺序跨区域连着走', () => {
  assert.deepEqual(EXERCISE_LIST, EXERCISES.flatMap((g) => g.items))
  for (const g of EXERCISES) {
    assert.ok(g.items.every((e) => e.zone === g.zone), `${g.zone} 组里的题要带上 zone`)
    assert.deepEqual(exercisesOf(g.zone), g.items)
  }
  for (const e of EXERCISE_LIST) {
    assert.equal(exerciseById(e.id), e)
    assert.equal(exerciseHref(e), `/dungeon/${e.slug}/`)
  }

  const lastNovice = exercisesOf('novice').at(-1)
  const firstForge = exercisesOf('forge')[0]
  assert.equal(exerciseNeighbors(lastNovice.id).next, firstForge)
  assert.equal(exerciseNeighbors(firstForge.id).prev, lastNovice)
  assert.equal(exerciseNeighbors(EXERCISE_LIST[0].id).prev, null)
  assert.equal(exerciseNeighbors(EXERCISE_LIST.at(-1).id).next, null)
  assert.deepEqual(exerciseNeighbors('novice-thread-groups'), { prev: null, next: null }) // 关卡 id 不是副本
})
