---
id: FG-LAB-14
title: 铸造城 Boss 实验室 Notebook
phase: 2
order: 970
area: lab
status: todo
deps: [FG-LAB-13]
size: L
gpu: false
owner: ai
specs: [05-writing, 07-notebook, 09-engineering]
outputs: [notebooks/src/forge/boss.md, notebooks/forge/boss/boss-hip.ipynb, notebooks/forge/boss/boss-triton.ipynb, docs/course/outline.json]
updated: 2026-11-08
---

# FG-LAB-14 铸造城 Boss 实验室 Notebook

## 目标

写「铸造城 Boss：综合」的实验室 Notebook 源文件，生成 HIP 版和 Triton 版，并定义本关的真卡星级规则。

## 背景

- 大纲条目：`forge-boss`（推荐 Lv.20，约 90 分钟）。
- 学完能回答：综合运用铸造城的全部知识
- 硬件落点：—
- 核心交互：选一个 torch 算子（Softmax、RMSNorm 或 bias + GELU），用自己的路线手写版本打败 torch；再让 Agent 在同一任务上复现，并提交可复核的报告
- 分路线（`routes: split`）：
  - 两条路线共用：任务和评分标准
  - HIP 路线：用 HIP 完成
  - Triton 路线：用 Triton 完成
- 旧版 `notebooks/part*/` 里可能有相关素材（用 `notebooks/chapters.json` 找对应章节）。只借用验证过的代码，结构和口吻按 07 重写。
- 真机验证在 R-05：本任务在没有 GPU 的机器上也能完成（编写、生成、静态检查）。

## 要做的事

1. 读大纲条目、`07-notebook.md`、本区域上一关的 Notebook 源，保持结构和口吻一致；如果网页（FG-14）已经写好，Notebook 的「动手」各段要和网页「探索」各段对应。
2. Boss 的 Notebook 提供三个候选算子（Softmax、RMSNorm、bias + GELU）的脚手架和统一的评测与报告模板。
3. 写 `notebooks/src/forge/boss.md`：准备 / 动手 / 挑战 / 交成绩 / 练习；实现单元用 `route=hip` / `route=triton` 标记，两条路线的小节标题一致。
4. 在 outline.json 的 `forge-boss` 加 `lab.stars`（三条，只用相对值，见 07 第 9 节），确认 `hg.submit` 提交的 metrics 覆盖规则用到的全部字段；在 `docs/course/lab-rules.fixtures.json` 加本关的样例。
5. Notebook 里需要的新辅助函数加进 `hello_gpu`（附无 GPU 单测），Notebook 里不出现编译命令、计时循环和画图样板。
6. `npm run nb:build` 生成，`npm run nb:check` 通过。
7. 完成记录写明「待真机验证（R-05）」，列出需要在真卡上确认的地方。

## 验收标准

- [ ] 07 第 5 节的小节结构齐全（准备、动手、挑战、交成绩、练习）
- [ ] 每个代码单元不超过 15 行；没有编译命令、计时循环、画图样板
- [ ] 两条路线都完整，小节标题一致，路线差异和背景里的说明一致
- [ ] `lab.stars` 只用相对值；Python 和 TS 求值器对本关 fixtures 的结果一致
- [ ] `npm run nb:check` 通过
- [ ] `npm run refactor:check`、`npm test`、`npm run docs:build` 全部通过

## 验证方式

- `npm run nb:build`
- `npm run nb:check`
- `python -m pytest notebooks/common/tests`
- `npm run refactor:check`
- `npm test`
- `npm run docs:build`

## 完成记录

_待填写：做了什么、改了哪些文件、怎么验证的、遗留问题、待确认事项。_

## 验收记录

_作者验收后由会话记录。_
