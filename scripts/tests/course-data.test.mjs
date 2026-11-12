import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BADGES, BADGE_BY_ID, BADGE_RULES, SYNC_MASTER_STAGES, ZONE_BOSS, ZONE_PUBLISHED, ZONE_STAGES, ZONE_TERMS, codexCollected,
  earnedBadges,
} from '../../docs/course/badges.ts'
import {
  awardBadge, awardStar, collectTerm, completeStage, emptyState, markAnswerViewed, migratePilot,
  PILOT_STAGE_ID, PILOT_TERM_KEYS,
} from '../../docs/course/progress.ts'
import { DEFAULT_DEVICE_ID, PENDING } from '../../docs/course/hardware.ts'
import {
  MAX_NEW_TERMS_PER_STAGE, checkBadges, checkCourseData, checkExercises, checkExternalProblems, checkGlossary, checkHardware,
  checkLabPlatforms, loadCourseData,
} from '../course/course-data-check.mjs'

const AT = 1_762_000_000_000
const data = loadCourseData()
const specRows = data.badgeRules
const ruleIds = new Set(Object.keys(BADGE_RULES))

function fresh() {
  return emptyState(AT)
}

/** 改一条术语，别的照抄，用来验证检查函数真的会报错。 */
function glossaryWith(key, patch) {
  return { ...data.glossary, [key]: { ...data.glossary[key], ...patch } }
}

/** 改默认那张卡的一个参数，别的照抄。 */
function hardwareWith(key, patch) {
  const device = data.hardware.devices[DEFAULT_DEVICE_ID]
  const params = { ...device.params, [key]: { ...device.params[key], ...patch } }
  return { ...data.hardware, devices: { ...data.hardware.devices, [DEFAULT_DEVICE_ID]: { ...device, params } } }
}

/** 改 outline.json 的一组副本（按区域找），别的照抄。 */
function groupWith(zone, patch) {
  return { ...data.outline, exercises: data.outline.exercises.map((g) => (g.zone === zone ? { ...g, ...patch } : g)) }
}

