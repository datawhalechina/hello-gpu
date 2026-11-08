#!/usr/bin/env node
// 由 docs/course/outline.json 生成 refactor/OUTLINE.md。
// 用法：node scripts/refactor/outline-md.mjs          生成
//       node scripts/refactor/outline-md.mjs --check  只检查是否最新（refactor:check 使用）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const outline = JSON.parse(readFileSync(resolve(root, 'docs/course/outline.json'), 'utf8'))
const target = resolve(root, 'refactor/OUTLINE.md')

const cell = (s) => String(s ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ')
const lines = []
const push = (...xs) => lines.push(...xs)

push(
  '# Hello GPU 教程大纲 v2',
  '',
  '> 本文件由 `docs/course/outline.json` 生成（`npm run outline:md`），不要手改。要调整关卡，先改 JSON 再重新生成。',
  '',
  '## 编排原则',
  '',
  '1. **硬件全景先行，软硬交替深入**：新手村第 2 关先给一张「够用的 GPU 全景图」，之后每个编程概念都落到它运行的硬件上；出现具体现象（变慢、空转、冲突）时再讲对应的硬件机制。',
  '2. **问题驱动**：每关从一个具体现象或问题开始。',
  '3. **一个例子用到底**：新手村只用「向量加法」和「求和」两个小例子。',
  '4. **先正确，再测量，再优化**：每个区域都按这个顺序推进。',
  '5. **两条路线**：新手村共用（代码可选 HIP 风格或 Python 风格，都是线程视角）；从铸造城开始分 HIP 路线和 Triton 路线，题目、硬件讲解和实测数据共用，只有实现部分不同。',
  '6. **只讲算子优化**：「端到端」只到把算子接回 PyTorch 模型、测一次前向，不涉及推理框架。',
  '',
  '## 区域总览',
  '',
  '| 区域 | 推荐等级 | 一句话目标 | 主要读者 | 运行环境 | 关卡 |',
  '| --- | --- | --- | --- | --- | --- |',
)
for (const z of outline.zones) {
  const stages = outline.stages.filter((s) => s.zone === z.id)
  const normal = stages.filter((s) => s.kind === 'stage').length
  const boss = stages.filter((s) => s.kind === 'boss').length
  push(`| ${z.name} | Lv.${z.lv[0]}–${z.lv[1]} | ${cell(z.summary)} | ${cell(z.readers)} | ${cell(z.env)} | ${normal} 关 + ${boss} 个 Boss |`)
}
push('', '无尽之塔（进阶优化方法、算子库等专题）本版不做，以后作为新区域加入。', '')

for (const z of outline.zones) {
  const stages = outline.stages.filter((s) => s.zone === z.id)
  push(`## ${z.name}（推荐 Lv.${z.lv[0]}–${z.lv[1]}，${z.env}）`, '', z.summary + '。', '')
  if (z.routes === 'syntax') push('本区域不分路线；代码可选 HIP 风格或 Python 风格，两种写法共用一个模拟器。', '')
  if (z.routes === 'split') push('本区域分 HIP 路线和 Triton 路线，读者在入口选择，之后每关可切换；路线差异见本节末尾的表。', '')
  const arcs = [...new Set(stages.map((s) => s.arc))]
  for (const arc of arcs) {
    push(`### ${arc}`, '', '| 关卡 | id | 学完能回答 | 硬件落点 | 核心交互 | 推荐等级 | 时长 | 模拟器 | 真卡 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const s of stages.filter((x) => x.arc === arc)) {
      const name = `**${s.code} ${s.title}**：${s.subtitle}`
      push(`| ${cell(name)} | \`${s.id}\` | ${cell(s.question)} | ${cell(s.hardware)} | ${cell(s.interaction)} | Lv.${s.lv} | ${s.minutes} 分钟 | ${s.sim.length ? s.sim.join('、') : '—'} | ${s.gpu ? '需要' : '—'} |`)
    }
    push('')
  }
  const sides = stages.filter((s) => s.agentSide).map((s) => s.code)
  if (sides.length) push(`Agent 支线：${sides.join('、')}。`, '')
  const split = stages.filter((s) => s.routeNote)
  if (split.length) {
    push('### 两条路线怎么分', '', '| 关卡 | 两条路线共用 | HIP 路线 | Triton 路线 |', '| --- | --- | --- | --- |')
    const shared = stages.filter((s) => !s.routeNote).map((s) => s.code)
    if (shared.length) push(`| ${shared.join('、')} | 全部共用 | — | — |`)
    for (const s of split) push(`| ${s.code} ${cell(s.title)} | ${cell(s.routeNote.shared)} | ${cell(s.routeNote.hip)} | ${cell(s.routeNote.triton)} |`)
    push('')
  }
}

push('## 副本关卡（额外练习）', '', '副本挂在各区域旁边，可选、不占主线；以自研题为主，外部题只链接原题并写原创题解（LeetGPU 题库为 CC BY-NC-ND 4.0，不能翻译或改编题面）。', '', '| 区域 | 首批副本 | 练的是 |', '| --- | --- | --- |')
for (const e of outline.exercises) {
  const z = outline.zones.find((x) => x.id === e.zone)
  push(`| ${z.name} | ${e.items.join('、')} | ${e.practice} |`)
}
push('')

const text = lines.join('\n')
if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : ''
  if (current !== text) {
    console.error('refactor/OUTLINE.md 不是最新的：请运行 npm run outline:md')
    process.exit(1)
  }
  console.log('OUTLINE.md 与 outline.json 一致')
} else {
  writeFileSync(target, text)
  console.log(`已生成 refactor/OUTLINE.md（${outline.stages.length} 个关卡）`)
}
