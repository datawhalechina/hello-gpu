---
id: FG-LAB-06
title: 2-6 路线进阶 实验室 Notebook
phase: 2
order: 760
area: lab
status: todo
deps: [FG-LAB-05]
size: L
gpu: false
owner: ai
specs: [05-writing, 07-notebook, 09-engineering]
outputs: [notebooks/src/forge/route-advanced.md, notebooks/forge/route-advanced/route-advanced-hip.ipynb, notebooks/forge/route-advanced/route-advanced-triton.ipynb, docs/course/outline.json]
updated: 2026-11-08
---

# FG-LAB-06 2-6 路线进阶 实验室 Notebook

## 目标

写「2-6 路线进阶：写法与配置」的实验室 Notebook 源文件，生成 HIP 版和 Triton 版，并定义本关的真卡星级规则。

## 背景

- 大纲条目：`forge-route-advanced`（推荐 Lv.14，约 30 分钟）。
- 学完能回答：怎样把 kernel 的写法和启动配置调到合适？
- 硬件落点：每组大小、每个线程的工作量和 wave 数，决定了硬件能不能被用满
- 核心交互：HIP 路线：主机端 API、stream、错误检查与 launch 配置；Triton 路线：BLOCK_SIZE、num_warps 与 autotune
- 分路线（`routes: split`）：
  - 两条路线共用：「配置怎样影响硬件利用」的讲解
  - HIP 路线：主机端 API、stream、错误检查、launch 配置
  - Triton 路线：BLOCK_SIZE、num_warps、autotune
- 旧版 `notebooks/part*/` 里可能有相关素材（用 `notebooks/chapters.json` 找对应章节）。只借用验证过的代码，结构和口吻按 07 重写。
- 真机验证在 R-02：本任务在没有 GPU 的机器上也能完成（编写、生成、静态检查）。

## 要做的事

1. 读大纲条目、`07-notebook.md`、本区域上一关的 Notebook 源，保持结构和口吻一致；如果网页（FG-06）已经写好，Notebook 的「动手」各段要和网页「探索」各段对应。
2. 写 `notebooks/src/forge/route-advanced.md`：准备 / 动手 / 挑战 / 交成绩 / 练习；实现单元用 `route=hip` / `route=triton` 标记，两条路线的小节标题一致。
3. 在 outline.json 的 `forge-route-advanced` 加 `lab.stars`（三条，只用相对值，见 07 第 9 节），确认 `hg.submit` 提交的 metrics 覆盖规则用到的全部字段；在 `docs/course/lab-rules.fixtures.json` 加本关的样例。
4. Notebook 里需要的新辅助函数加进 `hello_gpu`（附无 GPU 单测），Notebook 里不出现编译命令、计时循环和画图样板。
5. `npm run nb:build` 生成，`npm run nb:check` 通过。
6. 完成记录写明「待真机验证（R-02）」，列出需要在真卡上确认的地方。

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
