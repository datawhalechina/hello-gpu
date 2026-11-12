#!/usr/bin/env node
// 校验实验档案馆（L-04）：docs/lab/data/ 里的每条记录，以及新版页面里引用档案条目的 EvidenceCard。
// 用法：node scripts/course/lab-data-check.mjs（npm run course:check 会调用；浏览页的数据加载器构建时也跑同一套）
//
// 09 第 4 节（正文里的实测数字只能来自档案条目）。分三层：
// 1. 形状：docs/lab/schema.json（JSON Schema 2020-12）。这里带一个小校验器，只认 schema 里用到的关键字；
//    schema 里出现它不认识的关键字时直接报错，免得新写进 schema 的规则其实没人检查。
// 2. 字段之间：文件名和凭证一致；示例只放在 _example/；凭证过得了 LabCard 导入时的检查，关卡和路线对得上大纲；
//    环境里的设备、软件版本和凭证一致，平台登记过；原始样本的个数等于计时次数，测量数据里的耗时和样本对得上；
//    Notebook 单元按小节顺序排，表格每行和表头一样长，图表每条线和横轴一样长，对数轴上只有正数；
//    trace（hg.trace() 存的 JSON）和凭证是同一张卡、同一套软件，序号指得到，时间对得上，测量数据里由它算出的几项对得上；
//    同一张卡在文件名里只有一种写法（hardware.json 登记过的卡用它的 id）。
// 3. 引用：新版页面里 kind 是 measured / mixed 的 EvidenceCard，entry 要是档案里的条目，hardware、date 和条目一致；
//    正式页面不能引用示例条目（docs/preview/ 下的预览页可以）。
// 检查函数都是纯函数，scripts/tests/lab-archive.test.mjs 直接喂坏数据验证它们会报错。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HARDWARE_DEVICES } from '../../docs/course/hardware.ts'
import { checkCredential, labTarget, notebookRoutes } from '../../docs/course/lab.ts'
import {
  ARCHIVE_DIR, EXAMPLE_DIR, SCHEMA_FILE, SECTIONS, archiveFile, isExampleId, median, parseEntryId, quantile, sameValue,
} from '../../docs/course/labArchive.ts'
import { LAB_PLATFORMS, platformById } from '../../docs/course/labPlatforms.ts'
import { formatError, scanMarkdown } from './stage-check.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** 文件名的写法，报错时给例子。 */
const NAME_HINT = '<路线>-<设备>-<日期>.json，例如 hip-rx-9070-xt-2026-11-08.json（路线是 hip、triton 或 shared，设备用小写字母、数字和连字符，日期按 UTC）'

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 报错里怎么写一个值：JSON 的写法，太长的截断。 */
function show(value) {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 48 ? `${text.slice(0, 45)}…` : text
}

// ── JSON Schema（只认 docs/lab/schema.json 用到的关键字）─────────────────────

/** 只是说明、不参与校验的关键字。 */
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'examples', '$defs'])
/** 校验器认识的关键字，语义同 JSON Schema 2020-12。 */
const KEYWORDS = new Set([
  '$ref', 'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'propertyNames',
  'items', 'minItems', 'minLength', 'pattern', 'minimum', 'exclusiveMinimum', 'oneOf',
])
const TYPE_NAMES = { string: '文字', number: '数', integer: '整数', boolean: 'true / false', null: 'null', object: '对象', array: '数组' }

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

/** 本文件里的引用（#、#/$defs/text）；找不到返回 undefined。 */
function resolveRef(schema, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return undefined
  let node = schema
  for (const part of ref.slice(1).split('/').slice(1)) {
    const key = decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~')
    if (!isObject(node) || !Object.hasOwn(node, key)) return undefined
    node = node[key]
  }
  return node
}

