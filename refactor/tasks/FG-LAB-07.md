---
id: FG-LAB-07
title: 2-7 少搬一次数据 实验室 Notebook
phase: 2
order: 780
area: lab
status: todo
deps: [FG-LAB-06]
size: L
gpu: false
owner: ai
specs: [05-writing, 07-notebook, 09-engineering]
outputs: [notebooks/src/forge/fusion.md, notebooks/forge/fusion/fusion-hip.ipynb, notebooks/forge/fusion/fusion-triton.ipynb, docs/course/outline.json]
updated: 2026-11-08
---

# FG-LAB-07 2-7 少搬一次数据 实验室 Notebook

## 目标

写「2-7 少搬一次数据：逐元素融合」的实验室 Notebook 源文件，生成 HIP 版和 Triton 版，并定义本关的真卡星级规则。

## 背景

- 大纲条目：`forge-fusion`（推荐 Lv.15，约 35 分钟）。
- 学完能回答：为什么把多个逐元素操作合成一个 kernel 会变快？
- 硬件落点：访存受限时，耗时主要花在读写显存上
- 核心交互：读写字节计数器：比较 torch 分步写法和融合 kernel；实测 bias + GELU 融合
- 分路线（`routes: split`）：
  - 两条路线共用：题目、硬件讲解、挑战目标、实测数据格式
  - HIP 路线：HIP 实现
  - Triton 路线：Triton 实现
- 旧版 `notebooks/part*/` 里可能有相关素材（用 `notebooks/chapters.json` 找对应章节）。只借用验证过的代码，结构和口吻按 07 重写。
- 真机验证在 R-02：本任务在没有 GPU 的机器上也能完成（编写、生成、静态检查）。

## 要做的事

1. 读大纲条目、`07-notebook.md`、本区域上一关的 Notebook 源，保持结构和口吻一致；如果网页（FG-07）已经写好，Notebook 的「动手」各段要和网页「探索」各段对应。
2. 写 `notebooks/src/forge/fusion.md`：准备 / 动手 / 挑战 / 交成绩 / 练习；实现单元用 `route=hip` / `route=triton` 标记，两条路线的小节标题一致。
3. 在 outline.json 的 `forge-fusion` 加 `lab.stars`（三条，只用相对值，见 07 第 9 节），确认 `hg.submit` 提交的 metrics 覆盖规则用到的全部字段；在 `docs/course/lab-rules.fixtures.json` 加本关的样例。
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
