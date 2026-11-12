import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHECKED_STATUS, DUNGEON_DIR, DUNGEON_SKELETON, EVIDENCE_KINDS, MAX_CODE_LINES, checkBannedWords, checkComponents,
  checkDungeonPage, checkExternalPage, checkStagePage, checkStages, dungeonPagePath, dungeonSkeletonFor, externalPagePath,
  listDungeonPages, listExternalPages, loadStageData, scanMarkdown, skeletonFor,
} from '../course/stage-check.mjs'

// 组件登记表和禁用词表用仓库里真的那两份（这样样例写的是真组件、真禁用词），
// 大纲和术语表用下面几关、两道副本的小样例，免得单测跟着课程内容变。
const repo = loadStageData()

const outline = {
  zones: [
    { id: 'novice', name: '新手村' },
    { id: 'forge', name: '铸造城' },
  ],
  stages: [
    { id: 'novice-demo', zone: 'novice', slug: 'demo', code: '1-1', title: '示例关', gpu: false, status: 'draft' },
    { id: 'forge-demo', zone: 'forge', slug: 'demo', code: '2-1', title: '真卡关', gpu: true, status: 'draft' },
    { id: 'novice-later', zone: 'novice', slug: 'later', code: '1-2', title: '还没写', gpu: false, status: 'planned' },
  ],
  // 副本样例都是 planned（只有占位页）：关卡的全仓库测试不用给副本页，副本的全仓库测试用 withExerciseStatus 改成上线。
  exercises: [
    {
      zone: 'novice',
      practice: '下标',
      items: [
        { id: 'dungeon-scale', slug: 'scale', title: '示例副本', practice: '下标和边界检查', difficulty: 1, xp: 50, stages: ['novice-demo'], env: 'sim', status: 'planned' },
      ],
    },
    {
      zone: 'forge',
      practice: '访存方向',
      items: [
        { id: 'dungeon-row-sum', slug: 'row-sum', title: '真卡副本', practice: '访存方向', difficulty: 2, xp: 100, stages: ['forge-demo'], env: 'gpu', status: 'planned' },
      ],
    },
  ],
}
const glossary = { block: {}, grid: {}, 'global-index': {}, kernel: {} }

const NOVICE = 'docs/novice/demo/index.md'
const FORGE = 'docs/forge/demo/index.md'

/** frontmatter 每项一行（值是 null 的项不写），空一行接正文。 */
function withFrontmatter(front, body) {
  const lines = Object.entries(front)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`
}

/** 一份合格的新手村关卡页；每条测试只改它的一处。 */
function page({ fm = {}, body = goodBody() } = {}) {
  return withFrontmatter({ layout: 'stage', stage: 'novice-demo', newTerms: '[block, grid]', evidence: 'simulated', ...fm }, body)
}

function goodBody({ code = '1-1', title = '示例关', lab = false } = {}) {
  return [
    `# ${code} ${title}`,
    '',
    '<Mission>把 10 个数交给机器人算完。</Mission>',
    '',
    '## 热身',
    '',
    '<Predict id="p-groups">先猜：要派几组机器人？</Predict>',
    '',
    '## 原理',
    '',
    '<ConceptCard term="block">一组派到同一个车间的机器人。</ConceptCard>',
    '',
    '## 挑战',
    '',
    lab ? '<LabCard stage="forge-demo" />' : '<Knob label="每组人数" :min="1" :max="8" />',
    '',
    '## 检查点',
    '',
    '<Checkpoint :items="[]" />',
    '',
    '<EvidenceCard kind="simulated">这一页的数字来自浏览器里的模拟器。</EvidenceCard>',
  ].join('\n')
}

function check(text, file = NOVICE) {
  return checkStagePage({ file, text, outline, glossary, components: repo.components, bannedWords: repo.bannedWords })
}

function messages(errors) {
  return errors.map((e) => e.message)
}

function hasError(errors, text) {
  return messages(errors).some((m) => m.includes(text))
}

// ── 合格的样例 ────────────────────────────────────────────────────────────

test('合格的新手村关卡页没有任何问题', () => {
  assert.deepEqual(messages(check(page())), [])
})

test('合格的真卡关卡页（骨架里有 LabCard）没有任何问题', () => {
  const text = page({
    fm: { stage: 'forge-demo', newTerms: '[kernel]' },
    body: goodBody({ code: '2-1', title: '真卡关', lab: true }),
  })
  assert.deepEqual(messages(check(text, FORGE)), [])
})

// ── frontmatter（06 第 2 节）──────────────────────────────────────────────

test('frontmatter：layout 必须是 stage', () => {
  assert.deepEqual(messages(check(page())), [])
  const errors = check(page({ fm: { layout: 'doc' } }))
  assert.ok(hasError(errors, 'layout 要写 stage'))
  assert.equal(errors.find((e) => e.message.includes('layout')).line, 2)
})

test('frontmatter：缺 frontmatter 时报一次总的', () => {
  assert.ok(hasError(check(goodBody()), '缺少 frontmatter'))
})