/** schema 自身：每个关键字都认识，$ref 指得到，pattern 能编译。返回问题列表。 */
export function checkSchema(schema) {
  const problems = []
  const visit = (node, where) => {
    if (typeof node === 'boolean') return
    if (!isObject(node)) {
      problems.push(`${where} 应该是 schema 对象或 true / false`)
      return
    }
    for (const key of Object.keys(node)) {
      if (!ANNOTATIONS.has(key) && !KEYWORDS.has(key)) {
        problems.push(`${where} 用了 lab-data-check.mjs 不认识的关键字 ${key}：改用认识的写法，或者先给校验器加上它`)
      }
    }
    if ('$ref' in node && resolveRef(schema, node.$ref) === undefined) problems.push(`${where} 的 $ref ${show(node.$ref)} 找不到`)
    if ('pattern' in node) {
      try {
        new RegExp(node.pattern, 'u')
      } catch (error) {
        problems.push(`${where} 的 pattern 写错了：${error.message}`)
      }
    }
    for (const key of ['properties', '$defs']) {
      for (const [name, child] of Object.entries(node[key] ?? {})) visit(child, `${where}/${key}/${name}`)
    }
    for (const key of ['additionalProperties', 'propertyNames', 'items']) {
      if (key in node) visit(node[key], `${where}/${key}`)
    }
    for (const [i, child] of (node.oneOf ?? []).entries()) visit(child, `${where}/oneOf/${i}`)
  }
  visit(schema, '#')
  return problems
}

/** 出错的位置：credential.metrics.gbps、cells[2].outputs[0]；顶层写「（顶层）」。 */
export function formatPath(path) {
  if (!path.length) return '（顶层）'
  return path.map((part, i) => (typeof part === 'number' ? `[${part}]` : i ? `.${part}` : part)).join('')
}

/**
 * 按 schema 校验一个值，返回 [{ path, message }]（schema 要先过 checkSchema）。
 * 类型不对时不再往下查这一层，免得一个错报出一串；对象、数组、文字、数的关键字只管对应类型的值（同 JSON Schema）。
 */
export function validateSchema(schema, value) {
  const errors = []
  validate(schema, schema, value, [], errors)
  return errors
}

function validate(schema, node, value, path, errors) {
  if (node === true) return
  const add = (message, at = path) => errors.push({ path: at, message })
  if (node === false) {
    add('这里不应该有值')
    return
  }
  if ('$ref' in node) validate(schema, resolveRef(schema, node.$ref), value, path, errors)
  if ('type' in node) {
    const types = [node.type].flat()
    const actual = typeOf(value)
    if (!types.some((t) => t === actual || (t === 'number' && actual === 'integer'))) {
      const now = actual === 'string' ? `文字 ${show(value)}` : ['object', 'array'].includes(actual) ? TYPE_NAMES[actual] : show(value)
      add(`应该是${types.map((t) => TYPE_NAMES[t]).join('或')}，现在是 ${now}`)
      return
    }
  }
  if ('const' in node && JSON.stringify(value) !== JSON.stringify(node.const)) add(`只能是 ${show(node.const)}，现在是 ${show(value)}`)
  if ('enum' in node && !node.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    add(`只能是 ${node.enum.map(show).join('、')} 之一，现在是 ${show(value)}`)
  }
  if (typeof value === 'string') {
    if ('minLength' in node && [...value].length < node.minLength) add(`至少要 ${node.minLength} 个字`)
    if ('pattern' in node && !new RegExp(node.pattern, 'u').test(value)) {
      const like = node.examples?.length ? `，应该像 ${node.examples.map(show).join('、')}` : ''
      add(node.pattern === '\\S' ? '不能是空白' : `格式不对：${show(value)}${like}`)
    }
  }
  if (typeof value === 'number') {
    if ('minimum' in node && !(value >= node.minimum)) add(`应该 ≥ ${node.minimum}，现在是 ${value}`)
    if ('exclusiveMinimum' in node && !(value > node.exclusiveMinimum)) add(`应该大于 ${node.exclusiveMinimum}，现在是 ${value}`)
  }
  if (Array.isArray(value)) {
    if ('minItems' in node && value.length < node.minItems) add(`至少要有 ${node.minItems} 项`)
    if ('items' in node) value.forEach((item, i) => validate(schema, node.items, item, [...path, i], errors))
  }
  if (isObject(value)) {
    for (const key of node.required ?? []) {
      if (!Object.hasOwn(value, key)) add(`缺少 ${key}`)
    }
    for (const [key, item] of Object.entries(value)) {
      if ('propertyNames' in node) {
        const named = []
        validate(schema, node.propertyNames, key, path, named)
        if (named.length) add(`名字 ${show(key)} 不合格：${named[0].message}`, [...path, key])
      }
      if (node.properties && Object.hasOwn(node.properties, key)) validate(schema, node.properties[key], item, [...path, key], errors)
      else if (node.additionalProperties === false) add(`不认识的字段 ${key}：拼错了，或者格式里没有这一项`, [...path, key])
      else if ('additionalProperties' in node) validate(schema, node.additionalProperties, item, [...path, key], errors)
    }
  }
  if ('oneOf' in node) {
    const results = node.oneOf.map((branch) => {
      const found = []
      validate(schema, branch, value, path, found)
      return found
    })
    const passed = results.filter((found) => !found.length).length
    if (passed === 0) errors.push(...closestBranch(schema, node.oneOf, results, value, path))
    if (passed > 1) add('同时符合好几种写法，分不清是哪一种')
  }
}

