#!/usr/bin/env node
// 重构任务的命令行工具。用法见 refactor/README.md 的「命令速查」。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  STATUS_LABEL, PHASES, AREAS, parseTask, validateTasks, availableTasks, waitingForAuthor,
  indexById, unmetDeps, sortTasks, summarize, setField, appendToSection, PROMPTS, pendingGates,
} from './task-lib.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const TASK_DIR = join(ROOT, 'refactor/tasks')
const SPEC_DIR = join(ROOT, 'refactor/specs')

function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function loadTasks() {
  return readdirSync(TASK_DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const path = join(TASK_DIR, f)
      return parseTask(readFileSync(path, 'utf8'), relative(ROOT, path))
    })
}

function specNames() {
  return readdirSync(SPEC_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
}

function hasGpu() {
  if (process.env.HG_GPU === '1') return true
  if (process.env.HG_GPU === '0') return false
  const r = spawnSync('rocminfo', [], { stdio: 'ignore', timeout: 15000 })
  return r.status === 0
}

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++ } else args[key] = true
    } else args._.push(a)
  }
  return args
}

function line(t) {
  const flags = [t.gpu ? 'GPU' : '', t.owner === 'author' ? '作者' : ''].filter(Boolean).join(' ')
  return `${t.id.padEnd(10)} ${STATUS_LABEL[t.status].padEnd(4, '　')} ${t.size} ${(AREAS[t.area] || t.area).padEnd(5, '　')} ${t.title}${flags ? `  [${flags}]` : ''}`
}

function getTask(tasks, id) {
  if (!id) fail('请提供任务编号，例如 F-01')
  const t = tasks.find((x) => x.id.toLowerCase() === String(id).toLowerCase())
  if (!t) fail(`找不到任务 ${id}`)
  return t
}

function write(t, mutate) {
  const path = join(ROOT, t.file)
  let text = readFileSync(path, 'utf8')
  text = mutate(text)
  text = setField(text, 'updated', today())
  writeFileSync(path, text)
}

function setStatus(t, status, extra) {
  write(t, (text) => {
    let next = setField(text, 'status', status)
    if (extra) next = extra(next)
    return next
  })
  console.log(`✓ ${t.id} ${STATUS_LABEL[t.status]} → ${STATUS_LABEL[status]}（${t.file}）`)
}

