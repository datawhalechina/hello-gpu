import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTask, validateTasks, availableTasks, waitingForAuthor, setField, appendToSection,
  RECORD_PLACEHOLDER, REVIEW_PLACEHOLDER,
} from '../refactor/task-lib.mjs'

function make({ id, status = 'todo', deps = [], gpu = false, owner = 'ai', order = 10, record = RECORD_PLACEHOLDER, checks = ['- [ ] 第一条'] }) {
  return `---
id: ${id}
title: 测试任务 ${id}
phase: 0
order: ${order}
area: ${owner === 'author' ? 'gate' : 'infra'}
status: ${status}
deps: [${deps.join(', ')}]
size: S
gpu: ${gpu}
owner: ${owner}
specs: [01-visual]
outputs: [a/b.ts]
updated: 2026-11-08
---

# ${id} 测试任务

## 目标

目标。

## 背景

- 背景。

## 要做的事

1. 做事。

## 验收标准

${checks.join('\n')}

## 验证方式

- \`npm test\`

## 完成记录

${record}

## 验收记录

${REVIEW_PLACEHOLDER}
`
}

const load = (id, opts = {}) => parseTask(make({ id, ...opts }), `refactor/tasks/${id}.md`)

test('解析 frontmatter、小节和验收清单', () => {
  const t = load('F-01', { deps: ['F-02', 'F-03'], checks: ['- [x] 做完了', '- [ ] 没做完'] })
  assert.equal(t.id, 'F-01')
  assert.equal(t.phase, 0)
  assert.equal(t.gpu, false)
  assert.deepEqual(t.deps, ['F-02', 'F-03'])
  assert.deepEqual(t.checks, { done: 1, total: 2, items: [{ ok: true, text: '做完了' }, { ok: false, text: '没做完' }] })
  assert.equal(t.recordFilled, false)
  assert.ok(t.sections['目标'].includes('目标'))
})

test('合法的任务集没有错误', () => {
  const tasks = [load('F-01'), load('F-02', { deps: ['F-01'] }), load('FG-LAB-01', { deps: ['F-02'] }), load('F-05a')]
  assert.deepEqual(validateTasks(tasks, { specNames: ['01-visual'] }), [])
})

test('发现缺失依赖、循环依赖、文件名不一致和未知规范', () => {
  const a = load('F-01', { deps: ['F-02'] })
  const b = load('F-02', { deps: ['F-01', 'F-99'] })
  const c = parseTask(make({ id: 'F-03' }), 'refactor/tasks/F-04.md')
  const errors = validateTasks([a, b, c], { specNames: ['02-motion'] })
  assert.ok(errors.some((e) => e.includes('依赖 F-99 不存在')))
  assert.ok(errors.some((e) => e.startsWith('循环依赖')))
  assert.ok(errors.some((e) => e.includes('文件名应与编号一致')))
  assert.ok(errors.some((e) => e.includes('规范 01-visual 不存在')))
})

test('待验收但没写完成记录时报错', () => {
  const errors = validateTasks([load('F-01', { status: 'review' })])
  assert.ok(errors.some((e) => e.includes('完成记录')))
})

test('可开始的任务：依赖满足（待验收也算）、按 order 排序、可过滤 GPU 和作者任务', () => {
  const tasks = [
    load('F-01', { status: 'review', order: 10 }),
    load('F-02', { deps: ['F-01'], order: 30 }),
    load('F-03', { deps: ['F-02'], order: 20 }),
    load('R-01', { gpu: true, order: 5 }),
    load('G-01', { owner: 'author', deps: ['F-01'], order: 1 }),
  ]
  assert.deepEqual(availableTasks(tasks, { gpu: true }).map((t) => t.id), ['R-01', 'F-02'])
  assert.deepEqual(availableTasks(tasks, { gpu: false }).map((t) => t.id), ['F-02'])
  assert.deepEqual(waitingForAuthor(tasks).map((t) => t.id), ['G-01', 'F-01'])
})

test('写回状态和验收记录时只改相关部分', () => {
  const src = make({ id: 'F-01', status: 'review', record: '- 做完了' })
  let next = setField(src, 'status', 'doing')
  next = appendToSection(next, '验收记录', '- 2026-11-09 不通过：按钮太小')
  const t = parseTask(next, 'refactor/tasks/F-01.md')
  assert.equal(t.status, 'doing')
  assert.equal(t.sections['验收记录'], '- 2026-11-09 不通过：按钮太小')
  assert.equal(t.sections['完成记录'], '- 做完了')
  next = appendToSection(next, '验收记录', '- 2026-11-10 通过')
  assert.equal(parseTask(next).sections['验收记录'], '- 2026-11-09 不通过：按钮太小\n- 2026-11-10 通过')
})

test('到达的作者关口：依赖满足、未完成；关口没完成时后续任务不能开始', async () => {
  const { pendingGates } = await import('../refactor/task-lib.mjs')
  const tasks = [
    load('F-01', { status: 'review', order: 10 }),
    load('G-01', { owner: 'author', deps: ['F-01'], order: 20 }),
    load('NV-01', { deps: ['G-01'], order: 30 }),
    load('S-01', { deps: ['F-01'], order: 40 }),
  ]
  assert.deepEqual(pendingGates(tasks).map((t) => t.id), ['G-01'])
  assert.deepEqual(availableTasks(tasks).map((t) => t.id), ['S-01'])
  tasks[1] = load('G-01', { owner: 'author', deps: ['F-01'], order: 20, status: 'done' })
  assert.deepEqual(pendingGates(tasks), [])
  assert.deepEqual(availableTasks(tasks).map((t) => t.id), ['NV-01', 'S-01'])
})

test('工作分支、关卡 id 推断、outline 状态改写、完成记录摘要', async () => {
  const { workBranch, stageIdsOf, setStageStatusText, recordNotes } = await import('../refactor/task-lib.mjs')
  const tasks = [
    load('F-01', { status: 'done', order: 10 }),
    load('G-01', { owner: 'author', deps: ['F-01'], order: 20, status: 'done' }),
    load('G-02', { owner: 'author', deps: ['G-01'], order: 30 }),
  ]
  assert.equal(workBranch(tasks).name, 'work/G-02')
  tasks[2] = load('G-02', { owner: 'author', deps: ['G-01'], order: 30, status: 'done' })
  assert.equal(workBranch(tasks), null)

  assert.deepEqual(stageIdsOf({ area: 'novice', outputs: ['docs/novice/wavefront/', 'scripts/tests/x.mjs'] }), ['novice-wavefront'])
  assert.deepEqual(stageIdsOf({ area: 'lab', outputs: ['docs/forge/softmax/'] }), [])

  const text = '[\n  { "id": "novice-a", "status": "draft" },\n  { "id": "novice-b", "status": "draft" }\n]\n'
  const next = setStageStatusText(text, 'novice-b', 'draft', 'ready')
  assert.equal(next, '[\n  { "id": "novice-a", "status": "draft" },\n  { "id": "novice-b", "status": "ready" }\n]\n')
  assert.equal(setStageStatusText(text, 'novice-x', 'draft', 'ready'), text)

  const t = parseTask(make({ id: 'F-02', record: '- 做了什么：A\n- 待确认：按钮颜色\n- 遗留问题：无' }))
  assert.deepEqual(recordNotes(t, '待确认'), ['按钮颜色'])
  assert.deepEqual(recordNotes(t, '遗留问题'), [])
})