test('frontmatter：stage 要存在、要在大纲里、要和目录一致', () => {
  assert.deepEqual(messages(check(page())), [])
  assert.ok(hasError(check(page({ fm: { stage: null } })), '缺少 stage'))
  assert.ok(hasError(check(page({ fm: { stage: 'novice-typo' } })), 'novice-typo 在 docs/course/outline.json 里找不到'))
  assert.ok(hasError(check(page({ fm: { stage: 'forge-demo' } })), '和目录对不上'))
})

test('newTerms：都要在术语表里，新手村不超过 3 个', () => {
  assert.deepEqual(messages(check(page({ fm: { newTerms: '[block, grid, kernel]' } }))), [])
  assert.ok(hasError(check(page({ fm: { newTerms: '[block, wavefront]' } })), 'wavefront 不在 docs/course/glossary.json 里'))
  assert.ok(hasError(check(page({ fm: { newTerms: '[block, grid, kernel, global-index]' } })), '新手村每关新术语不超过 3 个'))
  assert.ok(hasError(check(page({ fm: { newTerms: null } })), '缺少 newTerms'))
  assert.ok(hasError(check(page({ fm: { newTerms: 'block' } })), 'newTerms 要写成数组'))
})

test('newTerms：铸造城不受 3 个的限制', () => {
  const text = page({
    fm: { stage: 'forge-demo', newTerms: '[block, grid, kernel, global-index]' },
    body: goodBody({ code: '2-1', title: '真卡关', lab: true }),
  })
  assert.deepEqual(messages(check(text, FORGE)), [])
})

test('evidence：只能是 simulated、measured、mixed', () => {
  for (const kind of EVIDENCE_KINDS) {
    assert.deepEqual(messages(check(page({ fm: { evidence: kind } }))), [], kind)
  }
  assert.ok(hasError(check(page({ fm: { evidence: 'guessed' } })), 'evidence: guessed 不合法'))
  assert.ok(hasError(check(page({ fm: { evidence: null } })), '缺少 evidence'))
})

// ── 骨架（06 第 3 节）─────────────────────────────────────────────────────

test('正文以「# 编号 名称」开头', () => {
  assert.deepEqual(messages(check(page())), [])
  assert.ok(hasError(check(page({ body: goodBody({ title: '示例关卡' }) })), '正文标题要写「# 1-1 示例关」'))
  assert.ok(hasError(check(page({ body: goodBody().split('\n').slice(1).join('\n') })), '正文要以「# 1-1 示例关」开头'))
})

test('骨架：Mission、Predict、ConceptCard、Checkpoint、EvidenceCard 缺一不可', () => {
  assert.deepEqual(messages(check(page())), [])
  for (const name of ['Mission', 'Predict', 'ConceptCard', 'Checkpoint', 'EvidenceCard']) {
    const body = goodBody().split('\n').filter((l) => !l.includes(`<${name}`)).join('\n')
    assert.ok(hasError(check(page({ body })), `骨架缺少 <${name}>`), name)
  }
})

test('骨架：按 06 第 3 节的顺序出现', () => {
  assert.deepEqual(messages(check(page())), [])
  const lines = goodBody().split('\n')
  const mission = lines.findIndex((l) => l.includes('<Mission'))
  const predict = lines.findIndex((l) => l.includes('<Predict'))
  const swapped = [...lines]
  swapped[mission] = lines[predict]
  swapped[predict] = lines[mission]
  const errors = check(page({ body: swapped.join('\n') }))
  assert.ok(hasError(errors, '<Predict> 出现在 <Mission> 前面'))
})

test('骨架：真卡关卡要有 LabCard，模拟器关卡不要求', () => {
  assert.equal(skeletonFor({ gpu: true }).includes('LabCard'), true)
  assert.equal(skeletonFor({ gpu: false }).includes('LabCard'), false)
  const text = page({ fm: { stage: 'forge-demo', newTerms: '[kernel]' }, body: goodBody({ code: '2-1', title: '真卡关' }) })
  assert.ok(hasError(check(text, FORGE), '骨架缺少 <LabCard>'))
  assert.deepEqual(messages(check(page())), [])
})

// ── 组件登记表（03 第 3 节）───────────────────────────────────────────────

test('组件：没登记的组件报错，登记过的和内置标签放行', () => {
  const body = goodBody().replace('## 热身', '## 热身\n\n<MagicChart :data="[]" />')
  assert.ok(hasError(check(page({ body })), '<MagicChart> 不在组件登记表里'))
  const ok = goodBody().replace('## 热身', '## 热身\n\n<ClientOnly><DeepDive title="深入一点">细节。</DeepDive></ClientOnly>')
  assert.deepEqual(messages(check(page({ body: ok }))), [])
})

