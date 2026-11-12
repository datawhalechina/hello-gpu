#!/usr/bin/env node
// 校验课程数据：docs/course/glossary.json（术语表）、docs/course/badges.json（徽章）、docs/course/hardware.json（硬件参数）、
// docs/course/outline.json 的副本数据（exercises）、docs/course/placement.json（定级题库）、docs/course/v1-map.json（旧版章节和新版关卡的对应）、
// docs/course/lab-platforms.json（实验平台）和 docs/course/external-problems.json（外部练习题索引）。
// 用法：node scripts/course/course-data-check.mjs（npm run course:check 会调用）
//
// 规则来源：课程规则（副本挂在区域旁边，每题 50–150 XP）、第 4、5 节（徽章与图鉴）、
// 课程规则（术语与比喻）、第 5 节（禁用词）、课程规则（硬件参数集中放、每条附出处，
// 检查函数都接受数据参数，scripts/tests/course-data.test.mjs、course-placement.test.mjs、course-v1.test.mjs 直接喂坏数据验证它们会报错。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { BADGE_RULES } from '../../docs/course/badges.ts'
import { DEFAULT_DEVICE_ID, PENDING } from '../../docs/course/hardware.ts'
import { DIFFICULTY_LABEL } from '../../docs/course/outline.ts'
import { XP_EXERCISE_MAX, XP_EXERCISE_MIN } from '../../docs/course/progress.ts'
import { CODE_LANGS, QUESTION_KIND_LABEL, passMark } from '../../docs/course/placement.ts'
import { V1_CHAPTERS } from '../../docs/course/v1.ts'
import { LINK_PLACEHOLDER, PLATFORM_FACTS, PLATFORM_KINDS, STEP_PLACEHOLDER } from '../../docs/course/labPlatforms.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** 术语 key、徽章 id、图标名、副本 slug 都用这个形状，保证能直接当 URL 片段和 CSS 类名。 */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** 05 第 1 节：新手村每关新术语不超过 3 个。 */
export const MAX_NEW_TERMS_PER_STAGE = 3
/** 一句话定义，太长就不是「一句大白话」了。 */
const MAX_SHORT_LENGTH = 60
const TERM_FIELDS = ['term', 'en', 'zone', 'short', 'analogy', 'analogyLimit', 'links']
const BADGE_FIELDS = ['id', 'name', 'desc', 'icon', 'condition']
const SOURCE_FIELDS = ['title', 'url', 'checked']
const PARAM_FIELDS = ['label', 'value', 'unit', 'source', 'where']
const PLATFORM_FIELDS = ['id', 'name', 'kind', 'facts', 'open']
const OPEN_FIELDS = ['label', 'link', 'steps']
const EXERCISE_GROUP_FIELDS = ['zone', 'practice', 'items']
const EXERCISE_FIELDS = ['id', 'slug', 'title', 'practice', 'difficulty', 'xp', 'stages', 'env', 'status']
/** 副本难度的三档，名字跟 outline.ts 的 DIFFICULTY_LABEL。 */
const DIFFICULTIES = Object.keys(DIFFICULTY_LABEL).map(Number)
/** sim 是浏览器里的模拟器，gpu 是真卡。 */
const EXERCISE_ENVS = ['sim', 'gpu']
/** 同关卡：planned 还没有页面，draft 测试版，ready 作者验收过。 */
const EXERCISE_STATUSES = ['planned', 'draft', 'ready']
const EXTERNAL_FIELDS = ['note', 'sources', 'problems']
const EXTERNAL_SOURCE_FIELDS = ['name', 'url', 'license', 'licenseUrl', 'checked']
const EXTERNAL_PROBLEM_FIELDS = ['id', 'title', 'source', 'url', 'zone', 'stages', 'solution']
/** solution 可以不写（没有原创题解）。 */
const EXTERNAL_PROBLEM_REQUIRED = ['id', 'title', 'source', 'url', 'zone', 'stages']
const PLACEMENT_FIELDS = ['note', 'passRate', 'groups']
const PLACEMENT_REQUIRED = ['passRate', 'groups']
const PLACEMENT_GROUP_FIELDS = ['zone', 'questions']
const QUESTION_FIELDS = ['id', 'kind', 'stages', 'q', 'code', 'options']
const QUESTION_REQUIRED = ['id', 'kind', 'stages', 'q', 'options']
const OPTION_FIELDS = ['label', 'correct', 'why']
const QUESTION_KINDS = Object.keys(QUESTION_KIND_LABEL)
/** Q-01 第 1 条：每组 6–8 题，每题挂 1–3 关。 */
const PLACEMENT_GROUP_SIZE = [6, 8]
const PLACEMENT_STAGES_PER_QUESTION = [1, 3]
/** 选项至少 3 个（两个选项蒙对一半），最多 5 个（再多读起来太累）。 */
const PLACEMENT_OPTION_COUNT = [3, 5]
/** Q-01 第 2 条「没学过的人不能靠猜答对」：每题随便选一个，蒙过一组的概率不超过 5%。 */
export const MAX_GUESS_PASS = 0.05

export function loadCourseData() {
  const glossaryRaw = readFileSync(resolve(root, 'docs/course/glossary.json'), 'utf8')
  return {
    glossary: JSON.parse(glossaryRaw),
    glossaryRaw,
    badges: JSON.parse(readFileSync(resolve(root, 'docs/course/badges.json'), 'utf8')),
    hardware: JSON.parse(readFileSync(resolve(root, 'docs/course/hardware.json'), 'utf8')),
    outline: JSON.parse(readFileSync(resolve(root, 'docs/course/outline.json'), 'utf8')),
    badgeRules: JSON.parse(readFileSync(resolve(root, 'scripts/course/rules.json'), 'utf8')).badges,
    placement: JSON.parse(readFileSync(resolve(root, 'docs/course/placement.json'), 'utf8')),
    bannedWords: JSON.parse(readFileSync(resolve(root, 'docs/course/banned-words.json'), 'utf8')),
    v1Map: JSON.parse(readFileSync(resolve(root, 'docs/course/v1-map.json'), 'utf8')),
    labPlatforms: JSON.parse(readFileSync(resolve(root, 'docs/course/lab-platforms.json'), 'utf8')),
    setupGuide: readFileSync(resolve(root, 'docs/handbook/setup/index.md'), 'utf8'),
    externalProblems: JSON.parse(readFileSync(resolve(root, 'docs/course/external-problems.json'), 'utf8')),
  }
}

/** 05 第 5 节的禁用词表（banned-words.json）编译好：有 pattern 的按正则查，没有的按字面查。关卡页、副本页和定级题库共用。 */
export function compileBannedWords(bannedWords) {
  return (bannedWords?.words ?? []).map((w) => ({ ...w, re: w.pattern ? new RegExp(w.pattern) : null }))
}

