---
id: FG-LAB-12
title: 2-12 Agent 的工具箱 实验室 Notebook
phase: 2
order: 920
area: lab
status: todo
deps: [FG-LAB-11]
size: L
gpu: false
owner: ai
specs: [05-writing, 07-notebook, 09-engineering]
outputs: [notebooks/src/forge/agent-tools.md, notebooks/forge/agent-tools/agent-tools.ipynb, docs/course/outline.json]
updated: 2026-11-08
---

# FG-LAB-12 2-12 Agent 的工具箱 实验室 Notebook

## 目标

写「2-12 Agent 的工具箱：工具封装与守门」的实验室 Notebook 源文件，生成共用版，并定义本关的真卡星级规则。

## 背景

- 大纲条目：`forge-agent-tools`（推荐 Lv.19，约 35 分钟）。
- 学完能回答：怎样把编译、校验、计时、分析封装成 Agent 能用的工具？
- 硬件落点：工具在真卡上运行；失败时要返回结构化的原因
- 核心交互：逐个调用工具，看失败时 Agent 拿到什么反馈（Agent 修改的是读者所选路线的源码）
- 两条路线共用（`routes: shared`），不使用 RouteBlock，只生成一份 Notebook。
- 旧版 `notebooks/part*/` 里可能有相关素材（用 `notebooks/chapters.json` 找对应章节）。只借用验证过的代码，结构和口吻按 07 重写。
- 真机验证在 R-04：本任务在没有 GPU 的机器上也能完成（编写、生成、静态检查）。
- Agent 的「思考」需要大模型 API。Notebook 要提供不调用大模型的路径（读取录好的轨迹回放），没有 Key 也能学完。

## 要做的事

1. 读大纲条目、`07-notebook.md`、本区域上一关的 Notebook 源，保持结构和口吻一致；如果网页（FG-12）已经写好，Notebook 的「动手」各段要和网页「探索」各段对应。
2. 工具封装放进 `hello_gpu.agentlab`（已有模块，扩展而不是推倒），失败时返回结构化原因。
3. 写 `notebooks/src/forge/agent-tools.md`：准备 / 动手 / 挑战 / 交成绩 / 练习。
4. 在 outline.json 的 `forge-agent-tools` 加 `lab.stars`（三条，只用相对值，见 07 第 9 节），确认 `hg.submit` 提交的 metrics 覆盖规则用到的全部字段；在 `docs/course/lab-rules.fixtures.json` 加本关的样例。
5. Notebook 里需要的新辅助函数加进 `hello_gpu`（附无 GPU 单测），Notebook 里不出现编译命令、计时循环和画图样板。
6. `npm run nb:build` 生成，`npm run nb:check` 通过。
7. 完成记录写明「待真机验证（R-04）」，列出需要在真卡上确认的地方。

## 验收标准

- [ ] 07 第 5 节的小节结构齐全（准备、动手、挑战、交成绩、练习）
- [ ] 每个代码单元不超过 15 行；没有编译命令、计时循环、画图样板
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
