import assert from 'node:assert/strict'
import test from 'node:test'
import { STAGES, ZONES, arcsOf } from '../../docs/course/outline.ts'
import { applyPlacement, emptyState } from '../../docs/course/progress.ts'
import { whereAmI } from '../../docs/course/journey.ts'
import { PLACEMENT, codeOf, isCorrect, nextGroup, passMark, placementResult, scoreGroup } from '../../docs/course/placement.ts'
import { parse } from '../../docs/sim/syntax/index.ts'
import { formatError } from '../../docs/sim/syntax/errors.ts'
import { MAX_GUESS_PASS, checkPlacement, guessPassChance, loadCourseData } from '../course/course-data-check.mjs'

const AT = 1_762_000_000_000
const data = loadCourseData()

const groupOf = (zone) => PLACEMENT.groups.find((g) => g.zone === zone)
const rightChoice = (q) => q.options.findIndex((o) => o.correct)
const wrongChoice = (q) => q.options.findIndex((o) => !o.correct)
const zoneStages = (zone) => STAGES.filter((s) => s.zone === zone).map((s) => s.id)
const zoneLv = (zone) => ZONES.find((z) => z.id === zone).lv

/** 按 picks 作答一组：true 答对，false 答错，null 选「不会」；picks 比题少时，后面的题不答。 */
function answersFor(zone, picks) {
  const answers = {}
  groupOf(zone).questions.forEach((q, i) => {
    if (i >= picks.length) return
    answers[q.id] = picks[i] === null ? null : picks[i] ? rightChoice(q) : wrongChoice(q)
  })
  return answers
}

const allRight = (zone) => answersFor(zone, groupOf(zone).questions.map(() => true))
const allZonesRight = () => Object.assign({}, ...ZONES.map((z) => allRight(z.id)))

// ── 题库本身 ──────────────────────────────────────────────────────────────

test('每个区域的每个 arc 至少有一道题（Q-01 验收标准）', () => {
  for (const zone of ZONES) {
    const linked = new Set(groupOf(zone.id).questions.flatMap((q) => q.stages))
    for (const { arc, stages } of arcsOf(zone.id)) {
      assert.ok(stages.some((s) => linked.has(s.id)), `${zone.name}的「${arc}」没有题`)
    }
  }
})

test('读代码题：新手村两种写法是模拟器解析出的同一个程序；页面按读者的写法取代码，没有这种写法就取有的那种', () => {
  // 两种写法的位置必然不同，比较语法树时去掉 loc（同 sim-syntax.test.mjs）。
  const shape = (node) => JSON.parse(JSON.stringify(node, (key, value) => (key === 'loc' ? undefined : value)))
  for (const q of groupOf('novice').questions.filter((x) => x.kind === 'code')) {
    const hip = parse(codeOf(q, 'hip').text, 'hip')
    assert.ok(hip.ok, hip.ok ? '' : `${q.id} 的 HIP 写法解析失败：${formatError(hip.error)}`)
    const py = parse(codeOf(q, 'python').text, 'python', hip.signature)
    assert.ok(py.ok, py.ok ? '' : `${q.id} 的 Python 写法解析失败：${formatError(py.error)}`)
    assert.deepEqual(shape(py.kernel), shape(hip.kernel), q.id)
  }

  const timing = PLACEMENT.groups.flatMap((g) => g.questions).find((q) => q.code && !q.code.hip)
  assert.equal(codeOf(timing, 'hip').lang, Object.keys(timing.code)[0])
  assert.equal(codeOf(groupOf('novice').questions.find((q) => q.kind !== 'code'), 'hip'), null)
})

// ── 计分与推荐 ────────────────────────────────────────────────────────────

test('零基础：答错到达不了及格线就停下，推荐第一关和最低等级；没通过的组里蒙对的题也不豁免', () => {
  const novice = groupOf('novice')
  assert.equal(nextGroup({}), novice)
  // 再错这么多题，剩下的全答对也不够及格。
  const misses = novice.questions.length - passMark(novice.questions.length, PLACEMENT.passRate) + 1
  const picks = [true, ...Array(misses).fill(null)]
  assert.equal(scoreGroup(novice, answersFor('novice', picks.slice(0, -1))).done, false)

  const answers = answersFor('novice', picks)
  const score = scoreGroup(novice, answers)
  assert.deepEqual([score.correct, score.passed, score.done], [1, false, true])
  assert.equal(nextGroup(answers), null)
  // 第一关（1-1）：零基础读者要从这里开始（Q-02 验收标准）。
  assert.deepEqual(placementResult(answers), {
    zone: 'novice', level: zoneLv('novice')[0], stage: STAGES[0].id, exempt: [], gaps: [], groups: [score],
  })
})

