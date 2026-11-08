---
id: TR-LAB-12
title: 3-12 GEAK 剖析与复现 实验室 Notebook
phase: 3
order: 1270
area: lab
status: todo
deps: [TR-LAB-11]
size: L
gpu: false
owner: ai
specs: [05-writing, 07-notebook, 09-engineering]
outputs: [notebooks/src/trial/geak.md, notebooks/trial/geak/geak.ipynb, docs/course/outline.json]
updated: 2026-11-08
---

# TR-LAB-12 3-12 GEAK 剖析与复现 实验室 Notebook

## 目标

写「3-12 GEAK 剖析与复现：工业级算子优化 Agent」的实验室 Notebook 源文件，生成共用版，并定义本关的真卡星级规则。

## 背景

- 大纲条目：`trial-geak`（推荐 Lv.29，约 90 分钟）。
- 学完能回答：一个工业级的算子优化 Agent 是怎么设计的？
- 硬件落点：GEAK 的单 kernel 优化流程（kernel_workflow）；面向推理服务的端到端流程不在本书范围
- 核心交互：在容器里用小预算跑官方示例任务，和自己的多 Agent 对比
- 两条路线共用（`routes: shared`），不使用 RouteBlock，只生成一份 Notebook。
- 旧版 `notebooks/part*/` 里可能有相关素材（用 `notebooks/chapters.json` 找对应章节）。只借用验证过的代码，结构和口吻按 07 重写。
- 真机验证在 R-09：本任务在没有 GPU 的机器上也能完成（编写、生成、静态检查）。
- 写作前重新核对 GEAK 最新 README 和发布说明。截至 2026-11 已知：v4（4.0.0，2026-07-17 发布），Apache-2.0；官方验证过 MI 系列（gfx942 / gfx950）、gfx1151（Radeon 8060S）和 R9700（gfx1201）；RX 9070 XT 同为 gfx1201，但不在官方验证列表里。
- 运行需要 Claude Code ≥ 2.1.177，并以 `IS_SANDBOX=1 claude --dangerously-skip-permissions` 启动，所以教程必须让读者在容器或沙盒里运行。
- 本书只讲单 kernel 优化流程（kernel_workflow），不讲面向推理服务的端到端流程。

## 要做的事

1. 读大纲条目、`07-notebook.md`、本区域上一关的 Notebook 源，保持结构和口吻一致；如果网页（TR-12）已经写好，Notebook 的「动手」各段要和网页「探索」各段对应。
2. Notebook 提供容器启动方式、小预算的官方示例任务、结果读取和与自己多 Agent 系统的对比表；不在宿主机上直接以跳过权限的方式运行。
3. 写 `notebooks/src/trial/geak.md`：准备 / 动手 / 挑战 / 交成绩 / 练习。
4. 在 outline.json 的 `trial-geak` 加 `lab.stars`（三条，只用相对值，见 07 第 9 节），确认 `hg.submit` 提交的 metrics 覆盖规则用到的全部字段；在 `docs/course/lab-rules.fixtures.json` 加本关的样例。
5. Notebook 里需要的新辅助函数加进 `hello_gpu`（附无 GPU 单测），Notebook 里不出现编译命令、计时循环和画图样板。
6. `npm run nb:build` 生成，`npm run nb:check` 通过。
7. 完成记录写明「待真机验证（R-09）」，列出需要在真卡上确认的地方。

## 验收标准

- [ ] 07 第 5 节的小节结构齐全（准备、动手、挑战、交成绩、练习）
- [ ] 每个代码单元不超过 15 行；没有编译命令、计时循环、画图样板
- [ ] `lab.stars` 只用相对值；Python 和 TS 求值器对本关 fixtures 的结果一致
- [ ] Notebook 里所有运行 GEAK 的步骤都在容器内
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
