#!/usr/bin/env node
// 重构任务的命令行工具。用法见 refactor/README.md 的「命令速查」。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  STATUS_LABEL, PHASES, AREAS, parseTask, validateTasks, availableTasks, waitingForAuthor,
  indexById, unmetDeps, sortTasks, summarize, setField, appendToSection, PROMPTS, pendingGates,
  workBranch, stageIdsOf, setStageStatusText, recordNotes,
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

function git(args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (r.status !== 0 && !allowFail) fail(`git ${args.join(' ')} 失败：\n${(r.stderr || r.stdout || '').trim()}`)
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

function currentBranch() {
  return git(['branch', '--show-current'], { allowFail: true }).out
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

function markDone(list, note) {
  const suffix = note && note !== true ? `：${note}` : ''
  for (const t of list) setStatus(t, 'done', (text) => appendToSection(text, '验收记录', `- ${today()} 通过${suffix}`))
  const outlinePath = join(ROOT, 'docs/course/outline.json')
  if (existsSync(outlinePath)) {
    const before = readFileSync(outlinePath, 'utf8')
    let text = before
    const ready = []
    for (const t of list) {
      for (const id of stageIdsOf(t)) {
        const next = setStageStatusText(text, id, 'draft', 'ready')
        if (next !== text) { text = next; ready.push(id) }
      }
    }
    if (text !== before) {
      writeFileSync(outlinePath, text)
      console.log(`✓ outline.json：${ready.join('、')} 的状态 draft → ready`)
    }
  }
  if (list.length > 1) console.log(`共 ${list.length} 个任务标记为已完成`)
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
      const wb = workBranch(tasks)
      const branch = wb ? wb.name : currentBranch()
      console.log(`■ 到达作者验收关口：${g.id} ${g.title}\n`)
      console.log('作者验收前不要开始新任务。请这样做（详见 refactor/README.md「到达作者验收关口」）：')
      console.log(`  1. 确认改动都已提交并推送到 ${branch}：git status 干净，git log origin/${branch}..HEAD 为空。`)
      console.log(`  2. 运行 npm run -s tasks -- pr-body 生成 PR 说明，更新 ${branch} → refactor/v2 的 PR（还没有就创建），标题用 npm run -s tasks -- pr-body --title 的输出，并把 PR 从草稿转为 Ready for review。`)
      console.log('  3. 告诉执行者：请作者审查这个 PR。作者在 PR 里提意见时，用「处理 PR 意见」的提示词处理；作者合并 PR 即验收通过，之后运行 npm run tasks -- sync 开始下一段。')
      console.log('\n作者审查时要看的：')
      for (const l of (g.sections['要做的事'] || '').split('\n').filter(Boolean)) console.log(`  ${l}`)
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
    if (!args._[1]) fail('请提供任务编号（可以多个）。PR 合并后的批量标记用 accept')
    const list = args._.slice(1).map((id) => getTask(tasks, id))
    for (const t of list) {
      const okFrom = t.owner === 'author' ? ['todo', 'doing', 'review'] : ['review']
      if (!okFrom.includes(t.status) && !args.force) fail(`${t.id} 当前是「${STATUS_LABEL[t.status]}」，只有待验收的任务能标记完成`)
    }
    markDone(list, args.note)
  },

  // PR 合并后调用（GitHub Actions 自动执行）：待验收的任务和已到达的作者关口都标为已完成。
  accept(tasks, args) {
    const list = [
      ...sortTasks(tasks).filter((t) => t.status === 'review' && t.owner === 'ai'),
      ...pendingGates(tasks),
    ]
    if (!list.length) { console.log('没有待验收的任务或已到达的关口'); return }
    markDone(list, args.note)
  },

  branch(tasks) {
    const wb = workBranch(tasks)
    console.log(wb ? wb.name : 'refactor/v2')
  },

  sync() {
    if (git(['status', '--porcelain']).out) fail('工作区有未提交的改动。先提交，或问执行者怎么处理；不要丢弃改动')
    git(['fetch', 'origin', '--prune'])
    git(['switch', 'refactor/v2'])
    if (!git(['pull', '--ff-only', 'origin', 'refactor/v2'], { allowFail: true }).ok) {
      fail('本地 refactor/v2 和远程分叉，不能快进。不要强推或重置，把情况告诉执行者')
    }
    const tasks = loadTasks()
    const stuck = pendingGates(tasks)
    if (stuck.length) {
      console.log(`refactor/v2 上关口 ${stuck[0].id} 的工作已经合并，但还没标为已完成（合并后的自动标记没有生效）。`)
      console.log('请作者在 GitHub 的 Actions 页面重新运行「Refactor accept on merge」，完成后再运行 sync。')
      console.log('作者明确同意时，也可以在 refactor/v2 上运行 npm run tasks -- accept --note "补记：PR 已合并"，提交后 git push origin refactor/v2（这是唯一允许直接推送 refactor/v2 的情况）。')
      process.exit(1)
    }
    const wb = workBranch(tasks)
    if (!wb) { console.log('所有作者关口都已完成，留在 refactor/v2。'); return }
    const local = git(['rev-parse', '--verify', '--quiet', `refs/heads/${wb.name}`], { allowFail: true }).ok
    const remote = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${wb.name}`], { allowFail: true }).ok
    if (local) {
      git(['switch', wb.name])
      if (remote && !git(['pull', '--ff-only', 'origin', wb.name], { allowFail: true }).ok) {
        fail(`本地 ${wb.name} 和远程分叉，不能快进。不要强推或重置，把情况告诉执行者`)
      }
    } else if (remote) {
      git(['switch', '-c', wb.name, '--track', `origin/${wb.name}`])
    } else {
      git(['switch', '-c', wb.name])
      if (!git(['push', '-u', 'origin', wb.name], { allowFail: true }).ok) console.log(`提醒：新分支 ${wb.name} 推送失败，检查推送权限后再推。`)
    }
    const behind = git(['rev-list', '--count', 'HEAD..origin/refactor/v2']).out
    if (behind !== '0') console.log(`提醒：refactor/v2 有 ${behind} 个提交不在 ${wb.name} 里。运行 git merge origin/refactor/v2 合进来，有冲突就解决并重新跑检查。`)
    console.log(`✓ 当前工作分支：${wb.name}（本段终点：${wb.gate.id} ${wb.gate.title}）`)
    console.log(`  本段 PR：${wb.name} → refactor/v2。还没有 PR 时，推送第一个任务后创建草稿 PR（见 refactor/README.md「分支与 PR」）。`)
  },

  'pr-body'(tasks, args) {
    const wb = workBranch(tasks)
    const gate = wb?.gate
    const title = gate ? `到关口 ${gate.id}：${gate.title}` : '重构收尾'
    if (args.title) { console.log(title); return }
    const list = sortTasks(tasks).filter((t) => t.status === 'review' && t.owner === 'ai')
    const doing = tasks.filter((t) => t.status === 'doing')
    const reached = gate && pendingGates(tasks).some((g) => g.id === gate.id)
    const lines = []
    lines.push(`## ${title}`, '')
    lines.push(reached
      ? '本段工作已到达作者验收关口，请审查。'
      : '本段工作还在进行中（草稿）。可以随时查看和评论。')
    lines.push('', '**合并这个 PR 就是验收通过**：合并后 GitHub Actions 会把下面的任务和关口标为「已完成」。有问题请在 PR 里评论或 Request changes，执行者会在这个分支上修改后回复。建议用「Create a merge commit」合并，保留每个任务的提交。', '')
    lines.push(`### 包含的任务（${list.length} 个）`, '', '| 任务 | 标题 | 验收标准 |', '| --- | --- | --- |')
    for (const t of list) lines.push(`| ${t.id} | ${t.title} | ${t.checks.done}/${t.checks.total} |`)
    if (doing.length) lines.push('', `进行中：${doing.map((t) => `${t.id} ${t.title}`).join('；')}`)
    if (gate) {
      lines.push('', `### 关口 ${gate.id}：作者要看的`, '')
      for (const l of (gate.sections['要做的事'] || '').split('\n').filter(Boolean)) lines.push(l)
      lines.push('', '验收标准：', '')
      for (const i of gate.checks.items) lines.push(`- ${i.text}`)
    }
    for (const [label, head] of [['待确认', '待确认（需要作者决定的事）'], ['遗留问题', '遗留问题']]) {
      const notes = list.flatMap((t) => recordNotes(t, label).map((n) => `- ${t.id}：${n}`))
      lines.push('', `### ${head}`, '', ...(notes.length ? notes : ['- 无']))
    }
    lines.push('', '### 检查', '', '每次推送都会运行 Refactor checks（refactor:check、单测、构建），结果见本 PR 下方的检查状态。')
    console.log(lines.join('\n'))
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

  sync                             同步并切到当前工作分支 work/<下一个关口>（开工前运行）
  next [--gpu|--no-gpu] [--n 3]    下一个可以开始的任务（自动检测本机是否有 AMD GPU；到达作者关口时停下）
  list [--status todo] [--phase 1] [--area novice]
  show <编号>                      查看任务概要
  start <编号>                     开始任务：待开始 → 进行中
  review <编号>                    提交验收：进行中 → 待验收（要求验收标准全部勾选、完成记录已填）
  reopen <编号> --note "原因"      作者在 PR 里提出问题：退回进行中，原因记入「验收记录」
  block <编号> --note "原因"       标记受阻，原因记入「完成记录」
  unblock <编号>                   受阻 → 待开始
  reset <编号>                     放弃进行中的任务：进行中 → 待开始
  branch                           打印当前工作分支名
  pr-body [--title]                生成本段 PR 的说明（--title 只打印标题）
  accept [--note "说明"]           PR 合并后把待验收任务和已到达的关口标为已完成（通常由 GitHub Actions 执行）
  done <编号...> [--note "说明"]   手动标记已完成（只在作者明确要求时使用）
  check                            检查全部任务文件
  stats                            统计`)
  },
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0] || 'help'
if (!commands[cmd]) fail(`未知命令 ${cmd}，运行 npm run tasks -- help 查看用法`)
commands[cmd](cmd === 'help' ? [] : loadTasks(), args)