test('新手村全对、铸造城差一题：从铸造城第一关开始，新手村整个区域豁免（含 Boss），铸造城答对的题不豁免', () => {
  const forge = groupOf('forge')
  assert.equal(nextGroup(allRight('novice')), forge)
  const needed = passMark(forge.questions.length, PLACEMENT.passRate)
  const answers = { ...allRight('novice'), ...answersFor('forge', forge.questions.map((_, i) => i < needed - 1)) }
  assert.equal(nextGroup(answers), null)

  const r = placementResult(answers)
  assert.deepEqual([r.zone, r.level, r.stage, r.gaps], ['forge', zoneLv('forge')[0], zoneStages('forge')[0], []])
  assert.deepEqual(r.exempt, zoneStages('novice'))
  assert.deepEqual(r.groups.map((g) => [g.zone, g.passed]), [['novice', true], ['forge', false]])
})

test('通过了的组里答错的题：挂着的关卡不豁免，推荐关卡先补它们；Boss 照样豁免', () => {
  const missed = groupOf('novice').questions[3]
  const answers = { ...allRight('novice'), [missed.id]: wrongChoice(missed) }
  const r = placementResult(answers)
  assert.equal(r.zone, 'forge')
  assert.deepEqual(r.gaps, missed.stages)
  assert.equal(r.stage, missed.stages[0])
  assert.deepEqual(r.exempt, zoneStages('novice').filter((id) => !missed.stages.includes(id)))
})

test('三组全对：不推荐区域，等级是最后一个区域推荐等级的上限，全部关卡豁免', () => {
  const answers = allZonesRight()
  assert.equal(nextGroup(answers), null)
  const r = placementResult(answers)
  assert.deepEqual([r.zone, r.level, r.stage, r.gaps], [null, ZONES.at(-1).lv[1], null, []])
  assert.deepEqual(r.exempt, STAGES.map((s) => s.id))
})

test('确认定级以后，地图的「你在这」就是推荐关卡', () => {
  const missed = groupOf('novice').questions[5]
  const scenarios = [
    answersFor('novice', [null, null, null]),
    allRight('novice'),
    { ...allRight('novice'), [missed.id]: null },
    allZonesRight(),
  ]
  for (const answers of scenarios) {
    const r = placementResult(answers)
    const state = emptyState(AT)
    applyPlacement(state, r.level, { exempt: r.exempt, at: AT })
    assert.equal(whereAmI(state)?.stage.id ?? null, r.stage)
  }
})

test('及格线：恰好答对要求的题数就通过，少一题就停下；0.07 × 100 这样的浮点误差不多要一题', () => {
  assert.deepEqual([passMark(8, 0.7), passMark(7, 0.7), passMark(6, 0.7), passMark(8, 0.75)], [6, 5, 5, 6])
  // 0.07 × 100 在浮点里比 7 多一点点，直接向上取整会要 8 题。
  assert.equal(passMark(100, 0.07), 7)

  const forge = groupOf('forge')
  const needed = passMark(forge.questions.length, PLACEMENT.passRate)
  const exactly = { ...allRight('novice'), ...answersFor('forge', forge.questions.map((_, i) => i < needed)) }
  assert.deepEqual([scoreGroup(forge, exactly).passed, scoreGroup(forge, exactly).done], [true, true])
  assert.equal(nextGroup(exactly), groupOf('trial'))

  const short = { ...allRight('novice'), ...answersFor('forge', forge.questions.map((_, i) => i < needed - 1)) }
  assert.equal(scoreGroup(forge, short).passed, false)
  assert.equal(placementResult(short).zone, 'forge')
})

test('中途退出照样算：没答的题算答错；「不会」、不存在的选项、不是数字的作答、原型上的键都不算答对', () => {
  const forge = groupOf('forge')
  const needed = passMark(forge.questions.length, PLACEMENT.passRate)
  // 铸造城答对及格的题数就退出：这组已经通过，还没答的题挂着的关卡不豁免。
  const partial = { ...allRight('novice'), ...answersFor('forge', Array(needed).fill(true)) }
  assert.deepEqual([scoreGroup(forge, partial).passed, scoreGroup(forge, partial).done], [true, false])
  assert.equal(nextGroup(partial), forge)
  const r = placementResult(partial)
  const unanswered = new Set(forge.questions.slice(needed).flatMap((q) => q.stages))
  assert.equal(r.zone, 'trial')
  assert.deepEqual(r.gaps, zoneStages('forge').filter((id) => unanswered.has(id)))

  const q = forge.questions[0]
  for (const choice of [null, undefined, -1, q.options.length, 0.5, String(rightChoice(q))]) {
    assert.equal(isCorrect(q, choice), false, String(choice))
  }
  assert.equal(scoreGroup(forge, { 'not-a-question': 0 }).answered, 0)
  assert.equal(scoreGroup(forge, Object.create({ [q.id]: rightChoice(q) })).answered, 0)
})