/**
 * oneOf 一种都不符合时报哪一种的错：几种写法用同一个字段区分（例如输出的 kind），就按这个字段找到那一种；
 * 这个字段写错了或者没写，就只报它；找不到这样的字段时报错最少的那一种。
 */
function closestBranch(schema, branches, results, value, path) {
  const resolved = branches.map((branch) => ('$ref' in branch ? resolveRef(schema, branch.$ref) : branch))
  const tags = Object.keys(resolved[0]?.properties ?? {})
    .filter((key) => resolved.every((b) => isObject(b?.properties?.[key]) && 'const' in b.properties[key]))
  if (isObject(value) && tags.length) {
    const tag = tags[0]
    const i = resolved.findIndex((b) => JSON.stringify(b.properties[tag].const) === JSON.stringify(value[tag]))
    if (i >= 0) return results[i]
    const options = resolved.map((b) => show(b.properties[tag].const)).join('、')
    return [Object.hasOwn(value, tag)
      ? { path: [...path, tag], message: `只能是 ${options} 之一，现在是 ${show(value[tag])}` }
      : { path, message: `缺少 ${tag}（${options} 之一）` }]
  }
  return results.reduce((best, found) => (found.length < best.length ? found : best))
}

// ── 一条记录里字段之间的规则 ───────────────────────────────────────────────

/**
 * 一条记录在 schema 之外的规则。id 是「<目录>/<文件名去掉 .json>」，entry 已经通过了 schema。返回问题列表。
 */
export function checkEntryFields(id, entry) {
  const problems = []
  const add = (message) => problems.push(message)
  const dir = id.split('/')[0]
  const name = parseEntryId(id)
  const c = entry.credential
  const example = dir === EXAMPLE_DIR

  if (!name) add(`文件名要写成 ${NAME_HINT}`)
  if (example && entry.example !== true) add(`${EXAMPLE_DIR}/ 里放的是示例，要写 "example": true（示例，不是实测）`)
  if (!example && entry.example === true) add(`"example": true 的条目只能放在 ${EXAMPLE_DIR}/ 里；真实的测量记录不写 example`)
  if (!example && dir !== c.stage) add(`放在 ${dir}/ 下，凭证却是 ${c.stage} 的：目录名要和凭证的 stage 一样`)

  // 凭证：和 LabCard 导入通关码时同一套检查（lab.ts 的 checkCredential），关卡和路线要对得上大纲
  try {
    checkCredential(c)
  } catch (error) {
    add(`凭证过不了 LabCard 导入时的检查：${error.message}`)
  }
  const target = labTarget(c.stage)
  if (!target) {
    add(`凭证的 stage 是 ${c.stage}，它不是 outline.json 里的真卡关卡（gpu: true）或真卡副本（env: gpu）`)
  } else if (!notebookRoutes(target).includes(c.route)) {
    const how = target.routes === 'split' ? '分 HIP、Triton 两条路线' : '两条路线共用一份'
    add(`${target.name}${how}，route 应该是 ${notebookRoutes(target).join(' 或 ')}，现在是 ${c.route}`)
  }

  if (name) {
    if (name.route !== c.route) add(`文件名里的路线是 ${name.route}，凭证的 route 是 ${c.route}`)
    if (name.date !== entry.date) add(`文件名里的日期是 ${name.date}，date 写的是 ${entry.date}`)
    const registered = Object.entries(HARDWARE_DEVICES).find(([, device]) => device.name === c.device.name)
    if (registered && registered[0] !== name.device) {
      add(`${c.device.name} 在 docs/course/hardware.json 里登记为 ${registered[0]}，文件名里的设备要写成 ${registered[0]}`)
    }
  }
  if (entry.date !== c.at.slice(0, 10)) add(`date 是 ${entry.date}，凭证生成于 ${c.at}：date 写凭证生成那天（UTC）`)

  const env = entry.environment
  for (const key of ['name', 'gfx', 'cus']) {
    if (env.device[key] !== c.device[key]) {
      add(`environment.device.${key} 是 ${show(env.device[key])}，凭证里是 ${show(c.device[key])}：两处写的应该是同一张卡`)
    }
  }
  for (const key of ['rocm', 'torch', 'triton']) {
    if (env.software[key] !== c.env[key]) {
      add(`environment.software.${key} 是 ${show(env.software[key])}，凭证里是 ${show(c.env[key])}：两处写的应该是同一套软件`)
    }
  }
  if (!platformById(env.platform)) {
    add(`environment.platform 是 ${env.platform}，docs/course/lab-platforms.json 里没有这个平台（有 ${LAB_PLATFORMS.map((p) => p.id).join('、')}）`)
  }

  problems.push(...checkSamples(entry.samples, c.metrics), ...checkCells(entry.cells), ...checkTraces(entry.traces ?? [], c))
  return problems
}