test('组件：代码块和行内代码里的标签不算组件', () => {
  const fenced = goodBody().replace('## 热身', ['## 热身', '', '```md', '<MagicChart />', '```'].join('\n'))
  assert.deepEqual(messages(check(page({ body: fenced }))), [])
  const inline = goodBody().replace('## 热身', '## 热身\n\n写成 `<MagicChart />` 就行。')
  assert.deepEqual(messages(check(page({ body: inline }))), [])
  const commented = goodBody().replace('## 热身', '## 热身\n\n<!-- <MagicChart /> 以后再说 -->')
  assert.deepEqual(messages(check(page({ body: commented }))), [])
})

test('组件：本页 import 的 scenes 组件放行', () => {
  const body = [
    '<script setup>',
    "import GroupPlay from './scenes/GroupPlay.vue'",
    '</script>',
    '',
    goodBody().replace('## 热身', '## 热身\n\n<GroupPlay :n="10" />'),
  ].join('\n')
  assert.deepEqual(messages(check(page({ body }))), [])
  const noImport = goodBody().replace('## 热身', '## 热身\n\n<GroupPlay :n="10" />')
  assert.ok(hasError(check(page({ body: noImport })), '<GroupPlay> 不在组件登记表里'))
})

// ── 代码块长度（05 第 1 节、06 第 4 节）───────────────────────────────────

test('新手村单个代码块不超过 10 行', () => {
  const codeOf = (n) => ['```cpp', ...Array.from({ length: n }, (_, i) => `int a${i} = ${i};`), '```'].join('\n')
  const bodyWith = (n) => goodBody().replace('## 挑战', `## 挑战\n\n${codeOf(n)}`)
  assert.deepEqual(messages(check(page({ body: bodyWith(MAX_CODE_LINES.novice) }))), [])
  const errors = check(page({ body: bodyWith(MAX_CODE_LINES.novice + 1) }))
  assert.ok(hasError(errors, '新手村单个代码块不超过 10 行，这一块有 11 行'))
})

test('铸造城不查 10 行的上限', () => {
  const code = ['```cpp', ...Array.from({ length: 20 }, (_, i) => `int a${i} = ${i};`), '```'].join('\n')
  const body = goodBody({ code: '2-1', title: '真卡关', lab: true }).replace('## 挑战', `## 挑战\n\n${code}`)
  const text = page({ fm: { stage: 'forge-demo', newTerms: '[kernel]' }, body })
  assert.deepEqual(messages(check(text, FORGE)), [])
})

// ── 禁用词（05 第 5 节）───────────────────────────────────────────────────

test('禁用词：正文里出现就报错，带行号', () => {
  const body = goodBody().replace('## 原理', '## 原理\n\n显然，这里每个线程各算一份。')
  const errors = check(page({ body }))
  assert.ok(hasError(errors, '不要写「显然」'))
  const line = errors.find((e) => e.message.includes('显然')).line
  assert.equal(page({ body }).split('\n')[line - 1], '显然，这里每个线程各算一份。')
})

test('禁用词：省略号写法按正则匹配', () => {
  const body = goodBody().replace('## 原理', '## 原理\n\n这一版不仅更快，更省电。')
  assert.ok(hasError(check(page({ body })), '不要写「不仅更快，更」'))
  assert.deepEqual(messages(check(page({ body: goodBody().replace('## 原理', '## 原理\n\n这一版更快，也更省电。') }))), [])
})

test('禁用词：代码块和行内代码里的词不算', () => {
  const fenced = goodBody().replace('## 原理', ['## 原理', '', '```text', '显然 众所周知 赋能', '```'].join('\n'))
  assert.deepEqual(messages(check(page({ body: fenced }))), [])
  const inline = goodBody().replace('## 原理', '## 原理\n\n别写 `显然` 这种词。')
  assert.deepEqual(messages(check(page({ body: inline }))), [])
})

// ── 副本页（X-01）─────────────────────────────────────────────────────────

const SIM_DUNGEON = 'docs/dungeon/scale/index.md'
const GPU_DUNGEON = 'docs/dungeon/row-sum/index.md'

/** 一份合格的模拟器副本页（新手村的 dungeon-scale）；每条测试只改它的一处。 */
function dungeonPage({ fm = {}, body = dungeonBody() } = {}) {
  return withFrontmatter({ layout: 'dungeon', dungeon: 'dungeon-scale', evidence: 'simulated', ...fm }, body)
}

/** 一份合格的真卡副本页（铸造城的 dungeon-row-sum）。 */
function gpuDungeonPage({ fm = {}, body = dungeonBody({ title: '真卡副本', lab: true }) } = {}) {
  return dungeonPage({ fm: { dungeon: 'dungeon-row-sum', evidence: 'measured', ...fm }, body })
}

