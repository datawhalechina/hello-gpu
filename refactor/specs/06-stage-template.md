# 06 关卡模板规范

所有关卡共用一套固定骨架和一份元数据。读者每关都知道去哪找什么，AI 会话也能按模板稳定产出。

## 1. 文件组织

```text
docs/
  course/
    outline.json            课程结构（唯一数据源）
    glossary.json           术语表（F-07 建立）
  novice/<slug>/            新手村关卡，一关一个目录
    index.md                正文（layout: stage）
    scenes/                 本关专属的可视化组件（.vue）
    challenge.ts            星级判定，纯函数
  forge/<slug>/             铸造城（结构相同；另有实验室 Notebook）
  trial/<slug>/             试炼场
  handbook/                 冒险者手册
  lab/data/                 实验档案馆：真实测量数据（JSON）
scripts/tests/<zone>-<slug>.test.mjs   本关的单测
notebooks/src/<zone>/<slug>.md         实验室 Notebook 源（真卡关卡）
```

试点关卡目前在 `docs/preview/novice/thread-groups/`，任务 NV-04 会把它迁到 `docs/novice/thread-groups/`。

## 2. 元数据

关卡页的 frontmatter 只写和 `outline.json` 对应的 id，其余信息（编号、标题、推荐等级、时长、前置）由布局从 `outline.json` 读取，不重复写。

```yaml
---
layout: stage
stage: novice-thread-groups      # 对应 outline.json 的 id
newTerms: [block, grid, global-index]   # glossary.json 的键；新手村不超过 3 个
evidence: simulated              # simulated | measured | mixed
---
```

## 3. 关卡骨架（按顺序，不能缺项）

1. **关卡头**：由 `StageLayout` 自动生成（编号、名称、区域、推荐等级、时长、硬件要求、前置关卡）。正文以 `# <编号> <名称>` 开头。
2. **任务卡** `Mission`：一句话目标 + 三条星级标准；上方可以有一两句小核的故事。
3. **热身**：至少一个 `Predict`。
4. **探索**：1–3 段，每段是「一小段文字 + 一个交互 + 一句解读」。
5. **原理**：本关新术语的 `ConceptCard`；比喻写明边界；细节放 `DeepDive`。
6. **挑战**：带星级判定的交互（模拟器关卡），或 `LabCard`（真卡关卡）。
7. **支线**（可选）：Agent 视角，标注「支线」。
8. **你现在能……**：3 条能力句。
9. **检查点** `Checkpoint`：2–3 道迁移题，不能和正文里的例子相同；每个选项都有解释。
10. **下一关**：下一关的一句预告，以及「回到基础」「深入一层」两个链接。
11. **证据** `EvidenceCard`：说明本关数字是模拟还是实测；实测写清档案条目。

## 4. 长度与密度预算

| 区域 | 正文字数 | 交互数 | 单段代码 | 时长 |
| --- | --- | --- | --- | --- |
| 新手村 | 1500–2500 字 | 4–6 个 | ≤ 10 行 | 10–20 分钟 |
| 铸造城 | 2500–4500 字 | 3–5 个 + 实验室 | ≤ 30 行，更长的折叠 | 20–45 分钟 |
| 试炼场 | 4000–8000 字 | 2–4 个 + 实验室 | 不限，逐段解读 | 60–90 分钟 |

## 5. 两种写法与两条路线

- 新手村：代码块用 `<LangCode>` 同时给出 HIP 风格和 Python 风格；沙盒挑战两种写法都能拿 3 星，单测要覆盖两种写法。
- 铸造城、试炼场：共用部分直接写在正文里；实现部分用 `<RouteBlock route="hip">` 和 `<RouteBlock route="triton">` 分开，两块的小标题和顺序保持一致。纯硬件或工具类关卡（`outline.json` 里 `routes: "shared"`）不用 `RouteBlock`。

## 6. 跨关卡引用

- 前置知识用关卡链接（由 `outline.json` 生成），显示读者是否已完成。
- 术语第一次出现用概念卡，不复制定义。
- 同一主题在相邻区域的页面互相链接：「回到基础」和「深入一层」。
- 不把整段内容复制到另一个关卡；确实需要时，引用原文并写一句话摘要。

## 7. 星级判定代码

- 模拟器关卡：`challenge.ts` 导出 `judge(...)`，输入是模拟器结果和读者的配置，输出 `{ earned: [bool, bool, bool], next: string }`；纯函数，单测覆盖每颗星的成立与不成立、两种写法。参考 `docs/preview/novice/thread-groups/challenge.ts`。
- 真卡关卡：星级规则写在 `outline.json` 对应关卡的 `lab.stars` 字段（格式见 `07-notebook.md`），网页和 Notebook 共用同一份规则。

## 8. 完成定义

一个关卡任务完成时，必须满足：

- [ ] 骨架 11 项齐全，frontmatter 通过 `npm run refactor:check`
- [ ] 新术语不超过预算，比喻属于工坊城体系并写明边界
- [ ] 至少 1 个「先猜」和 1 个动手交互；星级标准在开头公示
- [ ] 两种写法（新手村）或两条路线（铸造城、试炼场）都能完成
- [ ] 所有数字标明模拟或实测；实测数字引用档案馆条目
- [ ] 375px 宽度无横向滚动；键盘能完成全部操作；减弱动效下可用
- [ ] `npm run refactor:check`、`npm test`、`npm run docs:build` 全部通过
- [ ] `outline.json` 里该关的 `status` 改为 `draft`（作者验收后改为 `ready`）