/**
 * 原始样本：实现名不重复，样本个数等于计时次数；测量数据里的耗时要和样本对得上：
 * median_ms 是某一组样本的中位数（p10_ms、p90_ms 是同一组的分位数），<实现名>_ms 是那个实现那组样本的中位数。
 */
function checkSamples(samples, metrics) {
  const problems = []
  const labels = new Set()
  samples.forEach((s, i) => {
    if (labels.has(s.label)) problems.push(`samples[${i}] 的实现名 ${s.label} 重复了：每个实现一组样本`)
    labels.add(s.label)
    if (s.ms.length !== s.repeat) problems.push(`samples[${i}]（${s.label}）计时 ${s.repeat} 次，ms 却有 ${s.ms.length} 个`)
  })
  if ('median_ms' in metrics) {
    const own = samples.find((s) => sameValue(median(s.ms), metrics.median_ms))
    if (!samples.length) {
      problems.push('测量数据里有 median_ms，但没有原始样本：把 hg.bench() 或 hg.compare() 里各实现的 samples_ms 抄进 samples')
    } else if (!own) {
      const medians = samples.map((s) => `${s.label} 是 ${median(s.ms)}`).join('，')
      problems.push(`测量数据的 median_ms 是 ${metrics.median_ms}，和哪一组样本的中位数都对不上（${medians}）：样本和凭证要来自同一次运行`)
    } else {
      for (const [key, q] of [['p10_ms', 0.1], ['p90_ms', 0.9]]) {
        if (key in metrics && !sameValue(quantile(own.ms, q), metrics[key])) {
          problems.push(`测量数据的 ${key} 是 ${metrics[key]}，${own.label} 那组样本算出来是 ${quantile(own.ms, q)}`)
        }
      }
    }
  }
  for (const s of samples) {
    const key = `${s.label}_ms`
    if (key in metrics && !['median_ms', 'p10_ms', 'p90_ms'].includes(key) && !sameValue(median(s.ms), metrics[key])) {
      problems.push(`测量数据的 ${key} 是 ${metrics[key]}，${s.label} 那组样本的中位数是 ${median(s.ms)}`)
    }
  }
  return problems
}

/** Notebook 单元：按小节顺序排（同 Notebook）；有代码或者有输出；输出自身的规则见 checkOutput。 */
function checkCells(cells) {
  const problems = []
  let reached = 0
  cells.forEach((cell, i) => {
    const at = `cells[${i}]`
    const order = SECTIONS.indexOf(cell.section)
    if (order < reached) {
      problems.push(`${at} 在「${cell.section}」，排在「${SECTIONS[reached]}」的单元后面：单元按 Notebook 的顺序排（${SECTIONS.join(' → ')}）`)
    }
    reached = Math.max(reached, order)
    if (!cell.code && !cell.outputs.length) problems.push(`${at} 既没有代码也没有输出`)
    cell.outputs.forEach((output, j) => {
      for (const message of checkOutput(output)) problems.push(`${at}.outputs[${j}]：${message}`)
    })
  })
  return problems
}