/** 副本页正文：题目 → 挑战（模拟器副本是 Sandbox，真卡副本是 LabCard）→ 题解 → 证据。 */
function dungeonBody({ title = '示例副本', lab = false } = {}) {
  return [
    `# ${title}`,
    '',
    '<Mission>把 n 个数都乘上 3，多派的线程什么都不做。</Mission>',
    '',
    '## 挑战',
    '',
    lab ? '<LabCard />' : '<Sandbox />',
    '',
    '## 题解',
    '',
    '<Solution>每个线程先算自己的全局下标，没越界才写。</Solution>',
    '',
    lab
      ? '<EvidenceCard kind="measured">这一页的数字来自实验室里的真卡。</EvidenceCard>'
      : '<EvidenceCard kind="simulated">这一页的数字来自浏览器里的模拟器。</EvidenceCard>',
  ].join('\n')
}

function checkDungeon(text, file = SIM_DUNGEON) {
  return checkDungeonPage({ file, text, outline, components: repo.components, bannedWords: repo.bannedWords })
}

/** 去掉正文里含 text 的行。 */
function dropLines(body, text) {
  return body.split('\n').filter((l) => !l.includes(text)).join('\n')
}

/** 把正文里第一处含 a 的行和第一处含 b 的行对调。 */
function swapLines(body, a, b) {
  const lines = body.split('\n')
  const i = lines.findIndex((l) => l.includes(a))
  const j = lines.findIndex((l) => l.includes(b))
  const swapped = [...lines]
  swapped[i] = lines[j]
  swapped[j] = lines[i]
  return swapped.join('\n')
}

test('合格的模拟器副本页没有任何问题', () => {
  assert.deepEqual(messages(checkDungeon(dungeonPage())), [])
})

test('合格的真卡副本页（骨架里有 LabCard）没有任何问题', () => {
  assert.deepEqual(messages(checkDungeon(gpuDungeonPage(), GPU_DUNGEON)), [])
})

test('副本页 frontmatter：layout 必须是 dungeon', () => {
  const errors = checkDungeon(dungeonPage({ fm: { layout: 'stage' } }))
  assert.ok(hasError(errors, 'layout 要写 dungeon，现在是 stage（X-01 副本页）'))
  assert.equal(errors.find((e) => e.message.includes('layout')).line, 2)
  assert.ok(hasError(checkDungeon(dungeonPage({ fm: { layout: null } })), 'layout 要写 dungeon，现在没写'))
  assert.ok(hasError(checkDungeon(dungeonBody()), '缺少 frontmatter：副本页要写 layout、dungeon、evidence 三项'))
})

test('副本页 frontmatter：dungeon 要写、要在 exercises 里、要和目录一致', () => {
  assert.ok(hasError(checkDungeon(dungeonPage({ fm: { dungeon: null } })), 'frontmatter 缺少 dungeon'))
  assert.ok(hasError(checkDungeon(dungeonPage({ fm: { dungeon: 'dungeon-typo' } })), 'dungeon: dungeon-typo 在 docs/course/outline.json 的 exercises 里找不到'))
  // 关卡 id 不是副本 id。
  assert.ok(hasError(checkDungeon(dungeonPage({ fm: { dungeon: 'novice-demo' } })), 'dungeon: novice-demo 在 docs/course/outline.json 的 exercises 里找不到'))
  const errors = checkDungeon(dungeonPage({ fm: { dungeon: 'dungeon-row-sum' } }))
  assert.ok(hasError(errors, 'dungeon: dungeon-row-sum 和目录对不上：docs/dungeon/scale/ 对应的是 dungeon-scale'))
  assert.equal(errors.find((e) => e.message.includes('对不上')).line, 3)
})

test('副本页 evidence：和关卡页同一条规则、同样的报错', () => {
  for (const kind of EVIDENCE_KINDS) {
    assert.deepEqual(messages(checkDungeon(dungeonPage({ fm: { evidence: kind } }))), [], kind)
  }
  const wrong = messages(checkDungeon(dungeonPage({ fm: { evidence: 'guessed' } })))
  assert.ok(hasOne(wrong, 'evidence: guessed 不合法'))
  assert.deepEqual(wrong, messages(check(page({ fm: { evidence: 'guessed' } }))))
  assert.ok(hasError(checkDungeon(dungeonPage({ fm: { evidence: null } })), '缺少 evidence'))
})

test('副本页正文以「# 题名」开头', () => {
  assert.deepEqual(messages(checkDungeon(dungeonPage())), [])
  const titled = checkDungeon(dungeonPage({ body: dungeonBody({ title: '1-1 示例副本' }) }))
  assert.ok(hasError(titled, '正文标题要写「# 示例副本」，现在是「# 1-1 示例副本」（X-01 副本页）'))
  const untitled = checkDungeon(dungeonPage({ body: dropLines(dungeonBody(), '# 示例副本') }))
  assert.ok(hasError(untitled, '正文要以「# 示例副本」开头（X-01 副本页）'))
})

test('副本骨架：Mission、Solution、EvidenceCard 缺一不可', () => {
  assert.deepEqual(DUNGEON_SKELETON, ['Mission', 'Solution', 'EvidenceCard'])
  for (const name of DUNGEON_SKELETON) {
    const errors = checkDungeon(dungeonPage({ body: dropLines(dungeonBody(), `<${name}`) }))
    assert.ok(hasError(errors, `骨架缺少 <${name}>`), name)
    assert.ok(hasError(errors, '（X-01 副本页，顺序 Mission → Solution → EvidenceCard）'), name)
  }
  const noSolution = checkDungeon(dungeonPage({ body: dropLines(dungeonBody(), '<Solution') }))
  assert.ok(hasError(noSolution, '题解放在 <Solution> 里，通关或看过答案才展开'))
})