// ── 题库检查 ──────────────────────────────────────────────────────────────

const bank = data.placement
const check = (placement) => checkPlacement(placement, { outline: data.outline, bannedWords: data.bannedWords })
const hasError = (errors, text) => errors.some((e) => e.includes(text))
const findQuestion = (id) => bank.groups.flatMap((g) => g.questions).find((q) => q.id === id)

/** 改一组题（按区域找），别的照抄。 */
function groupWith(zone, patch) {
  return { ...bank, groups: bank.groups.map((g) => (g.zone === zone ? { ...g, ...patch } : g)) }
}

/** 改一道题，别的照抄；patch 里写成 undefined 的字段算没写。 */
function questionWith(id, patch) {
  const group = bank.groups.find((g) => g.questions.some((q) => q.id === id))
  return groupWith(group.zone, { questions: group.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) })
}

/** 改一道题的选项：edit 拿到选项的副本，返回新的选项列表。 */
function optionsWith(id, edit) {
  return questionWith(id, { options: edit(findQuestion(id).options.map((o) => ({ ...o }))) })
}

test('题库检查：一个区域一组、按大纲的区域顺序，每组 6–8 题，passRate 在 0 和 1 之间', () => {
  const [novice, forge, trial] = bank.groups
  assert.ok(hasError(check({ ...bank, groups: [novice, trial, forge] }), 'groups 要按大纲的区域顺序一个区域一组'))
  assert.ok(hasError(check({ ...bank, groups: [novice, forge] }), '现在是 novice、forge'))
  assert.ok(hasError(check(groupWith('novice', { questions: novice.questions.slice(0, 5) })), 'placement.json 新手村组：每组 6–8 题，现在有 5 题'))
  const extra = { ...forge.questions[0], id: 'forge-extra-one', stages: ['forge-your-gpu'] }
  assert.ok(hasError(check(groupWith('forge', { questions: [...forge.questions, extra, { ...extra, id: 'forge-extra-two' }] })), '现在有 9 题'))
  for (const passRate of [0, 1.2, '0.7']) {
    assert.ok(hasError(check({ ...bank, passRate }), 'passRate 是一组至少要答对的比例'), JSON.stringify(passRate))
  }
  assert.deepEqual(check({ ...bank, passRate: 1 }), [])
  assert.ok(hasError(check({ ...bank, threshold: 0.8 }), 'placement.json：多了字段 threshold'))
})

test('题库检查：id 的形状和重复，题型只有三种，题干不能空，字段不能少也不能多', () => {
  const id = bank.groups[0].questions[0].id
  assert.ok(hasError(check(questionWith(id, { id: 'Novice_1' })), 'id 要用小写字母、数字和连字符'))
  assert.ok(hasError(check(questionWith('forge-few-blocks', { id })), `placement.json 题目 ${id}：id 重复`))
  assert.ok(hasError(check(questionWith(id, { kind: 'judge' })), 'kind 只能是 choice（选择）、estimate（估值）、code（读代码）'))
  assert.ok(hasError(check(questionWith(id, { q: ' ' })), '题干 q 不能是空的'))
  assert.ok(hasError(check(questionWith(id, { options: undefined })), `placement.json 题目 ${id}：缺少字段 options`))
  assert.ok(hasError(check(questionWith(id, { hint: '想想依赖' })), `placement.json 题目 ${id}：多了字段 hint`))
})

test('题库检查：每题挂 1–3 关，同一个区域、不挂 Boss、按大纲顺序；Boss 以外每关恰好挂在一道题上', () => {
  const withStages = (stages) => check(questionWith('novice-who-writes', { stages }))
  assert.ok(hasError(withStages([]), '要列出答对后可以豁免的 1–3 关'))
  assert.ok(hasError(withStages(['novice-assign-threads', 'novice-thread-groups', 'novice-wavefront', 'novice-divergence']), '1–3 关'))
  assert.ok(hasError(withStages(['novice-assign-threads', 'novice-nowhere']), '关卡「novice-nowhere」不在 outline.json 里'))
  assert.ok(hasError(withStages(['novice-assign-threads', 'novice-thread-groups', 'forge-fusion']), '关卡「forge-fusion」在铸造城，这道题在新手村组'))
  assert.ok(hasError(withStages(['novice-assign-threads', 'novice-thread-groups', 'novice-boss']), '不要挂 Boss 关「novice-boss」'))
  assert.ok(hasError(withStages(['novice-thread-groups', 'novice-assign-threads']), '按大纲顺序排，「novice-assign-threads」排错了位置'))
  assert.ok(hasError(withStages(['novice-thread-groups', 'novice-thread-groups']), '关卡「novice-thread-groups」写了两次'))
  // 1-3 只挂在后面那道题上，没有题能豁免它。
  assert.ok(hasError(withStages(['novice-thread-groups']), '关卡「novice-assign-threads」（1-3）没有挂在任何一道题上'))
  const twice = check(questionWith('novice-split-path', { stages: ['novice-thread-groups', 'novice-wavefront', 'novice-divergence'] }))
  assert.ok(hasError(twice, '关卡「novice-thread-groups」已经挂在 novice-who-writes 上了'))
})