const commands = {
  list(tasks, args) {
    let list = sortTasks(tasks)
    if (args.status) list = list.filter((t) => t.status === args.status)
    if (args.phase !== undefined) list = list.filter((t) => String(t.phase) === String(args.phase))
    if (args.area) list = list.filter((t) => t.area === args.area)
    let phase = null
    for (const t of list) {
      if (t.phase !== phase) {
        phase = t.phase
        console.log(`\n阶段 ${phase} ${PHASES[phase]}`)
      }
      console.log('  ' + line(t))
    }
    console.log(`\n共 ${list.length} 个任务`)
  },

  next(tasks, args) {
    const doing = tasks.filter((t) => t.status === 'doing')
    if (doing.length) {
      console.log('有进行中的任务，先把它做完：')
      for (const t of doing) console.log(`  ${line(t)}\n  文件：${t.file}`)
      console.log('\n如果要放弃它：npm run tasks -- reset <编号>')
      return
    }
    const gates = pendingGates(tasks)
    if (gates.length && !args['ignore-gates']) {
      const g = gates[0]
      console.log(`■ 到达作者验收关口：${g.id} ${g.title}\n`)
      console.log('作者验收前不要开始新任务。请这样做：')
      console.log('  1. 确认所有改动都已提交，并已推送到 origin/refactor/v2（git status 干净、git log origin/refactor/v2..HEAD 为空）。')
      console.log(`  2. 告诉对接人：请作者验收 ${g.id}。作者需要做的事：`)
      for (const l of (g.sections['要做的事'] || '').split('\n').filter(Boolean)) console.log(`       ${l}`)
      console.log(`  3. 作者验收通过后，在会话里说「验收任务 ${g.id}：通过」，再继续开工。`)
      console.log(`\n文件：${g.file}`)
      if (gates.length > 1) console.log(`另外还有 ${gates.length - 1} 个关口也已到达：${gates.slice(1).map((x) => x.id).join('、')}`)
      return
    }
    const gpu = args['no-gpu'] ? false : args.gpu ? true : hasGpu()
    const avail = availableTasks(tasks, { gpu })
    const n = Number(args.n || 3)
    if (avail.length) {
      const [first, ...rest] = avail
      console.log(`下一个任务（本机${gpu ? '有' : '没有'} AMD GPU${gpu ? '' : '，已跳过需要 GPU 的任务'}）：\n`)
      console.log(`  ${line(first)}\n  文件：${first.file}\n  规范：${(first.specs || []).map((s) => `refactor/specs/${s}.md`).join('、') || '—'}`)
      if (rest.length) {
        console.log('\n其他可以开始的任务：')
        for (const t of rest.slice(0, n - 1)) console.log(`  ${line(t)}`)
      }
    } else {
      console.log('现在没有可以开始的任务。')
      if (!gpu) {
        const gpuTasks = availableTasks(tasks, { gpu: true }).filter((t) => t.gpu)
        if (gpuTasks.length) {
          console.log('\n需要 AMD GPU 的任务（请在有 GPU 的机器上运行）：')
          for (const t of gpuTasks.slice(0, n)) console.log(`  ${line(t)}`)
        }
      }
    }
    const waiting = waitingForAuthor(tasks)
    if (waiting.length) {
      console.log('\n等作者处理：')
      for (const t of waiting.slice(0, 8)) console.log(`  ${line(t)}`)
      if (waiting.length > 8) console.log(`  ……还有 ${waiting.length - 8} 个`)
    }
  },

  show(tasks, args) {
    const t = getTask(tasks, args._[1])
    const byId = indexById(tasks)
    console.log(`${t.id} ${t.title}`)
    console.log(`状态：${STATUS_LABEL[t.status]}　阶段：${t.phase} ${PHASES[t.phase]}　领域：${AREAS[t.area]}　规模：${t.size}　GPU：${t.gpu ? '需要' : '不需要'}　执行：${t.owner === 'author' ? '作者' : 'AI 会话'}`)
    console.log(`依赖：${(t.deps || []).map((d) => `${d}（${STATUS_LABEL[byId.get(d)?.status] || '不存在'}）`).join('、') || '无'}`)
    console.log(`规范：${(t.specs || []).join('、') || '—'}`)
    console.log(`产出：${(t.outputs || []).join('、') || '—'}`)
    console.log(`验收：${t.checks.done}/${t.checks.total}`)
    console.log(`文件：${t.file}`)
  },

  start(tasks, args) {
    const t = getTask(tasks, args._[1])
    if (t.owner === 'author') fail(`${t.id} 是作者验收关口，由作者完成，会话不领取`)
    if (t.status === 'doing') fail(`${t.id} 已经在进行中`)
    if (!['todo', 'blocked'].includes(t.status)) fail(`${t.id} 当前是「${STATUS_LABEL[t.status]}」，只有待开始或受阻的任务能开始`)
    const other = tasks.find((x) => x.status === 'doing')
    if (other && !args.force) fail(`${other.id} 还在进行中，一次只做一个任务`)
    const unmet = unmetDeps(t, indexById(tasks))
    if (unmet.length && !args.force) fail(`依赖还没完成：${unmet.join('、')}（确需提前开始时加 --force，并在完成记录里说明）`)
    if (t.gpu && !hasGpu() && !args.force) fail(`${t.id} 需要 AMD GPU，本机检测不到 rocminfo（设置 HG_GPU=1 可跳过检测）`)
    setStatus(t, 'doing')
  },

  review(tasks, args) {
    const t = getTask(tasks, args._[1])
    if (t.status !== 'doing' && !args.force) fail(`${t.id} 当前是「${STATUS_LABEL[t.status]}」，只有进行中的任务能提交验收`)
    if (!t.recordFilled) fail(`${t.id} 的「完成记录」还没填写`)
    if (t.checks.done < t.checks.total && !args.force) {
      const left = t.checks.items.filter((i) => !i.ok).map((i) => `  - ${i.text}`).join('\n')
      fail(`还有 ${t.checks.total - t.checks.done} 条验收标准没勾选：\n${left}\n（确实做不到的，在完成记录里说明原因后加 --force）`)
    }
    setStatus(t, 'review')
  },

  done(tasks, args) {
    let list
    if (args.phase !== undefined || args.all) {
      const except = new Set(String(args.except || '').split(/[,，、\s]+/).filter(Boolean).map((x) => x.toUpperCase()))
      list = sortTasks(tasks).filter((t) => t.status === 'review' && t.owner === 'ai' &&
        (args.all || String(t.phase) === String(args.phase)) && !except.has(t.id.toUpperCase()))
      if (!list.length) fail('没有符合条件的待验收任务')
    } else {
      if (!args._[1]) fail('请提供任务编号，或用 --phase <阶段号> / --all 批量验收')
      list = args._.slice(1).map((id) => getTask(tasks, id))
    }
    for (const t of list) {
      const okFrom = t.owner === 'author' ? ['todo', 'doing', 'review'] : ['review']
      if (!okFrom.includes(t.status) && !args.force) fail(`${t.id} 当前是「${STATUS_LABEL[t.status]}」，只有待验收的任务能标记完成`)
    }
    for (const t of list) {
      setStatus(t, 'done', (text) => appendToSection(text, '验收记录', `- ${today()} 通过${args.note && args.note !== true ? `：${args.note}` : ''}`))
    }
    if (list.length > 1) console.log(`共 ${list.length} 个任务标记为已完成`)
  },

  reopen(tasks, args) {
    const t = getTask(tasks, args._[1])
    if (!args.note || args.note === true) fail('请用 --note "原因" 写明不通过的原因')
    if (!['review', 'done'].includes(t.status)) fail(`${t.id} 当前是「${STATUS_LABEL[t.status]}」，只有待验收或已完成的任务能退回`)
    setStatus(t, 'doing', (text) => appendToSection(text, '验收记录', `- ${today()} 不通过：${args.note}`))
  },

  block(tasks, args) {
    const t = getTask(tasks, args._[1])
    if (!args.note || args.note === true) fail('请用 --note "原因" 写明受阻原因')
    setStatus(t, 'blocked', (text) => appendToSection(text, '完成记录', `- ${today()} 受阻：${args.note}`))
  },

  unblock(tasks, args) {
    const t = getTask(tasks, args._[1])
    if (t.status !== 'blocked') fail(`${t.id} 不是受阻状态`)
    setStatus(t, 'todo')
  },

  reset(tasks, args) {
    const t = getTask(tasks, args._[1])
    if (t.status !== 'doing') fail(`${t.id} 不是进行中，不需要重置`)
    setStatus(t, 'todo')
  },

  check(tasks) {
    const errors = validateTasks(tasks, { specNames: specNames() })
    if (!existsSync(join(TASK_DIR, '_TEMPLATE.md'))) errors.push('缺少 refactor/tasks/_TEMPLATE.md')
    const readme = existsSync(join(ROOT, 'refactor/README.md')) ? readFileSync(join(ROOT, 'refactor/README.md'), 'utf8') : ''
    for (const p of PROMPTS) {
      if (!readme.includes(p.text)) errors.push(`refactor/README.md 里缺少固定提示词「${p.label}」，或文字和 scripts/refactor/task-lib.mjs 的 PROMPTS 不一致`)
    }
    if (errors.length) {
      console.error(`任务文件检查发现 ${errors.length} 个问题：`)
      for (const e of errors) console.error(`  - ${e}`)
      process.exit(1)
    }
    console.log(`✓ ${tasks.length} 个任务文件格式正确，依赖完整，没有循环`)
  },

  stats(tasks) {
    const s = summarize(tasks)
    console.log(`共 ${s.total} 个任务：${Object.entries(s.byStatus).map(([k, v]) => `${STATUS_LABEL[k]} ${v}`).join('，')}`)
    for (const [p, v] of Object.entries(s.byPhase)) {
      console.log(`  阶段 ${p} ${PHASES[p]}：${v.done}/${v.total} 完成${v.review ? `，${v.review} 个待验收` : ''}`)
    }
  },

  help() {
    console.log(`用法：npm run tasks -- <命令> [参数]

  next [--gpu|--no-gpu] [--n 3]   下一个可以开始的任务（自动检测本机是否有 AMD GPU；
                                   到达作者验收关口时停下，--ignore-gates 只在作者明确同意时使用）
  list [--status todo] [--phase 1] [--area novice]
  show <编号>                      查看任务概要
  start <编号>                     开始任务：待开始 → 进行中
  review <编号>                    提交验收：进行中 → 待验收（要求验收标准全部勾选、完成记录已填）
  done <编号...> [--note "说明"]   作者验收通过：待验收 → 已完成
  done --phase <N> [--except A,B]  批量验收某阶段全部待验收任务（--all 为全部阶段）
  reopen <编号> --note "原因"      作者验收不通过：退回进行中，原因记入「验收记录」
  block <编号> --note "原因"       标记受阻，原因记入「完成记录」
  unblock <编号>                   受阻 → 待开始
  reset <编号>                     放弃进行中的任务：进行中 → 待开始
  check                            检查全部任务文件
  stats                            统计`)
  },
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0] || 'help'
if (!commands[cmd]) fail(`未知命令 ${cmd}，运行 npm run tasks -- help 查看用法`)
commands[cmd](cmd === 'help' ? [] : loadTasks(), args)