test('副本骨架：按 Mission →（LabCard →）Solution → EvidenceCard 的顺序出现', () => {
  const sim = checkDungeon(dungeonPage({ body: swapLines(dungeonBody(), '<Mission', '<Solution') }))
  assert.ok(hasError(sim, '<Solution> 出现在 <Mission> 前面，骨架顺序应该是 Mission → Solution → EvidenceCard（X-01 副本页）'))
  const gpuBody = swapLines(dungeonBody({ title: '真卡副本', lab: true }), '<LabCard', '<Solution')
  const gpu = checkDungeon(gpuDungeonPage({ body: gpuBody }), GPU_DUNGEON)
  assert.ok(hasError(gpu, '<Solution> 出现在 <LabCard> 前面，骨架顺序应该是 Mission → LabCard → Solution → EvidenceCard'))
})

test('副本骨架：真卡副本要有 LabCard（排在题解前面），模拟器副本不要求', () => {
  assert.deepEqual(dungeonSkeletonFor({ env: 'gpu' }), ['Mission', 'LabCard', 'Solution', 'EvidenceCard'])
  assert.deepEqual(dungeonSkeletonFor({ env: 'sim' }), DUNGEON_SKELETON)
  const noLab = gpuDungeonPage({ body: dungeonBody({ title: '真卡副本' }) })
  assert.ok(hasError(checkDungeon(noLab, GPU_DUNGEON), '骨架缺少 <LabCard>：真卡副本的挑战是实验室入口（X-01 副本页，顺序 Mission → LabCard → Solution → EvidenceCard）'))
  assert.deepEqual(messages(checkDungeon(dungeonPage())), [])
})

test('副本页组件：没登记的组件报错，本页 import 的 scenes 组件放行', () => {
  const unregistered = dungeonBody().replace('## 挑战', '## 挑战\n\n<MagicChart :data="[]" />')
  assert.ok(hasError(checkDungeon(dungeonPage({ body: unregistered })), '<MagicChart> 不在组件登记表里'))
  const scene = [
    '<script setup>',
    "import ScaleChallenge from './scenes/ScaleChallenge.vue'",
    '</script>',
    '',
    dungeonBody().replace('<Sandbox />', '<ScaleChallenge />'),
  ].join('\n')
  assert.deepEqual(messages(checkDungeon(dungeonPage({ body: scene }))), [])
  const noImport = dungeonBody().replace('<Sandbox />', '<ScaleChallenge />')
  assert.ok(hasError(checkDungeon(dungeonPage({ body: noImport })), '<ScaleChallenge> 不在组件登记表里'))
})

test('副本页代码块：上限按副本所在区域算，新手村 10 行，铸造城不查', () => {
  const codeOf = (n) => ['```cpp', ...Array.from({ length: n }, (_, i) => `int a${i} = ${i};`), '```'].join('\n')
  const simWith = (n) => dungeonBody().replace('## 题解', `## 题解\n\n${codeOf(n)}`)
  assert.deepEqual(messages(checkDungeon(dungeonPage({ body: simWith(MAX_CODE_LINES.novice) }))), [])
  const errors = checkDungeon(dungeonPage({ body: simWith(MAX_CODE_LINES.novice + 1) }))
  assert.ok(hasError(errors, '新手村单个代码块不超过 10 行，这一块有 11 行'))
  const gpuBody = dungeonBody({ title: '真卡副本', lab: true }).replace('## 题解', `## 题解\n\n${codeOf(20)}`)
  assert.deepEqual(messages(checkDungeon(gpuDungeonPage({ body: gpuBody }), GPU_DUNGEON)), [])
})

test('副本页禁用词：正文里出现就报错，带行号', () => {
  const body = dungeonBody().replace('## 题解', '## 题解\n\n显然，每个线程只管自己那一格。')
  const errors = checkDungeon(dungeonPage({ body }))
  assert.ok(hasError(errors, '不要写「显然」'))
  const line = errors.find((e) => e.message.includes('显然')).line
  assert.equal(dungeonPage({ body }).split('\n')[line - 1], '显然，每个线程只管自己那一格。')
})

// ── 两份数据文件自身 ──────────────────────────────────────────────────────

test('组件登记表和 课程组件规则、kit 的全局注册都对得上', () => {
  const specRows = repo.componentRules
  assert.ok(specRows.length >= 20)
  assert.deepEqual(checkComponents(repo.components, { specRows, kitSource: repo.kitSource }), [])
})