test('题库检查：选项 3–5 个，每个都写解释，恰好一个正确，选项不重复', () => {
  const id = 'forge-three-kernels'
  assert.ok(hasError(check(optionsWith(id, (options) => options.slice(0, 2))), 'options 要有 3–5 个选项'))
  const six = optionsWith(id, (options) => [...options, { label: '0.2 GB', why: '少数了一半。' }, { label: '4.8 GB', why: '多数了一倍。' }])
  assert.ok(hasError(check(six), 'options 要有 3–5 个选项'))
  const noWhy = optionsWith(id, (options) => options.map((o, i) => (i === 0 ? { ...o, why: '' } : o)))
  assert.ok(hasError(check(noWhy), `placement.json 题目 ${id} 第 1 个选项：每个选项都要写 why`))
  const none = optionsWith(id, (options) => options.map(({ correct, ...o }) => o))
  assert.ok(hasError(check(none), '要恰好一个正确选项（correct: true），现在有 0 个'))
  const two = optionsWith(id, (options) => options.map(({ correct, ...o }, i) => (i < 2 ? { ...o, correct: true } : o)))
  assert.ok(hasError(check(two), '现在有 2 个'))
  const falsy = optionsWith(id, (options) => options.map((o) => (o.correct ? o : { ...o, correct: false })))
  assert.ok(hasError(check(falsy), 'correct 只写在正确选项上'))
  const same = optionsWith(id, (options) => options.map((o, i) => (i === 1 ? { ...o, label: options[0].label } : o)))
  assert.ok(hasError(check(same), `「${findQuestion(id).options[0].label}」和前面的选项重复`))
})

test('题库检查：只有读代码题写代码，新手村两种写法都给；每组三种题型都要有', () => {
  const code = findQuestion('novice-who-writes').code
  assert.ok(hasError(check(questionWith('novice-who-writes', { code: { hip: code.hip } })), '新手村的代码 hip、python 两种写法都要给，缺少 python'))
  assert.ok(hasError(check(questionWith('novice-who-writes', { code: undefined })), '读代码题要写 code'))
  assert.ok(hasError(check(questionWith('novice-who-writes', { code: { ...code, cuda: code.hip } })), 'code 的写法只能是 hip、python、asm，现在有「cuda」'))
  assert.ok(hasError(check(questionWith('novice-who-writes', { code: { ...code, python: [''] } })), 'code.python 要是一行一行的字符串数组，不能是空的'))
  assert.ok(hasError(check(questionWith('novice-two-jobs', { code })), '只有读代码题（kind 是 code）写 code'))

  const noEstimate = groupWith('novice', { questions: bank.groups[0].questions.map((q) => (q.kind === 'estimate' ? { ...q, kind: 'choice' } : q)) })
  assert.ok(hasError(check(noEstimate), 'placement.json 新手村组：选择、估值、读代码三种题型都要有，缺少估值题'))
})

test('题库检查：随便选就能蒙过一组的不行；题干、选项和解释不写禁用词', () => {
  // 每题随便选：两道两选一的题至少蒙对一道是 3/4，一道三选一蒙对是 1/3。
  assert.equal(guessPassChance([2, 2], 1), 0.75)
  assert.equal(guessPassChance([3], 1), 1 / 3)
  assert.equal(guessPassChance([4, 4, 4], 0), 1)
  const loose = check({ ...bank, passRate: 0.3 })
  assert.ok(hasError(loose, `的机会通过这一组，不能超过 ${MAX_GUESS_PASS * 100}%`))

  const banned = optionsWith('novice-two-jobs', (options) => options.map((o, i) => (i === 0 ? { ...o, why: `显然，${o.why}` } : o)))
  assert.ok(hasError(check(banned), 'placement.json 题目 novice-two-jobs：不要写「显然」'))
  assert.ok(hasError(check(questionWith('novice-two-jobs', { q: '让我们一起算一算：两张单子谁快？' })), '不要写「让我们一起」'))
})