/** 一段文字里有没有这个禁用词：有就返回命中的原文，没有是 null。 */
export function findBanned(text, word) {
  if (word.re) return word.re.exec(text)?.[0] ?? null
  return text.includes(word.word) ? word.word : null
}

export function checkGlossary(glossary, { outline, raw = '' }) {
  const errors = []
  const zoneIds = new Set(outline.zones.map((z) => z.id))
  const stageOrder = new Map(outline.stages.map((s, i) => [s.id, i]))
  const stageZone = new Map(outline.stages.map((s) => [s.id, s.zone]))
  const keys = Object.keys(glossary)

  if (!keys.length) errors.push('glossary.json 是空的')

  // JSON.parse 会悄悄丢掉重复的键，所以直接数原文里的顶层键。
  if (raw) {
    const written = raw.match(/^ {2}"[^"]+": \{$/gm) ?? []
    if (written.length !== keys.length) {
      errors.push(`glossary.json 有重复的术语 key：原文 ${written.length} 条，解析后只剩 ${keys.length} 条`)
    }
  }

  const byTerm = new Map()
  const byEn = new Map()
  const firstStageCount = new Map()

  for (const key of keys) {
    const t = glossary[key]
    const at = `glossary.json[${key}]`
    if (!SLUG.test(key)) errors.push(`${at}：key 要用小写字母、数字和连字符`)
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      errors.push(`${at}：应该是一个对象`)
      continue
    }
    for (const field of TERM_FIELDS) {
      if (!(field in t)) errors.push(`${at}：缺少字段 ${field}`)
    }
    for (const field of Object.keys(t)) {
      if (!TERM_FIELDS.includes(field)) errors.push(`${at}：多了字段 ${field}`)
    }
    for (const field of ['term', 'en', 'zone', 'short', 'analogy', 'analogyLimit']) {
      if (field in t && typeof t[field] !== 'string') errors.push(`${at}：${field} 要是字符串`)
    }
    if (!t.term) errors.push(`${at}：缺少中文名 term`)
    if (!t.en) errors.push(`${at}：缺少英文名 en`)
    if (!t.short) errors.push(`${at}：缺少一句话定义 short`)
    else if (t.short.length > MAX_SHORT_LENGTH) errors.push(`${at}：定义 ${t.short.length} 字，超过 ${MAX_SHORT_LENGTH} 字`)
    if (t.analogy && !t.analogyLimit) errors.push(`${at}：写了比喻就要写比喻边界 analogyLimit（05 第 4 节）`)
    if (!t.analogy && t.analogyLimit) errors.push(`${at}：没有比喻却写了比喻边界`)
    if (t.zone && !zoneIds.has(t.zone)) errors.push(`${at}：zone「${t.zone}」不在 outline.json 里`)

    // 同一个概念全站只有一个名字（05 第 3 节）。
    if (t.term) {
      if (byTerm.has(t.term)) errors.push(`${at}：中文名「${t.term}」和 ${byTerm.get(t.term)} 重复`)
      else byTerm.set(t.term, key)
    }
    if (t.en) {
      if (byEn.has(t.en)) errors.push(`${at}：英文名「${t.en}」和 ${byEn.get(t.en)} 重复`)
      else byEn.set(t.en, key)
    }

    if (!Array.isArray(t.links) || !t.links.length) {
      errors.push(`${at}：links 要列出用到它的关卡，第一个是首次出现的那关`)
      continue
    }
    let last = -1
    for (const id of t.links) {
      if (!stageOrder.has(id)) {
        errors.push(`${at}：links 里的关卡「${id}」不在 outline.json 里`)
        continue
      }
      const order = stageOrder.get(id)
      if (order <= last) errors.push(`${at}：links 要按大纲顺序排，「${id}」排错了位置`)
      last = order
    }
    const first = t.links[0]
    if (stageZone.has(first)) {
      if (t.zone && stageZone.get(first) !== t.zone) {
        errors.push(`${at}：zone 是「${t.zone}」，首次出现的关卡「${first}」却在「${stageZone.get(first)}」`)
      }
      firstStageCount.set(first, (firstStageCount.get(first) ?? 0) + 1)
    }
  }

  for (const [stage, count] of firstStageCount) {
    if (count > MAX_NEW_TERMS_PER_STAGE) {
      errors.push(`关卡 ${stage} 有 ${count} 个新术语，超过每关 ${MAX_NEW_TERMS_PER_STAGE} 个（05 第 1 节）`)
    }
  }
  return errors
}

export function checkBadges(badges, { outline, specRows, ruleIds }) {
  const errors = []
  if (!Array.isArray(badges)) return ['badges.json 应该是一个数组']
  if (!badges.length) errors.push('badges.json 是空的')

  const seenId = new Set()
  const seenName = new Set()
  for (const b of badges) {
    const at = `badges.json[${b?.id ?? '?'}]`
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      errors.push('badges.json 里有一项不是对象')
      continue
    }
    for (const field of BADGE_FIELDS) {
      if (typeof b[field] !== 'string' || !b[field]) errors.push(`${at}：缺少字段 ${field}`)
    }
    for (const field of Object.keys(b)) {
      if (!BADGE_FIELDS.includes(field)) errors.push(`${at}：多了字段 ${field}`)
    }
    if (b.id) {
      if (!SLUG.test(b.id)) errors.push(`${at}：id 要用小写字母、数字和连字符`)
      if (seenId.has(b.id)) errors.push(`${at}：id 重复`)
      seenId.add(b.id)
    }
    if (b.name) {
      if (seenName.has(b.name)) errors.push(`${at}：名字「${b.name}」重复`)
      seenName.add(b.name)
    }
    // 01 第 6 节：图标是内联描边 SVG，这里只登记名字，不放 emoji。
    if (b.icon && !SLUG.test(b.icon)) errors.push(`${at}：icon 要写图标名（小写字母和连字符），不要用 emoji`)
    if (b.id && !ruleIds.has(b.id)) errors.push(`${at}：badges.ts 里没有它的判定函数`)
  }
  for (const id of ruleIds) {
    if (!seenId.has(id)) errors.push(`badges.ts 里的判定函数「${id}」在 badges.json 里没有定义`)
  }

  // 和 课程徽章规则逐行对齐：一行对一枚，「每个区域一枚」的那行对每个区域一枚。
  const matched = new Set()
  for (const row of specRows) {
    if (row.condition.includes('每个区域一枚')) {
      for (const zone of outline.zones) {
        const id = `zone-graduate-${zone.id}`
        if (!seenId.has(id)) errors.push(`课程徽章规则中的「${row.name}」缺少区域 ${zone.id} 的徽章 ${id}`)
        matched.add(id)
      }
      continue
    }
    const hit = badges.find((b) => b.condition === row.condition)
    if (!hit) errors.push(`课程徽章规则中的「${row.name}」（${row.condition}）在 badges.json 里没有对应徽章`)
    else {
      if (hit.name !== row.name) errors.push(`${hit.id} 的名字是「${hit.name}」，课程徽章规则写的是「${row.name}」`)
      matched.add(hit.id)
    }
  }
  for (const b of badges) {
    if (b?.id && !matched.has(b.id)) errors.push(`badges.json 里的「${b.name ?? b.id}」不在 课程徽章规则里`)
  }
  return errors
}