test('组件登记表检查：漏登记、凭空多出来、重复、kit 注册了没登记都会报错', () => {
  const specRows = repo.componentRules
  const without = { components: repo.components.components.filter((c) => c.name !== 'Knob') }
  assert.ok(hasOne(checkComponents(without, { specRows }), '课程组件规则登记了 Knob'))
  const extra = { components: [...repo.components.components, { name: 'MagicChart', use: '凭空多出来的' }] }
  assert.ok(hasOne(checkComponents(extra, { specRows }), 'MagicChart 不在 课程组件规则里'))
  const pending = { components: [...repo.components.components, { name: 'MagicChart', use: '多出来的', pendingSpec: true }] }
  assert.ok(hasOne(checkComponents(pending, { specRows }), '要在 note 里写清'))
  const dup = { components: [...repo.components.components, repo.components.components[1]] }
  assert.ok(hasOne(checkComponents(dup, { specRows }), '重复登记'))
  assert.ok(hasOne(checkComponents(without, { specRows, kitSource: "app.component('Knob', Knob)" }), 'kit/index.ts 全局注册了 Knob'))
  assert.ok(hasOne(checkComponents({ components: [] }, { specRows: [] }), 'components.json 是空的'))
})

test('禁用词表自身：词不重复、正则能编译、每条都写了改法', () => {
  assert.deepEqual(checkBannedWords(repo.bannedWords), [])
  assert.ok(hasOne(checkBannedWords({ words: [{ word: '显然' }] }), '缺少 fix'))
  assert.ok(hasOne(checkBannedWords({ words: [{ word: '显然', fix: 'x' }, { word: '显然', fix: 'y' }] }), '重复'))
  assert.ok(hasOne(checkBannedWords({ words: [{ word: 'x', fix: 'y', pattern: '([' }] }), '不是合法正则'))
  assert.ok(hasOne(checkBannedWords({ words: [] }), 'banned-words.json 是空的'))
})

function hasOne(list, text) {
  return list.some((m) => m.includes(text))
}

// ── 扫描与全仓库 ──────────────────────────────────────────────────────────

test('扫描：frontmatter、代码块、组件标签、import 都分得清', () => {
  const scan = scanMarkdown(page())
  assert.equal(scan.hasFrontmatter, true)
  assert.equal(scan.data.stage, 'novice-demo')
  assert.deepEqual(scan.data.newTerms, ['block', 'grid'])
  assert.equal(scan.fmLines.get('evidence'), 5)
  assert.deepEqual(scan.headings.filter((h) => h.level === 1).map((h) => h.text), ['1-1 示例关'])
  assert.deepEqual(scan.tags.map((t) => t.name), ['Mission', 'Predict', 'ConceptCard', 'Knob', 'Checkpoint', 'EvidenceCard'])
})

test('当前仓库的关卡页全部通过检查', () => {
  const { errors } = checkStages(repo)
  assert.deepEqual(errors.map((e) => `${e.file} ${e.message}`), [])
})

test('全仓库：只查大纲里 draft 和 ready 的关卡', () => {
  assert.deepEqual([...CHECKED_STATUS].sort(), ['draft', 'ready'])
  const base = { outline, glossary, components: repo.components, bannedWords: repo.bannedWords, componentRules: repo.componentRules, kitSource: repo.kitSource }
  const pages = [
    { file: NOVICE, text: page() },
    { file: FORGE, text: page({ fm: { stage: 'forge-demo', newTerms: '[kernel]' }, body: goodBody({ code: '2-1', title: '真卡关', lab: true }) }) },
  ]
  const good = checkStages({ ...base, pages })
  assert.deepEqual(messages(good.errors), [])
  assert.equal(good.checked, 2)

  // planned 的占位页写得再随便也不查。
  const planned = checkStages({ ...base, pages: [...pages, { file: 'docs/novice/later/index.md', text: '# 占位\n' }] })
  assert.deepEqual(messages(planned.errors), [])
  assert.equal(planned.checked, 2)
})

test('全仓库：draft 关卡缺页面、目录不在大纲里都会报错', () => {
  const base = { outline, glossary, components: repo.components, bannedWords: repo.bannedWords, componentRules: repo.componentRules, kitSource: repo.kitSource }
  const missing = checkStages({ ...base, pages: [] })
  assert.ok(hasError(missing.errors, 'novice-demo 的 status 是 draft，但这个页面不存在'))
  const orphan = checkStages({ ...base, pages: [{ file: 'docs/novice/ghost/index.md', text: page() }] })
  assert.ok(hasError(orphan.errors, '目录名 ghost 在 outline.json 的新手村里找不到对应的关卡'))
})

test('副本页的路径：docs/dungeon/<slug>/index.md，大厅不算副本页', () => {
  assert.deepEqual(dungeonPagePath('docs/dungeon/vector-scale/index.md'), { slug: 'vector-scale' })
  assert.deepEqual(dungeonPagePath('docs\\dungeon\\vector-scale\\index.md'), { slug: 'vector-scale' })
  assert.deepEqual(dungeonPagePath('docs/dungeon/index.md'), { slug: '' })
  const files = listDungeonPages().map((p) => p.file)
  assert.ok(!files.includes(`docs/${DUNGEON_DIR}/index.md`))
  assert.ok(files.every((f) => dungeonPagePath(f).slug), files.join(', '))
})