/** 表格每行和表头一样长；图表每条线和横轴一样长、至少有一个数，折线图横轴是数，对数轴上只有正数，柱状图不用对数轴。 */
function checkOutput(output) {
  const problems = []
  if (output.kind === 'table') {
    output.rows.forEach((row, r) => {
      if (row.length !== output.columns.length) problems.push(`表格第 ${r + 1} 行有 ${row.length} 格，表头有 ${output.columns.length} 列`)
    })
  }
  if (output.kind === 'chart') {
    const { chart, x, y, series } = output
    for (const s of series) {
      if (s.values.length !== x.values.length) problems.push(`线「${s.name}」有 ${s.values.length} 个值，横轴有 ${x.values.length} 个`)
      if (s.values.every((v) => v === null)) problems.push(`线「${s.name}」一个数都没有`)
    }
    if (new Set(series.map((s) => s.name)).size !== series.length) problems.push('线的名字重复了：图例分不出来')
    if (chart === 'line' && x.values.some((v) => typeof v !== 'number')) problems.push('折线图（line）的横轴要是数；横轴是类别时用柱状图（bar）')
    if (chart === 'bar' && (x.scale === 'log' || y.scale === 'log')) problems.push('柱状图（bar）的两条轴都只能是 linear')
    if (x.scale === 'log' && x.values.some((v) => typeof v === 'number' && v <= 0)) problems.push('横轴是对数刻度，值都要是正数')
    if (y.scale === 'log' && series.some((s) => s.values.some((v) => v !== null && v <= 0))) {
      problems.push('纵轴是对数刻度，值都要是正数（没有数据的点写 null）')
    }
  }
  return problems
}

/** trace 里时间允许差多少微秒：hg.trace 写的时间精确到 0.001 µs。 */
const TRACE_SLACK_US = 0.001
/** 测量数据里由 trace 算出来的三项（hg.trace(...).metrics）：<行名>_kernels、<行名>_gpu_ms、<行名>_span_ms。 */
const TRACE_METRIC = /^([a-z][a-z0-9_]*)_(kernels|gpu_ms|span_ms)$/