/** 一个参数值：数、非空字符串，或者一串数（比如 wave 大小「32 或 64」）。 */
function validValue(value) {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.trim() !== ''
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'number' && Number.isFinite(v))
}

/** 出处表（hardware.json、lab-platforms.json 共用）：每条有标题、完整的 https 链接和核对日期。 */
function checkSources(sources, file) {
  const errors = []
  for (const [key, s] of Object.entries(sources)) {
    const at = `${file} 的出处 ${key}`
    if (!SLUG.test(key)) errors.push(`${at}：键要用小写字母、数字和连字符`)
    for (const field of SOURCE_FIELDS) {
      if (typeof s?.[field] !== 'string' || !s[field].trim()) errors.push(`${at}：缺少 ${field}`)
    }
    for (const field of Object.keys(s ?? {})) {
      if (!SOURCE_FIELDS.includes(field)) errors.push(`${at}：多了字段 ${field}`)
    }
    if (typeof s?.url === 'string' && !/^https:\/\/\S+$/.test(s.url)) errors.push(`${at}：url 要写完整的 https 链接`)
    if (typeof s?.checked === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(s.checked)) errors.push(`${at}：checked 写核对日期，格式 YYYY-MM-DD`)
  }
  return errors
}

/**
 * 一个带出处的值（硬件参数、实验平台的 GPU 和软件版本）：中文名、值、可选的单位，出处（sources 里的键）和在出处的哪个位置；
 * 值是「[待实测]」时不写出处。用到的出处记进 used，最后查有没有没人用的出处。
 */
function checkSourcedParam(p, where, sources, used) {
  const errors = []
  for (const field of Object.keys(p ?? {})) {
    if (!PARAM_FIELDS.includes(field)) errors.push(`${where}：多了字段 ${field}`)
  }
  if (typeof p?.label !== 'string' || !p.label.trim()) errors.push(`${where}：缺少中文名 label`)
  if (!validValue(p?.value)) errors.push(`${where}：value 要是数、非空字符串或一串数`)
  if (p?.unit !== undefined && (typeof p.unit !== 'string' || !p.unit.trim())) errors.push(`${where}：unit 写了就不能是空的`)
  if (p?.value === PENDING) {
    if (p.source !== undefined || p.where !== undefined) errors.push(`${where}：值是「${PENDING}」，就不要写出处`)
    return errors
  }
  if (typeof p?.source !== 'string' || !p.source) {
    errors.push(`${where}：没有出处 source；查不到出处就把值写成「${PENDING}」（09 第 4 节）`)
  } else if (!Object.hasOwn(sources, p.source)) {
    errors.push(`${where}：出处 ${p.source} 不在 sources 里`)
  } else {
    used.add(p.source)
  }
  if (typeof p?.where !== 'string' || !p.where.trim()) errors.push(`${where}：缺少 where（在出处的哪个位置找到这个数）`)
  return errors
}

/** 09 第 4 节：硬件参数每条都有出处（出处登记在 sources 里，写清在出处的哪个位置）；查不到的写「[待实测]」。 */
export function checkHardware(hardware) {
  const errors = []
  const sources = hardware?.sources
  const devices = hardware?.devices
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return ['hardware.json 缺少 sources（出处表）']
  if (!devices || typeof devices !== 'object' || Array.isArray(devices)) return ['hardware.json 缺少 devices（各张卡的参数）']
  errors.push(...checkSources(sources, 'hardware.json'))

  if (!Object.hasOwn(devices, DEFAULT_DEVICE_ID)) errors.push(`hardware.json 缺少默认的卡 ${DEFAULT_DEVICE_ID}（正文和全景图的默认值）`)
  const used = new Set()
  for (const [id, device] of Object.entries(devices)) {
    const at = `hardware.json 的 ${id}`
    if (!SLUG.test(id)) errors.push(`${at}：键要用小写字母、数字和连字符`)
    if (typeof device?.name !== 'string' || !device.name.trim()) errors.push(`${at}：缺少 name`)
    const params = device?.params
    if (!params || typeof params !== 'object' || Array.isArray(params) || !Object.keys(params).length) {
      errors.push(`${at}：缺少 params`)
      continue
    }
    for (const [key, p] of Object.entries(params)) errors.push(...checkSourcedParam(p, `${at} 的 ${key}`, sources, used))
  }
  for (const key of Object.keys(sources)) {
    if (!used.has(key)) errors.push(`hardware.json 的出处 ${key} 没有参数在用，删掉它`)
  }
  return errors
}

/** 文字里的 {占位符}，不在 allowed 里的报出来。 */
function unknownPlaceholders(text, allowed, at) {
  return [...text.matchAll(/\{[^{}]*\}/g)]
    .map((m) => m[0])
    .filter((token) => !allowed.includes(token))
    .map((token) => `${at}：不认识的占位符 ${token}（只能用 ${allowed.join('、')}）`)
}

/**
 * L-06：实验平台（lab-platforms.json）。GPU 和 ROCm / PyTorch / Triton 版本的写法同硬件参数，每项有出处或写「[待实测]」
 * （09 第 4 节）；云平台的 open 是 LabCard 上的链接和说明，链接只能用 {repo}、说明只能用 {path} 占位，反引号成对；
 * 平台 id 是实验环境指南里那一节的锚点，guide 是指南的 Markdown 原文，给了就查里面有没有 {#<id>}。
 */