/** 改样例大纲里副本的 status（样例副本都是 planned）。 */
function withExerciseStatus(status) {
  const items = (group) => group.items.map((e) => ({ ...e, status: status[e.id] ?? e.status }))
  return { ...outline, exercises: outline.exercises.map((g) => ({ ...g, items: items(g) })) }
}

/** 全仓库检查的输入：两关合格的关卡页都在，副本的 status 和副本页由每条测试给。 */
function repoWith({ status = {}, dungeonPages = [] } = {}) {
  return {
    outline: withExerciseStatus(status),
    glossary,
    components: repo.components,
    bannedWords: repo.bannedWords,
    componentRules: repo.componentRules,
    kitSource: repo.kitSource,
    pages: [
      { file: NOVICE, text: page() },
      { file: FORGE, text: page({ fm: { stage: 'forge-demo', newTerms: '[kernel]' }, body: goodBody({ code: '2-1', title: '真卡关', lab: true }) }) },
    ],
    dungeonPages,
  }
}

test('全仓库：只查大纲里 draft 和 ready 的副本', () => {
  const dungeonPages = [
    { file: SIM_DUNGEON, text: dungeonPage() },
    { file: GPU_DUNGEON, text: gpuDungeonPage() },
  ]
  const good = checkStages(repoWith({ status: { 'dungeon-scale': 'draft', 'dungeon-row-sum': 'ready' }, dungeonPages }))
  assert.deepEqual(messages(good.errors), [])
  assert.equal(good.checked, 2)
  assert.equal(good.dungeons, 2)

  // planned 的副本只有占位页，写得再随便也不查。
  const sloppy = [dungeonPages[0], { file: GPU_DUNGEON, text: '# 占位\n' }]
  const planned = checkStages(repoWith({ status: { 'dungeon-scale': 'draft' }, dungeonPages: sloppy }))
  assert.deepEqual(messages(planned.errors), [])
  assert.equal(planned.dungeons, 1)

  // 目录是上线了的副本，就按副本页查：layout 写错照样报，不当成别的页面跳过。
  const wrongLayout = [{ file: SIM_DUNGEON, text: dungeonPage({ fm: { layout: 'hg' } }) }]
  const wrong = checkStages(repoWith({ status: { 'dungeon-scale': 'draft' }, dungeonPages: wrongLayout }))
  assert.deepEqual(wrong.errors.map((e) => `${e.file} ${e.message}`), [
    `${SIM_DUNGEON} frontmatter 的 layout 要写 dungeon，现在是 hg（X-01 副本页）`,
  ])
  assert.equal(wrong.dungeons, 1)
})

test('全仓库：draft 副本缺页面、目录不是副本却写了 layout: dungeon 都会报错', () => {
  const missing = checkStages(repoWith({ status: { 'dungeon-scale': 'draft' } }))
  assert.deepEqual(missing.errors.map((e) => `${e.file} ${e.message}`), [
    'docs/dungeon/scale/index.md 大纲里 dungeon-scale 的 status 是 draft，但这个页面不存在',
  ])
  assert.equal(missing.dungeons, 0)
  const orphan = checkStages(repoWith({ dungeonPages: [{ file: 'docs/dungeon/ghost/index.md', text: dungeonPage() }] }))
  assert.ok(hasError(orphan.errors, '目录名 ghost 在 outline.json 的 exercises 里找不到对应的副本'))
  assert.equal(orphan.dungeons, 0)
})

test('全仓库：docs/dungeon/<目录>/ 下不是 layout: dungeon 的页面不是副本页，跳过', () => {
  const external = { file: 'docs/dungeon/external/index.md', text: '---\nlayout: hg\ntitle: 外部题\n---\n\n# 外部题\n\n<MagicChart />\n' }
  const result = checkStages(repoWith({ dungeonPages: [external] }))
  assert.deepEqual(messages(result.errors), [])
  assert.equal(result.dungeons, 0)
})

// ── 外部题页（X-08）──────────────────────────────────────────────────────

/** 外部题数据的小样例：一道有原创题解，一道没有。 */
const external = {
  sources: {
    leetgpu: { name: 'LeetGPU', url: 'https://leetgpu.com/challenges', license: 'CC BY-NC-ND 4.0', licenseUrl: 'https://example.com/LICENSE', checked: '2026-11-11' },
  },
  problems: [
    { id: 'leetgpu-reduction', title: 'Reduction', source: 'leetgpu', url: 'https://leetgpu.com/challenges/reduction', zone: 'forge', stages: ['forge-demo'], solution: true },
    { id: 'leetgpu-softmax', title: 'Softmax', source: 'leetgpu', url: 'https://leetgpu.com/challenges/softmax', zone: 'forge', stages: ['forge-demo'] },
  ],
}
const SOLUTION = 'docs/dungeon/external/leetgpu-reduction/index.md'
const EXTERNAL_INDEX = 'docs/dungeon/external/index.md'