/** 改一道副本，别的照抄；patch 里写成 undefined 的字段算没写。 */
function exerciseWith(id, patch) {
  const group = data.outline.exercises.find((g) => g.items.some((e) => e.id === id))
  return groupWith(group.zone, { items: group.items.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
}

/** 改一个实验平台（按 id 找），别的照抄；patch 里写成 undefined 的字段算没写。 */
function platformWith(id, patch) {
  return { ...data.labPlatforms, platforms: data.labPlatforms.platforms.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
}

/** 改一个实验平台的一项 GPU / 软件版本。 */
function platformFactWith(id, key, patch) {
  const platform = data.labPlatforms.platforms.find((p) => p.id === id)
  return platformWith(id, { facts: { ...platform.facts, [key]: { ...platform.facts[key], ...patch } } })
}

/** 改一个云平台的 open。 */
function platformOpenWith(id, patch) {
  const platform = data.labPlatforms.platforms.find((p) => p.id === id)
  return platformWith(id, { open: { ...platform.open, ...patch } })
}

function hasError(errors, text) {
  return errors.some((e) => e.includes(text))
}

// ── 数据本身 ──────────────────────────────────────────────────────────────

test('仓库里的术语表和徽章定义通过全部检查', () => {
  assert.deepEqual(checkCourseData(data), [])
})

test('术语表：每条都有中文名、英文名和一句话定义，有比喻就有比喻边界', () => {
  const keys = Object.keys(data.glossary)
  assert.ok(keys.length >= 30, `术语只有 ${keys.length} 条`)
  for (const key of keys) {
    const t = data.glossary[key]
    assert.ok(t.term, `${key} 缺中文名`)
    assert.ok(t.en, `${key} 缺英文名`)
    assert.ok(t.short, `${key} 缺定义`)
    assert.equal(Boolean(t.analogy) === Boolean(t.analogyLimit), true, `${key} 的比喻和比喻边界要成对出现`)
  }
})

test('术语表：键、中文名、英文名都不重复', () => {
  const keys = Object.keys(data.glossary)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(new Set(keys.map((k) => data.glossary[k].term)).size, keys.length)
  assert.equal(new Set(keys.map((k) => data.glossary[k].en)).size, keys.length)

  // JSON.parse 会悄悄丢掉重复的键，所以检查函数要从原文里发现它。
  const raw = '{\n  "block": {\n  },\n  "block": {\n  }\n}\n'
  assert.equal(hasError(checkGlossary(JSON.parse(raw), { outline: data.outline, raw }), '重复的术语 key'), true)
})

test('术语表：覆盖新手村每一关，每关的新术语不超过 3 个', () => {
  const novice = data.outline.stages.filter((s) => s.zone === 'novice').map((s) => s.id)
  assert.equal(novice.length, 15) // 14 关 + 1 个 Boss

  const firstAt = new Map(novice.map((id) => [id, 0]))
  for (const key of Object.keys(data.glossary)) {
    const first = data.glossary[key].links[0]
    firstAt.set(first, (firstAt.get(first) ?? 0) + 1)
  }
  for (const id of novice) {
    const count = firstAt.get(id)
    assert.ok(count >= 1, `${id} 没有任何新术语`)
    assert.ok(count <= MAX_NEW_TERMS_PER_STAGE, `${id} 有 ${count} 个新术语`)
  }
})

test('术语表检查：缺定义、比喻没边界、关卡不存在、术语超额都会报错', () => {
  const opts = { outline: data.outline, raw: '' }
  assert.equal(hasError(checkGlossary(glossaryWith('block', { short: '' }), opts), '缺少一句话定义'), true)
  assert.equal(hasError(checkGlossary(glossaryWith('block', { analogyLimit: '' }), opts), '比喻边界'), true)
  assert.equal(hasError(checkGlossary(glossaryWith('block', { term: '网格' }), opts), '中文名「网格」'), true)
  assert.equal(hasError(checkGlossary(glossaryWith('block', { en: 'grid' }), opts), '英文名「grid」'), true)
  assert.equal(hasError(checkGlossary(glossaryWith('block', { links: ['novice-not-a-stage'] }), opts), '不在 outline.json 里'), true)
  assert.equal(hasError(checkGlossary(glossaryWith('block', { zone: 'forge' }), opts), '首次出现的关卡'), true)
  assert.equal(
    hasError(checkGlossary(glossaryWith('block', { links: ['novice-wavefront', 'novice-thread-groups'] }), opts), '按大纲顺序排'),
    true,
  )

  // 1-4 本来就有 3 个新术语，再挪一个过去就超额。
  const crowded = glossaryWith('exec-mask', { links: ['novice-thread-groups'] })
  assert.equal(hasError(checkGlossary(crowded, opts), `超过每关 ${MAX_NEW_TERMS_PER_STAGE} 个`), true)
})

// ── 徽章定义 ──────────────────────────────────────────────────────────────

test('徽章定义和 课程徽章规则一致', () => {
  assert.equal(specRows.length, 11)
  // 11 行里「区域毕业」一行对应 3 个区域各一枚。
  assert.equal(BADGES.length, 11 - 1 + data.outline.zones.length)
  for (const row of specRows) {
    if (row.condition.includes('每个区域一枚')) continue
    const hit = BADGES.find((b) => b.condition === row.condition)
    assert.ok(hit, `课程徽章规则中的「${row.name}」没有对应徽章`)
    assert.equal(hit.name, row.name)
  }
  for (const zone of data.outline.zones) assert.ok(BADGE_BY_ID.has(`zone-graduate-${zone.id}`))
})

test('徽章检查：id 重复、少判定函数、凭空多出来的徽章都会报错', () => {
  const opts = { outline: data.outline, specRows, ruleIds }
  const dup = [...data.badges, data.badges[0]]
  assert.equal(hasError(checkBadges(dup, opts), 'id 重复'), true)

  const extra = [...data.badges, { id: 'daily-login', name: '天天打卡', desc: '连续 7 天', icon: 'flag', condition: '连续登录 7 天' }]
  assert.equal(hasError(checkBadges(extra, opts), '不在 课程徽章规则里'), true)
  assert.equal(hasError(checkBadges(extra, opts), '没有它的判定函数'), true)

  const missing = data.badges.filter((b) => b.id !== 'first-clear')
  assert.equal(hasError(checkBadges(missing, opts), '没有对应徽章'), true)

  const emoji = data.badges.map((b) => (b.id === 'first-clear' ? { ...b, icon: '🏁' } : b))
  assert.equal(hasError(checkBadges(emoji, opts), '不要用 emoji'), true)
})

// ── 硬件参数 ──────────────────────────────────────────────────────────────

test('硬件参数检查：没出处、出处不存在、没写在出处的哪里，都会报错（09 第 4 节）', () => {
  assert.equal(hasError(checkHardware(hardwareWith('cuCount', { source: undefined })), '没有出处 source'), true)
  assert.equal(hasError(checkHardware(hardwareWith('cuCount', { source: 'some-blog' })), '出处 some-blog 不在 sources 里'), true)
  assert.equal(hasError(checkHardware(hardwareWith('cuCount', { where: ' ' })), '缺少 where'), true)
  assert.equal(hasError(checkHardware(hardwareWith('cuCount', { value: '' })), 'value 要是'), true)

  // 查不到出处时写「[待实测]」、不写出处，可以；写了「[待实测]」又挂出处，不行。
  assert.deepEqual(checkHardware(hardwareWith('l2Cache', { value: PENDING, source: undefined, where: undefined })), [])
  assert.equal(hasError(checkHardware(hardwareWith('l2Cache', { value: PENDING })), '就不要写出处'), true)

  const sources = data.hardware.sources
  const http = { ...data.hardware, sources: { ...sources, 'rdna4-isa': { ...sources['rdna4-isa'], url: 'http://example.com/isa.pdf' } } }
  assert.equal(hasError(checkHardware(http), '完整的 https 链接'), true)
  const unused = { ...data.hardware, sources: { ...sources, extra: { title: '没人用的出处', url: 'https://example.com/', checked: '2026-11-10' } } }
  assert.equal(hasError(checkHardware(unused), '没有参数在用'), true)
  assert.equal(hasError(checkHardware({ ...data.hardware, devices: {} }), '缺少默认的卡'), true)
})

// ── 实验平台 ──────────────────────────────────────────────────────────────

test('实验平台检查：GPU 和软件版本没出处、写了「[待实测]」又挂出处，都会报错（L-06、09 第 4 节）', () => {
  const check = (platforms) => checkLabPlatforms(platforms, { guide: data.setupGuide })
  assert.equal(hasError(check(platformFactWith('local', 'torch', { source: undefined })), '没有出处 source'), true)
  assert.equal(hasError(check(platformFactWith('local', 'torch', { source: 'some-blog' })), '出处 some-blog 不在 sources 里'), true)
  assert.equal(hasError(check(platformFactWith('aup-learning-cloud', 'triton', { source: 'hello-gpu-ch1' })), '就不要写出处'), true)
  // 查不到写「[待实测]」可以：本地的 Triton 换成待实测，它的出处还有别的版本在用，检查照样通过。
  assert.deepEqual(check(platformFactWith('local', 'triton', { value: PENDING, source: undefined, where: undefined })), [])

  const local = data.labPlatforms.platforms.find((p) => p.id === 'local')
  const { triton, ...withoutTriton } = local.facts
  assert.equal(hasError(check(platformWith('local', { facts: withoutTriton })), 'facts 缺少 triton'), true)
  assert.equal(hasError(check(platformWith('local', { facts: { ...local.facts, vram: triton } })), 'facts 多了 vram'), true)
})

test('实验平台检查：云平台的链接和说明只能用约定的占位符，指南里要有每个平台的那一节', () => {
  const check = (platforms, guide = data.setupGuide) => checkLabPlatforms(platforms, { guide })
  assert.equal(hasError(check(platformOpenWith('aup-learning-cloud', { link: 'https://tpe.aupcloud.io/hub/git/{repository}' })), '不认识的占位符 {repository}'), true)
  assert.equal(hasError(check(platformOpenWith('aup-learning-cloud', { link: 'http://tpe.aupcloud.io/' })), '完整的 https 链接'), true)
  assert.equal(hasError(check(platformOpenWith('radeon-cloud', { steps: ['打开 `{path}'] })), '反引号没有成对'), true)
  assert.equal(hasError(check(platformOpenWith('radeon-cloud', { steps: ['打开 {notebook}'] })), '不认识的占位符 {notebook}'), true)
  assert.equal(hasError(check(platformWith('radeon-cloud', { open: undefined })), '云平台要有 open'), true)
  assert.equal(hasError(check(platformWith('local', { open: data.labPlatforms.platforms[0].open })), '只有云平台'), true)
  assert.equal(hasError(check(data.labPlatforms, data.setupGuide.replace('{#aup-learning-cloud}', '')), '没有锚点是 {#aup-learning-cloud}'), true)
})

// ── 副本数据 ──────────────────────────────────────────────────────────────

test('仓库里的副本数据通过检查', () => {
  assert.deepEqual(checkExercises(data.outline), [])
})

test('副本检查：字段不能少也不能多，分组也一样', () => {
  const histogram = (patch) => checkExercises(exerciseWith('dungeon-histogram', patch))
  assert.equal(hasError(histogram({ xp: undefined }), 'outline.json 副本 dungeon-histogram：缺少字段 xp'), true)
  // 区域写在分组上，outline.ts 读进来时才补到每道题上，outline.json 的题里不写。
  assert.equal(hasError(histogram({ zone: 'novice' }), 'outline.json 副本 dungeon-histogram：多了字段 zone'), true)
  assert.equal(hasError(checkExercises(groupWith('novice', { note: '首批' })), 'outline.json 副本分组 novice：多了字段 note'), true)
})

test('副本检查：slug 的形状和重复，id 写成 dungeon-<slug>，不能和关卡 id 撞上', () => {
  const sort = (patch) => checkExercises(exerciseWith('dungeon-sort', patch))
  assert.equal(hasError(sort({ slug: 'Sort_2' }), 'slug 要用小写字母、数字和连字符'), true)
  assert.equal(hasError(sort({ id: 'trial-sort' }), 'outline.json 副本 trial-sort：id 要写成 dungeon-sort'), true)
  assert.equal(hasError(sort({ id: 'trial-wave-cooperation' }), 'id 和大纲里的关卡 id 重复'), true)
  // /dungeon/external/ 是外部题索引页（X-08），副本页不能占这个地址。
  assert.equal(hasError(sort({ slug: 'external', id: 'dungeon-external' }), 'slug 不能是 external'), true)

  // 矩阵转置照抄了向量缩放的 slug 和 id：页面地址和存档键都撞上。
  const dup = checkExercises(exerciseWith('dungeon-transpose', { id: 'dungeon-vector-scale', slug: 'vector-scale' }))
  assert.equal(hasError(dup, 'slug「vector-scale」和 dungeon-vector-scale 重复'), true)
  assert.equal(hasError(dup, 'outline.json 副本 dungeon-vector-scale：id 重复'), true)
})

test('副本检查：标题不能空也不能重复，练的是什么不能空', () => {
  const transpose = (patch) => checkExercises(exerciseWith('dungeon-transpose', patch))
  assert.equal(hasError(transpose({ title: ' ' }), 'title 不能是空的'), true)
  assert.equal(hasError(transpose({ title: '向量缩放' }), '标题「向量缩放」和 dungeon-vector-scale 重复'), true)
  assert.equal(hasError(transpose({ practice: '' }), 'outline.json 副本 dungeon-transpose：practice 不能是空的'), true)
})

test('副本检查：难度只有三档，经验值是 50–150 的整数（04 第 2 节）', () => {
  const spmv = (patch) => checkExercises(exerciseWith('dungeon-spmv', patch))
  for (const difficulty of [0, 4, '2']) {
    assert.equal(hasError(spmv({ difficulty }), 'difficulty 只能是 1（入门）、2（进阶）、3（高阶）'), true, JSON.stringify(difficulty))
  }
  assert.equal(hasError(spmv({ xp: 75.5 }), 'xp 要是整数'), true)
  assert.equal(hasError(spmv({ xp: '100' }), 'xp 要是整数'), true)
  assert.equal(hasError(spmv({ xp: 40 }), 'xp 是 40，副本每题 50–150 XP'), true)
  assert.equal(hasError(spmv({ xp: 160 }), 'xp 是 160，副本每题 50–150 XP'), true)
  // 两头的 50 和 150 都算在范围里。
  assert.deepEqual(spmv({ xp: 50 }), [])
  assert.deepEqual(spmv({ xp: 150 }), [])
})

test('副本检查：关联关卡至少一关，要在大纲里、和副本同一个区域、不重复、按大纲顺序', () => {
  const withStages = (stages) => checkExercises(exerciseWith('dungeon-transpose', { stages }))
  assert.equal(hasError(withStages([]), 'outline.json 副本 dungeon-transpose：stages 要列出关联关卡'), true)
  assert.equal(hasError(withStages(['novice-thread-groups', 'novice-not-a-stage']), '关联关卡「novice-not-a-stage」不在 outline.json 里'), true)
  assert.equal(hasError(withStages(['novice-thread-groups', 'forge-fusion']), '关联关卡「forge-fusion」在铸造城，这道副本挂在新手村'), true)
  assert.equal(hasError(withStages(['novice-thread-groups', 'novice-thread-groups']), '关联关卡「novice-thread-groups」写了两次'), true)
  assert.equal(hasError(withStages(['novice-coalescing', 'novice-thread-groups']), '按大纲顺序排，「novice-thread-groups」排错了位置'), true)
})

test('副本检查：运行环境只能是 sim 或 gpu，状态只能是 planned、draft、ready', () => {
  const sort = (patch) => checkExercises(exerciseWith('dungeon-sort', patch))
  assert.equal(hasError(sort({ env: 'cpu' }), 'env 只能是 sim（模拟器）或 gpu（真卡），现在是「cpu」'), true)
  // pilot 是 NV-04 之前试点关卡的状态，副本没有试点。
  assert.equal(hasError(sort({ status: 'pilot' }), 'status 只能是 planned、draft、ready，现在是「pilot」'), true)
})

test('副本分组检查：区域要在大纲里、每个区域一组、按大纲里区域的顺序排，练的是什么不能空，组里至少一道题', () => {
  // 无尽之塔本版不做，大纲里没有这个区域。
  const tower = checkExercises(groupWith('trial', { zone: 'tower' }))
  assert.equal(hasError(tower, 'outline.json 副本分组 tower：zone「tower」不在 outline.json 的 zones 里'), true)
  const novice = (patch) => checkExercises(groupWith('novice', patch))
  assert.equal(hasError(novice({ practice: '' }), 'outline.json 副本分组 novice：practice 不能是空的'), true)
  assert.equal(hasError(novice({ items: [] }), 'outline.json 副本分组 novice：items 要列出这一组的副本'), true)

  const groupOf = (zone) => data.outline.exercises.find((g) => g.zone === zone)
  // 新手村再挂一组，组里的题本身没毛病：一个区域只能有一组。多出来的这组排在最后，只报重复，不另报顺序。
  const saxpy = { ...groupOf('novice').items[0], id: 'dungeon-saxpy', slug: 'saxpy', title: 'SAXPY' }
  const twice = { ...data.outline, exercises: [...data.outline.exercises, { zone: 'novice', practice: '下标', items: [saxpy] }] }
  assert.deepEqual(checkExercises(twice), ['outline.json 副本分组 novice：每个区域只能有一组副本，新手村已经有一组了'])

  // 铸造城和试炼场两组对调：副本大厅和副本页的上一道 / 下一道都按分组顺序走，跟着就乱了。
  const swapped = { ...data.outline, exercises: [groupOf('novice'), groupOf('trial'), groupOf('forge')] }
  assert.deepEqual(checkExercises(swapped), ['outline.json 副本分组 forge：分组要按大纲里区域的顺序排（新手村、铸造城、试炼场）'])
})

// ── 外部题索引（X-08）────────────────────────────────────────────────────

/** 改一道外部题（按 id 找），别的照抄；patch 里写成 undefined 的字段算没写。 */
function externalWith(id, patch) {
  return { ...data.externalProblems, problems: data.externalProblems.problems.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
}

/** 改一个题库，别的照抄。 */
function externalSourceWith(key, patch) {
  const sources = data.externalProblems.sources
  return { ...data.externalProblems, sources: { ...sources, [key]: { ...sources[key], ...patch } } }
}

function checkExternal(external) {
  return checkExternalProblems(external, { outline: data.outline })
}

test('外部题检查：原题链接要在所属题库的地址下面，卡片上的来源和许可证才对得上', () => {
  // LeetGPU 的题标成了 GPU-Puzzles：卡片会把许可证写成 MIT。
  const mislabeled = checkExternal(externalWith('leetgpu-reduction', { id: 'gpu-puzzles-reduction', source: 'gpu-puzzles' }))
  assert.equal(hasError(mislabeled, '链接不在题库 gpu-puzzles 的地址 https://github.com/srush/GPU-Puzzles 下面'), true)
  // 只写题库首页不算原题链接；地址开头一样的别的路径也不算。
  for (const url of ['https://leetgpu.com/challenges', 'https://leetgpu.com/challenges-archive/reduction']) {
    assert.equal(hasError(checkExternal(externalWith('leetgpu-reduction', { url })), '链接不在题库 leetgpu 的地址'), true, url)
  }
  assert.equal(hasError(checkExternal(externalWith('leetgpu-reduction', { url: 'http://leetgpu.com/challenges/reduction' })), 'url 要写原题完整的 https 链接'), true)
  assert.equal(hasError(checkExternal(externalWith('leetgpu-reduction', { source: 'kaggle' })), 'source「kaggle」不在 sources 里'), true)
  // 两道题指向同一道原题：报在后出现的那道上。
  const twice = checkExternal(externalWith('leetgpu-row-wise-argmax', { url: 'https://leetgpu.com/challenges/reduction' }))
  assert.equal(hasError(twice, '外部题 leetgpu-row-wise-argmax：链接和 leetgpu-reduction 重复'), true)
})

test('外部题检查：题库要写许可证和全文的 https 链接、核对日期，没有题在用的题库删掉', () => {
  assert.equal(hasError(checkExternal(externalSourceWith('leetgpu', { license: ' ' })), 'external-problems.json 的题库 leetgpu：缺少 license'), true)
  assert.equal(hasError(checkExternal(externalSourceWith('leetgpu', { licenseUrl: undefined })), '题库 leetgpu：缺少 licenseUrl'), true)
  assert.equal(hasError(checkExternal(externalSourceWith('gpu-mode', { licenseUrl: 'http://example.com/LICENSE' })), 'licenseUrl 要写完整的 https 链接'), true)
  assert.equal(hasError(checkExternal(externalSourceWith('gpu-puzzles', { checked: '2026/11/11' })), 'checked 写核对日期，格式 YYYY-MM-DD'), true)
  const kaggle = { name: 'Kaggle', url: 'https://www.kaggle.com', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', checked: '2026-11-11' }
  const unused = { ...data.externalProblems, sources: { ...data.externalProblems.sources, kaggle } }
  assert.equal(hasError(checkExternal(unused), '题库 kaggle 没有题在用，删掉它'), true)
})

test('外部题检查：id 写成「题库键-名字」且不重复，许可证不写在题上，solution 只能是 true', () => {
  const softmax = (patch) => checkExternal(externalWith('leetgpu-softmax', patch))
  assert.equal(hasError(softmax({ id: 'softmax' }), 'id 要写成 leetgpu-<名字>'), true)
  assert.equal(hasError(softmax({ id: 'leetgpu-reduction' }), '外部题 leetgpu-reduction：id 重复'), true)
  assert.equal(hasError(softmax({ title: 'Reduction' }), '题名「Reduction」和同一个题库的 leetgpu-reduction 重复'), true)
  // 许可证跟着题库走：题上另写一份，两处就可能对不上。
  assert.equal(hasError(softmax({ license: 'MIT' }), '外部题 leetgpu-softmax：多了字段 license'), true)
  assert.equal(hasError(softmax({ zone: undefined }), '外部题 leetgpu-softmax：缺少字段 zone'), true)
  assert.equal(hasError(softmax({ solution: 'softmax' }), 'solution 只能写 true'), true)
})

test('外部题检查：推荐区域在大纲里，关联关卡和副本同一套规则', () => {
  const softmax = (patch) => checkExternal(externalWith('leetgpu-softmax', patch))
  assert.equal(hasError(softmax({ zone: 'tower' }), 'zone「tower」不在 outline.json 的 zones 里'), true)
  assert.equal(hasError(softmax({ stages: ['novice-reduction'] }), '关联关卡「novice-reduction」在新手村，这道外部题推荐在铸造城：只能关联同一个区域的关卡'), true)
  assert.equal(hasError(softmax({ stages: [] }), 'stages 要列出关联关卡'), true)
  assert.equal(hasError(softmax({ stages: ['forge-norm', 'forge-softmax'] }), '「forge-softmax」排错了位置'), true)
})

// ── 徽章判定 ──────────────────────────────────────────────────────────────

test('首次通关：完成第一关才发，发过不再发', () => {
  const s = fresh()
  assert.equal(BADGE_RULES['first-clear'](s, {}), false)
  completeStage(s, 'novice-thousand-additions', { at: AT })
  assert.equal(BADGE_RULES['first-clear'](s, {}), true)

  assert.equal(earnedBadges(s, {}).includes('first-clear'), true)
  awardBadge(s, 'first-clear', { at: AT })
  assert.equal(earnedBadges(s, {}).includes('first-clear'), false)
})

test('零越界：要 3 星，还要这一轮没有越界写', () => {
  const s = fresh()
  const id = 'novice-boss'
  awardStar(s, id, 0, { at: AT })
  awardStar(s, id, 1, { at: AT })
  assert.equal(BADGE_RULES['no-out-of-bounds'](s, { stage: id, noOutOfBounds: true }), false)

  awardStar(s, id, 2, { at: AT })
  assert.equal(BADGE_RULES['no-out-of-bounds'](s, { stage: id, noOutOfBounds: true }), true)
  assert.equal(BADGE_RULES['no-out-of-bounds'](s, { stage: id }), false)
  assert.equal(BADGE_RULES['no-out-of-bounds'](s, { noOutOfBounds: true }), false)
  assert.equal(BADGE_RULES['no-out-of-bounds'](s, { stage: 'novice-timing', noOutOfBounds: true }), false)
})

test('同步大师：1-9 和 1-10 的星都要集齐', () => {
  assert.deepEqual(SYNC_MASTER_STAGES, ['novice-lds-sync', 'novice-reduction'])
  const s = fresh()
  for (const i of [0, 1, 2]) awardStar(s, SYNC_MASTER_STAGES[0], i, { at: AT })
  assert.equal(BADGE_RULES['sync-master'](s, {}), false)
  for (const i of [0, 1, 2]) awardStar(s, SYNC_MASTER_STAGES[1], i, { at: AT })
  assert.equal(BADGE_RULES['sync-master'](s, {}), true)

  // 看过答案的关卡封顶 2 星，集不齐就拿不到。
  const t = fresh()
  for (const i of [0, 1, 2]) awardStar(t, SYNC_MASTER_STAGES[0], i, { at: AT })
  markAnswerViewed(t, SYNC_MASTER_STAGES[1], { at: AT })
  for (const i of [0, 1, 2]) awardStar(t, SYNC_MASTER_STAGES[1], i, { at: AT })
  assert.equal(BADGE_RULES['sync-master'](t, {}), false)
})

test('双语法：同一关两种写法各通关一次，两关各一种不算', () => {
  const s = fresh()
  completeStage(s, 'novice-thread-groups', { lang: 'hip', at: AT })
  completeStage(s, 'novice-assign-threads', { lang: 'python', at: AT })
  assert.equal(BADGE_RULES['dual-syntax'](s, {}), false)

  completeStage(s, 'novice-thread-groups', { lang: 'python', at: AT })
  assert.equal(BADGE_RULES['dual-syntax'](s, {}), true)
  assert.deepEqual(s.stages['novice-thread-groups'].langs, ['hip', 'python'])
  assert.equal(s.xp, 200) // 再通一次关不重复加经验值

  // 观摩模式只是看了一遍，不记这次用的写法。
  const t = fresh()
  completeStage(t, 'novice-thread-groups', { mode: 'watch', lang: 'hip', at: AT })
  assert.deepEqual(t.stages['novice-thread-groups'].langs, [])
})

test('双路线：只认铸造城和试炼场，新手村记了路线也不算', () => {
  const s = fresh()
  completeStage(s, 'forge-softmax', { route: 'hip', at: AT })
  assert.equal(BADGE_RULES['dual-route'](s, {}), false)
  completeStage(s, 'forge-softmax', { route: 'triton', at: AT })
  assert.equal(BADGE_RULES['dual-route'](s, {}), true)

  const t = fresh()
  completeStage(t, 'novice-thread-groups', { route: 'hip', at: AT })
  completeStage(t, 'novice-thread-groups', { route: 'triton', at: AT })
  assert.equal(BADGE_RULES['dual-route'](t, {}), false)
  assert.equal(ZONE_STAGES.novice.includes('novice-thread-groups'), true)
})

test('区域毕业：通过哪个区域的 Boss 就发哪一枚', () => {
  assert.deepEqual(ZONE_BOSS, { novice: 'novice-boss', forge: 'forge-boss', trial: 'trial-boss' })
  const s = fresh()
  assert.equal(BADGE_RULES['zone-graduate-novice'](s, {}), false)
  completeStage(s, 'novice-boss', { kind: 'boss', at: AT })
  assert.equal(BADGE_RULES['zone-graduate-novice'](s, {}), true)
  assert.equal(BADGE_RULES['zone-graduate-forge'](s, {}), false)
})

test('区域毕业：观摩完成的 Boss 不算通过，之后用真卡做完照样发', () => {
  const s = fresh()
  completeStage(s, 'forge-boss', { kind: 'boss', mode: 'watch', at: AT })
  assert.equal(s.stages['forge-boss'].completed, true)
  assert.equal(BADGE_RULES['zone-graduate-forge'](s, {}), false)
  completeStage(s, 'forge-boss', { kind: 'boss', at: AT }) // 真卡做完：换掉观摩标记，经验值不重复给
  assert.equal(BADGE_RULES['zone-graduate-forge'](s, {}), true)
  assert.equal(s.xp, 100)
})

test('第一个 Agent：完成 1-14', () => {
  const s = fresh()
  completeStage(s, 'novice-meet-agent', { at: AT })
  assert.equal(BADGE_RULES['first-agent'](s, {}), false)
  completeStage(s, 'novice-first-agent', { at: AT })
  assert.equal(BADGE_RULES['first-agent'](s, {}), true)
})

test('图鉴收集家：收齐一个关卡全部上线的区域的术语才发；少一个、没录术语的区域都不白送', () => {
  const s = fresh()
  const zones = { done: ['parallel', 'kernel'], empty: [] }
  const published = { done: true, empty: true }
  assert.equal(codexCollected(s.codex, zones, published), false)
  collectTerm(s, 'parallel', { stage: 'novice-thousand-additions', at: AT })
  assert.equal(codexCollected(s.codex, zones, published), false)
  collectTerm(s, 'kernel', { stage: 'novice-assign-threads', at: AT })
  assert.equal(codexCollected(s.codex, zones, published), true)
  // 同样收齐了，区域里还有关卡没上线（术语表还没录全）就不发
  assert.equal(codexCollected(s.codex, zones, { ...published, done: false }), false)
})

test('图鉴收集家：关卡没有全部上线的区域，收齐已经录的术语也不发（读完头一关不会白拿）', () => {
  const open = Object.keys(ZONE_TERMS).filter((zone) => !ZONE_PUBLISHED[zone] && ZONE_TERMS[zone].length)
  assert.ok(open.length > 0)
  const s = fresh()
  for (const zone of open) for (const key of ZONE_TERMS[zone]) collectTerm(s, key, { stage: ZONE_STAGES[zone][0], at: AT })
  assert.equal(BADGE_RULES['codex-collector'](s, {}), false)
})

test('一次性事件的徽章只认调用方报上来的事实', () => {
  const s = fresh()
  for (const [id, key] of [['spot-fake-speedup', 'spotted'], ['beat-torch', 'beatTorch'], ['real-machine', 'labCode']]) {
    assert.equal(BADGE_RULES[id](s, {}), false)
    assert.equal(BADGE_RULES[id](s, { [key]: false }), false)
    assert.equal(BADGE_RULES[id](s, { [key]: true }), true)
  }
})

test('earnedBadges 一次把该发的都挑出来，顺序跟着 badges.json', () => {
  const s = fresh()
  completeStage(s, 'novice-boss', { kind: 'boss', at: AT })
  completeStage(s, 'novice-first-agent', { at: AT })
  const ids = earnedBadges(s, { spotted: true })
  assert.deepEqual(ids, ['first-clear', 'spot-fake-speedup', 'first-agent', 'zone-graduate-novice'])
  for (const id of ids) awardBadge(s, id, { at: AT })
  assert.deepEqual(earnedBadges(s, { spotted: true }), [])
})

// ── 试点存档迁移 ──────────────────────────────────────────────────────────

test('试点图鉴的中文术语名迁移成 glossary.json 的 key', () => {
  for (const [name, key] of Object.entries(PILOT_TERM_KEYS)) {
    assert.ok(data.glossary[key], `试点术语「${name}」映射到的 ${key} 不在术语表里`)
  }

  const pilot = JSON.stringify({
    version: 1,
    xp: 150,
    stages: { 'novice-thread-groups': { completed: true, stars: [0, 1], answerViewed: false } },
    predictions: {},
    codex: ['线程块', '网格', '全局下标', '一个没登记的词'],
    log: [],
  })
  const s = fresh()
  assert.equal(migratePilot(s, pilot, 'python', AT), true)

  assert.deepEqual(Object.keys(s.codex).sort(), ['block', 'global-index', 'grid'])
  assert.equal(s.codex.block.stage, PILOT_STAGE_ID)
  for (const key of Object.keys(s.codex)) assert.ok(data.glossary[key], `迁出来的 ${key} 不在术语表里`)

  // 试点的写法偏好同时算作这一关用这种写法通关过。
  assert.equal(s.prefs.lang, 'python')
  assert.deepEqual(s.stages[PILOT_STAGE_ID].langs, ['python'])
  assert.equal(BADGE_RULES['dual-syntax'](s, {}), false)
  completeStage(s, PILOT_STAGE_ID, { lang: 'hip', at: AT })
  assert.equal(BADGE_RULES['dual-syntax'](s, {}), true)
})

test('迁移过来的图鉴能直接算进图鉴收集家', () => {
  const pilot = JSON.stringify({ version: 1, xp: 0, stages: {}, predictions: {}, codex: ['线程块'], log: [] })
  const s = fresh()
  migratePilot(s, pilot, null, AT)
  const rest = ZONE_TERMS.novice.filter((key) => !s.codex[key])
  assert.equal(rest.length, ZONE_TERMS.novice.length - 1)
  for (const key of rest) collectTerm(s, key, { stage: 'novice-boss', at: AT })
  // 新手村的关卡全部上线以后（这里直接当作上线了），迁移过来的那一个也算在收齐里
  assert.equal(codexCollected(s.codex, { novice: ZONE_TERMS.novice }, { novice: true }), true)
})
