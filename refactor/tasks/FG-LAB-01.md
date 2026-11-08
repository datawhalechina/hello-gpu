---
id: FG-LAB-01
title: 2-1 开工准备 实验室 Notebook
phase: 2
order: 650
area: lab
status: todo
deps: [L-01, L-03]
size: M
gpu: false
owner: ai
specs: [05-writing, 07-notebook, 09-engineering]
outputs: [notebooks/src/forge/your-gpu.md, notebooks/forge/your-gpu/your-gpu.ipynb, docs/course/outline.json]
updated: 2026-11-08
---

# FG-LAB-01 2-1 开工准备 实验室 Notebook

## 目标

写「2-1 开工准备：认识你的 GPU」的实验室 Notebook 源文件，生成共用版，并定义本关的真卡星级规则。

## 背景

- 大纲条目：`forge-your-gpu`（推荐 Lv.10，约 20 分钟）。
- 学完能回答：怎么在云上或本地拿到能用的 AMD GPU？我的卡有多少个 CU、wave 多大、显存多少？
- 硬件落点：用 rocminfo、rocm-smi 读出真机参数，填进新手村的全景图
- 核心交互：一键检查脚本 + 「我的 GPU 卡片」：自动填好 CU 数、wave 大小、显存容量，导入网页后全景图换成真机参数
- 两条路线共用（`routes: shared`），不使用 RouteBlock，只生成一份 Notebook。
- 旧版 `notebooks/part*/` 里可能有相关素材（用 `notebooks/chapters.json` 找对应章节）。只借用验证过的代码，结构和口吻按 07 重写。
- 真机验证在 R-01：本任务在没有 GPU 的机器上也能完成（编写、生成、静态检查）。

## 要做的事

1. 读大纲条目、`07-notebook.md`、本区域上一关的 Notebook 源，保持结构和口吻一致；如果网页（FG-01）已经写好，Notebook 的「动手」各段要和网页「探索」各段对应。
2. 准备单元做环境检查：GPU 是否可见、ROCm 和 PyTorch 版本是否匹配；不匹配时给出可读的提示和指南链接。
3. `hg.device_card()` 输出导入码，告诉读者怎样导入网页。
4. 写 `notebooks/src/forge/your-gpu.md`：准备 / 动手 / 挑战 / 交成绩 / 练习。
5. 在 outline.json 的 `forge-your-gpu` 加 `lab.stars`（三条，只用相对值，见 07 第 9 节），确认 `hg.submit` 提交的 metrics 覆盖规则用到的全部字段；在 `docs/course/lab-rules.fixtures.json` 加本关的样例。
6. Notebook 里需要的新辅助函数加进 `hello_gpu`（附无 GPU 单测），Notebook 里不出现编译命令、计时循环和画图样板。
7. `npm run nb:build` 生成，`npm run nb:check` 通过。
8. 完成记录写明「待真机验证（R-01）」，列出需要在真卡上确认的地方。

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