/** 几段时间合在一起有多长，重叠的部分只算一次（同 hello_gpu 的 _busy_us）。 */
function busyUs(events) {
  let total = 0
  let reached = -Infinity
  const spans = events.map((e) => [e.start, e.start + e.dur]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (const [start, stop] of spans) {
    if (stop > reached) {
      total += stop - Math.max(start, reached)
      reached = stop
    }
  }
  return total
}

/** 一行 trace 算出来的测量项：kernels 是 kernel 个数，gpu_ms、span_ms 是 gpu_us、span_us 换成毫秒。 */
function traceMetric(line, what) {
  if (what === 'kernels') return line.gpu.filter((e) => e.kind === 'kernel').length
  return (what === 'gpu_ms' ? line.gpu_us : line.span_us) / 1000
}

/**
 * trace 里的一行：三组事件各自按开始时间排，序号指得到（上层算子排在前面），事件都在「从开始到算完」之内；
 * span_us 是 CPU 交完和 GPU 算完里晚的那个，gpu_us 是 gpu 各段合起来的长度；队列按第一次出现的先后从 0 编号。
 */
function checkTraceLine(line) {
  const problems = []
  const add = (message) => problems.push(message)
  const groups = { ops: line.ops, launches: line.launches, gpu: line.gpu }
  for (const [group, events] of Object.entries(groups)) {
    events.forEach((e, i) => {
      if (i && e.start < events[i - 1].start) add(`${group}[${i}] 比前一个开始得早：${group} 要按开始时间排`)
      if (e.start + e.dur > line.span_us + TRACE_SLACK_US) {
        add(`${group}[${i}] 到 ${e.start + e.dur} µs 才结束，晚于从开始到算完的 ${line.span_us} µs`)
      }
    })
  }
  const points = (index, list) => index === null || index < list.length
  line.ops.forEach((op, i) => {
    if (op.parent !== null && op.parent >= i) add(`ops[${i}] 的上层算子是 ops[${op.parent}]：上层算子要排在它前面`)
  })
  line.launches.forEach((launch, i) => {
    if (!points(launch.op, line.ops)) add(`launches[${i}] 的 op 是 ${launch.op}，ops 只有 ${line.ops.length} 个`)
  })
  let streams = 0
  line.gpu.forEach((e, i) => {
    if (!points(e.op, line.ops)) add(`gpu[${i}] 的 op 是 ${e.op}，ops 只有 ${line.ops.length} 个`)
    if (!points(e.launch, line.launches)) add(`gpu[${i}] 的 launch 是 ${e.launch}，launches 只有 ${line.launches.length} 个`)
    if (e.stream > streams) add(`gpu[${i}] 在队列 ${e.stream} 上，前面只出现过 ${streams} 条：队列按第一次出现的先后从 0 编号`)
    streams = Math.max(streams, e.stream + 1)
  })
  const span = Math.max(line.cpu_us, ...line.gpu.map((e) => e.start + e.dur))
  if (Math.abs(span - line.span_us) > TRACE_SLACK_US) {
    add(`span_us 是 ${line.span_us}，CPU 交完（cpu_us）和 GPU 算完里晚的那个是 ${Number(span.toFixed(3))}`)
  }
  const busy = busyUs(line.gpu)
  if (Math.abs(busy - line.gpu_us) > TRACE_SLACK_US) add(`gpu_us 是 ${line.gpu_us}，gpu 里各段合起来是 ${Number(busy.toFixed(3))} µs`)
  return problems
}

/**
 * trace：和凭证是同一张卡、同一套软件；同一份 trace 里行名不重复，每一行自己的规则见 checkTraceLine。
 * 测量数据里的 <行名>_kernels、_gpu_ms、_span_ms，要和某一份 trace 里同名的那一行算出来的一样（同一次运行）。
 */
function checkTraces(traces, credential) {
  const problems = []
  traces.forEach((trace, t) => {
    const at = `traces[${t}]`
    for (const key of ['name', 'gfx', 'cus']) {
      if (trace.device[key] !== credential.device[key]) {
        problems.push(`${at}.device.${key} 是 ${show(trace.device[key])}，凭证里是 ${show(credential.device[key])}：trace 和凭证应该来自同一张卡`)
      }
    }
    for (const key of ['rocm', 'torch', 'triton']) {
      if (trace.env[key] !== credential.env[key]) {
        problems.push(`${at}.env.${key} 是 ${show(trace.env[key])}，凭证里是 ${show(credential.env[key])}：trace 和凭证应该来自同一套软件`)
      }
    }
    const names = new Set()
    trace.lines.forEach((line, l) => {
      const where = `${at}.lines[${l}]（${line.name}）`
      if (names.has(line.name)) problems.push(`${where}：行名重复了，同一份 trace 里每一行的名字都不一样`)
      names.add(line.name)
      for (const message of checkTraceLine(line)) problems.push(`${where}：${message}`)
    })
  })
  const lines = traces.flatMap((trace) => trace.lines)
  const claimed = new Map()
  for (const [key, value] of Object.entries(credential.metrics)) {
    const m = TRACE_METRIC.exec(key)
    if (!m || !lines.some((line) => line.name === m[1])) continue
    if (!claimed.has(m[1])) claimed.set(m[1], [])
    claimed.get(m[1]).push([m[2], value])
  }
  for (const [name, wanted] of claimed) {
    const same = lines.filter((line) => line.name === name)
    if (same.some((line) => wanted.every(([what, value]) => sameValue(traceMetric(line, what), value)))) continue
    const last = same.at(-1)
    const detail = wanted.filter(([what, value]) => !sameValue(traceMetric(last, what), value))
      .map(([what, value]) => `${name}_${what} 是 ${value}，算出来是 ${traceMetric(last, what)}`).join('；')
    problems.push(`测量数据和 traces 里 ${name} 那一行对不上（${detail}）：trace 和凭证要来自同一次运行`)
  }
  return problems
}

// ── 整个档案目录 ───────────────────────────────────────────────────────────

/**
 * 整个档案目录：schema 自身、每个文件（位置、JSON、schema、字段之间的规则），以及同一张卡在文件名里只有一种写法
 * （浏览页按文件名里的设备筛选）。files 是 [{ file, text }]，file 相对仓库根目录。
 * 返回 { errors, entries, ids }：entries 是自身通过检查的 [{ id, file, entry }]；
 * ids 是放对了位置的全部条目 id（没通过检查的也算），引用检查拿它判断「有没有这一条」。
 */
export function checkArchive({ schema, files }) {
  const errors = []
  const add = (file, message) => errors.push({ file, line: 0, message })
  const entries = []
  const ids = new Set()
  const schemaProblems = checkSchema(schema)
  for (const message of schemaProblems) add(SCHEMA_FILE, message)
  if (schemaProblems.length) return { errors, entries, ids }

  for (const { file, text } of files) {
    const m = file.startsWith(`${ARCHIVE_DIR}/`) ? /^([^/]+)\/([^/]+)\.json$/.exec(file.slice(ARCHIVE_DIR.length + 1)) : null
    if (!m) {
      add(file, `档案目录里只放档案条目：${ARCHIVE_DIR}/<关卡 id>/${NAME_HINT}`)
      continue
    }
    const id = `${m[1]}/${m[2]}`
    ids.add(id)
    let entry
    try {
      entry = JSON.parse(text)
    } catch (error) {
      add(file, `不是合法的 JSON：${error.message}`)
      continue
    }
    const shape = validateSchema(schema, entry).map((e) => `${formatPath(e.path)}：${e.message}`)
    const problems = shape.length ? shape : checkEntryFields(id, entry)
    for (const message of problems) add(file, message)
    if (!problems.length) entries.push({ id, file, entry })
  }

  const nameOf = new Map()
  const slugOf = new Map()
  for (const { id, file, entry } of entries) {
    const slug = parseEntryId(id).device
    const name = entry.credential.device.name
    if (nameOf.has(slug) && nameOf.get(slug) !== name) {
      add(file, `文件名里的设备 ${slug} 在别的条目里是「${nameOf.get(slug)}」，这里是「${name}」：不同的卡要用不同的写法`)
    } else if (slugOf.has(name) && slugOf.get(name) !== slug) {
      add(file, `「${name}」在别的条目里写成 ${slugOf.get(name)}，这里写成 ${slug}：同一张卡在文件名里只用一种写法`)
    } else {
      nameOf.set(slug, name)
      slugOf.set(name, slug)
    }
  }
  return { errors, entries, ids }
}

// ── 页面里的 EvidenceCard ─────────────────────────────────────────────────

/** docs/ 下不查的目录：旧版内容、主题、静态文件。 */
const SKIPPED_DIRS = /^(?:part\d.*|appendix|public|node_modules|\..*)$/
/** 示例条目只能在这里引用（组件预览页）。 */
const PREVIEW_DIR = 'docs/preview/'

/** 标签在哪里结束：引号外的第一个 >；没找到返回 -1。 */
function tagEnd(text) {
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i
    }
  }
  return -1
}