/** 一篇合格的题解页：开头放这道题的卡片，正文只写思路和代码。 */
function solutionPage({ card = '<ExternalProblem id="leetgpu-reduction" />', extra = '' } = {}) {
  const body = [
    '# Reduction 题解',
    '',
    card,
    '',
    '## 思路',
    '',
    '每个线程先在寄存器里累加，再在块内合并，最后跨块合并。',
    extra,
    '<RouteBlock route="hip">',
    '',
    '```cpp',
    'for (int off = warpSize / 2; off > 0; off /= 2) v += __shfl_down(v, off);',
    '```',
    '',
    '</RouteBlock>',
  ].join('\n')
  return withFrontmatter({ layout: 'hg', title: '题解：Reduction', zone: 'forge' }, body)
}

function checkExternal(text, file = SOLUTION) {
  return checkExternalPage({ file, text, external, components: repo.components, bannedWords: repo.bannedWords })
}

/** 报错连同行号：「行号 报错」。 */
function located(errors) {
  return errors.map((e) => `${e.line} ${e.message}`)
}

test('外部题页的路径：题解页的目录是题的 id，索引页不是题解页', () => {
  assert.deepEqual(externalPagePath(SOLUTION), { id: 'leetgpu-reduction' })
  assert.deepEqual(externalPagePath('docs\\dungeon\\external\\leetgpu-reduction\\index.md'), { id: 'leetgpu-reduction' })
  assert.deepEqual(externalPagePath(EXTERNAL_INDEX), { id: '' })
  // 仓库里的外部题页：索引页加每篇题解页，都不会被副本检查当成副本页。
  const files = listExternalPages().map((p) => p.file)
  assert.equal(files[0], EXTERNAL_INDEX)
  assert.ok(files.slice(1).every((f) => externalPagePath(f).id), files.join(', '))
})

test('合格的外部题题解页没有任何问题', () => {
  assert.deepEqual(messages(checkExternal(solutionPage())), [])
})

test('题解页：目录要是一道标了 solution: true 的外部题，页面上要有这道题的卡片', () => {
  const ghost = checkExternal(solutionPage(), 'docs/dungeon/external/leetgpu-ghost/index.md')
  assert.ok(hasError(ghost, '目录名 leetgpu-ghost 不是 docs/course/external-problems.json 里的外部题 id'))
  const unmarked = checkExternal(solutionPage({ card: '<ExternalProblem id="leetgpu-softmax" />' }), 'docs/dungeon/external/leetgpu-softmax/index.md')
  assert.deepEqual(located(unmarked), ['1 leetgpu-softmax 在 docs/course/external-problems.json 里没写 solution: true：有题解页就标上，索引页的卡片才会链接过来（X-08）'])

  // 没放卡片，或者放的是别的题的卡片：来源和许可证就没写出来。报在标题那一行。
  for (const card of ['', '<ExternalProblem id="leetgpu-softmax" />', '`<ExternalProblem id="leetgpu-reduction" />`']) {
    const errors = checkExternal(solutionPage({ card }))
    assert.deepEqual(errors.map((e) => e.line), [7], card)
    assert.ok(hasError(errors, '题解页要放这道题的卡片 <ExternalProblem id="leetgpu-reduction" />'), card)
  }
})

test('外部题页：只用登记过的组件，禁用词照查，索引页也一样', () => {
  const banned = checkExternal(solutionPage({ extra: '\n显然，块数不能超过部分和数组的长度。\n' }))
  assert.deepEqual(located(banned), ['15 不要写「显然」：直接解释；读者觉得不显然时，这些词会伤人（05 第 5 节）'])

  const index = '---\nlayout: hg\ntitle: 外部练习题\n---\n\n<script setup>\nimport ExternalIndex from \'./ExternalIndex.vue\'\n</script>\n\n# 外部练习题\n\n<ExternalIndex />\n\n<MagicChart />\n'
  assert.deepEqual(located(checkExternal(index, EXTERNAL_INDEX)), [
    '14 <MagicChart> 不在组件登记表里：关卡只能用 docs/course/components.json 里登记过的组件，或者本页 import 的 scenes/*.vue（03 第 3 节）',
  ])
})

test('全仓库：外部题页单独查，标了 solution: true 的题缺题解页会报错', () => {
  const good = checkStages({ ...repoWith(), external, externalPages: [{ file: SOLUTION, text: solutionPage() }] })
  assert.deepEqual(messages(good.errors), [])
  assert.equal(good.externals, 1)
  assert.equal(good.dungeons, 0)

  const missing = checkStages({ ...repoWith(), external, externalPages: [] })
  assert.deepEqual(missing.errors.map((e) => `${e.file} ${e.message}`), [
    `${SOLUTION} docs/course/external-problems.json 里 leetgpu-reduction 写了 solution: true，但题解页不存在`,
  ])
})