export function checkLabPlatforms(data, { guide = null } = {}) {
  const file = 'lab-platforms.json'
  const sources = data?.sources
  const platforms = data?.platforms
  if (!isObject(sources)) return [`${file} 缺少 sources（出处表）`]
  if (!Array.isArray(platforms) || !platforms.length) return [`${file} 缺少 platforms（平台列表）`]
  const errors = checkSources(sources, file)
  const used = new Set()
  const ids = new Set()
  for (const [i, p] of platforms.entries()) {
    const at = `${file} 的平台 ${filled(p?.id) ? p.id : `第 ${i + 1} 个`}`
    for (const field of Object.keys(p ?? {})) {
      if (!PLATFORM_FIELDS.includes(field)) errors.push(`${at}：多了字段 ${field}`)
    }
    if (typeof p?.id !== 'string' || !SLUG.test(p.id)) {
      errors.push(`${at}：id 要用小写字母、数字和连字符（它是实验环境指南里那一节的锚点）`)
    } else if (ids.has(p.id)) {
      errors.push(`${at}：id 重复了`)
    } else {
      ids.add(p.id)
      if (guide !== null && !guide.includes(`{#${p.id}}`)) errors.push(`${at}：实验环境指南 docs/handbook/setup/index.md 里没有锚点是 {#${p.id}} 的小节`)
    }
    if (!filled(p?.name)) errors.push(`${at}：缺少 name`)
    if (!PLATFORM_KINDS.includes(p?.kind)) errors.push(`${at}：kind 只能是 ${PLATFORM_KINDS.join(' 或 ')}`)

    const facts = p?.facts
    if (!isObject(facts)) {
      errors.push(`${at}：缺少 facts（GPU 和软件版本）`)
    } else {
      for (const key of PLATFORM_FACTS) {
        if (!Object.hasOwn(facts, key)) errors.push(`${at}：facts 缺少 ${key}；查不到就把值写成「${PENDING}」`)
      }
      for (const [key, fact] of Object.entries(facts)) {
        if (PLATFORM_FACTS.includes(key)) errors.push(...checkSourcedParam(fact, `${at} 的 ${key}`, sources, used))
        else errors.push(`${at}：facts 多了 ${key}（只列 ${PLATFORM_FACTS.join('、')}）`)
      }
    }

    const open = p?.open
    if (p?.kind !== 'cloud') {
      if (open !== undefined) errors.push(`${at}：只有云平台（kind: cloud）写 open`)
      continue
    }
    if (!isObject(open)) {
      errors.push(`${at}：云平台要有 open（LabCard 上的链接和说明）`)
      continue
    }
    for (const field of Object.keys(open)) {
      if (!OPEN_FIELDS.includes(field)) errors.push(`${at} 的 open：多了字段 ${field}`)
    }
    if (!filled(open.label)) errors.push(`${at} 的 open：缺少 label（链接上的字）`)
    if (typeof open.link !== 'string' || !/^https:\/\/\S+$/.test(open.link)) errors.push(`${at} 的 open：link 要写完整的 https 链接`)
    else errors.push(...unknownPlaceholders(open.link, [LINK_PLACEHOLDER], `${at} 的 open.link`))
    if (!Array.isArray(open.steps) || !open.steps.length || !open.steps.every(filled)) {
      errors.push(`${at} 的 open：steps 要是一串非空的说明`)
      continue
    }
    for (const [j, step] of open.steps.entries()) {
      const where = `${at} 的 open.steps 第 ${j + 1} 条`
      errors.push(...unknownPlaceholders(step, [STEP_PLACEHOLDER], where))
      if ((step.match(/`/g) ?? []).length % 2) errors.push(`${where}：反引号没有成对`)
    }
  }
  for (const key of Object.keys(sources)) {
    if (!used.has(key)) errors.push(`${file} 的出处 ${key} 没有平台在用，删掉它`)
  }
  return errors
}

/** 有内容的字符串：空串和只有空白都算没写。 */
function filled(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 04 第 1、2 节：副本是挂在区域旁边的可选练习，每题 50–150 XP。outline.json 的 exercises 按区域分组，每个区域最多一组，
 * 分组按大纲里区域的顺序排（副本大厅和副本页的上一道 / 下一道都按分组顺序走）；
 * slug 是页面地址 /dungeon/<slug>/ 的最后一段，id 是存档和草稿槽的键，写成 dungeon-<slug>，不能和关卡 id 撞上；
 * 关联关卡 stages 只挂同一个区域的关卡，按大纲顺序排。
 */
export function checkExercises(outline) {
  const groups = outline?.exercises
  if (!Array.isArray(groups)) return ['outline.json 的 exercises 要是一个数组（按区域分组的副本）']
  const errors = []
  const zoneName = new Map(outline.zones.map((z) => [z.id, z.name]))
  const zoneText = (id) => zoneName.get(id) ?? id
  const zoneOrder = new Map(outline.zones.map((z, i) => [z.id, i]))
  const stageOrder = new Map(outline.stages.map((s, i) => [s.id, i]))
  const seenZone = new Set()
  let lastZone = -1
  const seenId = new Set()
  const bySlug = new Map()
  const byTitle = new Map()

  for (const [i, g] of groups.entries()) {
    if (!isObject(g)) {
      errors.push(`outline.json 的 exercises 里第 ${i + 1} 组不是对象`)
      continue
    }
    const groupName = filled(g.zone) ? g.zone : `第 ${i + 1} 组`
    const group = `outline.json 副本分组 ${groupName}`
    for (const field of EXERCISE_GROUP_FIELDS) {
      if (g[field] === undefined) errors.push(`${group}：缺少字段 ${field}`)
    }
    for (const field of Object.keys(g)) {
      if (!EXERCISE_GROUP_FIELDS.includes(field)) errors.push(`${group}：多了字段 ${field}`)
    }
    const knownZone = zoneName.has(g.zone)
    if (g.zone !== undefined && !knownZone) errors.push(`${group}：zone「${g.zone}」不在 outline.json 的 zones 里`)
    if (knownZone) {
      // 重复的那组已经报过错，合并进前面那组就行，不再按它查顺序。
      if (seenZone.has(g.zone)) {
        errors.push(`${group}：每个区域只能有一组副本，${zoneText(g.zone)}已经有一组了`)
      } else {
        const order = zoneOrder.get(g.zone)
        if (order <= lastZone) errors.push(`${group}：分组要按大纲里区域的顺序排（${outline.zones.map((z) => z.name).join('、')}）`)
        lastZone = order
      }
      seenZone.add(g.zone)
    }
    if (g.practice !== undefined && !filled(g.practice)) errors.push(`${group}：practice 不能是空的（写这一组练的是什么）`)
    if (g.items === undefined) continue
    if (!Array.isArray(g.items) || !g.items.length) {
      errors.push(`${group}：items 要列出这一组的副本，不能是空的`)
      continue
    }

    for (const [j, e] of g.items.entries()) {
      if (!isObject(e)) {
        errors.push(`${group}：第 ${j + 1} 道副本不是对象`)
        continue
      }
      const name = filled(e.id) ? e.id : `${groupName} 第 ${j + 1} 道`
      const at = `outline.json 副本 ${name}`
      for (const field of EXERCISE_FIELDS) {
        if (e[field] === undefined) errors.push(`${at}：缺少字段 ${field}`)
      }
      for (const field of Object.keys(e)) {
        if (!EXERCISE_FIELDS.includes(field)) errors.push(`${at}：多了字段 ${field}`)
      }

      if (e.slug !== undefined) {
        if (typeof e.slug !== 'string' || !SLUG.test(e.slug)) {
          errors.push(`${at}：slug 要用小写字母、数字和连字符`)
        } else {
          if (bySlug.has(e.slug)) errors.push(`${at}：slug「${e.slug}」和 ${bySlug.get(e.slug)} 重复`)
          else bySlug.set(e.slug, name)
          if (e.id !== undefined && e.id !== `dungeon-${e.slug}`) errors.push(`${at}：id 要写成 dungeon-${e.slug}（dungeon- 加上 slug）`)
          // 副本页是 /dungeon/<slug>/，/dungeon/external/ 已经是外部题索引页（X-08，externalProblems.ts 的 EXTERNAL_PAGE）。
          if (e.slug === 'external') errors.push(`${at}：slug 不能是 external，/dungeon/external/ 是外部题索引页的地址`)
        }
      }
      if (e.id !== undefined) {
        if (seenId.has(e.id)) errors.push(`${at}：id 重复`)
        seenId.add(e.id)
        if (stageOrder.has(e.id)) errors.push(`${at}：id 和大纲里的关卡 id 重复（存档和草稿槽按 id 存，关卡和副本不能撞上）`)
      }
      if (e.title !== undefined) {
        if (!filled(e.title)) errors.push(`${at}：title 不能是空的`)
        else if (byTitle.has(e.title)) errors.push(`${at}：标题「${e.title}」和 ${byTitle.get(e.title)} 重复`)
        else byTitle.set(e.title, name)
      }
      if (e.practice !== undefined && !filled(e.practice)) errors.push(`${at}：practice 不能是空的（这道题练的是什么，一句话）`)
      if (e.difficulty !== undefined && !DIFFICULTIES.includes(e.difficulty)) {
        const allowed = DIFFICULTIES.map((d) => `${d}（${DIFFICULTY_LABEL[d]}）`).join('、')
        errors.push(`${at}：difficulty 只能是 ${allowed}，现在是 ${JSON.stringify(e.difficulty)}`)
      }
      if (e.xp !== undefined) {
        if (!Number.isInteger(e.xp)) errors.push(`${at}：xp 要是整数，现在是 ${JSON.stringify(e.xp)}`)
        else if (e.xp < XP_EXERCISE_MIN || e.xp > XP_EXERCISE_MAX) {
          errors.push(`${at}：xp 是 ${e.xp}，副本每题 ${XP_EXERCISE_MIN}–${XP_EXERCISE_MAX} XP（04 第 2 节）`)
        }
      }
      if (e.stages !== undefined) errors.push(...checkRelatedStages(e.stages, { at, zone: g.zone, where: '这道副本挂在', outline }))
      if (e.env !== undefined && !EXERCISE_ENVS.includes(e.env)) {
        errors.push(`${at}：env 只能是 sim（模拟器）或 gpu（真卡），现在是「${e.env}」`)
      }
      if (e.status !== undefined && !EXERCISE_STATUSES.includes(e.status)) {
        errors.push(`${at}：status 只能是 ${EXERCISE_STATUSES.join('、')}，现在是「${e.status}」`)
      }
    }
  }
  return errors
}

/**
 * 关联关卡 stages（副本和外部题共用）：至少一关，要在大纲里、不重复、按大纲顺序；只能关联 zone 这个区域的关卡
 * （zone 不在大纲里时这一条不查，区域写错另外报）。where 是报错里「这道题在哪个区域」的说法，例如「这道副本挂在」。
 */
function checkRelatedStages(stages, { at, zone, where, outline }) {
  if (!Array.isArray(stages) || !stages.length) return [`${at}：stages 要列出关联关卡（这道题练的是哪几关的内容），至少一关`]
  const errors = []
  const zoneText = (id) => outline.zones.find((z) => z.id === id)?.name ?? id
  const knownZone = outline.zones.some((z) => z.id === zone)
  const seen = new Set()
  let last = -1
  for (const id of stages) {
    const order = outline.stages.findIndex((s) => s.id === id)
    if (order < 0) {
      errors.push(`${at}：关联关卡「${id}」不在 outline.json 里`)
      continue
    }
    if (seen.has(id)) {
      errors.push(`${at}：关联关卡「${id}」写了两次`)
      continue
    }
    seen.add(id)
    const stageZone = outline.stages[order].zone
    if (knownZone && stageZone !== zone) {
      errors.push(`${at}：关联关卡「${id}」在${zoneText(stageZone)}，${where}${zoneText(zone)}：只能关联同一个区域的关卡`)
    }
    if (order <= last) errors.push(`${at}：stages 要按大纲顺序排，「${id}」排错了位置`)
    last = order
  }
  return errors
}

/**
 * X-08：外部练习题索引（external-problems.json）。外部题只放链接，卡片上的来源和许可证都从这里来，所以：
 * 题库 sources 要写名字、地址、许可证、许可证全文的 https 链接和核对日期，没有题在用的题库删掉；
 * 每道题的链接要在它所属题库的地址下面（链接、来源、许可证三者对得上），链接不重复；id 写成「题库键-名字」、不重复
 * （它是索引页的锚点，也是题解页 /dungeon/external/<id>/ 的地址）；推荐区域在大纲里，关联关卡的规则同副本；
 * 有原创题解的写 solution: true（题解页由 stage-check.mjs 查）。
 */
export function checkExternalProblems(data, { outline }) {
  const file = 'external-problems.json'
  if (!isObject(data)) return [`${file} 要是一个对象（sources 和 problems）`]
  const errors = []
  for (const field of Object.keys(data)) {
    if (!EXTERNAL_FIELDS.includes(field)) errors.push(`${file}：多了字段 ${field}`)
  }
  const { sources, problems } = data
  if (!isObject(sources) || !Object.keys(sources).length) return [...errors, `${file} 缺少 sources（题库和它们的许可证）`]
  if (!Array.isArray(problems) || !problems.length) return [...errors, `${file} 缺少 problems（外部题列表）`]

  for (const [key, s] of Object.entries(sources)) {
    const at = `${file} 的题库 ${key}`
    if (!SLUG.test(key)) errors.push(`${at}：键要用小写字母、数字和连字符`)
    if (!isObject(s)) {
      errors.push(`${at}：要写成对象（${EXTERNAL_SOURCE_FIELDS.join('、')}）`)
      continue
    }
    for (const field of EXTERNAL_SOURCE_FIELDS) {
      if (!filled(s[field])) errors.push(`${at}：缺少 ${field}`)
    }
    for (const field of Object.keys(s)) {
      if (!EXTERNAL_SOURCE_FIELDS.includes(field)) errors.push(`${at}：多了字段 ${field}`)
    }
    for (const field of ['url', 'licenseUrl']) {
      if (filled(s[field]) && !/^https:\/\/\S+$/.test(s[field])) errors.push(`${at}：${field} 要写完整的 https 链接`)
    }
    if (filled(s.checked) && !/^\d{4}-\d{2}-\d{2}$/.test(s.checked)) errors.push(`${at}：checked 写核对日期，格式 YYYY-MM-DD`)
  }

  const used = new Set()
  const seenId = new Set()
  const byUrl = new Map()
  const byTitle = new Map()
  for (const [i, p] of problems.entries()) {
    if (!isObject(p)) {
      errors.push(`${file} 的 problems 里第 ${i + 1} 道不是对象`)
      continue
    }
    const name = filled(p.id) ? p.id : `第 ${i + 1} 道`
    const at = `${file} 的外部题 ${name}`
    for (const field of EXTERNAL_PROBLEM_REQUIRED) {
      if (p[field] === undefined) errors.push(`${at}：缺少字段 ${field}`)
    }
    for (const field of Object.keys(p)) {
      if (!EXTERNAL_PROBLEM_FIELDS.includes(field)) errors.push(`${at}：多了字段 ${field}`)
    }

    const source = typeof p.source === 'string' && Object.hasOwn(sources, p.source) && isObject(sources[p.source]) ? sources[p.source] : null
    if (p.source !== undefined) {
      if (source) used.add(p.source)
      else errors.push(`${at}：source「${p.source}」不在 sources 里`)
    }
    if (p.id !== undefined) {
      if (typeof p.id !== 'string' || !SLUG.test(p.id)) {
        errors.push(`${at}：id 要用小写字母、数字和连字符（它是索引页上的锚点，也是题解页的地址）`)
      } else if (seenId.has(p.id)) {
        errors.push(`${at}：id 重复`)
      } else if (source && !p.id.startsWith(`${p.source}-`)) {
        errors.push(`${at}：id 要写成 ${p.source}-<名字>（题库键开头）`)
      }
      seenId.add(p.id)
    }
    if (p.title !== undefined) {
      const key = `${p.source}\n${p.title}`
      if (!filled(p.title)) errors.push(`${at}：title 不能是空的（照原站写题名，不翻译）`)
      else if (byTitle.has(key)) errors.push(`${at}：题名「${p.title}」和同一个题库的 ${byTitle.get(key)} 重复`)
      else byTitle.set(key, name)
    }
    if (p.url !== undefined) {
      if (typeof p.url !== 'string' || !/^https:\/\/\S+$/.test(p.url)) {
        errors.push(`${at}：url 要写原题完整的 https 链接`)
      } else {
        if (byUrl.has(p.url)) errors.push(`${at}：链接和 ${byUrl.get(p.url)} 重复`)
        else byUrl.set(p.url, name)
        // 链接要在题库地址下面（/ 或 # 接着往下），卡片上的来源和许可证才对得上；只写题库首页也不算原题链接。
        if (source && filled(source.url) && !p.url.startsWith(`${source.url}/`) && !p.url.startsWith(`${source.url}#`)) {
          errors.push(`${at}：链接不在题库 ${p.source} 的地址 ${source.url} 下面：原题链接、来源和许可证要对得上`)
        }
      }
    }
    if (p.zone !== undefined && !outline.zones.some((z) => z.id === p.zone)) errors.push(`${at}：zone「${p.zone}」不在 outline.json 的 zones 里`)
    if (p.stages !== undefined) errors.push(...checkRelatedStages(p.stages, { at, zone: p.zone, where: '这道外部题推荐在', outline }))
    if (p.solution !== undefined && p.solution !== true) {
      errors.push(`${at}：solution 只能写 true（有原创题解，页面在 /dungeon/external/${name}/）；没有题解就不写`)
    }
  }
  for (const key of Object.keys(sources)) {
    if (!used.has(key)) errors.push(`${file} 的题库 ${key} 没有题在用，删掉它`)
  }
  return errors
}

/**
 * 每题随便选一个选项时，一组至少蒙对 needed 题的概率。optionCounts 是每题的选项个数，每题蒙对的概率是 1 ÷ 选项个数；
 * 逐题累加「一共蒙对几题」的分布。
 */
export function guessPassChance(optionCounts, needed) {
  let dist = [1]
  for (const n of optionCounts) {
    const next = new Array(dist.length + 1).fill(0)
    for (const [k, p] of dist.entries()) {
      next[k] += p * (1 - 1 / n)
      next[k + 1] += p / n
    }
    dist = next
  }
  return dist.slice(needed).reduce((sum, p) => sum + p, 0)
}

/**
 * 定级题库（Q-01，计分规则在 docs/course/placement.ts）：
 * - 三组题按大纲的区域顺序排，一个区域一组，每组 6–8 题；passRate 是一组至少要答对的比例。
 * - 每题挂 1–3 关：同一个区域、按大纲顺序、不含 Boss（Boss 在整组通过时豁免）。Boss 以外每关恰好挂在一道题上：
 *   全答对时整个区域都能豁免，确认定级以后地图的「你在这」才落在推荐的区域里。
 * - 题型只有选择、估值、读代码三种，每组三种都有；只有读代码题写 code，代码一行一行写成数组，
 *   分写法的区域（新手村）两种写法都要给。
 * - 选项 3–5 个，每个都写 why，恰好一个 correct；每题随便选一个，蒙过一组的概率不超过 MAX_GUESS_PASS。
 * - 题干、选项和解释不写 05 第 5 节的禁用词。
 */
export function checkPlacement(placement, { outline, bannedWords }) {
  const file = 'placement.json'
  if (!isObject(placement)) return [`${file} 要是一个对象`]
  const errors = []
  for (const field of PLACEMENT_REQUIRED) {
    if (placement[field] === undefined) errors.push(`${file}：缺少字段 ${field}`)
  }
  for (const field of Object.keys(placement)) {
    if (!PLACEMENT_FIELDS.includes(field)) errors.push(`${file}：多了字段 ${field}`)
  }
  const { passRate, groups } = placement
  const rateOk = typeof passRate === 'number' && passRate > 0 && passRate <= 1
  if (passRate !== undefined && !rateOk) {
    errors.push(`${file}：passRate 是一组至少要答对的比例，要大于 0、不超过 1，现在是 ${JSON.stringify(passRate)}`)
  }
  if (groups === undefined) return errors
  if (!Array.isArray(groups)) return [...errors, `${file}：groups 要是一个数组（一个区域一组题）`]

  const zoneById = new Map(outline.zones.map((z) => [z.id, z]))
  const stageById = new Map(outline.stages.map((s) => [s.id, s]))
  const stageOrder = new Map(outline.stages.map((s, i) => [s.id, i]))
  const order = groups.map((g) => (isObject(g) ? g.zone : undefined))
  if (JSON.stringify(order) !== JSON.stringify(outline.zones.map((z) => z.id))) {
    const expected = outline.zones.map((z) => `${z.id}（${z.name}）`).join('、')
    errors.push(`${file}：groups 要按大纲的区域顺序一个区域一组：${expected}；现在是 ${order.map(String).join('、') || '空的'}`)
  }
  const kindList = QUESTION_KINDS.map((k) => `${k}（${QUESTION_KIND_LABEL[k]}）`).join('、')
  const words = compileBannedWords(bannedWords)
  const seenId = new Set()

  for (const [i, g] of groups.entries()) {
    if (!isObject(g)) {
      errors.push(`${file}：第 ${i + 1} 组不是对象`)
      continue
    }
    const zone = zoneById.get(g.zone)
    const group = `${file} ${zone ? `${zone.name}组` : `第 ${i + 1} 组`}`
    for (const field of PLACEMENT_GROUP_FIELDS) {
      if (g[field] === undefined) errors.push(`${group}：缺少字段 ${field}`)
    }
    for (const field of Object.keys(g)) {
      if (!PLACEMENT_GROUP_FIELDS.includes(field)) errors.push(`${group}：多了字段 ${field}`)
    }
    if (g.zone !== undefined && !zone) errors.push(`${group}：zone「${g.zone}」不在 outline.json 的 zones 里`)
    if (g.questions === undefined) continue
    if (!Array.isArray(g.questions)) {
      errors.push(`${group}：questions 要是一个数组`)
      continue
    }
    const [minQuestions, maxQuestions] = PLACEMENT_GROUP_SIZE
    if (g.questions.length < minQuestions || g.questions.length > maxQuestions) {
      errors.push(`${group}：每组 ${minQuestions}–${maxQuestions} 题，现在有 ${g.questions.length} 题`)
    }

    /** 关卡 id → 挂着它的题。 */
    const linked = new Map()
    const kinds = new Set()
    const optionCounts = []
    for (const [j, q] of g.questions.entries()) {
      if (!isObject(q)) {
        errors.push(`${group}：第 ${j + 1} 题不是对象`)
        continue
      }
      const at = filled(q.id) ? `${file} 题目 ${q.id}` : `${group}第 ${j + 1} 题`
      for (const field of QUESTION_REQUIRED) {
        if (q[field] === undefined) errors.push(`${at}：缺少字段 ${field}`)
      }
      for (const field of Object.keys(q)) {
        if (!QUESTION_FIELDS.includes(field)) errors.push(`${at}：多了字段 ${field}`)
      }
      if (q.id !== undefined) {
        if (typeof q.id !== 'string' || !SLUG.test(q.id)) errors.push(`${at}：id 要用小写字母、数字和连字符`)
        else if (seenId.has(q.id)) errors.push(`${at}：id 重复（作答按 id 记，全题库不能重复）`)
        seenId.add(q.id)
      }
      if (q.kind !== undefined) {
        if (QUESTION_KINDS.includes(q.kind)) kinds.add(q.kind)
        else errors.push(`${at}：kind 只能是 ${kindList}，现在是「${q.kind}」`)
      }
      if (q.q !== undefined && !filled(q.q)) errors.push(`${at}：题干 q 不能是空的`)

      if (q.stages !== undefined) {
        const [minStages, maxStages] = PLACEMENT_STAGES_PER_QUESTION
        if (!Array.isArray(q.stages) || q.stages.length < minStages || q.stages.length > maxStages) {
          errors.push(`${at}：stages 要列出答对后可以豁免的 ${minStages}–${maxStages} 关`)
        } else {
          const own = new Set()
          let last = -1
          for (const id of q.stages) {
            const stage = stageById.get(id)
            if (!stage) {
              errors.push(`${at}：关卡「${id}」不在 outline.json 里`)
              continue
            }
            if (own.has(id)) {
              errors.push(`${at}：关卡「${id}」写了两次`)
              continue
            }
            own.add(id)
            if (zone && stage.zone !== g.zone) {
              errors.push(`${at}：关卡「${id}」在${zoneById.get(stage.zone)?.name ?? stage.zone}，这道题在${zone.name}组：只能挂同一个区域的关卡`)
            }
            if (stage.kind === 'boss') errors.push(`${at}：不要挂 Boss 关「${id}」：Boss 是综合挑战，整组通过时才豁免`)
            if (linked.has(id)) errors.push(`${at}：关卡「${id}」已经挂在 ${linked.get(id)} 上了，每关只挂一道题`)
            else linked.set(id, q.id)
            if (stageOrder.get(id) <= last) errors.push(`${at}：stages 要按大纲顺序排，「${id}」排错了位置`)
            last = stageOrder.get(id)
          }
        }
      }

      if (q.kind === 'code' && q.code === undefined) errors.push(`${at}：读代码题要写 code`)
      if (q.kind !== 'code' && q.code !== undefined) errors.push(`${at}：只有读代码题（kind 是 code）写 code`)
      if (q.code !== undefined) {
        if (!isObject(q.code) || !Object.keys(q.code).length) {
          errors.push(`${at}：code 要按写法给代码，例如 { "hip": [一行一行], "python": [一行一行] }`)
        } else {
          for (const [lang, lines] of Object.entries(q.code)) {
            if (!CODE_LANGS.includes(lang)) errors.push(`${at}：code 的写法只能是 ${CODE_LANGS.join('、')}，现在有「${lang}」`)
            if (!Array.isArray(lines) || !lines.every((line) => typeof line === 'string') || !lines.some(filled)) {
              errors.push(`${at}：code.${lang} 要是一行一行的字符串数组，不能是空的`)
            }
          }
          // 分写法的区域（新手村）读者在 HIP 风格和 Python 风格里选一种，两种都要有。
          if (zone?.routes === 'syntax') {
            for (const lang of ['hip', 'python']) {
              if (q.code[lang] === undefined) errors.push(`${at}：${zone.name}的代码 hip、python 两种写法都要给，缺少 ${lang}`)
            }
          }
        }
      }

      if (q.options !== undefined) {
        const [minOptions, maxOptions] = PLACEMENT_OPTION_COUNT
        if (!Array.isArray(q.options) || q.options.length < minOptions || q.options.length > maxOptions) {
          errors.push(`${at}：options 要有 ${minOptions}–${maxOptions} 个选项`)
        } else {
          optionCounts.push(q.options.length)
          const labels = new Set()
          let correct = 0
          for (const [k, o] of q.options.entries()) {
            const option = `${at} 第 ${k + 1} 个选项`
            if (!isObject(o)) {
              errors.push(`${option}不是对象`)
              continue
            }
            for (const field of Object.keys(o)) {
              if (!OPTION_FIELDS.includes(field)) errors.push(`${option}：多了字段 ${field}`)
            }
            if (!filled(o.label)) errors.push(`${option}：label 不能是空的`)
            else if (labels.has(o.label)) errors.push(`${option}：「${o.label}」和前面的选项重复`)
            else labels.add(o.label)
            if (!filled(o.why)) errors.push(`${option}：每个选项都要写 why（为什么对 / 为什么不对）`)
            if (o.correct !== undefined && o.correct !== true) errors.push(`${option}：correct 只写在正确选项上，写成 true`)
            if (o.correct === true) correct++
          }
          if (correct !== 1) errors.push(`${at}：要恰好一个正确选项（correct: true），现在有 ${correct} 个`)
        }
      }

      const texts = [q.q, ...(Array.isArray(q.options) ? q.options.flatMap((o) => (isObject(o) ? [o.label, o.why] : [])) : [])]
      for (const text of texts) {
        if (typeof text !== 'string') continue
        for (const word of words) {
          const hit = findBanned(text, word)
          if (hit !== null) errors.push(`${at}：不要写「${hit}」：${word.fix}（05 第 5 节）`)
        }
      }
    }

    if (zone) {
      for (const stage of outline.stages) {
        if (stage.zone !== g.zone || stage.kind === 'boss' || linked.has(stage.id)) continue
        errors.push(`${group}：关卡「${stage.id}」（${stage.code}）没有挂在任何一道题上：Boss 以外每关都要有题，全答对时整个区域才能豁免`)
      }
    }
    for (const kind of QUESTION_KINDS) {
      if (!kinds.has(kind)) errors.push(`${group}：选择、估值、读代码三种题型都要有，缺少${QUESTION_KIND_LABEL[kind]}题`)
    }
    if (rateOk && optionCounts.length === g.questions.length) {
      const chance = guessPassChance(optionCounts, passMark(optionCounts.length, passRate))
      if (chance > MAX_GUESS_PASS) {
        errors.push(`${group}：每题随便选一个，有 ${(chance * 100).toFixed(1)}% 的机会通过这一组，不能超过 ${MAX_GUESS_PASS * 100}%：多给几个选项、多出几道题，或者提高 passRate`)
      }
    }
  }
  return errors
}

/**
 * 旧版章节和新版关卡的对应（M-01，docs/course/v1-map.json；读取和用法在 docs/course/v1.ts）：
 * 「旧章节路径 → 新版关卡 id 列表」。键要覆盖旧版目录（docs/.vitepress/outline.mjs）的全部正文章节和附录，
 * 不多不少，按旧版目录的顺序写；每章至少对应一关，关卡要在大纲里、不重复、按大纲顺序。
 * chapters 是旧版的章节（按目录顺序，每章有 path、label、title），默认是 v1.ts 从 outline.mjs 读出来的那份。
 */
export function checkV1Map(map, { outline, chapters = V1_CHAPTERS }) {
  if (!isObject(map)) return ['v1-map.json 要写成「旧章节路径 → 新版关卡 id 列表」的对象']
  const errors = []
  const stageOrder = new Map((outline?.stages ?? []).map((s, i) => [s.id, i]))
  const known = new Set(chapters.map((c) => c.path))

  for (const c of chapters) {
    if (!Object.hasOwn(map, c.path)) errors.push(`v1-map.json 缺少旧版${c.label}「${c.title}」（${c.path}）：旧版的每一章都要写出它在新版里对应的关卡`)
  }
  // 顺序只比两边都有的章：缺的、多的上面和下面分别报。
  const listed = Object.keys(map).filter((path) => known.has(path))
  const expected = chapters.map((c) => c.path).filter((path) => Object.hasOwn(map, path))
  const misplaced = listed.find((path, i) => path !== expected[i])
  if (misplaced) errors.push(`v1-map.json 要按旧版目录的顺序写（先第 0 章起的正文各章，再附录）：${misplaced} 排错了位置`)

  for (const [path, ids] of Object.entries(map)) {
    const at = `v1-map.json 的 ${path}`
    if (!known.has(path)) {
      errors.push(`${at}：不是旧版的章节，旧版目录 docs/.vitepress/outline.mjs 里没有这个地址`)
      continue
    }
    if (!Array.isArray(ids) || !ids.length) {
      errors.push(`${at}：要列出新版里对应的关卡，至少一关`)
      continue
    }
    const seen = new Set()
    let last = -1
    for (const id of ids) {
      if (!stageOrder.has(id)) {
        errors.push(`${at}：关卡「${id}」不在 outline.json 里`)
        continue
      }
      if (seen.has(id)) {
        errors.push(`${at}：关卡「${id}」写了两次`)
        continue
      }
      seen.add(id)
      if (stageOrder.get(id) < last) errors.push(`${at}：关卡按大纲顺序排，「${id}」排错了位置`)
      last = Math.max(last, stageOrder.get(id))
    }
  }
  return errors
}

export function checkCourseData(data = loadCourseData()) {
  const { glossary, glossaryRaw, badges, hardware, outline, badgeRules, placement, bannedWords, v1Map, labPlatforms, setupGuide, externalProblems } = data
  return [
    ...checkGlossary(glossary, { outline, raw: glossaryRaw }),
    ...checkBadges(badges, { outline, specRows: badgeRules, ruleIds: new Set(Object.keys(BADGE_RULES)) }),
    ...checkHardware(hardware),
    ...checkExercises(outline),
    ...checkPlacement(placement, { outline, bannedWords }),
    ...checkV1Map(v1Map, { outline }),
    ...checkLabPlatforms(labPlatforms, { guide: setupGuide }),
    ...checkExternalProblems(externalProblems, { outline }),
  ]
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const data = loadCourseData()
  const errors = checkCourseData(data)
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`)
    console.error(`课程数据检查未通过：${errors.length} 个问题`)
    process.exit(1)
  }
  const terms = Object.keys(data.glossary).length
  const params = Object.values(data.hardware.devices).reduce((sum, d) => sum + Object.keys(d.params).length, 0)
  const exercises = data.outline.exercises.reduce((sum, g) => sum + g.items.length, 0)
  const questions = data.placement.groups.reduce((sum, g) => sum + g.questions.length, 0)
  const mapped = new Set(Object.values(data.v1Map).flat()).size
  const facts = data.labPlatforms.platforms.flatMap((p) => Object.values(p.facts))
  const pending = facts.filter((f) => f.value === PENDING).length
  const external = data.externalProblems.problems
  const solutions = external.filter((p) => p.solution).length
  console.log(`课程数据检查通过：术语 ${terms} 条，徽章 ${data.badges.length} 枚，硬件参数 ${params} 个（都有出处），副本 ${exercises} 道，定级题 ${questions} 道，旧版 ${V1_CHAPTERS.length} 章（含附录）都对应到新版关卡（共 ${mapped} 关），实验平台 ${data.labPlatforms.platforms.length} 个（GPU 和版本 ${facts.length} 项：${facts.length - pending} 项有出处，${pending} 项待实测），外部题 ${external.length} 道（${Object.keys(data.externalProblems.sources).length} 个题库，${solutions} 篇原创题解）`)
}