/**
 * 一页 Markdown 里的 EvidenceCard：[{ line, attrs }]，attrs 是 { 属性名: 值 }（没写值的是 true，:entry 这样的绑定属性
 * 名字带冒号）。代码块、HTML 注释和行内代码里的不算（同 stage-check 的 scanMarkdown）；标签可以跨行。
 */
export function evidenceCards(text) {
  const { prose } = scanMarkdown(text)
  const cards = []
  prose.forEach(({ no, text: line }, i) => {
    for (const m of line.matchAll(/<EvidenceCard(?=[\s/>]|$)/g)) {
      let rest = line.slice(m.index + m[0].length)
      let end = tagEnd(rest)
      for (let j = i + 1; end < 0 && j < prose.length; j++) {
        rest += `\n${prose[j].text}`
        end = tagEnd(rest)
      }
      const attrs = {}
      for (const a of (end < 0 ? rest : rest.slice(0, end)).matchAll(/([:@]?[A-Za-z_][\w.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
        attrs[a[1]] = a[2] ?? a[3] ?? true
      }
      cards.push({ line: no, attrs })
    }
  })
  return cards
}

/**
 * 页面里引用档案条目的 EvidenceCard（09 第 4 节）：只查 kind 是 measured / mixed、写了 entry 的。条目要在档案里；
 * hardware、date 要和条目一致（照条目写，不手抄别的数）；正式页面不能引用示例条目，预览页可以。
 * 缺字段、kind 写错由 EvidenceCard 自己在构建时报错（F-09），这里不重复。
 * archive 是 checkArchive 的结果。返回 { errors, count }，count 是查过的引用数。
 */
export function checkEvidenceRefs({ pages, archive }) {
  const errors = []
  const byId = new Map(archive.entries.map((e) => [e.id, e.entry]))
  let count = 0
  for (const { file, text } of pages) {
    for (const { line, attrs } of evidenceCards(text)) {
      const id = attrs.entry
      if ((attrs.kind !== 'measured' && attrs.kind !== 'mixed') || typeof id !== 'string' || !id.trim()) continue
      count++
      const add = (message) => errors.push({ file, line, message })
      if (!archive.ids.has(id)) {
        add(`EvidenceCard 的 entry="${id}" 在实验档案馆里找不到：应该有 ${archiveFile(id)}`)
        continue
      }
      if (isExampleId(id) && !file.startsWith(PREVIEW_DIR)) {
        add(`EvidenceCard 引用的 ${id} 是示例条目（示例，不是实测）：正文只能引用真实的测量记录`)
      }
      const entry = byId.get(id)
      // 条目自己没通过检查时，问题已经报在条目上了
      if (!entry) continue
      const device = entry.credential.device.name
      if (typeof attrs.hardware === 'string' && attrs.hardware !== device) {
        add(`EvidenceCard 的 hardware="${attrs.hardware}"，档案条目 ${id} 的设备是「${device}」：照条目写`)
      }
      if (typeof attrs.date === 'string' && attrs.date !== entry.date) {
        add(`EvidenceCard 的 date="${attrs.date}"，档案条目 ${id} 的日期是 ${entry.date}：照条目写`)
      }
    }
  }
  return { errors, count }
}

// ── 读文件 ────────────────────────────────────────────────────────────────

/** 档案目录下的全部文件（相对仓库根目录，排好序）；不管放没放对位置，checkArchive 会查。 */
export function listArchiveFiles(base = root) {
  const files = []
  const walk = (dir) => {
    for (const item of readdirSync(join(base, dir), { withFileTypes: true })) {
      const path = `${dir}/${item.name}`
      if (item.isDirectory()) walk(path)
      else files.push(path)
    }
  }
  if (existsSync(join(base, ARCHIVE_DIR))) walk(ARCHIVE_DIR)
  return files.sort()
}

export function loadArchive(base = root) {
  return {
    schema: JSON.parse(readFileSync(join(base, SCHEMA_FILE), 'utf8')),
    files: listArchiveFiles(base).map((file) => ({ file, text: readFileSync(join(base, file), 'utf8') })),
  }
}

/** docs/ 下写了 EvidenceCard 的新版 Markdown：[{ file, text }]。旧版的 part*、appendix 不看。 */
export function listEvidencePages(base = root) {
  const pages = []
  const walk = (dir) => {
    for (const item of readdirSync(join(base, dir), { withFileTypes: true })) {
      const path = `${dir}/${item.name}`
      if (item.isDirectory()) {
        if (dir !== 'docs' || !SKIPPED_DIRS.test(item.name)) walk(path)
      } else if (item.name.endsWith('.md')) {
        const text = readFileSync(join(base, path), 'utf8')
        if (text.includes('<EvidenceCard')) pages.push({ file: path, text })
      }
    }
  }
  walk('docs')
  return pages
}

/** 档案和引用它的页面。返回 { errors, entries, refs }。 */
export function checkLabArchive(data = { ...loadArchive(), pages: listEvidencePages() }) {
  const archive = checkArchive(data)
  const refs = checkEvidenceRefs({ pages: data.pages, archive })
  return { errors: [...archive.errors, ...refs.errors], entries: archive.entries, refs: refs.count }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { errors, entries, refs } = checkLabArchive()
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${formatError(e)}`)
    console.error(`实验档案馆检查未通过：${errors.length} 个问题`)
    process.exit(1)
  }
  const examples = entries.filter((e) => e.entry.example === true).length
  console.log(`实验档案馆检查通过：${entries.length} 条记录（其中 ${examples} 条是示例），页面里 ${refs} 处 EvidenceCard 引用了档案条目`)
}
